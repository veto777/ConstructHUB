import { describe, expect, it } from "vitest";
import { aliasKey, findCompeting, strictPageKey, type CompetingCheck } from "./competing-pages";

const c = (keywordId: number, checkedOn: string, url: string | null, position: number | null = 8, device = "desktop", volume: number | null = 100): CompetingCheck => ({ keywordId, keyword: `kw${keywordId}`, volume, location: keywordId === 1 ? "Bellingham,Washington,United States" : null, device, checkedOn, position, url });
describe("the page Google shows for a search", () => {
  it("a page is its address; click-tracking parameters are not part of it; look-alike addresses are told apart, not merged", () => {
    expect(strictPageKey("https://alpine.example/roofing?srsltid=abc&utm_source=x#quote")).toBe("https://alpine.example/roofing");
    expect(strictPageKey("https://alpine.example/p?id=1&gclid=z")).toBe("https://alpine.example/p?id=1");
    expect(strictPageKey("https://alpine.example/roofing")).not.toBe(strictPageKey("https://alpine.example/roofing/"));
    expect(strictPageKey("not a url")).toBeNull();
    // The alias key only says "these are probably one page" — they are then reported as such, never dropped.
    expect(aliasKey("http://www.alpine.example/roofing/")).toBe(aliasKey("https://alpine.example/roofing#quote"));
    expect(aliasKey("https://alpine.example/Roofing")).not.toBe(aliasKey("https://alpine.example/roofing"));
    expect(aliasKey("https://alpine.example/p?id=1")).not.toBe(aliasKey("https://alpine.example/p?id=2"));
    expect(aliasKey("https://alpine.example:8443/roofing")).not.toBe(aliasKey("https://alpine.example/roofing"));
  });
  it("back and forth between two pages, one change, one page under two addresses, and nothing", () => {
    const { items, comparable } = findCompeting([
      // 1: A, B, A, B — alternating, three switches; then a check where it did not rank
      c(1, "2026-09-01", "https://a.example/roofing", 9), c(1, "2026-09-08", "https://a.example/roof-repair", 12), c(1, "2026-09-15", "https://a.example/roofing", 7), c(1, "2026-09-22", "https://a.example/roof-repair?srsltid=q", 11), c(1, "2026-09-29", null, null),
      // 2: A, A, B — changed once
      c(2, "2026-09-01", "https://a.example/siding"), c(2, "2026-09-08", "https://a.example/siding"), c(2, "2026-09-15", "https://a.example/siding-new"),
      // 3: one page, written three ways — reported as that, not hidden and not called competing
      c(3, "2026-09-01", "http://a.example/windows"), c(3, "2026-09-08", "https://www.a.example/windows/"), c(3, "2026-09-15", "https://a.example/windows"),
      // 4: ranked once only — nothing to compare, so nothing is said either way
      c(4, "2026-09-01", "https://a.example/gutters"), c(4, "2026-09-08", null, null), c(4, "2026-09-15", "https://a.example/other", null),
      // 5: the same address every time
      c(5, "2026-09-01", "https://a.example/doors"), c(5, "2026-09-08", "https://a.example/doors"),
    ]);
    expect(comparable).toBe(4);
    expect(items.map((k) => [k.keywordId, k.kind, k.switches, k.checks])).toEqual([[1, "alternating", 3, 4], [2, "changed", 1, 3], [3, "aliases", 0, 3]]);
    expect(items[0]).toMatchObject({ location: "Bellingham,Washington,United States", firstRanked: "2026-09-01", lastRanked: "2026-09-22", lastCheck: "2026-09-29" });
    expect(items[0].pages).toEqual([
      { url: "https://a.example/roof-repair", times: 2, best: 11, lastSeen: "2026-09-22", lastPosition: 11 },
      { url: "https://a.example/roofing", times: 2, best: 7, lastSeen: "2026-09-15", lastPosition: 7 },
    ]);
    expect(items[2].pages).toEqual([{ url: "https://a.example/windows", times: 3, best: 8, lastSeen: "2026-09-15", lastPosition: 8, alsoAs: ["http://a.example/windows", "https://www.a.example/windows/"] }]);
  });
  it("three pages in a row without going back is not alternating; one line per keyword, chosen the same way every time", () => {
    const rows = [
      c(5, "2026-09-01", "https://a.example/a"), c(5, "2026-09-08", "https://a.example/b"), c(5, "2026-09-15", "https://a.example/c"),
      c(6, "2026-09-01", "https://a.example/x", 5, "desktop"), c(6, "2026-09-08", "https://a.example/y", 5, "desktop"),
      c(6, "2026-09-01", "https://a.example/x", 5, "mobile"), c(6, "2026-09-08", "https://a.example/y", 5, "mobile"), c(6, "2026-09-15", "https://a.example/x", 5, "mobile"),
      // 7: the same on both devices — desktop is the line, whichever came first
      c(7, "2026-09-01", "https://a.example/m", 5, "mobile"), c(7, "2026-09-08", "https://a.example/n", 5, "mobile"),
      c(7, "2026-09-01", "https://a.example/m", 5, "desktop"), c(7, "2026-09-08", "https://a.example/n", 5, "desktop"),
    ];
    const want = [[6, "alternating", "mobile", 2], [5, "changed", "desktop", 2], [7, "changed", "desktop", 1]];
    expect(findCompeting(rows).items.map((k) => [k.keywordId, k.kind, k.device, k.switches])).toEqual(want);
    expect(findCompeting([...rows].reverse()).items.map((k) => [k.keywordId, k.kind, k.device, k.switches])).toEqual(want);
  });
});
