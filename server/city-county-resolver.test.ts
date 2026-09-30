import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildCountyIndex, looseCountyKey, resolveCountyId, seededCityNote, seededCountyNote } from "./city-county-resolver";

const index = buildCountyIndex([
  { id: 25, name: "Los Angeles", stateCode: "CA" },
  { id: 38, name: "Fairfield", stateCode: "CT" },
  { id: 28, name: "Sacramento", stateCode: "CA" },
  { id: 40, name: "Maricopa", stateCode: "AZ" },
  { id: 1516, name: "St. Louis", stateCode: "MN" },
  { id: 119, name: "St. Louis", stateCode: "MO" },
  { id: 1627, name: "Ste. Genevieve", stateCode: "MO" },
  { id: 264, name: "Yukon-Koyukuk", stateCode: "AK" },
  { id: 919, name: "LaSalle", stateCode: "IL" },
  { id: 891, name: "De Witt", stateCode: "IL" },
  { id: 2620, name: "DeWitt", stateCode: "TX" },
  { id: 2884, name: "Hampton", stateCode: "VA" },
  { id: 2891, name: "James", stateCode: "VA" },
  { id: 100, name: "Prince Georges", stateCode: "MD" },
  { id: 1351, name: "Prince George's", stateCode: "MD" },
  { id: 500, name: "Jefferson", stateCode: "AL" },
  { id: 501, name: "Jefferson", stateCode: "AL" },
]);

describe("city → county resolution", () => {
  it("uses the JSON's county name + state, never its stale Replit id", () => {
    // all-cities.json gives Glendale, CA countyId 38 (Fairfield, CT here) — the name wins.
    expect(resolveCountyId(index, "Los Angeles", "CA")).toBe(25);
    expect(resolveCountyId(index, "Maricopa", "AZ")).toBe(40);
  });

  it("keeps the state in the key (St. Louis MN ≠ St. Louis MO)", () => {
    expect(resolveCountyId(index, "Saint Louis", "MN")).toBe(1516);
    expect(resolveCountyId(index, "Saint Louis", "MO")).toBe(119);
    expect(resolveCountyId(index, "Los Angeles", "AZ")).toBeNull();
  });

  it("matches common spelling variants", () => {
    expect(looseCountyKey("Saint Louis")).toBe(looseCountyKey("St. Louis"));
    expect(resolveCountyId(index, "Sainte Genevieve", "MO")).toBe(1627);
    expect(resolveCountyId(index, "Yukon Koyukuk", "AK")).toBe(264);
    expect(resolveCountyId(index, "La Salle", "IL")).toBe(919);
    expect(resolveCountyId(index, "Dewitt", "IL")).toBe(891);
    expect(resolveCountyId(index, "De Witt", "TX")).toBe(2620);
  });

  it("maps a Virginia independent city stored under its bare name", () => {
    expect(resolveCountyId(index, "Hampton City", "VA")).toBe(2884);
    expect(resolveCountyId(index, "James City", "VA")).toBe(2891);
  });

  it("prefers an exact name and never guesses between two candidates", () => {
    expect(resolveCountyId(index, "Prince Georges", "MD")).toBe(100);
    expect(resolveCountyId(index, "Jefferson", "AL")).toBeNull();
    expect(resolveCountyId(index, "Nowhere", "WA")).toBeNull();
  });

  it("recognises the old seeders' templated notes exactly", () => {
    expect(seededCityNote({ city: "Glendale", county: "Los Angeles", state: "California" }))
      .toBe("Contact Glendale Building Department for permit information. Located in Los Angeles County, California.");
    expect(seededCountyNote("Abbeville")).toBe("Contact Abbeville County Building Department for permit information.");
  });

  it("every county named in all-cities.json is spelled so it can be matched by name", () => {
    const cities: { county: string; stateCode: string }[] = JSON.parse(readFileSync(join(import.meta.dirname, "data", "all-cities.json"), "utf8"));
    const keys = new Set(cities.map((c) => `${looseCountyKey(c.county)}|${c.stateCode}`));
    expect(keys.size).toBeGreaterThan(3000);
    for (const key of Array.from(keys)) expect(key).toMatch(/^[a-z0-9]+\|[A-Z]{2}$/);
  });
});
