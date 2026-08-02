import { expect, test } from "@playwright/test";
import http from "http";
import fs from "fs";
import path from "path";
import { createHash, createHmac } from "crypto";
import { q } from "./db";
import { gotoCrm, watchPage, E2E_BASE_URL } from "./helpers";

/**
 * HOVER address-matching backfill, end to end with a LOCAL STUB standing in
 * for hover.to — no live calls (same seam as 34-hover.spec.ts:
 * tmp/hover-stub.json points the dev server at the stub).
 *
 * The flow under test: an existing CRM customer and a completed HOVER job
 * share a service address but NOT an email/phone — the job must attach to
 * THAT customer (never create a duplicate), the measurement notes it was
 * matched by address, and the sync report counts attachedByAddress.
 *
 * @serial: drives the shared dev org's HOVER connection state and the shared
 * tmp/hover-stub.json, like every other HOVER spec.
 */

const STUB_PORT = Number(process.env.E2E_PORT ?? "8119") + 1000;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const STUB_FILE = path.join(process.cwd(), "tmp", "hover-stub.json");
const RECEIVER_PATH = "/api/crm/integrations/hover/webhook";

const OWNER_EMAIL = "sync-match-owner@example.com";
const JOB_EMAIL_1 = "hover-sync-e2e-other@example.com";
const JOB_EMAIL_2 = "hover-sync-e2e-other2@example.com";
const ADDR_LINE1 = "31 Sync Match Ave";
const ADDR_ZIP = "98405";

const PDF_BYTES = Buffer.from("%PDF-1.4 e2e sync stub pdf");
const FULL_JSON = { roof: { total_roof_area_sqft: 1500, predominant_pitch: "5/12" } };

function stubJob(id: number, email: string) {
  return {
    id,
    name: `E2E sync HOVER job ${id}`,
    contact: { name: "Job Contact", email, phone: "(253) 555-0177" },
    location: { address_line_1: ADDR_LINE1, city: "Tacoma", state: "WA", zip: ADDR_ZIP },
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

interface StubWebhook { id: number; url: string; hmac_secret: string; code: string; verified_at: string | null }

const stub = {
  server: null as http.Server | null,
  webhooks: new Map<number, StubWebhook>(),
  nextWebhookId: 88801,
  currentRefreshToken: "rt-1",
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
      const redirect = url.searchParams.get("redirect_uri")!;
      const sep = redirect.includes("?") ? "&" : "?";
      res.writeHead(302, {
        location: `${redirect}${sep}code=e2e-sync-code&state=${encodeURIComponent(url.searchParams.get("state") || "")}`,
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
        if (body.refresh_token !== stub.currentRefreshToken) return json(400, { error: "invalid_grant" });
        const next = `rt-${stub.accessCounter + 2}`;
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
      if (!body.webhook || typeof body.webhook.url !== "string") {
        return json(422, { error: "webhook.url is required" });
      }
      const wh: StubWebhook = {
        id: stub.nextWebhookId++,
        url: body.webhook.url,
        hmac_secret: `e2e-sync-secret-${stub.nextWebhookId}`,
        code: `e2e-sync-code-${stub.nextWebhookId}`,
        verified_at: null,
      };
      stub.webhooks.set(wh.id, wh);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...wh, code: undefined, content_type: body.webhook.content_type }));
      setImmediate(() => {
        const evt = JSON.stringify({ event: "webhook-verification-code", webhook_id: wh.id, code: wh.code });
        void fetch(wh.url, { method: "POST", headers: sign(evt, wh.id, wh.hmac_secret), body: evt }).catch(() => {});
      });
      return;
    }
    const delMatch = /^\/api\/v2\/webhooks\/(\d+)$/.exec(url.pathname);
    if (delMatch && req.method === "DELETE") {
      stub.webhooks.delete(Number(delMatch[1]));
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
          { id: 8001, state: "completed" },
          { id: 8002, state: "completed" },
          { id: 8003, state: "in_progress" },
        ],
      });
    }
    const jobMatch = /^\/api\/v3\/jobs\/(\d+)$/.exec(url.pathname);
    if (jobMatch) {
      const id = Number(jobMatch[1]);
      if (id === 8001) return json(200, stubJob(8001, JOB_EMAIL_1));
      if (id === 8002) return json(200, stubJob(8002, JOB_EMAIL_2));
      return json(404, { error: "no such job" });
    }
    if (url.pathname === "/artifacts/measurements.json") {
      return json(200, url.searchParams.get("version") === "full_json" ? FULL_JSON : { note: "summary" });
    }
    if (url.pathname === "/artifacts/measurements.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PDF_BYTES);
    }
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

test.describe("HOVER address-matching sync @serial", () => {
  let savedCustomFields: any;
  let ORG_ID = "";
  let seededCustomerId = "";

  test.beforeAll(async () => {
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
    await q(`delete from crm_customers where org_id = $1 and email in ($2, $3, $4)`, [ORG_ID, OWNER_EMAIL, JOB_EMAIL_1, JOB_EMAIL_2]);

    // The pre-existing client: same service address as the HOVER jobs, but a
    // completely different email/phone — only the address can match them.
    const seeded = await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, email, phone, address_line1, city, state, postal_code, portal_token)
       values ($1, 'Sync Match Owner', $2, '(253) 555-0100', $3, 'Tacoma', 'WA', $4, md5(random()::text)) returning id`,
      [ORG_ID, OWNER_EMAIL, ADDR_LINE1, ADDR_ZIP],
    );
    seededCustomerId = seeded[0].id;
  });

  test.afterAll(async () => {
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`,
      [ORG_ID, savedCustomFields === null ? null : JSON.stringify(savedCustomFields)]);
    await q(`delete from crm_attachments where org_id = $1 and kind = 'measurement' and file_name like 'hover-measurements-%'`, [ORG_ID]);
    await q(`delete from crm_measurements where org_id = $1 and external_id like 'hover:%'`, [ORG_ID]);
    await q(`delete from crm_customers where org_id = $1 and email in ($2, $3, $4)`, [ORG_ID, OWNER_EMAIL, JOB_EMAIL_1, JOB_EMAIL_2]);
    try { fs.unlinkSync(STUB_FILE); } catch {}
    await new Promise((r) => stub.server?.close(r));
  });

  test("different-email job at a known address attaches to the EXISTING client", async ({ page }) => {
    const guards = watchPage(page);

    // ── Connect HOVER (OAuth round-trip against the stub) ────────────────
    await gotoCrm(page, "/crm/integrations");
    await expect(page.getByTestId("card-hover")).toBeVisible();
    await page.getByTestId("button-connect-hover").click();
    await page.waitForURL(/\/crm\/integrations\?hover=connected/, { timeout: 20_000 });
    await expect
      .poll(async () => {
        const r = await page.request.get("/api/crm/integrations/hover/status");
        return (await r.json())?.webhook?.verified;
      }, { timeout: 15_000 })
      .toBe(true);

    // ── HOVER fires completed for job 8001 (DIFFERENT email, SAME address) ─
    const fired = await page.request.post(`${STUB}/__fire`, { data: { job_id: 8001 } });
    expect(fired.status()).toBe(200);

    let measurementId = "";
    await expect
      .poll(async () => {
        const rows = await q<{ id: string; customer_id: string }>(
          `select id, customer_id from crm_measurements where org_id = $1 and external_id = 'hover:8001'`,
          [ORG_ID],
        );
        if (rows.length) measurementId = rows[0].id;
        return rows[0]?.customer_id ?? null;
      }, { timeout: 15_000 })
      .toBe(seededCustomerId);

    // It attached to the EXISTING customer — no duplicate was created.
    const strangers = await q<{ id: string }>(
      `select id from crm_customers where org_id = $1 and email in ($2, $3)`,
      [ORG_ID, JOB_EMAIL_1, JOB_EMAIL_2],
    );
    expect(strangers.length).toBe(0);

    // ── Client detail: the measurement notes HOW it attached ─────────────
    await gotoCrm(page, `/crm/clients/${seededCustomerId}`);
    await expect(page.getByTestId(`measurement-${measurementId}`)).toBeVisible();
    await expect(page.getByTestId(`measurement-matchedvia-${measurementId}`)).toContainText("matched by address");

    // ── Sync now: job 8002 attaches by address too, and the report says so ─
    await gotoCrm(page, "/crm/integrations");
    await page.getByTestId("button-hover-sync").click();
    await expect
      .poll(async () => {
        const r = await page.request.get("/api/crm/integrations/hover/status");
        const report = (await r.json())?.lastSyncReport;
        return report?.scanned === 3 ? report : null;
      }, { timeout: 15_000 })
      .toMatchObject({
        scanned: 3,
        attachedByEmail: 0,
        attachedByPhone: 0,
        attachedByAddress: 1, // 8002
        created: 0,
        ambiguous: 0,
        duplicates: 1,        // 8001 already ingested via the event
        errors: [],
      });

    // The settings card renders the persisted report.
    await expect(page.getByTestId("text-hover-syncreport")).toContainText("3 scanned");
    await expect(page.getByTestId("text-hover-syncreport")).toContainText("1 by address");

    // …and 8002 landed on the same existing customer.
    const m2 = await q<{ customer_id: string; raw_payload: any }>(
      `select customer_id, raw_payload from crm_measurements where org_id = $1 and external_id = 'hover:8002'`,
      [ORG_ID],
    );
    expect(m2.length).toBe(1);
    expect(m2[0].customer_id).toBe(seededCustomerId);
    expect((m2[0].raw_payload as any).matchedVia).toBe("address");

    // Still no duplicate customers from either job contact.
    const strangersAfter = await q<{ id: string }>(
      `select id from crm_customers where org_id = $1 and email in ($2, $3)`,
      [ORG_ID, JOB_EMAIL_1, JOB_EMAIL_2],
    );
    expect(strangersAfter.length).toBe(0);

    guards.assertClean("hover sync e2e");
  });
});
