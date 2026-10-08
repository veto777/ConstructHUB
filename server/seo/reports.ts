/**
 * Site Explorer's reports and the Keywords Explorer — the tables behind the
 * overview, each filterable, sortable and paged, plus one keyword's overview.
 *
 *   Domain reports (POST /api/seo/report { domain, table, ... }):
 *     keywords, paidKeywords, pages, competitors            (labs)
 *     backlinks, newBacklinks, lostBacklinks, brokenBacklinks,
 *     referringDomains, anchors, bestByLinks                (backlinks)
 *   Keyword reports (the same endpoint with { keyword, table }):
 *     matchingTerms, relatedTerms, questions
 *   Keyword overview (POST /api/seo/keyword): volume, difficulty, CPC, intent,
 *     the monthly trend, the top organic results with each site's authority.
 *
 * Every page of every report is one vendor call, charged to the account's SEO
 * data credit through withBudget (server/seo/budget.ts). The exact page asked
 * for is kept in seo_report_cache and served from there for CACHE_HOURS, so
 * paging back, re-sorting to a page already seen or reopening costs nothing.
 * `peek` asks for the saved page only and never spends.
 *
 * Pure builders (reportRequest, parse*) are tested against real responses
 * (server/seo/reports.test.ts). Request shapes follow OpenSEO's
 * src/server/lib/dataforseo (MIT — notice in server/seo/dataforseo.ts).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, taskItems, type DfsTask } from "./dataforseo";
import { safeDomain, safeHttpUrl } from "./dataforseo";
import { parseExplorerKeyword, parseExplorerPage, parseCompetitors, parseReferringDomain, parseAnchor, INTENTS, type Intent } from "./explorer";

export const CACHE_HOURS = 24;
export const KEYWORD_OVERVIEW_TTL_DAYS = 7;
/** Wholesale estimates reserved before a call (settled to the real cost after). */
export const REPORT_ESTIMATE_USD = 0.03;
export const REPORT_TYPICAL_USD = 0.025;
export const KEYWORD_OVERVIEW_ESTIMATE_USD = 0.065;
export const KEYWORD_OVERVIEW_TYPICAL_USD = 0.05;

export const DOMAIN_TABLES = ["keywords", "paidKeywords", "pages", "competitors", "backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "referringDomains", "anchors", "bestByLinks", "referringIps", "linkCompetitors", "subdomains", "ads"] as const;
export const KEYWORD_TABLES = ["matchingTerms", "relatedTerms", "questions"] as const;
export type DomainTable = (typeof DOMAIN_TABLES)[number];
export type KeywordTable = (typeof KEYWORD_TABLES)[number];
export type ReportTable = DomainTable | KeywordTable;
export const isKeywordTable = (t: string): t is KeywordTable => (KEYWORD_TABLES as readonly string[]).includes(t);

const optNum = z.number().finite().min(0).max(1_000_000_000).optional();
export const reportFilters = z.object({
  positionMin: optNum, positionMax: optNum,
  volumeMin: optNum, volumeMax: optNum,
  difficultyMin: optNum, difficultyMax: optNum,
  intent: z.enum(INTENTS).optional(),
  /** Text the keyword / anchor / linking domain must contain. */
  contains: z.string().trim().min(1).max(80).regex(/^[^%_\\]+$/, "No % _ or \\ in the search text").optional(),
  follow: z.enum(["followed", "nofollow"]).optional(),
  /** Backlinks: one row per linking domain (default) or every link. */
  everyLink: z.boolean().optional(),
}).strict();
export type ReportFilters = z.infer<typeof reportFilters>;

/**
 * Reports that can be narrowed to one section of a site ("/blog/") or one page of it: the ones whose rows are, or
 * point at, pages. The others (linking sites, anchors, competitors…) are counted for the whole site by the source.
 */
export const SCOPED_TABLES: ReadonlySet<ReportTable> = new Set<ReportTable>(["keywords", "paidKeywords", "pages", "backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "bestByLinks"]);
/** A path on the site: starts with "/", no spaces, no backslash and no "#" (a fragment is a place on a page, not a page). */
export const scopePath = z.string().trim().min(1).max(300).regex(/^\/[^\s\\#]*$/, "Start the path with / and leave out spaces, # and \\");
export class TooManyFilters extends Error { constructor() { super("Too many filters at once — remove one and try again."); } }

export const reportInput = z.object({
  domain: z.string().min(3).max(253).optional(),
  /** Narrow a site report to the pages whose path starts with this ("/blog/"), or — with exactPage — to this one page. */
  path: scopePath.optional(),
  exactPage: z.boolean().default(false),
  keyword: z.string().trim().min(1).max(200).optional(),
  table: z.enum([...DOMAIN_TABLES, ...KEYWORD_TABLES]),
  limit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
  offset: z.number().int().min(0).max(9900).default(0),
  sort: z.string().regex(/^[a-zA-Z]{2,24}$/).optional(),
  filters: reportFilters.default({}),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  /** Return the saved page only; never call the source, never spend. */
  peek: z.boolean().default(false),
}).strict();
export type ReportInput = z.infer<typeof reportInput>;

type Clause = [string, string, unknown];
/**
 * Clauses joined with "and" the way the source wants them: [c1, "and", c2, ...]. The source takes at most 8
 * conditions; more than that is refused out loud (TooManyFilters) — a filter is never dropped silently.
 */
export function andClauses(clauses: (Clause | unknown[])[]): unknown[] | undefined {
  // A clause that is itself "this or that" counts as its two conditions.
  const conditions = clauses.reduce((n: number, c) => n + (Array.isArray(c[0]) ? c.filter((x) => Array.isArray(x)).length : 1), 0);
  if (conditions > 8) throw new TooManyFilters();
  const kept = clauses;
  if (!kept.length) return undefined;
  if (kept.length === 1) return kept[0];
  return kept.flatMap((c, i) => (i ? ["and", c] : [c]));
}

/** Sort keys each table accepts → the source's order_by. The first is the default. */
export const SORTS: Record<ReportTable, Record<string, string>> = {
  keywords: { traffic: "ranked_serp_element.serp_item.etv,desc", volume: "keyword_data.keyword_info.search_volume,desc", position: "ranked_serp_element.serp_item.rank_group,asc", difficulty: "keyword_data.keyword_properties.keyword_difficulty,asc", cpc: "keyword_data.keyword_info.cpc,desc" },
  paidKeywords: { traffic: "ranked_serp_element.serp_item.etv,desc", volume: "keyword_data.keyword_info.search_volume,desc", cpc: "keyword_data.keyword_info.cpc,desc" },
  pages: { traffic: "metrics.organic.etv,desc", keywords: "metrics.organic.count,desc" },
  competitors: { shared: "intersections,desc" },
  backlinks: { authority: "domain_from_rank,desc", newest: "first_seen,desc", oldest: "first_seen,asc" },
  newBacklinks: { newest: "first_seen,desc", authority: "domain_from_rank,desc" },
  lostBacklinks: { newest: "last_seen,desc", authority: "domain_from_rank,desc" },
  brokenBacklinks: { authority: "domain_from_rank,desc", newest: "first_seen,desc" },
  referringDomains: { authority: "rank,desc", links: "backlinks,desc", newest: "first_seen,desc" },
  anchors: { links: "backlinks,desc", domains: "referring_domains,desc" },
  bestByLinks: { links: "backlinks,desc", domains: "referring_domains,desc" },
  referringIps: { domains: "referring_domains,desc", links: "backlinks,desc" },
  linkCompetitors: { shared: "intersections,desc" },
  subdomains: { traffic: "metrics.organic.etv,desc", keywords: "metrics.organic.count,desc" },
  // Google's ad library returns its own order (most recently shown first); there is nothing to choose.
  ads: { newest: "" },
  matchingTerms: { volume: "keyword_info.search_volume,desc", difficulty: "keyword_properties.keyword_difficulty,asc", cpc: "keyword_info.cpc,desc" },
  relatedTerms: { volume: "keyword_data.keyword_info.search_volume,desc", difficulty: "keyword_data.keyword_properties.keyword_difficulty,asc" },
  questions: { volume: "keyword_info.search_volume,desc", difficulty: "keyword_properties.keyword_difficulty,asc" },
};
export const defaultSort = (table: ReportTable) => Object.keys(SORTS[table])[0];
/** Only a sort the report itself lists — never something every object has, like "constructor". */
export const hasSort = (table: ReportTable, sort: string) => Object.prototype.hasOwnProperty.call(SORTS[table], sort);
/** Reports whose answer depends on the country; link reports are the same everywhere. */
export const COUNTRY_TABLES: ReadonlySet<ReportTable> = new Set<ReportTable>(["keywords", "paidKeywords", "pages", "competitors", "subdomains", "ads", "matchingTerms", "relatedTerms", "questions"]);

const KW_FILTERS = ["positionMin", "positionMax", "volumeMin", "volumeMax", "difficultyMin", "difficultyMax", "intent", "contains"] as const;
const IDEA_FILTERS = ["volumeMin", "volumeMax", "difficultyMin", "difficultyMax", "intent", "contains"] as const;
const LINK_FILTERS = ["follow", "contains", "everyLink"] as const;
/** The filters each report really uses (see reportRequest). */
export const FILTERS_FOR: Record<ReportTable, readonly (keyof ReportFilters)[]> = {
  keywords: KW_FILTERS, paidKeywords: KW_FILTERS, pages: ["contains"], competitors: ["contains"],
  backlinks: LINK_FILTERS, newBacklinks: LINK_FILTERS, lostBacklinks: LINK_FILTERS, brokenBacklinks: ["follow"],
  referringDomains: ["contains"], anchors: ["contains"], bestByLinks: ["contains"],
  referringIps: [], linkCompetitors: [], subdomains: [], ads: [],
  matchingTerms: IDEA_FILTERS, questions: IDEA_FILTERS, relatedTerms: ["volumeMin", "volumeMax", "difficultyMin", "difficultyMax"],
};
/**
 * The request as it will really be run: a sort the report does not have becomes its default, and a filter it
 * does not use is dropped. Saved pages are keyed by this, so the same page can never be bought twice under
 * two spellings.
 */
export function effectiveReport<T extends ReportInput>(input: T): T {
  const allowed = FILTERS_FOR[input.table] as readonly string[];
  const filters = Object.fromEntries(Object.entries(input.filters).filter(([k, v]) => allowed.includes(k) && v !== undefined && v !== false)) as ReportFilters;
  // A report that cannot be narrowed is never keyed (or bought) per section, and the whole site is not a "section".
  const scope = SCOPED_TABLES.has(input.table) ? canonicalScope(input.path, !!input.exactPage) : null;
  return { ...input, filters, path: scope?.path, exactPage: !!scope?.exact, sort: input.sort !== undefined && hasSort(input.table, input.sort) ? input.sort : defaultSort(input.table) };
}
/**
 * One spelling per scope, so the same section or page is one saved report however it was typed:
 *  - a path without a query loses its last slash ("/blog/" and "/blog" are the same section, and the same page);
 *  - a path WITH a query is kept exactly as written — there the slash and every character can matter;
 *  - the section "/" is the whole site, so it is no scope at all (the PAGE "/" is the home page).
 */
export function canonicalScope(path: string | undefined, exact: boolean): { path: string; exact: boolean } | null {
  if (!path) return null;
  const p = path.includes("?") ? path : path.replace(/\/+$/, "") || "/";
  if (p === "/" && !exact) return null;
  return { path: p, exact };
}
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The ONE condition that narrows a report, as a pattern on a whole address (checked against the source 2026-10-08):
 *   - the host is the site itself, with or without "www" — never a sub-domain, never a host that merely ends the same;
 *   - a section is the path itself and everything under it ("/blog", "/blog/x", "/blog?p=2" — not "/blogging");
 *   - one page is the path with or without its last slash, or — when it has a query — exactly as written.
 * Keyword reports are matched on the ranking page's address; link reports on the address linked to.
 */
export function scopeClauses(input: { table: ReportTable; target: string; path?: string; exactPage?: boolean }): Clause[] {
  const scope = SCOPED_TABLES.has(input.table) ? canonicalScope(input.path, !!input.exactPage) : null;
  if (!scope) return [];
  const host = `^https?://(www\\.)?${reEscape(input.target.replace(/^www\./, ""))}`;
  const base = scope.path.includes("?") || scope.path !== "/" ? reEscape(scope.path) : "";
  const tail = scope.exact ? (scope.path.includes("?") ? "$" : "/?$") : "(/|\\?|$)";
  const field = input.table === "keywords" || input.table === "paidKeywords" ? "ranked_serp_element.serp_item.url" : input.table === "pages" ? "page_address" : input.table === "bestByLinks" ? "url" : "url_to";
  return [[field, "regex", `${host}${base}${tail}`]];
}

/** How a question starts, by language (the Questions report keeps only searches that start this way). */
export const QUESTION_RE: Record<string, string> = {
  en: "^(how|what|why|when|where|who|which|can|does|do|is|are|should|will) ",
  es: "^(cómo|como|qué|por qué|cuándo|cuando|dónde|donde|quién|quien|cuál|cual|cuánto|cuanto|cuánta|cuanta|cuántos|cuantos|se puede|puedo) ",
  fr: "^(comment|pourquoi|quand|où|qui|quel|quelle|quels|quelles|combien|est-ce|peut-on|faut-il|que faire) ",
};
export const questionRe = (languageCode: string) => QUESTION_RE[languageCode] ?? QUESTION_RE.en;

/** The vendor request for one page of one report. Pure. */
export function reportRequest(input: ReportInput & { target: string }): { path: string; body: Record<string, unknown> } {
  const f = input.filters, t = input.table;
  const sort = SORTS[t][input.sort !== undefined && hasSort(t, input.sort) ? input.sort : defaultSort(t)];
  const labs = { location_code: input.locationCode, language_code: input.languageCode, limit: input.limit, offset: input.offset };
  const links = { target: input.target, include_subdomains: true, rank_scale: "one_thousand", limit: input.limit, offset: input.offset };
  const range = (field: string, min?: number, max?: number): Clause[] => [
    ...(min != null ? [[field, ">=", min] as Clause] : []), ...(max != null ? [[field, "<=", max] as Clause] : []),
  ];
  const like = (field: string): Clause[] => (f.contains ? [[field, "like", `%${f.contains}%`]] : []);
  const follow: Clause[] = f.follow ? [["dofollow", "=", f.follow === "followed"]] : [];
  const scope = scopeClauses(input);

  switch (t) {
    case "keywords":
    case "paidKeywords": {
      const kd = "keyword_data";
      const clauses = [
        ...scope,
        ...range("ranked_serp_element.serp_item.rank_group", f.positionMin, f.positionMax),
        ...range(`${kd}.keyword_info.search_volume`, f.volumeMin, f.volumeMax),
        ...range(`${kd}.keyword_properties.keyword_difficulty`, f.difficultyMin, f.difficultyMax),
        ...(f.intent ? [[`${kd}.search_intent_info.main_intent`, "=", f.intent] as Clause] : []),
        ...like(`${kd}.keyword`),
      ];
      return { path: "/dataforseo_labs/google/ranked_keywords/live", body: { ...labs, target: input.target, item_types: [t === "keywords" ? "organic" : "paid"], filters: andClauses(clauses), order_by: [sort] } };
    }
    case "pages":
      return { path: "/dataforseo_labs/google/relevant_pages/live", body: { ...labs, target: input.target, filters: andClauses([...scope, ...(f.contains ? [["page_address", "like", `%${f.contains}%`] as Clause] : [])]), order_by: [sort] } };
    case "competitors":
      return { path: "/dataforseo_labs/google/competitors_domain/live", body: { ...labs, target: input.target, exclude_top_domains: true, filters: andClauses(like("domain")), order_by: [sort] } };
    case "backlinks":
      return { path: "/backlinks/backlinks/live", body: { ...links, mode: f.everyLink ? "as_is" : "one_per_domain", backlinks_status_type: "live", filters: andClauses([...scope, ...follow, ...like("anchor")]), order_by: [sort] } };
    case "newBacklinks":
      return { path: "/backlinks/backlinks/live", body: { ...links, mode: f.everyLink ? "as_is" : "one_per_domain", backlinks_status_type: "live", filters: andClauses([...scope, ["is_new", "=", true], ...follow, ...like("anchor")]), order_by: [sort] } };
    case "lostBacklinks":
      return { path: "/backlinks/backlinks/live", body: { ...links, mode: f.everyLink ? "as_is" : "one_per_domain", backlinks_status_type: "lost", filters: andClauses([...scope, ...follow, ...like("anchor")]), order_by: [sort] } };
    case "brokenBacklinks":
      return { path: "/backlinks/backlinks/live", body: { ...links, mode: "as_is", backlinks_status_type: "live", filters: andClauses([...scope, ["is_broken", "=", true], ...follow]), order_by: [sort] } };
    case "referringDomains":
      return { path: "/backlinks/referring_domains/live", body: { ...links, backlinks_status_type: "live", filters: andClauses(like("domain")), order_by: [sort] } };
    case "anchors":
      return { path: "/backlinks/anchors/live", body: { ...links, backlinks_status_type: "live", filters: andClauses(like("anchor")), order_by: [sort] } };
    case "referringIps":
      return { path: "/backlinks/referring_networks/live", body: { ...links, network_address_type: "ip", backlinks_status_type: "live", order_by: [sort] } };
    case "linkCompetitors":
      return { path: "/backlinks/competitors/live", body: { target: input.target, rank_scale: "one_thousand", exclude_large_domains: true, limit: input.limit, offset: input.offset, order_by: [sort] } };
    case "subdomains":
      return { path: "/dataforseo_labs/google/subdomains/live", body: { ...labs, target: input.target, order_by: [sort] } };
    case "ads":
      // The ad library has no paging of its own: everything it will give is asked for once (fetchAdsSnapshot) and paged here.
      return { path: "/serp/google/ads_search/live/advanced", body: { target: input.target, location_code: input.locationCode, depth: ADS_MAX } };
    case "bestByLinks":
      return { path: "/backlinks/domain_pages_summary/live", body: { ...links, backlinks_status_type: "live", filters: andClauses([...scope, ...like("url")]), order_by: [sort] } };
    case "matchingTerms":
    case "questions": {
      const clauses = [
        ...range("keyword_info.search_volume", f.volumeMin, f.volumeMax),
        ...range("keyword_properties.keyword_difficulty", f.difficultyMin, f.difficultyMax),
        ...(f.intent ? [["search_intent_info.main_intent", "=", f.intent] as Clause] : []),
        ...(t === "questions" ? [["keyword", "regex", questionRe(input.languageCode)] as Clause] : []),
        ...(f.contains ? [["keyword", "like", `%${f.contains}%`] as Clause] : []),
      ];
      return { path: "/dataforseo_labs/google/keyword_suggestions/live", body: { ...labs, keyword: input.target, filters: andClauses(clauses), order_by: [sort] } };
    }
    case "relatedTerms": {
      const kd = "keyword_data";
      const clauses = [
        ...range(`${kd}.keyword_info.search_volume`, f.volumeMin, f.volumeMax),
        ...range(`${kd}.keyword_properties.keyword_difficulty`, f.difficultyMin, f.difficultyMax),
      ];
      return { path: "/dataforseo_labs/google/related_keywords/live", body: { ...labs, keyword: input.target, depth: 2, filters: andClauses(clauses), order_by: [sort] } };
    }
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const day = (v: unknown) => str(v)?.slice(0, 10) ?? null;
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
const auth = (rank: unknown) => { const n = num(rank); return n == null ? null : Math.max(0, Math.min(100, Math.round(n / 10))); };

export type BacklinkRow = {
  domain: string | null; url: string | null; title: string | null; target: string | null; anchor: string | null;
  followed: boolean; authority: number | null; spamScore: number | null; firstSeen: string | null; lastSeen: string | null;
  isNew: boolean; isLost: boolean; isBroken: boolean; country: string | null; type: string | null;
};
export function parseBacklink(i: any): BacklinkRow | null {
  if (!i || typeof i !== "object" || !str(i.url_from)) return null;
  return {
    domain: str(i.domain_from), url: str(i.url_from), title: str(i.page_from_title), target: str(i.url_to), anchor: str(i.anchor),
    followed: i.dofollow === true, authority: auth(i.domain_from_rank), spamScore: num(i.backlink_spam_score),
    firstSeen: day(i.first_seen), lastSeen: day(i.last_seen), isNew: i.is_new === true, isLost: i.is_lost === true, isBroken: i.is_broken === true,
    country: str(i.domain_from_country), type: str(i.item_type),
  };
}

export type LinkedPageRow = { url: string; backlinks: number | null; referringDomains: number | null; authority: number | null; brokenBacklinks: number | null; firstSeen: string | null };
export function parseLinkedPage(i: any): LinkedPageRow | null {
  const url = str(i?.url);
  return url ? { url, backlinks: num(i.backlinks), referringDomains: num(i.referring_domains), authority: auth(i.rank), brokenBacklinks: num(i.broken_backlinks), firstSeen: day(i.first_seen) } : null;
}

export type ReferringIpRow = { ip: string; referringDomains: number | null; backlinks: number | null; firstSeen: string | null };
export function parseReferringIp(i: any): ReferringIpRow | null {
  const ip = str(i?.network_address);
  return ip && /^[0-9a-f.:/]+$/i.test(ip) ? { ip, referringDomains: num(i.referring_domains), backlinks: num(i.backlinks), firstSeen: day(i.first_seen) } : null;
}
export type LinkCompetitorRow = { domain: string; shared: number | null };
/** Sites that many of the same websites link to — the target and its own sub-domains are left out. The source's "rank" here is not the site's own strength, so it is not shown. */
export function parseLinkCompetitor(i: any, target: string): LinkCompetitorRow | null {
  const domain = safeDomain(i?.target);
  return domain && domain !== target && !domain.endsWith(`.${target}`) ? { domain, shared: num(i.intersections) } : null;
}
export type SubdomainRow = { subdomain: string; traffic: number | null; keywords: number | null; top3: number | null; top10: number | null; trafficValue: number | null };
/** A host name kept exactly as it is — www.example.com is its own row, not example.com. */
const hostName = (v: unknown): string | null => (typeof v === "string" && v.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(v.toLowerCase()) ? v.toLowerCase() : null);
export function parseSubdomain(i: any): SubdomainRow | null {
  const subdomain = hostName(i?.subdomain), o = i?.metrics?.organic;
  if (!subdomain || !o) return null;
  // A number the source left out stays unknown; it is never shown as zero.
  const p1 = num(o.pos_1), p23 = num(o.pos_2_3), p410 = num(o.pos_4_10);
  const top3 = p1 === null || p23 === null ? null : p1 + p23;
  return { subdomain, traffic: num(o.etv) === null ? null : Math.round(o.etv), keywords: num(o.count), top3, top10: top3 === null || p410 === null ? null : top3 + p410, trafficValue: num(o.estimated_paid_traffic_cost) === null ? null : Math.round(o.estimated_paid_traffic_cost) };
}
export type AdRow = { advertiser: string; format: string | null; verified: boolean; firstShown: string | null; lastShown: string | null; url: string | null };
/** One ad from Google's public ad library. The link goes to Google's own page for that ad. */
export function parseAd(i: any): AdRow | null {
  const advertiser = str(i?.title);
  if (!advertiser || i?.type !== "ads_search") return null;
  const url = safeHttpUrl(i.url);
  return { advertiser: advertiser.slice(0, 160), format: str(i.format), verified: i.verified === true, firstShown: day(i.first_shown), lastShown: day(i.last_shown), url: url && /^https:\/\/adstransparency\.google\.com\//.test(url) ? url : null };
}

export type KeywordIdeaRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent: Intent | null; competition: string | null };
/** A keyword_suggestions row, or the `keyword_data` of a related_keywords row. */
export function parseKeywordIdea(i: any): KeywordIdeaRow | null {
  const d = i?.keyword_data ?? i, keyword = str(d?.keyword);
  if (!keyword) return null;
  const intent = str(d?.search_intent_info?.main_intent);
  return {
    keyword, volume: num(d?.keyword_info?.search_volume), cpc: r2(num(d?.keyword_info?.cpc)), difficulty: num(d?.keyword_properties?.keyword_difficulty),
    intent: (INTENTS as readonly string[]).includes(intent ?? "") ? (intent as Intent) : null, competition: str(d?.keyword_info?.competition_level),
  };
}

/** Rows of one report page, parsed for the client. */
export function parseReportRows(table: ReportTable, items: any[], target: string): unknown[] {
  const keep = <T>(rows: (T | null)[]) => rows.filter((x): x is T => !!x);
  switch (table) {
    case "keywords": case "paidKeywords": return keep(items.map(parseExplorerKeyword));
    case "pages": return keep(items.map(parseExplorerPage));
    case "competitors": return parseCompetitors(items, target);
    case "backlinks": case "newBacklinks": case "lostBacklinks": case "brokenBacklinks": return keep(items.map(parseBacklink));
    case "referringDomains": return keep(items.map(parseReferringDomain));
    case "anchors": return keep(items.map(parseAnchor));
    case "bestByLinks": return keep(items.map(parseLinkedPage));
    case "referringIps": return keep(items.map(parseReferringIp));
    case "linkCompetitors": return keep(items.map((i) => parseLinkCompetitor(i, target)));
    case "subdomains": return keep(items.map(parseSubdomain));
    case "ads": return keep(items.map(parseAd));
    case "matchingTerms": case "relatedTerms": case "questions": return keep(items.map(parseKeywordIdea));
  }
}

export type ReportPage = { table: ReportTable; target: string; /** The section or page the report was narrowed to, when it was. */ path?: string; exactPage?: boolean; /** Ads: the library gave as many as can be asked for, so there may be more than `total`. */ capped?: boolean; rows: unknown[]; /** Rows the source returned before our own filtering — what paging goes by. */ sourceRows?: number; total: number | null; limit: number; offset: number; sort: string; fetchedAt: string };

/** Run one page at the source. */
export async function fetchReportPage(input: ReportInput & { target: string }): Promise<{ data: ReportPage; costUsd: number }> {
  const { path, body } = reportRequest(input);
  const task: DfsTask = assertOk(await request("POST", path, [body]), { treatNoResultsAsEmpty: true });
  const rows = parseReportRows(input.table, taskItems(task), input.target);
  return {
    data: {
      table: input.table, target: input.target, ...(input.path ? { path: input.path, exactPage: !!input.exactPage } : {}), rows,
      sourceRows: taskItems(task).length, total: num(task.result?.[0]?.total_count), limit: input.limit, offset: input.offset,
      sort: input.sort && SORTS[input.table][input.sort] ? input.sort : defaultSort(input.table), fetchedAt: new Date().toISOString(),
    },
    costUsd: typeof task.cost === "number" ? task.cost : 0,
  };
}

// ── Ads: one lookup, paged here ─────────────────────────────────────────────

/** The most ads the library gives for one advertiser's site. */
export const ADS_MAX = 120;
/** Measured 2026-10-08: $0.006 for the full 120. */
export const ADS_ESTIMATE_USD = 0.008;
export const ADS_TYPICAL_USD = 0.006;
export type AdsSnapshot = { target: string; rows: AdRow[]; /** The library returned the most it will give, so the site may have run more. */ capped: boolean; fetchedAt: string };
/** Everything the ad library will give for a site, in one call. Saved, then paged without buying anything again. */
export async function fetchAdsSnapshot(input: { target: string; locationCode: number }): Promise<{ data: AdsSnapshot; costUsd: number }> {
  const task: DfsTask = assertOk(await request("POST", "/serp/google/ads_search/live/advanced", [{ target: input.target, location_code: input.locationCode, depth: ADS_MAX }]), { treatNoResultsAsEmpty: true });
  const items = taskItems(task);
  return { data: adsSnapshot(input.target, items), costUsd: typeof task.cost === "number" ? task.cost : 0 };
}
export function adsSnapshot(target: string, items: any[], fetchedAt = new Date().toISOString()): AdsSnapshot {
  return { target, rows: parseReportRows("ads", items, target) as AdRow[], capped: items.length >= ADS_MAX, fetchedAt };
}
/** One page cut from the saved snapshot. */
export function adsPage(s: AdsSnapshot, limit: number, offset: number): ReportPage {
  const rows = s.rows.slice(offset, offset + limit);
  return { table: "ads", target: s.target, rows, sourceRows: rows.length, total: s.rows.length, capped: s.capped, limit, offset, sort: "newest", fetchedAt: s.fetchedAt };
}

// ── Keyword overview ───────────────────────────────────────────────────────

export type SerpRow = { position: number; domain: string; url: string; title: string | null; authority: number | null };
export type KeywordOverview = {
  keyword: string; locationCode: number; /** Absent on overviews saved before 2026-10-08 (they are English). */ languageCode?: string; fetchedAt: string;
  volume: number | null; cpc: number | null; difficulty: number | null; intent: Intent | null; competition: string | null;
  bidLow: number | null; bidHigh: number | null; results: number | null;
  /** Monthly searches, oldest first. */
  trend: { month: string; volume: number }[];
  /** What else Google shows for it (local pack, people also ask, ...). */
  features: string[];
  /** Average authority and links of the pages ranking today. */
  topAvg: { authority: number | null; backlinks: number | null; referringDomains: number | null };
  serp: SerpRow[];
  /** What the page ranking first earns from search in all (absent on overviews saved before 2026-10-08; null when it did not load or there is no first page). */
  potential?: KeywordPotential | null;
  /** Sections that did not load this time: "results" (the top ten), "authority" and/or "potential". */
  missing?: string[];
};

export type KeywordPotential = {
  /** The page ranking first today. */
  url: string;
  /** Estimated monthly visits that page gets from search in this country, across every keyword it ranks for (null = the source has no figure). */
  traffic: number | null;
  /** How many keywords it ranks for. */
  keywords: number | null;
  /** The keyword that sends that page the most visits — the broader topic to aim at. */
  parentTopic: string | null; parentVolume: number | null;
};
/** Read "everything the first page ranks for" (one row asked for, ordered by visits). */
export function parsePotential(result: any, url: string): KeywordPotential | null {
  const o = result?.metrics?.organic, top = Array.isArray(result?.items) ? result.items[0] : null;
  if (num(o?.etv) === null && !top) return null;
  return {
    url, traffic: num(o?.etv) === null ? null : Math.round(o.etv), keywords: num(o?.count) ?? num(result?.total_count),
    parentTopic: str(top?.keyword_data?.keyword), parentVolume: num(top?.keyword_data?.keyword_info?.search_volume),
  };
}
/**
 * The request for it: that exact page (its own host name and scheme — www.example.com/x is not example.com/x), its
 * organic rankings only (never an ad), the biggest earner first.
 */
export function potentialRequest(url: string, loc: { location_code: number; language_code: string }): Record<string, unknown> | null {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  u.hash = "";
  return { ...loc, target: u.toString(), item_types: ["organic"], limit: 1, order_by: ["ranked_serp_element.serp_item.etv,desc"] };
}

export function parseKeywordOverview(item: any, serpItems: any[], ranks: any[], input: { keyword: string; locationCode: number; languageCode?: string; fetchedAt?: string }): KeywordOverview {
  const idea = parseKeywordIdea(item) ?? { keyword: input.keyword, volume: null, cpc: null, difficulty: null, intent: null, competition: null };
  const rankOf = new Map(ranks.map((r) => [String(r?.target ?? "").replace(/^www\./, ""), auth(r?.rank)]));
  const trend = (Array.isArray(item?.keyword_info?.monthly_searches) ? item.keyword_info.monthly_searches : [])
    .map((m: any) => (num(m?.year) && num(m?.month) ? { month: `${m.year}-${String(m.month).padStart(2, "0")}`, volume: num(m.search_volume) ?? 0 } : null))
    .filter((x: any): x is { month: string; volume: number } => !!x)
    .sort((a: any, b: any) => a.month.localeCompare(b.month));
  const serp = serpItems.filter((s) => s?.type === "organic" && str(s.domain) && str(s.url)).slice(0, 10).map((s) => {
    const domain = String(s.domain).replace(/^www\./, "");
    return { position: num(s.rank_group) ?? 0, domain, url: String(s.url), title: str(s.title), authority: rankOf.get(domain) ?? null };
  });
  return {
    keyword: idea.keyword, locationCode: input.locationCode, ...(input.languageCode ? { languageCode: input.languageCode } : {}), fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    volume: idea.volume, cpc: idea.cpc, difficulty: idea.difficulty, intent: idea.intent, competition: idea.competition,
    bidLow: r2(num(item?.keyword_info?.low_top_of_page_bid)), bidHigh: r2(num(item?.keyword_info?.high_top_of_page_bid)),
    results: num(item?.serp_info?.se_results_count), trend,
    features: (Array.isArray(item?.serp_info?.serp_item_types) ? item.serp_info.serp_item_types : []).filter((t: unknown) => typeof t === "string" && t !== "organic"),
    topAvg: { authority: auth(item?.avg_backlinks_info?.rank), backlinks: num(item?.avg_backlinks_info?.backlinks) == null ? null : Math.round(item.avg_backlinks_info.backlinks), referringDomains: num(item?.avg_backlinks_info?.referring_domains) == null ? null : Math.round(item.avg_backlinks_info.referring_domains) },
    serp,
  };
}

/** Overview + today's top results, then their authority and what the first page earns: four calls. */
export async function fetchKeywordOverview(input: { keyword: string; locationCode: number; languageCode: string }): Promise<{ data: KeywordOverview; costUsd: number; /** The parts that arrived: what the customer pays for. A part that failed is ours to carry. */ customerUsd: number; costUnknown?: boolean }> {
  let costUsd = 0, customerUsd = 0;
  const call = async (path: string, body: Record<string, unknown>) => {
    try {
      const task = assertOk(await request("POST", path, [body]), { treatNoResultsAsEmpty: true });
      costUsd += typeof task.cost === "number" ? task.cost : 0;
      customerUsd += typeof task.cost === "number" ? task.cost : 0;
      return task;
    } catch (e: any) {
      costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      throw e;
    }
  };
  let costUnknown = false;
  const missing: string[] = [];
  const loc = { location_code: input.locationCode, language_code: input.languageCode };
  // The overview is required; if it fails we still wait for the results call, so the error carries the full cost.
  let failure: unknown = null;
  const [overview, serp] = await Promise.all([
    call("/dataforseo_labs/google/keyword_overview/live", { ...loc, keywords: [input.keyword], include_serp_info: true }).catch((e) => { failure = e; return null; }),
    call("/serp/google/organic/live/advanced", { ...loc, keyword: input.keyword, depth: 10, device: "desktop" }).catch((e: any) => { console.warn(`[seo] keyword ${input.keyword}: results unavailable — ${e?.message ?? e}`); return null; }),
  ]);
  if (failure || !overview) throw Object.assign(failure instanceof Error ? failure : new Error(String(failure ?? "overview unavailable")), { costUsd, costUnknown });
  if (!serp) missing.push("results");
  const serpItems = serp ? taskItems(serp) : [];
  const domains = [...new Set(serpItems.filter((s) => s?.type === "organic" && typeof s.domain === "string").slice(0, 10).map((s) => String(s.domain).replace(/^www\./, "")))];
  const first = serpItems.find((s) => s?.type === "organic" && typeof s.url === "string");
  const potentialBody = first ? potentialRequest(String(first.url), loc) : null;
  const [ranks, potential] = await Promise.all([
    domains.length
      ? call("/backlinks/bulk_ranks/live", { targets: domains, rank_scale: "one_thousand" }).then((t) => taskItems(t)).catch(() => { missing.push("authority"); return []; })
      : [],
    potentialBody
      ? call("/dataforseo_labs/google/ranked_keywords/live", potentialBody).then((t) => parsePotential(t.result?.[0], String(first.url))).catch(() => { missing.push("potential"); return null; })
      : null,
  ]);
  return { data: { ...parseKeywordOverview(taskItems(overview)[0] ?? {}, serpItems, ranks, input), potential, missing }, costUsd, customerUsd, costUnknown };
}

// ── Saved pages ────────────────────────────────────────────────────────────

export const REPORT_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_report_cache (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL,
    kind text NOT NULL,
    data jsonb NOT NULL,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_report_cache_age ON seo_report_cache(created_at)`,
];

/** One saved page per account per exact request (table, target, filters, sort, page, location). */
export function cacheKey(kind: string, parts: unknown): string {
  return createHash("sha1").update(kind).update("\n").update(JSON.stringify(parts)).digest("hex");
}
export const reportCacheKey = (i: ReportInput & { target: string }) =>
  // A report that does not depend on the country is keyed as the United States whatever was sent, so it is one saved page, not one per country.
  cacheKey(`report:${i.table}`, [i.target, i.limit, i.offset, effectiveReport(i).sort, COUNTRY_TABLES.has(i.table) ? i.locationCode : 2840, COUNTRY_TABLES.has(i.table) ? i.languageCode : "en", Object.entries(effectiveReport(i).filters).sort(([a], [b]) => a.localeCompare(b)),
    // Only when narrowed, so pages saved before sections existed are still found.
    // "v2": the rule for what a section or page matches changed (exact boundaries), so pages saved under the first rule are not reused.
    ...(effectiveReport(i).path ? ["scope-v2", effectiveReport(i).path, effectiveReport(i).exactPage ? "page" : "section"] : [])]);

export async function cached<T>(userId: number, key: string, maxAgeHours: number): Promise<T | null> {
  const { rows: [row] } = await pool.query(
    `SELECT data FROM seo_report_cache WHERE user_id=$1 AND key=$2 AND created_at > now() - make_interval(hours => $3)`, [userId, key, maxAgeHours]);
  return row ? (row.data as T) : null;
}
export async function saveCached(userId: number, key: string, kind: string, data: unknown, costUsd: number): Promise<void> {
  await pool.query(
    `INSERT INTO seo_report_cache(user_id, key, kind, data, cost_usd) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, key) DO UPDATE SET data=EXCLUDED.data, cost_usd=EXCLUDED.cost_usd, kind=EXCLUDED.kind, created_at=now()`,
    [userId, key, kind, JSON.stringify(data), costUsd]);
  // Old pages are of no use once stale: keep the table small.
  if (Math.random() < 0.02) void pool.query(`DELETE FROM seo_report_cache WHERE created_at < now() - interval '30 days'`).catch(() => {});
}
