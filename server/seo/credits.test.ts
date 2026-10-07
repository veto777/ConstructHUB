import { describe, it, expect } from "vitest";
import { SEO_MARKUP, SEO_CREDIT_PACKS, isSeoCreditPack, retailCents, splitCharge, creditUsd } from "@shared/seo-credits";
import { PLANS, PLAN_KEYS, SEO_PLAN_LIMITS, seoDataBullet } from "@shared/plans";
import { outOfCreditMessage } from "./credits";
import { SEO_PRICES } from "./routes";
import { EXPLORER_TYPICAL_USD, EXPLORER_ESTIMATE_USD } from "./explorer";

describe("SEO data credit (owner, 2026-10-07)", () => {
  it("every lookup is priced at four times what the data costs us, rounded up to the cent", () => {
    expect(SEO_MARKUP).toBe(4);
    expect(retailCents(0.26)).toBe(104);
    expect(retailCents(0.2529)).toBe(102);
    expect(retailCents(0.018)).toBe(8);
    expect(retailCents(0.0006)).toBe(1);   // never free, never a fraction of a cent
    expect(retailCents(0)).toBe(0);
    expect(retailCents(-1)).toBe(0);
    for (const usd of [0.012, 0.024036, 0.1272, 1, 2.5]) expect(retailCents(usd) / 100).toBeGreaterThanOrEqual(usd * SEO_MARKUP - 1e-9);
  });

  it("plans include $10, $20, $40 and $40 of SEO data a month, and say so in their bullets", () => {
    expect(PLAN_KEYS.map((k) => SEO_PLAN_LIMITS[k].seoCreditCents)).toEqual([1000, 2000, 4000, 4000]);
    for (const key of PLAN_KEYS) {
      expect(PLANS[key].limits.seoCreditCents).toBe(SEO_PLAN_LIMITS[key].seoCreditCents);
      expect(PLANS[key].features).toContain(seoDataBullet(key));
    }
    expect(seoDataBullet("starter")).toBe("SEO data: $10 / month included");
    expect(seoDataBullet("growth")).toBe("SEO data: $40 / month included");
    // $10 at the customer's price is $2.50 of data per Starter subscriber per month.
    expect(SEO_PLAN_LIMITS.starter.seoCreditCents / SEO_MARKUP).toBe(250);
  });

  it("extra credit is sold in prepaid packs of $25, $50 and $100, and nothing else", () => {
    expect(SEO_CREDIT_PACKS).toEqual([2500, 5000, 10000]);
    expect(isSeoCreditPack(5000)).toBe(true);
    for (const bad of [1, 2499, 7500, "5000", null, 0, -2500]) expect(isSeoCreditPack(bad as any), String(bad)).toBe(false);
  });

  it("a charge takes the month's allowance first, then purchased credit, and reports what is short", () => {
    expect(splitCharge(104, 1000, 0)).toEqual({ fromIncluded: 104, fromWallet: 0, short: 0 });
    expect(splitCharge(104, 40, 2500)).toEqual({ fromIncluded: 40, fromWallet: 64, short: 0 });
    expect(splitCharge(104, 0, 2500)).toEqual({ fromIncluded: 0, fromWallet: 104, short: 0 });
    expect(splitCharge(104, 40, 50)).toEqual({ fromIncluded: 40, fromWallet: 50, short: 14 });
    expect(splitCharge(104, 0, 0)).toEqual({ fromIncluded: 0, fromWallet: 0, short: 104 });
    expect(splitCharge(104, -30, 200)).toEqual({ fromIncluded: 0, fromWallet: 104, short: 0 }); // an over-spent allowance is not a debt on the wallet
  });

  it("the price shown before a lookup is the wholesale estimate at the markup", () => {
    expect(SEO_PRICES.explorerReport).toBe(retailCents(EXPLORER_TYPICAL_USD));
    expect(SEO_PRICES.explorerReport).toBe(104);
    expect(SEO_PRICES.keywordResearch).toBe(8);
    expect(SEO_PRICES.competitorGap).toBe(10);
    expect(SEO_PRICES.rankChecksPer100).toBe(24);
    // A Starter allowance covers about nine Site Explorer reports.
    expect(Math.floor(SEO_PLAN_LIMITS.starter.seoCreditCents / SEO_PRICES.explorerReport)).toBe(9);
    // The reservation is never smaller than the price shown.
    expect(retailCents(EXPLORER_ESTIMATE_USD)).toBeGreaterThanOrEqual(SEO_PRICES.explorerReport);
  });

  it("tells a customer who is out of credit what it needs and what they have, in their own dollars", () => {
    const m = outOfCreditMessage(104, 36);
    expect(m).toContain("$1.04");
    expect(m).toContain("$0.36");
    expect(m).not.toMatch(/dataforseo|wholesale|markup/i);
    expect(creditUsd(2500)).toBe("$25.00");
  });
});
