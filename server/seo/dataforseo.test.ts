import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  dataforseoDeps, isConfigured, assertOk, isTaskInProgress, isNoResultsTask, buildRankResult, parseTaskPost, parseTaskGet,
  parseKeywordItem, parseIntersectionItem, parseBacklinkSummary, parseBacklinkRow, parseAdsVolumeItem, normalizeDomain,
  serpTaskPost, serpTaskGet, normalizeBusinessName, isOurListing, safeHttpUrl, safeDomain, labsKeywordSuggestions, labsDomainIntersection, backlinksSummary, backlinksList, adsSearchVolume,
  DataForSeoError, API_BASE,
} from "./dataforseo";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

/** A fetch that answers from fixtures and records every request; never the network. */
function mockFetch(answer: (path: string, body: any) => unknown) {
  const calls: { method: string; path: string; body: any; auth: string | null }[] = [];
  dataforseoDeps.fetch = (async (url: any, init: any) => {
    const path = String(url).replace(API_BASE, "");
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", path, body, auth: headers.get("authorization") });
    const out = answer(path, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const originalFetch = dataforseoDeps.fetch, originalEnv = dataforseoDeps.env;
beforeEach(() => { dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "login@example.com", DATAFORSEO_PASSWORD: "secret" }); });
afterEach(() => { dataforseoDeps.fetch = originalFetch; dataforseoDeps.env = originalEnv; vi.restoreAllMocks(); });

describe("configuration", () => {
  it("is configured only with both credentials", () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ DATAFORSEO_LOGIN: "a" })).toBe(false);
    expect(isConfigured({ DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: " " })).toBe(false);
    expect(isConfigured({ DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" })).toBe(true);
  });
  it("refuses to call anything without credentials", async () => {
    dataforseoDeps.env = () => ({});
    const calls = mockFetch(() => ({}));
    await expect(backlinksSummary({ target: "constructhub.us" })).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toHaveLength(0);
  });
  it("sends HTTP basic auth from the env", async () => {
    const calls = mockFetch(() => fixture("backlinks_summary"));
    await backlinksSummary({ target: "constructhub.us" });
    expect(calls[0].auth).toBe("Basic " + Buffer.from("login@example.com:secret").toString("base64"));
    expect(calls[0].path).toBe("/backlinks/summary/live");
  });
});

describe("envelope", () => {
  it("recognises pending and no-results tasks", () => {
    expect(isTaskInProgress({ status_code: 40602 })).toBe(true);
    expect(isTaskInProgress({ status_code: 20000 })).toBe(false);
    expect(isNoResultsTask({ status_code: 40501, status_message: "No Search Results." })).toBe(true);
    expect(isNoResultsTask({ status_code: 40501, status_message: "Invalid Field: 'keyword'." })).toBe(false);
  });
  it("classifies a balance problem and keeps the task's cost on the error", () => {
    expect(() => assertOk(fixture("error_balance"))).toThrow(DataForSeoError);
    try { assertOk(fixture("error_balance")); } catch (e: any) { expect(e.code).toBe("auth"); expect(e.message).toContain("balance"); }
    try { assertOk({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field: 'target'.", cost: 0.012 }] }); }
    catch (e: any) { expect(e.code).toBe("task_failed"); expect(e.costUsd).toBe(0.012); }
  });
  it("maps HTTP failures: 401 → auth, 429 → rate_limited, 5xx retried then upstream", async () => {
    let n = 0;
    mockFetch(() => { n++; return new Response("busy", { status: 503 }); });
    await expect(backlinksSummary({ target: "x.com" })).rejects.toMatchObject({ code: "upstream", status: 503 });
    expect(n).toBe(1); // a POST is never replayed: it may already have been charged
    mockFetch(() => new Response("nope", { status: 401 }));
    await expect(backlinksSummary({ target: "x.com" })).rejects.toMatchObject({ code: "auth" });
    mockFetch(() => new Response("slow down", { status: 429 }));
    await expect(backlinksSummary({ target: "x.com" })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("rank checks (standard queue)", () => {
  const tasks = [
    { keyword: "roofing contractor tampa", keywordId: 11, device: "desktop" as const },
    { keyword: "roofing contractor tampa", keywordId: 11, device: "mobile" as const },
    { keyword: "", keywordId: 12, device: "desktop" as const },
  ];
  it("task_post: posts one task per keyword/device with stop-on-target and a tag, returns accepted ids and the total cost", async () => {
    const calls = mockFetch(() => fixture("task_post"));
    const out = await serpTaskPost({ tasks, locationCode: 2840, languageCode: "en", depth: 10, targetDomain: "constructhub.us" });
    expect(calls[0].path).toBe("/serp/google/organic/task_post");
    expect(calls[0].body).toHaveLength(3);
    expect(calls[0].body[0]).toMatchObject({ keyword: "roofing contractor tampa", device: "desktop", os: "windows", depth: 10, priority: 1, tag: "11:desktop", location_code: 2840, language_code: "en" });
    expect(calls[0].body[0].stop_crawl_on_match).toEqual([{ match_value: "constructhub.us", match_type: "with_subdomains" }]);
    expect(calls[0].body[1]).toMatchObject({ device: "mobile", os: "android", tag: "11:mobile" });
    expect(out.data).toEqual([
      { keyword: "roofing contractor tampa", keywordId: 11, device: "desktop", taskId: "10061512-1535-0066-0000-aaaaaaaaaaaa" },
      { keyword: "roofing contractor tampa", keywordId: 11, device: "mobile", taskId: "10061512-1535-0066-0000-bbbbbbbbbbbb" },
    ]);
    // every entry's cost counts, the rejected one included
    expect(out.costUsd).toBeCloseTo(0.0018, 9);
  });
  it("parseTaskPost ignores entries whose tag we did not send", () => {
    const out = parseTaskPost({ status_code: 20000, tasks: [{ id: "q", status_code: 20100, cost: 0.0006, data: { tag: "99:desktop" } }] }, tasks);
    expect(out.data).toEqual([]);
    expect(out.costUsd).toBe(0.0006);
  });
  it("buildRankResult: the first organic result on the domain or a subdomain, by rank_group; features are the element types", () => {
    const items = fixture("task_get").tasks[0].result[0].items;
    const r = buildRankResult({ keywordId: 11, keyword: "roofing contractor tampa", targetDomain: "constructhub.us" }, items);
    expect(r).toEqual({ keywordId: 11, keyword: "roofing contractor tampa", position: 2, url: "https://www.constructhub.us/roofing/tampa", serpFeatures: ["local_pack", "people_also_ask", "organic", "own:checked"],
      localPosition: null, localPack: [{ position: 1, title: "Tampa Roof Pros", domain: "tamparoofpros.example" }],
      serpTop: [{ position: 1, domain: "bigroofer.example", url: "https://bigroofer.example/tampa", title: "Big Roofer" }, { position: 2, domain: "constructhub.us", url: "https://www.constructhub.us/roofing/tampa", title: "Tampa roofing contractors" }, { position: 3, domain: "blog.constructhub.us", url: "https://blog.constructhub.us/roofing", title: "Blog" }],
      rivals: {} });
    // followed competitors: found in the organic results (a subdomain counts), or null
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "constructhub.us", competitors: ["www.BigRoofer.example", "nowhere.example"] }, items).rivals).toEqual({ "bigroofer.example": 1, "nowhere.example": null });
    // a local-pack hit on another domain is not an organic ranking
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "tamparoofpros.example" }, items).position).toBeNull();
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "bigroofer.example" }, items)).toMatchObject({ position: 1, url: "https://bigroofer.example/tampa" });
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "hub.us" }, items).position).toBeNull(); // not a suffix match
  });
  it("map pack: the business is found by its website, or by its name when the entry has no website", () => {
    const items = fixture("task_get").tasks[0].result[0].items;
    // by website: in the pack at 1, though it has no organic ranking
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "tamparoofpros.example" }, items)).toMatchObject({ position: null, localPosition: 1 });
    const pack = [
      { type: "local_pack", rank_group: 1, title: "Big Roofer Inc." },
      { type: "local_pack", rank_group: 2, title: "Alpine Exteriors, LLC", domain: null },
      { type: "local_pack", rank_group: 3, title: "Alpine Roofing & Gutters", domain: "alpineroofing.example" },
    ];
    const byName = buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "alpineexteriorswa.com", businessName: "Alpine Exteriors" }, pack);
    expect(byName.localPosition).toBe(2);
    expect(byName.localPack.map((p) => p.title)).toEqual(["Big Roofer Inc.", "Alpine Exteriors, LLC", "Alpine Roofing & Gutters"]);
    // no name given and no website on the entries: not found, never guessed
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "alpineexteriorswa.com" }, pack).localPosition).toBeNull();
    // a different business that merely shares a word is not a match
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "x.com", businessName: "Alpine" }, pack).localPosition).toBeNull();
    // no map on the page
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "x.com", businessName: "Alpine Exteriors" }, [])).toMatchObject({ localPosition: null, localPack: [] });
  });
  it("map pack: another business is never taken for the customer's", () => {
    // a longer name that merely starts with ours is a different business
    expect(isOurListing({ title: "Precision Roofing Supply" }, "x.com", "Precision Roofing")).toBe(false);
    // the same name on a different website is a different business
    expect(isOurListing({ title: "Precision Roofing", domain: "precisionroofing-ohio.example" }, "x.com", "Precision Roofing")).toBe(false);
    // the website wins wherever it is in the pack, even after an entry whose name matches
    const pack = [
      { type: "local_pack", rank_group: 1, title: "Precision Roofing" },
      { type: "local_pack", rank_group: 2, title: "Precision Roofing of Tampa", domain: "www.x.com" },
    ];
    expect(buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "x.com", businessName: "Precision Roofing" }, pack).localPosition).toBe(2);
    // a tagline after a separator is not part of the name
    expect(isOurListing({ title: "Alpine Exteriors | Siding, Roofing & Windows" }, "x.com", "Alpine Exteriors")).toBe(true);
  });
  it("what is saved from a result page is safe to show: http(s) links only, host-shaped domains, bounded", () => {
    const r = buildRankResult({ keywordId: 1, keyword: "k", targetDomain: "x.com" }, [
      { type: "organic", rank_group: 1, domain: "evil.example", url: "javascript:alert(1)", title: "t".repeat(500) },
      { type: "organic", rank_group: 2, domain: "bad domain<script>", url: "https://ok.example/" },
      { type: "organic", rank_group: 3, domain: "WWW.Fine.example", url: "https://fine.example/page" },
      { type: "local_pack", rank_group: 1, title: "n".repeat(400), domain: "x<y" },
    ]);
    expect(r.serpTop).toEqual([{ position: 1, domain: "evil.example", url: null, title: "t".repeat(120) }, { position: 3, domain: "fine.example", url: "https://fine.example/page", title: null }]);
    expect(r.localPack[0]).toEqual({ position: 1, title: "n".repeat(160), domain: null });
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeDomain("a.b-c.com")).toBe("a.b-c.com");
  });
  it("business names compare without punctuation or company suffixes", () => {
    expect(normalizeBusinessName("Alpine Exteriors, LLC")).toBe("alpine exteriors");
    expect(normalizeBusinessName("The A&B Roofing Co.")).toBe("a and b roofing");
    expect(isOurListing({ title: "Alpine Exteriors - Siding Contractor" }, "x.com", "Alpine Exteriors")).toBe(true);
    expect(isOurListing({ title: "Alp" }, "x.com", "Alp")).toBe(false);
    expect(isOurListing({ title: "Someone Else", domain: "www.x.com" }, "x.com", null)).toBe(true);
  });
  it("task_post sends a keyword's own place when it has one", async () => {
    const calls = mockFetch(() => fixture("task_post"));
    await serpTaskPost({ tasks: [{ keyword: "roof repair", keywordId: 1, device: "desktop", locationCode: 1015214 }, { keyword: "siding", keywordId: 2, device: "desktop" }], locationCode: 2840, languageCode: "en", depth: 10, targetDomain: "x.com" }).catch(() => {});
    expect(calls[0].body.map((t: any) => t.location_code)).toEqual([1015214, 2840]);
  });
  it("task_get: completed, pending, no-results and failed outcomes", async () => {
    const input = { taskId: "10061512-1535-0066-0000-aaaaaaaaaaaa", keywordId: 11, keyword: "roofing contractor tampa", targetDomain: "constructhub.us" };
    const calls = mockFetch(() => fixture("task_get"));
    const done = await serpTaskGet(input);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/serp/google/organic/task_get/advanced/10061512-1535-0066-0000-aaaaaaaaaaaa" });
    expect(done).toMatchObject({ status: "completed", result: { position: 2 } });
    expect(parseTaskGet(fixture("task_get_pending"), input)).toEqual({ status: "pending" });
    expect(parseTaskGet(fixture("task_get_no_results"), input)).toMatchObject({ status: "completed", result: { position: null, url: null, serpFeatures: ["own:checked"] } });
    expect(parseTaskGet({ status_code: 20000, tasks: [{ status_code: 40101, status_message: "Internal SE Server Error." }] }, input)).toEqual({ status: "failed", message: "Internal SE Server Error." });
    expect(() => parseTaskGet({ status_code: 40400, status_message: "Not Found." }, input)).toThrow(DataForSeoError);
  });
});

describe("keyword research (Labs keyword_suggestions)", () => {
  it("parses volume, CPC, difficulty and intent; drops items without a keyword", async () => {
    const calls = mockFetch(() => fixture("keyword_suggestions"));
    const out = await labsKeywordSuggestions({ keyword: "roof repair", locationCode: 2840, languageCode: "en", limit: 50 });
    expect(calls[0].path).toBe("/dataforseo_labs/google/keyword_suggestions/live");
    expect(calls[0].body[0]).toMatchObject({ keyword: "roof repair", limit: 50, include_clickstream_data: false });
    expect(out.costUsd).toBe(0.01236);
    expect(out.data).toEqual([
      { keyword: "roof repair near me", searchVolume: 60500, cpc: 18.4, difficulty: 41, competition: 0.62, intent: "commercial" },
      { keyword: "emergency roof repair", searchVolume: 5400, cpc: null, difficulty: null, competition: null, intent: null },
    ]);
    expect(parseKeywordItem({ keyword_info: { search_volume: 5 } })).toBeNull();
  });
});

describe("competitor gap (Labs domain_intersection)", () => {
  it("asks for keywords only the competitor ranks for and parses both SERP elements", async () => {
    const calls = mockFetch(() => fixture("domain_intersection"));
    const out = await labsDomainIntersection({ competitor: "bigroofer.example", ours: "constructhub.us", locationCode: 2840, languageCode: "en", limit: 100 });
    expect(calls[0].path).toBe("/dataforseo_labs/google/domain_intersection/live");
    expect(calls[0].body[0]).toMatchObject({ target1: "bigroofer.example", target2: "constructhub.us", intersections: false, limit: 100, item_types: ["organic"] });
    expect(out.data.totalCount).toBe(912);
    expect(out.costUsd).toBe(0.01224);
    expect(out.data.items[0]).toEqual({ keyword: "metal roof cost", searchVolume: 33100, cpc: 9.12, difficulty: 58, competition: 0.41, intent: "informational", competitorPosition: 4, competitorUrl: "https://bigroofer.example/metal-roof-cost", ourPosition: null, etv: 1210.5 });
    expect(out.data.items[1]).toMatchObject({ keyword: "roof inspection checklist", competitorPosition: 1, difficulty: 12 });
    expect(parseIntersectionItem({ keyword_data: { keyword: "k" }, first_domain_serp_element: { rank_group: 3 }, second_domain_serp_element: { rank_group: 9 } })).toMatchObject({ competitorPosition: 3, ourPosition: 9 });
  });
});

describe("backlinks", () => {
  it("summary: rank, counts, new/lost (DataForSEO's misspelt keys included) and spam score", async () => {
    mockFetch(() => fixture("backlinks_summary"));
    const out = await backlinksSummary({ target: "constructhub.us" });
    expect(out.costUsd).toBe(0.024036);
    expect(out.data).toEqual({ target: "constructhub.us", rank: 112, backlinks: 348, referringDomains: 61, referringPages: 301, brokenBacklinks: 3, newBacklinks: 9, lostBacklinks: 4, newReferringDomains: 3, lostReferringDomains: 1, spamScore: 7 });
    expect(parseBacklinkSummary({})).toMatchObject({ rank: null, backlinks: null, spamScore: null });
  });
  it("list: one row per domain with dofollow, ranks, dates and flags", async () => {
    const calls = mockFetch(() => fixture("backlinks_list"));
    const out = await backlinksList({ target: "constructhub.us", limit: 100 });
    expect(calls[0].body[0]).toMatchObject({ target: "constructhub.us", limit: 100, mode: "one_per_domain", backlinks_status_type: "live", exclude_internal_backlinks: true });
    expect(out.data.totalCount).toBe(61);
    expect(out.data.items[0]).toEqual({ domainFrom: "builderdirectory.example", urlFrom: "https://builderdirectory.example/florida/permits", urlTo: "https://constructhub.us/", anchor: "ConstructHUB", dofollow: true, rank: 231, domainRank: 410, spamScore: 5, firstSeen: "2026-08-02 10:00:00 +00:00", lastSeen: "2026-10-01 09:12:00 +00:00", isNew: false, isLost: false });
    expect(out.data.items[1]).toMatchObject({ dofollow: false, anchor: null, spamScore: 80, isNew: true });
    expect(parseBacklinkRow(null)).toBeNull();
    expect(backlinksList({ target: "x.com", limit: 5000 }).catch(() => null)).resolves; // clamped, not thrown
    expect(calls[1]?.body[0].limit).toBe(1000);
  });
});

describe("search volume (Google Ads)", () => {
  it("parses volume / CPC / competition; keeps keywords Google has no data for as nulls", async () => {
    const calls = mockFetch(() => fixture("search_volume"));
    const out = await adsSearchVolume({ keywords: ["roofing contractor tampa", "zzz unknown keyword"], locationCode: 2840, languageCode: "en" });
    expect(calls[0].path).toBe("/keywords_data/google_ads/search_volume/live");
    expect(calls[0].body[0].keywords).toEqual(["roofing contractor tampa", "zzz unknown keyword"]);
    expect(out.costUsd).toBe(0.09);
    expect(out.data).toEqual([
      { keyword: "roofing contractor tampa", searchVolume: 1300, cpc: 22.7, competition: "HIGH" },
      { keyword: "zzz unknown keyword", searchVolume: null, cpc: null, competition: null },
    ]);
    expect(parseAdsVolumeItem({ search_volume: 1 })).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("reduces URLs and hosts to a bare registrable-looking hostname", () => {
    expect(normalizeDomain(" https://www.ConstructHUB.us/search?x=1 ")).toBe("constructhub.us");
    expect(normalizeDomain("blog.example.co.uk")).toBe("blog.example.co.uk");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});
