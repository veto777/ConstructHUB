/**
 * Calendar sync — two directions, one card on /crm/settings.
 *
 * 1. Universal iCal feed (Apple / Outlook / Google / anything that subscribes
 *    to an .ics URL). Calendar apps cannot hold a login session, so the feed
 *    URL carries a token and THE TOKEN IS THE AUTH — the settings copy says so
 *    in plain language. The token is HMAC-derived from the org id + a rotation
 *    counter; only its SHA-256 hash is stored (custom_fields->calendarFeedToken),
 *    so a database read-alone never hands out a working URL, and "regenerate"
 *    (counter + 1) kills every old copy.
 *
 * 2. Google Calendar push (true sync). An org-level OAuth round-trip with the
 *    calendar.events scope and a refresh token, stored on the org
 *    (custom_fields->googleCalendar) rather than the user — the schedule
 *    belongs to the company, not to whoever clicked connect. Sync upserts the
 *    org's appointments into a dedicated "ConstructHub CRM" secondary calendar
 *    and full-replaces the events it manages (tagged via private extended
 *    properties), so deletes and edits propagate.
 *
 * When GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are absent the status endpoint
 * reports configured: false and names the missing variables — the UI renders
 * that instead of a dead button, same as the payments page does for Stripe.
 *
 * The RFC 5545 document itself lives in ./ical (pure, unit-tested directly).
 */
import type { Express } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { db } from "../db";
import { crmAppointments, crmCustomers, crmOrgs, crmProjects } from "@shared/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { getBaseUrl } from "../auth";
import { oauthBaseUrl } from "../site-context";
import {
  buildICalendar,
  icalDate,
  icalDescription,
  icalEventEnd,
  icalSummary,
  type ICalEvent,
} from "./ical";

type GetUser = (req: any, res: any) => any;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_CALENDAR_NAME = "ConstructHub CRM";

export function googleCalendarConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function googleCalendarMissing(): string[] {
  return [
    ...(!GOOGLE_CLIENT_ID ? ["GOOGLE_CLIENT_ID"] : []),
    ...(!GOOGLE_CLIENT_SECRET ? ["GOOGLE_CLIENT_SECRET"] : []),
  ];
}

// ── Feed tokens ──────────────────────────────────────────────────────────────

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Same secret the session store uses (with its documented dev-only fallback):
 *  rotating SESSION_SECRET invalidates feeds, which is the safe direction. */
function feedSecret(): string {
  return process.env.SESSION_SECRET || "dev-only-insecure-session-secret";
}

/** token = `${orgId}.${counter}.${hmac}` — the org id lets the feed route find
 *  the org, the HMAC makes it unforgeable, the counter makes it rotatable. */
function deriveFeedToken(orgId: string, counter: number): string {
  const mac = createHmac("sha256", feedSecret())
    .update(`crm-calendar-feed:${orgId}:${counter}`)
    .digest("base64url")
    .slice(0, 32);
  return `${orgId}.${counter}.${mac}`;
}

type FeedState = { counter: number; tokenHash: string };

function feedStateOf(org: typeof crmOrgs.$inferSelect): FeedState | null {
  const cf = (org.customFields ?? {}) as Record<string, any>;
  if (typeof cf.calendarFeedToken !== "string" || !cf.calendarFeedToken) return null;
  const counter = Number(cf.calendarFeedCounter) || 1;
  return { counter, tokenHash: cf.calendarFeedToken };
}

/** Persist a fresh (or rotated) token; returns the raw token. */
async function mintFeedToken(orgId: string, counter: number): Promise<string> {
  const token = deriveFeedToken(orgId, counter);
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const cf = { ...((org?.customFields ?? {}) as Record<string, any>) };
  cf.calendarFeedToken = sha256(token);
  cf.calendarFeedCounter = counter;
  cf.calendarFeedRotatedAt = new Date().toISOString();
  await db
    .update(crmOrgs)
    .set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmOrgs.id, orgId));
  return token;
}

/** Resolve a presented feed token to its org, or null. Never leaks which part failed. */
async function orgForFeedToken(token: string): Promise<typeof crmOrgs.$inferSelect | null | "unknown-org"> {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const orgId = token.slice(0, dot);
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return "unknown-org";
  const state = feedStateOf(org);
  if (!state) return null;
  const expected = sha256(deriveFeedToken(org.id, state.counter));
  const presented = sha256(token);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presented, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return org;
}

// ── Google Calendar helpers ──────────────────────────────────────────────────

type GoogleConnection = {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  connectedAt: string;
  connectedByMemberId?: string | null;
  calendarId?: string | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
};

function googleConnectionOf(org: typeof crmOrgs.$inferSelect): GoogleConnection | null {
  const cf = (org.customFields ?? {}) as Record<string, any>;
  const gc = cf.googleCalendar;
  return gc && typeof gc.refreshToken === "string" && gc.refreshToken ? (gc as GoogleConnection) : null;
}

async function saveGoogleConnection(orgId: string, gc: GoogleConnection | null): Promise<void> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const cf = { ...((org?.customFields ?? {}) as Record<string, any>) };
  if (gc) cf.googleCalendar = gc;
  else delete cf.googleCalendar;
  await db
    .update(crmOrgs)
    .set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmOrgs.id, orgId));
}

// Per-member connections: each team member may hook up their OWN Google
// account and get only the appointments assigned to them. Stored beside the
// org-level connection (customFields.googleCalendarMembers[memberId]) — the
// org-level "company calendar" stays the owner/admin's optional, separate
// choice and receives everything.
function memberConnectionOf(org: typeof crmOrgs.$inferSelect, memberId: string): GoogleConnection | null {
  const cf = (org.customFields ?? {}) as Record<string, any>;
  const gc = cf.googleCalendarMembers?.[memberId];
  return gc && typeof gc.refreshToken === "string" && gc.refreshToken ? (gc as GoogleConnection) : null;
}

async function saveMemberConnection(orgId: string, memberId: string, gc: GoogleConnection | null): Promise<void> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const cf = { ...((org?.customFields ?? {}) as Record<string, any>) };
  const members = { ...((cf.googleCalendarMembers as Record<string, any>) ?? {}) };
  if (gc) members[memberId] = gc;
  else delete members[memberId];
  if (Object.keys(members).length) cf.googleCalendarMembers = members;
  else delete cf.googleCalendarMembers;
  await db
    .update(crmOrgs)
    .set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmOrgs.id, orgId));
}

async function googleTokenRequest(params: Record<string, string>): Promise<any> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error_description || body.error || `token exchange failed (${r.status})`);
  return body;
}

/** A valid access token for the connection, refreshing when expired. */
async function googleAccessToken(gc: GoogleConnection): Promise<{ token: string; gc: GoogleConnection }> {
  const expires = gc.accessTokenExpiresAt ? Date.parse(gc.accessTokenExpiresAt) : 0;
  if (gc.accessToken && expires > Date.now() + 60_000) {
    return { token: gc.accessToken, gc };
  }
  const body = await googleTokenRequest({
    client_id: GOOGLE_CLIENT_ID!,
    client_secret: GOOGLE_CLIENT_SECRET!,
    refresh_token: gc.refreshToken,
    grant_type: "refresh_token",
  });
  const next: GoogleConnection = {
    ...gc,
    accessToken: body.access_token,
    accessTokenExpiresAt: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
  };
  return { token: body.access_token, gc: next };
}

async function googleApi(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.message || `Google Calendar API error (${r.status})`;
    throw new Error(msg);
  }
  return body;
}

/** Find or create the dedicated secondary calendar; returns its id. */
async function ensureGoogleCalendar(token: string, gc: GoogleConnection): Promise<string> {
  if (gc.calendarId) return gc.calendarId;
  const list = await googleApi(token, "/users/me/calendarList?maxResults=250");
  const existing = (list.items ?? []).find((c: any) => c.summary === GOOGLE_CALENDAR_NAME);
  if (existing) return existing.id;
  const created = await googleApi(token, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: GOOGLE_CALENDAR_NAME }),
  });
  return created.id;
}

const toGcalEvent = (e: ICalEvent, orgId: string, timeZone: string) => ({
  summary: icalSummary(e),
  location: e.location ?? undefined,
  description: icalDescription(e) || undefined,
  start: e.allDay
    ? { date: icalDate(e.startsAt) }
    : { dateTime: e.startsAt.toISOString(), timeZone },
  end: e.allDay
    ? { date: icalDate(new Date((e.endsAt ?? e.startsAt).getTime() + 86400000)) }
    : { dateTime: icalEventEnd(e).toISOString(), timeZone },
  extendedProperties: {
    private: { crmManaged: "1", crmApptId: e.id, crmOrgId: orgId },
  },
});

// ── Appointments → feed events ───────────────────────────────────────────────

/** All the org's appointments — or, with `memberId`, only the ones dispatched
 *  to that member (their own schedule, for their own Google calendar). */
async function orgFeedEvents(orgId: string, memberId?: string): Promise<ICalEvent[]> {
  const where = memberId
    ? and(
        eq(crmAppointments.orgId, orgId),
        sql`${crmAppointments.dispatchedMemberIds} @> ARRAY[${memberId}]::text[]`,
      )
    : eq(crmAppointments.orgId, orgId);
  const rows = await db
    .select({
      appointment: crmAppointments,
      projectName: crmProjects.name,
      customerName: crmCustomers.displayName,
      addressLine1: crmCustomers.addressLine1,
      addressLine2: crmCustomers.addressLine2,
      city: crmCustomers.city,
      state: crmCustomers.state,
      postalCode: crmCustomers.postalCode,
    })
    .from(crmAppointments)
    .leftJoin(crmProjects, eq(crmProjects.id, crmAppointments.projectId))
    .leftJoin(crmCustomers, eq(crmCustomers.id, crmAppointments.customerId))
    .where(where)
    .orderBy(asc(crmAppointments.startsAt))
    .limit(1000);

  return rows.map(({ appointment: a, projectName, customerName, ...addr }) => ({
    id: a.id,
    title: a.title,
    projectName,
    customerName,
    location:
      [addr.addressLine1, addr.addressLine2, [addr.city, addr.state].filter(Boolean).join(", "), addr.postalCode]
        .filter(Boolean)
        .join(", ") || null,
    notes: a.notes,
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    allDay: a.allDay,
    arrivalWindowMinutes: a.arrivalWindowMinutes,
    updatedAt: a.updatedAt,
  }));
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerCrmCalendarRoutes(app: Express, getDevUser: GetUser): void {
  /**
   * Public feed — no session (calendar apps can't hold one). The token is the
   * auth; a wrong one is a flat 401.
   */
  app.get("/api/crm/calendar/feed.ics", async (req: any, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(401).json({ message: "Calendar feed token required" });
    const org = await orgForFeedToken(token);
    if (org === "unknown-org") return res.status(404).json({ message: "Calendar feed not found" });
    if (!org) return res.status(401).json({ message: "Invalid calendar feed token" });

    const events = await orgFeedEvents(org.id);
    res.setHeader("content-type", "text/calendar; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="constructhub-crm.ics"');
    res.setHeader("cache-control", "no-cache, no-store");
    res.send(buildICalendar(org.name, events));
  });

  /** The org's feed URL, provisioning the token lazily on first view. */
  app.get("/api/crm/calendar/feed-url", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings")) return;

    let state = feedStateOf(ctx.org);
    if (!state) {
      const token = await mintFeedToken(ctx.org.id, 1);
      state = { counter: 1, tokenHash: sha256(token) };
    }
    const token = deriveFeedToken(ctx.org.id, state.counter);
    res.json({ url: `${getBaseUrl(req)}/api/crm/calendar/feed.ics?token=${encodeURIComponent(token)}` });
  });

  /** Rotate: every previously-shared URL stops working immediately. */
  app.post("/api/crm/calendar/rotate-feed-token", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings")) return;

    const counter = (feedStateOf(ctx.org)?.counter ?? 0) + 1;
    const token = await mintFeedToken(ctx.org.id, counter);
    res.json({ url: `${getBaseUrl(req)}/api/crm/calendar/feed.ics?token=${encodeURIComponent(token)}` });
  });

  // ── Google Calendar push ─────────────────────────────────────────────────

  app.get("/api/crm/calendar/google/status", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const gc = googleConnectionOf(ctx.org);
    const mine = memberConnectionOf(ctx.org, ctx.member.id);
    const present = (c: GoogleConnection | null) =>
      c
        ? {
            connectedAt: c.connectedAt,
            calendarId: c.calendarId ?? null,
            lastSyncAt: c.lastSyncAt ?? null,
            lastSyncError: c.lastSyncError ?? null,
          }
        : null;
    res.json({
      configured: googleCalendarConfigured(),
      missing: googleCalendarMissing(),
      scope: CALENDAR_EVENTS_SCOPE,
      // The org-wide "company calendar" (owner/admin's optional choice)…
      connection: present(gc),
      // …and this member's own connection — their appointments, their account.
      myConnection: present(mine),
    });
  });

  app.get("/api/crm/calendar/google/connect", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // scope=me → the member's own calendar (any member may connect their own);
    // otherwise the org-wide company calendar (owner/admin only).
    const scope = req.query?.scope === "me" ? "me" : "org";
    if (scope === "org" && !requirePermission(res, ctx, "manageSettings")) return;
    if (!googleCalendarConfigured()) {
      return res.status(503).json({
        message: "Google Calendar sync isn't configured on this server yet.",
        missing: googleCalendarMissing(),
      });
    }

    // CSRF: bind the OAuth round-trip to this session + org (+ member scope).
    const state = createHash("sha256")
      .update(`${ctx.org.id}:${Date.now()}:${Math.random()}`)
      .digest("hex")
      .slice(0, 48);
    if (req.session) {
      req.session.googleCalendarState = state;
      req.session.googleCalendarOrgId = ctx.org.id;
      req.session.googleCalendarScope = scope;
      req.session.googleCalendarMemberId = scope === "me" ? ctx.member.id : null;
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      redirect_uri: `${oauthBaseUrl(req)}/api/crm/calendar/google/callback`,
      response_type: "code",
      scope: CALENDAR_EVENTS_SCOPE,
      access_type: "offline",
      prompt: "consent", // a refresh token is only guaranteed with an explicit consent screen
      state,
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });

  app.get("/api/crm/calendar/google/callback", async (req: any, res) => {
    // A member-scope connect returns to the Team page (every member can reach
    // it); an org-scope connect returns to Settings as before.
    const scope = req.session?.googleCalendarScope === "me" ? "me" : "org";
    const back = (q: string) =>
      res.redirect(scope === "me" ? `/crm/team?calendar=${q}` : `/crm/settings?calendar=${q}`);
    const user = getDevUser(req, res);
    if (!user) return;
    if (!googleCalendarConfigured()) return back("error=not_configured");

    const { code, state, error } = req.query;
    if (error) return back(`error=${encodeURIComponent(String(error))}`);
    if (!code || !state) return back("error=missing_code");
    if (!req.session?.googleCalendarState || req.session.googleCalendarState !== state) {
      return back("error=state_mismatch");
    }
    const orgId = req.session.googleCalendarOrgId;
    const memberId = req.session.googleCalendarMemberId ?? null;
    delete req.session.googleCalendarState;
    delete req.session.googleCalendarOrgId;
    delete req.session.googleCalendarScope;
    delete req.session.googleCalendarMemberId;

    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (ctx.org.id !== orgId) return back("error=org_mismatch");
    // The member slot being written must be the member who started the flow.
    if (scope === "me" && ctx.member.id !== memberId) return back("error=member_mismatch");

    try {
      const tok = await googleTokenRequest({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: `${oauthBaseUrl(req)}/api/crm/calendar/google/callback`,
      });
      if (!tok.refresh_token) {
        return back("error=no_refresh_token");
      }
      const gc: GoogleConnection = {
        refreshToken: tok.refresh_token,
        accessToken: tok.access_token ?? null,
        accessTokenExpiresAt: tok.expires_in
          ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString()
          : null,
        connectedAt: new Date().toISOString(),
        connectedByMemberId: ctx.member.id,
      };
      if (scope === "me") await saveMemberConnection(ctx.org.id, ctx.member.id, gc);
      else await saveGoogleConnection(ctx.org.id, gc);
      return back("connected=1");
    } catch (e: any) {
      console.error("[crm] google calendar connect failed:", e?.message || e);
      return back(`error=${encodeURIComponent(String(e?.message || "connect_failed").slice(0, 120))}`);
    }
  });

  /**
   * Push the org's appointments to the dedicated Google calendar. Full replace
   * of the events we manage (tagged via private extended properties): upsert
   * live appointments, delete events whose appointment is gone or canceled.
   * syncToken-incremental is deliberately NOT used — full replace of a bounded
   * set is simpler and cannot drift.
   */
  app.post("/api/crm/calendar/google/sync", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // scope=me → the member's own calendar with only their appointments (any
    // member); otherwise the org-wide company calendar (owner/admin only).
    const scope = req.query?.scope === "me" ? "me" : "org";
    if (scope === "org" && !requirePermission(res, ctx, "manageSettings")) return;
    if (!googleCalendarConfigured()) {
      return res.status(503).json({
        message: "Google Calendar sync isn't configured on this server yet.",
        missing: googleCalendarMissing(),
      });
    }
    let gc = scope === "me" ? memberConnectionOf(ctx.org, ctx.member.id) : googleConnectionOf(ctx.org);
    if (!gc) return res.status(409).json({ message: "Google Calendar is not connected yet." });
    const saveGc = (g: GoogleConnection) =>
      scope === "me" ? saveMemberConnection(ctx.org.id, ctx.member.id, g) : saveGoogleConnection(ctx.org.id, g);

    try {
      const refreshed = await googleAccessToken(gc);
      gc = refreshed.gc;
      const token = refreshed.token;

      const calendarId = await ensureGoogleCalendar(token, gc);
      gc.calendarId = calendarId;

      // Every event we previously wrote.
      const existing = new Map<string, any>(); // crmApptId → event
      let pageToken: string | undefined;
      do {
        const page = await googleApi(
          token,
          `/calendars/${encodeURIComponent(calendarId)}/events?maxResults=250` +
            `&privateExtendedProperty=crmManaged%3D1&showDeleted=false` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
        );
        for (const ev of page.items ?? []) {
          const apptId = ev.extendedProperties?.private?.crmApptId;
          if (apptId) existing.set(apptId, ev);
        }
        pageToken = page.nextPageToken;
      } while (pageToken);

      const timeZone = ctx.org.timezone || "UTC";
      const events = await orgFeedEvents(ctx.org.id, scope === "me" ? ctx.member.id : undefined);
      const live = events.filter((e) => e.status !== "canceled");
      const liveIds = new Set(live.map((e) => e.id));

      let upserted = 0;
      let deleted = 0;
      for (const e of live) {
        const body = JSON.stringify(toGcalEvent(e, ctx.org.id, timeZone));
        const current = existing.get(e.id);
        if (current) {
          await googleApi(
            token,
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(current.id)}`,
            { method: "PATCH", body },
          );
        } else {
          await googleApi(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: "POST",
            body,
          });
        }
        upserted++;
      }
      for (const [apptId, ev] of existing) {
        if (liveIds.has(apptId)) continue;
        await googleApi(
          token,
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`,
          { method: "DELETE" },
        );
        deleted++;
      }

      gc.lastSyncAt = new Date().toISOString();
      gc.lastSyncError = null;
      await saveGc(gc);
      res.json({ ok: true, calendarId, upserted, deleted, total: live.length });
    } catch (e: any) {
      const message = String(e?.message || e).slice(0, 300);
      console.error("[crm] google calendar sync failed:", message);
      gc.lastSyncAt = new Date().toISOString();
      gc.lastSyncError = message;
      await saveGc(gc);
      res.status(502).json({ message });
    }
  });

  app.post("/api/crm/calendar/google/disconnect", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Members may always disconnect their own; the company calendar needs
    // manageSettings, as before.
    const scope = req.query?.scope === "me" ? "me" : "org";
    if (scope === "org" && !requirePermission(res, ctx, "manageSettings")) return;
    const gc = scope === "me" ? memberConnectionOf(ctx.org, ctx.member.id) : googleConnectionOf(ctx.org);
    if (!gc) return res.status(404).json({ message: "Google Calendar is not connected" });

    // Best-effort revoke at Google; the local connection is dropped regardless
    // so the UI never shows a connection the contractor thinks they removed.
    if (gc.refreshToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(gc.refreshToken)}`, {
        method: "POST",
      }).catch((e: any) => console.error("[crm] google revoke:", e?.message || e));
    }
    if (scope === "me") await saveMemberConnection(ctx.org.id, ctx.member.id, null);
    else await saveGoogleConnection(ctx.org.id, null);
    res.json({ ok: true });
  });
}
