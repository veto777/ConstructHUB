import { describe, expect, it } from "vitest";
import { parseAd, parseLinkCompetitor, parseReferringIp, parseSubdomain, reportInput, reportRequest } from "./reports";

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
  });
  it("ads: asks the ad library for everything up to the page, and only links to Google's own page", () => {
    expect(req("ads", { limit: 25, offset: 50 }).body).toEqual({ target: "a.com", location_code: 2840, depth: 75 });
    expect(req("ads", { limit: 100, offset: 100 }).body).toMatchObject({ depth: 120 });
    const ad = { type: "ads_search", title: "James Hardie Building Products Inc", url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1?region=US", verified: true, format: "text", first_shown: "2026-04-01 04:11:39 +00:00", last_shown: "2026-10-08 06:37:40 +00:00" };
    expect(parseAd(ad)).toEqual({ advertiser: "James Hardie Building Products Inc", format: "text", verified: true, firstShown: "2026-04-01", lastShown: "2026-10-08", url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1?region=US" });
    expect(parseAd({ ...ad, url: "https://evil.example/x" })!.url).toBeNull();
    expect(parseAd({ ...ad, type: "organic" })).toBeNull();
  });
});
