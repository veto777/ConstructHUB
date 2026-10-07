import { describe, expect, it } from "vitest";
import { budgetDecision, monthlyBudgetUsd, DEFAULT_MONTHLY_BUDGET_USD, monthKey } from "./budget";

describe("monthly SEO data budget", () => {
  it("defaults to $25 and reads SEO_MONTHLY_BUDGET_USD", () => {
    expect(monthlyBudgetUsd({})).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(monthlyBudgetUsd({ SEO_MONTHLY_BUDGET_USD: "40" })).toBe(40);
    expect(monthlyBudgetUsd({ SEO_MONTHLY_BUDGET_USD: "0" })).toBe(0);
    expect(monthlyBudgetUsd({ SEO_MONTHLY_BUDGET_USD: "lots" })).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(monthlyBudgetUsd({ SEO_MONTHLY_BUDGET_USD: "-5" })).toBe(DEFAULT_MONTHLY_BUDGET_USD);
  });
  it("allows a call whose whole estimate fits under the cap", () => {
    expect(budgetDecision(0, 0.24, 25)).toEqual({ ok: true, remainingUsd: 24.76 });
    expect(budgetDecision(24.76, 0.24, 25)).toEqual({ ok: true, remainingUsd: 0 });
  });
  it("refuses a call that would cross the cap, with a clear message", () => {
    const d = budgetDecision(24.9, 0.24, 25);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.remainingUsd).toBeCloseTo(0.1, 9);
    expect(d.message).toContain("about $0.24 of DataForSEO data");
    expect(d.message).toContain("$25.00 monthly SEO data budget");
    expect(d.message).toContain("SEO_MONTHLY_BUDGET_USD");
  });
  it("a zero cap refuses everything; overspend never goes negative", () => {
    expect(budgetDecision(0, 0.0006, 0).ok).toBe(false);
    expect(budgetDecision(30, 0.0006, 25)).toMatchObject({ ok: false, remainingUsd: 0 });
  });
  it("months are UTC YYYY-MM", () => {
    expect(monthKey(new Date("2026-10-07T03:00:00Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});
