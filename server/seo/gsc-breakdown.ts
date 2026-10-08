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
  /** Whether every read finished could not be checked just now (then `incomplete` is true too). */ completenessUnknown?: boolean;
  /** "domain" = every address of the domain, sub-domains included; "prefix" = only addresses under that URL. */ coverage: "domain" | "prefix";
  /** The other properties of this site on the account (not used here). */ others: string[];
  rows: GscRow[]; /** More pages/searches than are listed (the busiest are kept). */ more: number; total: number;
};

/**
 * The site's Search Console property: of this account's properties for the domain, the one with the most recent data
 * OF THE REPORT ASKED FOR (by page / by search — a property whose totals are fresh but whose page report never arrived
 * does not win; the site's totals, 'date', for the headline numbers), the domain property when it is as fresh as any.
 * The others are named on the page.
 */
export async function gscAssetFor(user: number, domain: string, dimension: "date" | "page" | "query" = "date"): Promise<{ id: number; external_id: string; syncedAt: string | null; others: string[] } | null> {
  const { rows } = await pool.query(
    `SELECT a.id, a.external_id, a.synced_at, (SELECT max(date) FROM gsc_analytics g WHERE g.asset_id=a.id AND g.dimension=$3) AS last
       FROM edge_assets a WHERE a.user_id=$1 AND a.provider='gsc' AND a.external_id = ANY($2::text[])
      ORDER BY last DESC NULLS LAST, (a.external_id LIKE 'sc-domain:%') DESC, a.id`,
    [user, [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`, `sc-domain:www.${domain}`], dimension]);
  if (!rows.length) return null;
  return { id: rows[0].id, external_id: rows[0].external_id, syncedAt: rows[0].synced_at ? new Date(rows[0].synced_at).toISOString() : null, others: rows.slice(1).map((r: any) => r.external_id) };
}

/**
 * Whether every read of one report's 56 days (ending `through`) has finished, from the edge_jobs the sync records.
 * Google sends a long report in pages of 25,000 rows, each its own job, and a page still waiting may belong to an
 * earlier read whose next page a newer read could not queue again (one waiting copy of a job at a time) — so ANY read
 * still queued or running means incomplete, whatever finished after it. A failed read counts until a full read of the
 * same days (its first page) is queued after it and finished — and that read's own later pages are then judged the
 * same way. Positive evidence is needed the other way too: every one of the 56 days covered by a finished full read.
 * A check that cannot be made is "not known", never "complete" — so is a database with no record of reads at all
 * (rows synced with no record of how, older imports, prove nothing either way); `unknown` then, and `incomplete` too.
 * One rule for the by-page / by-search reports and the headline numbers (searchConsoleSummary).
 */
export async function gscReadCompleteness(assetId: number, dimension: "date" | "page" | "query", through: string): Promise<{ incomplete: boolean; unknown: boolean }> {
  const jobsTable = await pool.query("SELECT to_regclass('edge_jobs') IS NOT NULL AS ok").then((r) => !!r.rows[0]?.ok, () => false);
  const inc = !jobsTable ? null : await pool.query(
    `SELECT
       -- Positive evidence: every one of the 56 days was covered by a finished full read (its first page) of this report.
       NOT EXISTS (SELECT 1 FROM generate_series(($4::text)::date + 1, ($3::text)::date, interval '1 day') g(day)
          WHERE NOT EXISTS (SELECT 1 FROM edge_jobs k WHERE k.asset_id=$1 AND k.kind='analytics' AND k.payload->>'dimension'=$2 AND k.state='done'
                  AND k.payload->>'offset'='0' AND k.payload->>'start' <= to_char(g.day, 'YYYY-MM-DD') AND k.payload->>'end' >= to_char(g.day, 'YYYY-MM-DD'))) AS covered,
       EXISTS (SELECT 1 FROM edge_jobs j WHERE j.asset_id=$1 AND j.kind='analytics' AND j.payload->>'dimension'=$2
        AND j.payload->>'end' > $4::text AND j.payload->>'start' <= $3::text
        AND (j.state IN ('queued','running')
          OR (j.state <> 'done' AND NOT EXISTS (SELECT 1 FROM edge_jobs k WHERE k.asset_id=j.asset_id AND k.kind='analytics' AND k.payload->>'dimension'=$2 AND k.state='done'
                AND k.payload->>'start'=j.payload->>'start' AND k.payload->>'end'=j.payload->>'end' AND k.payload->>'offset'='0' AND k.id > j.id)))) AS v`,
    [assetId, dimension, String(through), new Date(Date.parse(`${through}T00:00:00Z`) - 2 * GSC_WINDOW * 864e5).toISOString().slice(0, 10)]).then((r) => r.rows[0], () => null);
  return { incomplete: inc ? !!inc.v || !inc.covered : true, unknown: !inc || (!inc.v && !inc.covered) };
}

/** The headline Search Console numbers (the rank tracker tile and the client report), as the summary answers them. */
export type GscSummary = {
  property: string; syncedAt: string | null;
  /** A period with nothing synced is not known (null), never a measured zero. `days` says how much of each 28 is there. */
  clicks: number | null; impressions: number | null; position: number | null; previousClicks: number | null; previousImpressions: number | null;
  days: number; previousDays: number; /** The newest day synced; the 28 days end here. */ through: string | null;
  /** A read of these 56 days is still running or failed, or whether every read finished could not be established: the counts may be short, so no change is shown. */
  incomplete: boolean;
  /** `incomplete` because it could not be checked (no record of reads), not because a read is known to be unfinished. */
  completenessUnknown?: boolean;
  /** Both windows have every day and every read of them finished: the difference between them is a real change, not missing days. */
  comparable: boolean;
};
/**
 * Search Console clicks / impressions for the site's domain over the last 28 days (and the 28 before), from the
 * gsc_analytics rows the Search Console page already syncs (server/gsc). null when no property matches the domain.
 * The property and the completeness rules are the by-page / by-search reports' own (gscAssetFor, gscReadCompleteness),
 * so the headline numbers never claim more than the breakdowns do.
 */
export async function searchConsoleSummary(user: number, domain: string): Promise<GscSummary | null> {
  const asset = await gscAssetFor(user, domain, "date");
  if (!asset) return null;
  // Two equal 28-day windows counted back from the newest day that has been synced (Google runs two or three days
  // behind), so the newer window is not short just because today's numbers do not exist yet.
  const { rows } = await pool.query(
    `WITH last AS (SELECT max(date) AS d FROM gsc_analytics WHERE asset_id=$1 AND dimension='date' AND date >= current_date - 70)
     SELECT (g.date > last.d - ${GSC_WINDOW}) AS recent, sum(g.clicks)::float8 clicks, sum(g.impressions)::float8 impressions, count(DISTINCT g.date)::int AS days, max(last.d)::text AS through,
            CASE WHEN sum(g.impressions)>0 THEN sum(g.position*g.impressions)/sum(g.impressions) END::float8 AS position
       FROM gsc_analytics g, last WHERE g.asset_id=$1 AND g.dimension='date' AND g.date > last.d - ${2 * GSC_WINDOW} GROUP BY 1`, [asset.id]);
  const pick = (recent: boolean) => rows.find((r) => r.recent === recent);
  const cur = pick(true), prev = pick(false);
  const days = cur?.days ?? 0, previousDays = prev?.days ?? 0;
  const through = (cur?.through ?? prev?.through ?? null) as string | null;
  // Nothing synced in the last 70 days: no counts, and nothing to check the reads of.
  const read = through ? await gscReadCompleteness(asset.id, "date", through) : { incomplete: false, unknown: false };
  return {
    property: asset.external_id, syncedAt: asset.syncedAt,
    clicks: cur ? cur.clicks ?? 0 : null, impressions: cur ? cur.impressions ?? 0 : null, position: cur?.position != null ? Math.round(cur.position * 10) / 10 : null,
    previousClicks: prev ? prev.clicks ?? 0 : null, previousImpressions: prev ? prev.impressions ?? 0 : null,
    days, previousDays, through,
    incomplete: read.incomplete, ...(read.unknown ? { completenessUnknown: true } : {}),
    comparable: days === GSC_WINDOW && previousDays === GSC_WINDOW && !read.incomplete,
  };
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
  // Every read of these days for this report must be finished (gscReadCompleteness: the one rule).
  const { incomplete, unknown } = await gscReadCompleteness(asset.id, dimension, String(w.through));
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
  return { dimension, property: asset.external_id, coverage, others: asset.others, through: w.through, days: w.days, previousDays: w.prev_days, comparable: w.days >= GSC_WINDOW && prevComplete && !incomplete, incomplete, ...(unknown ? { completenessUnknown: true } : {}), rows: rows.slice(0, GSC_ROWS), more: Math.max(0, rows.length - GSC_ROWS), total: rows.length };
}
