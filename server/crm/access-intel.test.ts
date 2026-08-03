/**
 * Access intelligence on public estimates — the three "who else is looking
 * at my bid" signals, against the running dev server:
 *
 *  1. A gate attempt with an email NOT on the estimate's list records an
 *     access_denied event carrying the typed address (response unchanged —
 *     never an enumeration oracle).
 *  2. A spent first-open pass redeemed again with the doc token records
 *     forward_detected; an unknown token records NOTHING (proves nothing).
 *  3. The verified client shares with another email: the share is recorded,
 *     the new email passes the gate, and duplicate/cap rules hold.
 *
 * Requires the dev server:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  return {
    status: res.status,
    body: res.status === 204 || res.status === 302 ? null : await res.json().catch(() => null),
  };
}

/** Mint a live client session directly (same shape as a redeemed magic link). */
async function clientCookie(custId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([custId])],
  );
  return `crm_client=${raw}`;
}

const events = (estId: string, type: string) =>
  q<{ meta: any }>(
    `select meta from crm_estimate_events where estimate_id = $1 and type = $2 order by created_at desc`,
    [estId, type],
  );

let customerId = "", estimateId = "", publicToken = "";

beforeAll(async () => {
  const me = await fetch(`${BASE}/api/crm/me`);
  if (me.status !== 200) throw new Error(`dev server not reachable (${me.status})`);

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Intel Test ${stamp}`, email: `intel-${stamp}@example.com` }),
  });
  expect(cust.status).toBe(201);
  customerId = cust.body.id;

  const est = await api("/api/crm/estimates", {
    method: "POST",
    body: JSON.stringify({
      customerId, title: "Intel fixture", taxRateBps: 0,
      items: [{ kind: "labor", name: "Line", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: 50_00, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    }),
  });
  expect(est.status).toBe(201);
  estimateId = est.body.id;
  const send = await api(`/api/crm/estimates/${estimateId}/send`, { method: "POST", body: "{}" });
  expect(send.status).toBe(200);
  publicToken = (await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estimateId]))[0].public_token;
});

describe("1. denied gate attempts are recorded with the typed email", () => {
  it("logs access_denied and keeps the anti-enumeration response", async () => {
    const r = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: "rival@competitor.example.com" }),
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sent: true }); // identical to a match — no oracle
    const evs = await events(estimateId, "access_denied");
    expect(evs.length).toBe(1);
    expect(evs[0].meta.attemptedEmail).toBe("rival@competitor.example.com");
  });

  it("a MATCPHING email logs nothing", async () => {
    const custEmail = (await q<{ email: string }>(
      `select email from crm_customers where id = $1`, [customerId]))[0].email;
    const r = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: custEmail }),
    });
    expect(r.status).toBe(200);
    expect((await events(estimateId, "access_denied")).length).toBe(1); // unchanged
  });
});

describe("2. forward detection on a spent first-open pass", () => {
  it("a reused pass records forward_detected; an unknown token records nothing", async () => {
    // A pass that was already redeemed once (used_at set).
    const raw = randomBytes(32).toString("hex");
    await q(
      `insert into crm_client_tokens (token_hash, customer_ids, email, expires_at, used_at)
       values ($1, $2::jsonb, 'x@example.com', now() + interval '7 days', now())`,
      [sha256(raw), JSON.stringify([customerId])],
    );
    const reuse = await api("/api/client/auth/redeem", {
      method: "POST",
      body: JSON.stringify({ token: raw, docToken: publicToken }),
    });
    expect(reuse.status).toBe(410);
    expect((await events(estimateId, "forward_detected")).length).toBe(1);

    // Bogus token: same 410, but proves nothing → no event.
    const bogus = await api("/api/client/auth/redeem", {
      method: "POST",
      body: JSON.stringify({ token: randomBytes(32).toString("hex"), docToken: publicToken }),
    });
    expect(bogus.status).toBe(410);
    expect((await events(estimateId, "forward_detected")).length).toBe(1);
  });
});

describe("3. the client shares with someone else", () => {
  it("session-gated; records the share; the shared email then passes the gate", async () => {
    // Anonymous share attempt → the email gate, not a share.
    const anon = await api(`/api/public/estimates/${publicToken}/share`, {
      method: "POST", body: JSON.stringify({ email: "spouse@example.com" }),
    });
    expect(anon.status).toBe(401);

    const cookie = await clientCookie(customerId);
    const ok = await api(`/api/public/estimates/${publicToken}/share`, {
      method: "POST", body: JSON.stringify({ email: "spouse@example.com" }),
    }, cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.sharedWith).toBe("spouse@example.com");
    const evs = await events(estimateId, "shared");
    expect(evs.length).toBe(1);
    expect(evs[0].meta.sharedWith).toBe("spouse@example.com");

    // Duplicates refuse.
    const dup = await api(`/api/public/estimates/${publicToken}/share`, {
      method: "POST", body: JSON.stringify({ email: "spouse@example.com" }),
    }, cookie);
    expect(dup.status).toBe(400);

    // The shared email now MATCHES at the gate: a link token gets minted for
    // it and no access_denied event is added.
    const before = (await events(estimateId, "access_denied")).length;
    const gate = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: "spouse@example.com" }),
    });
    expect(gate.status).toBe(200);
    expect((await events(estimateId, "access_denied")).length).toBe(before);
    const minted = await q(
      `select 1 from crm_client_tokens where email = 'spouse@example.com'
        and customer_ids @> $1::jsonb and used_at is null and expires_at > now()`,
      [JSON.stringify([customerId])],
    );
    expect(minted.length).toBeGreaterThan(0);
  });

  it("the engagement payload carries all three signals for the contractor", async () => {
    const eng = await api(`/api/crm/estimates/${estimateId}/engagement`);
    expect(eng.status).toBe(200);
    const types = (eng.body.accessEvents ?? []).map((e: any) => e.type).sort();
    expect(types).toEqual(["access_denied", "forward_detected", "shared"]);
    const shared = eng.body.accessEvents.find((e: any) => e.type === "shared");
    expect(shared.email).toBe("spouse@example.com");
  });
});
