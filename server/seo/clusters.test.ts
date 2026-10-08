import { describe, expect, it } from "vitest";
import { clusterKeywords, CLUSTER_MAX } from "@shared/seo-clusters";

const kw = (keyword: string, volume: number | null = 100) => ({ keyword, volume });
describe("keywords grouped by shared words", () => {
  it("groups by the words most keywords share, two words in a row before one, and leaves the rest ungrouped", () => {
    const out = clusterKeywords([
      kw("roof repair cost", 500), kw("roof repair near me", 900), kw("emergency roof repairs", 200),
      kw("metal roofing prices", 300), kw("metal roofing vs shingles", 150),
      kw("gutter cleaning", 50), kw("siding contractor", null),
    ]);
    expect(out.map((c) => [c.term, c.rows.length, c.volume])).toEqual([["roof repair", 3, 1600], ["metal roofing", 2, 450], [null, 2, 50]]);
    // Plural and singular are one word; every keyword is in exactly one group.
    expect(out[0].rows.map((r) => r.keyword)).toContain("emergency roof repairs");
    expect(out.flatMap((c) => c.rows)).toHaveLength(7);
  });
  it("skips the word that is in nearly every keyword, and never invents a volume", () => {
    const out = clusterKeywords([kw("siding cost", null), kw("siding cost per square foot", null), kw("vinyl siding colors", null), kw("vinyl siding installation", null), kw("siding repair", null), kw("siding repair near me", null)]);
    expect(out.map((c) => c.term).sort()).toEqual(["siding cost", "siding repair", "vinyl siding"]);
    expect(out.every((c) => c.volume === null)).toBe(true);
  });
  it("is the same every time, makes no group of one, and stops at the limit", () => {
    const rows = [kw("alpha one"), kw("beta two"), kw("gamma three")];
    expect(clusterKeywords(rows)).toEqual([{ term: null, rows, volume: 300 }]);
    const many = Array.from({ length: 300 }, (_, i) => kw(`topic${Math.floor(i / 2)} word${i}`));
    const a = clusterKeywords(many), b = clusterKeywords([...many]);
    expect(a.map((c) => c.term)).toEqual(b.map((c) => c.term));
    expect(a.filter((c) => c.term !== null)).toHaveLength(CLUSTER_MAX);
    expect(a.flatMap((c) => c.rows)).toHaveLength(300);
    expect(clusterKeywords([])).toEqual([]);
  });
});
