/**
 * Backlinks database access (tables in ./schema.ts). Every write that changes a source also appends an event,
 * so the detail panel shows how a source got where it is.
 */
import { pool } from "../db";
import {
  BACKLINK_GOAL, BACKLINK_KINDS, BACKLINK_STATUSES, BACKLINK_TIERS, QUALITY_TIERS,
  type BacklinkKind, type BacklinkMetrics, type BacklinkOutreach, type BacklinkSignals, type BacklinkSource, type BacklinkSourceRow,
  type BacklinkStatus, type BacklinkSummary,
} from "@shared/backlinks";
import { buildQueryBank, type SerpHit } from "./discover";
import type { Grade } from "./vet";

type Q = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
export const storeDeps: { db: Q } = { db: pool as unknown as Q };
const db = () => storeDeps.db;

export const MAX_VET_ATTEMPTS = 3;
// A grade counts only while it stands: a source back in the vetting queue is not quality until it is graded again.
const QUALITY_SQL = `tier IN (${QUALITY_TIERS.map((t) => `'${t}'`).join(",")}) AND kind <> 'pbn' AND status IN ('qualified','contacted','replied','agreed','active')`;

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// ── Query bank ──────────────────────────────────────────────────────────────

/** Puts every bank query in the table once (new templates appear on the next boot) and tags each with its template. */
export async function seedQueries(): Promise<number> {
  const bank = buildQueryBank();
  const r = await db().query(
    `INSERT INTO backlink_queries (kind, niche, query, template)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
     ON CONFLICT (query) DO UPDATE SET template = EXCLUDED.template WHERE backlink_queries.template IS DISTINCT FROM EXCLUDED.template`,
    [bank.map((q) => q.kind), bank.map((q) => q.niche), bank.map((q) => q.query), bank.map((q) => q.template)],
  );
  return r.rowCount ?? 0;
}

/**
 * Families (one template across its niches, states or cities) are judged by the quality sources their searches found.
 * A family is "learning" until it has run FAMILY_TRIAL searches; after that it runs in order of quality found per search,
 * and one under FAMILY_MIN_YIELD per search is paused (2026-10-16: "useful links" found 3 in 22 searches, member
 * directories 368 in 100). Families keep their place when the bank grows.
 */
export const FAMILY_TRIAL = 5;
export const FAMILY_MIN_YIELD = 0.5;

export type QueryRow = { id: number; kind: BacklinkKind; niche: string; query: string };
/** Never-run queries first — learning families, then the best-yielding — then the longest-unrun, each at most once every `repeatDays`. */
export async function dueQueries(limit: number, repeatDays = 60): Promise<QueryRow[]> {
  const r = await db().query(
    `WITH fam AS (
       SELECT q.template, sum(q.runs)::float runs, count(s.id) FILTER (WHERE s.tier IN ('A','B') AND s.kind <> 'pbn')::float quality
         FROM backlink_queries q LEFT JOIN backlink_sources s ON s.discovered_via = q.query
        WHERE q.runs > 0 AND q.template IS NOT NULL GROUP BY q.template),
     due AS (
       SELECT q.id, q.kind, q.niche, q.query, q.last_run_at, coalesce(f.runs, 0) fruns, f.quality fquality,
              row_number() OVER (PARTITION BY q.template ORDER BY q.last_run_at NULLS FIRST, q.id) rn
         FROM backlink_queries q LEFT JOIN fam f ON f.template = q.template
        WHERE q.task_id IS NULL AND (q.last_run_at IS NULL OR q.last_run_at < now() - make_interval(days => $2)))
     SELECT id, kind, niche, query FROM due
      WHERE NOT (fruns >= $3 AND fquality / fruns < $4)
      -- a learning family gets only its trial searches up front; the rest wait for the verdict
      ORDER BY last_run_at IS NULL DESC,
               CASE WHEN fruns >= $3 THEN fquality / fruns WHEN rn <= $3 - fruns THEN 1e9 ELSE -1 END DESC,
               last_run_at NULLS FIRST, id
      LIMIT $1`, [limit, repeatDays, FAMILY_TRIAL, FAMILY_MIN_YIELD]);
  return r.rows;
}

/** Each search family with what it found, best first: the admin page and the session notes read this. */
export async function queryFamilies(): Promise<{ template: string; queries: number; runs: number; quality: number; perSearch: number | null; paused: boolean }[]> {
  const r = await db().query(
    `WITH qs AS (SELECT template, count(*)::int queries, sum(runs)::int runs FROM backlink_queries WHERE template IS NOT NULL GROUP BY 1),
          found AS (SELECT q.template, count(*)::int quality FROM backlink_queries q JOIN backlink_sources s ON s.discovered_via = q.query
                     WHERE s.tier IN ('A','B') AND s.kind <> 'pbn' GROUP BY 1)
     SELECT qs.template, qs.queries, qs.runs, coalesce(found.quality, 0) quality FROM qs LEFT JOIN found USING (template)`);
  return r.rows.map((x: any) => {
    const perSearch = x.runs > 0 ? x.quality / x.runs : null;
    return { ...x, perSearch, paused: x.runs >= FAMILY_TRIAL && (perSearch ?? 0) < FAMILY_MIN_YIELD };
  }).sort((a: any, b: any) => (b.perSearch ?? Infinity) - (a.perSearch ?? Infinity));
}

export async function recordQueryRun(id: number, found: number, newFound: number, costUsd: number) {
  await db().query(
    `UPDATE backlink_queries SET runs = runs + 1, found = found + $2, new_found = new_found + $3, cost_usd = cost_usd + $4, last_run_at = now(), task_id = NULL WHERE id = $1`,
    [id, found, newFound, costUsd]);
}

/** A search posted to the standard queue (worker.ts runQueuedDiscovery); what it cost is counted now. */
export async function markPosted(id: number, taskId: string, costUsd: number) {
  await db().query(`UPDATE backlink_queries SET task_id = $2, task_posted_at = now(), cost_usd = cost_usd + $3 WHERE id = $1`, [id, taskId, costUsd]);
}
/** Posted searches to collect: a minute old at least. One over a day old is given up (it is due again later). */
export async function postedQueries(limit: number): Promise<(QueryRow & { taskId: string; stale: boolean })[]> {
  const r = await db().query(
    `SELECT id, kind, niche, query, task_id "taskId", task_posted_at < now() - interval '1 day' stale FROM backlink_queries
      WHERE task_id IS NOT NULL AND task_posted_at < now() - interval '1 minute' ORDER BY task_posted_at LIMIT $1`, [limit]);
  return r.rows;
}
export async function dropTask(id: number) { await db().query(`UPDATE backlink_queries SET task_id = NULL WHERE id = $1`, [id]); }
/** Searches started today: run live, or posted to the queue. */
export async function searchesToday(): Promise<number> {
  const r = await db().query(`SELECT count(*)::int n FROM backlink_queries WHERE greatest(last_run_at, task_posted_at) >= date_trunc('day', now())`);
  return Number(r.rows[0]?.n ?? 0);
}

// ── Spend ───────────────────────────────────────────────────────────────────

export async function monthSpend(month = monthKey()): Promise<number> {
  const r = await db().query(`SELECT usd FROM backlink_spend WHERE month = $1`, [month]);
  return Number(r.rows[0]?.usd ?? 0);
}
export async function addSpend(usd: number, month = monthKey()) {
  if (!(usd > 0)) return;
  await db().query(`INSERT INTO backlink_spend (month, usd) VALUES ($1, $2) ON CONFLICT (month) DO UPDATE SET usd = backlink_spend.usd + $2`, [month, usd]);
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function event(sourceId: number, type: string, detail: Record<string, unknown> | null = null) {
  await db().query(`INSERT INTO backlink_events (source_id, type, detail) VALUES ($1, $2, $3)`, [sourceId, type, detail ? JSON.stringify(detail) : null]);
}

/** New candidates only: a domain already in the database is left as it is. Returns how many were new. */
export async function addCandidates(hits: Pick<SerpHit, "domain" | "url">[], kind: BacklinkKind, via: string, niche: string | null): Promise<number> {
  let added = 0;
  for (const h of hits) {
    const r = await db().query(
      `INSERT INTO backlink_sources (domain, kind, discovered_url, discovered_via, niches)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (domain) DO NOTHING RETURNING id`,
      [h.domain, kind, h.url, via.slice(0, 300), niche ? [niche] : []]);
    if (r.rows[0]) { added++; await event(r.rows[0].id, "discovered", { via, url: h.url }); }
    else if (niche) await db().query(`UPDATE backlink_sources SET niches = array_append(niches, $2) WHERE domain = $1 AND NOT ($2 = ANY(niches)) AND cardinality(niches) < 20`, [h.domain, niche]);
  }
  return added;
}

/**
 * The directory catalogue's scouted directories (server/directories, tier 3–4) are backlink sources too: each becomes a
 * "directory" (associations, chambers, locators, licence lookups) or "citation" (general business directories) source
 * here, then the worker vets and grades it like any other. Maps, social and AI platforms are left out (big platforms
 * are never sold as backlinks). New domains only; existing sources keep their grade. Returns how many were added.
 */
export async function syncCatalogueDirectories(): Promise<number> {
  const exists = await db().query(`SELECT to_regclass('listing_directories') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return 0;
  const r = await db().query(
    `INSERT INTO backlink_sources (domain, kind, discovered_url, discovered_via, niches)
     SELECT d.domain, CASE WHEN d.category = 'general' THEN 'citation' ELSE 'directory' END, d.source, 'directory-catalogue',
            COALESCE(d.trades[1:20], '{}')
       FROM listing_directories d
      WHERE d.domain IS NOT NULL AND d.active AND d.tier >= 3
        AND d.category NOT IN ('maps_nav', 'social', 'ai') AND d.source ~ '^https?://'
     ON CONFLICT (domain) DO NOTHING
     RETURNING id, discovered_url`);
  for (const row of r.rows) await event(row.id, "discovered", { via: "directory-catalogue", url: row.discovered_url });
  return r.rows.length;
}

export type VetJob = { id: number; domain: string; kind: BacklinkKind; discoveredUrl: string | null; catalogueUrl?: string | null; metrics: BacklinkMetrics | null; attempts: number };


/** Lease up to `limit` sources for vetting: new ones, and ones whose vetting lease lapsed (a worker died). */
export async function claimForVetting(token: string, leaseMs: number, limit: number): Promise<VetJob[]> {
  const r = await db().query(
    `UPDATE backlink_sources s SET status = 'vetting', lease_token = $1, lease_until = now() + make_interval(secs => $2), attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM backlink_sources
         WHERE (status = 'discovered' OR (status = 'vetting' AND lease_until < now())) AND attempts < $4
         ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id, domain, kind, discovered_url, metrics, attempts,
        -- The original directories (Google, BBB, Angi…) carry a reference label, not a page, as their source: their home page is the way in.
        (SELECT CASE WHEN d.source ~ '^https?://' THEN d.source ELSE 'https://' || d.domain || '/' END
           FROM listing_directories d WHERE d.domain = s.domain AND d.active ORDER BY (d.source ~ '^https?://') DESC, d.tier LIMIT 1) AS catalogue_url`,
    [token, leaseMs / 1000, limit, MAX_VET_ATTEMPTS]);
  return r.rows.map((x) => ({ id: x.id, domain: x.domain, kind: x.kind, discoveredUrl: x.discovered_url, catalogueUrl: x.catalogue_url, metrics: x.metrics, attempts: x.attempts }));
}

/** Out of tries while still "vetting" (every try's worker died): rejected, with the reason. */
export async function rejectExhausted(): Promise<number> {
  const r = await db().query(
    `UPDATE backlink_sources SET status = 'rejected', tier = 'X', reasons = ARRAY['Could not be vetted after ${MAX_VET_ATTEMPTS} tries'], lease_token = NULL, lease_until = NULL, updated_at = now()
      WHERE status = 'vetting' AND lease_until < now() AND attempts >= $1`, [MAX_VET_ATTEMPTS]);
  return r.rowCount ?? 0;
}

const gradedStatus = (g: Grade): BacklinkStatus => (g.tier === "X" ? "rejected" : "qualified");

export async function saveVetting(job: VetJob, token: string, signals: BacklinkSignals, g: Grade): Promise<boolean> {
  const r = await db().query(
    `UPDATE backlink_sources SET status = $3, kind = $4, tier = $5, score = $6, reasons = $7, signals = $8, link_type = $9,
            contact_emails = $10, contact_url = $11, submit_url = $12, vetted_at = now(), lease_token = NULL, lease_until = NULL, updated_at = now()
      WHERE id = $1 AND lease_token = $2`,
    [job.id, token, gradedStatus(g), g.kind, g.tier, g.score, g.reasons, JSON.stringify(signals), g.linkType,
      signals.emails, signals.contactUrl, signals.submissionUrl ?? null]);
  if (!r.rowCount) return false;
  await event(job.id, "vetted", { tier: g.tier, score: g.score, kind: g.kind });
  return true;
}

/**
 * Sources that published no email, never searched for contacts (or not for 90 days): qualified ones, and rejected ones the
 * media inbox sorted as a directory, association, chamber or newspaper (server/media-inbox/store.ts needingClass).
 */
export async function needingContacts(limit: number): Promise<{ id: number; domain: string; contactUrl: string | null }[]> {
  const r = await db().query(
    `SELECT id, domain, contact_url "contactUrl" FROM backlink_sources
      WHERE cardinality(contact_emails) = 0
        AND (status = 'qualified' OR (status = 'rejected' AND partner_class IN ('listing_directory', 'trade_association', 'chamber', 'news')))
        AND (contacts_checked_at IS NULL OR contacts_checked_at < now() - interval '90 days')
      ORDER BY status = 'qualified' DESC, tier NULLS LAST, score DESC NULLS LAST, id LIMIT $1`, [limit]);
  return r.rows;
}

/** Sources sorted as a chamber, trade association, listing directory or newspaper whose links were never followed (./expand.ts). */
export async function needingExpansion(limit: number): Promise<{ id: number; domain: string; discoveredUrl: string | null }[]> {
  const r = await db().query(
    `SELECT id, domain, discovered_url "discoveredUrl" FROM backlink_sources
      WHERE expanded_at IS NULL AND partner_class IN ('chamber', 'trade_association', 'listing_directory', 'news')
      ORDER BY status = 'qualified' DESC, tier NULLS LAST, id LIMIT $1`, [limit]);
  return r.rows;
}
export async function markExpanded(id: number, found: number, added: number) {
  await db().query(`UPDATE backlink_sources SET expanded_at = now() WHERE id = $1`, [id]);
  await event(id, "expanded", { found, added });
}

/** What the contact finder read; the addresses it found join the source's own. */
export async function saveContacts(id: number, emails: string[], contactUrl: string | null, pagesRead: number) {
  await db().query(
    `UPDATE backlink_sources SET contact_emails = CASE WHEN cardinality($2::text[]) > 0 THEN $2::text[] ELSE contact_emails END,
            contact_url = COALESCE(contact_url, $3), contacts_checked_at = now(), updated_at = now() WHERE id = $1`,
    [id, emails, contactUrl]);
  await event(id, "contacts_searched", { found: emails.length, pagesRead });
}

/** A vetting try that failed: back in the queue, or rejected when it was the last try. */
export async function failVetting(job: VetJob, token: string, error: string) {
  const last = job.attempts >= MAX_VET_ATTEMPTS;
  const r = await db().query(
    `UPDATE backlink_sources SET status = $3, tier = CASE WHEN $4::boolean THEN 'X' ELSE tier END, reasons = CASE WHEN $4::boolean THEN ARRAY[$5::text] ELSE reasons END,
            lease_token = NULL, lease_until = NULL, updated_at = now()
      WHERE id = $1 AND lease_token = $2`,
    [job.id, token, last ? "rejected" : "discovered", last, error.slice(0, 300)]);
  if (r.rowCount) await event(job.id, last ? "vet_failed" : "vet_retry", { error: error.slice(0, 300), attempt: job.attempts });
}

/** Sources worth an authority check: graded on the page, never measured, measured before traffic was (2026-10-14), or over 90 days ago. */
export async function needingMetrics(limit: number): Promise<{ id: number; domain: string; kind: BacklinkKind; signals: BacklinkSignals }[]> {
  const r = await db().query(
    `SELECT id, domain, kind, signals FROM backlink_sources
      WHERE status IN ('qualified','contacted','replied','agreed','active') AND signals IS NOT NULL
        AND (metrics_at IS NULL OR NOT (metrics ? 'organicTraffic') OR metrics_at < now() - interval '90 days')
      ORDER BY metrics_at NULLS FIRST, id LIMIT $1`, [limit]);
  return r.rows;
}

/** Catalogue directories whose DR is known nowhere: not in this database with a rank, and not measured on the catalogue (or 90+ days ago). */
export async function directoriesNeedingAuthority(limit: number): Promise<string[]> {
  const exists = await db().query(`SELECT to_regclass('listing_directories') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return [];
  const r = await db().query(
    `SELECT DISTINCT d.domain FROM listing_directories d
      WHERE d.active AND d.domain IS NOT NULL AND (d.authority_at IS NULL OR d.authority_at < now() - interval '90 days')
        AND NOT EXISTS (SELECT 1 FROM backlink_sources b WHERE b.domain = d.domain AND b.metrics ? 'rank')
      ORDER BY d.domain LIMIT $1`, [limit]);
  return r.rows.map((x) => x.domain);
}

export async function saveDirectoryAuthority(domain: string, metrics: BacklinkMetrics) {
  await db().query(`UPDATE listing_directories SET authority = $2, authority_at = now() WHERE domain = $1`, [domain, JSON.stringify(metrics)]);
}

/** Store measured authority and the grade it leads to (a source with outreach under way keeps its status unless it fails now). */
export async function saveMetrics(id: number, metrics: BacklinkMetrics, g: Grade) {
  await db().query(
    `UPDATE backlink_sources SET metrics = $2, metrics_at = now(), tier = $3, score = $4, reasons = $5, kind = $6,
            status = CASE WHEN $3 = 'X' THEN 'rejected' ELSE status END, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(metrics), g.tier, g.score, g.reasons, g.kind]);
  await event(id, "measured", { rank: metrics.rank, spamScore: metrics.spamScore, referringDomains: metrics.referringDomains, organicTraffic: metrics.organicTraffic ?? null, tier: g.tier });
}

// ── Admin reads ─────────────────────────────────────────────────────────────

const toRow = (x: any): BacklinkSourceRow => ({
  id: x.id, domain: x.domain, kind: x.kind, status: x.status, tier: x.tier, score: x.score, niches: x.niches ?? [],
  submitUrl: x.submit_url, contactEmails: x.contact_emails ?? [], linkType: x.link_type, priceUsd: x.price_usd == null ? null : Number(x.price_usd),
  discoveredVia: x.discovered_via, vettedAt: x.vetted_at?.toISOString?.() ?? x.vetted_at ?? null, updatedAt: x.updated_at?.toISOString?.() ?? x.updated_at,
  rank: x.metrics?.rank ?? null,
  rejectReason: x.status === "rejected" ? (x.reasons?.at?.(-1) ?? null) : null,
});

/** view: "kept" = everything but rejected (the admin page's main tab), "rejected" = only rejected. */
export type ListFilter = { kind?: BacklinkKind; status?: BacklinkStatus; tier?: string; q?: string; quality?: boolean; view?: "kept" | "rejected"; limit: number; offset: number };
export async function listSources(f: ListFilter): Promise<{ rows: BacklinkSourceRow[]; total: number }> {
  const where: string[] = [];
  const v: unknown[] = [];
  const p = (x: unknown) => (v.push(x), `$${v.length}`);
  if (f.kind) where.push(`kind = ${p(f.kind)}`);
  if (f.status) where.push(`status = ${p(f.status)}`);
  if (f.view === "kept") where.push(`status <> 'rejected'`);
  if (f.view === "rejected") where.push(`status = 'rejected'`);
  if (f.tier) where.push(`tier = ${p(f.tier)}`);
  if (f.quality) where.push(QUALITY_SQL);
  if (f.q) where.push(`domain ILIKE ${p(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)}`);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db().query(`SELECT count(*)::int n FROM backlink_sources ${w}`, v)).rows[0]?.n ?? 0);
  const rows = (await db().query(
    `SELECT * FROM backlink_sources ${w} ORDER BY score DESC NULLS LAST, id DESC LIMIT ${p(f.limit)} OFFSET ${p(f.offset)}`, v)).rows;
  return { rows: rows.map(toRow), total };
}

export async function getSource(id: number): Promise<BacklinkSource | null> {
  const x = (await db().query(`SELECT * FROM backlink_sources WHERE id = $1`, [id])).rows[0];
  if (!x) return null;
  const events = (await db().query(`SELECT at, type, detail FROM backlink_events WHERE source_id = $1 ORDER BY at DESC, id DESC LIMIT 100`, [id])).rows;
  const outreach = (await db().query(`SELECT * FROM backlink_outreach WHERE source_id = $1 ORDER BY id DESC`, [id])).rows.map(toOutreach);
  return {
    ...toRow(x), discoveredUrl: x.discovered_url, contactUrl: x.contact_url, signals: x.signals, metrics: x.metrics,
    turnaroundDays: x.turnaround_days, notes: x.notes, createdAt: x.created_at?.toISOString?.() ?? x.created_at, reasons: x.reasons ?? [],
    events: events.map((e) => ({ at: e.at?.toISOString?.() ?? e.at, type: e.type, detail: e.detail })), outreach,
  };
}

export async function summary(capUsd: number, config: BacklinkSummary["config"]): Promise<BacklinkSummary> {
  const kinds = (await db().query(`SELECT kind, count(*)::int total, count(*) FILTER (WHERE ${QUALITY_SQL})::int quality FROM backlink_sources GROUP BY kind`)).rows;
  const statuses = (await db().query(`SELECT status, count(*)::int n FROM backlink_sources GROUP BY status`)).rows;
  const tiers = (await db().query(`SELECT coalesce(tier, 'none') tier, count(*)::int n FROM backlink_sources GROUP BY 1`)).rows;
  const q = (await db().query(`SELECT count(*)::int total, count(last_run_at)::int run, count(*) FILTER (WHERE last_run_at IS NULL)::int due, max(last_run_at) last FROM backlink_queries`)).rows[0] ?? {};
  const byKind = Object.fromEntries(BACKLINK_KINDS.map((k) => [k, { total: 0, quality: 0 }])) as BacklinkSummary["byKind"];
  for (const r of kinds) if (r.kind in byKind) byKind[r.kind as BacklinkKind] = { total: r.total, quality: r.quality };
  const byStatus = Object.fromEntries(BACKLINK_STATUSES.map((s) => [s, 0])) as BacklinkSummary["byStatus"];
  for (const r of statuses) if (r.status in byStatus) byStatus[r.status as BacklinkStatus] = r.n;
  const byTier = Object.fromEntries([...BACKLINK_TIERS, "none"].map((t) => [t, 0])) as BacklinkSummary["byTier"];
  for (const r of tiers) if (r.tier in byTier) byTier[r.tier as keyof typeof byTier] = r.n;
  return {
    total: Object.values(byKind).reduce((a, b) => a + b.total, 0),
    quality: Object.values(byKind).reduce((a, b) => a + b.quality, 0),
    goal: BACKLINK_GOAL, byKind, byStatus, byTier,
    queries: { total: q.total ?? 0, run: q.run ?? 0, due: q.due ?? 0 },
    spend: { month: monthKey(), usd: Math.round((await monthSpend()) * 100) / 100, capUsd },
    config,
    lastRunAt: q.last?.toISOString?.() ?? q.last ?? null,
  };
}

// ── Admin writes ────────────────────────────────────────────────────────────

export async function setStatus(id: number, status: BacklinkStatus, by: number, patch: { priceUsd?: number | null; turnaroundDays?: number | null; notes?: string | null } = {}): Promise<boolean> {
  const r = await db().query(
    `UPDATE backlink_sources SET status = $2,
            price_usd = CASE WHEN $3::boolean THEN $4::numeric ELSE price_usd END, turnaround_days = CASE WHEN $5::boolean THEN $6::integer ELSE turnaround_days END,
            notes = CASE WHEN $7::boolean THEN $8::text ELSE notes END, updated_at = now() WHERE id = $1`,
    [id, status, patch.priceUsd !== undefined, patch.priceUsd ?? null, patch.turnaroundDays !== undefined, patch.turnaroundDays ?? null, patch.notes !== undefined, patch.notes ?? null]);
  if (!r.rowCount) return false;
  await event(id, "status", { status, by, ...patch });
  if (status === "do_not_contact") {
    const d = (await db().query(`SELECT domain FROM backlink_sources WHERE id = $1`, [id])).rows[0]?.domain;
    if (d) await suppress(d, "admin: do not contact");
  }
  return true;
}

/** Send a source back through vetting (an admin's "Re-check"). */
export async function requeue(id: number): Promise<boolean> {
  const r = await db().query(`UPDATE backlink_sources SET status = 'discovered', tier = NULL, score = NULL, attempts = 0, lease_token = NULL, lease_until = NULL, updated_at = now() WHERE id = $1 AND status <> 'vetting'`, [id]);
  if (r.rowCount) await event(id, "requeued");
  return !!r.rowCount;
}

// ── Outreach ────────────────────────────────────────────────────────────────

const toOutreach = (x: any): BacklinkOutreach => ({
  id: x.id, sourceId: x.source_id, status: x.status, toEmail: x.to_email, subject: x.subject, body: x.body,
  createdAt: x.created_at?.toISOString?.() ?? x.created_at, approvedAt: x.approved_at?.toISOString?.() ?? x.approved_at ?? null, sentAt: x.sent_at?.toISOString?.() ?? x.sent_at ?? null,
});

export async function suppress(value: string, reason: string) {
  await db().query(`INSERT INTO backlink_suppression (value, reason) VALUES ($1, $2) ON CONFLICT (value) DO NOTHING`, [value.toLowerCase(), reason]);
}
export async function isSuppressed(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  const domain = e.split("@")[1] ?? "";
  const r = await db().query(`SELECT 1 FROM backlink_suppression WHERE value = ANY($1) LIMIT 1`, [[e, domain]]);
  return !!r.rows[0];
}

/** Free mailboxes many unrelated sites share: an address there says nothing about the company behind it. */
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|proton|protonmail|pm|gmx|zoho|mail|yandex)\.[a-z.]+$/i;
/** The company part of an address (editor@news.example.com → news.example.com), or null for a free mailbox. */
export function companyDomain(email: string): string | null {
  const d = email.toLowerCase().split("@")[1]?.trim() ?? "";
  return d && !FREEMAIL.test(d) ? d : null;
}

/**
 * Why this address or site must not get a pitch, or null (owner 2026-10-25: "make sure duplicates don't get emailed
 * out"). One pitch per address and per company domain, ever, and none to anyone already in a media@ conversation or
 * to a site that is already a Partnerships company. `when` is "draft" (any earlier pitch blocks), or "approve"/"send"
 * (another pitch that was approved or sent blocks; `exceptId` is the pitch being approved or sent).
 */
export async function pitchConflict(toEmail: string, siteDomain: string, when: "draft" | "approve" | "send", exceptId = 0): Promise<string | null> {
  const e = toEmail.toLowerCase().trim();
  const company = companyDomain(e);
  const live = when === "draft" ? ["draft", "approved", "sent"] : ["approved", "sent"];
  const pitched = await db().query(
    `SELECT id, to_email FROM backlink_outreach WHERE id <> $1 AND status = ANY($2)
       AND (lower(to_email) = $3 OR ($4::text IS NOT NULL AND split_part(lower(to_email), '@', 2) = $4)) ORDER BY id LIMIT 1`,
    [exceptId, live, e, company]);
  if (pitched.rows[0]) return `Already pitched ${pitched.rows[0].to_email} (pitch #${pitched.rows[0].id})`;
  // Partnerships (media@) lives in the same database in production; skipped where its tables don't exist.
  const media = (await db().query(`SELECT to_regclass('media_messages') IS NOT NULL AS m, to_regclass('media_partners') IS NOT NULL AS p`)).rows[0];
  if (media?.m) {
    const r = await db().query(`SELECT 1 FROM media_messages WHERE direction = 'out' AND lower(to_email) = $1 LIMIT 1`, [e]);
    if (r.rows[0]) return `${e} is already in a Partnerships conversation`;
  }
  if (media?.p) {
    const r = await db().query(`SELECT company FROM media_partners WHERE lower(domain) = ANY($1) LIMIT 1`, [[siteDomain.toLowerCase(), company].filter(Boolean)]);
    if (r.rows[0]) return `${r.rows[0].company} is already a Partnerships company`;
  }
  return null;
}

/** Hold a pitch that would duplicate another one: it is never sent. */
export async function markDuplicate(id: number, sourceId: number, reason: string) {
  await db().query(`UPDATE backlink_outreach SET status = 'duplicate' WHERE id = $1 AND status IN ('draft','approved')`, [id]);
  await event(sourceId, "outreach_duplicate", { reason });
}

export async function saveDraft(sourceId: number, toEmail: string, subject: string, body: string): Promise<BacklinkOutreach> {
  const r = await db().query(
    `INSERT INTO backlink_outreach (source_id, to_email, subject, body) VALUES ($1, $2, $3, $4) RETURNING *`, [sourceId, toEmail, subject, body]);
  await event(sourceId, "outreach_drafted", { to: toEmail });
  return toOutreach(r.rows[0]);
}

export async function approveDraft(id: number, by: number): Promise<BacklinkOutreach | { duplicate: string } | null> {
  const d = (await db().query(`SELECT o.id, o.source_id, o.to_email, s.domain FROM backlink_outreach o JOIN backlink_sources s ON s.id = o.source_id WHERE o.id = $1 AND o.status = 'draft'`, [id])).rows[0];
  if (!d) return null;
  const clash = await pitchConflict(d.to_email, d.domain, "approve", id);
  if (clash) { await markDuplicate(id, d.source_id, clash); return { duplicate: clash }; }
  const r = await db().query(`UPDATE backlink_outreach SET status = 'approved', approved_at = now(), approved_by = $2 WHERE id = $1 AND status = 'draft' RETURNING *`, [id, by]);
  if (!r.rows[0]) return null;
  await event(r.rows[0].source_id, "outreach_approved", { by });
  return toOutreach(r.rows[0]);
}

/** Qualified sources with a published email and no pitch yet — what the drafter works through. */
export async function needingDraft(limit: number): Promise<{ id: number; domain: string; kind: BacklinkKind; emails: string[]; signals: BacklinkSignals }[]> {
  const r = await db().query(
    `SELECT s.id, s.domain, s.kind, s.contact_emails emails, s.signals FROM backlink_sources s
      WHERE s.status = 'qualified' AND s.tier IN ('A','B') AND s.kind <> 'pbn' AND cardinality(s.contact_emails) > 0
        AND NOT EXISTS (SELECT 1 FROM backlink_outreach o WHERE o.source_id = s.id)
      ORDER BY s.score DESC NULLS LAST, s.id LIMIT $1`, [limit]);
  return r.rows;
}
