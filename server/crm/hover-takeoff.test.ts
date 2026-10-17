/**
 * HOVER takeoff extraction + the owner's quote rules (shared/hover-takeoff.ts) — pure, no server.
 *
 * The fixture is a REAL HOVER full_json (version 2) with the address, job/model ids, image ids and the
 * external identifier replaced by obviously fake values; every measurement number is untouched.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  extractHoverTakeoff, roundUpTo, sidingQuoteSqft, roofQuote, normalizeTakeoffRules, takeoffColumns,
  takeoffQuantityForLine, takeoffSymbols, parseWidthHeight, DEFAULT_TAKEOFF_RULES,
} from "@shared/hover-takeoff";

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", "hover-full-json-v2.anon.json"), "utf8"),
);

describe("HOVER takeoff — real full_json v2 (anonymised)", () => {
  const t = extractHoverTakeoff(FIXTURE)!;

  it("siding: 2169 ft² (1682 facades + 350 openings + 137 trim) → quote 2200", () => {
    expect(t.siding.areaSqft).toBe(2169);
    expect(t.siding.facadesSqft).toBe(1682);
    expect(t.siding.openingsSqft).toBe(350);
    expect(t.siding.trimSqft).toBe(137);
    expect(t.siding.quantitySqft).toBe(2200);
    expect(t.siding.wasteTable?.openings_plus_10_percent).toBe(2224);
  });

  it("roof: 2303 ft² + 5% = 2418 ft² (24.18 squares), cross-checked against HOVER's own row", () => {
    expect(t.roof.areaSqft).toBe(2303);
    expect(t.roof.wastePct).toBe(5);
    expect(t.roof.quantitySqft).toBe(2418);
    expect(t.roof.squares).toBe(24.18);
    expect(t.roof.measuredSquares).toBe(23.03);
    expect(t.roof.wasteCrossCheck).toEqual({ hoverSqft: 2418, computedSqft: 2419, agrees: true });
    expect(t.roof.facets).toBe(7);
    expect(t.roof.predominantPitch).toBe("8/12");
    expect(t.roof.pitch).toEqual([
      { pitch: "8/12", areaSqft: 2198, percent: 95.45 },
      { pitch: "9/12", areaSqft: 105, percent: 4.55 },
    ]);
  });

  it("roof lengths, drip edge = rakes + eaves", () => {
    expect(t.roof.lengths).toEqual({
      ridges: 80.33, hips: 0, ridgesHips: 80.33, valleys: 37.92, rakes: 146.75, eaves: 121.67,
      flashing: 12.33, stepFlashing: 47, dripEdge: 268.42,
    });
  });

  it("footprint 1615 ft², perimeter 188' 8\" (188.67), 2 stories", () => {
    expect(t.footprint).toEqual({ areaSqft: 1615, perimeterFt: 188.67, stories: 2 });
  });

  it("9 windows totalling 126 ft² / 808 united inches, with W x H", () => {
    expect(t.counts.windows).toBe(9);
    expect(t.windows).toHaveLength(9);
    expect(t.totals.windowsAreaSqft).toBe(126);
    expect(t.totals.windowsUnitedInches).toBe(808);
    expect(t.windows[0]).toEqual({ id: "W-103", widthIn: 67, heightIn: 59, unitedInches: 126, areaSqft: 27 });
    expect(t.windowGroups.map((g) => g.name)).toEqual(["WG-1", "WG-2", "WG-3", "WG-4", "WG-5", "WG-6", "WG-7", "WG-8"]);
    expect(t.windowGroups[0].windows).toEqual(["W-102", "W-101"]);
  });

  it("4 doors, entire doors total 181 ft²", () => {
    expect(t.counts.doors).toBe(4);
    expect(t.totals.doorsAreaSqft).toBe(181);
    expect(t.doors[0]).toEqual({ id: "D-2", widthIn: 190, heightIn: 85, areaSqft: 112 });
    expect(t.doors.map((d) => d.id)).toEqual(["D-2", "SGD-1", "D-1", "D-3"]);
  });

  it("trim / corners / soffit reference", () => {
    expect(t.reference.corners).toEqual({ insideQty: 2, insideLf: 16.42, outsideQty: 8, outsideLf: 67.08 });
    expect(t.reference.trim.levelStarterLf).toBe(241.08);
    expect(t.reference.soffit.totalSqft).toBe(434.36);
    expect(t.reference.elevations).toEqual({ back: 399, left: 510, front: 265, right: 508 });
  });

  it("fills the crm_measurements columns with MEASURED values (waste only in the bps column)", () => {
    expect(takeoffColumns(t)).toEqual({
      squaresMilli: 23030, roofAreaSfMilli: 2303000, wallAreaSfMilli: 2169000,
      ridgeLfMilli: 80330, hipLfMilli: 0, valleyLfMilli: 37920, eaveLfMilli: 121670, rakeLfMilli: 146750,
      perimeterLfMilli: 268420, predominantPitch: "8/12", stories: 2, facetCount: 7, wasteSuggestionBps: 500,
    });
  });

  it("estimator automation: line quantities + formula symbols", () => {
    expect(takeoffQuantityForLine({ name: "Siding install", unit: "sf" }, t)?.quantity).toBe(2200);
    expect(takeoffQuantityForLine({ name: "Roof replacement", unit: "sq ft" }, t)?.quantity).toBe(2418);
    expect(takeoffQuantityForLine({ name: "Architectural shingles", unit: "sq" }, t)?.quantity).toBe(24.18);
    expect(takeoffQuantityForLine({ name: "Window install", unit: "ea" }, t)?.quantity).toBe(9);
    expect(takeoffQuantityForLine({ name: "Entry door", unit: "each" }, t)?.quantity).toBe(4);
    expect(takeoffQuantityForLine({ name: "Window wrap", unit: "UI" }, t)?.quantity).toBe(808);
    expect(takeoffQuantityForLine({ name: "Ridge cap", unit: "lf" }, t)?.quantity).toBe(80.33);
    expect(takeoffQuantityForLine({ name: "Drip edge", unit: "LF" }, t)?.quantity).toBe(268.42);
    expect(takeoffQuantityForLine({ name: "Dumpster", unit: "job" }, t)).toBeNull();
    expect(takeoffQuantityForLine({ name: "Misc trim", unit: "lf" }, t)).toBeNull();
    expect(takeoffSymbols(t)).toEqual({ SIDING_SF: 2200, ROOF_SF: 2418, ROOF_SQ: 24.18, WINDOWS: 9, DOORS: 4, UI: 808 });
  });
});

describe("quote rules", () => {
  it("siding rounds UP to the next hundred; an exact hundred stays; null stays null", () => {
    expect(sidingQuoteSqft(2169)).toBe(2200);
    expect(sidingQuoteSqft(2100)).toBe(2100);
    expect(sidingQuoteSqft(2101)).toBe(2200);
    expect(sidingQuoteSqft(2100.0000000001)).toBe(2100);
    expect(sidingQuoteSqft(null)).toBeNull();
    expect(sidingQuoteSqft(undefined)).toBeNull();
    expect(roundUpTo(2169, 1)).toBe(2169);
    expect(roundUpTo(2169, 50)).toBe(2200);
    expect(roundUpTo(2149, 50)).toBe(2150);
  });

  it("roof waste is at least 5%; without HOVER's row it is ceil(area × 1.05)", () => {
    expect(roofQuote(2303).quantitySqft).toBe(2419);
    expect(roofQuote(2303, DEFAULT_TAKEOFF_RULES, { plus_5_percent: 2418 }).quantitySqft).toBe(2418);
    // A HOVER row that disagrees with the math is ignored.
    expect(roofQuote(2303, DEFAULT_TAKEOFF_RULES, { plus_5_percent: 2000 }).quantitySqft).toBe(2419);
    expect(roofQuote(2000).quantitySqft).toBe(2100);
    expect(roofQuote(2000).squares).toBe(21);
    expect(roofQuote(2303, { roofWastePct: 10, sidingRoundUpTo: 100 }, { plus_10_percent: 2533 }).quantitySqft).toBe(2533);
    expect(roofQuote(null)).toEqual({ wastePct: 5, quantitySqft: null, squares: null, crossCheck: null });
    // An older document's own suggestion can raise the %, never lower it.
    expect(roofQuote(1000, DEFAULT_TAKEOFF_RULES, null, 12).wastePct).toBe(12);
    expect(roofQuote(1000, DEFAULT_TAKEOFF_RULES, null, 2).wastePct).toBe(5);
  });

  it("org rules are clamped: never below 5% roof waste; junk → defaults", () => {
    expect(normalizeTakeoffRules({ roofWastePct: 2, sidingRoundUpTo: 100 })).toEqual({ roofWastePct: 5, sidingRoundUpTo: 100 });
    expect(normalizeTakeoffRules({ roofWastePct: 10, sidingRoundUpTo: 50 })).toEqual({ roofWastePct: 10, sidingRoundUpTo: 50 });
    expect(normalizeTakeoffRules(null)).toEqual(DEFAULT_TAKEOFF_RULES);
    expect(normalizeTakeoffRules({ roofWastePct: "x", sidingRoundUpTo: -3 })).toEqual(DEFAULT_TAKEOFF_RULES);
    const t = extractHoverTakeoff(FIXTURE, { roofWastePct: 10, sidingRoundUpTo: 50 })!;
    expect(t.roof.quantitySqft).toBe(2533);
    expect(t.siding.quantitySqft).toBe(2200);
  });

  it("width × height parsing", () => {
    expect(parseWidthHeight('190" x 85"')).toEqual({ w: 190, h: 85 });
    expect(parseWidthHeight(`5' 7" x 6'`)).toEqual({ w: 67, h: 72 });
    expect(parseWidthHeight("junk")).toEqual({ w: null, h: null });
  });

  it("older flat shapes still read; an empty / trimmed document is null", () => {
    const t = extractHoverTakeoff({
      roof: { total_roof_area_sqft: 2874.5, predominant_pitch: "6/12", waste_percent: 12 },
      siding: { total_siding_area_sqft: 2210 }, openings: { windows: 14 }, property: { stories: 2 },
    })!;
    expect(t.roof.areaSqft).toBe(2874.5);
    expect(t.roof.wastePct).toBe(12);
    expect(t.siding.quantitySqft).toBe(2300);
    expect(t.counts.windows).toBe(14);
    expect(t.windows).toEqual([]);
    expect(t.roof.predominantPitch).toBe("6/12");
    expect(extractHoverTakeoff(null)).toBeNull();
    expect(extractHoverTakeoff({})).toBeNull();
    expect(extractHoverTakeoff({ trimmed: true, bytes: 999999 })).toBeNull();
  });
});
