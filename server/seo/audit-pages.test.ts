import { describe, expect, it } from "vitest";
import { pageRows, pagesSummary, sameUrlKey, type RawPage } from "./audit-pages";

const page = (url: string, links: string[] = [], extra: Partial<RawPage> = {}): RawPage =>
  ({ url, status: 200, redirects: 0, title: "A title", description: "A description", h1: ["H"], links, bytes: 20480, canonical: null, noindex: false, words: 500, images: 2, imagesNoAlt: 0, ...extra });
const H = "https://x.com";

describe("sameUrlKey", () => {
  it("ignores a trailing slash, a fragment and the case of the host", () => {
    expect(sameUrlKey("https://X.com/a/")).toBe(sameUrlKey("https://x.com/a#top"));
    expect(sameUrlKey("https://x.com/")).toBe(sameUrlKey("https://x.com"));
    expect(sameUrlKey("https://x.com/a?b=1")).not.toBe(sameUrlKey("https://x.com/a"));
    expect(sameUrlKey("not a url/")).toBe("not a url");
    expect(sameUrlKey("http://www.x.com/a")).toBe(sameUrlKey("https://x.com/a"));
  });
});

describe("pageRows", () => {
  const pages = [
    page(`${H}/`, [`${H}/services`, `${H}/about/`, `${H}/`, "https://other.com/x"]),
    page(`${H}/services`, [`${H}/`, `${H}/services/siding`, `${H}/services/siding#quote`]),
    page(`${H}/about`, [`${H}/`]),
    page(`${H}/services/siding`, [`${H}/services/siding/hardie`]),
    page(`${H}/services/siding/hardie`, [`${H}/deep`]),
    page(`${H}/deep`),
    page(`${H}/orphan`),
    page(`${H}/gone`, [], { status: 404 }),
    page(`${H}/hidden`, [], { noindex: true }),
    page(`${H}/dupe`, [], { canonical: `${H}/services` }),
    page(`${H}/self`, [], { canonical: `${H}/self/`, title: "", description: null, words: 40, redirects: 1 }),
  ];
  const rows = pageRows(pages, [{ id: "thin", category: "content", severity: "warning", title: "Thin content", urls: [`${H}/self/`, `${H}/about`] }, { id: "psi-mobile-x", category: "performance", severity: "warning", title: "mobile PageSpeed performance: 41", urls: [`${H}/`] }]);
  const row = (path: string) => rows.find((r) => r.path === path)!;
  it("counts the site's own links once each, in and out, matching addresses a crawler would", () => {
    expect([row("/").outlinks, row("/").inlinks]).toEqual([2, 2]);          // links to itself and to another site do not count
    expect([row("/services").outlinks, row("/services").inlinks]).toEqual([2, 1]);
    expect(row("/about").inlinks).toBe(1);                                     // linked as /about/
  });
  it("works out the clicks from the first page, and leaves pages nothing links to without a depth", () => {
    expect(rows.map((r) => [r.path, r.depth]).slice(0, 7)).toEqual([["/", 0], ["/services", 1], ["/about", 1], ["/services/siding", 2], ["/services/siding/hardie", 3], ["/deep", 4], ["/orphan", null]]);
  });
  it("says whether a page can be indexed and why not", () => {
    expect([row("/gone").indexable, row("/gone").whyNot]).toEqual([false, "it returns an error (404)"]);
    expect(row("/hidden").whyNot).toBe("it is marked noindex");
    expect(row("/dupe").whyNot).toBe("its canonical tag points to another page");
    expect(row("/self").indexable).toBe(true);                                 // a canonical to itself is fine
    expect(row("/").indexable).toBe(true);
  });
  it("carries the page's own numbers and the issues it is listed under", () => {
    expect(row("/self")).toMatchObject({ titleLength: 0, descriptionLength: 0, words: 40, redirected: true, kb: 20, issues: ["thin"] });
    expect(row("/about").issues).toEqual(["thin"]);
    expect(row("/").issues).toEqual(["psi-mobile"]);
  });
  it("summarises the crawl", () => {
    expect(pagesSummary(rows)).toEqual({ pages: 11, indexable: 8, notIndexable: 3, errors: 1, redirected: 1, linksMeasured: true, orphans: 5, deep: 1, averageDepth: 1.8, thin: 1, noTitle: 1, noDescription: 1 });
  });
  it("says nothing about links on a site whose pages carry none in their source (menus built by JavaScript)", () => {
    const spa = [page(`${H}/`, [`${H}/a`, `${H}/b`]), ...["a", "b", "c", "d", "e"].map((x) => page(`${H}/${x}`))];
    const r = pageRows(spa, []);
    expect(r.every((x) => x.inlinks === null && x.depth === null)).toBe(true);
    expect(pagesSummary(r)).toMatchObject({ pages: 6, linksMeasured: false, orphans: null, deep: null, averageDepth: null, indexable: 6 });
  });
  it("counts an address saved twice once", () => {
    expect(pageRows([page("http://x.com/"), page("https://x.com"), page(`${H}/a`)], [])).toHaveLength(2);
  });
  it("copes with nothing and with malformed pages", () => {
    expect(pageRows([], undefined)).toEqual([]);
    expect(pagesSummary([])).toMatchObject({ pages: 0, averageDepth: null });
    expect(pageRows([page(`${H}/`, null as any, { h1: null as any, title: null })], "nope" as any)[0]).toMatchObject({ outlinks: 0, h1: 0, titleLength: 0 });
  });
});
