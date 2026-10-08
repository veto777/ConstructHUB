import { describe, expect, it } from "vitest";
import { outgoingLinks, type OutPage } from "./outgoing-links";

const H = "https://alpine.example";
const page = (path: string, links: string[], o: Partial<OutPage> = {}): OutPage => ({ url: `${H}${path}`, status: 200, links: [`${H}/`, ...links], ...o });
const filler = Array.from({ length: 5 }, (_, i) => page(`/f${i}`, []));
describe("outgoing links", () => {
  it("the other websites linked to, from how many pages, with examples and link text; the site's own sub-domains are not outgoing", () => {
    const out = outgoingLinks([
      page("/", ["https://www.jameshardie.com/siding", "https://blog.alpine.example/post"], { evidence: [{ target: "https://www.jameshardie.com/siding", anchor: "James Hardie siding" }] }),
      page("/a", ["https://jameshardie.com/trim", "https://jameshardie.com/trim", "https://yelp.com/biz/alpine"]),
      page("/gone", ["https://other.example/"], { status: 404 }),
      ...filler,
    ], [], "alpine.example");
    expect(out.linkedDomains.map((d) => [d.domain, d.pages, d.links])).toEqual([["jameshardie.com", 2, 3], ["yelp.com", 1, 1]]);
    expect(out.linkedDomains[0].examples[0]).toEqual({ from: `${H}/`, to: "https://www.jameshardie.com/siding", anchor: "James Hardie siding" });
    expect([out.domains, out.links, out.pagesRead]).toEqual([2, 4, 7]);
  });
  it("broken = checked and answered an error or nothing; unchecked links are counted apart, never called fine", () => {
    const out = outgoingLinks([page("/", ["https://a.example/x", "https://b.example/y", "https://c.example/z"]), page("/p", ["https://a.example/x"]), ...filler],
      [{ url: "https://a.example/x", status: 404 }, { url: "https://b.example/y", status: 200 }], "alpine.example");
    expect(out.broken).toEqual([{ to: "https://a.example/x", status: 404, answer: "gone", from: [`${H}/`, `${H}/p`], fromCount: 2 }]);
    expect([out.checkedAddresses, out.uncheckedLinks]).toEqual([2, 1]);
    expect(out.linkedDomains.find((d) => d.domain === "a.example")).toMatchObject({ checked: 1, broken: 1 });
    expect(outgoingLinks([page("/", ["https://d.example/"]), ...filler], [{ url: "https://d.example/", status: null }], "alpine.example").broken[0]).toMatchObject({ status: null, answer: "no_status" });
    expect(outgoingLinks([page("/", ["https://d.example/"]), ...filler], [{ url: "https://d.example/", status: null, reason: "timeout" }], "alpine.example").broken[0].answer).toBe("no_answer");
  });
  it("a crawl that cannot see links says so (links added by JavaScript)", () => {
    const blind = outgoingLinks(Array.from({ length: 6 }, (_, i) => ({ url: `${H}/p${i}`, status: 200, links: [] })), [], "alpine.example");
    expect([blind.linksMeasured, blind.domains]).toEqual([false, 0]);
  });
  it("a refusal (403, 401, 429) or no answer is listed apart from broken, never counted as broken", () => {
    const out = outgoingLinks([page("/", ["https://bbb.example/p", "https://down.example/", "https://dead.example/x"]), ...filler],
      [{ url: "https://bbb.example/p", status: 403 }, { url: "https://down.example/", status: null, reason: "failed" }, { url: "https://dead.example/x", status: 503 }], "alpine.example");
    expect(out.broken.map((b) => [b.to, b.answer])).toEqual([["https://dead.example/x", "error"], ["https://bbb.example/p", "refused"], ["https://down.example/", "no_answer"]]);
    expect(out.linkedDomains.find((d) => d.domain === "bbb.example")).toMatchObject({ checked: 1, broken: 0 });
  });
  it("each answer said for what it is: other 4xx inconclusive, 204, a redirect not followed - none of them broken", () => {
    const out = outgoingLinks([page("/", ["https://a.example/1", "https://b.example/2", "https://c.example/3", "https://d.example/4"]), ...filler],
      [{ url: "https://a.example/1", status: 405 }, { url: "https://b.example/2", status: 204 }, { url: "https://c.example/3", status: null, reason: "redirect_not_followed" }, { url: "https://d.example/4", status: 200 }], "alpine.example");
    expect(out.broken.map((b) => [b.to, b.answer]).sort()).toEqual([["https://a.example/1", "inconclusive"], ["https://b.example/2", "no_content"], ["https://c.example/3", "redirect_unfollowed"]]);
    expect(out.linkedDomains.every((d) => d.broken === 0)).toBe(true);
    // Pages with only links to other websites still have links to read: not "unmeasured".
    const external = outgoingLinks(Array.from({ length: 6 }, (_, i) => ({ url: `${H}/p${i}`, status: 200, links: ["https://x.example/"] })), [], "alpine.example");
    expect(external.linksMeasured).toBe(true);
  });
});
