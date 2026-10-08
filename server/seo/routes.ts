/**
 * /api/seo/* — ConstructHUB SEO's API. Session auth through the platform's
 * getDevUser, plan-gated like Site Scan (server/seo/plan.ts). Every row is
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
import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { isPlatformAdmin } from "../admin";
import { requirePlan, sendLimitReached, raiseHint, plural, type Entitlements } from "../entitlements";
import { monthlyUsage, reserveQuotaFor, refundReservation, resetsAt } from "../growth-quotas";
import { budgetStatus, withBudget, SeoBudgetError, monthlySpendByAccount, monthlyBudgetUsd, monthKey } from "./budget";
import {
  isConfigured, normalizeDomain, labsKeywordSuggestions, labsDomainIntersection, adsSearchVolume, DataForSeoError,
} from "./dataforseo";
import { estimateLabsUsd, estimateAdsVolumeUsd, estimateRankCheckUsd, estimateBacklinkSnapshotUsd } from "./pricing";
import { creditStatus, outOfCreditMessage } from "./credits";
import { retailCents, SEO_CREDIT_PACKS } from "@shared/seo-credits";
import {
  reportInput, isKeywordTable, reportCacheKey, cacheKey, cached, saveCached, fetchReportPage, fetchKeywordOverview,
  CACHE_HOURS, KEYWORD_OVERVIEW_TTL_DAYS, REPORT_ESTIMATE_USD, REPORT_TYPICAL_USD, KEYWORD_OVERVIEW_ESTIMATE_USD, KEYWORD_OVERVIEW_TYPICAL_USD,
  type ReportPage, type KeywordOverview,
} from "./reports";
import { enqueueRankRun, postQueuedRun, snapshotBacklinks, type SiteRow } from "./jobs";
import { seoAllowanceTest, keywordsFit, SEO_FEATURE, SEO_ENV_VARS, SEO_NOT_READY_MESSAGE } from "./plan";
import { fetchDomainReport, latestReport, saveReport, recentReports, EXPLORER_ESTIMATE_USD, EXPLORER_TYPICAL_USD, REPORT_TTL_DAYS } from "./explorer";
import { PLANS } from "@shared/plans";
import { siteAudit, auditHealthByDomain, auditDomainKey } from "./audit";
import { auditPages } from "./audit-pages";
import { rankHistory, keywordHistory } from "./rank-history";
import { searchLocations, locationByCode } from "./locations";
import { BULK_MAX } from "./lists";
import { bulkInput, bulkEstimateUsd, cleanKeywords, fetchBulkKeywords, listsOf, listItems, addToList, removeFromList, deleteList, listItemsInput, ListError, type BulkPage } from "./lists";
import { usageHistory } from "./usage";
import { buildSiteReport, renderReportPdf, reportHighlights, reportIsEmpty, getSchedule, saveSchedule, scheduleInput, MAX_RECIPIENTS } from "./site-report";
import { sendSiteReport, validUnsubscribe, optOut, optedOut } from "./site-report-send";
import { takeBudget } from "../growth-limits";
import { shareOfVoice, latestChecks, trackedCompetitors, competitorInput as followInput, MAX_TRACKED_COMPETITORS } from "./voice";
import { listingNamed } from "./dataforseo";
import { askInput, mentionsInput, askAi, askEstimateUsd, saveAiAnswers, aiHistory, suggestPrompts, fetchAiMentions, AI_ENGINES, AI_MENTIONS_ESTIMATE_USD, AI_MENTIONS_TYPICAL_USD, type AiMentionsPage } from "./ai-visibility";
import { LABS_TASK_USD, LABS_ITEM_USD } from "./pricing";
import { listAlerts, unreadAlerts, markAlertsRead } from "./alerts";
import { gapInput, gapEstimateUsd, fetchGap, CONTENT_GAP_ROWS, GAP_MAX_COMPETITORS, type GapPage } from "./gap";

/**
 * What each lookup costs the customer, in cents (wholesale estimate x SEO_MARKUP).
 * Shown before they run it; the charge itself is settled to the real cost.
 */
export const SEO_PRICES = {
  explorerReport: retailCents(EXPLORER_TYPICAL_USD),
  /** One page of a Site Explorer or Keywords Explorer table. */
  reportPage: retailCents(REPORT_TYPICAL_USD),
  keywordOverview: retailCents(KEYWORD_OVERVIEW_TYPICAL_USD),
  keywordResearch: retailCents(estimateLabsUsd(50)),
  competitorGap: retailCents(estimateLabsUsd(100)),
  backlinkRefresh: retailCents(estimateBacklinkSnapshotUsd(100)),
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
  /** Per 100 rank checks (one keyword on one device is one check, top 10). */
  rankChecksPer100: retailCents(estimateRankCheckUsd(Array.from({ length: 100 }, (_, i) => `k${i}`), "desktop", 10).usd),
};

/**
 * What is set aside while a lookup runs (the most it can cost), in cents. A
 * lookup needs this much available to start; the unused part comes straight back.
 */
export const SEO_HOLDS = {
  explorerReport: retailCents(EXPLORER_ESTIMATE_USD),
  reportPage: retailCents(REPORT_ESTIMATE_USD),
  keywordOverview: retailCents(KEYWORD_OVERVIEW_ESTIMATE_USD),
};

/** Report names as the customer sees them (usage history). */
const REPORT_NAMES: Record<string, string> = {
  keywords: "Organic keywords", paidKeywords: "Paid keywords", pages: "Top pages", competitors: "Organic competitors", backlinks: "Backlinks", newBacklinks: "New backlinks",
  lostBacklinks: "Lost backlinks", brokenBacklinks: "Broken backlinks", referringDomains: "Referring domains", anchors: "Anchors", bestByLinks: "Best pages by links",
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
}).strict();
const readInput = z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }).strict();
const tagsInput = z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(10) }).strict();
const cleanKeyword = (k: string) => k.toLowerCase().replace(/\s+/g, " ").trim();

/** Customer-facing wording for a vendor error: what happened, never who the vendor is. */
function vendorErrorMessage(e: DataForSeoError): string {
  switch (e.code) {
    case "not_configured": return SEO_NOT_READY_MESSAGE;
    case "rate_limited": return "The search data service is busy — try again in a minute.";
    case "invalid": return "That request couldn't be run — check the keyword or domain and try again.";
    case "task_failed": return "That check didn't complete — try again in a few minutes.";
    default: return "The search data service didn't answer — try again in a few minutes.";
  }
}

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
        if (e instanceof z.ZodError) return void res.status(400).json({ message: "Invalid input", issues: e.issues.slice(0, 3) });
        // The internal cap tripped: a neutral "paused" to the customer; the dollars are already in the log.
        if (e instanceof ListError) return void res.status(e.status).json({ message: e.message });
        if (e instanceof SeoBudgetError) return void res.status(402).json({ code: e.code, message: e.message, ...(e.code === "seo_credits" ? { packs: SEO_CREDIT_PACKS } : {}) });
        if (e instanceof DataForSeoError) {
          const status = e.code === "not_configured" ? 503 : e.code === "auth" ? 502 : e.code === "rate_limited" ? 429 : e.code === "invalid" || e.code === "task_failed" ? 400 : 502;
          console.warn(`[seo] vendor error ${e.code} on ${req.method} ${req.path}: ${e.message}`);
          return void res.status(status).json({ code: `seo_source_${e.code}`, message: vendorErrorMessage(e) });
        }
        next(e);
      }
    });

  /**
   * One purchase at a time per account per exact request: a second identical
   * request made while the first is still running waits for it and shares its
   * result instead of buying the same data again. (One app process serves
   * production; the saved copy covers every later request.)
   */
  const inflight = new Map<string, Promise<any>>();
  const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key);
    if (running) return running;
    const p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  /** Save a paid result. A failed save must not cost the customer the data they just paid for: they still get the response. */
  const keep = async (what: string, save: () => Promise<void>) => {
    try { await save(); } catch (e: any) { console.error(`[seo] ${what} was paid for but not saved (returned to the customer anyway): ${e?.message ?? e}`); }
  };
  /**
   * Buy a cacheable result once. The first request runs it; anyone asking for the same thing meanwhile waits and
   * gets the same result marked `reused` (they bought nothing). The saved copy is checked again inside, so a
   * request arriving just after another finished does not buy it a second time.
   */
  const buyOnce = async <T>(user: number, key: string, kind: string, maxAgeHours: number, estimateUsd: number, fetch: () => Promise<{ data: T; costUsd: number; costUnknown?: boolean }>, skipSaved = false, label?: string): Promise<{ data: T; reused: boolean }> => {
    const flight = `${kind}:${user}:${key}`;
    const waiting = inflight.has(flight);
    const out = await once(flight, async () => {
      if (!skipSaved) { const again = await cached<T>(user, key, maxAgeHours); if (again) return { data: again, bought: false }; }
      const o = await withBudget(user, estimateUsd, fetch, { label });
      await keep(`${kind} for account ${user}`, () => saveCached(user, key, kind, o.data, o.costUsd));
      return { data: o.data, bought: true };
    });
    return { data: out.data, reused: waiting || !out.bought };
  };
  /** Requests for one key run one after another (keyword imports: the plan limit is counted, then inserted). */
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    const tail = next.catch(() => {}).finally(() => { if (queues.get(key) === tail) queues.delete(key); });
    queues.set(key, tail);
    return next;
  };

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
    const body: Record<string, unknown> = { configured: isConfigured(), alertsUnread: await unreadAlerts(user), usage, credits, prices: SEO_PRICES, holds: SEO_HOLDS, packs: SEO_CREDIT_PACKS, resetsAt: resetsAt() };
    if (isPlatformAdmin(req.user)) {
      const budget = await budgetStatus(user);
      body.admin = { vendor: "DataForSEO", configured: isConfigured(), env: SEO_ENV_VARS, ...budget };
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
      res.json({ vendor: "DataForSEO", configured: isConfigured(), env: SEO_ENV_VARS, month, capUsd, totalUsd, remainingUsd: Math.max(0, Math.round((capUsd - totalUsd) * 1e6) / 1e6), accounts });
    } catch (e) { next(e); }
  });

  route("get", "/api/seo/sites", async (_req, res, user) => {
    const { rows } = await pool.query(
      `SELECT s.*, (SELECT count(*)::int FROM seo_keywords k WHERE k.site_id=s.id) AS keyword_count
       FROM seo_sites s WHERE s.user_id=$1 ORDER BY s.created_at`, [user]);
    res.json(rows.map(siteView));
  });

  route("post", "/api/seo/sites", async (req, res, user) => {
    const input = siteInput.parse(req.body);
    const domain = normalizeDomain(input.domain);
    if (!domain) return res.status(400).json({ message: "Enter a domain like example.com" });
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM seo_sites WHERE user_id=$1", [user]);
    if (n >= MAX_SITES) return res.status(403).json({ message: `Up to ${MAX_SITES} sites can be tracked.` });
    const { rows: [site] } = await pool.query(
      `INSERT INTO seo_sites(user_id,domain,location_code,language_code,devices,serp_depth) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(user_id,domain) DO UPDATE SET location_code=EXCLUDED.location_code,language_code=EXCLUDED.language_code,devices=EXCLUDED.devices,serp_depth=EXCLUDED.serp_depth
       RETURNING *, 0 AS keyword_count`,
      [user, domain, input.locationCode, input.languageCode, input.devices, input.serpDepth]);
    res.status(201).json(siteView(site));
  });

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
      pool.query(
        `SELECT keyword_id, device, position, url, checked_on::text AS checked_on, serp_features, local_position, local_pack, serp_top FROM (
           SELECT c.*, row_number() OVER (PARTITION BY keyword_id, device ORDER BY checked_on DESC) rn
           FROM seo_rank_checks c WHERE c.site_id=$1) x WHERE rn<=2 ORDER BY keyword_id, device, checked_on DESC`, [site.id]),
      pool.query("SELECT id, trigger, status, total, checked, error, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 5", [site.id]),
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
      site: siteView({ ...site, keyword_count: keywords.length }), devices, summary, rows, runs, searchConsole: gsc,
      nextCheck: { serps: estimate.serps, priceCents: retailCents(estimate.usd), nextAt: site.next_rank_check_at ?? null },
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
    const { rows } = await pool.query("SELECT id, keyword FROM seo_keywords WHERE site_id=$1 AND (volume_checked_at IS NULL OR volume_checked_at<now()-interval '30 days') ORDER BY id LIMIT 1000", [site.id]);
    if (!rows.length) return res.json({ updated: 0 });
    const out = await once(`volumes:${user}:${site.id}`, () =>
      withBudget(user, estimateAdsVolumeUsd(rows.length), () => adsSearchVolume({ keywords: rows.map((r: any) => r.keyword), locationCode: site.location_code, languageCode: site.language_code }), { label: `Search volumes — ${rows.length} keyword${rows.length === 1 ? "" : "s"} for ${site.domain}` }));
    const byKeyword = new Map(out.data.map((v) => [v.keyword.toLowerCase(), v]));
    let updated = 0;
    for (const r of rows) {
      const v = byKeyword.get(r.keyword.toLowerCase());
      if (!v) continue;
      await pool.query("UPDATE seo_keywords SET search_volume=$2, cpc=$3, volume_checked_at=now() WHERE id=$1", [r.id, v.searchVolume, v.cpc]);
      updated++;
    }
    res.json({ updated });
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
      return res.status(402).json({ code: "seo_budget", message: "SEO checks are paused for the rest of the month — the monthly data allowance for rank tracking is used up. It comes back on the 1st." });
    }
    // The customer's own credit: say so now rather than failing the run a moment later.
    const credits = await creditStatus(user, ent.allowances?.seoCreditCents ?? 0);
    const need = retailCents(estimate.usd);
    if (credits.availableCents !== -1 && need > credits.availableCents) {
      return res.status(402).json({ code: "seo_credits", message: outOfCreditMessage(need, credits.availableCents), packs: SEO_CREDIT_PACKS });
    }
    const run = await enqueueRankRun(site, "manual");
    if (!run.reused) void postQueuedRun(run.id).catch((e) => console.error("[seo] run-now post failed", e?.message ?? e));
    res.status(202).json({ runId: run.id, reused: run.reused, serps: estimate.serps });
  });

  route("get", "/api/seo/sites/:id/runs", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query("SELECT id, trigger, status, total, checked, error, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 20", [site.id]);
    res.json(rows);
  });

  // Keyword research: seed → suggestions with volume / CPC / difficulty (up to 50 rows). One keyword search of the plan.
  route("post", "/api/seo/keywords/research", async (req, res, user, ent) => {
    const input = researchInput.parse(req.body);
    if (!isConfigured()) return notReady(res);
    const out = await once(`research:${user}:${cleanKeyword(input.seed)}:${input.locationCode}:${input.languageCode}`, () =>
      withBudget(user, estimateLabsUsd(SUGGESTION_LIMIT), () => labsKeywordSuggestions({ keyword: input.seed, locationCode: input.locationCode, languageCode: input.languageCode, limit: SUGGESTION_LIMIT }), { label: `Keyword ideas — ${cleanKeyword(input.seed)}` }));
    res.json({ seed: input.seed, items: out.data, usage: await planUsage(user, ent) });
  });

  // Backlinks: the latest snapshot, and "Refresh now".
  route("get", "/api/seo/sites/:id/backlinks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query(
      "SELECT id, taken_on::text AS taken_on, summary, backlinks FROM seo_backlink_snapshots WHERE site_id=$1 ORDER BY taken_on DESC LIMIT 2", [site.id]);
    const [latest, previous] = rows;
    res.json({
      site: siteView(site), configured: isConfigured(),
      snapshot: latest ? { id: latest.id, takenOn: latest.taken_on, summary: latest.summary, backlinks: latest.backlinks } : null,
      previous: previous ? { takenOn: previous.taken_on, summary: previous.summary } : null,
      nextSnapshotAt: site.next_backlinks_at,
    });
  });

  // "Refresh now": one backlink refresh of the plan (the automatic monthly snapshot is on top).
  route("post", "/api/seo/sites/:id/backlinks/refresh", async (req, res, user, ent) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return notReady(res);
    const snap = await once(`backlinks:${user}:${site.id}`, () => snapshotBacklinks(site));
    res.status(201).json({ id: snap.id, takenOn: snap.takenOn, usage: await planUsage(user, ent) });
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
    const saved = await latestReport(user, domain, locationCode, languageCode);
    if (!saved) return res.status(404).json({ code: "no_report", message: "No report for that domain yet." });
    res.json({ report: saved.report, fresh: saved.fresh, configured: isConfigured() });
  });

  // Analyse a domain. A saved report inside the free window is returned as is; otherwise
  // (or with refresh) one keyword search of the plan buys a new one.
  route("post", "/api/seo/explorer", async (req, res, user, ent) => {
    const input = explorerInput.parse(req.body);
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
      await keep(`explorer report ${domain}`, () => saveReport(user, o.data, o.costUsd));
      return o;
    });
    res.status(waiting ? 200 : 201).json({ report: out.data, fresh: true, reused: waiting, usage: await planUsage(user, ent) });
  });

  // ── Reports: one page of a Site Explorer / Keywords Explorer table ──────────
  // A page already run in the last day is served from seo_report_cache at no charge;
  // `peek` asks for that only. Anything else is one vendor call on the account's credit.
  route("post", "/api/seo/report", async (req, res, user) => {
    const input = reportInput.parse(req.body);
    const forKeyword = isKeywordTable(input.table);
    const target = forKeyword ? cleanKeyword(input.keyword ?? "") : normalizeDomain(input.domain ?? "");
    if (!target) return res.status(400).json({ message: forKeyword ? "Enter a keyword." : "Enter a domain like example.com" });
    const full = { ...input, target };
    const key = reportCacheKey(full);
    const saved = await cached<ReportPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<ReportPage>(user, key, `report:${input.table}`, CACHE_HOURS, REPORT_ESTIMATE_USD, () => fetchReportPage(full), false, `${REPORT_NAMES[input.table] ?? input.table} — ${target}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused });
  });

  // ── Keywords Explorer: one keyword's overview ───────────────────────────────
  route("post", "/api/seo/keyword", async (req, res, user) => {
    const input = keywordOverviewInput.parse(req.body);
    const keyword = cleanKeyword(input.keyword);
    if (!keyword) return res.status(400).json({ message: "Enter a keyword." });
    const key = cacheKey("keyword-overview", [keyword, input.locationCode, input.languageCode]);
    if (!input.refresh) {
      const saved = await cached<KeywordOverview>(user, key, KEYWORD_OVERVIEW_TTL_DAYS * 24);
      if (saved) return res.json({ overview: saved, reused: true });
    }
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not looked up yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<KeywordOverview>(user, key, "keyword-overview", KEYWORD_OVERVIEW_TTL_DAYS * 24, KEYWORD_OVERVIEW_ESTIMATE_USD,
      () => fetchKeywordOverview({ keyword, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh, `Keyword overview — ${keyword}`);
    res.status(out.reused ? 200 : 201).json({ overview: out.data, reused: out.reused });
  });

  // ── Content gap / Link intersect (Site Explorer) ────────────────────────────
  // Up to three competitors against one domain. Saved for a day; `peek` returns the saved copy or 404.
  route("post", "/api/seo/gap", async (req, res, user) => {
    const input = gapInput.parse(req.body);
    const target = normalizeDomain(input.domain);
    if (!target) return res.status(400).json({ message: "Enter a domain like example.com" });
    const competitors = [...new Set(input.competitors.map((c) => normalizeDomain(c)).filter((c): c is string => !!c && c !== target))];
    if (!competitors.length) return res.status(400).json({ message: "Enter at least one competitor's domain, different from the site itself." });
    const content = input.kind === "content";
    const limit = content ? CONTENT_GAP_ROWS : input.limit, offset = content ? 0 : input.offset;
    const key = cacheKey(`gap:${input.kind}`, [target, competitors, limit, offset, input.locationCode, input.languageCode]);
    const saved = input.refresh ? null : await cached<GapPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<GapPage>(user, key, `gap:${input.kind}`, CACHE_HOURS, gapEstimateUsd(input.kind, competitors.length, limit),
      () => fetchGap({ kind: input.kind, target, competitors, limit, offset, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh, `${content ? "Content gap" : "Link intersect"} — ${target} vs ${competitors.join(", ")}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused });
  });

  // ── Dashboard: every tracked site with its saved numbers (never a vendor call) ──
  route("get", "/api/seo/dashboard", async (_req, res, user) => {
    const { rows: sites } = await pool.query(
      `SELECT s.*, (SELECT count(*)::int FROM seo_keywords k WHERE k.site_id=s.id) AS keyword_count,
              (SELECT report FROM seo_domain_reports r WHERE r.user_id=s.user_id AND r.domain=s.domain AND r.location_code=s.location_code AND r.language_code=s.language_code ORDER BY r.created_at DESC LIMIT 1) AS report
         FROM seo_sites s WHERE s.user_id=$1 ORDER BY s.created_at`, [user]);
    const audits = await auditHealthByDomain(user, sites.map((s: any) => s.domain));
    // One query for every site's newest positions (not one per site).
    const { rows: ranks } = await pool.query(
      `SELECT site_id, count(*) FILTER (WHERE position<=3)::int AS top3, count(*) FILTER (WHERE position<=10)::int AS top10,
              count(*) FILTER (WHERE position IS NOT NULL)::int AS ranked, count(*)::int AS checked, max(checked_on)::text AS checked_on
         FROM (SELECT DISTINCT ON (keyword_id) site_id, position, checked_on FROM seo_rank_checks WHERE site_id = ANY($1::int[]) ORDER BY keyword_id, checked_on DESC, position NULLS LAST) x
        GROUP BY site_id`, [sites.map((s: any) => s.id)]);
    const rankOf = new Map<number, any>(ranks.map((r: any) => [r.site_id, r]));
    const cards = [];
    for (const s of sites) {
      const rank = rankOf.get(s.id);
      const r = s.report;
      cards.push({
        site: siteView(s),
        audit: audits.get(auditDomainKey(s.domain)) ?? null,
        rank: { top3: rank?.top3 ?? 0, top10: rank?.top10 ?? 0, ranked: rank?.ranked ?? 0, checked: rank?.checked ?? 0, checkedOn: rank?.checked_on ?? null },
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
    const keywords = cleanKeywords(input.keywords);
    if (!keywords.length) return res.status(400).json({ message: "Enter at least one keyword." });
    const key = cacheKey("keywords-bulk", [[...keywords].sort(), input.locationCode, input.languageCode]);
    const saved = await cached<BulkPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<BulkPage>(user, key, "keywords-bulk", CACHE_HOURS, bulkEstimateUsd(keywords.length),
      () => fetchBulkKeywords({ keywords, locationCode: input.locationCode, languageCode: input.languageCode }), false, `Bulk keyword analysis — ${keywords.length} keyword${keywords.length === 1 ? "" : "s"}`);
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused });
  });

  // ── Keyword lists: saved research. Nothing here calls the data source. ──────
  route("get", "/api/seo/lists", async (_req, res, user) => { res.json({ lists: await listsOf(user) }); });
  // One at a time per account, so two requests cannot both pass the list limits.
  route("post", "/api/seo/lists/items", (req, res, user) => serial(`lists:${user}`, async () => { res.status(201).json(await addToList(user, listItemsInput.parse(req.body))); }));
  // "Refresh numbers": today's volume, difficulty, CPC and intent for every keyword in the list, written back to it.
  // One lookup per 200 keywords; always bought fresh (that is the point), and each batch is on the usage page.
  route("post", "/api/seo/lists/:id/refresh", (req, res, user) => serial(`lists:${user}`, async () => {
    if (!isConfigured()) return notReady(res);
    const { list, items } = await listItems(user, id.parse(req.params.id));
    const keywords = items.map((i: any) => i.keyword as string);
    if (!keywords.length) return res.status(400).json({ message: "This list is empty." });
    let updated = 0, failed = 0, problem: string | null = null;
    for (let i = 0; i < keywords.length; i += BULK_MAX) {
      const chunk = keywords.slice(i, i + BULK_MAX);
      try {
        const out = await withBudget(user, bulkEstimateUsd(chunk.length), () => fetchBulkKeywords({ keywords: chunk, locationCode: 2840, languageCode: "en" }), { label: `Refresh list — ${list.name} (${chunk.length} keyword${chunk.length === 1 ? "" : "s"})` });
        // Only keywords still in the list (one removed while this ran stays removed).
        const { rows: still } = await pool.query("SELECT keyword FROM seo_keyword_list_items WHERE list_id=$1 AND keyword = ANY($2::text[])", [list.id, out.data.rows.map((r) => r.keyword)]);
        const keep = new Set(still.map((r: any) => r.keyword));
        const fresh = out.data.rows.filter((r) => keep.has(r.keyword));
        if (fresh.length) await addToList(user, { listId: list.id, items: fresh.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty, intent: r.intent })) }, true);
        updated += fresh.length;
      } catch (e: any) {
        // What was done stays done and is reported; out of credit stops here, anything else moves on to the next batch.
        failed += chunk.length;
        problem = e instanceof SeoBudgetError ? e.message : "Some keywords could not be refreshed — try again in a few minutes.";
        if (e instanceof SeoBudgetError || e instanceof ListError) break;
      }
    }
    res.json({ updated, total: keywords.length, failed, problem });
  }));
  route("get", "/api/seo/lists/:id", async (req, res, user) => { res.json(await listItems(user, id.parse(req.params.id))); });
  route("post", "/api/seo/lists/:id/remove", async (req, res, user) => {
    res.json({ removed: await removeFromList(user, id.parse(req.params.id), removeInput.parse(req.body).keywords) });
  });
  route("delete", "/api/seo/lists/:id", async (req, res, user) => { await deleteList(user, id.parse(req.params.id)); res.json({ ok: true }); });

  // ── AI visibility ───────────────────────────────────────────────────────────
  // The site's saved questions with the newest answer from each assistant. Saved rows only.
  route("get", "/api/seo/sites/:id/ai", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const [prompts, { rows: keywords }] = await Promise.all([
      aiHistory(user, site.id),
      pool.query("SELECT keyword, location_name AS location FROM seo_keywords WHERE site_id=$1 ORDER BY (location_name IS NOT NULL AND location_name <> 'United States') DESC, search_volume DESC NULLS LAST, id LIMIT 40", [site.id]),
    ]);
    res.json({ businessName: site.business_name ?? null, domain: site.domain, prompts, suggestions: suggestPrompts(keywords) });
  });
  // Ask the chosen assistants one question. One purchase per identical question in flight; an assistant that
  // fails is not charged; the answers are saved so the history builds up.
  route("post", "/api/seo/sites/:id/ai/ask", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = askInput.parse(req.body);
    if (!isConfigured()) return notReady(res);
    const engines = [...new Set(input.engines)];
    const out = await once(`ai:${user}:${site.id}:${engines.join(",")}:${cleanKeyword(input.prompt)}`, async () => {
      const o = await withBudget(user, askEstimateUsd(engines), () => askAi(input.prompt, engines, { domain: site.domain, businessName: site.business_name }), { label: `AI visibility — "${input.prompt.slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")})` });
      await keep(`AI answers for site ${site.id}`, () => saveAiAnswers(user, site.id, input.prompt, o.data.answers, o.costUsd));
      return o;
    });
    res.status(201).json({ prompt: input.prompt, answers: out.data.answers, failed: out.data.failed });
  });
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
    res.status(out.reused ? 200 : 201).json({ page: out.data, reused: out.reused });
  });

  // ── Rank tracker competitors: share of voice, who else is seen on these keywords, map-pack leaders. Saved checks only. ──
  route("get", "/api/seo/sites/:id/voice", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    const device = (devices.includes(String(req.query.device)) ? String(req.query.device) : devices[0]) as "desktop" | "mobile";
    const [competitors, { checks, checkedOn, tracked }] = await Promise.all([trackedCompetitors(site.id), latestChecks(site.id, device)]);
    const voice = shareOfVoice(checks, site.domain, competitors, (e) => listingNamed(e, site.business_name));
    res.json({ device, devices, checkedOn, tracked, competitors, max: MAX_TRACKED_COMPETITORS, hasPages: checks.some((c) => (c.serpTop?.length ?? 0) > 0), ...voice });
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

  // ── Reports: the site's SEO report on screen, as a PDF and by email. Saved numbers only — nothing is bought. ──
  const brandOf = async (user: number) => (await pool.query("SELECT name, logo FROM sitescan_branding WHERE user_id=$1", [user]).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null;
  route("get", "/api/seo/sites/:id/report", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const report = await buildSiteReport(user, site.id);
    if (!report) return res.status(404).json({ message: "Site not found" });
    const [schedule, brand, { rows: [me] }] = await Promise.all([getSchedule(user, site.id), brandOf(user), pool.query("SELECT email FROM users WHERE id=$1", [user])]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ report, highlights: reportHighlights(report), empty: reportIsEmpty(report), schedule, brandName: brand?.name ?? null, accountEmail: me?.email ?? null, optedOut: await optedOut(user) });
  });
  route("get", "/api/seo/sites/:id/report.pdf", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const report = await buildSiteReport(user, site.id);
    if (!report) return res.status(404).json({ message: "Site not found" });
    const pdf = await renderReportPdf(report, await brandOf(user));
    res.setHeader("Cache-Control", "no-store");
    res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="seo-report-${site.domain.replace(/[^a-z0-9.-]/gi, "-")}.pdf"`).send(pdf);
  });
  route("post", "/api/seo/sites/:id/report/schedule", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = scheduleInput.parse(req.body);
    if (input.frequency !== "off" && !input.recipients.length) return res.status(400).json({ message: "Add at least one email address to send the report to." });
    res.json(await saveSchedule(user, site.id, input));
  });
  // "Send now". Ten sends a day per account: this emails addresses the customer typed.
  route("post", "/api/seo/sites/:id/report/send", async (req, res, user) => {
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
      `UPDATE seo_sites SET business_name=CASE WHEN $2 THEN $3 ELSE business_name END, alerts_enabled=coalesce($4, alerts_enabled), alert_drop=coalesce($5, alert_drop)
        WHERE id=$1 RETURNING *`,
      [site.id, input.businessName !== undefined, input.businessName || null, input.alertsEnabled ?? null, input.alertDrop ?? null]);
    res.json(siteView(row));
  });

  // Alerts: what changed between checks. Saved rows only.
  route("get", "/api/seo/alerts", async (req, res, user) => {
    const siteId = req.query.siteId === undefined ? null : (await ownedSite(user, req.query.siteId)).id;
    res.json({ alerts: await listAlerts(user, siteId), unread: await unreadAlerts(user) });
  });
  route("post", "/api/seo/alerts/read", async (req, res, user) => {
    await markAlertsRead(user, readInput.parse(req.body ?? {}).ids ?? null);
    res.json({ ok: true, unread: await unreadAlerts(user) });
  });

  // Site Audit: the newest crawl of the site's domain, its change since the crawl before, the health
  // trend and any crawl in progress. Reads Site Scan's crawls (sitescan_jobs) — no SEO data spent.
  route("get", "/api/seo/sites/:id/audit", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    res.json({ site: siteView(site), ...(await siteAudit(user, site.domain)) });
  });

  // Site Audit → Pages: every page of the newest crawl with indexability, click depth and internal links. Saved crawl only.
  route("get", "/api/seo/sites/:id/audit/pages", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const pages = await auditPages(user, site.domain);
    if (!pages) return res.status(404).json({ code: "no_crawl", message: "No crawl of this site yet." });
    res.json(pages);
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
    const out = await once(`competitors:${user}:${site.id}:${competitor}`, () => withBudget(user, estimateLabsUsd(GAP_LIMIT), () => labsDomainIntersection({ competitor, ours: site.domain, locationCode: site.location_code, languageCode: site.language_code, limit: GAP_LIMIT }), { label: `Competitor gap — ${site.domain} vs ${competitor}` }));
    res.json({ competitor, ours: site.domain, items: out.data.items, totalCount: out.data.totalCount, usage: await planUsage(user, ent) });
  });
}

function siteView(s: any) {
  return {
    id: s.id, domain: s.domain, businessName: s.business_name ?? null, alertsEnabled: s.alerts_enabled !== false, alertDrop: s.alert_drop ?? 3, locationCode: s.location_code, languageCode: s.language_code, devices: s.devices, serpDepth: s.serp_depth,
    keywordCount: s.keyword_count ?? 0, nextRankCheckAt: s.next_rank_check_at, lastRankCheckAt: s.last_rank_check_at,
    nextBacklinksAt: s.next_backlinks_at, lastBacklinksAt: s.last_backlinks_at, createdAt: s.created_at,
  };
}

/**
 * Search Console clicks / impressions for the site's domain over the last 28
 * days (and the 28 before), from the gsc_analytics rows the Search Console
 * page already syncs (server/gsc). null when no property matches the domain.
 */
export async function searchConsoleSummary(user: number, domain: string) {
  const { rows: assets } = await pool.query(
    `SELECT id, external_id, synced_at FROM edge_assets WHERE user_id=$1 AND provider='gsc'
       AND (external_id=$2 OR external_id=$3 OR external_id=$4 OR external_id=$5 OR external_id=$6 OR external_id=$7)
     ORDER BY (external_id=$2) DESC, id LIMIT 1`,
    [user, `sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`, `sc-domain:www.${domain}`]);
  const asset = assets[0];
  if (!asset) return null;
  const { rows } = await pool.query(
    `SELECT (date>=current_date-28) AS recent, sum(clicks)::float8 clicks, sum(impressions)::float8 impressions,
            CASE WHEN sum(impressions)>0 THEN sum(position*impressions)/sum(impressions) END::float8 AS position
       FROM gsc_analytics WHERE asset_id=$1 AND dimension='date' AND date>=current_date-56 GROUP BY 1`, [asset.id]);
  const pick = (recent: boolean) => rows.find((r) => r.recent === recent);
  const cur = pick(true), prev = pick(false);
  return {
    property: asset.external_id, syncedAt: asset.synced_at,
    clicks: cur?.clicks ?? 0, impressions: cur?.impressions ?? 0, position: cur?.position != null ? Math.round(cur.position * 10) / 10 : null,
    previousClicks: prev?.clicks ?? 0, previousImpressions: prev?.impressions ?? 0,
  };
}
