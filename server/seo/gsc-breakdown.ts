/**
 * Google's own numbers by page and by search: Search Console clicks, impressions and position for each page of the
 * site (or each search it was shown for) over the last 28 synced days and the 28 before — from the gsc_analytics rows
 * the Search Console page already syncs (server/gsc). Free.
 *
 * What it rests on, and what it does not claim: the windows end at the newest day synced (Google runs two or three
 * days behind), and a window with days missing is said and not compared; Google leaves out rare searches for privacy,
 * so the searches add up to less than the site's total clicks; a page or search absent from a window had no rows
 * there (shown as 0 only when that window is complete, else "not known").
 */
import { pool } from "../db";

export const GSC_ROWS = 500, GSC_WINDOW = 28;
export type GscRow = {
  key: string; clicks: number; impressions: number; position: number | null;
  /** The 28 days before; null when that window is incomplete (not a zero). */ prevClicks: number | null; prevImpressions: number | null; prevPosition: number | null;
  /** Searches only: one of the site's tracked keywords. */ tracked?: boolean;
};
export type GscBreakdown = {
  dimension: "page" | "query"; property: string; through: string | null; days: number; previousDays: number; comparable: boolean;
  rows: GscRow[]; /** More pages/searches than are listed (the busiest are kept). */ more: number; total: number;
};

/** The site's Search Console property, by the same rule as the summary tile (domain property first). Pure helper kept here for both. */
export async function gscAssetFor(user: number, domain: string): Promise<{ id: number; external_id: string } | null> {
  const { rows: [a] } = await pool.query(
    `SELECT id, external_id FROM edge_assets WHERE user_id=$1 AND provider='gsc'
       AND external_id = ANY($2::text[]) ORDER BY (external_id=$3) DESC, id LIMIT 1`,
    [user, [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`, `sc-domain:www.${domain}`], `sc-domain:${domain}`]);
  return a ?? null;
}

/** Pure: rows of one dimension for the two windows, merged. `prevComplete` = the earlier window has every day. */
export function mergeWindows(cur: { key: string; clicks: number; impressions: number; position: number | null }[], prev: { key: string; clicks: number; impressions: number; position: number | null }[], prevComplete: boolean): GscRow[] {
  const before = new Map(prev.map((r) => [r.key, r] as const));
  const keys = new Set([...cur.map((r) => r.key), ...prev.map((r) => r.key)]);
  const now = new Map(cur.map((r) => [r.key, r] as const));
  return [...keys].map((key) => {
    const c = now.get(key), p = before.get(key);
    return {
      key, clicks: c?.clicks ?? 0, impressions: c?.impressions ?? 0, position: c?.position ?? null,
      prevClicks: p ? p.clicks : prevComplete ? 0 : null, prevImpressions: p ? p.impressions : prevComplete ? 0 : null, prevPosition: p?.position ?? null,
    };
  });
}

/** null = no Search Console property for the site's domain on this account. */
export async function gscBreakdown(user: number, site: { id: number; domain: string }, dimension: "page" | "query"): Promise<GscBreakdown | null> {
  const asset = await gscAssetFor(user, site.domain);
  if (!asset) return null;
  // The two windows end at the newest day synced for the site as a whole (dimension 'date'), the same as the summary.
  const { rows: [w] } = await pool.query(
    `WITH last AS (SELECT max(date) AS d FROM gsc_analytics WHERE asset_id=$1 AND dimension='date' AND date >= current_date - 70)
     SELECT last.d::text AS through,
            (SELECT count(DISTINCT date)::int FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > last.d - ${GSC_WINDOW} AND date <= last.d) AS days,
            (SELECT count(DISTINCT date)::int FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > last.d - ${2 * GSC_WINDOW} AND date <= last.d - ${GSC_WINDOW}) AS prev_days
       FROM last`, [asset.id, dimension]);
  if (!w?.through) return { dimension, property: asset.external_id, through: null, days: 0, previousDays: 0, comparable: false, rows: [], more: 0, total: 0 };
  const agg = (fromOffset: number, toOffset: number) => pool.query(
    `SELECT key, sum(clicks)::float8 AS clicks, sum(impressions)::float8 AS impressions,
            CASE WHEN sum(impressions) > 0 THEN sum(position * impressions) / sum(impressions) END::float8 AS position
       FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > $3::date - ${fromOffset} AND date <= $3::date - ${toOffset} GROUP BY key`,
    [asset.id, dimension, w.through]).then((r) => r.rows.map((x: any) => ({ key: String(x.key), clicks: Math.round(x.clicks), impressions: Math.round(x.impressions), position: x.position == null ? null : Math.round(x.position * 10) / 10 })));
  const [cur, prev] = await Promise.all([agg(GSC_WINDOW, 0), agg(2 * GSC_WINDOW, GSC_WINDOW)]);
  const prevComplete = w.prev_days >= GSC_WINDOW;
  let rows = mergeWindows(cur, prev, prevComplete);
  if (dimension === "query") {
    const { rows: kws } = await pool.query("SELECT DISTINCT lower(keyword) AS k FROM seo_keywords WHERE site_id=$1 AND user_id=$2", [site.id, user]);
    const tracked = new Set(kws.map((k: any) => k.k));
    rows = rows.map((r) => ({ ...r, tracked: tracked.has(r.key.toLowerCase().replace(/\s+/g, " ").trim()) }));
  }
  // The busiest in EITHER window are kept, so a page that lost all its clicks is still listed among the losers.
  const weight = (r: GscRow) => Math.max(r.clicks, r.prevClicks ?? 0);
  rows.sort((a, b) => weight(b) - weight(a) || b.impressions - a.impressions || a.key.localeCompare(b.key));
  return { dimension, property: asset.external_id, through: w.through, days: w.days, previousDays: w.prev_days, comparable: w.days >= GSC_WINDOW && prevComplete, rows: rows.slice(0, GSC_ROWS), more: Math.max(0, rows.length - GSC_ROWS), total: rows.length };
}
