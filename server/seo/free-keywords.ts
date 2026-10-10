/**
 * The Keywords Explorer on Google's own free numbers (./google-planner.ts), for a country or a US place.
 *
 *   freeIdeaPage      Matching terms / Related terms / Questions from Keyword Planner ideas: volume, cost per click
 *                     and competition, no charge. Difficulty and intent are not Google's to give (they stay on the
 *                     paid overview), so those filters are refused rather than ignored.
 *   freeOverview      a keyword's volume, cost per click, bids, competition and four years of monthly searches, no
 *                     charge. Difficulty, who ranks, the results page and traffic potential are the paid part
 *                     ("missing" until bought).
 *   keywordVolumes    volume + cost per click for a list of keywords: Google first (free), the paid source if Google
 *                     cannot answer.
 *
 * Owner, 2026-10-10: "cant we use google for free for many of these google tools?"
 */
import type { KeywordVolume } from "./dataforseo";
import { adsSearchVolume } from "./dataforseo";
import { plannerConfigured, plannerHistorical, type PlannerMetrics } from "./google-planner";
import type { KeywordIdeaRow, KeywordOverview, ReportFilters, ReportPage, KeywordTable } from "./reports";
import type { SeoPlace } from "./place";

export const FREE_IDEAS_MAX = 1000;
/** Sorts the free idea tables offer (the paid tables' "difficulty" sort has nothing to sort by here). */
export const FREE_IDEA_SORTS = ["volume", "cpc", "keyword"] as const;

/** Question words that open a question, by language. */
const QUESTION_WORDS: Record<string, string[]> = {
  en: ["how", "what", "why", "when", "where", "who", "which", "can", "do", "does", "is", "are", "should", "will", "much", "cost"],
  es: ["cómo", "como", "qué", "que", "por qué", "cuándo", "cuando", "dónde", "donde", "quién", "cuál", "cuanto", "cuánto"],
  fr: ["comment", "quoi", "pourquoi", "quand", "où", "qui", "quel", "quelle", "combien", "est-ce"],
};
export function isQuestion(keyword: string, languageCode = "en"): boolean {
  const k = ` ${keyword.toLowerCase()} `;
  return (QUESTION_WORDS[languageCode] ?? QUESTION_WORDS.en).some((w) => k.startsWith(` ${w} `) || (w === "cost" && / cost /.test(k) && / (how|much) /.test(k)));
}
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Every word of the seed appears in the idea (any order): what "matching" means. */
export function matchesSeed(idea: string, seed: string): boolean {
  const have = new Set(words(idea));
  return words(seed).every((w) => have.has(w));
}

const competitionLevel = (c: PlannerMetrics["competition"]) => c ?? null;
function ideaRow(m: PlannerMetrics): KeywordIdeaRow {
  return { keyword: m.keyword, volume: m.volume, cpc: m.cpc, difficulty: null, intent: null, competition: competitionLevel(m.competition) };
}

/** Why a filter cannot be used on the free tables, or null. */
export function freeFilterRefusal(filters: ReportFilters): string | null {
  if (filters.difficultyMin != null || filters.difficultyMax != null) return "Difficulty isn't part of Google's free keyword ideas. Clear the Difficulty box, or open a keyword to see its difficulty.";
  if (filters.intent) return "Intent isn't part of Google's free keyword ideas. Clear the Intent filter.";
  return null;
}

/** One page of a free idea table, cut from Google's ideas for the seed. Pure. */
export function freeIdeaPage(input: {
  table: KeywordTable; seed: string; languageCode: string; filters: ReportFilters; sort?: string; limit: number; offset: number; fetchedAt: string;
}, ideas: PlannerMetrics[]): ReportPage & { source: "google" } {
  const { table, seed, filters: f } = input;
  let rows = ideas.filter((m) => {
    if (m.keyword === seed.toLowerCase().trim() && table !== "matchingTerms") return false;
    if (table === "questions") return isQuestion(m.keyword, input.languageCode);
    const matching = matchesSeed(m.keyword, seed);
    return table === "matchingTerms" ? matching : !matching;
  });
  if (f.volumeMin != null) rows = rows.filter((m) => (m.volume ?? -1) >= f.volumeMin!);
  if (f.volumeMax != null) rows = rows.filter((m) => m.volume != null && m.volume <= f.volumeMax!);
  if (f.contains) { const c = f.contains.toLowerCase(); rows = rows.filter((m) => m.keyword.includes(c)); }
  const sort = (FREE_IDEA_SORTS as readonly string[]).includes(input.sort ?? "") ? input.sort! : "volume";
  rows = [...rows].sort((a, b) =>
    sort === "keyword" ? a.keyword.localeCompare(b.keyword)
      : sort === "cpc" ? (b.cpc ?? -1) - (a.cpc ?? -1) || (b.volume ?? -1) - (a.volume ?? -1)
        : (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword));
  const page = rows.slice(input.offset, input.offset + input.limit);
  return {
    table, target: seed, rows: page.map(ideaRow), sourceRows: page.length, total: rows.length,
    limit: input.limit, offset: input.offset, sort, fetchedAt: input.fetchedAt, source: "google",
  };
}

/** The parts of an overview only the paid lookup brings. */
export const PAID_PARTS = ["difficulty", "results", "authority", "potential"] as const;

/** A keyword's free overview from Google's numbers (null figures where Google has none). Pure. */
export function freeOverview(input: { keyword: string; locationCode: number; languageCode: string; place?: SeoPlace | null; fetchedAt?: string }, m: PlannerMetrics | undefined): KeywordOverview {
  return {
    keyword: input.keyword, locationCode: input.locationCode, languageCode: input.languageCode, fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    volume: m?.volume ?? null, cpc: m?.cpc ?? null, difficulty: null, intent: null, competition: m?.competition ?? null,
    bidLow: m?.bidLow ?? null, bidHigh: m?.bidHigh ?? null, results: null, trend: m?.monthly ?? [], features: [],
    topAvg: { authority: null, backlinks: null, referringDomains: null }, serp: [], potential: null,
    missing: [...PAID_PARTS], free: true, place: input.place ?? null,
  };
}

/** Google's numbers laid over a bought overview: the same figures the free view showed, for the country or the place. Pure. */
export function withGoogleNumbers(o: KeywordOverview, m: PlannerMetrics | undefined): KeywordOverview {
  if (!m) return o;
  return { ...o, volume: m.volume, cpc: m.cpc, competition: m.competition ?? o.competition, bidLow: m.bidLow, bidHigh: m.bidHigh, trend: m.monthly.length ? m.monthly : o.trend };
}

/** Google's numbers for one keyword at a place or country, or undefined when Google cannot answer (logged, never thrown). */
export async function googleNumbers(keyword: string, geo: number, languageCode: string): Promise<PlannerMetrics | undefined> {
  if (!plannerConfigured()) return undefined;
  try { return (await plannerHistorical([keyword], geo, languageCode)).get(keyword.toLowerCase().trim()); }
  catch (e: any) { console.warn(`[seo] google keyword numbers unavailable for "${keyword}" @${geo}: ${e?.message ?? e}`); return undefined; }
}

/** Volume and cost per click for keywords at a place or country: Google first (free), the paid source when Google cannot answer. */
export async function keywordVolumes(keywords: string[], geo: number, languageCode: string): Promise<{ data: KeywordVolume[]; costUsd: number; source: "google" | "paid" }> {
  if (plannerConfigured()) {
    try {
      const got = await plannerHistorical(keywords, geo, languageCode);
      return {
        data: keywords.map((k) => { const m = got.get(k.toLowerCase().replace(/\s+/g, " ").trim()); return { keyword: k, searchVolume: m?.volume ?? null, cpc: m?.cpc ?? null, competition: m?.competition ?? null }; }),
        costUsd: 0, source: "google",
      };
    } catch (e: any) { console.warn(`[seo] google volumes unavailable (${keywords.length} keywords @${geo}), using the paid source: ${e?.message ?? e}`); }
  }
  const paid = await adsSearchVolume({ keywords, locationCode: geo, languageCode });
  return { ...paid, source: "paid" };
}
