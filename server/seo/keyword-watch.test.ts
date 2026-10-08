import { describe, expect, it } from "vitest";
import { compareKeywordSnapshots, comparePick, pagesChanged, pageKey, visitsComparable, fetchKeywordSnapshot, coverage, keywordAlerts, keywordWatchDeps, parseSnapshotKeyword, KW_SNAPSHOT_ROWS, type KeywordSnapshot, type SnapshotKeyword } from "./keyword-watch";

const k = (keyword: string, position: number | null, volume: number | null = 100, traffic: number | null = 10): SnapshotKeyword => ({ keyword, position, volume, traffic, path: "/" });
const snap = (takenOn: string, keywords: SnapshotKeyword[], total: number | null = keywords.length, over: Partial<KeywordSnapshot> = {}): KeywordSnapshot => ({ id: Number(takenOn.replace(/-/g, "")), takenOn, locationCode: 2840, languageCode: "en", total, fetched: keywords.length, keywords, ...over });
const row = (keyword: unknown, rank: number, etv: number | null = 12.34) => ({ keyword_data: { keyword, keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: rank, etv, relative_url: "/roofing" } } });

describe("keyword watch", () => {
  it("reads a row; asks for the site's highest-traffic keywords in its country; a keyword is kept once", async () => {
    expect(parseSnapshotKeyword(row("Roof Repair ", 4))).toEqual({ keyword: "roof repair", position: 4, volume: 500, traffic: 12.34, path: "/roofing", url: null });
    // The source's figure is kept as it is; a full address up to 2,048 characters is kept; one that cannot be used is said.
    expect(parseSnapshotKeyword({ ...row("a", 1, 0.00016) }).traffic).toBe(0.00016);
    const long = `https://store.example.com/${"p".repeat(900)}`;
    expect(parseSnapshotKeyword({ keyword_data: { keyword: "a" }, ranked_serp_element: { serp_item: { rank_group: 1, url: long, relative_url: "/x" } } })!.url).toBe(long);
    expect(parseSnapshotKeyword({ keyword_data: { keyword: "a" }, ranked_serp_element: { serp_item: { rank_group: 1, url: "ftp://x/y", relative_url: "/y" } } })).toMatchObject({ url: null, urlRejected: true });
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
  it("by page: a page is its host and path however the source wrote it; unknown estimates and missing pages claim nothing", () => {
    const kw = (keyword: string, o: Partial<SnapshotKeyword>): SnapshotKeyword => ({ keyword, position: 5, volume: 100, traffic: 10, path: null, ...o });
    // The same page given as a path, as a full address, and with www: one row, its address on the site's host.
    const p1 = pagesChanged([kw("a", { path: "/roofing", url: "https://www.alpine.example/roofing/" })], [kw("a", { path: "https://alpine.example/roofing" })], "alpine.example");
    expect(p1.map((x) => [x.path, x.movedIn, x.movedOut])).toEqual([["/roofing", 0, 0]]);
    // Its address is rebuilt as the source wrote it (scheme and host); another port is another page.
    expect(p1[0].url).toMatch(/^https:\/\/(www\.)?alpine\.example\/roofing$/);
    const ports = pagesChanged([kw("p", { path: "/a", url: "http://alpine.example:8080/a" }), kw("q", { path: "/a", url: "https://alpine.example/a" })], [], "alpine.example");
    expect(ports.map((x) => x.url).sort()).toEqual(["http://alpine.example:8080/a", "https://alpine.example/a"]);
    // A page that moved from http to https is shown and planned with today's address; the older one is kept beside it.
    const moved = pagesChanged([kw("m", { path: "/s", url: "https://alpine.example/s" })], [kw("m", { path: "/s", url: "http://alpine.example/s" })], "alpine.example");
    expect([moved.length, moved[0].url, moved[0].urlBefore]).toEqual([1, "https://alpine.example/s", "http://alpine.example/s"]);
    // A page on another host is shown and planned with its own host, never glued onto the site's.
    const p2 = pagesChanged([kw("b", { path: "/shop", url: "https://store.alpine.example/shop" })], [], "alpine.example");
    expect([p2[0].path, p2[0].url]).toEqual(["store.alpine.example/shop", "https://store.alpine.example/shop"]);
    // An estimate that went missing is not a fall in visits: the page is not comparable, and sorts by its keyword count.
    const p3 = pagesChanged([kw("c", { path: "/x", traffic: null }), kw("d", { path: "/y", traffic: 5 })], [kw("c", { path: "/x", traffic: 10 }), kw("d", { path: "/y", traffic: 9 })], "h");
    expect(p3.map((x) => [x.path, visitsComparable(x)])).toEqual([["/y", true], ["/x", false]]);
    // A page that was not given in one snapshot is not a move, and an empty path is no page at all (never the home page).
    const p4 = pagesChanged([kw("e", { path: "/z" }), kw("f", { path: "" })], [kw("e", { path: null }), kw("f", { path: "/w" })], "h");
    expect(p4.find((x) => x.path === "/z")).toMatchObject({ movedIn: 0, pageNewlyGiven: 1 });
    expect(p4.find((x) => x.path === "/w")).toMatchObject({ movedOut: 0, pageNoLongerGiven: 1 });
    expect(p4.some((x) => x.path === "/")).toBe(false);
    // Paths kept to 300 characters by older snapshots are flagged; visits are added at full precision, rounded once.
    expect(pagesChanged([kw("g", { path: "/" + "a".repeat(299) })], [], "h")[0].cut).toBe(true);
    expect(pagesChanged(Array.from({ length: 300 }, (_, i) => kw(`k${i}`, { path: "/p", traffic: 0.04 })), [], "h")[0].after.visits).toBe(12);
    // The reasons reconcile with the counts on every page.
    for (const x of p4) expect(x.after.keywords).toBe(x.before.keywords + x.added - x.gone + x.movedIn - x.movedOut + x.pageNewlyGiven - x.pageNoLongerGiven);
  });
  it("an address cut short by an older snapshot is flagged however it was written; an unusable full address never takes the site's host", () => {
    const kw = (keyword: string, o: Partial<SnapshotKeyword>): SnapshotKeyword => ({ keyword, position: 5, volume: 100, traffic: 10, path: null, ...o });
    const abs = "https://alpine.example/" + "a".repeat(300 - "https://alpine.example/".length);
    expect(pagesChanged([kw("a", { path: abs })], [], "alpine.example")[0].cut).toBe(true);
    const p = pagesChanged([kw("b", { path: "/shop", urlRejected: true })], [], "alpine.example")[0];
    expect([p.path, p.url]).toEqual(["/shop", null]);
    // Parsed and added up: 300 tiny estimates come to their real total.
    const rows = Array.from({ length: 300 }, (_, i) => parseSnapshotKeyword({ keyword_data: { keyword: `k${i}` }, ranked_serp_element: { serp_item: { rank_group: 9, etv: 0.00016, relative_url: "/p" } } })!);
    expect(pagesChanged(rows, [], "h")[0].after.visits).toBe(0);   // 0.048, shown to one decimal
    expect(rows.reduce((a, r) => a + (r.traffic ?? 0), 0)).toBeCloseTo(0.048, 6);
  });
});
