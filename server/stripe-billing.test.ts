import { beforeEach, describe, expect, it, vi } from "vitest";
// Plan billing on the shared price book (shared/plans.ts), with a mocked
// Stripe client and database: checkout (plans, annual, Agency bands, add-ons,
// refusals), change-plan / add-ons on the SAME subscription, webhook mapping,
// and the $1,000 "talk to sales" threshold. No real Stripe call is made.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";

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
}));
vi.mock("stripe", () => ({ default: class {
  prices = { list: mocks.pricesList, create: mocks.pricesCreate };
  checkout = { sessions: { create: mocks.checkout, list: mocks.openSessions, expire: mocks.expire } };
  customers = { create: mocks.customers };
  subscriptions = { retrieve: mocks.retrieve, update: mocks.update, list: mocks.history };
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
        if (/^\s*CREATE (TABLE|INDEX)/.test(text)) return { rows: [] };
        mocks.sql.push({ text, values });
        if (/SELECT cancel_at_period_end/.test(text)) return { rows: [mocks.cancelRow] };
        // An event id is new to the ledger (the webhook's idempotency claim succeeds) unless a test marked it seen.
        if (/INSERT INTO billing_events/.test(text)) return { rows: mocks.seenEvents.has(values[0]) ? [] : [{ stripe_event_id: values[0] }] };
        if (/INSERT INTO billing_invoices/.test(text)) return { rows: mocks.invoiceApplied ? [{ id: values[0] }] : [] };
        return { rows: [] };
      },
    },
  };
});
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8251" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
vi.mock("./account-security", () => ({
  requireRecentAuth: (_req: any, res: any) => {
    if (mocks.recentAuth) return true;
    res.status(403).json({ reauth: true, message: "Please verify your identity to continue." });
    return false;
  },
}));
// The one email path: the webhook hands each verified platform event to this adapter (spied, never sends).
vi.mock("./account/billing-emails", () => ({ onStripeBillingEvent: mocks.billingEmail }));

import * as stripeModule from "./stripe";
import { registerStripeRoutes } from "./stripe";
import { cancellationOf, withBillingLock } from "./billing/sync";
import { resetPriceCache } from "./billing/prices";
import { COURSE_BUNDLE, DFY_CATALOG } from "./catalog";
import { PLANS, ADDONS, AGENCY_LOCATION_BANDS, TRIAL_DAYS, agencyMonthlyCents } from "@shared/plans";

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
    price: { id: priceId, recurring: { interval }, metadata: role ? { chub_kind: role.kind, chub_key: role.key ?? "", chub_interval: interval } : {} },
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
  resetPriceCache();
  mocks.pricesList.mockReset().mockImplementation(async ({ lookup_keys }: any) => ({
    data: [...mocks.prices.values()].filter((p) => lookup_keys.includes(p.lookup_key)).map((p) => ({ ...p, recurring: p.recurring ?? null })),
  }));
  mocks.pricesCreate.mockReset().mockImplementation(async (params: any) => {
    const id = `price_${params.lookup_key}`;
    mocks.prices.set(id, { id, ...params });
    return { id };
  });
  mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.invalid/session" });
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
    return subscription(items, { id });
  });
  mocks.history.mockReset().mockResolvedValue({ data: [] });
  mocks.verify.mockReset();
  mocks.sql.length = 0;
  mocks.cancelRow = {};
});

/** The plain-SQL cancellation writes, as [where value, cancel_at_period_end, cancel_at]. */
const cancellationWrites = () => mocks.sql.filter((q) => /SET cancel_at_period_end/.test(q.text)).map((q) => q.values);

describe("GET /api/stripe/plans", () => {
  it("returns the shared price book — four plans, add-ons, Agency bands, a 1-day trial; no free or retired plans", async () => {
    const res = await request("GET /api/stripe/plans");
    expect(res.body.plans.map((p: any) => p.key)).toEqual(["starter", "pro", "growth", "agency"]);
    expect(res.body.plans.map((p: any) => [p.monthlyCents, p.annualCents])).toEqual([[2900, 29000], [7900, 79000], [19900, 199000], [34900, 349000]]);
    expect(res.body.addons.map((a: any) => a.key)).toEqual(Object.keys(ADDONS));
    expect(res.body.agency).toEqual({ includedLocations: 10, bands: AGENCY_LOCATION_BANDS, selfServeMaxLocations: 500 });
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
    expect(lineItems()).toEqual([{ price: "price_chub_v1_plan_pro_month_7900", quantity: 1 }]);
    const [params, options] = mocks.pricesCreate.mock.calls[0];
    expect(params).toMatchObject({ currency: "usd", unit_amount: 7900, recurring: { interval: "month" }, lookup_key: "chub_v1_plan_pro_month_7900", transfer_lookup_key: true, metadata: { chub_kind: "plan", chub_key: "pro" } });
    expect(options.idempotencyKey).toBe("chub-price-chub_v1_plan_pro_month_7900");
  });

  it("reuses an existing Stripe Price instead of creating another", async () => {
    mocks.rows.push([customerRow()], [customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "pro" });
    resetPriceCache(); // a restart: the price is found by lookup key in Stripe
    await request("/api/stripe/create-checkout", { plan: "pro" });
    expect(mocks.pricesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.checkout.mock.calls[1][0].line_items[0].price).toBe("price_chub_v1_plan_pro_month_7900");
  });

  it("annual billing is 10x monthly on a yearly price", async () => {
    mocks.rows.push([customerRow()]);
    expect((await request("/api/stripe/create-checkout", { plan: "growth", interval: "year" })).code).toBe(200);
    expect(priceOf(lineItems()[0].price)).toMatchObject({ unit_amount: PLANS.growth.annualCents, recurring: { interval: "year" } });
  });

  it("Agency with 25 locations: base + a graduated band price, quantity = locations above 10", async () => {
    mocks.rows.push([customerRow()]);
    expect((await request("/api/stripe/create-checkout", { plan: "agency", interval: "month", locations: 25 })).code).toBe(200);
    const [base, band] = lineItems();
    expect(priceOf(base.price).unit_amount).toBe(PLANS.agency.monthlyCents);
    expect(band.quantity).toBe(15);
    expect(priceOf(band.price)).toMatchObject({
      billing_scheme: "tiered", tiers_mode: "graduated", recurring: { interval: "month" },
      tiers: [{ up_to: 40, unit_amount: 1500 }, { up_to: 240, unit_amount: 1000 }, { up_to: "inf", unit_amount: 700 }],
      metadata: { chub_kind: "agency_locations" },
    });
    // $349 + 15 × $15 = $574 — the price book's own number.
    expect(PLANS.agency.monthlyCents + 15 * 1500).toBe(agencyMonthlyCents(25));
  });

  it("Agency annual uses the yearly band price (10x each band)", async () => {
    mocks.rows.push([customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "agency", interval: "year", locations: 60 });
    const [base, band] = lineItems();
    expect(priceOf(base.price).unit_amount).toBe(PLANS.agency.annualCents);
    expect(band.quantity).toBe(50);
    expect(priceOf(band.price).tiers).toEqual([{ up_to: 40, unit_amount: 15000 }, { up_to: 240, unit_amount: 10000 }, { up_to: "inf", unit_amount: 7000 }]);
  });

  it("Agency at or under 10 locations bills the base only", async () => {
    mocks.rows.push([customerRow()]);
    await request("/api/stripe/create-checkout", { plan: "agency", locations: 4 });
    expect(lineItems()).toHaveLength(1);
    expect(mocks.checkout.mock.calls[0][0].metadata.locations).toBe("10");
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
    const res = await request("/api/stripe/create-checkout", { plan: "pro", addons: { extra_seat: 2, texting_number: 1, protected_site: 1, competitor_pack: 0 } });
    expect(res.code).toBe(200);
    const lines = lineItems().map((l) => ({ ...l, p: priceOf(l.price) }));
    expect(lines.map((l) => [l.p.metadata.chub_kind, l.p.metadata.chub_key, l.quantity])).toEqual([
      ["plan", "pro", 1],
      ["addon", "extra_seat", 2],
      ["addon", "protected_site", 1],
      ["addon", "texting_number", 1],
      ["setup", "texting_number", 1],
    ]);
    expect(lines[1].p).toMatchObject({ unit_amount: ADDONS.extra_seat.monthlyCents, recurring: { interval: "month" } });
    const setup = lines[4].p;
    expect(setup.unit_amount).toBe(ADDONS.texting_number.setupCents);
    expect(setup.recurring).toBeUndefined();
    expect(JSON.parse(mocks.checkout.mock.calls[0][0].metadata.addons)).toEqual({ extra_seat: 2, texting_number: 1, protected_site: 1 });
  });

  it.each([
    [{ plan: "starter", addons: { protected_site: 1 } }, 400, /isn't available on the Starter plan/],
    [{ plan: "growth", addons: { texting_number: 1 } }, 400, /already includes a client-texting number/],
    [{ plan: "agency", addons: { extra_location: 1 } }, 400, /billed by location count/],
    [{ plan: "starter", addons: { extra_location: 9 } }, 400, /Agency plan/],
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

  it("allows extra locations up to 9 in all on a non-Agency plan", async () => {
    mocks.rows.push([customerRow()]);
    expect((await request("/api/stripe/create-checkout", { plan: "starter", addons: { extra_location: 8 } })).code).toBe(200);
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
    const planPrice = `price_chub_v1_plan_pro_${interval}_${interval === "year" ? 79000 : 7900}`;
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

  it("refuses to carry an add-on the new plan doesn't offer (Growth includes a texting number)", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "growth" });
    expect(res.code).toBe(400);
    expect(res.body.code).toBe("addon_unavailable");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("month → year reprices every item to its yearly price", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "pro", interval: "year" })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([
      { id: "si_plan", price: "price_chub_v1_plan_pro_year_79000", quantity: 1 },
      { id: "si_text", price: "price_chub_v1_addon_texting_number_year_29000", quantity: 1 },
    ]);
    expect(mocks.update.mock.calls[0][1].add_invoice_items).toBeUndefined(); // no second setup fee
  });

  it("switching to Agency adds the band item for the requested locations", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/change-plan", { plan: "agency", locations: 30 })).code).toBe(200);
    const items = mocks.update.mock.calls[0][1].items;
    expect(items).toContainEqual({ id: "si_plan", price: "price_chub_v1_plan_agency_month_34900", quantity: 1 });
    expect(items).toContainEqual({ price: expect.stringMatching(/^price_chub_v1_agencyloc_month_/), quantity: 20 });
    expect(mocks.updates[0]).toMatchObject({ plan: "agency", agencyLocations: 30, addons: { texting_number: 1 } });
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
      { id: "si_old", price: "price_chub_v1_plan_pro_year_79000", quantity: 1 },
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
    await seedProSubscription([item("si_dup", "price_chub_v1_plan_pro_month_7900", 1, { kind: "plan", key: "pro" })]);
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
    const res = await request("/api/stripe/addons", { addons: { extra_seat: 2, texting_number: 1 } });
    expect(res.code).toBe(200);
    const params = mocks.update.mock.calls[0][1];
    expect(params.items).toEqual([
      { price: "price_chub_v1_addon_extra_seat_month_1500", quantity: 2 },
      { price: "price_chub_v1_addon_texting_number_month_2900", quantity: 1 },
    ]);
    expect(params.add_invoice_items).toEqual([{ price: "price_chub_v1_setup_texting_number_2900", quantity: 1 }]);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.updates[0].addons).toEqual({ extra_seat: 2, texting_number: 1 });
  });

  it("add-ons: 0 removes one; unavailable ones and legacy plans are refused", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    expect((await request("/api/stripe/addons", { addons: { texting_number: 0 } })).code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ id: "si_text", deleted: true }]);

    mocks.current = subscription([item("si_plan", "price_x", 1, { kind: "plan", key: "starter" })]);
    mocks.rows.push([liveRow({ plan: "starter" })]);
    const refused = await request("/api/stripe/addons", { addons: { protected_site: 1 } });
    expect(refused.code).toBe(400);
    expect(refused.body.message).toMatch(/Starter/);

    mocks.current = subscription([item("si_old", "price_legacy_premium")]);
    mocks.rows.push([liveRow({ plan: "premium" })]);
    const legacy = await request("/api/stripe/addons", { addons: { extra_seat: 1 } });
    expect(legacy.code).toBe(409);
    expect(legacy.body.code).toBe("legacy_plan");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("add-ons: one add-on as { addon, quantity } (the Settings card's body) works like { addons }", async () => {
    await seedProSubscription();
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/addons", { addon: "extra_seat", quantity: 2 });
    expect(res.code).toBe(200);
    expect(mocks.update.mock.calls[0][1].items).toEqual([{ price: "price_chub_v1_addon_extra_seat_month_1500", quantity: 2 }]);
    expect(mocks.updates[0].addons).toEqual({ extra_seat: 2, texting_number: 1 });

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

  it("a past-due subscription keeps its plan while Stripe retries the card; unpaid or canceled do not", async () => {
    mocks.rows.push([liveRow({ status: "past_due" })]);
    expect((await request("GET /api/stripe/subscription")).body).toMatchObject({ status: "past_due", effectivePlan: "pro" });
    for (const status of ["unpaid", "canceled", "incomplete_expired", "incomplete"]) {
      mocks.rows.push([liveRow({ status })]);
      expect((await request("GET /api/stripe/subscription")).body.effectivePlan, status).toBeNull();
    }
  });

  it("a plan change records the subscription's cancellation state with the row", async () => {
    await seedProSubscription();
    mocks.current.cancel_at_period_end = true;
    mocks.rows.push([liveRow()]);
    const res = await request("/api/stripe/change-plan", { plan: "pro", addons: { extra_seat: 1 } });
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

describe("webhook maps the subscription's items onto the row", () => {
  async function webhook(event: any) {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
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
  async function webhook(event: any) {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
    try {
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
