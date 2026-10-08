import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { makeSafeFetch, publicIP, siteUrl, type PageResponse } from "./http";
import { robotsRules } from "./robots";
import { enrichFindings, fixesFor, reconcileFixes } from "./guidance";
import { crawl, emptyState, parsePage, findingsFor, scoresFor, classifyMissingPage, MISSING_PAGE_PREFIX } from "./audit";
import {
  pageSpeed,
  businessSchema,
  planEvidence,
  planBatches,
} from "./providers";
const response = (url: string, body: string, status = 200): PageResponse => ({
  url,
  body,
  status,
  bytes: body.length,
  headers: {},
  redirects: [],
});
describe("Site Scan network boundary", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "100.64.1.1",
    "192.168.1.1",
    "172.31.1.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fe90::1",
    "fd00::1",
    "2002:7f00:1::1",
    "2001:db8::1",
  ])("rejects non-public %s", (ip) => expect(publicIP(ip)).toBe(false));
  it("rejects credentials, alternate protocols, ports and normalized integer loopback", () => {
    for (const url of [
      "file:///etc/passwd",
      "http://2130706433",
      "http://user:pass@site.test",
      "http://site.test:22",
      "http://metadata.google.internal",
    ])
      expect(() => siteUrl(url)).toThrow();
  });
  it("pins checked DNS into transport and rechecks redirects", async () => {
    const send = vi.fn(async (u: URL, a: any) => {
      expect(a.address).toBe("8.8.8.8");
      return {
        status: 302,
        headers: { location: "http://private.test/" },
        body: "",
        bytes: 0,
      };
    });
    const resolve = vi.fn(async (h: string) => [
      { address: h === "private.test" ? "10.0.0.1" : "8.8.8.8", family: 4 },
    ]);
    await expect(
      makeSafeFetch(resolve, send)("https://public.test/"),
    ).rejects.toThrow("non-public");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed public/private DNS answers and rebinding", async () => {
    const send = vi.fn();
    await expect(
      makeSafeFetch(
        async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        send,
      )("https://public.test"),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not request a robots-excluded redirect destination", async () => {
    const send = vi.fn(async () => ({
      status: 302,
      headers: { location: "/private" },
      body: "",
      bytes: 0,
    }));
    await expect(
      makeSafeFetch(async () => [{ address: "8.8.8.8", family: 4 }], send)(
        "https://public.test/",
        (u) => !u.endsWith("/private"),
      ),
    ).rejects.toThrow("policy");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
describe("crawler and evidence", () => {
  it("uses longest robots rule and bot-specific groups", () => {
    const text =
      "User-agent: *\nDisallow: /private\nAllow: /private/open\nUser-agent: GPTBot\nDisallow: /";
    expect(robotsRules(text).allowed("https://site.test/private")).toBe(false);
    expect(robotsRules(text).allowed("https://site.test/private/open")).toBe(
      true,
    );
    expect(robotsRules(text, "GPTBot").allowed("https://site.test/")).toBe(
      false,
    );
  });
  it("crawls breadth first, respects cap and robots, and resumes saved queue", async () => {
    const seen: string[] = [];
    const http = async (url: string) => {
      seen.push(url);
      return response(
        url,
        url.endsWith("robots.txt")
          ? "User-agent: *\nDisallow: /private"
          : url.endsWith("sitemap.xml")
            ? "<urlset><url><loc>https://site.test/service</loc></url></urlset>"
            : url.endsWith("llms.txt")
              ? "# Site"
              : '<html><title>Roofing</title><body><h1>Roofing</h1><a href="/private">private</a><a href="/next">next</a></body></html>',
      );
    };
    const checkpoint = vi.fn(async () => {});
    const s = await crawl(
      "https://site.test/",
      2,
      emptyState("https://site.test/"),
      checkpoint,
      http,
      async () => {},
    );
    expect(s.pages.map((p) => p.url)).toEqual([
      "https://site.test/",
      "https://site.test/service",
    ]);
    expect(seen).not.toContain("https://site.test/private");
    const restored = JSON.parse(JSON.stringify(s));
    await crawl(
      "https://site.test/",
      3,
      restored,
      checkpoint,
      http,
      async () => {},
    );
    expect(restored.pages).toHaveLength(3);
    expect(restored.blocked).toContain("https://site.test/private");
    expect(seen.filter((u) => u === "https://site.test/")).toHaveLength(1);
  });
  it("fails closed on unavailable robots", async () => {
    await expect(
      crawl(
        "https://site.test/",
        2,
        undefined,
        undefined,
        async (u) => response(u, "", 503),
        async () => {},
      ),
    ).rejects.toThrow("Robots");
  });
  it("detects factual issues, omits unknown GBP facts, and never scores absent performance", () => {
    const s = emptyState("http://site.test/");
    s.pages = [
      parsePage(
        response(
          "http://site.test/",
          '<html><body><img src="/photo.jpg"><script type="application/ld+json">{broken}</script></body></html>',
        ),
      ),
    ];
    const f = findingsFor(s, {
      business_name: "Fixture contractor",
      phone: "5550001234",
      services: ["Roof repair"],
      service_areas: ["Fixture City"],
    });
    expect(f.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        "https",
        "alt",
        "schema-invalid",
        "js",
        "nap-business_name",
        "gap-services-Roof repair",
      ]),
    );
    expect(scoresFor(f, s, []).categories.performance).toBeNull();
    expect(
      scoresFor([], emptyState("https://site.test"), []).overall,
    ).toBeNull();
    expect(businessSchema({ business_name: "Fixture" })).not.toHaveProperty(
      "address",
    );
    expect(planEvidence(s, f, null).pages[0].url).toBe("http://site.test/");
  });
  it("preserves measured PSI and absent field data honestly", async () => {
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: { performance: { score: 0.83 } },
              audits: { "largest-contentful-paint": { numericValue: 2300 } },
            },
          }),
        ),
    ) as any;
    const p = await pageSpeed("https://site.test/", "mobile", http);
    expect(p.score).toBe(83);
    expect(p.field).toBeNull();
    expect(p.lab["largest-contentful-paint"].value).toBe(2300);
    expect(http.mock.calls[0][0]).toContain("strategy=mobile");
  });
});

it("AI batches include every crawled page without exceeding 30 pages per prompt", () => {
  const state = emptyState("https://fixture.test/");
  state.pages = Array.from({ length: 65 }, (_, i) =>
    parsePage(
      response(
        `https://fixture.test/${i}`,
        "<html><body><h1>Fixture</h1></body></html>",
      ),
    ),
  );
  const batches = planBatches(state, [], null);
  expect(batches.map((b) => b.pages.length)).toEqual([30, 30, 5]);
  expect(batches.flatMap((b) => b.pages.map((p) => p.url))).toEqual(
    state.pages.map((p) => p.url),
  );
});
it("accepts robots canonical HTTPS/www redirects and persists the crawl origin", async () => {
  const state = emptyState("http://fixture.test/");
  const http = async (url: string) =>
    response(
      url.includes("robots.txt")
        ? "https://www.fixture.test/robots.txt"
        : url === "http://fixture.test/"
          ? "https://www.fixture.test/"
          : url,
      url.includes("robots.txt")
        ? "User-agent: *\nAllow: /"
        : url.includes("sitemap.xml")
          ? "<urlset/>"
          : "<html><body>Fixture</body></html>",
    );
  await crawl(
    "http://fixture.test/",
    1,
    state,
    async () => {},
    http,
    async () => {},
  );
  expect(state.origin).toBe("https://www.fixture.test");
  expect(state.pages).toHaveLength(1);
});

it("allows ordinary public IPv4/IPv6 hosting while excluding reserved /24 ranges", () => {
  for (const ip of [
    "8.8.8.8",
    "1.1.1.1",
    "192.0.78.24",
    "192.2.1.1",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])
    expect(publicIP(ip)).toBe(true);
  for (const ip of ["192.0.0.1", "192.0.2.1", "192.88.99.1"])
    expect(publicIP(ip)).toBe(false);
});

it("counts redirected aliases once without false duplicate-content findings", async () => {
  const state = emptyState("https://fixture.test/");
  state.initialized = true;
  state.queue.push("https://fixture.test/alias", "https://fixture.test/final");
  const http = vi.fn(async (url: string) => ({
    ...response(url.endsWith("alias") ? "https://fixture.test/final" : url,
      url.endsWith("/") ? "<title>Home</title>" : "<title>Service</title>"),
    redirects: url.endsWith("alias") ? [url] : [],
  }));
  await crawl("https://fixture.test/", 5, state, undefined, http, async () => {});
  expect(state.pages.map(p => p.url)).toEqual(["https://fixture.test/", "https://fixture.test/final"]);
  expect(http).toHaveBeenCalledTimes(2);
  expect(findingsFor(state).some(f => f.id === "duplicate-title")).toBe(false);

  // An alias encountered after its destination must also be deduplicated.
  state.queue.push("https://fixture.test/alias-two");
  await crawl("https://fixture.test/", 5, state, undefined,
    async () => response("https://fixture.test/final", "<title>Service</title>"), async () => {});
  expect(state.pages).toHaveLength(2);
});

it("blocks encoded loopback, IPv6 transition forms, and private redirect targets before transport", async () => {
  for (const url of ["http://0x7f000001", "http://0177.0.0.1", "http://127.1", "http://[::ffff:7f00:1]", "http://[64:ff9b::7f00:1]", "http://[2001:0:1234::1]", "http://public.test:8080", "http://public.test:65535"]) {
    expect(() => siteUrl(url)).toThrow();
  }
  for (const location of ["http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://2130706433/"]) {
    const send = vi.fn(async () => ({ status: 302, headers: { location }, body: "", bytes: 0 }));
    await expect(makeSafeFetch(async () => [{ address: "8.8.8.8", family: 4 }], send)("https://public.test/")).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  }
});
it("reads what a site answers for an address that has no page", () => {
  const asked = "https://fixture.test/" + MISSING_PAGE_PREFIX + "abc";
  const html = "<html><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>";
  const r = (o: Partial<PageResponse> = {}): PageResponse => ({ ...response(asked, html), ...o });
  const read = (o: Partial<PageResponse> = {}) => { const m = classifyMissingPage(r(o), asked); return m.note ? `${m.outcome}: ${m.note}` : m.outcome; };
  expect(read({ status: 404 })).toBe("not_found");
  expect(read({ status: 410 })).toBe("not_found");
  // Answered as an ordinary page: the case the finding is about.
  expect(read()).toBe("ok_as_page");
  expect(read({ url: asked + "/" })).toBe("ok_as_page");
  expect(read({ url: "https://www.fixture.test/" })).toBe("sent_home");
  // A "nothing here" page marked noindex — in the page or in the response header — is how a client-routed app says so.
  expect(read({ body: '<html><head><meta name="robots" content="noindex"></head><body>Not found</body></html>' })).toBe("noindex");
  expect(read({ headers: { "x-robots-tag": "noindex, nofollow" } })).toBe("noindex");
  // Answers that prove nothing either way are not turned into a finding.
  expect(read({ status: 503 })).toBe("undetermined: answered 503");
  expect(read({ status: 403 })).toBe("undetermined: answered 403");
  expect(read({ url: "https://fixture.test/account/login?next=x" })).toBe("undetermined: sent on to a sign-in page");
  expect(read({ url: "https://accounts.other.test/" })).toBe("undetermined: sent on to accounts.other.test");
  expect(read({ headers: { "content-type": "application/json; charset=utf-8" }, body: "{}" })).toBe("undetermined: answered with application/json, not a page");
  expect(read({ body: "<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x.js'></script></html>" })).toBe("undetermined: answered with what looks like a bot check");
  // An ordinary page that happens to load reCAPTCHA for its contact form is still an ordinary page.
  const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
  expect(read({ body: `<html><head><title>Roofing</title><script src="https://www.google.com/recaptcha/api.js"></script></head><body><p>${longText}</p></body></html>` })).toBe("ok_as_page");
  // …and so is a short one with a reCAPTCHA contact form, or one that says the word.
  expect(read({ body: '<html><head><title>Contact</title><script src="https://www.google.com/recaptcha/api.js"></script></head><body><form><div class="g-recaptcha"></div></form><p>Please complete the captcha.</p></body></html>' })).toBe("ok_as_page");
  expect(read({ body: "<html><head><title>One moment</title></head><body><script>window._cf_chl_opt={}</script></body></html>" })).toBe("undetermined: answered with what looks like a bot check");
  // A sign-in form at the address itself, an empty answer, and an answer that is not marked as a page prove nothing.
  expect(read({ body: '<html><title>Members</title><body><form><input type="password" name="p"></form></body></html>' })).toBe("undetermined: answered with a sign-in form");
  expect(read({ status: 204, body: "" })).toBe("undetermined: answered with an empty response");
  expect(read({ body: "   " })).toBe("undetermined: answered with an empty response");
  expect(read({ headers: {}, body: "nothing to see" })).toBe("undetermined: answered with something that is not marked as a page");
});
it("asks each crawl for made-up addresses that have no page, and reports only what their answers show", async () => {
  const html = "<html><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>";
  const sitemap = "<urlset>" + ["/services/roofing", "/services/siding", "/services/gutters", "/about"].map((p) => `<url><loc>https://fixture.test${p}</loc></url>`).join("") + "</urlset>";
  const site = (missing: (url: string) => PageResponse | Promise<PageResponse>, robots = "") => {
    const asked: string[] = [];
    const http = async (url: string) => {
      asked.push(url);
      if (url.endsWith("robots.txt")) return response(url, robots);
      if (url.endsWith("sitemap.xml")) return response(url, sitemap);
      if (url.endsWith("llms.txt")) return response(url, "", 404);
      if (url.includes(MISSING_PAGE_PREFIX)) return missing(url);
      return response(url, html);
    };
    return { asked, probes: () => asked.filter((u) => u.includes(MISSING_PAGE_PREFIX)), run: (state = emptyState("https://fixture.test/")) => crawl("https://fixture.test/", 2, state, undefined, http, async () => {}) };
  };
  // The honest answer: not found. One address at the top of the site and one in its busiest section, each asked once; nothing reported.
  const good = site((url) => response(url, "Not found", 404));
  const ok = await good.run();
  expect(good.probes()).toHaveLength(2);
  expect(good.probes()[0]).toMatch(/^https:\/\/fixture\.test\/not-a-page-[0-9a-f]{10}$/);
  expect(good.probes()[1]).toBe(good.probes()[0].replace("fixture.test/", "fixture.test/services/"));
  expect(ok.missingPages!.map((m) => m.outcome)).toEqual(["not_found", "not_found"]);
  expect(findingsFor(ok).map((f) => f.id)).not.toContain("soft-404");
  expect(ok.pages.map((p) => p.url).some((u) => u.includes(MISSING_PAGE_PREFIX))).toBe(false);   // a made-up address is never treated as a page of the site
  // Made up per crawl: another crawl asks for other addresses; a resumed crawl keeps its own.
  const other = site((url) => response(url, "Not found", 404)); await other.run();
  expect(other.probes()[0]).not.toBe(good.probes()[0]);
  const seeded = site((url) => response(url, "Not found", 404)); await seeded.run({ ...emptyState("https://fixture.test/"), probeSlug: "feedface00" });
  expect(seeded.probes()[0]).toBe("https://fixture.test/not-a-page-feedface00");
  // Answered like a real page in one place and honestly in the other: reported for the one, and the other is said too.
  const mixed = await site((url) => (url.includes("/services/") ? response(url, html) : response(url, "Not found", 404))).run();
  const soft = findingsFor(mixed).find((f) => f.id === "soft-404");
  expect(soft).toMatchObject({ category: "technical", severity: "warning" });
  expect(soft!.urls).toEqual([mixed.missingPages![1].url]);
  expect(soft!.why).toContain("was answered 200 OK, without a \"noindex\"");
  expect(soft!.why).toContain("correctly answered not found");
  expect(soft!.why).toContain("other parts of the site may answer differently");
  expect(soft!.fix).toContain("noindex");
  // The finding goes through the rest of the report like any other: it has its guide and its evidence.
  const enriched = enrichFindings(findingsFor(mixed), mixed, null).find((f) => f.id === "soft-404");
  expect(enriched!.guidance.steps.length).toBeGreaterThan(2);
  const fix = fixesFor(findingsFor(mixed), mixed, null).find((f) => f.findingId === "soft-404");
  expect((fix!.evidence.asked as any[]).map((e) => e.read)).toEqual(["not_found", "ok_as_page"]);
  // Sent on to the home page: reported, saying where it was sent.
  const moved = findingsFor(await site(() => response("https://fixture.test/", html)).run()).find((f) => f.id === "soft-404");
  expect(moved!.why).toContain("after being sent on to https://fixture.test/");
  // A noindexed not-found page, a server error, a sign-in page, no answer, or robots.txt forbidding the addresses: nothing is claimed.
  for (const answer of [
    (url: string) => response(url, '<html><head><meta name="robots" content="noindex"></head><body>Not found</body></html>'),
    (url: string) => response(url, "", 500),
    () => response("https://fixture.test/login", html),
  ]) expect(findingsFor(await site(answer).run()).map((f) => f.id)).not.toContain("soft-404");
  // Every address meant to be asked stays in the record with what came of it: no answer, a timeout, a redirect the
  // crawl does not follow, or robots.txt forbidding it.
  const dead = await site(() => { throw new Error("connection reset"); }).run();
  expect([dead.missingPages!.map((m) => `${m.outcome}: ${m.note}`), dead.missingPagesNote, findingsFor(dead).map((f) => f.id).includes("soft-404")]).toEqual([["undetermined: no answer", "undetermined: no answer"], "no_answer", false]);
  const half = await site((url) => { if (url.includes("/services/")) throw new Error("Request timed out"); return response(url, "Not found", 404); }).run();
  expect(half.missingPages!.map((m) => m.note ?? m.outcome)).toEqual(["not_found", "no answer: the request timed out"]);
  expect(half.missingPagesNote).toBeUndefined();
  const barred = site((url) => response(url, html), "User-agent: *\nDisallow: /not-a-page\nDisallow: /services/not-a-page");
  const b = await barred.run();
  expect([b.missingPages!.map((m) => m.note), b.missingPagesNote, barred.probes(), findingsFor(b).map((f) => f.id).includes("soft-404")]).toEqual([["not asked: robots.txt does not allow it", "not asked: robots.txt does not allow it"], "robots", [], false]);
  // A crawl saved before this check existed says nothing either.
  expect(findingsFor({ ...ok, missingPages: undefined }).map((f) => f.id)).not.toContain("soft-404");
});
it("a missing-page fix is about a part of the site, judged again only where it was asked again", async () => {
  const html = "<html><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>";
  const sitemap = "<urlset>" + ["/services/roofing", "/services/siding", "/services/gutters"].map((p) => `<url><loc>https://fixture.test${p}</loc></url>`).join("") + "</urlset>";
  const run = (missing: (url: string, allowed?: (u: string) => boolean) => PageResponse | Promise<PageResponse>, map = sitemap) =>
    crawl("https://fixture.test/", 2, emptyState("https://fixture.test/"), undefined, async (url: string, allowed?: (u: string) => boolean) => {
      if (url.endsWith("robots.txt")) return response(url, "");
      if (url.endsWith("sitemap.xml")) return response(url, map);
      if (url.endsWith("llms.txt")) return response(url, "", 404);
      if (url.includes(MISSING_PAGE_PREFIX)) return missing(url, allowed);
      return response(url, html);
    }, async () => {});
  const fixesOf = (st: Awaited<ReturnType<typeof run>>) => fixesFor(findingsFor(st), st, null).filter((f) => f.findingId === "soft-404");
  // Two crawls with new made-up addresses, the same answers: the same two fixes ("still present"), named by part.
  const first = await run((url) => response(url, html));
  const a = fixesOf(first);
  expect(a.map((f) => f.page)).toEqual(["https://fixture.test/", "https://fixture.test/services/"]);
  const second = await run((url) => response(url, html));
  const b = reconcileFixes(fixesOf(second), a, second);
  expect(b.map((f) => [f.page, f.verification])).toEqual([["https://fixture.test/", "still present"], ["https://fixture.test/services/", "still present"]]);
  // The top now answers 404 but the section times out: the top is fixed, the section is not checked.
  const third = await run((url) => { if (url.includes("/services/")) throw new Error("Request timed out"); return response(url, "Not found", 404); });
  const c = reconcileFixes(fixesOf(third), b, third);
  expect(c.map((f) => [f.page, f.verification])).toEqual([["https://fixture.test/", "fixed"], ["https://fixture.test/services/", "not checked"]]);
  // A crawl whose sitemap no longer has that section never asks there: not checked, never fixed.
  const fourth = await run((url) => response(url, "Not found", 404), "<urlset></urlset>");
  expect(reconcileFixes(fixesOf(fourth), b, fourth).find((f) => f.page.endsWith("/services/"))!.verification).toBe("not checked");
  // A fix saved under its crawl's made-up address (before fixes were named by part) carries on as the part's fix:
  // still failing = "still present" with its "done" kept, not a new fix beside an orphan.
  const legacy = a.map((f) => { const asked = first.missingPages!.find((m) => f.page === "https://fixture.test/" ? !m.url.includes("/services/") : m.url.includes("/services/"))!.url; return { ...f, page: asked, key: `legacy-${asked}`, done: true }; });
  const carried = reconcileFixes(fixesOf(second), legacy, second);
  expect(carried.map((f) => [f.page, f.verification, f.done])).toEqual([["https://fixture.test/", "still present", true], ["https://fixture.test/services/", "still present", true]]);
  // A redirect the crawl does not follow (to another site) is said, not dropped.
  const away = await run((url, allowed) => { allowed?.("https://elsewhere.test/landing"); throw new Error("Redirect excluded by crawl policy"); });
  expect(away.missingPages!.map((m) => m.note)).toEqual(["sent on to https://elsewhere.test/landing, which this crawl does not follow", "sent on to https://elsewhere.test/landing, which this crawl does not follow"]);
});
it("discovers nested sitemaps, applies bot exclusions and reports each audit category", async () => {
  const state = await crawl("https://fixture.test/", 3, undefined, undefined, async url => response(url,
    url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /private\nUser-agent: GPTBot\nDisallow: /" :
    url.endsWith("sitemap.xml") ? "<sitemapindex><sitemap><loc>https://fixture.test/child.xml</loc></sitemap></sitemapindex>" :
    url.endsWith("child.xml") ? "<urlset><url><loc>https://fixture.test/service</loc></url><url><loc>https://fixture.test/private</loc></url></urlset>" :
    url.endsWith("llms.txt") ? "# Fixture" :
    '<html><head><meta name="robots" content="noindex,nofollow"></head><body><img src="http://fixture.test/image.jpg"><h1>Fixture</h1></body></html>'), async () => {});
  expect(state.pages).toHaveLength(2);
  expect(state.blocked).toContain("https://fixture.test/private");
  const findings = findingsFor(state);
  expect(new Set(findings.map(f => f.category)).size).toBe(5);
  expect(findings.map(f => f.id)).toEqual(expect.arrayContaining(["noindex", "nofollow", "mixed", "bot-GPTBot", "alt", "schema", "mobile"]));
  const scores = scoresFor(findings, state, [{ score: 60 }, { score: 80 }]);
  expect(scores.categories.performance).toBe(70);
  expect(scores.overall).toBe(Math.round(Object.values(scores.categories).reduce<number>((sum, n) => sum + n!, 0) / 5));
});

it.each(["RoofingContractor", "Plumber", "Electrician", ["Organization", "HVACBusiness"], "https://schema.org/GeneralContractor"])("recognizes contractor-specific business schema %j", type => {
  const state = emptyState("https://fixture.test/");
  const markup = { "@context": "https://schema.org", "@type": type, name: "Fixture business", areaServed: "Fixture area" };
  state.pages = [parsePage(response(state.queue[0], `<script type="application/ld+json">${JSON.stringify(markup)}</script>`))];
  expect(findingsFor(state).filter(f => ["schema", "schema-invalid"].includes(f.id))).toEqual([]);
  delete (state.pages[0].schema[0] as any).name;
  expect(findingsFor(state).map(f => f.id)).toContain("schema-invalid");
});
