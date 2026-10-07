import { describe, expect, it } from "vitest";
import { budgetDecision, monthlyBudgetUsd, DEFAULT_MONTHLY_BUDGET_USD, BUDGET_PAUSED_MESSAGE, monthKey } from "./budget";

describe("monthly SEO data budget (internal safety cap)", () => {
  it("defaults to $100 and reads SEO_MONTHLY_BUDGET_USD", () => {
    expect(DEFAULT_MONTHLY_BUDGET_USD).toBe(100);
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
  it("refuses a call that would cross the cap: a neutral message for the customer, the dollars in `detail`", () => {
    const d = budgetDecision(24.9, 0.24, 25);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.remainingUsd).toBeCloseTo(0.1, 9);
    // White-label: nothing a customer reads names the vendor, a dollar figure or an env variable.
    expect(d.message).toBe(BUDGET_PAUSED_MESSAGE);
    expect(d.message).not.toMatch(/DataForSEO|\$|SEO_MONTHLY_BUDGET_USD/);
    expect(d.detail).toContain("about $0.24 of DataForSEO data");
    expect(d.detail).toContain("$25.00 monthly cap");
    expect(d.detail).toContain("SEO_MONTHLY_BUDGET_USD");
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
