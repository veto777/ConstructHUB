/**
 * First-party analytics hardening (server/analytics.ts). Runs against the
 * dev server (CRM_TEST_BASE_URL) like admin.test.ts; every row these tests
 * insert is deleted again in afterAll.
 *
 * Pinned behaviours:
 *   1. Consent is enforced exactly: ch_consent === "granted" AND a
 *      server-minted ch_vid, or nothing is recorded.
 *   2. The events endpoint is per-IP throttled (120 events/15min, batch rows
 *      counted) — the dashboard-poisoning flood now 429s.
 *   3. Malformed cookie %-escapes never 500 either endpoint.
 *   4. Query strings (invite tokens!) are stripped before storage and the
 *      stored ip is anonymized to a /24.
 *   5. The consent endpoint always mints ch_vid server-side — a
 *      client-supplied one is ignored (visitor-id fixation).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import pg from "pg";
import { isMintedVisitorId, stripQuery, anonymizeIp } from "./analytics";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: any[] = []) => pool.query(text, params);

const vidsToClean: string[] = [];

// The dev server trusts one proxy hop, so a fixed random XFF both isolates
// this run's rate-limit bucket and controls the ip that lands in storage.
const freshXff = () =>
  `10.${100 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 250)}`;

function postEvents(body: any, cookie = "", xff?: string) {
  return fetch(`${BASE}/api/analytics/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(xff ? { "x-forwarded-for": xff } : {}),
    },
    body: JSON.stringify(body),
  });
}

function postConsent(granted: boolean, cookie = "") {
  return fetch(`${BASE}/api/analytics/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ granted }),
  });
}

beforeAll(async () => {
  const r = await fetch(`${BASE}/api/crm/me`);
  expect(r.status, "dev server reachable").toBe(200);
});

afterAll(async () => {
  if (vidsToClean.length) {
    await q(`delete from ch_analytics_events where visitor_id = any($1::text[])`, [vidsToClean]);
  }
  await pool.end();
});

describe("analytics helpers (unit)", () => {
  it("isMintedVisitorId accepts only server-minted uuids", () => {
    expect(isMintedVisitorId(randomUUID())).toBe(true);
    expect(isMintedVisitorId("../../etc/passwd")).toBe(false);
    expect(isMintedVisitorId("abc")).toBe(false);
    expect(isMintedVisitorId("550e8400-e29b-41d4-a716-44665544000Z")).toBe(false);
    expect(isMintedVisitorId("")).toBe(false);
  });

  it("stripQuery drops query string and fragment", () => {
    expect(stripQuery("/crm/join?token=abc")).toBe("/crm/join");
    expect(stripQuery("https://ref.example/p?utm=x&token=abc")).toBe("https://ref.example/p");
    expect(stripQuery("/a/b#frag")).toBe("/a/b");
    expect(stripQuery("/plain")).toBe("/plain");
  });

  it("anonymizeIp keeps a /24 for IPv4 and a /48 for IPv6", () => {
    expect(anonymizeIp("203.0.113.77")).toBe("203.0.113.0/24");
    expect(anonymizeIp("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd::/48");
  });
});

describe("POST /api/analytics/events consent gate", () => {
  it("no consent cookie records nothing", async () => {
    const r = await postEvents({ events: [{ path: "/x" }] });
    expect(r.status).toBe(200);
    expect((await r.json()).recorded).toBe(0);
  });

  it("a forged ch_vid shape records nothing even with granted consent", async () => {
    const r = await postEvents(
      { events: [{ path: "/x" }] },
      "ch_consent=granted; ch_vid=../../etc/passwd",
      freshXff(),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).recorded).toBe(0);
  });

  it("granted consent + minted vid records — query stripped, ip anonymized", async () => {
    const vid = randomUUID();
    vidsToClean.push(vid);
    const r = await postEvents(
      { events: [{ path: "/crm/join?token=abc123", referrer: "https://ref.example/p?utm=x&token=abc" }] },
      `ch_consent=granted; ch_vid=${vid}`,
      "203.0.113.77",
    );
    expect(r.status).toBe(200);
    expect((await r.json()).recorded).toBe(1);

    const { rows } = await q(
      `select path, referrer, ip from ch_analytics_events where visitor_id = $1`,
      [vid],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe("/crm/join");
    expect(rows[0].referrer).toBe("https://ref.example/p");
    expect(rows[0].ip).toBe("203.0.113.0/24");
  });

  it("429s once an ip blows through 120 events in the window", async () => {
    const vid = randomUUID();
    vidsToClean.push(vid);
    const xff = freshXff();
    const cookie = `ch_consent=granted; ch_vid=${vid}`;
    const batch = { events: Array.from({ length: 20 }, (_, i) => ({ path: `/flood/${i}` })) };
    for (let i = 0; i < 6; i++) {
      const r = await postEvents(batch, cookie, xff);
      expect(r.status).toBe(200);
      expect((await r.json()).recorded).toBe(20);
    }
    const seventh = await postEvents(batch, cookie, xff);
    expect(seventh.status).toBe(429);
  });

  it("a malformed % sequence in the cookie header never 500s", async () => {
    const bad = await postEvents(
      { events: [{ path: "/x" }] },
      "ch_consent=%E0%A4%A; ch_vid=%E0%A4%A",
      freshXff(),
    );
    expect(bad.status).not.toBe(500);
    expect((await bad.json()).recorded).toBe(0);

    const consent = await postConsent(true, "ch_vid=%E0%A4%A");
    expect(consent.status).toBe(200);
  });
});

describe("POST /api/analytics/consent", () => {
  it("always mints ch_vid server-side — a client-supplied one is ignored", async () => {
    const supplied = randomUUID();
    const r = await postConsent(true, `ch_vid=${supplied}`);
    expect(r.status).toBe(200);
    const set = r.headers.get("set-cookie") || "";
    const m = set.match(/ch_vid=([0-9a-f-]{36})/);
    expect(m, `ch_vid in Set-Cookie: ${set}`).toBeTruthy();
    expect(m![1]).not.toBe(supplied);
  });
});
