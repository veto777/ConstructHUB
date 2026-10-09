import { beforeEach, describe, expect, it, vi } from "vitest";
import { priceSnapshot } from "@shared/pricing-terms";
import { describeSubscription, resetPriceCache } from "./prices";
import { parsePlanOrder, subscriptionChange, subscriptionOrderTotal } from "./order";

const item = (key: string, amount: number, kind = "plan", quantity = 1) => ({
  id: `si_${key}`, quantity,
  price: { id: `price_${key}`, unit_amount: amount, metadata: { chub_kind: kind, chub_key: key }, recurring: { interval: "month" } },
});
const stripe = () => ({ prices: {
  list: vi.fn(async () => ({ data: [] })),
  create: vi.fn(async (p: any) => ({ ...p, id: p.lookup_key })),
} }) as any;
const foundingTerms = () => {
  const prices = priceSnapshot();
  prices.plans.agency = { monthlyCents: 34900, annualCents: 349000 };
  return { since: new Date("2026-09-30"), prices };
};
beforeEach(resetPriceCache);

describe("legacy billing edits", () => {
  it("keeps founding Agency's base and bands when only locations change from 30 to 31", async () => {
    const current = describeSubscription([item("agency", 34900), item("band", 0, "agency_locations", 20)] as any);
    const order = parsePlanOrder({ locations: 31 }, { ...current, agencyLocations: 30 });
    expect(order).toMatchObject({ plan: "agency", interval: "month", agencyLocations: 31, changePlan: false });
    expect(subscriptionOrderTotal(current, order, foundingTerms())).toBe(66400);
    const changes = await subscriptionChange(stripe(), current, order, "agency", foundingTerms());
    expect(changes.items).toEqual([{ id: "si_band", price: expect.any(String), quantity: 21 }]);
    expect(changes.addInvoiceItems).toEqual([]);
  });

  it("removes bands only on explicit Unlimited selection, retaining the founding lock", async () => {
    const current = describeSubscription([item("agency", 34900), item("band", 0, "agency_locations", 20)] as any);
    const order = parsePlanOrder({ plan: "agency" }, { ...current, agencyLocations: 30 });
    expect(order).toMatchObject({ agencyLocations: null, changePlan: true });
    expect(subscriptionOrderTotal(current, order, foundingTerms())).toBe(34900);
    const changes = await subscriptionChange(stripe(), current, order, "agency", foundingTerms());
    expect(changes.items).toContainEqual({ id: "si_band", deleted: true });
  });

  it("preserves the $19 paid location on unrelated edits and removes it on upgrade", async () => {
    const current = describeSubscription([item("starter", 2900), item("extra_location", 1900, "addon")] as any);
    const kept = parsePlanOrder({}, current);
    expect(kept.addons.extra_location).toBe(1);
    expect(subscriptionOrderTotal(current, kept)).toBe(4800);
    expect((await subscriptionChange(stripe(), current, kept, "starter")).items).toEqual([]);
    expect(() => parsePlanOrder({ addons: { extra_location: 2 } }, current)).toThrow();
    expect(() => parsePlanOrder({ plan: "starter", addons: { extra_location: 1 } })).toThrow();
    const upgraded = parsePlanOrder({ plan: "team" }, current);
    expect(upgraded.addons.extra_location).toBeUndefined();
    expect((await subscriptionChange(stripe(), current, upgraded, "starter")).items)
      .toContainEqual({ id: "si_extra_location", deleted: true });
  });
});
