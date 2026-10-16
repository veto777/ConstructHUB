/**
 * Settings → Estimate & invoice defaults are a per-document SNAPSHOT
 * (server/crm/doc-defaults.ts):
 *   1. create pre-fills the estimate footer, warranty, company terms and the
 *      default deposit percent onto a new estimate, and the invoice footer,
 *      warranty and terms onto a new invoice;
 *   2. a later Settings edit never changes a document already created — the
 *      client's estimate/invoice page prints the document's own copy;
 *   3. an older document with no snapshot keeps printing live Settings, and the
 *      backfill snapshots unsent drafts only, never a sent one.
 *
 * Pure helpers first, then in-process CRM routes on the lane Postgres
 * (constructhub_dev[_x] on localhost only) with a throwaway user/org that is
 * deleted afterwards; no email, SMS or Stripe calls.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { estimateDefaultsFromOrg, invoiceDefaultsFromOrg, estimateDocText, invoiceDocText, depositFromBps } from "./doc-defaults";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
vi.mock("./sms", async (original) => ({
  ...(await original<typeof import("./sms")>()),
  sendSms: vi.fn(async () => ({ ok: true, provider: "log", sid: null })),
  textOrgOwners: vi.fn(async () => {}),
}));

const ORG = {
  estimateFooter: "Est footer v1", invoiceFooter: "Inv footer v1",
  termsAndConditions: "Terms v1", warrantyText: "Warranty v1", defaultDepositBps: 2500,
};

describe("doc-defaults helpers", () => {
  it("snapshot the org defaults onto a new estimate and invoice", () => {
    const at = new Date("2026-10-15T00:00:00Z");
    expect(estimateDefaultsFromOrg(ORG, at)).toEqual({
      footerText: "Est footer v1", warrantyText: "Warranty v1", companyTermsText: "Terms v1",
      depositBps: 2500, defaultsSnapshotAt: at,
    });
    expect(estimateDefaultsFromOrg({ ...ORG, defaultDepositBps: 0, estimateFooter: "  " }, at))
      .toMatchObject({ footerText: null, depositBps: null });
    expect(invoiceDefaultsFromOrg(ORG, null, at)).toEqual({
      footerText: "Inv footer v1", warrantyText: "Warranty v1", termsText: "Terms v1", defaultsSnapshotAt: at,
    });
    // Billed from an estimate: the warranty/terms the client signed, not today's Settings.
    const signed = { defaultsSnapshotAt: at, footerText: "x", warrantyText: "Signed warranty", companyTermsText: "Signed terms" };
    expect(invoiceDefaultsFromOrg(ORG, signed, at)).toMatchObject({
      footerText: "Inv footer v1", warrantyText: "Signed warranty", termsText: "Signed terms",
    });
  });

  it("render the document's copy, or live Settings for a pre-snapshot document", () => {
    const snap = { defaultsSnapshotAt: new Date(), footerText: null, warrantyText: "Old warranty", companyTermsText: "Old terms" };
    expect(estimateDocText(snap, ORG)).toEqual({ footerText: null, warrantyText: "Old warranty", companyTermsText: "Old terms" });
    expect(estimateDocText({ defaultsSnapshotAt: null }, ORG))
      .toEqual({ footerText: "Est footer v1", warrantyText: "Warranty v1", companyTermsText: "Terms v1" });
    expect(invoiceDocText({ defaultsSnapshotAt: null }, ORG))
      .toEqual({ footerText: "Inv footer v1", warrantyText: "Warranty v1", termsText: "Terms v1" });
  });

  it("derive a percent deposit in whole cents, never above the total", () => {
    expect(depositFromBps(100001, 2500)).toBe(25000);
    expect(depositFromBps(1000, 10000)).toBe(1000);
    expect(depositFromBps(1000, null)).toBeNull();
  });
});

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("document defaults through the CRM routes (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, orgId = "", customerId = "";
  const sessionHashes: string[] = [];

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie?: string) {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-fixture-user": String(userId), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  async function clientCookie() {
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    sessionHashes.push(hash);
    await pool.query(
      `INSERT INTO crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
       VALUES ($1, $2::jsonb, now() + interval '1 day', now())`, [hash, JSON.stringify([customerId])]);
    return `crm_client=${raw}`;
  }
  const settings = (v: string, depositPct = 25) => call("/api/crm/org", {
    estimateFooter: `Est footer ${v}`, invoiceFooter: `Inv footer ${v}`,
    termsAndConditions: `Terms ${v}`, warrantyText: `Warranty ${v}`, defaultDepositBps: depositPct * 100,
  }, "PATCH");
  const line = (cents: number) => ({ kind: "labor", name: "Work", quantityMilli: 1000, unitPriceCents: cents, taxable: false });
  const tokenOf = async (table: "crm_estimates" | "crm_invoices", id: string) =>
    (await pool.query(`SELECT public_token FROM ${table} WHERE id=$1`, [id])).rows[0].public_token as string;

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    const { ensureCrmSchema } = await import("./schema-ensure");
    await ensureCrmSchema();
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-docdef-${randomUUID()}@example.invalid`])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    expect((await settings("v1")).status).toBe(200);
    const c = await call("/api/crm/customers", { displayName: "Docdef Client", email: `docdef-${randomUUID()}@example.invalid` });
    expect(c.status).toBe(201);
    customerId = c.data.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (orgId) {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
      for (const { table_name } of rows) await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
      await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
    }
    await pool.query("DELETE FROM crm_client_sessions WHERE token_hash = ANY($1::text[])", [sessionHashes]);
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  });

  it("pre-fills a new estimate (footer, warranty, terms, default deposit) and the deposit follows the total until typed", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Prefill", items: [line(100000)] });
    expect(e.status).toBe(201);
    expect(e.data).toMatchObject({
      footerText: "Est footer v1", warrantyText: "Warranty v1", companyTermsText: "Terms v1",
      termsText: "Terms v1", depositBps: 2500, depositCents: 25000,
    });
    expect(e.data.defaultsSnapshotAt).toBeTruthy();

    const items = await call(`/api/crm/estimates/${e.data.id}/items`, { items: [line(40000)] }, "PUT");
    expect(items.status).toBe(200);
    expect(items.data.depositCents).toBe(10000);

    const typed = await call(`/api/crm/estimates/${e.data.id}`, { depositCents: 5000 }, "PATCH");
    expect(typed.status).toBe(200);
    expect(typed.data).toMatchObject({ depositCents: 5000, depositBps: null });
    const again = await call(`/api/crm/estimates/${e.data.id}/items`, { items: [line(80000)] }, "PUT");
    expect(again.data.depositCents).toBe(5000);

    // A deposit typed at creation wins over the default.
    const own = await call("/api/crm/estimates", { customerId, items: [line(100000)], depositCents: 1000 });
    expect(own.data).toMatchObject({ depositCents: 1000, depositBps: null, footerText: "Est footer v1" });
  });

  it("pre-fills a new invoice (footer, warranty, terms)", async () => {
    const inv = await call("/api/crm/invoices", { customerId, items: [line(5000)] });
    expect(inv.status).toBe(201);
    const { rows: [row] } = await pool.query(
      "SELECT footer_text, warranty_text, terms_text, defaults_snapshot_at FROM crm_invoices WHERE id=$1", [inv.data.id]);
    expect(row).toMatchObject({ footer_text: "Inv footer v1", warranty_text: "Warranty v1", terms_text: "Terms v1" });
    expect(row.defaults_snapshot_at).not.toBeNull();
  });

  it("keeps a sent estimate and its invoice on their own copy after Settings change", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Stable", items: [line(20000)] });
    expect((await call(`/api/crm/estimates/${e.data.id}/send`, { sms: false })).status).toBe(200);
    const cookie = await clientCookie();
    const t = await tokenOf("crm_estimates", e.data.id);

    expect((await settings("v2", 50)).status).toBe(200);

    const view = await call(`/api/public/estimates/${t}`, undefined, "GET", cookie);
    expect(view.status).toBe(200);
    expect(view.data.estimate).toMatchObject({ footerText: "Est footer v1", depositCents: 5000 });
    expect(view.data.company).toMatchObject({ warrantyText: "Warranty v1", termsAndConditions: "Terms v1" });

    // Signed after the Settings change: the invoice carries what was signed.
    expect((await call(`/api/public/estimates/${t}/respond`, { decision: "approve", signatureName: "Docdef Client" }, "POST", cookie)).status).toBe(200);
    const inv = await call(`/api/crm/estimates/${e.data.id}/invoice`, {});
    expect(inv.status).toBe(201);
    const invId = inv.data.id ?? inv.data.invoice?.id;
    const iv = await call(`/api/public/invoices/${await tokenOf("crm_invoices", invId)}`, undefined, "GET", cookie);
    expect(iv.status).toBe(200);
    expect(iv.data.invoice).toMatchObject({ footerText: "Inv footer v2", warrantyText: "Warranty v1", termsText: "Terms v1" });

    // A plain invoice created now takes the new Settings — and keeps them after another change.
    const plain = await call("/api/crm/invoices", { customerId, items: [line(1000)] });
    expect((await settings("v3")).status).toBe(200);
    const pv = await call(`/api/public/invoices/${await tokenOf("crm_invoices", plain.data.id)}`, undefined, "GET", cookie);
    expect(pv.data.invoice).toMatchObject({ footerText: "Inv footer v2", warrantyText: "Warranty v2", termsText: "Terms v2" });

    // New estimates take the newest defaults.
    const fresh = await call("/api/crm/estimates", { customerId, items: [line(10000)] });
    expect(fresh.data).toMatchObject({ footerText: "Est footer v3", warrantyText: "Warranty v3", depositBps: 2500 });
  });

  it("prints live Settings for a pre-snapshot document; the backfill snapshots unsent drafts only", async () => {
    const sent = await call("/api/crm/estimates", { customerId, title: "Legacy sent", items: [line(10000)] });
    expect((await call(`/api/crm/estimates/${sent.data.id}/send`, { sms: false })).status).toBe(200);
    const draft = await call("/api/crm/estimates", { customerId, title: "Legacy draft", items: [line(10000)] });
    // Make both look like documents from before snapshots existed.
    await pool.query(
      `UPDATE crm_estimates SET footer_text=NULL, warranty_text=NULL, company_terms_text=NULL, deposit_bps=NULL,
       defaults_snapshot_at=NULL WHERE id = ANY($1::varchar[])`, [[sent.data.id, draft.data.id]]);
    expect((await settings("v4")).status).toBe(200);

    const cookie = await clientCookie();
    const t = await tokenOf("crm_estimates", sent.data.id);
    const live = await call(`/api/public/estimates/${t}`, undefined, "GET", cookie);
    expect(live.data.estimate.footerText).toBe("Est footer v4");
    expect(live.data.company).toMatchObject({ warrantyText: "Warranty v4", termsAndConditions: "Terms v4" });

    const { backfillDocDefaultsSnapshots } = await import("./schema-ensure");
    await backfillDocDefaultsSnapshots(pool);
    const rows = (await pool.query(
      "SELECT id, footer_text, warranty_text, company_terms_text, defaults_snapshot_at FROM crm_estimates WHERE id = ANY($1::varchar[])",
      [[sent.data.id, draft.data.id]])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[draft.data.id]).toMatchObject({ footer_text: "Est footer v4", warranty_text: "Warranty v4", company_terms_text: "Terms v4" });
    expect(byId[draft.data.id].defaults_snapshot_at).not.toBeNull();
    // The sent one is never rewritten — it keeps following Settings, as before.
    expect(byId[sent.data.id]).toMatchObject({ footer_text: null, warranty_text: null, company_terms_text: null, defaults_snapshot_at: null });

    expect((await settings("v5")).status).toBe(200);
    const after = await call(`/api/public/estimates/${t}`, undefined, "GET", cookie);
    expect(after.data.company.warrantyText).toBe("Warranty v5");
  });
});
