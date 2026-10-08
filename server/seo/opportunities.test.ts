import { describe, expect, it } from "vitest";
import { buildOpportunities, isFalling, isHomeOnly, isHomePage, isWithin, oppInput, oppRequest, pageKey, parseOppKeyword, OPP_ESTIMATE_USD, OPP_ROWS } from "./opportunities";

type Extra = { abs?: number; before?: number; etv?: number; host?: string };
const row = (keyword: string, position: number, volume: number | null, path: string, extra: Extra = {}) => ({
  keyword_data: { keyword, keyword_info: { search_volume: volume, cpc: 4.123 }, keyword_properties: { keyword_difficulty: 12.6 } },
  ranked_serp_element: { serp_item: { rank_group: position, rank_absolute: extra.abs ?? position, etv: extra.etv ?? 1, url: `https://${extra.host ?? "alpine.example"}${path}`, rank_changes: extra.before ? { previous_rank_absolute: extra.before } : {} } },
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
    expect(parseOppKeyword(row("Roof Repair", 5, 880, "/roofing?x=1", { abs: 9, before: 4, etv: 12.34 }), "alpine.example")).toEqual({
      keyword: "Roof Repair", position: 5, fell: 5, volume: 880, difficulty: 13, cpc: 4.12, traffic: 12.3, url: "https://alpine.example/roofing?x=1", home: false,
    });
    expect(parseOppKeyword(row("", 5, 1, "/"), "alpine.example")).toBeNull();
    expect(parseOppKeyword({ keyword_data: { keyword: "x" }, ranked_serp_element: { serp_item: { rank_group: 2, url: "javascript:alert(1)" } } }, "a.example")).toBeNull();
    expect(parseOppKeyword({ keyword_data: { keyword: "x" }, ranked_serp_element: { serp_item: { url: "https://a.example/" } } }, "a.example")).toBeNull();
  });
  it("a fall is measured like with like: place on the whole results page now against then", () => {
    const fell = (abs: number, before: number, organic = 9) => parseOppKeyword(row("k", organic, 10, "/x", { abs, before }), "alpine.example")!.fell;
    // 8th -> 12th on the whole page is four places lost, whatever its place among the organic results is.
    expect(fell(12, 8, 9)).toBe(4);
    // The organic place (5) is never set against the old whole-page place (2): that would call a rise a fall.
    expect(fell(2, 2, 5)).toBeNull();
    expect(fell(3, 9)).toBeNull(); // a rise
    expect(parseOppKeyword(row("k", 9, 10, "/x"), "alpine.example")!.fell).toBeNull(); // no earlier look
    expect(isFalling({ fell: 2 } as any)).toBe(false);
    expect(isFalling({ fell: 3 } as any)).toBe(true);
  });
  it("a page is its host and path: other hosts are other pages, and only the site's own front page is the home page", () => {
    expect(pageKey("https://www.Alpine.example/roofing/")).toBe(pageKey("https://alpine.example/roofing"));
    expect(pageKey("https://shop.alpine.example/roofing")).not.toBe(pageKey("https://alpine.example/roofing"));
    expect(pageKey("https://alpine.example/?utm_source=x&gclid=1")).toBe("alpine.example/");
    expect(pageKey("https://alpine.example/?page=2")).toBe("alpine.example/?page=2");
    expect(isHomePage("https://www.alpine.example/", "alpine.example")).toBe(true);
    expect(isHomePage("https://alpine.example/?utm_campaign=spring", "alpine.example")).toBe(true);
    expect(isHomePage("https://blog.alpine.example/", "alpine.example")).toBe(false);
    expect(isHomePage("https://alpine.example/roofing", "alpine.example")).toBe(false);
  });
  it("keeps every row bought, groups pages by their full address, and counts each list", () => {
    const o = buildOpportunities(input, [
      row("siding contractor", 1, 2400, "/siding", { etv: 300 }),
      row("roof repair", 5, 880, "/", { abs: 6, before: 2, etv: 20 }),
      row("gutter installation", 12, 320, "/gutters", { abs: 13, before: 12, etv: 2 }),
      row("window replacement", 8, 1300, "/?utm_source=gmb", { etv: 30 }),
      row("deck builder", 2, 90, "/", { abs: 2, before: 9, etv: 15 }),
      row("too deep", 35, 5000, "/blog"),
      row("no numbers", 6, null, "/siding", { etv: 0.4 }),
      row("siding blog", 7, 60, "/siding", { host: "blog.alpine.example", etv: 3 }),
    ], 240);
    expect(o.total).toBe(240);
    // Most searched first; a keyword with no volume goes last, never as zero. The one beyond page two is dropped.
    expect(o.rows.map((r) => r.keyword)).toEqual(["siding contractor", "window replacement", "roof repair", "gutter installation", "deck builder", "siding blog", "no numbers"]);
    expect(o.rows.filter(isWithin).map((r) => r.keyword)).toEqual(["window replacement", "roof repair", "gutter installation", "siding blog", "no numbers"]);
    expect(o.rows.filter(isFalling).map((r) => [r.keyword, r.fell])).toEqual([["roof repair", 4]]);
    // The home page with a tracking parameter is still the home page; the blog's /siding is its own page.
    expect(o.pages.map((p) => [p.key, p.home, p.keywords, p.traffic, p.top3, p.top10, p.best.keyword])).toEqual([
      ["alpine.example/siding", false, 2, 300, 1, 2, "siding contractor"], ["alpine.example/", true, 3, 65, 1, 3, "window replacement"],
      ["blog.alpine.example/siding", false, 1, 3, 0, 1, "siding blog"], ["alpine.example/gutters", false, 1, 2, 0, 0, "gutter installation"],
    ]);
    expect(o.rows.filter(isHomeOnly).map((r) => r.keyword)).toEqual(["window replacement", "roof repair"]);
    expect(o.summary).toEqual({ analysed: 7, withinCount: 5, withinVolume: 2560, fallingCount: 1, pages: 4, homeCount: 2, homeShare: 43 });
  });
  it("still lists home-page searches when the home page is the only page returned, and none when the only page is another", () => {
    const home = buildOpportunities(input, [row("roof repair", 5, 880, "/"), row("siding", 9, 500, "/")], 2);
    expect([home.summary.homeCount, home.summary.homeShare, home.summary.pages]).toEqual([2, 100, 1]);
    const other = buildOpportunities(input, [row("roof repair", 5, 880, "/roofing")], 1);
    expect([other.summary.homeCount, other.summary.homeShare, other.pages[0].home]).toEqual([0, 0, false]);
  });
  it("nothing is cut off: five hundred rows in, five hundred rows out", () => {
    const o = buildOpportunities(input, Array.from({ length: 500 }, (_, i) => row(`keyword ${i}`, 4 + (i % 17), 1000 - i, `/page-${i % 300}`)), 500);
    expect([o.rows.length, o.pages.length, o.summary.withinCount]).toEqual([500, 300, 500]);
  });
  it("an empty site is empty, not an error", () => {
    expect(buildOpportunities(input, [], null)).toMatchObject({ total: null, rows: [], pages: [], summary: { analysed: 0, withinCount: 0, withinVolume: 0, homeCount: 0, homeShare: null } });
  });
});
