import { governmentLinksForDisplay, governmentLinksAvailable, canScrapeGovernmentPortal, governmentPermitForDisplay } from "@shared/government-links";
import { getReferralSettings, saveReferralSettings, referralSettingsInput } from "./referral-settings";
import { reserveMonthlyQuota, refundQuota } from "./growth-quotas";
import { isReviewSuppressed, unsubscribeRecipient, resubscribeRecipient } from "./review-suppression";
import { reminderSettingsInput, calculateNextReminderTime, inReminderWindow, canonicalAppOrigin } from "./review-reminders";
import { analyzeReviews, analyzeBsScore, presentListing } from "./competitor-analysis";
import { competitorPlaces, placesResponse } from "./competitor-provider";
import { rateLimit, actorKey, takeBudget } from "./growth-limits";
import { ownedBy } from "./ownership";
import { escapeHtml, oneLine, firstZodMessage, visitorIp, edgeGeo, normalizeBlockedIp, isPublicIpv4, safeRedirectUrl, normalizeTrackedDomain, clickGuardSettingsInput, exclusionListKey, exclusionKeyMatches, placeStreetLine, SOCIAL_PROFILE_KEYS, locationUpdateInput, isOwnerPreview, GOOGLE_REVIEW_LINK_MESSAGE, googleReviewLink } from "./route-guards";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { reviewDraftPrompt } from "./review-draft";
import { scrapeByPlatform, getScrapeProgress, getAllScrapeJobs, startLiveSearch, getLiveSearchJob, scrapePermitDetail } from "./scraper";
import { randomUUID } from "crypto";
import { isIP } from "net";
import multer from "multer";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import OpenAI from "openai";
import { z } from "zod";
import { processPhoto, generateFileName, analyzePhoto } from "./photo-processor";
import { registerStripeRoutes } from "./stripe";
import { registerTrackingRoutes } from "./tracking-script";
import { registerAdsConsultantRoutes } from "./ads-consultant";
import { registerSiteAssistantRoutes } from "./site-assistant";
import { resolveGoogleUrl, resolveGoogleShortUrl, isGoogleUrl, extractPlaceId, extractPlaceName, extractMapsDataCid, extractMapsDataSearchQuery, extractMapsDataKgmid, extractMapsBusinessCoords, hexCidToDecimal } from "./google-url-resolver";
import { scrapeGoogleMapsBusiness } from "./google-maps-scraper";
import { uploadToR2, getFromR2, deleteFromR2, isR2Key, getR2Url } from "./r2";
import { db } from "./db";
import { searchQueries, scrapeSchedules, permitDatabases, subscriptions, competitorScans, competitorListings, businessLocations, citationCampaigns, citations, locationAnalytics, stateGuides, stateGuideSteps, masterClassModules, coursePurchases, insertBusinessLocationSchema, insertCitationCampaignSchema, clickVisits, blockedIps, adSpyKeywords, adSpyResults, seoContracts, reviewRequests, users, betaAccessCodes, googleProfileReviews, mediaFolders, mediaPhotos } from "@shared/schema";
import { sendContractEmail, sendReviewRequestEmail, sendReviewReminderEmail, sendTrialInviteEmail, sendWithFallback, trySend } from "./email";
import { getBaseUrl } from "./auth";
import { eq, and, or, isNull, inArray, desc, asc, gte, lte, sql, count, countDistinct } from "drizzle-orm";
import { isPlatformAdmin as isAdmin } from "./admin";
import { platformGatePassed } from "./crm/admin";
import { aiModel } from "./ai-config";

// SECURITY: local-dev auth bypass (treat anonymous requests as user 1). This is
// deliberately decoupled from NODE_ENV — it requires an explicit opt-in env var
// AND a non-production environment, so copying .env.example onto a deployed box
// can never silently disable authentication. Leave DEV_AUTH_BYPASS_USER1 unset
// everywhere except a developer's own machine.
const DEV_AUTH_BYPASS =
  process.env.DEV_AUTH_BYPASS_USER1 === "true" &&
  process.env.NODE_ENV !== "production";
if (DEV_AUTH_BYPASS) {
  console.warn("⚠️  DEV_AUTH_BYPASS_USER1 is enabled — all requests authenticate as user 1. Never use this in production.");
}

// PUBLIC DEMO mode (demo.constructhub.us): every request is the demo owner.
// Distinct from the dev bypass — it is ALLOWED in production, but only when
// explicitly opted in, and only ever on the isolated demo instance with its
// own throwaway database (seeded fake data, no real users, no Stripe Connect).
// Never set this on the real deployment.
const DEMO_AUTOLOGIN = process.env.CRM_DEMO_AUTOLOGIN === "true";
if (DEMO_AUTOLOGIN) {
  console.warn("⚠️  CRM_DEMO_AUTOLOGIN is enabled — public demo instance, all requests authenticate as user 1.");
}

const growthCostLimit = rateLimit("growth-processing", 30, 60);
// Anonymous contact forms that email staff: 5 per hour per IP (and per signed-in user).
const seoInquiryLimit = rateLimit("seo-inquiry", 5, 5, 3600_000);
const reinstatementLimit = rateLimit("reinstatement", 5, 5, 3600_000);

// Review template links: resolve Google short links, then accept only Google hosts.
async function resolveReviewLink(input: unknown): Promise<string | null> {
  let v = String(input ?? "").trim();
  if (!v || v.length > 2000) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  return googleReviewLink(await resolveGoogleUrl(v));
}

const photoOpenai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const uploadDir = path.join(process.cwd(), "tmp", "photo-uploads");
const processedDir = path.join(process.cwd(), "tmp", "photo-processed");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(processedDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 20, fieldSize: 32 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
    cb(null, allowed.includes(file.mimetype) || file.mimetype.startsWith("image/"));
  },
});

const uploadedFiles = new Map<string, { createdAt: number; originalName: string; path: string; mimetype: string }>();
const processedFiles = new Map<string, { originalName: string; path: string; newName: string }>();

const processedIndexPath = path.join(process.cwd(), "tmp", "photo-processed", "_index.json");
function loadProcessedIndex() {
  try {
    if (!fs.existsSync(processedIndexPath)) return;
    const raw = JSON.parse(fs.readFileSync(processedIndexPath, "utf-8")) as Record<string, { originalName: string; path: string; newName: string }>;
    for (const [id, entry] of Object.entries(raw)) {
      if (entry?.path && fs.existsSync(entry.path)) processedFiles.set(id, entry);
    }
    console.log(`Restored ${processedFiles.size} processed photos from disk index.`);
  } catch (err: any) {
    console.error("Failed to load processed index:", err?.message || err);
  }
}
function saveProcessedIndex() {
  try {
    const obj: Record<string, any> = {};
    for (const [id, entry] of processedFiles.entries()) obj[id] = entry;
    fs.writeFileSync(processedIndexPath, JSON.stringify(obj));
  } catch (err: any) {
    console.error("Failed to save processed index:", err?.message || err);
  }
}
loadProcessedIndex();

type ProcessingJob = {
  owner: string;
  status: "running" | "done" | "error";
  total: number;
  processed: number;
  results: { fileId: string; processedId: string; newName: string }[];
  errors: { fileId: string; error: string }[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
};
const processingJobs = new Map<string, ProcessingJob>();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  if (![...processingJobs.values()].some(job => job.status === "running")) {
    for (const [id, file] of uploadedFiles) if (file.createdAt < cutoff) {
      fs.rmSync(file.path, { force: true }); uploadedFiles.delete(id);
    }
  }
  for (const [id, job] of processingJobs.entries()) {
    if (job.finishedAt && job.finishedAt < cutoff) processingJobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(["/api/photos", "/api/gmb/review-response", "/api/review/:token/generate-review"], (req, res, next) => {
    if (req.method !== "POST") return next();
    return growthCostLimit(req, res, next);
  });
  registerStripeRoutes(app);
  registerTrackingRoutes(app);
  registerAdsConsultantRoutes(app);
  registerSiteAssistantRoutes(app);

  function getDevUser(req: any, res: any): any {
    const user = req.user;
    if (user) return res.locals.agencyOwner ? { ...user, id: res.locals.agencyOwner } : user;
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }

  const { ensureAccountEventsSchema, registerAccountEventRoutes } = await import("./account-events");
  await ensureAccountEventsSchema();
  registerAccountEventRoutes(app, getDevUser);
  const { ensureGbpSchema } = await import("./gbp/schema");
  await ensureGbpSchema();
  const { ensureAgencySchema } = await import("./agency/schema");
  await ensureAgencySchema();
  const { registerAgencyAccess } = await import("./agency/middleware");
  registerAgencyAccess(app);
  const { registerAgencyRoutes } = await import("./agency/routes");
  registerAgencyRoutes(app);
  const { ensureAdsSchema } = await import("./ads/schema");
  await ensureAdsSchema();
  const { registerAdsRoutes } = await import("./ads/routes");
  registerAdsRoutes(app, getDevUser);
  const { startAdsWorker } = await import("./ads/worker");
  startAdsWorker();
  const { ensureCloudflareSearchSchema } = await import("./cloudflare/schema");
  await ensureCloudflareSearchSchema();
  const { registerCloudflareRoutes } = await import("./cloudflare/routes");
  const { registerGscRoutes } = await import("./gsc/routes");
  registerCloudflareRoutes(app, getDevUser);
  registerGscRoutes(app, getDevUser);
  const { startEdgeWorker } = await import("./cloudflare/worker");
  startEdgeWorker();
  const { ensureDomainsSchema } = await import("./domains/schema");
  const { ensureMailAlertsSchema } = await import("./mail-alerts/schema");
  await ensureDomainsSchema();
  await ensureMailAlertsSchema();
  const { registerDomainRoutes } = await import("./domains/routes");
  const { registerMailAlertRoutes } = await import("./mail-alerts/routes");
  const { registerGmailOAuth, startMailWorker } = await import("./mail-alerts/gmail");
  const { cloudflareZoneLinkFor } = await import("./domains/cloudflare-link");
  registerDomainRoutes(app, getDevUser, cloudflareZoneLinkFor);
  registerMailAlertRoutes(app, getDevUser);
  registerGmailOAuth(app, getDevUser);
  const { startDomainWorker } = await import("./domains/service");
  startDomainWorker();
  startMailWorker();
  const { ensureGbpTokenEncryption } = await import("./gbp/token-crypto");
  await ensureGbpTokenEncryption();
  const { ensureAccountSecuritySchema, registerAccountSecurityRoutes } = await import("./account-security");
  await ensureAccountSecuritySchema();
  registerAccountSecurityRoutes(app, getDevUser);
  const { ensureGbpContentSchema, registerContentRoutes, startContentWorker } = await import("./gbp/content");
  await ensureGbpContentSchema();
  registerContentRoutes(app, getDevUser);
  const { registerContentUpload } = await import("./gbp/content-upload");
  registerContentUpload(app, getDevUser);
  startContentWorker();
  const { ensureProfileGuardSchema } = await import("./gbp/guard-schema");
  await ensureProfileGuardSchema();
  const { registerProfileGuardRoutes } = await import("./gbp/guard-routes");
  registerProfileGuardRoutes(app, getDevUser);
  const { startGuardWorker } = await import("./gbp/guard");
  const { startReplyWorker } = await import("./gbp/review-automation");
  startGuardWorker();
  startReplyWorker();
  const { ensureSiteScanSchema } = await import("./sitescan/schema");
  await ensureSiteScanSchema();
  const { registerSiteScanRoutes } = await import("./sitescan/routes");
  registerSiteScanRoutes(app, getDevUser);
  const { startSiteScanWorker } = await import("./sitescan/worker");
  startSiteScanWorker();
  const { registerGbpRoutes } = await import("./gbp/routes");
  registerGbpRoutes(app, getDevUser);
  const { startGbpWorker } = await import("./gbp/service");
  const { startAgencyWorker } = await import("./agency/jobs");
  const { startOnboardingWorker } = await import("./agency/onboarding");
  startAgencyWorker();
  startOnboardingWorker();
  const { ensureSocialSchema } = await import("./social/schema");
  await ensureSocialSchema();
  const { registerSocialRoutes } = await import("./social/routes");
  registerSocialRoutes(app, getDevUser);
  const { startSocialWorker } = await import("./social/service");
  startSocialWorker();

  // CRM tenancy layer (orgs, crews, roles, invitations).
  try {
    const { ensureCrmSchema } = await import("./crm/schema-ensure");
    await ensureCrmSchema();
    const { registerCrmRoutes } = await import("./crm/routes");
    registerCrmRoutes(app, getDevUser);
    const { registerAnalyticsRoutes } = await import("./analytics");
    registerAnalyticsRoutes(app, getDevUser);
  } catch (e: any) {
    console.error("Failed to initialize CRM module:", e?.message || e);
  }

  // Google Local Services Ads (multi-tenant LSA lead system).
  try {
    const { ensureLsaSchema } = await import("./lsa/schema-ensure");
    await ensureLsaSchema();
    const { registerLsaRoutes, startLsaTimers } = await import("./lsa/routes");
    registerLsaRoutes(app, getDevUser);
    startLsaTimers();
  } catch (e: any) {
    console.error("Failed to initialize LSA module:", e?.message || e);
  }

  app.get("/api/counties", async (_req, res) => {
    const counties = await storage.getCounties();
    res.json(counties);
  });

  app.get("/api/databases", async (req, res) => {
    try {
      if (req.query.filtered === "true") {
        const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
        const countyId = parseInt(String(req.query.countyId ?? ""), 10);
        const search = text(req.query.search);
        const params = {
          stateCode: text(req.query.stateCode),
          countyId: Number.isInteger(countyId) && countyId > 0 ? countyId : undefined,
          jurisdictionType: text(req.query.jurisdictionType),
          // LIKE wildcards in user text are literal characters, not patterns.
          search: search?.replace(/[\\%_]/g, "\\$&"),
          page: Math.max(1, parseInt(String(req.query.page ?? ""), 10) || 1),
          limit: Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? ""), 10) || 25)),
        };
        const result = await storage.getDatabasesFiltered(params);
        res.json({ ...result, databases: result.databases.map(governmentPermitForDisplay) });
      } else if (req.query.searchable === "true") {
        // Only portals with a verified live link AND a live-search adapter — the
        // ones a search or a refresh schedule can actually run against.
        const databases = (await storage.getDatabases())
          .filter(d => governmentLinksAvailable(d) && canScrapeGovernmentPortal(d))
          .sort((a, b) => a.name.localeCompare(b.name));
        res.json(databases.map(governmentPermitForDisplay));
      } else {
        const databases = await storage.getDatabases();
        res.json(databases.map(governmentPermitForDisplay));
      }
    } catch (err) {
      console.error("Error listing permit databases:", err);
      res.status(500).json({ message: "Could not load permit databases. Please try again." });
    }
  });

  app.get("/api/databases/counts", async (_req, res) => {
    const counts = await storage.getDatabaseCounts();
    res.json(counts);
  });

  app.get("/api/databases/county/:countyId", async (req, res) => {
    const countyId = parseInt(req.params.countyId);
    const databases = await storage.getDatabasesByCounty(countyId);
    res.json(databases.map(governmentPermitForDisplay));
  });

  const ownerScope = (req: any) => ({ id: req.user.id, admin: isAdmin(req.user) });
  const canReadQuery = async (req: any, id: number) => {
    const [row] = await db.select({ id: searchQueries.id }).from(searchQueries)
      .where(and(eq(searchQueries.id, id), ownedBy(searchQueries.userId, ownerScope(req))));
    return !!row;
  };
  const scrapeOwners = new Map<string, number>();
  app.use(["/api/search", "/api/search-queries", "/api/search-results", "/api/scrape",
    "/api/scrape-schedules", "/api/permit-details", "/api/ranking-grid"], (req, res, next) => {
    if (!getDevUser(req, res)) return;
    next();
  });
  // These schedules refresh the shared permit directory, not personal searches.
  app.use("/api/scrape-schedules", (req, res, next) => {
    if (!isAdmin(req.user)) return res.status(403).json({ message: "Administrator access required" });
    next();
  });

  app.post("/api/search", async (req, res) => {
    try {
      const { searchType, searchValue, scopeCountyId, scopeState } = req.body;
      if (!searchType || !searchValue) {
        return res.status(400).json({ message: "searchType and searchValue are required" });
      }

      const parsedCountyId = scopeCountyId ? parseInt(scopeCountyId) : null;

      const counties = await storage.getCounties();
      const countyMap = new Map(counties.map(c => [c.id, c.name]));

      let databases = await storage.getDatabases();
      if (parsedCountyId) {
        databases = databases.filter(db => db.countyId === parsedCountyId);
      } else if (scopeState && scopeState !== "all") {
        const stateCountyIds = new Set(
          counties.filter(c => c.stateCode === scopeState).map(c => c.id)
        );
        databases = databases.filter(db => stateCountyIds.has(db.countyId));
      }

      const scopeDbIds = new Set(databases.map(db => db.id));
      // Work out what can actually run before charging the search quota.
      const searchable = databases.filter(db => governmentLinksAvailable(db) && canScrapeGovernmentPortal(db));

      const localResults = await storage.searchLocalResults(searchType, searchValue);
      const filteredResults = localResults.filter((r: any) => scopeDbIds.has(r.databaseId));

      if (searchable.length === 0 && filteredResults.length === 0) {
        // Nothing was searched: no quota, no history row, and say so plainly.
        return res.json({
          noSearchablePortals: true,
          searchId: null,
          results: [],
          totalResults: 0,
          source: "none",
          message: "No permit portal in this area supports live search yet. Browse the Directory for the official portal links.",
        });
      }

      // Only a live portal search uses the monthly quota; showing saved results does not.
      if (searchable.length > 0 && !(await reserveMonthlyQuota(req, res, "searches"))) return;
      const query = await storage.createSearchQuery({
        userId: req.user!.id,
        searchType,
        searchValue,
        countyId: parsedCountyId,
      });

      const enrichedResults = filteredResults.map((r: any) => ({
        ...r,
        countyName: r.countyId ? countyMap.get(r.countyId) ?? null : null,
      }));

      const searchId = randomUUID().slice(0, 8);
      startLiveSearch(searchId, query.id, searchType, searchValue, searchable.map(governmentLinksForDisplay) as any)
        .catch((err) => console.error("Live search init error:", err));

      res.json({
        query,
        searchId,
        results: enrichedResults,
        totalResults: filteredResults.length,
        source: filteredResults.length > 0 ? "local" : "none",
        searchablePortals: searchable.length,
      });
    } catch (err: any) {
      console.error("Permit search failed:", err);
      res.status(500).json({ message: "Search failed. Please try again." });
    }
  });

  app.get("/api/search/live/:searchId", async (req, res) => {
    const job = getLiveSearchJob(req.params.searchId);
    if (!job || !(await canReadQuery(req, job.queryId))) {
      return res.status(404).json({ message: "Search job not found" });
    }

    const localResults = await storage.searchLocalResults(job.searchType, job.searchValue);

    const searchDbIds = new Set(job.databases.map(d => d.id));

    const counties = await storage.getCounties();
    const countyMap = new Map(counties.map(c => [c.id, c.name]));

    const filteredResults = localResults.filter((r: any) => searchDbIds.has(r.databaseId));

    const enrichedResults = filteredResults.map((r: any) => ({
      ...r,
      countyName: r.countyId ? countyMap.get(r.countyId) ?? null : null,
    }));

    res.json({
      status: job.status,
      databases: job.databases,
      results: enrichedResults,
      totalResults: enrichedResults.length,
      totalResultsScraped: job.totalResultsFound,
      elapsedMs: Date.now() - job.startedAt,
    });
  });

  app.post("/api/scrape", async (req, res) => {
    try {
      const { databaseId, searchTerm, searchType } = req.body;
      if (!databaseId || !searchTerm) {
        return res.status(400).json({ message: "databaseId and searchTerm are required" });
      }

      const databases = await storage.getDatabases();
      const db = databases.find((d) => d.id === databaseId);
      if (!db) {
        return res.status(404).json({ message: "Database not found" });
      }

      if (!governmentLinksAvailable(db)) {
        return res.status(400).json({ message: "This portal has not been verified as live" });
      }

      if (!db.searchUrl && !db.portalUrl) {
        return res.status(400).json({ message: "This database has no portal URL configured" });
      }

      if (!canScrapeGovernmentPortal(db)) {
        return res.status(400).json({ message: "Automated search is not supported for this portal. Open the official portal to search." });
      }

      if (!(await reserveMonthlyQuota(req, res, "searches"))) return;
      const query = await storage.createSearchQuery({
        userId: req.user!.id,
        searchType: searchType || "address",
        searchValue: searchTerm,
        countyId: db.countyId,
      });

      const jobId = randomUUID().slice(0, 8);
      scrapeOwners.set(jobId, req.user!.id);
      const url = db.searchUrl || db.portalUrl!;
      const platform = db.platform!;

      scrapeByPlatform(platform, url, searchTerm, searchType || "address", db.id, db.name, query.id, jobId)
        .catch((err) => console.error("Scrape error:", err));

      res.json({ jobId, queryId: query.id, message: "Scrape started" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/scrape/status/:jobId", async (req, res) => {
    const progress = getScrapeProgress(req.params.jobId);
    if (!progress || scrapeOwners.get(req.params.jobId) !== req.user!.id) {
      return res.status(404).json({ message: "Job not found" });
    }
    res.json(progress);
  });

  app.get("/api/scrape/jobs", async (req, res) => {
    const jobs = getAllScrapeJobs();
    const arr: any[] = [];
    jobs.forEach((val, key) => { if (scrapeOwners.get(key) === req.user!.id) arr.push({ jobId: key, ...val }); });
    res.json(arr);
  });

  app.post("/api/permit-details/:resultId", async (req, res) => {
    try {
      const resultId = parseInt(req.params.resultId);
      const result = await storage.getSearchResultById(resultId);
      if (!result) {
        return res.status(404).json({ message: "Result not found" });
      }

      const rawData = result.rawData as Record<string, any> | null;
      if (rawData?.permitDetails) {
        return res.json({ details: rawData.permitDetails, cached: true });
      }

      const db = (await storage.getDatabases()).find(d => d.id === result.databaseId);
      if (!db || !db.platform || !db.searchUrl) {
        return res.status(400).json({ message: "Database not configured for detail scraping" });
      }

      const details = await scrapePermitDetail(
        db.platform,
        db.searchUrl,
        result.permitNumber || "",
        rawData
      );

      if (details) {
        await storage.updateSearchResult(resultId, {
          rawData: { ...(rawData || {}), permitDetails: details, detailsFetchedAt: new Date().toISOString() },
        });
      }

      res.json({ details: details || {}, cached: false });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/search-queries", async (req, res) => {
    const queries = await storage.getSearchQueries(ownerScope(req));
    res.json(queries);
  });

  app.delete("/api/search-queries/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    if (!(await canReadQuery(req, id))) return res.status(404).json({ message: "Search not found" });
    await storage.deleteSearchQuery(id);
    res.json({ success: true });
  });

  app.delete("/api/search-queries", async (req, res) => {
    await storage.deleteAllSearchQueries(ownerScope(req));
    res.json({ success: true });
  });

  app.get("/api/search-results/recent", async (req, res) => {
    const results = await storage.getRecentSearchResults(ownerScope(req));
    res.json(results);
  });

  app.get("/api/search-results/:queryId", async (req, res) => {
    const queryId = parseInt(req.params.queryId);
    if (!(await canReadQuery(req, queryId))) return res.status(404).json({ message: "Search not found" });
    const results = await storage.getSearchResults(queryId);
    res.json(results);
  });

  app.get("/api/scrape-schedules", async (_req, res) => {
    const schedules = await storage.getScrapeSchedules();
    res.json(schedules);
  });

  const scheduleInput = z.object({
    databaseId: z.number({ required_error: "Choose a permit portal", invalid_type_error: "Choose a permit portal" }).int().positive("Choose a permit portal"),
    searchType: z.enum(["address", "name", "company", "license", "permit"], { errorMap: () => ({ message: "Choose a search type" }) }),
    searchValue: z.string({ required_error: "Enter what to search for" }).trim().min(1, "Enter what to search for").max(200, "Search value is too long"),
    frequency: z.enum(["daily", "weekly", "monthly"], { errorMap: () => ({ message: "Frequency must be daily, weekly or monthly" }) }).default("daily"),
    isActive: z.boolean().default(true),
  });
  // A schedule can only run against a portal with a verified live link and a live-search adapter.
  async function schedulablePortal(databaseId: number) {
    const [portal] = await db.select().from(permitDatabases).where(eq(permitDatabases.id, databaseId));
    return portal && governmentLinksAvailable(portal) && canScrapeGovernmentPortal(portal) ? portal : null;
  }
  const NOT_SCHEDULABLE = "This portal does not support automated search. Choose a portal from the searchable list.";

  app.post("/api/scrape-schedules", async (req, res) => {
    try {
      const parsed = scheduleInput.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      if (!(await schedulablePortal(parsed.data.databaseId))) return res.status(400).json({ message: NOT_SCHEDULABLE });
      const schedule = await storage.createScrapeSchedule({ ...parsed.data, nextRunAt: new Date() });
      res.json(schedule);
    } catch (err: any) {
      console.error("Error creating scrape schedule:", err);
      res.status(500).json({ message: "Could not save the schedule. Please try again." });
    }
  });

  app.patch("/api/scrape-schedules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) return res.status(404).json({ message: "Schedule not found" });
      const parsed = scheduleInput.partial().strict().safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const changes: Partial<typeof parsed.data> = {};
      for (const [key, value] of Object.entries(parsed.data)) if (key in (req.body ?? {})) (changes as any)[key] = value;
      if (Object.keys(changes).length === 0) return res.status(400).json({ message: "Nothing to update" });
      if (changes.databaseId !== undefined && !(await schedulablePortal(changes.databaseId))) {
        return res.status(400).json({ message: NOT_SCHEDULABLE });
      }
      const updated = await storage.updateScrapeSchedule(id, changes);
      if (!updated) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating scrape schedule:", err);
      res.status(500).json({ message: "Could not update the schedule. Please try again." });
    }
  });

  app.delete("/api/scrape-schedules/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Schedule not found" });
    const removed = await db.delete(scrapeSchedules).where(eq(scrapeSchedules.id, id)).returning({ id: scrapeSchedules.id });
    if (removed.length === 0) return res.status(404).json({ message: "Schedule not found" });
    res.json({ success: true });
  });

  // Scheduled portal refreshes. Every 15 minutes, each due active schedule is
  // claimed atomically (moving nextRunAt forward, so a second server process
  // cannot run it too) and searched once against its portal. Results go into
  // the shared permit cache under a query with no owner, like the directory.
  // lastRunAt is written only after a search actually ran.
  const SCHEDULE_INTERVAL_MS: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 };
  async function runDueScrapeSchedules() {
    const now = new Date();
    const stillDue = or(isNull(scrapeSchedules.nextRunAt), lte(scrapeSchedules.nextRunAt, now));
    const due = await db.select().from(scrapeSchedules)
      .where(and(eq(scrapeSchedules.isActive, true), stillDue)).orderBy(asc(scrapeSchedules.id)).limit(5);
    for (const schedule of due) {
      const nextRunAt = new Date(now.getTime() + (SCHEDULE_INTERVAL_MS[schedule.frequency] ?? SCHEDULE_INTERVAL_MS.daily));
      const [claimed] = await db.update(scrapeSchedules).set({ nextRunAt })
        .where(and(eq(scrapeSchedules.id, schedule.id), eq(scrapeSchedules.isActive, true), stillDue)).returning({ id: scrapeSchedules.id });
      if (!claimed) continue;
      const portal = await schedulablePortal(schedule.databaseId);
      if (!portal) {
        console.warn(`Scrape schedule ${schedule.id}: portal ${schedule.databaseId} is not searchable now; skipped.`);
        continue;
      }
      if (portal.platform === "SmartGov" && !["address", "permit"].includes(schedule.searchType)) {
        console.warn(`Scrape schedule ${schedule.id}: SmartGov portals only support address search; skipped.`);
        continue;
      }
      try {
        const query = await storage.createSearchQuery({ userId: null, searchType: schedule.searchType, searchValue: schedule.searchValue, countyId: portal.countyId });
        const found = await scrapeByPlatform(portal.platform!, (portal.searchUrl || portal.portalUrl)!, schedule.searchValue,
          portal.platform === "SmartGov" ? "address" : schedule.searchType, portal.id, portal.name, query.id, `schedule-${schedule.id}-${Date.now()}`);
        console.log(`Scrape schedule ${schedule.id} ran on ${portal.name}: ${found.length} results.`);
        // A failed attempt is not a run: "Last run" only moves when the portal search completed.
        await db.update(scrapeSchedules).set({ lastRunAt: new Date() }).where(eq(scrapeSchedules.id, schedule.id));
      } catch (err: any) {
        console.error(`Scrape schedule ${schedule.id} failed on ${portal.name}:`, err?.message || err);
      }
    }
  }
  if (process.env.SCRAPE_SCHEDULER_DISABLED !== "true") {
    let scheduleBusy = false;
    const tick = async () => {
      if (scheduleBusy) return;
      scheduleBusy = true;
      try { await runDueScrapeSchedules(); } catch (err) { console.error("Scrape schedule runner failed:", err); }
      finally { scheduleBusy = false; }
    };
    setInterval(tick, 15 * 60 * 1000).unref();
    setTimeout(tick, 60 * 1000).unref();
  }

  app.get("/api/property-appraisers", async (_req, res) => {
    const appraisers = await storage.getPropertyAppraisers();
    const counties = await storage.getCounties();
    const countyMap = new Map(counties.map(c => [c.id, c]));
    const enriched = appraisers.map(a => ({
      ...governmentLinksForDisplay(a),
      county: countyMap.get(a.countyId),
    }));
    res.json(enriched);
  });

  app.get("/api/property-appraisers/county/:countyId", async (req, res) => {
    const countyId = parseInt(req.params.countyId);
    const appraisers = await storage.getPropertyAppraisersByCounty(countyId);
    res.json(appraisers.map(governmentLinksForDisplay));
  });

  app.post("/api/property-lookup", async (req, res) => {
    try {
      const { address, countyId, parcelNumber } = req.body;
      if (!countyId) {
        return res.status(400).json({ message: "countyId is required" });
      }

      let record;
      if (parcelNumber) {
        record = await storage.getPropertyRecordByParcel(countyId, parcelNumber);
      }
      if (!record && address) {
        record = await storage.getPropertyRecordByAddress(countyId, address);
      }

      const appraisers = await storage.getPropertyAppraisersByCounty(countyId);
      const counties = await storage.getCounties();
      const county = counties.find(c => c.id === countyId);

      const lookupLinks = appraisers.map(governmentLinksForDisplay).map(a => ({
        name: a.name,
        portalUrl: a.portalUrl,
        searchUrl: a.searchUrl,
        platform: a.platform,
        linkStatus: a.linkStatus,
        lastVerifiedAt: a.lastVerifiedAt,
      }));

      res.json({
        record: record || null,
        lookupLinks,
        county: county || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/property-records/:countyId", async (req, res) => {
    const countyId = parseInt(req.params.countyId);
    const records = await storage.getPropertyRecords(countyId);
    res.json(records);
  });

  app.post("/api/photos/upload", (req, res, next) => {
    if (uploadedFiles.size >= 200) return res.status(429).json({ message: "Upload storage is busy. Try again later." });
    next();
  }, upload.array("photos", 10), (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const fileIds: { id: string; originalName: string; size: number }[] = [];
      for (const file of files) {
        const fileId = randomUUID().slice(0, 12);
        uploadedFiles.set(fileId, {
          createdAt: Date.now(),
          originalName: file.originalname,
          path: file.path,
          mimetype: file.mimetype,
        });
        fileIds.push({ id: fileId, originalName: file.originalname, size: file.size });
      }

      res.json({ files: fileIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/auto-enhance", async (req, res) => {
    try {
      const { fileId } = req.body;
      if (!fileId) {
        return res.status(400).json({ message: "fileId is required" });
      }
      const uploaded = uploadedFiles.get(fileId);
      if (!uploaded) {
        return res.status(404).json({ message: "File not found. Upload photos first." });
      }
      const filters = await analyzePhoto(uploaded.path);
      res.json(filters);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const watermarkImages = new Map<string, { path: string; mimetype: string }>();

  app.post("/api/photos/upload-watermark", upload.single("watermark"), (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No watermark image uploaded" });
      }
      const wmId = randomUUID().slice(0, 12);
      watermarkImages.set(wmId, { path: file.path, mimetype: file.mimetype });
      res.json({ watermarkId: wmId, originalName: file.originalname, size: file.size });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/business-search", async (req, res) => {
    try {
      const { query, pageToken } = req.body;
      if (!query || query.trim().length < 2) {
        return res.status(400).json({ message: "Search query is required" });
      }

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Google Places API key not configured" });
      }

      const trimmed = query.trim();

      if (isGoogleUrl(trimmed) || /share\.google|maps\.app\.goo\.gl|goo\.gl|g\.page/i.test(trimmed)) {
        const { resolvedUrl, extractedQuery, kgmid, ogTitle, hexCid: resolverHexCid, decimalCid: resolverDecimalCid } = await resolveGoogleShortUrl(trimmed);
        const photoEffectiveUrl = resolvedUrl || trimmed;

        let placeId: string | null = extractPlaceId(photoEffectiveUrl);

        let photoDecimalCid: string | null = resolverDecimalCid;
        let photoUrlQuery: string | null = null;
        try {
          const fullUrl = trimmed.includes("#") ? trimmed : photoEffectiveUrl;
          const hashPart = fullUrl.split("#")[1] || "";
          const rlimmMatch = hashPart.match(/rlimm=(\d+)/);
          if (rlimmMatch) photoDecimalCid = rlimmMatch[1];
          const parsedUrl = new URL(fullUrl.split("#")[0]);
          photoUrlQuery = parsedUrl.searchParams.get("q");
        } catch {}

        const photoHexCid = resolverHexCid || extractMapsDataCid(trimmed) || extractMapsDataCid(photoEffectiveUrl);
        if (!photoDecimalCid && photoHexCid) {
          photoDecimalCid = hexCidToDecimal(photoHexCid);
        }

        const photoMapsQuery = extractMapsDataSearchQuery(trimmed) || extractMapsDataSearchQuery(photoEffectiveUrl);
        const photoBusinessCoords = extractMapsBusinessCoords(trimmed) || extractMapsBusinessCoords(photoEffectiveUrl);

        if (!placeId && photoDecimalCid) {
          try {
            const cidUrl = `https://maps.googleapis.com/maps/api/place/details/json?cid=${photoDecimalCid}&fields=place_id,name,formatted_address,types&key=${apiKey}`;
            const cidRes = await fetch(cidUrl);
            const cidData = await cidRes.json() as any;
            if (cidData.status === "OK" && cidData.result) {
              placeId = cidData.result.place_id;
            }
          } catch {}
        }

        if (!placeId) {
          const placeName = extractPlaceName(photoEffectiveUrl);
          if (placeName) {
            const biasCoords = photoBusinessCoords || (() => {
              const m = photoEffectiveUrl.match(/@([-\d.]+),([-\d.]+)/);
              return m ? { lat: m[1], lng: m[2] } : null;
            })();
            let findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placeName)}&inputtype=textquery&fields=place_id,name,formatted_address,types&key=${apiKey}`;
            if (biasCoords) {
              findUrl += `&locationbias=point:${biasCoords.lat},${biasCoords.lng}`;
            }
            const findRes = await fetch(findUrl);
            const findData = await findRes.json() as any;
            if (findData.candidates?.length) {
              placeId = findData.candidates[0].place_id;
            }
          }
        }

        if (!placeId && photoMapsQuery) {
          const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(photoMapsQuery)}&key=${apiKey}`;
          const searchRes = await fetch(textSearchUrl);
          const searchData = await searchRes.json() as any;
          if (searchData.results?.length > 0) {
            placeId = searchData.results[0].place_id;
          }
        }

        if (placeId) {
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=place_id,name,formatted_address,types&key=${apiKey}`;
          const detailRes = await fetch(detailUrl);
          const detailData = await detailRes.json() as any;
          if (detailData.result) {
            const place = detailData.result;
            const category = (place.types || [])
              .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
              .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
              .slice(0, 2)
              .join(", ") || "";
            return res.json({
              results: [{
                placeId: place.place_id,
                companyName: place.name || "",
                address: place.formatted_address || "",
                category,
              }],
              nextPageToken: null,
            });
          }
        }

        const photoSearchTerm = extractedQuery || photoMapsQuery || photoUrlQuery || extractPlaceName(photoEffectiveUrl) || ogTitle;
        if (photoSearchTerm) {
          const biasParam = photoBusinessCoords
            ? `&locationbias=circle:25000@${photoBusinessCoords.lat},${photoBusinessCoords.lng}`
            : "";
          const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(photoSearchTerm)}&inputtype=textquery&fields=place_id,name,formatted_address,types${biasParam}&key=${apiKey}`;
          try {
            const findRes = await fetch(findUrl);
            const findData = await findRes.json() as any;
            if (findData.candidates?.length > 0) {
              const results = findData.candidates.slice(0, 10).map((place: any) => {
                const category = (place.types || [])
                  .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
                  .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
                  .slice(0, 2)
                  .join(", ") || "";
                return {
                  placeId: place.place_id,
                  companyName: place.name || "",
                  address: place.formatted_address || "",
                  category,
                };
              });
              return res.json({ results, nextPageToken: null });
            }
          } catch {}

          const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(photoSearchTerm)}&key=${apiKey}`;
          const searchRes = await fetch(textSearchUrl);
          const searchData = await searchRes.json() as any;
          if (searchData.results?.length > 0) {
            const results = searchData.results.slice(0, 10).map((place: any) => {
              const category = (place.types || [])
                .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
                .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
                .slice(0, 2)
                .join(", ") || "";
              return {
                placeId: place.place_id,
                companyName: place.name || "",
                address: place.formatted_address || "",
                category,
              };
            });
            return res.json({ results, nextPageToken: null });
          }
        }

        const cleanOgTitle = ogTitle && !/^(Google\s+(Search|Maps)|Maps)$/i.test(ogTitle.trim()) ? ogTitle : null;
        const synthName = extractPlaceName(photoEffectiveUrl) || extractedQuery || cleanOgTitle || photoMapsQuery || photoUrlQuery;
        if (synthName) {
          let scraped: Awaited<ReturnType<typeof scrapeGoogleMapsBusiness>> = null;
          try {
            scraped = await scrapeGoogleMapsBusiness({
              name: synthName,
              mapsUrl: /google\.\w+\/maps/i.test(photoEffectiveUrl) ? photoEffectiveUrl : null,
              kgmid: kgmid || extractMapsDataKgmid(photoEffectiveUrl),
            });
          } catch {}

          let address = scraped?.address || "";
          let lat = scraped?.lat ?? (photoBusinessCoords ? parseFloat(photoBusinessCoords.lat) : undefined);
          let lon = scraped?.lng ?? (photoBusinessCoords ? parseFloat(photoBusinessCoords.lng) : undefined);

          if (!address && lat != null && lon != null) {
            try {
              const revUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${apiKey}`;
              const revRes = await fetch(revUrl);
              const revData = await revRes.json() as any;
              if (revData.results?.length > 0 && !scraped?.serviceAreaBusiness) {
                address = revData.results[0].formatted_address || "";
              }
            } catch {}
          }

          const isSAB = scraped?.serviceAreaBusiness === true && !address;

          return res.json({
            results: [{
              placeId: "",
              companyName: scraped?.name || synthName,
              address,
              phone: scraped?.phone || "",
              website: scraped?.website || "",
              category: scraped?.category || "",
              lat,
              lon,
              synthesized: true,
              serviceAreaBusiness: isSAB,
              needsManualAddress: !address,
            }],
            nextPageToken: null,
          });
        }

        return res.json({ results: [], nextPageToken: null });
      }

      let textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(trimmed)}&region=us&key=${apiKey}`;
      if (pageToken) {
        textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(pageToken)}&key=${apiKey}`;
      }
      const searchRes = await fetch(textSearchUrl);
      const searchData = await searchRes.json() as any;

      if (searchData.status !== "OK" || !searchData.results?.length) {
        if (!pageToken) {
          try {
            const scraped = await scrapeGoogleMapsBusiness({ name: trimmed });
            if (scraped && scraped.name) {
              return res.json({
                results: [{
                  placeId: "",
                  companyName: scraped.name,
                  address: scraped.address || "",
                  phone: scraped.phone || "",
                  website: scraped.website || "",
                  category: scraped.category || "",
                  lat: scraped.lat ?? undefined,
                  lon: scraped.lng ?? undefined,
                  synthesized: true,
                  serviceAreaBusiness: scraped.serviceAreaBusiness,
                  needsManualAddress: !scraped.address,
                }],
                nextPageToken: null,
              });
            }
          } catch {}
        }
        return res.json({ results: [], nextPageToken: null });
      }

      const usResults = searchData.results.filter((place: any) => {
        const addr = (place.formatted_address || "").toUpperCase();
        return addr.includes(", USA") || addr.includes(", US") || /,\s*[A-Z]{2}\s+\d{5}/.test(addr);
      });

      const previews = usResults.map((place: any) => {
        const category = (place.types || [])
          .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
          .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
          .slice(0, 2)
          .join(", ") || "";

        return {
          placeId: place.place_id,
          companyName: place.name || "",
          address: place.formatted_address || "",
          category,
        };
      });

      res.json({ results: previews, nextPageToken: searchData.next_page_token || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/business-details", async (req, res) => {
    try {
      const { placeId } = req.body;
      if (!placeId) {
        return res.status(400).json({ message: "placeId is required" });
      }

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Google Places API key not configured" });
      }

      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,types,address_components,geometry&key=${apiKey}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json() as any;

      if (detailData.status !== "OK" || !detailData.result) {
        return res.status(404).json({ message: "Business details not found" });
      }

      const d = detailData.result;
      let city = "";
      let state = "";
      let county = "";
      if (d.address_components) {
        for (const comp of d.address_components) {
          if (comp.types.includes("locality")) city = comp.long_name;
          if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
          if (comp.types.includes("administrative_area_level_2")) county = comp.long_name;
        }
      }

      const category = (d.types || [])
        .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
        .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))
        .slice(0, 2)
        .join(", ") || "";

      const lat = d.geometry?.location?.lat ?? null;
      const lon = d.geometry?.location?.lng ?? null;

      res.json({
        companyName: d.name || "",
        phone: d.formatted_phone_number || "",
        address: d.formatted_address || "",
        city,
        countyState: [county, state].filter(Boolean).join(", "),
        website: d.website || "",
        category,
        serviceArea: city && state ? `${city}, ${state}` : "",
        lat,
        lon,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/generate-description", async (req, res) => {
    try {
      const { city, county, keyword, service, companyName, website, useAI } = req.body;
      if (!companyName || !service) {
        return res.status(400).json({ message: "companyName and service are required" });
      }

      if (useAI) {
        const prompt = `Generate a short, SEO-optimized photo description (2-3 sentences) for a Google My Business photo. 
Business: ${companyName}${website ? ` (${website})` : ""}
Service: ${service}
${keyword ? `Keyword: ${keyword}` : ""}
${city ? `City: ${city}` : ""}
${county ? `County/Region: ${county}` : ""}

The description should naturally incorporate the service keyword and location. It should describe work being done by the contractor and be suitable for alt text and image metadata. Keep it professional and local-SEO focused. Do not use hashtags or emojis.`;

        const completion = await photoOpenai.chat.completions.create({
          model: aiModel(),
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
          temperature: 0.7,
        });

        const description = completion.choices[0]?.message?.content?.trim() || "";
        res.json({ description });
      } else {
        const templates = [
          `Professional ${service.toLowerCase()} services by ${companyName}${city ? ` in ${city}` : ""}${county ? `, ${county}` : ""}. ${keyword || `Trusted ${service.toLowerCase()} contractor`} delivering quality workmanship and reliable results for residential and commercial clients.`,
          `${companyName} provides expert ${service.toLowerCase()} solutions${city ? ` serving ${city}` : ""}${county ? ` and the ${county} area` : ""}. ${keyword || `Experienced ${service.toLowerCase()} professionals`} committed to exceeding customer expectations on every project.`,
          `Quality ${service.toLowerCase()} work completed by ${companyName}${city ? ` in the ${city} area` : ""}. ${keyword ? `As a leading ${keyword.toLowerCase()}, we` : "We"} take pride in delivering exceptional craftsmanship${county ? ` throughout ${county}` : ""}.`,
          `${keyword || `Top-rated ${service.toLowerCase()} contractor`}${city ? ` in ${city}` : ""}${county ? `, ${county}` : ""}. ${companyName} specializes in premium ${service.toLowerCase()} services with attention to detail and customer satisfaction.`,
          `${companyName} — your trusted ${service.toLowerCase()} experts${city ? ` serving ${city}` : ""}${county ? ` and surrounding ${county} communities` : ""}. ${keyword ? `As your local ${keyword.toLowerCase()}, we deliver` : "We deliver"} outstanding results on every job.`,
        ];
        const idx = Math.floor(Math.random() * templates.length);
        res.json({ description: templates[idx] });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/process", async (req, res) => {
    try {
      const {
        fileIds,
        businessInfo,
        location,
        category,
        selectedKeywords,
        watermarkText,
        watermarkEnabled,
        watermarkType,
        watermarkImageId,
        watermarkOpacity,
        filters,
        descriptions,
        serviceAreas,
        mirrorPhotos,
      } = req.body;

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0 || fileIds.length > 10 || fileIds.some((id: unknown) => typeof id !== "string")) {
        return res.status(400).json({ message: "fileIds array is required" });
      }

      if (fileIds.some((id: string) => !uploadedFiles.has(id))) return res.status(404).json({ message: "Upload every photo before processing." });
      const active = [...processingJobs.values()].filter(job => job.status === "running");
      if (active.length >= 4 || active.some(job => job.owner === actorKey(req))) {
        return res.status(429).json({ message: "Photo processing is busy. Wait for your current job to finish." });
      }
      if (!(await reserveMonthlyQuota(req, res, "photos", fileIds.length))) return;
      // Recheck after the async atomic quota reservation before admitting work.
      const running = [...processingJobs.values()].filter(job => job.status === "running");
      if (running.length >= 4 || running.some(job => job.owner === actorKey(req))) {
        await refundQuota(res, fileIds.length);
        return res.status(429).json({ message: "Photo processing is busy." });
      }
      const jobId = randomUUID().slice(0, 12);
      const results: { fileId: string; processedId: string; newName: string }[] = [];
      const errors: { fileId: string; error: string }[] = [];
      processingJobs.set(jobId, {
        owner: actorKey(req),
        status: "running",
        total: fileIds.length,
        processed: 0,
        results,
        errors,
        startedAt: Date.now(),
      });

      res.json({ jobId, total: fileIds.length });

      (async () => {
       try {
        for (let i = 0; i < fileIds.length; i++) {
        const fileId = fileIds[i];
        const uploaded = uploadedFiles.get(fileId);
        if (!uploaded) {
          errors.push({ fileId, error: "File not found on server" });
          continue;
        }

        try {
          const keyword = selectedKeywords?.[i % (selectedKeywords?.length || 1)] || category || "";
          const service = category || "";
          const serviceAreasArrEarly = Array.isArray(serviceAreas) ? serviceAreas.filter(Boolean) : [];
          const rotatedArea = serviceAreasArrEarly.length > 0
            ? serviceAreasArrEarly[i % serviceAreasArrEarly.length]
            : "";
          const locationStr = rotatedArea
            ? rotatedArea.replace(/,\s*/g, "-")
            : ([location?.city, location?.county].filter(Boolean).join("-") || "");
          const companyName = businessInfo?.name || "Photo";

          const newName = generateFileName(companyName, service, locationStr, keyword, i);
          const processedId = randomUUID().slice(0, 12);
          const outputPath = path.join(processedDir, `${processedId}.jpg`);

          const description = descriptions?.[fileId] || "";

          const companyFullName = businessInfo?.name || "";
          const phone = businessInfo?.phone || "";
          const address = businessInfo?.address || "";
          const website = businessInfo?.website || "";
          const services = businessInfo?.services || category || "";
          const city = location?.city || "";
          const county = location?.county || "";

          const titleText = `${companyFullName} | ${services}`.substring(0, 200);

          const serviceAreasArr = Array.isArray(serviceAreas) ? serviceAreas.filter(Boolean) : [];
          const serviceAreasText = serviceAreasArr.slice(0, 12).join(", ");

          const descriptionText = [
            companyFullName,
            phone ? `Phone: ${phone}` : "",
            address ? `HQ: ${address}` : "",
            city || county ? `Project Location: ${[city, county].filter(Boolean).join(", ")}` : "",
            services ? `Services: ${services}` : "",
            website ? `Website: ${website}` : "",
            keyword ? `Keyword: ${keyword}` : "",
            serviceAreasText ? `Service Area: ${serviceAreasText}` : "",
          ].filter(Boolean).join(" | ");

          const seoTags = [
            city, county, keyword,
            ...(selectedKeywords || []).slice(0, 5),
            ...serviceAreasArr.slice(0, 15),
            services,
            companyFullName,
            website,
          ].filter(Boolean).join(", ");

          await processPhoto({
            inputPath: uploaded.path,
            outputPath,
            watermark: {
              text: watermarkText || businessInfo?.name || "",
              enabled: watermarkEnabled !== false,
              type: watermarkType || "text",
              imagePath: watermarkImageId ? watermarkImages.get(watermarkImageId)?.path : undefined,
              opacity: watermarkOpacity != null ? parseFloat(watermarkOpacity) : 0.85,
            },
            mirror: mirrorPhotos === true,
            filters: (typeof filters === "object" && filters[fileId])
              ? filters[fileId]
              : (filters?.brightness != null ? filters : { brightness: 1.0, contrast: 1.0, saturation: 1.0 }),
            exif: {
              artist: companyFullName,
              copyright: businessInfo?.copyright || `(C) ${new Date().getFullYear()} ${companyFullName}`,
              description: descriptionText,
              title: titleText,
              subject: titleText,
              comment: description,
              tags: seoTags,
              rating: 5,
              keywords: selectedKeywords || [],
              lat: location?.lat ? parseFloat(location.lat) : undefined,
              lon: location?.lon ? parseFloat(location.lon) : undefined,
            },
          });

          processedFiles.set(processedId, {
            originalName: uploaded.originalName,
            path: outputPath,
            newName,
          });

          results.push({ fileId, processedId, newName });
        } catch (photoErr: any) {
          console.error(`Photo processing error for ${fileId}:`, photoErr?.message || photoErr);
          errors.push({ fileId, error: photoErr?.message || "Processing failed" });
        }
        const jobState = processingJobs.get(jobId);
        if (jobState) jobState.processed = i + 1;
      }
        const jobState = processingJobs.get(jobId);
        if (jobState) {
          jobState.status = "done";
          jobState.finishedAt = Date.now();
        }
        saveProcessedIndex();
       } catch (bgErr: any) {
         console.error(`Background processing error for job ${jobId}:`, bgErr?.message || bgErr);
         const jobState = processingJobs.get(jobId);
         if (jobState) {
           jobState.status = "error";
           jobState.error = bgErr?.message || "Processing failed";
           jobState.finishedAt = Date.now();
         }
       } finally {
         await refundQuota(res, fileIds.length - results.length).catch(error => console.error("Photo quota refund failed", error));
       }
      })();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/photos/process/:jobId", (req, res) => {
    const job = processingJobs.get(req.params.jobId);
    if (!job || job.owner !== actorKey(req)) return res.status(404).json({ message: "Job not found" });
    res.json({
      status: job.status,
      total: job.total,
      processed: job.processed,
      results: job.status === "done" ? job.results : undefined,
      errors: job.errors.length > 0 ? job.errors : undefined,
      error: job.error,
    });
  });

  app.get("/api/photos/download/:fileId", (req, res) => {
    const processed = processedFiles.get(req.params.fileId);
    if (!processed || !fs.existsSync(processed.path)) {
      return res.status(404).json({ message: "File not found" });
    }

    res.download(processed.path, processed.newName);
  });

  const downloadTokens = new Map<string, { ids: string[]; createdAt: number }>();
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [t, v] of downloadTokens.entries()) {
      if (v.createdAt < cutoff) downloadTokens.delete(t);
    }
  }, 60 * 1000).unref();

  app.post("/api/photos/download-all/prepare", (req, res) => {
    const { processedIds } = req.body;
    if (!processedIds || !Array.isArray(processedIds) || processedIds.length === 0) {
      return res.status(400).json({ message: "processedIds array is required" });
    }
    const token = randomUUID().slice(0, 16);
    downloadTokens.set(token, { ids: processedIds, createdAt: Date.now() });
    res.json({ token });
  });

  app.get("/api/photos/download-all/:token", async (req, res) => {
    const entry = downloadTokens.get(req.params.token);
    if (!entry) return res.status(404).json({ message: "Download token not found or expired" });
    downloadTokens.delete(req.params.token);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=optimized-photos.zip");

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("error", (err) => {
      console.error("Zip archive error:", err);
      try { res.destroy(err); } catch {}
    });
    archive.pipe(res);

    for (const id of entry.ids) {
      const processed = processedFiles.get(id);
      if (processed && fs.existsSync(processed.path)) {
        archive.file(processed.path, { name: processed.newName });
      }
    }

    try {
      await archive.finalize();
    } catch (err: any) {
      console.error("Zip finalize error:", err?.message || err);
    }
  });

  // Media Library Routes
  app.get("/api/media/folders", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const folders = await db.select().from(mediaFolders).where(eq(mediaFolders.userId, user.id)).orderBy(desc(mediaFolders.createdAt));
      res.json(folders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/media/folders", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { name, clientAddress, lat, lon } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Folder name is required" });
      const [folder] = await db.insert(mediaFolders).values({
        userId: user.id,
        name: name.trim(),
        clientAddress: clientAddress?.trim() || null,
        lat: lat != null ? parseFloat(lat) : null,
        lon: lon != null ? parseFloat(lon) : null,
      }).returning();
      res.json(folder);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/media/folders/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const folderId = parseInt(req.params.id);
      if (isNaN(folderId)) return res.status(400).json({ message: "Invalid folder ID" });
      const { name, clientAddress, lat, lon } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (clientAddress !== undefined) updates.clientAddress = clientAddress?.trim() || null;
      if (lat !== undefined) updates.lat = lat != null ? parseFloat(lat) : null;
      if (lon !== undefined) updates.lon = lon != null ? parseFloat(lon) : null;
      const [folder] = await db.update(mediaFolders).set(updates).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.userId, user.id))).returning();
      if (!folder) return res.status(404).json({ message: "Folder not found" });
      res.json(folder);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/photos/nearby-cities", async (req, res) => {
    try {
      const { lat, lon, radiusMiles, mode, types, density } = req.body as { lat: number; lon: number; radiusMiles: number; mode?: "city" | "county"; types?: string[]; density?: "low" | "medium" | "high" | "max" };
      const densityMode: "low" | "medium" | "high" | "max" = density || "medium";
      const allowedTypes = ["locality", "neighborhood", "administrative_area_level_3", "administrative_area_level_2"];
      let targetTypes: string[] = Array.isArray(types) && types.length > 0
        ? types.filter(t => allowedTypes.includes(t))
        : (mode === "county" ? ["administrative_area_level_2"] : ["locality"]);
      if (targetTypes.length === 0) targetTypes = ["locality"];
      const isCountyOnly = targetTypes.length === 1 && targetTypes[0] === "administrative_area_level_2";
      if (typeof lat !== "number" || typeof lon !== "number") {
        return res.status(400).json({ message: "lat and lon are required" });
      }
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "Places API not configured" });

      const radiusMilesEff = Math.min(50, Math.max(5, (radiusMiles as number) || 10));

      const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 3958.8;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      };

      const densityMul: Record<typeof densityMode, number> = { low: 0.4, medium: 1, high: 1.8, max: 2.8 };
      const mul = densityMul[densityMode];

      const ringMiles = isCountyOnly
        ? [0, 8, 16, 24, 32, 40, 48].filter(d => d <= radiusMilesEff)
        : (densityMode === "low"
            ? [0, 4, 8, 14, 22, 32, 44].filter(d => d <= radiusMilesEff)
            : (densityMode === "max"
                ? [0, 0.75, 1.5, 2.25, 3, 4, 5, 6.5, 8, 10, 13, 16, 20, 24, 30, 36, 42, 48].filter(d => d <= radiusMilesEff)
                : [0, 1.5, 3, 4.5, 6, 8, 10, 13, 16, 20, 24, 30, 36, 42, 48].filter(d => d <= radiusMilesEff)
              )
          );
      const baseSamplesByRing: Record<number, number> = isCountyOnly
        ? { 0: 1, 8: 6, 16: 8, 24: 10, 32: 12, 40: 14, 48: 16 }
        : { 0: 1, 0.75: 6, 1.5: 8, 2.25: 10, 3: 12, 4: 12, 4.5: 14, 5: 14, 6: 16, 6.5: 16, 8: 18, 10: 20, 13: 22, 14: 22, 16: 24, 20: 26, 22: 26, 24: 28, 30: 30, 32: 30, 36: 32, 42: 34, 44: 34, 48: 36 };
      const samplesByRing: Record<number, number> = {};
      for (const r of ringMiles) samplesByRing[r] = r === 0 ? 1 : Math.max(4, Math.round((baseSamplesByRing[r] || 8) * mul));

      const samplePoints: { lat: number; lon: number }[] = [];
      const latPerMile = 1 / 69.0;
      const lonPerMile = 1 / (69.0 * Math.cos((lat * Math.PI) / 180));
      for (const ringDist of ringMiles) {
        const samples = samplesByRing[ringDist] || 8;
        if (ringDist === 0) {
          samplePoints.push({ lat, lon });
          continue;
        }
        for (let i = 0; i < samples; i++) {
          const angle = (2 * Math.PI * i) / samples;
          samplePoints.push({
            lat: lat + Math.sin(angle) * ringDist * latPerMile,
            lon: lon + Math.cos(angle) * ringDist * lonPerMile,
          });
        }
      }

      const seen = new Map<string, { name: string; state: string; lat: number; lon: number; distance: number }>();
      let lastError: string | null = null;
      let successCount = 0;

      const reverseGeocode = async (point: { lat: number; lon: number }, targetType: string) => {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lon}&result_type=${targetType}&key=${apiKey}`;
        const resp = await fetch(url);
        if (!resp.ok) { lastError = `HTTP ${resp.status}`; return; }
        const data = await resp.json() as any;
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          lastError = data.error_message || data.status;
          return;
        }
        successCount++;
        for (const r of data.results || []) {
          let name = "";
          let state = "";
          for (const c of r.address_components || []) {
            if (c.types?.includes(targetType)) name = c.long_name || c.short_name || "";
            if (c.types?.includes("administrative_area_level_1")) state = c.short_name || "";
          }
          if (!name) continue;
          if (targetType === "administrative_area_level_2" && !/county$/i.test(name)) name = `${name} County`;
          const ploc = r.geometry?.location;
          if (!ploc) continue;
          const dist = haversine(lat, lon, ploc.lat, ploc.lng);
          if (dist > radiusMilesEff) continue;
          const key = `${name.toLowerCase()}|${state}`;
          const existing = seen.get(key);
          if (!existing || dist < existing.distance) {
            seen.set(key, { name, state, lat: ploc.lat, lon: ploc.lng, distance: Math.round(dist * 10) / 10 });
          }
        }
      };

      const concurrency = 12;
      const tasks: { p: { lat: number; lon: number }; t: string }[] = [];
      for (const p of samplePoints) {
        for (const t of targetTypes) tasks.push({ p, t });
      }
      for (let i = 0; i < tasks.length; i += concurrency) {
        const batch = tasks.slice(i, i + concurrency);
        await Promise.all(batch.map(({ p, t }) => reverseGeocode(p, t).catch((e: any) => { lastError = e?.message || String(e); })));
      }

      const results = Array.from(seen.values()).sort((a, b) => a.distance - b.distance);
      if (results.length === 0) {
        return res.status(502).json({
          message: lastError ? `Google Geocoding error: ${lastError}` : "No areas found within that radius.",
          results: [],
        });
      }
      res.json({ results, sampledPoints: samplePoints.length, successfulCalls: successCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/media/geocode", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) return res.status(400).json({ message: "Address is required" });
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "Geocoding not configured" });
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const geoRes = await fetch(url);
      const data = await geoRes.json() as any;
      if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
        const loc = data.results[0].geometry.location;
        res.json({ lat: loc.lat, lon: loc.lng, formattedAddress: data.results[0].formatted_address });
      } else {
        res.status(404).json({ message: "Could not find coordinates for this address" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/media/folders/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const folderId = parseInt(req.params.id);
      if (isNaN(folderId)) return res.status(400).json({ message: "Invalid folder ID" });
      const photos = await db.select().from(mediaPhotos).where(and(eq(mediaPhotos.folderId, folderId), eq(mediaPhotos.userId, user.id)));
      for (const photo of photos) {
        if (photo.r2Key) {
          try { await deleteFromR2(photo.r2Key); } catch {}
        }
      }
      await db.delete(mediaPhotos).where(and(eq(mediaPhotos.folderId, folderId), eq(mediaPhotos.userId, user.id)));
      await db.delete(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.userId, user.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/media/folders/:id/photos", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const folderId = parseInt(req.params.id);
      const photos = await db.select().from(mediaPhotos).where(and(eq(mediaPhotos.folderId, folderId), eq(mediaPhotos.userId, user.id))).orderBy(desc(mediaPhotos.createdAt));
      res.json(photos);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/media/photos/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const photoId = parseInt(req.params.id);
      if (isNaN(photoId)) return res.status(400).json({ message: "Invalid photo ID" });
      const [photo] = await db.select().from(mediaPhotos).where(and(eq(mediaPhotos.id, photoId), eq(mediaPhotos.userId, user.id)));
      if (photo?.r2Key) {
        try { await deleteFromR2(photo.r2Key); } catch {}
      }
      await db.delete(mediaPhotos).where(and(eq(mediaPhotos.id, photoId), eq(mediaPhotos.userId, user.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const MEDIA_STORAGE_UNAVAILABLE = "Photo storage is unavailable right now. Please try again later.";
  app.post("/api/media/save-processed", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { folderId, files } = req.body;
      if (!folderId || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ message: "folderId and files are required" });
      }
      const folder = await db.select().from(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.userId, user.id)));
      if (folder.length === 0) return res.status(404).json({ message: "Folder not found" });

      const fid = parseInt(folderId);
      if (isNaN(fid)) return res.status(400).json({ message: "Invalid folderId" });

      const saved = [];
      for (const file of files) {
        if (!file.processedId || typeof file.processedId !== "string") continue;
        const processed = processedFiles.get(file.processedId);
        if (!processed || !fs.existsSync(processed.path)) continue;

        const buffer = fs.readFileSync(processed.path);
        const r2Key = await uploadToR2(buffer, "image/jpeg", "media", "jpg");
        const url = getR2Url(r2Key);
        const [photo] = await db.insert(mediaPhotos).values({
          userId: user.id,
          folderId: fid,
          name: processed.newName || file.fileName || "photo.jpg",
          url,
          r2Key,
          size: buffer.length,
        }).returning();
        saved.push(photo);
      }

      if (saved.length === 0) {
        return res.status(400).json({ message: "No valid processed files found. Photos may have expired — try processing them again." });
      }

      res.json({ saved, count: saved.length });
    } catch (err: any) {
      // Storage errors carry internal hostnames and SDK text — log them, show a plain message.
      console.error("Media library save failed:", err);
      res.status(500).json({ message: MEDIA_STORAGE_UNAVAILABLE });
    }
  });

  app.post("/api/media/upload", upload.array("photos", 10), async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const files = req.files as Express.Multer.File[];
      const folderId = parseInt(req.body.folderId);
      if (!files || files.length === 0) return res.status(400).json({ message: "No files uploaded" });
      if (isNaN(folderId)) return res.status(400).json({ message: "folderId is required" });

      const folder = await db.select().from(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.userId, user.id)));
      if (folder.length === 0) return res.status(404).json({ message: "Folder not found" });

      const saved = [];
      for (const file of files) {
        const buffer = fs.readFileSync(file.path);
        const ext = path.extname(file.originalname).replace(".", "") || "jpg";
        const r2Key = await uploadToR2(buffer, file.mimetype, "media", ext);
        const url = getR2Url(r2Key);
        const [photo] = await db.insert(mediaPhotos).values({
          userId: user.id,
          folderId,
          name: file.originalname,
          url,
          r2Key,
          size: file.size,
        }).returning();
        saved.push(photo);
        try { fs.unlinkSync(file.path); } catch {}
      }
      res.json({ saved, count: saved.length });
    } catch (err: any) {
      // Storage errors carry internal hostnames and SDK text — log them, show a plain message.
      console.error("Media library save failed:", err);
      res.status(500).json({ message: MEDIA_STORAGE_UNAVAILABLE });
    }
  });

  app.patch("/api/media/photos/:id/rename", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const photoId = parseInt(req.params.id);
      if (isNaN(photoId)) return res.status(400).json({ message: "Invalid photo ID" });
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: "Name is required" });
      const [photo] = await db.update(mediaPhotos).set({ name: name.trim() }).where(and(eq(mediaPhotos.id, photoId), eq(mediaPhotos.userId, user.id))).returning();
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      res.json(photo);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const GENERIC_PLACE_TYPES = new Set(["establishment", "point_of_interest", "premise", "political", "store", "food", "health", "finance", "place_of_worship", "local_government_office"]);
  // GMB Edit Monitoring Routes
  app.get("/api/gmb/listings", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const listings = await storage.getGmbListings(user.id);
      res.json(listings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmb/listings", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { placeId, businessName, address, phone, website, category } = req.body;
      if (!placeId || !businessName) {
        return res.status(400).json({ message: "placeId and businessName are required" });
      }
      const listing = await storage.createGmbListing({
        userId: user.id,
        placeId,
        businessName,
        address: address || null,
        phone: phone || null,
        website: website || null,
        category: category || null,
        hours: null,
        photoCount: null,
        rating: null,
        reviewCount: null,
        isMonitoring: true,
        lastCheckedAt: null,
      });
      res.json(listing);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmb/listings/:id/check", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const listing = await storage.getGmbListingById(parseInt(req.params.id));
      if (!listing || listing.userId !== user.id) {
        return res.status(404).json({ message: "Listing not found" });
      }

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "Google Places API key not configured" });

      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${listing.placeId}&fields=name,formatted_address,formatted_phone_number,website,types,opening_hours,photos,rating,user_ratings_total&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);
      const detailsData = await detailsRes.json();

      if (detailsData.status !== "OK" || !detailsData.result) {
        return res.status(400).json({ message: "Could not fetch listing details" });
      }

      const r = detailsData.result;
      // Places "types" are raw ids ("roofing_contractor", "establishment"). Use the
      // specific ones as readable labels, and keep the listing's own category when
      // it already names one of them (or when Google only returns generic types).
      const typeLabels: string[] = (Array.isArray(r.types) ? r.types : [])
        .filter((t: string) => !GENERIC_PLACE_TYPES.has(t))
        .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));
      const knownCategory = listing.category && (typeLabels.length === 0
        || typeLabels.some(label => listing.category!.toLowerCase().includes(label.toLowerCase())));
      const category = knownCategory ? listing.category : (typeLabels[0] || listing.category || null);
      const currentData: Record<string, string | null> = {
        businessName: r.name || null,
        address: r.formatted_address || null,
        phone: r.formatted_phone_number || null,
        website: r.website || null,
        category,
        hours: r.opening_hours?.weekday_text?.join("; ") || null,
        photoCount: r.photos?.length?.toString() || null,
        rating: r.rating?.toString() || null,
        reviewCount: r.user_ratings_total?.toString() || null,
      };

      const previousData: Record<string, string | null> = {
        businessName: listing.businessName,
        address: listing.address,
        phone: listing.phone,
        website: listing.website,
        category: listing.category,
        hours: listing.hours,
        photoCount: listing.photoCount?.toString() || null,
        rating: listing.rating,
        reviewCount: listing.reviewCount?.toString() || null,
      };

      const changes: Array<{ field: string; oldVal: string | null; newVal: string | null }> = [];

      if (listing.lastCheckedAt) {
        for (const [field, newVal] of Object.entries(currentData)) {
          const oldVal = previousData[field] ?? null;
          if (oldVal !== newVal) {
            changes.push({ field, oldVal, newVal });
            await storage.createGmbEditHistory({
              listingId: listing.id,
              fieldChanged: field,
              oldValue: oldVal,
              newValue: newVal,
            });
          }
        }
      }

      await storage.updateGmbListing(listing.id, {
        businessName: currentData.businessName || listing.businessName,
        address: currentData.address,
        phone: currentData.phone,
        website: currentData.website,
        category: currentData.category,
        hours: currentData.hours,
        photoCount: currentData.photoCount ? parseInt(currentData.photoCount) : null,
        rating: currentData.rating,
        reviewCount: currentData.reviewCount ? parseInt(currentData.reviewCount) : null,
        lastCheckedAt: new Date(),
      });

      // The first check only records Google's current data as the baseline; it
      // compares nothing, so it must not be reported as "no changes".
      res.json({ changes, currentData, baseline: !listing.lastCheckedAt });
    } catch (err: any) {
      console.error("GMB listing check failed:", err);
      res.status(500).json({ message: "Could not check this listing right now. Please try again." });
    }
  });

  app.get("/api/gmb/listings/:id/history", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const listing = await storage.getGmbListingById(parseInt(req.params.id));
      if (!listing || listing.userId !== user.id) {
        return res.status(404).json({ message: "Listing not found" });
      }
      const history = await storage.getGmbEditHistory(listing.id);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/gmb/listings/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const listing = await storage.getGmbListingById(parseInt(req.params.id));
      if (!listing || listing.userId !== user.id) {
        return res.status(404).json({ message: "Listing not found" });
      }
      await storage.deleteGmbListing(listing.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmb/review-response", async (req, res) => {
    try {
      const { reviewText, businessName, tone, reviewerName } = req.body;
      if (!reviewText) return res.status(400).json({ message: "reviewText is required" });

      const toneInstruction = tone === "empathetic"
        ? "Be empathetic and apologetic while remaining professional."
        : tone === "grateful"
        ? "Be grateful and warm, thanking the customer enthusiastically."
        : "Be professional, kind, and constructive.";

      const response = await photoOpenai.chat.completions.create({
        model: aiModel(),
        messages: [
          {
            role: "system",
            content: `You are a professional review response writer for a construction/contractor business called "${businessName || "our company"}". Write a response to a customer review. 

Rules:
- ${toneInstruction}
- NEVER be rude, condescending, or aggressive — even if the review is unfair
- Naturally include 1-2 relevant industry keywords (e.g., "quality craftsmanship", "professional service", "home improvement") for SEO
- Keep it concise (2-4 sentences)
- Address the reviewer by name if provided
- If it's a negative review, acknowledge their concern, offer to resolve it offline, and invite them to contact you directly
- If it's a positive review, thank them and mention the type of work done if apparent
- Remember: other potential customers will read this response — always look professional`
          },
          {
            role: "user",
            content: `Customer${reviewerName ? ` "${reviewerName}"` : ""} left this review:\n\n"${reviewText}"\n\nWrite a professional response.`
          }
        ],
        max_tokens: 300,
      });

      const generatedResponse = response.choices[0]?.message?.content || "Thank you for your feedback. We value your business and strive to provide the best service possible.";
      res.json({ response: generatedResponse });
    } catch (err: any) {
      console.error("Review response generation failed:", err);
      res.status(500).json({ message: "Failed to generate response" });
    }
  });

  app.post("/api/ranking-grid/geocode", async (req, res) => {
    try {
      const { placeId } = req.body;
      if (!placeId) return res.status(400).json({ message: "placeId required" });

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "API key not configured" });

      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${apiKey}`;
      const detailRes = await fetch(url);
      const data = await detailRes.json() as any;

      if (data.status === "OK" && data.result?.geometry?.location) {
        res.json({ lat: data.result.geometry.location.lat, lon: data.result.geometry.location.lng });
      } else {
        res.status(404).json({ message: "Could not geocode" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ranking-grid/map/:scanId", async (req, res) => {
    try {
      const scan = await storage.getRankingGridScanById(parseInt(req.params.scanId), ownerScope(req));
      if (!scan) return res.status(404).json({ message: "Scan not found" });

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "API key not configured" });

      const centerLat = parseFloat(scan.lat);
      const centerLon = parseFloat(scan.lon);
      const gridSize = scan.gridSize;
      const distanceMiles = parseFloat(scan.gridDistance);
      const totalSpanMiles = (gridSize - 1) * distanceMiles;

      let zoom = 14;
      if (req.query.zoom) {
        zoom = Math.max(1, Math.min(20, parseInt(req.query.zoom as string)));
      } else {
        if (totalSpanMiles <= 1) zoom = 15;
        else if (totalSpanMiles <= 2) zoom = 14;
        else if (totalSpanMiles <= 5) zoom = 13;
        else if (totalSpanMiles <= 10) zoom = 12;
        else if (totalSpanMiles <= 20) zoom = 11;
        else zoom = 10;
      }

      const width = Math.min(parseInt(req.query.w as string) || 640, 1280);
      const height = Math.min(parseInt(req.query.h as string) || 640, 1280);

      const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLon}&zoom=${zoom}&size=${width}x${height}&maptype=roadmap&style=feature:all|saturation:-20&key=${apiKey}`;

      const mapRes = await fetch(staticUrl);
      if (!mapRes.ok) {
        return res.status(502).json({ message: "Failed to fetch map" });
      }

      res.setHeader("Content-Type", mapRes.headers.get("content-type") || "image/png");
      res.setHeader("Cache-Control", "private, max-age=3600");
      const buffer = await mapRes.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Ranking Grid Routes
  app.get("/api/ranking-grid/scans", async (req, res) => {
    if (!getDevUser(req, res)) return;
    try {
      const scans = await storage.getRankingGridScans(ownerScope(req));
      res.json(scans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ranking-grid/scans/:id", async (req, res) => {
    if (!getDevUser(req, res)) return;
    try {
      const scan = await storage.getRankingGridScanById(parseInt(req.params.id), ownerScope(req));
      if (!scan) return res.status(404).json({ message: "Scan not found" });
      const results = await storage.getRankingGridResults(scan.id);
      res.json({ scan, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ranking-grid/scans", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { businessName, placeId, address, lat, lon, gridSize, gridDistance, keyword } = req.body;
      if (!businessName || !placeId || !lat || !lon || !keyword) {
        return res.status(400).json({ message: "businessName, placeId, lat, lon, and keyword are required" });
      }

      if (![3, 5, 7, 9, 11, 13, 15].includes(Number(gridSize || 3)) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180 || !(Number(gridDistance || 1) > 0 && Number(gridDistance || 1) <= 20)) {
        return res.status(400).json({ message: "Invalid grid size, coordinates or spacing" });
      }

      {
        const [sub] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, user.id))
          .limit(1);

        if (sub && sub.status === "trialing") {
          const existingScans = await storage.getRankingGridScans({ id: user.id, admin: false });
          if (existingScans.length >= 1) {
            return res.status(403).json({ message: "Free trial is limited to 1 GMB Ranking Grid report. Upgrade your plan for unlimited scans." });
          }
        }
      }

      if (!(await reserveMonthlyQuota(req, res, "rankings"))) return;
      const scan = await storage.createRankingGridScan({
        userId: user.id,
        businessName,
        placeId,
        address: address || null,
        lat: String(lat),
        lon: String(lon),
        gridSize: gridSize || 3,
        gridDistance: String(gridDistance || "1"),
        keyword,
        status: "running",
        averageRank: null,
      });

      runRankingGridScan(scan.id, placeId, parseFloat(lat), parseFloat(lon), gridSize || 3, parseFloat(gridDistance || "1"), keyword)
        .catch(err => console.error("Ranking grid scan error:", err));

      res.json(scan);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/ranking-grid/scans/:id", async (req, res) => {
    if (!getDevUser(req, res)) return;
    try {
      const scan = await storage.getRankingGridScanById(parseInt(req.params.id), ownerScope(req));
      if (!scan) return res.status(404).json({ message: "Scan not found" });
      await storage.deleteRankingGridScan(scan.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function runRankingGridScan(scanId: number, targetPlaceId: string, centerLat: number, centerLon: number, gridSize: number, distanceMiles: number, keyword: string) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      await storage.updateRankingGridScan(scanId, { status: "failed" });
      return;
    }

    try {
      const milesToDeg = 1 / 69.0;
      const half = Math.floor(gridSize / 2);
      const points: Array<{ row: number; col: number; lat: number; lon: number }> = [];

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const offsetRow = row - half;
          const offsetCol = col - half;
          const ptLat = centerLat + (offsetRow * distanceMiles * milesToDeg);
          const ptLon = centerLon + (offsetCol * distanceMiles * milesToDeg / Math.cos(centerLat * Math.PI / 180));
          points.push({ row, col, lat: ptLat, lon: ptLon });
        }
      }

      let totalRanked = 0;
      let rankSum = 0;

      for (const pt of points) {
        try {
          const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(keyword)}&location=${pt.lat},${pt.lon}&radius=5000&key=${apiKey}`;
          const searchRes = await fetch(searchUrl);
          const searchData = await searchRes.json() as any;

          let rank: number | null = null;
          let totalResults = 0;
          const topCompetitors: Array<{ name: string; address: string; rank: number }> = [];

          if (searchData.status === "OK" && searchData.results) {
            totalResults = searchData.results.length;
            for (let i = 0; i < searchData.results.length; i++) {
              const place = searchData.results[i];
              if (i < 5) {
                topCompetitors.push({
                  name: place.name || "",
                  address: place.formatted_address || "",
                  rank: i + 1,
                });
              }
              if (place.place_id === targetPlaceId) {
                rank = i + 1;
              }
            }
          }

          await storage.createRankingGridResult({
            scanId,
            gridRow: pt.row,
            gridCol: pt.col,
            lat: String(pt.lat),
            lon: String(pt.lon),
            rank,
            totalResults,
            topCompetitors,
          });

          if (rank !== null) {
            totalRanked++;
            rankSum += rank;
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
          await storage.createRankingGridResult({
            scanId,
            gridRow: pt.row,
            gridCol: pt.col,
            lat: String(pt.lat),
            lon: String(pt.lon),
            rank: null,
            totalResults: 0,
            topCompetitors: null,
          });
        }
      }

      const avgRank = totalRanked > 0 ? (rankSum / totalRanked).toFixed(1) : null;
      await storage.updateRankingGridScan(scanId, {
        status: "completed",
        averageRank: avgRank,
      });
    } catch (err) {
      await storage.updateRankingGridScan(scanId, { status: "failed" });
    }
  }

  app.patch("/api/gmb/listings/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const listing = await storage.getGmbListingById(parseInt(req.params.id));
      if (!listing || listing.userId !== user.id) {
        return res.status(404).json({ message: "Listing not found" });
      }
      const updated = await storage.updateGmbListing(listing.id, {
        isMonitoring: req.body.isMonitoring,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Competitor Intelligence Routes (Gold and Platinum)
  async function requirePlatinum(req: any, res: any): Promise<boolean> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: "Login required" }); return false;
    }
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
    if (!sub || !["gold", "platinum"].includes(sub.plan) || (sub.status !== "active" && sub.status !== "trialing")) {
      if (DEV_AUTH_BYPASS) return true;
      res.status(403).json({ message: "Competitor Intelligence requires a Gold or Platinum membership. Upgrade your plan to access this feature." });
      return false;
    }
    return true;
  }

  app.get("/api/competitors/scans", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const scans = await db.select().from(competitorScans).where(eq(competitorScans.userId, userId)).orderBy(desc(competitorScans.createdAt));
      res.json(scans);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/competitors/scans/:id", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const scanId = parseInt(req.params.id);
      const [scan] = await db.select().from(competitorScans).where(and(eq(competitorScans.id, scanId), eq(competitorScans.userId, userId)));
      if (!scan) return res.status(404).json({ message: "Scan not found" });
      const listings = await db.select().from(competitorListings).where(eq(competitorListings.scanId, scanId)).orderBy(desc(competitorListings.rating));
      res.json({ scan, listings: listings.map(presentListing) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/competitors/scans", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const parsed = z.object({ industry: z.string().trim().min(1).max(120), location: z.string().trim().min(1).max(250), radius: z.number().int().min(1).max(100).default(25) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Provide industry, location and a radius from 1 to 100 miles." });
      const { industry, location, radius } = parsed.data;
      const lat = null, lon = null;

      const [scan] = await db.insert(competitorScans).values({
        userId,
        industry,
        location,
        lat: lat || null,
        lon: lon || null,
        radius: radius || 25,
        status: "running",
      }).returning();

      runCompetitorScan(scan.id, userId, industry, location, lat, lon, radius || 25)
        .catch(err => console.error("Competitor scan error:", err));

      res.json(scan);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/competitors/scans/:id", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const scanId = parseInt(req.params.id);
      const [scan] = await db.select().from(competitorScans).where(and(eq(competitorScans.id, scanId), eq(competitorScans.userId, userId)));
      if (!scan) return res.status(404).json({ message: "Scan not found" });
      await db.delete(competitorListings).where(eq(competitorListings.scanId, scanId));
      await db.delete(competitorScans).where(eq(competitorScans.id, scanId));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // No ad data source exists: runAdSpyScan builds "ads" from Google Places
  // listings, i.e. fabricated data. Refuse the whole surface until a real
  // source is wired (client flag: SHOW_AD_ACTIVITY).
  app.use("/api/ad-spy", (_req, res) => {
    res.status(410).json({ message: "Ad activity is unavailable until a real ad data source is connected." });
  });

  app.get("/api/ad-spy/keywords", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const keywords = await db.select().from(adSpyKeywords).where(eq(adSpyKeywords.userId, userId)).orderBy(desc(adSpyKeywords.createdAt));
      const keywordsWithStats = await Promise.all(keywords.map(async (kw) => {
        const results = await db.select().from(adSpyResults).where(eq(adSpyResults.keywordId, kw.id));
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const sevenDays = 7 * oneDay;
        const thirtyDays = 30 * oneDay;
        const day1 = results.filter(r => now - new Date(r.seenAt).getTime() < oneDay);
        const day7 = results.filter(r => now - new Date(r.seenAt).getTime() < sevenDays);
        const day30 = results.filter(r => now - new Date(r.seenAt).getTime() < thirtyDays);
        const unique1 = new Set(day1.map(r => r.advertiserDomain || r.advertiserName)).size;
        const unique7 = new Set(day7.map(r => r.advertiserDomain || r.advertiserName)).size;
        const unique30 = new Set(day30.map(r => r.advertiserDomain || r.advertiserName)).size;
        const uniqueAll = new Set(results.map(r => r.advertiserDomain || r.advertiserName)).size;
        return { ...kw, advertisers1Day: unique1, advertisers7Day: unique7, advertisers30Day: unique30, totalAdvertisers: uniqueAll };
      }));
      res.json(keywordsWithStats);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/ad-spy/keywords", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const { keyword, location, device } = req.body;
      if (!keyword || !location) return res.status(400).json({ message: "keyword and location are required" });
      const existing = await db.select().from(adSpyKeywords).where(eq(adSpyKeywords.userId, userId));
      if (existing.length >= 10) return res.status(400).json({ message: "Maximum 10 keywords allowed" });
      const [kw] = await db.insert(adSpyKeywords).values({
        userId,
        keyword: keyword.toLowerCase().trim(),
        location: location.trim(),
        device: device || "mobile",
      }).returning();
      await runAdSpyScan(kw.id, keyword, location, device || "mobile");
      res.json(kw);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/ad-spy/keywords/:id", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const keywordId = parseInt(req.params.id);
      const [kw] = await db.select().from(adSpyKeywords).where(and(eq(adSpyKeywords.id, keywordId), eq(adSpyKeywords.userId, userId)));
      if (!kw) return res.status(404).json({ message: "Keyword not found" });
      await db.delete(adSpyResults).where(eq(adSpyResults.keywordId, keywordId));
      await db.delete(adSpyKeywords).where(eq(adSpyKeywords.id, keywordId));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/ad-spy/keywords/:id/advertisers", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const keywordId = parseInt(req.params.id);
      const [kw] = await db.select().from(adSpyKeywords).where(and(eq(adSpyKeywords.id, keywordId), eq(adSpyKeywords.userId, userId)));
      if (!kw) return res.status(404).json({ message: "Keyword not found" });
      const results = await db.select().from(adSpyResults).where(eq(adSpyResults.keywordId, keywordId)).orderBy(desc(adSpyResults.seenAt));
      const grouped: Record<string, { advertiserName: string; advertiserDomain: string | null; ads: any[]; firstSeen: string; lastSeen: string; totalAppearances: number }> = {};
      for (const r of results) {
        const key = r.advertiserDomain || r.advertiserName;
        if (!grouped[key]) {
          grouped[key] = { advertiserName: r.advertiserName, advertiserDomain: r.advertiserDomain, ads: [], firstSeen: r.seenAt.toISOString(), lastSeen: r.seenAt.toISOString(), totalAppearances: 0 };
        }
        grouped[key].totalAppearances++;
        if (new Date(r.seenAt) < new Date(grouped[key].firstSeen)) grouped[key].firstSeen = r.seenAt.toISOString();
        if (new Date(r.seenAt) > new Date(grouped[key].lastSeen)) grouped[key].lastSeen = r.seenAt.toISOString();
        if (grouped[key].ads.length < 5) {
          grouped[key].ads.push({ headline: r.adHeadline, description: r.adDescription, displayUrl: r.displayUrl, position: r.position, device: r.device, seenAt: r.seenAt });
        }
      }
      res.json(Object.values(grouped).sort((a, b) => b.totalAppearances - a.totalAppearances));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/ad-spy/keywords/:id/refresh", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const userId = (req as any).user.id;
      const keywordId = parseInt(req.params.id);
      const [kw] = await db.select().from(adSpyKeywords).where(and(eq(adSpyKeywords.id, keywordId), eq(adSpyKeywords.userId, userId)));
      if (!kw) return res.status(404).json({ message: "Keyword not found" });
      await runAdSpyScan(kw.id, kw.keyword, kw.location, kw.device);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  async function runAdSpyScan(keywordId: number, keyword: string, location: string, device: string) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return;

    try {
      const query = `${keyword} ${location}`;
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      const searchRes = await fetch(url);
      const data = await searchRes.json() as any;

      if (data.results && data.results.length > 0) {
        const topResults = data.results.slice(0, 8);
        for (let i = 0; i < topResults.length; i++) {
          const place = topResults[i];
          let website: string | null = null;
          try {
            const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=website&key=${apiKey}`;
            const detailRes = await fetch(detailUrl);
            const detailData = await detailRes.json() as any;
            if (detailData.result?.website) {
              website = detailData.result.website;
            }
            await new Promise(r => setTimeout(r, 100));
          } catch (e) {}

          let domain: string | null = null;
          if (website) {
            try { domain = new URL(website).hostname.replace(/^www\./, ""); } catch {}
          }

          await db.insert(adSpyResults).values({
            keywordId,
            advertiserName: place.name || "Unknown",
            advertiserDomain: domain,
            adHeadline: `${place.name} - ${keyword} in ${location}`,
            adDescription: place.formatted_address || null,
            displayUrl: website,
            position: i + 1,
            device,
          });
        }
      }
    } catch (err) {
      console.error("Ad spy scan error:", err);
    }
  }

  async function runCompetitorScan(scanId: number, userId: number, industry: string, location: string, lat: string | null, lon: string | null, radius: number) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      await db.update(competitorScans).set({ status: "failed", errorMessage: "Google Places is not configured." }).where(eq(competitorScans.id, scanId));
      return;
    }

    try {
      const found = await competitorPlaces(industry, location, radius, apiKey);
      const allPlaces = found.places;
      await db.update(competitorScans).set({ lat: String(found.center.lat), lon: String(found.center.lng), errorMessage: null }).where(eq(competitorScans.id, scanId));

      for (const place of allPlaces) {
        let detailReviews: any[] = [];
        let phone: string | null = null;
        let website: string | null = null;

        try {
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=reviews,formatted_phone_number,website&key=${apiKey}`;
          const detailData = await placesResponse(detailUrl, "Competitor details");
          if (detailData.result) {
            detailReviews = detailData.result.reviews || [];
            phone = detailData.result.formatted_phone_number || null;
            website = detailData.result.website || null;
          }
          await new Promise(r => setTimeout(r, 200));
        } catch (e) { throw e; }

        const reviewAnalysis = analyzeReviews(detailReviews, place, industry);
        const bsAnalysis = analyzeBsScore(place, reviewAnalysis);

        await db.insert(competitorListings).values({
          scanId,
          userId,
          placeId: place.place_id,
          businessName: place.name || "Unknown",
          address: place.formatted_address || null,
          phone,
          website,
          rating: place.rating ? String(place.rating) : null,
          reviewCount: place.user_ratings_total || 0,
          category: (place.types || []).filter((t: string) => !["point_of_interest", "establishment"].includes(t)).map((t: string) => t.replace(/_/g, " ")).slice(0, 2).join(", "),
          isNew: false,
          bsScore: bsAnalysis.score,
          bsReasons: bsAnalysis.reasons,
          reviewAnalysis,
          rankHistory: [{ rank: allPlaces.indexOf(place) + 1, date: new Date().toISOString() }],
        });
      }

      await db.update(competitorScans).set({ status: "completed", totalFound: allPlaces.length }).where(eq(competitorScans.id, scanId));
    } catch (err: any) {
      console.error("Competitor scan failed:", err);
      await db.delete(competitorListings).where(eq(competitorListings.scanId, scanId));
      await db.update(competitorScans).set({ status: "failed", totalFound: 0, errorMessage: err.message || "Provider request failed." }).where(eq(competitorScans.id, scanId));
    }
  }

  async function requirePremiumPlus(req: any, res: any): Promise<boolean> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: "Login required" }); return false;
    }
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
    if (!sub || !["premium", "gold", "platinum"].includes(sub.plan) || (sub.status !== "active" && sub.status !== "trialing")) {
      if (DEV_AUTH_BYPASS) return true;
      res.status(403).json({ message: "This feature requires a Premium, Gold, or Platinum plan. Upgrade to access it." });
      return false;
    }
    return true;
  }

  app.get("/api/locations", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const locations = await db.select().from(businessLocations).where(eq(businessLocations.userId, user.id)).orderBy(desc(businessLocations.createdAt));
      res.json(locations);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/locations/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [location] = await db.select().from(businessLocations).where(and(eq(businessLocations.id, id), eq(businessLocations.userId, user.id)));
      if (!location) return res.status(404).json({ message: "Location not found" });
      res.json(location);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/locations", async (req, res) => {
    if (!(await requirePlatinum(req, res))) return;
    try {
      const user = (req as any).user;
      const parsed = insertBusinessLocationSchema.omit({ gbpAccountName: true, gbpLocationName: true }).parse({ ...req.body, userId: user.id });
      const [location] = await db.insert(businessLocations).values(parsed as any).returning();
      res.json(location);
    } catch (err: any) { res.status(400).json({ message: err.message }); }
  });

  app.put("/api/locations/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(businessLocations).where(and(eq(businessLocations.id, id), eq(businessLocations.userId, user.id)));
      if (!existing) return res.status(404).json({ message: "Location not found" });
      const parsed = locationUpdateInput.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const { socialProfiles, ...updateFields } = parsed.data;
      const changes: Record<string, unknown> = { ...updateFields, updatedAt: new Date() };
      if (socialProfiles) {
        // Replace the seven editable platform links; keep any other keys (e.g. from a GBP sync).
        const kept = Object.fromEntries(Object.entries((existing.socialProfiles as Record<string, unknown>) || {})
          .filter(([key]) => !(SOCIAL_PROFILE_KEYS as readonly string[]).includes(key)));
        changes.socialProfiles = { ...kept, ...Object.fromEntries(Object.entries(socialProfiles).filter(([, v]) => v)) };
      }
      const [updated] = await db.update(businessLocations).set(changes).where(eq(businessLocations.id, id)).returning();
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating location:", err);
      res.status(500).json({ message: "Could not save the location. Please try again." });
    }
  });

  app.delete("/api/locations/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(businessLocations).where(and(eq(businessLocations.id, id), eq(businessLocations.userId, user.id)));
      if (!existing) return res.status(404).json({ message: "Location not found" });
      await db.transaction(async (tx) => {
        // citations has no FK to its campaign: remove the checklist rows first or they are orphaned.
        const campaignIds = tx.select({ id: citationCampaigns.id }).from(citationCampaigns).where(eq(citationCampaigns.locationId, id));
        await tx.delete(citations).where(inArray(citations.campaignId, campaignIds));
        await tx.delete(citationCampaigns).where(eq(citationCampaigns.locationId, id));
        await tx.delete(businessLocations).where(eq(businessLocations.id, id));
      });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/locations/search-google", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { query } = req.body;
      if (!query || query.trim().length < 2) return res.status(400).json({ message: "Search query is required" });
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "Google Places API key not configured" });

      const trimmed = query.trim();

      if (isGoogleUrl(trimmed)) {
        const { resolvedUrl, extractedQuery, kgmid: shortUrlKgmid } = await resolveGoogleShortUrl(trimmed);
        const effectiveUrl = resolvedUrl || trimmed;

        let placeId: string | null = extractPlaceId(effectiveUrl);

        let decimalCid: string | null = null;
        let urlQuery: string | null = null;
        let mapsKgmid: string | null = shortUrlKgmid || null;

        try {
          const fullUrl = trimmed.includes("#") ? trimmed : effectiveUrl;
          const hashPart = fullUrl.split("#")[1] || "";
          const rlimmMatch = hashPart.match(/rlimm=(\d+)/);
          if (rlimmMatch) decimalCid = rlimmMatch[1];
          const parsedUrl = new URL(fullUrl.split("#")[0]);
          urlQuery = parsedUrl.searchParams.get("q");
        } catch {}

        const hexCid = extractMapsDataCid(trimmed) || extractMapsDataCid(effectiveUrl);
        if (!decimalCid && hexCid) {
          decimalCid = hexCidToDecimal(hexCid);
        }

        const mapsSearchQuery = extractMapsDataSearchQuery(trimmed) || extractMapsDataSearchQuery(effectiveUrl);
        if (!mapsKgmid) {
          mapsKgmid = extractMapsDataKgmid(trimmed) || extractMapsDataKgmid(effectiveUrl);
        }
        const businessCoords = extractMapsBusinessCoords(trimmed) || extractMapsBusinessCoords(effectiveUrl);

        if (!placeId && decimalCid) {
          try {
            const cidUrl = `https://maps.googleapis.com/maps/api/place/details/json?cid=${decimalCid}&fields=place_id,name,formatted_address,types,rating,user_ratings_total,formatted_phone_number,website,address_components&key=${apiKey}`;
            const cidRes = await fetch(cidUrl);
            const cidData = await cidRes.json() as any;
            if (cidData.status === "OK" && cidData.result) {
              placeId = cidData.result.place_id;
            }
          } catch {}
        }

        if (!placeId) {
          const placeName = extractPlaceName(effectiveUrl);
          if (placeName) {
            const biasCoords = businessCoords || (() => {
              const m = effectiveUrl.match(/@([-\d.]+),([-\d.]+)/);
              return m ? { lat: m[1], lng: m[2] } : null;
            })();
            let findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placeName)}&inputtype=textquery&fields=place_id,name,formatted_address,types,rating,user_ratings_total&key=${apiKey}`;
            if (biasCoords) {
              findUrl += `&locationbias=point:${biasCoords.lat},${biasCoords.lng}`;
            }
            const findRes = await fetch(findUrl);
            const findData = await findRes.json() as any;
            if (findData.candidates?.length > 0) {
              placeId = findData.candidates[0].place_id;
            }
          }
        }

        if (!placeId && mapsSearchQuery) {
          const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(mapsSearchQuery)}&key=${apiKey}`;
          const searchRes = await fetch(textSearchUrl);
          const searchData = await searchRes.json() as any;
          if (searchData.results?.length > 0) {
            placeId = searchData.results[0].place_id;
          }
        }

        if (placeId) {
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=place_id,name,formatted_address,types,rating,user_ratings_total,formatted_phone_number,website,address_components&key=${apiKey}`;
          const detailRes = await fetch(detailUrl);
          const detailData = await detailRes.json() as any;
          if (detailData.status === "OK" && detailData.result) {
            const d = detailData.result;
            let city = "", state = "", zipCode = "";
            if (d.address_components) {
              for (const comp of d.address_components) {
                if (comp.types.includes("locality")) city = comp.long_name;
                if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
                if (comp.types.includes("postal_code")) zipCode = comp.long_name;
              }
            }
            return res.json({
              results: [{
                placeId: d.place_id,
                businessName: d.name || "",
                // Street line only: city/state/zip are separate fields below.
                address: placeStreetLine(d) || "",
                formattedAddress: d.formatted_address || "",
                phone: d.formatted_phone_number || "",
                website: d.website || "",
                city,
                state,
                zipCode,
                types: d.types || [],
                rating: d.rating || null,
                userRatingsTotal: d.user_ratings_total || 0,
              }],
            });
          }
        }

        const allResults: any[] = [];
        const fallbackName = extractPlaceName(effectiveUrl) || extractedQuery || mapsSearchQuery;

        if (mapsKgmid && fallbackName) {
          allResults.push({
            placeId: `kgmid:${mapsKgmid}`,
            businessName: fallbackName,
            address: "Service Area Business — from shared link",
            phone: "",
            website: "",
            city: "",
            state: "",
            zipCode: "",
            types: [],
            rating: null,
            userRatingsTotal: 0,
            fromKgmid: true,
          });
        }

        const searchTerm = extractedQuery || mapsSearchQuery || urlQuery || fallbackName;
        if (searchTerm && allResults.length === 0) {
          const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchTerm)}&key=${apiKey}`;
          const searchRes = await fetch(textSearchUrl);
          const searchData = await searchRes.json() as any;
          if (searchData.results?.length > 0) {
            const apiResults = searchData.results.slice(0, 10).map((place: any) => ({
              placeId: place.place_id,
              businessName: place.name || "",
              address: place.formatted_address || "",
              phone: "",
              website: "",
              city: "",
              state: "",
              zipCode: "",
              types: place.types || [],
              rating: place.rating || null,
              userRatingsTotal: place.user_ratings_total || 0,
            }));
            allResults.push(...apiResults);
          }
        }

        if (allResults.length > 0) {
          return res.json({ results: allResults });
        }

        return res.json({ results: [] });
      }

      const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(trimmed)}&region=us&key=${apiKey}`;
      const searchRes = await fetch(textSearchUrl);
      const searchData = await searchRes.json() as any;

      if (searchData.status !== "OK" || !searchData.results?.length) {
        try {
          const scraped = await scrapeGoogleMapsBusiness({ name: trimmed });
          if (scraped && scraped.name) {
            return res.json({
              results: [{
                placeId: "",
                businessName: scraped.name,
                address: scraped.address || "",
                phone: scraped.phone || "",
                website: scraped.website || "",
                types: scraped.category ? [scraped.category] : [],
                rating: null,
                userRatingsTotal: 0,
                lat: scraped.lat ?? undefined,
                lon: scraped.lng ?? undefined,
                synthesized: true,
                serviceAreaBusiness: scraped.serviceAreaBusiness,
                needsManualAddress: !scraped.address,
              }],
            });
          }
        } catch {}
        return res.json({ results: [] });
      }

      const results = searchData.results.map((place: any) => ({
        placeId: place.place_id,
        businessName: place.name || "",
        address: place.formatted_address || "",
        types: place.types || [],
        rating: place.rating || null,
        userRatingsTotal: place.user_ratings_total || 0,
      }));

      res.json({ results });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/locations/:id/import-google", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [location] = await db.select().from(businessLocations).where(and(eq(businessLocations.id, id), eq(businessLocations.userId, user.id)));
      if (!location) return res.status(404).json({ message: "Location not found" });
      // Linked to a Business Profile: the owner's own profile is the source, not public Places data.
      if (location.gbpLocationName) {
        const { syncLocation } = await import("./gbp/service");
        const result: any = await syncLocation(user.id, id);
        const [fresh] = await db.select().from(businessLocations).where(eq(businessLocations.id, id));
        if (result?.profile?.kind) return res.status(409).json({ message: result.profile.message });
        return res.json({ ...fresh, syncWarnings: result.profile?.warnings || [] });
      }
      if (!location.placeId) return res.status(400).json({ message: "Location has no Google Place ID" });

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "Google Places API key not configured" });

      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(location.placeId)}&fields=name,formatted_address,formatted_phone_number,website,types,opening_hours,address_components,url&key=${apiKey}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json() as any;

      if (detailData.status !== "OK" || !detailData.result) {
        return res.status(400).json({ message: "Could not fetch Google details" });
      }

      const d = detailData.result;
      let city = "", state = "", zipCode = "";
      if (d.address_components) {
        for (const comp of d.address_components) {
          if (comp.types.includes("locality")) city = comp.long_name;
          if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
          if (comp.types.includes("postal_code")) zipCode = comp.long_name;
        }
      }

      const categories = (d.types || [])
        .filter((t: string) => !["point_of_interest", "establishment", "premise", "political"].includes(t))
        .map((t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));

      const hours = d.opening_hours?.weekday_text || null;

      const street = placeStreetLine(d);
      const updateData: Record<string, any> = {
        businessName: d.name || location.businessName,
        // Street line only (city/state/zip below). A stored copy of the full
        // formatted address is cleared rather than kept and shown twice.
        address: street ?? (location.address && location.address === d.formatted_address ? null : location.address),
        city: city || location.city,
        state: state || location.state,
        zipCode: zipCode || location.zipCode,
        phone: d.formatted_phone_number || location.phone,
        website: d.website || location.website,
        categories: categories.length > 0 ? categories : location.categories,
        hours: hours ? { weekday_text: hours } : location.hours,
        // No businessPhotoCount: Places returns at most 10 photo references, not
        // the listing's real count. Only the Business Profile media sync sets it.
        googleCid: d.url || location.googleCid,
        updatedAt: new Date(),
      };

      const [updated] = await db.update(businessLocations).set(updateData).where(eq(businessLocations.id, id)).returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/locations/:id/analytics/seed", (_req, res) => {
    res.status(410).json({message:"Demo metric seeding has been removed. Sync Google Business Profile for real metrics."});
  });

  // Legacy analytics rows have no provider provenance and may contain demo data.
  // Keep the old URL honest; the UI consumes the canonical GBP metrics endpoint.
  app.get("/api/locations/:id/analytics", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    const [location] = await db.select().from(businessLocations).where(and(eq(businessLocations.id,id),eq(businessLocations.userId,user.id)));
    if (!location) return res.status(404).json({message:"Location not found"});
    res.json({available:false,source:null,message:"Use Google Business Profile performance for verified daily metrics.",performanceUrl:`/api/gbp/locations/${id}/performance`});
  });

  app.get("/api/citations/campaigns", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const campaigns = await db.select().from(citationCampaigns).where(eq(citationCampaigns.userId, user.id)).orderBy(desc(citationCampaigns.createdAt));
      res.json(campaigns);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/citations/campaigns", async (req, res) => {
    if (!(await requirePremiumPlus(req, res))) return;
    try {
      const user = getDevUser(req, res);
      const parsed = insertCitationCampaignSchema.parse({ ...req.body, userId: user.id });
      const [campaign] = await db.insert(citationCampaigns).values(parsed as any).returning();
      res.json(campaign);
    } catch (err: any) { res.status(400).json({ message: err.message }); }
  });

  app.delete("/api/citations/campaigns/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [campaign] = await db.select().from(citationCampaigns).where(and(eq(citationCampaigns.id, id), eq(citationCampaigns.userId, user.id)));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      await db.delete(citations).where(eq(citations.campaignId, id));
      await db.delete(citationCampaigns).where(eq(citationCampaigns.id, id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Checklist order: Google Business Profile first (it drives local search), then the rest by priority.
  const CITATION_DIRECTORIES = [
    { name: "Google Business Profile", url: "google.com", category: "Search Engine" },
    { name: "Yelp", url: "yelp.com", category: "Review Site" },
    { name: "BBB", url: "bbb.org", category: "Business Directory" },
    { name: "Yellow Pages", url: "yellowpages.com", category: "Business Directory" },
    { name: "Angi", url: "angi.com", category: "Home Services" },
    { name: "HomeAdvisor", url: "homeadvisor.com", category: "Home Services" },
    { name: "Houzz", url: "houzz.com", category: "Home & Design" },
    { name: "Facebook", url: "facebook.com", category: "Social Media" },
    { name: "Nextdoor", url: "nextdoor.com", category: "Community" },
    { name: "Thumbtack", url: "thumbtack.com", category: "Home Services" },
    { name: "MapQuest", url: "mapquest.com", category: "Maps & Navigation" },
    { name: "Superpages", url: "superpages.com", category: "Business Directory" },
    { name: "DexKnows", url: "dexknows.com", category: "Business Directory" },
    { name: "CitySearch", url: "citysearch.com", category: "Local Search" },
    { name: "Manta", url: "manta.com", category: "Business Directory" },
    { name: "MerchantCircle", url: "merchantcircle.com", category: "Business Directory" },
    { name: "Foursquare", url: "foursquare.com", category: "Local Search" },
    { name: "Apple Maps", url: "maps.apple.com", category: "Maps & Navigation" },
    { name: "Bing Places", url: "bing.com", category: "Search Engine" },
    { name: "TripAdvisor", url: "tripadvisor.com", category: "Review Site" },
    { name: "Buildzoom", url: "buildzoom.com", category: "Home Services" },
    { name: "Porch", url: "porch.com", category: "Home Services" },
    { name: "Bark", url: "bark.com", category: "Home Services" },
    { name: "Expertise", url: "expertise.com", category: "Business Directory" },
    { name: "Chamber of Commerce", url: "chamberofcommerce.com", category: "Business Directory" },
    { name: "HotFrog", url: "hotfrog.com", category: "Business Directory" },
    { name: "Brownbook", url: "brownbook.net", category: "Business Directory" },
    { name: "ShowMeLocal", url: "showmelocal.com", category: "Business Directory" },
    { name: "EZLocal", url: "ezlocal.com", category: "Business Directory" },
    { name: "Local.com", url: "local.com", category: "Local Search" },
  ];
  // Checklists built before the rename carry the old name.
  const LEGACY_CITATION_NAMES: Record<string, string> = { "Google My Business": "Google Business Profile" };
  const citationRank = new Map(CITATION_DIRECTORIES.map((d, i) => [d.name, i]));

  app.get("/api/citations/campaigns/:id/results", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const [campaign] = await db.select().from(citationCampaigns).where(and(eq(citationCampaigns.id, id), eq(citationCampaigns.userId, user.id)));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      const rows = await db.select().from(citations).where(eq(citations.campaignId, id)).orderBy(asc(citations.id));
      // Directory priority order (Google Business Profile first); unknown names keep insertion order at the end.
      const results = rows
        .map(c => ({ ...c, siteName: LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName }))
        .map((c, i) => ({ c, rank: citationRank.get(c.siteName) ?? CITATION_DIRECTORIES.length + i }))
        .sort((a, b) => a.rank - b.rank)
        .map(({ c }) => c);
      res.json({ campaign, citations: results });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });


  // Citation checklist. There is no reliable free API that tells us whether a business is listed on each
  // directory, and guessing is fabrication (CLAUDE.md). So the owner verifies each site via a Google site:
  // search and records the result; only the Google Business Profile row is filled from real linked data.
  app.post("/api/citations/campaigns/:id/run", async (req, res) => {
    if (!(await requirePremiumPlus(req, res))) return;
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      const [campaign] = await db.select().from(citationCampaigns).where(and(eq(citationCampaigns.id, id), eq(citationCampaigns.userId, user.id)));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      const existing = await db.select().from(citations).where(eq(citations.campaignId, id));
      const have = new Set(existing.map(c => LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName));
      const [loc] = campaign.locationId ? await db.select().from(businessLocations).where(and(eq(businessLocations.id, campaign.locationId), eq(businessLocations.userId, user.id))) : [];
      for (const dir of CITATION_DIRECTORIES) {
        if (have.has(dir.name)) continue;
        const isGoogle = dir.url === "google.com";
        const linked = isGoogle && !!loc?.gbpLocationName;
        await db.insert(citations).values({
          campaignId: id, siteName: dir.name, siteUrl: `https://${dir.url}`,
          listingUrl: linked ? loc!.googleCid || null : null,
          isFound: linked ? true : null, napConsistent: null,
          category: dir.category, domainAuthority: null, lastChecked: linked ? new Date() : null,
        });
      }
      await recountCitations(id);
      res.json({ message: "Checklist ready", campaignId: id });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  async function recountCitations(campaignId: number) {
    const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    await db.update(citationCampaigns).set({
      citationsFound: rows.filter(r => r.isFound === true).length,
      opportunitiesFound: rows.filter(r => r.isFound === false).length,
      lastRunAt: new Date(),
    }).where(eq(citationCampaigns.id, campaignId));
  }

  app.patch("/api/citations/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const body = z.object({
        status: z.enum(["listed", "wrong", "missing", "unchecked"]),
        listingUrl: z.string().trim().max(500).url().refine(u => /^https:\/\//i.test(u), "Use an https link").nullable().optional(),
      }).parse(req.body);
      const [row] = await db.select({ c: citations, owner: citationCampaigns.userId }).from(citations)
        .innerJoin(citationCampaigns, eq(citationCampaigns.id, citations.campaignId)).where(eq(citations.id, id));
      if (!row || row.owner !== user.id) return res.status(404).json({ message: "Not found" });
      const map = { listed: [true, true], wrong: [true, false], missing: [false, null], unchecked: [null, null] } as const;
      const [isFound, napConsistent] = map[body.status];
      const [updated] = await db.update(citations).set({
        isFound, napConsistent, lastChecked: body.status === "unchecked" ? null : new Date(),
        ...(body.listingUrl !== undefined ? { listingUrl: body.listingUrl } : {}),
      }).where(eq(citations.id, id)).returning();
      await recountCitations(row.c.campaignId);
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message || "Invalid input" });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/state-guides", async (_req, res) => {
    const guides = await db.select().from(stateGuides).orderBy(asc(stateGuides.stateName));
    res.json(guides);
  });

  app.get("/api/state-guides/:stateCode", async (req, res) => {
    const code = req.params.stateCode.toUpperCase();
    const [guide] = await db.select().from(stateGuides).where(eq(stateGuides.stateCode, code));
    if (!guide) return res.status(404).json({ message: "State guide not found" });
    const steps = await db.select().from(stateGuideSteps).where(eq(stateGuideSteps.stateGuideId, guide.id)).orderBy(asc(stateGuideSteps.stepNumber));
    res.json({ ...guide, steps });
  });

  app.get("/api/master-class-modules", async (_req, res) => {
    const modules = await db.select().from(masterClassModules).where(eq(masterClassModules.isActive, true)).orderBy(asc(masterClassModules.sortOrder));
    res.json(modules);
  });

  app.get("/api/course-purchases", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return res.json([]);
    const purchases = await db.select().from(coursePurchases).where(eq(coursePurchases.userId, user.id));
    res.json(purchases);
  });

  app.post("/api/admin/test-email", async (req, res) => {
    if (!req.isAuthenticated() || !isAdmin(req.user as any)) {
      return res.status(403).json({ message: "Admin only" });
    }
    if (!platformGatePassed(req)) {
      return res.status(403).json({ message: "Admin sign-in required", gateRequired: true });
    }
    const { useBackup } = req.body;
    const label = useBackup ? "BACKUP" : "PRIMARY";
    const targetEmail = (req.user as any).email;
    try {
      const result = await trySend(!!useBackup, {
        from: `"ConstructHUB Test" <placeholder>`,
        to: targetEmail,
        subject: `[SMTP TEST] ${label} email delivery test`,
        html: `<div style="font-family:sans-serif;padding:20px;"><h2>SMTP ${label} Test</h2><p>This test email was sent from the <strong>${label}</strong> SMTP account at ${new Date().toLocaleString()}.</p><p>If you're reading this, delivery is working.</p></div>`,
      });
      res.json({ success: true, label, accepted: result.accepted, response: result.response });
    } catch (err: any) {
      res.status(500).json({ success: false, label, error: err.message });
    }
  });

  const inquiryText = (label: string, max: number) => z.string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` }).trim().max(max, `${label} is too long (max ${max} characters)`);
  const inquiryEmail = z.string({ required_error: "Email is required" }).trim().min(1, "Email is required").max(254).email("Enter a valid email address");
  const seoInquiryInput = z.object({
    name: inquiryText("Name", 200).min(1, "Name is required"),
    email: inquiryEmail,
    phone: inquiryText("Phone", 50).optional().nullable(),
    website: inquiryText("Website", 500).optional().nullable(),
    services: z.array(inquiryText("Service", 100)).max(30).optional().nullable(),
    message: inquiryText("Message", 5000).optional().nullable(),
  });
  const reinstatementInput = z.object({
    name: inquiryText("Name", 200).min(1, "Please fill in all required fields."),
    email: inquiryEmail,
    businessName: inquiryText("Business name", 300).min(1, "Please fill in all required fields."),
    websiteUrl: inquiryText("Website", 500).optional().nullable(),
    businessAddress: inquiryText("Business address", 500).min(1, "Please fill in all required fields."),
    businessType: inquiryText("Business type", 200).min(1, "Please fill in all required fields."),
    multipleLocations: inquiryText("Multiple locations", 20).optional().nullable(),
    problemDescription: inquiryText("Problem description", 5000).min(1, "Please fill in all required fields."),
  });
  // Multi-line user text: escape, then keep line breaks readable.
  const escapeBlock = (value: unknown) => escapeHtml(value).replace(/\r?\n/g, "<br>");

  app.post("/api/seo-inquiry", seoInquiryLimit, async (req, res) => {
    try {
      const parsed = seoInquiryInput.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const { name, email, phone, website, services, message } = parsed.data;

      const servicesList = services && services.length > 0 ? services.join(", ") : "Not specified";

      await sendWithFallback({
        from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
        to: process.env.SMTP_EMAIL,
        replyTo: email,
        subject: `SEO Services Inquiry — ${oneLine(name).slice(0, 150)}`,
        html: `
          <h2>New SEO Services Inquiry</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(phone || "N/A")}</p>
          <p><strong>Website:</strong> ${escapeHtml(website || "N/A")}</p>
          <p><strong>Services Requested:</strong> ${escapeHtml(servicesList)}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeBlock(message || "No additional details provided.")}</p>
        `,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("SEO inquiry email failed:", err);
      res.status(500).json({ message: "Failed to submit inquiry. Please try again." });
    }
  });

  app.post("/api/reinstatement/request", reinstatementLimit, async (req, res) => {
    try {
      const parsed = reinstatementInput.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const { name, email, businessName, websiteUrl, businessAddress, businessType, multipleLocations, problemDescription } = parsed.data;

      await sendWithFallback({
        from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
        to: process.env.SMTP_EMAIL,
        replyTo: email,
        subject: `GBP Reinstatement Request — ${oneLine(businessName).slice(0, 150)}`,
        html: `
          <h2>New GBP Reinstatement Request</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Business:</strong> ${escapeHtml(businessName)}</p>
          <p><strong>Website:</strong> ${escapeHtml(websiteUrl || "N/A")}</p>
          <p><strong>Address:</strong> ${escapeHtml(businessAddress)}</p>
          <p><strong>Type:</strong> ${escapeHtml(businessType)}</p>
          <p><strong>Multiple Locations:</strong> ${escapeHtml(multipleLocations || "Not specified")}</p>
          <p><strong>Problem:</strong></p>
          <p>${escapeBlock(problemDescription)}</p>
        `,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Reinstatement email failed:", err);
      res.status(500).json({ message: "Failed to submit request. Please try again." });
    }
  });

  const BOT_PATTERNS = [
    /bot/i, /crawler/i, /spider/i, /headless/i, /phantom/i, /selenium/i,
    /puppeteer/i, /playwright/i, /wget/i, /curl/i, /python-requests/i,
    /scrapy/i, /httpclient/i, /java\//i, /libwww/i, /lwp-/i,
    /go-http-client/i, /apache-httpclient/i, /okhttp/i,
  ];

  app.post("/api/click-guard/track", async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      const { trackingId, fingerprint, deviceType, browser, os, screenResolution, language, timezone, referrer, landingPage, userAgent } = req.body;

      if (!trackingId) {
        return res.status(400).json({ message: "Missing trackingId" });
      }

      const domain = await storage.getTrackedDomainByTrackingId(trackingId);
      if (!domain || !domain.isActive) {
        return res.status(204).end();
      }

      const ip = visitorIp(req);

      const isBlocked = await storage.isIpBlocked(domain.id, ip);

      const suspicionReasons: string[] = [];
      const ua = userAgent || req.headers["user-agent"] || "";

      for (const pattern of BOT_PATTERNS) {
        if (pattern.test(ua)) {
          suspicionReasons.push(`Bot user agent detected: ${pattern.source}`);
          break;
        }
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentVisits = await storage.getRecentVisitsByIp(domain.id, ip, oneHourAgo);
      if (recentVisits.length >= 5) {
        suspicionReasons.push(`High frequency: ${recentVisits.length + 1} visits in last hour`);
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyVisits = await storage.getRecentVisitsByIp(domain.id, ip, oneDayAgo);
      if (dailyVisits.length >= 15) {
        suspicionReasons.push(`Very high frequency: ${dailyVisits.length + 1} visits in 24 hours`);
      }

      if (fingerprint) {
        const fpVisits = await db.select({ id: clickVisits.id }).from(clickVisits).where(and(
          eq(clickVisits.domainId, domain.id), eq(clickVisits.fingerprint, String(fingerprint)),
          gte(clickVisits.visitedAt, oneDayAgo), sql`${clickVisits.ipAddress} <> ${ip}`,
        )).limit(1);
        if (fpVisits.length > 0) {
          suspicionReasons.push("Same device fingerprint seen from different IPs");
        }
      }

      if (!ua || ua.length < 10) {
        suspicionReasons.push("Missing or very short user agent");
      }

      const isSuspicious = suspicionReasons.length > 0;
      const geo = edgeGeo(req);

      await storage.createClickVisit({
        domainId: domain.id,
        ipAddress: ip,
        userAgent: ua,
        deviceType: deviceType || null,
        browser: browser || null,
        os: os || null,
        screenResolution: screenResolution || null,
        language: language || null,
        timezone: timezone || null,
        referrer: referrer || null,
        landingPage: landingPage || null,
        fingerprint: fingerprint || null,
        isSuspicious,
        suspicionReasons: isSuspicious ? suspicionReasons : null,
        country: geo.country,
        city: geo.city,
      });

      if (isSuspicious && !isBlocked && recentVisits.length >= 10 && isIP(ip)) {
        await storage.createBlockedIp({
          domainId: domain.id,
          ipAddress: ip,
          reason: suspicionReasons.join("; "),
          isActive: true,
          source: "auto",
        });
      }

      res.status(204).end();
    } catch (err: any) {
      console.error("Click tracking error:", err);
      res.status(204).end();
    }
  });

  app.options("/api/click-guard/track", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  app.get("/api/click-guard/domains", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const domains = await storage.getTrackedDomains(user.id);
      const domainsWithStats = await Promise.all(
        domains.map(async (d) => {
          const visits = await storage.getClickVisits(d.id);
          const blocked = await storage.getBlockedIps(d.id);
          const uniqueIps = new Set(visits.map(v => v.ipAddress)).size;
          const suspiciousCount = visits.filter(v => v.isSuspicious).length;
          return {
            ...d,
            stats: {
              totalVisits: visits.length,
              uniqueVisitors: uniqueIps,
              blockedIps: blocked.length,
              suspiciousVisits: suspiciousCount,
              avgVisitsPerUser: uniqueIps > 0 ? Math.round((visits.length / uniqueIps) * 10) / 10 : 0,
            },
          };
        })
      );
      res.json(domainsWithStats);
    } catch (err: any) {
      console.error("Error fetching domains:", err);
      res.status(500).json({ message: "Failed to fetch domains" });
    }
  });

  app.post("/api/click-guard/domains", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const { name } = req.body ?? {};
      const domain = normalizeTrackedDomain(req.body?.domain);
      if (!domain) return res.status(400).json({ message: "Enter a valid domain, for example yourcompany.com" });
      const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : domain;
      const trackingId = randomUUID();
      const newDomain = await storage.createTrackedDomain({
        userId: user.id,
        domain,
        trackingId,
        name: label,
        isActive: true,
      });
      res.json(newDomain);
    } catch (err: any) {
      console.error("Error creating domain:", err);
      res.status(500).json({ message: "Failed to create domain" });
    }
  });

  app.delete("/api/click-guard/domains/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      await storage.deleteTrackedDomain(id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting domain:", err);
      res.status(500).json({ message: "Failed to delete domain" });
    }
  });

  app.get("/api/click-guard/domains/:id/analytics", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const startDate = startParam ? new Date(startParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = endParam ? new Date(endParam) : new Date();

      const visits = await storage.getClickVisits(domain.id, startDate, endDate);
      const blocked = await storage.getBlockedIps(domain.id);

      const uniqueIps = new Set(visits.map(v => v.ipAddress)).size;
      const suspiciousCount = visits.filter(v => v.isSuspicious).length;
      const threatPercent = visits.length > 0 ? (suspiciousCount / visits.length) * 100 : 0;

      const deviceBreakdown: Record<string, number> = {};
      const countryBreakdown: Record<string, number> = {};
      const browserBreakdown: Record<string, number> = {};
      const osBreakdown: Record<string, number> = {};
      const hourlyVisits: Record<string, number> = {};
      const dailyVisits: Record<string, number> = {};

      visits.forEach(v => {
        const dt = v.deviceType || "unknown";
        deviceBreakdown[dt] = (deviceBreakdown[dt] || 0) + 1;
        const country = v.country || "Unknown";
        countryBreakdown[country] = (countryBreakdown[country] || 0) + 1;
        const br = v.browser || "Unknown";
        browserBreakdown[br] = (browserBreakdown[br] || 0) + 1;
        const os = v.os || "Unknown";
        osBreakdown[os] = (osBreakdown[os] || 0) + 1;

        if (v.visitedAt) {
          const d = new Date(v.visitedAt);
          const hour = d.toISOString().slice(0, 13);
          hourlyVisits[hour] = (hourlyVisits[hour] || 0) + 1;
          const day = d.toISOString().slice(0, 10);
          dailyVisits[day] = (dailyVisits[day] || 0) + 1;
        }
      });

      const ipVisitCounts: Record<string, number> = {};
      visits.forEach(v => {
        ipVisitCounts[v.ipAddress] = (ipVisitCounts[v.ipAddress] || 0) + 1;
      });
      const multiClickBreakdown: Record<string, number> = {};
      Object.values(ipVisitCounts).forEach(c => {
        const key = c >= 10 ? "10+" : `${c}`;
        multiClickBreakdown[key] = (multiClickBreakdown[key] || 0) + 1;
      });

      const referrerBreakdown: Record<string, { visits: number; uniqueIps: Set<string>; pageLoads: number }> = {};
      visits.forEach(v => {
        let source = "NO REFERRER DATA";
        if (v.referrer) {
          try {
            const url = new URL(v.referrer);
            source = url.hostname.replace(/^www\./, "");
          } catch {
            source = v.referrer;
          }
        }
        if (!referrerBreakdown[source]) {
          referrerBreakdown[source] = { visits: 0, uniqueIps: new Set(), pageLoads: 0 };
        }
        referrerBreakdown[source].visits += 1;
        referrerBreakdown[source].pageLoads += 1;
        referrerBreakdown[source].uniqueIps.add(v.ipAddress);
      });

      const trafficSources = Object.entries(referrerBreakdown)
        .map(([domain, data]) => ({
          domain,
          pageLoads: data.pageLoads,
          visitors: data.uniqueIps.size,
          percentage: visits.length > 0 ? Math.round((data.visits / visits.length) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.pageLoads - a.pageLoads);

      res.json({
        totalVisits: visits.length,
        uniqueVisitors: uniqueIps,
        blockedIps: blocked.length,
        suspiciousVisits: suspiciousCount,
        avgVisitsPerUser: uniqueIps > 0 ? Math.round((visits.length / uniqueIps) * 10) / 10 : 0,
        threatLevel: threatPercent > 20 ? "critical" : threatPercent > 5 ? "substantial" : "low",
        threatPercent: Math.round(threatPercent * 10) / 10,
        deviceBreakdown,
        countryBreakdown,
        browserBreakdown,
        osBreakdown,
        hourlyVisits,
        dailyVisits,
        multiClickBreakdown,
        trafficSources,
      });
    } catch (err: any) {
      console.error("Error fetching analytics:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.get("/api/click-guard/domains/:id/visits", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const ipFilter = req.query.ip as string;
      const startDate = startParam ? new Date(startParam) : undefined;
      const endDate = endParam ? new Date(endParam) : undefined;

      let visits = await storage.getClickVisits(domain.id, startDate, endDate);

      if (ipFilter) {
        visits = visits.filter(v => v.ipAddress.includes(ipFilter));
      }

      res.json(visits);
    } catch (err: any) {
      console.error("Error fetching visits:", err);
      res.status(500).json({ message: "Failed to fetch visits" });
    }
  });

  app.get("/api/click-guard/domains/:id/blocked", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      const blocked = await storage.getBlockedIps(domain.id);
      res.json(blocked);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch blocked IPs" });
    }
  });

  app.post("/api/click-guard/domains/:id/block", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      const { reason } = req.body ?? {};
      if (!String(req.body?.ipAddress ?? "").trim()) return res.status(400).json({ message: "IP address is required" });
      const ipAddress = normalizeBlockedIp(req.body.ipAddress);
      if (!ipAddress) {
        return res.status(400).json({ message: "Enter a valid IPv4/IPv6 address, a CIDR range (IPv4 /16–/32) or a wildcard like 203.0.113.*" });
      }

      const alreadyBlocked = await storage.isIpBlocked(domain.id, ipAddress);
      if (alreadyBlocked) return res.status(409).json({ message: "IP already blocked" });

      const blocked = await storage.createBlockedIp({
        domainId: domain.id,
        ipAddress,
        reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : "Manually blocked",
        isActive: true,
        source: "manual",
      });
      res.json(blocked);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to block IP" });
    }
  });

  app.patch("/api/click-guard/domains/:id/settings", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const domainId = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(domainId);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      const parsed = clickGuardSettingsInput.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      for (const key of ["manualExcludeIps", "whitelistIps"] as const) {
        const lines = (parsed.data[key] ?? "").split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        const bad = lines.find(l => !normalizeBlockedIp(l));
        if (bad) return res.status(400).json({ message: `"${bad.slice(0, 60)}" is not a valid IP address or range` });
      }
      const currentSettings = (domain.settings as Record<string, any>) || {};
      const newSettings = { ...currentSettings, ...parsed.data };
      const updated = await storage.updateTrackedDomain(domainId, { settings: newSettings } as any);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.get("/api/click-guard/exclusion-list/:trackingId", async (req, res) => {
    try {
      const { trackingId } = req.params;
      const domain = await storage.getTrackedDomainByTrackingId(trackingId);
      if (!domain) {
        return res.status(404).send("Not found");
      }
      // The trackingId is public (it is in the site's page source); the list of
      // blocked visitor IPs is only for the owner's Ads Script, which carries the key.
      if (!exclusionKeyMatches(domain.trackingId, req.query.key)) {
        return res.status(403).json({ message: "This exclusion-list link is missing its key or is out of date. Copy the Google Ads script again from ConstructHUB → Google Ads → Click Guard." });
      }
      const blocked = await storage.getBlockedIps(domain.id);
      const ipList = blocked
        .filter(b => b.isActive)
        .map(b => normalizeBlockedIp(b.ipAddress))
        .filter((ip): ip is string => !!ip)
        .slice(0, 500);
      
      const format = req.query.format;
      if (format === "json") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.json({
          domain: domain.domain,
          count: ipList.length,
          ips: ipList,
          updatedAt: new Date().toISOString(),
        });
      } else {
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(ipList.join("\n"));
      }
    } catch (err: any) {
      res.status(500).send("Error fetching exclusion list");
    }
  });

  app.get("/api/click-guard/domains/:id/google-ads-script", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const domainId = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(domainId);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      const baseUrl = getBaseUrl(req);
      const exclusionUrl = `${baseUrl}/api/click-guard/exclusion-list/${domain.trackingId}?format=json&key=${exclusionListKey(domain.trackingId)}`;
      
      const script = `// Click Guard — Auto IP Exclusion Script for Google Ads
// Domain: ${domain.domain}
// Install: Google Ads → Tools & Settings → Bulk Actions → Scripts → New Script
// Schedule: Set to run every hour for real-time protection
//
// This script fetches your blocked IP list from Click Guard
// and adds them as IP exclusions on all your active campaigns.

var CLICK_GUARD_API = "${exclusionUrl}";
var LOG_CHANGES = true;

function main() {
  var response = UrlFetchApp.fetch(CLICK_GUARD_API);
  var data = JSON.parse(response.getContentText());
  
  if (!data.ips || data.ips.length === 0) {
    Logger.log("Click Guard: No blocked IPs to sync.");
    return;
  }
  
  Logger.log("Click Guard: Found " + data.ips.length + " blocked IPs for " + data.domain);
  
  var campaignIterator = AdsApp.campaigns()
    .withCondition("Status = ENABLED")
    .get();
  
  var campaignsUpdated = 0;
  var totalExcluded = 0;
  
  while (campaignIterator.hasNext()) {
    var campaign = campaignIterator.next();
    var campaignName = campaign.getName();
    
    var existingExclusions = {};
    var exclusionIterator = campaign.targeting().excludedIpAddresses().get();
    var existingCount = 0;
    while (exclusionIterator.hasNext()) {
      var exclusion = exclusionIterator.next();
      existingExclusions[exclusion.getIpAddress()] = true;
      existingCount++;
    }
    
    // Google Ads allows max 500 IP exclusions per campaign
    var availableSlots = 500 - existingCount;
    var newIps = [];
    
    for (var i = 0; i < data.ips.length; i++) {
      var ip = data.ips[i];
      if (!existingExclusions[ip] && newIps.length < availableSlots) {
        newIps.push(ip);
      }
    }
    
    if (newIps.length > 0) {
      for (var j = 0; j < newIps.length; j++) {
        campaign.targeting().newIpExclusionBuilder()
          .withIpAddress(newIps[j])
          .build();
        totalExcluded++;
      }
      campaignsUpdated++;
      if (LOG_CHANGES) {
        Logger.log("  Campaign '" + campaignName + "': Added " + newIps.length + " new IP exclusions (" + existingCount + " existing, " + availableSlots + " slots were available)");
      }
    } else {
      if (LOG_CHANGES) {
        Logger.log("  Campaign '" + campaignName + "': Already up to date (" + existingCount + " exclusions)");
      }
    }
  }
  
  Logger.log("Click Guard sync complete: " + totalExcluded + " new exclusions across " + campaignsUpdated + " campaigns.");
}`;

      res.json({ script, exclusionUrl });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate script" });
    }
  });

  app.delete("/api/click-guard/domains/:id/block/:blockId", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const domainId = parseInt(req.params.id);
      const blockId = parseInt(req.params.blockId);
      const domain = await storage.getTrackedDomainById(domainId);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      if (!Number.isInteger(blockId)) return res.status(404).json({ message: "Block not found" });
      // Scope the delete to the domain the caller owns: block ids are sequential,
      // so deleting by id alone let any account remove another customer's blocks.
      const removed = await db.delete(blockedIps)
        .where(and(eq(blockedIps.id, blockId), eq(blockedIps.domainId, domain.id)))
        .returning({ id: blockedIps.id });
      if (removed.length === 0) return res.status(404).json({ message: "Block not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to unblock IP" });
    }
  });

  app.get("/api/click-guard/domains/:id/visitors", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const startDate = startParam ? new Date(startParam) : undefined;
      const endDate = endParam ? new Date(endParam) : undefined;

      const visits = await storage.getClickVisits(domain.id, startDate, endDate);
      const now = Date.now();
      const twentyMin = 20 * 60 * 1000;

      const visitorMap = new Map<string, any>();
      for (const v of visits) {
        const key = v.ipAddress;
        if (!visitorMap.has(key)) {
          visitorMap.set(key, {
            ipAddress: v.ipAddress,
            fingerprint: v.fingerprint,
            visits: 0,
            pageViews: 0,
            firstVisit: v.visitedAt,
            lastVisit: v.visitedAt,
            lastDevice: v.deviceType,
            lastBrowser: v.browser,
            lastOs: v.os,
            screenResolution: v.screenResolution,
            language: v.language,
            timezone: v.timezone,
            country: v.country,
            city: v.city,
            isSuspicious: false,
            isOnline: false,
          });
        }
        const visitor = visitorMap.get(key)!;
        visitor.visits++;
        visitor.pageViews++;
        if (new Date(v.visitedAt) < new Date(visitor.firstVisit)) visitor.firstVisit = v.visitedAt;
        if (new Date(v.visitedAt) > new Date(visitor.lastVisit)) {
          visitor.lastVisit = v.visitedAt;
          visitor.lastDevice = v.deviceType;
          visitor.lastBrowser = v.browser;
          visitor.lastOs = v.os;
          visitor.screenResolution = v.screenResolution;
          visitor.language = v.language;
          visitor.timezone = v.timezone;
          visitor.country = v.country;
          visitor.city = v.city;
          visitor.fingerprint = v.fingerprint;
        }
        if (v.isSuspicious) visitor.isSuspicious = true;
        if (now - new Date(v.visitedAt).getTime() < twentyMin) visitor.isOnline = true;
      }

      const visitors = Array.from(visitorMap.values()).sort(
        (a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime()
      );

      res.json(visitors);
    } catch (err: any) {
      console.error("Error fetching visitors:", err);
      res.status(500).json({ message: "Failed to fetch visitors" });
    }
  });

  app.get("/api/click-guard/domains/:id/visitors/:visitorIp", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const visitorIp = req.params.visitorIp;
      const visits = await storage.getClickVisits(domain.id);
      const visitorVisits = visits.filter(v => v.ipAddress === visitorIp)
        .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());

      if (visitorVisits.length === 0) {
        return res.status(404).json({ message: "Visitor not found" });
      }

      const latest = visitorVisits[0];
      const now = Date.now();
      const twentyMin = 20 * 60 * 1000;

      res.json({
        ipAddress: visitorIp,
        fingerprint: latest.fingerprint,
        totalVisits: visitorVisits.length,
        firstVisit: visitorVisits[visitorVisits.length - 1].visitedAt,
        lastVisit: latest.visitedAt,
        isOnline: now - new Date(latest.visitedAt).getTime() < twentyMin,
        isSuspicious: visitorVisits.some(v => v.isSuspicious),
        suspicionReasons: [...new Set(visitorVisits.flatMap(v => (v.suspicionReasons as string[]) || []))],
        systemSpecs: {
          browser: latest.browser,
          os: latest.os,
          deviceType: latest.deviceType,
          screenResolution: latest.screenResolution,
          language: latest.language,
          timezone: latest.timezone,
          userAgent: latest.userAgent,
        },
        geo: {
          country: latest.country,
          city: latest.city,
        },
        recentActivity: visitorVisits.slice(0, 50).map(v => ({
          id: v.id,
          referrer: v.referrer,
          landingPage: v.landingPage,
          visitedAt: v.visitedAt,
          deviceType: v.deviceType,
          browser: v.browser,
          isSuspicious: v.isSuspicious,
        })),
      });
    } catch (err: any) {
      console.error("Error fetching visitor detail:", err);
      res.status(500).json({ message: "Failed to fetch visitor details" });
    }
  });

  app.get("/api/click-guard/domains/:id/pages", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const startDate = startParam ? new Date(startParam) : undefined;
      const endDate = endParam ? new Date(endParam) : undefined;

      const visits = await storage.getClickVisits(domain.id, startDate, endDate);
      const pageMap = new Map<string, { url: string; hits: number; visitors: Set<string> }>();

      for (const v of visits) {
        const url = v.landingPage || "Unknown";
        if (!pageMap.has(url)) {
          pageMap.set(url, { url, hits: 0, visitors: new Set() });
        }
        const page = pageMap.get(url)!;
        page.hits++;
        page.visitors.add(v.ipAddress);
      }

      const pages = Array.from(pageMap.values())
        .map(p => ({ url: p.url, hits: p.hits, uniqueVisitors: p.visitors.size }))
        .sort((a, b) => b.hits - a.hits);

      res.json(pages);
    } catch (err: any) {
      console.error("Error fetching pages:", err);
      res.status(500).json({ message: "Failed to fetch page stats" });
    }
  });

  app.get("/api/click-guard/domains/:id/geo", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const startDate = startParam ? new Date(startParam) : undefined;
      const endDate = endParam ? new Date(endParam) : undefined;

      const visits = await storage.getClickVisits(domain.id, startDate, endDate);
      const countryMap = new Map<string, { count: number; visitors: Set<string> }>();
      const cityMap = new Map<string, { count: number; visitors: Set<string>; country: string }>();

      for (const v of visits) {
        const country = v.country || "Unknown";
        const city = v.city || "Unknown";

        if (!countryMap.has(country)) {
          countryMap.set(country, { count: 0, visitors: new Set() });
        }
        const c = countryMap.get(country)!;
        c.count++;
        c.visitors.add(v.ipAddress);

        const cityKey = `${city}, ${country}`;
        if (!cityMap.has(cityKey)) {
          cityMap.set(cityKey, { count: 0, visitors: new Set(), country });
        }
        const ci = cityMap.get(cityKey)!;
        ci.count++;
        ci.visitors.add(v.ipAddress);
      }

      const total = visits.length;
      const countries = Array.from(countryMap.entries())
        .map(([name, d]) => ({ name, count: d.count, visitors: d.visitors.size, percentage: total ? ((d.count / total) * 100).toFixed(1) : "0" }))
        .sort((a, b) => b.count - a.count);

      const cities = Array.from(cityMap.entries())
        .map(([name, d]) => ({ name, count: d.count, visitors: d.visitors.size, country: d.country, percentage: total ? ((d.count / total) * 100).toFixed(1) : "0" }))
        .sort((a, b) => b.count - a.count);

      res.json({ countries, cities });
    } catch (err: any) {
      console.error("Error fetching geo:", err);
      res.status(500).json({ message: "Failed to fetch geo data" });
    }
  });

  app.get("/api/click-guard/domains/:id/platforms", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const startParam = req.query.start as string;
      const endParam = req.query.end as string;
      const startDate = startParam ? new Date(startParam) : undefined;
      const endDate = endParam ? new Date(endParam) : undefined;

      const visits = await storage.getClickVisits(domain.id, startDate, endDate);
      const browsers: Record<string, number> = {};
      const oses: Record<string, number> = {};
      const devices: Record<string, number> = {};
      const resolutions: Record<string, number> = {};

      for (const v of visits) {
        const b = v.browser || "Unknown";
        const o = v.os || "Unknown";
        const d = v.deviceType || "Unknown";
        const r = v.screenResolution || "Unknown";
        browsers[b] = (browsers[b] || 0) + 1;
        oses[o] = (oses[o] || 0) + 1;
        devices[d] = (devices[d] || 0) + 1;
        resolutions[r] = (resolutions[r] || 0) + 1;
      }

      res.json({ browsers, oses, devices, resolutions });
    } catch (err: any) {
      console.error("Error fetching platforms:", err);
      res.status(500).json({ message: "Failed to fetch platform data" });
    }
  });

  app.get("/api/click-guard/domains/:id/online", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) {
        return res.status(404).json({ message: "Domain not found" });
      }

      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
      const visits = await storage.getClickVisits(domain.id, twentyMinAgo);
      const onlineIps = new Map<string, any>();

      for (const v of visits) {
        if (!onlineIps.has(v.ipAddress)) {
          onlineIps.set(v.ipAddress, {
            ipAddress: v.ipAddress,
            lastVisit: v.visitedAt,
            browser: v.browser,
            os: v.os,
            deviceType: v.deviceType,
            country: v.country,
            city: v.city,
            landingPage: v.landingPage,
          });
        }
      }

      res.json({
        count: onlineIps.size,
        visitors: Array.from(onlineIps.values()),
      });
    } catch (err: any) {
      console.error("Error fetching online visitors:", err);
      res.status(500).json({ message: "Failed to fetch online visitors" });
    }
  });

  // ===== VPN Shield Endpoints =====

  const CRAWLER_PATTERNS = [
    /Googlebot/i, /Bingbot/i, /Slurp/i, /DuckDuckBot/i, /Baiduspider/i,
    /YandexBot/i, /Sogou/i, /facebookexternalhit/i, /Twitterbot/i,
    /LinkedInBot/i, /WhatsApp/i, /Applebot/i, /AdsBot-Google/i,
    /Mediapartners-Google/i, /msnbot/i, /ia_archiver/i, /archive\.org_bot/i,
  ];

  const DATACENTER_CIDRS = [
    "104.16.", "104.17.", "104.18.", "104.19.", "104.20.", "104.21.", "104.22.", "104.23.", "104.24.", "104.25.",
    "172.64.", "172.65.", "172.66.", "172.67.", "172.68.", "172.69.", "172.70.", "172.71.",
    "198.41.", "141.101.", "162.158.", "190.93.", "188.114.",
    "103.21.", "103.22.", "103.31.",
    "45.33.", "45.56.", "45.79.", "50.116.", "66.175.", "69.164.", "72.14.", "74.207.",
    "96.126.", "97.107.", "109.237.", "139.162.", "172.104.", "172.105.", "173.230.",
    "173.255.", "178.79.", "192.155.", "192.81.",
    "159.89.", "167.99.", "188.166.", "206.189.", "157.245.", "161.35.", "137.184.",
    "134.209.", "142.93.", "143.110.", "143.198.", "144.126.", "164.90.", "164.92.",
    "165.22.", "165.227.", "167.71.", "167.172.", "178.128.",
    "3.0.", "3.1.", "3.2.", "3.3.", "13.52.", "13.56.", "13.57.", "13.58.", "13.59.",
    "18.144.", "18.188.", "18.189.", "18.216.", "18.217.", "18.218.", "18.219.", "18.220.",
    "18.221.", "18.222.", "18.223.", "18.224.", "18.225.",
    "35.154.", "35.155.", "35.156.", "35.157.", "35.158.", "35.159.", "35.160.",
    "34.192.", "34.193.", "34.194.", "34.195.", "34.196.", "34.197.", "34.198.", "34.199.",
    "34.200.", "34.201.", "34.202.", "34.203.", "34.204.", "34.205.", "34.206.", "34.207.",
    "34.208.", "34.209.", "34.210.", "34.211.", "34.212.", "34.213.", "34.214.", "34.215.",
    "34.216.", "34.217.", "34.218.", "34.219.", "34.220.", "34.221.", "34.222.", "34.223.",
    "34.224.", "34.225.", "34.226.", "34.227.", "34.228.", "34.229.", "34.230.", "34.231.",
    "34.232.", "34.233.", "34.234.", "34.235.", "34.236.", "34.237.", "34.238.", "34.239.",
    "52.0.", "52.1.", "52.2.", "52.3.", "52.4.", "52.5.", "52.6.", "52.7.",
    "54.145.", "54.146.", "54.147.", "54.148.", "54.149.", "54.150.", "54.151.",
    "107.20.", "107.21.", "107.22.", "107.23.",
    "5.101.", "5.188.", "46.166.", "46.243.", "79.110.", "80.240.", "85.17.", "89.248.",
    "91.108.", "91.200.", "91.207.", "91.209.", "91.212.", "91.213.", "91.214.", "91.215.",
    "91.216.", "91.217.", "91.218.", "91.219.", "91.220.", "91.232.",
    "185.56.", "185.86.", "185.93.", "185.100.", "185.104.", "185.153.", "185.156.",
    "185.165.", "185.180.", "185.189.", "185.193.", "185.199.", "185.200.", "185.209.",
    "185.210.", "185.213.", "185.220.", "185.232.", "185.243.", "185.244.", "185.245.",
    "193.27.", "193.32.", "193.37.", "193.56.", "193.106.", "193.138.", "193.148.", "193.164.",
    "194.15.", "194.36.", "194.110.",
    "195.2.", "195.10.", "195.123.", "195.154.", "195.181.",
    "146.70.", "37.120.", "86.105.", "89.187.", "169.150.",
    "103.86.", "103.108.", "103.125.",
    "45.83.", "45.86.", "45.87.", "45.89.", "45.128.", "45.129.", "45.130.", "45.131.",
    "45.132.", "45.133.", "45.134.", "45.135.", "45.136.", "45.137.", "45.138.", "45.139.",
    "45.140.", "45.141.", "45.142.", "45.143.", "45.144.", "45.145.", "45.146.", "45.147.",
    "45.148.", "45.149.", "45.150.", "45.151.", "45.152.", "45.153.", "45.154.", "45.155.",
  ];

  const VPN_PROVIDERS: Record<string, string[]> = {
    "NordVPN": ["146.70.", "37.120.", "86.105.", "89.187.", "169.150.", "185.156."],
    "ExpressVPN": ["103.86.", "103.108.", "103.125.", "185.189."],
    "Surfshark": ["45.83.", "45.131.", "45.132.", "185.209."],
    "Private Internet Access": ["185.56.", "185.93.", "185.213."],
    "CyberGhost": ["185.165.", "185.243.", "185.232."],
    "ProtonVPN": ["185.159.", "185.177.", "193.29."],
    "Mullvad": ["45.83.", "45.129.", "141.98.", "185.195.", "193.138.", "198.54."],
    "Windscribe": ["185.245.", "104.254."],
    "IPVanish": ["166.70.", "209.222.", "198.55."],
    "TunnelBear": ["172.83.", "199.229."],
    "Digital Ocean": ["159.89.", "167.99.", "188.166.", "206.189.", "157.245.", "161.35."],
    "AWS": ["3.0.", "3.1.", "13.52.", "18.144.", "34.192.", "52.0.", "54.145."],
    "Linode": ["45.33.", "45.56.", "45.79.", "50.116.", "139.162.", "172.104."],
    "Vultr": ["45.32.", "45.63.", "45.76.", "45.77.", "108.61.", "149.28."],
  };

  function identifyVpnProvider(ip: string): string | null {
    for (const [provider, prefixes] of Object.entries(VPN_PROVIDERS)) {
      if (prefixes.some(prefix => ip.startsWith(prefix))) {
        return provider;
      }
    }
    return null;
  }

  function isDatacenterIp(ip: string): boolean {
    return DATACENTER_CIDRS.some(prefix => ip.startsWith(prefix));
  }

  function isCrawler(ua: string): boolean {
    return CRAWLER_PATTERNS.some(p => p.test(ua));
  }

  app.options("/api/vpn-shield/track", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  app.post("/api/vpn-shield/track", async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      const { trackingId, fingerprint, deviceType, browser, os, referrer, landingPage, userAgent, vpnSignals } = req.body;
      if (!trackingId) return res.status(400).json({ message: "Missing trackingId" });

      const domain = await storage.getTrackedDomainByTrackingId(trackingId);
      if (!domain || !domain.isActive) return res.status(204).end();

      const ip = visitorIp(req);

      const ua = userAgent || req.headers["user-agent"] || "";

      if (isCrawler(ua)) {
        return res.json({ blocked: false, reason: "crawler" });
      }

      const domainSettings = (domain.settings as any) || {};
      const whitelistedIps = (domainSettings.vpnWhitelistedIps || "").split("\n").map((s: string) => s.trim()).filter(Boolean);
      if (whitelistedIps.includes(ip)) {
        return res.json({ blocked: false, reason: "whitelisted" });
      }

      const detectionMethods: string[] = [];
      let vpnDetected = false;

      const provider = identifyVpnProvider(ip);
      if (provider) {
        detectionMethods.push(`Known VPN provider: ${provider}`);
        vpnDetected = true;
      } else if (isDatacenterIp(ip)) {
        detectionMethods.push("Datacenter IP range");
        vpnDetected = true;
      }

      if (vpnSignals && typeof vpnSignals === "object") {
        // A leak is a public WebRTC address that differs from the address this
        // request came from. A normal (non-VPN) STUN answer is the visitor's own
        // public IP, so it matches and is not flagged. Only IPv4 is compared.
        // The old boolean webrtcLeak / timezoneMismatch signals (still sent by
        // cached copies of the previous script) are ignored: they flagged
        // ordinary visitors.
        const webrtcIps: string[] = Array.isArray(vpnSignals.webrtcIps)
          ? vpnSignals.webrtcIps.slice(0, 10).map((v: unknown) => String(v).trim()).filter(isPublicIpv4)
          : [];
        if (isIP(ip) === 4 && webrtcIps.some(w => w !== ip)) {
          detectionMethods.push("WebRTC IP leak detected");
          vpnDetected = true;
        }
        if (vpnSignals.vpnExtension === true) {
          detectionMethods.push("VPN browser extension detected");
          vpnDetected = true;
        }
      }

      if (vpnDetected) {
        const settings = (domain.settings as any) || {};
        const blockMode = ["block", "log", "redirect"].includes(settings.vpnBlockMode) ? settings.vpnBlockMode : "block";
        const redirectUrl = blockMode === "redirect" ? safeRedirectUrl(settings.vpnRedirectUrl) : null;
        const geo = edgeGeo(req);

        await storage.createVpnVisit({
          domainId: domain.id,
          ipAddress: ip,
          userAgent: ua,
          fingerprint: fingerprint || null,
          browser: browser || null,
          os: os || null,
          deviceType: deviceType || null,
          country: geo.country,
          city: geo.city,
          referrer: referrer || null,
          landingPage: landingPage || null,
          vpnProvider: provider || "Unknown VPN/Proxy",
          detectionMethod: detectionMethods.join("; "),
          action: blockMode,
        });

        return res.json({
          blocked: blockMode === "block",
          redirect: redirectUrl,
          reason: "vpn_detected",
          methods: detectionMethods,
        });
      }

      res.json({ blocked: false });
    } catch (err: any) {
      console.error("Error in VPN shield track:", err);
      res.status(500).json({ blocked: false });
    }
  });

  app.get("/api/vpn-shield/domains", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const domains = await storage.getTrackedDomains(user.id);
      const domainsWithStats = await Promise.all(
        domains.map(async (d) => {
          const vpnBlocks = await storage.getVpnVisits(d.id);
          const uniqueIps = new Set(vpnBlocks.map(v => v.ipAddress)).size;
          return {
            ...d,
            vpnStats: {
              totalBlocks: vpnBlocks.length,
              uniqueVpnIps: uniqueIps,
            },
          };
        })
      );
      res.json(domainsWithStats);
    } catch (err: any) {
      console.error("Error fetching VPN shield domains:", err);
      res.status(500).json({ message: "Failed to fetch domains" });
    }
  });

  app.get("/api/vpn-shield/domains/:id/stats", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) return res.status(404).json({ message: "Domain not found" });

      const allVisits = await storage.getVpnVisits(domain.id);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart.getTime() - 86400000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

      const todayBlocks = allVisits.filter(v => new Date(v.visitedAt) >= todayStart).length;
      const yesterdayBlocks = allVisits.filter(v => {
        const t = new Date(v.visitedAt);
        return t >= yesterdayStart && t < todayStart;
      }).length;
      const sevenDayBlocks = allVisits.filter(v => new Date(v.visitedAt) >= sevenDaysAgo).length;
      const thirtyDayBlocks = allVisits.filter(v => new Date(v.visitedAt) >= thirtyDaysAgo).length;

      const providerCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};
      for (const v of allVisits) {
        const p = v.vpnProvider || "Unknown";
        providerCounts[p] = (providerCounts[p] || 0) + 1;
        const c = v.country || "Unknown";
        countryCounts[c] = (countryCounts[c] || 0) + 1;
      }

      const topProviders = Object.entries(providerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      const topCountries = Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      res.json({
        total: allVisits.length,
        today: todayBlocks,
        yesterday: yesterdayBlocks,
        sevenDays: sevenDayBlocks,
        thirtyDays: thirtyDayBlocks,
        uniqueIps: new Set(allVisits.map(v => v.ipAddress)).size,
        topProviders,
        topCountries,
      });
    } catch (err: any) {
      console.error("Error fetching VPN stats:", err);
      res.status(500).json({ message: "Failed to fetch VPN stats" });
    }
  });

  app.get("/api/vpn-shield/domains/:id/blocked-visits", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) return res.status(404).json({ message: "Domain not found" });

      const visits = await storage.getVpnVisits(domain.id);
      res.json(visits);
    } catch (err: any) {
      console.error("Error fetching VPN blocked visits:", err);
      res.status(500).json({ message: "Failed to fetch blocked visits" });
    }
  });

  app.get("/api/vpn-shield/domains/:id/script", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) return res.status(404).json({ message: "Domain not found" });

      const apiUrl = canonicalAppOrigin();

      const scriptTag = `<!-- VPN Shield by ConstructHUB -->\n<script src="${apiUrl}/api/vpn-shield/script/${domain.trackingId}" async><\/script>`;

      res.json({
        scriptTag,
        trackingId: domain.trackingId,
        domain: domain.domain,
      });
    } catch (err: any) {
      console.error("Error generating VPN script:", err);
      res.status(500).json({ message: "Failed to generate script" });
    }
  });

  app.get("/api/vpn-shield/script/:trackingId", (req, res) => {
    const { trackingId } = req.params;
    const apiUrl = canonicalAppOrigin();

    const script = `(function(){
  if(window.__chVpnShieldLoaded)return;
  window.__chVpnShieldLoaded=true;
  var tid=${JSON.stringify(trackingId)};
  var api="${apiUrl}/api/vpn-shield/track";
  var crawlers=/Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou|facebookexternalhit|Twitterbot|LinkedInBot|Applebot|AdsBot-Google|Mediapartners-Google|msnbot/i;
  if(crawlers.test(navigator.userAgent))return;
  function fp(){
    try{
      var c=document.createElement("canvas");c.width=200;c.height=50;
      var ctx=c.getContext("2d");if(!ctx)return"no-canvas";
      ctx.textBaseline="top";ctx.font="14px Arial";
      ctx.fillStyle="#f60";ctx.fillRect(0,0,62,20);
      ctx.fillStyle="#069";ctx.fillText("VPNShield",2,15);
      var d=c.toDataURL();var h=0;
      for(var i=0;i<d.length;i++){h=((h<<5)-h)+d.charCodeAt(i);h=h&h;}
      return Math.abs(h).toString(36);
    }catch(e){return"err";}
  }
  function getDeviceType(){
    var ua=navigator.userAgent;
    if(/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua))return"mobile";
    if(/iPad|Android(?!.*Mobile)|Tablet/i.test(ua))return"tablet";
    return"desktop";
  }
  function getBrowser(){
    var ua=navigator.userAgent;
    if(ua.indexOf("Firefox")>-1)return"Firefox";
    if(ua.indexOf("Edg")>-1)return"Edge";
    if(ua.indexOf("Chrome")>-1)return"Chrome";
    if(ua.indexOf("Safari")>-1)return"Safari";
    return"Other";
  }
  function getOS(){
    var ua=navigator.userAgent;
    if(ua.indexOf("Win")>-1)return"Windows";
    if(ua.indexOf("Mac")>-1)return"macOS";
    if(ua.indexOf("Linux")>-1)return"Linux";
    if(ua.indexOf("Android")>-1)return"Android";
    if(ua.indexOf("iPhone")>-1||ua.indexOf("iPad")>-1)return"iOS";
    return"Other";
  }
  var privateIp=/^(0\\.|10\\.|127\\.|169\\.254\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.)/;
  function checkWebRTC(cb){
    var ips=[],done=false,pc=null;
    function finish(){
      if(done)return;done=true;
      try{if(pc)pc.close();}catch(e){}
      cb(ips);
    }
    try{
      pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
      pc.createDataChannel("");
      pc.onicecandidate=function(e){
        if(!e||!e.candidate){finish();return;}
        var m=(e.candidate.candidate||"").match(/([0-9]{1,3}(\\.[0-9]{1,3}){3})/);
        if(m&&m[1]&&!privateIp.test(m[1])&&ips.indexOf(m[1])===-1&&ips.length<10)ips.push(m[1]);
      };
      pc.createOffer().then(function(o){return pc.setLocalDescription(o);}).catch(finish);
      setTimeout(finish,3000);
    }catch(e){finish();}
  }
  function checkVpnExtensions(){
    var signs=["__vpn_ext","__nordvpn","__expressvpn","__surfshark","__cyberghost","__pia"];
    for(var i=0;i<signs.length;i++){
      if(document.querySelector("[data-"+signs[i]+"]")||window[signs[i]])return true;
    }
    var styles=document.querySelectorAll("style[data-vpn],link[href*='vpn']");
    return styles.length>0;
  }
  function send(signals){
    var data={
      trackingId:tid,fingerprint:fp(),deviceType:getDeviceType(),
      browser:getBrowser(),os:getOS(),
      referrer:document.referrer||"",landingPage:window.location.href,
      userAgent:navigator.userAgent,vpnSignals:signals
    };
    var body=JSON.stringify(data);
    var xhr=new XMLHttpRequest();
    xhr.open("POST",api,true);
    xhr.setRequestHeader("Content-Type","application/json");
    xhr.onload=function(){
      try{
        var r=JSON.parse(xhr.responseText);
        if(r.blocked){
          document.documentElement.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;font-family:system-ui"><div style="text-align:center;max-width:500px;padding:40px"><h1 style="font-size:2em;margin-bottom:16px">Access Restricted</h1><p style="color:#999;margin-bottom:24px">VPN or proxy connections are not allowed on this website. Please disable your VPN and try again.</p><p style="color:#666;font-size:12px">Protected by ConstructHUB VPN Shield</p></div></div>';
        }else if(r.redirect&&/^https?:\\/\\//i.test(r.redirect)){
          window.location.href=r.redirect;
        }
      }catch(e){}
    };
    xhr.send(body);
  }
  function detect(){
    // Public WebRTC candidates go to the server, which flags a leak only when one
    // differs from the address the request itself came from. (A browser time zone
    // says nothing about the network, so it is not a signal.)
    var signals={vpnExtension:checkVpnExtensions(),webrtcIps:[]};
    checkWebRTC(function(ips){
      signals.webrtcIps=ips;
      send(signals);
    });
  }
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",detect);}
  else{detect();}
})();`;

    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(script);
  });

  app.post("/api/vpn-shield/domains/:id/settings", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      const id = parseInt(req.params.id);
      const domain = await storage.getTrackedDomainById(id);
      if (!domain || domain.userId !== user.id) return res.status(404).json({ message: "Domain not found" });

      const input = z.object({
        vpnBlockMode: z.enum(["block", "log", "redirect"], { errorMap: () => ({ message: "Choose Block, Log only or Redirect" }) }).optional(),
        vpnRedirectUrl: z.string().max(2000).optional().nullable(),
        vpnWhitelistedIps: z.string().max(20000).optional().nullable(),
      }).safeParse(req.body ?? {});
      if (!input.success) return res.status(400).json({ message: firstZodMessage(input.error) });
      const vpnBlockMode = input.data.vpnBlockMode || "block";
      const vpnRedirectUrl = String(input.data.vpnRedirectUrl ?? "").trim();
      if (vpnBlockMode === "redirect" && !safeRedirectUrl(vpnRedirectUrl)) {
        return res.status(400).json({ message: "Redirect mode needs a full http:// or https:// link" });
      }
      if (vpnRedirectUrl && !safeRedirectUrl(vpnRedirectUrl)) {
        return res.status(400).json({ message: "The redirect link must start with http:// or https://" });
      }
      const whitelist = String(input.data.vpnWhitelistedIps ?? "").split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      const badIp = whitelist.find(ip => !isIP(ip));
      if (badIp) return res.status(400).json({ message: `"${badIp.slice(0, 60)}" is not a valid IP address (one IPv4 or IPv6 address per line)` });
      if (whitelist.length > 500) return res.status(400).json({ message: "Whitelist up to 500 IP addresses" });
      const currentSettings = (domain.settings as any) || {};
      const newSettings = {
        ...currentSettings,
        vpnBlockMode,
        vpnRedirectUrl: vpnRedirectUrl ? safeRedirectUrl(vpnRedirectUrl)! : "",
        vpnWhitelistedIps: whitelist.join("\n"),
      };

      await storage.updateTrackedDomainSettings(id, newSettings);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving VPN settings:", err);
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  const SEO_PACKAGES: Record<string, { name: string; monthlyPrice: number; totalPrice: number; termMonths: number }> = {
    dfy_seo_first_page: { name: "First Page SEO", monthlyPrice: 300000, totalPrice: 1800000, termMonths: 6 },
    dfy_seo_growth: { name: "SEO Growth", monthlyPrice: 600000, totalPrice: 3600000, termMonths: 6 },
    dfy_seo_domination: { name: "SEO Domination", monthlyPrice: 1000000, totalPrice: 6000000, termMonths: 6 },
    dfy_seo_ads: { name: "SEO & Ad Campaigns", monthlyPrice: 125000, totalPrice: 750000, termMonths: 6 },
  };

  app.post("/api/contracts/create", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { packageId } = req.body;
      if (!packageId || !SEO_PACKAGES[packageId]) {
        return res.status(400).json({ message: "Invalid package" });
      }

      const pkg = SEO_PACKAGES[packageId];
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const contract = await storage.createSeoContract({
        userId: user.id,
        email: user.email,
        token,
        packageId,
        packageName: pkg.name,
        monthlyPrice: pkg.monthlyPrice,
        totalPrice: pkg.totalPrice,
        termMonths: pkg.termMonths,
        status: "pending",
        expiresAt,
      });

      const baseUrl = getBaseUrl(req);
      await sendContractEmail(user.email, token, pkg.name, pkg.monthlyPrice, baseUrl);

      res.json({ contractId: contract.id, token, message: "Contract sent to your email" });
    } catch (err: any) {
      console.error("Error creating contract:", err);
      res.status(500).json({ message: "Failed to create contract" });
    }
  });

  app.get("/api/contracts/:token", async (req, res) => {
    try {
      const contract = await storage.getSeoContractByToken(req.params.token);
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      if (contract.status === "pending" && new Date() > contract.expiresAt) {
        await storage.updateSeoContract(contract.id, { status: "expired" });
        return res.status(410).json({ message: "Contract has expired" });
      }

      res.json({
        id: contract.id,
        email: contract.email,
        packageName: contract.packageName,
        monthlyPrice: contract.monthlyPrice,
        totalPrice: contract.totalPrice,
        termMonths: contract.termMonths,
        status: contract.status,
        signedAt: contract.signedAt,
        signerName: contract.signerName,
        companyName: contract.companyName,
        createdAt: contract.createdAt,
        expiresAt: contract.expiresAt,
      });
    } catch (err: any) {
      console.error("Error fetching contract:", err);
      res.status(500).json({ message: "Failed to load contract" });
    }
  });

  app.post("/api/contracts/:token/sign", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required. Please sign in to sign this contract." });

      const contract = await storage.getSeoContractByToken(req.params.token);
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      if (contract.userId !== user.id) {
        return res.status(403).json({ message: "This contract was not issued to your account." });
      }

      if (contract.status !== "pending") {
        return res.status(400).json({ message: `Contract is already ${contract.status}` });
      }

      if (new Date() > contract.expiresAt) {
        await storage.updateSeoContract(contract.id, { status: "expired" });
        return res.status(410).json({ message: "Contract has expired" });
      }

      const { signerName, companyName, signatureData, agreedToTerms, agreedToTermination, agreedToArbitration } = req.body;
      if (!signerName || !signatureData) {
        return res.status(400).json({ message: "Full legal name and signature are required" });
      }
      if (!agreedToTerms || !agreedToTermination || !agreedToArbitration) {
        return res.status(400).json({ message: "You must agree to all terms, termination policy, and arbitration clause" });
      }

      // Proxy-verified address (trust proxy), not a client-supplied X-Forwarded-For entry.
      const signerIp = visitorIp(req);

      const updated = await storage.updateSeoContract(contract.id, {
        status: "signed",
        signerName,
        companyName: companyName || null,
        signatureData: `SIGNED:${signerName}:${user.email}:${new Date().toISOString()}:IP:${signerIp}:CONSENTS:terms=${agreedToTerms},termination=${agreedToTermination},arbitration=${agreedToArbitration}`,
        signerIp,
        signedAt: new Date(),
      });

      res.json({ success: true, contractId: contract.id, status: "signed" });
    } catch (err: any) {
      console.error("Error signing contract:", err);
      res.status(500).json({ message: "Failed to sign contract" });
    }
  });

  app.get("/api/contracts/user/list", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const contracts = await storage.getSeoContractsByUser(user.id);
      res.json(contracts);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load contracts" });
    }
  });

  app.post("/api/contracts/:token/checkout", async (req, res) => {
    try {
      const contract = await storage.getSeoContractByToken(req.params.token);
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      if (contract.status !== "signed") {
        return res.status(400).json({ message: "Contract must be signed before checkout" });
      }

      const user = (req as any).user;
      if (!user || user.id !== contract.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-01-27.acacia" as any });

      const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
      let customerId: string;
      if (existingSub?.stripeCustomerId) {
        customerId = existingSub.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({ email: user.email, metadata: { userId: String(user.id) } });
        customerId = customer.id;
        if (existingSub) {
          await db.update(subscriptions).set({ stripeCustomerId: customer.id }).where(eq(subscriptions.id, existingSub.id));
        } else {
          await db.insert(subscriptions).values({ userId: user.id, stripeCustomerId: customer.id, plan: "free", status: "inactive" });
        }
      }

      const baseUrl = getBaseUrl(req);

      const sessionParams: any = {
        customer: customerId,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              // This checkout is ONE upfront charge for the whole term (mode "payment"),
              // so say that here rather than implying a monthly subscription.
              name: `ConstructHUB ${contract.packageName} — ${contract.termMonths}-Month Agreement, paid in full`,
              // Describe this charge only: the signed contract text (section 3 renewal) is an
              // open owner decision, so the receipt must not promise what happens after the term.
              description: `One-time payment today covering all ${contract.termMonths} months (equivalent to $${(contract.monthlyPrice / 100).toLocaleString()}/mo). This checkout does not start a monthly subscription. Contract #${contract.id}`,
            },
            unit_amount: contract.totalPrice,
          },
          quantity: 1,
        }],
        success_url: `${baseUrl}/contract/sign/${contract.token}?payment_success=true`,
        cancel_url: `${baseUrl}/contract/sign/${contract.token}?payment_canceled=true`,
        metadata: {
          userId: String(user.id),
          type: "seo_contract",
          contractId: String(contract.id),
          packageId: contract.packageId,
        },
      };

      if (contract.totalPrice >= 500000) {
        sessionParams.payment_method_types = ["card", "us_bank_account"];
        sessionParams.payment_method_options = {
          us_bank_account: { financial_connections: { permissions: ["payment_method"] } },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      await storage.updateSeoContract(contract.id, { stripeSessionId: session.id });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Error creating contract checkout:", err);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/reviews/create", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { clientName, clientEmail, clientPhone, clientAddress, templateId, projectDescription, personalMessage, photos, emailTheme, bccEmail, scheduledFor } = req.body;
      if (!clientName || !clientEmail) {
        return res.status(400).json({ message: "Client name and email are required" });
      }

      if (typeof clientEmail !== "string" || !z.string().email().safeParse(clientEmail.trim()).success) return res.status(400).json({ message: "Valid client email required" });
      if (await isReviewSuppressed(user.id, clientEmail)) return res.status(409).json({ message: "This recipient has unsubscribed from your review requests. Only the customer can resubscribe." });

      const [fullUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      let googleProfileUrl = fullUser.googleProfileUrl || "";
      let templateDesc = "";

      if (templateId) {
        const templates = await storage.getReviewTemplatesByUser(user.id);
        const template = templates.find(t => t.id === templateId);
        if (template) {
          googleProfileUrl = template.googleProfileUrl;
          templateDesc = template.projectDescription || "";
        }
      }

      if (!googleProfileUrl) {
        return res.status(400).json({ message: "Google Profile URL is required. Set it in your profile settings or create a review template." });
      }

      const companyName = fullUser.companyName || fullUser.displayName || "Our Company";
      const companyLogoUrl = fullUser.companyLogoUrl || null;

      const token = randomUUID();
      const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
      const scheduledDate = isScheduled ? new Date(scheduledFor) : null;

      const request = await storage.createReviewRequest({
        userId: user.id,
        clientName,
        clientEmail,
        clientPhone: clientPhone || null,
        clientAddress: clientAddress || null,
        companyName,
        googleProfileUrl,
        projectDescription: projectDescription || templateDesc || null,
        personalMessage: personalMessage || null,
        photos: photos || [],
        token,
        status: isScheduled ? "scheduled" : "sent",
        emailTheme: emailTheme || "navy-orange",
        bccEmail: bccEmail || null,
        scheduledFor: scheduledDate,
      });

      if (request.unsubscribed || await isReviewSuppressed(request.userId, request.clientEmail)) return res.status(409).json({ message: "Recipient has unsubscribed" });
      if (!isScheduled) {
        const baseUrl = getBaseUrl(req);
        await sendReviewRequestEmail(clientEmail, clientName, companyName, companyLogoUrl, token, baseUrl, emailTheme, personalMessage || undefined, bccEmail || undefined);

        const reminderSettings = await storage.getReminderSettings(user.id);
        if (reminderSettings?.enabled !== false) {
          const firstReminderTime = calculateNextReminderTime(reminderSettings, 0);
          await storage.updateReviewRequest(request.id, { nextReminderAt: firstReminderTime });
        }
      }

      const message = isScheduled
        ? `Review request scheduled for ${scheduledDate!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "Review request sent";
      res.json({ id: request.id, token, message });
    } catch (err: any) {
      console.error("Error creating review request:", err);
      res.status(500).json({ message: "Failed to create review request" });
    }
  });

  app.get("/api/reviews/list", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const requests = await storage.getReviewRequestsByUser(user.id);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load review requests" });
    }
  });

  app.get("/api/review-templates", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const templates = await storage.getReviewTemplatesByUser(user.id);
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load templates" });
    }
  });

  app.post("/api/review-templates", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const existing = await storage.getReviewTemplatesByUser(user.id);
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
      const plan = sub?.plan || "free";
      const planLimits: Record<string, number> = {
        free: 1, standard: 1, professional: 5, business: 5, premium: 20, gold: 20, platinum: 20
      };
      const max = planLimits[plan] || 1;
      if (existing.length >= max) {
        return res.status(403).json({ message: `Template limit reached (${max}). Upgrade your plan for more.`, limit: max });
      }

      const { name, googleProfileUrl, projectDescription, isDefault } = req.body;
      if (!name || !googleProfileUrl) {
        return res.status(400).json({ message: "Template name and Google Profile URL are required" });
      }

      const resolvedProfileUrl = await resolveReviewLink(googleProfileUrl);
      if (!resolvedProfileUrl) return res.status(400).json({ message: GOOGLE_REVIEW_LINK_MESSAGE });

      if (isDefault) {
        for (const t of existing) {
          if (t.isDefault) await storage.updateReviewTemplate(t.id, { isDefault: false });
        }
      }

      const template = await storage.createReviewTemplate({
        userId: user.id,
        name,
        googleProfileUrl: resolvedProfileUrl,
        projectDescription: projectDescription || null,
        isDefault: isDefault || existing.length === 0,
      });
      res.json(template);
    } catch (err: any) {
      console.error("Error creating template:", err);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  app.patch("/api/review-templates/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const templates = await storage.getReviewTemplatesByUser(user.id);
      if (!templates.find(t => t.id === id)) return res.status(404).json({ message: "Not found" });

      const { name, googleProfileUrl, projectDescription, isDefault } = req.body;
      if (name !== undefined && !String(name).trim()) {
        return res.status(400).json({ message: "Template name is required" });
      }
      if (googleProfileUrl !== undefined && !String(googleProfileUrl).trim()) {
        return res.status(400).json({ message: "Google Profile URL is required" });
      }
      const updateData: any = {};
      if (name !== undefined) updateData.name = String(name).trim();
      if (googleProfileUrl !== undefined) {
        const resolvedProfileUrl = await resolveReviewLink(googleProfileUrl);
        if (!resolvedProfileUrl) return res.status(400).json({ message: GOOGLE_REVIEW_LINK_MESSAGE });
        updateData.googleProfileUrl = resolvedProfileUrl;
      }
      if (projectDescription !== undefined) updateData.projectDescription = projectDescription || null;
      if (isDefault === true) {
        for (const t of templates) {
          if (t.isDefault && t.id !== id) await storage.updateReviewTemplate(t.id, { isDefault: false });
        }
        updateData.isDefault = true;
      } else if (isDefault === false) {
        updateData.isDefault = false;
      }

      const template = await storage.updateReviewTemplate(id, updateData);
      res.json(template);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  app.delete("/api/review-templates/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const templates = await storage.getReviewTemplatesByUser(user.id);
      if (!templates.find(t => t.id === id)) return res.status(404).json({ message: "Not found" });
      await storage.deleteReviewTemplate(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  app.get("/api/reviews/trash", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      await storage.purgeExpiredTrash();
      const trashed = await storage.getTrashedReviewRequests(user.id);
      res.json(trashed);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load trash" });
    }
  });

  app.delete("/api/reviews/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const requests = await storage.getReviewRequestsByUser(user.id);
      const request = requests.find(r => r.id === id);
      if (!request) return res.status(404).json({ message: "Not found" });
      await storage.deleteReviewRequest(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete review request" });
    }
  });

  app.post("/api/reviews/:id/restore", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const trashed = await storage.getTrashedReviewRequests(user.id);
      const request = trashed.find(r => r.id === id);
      if (!request) return res.status(404).json({ message: "Not found in trash" });
      await storage.restoreReviewRequest(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to restore" });
    }
  });

  app.delete("/api/reviews/:id/permanent", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const trashed = await storage.getTrashedReviewRequests(user.id);
      const request = trashed.find(r => r.id === id);
      if (!request) return res.status(404).json({ message: "Not found in trash" });
      await storage.permanentlyDeleteReviewRequest(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to permanently delete" });
    }
  });

  app.get("/api/google-profile-reviews", async (req, res) => {
    try {
      const user = getDevUser(req, res);
      if (!user) return;
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const rating = req.query.rating ? parseInt(req.query.rating as string) : undefined;
      const response = req.query.response as string | undefined;
      const search = req.query.search as string | undefined;

      let reviews = await db
        .select()
        .from(googleProfileReviews)
        .where(and(eq(googleProfileReviews.userId, user.id), eq(googleProfileReviews.googleDeleted, false)))
        .orderBy(desc(googleProfileReviews.reviewDate));

      if (locationId) {
        reviews = reviews.filter(r => r.locationId === locationId);
      }
      if (rating && rating >= 1 && rating <= 5) {
        reviews = reviews.filter(r => r.rating === rating);
      }
      if (response === "answered") {
        reviews = reviews.filter(r => r.replyComment);
      } else if (response === "unanswered") {
        reviews = reviews.filter(r => !r.replyComment);
      }
      if (search) {
        const q = search.toLowerCase();
        reviews = reviews.filter(r =>
          r.reviewerName?.toLowerCase().includes(q) ||
          r.comment?.toLowerCase().includes(q) ||
          r.replyComment?.toLowerCase().includes(q)
        );
      }

      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/google-profile-reviews", async (req, res) => {
    try {
      const user = getDevUser(req, res);
      if (!user) return;
      const { reviewerName, rating, comment, reviewDate, locationId, templateId, replyComment, replyDate } = req.body;
      if (typeof reviewerName !== "string" || !reviewerName.trim() || !Number.isInteger(rating) || rating < 1 || rating > 5 || !Number.isFinite(Date.parse(reviewDate))) {
        return res.status(400).json({ message: "reviewerName, rating, and reviewDate are required" });
      }
      if (locationId) {
        const [owned] = await db.select({id:businessLocations.id}).from(businessLocations).where(and(eq(businessLocations.id, Number(locationId)),eq(businessLocations.userId,user.id)));
        if (!owned) return res.status(404).json({message:"Location not found"});
      }
      const [review] = await db.insert(googleProfileReviews).values({
        userId: user.id,
        locationId: locationId || null,
        templateId: templateId || null,
        reviewerName,
        rating,
        comment: comment || null,
        reviewDate: new Date(reviewDate),
        replyDraft: replyComment || null,
        replyStatus: "draft",
      }).returning();
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/google-profile-reviews/:id/note", async (req, res) => {
    try {
      const user = getDevUser(req, res);
      if (!user) return;
      const id = parseInt(req.params.id);
      const { internalNote } = req.body;
      const [updated] = await db
        .update(googleProfileReviews)
        .set({ internalNote, updatedAt: new Date() })
        .where(and(eq(googleProfileReviews.id, id), eq(googleProfileReviews.userId, user.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/google-profile-reviews/:id", async (req, res) => {
    try {
      const user = getDevUser(req, res);
      if (!user) return;
      const id = parseInt(req.params.id);
      await db.delete(googleProfileReviews)
        .where(and(eq(googleProfileReviews.id, id), eq(googleProfileReviews.userId, user.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/reviews/:id/resend", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const id = parseInt(req.params.id);
      const requests = await storage.getReviewRequestsByUser(user.id);
      const request = requests.find(r => r.id === id);
      if (!request) return res.status(404).json({ message: "Not found" });

      if (request.unsubscribed || await isReviewSuppressed(request.userId, request.clientEmail)) return res.status(409).json({ message: "This customer unsubscribed from this review request." });

      const [fullUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      const companyLogoUrl = fullUser?.companyLogoUrl || null;

      const baseUrl = getBaseUrl(req);
      await sendReviewRequestEmail(request.clientEmail, request.clientName, request.companyName || "Our Company", companyLogoUrl, request.token, baseUrl, request.emailTheme);

      // A customer who already answered keeps their recorded outcome, and no
      // reminders are re-armed for them (reminders only go to status 'sent').
      const answered = request.feedbackRating != null || request.reviewSubmitted || request.lastStep === "done"
        || ["positive_feedback", "negative_feedback"].includes(request.status);
      if (answered) {
        await storage.updateReviewRequest(id, { nextReminderAt: null });
        return res.json({ success: true, alreadyResponded: true, message: "Email resent. This customer already responded, so their answer is kept and no reminders were scheduled." });
      }
      const reminderSettings = await storage.getReminderSettings(user.id);
      const nextTime = (reminderSettings?.enabled !== false) ? calculateNextReminderTime(reminderSettings, 0) : null;
      await storage.updateReviewRequest(id, {
        status: "sent",
        remindersSent: 0,
        nextReminderAt: nextTime,
      });

      res.json({ success: true, message: "Review request resent" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to resend" });
    }
  });

  app.get("/api/review/:token/pixel.png", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (request && !request.emailOpened) {
        await storage.updateReviewRequest(request.id, {
          emailOpened: true,
          emailOpenedAt: new Date(),
        });
      }
    } catch (e) {}
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    res.set({ "Content-Type": "image/png", "Content-Length": pixel.length.toString(), "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", "Pragma": "no-cache", "Expires": "0" });
    res.end(pixel);
  });

  app.get("/api/review/:token/click", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (request && isOwnerPreview(req, request)) {
        res.redirect(`/review/${req.params.token}`);
      } else if (request) {
        const updates: any = {
          linkClicked: true,
          linkClickedAt: new Date(),
        };
        if (!request.emailOpened) {
          updates.emailOpened = true;
          updates.emailOpenedAt = new Date();
        }
        await storage.updateReviewRequest(request.id, updates);
        res.redirect(`/review/${req.params.token}`);
      } else {
        res.redirect("/");
      }
    } catch (e) {
      res.redirect("/");
    }
  });

  app.get("/api/review/:token", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Review request not found" });

      // The owner's preview (eye icon) opens this same page: never record it as the customer's open/click.
      const preview = isOwnerPreview(req, request);
      if (!preview && !request.linkClicked) {
        const updates: any = {
          linkClicked: true,
          linkClickedAt: new Date(),
        };
        if (!request.emailOpened) {
          updates.emailOpened = true;
          updates.emailOpenedAt = new Date();
        }
        await storage.updateReviewRequest(request.id, updates);
      }

      let companyLogoUrl = null;
      if (request.userId) {
        const [owner] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
        if (owner?.companyLogoUrl) {
          companyLogoUrl = owner.companyLogoUrl;
        }
      }

      res.json({
        id: request.id,
        clientName: request.clientName,
        companyName: request.companyName,
        companyLogoUrl,
        googleProfileUrl: request.googleProfileUrl,
        projectDescription: request.projectDescription,
        photos: request.photos,
        status: request.status,
        feedbackRating: request.feedbackRating,
        reviewSubmitted: request.reviewSubmitted,
        referralOffer: await getReferralSettings(request.userId).then(s => s.enabled ? s.offer : null),
        preview,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load review" });
    }
  });

  app.post("/api/review/:token/feedback", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Review request not found" });

      const { rating, categories, comments } = req.body;
      if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
        return res.status(400).json({ message: "Rating must be between 1 and 10" });
      }

      if (isOwnerPreview(req, request)) return res.json({ success: true, showReview: true, preview: true, recorded: false });

      const status = rating >= 9 ? "positive_feedback" : "negative_feedback";
      await storage.updateReviewRequest(request.id, {
        feedbackRating: rating,
        feedbackCategories: categories || null,
        feedbackComments: comments || null,
        status,
        nextReminderAt: null,
      });

      res.json({ success: true, showReview: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.post("/api/review/:token/google-link-opened", async (req, res) => {
    const request = await storage.getReviewRequestByToken(String(req.params.token));
    if (!request) return res.status(404).json({ message: "Not found" });
    if (isOwnerPreview(req, request)) return res.json({ success: true, preview: true, recorded: false });
    await storage.updateReviewRequest(request.id, { googleLinkOpened: true, googleLinkOpenedAt: request.googleLinkOpenedAt || new Date() });
    res.json({ success: true });
  });

  // Backward-compatible completion endpoint. A client cannot verify Google publication.
  app.post(["/api/review/:token/complete", "/api/review/:token/mark-reviewed"], async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      if (isOwnerPreview(req, request)) return res.json({ success: true, preview: true, recorded: false });
      if (!request.feedbackRating) {
        return res.status(409).json({ message: "Submit a rating first" });
      }

      const referral = await getReferralSettings(request.userId);
      await storage.updateReviewRequest(request.id, {
        lastStep: "done",
        nextReminderAt: null,
        referralOptIn: referral.enabled && req.body.referralOptIn === true,
        referralFeedback: referral.enabled && ["up", "down"].includes(req.body.referralFeedback) ? req.body.referralFeedback : null,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update" });
    }
  });

  app.post("/api/review/:token/generate-review", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      if (isOwnerPreview(req, request)) {
        return res.status(409).json({ message: "Preview only: AI drafts are created from your customer's own link after they rate.", preview: true });
      }
      if (!request.feedbackRating) {
        return res.status(409).json({ message: "Submit a rating first" });
      }
      const { highlights } = req.body;
      if (typeof highlights !== "string" || !highlights.trim() || highlights.length > 4000) {
        return res.status(400).json({ message: "Describe your own experience before creating a draft." });
      }
      if (!(await takeBudget(`review-draft:owner:${request.userId}`, 50)) || !(await takeBudget(`review-draft:request:${request.id}`, 5, 1, 86400_000))) {
        return res.status(429).json({ message: "Draft limit reached. You can still write your own review directly on Google." });
      }
      const prompt = reviewDraftPrompt(request.companyName || "the company", request.feedbackRating, highlights.trim());

      const response = await photoOpenai.chat.completions.create({
        model: aiModel(),
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.8,
      });

      const review = response.choices[0]?.message?.content?.trim() || "";
      await storage.updateReviewRequest(request.id, { reviewMethod: "ai" });
      res.json({ review });
    } catch (err: any) {
      console.error("Error generating review:", err);
      res.status(500).json({ message: "Failed to generate review" });
    }
  });

  app.post("/api/review/:token/track-photos", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      if (isOwnerPreview(req, request)) return res.json({ ok: true, preview: true, recorded: false });
      if (!request.photosDownloaded) {
        await storage.updateReviewRequest(request.id, {
          photosDownloaded: true,
          photosDownloadedAt: new Date(),
        });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to track" });
    }
  });

  app.post("/api/review/:token/track-review-method", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      if (isOwnerPreview(req, request)) return res.json({ ok: true, preview: true, recorded: false });
      const { method } = req.body;
      if (method === "own" || method === "ai") {
        await storage.updateReviewRequest(request.id, { reviewMethod: method });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to track" });
    }
  });

  app.post("/api/review/:token/track-step", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      if (isOwnerPreview(req, request)) return res.json({ ok: true, preview: true, recorded: false });
      const { step } = req.body;
      if (step && typeof step === "string") {
        await storage.updateReviewRequest(request.id, { lastStep: step });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to track" });
    }
  });

  app.post("/api/beta-codes/generate", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!isAdmin(user)) return res.status(403).json({ message: "Admin access required" });
      // Same second-factor wall as requirePlatformAdmin (see adminGuard).
      if (!platformGatePassed(req)) {
        return res.status(403).json({ message: "Admin sign-in required", gateRequired: true });
      }

      const { trialDays, recipientEmail, recipientName } = req.body || {};
      const isUnlimited = trialDays === 0;
      const days = isUnlimited ? 0 : Math.min(14, Math.max(1, trialDays || 2));
      const code = "TRIAL-" + randomUUID().slice(0, 8).toUpperCase();
      const expiresAt = isUnlimited ? new Date("2099-12-31T23:59:59Z") : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const betaCode = await storage.createBetaAccessCode({
        code,
        createdByUserId: user.id,
        expiresAt,
        trialDays: days,
        recipientEmail: recipientEmail || null,
        recipientName: recipientName || null,
        redeemedByUserId: null,
        redeemedAt: null,
        revoked: false,
        revokedAt: null,
      });

      if (recipientEmail) {
        try {
          const baseUrl = getBaseUrl(req);
          await sendTrialInviteEmail(recipientEmail, recipientName || "there", code, isUnlimited ? -1 : days, baseUrl);
        } catch (emailErr) {
          console.error("Failed to send trial invite email:", emailErr);
        }
      }

      res.json(betaCode);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate code" });
    }
  });

  app.get("/api/beta-codes", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!isAdmin(user)) return res.status(403).json({ message: "Admin access required" });
      // Same second-factor wall as requirePlatformAdmin (see adminGuard).
      if (!platformGatePassed(req)) {
        return res.status(403).json({ message: "Admin sign-in required", gateRequired: true });
      }

      const codes = await storage.getAllBetaAccessCodes();
      const enriched = await Promise.all(codes.map(async (c) => {
        let redeemedByUser = null;
        if (c.redeemedByUserId) {
          const [u] = await db.select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            companyName: users.companyName,
          }).from(users).where(eq(users.id, c.redeemedByUserId)).limit(1);
          redeemedByUser = u || null;
        }
        return { ...c, redeemedByUser };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch codes" });
    }
  });

  app.post("/api/beta-codes/revoke/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!isAdmin(user)) return res.status(403).json({ message: "Admin access required" });
      // Same second-factor wall as requirePlatformAdmin (see adminGuard).
      if (!platformGatePassed(req)) {
        return res.status(403).json({ message: "Admin sign-in required", gateRequired: true });
      }

      const id = parseInt(req.params.id);
      const code = await storage.revokeBetaAccessCode(id);
      if (!code) return res.status(404).json({ message: "Code not found" });

      if (code.redeemedByUserId) {
        const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, code.redeemedByUserId)).limit(1);
        if (sub && sub.plan === "platinum" && !sub.stripeSubscriptionId) {
          await db.update(subscriptions).set({
            status: "canceled",
            currentPeriodEnd: new Date(),
          }).where(eq(subscriptions.id, sub.id));
        }
      }

      res.json({ message: "Trial revoked", code });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to revoke code" });
    }
  });

  app.post("/api/beta-codes/redeem", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { code } = req.body;
      if (!code || typeof code !== "string") return res.status(400).json({ message: "Code is required" });

      const betaCode = await storage.getBetaAccessCodeByCode(code.trim().toUpperCase());
      if (!betaCode) return res.status(404).json({ message: "Invalid code. Please check and try again." });
      if (betaCode.revoked) return res.status(400).json({ message: "This code has been revoked." });
      if (betaCode.redeemedByUserId) return res.status(400).json({ message: "This code has already been used." });
      if (new Date(betaCode.expiresAt) < new Date()) return res.status(400).json({ message: "This code has expired." });

      const redeemed = await storage.redeemBetaAccessCode(betaCode.id, user.id);

      const isUnlimited = betaCode.trialDays === 0;
      const trialEnd = isUnlimited ? new Date("2099-12-31T23:59:59Z") : new Date(Date.now() + betaCode.trialDays * 24 * 60 * 60 * 1000);

      const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
      if (existingSub) {
        await db.update(subscriptions).set({
          plan: "platinum",
          status: "active",
          currentPeriodEnd: trialEnd,
        }).where(eq(subscriptions.id, existingSub.id));
      } else {
        await db.insert(subscriptions).values({
          userId: user.id,
          plan: "platinum",
          status: "active",
          currentPeriodEnd: trialEnd,
        });
      }

      const msg = isUnlimited
        ? "Trial activated! You have unlimited Platinum access."
        : `Trial activated! You have full Platinum access for ${betaCode.trialDays} day${betaCode.trialDays > 1 ? "s" : ""}.`;
      res.json({ message: msg, expiresAt: trialEnd });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to redeem code" });
    }
  });

  app.get("/api/beta-codes/status", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const active = await storage.getActiveBetaAccess(user.id);
      if (active && !active.revoked) {
        res.json({ active: true, expiresAt: active.expiresAt, trialDays: active.trialDays });
      } else {
        res.json({ active: false });
      }
    } catch (err: any) {
      res.status(500).json({ message: "Failed to check status" });
    }
  });

  // Review Reminder Settings
  app.get("/api/review-referral-settings", async (req, res) => {
    const user = getDevUser(req, res); if (!user) return;
    res.json(await getReferralSettings(user.id));
  });
  app.put("/api/review-referral-settings", async (req, res) => {
    const user = getDevUser(req, res); if (!user) return;
    const parsed = referralSettingsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enabled offers need terms of 1–500 characters" });
    res.json(await saveReferralSettings(user.id, parsed.data));
  });

  app.get("/api/review-reminder-settings", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const settings = await storage.getReminderSettings(user.id);
      res.json(settings || {
        enabled: true,
        maxReminders: 3,
        intervalHours: 48,
        timeWindows: [{ start: 9, end: 12 }, { start: 15, end: 18 }, { start: 18, end: 21 }],
        timezone: "America/New_York",
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load settings" });
    }
  });

  app.put("/api/review-reminder-settings", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const parsed = reminderSettingsInput.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid reminder settings", errors: parsed.error.flatten() });
      const settings = await storage.upsertReminderSettings(user.id, parsed.data);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  // Unsubscribe page data
  app.get("/api/review/:token/unsubscribe-info", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });
      res.json({
        clientName: request.clientName,
        companyName: request.companyName,
        unsubscribed: await isReviewSuppressed(request.userId, request.clientEmail),
        hasSubmitted: request.status !== "sent",
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load" });
    }
  });

  // Unsubscribe + optional feedback
  app.post("/api/review/:token/unsubscribe", async (req, res) => {
    try {
      const request = await storage.getReviewRequestByToken(String(req.params.token));
      if (!request) return res.status(404).json({ message: "Not found" });

      const { feedback } = req.body;
      await unsubscribeRecipient(request.userId, request.clientEmail);
      const updateData: any = { unsubscribed: true, nextReminderAt: null };
      if (feedback) {
        updateData.feedbackComments = (request.feedbackComments || "") + (request.feedbackComments ? "\n[Unsubscribe feedback]: " : "[Unsubscribe feedback]: ") + feedback;
      }
      await storage.updateReviewRequest(request.id, updateData);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to unsubscribe" });
    }
  });

  app.post("/api/review/:token/resubscribe", async (req, res) => {
    if (req.body.confirm !== true) return res.status(400).json({ message: "Explicit confirmation is required" });
    const request = await storage.getReviewRequestByToken(String(req.params.token));
    if (!request) return res.status(404).json({ message: "Not found" });
    if (req.user?.id === request.userId) return res.status(403).json({ message: "Only the customer can resubscribe from their email link" });
    await resubscribeRecipient(request.userId, request.clientEmail);
    res.json({ success: true });
  });

  // Reminder scheduler — runs every 5 minutes
  async function processReminders() {
    try {
      const pending = await storage.getPendingReminders();
      for (const request of pending) {
        try {
          const settings = await storage.getReminderSettings(request.userId);
          const maxReminders = settings?.maxReminders ?? 3;
          const enabled = settings?.enabled !== false;

          if (!enabled || request.remindersSent >= maxReminders) {
            await storage.updateReviewRequest(request.id, { nextReminderAt: null });
            continue;
          }

          const baseUrl = canonicalAppOrigin();

          if (!inReminderWindow(settings)) {
            await storage.updateReviewRequest(request.id, { nextReminderAt: calculateNextReminderTime(settings, request.remindersSent) });
            continue;
          }

          let reminderLogoUrl: string | null = null;
          if (request.userId) {
            const [owner] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
            if (owner?.companyLogoUrl) reminderLogoUrl = owner.companyLogoUrl;
          }

          if (await isReviewSuppressed(request.userId, request.clientEmail)) continue;
          await sendReviewReminderEmail(
            request.clientEmail,
            request.clientName,
            request.companyName || "Our Company",
            reminderLogoUrl,
            request.token,
            baseUrl,
            request.remindersSent + 1,
            request.emailTheme,
            request.bccEmail || undefined,
          );

          const newCount = request.remindersSent + 1;
          const nextTime = newCount < maxReminders
            ? calculateNextReminderTime(settings, newCount)
            : null;

          await storage.updateReviewRequest(request.id, {
            remindersSent: newCount,
            lastReminderAt: new Date(),
            nextReminderAt: nextTime,
          });

          console.log(`Sent reminder #${newCount} to ${request.clientEmail} for review ${request.id}`);
        } catch (err) {
          console.error(`Failed to send reminder for review ${request.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Reminder scheduler error:", err);
    }
  }

  async function processScheduledReviews() {
    try {
      const scheduled = await storage.getScheduledReviews();

      for (const request of scheduled) {
        try {
          const [owner] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
          const companyLogoUrl = owner?.companyLogoUrl || null;

          const baseUrl = canonicalAppOrigin();

          if (await isReviewSuppressed(request.userId, request.clientEmail)) continue;
          await sendReviewRequestEmail(
            request.clientEmail,
            request.clientName,
            request.companyName || "Our Company",
            companyLogoUrl,
            request.token,
            baseUrl,
            request.emailTheme,
            request.personalMessage || undefined,
            request.bccEmail || undefined,
          );

          const reminderSettings = await storage.getReminderSettings(request.userId);
          const firstReminderTime = (reminderSettings?.enabled !== false)
            ? calculateNextReminderTime(reminderSettings, 0)
            : null;

          await storage.updateReviewRequest(request.id, {
            status: "sent",
            scheduledFor: null,
            nextReminderAt: firstReminderTime,
          });

          console.log(`Sent scheduled review request ${request.id} to ${request.clientEmail}`);
        } catch (err) {
          console.error(`Failed to send scheduled review ${request.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Scheduled review processor error:", err);
    }
  }

  setInterval(processReminders, 5 * 60 * 1000);
  setTimeout(processReminders, 30 * 1000);
  setInterval(processScheduledReviews, 2 * 60 * 1000);
  setTimeout(processScheduledReviews, 45 * 1000);

  app.get("/api/files/:folder/:subfolder/:filename", async (req, res) => {
    try {
      const key = `${req.params.folder}/${req.params.subfolder}/${req.params.filename}`;
      if (!key) return res.status(400).json({ message: "Missing file key" });

      const { body, contentType } = await getFromR2(key);
      if (!body) return res.status(404).json({ message: "File not found" });

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

      const nodeStream = body as any;
      if (typeof nodeStream.pipe === "function") {
        nodeStream.pipe(res);
      } else if (typeof nodeStream[Symbol.asyncIterator] === "function") {
        for await (const chunk of nodeStream) {
          res.write(chunk);
        }
        res.end();
      } else {
        const arrayBuf = await nodeStream.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      }
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ message: "File not found" });
      }
      console.error("Error serving R2 file:", err);
      res.status(500).json({ message: "Failed to serve file" });
    }
  });

  app.post("/api/upload/logo", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { imageData, type } = req.body;
      if (!imageData || typeof imageData !== "string") {
        return res.status(400).json({ message: "Missing image data" });
      }

      const match = imageData.match(/^data:image\/(jpeg|png|webp|gif);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ message: "Invalid image data format" });
      }

      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const buffer = Buffer.from(match[2], "base64");

      if (buffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ message: "Image too large (max 2MB)" });
      }

      const folder = type === "avatar" ? "avatars" : type === "gmb-logo" ? "logos/gmb" : "logos/company";
      const key = await uploadToR2(buffer, `image/${match[1]}`, folder, ext);
      const url = getR2Url(key);

      res.json({ url, key });
    } catch (err: any) {
      console.error("Error uploading logo to R2:", err);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

  app.post("/api/upload/review-photos", upload.array("photos", 10), async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const urls: { url: string; originalName: string; size: number }[] = [];
      for (const file of files) {
        const rawBuffer = fs.readFileSync(file.path);
        const ext = file.originalname.split(".").pop()?.toLowerCase() || "jpg";
        const key = await uploadToR2(rawBuffer, file.mimetype, "photos/reviews", ext);
        const url = getR2Url(key);
        urls.push({ url, originalName: file.originalname, size: file.size });
        fs.unlinkSync(file.path);
      }

      res.json({ photos: urls });
    } catch (err: any) {
      console.error("Error uploading review photos:", err);
      res.status(500).json({ message: "Failed to upload photos" });
    }
  });

  app.get("/api/files/:folder/:subfolder/:filename/download", async (req, res) => {
    try {
      const key = `${req.params.folder}/${req.params.subfolder}/${req.params.filename}`;
      const { body, contentType } = await getFromR2(key);
      if (!body) return res.status(404).json({ message: "File not found" });

      const originalName = req.query.name as string || req.params.filename;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${originalName}"`);
      res.setHeader("Cache-Control", "no-cache");

      const nodeStream = body as any;
      if (typeof nodeStream.pipe === "function") {
        nodeStream.pipe(res);
      } else if (typeof nodeStream[Symbol.asyncIterator] === "function") {
        for await (const chunk of nodeStream) {
          res.write(chunk);
        }
        res.end();
      } else {
        const arrayBuf = await nodeStream.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      }
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ message: "File not found" });
      }
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  const { getManagerConnection, fetchCampaigns, mutateCampaignBudget, mutateCampaignStatus, mutateCampaignSettings, createManagerLinkInvitation, listChildAccounts, detectLsaEnrollment, fetchAndStoreLeads, startManagerLeadSync } = await import("./lsa-manager");
  const { sendLsaCampaignPausedAlert } = await import("./email");
  startManagerLeadSync();

  function adminGuard(req: any, res: any): boolean {
    if (!req.isAuthenticated() || !isAdmin(req.user as any)) {
      res.status(403).json({ message: "Admin access required" });
      return false;
    }
    // Same second-factor wall as requirePlatformAdmin — the LSA console must
    // not be reachable on a session that never passed the admin gate.
    if (!platformGatePassed(req)) {
      res.status(403).json({ message: "Admin sign-in required", gateRequired: true });
      return false;
    }
    return true;
  }

  async function auditLog(actorId: number, actorEmail: string, action: string, targetCustomerId: string | null, targetAccountName: string | null, parameters: any, result: "success" | "error", errorMessage?: string) {
    try {
      await storage.createAdminAuditLog({ actorId, actorEmail, action, targetCustomerId: targetCustomerId || undefined, targetAccountName: targetAccountName || undefined, parameters, result, errorMessage });
    } catch (e) {
      console.error("Failed to write audit log:", e);
    }
  }

  app.get("/api/admin/lsa/manager", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const conn = await storage.getLsaManagerConnection();
      if (!conn) return res.json({ connected: false });
      res.json({
        connected: conn.status === "active",
        managerId: conn.managerId,
        connectedAt: conn.connectedAt,
        lastRefreshedAt: conn.lastRefreshedAt,
        status: conn.status,
        hasDeveloperToken: !!conn.developerToken,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/manager/connect", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const { managerId, refreshToken, developerToken } = req.body;
      if (!managerId || !refreshToken) {
        return res.status(400).json({ message: "managerId and refreshToken are required" });
      }
      const cleanId = String(managerId).replace(/-/g, "");
      if (!/^\d+$/.test(cleanId)) {
        return res.status(400).json({ message: "managerId must contain digits only" });
      }
      const conn = await storage.upsertLsaManagerConnection({
        managerId: cleanId,
        refreshToken,
        developerToken: developerToken || undefined,
        status: "active",
      });
      await auditLog((req.user as any).id, (req.user as any).email, "manager_connect", cleanId, null, { managerId: cleanId }, "success");
      res.json({ ok: true, managerId: conn.managerId, connectedAt: conn.connectedAt });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/manager/disconnect", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      await storage.disconnectLsaManagerConnection();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/manager/sync-accounts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const children = await listChildAccounts();
      let synced = 0;
      for (const child of children) {
        const isLsa = await detectLsaEnrollment(child.customerId, true);
        await storage.upsertLsaAccount({
          customerId: child.customerId,
          accountName: child.name,
          linkType: "central",
          linkStatus: "active",
          isLsaEnrolled: isLsa,
        });
        synced++;
      }
      await auditLog((req.user as any).id, (req.user as any).email, "sync_accounts", null, null, { synced }, "success");
      res.json({ ok: true, synced });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/lsa/accounts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const accounts = await storage.getLsaAccountsWithMetrics(limit, offset);
      const total = await storage.countLsaAccounts();
      res.json({ accounts, total, limit, offset });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/accounts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const { customerId, accountName, linkType } = req.body;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });
      const cleanId = String(customerId).replace(/-/g, "");
      if (!/^\d+$/.test(cleanId)) return res.status(400).json({ message: "customerId must be digits only" });
      const account = await storage.upsertLsaAccount({
        customerId: cleanId,
        accountName: accountName || null,
        linkType: linkType || "self",
        linkStatus: "active",
        isLsaEnrolled: false,
      });
      res.json(account);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/lsa/accounts/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });
      const leads = await storage.getLsaLeadsByAccount(account.id, 1, 50);
      res.json({ account, leads });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/accounts/:id/sync-leads", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });
      const useManager = account.linkType === "central" || account.linkType === "both";
      const result = await fetchAndStoreLeads(account.id, account.customerId, account.accountName || null, useManager, account.userId);
      await auditLog(
        (req.user as any).id, (req.user as any).email, "sync_leads",
        account.customerId, account.accountName || null,
        { imported: result.imported, newCharged: result.newCharged, useManager },
        result.ok ? "success" : "error", result.error
      );
      if (!result.ok) return res.status(502).json({ message: result.error });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/lsa/accounts/:id/campaigns", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });
      const useManager = account.linkType === "central" || account.linkType === "both";
      const campaigns = await fetchCampaigns(account.customerId, useManager, account.userId);
      res.json(campaigns);
    } catch (e: any) {
      res.status(500).json({ message: `Failed to fetch campaigns: ${e.message}` });
    }
  });

  const campaignSettingsSchema = z.object({
    campaignResourceName: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
  });

  app.patch("/api/admin/lsa/accounts/:id/campaigns/:campaignId/settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });

      const parseResult = campaignSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const { campaignResourceName, name } = parseResult.data;

      const useManager = account.linkType === "central" || account.linkType === "both";
      const result = await mutateCampaignSettings(account.customerId, campaignResourceName, { name }, useManager, account.userId);
      await auditLog(
        (req.user as any).id, (req.user as any).email, "campaign_settings_change",
        account.customerId, account.accountName || null,
        { campaignResourceName, name, useManager },
        result.ok ? "success" : "error", result.error
      );
      if (!result.ok) return res.status(502).json({ message: result.error });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const budgetMutateSchema = z.object({
    newDailyBudgetDollars: z.number().positive("Budget must be a positive number"),
    budgetResourceName: z.string().min(1).refine(v => v.includes("/campaignBudgets/"), {
      message: "budgetResourceName must be a valid Google Ads campaign budget resource name",
    }),
    campaignResourceName: z.string().min(1),
  });

  const statusMutateSchema = z.object({
    newStatus: z.enum(["ENABLED", "PAUSED"], { errorMap: () => ({ message: "newStatus must be ENABLED or PAUSED" }) }),
    campaignResourceName: z.string().min(1),
  });

  app.patch("/api/admin/lsa/accounts/:id/campaigns/:campaignId/budget", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });

      const parseResult = budgetMutateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const { newDailyBudgetDollars, budgetResourceName } = parseResult.data;

      const useManager = account.linkType === "central" || account.linkType === "both";
      const result = await mutateCampaignBudget(account.customerId, budgetResourceName, newDailyBudgetDollars, useManager, account.userId);
      await auditLog(
        (req.user as any).id, (req.user as any).email, "budget_change",
        account.customerId, account.accountName || null,
        { budgetResourceName, newDailyBudgetDollars, useManager },
        result.ok ? "success" : "error", result.error
      );
      if (!result.ok) return res.status(502).json({ message: result.error });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/lsa/accounts/:id/campaigns/:campaignId/status", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const account = await storage.getLsaAccountById(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });

      const parseResult = statusMutateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const { newStatus, campaignResourceName } = parseResult.data;

      const useManager = account.linkType === "central" || account.linkType === "both";
      const result = await mutateCampaignStatus(account.customerId, campaignResourceName, newStatus, useManager, account.userId);
      await auditLog(
        (req.user as any).id, (req.user as any).email,
        newStatus === "PAUSED" ? "campaign_pause" : "campaign_enable",
        account.customerId, account.accountName || null,
        { campaignResourceName, newStatus, useManager },
        result.ok ? "success" : "error", result.error
      );
      if (!result.ok) return res.status(502).json({ message: result.error });

      if (newStatus === "PAUSED") {
        let campaignName = campaignResourceName;
        try {
          const campaigns = await fetchCampaigns(account.customerId, useManager, account.userId);
          const match = campaigns.find(c => c.resourceName === campaignResourceName);
          if (match) campaignName = match.name;
        } catch { /* best-effort label */ }
        sendLsaCampaignPausedAlert({
          accountName: account.accountName || null,
          customerId: account.customerId,
          campaignName,
          actorEmail: (req.user as any).email,
        }).catch(e => console.error("[lsa] paused-campaign alert failed:", e));
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/lsa/invitations", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const invitations = await storage.getLsaManagerInvitations();
      res.json(invitations);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/lsa/invitations", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const { targetCustomerId, accountName, notes } = req.body;
      if (!targetCustomerId) return res.status(400).json({ message: "targetCustomerId is required" });
      const cleanId = String(targetCustomerId).replace(/-/g, "");
      if (!/^\d+$/.test(cleanId)) return res.status(400).json({ message: "targetCustomerId must be digits only" });

      const googleResult = await createManagerLinkInvitation(cleanId);
      const invitation = await storage.createLsaManagerInvitation({
        targetCustomerId: cleanId,
        accountName: accountName || null,
        status: "pending",
        createdByAdminId: (req.user as any).id,
        notes: notes || null,
        googleInvitationResourceName: googleResult.resourceName || null,
      });

      await auditLog(
        (req.user as any).id, (req.user as any).email, "manager_invite",
        cleanId, accountName || null,
        { targetCustomerId: cleanId, googleResult },
        googleResult.ok ? "success" : "error",
        googleResult.ok ? undefined : googleResult.error
      );

      res.json({ invitation, googleResult });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const invitationStatusSchema = z.object({
    status: z.enum(["accepted", "refused", "cancelled", "pending"], {
      errorMap: () => ({ message: "status must be: accepted, refused, cancelled, or pending" }),
    }),
    notes: z.string().max(1000).optional(),
  });

  app.patch("/api/admin/lsa/invitations/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const parseResult = invitationStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const { status, notes } = parseResult.data;
      const updated = await storage.updateLsaManagerInvitation(Number(req.params.id), {
        status,
        notes,
        resolvedAt: ["accepted", "refused", "cancelled"].includes(status) ? new Date() : undefined,
      });
      if (!updated) return res.status(404).json({ message: "Invitation not found" });

      if (status === "accepted") {
        await storage.upsertLsaAccount({
          customerId: updated.targetCustomerId,
          accountName: updated.accountName || null,
          linkType: "central",
          linkStatus: "active",
          isLsaEnrolled: false,
        });
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const DISPUTE_REASONS = [
    "spam_or_robot_call",
    "wrong_service",
    "wrong_location",
    "already_customer",
    "job_already_booked",
    "solicitation",
    "other",
  ] as const;

  const disputeSchema = z.object({
    reason: z.enum(DISPUTE_REASONS, {
      errorMap: () => ({
        message: `reason must be one of: ${DISPUTE_REASONS.join(", ")}`,
      }),
    }),
  });

  app.get("/api/admin/lsa/dispute-reasons", (req, res) => {
    if (!adminGuard(req, res)) return;
    res.json({ reasons: DISPUTE_REASONS });
  });

  app.post("/api/admin/lsa/leads/:leadId/dispute", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const parseResult = disputeSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: parseResult.error.errors[0].message });
      }
      const { reason } = parseResult.data;

      const lead = await storage.getLsaLeadById(Number(req.params.leadId));
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      let result;
      try {
        result = await storage.disputeLsaLead(lead.id, (req.user as any).id, reason);
      } catch (disputeErr: any) {
        return res.status(400).json({ message: disputeErr.message });
      }

      const account = await storage.getLsaAccountById(lead.accountId);
      await auditLog(
        (req.user as any).id, (req.user as any).email, "dispute_lead",
        account?.customerId || null, account?.accountName || null,
        { leadId: lead.id, reason },
        "success"
      );

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/lsa/audit-log", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const logs = await storage.getAdminAuditLog(limit, offset);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
