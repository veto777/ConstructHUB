import { describe, expect, it } from "vitest";
import { clickShare, CLICK_SHARE, keywordSeries, summarizeChecks } from "./rank-history";

const row = (keywordId: number, checkedOn: string, position: number | null, volume: number | null = null) => ({ keywordId, checkedOn, position, volume });

describe("clickShare", () => {
  it("is zero outside the first page and for unranked", () => {
    expect(clickShare(1)).toBe(CLICK_SHARE[0]);
    expect(clickShare(10)).toBe(CLICK_SHARE[9]);
    expect(clickShare(11)).toBe(0);
    expect(clickShare(null)).toBe(0);
    expect(clickShare(0)).toBe(0);
  });
});

describe("summarizeChecks", () => {
  it("buckets positions per date, oldest first", () => {
    const days = summarizeChecks([row(1, "2026-10-08", 2), row(1, "2026-10-01", 12), row(2, "2026-10-01", null), row(2, "2026-10-08", 7), row(3, "2026-10-08", 45)]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(days[0]).toMatchObject({ checked: 2, ranked: 1, top3: 0, top10: 0, top20: 1, top100: 0, notRanked: 1, averagePosition: 12, visibility: 0 });
    expect(days[1]).toMatchObject({ checked: 3, ranked: 3, top3: 1, top10: 1, top20: 0, top100: 1, notRanked: 0, averagePosition: 18 });
  });
  it("every keyword at position 1 is 100% visibility", () => {
    expect(summarizeChecks([row(1, "d", 1), row(2, "d", 1)])[0].visibility).toBe(100);
  });
  it("counts each keyword once unless all have volume", () => {
    // equal weights: (share(1) + 0) / 2 / share(1) = 50%
    expect(summarizeChecks([row(1, "d", 1, 900), row(2, "d", null, null)])[0].visibility).toBe(50);
    // weighted: the 900-volume keyword at #1, the 100-volume one unranked = 90%
    expect(summarizeChecks([row(1, "d", 1, 900), row(2, "d", null, 100)])[0].visibility).toBe(90);
  });
  it("has no average when nothing ranks and handles no rows", () => {
    expect(summarizeChecks([row(1, "d", null)])[0].averagePosition).toBeNull();
    expect(summarizeChecks([])).toEqual([]);
  });
});

describe("keywordSeries", () => {
  it("puts both devices on one row per date", () => {
    expect(keywordSeries([
      { checkedOn: "2026-10-08", device: "mobile", position: 5, url: "m" },
      { checkedOn: "2026-10-01", device: "desktop", position: 9, url: "a" },
      { checkedOn: "2026-10-08", device: "desktop", position: 4, url: "b" },
    ])).toEqual([
      { date: "2026-10-01", desktop: 9, mobile: null, url: "a", checked: { desktop: true, mobile: false } },
      { date: "2026-10-08", desktop: 4, mobile: 5, url: "b", checked: { desktop: true, mobile: true } },
    ]);
  });
});
