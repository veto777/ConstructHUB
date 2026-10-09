import { describe, expect, it } from "vitest";
import { PLANS, PLAN_KEYS, SEO_PLAN_LIMITS, SEO_GRANDFATHERED_LIMITS, SEO_NOT_INCLUDED_LINE, UNLIMITED } from "@shared/plans";
import { keywordsFit, seoAllowanceTest, SEO_ENV_VARS, SEO_NOT_READY_MESSAGE } from "./plan";

describe("ConstructHUB SEO plan units (shared/plans.ts SEO_PLAN_LIMITS — a taste on Agency, the suite on Unlimited, owner 2026-10-09)", () => {
  it("every plan carries the SEO limits from the one table", () => {
    for (const key of PLAN_KEYS) {
      const l = PLANS[key].limits;
      expect(l.seoKeywords).toBe(SEO_PLAN_LIMITS[key].seoKeywords);
      expect(l.seoCreditCents).toBe(SEO_PLAN_LIMITS[key].seoCreditCents);
    }
  });
  it("Unlimited: 5,000 tracked keywords and $60 of SEO data a month; Agency ($199): a 250-keyword taste with $10; Solo, Team and Pro: none", () => {
    expect(SEO_PLAN_LIMITS.starter).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.team).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.pro).toEqual({ seoKeywords: 0, seoCreditCents: 0 });
    expect(SEO_PLAN_LIMITS.growth).toEqual({ seoKeywords: 250, seoCreditCents: 1000 });
    expect(SEO_PLAN_LIMITS.agency).toEqual({ seoKeywords: 5000, seoCreditCents: 6000 });
  });
  it("a grandfathered account keeps what its plan had before: 50 / $10, 200 / $20, 1,000 / $40 — and the overlay only ever raises", () => {
    expect(SEO_GRANDFATHERED_LIMITS.starter).toEqual({ seoKeywords: 50, seoCreditCents: 1000 });
    expect(SEO_GRANDFATHERED_LIMITS.team).toEqual({ seoKeywords: 50, seoCreditCents: 1000 });
    expect(SEO_GRANDFATHERED_LIMITS.pro).toEqual({ seoKeywords: 200, seoCreditCents: 2000 });
    expect(SEO_GRANDFATHERED_LIMITS.growth).toEqual({ seoKeywords: 1000, seoCreditCents: 4000 });
    expect(SEO_GRANDFATHERED_LIMITS.agency).toEqual({ seoKeywords: 1000, seoCreditCents: 4000 });
    // The overlay only ever raises: the effective allowance (the larger of the published and the
    // kept numbers) is never below either one. Growth's kept 1,000 / $40 raises its published
    // 250 / $10; Unlimited's published 5,000 / $60 is above the kept 1,000 / $40, so it stays.
    for (const key of PLAN_KEYS) {
      const published = SEO_PLAN_LIMITS[key], kept = SEO_GRANDFATHERED_LIMITS[key];
      expect(Math.max(published.seoKeywords, kept.seoKeywords), key).toBeGreaterThanOrEqual(published.seoKeywords);
      expect(Math.max(published.seoKeywords, kept.seoKeywords), key).toBeGreaterThanOrEqual(kept.seoKeywords);
      expect(Math.max(published.seoCreditCents, kept.seoCreditCents), key).toBeGreaterThanOrEqual(published.seoCreditCents);
      expect(Math.max(published.seoCreditCents, kept.seoCreditCents), key).toBeGreaterThanOrEqual(kept.seoCreditCents);
    }
    expect(Math.max(SEO_PLAN_LIMITS.growth.seoKeywords, SEO_GRANDFATHERED_LIMITS.growth.seoKeywords)).toBe(1000);
    expect(Math.max(SEO_PLAN_LIMITS.growth.seoCreditCents, SEO_GRANDFATHERED_LIMITS.growth.seoCreditCents)).toBe(4000);
    expect(Math.max(SEO_PLAN_LIMITS.agency.seoKeywords, SEO_GRANDFATHERED_LIMITS.agency.seoKeywords)).toBe(5000);
    expect(Math.max(SEO_PLAN_LIMITS.agency.seoCreditCents, SEO_GRANDFATHERED_LIMITS.agency.seoCreditCents)).toBe(6000);
  });
  it("never shrink going up the ladder (so raiseHint always finds a bigger plan below the top)", () => {
    for (let i = 1; i < PLAN_KEYS.length; i++) {
      const lower = PLANS[PLAN_KEYS[i - 1]].limits, upper = PLANS[PLAN_KEYS[i]].limits;
      expect(upper.seoKeywords).toBeGreaterThanOrEqual(lower.seoKeywords);
      expect(upper.seoCreditCents).toBeGreaterThanOrEqual(lower.seoCreditCents);
    }
  });
  it("the gate is the keyword allowance: Agency and Unlimited pass, the plans below Agency do not, Site Scans alone no longer open the tools", () => {
    for (const key of PLAN_KEYS) expect(seoAllowanceTest(PLANS[key].limits), key).toBe(key === "growth" || key === "agency");
    // Starter has Site Scans and still no SEO tools.
    expect(PLANS.starter.limits.siteScans).toBeGreaterThan(0);
    expect(seoAllowanceTest(PLANS.starter.limits)).toBe(false);
    // A grandfathered overlay (50 keywords) or a platform admin's unlimited (-1) passes.
    expect(seoAllowanceTest({ ...PLANS.starter.limits, seoKeywords: 50 })).toBe(true);
    expect(seoAllowanceTest({ ...PLANS.starter.limits, seoKeywords: UNLIMITED })).toBe(true);
  });
  it("the plans without the tools say so in one plain line that names Unlimited; the plans with them carry an SEO bullet", () => {
    for (const key of ["starter", "team", "pro"] as const) {
      expect(PLANS[key].notIncluded, key).toContain(SEO_NOT_INCLUDED_LINE);
      expect(PLANS[key].features.some((f) => /\bSEO\b/.test(f)), key).toBe(false);
    }
    // Agency ($199) has the taste and Unlimited the suite: neither carries the "not included" line, both an SEO bullet.
    expect(PLANS.growth.notIncluded).not.toContain(SEO_NOT_INCLUDED_LINE);
    expect(PLANS.growth.features.some((f) => /\bSEO\b/.test(f))).toBe(true);
    expect(PLANS.agency.notIncluded).not.toContain(SEO_NOT_INCLUDED_LINE);
    expect(PLANS.agency.features.some((f) => /\bSEO\b/.test(f))).toBe(true);
    expect(SEO_NOT_INCLUDED_LINE).toMatch(/Unlimited/);
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
