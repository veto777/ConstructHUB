/**
 * Transactional billing emails: one branded email per billing event with the
 * right facts, exactly once per dedupe key (redelivered webhooks, both
 * invoice.paid and invoice.payment_succeeded for one invoice, a retried send),
 * and never a secret in a message. The database and SMTP are mocked here; the
 * Stripe reads the adapter may make (card, receipt link, proration invoice)
 * are a stub `StripeReader`. No real Stripe, no real mail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sentinels: if any of these ever reach an email body, the "no secrets" test fails.
process.env.STRIPE_SECRET_KEY = "sk_test_SENTINEL_never_in_mail";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_SENTINEL_never_in_mail";
process.env.SMTP_APP_PASSWORD = "smtp-pass-SENTINEL";
process.env.SESSION_SECRET = "session-SENTINEL";
process.env.SMTP_EMAIL = "noreply@example.invalid";
process.env.APP_URL = "https://app.example.invalid";

const mocks = vi.hoisted(() => ({
  users: new Map<number, { email: string; display_name: string | null }>(),
  log: new Map<string, { id: number; user_id: number; kind: string; status: string; message: any }>(),
  nextId: 1,
  modules: new Map<number, { title: string; price: number }>(),
  customers: new Map<string, number>(),
  mail: [] as any[],
  sendError: null as Error | null,
  queries: [] as string[],
}));

vi.mock("../db", () => ({
  pool: {
    query: async (text: string, values: any[] = []) => {
      mocks.queries.push(text);
      if (/CREATE TABLE IF NOT EXISTS email_log/.test(text)) return { rows: [] };
      if (/SELECT email, display_name FROM users/.test(text)) {
        const u = mocks.users.get(values[0]);
        return { rows: u ? [u] : [] };
      }
      if (/SELECT email FROM users/.test(text)) {
        const u = mocks.users.get(values[0]);
        return { rows: u ? [{ email: u.email }] : [] };
      }
      if (/INSERT INTO email_log/.test(text)) {
        const [user_id, kind, key] = values;
        if (mocks.log.has(key)) return { rows: [] };
        const row = { id: mocks.nextId++, user_id, kind, status: "sent", message: null as any };
        mocks.log.set(key, row);
        return { rows: [{ id: row.id }] };
      }
      if (/UPDATE email_log SET status = 'pending'/.test(text)) {
        // The outbox: a failed send keeps its claim and stores the rendered message for drainEmailOutbox.
        for (const row of mocks.log.values()) if (row.id === values[0]) { row.status = "pending"; row.message = JSON.parse(values[3]); }
        return { rows: [] };
      }
      if (/DELETE FROM email_log/.test(text)) {
        for (const [key, row] of mocks.log) if (row.id === values[0]) mocks.log.delete(key);
        return { rows: [] };
      }
      if (/FROM master_class_modules/.test(text)) {
        const m = mocks.modules.get(values[0]);
        return { rows: m ? [m] : [] };
      }
      if (/FROM subscriptions WHERE stripe_customer_id/.test(text)) {
        const id = mocks.customers.get(values[0]);
        return { rows: id ? [{ user_id: id }] : [] };
      }
      throw new Error(`unexpected query in test: ${text}`);
    },
  },
  db: {},
}));
vi.mock("../email", () => ({
  sendWithFallback: async (options: any) => {
    if (mocks.sendError) throw mocks.sendError;
    mocks.mail.push(options);
    return { accepted: [options.to], rejected: [], response: "mock" };
  },
}));

import {
  BILLING_EMAIL_EVENTS, EMAIL_KINDS, sendWelcomeEmail, handleBillingEmailEvent, billingEmailEventsFromStripe,
  onStripeBillingEvent, sendTransactionalEmail, deliverTransactionalEmail, subscriptionFacts, describeChanges, previousItemsFrom, appBaseUrl,
  type BillingEmailEvent, type StripeReader,
} from "./billing-emails";
import { emailLayout } from "./billing-email-templates";
import { PLANS, ADDONS, agencyPriceCents } from "@shared/plans";

const USER = 42;
const BASE = "https://app.example.invalid";
/** 2030-01-01T00:00:00Z — renders as "January 1, 2030". */
const PERIOD_END = 1893456000;
const PERIOD_START = PERIOD_END - 30 * 86400;

type Role = { kind: "plan" | "addon" | "agency_locations" | "setup"; key?: string };
function price(id: string, role: Role | null, interval: "month" | "year" | null, unit_amount: number | null, extra: any = {}) {
  return {
    id, object: "price", currency: "usd", unit_amount, nickname: null, product: "prod_x",
    recurring: interval ? { interval } : null,
    metadata: role ? { chub_kind: role.kind, chub_key: role.key ?? "", chub_interval: interval ?? "once" } : {},
    ...extra,
  };
}
const item = (id: string, p: any, quantity = 1) => ({ id, object: "subscription_item", price: p, quantity, current_period_end: PERIOD_END });
const PRO_M = price("price_pro_m", { kind: "plan", key: "pro" }, "month", PLANS.pro.monthlyCents);
const GROWTH_M = price("price_growth_m", { kind: "plan", key: "growth" }, "month", PLANS.growth.monthlyCents);
const AGENCY_Y = price("price_agency_y", { kind: "plan", key: "agency" }, "year", PLANS.agency.annualCents);
const SEAT_M = price("price_seat_m", { kind: "addon", key: "extra_seat" }, "month", ADDONS.extra_seat.monthlyCents);
const PACK_M = price("price_pack_m", { kind: "addon", key: "competitor_pack" }, "month", ADDONS.competitor_pack.monthlyCents);
const LOC_Y = price("price_loc_y", { kind: "agency_locations" }, "year", null, { billing_scheme: "tiered" });

function subscription(items: any[], extra: any = {}) {
  return {
    id: "sub_1", object: "subscription", customer: "cus_1", status: "active", trial_end: null,
    cancel_at: null, cancel_at_period_end: false, items: { object: "list", data: items }, latest_invoice: null,
    metadata: { userId: String(USER) }, ...extra,
  } as any;
}
function invoice(lines: any[], extra: any = {}) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  return {
    id: "in_1", object: "invoice", number: "CHUB-0001", currency: "usd", status: "paid", customer: "cus_1",
    created: PERIOD_START, period_start: PERIOD_START, period_end: PERIOD_END,
    status_transitions: { paid_at: PERIOD_START + 60 },
    lines: { object: "list", data: lines }, subtotal, total: subtotal, amount_paid: subtotal, amount_due: 0,
    total_taxes: [], total_discount_amounts: [], hosted_invoice_url: "https://invoice.stripe.com/i/acct/test_1",
    invoice_pdf: "https://pay.stripe.com/invoice/acct/test_1/pdf", next_payment_attempt: null, attempt_count: 1,
    billing_reason: "subscription_cycle", description: null, default_payment_method: null, charge: "ch_1",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { userId: String(USER) } } },
    ...extra,
  } as any;
}
const line = (p: any, amount: number, quantity = 1, extra: any = {}) => ({
  id: `il_${p?.id ?? "legacy"}`, object: "line_item", amount, currency: "usd", quantity, price: p,
  description: extra.description ?? null, period: { start: PERIOD_START, end: PERIOD_END }, proration: false, ...extra,
});
const stripeEvent = (type: string, object: any, previous_attributes?: any, id = `evt_${type}_${Math.random().toString(36).slice(2, 8)}`) =>
  ({ id, object: "event", type, data: { object, ...(previous_attributes ? { previous_attributes } : {}) } }) as any;

const stripeStub = (): StripeReader & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    charges: { retrieve: async (id) => { calls.push(`charge:${id}`); return { id, payment_method_details: { card: { brand: "visa", last4: "4242" } }, receipt_url: "https://pay.stripe.com/receipts/r_1" }; } },
    paymentIntents: { retrieve: async (id) => { calls.push(`pi:${id}`); return { id, latest_charge: { id: "ch_pi", receipt_url: "https://pay.stripe.com/receipts/r_pi", payment_method_details: { card: { brand: "mastercard", last4: "5555" } } } }; } },
    paymentMethods: { retrieve: async (id) => { calls.push(`pm:${id}`); return { id, card: { brand: "amex", last4: "0005" } }; } },
    invoices: { retrieve: async (id) => { calls.push(`inv:${id}`); return { id, billing_reason: "subscription_update", total: 12000, number: "CHUB-0002", hosted_invoice_url: "https://invoice.stripe.com/i/acct/test_2", invoice_pdf: null }; } },
  };
};

const sent = () => mocks.mail;
const last = () => mocks.mail[mocks.mail.length - 1];
const SENTINELS = ["SENTINEL", "sk_test", "sk_live", "whsec_", "secret_hash", "<script"];

beforeEach(() => {
  mocks.users.clear();
  mocks.users.set(USER, { email: "owner@example.invalid", display_name: "Pat Builder" });
  mocks.log.clear();
  mocks.nextId = 1;
  mocks.modules.clear();
  mocks.customers.clear();
  mocks.customers.set("cus_1", USER);
  mocks.mail.length = 0;
  mocks.sendError = null;
  mocks.queries.length = 0;
});

describe("sendTransactionalEmail (dedupe contract)", () => {
  it("sends once per dedupe key, to the user's address, and reports a repeat as false", async () => {
    const msg = { subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
    expect(await sendTransactionalEmail(USER, "test", "test:1", msg)).toBe(true);
    expect(await sendTransactionalEmail(USER, "test", "test:1", msg)).toBe(false);
    expect(sent()).toHaveLength(1);
    expect(last()).toMatchObject({ to: "owner@example.invalid", subject: "Hello", text: "Hi" });
    expect(last().headers["X-ConstructHUB-Email"]).toBe("test");
  });
  it("a failed send keeps the claim and queues the email for the outbox — a retry by the caller never sends it twice", async () => {
    const msg = { subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
    mocks.sendError = new Error("smtp down");
    expect(await deliverTransactionalEmail(USER, "test", "test:retry", msg)).toBe("queued");
    expect(mocks.log.get("test:retry")).toMatchObject({ status: "pending", message: { subject: "Hello", text: "Hi" } });
    mocks.sendError = null;
    // The key is still claimed: the caller's retry sends nothing — drainEmailOutbox sends the
    // pending row once (email-outbox.test.ts, against the real database).
    expect(await deliverTransactionalEmail(USER, "test", "test:retry", msg)).toBe("duplicate");
    expect(await sendTransactionalEmail(USER, "test", "test:retry", msg)).toBe(false);
    expect(sent()).toHaveLength(0);
  });
  it("sends nothing for an account without an address", async () => {
    expect(await sendTransactionalEmail(999, "test", "test:none", { subject: "x", html: "x", text: "x" })).toBe(false);
    expect(sent()).toHaveLength(0);
  });
});

describe("welcome email", () => {
  it("names the first steps with real links, once per user", async () => {
    expect(await sendWelcomeEmail(USER, BASE)).toBe(true);
    expect(await sendWelcomeEmail(USER, BASE)).toBe(false);
    expect(sent()).toHaveLength(1);
    const mail = last();
    expect(mail.subject).toBe("Welcome to ConstructHUB, Pat Builder");
    for (const path of ["/pricing", "/google-business", "/crm", "/databases", "/settings?tab=security", "/settings?tab=billing"]) {
      expect(mail.html).toContain(`${BASE}${path}`);
      expect(mail.text).toContain(`${BASE}${path}`);
    }
    expect(mail.html).toContain("owner@example.invalid");
    expect(mail.text).toMatch(/1\. Choose a plan/);
    // The trial is granted or refused by the server at checkout; the email must not promise it.
    expect(mail.text).not.toMatch(/free trial/i);
    expect(mocks.log.get(`welcome:${USER}`)?.kind).toBe(EMAIL_KINDS.welcome);
  });
  it("links to the app origin: in production even when sign-up came through the CRM portal host, the dev server otherwise", () => {
    const env = { NODE_ENV: process.env.NODE_ENV, PORTAL_URL: process.env.PORTAL_URL };
    try {
      process.env.NODE_ENV = "production";
      process.env.PORTAL_URL = "https://portal.constructhub.us";
      const viaPortal = { protocol: "https", headers: { host: "portal.constructhub.us", "x-forwarded-proto": "https" } };
      expect(appBaseUrl(viaPortal)).toBe(BASE); // APP_URL — the portal host serves the CRM only, Pricing/Settings live here
      process.env.NODE_ENV = "test";
      expect(appBaseUrl({ protocol: "http", headers: { host: "127.0.0.1:8433" } })).toBe("http://127.0.0.1:8433");
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      if (env.PORTAL_URL === undefined) delete process.env.PORTAL_URL; else process.env.PORTAL_URL = env.PORTAL_URL;
    }
  });
});

describe("subscription started", () => {
  it("states plan, interval, add-ons, price, trial end and first charge for a trial", async () => {
    const sub = subscription([item("si_plan", PRO_M), item("si_seat", SEAT_M, 2)], { status: "trialing", trial_end: PERIOD_END });
    const result = await handleBillingEmailEvent({ type: "billing.subscription_started", userId: USER, subscription: sub }, { baseUrl: BASE });
    expect(result).toMatchObject({ kind: EMAIL_KINDS.subscriptionStarted, dedupeKey: "subscription_started:sub_1", sent: true });
    const mail = last();
    expect(mail.subject).toBe("Your ConstructHUB Pro trial has started");
    expect(mail.html).toContain("Pro — billed monthly");
    expect(mail.html).toContain("$109.00 / month"); // 7900 + 2 × 1500
    expect(mail.html).toContain("Extra seat × 2");
    expect(mail.text).toContain("Trial ends: January 1, 2030");
    expect(mail.text).toContain("First charge: $109.00 on January 1, 2030");
    expect(mail.html).toContain("will not be charged until the trial ends");
    // Redelivery: same subscription, no second email.
    expect((await handleBillingEmailEvent({ type: "billing.subscription_started", userId: USER, subscription: sub }, { baseUrl: BASE })).sent).toBe(false);
    expect(sent()).toHaveLength(1);
  });
  it("prices an annual Agency subscription with its location bands", async () => {
    const sub = subscription([item("si_plan", AGENCY_Y), item("si_loc", LOC_Y, 15)]);
    const facts = subscriptionFacts(sub);
    expect(facts.planName).toBe("Agency");
    expect(facts.recurringCents).toBe(agencyPriceCents(25, "year"));
    expect(facts.extras).toEqual(["25 locations (10 included + 15 extra)"]);
    await handleBillingEmailEvent({ type: "billing.subscription_started", userId: USER, subscription: sub }, { baseUrl: BASE });
    expect(last().subject).toBe("Your ConstructHUB Agency plan is active");
    expect(last().html).toContain("$5,740.00 / year");
    expect(last().text).toContain("Next charge: $5,740.00 on January 1, 2030");
  });
  it("names a legacy subscription from its price without inventing a plan price", () => {
    const legacy = price("price_legacy", null, "month", 4900, { nickname: "Standard (legacy)" });
    const facts = subscriptionFacts(subscription([item("si_legacy", legacy)]));
    expect(facts.planName).toBe("Standard (legacy)");
    expect(facts.recurringCents).toBe(4900);
  });
});

describe("receipt for a paid invoice", () => {
  const paidInvoice = () => invoice([line(PRO_M, 7900), line(SEAT_M, 3000, 2), line(null, 1500, 1, { description: "Legacy item <b>x</b>" })]);

  it("lists line items, totals, card, invoice number and the Stripe links — once across invoice.paid and payment_succeeded", async () => {
    const stripe = stripeStub();
    const events = await billingEmailEventsFromStripe(stripeEvent("invoice.paid", paidInvoice()), { userId: USER, stripe });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "billing.invoice_paid", userId: USER, card: { brand: "visa", last4: "4242" } });
    expect(stripe.calls).toEqual(["charge:ch_1"]);
    const result = await handleBillingEmailEvent(events[0], { baseUrl: BASE });
    expect(result).toMatchObject({ kind: EMAIL_KINDS.receipt, dedupeKey: "receipt:in_1", sent: true });
    const mail = last();
    expect(mail.subject).toBe("Receipt CHUB-0001 — $124.00 paid to ConstructHUB");
    expect(mail.html).toContain("ConstructHUB Pro plan (monthly)");
    expect(mail.html).toContain("Extra seat (monthly)");
    expect(mail.html).toContain("× 2");
    expect(mail.html).toContain("Legacy item &lt;b&gt;x&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>x</b>");
    expect(mail.html).toContain("Visa ending in 4242");
    expect(mail.html).toContain("https://invoice.stripe.com/i/acct/test_1");
    expect(mail.html).toContain("https://pay.stripe.com/invoice/acct/test_1/pdf");
    expect(mail.text).toContain("Invoice: CHUB-0001");
    expect(mail.text).toContain("Total paid: $124.00");
    expect(mail.text).toContain(`Billing & invoices: ${BASE}/settings?tab=billing`);
    // Stripe sends both events for one invoice; a redelivery repeats one. One receipt.
    for (const type of ["invoice.payment_succeeded", "invoice.paid"]) {
      for (const ev of await billingEmailEventsFromStripe(stripeEvent(type, paidInvoice()), { userId: USER, stripe })) {
        expect((await handleBillingEmailEvent(ev, { baseUrl: BASE })).sent).toBe(false);
      }
    }
    expect(sent()).toHaveLength(1);
  });
  it("skips a $0 invoice (trial start) instead of sending an empty receipt", async () => {
    const zero = invoice([line(PRO_M, 0)], { amount_paid: 0, total: 0, subtotal: 0 });
    const result = await handleBillingEmailEvent({ type: "billing.invoice_paid", userId: USER, invoice: zero }, { baseUrl: BASE });
    expect(result).toMatchObject({ sent: false, skipped: "zero_amount" });
    expect(sent()).toHaveLength(0);
  });
  it("marks prorated lines, shows tax and discounts, and drops a non-http link", async () => {
    const inv = invoice([line(GROWTH_M, 12000, 1, { proration: true, description: "Remaining time on Growth" })], {
      total_taxes: [{ amount: 720 }], total_discount_amounts: [{ amount: 500 }], total: 12220, amount_paid: 12220,
      hosted_invoice_url: "javascript:alert(1)", invoice_pdf: null, billing_reason: "subscription_update",
      payments: { data: [{ payment: { payment_intent: "pi_9" } }] }, charge: undefined,
    });
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("invoice.paid", inv), { userId: USER, stripe: stripeStub() });
    expect(ev).toMatchObject({ card: { brand: "mastercard", last4: "5555" } });
    await handleBillingEmailEvent(ev, { baseUrl: BASE });
    const mail = last();
    expect(mail.html).toContain("prorated");
    expect(mail.text).toContain("Tax: $7.20");
    expect(mail.text).toContain("Discount: -$5.00");
    expect(mail.text).toContain("Total paid: $122.20");
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).toContain("Mastercard ending in 5555");
  });
  it("shows the account credit Stripe applied so the totals add up to what was charged", async () => {
    const inv = invoice([line(PRO_M, 7900)], { total: 7900, amount_due: 4900, amount_paid: 4900, starting_balance: -3000, ending_balance: 0 });
    await handleBillingEmailEvent({ type: "billing.invoice_paid", userId: USER, invoice: inv }, { baseUrl: BASE });
    expect(last().subject).toBe("Receipt CHUB-0001 — $49.00 paid to ConstructHUB");
    expect(last().text).toContain("Subtotal: $79.00");
    expect(last().text).toContain("Account credit applied: -$30.00");
    expect(last().text).toContain("Total paid: $49.00");
    // No balance involved: no such row.
    await handleBillingEmailEvent({ type: "billing.invoice_paid", userId: USER, invoice: invoice([line(PRO_M, 7900)], { id: "in_plain", amount_due: 7900 }) }, { baseUrl: BASE });
    expect(last().text).not.toContain("credit applied");
    expect(last().text).not.toContain("Previous balance");
  });
  it("still sends a receipt when Stripe is unavailable for the card lookup", async () => {
    const broken: StripeReader = { ...stripeStub(), charges: { retrieve: async () => { throw new Error("stripe down"); } } };
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("invoice.paid", paidInvoice()), { userId: USER, stripe: broken });
    expect(ev).toMatchObject({ card: null });
    await handleBillingEmailEvent(ev, { baseUrl: BASE });
    expect(last().html).toContain("Card on file");
  });
});

describe("payment failed", () => {
  const failed = (attempt_count: number) => invoice([line(PRO_M, 7900)], {
    id: "in_fail", number: "CHUB-0009", status: "open", amount_paid: 0, amount_due: 7900, attempt_count,
    next_payment_attempt: PERIOD_END, hosted_invoice_url: "https://invoice.stripe.com/i/acct/fail_9",
  });
  it("tells the amount, the retry date, and links the update-card page and the hosted invoice", async () => {
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("invoice.payment_failed", failed(1)), { userId: USER, stripe: stripeStub() });
    const result = await handleBillingEmailEvent(ev, { baseUrl: BASE });
    expect(result).toMatchObject({ kind: EMAIL_KINDS.paymentFailed, dedupeKey: "payment_failed:in_fail:1", sent: true });
    const mail = last();
    expect(mail.subject).toBe("Action needed: your ConstructHUB payment of $79.00 didn't go through");
    expect(mail.text).toContain("Amount due: $79.00");
    expect(mail.text).toContain("Next automatic retry: January 1, 2030");
    expect(mail.text).toContain(`Update payment method: ${BASE}/settings?tab=billing`);
    expect(mail.text).toContain("Pay this invoice now: https://invoice.stripe.com/i/acct/fail_9");
    expect(mail.html).toContain("your plan stays on while we retry");
  });
  it("emails once per attempt: a redelivery is silent, the next retry is not", async () => {
    const stripe = stripeStub();
    for (const attempt of [2, 2, 3]) {
      const [ev] = await billingEmailEventsFromStripe(stripeEvent("invoice.payment_failed", failed(attempt)), { userId: USER, stripe });
      await handleBillingEmailEvent(ev, { baseUrl: BASE });
    }
    expect(sent()).toHaveLength(2);
    expect(last().text).toContain("Attempt: 3");
  });
  it("says when no automatic retry is scheduled", async () => {
    await handleBillingEmailEvent({ type: "billing.invoice_payment_failed", userId: USER, invoice: { ...failed(4), next_payment_attempt: null } }, { baseUrl: BASE });
    expect(last().text).toContain("No further automatic retries");
  });
});

describe("plan / add-on changed (from customer.subscription.updated)", () => {
  it("describes the change, the new price, the prorated charge and the next charge; one email per Stripe event", async () => {
    const before = [item("si_plan", PRO_M), item("si_seat", SEAT_M, 1)];
    const after = subscription([item("si_plan", GROWTH_M), item("si_seat", SEAT_M, 3), item("si_pack", PACK_M, 1)], { latest_invoice: "in_2" });
    const stripe = stripeStub();
    const event = stripeEvent("customer.subscription.updated", after, { items: { data: before } }, "evt_change_1");
    const events = await billingEmailEventsFromStripe(event, { userId: USER, stripe });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "billing.subscription_changed", prorationCents: 12000, eventId: "evt_change_1" });
    expect(stripe.calls).toEqual(["inv:in_2"]);
    const result = await handleBillingEmailEvent(events[0], { baseUrl: BASE });
    expect(result).toMatchObject({ kind: EMAIL_KINDS.subscriptionChanged, dedupeKey: "subscription_changed:evt_change_1", sent: true });
    const mail = last();
    expect(mail.subject).toBe("Your ConstructHUB subscription changed — now Growth, monthly");
    expect(mail.text).toContain("- Plan: Pro → Growth");
    expect(mail.text).toContain("- Extra seat: 1 → 3");
    expect(mail.text).toContain("- Competitor scan pack: added");
    expect(mail.text).toContain("New price: $283.00 / month"); // 19900 + 3 × 1500 + 3900
    expect(mail.text).toContain("Charged today (prorated): $120.00");
    expect(mail.text).toContain("Next charge: $283.00 on January 1, 2030");
    expect(mail.html).toContain("https://invoice.stripe.com/i/acct/test_2");
    // The same Stripe event delivered again: nothing.
    for (const ev of await billingEmailEventsFromStripe(event, { userId: USER, stripe })) {
      expect((await handleBillingEmailEvent(ev, { baseUrl: BASE })).sent).toBe(false);
    }
    expect(sent()).toHaveLength(1);
  });
  it("ignores an update that changed nothing billable (status, metadata, period roll)", async () => {
    const sub = subscription([item("si_plan", PRO_M)]);
    expect(await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub, { status: "trialing" }), { userId: USER })).toEqual([]);
    expect(await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub, { metadata: {} }), { userId: USER })).toEqual([]);
    expect(await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub), { userId: USER })).toEqual([]);
    // A renewal on current API versions: previous_attributes.items.data holds only
    // each item's old period fields. Not a plan change — and no invoice lookup.
    const stripe = stripeStub();
    const roll = { current_period_end: PERIOD_START, latest_invoice: "in_prev", items: { data: [{ current_period_end: PERIOD_START, current_period_start: PERIOD_START - 30 * 86400 }] } };
    expect(await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", { ...sub, latest_invoice: "in_cycle" }, roll), { userId: USER, stripe })).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });
  it("reads previous_attributes.items as the diff Stripe sends: a partial entry per changed item, never a phantom change", async () => {
    const after = [item("si_plan", GROWTH_M), item("si_seat", SEAT_M, 3)];
    const sub = subscription(after, { latest_invoice: "in_2" });
    // Plan swap: only the first item changed, and only its price/plan is in the diff.
    const swap = { items: { data: [{ price: PRO_M, plan: { id: PRO_M.id } }, {}] } };
    expect(previousItemsFrom(swap, after)).toMatchObject([{ id: "si_plan", price: { id: PRO_M.id }, quantity: 1 }, { id: "si_seat", price: { id: SEAT_M.id }, quantity: 3 }]);
    const [swapped] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub, swap, "evt_swap"), { userId: USER, stripe: stripeStub() });
    expect(swapped).toMatchObject({ type: "billing.subscription_changed", prorationCents: 12000 });
    expect(describeChanges((swapped as any).previousItems, after)).toEqual(["Plan: Pro → Growth"]);
    await handleBillingEmailEvent(swapped, { baseUrl: BASE });
    expect(last().text).toContain("- Plan: Pro → Growth");
    expect(last().text).not.toContain("Extra seat: added");
    // Quantity change on the second item only.
    const [requantified] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub, { items: { data: [{}, { quantity: 1 }] }, quantity: 1 }, "evt_qty"), { userId: USER });
    expect(describeChanges((requantified as any).previousItems, after)).toEqual(["Extra seat: 1 → 3"]);
    // An added item: Stripe gives the full previous list (shorter), used as is.
    const added = { items: { data: [item("si_plan", GROWTH_M)], total_count: 1 } };
    expect(previousItemsFrom(added, after)).toHaveLength(1);
    const [withSeats] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", sub, added, "evt_add"), { userId: USER });
    expect(describeChanges((withSeats as any).previousItems, after)).toEqual(["Extra seat: added × 3"]);
    // A diff that cannot be rebuilt (shorter and partial) still emails, generically.
    expect(previousItemsFrom({ items: { data: [{ quantity: 1 }] } }, after)).toBeNull();
  });
  it("describes interval and Agency location changes and a removed add-on", () => {
    const changes = describeChanges(
      [item("a", AGENCY_Y), item("b", LOC_Y, 5), item("c", price("price_seat_y", { kind: "addon", key: "extra_seat" }, "year", 15000), 2)],
      [item("a", price("price_agency_m", { kind: "plan", key: "agency" }, "month", PLANS.agency.monthlyCents)), item("b", price("price_loc_m", { kind: "agency_locations" }, "month", null), 40)],
    );
    expect(changes).toEqual(["Billing: yearly → monthly", "Extra seat: removed", "Locations: 15 → 50"]);
  });
  it("explains proration on the next receipt when the proration invoice is unknown", async () => {
    const sub = subscription([item("si_plan", GROWTH_M)]);
    await handleBillingEmailEvent({ type: "billing.subscription_changed", userId: USER, subscription: sub, previousItems: [item("si_plan", PRO_M)] }, { baseUrl: BASE });
    expect(last().text).toContain("appears on your next receipt");
    expect(last().text).not.toContain("Charged today");
  });
});

describe("cancellation scheduled / reverted / ended", () => {
  it("emails the end date when a cancellation is scheduled, and once more if it is reverted", async () => {
    const canceling = subscription([item("si_plan", PRO_M)], { cancel_at_period_end: true, cancel_at: PERIOD_END });
    const [scheduled] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", canceling, { cancel_at_period_end: false, cancel_at: null }), { userId: USER });
    expect(scheduled.type).toBe("billing.cancellation_scheduled");
    expect(await handleBillingEmailEvent(scheduled, { baseUrl: BASE })).toMatchObject({ dedupeKey: `cancellation_scheduled:sub_1:${PERIOD_END}`, sent: true });
    expect(last().subject).toBe("Your ConstructHUB Pro plan ends on January 1, 2030");
    expect(last().text).toContain("Access until: January 1, 2030");
    expect(last().text).toContain(`Resume my plan: ${BASE}/settings?tab=billing`);
    // Stripe redelivers the same update: silent.
    const [again] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", canceling, { cancel_at_period_end: false }), { userId: USER });
    expect((await handleBillingEmailEvent(again, { baseUrl: BASE })).sent).toBe(false);

    const resumed = subscription([item("si_plan", PRO_M)]);
    const [reverted] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", resumed, { cancel_at_period_end: true, cancel_at: PERIOD_END }, "evt_resume"), { userId: USER });
    expect(reverted.type).toBe("billing.cancellation_reverted");
    expect(await handleBillingEmailEvent(reverted, { baseUrl: BASE })).toMatchObject({ dedupeKey: "cancellation_reverted:evt_resume", sent: true });
    expect(last().subject).toBe("Your ConstructHUB Pro plan will continue");
    expect(sent()).toHaveLength(2);
  });
  it("does not treat a cancellation that stays scheduled as a new one", async () => {
    const canceling = subscription([item("si_plan", PRO_M)], { cancel_at_period_end: true, cancel_at: PERIOD_END });
    expect(await billingEmailEventsFromStripe(stripeEvent("customer.subscription.updated", canceling, { cancel_at: PERIOD_END - 1 }), { userId: USER })).toEqual([]);
  });
  it("emails once when the subscription ends, pointing at Pricing", async () => {
    const ended = subscription([item("si_plan", PRO_M)], { status: "canceled", ended_at: PERIOD_END });
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("customer.subscription.deleted", ended), { userId: USER });
    expect(await handleBillingEmailEvent(ev, { baseUrl: BASE })).toMatchObject({ kind: EMAIL_KINDS.subscriptionEnded, dedupeKey: "subscription_ended:sub_1", sent: true });
    expect(last().subject).toBe("Your ConstructHUB Pro plan has ended");
    expect(last().text).toContain("ended on January 1, 2030");
    expect(last().text).toContain(`Choose a plan: ${BASE}/pricing`);
    expect((await handleBillingEmailEvent(ev, { baseUrl: BASE })).sent).toBe(false);
  });
});

describe("one-time purchase receipt (checkout.session.completed)", () => {
  const session = (metadata: Record<string, string>, extra: any = {}) => ({
    id: "cs_1", object: "checkout.session", mode: "payment", payment_status: "paid", currency: "usd", amount_total: 249900,
    created: PERIOD_START, customer: "cus_1", payment_intent: "pi_cs_1", metadata, ...extra,
  }) as any;

  it("lists the cart items from our own checkout metadata with the Stripe receipt link, once per session", async () => {
    const items = [{ id: "course_bundle", type: "course_bundle", name: "Master Class — Complete Bundle", price: 249900, moduleId: null }];
    const stripe = stripeStub();
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ userId: String(USER), type: "cart", items: JSON.stringify(items) })), { userId: USER, stripe });
    expect(ev).toMatchObject({ type: "billing.purchase_completed", kind: "course", receiptUrl: "https://pay.stripe.com/receipts/r_pi", card: { brand: "mastercard", last4: "5555" } });
    expect(await handleBillingEmailEvent(ev, { baseUrl: BASE })).toMatchObject({ kind: EMAIL_KINDS.purchaseReceipt, dedupeKey: "purchase_receipt:cs_1", sent: true });
    const mail = last();
    expect(mail.subject).toBe("Receipt — $2,499.00 paid to ConstructHUB");
    expect(mail.text).toContain("- Master Class — Complete Bundle: $2,499.00");
    expect(mail.text).toContain("Paid on: December 2, 2029");
    expect(mail.text).toContain("Mastercard ending in 5555");
    expect(mail.text).toContain(`Open Master Class: ${BASE}/master-class`);
    expect(mail.text).toContain("View Stripe receipt: https://pay.stripe.com/receipts/r_pi");
    // ACH settles later: async_payment_succeeded for the same session is the same receipt.
    const [again] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.async_payment_succeeded", session({ userId: String(USER), type: "cart", items: JSON.stringify(items) })), { userId: USER, stripe });
    expect((await handleBillingEmailEvent(again, { baseUrl: BASE })).sent).toBe(false);
    expect(sent()).toHaveLength(1);
  });
  it("names a single Master Class module from the database and a service purchase from the catalog", async () => {
    mocks.modules.set(7, { title: "Winning Bids", price: 19900 });
    const [course] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ userId: String(USER), type: "master_class", moduleId: "7" }, { id: "cs_mod", amount_total: 19900 })), { userId: USER });
    expect(course).toMatchObject({ kind: "course", items: [{ label: "Master Class — Winning Bids", amountCents: 19900 }], receiptUrl: null });
    const [service] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ userId: String(USER), type: "cart", items: JSON.stringify([{ id: "dfy_formation", type: "dfy_service", name: "Business Formation & Filing", price: 550000 }]) }, { id: "cs_svc", amount_total: 550000 })), { userId: USER });
    expect(service).toMatchObject({ kind: "service" });
    await handleBillingEmailEvent(service, { baseUrl: BASE });
    expect(last().text).toContain("Our team will reach out within one business day");
    const [reinstated] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ userId: String(USER), type: "reinstatement" }, { id: "cs_re", amount_total: 4900 })), { userId: USER });
    expect(reinstated).toMatchObject({ kind: "reinstatement", items: [{ label: "Account reinstatement", amountCents: 4900 }] });
  });
  it("names an SEO agreement checkout (server/routes.ts) from its own metadata", async () => {
    const [ev] = await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ userId: String(USER), type: "seo_contract", contractId: "12", packageId: "seo_growth" }, { id: "cs_seo", amount_total: 900000 })), { userId: USER });
    expect(ev).toMatchObject({ kind: "service", items: [{ label: "SEO package agreement — contract #12, paid in full", detail: "Package seo_growth", amountCents: 900000 }] });
    await handleBillingEmailEvent(ev, { baseUrl: BASE });
    expect(last().text).toContain("- SEO package agreement — contract #12, paid in full (Package seo_growth): $9,000.00");
  });
  it("ignores subscription checkouts and unpaid sessions", async () => {
    expect(await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ type: "plan" }, { mode: "subscription" })), { userId: USER })).toEqual([]);
    expect(await billingEmailEventsFromStripe(stripeEvent("checkout.session.completed", session({ type: "cart" }, { payment_status: "unpaid" })), { userId: USER })).toEqual([]);
  });
});

describe("onStripeBillingEvent (the webhook's one call)", () => {
  it("resolves the account from our metadata or the customer id and never throws", async () => {
    const results = await onStripeBillingEvent(stripeEvent("customer.subscription.created", subscription([item("si_plan", PRO_M)], { metadata: {} })), { baseUrl: BASE });
    expect(results).toEqual([{ kind: EMAIL_KINDS.subscriptionStarted, dedupeKey: "subscription_started:sub_1", sent: true }]);
    expect(await onStripeBillingEvent(stripeEvent("customer.subscription.created", subscription([item("si_plan", PRO_M)], { id: "sub_x", customer: "cus_unknown", metadata: {} })), { baseUrl: BASE })).toEqual([]);
    mocks.sendError = new Error("smtp down");
    expect(await onStripeBillingEvent(stripeEvent("invoice.paid", invoice([line(PRO_M, 7900)])), { baseUrl: BASE }))
      .toEqual([{ kind: EMAIL_KINDS.receipt, dedupeKey: "receipt:in_1", sent: false, queued: true }]);
    mocks.sendError = null;
    // The failed send kept its claim as a pending outbox row: a redelivery of the event sends
    // nothing more (drainEmailOutbox sends the row, once), and the webhook was never failed for it.
    expect(await onStripeBillingEvent(stripeEvent("invoice.paid", invoice([line(PRO_M, 7900)])), { baseUrl: BASE }))
      .toEqual([{ kind: EMAIL_KINDS.receipt, dedupeKey: "receipt:in_1", sent: false }]);
    expect(mocks.log.get("receipt:in_1")).toMatchObject({ status: "pending" });
    expect(sent()).toHaveLength(1);
  });
  it("covers every declared billing event with a template", async () => {
    const sub = subscription([item("si_plan", PRO_M)]);
    const all: BillingEmailEvent[] = [
      { type: "billing.subscription_started", userId: USER, subscription: sub },
      { type: "billing.subscription_changed", userId: USER, subscription: sub, previousItems: [item("si_plan", GROWTH_M)] },
      { type: "billing.cancellation_scheduled", userId: USER, subscription: { ...sub, cancel_at_period_end: true } },
      { type: "billing.cancellation_reverted", userId: USER, subscription: sub },
      { type: "billing.subscription_ended", userId: USER, subscription: sub },
      { type: "billing.invoice_paid", userId: USER, invoice: invoice([line(PRO_M, 7900)]) },
      { type: "billing.invoice_payment_failed", userId: USER, invoice: invoice([line(PRO_M, 7900)], { id: "in_f", amount_due: 7900 }) },
      { type: "billing.purchase_completed", userId: USER, session: { id: "cs_all", amount_total: 100, currency: "usd", created: PERIOD_START } as any, items: [{ label: "Thing", amountCents: 100 }], kind: "other" },
    ];
    expect(new Set(all.map((e) => e.type))).toEqual(new Set(BILLING_EMAIL_EVENTS));
    for (const ev of all) expect((await handleBillingEmailEvent(ev, { baseUrl: BASE })).sent).toBe(true);
    expect(sent()).toHaveLength(all.length);
    expect(new Set(sent().map((m) => m.subject)).size).toBe(all.length);
  });
});

describe("no secrets, always a text part, escaped layout", () => {
  it("never puts an environment secret, a Stripe key or markup into a message", async () => {
    const sub = subscription([item("si_plan", PRO_M)]);
    await sendWelcomeEmail(USER, BASE);
    await handleBillingEmailEvent({ type: "billing.subscription_started", userId: USER, subscription: sub }, { baseUrl: BASE });
    await handleBillingEmailEvent({ type: "billing.invoice_paid", userId: USER, invoice: invoice([line(PRO_M, 7900, 1, { description: "<img src=x onerror=alert(1)>" })]), card: { brand: "visa", last4: "4242" } }, { baseUrl: BASE });
    await handleBillingEmailEvent({ type: "billing.invoice_payment_failed", userId: USER, invoice: invoice([line(PRO_M, 7900)], { id: "in_f", amount_due: 7900 }) }, { baseUrl: BASE });
    expect(sent().length).toBeGreaterThanOrEqual(4);
    for (const mail of sent()) {
      const body = `${mail.subject}\n${mail.html}\n${mail.text}`;
      for (const sentinel of SENTINELS) expect(body, `${mail.subject} leaks ${sentinel}`).not.toContain(sentinel);
      expect(body).not.toContain("onerror=");
      expect(mail.text.length).toBeGreaterThan(80);
      expect(mail.html).toContain("<!DOCTYPE html>");
      expect(mail.from).toContain("ConstructHUB");
    }
  });
  it("renders the shared layout with rows, steps, cta and secondary links in both parts", () => {
    const { html, text } = emailLayout({
      baseUrl: BASE, title: "T <1>", intro: ["A & B"], rows: [["Plan", "Pro & Co"]], steps: [{ text: "Go", url: `${BASE}/go` }, { text: "Bad", url: "javascript:x" }],
      cta: { label: "Click", url: `${BASE}/cta` }, secondary: [{ label: "PDF", url: "https://pay.stripe.com/x.pdf" }, { label: "Nope", url: "data:text/html,x" }], note: "n", footer: "f",
    });
    expect(html).toContain("T &lt;1&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Pro &amp; Co");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(text).toContain("Plan: Pro & Co");
    expect(text).toContain(`1. Go — ${BASE}/go`);
    expect(text).toContain("2. Bad\n");
    expect(text).toContain(`Click: ${BASE}/cta`);
    expect(text).toContain("PDF: https://pay.stripe.com/x.pdf");
    expect(text).not.toContain("Nope:");
    expect(text.trim().endsWith("f")).toBe(true);
  });
});
