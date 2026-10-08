/**
 * Opportunities (Site Explorer): what to work on next, from one lookup of the
 * keywords a site already ranks in the top 20 for (the 500 most searched).
 *   - within reach: on page one or two but not in the first three
 *   - losing ground: fell since the source last looked
 *   - pages: which page ranks for what
 *   - on the home page: searches only the home page ranks for
 * The source keeps one ranking page per keyword, so two pages of the same site
 * competing for one search cannot be seen here — and is not claimed.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, type DfsTask } from "./dataforseo";
import { estimateLabsUsd } from "./pricing";

export const OPP_ROWS = 500;
/** The most one Opportunities lookup can cost us (a site with fewer keywords costs less). */
export const OPP_ESTIMATE_USD = estimateLabsUsd(OPP_ROWS);
/** Deepest position counted: page two. */
export const OPP_MAX_POSITION = 20;
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
  keyword: string; position: number; /** Where it was when the source looked before; null = unknown or new. */ previous: number | null;
  volume: number | null; difficulty: number | null; cpc: number | null; /** Estimated visits a month from this keyword. */ traffic: number;
  url: string; path: string;
};
export function parseOppKeyword(item: any): OppKeyword | null {
  const kd = item?.keyword_data, si = item?.ranked_serp_element?.serp_item;
  const keyword = typeof kd?.keyword === "string" ? kd.keyword.trim() : "";
  const position = num(si?.rank_group), url = safeHttpUrl(si?.url);
  if (!keyword || position === null || position < 1 || !url) return null;
  const previous = num(si?.rank_changes?.previous_rank_absolute);
  let path = "/";
  try { const u = new URL(url); path = (u.pathname || "/") + u.search; } catch { /* keep "/" */ }
  return {
    keyword: keyword.slice(0, 200), position, previous: previous !== null && previous >= 1 ? previous : null,
    volume: num(kd?.keyword_info?.search_volume), difficulty: num(kd?.keyword_properties?.keyword_difficulty) === null ? null : Math.round(kd.keyword_properties.keyword_difficulty),
    cpc: num(kd?.keyword_info?.cpc) === null ? null : Math.round(kd.keyword_info.cpc * 100) / 100, traffic: Math.round((num(si?.etv) ?? 0) * 10) / 10, url, path,
  };
}

export type OppPage = { url: string; path: string; keywords: number; traffic: number; top3: number; top10: number; best: { keyword: string; position: number; volume: number | null } };
export type Opportunities = {
  domain: string; locationCode: number; languageCode: string; fetchedAt: string;
  /** Keywords the site ranks in the top 20 for, in all; `analysed` of them (the most searched) are looked at here. */
  total: number | null; analysed: number;
  /** Positions 4-20, most searched first. */
  within: OppKeyword[];
  /** Fell three places or more since the source's previous look, most searched first. */
  falling: OppKeyword[];
  pages: OppPage[];
  /** Ranked by the home page only, outside the first three. */
  home: OppKeyword[];
  summary: { withinCount: number; withinVolume: number; fallingCount: number; pages: number; homeCount: number; homeShare: number | null };
};

const byVolume = (a: OppKeyword, b: OppKeyword) => (b.volume ?? -1) - (a.volume ?? -1) || a.position - b.position || a.keyword.localeCompare(b.keyword);

/** Pure: the four lists from the rows the source returned. */
export function buildOpportunities(input: { domain: string; locationCode: number; languageCode: string; fetchedAt?: string }, items: any[], total: number | null): Opportunities {
  const rows = items.map(parseOppKeyword).filter((r): r is OppKeyword => !!r && r.position <= OPP_MAX_POSITION);
  const within = rows.filter((r) => r.position >= 4).sort(byVolume);
  const falling = rows.filter((r) => r.previous !== null && r.position - r.previous >= 3).sort(byVolume);
  const pageMap = new Map<string, OppKeyword[]>();
  for (const r of rows) pageMap.set(r.path, [...(pageMap.get(r.path) ?? []), r]);
  const pages = [...pageMap.entries()].map(([path, list]): OppPage => {
    const best = [...list].sort((a, b) => b.traffic - a.traffic || byVolume(a, b))[0];
    return {
      url: best.url, path, keywords: list.length, traffic: Math.round(list.reduce((a, r) => a + r.traffic, 0)),
      top3: list.filter((r) => r.position <= 3).length, top10: list.filter((r) => r.position <= 10).length, best: { keyword: best.keyword, position: best.position, volume: best.volume },
    };
  }).sort((a, b) => b.traffic - a.traffic || b.keywords - a.keywords || a.path.localeCompare(b.path));
  const onHome = rows.filter((r) => r.path === "/");
  // Only worth saying when the site has other pages that rank: a one-page site has nowhere else to send them.
  const home = pages.length > 1 ? onHome.filter((r) => r.position >= 4).sort(byVolume) : [];
  return {
    domain: input.domain, locationCode: input.locationCode, languageCode: input.languageCode, fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    total, analysed: rows.length, within: within.slice(0, 100), falling: falling.slice(0, 100), pages: pages.slice(0, 100), home: home.slice(0, 100),
    summary: {
      withinCount: within.length, withinVolume: within.reduce((a, r) => a + (r.volume ?? 0), 0), fallingCount: falling.length, pages: pages.length,
      homeCount: home.length, homeShare: rows.length ? Math.round((onHome.length / rows.length) * 100) : null,
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
