import { describe, expect, it } from "vitest";
import { renderSuggestions, buildRenderRow, fetchRender, parseSide, renderDeps, renderEstimateUsd, renderInput, renderUrl, renderUrls, renderVerdict, summariseRender, RENDER_BROWSER_USD, RENDER_PLAIN_USD } from "./render-check";
import { DataForSeoError } from "./dataforseo";

const item = (words: number | null, links: number | null, extra: Record<string, unknown> = {}) => ({ status_code: 200, url: "https://alpine.example/", meta: { title: "Alpine Exteriors", htags: { h1: ["Siding contractors"] }, content: { plain_text_word_count: words }, internal_links_count: links, external_links_count: 7, images_count: 6 }, ...extra });
const ok = (it: unknown, cost: number | undefined) => ({ status_code: 20000, tasks: [{ status_code: 20000, ...(cost === undefined ? {} : { cost }), result: [{ items: it ? [it] : [] }] }] });
const failedTask = (cost: number | undefined) => ({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field", ...(cost === undefined ? {} : { cost }), result: null }] });

describe("rendering check", () => {
  it("checks pages of the site itself only: no other site, look-alike, sign-in, port or bare address", () => {
    expect(renderUrls(["https://www.alpine.example/roofing#top", "https://alpine.example/roofing", "https://blog.alpine.example/x", "https://other.example/", "javascript:alert(1)", "https://notalpine.example/"], "alpine.example"))
      .toEqual(["https://www.alpine.example/roofing", "https://alpine.example/roofing", "https://blog.alpine.example/x"]);
    for (const bad of ["https://user:pw@alpine.example/", "https://alpine.example:8443/admin", "http://127.0.0.1/", "http://[::1]/", "https://alpine.example.evil.test/", "https://localhost/", "ftp://alpine.example/", 42, `https://alpine.example/${"x".repeat(600)}`])
      expect(renderUrl(bad, "alpine.example"), String(bad).slice(0, 40)).toBeNull();
    expect(renderUrl(" https://alpine.example/a?b=1#c ", "alpine.example")).toBe("https://alpine.example/a?b=1");
    expect(renderInput.safeParse({ urls: [] }).success).toBe(false);
    expect(renderInput.safeParse({ urls: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }).success).toBe(false);
    expect(renderEstimateUsd(10)).toBeGreaterThan(10 * (RENDER_PLAIN_USD + RENDER_BROWSER_USD));
    // Offered: one page from each section in turn, not a dozen from the same template.
    expect(renderSuggestions(["https://a.example/", "https://a.example/compare/1", "https://a.example/compare/2", "https://a.example/compare/3", "https://a.example/roofing", "https://a.example/blog/x", "https://b.example/"], "a.example", 5))
      .toEqual(["https://a.example/", "https://a.example/compare/1", "https://a.example/roofing", "https://a.example/blog/x", "https://a.example/compare/2"]);
  });
  it("reads one fetch; an answer without measurements says so", () => {
    expect(parseSide(item(412, 99))).toEqual({ status: 200, finalUrl: "https://alpine.example/", measured: true, words: 412, internalLinks: 99, externalLinks: 7, images: 6, title: "Alpine Exteriors", h1: "Siding contractors" });
    expect(parseSide({ status_code: 200, meta: {} })).toMatchObject({ status: 200, measured: false, words: null, title: null });
    expect(parseSide({ status_code: 403 })).toMatchObject({ status: 403, measured: false });
    expect(parseSide(null)).toBeNull();
  });
  it("says more, less or the same only for two successful, comparable, measured visits", () => {
    const side = (words: number | null, links: number | null, extra = {}) => ({ ...parseSide(item(words, links))!, ...extra });
    expect(renderVerdict(side(412, 99), side(415, 98)).verdict).toBe("same");
    // Words: half as many again AND at least a hundred more.
    expect(renderVerdict(side(40, 3), side(900, 60))).toMatchObject({ verdict: "more" });
    expect(renderVerdict(side(40, 3), side(900, 60)).why).toContain("40 words in the HTML, 900 in the browser visit");
    expect(renderVerdict(side(400, 30), side(480, 32)).verdict).toBe("same");   // 20% more is not a finding
    expect(renderVerdict(side(20, 30), side(60, 30)).verdict).toBe("same");     // three times as many, but only 40 words
    expect(renderVerdict(side(400, 2), side(410, 48)).verdict).toBe("more");    // the navigation only exists once rendered
    expect(renderVerdict(side(400, 30, { h1: null }), side(400, 30)).why).toContain("a main heading in the browser visit and none in the HTML");
    // The other way round is a finding too, not "the same".
    expect(renderVerdict(side(1500, 80), side(300, 12))).toMatchObject({ verdict: "less" });
    expect(renderVerdict(side(400, 30), side(400, 30, { title: null })).verdict).toBe("less");
    // Nothing is claimed when a side is missing, was not answered 2xx, ended elsewhere, or was not measured.
    expect(renderVerdict(null, side(400, 30)).verdict).toBe("unknown");
    expect(renderVerdict(side(400, 30), null).verdict).toBe("unknown");
    expect(renderVerdict(side(12, 0, { status: 403 }), side(900, 60))).toMatchObject({ verdict: "unknown" });
    expect(renderVerdict(side(12, 0, { status: 403 }), side(900, 60)).why).toContain("answered 403");
    expect(renderVerdict(side(0, 0, { status: 301 }), side(900, 60)).verdict).toBe("unknown");
    expect(renderVerdict(side(400, 30), side(400, 30, { status: null })).verdict).toBe("unknown");
    expect(renderVerdict(side(40, 3), side(900, 60, { finalUrl: "https://alpine.example/other" })).verdict).toBe("unknown");
    expect(renderVerdict(side(40, 3), side(900, 60, { finalUrl: "https://login.elsewhere.test/" }), "alpine.example").verdict).toBe("unknown");
    expect(renderVerdict(side(40, 3, { finalUrl: "http://www.alpine.example" }), side(900, 60), "alpine.example").verdict).toBe("more"); // the same page, written another way
    expect(renderVerdict(side(null, null, { measured: false, title: null, h1: null }), side(900, 60)).verdict).toBe("unknown");
    // A number the source left out is not a zero — and without it the page is not called the same.
    expect(renderVerdict(side(null, 30), side(900, 30)).verdict).toBe("unknown");
    expect(renderVerdict(side(null, 2), side(900, 48)).verdict).toBe("more");   // but what WAS measured can still show a difference
  });
  it("builds a row: both sides, timings and problems from a successful browser visit only", () => {
    const timing = { page_timing: { largest_contentful_paint: 1988, time_to_interactive: 900, dom_complete: 3397 }, checks: { high_loading_time: true, is_https: true, has_render_blocking_resources: true, seo_friendly_url: true, no_h1_tag: false } };
    const row = buildRenderRow("https://alpine.example/", item(40, 3), item(900, 60, timing));
    expect(row).toMatchObject({ verdict: "more", timing: { lcp: 1988, interactive: 900, loaded: 3397 }, problems: ["Slow to load", "Files that hold up the first paint"] });
    expect(buildRenderRow("https://alpine.example/", item(40, 3), null)).toMatchObject({ verdict: "unknown", timing: null, problems: [] });
    expect(buildRenderRow("https://alpine.example/", item(40, 3), item(900, 60, { ...timing, status_code: 503 }))).toMatchObject({ verdict: "unknown", timing: null, problems: [] });
    expect(summariseRender([row, buildRenderRow("u", item(400, 30), item(410, 31)), buildRenderRow("u", null, null), buildRenderRow("u", item(1500, 80), item(300, 12))])).toEqual({ pages: 4, more: 1, less: 1, same: 1, unknown: 1 });
  });
  it("the customer pays for the fetches that returned, never more than the figure shown; a failed one leaves its side unknown", async () => {
    const real = renderDeps.request; renderDeps.retryMs = 1;
    try {
      // Two pages. The browser fetch of the second times out.
      renderDeps.request = (async (_m: string, _p: string, body: any) => {
        const { url, enable_javascript: js } = body[0];
        if (js && url.endsWith("/b")) throw new DataForSeoError("timeout", "timed out");
        return ok(item(js ? 900 : 40, js ? 60 : 3), js ? RENDER_BROWSER_USD : RENDER_PLAIN_USD);
      }) as any;
      const out = await fetchRender(["https://alpine.example/a", "https://alpine.example/b"]);
      expect(out.data.rows.map((r) => r.verdict)).toEqual(["more", "unknown"]);
      expect(out.data.summary).toEqual({ pages: 2, more: 1, less: 0, same: 0, unknown: 1 });
      expect(out.customerUsd).toBeCloseTo(2 * RENDER_PLAIN_USD + RENDER_BROWSER_USD, 6);
      // Ours: those three plus an allowance for the fetch whose cost we never learned — inside what was reserved.
      expect(out.costUsd).toBeCloseTo(2 * (RENDER_PLAIN_USD + RENDER_BROWSER_USD), 6);
      expect(out.costUsd).toBeLessThanOrEqual(renderEstimateUsd(2));
      expect(out.costUnknown).toBe(false);
      // A source that charges more than expected: the customer still pays no more than the figure they were shown.
      renderDeps.request = (async () => ok(item(400, 30), 1)) as any;
      expect((await fetchRender(["https://alpine.example/a"])).customerUsd).toBe(renderEstimateUsd(1));
      renderDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      const failed: any = await fetchRender(["https://alpine.example/a"]).catch((e) => e);
      expect(failed).toBeInstanceOf(Error);
      expect(failed.costUnknown).toBe(false);
    } finally { renderDeps.request = real; }
  });
  it("asks a second time only when the source said the first cost nothing", async () => {
    const real = renderDeps.request; renderDeps.retryMs = 1;
    const run = async (first: unknown) => {
      let calls = 0;
      renderDeps.request = (async (_m: string, _p: string, body: any) => { calls++; if (body[0].enable_javascript && calls <= 2) return first; return ok(item(400, 30), 0.001); }) as any;
      const out = await fetchRender(["https://alpine.example/a"]);
      return { calls, verdict: out.data.rows[0].verdict, customerUsd: out.customerUsd, costUsd: out.costUsd };
    };
    try {
      // A failed task that states a cost of exactly 0, and a request refused outright: both are asked again.
      expect(await run(failedTask(0))).toMatchObject({ verdict: "same", customerUsd: 0.002 });
      expect(await run({ status_code: 40202, status_message: "Rate limit", tasks: [] })).toMatchObject({ verdict: "same", customerUsd: 0.002 });
      // A failed task with no cost stated may have been billed: not asked again, and allowed for in our own figure.
      const unstated = await run(failedTask(undefined));
      expect(unstated.verdict).toBe("unknown");
      expect(unstated.costUsd).toBeCloseTo(0.001 + RENDER_BROWSER_USD, 6);
      // One that was billed and returned nothing: not asked again, and not the customer's to pay.
      const billed = await run(failedTask(0.0051));
      expect([billed.verdict, billed.customerUsd]).toEqual(["unknown", 0.001]);
      // An answer with no page and no cost stated is not "free".
      expect((await run(ok(null, undefined))).verdict).toBe("unknown");
      // Nothing at all returned: the run fails.
      renderDeps.request = (async () => ok(null, 0.0001)) as any;
      expect(await fetchRender(["https://alpine.example/a"]).catch((e) => e)).toBeInstanceOf(Error);
    } finally { renderDeps.request = real; }
  });
});
