import { describe, expect, it } from "vitest";
import { PLANS, PLAN_KEYS, SEO_PLAN_LIMITS, SEO_GRANDFATHERED_LIMITS, SEO_NOT_INCLUDED_LINE, UNLIMITED } from "@shared/plans";
import { keywordsFit, seoAllowanceTest, SEO_ENV_VARS, SEO_NOT_READY_MESSAGE } from "./plan";

describe("ConstructHUB SEO plan units (shared/plans.ts SEO_PLAN_LIMITS — Agency only, owner 2026-10-08)", () => {
  it("every plan carries the SEO limits from the one table", () => {
    for (const key of PLAN_KEYS) {
      const l = PLANS[key].limits;
      expect(l.seoKeywords).toBe(SEO_PLAN_LIMITS[key].seoKeywords);
      expect(l.seoCreditCents).toBe(SEO_PLAN_LIMITS[key].seoCreditCents);
    }
  });
  it("Agency: 1,000 tracked keywords and $40 of SEO data a month; Starter, Pro and Growth: none", () => {
    expect(SEO_PLAN_LIMITS.starter).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.pro).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.growth).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.agency).toEqual({ seoKeywords: 1000, seoCreditCents: 4000 });
  });
  it("a grandfathered account keeps what its plan had before: 50 / $10, 200 / $20, 1,000 / $40", () => {
    expect(SEO_GRANDFATHERED_LIMITS.starter).toEqual({ seoKeywords: 50, seoCreditCents: 1000 });
    expect(SEO_GRANDFATHERED_LIMITS.pro).toEqual({ seoKeywords: 200, seoCreditCents: 2000 });
    expect(SEO_GRANDFATHERED_LIMITS.growth).toEqual({ seoKeywords: 1000, seoCreditCents: 4000 });
    expect(SEO_GRANDFATHERED_LIMITS.agency).toEqual(SEO_PLAN_LIMITS.agency);
    // The kept numbers are never below what the plan publishes, so the overlay only ever raises.
    for (const key of PLAN_KEYS) {
      expect(SEO_GRANDFATHERED_LIMITS[key].seoKeywords).toBeGreaterThanOrEqual(SEO_PLAN_LIMITS[key].seoKeywords);
      expect(SEO_GRANDFATHERED_LIMITS[key].seoCreditCents).toBeGreaterThanOrEqual(SEO_PLAN_LIMITS[key].seoCreditCents);
    }
  });
  it("never shrink going up the ladder (so raiseHint always finds a bigger plan below the top)", () => {
    for (let i = 1; i < PLAN_KEYS.length; i++) {
      const lower = PLANS[PLAN_KEYS[i - 1]].limits, upper = PLANS[PLAN_KEYS[i]].limits;
      expect(upper.seoKeywords).toBeGreaterThanOrEqual(lower.seoKeywords);
      expect(upper.seoCreditCents).toBeGreaterThanOrEqual(lower.seoCreditCents);
    }
  });
  it("the gate is the keyword allowance: Agency passes, the other plans do not, Site Scans alone no longer open the tools", () => {
    for (const key of PLAN_KEYS) expect(seoAllowanceTest(PLANS[key].limits), key).toBe(key === "agency");
    // Starter has Site Scans and still no SEO tools.
    expect(PLANS.starter.limits.siteScans).toBeGreaterThan(0);
    expect(seoAllowanceTest(PLANS.starter.limits)).toBe(false);
    // A grandfathered overlay (50 keywords) or a platform admin's unlimited (-1) passes.
    expect(seoAllowanceTest({ ...PLANS.starter.limits, seoKeywords: 50 })).toBe(true);
    expect(seoAllowanceTest({ ...PLANS.starter.limits, seoKeywords: UNLIMITED })).toBe(true);
  });
  it("the plans without the tools say so in one plain line that names Agency and no price or count", () => {
    for (const key of ["starter", "pro", "growth"] as const) {
      expect(PLANS[key].notIncluded, key).toContain(SEO_NOT_INCLUDED_LINE);
      expect(PLANS[key].features.some((f) => /\bSEO\b/.test(f)), key).toBe(false);
    }
    expect(PLANS.agency.notIncluded).not.toContain(SEO_NOT_INCLUDED_LINE);
    expect(PLANS.agency.features.some((f) => /^SEO tools:/.test(f))).toBe(true);
    expect(SEO_NOT_INCLUDED_LINE).toMatch(/Agency/);
    expect(SEO_NOT_INCLUDED_LINE).not.toMatch(/\$|\d/);
  });
});

describe("tracked-keyword count limit", () => {
  it("fits while used + adding stays under the plan; unlimited always fits; no plan never fits", () => {
    expect(keywordsFit({ seoKeywords: 50 }, 0, 50)).toBe(true);
    expect(keywordsFit({ seoKeywords: 50 }, 49, 1)).toBe(true);
    expect(keywordsFit({ seoKeywords: 50 }, 49, 2)).toBe(false);
    expect(keywordsFit({ seoKeywords: 50 }, 50, 1)).toBe(false);
    expect(keywordsFit({ seoKeywords: UNLIMITED }, 100_000, 500)).toBe(true);
    expect(keywordsFit({ seoKeywords: 0 }, 0, 1)).toBe(false);
    expect(keywordsFit(null, 0, 1)).toBe(false);
  });
});

describe("white-label copy", () => {
  it("the customer-facing 'not ready' note names no vendor, price or env variable; the env list is admin-only", () => {
    expect(SEO_NOT_READY_MESSAGE).toBe("Rank tracking is being switched on for your account — check back shortly.");
    expect(SEO_NOT_READY_MESSAGE).not.toMatch(/DataForSEO|\$|DATAFORSEO/);
    expect(SEO_ENV_VARS).toEqual(["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "SEO_MONTHLY_BUDGET_USD"]);
  });
});
