/**
 * Recurring local grids: a scan the customer chose to repeat every week or month, run by the
 * scheduler from the month's included SEO data only (never credit they bought), compared with an
 * earlier scan of the same points, and turned into an alert when the area clearly got better or worse.
 * The scan itself is server/seo/grid.ts; this file is the schedule, the comparison and the one
 * function that runs a scan for both the page and the scheduler.
 *
 * How a period is kept from being bought twice or lost:
 *   next_at        when the next scan is due — counted from the watch's anchor, never from "whenever it finished"
 *   lease_until /  who is working on it now; only the holder of the token may record its outcome
 *   lease_token
 *   run_scan_id    the scan bought for the period that is due. Written before the scan runs; if the process stops
 *                  after the scan was saved, the next pass finds it finished and closes the period WITHOUT buying again
 *   alert_scan_id  a finished scan whose comparison is still owed. Set in the same statement that closes the
 *                  period, cleared only when the comparison has been made — so an alert cannot be forgotten
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { withBudget, SeoBudgetError } from "./budget";
import { isConfigured } from "./dataforseo";
import { SeoCustomerError } from "./public-errors";
import { saveAlert, deliverAlert } from "./alerts";
import { GRID_DEPTH, GRID_SIZES, GRID_SPACINGS, beginScan, failScan, fetchGrid, finishScan, gridEstimateUsd, readPin, type GridPin, type GridScan } from "./grid";

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
  `ALTER TABLE seo_grid_watches ADD COLUMN IF NOT EXISTS anchor_at timestamptz`,
  `ALTER TABLE seo_grid_watches ADD COLUMN IF NOT EXISTS lease_until timestamptz`,
  `ALTER TABLE seo_grid_watches ADD COLUMN IF NOT EXISTS lease_token text`,
  `ALTER TABLE seo_grid_watches ADD COLUMN IF NOT EXISTS run_scan_id integer`,
  `ALTER TABLE seo_grid_watches ADD COLUMN IF NOT EXISTS alert_scan_id integer`,
  `UPDATE seo_grid_watches SET anchor_at = next_at WHERE anchor_at IS NULL`,
  // Alerts gain two kinds. The lock is taken BEFORE looking, so two servers starting together cannot both decide to
  // change the rule; the look is at this table's own rule, not any rule of that name in another schema.
  `DO $$ BEGIN
     LOCK TABLE seo_alerts IN SHARE ROW EXCLUSIVE MODE;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'seo_alerts'::regclass AND conname = 'seo_alerts_kind_check' AND pg_get_constraintdef(oid) LIKE '%grid_down%') THEN
       ALTER TABLE seo_alerts DROP CONSTRAINT IF EXISTS seo_alerts_kind_check;
       ALTER TABLE seo_alerts ADD CONSTRAINT seo_alerts_kind_check CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained','grid_down','grid_up'));
     END IF;
   END $$`,
];

export class WatchError extends SeoCustomerError {}
/** Swappable for the real-database check (script/seo-grid-check.ts), which has no plans table to ask. */
export const gridMonitorDeps = { entitled: async (userId: number) => seoIncluded(await getEntitlements(userId)) };

/**
 * When the watch is next due after `after`, counted from its anchor: weekly = whole weeks on from the anchor;
 * monthly = the anchor's day of the month (the last day when the month is shorter), at the anchor's time of day.
 * So a scan that runs late, or a month with 28 days, never moves the schedule. Pure.
 */
export function nextDue(anchor: Date, every: "weekly" | "monthly", after: Date): Date {
  if (after.getTime() < anchor.getTime()) return new Date(anchor);
  if (every === "weekly") {
    const week = 7 * 864e5;
    return new Date(anchor.getTime() + (Math.floor((after.getTime() - anchor.getTime()) / week) + 1) * week);
  }
  const day = anchor.getUTCDate();
  for (let k = 1; k < 1200; k++) {
    const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth() + k;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, m, Math.min(day, last), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
    if (due.getTime() > after.getTime()) return due;
  }
  return new Date(after.getTime() + 30 * 864e5);
}

export async function listWatches(userId: number, siteId: number): Promise<GridWatch[]> {
  const { rows } = await pool.query(`SELECT id, keyword, size, spacing::float8 AS spacing, every, next_at AS "nextAt" FROM seo_grid_watches WHERE site_id=$1 AND user_id=$2 ORDER BY created_at`, [siteId, userId]);
  return rows;
}
/**
 * Repeat a scan that has been run at least once (it is what the first automatic scan is compared with). The first
 * automatic run is one period from now. The site's row is locked for the count and the insert, so the limit of five
 * holds across server processes.
 */
export async function saveWatch(userId: number, siteId: number, input: z.infer<typeof watchInput>): Promise<GridWatch> {
  const keyword = input.keyword.toLowerCase().replace(/\s+/g, " ").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [site] } = await client.query("SELECT id FROM seo_sites WHERE id=$1 AND user_id=$2 FOR UPDATE", [siteId, userId]);
    if (!site) throw new WatchError("Site not found", 404);
    const { rows: [base] } = await client.query("SELECT 1 FROM seo_grid_scans WHERE site_id=$1 AND user_id=$2 AND status='done' AND keyword=$3 AND size=$4 AND spacing=$5 LIMIT 1", [siteId, userId, keyword, input.size, input.spacing]);
    if (!base) throw new WatchError("Run this scan once first — a repeating scan is compared with the one before it.", 400);
    const { rows: [{ n }] } = await client.query("SELECT count(*)::int n FROM seo_grid_watches WHERE site_id=$1 AND NOT (lower(keyword)=$2 AND size=$3 AND spacing=$4)", [siteId, keyword, input.size, input.spacing]);
    if (n >= MAX_WATCHES) throw new WatchError(`Up to ${MAX_WATCHES} scans can repeat for one site. Stop one you no longer need.`, 403);
    const first = nextDue(new Date(), input.every, new Date());
    const { rows: [row] } = await client.query(
      `INSERT INTO seo_grid_watches(user_id, site_id, keyword, size, spacing, every, next_at, anchor_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (site_id, lower(keyword), size, spacing) DO UPDATE SET every=EXCLUDED.every, next_at=LEAST(seo_grid_watches.next_at, EXCLUDED.next_at), anchor_at=LEAST(seo_grid_watches.anchor_at, EXCLUDED.anchor_at)
       RETURNING id, keyword, size, spacing::float8 AS spacing, every, next_at AS "nextAt"`,
      [userId, siteId, keyword, input.size, input.spacing, input.every, first]);
    await client.query("COMMIT");
    return row;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
/** Stop repeating. Work already under way for it finds the row gone and records nothing more (no alert, no further scan). */
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

// ── Comparing two scans ─────────────────────────────────────────────────────

type PointLite = { row: number; col: number; rank: number | null; failed?: true };
export type GridFigures = { top3: number; checked: number; avgRank: number | null };
export type GridComparison = { kind: "grid_down" | "grid_up" | null; /** The points both scans checked; the figures are over these only. */ common: number; now: GridFigures; before: GridFigures };
const figures = (points: PointLite[]): GridFigures => ({
  top3: points.filter((p) => p.rank !== null && p.rank <= 3).length, checked: points.length,
  avgRank: points.length ? Math.round((points.reduce((a, p) => a + (p.rank ?? GRID_DEPTH + 1), 0) / points.length) * 10) / 10 : null,
});
/**
 * Did the area clearly change between two scans of the same square? Only the points BOTH scans managed to check are
 * compared (a point that failed in one scan says nothing about the other), and there must be at least four fifths of
 * the square in common. "Worse" is either signal moving clearly the wrong way — the share of points in the first
 * three down 15 points of percentage, or the position score up 2 — and a small contrary signal does not cancel it.
 * "Better" needs a clear signal the right way and nothing saying worse. Pure.
 */
export function compareScans(now: PointLite[], before: PointLite[]): GridComparison {
  const key = (p: PointLite) => `${p.row}:${p.col}`;
  const was = new Map(before.filter((p) => !p.failed).map((p) => [key(p), p] as const));
  const pairs = now.filter((p) => !p.failed && was.has(key(p))).map((p) => [p, was.get(key(p))!] as const);
  const a = figures(pairs.map(([p]) => p)), b = figures(pairs.map(([, p]) => p));
  const total = Math.max(now.length, before.length);
  if (!pairs.length || pairs.length < total * 0.8) return { kind: null, common: pairs.length, now: a, before: b };
  const dShare = ((a.top3 - b.top3) / pairs.length) * 100, dScore = (a.avgRank ?? 0) - (b.avgRank ?? 0); // a higher score is worse
  const worse = dShare <= -15 || dScore >= 2, better = dShare >= 15 || dScore <= -2;
  return { kind: worse ? "grid_down" : better ? "grid_up" : null, common: pairs.length, now: a, before: b };
}

/**
 * Compare a finished scan with an earlier one of the same search, square and listing in the same place, and alert on
 * a clear change. The baseline is the most recent earlier scan that shares enough checked points — a scan with many
 * failed points is passed over, not allowed to block the comparison. Nothing is said about a listing the site is no
 * longer pinned to. Returns the kind raised (or already raised), or null.
 */
export async function raiseGridAlert(siteId: number, scanId: number): Promise<"grid_down" | "grid_up" | null> {
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, alerts_enabled, grid_pin FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return null;
  const { rows: [now] } = await pool.query(`SELECT id, keyword, size, spacing::float8 AS spacing, scan, created_at FROM seo_grid_scans WHERE id=$1 AND site_id=$2 AND status='done'`, [scanId, siteId]);
  const center = now?.scan?.center;
  if (!center) return null;
  const pin = readPin(site.grid_pin);
  if (!pin || Math.abs(pin.lat - center.lat) > 0.0001 || Math.abs(pin.lng - center.lng) > 0.0001 || (pin.cid ?? null) !== (center.cid ?? null)) return null;
  const { rows: earlier } = await pool.query(
    `SELECT id, scan, created_at FROM seo_grid_scans
      WHERE site_id=$1 AND status='done' AND id<>$2 AND created_at < $3 AND keyword=$4 AND size=$5 AND spacing=$6
        AND abs((scan->'center'->>'lat')::float8 - $7) < 0.0001 AND abs((scan->'center'->>'lng')::float8 - $8) < 0.0001 AND (scan->'center'->>'cid') IS NOT DISTINCT FROM $9
        AND ($9::text IS NOT NULL OR (scan->'center'->>'name') = $10)
      ORDER BY created_at DESC LIMIT 5`,
    // Without Google's id on either side, the same name in the same place is the least that makes two scans the same listing.
    [siteId, scanId, now.created_at, now.keyword, now.size, now.spacing, center.lat, center.lng, center.cid ?? null, center.name ?? ""]);
  for (const before of earlier) {
    const c = compareScans(now.scan.points ?? [], before.scan?.points ?? []);
    if (c.common < Math.max((now.scan.points ?? []).length, (before.scan?.points ?? []).length) * 0.8) continue; // too little in common: try the one before
    if (!c.kind) return null;
    const title = `${site.domain}: "${now.keyword}" ${c.kind === "grid_down" ? "got worse" : "got better"} across your area — in the first 3 at ${c.now.top3} of ${c.common} points, was ${c.before.top3}`;
    const items = [{ keyword: now.keyword, size: now.size, spacing: now.spacing, scanId: now.id, top3: c.now.top3, checked: c.common, score: c.now.avgRank, wasTop3: c.before.top3, wasChecked: c.common, wasScore: c.before.avgRank, since: new Date(before.created_at).toISOString() }];
    const id = await saveAlert(site.user_id, siteId, c.kind, `grid:${now.id}`, title, items);
    if (id) await deliverAlert(id);
    return c.kind;
  }
  return null;
}

// ── The scheduler ───────────────────────────────────────────────────────────

/** Comparisons still owed for finished scans. A watch that was stopped is gone, and with it what it owed. */
export async function raiseOwedGridAlerts(): Promise<number> {
  const { rows } = await pool.query("SELECT id, site_id, alert_scan_id FROM seo_grid_watches WHERE alert_scan_id IS NOT NULL ORDER BY id LIMIT 10");
  let done = 0;
  for (const w of rows) {
    try {
      await raiseGridAlert(w.site_id, w.alert_scan_id);
      await pool.query("UPDATE seo_grid_watches SET alert_scan_id=NULL WHERE id=$1 AND alert_scan_id=$2", [w.id, w.alert_scan_id]);
      done++;
    } catch (e: any) { console.error(`[seo] grid comparison for scan ${w.alert_scan_id} failed (it will be tried again): ${e?.message ?? e}`); }
  }
  return done;
}

let busy = false;
/**
 * Run the repeating scans that are due — one at a time, and never two passes at once in this process; across
 * processes the lease decides. See the top of the file for how a period is kept from being bought twice.
 */
export async function runDueGridWatches(): Promise<number> {
  if (busy) return 0;
  busy = true;
  let done = 0;
  try {
    await raiseOwedGridAlerts().catch((e) => console.error("[seo] owed grid comparisons failed", e?.message ?? e));
    if (!isConfigured()) return 0;
    const token = randomUUID();
    const { rows: due } = await pool.query(
      `UPDATE seo_grid_watches SET lease_until = now() + interval '2 hours', lease_token = $1
        WHERE id IN (SELECT id FROM seo_grid_watches WHERE next_at <= now() AND (lease_until IS NULL OR lease_until < now()) ORDER BY next_at LIMIT 2 FOR UPDATE SKIP LOCKED)
       RETURNING id, user_id, site_id, keyword, size, spacing::float8 AS spacing, every, anchor_at, next_at, run_scan_id`, [token]);
    for (const w of due) {
      /** Only the holder of the lease records anything; a watch that was stopped, or taken over, answers false. */
      const mine = async (sql: string, args: unknown[] = []) => ((await pool.query(`UPDATE seo_grid_watches SET ${sql} WHERE id=$1 AND lease_token=$2`, [w.id, token, ...args])).rowCount ?? 0) > 0;
      const backOff = (interval: string) => mine(`lease_until = now() + interval '${interval}', run_scan_id = NULL`).catch(() => false);
      /** The period is done: the next one is due on the anchored date, and the comparison for this scan is owed. One statement. */
      const closePeriod = (scanId: number) => mine("next_at = $3, lease_until = NULL, lease_token = NULL, run_scan_id = NULL, alert_scan_id = $4", [nextDue(new Date(w.anchor_at ?? w.next_at), w.every, new Date()), scanId]);
      let scanId: number | null = null;
      try {
        // A scan was already bought for this period (the process stopped before the period was closed): finish the
        // paperwork, do not buy again.
        if (w.run_scan_id) {
          const { rows: [prior] } = await pool.query("SELECT status, created_at > now() - interval '12 minutes' AS recent FROM seo_grid_scans WHERE id=$1 AND site_id=$2", [w.run_scan_id, w.site_id]);
          if (prior?.status === "done") { if (await closePeriod(w.run_scan_id)) done++; continue; }
          if (prior?.status === "running" && prior.recent) continue; // still going somewhere: leave it under this lease
          await mine("run_scan_id = NULL");
        }
        if (!(await gridMonitorDeps.entitled(w.user_id))) { await backOff("1 day"); continue; }
        const { rows: [site] } = await pool.query("SELECT id, domain, grid_pin FROM seo_sites WHERE id=$1 AND user_id=$2", [w.site_id, w.user_id]);
        const pin = site ? readPin(site.grid_pin) : null;
        if (!site || !pin) { await backOff("1 day"); continue; }
        const started = await beginScan(w.user_id, site.id, { keyword: w.keyword, size: w.size, spacing: w.spacing });
        if (started.existing) { await backOff("15 minutes"); continue; } // the customer is scanning right now
        scanId = started.id;
        // The scan is tied to the period BEFORE anything is bought. If the watch was stopped meanwhile, nothing is bought.
        if (!(await mine("run_scan_id = $3", [scanId]))) { await failScan(scanId, "The scan was interrupted before it finished. Lookups it had not made were not charged.").catch(() => {}); continue; }
        await runGridScan(w.user_id, site, pin, { keyword: w.keyword, size: w.size, spacing: w.spacing }, scanId, { allowanceOnly: true, label: `Local grid — "${String(w.keyword).slice(0, 80)}", ${w.size} × ${w.size} points (${w.every})` });
        if (await closePeriod(scanId)) done++;
      } catch (e: any) {
        if (scanId !== null) await failScan(scanId, e instanceof SeoBudgetError ? "This month's included SEO data had run out, so the repeating scan was skipped." : e?.notSaved ? "The scan ran but its results could not be saved. You were not charged." : "The repeating scan could not be completed; it will be tried again.").catch(() => {});
        // Out of included data: nothing more is likely today. Anything else is tried again when the lease runs out.
        if (e instanceof SeoBudgetError) { console.warn(`[seo] repeating grid ${w.id} skipped: ${e.message}`); await backOff("1 day"); }
        else { console.error(`[seo] repeating grid ${w.id} failed (it will be tried again in two hours): ${e?.message ?? e}`); await mine("run_scan_id = NULL").catch(() => {}); }
      }
    }
    if (done) await raiseOwedGridAlerts().catch((e) => console.error("[seo] owed grid comparisons failed", e?.message ?? e));
  } finally { busy = false; }
  return done;
}

export type GridReportLine = { keyword: string; size: number; spacing: number; at: string; top3: number; checked: number; score: number | null; previous: { top3: number; checked: number; score: number | null; at: string } | null };
/**
 * For the scheduled report: the newest scan of each repeating search with the comparable one before it — only scans of
 * the listing the site is pinned to NOW (after a change of listing, the old one's results are not reported as this
 * business's). Saved rows only.
 */
export async function gridReportLines(userId: number, siteId: number): Promise<GridReportLine[]> {
  const same = (a: string, b: string) => `abs((${a}.scan->'center'->>'lat')::float8 - (${b}->>'lat')::float8) < 0.0001 AND abs((${a}.scan->'center'->>'lng')::float8 - (${b}->>'lng')::float8) < 0.0001 AND (${a}.scan->'center'->>'cid') IS NOT DISTINCT FROM (${b}->>'cid')`;
  const { rows } = await pool.query(
    `SELECT s.keyword, s.size, s.spacing::float8 AS spacing, s.created_at AS at, s.top3, s.checked, s.avg_rank::float8 AS score,
            (SELECT jsonb_build_object('top3', p.top3, 'checked', p.checked, 'score', p.avg_rank::float8, 'at', p.created_at) FROM seo_grid_scans p
              WHERE p.site_id=s.site_id AND p.status='done' AND p.created_at < s.created_at AND p.keyword=s.keyword AND p.size=s.size AND p.spacing=s.spacing
                AND ${same("p", "st.grid_pin")} AND ((st.grid_pin->>'cid') IS NOT NULL OR (p.scan->'center'->>'name') = (st.grid_pin->>'name'))
              ORDER BY p.created_at DESC LIMIT 1) AS previous
       FROM seo_grid_watches w
       JOIN seo_sites st ON st.id=w.site_id AND st.grid_pin IS NOT NULL
       JOIN LATERAL (SELECT * FROM seo_grid_scans x WHERE x.site_id=w.site_id AND x.status='done' AND x.keyword=w.keyword AND x.size=w.size AND x.spacing=w.spacing AND x.created_at > now() - interval '45 days'
                       AND ${same("x", "st.grid_pin")} AND ((st.grid_pin->>'cid') IS NOT NULL OR (x.scan->'center'->>'name') = (st.grid_pin->>'name'))
                     ORDER BY x.created_at DESC LIMIT 1) s ON true
      WHERE w.site_id=$1 AND w.user_id=$2 ORDER BY w.created_at LIMIT ${MAX_WATCHES}`, [siteId, userId]);
  return rows.map((r: any) => ({ ...r, at: new Date(r.at).toISOString() }));
}
