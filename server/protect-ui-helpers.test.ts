/**
 * Pure helpers behind the protect-lane UI fixes (IP Tracker / VPN Shield / Competitor Intel),
 * imported from the client tree exactly like server/seo/tool-*.test.ts does.
 */
import { describe, it, expect } from "vitest";
import { countryName, geoLabel } from "../client/src/components/ip-tracker/country-names";
import { topRatedPicks, TOP_RATED_SIGNAL_CUTOFF } from "../client/src/components/competitors/top-rated";

describe("country names instead of codes", () => {
  it("maps ISO codes to names", () => {
    expect(countryName("US")).toBe("United States");
    expect(countryName("gb")).toBe("United Kingdom");
    expect(countryName("DE")).toBe("Germany");
  });
  it("passes through values that are not known codes", () => {
    expect(countryName("Unknown")).toBe("Unknown");
    expect(countryName("United States")).toBe("United States");
    expect(countryName(null)).toBe(null);
  });
  it("converts codes inside a city, country geo label", () => {
    expect(geoLabel("Bellingham, US")).toBe("Bellingham, United States");
    expect(geoLabel("US")).toBe("United States");
    expect(geoLabel("Unknown")).toBe("Unknown");
  });
});

describe("top-rated picks exclude keyword-stuffed listings", () => {
  const listings = [
    { businessName: "Honest Roofers", rating: "4.7", reviewCount: 80, bsScore: 10 },
    { businessName: "Best Top Cheap #1 Roofing Near Me", rating: "5.0", reviewCount: 400, bsScore: 85 },
    { businessName: "Solid Exteriors", rating: "4.9", reviewCount: 30, bsScore: 20 },
    { businessName: "No rating listing", rating: null, reviewCount: 0, bsScore: 0 },
  ];
  it("never names a listing at or above the More-signals band as a top pick", () => {
    const picks = topRatedPicks(listings);
    expect(picks.map(l => l.businessName)).not.toContain("Best Top Cheap #1 Roofing Near Me");
    for (const pick of picks) expect(pick.bsScore ?? 0).toBeLessThan(TOP_RATED_SIGNAL_CUTOFF);
  });
  it("orders by rating, then cleaner signal score, then review count", () => {
    const picks = topRatedPicks(listings);
    expect(picks.map(l => l.businessName)).toEqual(["Solid Exteriors", "Honest Roofers"]);
    const tied = topRatedPicks([
      { rating: "4.8", reviewCount: 10, bsScore: 40 },
      { rating: "4.8", reviewCount: 10, bsScore: 5 },
      { rating: "4.8", reviewCount: 99, bsScore: 5 },
    ]);
    expect(tied.map(l => l.reviewCount)).toEqual([99, 10, 10]);
    expect(tied[2].bsScore).toBe(40);
  });
  it("returns nothing when every rated listing sits in the More-signals band", () => {
    expect(topRatedPicks([{ rating: "5.0", reviewCount: 500, bsScore: 90 }])).toEqual([]);
  });
});
