/**
 * Other review sites on a review profile (shared/review-links.ts): the pasted links validate and normalize, a
 * request carries the profile's links and the client page offers them on the step after Google to every client,
 * with no site hard-coded — and, as for the Google link, nothing conditions them on the score.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  MAX_OTHER_REVIEW_LINKS, REVIEW_PLATFORMS, normalizeOtherReviewLinks, normalizeReviewUrl, reviewLinkLabel,
} from "@shared/review-links";

const root = path.resolve(import.meta.dirname, "..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("review-page addresses", () => {
  it("accepts a pasted address with or without https and rejects anything that is not a web page", () => {
    expect(normalizeReviewUrl("www.yelp.com/writeareview/biz/abc")).toBe("https://www.yelp.com/writeareview/biz/abc");
    expect(normalizeReviewUrl("  https://www.bbb.org/us/tx/dallas/profile/roofing/acme-1234/customer-reviews ")).toMatch(/^https:\/\/www\.bbb\.org\//);
    expect(normalizeReviewUrl("http://houzz.com/pro/acme")).toBe("http://houzz.com/pro/acme");
    for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "mailto:a@b.co", "ftp://x.com/a", "localhost", null, undefined]) {
      expect(normalizeReviewUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("a profile's other review sites", () => {
  it("offers the sites the owner asked for, each with a label", () => {
    const keys = REVIEW_PLATFORMS.map((p) => p.key);
    for (const k of ["yelp", "bbb", "houzz", "angi", "homeadvisor", "other"]) expect(keys).toContain(k);
    expect(reviewLinkLabel({ platform: "bbb" })).toBe("BBB");
    expect(reviewLinkLabel({ platform: "homeadvisor" })).toBe("HomeAdvisor");
    expect(reviewLinkLabel({ platform: "other", label: " Porch " })).toBe("Porch");
  });

  it("normalizes a saved list and keeps one link per site", () => {
    const { links, error } = normalizeOtherReviewLinks([
      { platform: "yelp", url: "yelp.com/writeareview/biz/abc" },
      { platform: "bbb", url: "https://www.bbb.org/x/customer-reviews", label: "ignored" },
      { platform: "yelp", url: "https://www.yelp.com/second" },
      { platform: "other", label: "Porch", url: "porch.com/pro/acme" },
      { platform: "other", label: "Porch again", url: "HTTPS://PORCH.COM/pro/acme" },
    ]);
    expect(error).toBeNull();
    expect(links).toEqual([
      { platform: "yelp", url: "https://yelp.com/writeareview/biz/abc" },
      { platform: "bbb", url: "https://www.bbb.org/x/customer-reviews" },
      { platform: "other", label: "Porch", url: "https://porch.com/pro/acme" },
    ]);
  });

  it("treats a missing column or an old row as no links, and a non-list as an error", () => {
    expect(normalizeOtherReviewLinks(undefined)).toEqual({ links: [], error: null });
    expect(normalizeOtherReviewLinks(null)).toEqual({ links: [], error: null });
    expect(normalizeOtherReviewLinks("yelp.com").error).toMatch(/list/);
  });

  it("reports the first bad row: unknown site, bad address, unnamed other link, too many", () => {
    expect(normalizeOtherReviewLinks([{ platform: "tripadvisor", url: "https://x.com" }]).error).toMatch(/Review site 1/);
    expect(normalizeOtherReviewLinks([{ platform: "angi", url: "" }]).error).toMatch(/Review site 1/);
    expect(normalizeOtherReviewLinks([{ platform: "angi", url: "not a url" }]).error).toMatch(/^Angi: paste the full address/);
    expect(normalizeOtherReviewLinks([{ platform: "other", url: "https://porch.com/x" }]).error).toMatch(/Name the site/);
    const many = Array.from({ length: MAX_OTHER_REVIEW_LINKS + 1 }, (_, i) => ({ platform: "other", label: `Site ${i}`, url: `https://site${i}.com/review` }));
    expect(normalizeOtherReviewLinks(many).error).toMatch(new RegExp(`Up to ${MAX_OTHER_REVIEW_LINKS}`));
    expect(normalizeOtherReviewLinks(many.slice(0, MAX_OTHER_REVIEW_LINKS)).error).toBeNull();
  });
});

describe("the links travel with the request and reach the client page (source guards)", () => {
  const routes = src("server/routes.ts");
  const page = src("client/src/pages/review-feedback.tsx");
  const owner = src("client/src/pages/google-reviews.tsx");

  it("the profile routes validate the links and the request copies them when sent", () => {
    expect(routes).toMatch(/app\.post\("\/api\/review-templates"[\s\S]*?normalizeOtherReviewLinks\(req\.body\.otherReviewLinks/);
    expect(routes).toMatch(/app\.patch\("\/api\/review-templates\/:id"[\s\S]*?updateData\.otherReviewLinks = /);
    expect(routes).toMatch(/app\.post\("\/api\/reviews\/create"[\s\S]*?otherReviewLinks = normalizeOtherReviewLinks\(template\.otherReviewLinks\)\.links/);
    expect(routes).toMatch(/app\.get\("\/api\/review\/:token"[\s\S]*?otherReviewLinks: normalizeOtherReviewLinks\(request\.otherReviewLinks\)\.links/);
    expect(routes).toContain('app.post("/api/review/:token/other-link-opened"');
  });

  it("the client page lists the owner's links on the one-more-thing step with no site hard-coded, for every score", () => {
    expect(page).not.toContain("https://www.bbb.org/");
    expect(page).toMatch(/otherReviewLinks\.map\(/);
    // The step is reached by every client who has links to see, not only by a 10.
    expect(page).toMatch(/otherReviewLinks\.length > 0[\s\S]{0,80}setStep\("bonus_reviews"\)/);
    expect(page).not.toMatch(/rating === 10[\s\S]{0,80}setStep\("bonus_reviews"\)/);
  });

  it("the owner's profile dialog edits the links and the list shows them", () => {
    expect(owner).toContain("otherReviewLinks: templateOtherLinks");
    expect(owner).toContain('data-testid="button-add-other-link"');
    expect(owner).toMatch(/REVIEW_PLATFORMS\.map\(/);
  });

  it("the schema and the additive migration carry the columns", () => {
    const schema = src("shared/schema.ts");
    expect(schema.match(/otherReviewLinks: jsonb\("other_review_links"\)/g)?.length).toBe(2);
    expect(schema).toContain('otherLinksOpened: jsonb("other_links_opened")');
    const growth = src("server/growth-schema.ts");
    expect(growth).toContain("ALTER TABLE review_templates ADD COLUMN IF NOT EXISTS other_review_links jsonb");
    expect(growth).toContain("ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS other_review_links jsonb");
    expect(growth).toContain("ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS other_links_opened jsonb");
  });
});
