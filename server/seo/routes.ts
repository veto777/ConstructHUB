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
import { rankHistory, keywordHistory } from "./rank-history";
import { searchLocations, locationByCode } from "./locations";
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
  const buyOnce = async <T>(user: number, key: string, kind: string, maxAgeHours: number, estimateUsd: number, fetch: () => Promise<{ data: T; costUsd: number; costUnknown?: boolean }>, skipSaved = false): Promise<{ data: T; reused: boolean }> => {
    const flight = `${kind}:${user}:${key}`;
    const waiting = inflight.has(flight);
    const out = await once(flight, async () => {
      if (!skipSaved) { const again = await cached<T>(user, key, maxAgeHours); if (again) return { data: again, bought: false }; }
      const o = await withBudget(user, estimateUsd, fetch);
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
        `SELECT keyword_id, device, position, url, checked_on::text AS checked_on, serp_features, local_position, local_pack FROM (
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
          local: l.local_position ?? null, previousLocal: p?.local_position ?? null, pack: Array.isArray(l.local_pack) ? l.local_pack : [] } : null];
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
    let place: { code: number; label: string } | null = null;
    if (input.locationCode && input.locationCode !== site.location_code) {
      place = await locationByCode(input.locationCode);
      if (!place) return res.status(400).json({ message: "Pick the place from the list." });
    }
    const { rows: existing } = await pool.query("SELECT keyword FROM seo_keywords WHERE site_id=$1 AND keyword=ANY($2::text[]) AND coalesce(location_code,0)=$3", [site.id, unique, place?.code ?? 0]);
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
        [site.id, user, keyword, input.tags, v?.searchVolume ?? null, v?.cpc ?? null, v?.difficulty ?? null, place?.code ?? null, place?.label ?? null]);
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
      withBudget(user, estimateAdsVolumeUsd(rows.length), () => adsSearchVolume({ keywords: rows.map((r: any) => r.keyword), locationCode: site.location_code, languageCode: site.language_code })));
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
      withBudget(user, estimateLabsUsd(SUGGESTION_LIMIT), () => labsKeywordSuggestions({ keyword: input.seed, locationCode: input.locationCode, languageCode: input.languageCode, limit: SUGGESTION_LIMIT })));
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
      const o = await withBudget(user, EXPLORER_ESTIMATE_USD, () => fetchDomainReport({ domain, locationCode: input.locationCode, languageCode: input.languageCode }));
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
    const out = await buyOnce<ReportPage>(user, key, `report:${input.table}`, CACHE_HOURS, REPORT_ESTIMATE_USD, () => fetchReportPage(full));
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
      () => fetchKeywordOverview({ keyword, locationCode: input.locationCode, languageCode: input.languageCode }), input.refresh);
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
    const saved = await cached<GapPage>(user, key, CACHE_HOURS);
    if (saved) return res.json({ page: saved, reused: true });
    if (input.peek) return res.status(404).json({ code: "no_report", message: "Not run yet." });
    if (!isConfigured()) return notReady(res);
    const out = await buyOnce<GapPage>(user, key, `gap:${input.kind}`, CACHE_HOURS, gapEstimateUsd(input.kind, competitors.length, limit),
      () => fetchGap({ kind: input.kind, target, competitors, limit, offset, locationCode: input.locationCode, languageCode: input.languageCode }));
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
    const out = await once(`competitors:${user}:${site.id}:${competitor}`, () => withBudget(user, estimateLabsUsd(GAP_LIMIT), () => labsDomainIntersection({ competitor, ours: site.domain, locationCode: site.location_code, languageCode: site.language_code, limit: GAP_LIMIT })));
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
