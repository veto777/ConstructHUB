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
    // The pinned id wins wherever it is in the list, even after an earlier website match (another branch of the same business).
    const branch = buildScan({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" }, cells.slice(0, 1), [[L("Alpine North", 1, { domain: "alpineexteriorswa.com" }), L("B", 2, { cid: "5" }), L("Alpine Exteriors", 3, { cid: pin.cid })]]);
    expect([branch.points[0].rank, branch.points[0].by, branch.summary.unsure]).toEqual([3, "id", 0]);
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
  it("a point the source billed above what we measured: the customer pays the price per point shown, the rest is ours", async () => {
    const real = gridDeps.request;
    try {
      gridDeps.request = (async () => ({ status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.005, result: [{ items: [] }] }] })) as any;
      const out = await fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" });
      expect(out.customerUsd).toBeCloseTo(9 * GRID_POINT_USD, 6);
      expect(out.costUsd).toBeCloseTo(9 * 0.005, 6);
    } finally { gridDeps.request = real; }
  });
  it("the customer pays for the points that returned; failed and repeated tries are ours, and stay inside what was reserved", async () => {
    const real = gridDeps.request;
    const ok = (title: string) => ({ status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.002, result: [{ items: [{ type: "local_pack", title, cid: "9877668871764835558" }] }] }] });
    let calls = 0;
    const tries = new Map<string, number>();
    try {
      // 9 points: two time out once and then answer. A quarter of 9 is 2 second tries: both are allowed.
      gridDeps.request = (async (_m: string, _p: string, body: any) => {
        calls++;
        const where = body[0].location_coordinate as string; const n = (tries.get(where) ?? 0) + 1; tries.set(where, n);
        if ([...tries.keys()].indexOf(where) < 2 && n === 1) throw new DataForSeoError("timeout", "timed out");
        return ok("Alpine Exteriors");
      }) as any;
      const out = await fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" });
      expect(calls).toBe(9 + 2);
      expect(out.data.summary).toMatchObject({ points: 9, checked: 9, found: 9 });
      expect(out.customerUsd).toBeCloseTo(9 * GRID_POINT_USD, 6);
      // Ours: the 9 that returned plus an allowance for the 2 tries whose cost we never learned — inside the reservation.
      expect(out.costUsd).toBeCloseTo(11 * GRID_POINT_USD, 6);
      expect(out.costUsd).toBeLessThanOrEqual(gridEstimateUsd(9));
      // The allowance for what we never learned is already in the figure, so the ledger is told the cost is known and keeps it as it is.
      expect(out.costUnknown).toBe(false);

      // Every lookup times out: only two second tries are made (not nine), and the whole scan fails with its cost attached.
      calls = 0; tries.clear();
      gridDeps.request = (async () => { calls++; throw new DataForSeoError("timeout", "timed out"); }) as any;
      const failed: any = await fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com" }).catch((e) => e);
      expect(calls).toBe(9 + 2);
      expect(failed).toBeInstanceOf(Error);
      expect(failed.costUsd).toBeCloseTo(11 * GRID_POINT_USD, 6);
      expect(failed.costUsd).toBeLessThanOrEqual(gridEstimateUsd(9));
      expect(failed.costUnknown).toBe(false);
    } finally { gridDeps.request = real; }
  });
  it("the hold covers every point with room to spare", () => {
    expect(gridEstimateUsd(49)).toBeGreaterThan(49 * GRID_POINT_USD);
    expect(gridEstimateUsd(9)).toBeCloseTo(0.0225, 6);
  });
  it("a scan under a deadline: lookups cut off at it are unknown tries; after it nothing is sent, second tries included", async () => {
    const real = gridDeps.request;
    const ok = (title: string) => ({ status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.002, result: [{ items: [{ type: "local_pack", title, cid: "9877668871764835558" }] }] }] });
    try {
      // Nine points start together, each under the scan's deadline. Four answer at once; five hang until the deadline
      // passes and are then cut off, as the client cuts them off; from then on the client sends nothing (and says so
      // at no cost) — so the two second tries the scan is allowed are not made.
      let calls = 0, passed = false, hung = 0;
      const seen = new Set<number | undefined>();
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      gridDeps.request = (async (_m: string, _p: string, _b: any, _r: any, opts: any) => {
        seen.add(opts?.deadline);
        if (passed) throw new DataForSeoError("timeout", "not sent: the deadline had passed", 0, undefined, false);
        calls++;
        if (calls <= 4) return ok("Alpine Exteriors");
        hung++; await gate;
        throw new DataForSeoError("timeout", "cut off at the deadline");
      }) as any;
      const deadline = Date.now() + 60_000;
      const running = fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com", deadline });
      while (hung < 5) await new Promise((r) => setTimeout(r, 5));
      passed = true; release();
      const out = await running;
      expect([...seen]).toEqual([deadline]);
      expect(calls).toBe(9);
      expect(out.data.summary).toMatchObject({ points: 9, checked: 4, found: 4 });
      expect(out.data.points.filter((p) => p.failed)).toHaveLength(5);
      expect(out.customerUsd).toBeCloseTo(4 * GRID_POINT_USD, 6);
      // Ours: the four that answered, and one lookup's price for each of the five cut off (billed or not, we cannot tell); nothing for what was never sent.
      expect(out.costUsd).toBeCloseTo(9 * GRID_POINT_USD, 6);
      expect(out.costUnknown).toBe(false);
      // Past the deadline from the start: no point is looked up, the scan fails, and its cost is known to be nothing.
      const failed: any = await fetchGrid({ keyword: "siding", size: 3, spacing: 1, pin, domain: "alpineexteriorswa.com", deadline: Date.now() - 1 }).catch((e) => e);
      expect([calls, failed instanceof Error, failed.costUsd, failed.costUnknown, failed.cause?.costUnknown]).toEqual([9, true, 0, false, false]);
    } finally { gridDeps.request = real; }
  });
});
