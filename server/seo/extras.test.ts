import { describe, expect, it } from "vitest";
import { mergePageMetrics, retryPlan, planEstimateUsd, buildPageMetrics, cleanUrls, fetchPageMetrics, pageMetricsDeps, pageMetricsEstimateUsd, pageMetricsInput } from "./page-metrics";
import { mergeDirectories, buildDirectories, DIRECTORIES, directoriesEstimateUsd, directoriesInput, directoryRequest, fetchDirectories, directoriesDeps } from "./directories";
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
    const urls = ["https://a.example/guide/", "https://b.example/post", "https://c.example/", "https://a.example/guide", "https://a.example/Guide/", "https://d.example/x"];
    const links = [{ target: "https://a.example/guide/", referring_domains: 9, referring_main_domains: 7 }, { target: "https://b.example/post", referring_domains: 0, referring_main_domains: 0 }, { target: "https://a.example/guide", referring_main_domains: 2 }];
    const traffic = [{ target: "https://a.example/guide/", metrics: { organic: { etv: 220.9, count: 497 } } }, { target: "https://b.example/post", metrics: { organic: { etv: 0, count: 0 } } }, { target: "https://d.example/x", metrics: {} }];
    expect(buildPageMetrics(urls, links, traffic, "t").rows).toEqual([
      { url: urls[0], linkingSites: 7, traffic: 221, keywords: 497 },
      { url: urls[1], linkingSites: 0, traffic: 0, keywords: 0 },            // the source answered: none
      { url: urls[2], linkingSites: null, traffic: null, keywords: null },   // left out of both answers: unknown, never zero
      { url: urls[3], linkingSites: 2, traffic: null, keywords: null },      // without the slash it is another page, with its own numbers
      { url: urls[4], linkingSites: null, traffic: null, keywords: null },   // and so is another spelling of the path
      { url: urls[5], linkingSites: null, traffic: null, keywords: null },   // answered without figures: unknown
    ]);
    // A second try for the part that had not loaded fills in that part only.
    const first = buildPageMetrics(urls.slice(0, 2), links, null, "t0"), second = buildPageMetrics(urls.slice(0, 2), null, traffic, "t1");
    const plan = retryPlan(first);
    expect(plan).toEqual({ links: [], traffic: urls.slice(0, 2) });
    expect(mergePageMetrics(first, second, plan)).toEqual({ rows: [{ url: urls[0], linkingSites: 7, traffic: 221, keywords: 497 }, { url: urls[1], linkingSites: 0, traffic: 0, keywords: 0 }], missing: [], fetchedAt: "t0" });
    // A lookup that loaded but left a page out: that page can be asked about again — and a figure that was known is never replaced by an unknown one.
    const full = buildPageMetrics(urls.slice(0, 3), links, traffic, "t0");
    expect(retryPlan(full)).toEqual({ links: [urls[2]], traffic: [urls[2]] });
    const worse = buildPageMetrics(urls.slice(0, 3), [], [], "t1");
    expect(mergePageMetrics(full, worse, retryPlan(full))).toEqual(full);
    // A second try that was not made for a lookup leaves that lookup "missing".
    expect(mergePageMetrics(first, buildPageMetrics(urls.slice(0, 2), null, null, "t1"), { links: [], traffic: urls.slice(0, 2) }).missing).toEqual(["traffic"]);
    expect(planEstimateUsd({ links: [], traffic: urls }) + planEstimateUsd({ links: urls, traffic: [] })).toBeCloseTo(pageMetricsEstimateUsd(urls.length), 6);
    expect(planEstimateUsd({ links: [], traffic: [] })).toBe(0);
    const half = buildPageMetrics(urls, null, traffic, "t");
    expect([half.missing, half.rows[0].linkingSites, half.rows[0].traffic]).toEqual([["links"], null, 221]);
    const noTraffic = buildPageMetrics(urls, links, null, "t");
    expect([noTraffic.missing, noTraffic.rows[0].traffic, noTraffic.rows[0].keywords, noTraffic.rows[0].linkingSites]).toEqual([["traffic"], null, null, 7]);
  });
  it("one lookup failing is not charged and leaves the other usable; both failing fails", async () => {
    const real = pageMetricsDeps.request;
    try {
      pageMetricsDeps.request = (async (_m: string, path: string) => { if (path.includes("bulk_traffic")) throw new DataForSeoError("task_failed", "no", 0.003); return ok([{ target: "https://a.example/", referring_main_domains: 3 }], 0.0241); }) as any;
      const out = await fetchPageMetrics({ urls: ["https://a.example/"], locationCode: 2840, languageCode: "en" });
      expect([out.data.missing, out.data.rows[0].linkingSites]).toEqual([["traffic"], 3]);
      expect(out.customerUsd).toBeCloseTo(0.0241, 6); expect(out.costUsd).toBeCloseTo(0.0271, 6);
      // Asked for one part only: the other lookup is not made.
      const paths: string[] = [];
      pageMetricsDeps.request = (async (_m: string, path: string) => { paths.push(path); return ok([{ target: "https://a.example/", metrics: { organic: { etv: 5, count: 2 } } }], 0.01); }) as any;
      let asked: unknown = null;
      pageMetricsDeps.request = (async (_m: string, path: string, body: any) => { paths.push(path); asked = body[0].targets; return ok([{ target: "https://a.example/", metrics: { organic: { etv: 5, count: 2 } } }], 0.01); }) as any;
      const part = await fetchPageMetrics({ urls: ["https://a.example/", "https://b.example/"], locationCode: 2840, languageCode: "en" }, { links: [], traffic: ["https://a.example/"] });
      expect([paths.length, asked, part.data.missing, part.data.rows[0].traffic, part.data.rows[1].traffic, part.customerUsd]).toEqual([1, ["https://a.example/"], ["links"], 5, null, 0.01]);
      pageMetricsDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      expect(await fetchPageMetrics({ urls: ["https://a.example/"], locationCode: 2840, languageCode: "en" }).catch((e) => e)).toBeInstanceOf(DataForSeoError);
    } finally { pageMetricsDeps.request = real; }
  });
});

describe("directories", () => {
  it("asks for one site's linking sites, narrowed to the list", () => {
    const r = directoryRequest("alpine.example");
    expect(r).toMatchObject({ target: "alpine.example", backlinks_status_type: "live", include_subdomains: true });
    // The directory itself or any sub-domain of it — and nothing that merely ends or begins the same way.
    expect(r.filters.slice(0, 2)).toEqual(["domain", "regex"]);
    const re = new RegExp(r.filters[2] as string);
    expect(["yelp.com", "m.yelp.com", "www.bbb.org"].every((d) => re.test(d))).toBe(true);
    expect(["notyelp.com", "yelp.com.evil", "yelpxcom", "bbb.org.uk"].some((d) => re.test(d))).toBe(false);
    expect(new Set(DIRECTORIES.map((d) => d.domain)).size).toBe(DIRECTORIES.length);
    expect(directoriesInput.safeParse({ domain: "a.com", competitors: ["b.com", "c.com", "d.com", "e.com"] }).success).toBe(false);
    expect(directoriesEstimateUsd(2)).toBeCloseTo(2 * directoriesEstimateUsd(1), 6);
  });
  it("one row per directory, one column per site; a site that did not load is unknown, not empty", () => {
    const page = buildDirectories(["us.example", "rival.example", "other.example"], [
      [{ domain: "www.yelp.com", backlinks: 2 }, { domain: "m.yelp.com", backlinks: 1 }, { domain: "notyelp.com", backlinks: 9 }, { domain: "bbb.org" }, { domain: "houzz.com", backlinks: 0 }],
      [{ domain: "porch.com", backlinks: 4 }],
      null,
    ], "t");
    const row = (d: string) => page.rows.find((r) => r.domain === d)!.links;
    expect(page.rows).toHaveLength(DIRECTORIES.length);
    expect([row("yelp.com"), row("bbb.org"), row("porch.com"), row("houzz.com")]).toEqual([[3, 0, null], [1, 0, null], [0, 4, null], [0, 0, null]]);
    expect(page.missing).toEqual(["other.example"]);
    // A link found without a count is a link, shown without a number; a row that says no links is not one.
    expect(page.rows.find((r) => r.domain === "bbb.org")!.uncounted).toEqual([true, false, false]);
    expect(page.rows.find((r) => r.domain === "yelp.com")!.uncounted).toBeUndefined();
    // An answer that was cut short: a directory not among its rows was not looked at — unknown, so it can never be a gap.
    const cut = buildDirectories(["us.example", "rival.example"], [[{ domain: "yelp.com", backlinks: 2 }], [{ domain: "porch.com", backlinks: 4 }]], "t", [true, false]);
    expect([cut.partial, cut.rows.find((r) => r.domain === "yelp.com")!.links, cut.rows.find((r) => r.domain === "porch.com")!.links]).toEqual([["us.example"], [2, 0], [null, 4]]);
    expect(page.partial).toBeUndefined();
    // A second try for the site that did not load fills its column only; the columns that loaded are not touched.
    const second = buildDirectories(["other.example"], [[{ domain: "yelp.com", backlinks: 5 }, { domain: "bbb.org" }]], "t2");
    const whole = mergeDirectories(page, second);
    expect([whole.missing, whole.fetchedAt, whole.rows.find((r) => r.domain === "yelp.com")!.links, whole.rows.find((r) => r.domain === "porch.com")!.links]).toEqual([[], "t", [3, 0, 5], [0, 4, 0]]);
    expect(whole.rows.find((r) => r.domain === "bbb.org")!.uncounted).toEqual([true, false, true]);
    // A second try that failed again changes nothing.
    expect(mergeDirectories(page, buildDirectories(["other.example"], [null], "t2"))).toEqual(page);
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
