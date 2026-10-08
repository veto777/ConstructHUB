import { describe, expect, it } from "vitest";
import { compareKeywordSnapshots, comparePick, pagesChanged, pageKey, fetchKeywordSnapshot, coverage, keywordAlerts, keywordWatchDeps, parseSnapshotKeyword, KW_SNAPSHOT_ROWS, type KeywordSnapshot, type SnapshotKeyword } from "./keyword-watch";

const k = (keyword: string, position: number | null, volume: number | null = 100, traffic: number | null = 10): SnapshotKeyword => ({ keyword, position, volume, traffic, path: "/" });
const snap = (takenOn: string, keywords: SnapshotKeyword[], total: number | null = keywords.length, over: Partial<KeywordSnapshot> = {}): KeywordSnapshot => ({ id: Number(takenOn.replace(/-/g, "")), takenOn, locationCode: 2840, languageCode: "en", total, fetched: keywords.length, keywords, ...over });
const row = (keyword: unknown, rank: number, etv: number | null = 12.34) => ({ keyword_data: { keyword, keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: rank, etv, relative_url: "/roofing" } } });

describe("keyword watch", () => {
  it("reads a row; asks for the site's highest-traffic keywords in its country; a keyword is kept once", async () => {
    expect(parseSnapshotKeyword(row("Roof Repair ", 4))).toEqual({ keyword: "roof repair", position: 4, volume: 500, traffic: 12.3, path: "/roofing" });
    expect(parseSnapshotKeyword(row("", 4))).toBeNull();
    expect(parseSnapshotKeyword(row("x", 4, null))?.traffic).toBeNull();
    const real = keywordWatchDeps.request;
    try {
      let body: any;
      keywordWatchDeps.request = (async (_m: string, _p: string, b: any) => { body = b[0]; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0214, result: [{ total_count: 2, items: [row("roof repair", 4), row("Roof Repair", 9), row("siding", 12)] }] }] }; }) as any;
      const out = await fetchKeywordSnapshot({ domain: "alpine.example", locationCode: 2124, languageCode: "fr" });
      expect(body).toMatchObject({ target: "alpine.example", location_code: 2124, language_code: "fr", item_types: ["organic"], limit: KW_SNAPSHOT_ROWS });
      expect([out.data.total, out.data.fetched, out.data.keywords.map((x) => x.keyword), out.costUsd]).toEqual([2, 3, ["roof repair", "siding"], 0.0214]);
    } finally { keywordWatchDeps.request = real; }
  });
  it("whole snapshots: what is in one and not the other is newly seen or no longer seen", () => {
    const before = snap("2026-09-08", [k("roof repair", 4), k("siding", 12), k("gutters", 8)]);
    const now = snap("2026-10-08", [k("roof repair", 3), k("metal roofing", 15, 900, 40), k("soffit repair", 34, 50, 1), k("siding", 14)]);
    const c = compareKeywordSnapshots(now, before);
    expect([c.basis, c.since, c.takenOn, c.locationCode, c.languageCode]).toEqual(["whole", "2026-09-08", "2026-10-08", 2840, "en"]);
    expect(c.added.map((x) => x.keyword)).toEqual(["metal roofing", "soffit repair"]);   // by traffic
    expect(c.gone).toEqual([{ ...k("gutters", 8), was: 8 }]);
    // Alerts: new ones on the first two pages, lost ones that were on the first.
    expect(keywordAlerts(c)).toEqual({ added: [k("metal roofing", 15, 900, 40)], gone: [{ ...k("gutters", 8), was: 8 }] });
  });
  it("a snapshot cut at the limit cannot say new or gone — only entered or left the top keywords, and never alerts", () => {
    const before = snap("2026-09-08", [k("a", 1), k("b", 2)], 900);
    const now = snap("2026-10-08", [k("a", 1), k("c", 3)], 950);
    const c = compareKeywordSnapshots(now, before);
    expect([c.basis, c.added.map((x) => x.keyword), c.gone.map((x) => x.keyword)]).toEqual(["top", ["c"], ["b"]]);
    expect(keywordAlerts(c)).toEqual({ added: [], gone: [] });
    // A total the source did not give: not known either way — said as that, and no alert.
    const u = compareKeywordSnapshots(snap("2026-10-08", [k("a", 1), k("z", 2)], null), snap("2026-09-08", [k("a", 1)]));
    expect([u.basis, keywordAlerts(u)]).toEqual(["unknown", { added: [], gone: [] }]);
    expect([coverage({ total: 2, keywords: [1, 2] }), coverage({ total: 3, keywords: [1, 2] }), coverage({ total: null, keywords: [] })]).toEqual([true, false, null]);
    // Two spellings of one keyword folded together do not make a whole snapshot look cut: the rows returned are what counts.
    expect(coverage({ total: 3, fetched: 3, keywords: [1, 2] })).toBe(true);
  });
  it("another country or language is not comparable; nothing is cut before it is counted or judged for an alert", () => {
    const c = compareKeywordSnapshots(snap("2026-10-08", [k("a", 1)]), snap("2026-09-08", [k("b", 1)], 1, { locationCode: 2124 }));
    expect([c.basis, c.added, c.gone]).toEqual(["none", [], []]);
    // 150 newly seen, the last of them (lowest traffic) in the top 20: all counted, and the last one still alerts.
    const many = Array.from({ length: 150 }, (_, i) => k(`kw ${i}`, i === 149 ? 3 : 55, 100, 150 - i));
    const big = compareKeywordSnapshots(snap("2026-10-08", many), snap("2026-09-08", []));
    expect([big.added.length, keywordAlerts(big).added.map((x) => x.keyword)]).toEqual([150, ["kw 149"]]);
  });
  it("by page: keywords and visits in each snapshot, and why a page's count moved", () => {
    const kp = (keyword: string, path: string | null, traffic: number | null = 10): SnapshotKeyword => ({ keyword, position: 5, volume: 100, traffic, path });
    const before = [kp("siding bellingham", "/siding/bellingham/", 40), kp("siding ferndale", "/siding/ferndale", 12), kp("roof repair", "/"), kp("gutters", "/gutters", null)];
    const now = [kp("siding bellingham", "/siding/bellingham", 25), kp("siding lynden", "/siding/bellingham", 5), kp("siding ferndale", "/", 8), kp("roof repair", "/", 11), kp("gutters", "/gutters", 3)];
    const p = pagesChanged(now, before);
    // "/siding/bellingham/" and "/siding/bellingham" are one page; ferndale's keyword is now ranked with the home page.
    expect(p.map((x) => [x.path, x.before.keywords, x.after.keywords, x.before.visits, x.after.visits])).toEqual([
      ["/siding/ferndale", 1, 0, 12, 0], ["/siding/bellingham", 1, 2, 40, 30], ["/", 1, 2, 10, 19], ["/gutters", 1, 1, 0, 3],
    ]);
    expect(p.find((x) => x.path === "/siding/ferndale")).toMatchObject({ movedOut: 1, gone: 0 });
    expect(p.find((x) => x.path === "/")).toMatchObject({ movedIn: 1, added: 0 });
    expect(p.find((x) => x.path === "/siding/bellingham")).toMatchObject({ added: 1 });
    expect(p.find((x) => x.path === "/gutters")!.before).toEqual({ keywords: 1, visits: 0, unknown: 1 });   // an unknown estimate is not a zero
    expect([pageKey("/a/?x=1#top"), pageKey("/"), pageKey("//"), pageKey(null)]).toEqual(["/a?x=1", "/", "/", null]);
    // Not comparable (another country): no pages either.
    expect(compareKeywordSnapshots(snap("2026-10-08", [k("a", 1)]), snap("2026-09-08", [k("a", 1)], 1, { locationCode: 2124 })).pages).toEqual([]);
  });
  it("snapshot ids to compare: decimal, positive, within the database's integer range", () => {
    expect(comparePick.safeParse({ now: "12", before: "3" })).toMatchObject({ success: true, data: { now: 12, before: 3 } });
    for (const bad of [{ now: "2147483648", before: "1" }, { now: "0", before: "1" }, { now: "1e3", before: "1" }, { now: "-1", before: "1" }, { now: ["1", "2"], before: "1" }, { now: "1" }])
      expect(comparePick.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
