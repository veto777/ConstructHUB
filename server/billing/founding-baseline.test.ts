/**
 * The founding member promise (owner, 2026-10-08): a founding member keeps the
 * plan prices of the day they subscribed, for life. Checkout does NOT read the
 * stored snapshot yet (shared/pricing-terms.ts foundingPrice has no billing
 * caller) — by design, because the price book has not changed since the offer
 * began, so the snapshot and the live price are the same number. This test
 * pins that fact, for every input a quote is computed from: the plan prices,
 * the Agency bands, the locations Agency includes and the annual multiplier
 * (server/billing/prices.ts agencyLocationTiers), and the Agency quotes at
 * every band boundary on both intervals. The day it fails is the day that is
 * no longer true.
 */
import { describe, expect, it } from "vitest";
import { AGENCY_LOCATION_BANDS, ANNUAL_MONTHS, PLANS, PLAN_KEYS, agencyPriceCents } from "@shared/plans";
import { priceSnapshot } from "@shared/pricing-terms";

/** The price book as it was when the founding offer opened (2026-10-08). Do not "fix" this constant to make the test pass. */
const FOUNDING_BASELINE = {
  plans: {
    starter: { monthlyCents: 2900, annualCents: 29000 },
    pro: { monthlyCents: 7900, annualCents: 79000 },
    growth: { monthlyCents: 19900, annualCents: 199000 },
    agency: { monthlyCents: 34900, annualCents: 349000 },
  },
  agencyBands: [
    { upTo: 10, centsPerLocation: 0 },
    { upTo: 50, centsPerLocation: 1500 },
    { upTo: 250, centsPerLocation: 1000 },
    { upTo: 500, centsPerLocation: 700 },
  ],
  agencyIncludedLocations: 10,
  annualMonths: 10,
} as const;

/** Agency quotes at the band boundaries, monthly and yearly, as they were on 2026-10-08. */
const AGENCY_QUOTES_BASELINE: Record<number, { month: number; year: number }> = {
  10: { month: 34900, year: 349000 },
  11: { month: 36400, year: 364000 },
  50: { month: 94900, year: 949000 },
  51: { month: 95900, year: 959000 },
  250: { month: 294900, year: 2949000 },
  251: { month: 295600, year: 2956000 },
  500: { month: 469900, year: 4699000 },
};

const MESSAGE = "a price changed: founding members must be billed from foundingPrice() first — wire shared/pricing-terms.ts into server/billing/order.ts before changing PLANS";

describe("founding member price baseline", () => {
  it("the live price book still equals the baseline the founding offer opened with", () => {
    const live = {
      plans: Object.fromEntries(PLAN_KEYS.map((k) => [k, { monthlyCents: PLANS[k].monthlyCents, annualCents: PLANS[k].annualCents }])),
      agencyBands: AGENCY_LOCATION_BANDS.map((b) => ({ upTo: b.upTo, centsPerLocation: b.centsPerLocation })),
      agencyIncludedLocations: PLANS.agency.limits.locations,
      annualMonths: ANNUAL_MONTHS,
    };
    expect(live, MESSAGE).toEqual(FOUNDING_BASELINE);
    // …and so a snapshot taken today is the same as one taken the day the offer opened.
    const { capturedAt: _at, ...snapshot } = priceSnapshot();
    expect(snapshot, MESSAGE).toEqual(FOUNDING_BASELINE);
  });

  it("the Agency quote at every band boundary, monthly and yearly, is what it was", () => {
    for (const [locations, want] of Object.entries(AGENCY_QUOTES_BASELINE)) {
      expect(agencyPriceCents(Number(locations), "month"), `${locations} locations monthly: ${MESSAGE}`).toBe(want.month);
      expect(agencyPriceCents(Number(locations), "year"), `${locations} locations yearly: ${MESSAGE}`).toBe(want.year);
    }
  });
});
