import { describe, expect, it } from "vitest";
import {
  serpUsd, serpKeywordMultiplier, clampSerpDepth, estimateRankCheckUsd, estimateLabsUsd, estimateAdsVolumeUsd,
  estimateBacklinksUsd, estimateBacklinkSnapshotUsd, projectMonthlyRankTrackingUsd, PRICE_SHEET, SERP_PAGE_USD,
} from "./pricing";

const keywords = (n: number) => Array.from({ length: n }, (_, i) => `keyword ${i + 1}`);

describe("DataForSEO cost estimator (vendor prices, 2026-10-06)", () => {
  it("prices one standard-queue SERP of 10 at $0.0006 and multiplies per page", () => {
    expect(serpUsd(10, "standard")).toBe(0.0006);
    expect(serpUsd(50, "standard")).toBeCloseTo(0.003, 9);
    expect(serpUsd(100, "standard")).toBeCloseTo(0.006, 9);
    expect(serpUsd(10, "priority")).toBe(0.0012);
    expect(serpUsd(10, "live")).toBe(0.002);
  });
  it("clamps depth to 10–100 in pages of 10 (a partial page is a full page)", () => {
    expect(clampSerpDepth(1)).toBe(10);
    expect(clampSerpDepth(15)).toBe(20);
    expect(clampSerpDepth(250)).toBe(100);
    expect(clampSerpDepth(NaN)).toBe(10);
  });
  it("charges 5× for a search operator in the keyword", () => {
    expect(serpKeywordMultiplier("roofing tampa")).toBe(1);
    expect(serpKeywordMultiplier("site:constructhub.us roofing")).toBe(5);
    expect(serpUsd(10, "standard", "intitle:roofing")).toBeCloseTo(0.003, 9);
  });
  it("the report's example: 200 keywords × 2 devices = 400 SERPs = $0.24 a week, $1.04 a month at top-10", () => {
    const run = estimateRankCheckUsd(keywords(200), "both", 10);
    expect(run.serps).toBe(400);
    expect(run.usd).toBeCloseTo(0.24, 9);
    expect(projectMonthlyRankTrackingUsd(keywords(200), "both", 10)).toBeCloseTo(1.0392, 4);
    // top-100: ×10
    expect(estimateRankCheckUsd(keywords(200), "both", 100).usd).toBeCloseTo(2.4, 9);
    // one device halves it
    expect(estimateRankCheckUsd(keywords(200), "mobile", 10).serps).toBe(200);
  });
  it("Labs: $0.012 per task + $0.00012 per item", () => {
    expect(estimateLabsUsd(50)).toBeCloseTo(0.018, 9);
    expect(estimateLabsUsd(1000)).toBeCloseTo(0.132, 9);
    expect(estimateLabsUsd(0)).toBe(0.012);
  });
  it("Google Ads search volume: $0.09 live per task of up to 1,000 keywords ($0.06 standard)", () => {
    expect(estimateAdsVolumeUsd(1)).toBe(0.09);
    expect(estimateAdsVolumeUsd(1000)).toBe(0.09);
    expect(estimateAdsVolumeUsd(1001)).toBe(0.18);
    expect(estimateAdsVolumeUsd(200, "standard")).toBe(0.06);
  });
  it("Backlinks: $0.024 per request + $0.000036 per row = $0.06 per 1,000 rows", () => {
    expect(estimateBacklinksUsd(1000)).toBeCloseTo(0.06, 9);
    expect(estimateBacklinksUsd(1)).toBeCloseTo(0.024036, 9);
    expect(estimateBacklinkSnapshotUsd(100)).toBeCloseTo(0.024036 + 0.0276, 9);
  });
  it("the price sheet quotes only vendor-page figures and the $50 minimum deposit", () => {
    expect(PRICE_SHEET.minimumDepositUsd).toBe(50);
    expect(PRICE_SHEET.fetchedOn).toBe("2026-10-06");
    for (const line of PRICE_SHEET.lines) expect(line.source).toMatch(/^https:\/\/dataforseo\.com\/pricing\//);
    expect(PRICE_SHEET.lines.find((l) => l.what.includes("standard queue"))!.price).toContain(String(SERP_PAGE_USD.standard));
  });
});
