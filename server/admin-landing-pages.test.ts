/**
 * The admins' "see the landing page" icon (client/src/components/admin-landing-link.tsx): every app page maps to
 * its feature's intro page through the registry's own app.href, and the Call Assistant previews signed in.
 * Plus the reinstatement half price on Unlimited (shared/plans.ts reinstatementPriceCents; owner, 2026-10-16).
 */
import { describe, expect, it } from "vitest";
import {
  CALL_ASSISTANT_INTRO_PREVIEW_PATH, FEATURE_CATALOGUE, landingPagesForAppPath, landingPreviewPath,
} from "@shared/feature-pages";
import { GBP_REINSTATEMENT_CENTS, PLAN_KEYS, PLANS, reinstatementPriceCents } from "@shared/plans";

const keys = (path: string) => landingPagesForAppPath(path).map((p) => p.key).sort();

describe("landing pages for app pages", () => {
  it("every app-surface feature's own page finds its intro page", () => {
    for (const e of FEATURE_CATALOGUE) {
      if (e.app.surface !== "app") continue;
      expect(keys(e.app.href), e.app.href).toContain(e.key);
    }
  });

  it("a sub-page gets its parent feature; the deepest href wins", () => {
    expect(keys("/seo/keywords")).toEqual(["seo"]);
    expect(keys("/seo/")).toEqual(["seo"]);
    expect(keys("/google-ads?tab=rules")).toEqual(["clickGuard"]);
  });

  it("one page shared by two features lists both", () => {
    expect(keys("/locations")).toEqual(["gbp", "profileGuard"]);
  });

  it("the dashboard matches only itself, and unrelated pages match nothing", () => {
    expect(keys("/")).toEqual(["gabe"]);
    expect(keys("/settings")).toEqual([]);
    expect(keys("/press-releases")).toEqual([]);
  });

  it("CRM-host features are left out of the app frame", () => {
    expect(keys("/crm/jobcam")).toEqual([]);
    expect(keys("/crm")).toEqual([]);
  });

  it("the Call Assistant opens its intro page at the signed-in preview path", () => {
    const [page] = landingPagesForAppPath("/call-assistant/calls");
    expect(page.key).toBe("callAssistant");
    expect(page.path).toBe("/call-assistant");
    expect(page.preview).toBe(CALL_ASSISTANT_INTRO_PREVIEW_PATH);
    expect(landingPreviewPath("/features/seo")).toBe("/features/seo");
  });
});

describe("reinstatement price by plan", () => {
  it("is half the standard rate on Unlimited only", () => {
    expect(PLANS.agency.name).toBe("Unlimited");
    expect(reinstatementPriceCents("agency")).toBe(GBP_REINSTATEMENT_CENTS / 2);
    for (const key of PLAN_KEYS.filter((k) => k !== "agency")) expect(reinstatementPriceCents(key), key).toBe(GBP_REINSTATEMENT_CENTS);
    expect(reinstatementPriceCents(null)).toBe(GBP_REINSTATEMENT_CENTS);
    expect(Number.isInteger(reinstatementPriceCents("agency"))).toBe(true);
  });

  it("the plan bullet that promises it is on the plan that gets it", () => {
    for (const key of PLAN_KEYS) {
      const promises = PLANS[key].features.some((f) => /reinstatement help at half/i.test(f));
      expect(promises, key).toBe(reinstatementPriceCents(key) < GBP_REINSTATEMENT_CENTS);
    }
  });
});

describe("tools covered by another feature's page", () => {
  it("map to that feature (each alias names a real registry key)", () => {
    expect(keys("/permit-alerts")).toEqual(["permits"]);
    expect(keys("/gbp-photos")).toEqual(["gbpContent"]);
    expect(keys("/gmb-monitor")).toEqual(["profileGuard"]);
    expect(keys("/media-library")).toEqual(["media"]);
    expect(keys("/lsa-guide")).toEqual(["guides"]);
    expect(keys("/listing-editor")).toEqual(["gbp"]);
  });
});
