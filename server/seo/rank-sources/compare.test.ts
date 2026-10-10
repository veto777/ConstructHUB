/** The rank-source comparison's pure parts: parsing each source's answer, scoring against the baseline, the report. */
import { describe, expect, it } from "vitest";
import { jaccard, markdownReport, scoreSource } from "./compare";
import { parseCse } from "./google-cse";
import { fromScrape } from "./google-scrape";
import { isOwn, ownIn, uuleFor, type RankObservation } from "./types";

const obs = (p: Partial<RankObservation>): RankObservation => ({ source: "cse", keyword: "k", device: "desktop", place: null, position: null, url: null, top: [], mapPack: null, localPosition: null, features: [], costUsd: 0, ms: 100, ...p });
const top = (...domains: string[]) => domains.map((d, i) => ({ position: i + 1, domain: d, url: `https://${d}/`, title: d }));

describe("types", () => {
  it("knows the site and its sub-domains, and Google's uule", () => {
    expect(isOwn("www.alpineexteriorswa.com", "alpineexteriorswa.com")).toBe(true);
    expect(isOwn("blog.alpineexteriorswa.com", "alpineexteriorswa.com")).toBe(true);
    expect(isOwn("notalpineexteriorswa.com", "alpineexteriorswa.com")).toBe(false);
    expect(ownIn(top("yelp.com", "alpineexteriorswa.com"), "alpineexteriorswa.com")).toEqual({ position: 2, url: "https://alpineexteriorswa.com/" });
    // The value Google echoed back in the office test for Bellingham (length byte 0x23 = 35 characters).
    expect(uuleFor("Bellingham,Washington,United States")).toBe("w+CAIQICII0JlbGxpbmdoYW0sV2FzaGluZ3RvbixVbml0ZWQgU3RhdGVz");
  });
});

describe("parsers", () => {
  it("reads a Custom Search answer into the first ten organic results", () => {
    const json = { items: [{ link: "https://www.yelp.com/x", title: "Yelp" }, { link: "https://alpineexteriorswa.com/", title: "Alpine" }, { link: "nope" }] };
    expect(parseCse(json)).toEqual([{ position: 1, domain: "yelp.com", url: "https://www.yelp.com/x", title: "Yelp" }, { position: 2, domain: "alpineexteriorswa.com", url: "https://alpineexteriorswa.com/", title: "Alpine" }]);
    expect(parseCse({})).toEqual([]);
  });
  it("reads a scraped page: results, map pack, the CAPTCHA wall", () => {
    const raw = { finalUrl: "https://www.google.com/search?q=x", title: "x", text: "People also ask ... AI Overview", mapPack: true,
      links: [{ title: "Maps", href: "https://www.google.com/maps/place/x" }, { title: "Yelp", href: "https://www.yelp.com/a" }, { title: "Alpine", href: "https://alpineexteriorswa.com/siding" }, { title: "Yelp again", href: "https://www.yelp.com/a" }] };
    const out = fromScrape(raw, "alpineexteriorswa.com");
    expect(out.top.map((r) => r.domain)).toEqual(["yelp.com", "alpineexteriorswa.com"]);
    expect(out.position).toBe(2);
    expect(out.mapPack).toBe(true);
    expect(out.features).toEqual(["organic", "local_pack", "people_also_ask", "ai_overview"]);
    expect(fromScrape({ ...raw, finalUrl: "https://www.google.com/sorry/index?continue=x", links: [] }, "a.com").error).toBe("captcha");
    expect(fromScrape({ ...raw, links: [], text: "" }, "a.com").error).toBe("no results parsed");
  });
});

describe("scoring", () => {
  it("measures agreement with the baseline", () => {
    expect(jaccard(top("a.com", "b.com", "c.com"), top("b.com", "c.com", "d.com"))).toBeCloseTo(0.5);
    const pairs = [
      { baseline: obs({ keyword: "k1", position: 3, top: top("a.com", "b.com", "x.com"), mapPack: true }), obs: obs({ keyword: "k1", position: 3, top: top("a.com", "b.com", "x.com"), mapPack: true }) },
      { baseline: obs({ keyword: "k2", position: 5, top: top("a.com"), mapPack: false }), obs: obs({ keyword: "k2", position: 7, top: top("z.com"), mapPack: false }) },
      { baseline: obs({ keyword: "k3", position: null }), obs: obs({ keyword: "k3", position: 9 }) },
      { baseline: obs({ keyword: "k4", position: 1 }), obs: obs({ keyword: "k4", error: "captcha" }) },
    ];
    const s = scoreSource("Test", pairs);
    expect(s.asked).toBe(4); expect(s.answered).toBe(3); expect(s.errors).toEqual({ captcha: 1 });
    expect(s.foundAgree).toBe(2); expect(s.foundCompared).toBe(3);
    expect(s.bothFound).toBe(2); expect(s.exact).toBe(1); expect(s.within2).toBe(2);
    expect(s.overlapCompared).toBe(2); expect(s.overlapSum).toBeCloseTo(1);
    expect(s.mapAgree).toBe(2); expect(s.mapCompared).toBe(2);
    const md = markdownReport({ site: "s.com", place: { label: "Bellingham, Washington" }, device: "desktop", when: "now", baselineLabel: "Base", scores: [s], pairsBySource: { cse: pairs }, notes: ["note"] });
    expect(md).toContain("| Test | 3/4 (captcha ×1) | 67% (2/3) | 50% (1/2) | 100% (2/2) | 50% | 100% (2/2) | free | 0.1 |");
    expect(md).toContain("| k3 | not found | 9 |");
    expect(md).toContain("| k4 | 1 | _captcha_ |");
  });
});
