/**
 * First-party visitor analytics — consent-gated.
 *
 * The cookie banner sets `ch_consent=granted|denied` (1 year). Only granted
 * browsers get a `ch_vid` visitor id and only THEIR pageviews are recorded —
 * a "denied" or unanswered browser sends nothing and stores nothing.
 *
 *   POST /api/analytics/consent  {granted}  — answer the banner (sets cookies)
 *   POST /api/analytics/events   {events:[{type,path,referrer,landing,utm}]}  — batched
 *   GET  /api/admin/analytics    — platform-admin rollup (visitors, IPs, trail)
 *   GET  /api/admin/analytics?view=campaigns — visits and sign-ups by campaign
 *        tag and referring site (server/analytics-attribution.ts)
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { analyticsPath } from "@shared/analytics-path";
import { z } from "zod";
import { db, pool } from "./db";
import { chAnalyticsEvents, users } from "@shared/schema";
import { desc, eq, gte, sql } from "drizzle-orm";
import { requirePlatformAdmin } from "./crm/admin";
import { campaignReport, consentedVisitorId, isMintedVisitorId, landingColumns } from "./analytics-attribution";

type GetUser = (req: any, res: any) => any;

/** Events accepted per visitor (the server-minted ch_vid) per 15-minute window (batch rows count). */
export const EVENTS_VISITOR_LIMIT = 120;
/** Backstop per IP per window. An office or a mobile carrier puts many real visitors behind one IP,
 *  so this is generous; it only stops one IP minting visitor ids to flood the dashboard. */
export const EVENTS_IP_LIMIT = 2000;
export const EVENTS_WINDOW_MS = 15 * 60 * 1000;

/**
 * Sliding-window limiter with two budgets: one per visitor and a backstop per IP. A batch is
 * charged to both only when both have room, so a refusal never eats either budget.
 * `retryAfterMs` says when the tighter refusing bucket frees enough room.
 */
export function createEventLimiter(opts: { visitorLimit: number; ipLimit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, number[]>();
  const live = (key: string, t: number) => {
    const hits = (buckets.get(key) ?? []).filter((h) => t - h < opts.windowMs);
    if (hits.length) buckets.set(key, hits); else buckets.delete(key);
    return hits;
  };
  // Room for `cost` more rows → 0; otherwise ms until the oldest blocking hit leaves the window.
  const waitFor = (hits: number[], limit: number, cost: number, t: number) => {
    if (hits.length + cost <= limit) return 0;
    const blocker = hits[Math.max(0, hits.length + cost - limit - 1)];
    return blocker === undefined ? opts.windowMs : Math.max(1, blocker + opts.windowMs - t);
  };
  let calls = 0;
  return {
    take(visitorId: string, ip: string, cost: number): { ok: true } | { ok: false; retryAfterMs: number } {
      const t = now();
      // Drop idle buckets now and then, so one-visit visitors don't pile up in memory.
      if (++calls % 500 === 0) for (const key of Array.from(buckets.keys())) live(key, t);
      const vKey = `v:${visitorId}`;
      const iKey = `ip:${ip}`;
      const vHits = live(vKey, t);
      const iHits = live(iKey, t);
      const wait = Math.max(waitFor(vHits, opts.visitorLimit, cost, t), waitFor(iHits, opts.ipLimit, cost, t));
      if (wait > 0) return { ok: false, retryAfterMs: wait };
      for (let i = 0; i < cost; i++) { vHits.push(t); iHits.push(t); }
      buckets.set(vKey, vHits);
      buckets.set(iKey, iHits);
      return { ok: true };
    },
  };
}

const eventLimiter = createEventLimiter({
  visitorLimit: EVENTS_VISITOR_LIMIT, ipLimit: EVENTS_IP_LIMIT, windowMs: EVENTS_WINDOW_MS,
});

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
// ch_consent must stay JS-readable (the banner reads it from document.cookie);
// ch_vid never needs to be — HttpOnly keeps it out of script reach.
const consentOpts = `Path=/; Max-Age=31536000; SameSite=Lax${secureFlag}`;
const vidOpts = `Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secureFlag}`;

export { isMintedVisitorId };

/** Drop the query string / fragment — invite tokens etc. must never land in
 *  the admin rollup. */
export function stripQuery(s: string): string {
  return analyticsPath(s);
}

/** Neighborhood-level location only: /24 for IPv4, /48 for IPv6. */
export function anonymizeIp(ip: string): string {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  return ip;
}

export function registerAnalyticsRoutes(app: Express, getDevUser: GetUser): void {
  app.post("/api/analytics/consent", (req: any, res) => {
    const granted = req.body?.granted === true;
    const cookies: string[] = [`ch_consent=${granted ? "granted" : "denied"}; ${consentOpts}`];
    if (granted) {
      // Always mint server-side — honoring a client-supplied ch_vid would be
      // visitor-id fixation (an attacker pinning a victim's analytics id).
      cookies.push(`ch_vid=${randomUUID()}; ${vidOpts}`);
    } else {
      // Declined: drop the visitor id if one ever existed.
      cookies.push("ch_vid=; Path=/; Max-Age=0; HttpOnly");
    }
    res.setHeader("Set-Cookie", cookies);
    res.json({ ok: true, granted });
  });

  app.post("/api/analytics/events", async (req: any, res) => {
    // Consent is the gate, enforced server-side — a hand-crafted POST from a
    // browser that declined records nothing. The visitor id must be one the
    // server minted, not a client-invented string.
    const visitorId = consentedVisitorId(req.headers.cookie);
    if (!visitorId) {
      return res.json({ ok: true, recorded: 0 });
    }
    const parsed = z.object({
      events: z.array(z.object({
        type: z.string().max(24).optional(),
        path: z.string().min(1).max(300),
        referrer: z.string().max(300).nullable().optional(),
        // First page view of a page load, with the three campaign tags the
        // browser read off its address bar. Unknown keys are stripped by zod;
        // the values are sanitized again in landingColumns().
        landing: z.boolean().optional(),
        utm: z.object({
          source: z.string().max(200).nullable().optional(),
          medium: z.string().max(200).nullable().optional(),
          campaign: z.string().max(200).nullable().optional(),
        }).nullable().optional(),
      })).min(1).max(20),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false });

    // Throttled per visitor, with a generous per-IP backstop keyed on the
    // edge-reported client; batch rows count against both budgets. Without
    // this the endpoint is an open dashboard-poisoning vector. Retry-After
    // tells the tracker how long to stay quiet (cookie-consent.tsx).
    const verdict = eventLimiter.take(visitorId, String(req.ip || ""), parsed.data.events.length);
    if (!verdict.ok) {
      res.setHeader("Retry-After", String(Math.ceil(verdict.retryAfterMs / 1000)));
      return res.status(429).json({ ok: false, message: "Too many events. Slow down." });
    }

    // Signed-in identity, when there is one (no auth REQUIRED to be counted).
    let userId: number | null = null;
    try {
      const u = req.session?.passport?.user ?? req.user?.id ?? null;
      if (typeof u === "number") userId = u;
    } catch { /* anonymous is fine */ }

    const ip = anonymizeIp(clientIp(req));
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    const siteHost = String(req.hostname || "");
    await db.insert(chAnalyticsEvents).values(parsed.data.events.map((e, i) => ({
      // Only the first event of a batch can be a landing (one page load, one landing).
      ...landingColumns(i === 0 ? e : {}, siteHost),
      visitorId: visitorId.slice(0, 64),
      userId,
      type: e.type?.slice(0, 24) || "pageview",
      path: stripQuery(e.path).slice(0, 300) || "/",
      referrer: e.referrer ? stripQuery(e.referrer).slice(0, 300) : null,
      ip,
      userAgent: ua,
    })));
    res.json({ ok: true, recorded: parsed.data.events.length });
  });

  app.get("/api/admin/analytics", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    // Campaigns: ?view=campaigns&since=YYYY-MM-DD&until=YYYY-MM-DD[&source=instagram]
    if (req.query?.view === "campaigns") {
      const report = await campaignReport(pool, {
        since: req.query.since, until: req.query.until, days: req.query.days, source: req.query.source,
      });
      return res.json(report);
    }

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
