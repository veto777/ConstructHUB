import { describe, expect, it } from "vitest";
import { buildScan, fetchGrid, gridDeps, gridEstimateUsd, gridPoints, isTarget, matchKind, parseMapListings, pinInput, pointRequest, rivalsOf, scanInput, summarise, GRID_POINT_USD, type MapListing } from "./grid";
import { DataForSeoError } from "./dataforseo";

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
    // Near the date line and the poles every point is still a real coordinate.
    for (const c of [{ lat: 10, lng: 179.99 }, { lat: 10, lng: -179.99 }, { lat: 84.9, lng: 0 }, { lat: -84.9, lng: 100 }])
      for (const p of gridPoints(c, 7, 10)) { expect(Math.abs(p.lng)).toBeLessThanOrEqual(180); expect(Math.abs(p.lat)).toBeLessThanOrEqual(90); }
    expect(gridPoints({ lat: 10, lng: 179.99 }, 3, 10)[2].lng).toBeLessThan(-179);
  });
  it("only the offered sizes and distances are accepted", () => {
    expect(scanInput.parse({ keyword: " siding contractor " })).toEqual({ keyword: "siding contractor", size: 5, spacing: 2 });
    expect(scanInput.safeParse({ keyword: "x", spacing: 0.5 }).success).toBe(false);
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
  it("each point is a search made from that spot, not a map picture of it", () => {
    // A map view (coordinates plus a zoom) lists only what is inside the picture; the searcher's coordinates alone do not.
    expect(pointRequest("siding contractor", { lat: 48.7583, lng: -122.4626 })).toEqual({ keyword: "siding contractor", location_coordinate: "48.7583,-122.4626", language_code: "en", depth: 20 });
    const got = parseMapListings([{ type: "local_pack", title: "Paid", is_paid: true }, { type: "local_pack", title: "Alpine", cid: "12", domain: "alpine.example", rating: { value: 4.9, votes_count: 106 } }]);
    expect(got).toEqual([{ name: "Alpine", rank: 1, cid: "12", domain: "alpine.example", address: null, lat: null, lng: null, rating: 4.9, reviews: 106 }]);
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
    // How sure: the id is certain; a website or a name is a fallback and is reported as one.
    expect(matchKind(L("Anything", 1, { cid: "111" }), t)).toBe("id");
    expect(matchKind(L("Alpine", 1, { domain: "alpine.example" }), t)).toBe("website");
    expect(matchKind(L("Alpine Exteriors", 1), t)).toBe("name");
    // The listing's own website (it can differ from the tracked site) identifies it too.
    expect(matchKind(L("Alpine", 1, { domain: "alpine-listing.example" }), { ...t, pinDomain: "alpine-listing.example" })).toBe("website");
    expect(pinInput.parse({ name: "A", lat: 1, lng: 1, domain: "WWW.Alpine.example" }).domain).toBe("alpine.example");
    expect(pinInput.parse({ name: "A", lat: 1, lng: 1, domain: "<b>" }).domain).toBeNull();
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
    expect(scan.summary).toEqual({ points: 4, checked: 3, found: 2, top3: 1, avgRank: 8.7, unsure: 0 });
    expect(scan.points[0].by).toBe("id");
    expect(scan.center.cid).toBe(pin.cid);
    expect(summarise([])).toEqual({ points: 0, checked: 0, found: 0, top3: 0, avgRank: null, unsure: 0 });
    // Recognised without Google's id: counted, so the page can say so.
    const loose = buildScan({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" }, cells.slice(0, 1), [[L("Someone", 1, { cid: "5" }), L("Alpine", 2, { domain: "alpineexteriorswa.com" })]]);
    expect([loose.points[0].rank, loose.points[0].by, loose.summary.unsure]).toEqual([2, "website", 1]);
  });
  it("ranks who leads across the area, and always shows the business itself", () => {
    const t = { cid: "1", domain: "us.example", name: "Us" };
    const point = (names: string[]) => names.map((n, i) => L(n, i + 1, n === "Us" ? { cid: "1" } : { cid: String(100 + n.charCodeAt(0)) }));
    const rivals = rivalsOf([point(["B", "C", "D", "Us"]), point(["B", "D", "C"]), point(["C", "B", "E"])], t, 2);
    expect(rivals.map((r) => [r.name, r.top3, r.found, r.ours])).toEqual([["B", 3, 3, false], ["C", 3, 3, false], ["Us", 0, 1, true]]);
    expect(rivals[0].avgRank).toBe(1.3);
    // A business listed twice at one point counts once there (its better position).
    const twice = rivalsOf([[L("B", 1, { cid: "7" }), L("B", 2, { cid: "7" }), L("C", 3, { cid: "8" })]], t);
    expect(twice.map((r) => [r.name, r.found, r.avgRank])).toEqual([["B", 1, 1], ["C", 1, 3]]);
  });
  it("the customer pays for the points that returned; failed and repeated tries are ours", async () => {
    const real = gridDeps.request;
    const ok = (title: string) => ({ status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.002, result: [{ items: [{ type: "local_pack", title, cid: "9877668871764835558" }] }] }] });
    let calls = 0;
    // 9 points: the first two time out once and then answer; the third times out twice.
    const tries = new Map<string, number>();
    gridDeps.request = (async (_m: string, _p: string, body: any) => {
      calls++;
      const where = body[0].location_coordinate as string; const n = (tries.get(where) ?? 0) + 1; tries.set(where, n);
      const index = [...tries.keys()].indexOf(where);
      if ((index < 2 && n === 1) || index === 2) throw new DataForSeoError("timeout", "timed out");
      return ok("Alpine Exteriors");
    }) as any;
    try {
      const out = await fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" });
      expect(calls).toBe(9 + 3); // two retried once, one retried once and still failed
      expect(out.data.summary).toMatchObject({ points: 9, checked: 8, found: 8 });
      expect(out.customerUsd).toBeCloseTo(8 * GRID_POINT_USD, 6);
      // Ours: the 8 that returned plus an allowance for the 4 tries whose cost we never learned.
      expect(out.costUsd).toBeCloseTo(12 * GRID_POINT_USD, 6);
      expect(out.costUnknown).toBe(true);
      expect(out.customerUsd).toBeLessThanOrEqual(gridEstimateUsd(9));
    } finally { gridDeps.request = real; }
  });
  it("the hold covers every point with room to spare", () => {
    expect(gridEstimateUsd(49)).toBeGreaterThan(49 * GRID_POINT_USD);
    expect(gridEstimateUsd(9)).toBeCloseTo(0.0225, 6);
  });
});
