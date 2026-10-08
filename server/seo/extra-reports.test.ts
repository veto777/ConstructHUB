import { describe, expect, it } from "vitest";
import { adsPage, adsSnapshot, effectiveReport, hasSort, questionRe, parseAd, parseLinkCompetitor, parseReferringIp, parseSubdomain, reportCacheKey, reportInput, reportRequest } from "./reports";

const req = (table: string, extra: Record<string, unknown> = {}) => reportRequest({ ...reportInput.parse({ domain: "a.com", table, ...extra }), target: "a.com" });

describe("the later Site Explorer reports", () => {
  it("referring IPs: linking sites grouped by server address", () => {
    const r = req("referringIps");
    expect(r.path).toBe("/backlinks/referring_networks/live");
    expect(r.body).toMatchObject({ target: "a.com", network_address_type: "ip", order_by: ["referring_domains,desc"], limit: 50, offset: 0 });
    expect(parseReferringIp({ network_address: "188.114.96.3", rank: 274, backlinks: 1873, referring_domains: 730, first_seen: "2025-08-13 14:29:11 +00:00" })).toEqual({ ip: "188.114.96.3", referringDomains: 730, backlinks: 1873, firstSeen: "2025-08-13" });
    expect(parseReferringIp({ network_address: "<script>" })).toBeNull();
  });
  it("sites with similar links: never the site itself", () => {
    expect(req("linkCompetitors").body).toMatchObject({ target: "a.com", exclude_large_domains: true, order_by: ["intersections,desc"] });
    expect(parseLinkCompetitor({ target: "www.B.com", rank: 210, intersections: 1111 }, "a.com")).toEqual({ domain: "b.com", shared: 1111 });
    expect(parseLinkCompetitor({ target: "shop.a.com", rank: 300, intersections: 5 }, "a.com")).toBeNull();
    expect(parseLinkCompetitor({ target: "a.com", rank: 300, intersections: 5 }, "a.com")).toBeNull();
  });
  it("subdomains: traffic and keywords for each", () => {
    expect(req("subdomains").path).toBe("/dataforseo_labs/google/subdomains/live");
    expect(parseSubdomain({ subdomain: "ir.example.com", metrics: { organic: { pos_1: 18, pos_2_3: 16, pos_4_10: 12, etv: 501.9, count: 58, estimated_paid_traffic_cost: 218.8 } } }))
      .toEqual({ subdomain: "ir.example.com", traffic: 502, keywords: 58, top3: 34, top10: 46, trafficValue: 219 });
    expect(parseSubdomain({ subdomain: "x.example.com" })).toBeNull();
    // www is its own host name, and a number the source left out stays unknown.
    expect(parseSubdomain({ subdomain: "www.example.com", metrics: { organic: { etv: 10.4 } } })).toEqual({ subdomain: "www.example.com", traffic: 10, keywords: null, top3: null, top10: null, trafficValue: null });
    expect(parseSubdomain({ subdomain: "<b>.example.com", metrics: { organic: {} } })).toBeNull();
  });
  it("a sort or filter the report does not have never makes a second copy of the same page", () => {
    const plain = { ...reportInput.parse({ domain: "a.com", table: "subdomains" }), target: "a.com" };
    const noisy = { ...reportInput.parse({ domain: "a.com", table: "subdomains", sort: "authority", filters: { volumeMin: 100, contains: "x", everyLink: true } }), target: "a.com" };
    expect(effectiveReport(noisy)).toMatchObject({ sort: "traffic", filters: {} });
    expect(reportCacheKey(noisy)).toBe(reportCacheKey(plain));
    expect(reportRequest(effectiveReport(noisy))).toEqual(reportRequest(plain));
    // A filter the report does use is kept, and still tells pages apart.
    const kw = { ...reportInput.parse({ domain: "a.com", table: "keywords", sort: "volume", filters: { volumeMin: 100, follow: "followed" } }), target: "a.com" };
    expect(effectiveReport(kw)).toMatchObject({ sort: "volume", filters: { volumeMin: 100 } });
    expect(reportCacheKey(kw)).not.toBe(reportCacheKey({ ...kw, filters: {} }));
    // "every link: off" is the same request as not saying.
    const links = (filters: object) => reportCacheKey({ ...reportInput.parse({ domain: "a.com", table: "backlinks", filters }), target: "a.com" });
    expect(links({ everyLink: false })).toBe(links({}));
  });
  it("ads: one lookup for everything the library gives, then paged from the saved copy", () => {
    expect(req("ads", { limit: 25, offset: 50 }).body).toEqual({ target: "a.com", location_code: 2840, depth: 120 });
    const item = (n: number) => ({ type: "ads_search", title: `Advertiser ${n}`, url: `https://adstransparency.google.com/advertiser/AR1/creative/CR${n}`, format: "text", first_shown: "2026-04-01 00:00:00 +00:00", last_shown: "2026-10-08 00:00:00 +00:00" });
    const full = adsSnapshot("a.com", Array.from({ length: 120 }, (_, n) => item(n)), "2026-10-08T00:00:00.000Z");
    expect(full.capped).toBe(true);
    const p3 = adsPage(full, 50, 100);
    expect(p3).toMatchObject({ table: "ads", total: 120, capped: true, offset: 100, limit: 50, sourceRows: 20 });
    expect((p3.rows as any[])[0].advertiser).toBe("Advertiser 100");
    // Fewer than the library's limit: that is all there is, and a malformed row does not shift the pages.
    const some = adsSnapshot("a.com", [item(1), { type: "ads_search" }, item(3)], "2026-10-08T00:00:00.000Z");
    expect(some).toMatchObject({ capped: false });
    expect(adsPage(some, 25, 0)).toMatchObject({ total: 2, capped: false, sourceRows: 2 });
    expect(adsPage(some, 25, 25).rows).toEqual([]);
    const ad = { type: "ads_search", title: "James Hardie Building Products Inc", url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1?region=US", verified: true, format: "text", first_shown: "2026-04-01 04:11:39 +00:00", last_shown: "2026-10-08 06:37:40 +00:00" };
    expect(parseAd(ad)).toEqual({ advertiser: "James Hardie Building Products Inc", format: "text", verified: true, firstShown: "2026-04-01", lastShown: "2026-10-08", url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1?region=US" });
    expect(parseAd({ ...ad, url: "https://evil.example/x" })!.url).toBeNull();
    expect(parseAd({ ...ad, type: "organic" })).toBeNull();
  });
  it("a sort name every object has is not a sort", () => {
    expect(hasSort("keywords", "volume")).toBe(true);
    for (const bad of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(hasSort("keywords", bad)).toBe(false);
      const r = { ...reportInput.parse({ domain: "a.com", table: "keywords", sort: bad }), target: "a.com" };
      expect(effectiveReport(r).sort).toBe("traffic");
      expect(reportRequest(r).body.order_by).toEqual(["ranked_serp_element.serp_item.etv,desc"]);
    }
  });
  it("a link report is one saved page whatever country is sent; a keyword report is one per country", () => {
    const key = (table: string, extra: object) => reportCacheKey({ ...reportInput.parse({ domain: "a.com", table, ...extra }), target: "a.com" });
    expect(key("backlinks", { locationCode: 2124, languageCode: "fr" })).toBe(key("backlinks", {}));
    expect(key("referringIps", { locationCode: 2826 })).toBe(key("referringIps", {}));
    expect(key("keywords", { locationCode: 2124, languageCode: "fr" })).not.toBe(key("keywords", {}));
  });
  it("questions are recognised in the language asked for", () => {
    const q = (languageCode: string) => JSON.stringify(reportRequest({ ...reportInput.parse({ keyword: "toiture", table: "questions", languageCode }), target: "toiture" }).body.filters);
    expect(q("fr")).toContain("comment|pourquoi");
    expect(q("es")).toContain("cómo|como");
    expect(q("en")).toContain("how|what");
    expect(new RegExp(questionRe("fr")).test("comment poser un bardage")).toBe(true);
    expect(new RegExp(questionRe("es")).test("cuánto cuesta un techo nuevo")).toBe(true);
    expect(new RegExp(questionRe("fr")).test("how to install siding")).toBe(false);
  });
});
