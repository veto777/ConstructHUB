import { describe, expect, it } from "vitest";
import { buildPageMetrics, cleanUrls, fetchPageMetrics, pageMetricsDeps, pageMetricsEstimateUsd, pageMetricsInput } from "./page-metrics";
import { buildDirectories, DIRECTORIES, directoriesEstimateUsd, directoriesInput, directoryRequest, fetchDirectories, directoriesDeps } from "./directories";
import { DataForSeoError } from "./dataforseo";

const ok = (items: unknown[], cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ items }] }] });

describe("numbers for a list of pages", () => {
  it("takes web addresses only, each once, in the order given", () => {
    expect(cleanUrls(["https://a.example/x#top", "https://a.example/x", "javascript:alert(1)", "not a url", "http://b.example/"])).toEqual(["https://a.example/x", "http://b.example/"]);
    expect(pageMetricsInput.safeParse({ urls: [] }).success).toBe(false);
    expect(pageMetricsInput.safeParse({ urls: Array.from({ length: 101 }, (_, i) => `https://a.example/${i}`) }).success).toBe(false);
    expect(pageMetricsEstimateUsd(25)).toBeGreaterThan(0.03);
  });
  it("answers for each page asked about; what the source left out is unknown, and a part that failed is missing — never zero", () => {
    const urls = ["https://a.example/guide/", "https://b.example/post", "https://c.example/"];
    const links = [{ target: "https://a.example/guide/", referring_domains: 9, referring_main_domains: 7 }, { target: "https://b.example/post", referring_domains: 0, referring_main_domains: 0 }];
    const traffic = [{ target: "https://a.example/guide", metrics: { organic: { etv: 220.9, count: 497 } } }];
    expect(buildPageMetrics(urls, links, traffic, "t").rows).toEqual([
      { url: urls[0], linkingSites: 7, traffic: 221, keywords: 497 },   // a trailing slash is the same page
      { url: urls[1], linkingSites: 0, traffic: 0, keywords: 0 },        // the source answered: none
      { url: urls[2], linkingSites: null, traffic: 0, keywords: 0 },     // not in the links answer: unknown
    ]);
    const half = buildPageMetrics(urls, null, traffic, "t");
    expect([half.missing, half.rows[0].linkingSites, half.rows[0].traffic]).toEqual([["links"], null, 221]);
    expect(buildPageMetrics(urls, links, null, "t")).toMatchObject({ missing: ["traffic"], rows: [{ traffic: null, keywords: null }, {}, {}] });
  });
  it("one lookup failing is not charged and leaves the other usable; both failing fails", async () => {
    const real = pageMetricsDeps.request;
    try {
      pageMetricsDeps.request = (async (_m: string, path: string) => { if (path.includes("bulk_traffic")) throw new DataForSeoError("task_failed", "no", 0.003); return ok([{ target: "https://a.example/", referring_main_domains: 3 }], 0.0241); }) as any;
      const out = await fetchPageMetrics({ urls: ["https://a.example/"], locationCode: 2840, languageCode: "en" });
      expect([out.data.missing, out.data.rows[0].linkingSites]).toEqual([["traffic"], 3]);
      expect(out.customerUsd).toBeCloseTo(0.0241, 6); expect(out.costUsd).toBeCloseTo(0.0271, 6);
      pageMetricsDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      expect(await fetchPageMetrics({ urls: ["https://a.example/"], locationCode: 2840, languageCode: "en" }).catch((e) => e)).toBeInstanceOf(DataForSeoError);
    } finally { pageMetricsDeps.request = real; }
  });
});

describe("directories", () => {
  it("asks for one site's linking sites, narrowed to the list", () => {
    const r = directoryRequest("alpine.example");
    expect(r).toMatchObject({ target: "alpine.example", backlinks_status_type: "live", include_subdomains: true });
    expect(r.filters).toEqual(["domain", "in", DIRECTORIES.map((d) => d.domain)]);
    expect(new Set(DIRECTORIES.map((d) => d.domain)).size).toBe(DIRECTORIES.length);
    expect(directoriesInput.safeParse({ domain: "a.com", competitors: ["b.com", "c.com", "d.com", "e.com"] }).success).toBe(false);
    expect(directoriesEstimateUsd(2)).toBeCloseTo(2 * directoriesEstimateUsd(1), 6);
  });
  it("one row per directory, one column per site; a site that did not load is unknown, not empty", () => {
    const page = buildDirectories(["us.example", "rival.example", "other.example"], [
      [{ domain: "www.yelp.com", backlinks: 2 }, { domain: "m.yelp.com", backlinks: 1 }, { domain: "notyelp.com", backlinks: 9 }, { domain: "bbb.org" }],
      [{ domain: "porch.com", backlinks: 4 }],
      null,
    ], "t");
    const row = (d: string) => page.rows.find((r) => r.domain === d)!.links;
    expect(page.rows).toHaveLength(DIRECTORIES.length);
    expect([row("yelp.com"), row("bbb.org"), row("porch.com"), row("houzz.com")]).toEqual([[3, 0, null], [1, 0, null], [0, 4, null], [0, 0, null]]);
    expect(page.missing).toEqual(["other.example"]);
  });
  it("a site whose lookup fails is not charged; all failing fails", async () => {
    const real = directoriesDeps.request;
    try {
      directoriesDeps.request = (async (_m: string, _p: string, body: any) => { if (body[0].target === "rival.example") throw new DataForSeoError("task_failed", "no", 0.002); return ok([{ domain: "yelp.com", backlinks: 1 }], 0.024); }) as any;
      const out = await fetchDirectories(["us.example", "rival.example"]);
      expect([out.data.missing, out.customerUsd, out.costUsd]).toEqual([["rival.example"], 0.024, 0.026]);
      directoriesDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      expect(await fetchDirectories(["us.example"]).catch((e) => e)).toBeInstanceOf(DataForSeoError);
    } finally { directoriesDeps.request = real; }
  });
});
