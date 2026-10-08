/**
 * Keyword watch: once a month, a snapshot of the searches a site ranks for (its KW_SNAPSHOT_ROWS highest-traffic
 * ones, in the country it is tracked in), compared with the snapshot before — which searches it has started to rank
 * for, and which it no longer ranks for. Unlike the rank tracker this is not limited to the keywords the customer
 * chose to track. Off until the customer turns it on; the monthly snapshot spends only the month's included data.
 *
 * What a comparison can honestly say depends on whether both snapshots hold EVERY keyword the site ranked for
 * (the source's total fits in the snapshot). When they do, a keyword that is in one and not the other is new or
 * gone. When either was cut at the limit, it only "entered" or "left" the site's top keywords by traffic — and that
 * is what is said.
 */
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, taskItems, type DfsTask } from "./dataforseo";
import { withBudget, SeoBudgetError } from "./budget";
import { estimateLabsUsd } from "./pricing";
import { saveAlert, deliverAlert } from "./alerts";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { recordFailure } from "../ops/issues";

export const KW_SNAPSHOT_ROWS = 300;
export const KW_SNAPSHOT_ESTIMATE_USD = estimateLabsUsd(KW_SNAPSHOT_ROWS);
/** A new keyword is worth an alert when it ranks on the first two pages; a lost one when it was on the first. */
export const KW_ALERT_NEW_WITHIN = 20, KW_ALERT_LOST_WITHIN = 10;
export const keywordWatchDeps = { request, entitled: async (userId: number) => seoIncluded(await getEntitlements(userId)) };
export const watchSetting = z.object({ watch: z.boolean() }).strict();

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export type SnapshotKeyword = { keyword: string; position: number | null; volume: number | null; /** Estimated visits a month. */ traffic: number | null; /** The ranking page's path. */ path: string | null };
export type KeywordSnapshot = { id: number; takenOn: string; locationCode: number; languageCode: string; /** Every keyword the source has the site ranking for; null = it did not say. */ total: number | null; keywords: SnapshotKeyword[] };
/** true = the snapshot holds every keyword the site ranked for (so absence from it means "not ranking"). Unknown total = not known to be complete. */
export const isComplete = (s: { total: number | null; keywords: unknown[] }) => s.total !== null && s.total <= s.keywords.length;

/** Pure: one row of the source's answer. */
export function parseSnapshotKeyword(item: any): SnapshotKeyword | null {
  const kd = item?.keyword_data, keyword = typeof kd?.keyword === "string" ? kd.keyword.trim().toLowerCase() : "";
  if (!keyword) return null;
  const serp = item?.ranked_serp_element?.serp_item ?? {};
  const etv = num(serp.etv);
  return { keyword, position: num(serp.rank_group) ?? num(serp.rank_absolute), volume: num(kd?.keyword_info?.search_volume), traffic: etv === null ? null : Math.round(etv * 10) / 10, path: typeof serp.relative_url === "string" ? serp.relative_url.slice(0, 300) : null };
}
export async function fetchKeywordSnapshot(input: { domain: string; locationCode: number; languageCode: string }): Promise<{ data: { total: number | null; keywords: SnapshotKeyword[] }; costUsd: number }> {
  const task: DfsTask = assertOk(await keywordWatchDeps.request("POST", "/dataforseo_labs/google/ranked_keywords/live", [{
    target: input.domain, location_code: input.locationCode, language_code: input.languageCode, item_types: ["organic"], limit: KW_SNAPSHOT_ROWS, order_by: ["ranked_serp_element.serp_item.etv,desc"],
  }]), { treatNoResultsAsEmpty: true });
  const seen = new Set<string>(), keywords: SnapshotKeyword[] = [];
  for (const i of taskItems(task)) { const k = parseSnapshotKeyword(i); if (k && !seen.has(k.keyword)) { seen.add(k.keyword); keywords.push(k); } }
  return { data: { total: num((task.result?.[0] as any)?.total_count), keywords }, costUsd: typeof task.cost === "number" ? task.cost : 0 };
}

export type KeywordChange = SnapshotKeyword & { /** Lost keywords: where it stood before. */ was?: number | null };
export type KeywordComparison = {
  since: string; takenOn: string;
  /**
   * "exact": both snapshots hold every keyword, so `added` are searches the site has started to rank for and `gone`
   * ones it no longer ranks for. "top": at least one was cut at the limit, so they only entered or left the site's
   * highest-traffic keywords. "none": not comparable (another country or language) — both lists are empty.
   */
  basis: "exact" | "top" | "none";
  added: KeywordChange[]; gone: KeywordChange[];
  /** How many keywords each snapshot holds, and the source's totals. */
  now: { keywords: number; total: number | null }; before: { keywords: number; total: number | null };
};
/** Pure. Lists are ordered by traffic (added) and by the position they held (gone); 100 each at most. */
export function compareKeywordSnapshots(now: KeywordSnapshot, before: KeywordSnapshot): KeywordComparison {
  const head = { since: before.takenOn, takenOn: now.takenOn, now: { keywords: now.keywords.length, total: now.total }, before: { keywords: before.keywords.length, total: before.total } };
  if (now.locationCode !== before.locationCode || now.languageCode !== before.languageCode) return { ...head, basis: "none", added: [], gone: [] };
  const was = new Map(before.keywords.map((k) => [k.keyword, k] as const)), is = new Set(now.keywords.map((k) => k.keyword));
  const added = now.keywords.filter((k) => !was.has(k.keyword)).sort((a, b) => (b.traffic ?? -1) - (a.traffic ?? -1) || (a.position ?? 999) - (b.position ?? 999) || (a.keyword < b.keyword ? -1 : 1));
  const gone = before.keywords.filter((k) => !is.has(k.keyword)).map((k) => ({ ...k, was: k.position })).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || (b.volume ?? -1) - (a.volume ?? -1) || (a.keyword < b.keyword ? -1 : 1));
  return { ...head, basis: isComplete(now) && isComplete(before) ? "exact" : "top", added: added.slice(0, 100), gone: gone.slice(0, 100) };
}
/** Which changes are worth an alert. Only on an "exact" comparison: when a snapshot was cut at the limit, a keyword that left it may still rank. Pure. */
export function keywordAlerts(c: KeywordComparison): { added: KeywordChange[]; gone: KeywordChange[] } {
  if (c.basis !== "exact") return { added: [], gone: [] };
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
const toSnapshot = (r: any): KeywordSnapshot => ({ id: r.id, takenOn: String(r.taken_on).slice(0, 10), locationCode: r.location_code, languageCode: r.language_code, total: r.total ?? null, keywords: Array.isArray(r.keywords) ? r.keywords : [] });
/** The two newest snapshots of a site (newest first), or fewer. */
export async function latestSnapshots(userId: number, siteId: number, upTo?: string): Promise<KeywordSnapshot[]> {
  const { rows } = await pool.query(
    `SELECT id, taken_on::text AS taken_on, location_code, language_code, total, keywords FROM seo_keyword_snapshots
      WHERE site_id=$1 AND user_id=$2 AND ($3::date IS NULL OR taken_on <= $3::date) ORDER BY taken_on DESC LIMIT 2`, [siteId, userId, upTo ?? null]);
  return rows.map(toSnapshot);
}

type WatchSite = { id: number; user_id: number; domain: string; location_code: number; language_code: string };
/**
 * Take a snapshot now. Saved inside the charged call (SAVED FIRST, CHARGED SECOND): if it cannot be written the
 * customer pays nothing. A second snapshot on the same day replaces the first (and its alerts are judged again).
 * The monthly one (`automatic`) spends only the month's included data and moves the site's next date in the same
 * transaction, so a saved snapshot can never be found "due" and bought again.
 */
export async function takeKeywordSnapshot(site: WatchSite, automatic: boolean): Promise<{ id: number; takenOn: string; keywords: number }> {
  const out = await withBudget(site.user_id, KW_SNAPSHOT_ESTIMATE_USD, async () => {
    const o = await fetchKeywordSnapshot({ domain: site.domain, locationCode: site.location_code ?? 2840, languageCode: site.language_code ?? "en" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [row] } = await client.query(
        `INSERT INTO seo_keyword_snapshots(site_id, user_id, location_code, language_code, keywords, total, cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (site_id, taken_on) DO UPDATE SET location_code=EXCLUDED.location_code, language_code=EXCLUDED.language_code, keywords=EXCLUDED.keywords, total=EXCLUDED.total,
           cost_usd=seo_keyword_snapshots.cost_usd+EXCLUDED.cost_usd, alerts_done=false, version=seo_keyword_snapshots.version+1
         RETURNING id, taken_on::text AS taken_on`,
        [site.id, site.user_id, site.location_code ?? 2840, site.language_code ?? "en", JSON.stringify(o.data.keywords), o.data.total, o.costUsd]);
      // Whoever took it, the watch's month starts again from this snapshot.
      await client.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 month' WHERE id=$1 AND kw_watch", [site.id]);
      await client.query("COMMIT");
      return { data: { id: row.id as number, takenOn: String(row.taken_on).slice(0, 10), keywords: o.data.keywords.length }, costUsd: o.costUsd, costUnknown: false };
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      throw Object.assign(new Error(`keyword snapshot for ${site.domain} could not be saved: ${e?.message ?? e}`), { costUsd: o.costUsd, costUnknown: false, notSaved: true });
    } finally { client.release(); }
  }, { allowanceOnly: automatic, label: `Keyword snapshot — ${site.domain} (${automatic ? "monthly" : "now"})` });
  await settleKeywordAlerts(site.id).catch((e) => console.error(`[seo] keyword alerts for site ${site.id} failed (they will be tried again): ${e?.message ?? e}`));
  return out.data;
}

const searches = (n: number) => `${n} search${n === 1 ? "" : "es"}`;
/**
 * Raise the alerts each unsettled snapshot calls for — each compared with the snapshot before IT, oldest first — and
 * mark exactly the version that was judged as dealt with (a same-day retake is judged again).
 */
export async function settleKeywordAlerts(siteId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT x.id, x.user_id, x.taken_on::text AS taken_on, x.version, s.domain FROM seo_keyword_snapshots x JOIN seo_sites s ON s.id=x.site_id
      WHERE x.site_id=$1 AND x.alerts_done = false ORDER BY x.taken_on`, [siteId]);
  let raised = 0;
  for (const snap of rows) {
    const [now, before] = await latestSnapshots(snap.user_id, siteId, snap.taken_on);
    if (now && before && now.id === snap.id) {
      const c = compareKeywordSnapshots(now, before), a = keywordAlerts(c);
      const item = (list: KeywordChange[]) => [{ since: c.since, keywords: list.slice(0, 50), more: Math.max(0, list.length - 50) }];
      if (a.added.length) { const id = await saveAlert(snap.user_id, siteId, "kw_new", now.takenOn, `${snap.domain} started ranking for ${searches(a.added.length)} in the top ${KW_ALERT_NEW_WITHIN}`, item(a.added)); if (id) { await deliverAlert(id); raised++; } }
      if (a.gone.length) { const id = await saveAlert(snap.user_id, siteId, "kw_lost", now.takenOn, `${snap.domain} no longer ranks for ${searches(a.gone.length)} it held in the top ${KW_ALERT_LOST_WITHIN}`, item(a.gone)); if (id) { await deliverAlert(id); raised++; } }
    }
    await pool.query("UPDATE seo_keyword_snapshots SET alerts_done = true WHERE id=$1 AND version=$2", [snap.id, snap.version]);
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

/** One scheduler pass: owed alerts first, then the snapshots that are due. Leased for six hours; never bought twice. */
export async function runDueKeywordSnapshots(): Promise<number> {
  const { rows: owed } = await pool.query("SELECT DISTINCT site_id FROM seo_keyword_snapshots WHERE alerts_done = false LIMIT 20").catch(() => ({ rows: [] as any[] }));
  for (const o of owed) await settleKeywordAlerts(o.site_id).catch((e) => console.error(`[seo] keyword alerts for site ${o.site_id} failed: ${e?.message ?? e}`));
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '6 hours' WHERE kw_watch AND next_kw_snapshot_at <= now() RETURNING id, user_id, domain, location_code, language_code`);
  let done = 0;
  for (const site of due) {
    try {
      if (!(await keywordWatchDeps.entitled(site.user_id))) { await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 day' WHERE id=$1", [site.id]); continue; }
      await takeKeywordSnapshot(site, true);
      done++;
    } catch (e: any) {
      if (e instanceof SeoBudgetError) {
        // Out of included data: nothing more is likely today.
        console.warn(`[seo] keyword snapshot for ${site.domain} skipped: ${e.message}`);
        await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '1 day' WHERE id=$1", [site.id]).catch(() => {});
      } else void recordFailure("job", "SEO keyword snapshot", e);
    }
  }
  return done;
}

export type KeywordWatchView = { watch: boolean; nextAt: string | null; rows: number; latest: { takenOn: string; keywords: number; total: number | null; complete: boolean } | null; comparison: KeywordComparison | null };
export async function keywordWatchView(userId: number, site: { id: number; kw_watch?: boolean; next_kw_snapshot_at?: unknown }): Promise<KeywordWatchView> {
  const [now, before] = await latestSnapshots(userId, site.id);
  return {
    watch: !!site.kw_watch, nextAt: site.kw_watch && site.next_kw_snapshot_at ? new Date(site.next_kw_snapshot_at as string).toISOString() : null, rows: KW_SNAPSHOT_ROWS,
    latest: now ? { takenOn: now.takenOn, keywords: now.keywords.length, total: now.total, complete: isComplete(now) } : null,
    comparison: now && before ? compareKeywordSnapshots(now, before) : null,
  };
}
