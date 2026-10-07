/**
 * /api/seo/* — the SEO toolset's API. Session auth through the platform's
 * getDevUser (an agency member acts as the workspace owner), plan-gated like
 * Site Scan (server/seo/plan.ts), every charged DataForSEO call reserved
 * against the monthly budget (server/seo/budget.ts). Without DataForSEO
 * credentials every endpoint still answers, with `configured: false`, and the
 * UI shows the "Connect DataForSEO" card.
 */
import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requirePlan } from "../entitlements";
import { budgetStatus, withBudget, SeoBudgetError, usd } from "./budget";
import {
  isConfigured, normalizeDomain, labsKeywordSuggestions, labsDomainIntersection, adsSearchVolume, DataForSeoError,
} from "./dataforseo";
import { estimateLabsUsd, estimateAdsVolumeUsd, estimateRankCheckUsd, estimateBacklinkSnapshotUsd, projectMonthlyRankTrackingUsd, PRICE_SHEET } from "./pricing";
import { enqueueRankRun, postQueuedRun, snapshotBacklinks, BACKLINK_ROWS, type SiteRow } from "./jobs";
import { seoAllowanceTest, SEO_FEATURE } from "./plan";

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
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  volumes: z.array(z.object({ keyword: z.string(), searchVolume: z.number().nullable(), cpc: z.number().nullable(), difficulty: z.number().nullable() })).max(500).optional(),
}).strict();
const researchInput = z.object({
  seed: z.string().trim().min(1).max(200),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
}).strict();
const competitorInput = z.object({ competitor: z.string().min(3).max(253) }).strict();
const id = z.coerce.number().int().positive();

export function registerSeoRoutes(app: Express, auth: (req: any, res: any) => any) {
  const route = (method: "get" | "post" | "delete", path: string, fn: (req: any, res: any, user: number) => Promise<any>) =>
    app[method](path, async (req, res, next) => {
      try {
        const u = auth(req, res);
        if (!u) return;
        const ent = await requirePlan(res, u.id, SEO_FEATURE, seoAllowanceTest);
        if (!ent) return;
        await fn(req, res, u.id);
      } catch (e: any) {
        if (e instanceof z.ZodError) return void res.status(400).json({ message: "Invalid input", issues: e.issues.slice(0, 3) });
        if (e instanceof SeoBudgetError) return void res.status(402).json({ code: e.code, message: e.message, remainingUsd: e.remainingUsd, estimateUsd: e.estimateUsd });
        if (e instanceof DataForSeoError) {
          const status = e.code === "not_configured" ? 503 : e.code === "auth" ? 502 : e.code === "rate_limited" ? 429 : e.code === "invalid" || e.code === "task_failed" ? 400 : 502;
          return void res.status(status).json({ code: `dataforseo_${e.code}`, message: e.message });
        }
        next(e);
      }
    });

  const ownedSite = async (user: number, siteId: unknown): Promise<SiteRow> => {
    const { rows: [site] } = await pool.query("SELECT * FROM seo_sites WHERE id=$1 AND user_id=$2", [id.parse(siteId), user]);
    if (!site) throw Object.assign(new z.ZodError([]), { message: "Site not found" });
    return site;
  };

  // Status: connection, budget, the price sheet the connect card quotes.
  route("get", "/api/seo/status", async (_req, res, user) => {
    const budget = await budgetStatus(user);
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: isConfigured(), budget, prices: PRICE_SHEET });
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
      pool.query("SELECT id, keyword, tags, search_volume, cpc::float8 AS cpc, difficulty FROM seo_keywords WHERE site_id=$1 ORDER BY keyword", [site.id]),
      pool.query(
        `SELECT keyword_id, device, position, url, checked_on::text AS checked_on, serp_features FROM (
           SELECT c.*, row_number() OVER (PARTITION BY keyword_id, device ORDER BY checked_on DESC) rn
           FROM seo_rank_checks c WHERE c.site_id=$1) x WHERE rn<=2 ORDER BY keyword_id, device, checked_on DESC`, [site.id]),
      pool.query("SELECT id, trigger, status, total, checked, cost_usd::float8 AS cost_usd, error, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 5", [site.id]),
      searchConsoleSummary(user, site.domain),
    ]);
    const latest = new Map<string, any>(), previous = new Map<string, any>();
    for (const c of checks) {
      const key = `${c.keyword_id}:${c.device}`;
      if (!latest.has(key)) latest.set(key, c); else if (!previous.has(key)) previous.set(key, c);
    }
    const devices = site.devices === "both" ? ["desktop", "mobile"] : [site.devices];
    const rows = keywords.map((k: any) => ({
      id: k.id, keyword: k.keyword, tags: k.tags ?? [], searchVolume: k.search_volume, cpc: k.cpc, difficulty: k.difficulty,
      positions: Object.fromEntries(devices.map((d) => {
        const l = latest.get(`${k.id}:${d}`), p = previous.get(`${k.id}:${d}`);
        return [d, l ? { position: l.position, url: l.url, checkedOn: l.checked_on, previous: p?.position ?? null, previousOn: p?.checked_on ?? null, features: l.serp_features ?? [] } : null];
      })),
    }));
    const primary = devices[0];
    const latestPositions = rows.map((r) => r.positions[primary]?.position ?? null);
    const ranked = latestPositions.filter((p): p is number => p !== null);
    const moved = rows.map((r) => { const p = r.positions[primary]; return p && p.position !== null && p.previous !== null ? p.previous - p.position : 0; });
    const summary = {
      tracked: rows.length,
      checked: ranked.length + latestPositions.filter((p, i) => p === null && rows[i].positions[primary]).length,
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      averagePosition: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
      improved: moved.filter((m) => m > 0).length,
      declined: moved.filter((m) => m < 0).length,
      lastCheckedOn: checks[0]?.checked_on ?? null,
    };
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    res.json({
      site: siteView({ ...site, keyword_count: keywords.length }), devices, summary, rows, runs, searchConsole: gsc,
      nextCheck: { serps: estimate.serps, estimateUsd: estimate.usd, monthlyUsd: projectMonthlyRankTrackingUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth) },
    });
  });

  route("post", "/api/seo/sites/:id/keywords", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const input = keywordsInput.parse(req.body);
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM seo_keywords WHERE site_id=$1", [site.id]);
    const unique = [...new Set(input.keywords.map((k) => k.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean))];
    if (n + unique.length > MAX_KEYWORDS_PER_SITE) return res.status(403).json({ message: `Up to ${MAX_KEYWORDS_PER_SITE} keywords per site.` });
    const volumes = new Map((input.volumes ?? []).map((v) => [v.keyword.toLowerCase(), v]));
    let added = 0;
    for (const keyword of unique) {
      const v = volumes.get(keyword);
      const r = await pool.query(
        `INSERT INTO seo_keywords(site_id,user_id,keyword,tags,search_volume,cpc,difficulty,volume_checked_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5::int IS NULL THEN NULL ELSE now() END)
         ON CONFLICT(site_id,keyword) DO UPDATE SET tags=(SELECT array(SELECT DISTINCT unnest(seo_keywords.tags || EXCLUDED.tags)))`,
        [site.id, user, keyword, input.tags, v?.searchVolume ?? null, v?.cpc ?? null, v?.difficulty ?? null]);
      added += r.rowCount ?? 0;
    }
    res.status(201).json({ added, total: n + unique.length });
  });

  route("delete", "/api/seo/keywords/:id", async (req, res, user) => {
    await pool.query("DELETE FROM seo_keywords WHERE id=$1 AND user_id=$2", [id.parse(req.params.id), user]);
    res.json({ ok: true });
  });

  // Search volume for keywords that have none yet (Google Ads data, one task per 1,000 keywords).
  route("post", "/api/seo/sites/:id/keywords/volumes", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return res.status(503).json({ configured: false, message: "Connect DataForSEO first." });
    const { rows } = await pool.query("SELECT id, keyword FROM seo_keywords WHERE site_id=$1 AND (volume_checked_at IS NULL OR volume_checked_at<now()-interval '30 days') ORDER BY id LIMIT 1000", [site.id]);
    if (!rows.length) return res.json({ updated: 0, costUsd: 0 });
    const out = await withBudget(user, estimateAdsVolumeUsd(rows.length), () => adsSearchVolume({ keywords: rows.map((r: any) => r.keyword), locationCode: site.location_code, languageCode: site.language_code }));
    const byKeyword = new Map(out.data.map((v) => [v.keyword.toLowerCase(), v]));
    let updated = 0;
    for (const r of rows) {
      const v = byKeyword.get(r.keyword.toLowerCase());
      if (!v) continue;
      await pool.query("UPDATE seo_keywords SET search_volume=$2, cpc=$3, volume_checked_at=now() WHERE id=$1", [r.id, v.searchVolume, v.cpc]);
      updated++;
    }
    res.json({ updated, costUsd: out.costUsd });
  });

  // Run now: a rank check on the standard queue (results arrive over the next minutes).
  route("post", "/api/seo/sites/:id/rank-check", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return res.status(503).json({ configured: false, message: "Connect DataForSEO first." });
    const { rows: keywords } = await pool.query("SELECT keyword FROM seo_keywords WHERE site_id=$1", [site.id]);
    if (!keywords.length) return res.status(400).json({ message: "Add keywords first." });
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    const budget = await budgetStatus(user);
    if (estimate.usd > budget.remainingUsd)
      return res.status(402).json({ code: "seo_budget", message: `This check needs about ${usd(estimate.usd)} and ${usd(budget.remainingUsd)} of the ${usd(budget.capUsd)} monthly SEO data budget is left.`, remainingUsd: budget.remainingUsd, estimateUsd: estimate.usd });
    const run = await enqueueRankRun(site, "manual");
    if (!run.reused) void postQueuedRun(run.id).catch((e) => console.error("[seo] run-now post failed", e?.message ?? e));
    res.status(202).json({ runId: run.id, reused: run.reused, serps: estimate.serps, estimateUsd: estimate.usd });
  });

  route("get", "/api/seo/sites/:id/runs", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query("SELECT id, trigger, status, total, checked, cost_usd::float8 AS cost_usd, error, created_at, started_at, finished_at FROM seo_rank_runs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 20", [site.id]);
    res.json(rows);
  });

  // Keyword research: seed → suggestions with volume / CPC / difficulty (Labs, up to 50 rows).
  route("post", "/api/seo/keywords/research", async (req, res, user) => {
    const input = researchInput.parse(req.body);
    if (!isConfigured()) return res.status(503).json({ configured: false, message: "Connect DataForSEO first." });
    const out = await withBudget(user, estimateLabsUsd(SUGGESTION_LIMIT), () => labsKeywordSuggestions({ keyword: input.seed, locationCode: input.locationCode, languageCode: input.languageCode, limit: SUGGESTION_LIMIT }));
    res.json({ seed: input.seed, items: out.data, costUsd: out.costUsd });
  });

  // Backlinks: the latest snapshot, and "Refresh now".
  route("get", "/api/seo/sites/:id/backlinks", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const { rows } = await pool.query(
      "SELECT id, taken_on::text AS taken_on, summary, backlinks, cost_usd::float8 AS cost_usd FROM seo_backlink_snapshots WHERE site_id=$1 ORDER BY taken_on DESC LIMIT 2", [site.id]);
    const [latest, previous] = rows;
    res.json({
      site: siteView(site), configured: isConfigured(),
      snapshot: latest ? { id: latest.id, takenOn: latest.taken_on, summary: latest.summary, backlinks: latest.backlinks, costUsd: latest.cost_usd } : null,
      previous: previous ? { takenOn: previous.taken_on, summary: previous.summary } : null,
      refreshEstimateUsd: estimateBacklinkSnapshotUsd(BACKLINK_ROWS),
      nextSnapshotAt: site.next_backlinks_at,
    });
  });

  route("post", "/api/seo/sites/:id/backlinks/refresh", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    if (!isConfigured()) return res.status(503).json({ configured: false, message: "Connect DataForSEO first." });
    const snap = await snapshotBacklinks(site);
    res.status(201).json(snap);
  });

  // Competitors: keywords a competitor ranks for that this site does not (Labs domain_intersection).
  route("post", "/api/seo/sites/:id/competitors", async (req, res, user) => {
    const site = await ownedSite(user, req.params.id);
    const competitor = normalizeDomain(competitorInput.parse(req.body).competitor);
    if (!competitor) return res.status(400).json({ message: "Enter the competitor's domain like example.com" });
    if (competitor === site.domain) return res.status(400).json({ message: "That is your own site." });
    if (!isConfigured()) return res.status(503).json({ configured: false, message: "Connect DataForSEO first." });
    const out = await withBudget(user, estimateLabsUsd(GAP_LIMIT), () => labsDomainIntersection({ competitor, ours: site.domain, locationCode: site.location_code, languageCode: site.language_code, limit: GAP_LIMIT }));
    res.json({ competitor, ours: site.domain, items: out.data.items, totalCount: out.data.totalCount, costUsd: out.costUsd });
  });
}

function siteView(s: any) {
  return {
    id: s.id, domain: s.domain, locationCode: s.location_code, languageCode: s.language_code, devices: s.devices, serpDepth: s.serp_depth,
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
