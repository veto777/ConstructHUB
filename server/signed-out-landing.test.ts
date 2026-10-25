/** client/src/lib/signed-out-landing.ts — a signed-out visitor on a tool's URL sees that tool's landing page. */
import { describe, expect, it } from "vitest";
import { signedOutLanding } from "../client/src/lib/signed-out-landing";
import { FEATURE_PAGES, featurePageBySlug } from "../shared/feature-pages";

describe("signed-out landing", () => {
  it("sends every sidebar tool to its landing page", () => {
    expect(signedOutLanding("/press-releases")).toBe("/features/press-releases");
    expect(signedOutLanding("/yelp")).toBe("/features/yelp");
    expect(signedOutLanding("/seo/keywords?tab=x")).toBe("/features/seo");
    expect(signedOutLanding("/social-media/calendar")).toBe("/features/social");
    expect(signedOutLanding("/search")).toBe("/features/permits");
    expect(signedOutLanding("/gbp-photos")).toBe("/features/gbp-content");
    expect(signedOutLanding("/lsa-leads")).toBe("/features/lsa-leads");
    expect(signedOutLanding("/call-assistant/calls")).toBe("/call-assistant");
    expect(signedOutLanding("/tutorials")).toBe("/features/guides");
    expect(signedOutLanding("/my-reputation")).toBe("/reputation");
  });
  it("leaves account pages to sign in", () => {
    for (const p of ["/settings", "/settings/billing", "/account/delete", "/admin/press", "/press-releasesx"]) expect(signedOutLanding(p), p).toBeNull();
  });
  it("every in-app feature page is reachable from its own app link", () => {
    for (const page of FEATURE_PAGES.filter((p) => p.app.surface === "app" && p.app.href !== "/")) {
      const landing = signedOutLanding(page.app.href);
      expect(landing, page.key).toBeTruthy();
      if (landing!.startsWith("/features/")) expect(featurePageBySlug(landing!.slice("/features/".length)), page.key).toBeDefined();
    }
  });
});
