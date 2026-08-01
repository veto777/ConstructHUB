/**
 * Client portal v2 — attachments (pamphlet / estimate / photo) + client comments.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Fixtures are throwaway customers/estimates created through the real API and
 * cleaned up afterwards; client sessions are inserted with a known SHA-256,
 * the same shape a redeemed magic link writes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 vitest attachment fixture");

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

async function upload(
  path: string,
  file: { name: string; type: string; data: Buffer },
  fields: Record<string, string>,
  cookie?: string,
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([file.data], { type: file.type }), file.name);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: fd,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Insert a client session row as a redeemed magic link would; returns the RAW cookie token. */
async function makeClientSession(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return raw;
}

describe("client portal v2 — attachments + comments (dev server)", () => {
  let cookie: string | undefined;
  let custA: string;
  let custB: string;
  let estimateA: string;
  let publicTokenA: string;
  const attachmentIds: string[] = [];

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const mk = async (name: string) => {
      const r = await api("/api/crm/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name, email: `vitest.portal.${stamp}.${name.endsWith("B") ? "b" : "a"}@example.com` }),
      }, cookie);
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    custA = await mk("Vitest Portal A");
    custB = await mk("Vitest Portal B");

    const est = await api("/api/crm/estimates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: custA,
        title: "Vitest attachment estimate",
        items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 500, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    estimateA = est.body.id;
    const rows = await q<{ public_token: string }>(
      `select public_token from crm_estimates where id = $1`, [estimateA]);
    publicTokenA = rows[0].public_token;
  });

  afterAll(async () => {
    // Delete rows; files under tmp/crm-attachments are throwaway local storage.
    await q(`delete from crm_attachments where ref_id = any($1) or id = any($1)`, [[custA, custB, estimateA, ...attachmentIds]]);
    await q(`delete from crm_client_comments where customer_id = any($1)`, [[custA, custB]]);
    await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%' or customer_ids::text like '%' || $2 || '%'`, [custA, custB]);
    await q(`delete from crm_estimate_items where estimate_id = $1`, [estimateA]);
    await q(`delete from crm_estimates where id = $1`, [estimateA]);
    await q(`delete from crm_customers where id = any($1)`, [[custA, custB]]);
    await pool.end();
  });

  it("pamphlet upload → listed → gated client download (401 without a session)", async () => {
    const up = await upload("/api/crm/attachments",
      { name: "brochure.pdf", type: "application/pdf", data: PDF },
      { kind: "pamphlet" }, cookie);
    expect(up.status).toBe(201);
    expect(up.body.kind).toBe("pamphlet");
    attachmentIds.push(up.body.id);

    const list = await api("/api/crm/attachments?kind=pamphlet", {}, cookie);
    expect(list.status).toBe(200);
    expect(list.body.some((a: any) => a.id === up.body.id)).toBe(true);

    // No client session → 401. A session for customer A → 200 with the bytes.
    const anon = await fetch(`${BASE}/api/client/attachments/${up.body.id}/download`);
    expect(anon.status).toBe(401);

    const raw = await makeClientSession([custA]);
    const dl = await fetch(`${BASE}/api/client/attachments/${up.body.id}/download`, {
      headers: { cookie: `crm_client=${raw}` },
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF)).toBe(true);

    // …and it rides the documents payload.
    const docs = await api("/api/client/documents", {}, `crm_client=${raw}`);
    expect(docs.status).toBe(200);
    expect(docs.body.pamphlets.some((p: any) => p.id === up.body.id)).toBe(true);
    expect(docs.body.accounts.some((a: any) => a.id === custA)).toBe(true);

    const del = await api(`/api/crm/attachments/${up.body.id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
  });

  it("estimate attachments: contractor upload → public gated list + download", async () => {
    const up = await upload("/api/crm/attachments",
      { name: "scope.pdf", type: "application/pdf", data: PDF },
      { kind: "estimate", refId: estimateA }, cookie);
    expect(up.status).toBe(201);
    attachmentIds.push(up.body.id);

    // The public estimate page's attachment feed rides the same email gate.
    const anon = await api(`/api/public/estimates/${publicTokenA}/attachments`);
    expect(anon.status).toBe(401);
    expect(anon.body.requiresVerification).toBe(true);

    const raw = await makeClientSession([custA]);
    const cc = `crm_client=${raw}`;
    const list = await api(`/api/public/estimates/${publicTokenA}/attachments`, {}, cc);
    expect(list.status).toBe(200);
    expect(list.body.map((a: any) => a.id)).toContain(up.body.id);

    const dl = await fetch(`${BASE}/api/public/estimates/${publicTokenA}/attachments/${up.body.id}`, {
      headers: { cookie: cc },
    });
    expect(dl.status).toBe(200);

    // The portal documents payload carries attachments[] per estimate…
    const docs = await api("/api/client/documents", {}, cc);
    // …for SENT estimates only — this one is a draft, so attachments surface
    // on the public page (above) but the estimate itself stays internal.
    expect(docs.body.estimates.find((e: any) => e.id === estimateA)).toBeUndefined();
  });

  it("client photo upload: session-scoped, cross-customer writes rejected", async () => {
    const rawA = await makeClientSession([custA]);
    const ccA = `crm_client=${rawA}`;

    const up = await upload("/api/client/photos",
      { name: "roof.png", type: "image/png", data: PNG },
      { customerId: custA }, ccA);
    expect(up.status).toBe(201);
    attachmentIds.push(up.body.id);

    // Writing to someone else's customer id is a 403, not a silent re-scope.
    const intruder = await upload("/api/client/photos",
      { name: "nope.png", type: "image/png", data: PNG },
      { customerId: custB }, ccA);
    expect(intruder.status).toBe(403);

    // …and downloading B's photo with A's session is a 404 (checked below
    // from the other side: B uploads, A tries to read).
    const rawB = await makeClientSession([custB]);
    const upB = await upload("/api/client/photos",
      { name: "b-photo.png", type: "image/png", data: PNG },
      { customerId: custB }, `crm_client=${rawB}`);
    expect(upB.status).toBe(201);
    attachmentIds.push(upB.body.id);

    const steal = await fetch(`${BASE}/api/client/attachments/${upB.body.id}/download`, {
      headers: { cookie: ccA },
    });
    expect(steal.status).toBe(404);

    // The contractor sees both via the org-scoped list.
    const photos = await api(`/api/crm/attachments?kind=photo&refId=${custA}`, {}, cookie);
    expect(photos.status).toBe(200);
    expect(photos.body.some((p: any) => p.id === up.body.id)).toBe(true);

    // Non-photo files are rejected.
    const bad = await upload("/api/client/photos",
      { name: "doc.pdf", type: "application/pdf", data: PDF },
      { customerId: custA }, ccA);
    expect(bad.status).toBe(415);
  });

  it("client comments: insert → contractor list → mark read; cross-customer rejected", async () => {
    const rawA = await makeClientSession([custA]);
    const ccA = `crm_client=${rawA}`;

    const post = await api("/api/client/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: custA, body: "Is Tuesday still good for the crew?" }),
    }, ccA);
    expect(post.status).toBe(201);

    const intruder = await api("/api/client/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: custB, body: "intrusion" }),
    }, ccA);
    expect(intruder.status).toBe(403);

    const rows = await q<{ id: string; body: string; read_at: Date | null }>(
      `select id, body, read_at from crm_client_comments where customer_id = $1`, [custA]);
    expect(rows.length).toBe(1);
    expect(rows[0].body).toContain("Tuesday");
    expect(rows[0].read_at).toBeNull();

    const list = await api(`/api/crm/customers/${custA}/client-comments`, {}, cookie);
    expect(list.status).toBe(200);
    expect(list.body.some((c: any) => c.id === post.body.id && c.readAt === null)).toBe(true);

    const read = await api(`/api/crm/client-comments/${post.body.id}/read`, { method: "POST" }, cookie);
    expect(read.status).toBe(200);
    const after = await q<{ read_at: Date | null }>(
      `select read_at from crm_client_comments where id = $1`, [post.body.id]);
    expect(after[0].read_at).not.toBeNull();
  });
});
