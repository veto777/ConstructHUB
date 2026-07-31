/**
 * Homeowner client portal auth — magic link, sessions, document scoping.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * The seeded Aspire demo data is the fixture: kane@example.com owns approved
 * estimate E-2001 (= a signed contract) and unpaid invoice INV-2002, while
 * luis.orozco@example.com owns estimate E-2002 and vince.c@example.com owns
 * invoice INV-2001 — the neighbours who must never leak into Kane's session.
 *
 * Raw link tokens are SHA-256 hashed at rest, so tests can't read a minted
 * token back out of the DB. Instead they INSERT token rows with a known hash
 * (the same shape request-link writes) — which also gives exact control over
 * expiry for the expired-token cases.
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

/** Insert a magic-link token row exactly as request-link would; returns the RAW token. */
async function makeToken(
  customerIds: string[],
  email: string,
  opts: { expired?: boolean } = {},
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_tokens (token_hash, customer_ids, email, expires_at)
     values ($1, $2::jsonb, $3, now() + $4::interval)`,
    [
      sha256(raw),
      JSON.stringify(customerIds),
      email,
      opts.expired ? "-5 minutes" : "30 minutes",
    ],
  );
  return raw;
}

async function kaneId(): Promise<string> {
  const rows = await q<{ id: string }>(
    `select id from crm_customers where lower(email) = 'kane@example.com' limit 1`,
  );
  if (!rows.length) throw new Error("seeded customer kane@example.com missing — run scripts/seed-crm-demo.ts");
  return rows[0].id;
}

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/crm/me`);
  if (res.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${res.status}). Start it first.`);
  }
});

describe("request-link (anti-enumeration)", () => {
  it("answers 200 { sent: true } for an email no customer has — and creates nothing", async () => {
    const email = `ghost.${Date.now()}@example.com`;
    const res = await api("/api/client/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    const rows = await q(`select id from crm_client_tokens where email = $1`, [email]);
    expect(rows.length).toBe(0);
  });

  it("answers identically for a known email and stores only the hash, case-insensitively", async () => {
    const kane = await kaneId();
    const res = await api("/api/client/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "KANE@Example.com" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    const rows = await q<{ token_hash: string; customer_ids: string[]; email: string }>(
      `select token_hash, customer_ids, email from crm_client_tokens
       where email = 'kane@example.com' order by created_at desc limit 1`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].customer_ids).toContain(kane);
  });

  it("rejects a malformed email with 400, not a leak", async () => {
    const res = await api("/api/client/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated requests for the same address — known or not", async () => {
    // The bucket is keyed on the requested address itself, so a 429 can never
    // reveal whether the email exists. EMAIL_LIMIT is 5 per window.
    const email = `flood.${Date.now()}@example.com`;
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await api("/api/client/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("verify (magic link → session)", () => {
  it("rejects a bogus token with a redirect to the invalid state", async () => {
    const res = await api(`/api/client/auth/verify?token=${randomBytes(32).toString("hex")}`);
    expect(res.status).toBe(302);
    expect(res.location).toBe("/?auth=invalid");
    expect(res.cookie).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const kane = await kaneId();
    const raw = await makeToken([kane], "kane@example.com", { expired: true });
    const res = await api(`/api/client/auth/verify?token=${raw}`);
    expect(res.status).toBe(302);
    expect(res.location).toBe("/?auth=invalid");
    expect(res.cookie).toBeUndefined();
  });

  it("redeems a valid token exactly once: cookie, session row, then single-use", async () => {
    const kane = await kaneId();
    const raw = await makeToken([kane], "kane@example.com");

    const first = await api(`/api/client/auth/verify?token=${raw}`);
    expect(first.status).toBe(302);
    expect(first.location).toBe("/");
    expect(first.cookie).toMatch(/^crm_client=[0-9a-f]{64}$/);

    const sessions = await q<{ customer_ids: string[] }>(
      `select customer_ids from crm_client_sessions order by created_at desc limit 1`,
    );
    expect(sessions[0].customer_ids).toEqual([kane]);

    // Second use of the same link: the atomic used_at flip has already happened.
    const second = await api(`/api/client/auth/verify?token=${raw}`);
    expect(second.status).toBe(302);
    expect(second.location).toBe("/?auth=invalid");
    expect(second.cookie).toBeUndefined();
  });
});

describe("documents (session scoping)", () => {
  it("401s without a session cookie", async () => {
    const res = await api("/api/client/documents");
    expect(res.status).toBe(401);
  });

  it("returns exactly the session customer's documents, org branding included", async () => {
    const kane = await kaneId();
    const raw = await makeToken([kane], "kane@example.com");
    const verify = await api(`/api/client/auth/verify?token=${raw}`);
    const cookie = verify.cookie!;

    const res = await api("/api/client/documents", {}, cookie);
    expect(res.status).toBe(200);

    expect(res.body.customer.displayName).toBe("Joe & Mary Kane");
    expect(res.body.orgs.map((o: any) => o.name)).toEqual(["Aspire Interiors"]);

    // Kane's own: approved estimate E-2001 and open invoice INV-2002.
    const estNumbers = res.body.estimates.map((e: any) => e.number);
    const invNumbers = res.body.invoices.map((i: any) => i.number);
    expect(estNumbers).toContain("E-2001");
    expect(invNumbers).toContain("INV-2002");

    // The signed contract is the approved estimate, signature included.
    const contract = res.body.contracts.find((c: any) => c.number === "E-2001");
    expect(contract).toBeTruthy();
    expect(contract.signedName).toBe("Joe Kane");
    expect(contract.signedAt).toBeTruthy();
    expect(contract.link).toMatch(/^\/e\/[0-9a-f]{48}$/);

    // Isolation: the neighbours' documents must never appear.
    expect(estNumbers).not.toContain("E-2002"); // Orozco's estimate
    expect(invNumbers).not.toContain("INV-2001"); // Castellano's invoice
    for (const doc of [...res.body.estimates, ...res.body.invoices, ...res.body.contracts]) {
      expect(doc.orgName).toBe("Aspire Interiors");
    }

    // Sliding expiry: the read stamps last_seen_at and pushes expires_at out.
    const sess = await q<{ last_seen_at: Date | null; expires_at: Date }>(
      `select last_seen_at, expires_at from crm_client_sessions order by created_at desc limit 1`,
    );
    expect(sess[0].last_seen_at).toBeTruthy();
    expect(sess[0].expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it("logout destroys the session and clears the cookie", async () => {
    const kane = await kaneId();
    const raw = await makeToken([kane], "kane@example.com");
    const verify = await api(`/api/client/auth/verify?token=${raw}`);
    const cookie = verify.cookie!;

    const out = await api("/api/client/auth/logout", { method: "POST" }, cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(out.cookie).toBe("crm_client="); // value cleared, Max-Age=0

    const after = await api("/api/client/documents", {}, cookie);
    expect(after.status).toBe(401);
  });
});
