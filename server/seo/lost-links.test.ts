import { describe, expect, it } from "vitest";
import { lostLinksRequest, parseLostLink } from "./dataforseo";
import { isStrongLoss, namedLosses, STRONG_LINK } from "./alerts";
import { estimateLostLinksUsd, LOST_LINK_ROWS } from "./pricing";

describe("lost linking sites, named", () => {
  it("asks for links last seen after the previous snapshot and now gone, one per site, strongest first", () => {
    expect(lostLinksRequest("alpine.example", "2026-09-08", 25)).toMatchObject({
      target: "alpine.example", backlinks_status_type: "lost", mode: "one_per_domain", limit: 25, filters: ["last_seen", ">", "2026-09-08"], order_by: ["domain_from_rank,desc"], rank_scale: "one_thousand",
    });
    expect(lostLinksRequest("a.example", "2026-09-08", 5000).limit).toBe(100);
    expect(estimateLostLinksUsd()).toBeGreaterThan(0);
    expect(LOST_LINK_ROWS).toBe(25);
  });
  it("reads a lost link: the site, its strength out of 100, the page that linked and when it was last seen", () => {
    expect(parseLostLink({ domain_from: "www.MarketResearch.example", domain_from_rank: 595, url_from: "https://www.marketresearch.example/reports/x", url_to: "https://alpine.example/", anchor: "", last_seen: "2026-10-01 04:11:39 +00:00", dofollow: true, backlink_spam_score: 7 }))
      .toEqual({ domain: "marketresearch.example", authority: 60, spam: 7, from: "https://www.marketresearch.example/reports/x", to: "https://alpine.example/", anchor: null, lastSeen: "2026-10-01", follow: true });
    // An address that is not a web address is dropped, not linked.
    expect(parseLostLink({ domain_from: "a.example", url_from: "javascript:alert(1)", url_to: "data:text/html,x" })).toMatchObject({ domain: "a.example", authority: null, from: null, to: null, follow: false });
    expect(parseLostLink({ domain_from: "<script>" })).toBeNull();
    expect(parseLostLink(null)).toBeNull();
  });
  it("names the strongest ten in an alert", () => {
    const lost = Array.from({ length: 14 }, (_, i) => ({ domain: `site${i}.example`, authority: i * 5, from: null, to: null, lastSeen: null }));
    const named = namedLosses([...lost, null, { nope: 1 }]);
    expect(named).toHaveLength(10);
    expect(named[0]).toMatchObject({ domain: "site13.example", authority: 65 });
    expect(named.filter((l) => (l.authority ?? 0) >= STRONG_LINK)).toHaveLength(8);
    expect(namedLosses(undefined)).toEqual([]);
    // A strong loss is a followed link from a real site: a nofollow link or a spammy site is no loss, whatever its authority.
    const row = { domain: "a.example", authority: 60, from: null, to: null, lastSeen: null };
    expect(isStrongLoss(row)).toBe(true);
    expect(isStrongLoss({ ...row, follow: false })).toBe(false);
    expect(isStrongLoss({ ...row, spam: 80 })).toBe(false);
    expect(isStrongLoss({ ...row, authority: 12 })).toBe(false);
  });
});
