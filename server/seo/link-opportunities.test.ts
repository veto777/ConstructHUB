import { describe, expect, it } from "vitest";
import { findLinkOpportunities, LINK_OPP_PER_TARGET, type OppPage, type OppTarget } from "./link-opportunities";

const H = "https://alpine.example";
const page = (path: string, text: string, links: string[] = [`${H}/`], o: Partial<OppPage> = {}): OppPage => ({ url: `${H}${path}`, status: 200, noindex: false, title: `Title of ${path}`, text, links, ...o });
const target = (keywordId: number, keyword: string, path: string, position: number | null = 8, volume: number | null = 300): OppTarget => ({ keywordId, keyword, volume, position, url: `${H}${path}` });
const filler = Array.from({ length: 6 }, (_, i) => page(`/about-${i}`, "We are a family company in Whatcom County."));

describe("internal links to add", () => {
  it("a page that uses a ranking keyword's words without linking to the page that ranks for it", () => {
    const out = findLinkOpportunities([
      page("/", "Welcome to Alpine.", [`${H}/siding`, `${H}/blog/hardie`]),
      page("/siding", "Fiber cement siding installed right."),
      page("/blog/hardie", "Why we like Hardie. Our crews handle Fiber-Cement  Siding every week, and it lasts for decades in this climate."),
      page("/blog/linked", "All about fiber cement siding.", [`http://www.alpine.example/siding/`]),              // already links (written another way)
      page("/blog/hidden", "fiber cement siding", [`${H}/`], { noindex: true }),                                 // not a page meant to be found
      page("/blog/gone", "fiber cement siding", [`${H}/`], { status: 404 }),
      ...filler,
    ], [target(1, "fiber cement siding", "/siding", 9, 1900)]);
    expect([out.linksMeasured, out.targets, out.notCrawled, out.boilerplate, out.more]).toEqual([true, 1, 0, 0, 0]);
    expect(out.items).toEqual([{ keywordId: 1, keyword: "fiber cement siding", volume: 1900, position: 9, to: `${H}/siding`, from: `${H}/blog/hardie`, fromTitle: "Title of /blog/hardie", context: expect.stringContaining("Our crews handle Fiber-Cement Siding every week") }]);
  });
  it("whole words only; a phrase on most pages is menu text; a keyword whose page was not crawled is counted, not guessed at", () => {
    const pages = [
      page("/", "Home", [`${H}/roofing`]), page("/roofing", "Roofing services"),
      page("/a", "We are proofing contractors for moisture."),                                   // "roofing contractor" is not in "proofing contractors"
      page("/b", "Ask a roofing contractor about ventilation."),
      ...Array.from({ length: 8 }, (_, i) => page(`/svc-${i}`, "Free estimates. Call today for free estimates.")),
    ];
    const out = findLinkOpportunities(pages, [target(1, "roofing contractor", "/roofing"), target(2, "free estimates", "/roofing"), target(3, "gutters", "/gutters-not-crawled"), target(4, "roof", "/roofing")]);
    expect(out.items.map((i) => [i.keyword, i.from])).toEqual([["roofing contractor", `${H}/b`]]);
    expect([out.targets, out.notCrawled, out.boilerplate]).toEqual([3, 1, 1]);   // "free estimates" is on most pages; "roof" is too short to mean anything
  });
  it("says nothing when the crawl could not see the site's links, one suggestion per pair of pages, and a limit per page", () => {
    // Most pages link nowhere in their HTML (menus added by JavaScript): which links exist is not known.
    const blind = findLinkOpportunities([page("/", "x", []), page("/siding", "y", []), ...Array.from({ length: 5 }, (_, i) => page(`/p${i}`, "we install vinyl siding here", []))], [target(1, "vinyl siding", "/siding")]);
    expect([blind.linksMeasured, blind.items]).toEqual([false, []]);
    // Two keywords of one page mentioned on the same other page: one suggestion, for the keyword nearer the first page.
    const two = findLinkOpportunities([page("/", "Home", [`${H}/siding`]), page("/siding", "Siding"), page("/post", "vinyl siding and siding installation explained"), ...filler],
      [target(1, "vinyl siding", "/siding", 35, 9000), target(2, "siding installation", "/siding", 6, 100)]);
    expect(two.items.map((i) => i.keyword)).toEqual(["siding installation"]);
    const many = findLinkOpportunities([page("/", "Home", [`${H}/siding`]), page("/siding", "Siding"), ...Array.from({ length: 14 }, (_, i) => page(`/post-${i}`, "our cedar siding repair work")), ...Array.from({ length: 20 }, (_, i) => page(`/x-${i}`, "other"))], [target(1, "cedar siding repair", "/siding")]);
    expect(many.items).toHaveLength(LINK_OPP_PER_TARGET);
    // …also when two keywords of that page find different pages: the limit is per ranking page, not per keyword.
    const both = findLinkOpportunities([page("/", "Home", [`${H}/siding`]), page("/siding", "Siding"), ...Array.from({ length: 8 }, (_, i) => page(`/a-${i}`, "our cedar siding repair work")), ...Array.from({ length: 8 }, (_, i) => page(`/b-${i}`, "about cedar shingle siding")), ...Array.from({ length: 30 }, (_, i) => page(`/x-${i}`, "other"))], [target(1, "cedar siding repair", "/siding"), target(2, "cedar shingle siding", "/siding")]);
    expect(both.items).toHaveLength(LINK_OPP_PER_TARGET);
    // No crawled pages at all: nothing is known about the links, and nothing is suggested.
    expect(findLinkOpportunities([], [])).toEqual({ linksMeasured: false, targets: 0, boilerplate: 0, notCrawled: 0, items: [], more: 0 });
  });
});
