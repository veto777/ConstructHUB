/**
 * Service-area planner: the customer's services down the side, the towns they serve across the top.
 * For every "service town" search: how often it is searched, whether the site ranks for it and
 * with which page — so the gaps (searched, but no ranking) and the weak spots (ranking, but not on
 * page one, or only with the home page) can be seen at a glance and sent to the action plan.
 * Two lookups for the whole table. What the numbers are NOT: local — they are nationwide counts for
 * those words, so a town name shared with another state counts both; and a search too rare to be
 * measured has no number (it is not zero).
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, type DfsTask } from "./dataforseo";
import { estimateLabsUsd } from "./pricing";
import { isHomePage } from "./opportunities";

export const PLANNER_MAX_SERVICES = 12;
export const PLANNER_MAX_TOWNS = 15;
/** The most cells one table may have (services x towns). */
export const PLANNER_MAX_CELLS = 150;
/** What the source accepts for one search: its length and its number of words. */
export const PLANNER_MAX_CHARS = 80;
export const PLANNER_MAX_WORDS = 10;
export const plannerDeps = { request };

const word = z.string().trim().min(2).max(60).regex(/^[\p{L}\p{N}][\p{L}\p{N} .,'&-]*$/u, "Letters, numbers and spaces only");
export const plannerInput = z.object({
  services: z.array(word).min(1).max(PLANNER_MAX_SERVICES),
  towns: z.array(word).min(1).max(PLANNER_MAX_TOWNS),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
}).strict();

/** Lower case, single spaces, no duplicates. A comma is a space ("Bellingham, WA" is one town). */
export const cleanTerms = (list: readonly string[]) => [...new Set(list.map((s) => s.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean))];
/** The first pairing the source would refuse (too long, or too many words), or null when every one is fine. */
export function plannerTooLong(services: readonly string[], towns: readonly string[]): string | null {
  for (const s of services) for (const t of towns) { const k = plannerKeyword(s, t); if (k.length > PLANNER_MAX_CHARS || k.split(" ").length > PLANNER_MAX_WORDS) return k; }
  return null;
}
/** Two lookups: the volumes of every "service town", and which of them the site ranks for. The most both can cost us. */
export const plannerEstimateUsd = (cells: number) => Math.round(2 * estimateLabsUsd(cells) * 1e6) / 1e6;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type PlannerCell = {
  service: string; town: string; keyword: string;
  /** Searches a month nationwide for these words; null = too few to be measured (not zero). */
  volume: number | null; difficulty: number | null; cpc: number | null;
  /** The site's position among the organic results, when it ranks in the first 100. */
  position: number | null; url: string | null; /** The page returned is the site's home page. */ home: boolean;
};
export type Planner = {
  domain: string; locationCode: number; languageCode: string; fetchedAt: string; services: string[]; towns: string[];
  cells: PlannerCell[];
  /** Counts that depend on a part that did not load are null (unknown), never zero. */
  summary: {
    cells: number; /** Searched, and the keyword database has no ranking for the site in its first 100. */ gaps: number | null; gapVolume: number | null;
    /** Ranking, but beyond the first three. */ weak: number | null; /** In the first three. */ strong: number | null;
    /** Too few searches to measure and no ranking: nothing known. */ unknown: number | null;
  };
  /** A part that did not load this time ("volumes" or "rankings"); its numbers are missing, not zero. */
  missing: string[];
};

export const plannerKeyword = (service: string, town: string) => `${service} ${town}`;
/** Pure: the table from what the two lookups returned (null = that lookup failed). */
export function buildPlanner(input: { domain: string; locationCode: number; languageCode: string; services: string[]; towns: string[]; fetchedAt?: string }, volumes: any[] | null, rankings: any[] | null): Planner {
  const vol = new Map<string, any>((volumes ?? []).map((i) => [String(i?.keyword ?? "").toLowerCase(), i] as const));
  const rank = new Map<string, any>();
  for (const i of rankings ?? []) {
    const k = String(i?.keyword_data?.keyword ?? "").toLowerCase(), si = i?.ranked_serp_element?.serp_item;
    const position = num(si?.rank_group);
    if (!k || position === null) continue;
    const have = rank.get(k);
    if (!have || position < have.position) rank.set(k, { position, url: safeHttpUrl(si?.url) }); // the best of them, if the source lists more than one
  }
  const cells: PlannerCell[] = [];
  for (const service of input.services) for (const town of input.towns) {
    const keyword = plannerKeyword(service, town), v = vol.get(keyword), r = rank.get(keyword);
    const difficulty = num(v?.keyword_properties?.keyword_difficulty), cpc = num(v?.keyword_info?.cpc);
    cells.push({
      service, town, keyword, volume: num(v?.keyword_info?.search_volume), difficulty: difficulty === null ? null : Math.round(difficulty), cpc: cpc === null ? null : Math.round(cpc * 100) / 100,
      position: r?.position ?? null, url: r?.url ?? null, home: !!r?.url && isHomePage(r.url, input.domain),
    });
  }
  const gaps = cells.filter((c) => c.position === null && (c.volume ?? 0) > 0);
  return {
    domain: input.domain, locationCode: input.locationCode, languageCode: input.languageCode, fetchedAt: input.fetchedAt ?? new Date().toISOString(), services: input.services, towns: input.towns, cells,
    summary: {
      cells: cells.length, gaps: rankings && volumes ? gaps.length : null, gapVolume: rankings && volumes ? gaps.reduce((a, c) => a + (c.volume ?? 0), 0) : null,
      weak: rankings ? cells.filter((c) => c.position !== null && c.position > 3).length : null, strong: rankings ? cells.filter((c) => c.position !== null && c.position <= 3).length : null,
      unknown: rankings && volumes ? cells.filter((c) => c.position === null && !(c.volume ?? 0)).length : null,
    },
    missing: [volumes ? null : "volumes", rankings ? null : "rankings"].filter((x): x is string => !!x),
  };
}

export const volumesRequest = (keywords: string[], loc: { locationCode: number; languageCode: string }) => ({ keywords, location_code: loc.locationCode, language_code: loc.languageCode });
export const rankingsRequest = (domain: string, keywords: string[], loc: { locationCode: number; languageCode: string }) => ({
  target: domain, location_code: loc.locationCode, language_code: loc.languageCode, item_types: ["organic"], limit: keywords.length, filters: ["keyword_data.keyword", "in", keywords],
});

/** Both lookups at once. One may fail (its part is then marked missing and not charged); both failing fails the table. */
export async function fetchPlanner(input: { domain: string; locationCode: number; languageCode: string; services: string[]; towns: string[] }): Promise<{ data: Planner; costUsd: number; customerUsd: number; costUnknown: boolean }> {
  const keywords = input.services.flatMap((s) => input.towns.map((t) => plannerKeyword(s, t)));
  let costUsd = 0, customerUsd = 0, costUnknown = false, firstError: unknown = null;
  const call = async (path: string, body: Record<string, unknown>): Promise<any[] | null> => {
    try {
      const task: DfsTask = assertOk(await plannerDeps.request("POST", path, [body]), { treatNoResultsAsEmpty: true });
      const cost = typeof task.cost === "number" ? task.cost : 0;
      costUsd += cost; customerUsd += cost;
      return taskItems(task);
    } catch (e: any) {
      firstError ??= e;
      costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      return null;
    }
  };
  const [volumes, rankings] = await Promise.all([
    call("/dataforseo_labs/google/keyword_overview/live", volumesRequest(keywords, input)),
    call("/dataforseo_labs/google/ranked_keywords/live", rankingsRequest(input.domain, keywords, input)),
  ]);
  if (!volumes && !rankings) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError ?? "The lookups failed.")), { costUsd, costUnknown });
  return { data: buildPlanner(input, volumes, rankings), costUsd, customerUsd, costUnknown };
}
