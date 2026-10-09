import { describe, expect, it, vi } from "vitest";
// Add-on introductory prices (server/billing/intro.ts) are RETIRED: the AI Call
// Assistant's launch intro ($99 for 3 months on the old Solo tier) ended with
// the 2026-10-08 repricing, and no add-on carries one. The module stays for the
// grants it recorded (billing_addon_intros), so these tests pin that it is
// inert for every new purchase: no coupon, no grant, no Stripe call, no query.
// Pure — a recording Stripe and a throwing database stand in.
import {
  addonIntro, introFor, introCouponSpec, resolveIntroCoupon, resetIntroCouponCache, introEligible, introsForOrder, attachIntrosToItems,
  markIntrosUsedByHeldAddons,
} from "./intro";
import { ADDONS, ADDON_KEYS, CALL_ASSISTANT_TIERS, type BillingInterval } from "@shared/plans";

vi.mock("../db", () => ({ pool: { query: vi.fn(async () => { throw new Error("the intro module must not query the database for a purchase"); }) }, db: {} }));

function fakeStripe() {
  const calls: string[] = [];
  const stripe = {
    coupons: {
      retrieve: vi.fn(async (id: string) => { calls.push(`coupons.retrieve ${id}`); throw Object.assign(new Error("No such coupon"), { code: "resource_missing", statusCode: 404 }); }),
      create: vi.fn(async (params: any) => { calls.push(`coupons.create ${params.id}`); return { id: params.id }; }),
    },
    prices: { retrieve: vi.fn(async (id: string) => { calls.push(`prices.retrieve ${id}`); return { id, product: "prod_x" }; }) },
    checkout: { sessions: { retrieve: vi.fn(async (id: string) => { calls.push(`checkout.sessions.retrieve ${id}`); return { id, status: "complete" }; }) } },
  };
  return { stripe, calls };
}
/** A database that records what it is asked and answers nothing: the intro module should ask it nothing. */
const quietDb = () => { const queries: string[] = []; return { queries, q: { query: async (text: string) => { queries.push(text); return { rows: [] }; } } }; };

describe("no add-on carries an intro price (owner, 2026-10-08)", () => {
  it("the price book: every add-on, the AI Call Assistant's four tiers first, has no introMonthlyCents / introMonths", () => {
    for (const key of ADDON_KEYS) {
      expect(ADDONS[key].introMonthlyCents, key).toBeUndefined();
      expect(ADDONS[key].introMonths, key).toBeUndefined();
      expect(addonIntro(key), key).toBeNull();
      for (const interval of ["month", "year"] as BillingInterval[]) {
        expect(introFor(key, interval), `${key} ${interval}`).toBeNull();
        expect(introCouponSpec(key, interval), `${key} ${interval}`).toBeNull();
      }
    }
    expect(CALL_ASSISTANT_TIERS.map((t) => (t as any).introMonthlyCents)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("a new purchase of any tier, monthly or yearly, gets no coupon and records no grant: no Stripe call, no database query", async () => {
    resetIntroCouponCache();
    const { stripe, calls } = fakeStripe();
    const db = quietDb();
    for (const t of CALL_ASSISTANT_TIERS) {
      for (const interval of ["month", "year"] as BillingInterval[]) {
        expect(await resolveIntroCoupon(stripe, t.addon, interval)).toBeNull();
        expect(await introsForOrder(stripe, 42, {}, { [t.addon]: 1, call_number: 2 }, interval, db.q)).toEqual([]);
        expect(await introEligible(stripe, 42, t.addon, db.q)).toBe(false);
      }
    }
    // A switch between tiers, or holding one, marks nothing either.
    expect(await introsForOrder(stripe, 42, { call_assistant_crew: 1 }, { call_assistant: 1 }, "month", db.q)).toEqual([]);
    expect(await markIntrosUsedByHeldAddons(42, { call_assistant_fleet: 1, call_number: 2 }, "active", "sub_live", db.q)).toEqual([]);
    expect(await markIntrosUsedByHeldAddons(42, { call_assistant: 1 }, "trialing", "sub_live", db.q)).toEqual([]);
    // Nothing to attach: the subscription items are left exactly as they are.
    const items = [{ price: "price_chub_v1_addon_call_assistant_month_34900", quantity: 1 }] as any[];
    expect(await attachIntrosToItems(stripe, items, [], "month")).toEqual([]);
    expect(items[0].discounts).toBeUndefined();
    expect(calls).toEqual([]);
    expect(db.queries).toEqual([]);
  });
});
