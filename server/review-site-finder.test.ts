/**
 * Settings → Review sites (server/review-site-finder.ts, PATCH /api/review-templates/:id): "Find review sites" reads one
 * page through the SSRF-safe fetch and returns only review-site links written on it (never a built or guessed URL),
 * refusing private/loopback/link-local/metadata addresses on every hop and following at most 3 redirects. The fetch is
 * exercised against a local fixture server through an injected resolver (public-looking answers) and transport
 * (that dials the fixture), so the real refusal logic runs unchanged. The last block saves review sites on a profile
 * against the running dev server (CRM_TEST_BASE_URL, dev-bypass user 1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "fs";
import path from "path";
import { makeSafeFetch, type Transport } from "./sitescan/http";
import {
  FINDER_MAX_REDIRECTS, ReviewSiteFinderError, classifyReviewLink, extractReviewSiteLinks, findReviewSites,
} from "./review-site-finder";
import { isOpenWithoutPlan } from "./platform-access";

const root = path.resolve(import.meta.dirname, "..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const HOME = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
<script type="application/ld+json">{"@type":"HomeAndConstructionBusiness","sameAs":["https:\\/\\/www.facebook.com\\/AcmeRoofingTX","https://www.trustpilot.com/review/acmeroofing.example"]}</script>
</head><body>
<a href="https://www.yelp.com/biz/acme-roofing-austin?utm_source=site&amp;utm_medium=footer">Yelp</a>
<a href='https://www.bbb.org/us/tx/austin/profile/roofing-contractors/acme-roofing-0825-1000/customer-reviews'>BBB</a>
<a href=https://www.houzz.com/professionals/roofing/acme-roofing-pfvwus-pf~123>Houzz</a>
<a href="https://www.angi.com/companylist/us/tx/austin/acme-roofing-reviews-1.htm">Angi</a>
<a href="https://www.homeadvisor.com/rated.AcmeRoofing.123.html">HomeAdvisor</a>
<a href="https://nextdoor.com/pages/acme-roofing-austin-tx/">Nextdoor</a>
<a href="https://www.thumbtack.com/tx/austin/roofing/acme-roofing/service/123">Thumbtack</a>
<a href="https://porch.com/austin-tx/roofers/acme-roofing/pp">Porch</a>
<a href="https://g.page/r/CabcdEFGH/review">Review us on Google</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=https://acme.example">Share</a>
<a href="https://www.yelp.com/">Yelp home</a>
<a href="https://www.google.com/search?q=acme">Search</a>
<a href="/contact">Contact</a>
<a href="https://www.yelp.com/biz/acme-roofing-austin">Yelp again</a>
<a href="https://evil.example/yelp.com/biz/x">Not Yelp</a>
</body></html>`;

describe("which links count as review sites", () => {
  it("keeps business pages on known review platforms and drops share buttons, home pages and look-alikes", () => {
    expect(classifyReviewLink("https://www.yelp.com/biz/acme")).toEqual({ platform: "yelp", url: "https://www.yelp.com/biz/acme" });
    expect(classifyReviewLink("https://m.facebook.com/AcmeRoofing/reviews")).toMatchObject({ platform: "facebook" });
    expect(classifyReviewLink("https://www.angieslist.com/companylist/us/tx/acme.htm")).toMatchObject({ platform: "angi" });
    expect(classifyReviewLink("https://www.trustpilot.com/review/acme.example")).toEqual({ platform: "other", label: "Trustpilot", url: "https://www.trustpilot.com/review/acme.example" });
    expect(classifyReviewLink("https://search.google.com/local/writereview?placeid=ChIJ123")).toMatchObject({ platform: "google" });
    expect(classifyReviewLink("https://maps.app.goo.gl/AbCdEf")).toMatchObject({ platform: "google" });
    for (const bad of [
      "https://www.yelp.com/", "https://www.facebook.com/sharer/sharer.php?u=x", "https://www.facebook.com/tr?id=1",
      "https://fonts.googleapis.com/css", "https://www.google.com/search?q=x", "https://www.google.com/recaptcha/api.js",
      "https://notyelp.com/biz/acme", "https://yelp.com.evil.example/biz/x", "javascript:alert(1)", "mailto:a@yelp.com",
      "https://user:pw@www.yelp.com/biz/acme", "https://g.page/",
    ]) expect(classifyReviewLink(bad), bad).toBeNull();
  });

  it("collects every review-site link written on a page, once each, in page order, without inventing any", () => {
    const found = extractReviewSiteLinks(HOME, "https://acme.example/");
    expect(found.map((f) => f.platform)).toEqual([
      "yelp", "bbb", "houzz", "angi", "homeadvisor", "nextdoor", "thumbtack", "other", "google", "facebook", "other",
    ]);
    expect(found[0].url).toBe("https://www.yelp.com/biz/acme-roofing-austin");
    expect(found).toContainEqual({ platform: "facebook", url: "https://www.facebook.com/AcmeRoofingTX" });
    expect(found).toContainEqual({ platform: "other", label: "Porch", url: "https://porch.com/austin-tx/roofers/acme-roofing/pp" });
    // Every URL returned is one that is literally on the page (tracking parameters aside).
    for (const f of found) expect(HOME.replace(/\\\//g, "/")).toContain(f.url.replace(/\/$/, ""));
  });
});

describe("Find review sites: the SSRF-safe page read", () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = String(req.headers.host);
      hits.push(`${host}${req.url}`);
      const hop = /^\/hop\/(\d+)$/.exec(req.url || "");
      if (hop) {
        const n = Number(hop[1]);
        res.writeHead(302, { location: n > 1 ? `/hop/${n - 1}` : "https://acme.example/" }).end();
      } else if (req.url === "/to-private") {
        res.writeHead(301, { location: "http://internal.acme.example/" }).end();
      } else if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      } else if (req.url === "/missing") {
        res.writeHead(404, { "content-type": "text/html" }).end("nope");
      } else if (host.startsWith("www.yelp.com")) {
        res.writeHead(200, { "content-type": "text/html" }).end("<a href='https://www.bbb.org/us/tx/austin/profile/roofing/acme-1/customer-reviews'>BBB</a>");
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(HOME);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // DNS: every *.example / review host looks public, except internal.acme.example (private) and meta.acme.example.
  const resolve = async (host: string) => {
    if (host === "internal.acme.example") return [{ address: "10.1.2.3", family: 4 }];
    if (host === "meta.acme.example") return [{ address: "169.254.169.254", family: 4 }];
    if (host === "v6loop.acme.example") return [{ address: "::1", family: 6 }];
    return [{ address: "93.184.216.34", family: 4 }];
  };
  // Dial the fixture whatever the (checked, public) address was, keeping the Host header.
  const toFixture: Transport = (url) => new Promise((ok, fail) => {
    http.get({ host: "127.0.0.1", port, path: url.pathname + url.search, headers: { host: url.host }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        ok({ status: res.statusCode || 0, body: body.toString("utf8"), bytes: body.length, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v ?? "")])) });
      });
    }).on("error", fail);
  });
  const fetchPage = makeSafeFetch(resolve, toFixture, FINDER_MAX_REDIRECTS);
  const refused = async (url: string, status: number) => {
    const err = await findReviewSites(url, fetchPage).catch((e) => e);
    expect(err, url).toBeInstanceOf(ReviewSiteFinderError);
    expect(err.status, url).toBe(status);
    return err as ReviewSiteFinderError;
  };

  it("reads the owner's website and lists the review-site links on it", async () => {
    const out = await findReviewSites("acme.example", fetchPage);
    expect(out.scannedUrl).toBe("https://acme.example/");
    expect(out.found.length).toBe(11);
    expect(out.found[0]).toEqual({ platform: "yelp", url: "https://www.yelp.com/biz/acme-roofing-austin" });
  });

  it("counts a pasted review page itself, plus what it links to", async () => {
    const out = await findReviewSites("https://www.yelp.com/biz/acme-roofing-austin", fetchPage);
    expect(out.found.map((f) => f.platform)).toEqual(["yelp", "bbb"]);
  });

  it("follows up to 3 redirects and refuses a 4th", async () => {
    expect((await findReviewSites("https://acme.example/hop/2", fetchPage)).finalUrl).toBe("https://acme.example/");
    await refused("https://acme.example/hop/4", 422);
  });

  it("refuses private, loopback, link-local and metadata addresses, on the first hop and after a redirect", async () => {
    const before = hits.length;
    for (const url of [
      "http://127.0.0.1/", "http://localhost/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/", "http://metadata.google.internal/", "https://internal.acme.example/", "https://meta.acme.example/",
      "https://v6loop.acme.example/", "https://acme.example:8080/",
    ]) await refused(url, 400);
    expect(hits.length).toBe(before); // nothing was fetched
    await refused("https://acme.example/to-private", 400);
    await refused("https://acme.example/to-metadata", 400);
    // The redirect itself was read; its private target never was.
    expect(hits.some((h) => h.startsWith("internal.acme.example") || h.startsWith("169.254"))).toBe(false);
  });

  it("refuses junk input and says when the page answers with an error", async () => {
    for (const bad of ["", "   ", "ftp://acme.example/", "javascript:alert(1)", "not a url", "localhost"]) await refused(bad, 400);
    await refused("https://acme.example/missing", 422);
  });

  it("gives up after the overall time cap", async () => {
    const never = () => new Promise<never>(() => {});
    const err = await findReviewSites("https://acme.example/", never as any, 50).catch((e) => e);
    expect(err).toBeInstanceOf(ReviewSiteFinderError);
  });

  it("the default fetch is the sitescan one with a 3-redirect cap, and the route is signed-in, rate limited and paywalled", () => {
    const finder = src("server/review-site-finder.ts");
    expect(finder).toContain("makeSafeFetch(undefined, undefined, FINDER_MAX_REDIRECTS)");
    expect(FINDER_MAX_REDIRECTS).toBe(3);
    const routes = src("server/routes.ts");
    expect(routes).toMatch(/app\.post\("\/api\/review-templates\/find-review-sites", \(req, res, next\) => \{\s*if \(!\(req as any\)\.user\) return void res\.status\(401\)[\s\S]{0,80}\}, requirePlatformAccess, reviewSiteFinderLimit,/);
    expect(routes).toContain('const reviewSiteFinderLimit = rateLimit("review-site-finder"');
    expect(isOpenWithoutPlan("/api/review-templates/find-review-sites")).toBe(false);
  });
});

describe("Settings → Review sites (source guards)", () => {
  const owner = src("client/src/pages/google-reviews.tsx");
  const card = src("client/src/components/reviews-tool/review-sites-card.tsx");
  it("the settings view puts the threshold first, then the review sites, and the send dialog uses a dropdown", () => {
    const settings = owner.slice(owner.indexOf('{view === "settings" && <FeedbackRoutingCard />}'));
    expect(settings.indexOf("<FeedbackRoutingCard />")).toBeLessThan(settings.indexOf("<ReviewSitesCard />"));
    expect(settings.indexOf("<ReviewSitesCard />")).toBeLessThan(settings.indexOf("<ReminderSettingsCard />"));
    expect(owner).toContain('title="Which ratings reach Google and your other review sites"');
    expect(owner).toContain('data-testid="select-send-primary"');
    expect(owner).toContain('data-testid={`chip-send-also-${d.platform}`}');
    expect(owner).not.toContain('name="send-primary"');
    // Suggestions are ticked by the owner and saved through the profile route; nothing is added automatically.
    expect(card).toContain('"/api/review-templates/find-review-sites"');
    expect(card).toContain('apiRequest("PATCH", `/api/review-templates/${template.id}`, body)');
    expect(card).toMatch(/onSuccess: \(data\) => \{ setResult\(data\); setTicked\(new Set\(\)\); \}/);
  });
});

// Against the running dev server (dev-bypass user 1, who has a plan on the dev DB).
const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
describe("saving review sites on a profile (dev server)", () => {
  let id = 0;
  const call = (p: string, method = "GET", body?: unknown) =>
    fetch(BASE + p, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  afterAll(async () => { if (id) await call(`/api/review-templates/${id}`, "DELETE"); });

  it("saves, normalizes and reads back the sites and the primary; a removed primary falls back to Google", async () => {
    const google = "https://search.google.com/local/writereview?placeid=REVSITESTEST";
    const created = await call("/api/review-templates", "POST", { name: `Review sites test ${Date.now()}`, googleProfileUrl: google });
    expect(created.status).toBe(200);
    id = (await created.json()).id;

    const saved = await call(`/api/review-templates/${id}`, "PATCH", {
      otherReviewLinks: [
        { platform: "yelp", url: "www.yelp.com/biz/acme-roofing-austin" },
        { platform: "other", label: "Porch", url: "https://porch.com/austin-tx/roofers/acme-roofing/pp" },
      ],
      primaryReviewUrl: "https://www.yelp.com/biz/acme-roofing-austin",
    });
    expect(saved.status).toBe(200);
    const row = await saved.json();
    expect(row.otherReviewLinks).toEqual([
      { platform: "yelp", url: "https://www.yelp.com/biz/acme-roofing-austin" },
      { platform: "other", label: "Porch", url: "https://porch.com/austin-tx/roofers/acme-roofing/pp" },
    ]);
    expect(row.primaryReviewUrl).toBe("https://www.yelp.com/biz/acme-roofing-austin");

    const list = await (await call("/api/review-templates")).json();
    expect(list.find((t: any) => t.id === id).otherReviewLinks).toHaveLength(2);

    // Bad rows are refused with the owner-facing reason, and nothing changes.
    const bad = await call(`/api/review-templates/${id}`, "PATCH", { otherReviewLinks: [{ platform: "yelp", url: "not a url" }] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/Yelp/);

    // Removing the primary site without naming a new primary routes back to Google.
    const removed = await (await call(`/api/review-templates/${id}`, "PATCH", { otherReviewLinks: [{ platform: "other", label: "Porch", url: "https://porch.com/austin-tx/roofers/acme-roofing/pp" }] })).json();
    expect(removed.otherReviewLinks).toHaveLength(1);
    expect(removed.primaryReviewUrl).toBe("");
  });

  it("the finder refuses a private address", async () => {
    const res = await call("/api/review-templates/find-review-sites", "POST", { url: "http://127.0.0.1:5432/" });
    expect(res.status).toBe(400);
    expect((await call("/api/review-templates/find-review-sites", "POST", { url: "http://169.254.169.254/" })).status).toBe(400);
  });
});
