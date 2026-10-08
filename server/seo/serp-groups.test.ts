import { describe, expect, it } from "vitest";
import { groupBySerp, SERP_SHARED, type SerpCheck } from "./serp-groups";

const page = (...paths: string[]) => paths.map((p, i) => ({ position: i + 1, domain: "x.example", url: `https://${p}` }));
const ten = (prefix: string, shared: string[] = []) => page(...shared, ...Array.from({ length: 10 - shared.length }, (_, i) => `${prefix}.example/p${i}`));
const A = Array.from({ length: 10 }, (_, i) => `roof.example/r${i}`);
const k = (keywordId: number, keyword: string, volume: number | null, serpTop: unknown, o: Partial<SerpCheck> = {}): SerpCheck => ({ keywordId, keyword, volume, locationCode: 1027744, location: "Bellingham,Washington,United States", position: null, url: null, serpTop, checkedOn: "2026-10-08", ...o });

describe("searches Google answers with the same pages", () => {
  it("groups keywords whose first-page results share enough addresses with the group's first keyword", () => {
    const out = groupBySerp([
      k(1, "roofer bellingham", 300, page(...A), { position: 4, url: "https://alpine.example/roofing" }),
      k(2, "roofing contractor bellingham", 900, page(...A), { position: 6, url: "https://alpine.example/roofing-contractor?srsltid=x" }),
      k(3, "roof repair bellingham", 200, ten("repair", A.slice(0, SERP_SHARED)), { checkedOn: "2026-10-01" }),   // just enough in common, checked a week earlier
      k(4, "gutter cleaning bellingham", 500, ten("gutter", A.slice(0, SERP_SHARED - 1))),                  // one short: its own topic
      k(5, "siding contractor bellingham", null, ten("siding")),
      k(6, "thin results", 100, page("a.example/1", "a.example/2")),                                        // too few saved results to compare
      k(7, "never checked", 100, null),
    ]);
    expect([out.compared, out.skipped, out.shared]).toEqual([5, 2, SERP_SHARED]);
    expect(out.groups).toHaveLength(1);
    const g = out.groups[0];
    // The first keyword is the one with the most searches; the others follow by how much they share with it.
    expect(g.members.map((m) => [m.keywordId, m.shared, m.of])).toEqual([[2, 10, 10], [1, 10, 10], [3, SERP_SHARED, 10]]);
    expect([g.volume, g.measured, g.unranked, g.rankedNoPage]).toEqual([1400, 3, 1, 0]);
    // Each member carries its own day; the group says the span.
    expect([g.from, g.to, g.members.map((m) => m.checkedOn)]).toEqual(["2026-10-01", "2026-10-08", ["2026-10-08", "2026-10-08", "2026-10-01"]]);
    expect(g.ownDistinct).toBe(2);
    // Two different pages of the site rank for what Google treats as one question (click-tracking is not part of an address).
    expect(g.ownPages).toEqual(["https://alpine.example/roofing", "https://alpine.example/roofing-contractor"]);
  });
  it("never compares keywords tracked in different places, and does not chain near-matches into one group", () => {
    const B = [...A.slice(0, 6), ...Array.from({ length: 4 }, (_, i) => `b.example/${i}`)];          // shares 6 with A
    const C = [...B.slice(4, 10), ...Array.from({ length: 4 }, (_, i) => `c.example/${i}`)];        // shares 6 with B, 2 with A
    const out = groupBySerp([
      k(1, "a", 900, page(...A)), k(2, "b", 800, page(...B)), k(3, "c", 700, page(...C)),
      k(4, "a", 900, page(...A), { locationCode: 1027745, location: "Lynden,Washington,United States" }),
    ]);
    // b joins a; c shares enough with b but not with a (the group's first keyword), so it stays out. The Lynden keyword is alone in its place.
    expect(out.groups.map((g) => g.members.map((m) => m.keyword))).toEqual([["a", "b"]]);
    expect(out.groups[0].location).toBe("Bellingham,Washington,United States");
  });
  it("is the same whatever order the checks come in; a partial volume says how many it covers; groups with several own pages come first", () => {
    const rows = [
      k(1, "x one", null, page(...A)), k(2, "x two", 50, page(...A)),
      k(3, "y one", 5000, ten("y"), { position: 3, url: "https://alpine.example/y" }), k(4, "y two", 4000, ten("y"), { position: 5, url: "https://alpine.example/y/" }),
    ];
    const a = groupBySerp(rows), b = groupBySerp([...rows].reverse());
    expect(a).toEqual(b);
    // /y and /y/ are two recorded addresses but may be one page: both are kept, they count once, and the group is not put first as "different pages".
    expect(a.groups.map((g) => [g.members[0].keyword, g.volume, g.measured, g.ownPages.length, g.ownDistinct])).toEqual([["y one", 9000, 2, 2, 1], ["x two", 50, 1, 0, 0]]);
    // Ranked, but the page was not recorded: not the same as not found.
    const np = groupBySerp([k(1, "p one", 10, page(...A), { position: 3, url: null }), k(2, "p two", 5, page(...A))]).groups[0];
    expect([np.unranked, np.rankedNoPage, np.ownPages]).toEqual([1, 1, []]);
    expect(groupBySerp([])).toEqual({ groups: [], compared: 0, skipped: 0, shared: SERP_SHARED });
  });
});
