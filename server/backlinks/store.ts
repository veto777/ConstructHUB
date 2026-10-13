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
const QUALITY_SQL = `tier IN (${QUALITY_TIERS.map((t) => `'${t}'`).join(",")}) AND kind <> 'pbn'`;

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// ── Query bank ──────────────────────────────────────────────────────────────

/** Puts every bank query in the table once (new templates appear on the next boot). */
export async function seedQueries(): Promise<number> {
  const bank = buildQueryBank();
  const r = await db().query(
    `INSERT INTO backlink_queries (kind, niche, query)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT (query) DO NOTHING`,
    [bank.map((q) => q.kind), bank.map((q) => q.niche), bank.map((q) => q.query)],
  );
  return r.rowCount ?? 0;
}

export type QueryRow = { id: number; kind: BacklinkKind; niche: string; query: string };
/** Never-run queries first, then the longest-unrun, each at most once every `repeatDays`. */
export async function dueQueries(limit: number, repeatDays = 60): Promise<QueryRow[]> {
  const r = await db().query(
    `SELECT id, kind, niche, query FROM backlink_queries
      WHERE last_run_at IS NULL OR last_run_at < now() - make_interval(days => $2)
      ORDER BY last_run_at NULLS FIRST, id LIMIT $1`, [limit, repeatDays]);
  return r.rows;
}

export async function recordQueryRun(id: number, found: number, newFound: number, costUsd: number) {
  await db().query(
    `UPDATE backlink_queries SET runs = runs + 1, found = found + $2, new_found = new_found + $3, cost_usd = cost_usd + $4, last_run_at = now() WHERE id = $1`,
    [id, found, newFound, costUsd]);
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

export type VetJob = { id: number; domain: string; kind: BacklinkKind; discoveredUrl: string | null; metrics: BacklinkMetrics | null; attempts: number };

/** Lease up to `limit` sources for vetting: new ones, and ones whose vetting lease lapsed (a worker died). */
export async function claimForVetting(token: string, leaseMs: number, limit: number): Promise<VetJob[]> {
  const r = await db().query(
    `UPDATE backlink_sources s SET status = 'vetting', lease_token = $1, lease_until = now() + make_interval(secs => $2), attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM backlink_sources
         WHERE (status = 'discovered' OR (status = 'vetting' AND lease_until < now())) AND attempts < $4
         ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id, domain, kind, discovered_url, metrics, attempts`,
    [token, leaseMs / 1000, limit, MAX_VET_ATTEMPTS]);
  return r.rows.map((x) => ({ id: x.id, domain: x.domain, kind: x.kind, discoveredUrl: x.discovered_url, metrics: x.metrics, attempts: x.attempts }));
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

/** Sources worth an authority check: graded on the page, never measured (or measured over 90 days ago). */
export async function needingMetrics(limit: number): Promise<{ id: number; domain: string; kind: BacklinkKind; signals: BacklinkSignals }[]> {
  const r = await db().query(
    `SELECT id, domain, kind, signals FROM backlink_sources
      WHERE status IN ('qualified','contacted','replied','agreed','active') AND signals IS NOT NULL
        AND (metrics_at IS NULL OR metrics_at < now() - interval '90 days')
      ORDER BY metrics_at NULLS FIRST, id LIMIT $1`, [limit]);
  return r.rows;
}

/** Store measured authority and the grade it leads to (a source with outreach under way keeps its status unless it fails now). */
export async function saveMetrics(id: number, metrics: BacklinkMetrics, g: Grade) {
  await db().query(
    `UPDATE backlink_sources SET metrics = $2, metrics_at = now(), tier = $3, score = $4, reasons = $5, kind = $6,
            status = CASE WHEN $3 = 'X' THEN 'rejected' ELSE status END, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(metrics), g.tier, g.score, g.reasons, g.kind]);
  await event(id, "measured", { rank: metrics.rank, spamScore: metrics.spamScore, referringDomains: metrics.referringDomains, tier: g.tier });
}

// ── Admin reads ─────────────────────────────────────────────────────────────

const toRow = (x: any): BacklinkSourceRow => ({
  id: x.id, domain: x.domain, kind: x.kind, status: x.status, tier: x.tier, score: x.score, niches: x.niches ?? [],
  submitUrl: x.submit_url, contactEmails: x.contact_emails ?? [], linkType: x.link_type, priceUsd: x.price_usd == null ? null : Number(x.price_usd),
  discoveredVia: x.discovered_via, vettedAt: x.vetted_at?.toISOString?.() ?? x.vetted_at ?? null, updatedAt: x.updated_at?.toISOString?.() ?? x.updated_at,
  rank: x.metrics?.rank ?? null,
});

export type ListFilter = { kind?: BacklinkKind; status?: BacklinkStatus; tier?: string; q?: string; quality?: boolean; limit: number; offset: number };
export async function listSources(f: ListFilter): Promise<{ rows: BacklinkSourceRow[]; total: number }> {
  const where: string[] = [];
  const v: unknown[] = [];
  const p = (x: unknown) => (v.push(x), `$${v.length}`);
  if (f.kind) where.push(`kind = ${p(f.kind)}`);
  if (f.status) where.push(`status = ${p(f.status)}`);
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
  const r = await db().query(`UPDATE backlink_sources SET status = 'discovered', attempts = 0, lease_token = NULL, lease_until = NULL, updated_at = now() WHERE id = $1 AND status <> 'vetting'`, [id]);
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

export async function saveDraft(sourceId: number, toEmail: string, subject: string, body: string): Promise<BacklinkOutreach> {
  const r = await db().query(
    `INSERT INTO backlink_outreach (source_id, to_email, subject, body) VALUES ($1, $2, $3, $4) RETURNING *`, [sourceId, toEmail, subject, body]);
  await event(sourceId, "outreach_drafted", { to: toEmail });
  return toOutreach(r.rows[0]);
}

export async function approveDraft(id: number, by: number): Promise<BacklinkOutreach | null> {
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
