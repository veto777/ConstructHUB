import { afterEach, describe, expect, it, vi } from "vitest";
import { competitorPlaces, distanceMiles, placesResponse } from "./competitor-provider";
afterEach(() => vi.unstubAllGlobals());
describe("competitor provider boundaries", () => {
  it("geocodes location and filters text-search bias to the exact requested radius", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: 0, lng: 0 } } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "OK", results: [
        { place_id: "near", geometry: { location: { lat: 0.01, lng: 0 } } },
        { place_id: "far", geometry: { location: { lat: 1, lng: 0 } } },
      ] }) });
    vi.stubGlobal("fetch", fetcher);
    expect((await competitorPlaces("roofing", "test city", 5, "dummy")).places.map(x => x.place_id)).toEqual(["near"]);
    expect(fetcher.mock.calls[1][0]).toContain("location=0,0&radius=8047");
    expect(distanceMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });
  it.each(["REQUEST_DENIED", "OVER_QUERY_LIMIT", "INVALID_REQUEST"])("rejects %s instead of completing with zero results", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) }));
    await expect(placesResponse("https://example.invalid", "Competitor search", true)).rejects.toThrow(status);
  });
  it("accepts genuine empty results but rejects network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }));
    expect((await placesResponse("https://example.invalid", "Search", true)).results).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(placesResponse("https://example.invalid", "Search")).rejects.toThrow("could not be reached");
  });
});
