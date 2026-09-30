import { beforeEach, describe, expect, it, vi } from "vitest";
// The Stripe price catalog derived from shared/plans.ts: Agency band tiers,
// lookup keys that encode the amount, idempotent price creation and reading a
// subscription's plan/add-ons back from its items. Pure — no Stripe, no DB.
import {
  agencyLocationTiers, tieredAmountCents, planPriceSpec, addonPriceSpec, addonSetupPriceSpec, agencyLocationsPriceSpec,
  resolvePriceId, resetPriceCache, describeSubscription, roleOfPrice,
} from "./prices";
import { ensureBillingSchema, BILLING_SUBSCRIPTION_DDL } from "./schema";
import { PLANS, ADDONS, ANNUAL_MONTHS, agencyMonthlyCents, agencyPriceCents, agencyExtraLocations, maxExtraLocations } from "@shared/plans";

describe("Agency location bands in Stripe", () => {
  it("the graduated tiers reproduce agencyMonthlyCents for every self-serve count, monthly and yearly", () => {
    const month = agencyLocationTiers("month");
    const year = agencyLocationTiers("year");
    for (let locations = 1; locations <= 500; locations++) {
      const extra = agencyExtraLocations(locations);
      expect(PLANS.agency.monthlyCents + tieredAmountCents(month, extra)).toBe(agencyMonthlyCents(locations));
      expect(PLANS.agency.annualCents + tieredAmountCents(year, extra)).toBe(agencyPriceCents(locations, "year"));
    }
  });

  it("matches the price book's worked examples", () => {
    expect([10, 25, 50, 100, 250, 500].map((n) => agencyMonthlyCents(n)! / 100)).toEqual([349, 574, 949, 1449, 2949, 4699]);
    expect(agencyMonthlyCents(501)).toBeNull();
  });

  it("the band price's lookup key changes when a band's price does", () => {
    const key = agencyLocationsPriceSpec("month").lookupKey;
    expect(key).toBe("chub_v1_agencyloc_month_40x1500-240x1000-infx700");
    expect(agencyLocationsPriceSpec("year").lookupKey).toBe(`chub_v1_agencyloc_year_40x${1500 * ANNUAL_MONTHS}-240x${1000 * ANNUAL_MONTHS}-infx${700 * ANNUAL_MONTHS}`);
  });
});

describe("price specs come only from shared/plans.ts", () => {
  it("plans, add-ons and setup fees", () => {
    expect(planPriceSpec("starter", "year")).toMatchObject({ lookupKey: "chub_v1_plan_starter_year_29000", params: { unit_amount: PLANS.starter.annualCents, recurring: { interval: "year" } } });
    expect(addonPriceSpec("competitor_pack", "month").params.unit_amount).toBe(ADDONS.competitor_pack.monthlyCents);
    expect(addonSetupPriceSpec("texting_number")).toMatchObject({ lookupKey: "chub_v1_setup_texting_number_2900", params: { unit_amount: 2900 } });
    expect(addonSetupPriceSpec("texting_number")!.params.recurring).toBeUndefined();
    expect(addonSetupPriceSpec("extra_seat")).toBeNull();
  });

  it("non-Agency plans stop short of 10 locations", () => {
    expect(maxExtraLocations("starter")).toBe(8);
    expect(maxExtraLocations("growth")).toBe(6);
    expect(maxExtraLocations("agency")).toBe(0);
  });
});

describe("resolvePriceId", () => {
  const fake = () => {
    const store: any[] = [];
    return {
      store,
      prices: {
        list: vi.fn(async ({ lookup_keys }: any) => ({ data: store.filter((p) => lookup_keys.includes(p.lookup_key)) })),
        create: vi.fn(async (params: any) => { const p = { id: `price_${store.length + 1}`, ...params }; store.push(p); return p; }),
      },
    } as any;
  };
  beforeEach(() => resetPriceCache());

  it("creates once (with an idempotency key and transfer_lookup_key), then reuses", async () => {
    const stripe = fake();
    const spec = planPriceSpec("pro", "month");
    const first = await resolvePriceId(stripe, spec);
    resetPriceCache();
    const second = await resolvePriceId(stripe, spec);
    expect(first).toBe(second);
    expect(stripe.prices.create).toHaveBeenCalledTimes(1);
    expect(stripe.prices.create.mock.calls[0][0]).toMatchObject({ lookup_key: spec.lookupKey, transfer_lookup_key: true, metadata: { chub_kind: "plan", chub_key: "pro", chub_interval: "month" } });
    expect(stripe.prices.create.mock.calls[0][1]).toEqual({ idempotencyKey: `chub-price-${spec.lookupKey}` });
    await resolvePriceId(stripe, spec); // cached: no list either
    expect(stripe.prices.list).toHaveBeenCalledTimes(2);
  });

  it("never reuses a price under our key whose amount doesn't match the spec", async () => {
    const stripe = fake();
    const spec = planPriceSpec("pro", "month");
    stripe.store.push({ id: "price_tampered", lookup_key: spec.lookupKey, currency: "usd", unit_amount: 1, recurring: { interval: "month" } });
    const id = await resolvePriceId(stripe, spec);
    expect(id).not.toBe("price_tampered");
    expect(stripe.prices.create.mock.calls[0][0].unit_amount).toBe(7900);
  });

  it("reuses a matching tiered band price", async () => {
    const stripe = fake();
    const spec = agencyLocationsPriceSpec("month");
    stripe.store.push({ id: "price_band", lookup_key: spec.lookupKey, currency: "usd", billing_scheme: "tiered", tiers_mode: "graduated", recurring: { interval: "month" }, tiers: agencyLocationTiers("month").map((t) => ({ ...t, up_to: t.up_to === "inf" ? null : t.up_to })) });
    expect(await resolvePriceId(stripe, spec)).toBe("price_band");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });
});

describe("describeSubscription", () => {
  const price = (id: string, meta: Record<string, string>, interval = "month") => ({ id, metadata: meta, recurring: { interval } }) as any;
  it("reads plan, interval, add-on quantities and Agency extra locations from our role metadata", () => {
    const shape = describeSubscription([
      { id: "si_1", quantity: 1, price: price("p1", { chub_kind: "plan", chub_key: "agency" }, "year") },
      { id: "si_2", quantity: 40, price: price("p2", { chub_kind: "agency_locations" }, "year") },
      { id: "si_3", quantity: 2, price: price("p3", { chub_kind: "addon", chub_key: "protected_site" }, "year") },
      { id: "si_4", quantity: 1, price: price("p4", {}) },
    ] as any);
    expect(shape).toMatchObject({ plan: "agency", interval: "year", addons: { protected_site: 2 }, agencyExtraLocations: 40 });
    expect(shape.otherItems.map((i) => i.id)).toEqual(["si_4"]);
  });

  it("ignores metadata that names no real plan or add-on", () => {
    expect(roleOfPrice(price("p", { chub_kind: "plan", chub_key: "platinum" }))).toBeNull();
    expect(roleOfPrice(price("p", { chub_kind: "addon", chub_key: "free_stuff" }))).toBeNull();
    expect(describeSubscription([{ id: "si", quantity: 1, price: price("p", { chub_kind: "plan", chub_key: "gold" }) }] as any))
      .toMatchObject({ plan: null, interval: "month" });
  });
});

describe("ensureBillingSchema", () => {
  it("only reads the catalog when the columns exist, and adds them idempotently when not", async () => {
    const present = { query: vi.fn(async () => ({ rows: [{}, {}, {}] })) };
    await ensureBillingSchema(present);
    expect(present.query).toHaveBeenCalledTimes(1);

    const missing = { query: vi.fn(async (_sql: string) => ({ rows: [{}] })) };
    await ensureBillingSchema(missing);
    expect(missing.query.mock.calls.slice(1).map((c) => c[0])).toEqual([...BILLING_SUBSCRIPTION_DDL]);
    for (const ddl of BILLING_SUBSCRIPTION_DDL) expect(ddl).toMatch(/^ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS /);
  });
});
