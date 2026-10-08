import { describe, expect, it } from "vitest";
import { parsePotential, potentialRequest } from "./reports";
import { DEFAULT_MARKET, SEO_MARKETS, findMarket, marketKey, marketLabel } from "@shared/seo-markets";

const loc = { location_code: 2840, language_code: "en" };

describe("traffic potential and parent topic", () => {
  it("asks for the first page's own keywords, biggest earner first", () => {
    expect(potentialRequest("https://www.jameshardie.com/siding/plank/?a=1#top", loc)).toEqual({
      ...loc, target: "jameshardie.com", limit: 1, order_by: ["ranked_serp_element.serp_item.etv,desc"],
      filters: ["ranked_serp_element.serp_item.relative_url", "=", "/siding/plank/?a=1"],
    });
    expect(potentialRequest("https://example.com", loc)!.filters).toEqual(["ranked_serp_element.serp_item.relative_url", "=", "/"]);
  });
  it("never builds a request from something that is not a web address", () => {
    expect(potentialRequest("javascript:alert(1)", loc)).toBeNull();
    expect(potentialRequest("not a url", loc)).toBeNull();
  });
  it("reads the page's total visits, its keyword count and the keyword that earns most", () => {
    const result = { total_count: 356, metrics: { organic: { etv: 4385.29, count: 356 } }, items: [{ keyword_data: { keyword: "hardie plank siding", keyword_info: { search_volume: 14800 } } }] };
    expect(parsePotential(result, "https://a.com/x")).toEqual({ url: "https://a.com/x", traffic: 4385, keywords: 356, parentTopic: "hardie plank siding", parentVolume: 14800 });
  });
  it("is null when the source knows nothing about the page, and survives a page with no keywords listed", () => {
    expect(parsePotential(undefined, "https://a.com/x")).toBeNull();
    expect(parsePotential({ items: [] }, "https://a.com/x")).toBeNull();
    expect(parsePotential({ metrics: { organic: { etv: 0, count: 0 } }, items: [] }, "https://a.com/x")).toEqual({ url: "https://a.com/x", traffic: 0, keywords: 0, parentTopic: null, parentVolume: null });
  });
});

describe("countries", () => {
  it("each country and language pair is listed once, the United States first", () => {
    expect(new Set(SEO_MARKETS.map(marketKey)).size).toBe(SEO_MARKETS.length);
    expect(DEFAULT_MARKET).toMatchObject({ locationCode: 2840, languageCode: "en" });
  });
  it("only listed pairs are found", () => {
    expect(findMarket(2124, "fr")?.label).toBe("Canada (French)");
    expect(findMarket(2124, "de")).toBeNull();
    expect(findMarket("2840", "en")).toBeNull();
    expect(findMarket(1027510, "en")).toBeNull();
  });
  it("labels a saved report, falling back to the United States", () => {
    expect(marketLabel(2826, "en")).toBe("United Kingdom");
    expect(marketLabel(undefined, undefined)).toBe("United States");
  });
});
