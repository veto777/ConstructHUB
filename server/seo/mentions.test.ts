import { afterEach, describe, expect, it } from "vitest";
import { checkLinks, ownHost, defaultPlaces, fetchMentions, linkingWebsites, mentionsDeps, mentionsInput, mentionsRequest, mentionLinksRequest, parseMention, placeIn, MENTIONS_ROWS, type MentionsPage } from "./mentions";
import { dataforseoDeps } from "./dataforseo";

const item = (main_domain: string, title: string, snippet: string, o: Record<string, unknown> = {}) => ({ url: `https://${main_domain}/post`, main_domain, domain_rank: 420, content_info: { main_title: title, snippet, date_published: "2025-04-24 10:00:00 +00:00" }, ...o });
const ok = (items: unknown[], cost = 0.02, total: number | null = items.length) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ total_count: total, items }] }] });
const original = mentionsDeps.request;
afterEach(() => { mentionsDeps.request = original; });

describe("unlinked mentions", () => {
  it("searches the exact name, one page per website, the site itself left out; the link check is narrowed to those websites", () => {
    expect(mentionsRequest("Alpine Exteriors", "alpineexteriorswa.com")).toEqual({ keyword: '"Alpine Exteriors"', search_mode: "one_per_domain", limit: MENTIONS_ROWS, filters: [["main_domain", "<>", "alpineexteriorswa.com"]], order_by: ["domain_rank,desc"] });
    expect(mentionLinksRequest("alpineexteriorswa.com", ["a.com", "b.org"])).toMatchObject({ target: "alpineexteriorswa.com", filters: ["domain", "in", ["a.com", "b.org"]] });
    // A name is a name: no quotes, operators or wildcards can be slipped into the search.
    for (const bad of ['Alpine" OR "x', "Alpine*", "ab", "-Alpine", "Alpine (WA)"]) expect(mentionsInput.safeParse({ name: bad }).success, bad).toBe(false);
    expect(mentionsInput.parse({ name: "  Smith  &  Sons Roofing, Inc. " }).name).toBe("Smith & Sons Roofing, Inc.");
  });
  it("reads a result; the site's own pages and sub-domains are never a mention", () => {
    expect(parseMention(item("marketminute.com", "Alpine Exteriors opens showroom", "Alpine Exteriors opens Whatcom County's only showroom"), "alpineexteriorswa.com"))
      .toEqual({ url: "https://marketminute.com/post", domain: "marketminute.com", title: "Alpine Exteriors opens showroom", snippet: "Alpine Exteriors opens Whatcom County's only showroom", published: "2025-04-24", authority: 42 });
    expect(parseMention(item("alpineexteriorswa.com", "x", "y"), "alpineexteriorswa.com")).toBeNull();
    expect(parseMention(item("blog.alpineexteriorswa.com", "x", "y"), "alpineexteriorswa.com")).toBeNull();
    expect(parseMention({ url: "javascript:alert(1)", main_domain: "x.com" }, "a.com")).toBeNull();
  });
  it("a name is not a business: a mention is matched to the customer's places by whole words in its title or excerpt", () => {
    const r = (title: string, snippet: string | null) => ({ title, snippet });
    expect(placeIn(r("Alpine Exteriors opens showroom", "Whatcom County's only showroom"), ["Bellingham", "Whatcom"])).toBe("Whatcom");
    expect(placeIn(r("Alpine Exteriors expands its Tampa operations", null), ["Bellingham", "Whatcom"])).toBeNull();
    expect(placeIn(r("Ferndale news", "a Ferndaleish word"), ["Ferndale"])).toBe("Ferndale");
    expect(placeIn(r("x", "the Ferndaleish word"), ["Ferndale"])).toBeNull();
    expect(defaultPlaces(["Bellingham, WA", "bellingham, Washington", "United States", null, "Lynden, WA"])).toEqual(["Bellingham", "Lynden"]);
  });
  it("which websites link: a sub-domain row counts for its website; a row with no links is not one", () => {
    const linking = linkingWebsites([{ domain: "news.marketminute.com", backlinks: 3 }, { domain: "bbb.org", backlinks: 0 }, { domain: "other.com", backlinks: 2 }], ["marketminute.com", "bbb.org", "yelp.com"]);
    expect([...linking]).toEqual(["marketminute.com"]);
  });
  it("one check: the mentions, then the link check; a failed link check leaves 'links to you' unknown and is not charged", async () => {
    const calls: string[] = [];
    mentionsDeps.request = (async (_m: string, path: string) => { calls.push(path); return path.includes("content_analysis") ? ok([item("a.com", "A", "x"), item("a.com", "A2", "dup"), item("b.org", "B", "y")], 0.025) : ok([{ domain: "a.com", backlinks: 4 }], 0.026); }) as any;
    const out = await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com");
    expect(calls).toEqual(["/content_analysis/search/live", "/backlinks/referring_domains/live"]);
    expect(out.data.rows.map((r) => [r.domain, r.linksToYou])).toEqual([["a.com", true], ["b.org", false]]);
    expect([out.data.linksChecked, out.costUsd, out.customerUsd]).toEqual([true, 0.051, 0.051]);
    mentionsDeps.request = (async (_m: string, path: string) => { if (path.includes("content_analysis")) return ok([item("a.com", "A", "x")], 0.025); throw Object.assign(new Error("down"), { code: "upstream", costUsd: 0 }); }) as any;
    const half = await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com");
    expect([half.data.linksChecked, half.data.rows[0].linksToYou, half.customerUsd, half.costUnknown]).toEqual([false, null, 0.025, true]);
    // The second try: only the link check, and only what is missing.
    mentionsDeps.request = (async () => ok([], 0.024)) as any;
    const again = await checkLinks(half.data);
    expect([again.data.linksChecked, again.data.rows[0].linksToYou, again.data.rows[0].title]).toEqual([true, false, "A"]);
  });
  it("a link check with more rows than one lookup returns says 'not known' for the rest, never 'no link'", async () => {
    mentionsDeps.request = (async (_m: string, path: string) => (path.includes("content_analysis") ? ok([item("a.com", "A", "x"), item("b.org", "B", "y")]) : ok([{ domain: "a.com", backlinks: 1 }], 0.02, 900))) as any;
    const out = await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com");
    expect([out.data.linksPartial, out.data.rows.map((r) => r.linksToYou)]).toEqual([true, [true, null]]);
  });
  it("no mentions: no link check is bought", async () => {
    const calls: string[] = [];
    mentionsDeps.request = (async (_m: string, path: string) => { calls.push(path); return ok([], 0.02, 0); }) as any;
    const out = await fetchMentions("Nobody Named This", "x.com");
    expect([calls.length, out.data.rows, out.data.linksChecked]).toEqual([1, [], true]);
  });
  it("the business's own site is its host and its sub-domains — nothing above it is guessed to be the same business", () => {
    expect([ownHost("blog.alpine.example", "alpine.example"), ownHost("www.alpine.example", "alpine.example")]).toEqual([true, true]);
    expect([ownHost("alpine.example", "branch.alpine.example"), ownHost("bob.github.io", "alice.github.io"), ownHost("notalpine.example", "alpine.example")]).toEqual([false, false, false]);
    // Judged on the page's own host as well as the website it is filed under.
    expect(parseMention({ url: "https://www.alpine.example/x", main_domain: "feed.example", content_info: {} }, "alpine.example")).toBeNull();
  });
  it("a check made under a claim asks both lookups under the claim's deadline; a link check not sent is known to have cost nothing", async () => {
    const seen: (number | undefined)[] = [];
    mentionsDeps.request = (async (_m: string, path: string, _b: any, _r: any, opts: any) => { seen.push(opts?.deadline); return path.includes("content_analysis") ? ok([item("a.com", "A", "x")], 0.025) : ok([{ domain: "a.com", backlinks: 4 }], 0.026); }) as any;
    await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com", { deadline: 4321 });
    expect(seen).toEqual([4321, 4321]);
    seen.length = 0;
    await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com");
    expect(seen).toEqual([undefined, undefined]);
    // Through the real client. Past the deadline the link check is not sent: "links to you" stays unknown, nothing is
    // charged for it, and nothing about its cost is unknown. With time left it is sent as ever.
    mentionsDeps.request = original;
    const env = dataforseoDeps.env, fetch = dataforseoDeps.fetch;
    try {
      let calls = 0;
      dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }) as any;
      dataforseoDeps.fetch = (async () => { calls++; return new Response(JSON.stringify(ok([{ domain: "a.com", backlinks: 1 }], 0.026))); }) as any;
      const page: MentionsPage = { name: "Alpine Exteriors", domain: "alpineexteriorswa.com", rows: [{ url: "https://a.com/post", domain: "a.com", title: "A", snippet: null, published: null, authority: 42, linksToYou: null }], total: 1, linksChecked: false, fetchedAt: new Date().toISOString() };
      const late = await checkLinks(page, { deadline: Date.now() - 1 });
      expect([calls, late.data.linksChecked, late.data.rows[0].linksToYou, late.costUsd, late.costUnknown]).toEqual([0, false, null, 0, false]);
      const fine = await checkLinks(page, { deadline: Date.now() + 60_000 });
      expect([calls, fine.data.linksChecked, fine.data.rows[0].linksToYou, fine.costUsd]).toEqual([1, true, true, 0.026]);
      // The whole check past its deadline: nothing is asked, and the failure says its cost is known to be nothing.
      const e: any = await fetchMentions("Alpine Exteriors", "alpineexteriorswa.com", { deadline: Date.now() - 1 }).catch((x) => x);
      expect([calls, e?.code, e?.costUsd, e?.costUnknown]).toEqual([1, "timeout", 0, false]);
    } finally { dataforseoDeps.env = env; dataforseoDeps.fetch = fetch; }
  });
});
