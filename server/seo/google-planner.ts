/**
 * Free keyword numbers from Google itself: the Google Ads Keyword Planner (owner, 2026-10-10: "i dont like how we
 * are paying for these keyword searches cant we use google for free for many of these google tools?").
 *
 *   plannerHistorical(keywords, geo, lang)  monthly searches, competition, top-of-page bids and the last 12 months for
 *                                           given keywords (KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics)
 *   plannerIdeas(seed, geo, lang)           keyword ideas around a seed, with the same numbers (GenerateKeywordIdeas)
 *
 * `geo` is a Google geo target id: a country (2840), state (21180 Washington), county, city, ZIP code or metro area —
 * the same codes the SEO Suite's places use (./locations.ts), so every place costs nothing here. Checked on the live
 * account 2026-10-10: "siding contractor" = US 27,100 · Washington 880 · Whatcom County 40 · Bellingham 20, and 636
 * ideas for Bellingham.
 *
 * It runs under the agency's own Google Ads connection (the MCC in GOOGLE_ADS_LOGIN_CUSTOMER_ID, its grant in
 * ads_grants) against one ads account (SEO_PLANNER_CUSTOMER_ID), sharing the Ads API's request budget. Off when
 * either is missing or the grant needs reconnecting; callers then use the paid source as before. Google has no
 * difficulty, intent, ranking pages or backlinks here: those stay paid.
 */
import { pool } from "../db";
import { clientFor, type AdsClient } from "../ads/client";

/** Google's language constants for the SEO Suite's languages (shared/seo-markets.ts). */
export const PLANNER_LANGUAGES: Record<string, string> = { en: "1000", es: "1003", fr: "1002" };
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
/** Google refuses keywords longer than 80 characters or 10 words (the whole request fails), so those are left out. */
export const plannerKeywordOk = (k: string) => k.length > 0 && k.length <= 80 && k.split(/\s+/).length <= 10;
const CHUNK = 1000;

/** The last 48 complete months: Google keeps four years of monthly searches. */
export function historyRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 47, 1));
  const ym = (d: Date) => ({ year: String(d.getUTCFullYear()), month: MONTHS[d.getUTCMonth()] });
  return { start: ym(start), end: ym(end) };
}

export type PlannerMetrics = {
  keyword: string;
  volume: number | null;
  competition: "LOW" | "MEDIUM" | "HIGH" | null;
  /** 0–100. */
  competitionIndex: number | null;
  /** Average cost per click in dollars (null when Google has none). */
  cpc: number | null;
  bidLow: number | null; bidHigh: number | null;
  /** Monthly searches, oldest first ("YYYY-MM"). */
  monthly: { month: string; volume: number }[];
};

export function plannerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.SEO_PLANNER_CUSTOMER_ID?.trim() && env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim());
}

const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const dollars = (micros: unknown): number | null => {
  const n = int(micros);
  return n === null || n <= 0 ? null : Math.round(n / 1e4) / 100;
};

/** One keyword's metrics as Google sends them (keywordMetrics / keywordIdeaMetrics). Pure. */
export function parsePlannerMetrics(keyword: string, m: any): PlannerMetrics {
  const competition = ["LOW", "MEDIUM", "HIGH"].includes(m?.competition) ? m.competition : null;
  const monthly = (Array.isArray(m?.monthlySearchVolumes) ? m.monthlySearchVolumes : [])
    .map((x: any) => {
      const month = MONTHS.indexOf(String(x?.month)) + 1, year = int(x?.year);
      return month > 0 && year ? { month: `${year}-${String(month).padStart(2, "0")}`, volume: int(x?.monthlySearches) ?? 0 } : null;
    })
    .filter((x: unknown): x is { month: string; volume: number } => !!x)
    .sort((a: { month: string }, b: { month: string }) => a.month.localeCompare(b.month));
  return {
    keyword, volume: int(m?.avgMonthlySearches), competition, competitionIndex: int(m?.competitionIndex),
    cpc: dollars(m?.averageCpcMicros), bidLow: dollars(m?.lowTopOfPageBidMicros), bidHigh: dollars(m?.highTopOfPageBidMicros), monthly,
  };
}

type PlannerApi = Pick<AdsClient, "rpc">;
export const plannerDeps = {
  /** The agency's Google Ads connection, or null when there is none to use. */
  async client(): Promise<PlannerApi | null> {
    const manager = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/-/g, "");
    if (!/^\d{10}$/.test(manager)) return null;
    const { rows: [g] } = await pool.query(
      "SELECT user_id FROM ads_grants WHERE manager_id=$1 AND verified AND NOT coalesce(reconnect_required,false) ORDER BY user_id LIMIT 1", [manager]);
    return g ? clientFor(Number(g.user_id)) : null;
  },
};

const customer = () => String(process.env.SEO_PLANNER_CUSTOMER_ID ?? "").replace(/-/g, "");
function base(geo: number, languageCode: string) {
  if (!Number.isInteger(geo) || geo <= 0) throw new Error("planner: bad geo target");
  return {
    geoTargetConstants: [`geoTargetConstants/${geo}`],
    language: `languageConstants/${PLANNER_LANGUAGES[languageCode] ?? PLANNER_LANGUAGES.en}`,
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
  };
}
async function api(): Promise<PlannerApi> {
  if (!plannerConfigured()) throw new Error("planner: not configured");
  const c = await plannerDeps.client();
  if (!c) throw new Error("planner: no Google Ads connection");
  return c;
}

/**
 * Numbers for these keywords at this place, keyed by the lower-cased keyword asked for (Google may answer a keyword
 * under a close variant; both spellings map to it). A keyword Google has nothing for is absent.
 */
export async function plannerHistorical(keywords: string[], geo: number, languageCode = "en"): Promise<Map<string, PlannerMetrics>> {
  const asked = [...new Set(keywords.map((k) => k.toLowerCase().replace(/\s+/g, " ").trim()).filter(plannerKeywordOk))];
  const out = new Map<string, PlannerMetrics>();
  if (!asked.length) return out;
  const c = await api();
  for (let i = 0; i < asked.length; i += CHUNK) {
    const chunk = asked.slice(i, i + CHUNK);
    const d = await c.rpc(customer(), "generateKeywordHistoricalMetrics", {
      ...base(geo, languageCode), keywords: chunk, historicalMetricsOptions: { includeAverageCpc: true, yearMonthRange: historyRange() },
    });
    const wanted = new Set(chunk);
    for (const r of Array.isArray(d?.results) ? d.results : []) {
      const names = [r?.text, ...(Array.isArray(r?.closeVariants) ? r.closeVariants : [])].map((t) => String(t ?? "").toLowerCase()).filter(Boolean);
      for (const n of names) if (wanted.has(n) && !out.has(n)) out.set(n, parsePlannerMetrics(n, r.keywordMetrics));
    }
  }
  return out;
}

/** Keyword ideas around a seed at this place, busiest first (the seed itself included when Google has it). */
export async function plannerIdeas(seed: string, geo: number, languageCode = "en", max = 1000): Promise<PlannerMetrics[]> {
  const s = seed.toLowerCase().replace(/\s+/g, " ").trim();
  if (!plannerKeywordOk(s)) return [];
  const c = await api();
  const d = await c.rpc(customer(), "generateKeywordIdeas", {
    ...base(geo, languageCode), keywordSeed: { keywords: [s] }, pageSize: Math.min(10_000, Math.max(1, max)),
    historicalMetricsOptions: { includeAverageCpc: true },
  });
  const seen = new Set<string>();
  const rows: PlannerMetrics[] = [];
  for (const r of Array.isArray(d?.results) ? d.results : []) {
    const k = String(r?.text ?? "").toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rows.push(parsePlannerMetrics(k, r.keywordIdeaMetrics));
  }
  return rows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)).slice(0, max);
}
