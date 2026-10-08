import { describe, expect, it } from "vitest";
import { mergeWindows } from "./gsc-breakdown";

describe("Search Console by page or search", () => {
  it("the two windows merged: a key one window did not return is null there (not returned), never 0", () => {
    const cur = [{ key: "/a", clicks: 10, impressions: 100, position: 4.2 }, { key: "/new", clicks: 3, impressions: 9, position: 8 }];
    const prev = [{ key: "/a", clicks: 6, impressions: 80, position: 5 }, { key: "/gone", clicks: 7, impressions: 50, position: 6 }];
    const full = mergeWindows(cur, prev);
    expect(full.find((r) => r.key === "/new")).toMatchObject({ prevClicks: null, prevImpressions: null });
    expect(full.find((r) => r.key === "/gone")).toMatchObject({ clicks: null, prevClicks: 7 });
  });
});
