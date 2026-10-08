/**
 * DataForSEO v3 client for the SEO toolset: Google organic SERP (standard
 * task queue + live), Google Ads search volume, DataForSEO Labs (ranked
 * keywords, keyword suggestions, domain intersection) and Backlinks (summary +
 * list). On-page is not here — Site Scan (server/sitescan) is our own crawler.
 *
 * Every call returns `{ data, costUsd }` where costUsd is the `cost` DataForSEO
 * reports on the task, so server/seo/budget.ts can settle the reservation it
 * made from the pricing.ts estimate. Credentials come from DATAFORSEO_LOGIN /
 * DATAFORSEO_PASSWORD (HTTP basic); without them isConfigured() is false and
 * every route answers { configured: false } instead of calling anything.
 *
 * The request core, envelope checks, rank-result builder and the task_post /
 * task_get flow are ported from OpenSEO (github.com/every-app/open-seo,
 * src/server/lib/dataforseo/{core,envelope,serp,labs,backlinks,google-ads}.ts).
 *
 *   MIT License — Copyright (c) 2026 Ben Senescu
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, subject to the above copyright notice and this
 *   permission notice being included in all copies or substantial portions of
 *   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */
import { clampSerpDepth } from "./pricing";

export const API_BASE = "https://api.dataforseo.com/v3";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;
/** task_post accepts up to 100 tasks per request. */
export const MAX_TASKS_PER_POST = 100;

/** Swappable for tests (no live calls there). */
export const dataforseoDeps: { fetch: typeof fetch; env: () => NodeJS.ProcessEnv } = {
  fetch: (...args) => globalThis.fetch(...args),
  env: () => process.env,
};

export function isConfigured(env: NodeJS.ProcessEnv = dataforseoDeps.env()): boolean {
  return !!(env.DATAFORSEO_LOGIN?.trim() && env.DATAFORSEO_PASSWORD?.trim());
}

export type DataForSeoErrorCode = "not_configured" | "auth" | "rate_limited" | "upstream" | "task_failed" | "invalid" | "timeout";

export class DataForSeoError extends Error {
  constructor(
    readonly code: DataForSeoErrorCode,
    message: string,
    /** What DataForSEO charged for the failed task (0 when nothing ran). */
    readonly costUsd = 0,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

export interface DfsTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  path?: string[];
  cost?: number;
  result_count?: number;
  data?: Record<string, unknown>;
  result?: any[];
  [key: string]: unknown;
}
export interface DfsResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: DfsTask[];
  [key: string]: unknown;
}

export type Priced<T> = { data: T; costUsd: number };

function basicAuth(env: NodeJS.ProcessEnv): string {
  return "Basic " + Buffer.from(`${env.DATAFORSEO_LOGIN!.trim()}:${env.DATAFORSEO_PASSWORD!.trim()}`).toString("base64");
}

/**
 * Authenticated request; retries idempotent reads on transient 5xx, never a
 * POST that may already have been charged (retries=0 for those).
 */
export async function request(method: "GET" | "POST", path: string, body?: unknown, retries = method === "GET" ? MAX_RETRIES : 0): Promise<DfsResponse> {
  const env = dataforseoDeps.env();
  if (!isConfigured(env)) throw new DataForSeoError("not_configured", "DataForSEO is not connected (set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD).");
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await dataforseoDeps.fetch(`${API_BASE}${path}`, {
        method,
        headers: { Authorization: basicAuth(env), Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        body: method === "POST" ? JSON.stringify(body ?? []) : undefined,
        signal,
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError")
        throw new DataForSeoError("timeout", `DataForSEO request timed out on ${path}`);
      throw new DataForSeoError("upstream", `DataForSEO unreachable on ${path}: ${e?.message ?? e}`);
    }
    if (res.ok) {
      let text: string;
      // The body can still time out or break off after the headers arrived.
      try { text = await res.text(); }
      catch (e: any) { throw new DataForSeoError(e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "upstream", `DataForSEO response was cut off on ${path}`); }
      if (!text) throw new DataForSeoError("upstream", "DataForSEO returned an empty response");
      try { return JSON.parse(text) as DfsResponse; } catch { throw new DataForSeoError("upstream", "DataForSEO returned a non-JSON response"); }
    }
    if (res.status >= 500 && attempt < retries) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
      continue;
    }
    const code: DataForSeoErrorCode = res.status === 401 ? "auth" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "upstream" : "invalid";
    throw new DataForSeoError(code, res.status === 401
      ? "DataForSEO rejected the login (check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)."
      : `DataForSEO HTTP ${res.status} on ${path}`, 0, res.status);
  }
}

// ── Envelope ────────────────────────────────────────────────────────────────

/** Task Created / Task Handed / Task In Queue: a task_get that is not done yet. */
const TASK_IN_PROGRESS = new Set([20100, 40601, 40602]);
export const isTaskInProgress = (t: DfsTask) => t.status_code !== undefined && TASK_IN_PROGRESS.has(t.status_code);
/** 40501 "No Search Results." is a billed, valid, empty SERP — not a failure. */
export const isNoResultsTask = (t: DfsTask) => (t.status_message ?? "").toLowerCase().includes("no search results");
/** DataForSEO's own backend failing (see docs.dataforseo.com/v3/appendix/errors). */
const UPSTREAM_TASK_CODES = new Set([40101, 40103, 50000, 50301, 50302, 50303, 50304, 50401, 50402]);
/** Not enough money on the DataForSEO balance. */
const BALANCE_CODES = new Set([40200, 40201, 40202, 40203]);

export function assertOk(response: DfsResponse | null | undefined, opts: { okTaskStatus?: number; treatNoResultsAsEmpty?: boolean } = {}): DfsTask {
  if (!response) throw new DataForSeoError("upstream", "DataForSEO returned an empty response");
  if (response.status_code !== 20000) {
    const code: DataForSeoErrorCode = response.status_code === 40100 || response.status_code === 40101 ? "auth" : response.status_code === 40202 ? "rate_limited" : "invalid";
    throw new DataForSeoError(code, response.status_message || "DataForSEO request failed", 0, response.status_code);
  }
  const task = response.tasks?.[0];
  if (!task) throw new DataForSeoError("upstream", "DataForSEO response is missing its task");
  const ok = opts.okTaskStatus ?? 20000;
  if (task.status_code !== ok) {
    if (opts.treatNoResultsAsEmpty && isNoResultsTask(task)) return task;
    const message = task.status_message || `DataForSEO task failed (${task.status_code})`;
    const cost = typeof task.cost === "number" ? task.cost : 0;
    if (task.status_code !== undefined && BALANCE_CODES.has(task.status_code))
      throw new DataForSeoError("auth", `DataForSEO balance problem: ${message}`, cost, task.status_code);
    if (task.status_code !== undefined && UPSTREAM_TASK_CODES.has(task.status_code))
      throw new DataForSeoError("upstream", message, cost, task.status_code);
    throw new DataForSeoError("task_failed", message, cost, task.status_code);
  }
  return task;
}

const taskCost = (t: DfsTask) => (typeof t.cost === "number" && Number.isFinite(t.cost) ? t.cost : 0);
/** `task.result[0].items` for the live endpoints that wrap a list. */
export function taskItems<T = any>(task: DfsTask): T[] {
  const first = task.result?.[0];
  const items = first && typeof first === "object" ? (first as any).items : null;
  return Array.isArray(items) ? items : [];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// ── SERP: rank checks ───────────────────────────────────────────────────────

export type Device = "desktop" | "mobile";
export interface RankCheckResult {
  keywordId: number;
  keyword: string;
  /** rank_group: position among organic results (what people count as "my ranking"); null = not found in the crawled depth. */
  position: number | null;
  url: string | null;
  /** Distinct SERP element types on the page (organic, local_pack, people_also_ask, ai_overview, …). */
  serpFeatures: string[];
  /** This business's place in the Google map pack (1-3); null when it is not in it or Google showed none. */
  localPosition: number | null;
  /** Who Google showed in the map pack, in order. Empty when there was none. */
  localPack: { position: number; title: string; domain: string | null }[];
}

/** A business name reduced to what identifies it: lower case, no punctuation, no "LLC"/"Inc". */
export function normalizeBusinessName(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|incorporated|co|corp|corporation|company|ltd|the)\b/g, " ").replace(/\s+/g, " ").trim();
}
/** Is this map-pack entry the tracked business? By website when the entry has one, else by name. */
export function isOurListing(item: { domain?: unknown; title?: unknown }, targetDomain: string, businessName?: string | null): boolean {
  const target = targetDomain.toLowerCase().replace(/^www\./, "");
  if (typeof item.domain === "string" && item.domain) {
    const d = item.domain.toLowerCase().replace(/^www\./, "");
    if (d === target || d.endsWith(`.${target}`)) return true;
  }
  const ours = normalizeBusinessName(businessName), theirs = normalizeBusinessName(typeof item.title === "string" ? item.title : "");
  if (ours.length < 4 || theirs.length < 4) return false;
  return ours === theirs || (ours.length >= 8 && theirs.startsWith(ours)) || (theirs.length >= 8 && ours.startsWith(theirs));
}

/** The organic result for the tracked domain (with subdomains), like OpenSEO's buildRankCheckResult. */
export function buildRankResult(input: { keywordId: number; keyword: string; targetDomain: string; businessName?: string | null }, items: any[]): RankCheckResult {
  const target = input.targetDomain.toLowerCase().replace(/^www\./, "");
  const match = items.find((item) => {
    if (!item || item.type !== "organic" || typeof item.domain !== "string") return false;
    const d = item.domain.toLowerCase().replace(/^www\./, "");
    return d === target || d.endsWith(`.${target}`);
  });
  const packItems = items.filter((i) => i && i.type === "local_pack");
  const pack = packItems.map((i, n) => ({ position: num(i.rank_group) ?? n + 1, title: str(i.title) ?? "", domain: str(i.domain) }));
  const ours = packItems.findIndex((i) => isOurListing(i, input.targetDomain, input.businessName));
  return {
    keywordId: input.keywordId,
    keyword: input.keyword,
    position: match ? num(match.rank_group) ?? num(match.rank_absolute) : null,
    url: match ? str(match.url) : null,
    serpFeatures: [...new Set(items.map((i) => (i && typeof i.type === "string" ? i.type : "")).filter(Boolean))],
    localPosition: ours >= 0 ? pack[ours].position : null,
    localPack: pack,
  };
}

/**
 * Stop crawling pages once the domain shows up in the organic results — fewer
 * pages billed for a page-1 ranking. Restricted to organic so a sitelink or
 * PAA mention can't end the crawl before the real listing.
 */
const stopOnTarget = (domain: string) => ({
  stop_crawl_on_match: [{ match_value: domain, match_type: "with_subdomains" }],
  find_targets_in: ["organic"],
});

export interface RankTaskInput { keyword: string; keywordId: number; device: Device; /** Where to check from, when not the site's own place. */ locationCode?: number }
export interface PostedRankTask extends RankTaskInput { taskId: string }

/** Standard-queue task_post (charged now; results collected free by serpTaskGet). */
export async function serpTaskPost(input: { tasks: RankTaskInput[]; locationCode: number; languageCode: string; depth: number; targetDomain: string }): Promise<Priced<PostedRankTask[]>> {
  if (!input.tasks.length || input.tasks.length > MAX_TASKS_PER_POST)
    throw new DataForSeoError("invalid", `task_post takes 1–${MAX_TASKS_PER_POST} tasks, got ${input.tasks.length}`);
  const depth = clampSerpDepth(input.depth);
  const response = await request("POST", "/serp/google/organic/task_post", input.tasks.map((t) => ({
    keyword: t.keyword,
    location_code: t.locationCode ?? input.locationCode,
    language_code: input.languageCode,
    device: t.device,
    os: t.device === "desktop" ? "windows" : "android",
    depth,
    priority: 1,
    ...stopOnTarget(input.targetDomain),
    tag: `${t.keywordId}:${t.device}`,
  })));
  if (!response || response.status_code !== 20000)
    throw new DataForSeoError("invalid", response?.status_message || "DataForSEO task_post failed", 0, response?.status_code);
  return parseTaskPost(response, input.tasks);
}

/** One entry per submitted task; 20100 "Task Created" = accepted. Every entry's cost counts, accepted or not. */
export function parseTaskPost(response: DfsResponse, tasks: RankTaskInput[]): Priced<PostedRankTask[]> {
  const byTag = new Map(tasks.map((t) => [`${t.keywordId}:${t.device}`, t]));
  const posted: PostedRankTask[] = [];
  let costUsd = 0;
  for (const entry of response.tasks ?? []) {
    costUsd += taskCost(entry);
    const tag = entry.data?.tag;
    const task = typeof tag === "string" ? byTag.get(tag) : undefined;
    if (entry.status_code !== 20100 || !entry.id || !task) continue;
    posted.push({ ...task, taskId: entry.id });
  }
  return { data: posted, costUsd };
}

export type RankTaskOutcome =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "completed"; result: RankCheckResult };

/** Collect one queued task (free). */
export async function serpTaskGet(input: { taskId: string; keywordId: number; keyword: string; targetDomain: string; businessName?: string | null }): Promise<RankTaskOutcome> {
  const response = await request("GET", `/serp/google/organic/task_get/advanced/${encodeURIComponent(input.taskId)}`);
  return parseTaskGet(response, input);
}

export function parseTaskGet(response: DfsResponse, input: { keywordId: number; keyword: string; targetDomain: string; businessName?: string | null }): RankTaskOutcome {
  const task = response?.tasks?.[0];
  if (!response || response.status_code !== 20000 || !task)
    throw new DataForSeoError("upstream", response?.status_message || "DataForSEO task_get failed", 0, response?.status_code);
  if (isTaskInProgress(task)) return { status: "pending" };
  if (task.status_code !== 20000) {
    if (!isNoResultsTask(task)) return { status: "failed", message: task.status_message || `DataForSEO task failed (${task.status_code})` };
    return { status: "completed", result: buildRankResult(input, []) };
  }
  return { status: "completed", result: buildRankResult(input, taskItems(task)) };
}

/** Live rank check (instant, ~3.3× the standard queue). */
export async function serpLive(input: { keyword: string; keywordId: number; locationCode: number; languageCode: string; device: Device; targetDomain: string; depth: number }): Promise<Priced<RankCheckResult>> {
  const response = await request("POST", "/serp/google/organic/live/advanced", [{
    keyword: input.keyword,
    location_code: input.locationCode,
    language_code: input.languageCode,
    device: input.device,
    os: input.device === "desktop" ? "windows" : "android",
    depth: clampSerpDepth(input.depth),
    ...stopOnTarget(input.targetDomain),
  }]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  return { data: buildRankResult(input, taskItems(task)), costUsd: taskCost(task) };
}

// ── Keywords Data: Google Ads search volume ─────────────────────────────────

export interface KeywordVolume { keyword: string; searchVolume: number | null; cpc: number | null; competition: string | null }

export function parseAdsVolumeItem(item: any): KeywordVolume | null {
  const keyword = str(item?.keyword);
  if (!keyword) return null;
  return { keyword, searchVolume: num(item.search_volume), cpc: num(item.cpc), competition: str(item.competition) };
}

export async function adsSearchVolume(input: { keywords: string[]; locationCode: number; languageCode: string }): Promise<Priced<KeywordVolume[]>> {
  const response = await request("POST", "/keywords_data/google_ads/search_volume/live", [{
    keywords: input.keywords.slice(0, 1000),
    location_code: input.locationCode,
    language_code: input.languageCode,
  }]);
  const task = assertOk(response);
  const rows = Array.isArray(task.result) ? task.result : [];
  return { data: rows.map(parseAdsVolumeItem).filter((x): x is KeywordVolume => !!x), costUsd: taskCost(task) };
}

// ── DataForSEO Labs ─────────────────────────────────────────────────────────

export interface KeywordIdea {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  /** 0–100 keyword difficulty (keyword_properties.keyword_difficulty). */
  difficulty: number | null;
  /** 0–1 paid competition ratio. */
  competition: number | null;
  intent: string | null;
}

/** keyword_suggestions / keyword_ideas item (keyword_data-shaped). */
export function parseKeywordItem(item: any): KeywordIdea | null {
  const kd = item?.keyword_data ?? item;
  const keyword = str(kd?.keyword);
  if (!keyword) return null;
  const info = kd.keyword_info ?? {};
  return {
    keyword,
    searchVolume: num(info.search_volume),
    cpc: num(info.cpc),
    difficulty: num(kd.keyword_properties?.keyword_difficulty) ?? num(info.keyword_difficulty),
    competition: num(info.competition),
    intent: str(kd.search_intent_info?.main_intent),
  };
}

export async function labsKeywordSuggestions(input: { keyword: string; locationCode: number; languageCode: string; limit: number }): Promise<Priced<KeywordIdea[]>> {
  const response = await request("POST", "/dataforseo_labs/google/keyword_suggestions/live", [{
    keyword: input.keyword,
    location_code: input.locationCode,
    language_code: input.languageCode,
    limit: input.limit,
    include_seed_keyword: true,
    include_serp_info: false,
    // Clickstream-refined volumes double the price: off.
    include_clickstream_data: false,
    ignore_synonyms: false,
    exact_match: false,
  }]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  return { data: taskItems(task).map(parseKeywordItem).filter((x): x is KeywordIdea => !!x), costUsd: taskCost(task) };
}

export interface RankedKeyword extends KeywordIdea {
  position: number | null;
  url: string | null;
  /** Estimated monthly traffic from this ranking. */
  etv: number | null;
}

export function parseRankedKeywordItem(item: any): RankedKeyword | null {
  const base = parseKeywordItem(item?.keyword_data ? item : { keyword_data: item?.keyword_data });
  if (!base) return null;
  const el = item.ranked_serp_element?.serp_item ?? item.ranked_serp_element ?? {};
  return { ...base, position: num(el.rank_group) ?? num(el.rank_absolute), url: str(el.url), etv: num(el.etv) };
}

export async function labsRankedKeywords(input: { target: string; locationCode: number; languageCode: string; limit: number }): Promise<Priced<{ items: RankedKeyword[]; totalCount: number | null }>> {
  const response = await request("POST", "/dataforseo_labs/google/ranked_keywords/live", [{
    target: input.target,
    location_code: input.locationCode,
    language_code: input.languageCode,
    limit: input.limit,
    item_types: ["organic"],
    order_by: ["ranked_serp_element.serp_item.etv,desc"],
  }]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  const first = task.result?.[0];
  return {
    data: { items: taskItems(task).map(parseRankedKeywordItem).filter((x): x is RankedKeyword => !!x), totalCount: num(first?.total_count) },
    costUsd: taskCost(task),
  };
}

export interface GapKeyword extends KeywordIdea {
  /** The competitor's organic position and page. */
  competitorPosition: number | null;
  competitorUrl: string | null;
  /** Ours, when we rank at all (null in the gap view). */
  ourPosition: number | null;
  etv: number | null;
}

/** domain_intersection item: keyword_data + first/second_domain_serp_element. */
export function parseIntersectionItem(item: any): GapKeyword | null {
  const base = parseKeywordItem(item);
  if (!base) return null;
  const a = item.first_domain_serp_element ?? {};
  const b = item.second_domain_serp_element ?? null;
  return {
    ...base,
    competitorPosition: num(a.rank_group) ?? num(a.rank_absolute),
    competitorUrl: str(a.url),
    ourPosition: b ? num(b.rank_group) ?? num(b.rank_absolute) : null,
    etv: num(a.etv),
  };
}

/**
 * Keywords `competitor` ranks for that `ours` does not (intersections=false:
 * keywords where only the first target ranks).
 */
export async function labsDomainIntersection(input: { competitor: string; ours: string; locationCode: number; languageCode: string; limit: number }): Promise<Priced<{ items: GapKeyword[]; totalCount: number | null }>> {
  const response = await request("POST", "/dataforseo_labs/google/domain_intersection/live", [{
    target1: input.competitor,
    target2: input.ours,
    location_code: input.locationCode,
    language_code: input.languageCode,
    limit: input.limit,
    intersections: false,
    item_types: ["organic"],
    order_by: ["first_domain_serp_element.etv,desc"],
  }]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  const first = task.result?.[0];
  return {
    data: { items: taskItems(task).map(parseIntersectionItem).filter((x): x is GapKeyword => !!x), totalCount: num(first?.total_count) },
    costUsd: taskCost(task),
  };
}

// ── Backlinks ───────────────────────────────────────────────────────────────

export interface BacklinkSummary {
  target: string | null;
  /** DataForSEO rank 0–1000 (rank_scale one_thousand). */
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  brokenBacklinks: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  newReferringDomains: number | null;
  lostReferringDomains: number | null;
  spamScore: number | null;
}

export function parseBacklinkSummary(r: any): BacklinkSummary {
  return {
    target: str(r?.target),
    rank: num(r?.rank),
    backlinks: num(r?.backlinks),
    referringDomains: num(r?.referring_domains),
    referringPages: num(r?.referring_pages),
    brokenBacklinks: num(r?.broken_backlinks),
    newBacklinks: num(r?.new_backlinks),
    lostBacklinks: num(r?.lost_backlinks),
    newReferringDomains: num(r?.new_referring_domains) ?? num(r?.new_reffering_domains),
    lostReferringDomains: num(r?.lost_referring_domains) ?? num(r?.lost_reffering_domains),
    spamScore: num(r?.backlinks_spam_score) ?? num(r?.info?.target_spam_score),
  };
}

export interface Backlink {
  domainFrom: string | null;
  urlFrom: string | null;
  urlTo: string | null;
  anchor: string | null;
  dofollow: boolean;
  rank: number | null;
  domainRank: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isNew: boolean;
  isLost: boolean;
}

export function parseBacklinkRow(item: any): Backlink | null {
  if (!item || typeof item !== "object") return null;
  return {
    domainFrom: str(item.domain_from),
    urlFrom: str(item.url_from),
    urlTo: str(item.url_to),
    anchor: str(item.anchor),
    dofollow: item.dofollow === true,
    rank: num(item.rank),
    domainRank: num(item.domain_from_rank),
    spamScore: num(item.backlink_spam_score) ?? num(item.backlinks_spam_score),
    firstSeen: str(item.first_seen),
    lastSeen: str(item.last_visited) ?? str(item.last_seen),
    isNew: item.is_new === true,
    isLost: item.is_lost === true,
  };
}

const backlinksPayload = (target: string) => ({
  target,
  include_subdomains: true,
  include_indirect_links: true,
  exclude_internal_backlinks: true,
  backlinks_status_type: "live",
  rank_scale: "one_thousand",
});

export async function backlinksSummary(input: { target: string }): Promise<Priced<BacklinkSummary>> {
  const response = await request("POST", "/backlinks/summary/live", [backlinksPayload(input.target)]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  return { data: parseBacklinkSummary(task.result?.[0] ?? {}), costUsd: taskCost(task) };
}

export async function backlinksList(input: { target: string; limit: number }): Promise<Priced<{ items: Backlink[]; totalCount: number | null }>> {
  const response = await request("POST", "/backlinks/backlinks/live", [{
    ...backlinksPayload(input.target),
    limit: Math.min(1000, Math.max(1, input.limit)),
    mode: "one_per_domain",
    order_by: ["rank,desc"],
  }]);
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  const first = task.result?.[0];
  return {
    data: { items: taskItems(task).map(parseBacklinkRow).filter((x): x is Backlink => !!x), totalCount: num(first?.total_count) },
    costUsd: taskCost(task),
  };
}

/** Normalise what a person typed into a bare hostname ("https://www.x.com/a" → "x.com"). */
export function normalizeDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try { host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname; } catch { return null; }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}
