/**
 * GOOGLE CALENDAR SYNC — tutorial fixture. Recording slots only (../gate.ts).
 *
 * Seam: the OAuth client id / secret and the two `fetch` calls of server/crm/calendar.ts
 * (oauth2.googleapis.com/token and www.googleapis.com/calendar/v3). In a slot those calls are
 * answered by an in-memory calendar, so "Sync now" runs the product's real diff — list what we
 * wrote, create / patch / delete — and reports real counts. The connection row (a stand-in refresh
 * token, the calendar id, a last-sync time) is seeded by scripts/tutorials/seed-fixtures.ts.
 */
import { randomBytes } from "crypto";
import { defineProviderFixture, requireTutorialFixtures } from "../registry";

export type GoogleCalendarFixture = { clientId: string; clientSecret: string; fetch: typeof fetch };

export const FIXTURE_GCAL_REFRESH = "tutfx-gcal-refresh";
export const FIXTURE_GCAL_CALENDAR = "tutfx-constructhub-crm@group.calendar.example.com";

type Ev = Record<string, any> & { id: string };
const calendars = new Map<string, Map<string, Ev>>();
const eventsOf = (id: string) => { if (!calendars.has(id)) calendars.set(id, new Map()); return calendars.get(id)!; };

const calendarFetch: typeof fetch = async (input, init = {}) => {
  requireTutorialFixtures("the Google Calendar stand-in");
  const url = new URL(String(input));
  const method = String(init.method || "GET").toUpperCase();
  const body = () => { try { return JSON.parse(String(init.body || "{}")); } catch { return {}; } };
  if (url.hostname === "oauth2.googleapis.com") {
    if (url.pathname === "/token") return Response.json({ access_token: "tutfx-gcal-access", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar.app.created" });
    if (url.pathname === "/revoke") return Response.json({});
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/v3")) {
    const p = url.pathname.slice("/calendar/v3".length);
    if (method === "GET" && p === "/users/me/calendarList") return Response.json({ items: [{ id: FIXTURE_GCAL_CALENDAR, summary: "ConstructHub CRM" }] });
    if (method === "POST" && p === "/calendars") return Response.json({ id: FIXTURE_GCAL_CALENDAR, summary: body().summary });
    let m = /^\/calendars\/([^/]+)\/events$/.exec(p);
    if (m) {
      const events = eventsOf(decodeURIComponent(m[1]));
      if (method === "GET") return Response.json({ items: [...events.values()] });
      if (method === "POST") { const ev: Ev = { ...body(), id: `tutfx${randomBytes(8).toString("hex")}` }; events.set(ev.id, ev); return Response.json(ev); }
    }
    m = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(p);
    if (m) {
      const events = eventsOf(decodeURIComponent(m[1])), id = decodeURIComponent(m[2]);
      if (!events.has(id)) return Response.json({ error: { message: "Not Found" } }, { status: 404 });
      if (method === "PATCH") { const ev = { ...events.get(id)!, ...body(), id }; events.set(id, ev); return Response.json(ev); }
      if (method === "DELETE") { events.delete(id); return new Response(null, { status: 204 }); }
    }
  }
  return Response.json({ error: { message: `The Google Calendar stand-in does not implement ${method} ${url.hostname}${url.pathname}` } }, { status: 400 });
};

export const googleCalendarFixture = defineProviderFixture<GoogleCalendarFixture>({
  id: "google-calendar",
  simulates: "A connected Google Calendar for the demo company: the dedicated \"ConstructHub CRM\" calendar and an in-memory event list that Sync now really writes to.",
  seam: "server/crm/calendar.ts — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and the `googleFetch` used by googleTokenRequest(), googleApi() and the revoke call",
  adapter: () => ({ clientId: "tutfx-gcal-client.apps.example.com", clientSecret: "tutfx-gcal-secret", fetch: calendarFetch }),
  actions: {
    /** What the stand-in calendar holds now (for a script that wants to wait on a sync). */
    events: async () => ({ count: eventsOf(FIXTURE_GCAL_CALENDAR).size }),
  },
});
