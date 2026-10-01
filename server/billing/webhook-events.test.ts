import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The Stripe webhook's billing ledger and events: invoices, one-time
// purchases, trial / cancellation notices, idempotency per event id, and the
// Stripe backfill — with Stripe and the database mocked. No real Stripe call,
// no real email.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";

const mocks = vi.hoisted(() => ({
  /** drizzle select results, consumed in order. */
  rows: [] as any[][],
  updates: [] as any[],
  inserts: [] as any[],
  /** Plain-SQL statements on the pool, in order. */
  sql: [] as { text: string; values: any[] }[],
  /** stripe_customer_id → user_id (the subscriptions table, as the ledger reads it). */
  customers: new Map<string, number>(),
  /** Event ids the ledger already holds. */
  seen: new Set<string>(),
  /** Invoice ids the ledger already holds as paid/void (an open snapshot of them is stale: the upsert writes nothing). */
  settledInvoices: new Set<string>(),
  cancelRow: {} as Record<string, unknown>,
  /** (session, item) keys already in course_purchases / service_purchases — the unique fulfilment indexes, emulated. */
  granted: new Set<string>(),
  /** Make the next purchase-row INSERT fail (a database error mid-fulfilment). */
  failPurchaseInsert: false,
  verify: vi.fn(),
  retrieve: vi.fn(),
  paymentIntent: vi.fn(),
  lineItems: vi.fn(),
  invoicesList: vi.fn(),
  sessionsList: vi.fn(),
}));
vi.mock("stripe", () => ({ default: class {
  webhooks = { constructEvent: mocks.verify };
  subscriptions = { retrieve: mocks.retrieve };
  paymentIntents = { retrieve: mocks.paymentIntent };
  checkout = { sessions: { listLineItems: mocks.lineItems, list: mocks.sessionsList } };
  invoices = { list: mocks.invoicesList };
} }));
vi.mock("../db", () => {
  const next = () => mocks.rows.shift() || [];
  const where = () => ({ limit: async () => next(), then: (ok: any, fail: any) => Promise.resolve(next()).then(ok, fail) });
  return {
    db: {
      select: () => ({ from: () => ({ where }) }),
      update: () => ({ set: (set: any) => ({ where: async () => { mocks.updates.push(set); } }) }),
      insert: () => ({ values: async (values: any) => { mocks.inserts.push(values); } }),
    },
    pool: {
      query: async (text: string, values: any[] = []) => {
        if (/information_schema\.columns/.test(text)) return { rows: [{}, {}, {}, {}, {}] };
        if (/information_schema\.tables/.test(text)) return { rows: [{}, {}, {}] };
        if (/FROM pg_indexes/.test(text)) return { rows: [{}, {}] };
        mocks.sql.push({ text, values });
        if (/SELECT cancel_at_period_end/.test(text)) return { rows: [mocks.cancelRow] };
        // Purchase fulfilment rows (server/billing/fulfilment.ts): ON CONFLICT DO NOTHING on (session, item) emulated with a Set,
        // captured in the shape the old drizzle inserts had; a test can make the INSERT fail like a database would.
        if (/INSERT INTO (course|service)_purchases/.test(text)) {
          if (mocks.failPurchaseInsert) { mocks.failPurchaseInsert = false; throw new Error("injected: purchase row could not be written"); }
          const course = /course_purchases/.test(text);
          const key = course ? `course:${values[3]}:${values[1] ?? 0}:${values[2]}` : `service:${values[4]}:${values[1]}`;
          if (mocks.granted.has(key)) return { rows: [] };
          mocks.granted.add(key);
          mocks.inserts.push(course
            ? { userId: values[0], moduleId: values[1], isBundle: values[2], stripeSessionId: values[3] }
            : { userId: values[0], serviceType: values[1], serviceName: values[2], price: values[3], stripeSessionId: values[4] });
          return { rows: [{ id: mocks.inserts.length }] };
        }
        if (/INSERT INTO billing_events/.test(text)) {
          if (mocks.seen.has(values[0])) return { rows: [] };
          mocks.seen.add(values[0]);
          return { rows: [{ stripe_event_id: values[0] }] };
        }
        if (/DELETE FROM billing_events/.test(text)) { mocks.seen.delete(values[0]); return { rows: [] }; }
        if (/INSERT INTO billing_invoices/.test(text)) {
          const stale = mocks.settledInvoices.has(values[0]) && ["draft", "open"].includes(values[3]);
          return { rows: stale ? [] : [{ id: values[0] }] };
        }
        if (/SELECT user_id FROM subscriptions WHERE stripe_customer_id/.test(text)) {
          const userId = mocks.customers.get(values[0]);
          return { rows: userId ? [{ user_id: userId }] : [] };
        }
        if (/SELECT stripe_customer_id FROM subscriptions WHERE user_id/.test(text)) {
          const found = [...mocks.customers.entries()].find(([, u]) => u === values[0]);
          return { rows: found ? [{ stripe_customer_id: found[0] }] : [] };
        }
        if (/count\(\*\)::int AS n FROM billing_invoices/.test(text)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      },
      // Fulfilment writes a session's rows in one transaction on a dedicated client: the same mock answers it.
      async connect() { return { query: this.query, release() {} }; },
    },
  };
});
vi.mock("../auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8332" }));
vi.mock("../crm/beta", () => ({ isBetaUser: async () => false }));
vi.mock("../account-security", () => ({ requireRecentAuth: () => true }));

import { registerStripeRoutes } from "../stripe";
import { billingEvents } from "./events";
import { resetPriceCache } from "./prices";
import {
  cancellationChange, planOf,
} from "./webhook-events";
import {
  invoiceRowFromStripe, invoiceSubscriptionId, invoiceUserIdHint, purchaseKindFor, listInvoicesFromStripe,
  ensureInvoicesBackfilled, resetBackfillMemo, listPurchasesFromStripe, purchaseRowFromSession,
} from "./invoices";

const routes = new Map<string, Function>();
registerStripeRoutes({
  get: () => {},
  post: (path: string, handler: Function) => routes.set(path, handler),
} as any);

let eventSeq = 0;
async function webhook(event: any) {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
  event.id ??= `evt_test_${++eventSeq}`;
  mocks.verify.mockReturnValue(event);
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; } };
  await routes.get("/api/stripe/webhook")!({ headers: { "stripe-signature": "t=1,v1=mock" }, rawBody: Buffer.from("{}"), body: {} }, res);
  return res;
}

const sqlOf = (re: RegExp) => mocks.sql.filter((q) => re.test(q.text));
const invoiceUpserts = () => sqlOf(/INSERT INTO billing_invoices/).map((q) => q.values);
const purchaseUpserts = () => sqlOf(/INSERT INTO billing_purchases/).map((q) => q.values);
const attributions = () => sqlOf(/UPDATE billing_events SET user_id/).map((q) => q.values);

/** A listener for one kind, returning what it received. */
function capture(kind: any) {
  const fn = vi.fn();
  billingEvents.on(kind, fn);
  return fn;
}

/** A Stripe subscription item on a price we created (role metadata). */
function item(id: string, priceId: string, quantity = 1, role?: { kind: string; key?: string }, interval = "month") {
  return {
    id, quantity,
    price: { id: priceId, recurring: { interval }, metadata: role ? { chub_kind: role.kind, chub_key: role.key ?? "", chub_interval: interval } : {} },
  };
}
const proMonthly = (extra: any = {}) => ({
  id: "sub_live", customer: "cus_42", status: "active", cancel_at_period_end: false, cancel_at: null, trial_end: null,
  items: { data: [{ current_period_end: 1893456000, ...item("si_plan", "price_pro_m", 1, { kind: "plan", key: "pro" }) }] },
  ...extra,
});
const liveRow = (extra: any = {}) => ({ id: 5, userId: 42, stripeCustomerId: "cus_42", stripeSubscriptionId: "sub_live", plan: "pro", status: "active", ...extra });

const stripeInvoice = (extra: any = {}) => ({
  id: "in_1", object: "invoice", customer: "cus_42", number: "CHUB-0001", status: "paid", amount_paid: 7900, amount_due: 0,
  currency: "usd", created: 1700000000, period_start: 1700000000, period_end: 1702592000, description: null,
  hosted_invoice_url: "https://invoice.stripe.com/i/in_1", invoice_pdf: "https://pay.stripe.com/invoice/in_1/pdf",
  lines: { data: [{ description: "1 × Pro (at $79.00 / month)" }] },
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_live", metadata: { userId: "42" } } },
  attempt_count: 1, next_payment_attempt: null, metadata: {},
  ...extra,
});

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  mocks.sql.length = 0;
  mocks.granted.clear();
  mocks.failPurchaseInsert = false;
  mocks.customers.clear();
  mocks.customers.set("cus_42", 42);
  mocks.seen.clear();
  mocks.settledInvoices.clear();
  mocks.cancelRow = {};
  mocks.verify.mockReset();
  mocks.retrieve.mockReset();
  mocks.paymentIntent.mockReset().mockResolvedValue({ id: "pi_1", latest_charge: { id: "ch_1", receipt_url: "https://pay.stripe.com/receipts/ch_1" } });
  mocks.lineItems.mockReset().mockResolvedValue({ data: [{ description: "ConstructHUB Master Class — Permits 101" }] });
  mocks.invoicesList.mockReset();
  mocks.sessionsList.mockReset();
  billingEvents.removeAllListeners();
  resetPriceCache();
  resetBackfillMemo();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("invoice events → billing_invoices + billingEvents", () => {
  it("invoice.paid stores the invoice for the customer's account and emits invoice.paid with the row", async () => {
    const paid = capture("invoice.paid");
    const res = await webhook({ id: "evt_paid_1", type: "invoice.paid", data: { object: stripeInvoice() } });
    expect(res.body).toEqual({ received: true });
    expect(invoiceUpserts()).toEqual([[
      "in_1", 42, "CHUB-0001", "paid", 7900, 0, "usd", new Date(1700000000 * 1000), new Date(1702592000 * 1000),
      "1 × Pro (at $79.00 / month)", "https://invoice.stripe.com/i/in_1", "https://pay.stripe.com/invoice/in_1/pdf", new Date(1700000000 * 1000),
      ["paid", "void"], // the settled statuses a stale open/draft snapshot must not overwrite
    ]]);
    expect(paid).toHaveBeenCalledTimes(1);
    expect(paid.mock.calls[0][0]).toMatchObject({
      userId: 42,
      invoice: { id: "in_1", number: "CHUB-0001", amountPaid: 7900, hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1" },
      stripeInvoice: { id: "in_1" },
    });
    // The event is recorded against the account it was about.
    expect(attributions()).toEqual([["evt_paid_1", 42]]);
  });

  it("invoice.payment_failed emits the attempt count and the retry date; invoice.finalized the row", async () => {
    const failed = capture("invoice.payment_failed");
    await webhook({ type: "invoice.payment_failed", data: { object: stripeInvoice({ status: "open", amount_paid: 0, amount_due: 7900, attempt_count: 2, next_payment_attempt: 1700500000 }) } });
    expect(failed.mock.calls[0][0]).toMatchObject({ userId: 42, attemptCount: 2, nextPaymentAttempt: new Date(1700500000 * 1000), invoice: { status: "open", amountDue: 7900 } });

    const finalized = capture("invoice.finalized");
    await webhook({ type: "invoice.finalized", data: { object: stripeInvoice({ status: "open", amount_paid: 0, amount_due: 7900 }) } });
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(invoiceUpserts()).toHaveLength(2);
  });

  it("an open snapshot delivered after the invoice was paid (Stripe doesn't order deliveries) is recorded as seen but emits nothing", async () => {
    const paid = capture("invoice.paid");
    const failed = capture("invoice.payment_failed");
    const finalized = capture("invoice.finalized");
    await webhook({ id: "evt_order_1", type: "invoice.paid", data: { object: stripeInvoice() } });
    mocks.settledInvoices.add("in_1");
    const late = await webhook({ id: "evt_order_2", type: "invoice.finalized", data: { object: stripeInvoice({ status: "open", amount_paid: 0, amount_due: 7900 }) } });
    expect(late.body).toEqual({ received: true });
    const lateFailure = await webhook({ id: "evt_order_3", type: "invoice.payment_failed", data: { object: stripeInvoice({ status: "open", amount_paid: 0, amount_due: 7900, attempt_count: 1 }) } });
    expect(lateFailure.body).toEqual({ received: true });
    expect(paid).toHaveBeenCalledTimes(1);
    expect(finalized).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    // Both late events were still claimed and attributed, so a redelivery is a no-op too.
    expect(attributions()).toEqual([["evt_order_1", 42], ["evt_order_2", 42], ["evt_order_3", 42]]);
  });

  it("an invoice for a customer no account owns is not recorded and nothing is emitted (metadata alone can't attribute it)", async () => {
    const paid = capture("invoice.paid");
    const res = await webhook({ type: "invoice.paid", data: { object: stripeInvoice({ customer: "cus_unknown", parent: null, metadata: {} }) } });
    expect(res.body).toEqual({ received: true });
    expect(invoiceUpserts()).toEqual([]);
    expect(paid).not.toHaveBeenCalled();
  });

  it("an event raised on a connected account (CRM client payments) never enters the platform ledger", async () => {
    const paid = capture("invoice.paid");
    await webhook({ type: "invoice.paid", account: "acct_connected", data: { object: stripeInvoice() } });
    expect(invoiceUpserts()).toEqual([]);
    expect(paid).not.toHaveBeenCalled();
    const notice = capture("subscription.trial_will_end");
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.trial_will_end", account: "acct_connected", data: { object: proMonthly({ status: "trialing" }) } });
    expect(notice).not.toHaveBeenCalled();
  });

  it("falls back to our checkout's userId metadata when the customer isn't on a subscriptions row", async () => {
    mocks.customers.clear();
    await webhook({ type: "invoice.paid", data: { object: stripeInvoice() } });
    expect(invoiceUpserts()[0].slice(0, 2)).toEqual(["in_1", 42]);
  });

  it("maps both invoice shapes: parent.subscription_details (2025 API) and the legacy top-level subscription", () => {
    expect(invoiceSubscriptionId(stripeInvoice() as any)).toBe("sub_live");
    expect(invoiceSubscriptionId(stripeInvoice({ parent: null, subscription: "sub_legacy" }) as any)).toBe("sub_legacy");
    expect(invoiceSubscriptionId(stripeInvoice({ parent: null, subscription: { id: "sub_obj" } }) as any)).toBe("sub_obj");
    expect(invoiceUserIdHint(stripeInvoice() as any)).toBe(42);
    expect(invoiceUserIdHint(stripeInvoice({ parent: null, subscription_details: { metadata: { userId: "7" } } }) as any)).toBe(7);
    expect(invoiceUserIdHint(stripeInvoice({ parent: null, metadata: { userId: "nope" } }) as any)).toBeNull();
  });

  it("never invents values: absent Stripe fields are null, Stripe's own description wins over line items", () => {
    const row = invoiceRowFromStripe(stripeInvoice({ number: null, hosted_invoice_url: undefined, invoice_pdf: undefined, period_start: undefined, description: "Pro plan — October" }) as any, 42);
    expect(row).toMatchObject({ number: null, hostedInvoiceUrl: null, invoicePdf: null, periodStart: null, description: "Pro plan — October" });
    expect(invoiceRowFromStripe(stripeInvoice({ lines: { data: [] } }) as any, 42).description).toBeNull();
  });
});

describe("one Stripe event is processed once", () => {
  it("a redelivered event id answers 200 duplicate and touches nothing", async () => {
    const paid = capture("invoice.paid");
    await webhook({ id: "evt_dup", type: "invoice.paid", data: { object: stripeInvoice() } });
    mocks.sql.length = 0;
    const res = await webhook({ id: "evt_dup", type: "invoice.paid", data: { object: stripeInvoice() } });
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(invoiceUpserts()).toEqual([]);
    expect(paid).toHaveBeenCalledTimes(1);
  });

  it("a redelivered checkout never inserts the course purchase twice", async () => {
    const session = { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 9900, currency: "usd", created: 1700000000, payment_intent: "pi_1",
      metadata: { userId: "42", type: "master_class", moduleId: "3" } };
    await webhook({ id: "evt_course", type: "checkout.session.completed", data: { object: session } });
    await webhook({ id: "evt_course", type: "checkout.session.completed", data: { object: session } });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({ userId: 42, moduleId: 3, isBundle: false, stripeSessionId: "cs_1" });
  });

  it("a handler failure releases the claim (Stripe's retry is processed) and answers non-2xx", async () => {
    mocks.retrieve.mockRejectedValueOnce(new Error("stripe down"));
    const first = await webhook({ id: "evt_retry", type: "checkout.session.completed", data: { object: { id: "cs_sub", subscription: "sub_live", mode: "subscription", metadata: { userId: "42", type: "plan" } } } });
    expect(first.code).toBe(400);
    expect(sqlOf(/DELETE FROM billing_events/).map((q) => q.values)).toEqual([["evt_retry"]]);
    expect(mocks.seen.has("evt_retry")).toBe(false);

    mocks.retrieve.mockResolvedValueOnce(proMonthly());
    mocks.rows.push([liveRow({ stripeSubscriptionId: null, status: "inactive", plan: "free" })]);
    const second = await webhook({ id: "evt_retry", type: "checkout.session.completed", data: { object: { id: "cs_sub", subscription: "sub_live", mode: "subscription", metadata: { userId: "42", type: "plan" } } } });
    expect(second.body).toEqual({ received: true });
    expect(mocks.updates[0]).toMatchObject({ stripeSubscriptionId: "sub_live", plan: "pro" });
  });

  it("still fails closed: no signature, no claim, no processing", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; } };
    await routes.get("/api/stripe/webhook")!({ headers: {}, rawBody: Buffer.from("{}"), body: {} }, res);
    expect(res.code).toBe(400);
    expect(sqlOf(/billing_events/)).toEqual([]);
  });

  it("a body whose signature doesn't verify is rejected before any claim or handler runs", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    const paid = capture("invoice.paid");
    mocks.verify.mockImplementationOnce(() => { throw new Error("No signatures found matching the expected signature for payload"); });
    const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; } };
    await routes.get("/api/stripe/webhook")!({ headers: { "stripe-signature": "t=1,v1=forged" }, rawBody: Buffer.from("{}"), body: {} }, res);
    expect(res.code).toBe(400);
    expect(res.body.message).not.toMatch(/whsec|forged/);
    expect(sqlOf(/billing_events|billing_invoices/)).toEqual([]);
    expect(paid).not.toHaveBeenCalled();
  });
});

describe("one-time purchases → billing_purchases + purchase.completed", () => {
  const cartSession = (extra: any = {}) => ({
    id: "cs_cart", mode: "payment", payment_status: "paid", amount_total: 164900, currency: "usd", created: 1700000000, payment_intent: "pi_cart",
    metadata: {
      userId: "42", type: "cart",
      items: JSON.stringify([
        { id: "course_module_3", type: "course_module", name: "Master Class — Permits 101", price: 9900, moduleId: 3 },
        { id: "course_bundle", type: "course_bundle", name: "Master Class bundle", price: 155000, moduleId: null },
      ]),
    },
    ...extra,
  });

  it("a paid cart checkout: one purchase row keyed by the PaymentIntent, kind from the items, names from Stripe's line items, the card receipt", async () => {
    const completed = capture("purchase.completed");
    mocks.lineItems.mockResolvedValueOnce({ data: [{ description: "Master Class — Permits 101" }, { description: "Master Class bundle" }] });
    await webhook({ type: "checkout.session.completed", data: { object: cartSession() } });
    expect(mocks.inserts).toHaveLength(2); // the course rows, as before
    expect(purchaseUpserts()).toEqual([[
      "pi_cart", 42, "course", "Master Class — Permits 101, Master Class bundle", 164900, "usd", new Date(1700000000 * 1000), "https://pay.stripe.com/receipts/ch_1",
    ]]);
    expect(mocks.paymentIntent).toHaveBeenCalledWith("pi_cart", { expand: ["latest_charge"] });
    expect(completed.mock.calls[0][0]).toMatchObject({ userId: 42, purchase: { id: "pi_cart", kind: "course", amount: 164900 } });
  });

  it("when Stripe's line items or receipt can't be read, the names come from our own checkout metadata and the receipt is null — never guessed", async () => {
    mocks.lineItems.mockRejectedValueOnce(new Error("no such session"));
    mocks.paymentIntent.mockRejectedValueOnce(new Error("no such payment_intent"));
    await webhook({ type: "checkout.session.completed", data: { object: cartSession() } });
    expect(purchaseUpserts()[0]).toEqual(["pi_cart", 42, "course", "Master Class — Permits 101, Master Class bundle", 164900, "usd", new Date(1700000000 * 1000), null]);
  });

  it("a DFY cart is a service; a mixed cart is other; an SEO contract is a service; a reinstatement is itself", async () => {
    const items = (list: any[]) => ({ metadata: { userId: "42", type: "cart", items: JSON.stringify(list) } });
    expect(purchaseKindFor(cartSession(items([{ type: "dfy_service" }, { type: "dfy_bundle" }])) as any)).toBe("service");
    expect(purchaseKindFor(cartSession(items([{ type: "dfy_service" }, { type: "course_module" }])) as any)).toBe("other");
    expect(purchaseKindFor(cartSession({ metadata: { userId: "42", type: "cart", items: "not json" } }) as any)).toBe("other");
    expect(purchaseKindFor({ metadata: { userId: "42", type: "seo_contract" } } as any)).toBe("service");
    expect(purchaseKindFor({ metadata: { userId: "42", type: "reinstatement" } } as any)).toBe("reinstatement");
    expect(purchaseKindFor({ metadata: { userId: "42", type: "master_class" } } as any)).toBe("course");
    expect(purchaseKindFor({ metadata: { userId: "42" } } as any)).toBe("other");
  });

  it("an SEO contract checkout (not handled before) is recorded as a service purchase without touching course rows", async () => {
    mocks.lineItems.mockResolvedValueOnce({ data: [{ description: "ConstructHUB Local SEO — 12-Month Agreement, paid in full" }] });
    await webhook({ type: "checkout.session.completed", data: { object: {
      id: "cs_seo", mode: "payment", payment_status: "paid", amount_total: 480000, currency: "usd", created: 1700000000, payment_intent: "pi_seo",
      metadata: { userId: "42", type: "seo_contract", contractId: "9", packageId: "local_seo" },
    } } });
    expect(mocks.inserts).toHaveLength(0);
    expect(purchaseUpserts()[0].slice(0, 5)).toEqual(["pi_seo", 42, "service", "ConstructHUB Local SEO — 12-Month Agreement, paid in full", 480000]);
  });

  it("F08: a bank-debit checkout completes unpaid — nothing granted, no purchase — until async_payment_succeeded grants and records it, once", async () => {
    const completed = capture("purchase.completed");
    await webhook({ type: "checkout.session.completed", data: { object: cartSession({ payment_status: "unpaid" }) } });
    expect(mocks.inserts).toEqual([]); // no course row from the metadata alone
    expect(purchaseUpserts()).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
    await webhook({ type: "checkout.session.async_payment_succeeded", data: { object: cartSession({ payment_status: "paid" }) } });
    expect(mocks.inserts).toEqual([
      { userId: 42, moduleId: 3, isBundle: false, stripeSessionId: "cs_cart" },
      { userId: 42, moduleId: null, isBundle: true, stripeSessionId: "cs_cart" },
    ]);
    expect(purchaseUpserts()).toHaveLength(1);
    expect(completed).toHaveBeenCalledTimes(1);
    // The same session again under new event ids (a redelivery; the completed event, late and now
    // paid): the (session, item) identity — not the event id — keeps it to one row per item.
    await webhook({ type: "checkout.session.async_payment_succeeded", data: { object: cartSession({ payment_status: "paid" }) } });
    await webhook({ type: "checkout.session.completed", data: { object: cartSession({ payment_status: "paid" }) } });
    expect(mocks.inserts).toHaveLength(2);
  });

  it("F08: async_payment_failed grants nothing and records nothing; the event is attributed to the account", async () => {
    const completed = capture("purchase.completed");
    const res = await webhook({ type: "checkout.session.async_payment_failed", data: { object: cartSession({ payment_status: "unpaid" }) } });
    expect(res.body).toEqual({ received: true });
    expect(mocks.inserts).toEqual([]);
    expect(purchaseUpserts()).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
    expect(attributions()).toEqual([[expect.any(String), 42]]);
  });

  it("F09: a purchase row that can't be written fails the webhook — rolled back, claim released, nothing recorded — and the retry grants once", async () => {
    const completed = capture("purchase.completed");
    mocks.failPurchaseInsert = true;
    const first = await webhook({ id: "evt_cart_fail", type: "checkout.session.completed", data: { object: cartSession() } });
    expect(first.code).toBe(400);
    expect(first.body.message).toMatch(/injected/);
    expect(sqlOf(/^ROLLBACK$/)).toHaveLength(1);
    expect(mocks.inserts).toEqual([]);
    expect(purchaseUpserts()).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
    expect(mocks.seen.has("evt_cart_fail")).toBe(false);
    // Stripe retries the same event id: processed (not a duplicate), every item granted once, then the ledger and the receipt event.
    const second = await webhook({ id: "evt_cart_fail", type: "checkout.session.completed", data: { object: cartSession() } });
    expect(second.body).toEqual({ received: true });
    expect(sqlOf(/^COMMIT$/)).toHaveLength(1);
    expect(mocks.inserts).toHaveLength(2);
    expect(purchaseUpserts()).toHaveLength(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("a subscription checkout is not a purchase (its invoice is), and a session without our userId is ignored", async () => {
    expect(await purchaseRowFromSession({ id: "cs", mode: "subscription", payment_status: "paid", metadata: { userId: "42" } } as any, 42)).toBeNull();
    const completed = capture("purchase.completed");
    await webhook({ type: "checkout.session.completed", data: { object: cartSession({ metadata: { invoiceId: "crm-inv", orgId: "org" } }) } });
    expect(purchaseUpserts()).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
  });

  it("a master-class module checkout names the module from the database when line items are unavailable", async () => {
    mocks.lineItems.mockRejectedValueOnce(new Error("unavailable"));
    mocks.rows.push([{ id: 3, title: "Permits 101" }]);
    await webhook({ type: "checkout.session.completed", data: { object: {
      id: "cs_mod", mode: "payment", payment_status: "paid", amount_total: 9900, currency: "usd", created: 1700000000, payment_intent: null,
      metadata: { userId: "42", type: "master_class", moduleId: "3" },
    } } });
    // No PaymentIntent on the session: the row is keyed by the session id and has no receipt to show.
    expect(purchaseUpserts()[0]).toEqual(["cs_mod", 42, "course", "Master Class — Permits 101", 9900, "usd", new Date(1700000000 * 1000), null]);
    expect(mocks.paymentIntent).not.toHaveBeenCalled();
  });
});

describe("subscription lifecycle events", () => {
  it("a plan checkout emits subscription.started with the plan, interval, trial end and period end", async () => {
    const started = capture("subscription.started");
    mocks.retrieve.mockResolvedValueOnce(proMonthly({ status: "trialing", trial_end: 1700086400 }));
    mocks.rows.push([liveRow({ stripeSubscriptionId: null, status: "inactive", plan: "free" })]);
    await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_sub", subscription: "sub_live", mode: "subscription", metadata: { userId: "42", type: "plan" } } } });
    expect(started.mock.calls[0][0]).toEqual({
      userId: 42, subscriptionId: "sub_live", plan: "pro", status: "trialing", interval: "month",
      trialEnd: new Date(1700086400 * 1000), currentPeriodEnd: new Date(1893456000 * 1000),
    });
    expect(purchaseUpserts()).toEqual([]);
  });

  it("customer.subscription.trial_will_end emits subscription.trial_will_end for the customer's account", async () => {
    const notice = capture("subscription.trial_will_end");
    mocks.rows.push([liveRow({ status: "trialing" })]);
    await webhook({ id: "evt_trial", type: "customer.subscription.trial_will_end", data: { object: proMonthly({ status: "trialing", trial_end: 1700086400 }) } });
    expect(notice.mock.calls[0][0]).toEqual({ userId: 42, subscriptionId: "sub_live", plan: "pro", status: "trialing", trialEnd: new Date(1700086400 * 1000) });
    expect(attributions()).toEqual([["evt_trial", 42]]);

    mocks.customers.clear();
    mocks.rows.push([]);
    await webhook({ type: "customer.subscription.trial_will_end", data: { object: proMonthly({ customer: "cus_nobody", metadata: {} }) } });
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it("a cancellation set in the billing portal emits subscription.cancel_scheduled with the end date; undoing it emits cancel_resumed", async () => {
    const scheduled = capture("subscription.cancel_scheduled");
    const resumed = capture("subscription.cancel_resumed");
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.updated", data: {
      object: proMonthly({ cancel_at_period_end: true, cancel_at: 1893456000 }),
      previous_attributes: { cancel_at_period_end: false, cancel_at: null },
    } });
    expect(scheduled.mock.calls[0][0]).toEqual({ userId: 42, subscriptionId: "sub_live", plan: "pro", status: "active", cancelAt: new Date(1893456000 * 1000) });
    expect(resumed).not.toHaveBeenCalled();

    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.updated", data: {
      object: proMonthly(),
      previous_attributes: { cancel_at_period_end: true, cancel_at: 1893456000 },
    } });
    expect(resumed.mock.calls[0][0]).toEqual({ userId: 42, subscriptionId: "sub_live", plan: "pro", status: "active" });
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("an update that changed something else (no cancel fields in previous_attributes) emits no cancellation notice", async () => {
    const scheduled = capture("subscription.cancel_scheduled");
    mocks.rows.push([liveRow()]);
    mocks.cancelRow = { cancel_at_period_end: true, cancel_at: new Date(1893456000 * 1000) };
    await webhook({ type: "customer.subscription.updated", data: { object: proMonthly({ cancel_at_period_end: true }), previous_attributes: { metadata: {} } } });
    expect(scheduled).not.toHaveBeenCalled();
    // Stripe updating only the cancellation feedback on an already-scheduled
    // cancellation is not a second scheduling.
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.updated", data: {
      object: proMonthly({ cancel_at_period_end: true, cancel_at: 1893456000, cancellation_details: { comment: "too pricey", feedback: "too_expensive", reason: "cancellation_requested" } }),
      previous_attributes: { cancellation_details: { comment: null, feedback: null } },
    } });
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("without previous_attributes the stored state decides: false→true schedules, unknown (never synced) emits nothing", () => {
    const sub = proMonthly({ cancel_at_period_end: true }) as any;
    expect(cancellationChange(sub, undefined, { cancelAtPeriodEnd: false, cancelAt: null })).toBe("scheduled");
    expect(cancellationChange(sub, undefined, { cancelAtPeriodEnd: true, cancelAt: null })).toBeNull();
    expect(cancellationChange(sub, undefined, { cancelAtPeriodEnd: null, cancelAt: null })).toBeNull();
    expect(cancellationChange(sub, undefined, null)).toBeNull();
    expect(cancellationChange(proMonthly() as any, undefined, { cancelAtPeriodEnd: true, cancelAt: null })).toBe("resumed");
    expect(cancellationChange(proMonthly() as any, { cancel_at_period_end: false }, null)).toBeNull();
    // A cancel_at moved to another date is still "scheduled" (the date changed).
    expect(cancellationChange(sub, { cancel_at: 1800000000 }, null)).toBe("scheduled");
  });

  it("an event for a subscription the account isn't on emits nothing", async () => {
    const scheduled = capture("subscription.cancel_scheduled");
    const canceled = capture("subscription.canceled");
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.updated", data: { object: proMonthly({ id: "sub_stray", cancel_at_period_end: true }), previous_attributes: { cancel_at_period_end: false } } });
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.deleted", data: { object: proMonthly({ id: "sub_stray", status: "canceled" }) } });
    expect(scheduled).not.toHaveBeenCalled();
    expect(canceled).not.toHaveBeenCalled();
  });

  it("deleting the tracked subscription emits subscription.canceled with the plan that ended", async () => {
    const canceled = capture("subscription.canceled");
    mocks.rows.push([liveRow({ plan: "growth" })]);
    await webhook({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_live", customer: "cus_42", status: "canceled" } } });
    expect(mocks.updates[0]).toMatchObject({ status: "canceled", plan: "free" });
    expect(canceled.mock.calls[0][0]).toEqual({ userId: 42, subscriptionId: "sub_live", plan: "growth", status: "canceled" });
    expect(attributions()).toEqual([["evt_del", 42]]);
  });

  it("planOf reads our price metadata and falls back to the stored plan for a legacy price", () => {
    expect(planOf(proMonthly() as any)).toBe("pro");
    expect(planOf({ id: "sub", items: { data: [item("si", "price_legacy")] } } as any, "premium")).toBe("premium");
    expect(planOf({ id: "sub" } as any)).toBeNull();
  });
});

describe("Stripe backfill for accounts with no local rows", () => {
  it("listInvoicesFromStripe pages through the account's own customer, skips drafts, upserts every invoice", async () => {
    mocks.invoicesList
      .mockResolvedValueOnce({ data: [stripeInvoice({ id: "in_3" }), stripeInvoice({ id: "in_draft", status: "draft" })], has_more: true })
      .mockResolvedValueOnce({ data: [stripeInvoice({ id: "in_1" })], has_more: false });
    const rows = await listInvoicesFromStripe(42);
    expect(rows.map((r) => r.id)).toEqual(["in_3", "in_1"]);
    expect(mocks.invoicesList.mock.calls.map((c) => c[0])).toEqual([
      { customer: "cus_42", limit: 100 },
      { customer: "cus_42", limit: 100, starting_after: "in_draft" },
    ]);
    expect(invoiceUpserts().map((v) => v[0])).toEqual(["in_3", "in_1"]);
    expect(invoiceUpserts().every((v) => v[1] === 42)).toBe(true);
  });

  it("an account that never checked out has no customer and nothing is asked of Stripe", async () => {
    expect(await listInvoicesFromStripe(99)).toEqual([]);
    expect(mocks.invoicesList).not.toHaveBeenCalled();
  });

  it("ensureInvoicesBackfilled runs once per account while the table is empty, and remembers for ten minutes", async () => {
    mocks.invoicesList.mockResolvedValue({ data: [stripeInvoice()], has_more: false });
    expect(await ensureInvoicesBackfilled(42, 1000)).toEqual({ backfilled: true, invoices: 1 });
    expect(await ensureInvoicesBackfilled(42, 2000)).toEqual({ backfilled: false, invoices: 0 });
    expect(mocks.invoicesList).toHaveBeenCalledTimes(1);
    expect(await ensureInvoicesBackfilled(42, 1000 + 11 * 60_000)).toEqual({ backfilled: true, invoices: 1 });
  });

  it("listPurchasesFromStripe keeps paid one-time checkouts of the customer, skips subscription and unpaid sessions", async () => {
    mocks.sessionsList.mockResolvedValueOnce({ data: [
      { id: "cs_a", mode: "payment", payment_status: "paid", amount_total: 9900, currency: "usd", created: 1700000000,
        payment_intent: { id: "pi_a", latest_charge: { receipt_url: "https://pay.stripe.com/receipts/a" } },
        line_items: { data: [{ description: "Master Class — Permits 101" }] }, metadata: { userId: "42", type: "master_class", moduleId: "3" } },
      { id: "cs_sub", mode: "subscription", payment_status: "paid", metadata: { userId: "42", type: "plan" } },
      { id: "cs_unpaid", mode: "payment", payment_status: "unpaid", metadata: { userId: "42", type: "cart" } },
      { id: "cs_other", mode: "payment", payment_status: "paid", amount_total: 1, metadata: { userId: "7", type: "cart" } },
    ], has_more: false });
    const rows = await listPurchasesFromStripe(42);
    expect(rows).toEqual([{ id: "pi_a", userId: 42, kind: "course", description: "Master Class — Permits 101", amount: 9900, currency: "usd", created: new Date(1700000000 * 1000), receiptUrl: "https://pay.stripe.com/receipts/a" }]);
    expect(mocks.sessionsList.mock.calls[0][0]).toMatchObject({ customer: "cus_42", status: "complete", expand: ["data.payment_intent.latest_charge", "data.line_items"] });
    expect(mocks.lineItems).not.toHaveBeenCalled();
    expect(mocks.paymentIntent).not.toHaveBeenCalled();
  });
});
