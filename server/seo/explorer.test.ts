import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildDomainReport, parseFootprint, parseHistory, parseExplorerKeyword, intentBreakdown, parseCompetitors,
  parseBacklinkProfile, parseReferringDomain, parseAnchor, REPORT_TTL_DAYS, EXPLORER_ESTIMATE_USD,
} from "./explorer";

/** Real responses for alpineexteriorsfl.com (2026-10-07), trimmed to the fields the parsers read. */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "explorer-fixture.json"), "utf8"));
const input = { domain: fx.domain, locationCode: 2840, languageCode: "en", fetchedAt: "2026-10-07T23:00:00.000Z" };

describe("Site Explorer report", () => {
  it("sums the position buckets into cumulative top-N counts", () => {
    const f = parseFootprint(fx.overview.metrics.organic);
    expect(f).toMatchObject({ keywords: 48, traffic: 7.4, trafficValue: 116.51, isNew: 32, isUp: 10, isDown: 6, isLost: 47 });
    expect(f.positions).toEqual({ top3: 0, top10: 1, top20: 7, top50: 21, top100: 48 });
    expect(f.positions.top100).toBe(f.keywords);
    expect(parseFootprint(undefined)).toMatchObject({ keywords: 0, traffic: 0, positions: { top3: 0, top100: 0 } });
  });

  it("orders history oldest first, one point per month", () => {
    const h = parseHistory(fx.history);
    expect(h.map((p) => p.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(h.at(-1)).toMatchObject({ month: "2026-09", keywords: 57, traffic: 14.1 });
    expect(parseHistory([{ year: null, month: 3 }, {}])).toEqual([]);
  });

  it("reads a ranked keyword: position, volume, traffic, difficulty, intent and page", () => {
    expect(parseExplorerKeyword(fx.keywords.items[0])).toEqual({
      keyword: "alpine exteriors", position: 13, volume: 880, traffic: 3.9, trafficValue: 75.45, cpc: 19.48,
      difficulty: 33, intent: "commercial", url: "https://alpineexteriorsfl.com/",
    });
    expect(parseExplorerKeyword({ keyword_data: {} })).toBeNull();
    expect(parseExplorerKeyword({ keyword_data: { keyword: "x", search_intent_info: { main_intent: "made-up" } } })?.intent).toBeNull();
  });

  it("breaks keywords down by intent, every intent listed even at zero", () => {
    const rows = intentBreakdown(fx.keywords.items.map(parseExplorerKeyword));
    expect(rows.map((r) => [r.intent, r.keywords])).toEqual([["informational", 2], ["navigational", 2], ["commercial", 1], ["transactional", 1]]);
    expect(rows.reduce((s, r) => s + r.keywords, 0)).toBe(6);
  });

  it("never lists the domain as its own competitor", () => {
    const c = parseCompetitors(fx.competitors, fx.domain);
    expect(c.map((x) => x.domain)).toEqual(["houzz.com", "bbb.org", "homeadvisor.com"]);
    expect(c[0]).toMatchObject({ commonKeywords: 39 });
    expect(c[0].traffic).toBeGreaterThan(1_000_000);
  });

  it("turns the vendor's 0-1000 rank into a 0-100 authority and splits followed / nofollow domains", () => {
    const p = parseBacklinkProfile(fx.summary);
    expect(p).toMatchObject({ authority: 37, backlinks: 30827, referringDomains: 2407, followedDomains: 2386, nofollowDomains: 21, spamScore: 28, firstSeen: "2023-09-05" });
    expect(p.tlds[0]).toEqual({ tld: "com", links: 28271 });
    expect(parseBacklinkProfile({ rank: 1400 }).authority).toBe(100);
    expect(parseBacklinkProfile({})).toMatchObject({ authority: null, followedDomains: null, tlds: [] });
  });

  it("reads referring domains and anchors", () => {
    expect(parseReferringDomain(fx.referringDomains[0])).toEqual({ domain: "odumazza.com", authority: 37, backlinks: 25858, firstSeen: "2025-09-25", spamScore: 29, followed: true });
    expect(parseReferringDomain({ domain: "x.com", referring_pages: 4, referring_pages_nofollow: 4 })?.followed).toBe(false);
    expect(parseAnchor(fx.anchors[0])).toEqual({ anchor: "https://alpineexteriorsfl.com/", backlinks: 27091, referringDomains: 521, firstSeen: "2025-09-24" });
    expect(parseAnchor({ anchor: null, backlinks: 3 })?.anchor).toBe("");
  });

  it("assembles the whole report", () => {
    const r = buildDomainReport(input, fx);
    expect(r).toMatchObject({ domain: "alpineexteriorsfl.com", keywordsTotal: 48, pagesTotal: 15, missing: [] });
    expect(r.organic.keywords).toBe(48);
    expect(r.paid.keywords).toBe(0);
    expect(r.links.authority).toBe(37);
    expect(r.history).toHaveLength(6);
    expect(r.keywords).toHaveLength(6);
    expect(r.pages![0]).toMatchObject({ url: "https://alpineexteriorsfl.com/", keywords: 22, traffic: 6.1 });
    expect(r.competitors).toHaveLength(3);
    expect(r.referringDomains).toHaveLength(3);
    expect(r.anchors).toHaveLength(3);
  });

  it("a list the source did not return leaves its section null and is named, the rest stands", () => {
    const r = buildDomainReport(input, { overview: fx.overview, summary: fx.summary, history: null, keywords: null, pages: fx.pages });
    expect(r.missing).toEqual(["history", "keywords", "competitors", "referringDomains", "anchors"]);
    expect(r.history).toBeNull();
    expect(r.intents).toBeNull();
    expect(r.pages).toHaveLength(3);
    expect(r.organic.keywords).toBe(48);
  });

  it("a report is free to reopen for a week, and reserved above what it really costs", () => {
    expect(REPORT_TTL_DAYS).toBe(7);
    // The eight calls measured $0.2529 for this domain on 2026-10-07.
    expect(EXPLORER_ESTIMATE_USD).toBeGreaterThan(0.2529);
  });
});
