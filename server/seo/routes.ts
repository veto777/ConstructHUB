/**
 * /api/seo/* — ConstructHUB SEO's API. Session auth through the platform's
 * getDevUser, plan-gated on the SEO allowance (server/seo/plan.ts: the Agency
 * plan, or an account grandfathered on another plan). Every row is
 * scoped to the signed-in account. Agency delegation is NOT wired here:
 * /api/seo is outside registerAgencyAccess's allowlist (server/agency/
 * middleware.ts), so an agency member sees their own SEO data, not a client's.
 *
 * White-label: the customer buys plan units — tracked keywords (a standing
 * count), keyword searches and backlink refreshes per month (shared/plans.ts
 * SEO_PLAN_LIMITS) — enforced here with the platform's 402/403 bodies. The
 * data vendor (DataForSEO), its prices and the internal dollar cap
 * (server/seo/budget.ts) never appear in a customer response: the status
 * payload carries plan units only, and the vendor state goes to platform
 * admins alone (`admin` on /api/seo/status, GET /api/seo/admin/usage).
 * Without vendor credentials every endpoint still answers with
 * `configured: false`; sites and keywords save, checks wait for the source.
 */
import { pageMetricsInput, cleanUrls, fetchPageMetrics, mergePageMetrics, retryPlan, planEstimateUsd, pageMetricsEstimateUsd, PAGE_METRICS_MAX, type PageMetrics } from "./page-metrics";
import { directoriesInput, fetchDirectories, mergeDirectories, directoriesEstimateUsd, DIRECTORIES_MAX_SITES, type DirectoriesPage } from "./directories";
import { setMentionWatch, mentionWatchView, retryWatchedLinks } from "./mention-watch";
import { siteOutgoingLinks } from "./outgoing-links";
import { gscBreakdown, searchConsoleSummary } from "./gsc-breakdown";
import { mentionsInput as webMentionsInput, markInput, nameKey as mentionNameKey, nameOk as mentionNameOk, pageKeyOf, placesInput, fetchMentions, checkLinks, placeIn, defaultPlaces, MENTIONS_ESTIMATE_USD, MENTIONS_RETRY_USD, MENTIONS_CACHE_HOURS, MENTIONS_ROWS, type MentionsPage } from "./mentions";
import { plannerInput, cleanTerms, fetchPlanner, plannerEstimateUsd, plannerTooLong, PLANNER_MAX_CELLS, PLANNER_MAX_CHARS, PLANNER_MAX_WORDS, type Planner } from "./planner";
import { tasksInput, taskPatch, listTasks, addTasks, updateTask, deleteTask, openTaskCounts, markResolved, markUnavailable, MAX_OPEN_TASKS, MAX_CLOSED_SHOWN } from "./tasks";
import { watchInput, listWatches, saveWatch, deleteWatch, runGridScan, WatchError, MAX_WATCHES } from "./grid-monitor";
import { oppInput, fetchOpportunities, OPP_ESTIMATE_USD, type Opportunities } from "./opportunities";
import { scanInput, locateInput, pinInput, readPin, savePin, beginScan, finishScan, failScan, runningScan, listScans, getScan, locateBusiness, fetchGrid, gridEstimateUsd, GRID_SIZES, GRID_SPACINGS, GRID_DEPTH, GRID_POINT_USD, GRID_STALE_MINUTES, type GridScan, type MapListing } from "./grid";
import { renderInput, renderUrl, renderUrls, renderSuggestions, beginRender, failRender, latestRender, getRender, runRender, renderEstimateUsd, RENDER_MAX_PAGES } from "./render-check";
import { findMarket } from "@shared/seo-markets";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { isPlatformAdmin } from "../admin";
import { requirePlan, sendLimitReached, sendModuleRequired, raiseHint, plural, type Entitlements } from "../entitlements";
import { monthlyUsage, reserveQuotaFor, refundReservation, resetsAt } from "../growth-quotas";
import { budgetStatus, withBudget, SeoBudgetError, monthlySpendByAccount, monthlyBudgetUsd, monthKey, BUDGET_PAUSED_MESSAGE } from "./budget";
import {
  isConfigured, normalizeDomain, labsKeywordSuggestions, labsDomainIntersection, adsSearchVolume, DataForSeoError, claimDeadline,
} from "./dataforseo";
import { estimateLabsUsd, estimateAdsVolumeUsd, estimateRankCheckUsd, estimateBacklinkSnapshotUsd, serpKeywordMultiplier, estimateLostLinksUsd } from "./pricing";
import { creditStatus, outOfCreditMessage, owedCreditMessage } from "./credits";
import { retailCents, SEO_CREDIT_PACKS } from "@shared/seo-credits";
import {
  reportInput, reportRequest, TooManyFilters, SCOPED_TABLES, isKeywordTable, reportCacheKey, cacheKey, cached, saveCached, fetchReportPage, fetchKeywordOverview,
  effectiveReport, fetchAdsSnapshot, adsPage, ADS_MAX, ADS_ESTIMATE_USD, ADS_TYPICAL_USD, type AdsSnapshot,
  CACHE_HOURS, KEYWORD_OVERVIEW_TTL_DAYS, REPORT_ESTIMATE_USD, REPORT_TYPICAL_USD, KEYWORD_OVERVIEW_ESTIMATE_USD, KEYWORD_OVERVIEW_TYPICAL_USD,
  type ReportPage, type KeywordOverview,
} from "./reports";
import { enqueueRankRun, postQueuedRun, snapshotBacklinks, owedRefunds, RANK_FREQUENCIES, RANK_FREQUENCY_KEYS, type SiteRow } from "./jobs";
import { seoAllowanceTest, keywordsFit, SEO_FEATURE, SEO_ENV_VARS, SEO_NOT_READY_MESSAGE } from "./plan";
import { fetchDomainReport, latestReport, saveReport, recentReports, EXPLORER_ESTIMATE_USD, EXPLORER_TYPICAL_USD, REPORT_TTL_DAYS } from "./explorer";
import { PLANS } from "@shared/plans";
import { siteAudit, auditHealthByDomain, auditDomainKey, auditEvidence } from "./audit";
import { auditPages } from "./audit-pages";
import { linkOpportunities } from "./link-opportunities";
import { rankHistory, keywordHistory } from "./rank-history";
import { rankTags } from "./rank-tags";
import { competingPages } from "./competing-pages";
import { serpGroups } from "./serp-groups";
import { dashboardRanks, groupNameSql } from "./dashboard";
import { aiSummary } from "./ai-summary";
import { watchSetting, setKeywordWatch, takeKeywordSnapshot, keywordWatchView, comparePick, KW_SNAPSHOT_ESTIMATE_USD } from "./keyword-watch";
import { searchLocations, locationByCode } from "./locations";
import { BULK_MAX } from "./lists";
import { bulkInput, bulkEstimateUsd, cleanKeywords, fetchBulkKeywords, listsOf, listItems, addToList, removeFromList, deleteList, refreshListMetrics, listItemsInput, ListError, type BulkPage } from "./lists";
import { usageHistory } from "./usage";
import { reportDeps } from "./site-report";
import { buildSiteReport, renderReportPdf, reportHighlights, reportIsEmpty, getSchedule, saveSchedule, scheduleInput, MAX_RECIPIENTS } from "./site-report";
import { sendSiteReport, validUnsubscribe, optOut, optedOut } from "./site-report-send";
import { takeBudget } from "../growth-limits";
import { shareOfVoice, latestChecks, trackedCompetitors, competitorInput as followInput, MAX_TRACKED_COMPETITORS } from "./voice";
import { listingNamed } from "./dataforseo";
import { contentInput, fetchContent, CONTENT_ESTIMATE_USD, CONTENT_TYPICAL_USD, type ContentPage } from "./content";
import { batchInput, cleanDomains, batchEstimateUsd, fetchBatch, type BatchPage } from "./batch";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD } from "./pricing";
import { askInput, mentionsInput, askAi, recentAiRun, type AiEngine, askEstimateUsd, saveAiAnswers, aiHistory, suggestPrompts, fetchAiMentions, trackedPrompts, setTracked, trackInput, MAX_TRACKED_PROMPTS, AI_ENGINES, AI_MENTIONS_ESTIMATE_USD, AI_MENTIONS_TYPICAL_USD, type AiMentionsPage } from "./ai-visibility";
import { LABS_TASK_USD, LABS_ITEM_USD } from "./pricing";
import { alertPage, unreadAlerts, undeliveredAlerts, markAlertsRead, ALERT_KINDS } from "./alerts";
import { seoErrorResponse, publicFailure, publicNote, SEO_VENDOR_NAME, SeoCustomerError } from "./public-errors";
import { seoLocks, requestQueues } from "./locks";
import { trackWork } from "../shutdown";
import { siteCapRefuses } from "./site-cap";
import { recordUnhandledError } from "../ops/server-errors";
import { recordFailure } from "../ops/issues";
import { gapInput, gapEstimateUsd, fetchGap, CONTENT_GAP_ROWS, GAP_MAX_COMPETITORS, type GapPage } from "./gap";

/**
 * What each lookup costs the customer, in cents (wholesale estimate x SEO_MARKUP).
 * Shown before they run it; the charge itself is settled to the real cost.
 */
export const SEO_PRICES = {
  explorerReport: retailCents(EXPLORER_TYPICAL_USD),
  /** One page of a Site Explorer or Keywords Explorer table. */
  reportPage: retailCents(REPORT_TYPICAL_USD),
  /** The Ads report: one lookup brings every ad the library will give; paging it is free. */
  adsReport: retailCents(ADS_TYPICAL_USD),
  keywordOverview: retailCents(KEYWORD_OVERVIEW_TYPICAL_USD),
  keywordResearch: retailCents(estimateLabsUsd(50)),
  competitorGap: retailCents(estimateLabsUsd(100)),
  /** A snapshot: the summary and the top 100 linking pages, plus (from the second snapshot on) the linking sites lost since the last one. */
  backlinkRefresh: retailCents(estimateBacklinkSnapshotUsd(100) + estimateLostLinksUsd()),
  /** Content explorer: one page of results. */
  contentSearch: retailCents(CONTENT_TYPICAL_USD),
  /** Batch analysis: a flat part plus so much per 100 websites. */
  batchBase: retailCents(3 * BACKLINKS_REQUEST_USD + LABS_TASK_USD),
  batchPer100: retailCents(100 * (3 * BACKLINKS_ROW_USD + LABS_ITEM_USD)),
  /** AI visibility: one question to one assistant, and one AI-mentions lookup. */
  aiChatgpt: retailCents(AI_ENGINES.chatgpt.typicalUsd),
  aiGemini: retailCents(AI_ENGINES.gemini.typicalUsd),
  aiPerplexity: retailCents(AI_ENGINES.perplexity.typicalUsd),
  aiMentions: retailCents(AI_MENTIONS_TYPICAL_USD),
  /** Search volumes for a site's tracked keywords (one lookup covers up to 1,000). */
  searchVolumes: retailCents(estimateAdsVolumeUsd(1)),
  /** Bulk keyword analysis: a flat part plus so much per 100 keywords. */
  bulkBase: retailCents(LABS_TASK_USD),
  bulkPer100: retailCents(100 * LABS_ITEM_USD),
  /** One page of Link intersect (the most it costs, for up to three competitors). Content gap is competitorGap per competitor. */
  linkIntersect: retailCents(gapEstimateUsd("links", GAP_MAX_COMPETITORS, 50)),
  /** Content explorer: linking sites and search visits for one page of 25 results (two lookups). */
  pageMetrics25: retailCents(pageMetricsEstimateUsd(25)),
  /** Directories: one lookup per site checked. */
  directoriesPerSite: retailCents(directoriesEstimateUsd(1)),
  /** Service-area planner: two lookups — a flat part plus so much per 100 searches in the table. */
  plannerBase: retailCents(2 * LABS_TASK_USD),
  plannerPer100: retailCents(2 * 100 * LABS_ITEM_USD),
  /** Opportunities: the most it can cost (500 keywords), and about what a site with 100 keywords costs. */
  opportunitiesMax: retailCents(OPP_ESTIMATE_USD),
  opportunitiesSmall: retailCents(estimateLabsUsd(100)),
  /** Local grid: finding the business on Google Maps, and so much per 100 points scanned. */
  gridLocate: retailCents(GRID_POINT_USD),
  gridPer100: retailCents(100 * GRID_POINT_USD),
  /** Keyword watch: one snapshot of the searches a site ranks for. */
  keywordSnapshot: retailCents(KW_SNAPSHOT_ESTIMATE_USD),
  /** Per 100 rank checks (one keyword on one device is one check, top 10). */
  rankChecksPer100: retailCents(estimateRankCheckUsd(Array.from({ length: 100 }, (_, i) => `k${i}`), "desktop", 10).usd),
};

/**
 * Exact quotes, in cents, for lookups whose size the customer chooses: entry n-1 is what must be available — and is
 * the most that can be charged — for n sites or pages. The page shows and checks this very figure, never a sum of
 * rounded per-item prices.
 */
export const SEO_QUOTES = {
  directories: Array.from({ length: DIRECTORIES_MAX_SITES }, (_, i) => retailCents(directoriesEstimateUsd(i + 1))),
  pageMetrics: Array.from({ length: PAGE_METRICS_MAX }, (_, i) => retailCents(pageMetricsEstimateUsd(i + 1))),
  render: Array.from({ length: RENDER_MAX_PAGES }, (_, i) => retailCents(renderEstimateUsd(i + 1))),
};

/**
 * What is set aside while a lookup runs (the most it can cost), in cents. A
 * lookup needs this much available to start; the unused part comes straight back.
 */
export const SEO_HOLDS = {
  explorerReport: retailCents(EXPLORER_ESTIMATE_USD),
  reportPage: retailCents(REPORT_ESTIMATE_USD),
  adsReport: retailCents(ADS_ESTIMATE_USD),
  keywordOverview: retailCents(KEYWORD_OVERVIEW_ESTIMATE_USD),
  aiChatgpt: retailCents(AI_ENGINES.chatgpt.estimateUsd),
  aiGemini: retailCents(AI_ENGINES.gemini.estimateUsd),
  aiPerplexity: retailCents(AI_ENGINES.perplexity.estimateUsd),
  aiMentions: retailCents(AI_MENTIONS_ESTIMATE_USD),
  contentSearch: retailCents(CONTENT_ESTIMATE_USD),
  gridLocate: retailCents(gridEstimateUsd(1)),
  gridPer100: retailCents(gridEstimateUsd(100)),
  keywordSnapshot: retailCents(KW_SNAPSHOT_ESTIMATE_USD),
  plannerBase: retailCents(2 * LABS_TASK_USD),
  plannerPer100: retailCents(2 * 100 * LABS_ITEM_USD),
  /** Batch analysis: what must be available to start (server/seo/batch.ts batchEstimateUsd), as a flat part plus so much per 100 websites. */
  batchBase: retailCents(3 * BACKLINKS_REQUEST_USD + LABS_TASK_USD),
  batchPer100: retailCents(100 * (3 * BACKLINKS_ROW_USD * 1.2 + LABS_ITEM_USD)),
  /** Unlinked mentions: one check (the mentions and the link check), and a second try of the link check alone. */
  mentions: retailCents(MENTIONS_ESTIMATE_USD),
  mentionsRetry: retailCents(MENTIONS_RETRY_USD),
};

/** Report names as the customer sees them (usage history). */
const REPORT_NAMES: Record<string, string> = {
  keywords: "Organic keywords", paidKeywords: "Paid keywords", pages: "Top pages", competitors: "Organic competitors", backlinks: "Backlinks", newBacklinks: "New backlinks",
  lostBacklinks: "Lost backlinks", brokenBacklinks: "Broken backlinks", referringDomains: "Referring domains", anchors: "Anchors", bestByLinks: "Best pages by links", referringIps: "Referring IPs", linkCompetitors: "Sites with similar links", subdomains: "Subdomains", ads: "Ads",
  matchingTerms: "Matching terms", relatedTerms: "Related terms", questions: "Questions",
};
const removeInput = z.object({ keywords: z.array(z.string().min(1).max(200)).min(1).max(1000) }).strict();

const SUGGESTION_LIMIT = 50;
const GAP_LIMIT = 100;
const MAX_KEYWORDS_PER_SITE = 1000;
const MAX_SITES = 50;

const siteInput = z.object({
  domain: z.string().min(3).max(253),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  devices: z.enum(["desktop", "mobile", "both"]).default("both"),
  serpDepth: z.number().int().min(10).max(100).default(10),
}).strict();
const keywordsInput = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  /** Where to check these from (a place from /api/seo/locations); omitted = the site's own place. */
  locationCode: z.number().int().positive().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  volumes: z.array(z.object({ keyword: z.string(), searchVolume: z.number().min(0).max(2_000_000_000).transform(Math.round).nullable(), cpc: z.number().min(0).max(99_999).nullable(), difficulty: z.number().min(0).max(100).transform(Math.round).nullable() })).max(500).optional(),
}).strict();
const researchInput = z.object({
  seed: z.string().trim().min(1).max(200),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
}).strict();
const competitorInput = z.object({ competitor: z.string().min(3).max(253) }).strict();
const explorerInput = z.object({
  domain: z.string().min(3).max(253),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  /** Buy a new report even when a saved one is still inside the free window. */
  refresh: z.boolean().default(false),
}).strict();
const id = z.coerce.number().int().positive();
/** Explorer lookups run only for the countries on the list (shared/seo-markets.ts). */
const marketOk = (i: { locationCode: number; languageCode: string }) => !!findMarket(i.locationCode, i.languageCode);
const keywordOverviewInput = z.object({
  keyword: z.string().trim().min(1).max(200),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
}).strict();
const historyInput = z.object({ device: z.enum(["desktop", "mobile"]).optional(), tag: z.string().trim().min(1).max(40).optional() }).strict();
const settingsInput = z.object({
  businessName: z.string().trim().max(120).nullable().optional(),
  alertsEnabled: z.boolean().optional(),
  alertDrop: z.number().int().min(1).max(20).optional(),
  rankFrequency: z.enum(["weekly", "twice_weekly", "daily"]).optional(),
  /** The dashboard group: a short name (spacing tidied); null or "" takes the site out of its group. */
  group: z.string().trim().max(40).transform((g) => g.replace(/\s+/g, " ")).nullable().optional(),
}).strict();
const readInput = z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }).strict();
/** The Alerts page: one site or all, one kind or all (filtered before the page is cut), a page at a time (`before` = the last alert seen). */
const alertsQuery = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  kind: z.enum(ALERT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.number().int().positive().optional(),
});
const tagsInput = z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(10) }).strict();
const cleanKeyword = (k: string) => k.toLowerCase().replace(/\s+/g, " ").trim();
/** A search with an operator costs several times more at the source than the price we show, so it is refused where the price is fixed. */
const hasOperator = (k: string) => serpKeywordMultiplier(k) > 1;
const NO_OPERATORS = "Search operators such as site: or intitle: aren't supported here — enter the search the way a customer would type it.";

export function registerSeoRoutes(app: Express, auth: (req: any, res: any) => any) {
  const route = (method: "get" | "post" | "delete", path: string, fn: (req: any, res: any, user: number, ent: Entitlements) => Promise<any>) =>
    app[method](path, async (req, res, next) => {
      try {
        const u = auth(req, res);
        if (!u) return;
        const ent = await requirePlan(res, u.id, SEO_FEATURE, seoAllowanceTest);
        if (!ent) return;
        await fn(req, res, u.id, ent);
      } catch (e: any) {
        // The one way an error leaves an SEO route (server/seo/public-errors.ts): the customer gets neutral copy,
        // the exact wording — vendor, upstream text, wholesale dollars — goes to the log, the issue desk and admins.
        const out = seoErrorResponse(e, { admin: isPlatformAdmin(req.user) });
        if (e instanceof DataForSeoError) console.warn(`[seo] vendor error ${e.code} on ${req.method} ${req.path}: ${e.message}`);
        else if (out.unexpected) console.error(`[seo] ${req.method} ${req.path} failed:`, e);
        // The issue desk hears of every 5xx except "not switched on yet", which is a state, not a failure.
        if (!(e instanceof DataForSeoError && e.code === "not_configured")) recordUnhandledError(req, res, e, out.status);
        if (res.headersSent) return;
        res.status(out.status).json(out.body);
      }
    });

  /**
   * One purchase at a time per account per exact request: a second identical request made while the first is still
   * running waits for it and shares its result instead of buying the same data again — in this process by joining
   * the request in flight, in another process (two of them overlap during a deploy restart) by waiting for its lock
   * and then finding the saved copy (server/seo/locks.ts). A wait past LOCK_WAIT_MS is answered "busy, try again".
   */
  const { inflight, once, serial } = requestQueues(seoLocks.withLock);
  /**
   * How long a bought result answers an identical request without buying it again, for lookups that are not otherwise
   * kept: long enough to catch a double click or a request waiting in another server process (the lock waits up to
   * 75 seconds), short enough that asking again later is a fresh lookup. 5 minutes; AI questions 2 minutes.
   */
  const DUPLICATE_WINDOW_HOURS = 5 / 60, AI_DUPLICATE_SECONDS = 120;
  /** Save a paid result. A failed save must not cost the customer the data they just paid for: they still get the response. */
  const keep = async (what: string, save: () => Promise<void>): Promise<boolean> => {
    try { await save(); return true; } catch (e: any) { console.error(`[seo] ${what} was paid for but not saved (returned to the customer anyway): ${e?.message ?? e}`); return false; }
  };
  /**
   * Buy a cacheable result once. The first request runs it; anyone asking for the same thing meanwhile waits and
   * gets the same result marked `reused` (they bought nothing). The saved copy is checked again inside — after the
   * lock is held — so a request arriving just after another finished, or waiting in another process, finds what it
   * bought instead of buying it a second time.
   */
  const buyOnce = async <T>(user: number, key: string, kind: string, maxAgeHours: number, estimateUsd: number, fetch: () => Promise<{ data: T; costUsd: number; costUnknown?: boolean; customerUsd?: number }>, skipSaved = false, label?: string): Promise<{ data: T; reused: boolean; /** false: bought and returned, but it could not be kept — reopening it will not be free. */ saved: boolean }> => {
    const flight = `${kind}:${user}:${key}`;
    const waiting = inflight.has(flight);
    const out = await once(flight, async () => {
      if (!skipSaved) { const again = await cached<T>(user, key, maxAgeHours); if (again) return { data: again, bought: false, saved: true }; }
      const o = await withBudget(user, estimateUsd, fetch, { label });
      const saved = await keep(`${kind} for account ${user}`, () => saveCached(user, key, kind, o.data, o.costUsd));
      return { data: o.data, bought: true, saved };
    });
    return { data: out.data, reused: waiting || !out.bought, saved: out.saved };
  };
  // `serial` (from requestQueues above): requests for one key run one after another, in every process — keyword
  // imports count the plan limit, then insert, and the count holds because nobody else is between the two.

  const notReady = (res: any) => res.status(503).json({ configured: false, code: "seo_not_ready", message: SEO_NOT_READY_MESSAGE });

  /** This account's plan units: keywords tracked (standing) and the two monthly meters. */
  const planUsage = async (user: number, ent: Entitlements) => {
    const [{ rows: [k] }, usage] = await Promise.all([
      pool.query("SELECT count(*)::int n FROM seo_keywords WHERE user_id=$1", [user]),
      monthlyUsage(user, ent),
    ]);
    void usage;
    return { keywords: { used: Number(k?.n ?? 0), limit: ent.allowances?.seoKeywords ?? 0 } };
  };

  const ownedSite = async (user: number, siteId: unknown): Promise<SiteRow> => {
    const { rows: [site] } = await pool.query("SELECT * FROM seo_sites WHERE id=$1 AND user_id=$2", [id.parse(siteId), user]);
    if (!site) throw Object.assign(new z.ZodError([]), { message: "Site not found" });
    return site;
  };

  // Status: is the data source live, and this account's plan units. Platform
  // admins also get the real state of the source (vendor spend vs the cap).
  route("get", "/api/seo/status", async (req, res, user, ent) => {
    const usage = await planUsage(user, ent);
    res.setHeader("Cache-Control", "no-store");
    // The customer's SEO data credit and what each lookup costs them (shared/seo-credits.ts).
    const credits = await creditStatus(user, ent.allowances?.seoCreditCents ?? 0);
    // alertsUndelivered: this account's alerts whose delivery was given up after repeated tries (they stay on the page, marked).
    const body: Record<string, unknown> = { configured: isConfigured(), alertsUnread: await unreadAlerts(user), alertsUndelivered: await undeliveredAlerts(user), usage, credits, prices: SEO_PRICES, holds: SEO_HOLDS, quotes: SEO_QUOTES, packs: SEO_CREDIT_PACKS, resetsAt: resetsAt() };
    if (isPlatformAdmin(req.user)) {
      const budget = await budgetStatus(user);
      // What is still outstanding platform-wide: refunds owed to customers (never given up) and alert deliveries given up.
      body.admin = { vendor: SEO_VENDOR_NAME, configured: isConfigured(), env: SEO_ENV_VARS, ...budget, refundsOwed: await owedRefunds(), alertsGivenUp: await undeliveredAlerts(null) };
    }
    res.json(body);
  });

  // Admin only: wholesale cost this month per account, the total and the cap.
  app.get("/api/seo/admin/usage", async (req, res, next) => {
    try {
      const u = auth(req, res);
      if (!u) return;
      if (!isPlatformAdmin(req.user)) return void res.status(403).json({ message: "Platform admin access required" });
      const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : monthKey();
      const accounts = await monthlySpendByAccount(month);
      const totalUsd = Math.round(accounts.reduce((a, b) => a + b.costUsd, 0) * 1e6) / 1e6;
      const capUsd = monthlyBudgetUsd();
      res.setHeader("Cache-Control", "no-store");
      res.json({ vendor: SEO_VENDOR_NAME, configured: isConfigured(), env: SEO_ENV_VARS, month, capUsd, totalUsd, remainingUsd: Math.max(0, Math.round((capUsd - totalUsd) * 1e6) / 1e6), accounts });
    } catch (e) { next(e); }
  });

  route("get", "/api/seo/sites", async (_req, res, user) => {
    const { rows } = await pool.query(
      `SELECT s.*, (SELECT count(*)::int FROM seo_keywords k WHERE k.site_id=s.id) AS keyword_count
       FROM seo_sites s WHERE s.user_id=$1 ORDER BY s.created_at`, [user]);
    res.json(rows.map(siteView));
  });

  // One add at a time per account (in every server process), so two adds at 49 sites cannot both pass the count.
  route("post", "/api/seo/sites", (req, res, user) => serial(`sites:${user}`, async () => {
    const input = siteInput.parse(req.body);
    // A site's own country and language are used by paid lookups later, so only a pair on the list is stored.
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const domain = normalizeDomain(input.domain);
    if (!domain) return res.status(400).json({ message: "Enter a domain like example.com" });
    // The cap counts only sites the account does not have yet (server/seo/site-cap.ts).
    if (await siteCapRefuses(user, domain, MAX_SITES)) return res.status(403).json({ message: `Up to ${MAX_SITES} sites can be tracked.` });
    const { rows: [site] } = await pool.query(
      `INSERT INTO seo_sites(user_id,domain,location_code,language_code,devices,serp_depth) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(user_id,domain) DO UPDATE SET location_code=EXCLUDED.location_code,language_code=EXCLUDED.language_code,devices=EXCLUDED.devices,serp_depth=EXCLUDED.serp_depth
       RETURNING *, 0 AS keyword_count`,
      [user, domain, input.locationCode, input.languageCode, input.devices, input.serpDepth]);
    res.status(201).json(siteView(site));
  }));

  route("delete", "/api/seo/sites/:id", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    await pool.query("DELETE FROM seo_sites WHERE id=$1 AND user_id=$2", [site.id, user]);
    res.json({ ok: true });
  });

  // Overview: tiles, the positions table with movement, Search Console if connected, the last runs.
  route("get", "/api/seo/sites/:id/overview", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const [{ rows: keywords }, { rows: checks }, { rows: runs }, gsc] = await Promise.all([
      pool.query("SELECT id, keyword, tags, search_volume, cpc::float8 AS cpc, difficulty, location_name FROM seo_keywords WHERE site_id=$1 ORDER BY keyword, location_name NULLS FIRST", [site.id]),
      // The newest two checks per keyword and device, each pair read through seo_rank_checks_kw_device_on — not a
      // window sort over the site's whole history with its SERP JSON (review H3). Only the previous check's position
      // and date are used, so the heavy columns are read for the newest row alone.
      pool.query(
        `SELECT k.id AS keyword_id, d.device, c.position, c.url, c.checked_on::text AS checked_on, c.serp_features, c.local_position, c.local_pack, c.serp_top
           FROM seo_keywords k
           CROSS JOIN (VALUES ('desktop'), ('mobile')) AS d(device)
           CROSS JOIN LATERAL (SELECT position, url, checked_on, serp_features, local_position, local_pack, serp_top, 1 AS rn
                                 FROM seo_rank_checks WHERE keyword_id=k.id AND device=d.device ORDER BY checked_on DESC, id DESC LIMIT 1) c
          WHERE k.site_id=$1
         UNION ALL
         SELECT k.id, d.device, p.position, p.url, p.checked_on::text, '[]'::jsonb, p.local_position, NULL::jsonb, NULL::jsonb
           FROM seo_keywords k
           CROSS JOIN (VALUES ('desktop'), ('mobile')) AS d(device)
           CROSS JOIN LATERAL (SELECT position, url, checked_on, local_position
                                 FROM seo_rank_checks WHERE keyword_id=k.id AND device=d.device ORDER BY checked_on DESC, id DESC OFFSET 1 LIMIT 1) p
          WHERE k.site_id=$1
         ORDER BY keyword_id, device, checked_on DESC`, [site.id]),
      pool.query("SELECT id, trigger, status, total, checked, error, partial, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 5", [site.id]),
      searchConsoleSummary(user, site.domain),
    ]);
    const latest = new Map<string, any>(), previous = new Map<string, any>();
    for (const c of checks) {
      const key = `${c.keyword_id}:${c.device}`;
      if (!latest.has(key)) latest.set(key, c); else if (!previous.has(key)) previous.set(key, c);
    }
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    const rows = keywords.map((k: any) => ({
      id: k.id, keyword: k.keyword, location: k.location_name ?? null, tags: k.tags ?? [], searchVolume: k.search_volume, cpc: k.cpc, difficulty: k.difficulty,
      positions: Object.fromEntries(devices.map((d) => {
        const l = latest.get(`${k.id}:${d}`), p = previous.get(`${k.id}:${d}`);
        return [d, l ? { position: l.position, url: l.url, checkedOn: l.checked_on, previous: p?.position ?? null, previousOn: p?.checked_on ?? null, features: l.serp_features ?? [],
          local: l.local_position ?? null, previousLocal: p?.local_position ?? null, pack: Array.isArray(l.local_pack) ? l.local_pack : [], top: Array.isArray(l.serp_top) ? l.serp_top : [] } : null];
      })),
    }));
    const primary = devices[0];
    const latestPositions = rows.map((r) => r.positions[primary]?.position ?? null);
    const ranked = latestPositions.filter((p): p is number => p !== null);
    // Entering the tracked results counts as improved and dropping out of them as declined.
    const moved = rows.map((r) => {
      const p = r.positions[primary];
      if (!p || !p.previousOn) return 0;
      if (p.position !== null && p.previous !== null) return p.previous - p.position;
      return p.position !== null ? 1 : p.previous !== null ? -1 : 0;
    });
    const summary = {
      tracked: rows.length,
      checked: ranked.length + latestPositions.filter((p, i) => p === null && rows[i].positions[primary]).length,
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      averagePosition: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
      improved: moved.filter((m) => m > 0).length,
      declined: moved.filter((m) => m < 0).length,
      lastCheckedOn: checks[0]?.checked_on ?? null,
      inMapPack: rows.filter((r) => r.positions[primary]?.local != null).length,
      withMapPack: rows.filter((r) => (r.positions[primary]?.pack?.length ?? 0) > 0).length,
    };
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    res.json({
      site: siteView({ ...site, keyword_count: keywords.length }), devices, summary, rows, runs: runs.map((r: any) => runView(r, isPlatformAdmin(req.user))), searchConsole: gsc,
      // What one automatic check costs, and a month of them at each frequency (the same figure, multiplied — never a guess).
      nextCheck: { serps: estimate.serps, priceCents: retailCents(estimate.usd), nextAt: site.next_rank_check_at ?? null,
        perMonthCents: Object.fromEntries(RANK_FREQUENCY_KEYS.map((f) => [f, Math.round(retailCents(estimate.usd) * RANK_FREQUENCIES[f].perMonth)])) },
    });
  });

  // One import at a time per account, so two at once cannot both pass the plan's keyword limit.
  route("post", "/api/seo/sites/:id/keywords", (req, res, user, ent) => serial(`keywords:${user}`, async () => {
    const site = await ownedSite(user, req.params.id);
    const input = keywordsInput.parse(req.body);
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM seo_keywords WHERE site_id=$1", [site.id]);
    const unique = [...new Set(input.keywords.map((k) => k.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean))];
    // Plan limit: tracked keywords across the account (keywords already on this site are not re-added, so count only the new ones).
    // A place other than the site's own makes these separate keywords: "roof repair" in Tampa and in Clearwater both count.
    // Every keyword carries its place (the site's own when none is picked), so its history never moves under it.
    const place = await locationByCode(input.locationCode ?? site.location_code);
    if (!place) return res.status(400).json({ message: "Pick the place from the list." });
    const { rows: existing } = await pool.query("SELECT keyword FROM seo_keywords WHERE site_id=$1 AND keyword=ANY($2::text[]) AND coalesce(location_code,0)=$3", [site.id, unique, place.code]);
    const adding = unique.length - existing.length;
    if (n + adding > MAX_KEYWORDS_PER_SITE) return res.status(403).json({ message: `Up to ${MAX_KEYWORDS_PER_SITE} keywords per site.` });
    const { rows: [{ total }] } = await pool.query("SELECT count(*)::int total FROM seo_keywords WHERE user_id=$1", [user]);
    const limit = ent.allowances?.seoKeywords ?? 0;
    if (adding > 0 && !keywordsFit(ent.allowances, Number(total), adding)) {
      const raise = raiseHint(ent, "seoKeywords", ["tracked keyword"]);
      const plan = PLANS[ent.accessPlan!].name;
      const left = Math.max(0, limit - Number(total));
      return sendLimitReached(res, {
        feature: "seoKeywords", limit, used: Number(total), upgradePlan: raise.upgradePlan, addon: raise.addon,
        message: `${left === 0 ? `You're tracking all ${plural(limit, "keyword")} your ${plan} plan includes.` : `This adds ${plural(adding, "keyword")}, and ${left} of the ${plural(limit, "tracked keyword")} your ${plan} plan includes ${left === 1 ? "is" : "are"} free.`} Remove keywords you no longer need, or ${raise.text ? raise.text.replace(/^To raise it, /, "") : "move to a bigger plan."}`,
      });
    }
    const volumes = new Map((input.volumes ?? []).map((v) => [v.keyword.toLowerCase(), v]));
    let added = 0;
    for (const keyword of unique) {
      const v = volumes.get(keyword);
      const r = await pool.query(
        `INSERT INTO seo_keywords(site_id,user_id,keyword,tags,search_volume,cpc,difficulty,volume_checked_at,location_code,location_name)
         VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5::int IS NULL THEN NULL ELSE now() END,$8,$9)
         ON CONFLICT (site_id, keyword, coalesce(location_code, 0)) DO UPDATE SET tags=(SELECT array(SELECT DISTINCT unnest(seo_keywords.tags || EXCLUDED.tags)))
         RETURNING (xmax = 0) AS inserted`,
        [site.id, user, keyword, input.tags, v?.searchVolume ?? null, v?.cpc ?? null, v?.difficulty ?? null, place.code, place.label]);
      if (r.rows[0]?.inserted) added++;
    }
    res.status(201).json({ added, total: n + added });
  }));

  route("delete", "/api/seo/keywords/:id", async (req, res, user) => {
    await pool.query("DELETE FROM seo_keywords WHERE id=$1 AND user_id=$2", [id.parse(req.params.id), user]);
    res.json({ ok: true });
  });

  // Search volume for keywords that have none yet (Google Ads data, one task per 1,000 keywords).
  route("post", "/api/seo/sites/:id/keywords/volumes", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    // The keywords still without a volume are read INSIDE the locked section: a request that waited for another (in
    // this process or another one) finds what that one already filled in, and buys only what is still missing.
    const result = await once(`volumes:${user}:${site.id}`, async () => {
      const { rows } = await pool.query("SELECT id, keyword FROM seo_keywords WHERE site_id=$1 AND (volume_checked_at IS NULL OR volume_checked_at<now()-interval '30 days') ORDER BY id LIMIT 1000", [site.id]);
      if (!rows.length) return { updated: 0 };
      const out = await withBudget(user, estimateAdsVolumeUsd(rows.length), () => adsSearchVolume({ keywords: rows.map((r: any) => r.keyword), locationCode: site.location_code, languageCode: site.language_code }), { label: `Search volumes — ${rows.length} keyword${rows.length === 1 ? "" : "s"} for ${site.domain}` });
      const byKeyword = new Map(out.data.map((v) => [v.keyword.toLowerCase(), v]));
      let updated = 0;
      for (const r of rows) {
        const v = byKeyword.get(r.keyword.toLowerCase());
        if (!v) continue;
        await pool.query("UPDATE seo_keywords SET search_volume=$2, cpc=$3, volume_checked_at=now() WHERE id=$1", [r.id, v.searchVolume, v.cpc]);
        updated++;
      }
      return { updated };
    });
    res.json(result);
  });

  // Run now: a rank check queued at the source (results arrive over the next minutes).
  route("post", "/api/seo/sites/:id/rank-check", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    const { rows: keywords } = await pool.query("SELECT keyword FROM seo_keywords WHERE site_id=$1", [site.id]);
    if (!keywords.length) return res.status(400).json({ message: "Add keywords first." });
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    const budget = await budgetStatus(user);
    if (estimate.usd > budget.remainingUsd) {
      console.warn(`[seo] cost refused user=${user} rank-check site=${site.id} estimate=$${estimate.usd} remaining=$${budget.remainingUsd} cap=$${budget.capUsd}`);
      return res.status(402).json({ code: "seo_budget", message: BUDGET_PAUSED_MESSAGE });
    }
    // The customer's own credit: say so now rather than failing the run a moment later.
    const credits = await creditStatus(user, ent.allowances?.seoCreditCents ?? 0);
    const need = retailCents(estimate.usd);
    if (credits.availableCents !== -1 && need > credits.availableCents) {
      return res.status(402).json({ code: "seo_credits", message: credits.owedCents ? owedCreditMessage(credits.owedCents) : outOfCreditMessage(need, credits.availableCents), packs: SEO_CREDIT_PACKS });
    }
    const run = await enqueueRankRun(site, "manual");
    if (!run.reused) void postQueuedRun(run.id).catch((e) => console.error("[seo] run-now post failed", e?.message ?? e));
    res.status(202).json({ runId: run.id, reused: run.reused, serps: estimate.serps });
  });

  route("get", "/api/seo/sites/:id/runs", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query("SELECT id, trigger, status, total, checked, error, partial, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 20", [site.id]);
    res.json(rows.map((r: any) => runView(r, isPlatformAdmin(req.user))));
  });

  // Keyword research: seed → suggestions with volume / CPC / difficulty (up to 50 rows). One keyword search of the plan.
  route("post", "/api/seo/keywords/research", async (req, res, user, ent) => {
    const input = researchInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    if (!isConfigured()) return notReady(res);
    // A duplicate made within five minutes (a double click, or a request waiting in another server process) is answered
    // from the saved copy and bought once (DUPLICATE_WINDOW_HOURS).
    const out = await buyOnce(user, `research:${cleanKeyword(input.seed)}:${input.locationCode}:${input.languageCode}`, "research", DUPLICATE_WINDOW_HOURS, estimateLabsUsd(SUGGESTION_LIMIT), () => labsKeywordSuggestions({ keyword: input.seed, locationCode: input.locationCode, languageCode: input.languageCode, limit: SUGGESTION_LIMIT }), false, `Keyword ideas — ${cleanKeyword(input.seed)}`);
    res.json({ seed: input.seed, items: out.data, reused: out.reused, usage: await planUsage(user, ent) });
  });

  // Backlinks: the latest snapshot, and "Refresh now".
  route("get", "/api/seo/sites/:id/backlinks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query(
      "SELECT id, taken_on::text AS taken_on, summary, backlinks, changes FROM seo_backlink_snapshots WHERE site_id=$1 ORDER BY taken_on DESC LIMIT 2", [site.id]);
    const [latest, previous] = rows;
    res.json({
      site: siteView(site), configured: isConfigured(),
      snapshot: latest ? { id: latest.id, takenOn: latest.taken_on, summary: latest.summary, backlinks: latest.backlinks, changes: latest.changes ?? null } : null,
      previous: previous ? { takenOn: previous.taken_on, summary: previous.summary } : null,
      nextSnapshotAt: site.next_backlinks_at,
      // What a refresh can cost for this site today: the first snapshot has nothing to compare with, so it has one lookup fewer.
      refreshCents: retailCents(estimateBacklinkSnapshotUsd(100) + (rows.some((r: any) => r.taken_on < new Date().toISOString().slice(0, 10)) ? estimateLostLinksUsd() : 0)),
    });
  });

  // "Refresh now": one backlink refresh of the plan (the automatic monthly snapshot is on top).
  route("post", "/api/seo/sites/:id/backlinks/refresh", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    // Already taken today (by hand or by the monthly job): that snapshot is answered, and nothing is bought.
    const snap = await once(`backlinks:${user}:${site.id}`, () => snapshotBacklinks(site));
    res.status(snap.reused ? 200 : 201).json({ id: snap.id, takenOn: snap.takenOn, lostFailed: snap.lostFailed, reused: snap.reused === true, usage: await planUsage(user, ent) });
  });

  // ── Site Explorer: any domain, one report ──────────────────────────────────
  // Domains this account has looked up, with their headline numbers.
  route("get", "/api/seo/explorer/recent", async (_req, res, user) => {
    res.json({ items: await recentReports(user), freeForDays: REPORT_TTL_DAYS });
  });

  // The saved report for a domain (never a vendor call, never a plan unit). 404 when there is none yet.
  route("get", "/api/seo/explorer", async (req, res, user) => {
    const domain = normalizeDomain(String(req.query.domain ?? ""));
    if (!domain) return res.status(400).json({ message: "Enter a domain like example.com" });
    const locationCode = Number(req.query.locationCode) > 0 ? Math.floor(Number(req.query.locationCode)) : 2840;
    const languageCode = /^[a-z]{2}$/.test(String(req.query.languageCode ?? "")) ? String(req.query.languageCode) : "en";
    if (!marketOk({ locationCode, languageCode })) return res.status(400).json({ message: "That country isn't available." });
    const saved = await latestReport(user, domain, locationCode, languageCode);
    if (!saved) return res.status(404).json({ code: "no_report", message: "No report for that domain yet." });
    res.json({ report: saved.report, fresh: saved.fresh, configured: isConfigured() });
  });

  // Analyse a domain. A saved report inside the free window is returned as is; otherwise
  // (or with refresh) one keyword search of the plan buys a new one.
  route("post", "/api/seo/explorer", async (req, res, user, ent) => {
    const input = explorerInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const domain = normalizeDomain(input.domain);
    if (!domain) return res.status(400).json({ message: "Enter a domain like example.com" });
    if (!input.refresh) {
      const saved = await latestReport(user, domain, input.locationCode, input.languageCode);
      if (saved?.fresh) return res.json({ report: saved.report, fresh: true, reused: true, usage: await planUsage(user, ent) });
    }
    if (!isConfigured()) return notReady(res);
    const flight = `explorer:${user}:${domain}:${input.locationCode}:${input.languageCode}`;
    const waiting = inflight.has(flight);
    const out = await once(flight, async () => {
      // Someone may have bought it a moment ago.
      if (!input.refresh) { const again = await latestReport(user, domain, input.locationCode, input.languageCode); if (again?.fresh) return { data: again.report, costUsd: 0 }; }
      const o = await withBudget(user, EXPLORER_ESTIMATE_USD, () => fetchDomainReport({ domain, locationCode: input.locationCode, languageCode: input.languageCode }), { label: `Site Explorer report — ${domain}` });
      const kept = await keep(`explorer report ${domain}`, () => saveReport(user, o.data, o.costUsd));
      return { ...o, kept };
    });
    res.status(waiting ? 200 : 201).json({ report: out.data, fresh: true, reused: waiting, saved: (out as { kept?: boolean }).kept !== false, usage: await planUsage(user, ent) });
  });

  // ── Reports: one page of a Site Explorer / Keywords Explorer table ──────────
  // A page already run in the last day is served from seo_report_cache at no charge;
  // `peek` asks for that only. Anything else is one vendor call on the account's credit.
  route("post", "/api/seo/report", async (req, res, user) => {
    const input = reportInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const forKeyword = isKeywordTable(input.table);
    const target = forKeyword ? cleanKeyword(input.keyword ?? "") : normalizeDomain(input.domain ?? "");
    if (!target) return res.status(400).json({ message: forKeyword ? "Enter a keyword." : "Enter a domain like example.com" });
    if (forKeyword && input.path) return res.status(400).json({ message: "A section only applies to a site's reports." });
    if (input.exactPage && !input.path) return res.status(400).json({ message: "Say which page: a path such as /services/roofing." });
    if (input.path && !SCOPED_TABLES.has(input.table)) return res.status(400).json({ message: "This report is counted for the whole site and can't be narrowed to a section." });
    // Sorts and filters this report does not have are dropped before anything is looked up or keyed.
    const full = effectiveReport({ ...input, target });
    // More conditions than the source takes: refused before anything is looked up, never dropped silently.
    try { reportRequest(full); } catch (e) { if (e instanceof TooManyFilters) return res.status(400).json({ message: e.message }); throw e; }
    if (input.table === "ads") {
      // One lookup brings every ad the library will give; each page is cut from that saved copy.
      if (input.offset >= ADS_MAX) return res.status(400).json({ message: `Google's ad library gives the ${ADS_MAX} most recent ads.` });
      const adsKey = cacheKey("report:ads-all", [target, input.locationCode]);
      const kept = await cached<AdsSnapshot>(user, adsKey, CACHE_HOURS);
      if (kept) return res.json({ page: adsPage(kept, input.limit, input.offset), reused: true });
      if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
      if (!isConfigured()) return notReady(res);
      const got = await buyOnce<AdsSnapshot>(user, adsKey, "report:ads", CACHE_HOURS, ADS_ESTIMATE_USD, () => fetchAdsSnapshot({ target, locationCode: input.locationCode }), false, `${REPORT_NAMES.ads ?? "Ads"} — ${target}`);
      return res.status(got.reused ? 200 : 201).json({ page: adsPage(got.data, input.limit, input.offset), reused: got.reused, saved: got.saved });
    }
    const key = reportCacheKey(full);
    const saved = await cached<ReportPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<ReportPage>(user, key, `report:${input.table}`, CACHE_HOURS, REPORT_ESTIMATE_USD, () => fetchReportPage(full), false, `${REPORT_NAMES[input.table] ?? input.table} — ${target}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Local grid: Google Maps positions across the service area ───────────────
  // The saved pin and the scans so far. Spends nothing.
  route("get", "/api/seo/sites/:id/grid", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    res.json({ pin: readPin((site as { grid_pin?: unknown }).grid_pin), scans: await listScans(user, site.id), running: await runningScan(user, site.id), watches: await listWatches(user, site.id), maxWatches: MAX_WATCHES, sizes: GRID_SIZES, spacings: GRID_SPACINGS, depth: GRID_DEPTH, suggestion: site.business_name ?? "" });
  });
  // Search Google Maps for the business, to choose the listing the grid is centred on. One small lookup.
  route("post", "/api/seo/sites/:id/grid/locate", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = locateInput.parse(req.body);
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce(user, `grid-locate:${site.id}:${input.query.toLowerCase()}`, "grid-locate", DUPLICATE_WINDOW_HOURS, gridEstimateUsd(1), () => locateBusiness(input.query), false, `Local grid — finding "${input.query.slice(0, 80)}" on Google Maps`);
    res.json({ listings: out.data as MapListing[] });
  });
  route("post", "/api/seo/sites/:id/grid/pin", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const pin = pinInput.parse(req.body);
    await savePin(user, site.id, pin);
    res.json({ pin });
  });
  // One scan: every point is one Google local search made from that spot. It takes a minute or two, so it runs in the
  // background and the page asks for it until it is done. Kept in the history; never reused, because positions move.
  route("post", "/api/seo/sites/:id/grid/scan", (req, res, user) => serial(`grid:${user}`, async () => {
    const site = await ownedSite(user, req.params.id);
    const input = scanInput.parse(req.body);
    const keyword = cleanKeyword(input.keyword);
    if (!keyword) return res.status(400).json({ message: "Enter a search to check." });
    if (hasOperator(keyword)) return res.status(400).json({ message: NO_OPERATORS });
    const pin = readPin((site as { grid_pin?: unknown }).grid_pin);
    if (!pin) return res.status(400).json({ message: "Choose your business on Google Maps first." });
    if (!isConfigured()) return notReady(res);
    // One at a time per site — the database's rule, so a second server process cannot start another. A scan still
    // "running" after GRID_STALE_MINUTES is closed as interrupted and may be replaced, so its lookups end a request's
    // timeout and a margin before that: the scan and its replacement can never both pay for a point.
    const begun = Date.now();
    const started = await beginScan(user, site.id, { keyword, size: input.size, spacing: input.spacing });
    if (started.existing) return res.status(200).json({ id: started.id, running: true, reused: true });
    const scanId = started.id;
    void trackWork(`local grid scan ${scanId}`, runGridScan(user, site, pin, { keyword, size: input.size, spacing: input.spacing }, scanId, { label: `Local grid — "${keyword.slice(0, 80)}", ${input.size} × ${input.size} points`, deadline: claimDeadline(begun, GRID_STALE_MINUTES * 60_000) })
      .catch(async (e: any) => {
        if (!(e instanceof SeoBudgetError)) { console.warn(`[seo] local grid scan ${scanId} failed: ${e?.message ?? e}`); void recordFailure("job", "SEO local grid scan", e); }
        // The note is the customer's (server/seo/public-errors.ts): never the error's own text. publicFailure looks through
        // fetchGrid's wrapper (`cause`) to the source's error, so a busy source still reads as one.
        const message = e?.notSaved ? "The scan ran but its results could not be saved. You were not charged." : publicFailure(e, "The scan could not be completed. Try again in a few minutes.");
        await failScan(scanId, message).catch(() => {});
      }));
    res.status(202).json({ id: scanId, running: true });
  }));
  // Repeat a scan every week or month (run by the scheduler from the month's included data only).
  // Scheduled grid watches are an Agency-and-up feature (shared/plans.ts gridWatches) — the SEO
  // add-on buys data, not watches. Deleting a watch stays open so cleanup is never gated.
  route("post", "/api/seo/sites/:id/grid/watch", (req, res, user, ent) => serial(`gridwatch:${user}`, async () => {
    if (!ent.modules.gridWatches) return sendModuleRequired(res, "gridWatches");
    const site = await ownedSite(user, req.params.id);
    const input = watchInput.parse(req.body);
    if (hasOperator(input.keyword)) return res.status(400).json({ message: NO_OPERATORS });
    if (!readPin((site as { grid_pin?: unknown }).grid_pin)) return res.status(400).json({ message: "Choose your business on Google Maps first." });
    res.status(201).json({ watch: await saveWatch(user, site.id, input) });
  }));
  route("delete", "/api/seo/sites/:id/grid/watch/:watchId", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    await deleteWatch(user, site.id, id.parse(req.params.watchId));
    res.json({ ok: true });
  });
  route("get", "/api/seo/sites/:id/grid/:scanId", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const state = await getScan(user, site.id, id.parse(req.params.scanId));
    if (!state) return res.status(404).json({ message: "That scan is no longer there." });
    res.json(state);
  });

  // ── Keywords Explorer: one keyword's overview ───────────────────────────────
  route("post", "/api/seo/keyword", async (req, res, user) => {
    const input = keywordOverviewInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const keyword = cleanKeyword(input.keyword);
    if (!keyword) return res.status(400).json({ message: "Enter a keyword." });
    if (hasOperator(keyword)) return res.status(400).json({ message: NO_OPERATORS });
    const key = cacheKey("keyword-overview", [keyword, input.locationCode, input.languageCode]);
    if (!input.refresh) {
      const saved = await cached<KeywordOverview>(user, key, KEYWORD_OVERVIEW_TTL_DAYS * 24);
      if (saved) return res.json({ overview: saved, reused: true });
    }
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not looked up yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<KeywordOverview>(user, key, "keyword-overview", KEYWORD_OVERVIEW_TTL_DAYS * 24, KEYWORD_OVERVIEW_ESTIMATE_USD,
      () => fetchKeywordOverview({ keyword, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh, `Keyword overview — ${keyword}`);
    res.status(out.reused ? 200 : 201).json({ overview: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Content explorer: linking sites and search visits for the pages on screen ──
  route("post", "/api/seo/content/metrics", async (req, res, user) => {
    const input = pageMetricsInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const urls = cleanUrls(input.urls);
    if (!urls.length) return res.status(400).json({ message: "No web pages to look up." });
    const key = cacheKey("page-metrics", [[...urls].sort(), input.locationCode, input.languageCode]);
    // What a saved answer is still without, and the exact figure set aside to ask for it again (null = nothing to ask for).
    const retryOf = (p: PageMetrics) => { const plan = retryPlan(p); return plan.links.length || plan.traffic.length ? { cents: retailCents(planEstimateUsd(plan)), links: plan.links.length, traffic: plan.traffic.length } : null; };
    const ask = { urls, locationCode: input.locationCode, languageCode: input.languageCode };
    if (input.peek) {
      const saved = await cached<PageMetrics>(user, key, CACHE_HOURS);
      return saved ? res.json({ page: saved, reused: true, retry: retryOf(saved) }) : res.status(404).json({ code: "no_report", message: "Not run yet." });
    }
    // Buying — the first time or a second try — is one at a time per account and list of pages, and each reads the saved
    // answer again once it is its turn: a request that waited cannot buy what the one before it already brought.
    await serial(`page-metrics:${user}:${key}`, async () => {
      const saved = await cached<PageMetrics>(user, key, CACHE_HOURS);
      if (!input.retry) {
        if (saved) return res.json({ page: saved, reused: true, retry: retryOf(saved) });
        if (!isConfigured()) return notReady(res);
        const out = await buyOnce<PageMetrics>(user, key, "page-metrics", CACHE_HOURS, pageMetricsEstimateUsd(urls.length), () => fetchPageMetrics(ask), false, `Content explorer — links and visits for ${urls.length} page${urls.length === 1 ? "" : "s"}`);
        return res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved, retry: retryOf(out.data) });
      }
      // A second try completes a saved answer. Without one there is nothing to complete, and a second try never turns
      // into a full purchase at a price that was not on the button.
      if (!saved) return res.status(409).json({ code: "retry_unavailable", message: "The saved numbers for these pages are no longer there, so there is nothing to complete. Get the numbers again — the price is on the button." });
      const plan = retryPlan(saved);
      if (!plan.links.length && !plan.traffic.length) return res.json({ page: saved, reused: true, retry: null });
      if (!isConfigured()) return notReady(res);
      const n = new Set([...plan.links, ...plan.traffic]).size;
      const out = await buyOnce<PageMetrics>(user, key, "page-metrics-retry", CACHE_HOURS, planEstimateUsd(plan),
        async () => { const o = await fetchPageMetrics(ask, plan); return { ...o, data: mergePageMetrics(saved, o.data, plan) }; },
        true, `Content explorer — missing figures for ${n} page${n === 1 ? "" : "s"} (second try)`);
      return res.status(201).json({ page: out.data, reused: false, saved: out.saved, retry: retryOf(out.data) });
    });
  });

  // ── Directories (Site Explorer): which review sites and trade directories link to a site and its competitors ──
  route("post", "/api/seo/directories", async (req, res, user) => {
    const input = directoriesInput.parse(req.body);
    const target = normalizeDomain(input.domain);
    if (!target) return res.status(400).json({ message: "Enter a domain like example.com" });
    // In one fixed order: the same set of competitors, added in another order, is the same lookup and reopens free.
    const competitors = [...new Set(input.competitors.map((c) => normalizeDomain(c)).filter((c): c is string => !!c && c !== target))].sort();
    const sites = [target, ...competitors];
    const key = cacheKey("directories", [target, competitors]);
    // A second try for the sites that did not load: one at a time, reading the saved answer again when it is its turn,
    // and buying only those sites. With nothing saved, or nothing missing, it buys nothing.
    if (input.retryMissing && !input.peek) {
      await serial(`directories:${user}:${key}`, async () => {
        const now = await cached<DirectoriesPage>(user, key, CACHE_HOURS);
        if (!now) return res.status(409).json({ code: "retry_unavailable", message: "The saved check is no longer there, so there is nothing to complete. Run the check again — the price is on the button." });
        const again = now.missing.filter((s) => sites.includes(s));
        if (!again.length) return res.json({ page: now, reused: true });
        if (!isConfigured()) return notReady(res);
        const out = await buyOnce<DirectoriesPage>(user, key, "directories-retry", CACHE_HOURS, directoriesEstimateUsd(again.length),
          async () => { const o = await fetchDirectories(again); return { ...o, data: mergeDirectories(now, o.data) }; }, true, `Directories — ${again.join(", ")} (second try for ${sites.join(", ")})`);
        return res.status(201).json({ page: out.data, reused: false, saved: out.saved });
      });
      return;
    }
    if (input.peek) {
      const kept = await cached<DirectoriesPage>(user, key, CACHE_HOURS);
      return kept ? res.json({ page: kept, reused: true }) : res.status(404).json({ code: "no_report", message: "Not run yet." });
    }
    // The same queue as the second try above: a first purchase, a full "check again" and a second try for the missing
    // sites never run side by side for one saved answer, so none can save over what another just brought.
    await serial(`directories:${user}:${key}`, async () => {
      const saved = input.refresh ? null : await cached<DirectoriesPage>(user, key, CACHE_HOURS);
      if (saved) return res.json({ page: saved, reused: true });
      if (!isConfigured()) return notReady(res);
      const out = await buyOnce<DirectoriesPage>(user, key, "directories", CACHE_HOURS, directoriesEstimateUsd(sites.length), () => fetchDirectories(sites), input.refresh, `Directories — ${sites.join(", ")}`);
      return res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
    });
  });

  // ── Unlinked mentions (Site Explorer): pages that use the business's exact name, and whether those websites link ──
  // The name and places a site uses, and the saved check for that name if there is one. Spends nothing.
  const mentionsKey = (domain: string, name: string) => cacheKey("mentions", [domain, name.toLowerCase()]);
  /** A "Check again" claim with no answer after this long (a crash before the save) can be taken over. */
  const RECEIPT_CLAIM_MINUTES = 10;
  const placesOf = async (site: SiteRow) => {
    const saved = (site as { mention_places?: unknown }).mention_places;
    if (Array.isArray(saved)) return saved.filter((x): x is string => typeof x === "string").slice(0, 8);
    const { rows } = await pool.query("SELECT location_name FROM seo_keywords WHERE site_id=$1 AND location_name IS NOT NULL GROUP BY location_name ORDER BY count(*) DESC, location_name LIMIT 20", [site.id]);
    return defaultPlaces(rows.map((r: any) => r.location_name));
  };
  /** A saved check as shown: each row read for the places (free to change, so worked out on every read) and with the
   *  customer's own verdict on that PAGE for this name, if they gave one. Never fails: if the verdicts cannot be read,
   *  the answer still goes out (it may just have been paid for) and says the verdicts are not shown. */
  const mentionsView = async (siteId: number, user: number, page: MentionsPage, places: string[]) => {
    let mark = new Map<string, "mine" | "not_mine">(), marksUnavailable = false;
    try {
      const { rows: marks } = await pool.query("SELECT page_key, verdict FROM seo_mention_verdicts WHERE site_id=$1 AND user_id=$2 AND name_key=$3", [siteId, user, mentionNameKey(page.name)]);
      mark = new Map(marks.map((m: any) => [m.page_key, m.verdict]));
    } catch (e: any) { marksUnavailable = true; console.error(`[seo] mention verdicts for site ${siteId} could not be read: ${e?.message ?? e}`); }
    return { ...page, ...(marksUnavailable ? { marksUnavailable } : {}), rows: page.rows.map((r) => ({ ...r, place: placeIn(r, places), mark: mark.get(pageKeyOf(r.url)) ?? null })) };
  };
  /**
   * Buy a mentions answer SAVED FIRST, CHARGED SECOND: the answer is written as the saved check (and, for "Check
   * again", into its receipt) inside the charged call. If it cannot be written, the customer is charged nothing.
   */
  const buyMentionsSaved = (user: number, key: string, estimateUsd: number, label: string, fetch: () => Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean; customerUsd?: number }>, receipt?: { replaces: string; token: string }) =>
    withBudget(user, estimateUsd, async () => {
      const o = await fetch();
      const notSaved = (why: string) => Object.assign(new SeoCustomerError(why, 503), { costUsd: o.costUsd, costUnknown: o.costUnknown });
      // The saved check and the receipt in ONE transaction, and only by the holder of the claim: a request whose claim
      // was taken over saves nothing, and is charged nothing.
      const client = await pool.connect().catch(() => { throw notSaved("The answer could not be saved, so it was not charged. Try again in a moment."); });
      try {
        await client.query("BEGIN");
        if (receipt) {
          const { rowCount } = await client.query("UPDATE seo_refresh_receipts SET answer=$4 WHERE user_id=$1 AND key=$2 AND replaces=$3 AND token=$5 AND answer IS NULL", [user, key, receipt.replaces, JSON.stringify(o.data), receipt.token]);
          if (!rowCount) { await client.query("ROLLBACK"); throw notSaved("Another request finished this check first, so this one was not charged. Reload to see it."); }
        }
        await saveCached(user, key, "mentions", o.data, o.costUsd, client);
        await client.query("COMMIT");
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        throw e instanceof SeoCustomerError ? e : notSaved("The answer could not be saved, so it was not charged. Try again in a moment.");
      } finally { client.release(); }
      return o;
    }, { label });
  route("get", "/api/seo/sites/:id/mentions", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const name = ((site as { mention_name?: string | null }).mention_name ?? site.business_name ?? "").trim();
    const places = await placesOf(site);
    const page = name ? await cached<MentionsPage>(user, mentionsKey(site.domain, name), MENTIONS_CACHE_HOURS) : null;
    // ?check=<id>: a watched check of this site asked for by an alert (anything else: the newest of the followed name).
    const checkId = typeof req.query.check === "string" && /^[1-9][0-9]{0,9}$/.test(req.query.check) && Number(req.query.check) <= 2147483647 ? Number(req.query.check) : null;
    const watch = await mentionWatchView(user, site as any, name || "", checkId);
    res.json({
      name, places, page: page ? await mentionsView(site.id, user, page, places) : null, rows: MENTIONS_ROWS,
      watch: { ...watch, latest: watch.latest ? { ...watch.latest, page: await mentionsView(site.id, user, watch.latest.page, places) } : null },
    });
  });
  // The places a mention is read for. Spends nothing.
  route("post", "/api/seo/sites/:id/mentions/places", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const places = [...new Set(placesInput.parse(req.body?.places).map((p) => p.replace(/\s+/g, " ")))];
    await pool.query("UPDATE seo_sites SET mention_places=$3 WHERE id=$1 AND user_id=$2", [site.id, user, places]);
    res.json({ places });
  });
  // The monthly mentions watch (server/seo/mention-watch.ts): on or off. Spends nothing itself; the scheduler buys from
  // the month's included data only.
  route("post", "/api/seo/sites/:id/mentions/watch", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { watch } = z.object({ watch: z.boolean() }).strict().parse(req.body);
    const followed = (((site as { mention_name?: string | null }).mention_name ?? "").trim() || (site.business_name ?? "").trim());
    if (watch && !followed) return res.status(400).json({ message: "Look for mentions of the business name once first, so the watch knows which name to follow." });
    if (watch && !mentionNameOk(followed)) return res.status(400).json({ message: "The name to follow can only have letters, numbers, spaces and & ' . , - — look for mentions with the name written that way first." });
    await setMentionWatch(user, site.id, watch);
    res.json({ watch });
  });
  // A watched check whose link lookup did not load: try that lookup again (the price on the button is the hold).
  route("post", "/api/seo/sites/:id/mentions/watch/:checkId/links", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    const page = await retryWatchedLinks(user, site.id, id.parse(req.params.checkId), MENTIONS_RETRY_USD);
    if (!page) return res.status(404).json({ message: "That check is no longer there." });
    res.json({ page: await mentionsView(site.id, user, page, await placesOf(site)) });
  });
  // The customer's verdict on one page for one name: "mine", "not_mine", or null to take it back. Spends nothing.
  route("post", "/api/seo/sites/:id/mentions/marks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const m = markInput.parse(req.body);
    const pk = pageKeyOf(m.url);
    if (m.verdict) await pool.query(
      `INSERT INTO seo_mention_verdicts(site_id, user_id, name_key, page_key, page_url, verdict) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (site_id, name_key, page_key) DO UPDATE SET verdict=excluded.verdict, page_url=excluded.page_url, marked_at=now()`, [site.id, user, mentionNameKey(m.name), pk, m.url, m.verdict]);
    else await pool.query("DELETE FROM seo_mention_verdicts WHERE site_id=$1 AND user_id=$2 AND name_key=$3 AND page_key=$4", [site.id, user, mentionNameKey(m.name), pk]);
    res.json({ url: m.url, verdict: m.verdict });
  });
  // Check for mentions of the name — or reopen the saved check (free for a week). The price on the button is the very
  // figure set aside. A second try buys only the link check that did not load. One at a time per saved answer.
  route("post", "/api/seo/sites/:id/mentions", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = webMentionsInput.parse(req.body);
    const key = mentionsKey(site.domain, input.name);
    const places = await placesOf(site);
    const view = (page: MentionsPage) => mentionsView(site.id, user, page, places);
    if (input.peek) {
      const kept = await cached<MentionsPage>(user, key, MENTIONS_CACHE_HOURS);
      return kept ? res.json({ page: await view(kept), reused: true }) : res.status(404).json({ code: "no_report", message: "Not checked yet." });
    }
    await serial(`mentions:${user}:${key}`, async () => {
      // The name is remembered for the site whatever happens next (it is the customer's own choice, not data bought).
      // A watch that follows the name is due again at once when the name changes (an occurrence leased for the old name
      // then fails its own check and buys nothing).
      await pool.query(`UPDATE seo_sites SET mention_name=$3, next_mention_at = CASE WHEN mention_watch AND lower(btrim(coalesce(nullif(btrim(mention_name), ''), business_name, ''))) <> lower($3) THEN now() ELSE next_mention_at END WHERE id=$1 AND user_id=$2`, [site.id, user, input.name]);
      if (input.retryMissing) {
        const now = await cached<MentionsPage>(user, key, MENTIONS_CACHE_HOURS);
        if (!now) return res.status(409).json({ code: "retry_unavailable", message: "The saved check is no longer there, so there is nothing to complete. Run the check again — the price is on the button." });
        if (now.linksChecked) return res.json({ page: await view(now), reused: true });
        if (!isConfigured()) return notReady(res);
        const out = await buyMentionsSaved(user, key, MENTIONS_RETRY_USD, `Mentions — ${site.domain} (link check, second try)`,
          async () => { const o = await checkLinks(now); if (!o.data.linksChecked) throw Object.assign(new Error("The link check did not load."), { costUsd: o.costUsd, costUnknown: o.costUnknown }); return o; });
        return res.status(201).json({ page: await view(out.data), reused: false, saved: true });
      }
      // "Check again" must say which answer it replaces. The same replacement asked again (a second click, another tab,
      // a retry after a lost response) gets the answer the first one bought — from its receipt, which is kept even when
      // the answer could not be saved as the report — or a newer saved answer. Read inside the queue: one purchase.
      if (input.refresh && !input.replaces) return res.status(400).json({ message: "Reload the page and press Check again." });
      const current = await cached<MentionsPage>(user, key, MENTIONS_CACHE_HOURS);
      if (!input.refresh) {
        if (current) return res.json({ page: await view(current), reused: true });
        if (!isConfigured()) return notReady(res);
        const out = await buyMentionsSaved(user, key, MENTIONS_ESTIMATE_USD, `Mentions — "${input.name}"`, () => fetchMentions(input.name, site.domain));
        return res.status(201).json({ page: await view(out.data), reused: false, saved: true });
      }
      // A newer saved answer than the one being replaced: that is the answer.
      if (current && new Date(current.fetchedAt) > new Date(input.replaces!)) return res.json({ page: await view(current), reused: true });
      // The claim on this replacement, written before anything is bought. Found already: its answer, or "being checked"
      // while it is young; an old claim with no answer (a crash before the save) can be taken over.
      await pool.query("DELETE FROM seo_refresh_receipts WHERE created_at < now() - interval '7 days'").catch(() => {});
      // The claim carries its holder's token: taking over an abandoned claim gives it a new token, so the old holder
      // can neither save under it nor give it back. The checks around a request cannot stop one already in flight,
      // though: so the holder asks the source nothing after a request's full timeout, plus a margin, would still end
      // inside the claim — a displaced holder never has a purchase on its way back.
      const token = randomUUID();
      let claimedAt = Date.now();
      const { rowCount: claimed } = await pool.query("INSERT INTO seo_refresh_receipts(user_id, key, replaces, answer, token) VALUES($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING", [user, key, input.replaces, token]);
      if (!claimed) {
        const { rows: [rc] } = await pool.query(`SELECT answer, claimed_at > now() - interval '${RECEIPT_CLAIM_MINUTES} minutes' AS young FROM seo_refresh_receipts WHERE user_id=$1 AND key=$2 AND replaces=$3`, [user, key, input.replaces]);
        if (rc?.answer) return res.json({ page: await view(rc.answer as MentionsPage), reused: true });
        if (rc?.young) return res.status(409).json({ code: "in_progress", message: "This check is being made right now. It will be here in a moment." });
        claimedAt = Date.now();
        const { rowCount: taken } = await pool.query(`UPDATE seo_refresh_receipts SET claimed_at=now(), token=$4 WHERE user_id=$1 AND key=$2 AND replaces=$3 AND answer IS NULL AND claimed_at <= now() - interval '${RECEIPT_CLAIM_MINUTES} minutes'`, [user, key, input.replaces, token]);
        if (!taken) return res.status(409).json({ code: "in_progress", message: "This check is being made right now. It will be here in a moment." });
      }
      const deadline = claimDeadline(claimedAt, RECEIPT_CLAIM_MINUTES * 60_000);
      const release = () => pool.query("DELETE FROM seo_refresh_receipts WHERE user_id=$1 AND key=$2 AND replaces=$3 AND answer IS NULL AND token=$4", [user, key, input.replaces, token]).catch(() => {});
      if (!isConfigured()) { await release(); return notReady(res); }
      try {
        const out = await buyMentionsSaved(user, key, MENTIONS_ESTIMATE_USD, `Mentions — "${input.name}" (again)`, () => fetchMentions(input.name, site.domain, { deadline }), { replaces: input.replaces!, token });
        return res.status(201).json({ page: await view(out.data), reused: false, saved: true });
      } catch (e) {
        // Nothing was saved: this holder's claim is given back, so trying again can buy (a successor's claim is left alone).
        await release();
        throw e;
      }
    });
  });

  // ── Service-area planner (Keywords explorer): services x towns for one site ──
  // The services and towns used last time, so the page opens with them. Spends nothing.
  route("get", "/api/seo/sites/:id/planner", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const p = (site as { planner?: unknown }).planner as { services?: unknown; towns?: unknown } | null;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);
    // What a table of this many searches can cost — the very figure that is set aside when it runs (never a second sum).
    const cells = Math.floor(Number(req.query.cells));
    res.json({
      saved: p && list(p.services).length && list(p.towns).length ? { services: list(p.services), towns: list(p.towns) } : null,
      quoteCents: cells > 0 && cells <= PLANNER_MAX_CELLS ? retailCents(plannerEstimateUsd(cells)) : null,
    });
  });
  route("post", "/api/seo/sites/:id/planner", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = plannerInput.parse(req.body);
    const services = cleanTerms(input.services), towns = cleanTerms(input.towns);
    if (!services.length || !towns.length) return res.status(400).json({ message: "Enter at least one service and one town." });
    if (services.length * towns.length > PLANNER_MAX_CELLS) return res.status(400).json({ message: `A table holds up to ${PLANNER_MAX_CELLS} searches — shorten a list.` });
    if ([...services, ...towns].some(hasOperator)) return res.status(400).json({ message: NO_OPERATORS });
    // Every pairing must be a search the source accepts — checked before anything is set aside or bought.
    const tooLong = plannerTooLong(services, towns);
    if (tooLong) return res.status(400).json({ message: `"${tooLong}" is too long to look up (a search can be up to ${PLANNER_MAX_CHARS} characters and ${PLANNER_MAX_WORDS} words). Shorten that service or town.` });
    const remember = () => pool.query("UPDATE seo_sites SET planner=$3 WHERE id=$1 AND user_id=$2", [site.id, user, JSON.stringify({ services, towns })]).catch(() => {});
    const key = cacheKey("planner", [site.domain, site.location_code, site.language_code, services, towns]);
    const saved = input.refresh ? null : await cached<Planner>(user, key, CACHE_HOURS);
    if (!input.peek || input.remember) await remember();
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<Planner>(user, key, "planner", CACHE_HOURS, plannerEstimateUsd(services.length * towns.length),
      () => fetchPlanner({ domain: site.domain, locationCode: site.location_code, languageCode: site.language_code, services, towns }), input.refresh, `Service-area planner — ${site.domain} (${services.length} × ${towns.length})`);
    await remember(); // for next time (not worth failing the request over)
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Action plan: what the customer decided to do about a finding. Spends nothing. ──
  route("get", "/api/seo/sites/:id/tasks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const closed = Number(req.query.closed);
    const plan = await listTasks(user, site.id, Number.isFinite(closed) && closed > 0 ? closed : 100);
    // Audit tasks: what the newest finished crawl says about the issues of the crawl EACH task came from.
    const open = plan.tasks.filter((t) => t.kind === "audit" && (t.status === "todo" || t.status === "doing"));
    let evidenceFailed = false;
    const crawl = open.length ? await auditEvidence(user, site.domain, open.map((t) => t.facts.crawlId).filter((x): x is string => typeof x === "string")).catch((e) => { evidenceFailed = true; console.warn(`[seo] crawl evidence for the action plan could not be read: ${e?.message ?? e}`); return null; }) : null;
    res.json({ tasks: evidenceFailed ? markUnavailable(plan.tasks) : crawl ? markResolved(plan.tasks, crawl) : plan.tasks, counts: plan.counts, closedShown: plan.closedShown, closedMax: MAX_CLOSED_SHOWN, max: MAX_OPEN_TASKS });
  });
  route("post", "/api/seo/sites/:id/tasks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    res.status(201).json(await addTasks(user, site.id, tasksInput.parse(req.body).tasks));
  });
  route("post", "/api/seo/tasks/:id", async (req, res, user) => { res.json({ task: await updateTask(user, id.parse(req.params.id), taskPatch.parse(req.body)) }); });
  route("delete", "/api/seo/tasks/:id", async (req, res, user) => { await deleteTask(user, id.parse(req.params.id)); res.json({ ok: true }); });

  // ── Opportunities (Site Explorer): what to work on next, from one lookup ────
  route("post", "/api/seo/opportunities", async (req, res, user) => {
    const input = oppInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const domain = normalizeDomain(input.domain);
    if (!domain) return res.status(400).json({ message: "Enter a domain like example.com" });
    // "v2": copies saved before every row was kept have another shape and are simply not found.
    const key = cacheKey("opportunities:v2", [domain, input.locationCode, input.languageCode]);
    const saved = input.refresh ? null : await cached<Opportunities>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<Opportunities>(user, key, "opportunities", CACHE_HOURS, OPP_ESTIMATE_USD,
      () => fetchOpportunities({ domain, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh, `Opportunities — ${domain}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Content gap / Link intersect (Site Explorer) ────────────────────────────
  // Up to three competitors against one domain. Saved for a day; `peek` returns the saved copy or 404.
  route("post", "/api/seo/gap", async (req, res, user) => {
    const input = gapInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const target = normalizeDomain(input.domain);
    if (!target) return res.status(400).json({ message: "Enter a domain like example.com" });
    const competitors = [...new Set(input.competitors.map((c) => normalizeDomain(c)).filter((c): c is string => !!c && c !== target))];
    if (!competitors.length) return res.status(400).json({ message: "Enter at least one competitor's domain, different from the site itself." });
    const content = input.kind === "content";
    const limit = content ? CONTENT_GAP_ROWS : input.limit, offset = content ? 0 : input.offset;
    // Links are the same in every country: one saved page, whatever country was sent.
    const key = cacheKey(`gap:${input.kind}`, [target, competitors, limit, offset, content ? input.locationCode : 2840, content ? input.languageCode : "en"]);
    const saved = input.refresh ? null : await cached<GapPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<GapPage>(user, key, `gap:${input.kind}`, CACHE_HOURS, gapEstimateUsd(input.kind, competitors.length, limit),
      () => fetchGap({ kind: input.kind, target, competitors, limit, offset, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh, `${content ? "Content gap" : "Link intersect"} — ${target} vs ${competitors.join(", ")}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Dashboard: every tracked site with its saved numbers (never a vendor call) ──
  route("get", "/api/seo/dashboard", async (_req, res, user) => {
    const { rows: sites } = await pool.query(
      `SELECT s.*, (SELECT count(*)::int FROM seo_keywords k WHERE k.site_id=s.id) AS keyword_count,
              (SELECT report FROM seo_domain_reports r WHERE r.user_id=s.user_id AND r.domain=s.domain AND r.location_code=s.location_code AND r.language_code=s.language_code ORDER BY r.created_at DESC LIMIT 1) AS report
         FROM seo_sites s WHERE s.user_id=$1 ORDER BY s.created_at`, [user]);
    const audits = await auditHealthByDomain(user, sites.map((s: any) => s.domain));
    // null = the count could not be read just now (shown as unknown, never as "none open").
    const openTasks = await openTaskCounts(user, sites.map((s: any) => s.id)).catch(() => null);
    const rankOf = await dashboardRanks(sites.map((s: any) => s.id));
    const cards = [];
    for (const s of sites) {
      const rank = rankOf.get(s.id);
      const r = s.report;
      cards.push({
        site: siteView(s),
        audit: audits.get(auditDomainKey(s.domain)) ?? null,
        openTasks: openTasks ? openTasks.get(s.id) ?? 0 : null,
        rank: rank ?? { top3: 0, top10: 0, ranked: 0, checked: 0, checkedOn: null, firstOn: null, device: null },
        report: r ? {
          fetchedAt: r.fetchedAt, authority: r.links?.authority ?? null, backlinks: r.links?.backlinks ?? null, referringDomains: r.links?.referringDomains ?? null,
          organicKeywords: r.organic?.keywords ?? null, organicTraffic: r.organic?.traffic ?? null, trafficValue: r.organic?.trafficValue ?? null,
          top3: r.organic?.positions?.top3 ?? null, top10: r.organic?.positions?.top10 ?? null,
          history: Array.isArray(r.history) ? r.history.map((h: any) => ({ month: h.month, traffic: h.traffic, keywords: h.keywords })) : null,
          linkHistory: Array.isArray(r.linkHistory) ? r.linkHistory.map((h: any) => ({ month: h.month, referringDomains: h.referringDomains, authority: h.authority })) : null,
        } : null,
      });
    }
    res.json({ cards, configured: isConfigured() });
  });

  // ── Keywords Explorer: many keywords at once ────────────────────────────────
  // Volume, difficulty, CPC and intent for up to 200 keywords in one lookup. Saved for a day; `peek` never buys.
  route("post", "/api/seo/keywords/bulk", async (req, res, user) => {
    const input = bulkInput.parse(req.body);
    if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." });
    const keywords = cleanKeywords(input.keywords);
    if (!keywords.length) return res.status(400).json({ message: "Enter at least one keyword." });
    const key = cacheKey("keywords-bulk", [[...keywords].sort(), input.locationCode, input.languageCode]);
    const saved = await cached<BulkPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<BulkPage>(user, key, "keywords-bulk", CACHE_HOURS, bulkEstimateUsd(keywords.length),
      () => fetchBulkKeywords({ keywords, locationCode: input.locationCode, languageCode: input.languageCode }), false, `Bulk keyword analysis — ${keywords.length} keyword${keywords.length === 1 ? "" : "s"}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Keyword lists: saved research. Nothing here calls the data source. ──────
  route("get", "/api/seo/lists", async (_req, res, user) => { res.json({ lists: await listsOf(user) }); });
  // One at a time per account, so two requests cannot both pass the list limits.
  route("post", "/api/seo/lists/items", (req, res, user) => serial(`lists:${user}`, async () => { const input = listItemsInput.parse(req.body); if (!marketOk(input)) return res.status(400).json({ message: "That country isn't available." }); res.status(201).json(await addToList(user, input)); }));
  // "Refresh numbers": today's volume, difficulty, CPC and intent for every keyword in the list, written back to it.
  // One lookup per 200 keywords; always bought fresh (that is the point), and each batch is on the usage page.
  route("post", "/api/seo/lists/:id/refresh", (req, res, user) => serial(`lists:${user}`, async () => {
    if (!isConfigured()) return notReady(res);
    const { list, items } = await listItems(user, id.parse(req.params.id));
    const keywords = items.map((i: any) => i.keyword as string);
    if (!keywords.length) return res.status(400).json({ message: "This list is empty." });
    let updated = 0, failed = 0, attempted = 0, problem: string | null = null;
    for (let i = 0; i < keywords.length; i += BULK_MAX) {
      const chunk = keywords.slice(i, i + BULK_MAX);
      try {
        const out = await withBudget(user, bulkEstimateUsd(chunk.length), () => fetchBulkKeywords({ keywords: chunk, locationCode: list.locationCode, languageCode: list.languageCode }), { label: `Refresh list — ${list.name} (${chunk.length} keyword${chunk.length === 1 ? "" : "s"})` });
        updated += await refreshListMetrics(list.id, out.data.rows, out.data.notFound);
        attempted += chunk.length;
      } catch (e: any) {
        // What was done stays done and is reported; out of credit stops here, anything else moves on to the next batch.
        failed += chunk.length;
        problem = e instanceof SeoBudgetError ? e.message : "Some keywords could not be refreshed — try again in a few minutes.";
        if (e instanceof SeoBudgetError || e instanceof ListError) break;
      }
    }
    res.json({ updated, total: keywords.length, failed, notAttempted: Math.max(0, keywords.length - attempted - failed), problem });
  }));
  route("get", "/api/seo/lists/:id", async (req, res, user) => { res.json(await listItems(user, id.parse(req.params.id))); });
  route("post", "/api/seo/lists/:id/remove", async (req, res, user) => {
    res.json({ removed: await removeFromList(user, id.parse(req.params.id), removeInput.parse(req.body).keywords) });
  });
  route("delete", "/api/seo/lists/:id", async (req, res, user) => { await deleteList(user, id.parse(req.params.id)); res.json({ ok: true }); });

  // ── Content explorer: pages across the web about a topic. Saved for a day; `peek` never buys. ──
  route("post", "/api/seo/content", async (req, res, user) => {
    const input = contentInput.parse(req.body);
    const { peek, ...search } = input;
    const key = cacheKey("content", [cleanKeyword(search.query), search.sort, search.sinceDays ?? 0, search.minAuthority ?? 0, search.kind ?? "", search.exclude ? normalizeDomain(search.exclude) ?? "" : "", search.limit, search.offset]);
    const saved = await cached<ContentPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (peek) return res.status(404).json({ code: "no_report", message: "Not searched yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<ContentPage>(user, key, "content", CACHE_HOURS, CONTENT_ESTIMATE_USD, () => fetchContent(input), false, `Content explorer — "${search.query}"${search.offset ? ` (results ${search.offset + 1}–${search.offset + search.limit})` : ""}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Batch analysis: headline numbers for up to 100 websites. Saved for a day; `peek` never buys. ──
  route("post", "/api/seo/batch", async (req, res, user) => {
    const input = batchInput.parse(req.body);
    const { domains, rejected } = cleanDomains(input.domains);
    if (!domains.length) return res.status(400).json({ message: "Enter at least one website like example.com" });
    const key = cacheKey("batch", [...domains].sort());
    const saved = input.refresh ? null : await cached<BatchPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true, rejected });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<BatchPage>(user, key, "batch", CACHE_HOURS, batchEstimateUsd(domains.length), () => fetchBatch(domains), input.refresh, `Batch analysis — ${domains.length} website${domains.length === 1 ? "" : "s"}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved, rejected });
  });

  // ── AI visibility ───────────────────────────────────────────────────────────
  // The site's saved questions with the newest answer from each assistant. Saved rows only.
  route("get", "/api/seo/sites/:id/ai", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const [prompts, { rows: keywords }] = await Promise.all([
      aiHistory(user, site.id),
      pool.query("SELECT keyword, location_name AS location FROM seo_keywords WHERE site_id=$1 ORDER BY (location_name IS NOT NULL AND location_name <> 'United States') DESC, search_volume DESC NULLS LAST, id LIMIT 40", [site.id]),
    ]);
    res.json({ businessName: site.business_name ?? null, domain: site.domain, prompts, suggestions: suggestPrompts(keywords), tracked: await trackedPrompts(site.id), maxTracked: MAX_TRACKED_PROMPTS });
  });
  // The saved answers added up: named / used as a source now and month by month, other businesses named, websites drawn on. Saved rows only.
  route("get", "/api/seo/sites/:id/ai/summary", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    // ?vs=YYYY-MM: the earlier month to compare like for like with the newest (anything else is ignored: the default month).
    const vs = typeof req.query.vs === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.vs) ? req.query.vs : null;
    res.json(await aiSummary(user, site.id, { rivals: await trackedCompetitors(site.id), businessName: site.business_name ?? null, domain: site.domain, vs }));
  });
  // Ask the chosen assistants one question. One purchase per identical question in flight; an assistant that
  // fails is not charged; the answers are saved so the history builds up.
  route("post", "/api/seo/sites/:id/ai/ask", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = askInput.parse(req.body);
    if (!isConfigured()) return notReady(res);
    // This is a visibility check, not a chatbot: a generous ceiling on how many questions an account asks in an hour.
    if (!(await takeBudget(`seo:ai:${user}`, 40, 1, 3_600_000))) return res.status(429).json({ message: "That is a lot of questions in one hour — try again in a little while." });
    const engines = [...new Set(input.engines)];
    const out = await once(`ai:${user}:${site.id}:${engines.join(",")}:${cleanKeyword(input.prompt)}`, async () => {
      // The same question to the same assistants, saved in the last two minutes (a request that waited for this one in
      // another server process): answered from it, nothing bought. A deliberate re-ask later is a new ask.
      const recent = await recentAiRun(user, site.id, input.prompt, engines, AI_DUPLICATE_SECONDS);
      if (recent) return { data: { answers: recent.answers, failed: [] as AiEngine[] }, costUsd: 0, runId: recent.runId, saved: true, reused: true };
      const o = await withBudget(user, askEstimateUsd(engines), () => askAi(input.prompt, engines, { domain: site.domain, businessName: site.business_name }), { label: `AI visibility — "${input.prompt.slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")}) for ${site.domain}` }); // the site, so the usage page opens the right one
      // Saved as one run. If saving fails the customer still gets the answers, and is told they are not in the history.
      const runId = randomUUID();
      let saved = true;
      try { await saveAiAnswers(user, site.id, input.prompt, o.data.answers, o.costUsd, runId); }
      catch (e: any) { saved = false; console.error(`[seo] AI answers for site ${site.id} were paid for but not saved (returned to the customer anyway): ${e?.message ?? e}`); }
      return { ...o, runId, saved, reused: false };
    });
    res.status(out.reused ? 200 : 201).json({ siteId: site.id, prompt: input.prompt, runId: out.runId, saved: out.saved, reused: out.reused, answers: out.data.answers, failed: out.data.failed });
  });
  // Ask a question again every month, or stop. One at a time per account, so the limit cannot be raced.
  route("post", "/api/seo/sites/:id/ai/track", (req, res, user) => serial(`aitrack:${user}`, async () => {
    const site = await ownedSite(user, req.params.id);
    const input = trackInput.parse(req.body);
    if (!(await setTracked(user, site.id, input))) return res.status(403).json({ message: `You can have up to ${MAX_TRACKED_PROMPTS} questions asked every month per site. Stop one first.` });
    res.json({ tracked: await trackedPrompts(site.id) });
  }));

  // The questions for which an AI answer already uses a site as a source. Saved for a week; `peek` never buys.
  route("post", "/api/seo/ai/mentions", async (req, res, user) => {
    const input = mentionsInput.parse(req.body);
    const domain = normalizeDomain(input.domain);
    if (!domain) return res.status(400).json({ message: "Enter a website like example.com" });
    const key = cacheKey("ai-mentions", [domain, input.platform]);
    const saved = await cached<AiMentionsPage>(user, key, 7 * 24);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not looked up yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<AiMentionsPage>(user, key, "ai-mentions", 7 * 24, AI_MENTIONS_ESTIMATE_USD, () => fetchAiMentions({ domain, platform: input.platform }), false, `AI mentions — ${domain} (${input.platform === "google" ? "Google AI Overviews" : "ChatGPT"})`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused, saved: out.saved });
  });

  // ── Rank tracker competitors: share of voice, who else is seen on these keywords, map-pack leaders. Saved checks only. ──
  route("get", "/api/seo/sites/:id/voice", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    // A choice that is given must be one this site has: anything else is refused, never quietly read as "all" / the default.
    const qd = req.query.device, qt = req.query.tag;
    if (qd !== undefined && qd !== "" && (typeof qd !== "string" || !devices.includes(qd))) return void res.status(400).json({ message: "This site does not track that device." });
    const device = (typeof qd === "string" && qd ? qd : devices[0]) as "desktop" | "mobile";
    // ?tag=: the same, on the keywords carrying that tag only (one of the site's own tags).
    const { rows: tagRows } = await pool.query("SELECT DISTINCT unnest(tags) AS tag FROM seo_keywords WHERE site_id=$1 ORDER BY 1", [site.id]);
    const tags = tagRows.map((t: any) => String(t.tag));
    if (qt !== undefined && typeof qt !== "string") return void res.status(400).json({ code: "bad_tag", message: "Choose one tag." });
    const tag = typeof qt === "string" && qt !== "" ? qt : null;
    if (tag !== null && !tags.includes(tag)) return void res.status(400).json({ code: "bad_tag", message: "This site has no keywords with that tag." });
    const [competitors, { checks, checkedOn, tracked }] = await Promise.all([trackedCompetitors(site.id), latestChecks(site.id, device, tag)]);
    const voice = shareOfVoice(checks, site.domain, competitors, (e) => listingNamed(e, site.business_name));
    res.json({ device, devices, tag, tags, checkedOn, tracked, competitors, max: MAX_TRACKED_COMPETITORS, hasPages: checks.some((c) => (c.serpTop?.length ?? 0) > 0), ...voice });
  });
  // One at a time per account, so two requests cannot both take the last place.
  route("post", "/api/seo/sites/:id/tracked-competitors", (req, res, user) => serial(`follow:${user}`, async () => {
    const site = await ownedSite(user, req.params.id);
    const domain = normalizeDomain(followInput.parse(req.body).domain);
    if (!domain) return res.status(400).json({ message: "Enter the competitor's website like example.com" });
    if (domain === site.domain) return res.status(400).json({ message: "That is your own site." });
    const have = await trackedCompetitors(site.id);
    if (!have.includes(domain) && have.length >= MAX_TRACKED_COMPETITORS) return res.status(403).json({ message: `You can follow up to ${MAX_TRACKED_COMPETITORS} competitors per site. Remove one first.` });
    await pool.query("INSERT INTO seo_site_competitors(site_id, domain) VALUES($1,$2) ON CONFLICT DO NOTHING", [site.id, domain]);
    res.status(201).json({ competitors: await trackedCompetitors(site.id) });
  }));
  route("delete", "/api/seo/sites/:id/tracked-competitors/:domain", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    await pool.query("DELETE FROM seo_site_competitors WHERE site_id=$1 AND domain=$2", [site.id, String(req.params.domain).toLowerCase().slice(0, 253)]);
    res.json({ competitors: await trackedCompetitors(site.id) });
  });

  // The link in every report email: no sign-in (the person clicking is the recipient, not the customer). The token
  // proves the link came from an email we sent to that address for that account; using it stops all further reports.
  const unsubscribePage = (res: any, title: string, body: string, status = 200) => res.status(status).type("html").send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#1a1a2e"><h1 style="font-size:22px">${title}</h1>${body}</div>`);
  const unsubscribeAsk = (req: any) => ({ userId: Number(req.query.u), email: String(req.query.e ?? "").slice(0, 254), token: String(req.query.t ?? "") });
  const BAD_LINK = `<p style="line-height:1.6;color:#444">It may have been cut off by your email program. Open the link from the newest report email, or reply to the person who sends you the reports.</p>`;
  // Opening the link only asks; mail scanners and previews open links, and must not unsubscribe anyone.
  app.get("/api/seo/report-unsubscribe", (req, res) => {
    const { userId, email, token } = unsubscribeAsk(req);
    if (!Number.isInteger(userId) || userId <= 0 || !validUnsubscribe(userId, email, token)) return unsubscribePage(res, "This link is not valid", BAD_LINK, 400);
    unsubscribePage(res, "Stop these SEO reports?",
      `<p style="line-height:1.6;color:#444">You will no longer get SEO reports from this sender at this address.</p>` +
      `<form method="post" action="/api/seo/report-unsubscribe?u=${userId}&e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}"><button style="background:#1a73e8;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer">Stop the reports</button></form>`);
  });
  app.post("/api/seo/report-unsubscribe", async (req, res) => {
    const { userId, email, token } = unsubscribeAsk(req);
    try {
      if (!Number.isInteger(userId) || userId <= 0 || !validUnsubscribe(userId, email, token)) return unsubscribePage(res, "This link is not valid", BAD_LINK, 400);
      await optOut(userId, email);
      unsubscribePage(res, "You won't get these reports any more", `<p style="line-height:1.6;color:#444">Your address has been removed from this sender's SEO reports. Nothing else is needed.</p>`);
    } catch (e: any) { console.error(`[seo] unsubscribe failed: ${e?.message ?? e}`); unsubscribePage(res, "Something went wrong", `<p style="line-height:1.6;color:#444">Please try again in a minute.</p>`, 500); }
  });

  // The report reads Search Console through this file's own summary (the same one the rank tracker shows).
  reportDeps.searchConsole = async (userId, domain) => searchConsoleSummary(userId, domain);

  // ── Reports: the site's SEO report on screen, as a PDF and by email. Saved numbers only — nothing is bought. ──
  const brandOf = async (user: number, ent: Entitlements) => ent.modules.whiteLabel
    ? (await pool.query("SELECT name, logo FROM sitescan_branding WHERE user_id=$1", [user]).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null
    : null;
  route("get", "/api/seo/sites/:id/report", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    const report = await buildSiteReport(user, site.id);
    if (!report) return res.status(404).json({ message: "Site not found" });
    const [schedule, brand, { rows: [me] }] = await Promise.all([getSchedule(user, site.id), brandOf(user, ent), pool.query("SELECT email FROM users WHERE id=$1", [user])]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ report, highlights: reportHighlights(report), empty: reportIsEmpty(report), schedule, brandName: brand?.name ?? null, accountEmail: me?.email ?? null, optedOut: await optedOut(user) });
  });
  route("get", "/api/seo/sites/:id/report.pdf", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    const report = await buildSiteReport(user, site.id);
    if (!report) return res.status(404).json({ message: "Site not found" });
    const pdf = await renderReportPdf(report, await brandOf(user, ent));
    res.setHeader("Cache-Control", "no-store");
    res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="seo-report-${site.domain.replace(/[^a-z0-9.-]/gi, "-")}.pdf"`).send(pdf);
  });
  route("post", "/api/seo/sites/:id/report/schedule", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    const input = scheduleInput.parse(req.body);
    if (input.frequency !== "off" && !ent.modules.scheduledReports) return sendModuleRequired(res, "scheduledReports");
    if (input.frequency !== "off" && !input.recipients.length) return res.status(400).json({ message: "Add at least one email address to send the report to." });
    res.json(await saveSchedule(user, site.id, input));
  });
  // "Send now". Ten sends a day per account: this emails addresses the customer typed.
  route("post", "/api/seo/sites/:id/report/send", async (req, res, user, ent) => {
    if (!ent.modules.scheduledReports) return sendModuleRequired(res, "scheduledReports");
    const site = await ownedSite(user, req.params.id);
    const { recipients } = scheduleInput.pick({ recipients: true }).parse(req.body);
    if (!recipients.length) return res.status(400).json({ message: "Add at least one email address." });
    if (!(await takeBudget(`seo:report:${user}`, 10, 1, 86_400_000))) return res.status(429).json({ message: `You can send a report ${10} times a day. Scheduled reports are not affected.` });
    res.json(await sendSiteReport(user, site.id, [...new Set(recipients)].slice(0, MAX_RECIPIENTS), `now-${Date.now()}`));
  });

  // Usage history: every lookup with what it cost the customer. Saved rows only.
  route("get", "/api/seo/usage", async (_req, res, user) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await usageHistory(user));
  });

  // Places a rank check can be run from: cities, ZIP codes, counties, states. Free (the list is saved locally).
  route("get", "/api/seo/locations", async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 80);
    if (q.trim().length < 2) return res.json({ items: [] });
    if (!isConfigured()) return notReady(res);
    res.json({ items: await searchLocations(q) });
  });

  // Tracking settings for one site: the business name on its Google profile (to find it in the map pack) and alerts.
  route("post", "/api/seo/sites/:id/settings", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = settingsInput.parse(req.body);
    const { rows: [row] } = await pool.query(
      // A mentions watch that follows the business name (no name of its own) is due again when that name changes; and
      // switching alerts off ends any failed emails still waiting to be tried again (nothing old is sent later).
      // A new frequency takes effect from the last check: a shorter gap brings the next check forward (never into the
      // past beyond "now"), a longer one moves it out.
      `UPDATE seo_sites SET business_name=CASE WHEN $2 THEN $3 ELSE business_name END, alerts_enabled=coalesce($4, alerts_enabled), alert_drop=coalesce($5, alert_drop),
              rank_frequency=coalesce($6, rank_frequency),
              group_name=${groupNameSql("$7", "$8")},
              next_rank_check_at = CASE WHEN $6 IS NOT NULL AND $6 <> rank_frequency THEN greatest(now(), coalesce(last_rank_check_at, now()) + make_interval(hours => CASE $6 WHEN 'daily' THEN 24 WHEN 'twice_weekly' THEN 84 ELSE 168 END)) ELSE next_rank_check_at END,
              next_mention_at = CASE WHEN $2 AND mention_watch AND nullif(btrim(mention_name), '') IS NULL AND lower(coalesce(business_name, '')) IS DISTINCT FROM lower(coalesce($3, '')) THEN now() ELSE next_mention_at END,
              mention_watch_note = CASE WHEN $2 AND mention_watch AND nullif(btrim(mention_name), '') IS NULL AND nullif(btrim(coalesce($3, '')), '') IS NULL THEN 'no_name' ELSE mention_watch_note END
        WHERE id=$1 RETURNING *`,
      [site.id, input.businessName !== undefined, input.businessName || null, input.alertsEnabled ?? null, input.alertDrop ?? null, input.rankFrequency ?? null, input.group !== undefined, input.group ?? null]);
    if (input.alertsEnabled === false) await pool.query("UPDATE seo_alerts SET email_retry_at = NULL WHERE site_id=$1 AND email_retry_at IS NOT NULL", [site.id]);
    res.json(siteView(row));
  });

  // Star a site: starred sites come first on the dashboard.
  route("post", "/api/seo/sites/:id/star", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { starred } = z.object({ starred: z.boolean() }).strict().parse(req.body);
    await pool.query("UPDATE seo_sites SET starred=$3 WHERE id=$1 AND user_id=$2", [site.id, user, starred]);
    res.json({ id: site.id, starred });
  });

  // Alerts: what changed between checks. Saved rows only — a page at a time, the kind filtered by the database first,
  // with the counts the page's wording rests on and how many deliveries were given up (those alerts say so).
  route("get", "/api/seo/alerts", async (req, res, user) => {
    const q = alertsQuery.parse(req.query ?? {});
    const siteId = q.siteId === undefined ? null : (await ownedSite(user, q.siteId)).id;
    const page = await alertPage(user, siteId, { kind: q.kind ?? null, limit: q.limit, before: q.before ?? null });
    res.json({ ...page, unread: await unreadAlerts(user), undelivered: await undeliveredAlerts(user) });
  });
  route("post", "/api/seo/alerts/read", async (req, res, user) => {
    await markAlertsRead(user, readInput.parse(req.body ?? {}).ids ?? null);
    res.json({ ok: true, unread: await unreadAlerts(user) });
  });

  // Site Audit: the newest crawl of the site's domain, its change since the crawl before, the health
  // trend and any crawl in progress. Reads Site Scan's crawls (sitescan_jobs) — no SEO data spent.
  // ?at=<crawl id>: show that crawl instead of the newest; ?vs=<crawl id>: compare with that earlier one instead of
  // the one just before. A malformed id is refused (never quietly read as "no choice").
  route("get", "/api/seo/sites/:id/audit", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const ids: Record<"at" | "vs", string | null> = { at: null, vs: null };
    for (const k of ["at", "vs"] as const) {
      const v = req.query[k];
      if (v === undefined || v === "") continue;
      if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return void res.status(400).json({ message: "That crawl could not be found." });
      ids[k] = v.toLowerCase();
    }
    res.json({ site: siteView(site), ...(await siteAudit(user, site.domain, ids)) });
  });

  // Site Audit → Pages: every page of the newest crawl with indexability, click depth and internal links. Saved crawl only.
  route("get", "/api/seo/sites/:id/audit/pages", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const pages = await auditPages(user, site.domain);
    if (!pages) return res.status(404).json({ code: "no_crawl", message: "No crawl of this site yet." });
    res.json(pages);
  });

  // Site Audit → Rendering: chosen pages fetched as plain HTML and in a browser, compared. The newest check and the
  // pages on offer (the home page, then the crawl's working pages nearest to it). Spends nothing.
  route("get", "/api/seo/sites/:id/render", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const crawl = await auditPages(user, site.domain).catch(() => null);
    const crawled = (crawl && "pages" in crawl ? crawl.pages : []).filter((p) => p.status === 200 && !p.redirected).sort((a, b) => (a.depth ?? 99) - (b.depth ?? 99)).map((p) => p.url);
    res.json({ latest: await latestRender(user, site.id), suggestions: renderSuggestions([`https://${site.domain}/`, ...crawled], site.domain), max: RENDER_MAX_PAGES });
  });
  // The check takes about half a minute (a browser visit per page), so it runs in the background and the page asks for it.
  route("post", "/api/seo/sites/:id/render", (req, res, user) => serial(`render:${user}`, async () => {
    const site = await ownedSite(user, req.params.id);
    const input = renderInput.parse(req.body);
    const urls = renderUrls(input.urls, site.domain);
    if (!urls.length) return res.status(400).json({ message: `Enter full addresses of pages on ${site.domain}.` });
    // Refused only for an address that cannot be checked — the same page given twice is simply checked once.
    if (input.urls.some((u) => !renderUrl(u, site.domain))) return res.status(400).json({ message: `Only pages of ${site.domain} can be checked here (web addresses on the standard port, without a sign-in). Remove the other addresses.` });
    if (!isConfigured()) return notReady(res);
    const started = await beginRender(user, site.id, urls);
    if (started.existing) return res.status(200).json({ id: started.id, running: true, reused: true });
    const runId = started.id;
    void trackWork(`rendering check ${runId}`, runRender(user, runId, urls, `Rendering check — ${site.domain}, ${urls.length} page${urls.length === 1 ? "" : "s"}`, site.domain)
      .catch(async (e: any) => {
        if (!(e instanceof SeoBudgetError)) { console.warn(`[seo] rendering check ${runId} failed: ${e?.message ?? e}`); void recordFailure("job", "SEO rendering check", e); }
        const message = e?.notSaved ? "The check ran but its results could not be saved. You were not charged." : publicFailure(e, "The check could not be completed. Try again in a few minutes.");
        await failRender(runId, message).catch(() => {});
      }));
    res.status(202).json({ id: runId, running: true });
  }));
  route("get", "/api/seo/sites/:id/render/:runId", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const run = await getRender(user, site.id, id.parse(req.params.runId));
    if (!run) return res.status(404).json({ message: "That check is no longer there." });
    res.json(run);
  });

  // Site Audit → Internal links to add: pages that use a ranking keyword's words without linking to the page that ranks. Saved crawl and checks only.
  route("get", "/api/seo/sites/:id/audit/link-opportunities", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const out = await linkOpportunities(user, site);
    if (!out) return res.status(404).json({ code: "no_crawl", message: "No crawl of this site yet." });
    res.json(out);
  });
  // Google's own clicks by page or by search (Search Console, as synced), the last 28 days against the 28 before. Saved data only.
  route("get", "/api/seo/sites/:id/search-console/:dimension", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const dimension = z.enum(["page", "query"]).parse(req.params.dimension);
    const out = await gscBreakdown(user, site, dimension);
    if (!out) return res.status(404).json({ code: "no_property", message: "No Search Console property for this site is connected." });
    res.json(out);
  });
  // Site audit → Outgoing links: the other websites the site links to, from the newest crawl. Saved data only.
  route("get", "/api/seo/sites/:id/audit/outgoing", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const out = await siteOutgoingLinks(user, site);
    if (!out) return res.status(404).json({ code: "no_crawl", message: "No crawl of this site yet." });
    res.json(out);
  });

  // Rank tracker history: one summary per check date for a device, optionally one tag. Saved checks only.
  route("get", "/api/seo/sites/:id/rank-history", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const q = historyInput.parse(req.query || {});
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    const device = (q.device && devices.includes(q.device) ? q.device : devices[0]) as "desktop" | "mobile";
    const { rows: tags } = await pool.query("SELECT DISTINCT unnest(tags) AS tag FROM seo_keywords WHERE site_id=$1 ORDER BY 1", [site.id]);
    res.json({ device, devices, tag: q.tag ?? null, tags: tags.map((t: any) => t.tag), days: await rankHistory(site.id, device, q.tag ?? null) });
  });

  // Rank tracker by tag: each tag's keywords on the newest check against the one before, one device. Saved checks only.
  route("get", "/api/seo/sites/:id/rank-tags", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const d = req.query.device;
    if (d !== undefined && d !== "" && d !== "desktop" && d !== "mobile") return void res.status(400).json({ message: "Choose desktop or mobile." });
    res.json(await rankTags(site, d === "desktop" || d === "mobile" ? d : null));
  });

  // ── Keyword watch: a monthly snapshot of what the site ranks for, compared with the one before ──
  // The setting, the newest snapshot and what changed since the one before. Saved rows only.
  // ?now=<id>&before=<id>: compare those two of the site's snapshots instead of the newest two (an alert opens its own pair).
  route("get", "/api/seo/sites/:id/keyword-watch", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const pick = req.query.now !== undefined || req.query.before !== undefined ? comparePick.safeParse({ now: req.query.now, before: req.query.before }) : null;
    if (pick && !pick.success) return res.status(400).json({ message: "Choose two snapshots to compare." });
    res.json(await keywordWatchView(user, site, pick?.data));
  });
  // Turn the monthly snapshot on or off. Spends nothing itself; the scheduler takes snapshots from the month's included data.
  route("post", "/api/seo/sites/:id/keyword-watch", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    await setKeywordWatch(user, site.id, watchSetting.parse(req.body).watch);
    res.json(await keywordWatchView(user, await ownedSite(user, req.params.id)));
  });
  // Take today's snapshot — or get it back if it has been taken (one a day, never rewritten; nothing is bought twice).
  // One at a time per site by a claim in the database, shared with the monthly schedule. Saved before it is charged.
  route("post", "/api/seo/sites/:id/keyword-watch/snapshot", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    const out = await takeKeywordSnapshot(site as any, false);
    res.status(out.reused ? 200 : 201).json(out);
  });

  // Tracked keywords for which Google has shown different pages of the site from check to check. Saved checks only.
  route("get", "/api/seo/sites/:id/rank-competing", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    res.json(await competingPages(user, site.id));
  });

  // Tracked keywords whose saved first-page results largely coincide (Google reads them as one question). Saved checks only.
  route("get", "/api/seo/sites/:id/serp-groups", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const q = historyInput.parse(req.query || {});
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    const device = (q.device && devices.includes(q.device) ? q.device : devices[0]) as "desktop" | "mobile";
    res.json(await serpGroups(user, site.id, device));
  });

  // One tracked keyword's position at every saved check.
  route("get", "/api/seo/keywords/:id/history", async (req, res, user) => {
    const h = await keywordHistory(user, id.parse(req.params.id));
    if (!h) return res.status(404).json({ message: "Keyword not found" });
    res.json(h);
  });

  // Replace a tracked keyword's tags (used to group keywords in the rank tracker).
  route("post", "/api/seo/keywords/:id/tags", async (req, res, user) => {
    const tags = [...new Set(tagsInput.parse(req.body).tags)];
    const { rowCount } = await pool.query("UPDATE seo_keywords SET tags=$3 WHERE id=$1 AND user_id=$2", [id.parse(req.params.id), user, tags]);
    if (!rowCount) return res.status(404).json({ message: "Keyword not found" });
    res.json({ ok: true, tags });
  });

  // Competitors: keywords a competitor ranks for that this site does not. One keyword search of the plan.
  route("post", "/api/seo/sites/:id/competitors", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    const competitor = normalizeDomain(competitorInput.parse(req.body).competitor);
    if (!competitor) return res.status(400).json({ message: "Enter the competitor's domain like example.com" });
    if (competitor === site.domain) return res.status(400).json({ message: "That is your own site." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce(user, `competitors:${site.id}:${competitor}:${site.location_code}:${site.language_code}`, "competitors", DUPLICATE_WINDOW_HOURS, estimateLabsUsd(GAP_LIMIT), () => labsDomainIntersection({ competitor, ours: site.domain, locationCode: site.location_code, languageCode: site.language_code, limit: GAP_LIMIT }), false, `Competitor gap — ${site.domain} vs ${competitor}`);
    res.json({ competitor, ours: site.domain, items: out.data.items, totalCount: out.data.totalCount, reused: out.reused, usage: await planUsage(user, ent) });
  });
}

/**
 * A rank run as the account sees it. The saved note is made safe on the way out (rows written by earlier
 * versions can hold an error's own text); a platform admin gets it as saved.
 */
function runView(r: any, admin: boolean) {
  return { ...r, error: admin ? r.error ?? null : publicNote(r.error) };
}

function siteView(s: any) {
  return {
    id: s.id, domain: s.domain, businessName: s.business_name ?? null, alertsEnabled: s.alerts_enabled !== false, alertDrop: s.alert_drop ?? 3, rankFrequency: s.rank_frequency ?? "weekly", group: s.group_name ?? null, locationCode: s.location_code, languageCode: s.language_code, devices: s.devices, serpDepth: s.serp_depth,
    keywordCount: s.keyword_count ?? 0, nextRankCheckAt: s.next_rank_check_at, lastRankCheckAt: s.last_rank_check_at,
    nextBacklinksAt: s.next_backlinks_at, lastBacklinksAt: s.last_backlinks_at, createdAt: s.created_at, starred: s.starred === true,
  };
}
