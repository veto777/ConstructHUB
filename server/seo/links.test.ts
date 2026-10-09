/**
 * Where the keyword, content and backlink figures lead (client/src/pages/seo/links.ts): the addresses the builders
 * write are the ones the pages honour (docs/seo-links/keywords-content-backlinks.md lists them), so a change to a
 * parameter name here would break a link somewhere else. Pure functions: no browser, no server.
 */
import { describe, expect, it } from "vitest";
import { seoLinks } from "../../client/src/pages/seo/links";

describe("seoLinks: keywords explorer", () => {
  it("a keyword alone, and the view tabs", () => {
    expect(seoLinks.keywords("roof repair")).toBe("/seo/keywords?keyword=roof+repair");
    expect(seoLinks.keywords("", { view: "bulk" })).toBe("/seo/keywords?view=bulk");
    expect(seoLinks.keywords("", { view: "lists", list: 7 })).toBe("/seo/keywords?view=lists&list=7");
  });
  it("the parts of an overview a figure lands on", () => {
    expect(seoLinks.keywords("roof repair", { section: "volume" })).toBe("/seo/keywords?keyword=roof+repair&section=volume");
    expect(seoLinks.keywords("roof repair", { section: "volume", month: "2026-03" })).toBe("/seo/keywords?keyword=roof+repair&section=volume&month=2026-03");
    expect(seoLinks.keywords("roof repair", { section: "serp" })).toBe("/seo/keywords?keyword=roof+repair&section=serp");
    expect(seoLinks.keywords("roof repair", { section: "cpc" })).toBe("/seo/keywords?keyword=roof+repair&section=cpc");
    expect(seoLinks.keywords("roof repair", { section: "results" })).toBe("/seo/keywords?keyword=roof+repair&section=results");
    expect(seoLinks.keywords("roof repair", { section: "ideas", table: "matchingTerms", intent: "commercial" })).toBe("/seo/keywords?keyword=roof+repair&section=ideas&table=matchingTerms&intent=commercial");
    expect(seoLinks.keywords("roof repair", { section: "ideas", table: "relatedTerms" })).toBe("/seo/keywords?keyword=roof+repair&section=ideas&table=relatedTerms");
  });
  it("a keyword from a list opens in the list's own country; the default country adds nothing", () => {
    expect(seoLinks.keywords("techo", { locationCode: 2840, languageCode: "es" })).toBe("/seo/keywords?keyword=techo&locationCode=2840&languageCode=es");
    expect(seoLinks.keywords("roof", {})).toBe("/seo/keywords?keyword=roof");
  });
  it("a tracked keyword's page in the rank tracker", () => {
    expect(seoLinks.rankTracker(3, { keyword: "roof repair" })).toBe("/seo/rank-tracker?site=3&keyword=roof+repair");
  });
});

describe("seoLinks: content explorer", () => {
  it("a search, and its filters as the page's controls set them", () => {
    expect(seoLinks.content("siding cost")).toBe("/seo/content?q=siding+cost");
    expect(seoLinks.content("siding cost", { sort: "newest", since: 90, authority: 30, kind: "blogs" })).toBe("/seo/content?q=siding+cost&sort=newest&since=90&authority=30&kind=blogs");
    expect(seoLinks.content("", { sort: "authority" })).toBe("/seo/content?sort=authority");
  });
  it("a result's figures lead to the Site explorer views that hold them", () => {
    expect(seoLinks.explorer("blog.example.com")).toBe("/seo/explorer?domain=blog.example.com");
    expect(seoLinks.explorer("blog.example.com", "referringDomains")).toBe("/seo/explorer?domain=blog.example.com&view=referringDomains");
    expect(seoLinks.explorer("blog.example.com", "pages", { path: "/siding/cost" })).toBe("/seo/explorer?domain=blog.example.com&view=pages&path=%2Fsiding%2Fcost");
  });
});

describe("seoLinks: backlinks", () => {
  it("a site, a list on the page, and only the links from one site", () => {
    expect(seoLinks.backlinks(3)).toBe("/seo/backlinks?site=3");
    expect(seoLinks.backlinks(3, { section: "lost" })).toBe("/seo/backlinks?site=3&section=lost");
    expect(seoLinks.backlinks(3, { section: "new", domain: "example.org" })).toBe("/seo/backlinks?site=3&section=new&domain=example.org");
  });
  it("the figures lead to the Site explorer views with their rows", () => {
    expect(seoLinks.explorer("mysite.com", "backlinks")).toBe("/seo/explorer?domain=mysite.com&view=backlinks");
    expect(seoLinks.explorer("mysite.com", "newBacklinks")).toBe("/seo/explorer?domain=mysite.com&view=newBacklinks");
    expect(seoLinks.explorer("mysite.com", "lostBacklinks")).toBe("/seo/explorer?domain=mysite.com&view=lostBacklinks");
    expect(seoLinks.explorer("mysite.com", "brokenBacklinks")).toBe("/seo/explorer?domain=mysite.com&view=brokenBacklinks");
    expect(seoLinks.explorer("mysite.com", "referringDomains", { followed: true })).toBe("/seo/explorer?domain=mysite.com&view=referringDomains&followed=true");
    // Not followed is a filter, not an absence: qs() keeps `false`, so the nofollow figures open the nofollow rows.
    expect(seoLinks.explorer("mysite.com", "referringDomains", { followed: false })).toBe("/seo/explorer?domain=mysite.com&view=referringDomains&followed=false");
  });
  it("a linking site's spam score opens its row among the referring domains; an anchor its anchors row", () => {
    expect(seoLinks.explorer("mysite.com", "referringDomains", { contains: "spammy.biz" })).toBe("/seo/explorer?domain=mysite.com&view=referringDomains&contains=spammy.biz");
    expect(seoLinks.explorer("mysite.com", "anchors", { anchor: "roof repair" })).toBe("/seo/explorer?domain=mysite.com&view=anchors&anchor=roof+repair");
    expect(seoLinks.explorer("mysite.com", "pages", { path: "/services?id=4" })).toBe("/seo/explorer?domain=mysite.com&view=pages&path=%2Fservices%3Fid%3D4");
  });
});

describe("seoLinks: the parameters appended for the second pass (owner 2026-10-09)", () => {
  it("keywords: a list's topic groups, and the Service × town tiles' cells", () => {
    expect(seoLinks.keywords("", { view: "lists", list: 7, topic: "*" })).toBe("/seo/keywords?view=lists&list=7&topic=*");
    expect(seoLinks.keywords("", { view: "bulk", topic: "roof" })).toBe("/seo/keywords?view=bulk&topic=roof");
    expect(seoLinks.keywords("", { view: "area", show: "gaps" })).toBe("/seo/keywords?view=area&show=gaps");
  });
  it("content: the page of results is part of the address", () => {
    expect(seoLinks.content("siding cost", { offset: 25 })).toBe("/seo/content?q=siding+cost&offset=25");
    expect(seoLinks.content("siding cost", { since: 90 })).toBe("/seo/content?q=siding+cost&since=90");
  });
  it("explorer: the Opportunities list and page, and the gap's competitors", () => {
    expect(seoLinks.explorer("mysite.com", "opportunities", { opp: "falling" })).toBe("/seo/explorer?domain=mysite.com&view=opportunities&opp=falling");
    expect(seoLinks.explorer("mysite.com", "opportunities", { opp: "pages", path: "/roofing" })).toBe("/seo/explorer?domain=mysite.com&view=opportunities&opp=pages&path=%2Froofing");
    expect(seoLinks.explorer("mysite.com", "contentGap", { competitors: "a.com,b.com" })).toBe("/seo/explorer?domain=mysite.com&view=contentGap&competitors=a.com%2Cb.com");
    expect(seoLinks.explorer("mysite.com", "keywords", { band: "top20" })).toBe("/seo/explorer?domain=mysite.com&view=keywords&band=top20");
  });
  it("a lookup's date opens that month's lookups on the Usage page", () => {
    expect(seoLinks.usage({ month: "2026-10" })).toBe("/seo/usage?month=2026-10");
  });
});
