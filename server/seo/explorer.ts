/**
 * Site Explorer — one domain, everything about it: authority and the backlink
 * profile, organic and paid search footprint, six months of history, the
 * keywords and pages that earn its traffic, who it competes with, who links to
 * it and with what anchor text. Any domain, not only a tracked site.
 *
 * One report = nine vendor calls made together (labs: domain_rank_overview,
 * historical_rank_overview, ranked_keywords, relevant_pages, competitors_domain;
 * backlinks: summary, history, referring_domains, anchors), about $0.28 wholesale. A
 * report is kept in seo_domain_reports and served from there for REPORT_TTL_DAYS,
 * so reopening a domain costs nothing; "Refresh" buys a new one.
 *
 * The overview and the backlink summary make the report; the six list calls are
 * best effort — a list that fails leaves its section null and is named in
 * `missing`, and the rest of the report still stands.
 *
 * The parsers are pure and are tested against real responses
 * (server/seo/explorer.test.ts). Request shapes follow OpenSEO's
 * src/server/lib/dataforseo/{labs,backlinks}.ts (MIT, (c) 2026 Ben Senescu —
 * the notice is in server/seo/dataforseo.ts).
 */
import { pool } from "../db";
import { request, assertOk, taskItems, type DfsTask } from "./dataforseo";

export const REPORT_TTL_DAYS = 7;
/** What one fresh report is reserved at before it runs (settled to the real cost after). */
export const EXPLORER_ESTIMATE_USD = 0.33;
/** What a report usually costs (measured 2026-10-07), for the price shown before it runs. */
export const EXPLORER_TYPICAL_USD = 0.28;
const KEYWORD_ROWS = 100, PAGE_ROWS = 20, COMPETITOR_ROWS = 10, LINK_ROWS = 20;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const n0 = (v: unknown): number => num(v) ?? 0;
const cost = (t: DfsTask) => n0(t.cost);
const round = (v: number | null, places = 0) => v == null ? null : Math.round(v * 10 ** places) / 10 ** places;

export type SearchFootprint = {
  keywords: number;
  /** Estimated monthly visits from these rankings. */
  traffic: number;
  /** What that traffic would cost as ads, per month, in USD. */
  trafficValue: number;
  positions: { top3: number; top10: number; top20: number; top50: number; top100: number };
  /** Movement since the vendor's previous monthly index. */
  isNew: number; isUp: number; isDown: number; isLost: number;
};

/** domain_rank_overview / relevant_pages / competitors `metrics.organic|paid`. */
export function parseFootprint(m: any): SearchFootprint {
  const p = (k: string) => n0(m?.[k]);
  const top3 = p("pos_1") + p("pos_2_3");
  const top10 = top3 + p("pos_4_10");
  const top20 = top10 + p("pos_11_20");
  const top50 = top20 + p("pos_21_30") + p("pos_31_40") + p("pos_41_50");
  const top100 = top50 + p("pos_51_60") + p("pos_61_70") + p("pos_71_80") + p("pos_81_90") + p("pos_91_100");
  return {
    keywords: p("count"), traffic: round(p("etv"), 1)!, trafficValue: round(p("estimated_paid_traffic_cost"), 2)!,
    positions: { top3, top10, top20, top50, top100 },
    isNew: p("is_new"), isUp: p("is_up"), isDown: p("is_down"), isLost: p("is_lost"),
  };
}

export type HistoryPoint = { month: string; traffic: number; keywords: number; top3: number; top10: number; trafficValue: number };
/** historical_rank_overview items, oldest first. */
export function parseHistory(items: any[]): HistoryPoint[] {
  return items
    .map((i) => {
      const year = num(i?.year), month = num(i?.month);
      if (!year || !month) return null;
      const f = parseFootprint(i?.metrics?.organic);
      return { month: `${year}-${String(month).padStart(2, "0")}`, traffic: f.traffic, keywords: f.keywords, top3: f.positions.top3, top10: f.positions.top10, trafficValue: f.trafficValue };
    })
    .filter((x): x is HistoryPoint => !!x)
    .sort((a, b) => a.month.localeCompare(b.month));
}

export const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export type Intent = (typeof INTENTS)[number];
export type ExplorerKeyword = {
  keyword: string; position: number | null; volume: number | null; traffic: number | null; trafficValue: number | null;
  cpc: number | null; difficulty: number | null; intent: Intent | null; url: string | null;
};
export function parseExplorerKeyword(item: any): ExplorerKeyword | null {
  const kd = item?.keyword_data, keyword = str(kd?.keyword);
  if (!keyword) return null;
  const serp = item?.ranked_serp_element?.serp_item ?? {};
  const intent = str(kd?.search_intent_info?.main_intent);
  return {
    keyword,
    position: num(serp.rank_group) ?? num(serp.rank_absolute),
    volume: num(kd?.keyword_info?.search_volume),
    traffic: round(num(serp.etv), 1),
    trafficValue: round(num(serp.estimated_paid_traffic_cost), 2),
    cpc: round(num(kd?.keyword_info?.cpc), 2),
    difficulty: num(kd?.keyword_properties?.keyword_difficulty),
    intent: (INTENTS as readonly string[]).includes(intent ?? "") ? (intent as Intent) : null,
    url: str(serp.url),
  };
}

export type IntentRow = { intent: Intent; keywords: number; traffic: number };
/** Keywords and traffic per search intent, over the keyword rows the report holds. */
export function intentBreakdown(keywords: ExplorerKeyword[]): IntentRow[] {
  return INTENTS.map((intent) => {
    const rows = keywords.filter((k) => k.intent === intent);
    return { intent, keywords: rows.length, traffic: round(rows.reduce((s, k) => s + (k.traffic ?? 0), 0), 1)! };
  });
}

export type ExplorerPage = { url: string; traffic: number; keywords: number; trafficValue: number; top10: number };
export function parseExplorerPage(item: any): ExplorerPage | null {
  const url = str(item?.page_address);
  if (!url) return null;
  const f = parseFootprint(item?.metrics?.organic);
  return { url, traffic: f.traffic, keywords: f.keywords, trafficValue: f.trafficValue, top10: f.positions.top10 };
}

export type ExplorerCompetitor = { domain: string; commonKeywords: number; avgPosition: number | null; traffic: number; keywords: number };
/** competitors_domain items; the target itself (always the first row) is dropped. */
export function parseCompetitors(items: any[], target: string): ExplorerCompetitor[] {
  return items
    .map((i) => {
      const domain = str(i?.domain);
      if (!domain || domain === target || domain === `www.${target}`) return null;
      const full = parseFootprint(i?.full_domain_metrics?.organic);
      return { domain, commonKeywords: n0(i?.intersections), avgPosition: round(num(i?.avg_position), 1), traffic: full.traffic, keywords: full.keywords };
    })
    .filter((x): x is ExplorerCompetitor => !!x);
}

export type BacklinkProfile = {
  /** Link authority 0–100 (the vendor's 0–1000 domain rank, divided by ten). */
  authority: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  /** Referring domains with at least one followed link, and those with none. */
  followedDomains: number | null;
  nofollowDomains: number | null;
  referringIps: number | null;
  brokenBacklinks: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  tlds: { tld: string; links: number }[];
};
export function parseBacklinkProfile(r: any): BacklinkProfile {
  const domains = num(r?.referring_domains), nofollow = num(r?.referring_domains_nofollow);
  const rank = num(r?.rank);
  const tlds = Object.entries((r?.referring_links_tld ?? {}) as Record<string, unknown>)
    .map(([tld, links]) => ({ tld, links: n0(links) })).filter((t) => t.tld && t.links > 0)
    .sort((a, b) => b.links - a.links).slice(0, 6);
  return {
    authority: rank == null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))),
    backlinks: num(r?.backlinks),
    referringDomains: domains,
    followedDomains: domains != null && nofollow != null ? Math.max(0, domains - nofollow) : null,
    nofollowDomains: nofollow,
    referringIps: num(r?.referring_ips),
    brokenBacklinks: num(r?.broken_backlinks),
    spamScore: num(r?.backlinks_spam_score) ?? num(r?.info?.target_spam_score),
    firstSeen: str(r?.first_seen)?.slice(0, 10) ?? null,
    tlds,
  };
}

export type ReferringDomain = { domain: string; authority: number | null; backlinks: number | null; firstSeen: string | null; spamScore: number | null; followed: boolean };
export function parseReferringDomain(item: any): ReferringDomain | null {
  const domain = str(item?.domain);
  if (!domain) return null;
  const rank = num(item?.rank), pages = num(item?.referring_pages), nofollow = num(item?.referring_pages_nofollow);
  return {
    domain, authority: rank == null ? null : Math.round(rank / 10), backlinks: num(item?.backlinks),
    firstSeen: str(item?.first_seen)?.slice(0, 10) ?? null, spamScore: num(item?.backlinks_spam_score),
    followed: pages == null || nofollow == null ? true : nofollow < pages,
  };
}

export type Anchor = { anchor: string; backlinks: number | null; referringDomains: number | null; firstSeen: string | null };
export function parseAnchor(item: any): Anchor | null {
  if (!item || typeof item !== "object") return null;
  return { anchor: str(item.anchor) ?? "", backlinks: num(item.backlinks), referringDomains: num(item.referring_domains), firstSeen: str(item.first_seen)?.slice(0, 10) ?? null };
}

export type LinkHistoryPoint = { month: string; backlinks: number; referringDomains: number; newBacklinks: number; lostBacklinks: number; authority: number | null };
/** backlinks/history items (one per month), oldest first. */
export function parseLinkHistory(items: any[]): LinkHistoryPoint[] {
  return items
    .map((i) => {
      const month = str(i?.date)?.slice(0, 7);
      if (!month) return null;
      const rank = num(i?.rank);
      return { month, backlinks: n0(i?.backlinks), referringDomains: n0(i?.referring_domains), newBacklinks: n0(i?.new_backlinks), lostBacklinks: n0(i?.lost_backlinks), authority: rank == null ? null : Math.round(rank / 10) };
    })
    .filter((x): x is LinkHistoryPoint => !!x)
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type ReportSection = "history" | "linkHistory" | "keywords" | "pages" | "competitors" | "referringDomains" | "anchors";
export type DomainReport = {
  domain: string; locationCode: number; languageCode: string; fetchedAt: string;
  organic: SearchFootprint;
  paid: SearchFootprint;
  links: BacklinkProfile;
  history: HistoryPoint[] | null;
  /** Backlinks and referring domains by month (absent on reports saved before 2026-10-08). */
  linkHistory?: LinkHistoryPoint[] | null;
  keywords: ExplorerKeyword[] | null;
  keywordsTotal: number | null;
  intents: IntentRow[] | null;
  pages: ExplorerPage[] | null;
  pagesTotal: number | null;
  competitors: ExplorerCompetitor[] | null;
  referringDomains: ReferringDomain[] | null;
  anchors: Anchor[] | null;
  /** Sections the source did not return this time. */
  missing: ReportSection[];
};

type Raw = {
  overview: any; summary: any;
  history?: any[] | null; linkHistory?: any[] | null; keywords?: { items: any[]; total: number | null } | null; pages?: { items: any[]; total: number | null } | null;
  competitors?: any[] | null; referringDomains?: any[] | null; anchors?: any[] | null;
};
/** Assemble a report from the raw vendor pieces (a null piece is a missing section). */
export function buildDomainReport(input: { domain: string; locationCode: number; languageCode: string; fetchedAt?: string }, raw: Raw): DomainReport {
  const keywords = raw.keywords ? raw.keywords.items.map(parseExplorerKeyword).filter((x): x is ExplorerKeyword => !!x) : null;
  const sections: [ReportSection, unknown][] = [
    ["history", raw.history], ["linkHistory", raw.linkHistory], ["keywords", raw.keywords], ["pages", raw.pages],
    ["competitors", raw.competitors], ["referringDomains", raw.referringDomains], ["anchors", raw.anchors],
  ];
  return {
    domain: input.domain, locationCode: input.locationCode, languageCode: input.languageCode,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    organic: parseFootprint(raw.overview?.metrics?.organic),
    paid: parseFootprint(raw.overview?.metrics?.paid),
    links: parseBacklinkProfile(raw.summary),
    history: raw.history ? parseHistory(raw.history) : null,
    linkHistory: raw.linkHistory ? parseLinkHistory(raw.linkHistory) : null,
    keywords, keywordsTotal: raw.keywords?.total ?? null,
    intents: keywords ? intentBreakdown(keywords) : null,
    pages: raw.pages ? raw.pages.items.map(parseExplorerPage).filter((x): x is ExplorerPage => !!x) : null,
    pagesTotal: raw.pages?.total ?? null,
    competitors: raw.competitors ? parseCompetitors(raw.competitors, input.domain) : null,
    referringDomains: raw.referringDomains ? raw.referringDomains.map(parseReferringDomain).filter((x): x is ReferringDomain => !!x) : null,
    anchors: raw.anchors ? raw.anchors.map(parseAnchor).filter((x): x is Anchor => !!x) : null,
    missing: sections.filter(([, v]) => !v).map(([k]) => k),
  };
}

/** Run the eight calls. The overview and the backlink summary must succeed; the lists are best effort. */
export async function fetchDomainReport(input: { domain: string; locationCode: number; languageCode: string }): Promise<{ data: DomainReport; costUsd: number }> {
  const labs = { target: input.domain, location_code: input.locationCode, language_code: input.languageCode };
  const links = { target: input.domain, include_subdomains: true, backlinks_status_type: "live", rank_scale: "one_thousand" };
  let costUsd = 0;
  const call = async (path: string, body: Record<string, unknown>): Promise<DfsTask> => {
    const task = assertOk(await request("POST", path, [body]), { treatNoResultsAsEmpty: true });
    costUsd += cost(task);
    return task;
  };
  const optional = async <T>(label: ReportSection, run: () => Promise<T>): Promise<T | null> => {
    try { return await run(); } catch (e: any) { console.warn(`[seo] explorer ${input.domain}: ${label} unavailable — ${e?.message ?? e}`); return null; }
  };
  const list = async (path: string, body: Record<string, unknown>) => {
    const task = await call(path, body);
    return { items: taskItems(task), total: num(task.result?.[0]?.total_count) };
  };

  const yearAgo = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  const [overview, summary, history, linkHistory, keywords, pages, competitors, referringDomains, anchors] = await Promise.all([
    call("/dataforseo_labs/google/domain_rank_overview/live", { ...labs, limit: 1 }).then((t) => taskItems(t)[0] ?? {}),
    call("/backlinks/summary/live", { ...links, internal_list_limit: 10 }).then((t) => t.result?.[0] ?? {}),
    optional("history", () => list("/dataforseo_labs/google/historical_rank_overview/live", labs).then((r) => r.items)),
    optional("linkHistory", () => list("/backlinks/history/live", { target: input.domain, date_from: yearAgo, rank_scale: "one_thousand" }).then((r) => r.items)),
    optional("keywords", () => list("/dataforseo_labs/google/ranked_keywords/live", { ...labs, limit: KEYWORD_ROWS, item_types: ["organic"], order_by: ["ranked_serp_element.serp_item.etv,desc"] })),
    optional("pages", () => list("/dataforseo_labs/google/relevant_pages/live", { ...labs, limit: PAGE_ROWS, order_by: ["metrics.organic.etv,desc"] })),
    optional("competitors", () => list("/dataforseo_labs/google/competitors_domain/live", { ...labs, limit: COMPETITOR_ROWS + 1, exclude_top_domains: true }).then((r) => r.items)),
    optional("referringDomains", () => list("/backlinks/referring_domains/live", { ...links, limit: LINK_ROWS, order_by: ["rank,desc"] }).then((r) => r.items)),
    optional("anchors", () => list("/backlinks/anchors/live", { ...links, limit: LINK_ROWS, order_by: ["backlinks,desc"] }).then((r) => r.items)),
  ]);
  return { data: buildDomainReport(input, { overview, summary, history, linkHistory, keywords, pages, competitors, referringDomains, anchors }), costUsd };
}

// ── Storage ────────────────────────────────────────────────────────────────

export const EXPLORER_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_domain_reports (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain text NOT NULL,
    location_code integer NOT NULL DEFAULT 2840,
    language_code text NOT NULL DEFAULT 'en',
    report jsonb NOT NULL,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS seo_domain_reports_lookup ON seo_domain_reports(user_id, domain, location_code, created_at DESC)`,
];

/** This account's newest report for the domain, with whether it is still inside the free window. */
export async function latestReport(userId: number, domain: string, locationCode: number): Promise<{ report: DomainReport; fresh: boolean } | null> {
  const { rows: [row] } = await pool.query(
    `SELECT report, (created_at > now() - make_interval(days => $4)) AS fresh FROM seo_domain_reports
      WHERE user_id=$1 AND domain=$2 AND location_code=$3 ORDER BY created_at DESC LIMIT 1`, [userId, domain, locationCode, REPORT_TTL_DAYS]);
  return row ? { report: row.report, fresh: row.fresh === true } : null;
}

export async function saveReport(userId: number, report: DomainReport, costUsd: number): Promise<void> {
  await pool.query(
    `INSERT INTO seo_domain_reports(user_id, domain, location_code, language_code, report, cost_usd) VALUES($1,$2,$3,$4,$5,$6)`,
    [userId, report.domain, report.locationCode, report.languageCode, JSON.stringify(report), costUsd]);
  // Keep the last 12 reports per domain (a year of weekly refreshes is more than the trend needs).
  await pool.query(
    `DELETE FROM seo_domain_reports WHERE user_id=$1 AND domain=$2 AND id NOT IN
       (SELECT id FROM seo_domain_reports WHERE user_id=$1 AND domain=$2 ORDER BY created_at DESC LIMIT 12)`, [userId, report.domain]);
}

/** Domains this account looked up, newest first, with the headline numbers for the list. */
export async function recentReports(userId: number, limit = 12) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (domain) domain, created_at,
            (report->'links'->>'authority')::float8 AS authority,
            (report->'links'->>'referringDomains')::float8 AS referring_domains,
            (report->'organic'->>'keywords')::float8 AS keywords,
            (report->'organic'->>'traffic')::float8 AS traffic
       FROM seo_domain_reports WHERE user_id=$1 ORDER BY domain, created_at DESC`, [userId]);
  return rows
    .sort((a: any, b: any) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, limit)
    .map((r: any) => ({ domain: r.domain, fetchedAt: r.created_at, authority: r.authority, referringDomains: r.referring_domains, keywords: r.keywords, traffic: r.traffic }));
}
