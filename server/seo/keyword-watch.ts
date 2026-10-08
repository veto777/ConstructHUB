/**
 * Keyword watch: once a month, a snapshot of the searches the SEARCH DATA has a site ranking for (its
 * KW_SNAPSHOT_ROWS highest-traffic ones, in the country it is tracked in), compared with the snapshot before.
 * Off until the customer turns it on; the monthly snapshot spends only the month's included data.
 *
 * What it can and cannot say. The source is a database of searches it measures, not Google itself: a search that
 * appears in a snapshot is one the source newly SEES the site ranking for, and one that is gone is one it no longer
 * sees — the site may have ranked before the source looked, and may still rank where the source no longer looks.
 * So the words are always "newly seen" and "no longer seen", never "started ranking" or "lost". On top of that, a
 * comparison is only like for like when both snapshots hold everything the source has for the site ("whole");
 * when either was cut at the limit, a search has only entered or left the site's top keywords by traffic ("top"),
 * and when the source did not say how many there are, that is not known ("unknown"). Alerts are sent on "whole" only.
 *
 * One snapshot a day at most, and it is never rewritten: asking again the same day returns the one there is, so an
 * alert already sent for that day always matches the snapshot it was raised from.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, taskItems, type DfsTask } from "./dataforseo";
import { withBudget, SeoBudgetError } from "./budget";
import { estimateLabsUsd } from "./pricing";
import { saveAlert, deliverAlert } from "./alerts";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { recordFailure } from "../ops/issues";
import { SeoCustomerError } from "./public-errors";

export const KW_SNAPSHOT_ROWS = 300;
export const KW_SNAPSHOT_ESTIMATE_USD = estimateLabsUsd(KW_SNAPSHOT_ROWS);
/** A newly seen keyword is worth an alert when it is on the first two pages; one no longer seen when it was on the first. */
export const KW_ALERT_NEW_WITHIN = 20, KW_ALERT_LOST_WITHIN = 10;
export const keywordWatchDeps = { request, entitled: async (userId: number) => seoIncluded(await getEntitlements(userId)) };
export const watchSetting = z.object({ watch: z.boolean() }).strict();
export class KeywordWatchBusy extends SeoCustomerError { constructor() { super("A snapshot of this site is being taken right now. It will be here in a moment.", 409); } }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export type SnapshotKeyword = { keyword: string; position: number | null; volume: number | null; /** Estimated visits a month. */ traffic: number | null; /** The ranking page's path. */ path: string | null };
export type KeywordSnapshot = {
  id: number; takenOn: string; locationCode: number; languageCode: string;
  /** How many keywords the source has for the site in all; null = it did not say. */ total: number | null;
  /** Rows the source returned, before the same keyword written two ways was folded into one; null on snapshots saved before this was recorded. */ fetched: number | null;
  keywords: SnapshotKeyword[];
};
/**
 * Does the snapshot hold everything the source has for the site? true / false, or null when the source did not say
 * how many there are. Judged on the rows RETURNED (not the distinct keywords kept), so folding two spellings of a
 * keyword together does not make a whole snapshot look cut.
 */
export const coverage = (s: { total: number | null; fetched?: number | null; keywords: unknown[] }): boolean | null => (s.total === null ? null : s.total <= (s.fetched ?? s.keywords.length));

/** Pure: one row of the source's answer. */
export function parseSnapshotKeyword(item: any): SnapshotKeyword | null {
  const kd = item?.keyword_data, keyword = typeof kd?.keyword === "string" ? kd.keyword.trim().toLowerCase() : "";
  if (!keyword) return null;
  const serp = item?.ranked_serp_element?.serp_item ?? {};
  const etv = num(serp.etv);
  return { keyword, position: num(serp.rank_group) ?? num(serp.rank_absolute), volume: num(kd?.keyword_info?.search_volume), traffic: etv === null ? null : Math.round(etv * 10) / 10, path: typeof serp.relative_url === "string" ? serp.relative_url.slice(0, 300) : null };
}
export async function fetchKeywordSnapshot(input: { domain: string; locationCode: number; languageCode: string }): Promise<{ data: { total: number | null; fetched: number; keywords: SnapshotKeyword[] }; costUsd: number }> {
  const task: DfsTask = assertOk(await keywordWatchDeps.request("POST", "/dataforseo_labs/google/ranked_keywords/live", [{
    target: input.domain, location_code: input.locationCode, language_code: input.languageCode, item_types: ["organic"], limit: KW_SNAPSHOT_ROWS, order_by: ["ranked_serp_element.serp_item.etv,desc"],
  }]), { treatNoResultsAsEmpty: true });
  const items = taskItems(task), seen = new Set<string>(), keywords: SnapshotKeyword[] = [];
  for (const i of items) { const k = parseSnapshotKeyword(i); if (k && !seen.has(k.keyword)) { seen.add(k.keyword); keywords.push(k); } }
  return { data: { total: num((task.result?.[0] as any)?.total_count), fetched: items.length, keywords }, costUsd: typeof task.cost === "number" ? task.cost : 0 };
}

export type KeywordChange = SnapshotKeyword & { /** No-longer-seen keywords: where it stood before. */ was?: number | null };
export type KeywordComparison = {
  since: string; takenOn: string; locationCode: number; languageCode: string;
  /**
   * "whole": both snapshots hold everything the source has, so `added` are searches it newly sees the site ranking
   * for and `gone` ones it no longer sees. "top": at least one was cut at the limit — they only entered or left the
   * site's highest-traffic keywords. "unknown": the source did not say how many there are for one of them.
   * "none": not comparable (another country or language) — both lists are empty.
   */
  basis: "whole" | "top" | "unknown" | "none";
  /** Every change, never cut short (a snapshot holds KW_SNAPSHOT_ROWS at most): ordered by traffic (added) and by the position held (gone). */
  added: KeywordChange[]; gone: KeywordChange[];
  now: { keywords: number; total: number | null }; before: { keywords: number; total: number | null };
  /**
   * By the site's page each keyword ranks with: keywords and estimated visits in each snapshot, and why the count moved
   * (newly seen / no longer seen, or a keyword seen in both that the data now has ranking with another page). Visits add
   * up only the keywords whose estimate is known (`unknown` says how many were not). Biggest change in visits first.
   * Empty when the snapshots are not comparable. Within the snapshots' own limits (see `basis`).
   */
  pages: PageChange[];
};
export type PageSide = { keywords: number; visits: number; unknown: number };
export type PageChange = { path: string | null; before: PageSide; after: PageSide; added: number; gone: number; movedIn: number; movedOut: number };
/** One spelling of a page's path for comparing: no trailing slash (but "/"), no fragment; the query kept. Pure. */
export const pageKey = (path: string | null): string | null => {
  if (path === null || path === undefined) return null;
  const p = String(path).replace(/#.*$/, ""), [base, ...q] = p.split("?");
  return `${base.replace(/\/+$/, "") || "/"}${q.length ? `?${q.join("?")}` : ""}`;
};
/** Pure: keywords grouped by page in two snapshots of the same market. */
export function pagesChanged(now: SnapshotKeyword[], before: SnapshotKeyword[]): PageChange[] {
  const pages = new Map<string, PageChange>();
  const side = (): PageSide => ({ keywords: 0, visits: 0, unknown: 0 });
  const at = (path: string | null) => { const k = pageKey(path) ?? "\u0000"; return pages.get(k) ?? pages.set(k, { path: pageKey(path), before: side(), after: side(), added: 0, gone: 0, movedIn: 0, movedOut: 0 }).get(k)!; };
  const add = (x: PageSide, k: SnapshotKeyword) => { x.keywords++; if (k.traffic === null) x.unknown++; else x.visits += k.traffic; };
  const was = new Map(before.map((k) => [k.keyword, k] as const)), is = new Map(now.map((k) => [k.keyword, k] as const));
  for (const k of before) { const pg = at(k.path); add(pg.before, k); const n = is.get(k.keyword); if (!n) pg.gone++; else if (pageKey(n.path) !== pageKey(k.path)) pg.movedOut++; }
  for (const k of now) { const pg = at(k.path); add(pg.after, k); const b = was.get(k.keyword); if (!b) pg.added++; else if (pageKey(b.path) !== pageKey(k.path)) pg.movedIn++; }
  const round = (x: PageSide) => ({ ...x, visits: Math.round(x.visits * 10) / 10 });
  return [...pages.values()].map((p) => ({ ...p, before: round(p.before), after: round(p.after) }))
    .sort((a, b) => Math.abs(b.after.visits - b.before.visits) - Math.abs(a.after.visits - a.before.visits) || Math.abs(b.after.keywords - b.before.keywords) - Math.abs(a.after.keywords - a.before.keywords) || String(a.path).localeCompare(String(b.path)));
}
/** Pure. */
export function compareKeywordSnapshots(now: KeywordSnapshot, before: KeywordSnapshot): KeywordComparison {
  const head = { since: before.takenOn, takenOn: now.takenOn, locationCode: now.locationCode, languageCode: now.languageCode, now: { keywords: now.keywords.length, total: now.total }, before: { keywords: before.keywords.length, total: before.total } };
  if (now.locationCode !== before.locationCode || now.languageCode !== before.languageCode) return { ...head, basis: "none", added: [], gone: [], pages: [] };
  const was = new Map(before.keywords.map((k) => [k.keyword, k] as const)), is = new Set(now.keywords.map((k) => k.keyword));
  const added = now.keywords.filter((k) => !was.has(k.keyword)).sort((a, b) => (b.traffic ?? -1) - (a.traffic ?? -1) || (a.position ?? 999) - (b.position ?? 999) || (a.keyword < b.keyword ? -1 : 1));
  const gone = before.keywords.filter((k) => !is.has(k.keyword)).map((k) => ({ ...k, was: k.position })).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || (b.volume ?? -1) - (a.volume ?? -1) || (a.keyword < b.keyword ? -1 : 1));
  const a = coverage(now), b = coverage(before);
  return { ...head, basis: a === null || b === null ? "unknown" : a && b ? "whole" : "top", added, gone, pages: pagesChanged(now.keywords, before.keywords) };
}
/** Which changes are worth an alert — from the whole lists, and only when both snapshots hold everything the source has. Pure. */
export function keywordAlerts(c: KeywordComparison): { added: KeywordChange[]; gone: KeywordChange[] } {
  if (c.basis !== "whole") return { added: [], gone: [] };
  return { added: c.added.filter((k) => k.position !== null && k.position <= KW_ALERT_NEW_WITHIN), gone: c.gone.filter((k) => k.was != null && k.was <= KW_ALERT_LOST_WITHIN) };
}

// ── Saved snapshots ─────────────────────────────────────────────────────────

export const KEYWORD_WATCH_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_keyword_snapshots (
     id serial PRIMARY KEY,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     user_id integer NOT NULL,
     taken_on date NOT NULL DEFAULT current_date,
     location_code integer NOT NULL,
     language_code text NOT NULL,
     keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
     total integer,
     cost_usd numeric NOT NULL DEFAULT 0,
     alerts_done boolean NOT NULL DEFAULT false,
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (site_id, taken_on)
   )`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS kw_watch boolean NOT NULL DEFAULT false`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS next_kw_snapshot_at timestamptz`,
  // Rows the source returned (before duplicates were folded), and when the alerts of a snapshot were last tried.
  `ALTER TABLE seo_keyword_snapshots ADD COLUMN IF NOT EXISTS fetched integer`,
  `ALTER TABLE seo_keyword_snapshots ADD COLUMN IF NOT EXISTS alerts_tried_at timestamptz`,
  // One snapshot being taken per site, whoever asked (the customer or the schedule, on any server process).
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS kw_snapshot_claim timestamptz`,
  // Whose claim it is: only its owner may save under it or give it back.
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS kw_snapshot_claim_token text`,
];
/**
 * Alerts gain two kinds. Run AFTER seo_alerts and the grid's own change to the same rule exist (last in
 * SEO_SCHEMA_DDL). The lock is taken before looking, so two servers starting together cannot both change the rule;
 * the rule is replaced by the full list of kinds, so running it again — or after the grid's step — changes nothing.
 */
export const KEYWORD_WATCH_ALERT_DDL = [
  `DO $$ BEGIN
     LOCK TABLE seo_alerts IN SHARE ROW EXCLUSIVE MODE;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'seo_alerts'::regclass AND conname = 'seo_alerts_kind_check' AND pg_get_constraintdef(oid) LIKE '%kw_new%') THEN
       ALTER TABLE seo_alerts DROP CONSTRAINT IF EXISTS seo_alerts_kind_check;
       ALTER TABLE seo_alerts ADD CONSTRAINT seo_alerts_kind_check CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained','grid_down','grid_up','kw_new','kw_lost'));
     END IF;
   END $$`,
];
const COLS = `id, taken_on::text AS taken_on, location_code, language_code, total, fetched, keywords`;
const toSnapshot = (r: any): KeywordSnapshot => ({ id: r.id, takenOn: String(r.taken_on).slice(0, 10), locationCode: r.location_code, languageCode: r.language_code, total: r.total ?? null, fetched: r.fetched ?? null, keywords: Array.isArray(r.keywords) ? r.keywords : [] });
/** The two newest snapshots of a site (newest first), or fewer. */
export async function latestSnapshots(userId: number, siteId: number, upTo?: string): Promise<KeywordSnapshot[]> {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM seo_keyword_snapshots WHERE site_id=$1 AND user_id=$2 AND ($3::date IS NULL OR taken_on <= $3::date) ORDER BY taken_on DESC LIMIT 2`, [siteId, userId, upTo ?? null]);
  return rows.map(toSnapshot);
}

type WatchSite = { id: number; user_id: number; domain: string; location_code: number; language_code: string };
/** Longer than a snapshot can take (one request to the source, a minute at most, plus saving), so a live owner is not displaced. */
const CLAIM_MINUTES = 10;
/**
 * Take the day's snapshot — or return it, if there already is one (`reused`, nothing bought: one snapshot a day, never
 * rewritten). Days are the database's, which runs in UTC; the day is read ONCE and used for the look-up and the save
 * alike, so an operation that crosses midnight cannot look at one day and save into another.
 *
 * One at a time per site, by a claim in the DATABASE that the customer's request and the schedule share. The claim
 * carries its owner's token: it is checked again just before the source is asked and again in the transaction that
 * saves, and only its owner can give it back — an owner whose claim ran out and was taken over buys nothing, saves
 * nothing and cannot release the new owner's claim.
 *
 * Saved inside the charged call (SAVED FIRST, CHARGED SECOND). The monthly one (`lease` given) spends only the
 * month's included data and is taken only if, when its turn comes, the watch is still on AND the site's next date is
 * still the one the scheduler leased — a snapshot taken by hand meanwhile moves that date, and the monthly one stands down.
 */
export async function takeKeywordSnapshot(site: WatchSite, automatic: boolean, lease?: string): Promise<{ id: number; takenOn: string; keywords: number; reused: boolean }> {
  const token = randomUUID();
  const { rows: [claim] } = await pool.query(
    `UPDATE seo_sites SET kw_snapshot_claim = now(), kw_snapshot_claim_token = $3 WHERE id=$1 AND user_id=$2 AND (kw_snapshot_claim IS NULL OR kw_snapshot_claim < now() - interval '${CLAIM_MINUTES} minutes')
     RETURNING current_date::text AS today`, [site.id, site.user_id, token]);
  if (!claim) throw new KeywordWatchBusy();
  const day = String(claim.today).slice(0, 10);
  const mine = async (db: { query: typeof pool.query } = pool) => ((await db.query("SELECT 1 FROM seo_sites WHERE id=$1 AND kw_snapshot_claim_token=$2", [site.id, token])).rowCount ?? 0) > 0;
  const standDown = { id: 0, takenOn: "", keywords: 0, reused: true };
  try {
    const { rows: [today] } = await pool.query("SELECT id, taken_on::text AS taken_on, jsonb_array_length(keywords) AS n FROM seo_keyword_snapshots WHERE site_id=$1 AND user_id=$2 AND taken_on = $3::date", [site.id, site.user_id, day]);
    if (today) {
      // Already taken this day: the watch's month runs from it, and nothing is bought. The date is moved only by the
      // claim's owner — and, for the monthly occurrence, only while the date is still the one it leased.
      await pool.query(
        `UPDATE seo_sites SET next_kw_snapshot_at = $2::date + interval '1 month'
          WHERE id=$1 AND kw_watch AND kw_snapshot_claim_token=$3 AND ($4::text IS NULL OR next_kw_snapshot_at::text = $4::text)
            AND (next_kw_snapshot_at IS NULL OR next_kw_snapshot_at < $2::date + interval '1 month')`, [site.id, day, token, automatic ? (lease ?? null) : null]);
      return { id: today.id, takenOn: String(today.taken_on).slice(0, 10), keywords: today.n, reused: true };
    }
    if (automatic) {
      // Looked at again now that it is this site's turn: switched off meanwhile, or its date moved (someone took a
      // snapshot by hand, or another pass leased it again), means this occurrence is no longer the one to run.
      const { rows: [s] } = await pool.query("SELECT kw_watch, next_kw_snapshot_at::text AS next, location_code, language_code FROM seo_sites WHERE id=$1", [site.id]);
      if (!s?.kw_watch || (lease !== undefined && s.next !== lease)) return standDown;
      site = { ...site, location_code: s.location_code, language_code: s.language_code };
    }
    const out = await withBudget(site.user_id, KW_SNAPSHOT_ESTIMATE_USD, async () => {
      // Still the owner? (Reserving the budget can wait on the database.) If not, nothing is asked of the source.
      if (!(await mine())) throw Object.assign(new KeywordWatchBusy(), { costUsd: 0, costUnknown: false });
      const o = await fetchKeywordSnapshot({ domain: site.domain, locationCode: site.location_code ?? 2840, languageCode: site.language_code ?? "en" });
      const fail = (why: string) => Object.assign(new Error(`keyword snapshot for ${site.domain} could not be saved: ${why}`), { costUsd: o.costUsd, costUnknown: false, notSaved: true });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // The site's row is locked for the save: either this is still the owner, or nothing is written.
        const { rowCount: owner } = await client.query("SELECT 1 FROM seo_sites WHERE id=$1 AND kw_snapshot_claim_token=$2 FOR UPDATE", [site.id, token]);
        if (!owner) { await client.query("ROLLBACK"); throw fail("the claim on the site was taken over while the source answered"); }
        const { rows: [row] } = await client.query(
          `INSERT INTO seo_keyword_snapshots(site_id, user_id, taken_on, location_code, language_code, keywords, total, fetched, cost_usd) VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (site_id, taken_on) DO NOTHING RETURNING id, taken_on::text AS taken_on`,
          [site.id, site.user_id, day, site.location_code ?? 2840, site.language_code ?? "en", JSON.stringify(o.data.keywords), o.data.total, o.data.fetched, o.costUsd]);
        if (!row) { await client.query("ROLLBACK"); throw fail("the day's snapshot already exists"); }
        // The watch's month starts again from this snapshot — for the monthly occurrence only while the date is still
        // the one it leased (the row is locked and this is the claim's owner, so nothing can move it in between).
        await client.query(
          "UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 month' WHERE id=$1 AND kw_watch AND kw_snapshot_claim_token=$2 AND ($3::text IS NULL OR next_kw_snapshot_at::text = $3::text)",
          [site.id, token, automatic ? (lease ?? null) : null]);
        await client.query("COMMIT");
        return { data: { id: row.id as number, takenOn: String(row.taken_on).slice(0, 10), keywords: o.data.keywords.length, reused: false }, costUsd: o.costUsd, costUnknown: false };
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        throw e?.notSaved ? e : fail(e?.message ?? String(e));
      } finally { client.release(); }
    }, { allowanceOnly: automatic, label: `Keyword snapshot — ${site.domain} (${automatic ? "monthly" : "now"})` });
    await settleKeywordAlerts(site.id).catch((e) => console.error(`[seo] keyword alerts for site ${site.id} failed (they will be tried again): ${e?.message ?? e}`));
    return out.data;
  } finally {
    // Only the owner gives the claim back: a claim that ran out and was taken over belongs to someone else now.
    await pool.query("UPDATE seo_sites SET kw_snapshot_claim = NULL, kw_snapshot_claim_token = NULL WHERE id=$1 AND kw_snapshot_claim_token=$2", [site.id, token]).catch(() => {});
  }
}

const searches = (n: number) => `${n} search${n === 1 ? "" : "es"}`;
/**
 * Raise the alerts each unsettled snapshot calls for — each compared with the snapshot before IT, oldest first — and
 * mark it dealt with. A snapshot is never rewritten, so what is judged is what was saved. One snapshot failing does
 * not stop the others; it is stamped as tried, so the ones tried longest ago come first next time. A site whose
 * alerts are switched off gets none (the snapshots are still settled, so switching alerts on later does not send old news).
 */
export async function settleKeywordAlerts(siteId: number): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE seo_keyword_snapshots x SET alerts_tried_at = now() FROM seo_sites s
      WHERE x.site_id=$1 AND x.alerts_done = false AND s.id = x.site_id
      RETURNING x.id, x.user_id, x.taken_on::text AS taken_on, s.domain, s.alerts_enabled`, [siteId]);
  let raised = 0;
  for (const snap of rows.sort((a: any, b: any) => String(a.taken_on).localeCompare(String(b.taken_on)))) {
    try {
      const [now, before] = await latestSnapshots(snap.user_id, siteId, snap.taken_on);
      if (snap.alerts_enabled !== false && now && before && now.id === snap.id) {
        const c = compareKeywordSnapshots(now, before), a = keywordAlerts(c);
        // What the alert keeps: the first fifty, how many more there were, and exactly which two snapshots and which
        // country it compared — so an old alert still says what it was about after newer snapshots or a change of country.
        const item = (list: KeywordChange[]) => [{ since: c.since, takenOn: c.takenOn, snapshotId: now.id, beforeId: before.id, locationCode: c.locationCode, languageCode: c.languageCode, keywords: list.slice(0, 50), more: Math.max(0, list.length - 50) }];
        if (a.added.length) { const id = await saveAlert(snap.user_id, siteId, "kw_new", now.takenOn, `${searches(a.added.length)} newly seen in the top ${KW_ALERT_NEW_WITHIN} for ${snap.domain}`, item(a.added)); if (id) { await deliverAlert(id); raised++; } }
        if (a.gone.length) { const id = await saveAlert(snap.user_id, siteId, "kw_lost", now.takenOn, `${searches(a.gone.length)} no longer seen for ${snap.domain} (it was in the top ${KW_ALERT_LOST_WITHIN})`, item(a.gone)); if (id) { await deliverAlert(id); raised++; } }
      }
      await pool.query("UPDATE seo_keyword_snapshots SET alerts_done = true WHERE id=$1", [snap.id]);
    } catch (e: any) { console.error(`[seo] keyword alerts for site ${siteId} (snapshot of ${snap.taken_on}) failed (they will be tried again): ${e?.message ?? e}`); }
  }
  return raised;
}

export async function setKeywordWatch(userId: number, siteId: number, watch: boolean): Promise<void> {
  // Turned on: a month after the newest snapshot — or at once when there is none (the scheduler takes it from the
  // month's included data). A snapshot taken today is not bought again tomorrow just because the watch was switched on.
  await pool.query(
    `UPDATE seo_sites s SET kw_watch=$3, next_kw_snapshot_at = CASE WHEN $3 THEN
         coalesce(s.next_kw_snapshot_at, greatest(now(), (SELECT max(x.taken_on) + interval '1 month' FROM seo_keyword_snapshots x WHERE x.site_id=s.id)), now())
       ELSE NULL END
      WHERE s.id=$1 AND s.user_id=$2`, [siteId, userId, watch]);
}

/** One scheduler pass: owed alerts first (longest-waiting first), then the snapshots that are due. Leased for six hours; never bought twice. */
export async function runDueKeywordSnapshots(): Promise<number> {
  const { rows: owed } = await pool.query(
    "SELECT site_id FROM seo_keyword_snapshots WHERE alerts_done = false GROUP BY site_id ORDER BY min(alerts_tried_at) NULLS FIRST, site_id LIMIT 20").catch(() => ({ rows: [] as any[] }));
  for (const o of owed) await settleKeywordAlerts(o.site_id).catch((e) => console.error(`[seo] keyword alerts for site ${o.site_id} failed: ${e?.message ?? e}`));
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '6 hours' WHERE kw_watch AND next_kw_snapshot_at <= now() RETURNING id, user_id, domain, location_code, language_code, next_kw_snapshot_at::text AS lease`);
  let done = 0;
  for (const site of due) {
    try {
      // Every date this pass writes is written only while the site's date is still the one it leased: a snapshot taken
      // by hand meanwhile, or a newer pass, has moved it, and then it is theirs.
      if (!(await keywordWatchDeps.entitled(site.user_id))) { await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 day' WHERE id=$1 AND kw_watch AND next_kw_snapshot_at::text = $2", [site.id, site.lease]); continue; }
      const out = await takeKeywordSnapshot(site, true, site.lease);
      if (!out.reused) done++;
    } catch (e: any) {
      if (e instanceof KeywordWatchBusy) continue;   // the customer is taking one right now; the lease brings this site back later
      if (e instanceof SeoBudgetError) {
        // Out of included data: nothing more is likely today.
        console.warn(`[seo] keyword snapshot for ${site.domain} skipped: ${e.message}`);
        await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 day' WHERE id=$1 AND kw_watch AND next_kw_snapshot_at::text = $2", [site.id, site.lease]).catch(() => {});
      } else void recordFailure("job", "SEO keyword snapshot", e);
    }
  }
  return done;
}

/** Snapshots listed for choosing a comparison (newest first). */
export const KW_HISTORY_LIMIT = 36;
export type SnapshotSummary = { id: number; takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string };
/** ?now=&before= on the view: two snapshot ids to compare instead of the newest two. */
const snapshotId = z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647));
export const comparePick = z.object({ now: snapshotId, before: snapshotId }).strict();
export type KeywordWatchView = {
  watch: boolean; nextAt: string | null; rows: number; alertsOn: boolean;
  latest: { takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string; today: boolean } | null;
  /** When the day changes for snapshots (the next midnight UTC): after it a new one can be taken. */
  nextDayAt: string;
  /** false = the newest snapshot was taken for another country or language than the site is tracked in now. */
  sameMarket: boolean;
  comparison: KeywordComparison | null;
  /** Which two snapshots `comparison` is (the newest two unless others were asked for). */
  pair: { nowId: number; beforeId: number; chosen: boolean; /** The two snapshots themselves — also when they are older than the listed ones. */ now: SnapshotSummary; before: SnapshotSummary } | null;
  /** The site's snapshots, newest first, up to KW_HISTORY_LIMIT, and how many there are in all. */
  snapshots: SnapshotSummary[]; snapshotCount: number;
};
export async function keywordWatchView(userId: number, site: { id: number; kw_watch?: boolean; next_kw_snapshot_at?: unknown; location_code?: number; language_code?: string; alerts_enabled?: boolean }, pick?: z.infer<typeof comparePick>): Promise<KeywordWatchView> {
  const [now, before] = await latestSnapshots(userId, site.id);
  // Two chosen snapshots: both this site's and this account's, the "now" one the later of the two.
  let chosen: [KeywordSnapshot, KeywordSnapshot] | null = null;
  if (pick) {
    if (pick.now === pick.before) throw new SeoCustomerError("Choose two different snapshots to compare.", 400);
    const { rows } = await pool.query(`SELECT ${COLS} FROM seo_keyword_snapshots WHERE site_id=$1 AND user_id=$2 AND id = ANY($3::int[])`, [site.id, userId, [pick.now, pick.before]]);
    const a = rows.find((r: any) => r.id === pick.now), b = rows.find((r: any) => r.id === pick.before);
    if (!a || !b) throw new SeoCustomerError("That snapshot is not on record for this site.", 404);
    const x = toSnapshot(a), y = toSnapshot(b);
    if (x.takenOn <= y.takenOn) throw new SeoCustomerError("Compare a snapshot with an earlier one.", 400);
    chosen = [x, y];
  }
  const { rows: list } = await pool.query(
    `SELECT id, taken_on::text AS taken_on, location_code, language_code, total, fetched, jsonb_array_length(keywords) AS n, count(*) OVER () AS all_count
       FROM seo_keyword_snapshots WHERE site_id=$1 AND user_id=$2 ORDER BY taken_on DESC LIMIT ${KW_HISTORY_LIMIT}`, [site.id, userId]);
  const snapshots: SnapshotSummary[] = list.map((r: any) => ({ id: r.id, takenOn: String(r.taken_on).slice(0, 10), keywords: r.n, total: r.total ?? null, whole: coverage({ total: r.total ?? null, fetched: r.fetched ?? null, keywords: { length: r.n } as unknown[] }), locationCode: r.location_code, languageCode: r.language_code }));
  const [cNow, cBefore] = chosen ?? [now, before];
  const summary = (x: KeywordSnapshot): SnapshotSummary => ({ id: x.id, takenOn: x.takenOn, keywords: x.keywords.length, total: x.total, whole: coverage(x), locationCode: x.locationCode, languageCode: x.languageCode });
  const { rows: [d] } = await pool.query("SELECT current_date::text AS today, ((current_date + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))::timestamptz AS next");
  return {
    watch: !!site.kw_watch, nextAt: site.kw_watch && site.next_kw_snapshot_at ? new Date(site.next_kw_snapshot_at as string).toISOString() : null, rows: KW_SNAPSHOT_ROWS, alertsOn: site.alerts_enabled !== false,
    latest: now ? { takenOn: now.takenOn, keywords: now.keywords.length, total: now.total, whole: coverage(now), locationCode: now.locationCode, languageCode: now.languageCode, today: now.takenOn === String(d.today).slice(0, 10) } : null,
    nextDayAt: new Date(d.next).toISOString(),
    sameMarket: !now || (now.locationCode === (site.location_code ?? 2840) && now.languageCode === (site.language_code ?? "en")),
    comparison: cNow && cBefore ? compareKeywordSnapshots(cNow, cBefore) : null,
    pair: cNow && cBefore ? { nowId: cNow.id, beforeId: cBefore.id, chosen: !!chosen, now: summary(cNow), before: summary(cBefore) } : null,
    snapshots, snapshotCount: list.length ? Number(list[0].all_count) : 0,
  };
}
