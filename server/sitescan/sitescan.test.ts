import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { makeSafeFetch, publicIP, siteUrl, type PageResponse } from "./http";
import { robotsRules } from "./robots";
import { crawl, emptyState, parsePage, findingsFor, scoresFor } from "./audit";
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
