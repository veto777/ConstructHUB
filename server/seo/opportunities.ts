/**
 * Opportunities (Site Explorer): what to work on next, from one lookup of the
 * keywords a site already ranks in the top 20 for (the 500 most searched).
 *   - within reach: on page one or two but not in the first three
 *   - losing ground: fell since the source last looked
 *   - pages: which page was returned for which searches
 *   - home page: searches for which the page returned is the home page
 * The source keeps ONE ranking page per keyword, so this can say which page it returned for a search —
 * never that no other page ranks, nor that two pages compete. Every row bought is kept and returned.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, type DfsTask } from "./dataforseo";
import { estimateLabsUsd } from "./pricing";

export const OPP_ROWS = 500;
/** The most one Opportunities lookup can cost us (a site with fewer keywords costs less). */
export const OPP_ESTIMATE_USD = estimateLabsUsd(OPP_ROWS);
/** Deepest position counted: page two. */
export const OPP_MAX_POSITION = 20;
/** A fall smaller than this is noise. */
export const OPP_FALL = 3;
export const oppDeps = { request };

export const oppInput = z.object({
  domain: z.string().min(3).max(253),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
}).strict();

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type OppKeyword = {
  keyword: string;
  /** Position among the organic results (what a customer would call "position 5"). */
  position: number;
  /**
   * Places lost since the source last looked, counted the only way the source lets both be compared: among EVERYTHING
   * on the results page (ads, map pack and all), now against then. null = unknown, new, or not a fall.
   */
  fell: number | null;
  volume: number | null; difficulty: number | null; cpc: number | null; /** Estimated visits a month from this keyword. */ traffic: number;
  /** The page the source returned for this search — the full address, host included. */
  url: string;
  /** That page is the site's home page. */
  home: boolean;
};

/** The page's identity: host and path, without a trailing slash difference, "www." or a query string that is only tracking. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const tracking = /^(utm_[a-z]+|gclid|fbclid|msclkid|srsltid|ref)$/i;
    const kept = [...u.searchParams.entries()].filter(([k]) => !tracking.test(k));
    const query = kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}${query}`;
  } catch { return url; }
}
/** Is this address the home page of `domain` (with or without www, a trailing slash or tracking parameters)? A sub-domain's front page is not. */
export const isHomePage = (url: string, domain: string) => pageKey(url) === `${domain.toLowerCase().replace(/^www\./, "")}/`;

export function parseOppKeyword(item: any, domain: string): OppKeyword | null {
  const kd = item?.keyword_data, si = item?.ranked_serp_element?.serp_item;
  const keyword = typeof kd?.keyword === "string" ? kd.keyword.trim() : "";
  const position = num(si?.rank_group), url = safeHttpUrl(si?.url);
  if (!keyword || position === null || position < 1 || !url) return null;
  const absolute = num(si?.rank_absolute), before = num(si?.rank_changes?.previous_rank_absolute);
  const fell = absolute !== null && before !== null && before >= 1 && absolute > before ? absolute - before : null;
  return {
    keyword: keyword.slice(0, 200), position, fell,
    volume: num(kd?.keyword_info?.search_volume), difficulty: num(kd?.keyword_properties?.keyword_difficulty) === null ? null : Math.round(kd.keyword_properties.keyword_difficulty),
    cpc: num(kd?.keyword_info?.cpc) === null ? null : Math.round(kd.keyword_info.cpc * 100) / 100, traffic: Math.round((num(si?.etv) ?? 0) * 10) / 10, url, home: isHomePage(url, domain),
  };
}

export type OppPage = { url: string; key: string; home: boolean; keywords: number; traffic: number; top3: number; top10: number; best: { keyword: string; position: number; volume: number | null } };
export type Opportunities = {
  domain: string; locationCode: number; languageCode: string; fetchedAt: string;
  /** Keywords the site ranks in the top 20 for, in all; `rows` holds the most searched of them (at most 500). */
  total: number | null;
  /** Every row bought, most searched first. The lists on the page are views of these. */
  rows: OppKeyword[];
  /** One entry per page returned, by the visits its searches bring. Its keywords are the rows with the same page. */
  pages: OppPage[];
  summary: { analysed: number; withinCount: number; withinVolume: number; fallingCount: number; pages: number; homeCount: number; /** Share of the analysed searches for which the page returned is the home page. */ homeShare: number | null };
};

const byVolume = (a: OppKeyword, b: OppKeyword) => (b.volume ?? -1) - (a.volume ?? -1) || a.position - b.position || a.keyword.localeCompare(b.keyword);
export const isWithin = (r: OppKeyword) => r.position >= 4;
export const isFalling = (r: OppKeyword) => r.fell !== null && r.fell >= OPP_FALL;
/** Returned on the home page and outside the first three. */
export const isHomeOnly = (r: OppKeyword) => r.home && r.position >= 4;

/** Pure: the rows the source returned, the pages among them, and the counts. */
export function buildOpportunities(input: { domain: string; locationCode: number; languageCode: string; fetchedAt?: string }, items: any[], total: number | null): Opportunities {
  const rows = items.map((i) => parseOppKeyword(i, input.domain)).filter((r): r is OppKeyword => !!r && r.position <= OPP_MAX_POSITION).sort(byVolume);
  const pageMap = new Map<string, OppKeyword[]>();
  for (const r of rows) { const k = pageKey(r.url); pageMap.set(k, [...(pageMap.get(k) ?? []), r]); }
  const pages = [...pageMap.entries()].map(([key, list]): OppPage => {
    const best = [...list].sort((a, b) => b.traffic - a.traffic || byVolume(a, b))[0];
    return {
      url: best.url, key, home: best.home, keywords: list.length, traffic: Math.round(list.reduce((a, r) => a + r.traffic, 0)),
      top3: list.filter((r) => r.position <= 3).length, top10: list.filter((r) => r.position <= 10).length, best: { keyword: best.keyword, position: best.position, volume: best.volume },
    };
  }).sort((a, b) => b.traffic - a.traffic || b.keywords - a.keywords || a.key.localeCompare(b.key));
  const within = rows.filter(isWithin);
  return {
    domain: input.domain, locationCode: input.locationCode, languageCode: input.languageCode, fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    total, rows, pages,
    summary: {
      analysed: rows.length, withinCount: within.length, withinVolume: within.reduce((a, r) => a + (r.volume ?? 0), 0), fallingCount: rows.filter(isFalling).length, pages: pages.length,
      homeCount: rows.filter(isHomeOnly).length, homeShare: rows.length ? Math.round((rows.filter((r) => r.home).length / rows.length) * 100) : null,
    },
  };
}

export const oppRequest = (input: { domain: string; locationCode: number; languageCode: string }) => ({
  target: input.domain, location_code: input.locationCode, language_code: input.languageCode, item_types: ["organic"], limit: OPP_ROWS,
  filters: ["ranked_serp_element.serp_item.rank_group", "<=", OPP_MAX_POSITION], order_by: ["keyword_data.keyword_info.search_volume,desc"],
});

export async function fetchOpportunities(input: { domain: string; locationCode: number; languageCode: string }): Promise<{ data: Opportunities; costUsd: number }> {
  const task: DfsTask = assertOk(await oppDeps.request("POST", "/dataforseo_labs/google/ranked_keywords/live", [oppRequest(input)]), { treatNoResultsAsEmpty: true });
  return { data: buildOpportunities(input, taskItems(task), num(task.result?.[0]?.total_count)), costUsd: typeof task.cost === "number" ? task.cost : 0 };
}
