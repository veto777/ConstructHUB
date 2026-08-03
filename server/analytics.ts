/**
 * First-party visitor analytics — consent-gated.
 *
 * The cookie banner sets `ch_consent=granted|denied` (1 year). Only granted
 * browsers get a `ch_vid` visitor id and only THEIR pageviews are recorded —
 * a "denied" or unanswered browser sends nothing and stores nothing.
 *
 *   POST /api/analytics/consent  {granted}  — answer the banner (sets cookies)
 *   POST /api/analytics/events   {events:[{type,path,referrer}]}  — batched
 *   GET  /api/admin/analytics    — platform-admin rollup (visitors, IPs, trail)
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "./db";
import { chAnalyticsEvents, users } from "@shared/schema";
import { desc, eq, gte, sql } from "drizzle-orm";
import { requirePlatformAdmin } from "./crm/admin";

type GetUser = (req: any, res: any) => any;

const YEAR = 365 * 24 * 3600 * 1000;

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

function parseCookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookieOpts = "Path=/; Max-Age=31536000; SameSite=Lax";

export function registerAnalyticsRoutes(app: Express, getDevUser: GetUser): void {
  app.post("/api/analytics/consent", (req: any, res) => {
    const granted = req.body?.granted === true;
    const cookies: string[] = [`ch_consent=${granted ? "granted" : "denied"}; ${cookieOpts}`];
    if (granted) {
      const existing = parseCookies(req).ch_vid;
      cookies.push(`ch_vid=${existing || randomUUID()}; ${cookieOpts}`);
    } else {
      // Declined: drop the visitor id if one ever existed.
      cookies.push("ch_vid=; Path=/; Max-Age=0");
    }
    res.setHeader("Set-Cookie", cookies);
    res.json({ ok: true, granted });
  });

  app.post("/api/analytics/events", async (req: any, res) => {
    const cookies = parseCookies(req);
    // Consent is the gate, enforced server-side — a hand-crafted POST from a
    // browser that declined records nothing.
    if (cookies.ch_consent !== "granted" || !cookies.ch_vid) {
      return res.json({ ok: true, recorded: 0 });
    }
    const parsed = z.object({
      events: z.array(z.object({
        type: z.string().max(24).optional(),
        path: z.string().min(1).max(300),
        referrer: z.string().max(300).nullable().optional(),
      })).min(1).max(20),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false });

    // Signed-in identity, when there is one (no auth REQUIRED to be counted).
    let userId: number | null = null;
    try {
      const u = req.session?.passport?.user ?? req.user?.id ?? null;
      if (typeof u === "number") userId = u;
    } catch { /* anonymous is fine */ }

    const ip = clientIp(req);
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    await db.insert(chAnalyticsEvents).values(parsed.data.events.map((e) => ({
      visitorId: String(cookies.ch_vid).slice(0, 64),
      userId,
      type: e.type?.slice(0, 24) || "pageview",
      path: e.path,
      referrer: e.referrer || null,
      ip,
      userAgent: ua,
    })));
    res.json({ ok: true, recorded: parsed.data.events.length });
  });

  app.get("/api/admin/analytics", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);

    const [tot7] = await db.select({
      events: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${chAnalyticsEvents.visitorId})::int`,
    }).from(chAnalyticsEvents).where(gte(chAnalyticsEvents.createdAt, since7d));
    const [tot24] = await db.select({
      events: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${chAnalyticsEvents.visitorId})::int`,
    }).from(chAnalyticsEvents).where(gte(chAnalyticsEvents.createdAt, since24h));

    const topPages = await db.select({
      path: chAnalyticsEvents.path,
      views: sql<number>`count(*)::int`,
    }).from(chAnalyticsEvents).where(gte(chAnalyticsEvents.createdAt, since7d))
      .groupBy(chAnalyticsEvents.path).orderBy(desc(sql`count(*)`)).limit(10);

    const recent = await db.select({
      id: chAnalyticsEvents.id,
      visitorId: chAnalyticsEvents.visitorId,
      userId: chAnalyticsEvents.userId,
      path: chAnalyticsEvents.path,
      referrer: chAnalyticsEvents.referrer,
      ip: chAnalyticsEvents.ip,
      userAgent: chAnalyticsEvents.userAgent,
      createdAt: chAnalyticsEvents.createdAt,
      email: users.email,
    }).from(chAnalyticsEvents)
      .leftJoin(users, eq(chAnalyticsEvents.userId, users.id))
      .orderBy(desc(chAnalyticsEvents.createdAt)).limit(50);

    res.json({
      last24h: tot24,
      last7d: tot7,
      topPages,
      recent: recent.map((r) => ({
        ...r,
        visitorId: r.visitorId.slice(0, 8),
      })),
    });
  });
}
