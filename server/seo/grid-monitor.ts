/**
 * Recurring local grids: a scan the customer chose to repeat every week or month, run by the
 * scheduler from the month's included SEO data only (never credit they bought), compared with the
 * scan before it, and turned into an alert when the area clearly got better or worse.
 * The scan itself is server/seo/grid.ts; this file is the schedule, the comparison and the one
 * function that runs a scan for both the page and the scheduler.
 */
import { z } from "zod";
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { withBudget, SeoBudgetError } from "./budget";
import { isConfigured } from "./dataforseo";
import { SeoCustomerError } from "./public-errors";
import { saveAlert, deliverAlert } from "./alerts";
import { GRID_SIZES, GRID_SPACINGS, beginScan, failScan, fetchGrid, finishScan, gridEstimateUsd, readPin, type GridPin, type GridScan } from "./grid";

export const MAX_WATCHES = 5;
const literal = <T extends readonly number[]>(values: T) => z.number().refine((n): n is T[number] => (values as readonly number[]).includes(n), "Not one of the choices");
export const watchInput = z.object({
  keyword: z.string().trim().min(1).max(120),
  size: literal(GRID_SIZES),
  spacing: literal(GRID_SPACINGS),
  every: z.enum(["weekly", "monthly"]),
}).strict();
export type GridWatch = { id: number; keyword: string; size: number; spacing: number; every: "weekly" | "monthly"; nextAt: string };

export const GRID_WATCH_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_grid_watches (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     keyword text NOT NULL,
     size integer NOT NULL,
     spacing numeric NOT NULL,
     every text NOT NULL CHECK (every IN ('weekly','monthly')),
     next_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_grid_watches_one ON seo_grid_watches(site_id, lower(keyword), size, spacing)`,
  // Alerts gain two kinds. The rule is replaced only when it does not know them yet, so this is safe on every start.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_alerts_kind_check' AND pg_get_constraintdef(oid) LIKE '%grid_down%') THEN
       ALTER TABLE seo_alerts DROP CONSTRAINT IF EXISTS seo_alerts_kind_check;
       ALTER TABLE seo_alerts ADD CONSTRAINT seo_alerts_kind_check CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained','grid_down','grid_up'));
     END IF;
   END $$`,
];

const period = (every: string) => (every === "weekly" ? "7 days" : "1 month");
export class WatchError extends SeoCustomerError {}

export async function listWatches(userId: number, siteId: number): Promise<GridWatch[]> {
  const { rows } = await pool.query(`SELECT id, keyword, size, spacing::float8 AS spacing, every, next_at AS "nextAt" FROM seo_grid_watches WHERE site_id=$1 AND user_id=$2 ORDER BY created_at`, [siteId, userId]);
  return rows;
}
/** Repeat this scan. The first automatic run is one period from now (the customer has just seen today's). */
export async function saveWatch(userId: number, siteId: number, input: z.infer<typeof watchInput>): Promise<GridWatch> {
  const keyword = input.keyword.toLowerCase().replace(/\s+/g, " ").trim();
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM seo_grid_watches WHERE site_id=$1 AND NOT (lower(keyword)=$2 AND size=$3 AND spacing=$4)", [siteId, keyword, input.size, input.spacing]);
  if (n >= MAX_WATCHES) throw new WatchError(`Up to ${MAX_WATCHES} scans can repeat for one site. Stop one you no longer need.`, 403);
  const { rows: [row] } = await pool.query(
    `INSERT INTO seo_grid_watches(user_id, site_id, keyword, size, spacing, every, next_at) VALUES($1,$2,$3,$4,$5,$6, now() + $7::interval)
     ON CONFLICT (site_id, lower(keyword), size, spacing) DO UPDATE SET every=EXCLUDED.every, next_at=LEAST(seo_grid_watches.next_at, EXCLUDED.next_at)
     RETURNING id, keyword, size, spacing::float8 AS spacing, every, next_at AS "nextAt"`,
    [userId, siteId, keyword, input.size, input.spacing, input.every, period(input.every)]);
  return row;
}
export async function deleteWatch(userId: number, siteId: number, watchId: number): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM seo_grid_watches WHERE id=$1 AND site_id=$2 AND user_id=$3", [watchId, siteId, userId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Run one scan into its row: the results are written inside the charged call (saved first, charged second), so a
 * scan is never paid for and then missing. Throws what went wrong; the caller records it on the row.
 */
export async function runGridScan(userId: number, site: { id: number; domain: string }, pin: GridPin, input: { keyword: string; size: number; spacing: number }, scanId: number, opts: { allowanceOnly?: boolean; label: string }): Promise<GridScan> {
  const out = await withBudget(userId, gridEstimateUsd(input.size * input.size), async () => {
    const o = await fetchGrid({ ...input, pin, domain: site.domain });
    let saved = false, lastError: unknown = null;
    for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
      try { saved = await finishScan(scanId, o.data, o.costUsd); if (!saved) break; }
      catch (e) { lastError = e; await new Promise((r) => setTimeout(r, 500 * attempt)); }
    }
    if (!saved) throw Object.assign(new Error(`local grid scan ${scanId} could not be saved: ${(lastError as any)?.message ?? "it is no longer running"}`), { costUsd: o.costUsd, costUnknown: o.costUnknown, notSaved: true });
    return o;
  }, opts);
  return out.data;
}

export type GridFigures = { top3: number; checked: number; points: number; avgRank: number | null };
/**
 * Did the area clearly change between two comparable scans? Both must have checked at least four fifths of their
 * points (a scan with many failed points proves nothing), and the change must be big: the share of points in the
 * first three moved by 15 points of percentage or more, or the position score by 2 or more.
 */
export function gridChange(now: GridFigures, before: GridFigures): "grid_down" | "grid_up" | null {
  if (!now.checked || !before.checked || now.checked < now.points * 0.8 || before.checked < before.points * 0.8) return null;
  const share = (f: GridFigures) => (f.top3 / f.checked) * 100;
  const dShare = share(now) - share(before);
  const dScore = now.avgRank !== null && before.avgRank !== null ? now.avgRank - before.avgRank : 0; // a higher score is worse
  // The two signals must not disagree: more points in the first three with a worse score (a few far points dropped out), or the reverse, is not a clear change.
  if ((dShare <= -15 && dScore >= 0) || (dScore >= 2 && dShare <= 0)) return "grid_down";
  if ((dShare >= 15 && dScore <= 0) || (dScore <= -2 && dShare >= 0)) return "grid_up";
  return null;
}

/** Compare a finished scan with the one before it (same search, same square, same listing in the same place) and alert on a clear change. */
export async function raiseGridAlert(siteId: number, scanId: number): Promise<"grid_down" | "grid_up" | null> {
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, alerts_enabled FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return null;
  const { rows: [now] } = await pool.query(`SELECT id, keyword, size, spacing::float8 AS spacing, scan->'center' AS center, top3, checked, points, avg_rank::float8 AS "avgRank", created_at FROM seo_grid_scans WHERE id=$1 AND site_id=$2 AND status='done'`, [scanId, siteId]);
  if (!now?.center) return null;
  const { rows: [before] } = await pool.query(
    `SELECT id, top3, checked, points, avg_rank::float8 AS "avgRank", created_at FROM seo_grid_scans
      WHERE site_id=$1 AND status='done' AND id<>$2 AND created_at < $3 AND keyword=$4 AND size=$5 AND spacing=$6
        AND abs((scan->'center'->>'lat')::float8 - $7) < 0.0001 AND abs((scan->'center'->>'lng')::float8 - $8) < 0.0001 AND (scan->'center'->>'cid') IS NOT DISTINCT FROM $9
        AND ($9::text IS NOT NULL OR (scan->'center'->>'name') = $10)
      ORDER BY created_at DESC LIMIT 1`,
    // Without Google's id on either side, the same name in the same place is the least that makes two scans the same listing.
    [siteId, scanId, now.created_at, now.keyword, now.size, now.spacing, now.center.lat, now.center.lng, now.center.cid ?? null, now.center.name ?? ""]);
  if (!before) return null;
  const kind = gridChange(now, before);
  if (!kind) return null;
  const title = `${site.domain}: "${now.keyword}" ${kind === "grid_down" ? "got worse" : "got better"} across your area — in the first 3 at ${now.top3} of ${now.checked} points, was ${before.top3} of ${before.checked}`;
  const items = [{ keyword: now.keyword, size: now.size, spacing: now.spacing, scanId: now.id, top3: now.top3, checked: now.checked, score: now.avgRank, wasTop3: before.top3, wasChecked: before.checked, wasScore: before.avgRank, since: new Date(before.created_at).toISOString() }];
  const id = await saveAlert(site.user_id, siteId, kind, `grid:${now.id}`, title, items);
  if (id) await deliverAlert(id);
  return kind;
}

let busy = false;
/**
 * Run the repeating scans that are due — one at a time, and never two passes at once in this process. A watch is
 * leased for two hours first, so a crash leaves it due again later; its period moves on only when a scan finished.
 */
export async function runDueGridWatches(): Promise<number> {
  if (busy || !isConfigured()) return 0;
  busy = true;
  let done = 0;
  try {
    const { rows: due } = await pool.query(
      `UPDATE seo_grid_watches SET next_at = now() + interval '2 hours'
        WHERE id IN (SELECT id FROM seo_grid_watches WHERE next_at <= now() ORDER BY next_at LIMIT 2 FOR UPDATE SKIP LOCKED)
       RETURNING id, user_id, site_id, keyword, size, spacing::float8 AS spacing, every`);
    for (const w of due) {
      const later = (interval: string) => pool.query(`UPDATE seo_grid_watches SET next_at = now() + interval '${interval}' WHERE id=$1`, [w.id]).catch(() => {});
      let scanId: number | null = null;
      try {
        if (!seoIncluded(await getEntitlements(w.user_id))) { await later("1 day"); continue; }
        const { rows: [site] } = await pool.query("SELECT id, domain, grid_pin FROM seo_sites WHERE id=$1 AND user_id=$2", [w.site_id, w.user_id]);
        const pin = site ? readPin(site.grid_pin) : null;
        if (!site || !pin) { await later("1 day"); continue; }
        const started = await beginScan(w.user_id, site.id, { keyword: w.keyword, size: w.size, spacing: w.spacing });
        if (started.existing) continue; // the customer is scanning right now: this one waits for its lease to run out
        scanId = started.id;
        await runGridScan(w.user_id, site, pin, { keyword: w.keyword, size: w.size, spacing: w.spacing }, scanId, { allowanceOnly: true, label: `Local grid — "${String(w.keyword).slice(0, 80)}", ${w.size} × ${w.size} points (${w.every})` });
        await pool.query(`UPDATE seo_grid_watches SET next_at = now() + $2::interval WHERE id=$1`, [w.id, period(w.every)]);
        await raiseGridAlert(site.id, scanId).catch((e) => console.error(`[seo] grid alert for scan ${scanId} failed: ${e?.message ?? e}`));
        done++;
      } catch (e: any) {
        if (scanId !== null) await failScan(scanId, e instanceof SeoBudgetError ? "This month's included SEO data had run out, so the repeating scan was skipped." : e?.notSaved ? "The scan ran but its results could not be saved. You were not charged." : "The repeating scan could not be completed; it will be tried again.").catch(() => {});
        // Out of included data: nothing more is likely today.
        if (e instanceof SeoBudgetError) { console.warn(`[seo] repeating grid ${w.id} skipped: ${e.message}`); await later("1 day"); }
        else console.error(`[seo] repeating grid ${w.id} failed (it will be tried again in two hours): ${e?.message ?? e}`);
      }
    }
  } finally { busy = false; }
  return done;
}

export type GridReportLine = { keyword: string; size: number; spacing: number; at: string; top3: number; checked: number; score: number | null; previous: { top3: number; checked: number; score: number | null; at: string } | null };
/** For the scheduled report: the newest scan of each repeating search with the comparable one before it. Saved rows only. */
export async function gridReportLines(userId: number, siteId: number): Promise<GridReportLine[]> {
  const { rows } = await pool.query(
    `SELECT s.keyword, s.size, s.spacing::float8 AS spacing, s.created_at AS at, s.top3, s.checked, s.avg_rank::float8 AS score,
            (SELECT jsonb_build_object('top3', p.top3, 'checked', p.checked, 'score', p.avg_rank::float8, 'at', p.created_at) FROM seo_grid_scans p
              WHERE p.site_id=s.site_id AND p.status='done' AND p.created_at < s.created_at AND p.keyword=s.keyword AND p.size=s.size AND p.spacing=s.spacing
                AND abs((p.scan->'center'->>'lat')::float8 - (s.scan->'center'->>'lat')::float8) < 0.0001 AND abs((p.scan->'center'->>'lng')::float8 - (s.scan->'center'->>'lng')::float8) < 0.0001
                AND (p.scan->'center'->>'cid') IS NOT DISTINCT FROM (s.scan->'center'->>'cid')
                AND ((s.scan->'center'->>'cid') IS NOT NULL OR (p.scan->'center'->>'name') = (s.scan->'center'->>'name'))
              ORDER BY p.created_at DESC LIMIT 1) AS previous
       FROM seo_grid_watches w
       JOIN LATERAL (SELECT * FROM seo_grid_scans x WHERE x.site_id=w.site_id AND x.status='done' AND x.keyword=w.keyword AND x.size=w.size AND x.spacing=w.spacing AND x.created_at > now() - interval '45 days' ORDER BY x.created_at DESC LIMIT 1) s ON true
      WHERE w.site_id=$1 AND w.user_id=$2 ORDER BY w.created_at LIMIT ${MAX_WATCHES}`, [siteId, userId]);
  return rows.map((r: any) => ({ ...r, at: new Date(r.at).toISOString() }));
}
