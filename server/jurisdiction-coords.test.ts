import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards the generated coverage-map dataset (scripts/build-jurisdiction-coords.ts):
// every centroid is real, in the US, and keyed by the exact portal jurisdiction
// string the /api/permits/map endpoint looks up. No invented coordinates.
const data = JSON.parse(readFileSync(join(import.meta.dirname, "data", "jurisdiction-coords.json"), "utf8"));
const coords: Record<string, { lat: number; lng: number } | null> = data.coords;

describe("jurisdiction-coords.json", () => {
  it("declares its public-Census source and a match rate", () => {
    expect(String(data.source)).toMatch(/Census/i);
    expect(data.matchRate?.overall).toBeTruthy();
  });

  it("keys entries by the portal jurisdiction string (Name, ST)", () => {
    const keys = Object.keys(coords);
    expect(keys.length).toBeGreaterThan(1000);
    for (const k of keys.slice(0, 50)) expect(k).toMatch(/, [A-Z]{2}$/);
  });

  it("every coordinate is null or a real point inside the US bounding box", () => {
    for (const [name, pt] of Object.entries(coords)) {
      if (pt === null) continue;
      expect(Number.isFinite(pt.lat), `${name} lat`).toBe(true);
      expect(Number.isFinite(pt.lng), `${name} lng`).toBe(true);
      // Continental US + AK + HI + territories.
      expect(pt.lat, `${name} lat range`).toBeGreaterThan(13);
      expect(pt.lat, `${name} lat range`).toBeLessThan(72);
      expect(pt.lng, `${name} lng range`).toBeGreaterThan(-180);
      expect(pt.lng, `${name} lng range`).toBeLessThan(-64);
    }
  });

  it("places well-known jurisdictions near their true location", () => {
    const near = (name: string, lat: number, lng: number) => {
      const pt = coords[name];
      expect(pt, name).toBeTruthy();
      expect(Math.abs(pt!.lat - lat), `${name} lat`).toBeLessThan(0.5);
      expect(Math.abs(pt!.lng - lng), `${name} lng`).toBeLessThan(0.5);
    };
    near("Nashville, TN", 36.17, -86.78);
    near("Denver, CO", 39.76, -104.88);
  });
});
