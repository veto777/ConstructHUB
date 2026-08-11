/**
 * Contractor-side "take a payment" endpoints, against the running dev server.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8149 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Covers the lane-a3 additions in server/crm/payments.ts:
 *   - GET  /api/crm/payments?customerId=…        (client-page payment history)
 *   - POST /api/crm/invoices/:id/payment-link    (hosted card+ACH checkout link)
 *   - POST /api/crm/estimates/:id/payment-link   (approved-estimate deposit link)
 *
 * Stripe session CREATION is exercised only when the dev org actually has a
 * connected account; without one the contract is a clean 503, which is what
 * most of these assertions pin down. No charge is ever captured here.
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

let cookie: string | undefined;

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  cookie = me.cookie;
});

/** Customer + one-item invoice for $250.00, all integer cents. */
async function makeInvoice(run: number) {
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `PayLink Client ${run}`, email: `paylink.${run}@example.com` }),
  }, cookie);
  expect(cust.status).toBe(201);

  const inv = await api("/api/crm/invoices", {
    method: "POST",
    body: JSON.stringify({
      customerId: cust.body.id, title: "PayLink invoice", taxRateBps: 0,
      items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 250_00, taxable: false }],
    }),
  }, cookie);
  expect(inv.status).toBe(201);
  expect(inv.body.totalCents).toBe(250_00);
  return { customerId: cust.body.id as string, invoice: inv.body };
}

describe("contractor take-a-payment endpoints", () => {
  it("filters the payments list by customerId", async () => {
    const run = Date.now();
    const { customerId, invoice } = await makeInvoice(run);

    const pay = await api(`/api/crm/invoices/${invoice.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ amountCents: 100_00, method: "check", note: "partial" }),
    }, cookie);
    expect(pay.status).toBe(201);

    const mine = await api(`/api/crm/payments?customerId=${customerId}`, {}, cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);
    for (const p of mine.body) expect(p.customerId).toBe(customerId);
    expect(mine.body.some((p: any) => p.id === pay.body.payment.id)).toBe(true);

    const stranger = await api(`/api/crm/payments?customerId=00000000-0000-0000-0000-000000000000`, {}, cookie);
    expect(stranger.status).toBe(200);
    expect(stranger.body).toEqual([]);
  });

  it("invoice payment-link: 503 without a connected account, or a session URL with one", async () => {
    const run = Date.now();
    const { customerId, invoice } = await makeInvoice(run);

    const r = await api(`/api/crm/invoices/${invoice.id}/payment-link`, { method: "POST", body: "{}" }, cookie);
    if (r.status === 503) {
      // The designed dev state: no connected Stripe account → friendly message,
      // never a crash. The UI renders this verbatim in a toast.
      expect(r.body.message).toMatch(/isn't set up yet|isn't available/i);
    } else {
      expect(r.status).toBe(200);
      expect(r.body.url).toMatch(/^https:\/\//);
      expect(r.body.amountCents).toBe(250_00);
      // Session creation recorded a pending row against this client…
      const mine = await api(`/api/crm/payments?customerId=${customerId}`, {}, cookie);
      const pending = (mine.body as any[]).find((p) => p.externalId && p.status === "pending");
      expect(pending).toBeTruthy();
      expect(pending.amountCents).toBe(250_00);
      // …and the double-pay guard refuses a second open session.
      const again = await api(`/api/crm/invoices/${invoice.id}/payment-link`, { method: "POST", body: "{}" }, cookie);
      expect(again.status).toBe(409);
    }
  });

  it("invoice payment-link rejects bogus, voided and fully-paid invoices", async () => {
    const run = Date.now();

    const bogus = await api(`/api/crm/invoices/00000000-0000-0000-0000-000000000000/payment-link`,
      { method: "POST", body: "{}" }, cookie);
    expect(bogus.status).toBe(404);

    const { invoice } = await makeInvoice(run);
    const paid = await api(`/api/crm/invoices/${invoice.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ amountCents: 250_00, method: "cash" }),
    }, cookie);
    expect(paid.status).toBe(201);
    expect(paid.body.invoice.status).toBe("paid");

    const full = await api(`/api/crm/invoices/${invoice.id}/payment-link`, { method: "POST", body: "{}" }, cookie);
    expect(full.status).toBe(400);
    expect(full.body.message).toMatch(/nothing left to pay/i);

    const { invoice: inv2 } = await makeInvoice(run + 1);
    const voided = await api(`/api/crm/invoices/${inv2.id}/void`, { method: "POST", body: "{}" }, cookie);
    expect(voided.status).toBe(200);
    const v = await api(`/api/crm/invoices/${inv2.id}/payment-link`, { method: "POST", body: "{}" }, cookie);
    expect(v.status).toBe(409);
  });

  it("estimate payment-link requires approval first", async () => {
    const run = Date.now();
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({ displayName: `PayLink Est ${run}`, email: `paylink-est.${run}@example.com` }),
    }, cookie);
    expect(cust.status).toBe(201);

    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.body.id, title: "PayLink estimate", taxRateBps: 0,
        items: [{ kind: "labor", name: "Line", description: null, unit: null,
          quantityMilli: 1000, unitPriceCents: 500_00, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);

    const r = await api(`/api/crm/estimates/${est.body.id}/payment-link`, { method: "POST", body: "{}" }, cookie);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/approved/i);
  });
});
