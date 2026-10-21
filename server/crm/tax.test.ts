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

// ── Job-site address → official table + state construction treatment ─────────

const official = (over: Record<string, unknown> = {}) => ({
  loaded: true,
  match: {
    state: "WA", city: "Bellingham", county: "Whatcom", locationCode: "3701", kind: "city",
    ratePct: 9.2, rateBps: 920, effectiveDate: "2026-10-01", source: "WA DOR",
    sourceUrl: "https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lsu-quarterly-tax-rates.csv",
    periodLabel: "Q4 2026", varies: false, ...over,
  },
});

describe("resolveTaxRateBps — official city rates and construction treatment", () => {
  it("a WA job site gets the WA DOR city rate, labelled with source and quarter", () => {
    const r = resolveTaxRateBps({ city: "Bellingham", state: "WA", official: official(), orgDefaultTaxRateBps: 500 });
    expect(r).toMatchObject({ bps: 920, source: "official", city: "Bellingham", state: "WA" });
    expect(r.label).toBe("Bellingham, WA · 9.2% (WA DOR, Q4 2026)");
    expect(r.treatment?.treatment).toBe("taxable");
  });

  it("the org's own per-city override still beats the official table", () => {
    const r = resolveTaxRateBps({
      city: "Bellingham", state: "WA", official: official(),
      divisionCustomFields: divWith({ default: 700, cities: { Bellingham: 950 } }),
    });
    expect(r).toMatchObject({ bps: 950, source: "city", matchedCity: "Bellingham" });
    expect(r.label).toContain("your rate for Bellingham");
  });

  it("the official table beats the division and org defaults", () => {
    const r = resolveTaxRateBps({
      city: "Ferndale", state: "WA",
      official: official({ city: "Ferndale", locationCode: "3704", ratePct: 9.1, rateBps: 910 }),
      divisionCustomFields: divWith({ default: 700 }), orgDefaultTaxRateBps: 500,
    });
    expect(r).toMatchObject({ bps: 910, source: "official" });
    expect(r.label).toBe("Ferndale, WA · 9.1% (WA DOR, Q4 2026)");
  });

  it("Florida: 0, and the line says contractors don't charge it (FL DOR)", () => {
    const r = resolveTaxRateBps({ city: "Tampa", state: "FL", official: { loaded: false, match: null }, orgDefaultTaxRateBps: 700 });
    expect(r).toMatchObject({ bps: 0, source: "construction-exempt", state: "FL" });
    expect(r.label).toMatch(/^Florida: contractors don't charge sales tax on real-property jobs \(they pay it on materials\) — FL DOR GT-800067/);
  });

  it("a 'depends' state gets the city rate plus the condition to check", () => {
    const r = resolveTaxRateBps({
      city: "Austin", state: "TX",
      official: official({ state: "TX", city: "Austin", county: "Travis", ratePct: 8.25, rateBps: 825, source: "TX Comptroller", periodLabel: "Q4 2026" }),
    });
    expect(r).toMatchObject({ bps: 825, source: "official" });
    expect(r.label).toMatch(/^Austin, TX · 8\.25% \(TX Comptroller, Q4 2026\) — TX: .+ — check$/);
  });

  it("a taxable state whose table isn't loaded yet → default, and the line says so", () => {
    const r = resolveTaxRateBps({ city: "Honolulu", state: "HI", official: { loaded: false, match: null }, orgDefaultTaxRateBps: 450 });
    expect(r).toMatchObject({ bps: 450, source: "org", fallbackReason: "not_loaded" });
    expect(r.label).toBe("City rate not loaded yet for HI — using your default (4.5%)");
  });

  it("a city the table doesn't have → default, naming the city", () => {
    const r = resolveTaxRateBps({ city: "Atlantis", state: "WA", official: { loaded: true, match: null }, divisionCustomFields: divWith({ default: 870 }) });
    expect(r).toMatchObject({ bps: 870, source: "division", fallbackReason: "no_match" });
    expect(r.label).toBe("No rate found for Atlantis, WA — using your default (8.7%)");
  });

  it("no city on the address, and no default either → 0, and the line never hides it", () => {
    const r = resolveTaxRateBps({ city: "  ", state: "WA", official: null });
    expect(r).toMatchObject({ bps: 0, source: "none", fallbackReason: "no_city" });
    expect(r.label).toBe("No city on the address — no default rate set — enter the rate");
  });

  it("a rate that varies inside the city is flagged", () => {
    const r = resolveTaxRateBps({ city: "Bellingham", state: "WA", official: official({ varies: true }) });
    expect(r.label).toContain("rate varies within Bellingham");
  });

  it("taxSourceRecord keeps the city, state, treatment and official source for custom_fields.taxSource", async () => {
    const { taxSourceRecord } = await import("./tax");
    const rec = taxSourceRecord(resolveTaxRateBps({ city: "Bellingham", state: "WA", official: official() }));
    expect(rec).toMatchObject({
      source: "official", bps: 920, city: "Bellingham", state: "WA",
      treatment: { treatment: "taxable", agency: "WA DOR" },
      official: { source: "WA DOR", periodLabel: "Q4 2026", effectiveDate: "2026-10-01", locationCode: "3701" },
      label: "Bellingham, WA · 9.2% (WA DOR, Q4 2026)",
    });
  });
});
