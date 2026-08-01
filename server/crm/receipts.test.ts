/**
 * Receipts-to-date: the receipt math, the send gates (role + zero-paid), and
 * the auto-receipt that fires after a manually recorded payment unless the
 * org's 'paymentReceipt' pref is off.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

/** The auto-receipt is fire-and-forget — poll the invoice row for the attempt. */
async function receiptLog(invoiceId: string): Promise<any | null> {
  const r = await pool.query(`select custom_fields->'receipt' as r from crm_invoices where id = $1`, [invoiceId]);
  return r.rows[0]?.r ?? null;
}
async function waitForReceiptLog(invoiceId: string, ms = 18000): Promise<any | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const log = await receiptLog(invoiceId);
    if (log && Number(log.attempts) >= 1) return log;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

let cookie: string | undefined;

async function makeCustomer(run: string, email = `vitest.rcpt.${run}@example.com`) {
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Vitest Receipt ${run}`, email }),
  }, cookie);
  expect(cust.status).toBe(201);
  return cust.body;
}

async function makeInvoice(customerId: string, unitPriceCents = 150000) {
  const inv = await api("/api/crm/invoices", {
    method: "POST",
    body: JSON.stringify({
      customerId, title: "Vitest receipt invoice", taxRateBps: 0,
      items: [
        { kind: "labor", name: "Labor", quantityMilli: 1000, unitPriceCents },
        { kind: "material", name: "Materials", quantityMilli: 1000, unitPriceCents: 50000 },
      ],
    }),
  }, cookie);
  expect(inv.status).toBe(201);
  return inv.body;
}

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  cookie = me.cookie;
});

describe("receipts-to-date", () => {
  it("adds up two payments and the remaining balance, then flips to PAID IN FULL", async () => {
    const run = String(Date.now());
    const cust = await makeCustomer(run);
    // $1,500 + $500 = $2,000.00, no tax.
    const inv = await makeInvoice(cust.id);
    expect(inv.totalCents).toBe(200000);

    // Two partial payments: $400 by check, then $200 cash.
    const p1 = await api(`/api/crm/invoices/${inv.id}/payments`, {
      method: "POST", body: JSON.stringify({ amountCents: 40000, method: "check", note: "Check #1042" }),
    }, cookie);
    expect(p1.status).toBe(201);
    const p2 = await api(`/api/crm/invoices/${inv.id}/payments`, {
      method: "POST", body: JSON.stringify({ amountCents: 20000, method: "cash" }),
    }, cookie);
    expect(p2.status).toBe(201);

    const r = await api(`/api/crm/invoices/${inv.id}/receipt`, {}, cookie);
    expect(r.status).toBe(200);
    expect(r.body.invoice.number).toBe(inv.number);
    expect(r.body.customer.displayName).toContain("Vitest Receipt");
    expect(r.body.items).toHaveLength(2);
    expect(r.body.totalCents).toBe(200000);
    expect(r.body.payments).toHaveLength(2);
    expect(r.body.payments.map((p: any) => p.amountCents).sort((a: number, b: number) => a - b))
      .toEqual([20000, 40000]);
    expect(r.body.payments[0].method).toBeTruthy();
    expect(r.body.payments[0].paidAt).toBeTruthy();
    expect(r.body.totalPaidCents).toBe(60000);
    expect(r.body.balanceCents).toBe(140000);
    expect(r.body.paidInFull).toBe(false);
    expect(r.body.company.name).toBeTruthy();

    // Pay the rest — the receipt flips to paid-in-full with a zero balance.
    const p3 = await api(`/api/crm/invoices/${inv.id}/payments`, {
      method: "POST", body: JSON.stringify({ amountCents: 140000, method: "wire" }),
    }, cookie);
    expect(p3.status).toBe(201);
    const full = await api(`/api/crm/invoices/${inv.id}/receipt`, {}, cookie);
    expect(full.body.totalPaidCents).toBe(200000);
    expect(full.body.balanceCents).toBe(0);
    expect(full.body.paidInFull).toBe(true);
  });

  it("refuses to send a zero-paid receipt (409) and gates both routes on manageInvoices (403)", async () => {
    const run = String(Date.now());
    const cust = await makeCustomer(run);
    const inv = await makeInvoice(cust.id);

    // 409 — nothing paid yet, a receipt would be pointless.
    const zero = await api(`/api/crm/invoices/${inv.id}/receipt/send`, { method: "POST", body: "{}" }, cookie);
    expect(zero.status).toBe(409);
    expect(String(zero.body.message)).toMatch(/no payments/i);

    // 403 — strip manageInvoices from the dev member via a permission override,
    // then restore. The window is milliseconds; other suites never see it.
    const me = await api("/api/crm/me", {}, cookie);
    const memberId = me.body.member.id;
    const off = await api(`/api/crm/members/${memberId}`, {
      method: "PATCH", body: JSON.stringify({ permissions: { manageInvoices: false } }),
    }, cookie);
    expect(off.status).toBe(200);
    try {
      const get = await api(`/api/crm/invoices/${inv.id}/receipt`, {}, cookie);
      expect(get.status).toBe(403);
      const send = await api(`/api/crm/invoices/${inv.id}/receipt/send`, { method: "POST", body: "{}" }, cookie);
      expect(send.status).toBe(403);
    } finally {
      const restore = await api(`/api/crm/members/${memberId}`, {
        method: "PATCH", body: JSON.stringify({ permissions: null }),
      }, cookie);
      expect(restore.status).toBe(200);
    }
  });

  it("emails the receipt after a manual payment (pref on) and stays silent with the pref off", async () => {
    const run = String(Date.now());

    // Pref ON: record a payment → the auto-receipt attempt lands on the invoice.
    const on = await api("/api/crm/org", {
      method: "PATCH", body: JSON.stringify({ notificationPrefs: { paymentReceipt: true } }),
    }, cookie);
    expect(on.status).toBe(200);
    const cust1 = await makeCustomer(`${run}a`);
    const inv1 = await makeInvoice(cust1.id);
    const pay1 = await api(`/api/crm/invoices/${inv1.id}/payments`, {
      method: "POST", body: JSON.stringify({ amountCents: 50000, method: "cash" }),
    }, cookie);
    expect(pay1.status).toBe(201);
    const log = await waitForReceiptLog(inv1.id);
    expect(log, "auto-receipt attempt should be recorded on the invoice").toBeTruthy();
    expect(log.lastTo).toBe(cust1.email);

    // Pref OFF: same flow, no receipt attempt may appear.
    const off = await api("/api/crm/org", {
      method: "PATCH", body: JSON.stringify({ notificationPrefs: { paymentReceipt: false } }),
    }, cookie);
    expect(off.status).toBe(200);
    try {
      const cust2 = await makeCustomer(`${run}b`);
      const inv2 = await makeInvoice(cust2.id);
      const pay2 = await api(`/api/crm/invoices/${inv2.id}/payments`, {
        method: "POST", body: JSON.stringify({ amountCents: 50000, method: "cash" }),
      }, cookie);
      expect(pay2.status).toBe(201);
      // Give the (silenced) fire-and-forget plenty of time to prove a negative.
      await new Promise((r) => setTimeout(r, 3000));
      expect(await receiptLog(inv2.id)).toBeNull();
    } finally {
      // Restore the default so later suites see the shipped behaviour.
      await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ notificationPrefs: { paymentReceipt: true } }),
      }, cookie);
    }
  });
});
