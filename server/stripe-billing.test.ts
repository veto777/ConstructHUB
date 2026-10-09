import { beforeEach, describe, expect, it, vi } from "vitest";
// Plan billing on the shared price book (shared/plans.ts), with a mocked
// Stripe client and database: checkout (plans, annual, Agency bands, add-ons,
// refusals), change-plan / add-ons on the SAME subscription, webhook mapping,
// and the $1,000 "talk to sales" threshold. No real Stripe call is made.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";
// The overage safety switch (CALL_ASSISTANT_OVERAGE_BILLING, default off): on here, so an ended subscription's settlement job is run (against the mocked database).
process.env.CALL_ASSISTANT_OVERAGE_BILLING = "on";

const mocks = vi.hoisted(() => ({
  rows: [] as any[][],
  updates: [] as any[],
  inserts: [] as any[],
  prices: new Map<string, any>(),
  pricesList: vi.fn(),
  pricesCreate: vi.fn(),
  checkout: vi.fn(),
  openSessions: vi.fn(),
  expire: vi.fn(),
  /** checkout.sessions.retrieve: the Call Assistant checkout re-reads the session it remembered on the row. */
  sessionRetrieve: vi.fn(),
  /** subscriptions.cancel: a duplicate live Call Assistant subscription is cancelled at Stripe. */
  cancel: vi.fn(),
  customers: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  /** The customer's subscriptions as Stripe lists them (create-checkout asks). */
  history: vi.fn(),
  verify: vi.fn(),
  recentAuth: true,
  /** The subscription Stripe "has": retrieve returns it, update applies item changes to it. */
  current: null as any,
  /** Plain-SQL statements (the cancellation columns). */
  sql: [] as { text: string; values: any[] }[],
  /** What the cancellation columns hold for the row GET /subscription reads. */
  cancelRow: {} as Record<string, unknown>,
  /** The billing-email adapter (server/account/billing-emails onStripeBillingEvent), spied. */
  billingEmail: vi.fn(async (..._args: any[]) => [] as any[]),
  /** Stripe event ids the ledger already holds (the idempotency claim fails for them). */
  seenEvents: new Set<string>(),
  invoiceApplied: true,
  /** The Call Assistant number-release hook (server/voice/number-release.ts), spied. */
  afterSubscriptionChange: vi.fn(async (_userId: number) => null),
  /** The account's call_assistant_subscriptions row (server/voice/subscription-store.ts), when a test gives it one. */
  callAssistantRow: null as any,
  /** The account row getEntitlements reads (users ⟕ subscriptions ⟕ …): null = unknown user; { email } makes a platform admin. */
  accountRow: null as any,
  /** The account's checkout / change attempt in flight (call_assistant_checkout_attempts), when a test gives it one. */
  attempt: null as any,
  /** Make the next `creating → open` completion write lose (another process recorded the session first). */
  loseCompletion: false,
}));
vi.mock("stripe", () => ({ default: class {
  prices = { list: mocks.pricesList, create: mocks.pricesCreate };
  checkout = { sessions: { create: mocks.checkout, list: mocks.openSessions, expire: mocks.expire, retrieve: mocks.sessionRetrieve } };
  customers = { create: mocks.customers };
  subscriptions = { retrieve: mocks.retrieve, update: mocks.update, list: mocks.history, cancel: mocks.cancel };
  webhooks = { constructEvent: mocks.verify };
} }));
vi.mock("./db", () => {
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
        if (/^\s*(CREATE (TABLE|UNIQUE INDEX|INDEX)|ALTER TABLE)/.test(text)) return { rows: [] };
        // The account lock (server/billing/locks.ts) on a stand-in connection: its statements are not the writes under test.
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SELECT set_config|SELECT pg_advisory_xact_lock)/.test(text)) return { rows: [] };
        mocks.sql.push({ text, values });
        if (/SELECT cancel_at_period_end/.test(text)) return { rows: [mocks.cancelRow] };
        // The account row getEntitlements reads (server/entitlements.ts accountSubscriptionRow).
        if (/^\s*SELECT u\.email, s\.\*/.test(text)) return { rows: mocks.accountRow ? [mocks.accountRow] : [] };
        // The AI Call Assistant's own subscription (server/voice/subscription.ts): its row, and the account lookups its webhook makes.
        if (/FROM call_assistant_subscriptions WHERE user_id/.test(text)) return { rows: mocks.callAssistantRow ? [mocks.callAssistantRow] : [] };
        // The attempt row (the checkout lock across processes, server/voice/subscription.ts): in flight, started, moved on.
        if (/FROM call_assistant_checkout_attempts WHERE user_id/.test(text)) return { rows: mocks.attempt ? [mocks.attempt] : [] };
        if (/FROM call_assistant_checkout_attempts WHERE id/.test(text)) return { rows: mocks.attempt?.id === values[0] ? [mocks.attempt] : [] };
        if (/INSERT INTO call_assistant_checkout_attempts/.test(text)) return { rows: [{ id: values[0], user_id: values[1], kind: values[2], state: "creating", order_key: values[3], stripe_customer_id: values[4], stripe_subscription_id: values[5], idempotency_key: values[6], session_id: null, session_url: null }] };
        // An ended subscription voids the account's open attempts in the same transaction as the end.
        if (/UPDATE call_assistant_checkout_attempts SET state = 'expired'/.test(text)) { if (mocks.attempt?.user_id === values[0]) mocks.attempt = null; return { rows: [] }; }
        if (/UPDATE call_assistant_checkout_attempts SET state = \$2/.test(text)) {
          // The completion write lost to another process that resumed the same attempt (the same session, recorded by it).
          if (values[1] === "open" && mocks.loseCompletion) { mocks.loseCompletion = false; mocks.attempt = { ...(mocks.attempt ?? { id: values[0] }), id: values[0], state: "open", session_id: "cs_recorded_elsewhere", session_url: "https://checkout.example.invalid/cs_recorded_elsewhere" }; return { rows: [] }; }
          // Moved on (done / expired / failed): no longer in flight; opened: the session is on it.
          if (mocks.attempt?.id === values[0]) { if (values[1] === "open") mocks.attempt = { ...mocks.attempt, state: "open", session_id: values[3], session_url: values[4] }; else mocks.attempt = null; }
          return { rows: [{ id: values[0] }] };
        }
        if (/SELECT user_id, status FROM call_assistant_subscriptions WHERE stripe_subscription_id/.test(text)) return { rows: mocks.callAssistantRow?.stripe_subscription_id === values[0] ? [mocks.callAssistantRow] : [] };
        if (/SELECT user_id FROM subscriptions WHERE stripe_customer_id/.test(text)) return { rows: values[0] === "cus_test" ? [{ user_id: 42 }] : [] };
        if (/UPDATE call_assistant_subscriptions SET status = 'canceled'/.test(text)) return { rows: [{ user_id: 42 }] };
        // An event id is new to the ledger (the webhook's idempotency claim succeeds) unless a test marked it seen.
        if (/INSERT INTO billing_events/.test(text)) return { rows: mocks.seenEvents.has(values[0]) ? [] : [{ stripe_event_id: values[0] }] };
        if (/INSERT INTO billing_invoices/.test(text)) return { rows: mocks.invoiceApplied ? [{ id: values[0] }] : [] };
        // Purchase fulfilment rows (server/billing/fulfilment.ts), captured in the shape the old drizzle inserts had.
        if (/INSERT INTO course_purchases/.test(text)) { mocks.inserts.push({ userId: values[0], moduleId: values[1], isBundle: values[2], stripeSessionId: values[3] }); return { rows: [{ id: mocks.inserts.length }] }; }
        if (/INSERT INTO service_purchases/.test(text)) { mocks.inserts.push({ userId: values[0], serviceType: values[1], serviceName: values[2], price: values[3], stripeSessionId: values[4] }); return { rows: [{ id: mocks.inserts.length }] }; }
        return { rows: [] };
      },
      // Fulfilment writes a session's rows in one transaction on a dedicated client: the same mock answers it.
      async connect() { return { query: this.query, release() {} }; },
    },
  };
});
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8251" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
vi.mock("./account-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./account-security")>()),
  requireRecentAuth: (_req: any, res: any) => {
    if (mocks.recentAuth) return true;
    res.status(403).json({ reauth: true, message: "Please verify your identity to continue." });
    return false;
  },
}));
// The one email path: the webhook hands each verified platform event to this adapter (spied, never sends).
vi.mock("./account/billing-emails", () => ({ onStripeBillingEvent: mocks.billingEmail }));
// The number-release decision runs after every subscription write (its own tests: server/voice/number-release.test.ts).
vi.mock("./voice/number-release", () => ({ afterSubscriptionChange: mocks.afterSubscriptionChange, previewCallNumberReleases: async () => [] }));

import * as stripeModule from "./stripe";
import { registerStripeRoutes } from "./stripe";
import { cancellationOf, withBillingLock } from "./billing/sync";
import { resetPriceCache } from "./billing/prices";
import { COURSE_BUNDLE, DFY_CATALOG } from "./catalog";
import { PLANS, ADDONS, AGENCY_LOCATION_BANDS, TRIAL_DAYS, agencyMonthlyCents, LEGACY_AGENCY_BASE_CENTS } from "@shared/plans";

const routes = new Map<string, Function>();
registerStripeRoutes({
  get: (path: string, handler: Function) => routes.set(`GET ${path}`, handler),
  post: (path: string, handler: Function) => routes.set(path, handler),
} as any);

async function request(path: string, body: any = {}, extra: any = {}) {
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; }, send(data: any) { this.body = data; return this; } };
  await routes.get(path)!({ user: { id: 42, email: "billing@example.invalid" }, body, headers: {}, session: {}, ...extra }, res);
  return res;
}

/** The Stripe Price params a line item / subscription item points at. */
const priceOf = (id: string) => mocks.prices.get(id);
const lineItems = () => mocks.checkout.mock.calls[0][0].line_items as { price: string; quantity: number }[];

/** A subscription item on a price WE created (role metadata), or a legacy one (no metadata). */
function item(id: string, priceId: string, quantity = 1, role?: { kind: string; key?: string }, interval = "month") {
  return {
    id, quantity,
    price: { ...mocks.prices.get(priceId), id: priceId, recurring: { interval }, metadata: role ? { chub_kind: role.kind, chub_key: role.key ?? "", chub_interval: interval } : {} },
  };
}
function subscription(items: any[], extra: any = {}) {
  return { id: "sub_live", customer: "cus_test", status: "active", items: { data: items.map((i) => ({ current_period_end: 1893456000, ...i })) }, ...extra };
}
const customerRow = (extra: any = {}) => ({ id: 5, userId: 42, stripeCustomerId: "cus_test", stripeSubscriptionId: null, plan: "free", status: "inactive", ...extra });
const liveRow = (extra: any = {}) => customerRow({ stripeSubscriptionId: "sub_live", plan: "pro", status: "active", ...extra });

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  mocks.prices.clear();
  mocks.recentAuth = true;
  mocks.billingEmail.mockClear();
  mocks.seenEvents.clear();
  mocks.invoiceApplied = true;
  mocks.afterSubscriptionChange.mockClear();
  mocks.callAssistantRow = null;
  mocks.accountRow = null;
  mocks.attempt = null;
  mocks.loseCompletion = false;
  mocks.sessionRetrieve.mockReset().mockResolvedValue({ id: "cs_none", status: "expired" });
  mocks.cancel.mockReset().mockResolvedValue({});
  resetPriceCache();
  mocks.pricesList.mockReset().mockImplementation(async ({ lookup_keys }: any) => ({
    data: [...mocks.prices.values()].filter((p) => lookup_keys.includes(p.lookup_key)).map((p) => ({ ...p, recurring: p.recurring ?? null })),
  }));
  mocks.pricesCreate.mockReset().mockImplementation(async (params: any) => {
    const id = `price_${params.lookup_key}`;
    mocks.prices.set(id, { id, ...params });
    return { id };
  });
  mocks.checkout.mockReset().mockResolvedValue({ id: "cs_test_session", url: "https://checkout.example.invalid/session" });
  mocks.openSessions.mockReset().mockResolvedValue({ data: [] });
  mocks.expire.mockReset().mockResolvedValue({});
  mocks.customers.mockReset().mockResolvedValue({ id: "cus_new" });
  mocks.current = null;
  mocks.retrieve.mockReset().mockImplementation(async () => mocks.current);
  mocks.update.mockReset().mockImplementation(async (id: string, params: any) => {
    const onPrice = (itemId: string, priceId: string, quantity: number) => {
      const p = mocks.prices.get(priceId);
      return item(itemId, priceId, quantity, { kind: p.metadata.chub_kind, key: p.metadata.chub_key }, p.recurring.interval);
    };
    let items = [...mocks.current.items.data];
    params.items.forEach((change: any, n: number) => {
      if (change.deleted) items = items.filter((i) => i.id !== change.id);
      else if (change.id) items = items.map((i) => i.id === change.id ? onPrice(i.id, change.price, change.quantity) : i);
      else items.push(onPrice(`si_new_${n}`, change.price, change.quantity));
    });
    // Stripe's state changes with the update: what retrieve answers from here on (the transition reads it under the lock).
    const next = subscription(items, { id, metadata: { ...mocks.current.metadata, ...params.metadata } });
    mocks.current = next;
    return next;
  });
  mocks.history.mockReset().mockResolvedValue({ data: [] });
  mocks.verify.mockReset();
  mocks.sql.length = 0;
  mocks.cancelRow = {};
});

/** The plain-SQL cancellation writes, as [where value, cancel_at_period_end, cancel_at]. */
const cancellationWrites = () => mocks.sql.filter((q) => /SET cancel_at_period_end/.test(q.text)).map((q) => q.values);

describe("GET /api/stripe/plans", () => {
  it("returns the shared price book — five plans, add-ons, the legacy Agency bands, a 1-day trial; no free or retired plans", async () => {
    const res = await request("GET /api/stripe/plans");
    expect(res.body.plans.map((p: any) => p.key)).toEqual(["starter", "team", "pro", "growth", "agency"]);
    expect(res.body.plans.map((p: any) => [p.monthlyCents, p.annualCents])).toEqual([[2900, 29000], [4900, 49000], [9900, 99000], [19900, 199000], [44900, 449000]]);
    expect(res.body.addons.map((a: any) => a.key)).toEqual(Object.keys(ADDONS));
    // Unlimited has no location cap (-1); the graduated bands stay to read stored 2026-09-30 rows.
    expect(res.body.agency).toEqual({ includedLocations: -1, bands: AGENCY_LOCATION_BANDS, selfServeMaxLocations: 500 });
    expect(res.body.trialDays).toBe(1);
    expect(res.body.salesThresholdCents).toBe(100000);
    expect(JSON.stringify(res.body)).not.toMatch(/platinum|gold|"free"/i);
  });
});

describe("POST /api/stripe/create-checkout", () => {
  it("Pro monthly: one Stripe Price from the price book, created once by lookup key, 1-day trial", async () => {
    mocks.rows.push([customerRow()]);
    const res = await request("/api/stripe/create-checkout", { plan: "pro", interval: "month", price: 1 });
    expect(res.code).toBe(200);
    const args = mocks.checkout.mock.calls[0][0];
    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_test");
    expect(args.subscription_data.trial_period_days).toBe(TRIAL_DAYS);
    expect(args.metadata).toMatchObject({ userId: "42", type: "plan", plan: "pro", interval: "month" });
    expect(lineItems()).toEqual([{ price: "price_chub_v1_plan_pro_month_9900", quantity: 1 }]);
    const [params, options] = mocks.pricesCreate.mock.calls[0];
    expect(params).toMatchObject({ currency: "usd", unit_amount: 9900, recurring: { interval: "month" }, lookup_key: "chub_v1_plan_pro_month_9900", transfer_lookup_key: true, metadata: { chub_kind: "plan", chub_key: "pro" } });
    expect(options.idempotencyKey).toBe("chub-price-chub_v1_plan_pro_month_9900");
  });

  it("reuses an existing Stripe Price instead of creating another", async () => {
    mocks.rows.push([customerRow()], [customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "pro" });
    resetPriceCache(); // a restart: the price is found by lookup key in Stripe
    await request("/api/stripe/create-checkout", { plan: "pro" });
    expect(mocks.pricesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.checkout.mock.calls[1][0].line_items[0].price).toBe("price_chub_v1_plan_pro_month_9900");
  });

  it("annual billing is 10x monthly on a yearly price", async () => {
    mocks.rows.push([customerRow()]);
    expect((await request("/api/stripe/create-checkout", { plan: "growth", interval: "year" })).code).toBe(200);
    expect(priceOf(lineItems()[0].price)).toMatchObject({ unit_amount: PLANS.growth.annualCents, recurring: { interval: "year" } });
  });

  it("a NEW Unlimited checkout carries no band line and no locations metadata — a count a stale client still sends is validated but not billed", async () => {
    // Unlimited has no location cap, so a new checkout never bills the retired Agency bands.
    for (const locations of [25, 4]) {
      mocks.rows.push([customerRow()]);
      expect((await request("/api/stripe/create-checkout", { plan: "agency", interval: "month", locations })).code).toBe(200);
      expect(lineItems()).toEqual([{ price: "price_chub_v1_plan_agency_month_44900", quantity: 1 }]);
      expect(priceOf(lineItems()[0].price)).toMatchObject({ unit_amount: PLANS.agency.monthlyCents, recurring: { interval: "month" } });
      expect(mocks.checkout.mock.calls[0][0].metadata.locations).toBe("");
      mocks.checkout.mockClear();
    }
    // The graduated-band maths are legacy but unchanged ($349 base + 15 × $15 = $574):
    // they still read and bill the stored 2026-09-30 Agency rows.
    expect(agencyMonthlyCents(25)).toBe(LEGACY_AGENCY_BASE_CENTS + 15 * 1500);
  });

  it("Unlimited annual is a single yearly plan price — no band line, no locations metadata", async () => {
    mocks.rows.push([customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "agency", interval: "year", locations: 60 });
    expect(lineItems()).toEqual([{ price: "price_chub_v1_plan_agency_year_449000", quantity: 1 }]);
    expect(priceOf(lineItems()[0].price)).toMatchObject({ unit_amount: PLANS.agency.annualCents, recurring: { interval: "year" } });
    expect(mocks.checkout.mock.calls[0][0].metadata.locations).toBe("");
  });

  it("Agency above 500 locations is talk-to-sales, before any Stripe call", async () => {
    const res = await request("/api/stripe/create-checkout", { plan: "agency", locations: 501 });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe("talk_to_sales");
    expect(res.body.message).toMatch(/sales rep/);
    expect(mocks.pricesList).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("add-ons ride the plan as recurring items; the texting number's setup fee is one-time", async () => {
    mocks.rows.push([customerRow()]);
    const res = await request("/api/stripe/create-checkout", { plan: "pro", addons: { competitor_pack: 2, texting_number: 1, protected_site: 1 } });
    expect(res.code).toBe(200);
    const lines = lineItems().map((l) => ({ ...l, p: priceOf(l.price) }));
    expect(lines.map((l) => [l.p.metadata.chub_kind, l.p.metadata.chub_key, l.quantity])).toEqual([
      ["plan", "pro", 1],
      ["addon", "protected_site", 1],
      ["addon", "texting_number", 1],
      ["setup", "texting_number", 1],
      ["addon", "competitor_pack", 2],
    ]);
    expect(lines[4].p).toMatchObject({ unit_amount: ADDONS.competitor_pack.monthlyCents, recurring: { interval: "month" } });
    const setup = lines[3].p;
    expect(setup.unit_amount).toBe(ADDONS.texting_number.setupCents);
    expect(setup.recurring).toBeUndefined();
    expect(JSON.parse(mocks.checkout.mock.calls[0][0].metadata.addons)).toEqual({ competitor_pack: 2, texting_number: 1, protected_site: 1 });
  });

  it.each([
    // protected_site is sold on starter now; Unlimited includes unlimited protected sites, so it is not sold there.
    [{ plan: "agency", addons: { protected_site: 1 } }, 400, /isn't available on the Unlimited plan/],
    // extra_seat starts at Team.
    [{ plan: "starter", addons: { extra_seat: 1 } }, 400, /isn't available on the Solo plan/],
    // extra_location is retired (sold on no plan; stored rows still read).
    [{ plan: "agency", addons: { extra_location: 1 } }, 400, /isn't available on the Unlimited plan/],
    [{ plan: "starter", addons: { extra_location: 9 } }, 400, /isn't available on the Solo plan/],
    [{ plan: "pro", addons: { nope: 1 } }, 400, /Unknown add-on/],
    [{ plan: "pro", addons: { extra_seat: -1 } }, 400, /whole number/],
    [{ plan: "pro", addons: { extra_seat: 1.5 } }, 400, /whole number/],
    [{ plan: "pro", addons: { extra_seat: 101 } }, 409, /sales rep/],
    [{ plan: "platinum" }, 400, /no longer sold/],
    [{ plan: "free" }, 400, /Invalid plan/],
    [{ plan: "pro", interval: "week" }, 400, /month.*year/],
    [{ plan: "agency", locations: 0 }, 400, /whole number/],
  ])("refuses %j before contacting Stripe", async (body, code, message) => {
    const res = await request("/api/stripe/create-checkout", body);
    expect(res.code).toBe(code);
    expect(res.body.message).toMatch(message);
    expect(mocks.pricesList).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("the retired extra-location add-on is refused on every plan (a bigger plan includes more)", async () => {
    mocks.rows.push([customerRow()]);
    const res = await request("/api/stripe/create-checkout", { plan: "starter", addons: { extra_location: 8 } });
    expect(res.code).toBe(400);
    expect(res.body).toMatchObject({ code: "addon_unavailable" });
    expect(res.body.message).toMatch(/Extra location isn't available on the Solo plan/);
    expect(mocks.pricesList).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("an existing live subscription is never sent to a second checkout", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      mocks.rows.push([liveRow({ status })]);
      const res = await request("/api/stripe/create-checkout", { plan: "growth" });
      expect(res.code).toBe(409);
      expect(res.body.code).toBe("has_subscription");
    }
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("a past-due subscriber is pointed at Manage billing, not a second checkout", async () => {
    mocks.rows.push([liveRow({ status: "past_due" })]);
    const res = await request("/api/stripe/create-checkout", { plan: "pro" });
    expect(res.code).toBe(409);
    expect(res.body.message).toMatch(/Manage billing/);
  });

  it("expires another open plan checkout for the customer first (two tabs can't start two subscriptions)", async () => {
    mocks.rows.push([customerRow()]);
    mocks.openSessions.mockResolvedValue({ data: [{ id: "cs_other_tab", mode: "subscription" }, { id: "cs_cart", mode: "payment" }] });
    expect((await request("/api/stripe/create-checkout", { plan: "pro" })).code).toBe(200);
    expect(mocks.openSessions).toHaveBeenCalledWith({ customer: "cus_test", status: "open", limit: 10 });
    expect(mocks.expire.mock.calls).toEqual([["cs_other_tab"]]);
    expect(mocks.expire.mock.invocationCallOrder[0]).toBeLessThan(mocks.checkout.mock.invocationCallOrder[0]);
  });

  it("one trial per account: a customer who had a subscription before checks out without one", async () => {
    mocks.rows.push([liveRow({ status: "canceled", plan: "free" })]);
    expect((await request("/api/stripe/create-checkout", { plan: "pro" })).code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].subscription_data.trial_period_days).toBeUndefined();
  });

  it("one trial per account even after a trial code cleared the row's subscription id (Stripe's own history decides)", async () => {
    // A trial-code grant that ran out, on a customer whose old subscription ended.
    mocks.rows.push([customerRow({ plan: "agency", status: "trialing", currentPeriodEnd: new Date("2026-01-01T00:00:00Z") })]);
    mocks.history.mockResolvedValue({ data: [{ id: "sub_old", status: "canceled" }] });
    expect((await request("/api/stripe/create-checkout", { plan: "pro" })).code).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith({ customer: "cus_test", status: "all", limit: 20 });
    expect(mocks.checkout.mock.calls[0][0].subscription_data.trial_period_days).toBeUndefined();
  });

  it("a live trial-code grant (no Stripe subscription) may buy a plan, and still gets the trial when Stripe has no history", async () => {
    mocks.rows.push([customerRow({ plan: "agency", status: "trialing", currentPeriodEnd: new Date(Date.now() + 86400_000) })]);
    const res = await request("/api/stripe/create-checkout", { plan: "growth" });
    expect(res.code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].subscription_data.trial_period_days).toBe(TRIAL_DAYS);
  });

  it("a subscription Stripe has but the row doesn't know yet (webhook still on its way) is never joined by a second one", async () => {
    for (const status of ["active", "past_due"]) {
      mocks.rows.push([customerRow()]);
      mocks.history.mockResolvedValue({ data: [subscription([item("si_plan", "price_x", 1, { kind: "plan", key: "growth" })], { id: "sub_just_paid", status })] });
      const res = await request("/api/stripe/create-checkout", { plan: "pro" });
      expect(res.code).toBe(409);
      expect(res.body.code).toBe("has_subscription");
      expect(res.body.message).toMatch(status === "past_due" ? /Manage billing/ : /updates it in place/);
      // The row records it now (as the webhook will), so Pricing can change it in place.
      expect(mocks.updates.at(-1)).toMatchObject({ stripeSubscriptionId: "sub_just_paid", status, plan: "growth" });
    }
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("a brand-new customer is not looked up in Stripe's history (there is none)", async () => {
    mocks.rows.push([]);
    expect((await request("/api/stripe/create-checkout", { plan: "starter" })).code).toBe(200);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.checkout.mock.calls[0][0].subscription_data.trial_period_days).toBe(TRIAL_DAYS);
  });

  it("two checkouts started at the same moment run one after the other, so the second expires the first", async () => {
    const open: any[] = [];
    let n = 0;
    mocks.checkout.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      const session = { id: `cs_${++n}`, mode: "subscription", url: `https://checkout.example.invalid/${n}` };
      open.push(session);
      return session;
    });
    mocks.openSessions.mockImplementation(async () => ({ data: [...open] }));
    mocks.expire.mockImplementation(async (id: string) => { open.splice(open.findIndex((s) => s.id === id), 1); return {}; });
    mocks.rows.push([customerRow()], [customerRow()]);
    const [a, b] = await Promise.all([
      request("/api/stripe/create-checkout", { plan: "pro" }),
      request("/api/stripe/create-checkout", { plan: "growth" }),
    ]);
    expect([a.code, b.code]).toEqual([200, 200]);
    expect(mocks.expire.mock.calls).toEqual([["cs_1"]]);
    expect(open.map((s) => s.id)).toEqual(["cs_2"]); // one open checkout, so at most one subscription
  });

  it("the per-account billing lock serializes work for one account and not across accounts", async () => {
    const order: string[] = [];
    const slow = (tag: string, ms: number) => async () => { order.push(`${tag}+`); await new Promise((r) => setTimeout(r, ms)); order.push(`${tag}-`); };
    await Promise.all([withBillingLock(1, slow("a1", 10)), withBillingLock(1, slow("a2", 1)), withBillingLock(2, slow("b", 1))]);
    expect(order.indexOf("a1-")).toBeLessThan(order.indexOf("a2+"));
    expect(order.indexOf("b+")).toBeLessThan(order.indexOf("a1-"));
    // A failure releases the lock.
    await expect(withBillingLock(1, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withBillingLock(1, async () => "next")).toBe("next");
  });

  it("creates the Stripe customer when the user has none", async () => {
    mocks.rows.push([]);
    expect((await request("/api/stripe/create-checkout", { plan: "starter" })).code).toBe(200);
    expect(mocks.customers).toHaveBeenCalledWith({ email: "billing@example.invalid", metadata: { userId: "42" } });
    expect(mocks.inserts[0]).toMatchObject({ userId: 42, stripeCustomerId: "cus_new", plan: "free", status: "inactive" });
    expect(mocks.checkout.mock.calls[0][0].customer).toBe("cus_new");
  });
});

describe("POST /api/stripe/change-plan and /api/stripe/addons (no second subscription)", () => {
  async function seedProSubscription(extraItems: any[] = [], interval = "month") {
    // Create the prices the current subscription is on, as checkout would have.
    mocks.rows.push([customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "pro", interval, addons: { texting_number: 1 } });
    mocks.checkout.mockClear();
    mocks.pricesCreate.mockClear();
    const planPrice = `price_chub_v1_plan_pro_${interval}_${interval === "year" ? 99000 : 9900}`;
    const textPrice = `price_chub_v1_addon_texting_number_${interval}_${interval === "year" ? 29000 : 2900}`;
    mocks.current = subscription([
      item("si_plan", planPrice, 1, { kind: "plan", key: "pro" }, interval),
      item("si_text", textPrice, 1, { kind: "addon", key: "texting_number" }, interval),
      ...extraItems,
    ]);
    return mocks.current;
  }

  it("Pro → Growth updates the existing subscription's items with proration; no checkout", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "growth", addons: { texting_number: 0 } });
    expect(res.code).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [id, params] = mocks.update.mock.calls[0];
    expect(id).toBe("sub_live");
    expect(params.proration_behavior).toBe("always_invoice");
    expect(params.payment_behavior).toBe("error_if_incomplete");
    expect(params.items).toEqual([
      { id: "si_plan", price: "price_chub_v1_plan_growth_month_19900", quantity: 1 },
      { id: "si_text", deleted: true },
    ]);
    expect(mocks.updates[0]).toMatchObject({ plan: "growth", stripeSubscriptionId: "sub_live", billingInterval: "month", addons: {}, agencyLocations: null });
    expect(res.body.subscription).toMatchObject({ plan: "growth", effectivePlan: "growth" });
  });

  it("removes a held add-on included by the new plan (Unlimited includes protected sites)", async () => {
    await seedProSubscription([item("si_site", "price_chub_v1_addon_protected_site_month_1500", 1, { kind: "addon", key: "protected_site" }, "month")]);
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "agency" });
    expect(res.code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toContainEqual({ id: "si_site", deleted: true });
  });

  it("month → year reprices every item to its yearly price", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "pro", interval: "year" })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([
      { id: "si_plan", price: "price_chub_v1_plan_pro_year_99000", quantity: 1 },
      { id: "si_text", price: "price_chub_v1_addon_texting_number_year_29000", quantity: 1 },
    ]);
    expect(mocks.update.mock.calls[0][1].add_invoice_items).toBeUndefined(); // no second setup fee
  });

  it("switching to Unlimited never adds a band line — there is no location count on the new book", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "agency", locations: 30 })).code).toBe(200);
    const items = mocks.update.mock.calls[0][1].items;
    expect(items).toEqual([
      { id: "si_plan", price: "price_chub_v1_plan_agency_month_44900", quantity: 1 },
    ]);
    expect(items.some((i: any) => String(i.price ?? "").startsWith("price_chub_v1_agencyloc"))).toBe(false);
    expect(mocks.updates[0]).toMatchObject({ plan: "agency", agencyLocations: null, addons: { texting_number: 1 } });
  });

  it("an unchanged order touches nothing", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "pro" });
    expect(res.body.changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a legacy subscription (one old ad-hoc plan price) is moved onto the new plan in place", async () => {
    mocks.current = subscription([item("si_old", "price_legacy_premium")]);
    mocks.rows.push([liveRow({ plan: "premium" })]);
    expect((await request("/api/stripe/change-plan", { plan: "pro", interval: "year" })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([
      { id: "si_old", price: "price_chub_v1_plan_pro_year_99000", quantity: 1 },
    ]);
  });

  it("never removes an item a sales rep added: it's kept, and a change it can't ride along with is talk-to-sales", async () => {
    const custom = item("si_custom", "price_quoted_setup_retainer");
    await seedProSubscription([custom]);
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "growth", addons: { texting_number: 0 } })).code).toBe(200);
    const items = mocks.update.mock.calls[0][1].items;
    expect(items).toEqual([
      { id: "si_plan", price: "price_chub_v1_plan_growth_month_19900", quantity: 1 },
      { id: "si_text", deleted: true },
    ]);
    expect(items.some((i: any) => i.id === "si_custom")).toBe(false);

    // Moving to yearly would leave the monthly custom item on another interval: refused, nothing changed.
    mocks.update.mockClear();
    mocks.rows.push([liveRow()]);
    const yearly = await request("/api/stripe/change-plan", { plan: "pro", interval: "year" });
    expect(yearly.code).toBe(409);
    expect(yearly.body.code).toBe("talk_to_sales");
    expect(mocks.update).not.toHaveBeenCalled();

    // No plan item of ours and several foreign items: which one is the plan is unclear — refused.
    mocks.current = subscription([item("si_old", "price_legacy_premium"), item("si_old2", "price_quoted")]);
    mocks.rows.push([liveRow({ plan: "premium" })]);
    const unclear = await request("/api/stripe/change-plan", { plan: "pro" });
    expect(unclear.code).toBe(409);
    expect(unclear.body.message).toMatch(/sales rep set up/);
    expect(mocks.update).not.toHaveBeenCalled();

    // One custom price and no plan item of ours, on an account that was never sold a legacy plan
    // (e.g. a sales-quoted Agency above 500 locations): not repriced to a self-serve plan — refused.
    for (const plan of ["free", "agency", null]) {
      mocks.current = subscription([item("si_quoted", "price_quoted_agency_800_locations")]);
      mocks.rows.push([liveRow({ plan })]);
      const quoted = await request("/api/stripe/change-plan", { plan: "agency", locations: 10 });
      expect(quoted.code, String(plan)).toBe(409);
      expect(quoted.body.code).toBe("talk_to_sales");
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a duplicate item on one of our own prices is removed", async () => {
    await seedProSubscription([item("si_dup", "price_chub_v1_plan_pro_month_9900", 1, { kind: "plan", key: "pro" })]);
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "pro", addons: { texting_number: 0 } })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ id: "si_dup", deleted: true }, { id: "si_text", deleted: true }]);
  });

  it("without a live subscription it's a 409 — and never a Stripe call", async () => {
    mocks.rows.push([customerRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "growth" });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe("no_subscription");
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("asks for step-up verification before changing what the saved card pays", async () => {
    mocks.recentAuth = false;
    const res = await request("/api/stripe/change-plan", { plan: "growth" });
    expect(res.code).toBe(403);
    expect(res.body.reauth).toBe(true);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("a declined card leaves the plan unchanged and says so (402 payment_failed)", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    mocks.update.mockRejectedValue(Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402 }));
    const res = await request("/api/stripe/change-plan", { plan: "agency" });
    expect(res.code).toBe(402);
    expect(res.body.code).toBe("payment_failed");
    expect(mocks.updates).toHaveLength(0);
  });

  it("add-ons: set quantities on the current plan; a new texting number adds its one-time setup fee", async () => {
    const sub = await seedProSubscription();
    // Drop the texting item so adding it is new.
    sub.items.data = sub.items.data.filter((i: any) => i.id !== "si_text");
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/addons", { addons: { competitor_pack: 2, texting_number: 1 } });
    expect(res.code).toBe(200);
    const params = mocks.update.mock.calls[0][1];
    expect(params.items).toEqual([
      { price: "price_chub_v1_addon_texting_number_month_2900", quantity: 1 },
      { price: "price_chub_v1_addon_competitor_pack_month_1900", quantity: 2 },
    ]);
    expect(params.add_invoice_items).toEqual([{ price: "price_chub_v1_setup_texting_number_2900", quantity: 1 }]);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.updates[0].addons).toEqual({ competitor_pack: 2, texting_number: 1 });
  });

  it("add-ons: 0 removes one; unavailable ones and legacy plans are refused", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/addons", { addons: { texting_number: 0 } })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ id: "si_text", deleted: true }]);
    // An add-on change re-decides the account's Call Assistant numbers (fewer paid for → extras released).
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);

    // protected_site is sold on starter now; extra_seat starts at Team, so it is the refused one.
    mocks.current = subscription([item("si_plan", "price_x", 1, { kind: "plan", key: "starter" })]);
    mocks.rows.push([liveRow({ plan: "starter" })]);
    const refused = await request("/api/stripe/addons", { addons: { extra_seat: 1 } });
    expect(refused.code).toBe(400);
    expect(refused.body.message).toMatch(/isn't available on the Solo plan/);

    mocks.current = subscription([item("si_old", "price_legacy_premium")]);
    mocks.rows.push([liveRow({ plan: "premium" })]);
    const legacy = await request("/api/stripe/addons", { addons: { extra_seat: 1 } });
    expect(legacy.code).toBe(409);
    expect(legacy.body.code).toBe("legacy_plan");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("Call Assistant lines are refused on the platform subscription (a separate service with its own checkout): nothing reaches Stripe", async () => {
    for (const body of [{ plan: "pro", addons: { call_assistant_lite: 1 } }, { plan: "agency", addons: { call_assistant: 1, call_number: 1 } }, { plan: "growth", addons: { call_number: 1 } }]) {
      const res = await request("/api/stripe/create-checkout", body);
      expect(res.code, JSON.stringify(body)).toBe(400);
      expect(res.body).toMatchObject({ code: "addon_unavailable" });
      expect(res.body.message).toMatch(/isn't a plan add-on.*separate service with its own subscription, from \$249\/mo/);
    }
    expect(mocks.checkout).not.toHaveBeenCalled();
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const sw = await request("/api/stripe/addons", { addon: "call_assistant_crew", quantity: 1 });
    expect(sw.code).toBe(400);
    expect(sw.body.message).toMatch(/isn't a plan add-on/);
    expect(mocks.update).not.toHaveBeenCalled();
    // No intro coupon exists any more (the launch intro ended with the 2026-10-08 repricing): no grant row is ever written.
    expect(mocks.sql.filter((q) => /INSERT INTO billing_addon_intros/.test(q.text))).toEqual([]);
  });

  it("add-ons: one add-on as { addon, quantity } (the Settings card's body) works like { addons }", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/addons", { addon: "competitor_pack", quantity: 2 });
    expect(res.code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ price: "price_chub_v1_addon_competitor_pack_month_1900", quantity: 2 }]);
    expect(mocks.updates[0].addons).toEqual({ competitor_pack: 2, texting_number: 1 });

    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/addons", { addon: "texting_number", quantity: 0 })).code).toBe(200);
    expect(mocks.update.mock.calls[1][1].items).toEqual([{ id: "si_text", deleted: true }]);

    for (const body of [{ addon: "nope", quantity: 1 }, { addon: "extra_seat", quantity: -1 }, { addon: "extra_seat", quantity: "2" }]) {
      expect((await request("/api/stripe/addons", body)).code).toBe(400);
    }
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("GET /api/stripe/subscription also reports interval and locations (a yearly subscriber's change stays yearly)", async () => {
    mocks.rows.push([liveRow({ plan: "agency", billingInterval: "year", agencyLocations: 25, addons: { extra_seat: 1 } })]);
    mocks.cancelRow = { cancel_at_period_end: false, cancel_at: null };
    const res = await request("GET /api/stripe/subscription");
    expect(res.body).toMatchObject({
      plan: "agency", effectivePlan: "agency", billingInterval: "year", interval: "year",
      agencyLocations: 25, locations: 25, addons: { extra_seat: 1 }, cancelAtPeriodEnd: false, cancelAt: null,
    });
    mocks.rows.push([]);
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ plan: "free", interval: null, locations: null, cancelAtPeriodEnd: null });
  });

  it("GET /api/stripe/subscription says when a subscription is set to end (cancelAtPeriodEnd), and null before it was ever synced", async () => {
    mocks.rows.push([liveRow({ currentPeriodEnd: new Date("2026-11-01T00:00:00Z") })]);
    mocks.cancelRow = { cancel_at_period_end: true, cancel_at: new Date("2026-11-01T00:00:00Z") };
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ status: "active", cancelAtPeriodEnd: true, cancelAt: new Date("2026-11-01T00:00:00Z") });
    mocks.rows.push([liveRow()]);
    mocks.cancelRow = { cancel_at_period_end: null, cancel_at: null };
    expect((await request("GET /api/stripe/subscription")).body.cancelAtPeriodEnd).toBeNull();
  });

  it("GET /api/stripe/subscription reports an expired trial-code grant as inactive, a live one as its plan", async () => {
    const grant = (end: Date) => customerRow({ stripeCustomerId: null, plan: "agency", status: "trialing", currentPeriodEnd: end });
    mocks.rows.push([grant(new Date(Date.now() - 60_000))]);
    const expired = (await request("GET /api/stripe/subscription")).body;
    expect(expired).toMatchObject({ plan: "agency", status: "inactive", effectivePlan: null, cancelAtPeriodEnd: null });
    mocks.rows.push([grant(new Date(Date.now() + 86400_000))]);
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ status: "trialing", effectivePlan: "agency" });
    // A revoked trial keeps saying so.
    mocks.rows.push([{ ...grant(new Date(Date.now() - 60_000)), status: "canceled" }]);
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ status: "canceled", effectivePlan: null });
    // No cancellation lookup for a grant: it isn't a Stripe subscription.
    expect(mocks.sql.some((q) => /SELECT cancel_at_period_end/.test(q.text))).toBe(false);
  });

  it("no plan access while a payment is owed (past_due, unpaid) or after it ended (owner, 2026-10-04)", async () => {
    mocks.rows.push([liveRow({ status: "past_due" })]);
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ status: "past_due", effectivePlan: null });
    for (const status of ["unpaid", "canceled", "incomplete_expired", "incomplete"]) {
      mocks.rows.push([liveRow({ status })]);
      expect((await request("GET /api/stripe/subscription")).body.effectivePlan, status).toBeNull();
    }
  });

  it("a plan change records the subscription's cancellation state with the row", async () => {
    await seedProSubscription();
    mocks.current.cancel_at_period_end = true;
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "pro", addons: { competitor_pack: 1 } });
    expect(res.code).toBe(200);
    // The mocked update returns a fresh subscription (not set to cancel); the fixture carries no start_date.
    expect(cancellationWrites()).toEqual([[5, false, null, null]]);
    expect(res.body.subscription).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it("a row still marked live whose Stripe subscription ended is corrected, so checkout is no longer refused", async () => {
    mocks.current = subscription([item("si_plan", "price_x", 1, { kind: "plan", key: "pro" })], { status: "canceled" });
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "growth" });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe("no_subscription");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updates[0]).toMatchObject({ stripeSubscriptionId: "sub_live", status: "canceled" });
  });
});

describe("the AI Call Assistant's own subscription (server/voice/subscription.ts): a separate service, with or without a plan", () => {
  const liveCallAssistant = (extra: any = {}) => ({ id: 9, user_id: 42, stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", stripe_price_id: "price_x", tier: "solo", extra_numbers: 0, status: "active", billing_interval: "month", current_period_end: null, cancel_at_period_end: false, ...extra });
  const caSubscription = (items: any[], extra: any = {}) => subscription(items, { id: "sub_ca", metadata: { product: "call_assistant", userId: "42" }, ...extra });
  const caInsert = () => mocks.sql.filter((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text)).map((q) => q.values);

  it("GET plans: the four tiers, the extra number, 50¢ overage, 11-month yearly, no trial, its own pricing section", async () => {
    const res = await request("GET /api/call-assistant/billing/plans");
    expect(res.body.tiers.map((t: any) => [t.tier, t.name, t.monthlyCents, t.annualCents, t.includedMinutes, t.includedNumbers, t.overageCentsPerMinute])).toEqual([
      ["lite", "500 minutes", 24900, 273900, 500, 1, 50], ["solo", "1,000 minutes", 34900, 383900, 1000, 1, 50],
      ["crew", "2,000 minutes", 44900, 493900, 2000, 2, 50], ["fleet", "5,000 minutes", 99900, 1098900, 5000, 5, 50],
    ]);
    expect(res.body).toMatchObject({ currency: "usd", overageCentsPerMinute: 50, annualMonths: 11, trialDays: 0, freeSpamCalls: 500, extraNumber: { monthlyCents: 500, annualCents: 5000, max: 100 }, pricingHref: "/pricing#call-assistant" });
  });

  it("checkout: the tier and extra numbers on their own Stripe subscription (product=call_assistant), no trial, no coupon, no platform plan needed", async () => {
    mocks.rows.push([customerRow()]); // getOrCreateCustomer reads the platform row for the customer id (the account has no plan)
    const res = await request("/api/call-assistant/billing/checkout", { tier: "crew", interval: "year", extraNumbers: 2 });
    expect(res.code, JSON.stringify(res.body)).toBe(200);
    const args = mocks.checkout.mock.calls[0][0];
    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_test");
    expect(args.subscription_data).toEqual({ metadata: { userId: "42", type: "call_assistant", product: "call_assistant", tier: "crew", interval: "year", extraNumbers: "2" } });
    // The session also names its attempt (so stale-session cleanup can tell this attempt's own session apart); the subscription's metadata does not.
    expect(args.metadata).toEqual({ ...args.subscription_data.metadata, attempt: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(args.discounts).toBeUndefined();
    expect(args.success_url).toMatch(/\/pricing\?call_assistant_success=true#call-assistant$/);
    expect(args.cancel_url).toMatch(/\/pricing\?call_assistant_canceled=true#call-assistant$/);
    expect(lineItems().map((l) => [priceOf(l.price).metadata.chub_kind, priceOf(l.price).metadata.chub_key, priceOf(l.price).unit_amount, priceOf(l.price).recurring.interval, l.quantity])).toEqual([
      ["addon", "call_assistant_crew", 493900, "year", 1], ["addon", "call_number", 5000, "year", 2],
    ]);
    expect(priceOf(lineItems()[0].price).product_data.name).toBe("ConstructHUB AI Call Assistant — 2,000 minutes");
    expect(priceOf(lineItems()[0].price).lookup_key).toBe("chub_v1_addon_call_assistant_crew_year_493900");
    // The platform row is untouched, and no intro grant is recorded.
    expect(mocks.updates).toEqual([]);
    expect(mocks.sql.filter((q) => /billing_addon_intros/.test(q.text))).toEqual([]);
    // The attempt row was written BEFORE Stripe was asked (the account's checkout lock across processes), the create
    // carries its idempotency key, and the completion write came after (conditional on the attempt still being ours).
    const key = mocks.checkout.mock.calls[0][1].idempotencyKey as string;
    expect(key).toMatch(/^chub-ca-checkout-[0-9a-f-]{36}$/);
    const attempt = mocks.sql.find((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text))!;
    expect(attempt.values.slice(1)).toEqual([42, "checkout", "crew:year:2", "cus_test", null, key]);
    expect(attempt.values[0]).toBe(key.replace("chub-ca-checkout-", ""));
    const completion = mocks.sql.find((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text))!;
    expect(completion.values.slice(0, 4)).toEqual([attempt.values[0], "open", "creating", "cs_test_session"]);
    expect(mocks.sql.indexOf(attempt)).toBeLessThan(mocks.sql.indexOf(completion));
  });

  it("an attempt still being created for the same order (another process, or a crash after the create) is resumed under its own key, so Stripe answers with the same session; another order while one is in flight waits (409)", async () => {
    mocks.attempt = { id: "11111111-1111-4111-8111-111111111111", user_id: 42, kind: "checkout", state: "creating", order_key: "lite:month:0", stripe_customer_id: "cus_test", idempotency_key: "chub-ca-checkout-11111111-1111-4111-8111-111111111111", session_id: null, session_url: null, created_at: new Date().toISOString() };
    mocks.rows.push([customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.checkout.mock.calls[0][1]).toEqual({ idempotencyKey: "chub-ca-checkout-11111111-1111-4111-8111-111111111111" });
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text))).toBe(false);
    // Another order while an attempt is still being created (another process mid-create): wait.
    mocks.checkout.mockClear();
    mocks.attempt = { ...mocks.attempt, state: "creating", session_id: null, session_url: null };
    mocks.rows.push([customerRow()]);
    const other = await request("/api/call-assistant/billing/checkout", { tier: "crew" });
    expect(other.code).toBe(409);
    expect(other.body.code).toBe("checkout_in_progress");
    expect(mocks.checkout).not.toHaveBeenCalled();
    // A tier change while a checkout is in flight waits too.
    mocks.callAssistantRow = liveCallAssistant();
    const change = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(change.code).toBe(409);
    expect(change.body.code).toBe("checkout_in_progress");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ tier: "mega" }, 400, "unknown_tier"],
    [{}, 400, "unknown_tier"],
    [{ tier: "lite", interval: "week" }, 400, "unknown_interval"],
    [{ tier: "lite", extraNumbers: -1 }, 400, "bad_quantity"],
    [{ tier: "lite", extraNumbers: 1.5 }, 400, "bad_quantity"],
    [{ tier: "lite", extraNumbers: 101 }, 409, "talk_to_sales"],
  ])("checkout refuses %j before contacting Stripe", async (body, code, errorCode) => {
    const res = await request("/api/call-assistant/billing/checkout", body);
    expect(res.code).toBe(code);
    expect(res.body.code).toBe(errorCode);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.pricesList).not.toHaveBeenCalled();
  });

  it("one Call Assistant subscription per account: a live row, or one Stripe has that the row missed, refuses a second checkout", async () => {
    mocks.callAssistantRow = liveCallAssistant();
    const again = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(again.code).toBe(409);
    expect(again.body.code).toBe("has_call_assistant_subscription");
    expect(mocks.checkout).not.toHaveBeenCalled();

    mocks.callAssistantRow = null;
    mocks.rows.push([customerRow()]);
    mocks.current = caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "active" });
    mocks.history.mockResolvedValue({ data: [mocks.current] });
    const lagging = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(lagging.code).toBe(409);
    expect(lagging.body.code).toBe("has_call_assistant_subscription");
    // The row is recorded now (as the webhook will) and the number-release decision runs.
    expect(caInsert()[0].slice(0, 7)).toEqual([42, "cus_test", "sub_ca", "price_lite", "lite", 0, "active"]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("the two products never block each other: a live Call Assistant subscription does not stop a platform checkout (or its trial), and the other way round", async () => {
    mocks.rows.push([customerRow()]);
    mocks.history.mockResolvedValue({ data: [caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "active" })] });
    const plan = await request("/api/stripe/create-checkout", { plan: "pro" });
    expect(plan.code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].subscription_data.trial_period_days).toBe(TRIAL_DAYS);
    mocks.checkout.mockClear();
    mocks.rows.push([customerRow()]);
    mocks.history.mockResolvedValue({ data: [subscription([item("si_plan", "price_pro", 1, { kind: "plan", key: "pro" })], { id: "sub_plan", status: "active" })] });
    const ca = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(ca.code, JSON.stringify(ca.body)).toBe(200);
  });

  it("a platform admin already has the service: refused, and Stripe is never asked", async () => {
    // The account row carries a platform-admin email (server/admin.ts ADMIN_EMAILS), as getEntitlements reads it.
    const { ADMIN_EMAILS } = await import("./admin");
    mocks.accountRow = { email: ADMIN_EMAILS[0], plan: "free", status: "inactive" };
    const res = await request("/api/call-assistant/billing/checkout", { tier: "lite" }, { user: { id: 42, email: ADMIN_EMAILS[0] } });
    expect(res.code).toBe(400);
    expect(res.body.message).toMatch(/already includes the AI Call Assistant/);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.openSessions).not.toHaveBeenCalled();
    expect(mocks.pricesList).not.toHaveBeenCalled();
    expect(mocks.sql.filter((q) => /call_assistant_subscriptions/.test(q.text) && !/^\s*SELECT u\.email/.test(q.text))).toEqual([]);
    // The same account without the admin email is an ordinary customer: the checkout goes ahead.
    mocks.accountRow = { email: "billing@example.invalid", plan: "free", status: "inactive" };
    mocks.rows.push([customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
  });

  it("the checkout's open session lives on its attempt row and is re-read by its id: the same order is sent back to it, another order expires it first, a finished one is the subscription (never a second checkout)", async () => {
    const open = (order = "lite:month:0") => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: 42, kind: "checkout", state: "open", order_key: order, stripe_customer_id: "cus_test", idempotency_key: "chub-ca-checkout-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_id: "cs_open", session_url: "https://checkout.example.invalid/cs_open" });
    const finished = () => mocks.sql.filter((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text)).map((q) => q.values.slice(0, 3));
    // Still open, same order: the visitor goes back to it; nothing new at Stripe, no new attempt.
    mocks.attempt = open();
    mocks.rows.push([customerRow()]);
    mocks.sessionRetrieve.mockResolvedValue({ id: "cs_open", status: "open", url: "https://checkout.example.invalid/cs_open", metadata: { type: "call_assistant", tier: "lite", interval: "month", extraNumbers: "0" } });
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).body.url).toBe("https://checkout.example.invalid/cs_open");
    expect(mocks.sessionRetrieve).toHaveBeenCalledWith("cs_open");
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text))).toBe(false);

    // Still open, another order (the visitor picked a bigger tier in a second tab): expired, the attempt closed, a new attempt, the new session.
    mocks.sql.length = 0;
    mocks.rows.push([customerRow()]);
    mocks.checkout.mockResolvedValue({ id: "cs_next", url: "https://checkout.example.invalid/cs_next" });
    expect((await request("/api/call-assistant/billing/checkout", { tier: "crew" })).body.url).toBe("https://checkout.example.invalid/cs_next");
    expect(mocks.expire).toHaveBeenCalledWith("cs_open");
    expect(finished()[0]).toEqual([open().id, "expired", "open"]);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text) && q.values[3] === "crew:month:0")).toBe(true);

    // Finished (the webhook has not reported it yet): its subscription is recorded and this is a second checkout → 409.
    mocks.checkout.mockClear(); mocks.expire.mockClear(); mocks.sql.length = 0;
    mocks.attempt = open();
    mocks.rows.push([customerRow()]);
    mocks.sessionRetrieve.mockResolvedValue({ id: "cs_open", status: "complete", subscription: "sub_ca", metadata: { type: "call_assistant" } });
    mocks.current = caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "active" });
    const done = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(done.code).toBe(409);
    expect(done.body.code).toBe("has_call_assistant_subscription");
    expect(caInsert()[0].slice(0, 7)).toEqual([42, "cus_test", "sub_ca", "price_lite", "lite", 0, "active"]);
    expect(finished()[0]).toEqual([open().id, "done", "open"]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    expect(mocks.checkout).not.toHaveBeenCalled();

    // Gone at Stripe (expired and forgotten): the attempt is closed and a new one starts.
    mocks.sql.length = 0;
    mocks.attempt = open();
    mocks.rows.push([customerRow()]);
    mocks.sessionRetrieve.mockRejectedValue(Object.assign(new Error("No such checkout.session"), { statusCode: 404, code: "resource_missing" }));
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(finished()[0]).toEqual([open().id, "expired", "open"]);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);

    // A subscription landed while the session was being created (the webhook closed the attempt): the completion write
    // finds the attempt no longer `creating`, the session is expired and the visitor is told they already have the service.
    mocks.checkout.mockClear(); mocks.expire.mockClear(); mocks.attempt = null;
    mocks.rows.push([customerRow()]);
    let reads = 0;
    const row = liveCallAssistant();
    const before = mocks.callAssistantRow;
    mocks.callAssistantRow = null;
    const original = mocks.checkout.getMockImplementation();
    mocks.checkout.mockImplementation(async () => { mocks.callAssistantRow = row; reads++; return { id: "cs_late", url: "https://checkout.example.invalid/cs_late" }; });
    const late = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(late.code).toBe(409);
    expect(late.body.code).toBe("has_call_assistant_subscription");
    expect(mocks.expire).toHaveBeenCalledWith("cs_late");
    expect(reads).toBe(1);
    mocks.checkout.mockImplementation(original!);
    mocks.callAssistantRow = before;
  });

  it("an account is never stranded by an attempt: a cancellation voids open attempts with the end, and a definite creation failure closes the attempt so the next order proceeds", async () => {
    // An open checkout attempt, then the subscription (another one, say, bought in another tab) ends: the deleted
    // event voids it in the same transaction as the end; the next checkout starts clean.
    mocks.callAssistantRow = liveCallAssistant();
    mocks.attempt = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", user_id: 42, kind: "change", state: "creating", order_key: "crew:month:0", stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", idempotency_key: "chub-ca-change-dddddddd-dddd-4ddd-8ddd-dddddddddddd", session_id: null, session_url: null, created_at: new Date().toISOString() };
    const gone = caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "canceled" });
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
      mocks.verify.mockReturnValue({ id: "evt_end_attempt", type: "customer.subscription.deleted", data: { object: gone } });
      mocks.current = gone;
      const res = await request("/api/stripe/webhook", {}, { headers: { "stripe-signature": "t=1,v1=mock" }, rawBody: Buffer.from("{}") });
      expect(res.body).toEqual({ received: true });
    } finally { delete process.env.STRIPE_WEBHOOK_SECRET; }
    expect(mocks.sql.some((q) => /UPDATE call_assistant_checkout_attempts SET state = 'expired'/.test(q.text) && q.values[0] === 42)).toBe(true);
    expect(mocks.attempt).toBeNull();
    mocks.callAssistantRow = liveCallAssistant({ status: "canceled", tier: null });
    mocks.rows.push([customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    // The end never voided it (an attempt recorded before that rule, or an end that never arrived): with no live
    // subscription left to change, the checkout voids the change attempt under the lock and proceeds.
    mocks.checkout.mockClear(); mocks.sql.length = 0;
    mocks.callAssistantRow = liveCallAssistant({ status: "canceled", tier: null });
    mocks.attempt = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", user_id: 42, kind: "change", state: "creating", order_key: "fleet:month:0", stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", idempotency_key: "chub-ca-change-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", session_id: null, session_url: null, created_at: new Date().toISOString() };
    mocks.rows.push([customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text)).map((q) => q.values.slice(0, 3))[0]).toEqual(["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "expired", "creating"]);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    // A checkout for ANOTHER order left `creating` (an uncertain create): fresh, it is another process's — wait;
    // abandoned (older than any Stripe call can take), it is voided and the new order proceeds.
    const otherOrder = (ageMs: number) => ({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", user_id: 42, kind: "checkout", state: "creating", order_key: "solo:month:0", stripe_customer_id: "cus_test", idempotency_key: "chub-ca-checkout-ffffffff-ffff-4fff-8fff-ffffffffffff", session_id: null, session_url: null, created_at: new Date(Date.now() - ageMs).toISOString() });
    mocks.checkout.mockClear(); mocks.sql.length = 0; mocks.callAssistantRow = null;
    mocks.attempt = otherOrder(0);
    mocks.rows.push([customerRow()]);
    const wait = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(wait.code).toBe(409);
    expect(wait.body.code).toBe("checkout_in_progress");
    expect(mocks.checkout).not.toHaveBeenCalled();
    mocks.attempt = otherOrder(10 * 60_000);
    mocks.rows.push([customerRow()], [customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text)).map((q) => q.values.slice(0, 3))[0]).toEqual(["ffffffff-ffff-4fff-8fff-ffffffffffff", "expired", "creating"]);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text) && q.values[3] === "lite:month:0")).toBe(true);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    mocks.rows.length = 0;
    // A definite creation failure (a 4xx: nothing was created) closes the attempt as failed; the retry proceeds.
    mocks.checkout.mockClear(); mocks.sql.length = 0; mocks.callAssistantRow = null; mocks.attempt = null;
    mocks.rows.push([customerRow()]);
    mocks.checkout.mockRejectedValueOnce(Object.assign(new Error("Invalid line item"), { type: "StripeInvalidRequestError", statusCode: 400 }));
    const failed = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(failed.code).toBe(500);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text)).map((q) => q.values[1])).toEqual(["failed"]);
    expect(mocks.attempt).toBeNull();
    mocks.rows.push([customerRow()]);
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledTimes(2);
    // An uncertain one (a timeout) stays creating: the next checkout for the same order resumes it under its key.
    mocks.checkout.mockClear(); mocks.sql.length = 0; mocks.attempt = null;
    mocks.rows.push([customerRow()]);
    mocks.checkout.mockRejectedValueOnce(Object.assign(new Error("ETIMEDOUT"), { type: "StripeConnectionError" }));
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(500);
    expect(mocks.sql.some((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text))).toBe(false);
  });

  it("two processes resume one creating attempt: the one whose completion write loses rereads the attempt and returns the session the other recorded — nobody expires it", async () => {
    mocks.attempt = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: 42, kind: "checkout", state: "creating", order_key: "lite:month:0", stripe_customer_id: "cus_test", idempotency_key: "chub-ca-checkout-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", session_id: null, session_url: null };
    mocks.rows.push([customerRow()]);
    mocks.loseCompletion = true;
    const res = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(res.code).toBe(200);
    expect(res.body.url).toBe("https://checkout.example.invalid/cs_recorded_elsewhere");
    expect(mocks.checkout).toHaveBeenCalledTimes(1); // the same key as the other process: the same session at Stripe
    expect(mocks.checkout.mock.calls[0][1]).toEqual({ idempotencyKey: "chub-ca-checkout-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(mocks.checkout.mock.calls[0][0].metadata.attempt).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(mocks.expire).not.toHaveBeenCalled();
    // Stale-session cleanup never expires this attempt's own session, found open under the same key by its metadata.
    mocks.checkout.mockClear(); mocks.attempt = { ...mocks.attempt, state: "creating", session_id: null, session_url: null };
    mocks.rows.push([customerRow()]);
    mocks.openSessions.mockResolvedValue({ data: [{ id: "cs_recorded_elsewhere", mode: "subscription", status: "open", metadata: { type: "call_assistant", attempt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }, { id: "cs_stray", mode: "subscription", status: "open", metadata: { type: "call_assistant" } }] });
    expect((await request("/api/call-assistant/billing/checkout", { tier: "lite" })).code).toBe(200);
    expect(mocks.expire).toHaveBeenCalledTimes(1);
    expect(mocks.expire).toHaveBeenCalledWith("cs_stray");
  });

  it("the race the audit found: a session that completes while it is being expired can't be expired — it is read again and IS the subscription; no second checkout", async () => {
    mocks.attempt = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: 42, kind: "checkout", state: "open", order_key: "lite:month:0", stripe_customer_id: "cus_test", idempotency_key: "chub-ca-checkout-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_id: "cs_open", session_url: "https://checkout.example.invalid/cs_open" };
    mocks.rows.push([customerRow()]);
    // The visitor asks for another tier: the open session is to be expired — but it completed in the meantime.
    mocks.sessionRetrieve.mockResolvedValue({ id: "cs_open", status: "complete", subscription: "sub_ca", metadata: { type: "call_assistant" } });
    mocks.expire.mockRejectedValue(new Error("This Checkout Session is already complete."));
    mocks.current = caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "active" });
    const res = await request("/api/call-assistant/billing/checkout", { tier: "crew" });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe("has_call_assistant_subscription");
    expect(caInsert()[0].slice(0, 7)).toEqual([42, "cus_test", "sub_ca", "price_lite", "lite", 0, "active"]);
    expect(mocks.checkout).not.toHaveBeenCalled();
    // The same for a stray open session found by the customer list (one opened before attempts were kept).
    mocks.sql.length = 0; mocks.callAssistantRow = null; mocks.attempt = null; mocks.sessionRetrieve.mockReset();
    mocks.rows.push([customerRow()]);
    mocks.openSessions.mockResolvedValue({ data: [{ id: "cs_stray", mode: "subscription", status: "open", metadata: { type: "call_assistant" } }] });
    mocks.sessionRetrieve.mockResolvedValue({ id: "cs_stray", status: "complete", subscription: "sub_ca", metadata: { type: "call_assistant" } });
    const stray = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(stray.code).toBe(409);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("Stripe's lists are read to the end: a live Call Assistant subscription on the second page still refuses a second checkout", async () => {
    mocks.rows.push([customerRow()]);
    const page = Array.from({ length: 100 }, (_, i) => subscription([item(`si_${i}`, "price_pro", 1, { kind: "plan", key: "pro" })], { id: `sub_plan_${i}`, status: "canceled" }));
    mocks.current = caSubscription([item("si_t", "price_lite", 1, { kind: "addon", key: "call_assistant_lite" })], { status: "active", created: 5 });
    mocks.history
      .mockResolvedValueOnce({ data: page, has_more: true })
      .mockResolvedValueOnce({ data: [mocks.current], has_more: false });
    const res = await request("/api/call-assistant/billing/checkout", { tier: "lite" });
    expect(res.code).toBe(409);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(mocks.history.mock.calls[0][0]).toMatchObject({ customer: "cus_test", status: "all", limit: 100 });
    expect(mocks.history.mock.calls[1][0]).toMatchObject({ starting_after: "sub_plan_99" });
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("a change attempt left creating (a crash, a timeout) is reconciled, never refused for ever: applied at Stripe → closed; not applied → resumed under its own key; a definite refusal closes it, a timeout leaves it creating", async () => {
    const soloPrice = "price_chub_v1_addon_call_assistant_month_34900";
    mocks.prices.set(soloPrice, { id: soloPrice, lookup_key: "chub_v1_addon_call_assistant_month_34900", unit_amount: 34900, currency: "usd", recurring: { interval: "month" }, metadata: { chub_kind: "addon", chub_key: "call_assistant", chub_interval: "month" } });
    const crewPrice = "price_chub_v1_addon_call_assistant_crew_month_44900";
    mocks.prices.set(crewPrice, { id: crewPrice, lookup_key: "chub_v1_addon_call_assistant_crew_month_44900", unit_amount: 44900, currency: "usd", recurring: { interval: "month" }, metadata: { chub_kind: "addon", chub_key: "call_assistant_crew", chub_interval: "month" } });
    mocks.callAssistantRow = liveCallAssistant();
    const creating = (ageMs = 0) => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", user_id: 42, kind: "change", state: "creating", order_key: "crew:month:0", stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", idempotency_key: "chub-ca-change-cccccccc-cccc-4ccc-8ccc-cccccccccccc", session_id: null, session_url: null, created_at: new Date(Date.now() - ageMs).toISOString() });
    const closed = () => mocks.sql.filter((q) => /UPDATE call_assistant_checkout_attempts SET state = \$2/.test(q.text)).map((q) => q.values.slice(0, 3));
    // Not applied at Stripe (still Solo): the same order resumes the attempt under its own key; no new attempt.
    mocks.attempt = creating();
    mocks.current = caSubscription([item("si_tier", soloPrice, 1, { kind: "addon", key: "call_assistant" })], { status: "active" });
    const resumed = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(resumed.code, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body.changed).toBe(true);
    expect(mocks.update.mock.calls[0][2]).toEqual({ idempotencyKey: "chub-ca-change-cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text))).toBe(false);
    expect(closed()).toEqual([["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "done", "creating"]]);
    // Applied at Stripe already (the crash came after the update): nothing to change, the attempt is closed.
    mocks.sql.length = 0; mocks.update.mockClear();
    mocks.attempt = creating();
    mocks.current = caSubscription([item("si_tier", crewPrice, 1, { kind: "addon", key: "call_assistant_crew" })], { status: "active" });
    const applied = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(applied.code).toBe(200);
    expect(applied.body.changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(closed()).toEqual([["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "done", "creating"]]);
    // Another order while a FRESH attempt is uncertain (another process may be mid-update): wait.
    mocks.sql.length = 0;
    mocks.attempt = creating();
    mocks.current = caSubscription([item("si_tier", soloPrice, 1, { kind: "addon", key: "call_assistant" })], { status: "active" });
    const other = await request("/api/call-assistant/billing/change", { tier: "fleet" });
    expect(other.code).toBe(409);
    expect(other.body.code).toBe("checkout_in_progress");
    expect(mocks.update).not.toHaveBeenCalled();
    // Codex #6: the attempt is reconciled by ITS OWN order. A crash after Crew was applied, then Fleet asked for: the
    // Crew attempt is closed as done and Fleet proceeds under a new attempt — never a permanent 409.
    mocks.sql.length = 0;
    const fleetPrice = "price_chub_v1_addon_call_assistant_fleet_month_99900";
    mocks.prices.set(fleetPrice, { id: fleetPrice, lookup_key: "chub_v1_addon_call_assistant_fleet_month_99900", unit_amount: 99900, currency: "usd", recurring: { interval: "month" }, metadata: { chub_kind: "addon", chub_key: "call_assistant_fleet", chub_interval: "month" } });
    mocks.attempt = creating();
    mocks.current = caSubscription([item("si_tier", crewPrice, 1, { kind: "addon", key: "call_assistant_crew" })], { status: "active" });
    const fleet = await request("/api/call-assistant/billing/change", { tier: "fleet" });
    expect(fleet.code, JSON.stringify(fleet.body)).toBe(200);
    expect(fleet.body.changed).toBe(true);
    expect(closed()[0]).toEqual(["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "done", "creating"]);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_checkout_attempts/.test(q.text) && q.values[3] === "fleet:month:0")).toBe(true);
    expect(mocks.update.mock.calls[0][2].idempotencyKey).toMatch(/^chub-ca-change-/);
    expect(mocks.update.mock.calls[0][2].idempotencyKey).not.toBe("chub-ca-change-cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    // Not applied and old (abandoned by a crashed process): voided, and the new order proceeds.
    mocks.sql.length = 0; mocks.update.mockClear();
    mocks.attempt = creating(5 * 60_000);
    mocks.current = caSubscription([item("si_tier", soloPrice, 1, { kind: "addon", key: "call_assistant" })], { status: "active" });
    const voided = await request("/api/call-assistant/billing/change", { tier: "fleet" });
    expect(voided.code, JSON.stringify(voided.body)).toBe(200);
    expect(closed()[0]).toEqual(["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "expired", "creating"]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    // A timeout (Stripe may still apply it) leaves the attempt creating with the error noted; a definite refusal (the card) closes it as failed.
    mocks.sql.length = 0; mocks.attempt = null;
    mocks.update.mockRejectedValueOnce(Object.assign(new Error("ETIMEDOUT"), { type: "StripeConnectionError" }));
    const timeout = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(timeout.code).toBe(500);
    expect(closed()).toEqual([]);
    expect(mocks.sql.some((q) => /UPDATE call_assistant_checkout_attempts SET error = \$2/.test(q.text) && q.values[1] === "ETIMEDOUT")).toBe(true);
    mocks.sql.length = 0; mocks.attempt = null;
    mocks.update.mockRejectedValueOnce(Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402 }));
    const declined = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(declined.code).toBe(402);
    expect(closed().map((c) => c[1])).toEqual(["failed"]);
  });

  it("change: a tier switch re-prices the one tier line in place (prorated, invoiced now), then the row and the number-release decision follow", async () => {
    const soloPrice = "price_chub_v1_addon_call_assistant_month_34900";
    mocks.prices.set(soloPrice, { id: soloPrice, lookup_key: "chub_v1_addon_call_assistant_month_34900", unit_amount: 34900, currency: "usd", recurring: { interval: "month" }, metadata: { chub_kind: "addon", chub_key: "call_assistant", chub_interval: "month" } });
    mocks.current = caSubscription([item("si_tier", soloPrice, 1, { kind: "addon", key: "call_assistant" })], { status: "active" });
    mocks.callAssistantRow = liveCallAssistant();
    const up = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(up.code, JSON.stringify(up.body)).toBe(200);
    expect(up.body.changed).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [id, params] = mocks.update.mock.calls[0];
    expect(id).toBe("sub_ca");
    expect(params).toMatchObject({ proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete", metadata: { product: "call_assistant", tier: "crew", interval: "month", extraNumbers: "0" } });
    expect(params.items).toEqual([{ id: "si_tier", price: "price_chub_v1_addon_call_assistant_crew_month_44900", quantity: 1 }]);
    expect(params.items.some((i: any) => i.discounts)).toBe(false);
    expect(caInsert().at(-1)!.slice(0, 7)).toEqual([42, "cus_test", "sub_ca", "price_chub_v1_addon_call_assistant_crew_month_44900", "crew", 0, "active"]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    expect(mocks.updates).toEqual([]);

    // Extra numbers: a new line (the tier line untouched); asking for what is held changes nothing.
    mocks.current = await mocks.update.mock.results[0].value;
    mocks.update.mockClear();
    const numbers = await request("/api/call-assistant/billing/change", { extraNumbers: 2 });
    expect(numbers.code, JSON.stringify(numbers.body)).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ price: "price_chub_v1_addon_call_number_month_500", quantity: 2 }]);
    mocks.current = await mocks.update.mock.results[0].value;
    mocks.update.mockClear();
    const same = await request("/api/call-assistant/billing/change", { tier: "crew", extraNumbers: 2 });
    expect(same.body.changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    // And back to none: the number line is removed.
    const none = await request("/api/call-assistant/billing/change", { extraNumbers: 0 });
    expect(none.code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ id: "si_new_0", deleted: true }]);
  });

  it("change: nothing to change without a live subscription; a recent sign-in is required", async () => {
    const none = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(none.code).toBe(409);
    expect(none.body.code).toBe("no_call_assistant_subscription");
    mocks.recentAuth = false;
    mocks.callAssistantRow = liveCallAssistant();
    const stepUp = await request("/api/call-assistant/billing/change", { tier: "crew" });
    expect(stepUp.code).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("GET subscription: the row as the client reads it, with the access the entitlements give", async () => {
    mocks.callAssistantRow = liveCallAssistant({ tier: "fleet", extra_numbers: 2, billing_interval: "year" });
    const res = await request("GET /api/call-assistant/billing/subscription");
    expect(res.body).toMatchObject({
      tier: "fleet", tierName: "5,000 minutes", addon: "call_assistant_fleet", status: "active", interval: "year", extraNumbers: 2, numbers: 7, minutes: 5000,
      addons: { call_assistant_fleet: 1, call_number: 2 }, hasLiveSubscription: true, cancelAtPeriodEnd: false,
    });
    // The overage switch rides on the billing status (Codex #6): off (the default) the surfaces say "counted but not
    // charged yet"; only on do they say "on your next invoice".
    const overageSwitch = process.env.CALL_ASSISTANT_OVERAGE_BILLING;
    try {
      delete process.env.CALL_ASSISTANT_OVERAGE_BILLING;
      expect((await request("GET /api/call-assistant/billing/subscription")).body.overageBilling).toBe("off");
      process.env.CALL_ASSISTANT_OVERAGE_BILLING = "on";
      expect((await request("GET /api/call-assistant/billing/subscription")).body.overageBilling).toBe("on");
    } finally {
      if (overageSwitch === undefined) delete process.env.CALL_ASSISTANT_OVERAGE_BILLING; else process.env.CALL_ASSISTANT_OVERAGE_BILLING = overageSwitch;
    }
    mocks.callAssistantRow = null;
    const empty = await request("GET /api/call-assistant/billing/subscription");
    expect(empty.body).toMatchObject({ tier: null, tierName: null, status: "inactive", numbers: 0, minutes: 0, addons: {}, hasLiveSubscription: false, access: { enabled: false, paused: false, via: null } });
  });
});

describe("webhook maps the subscription's items onto the row", () => {
  /** `stripeHas`: what subscriptions.retrieve answers for a subscription event (default: the event's own snapshot). */
  async function webhook(event: any, stripeHas: any = event.data?.object) {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
      if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) mocks.current = stripeHas;
      mocks.verify.mockReturnValue(event);
      return await request("/api/stripe/webhook", {}, { headers: { "stripe-signature": "t=1,v1=mock" }, rawBody: Buffer.from("{}") });
    } finally {
      if (prior === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prior;
    }
  }
  const agencyYearly = (id = "sub_new", status = "trialing") => subscription([
    item("si_plan", "price_agency_y", 1, { kind: "plan", key: "agency" }, "year"),
    item("si_band", "price_band_y", 15, { kind: "agency_locations" }, "year"),
    item("si_seat", "price_seat_y", 3, { kind: "addon", key: "extra_seat" }, "year"),
  ], { id, status });

  it("checkout.session.completed records plan, interval, add-ons, Agency locations and the real status", async () => {
    mocks.current = agencyYearly();
    const res = await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_1", subscription: "sub_new", metadata: { userId: "42", type: "plan", plan: "starter" } } } });
    expect(res.body).toEqual({ received: true });
    expect(mocks.updates[0]).toEqual({
      stripeSubscriptionId: "sub_new", status: "trialing", currentPeriodEnd: new Date(1893456000 * 1000), billingInterval: "year",
      plan: "agency", stripePriceId: "price_agency_y", addons: { extra_seat: 3 }, agencyLocations: 25,
    });
  });

  it("a Call Assistant checkout or subscription event writes call_assistant_subscriptions — never the platform row — and runs the number-release decision", async () => {
    const caSub = subscription([
      item("si_t", "price_lite_m", 1, { kind: "addon", key: "call_assistant_lite" }),
      item("si_n", "price_num_m", 1, { kind: "addon", key: "call_number" }),
    ], { id: "sub_ca", status: "active", metadata: { product: "call_assistant", userId: "42" } });
    const inserts = () => mocks.sql.filter((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text)).map((q) => q.values);
    mocks.current = caSub;
    const res = await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_ca", subscription: "sub_ca", metadata: { userId: "42", type: "call_assistant", product: "call_assistant" } } } });
    expect(res.body).toEqual({ received: true });
    expect(mocks.updates).toEqual([]);
    expect(inserts()[0].slice(0, 8)).toEqual([42, "cus_test", "sub_ca", "price_lite_m", "lite", 1, "active", "month"]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    expect(mocks.billingEmail).not.toHaveBeenCalled();

    // customer.subscription.updated, told apart by its items alone (a tier line, no plan line): the same path, the account found by its customer.
    mocks.sql.length = 0; mocks.afterSubscriptionChange.mockClear();
    const pastDue = { ...caSub, metadata: {}, status: "past_due" };
    await webhook({ type: "customer.subscription.updated", data: { object: pastDue } }, pastDue);
    expect(mocks.updates).toEqual([]);
    expect(inserts()[0].slice(4, 7)).toEqual(["lite", 1, "past_due"]); // paused, not ended: the tier (and its numbers) stay
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);

    // Deleted (Stripe's state read under the lock): the row ends (tier gone) and the numbers are released by the decision that follows.
    mocks.sql.length = 0; mocks.afterSubscriptionChange.mockClear();
    await webhook({ type: "customer.subscription.deleted", data: { object: { ...caSub, status: "canceled" } } });
    expect(inserts()[0].slice(4, 7)).toEqual([null, 0, "canceled"]);
    expect(mocks.updates).toEqual([]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });

  it("a second LIVE Call Assistant subscription for an account that has one: the tracked row is kept, the newcomer is cancelled at Stripe (ours) and logged loudly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.callAssistantRow = { id: 9, user_id: 42, stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", stripe_price_id: "price_x", tier: "solo", extra_numbers: 0, status: "active", billing_interval: "month", current_period_end: null, cancel_at_period_end: false };
    const dup = subscription([item("si_t2", "price_lite_m", 1, { kind: "addon", key: "call_assistant_lite" })], { id: "sub_ca2", status: "active", metadata: { product: "call_assistant", userId: "42" } });
    const res = await webhook({ type: "customer.subscription.created", data: { object: dup } }, dup);
    expect(res.body).toEqual({ received: true });
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(mocks.updates).toEqual([]);
    expect(mocks.cancel).toHaveBeenCalledWith("sub_ca2", { prorate: true, invoice_now: true });
    expect(error.mock.calls.some((c) => /DUPLICATE live Call Assistant subscription for user 42: keeping sub_ca, cancelling sub_ca2/.test(String(c[0])))).toBe(true);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    // Its own row (pending) before the cancel, done by its own id after it.
    expect(mocks.sql.filter((q) => /INSERT INTO call_assistant_duplicate_cancellations/.test(q.text)).map((q) => q.values)).toEqual([[42, "sub_ca", "sub_ca2", true, "pending"]]);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_duplicate_cancellations SET state = 'done'/.test(q.text)).map((q) => q.values)).toEqual([["sub_ca2"]]);
    // Another customer's subscription that only names this account: not ours to cancel — kept out, logged.
    mocks.cancel.mockClear(); error.mockClear();
    const stranger = { ...dup, id: "sub_ca3", customer: "cus_other" };
    await webhook({ type: "customer.subscription.created", data: { object: stranger } }, stranger);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(error.mock.calls.some((c) => /NOT cancelling \(not ours\) sub_ca3/.test(String(c[0])))).toBe(true);
  });

  it("a duplicate whose cancellation fails is never acknowledged: the row remembers it (retry needed), the event's claim is released and the webhook fails so Stripe retries; the retry clears it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.callAssistantRow = { id: 9, user_id: 42, stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", stripe_price_id: "price_x", tier: "solo", extra_numbers: 0, status: "active", billing_interval: "month", current_period_end: null, cancel_at_period_end: false };
    const dup = subscription([item("si_t2", "price_lite_m", 1, { kind: "addon", key: "call_assistant_lite" })], { id: "sub_ca2", status: "active", metadata: { product: "call_assistant", userId: "42" } });
    mocks.cancel.mockRejectedValueOnce(new Error("Stripe is down"));
    const failed = await webhook({ id: "evt_dup_1", type: "customer.subscription.created", data: { object: dup } }, dup);
    expect(failed.code).toBe(400);
    expect(failed.body.message).toMatch(/Duplicate Call Assistant subscription sub_ca2 for user 42 could not be cancelled: Stripe is down/);
    expect(mocks.sql.filter((q) => /INSERT INTO call_assistant_duplicate_cancellations/.test(q.text)).map((q) => q.values)).toEqual([[42, "sub_ca", "sub_ca2", true, "pending"]]);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_duplicate_cancellations SET attempts = attempts \+ 1, error = \$2/.test(q.text)).map((q) => q.values)).toEqual([["sub_ca2", "Stripe is down"]]);
    expect(mocks.sql.some((q) => /UPDATE call_assistant_duplicate_cancellations SET state = 'done'/.test(q.text))).toBe(false);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(mocks.sql.some((q) => /DELETE FROM billing_events/.test(q.text) && q.values[0] === "evt_dup_1")).toBe(true);
    // Stripe's retry of the same event: the cancel works now, the flag clears, the event is acknowledged.
    mocks.sql.length = 0;
    const retried = await webhook({ id: "evt_dup_1", type: "customer.subscription.created", data: { object: dup } }, dup);
    expect(retried.body).toEqual({ received: true });
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.sql.filter((q) => /UPDATE call_assistant_duplicate_cancellations SET state = 'done'/.test(q.text)).map((q) => q.values)).toEqual([["sub_ca2"]]);
  });

  it("customer.subscription.deleted for the tracked Call Assistant subscription writes its settlement job in the same transaction as the end, then runs the account's pending settlements", async () => {
    mocks.callAssistantRow = { id: 9, user_id: 42, stripe_customer_id: "cus_test", stripe_subscription_id: "sub_ca", stripe_price_id: "price_x", tier: "solo", extra_numbers: 0, status: "active", billing_interval: "month", current_period_end: null, cancel_at_period_end: false };
    const gone = subscription([item("si_t", "price_lite_m", 1, { kind: "addon", key: "call_assistant_lite" })], { id: "sub_ca", status: "canceled", metadata: { product: "call_assistant", userId: "42" } });
    await webhook({ type: "customer.subscription.deleted", data: { object: gone } });
    const texts = mocks.sql.map((q) => q.text);
    const job = texts.findIndex((t) => /INSERT INTO voice_settle_jobs/.test(t));
    const end = texts.findIndex((t) => /INSERT INTO call_assistant_subscriptions/.test(t));
    const run = texts.findIndex((t) => /FROM voice_settle_jobs WHERE state IN \('pending', 'failed'\) AND account_user_id/.test(t));
    expect(job).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(job);
    expect(run).toBeGreaterThan(end);
    expect(mocks.sql[job].values).toEqual([42, "sub_ca", "cus_test", "month"]);
    expect(mocks.sql[end].values.slice(4, 7)).toEqual([null, 0, "canceled"]);
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    // A stale "active" for the same subscription after that: Stripe still says canceled under the lock, so no access comes back.
    mocks.sql.length = 0;
    await webhook({ type: "customer.subscription.updated", data: { object: { ...gone, status: "active" } } }, gone);
    expect(mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!.values.slice(4, 7)).toEqual([null, 0, "canceled"]);
  });

  it("customer.subscription.updated follows a plan change made anywhere (e.g. the billing portal)", async () => {
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_new", "active") } });
    expect(mocks.updates[0]).toMatchObject({ plan: "agency", status: "active", agencyLocations: 25 });
  });

  it("ignores events for a subscription the account isn't on (the old double-billing leftover)", async () => {
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_live" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_stray", "active") } });
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_live" })]);
    await webhook({ type: "customer.subscription.deleted", data: { object: { id: "sub_stray", customer: "cus_test" } } });
    expect(mocks.updates).toHaveLength(0);
  });

  it("deleting the tracked subscription ends the plan", async () => {
    mocks.rows.push([liveRow()]);
    await webhook({ type: "customer.subscription.deleted", data: { object: { id: "sub_live", customer: "cus_test" } } });
    expect(mocks.updates[0]).toEqual({ status: "canceled", plan: "free", addons: {}, agencyLocations: null, billingInterval: null });
    expect(cancellationWrites()).toEqual([[5, null, null, null]]);
    // The Call Assistant number is part of the service: the release decision runs for the account, after the row is written.
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
  });

  it("every subscription write re-decides the account's Call Assistant numbers; an ignored event does not", async () => {
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_new", "past_due") } });
    expect(mocks.updates[0]).toMatchObject({ status: "past_due" });
    // Called for past_due too — the decision itself never releases on past_due (number-release.test.ts).
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    mocks.afterSubscriptionChange.mockClear();
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_live" })]);
    await webhook({ type: "customer.subscription.deleted", data: { object: { id: "sub_stray", customer: "cus_test" } } });
    expect(mocks.afterSubscriptionChange).not.toHaveBeenCalled();
    mocks.current = agencyYearly();
    await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_2", subscription: "sub_new", metadata: { userId: "42", type: "plan", plan: "agency" } } } });
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
  });

  it("an out-of-order event writes the subscription as Stripe has it now, never the event's stale snapshot", async () => {
    // Stripe does not order events: a late past_due (or unpaid) snapshot arrives after the subscription is active again.
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_new", "unpaid") } }, agencyYearly("sub_new", "active"));
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_new");
    expect(mocks.updates[0]).toMatchObject({ status: "active", plan: "agency" });
    // The number decision then reads the fresh row (nothing is released for a stale `unpaid`).
    expect(mocks.afterSubscriptionChange).toHaveBeenCalledWith(42);
    // An event for a subscription the account isn't on is never even looked up.
    mocks.retrieve.mockClear();
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_live" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_stray", "active") } });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("records a cancellation set in Stripe's portal (cancel at period end) with the row", async () => {
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    const sub = agencyYearly("sub_new", "active") as any;
    sub.cancel_at_period_end = true;
    await webhook({ type: "customer.subscription.updated", data: { object: sub } });
    expect(cancellationWrites()).toEqual([[5, true, new Date(1893456000 * 1000), null]]);
    // Resumed in the portal: the flag clears.
    mocks.sql.length = 0;
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_new", "active") } });
    expect(cancellationWrites()).toEqual([[5, false, null, null]]);
  });

  it("a late event for an ended subscription never ends a live trial-code grant; a live subscription replaces it", async () => {
    const grant = () => customerRow({ plan: "agency", status: "trialing", currentPeriodEnd: new Date(Date.now() + 86400_000) });
    mocks.rows.push([grant()]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_old", "canceled") } });
    expect(mocks.updates).toHaveLength(0);

    mocks.rows.push([grant()]);
    await webhook({ type: "customer.subscription.updated", data: { object: agencyYearly("sub_paid", "active") } });
    expect(mocks.updates[0]).toMatchObject({ stripeSubscriptionId: "sub_paid", status: "active", plan: "agency" });
  });

  it("a legacy subscription keeps its stored plan (no role metadata to read)", async () => {
    mocks.rows.push([liveRow({ plan: "premium" })]);
    await webhook({ type: "customer.subscription.updated", data: { object: subscription([item("si_old", "price_legacy")], { status: "past_due" }) } });
    expect(mocks.updates[0]).toMatchObject({ status: "past_due", billingInterval: "month", stripePriceId: "price_legacy" });
    expect(mocks.updates[0].plan).toBeUndefined();
  });

  it("still fails closed without a signature", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
      const res = await request("/api/stripe/webhook", {}, { rawBody: Buffer.from("{}") });
      expect(res.code).toBe(400);
      expect(mocks.verify).not.toHaveBeenCalled();
    } finally { delete process.env.STRIPE_WEBHOOK_SECRET; }
  });
});

describe("$1,000 and up is talk-to-sales: never a checkout", () => {
  it.each(Object.entries(DFY_CATALOG))("cart refuses %s", async (id) => {
    const res = await request("/api/stripe/create-cart-checkout", { items: [{ id, type: id === "dfy_bundle" ? "dfy_bundle" : "dfy_service", price: 1 }] });
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ code: "talk_to_sales", items: [DFY_CATALOG[id].name] });
    expect(res.body.message).toMatch(/Talk to a sales rep/);
  });

  it("cart refuses the $2,499 course bundle and $1,000+ modules, but sells a module under $1,000", async () => {
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_bundle" }] })).code).toBe(409);
    mocks.rows.push([{ id: 1, title: "Formation", price: 150000 }]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 1 }] })).code).toBe(409);
    mocks.rows.push([{ id: 9, title: "Short course", price: 49900 }], [customerRow()]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 9 }] })).code).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    expect(mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(49900);
  });

  it("course checkout refuses the bundle and a $1,000+ module", async () => {
    expect(COURSE_BUNDLE.priceCents).toBeGreaterThanOrEqual(100000);
    expect((await request("/api/stripe/create-course-checkout", { bundle: true })).code).toBe(409);
    mocks.rows.push([{ id: 2, title: "GMB Setup", price: 200000 }]);
    const res = await request("/api/stripe/create-course-checkout", { moduleId: 2 });
    expect(res.code).toBe(409);
    expect(res.body.items).toEqual(["Master Class — GMB Setup"]);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("$999.99 still checks out; $1,000.00 does not", async () => {
    mocks.rows.push([{ id: 3, title: "Edge", price: 99999 }], [customerRow()]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 3 }] })).code).toBe(200);
    mocks.rows.push([{ id: 4, title: "Edge", price: 100000 }]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 4 }] })).code).toBe(409);
  });
});

describe("plan limits are read through getEntitlements, not a second table here", () => {
  it("server/stripe.ts no longer exports the deprecated PLANS limits view (photos read unlimited there)", () => {
    expect("PLANS" in stripeModule).toBe(false);
  });
});

describe("cancellationOf", () => {
  const periodEnd = 1893456000;
  const sub = (extra: any) => subscription([item("si_plan", "price_x", 1, { kind: "plan", key: "pro" })], extra) as any;
  it("reads cancel_at_period_end, and a cancel_at on or before the period end, as ending at period end", () => {
    expect(cancellationOf(sub({ cancel_at_period_end: true }))).toEqual({ cancelAtPeriodEnd: true, cancelAt: new Date(periodEnd * 1000) });
    expect(cancellationOf(sub({ cancel_at: periodEnd }))).toEqual({ cancelAtPeriodEnd: true, cancelAt: new Date(periodEnd * 1000) });
    expect(cancellationOf(sub({}))).toEqual({ cancelAtPeriodEnd: false, cancelAt: null });
  });
  it("a cancel date after this period still renews once: not 'at period end', but the date is kept", () => {
    expect(cancellationOf(sub({ cancel_at: periodEnd + 30 * 86400 }))).toEqual({ cancelAtPeriodEnd: false, cancelAt: new Date((periodEnd + 30 * 86400) * 1000) });
  });
});

describe("webhook → billing emails: one call per verified platform event, after the ledger and the row", () => {
  /** `stripeHas`: what subscriptions.retrieve answers for a subscription event (default: the event's own snapshot). */
  async function webhook(event: any, stripeHas: any = event.data?.object) {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
      if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) mocks.current = stripeHas;
      mocks.verify.mockReturnValue(event);
      return await request("/api/stripe/webhook", {}, { headers: { "stripe-signature": "t=1,v1=mock" }, rawBody: Buffer.from("{}") });
    } finally {
      if (prior === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prior;
    }
  }
  const proSub = (id = "sub_new", status = "active") => subscription([item("si_plan", "price_pro_m", 1, { kind: "plan", key: "pro" })], { id, status });

  it("hands the event to onStripeBillingEvent exactly once, with the resolved account, once the row was applied", async () => {
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    const res = await webhook({ id: "evt_email_1", type: "customer.subscription.updated", data: { object: proSub() } });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mocks.updates).toHaveLength(1); // the row change came first
    expect(mocks.billingEmail).toHaveBeenCalledTimes(1);
    const [event, ctx] = mocks.billingEmail.mock.calls[0];
    expect(event).toMatchObject({ id: "evt_email_1", type: "customer.subscription.updated" });
    expect(ctx).toMatchObject({ userId: 42 });
    expect(ctx.stripe).toBeTruthy(); // the adapter may read the card / receipt from Stripe
  });

  it("a redelivered event (id already in billing_events) answers 200 duplicate and sends nothing", async () => {
    mocks.seenEvents.add("evt_dup");
    mocks.rows.push([liveRow({ stripeSubscriptionId: "sub_new" })]);
    const res = await webhook({ id: "evt_dup", type: "customer.subscription.updated", data: { object: proSub() } });
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });

  it("a Connect (CRM client payment) event is never a platform email", async () => {
    const res = await webhook({ id: "evt_connect", account: "acct_client", type: "checkout.session.completed", data: { object: { id: "cs_client", mode: "payment", payment_status: "paid", metadata: {} } } });
    expect(res.code).toBe(200);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });

  it("does not email a payment failure after the ledger has already settled the invoice", async () => {
    mocks.invoiceApplied = false;
    const res = await webhook({ id: "evt_CODEX_stale_failure", type: "invoice.payment_failed", data: { object: {
      id: "in_CODEX_paid", customer: "cus_test", status: "open", amount_paid: 0, amount_due: 7900,
      metadata: { userId: "42" }, created: 1893456000,
    } } });
    expect(res.code).toBe(200);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });

  it("does not email cancellation or plan changes for an ignored stray subscription", async () => {
    for (const type of ["customer.subscription.updated", "customer.subscription.deleted"]) {
      mocks.rows.push([liveRow()]);
      expect((await webhook({ id: `evt_CODEX_${type}`, type, data: { object: proSub("sub_stray", "canceled") } })).code).toBe(200);
    }
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });

  it("never fulfills a connected-account checkout as a platform course purchase", async () => {
    const res = await webhook({ id: "evt_CODEX_connect_purchase", account: "acct_client", type: "checkout.session.completed", data: { object: {
      id: "cs_client", mode: "payment", payment_status: "paid", metadata: { userId: "42", type: "master_class", moduleId: "1" },
    } } });
    expect(res.code).toBe(200);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.sql.some(s => /INSERT INTO billing_purchases/.test(s.text))).toBe(false);
  });

  it("a handler failure releases the claim (Stripe retries) and sends no email for the failed attempt", async () => {
    mocks.sql.length = 0;
    mocks.retrieve.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await webhook({ id: "evt_fail", type: "checkout.session.completed", data: { object: { id: "cs_plan", mode: "subscription", subscription: "sub_new", metadata: { userId: "42", type: "plan", plan: "pro" } } } });
    expect(res.code).toBe(400);
    expect(mocks.sql.some((s) => /DELETE FROM billing_events/.test(s.text) && s.values[0] === "evt_fail")).toBe(true);
    expect(mocks.billingEmail).not.toHaveBeenCalled();
  });
});

describe("price rebuild legacy billing routes", () => {
  function legacyAgency(extra = 10) {
    const base = item("si_plan", "price_old_agency", 1, { kind: "plan", key: "agency" });
    (base.price as any).unit_amount = 34900;
    mocks.current = subscription([base, ...(extra ? [item("si_band", "price_old_band", extra, { kind: "agency_locations" })] : [])]);
  }
  it("annual Unlimited preview and migration agree; band removal and marker change are atomic", async () => {
    legacyAgency();
    mocks.rows.push([liveRow({ plan: "agency", agencyLocations: 20 })]);
    expect((await request("/api/stripe/change-plan-preview", { plan: "agency", interval: "year" })).body)
      .toEqual({ recurringCents: 449000, interval: "year" });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.rows.push([liveRow({ plan: "agency", agencyLocations: 20 })]);
    expect((await request("/api/stripe/change-plan", { plan: "agency", interval: "year" })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      metadata: { legacy_agency_billing: "false" },
      items: [{ id: "si_plan", price: "price_chub_v1_plan_agency_year_449000", quantity: 1 }, { id: "si_band", deleted: true }],
    });
    expect(mocks.updates.at(-1)).toMatchObject({ agencyLocations: null });
  });
  it("interval-only changes retain the legacy base and marker with no band item", async () => {
    legacyAgency(0);
    mocks.rows.push([liveRow({ plan: "agency", agencyLocations: 10 })]);
    expect((await request("/api/stripe/change-plan", { interval: "year" })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      metadata: { legacy_agency_billing: "true" },
      items: [{ id: "si_plan", price: "price_chub_v1_plan_agency_year_349000", quantity: 1 }],
    });
    expect(mocks.updates.at(-1)).toMatchObject({ agencyLocations: 10 });
  });
  it("confirmation includes retained add-ons", async () => {
    legacyAgency(0);
    mocks.current.items.data.push(item("si_grid", "price_grid", 2, { kind: "addon", key: "grid_pack" }));
    mocks.rows.push([liveRow({ plan: "agency", agencyLocations: 10 })]);
    expect((await request("/api/stripe/change-plan-preview", { plan: "agency", interval: "year" })).body)
      .toEqual({ recurringCents: 449000 + 2 * ADDONS.grid_pack.annualCents, interval: "year" });
  });
});

it("new Unlimited checkout explicitly marks flat billing even if a founding lock supplies the old base", async () => {
  mocks.rows.push([customerRow()]);
  expect((await request("/api/stripe/create-checkout", { plan: "agency" })).code).toBe(200);
  expect(mocks.checkout.mock.calls[0][0].subscription_data.metadata.legacy_agency_billing).toBe("false");
});

it("an add-on edit trusts Stripe's completed migration even if the database still has the old count", async () => {
  const base = item("si_plan", "price_founder_unlimited", 1, { kind: "plan", key: "agency" });
  (base.price as any).unit_amount = 34900;
  mocks.current = subscription([base], { metadata: { legacy_agency_billing: "false" } });
  mocks.rows.push([liveRow({ plan: "agency", agencyLocations: 30 })]);
  expect((await request("/api/stripe/addons", { addons: { grid_pack: 1 } })).code).toBe(200);
  expect(mocks.update.mock.calls[0][1].items).toEqual([{ price: `price_chub_v1_addon_grid_pack_month_${ADDONS.grid_pack.monthlyCents}`, quantity: 1 }]);
  expect(mocks.updates.at(-1)).toMatchObject({ agencyLocations: null });
});
