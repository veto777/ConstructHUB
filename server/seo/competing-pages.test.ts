import { describe, expect, it } from "vitest";
import { findCompeting, samePageKey, type CompetingCheck } from "./competing-pages";

const c = (keywordId: number, checkedOn: string, url: string | null, position: number | null = 8, device = "desktop", volume: number | null = 100): CompetingCheck => ({ keywordId, keyword: `kw${keywordId}`, volume, device, checkedOn, position, url });
describe("pages competing for the same search", () => {
  it("one page, however its address is written", () => {
    expect(samePageKey("http://www.alpine.example/roofing/")).toBe(samePageKey("https://alpine.example/roofing#quote"));
    expect(samePageKey("https://alpine.example/Roofing")).not.toBe(samePageKey("https://alpine.example/roofing"));
    expect(samePageKey("https://alpine.example/p?id=1")).not.toBe(samePageKey("https://alpine.example/p?id=2"));
    expect(samePageKey("https://alpine.example")).toBe("alpine.example/");
    expect(samePageKey("not a url")).toBeNull();
  });
  it("back and forth between two pages is competing; one change is only a change; one page is nothing", () => {
    const out = findCompeting([
      // 1: A, B, A, B — alternating, three switches
      c(1, "2026-09-01", "https://a.example/roofing", 9), c(1, "2026-09-08", "https://a.example/roof-repair", 12), c(1, "2026-09-15", "https://a.example/roofing/", 7), c(1, "2026-09-22", "https://a.example/roof-repair", 11),
      // 2: A, A, B — changed once
      c(2, "2026-09-01", "https://a.example/siding"), c(2, "2026-09-08", "https://a.example/siding"), c(2, "2026-09-15", "https://a.example/siding-new"),
      // 3: the same page throughout, written three ways
      c(3, "2026-09-01", "http://a.example/windows"), c(3, "2026-09-08", "https://www.a.example/windows/"), c(3, "2026-09-15", "https://a.example/windows"),
      // 4: ranked once, then not at all — a check without a rank says nothing about which page
      c(4, "2026-09-01", "https://a.example/gutters"), c(4, "2026-09-08", null, null), c(4, "2026-09-15", "https://a.example/other", null),
    ]);
    expect(out.map((k) => [k.keywordId, k.kind, k.switches, k.checks])).toEqual([[1, "alternating", 3, 4], [2, "changed", 1, 3]]);
    expect(out[0].pages).toEqual([
      { url: "https://a.example/roof-repair", times: 2, best: 11, lastSeen: "2026-09-22", lastPosition: 11 },
      { url: "https://a.example/roofing/", times: 2, best: 7, lastSeen: "2026-09-15", lastPosition: 7 },
    ]);
  });
  it("three pages in a row without going back is not called alternating; one line per keyword across devices", () => {
    const out = findCompeting([
      c(5, "2026-09-01", "https://a.example/a"), c(5, "2026-09-08", "https://a.example/b"), c(5, "2026-09-15", "https://a.example/c"),
      c(6, "2026-09-01", "https://a.example/x", 5, "desktop"), c(6, "2026-09-08", "https://a.example/y", 5, "desktop"),
      c(6, "2026-09-01", "https://a.example/x", 5, "mobile"), c(6, "2026-09-08", "https://a.example/y", 5, "mobile"), c(6, "2026-09-15", "https://a.example/x", 5, "mobile"),
    ]);
    expect(out.map((k) => [k.keywordId, k.kind, k.device, k.switches])).toEqual([[6, "alternating", "mobile", 2], [5, "changed", "desktop", 2]]);
  });
});
