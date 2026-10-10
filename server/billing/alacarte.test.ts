import { describe, expect, it, vi } from "vitest";
// Selling the tools à la carte (server/billing/alacarte.ts): Stripe prices by lookup key for both tiers, a
// subscription read back from its items, the order a checkout accepts, and the renewal-time repricing plan
// when a plan starts or ends. Pure — the database and Stripe are doubles.
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) }, db: {} }));
vi.mock("./client", () => ({ stripe: {}, stripeConfigured: () => false, stripeTimeoutMs: () => 1000, PaymentsNotConfiguredError: class extends Error {} }));
import { alacartePriceSpec, roleOfPrice, describeSubscription, addonPriceSpec } from "./prices";
import {
  isAlacarteSubscription, isAlacarteCheckoutSession, parseAlacarteOrder, describeAlacarteSubscription, alacarteRepricingPlan, activeKeysOf,
  alacarteRowSummary, ALACARTE_PRODUCT, ALACARTE_CHECKOUT_TYPE,
} from "./alacarte";
import { ALACARTE_SUBSCRIPTION_DDL, alacarteStateOf, activeAlacarteKeys, NO_ALACARTE } from "./alacarte-store";
import { ALACARTE, ALACARTE_KEYS, ALACARTE_MAX_QUANTITY, alacartePriceCents } from "@shared/alacarte";
import { ADDONS } from "@shared/plans";

describe("à la carte Stripe prices", () => {
  it("one lookup key per item, tier, interval and cents — created by lookup key, never by hand", () => {
    expect(alacartePriceSpec("gbp", "standalone", "month")).toMatchObject({
      lookupKey: "chub_v1_alacarte_gbp_standalone_month_3900",
      role: { kind: "alacarte", key: "gbp", tier: "standalone", interval: "month" },
      params: { unit_amount: 3900, recurring: { interval: "month" }, product_data: { name: "ConstructHUB Google Business Profile + Profile Guard" } },
    });
    expect(alacartePriceSpec("gbp", "addon", "year")).toMatchObject({
      lookupKey: "chub_v1_alacarte_gbp_addon_year_26400", params: { unit_amount: 26400, product_data: { name: "ConstructHUB Google Business Profile + Profile Guard (add-on price)" } },
    });
    expect(alacartePriceSpec("permits", "standalone", "year").lookupKey).toBe("chub_v1_alacarte_permits_standalone_year_218900");
    // An overlapping add-on's tier carries that add-on's cents (its own yearly price too).
    expect(alacartePriceSpec("seo_basic", "addon", "month").params.unit_amount).toBe(ADDONS.seo_basic.monthlyCents);
    expect(alacartePriceSpec("seo_basic", "addon", "year").params.unit_amount).toBe(addonPriceSpec("seo_basic", "year").params.unit_amount);
    expect(alacartePriceSpec("click_guard", "addon", "month").params.unit_amount).toBe(ADDONS.protected_site.monthlyCents);
    // Every key is distinct across items, tiers and intervals.
    const keys = ALACARTE_KEYS.flatMap((k) => (["standalone", "addon"] as const).flatMap((t) => (["month", "year"] as const).map((i) => alacartePriceSpec(k, t, i).lookupKey)));
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ALACARTE_KEYS) for (const t of ["standalone", "addon"] as const) for (const i of ["month", "year"] as const) {
      expect(alacartePriceSpec(k, t, i).params.unit_amount, `${k} ${t} ${i}`).toBe(alacartePriceCents(k, t, i));
    }
  });

  it("the role round-trips through the Price metadata, and a platform subscription never reads one as a plan or add-on", () => {
    const price = (meta: Record<string, string>, interval = "month") => ({ id: "price_x", metadata: meta, recurring: { interval } }) as any;
    expect(roleOfPrice(price({ chub_kind: "alacarte", chub_key: "reviews", chub_tier: "addon" }))).toEqual({ kind: "alacarte", key: "reviews", tier: "addon", interval: "month" });
    expect(roleOfPrice(price({ chub_kind: "alacarte", chub_key: "reviews" }))).toBeNull();
    expect(roleOfPrice(price({ chub_kind: "alacarte", chub_key: "call_assistant", chub_tier: "addon" }))).toBeNull();
    expect(roleOfPrice(price({ chub_kind: "alacarte", chub_key: "gbp", chub_tier: "free" }))).toBeNull();
    const shape = describeSubscription([{ id: "si_1", quantity: 1, price: price({ chub_kind: "alacarte", chub_key: "gbp", chub_tier: "standalone" }) }] as any);
    expect(shape.plan).toBeNull();
    expect(shape.addons).toEqual({});
    expect(shape.otherItems).toHaveLength(1);
  });
});

describe("telling an à la carte subscription apart", () => {
  const line = (meta: Record<string, string>, quantity = 1, interval = "month") => ({ id: `si_${meta.chub_key}`, quantity, price: { id: `price_${meta.chub_key}_${meta.chub_tier}`, metadata: meta, recurring: { interval } } });
  it("by our product metadata, or by an à la carte price among its items", () => {
    expect(isAlacarteSubscription({ metadata: { product: ALACARTE_PRODUCT }, items: { data: [] } } as any)).toBe(true);
    expect(isAlacarteSubscription({ metadata: {}, items: { data: [line({ chub_kind: "alacarte", chub_key: "gbp", chub_tier: "standalone" })] } } as any)).toBe(true);
    expect(isAlacarteSubscription({ metadata: { product: "crm" }, items: { data: [line({ chub_kind: "crm_plan", chub_key: "crm_basic" })] } } as any)).toBe(false);
    expect(isAlacarteSubscription({ metadata: {}, items: { data: [line({ chub_kind: "plan", chub_key: "pro" })] } } as any)).toBe(false);
    expect(isAlacarteSubscription(null)).toBe(false);
    expect(isAlacarteCheckoutSession({ metadata: { type: ALACARTE_CHECKOUT_TYPE } })).toBe(true);
    expect(isAlacarteCheckoutSession({ metadata: { type: "crm_plan" } })).toBe(false);
  });

  it("reads the item, tier, interval and quantity from the subscription's item (the metadata only as a fallback)", () => {
    const sub = { metadata: { item: "gbp" }, items: { data: [line({ chub_kind: "alacarte", chub_key: "gbp", chub_tier: "addon" }, 3, "year")] } } as any;
    expect(describeAlacarteSubscription(sub)).toMatchObject({ key: "gbp", tier: "addon", interval: "year", quantity: 3 });
    expect(describeAlacarteSubscription(sub).item?.id).toBe("si_gbp");
    // A sales rep's own price: the metadata names the item; the tier is unknown.
    const custom = { metadata: { item: "permits" }, items: { data: [{ id: "si_c", quantity: 1, price: { id: "price_c", metadata: {}, recurring: { interval: "month" } } }] } } as any;
    expect(describeAlacarteSubscription(custom)).toMatchObject({ key: "permits", tier: null, interval: "month", quantity: 1, item: null });
    expect(describeAlacarteSubscription({ metadata: {}, items: { data: [] } } as any)).toMatchObject({ key: null, tier: null, interval: null });
  });
});

describe("the checkout order", () => {
  it("one item, monthly or yearly; a quantity only for a per-unit item, within the self-serve ceiling", () => {
    expect(parseAlacarteOrder({ key: "reviews" })).toEqual({ key: "reviews", interval: "month", quantity: 1 });
    expect(parseAlacarteOrder({ item: "gbp", interval: "year", quantity: 3 })).toEqual({ key: "gbp", interval: "year", quantity: 3 });
    expect(() => parseAlacarteOrder({ key: "call_assistant" })).toThrow(/Choose a tool/);
    expect(() => parseAlacarteOrder({ key: "gbp", interval: "week" })).toThrow(/monthly or yearly/);
    expect(() => parseAlacarteOrder({ key: "gbp", quantity: 0 })).toThrow(/1 or more/);
    expect(() => parseAlacarteOrder({ key: "gbp", quantity: 1.5 })).toThrow(/whole number/);
    expect(() => parseAlacarteOrder({ key: "reviews", quantity: 2 })).toThrow(/one per account/);
    expect(() => parseAlacarteOrder({ key: "click_guard", quantity: ALACARTE_MAX_QUANTITY + 1 })).toThrow(/sales rep/);
    expect(parseAlacarteOrder({ key: "click_guard", quantity: ALACARTE_MAX_QUANTITY }).quantity).toBe(ALACARTE_MAX_QUANTITY);
  });
});

describe("standalone ↔ add-on at the next renewal", () => {
  const row = (item_key: string, tier: string, status = "active", stripe_subscription_id: string | null = `sub_${item_key}`) => ({ item_key, tier, status, stripe_subscription_id });
  it("moves every live item on the other tier, and nothing else", () => {
    const rows = [row("gbp", "standalone"), row("reviews", "standalone", "trialing"), row("permits", "addon"), row("site_scan", "standalone", "canceled"), row("social", "standalone", "active", null)];
    // A plan starts: the standalone items move to the add-on price; the one already on it stays; ended rows and rows with no Stripe subscription are left alone.
    const up = alacarteRepricingPlan(rows, { plan: "starter", crmPlan: null });
    expect(up.tier).toBe("addon");
    expect(up.moves).toEqual([
      { key: "gbp", from: "standalone", to: "addon", subscriptionId: "sub_gbp" },
      { key: "reviews", from: "standalone", to: "addon", subscriptionId: "sub_reviews" },
    ]);
    // A CRM plan alone is a plan too.
    expect(alacarteRepricingPlan(rows, { plan: null, crmPlan: "crm_basic" }).tier).toBe("addon");
    // The plan ends: the add-on item goes back to standalone.
    const down = alacarteRepricingPlan(rows, { plan: null, crmPlan: null });
    expect(down.tier).toBe("standalone");
    expect(down.moves).toEqual([{ key: "permits", from: "addon", to: "standalone", subscriptionId: "sub_permits" }]);
    // past_due is live at Stripe (it still bills): it is repriced for its next invoice too.
    expect(alacarteRepricingPlan([row("gbp", "standalone", "past_due")], { plan: "pro", crmPlan: null }).moves).toHaveLength(1);
    expect(alacarteRepricingPlan([], { plan: "pro", crmPlan: null }).moves).toEqual([]);
  });
});

describe("the rows as the entitlements and the tab read them", () => {
  it("active and trialing items are in force; a payment-needed one is paused; anything else is nothing", () => {
    const state = alacarteStateOf([
      { key: "gbp", tier: "addon", quantity: 2, status: "active" },
      { key: "reviews", tier: "standalone", quantity: 1, status: "trialing" },
      { key: "permits", tier: "standalone", quantity: 1, status: "past_due" },
      { key: "social", tier: "standalone", quantity: 1, status: "canceled" },
      { key: "bogus", tier: "standalone", quantity: 1, status: "active" },
      { key: "site_scan", tier: "nonsense", quantity: "x", status: "active" },
    ]);
    expect(state.active).toEqual([{ key: "gbp", quantity: 2 }, { key: "reviews", quantity: 1 }, { key: "site_scan", quantity: 1 }]);
    expect(state.paused).toEqual(["permits"]);
    expect(state.tiers).toEqual({ gbp: "addon", reviews: "standalone", permits: "standalone" });
    expect(activeAlacarteKeys(state)).toEqual(["gbp", "reviews", "site_scan"]);
    expect(alacarteStateOf(JSON.stringify([{ key: "gbp", tier: "standalone", quantity: 1, status: "active" }])).active).toEqual([{ key: "gbp", quantity: 1 }]);
    expect(alacarteStateOf(null)).toEqual(NO_ALACARTE);
    expect(alacarteStateOf("not json")).toEqual(NO_ALACARTE);
    expect(activeKeysOf([{ item_key: "gbp", status: "active" }, { item_key: "reviews", status: "canceled" }, { item_key: "nope", status: "active" }])).toEqual(["gbp"]);
  });

  it("summarises a row for the tab, and the table is created idempotently", () => {
    const summary = alacarteRowSummary({
      id: 1, user_id: 7, item_key: "gridrank", tier: "addon", quantity: 1, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", stripe_price_id: "price_1",
      status: "active", billing_interval: "year", current_period_end: null, cancel_at_period_end: false,
    });
    expect(summary).toMatchObject({ key: "gridrank", name: ALACARTE.gridrank.name, tier: "addon", interval: "year", active: true, hasLiveSubscription: true, cancelAtPeriodEnd: false });
    for (const ddl of ALACARTE_SUBSCRIPTION_DDL) expect(ddl).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS alacarte_subscriptions/);
    expect(ALACARTE_SUBSCRIPTION_DDL.join(" ")).toMatch(/UNIQUE INDEX IF NOT EXISTS alacarte_subscriptions_user_item_idx ON alacarte_subscriptions \(user_id, item_key\)/);
  });
});
