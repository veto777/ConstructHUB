import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { requireRecentAuth } from "../account-security";
import { oauthBaseUrl } from "../site-context";
import {
  routeFor,
  registerAssetRoutes,
  connectionNotice,
  type Auth,
} from "../cloudflare/routes";
import {
  ProviderError,
  ownedAsset,
  idInput,
  queue,
  budget,
  listInput,
  withinProperty,
} from "../cloudflare/common";
import { GSC_SCOPE } from "./client";
import {
  saveGscGrant,
  dimensions,
  indexingForUrls,
  locationSearchClicks,
} from "./service";
declare module "express-session" {
  interface SessionData {
    gscOAuth?: {
      state: string;
      userId: number;
      expires: number;
      redirect: string;
    };
  }
}
export function registerGscRoutes(
  app: Express,
  auth: Auth,
  http: typeof fetch = fetch,
) {
  registerAssetRoutes(app, auth, "gsc", http);
  const route = routeFor(app, auth);
  route("get", "/api/gsc/connect", async (req, res, user) => {
    if (!requireRecentAuth(req, res)) return;
    await budget(user, "connect");
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      throw new ProviderError("Google OAuth is not configured", 503);
    const state = randomBytes(32).toString("hex"),
      redirect = `${oauthBaseUrl(req)}/api/gsc/callback`;
    req.session.gscOAuth = {
      state,
      userId: user,
      expires: Date.now() + 600000,
      redirect,
    };
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirect,
      response_type: "code",
      scope: `openid email ${GSC_SCOPE}`,
      access_type: "offline",
      prompt: "consent select_account",
      state,
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  });
  route("get", "/api/gsc/callback", async (req, res, user) => {
    const pending = req.session.gscOAuth;
    delete req.session.gscOAuth;
    if (
      !pending ||
      pending.userId !== user ||
      pending.expires < Date.now() ||
      pending.state !== req.query.state ||
      typeof req.query.code !== "string"
    )
      return res.redirect("/search-console?connection=failed");
    try {
      const response = await http("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          code: req.query.code,
          redirect_uri: pending.redirect,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error();
      const tokens = await response.json();
      const identity = await http(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!identity.ok) throw new Error();
      const who = await identity.json();
      await saveGscGrant(user, who, tokens);
      await connectionNotice(req, user, "gsc", true, who.email);
      res.redirect("/search-console?connection=connected");
    } catch {
      res.redirect("/search-console?connection=failed");
    }
  });
  route("get", "/api/gsc/assets/:id/analytics", async (req, res, user) => {
    const a = await ownedAsset(user, idInput.parse(req.params.id), "gsc");
    const p = listInput
      .extend({
        dimension: z.enum(dimensions).default("date"),
        group: z.enum(["day", "week", "month"]).default("day"),
        start: z
          .string()
          .date()
          .default(
            new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10),
          ),
        end: z.string().date().default(new Date().toISOString().slice(0, 10)),
      })
      .parse(req.query);
    const v = [a.id, p.dimension, p.start, p.end, p.group, `%${p.q}%`];
    const sql = `SELECT to_char(date_trunc($5,date),'YYYY-MM-DD') date,key,sum(clicks) clicks,sum(impressions) impressions,
      sum(clicks)/NULLIF(sum(impressions),0) ctr,sum(position*impressions)/NULLIF(sum(impressions),0) position
      FROM gsc_analytics WHERE asset_id=$1 AND dimension=$2 AND date BETWEEN $3 AND $4 AND key ILIKE $6 GROUP BY 1,2`;
    const { rows } = await pool.query(
      `${sql} ORDER BY date DESC,clicks DESC,key LIMIT $7 OFFSET $8`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(`SELECT count(*)::int total FROM (${sql}) s`, v);
    const {
      rows: [work],
    } = await pool.query(
      "SELECT count(*)::int pending FROM edge_jobs WHERE asset_id=$1 AND user_id=$2 AND kind='analytics' AND state!='done'",
      [a.id, user],
    );
    res.json({
      items: rows,
      total: n.total,
      pendingJobs: work.pending,
      notice:
        "Google returns top rows, excludes some anonymized queries, and reports with a delay. CTR and position are weighted by impressions. Pending or failed jobs may leave incomplete results.",
    });
  });
  route("post", "/api/gsc/urls", async (req, res, user) => {
    const p = z
      .object({
        kind: z.enum(["inspect", "sitemap"]),
        items: z
          .array(
            z.object({ assetId: idInput, url: z.string().url().max(2048) }),
          )
          .min(1)
          .max(100),
        confirm: z.boolean().optional(),
      })
      .parse(req.body);
    if (p.kind === "sitemap" && p.confirm !== true)
      throw new ProviderError("Confirm sitemap submission first", 400);
    const assets = await Promise.all(
      p.items.map((i) => ownedAsset(user, i.assetId, "gsc")),
    );
    for (let i = 0; i < assets.length; i++) {
      if (!withinProperty(assets[i].external_id, p.items[i].url))
        throw new ProviderError(
          "URL must belong to its selected property",
          400,
        );
      if (p.kind === "sitemap" && assets[i].status === "siteRestrictedUser")
        throw new ProviderError("Full Search Console access is required", 403);
    }
    await budget(user, p.kind, p.items.length);
    for (let i = 0; i < assets.length; i++)
      await queue(user, assets[i].connection_id, assets[i].id, p.kind, {
        url: p.items[i].url,
      });
    res.status(202).json({ queued: assets.length });
  });
  route("get", "/api/gsc/assets/:id/inspections", async (req, res, user) => {
    const a = await ownedAsset(user, idInput.parse(req.params.id), "gsc"),
      p = listInput.parse(req.query),
      v = [a.id, `%${p.q}%`, p.status];
    const where =
      "asset_id=$1 AND url ILIKE $2 AND ($3='' OR result->'indexStatusResult'->>'verdict'=$3)";
    const { rows } = await pool.query(
      `SELECT url,result,inspected_at FROM gsc_inspections WHERE ${where} ORDER BY inspected_at DESC,url LIMIT $4 OFFSET $5`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM gsc_inspections WHERE ${where}`,
      v,
    );
    const { rows: coverage } = await pool.query(
      "SELECT result->'indexStatusResult'->>'verdict' verdict,count(*)::int count FROM gsc_inspections WHERE asset_id=$1 GROUP BY 1",
      [a.id],
    );
    res.json({
      items: rows,
      total: n.total,
      coverage,
      notice:
        "Coverage of inspected URLs only, not Google’s full Page Indexing report. Inspection does not request indexing.",
    });
  });
  route("get", "/api/gsc/assets/:id/sitemaps", async (req, res, user) => {
    const a = await ownedAsset(user, idInput.parse(req.params.id), "gsc"),
      p = listInput.parse(req.query);
    const { rows } = await pool.query(
      `SELECT value FROM edge_assets a,jsonb_array_elements(COALESCE(a.data->'sitemaps','[]')) value WHERE a.id=$1 AND a.user_id=$2 AND value->>'path' ILIKE $3 ORDER BY value->>'path' LIMIT $4 OFFSET $5`,
      [a.id, user, `%${p.q}%`, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM edge_assets a,jsonb_array_elements(COALESCE(a.data->'sitemaps','[]')) value WHERE a.id=$1 AND a.user_id=$2 AND value->>'path' ILIKE $3`,
      [a.id, user, `%${p.q}%`],
    );
    res.json({
      items: rows.map((r) => r.value),
      total: n.total,
      syncedAt: a.synced_at,
    });
  });
  route("get", "/api/gsc/scans/:id/indexing", async (req, res, user) => {
    const id = z.string().uuid().parse(req.params.id),
      p = listInput.parse(req.query);
    if (
      !(
        await pool.query(
          "SELECT id FROM sitescan_jobs WHERE id=$1 AND user_id=$2",
          [id, user],
        )
      ).rowCount
    )
      throw new ProviderError("Scan not found", 404);
    const from = `FROM sitescan_jobs j CROSS JOIN LATERAL jsonb_array_elements(j.state->'pages') page
      LEFT JOIN LATERAL (SELECT i.result,i.inspected_at FROM gsc_inspections i JOIN edge_assets a ON a.id=i.asset_id
        WHERE a.user_id=$2 AND i.url=page->>'url' ORDER BY i.inspected_at DESC LIMIT 1) inspection ON true
      WHERE j.id=$1 AND j.user_id=$2 AND page->>'url' ILIKE $3`;
    const v = [id, user, `%${p.q}%`];
    const { rows } = await pool.query(
      `SELECT page->>'url' url,inspection.result,inspection.inspected_at ${from} ORDER BY page->>'url' LIMIT $4 OFFSET $5`,
      [...v, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(`SELECT count(*)::int total ${from}`, v);
    res.json({ items: rows, total: n.total });
  });
  route("get", "/api/gsc/locations/:id/summary", async (req, res, user) => {
    const location = idInput.parse(req.params.id);
    if (
      !(
        await pool.query(
          "SELECT id FROM business_locations WHERE id=$1 AND user_id=$2",
          [location, user],
        )
      ).rowCount
    )
      throw new ProviderError("Location not found", 404);
    res.json({ search: await locationSearchClicks(user, location) });
  });
  route("post", "/api/gsc/locations/:id/indexing", async (req, res, user) => {
    const p = z
      .object({ urls: z.array(z.string().url().max(2048)).max(100) })
      .parse(req.body);
    res.json({
      items: await indexingForUrls(user, idInput.parse(req.params.id), p.urls),
    });
  });
}
