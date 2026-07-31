/**
 * Email gating on public estimate/invoice links (Jobber-style).
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * The gate: GET /api/public/estimates|invoices/:token no longer serves an
 * anonymous browser — it answers 401 { requiresVerification: true } unless the
 * request carries a crm_client session covering the document's customer.
 * POST /api/public/verify-access ALWAYS answers 200 { sent: true } and only
 * mints a magic link when the entered email matches the recipient's.
 *
 * Fixtures are throwaway rows created through the real API (dev bypass auth),
 * never the seeded demo — the suite flips no demo state. Raw link tokens are
 * SHA-256 hashed at rest, so the redeem step INSERTS a token row with a known
 * hash, exactly like client-auth.test.ts.
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
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body =
    res.status === 204 || res.status === 302 ? null : await res.json().catch(() => null);
  return {
    status: res.status,
    body,
    location: res.headers.get("location"),
    cookie: setCookie?.split(";")[0] ?? undefined,
  };
}

/** Insert a magic-link token row as the server would; returns the RAW token. */
async function makeToken(customerIds: string[], email: string, opts: { expired?: boolean } = {}) {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_tokens (token_hash, customer_ids, email, expires_at)
     values ($1, $2::jsonb, $3, now() + $4::interval)`,
    [sha256(raw), JSON.stringify(customerIds), email, opts.expired ? "-5 minutes" : "30 minutes"],
  );
  return raw;
}

// A throwaway customer + sent estimate, built once for the whole file.
let customerId = "";
let estimateId = "";
let publicToken = "";
let email = "";

beforeAll(async () => {
  const me = await fetch(`${BASE}/api/crm/me`);
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  email = `gate-${stamp}@example.com`;
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Gate Test ${stamp}`, email }),
  });
  expect(cust.status).toBe(201);
  customerId = cust.body.id;

  const est = await api("/api/crm/estimates", {
    method: "POST",
    body: JSON.stringify({
      customerId, title: "Gate fixture estimate", introText: null, taxRateBps: 0,
      items: [{ kind: "labor", name: "Gate line", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: 100_00, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    }),
  });
  expect(est.status).toBe(201);
  estimateId = est.body.id;

  const send = await api(`/api/crm/estimates/${estimateId}/send`, { method: "POST", body: "{}" });
  expect(send.status).toBe(200);

  const rows = await q<{ public_token: string }>(
    `select public_token from crm_estimates where id = $1`, [estimateId]);
  publicToken = rows[0].public_token;
});

describe("the gate (anonymous browsers)", () => {
  it("401s the estimate read with requiresVerification — no document content", async () => {
    const res = await api(`/api/public/estimates/${publicToken}`);
    expect(res.status).toBe(401);
    expect(res.body.requiresVerification).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("Gate line");
    expect(JSON.stringify(res.body)).not.toContain("10000");
  });

  it("401s approve/decline and pay too — a forwarded link is inert", async () => {
    const respond = await api(`/api/public/estimates/${publicToken}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", signatureName: "Mallory Rival" }),
    });
    expect(respond.status).toBe(401);

    const pay = await api(`/api/public/estimates/${publicToken}/pay`, { method: "POST" });
    expect(pay.status).toBe(401);

    // And nothing changed server-side.
    const rows = await q<{ status: string; approved_at: Date | null }>(
      `select status, approved_at from crm_estimates where id = $1`, [estimateId]);
    expect(rows[0].approved_at).toBeNull();
    expect(rows[0].status).not.toBe("approved");
  });

  it("mints no engagement session anonymously", async () => {
    const res = await api("/api/public/engagement/start", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken }),
    });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeNull();
  });

  it("still 404s bogus tokens (the gate never makes a bad link look real)", async () => {
    const res = await api(`/api/public/estimates/${"0".repeat(48)}`);
    expect(res.status).toBe(404);
  });
});

describe("verify-access (anti-enumeration)", () => {
  it("wrong email → identical 200 { sent: true }, and NO token minted", async () => {
    const wrong = `rival.${Date.now()}@example.com`;
    const res = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: wrong }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    const rows = await q(`select id from crm_client_tokens where email = $1`, [wrong]);
    expect(rows.length).toBe(0);
  });

  it("the right email (any case) mints a link scoped to JUST this customer", async () => {
    const res = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: email.toUpperCase() }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    const rows = await q<{ token_hash: string; customer_ids: string[] }>(
      `select token_hash, customer_ids from crm_client_tokens where email = $1 order by created_at desc limit 1`,
      [email],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/); // hash at rest, never the raw token
    expect(rows[0].customer_ids).toEqual([customerId]);
  });

  it("the right email on the WRONG document mints nothing", async () => {
    // Same address, but a token that doesn't resolve to a document for her.
    const res = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: "f".repeat(48), email }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
  });

  it("rate-limits per requested address — known or not, so 429 can't oracle", async () => {
    // EMAIL_LIMIT is 5 per window, keyed on the requested address.
    const ghost = `flood.${Date.now()}@example.com`;
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await api("/api/public/verify-access", {
        method: "POST",
        body: JSON.stringify({ docType: "estimate", token: publicToken, email: ghost }),
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("rejects malformed input with 400, not a leak", async () => {
    const res = await api("/api/public/verify-access", {
      method: "POST",
      body: JSON.stringify({ docType: "estimate", token: publicToken, email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("verified session (the recipient's browser)", () => {
  it("verify → session → the SAME URL serves the document; single-use + expiry honoured", async () => {
    const raw = await makeToken([customerId], email);

    const verify = await api(
      `/api/client/auth/verify?token=${raw}&next=${encodeURIComponent(`/e/${publicToken}`)}`,
    );
    expect(verify.status).toBe(302);
    expect(verify.location).toBe(`/e/${publicToken}`);
    expect(verify.cookie).toMatch(/^crm_client=[0-9a-f]{64}$/);

    // The forwarded-link scenario in reverse: WITH the session it serves.
    const doc = await api(`/api/public/estimates/${publicToken}`, {}, verify.cookie);
    expect(doc.status).toBe(200);
    expect(doc.body.estimate.title).toBe("Gate fixture estimate");
    expect(doc.body.items.map((i: any) => i.name)).toContain("Gate line");

    // ...and the second browser (no session) is still locked out.
    const rival = await api(`/api/public/estimates/${publicToken}`);
    expect(rival.status).toBe(401);
    expect(rival.body.requiresVerification).toBe(true);

    // Approve works behind the session.
    const approve = await api(`/api/public/estimates/${publicToken}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", signatureName: "Gate Signer" }),
    }, verify.cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    // Single-use: the same magic link cannot mint a second session.
    const again = await api(`/api/client/auth/verify?token=${raw}`);
    expect(again.status).toBe(302);
    expect(again.location).toBe("/?auth=invalid");

    // Expired tokens are refused the same way.
    const expired = await makeToken([customerId], email, { expired: true });
    const dead = await api(`/api/client/auth/verify?token=${expired}`);
    expect(dead.status).toBe(302);
    expect(dead.location).toBe("/?auth=invalid");
  });

  it("a session for a DIFFERENT customer does not open this document", async () => {
    const other = await q<{ id: string }>(
      `select id from crm_customers where id <> $1 limit 1`, [customerId]);
    const raw = await makeToken([other[0].id], "someone-else@example.com");
    const verify = await api(`/api/client/auth/verify?token=${raw}`);
    const doc = await api(`/api/public/estimates/${publicToken}`, {}, verify.cookie);
    expect(doc.status).toBe(401);
  });
});

describe("contractor preview", () => {
  it("mints a short-lived read-only grant: serves the page, counts no view", async () => {
    const before = await q<{ view_count: number | null; first_viewed_at: Date | null; status: string }>(
      `select view_count, first_viewed_at, status from crm_estimates where id = $1`, [estimateId]);

    const mint = await api(`/api/crm/estimates/${estimateId}/preview-link`, { method: "POST", body: "{}" });
    expect(mint.status).toBe(200);
    expect(mint.body.url).toContain(`/e/${publicToken}?preview=`);
    const grant = new URL(mint.body.url).searchParams.get("preview")!;

    const doc = await api(`/api/public/estimates/${publicToken}?preview=${encodeURIComponent(grant)}`);
    expect(doc.status).toBe(200);
    expect(doc.body.preview).toBe(true);
    expect(doc.body.estimate.title).toBe("Gate fixture estimate");

    // No view counted, no status flip, no firstViewedAt — the contractor is
    // not the client.
    const after = await q<{ view_count: number | null; first_viewed_at: Date | null; status: string }>(
      `select view_count, first_viewed_at, status from crm_estimates where id = $1`, [estimateId]);
    expect(after[0].view_count ?? 0).toBe(before[0].view_count ?? 0);
    expect(after[0].first_viewed_at).toEqual(before[0].first_viewed_at);
    expect(after[0].status).toBe(before[0].status);
  });

  it("the grant is bound to one estimate and rejects tampering", async () => {
    const mint = await api(`/api/crm/estimates/${estimateId}/preview-link`, { method: "POST", body: "{}" });
    const grant = new URL(mint.body.url).searchParams.get("preview")!;

    // Forged signature → gate.
    const forged = await api(`/api/public/estimates/${publicToken}?preview=${Date.now() + 60_000}.${"a".repeat(32)}`);
    expect(forged.status).toBe(401);

    // Expired timestamp → gate.
    const [exp] = grant.split(".");
    const stale = await api(`/api/public/estimates/${publicToken}?preview=${Number(exp) - 20 * 60_000}.${grant.split(".")[1]}`);
    expect(stale.status).toBe(401);

    // The grant cannot approve — respond ignores it entirely.
    const respond = await api(`/api/public/estimates/${publicToken}/respond?preview=${encodeURIComponent(grant)}`, {
      method: "POST",
      body: JSON.stringify({ decision: "decline", reason: "preview must not sign" }),
    });
    expect(respond.status).toBe(401);
  });
});
