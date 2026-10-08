import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  reportInput, reportRequest, andClauses, SORTS, defaultSort, DOMAIN_TABLES, KEYWORD_TABLES, isKeywordTable, reportCacheKey,
  parseBacklink, parseLinkedPage, parseKeywordIdea, parseKeywordOverview, parseReportRows,
} from "./reports";
import { parseLinkHistory } from "./explorer";

/** Real responses for alpineexteriorswa.com and "siding contractor" (2026-10-08), trimmed. */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "reports-fixture.json"), "utf8"));
const base = (over: Record<string, unknown>) => ({ ...reportInput.parse({ domain: "example.com", table: "keywords", ...over }), target: "example.com" });

describe("report requests", () => {
  it("every table has a default sort, and an unknown sort falls back to it", () => {
    for (const t of [...DOMAIN_TABLES, ...KEYWORD_TABLES]) {
      expect(Object.keys(SORTS[t]).length, t).toBeGreaterThan(0);
      if (t === "ads") continue; // Google's ad library has its own order and no paging: the request carries neither
      const req = reportRequest({ ...base({ table: t, sort: "nonsense" }), target: "x" });
      expect((req.body.order_by as string[])[0], t).toBe(SORTS[t][defaultSort(t)]);
      expect(req.body.limit).toBe(50);
    }
    expect(isKeywordTable("questions")).toBe(true);
    expect(isKeywordTable("keywords")).toBe(false);
  });

  it("organic keywords: filters become the source's and-joined clauses", () => {
    const req = reportRequest(base({ sort: "volume", limit: 100, offset: 100, filters: { positionMax: 10, volumeMin: 100, difficultyMax: 30, intent: "commercial", contains: "roof" } }));
    expect(req.path).toBe("/dataforseo_labs/google/ranked_keywords/live");
    expect(req.body).toMatchObject({ target: "example.com", item_types: ["organic"], limit: 100, offset: 100, order_by: ["keyword_data.keyword_info.search_volume,desc"] });
    expect(req.body.filters).toEqual([
      ["ranked_serp_element.serp_item.rank_group", "<=", 10], "and",
      ["keyword_data.keyword_info.search_volume", ">=", 100], "and",
      ["keyword_data.keyword_properties.keyword_difficulty", "<=", 30], "and",
      ["keyword_data.search_intent_info.main_intent", "=", "commercial"], "and",
      ["keyword_data.keyword", "like", "%roof%"],
    ]);
    expect(reportRequest(base({})).body.filters).toBeUndefined();
    expect(reportRequest(base({ table: "paidKeywords" })).body.item_types).toEqual(["paid"]);
  });

  it("a single filter is sent bare, and never more than eight conditions", () => {
    expect(andClauses([["a", "=", 1]])).toEqual(["a", "=", 1]);
    expect(andClauses([])).toBeUndefined();
    const many = Array.from({ length: 12 }, (_, i) => [`f${i}`, "=", i] as [string, string, unknown]);
    expect((andClauses(many) as unknown[]).filter((x) => Array.isArray(x))).toHaveLength(8);
  });

  it("backlink reports differ only by status and filter", () => {
    const live = reportRequest(base({ table: "backlinks", filters: { follow: "followed" } }));
    expect(live.path).toBe("/backlinks/backlinks/live");
    expect(live.body).toMatchObject({ mode: "one_per_domain", backlinks_status_type: "live", filters: ["dofollow", "=", true], rank_scale: "one_thousand" });
    expect(reportRequest(base({ table: "backlinks", filters: { everyLink: true } })).body.mode).toBe("as_is");
    expect(reportRequest(base({ table: "lostBacklinks" })).body).toMatchObject({ backlinks_status_type: "lost", order_by: ["last_seen,desc"] });
    expect(reportRequest(base({ table: "newBacklinks" })).body.filters).toEqual(["is_new", "=", true]);
    expect(reportRequest(base({ table: "brokenBacklinks", filters: { follow: "nofollow" } })).body.filters).toEqual([["is_broken", "=", true], "and", ["dofollow", "=", false]]);
    expect(reportRequest(base({ table: "referringDomains", sort: "links" })).body.order_by).toEqual(["backlinks,desc"]);
    expect(reportRequest(base({ table: "bestByLinks" })).path).toBe("/backlinks/domain_pages_summary/live");
  });

  it("keyword idea lists search around the keyword; questions add the question pattern", () => {
    const q = reportRequest({ ...reportInput.parse({ keyword: "siding", table: "questions", filters: { volumeMin: 50 } }), target: "siding" });
    expect(q.path).toBe("/dataforseo_labs/google/keyword_suggestions/live");
    expect(q.body.keyword).toBe("siding");
    expect(JSON.stringify(q.body.filters)).toContain('"keyword","regex","^(how|what|why');
    expect(reportRequest({ ...reportInput.parse({ keyword: "siding", table: "relatedTerms" }), target: "siding" }).path).toBe("/dataforseo_labs/google/related_keywords/live");
  });

  it("refuses input that could reshape the request", () => {
    expect(() => reportInput.parse({ domain: "a.com", table: "keywords", limit: 1000 })).toThrow();
    expect(() => reportInput.parse({ domain: "a.com", table: "keywords", filters: { contains: "50%_off" } })).toThrow();
    expect(() => reportInput.parse({ domain: "a.com", table: "keywords", filters: { bogus: 1 } })).toThrow();
    expect(() => reportInput.parse({ domain: "a.com", table: "users" })).toThrow();
    expect(() => reportInput.parse({ domain: "a.com", table: "keywords", sort: "x; drop" })).toThrow();
    expect(() => reportInput.parse({ domain: "a.com", table: "keywords", offset: 20000 })).toThrow();
  });

  it("a saved page is keyed by everything that changes its rows, and nothing else", () => {
    const a = reportCacheKey(base({ filters: { volumeMin: 10, positionMax: 20 } }));
    expect(reportCacheKey(base({ filters: { positionMax: 20, volumeMin: 10 } }))).toBe(a);   // filter order
    expect(reportCacheKey(base({ filters: { volumeMin: 10, positionMax: 20 }, peek: true }))).toBe(a); // peek
    for (const other of [{ offset: 50 }, { limit: 100 }, { sort: "volume" }, { table: "pages" }, { filters: { volumeMin: 11, positionMax: 20 } }]) {
      expect(reportCacheKey(base({ filters: { volumeMin: 10, positionMax: 20 }, ...other })), JSON.stringify(other)).not.toBe(a);
    }
    expect(reportCacheKey({ ...base({}), target: "other.com" })).not.toBe(reportCacheKey(base({})));
  });
});

describe("report rows (real responses)", () => {
  it("reads a backlink, a lost backlink and a linked page", () => {
    expect(parseBacklink(fx.backlink)).toEqual({
      domain: "www.provenexpert.com", url: "https://www.provenexpert.com/en-us/alpine-exteriors-siding-roofing-windows/",
      title: "Alpine Exteriors | Siding, Roofing & Windows Reviews & Experiences", target: "https://alpineexteriorswa.com/", anchor: "Website",
      followed: true, authority: 69, spamScore: 0, firstSeen: "2025-09-04", lastSeen: "2026-04-14", isNew: false, isLost: false, isBroken: false, country: "DE", type: "anchor",
    });
    expect(parseBacklink(fx.lost)).toMatchObject({ domain: "melbphotostudio.us", isLost: true, lastSeen: "2026-10-07" });
    expect(parseBacklink({})).toBeNull();
    expect(parseLinkedPage(fx.linkedPage)).toEqual({ url: "https://alpineexteriorswa.com/", backlinks: 32007, referringDomains: 2657, authority: 37, brokenBacklinks: 0, firstSeen: "2025-08-13" });
  });

  it("reads keyword ideas from both list shapes", () => {
    expect(parseKeywordIdea(fx.related)).toEqual({ keyword: "siding contractors near me", volume: 40500, cpc: 35.58, difficulty: 0, intent: "commercial", competition: "HIGH" });
    expect(parseKeywordIdea(fx.question)).toMatchObject({ keyword: "should you paint vinyl siding", volume: 12100, intent: "informational" });
    expect(parseReportRows("questions", [fx.question, {}], "siding")).toHaveLength(1);
    expect(parseReportRows("backlinks", [fx.backlink, null], "x")).toHaveLength(1);
  });

  it("puts twelve months of backlink history oldest first", () => {
    const h = parseLinkHistory(fx.linkHistory);
    expect(h).toHaveLength(12);
    expect(h[0]).toEqual({ month: "2025-10", backlinks: 1152, referringDomains: 586, newBacklinks: 722, lostBacklinks: 143, authority: 22 });
    expect(h.at(-1)).toMatchObject({ month: "2026-09", referringDomains: 2186, authority: 37 });
  });

  it("builds a keyword overview: numbers, trend oldest first, the organic top ten with each site's authority", () => {
    const o = parseKeywordOverview(fx.overview, fx.serp, [{ target: "www.lowes.com", rank: 880 }, { target: "houzz.com", rank: 661 }], { keyword: "siding contractor", locationCode: 2840, fetchedAt: "2026-10-08T00:00:00.000Z" });
    expect(o).toMatchObject({ keyword: "siding contractor", volume: 27100, cpc: 24.07, difficulty: 0, intent: "commercial", competition: "LOW", bidLow: 11.61, bidHigh: 68.22, results: 25300000 });
    expect(o.trend[0].month < o.trend.at(-1)!.month).toBe(true);
    expect(o.trend.at(-1)).toEqual({ month: "2026-08", volume: 22200 });
    expect(o.features).toContain("local_pack");
    expect(o.features).not.toContain("organic");
    expect(o.topAvg).toEqual({ authority: 19, backlinks: 1830, referringDomains: 151 });
    expect(o.serp.length).toBeGreaterThan(5);
    expect(o.serp.every((s) => s.position >= 1)).toBe(true);
    expect(o.serp[0]).toMatchObject({ position: 1, domain: "lowes.com", authority: 88 });
    expect(o.serp[1]).toMatchObject({ position: 2, domain: "houzz.com", authority: 66 });
    expect(o.serp[2].authority).toBeNull();
    // An empty source answer still gives a usable shape.
    expect(parseKeywordOverview({}, [], [], { keyword: "x", locationCode: 2840 })).toMatchObject({ keyword: "x", volume: null, trend: [], serp: [] });
  });
});
