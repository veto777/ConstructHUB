import { afterEach, describe, expect, it } from "vitest";
import { contentDeps, contentInput, contentRequest, fetchContent, parseContentItem } from "./content";

const original = { ...contentDeps };
afterEach(() => { Object.assign(contentDeps, original); });
const now = new Date("2026-10-08T12:00:00Z");

describe("contentInput", () => {
  it("takes a topic and bounded options", () => {
    expect(contentInput.parse({ query: " fiber cement siding cost " })).toMatchObject({ query: "fiber cement siding cost", sort: "relevance", limit: 25, offset: 0, peek: false });
    expect(contentInput.safeParse({ query: "x" }).success).toBe(false);
    expect(contentInput.safeParse({ query: "50% off" }).success).toBe(false);
    expect(contentInput.safeParse({ query: "siding", sinceDays: 45 }).success).toBe(false);
    expect(contentInput.safeParse({ query: "siding", minAuthority: 0 }).success).toBe(false);
    expect(contentInput.safeParse({ query: "siding", extra: 1 }).success).toBe(false);
  });
});

describe("contentRequest", () => {
  it("a plain search: English pages, most relevant first", () => {
    expect(contentRequest(contentInput.parse({ query: "siding cost" }), now)).toEqual({ keyword: "siding cost", search_mode: "as_is", limit: 25, offset: 0, order_by: ["score,desc"], filters: [["language", "=", "en"]] });
  });
  it("every filter becomes a clause, joined with and", () => {
    const b: any = contentRequest(contentInput.parse({ query: "siding cost", sort: "authority", sinceDays: 90, minAuthority: 30, kind: "blogs", exclude: "https://www.Angi.com/x", limit: 50, offset: 50 }), now);
    expect(b.order_by).toEqual(["domain_rank,desc"]);
    expect(b.page_type).toEqual(["blogs"]);
    expect([b.limit, b.offset]).toEqual([50, 50]);
    expect(b.filters).toEqual([["language", "=", "en"], "and", ["domain_rank", ">=", 300], "and", ["content_info.date_published", ">", "2026-07-10 12:00:00 +00:00"], "and", ["content_info.date_published", "<", "2026-10-09 12:00:00 +00:00"], "and", ["main_domain", "<>", "angi.com"]]);
  });
  it("newest never leads with pages dated in the future", () => {
    const b: any = contentRequest(contentInput.parse({ query: "siding", sort: "newest" }), now);
    expect(b.order_by).toEqual(["content_info.date_published,desc"]);
    expect(b.filters).toContainEqual(["content_info.date_published", "<", "2026-10-09 12:00:00 +00:00"]);
  });
});

describe("parseContentItem", () => {
  const item = { url: "https://example.com/siding-cost?x=1", domain: "www.example.com", main_domain: "example.com", domain_rank: 412, content_info: { title: "A section heading", main_title: "  What fiber cement\n siding costs ", snippet: "It depends.", date_published: "2026-03-10 09:22:44 +00:00", content_quality_score: 92, author: "Jo" } };
  it("reads a result", () => {
    expect(parseContentItem(item)).toEqual({ url: "https://example.com/siding-cost?x=1", domain: "example.com", title: "What fiber cement siding costs", snippet: "It depends.", authority: 41, published: "2026-03-10", quality: 92, author: "Jo" });
  });
  it("falls back to the section title, then the site; drops what is unsafe or unusable", () => {
    expect(parseContentItem({ ...item, content_info: { title: "Section" } })).toMatchObject({ title: "Section", published: null, quality: null, snippet: null });
    expect(parseContentItem({ url: "https://a.com/", domain: "a.com" })).toMatchObject({ title: "a.com", authority: null });
    expect(parseContentItem({ ...item, url: "javascript:alert(1)" })).toBeNull();
    expect(parseContentItem({ ...item, domain: "bad domain", main_domain: null })).toBeNull();
    expect(parseContentItem(null)).toBeNull();
  });
});

describe("fetchContent", () => {
  it("lists each page once and reports what the source returned, for paging", async () => {
    let sent: any = null;
    contentDeps.request = (async (_m: string, path: string, body: any) => {
      sent = { path, body: body[0] };
      return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02418, result: [{ total_count: 84950, items: [
        { url: "https://a.com/x", domain: "a.com", domain_rank: 300, content_info: { main_title: "One" } },
        { url: "https://a.com/x", domain: "a.com", domain_rank: 300, content_info: { main_title: "One (second section)" } },
        { url: "https://b.com/y", domain: "b.com", domain_rank: 120, content_info: { main_title: "Two" } },
      ] }] }] };
    }) as typeof contentDeps.request;
    const out = await fetchContent(contentInput.parse({ query: "siding cost" }));
    expect(sent.path).toBe("/content_analysis/search/live");
    expect(out.data.rows.map((r) => r.title)).toEqual(["One", "Two"]);
    expect([out.data.total, out.data.sourceRows]).toEqual([84950, 3]);
    expect(out.costUsd).toBe(0.02418);
  });
});
