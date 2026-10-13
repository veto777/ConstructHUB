import { describe, expect, it, vi } from "vitest";
import { generatedSitemap } from "./audit";
import { defaultSitemapUrl, submitSiteSitemap } from "../gsc/service";

const page = (url: string, extra: Partial<{ status: number; noindex: boolean; canonical: string | null }> = {}) =>
  ({ url, status: 200, noindex: false, canonical: null, ...extra }) as any;

describe("the sitemap ConstructHUB generates from a scan", () => {
  it("lists indexable canonical pages of the site's origin, home first, with the scan date", () => {
    const xml = generatedSitemap(
      {
        origin: "https://example.com",
        pages: [
          page("https://example.com/services"),
          page("https://example.com/"),
          page("https://example.com/private", { noindex: true }),
          page("https://example.com/old", { status: 404 }),
          page("https://example.com/dup?x=1", { canonical: "https://example.com/dup" }),
          page("https://example.com/dup"),
          page("https://other.example/page"),
          page("https://example.com/services#top"),
        ],
      },
      new Date("2026-10-13T20:00:00Z"),
    );
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(["https://example.com/", "https://example.com/dup", "https://example.com/services"]);
    expect(xml).toContain("<lastmod>2026-10-13</lastmod>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("escapes URL characters that would break the XML", () => {
    const xml = generatedSitemap({ origin: "https://example.com", pages: [page("https://example.com/a?b=1&c=2")] }, new Date());
    expect(xml).toContain("<loc>https://example.com/a?b=1&amp;c=2</loc>");
  });
});

describe("submitting a site's own sitemap to Search Console", () => {
  it("knows the sitemap address for domain and URL-prefix properties", () => {
    expect(defaultSitemapUrl("sc-domain:constructhub.us")).toBe("https://constructhub.us/sitemap.xml");
    expect(defaultSitemapUrl("https://www.example.com/")).toBe("https://www.example.com/sitemap.xml");
    expect(defaultSitemapUrl("https://example.com/shop")).toBe("https://example.com/shop/sitemap.xml");
    expect(defaultSitemapUrl("ftp://x")).toBeNull();
  });

  it("submits only when the site answers /sitemap.xml with sitemap XML", async () => {
    const call = vi.fn(async () => ({}));
    const xmlSite = vi.fn(async () => new Response('<?xml version="1.0"?><urlset xmlns="x"></urlset>', { status: 200 }));
    expect(await submitSiteSitemap("sc-domain:constructhub.us", { call }, xmlSite as any)).toBe(true);
    expect(call).toHaveBeenCalledWith("/sites/sc-domain%3Aconstructhub.us/sitemaps/https%3A%2F%2Fconstructhub.us%2Fsitemap.xml", "PUT");
    const htmlSite = vi.fn(async () => new Response("<html>404 page</html>", { status: 200 }));
    expect(await submitSiteSitemap("https://example.com/", { call }, htmlSite as any)).toBe(false);
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    expect(await submitSiteSitemap("https://example.com/", { call }, missing as any)).toBe(false);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await submitSiteSitemap("https://example.com/", { call }, down as any)).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("reports false, not an error, when Google refuses the submission", async () => {
    const call = vi.fn(async () => { throw new Error("403"); });
    const xmlSite = vi.fn(async () => new Response("<urlset></urlset>", { status: 200 }));
    expect(await submitSiteSitemap("https://example.com/", { call }, xmlSite as any)).toBe(false);
  });
});
