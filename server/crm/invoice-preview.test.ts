/**
 * Contractor invoice preview, the voided-invoice page and the portal's
 * "Pay" hint, against the running dev server:
 *  1. POST /api/crm/invoices/:id/preview-link mints a read-only grant; the
 *     public invoice GET honours it in place of the client session, flags the
 *     payload `preview`, and never records a view. A tampered grant, or no
 *     grant, still meets the email gate, and the pay route never accepts one.
 *  2. A voided invoice answers 410 with the company name + contact details the
 *     page needs, and nothing else (no line items, no totals).
 *  3. The client portal marks every open invoice with a boolean `payOnline`.
 *
 * Requires the dev server (DEV_AUTH_BYPASS_USER1=true, SESSION_SECRET set):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Fixtures are made through the app's own routes (no raw SQL writes) and
 * removed through the owner's delete-client route in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (path: string, data: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(data) });

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let customerId = "";
let portalToken = "";
let invoiceId = "";
let publicToken = "";
let orgName = "";

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  orgName = me.body.org.name;
  const cust = await post("/api/crm/customers", {
    displayName: `R2-r3 Preview Client ${stamp}`,
    email: `r2-r3-preview-${stamp}@example.com`,
  });
  expect(cust.status).toBe(201);
  customerId = cust.body.id;
  portalToken = String(cust.body.portalPath ?? "").replace(/^\/portal\//, "");

  const inv = await post("/api/crm/invoices", {
    customerId,
    title: `R2-r3 Preview Invoice ${stamp}`,
    items: [{ name: "R2-r3 siding repair", quantityMilli: 1000, unitPriceCents: 123_45 }],
  });
  expect(inv.status).toBe(201);
  invoiceId = inv.body.id;
  publicToken = inv.body.publicToken;
  // Sent, so a real client open WOULD be tracked — the preview must not be.
  const sent = await post(`/api/crm/invoices/${invoiceId}/send`, {});
  expect(sent.status).toBe(200);
});

afterAll(async () => {
  if (customerId) await api(`/api/crm/customers/${customerId}?force=1`, { method: "DELETE" });
});

async function invoiceRow() {
  const list = await api(`/api/crm/invoices?customerId=${customerId}`);
  expect(list.status).toBe(200);
  return (list.body as any[]).find((i) => i.id === invoiceId);
}

describe("contractor invoice preview", () => {
  it("mints a grant that opens the invoice read-only and untracked", async () => {
    const mint = await post(`/api/crm/invoices/${invoiceId}/preview-link`);
    expect(mint.status).toBe(200);
    expect(mint.body.url).toContain(`/i/${publicToken}?preview=`);
    expect(new Date(mint.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const grant = new URL(mint.body.url).searchParams.get("preview")!;

    const doc = await api(`/api/public/invoices/${publicToken}?preview=${encodeURIComponent(grant)}`);
    expect(doc.status).toBe(200);
    expect(doc.body.preview).toBe(true);
    expect(doc.body.invoice.totalCents).toBe(123_45);
    expect(doc.body.items).toHaveLength(1);

    // Opening it as the contractor is not the client viewing it.
    const row = await invoiceRow();
    expect(row.firstViewedAt).toBeNull();
    expect(row.viewCount ?? 0).toBe(0);

    // The grant cannot pay.
    const pay = await post(`/api/public/invoices/${publicToken}/pay?preview=${encodeURIComponent(grant)}`, {});
    expect(pay.status).toBe(401);
  });

  it("no grant or a tampered one still meets the email gate", async () => {
    const bare = await api(`/api/public/invoices/${publicToken}`);
    expect(bare.status).toBe(401);
    expect(bare.body.requiresVerification).toBe(true);

    const mint = await post(`/api/crm/invoices/${invoiceId}/preview-link`);
    const grant = new URL(mint.body.url).searchParams.get("preview")!;
    const [exp, sig] = grant.split(".");
    const flipped = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    const tampered = await api(`/api/public/invoices/${publicToken}?preview=${flipped}`);
    expect(tampered.status).toBe(401);
  });

  it("an unknown invoice id → 404", async () => {
    const r = await post(`/api/crm/invoices/00000000-0000-0000-0000-000000000000/preview-link`);
    expect(r.status).toBe(404);
  });
});

describe("client portal pay hint", () => {
  it("every open invoice carries a boolean payOnline", async () => {
    expect(portalToken.length).toBeGreaterThanOrEqual(24);
    const portal = await api(`/api/public/portal/${portalToken}`);
    expect(portal.status).toBe(200);
    const row = (portal.body.invoices as any[]).find((i) => i.id === invoiceId);
    expect(row).toBeTruthy();
    expect(row.dueCents).toBe(123_45);
    expect(typeof row.payOnline).toBe("boolean");
  });
});

describe("voided invoice", () => {
  it("410 names the company and how to reach it, and nothing else", async () => {
    const mint = await post(`/api/crm/invoices/${invoiceId}/preview-link`);
    const grant = new URL(mint.body.url).searchParams.get("preview")!;
    expect((await post(`/api/crm/invoices/${invoiceId}/void`)).status).toBe(200);

    const r = await api(`/api/public/invoices/${publicToken}?preview=${encodeURIComponent(grant)}`);
    expect(r.status).toBe(410);
    expect(r.body.message).toBe("This invoice has been voided.");
    expect(Object.keys(r.body.company).sort()).toEqual(["email", "name", "phone"]);
    expect(r.body.company.name).toBe(orgName);
    expect(r.body.invoice).toBeUndefined();
    expect(r.body.items).toBeUndefined();

    // Still gated: without a session or grant the voided state stays private.
    const bare = await api(`/api/public/invoices/${publicToken}`);
    expect(bare.status).toBe(401);

    // A voided invoice drops out of the portal.
    const portal = await api(`/api/public/portal/${portalToken}`);
    expect((portal.body.invoices as any[]).some((i) => i.id === invoiceId)).toBe(false);
  });
});
