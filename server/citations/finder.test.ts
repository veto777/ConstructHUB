import { describe, it, expect } from "vitest";
import { CITATION_DIRECTORIES, directoryByName, directoryOfUrl, onDirectory } from "./directories";
import { candidatesFromSearchPage, checkDirectory, filterWebResults, nameOverlap, parseBing, parseDuckDuckGo, type BusinessProfile, type FinderDeps } from "./finder";
import { looksBlocked } from "./fetch";
import type { Loaded } from "./fetch";

const alpine: BusinessProfile = { name: "Alpine Exteriors | Siding, Roofing & Windows", phone: "(360) 543-4799", street_address: "2119 Lincoln St", city: "Bellingham", state: "WA", postal_code: "98225", zip: "98225", service_area_only: null };
const bbb = directoryByName("BBB")!;

const listingPage = (name: string, phone: string, street: string) => `<html><head><title>${name} | BBB</title>
<script type="application/ld+json">${JSON.stringify({ "@type": "RoofingContractor", name, telephone: phone, address: { streetAddress: street, addressLocality: "Bellingham", addressRegion: "WA", postalCode: "98225" } })}</script></head><body><h1>${name}</h1></body></html>`;

const searchPage = (rows: { name: string; href: string; phone?: string }[]) => `<html><body><ul>${rows.map((r) => `<li class="card"><a href="${r.href}">${r.name}</a><span>${r.phone ?? "(360) 000-0000"}</span><span>Bellingham, WA</span></li>`).join("")}</ul></body></html>`;

const loaded = (url: string, body: string, status = 200): Loaded => ({ url, status, body, mode: "http", blocked: looksBlocked(status, body) });

function deps(pages: Record<string, Loaded | ((url: string) => Loaded)>, web: string[] = []): FinderDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    load: async (url) => { calls.push(url); const p = pages[url]; if (!p) return loaded(url, "", 404); return typeof p === "function" ? p(url) : p; },
    webSearch: async () => web,
    budgetMs: 10_000,
  };
}

describe("citation directories", () => {
  it("has the 30 checklist sites, Google first, each with a domain", () => {
    expect(CITATION_DIRECTORIES.length).toBe(30);
    expect(CITATION_DIRECTORIES[0].name).toBe("Google Business Profile");
    for (const d of CITATION_DIRECTORIES) expect(d.url).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
    expect(new Set(CITATION_DIRECTORIES.map((d) => d.name)).size).toBe(30);
  });
  it("resolves names (legacy too) and listing links to a directory", () => {
    expect(directoryByName("Google My Business")?.name).toBe("Google Business Profile");
    expect(directoryByName(" yelp ")?.name).toBe("Yelp");
    expect(directoryOfUrl("https://www.yelp.com/biz/alpine-exteriors-bellingham")?.name).toBe("Yelp");
    expect(directoryOfUrl("https://example.com/x")).toBeUndefined();
    expect(onDirectory("https://m.yelp.com/biz/x", directoryByName("Yelp")!)).toBe(true);
    expect(onDirectory("https://notyelp.com/biz/x", directoryByName("Yelp")!)).toBe(false);
  });
});

describe("finder: reading pages", () => {
  it("name overlap ignores punctuation, case and company suffixes", () => {
    expect(nameOverlap("Alpine Exteriors LLC", "ALPINE EXTERIORS, INC.")).toBe(1);
    expect(nameOverlap("Alpine Exteriors | Siding, Roofing & Windows", "Alpine Exteriors Siding Roofing and Windows - Bellingham")).toBe(1);
    expect(nameOverlap("Alpine Exteriors", "Summit Roofing")).toBe(0);
  });
  it("picks listing links whose card names the business, phone first", () => {
    const html = searchPage([
      { name: "Alpine Roofing Co", href: "/us/washington/alpine-roofing-1" },
      { name: "Alpine Exteriors Siding Roofing & Windows", href: "/us/washington/alpine-exteriors-2", phone: "(360) 543-4799" },
      { name: "Alpine Exteriors Siding Roofing & Windows", href: "/us/washington/alpine-exteriors-3" },
      { name: "About MapQuest", href: "/about" },
    ]);
    const r = candidatesFromSearchPage(html, "https://www.mapquest.com/search", directoryByName("MapQuest")!, alpine);
    expect(r.candidates.map((c) => c.url)).toEqual(["https://www.mapquest.com/us/washington/alpine-exteriors-2", "https://www.mapquest.com/us/washington/alpine-exteriors-3"]);
    expect(r.listingLinks).toBe(3);
    expect(r.namePresent).toBe(true);
    expect(r.phonePresent).toBe(true);
  });
  it("reads listing URLs out of JSON-rendered search pages too", () => {
    const html = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { results: [
      { name: "Alpine Exteriors Siding, Roofing & Windows", phone: "(360) 543-4799", url: "https://www.bbb.org/us/wa/bellingham/profile/roofing/alpine-exteriors-1" },
      { name: "Summit Roofing", phone: "(360) 555-0000", url: "https://www.bbb.org/us/wa/bellingham/profile/roofing/summit-2" },
      { name: "Peak Siding", phone: "(360) 555-0001", url: "https://www.bbb.org/us/wa/bellingham/profile/siding/peak-3" },
    ] } }).replace(/\//g, "\\/")}</script></body></html>`;
    const r = candidatesFromSearchPage(html, "https://www.bbb.org/search", bbb, alpine);
    expect(r.candidates.map((c) => c.url)).toEqual(["https://www.bbb.org/us/wa/bellingham/profile/roofing/alpine-exteriors-1"]);
    expect(r.listingLinks).toBeGreaterThanOrEqual(3);
    expect(r.namePresent).toBe(true);
    expect(r.phonePresent).toBe(true);
  });
  it("parses Bing's results page", () => {
    const html = `<ol id="b_results"><li class="b_algo"><h2><a href="https://www.yelp.com/biz/alpine-exteriors-bellingham">Alpine</a></h2></li><li class="b_algo"><h2><a href="https://www.bing.com/x">no</a></h2></li></ol>`;
    expect(parseBing(html)).toEqual(["https://www.yelp.com/biz/alpine-exteriors-bellingham"]);
  });
  it("parses DuckDuckGo's HTML results and keeps web results on the directory", () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.yelp.com%2Fbiz%2Falpine-exteriors-bellingham&rut=abc">Alpine</a></div>
      <div class="result"><a class="result__a" href="https://www.yelp.com/search?x=1">Yelp search</a></div>
      <div class="result"><a class="result__a" href="https://example.com/alpine">Other</a></div>`;
    const urls = parseDuckDuckGo(html);
    expect(urls).toEqual(["https://www.yelp.com/biz/alpine-exteriors-bellingham", "https://www.yelp.com/search?x=1", "https://example.com/alpine"]);
    expect(filterWebResults(urls, directoryByName("Yelp")!)).toEqual(["https://www.yelp.com/biz/alpine-exteriors-bellingham"]);
  });
  it("a 403 or a bot wall counts as blocked, a real page does not", () => {
    expect(looksBlocked(403, "")).toBe(true);
    expect(looksBlocked(200, "<html><body>Just a moment... checking your browser</body></html>")).toBe(true);
    expect(looksBlocked(200, "<html><body>" + "Alpine Exteriors ".repeat(3000) + "</body></html>")).toBe(false);
  });
});

describe("finder: one directory", () => {
  const searchUrl = bbb.search!({ name: alpine.name!, city: "Bellingham", state: "WA", zip: "98225", place: "Bellingham, WA" });

  it("a manual-only directory is unsupported", async () => {
    const r = await checkDirectory(directoryByName("Facebook")!, alpine, null, deps({}));
    expect(r.result).toBe("unsupported");
  });

  it("confirms a match from the directory's search page and the listing it links to", async () => {
    const d = deps({
      [searchUrl]: loaded(searchUrl, searchPage([{ name: "Alpine Exteriors Siding, Roofing & Windows", href: "/us/wa/bellingham/profile/roofing/alpine-exteriors-1", phone: "(360) 543-4799" }])),
      "https://www.bbb.org/us/wa/bellingham/profile/roofing/alpine-exteriors-1": loaded("https://www.bbb.org/us/wa/bellingham/profile/roofing/alpine-exteriors-1", listingPage("Alpine Exteriors Siding, Roofing & Windows", "+1 360-543-4799", "2119 Lincoln St")),
    });
    const r = await checkDirectory(bbb, alpine, null, d);
    expect(r.result).toBe("match");
    expect(r.partial).toBe(false);
    expect(r.how).toBe("search_page");
    expect(r.listingUrl).toBe("https://www.bbb.org/us/wa/bellingham/profile/roofing/alpine-exteriors-1");
    expect(r.fields?.phone.result).toBe("match");
  });

  it("reports a mismatch with the fields that differ", async () => {
    const d = deps({
      [searchUrl]: loaded(searchUrl, searchPage([{ name: "Alpine Exteriors Siding Roofing Windows", href: "/profile/x-1", phone: "(360) 543-4799" }])),
      "https://www.bbb.org/profile/x-1": loaded("https://www.bbb.org/profile/x-1", listingPage("Alpine Exteriors Siding Roofing Windows", "360-543-4799", "100 Old Road")),
    });
    const r = await checkDirectory(bbb, alpine, null, d);
    expect(r.result).toBe("mismatch");
    expect(r.reason).toMatch(/street address/);
    expect(r.fields?.street_address.observed).toBe("100 Old Road");
  });

  it("a saved listing link is verified first, before any search", async () => {
    const url = "https://www.bbb.org/profile/saved-9";
    const d = deps({ [url]: loaded(url, listingPage("Alpine Exteriors Siding Roofing & Windows", "(360) 543-4799", "2119 Lincoln Street")) });
    const r = await checkDirectory(bbb, alpine, url, d);
    expect(r.result).toBe("match");
    expect(r.how).toBe("listing_url");
    // Still searched (one more candidate could be a duplicate), but the saved link decided it.
    expect(d.calls[0]).toBe(url);
  });

  it("'not found' only when the search page is readable and lists other businesses", async () => {
    const d = deps({ [searchUrl]: loaded(searchUrl, searchPage([{ name: "Summit Roofing", href: "/profile/a-1" }, { name: "Peak Siding", href: "/profile/b-2" }, { name: "Cascade Windows", href: "/profile/c-3" }])) });
    const r = await checkDirectory(bbb, alpine, null, d);
    expect(r.result).toBe("not_found");
    expect(r.reason).toMatch(/lists other businesses/);
  });

  it("a blocked search page and no web result stays unconfirmed, never 'not listed'", async () => {
    const d = deps({ [searchUrl]: loaded(searchUrl, "<html>Access Denied</html>", 403) });
    const r = await checkDirectory(bbb, alpine, null, d);
    expect(r.result).toBe("unconfirmed");
    expect(r.reason).toMatch(/blocks automatic checks/);
  });

  it("falls back to web search for the listing and verifies what it finds", async () => {
    const yelp = directoryByName("Yelp")!;
    const yelpSearch = yelp.search!({ name: alpine.name!, city: "Bellingham", state: "WA", zip: "98225", place: "Bellingham, WA" });
    const biz = "https://www.yelp.com/biz/alpine-exteriors-bellingham";
    const d = deps({ [yelpSearch]: loaded(yelpSearch, "", 403), [biz]: loaded(biz, listingPage("Alpine Exteriors Siding Roofing & Windows", "(360) 543-4799", "2119 Lincoln St")) }, [biz, "https://www.yelp.com/search?q=x"]);
    const r = await checkDirectory(yelp, alpine, null, d);
    expect(r.result).toBe("match");
    expect(r.how).toBe("web_search");
    expect(r.listingUrl).toBe(biz);
  });

  it("a found-but-unreadable listing is unconfirmed with the link to open", async () => {
    const yelp = directoryByName("Yelp")!;
    const yelpSearch = yelp.search!({ name: alpine.name!, city: "Bellingham", state: "WA", zip: "98225", place: "Bellingham, WA" });
    const biz = "https://www.yelp.com/biz/alpine-exteriors-bellingham";
    const d = deps({ [yelpSearch]: loaded(yelpSearch, "", 403), [biz]: loaded(biz, "", 403) }, [biz]);
    const r = await checkDirectory(yelp, alpine, null, d);
    expect(r.result).toBe("unconfirmed");
    expect(r.evidence.candidates).toEqual([biz]);
    expect(r.reason).toMatch(/Open the link/);
  });

  it("never matches a different business with a similar name", async () => {
    const d = deps({
      [searchUrl]: loaded(searchUrl, searchPage([{ name: "Alpine Exteriors Siding Roofing & Windows", href: "/profile/other-1", phone: "(206) 555-0100" }])),
      "https://www.bbb.org/profile/other-1": loaded("https://www.bbb.org/profile/other-1", listingPage("Alpine Exteriors Siding Roofing & Windows", "(206) 555-0100", "9 Elsewhere Ave")),
    });
    const r = await checkDirectory(bbb, alpine, null, d);
    // Same name, different phone and street: identity not corroborated → not a match, not a mismatch.
    expect(r.result).toBe("unconfirmed");
  });
});
