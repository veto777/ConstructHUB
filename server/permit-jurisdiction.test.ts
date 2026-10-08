/**
 * A job's city must never be sent to the permit office of a county that merely shares its name.
 * Bug: a CRM project in Austin, TX (Travis County) listed the office of Austin County, TX (seat: Bellville).
 */
import { describe, expect, it } from "vitest";
import {
  legacySubstringMatch, placeKeys, resolvePermitOffices, rowsForPlace, splitJurisdiction, type DirectoryRow,
} from "./permit-jurisdiction";
import { enumerateCollisions, seedDirectoryRows, summariseExposure } from "./permit-collision-audit";

let nextId = 1;
const row = (jurisdiction: string, type: "city" | "county", county: [number, string] | null, o: Partial<DirectoryRow> = {}): DirectoryRow => {
  const url = o.portalUrl === undefined ? `https://example.test/${encodeURIComponent(jurisdiction)}` : o.portalUrl;
  return {
    id: nextId++, name: jurisdiction, jurisdiction, jurisdictionType: type,
    countyId: county?.[0] ?? null, countyName: county?.[1] ?? null, countyStateCode: county ? jurisdiction.slice(-2) : null,
    portalUrl: url, searchUrl: url, isActive: !!url, linkStatus: url ? "verified" : "none", issuedBy: null, issuedBySource: null, ...o,
  };
};
const TRAVIS: [number, string] = [1, "Travis"], AUSTIN_CO: [number, string] = [2, "Austin"], HAYS: [number, string] = [3, "Hays"];
const HARRIS: [number, string] = [4, "Harris"], BASTROP: [number, string] = [6, "Bastrop"];
const TX: DirectoryRow[] = [
  row("Austin County, TX", "county", AUSTIN_CO),
  row("Travis County, TX", "county", TRAVIS),
  row("Hays County, TX", "county", HAYS),
  row("Bastrop County, TX", "county", BASTROP),
  row("Harris County, TX", "county", HARRIS),
  row("Austin, TX", "city", TRAVIS), row("Austin, TX", "city", HAYS),
  row("Houston, TX", "city", HARRIS), row("South Houston, TX", "city", HARRIS),
  row("Bellville, TX", "city", AUSTIN_CO, { portalUrl: null }),                       // really in Austin County, no city office
  row("Bastrop, TX", "city", BASTROP, { portalUrl: null }),                            // same name AND in that county
  row("Hays, TX", "city", TRAVIS, { portalUrl: null }),                                // same name as a county it is NOT in
  row("Manor, TX", "city", TRAVIS, { portalUrl: null, issuedBy: "Travis County, TX", issuedBySource: "https://example.test/src" }),
  row("Harris, TX", "city", TRAVIS, { portalUrl: null, issuedBy: "Harris County, TX", issuedBySource: "https://example.test/src2" }),
  row("Twoplace, TX", "city", TRAVIS, { portalUrl: null }), row("Twoplace, TX", "city", HAYS, { portalUrl: null }),
  row("Nowhere, TX", "city", [9, "Loving"], { portalUrl: null }),
  row("Wrongstate, TX", "city", [77, "Fairfield"], { portalUrl: null, countyStateCode: "CT" }),
  row("Fairfield County, TX", "county", [77, "Fairfield"], { countyStateCode: "CT" }),
  row("Saint Hedwig, TX", "city", TRAVIS),
  row("Austin, AR", "city", [50, "Lonoke"]),
];
const names = (city: string, st = "TX") => resolvePermitOffices(city, st, TX).offices.map((o) => o.jurisdiction);

describe("resolvePermitOffices", () => {
  it("reproduces the bug in the old matcher: Austin, TX was shown Austin County, TX", () => {
    expect(legacySubstringMatch("Austin", "TX", TX).map((r) => r.jurisdiction)).toContain("Austin County, TX");
    expect(legacySubstringMatch("Houston", "TX", TX).map((r) => r.jurisdiction)).toContain("South Houston, TX");
  });

  it.each([
    // typed city,   basis,            offices
    ["Austin", "own", ["Austin, TX"]],                         // one office, though the city has a row per county
    ["austin ", "own", ["Austin, TX"]],
    ["City of Austin", "own", ["Austin, TX"]],
    ["Austin, TX", "own", ["Austin, TX"]],
    ["Houston", "own", ["Houston, TX"]],                       // not South Houston
    ["St. Hedwig", "own", ["Saint Hedwig, TX"]],
    ["Manor", "routed", ["Travis County, TX"]],                // verified routing
    ["Harris", "routed", ["Harris County, TX"]],               // routing says the same-named county: allowed, and only then
    ["Bellville", "county", ["Austin County, TX"]],            // the county it is actually in
    ["Bastrop", "county", ["Bastrop County, TX"]],             // same name, and really in it
    ["Hays", "county", ["Travis County, TX"]],                 // same name as Hays County, but on record in Travis
    ["Twoplace", "counties", ["Hays County, TX", "Travis County, TX"]],
    ["Nowhere", "none", []],                                   // its county has no office on record
    ["Wrongstate", "none", []],                                // a county in another state is not a fact about this city
    ["Aust", "unknown-place", []],                             // no prefix / substring matching
    ["Austin County", "own", ["Austin County, TX"]],           // the county asked for by its full name
    ["Travis", "unknown-place", []],                           // a bare county name is not a city
    ["", "no-city", []],
  ] as const)("%s → %s %j", (city, basis, offices) => {
    const r = resolvePermitOffices(city, "TX", TX);
    expect(r.basis).toBe(basis);
    expect(r.offices.map((o) => o.jurisdiction).sort()).toEqual([...offices].sort());
    expect(r.note.length).toBeGreaterThan(10);
  });

  it("never crosses a state line", () => {
    expect(names("Austin", "AR")).toEqual(["Austin, AR"]);
    expect(resolvePermitOffices("Houston", "AR", TX).basis).toBe("unknown-place");
  });

  it("says where the fact came from", () => {
    const routed = resolvePermitOffices("Manor", "TX", TX);
    expect(routed.issuedBy).toBe("Travis County, TX");
    expect(routed.issuedBySource).toBe("https://example.test/src");
    expect(resolvePermitOffices("Hays", "TX", TX).note).toMatch(/Travis County/);
    expect(resolvePermitOffices("Hays", "TX", TX).note).toMatch(/confirm/);
    // The route names a county the city list does not place it in: shown, with the disagreement stated.
    expect(resolvePermitOffices("Harris", "TX", TX).note).toMatch(/Our city records place Harris in Travis County/);
    expect(resolvePermitOffices("Austin", "TX", TX).counties.map((c) => c.name)).toEqual(["Hays", "Travis"]);
  });

  it("does not offer an office whose link is dead, inactive or missing", () => {
    const dead = TX.map((r) => r.jurisdiction === "Austin, TX" ? { ...r, linkStatus: "dead", isActive: false } : r);
    const r = resolvePermitOffices("Austin", "TX", dead);
    expect(r.basis).toBe("counties");
    expect(r.offices.map((o) => o.jurisdiction)).not.toContain("Austin County, TX");
  });

  it("matches whole names only", () => {
    expect(placeKeys("Austin")).toEqual(["austin"]);
    expect(rowsForPlace("Orange", "TX", [row("West Orange, TX", "city", TRAVIS), row("Orange County, TX", "county", [8, "Orange"]), row("Orangefield, TX", "city", TRAVIS)])).toEqual([]);
    expect(splitJurisdiction("Coeur d'Alene, ID")).toEqual({ base: "Coeur d'Alene", stateCode: "ID" });
    expect(splitJurisdiction("San Juan County")).toBeNull();
  });
});

/** The whole class, over the data the app ships. */
describe("city / county name collisions in the shipped directory data", () => {
  const rows = seedDirectoryRows();
  const cases = enumerateCollisions(rows);
  const find = (city: string, st: string) => cases.find((c) => c.city === city && c.stateCode === st);

  it("finds the class, and the old matcher was wrong for a few hundred of them", () => {
    expect(cases.length).toBeGreaterThan(500);
    expect(cases.filter((c) => !c.inSameNameCounty).length).toBeGreaterThan(200);
    expect(cases.filter((c) => c.wrongBefore).length).toBeGreaterThan(200);
  });

  it("REGRESSION: 'X County, ST' is never returned for the city 'X, ST' unless the city is on record in it or routing names it", () => {
    for (const c of cases) {
      const returned = c.now.offices.includes(c.sameNameCounty);
      const allowed = c.inSameNameCounty || c.routedTo === c.sameNameCounty;
      expect(returned && !allowed, `${c.city}, ${c.stateCode} → ${c.now.offices.join("; ")}`).toBe(false);
    }
    expect(cases.filter((c) => c.wrongNow)).toEqual([]);
  });

  it.each([
    // city, ST, in the same-named county?, old matcher wrong?, basis now, offices now
    ["Austin", "TX", false, true, "own", ["Austin, TX"]],              // Travis/Hays/Williamson — not Austin County
    ["Lincoln", "NE", false, true, "own", ["Lincoln, NE"]],            // Lancaster — not Lincoln County
    ["Jackson", "MS", false, true, "own", ["Jackson, MS"]],            // Hinds/Rankin — not Jackson County
    ["Franklin", "TN", false, true, "own", ["Franklin, TN"]],          // Williamson — not Franklin County
    ["Franklin", "OH", false, true, "own", ["Franklin, OH"]],          // Warren — not Franklin County
    ["Dallas", "TX", true, false, "own", ["Dallas, TX"]],              // in Dallas County; the city has its own office
    ["Lexington", "SC", true, false, "own", ["Lexington, SC"]],
    ["Orange", "TX", true, false, "own", ["Orange, TX"]],              // and no longer "West Orange"
    ["Delaware", "OH", true, false, "own", ["Delaware, OH"]],
    ["Appling", "GA", false, true, "routed", ["Columbia County, GA"]], // was Appling County
    ["Monroe", "IN", false, true, "routed", ["Adams County, IN"]],     // was Monroe County
    ["Madison", "TN", false, true, "routed", ["Davidson County, TN"]], // was Madison County + Madisonville
    ["Evangeline", "LA", false, true, "routed", ["Acadia Parish, LA"]],
    ["Franklin", "GA", false, true, "county", ["Heard County, GA"]],   // was Franklin County
    ["Cottonwood", "MN", false, true, "county", ["Lyon County, MN"]],  // was Cottonwood County
    ["Cherokee", "AL", false, true, "none", []],                       // was Cherokee County; Colbert has no office on record
    ["Kane", "IL", false, true, "none", []],                           // was Kane County
  ] as const)("%s, %s", (city, st, inSame, wrongBefore, basis, offices) => {
    const c = find(city, st);
    expect(c, `${city}, ${st} is not a collision in the data`).toBeTruthy();
    expect(c!.inSameNameCounty).toBe(inSame);
    expect(c!.wrongBefore).toBe(wrongBefore);
    expect(c!.now.basis).toBe(basis);
    expect(c!.now.offices).toEqual(offices);
    if (!inSame && c!.routedTo !== c!.sameNameCounty) expect(c!.now.offices).not.toContain(c!.sameNameCounty);
  });

  it("no city anywhere is resolved to another place's office (substring class: 'South Houston' for 'Houston')", () => {
    const s = summariseExposure(rows);
    expect(s.legacyReturnedAnotherPlace).toBeGreaterThan(500); // the old matcher did, for this many cities
    expect(s.nowReturnedAnotherPlace).toBe(0);
    expect(resolvePermitOffices("Houston", "TX", rows).offices.map((o) => o.jurisdiction)).toEqual(["Houston, TX"]);
  }, 60000);
});
