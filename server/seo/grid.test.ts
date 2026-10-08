import { describe, expect, it } from "vitest";
import { buildScan, gridEstimateUsd, gridPoints, isTarget, parseMapListings, pinInput, rivalsOf, scanInput, summarise, GRID_POINT_USD, type MapListing } from "./grid";

const item = (title: string, extra: Record<string, unknown> = {}) => ({ type: "maps_search", title, ...extra });
const L = (name: string, rank: number, extra: Partial<MapListing> = {}): MapListing => ({ name, rank, cid: null, domain: null, address: null, lat: null, lng: null, rating: null, reviews: null, ...extra });
const pin = pinInput.parse({ name: "Alpine Exteriors", lat: 48.7583, lng: -122.4626, cid: "9877668871764835558" });

describe("local grid", () => {
  it("lays a square of points over the pin: north at the top, west on the left, the pin in the middle", () => {
    const p = gridPoints({ lat: 48.7583, lng: -122.4626 }, 3, 1);
    expect(p).toHaveLength(9);
    expect(p[4]).toMatchObject({ row: 1, col: 1, lat: 48.7583, lng: -122.4626 });
    expect(p[0].lat).toBeGreaterThan(p[4].lat); expect(p[0].lng).toBeLessThan(p[4].lng);
    expect(p[8].lat).toBeLessThan(p[4].lat); expect(p[8].lng).toBeGreaterThan(p[4].lng);
    // One mile is about 1/69 of a degree north-south, and more degrees east-west the further north you are.
    expect(p[1].lat - p[4].lat).toBeCloseTo(1 / 69, 4);
    expect(p[5].lng - p[4].lng).toBeGreaterThan(1 / 69);
    expect(gridPoints({ lat: 0, lng: 0 }, 7, 5)).toHaveLength(49);
  });
  it("only the offered sizes and distances are accepted", () => {
    expect(scanInput.parse({ keyword: " siding contractor " })).toEqual({ keyword: "siding contractor", size: 5, spacing: 1 });
    expect(scanInput.safeParse({ keyword: "x", size: 9 }).success).toBe(false);
    expect(scanInput.safeParse({ keyword: "x", size: 5, spacing: 50 }).success).toBe(false);
    expect(scanInput.safeParse({ keyword: "" }).success).toBe(false);
    expect(pinInput.safeParse({ name: "A", lat: 91, lng: 0 }).success).toBe(false);
    expect(pinInput.safeParse({ name: "A", lat: 1, lng: 1, cid: "1; DROP" }).success).toBe(false);
  });
  it("reads the businesses in order, numbering them itself and skipping what is not a business", () => {
    const got = parseMapListings([
      { type: "maps_paid_item", title: "An ad" }, item("Alpine Exteriors | Siding", { cid: "9877668871764835558", domain: "www.alpineexteriorswa.com", latitude: 48.75, longitude: -122.46, rating: { value: 4.9, votes_count: 106 }, address: "2119 Lincoln St" }),
      item(""), item("Universal Roofing LLC", { cid: "bad id", domain: "<script>" }),
    ]);
    expect(got).toEqual([
      { name: "Alpine Exteriors | Siding", rank: 1, cid: "9877668871764835558", domain: "alpineexteriorswa.com", address: "2119 Lincoln St", lat: 48.75, lng: -122.46, rating: 4.9, reviews: 106 },
      { name: "Universal Roofing LLC", rank: 2, cid: null, domain: null, address: null, lat: null, lng: null, rating: null, reviews: null },
    ]);
  });
  it("recognises the business by Google's id first, then its website, then its exact name", () => {
    const t = { cid: "111", domain: "alpine.example", name: "Alpine Exteriors" };
    expect(isTarget(L("Anything", 1, { cid: "111" }), t)).toBe(true);
    // Another listing with the same website but a different id is a different listing (a second branch).
    expect(isTarget(L("Alpine Exteriors", 1, { cid: "222", domain: "alpine.example" }), t)).toBe(false);
    expect(isTarget(L("Alpine", 1, { domain: "alpine.example" }), t)).toBe(true);
    expect(isTarget(L("Alpine", 1, { domain: "shop.alpine.example" }), t)).toBe(true);
    expect(isTarget(L("Alpine Exteriors, LLC", 1), t)).toBe(true);
    expect(isTarget(L("Alpine Exteriors", 1, { domain: "other.example" }), t)).toBe(false);
    expect(isTarget(L("Alpine Siding", 1), t)).toBe(false);
    expect(isTarget(L("Al", 1), { cid: null, domain: "a.example", name: "Al" })).toBe(false);
  });
  it("a failed point is unknown, not 'not found', and is left out of the average", () => {
    const cells = gridPoints(pin, 3, 1).slice(0, 4);
    const scan = buildScan({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" }, cells, [
      [L("Alpine Exteriors", 1, { cid: pin.cid }), L("B", 2), L("C", 3), L("D", 4)],
      [L("B", 1), L("C", 2), L("D", 3), L("Alpine Exteriors", 4, { cid: pin.cid })],
      [L("B", 1), L("C", 2)],
      null,
    ], "2026-10-08T00:00:00.000Z");
    expect(scan.points.map((p) => [p.rank, p.failed ?? false])).toEqual([[1, false], [4, false], [null, false], [null, true]]);
    expect(scan.points[1].top).toEqual([{ name: "B", rank: 1 }, { name: "C", rank: 2 }, { name: "D", rank: 3 }]);
    // (1 + 4 + 21) / 3 checked points
    expect(scan.summary).toEqual({ points: 4, checked: 3, found: 2, top3: 1, avgRank: 8.7 });
    expect(summarise([])).toEqual({ points: 0, checked: 0, found: 0, top3: 0, avgRank: null });
  });
  it("ranks who leads across the area, and always shows the business itself", () => {
    const t = { cid: "1", domain: "us.example", name: "Us" };
    const point = (names: string[]) => names.map((n, i) => L(n, i + 1, n === "Us" ? { cid: "1" } : { cid: String(100 + n.charCodeAt(0)) }));
    const rivals = rivalsOf([point(["B", "C", "D", "Us"]), point(["B", "D", "C"]), point(["C", "B", "E"])], t, 2);
    expect(rivals.map((r) => [r.name, r.top3, r.found, r.ours])).toEqual([["B", 3, 3, false], ["C", 3, 3, false], ["Us", 0, 1, true]]);
    expect(rivals[0].avgRank).toBe(1.3);
  });
  it("the hold covers every point with room to spare", () => {
    expect(gridEstimateUsd(49)).toBeGreaterThan(49 * GRID_POINT_USD);
    expect(gridEstimateUsd(9)).toBeCloseTo(0.0225, 6);
  });
});
