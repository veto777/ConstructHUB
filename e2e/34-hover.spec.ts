import { expect, test } from "@playwright/test";
import http from "http";
import fs from "fs";
import path from "path";
import { createHash, createHmac } from "crypto";
import { q } from "./db";
import { gotoCrm, grantClientSession, watchPage, E2E_BASE_URL } from "./helpers";

/**
 * HOVER integration, end to end with a LOCAL STUB standing in for hover.to —
 * no live calls. The stub is a real http server (OAuth authorize/token, the
 * v2 webhook endpoints incl. the verification handshake, v3 jobs, artifacts);
 * tmp/hover-stub.json points the dev server at it (non-production override in
 * server/crm/hover.ts), so every server-side HOVER call the CRM makes lands
 * on the stub — exactly the production code path.
 *
 * @serial: the spec drives the shared dev org's HOVER connection state
 * (custom_fields->'hover') and the shared tmp/hover-stub.json, so it must not
 * race other specs.
 */

const STUB_PORT = Number(process.env.E2E_PORT ?? "8119") + 1000;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const STUB_FILE = path.join(process.cwd(), "tmp", "hover-stub.json");
const RECEIVER_PATH = "/api/crm/integrations/hover/webhook";
const HOVER_EMAIL = "hover-e2e@example.com";

const PDF_BYTES = Buffer.from("%PDF-1.4 e2e stub hover measurements pdf");
const FULL_JSON = {
  roof: { total_roof_area_sqft: 2874.5, predominant_pitch: "6/12", waste_percent: 12 },
  siding: { total_siding_area_sqft: 2210 },
  openings: { windows: 14 },
  property: { stories: 2 },
};

function stubJob(id: number) {
  return {
    id,
    name: `E2E HOVER job ${id}`,
    contact: id === 9001 ? { name: "E2E Hover Homeowner", email: HOVER_EMAIL, phone: "(206) 555-0199" } : {},
    location: { address_line_1: "456 Cedar Ave", city: "Tacoma", state: "WA", zip: "98402" },
    models: [
      {
        artifacts: [
          { type: "measurements_json", url: `${STUB}/artifacts/measurements.json` },
          { type: "measurement_pdf", url: `${STUB}/artifacts/measurements.pdf` },
        ],
      },
    ],
    machete_blob: { OptInFeature: { designProUrl: `https://hover.to/3d/${id}` } },
  };
}

interface StubWebhook { id: number; url: string; hmac_secret: string; code: string; verified_at: string | null }

const stub = {
  server: null as http.Server | null,
  webhooks: new Map<number, StubWebhook>(),
  registrationBodies: [] as any[],
  deletedWebhooks: [] as number[],
  refreshTokensSeen: [] as string[],
  currentRefreshToken: "rt-1",
  nextWebhookId: 77701,
  accessCounter: 0,
};

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

    if (url.pathname === "/oauth/authorize") {
      // HOVER's consent page — the stub auto-approves, like a contractor
      // clicking "Authorize" would.
      const redirect = url.searchParams.get("redirect_uri")!;
      const sep = redirect.includes("?") ? "&" : "?";
      res.writeHead(302, {
        location: `${redirect}${sep}code=e2e-auth-code&state=${encodeURIComponent(url.searchParams.get("state") || "")}`,
      });
      return res.end();
    }
    if (url.pathname === "/oauth/token") {
      const body = JSON.parse(raw || "{}");
      if (!body.client_id || !body.client_secret) return json(400, { error: "invalid_client" });
      if (body.grant_type === "authorization_code") {
        stub.currentRefreshToken = "rt-1";
        return json(200, { access_token: "at-0", refresh_token: "rt-1", expires_in: 1, token_type: "Bearer" });
      }
      if (body.grant_type === "refresh_token") {
        stub.refreshTokensSeen.push(body.refresh_token);
        if (body.refresh_token !== stub.currentRefreshToken) return json(400, { error: "invalid_grant" });
        const next = `rt-${stub.refreshTokensSeen.length + 1}`;
        stub.currentRefreshToken = next;
        return json(200, { access_token: `at-${++stub.accessCounter}`, refresh_token: next, expires_in: 1, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/api/v2/webhooks" && req.method === "GET") {
      return json(200, [...stub.webhooks.values()].map(({ code, ...w }) => w));
    }
    if (url.pathname === "/api/v2/webhooks" && req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      stub.registrationBodies.push(body);
      if (!body.webhook || typeof body.webhook.url !== "string") {
        return json(422, { error: "webhook.url is required" });
      }
      const wh: StubWebhook = {
        id: stub.nextWebhookId++,
        url: body.webhook.url,
        hmac_secret: `e2e-secret-${stub.nextWebhookId}`,
        code: `e2e-code-${stub.nextWebhookId}`,
        verified_at: null,
      };
      stub.webhooks.set(wh.id, wh);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...wh, code: undefined, content_type: body.webhook.content_type }));
      // HOVER posts the verification code immediately after registration.
      setImmediate(() => {
        const evt = JSON.stringify({ event: "webhook-verification-code", webhook_id: wh.id, code: wh.code });
        void fetch(wh.url, { method: "POST", headers: sign(evt, wh.id, wh.hmac_secret), body: evt }).catch(() => {});
      });
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
      const wh = [...stub.webhooks.values()].find((w) => w.code === verifyMatch[1]);
      if (!wh) return json(404, { error: "unknown code" });
      wh.verified_at = new Date().toISOString();
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/v2/jobs") {
      return json(200, {
        results: [
          { id: 9001, state: "completed" },
          { id: 9002, state: "completed" },
          { id: 9003, state: "in_progress" },
        ],
      });
    }
    const jobMatch = /^\/api\/v3\/jobs\/(\d+)$/.exec(url.pathname);
    if (jobMatch) return json(200, stubJob(Number(jobMatch[1])));
    if (url.pathname === "/artifacts/measurements.json") {
      return json(200, url.searchParams.get("version") === "full_json" ? FULL_JSON : { note: "summary" });
    }
    if (url.pathname === "/artifacts/measurements.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PDF_BYTES);
    }

    // Test control: have "HOVER" fire a job-state-changed-v2 event at the
    // registered webhook — the event genuinely originates from the stub,
    // signed the way HOVER signs.
    if (url.pathname === "/__fire" && req.method === "POST") {
      const { job_id } = JSON.parse(raw || "{}");
      const wh = [...stub.webhooks.values()][0];
      if (!wh) return json(409, { error: "no webhook registered" });
      const evt = JSON.stringify({ event: "job-state-changed-v2", state: "completed", job_id });
      const r = await fetch(wh.url, { method: "POST", headers: sign(evt, wh.id, wh.hmac_secret), body: evt });
      return json(r.status, { delivered: r.ok });
    }

    json(404, { error: `stub: no route ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => stub.server!.listen(STUB_PORT, "127.0.0.1", resolve));
}

test.describe("HOVER integration @serial", () => {
  let savedCustomFields: any;
  let ORG_ID = "";

  test.beforeAll(async () => {
    // The dev-bypass session resolves to user 1's FIRST active membership
    // (requireOrg's default when nothing is pinned in the fresh session) —
    // run the whole flow against that org, whichever it is.
    const m = await q<{ org_id: string }>(
      `select org_id from crm_members where user_id = 1 and status = 'active' order by created_at asc limit 1`,
    );
    ORG_ID = m[0].org_id;
    await startStub();
    fs.mkdirSync(path.dirname(STUB_FILE), { recursive: true });
    fs.writeFileSync(STUB_FILE, JSON.stringify({ oauthBase: STUB, apiBase: `${STUB}/api` }));

    const org = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [ORG_ID]);
    savedCustomFields = org[0]?.custom_fields ?? null;
    await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'hover' where id = $1`, [ORG_ID]);
    await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:%'`, [ORG_ID]);
    await q(`delete from crm_customers where org_id = $1 and email = $2`, [ORG_ID, HOVER_EMAIL]);
  });

  test.afterAll(async () => {
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`,
      [ORG_ID, savedCustomFields === null ? null : JSON.stringify(savedCustomFields)]);
    await q(`delete from crm_attachments where org_id = $1 and kind = 'measurement' and file_name like 'hover-measurements-%'`, [ORG_ID]);
    await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:%'`, [ORG_ID]);
    await q(`delete from crm_customers where org_id = $1 and email = $2`, [ORG_ID, HOVER_EMAIL]);
    try { fs.unlinkSync(STUB_FILE); } catch {}
    await new Promise((r) => stub.server?.close(r));
  });

  test("connect → webhook handshake → completed job on client page + portal", async ({ page }) => {
    const guards = watchPage(page);

    // ── Integrations card → Connect HOVER → OAuth round-trip ─────────────
    await gotoCrm(page, "/crm/integrations");
    await expect(page.getByTestId("card-hover")).toBeVisible();
    await page.getByTestId("button-connect-hover").click();
    // connect 302 → stub authorize → stub auto-approve → callback → integrations.
    await page.waitForURL(/\/crm\/integrations\?hover=connected/, { timeout: 20_000 });
    await expect(page.getByTestId("pill-hover-connected")).toBeVisible();

    // Webhook registered with the NESTED body, content_type json, OUR url.
    expect(stub.registrationBodies.length).toBe(1);
    expect(stub.registrationBodies[0]).toEqual({
      webhook: { url: `${E2E_BASE_URL}${RECEIVER_PATH}`, content_type: "json" },
    });

    // The verification handshake completes: stub fires the code event, the
    // receiver PUTs it back, the card flips to verified.
    await expect
      .poll(async () => {
        const r = await page.request.get("/api/crm/integrations/hover/status");
        return (await r.json())?.webhook?.verified;
      }, { timeout: 15_000 })
      .toBe(true);
    await expect(page.getByTestId("text-hover-webhook")).toContainText("verified", { timeout: 15_000 });

    // The receiver refuses unsigned traffic.
    const unsigned = await page.request.post(RECEIVER_PATH, {
      headers: { "content-type": "application/json" },
      data: { event: "job-state-changed-v2", state: "completed", job_id: 9001 },
    });
    expect(unsigned.status()).toBe(401);

    // ── HOVER fires job-state-changed-v2 (completed) ─────────────────────
    const fired = await page.request.post(`${STUB}/__fire`, { data: { job_id: 9001 } });
    expect(fired.status()).toBe(200);

    let customerId = "";
    let measurementId = "";
    await expect
      .poll(async () => {
        const rows = await q<{ id: string; customer_id: string }>(
          `select id, customer_id from crm_measurements where org_id = $1 and external_id = 'hover:9001'`,
          [ORG_ID],
        );
        if (rows.length) {
          measurementId = rows[0].id;
          customerId = rows[0].customer_id;
          return true;
        }
        return false;
      }, { timeout: 15_000 })
      .toBe(true);

    // ── Client detail page: measurements section ─────────────────────────
    await gotoCrm(page, `/crm/clients/${customerId}`);
    await expect(page.getByTestId(`measurement-${measurementId}`)).toBeVisible();
    await expect(page.getByTestId(`measurement-${measurementId}`)).toContainText("hover report");
    await expect(page.getByTestId(`measurement-${measurementId}`)).toContainText("Roof 2,874.5 sq ft");
    await expect(page.getByTestId(`measurement-${measurementId}`)).toContainText("Siding 2,210 sq ft");
    await expect(page.getByTestId(`measurement-${measurementId}`)).toContainText("14 windows");
    const crm3d = page.getByTestId(`measurement-3d-${measurementId}`);
    await expect(crm3d).toHaveAttribute("href", "https://hover.to/3d/9001");

    // ── Client portal: Measurement reports section ───────────────────────
    await grantClientSession(page, [customerId]);
    await gotoCrm(page, "/?client=1");
    await expect(page.getByTestId("section-reports")).toBeVisible();
    const portal3d = page.getByTestId(`client-report-3d-${measurementId}`);
    await expect(portal3d).toBeVisible();
    await expect(portal3d).toHaveAttribute("href", "https://hover.to/3d/9001");
    await expect(portal3d).toHaveAttribute("target", "_blank");
    const pdf = page.getByTestId(`client-report-pdf-${measurementId}`);
    await expect(pdf).toBeVisible();
    // The PDF downloads through the session-gated attachment route.
    const pdfUrl = await pdf.getAttribute("href");
    expect(pdfUrl).toMatch(/^\/api\/client\/attachments\/[^/]+\/download$/);
    const dl = await page.request.get(pdfUrl!);
    expect(dl.status()).toBe(200);
    expect(Buffer.from(await dl.body()).equals(PDF_BYTES)).toBe(true);

    // ── Sync now (re-pull; one dup + one new) and Disconnect ─────────────
    await gotoCrm(page, "/crm/integrations");
    await expect(page.getByTestId("card-hover")).toBeVisible();
    await page.getByTestId("button-hover-sync").click();
    await expect(page.getByTestId("text-hover-lastsync")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const rows = await q<{ id: string }>(
          `select id from crm_measurements where org_id = $1 and external_id = 'hover:9002'`,
          [ORG_ID],
        );
        return rows.length;
      }, { timeout: 15_000 })
      .toBe(1);

    await page.getByTestId("button-hover-disconnect").click(); // confirm auto-accepted
    await expect(page.getByTestId("button-connect-hover")).toBeVisible({ timeout: 15_000 });
    expect(stub.deletedWebhooks.length).toBe(1);
    const status = await (await page.request.get("/api/crm/integrations/hover/status")).json();
    expect(status.connected).toBe(false);

    guards.assertClean("hover e2e");
  });
});
