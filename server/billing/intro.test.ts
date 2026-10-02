import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Add-on intro prices (owner, 2026-10-02: AI Call Assistant $99/mo for the first
// 3 months, then the regular price): the coupon built from shared/plans.ts, who is
// eligible (once per customer; an abandoned checkout does not count), and the
// coupon landing on exactly the subscription item that adds the add-on.
// Fake Stripe; the grant ledger (billing_addon_intros) on the real dev DB.
import pg from "pg";
import {
  addonIntro, introFor, introCouponSpec, resolveIntroCoupon, resetIntroCouponCache, introEligible, recordIntro, introsForOrder, attachIntrosToItems,
} from "./intro";
import { BILLING_INTRO_DDL } from "./schema";
import { resetPriceCache, addonPriceSpec, describeSubscription } from "./prices";
import { subscriptionChange, type PlanOrder } from "./order";
import { ADDONS } from "@shared/plans";
import { CALL_ASSISTANT_INTRO, callAssistantIntroLine, callAssistantIntroShort } from "@shared/plan-copy";

const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL || process.env.DATABASE_URL });
// Account ids far above any real users row (the table has no FK; rows are removed after).
const USER = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const users = [USER, USER + 1, USER + 2, USER + 3];

function fakeStripe() {
  const coupons = new Map<string, any>();
  const prices: any[] = [];
  const sessions = new Map<string, { id: string; status: string }>();
  const stripe = {
    coupons: {
      retrieve: vi.fn(async (id: string) => {
        const c = coupons.get(id);
        if (!c) throw Object.assign(new Error("No such coupon"), { code: "resource_missing", statusCode: 404 });
        return c;
      }),
      create: vi.fn(async (params: any) => { const c = { ...params, valid: true }; coupons.set(params.id, c); return c; }),
    },
    prices: {
      list: vi.fn(async ({ lookup_keys }: any) => ({ data: prices.filter((p) => lookup_keys.includes(p.lookup_key)) })),
      create: vi.fn(async (params: any) => { const p = { id: `price_${prices.length + 1}`, product: `prod_${prices.length + 1}`, active: true, ...params }; prices.push(p); return p; }),
      retrieve: vi.fn(async (id: string) => prices.find((p) => p.id === id)),
    },
    checkout: {
      sessions: {
        retrieve: vi.fn(async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error("No such session"), { code: "resource_missing", statusCode: 404 });
          return s;
        }),
      },
    },
  };
  return { stripe, coupons, prices, sessions };
}

beforeAll(async () => {
  for (const statement of BILLING_INTRO_DDL) await pool.query(statement);
});
afterAll(async () => {
  await pool.query("DELETE FROM billing_addon_intros WHERE user_id = ANY($1)", [users]);
  await pool.end();
});
beforeEach(() => { resetIntroCouponCache(); resetPriceCache(); });

describe("the intro offer comes from the price book", () => {
  it("call_assistant: $99/mo for 3 months, then the regular price; other add-ons have none", () => {
    expect(addonIntro("call_assistant")).toEqual({ addon: "call_assistant", monthlyCents: 9900, months: 3 });
    expect(addonIntro("call_number")).toBeNull();
    expect(addonIntro("extra_seat")).toBeNull();
    // The copy reads the same fields the coupon is built from.
    expect(CALL_ASSISTANT_INTRO).toEqual({ monthlyCents: ADDONS.call_assistant.introMonthlyCents, months: ADDONS.call_assistant.introMonths });
    const regular = `$${ADDONS.call_assistant.monthlyCents / 100}`;
    // Owner, 2026-10-02: "annually price can be $1999" — every surface states it beside the intro.
    expect(ADDONS.call_assistant.annualCents).toBe(199_900);
    expect(callAssistantIntroShort()).toBe(`$99/mo for your first 3 months, then ${regular}/mo — or $1,999/yr`);
    expect(callAssistantIntroLine()).toBe(`$99/month for your first 3 months, then ${regular}/month — or $1,999/year`);
  });

  it("monthly: regular − intro off, repeating for 3 months; annual: no intro at all", () => {
    const perMonth = ADDONS.call_assistant.monthlyCents - 9900;
    const month = introCouponSpec("call_assistant", "month")!;
    expect(month.params).toMatchObject({ amount_off: perMonth, currency: "usd", duration: "repeating", duration_in_months: 3 });
    expect(month.id).toBe(`chub_v1_intro_call_assistant_month_${ADDONS.call_assistant.monthlyCents}_9900x3`);
    expect(introFor("call_assistant", "month")).toEqual({ addon: "call_assistant", monthlyCents: 9900, months: 3 });
    // The yearly price ($1,999) is the yearly deal: no coupon, no grant.
    expect(introFor("call_assistant", "year")).toBeNull();
    expect(introCouponSpec("call_assistant", "year")).toBeNull();
    expect(introCouponSpec("extra_seat", "month")).toBeNull();
  });

  it("an annual order gets no coupon, creates none and records no grant (the intro stays unused)", async () => {
    const f = fakeStripe();
    expect(await resolveIntroCoupon(f.stripe, "call_assistant", "year")).toBeNull();
    expect(await introsForOrder(f.stripe, USER + 2, {}, { call_assistant: 1 }, "year", pool)).toEqual([]);
    expect(f.stripe.coupons.create).not.toHaveBeenCalled();
    expect(f.stripe.coupons.retrieve).not.toHaveBeenCalled();
    // The same account buying monthly later still gets it.
    expect(await introsForOrder(f.stripe, USER + 2, {}, { call_assistant: 1 }, "month", pool)).toEqual([
      { addon: "call_assistant", couponId: introCouponSpec("call_assistant", "month")!.id },
    ]);
  });
});

describe("resolveIntroCoupon", () => {
  it("creates the coupon once, scoped to the add-on's own product, then reuses it", async () => {
    const f = fakeStripe();
    const id = await resolveIntroCoupon(f.stripe, "call_assistant", "month");
    expect(id).toBe(introCouponSpec("call_assistant", "month")!.id);
    expect(f.stripe.coupons.create).toHaveBeenCalledTimes(1);
    const params = f.stripe.coupons.create.mock.calls[0][0] as any;
    const addonPrice = f.prices.find((p) => p.lookup_key === addonPriceSpec("call_assistant", "month").lookupKey);
    expect(params.applies_to).toEqual({ products: [addonPrice.product] });
    resetIntroCouponCache();
    expect(await resolveIntroCoupon(f.stripe, "call_assistant", "month")).toBe(id);
    expect(f.stripe.coupons.create).toHaveBeenCalledTimes(1);
    expect(await resolveIntroCoupon(f.stripe, "extra_seat", "month")).toBeNull();
  });
});

describe("once per customer", () => {
  it("a subscription grant uses the intro up; a checkout grant only once that session completed", async () => {
    const f = fakeStripe();
    expect(await introEligible(f.stripe, USER, "call_assistant", pool)).toBe(true);
    await recordIntro(USER, "call_assistant", "coupon_x", "sub_123", pool);
    expect(await introEligible(f.stripe, USER, "call_assistant", pool)).toBe(false);

    // Checkout: open/expired → still eligible; complete → used; unknown session → eligible (never paid).
    f.sessions.set("cs_open", { id: "cs_open", status: "expired" });
    await recordIntro(USER + 1, "call_assistant", "coupon_x", "cs_open", pool);
    expect(await introEligible(f.stripe, USER + 1, "call_assistant", pool)).toBe(true);
    f.sessions.set("cs_open", { id: "cs_open", status: "complete" });
    expect(await introEligible(f.stripe, USER + 1, "call_assistant", pool)).toBe(false);
    await recordIntro(USER + 2, "call_assistant", "coupon_x", "cs_gone", pool);
    expect(await introEligible(f.stripe, USER + 2, "call_assistant", pool)).toBe(true);
    // No intro on an add-on that has none.
    expect(await introEligible(f.stripe, USER + 3, "extra_seat", pool)).toBe(false);
  });
});

describe("the coupon lands on the item that first adds the add-on", () => {
  const sub = (addons: Record<string, number>, f: ReturnType<typeof fakeStripe>) => {
    // a live subscription shape: our plan price + the add-ons it already holds
    const items: any[] = [{ id: "si_plan", quantity: 1, price: { id: "price_plan", lookup_key: "chub_v1_plan_pro_month_x", metadata: { chub_kind: "plan", chub_key: "pro", chub_interval: "month" }, recurring: { interval: "month" } } }];
    for (const [key, qty] of Object.entries(addons)) {
      const price = f.prices.find((p) => p.lookup_key === addonPriceSpec(key as any, "month").lookupKey) ?? { id: `price_${key}` };
      items.push({ id: `si_${key}`, quantity: qty, price: { ...price, metadata: { chub_kind: "addon", chub_key: key, chub_interval: "month" }, recurring: { interval: "month" } } });
    }
    return describeSubscription(items as any);
  };
  const order = (addons: Record<string, number>): PlanOrder => ({ plan: "pro", interval: "month", addons, agencyLocations: null });

  it("first purchase: the new call_assistant item carries the coupon, nothing else does", async () => {
    const f = fakeStripe();
    const current = sub({ extra_seat: 1 }, f);
    const change = await subscriptionChange(f.stripe as any, current, order({ extra_seat: 2, call_assistant: 1 }));
    const intros = await introsForOrder(f.stripe, USER + 3, current.addons, { extra_seat: 2, call_assistant: 1 }, "month", pool);
    expect(intros).toEqual([{ addon: "call_assistant", couponId: introCouponSpec("call_assistant", "month")!.id }]);
    const attached = await attachIntrosToItems(f.stripe, change.items, intros, "month");
    expect(attached).toHaveLength(1);
    const withCoupon = change.items.filter((i) => i.discounts);
    expect(withCoupon).toHaveLength(1);
    expect(withCoupon[0]).toMatchObject({ quantity: 1, discounts: [{ coupon: intros[0].couponId }] });
    expect(withCoupon[0].id).toBeUndefined();
  });

  it("an account that already holds the add-on, or already had the intro, gets nothing", async () => {
    const f = fakeStripe();
    expect(await introsForOrder(f.stripe, USER + 3, { call_assistant: 1 }, { call_assistant: 2 }, "month", pool)).toEqual([]);
    await recordIntro(USER + 3, "call_assistant", "coupon_x", "sub_9", pool);
    expect(await introsForOrder(f.stripe, USER + 3, {}, { call_assistant: 1 }, "month", pool)).toEqual([]);
  });
});
