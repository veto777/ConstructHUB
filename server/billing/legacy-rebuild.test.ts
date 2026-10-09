import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) }, db: {} }));
import { foundingPrice, parseFoundingPrices, priceSnapshot } from "@shared/pricing-terms";
import { ADDONS } from "@shared/plans";
import { describeSubscription, resetPriceCache } from "./prices";
import { parsePlanOrder, subscriptionChange, subscriptionOrderTotal } from "./order";
import { subscriptionRowUpdate } from "./sync";

const item = (key: string, amount: number, kind = "plan", quantity = 1) => ({
  id: `si_${key}`, quantity,
  price: { id: `price_${key}`, unit_amount: amount, metadata: { chub_kind: kind, chub_key: key }, recurring: { interval: "month" } },
});
const legacy = () => describeSubscription([item("agency", 34900), item("band", 0, "agency_locations", 20)] as any);
const stripe = () => ({ prices: { list: vi.fn(async () => ({ data: [] })), create: vi.fn(async (p: any) => ({ ...p, id: p.lookup_key })) } }) as any;
beforeEach(resetPriceCache);

it("reads four-plan founding snapshots and falls back only for the new Team key", () => {
  const prices = priceSnapshot();
  delete prices.plans.team;
  prices.plans.pro = { monthlyCents: 7900, annualCents: 79000 };
  prices.plans.agency = { monthlyCents: 34900, annualCents: 349000 };
  expect(parseFoundingPrices(prices)).not.toBeNull();
  const terms = { foundingMemberAt: new Date(), foundingPrices: prices, seoGrandfatheredAt: null, seoGrandfatheredPlan: null };
  expect(foundingPrice(terms, "pro", "month")).toBe(7900);
  expect(foundingPrice(terms, "agency", "year")).toBe(349000);
  expect(foundingPrice(terms, "team", "month")).toBe(4900);
  expect(parseFoundingPrices({ ...prices, plans: { ...prices.plans, team: { monthlyCents: -1, annualCents: 2 } } })).toBeNull();
});

it("keeps legacy Agency base and bands on add-on and interval-only edits", async () => {
  const current = legacy();
  const order = parsePlanOrder({ addons: { grid_pack: 1 } }, { ...current, agencyLocations: 30 });
  const api = stripe();
  const changes = await subscriptionChange(api, current, order, "agency");
  expect(changes.items.some(i => i.id === "si_agency")).toBe(false);
  expect(subscriptionOrderTotal(current, order)).toBe(64900 + ADDONS.grid_pack.monthlyCents);
  const annual = parsePlanOrder({ interval: "year" }, { ...current, agencyLocations: 30 });
  expect(subscriptionOrderTotal(current, annual)).toBe(649000);
  await subscriptionChange(api, current, annual, "agency");
  expect(api.prices.create.mock.calls.some(([p]: any) => p.unit_amount === 349000)).toBe(true);
});

it("explicit Unlimited migration removes the band and marker in the same subscription update", async () => {
  const current = legacy();
  const order = parsePlanOrder({ plan: "agency", interval: "year" }, { ...current, agencyLocations: 30 });
  expect(order.agencyLocations).toBeNull();
  expect(subscriptionOrderTotal(current, order)).toBe(449000);
  const changes = await subscriptionChange(stripe(), current, order, "agency");
  expect(changes.items).toContainEqual({ id: "si_band", deleted: true });
  expect(changes.items).toContainEqual({ id: "si_agency", price: "chub_v1_plan_agency_year_449000", quantity: 1 });
});

it.each([
  ["starter", "team", "extra_location"],
  ["pro", "agency", "seo_basic"],
])("drops incompatible held add-ons on %s → %s", async (from, to, addon) => {
  const current = describeSubscription([item(from, 2900), item(addon, 2900, "addon")] as any);
  const order = parsePlanOrder({ plan: to }, current);
  expect(order.addons).toEqual({});
  const changes = await subscriptionChange(stripe(), current, order, from);
  expect(changes.items).toContainEqual({ id: `si_${addon}`, deleted: true });
  expect(() => parsePlanOrder({ plan: to, addons: { [addon]: 1 } }, current)).toThrow();
});

it("keeps retired holdings on unrelated edits and rejects buying more", () => {
  const current = { plan: "starter", addons: { extra_location: 1 } };
  expect(parsePlanOrder({ addons: { grid_pack: 1 } }, current).addons.extra_location).toBe(1);
  expect(() => parsePlanOrder({ addons: { extra_location: 2 } }, current)).toThrow();
});

it("keeps the legacy marker at ten locations after the band disappears, until explicit migration", () => {
  const sub: any = { id: "sub", status: "active", items: { data: [item("agency", 34900)] } };
  expect(subscriptionRowUpdate(sub).agencyLocations).toBe(10);
  sub.metadata = { legacy_agency_billing: "true" };
  expect(subscriptionRowUpdate(sub).agencyLocations).toBe(10);
  sub.metadata.legacy_agency_billing = "false";
  expect(subscriptionRowUpdate(sub).agencyLocations).toBeNull();
});

it("confirmation total includes retained add-ons and founding plan prices", () => {
  const current = describeSubscription([item("starter", 2900), item("grid_pack", ADDONS.grid_pack.monthlyCents, "addon")] as any);
  const order = parsePlanOrder({ plan: "pro", interval: "year" }, current);
  const prices = priceSnapshot(); delete prices.plans.team;
  prices.plans.pro = { monthlyCents: 7900, annualCents: 79000 };
  expect(subscriptionOrderTotal(current, order, { since: new Date(), prices })).toBe(79000 + ADDONS.grid_pack.annualCents);
});

it("adding a grid pack leaves founding Pro's $79 Stripe base untouched", async () => {
  const current = describeSubscription([item("pro", 7900)] as any);
  const order = parsePlanOrder({ addons: { grid_pack: 1 } }, current);
  const prices = priceSnapshot(); delete prices.plans.team;
  prices.plans.pro = { monthlyCents: 7900, annualCents: 79000 };
  const change = await subscriptionChange(stripe(), current, order, "pro", { since: new Date(), prices });
  expect(change.items).toEqual([{ price: `chub_v1_addon_grid_pack_month_${ADDONS.grid_pack.monthlyCents}`, quantity: 1 }]);
});
