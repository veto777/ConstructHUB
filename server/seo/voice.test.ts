import { describe, expect, it } from "vitest";
import { shareOfVoice, competitorInput, type VoiceCheck } from "./voice";

const top = (...domains: string[]) => domains.map((domain, i) => ({ position: i + 1, domain }));
const check = (keywordId: number, position: number | null, serp: string[], extra: Partial<VoiceCheck> = {}): VoiceCheck =>
  ({ keywordId, position, volume: null, serpTop: top(...serp), rivals: null, localPack: null, ...extra });

describe("shareOfVoice", () => {
  const checks = [
    check(1, 1, ["us.com", "rival.com", "yelp.com", "angi.com"]),
    check(2, null, ["rival.com", "yelp.com", "www.other.com"]),
    check(3, 4, ["yelp.com", "blog.rival.com", "x.com", "us.com"], { rivals: { "far.com": 14 } }),
  ];
  const v = shareOfVoice(checks, "us.com", ["rival.com", "far.com"]);
  it("ranks the site and its followed competitors by visibility", () => {
    expect(v.keywords).toBe(3);
    expect(v.domains.map((d) => d.domain)).toEqual(["rival.com", "us.com", "far.com"]);
    const us = v.domains.find((d) => d.isSite)!, rival = v.domains.find((d) => d.domain === "rival.com")!, far = v.domains.find((d) => d.domain === "far.com")!;
    // us: #1 and #4 of three keywords = (0.28 + 0.08) / 3 / 0.28
    expect(us).toMatchObject({ ranked: 2, top3: 1, top10: 2, averagePosition: 2.5, visibility: 42.9 });
    // rival: #2, #1, #2 (a subdomain counts)
    expect(rival).toMatchObject({ ranked: 3, top3: 3, averagePosition: 1.7 });
    expect(rival.visibility).toBeGreaterThan(us.visibility);
    // far: only known from the saved competitor position, outside the top ten
    expect(far).toMatchObject({ ranked: 1, top10: 0, averagePosition: 14, visibility: 0 });
  });
  it("lists the other sites seen on the most keywords, not the site or those already followed", () => {
    expect(v.seenMost.map((s) => [s.domain, s.keywords, s.bestPosition])).toEqual([["yelp.com", 3, 1], ["angi.com", 1, 4], ["other.com", 1, 3], ["x.com", 1, 3]].sort((a: any, b: any) => b[1] - a[1] || a[2] - b[2] || a[0].localeCompare(b[0])));
  });
  it("weights by search volume when every keyword has one", () => {
    const w = shareOfVoice([check(1, 1, [], { volume: 900 }), check(2, null, [], { volume: 100 })], "us.com", []);
    expect(w.domains[0].visibility).toBe(90);
    expect(shareOfVoice([check(1, 1, [], { volume: 900 }), check(2, null, [])], "us.com", []).domains[0].visibility).toBe(50);
  });
  it("counts who is in the map pack, once per keyword, and knows which one is the site", () => {
    const pack = (titles: [string, string | null][]) => titles.map(([title, domain], i) => ({ position: i + 1, title, domain }));
    const m = shareOfVoice([
      check(1, 3, [], { localPack: pack([["Big Roofer", "bigroofer.com"], ["Us Exteriors", null]]) }),
      check(2, 5, [], { localPack: pack([["Big Roofer", "www.bigroofer.com"], ["Other Co", null], ["Big Roofer", "bigroofer.com"]]) }),
    ], "us.com", [], (e) => e.title === "Us Exteriors");
    expect(m.mapLeaders.map((l) => [l.title, l.keywords, l.isSite])).toEqual([["Big Roofer", 2, false], ["Other Co", 1, false], ["Us Exteriors", 1, true]]);
  });
  it("is empty, not broken, with no checks or no saved result pages", () => {
    expect(shareOfVoice([], "us.com", ["rival.com"])).toMatchObject({ keywords: 0, seenMost: [], mapLeaders: [] });
    const old = shareOfVoice([{ keywordId: 1, position: 2, volume: null, serpTop: null, rivals: null, localPack: null }], "us.com", ["rival.com"]);
    expect(old.domains.find((d) => d.isSite)!.ranked).toBe(1);
    expect(old.domains.find((d) => !d.isSite)!.ranked).toBe(0);
  });
});

describe("competitorInput", () => {
  it("takes a domain and nothing else", () => {
    expect(competitorInput.safeParse({ domain: "rival.com" }).success).toBe(true);
    expect(competitorInput.safeParse({ domain: "r" }).success).toBe(false);
    expect(competitorInput.safeParse({ domain: "rival.com", x: 1 }).success).toBe(false);
  });
});
