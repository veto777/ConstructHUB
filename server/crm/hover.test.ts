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
const STUB_PORT = Number(process.env.TEST_HOVER_PORT);
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
const PREMIUM_PDF = Buffer.from("%PDF-1.7 stub hover PRO PREMIUM measurements pdf");
const STORAGE_PDF = Buffer.from("%PDF-1.7 stub hover measurements pdf from storage");
/** A REAL HOVER full_json (version 2), anonymised (address, ids, image ids replaced). */
const V2_FULL_JSON = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", "hover-full-json-v2.anon.json"), "utf8"));
/** A second origin standing in for HOVER's file storage (the PDF redirect target) — it rejects a bearer, like S3. */
const STORAGE_PORT = STUB_PORT + 3;
const STORAGE = `http://127.0.0.1:${STORAGE_PORT}`;

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

/** A v3 job carrying real-shaped models[]: a FAILED model first, then the completed one whose deliverables we read. */
function stubJobV2(
  id: number, modelId: number,
  contact: { name?: string; email?: string; phone?: string } | null,
  location: { line1: string; city?: string; state?: string; zip: string },
) {
  const m = (mid: number) => `${STUB}/api/v3/models/${mid}/artifacts`;
  return {
    id,
    name: `Takeoff job ${id}`,
    contact: contact ?? {},
    address: { location_line_1: location.line1, city: location.city ?? "Testville", region: location.state ?? "WA", postal_code: location.zip },
    models: [
      { id: modelId - 1000, state: "failed", artifacts: { measurements: { pdf: `${m(modelId - 1000)}/measurements.pdf` } } },
      {
        id: modelId, state: "completed",
        artifacts: { measurements: { pdf: `${m(modelId)}/measurements.pdf`, full_json: `${m(modelId)}/measurements.json?version=full_json` } },
      },
    ],
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

/** A job whose models carry importable capture images (m.images — the shape
 *  importHoverJobPhotos reads). */
function stubJobWithImages(
  id: number,
  contact: { name?: string; email?: string; phone?: string } | null,
  location: { line1: string; city?: string; state?: string; zip: string },
  imageIds: string[],
) {
  const job: any = stubJobAt(id, contact, location);
  job.models[0].images = imageIds.map((imgId) => ({
    id: imgId,
    image: { url: `${STUB}/artifacts/photo1.jpg` },
  }));
  return job;
}

interface StubWebhook {  id: number;
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
  /** HOVER job shares (GET /api/v1/job_shares?current_user_id=601). */
  jobShares: [] as any[],
  failPhotos: false,
  /** full_json answers 503 while true (the transient-failure retry test). */
  failFullJson: false,
  /** Every request the stub served (the back-fill must not add any). */
  requests: 0,
  premiumHits: [] as { modelId: string; auth: boolean }[],
  storage: null as http.Server | null,
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
    stub.requests++;
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
    // ── Users + job shares (the homeowner 3D links) ─────────────────────
    if (url.pathname === "/api/v2/users") {
      return json(200, { pagination: { total_pages: 1 }, results: [{ id: 601, email: "owner@example.com" }] });
    }
    if (url.pathname === "/api/v1/job_shares") {
      if (url.searchParams.get("current_user_id") !== "601") return json(200, { job_shares: [] });
      return json(200, { job_shares: stub.jobShares, meta: { pagination: { next_page: null } } });
    }
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
    if (url.pathname === "/artifacts/photo-flaky.jpg") {
      // Toggled by the stamp-on-failure test: 500 until the "retry".
      if (stub.failPhotos) return json(500, { error: "flaky photo fetch" });
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(Buffer.from("ffd8ffe0 stub", "hex"));
    }

    // ── Model deliverables (full_json v2, the premium PDF, the documented PDF → storage redirect) ──
    if (/^\/api\/v3\/models\/\d+\/artifacts\/measurements\.json$/.test(url.pathname)) {
      if (stub.failFullJson) return json(503, { error: "temporarily unavailable" });
      if (url.searchParams.get("version") !== "full_json") return json(200, { note: "summary variant" });
      return json(200, V2_FULL_JSON);
    }
    const prem = /^\/api\/v1\/models\/(\d+)\/pro_premium_measurements$/.exec(url.pathname);
    if (prem) {
      stub.premiumHits.push({ modelId: prem[1], auth: !!req.headers.authorization });
      if (!req.headers.authorization) return json(401, { error: "unauthorized" });
      if (prem[1] === "77002") return json(404, { error: "no premium report for this model" });
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PREMIUM_PDF);
    }
    const docPdf = /^\/api\/v3\/models\/(\d+)\/artifacts\/measurements\.pdf$/.exec(url.pathname);
    if (docPdf) {
      res.writeHead(302, { location: `${STORAGE}/files/${docPdf[1]}.pdf?X-Amz-Signature=stub` });
      return res.end();
    }

    json(404, { error: `stub: no route ${req.method} ${url.pathname}` });
  });
  stub.storage = http.createServer((req, res) => {
    stub.requests++;
    if (req.headers.authorization) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Only one auth mechanism allowed" }));
    }
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(STORAGE_PDF);
  });
  return new Promise((resolve) => stub.server!.listen(STUB_PORT, "127.0.0.1", () => {
    stub.storage!.listen(STORAGE_PORT, "127.0.0.1", resolve);
  }));
}

// ── The suite ───────────────────────────────────────────────────────────────

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("HOVER integration (dev server + auxiliary stub HOVER)", () => {
  let orgId: string;
  let savedCustomFields: any;
  let hover: typeof import("./hover");
  let orgBId: string | null = null;

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
    await q(`delete from crm_attachments where org_id = $1 and kind = 'photo' and file_name like 'hover-%'`, [orgId]);
    await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:%'`, [orgId]);
    await q(`delete from crm_customers where org_id = $1 and email in (
      'hover-vitest@example.com', 'addr-seed@example.com', 'twin1@example.com',
      'twin2@example.com', 'twin-new@example.com', 'fresh-face@example.com',
      'different-9004@example.com', 'noname-9010@example.com', 'conc-9011@example.com',
      'flaky-9012@example.com', 'adopt-9015@example.com')`, [orgId]);
    // Auto-created HOVER projects (takeoff tests) go before their customers.
    await q(`update crm_measurements set project_id = null where org_id = $1 and external_id like 'hover:%'`, [orgId]);
    await q(`delete from crm_projects where org_id = $1 and custom_fields ->> 'hoverAutoCreated' = 'true'`, [orgId]);
    await q(`delete from crm_projects where org_id = $1 and customer_id in (select id from crm_customers where org_id = $1 and email = 'takeoff-9100@example.com')`, [orgId]);
    await q(`delete from crm_customers where org_id = $1 and email = 'takeoff-9100@example.com'`, [orgId]);
    // Staff-scrubbed customers carry no email — sweep by the flow's marker.
    await q(`delete from crm_customers where org_id = $1 and custom_fields ->> 'hoverAutoCreated' = 'true'`, [orgId]);
    await q(`delete from crm_members where org_id = $1 and email = 'staff-scrub@example.com'`, [orgId]);
    if (orgBId) {
      await q(`delete from crm_attachments where org_id = $1`, [orgBId]);
      await q(`delete from crm_measurements where org_id = $1`, [orgBId]);
      await q(`delete from crm_customers where org_id = $1`, [orgBId]);
      await q(`delete from crm_orgs where id = $1`, [orgBId]);
    }
    try { fs.unlinkSync(STUB_FILE); } catch {}
    await new Promise((r) => stub.server?.close(r));
    await new Promise((r) => stub.storage?.close(r));
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
      webhook: { url: `${BASE}${RECEIVER_PATH}?k=${hover.mintHoverWebhookKey(orgId)}`, content_type: "json" },
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

    // HOVER sends events UNSIGNED unless the integration enrolled in signing:
    // the per-org ?k= key on the registered URL is what admits them.
    const other = JSON.stringify({ event: "job-photo-uploaded", job_id: 9001 });
    const k = hover.mintHoverWebhookKey(orgId);
    const keyed = await api(`${RECEIVER_PATH}?k=${k}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: other,
    });
    expect(keyed.status).toBe(200);
    const badKey = await api(`${RECEIVER_PATH}?k=${k.slice(0, -1)}${k.endsWith("a") ? "b" : "a"}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: other,
    });
    expect(badKey.status).toBe(401);
    // A valid key never excuses a forged signature.
    const keyedForged = await api(`${RECEIVER_PATH}?k=${k}`, { method: "POST", headers: badHeaders, body: other });
    expect(keyedForged.status).toBe(401);
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
    expect(res.body.attachedByName).toBe(0);
    expect(res.body.created).toBe(0);
    expect(res.body.ambiguous).toBe(0);
    expect(res.body.errors).toEqual([]);
    // The stub's list omits pagination.total_pages; 3 jobs is a short page,
    // so the walk stops after page 1 without claiming truncation.
    expect(res.body.truncated).toBe(false);

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

  // ── Homeowner 3D share links ────────────────────────────────────────────

  it("sync picks up the HOVER share for a job; the contractor can paste (strictly validated) and clear one", async () => {
    const m9001 = (await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgId]))[0];
    const m9002 = (await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9002'`, [orgId]))[0];
    stub.jobShares = [{
      id: 777, job_id: 9002, user_id: 601, token: "stubShareTok9002", expired: false,
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      url: "https://hover.to/shared/stubShareTok9002",
      image_url: "https://hover.to/api/v1/job_shares/777/image.png?share_token=stubShareTok9002",
    }];
    const sync = await api("/api/crm/integrations/hover/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    expect(sync.body.sharesFound).toBe(1);
    const after = (await q<any>(`select raw_payload from crm_measurements where id = $1`, [m9002.id]))[0];
    expect(after.raw_payload.share.url).toBe("https://hover.to/shared/stubShareTok9002");
    expect(after.raw_payload.share.source).toBe("hover-api");

    // Paste: only https://hover.to/shared/<token>.
    const put = (url: unknown) => api(`/api/crm/measurements/${m9001.id}/hover-share`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    for (const bad of ["https://hover.to/3d/9001", "https://evil.com/shared/abcdefghij", "http://hover.to/shared/abcdefghij",
      "https://hover.to/shared/abcdefghij?redirect=https://evil.com", "not a url", 42]) {
      expect((await put(bad)).status).toBe(400);
    }
    const ok = await put("https://hover.to/shared/pastedToken9001");
    expect(ok.status).toBe(200);
    expect(ok.body.share.source).toBe("manual");
    let list = (await api(`/api/crm/customers/${m9001.customer_id}/measurements`)).body.measurements;
    expect(list.find((x: any) => x.id === m9001.id).share).toMatchObject({ url: "https://hover.to/shared/pastedToken9001", live: true });

    // A sync that lists nothing for 9001 keeps the pasted link.
    await api("/api/crm/integrations/hover/sync", { method: "POST" });
    list = (await api(`/api/crm/customers/${m9001.customer_id}/measurements`)).body.measurements;
    expect(list.find((x: any) => x.id === m9001.id).share?.url).toBe("https://hover.to/shared/pastedToken9001");

    const del = await api(`/api/crm/measurements/${m9001.id}/hover-share`, { method: "DELETE" });
    expect(del.status).toBe(200);
    list = (await api(`/api/crm/customers/${m9001.customer_id}/measurements`)).body.measurements;
    expect(list.find((x: any) => x.id === m9001.id).share).toBeNull();
    // Unknown measurement → 404, never a write elsewhere.
    expect((await api(`/api/crm/measurements/00000000-0000-0000-0000-000000000000/hover-share`, { method: "DELETE" })).status).toBe(404);
    stub.jobShares = [];
  });

  it("estimate + project 3D routes list the client's HOVER captures with the contractor-only HOVER link", async () => {
    const cust = (await q<any>(`select id from crm_customers where org_id = $1 and email = 'hover-vitest@example.com'`, [orgId]))[0];
    const [proj] = await q<any>(
      `insert into crm_projects (org_id, customer_id, name, status, address_line1, postal_code) values ($1,$2,'HOVER vitest project','lead','123 Pine St','98101') returning id`,
      [orgId, cust.id]);
    const [est] = await q<any>(
      `insert into crm_estimates (org_id, customer_id, project_id, title, public_token) values ($1,$2,$3,'HOVER vitest estimate', md5(random()::text)) returning id`,
      [orgId, cust.id, proj.id]);
    try {
      const byProject = await api(`/api/crm/projects/${proj.id}/hover-models`);
      expect(byProject.status).toBe(200);
      expect(byProject.body.models.length).toBeGreaterThanOrEqual(2);
      const top = byProject.body.models[0];
      expect(top.hoverAppUrl).toMatch(/^https:\/\/hover\.to\/3d\/\d+$/);
      const byEstimate = await api(`/api/crm/estimates/${est.id}/hover-models`);
      expect(byEstimate.status).toBe(200);
      expect(byEstimate.body.models.map((m: any) => m.id)).toEqual(byProject.body.models.map((m: any) => m.id));
    } finally {
      await q(`delete from crm_estimates where id = $1`, [est.id]);
      await q(`update crm_measurements set project_id = null where project_id = $1`, [proj.id]);
      await q(`delete from crm_projects where id = $1`, [proj.id]);
    }
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

  // ── Defect regressions: photos, stamps, staff scrub, adoption ────────────

  it("display name falls back to the job label when the contact has no name", async () => {
    stub.extraJobs.set(9010, stubJobAt(9010,
      { email: "noname-9010@example.com" },
      { line1: "10 Label Way", zip: "98120" }));
    await fireCompleted(9010);

    const custs = await q<any>(
      `select * from crm_customers where org_id = $1 and email = 'noname-9010@example.com'`, [orgId]);
    expect(custs.length).toBe(1);
    expect(custs[0].display_name).toBe("Stub HOVER job 9010");
    expect(custs[0].first_name).toBeNull();
  });

  it("concurrent double-delivery of the same job ingests once (one measurement, customer, photo set)", async () => {
    stub.extraJobs.set(9011, stubJobWithImages(9011,
      { name: "Conc Urrent", email: "conc-9011@example.com" },
      { line1: "11 Race Way", zip: "98124" }, ["c1", "c2"]));
    // Two webhook deliveries in flight at the same moment — the per-job
    // ingest lock must serialize them.
    await Promise.all([fireCompleted(9011), fireCompleted(9011)]);

    const m = await q<any>(
      `select id from crm_measurements where org_id = $1 and external_id = 'hover:9011'`, [orgId]);
    expect(m.length).toBe(1);
    const custs = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'conc-9011@example.com'`, [orgId]);
    expect(custs.length).toBe(1);
    const atts = await q<any>(
      `select file_name from crm_attachments where org_id = $1 and kind = 'photo' and file_name like 'hover-9011-%'`, [orgId]);
    expect(atts.length).toBe(2);
  });

  it("photo import is idempotent — a redelivery adds no duplicate attachment rows", async () => {
    await fireCompleted(9011);
    const atts = await q<any>(
      `select file_name from crm_attachments where org_id = $1 and kind = 'photo' and file_name like 'hover-9011-%'`, [orgId]);
    expect(atts.length).toBe(2);
    const m = await q<any>(
      `select id from crm_measurements where org_id = $1 and external_id = 'hover:9011'`, [orgId]);
    expect(m.length).toBe(1);
  });

  it("photosSyncedAt is NOT stamped on a failed photo fetch; a succeeding retry stamps it", async () => {
    const flaky = stubJobWithImages(9012,
      { name: "Flaky Fetch", email: "flaky-9012@example.com" },
      { line1: "12 Flaky Ct", zip: "98125" }, ["fl1"]);
    flaky.models[0].images[0].image.url = `${STUB}/artifacts/photo-flaky.jpg`;
    stub.extraJobs.set(9012, flaky);

    stub.failPhotos = true;
    await fireCompleted(9012);
    let m = await q<any>(
      `select raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:9012'`, [orgId]);
    expect(m.length).toBe(1);
    expect((m[0].raw_payload as any).photosSyncedAt).toBeUndefined();
    let atts = await q<any>(
      `select id from crm_attachments where org_id = $1 and kind = 'photo' and file_name like 'hover-9012-%'`, [orgId]);
    expect(atts.length).toBe(0);

    stub.failPhotos = false;
    await fireCompleted(9012);
    m = await q<any>(
      `select raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:9012'`, [orgId]);
    expect((m[0].raw_payload as any).photosSyncedAt).toBeTruthy();
    atts = await q<any>(
      `select id from crm_attachments where org_id = $1 and kind = 'photo' and file_name like 'hover-9012-%'`, [orgId]);
    expect(atts.length).toBe(1);
  });

  it("staff-ordered capture: the created customer carries NONE of the staff contact", async () => {
    await q(
      `insert into crm_members (org_id, email, role, status, display_name, phone)
       values ($1, 'staff-scrub@example.com', 'field', 'active', 'Scott Staff', '(206) 555-7777')`, [orgId]);
    stub.extraJobs.set(9013, stubJobAt(9013,
      { name: "Scott Staff", email: "staff-scrub@example.com", phone: "(206) 555-7777" },
      { line1: "13 Staff Ln", zip: "98121" }));
    await fireCompleted(9013);

    const custs = await q<any>(
      `select * from crm_customers where org_id = $1 and address_line1 = '13 Staff Ln'`, [orgId]);
    expect(custs.length).toBe(1);
    expect(custs[0].email).toBeNull();
    expect(custs[0].phone).toBeNull();
    expect(custs[0].display_name).toBe("Stub HOVER job 9013"); // job label fallback
    expect((custs[0].custom_fields as any)?.hoverNeedsContact).toBe(true);
    expect(custs[0].notes).toContain("your own team");
  });

  it("mixed contact (staff email + homeowner phone): only the staff field is scrubbed", async () => {
    stub.extraJobs.set(9014, stubJobAt(9014,
      { name: "Scott Staff", email: "staff-scrub@example.com", phone: "(425) 555-9999" },
      { line1: "14 Mixed Ave", zip: "98122" }));
    await fireCompleted(9014);

    const custs = await q<any>(
      `select * from crm_customers where org_id = $1 and address_line1 = '14 Mixed Ave'`, [orgId]);
    expect(custs.length).toBe(1);
    expect(custs[0].email).toBeNull();                    // staff email scrubbed
    expect(custs[0].phone).toBe("(425) 555-9999");        // homeowner phone kept
    expect((custs[0].custom_fields as any)?.hoverNeedsContact).toBe(true);
  });

  it("adoption: an unlinked measurement links to the customer on redelivery", async () => {
    // First delivery: no contact, no address, no job label — nothing to
    // match or create from, so the measurement lands with customerId null.
    stub.extraJobs.set(9015, {
      id: 9015,
      models: [{
        artifacts: [
          { type: "measurements_json", url: `${STUB}/artifacts/measurements.json` },
          { type: "measurement_pdf", url: `${STUB}/artifacts/measurements.pdf` },
        ],
      }],
    });
    await fireCompleted(9015);
    let m = await q<any>(
      `select customer_id from crm_measurements where org_id = $1 and external_id = 'hover:9015'`, [orgId]);
    expect(m.length).toBe(1);
    expect(m[0].customer_id).toBeNull();

    // HOVER backfills the contact; the redelivered event adopts it.
    stub.extraJobs.set(9015, stubJobAt(9015,
      { name: "Adam Adoptee", email: "adopt-9015@example.com" },
      { line1: "15 Adopt Pl", zip: "98123" }));
    await fireCompleted(9015);

    const custs = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'adopt-9015@example.com'`, [orgId]);
    expect(custs.length).toBe(1);
    m = await q<any>(
      `select customer_id, raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:9015'`, [orgId]);
    expect(m.length).toBe(1);
    expect(m[0].customer_id).toBe(custs[0].id);
    expect((m[0].raw_payload as any).adoptedVia).toBe("created");
  });

  // ── The complete file: takeoff + premium PDF + auto project (real full_json v2) ─────────

  /** Poll (≤ 10 s) for something the server does in the background. */
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timed out waiting for the background back-fill");
  };

  const m9100 = async () => (await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9100'`, [orgId]))[0];

  it("v2 job → takeoff columns, the premium PDF and a lead project: one complete file, never duplicated", async () => {
    stub.extraJobs.set(9100, stubJobV2(9100, 77001,
      { name: "Tess Takeoff", email: "takeoff-9100@example.com" },
      { line1: "100 Example Lane", zip: "98000" }));
    await fireCompleted(9100);

    const m = await m9100();
    expect(m).toBeTruthy();
    // Measured values in the columns (the quote quantities live in raw_payload.takeoff).
    expect(m.squares_milli).toBe(23030);
    expect(m.roof_area_sf_milli).toBe(2303000);
    expect(m.wall_area_sf_milli).toBe(2169000);
    expect(m.perimeter_lf_milli).toBe(268420);      // drip edge = rakes + eaves
    expect(m.eave_lf_milli).toBe(121670);
    expect(m.rake_lf_milli).toBe(146750);
    expect(m.valley_lf_milli).toBe(37920);
    expect(m.ridge_lf_milli).toBe(80330);
    expect(m.predominant_pitch).toBe("8/12");
    expect(m.stories).toBe(2);
    expect(m.facet_count).toBe(7);
    expect(m.waste_suggestion_bps).toBe(500);
    const raw = m.raw_payload as any;
    expect(raw.hoverModelId).toBe("77001");           // the COMPLETED model, not the failed one listed first
    expect(raw.takeoff.siding).toMatchObject({ areaSqft: 2169, quantitySqft: 2200 });
    expect(raw.takeoff.roof).toMatchObject({ areaSqft: 2303, wastePct: 5, quantitySqft: 2418, squares: 24.18 });
    expect(raw.takeoff.counts).toEqual({ windows: 9, doors: 4, windowGroups: 8 });
    expect(raw.summary).toMatchObject({ roofSqft: 2303, sidingSqft: 2169, windowsCount: 9, stories: 2, pitch: "8/12" });

    // The PREMIUM PDF, fetched with the bearer, stored as the gated measurement attachment.
    expect(raw.pdfSource).toBe("pro_premium");
    expect(stub.premiumHits).toContainEqual({ modelId: "77001", auth: true });
    const dl = await fetch(`${BASE}/api/crm/attachments/${raw.pdfAttachmentId}/file`);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PREMIUM_PDF)).toBe(true);

    // A lead project at the job's address, linked.
    expect(m.project_id).toBeTruthy();
    const [p] = await q<any>(`select * from crm_projects where id = $1`, [m.project_id]);
    expect(p.status).toBe("lead");
    expect(p.customer_id).toBe(m.customer_id);
    expect(p.name).toBe("Takeoff job 9100 — 100 Example Lane");
    expect(p.address_line1).toBe("100 Example Lane");
    expect(p.number).toMatch(/^P-\d+$/);
    expect((p.custom_fields as any).hoverJobId).toBe("9100");
    expect(raw.autoProjectId).toBe(p.id);

    // Redelivery: still one measurement, one project, one PDF.
    await fireCompleted(9100);
    await hover.ingestHoverJob(orgId, "9100");
    expect((await q<any>(`select id from crm_measurements where org_id = $1 and external_id = 'hover:9100'`, [orgId])).length).toBe(1);
    expect((await q<any>(`select id from crm_projects where org_id = $1 and customer_id = $2`, [orgId, m.customer_id])).length).toBe(1);
    expect((await q<any>(`select id from crm_attachments where org_id = $1 and file_name = 'hover-measurements-9100.pdf'`, [orgId])).length).toBe(1);
  });

  it("a second capture at the address joins that project; ensureHoverProject is idempotent and race-safe", async () => {
    stub.extraJobs.set(9101, stubJobV2(9101, 77002,
      { name: "Tess Takeoff", email: "takeoff-9100@example.com" },
      { line1: "100 EXAMPLE lane.", zip: "98000-1234" }));
    await fireCompleted(9101);
    const first = await m9100();
    const [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9101'`, [orgId]);
    expect(m.customer_id).toBe(first.customer_id);
    expect(m.project_id).toBe(first.project_id);
    // No premium report for this model → the documented PDF, whose storage redirect got NO bearer.
    expect((m.raw_payload as any).pdfSource).toBe("measurements");
    const dl = await fetch(`${BASE}/api/crm/attachments/${(m.raw_payload as any).pdfAttachmentId}/file`);
    expect(Buffer.from(await dl.arrayBuffer()).equals(STORAGE_PDF)).toBe(true);

    const file = await import("./hover-file");
    expect(await file.ensureHoverProject(orgId, m.id)).toEqual({ projectId: first.project_id, created: false });
    // Unlink both and race two ensures: one project still.
    await q(`update crm_measurements set project_id = null where id = any($1)`, [[m.id, first.id]]);
    const [a, b] = await Promise.all([file.ensureHoverProject(orgId, first.id), file.ensureHoverProject(orgId, m.id)]);
    expect(a.projectId).toBe(first.project_id);
    expect(b.projectId).toBe(first.project_id);
    expect(a.created || b.created).toBe(false);
    expect((await q<any>(`select id from crm_projects where org_id = $1 and customer_id = $2`, [orgId, m.customer_id])).length).toBe(1);
  });

  it("ambiguous and staff-ordered captures never get a project", async () => {
    for (const job of ["9005", "9013", "9014"]) {
      const [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = $2`, [orgId, `hover:${job}`]);
      expect(m.project_id).toBeNull();
      expect((await q<any>(`select id from crm_projects where org_id = $1 and customer_id = $2`, [orgId, m.customer_id])).length).toBe(0);
    }
    const file = await import("./hover-file");
    const [amb] = await q<any>(`select id from crm_measurements where org_id = $1 and external_id = 'hover:9005'`, [orgId]);
    expect((await file.ensureHoverProject(orgId, amb.id)).reason).toBe("ambiguous match");
    const [staff] = await q<any>(`select id from crm_measurements where org_id = $1 and external_id = 'hover:9013'`, [orgId]);
    expect((await file.ensureHoverProject(orgId, staff.id)).reason).toBe("staff-ordered capture");
  });

  it("takeoff routes, estimate symbols and getCustomerTakeoff carry the quote quantities", async () => {
    const m = await m9100();
    const byCustomer = await api(`/api/crm/customers/${m.customer_id}/takeoff`);
    expect(byCustomer.status).toBe(200);
    const t = byCustomer.body.takeoff;
    expect(t.siding.quantitySqft).toBe(2200);
    expect(t.roof.quantitySqft).toBe(2418);
    expect(t.roof.squares).toBe(24.18);
    expect(t.footprint).toEqual({ areaSqft: 1615, perimeterFt: 188.67, stories: 2 });
    expect(t.totals).toEqual({ windowsAreaSqft: 126, windowsUnitedInches: 808, doorsAreaSqft: 181 });
    expect(t.source.pdfUrl).toMatch(/^\/api\/crm\/attachments\/.+\/file$/);
    expect(byCustomer.body.others.length).toBe(1);   // the second capture
    const byProject = await api(`/api/crm/projects/${m.project_id}/takeoff`);
    expect(byProject.body.takeoff.siding.quantitySqft).toBe(2200);
    expect(JSON.stringify(byProject.body)).not.toMatch(/Cents|price/i);

    const sym = await api(`/api/crm/measurements/${m.id}/symbols`);
    expect(sym.body.symbols).toMatchObject({
      SQUARES: 23.03, WASTE: 5, SIDING_SF: 2200, ROOF_SF: 2418, ROOF_SQ: 24.18, WINDOWS: 9, DOORS: 4, UI: 808,
    });

    const file = await import("./hover-file");
    const best = await file.getCustomerTakeoff(orgId, m.customer_id, { addressLine1: "100 Example Lane", postalCode: "98000" });
    expect(best?.siding.quantitySqft).toBe(2200);
    expect(["9100", "9101"]).toContain(best?.source?.hoverJobId);
    expect(await file.getCustomerTakeoff(orgId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("back-fill re-derives every row from the stored full_json with ZERO HOVER calls, and is idempotent", async () => {
    const m = await m9100();
    await q(`update crm_measurements set squares_milli = null, wall_area_sf_milli = null, perimeter_lf_milli = null,
      raw_payload = raw_payload - 'takeoff' - 'summary' - 'takeoffDerivation' where id = $1`, [m.id]);
    const file = await import("./hover-file");
    const calls = stub.requests;
    const r1 = await file.backfillHoverTakeoffs(orgId);
    expect(r1.updated).toBeGreaterThanOrEqual(1);
    const back = await m9100();
    expect(back.squares_milli).toBe(23030);
    expect(back.wall_area_sf_milli).toBe(2169000);
    expect(back.perimeter_lf_milli).toBe(268420);
    expect((back.raw_payload as any).takeoff.siding.quantitySqft).toBe(2200);
    expect((back.raw_payload as any).pdfAttachmentId).toBe((m.raw_payload as any).pdfAttachmentId); // other keys kept
    expect((back.raw_payload as any).takeoffDerivation).toBe(file.TAKEOFF_DERIVATION);
    // Nothing stale is left: the next (sync) back-fill reads no rows at all.
    const r2 = await file.backfillHoverTakeoffs(orgId);
    expect(r2).toEqual({ checked: 0, updated: 0, unchanged: 0, skipped: 0 });
    // A full check (--all) finds every row current.
    const r3 = await file.backfillHoverTakeoffs(orgId, { all: true });
    expect(r3.updated).toBe(0);
    expect(r3.unchanged).toBeGreaterThanOrEqual(r1.updated);
    expect(r3.checked).toBe(r3.unchanged + r3.skipped);
    expect(stub.requests).toBe(calls);

    // Paging: 205 stale rows (more than two 100-row pages) are all visited, then none.
    await q(`insert into crm_measurements (org_id, provider, status, external_id, raw_payload)
      select $1, 'hover', 'ready', 'hover:bulk-' || g, jsonb_build_object('importSource', 'hover', 'takeoff', $2::jsonb)
      from generate_series(1, 205) g`, [orgId, JSON.stringify((back.raw_payload as any).takeoff)]);
    try {
      const bulk = await file.backfillHoverTakeoffs(orgId);
      expect(bulk.checked).toBe(205);
      expect(bulk.updated).toBe(205);   // their columns were empty
      const [one] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:bulk-77'`, [orgId]);
      expect(one.wall_area_sf_milli).toBe(2169000);
      expect((await file.backfillHoverTakeoffs(orgId)).checked).toBe(0);
    } finally {
      await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:bulk-%'`, [orgId]);
    }
  });

  it("takeoff rules are org settings: saving re-derives the takeoffs; 5% roof waste is the floor", async () => {
    const m = await m9100();
    // A capture whose document is not kept (only its stored takeoff) must follow rule changes too.
    await q(`update crm_measurements set raw_payload = raw_payload - 'fullJson' where org_id = $1 and external_id = 'hover:9101'`, [orgId]);
    const save = await api("/api/crm/integrations/hover/takeoff-rules", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ roofWastePct: 10, sidingRoundUpTo: 25 }),
    });
    expect(save.status).toBe(200);
    expect(save.body).toEqual({ ok: true, takeoffRules: { roofWastePct: 10, sidingRoundUpTo: 25 }, recalculating: true });
    // The cards apply the new rules on read at once …
    let t = (await api(`/api/crm/customers/${m.customer_id}/takeoff`)).body.takeoff;
    expect(t.roof.quantitySqft).toBe(2533);
    expect(t.siding.quantitySqft).toBe(2175);
    // … and the stored copies follow from the background back-fill.
    const row9101 = async () => (await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9101'`, [orgId]))[0];
    await until(async () => (await m9100()).waste_suggestion_bps === 1000 && (await row9101()).waste_suggestion_bps === 1000);
    const noDoc = await row9101();
    expect(noDoc.raw_payload.fullJson).toBeUndefined();
    expect(noDoc.raw_payload.takeoff.roof.quantitySqft).toBe(2533);
    expect(noDoc.raw_payload.takeoff.siding.quantitySqft).toBe(2175);
    expect(noDoc.waste_suggestion_bps).toBe(1000);
    expect((await api("/api/crm/integrations/hover/status")).body.takeoffRules).toEqual({ roofWastePct: 10, sidingRoundUpTo: 25 });
    const low = await api("/api/crm/integrations/hover/takeoff-rules", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ roofWastePct: 3, sidingRoundUpTo: 100 }),
    });
    expect(low.status).toBe(400);
    await api("/api/crm/integrations/hover/takeoff-rules", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ roofWastePct: 5, sidingRoundUpTo: 100 }),
    });
    await until(async () => (await row9101()).waste_suggestion_bps === 500 && (await m9100()).waste_suggestion_bps === 500);
    t = (await api(`/api/crm/customers/${m.customer_id}/takeoff`)).body.takeoff;
    expect(t.roof.quantitySqft).toBe(2418);
    expect(t.siding.quantitySqft).toBe(2200);
    const [back] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9101'`, [orgId]);
    expect(back.raw_payload.takeoff.roof.quantitySqft).toBe(2418);
    expect(back.waste_suggestion_bps).toBe(500);
  });

  // ── Review fixes: full_json retries, trimmed rows, PDF store across processes, auto-project retry ──

  it("a transient full_json failure schedules a retry (never a permanent exclusion), then the takeoff lands", async () => {
    stub.failFullJson = true;
    stub.extraJobs.set(9110, stubJobV2(9110, 77010, { name: "Tia Transient", email: "takeoff-9100@example.com" }, { line1: "110 Example Lane", zip: "98000" }));
    try {
      await hover.ingestHoverJob(orgId, "9110");
    } finally {
      stub.failFullJson = false;
    }
    let [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9110'`, [orgId]);
    expect(m.raw_payload.takeoff).toBeNull();
    expect(m.raw_payload.fullJsonFailures).toBe(1);
    const wait = Date.parse(m.raw_payload.fullJsonRetryAt) - Date.now();
    expect(wait).toBeGreaterThan(30 * 60_000);
    expect(wait).toBeLessThanOrEqual(3600_000);
    // Before the retry time nothing is fetched; after it, the next delivery fetches and derives.
    await hover.ingestHoverJob(orgId, "9110");
    [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9110'`, [orgId]);
    expect(m.raw_payload.takeoff).toBeNull();
    await q(`update crm_measurements set raw_payload = raw_payload || '{"fullJsonRetryAt":"2000-01-01T00:00:00.000Z"}'::jsonb where id = $1`, [m.id]);
    await hover.ingestHoverJob(orgId, "9110");
    [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9110'`, [orgId]);
    expect(m.raw_payload.takeoff.siding.quantitySqft).toBe(2200);
    expect(m.wall_area_sf_milli).toBe(2169000);
    expect(m.raw_payload.fullJsonFailures).toBe(0);
  });

  it("a row holding only the {trimmed:true} stand-in is re-fetched and gets its takeoff", async () => {
    const [m0] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9110'`, [orgId]);
    await q(`update crm_measurements set squares_milli = null, wall_area_sf_milli = null,
      raw_payload = (raw_payload - 'takeoff' - 'summary') || '{"fullJson":{"trimmed":true,"bytes":400000}}'::jsonb where id = $1`, [m0.id]);
    await hover.ingestHoverJob(orgId, "9110");
    const [m] = await q<any>(`select * from crm_measurements where id = $1`, [m0.id]);
    expect(m.raw_payload.fullJson.trimmed).toBeUndefined();
    expect(m.raw_payload.takeoff.roof.quantitySqft).toBe(2418);
    expect(m.squares_milli).toBe(23030);
  });

  it("the PDF is stored once even when two processes fetch it at the same moment", async () => {
    const [m] = await q<any>(`select * from crm_measurements where org_id = $1 and external_id = 'hover:9110'`, [orgId]);
    await q(`delete from crm_attachments where org_id = $1 and file_name = 'hover-measurements-9110.pdf'`, [orgId]);
    await q(`update crm_measurements set raw_payload = raw_payload - 'pdfAttachmentId' - 'pdfCheckedAt' where id = $1`, [m.id]);
    const [row] = await q<any>(`select * from crm_measurements where id = $1`, [m.id]);
    // This vitest process and the dev server are two processes with separate in-memory chains.
    const [a, b] = await Promise.all([
      hover.fetchHoverMeasurementPdfNow(orgId, {
        ...row, rawPayload: row.raw_payload, customerId: row.customer_id, externalId: row.external_id,
      } as any),
      api(`/api/crm/measurements/${m.id}/hover-pdf`, { method: "POST" }),
    ]);
    const atts = await q<any>(`select id from crm_attachments where org_id = $1 and file_name = 'hover-measurements-9110.pdf'`, [orgId]);
    expect(atts.length).toBe(1);
    expect(a.attachmentId).toBe(atts[0].id);
    expect(b.body.attachmentId).toBe(atts[0].id);
  });

  it("a capture whose auto-project step never finished is retried on the next delivery; historical rows are not", async () => {
    const [cust] = await q<any>(`select id from crm_customers where org_id = $1 and email = 'takeoff-9100@example.com'`, [orgId]);
    // As if the process died right after the insert: flag set, no project. A historical row has no flag.
    stub.extraJobs.set(9120, stubJobV2(9120, 77020, null, { line1: "120 Crash Ct", zip: "98000" }));
    stub.extraJobs.set(9121, stubJobV2(9121, 77021, null, { line1: "121 Old Rd", zip: "98000" }));
    const quiet = { importSource: "hover", photosSyncedAt: new Date().toISOString(), pdfCheckedAt: new Date().toISOString(), fullJsonRetryAt: "2999-01-01T00:00:00.000Z" };
    const [crashed] = await q<any>(`insert into crm_measurements (org_id, customer_id, provider, status, external_id, address_line1, postal_code, raw_payload)
      values ($1, $2, 'hover', 'ready', 'hover:9120', '120 Crash Ct', '98000', $3) returning id`,
      [orgId, cust.id, JSON.stringify({ ...quiet, hoverJobId: "9120", needsAutoProject: true })]);
    const [historical] = await q<any>(`insert into crm_measurements (org_id, customer_id, provider, status, external_id, address_line1, postal_code, raw_payload)
      values ($1, $2, 'hover', 'ready', 'hover:9121', '121 Old Rd', '98000', $3) returning id`,
      [orgId, cust.id, JSON.stringify({ ...quiet, hoverJobId: "9121" })]);
    await hover.ingestHoverJob(orgId, "9120");
    await hover.ingestHoverJob(orgId, "9121");
    const [c] = await q<any>(`select * from crm_measurements where id = $1`, [crashed.id]);
    expect(c.project_id).toBeTruthy();
    expect(c.raw_payload.needsAutoProject).toBe(false);
    const [p] = await q<any>(`select * from crm_projects where id = $1`, [c.project_id]);
    expect(p.address_line1).toBe("120 Crash Ct");
    const [h] = await q<any>(`select * from crm_measurements where id = $1`, [historical.id]);
    expect(h.project_id).toBeNull();
  });

  it("unit: SSRF policy — only HOVER and its signed storage, https, every redirect hop checked, size-capped", async () => {
    const api0 = "https://hover.to/api";
    const ok = (u: string) => hover.hoverFetchUrlAllowed(u, api0, true);
    expect(ok("https://hover.to/api/v1/models/1/pro_premium_measurements")).toBe(true);
    expect(ok("https://hover-prod.s3.us-west-2.amazonaws.com/f.pdf?X-Amz-Signature=x")).toBe(true);
    expect(ok("https://d1.cloudfront.net/f.pdf")).toBe(true);
    expect(ok("http://hover-prod.s3.amazonaws.com/f.pdf")).toBe(false);          // not https
    expect(ok("https://hover-prod.s3.amazonaws.com:8443/f.pdf")).toBe(false);    // odd port
    expect(ok("https://evil.example/f.pdf")).toBe(false);
    expect(ok("https://hover.to.evil.example/f.pdf")).toBe(false);
    expect(ok("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(ok("https://user:pw@hover.to/api/x")).toBe(false);
    expect(ok("http://127.0.0.1:9/x")).toBe(false);
    // Outside production a loopback stub API admits its loopback storage sibling — never in production.
    expect(hover.hoverFetchUrlAllowed("http://127.0.0.1:9/x", "http://127.0.0.1:8/api", false)).toBe(true);
    expect(hover.hoverFetchUrlAllowed("http://127.0.0.1:9/x", "http://127.0.0.1:8/api", true)).toBe(false);

    const seen: string[] = [];
    const pdf = Buffer.from("%PDF-1.7 x");
    const fake = (routes: Record<string, () => Response>) => (async (url: any) => {
      seen.push(String(url));
      const r = routes[String(url)];
      return r ? r() : new Response("nope", { status: 404 });
    }) as any;
    const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    // A redirect to the metadata service / a private address / a foreign host / plain http is never followed.
    for (const target of ["https://169.254.169.254/latest/meta-data", "https://10.0.0.5/f.pdf", "https://evil.example/f.pdf", "http://hover.to/api/f.pdf"]) {
      seen.length = 0;
      const out = await hover.fetchHoverPdf(fake({ "https://hover.to/api/a": redirect(target) }), "https://hover.to/api/a", {}, api0);
      expect(out).toBeNull();
      expect(seen).toEqual(["https://hover.to/api/a"]);
    }
    // More than 3 redirects: refused. Three are fine.
    const loop: Record<string, () => Response> = {};
    for (let i = 0; i < 6; i++) loop[`https://hover.to/api/r${i}`] = redirect(`https://hover.to/api/r${i + 1}`);
    loop["https://hover.to/api/r6"] = () => new Response(pdf, { status: 200 });
    expect(await hover.fetchHoverPdf(fake(loop), "https://hover.to/api/r0", {}, api0)).toBeNull();
    const three: Record<string, () => Response> = {};
    for (let i = 0; i < 3; i++) three[`https://hover.to/api/t${i}`] = redirect(`https://hover.to/api/t${i + 1}`);
    three["https://hover.to/api/t3"] = () => new Response(pdf, { status: 200 });
    expect((await hover.fetchHoverPdf(fake(three), "https://hover.to/api/t0", {}, api0))?.equals(pdf)).toBe(true);
    // Size cap: declared too big, and streamed past the cap without a length.
    const big = () => new Response("x", { status: 200, headers: { "content-length": String(26 * 1024 * 1024) } });
    expect(await hover.fetchHoverPdf(fake({ "https://hover.to/api/big": big }), "https://hover.to/api/big", {}, api0)).toBeNull();
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = () => new Response(new ReadableStream({
      pull(c) { if (sent++ > 40) c.close(); else c.enqueue(chunk); },
    }), { status: 200 });
    expect(await hover.fetchHoverPdf(fake({ "https://hover.to/api/stream": stream }), "https://hover.to/api/stream", {}, api0)).toBeNull();
    expect(sent).toBeLessThan(40);   // stopped reading at the cap
  });

  it("unit: the full_json body is streamed with a size cap; 5xx/bad JSON are transient, 404 is unavailable", async () => {
    const url = `${STUB}/api/v3/models/1/artifacts/measurements.json?version=full_json`;
    const parsed = { measurementsJsonUrl: url } as any;
    const reply = (r: () => Response) => (async () => r()) as any;
    let sent = 0;
    const huge = () => new Response(new ReadableStream({
      pull(c) { if (sent++ > 40) c.close(); else c.enqueue(new Uint8Array(1024 * 1024).fill(32)); },
    }), { status: 200 });
    expect(await hover.fetchHoverFullJson(parsed, {}, reply(huge))).toEqual({ kind: "unavailable" });
    expect(sent).toBeLessThan(20);   // stopped at the 10 MB cap
    const declared = () => new Response("{}", { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } });
    expect(await hover.fetchHoverFullJson(parsed, {}, reply(declared))).toEqual({ kind: "unavailable" });
    expect((await hover.fetchHoverFullJson(parsed, {}, reply(() => new Response("oops", { status: 502 })))).kind).toBe("transient");
    expect((await hover.fetchHoverFullJson(parsed, {}, reply(() => new Response("<html>", { status: 200 })))).kind).toBe("transient");
    expect(await hover.fetchHoverFullJson(parsed, {}, reply(() => new Response("{}", { status: 404 })))).toEqual({ kind: "unavailable" });
    const ok = await hover.fetchHoverFullJson(parsed, {}, reply(() => new Response(JSON.stringify(V2_FULL_JSON), { status: 200 })));
    expect(ok.kind).toBe("ok");
    // A payload link outside HOVER's hosts is never fetched.
    expect(await hover.fetchHoverFullJson({ measurementsJsonUrl: "https://evil.example/m.json" } as any, {}, reply(() => { throw new Error("fetched"); }))).toEqual({ kind: "unavailable" });
  });

  it("unit: full_json retry backoff and the needs-fetch rule", () => {
    const now = Date.parse("2026-10-17T00:00:00.000Z");
    expect(hover.hoverFullJsonRetry("transient", 1, now)).toEqual({ fullJsonRetryAt: "2026-10-17T01:00:00.000Z", fullJsonFailures: 1 });
    expect(hover.hoverFullJsonRetry("transient", 3, now).fullJsonRetryAt).toBe("2026-10-17T04:00:00.000Z");
    expect(hover.hoverFullJsonRetry("transient", 12, now).fullJsonRetryAt).toBe("2026-10-18T00:00:00.000Z");
    expect(hover.hoverFullJsonRetry("unavailable", 1, now).fullJsonRetryAt).toBe("2026-10-24T00:00:00.000Z");
    expect(hover.hoverNeedsFullJson({}, now)).toBe(true);
    expect(hover.hoverNeedsFullJson({ fullJson: { trimmed: true } }, now)).toBe(true);
    expect(hover.hoverNeedsFullJson({ fullJson: { version: 2 } }, now)).toBe(false);
    expect(hover.hoverNeedsFullJson({ fullJsonRetryAt: "2026-10-17T01:00:00.000Z" }, now)).toBe(false);
    expect(hover.hoverNeedsFullJson({ fullJsonRetryAt: "2026-10-16T23:00:00.000Z" }, now)).toBe(true);
  });


  it("report viewer: every report is listed for the picker; the PDF opens inline; a missing one is fetched on demand", async () => {
    const m = await m9100();
    const listed = (await api(`/api/crm/customers/${m.customer_id}/takeoff`)).body;
    expect(listed.takeoffs.map((x: any) => x.source.hoverJobId).sort()).toEqual(expect.arrayContaining(["9100", "9101"]));

    const attId = (m.raw_payload as any).pdfAttachmentId;
    const inline = await fetch(`${BASE}/api/crm/attachments/${attId}/file?inline=1`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("application/pdf");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    const dl = await fetch(`${BASE}/api/crm/attachments/${attId}/file`);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);

    // Drop the stored PDF: the card offers "Fetch report from HOVER", which stores it again.
    await q(`delete from crm_attachments where id = $1`, [attId]);
    await q(`update crm_measurements set raw_payload = raw_payload - 'pdfAttachmentId' - 'pdfSource' where id = $1`, [m.id]);
    expect((await api(`/api/crm/customers/${m.customer_id}/takeoff`)).body.takeoffs
      .find((x: any) => x.source.hoverJobId === "9100").source.pdfUrl).toBeNull();
    const hits = stub.premiumHits.length;
    const fetched = await api(`/api/crm/measurements/${m.id}/hover-pdf`, { method: "POST" });
    expect(fetched.status).toBe(200);
    expect(fetched.body.pdfUrl).toBe(`/api/crm/attachments/${fetched.body.attachmentId}/file`);
    expect(stub.premiumHits.length).toBe(hits + 1);
    const again = await api(`/api/crm/measurements/${m.id}/hover-pdf`, { method: "POST" });
    expect(again.body.attachmentId).toBe(fetched.body.attachmentId);   // stored once, no second HOVER call
    expect(stub.premiumHits.length).toBe(hits + 1);
    expect((await api(`/api/crm/measurements/00000000-0000-0000-0000-000000000000/hover-pdf`, { method: "POST" })).status).toBe(404);
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

  it("tenant isolation: a second org's ingest can't link or adopt org A's data", async () => {
    const rows = await q<{ id: string }>(
      `insert into crm_orgs (name, owner_user_id) values ('HOVER Vitest Org B', 1) returning id`);
    orgBId = rows[0].id;
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`, [orgBId, JSON.stringify({
      hover: { refreshTokenEnc: hover.encryptHoverSecret("rt-orgB"), connectedAt: new Date().toISOString() },
    })]);

    // Org B's token endpoint is answered locally so the stub's rotating
    // refresh-token chain (org A's) is never disturbed; API calls pass
    // through to the stub untouched (it doesn't validate bearer tokens).
    const orgBFetch = (async (url: any, init: any) => {
      if (String(url).includes("/oauth/token")) {
        return new Response(JSON.stringify({
          access_token: "at-orgB", refresh_token: "rt-orgB", expires_in: 7200,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return fetch(url, init);
    }) as typeof fetch;

    // Org A's state before org B does anything.
    const custA = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'hover-vitest@example.com'`, [orgId]);
    expect(custA.length).toBe(1);
    const mA0 = await q<any>(
      `select id, customer_id from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgId]);
    expect(mA0.length).toBe(1);

    // Same service address as org A's 9001 customer — must NOT attach to it.
    stub.extraJobs.set(9016, stubJobAt(9016,
      { name: "Org B Customer", email: "orgb-9016@example.com" },
      { line1: "123 Pine St", zip: "98101" }));
    const r1 = await hover.ingestHoverJob(orgBId, "9016", orgBFetch);
    expect(r1.created).toBe(true);
    expect(r1.customerCreated).toBe(true); // created its OWN customer
    const custB = await q<any>(
      `select id from crm_customers where org_id = $1 and email = 'orgb-9016@example.com'`, [orgBId]);
    expect(custB.length).toBe(1);
    expect(r1.customerId).toBe(custB[0].id);

    // Org B ingests the SAME job id org A already holds — externalId is
    // org-scoped, so org B gets its own measurement (attached by address
    // within org B) instead of adopting or touching org A's row.
    const r2 = await hover.ingestHoverJob(orgBId, "9001", orgBFetch);
    expect(r2.created).toBe(true);
    const mB = await q<any>(
      `select id, customer_id from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgBId]);
    expect(mB.length).toBe(1);
    expect(mB[0].customer_id).toBe(custB[0].id);

    // Org A's customer and measurement are exactly as before.
    const mA1 = await q<any>(
      `select id, customer_id from crm_measurements where org_id = $1 and external_id = 'hover:9001'`, [orgId]);
    expect(mA1.length).toBe(1);
    expect(mA1[0].id).toBe(mA0[0].id);
    expect(mA1[0].customer_id).toBe(custA[0].id);
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
    // HOVER's Ruby signer uses the bare media type and may leave Content-MD5 blank.
    const bare = hover.hoverCanonicalString("application/json", body, RECEIVER_PATH, date);
    const sigBare = `sha256=42:${createHmac("sha256", secret).update(bare).digest("base64")}`;
    expect(hover.verifyHoverSignature({ ...base, contentType: "application/json; charset=utf-8", signature256: sigBare, signatureSha1: null, hmacSecret: secret })).toBe(true);
    const blankMd5 = ["application/json", "", RECEIVER_PATH, date].join(",");
    const sigBlank = `sha1=42:${createHmac("sha1", secret).update(blankMd5).digest("base64")}`;
    expect(hover.verifyHoverSignature({ ...base, signature256: null, signatureSha1: sigBlank, hmacSecret: secret })).toBe(true);
    expect(hover.verifyHoverSignature({ ...base, signature256: null, signatureSha1: sigBlank, hmacSecret: "wrong" })).toBe(false);
    expect(hover.hoverWebhookIdFromHeaders(sig256, null)).toBe("42");
    expect(hover.hoverWebhookIdFromHeaders(null, sig1)).toBe("42");
    expect(hover.hoverWebhookIdFromHeaders(null, null)).toBeNull();
  });

  it("unit: webhook URL key names its org and rejects tampering", () => {
    const org = "1e3050c1-3cfd-4d9b-ba5a-1c19ce074897";
    const key = hover.mintHoverWebhookKey(org);
    expect(hover.verifyHoverWebhookKey(key)).toBe(org);
    expect(hover.verifyHoverWebhookKey(key.slice(0, -1) + (key.endsWith("a") ? "b" : "a"))).toBeNull();
    // Another org's key never verifies as this org.
    const other = "2e3050c1-3cfd-4d9b-ba5a-1c19ce074897";
    expect(hover.verifyHoverWebhookKey(`${other}.${key.split(".")[1]}`)).toBeNull();
    expect(hover.verifyHoverWebhookKey("")).toBeNull();
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

  it("unit: a missing total_pages keeps the walk going while pages come back full", async () => {
    const fullPage = Array.from({ length: hover.HOVER_JOBS_PAGE_SIZE }, (_, i) => ({ id: 100 + i }));
    const seen: number[] = [];
    const walk = await hover.walkHoverJobsPages(async (page) => {
      seen.push(page);
      // No pagination block at all — the old walk stopped after page 1.
      return page === 1
        ? { status: 200, json: { results: fullPage } }
        : { status: 200, json: { results: [{ id: 9000 }] } }; // short page = last
    });
    expect(seen).toEqual([1, 2]);
    expect(walk.jobs.length).toBe(hover.HOVER_JOBS_PAGE_SIZE + 1);
    expect(walk.truncated).toBe(false);
    expect(walk.firstPageError).toBeNull();
  });

  it("unit: a reported total_pages stops the walk on the last page", async () => {
    const seen: number[] = [];
    const walk = await hover.walkHoverJobsPages(async (page) => {
      seen.push(page);
      return { status: 200, json: { results: [{ id: page }], pagination: { total_pages: 2 } } };
    });
    expect(seen).toEqual([1, 2]);
    expect(walk.jobs.length).toBe(2);
    expect(walk.truncated).toBe(false);
  });

  it("unit: hitting the 80-page cap with pages left reports truncated", async () => {
    const fullPage = Array.from({ length: hover.HOVER_JOBS_PAGE_SIZE }, () => ({ id: 1 }));
    const walk = await hover.walkHoverJobsPages(async () => ({
      status: 200,
      json: { results: fullPage, pagination: { total_pages: 500 } },
    }));
    expect(walk.jobs.length).toBe(hover.HOVER_SYNC_MAX_PAGES * hover.HOVER_JOBS_PAGE_SIZE);
    expect(walk.truncated).toBe(true);
  });

  it("unit: a page-1 failure is surfaced, a late-page failure keeps the haul", async () => {
    const failed = await hover.walkHoverJobsPages(async () => ({ status: 500, json: {} }));
    expect(failed.firstPageError).toBe(500);
    expect(failed.jobs).toEqual([]);

    const partial = await hover.walkHoverJobsPages(async (page) =>
      page === 1
        ? { status: 200, json: { results: [{ id: 1 }], pagination: { total_pages: 3 } } }
        : { status: 500, json: {} });
    expect(partial.firstPageError).toBeNull();
    expect(partial.jobs).toEqual([{ id: 1 }]);
    expect(partial.truncated).toBe(false);
  });
});
