import { describe, expect, it } from "vitest";
import { PLANS, PLAN_KEYS, SEO_PLAN_LIMITS, UNLIMITED } from "@shared/plans";
import { keywordsFit, seoAllowanceTest, SEO_ENV_VARS, SEO_NOT_READY_MESSAGE } from "./plan";

describe("ConstructHUB SEO plan units (shared/plans.ts SEO_PLAN_LIMITS — owner to confirm)", () => {
  it("every plan carries the three SEO limits from the one table", () => {
    for (const key of PLAN_KEYS) {
      const l = PLANS[key].limits;
      expect(l.seoKeywords).toBe(SEO_PLAN_LIMITS[key].seoKeywords);
      expect(l.seoResearch).toBe(SEO_PLAN_LIMITS[key].seoResearch);
      expect(l.seoBacklinkRefreshes).toBe(SEO_PLAN_LIMITS[key].seoBacklinkRefreshes);
    }
  });
  it("the defaults: Starter 50 / 25 / 1, Pro 200 / 100 / 4, Growth and Agency 1,000 / 500 / 12", () => {
    expect(SEO_PLAN_LIMITS.starter).toEqual({ seoKeywords: 50, seoResearch: 25, seoBacklinkRefreshes: 1 });
    expect(SEO_PLAN_LIMITS.pro).toEqual({ seoKeywords: 200, seoResearch: 100, seoBacklinkRefreshes: 4 });
    expect(SEO_PLAN_LIMITS.growth).toEqual({ seoKeywords: 1000, seoResearch: 500, seoBacklinkRefreshes: 12 });
    expect(SEO_PLAN_LIMITS.agency).toEqual(SEO_PLAN_LIMITS.growth);
  });
  it("never shrink going up the ladder (so raiseHint always finds a bigger plan below the top)", () => {
    for (let i = 1; i < PLAN_KEYS.length; i++) {
      const lower = PLANS[PLAN_KEYS[i - 1]].limits, upper = PLANS[PLAN_KEYS[i]].limits;
      expect(upper.seoKeywords).toBeGreaterThanOrEqual(lower.seoKeywords);
      expect(upper.seoResearch).toBeGreaterThanOrEqual(lower.seoResearch);
      expect(upper.seoBacklinkRefreshes).toBeGreaterThanOrEqual(lower.seoBacklinkRefreshes);
    }
  });
  it("every plan that includes the SEO tools has a keyword allowance, and vice versa", () => {
    for (const key of PLAN_KEYS) expect(seoAllowanceTest(PLANS[key].limits)).toBe(PLANS[key].limits.seoKeywords > 0);
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
