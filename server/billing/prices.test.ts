import { beforeEach, describe, expect, it, vi } from "vitest";
// The Stripe price catalog derived from shared/plans.ts: Agency band tiers,
// lookup keys that encode the amount, idempotent price creation and reading a
// subscription's plan/add-ons back from its items. Pure — no Stripe, no DB.
import {
  agencyLocationTiers, tieredAmountCents, planPriceSpec, addonPriceSpec, addonSetupPriceSpec, agencyLocationsPriceSpec,
  resolvePriceId, resetPriceCache, describeSubscription, roleOfPrice,
} from "./prices";
import { ensureBillingSchema, BILLING_SUBSCRIPTION_DDL, BILLING_COLUMNS, BILLING_LEDGER_DDL, BILLING_LEDGER_TABLES, FULFILMENT_DDL, FULFILMENT_INDEXES, BILLING_INTRO_DDL } from "./schema";
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

  it("the AI Call Assistant's prices: lookup keys from the 2026-10-08 cents, named as the service (never a plan add-on)", () => {
    // A changed price is a new lookup key, so the launch-era Stripe Prices are never reused: no manual Stripe work.
    expect(addonPriceSpec("call_assistant_lite", "month")).toMatchObject({
      lookupKey: "chub_v1_addon_call_assistant_lite_month_24900",
      role: { kind: "addon", key: "call_assistant_lite", interval: "month" },
      params: { unit_amount: 24900, recurring: { interval: "month" }, product_data: { name: "ConstructHUB AI Call Assistant — 500 minutes" } },
    });
    expect(addonPriceSpec("call_assistant", "year").lookupKey).toBe("chub_v1_addon_call_assistant_year_383900");
    expect(addonPriceSpec("call_assistant_crew", "month").lookupKey).toBe("chub_v1_addon_call_assistant_crew_month_44900");
    expect(addonPriceSpec("call_assistant_fleet", "year")).toMatchObject({ lookupKey: "chub_v1_addon_call_assistant_fleet_year_1098900", params: { unit_amount: 1_098_900 } });
    expect(addonPriceSpec("call_number", "year")).toMatchObject({ lookupKey: "chub_v1_addon_call_number_year_5000", params: { product_data: { name: "ConstructHUB AI Call Assistant — Extra Call Assistant number" } } });
    // The platform's own add-ons keep their naming.
    expect(addonPriceSpec("competitor_pack", "month").params.product_data?.name).toBe("ConstructHUB add-on — Competitor scan pack");
    const keys = (["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet", "call_number"] as const)
      .flatMap((k) => [addonPriceSpec(k, "month").lookupKey, addonPriceSpec(k, "year").lookupKey]);
    for (const old of ["chub_v1_addon_call_assistant_lite_month_14900", "chub_v1_addon_call_assistant_lite_year_119900", "chub_v1_addon_call_assistant_month_24900",
      "chub_v1_addon_call_assistant_year_199900", "chub_v1_addon_call_assistant_crew_year_359900", "chub_v1_addon_call_assistant_fleet_month_79900", "chub_v1_addon_call_number_year_5500"]) {
      expect(keys, old).not.toContain(old);
    }
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
    // Columns, ledger tables, fulfilment indexes and the intro table all present: four catalog reads, no DDL.
    const present = { query: vi.fn(async (sql: string) => ({
      rows: /billing_addon_intros/.test(sql) ? [{}]
        : /information_schema\.tables/.test(sql) ? BILLING_LEDGER_TABLES.map(() => ({}))
        : /pg_indexes/.test(sql) ? FULFILMENT_INDEXES.map(() => ({}))
        : BILLING_COLUMNS.map(() => ({})),
    })) };
    await ensureBillingSchema(present);
    expect(present.query).toHaveBeenCalledTimes(4);
    expect(present.query.mock.calls.every((c) => /information_schema|pg_indexes/.test(c[0]))).toBe(true);

    const missing = { query: vi.fn(async (_sql: string) => ({ rows: [{}] })) };
    await ensureBillingSchema(missing);
    const statements = missing.query.mock.calls.map((c) => c[0]);
    expect(statements.slice(1, 1 + BILLING_SUBSCRIPTION_DDL.length)).toEqual([...BILLING_SUBSCRIPTION_DDL]);
    // Then the ledger: one catalog read, then its CREATE ... IF NOT EXISTS statements.
    const ledgerAt = 1 + BILLING_SUBSCRIPTION_DDL.length;
    expect(statements[ledgerAt]).toMatch(/information_schema\.tables/);
    expect(statements.slice(ledgerAt + 1, ledgerAt + 1 + BILLING_LEDGER_DDL.length)).toEqual([...BILLING_LEDGER_DDL]);
    // Then the purchase-fulfilment indexes: one catalog read, then CREATE UNIQUE INDEX ... IF NOT EXISTS (one per session + item).
    const fulfilmentAt = ledgerAt + 1 + BILLING_LEDGER_DDL.length;
    expect(statements[fulfilmentAt]).toMatch(/pg_indexes/);
    expect(statements.slice(fulfilmentAt + 1, fulfilmentAt + 1 + FULFILMENT_DDL.length)).toEqual([...FULFILMENT_DDL]);
    // Then the add-on intro ledger (server/billing/intro.ts): its catalog read, then CREATE TABLE IF NOT EXISTS.
    // (The fake answers every read with one row, so it reads as present and nothing is created.)
    const introAt = fulfilmentAt + 1 + FULFILMENT_DDL.length;
    expect(statements[introAt]).toMatch(/billing_addon_intros/);
    for (const ddl of BILLING_INTRO_DDL) expect(ddl).toMatch(/^CREATE TABLE IF NOT EXISTS billing_addon_intros/);
    for (const ddl of FULFILMENT_DDL) expect(ddl).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS \w+_session_item_idx\s+ON (course|service)_purchases/);
    // The ledger DDL is the account schema's (one definition): CREATE … IF NOT EXISTS, plus the removal of the
    // duplicate indexes earlier builds created under other names (DROP INDEX IF EXISTS, idempotent).
    for (const ddl of BILLING_LEDGER_DDL) expect(ddl).toMatch(/^(CREATE (TABLE|INDEX) IF NOT EXISTS |DROP INDEX IF EXISTS billing_)/);
    for (const ddl of BILLING_SUBSCRIPTION_DDL) expect(ddl).toMatch(/^ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS /);
    // One statement per checked column, so a routine boot never re-runs DDL.
    expect(BILLING_SUBSCRIPTION_DDL.map((ddl) => ddl.split(" ")[8])).toEqual([...BILLING_COLUMNS]);
  });
});
