import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Account billing history: the invoices / payment-methods / purchases reads
// on the real dev database with a mocked Stripe SDK. No Stripe call is made.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";

const mocks = vi.hoisted(() => ({
  invoicesList: vi.fn(),
  sessionsList: vi.fn(),
  customersRetrieve: vi.fn(),
  listPaymentMethods: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
}));
vi.mock("stripe", () => ({ default: class {
  invoices = { list: mocks.invoicesList };
  checkout = { sessions: { list: mocks.sessionsList } };
  customers = { retrieve: mocks.customersRetrieve, listPaymentMethods: mocks.listPaymentMethods };
  subscriptions = { retrieve: mocks.subscriptionsRetrieve };
} }));

import { pool } from "../db";
import {
  registerBillingRoutes, ensureBillingLedgerSchema, resetBackfillMemory, parsePage, purchaseKind, invoiceRow, purchaseRow,
  paymentMethodItem, PAGE_DEFAULT, PAGE_MAX, BILLING_LEDGER_DDL,
} from "./billing-routes";

const CUSTOMER_A = "cus_ACCT_l4_a";
const SUBSCRIPTION_A = "sub_ACCT_l4_a";
const CUSTOMER_C = "cus_ACCT_l4_c";
let a: number, b: number, c: number, d: number;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Requires a local development database");
  await ensureBillingLedgerSchema();
  // The shared DDL (server/account/schema.ts) leaves `created` nullable; a dev database whose ledgers were
  // created by an earlier, stricter copy is brought to that shape (a no-op once it is). Nothing else changes.
  await pool.query("ALTER TABLE billing_invoices ALTER COLUMN created DROP NOT NULL");
  const { rows } = await pool.query(`INSERT INTO users(email) VALUES
    ('ACCT-l4-'||gen_random_uuid()||'@example.invalid'), ('ACCT-l4-'||gen_random_uuid()||'@example.invalid'),
    ('ACCT-l4-'||gen_random_uuid()||'@example.invalid'), ('ACCT-l4-'||gen_random_uuid()||'@example.invalid') RETURNING id`);
  [a, b, c, d] = rows.map((r) => r.id);
  // A (a subscriber) and C are Stripe customers; B and D never reached checkout (no subscriptions row at all).
  await pool.query(`INSERT INTO subscriptions(user_id, stripe_customer_id, stripe_subscription_id, plan, status)
    VALUES ($1,$2,$3,'pro','active'), ($4,$5,NULL,'free','inactive')`, [a, CUSTOMER_A, SUBSCRIPTION_A, c, CUSTOMER_C]);
});
afterAll(async () => {
  const ids = [a, b, c, d];
  await pool.query("DELETE FROM billing_invoices WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM billing_purchases WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM subscriptions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
});
beforeEach(() => { vi.clearAllMocks(); resetBackfillMemory(); });

// The routes as registered, called with a plain request/response pair.
const handlers = new Map<string, any>();
const app: any = { get: (path: string, ...fns: any[]) => handlers.set(path, fns.at(-1)) };
registerBillingRoutes(app, (req: any, res: any) => {
  if (req.user) return req.user;
  res.status(401).json({ message: "Not authenticated" });
  return null;
});
async function call(path: string, userId: number | null, query: Record<string, unknown> = {}) {
  const res: any = { statusCode: 200, status: vi.fn((code: number) => { res.statusCode = code; return res; }), json: vi.fn() };
  await handlers.get(path)({ user: userId ? { id: userId, email: "x@example.invalid" } : undefined, query }, res);
  return { status: res.statusCode, body: res.json.mock.calls[0]?.[0] };
}

const stripeError = (message: string) => Object.assign(new Error(message), { type: "StripeAPIError", code: "api_error" });
/** What the SDK raises for an id the connected Stripe account does not have (a list filter names the param; a path id is "id"). */
const missingCustomer = (id: string, param = "customer") =>
  Object.assign(new Error(`No such customer: '${id}'`), { type: "StripeInvalidRequestError", code: "resource_missing", param, statusCode: 404 });
const invoice = (id: string, created: number, extra: Record<string, unknown> = {}) => ({
  id, number: `ACCT-${id}`, status: "paid", amount_paid: 4900, amount_due: 0, currency: "usd", created,
  period_start: created, period_end: created + 30 * 86400, description: null,
  hosted_invoice_url: `https://invoice.stripe.com/i/${id}`, invoice_pdf: `https://pay.stripe.com/invoice/${id}/pdf`,
  lines: { data: [{ description: "Pro plan (monthly)" }] }, ...extra,
});
const paidSession = (id: string, created: number, metadata: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id, mode: "payment", payment_status: "paid", status: "complete", amount_total: 19900, currency: "usd", created, metadata,
  line_items: { data: [{ description: "Master Class — Permits 101" }] },
  payment_intent: { id: `pi_${id}`, latest_charge: { id: `ch_${id}`, receipt_url: `https://pay.stripe.com/receipts/${id}` } },
  ...extra,
});

describe("request parsing", () => {
  it("defaults and clamps the page size, and only accepts a Stripe-style cursor", () => {
    expect(parsePage({})).toEqual({ limit: PAGE_DEFAULT, startingAfter: null });
    expect(parsePage({ limit: "abc" }).limit).toBe(PAGE_DEFAULT);
    expect(parsePage({ limit: "0" }).limit).toBe(1);
    expect(parsePage({ limit: "-5" }).limit).toBe(1);
    expect(parsePage({ limit: "5000" }).limit).toBe(PAGE_MAX);
    expect(parsePage({ limit: "7", starting_after: "in_1ABC_def" })).toEqual({ limit: 7, startingAfter: "in_1ABC_def" });
    expect(parsePage({ starting_after: "" }).startingAfter).toBeNull();
    for (const bad of ["in_1; DROP TABLE users", "x".repeat(129), ["in_1"], { id: "in_1" }]) {
      expect(() => parsePage({ starting_after: bad })).toThrow(/cursor/);
    }
  });
});

describe("Stripe object mapping", () => {
  it("stores a finalized invoice with its line summary and skips drafts", () => {
    const row = invoiceRow(7, invoice("in_map", 1_700_000_000) as any)!;
    expect(row).toMatchObject({ id: "in_map", user_id: 7, number: "ACCT-in_map", status: "paid", amount_paid: 4900, amount_due: 0, currency: "usd",
      description: "Pro plan (monthly)", hosted_invoice_url: "https://invoice.stripe.com/i/in_map", invoice_pdf: "https://pay.stripe.com/invoice/in_map/pdf" });
    expect((row.created as Date).toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect((row.period_end as Date).getTime() - (row.period_start as Date).getTime()).toBe(30 * 86400 * 1000);
    expect(invoiceRow(7, invoice("in_memo", 1_700_000_000, { description: "Memo wins" }) as any)!.description).toBe("Memo wins");
    expect(invoiceRow(7, invoice("in_nolines", 1_700_000_000, { lines: { data: [] } }) as any)!.description).toBeNull();
    expect(invoiceRow(7, invoice("in_draft", 1_700_000_000, { status: "draft" }) as any)).toBeNull();
  });
  it("classifies our own checkout metadata and keeps only paid one-off checkouts", () => {
    expect(purchaseKind({ type: "master_class", moduleId: "3" })).toBe("course");
    expect(purchaseKind({ type: "reinstatement" })).toBe("reinstatement");
    expect(purchaseKind({ type: "cart", items: JSON.stringify([{ type: "course_module" }, { type: "course_bundle" }]) })).toBe("course");
    expect(purchaseKind({ type: "cart", items: JSON.stringify([{ type: "dfy_service" }, { type: "dfy_bundle" }]) })).toBe("service");
    expect(purchaseKind({ type: "cart", items: JSON.stringify([{ type: "dfy_service" }, { type: "course_module" }]) })).toBe("other");
    expect(purchaseKind({ type: "cart", items: "not json" })).toBe("other");
    expect(purchaseKind(null)).toBe("other");
    const row = purchaseRow(7, paidSession("cs_map", 1_700_000_000, { type: "master_class" }) as any)!;
    expect(row).toMatchObject({ id: "cs_map", user_id: 7, kind: "course", description: "Master Class — Permits 101", amount: 19900, currency: "usd", receipt_url: "https://pay.stripe.com/receipts/cs_map" });
    // Description falls back to the cart's own item names; a receipt needs the expanded charge.
    const cart = purchaseRow(7, paidSession("cs_cart", 1_700_000_000, { type: "cart", items: JSON.stringify([{ type: "dfy_service", name: "GBP Setup" }]) }, { line_items: undefined, payment_intent: "pi_cs_cart" }) as any)!;
    expect(cart).toMatchObject({ kind: "service", description: "GBP Setup", receipt_url: null });
    expect(purchaseRow(7, paidSession("cs_sub", 1, {}, { mode: "subscription" }) as any)).toBeNull();
    expect(purchaseRow(7, paidSession("cs_unpaid", 1, {}, { payment_status: "unpaid" }) as any)).toBeNull();
    expect(purchaseRow(7, paidSession("cs_noamount", 1, {}, { amount_total: null }) as any)).toBeNull();
  });
  it("maps cards and bank accounts, marking only Stripe's default", () => {
    expect(paymentMethodItem({ id: "pm_card", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } } as any, "pm_card"))
      .toEqual({ id: "pm_card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, isDefault: true });
    expect(paymentMethodItem({ id: "pm_bank", type: "us_bank_account", us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789" } } as any, "pm_card"))
      .toEqual({ id: "pm_bank", brand: "STRIPE TEST BANK", last4: "6789", expMonth: null, expYear: null, isDefault: false });
    expect(paymentMethodItem({ id: "pm_other", type: "cashapp" } as any, null)).toEqual({ id: "pm_other", brand: "cashapp", last4: null, expMonth: null, expYear: null, isDefault: false });
  });
});

describe("GET /api/billing/invoices", () => {
  it("requires a signed-in account", async () => {
    expect((await call("/api/billing/invoices", null)).status).toBe(401);
    expect(mocks.invoicesList).not.toHaveBeenCalled();
  });
  it("backfills a customer's Stripe invoices once, in the contract shape, newest first", async () => {
    mocks.invoicesList
      .mockResolvedValueOnce({ data: [invoice("in_a2", 1_700_100_000), invoice("in_a1", 1_700_000_000)], has_more: true })
      .mockResolvedValueOnce({ data: [invoice("in_a0_draft", 1_699_000_000, { status: "draft" }), invoice("in_a0", 1_699_000_000, { status: "open", amount_paid: 0, amount_due: 4900 })], has_more: false });
    const first = await call("/api/billing/invoices", a);
    expect(first.status).toBe(200);
    expect(mocks.invoicesList).toHaveBeenCalledTimes(2);
    expect(mocks.invoicesList).toHaveBeenNthCalledWith(1, { customer: CUSTOMER_A, limit: 100 });
    expect(mocks.invoicesList).toHaveBeenNthCalledWith(2, { customer: CUSTOMER_A, limit: 100, starting_after: "in_a1" });
    expect(first.body.hasMore).toBe(false);
    expect(first.body.invoices.map((i: any) => i.id)).toEqual(["in_a2", "in_a1", "in_a0"]);
    expect(first.body.invoices[0]).toEqual({
      id: "in_a2", number: "ACCT-in_a2", status: "paid", amountPaid: 4900, amountDue: 0, currency: "usd",
      created: "2023-11-16T02:00:00.000Z", periodStart: "2023-11-16T02:00:00.000Z", periodEnd: "2023-12-16T02:00:00.000Z",
      description: "Pro plan (monthly)", hostedInvoiceUrl: "https://invoice.stripe.com/i/in_a2", invoicePdf: "https://pay.stripe.com/invoice/in_a2/pdf",
    });
    expect(first.body.invoices[2]).toMatchObject({ status: "open", amountPaid: 0, amountDue: 4900 });
    // The ledger now answers; Stripe is not asked again — not even after the process forgets it checked.
    resetBackfillMemory();
    const again = await call("/api/billing/invoices", a);
    expect(again.body.invoices).toEqual(first.body.invoices);
    expect(mocks.invoicesList).toHaveBeenCalledTimes(2);
  });
  it("answers 502 — and stores nothing — when Stripe fails, then tries again on the next load", async () => {
    mocks.invoicesList.mockRejectedValueOnce(stripeError("connection reset"));
    const failed = await call("/api/billing/invoices", c);
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ code: "provider_unavailable" });
    expect(failed.body.message).not.toContain("connection reset");
    expect((await pool.query("SELECT 1 FROM billing_invoices WHERE user_id = $1", [c])).rowCount).toBe(0);
    mocks.invoicesList.mockResolvedValueOnce({ data: [], has_more: false });
    expect((await call("/api/billing/invoices", c)).body).toEqual({ invoices: [], hasMore: false });
    expect(mocks.invoicesList).toHaveBeenCalledTimes(2);
    // Nothing on Stripe: the account is not re-asked on every page load.
    expect((await call("/api/billing/invoices", c)).body).toEqual({ invoices: [], hasMore: false });
    expect(mocks.invoicesList).toHaveBeenCalledTimes(2);
  });
  it("never asks Stripe for an account that is not a customer, or when no key is configured", async () => {
    expect((await call("/api/billing/invoices", b)).body).toEqual({ invoices: [], hasMore: false });
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      resetBackfillMemory();
      await pool.query("DELETE FROM billing_invoices WHERE user_id = $1", [c]);
      expect((await call("/api/billing/invoices", c)).body).toEqual({ invoices: [], hasMore: false });
    } finally { process.env.STRIPE_SECRET_KEY = key; }
    expect(mocks.invoicesList).not.toHaveBeenCalled();
  });
  it("reads as empty — not 502 on every load — when Stripe has no such customer, and does not re-ask", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.invoicesList.mockRejectedValueOnce(missingCustomer(CUSTOMER_C));
      const { status, body } = await call("/api/billing/invoices", c);
      expect(status).toBe(200);
      expect(body).toEqual({ invoices: [], hasMore: false });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no customer cus_ACCT_l4_c/));
      expect((await call("/api/billing/invoices", c)).body).toEqual({ invoices: [], hasMore: false });
      expect(mocks.invoicesList).toHaveBeenCalledTimes(1);
      // Any other Stripe failure is still reported, never papered over.
      resetBackfillMemory();
      mocks.invoicesList.mockRejectedValueOnce(Object.assign(new Error("No such thing"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "starting_after" }));
      expect((await call("/api/billing/invoices", c)).status).toBe(502);
    } finally { warn.mockRestore(); }
  });
  it("does not skip rows written in the same millisecond as the cursor, and pages past a row without a date", async () => {
    // Postgres keeps microseconds; a cursor that round-trips through a JS Date keeps milliseconds.
    // in_us1 (…40.000456) is the cursor; in_us0 (…40.000123) is older and must be on the next page.
    await pool.query(`INSERT INTO billing_invoices (id, user_id, status, amount_paid, amount_due, currency, created) VALUES
      ('in_us1', $1, 'paid', 100, 0, 'usd', to_timestamp(1690000000.000456)),
      ('in_us0', $1, 'paid', 100, 0, 'usd', to_timestamp(1690000000.000123)),
      ('in_undated', $1, 'paid', 100, 0, 'usd', NULL)`, [d]);
    const page1 = await call("/api/billing/invoices", d, { limit: "1" });
    expect(page1.body.invoices.map((i: any) => i.id)).toEqual(["in_us1"]);
    const page2 = await call("/api/billing/invoices", d, { limit: "1", starting_after: "in_us1" });
    expect(page2.body.invoices.map((i: any) => i.id)).toEqual(["in_us0"]);
    expect(page2.body.hasMore).toBe(true);
    const page3 = await call("/api/billing/invoices", d, { limit: "1", starting_after: "in_us0" });
    expect(page3.body).toEqual({ invoices: [expect.objectContaining({ id: "in_undated", created: null })], hasMore: false });
    expect((await call("/api/billing/invoices", d, { limit: "1", starting_after: "in_undated" })).body).toEqual({ invoices: [], hasMore: false });
    expect(mocks.invoicesList).not.toHaveBeenCalled();
  });
  it("pages newest-first inside one account and rejects another account's cursor", async () => {
    const base = 1_690_000_000;
    for (let i = 0; i < 5; i++) {
      await pool.query(`INSERT INTO billing_invoices (id, user_id, number, status, amount_paid, amount_due, currency, created)
        VALUES ($1, $2, $3, 'paid', 9900, 0, 'usd', to_timestamp($4))`, [`in_b${i}`, b, `ACCT-B-${i}`, base + i * 86400]);
    }
    // Same second as in_b4 for a tie-break check: ids sort DESC within equal timestamps.
    await pool.query(`INSERT INTO billing_invoices (id, user_id, status, amount_paid, amount_due, currency, created)
      VALUES ('in_b4_tie', $1, 'paid', 100, 0, 'usd', to_timestamp($2))`, [b, base + 4 * 86400]);
    const page1 = await call("/api/billing/invoices", b, { limit: "2" });
    expect(page1.body).toMatchObject({ hasMore: true });
    expect(page1.body.invoices.map((i: any) => i.id)).toEqual(["in_b4_tie", "in_b4"]);
    const page2 = await call("/api/billing/invoices", b, { limit: "2", starting_after: "in_b4" });
    expect(page2.body.invoices.map((i: any) => i.id)).toEqual(["in_b3", "in_b2"]);
    expect(page2.body.hasMore).toBe(true);
    const page3 = await call("/api/billing/invoices", b, { limit: "2", starting_after: "in_b2" });
    expect(page3.body).toEqual({ invoices: [expect.objectContaining({ id: "in_b1" }), expect.objectContaining({ id: "in_b0" })], hasMore: false });
    expect(page3.body.invoices[0].number).toBe("ACCT-B-1");
    // Isolation: A's ids never appear for B, and A's invoice is not a cursor B can use.
    const all = await call("/api/billing/invoices", b, { limit: "100" });
    expect(all.body.invoices.map((i: any) => i.id)).not.toContain("in_a2");
    const foreign = await call("/api/billing/invoices", b, { starting_after: "in_a2" });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ code: "bad_cursor" });
    expect((await call("/api/billing/invoices", b, { starting_after: "in_1; DROP TABLE users" })).status).toBe(400);
    // A continuation page never triggers a backfill.
    expect(mocks.invoicesList).not.toHaveBeenCalled();
  });
});

describe("GET /api/billing/payment-methods", () => {
  it("requires a signed-in account and lists nothing for a non-customer without asking Stripe", async () => {
    expect((await call("/api/billing/payment-methods", null)).status).toBe(401);
    expect((await call("/api/billing/payment-methods", b)).body).toEqual({ methods: [] });
    expect(mocks.customersRetrieve).not.toHaveBeenCalled();
    expect(mocks.listPaymentMethods).not.toHaveBeenCalled();
  });
  it("lists the customer's saved methods from Stripe with the default flagged", async () => {
    mocks.customersRetrieve.mockResolvedValueOnce({ id: CUSTOMER_A, invoice_settings: { default_payment_method: { id: "pm_default" } } });
    mocks.listPaymentMethods.mockResolvedValueOnce({ data: [
      { id: "pm_old", type: "card", card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2027 } },
      { id: "pm_default", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } },
      { id: "pm_bank", type: "us_bank_account", us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789" } },
    ] });
    const { status, body } = await call("/api/billing/payment-methods", a);
    expect(status).toBe(200);
    expect(mocks.customersRetrieve).toHaveBeenCalledWith(CUSTOMER_A);
    expect(mocks.listPaymentMethods).toHaveBeenCalledWith(CUSTOMER_A, { limit: 100 });
    expect(body).toEqual({ methods: [
      { id: "pm_old", brand: "mastercard", last4: "4444", expMonth: 1, expYear: 2027, isDefault: false },
      { id: "pm_default", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, isDefault: true },
      { id: "pm_bank", brand: "STRIPE TEST BANK", last4: "6789", expMonth: null, expYear: null, isDefault: false },
    ] });
    expect(JSON.stringify(body)).not.toMatch(/4242\d{12}|cvc|fingerprint/);
  });
  it("flags the current subscription's own default ahead of the customer-level one (what Checkout actually sets)", async () => {
    const methods = [
      { id: "pm_customer_default", type: "card", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2031 } },
      { id: "pm_sub_default", type: "card", card: { brand: "amex", last4: "2222", exp_month: 2, exp_year: 2032 } },
    ];
    mocks.customersRetrieve.mockResolvedValue({ id: CUSTOMER_A, invoice_settings: { default_payment_method: "pm_customer_default" } });
    mocks.listPaymentMethods.mockResolvedValue({ data: methods });
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({ id: SUBSCRIPTION_A, status: "active", default_payment_method: "pm_sub_default" });
    expect((await call("/api/billing/payment-methods", a)).body.methods.map((m: any) => [m.id, m.isDefault]))
      .toEqual([["pm_customer_default", false], ["pm_sub_default", true]]);
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_A);
    // An ended subscription, or one Stripe no longer has, leaves the customer-level default in charge.
    mocks.subscriptionsRetrieve.mockResolvedValueOnce({ id: SUBSCRIPTION_A, status: "canceled", default_payment_method: "pm_sub_default" });
    expect((await call("/api/billing/payment-methods", a)).body.methods.map((m: any) => [m.id, m.isDefault]))
      .toEqual([["pm_customer_default", true], ["pm_sub_default", false]]);
    mocks.subscriptionsRetrieve.mockRejectedValueOnce(Object.assign(new Error("No such subscription"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "id" }));
    expect((await call("/api/billing/payment-methods", a)).body.methods.map((m: any) => [m.id, m.isDefault]))
      .toEqual([["pm_customer_default", true], ["pm_sub_default", false]]);
    mocks.customersRetrieve.mockReset();
    mocks.listPaymentMethods.mockReset();
  });
  it("lists nothing when Stripe has no such customer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.customersRetrieve.mockRejectedValueOnce(missingCustomer(CUSTOMER_A, "id"));
      mocks.listPaymentMethods.mockRejectedValueOnce(missingCustomer(CUSTOMER_A, "id"));
      const { status, body } = await call("/api/billing/payment-methods", a);
      expect(status).toBe(200);
      expect(body).toEqual({ methods: [] });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it("treats a deleted customer as having no methods and a Stripe failure as 502", async () => {
    mocks.customersRetrieve.mockResolvedValueOnce({ id: CUSTOMER_A, deleted: true });
    mocks.listPaymentMethods.mockResolvedValueOnce({ data: [{ id: "pm_x", type: "card", card: { brand: "visa", last4: "0000", exp_month: 1, exp_year: 2030 } }] });
    expect((await call("/api/billing/payment-methods", a)).body).toEqual({ methods: [] });
    mocks.customersRetrieve.mockRejectedValueOnce(stripeError("rate limited"));
    mocks.listPaymentMethods.mockResolvedValueOnce({ data: [] });
    const failed = await call("/api/billing/payment-methods", a);
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ code: "provider_unavailable" });
  });
});

describe("GET /api/billing/purchases", () => {
  it("requires a signed-in account", async () => {
    expect((await call("/api/billing/purchases", null)).status).toBe(401);
  });
  it("backfills paid one-off checkouts from Stripe with kind, description and receipt", async () => {
    mocks.sessionsList.mockResolvedValueOnce({ has_more: false, data: [
      paidSession("cs_course", 1_700_300_000, { type: "master_class", moduleId: "3" }),
      paidSession("cs_service", 1_700_200_000, { type: "cart", items: JSON.stringify([{ type: "dfy_service", name: "GBP Setup" }]) }, { line_items: { data: [{ description: "GBP Setup" }] }, amount_total: 49900 }),
      paidSession("cs_mixed", 1_700_100_000, { type: "cart", items: JSON.stringify([{ type: "dfy_service", name: "GBP Setup" }, { type: "course_bundle", name: "Bundle" }]) }, { line_items: { data: [{ description: "GBP Setup" }, { description: "Bundle" }] }, amount_total: 99900 }),
      paidSession("cs_reinstate", 1_700_000_000, { type: "reinstatement" }, { line_items: { data: [{ description: "Reinstatement fee" }] }, amount_total: 2500, payment_intent: "pi_plain" }),
      paidSession("cs_plan", 1_700_400_000, { type: "plan" }, { mode: "subscription" }),
      paidSession("cs_abandoned", 1_700_400_000, { type: "master_class" }, { payment_status: "unpaid" }),
    ] });
    const { status, body } = await call("/api/billing/purchases", a);
    expect(status).toBe(200);
    expect(mocks.sessionsList).toHaveBeenCalledWith({ customer: CUSTOMER_A, status: "complete", limit: 100, expand: ["data.line_items", "data.payment_intent.latest_charge"] });
    expect(body.hasMore).toBe(false);
    expect(body.purchases).toEqual([
      { id: "cs_course", kind: "course", description: "Master Class — Permits 101", amount: 19900, currency: "usd", created: "2023-11-18T09:33:20.000Z", receiptUrl: "https://pay.stripe.com/receipts/cs_course" },
      { id: "cs_service", kind: "service", description: "GBP Setup", amount: 49900, currency: "usd", created: "2023-11-17T05:46:40.000Z", receiptUrl: "https://pay.stripe.com/receipts/cs_service" },
      { id: "cs_mixed", kind: "other", description: "GBP Setup, Bundle", amount: 99900, currency: "usd", created: "2023-11-16T02:00:00.000Z", receiptUrl: "https://pay.stripe.com/receipts/cs_mixed" },
      { id: "cs_reinstate", kind: "reinstatement", description: "Reinstatement fee", amount: 2500, currency: "usd", created: "2023-11-14T22:13:20.000Z", receiptUrl: null },
    ]);
    resetBackfillMemory();
    expect((await call("/api/billing/purchases", a)).body.purchases).toEqual(body.purchases);
    expect(mocks.sessionsList).toHaveBeenCalledTimes(1);
  });
  it("keeps the webhook's row when a backfilled checkout already exists, and answers 502 on a Stripe failure", async () => {
    // C's ledger is empty; a webhook row lands between the count and the insert → the webhook's values stay.
    mocks.sessionsList.mockImplementationOnce(async () => {
      await pool.query(`INSERT INTO billing_purchases (id, user_id, kind, description, amount, currency, created, receipt_url)
        VALUES ('cs_c_webhook', $1, 'service', 'From the webhook', 100, 'usd', to_timestamp(1700000000), 'https://pay.stripe.com/receipts/webhook')`, [c]);
      return { has_more: false, data: [paidSession("cs_c_webhook", 1_700_000_000, { type: "cart", items: "[]" }, { amount_total: 999 })] };
    });
    const { body } = await call("/api/billing/purchases", c);
    expect(body.purchases).toEqual([{ id: "cs_c_webhook", kind: "service", description: "From the webhook", amount: 100, currency: "usd", created: "2023-11-14T22:13:20.000Z", receiptUrl: "https://pay.stripe.com/receipts/webhook" }]);
    await pool.query("DELETE FROM billing_purchases WHERE user_id = $1", [c]);
    resetBackfillMemory();
    mocks.sessionsList.mockRejectedValueOnce(stripeError("boom"));
    const failed = await call("/api/billing/purchases", c);
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ code: "provider_unavailable" });
    // A customer id Stripe does not have: no purchases, not a broken tab.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetBackfillMemory();
      mocks.sessionsList.mockRejectedValueOnce(missingCustomer(CUSTOMER_C));
      expect((await call("/api/billing/purchases", c)).body).toEqual({ purchases: [], hasMore: false });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it("pages inside one account and rejects another account's cursor", async () => {
    for (let i = 0; i < 3; i++) {
      await pool.query(`INSERT INTO billing_purchases (id, user_id, kind, description, amount, currency, created)
        VALUES ($1, $2, 'course', $3, 10000, 'usd', to_timestamp($4))`, [`cs_b${i}`, b, `ACCT-B purchase ${i}`, 1_690_000_000 + i * 3600]);
    }
    const page1 = await call("/api/billing/purchases", b, { limit: "2" });
    expect(page1.body.purchases.map((p: any) => p.id)).toEqual(["cs_b2", "cs_b1"]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await call("/api/billing/purchases", b, { limit: "2", starting_after: "cs_b1" });
    expect(page2.body).toEqual({ purchases: [{ id: "cs_b0", kind: "course", description: "ACCT-B purchase 0", amount: 10000, currency: "usd", created: "2023-07-22T04:26:40.000Z", receiptUrl: null }], hasMore: false });
    expect((await call("/api/billing/purchases", b, { limit: "100" })).body.purchases.map((p: any) => p.id)).not.toContain("cs_course");
    const foreign = await call("/api/billing/purchases", b, { starting_after: "cs_course" });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ code: "bad_cursor" });
    expect(mocks.sessionsList).not.toHaveBeenCalled();
  });
});

describe("ledger schema", () => {
  it("is the foundation's DDL — the same statements, same index names — so either boot order yields one table", async () => {
    // ONE definition: server/account/schema.ts. The invoice/purchase tables carry no NOT NULL the webhook
    // writer never agreed to, and each table has exactly one user index under the foundation's name.
    const { BILLING_LEDGER_DDL: foundation } = await import("./schema");
    expect(BILLING_LEDGER_DDL).toBe(foundation);
    const invoicesAndPurchases = BILLING_LEDGER_DDL.filter((s) => /billing_(invoices|purchases)/.test(s) && s.startsWith("CREATE TABLE"));
    expect(invoicesAndPurchases.join("\n")).not.toMatch(/NOT NULL|DEFAULT now\(\)/);
    expect(BILLING_LEDGER_DDL.filter((s) => s.startsWith("CREATE INDEX")).map((s) => s.match(/EXISTS (\w+)/)![1]))
      .toEqual(["billing_events_user_idx", "billing_invoices_user_idx", "billing_purchases_user_idx"]);
  });
  it("is idempotent", async () => {
    await expect(ensureBillingLedgerSchema()).resolves.toBeUndefined();
    const { rows } = await pool.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN ('billing_invoices','billing_purchases') ORDER BY 1, 2`);
    const columnsOf = (table: string) => rows.filter((r: any) => r.table_name === table).map((r: any) => r.column_name);
    expect(columnsOf("billing_invoices")).toEqual(["amount_due", "amount_paid", "created", "currency", "description", "hosted_invoice_url", "id", "invoice_pdf", "number", "period_end", "period_start", "status", "user_id"]);
    expect(columnsOf("billing_purchases")).toEqual(["amount", "created", "currency", "description", "id", "kind", "receipt_url", "user_id"]);
  });
});
