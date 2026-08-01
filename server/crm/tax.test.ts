/**
 * Sales tax by address city — the pure resolution order. No server needed.
 * tax.ts pulls in tenancy → ../stripe, which throws without a key at module
 * scope; a dummy value is enough for import (no queries are run here).
 */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

import { describe, it, expect, beforeAll } from "vitest";

let resolveTaxRateBps: any;
let divisionTaxRates: any;

beforeAll(async () => {
  ({ resolveTaxRateBps, divisionTaxRates } = await import("./tax"));
});

const divWith = (taxRates: unknown) => ({ taxRates });

describe("resolveTaxRateBps", () => {
  it("city override wins over division and org defaults", () => {
    const r = resolveTaxRateBps({
      city: "Seattle",
      divisionCustomFields: divWith({ default: 700, cities: { Seattle: 1010 } }),
      orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 1010, source: "city", matchedCity: "Seattle" });
  });

  it("city match is case-insensitive (both sides)", () => {
    const r = resolveTaxRateBps({
      city: "tacoma",
      divisionCustomFields: divWith({ cities: { "Tacoma": 940 } }),
      orgDefaultTaxRateBps: null,
    });
    expect(r).toMatchObject({ bps: 940, source: "city" });
  });

  it("unknown city falls back to the division default", () => {
    const r = resolveTaxRateBps({
      city: "Spokane",
      divisionCustomFields: divWith({ default: 700, cities: { Seattle: 1010 } }),
      orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 700, source: "division" });
  });

  it("no division map at all falls back to the org default", () => {
    const r = resolveTaxRateBps({
      city: "Seattle", divisionCustomFields: null, orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 500, source: "org" });
  });

  it("division cities map without a default: unknown city drops to the org default", () => {
    const r = resolveTaxRateBps({
      city: "Nowhere",
      divisionCustomFields: divWith({ cities: { Seattle: 1010 } }),
      orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 500, source: "org" });
  });

  it("nothing configured → 0 with source none", () => {
    const r = resolveTaxRateBps({ city: "Seattle", divisionCustomFields: null, orgDefaultTaxRateBps: null });
    expect(r).toMatchObject({ bps: 0, source: "none" });
  });

  it("no city on the address skips the city tier entirely", () => {
    const r = resolveTaxRateBps({
      city: null,
      divisionCustomFields: divWith({ default: 700, cities: { Seattle: 1010 } }),
      orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 700, source: "division" });
  });

  it("configured rates are clamped to what the estimate schema accepts (30%)", () => {
    const r = resolveTaxRateBps({
      city: "Seattle",
      divisionCustomFields: divWith({ cities: { Seattle: 9900 } }),
      orgDefaultTaxRateBps: null,
    });
    expect(r.bps).toBe(3000);
  });

  it("junk customFields never throw and never match", () => {
    expect(divisionTaxRates("garbage")).toBeNull();
    expect(divisionTaxRates({ taxRates: "garbage" })).toBeNull();
    const r = resolveTaxRateBps({
      city: "Seattle",
      divisionCustomFields: { taxRates: { default: "high", cities: { Seattle: "lots" } } },
      orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 500, source: "org" });
  });
});
