/**
 * HOVER integration — OAuth connect, webhook handshake, HMAC enforcement,
 * token rotation and ingest mapping.
 *
 * Runs against the local dev server (DEV_AUTH_BYPASS_USER1=true) with a LOCAL
 * STUB standing in for hover.to — no live calls. The stub is a plain http
 * server; tmp/hover-stub.json points the dev server at it (non-production
 * override in server/crm/hover.ts).
 *
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 *
 * Fixtures are throwaway customers/measurements/attachments created through
 * the real flow and cleaned up afterwards; the org's custom_fields are
 * snapshotted and restored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { createHash, createHmac } from "crypto";
import pg from "pg";

// Must precede the dynamic import of ./hover (its module graph builds a
// Stripe client and a pg Pool at import time).
process.env.DATABASE_URL ??=
  "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
process.env.STRIPE_SECRET_KEY ??= "sk_test_vitest_stub";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const STUB_PORT = 8465;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const STUB_FILE = path.join(process.cwd(), "tmp", "hover-stub.json");
const RECEIVER_PATH = "/api/crm/integrations/hover/webhook";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts });
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, location: res.headers.get("location") };
}

// ── The HOVER stub ──────────────────────────────────────────────────────────

const PDF_BYTES = Buffer.from("%PDF-1.4 stub hover measurements pdf");

const FULL_JSON = {
  roof: { total_roof_area_sqft: 2874.5, predominant_pitch: "6/12", waste_percent: 12 },
  siding: { total_siding_area_sqft: 2210 },
  openings: { windows: 14 },
  property: { stories: 2 },
};

function stubJob(id: number, email: string | null) {
  return {
    id,
    name: `Stub HOVER job ${id}`,
    contact: email
      ? { name: "Harriet Homeowner", email, phone: "(206) 555-0142" }
      : {},
    location: { address_line_1: "123 Pine St", city: "Seattle", state: "WA", zip: "98101" },
    models: [
      {
        artifacts: [
          { type: "measurements_json", url: `${STUB}/artifacts/measurements.json` },
          { type: "measurement_pdf", url: `${STUB}/artifacts/measurements.pdf` },
          { type: "photo", url: `${STUB}/artifacts/photo1.jpg` },
        ],
      },
    ],
    // Only job 9001 carries the design URL — 9002 exercises the fallback.
    ...(id === 9001
      ? { machete_blob: { OptInFeature: { designProUrl: `https://hover.to/3d/${id}` } } }
      : {}),
  };
}

/** A job at an arbitrary address/contact — the address-matching fixtures. */
function stubJobAt(
  id: number,
  contact: { name?: string; email?: string; phone?: string } | null,
  location: { line1: string; city?: string; state?: string; zip: string },
) {
  return {
    id,
    name: `Stub HOVER job ${id}`,
    contact: contact ?? {},
    location: {
      address_line_1: location.line1,
      city: location.city ?? "Seattle",
      state: location.state ?? "WA",
      zip: location.zip,
    },
    models: [
      {
        artifacts: [
          { type: "measurements_json", url: `${STUB}/artifacts/measurements.json` },
          { type: "measurement_pdf", url: `${STUB}/artifacts/measurements.pdf` },
        ],
      },
    ],
  };
}

interface StubWebhook {
  id: number;
  url: string;
  hmac_secret: string;
  code: string;
  verified_at: string | null;
  registrations: number;
}

const stub = {
  server: null as http.Server | null,
  tokenRequests: [] as any[],
  refreshTokensSeen: [] as string[],
  webhooks: new Map<number, StubWebhook>(),
  deletedWebhooks: [] as number[],
  registrationBodies: [] as any[],
  verifiedCodes: [] as string[],
  extraJobs: new Map<number, any>(),
  nextWebhookId: 55501,
  currentRefreshToken: "rt-1",
  accessCounter: 0,
};

/** HOVER's signature: sha256=<webhookId>:<base64 hmac> over the canonical string. */
function sign(bodyRaw: string, webhookId: number, secret: string) {
  const date = new Date().toUTCString();
  const canonical = [
    "application/json",
    createHash("md5").update(bodyRaw).digest("base64"),
    RECEIVER_PATH,
    date,
  ].join(",");
  const sig = createHmac("sha256", secret).update(canonical).digest("base64");
  return {
    "content-type": "application/json",
    date,
    "hover-signature-256": `sha256=${webhookId}:${sig}`,
  };
}

/** HOVER posts the verification-code event right after registration. */
async function fireVerificationEvent(wh: StubWebhook) {
  const body = JSON.stringify({
    event: "webhook-verification-code",
    webhook_id: wh.id,
    code: wh.code,
  });
  await fetch(wh.url, { method: "POST", headers: sign(body, wh.id, wh.hmac_secret), body }).catch(() => {});
}

function startStub(): Promise<void> {
  stub.server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", STUB);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const json = (code: number, obj: any) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    // ── OAuth ────────────────────────────────────────────────────────────
    if (url.pathname === "/oauth/authorize") {
      const redirect = url.searchParams.get("redirect_uri")!;
      const sep = redirect.includes("?") ? "&" : "?";
      res.writeHead(302, {
        location: `${redirect}${sep}code=stub-auth-code&state=${encodeURIComponent(url.searchParams.get("state") || "")}`,
      });
      return res.end();
    }
    if (url.pathname === "/oauth/token") {
      const body = JSON.parse(raw || "{}");
      // The OAuth app credentials must ride in every token call — never
      // assert their VALUES (they are real secrets in .env), only presence.
      if (!body.client_id || !body.client_secret) return json(400, { error: "invalid_client" });
      stub.tokenRequests.push(body);
      if (body.grant_type === "authorization_code") {
        if (body.code !== "stub-auth-code") return json(400, { error: "invalid_grant" });
        if (!body.redirect_uri) return json(400, { error: "invalid_request" });
        stub.currentRefreshToken = "rt-1";
        return json(200, { access_token: "at-0", refresh_token: "rt-1", expires_in: 1, token_type: "Bearer" });
      }
      if (body.grant_type === "refresh_token") {
        stub.refreshTokensSeen.push(body.refresh_token);
        if (body.refresh_token !== stub.currentRefreshToken) {
          // A stale refresh token means rotation was not persisted.
          return json(400, { error: "invalid_grant" });
        }
        const next = `rt-${stub.refreshTokensSeen.length + 1}`;
        stub.currentRefreshToken = next;
        stub.accessCounter++;
        return json(200, { access_token: `at-${stub.accessCounter}`, refresh_token: next, expires_in: 1, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    // ── Webhooks ─────────────────────────────────────────────────────────
    if (url.pathname === "/api/v2/webhooks" && req.method === "GET") {
      return json(200, [...stub.webhooks.values()].map(({ code, registrations, ...w }) => w));
    }
    if (url.pathname === "/api/v2/webhooks" && req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      stub.registrationBodies.push(body);
      // The 422 the old worker hit: the body MUST be nested under "webhook".
      if (!body.webhook || typeof body.webhook.url !== "string") {
        return json(422, { error: "webhook.url is required" });
      }
      const sameUrl = [...stub.webhooks.values()].filter((w) => w.url === body.webhook.url);
      if (sameUrl.length >= 2) return json(422, { error: "url already registered twice" });
      const wh: StubWebhook = {
        id: stub.nextWebhookId++,
        url: body.webhook.url,
        hmac_secret: `secret-${stub.nextWebhookId}`,
        code: `code-${stub.nextWebhookId}`,
        verified_at: null,
        registrations: 1,
      };
      stub.webhooks.set(wh.id, wh);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...wh, code: undefined, registrations: undefined, content_type: body.webhook.content_type }));
      // HOVER posts the verification code immediately after registration.
      setImmediate(() => void fireVerificationEvent(wh));
      return;
    }
    const delMatch = /^\/api\/v2\/webhooks\/(\d+)$/.exec(url.pathname);
    if (delMatch && req.method === "DELETE") {
      const id = Number(delMatch[1]);
      stub.deletedWebhooks.push(id);
      stub.webhooks.delete(id);
      return json(200, { ok: true });
    }
    const verifyMatch = /^\/api\/v2\/webhooks\/([^/]+)\/verify$/.exec(url.pathname);
    if (verifyMatch && req.method === "PUT") {
      const code = verifyMatch[1];
      stub.verifiedCodes.push(code);
      const wh = [...stub.webhooks.values()].find((w) => w.code === code);
      if (!wh) return json(404, { error: "unknown code" });
      wh.verified_at = new Date().toISOString();
      return json(200, { ok: true });
    }

    // ── Jobs + artifacts ─────────────────────────────────────────────────
    if (url.pathname === "/api/v2/jobs") {
      return json(200, {
        results: [
          { id: 9001, state: "completed" },
          { id: 9002, state: "completed" },
          { id: 9003, state: "in_progress" },
          ...[...stub.extraJobs.keys()].map((id) => ({ id, state: "completed" })),
        ],
      });
    }
    const jobMatch = /^\/api\/v3\/jobs\/(\d+)$/.exec(url.pathname);
    if (jobMatch) {
      const id = Number(jobMatch[1]);
      if (stub.extraJobs.has(id)) return json(200, stub.extraJobs.get(id));
      if (id !== 9001 && id !== 9002) return json(404, { error: "no such job" });
      return json(200, stubJob(id, id === 9001 ? "hover-vitest@example.com" : null));
    }
    if (url.pathname === "/artifacts/measurements.json") {
      if (url.searchParams.get("version") !== "full_json") return json(200, { note: "summary variant" });
      return json(200, FULL_JSON);
    }
    if (url.pathname === "/artifacts/measurements.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PDF_BYTES);
    }
    if (url.pathname === "/artifacts/photo1.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(Buffer.from("ffd8ffe0 stub", "hex"));
    }

    json(404, { error: `stub: no route ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => stub.server!.listen(STUB_PORT, "127.0.0.1", resolve));
}

// ── The suite ───────────────────────────────────────────────────────────────

describe("HOVER integration (dev server + stub HOVER)", () => {
  let orgId: string;
  let savedCustomFields: any;
  let hover: typeof import("./hover");

  beforeAll(async () => {
    hover = await import("./hover");
    await startStub();
    fs.mkdirSync(path.dirname(STUB_FILE), { recursive: true });
    fs.writeFileSync(STUB_FILE, JSON.stringify({ oauthBase: STUB, apiBase: `${STUB}/api` }));

    const rows = await q<{ org_id: string }>(
      `select org_id from crm_members where user_id = 1 order by created_at asc limit 1`,
    );
    orgId = rows[0].org_id;
    const org = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    savedCustomFields = org[0]?.custom_fields ?? null;
    // Start from a clean slate: no leftover HOVER connection.
    await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'hover' where id = $1`, [orgId]);
  }, 30000);

  afterAll(async () => {
    // Restore the org and remove every row the flow created. (JS null must
    // become SQL NULL — JSON.stringify(null) would store a jsonb SCALAR and
    // break every later jsonb_set on the column.)
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`,
      [orgId, savedCustomFields === null ? null : JSON.stringify(savedCustomFields)]);
    await q(`delete from crm_attachments where org_id = $1 and kind = 'measurement' and file_name like 'hover-measurements-%'`, [orgId]);
    await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:%'`, [orgId]);
    await q(`delete from crm_customers where org_id = $1 and email in (
      'hover-vitest@example.com', 'addr-seed@example.com', 'twin1@example.com',
      'twin2@example.com', 'twin-new@example.com', 'fresh-face@example.com',
      'different-9004@example.com')`, [orgId]);
    try { fs.unlinkSync(STUB_FILE); } catch {}
    await new Promise((r) => stub.server?.close(r));
    await pool.end();
  });

  it("connect → callback stores an encrypted refresh token and registers the webhook (nested body)", async () => {
    const connect = await api("/api/crm/integrations/hover/connect");
    expect(connect.status).toBe(302);
    const authorize = new URL(connect.location!);
    expect(authorize.origin).toBe(STUB);
    expect(authorize.pathname).toBe("/oauth/authorize");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    const redirectUri = authorize.searchParams.get("redirect_uri")!;
    expect(redirectUri).toContain("/api/crm/integrations/hover/oauth/callback");
    const state = authorize.searchParams.get("state")!;

    // The contractor approves at HOVER; the stub 302s back with a code.
    const cb = await api(
      `/api/crm/integrations/hover/oauth/callback?code=stub-auth-code&state=${encodeURIComponent(state)}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.location).toBe("/crm/integrations?hover=connected");

    // Token exchange carried the app credentials + OUR redirect_uri.
    const exchange = stub.tokenRequests.find((t) => t.grant_type === "authorization_code");
    expect(exchange).toBeTruthy();
    expect(exchange.client_id).toBeTruthy();
    expect(exchange.client_secret).toBeTruthy();
    expect(exchange.redirect_uri).toBe(redirectUri);

    // The refresh token is at rest ONLY encrypted — never the raw value.
    const org = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    const conn = org[0].custom_fields.hover;
    expect(conn.refreshTokenEnc).toMatch(/^v1\./);
    expect(JSON.stringify(org[0].custom_fields)).not.toContain("rt-1");
    expect(conn.connectedAt).toBeTruthy();

    // Registration used the nested schema with content_type json.
    expect(stub.registrationBodies.length).toBe(1);
    expect(stub.registrationBodies[0]).toEqual({
      webhook: { url: `${BASE}${RECEIVER_PATH}`, content_type: "json" },
    });
  });

  it("verification handshake flips the webhook to verified", async () => {
    // The stub fired the verification-code event on registration; our receiver
    // PUTs the code back. Poll until the org state reflects it.
    let status: any = null;
    for (let i = 0; i < 30; i++) {
      status = (await api("/api/crm/integrations/hover/status")).body;
      if (status.webhook?.verified) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(status.webhook?.verified).toBe(true);
    expect(stub.verifiedCodes.length).toBeGreaterThan(0);
    expect(stub.webhooks.size).toBe(1);
  });

  it("rejects unsigned and mis-signed webhook traffic with 401", async () => {
    const body = JSON.stringify({ event: "job-state-changed-v2", state: "completed", job_id: 9001 });
    const noSig = await api(RECEIVER_PATH, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    expect(noSig.status).toBe(401);

    const wh = [...stub.webhooks.values()][0];
    const badHeaders = {
      "content-type": "application/json",
      date: new Date().toUTCString(),
      "hover-signature-256": `sha256=${wh.id}:${Buffer.from("forged").toString("base64")}`,
    };
    const badSig = await api(RECEIVER_PATH, { method: "POST", headers: badHeaders, body });
    expect(badSig.status).toBe(401);

    // A well-formed signature for a webhook id we never registered: 401 too.
    const alien = sign(body, 999999, "secret-alien");
    const unknown = await api(RECEIVER_PATH, { method: "POST", headers: alien, body });
    expect(unknown.status).toBe(401);
  });

  it("completed event → customer + measurement + gated PDF, mapped from the v3 fixture", async () => {
    const wh = [...stub.webhooks.values()][0];
    const body = JSON.stringify({ event: "job-state-changed-v2", state: "completed", job_id: 9001 });
    const res = await api(RECEIVER_PATH, { method: "POST", headers: sign(body, wh.id, wh.hmac_secret), body });
    expect(res.status).toBe(200);

    const custs = await q<any>(`select * from crm_customers where org_id = $1 and email = 'hover-vitest@example.com'`, [orgId]);
    expect(custs.length).toBe(1);
    const cust = custs[0];
    expect(cust.display_name).toBe("Harriet Homeowner");
    expect(cust.phone).toBe("(206) 555-0142");
    // The job address is the SERVICE address.
    expect(cust.address_line1).toBe("123 Pine St");
    expect(cust.city).toBe("Seattle");

    const rows = await q<any>(
      `select * from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgId]);
    expect(rows.length).toBe(1);
    const m = rows[0];
    expect(m.provider).toBe("hover");
    expect(m.status).toBe("ready");
    expect(m.customer_id).toBe(cust.id);
    expect(m.squares_milli).toBe(28745);        // 2874.5 sq ft → 28.745 squares
    expect(m.roof_area_sf_milli).toBe(2874500);
    expect(m.wall_area_sf_milli).toBe(2210000); // siding
    expect(m.predominant_pitch).toBe("6/12");
    expect(m.stories).toBe(2);
    expect(m.waste_suggestion_bps).toBe(1200);  // 12%
    const raw = m.raw_payload as any;
    expect(raw.hoverJobId).toBe("9001");
    expect(raw.model3dUrl).toBe("https://hover.to/3d/9001");
    expect(raw.summary.windowsCount).toBe(14);
    expect(raw.fullJson.roof.total_roof_area_sqft).toBe(2874.5);
    expect(raw.pdfAttachmentId).toBeTruthy();

    // The measurement PDF is a gated attachment (kind "measurement").
    const atts = await q<any>(`select * from crm_attachments where id = $1`, [raw.pdfAttachmentId]);
    expect(atts.length).toBe(1);
    expect(atts[0].kind).toBe("measurement");
    expect(atts[0].ref_id).toBe(cust.id);
    const dl = await fetch(`${BASE}/api/crm/attachments/${atts[0].id}/file`);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF_BYTES)).toBe(true);
  });

  it("is idempotent on job_id — a redelivered event creates nothing", async () => {
    const wh = [...stub.webhooks.values()][0];
    const body = JSON.stringify({ event: "job-state-changed-v2", state: "completed", job_id: 9001 });
    const res = await api(RECEIVER_PATH, { method: "POST", headers: sign(body, wh.id, wh.hmac_secret), body });
    expect(res.status).toBe(200);

    const rows = await q<any>(
      `select id from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgId]);
    expect(rows.length).toBe(1);
    const custs = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'hover-vitest@example.com'`, [orgId]);
    expect(custs.length).toBe(1);
  });

  it("rotates the refresh token on every refresh and persists the new one", async () => {
    // expires_in: 1 from the stub forces a refresh on every access-token call,
    // so by now the server has refreshed several times: handshake (rt-1),
    // each ingest, etc. The stub 400s any STALE token — so an unbroken chain
    // proves each rotated token was persisted before its next use.
    expect(stub.refreshTokensSeen.length).toBeGreaterThanOrEqual(2);
    stub.refreshTokensSeen.forEach((t, i) => expect(t).toBe(`rt-${i + 1}`));
  });

  it("sync-now pulls completed jobs (skipping known + unfinished) and reports the attach path", async () => {
    const res = await api("/api/crm/integrations/hover/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.scanned).toBe(3);
    expect(res.body.duplicates).toBe(1);        // 9001 already ingested
    // 9002 has no contact at all, but its service address is 123 Pine St
    // 98101 — exactly the customer 9001 created — so it attaches BY ADDRESS.
    expect(res.body.attachedByAddress).toBe(1);
    expect(res.body.attachedByEmail).toBe(0);
    expect(res.body.attachedByPhone).toBe(0);
    expect(res.body.created).toBe(0);
    expect(res.body.ambiguous).toBe(0);
    expect(res.body.errors).toEqual([]);

    const rows = await q<any>(
      `select * from crm_measurements where org_id = $1 and external_id = 'hover:9002'`, [orgId]);
    expect(rows.length).toBe(1);
    const custs = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'hover-vitest@example.com'`, [orgId]);
    expect(rows[0].customer_id).toBe(custs[0].id);
    expect((rows[0].raw_payload as any).matchedVia).toBe("address");
    // The 3D URL fell back to the deterministic hover.to/3d/<jobId> form.
    expect((rows[0].raw_payload as any).model3dUrl).toBe("https://hover.to/3d/9002");

    const status = (await api("/api/crm/integrations/hover/status")).body;
    expect(status.lastSyncAt).toBeTruthy();
    // The report is persisted for the settings card.
    expect(status.lastSyncReport?.attachedByAddress).toBe(1);
    expect(status.lastSyncReport?.scanned).toBe(3);
    expect(status.lastSyncReport?.at).toBeTruthy();
  });

  // ── Address matching (confidence rules) ─────────────────────────────────

  const seedCustomer = async (email: string, line1: string, zip: string) => {
    const rows = await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, email, address_line1, city, state, postal_code, portal_token)
       values ($1, $2, $3, $4, 'Seattle', 'WA', $5, md5(random()::text)) returning id`,
      [orgId, `Seeded ${email}`, email, line1, zip],
    );
    return rows[0].id;
  };

  /** Fire a signed job-state-changed-v2 (completed) event at the receiver. */
  const fireCompleted = async (jobId: number) => {
    const wh = [...stub.webhooks.values()][0];
    const body = JSON.stringify({ event: "job-state-changed-v2", state: "completed", job_id: jobId });
    const res = await api(RECEIVER_PATH, { method: "POST", headers: sign(body, wh.id, wh.hmac_secret), body });
    expect(res.status).toBe(200);
  };

  it("exact address match: a different-email job attaches to the existing customer", async () => {
    const custId = await seedCustomer("addr-seed@example.com", "77 BIRCH rd.", "98102-4455");
    stub.extraJobs.set(9004, stubJobAt(9004,
      { name: "Different Person", email: "different-9004@example.com", phone: "(425) 555-0100" },
      { line1: "77 Birch Rd", zip: "98102" }));
    await fireCompleted(9004);

    const m = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9004'`, [orgId]);
    expect(m.length).toBe(1);
    expect(m[0].customer_id).toBe(custId);
    expect((m[0].raw_payload as any).matchedVia).toBe("address");
    // The matched customer was never clobbered, and no duplicate was created.
    const strangers = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'different-9004@example.com'`, [orgId]);
    expect(strangers.length).toBe(0);
    const seeded = await q<any>(`select email, address_line1 from crm_customers where id = $1`, [custId]);
    expect(seeded[0].email).toBe("addr-seed@example.com");
  });

  it("ambiguous address (2+ customers): creates a NEW flagged customer, never guesses", async () => {
    await seedCustomer("twin1@example.com", "9 Twin Ct", "98103");
    await seedCustomer("twin2@example.com", "9 twin ct", "98103");
    stub.extraJobs.set(9005, stubJobAt(9005,
      { name: "Twin Newcomer", email: "twin-new@example.com" },
      { line1: "9 Twin Ct", zip: "98103" }));
    await fireCompleted(9005);

    const created = await q<any>(
      `select * from crm_customers where org_id = $1 and email = 'twin-new@example.com'`, [orgId]);
    expect(created.length).toBe(1);
    expect((created[0].custom_fields as any)?.hoverAmbiguous).toBe(true);
    // The measurement points at the flagged NEW customer, not either twin.
    const m = await q<any>(
      `select customer_id, raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:9005'`, [orgId]);
    expect(m.length).toBe(1);
    expect(m[0].customer_id).toBe(created[0].id);
    expect((m[0].raw_payload as any).matchedVia).toBeNull();
    expect((m[0].raw_payload as any).hoverAmbiguous).toBe(true);
  });

  it("no address match: creates the customer from the job (unchanged behavior)", async () => {
    stub.extraJobs.set(9006, stubJobAt(9006,
      { name: "Fresh Face", email: "fresh-face@example.com" },
      { line1: "500 Nowhere Blvd", zip: "98501" }));
    await fireCompleted(9006);

    const created = await q<any>(
      `select id, custom_fields from crm_customers where org_id = $1 and email = 'fresh-face@example.com'`, [orgId]);
    expect(created.length).toBe(1);
    expect((created[0].custom_fields as any)?.hoverAmbiguous).toBeUndefined();
    const m = await q<any>(
      `select customer_id, raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:9006'`, [orgId]);
    expect(m.length).toBe(1);
    expect(m[0].customer_id).toBe(created[0].id);
    expect((m[0].raw_payload as any).matchedVia).toBeNull();
  });

  it("re-sync is idempotent with address matching on: everything is a duplicate", async () => {
    const before = await q<{ n: string }>(
      `select count(*)::text as n from crm_customers where org_id = $1`, [orgId]);
    const res = await api("/api/crm/integrations/hover/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(6);           // 9001–9006 (9003 in_progress)
    expect(res.body.duplicates).toBe(5);
    expect(res.body.attachedByEmail).toBe(0);
    expect(res.body.attachedByPhone).toBe(0);
    expect(res.body.attachedByAddress).toBe(0);
    expect(res.body.created).toBe(0);
    expect(res.body.ambiguous).toBe(0);
    expect(res.body.errors).toEqual([]);
    const after = await q<{ n: string }>(
      `select count(*)::text as n from crm_customers where org_id = $1`, [orgId]);
    expect(after[0].n).toBe(before[0].n);
    // …and the persisted report mirrors the response.
    const org = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    const report = org[0].custom_fields.hover.lastSyncReport;
    expect(report.duplicates).toBe(5);
    expect(report.attachedByAddress).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("unit: address normalization is case/punctuation/zip+4-insensitive", () => {
    const n = hover.normalizeHoverAddress;
    expect(n("123 Pine St", "98101")).toBe("123 pine st|98101");
    expect(n("123 PINE st.", "98101-1234")).toBe("123 pine st|98101");
    expect(n("  123   Pine   St  ", "98101")).toBe("123 pine st|98101");
    // Same address, different formatting → the same key on both sides.
    expect(n("77 BIRCH rd.", "98102-4455")).toBe(n("77 Birch Rd", "98102"));
    // Too thin to trust → null (never matches).
    expect(n(null, "98101")).toBeNull();
    expect(n("123 Pine St", null)).toBeNull();
    expect(n("123 Pine St", "9810")).toBeNull();
    expect(n("", "98101")).toBeNull();
  });

  it("disconnect deletes the HOVER webhook and wipes the stored tokens", async () => {
    const res = await api("/api/crm/integrations/hover/disconnect", { method: "POST" });
    expect(res.status).toBe(200);
    expect(stub.deletedWebhooks.length).toBe(1);
    expect(stub.webhooks.size).toBe(0);

    const status = (await api("/api/crm/integrations/hover/status")).body;
    expect(status.connected).toBe(false);
    expect(status.webhook).toBeNull();
    const org = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    expect(org[0].custom_fields?.hover).toBeUndefined();
  });

  // ── Pure units (no server involved) ───────────────────────────────────────

  it("unit: secret box round-trips and rejects tampering", () => {
    const enc = hover.encryptHoverSecret("rt-super-secret");
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain("rt-super-secret");
    expect(hover.decryptHoverSecret(enc)).toBe("rt-super-secret");
    const [v, iv, tag, ct] = enc.split(".");
    const tampered = [v, iv, tag, ct.slice(0, -4) + "AAAA"].join(".");
    expect(hover.decryptHoverSecret(tampered)).toBeNull();
    expect(hover.decryptHoverSecret("garbage")).toBeNull();
  });

  it("unit: signature verify accepts sha256/sha1 and rejects wrong secrets", () => {
    const body = Buffer.from(JSON.stringify({ event: "x" }));
    const date = "Tue, 06 Aug 2024 23:15:50 GMT";
    const canonical = hover.hoverCanonicalString("application/json", body, RECEIVER_PATH, date);
    expect(canonical.startsWith("application/json,")).toBe(true);
    const secret = "s3cr3t";
    const sig256 = `sha256=42:${createHmac("sha256", secret).update(canonical).digest("base64")}`;
    const sig1 = `sha1=42:${createHmac("sha1", secret).update(canonical).digest("base64")}`;
    const base = {
      contentType: "application/json", rawBody: body, path: RECEIVER_PATH, date, webhookId: "42",
    };
    expect(hover.verifyHoverSignature({ ...base, signature256: sig256, signatureSha1: null, hmacSecret: secret })).toBe(true);
    expect(hover.verifyHoverSignature({ ...base, signature256: null, signatureSha1: sig1, hmacSecret: secret })).toBe(true);
    expect(hover.verifyHoverSignature({ ...base, signature256: sig256, signatureSha1: null, hmacSecret: "wrong" })).toBe(false);
    // A signature over a DIFFERENT path must not verify.
    expect(hover.verifyHoverSignature({ ...base, path: "/api/other", signature256: sig256, signatureSha1: null, hmacSecret: secret })).toBe(false);
    expect(hover.hoverWebhookIdFromHeaders(sig256, null)).toBe("42");
    expect(hover.hoverWebhookIdFromHeaders(null, sig1)).toBe("42");
    expect(hover.hoverWebhookIdFromHeaders(null, null)).toBeNull();
  });

  it("unit: OAuth state grant round-trips and rejects tampering", () => {
    const org = "1e3050c1-3cfd-4d9b-ba5a-1c19ce074897";
    const state = hover.mintHoverState(org);
    expect(hover.verifyHoverState(state)).toBe(org);
    const sigChar = state[state.length - 20];
    expect(hover.verifyHoverState(state.slice(0, -20) + (sigChar === "a" ? "b" : "a") + state.slice(-19))).toBeNull();
    expect(hover.verifyHoverState("not-a-state")).toBeNull();
  });

  it("unit: measurement summary maps the full_json fixture", () => {
    const s = hover.summarizeHoverMeasurements(FULL_JSON);
    expect(s).toEqual({
      roofSqft: 2874.5,
      sidingSqft: 2210,
      windowsCount: 14,
      stories: 2,
      pitch: "6/12",
      wasteBps: 1200,
    });
    expect(hover.summarizeHoverMeasurements(null)).toEqual({
      roofSqft: null, sidingSqft: null, windowsCount: null, stories: null, pitch: null, wasteBps: null,
    });
  });
});
