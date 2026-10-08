/**
 * Google's own numbers by page and by search: Search Console clicks, impressions and position for each page of the
 * site (or each search it was shown for) over the last 28 synced days and the 28 before — from the gsc_analytics rows
 * the Search Console page already syncs (server/gsc). Free.
 *
 * What it rests on, and what it does not claim: the windows end at the newest day synced (Google runs two or three
 * days behind); "days with data" counts days that have rows, which is not proof every row of those days arrived. A
 * page or search Google did not return for a window is "not returned" there — never a zero: Google leaves out rare
 * searches and caps how many rows it returns. A change is shown only where both windows returned it and both have every
 * day with data.
 */
import { pool } from "../db";

export const GSC_ROWS = 500, GSC_WINDOW = 28;
export type GscRow = {
  key: string; /** null = not returned for this window. */ clicks: number | null; impressions: number | null; position: number | null;
  /** The 28 days before; null = not returned for that window (never a zero). */ prevClicks: number | null; prevImpressions: number | null; prevPosition: number | null;
  /** Searches only: one of the site's tracked keywords. */ tracked?: boolean;
};
export type GscBreakdown = {
  dimension: "page" | "query"; property: string; through: string | null; days: number; previousDays: number; comparable: boolean;
  /** Some of these 56 days are still being read from Google for this report, or a read of them failed: rows may be missing, so no change is shown. */ incomplete: boolean;
  /** "domain" = every address of the domain, sub-domains included; "prefix" = only addresses under that URL. */ coverage: "domain" | "prefix";
  /** The other properties of this site on the account (not used here). */ others: string[];
  rows: GscRow[]; /** More pages/searches than are listed (the busiest are kept). */ more: number; total: number;
};

/**
 * The site's Search Console property: of this account's properties for the domain, the one with the most recent data
 * OF THE REPORT ASKED FOR (by page / by search — a property whose totals are fresh but whose page report never arrived
 * does not win), the domain property when it is as fresh as any. The others are named on the page.
 */
export async function gscAssetFor(user: number, domain: string, dimension: "date" | "page" | "query" = "date"): Promise<{ id: number; external_id: string; others: string[] } | null> {
  const { rows } = await pool.query(
    `SELECT a.id, a.external_id, (SELECT max(date) FROM gsc_analytics g WHERE g.asset_id=a.id AND g.dimension=$3) AS last
       FROM edge_assets a WHERE a.user_id=$1 AND a.provider='gsc' AND a.external_id = ANY($2::text[])
      ORDER BY last DESC NULLS LAST, (a.external_id LIKE 'sc-domain:%') DESC, a.id`,
    [user, [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`, `sc-domain:www.${domain}`], dimension]);
  if (!rows.length) return null;
  return { id: rows[0].id, external_id: rows[0].external_id, others: rows.slice(1).map((r: any) => r.external_id) };
}

/** Pure: rows of one dimension for the two windows, merged. `prevComplete` = the earlier window has every day. */
/** Pure: rows of one dimension for the two windows, merged. A key one window did not return is null there, never 0. */
export function mergeWindows(cur: { key: string; clicks: number; impressions: number; position: number | null }[], prev: { key: string; clicks: number; impressions: number; position: number | null }[]): GscRow[] {
  const before = new Map(prev.map((r) => [r.key, r] as const));
  const keys = new Set([...cur.map((r) => r.key), ...prev.map((r) => r.key)]);
  const now = new Map(cur.map((r) => [r.key, r] as const));
  return [...keys].map((key) => {
    const c = now.get(key), p = before.get(key);
    return { key, clicks: c?.clicks ?? null, impressions: c?.impressions ?? null, position: c?.position ?? null, prevClicks: p?.clicks ?? null, prevImpressions: p?.impressions ?? null, prevPosition: p?.position ?? null };
  });
}

/** null = no Search Console property for the site's domain on this account. */
export async function gscBreakdown(user: number, site: { id: number; domain: string }, dimension: "page" | "query"): Promise<GscBreakdown | null> {
  const asset = await gscAssetFor(user, site.domain, dimension);
  if (!asset) return null;
  // The two windows end at the newest day synced for the site as a whole (dimension 'date'), the same as the summary.
  const { rows: [w] } = await pool.query(
    `WITH last AS (SELECT max(date) AS d FROM gsc_analytics WHERE asset_id=$1 AND dimension='date' AND date >= current_date - 70)
     SELECT last.d::text AS through,
            (SELECT count(DISTINCT date)::int FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > last.d - ${GSC_WINDOW} AND date <= last.d) AS days,
            (SELECT count(DISTINCT date)::int FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > last.d - ${2 * GSC_WINDOW} AND date <= last.d - ${GSC_WINDOW}) AS prev_days
       FROM last`, [asset.id, dimension]);
  const coverage = asset.external_id.startsWith("sc-domain:") ? "domain" as const : "prefix" as const;
  if (!w?.through) return { dimension, property: asset.external_id, coverage, others: asset.others, through: null, days: 0, previousDays: 0, comparable: false, incomplete: false, rows: [], more: 0, total: 0 };
  // A read of these days for this report that has not finished (queued, running, or failed — a long report comes in
  // pages of 25,000 rows, each its own job) and was not replaced since by a finished full read of the same days: some
  // rows may be missing, so the two windows are not compared.
  const { rows: [inc] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM edge_jobs j WHERE j.asset_id=$1 AND j.kind='analytics' AND j.payload->>'dimension'=$2 AND j.state <> 'done'
        AND (j.payload->>'end')::date > $3::date - ${2 * GSC_WINDOW} AND (j.payload->>'start')::date <= $3::date
        AND NOT EXISTS (SELECT 1 FROM edge_jobs k WHERE k.asset_id=j.asset_id AND k.kind='analytics' AND k.payload->>'dimension'=$2 AND k.state='done'
          AND k.payload->>'start'=j.payload->>'start' AND k.payload->>'end'=j.payload->>'end' AND (k.payload->>'offset')::int=0 AND k.id > j.id)) AS v`,
    [asset.id, dimension, w.through]).catch(() => ({ rows: [{ v: false }] }));
  const incomplete = !!inc?.v;
  const agg = (fromOffset: number, toOffset: number) => pool.query(
    `SELECT key, sum(clicks)::float8 AS clicks, sum(impressions)::float8 AS impressions,
            CASE WHEN sum(impressions) > 0 THEN sum(position * impressions) / sum(impressions) END::float8 AS position
       FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date > $3::date - ${fromOffset} AND date <= $3::date - ${toOffset} GROUP BY key`,
    [asset.id, dimension, w.through]).then((r) => r.rows.map((x: any) => ({ key: String(x.key), clicks: Math.round(x.clicks), impressions: Math.round(x.impressions), position: x.position == null ? null : Math.round(x.position * 10) / 10 })));
  const [cur, prev] = await Promise.all([agg(GSC_WINDOW, 0), agg(2 * GSC_WINDOW, GSC_WINDOW)]);
  const prevComplete = w.prev_days >= GSC_WINDOW;
  let rows = mergeWindows(cur, prev);
  if (dimension === "query") {
    const { rows: kws } = await pool.query("SELECT DISTINCT lower(keyword) AS k FROM seo_keywords WHERE site_id=$1 AND user_id=$2", [site.id, user]);
    const tracked = new Set(kws.map((k: any) => k.k));
    rows = rows.map((r) => ({ ...r, tracked: tracked.has(r.key.toLowerCase().replace(/\s+/g, " ").trim()) }));
  }
  // The busiest in EITHER window are kept, so a page that lost all its clicks is still listed among the losers.
  const weight = (r: GscRow) => Math.max(r.clicks ?? 0, r.prevClicks ?? 0);
  rows.sort((a, b) => weight(b) - weight(a) || (b.impressions ?? b.prevImpressions ?? 0) - (a.impressions ?? a.prevImpressions ?? 0) || a.key.localeCompare(b.key));
  return { dimension, property: asset.external_id, coverage, others: asset.others, through: w.through, days: w.days, previousDays: w.prev_days, comparable: w.days >= GSC_WINDOW && prevComplete && !incomplete, incomplete, rows: rows.slice(0, GSC_ROWS), more: Math.max(0, rows.length - GSC_ROWS), total: rows.length };
}
