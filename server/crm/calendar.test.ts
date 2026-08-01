/**
 * Calendar sync — the iCal document itself (pure unit tests) plus the feed's
 * token auth and the Google status endpoint's honesty against the running dev
 * server (CRM_TEST_BASE_URL, default http://127.0.0.1:8119, same dev-bypass
 * setup as link-gating.test.ts).
 *
 * Server-side fixtures are throwaway rows in the dev-bypass user's own org,
 * created through the real API — never the seeded demo.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import {
  buildICalendar,
  buildVEvent,
  icalEscape,
  icalFold,
  icalDateTimeUtc,
  type ICalEvent,
} from "./ical";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

// ── Pure iCal output ─────────────────────────────────────────────────────────

describe("icalEscape (RFC 5545 TEXT)", () => {
  it("escapes backslash first, then semicolon, comma and newlines", () => {
    expect(icalEscape('a;b,c\\d\ne')).toBe("a\\;b\\,c\\\\d\\ne");
    expect(icalEscape("plain")).toBe("plain");
  });
});

describe("icalFold (75-octet folding)", () => {
  it("leaves short lines alone", () => {
    expect(icalFold("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines with CRLF + single space, each segment ≤ 75 octets", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = icalFold(line);
    const segments = folded.split("\r\n");
    expect(segments.length).toBeGreaterThan(2);
    expect(Buffer.byteLength(segments[0], "utf8")).toBe(75);
    for (const s of segments.slice(1)) {
      expect(s.startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(s, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original exactly.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits a multi-byte UTF-8 character across a fold", () => {
    // 70 ASCII chars + a run of 3-byte characters straddling the 75-octet mark.
    const line = `${"a".repeat(70)}${"é".repeat(10)}${"b".repeat(10)}`;
    const folded = icalFold(line);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    for (const s of folded.split("\r\n")) {
      expect(Buffer.byteLength(s, "utf8")).toBeLessThanOrEqual(75);
      // No U+FFFD replacement characters from a torn sequence.
      expect(s).not.toContain("�");
    }
  });
});

describe("buildVEvent", () => {
  const base: ICalEvent = {
    id: "appt-123",
    title: "Measure visit",
    projectName: "Kane Roof",
    customerName: "Doris Kane",
    location: "12 Main St, Orlando, FL, 32801",
    notes: null,
    status: "scheduled",
    startsAt: new Date(Date.UTC(2026, 7, 3, 13, 0, 0)),
    endsAt: null,
    allDay: false,
    arrivalWindowMinutes: 120,
    updatedAt: null,
  };
  const now = new Date(Date.UTC(2026, 6, 31, 20, 0, 0));

  it("uid is the stable appointment id; summary is project — customer", () => {
    const lines = buildVEvent(base, now);
    expect(lines).toContain("UID:appt-123@constructhub-crm");
    expect(lines).toContain("SUMMARY:Kane Roof — Doris Kane");
    expect(lines).toContain("LOCATION:12 Main St\\, Orlando\\, FL\\, 32801");
  });

  it("falls back to the appointment title when no project/customer", () => {
    const lines = buildVEvent({ ...base, projectName: null, customerName: null }, now);
    expect(lines).toContain("SUMMARY:Measure visit");
  });

  it("dtstart/dtend come from the arrival window when no explicit end", () => {
    const lines = buildVEvent(base, now);
    expect(lines).toContain("DTSTART:20260803T130000Z");
    // startsAt + 120-minute window
    expect(lines).toContain("DTEND:20260803T150000Z");
    expect(lines.some((l) => l.startsWith("DESCRIPTION:") && l.includes("Arrival window: 120"))).toBe(true);
  });

  it("an explicit endsAt wins over the window", () => {
    const lines = buildVEvent(
      { ...base, endsAt: new Date(Date.UTC(2026, 7, 3, 14, 30, 0)) },
      now,
    );
    expect(lines).toContain("DTEND:20260803T143000Z");
  });

  it("all-day events use DATE values with an exclusive DTEND", () => {
    const lines = buildVEvent({ ...base, allDay: true }, now);
    expect(lines).toContain("DTSTART;VALUE=DATE:20260803");
    expect(lines).toContain("DTEND;VALUE=DATE:20260804");
  });

  it("canceled appointments are STATUS:CANCELLED, the rest CONFIRMED", () => {
    expect(buildVEvent({ ...base, status: "canceled" }, now)).toContain("STATUS:CANCELLED");
    expect(buildVEvent({ ...base, status: "complete" }, now)).toContain("STATUS:CONFIRMED");
  });
});

describe("buildICalendar", () => {
  it("is a CRLF document with the VCALENDAR envelope and calendar name", () => {
    const ics = buildICalendar("Aspire Interiors", [], new Date(Date.UTC(2026, 6, 31)));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//ConstructHub CRM//Calendar Feed//EN\r\n");
    expect(ics).toContain("X-WR-CALNAME:Aspire Interiors — ConstructHub CRM\r\n");
    // No bare LFs — iCal readers reject them.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("formats UTC datetimes in basic format", () => {
    expect(icalDateTimeUtc(new Date(Date.UTC(2026, 0, 5, 9, 7, 3)))).toBe("20260105T090703Z");
  });
});

// ── Against the running dev server ───────────────────────────────────────────

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* ics etc. */ }
  return { status: res.status, body, text, headers: res.headers };
}

/** Unfold an iCal document into logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

describe("calendar feed (dev server)", () => {
  let feedUrl = "";
  let customerId = "";
  let projectId = "";
  let appointmentId = "";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const customerName = `Cal Feed ${stamp}`;
  const projectName = `Cal Project ${stamp}`;
  const startsAt = new Date(Date.now() + 3 * 86400000);
  startsAt.setMinutes(0, 0, 0);

  beforeAll(async () => {
    const me = await fetch(`${BASE}/api/crm/me`);
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }

    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({ displayName: customerName }),
    });
    expect(cust.status).toBe(201);
    customerId = cust.body.id;

    const proj = await api("/api/crm/projects", {
      method: "POST",
      body: JSON.stringify({ customerId, name: projectName }),
    });
    expect(proj.status).toBe(201);
    projectId = proj.body.id;

    const appt = await api("/api/crm/appointments", {
      method: "POST",
      body: JSON.stringify({
        projectId, customerId,
        title: "Feed fixture visit",
        startsAt: startsAt.toISOString(),
        arrivalWindowMinutes: 90,
      }),
    });
    expect(appt.status).toBe(201);
    appointmentId = appt.body.appointment.id;

    const url = await api("/api/crm/calendar/feed-url");
    expect(url.status).toBe(200);
    expect(url.body.url).toContain("/api/crm/calendar/feed.ics?token=");
    feedUrl = url.body.url;
  });

  it("serves text/calendar with a parseable VEVENT for a real appointment", async () => {
    const res = await api(new URL(feedUrl).pathname + new URL(feedUrl).search);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");

    const lines = unfold(res.text);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");

    // Our appointment, by stable uid.
    const uidIdx = lines.indexOf(`UID:${appointmentId}@constructhub-crm`);
    expect(uidIdx).toBeGreaterThan(-1);
    const block = lines.slice(uidIdx, lines.indexOf("END:VEVENT", uidIdx));
    expect(block).toContain(`SUMMARY:${projectName} — ${customerName}`);
    expect(block).toContain(`DTSTART:${startsAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    // 90-minute arrival window sets the end.
    const end = new Date(startsAt.getTime() + 90 * 60000);
    expect(block).toContain(`DTEND:${end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    expect(block).toContain("STATUS:CONFIRMED");
  });

  it("canceled appointments stay in the feed as STATUS:CANCELLED", async () => {
    const patch = await api(`/api/crm/appointments/${appointmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "canceled" }),
    });
    expect(patch.status).toBe(200);

    const res = await api(new URL(feedUrl).pathname + new URL(feedUrl).search);
    const lines = unfold(res.text);
    const uidIdx = lines.indexOf(`UID:${appointmentId}@constructhub-crm`);
    const block = lines.slice(uidIdx, lines.indexOf("END:VEVENT", uidIdx));
    expect(block).toContain("STATUS:CANCELLED");
  });

  it("401s a missing or bogus token and 404s a token for an unknown org", async () => {
    expect((await api("/api/crm/calendar/feed.ics")).status).toBe(401);
    expect((await api("/api/crm/calendar/feed.ics?token=not-a-real-token")).status).toBe(401);
    expect(
      (await api(`/api/crm/calendar/feed.ics?token=${randomUUID()}.1.${"a".repeat(32)}`)).status,
    ).toBe(404);
  });

  it("rotate kills the old URL and issues a working new one", async () => {
    const rotated = await api("/api/crm/calendar/rotate-feed-token", { method: "POST", body: "{}" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.url).toContain("/api/crm/calendar/feed.ics?token=");
    expect(rotated.body.url).not.toBe(feedUrl);

    const oldFeed = await api(new URL(feedUrl).pathname + new URL(feedUrl).search);
    expect(oldFeed.status).toBe(401);

    const newUrl = new URL(rotated.body.url);
    const newFeed = await api(newUrl.pathname + newUrl.search);
    expect(newFeed.status).toBe(200);
    expect(newFeed.text).toContain("BEGIN:VCALENDAR");

    // feed-url now reports the rotated URL, so the settings page stays in sync.
    const current = await api("/api/crm/calendar/feed-url");
    expect(current.body.url).toBe(rotated.body.url);
  });
});

describe("google calendar honesty (dev server)", () => {
  it("status reports configured ⇔ no missing vars, and names them otherwise", async () => {
    const res = await api("/api/crm/calendar/google/status");
    expect(res.status).toBe(200);
    expect(typeof res.body.configured).toBe("boolean");
    expect(Array.isArray(res.body.missing)).toBe(true);
    if (res.body.configured) {
      expect(res.body.missing).toEqual([]);
    } else {
      // The honest not-configured state: the operator sees exactly what to set.
      expect(res.body.missing.length).toBeGreaterThan(0);
      for (const v of res.body.missing) {
        expect(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]).toContain(v);
      }
      expect(res.body.missing).toContain("GOOGLE_CLIENT_ID");
    }
    expect(res.body.scope).toBe("https://www.googleapis.com/auth/calendar.events");
    expect("connection" in res.body).toBe(true);
  });

  it("connect 503s with the missing var names when unconfigured", async () => {
    const status = await api("/api/crm/calendar/google/status");
    if (status.body.configured) return; // nothing to assert in a configured env
    const res = await api("/api/crm/calendar/google/connect");
    expect(res.status).toBe(503);
    expect(res.body.missing).toEqual(status.body.missing);
  });

  it("sync refuses cleanly (409, not a crash) when nothing is connected", async () => {
    const status = await api("/api/crm/calendar/google/status");
    if (status.body.connection) return; // connected org — skip
    const res = await api("/api/crm/calendar/google/sync", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
  });
});
