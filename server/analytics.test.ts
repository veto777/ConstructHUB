/**
 * First-party analytics hardening (server/analytics.ts). Runs against the
 * dev server (CRM_TEST_BASE_URL) like admin.test.ts; every row these tests
 * insert is deleted again in afterAll.
 *
 * Pinned behaviours:
 *   1. Consent is enforced exactly: ch_consent === "granted" AND a
 *      server-minted ch_vid, or nothing is recorded.
 *   2. The events endpoint is throttled per visitor (120 events/15min, batch
 *      rows counted) with a generous per-IP backstop, so an office sharing one
 *      IP is not cut off; the flood 429s with a Retry-After.
 *   3. Malformed cookie %-escapes never 500 either endpoint.
 *   4. Query strings (invite tokens!) are stripped before storage and the
 *      stored ip is anonymized to a /24.
 *   5. The consent endpoint always mints ch_vid server-side — a
 *      client-supplied one is ignored (visitor-id fixation).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import pg from "pg";
import { isMintedVisitorId, stripQuery, anonymizeIp, createEventLimiter } from "./analytics";

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

describe("event limiter (unit)", () => {
  const make = (start = 0) => {
    let t = start;
    const lim = createEventLimiter({ visitorLimit: 10, ipLimit: 25, windowMs: 1000, now: () => t });
    return { lim, tick: (ms: number) => { t += ms; } };
  };

  it("caps one visitor without touching another visitor on the same IP", () => {
    const { lim } = make();
    expect(lim.take("a", "1.2.3.4", 10).ok).toBe(true);
    expect(lim.take("a", "1.2.3.4", 1).ok).toBe(false);
    expect(lim.take("b", "1.2.3.4", 10).ok).toBe(true);
  });

  it("the IP backstop still stops a flood of minted visitor ids", () => {
    const { lim } = make();
    expect(lim.take("a", "ip", 10).ok).toBe(true);
    expect(lim.take("b", "ip", 10).ok).toBe(true);
    const third = lim.take("c", "ip", 10);
    expect(third.ok).toBe(false);
    expect(lim.take("c", "other-ip", 10).ok).toBe(true);
  });

  it("a refusal charges neither budget, and says when to retry", () => {
    const { lim, tick } = make();
    expect(lim.take("a", "ip", 8).ok).toBe(true);
    tick(400);
    expect(lim.take("a", "ip", 2).ok).toBe(true);
    const refused = lim.take("a", "ip", 3);
    expect(refused).toEqual({ ok: false, retryAfterMs: 600 });
    // The refused 3 rows were not counted against the IP either.
    expect(lim.take("b", "ip", 10).ok).toBe(true);
    expect(lim.take("c", "ip", 5).ok).toBe(true);
    tick(600);
    expect(lim.take("a", "ip", 3).ok).toBe(true);
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

  it("redacts bearer path segments even when clients submit raw URLs", async () => {
    const vid = randomUUID();
    vidsToClean.push(vid);
    const r = await postEvents(
      { events: [{ path: "/review/private-token/unsubscribe", referrer: "https://example.invalid/contract/sign/private-contract?secret=1" }] },
      `ch_consent=granted; ch_vid=${vid}`, freshXff(),
    );
    expect(r.status).toBe(200);
    const { rows } = await q("select path, referrer from ch_analytics_events where visitor_id = $1", [vid]);
    expect(rows).toEqual([{ path: "/review/:token/unsubscribe", referrer: "https://example.invalid/contract/sign/:token" }]);
  });

  it("429s once a visitor blows through 120 events in the window, not their office neighbour", async () => {
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
    expect(Number(seventh.headers.get("retry-after"))).toBeGreaterThan(0);

    // A second visitor behind the same IP is still counted.
    const other = randomUUID();
    vidsToClean.push(other);
    const neighbour = await postEvents({ events: [{ path: "/flood/neighbour" }] }, `ch_consent=granted; ch_vid=${other}`, xff);
    expect(neighbour.status).toBe(200);
    expect((await neighbour.json()).recorded).toBe(1);
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
