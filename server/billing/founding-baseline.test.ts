/**
 * The founding member promise (owner, 2026-10-08): a founding member keeps the
 * plan prices of the day they subscribed, for life. Checkout and plan changes
 * bill from the stored snapshot (shared/pricing-terms.ts foundingPrice, wired
 * into server/billing/order.ts on 2026-10-09) — never from the live book, so
 * a repricing moves no founding member. Members marked before 2026-10-09 keep
 * their stored 2026-10-08 snapshot (the four-plan book); this test pins the
 * book a NEW snapshot captures today: the plan prices, the legacy Agency
 * bands, the locations Agency includes and the annual multiplier, and the
 * Agency quotes at every band boundary on both intervals.
 */
import { describe, expect, it } from "vitest";
import { AGENCY_LOCATION_BANDS, ANNUAL_MONTHS, PLANS, PLAN_KEYS, agencyPriceCents } from "@shared/plans";
import { priceSnapshot } from "@shared/pricing-terms";

/**
 * The price book as it is from the 2026-10-09 five-plan ladder. Do not "fix"
 * this constant to make the test pass: it exists so a price change fails here
 * loudly — and the check above makes sure the billing path reads the snapshot.
 */
const FOUNDING_BASELINE = {
  plans: {
    starter: { monthlyCents: 2900, annualCents: 29000 },
    team: { monthlyCents: 4900, annualCents: 49000 },
    pro: { monthlyCents: 9900, annualCents: 99000 },
    growth: { monthlyCents: 19900, annualCents: 199000 },
    agency: { monthlyCents: 44900, annualCents: 449000 },
  },
  agencyBands: [
    { upTo: 10, centsPerLocation: 0 },
    { upTo: 50, centsPerLocation: 1500 },
    { upTo: 250, centsPerLocation: 1000 },
    { upTo: 500, centsPerLocation: 700 },
  ],
  // The `agency` key is Unlimited since the ladder: no included count (-1).
  agencyIncludedLocations: -1,
  annualMonths: 10,
} as const;

/** Agency quotes at the band boundaries, monthly and yearly — the bands are 2026-09-30 legacy maths and never change. */
const AGENCY_QUOTES_BASELINE: Record<number, { month: number; year: number }> = {
  10: { month: 34900, year: 349000 },
  11: { month: 36400, year: 364000 },
  50: { month: 94900, year: 949000 },
  51: { month: 95900, year: 959000 },
  250: { month: 294900, year: 2949000 },
  251: { month: 295600, year: 2956000 },
  500: { month: 469900, year: 4699000 },
};

const MESSAGE = "a price changed: founding members are billed from foundingPrice() (server/billing/order.ts) — confirm the snapshot is read on every checkout/change path, then re-baseline this constant";

describe("founding member price baseline", () => {
  it("the live price book equals the baseline a new founding snapshot captures", () => {
    const live = {
      plans: Object.fromEntries(PLAN_KEYS.map((k) => [k, { monthlyCents: PLANS[k].monthlyCents, annualCents: PLANS[k].annualCents }])),
      agencyBands: AGENCY_LOCATION_BANDS.map((b) => ({ upTo: b.upTo, centsPerLocation: b.centsPerLocation })),
      agencyIncludedLocations: PLANS.agency.limits.locations,
      annualMonths: ANNUAL_MONTHS,
    };
    expect(live, MESSAGE).toEqual(FOUNDING_BASELINE);
    // …and so a snapshot taken today is the same as the baseline.
    const { capturedAt: _at, ...snapshot } = priceSnapshot();
    expect(snapshot, MESSAGE).toEqual(FOUNDING_BASELINE);
  });

  it("covers the plans and the Agency bands only: the AI Call Assistant (a separate service, repriced 2026-10-08) is not in the snapshot", () => {
    // The founding lock is the plans' promise. The Call Assistant has its own subscription and its own price
    // book (shared/plans.ts CALL_ASSISTANT_TIERS); its 2026-10-08 repricing moved no founding member and is
    // not something foundingPrice() answers for.
    const { capturedAt: _at, ...snapshot } = priceSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["agencyBands", "agencyIncludedLocations", "annualMonths", "plans"]);
    expect(Object.keys(snapshot.plans).sort()).toEqual([...PLAN_KEYS].sort());
    expect(JSON.stringify(snapshot)).not.toMatch(/call_assistant|callAssistant|minutes/i);
  });

  it("the Agency quote at every band boundary, monthly and yearly, is what it was", () => {
    for (const [locations, want] of Object.entries(AGENCY_QUOTES_BASELINE)) {
      expect(agencyPriceCents(Number(locations), "month"), `${locations} locations monthly: ${MESSAGE}`).toBe(want.month);
      expect(agencyPriceCents(Number(locations), "year"), `${locations} locations yearly: ${MESSAGE}`).toBe(want.year);
    }
  });
});
