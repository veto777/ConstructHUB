/** server/crm/portal-review.ts — which review destination the portal's "Leave a review" tab uses. */
import { describe, it, expect } from "vitest";
import { pickPortalReviewProfile } from "./portal-review";

const tpl = (googleProfileUrl: string, isDefault = false, extra: Record<string, unknown> = {}) =>
  ({ googleProfileUrl, isDefault, otherReviewLinks: [], primaryReviewUrl: null, ...extra }) as any;

describe("portal review destination", () => {
  it("prefers the default template over newer ones", () => {
    const p = pickPortalReviewProfile([tpl("https://g.page/newer"), tpl("https://g.page/default", true)], "https://g.page/own");
    expect(p?.googleProfileUrl).toBe("https://g.page/default");
  });
  it("falls back to the newest template, then the account's own Google link", () => {
    expect(pickPortalReviewProfile([tpl("https://g.page/newer"), tpl("https://g.page/older")], null)?.googleProfileUrl).toBe("https://g.page/newer");
    expect(pickPortalReviewProfile([], " https://g.page/own ")?.googleProfileUrl).toBe("https://g.page/own");
  });
  it("skips templates without a link and is null when there is nowhere to review", () => {
    expect(pickPortalReviewProfile([tpl("  ", true)], "https://g.page/own")?.googleProfileUrl).toBe("https://g.page/own");
    expect(pickPortalReviewProfile([tpl("")], "")).toBeNull();
  });
  it("carries the template's other review sites and primary destination", () => {
    const links = [{ platform: "yelp", url: "https://www.yelp.com/biz/alpine" }];
    const p = pickPortalReviewProfile([tpl("https://g.page/a", true, { otherReviewLinks: links, primaryReviewUrl: "https://www.yelp.com/biz/alpine" })], null);
    expect(p?.primaryReviewUrl).toBe("https://www.yelp.com/biz/alpine");
    expect(p?.otherReviewLinks.map((l) => l.url)).toContain("https://www.yelp.com/biz/alpine");
  });
});
