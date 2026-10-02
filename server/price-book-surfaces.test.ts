import { describe, expect, it } from "vitest";
// Small server surfaces of the price book: the sitemap and the retired
// single-tool pricing page, the sales-inquiry subject, and the plan copy that
// must match the limits it describes.
import fs from "fs";
import path from "path";
import { buildSitemap, PUBLIC_ROUTES, RETIRED_ROUTES, withRouteMeta } from "./static";
import { ROUTE_META } from "@shared/route-meta";
import { salesInquirySubject } from "./catalog";
import { PLANS, PLAN_KEYS, gridCreditCost } from "@shared/plans";

describe("sitemap and retired pages", () => {
  it("no longer lists /individual-pricing, and sends it to the add-ons on /pricing", () => {
    expect(PUBLIC_ROUTES).not.toContain("/individual-pricing");
    expect(buildSitemap()).not.toContain("individual-pricing");
    expect(buildSitemap()).toContain("/pricing</loc>");
    expect(RETIRED_ROUTES["/individual-pricing"]).toBe("/pricing#add-ons");
  });

  it("lists /call-assistant and serves it with its own title and description", () => {
    expect(buildSitemap()).toContain("/call-assistant</loc>");
    const indexHtml = fs.readFileSync(path.resolve(import.meta.dirname, "../client/index.html"), "utf8");
    const html = withRouteMeta(indexHtml, "/call-assistant");
    const meta = ROUTE_META["/call-assistant"];
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${meta.description}" />`);
    expect(html).toContain(`<meta property="og:title" content="${meta.title}" />`);
    expect(html).toContain(`<meta property="og:description" content="${meta.description}" />`);
    // /pricing has its own too now (every marketing page does, shared/route-meta.ts);
    // a page without an entry — the signed-in tools — keeps index.html's defaults.
    expect(withRouteMeta(indexHtml, "/pricing")).toContain(`<title>${ROUTE_META["/pricing"].title.replace(/&/g, "&amp;")}</title>`);
    expect(withRouteMeta(indexHtml, "/search")).toBe(indexHtml);
  });
});

describe("sales inquiry subject", () => {
  it("names the first requested service and the sender, on one line", () => {
    expect(salesInquirySubject(["Agency above 500 locations", "SEO"], "Pat Doe")).toBe("Sales inquiry — Agency above 500 locations — Pat Doe");
    expect(salesInquirySubject(null, "Pat")).toBe("Sales inquiry — General — Pat");
    expect(salesInquirySubject([], "Pat\r\nBcc: x@example.invalid")).toBe("Sales inquiry — General — Pat Bcc: x@example.invalid");
    expect(salesInquirySubject(["x".repeat(300)], "y".repeat(300)).length).toBeLessThanOrEqual("Sales inquiry —  — ".length + 250);
  });
});

describe("plan bullets match the limits", () => {
  it("each plan's permit-search bullet states its monthly limit", () => {
    for (const key of PLAN_KEYS) {
      const limit = PLANS[key].limits.permitSearches;
      const bullet = PLANS[key].features.find((f) => /permit search/i.test(f));
      if (!bullet) continue; // Agency lists none; its limit shows in the comparison table
      expect(bullet, key).toContain(limit === -1 ? "fair use" : limit.toLocaleString("en-US"));
      expect(bullet, key).not.toMatch(limit === -1 ? /\d+ permit/ : /fair use/);
    }
    expect(PLANS.growth.features).toContain("5,000 permit searches / month");
  });

  it("grid credit cost lives in the price book (the server and client read one function)", () => {
    expect([3, 5, 7, 9, 11, 13, 15].map(gridCreditCost)).toEqual([1, 1, 2, 4, 5, 7, 9]);
  });
});
