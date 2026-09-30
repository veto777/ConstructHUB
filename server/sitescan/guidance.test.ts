import { it, expect, vi } from "vitest";
import {
  brandMatches,
  detectPlatform,
  enrichFindings,
  fixesFor,
  reconcileFixes,
  guideFor,
  guides,
  platformSteps,
  checklist,
} from "./guidance";
import { emptyState, parsePage, findingsFor, scoresFor } from "./audit";
import { pageSpeed } from "./providers";
const page = (html: string, url = "https://fixture.test/") =>
  parsePage({
    url,
    body: html,
    status: 200,
    bytes: html.length,
    headers: {},
    redirects: [],
  });
it.each([
  [
    "WordPress/Elementor",
    '<script src="/wp-content/plugins/elementor/assets/test.js"></script>',
  ],
  ["WordPress", "/wp-content/theme"],
  ["Wix", "wixstatic.com"],
  ["Squarespace", "static1.squarespace.com"],
  ["GoDaddy", "wsimg.com"],
  ["Webflow", 'data-wf-site="abc"'],
  ["Shopify", "cdn.shopify.com"],
  ["Duda", "cdn.website-editor.net"],
  ["Custom/unknown", "<h1>Fixture</h1>"],
])("detects %s and provides paths for every guide", (platform, html) => {
  expect(detectPlatform(html)).toBe(platform);
  for (const id of Object.keys(guides))
    expect(platformSteps(platform as any, id).length).toBeGreaterThan(20);
});
it("matches the Alpine brand core and conservative typos without unrelated partial matches", () => {
  expect(
    brandMatches(
      "Alpine Exteriors | Siding, Roofing & Windows",
      "Welcome to Alpine Exteriors",
    ),
  ).toBe(true);
  expect(brandMatches("Alpine Exteriors LLC", "Alpine Exterior")).toBe(true);
  expect(brandMatches("Alpine Exteriors", "Alpine Roofing")).toBe(false);
  expect(brandMatches("ABC", "ABCD company")).toBe(false);
  const s = emptyState("https://fixture.test/");
  s.pages = [page("<body>Alpine Exteriors</body>")];
  const f = findingsFor(s, {
    business_name: "Alpine Exteriors | Siding, Roofing & Windows",
    services: Array.from({ length: 100 }, (_, i) => "Fixture service " + i),
  });
  expect(f.some((f) => f.id === "nap-business_name")).toBe(false);
  expect(scoresFor(f, s, []).categories.local).toBeGreaterThanOrEqual(70);
});
it("has honest sourced guidance for every emitted type including dynamic families", () => {
  const s = emptyState("http://fixture.test/");
  s.pages = [
    page('<body><img src="/x"><h1>Hi</h1></body>', "http://fixture.test/"),
  ];
  const all = enrichFindings(
    findingsFor(s, { business_name: "Test", services: ["Fixture"] }),
    s,
    null,
  );
  for (const f of all) {
    expect(f.guidance.source).toMatch(
      /^https:\/\/(developers.google.com|web.dev)\//,
    );
    expect(f.guidance.steps.length).toBeGreaterThanOrEqual(2);
  }
  for (const id of [
    "duplicate-title",
    "duplicate-description",
    "schema-invalid",
    "structured",
    "psi-mobile-url",
    "bot-GPTBot",
    "gap-service_areas-City",
    "nap-phone",
  ])
    expect(guideFor(id)).toBeTruthy();
});
it("captures broken link source, anchor, HTTP status and only observed same-site replacement candidates", () => {
  const s = emptyState("https://fixture.test/");
  s.pages = [
    page('<a href="/old-roof-repair">Roof repair</a>'),
    page("<title>Roof repair</title>", "https://fixture.test/roof-repair"),
    page("<title>Roof repair</title>", "https://other.test/roof-repair"),
  ];
  s.linkChecks = [{ url: "https://fixture.test/old-roof-repair", status: 404 }];
  const fixes = fixesFor(findingsFor(s), s, null).filter(
    (f) => f.findingId === "broken-links",
  );
  expect(fixes).toHaveLength(1);
  expect(fixes[0]).toMatchObject({
    page: "https://fixture.test/",
    target: "https://fixture.test/old-roof-repair",
    evidence: {
      anchor: "Roof repair",
      status: 404,
      suggestedReplacement: "https://fixture.test/roof-repair",
    },
  });
});
it("preserves measured image bytes and produces escaped GBP and metadata drafts", () => {
  const s = emptyState("https://fixture.test/");
  s.pages = [
    page(
      '<h1>Roof &amp; repair</h1><img src="/heavy.jpg"><p>Observed fixture details</p>',
    ),
  ];
  s.imageChecks = [
    {
      url: "https://fixture.test/heavy.jpg",
      bytes: 700000,
      pages: [s.pages[0].url],
    },
  ];
  const f = findingsFor(s),
    fixes = fixesFor(f, s, { business_name: "</script><script>bad</script>" });
  expect(
    fixes.find((f) => f.findingId === "oversized-images")?.evidence,
  ).toMatchObject({ currentBytes: 700000, targetBytes: 300000 });
  expect(fixes.find((f) => f.findingId === "title")?.code).toContain(
    "Roof &amp; repair",
  );
  expect(fixes.find((f) => f.findingId === "schema")?.code).not.toContain(
    "</script><script>",
  );
  expect(checklist({ url: s.pages[0].url, findings: f }, fixes)).toContain(
    "DRAFT code",
  );
});
it("never turns incomplete coverage or unchecked image/link targets into confirmed fixes", () => {
  const s = emptyState("https://fixture.test/");
  s.pages = [
    page(
      "<p>" +
        "Fixture ".repeat(30) +
        '</p><a href="/broken">Link</a><img src="/heavy.jpg">',
    ),
  ];
  s.linkChecks = [{ url: "https://fixture.test/broken", status: 404 }];
  s.imageChecks = [
    {
      url: "https://fixture.test/heavy.jpg",
      bytes: 700000,
      pages: [s.pages[0].url],
    },
  ];
  const old = fixesFor(findingsFor(s), s, null).map((f) => ({
    ...f,
    done: true,
  }));
  const unchanged = reconcileFixes(fixesFor(findingsFor(s), s, null), old, s);
  expect(
    unchanged.every((f) => f.verification === "still present" && f.done),
  ).toBe(true);
  const noCoverage = { ...s, pages: [], linkChecks: [], imageChecks: [] };
  expect(
    reconcileFixes([], old, noCoverage).every(
      (f) => f.verification === "not checked",
    ),
  ).toBe(true);
  s.linkChecks = [];
  s.imageChecks = [];
  const result = reconcileFixes(fixesFor(findingsFor(s), s, null), old, s);
  expect(
    result
      .filter((f) => ["broken-links", "oversized-images"].includes(f.findingId))
      .every((f) => f.verification === "not checked"),
  ).toBe(true);
  s.pages = [
    page("<title>Now has title</title><p>" + "Fixture ".repeat(30) + "</p>"),
  ];
  expect(
    reconcileFixes(fixesFor(findingsFor(s), s, null), old, s).find(
      (f) => f.findingId === "title",
    )?.verification,
  ).toBe("fixed");
});
it("surfaces missing key, quota and provider failures without leaking response credentials", async () => {
  const saved = process.env.PAGESPEED_API_KEY;
  delete process.env.PAGESPEED_API_KEY;
  try {
    expect(await pageSpeed("https://fixture.test/", "mobile")).toMatchObject({
      reason: "no_key",
      score: null,
    });
  } finally {
    if (saved) process.env.PAGESPEED_API_KEY = saved;
  }
  for (const status of [429, 403, 500]) {
    const http = vi.fn(
      async () => new Response("secret provider text", { status }),
    );
    const r = await pageSpeed("https://fixture.test/", "mobile", http);
    expect(r.score).toBeNull();
    expect(JSON.stringify(r)).not.toContain("secret provider text");
    expect(r).toHaveProperty(
      "reason",
      status === 429
        ? "quota"
        : status === 403
          ? "configuration"
          : "provider_error",
    );
  }
});
it("reports a returning fixed issue as new and resets its reported done state", () => {
  const s = emptyState("https://fixture.test/");
  s.pages = [page("<h1>Fixture</h1>")];
  const current = fixesFor(findingsFor(s), s, null);
  const old = current.map((f) => ({
    ...f,
    done: true,
    verification: "fixed" as const,
  }));
  expect(
    reconcileFixes(current, old, s).every(
      (f) => f.verification === "new" && !f.done,
    ),
  ).toBe(true);
});
