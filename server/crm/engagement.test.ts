/**
 * Client engagement + estimate expiry.
 *
 * Part 1 is pure unit math (duration caps, gap handling, expiry-on-send,
 * IP redaction) — no server needed.
 *
 * Part 2 exercises the running dev server like money-pipeline.test.ts does:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

// portal.ts pulls in entities → ../stripe, which throws without a key at
// module scope. A dummy value is enough for import (no queries are run here).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

// The public respond/engagement routes are email-gated: they need a
// crm_client session covering the document's customer. Mint it directly —
// same shape as a redeemed magic link. NOTE: DATABASE_URL is deliberately
// poisoned above (import shim), so the pool uses the dev DSN explicitly.
const pool = new pg.Pool({
  connectionString: "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function clientCookie(customerId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([customerId])],
  );
  return `crm_client=${raw}`;
}

let engagementIncrement: any, estimateExpiryOnSend: any, redactIpPrefix: any, ESTIMATE_EXPIRY_DAYS: number;

beforeAll(async () => {
  ({ engagementIncrement, estimateExpiryOnSend, redactIpPrefix, ESTIMATE_EXPIRY_DAYS } =
    await import("./portal"));
});

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("engagement duration math (pure)", () => {
  const t0 = new Date("2026-01-01T12:00:00Z");

  it("counts the real gap in whole seconds", () => {
    expect(engagementIncrement(t0, new Date(t0.getTime() + 15_000))).toBe(15);
    expect(engagementIncrement(t0, new Date(t0.getTime() + 1_300))).toBe(1);
  });

  it("caps a long gap at 60s — an idle background tab is not reading time", () => {
    expect(engagementIncrement(t0, new Date(t0.getTime() + 3_600_000))).toBe(60);
    expect(engagementIncrement(t0, new Date(t0.getTime() + 61_000))).toBe(60);
  });

  it("never goes negative and never counts the first beat", () => {
    expect(engagementIncrement(null, t0)).toBe(0);
    expect(engagementIncrement(t0, t0)).toBe(0);
    expect(engagementIncrement(t0, new Date(t0.getTime() - 5_000))).toBe(0);
  });
});

describe("estimate expiry math (pure)", () => {
  it("defaults to 7 days from send", () => {
    expect(ESTIMATE_EXPIRY_DAYS).toBe(7);
    const sent = new Date("2026-03-01T09:00:00Z");
    expect(estimateExpiryOnSend(sent).toISOString()).toBe("2026-03-08T09:00:00.000Z");
  });
});

describe("IP redaction (pure)", () => {
  it("redacts v4 to /24 and v6 to /48", () => {
    expect(redactIpPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(redactIpPrefix("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd::/48");
    expect(redactIpPrefix(null)).toBeNull();
    expect(redactIpPrefix("")).toBeNull();
  });
});

describe("expiry + engagement against the dev server", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
  });

  async function makeSentEstimate() {
    const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({ displayName: `Vitest Engage ${run}`, email: `vitest.eng.${run}@example.com` }),
    }, cookie);
    expect(cust.status).toBe(201);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.body.id, title: "Vitest engagement estimate",
        items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 10000 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    return est.body;
  }

  it("drafts carry no expiry; sending stamps sentAt + 7 days", async () => {
    const est = await makeSentEstimate();
    expect(est.expiresAt).toBeNull();

    const send = await api(`/api/crm/estimates/${est.id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    const sentAt = new Date(send.body.estimate.sentAt).getTime();
    const expiresAt = new Date(send.body.estimate.expiresAt).getTime();
    expect(expiresAt - sentAt).toBe(7 * 86_400_000);
  });

  it("extend pushes expiry out while unanswered, and is refused after approval", async () => {
    const est = await makeSentEstimate();
    const send = await api(`/api/crm/estimates/${est.id}/send`, { method: "POST", body: "{}" }, cookie);
    const token = send.body.link.split("/e/")[1];

    // Extend by 10 days → roughly now + 10d (and later than the +7d from send).
    const ext = await api(`/api/crm/estimates/${est.id}/extend`, {
      method: "POST", body: JSON.stringify({ days: 10 }),
    }, cookie);
    expect(ext.status).toBe(200);
    const extended = new Date(ext.body.estimate.expiresAt).getTime();
    expect(extended).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    expect(extended).toBeGreaterThan(new Date(send.body.estimate.expiresAt).getTime());

    // Bad input is a 400, not a silent clamp.
    const bad = await api(`/api/crm/estimates/${est.id}/extend`, {
      method: "POST", body: JSON.stringify({ days: 0 }),
    }, cookie);
    expect(bad.status).toBe(400);

    // Approve via the public link (as the verified client), then extend must
    // be refused.
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, await clientCookie(est.customerId));
    expect(approve.status).toBe(200);
    const late = await api(`/api/crm/estimates/${est.id}/extend`, {
      method: "POST", body: JSON.stringify({ days: 7 }),
    }, cookie);
    expect(late.status).toBe(409);
  });

  it("heartbeats accumulate capped, server-side duration; CRM read redacts IPs", async () => {
    const est = await makeSentEstimate();
    const send = await api(`/api/crm/estimates/${est.id}/send`, { method: "POST", body: "{}" }, cookie);
    const token = send.body.link.split("/e/")[1];

    // The engagement session opens as the verified client — anonymous
    // browsers get a silent no-op from the gated start route.
    const client = await clientCookie(est.customerId);
    const start = await api("/api/public/engagement/start", {
      method: "POST", body: JSON.stringify({ docType: "estimate", token }),
    }, client);
    expect(start.status).toBe(200);
    const sessionId = start.body.sessionId;
    expect(sessionId).toBeTruthy();

    // Short real pings (no fake timers in e2e either): two ~1.3s gaps.
    await sleep(1300);
    const p1 = await api("/api/public/engagement/ping", {
      method: "POST", body: JSON.stringify({ sessionId }),
    });
    expect(p1.status).toBe(200);
    await sleep(1300);
    const p2 = await api("/api/public/engagement/ping", {
      method: "POST", body: JSON.stringify({ sessionId }),
    });
    expect(p2.status).toBe(200);
    expect(p2.body.durationSecs).toBeGreaterThanOrEqual(2);

    // The CRM read aggregates and never exposes a raw client IP.
    const eng = await api(`/api/crm/estimates/${est.id}/engagement`, {}, cookie);
    expect(eng.status).toBe(200);
    expect(eng.body.visits).toBeGreaterThanOrEqual(1);
    expect(eng.body.totalSecs).toBeGreaterThanOrEqual(2);
    for (const s of eng.body.sessions) {
      if (s.ip) expect(s.ip).toMatch(/\/24|\/48/);
    }

    // An unsent draft is not trackable (internal previews are not the client).
    const draft = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: est.customerId, title: "Draft",
        items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 100 }],
      }),
    }, cookie);
    expect(draft.status).toBe(201);
    const detail = await api(`/api/crm/estimates/${draft.body.id}`, {}, cookie);
    expect(detail.body.publicPath).toMatch(/^\/e\//);
    const draftToken = detail.body.publicPath.split("/e/")[1];
    const draftStart = await api("/api/public/engagement/start", {
      method: "POST", body: JSON.stringify({ docType: "estimate", token: draftToken }),
    });
    expect(draftStart.status).toBe(200);
    expect(draftStart.body.sessionId).toBeNull();
  });
});
