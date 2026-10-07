/**
 * DataForSEO cost estimator — a raw-USD UPPER BOUND for one call, computed
 * from the request before it is sent, so the monthly cap (server/seo/budget.ts)
 * can refuse a call before it costs anything.
 *
 * Prices are the ones on DataForSEO's own pricing pages, fetched 2026-10-06
 * (analysis in the OpenSEO report; sources listed at the bottom). Nothing here
 * is guessed: when a shape is not priced on the vendor page it is not
 * estimated — the endpoint is simply not offered.
 *
 * Shape and the operator rule follow OpenSEO's `src/server/lib/dataforseo/pricing.ts`
 * and `src/shared/rank-tracking.ts` (MIT, (c) 2026 Ben Senescu). One difference:
 * OpenSEO measured extra SERP pages at 75% of the first page; the vendor page
 * says "multiply for each 10 search engine results", so this estimator charges
 * every page at the full per-page rate — a bound, never an undercount.
 */

/** Google Organic SERP, per page of 10 results (dataforseo.com/pricing/google-serp/google-organic-serp-api). */
export const SERP_PAGE_USD = { standard: 0.0006, priority: 0.0012, live: 0.002 } as const;
export type SerpQueue = keyof typeof SERP_PAGE_USD;
/** "Multiply by 5 for each parameter used" — search operators in the keyword. */
export const SERP_OPERATOR_MULTIPLIER = 5;
/** DataForSEO Labs, Google — all other endpoints (ranked keywords, suggestions, intersection, …). */
export const LABS_TASK_USD = 0.012;
export const LABS_ITEM_USD = 0.00012;
/** Keywords Data — Google Ads search_volume, per task (up to 1,000 keywords). */
export const ADS_TASK_USD = { standard: 0.06, live: 0.09 } as const;
/** Backlinks API, every endpoint: per request + per row (up to 1,000 rows). */
export const BACKLINKS_REQUEST_USD = 0.024;
export const BACKLINKS_ROW_USD = 0.000036;
/** DataForSEO's minimum top-up ("the minimum payment amount is $50"). */
export const MINIMUM_DEPOSIT_USD = 50;

// Google bills 5x when the keyword contains an advanced search operator
// (docs.dataforseo.com/v3/serp/google/organic/live/advanced). "contains", so
// match anywhere; a false match only over-holds.
const SERP_OPERATOR_KEYWORD =
  /(allinanchor|allintext|allintitle|allinurl|cache|define|definition|filetype|id|inanchor|info|intext|intitle|inurl|link|site):/i;

export function serpKeywordMultiplier(keyword: string): number {
  return SERP_OPERATOR_KEYWORD.test(keyword) ? SERP_OPERATOR_MULTIPLIER : 1;
}

/** DataForSEO bills SERPs in pages of 10; depth outside 10–100 is rejected. */
export function clampSerpDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 10;
  return Math.min(100, Math.max(10, Math.ceil(depth / 10) * 10));
}

/** One SERP at `depth` results: pages × per-page price × operator multiplier. */
export function serpUsd(depth: number, queue: SerpQueue, keyword = ""): number {
  const pages = clampSerpDepth(depth) / 10;
  return round6(pages * SERP_PAGE_USD[queue] * serpKeywordMultiplier(keyword));
}

export type DeviceSet = "desktop" | "mobile" | "both";
export const devicesOf = (set: DeviceSet): Array<"desktop" | "mobile"> =>
  set === "both" ? ["desktop", "mobile"] : [set];

/** A whole rank check: every keyword × every device, each its own SERP. */
export function estimateRankCheckUsd(keywords: readonly string[], devices: DeviceSet, depth: number, queue: SerpQueue = "standard"): { serps: number; usd: number } {
  const n = devicesOf(devices).length;
  let usd = 0;
  for (const k of keywords) usd += n * serpUsd(depth, queue, k);
  return { serps: keywords.length * n, usd: round6(usd) };
}

/** Any Labs "all other endpoints" call returning up to `items` rows. */
export function estimateLabsUsd(items: number): number {
  return round6(LABS_TASK_USD + Math.max(0, items) * LABS_ITEM_USD);
}

/** Google Ads search_volume: one task per 1,000 keywords. */
export function estimateAdsVolumeUsd(keywordCount: number, mode: keyof typeof ADS_TASK_USD = "live"): number {
  const tasks = Math.max(1, Math.ceil(keywordCount / 1000));
  return round6(tasks * ADS_TASK_USD[mode]);
}

/** One Backlinks API request returning up to `rows` rows. */
export function estimateBacklinksUsd(rows: number): number {
  return round6(BACKLINKS_REQUEST_USD + Math.max(0, rows) * BACKLINKS_ROW_USD);
}

/** The monthly backlink snapshot: summary (1 row) + the top `rows` backlinks. */
export function estimateBacklinkSnapshotUsd(rows: number): number {
  return round6(estimateBacklinksUsd(1) + estimateBacklinksUsd(rows));
}

/** Weeks per month used in the monthly projections (365.25 / 7 / 12). */
export const WEEKS_PER_MONTH = 4.33;

/** Projected monthly rank-tracking bill for a site checked weekly. */
export function projectMonthlyRankTrackingUsd(keywords: readonly string[], devices: DeviceSet, depth: number): number {
  return round6(estimateRankCheckUsd(keywords, devices, depth).usd * WEEKS_PER_MONTH);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * What the "Connect DataForSEO" card quotes. Only figures from the vendor
 * pages fetched 2026-10-06 (the OpenSEO report); the UI prints these, never
 * its own numbers.
 */
export const PRICE_SHEET = {
  fetchedOn: "2026-10-06",
  minimumDepositUsd: MINIMUM_DEPOSIT_USD,
  lines: [
    { what: "Google organic SERP, standard queue (what the weekly rank check uses)", price: "$0.0006 per SERP of 10 results; ×N for N pages deep", source: "https://dataforseo.com/pricing/google-serp/google-organic-serp-api" },
    { what: "Google organic SERP, live (instant checks)", price: "$0.002 per SERP of 10 results", source: "https://dataforseo.com/pricing/google-serp/google-organic-serp-api" },
    { what: "Keyword suggestions, ranked keywords, competitor gap (DataForSEO Labs)", price: "$0.012 per request + $0.00012 per keyword returned", source: "https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api" },
    { what: "Search volume (Google Ads data)", price: "$0.09 per request, up to 1,000 keywords", source: "https://dataforseo.com/pricing/keywords-data/google-ads" },
    { what: "Backlinks summary and list", price: "$0.024 per request + $0.000036 per row ($0.06 per 1,000 rows)", source: "https://dataforseo.com/pricing/backlinks/backlinks" },
  ],
  example: "200 keywords × 2 devices = 400 SERPs a week at $0.0006 = $0.24 a week, about $1.04 a month at top-10 depth.",
} as const;
