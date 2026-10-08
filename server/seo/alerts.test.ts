import { describe, expect, it } from "vitest";
import { describeChange, linkChange, rankChanges, type CheckPair } from "./alerts";
import { locationLabel, locationTypeLabel, usableLocations } from "./locations";

const pair = (keyword: string, previous: number | null, position: number | null, extra: Partial<CheckPair> = {}): CheckPair =>
  ({ keywordId: 1, keyword, device: "desktop", location: null, position, previous, local: null, previousLocal: null, ...extra });

describe("rankChanges", () => {
  it("reports a fall of at least the threshold from inside the top 20", () => {
    const { drops, gains } = rankChanges([pair("a", 4, 9), pair("b", 4, 6), pair("c", 30, 60)], 3);
    expect(drops.map((d) => [d.keyword, d.what, d.from, d.to])).toEqual([["a", "dropped", 4, 9]]);
    expect(gains).toEqual([]);
  });
  it("reports dropping out of the results and coming into them", () => {
    const { drops, gains } = rankChanges([pair("a", 7, null), pair("b", null, 5), pair("far", 45, null), pair("deep", null, 60)]);
    expect(drops.map((d) => [d.keyword, d.what])).toEqual([["a", "lost"]]);
    expect(gains.map((d) => [d.keyword, d.what, d.to])).toEqual([["b", "new", 5]]);
  });
  it("reports a rise of at least the threshold into the top 20", () => {
    const { gains } = rankChanges([pair("a", 15, 6), pair("b", 40, 30), pair("c", 3, 2)], 3);
    expect(gains.map((g) => [g.keyword, g.what, g.from, g.to])).toEqual([["a", "improved", 15, 6]]);
  });
  it("reports entering and leaving the map pack whatever the organic position did", () => {
    const { drops, gains } = rankChanges([pair("a", 5, 5, { previousLocal: 2, local: null }), pair("b", 5, 5, { previousLocal: null, local: 3 })]);
    expect(drops.map((d) => [d.keyword, d.what, d.from])).toEqual([["a", "left_map_pack", 2]]);
    expect(gains.map((g) => [g.keyword, g.what, g.to])).toEqual([["b", "entered_map_pack", 3]]);
  });
  it("puts the most visible keywords first and ignores no change", () => {
    const { drops } = rankChanges([pair("low", 12, 19), pair("top", 1, 8), pair("same", 3, 3)]);
    expect(drops.map((d) => d.keyword)).toEqual(["top", "low"]);
  });
  it("a threshold below one still means a real move", () => {
    expect(rankChanges([pair("a", 3, 3)], 0).drops).toEqual([]);
    expect(rankChanges([pair("a", 3, 4)], 0).drops).toHaveLength(1);
  });
});

describe("describeChange", () => {
  it("reads like a sentence, with the place when there is one", () => {
    expect(describeChange({ keyword: "roof repair", device: "mobile", location: "Tampa, Florida", what: "dropped", from: 4, to: 9 })).toBe('"roof repair" in Tampa, Florida fell from 4 to 9 (mobile)');
    expect(describeChange({ keyword: "siding", device: "desktop", location: null, what: "lost", from: 7, to: null })).toBe('"siding" dropped out of the results — it was 7 (desktop)');
    expect(describeChange({ keyword: "siding", device: "desktop", location: null, what: "entered_map_pack", from: null, to: 2 })).toBe('"siding" is now in the Google map pack at 2 (desktop)');
  });
});

describe("linkChange", () => {
  it("needs at least 3 sites and 5% of what there was", () => {
    expect(linkChange(98, 100)).toBeNull();           // 2 sites
    expect(linkChange(95, 100)).toEqual({ kind: "links_lost", by: 5 });
    expect(linkChange(960, 1000)).toBeNull();         // 40 is under 5% of 1000
    expect(linkChange(940, 1000)).toEqual({ kind: "links_lost", by: 60 });
    expect(linkChange(14, 10)).toEqual({ kind: "links_gained", by: 4 });
    expect(linkChange(null, 10)).toBeNull();
  });
});

describe("locations", () => {
  it("labels a place without the country and names its kind plainly", () => {
    expect(locationLabel("Tampa,Florida,United States")).toBe("Tampa, Florida");
    expect(locationLabel("33602,Florida,United States")).toBe("33602, Florida");
    expect(locationLabel("Florida,United States")).toBe("Florida");
    expect(locationTypeLabel("Postal Code")).toBe("ZIP code");
    expect(locationTypeLabel("City")).toBe("City");
  });
  it("keeps the kinds we offer, once each, and drops malformed rows", () => {
    expect(usableLocations([
      { location_code: 1015214, location_name: "Tampa,Florida,United States", location_type: "City" },
      { location_code: 1015214, location_name: "Tampa,Florida,United States", location_type: "City" },
      { location_code: 9041503, location_name: "Tampa International Airport,Florida,United States", location_type: "Airport" },
      { location_code: "x", location_name: "Bad", location_type: "City" },
      { location_code: 5, location_type: "City" },
      null,
    ])).toEqual([{ code: 1015214, name: "Tampa,Florida,United States", type: "City" }]);
    expect(usableLocations(undefined as any)).toEqual([]);
  });
});
