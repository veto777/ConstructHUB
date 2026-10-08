import { describe, expect, it } from "vitest";
import { renderSuggestions, buildRenderRow, fetchRender, parseSide, renderDeps, renderEstimateUsd, renderInput, renderUrls, renderVerdict, summariseRender, RENDER_BROWSER_USD, RENDER_PLAIN_USD } from "./render-check";
import { DataForSeoError } from "./dataforseo";

const item = (words: number | null, links: number | null, extra: Record<string, unknown> = {}) => ({ status_code: 200, meta: { title: "Alpine Exteriors", htags: { h1: ["Siding contractors"] }, content: { plain_text_word_count: words }, internal_links_count: links, external_links_count: 7, images_count: 6 }, ...extra });
const ok = (it: unknown, cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ items: it ? [it] : [] }] }] });

describe("rendering check", () => {
  it("checks pages of the site itself only, each once", () => {
    expect(renderUrls(["https://www.alpine.example/roofing#top", "https://alpine.example/roofing", "https://blog.alpine.example/x", "https://other.example/", "javascript:alert(1)", "https://notalpine.example/"], "alpine.example"))
      .toEqual(["https://www.alpine.example/roofing", "https://alpine.example/roofing", "https://blog.alpine.example/x"]);
    // Offered: one page from each section in turn, not a dozen from the same template.
    expect(renderSuggestions(["https://a.example/", "https://a.example/compare/1", "https://a.example/compare/2", "https://a.example/compare/3", "https://a.example/roofing", "https://a.example/blog/x", "https://b.example/"], "a.example", 5))
      .toEqual(["https://a.example/", "https://a.example/compare/1", "https://a.example/roofing", "https://a.example/blog/x", "https://a.example/compare/2"]);
    expect(renderInput.safeParse({ urls: [] }).success).toBe(false);
    expect(renderInput.safeParse({ urls: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }).success).toBe(false);
    expect(renderEstimateUsd(10)).toBeGreaterThan(10 * (RENDER_PLAIN_USD + RENDER_BROWSER_USD));
  });
  it("reads one fetch", () => {
    expect(parseSide(item(412, 99))).toEqual({ status: 200, words: 412, internalLinks: 99, externalLinks: 7, images: 6, title: "Alpine Exteriors", h1: "Siding contractors" });
    expect(parseSide({ status_code: 200, meta: {} })).toEqual({ status: 200, words: null, internalLinks: null, externalLinks: null, images: null, title: null, h1: null });
    expect(parseSide(null)).toBeNull();
  });
  it("says a page depends on JavaScript only when the rendered page clearly has more for a search engine to read", () => {
    const side = (words: number | null, links: number | null, extra = {}) => ({ ...parseSide(item(words, links))!, ...extra });
    expect(renderVerdict(side(412, 99), side(415, 98)).verdict).toBe("same");
    // Words: half as many again AND at least a hundred more.
    expect(renderVerdict(side(40, 3), side(900, 60))).toMatchObject({ verdict: "needs_js" });
    expect(renderVerdict(side(40, 3), side(900, 60)).why).toContain("40 words in the HTML, 900 once JavaScript has run");
    expect(renderVerdict(side(400, 30), side(480, 32)).verdict).toBe("same");   // 20% more is not dependence
    expect(renderVerdict(side(20, 30), side(60, 30)).verdict).toBe("same");     // three times as many, but only 40 words
    // Links: the navigation only exists once rendered.
    expect(renderVerdict(side(400, 2), side(410, 48)).verdict).toBe("needs_js");
    // Title or main heading that JavaScript writes.
    expect(renderVerdict(side(400, 30, { h1: null }), side(400, 30)).why).toContain("main heading only exists once rendered");
    // One side missing: nothing is claimed.
    expect(renderVerdict(null, side(400, 30)).verdict).toBe("unknown");
    expect(renderVerdict(side(400, 30), null).verdict).toBe("unknown");
    // A number the source left out is not a zero.
    expect(renderVerdict(side(null, 30), side(900, 30)).verdict).toBe("same");
  });
  it("builds a row: both sides, timings from the browser fetch, and only real problems", () => {
    const row = buildRenderRow("https://alpine.example/", item(40, 3), item(900, 60, { page_timing: { largest_contentful_paint: 1988, time_to_interactive: 900, dom_complete: 3397 }, checks: { high_loading_time: true, is_https: true, has_render_blocking_resources: true, seo_friendly_url: true, no_h1_tag: false } }));
    expect(row).toMatchObject({ verdict: "needs_js", timing: { lcp: 1988, interactive: 900, loaded: 3397 }, problems: ["Slow to load", "Files that hold up the first paint"] });
    expect(buildRenderRow("https://alpine.example/", item(40, 3), null)).toMatchObject({ verdict: "unknown", timing: null, problems: [] });
    expect(summariseRender([row, buildRenderRow("u", item(400, 30), item(410, 31)), buildRenderRow("u", null, null)])).toEqual({ pages: 3, needsJs: 1, same: 1, unknown: 1 });
  });
  it("the customer pays for the fetches that returned; a failed one leaves its side unknown; nothing at all fails the run", async () => {
    const real = renderDeps.request;
    try {
      // Two pages. The browser fetch of the second times out.
      renderDeps.request = (async (_m: string, _p: string, body: any) => {
        const { url, enable_javascript: js } = body[0];
        if (js && url.endsWith("/b")) throw new DataForSeoError("timeout", "timed out");
        return ok(item(js ? 900 : 40, js ? 60 : 3), js ? RENDER_BROWSER_USD : RENDER_PLAIN_USD);
      }) as any;
      const out = await fetchRender(["https://alpine.example/a", "https://alpine.example/b"]);
      expect(out.data.rows.map((r) => r.verdict)).toEqual(["needs_js", "unknown"]);
      expect(out.data.summary).toEqual({ pages: 2, needsJs: 1, same: 0, unknown: 1 });
      expect(out.customerUsd).toBeCloseTo(2 * RENDER_PLAIN_USD + RENDER_BROWSER_USD, 6);
      // Ours: those three plus an allowance for the fetch whose cost we never learned — inside what was reserved.
      expect(out.costUsd).toBeCloseTo(2 * (RENDER_PLAIN_USD + RENDER_BROWSER_USD), 6);
      expect(out.costUsd).toBeLessThanOrEqual(renderEstimateUsd(2));
      expect(out.costUnknown).toBe(false);
      renderDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      const failed: any = await fetchRender(["https://alpine.example/a"]).catch((e) => e);
      expect(failed).toBeInstanceOf(Error);
      expect(failed.costUnknown).toBe(false);
      // Refused without being billed: asked once more, and the second answer is used.
      let calls = 0; renderDeps.retryMs = 1;
      renderDeps.request = (async (_m: string, _p: string, body: any) => { calls++; if (body[0].enable_javascript && calls <= 2) throw new DataForSeoError("rate_limited", "busy"); return ok(item(400, 30), 0.001); }) as any;
      const again = await fetchRender(["https://alpine.example/a"]);
      expect(again.data.rows[0].verdict).toBe("same");
      expect(again.customerUsd).toBeCloseTo(0.002, 6);
      // A fetch that returns no page at all is the same as nothing.
      renderDeps.request = (async () => ok(null, 0.0001)) as any;
      expect(await fetchRender(["https://alpine.example/a"]).catch((e) => e)).toBeInstanceOf(Error);
    } finally { renderDeps.request = real; }
  });
});
