import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COMPETITORS_SUBTITLE, commonPhrasesBadge } from "../client/src/components/competitors/review-signals";
import { emptyCategoryMessage, evidenceSummary, formatBytes, ownLocation } from "../client/src/components/site-scan-helpers";
import competitorsFeature from "../shared/feature-pages/competitors";

const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", p), "utf8");

describe("Competitor Intel copy matches the feature page", () => {
  it("the subtitle names ratings and reviews, not rankings (the feature page rules rankings out)", () => {
    expect(COMPETITORS_SUBTITLE).toMatch(/ratings/i);
    expect(COMPETITORS_SUBTITLE).toMatch(/reviews/i);
    expect(COMPETITORS_SUBTITLE).not.toMatch(/rank/i);
    expect(JSON.stringify(competitorsFeature)).toMatch(/search rankings/);
  });

  it("listing badges say common phrases, never AI", () => {
    expect(commonPhrasesBadge(12)).toBe("12 common phrases");
    expect(commonPhrasesBadge(1)).toBe("1 common phrase");
    const src = read("client/src/pages/competitors.tsx");
    expect(src).not.toMatch(/\} AI\b|>AI</);
    expect(src).not.toMatch(/\bBot\b/);
    expect(src).not.toMatch(/rankings and reviews/);
    expect(src).toContain("description={COMPETITORS_SUBTITLE}");
  });
});

describe("Site Scan fix evidence summary", () => {
  it("summarizes a page fetch as status, title and size", () => {
    const lines = evidenceSummary({
      status: 200, title: "Summit Roofing Co. | Denver Roof Replacement & Repair", description: "Denver roofing.",
      headings: ["Denver roofing, done right the first time"], canonical: "https://summitroofing.example/", noindex: false, htmlBytes: 2732,
    });
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel["Status code"]).toBe("200 (OK)");
    expect(byLabel["Page title"]).toBe("Summit Roofing Co. | Denver Roof Replacement & Repair");
    expect(byLabel["HTML size"]).toBe("2.7 KB");
    expect(byLabel["Indexing"]).toBe("Allowed");
    expect(byLabel["H1"]).toBe("Denver roofing, done right the first time");
  });

  it("handles the other evidence shapes without dumping JSON", () => {
    expect(evidenceSummary({ currentBytes: 1500000, targetBytes: 300000, targetNote: "Optimization budget" }).map((l) => l.value))
      .toEqual(["1.5 MB", "300 KB", "Optimization budget"]);
    expect(evidenceSummary({ images: ["a.png", "b.png"] })[0]).toEqual({ label: "Images without alt text", value: "2 images: a.png, b.png" });
    expect(evidenceSummary({ observed: [], invalidJSON: false, source: "No synced GBP" }).map((l) => l.label)).toEqual(["Structured data found", "Source"]);
    expect(evidenceSummary({ robots: { body: "x" } })).toEqual([{ label: "robots.txt", value: "Read (see technical evidence)" }]);
    for (const l of evidenceSummary({ nested: { a: 1 }, list: [1, 2], flag: true })) expect(l.value).not.toMatch(/[{}]/);
    expect(evidenceSummary(null)).toEqual([]);
    expect(formatBytes(999)).toBe("999 B");
  });

  it("the checklist keeps raw JSON only behind a Technical evidence disclosure", () => {
    const src = read("client/src/components/site-scan-fixes.tsx");
    expect(src).toMatch(/<details>\s*<summary[^>]*>\s*Technical evidence/);
    expect(src.match(/JSON\.stringify\(/g)).toHaveLength(1);
  });
});

describe("Site Scan empty category wording", () => {
  it("says plainly that a category has no findings when every finding is on this page", () => {
    expect(emptyCategoryMessage({ shown: 9, total: 9, offset: 0, searching: false })).toBe("No findings in this category.");
    expect(emptyCategoryMessage({ shown: 0, total: 0, offset: 0, searching: false })).toBe("No findings in this category.");
    expect(emptyCategoryMessage({ shown: 2, total: 2, offset: 0, searching: true })).toMatch(/match your search/);
  });
  it("mentions other pages only when findings continue there", () => {
    expect(emptyCategoryMessage({ shown: 25, total: 40, offset: 0, searching: false })).toMatch(/this page/);
    expect(emptyCategoryMessage({ shown: 15, total: 40, offset: 25, searching: false })).toMatch(/other pages/);
  });
});

describe("Site Scan form defaults", () => {
  const locations = [
    { id: 92003, business_name: "Clearpeak Exteriors", website: "https://clearpeakexteriors.example" },
    { id: 910001, business_name: "Summit Roofing Co.", website: "https://summitroofing.example" },
  ];
  it("opens on the account's own location, not the first client location", () => {
    expect(ownLocation(locations, "Summit Roofing Co.")?.id).toBe(910001);
    expect(ownLocation(locations, "summit roofing co")?.id).toBe(910001);
  });
  it("opens empty when the account has no own location", () => {
    expect(ownLocation(locations, "Someone Else LLC")).toBeNull();
    expect(ownLocation(locations, null)).toBeNull();
    expect(ownLocation(undefined, "Summit Roofing Co.")).toBeNull();
  });
  it("shows the monthly rescan as a toggle with its state, scores before report actions", () => {
    const src = read("client/src/pages/site-scan.tsx");
    expect(src).not.toContain("Disable monthly rescan");
    expect(src).toContain("<Switch");
    expect(src).not.toMatch(/data\.locations\[0\]/);
    const report = src.slice(src.indexOf("export function ScanReport"), src.indexOf("export default function SiteScanPage"));
    expect(report.indexOf("report.scores.overall")).toBeLessThan(report.indexOf("{actions}"));
    expect(report.indexOf("{actions}")).toBeLessThan(report.indexOf("emptyCategoryMessage("));
  });
});

describe("feature-shot sample data", () => {
  it("has no doubled company suffix", () => {
    expect(read("script/feature-shots/seed/30-ads.sql")).not.toContain("Co. Co.");
  });
  it("keeps one competitor scan in the current month and seeds the monthly meter from the scan rows", () => {
    const sql = read("script/feature-shots/seed/10-gbp.sql");
    expect(sql).toMatch(/greatest\(now\(\) - interval '3 days', \(date_trunc\('month'/);
    expect(sql).toContain("'quota:user:1:competitorScans:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')");
  });
});
