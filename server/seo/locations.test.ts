/**
 * Where a rank check is run from when no finer place is picked: the site's own country. Site creation accepts every
 * country the explorers support (shared/seo-markets.ts), so each of them must be a place here too — not only the
 * United States (audit #55). Pure: the country list needs no database.
 */
import { describe, expect, it } from "vitest";
import { countryLocation } from "./locations";
import { SEO_MARKETS, countryLabel, isCountryLabel } from "@shared/seo-markets";

describe("a site's own country as a place", () => {
  it("every country the product accepts for a site is a place, under its plain name", () => {
    for (const m of SEO_MARKETS) expect(countryLocation(m.locationCode)).toEqual({ code: m.locationCode, label: countryLabel(m.locationCode), kind: "Country" });
    expect(countryLocation(2840)).toEqual({ code: 2840, label: "United States", kind: "Country" });
    expect(countryLocation(2124)).toEqual({ code: 2124, label: "Canada", kind: "Country" });
    expect(countryLocation(2826)).toEqual({ code: 2826, label: "United Kingdom", kind: "Country" });
  });
  it("anything else is not a country (a city code is looked up in the list of places; an unknown code is refused)", () => {
    expect(countryLocation(1015214)).toBeNull();
    expect(countryLocation(424242)).toBeNull();
    expect(countryLocation(0)).toBeNull();
  });
  it("the plain name is the country's, never a language variant, and never a guess", () => {
    expect(countryLabel(2124)).toBe("Canada");
    expect(countryLabel(2840)).toBe("United States");
    expect(countryLabel("2840")).toBeNull();
    expect(countryLabel(999)).toBeNull();
    expect([isCountryLabel("Canada"), isCountryLabel("United States (Spanish)"), isCountryLabel("Tampa, Florida"), isCountryLabel(null)]).toEqual([true, true, false, false]);
  });
});
