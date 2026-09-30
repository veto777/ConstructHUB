import { afterEach, describe, expect, it, vi } from "vitest";
import { competitorPlaces, distanceMiles, PAGE_TOKEN_ATTEMPTS, placesResponse } from "./competitor-provider";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const reply = (body: any) => ({ ok: true, json: async () => body });
const geocoded = reply({ status: "OK", results: [{ geometry: { location: { lat: 0, lng: 0 } } }] });
const place = (id: string) => ({ place_id: id, geometry: { location: { lat: 0.01, lng: 0 } } });
// Page-token requests wait between attempts; drive those waits with fake timers.
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const result: any = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}
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
  it("retries a page token that is not valid yet and keeps every page", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geocoded)
      .mockResolvedValueOnce(reply({ status: "OK", results: [place("p1")], next_page_token: "tok" }))
      .mockResolvedValueOnce(reply({ status: "INVALID_REQUEST" }))
      .mockResolvedValueOnce(reply({ status: "INVALID_REQUEST" }))
      .mockResolvedValueOnce(reply({ status: "OK", results: [place("p2")] }));
    vi.stubGlobal("fetch", fetcher);
    const found = await settle(competitorPlaces("roofing", "test city", 10, "dummy"));
    expect(found.places.map(x => x.place_id)).toEqual(["p1", "p2"]);
    expect(found.complete).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
    // A bare pagetoken request never became valid in production; the original query must ride along.
    const pageUrl = new URL(fetcher.mock.calls[4][0]);
    expect(pageUrl.searchParams.get("pagetoken")).toBe("tok");
    expect(pageUrl.searchParams.get("query")).toBe("roofing in test city");
    expect(pageUrl.searchParams.get("location")).toBe("0,0");
    expect(pageUrl.searchParams.get("radius")).toBe("16093");
  });
  it("keeps the pages already loaded when paging never succeeds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geocoded)
      .mockResolvedValueOnce(reply({ status: "OK", results: [place("p1")], next_page_token: "tok" }))
      .mockResolvedValue(reply({ status: "INVALID_REQUEST" }));
    vi.stubGlobal("fetch", fetcher);
    const found = await settle(competitorPlaces("roofing", "test city", 10, "dummy"));
    expect(found.places.map(x => x.place_id)).toEqual(["p1"]);
    expect(found.complete).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2 + PAGE_TOKEN_ATTEMPTS);
  });
  it("does not retry other page-token failures, but still keeps loaded pages", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geocoded)
      .mockResolvedValueOnce(reply({ status: "OK", results: [place("p1")], next_page_token: "tok" }))
      .mockResolvedValue(reply({ status: "OVER_QUERY_LIMIT" }));
    vi.stubGlobal("fetch", fetcher);
    const found = await settle(competitorPlaces("roofing", "test city", 10, "dummy"));
    expect(found.places.map(x => x.place_id)).toEqual(["p1"]);
    expect(found.complete).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("still fails the scan when the first results page fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(geocoded).mockResolvedValue(reply({ status: "REQUEST_DENIED" })));
    await expect(competitorPlaces("roofing", "test city", 10, "dummy")).rejects.toThrow("REQUEST_DENIED");
  });
  it("reports an unknown location with the geocoding message, not a provider error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ status: "ZERO_RESULTS", results: [] })));
    await expect(competitorPlaces("roofing", "zzqx nowhere", 10, "dummy")).rejects.toThrow("Location could not be geocoded");
  });
});
