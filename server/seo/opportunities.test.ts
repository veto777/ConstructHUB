import { describe, expect, it } from "vitest";
import { buildOpportunities, oppInput, oppRequest, parseOppKeyword, OPP_ESTIMATE_USD, OPP_ROWS } from "./opportunities";

const row = (keyword: string, position: number, volume: number | null, path: string, extra: { previous?: number; etv?: number } = {}) => ({
  keyword_data: { keyword, keyword_info: { search_volume: volume, cpc: 4.123 }, keyword_properties: { keyword_difficulty: 12.6 } },
  ranked_serp_element: { serp_item: { rank_group: position, etv: extra.etv ?? 1, url: `https://alpine.example${path}`, rank_changes: extra.previous ? { previous_rank_absolute: extra.previous } : {} } },
});
const input = { domain: "alpine.example", locationCode: 2840, languageCode: "en", fetchedAt: "2026-10-08T00:00:00.000Z" };

describe("opportunities", () => {
  it("asks once for the most searched keywords the site ranks on pages one and two for", () => {
    expect(oppRequest(input)).toEqual({
      target: "alpine.example", location_code: 2840, language_code: "en", item_types: ["organic"], limit: OPP_ROWS,
      filters: ["ranked_serp_element.serp_item.rank_group", "<=", 20], order_by: ["keyword_data.keyword_info.search_volume,desc"],
    });
    expect(OPP_ESTIMATE_USD).toBeCloseTo(0.072, 6);
    expect(oppInput.safeParse({ domain: "a.com", extra: 1 }).success).toBe(false);
  });
  it("reads a row, and drops one with no keyword, no position or an unsafe address", () => {
    expect(parseOppKeyword(row("Roof Repair", 5, 880, "/roofing?x=1", { previous: 2, etv: 12.34 }))).toEqual({
      keyword: "Roof Repair", position: 5, previous: 2, volume: 880, difficulty: 13, cpc: 4.12, traffic: 12.3, url: "https://alpine.example/roofing?x=1", path: "/roofing?x=1",
    });
    expect(parseOppKeyword(row("", 5, 1, "/"))).toBeNull();
    expect(parseOppKeyword({ keyword_data: { keyword: "x" }, ranked_serp_element: { serp_item: { rank_group: 2, url: "javascript:alert(1)" } } })).toBeNull();
    expect(parseOppKeyword({ keyword_data: { keyword: "x" }, ranked_serp_element: { serp_item: { url: "https://a.example/" } } })).toBeNull();
  });
  it("sorts the four lists out of one set of rows", () => {
    const o = buildOpportunities(input, [
      row("siding contractor", 1, 2400, "/siding", { etv: 300 }),
      row("roof repair", 5, 880, "/", { previous: 2, etv: 20 }),
      row("gutter installation", 12, 320, "/gutters", { previous: 11, etv: 2 }),
      row("window replacement", 8, 1300, "/", { etv: 30 }),
      row("deck builder", 2, 90, "/", { previous: 9, etv: 15 }),
      row("too deep", 35, 5000, "/blog"),
      row("no numbers", 6, null, "/siding", { etv: 0.4 }),
    ], 240);
    expect(o).toMatchObject({ total: 240, analysed: 6 });
    // Positions 4-20, most searched first; a keyword with no volume goes last, never as zero.
    expect(o.within.map((r) => r.keyword)).toEqual(["window replacement", "roof repair", "gutter installation", "no numbers"]);
    // Fell three or more: 2 -> 5. One place (11 -> 12) is noise, and a rise is not a fall.
    expect(o.falling.map((r) => r.keyword)).toEqual(["roof repair"]);
    expect(o.pages.map((p) => [p.path, p.keywords, p.traffic, p.top3, p.top10, p.best.keyword])).toEqual([
      ["/siding", 2, 300, 1, 2, "siding contractor"], ["/", 3, 65, 1, 3, "window replacement"], ["/gutters", 1, 2, 0, 0, "gutter installation"],
    ]);
    // On the home page and outside the first three ("deck builder" at 2 is doing fine there).
    expect(o.home.map((r) => r.keyword)).toEqual(["window replacement", "roof repair"]);
    expect(o.summary).toEqual({ withinCount: 4, withinVolume: 2500, fallingCount: 1, pages: 3, homeCount: 2, homeShare: 50 });
  });
  it("says nothing about the home page when it is the only page that ranks", () => {
    const o = buildOpportunities(input, [row("roof repair", 5, 880, "/"), row("siding", 9, 500, "/")], 2);
    expect(o.home).toEqual([]);
    expect(o.summary).toMatchObject({ homeCount: 0, homeShare: 100, pages: 1 });
  });
  it("an empty site is empty, not an error", () => {
    expect(buildOpportunities(input, [], null)).toMatchObject({ total: null, analysed: 0, within: [], falling: [], pages: [], home: [], summary: { withinCount: 0, withinVolume: 0, homeShare: null } });
  });
});
