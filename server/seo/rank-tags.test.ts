import { describe, expect, it } from "vitest";
import { tagOverview } from "./rank-tags";

describe("rank tracker by tag", () => {
  const kws = [
    { id: 1, tags: ["roofing", "bellingham"], volume: 100 },
    { id: 2, tags: ["roofing"], volume: 100 },
    { id: 3, tags: ["siding"], volume: 100 },
    { id: 4, tags: [], volume: 100 },
    { id: 5, tags: ["roofing"], volume: 100 },   // added since the check before
  ];
  const now = new Map<number, number | null>([[1, 2], [2, 8], [3, null], [4, 30], [5, 1]]);
  const before = new Map<number, number | null>([[1, 5], [2, 12], [3, 4], [4, 30]]);
  const { all, rows } = tagOverview(kws, now, before);
  const roofing = rows.find((r) => r.tag === "roofing")!;
  it("each tag's newest figures, from its own keywords", () => {
    expect(rows.map((r) => r.tag)).toEqual(["bellingham", "roofing", "siding", null]);
    expect([roofing.keywords, roofing.checked, roofing.ranked, roofing.top3, roofing.top10]).toEqual([3, 3, 3, 2, 3]);
    expect(all.keywords).toBe(5);
  });
  it("changes only on the keywords checked both times; one added since is counted apart, never a gain", () => {
    expect([roofing.compared, roofing.newSince, roofing.top10Change]).toEqual([2, 1, 1]);
    expect([roofing.positionNow, roofing.positionBefore, roofing.rankedBoth]).toEqual([5, 8.5, 2]);
    const siding = rows.find((r) => r.tag === "siding")!;
    expect([siding.top10Change, siding.rankedBoth, siding.positionNow]).toEqual([-1, 0, null]);
    expect(siding.visibilityChange! < 0).toBe(true);
  });
  it("with no check before, nothing is called a change", () => {
    const one = tagOverview(kws, now, null).rows.find((r) => r.tag === "roofing")!;
    expect([one.compared, one.visibilityChange, one.top10Change, one.newSince, one.positionBefore]).toEqual([0, null, null, 0, null]);
  });
  it("a keyword not in the newest check is not counted as unranked", () => {
    const partial = tagOverview(kws, new Map([[1, 3]]), before).rows.find((r) => r.tag === "roofing")!;
    expect([partial.keywords, partial.checked, partial.ranked]).toEqual([3, 1, 1]);
  });
  it("the weighting is said separately for the figure and for the change", () => {
    const mixed = tagOverview([{ id: 1, tags: ["t"], volume: 100 }, { id: 2, tags: ["t"], volume: null }], new Map([[1, 2], [2, 5]]), new Map([[1, 4]])).rows[0];
    expect([mixed.weighted, mixed.changeWeighted]).toEqual([false, true]);
  });
});
