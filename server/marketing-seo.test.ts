import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The marketing site's search-engine foundation: every prerendered page is in
// the sitemap and has its own title/description; the done-for-you registry is
// complete and never shows a price for anything at or above the sales
// threshold; the JSON-LD builders say only what the page shows; and the server
// hands the prerendered HTML to every signed-out visitor (never by user agent),
// the app shell to a signed-in one.
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { DFY_CATALOGUE, DFY_PAGES, DFY_PATH, EXTERNAL_DFY_PAGES, READY_DFY_PAGES, dfyPageByKey, dfyPageBySlug, dfyPagePath } from "@shared/dfy-pages";
import { FEATURE_CATALOGUE, FEATURE_PAGES, featurePageByKey, featurePagePath } from "@shared/feature-pages";
import { featurePriceSummary } from "@shared/feature-pages/pricing";
import { FEATURE_ICONS } from "@shared/feature-pages/types";
import { ADDONS, PLANS, PLAN_KEYS, SALES_THRESHOLD_CENTS, showsPrice } from "@shared/plans";
import { SALES_REP_LABEL, formatUsd } from "@shared/plan-copy";
import { APP_PAGE_META, HOME_META, ROUTE_META } from "@shared/route-meta";
import { isKnownPath } from "@shared/app-routes";
import {
  MARKETING_ROUTES, SITE_ORIGIN, breadcrumbJsonLd, canonicalPath, faqPageJsonLd, jsonLdForPath, offerJsonLd, routeSourceFile,
  seoHeadFor, serializeJsonLd, type JsonLd,
} from "@shared/seo";
import { DFY_CATALOG } from "./catalog";
import { PRIMARY_DOMAIN } from "./site-context";
import { PRERENDER_DIR, PUBLIC_ROUTES, SEO_MANIFEST, buildSitemap, loadPrerenderedPages, serveStatic, withSeoHead } from "./static";
import { adminFeaturePageRows } from "./feature-pages";
import { composePage, consentSlot, prerenderFile } from "../script/prerender";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const APP = read("client/src/App.tsx");
const APP_ROUTES = new Set([...APP.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
const routeExists = (href: string) => {
  const p = href.split(/[?#]/)[0];
  return APP_ROUTES.has(p) || [...APP_ROUTES].some((r) => r.includes(":") && new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(p));
};
const graphOf = (p: string) => jsonLdForPath(p);
const node = (graph: JsonLd[], type: string) => graph.find((n) => n["@type"] === type) as any;
/** Every "$1,234"-style amount in a text, in cents. */
const dollarAmounts = (text: string) => [...text.matchAll(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));

describe("the server's list of the app's paths (shared/app-routes.ts)", () => {
  it("covers every route App.tsx declares, so none of them answers 404", () => {
    const sample = (r: string) => r.replace(/:[^/]+/g, "Sample1");
    // /features/:slug and /done-for-you/:slug answer only the slugs in their catalogues (checked below).
    const routes = [...APP_ROUTES, "/free-site-scan", "/site-scan/report/abc"].filter((r) => !/^\/(features|done-for-you)\/:slug$/.test(r));
    for (const r of routes) expect(isKnownPath(sample(r)), r).toBe(true);
    for (const e of [...FEATURE_PAGES.map(featurePagePath), ...DFY_PAGES.map(dfyPagePath), "/features/call-assistant"]) {
      expect(isKnownPath(e), e).toBe(true);
    }
    for (const p of ["/nonexistent-xyz", "/features/nope", "/done-for-you/nope", "/FEATURES"]) expect(isKnownPath(p), p).toBe(false);
  });

  it("the public app pages marketing pages link to have their own title and description", () => {
    for (const [p, meta] of Object.entries(APP_PAGE_META)) {
      expect(isKnownPath(p), p).toBe(true);
      expect(MARKETING_ROUTES, p).not.toContain(p);
      expect(meta.title, p).toMatch(/ \| ConstructHUB$/);
      expect(meta.title.length, p).toBeLessThanOrEqual(60);
      expect(meta.description.length, p).toBeGreaterThan(50);
      expect(meta.description.length, p).toBeLessThanOrEqual(155);
      expect(meta.title, p).not.toBe(HOME_META.title);
    }
    expect(PUBLIC_ROUTES).not.toContain("/auth");
  });
});

describe("marketing routes: prerendered, in the sitemap, with their own head", () => {
  it("every prerendered route is in the sitemap and has its own title and description", () => {
    const sitemap = buildSitemap();
    expect(new Set(MARKETING_ROUTES).size).toBe(MARKETING_ROUTES.length);
    for (const route of MARKETING_ROUTES) {
      expect(PUBLIC_ROUTES, route).toContain(route);
      expect(sitemap, route).toContain(`<loc>${SITE_ORIGIN}${route}</loc>`);
      expect(ROUTE_META[route], route).toBeDefined();
      expect(ROUTE_META[route].title, route).toMatch(/ConstructHUB/);
      expect(ROUTE_META[route].description.length, route).toBeGreaterThan(50);
      expect(ROUTE_META[route].description.length, route).toBeLessThanOrEqual(155);
      expect(canonicalPath(route), route).toBe(route);
    }
    // The pages the owner named, and every written feature and service page.
    for (const route of ["/", "/features", "/call-assistant", "/pricing", DFY_PATH, "/reinstatement", "/terms", "/privacy"]) {
      expect(MARKETING_ROUTES).toContain(route);
    }
    for (const page of FEATURE_PAGES.filter((p) => p.status === "ready")) expect(MARKETING_ROUTES).toContain(featurePagePath(page));
    for (const page of READY_DFY_PAGES) expect(MARKETING_ROUTES).toContain(dfyPagePath(page));
  });

  it("no two marketing pages share a title or a description", () => {
    const titles = MARKETING_ROUTES.map((r) => ROUTE_META[r].title);
    const descriptions = MARKETING_ROUTES.map((r) => ROUTE_META[r].description);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
    expect(descriptions.filter((d, i) => descriptions.indexOf(d) !== i)).toEqual([]);
  });

  it("every sitemap URL has a lastmod: the build's date for the page, else the fallback", () => {
    const xml = buildSitemap({ "/features/site-scan": "2026-09-30" }, "2026-10-02");
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/features/site-scan</loc><lastmod>2026-09-30</lastmod>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc><lastmod>2026-10-02</lastmod>`);
    expect(xml.match(/<url>/g)!.length).toBe(PUBLIC_ROUTES.length);
    expect(xml.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)!.length).toBe(PUBLIC_ROUTES.length);
    // The build dates each page by the file that holds its content; every one exists.
    for (const route of PUBLIC_ROUTES) {
      const file = routeSourceFile(route);
      expect(file, route).toBeTruthy();
      expect(fs.existsSync(path.join(root, file!)), `${route} → ${file}`).toBe(true);
    }
  });

  it("the canonical origin is the primary domain", () => {
    expect(SITE_ORIGIN).toBe(`https://${PRIMARY_DOMAIN}`);
    expect(SITE_ORIGIN).toBe("https://constructhub.us");
  });

  it("every marketing route is a page in App.tsx for signed-out visitors", () => {
    for (const route of MARKETING_ROUTES) expect(routeExists(route), route).toBe(true);
    // /done-for-you is registered in both routers, like /features.
    expect(APP.match(/<Route path="\/done-for-you" component=\{DfyCataloguePage\} \/>/g)?.length).toBe(2);
    expect(APP.match(/<Route path="\/done-for-you\/:slug" component=\{DfyPageRoute\} \/>/g)?.length).toBe(2);
  });
});

describe("done-for-you registry", () => {
  const dir = path.join(root, "shared/dfy-pages");
  const EXPECTED = ["business-formation", "gmb-website-setup", "seo-ads-management", "seo-contracts", "complete-business-build"];

  it("registers every service page, each content file once, with unique kebab-case slugs", () => {
    expect(DFY_PAGES.map((p) => p.slug).sort()).toEqual([...EXPECTED].sort());
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !["index.ts", "types.ts"].includes(f));
    expect(files.map((f) => f.replace(/\.ts$/, "")).sort()).toEqual(DFY_PAGES.map((p) => p.key).sort());
    const index = read("shared/dfy-pages/index.ts");
    for (const page of DFY_PAGES) {
      expect(index).toContain(`import ${page.key} from "./${page.key}";`);
      expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(dfyPageBySlug(page.slug)).toBe(page);
      expect(dfyPageByKey(page.key)).toBe(page);
      expect(dfyPagePath(page)).toBe(`${DFY_PATH}/${page.slug}`);
    }
    const keys = DFY_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // No key collides with a feature key (a related card resolves to exactly one page).
    for (const key of keys) expect(featurePageByKey(key), key).toBeUndefined();
  });

  it("covers every done-for-you catalog item exactly once, and the existing reinstatement page", () => {
    const ids = DFY_PAGES.flatMap((p) => p.catalogIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(DFY_CATALOG).sort());
    expect(EXTERNAL_DFY_PAGES.map((e) => e.path)).toEqual(["/reinstatement"]);
    for (const e of EXTERNAL_DFY_PAGES) expect(routeExists(e.path), e.path).toBe(true);
    expect(DFY_CATALOGUE.map((e) => e.path)).toEqual([...DFY_PAGES.map(dfyPagePath), "/reinstatement"]);
  });

  it("holds every ready page to the writing guide's shape, with real sources, icons and related pages", () => {
    expect(READY_DFY_PAGES.length).toBe(DFY_PAGES.length);
    for (const page of DFY_PAGES) {
      expect(page.steps.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.steps.length, page.key).toBeLessThanOrEqual(5);
      expect(page.faqs.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length, page.key).toBeLessThanOrEqual(5);
      expect(page.cards.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.audience.length, page.key).toBeGreaterThanOrEqual(2);
      expect(page.audience.length, page.key).toBeLessThanOrEqual(4);
      expect(page.seo.title, page.key).toMatch(/\| ConstructHUB$/);
      expect(page.seo.description.length, page.key).toBeLessThanOrEqual(155);
      expect(page.blurb.length, page.key).toBeLessThanOrEqual(60);
      expect(FEATURE_ICONS).toContain(page.icon);
      for (const card of page.cards) expect(FEATURE_ICONS).toContain(card.icon);
      for (const source of page.sources) expect(fs.existsSync(path.join(root, source.replace(/\s*\(.*\)$/, ""))), `${page.key}: ${source}`).toBe(true);
      for (const key of page.related) {
        expect(key).not.toBe(page.key);
        expect(DFY_CATALOGUE.some((e) => e.key === key) || FEATURE_CATALOGUE.some((e) => e.key === key), `${page.key} → ${key}`).toBe(true);
      }
      // No testimonials, invented numbers or ranking promises (the catalog ids and source paths are not copy).
      const { catalogIds: _ids, sources: _sources, ...copy } = page;
      const text = JSON.stringify(copy);
      expect(text, page.key).not.toMatch(/testimonial|guarantee|#1\b|\b\d+%|\b\d+x\b|\btop\s?3\b|domination/i);
    }
  });
});

describe("no typed prices in page content", () => {
  it("types no $ amounts in any feature or done-for-you content file, or in the route meta", () => {
    const files = [
      ...FEATURE_PAGES.map((p) => `shared/feature-pages/${p.key}.ts`),
      ...DFY_PAGES.map((p) => `shared/dfy-pages/${p.key}.ts`),
      "shared/dfy-pages/index.ts",
      "shared/route-meta.ts",
      "shared/seo.ts",
    ];
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/\$\s?\d/);
      expect(src, file).not.toMatch(/\b\d[\d,.]*\s?(dollars|USD)\b/i);
    }
  });

  it("anything at or above $1,000 is never shown as a price on a done-for-you page or its card", () => {
    for (const page of DFY_PAGES) {
      const salesOnly = page.catalogIds.some((id) => !showsPrice(DFY_CATALOG[id].priceCents));
      if (salesOnly) expect(page.pricing.kind, page.key).toBe("sales");
      const s = featurePriceSummary(page.pricing);
      if (page.pricing.kind === "sales") {
        expect(s.price, page.key).toBeNull();
        expect(s.headline).toBe(SALES_REP_LABEL);
      }
      // Whatever the page renders as text — its content and its price block — holds no amount at the threshold or above.
      const shown = JSON.stringify(page) + JSON.stringify(s);
      expect(dollarAmounts(shown).filter((c) => c >= SALES_THRESHOLD_CENTS).map(formatUsd), page.key).toEqual([]);
    }
    for (const entry of DFY_CATALOGUE) {
      const s = featurePriceSummary(entry.pricing);
      if (s.price && s.price !== SALES_REP_LABEL) expect(dollarAmounts(s.price)[0], entry.key).toBeLessThan(SALES_THRESHOLD_CENTS);
    }
    // Every done-for-you catalog item is at or above the threshold today: every page is "Talk to a sales rep".
    expect(DFY_PAGES.every((p) => p.pricing.kind === "sales")).toBe(Object.values(DFY_CATALOG).every((i) => !showsPrice(i.priceCents)));
  });
});

describe("JSON-LD builders", () => {
  it("FAQPage comes from the page's FAQ, question by question", () => {
    const page = dfyPageByKey("formation")!;
    const faq = faqPageJsonLd(page.faqs) as any;
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(page.faqs.length);
    page.faqs.forEach((f, i) => {
      expect(faq.mainEntity[i]).toEqual({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } });
    });
    expect(faqPageJsonLd([])).toBeNull();
    expect(faqPageJsonLd([{ q: " ", a: "x" }])).toBeNull();
  });

  it("no Offer for 'Talk to a sales rep', a coming-soon add-on or a free-with-account feature; an Offer for a shown price", () => {
    const url = `${SITE_ORIGIN}/x`;
    expect(offerJsonLd(featurePriceSummary({ kind: "sales", topic: "SEO" }), url)).toBeNull();
    expect(offerJsonLd(featurePriceSummary({ kind: "account" }), url)).toBeNull();
    const ca = featurePriceSummary({ kind: "addon", addon: "call_assistant" });
    if (ADDONS.call_assistant.preview) expect(offerJsonLd(ca, url)).toBeNull();
    const cheapest = PLAN_KEYS.reduce((a, b) => (PLANS[b].monthlyCents < PLANS[a].monthlyCents ? b : a));
    const offer = offerJsonLd(featurePriceSummary({ kind: "plan" }), url) as any;
    expect(offer).toMatchObject({ "@type": "Offer", price: (PLANS[cheapest].monthlyCents / 100).toFixed(2), priceCurrency: "USD", url });
    expect(offer.priceSpecification.unitText).toBe("month");
  });

  it("a service page is a Service with no Offer and its FAQ; a feature is a SoftwareApplication priced from the price book", () => {
    for (const page of DFY_PAGES) {
      const graph = graphOf(dfyPagePath(page));
      const service = node(graph, "Service");
      expect(service, page.key).toMatchObject({ name: page.title, url: `${SITE_ORIGIN}${dfyPagePath(page)}` });
      if (page.pricing.kind === "sales") expect(service.offers, page.key).toBeUndefined();
      expect(node(graph, "FAQPage").mainEntity).toHaveLength(page.faqs.length);
      expect(node(graph, "BreadcrumbList").itemListElement.map((i: any) => i.name)).toEqual(["Home", "Done-For-You Services", page.title]);
    }
    const scan = graphOf("/features/site-scan");
    const app = node(scan, "SoftwareApplication");
    const cheapest = PLAN_KEYS.reduce((a, b) => (PLANS[b].monthlyCents < PLANS[a].monthlyCents ? b : a));
    expect(app.offers.price).toBe((PLANS[cheapest].monthlyCents / 100).toFixed(2));
    expect(node(scan, "FAQPage").mainEntity).toHaveLength(featurePageByKey("siteScan")!.faqs.length);
    // The reinstatement service shows its one-time price, so it carries an Offer (when under the threshold).
    const reinstatement = node(graphOf("/features/reinstatement"), "Service");
    const s = featurePriceSummary({ kind: "service", service: "gbpReinstatement" });
    if (s.price && s.price !== SALES_REP_LABEL) expect(reinstatement.offers.price).toBe((dollarAmounts(s.price)[0] / 100).toFixed(2));
    else expect(reinstatement.offers).toBeUndefined();
    // /call-assistant: listed as a feature; an Offer only once the add-on is for sale.
    const ca = node(graphOf("/call-assistant"), "SoftwareApplication");
    expect(ca.name).toBe("AI Call Assistant");
    expect(!!ca.offers).toBe(!ADDONS.call_assistant.preview);
  });

  it("Organization on every marketing page, a breadcrumb on every page but home, nothing for other paths", () => {
    for (const route of MARKETING_ROUTES) {
      const graph = graphOf(route);
      expect(node(graph, "Organization"), route).toMatchObject({ name: "ConstructHUB", url: `${SITE_ORIGIN}/` });
      if (route === "/") {
        expect(node(graph, "WebSite")).toBeDefined();
        expect(node(graph, "BreadcrumbList")).toBeUndefined();
      } else {
        const trail = node(graph, "BreadcrumbList").itemListElement;
        expect(trail[0]).toMatchObject({ position: 1, name: "Home", item: `${SITE_ORIGIN}/` });
        expect(trail[trail.length - 1].item, route).toBe(`${SITE_ORIGIN}${route}`);
      }
      // Valid JSON, safe inside <script>.
      const text = serializeJsonLd(graph);
      expect(text).not.toContain("</");
      expect(JSON.parse(text)["@graph"]).toHaveLength(graph.length);
    }
    expect(graphOf("/search")).toEqual([]);
    expect(seoHeadFor("/settings")).toBeNull();
    expect(breadcrumbJsonLd([{ name: "Home", path: "/" }])).toBeNull();
    expect(serializeJsonLd([{ "@type": "Thing", name: "</script><script>x" }])).not.toContain("</script>");
  });
});

describe("the HTML head the server writes", () => {
  const shell = read("client/index.html");

  it("a marketing page gets its title, description, canonical, Open Graph / Twitter tags and JSON-LD", () => {
    const html = withSeoHead(shell, "/done-for-you/seo-contracts");
    const page = dfyPageBySlug("seo-contracts")!;
    expect(html).toContain(`<title>${page.seo.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${page.seo.description}" />`);
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/done-for-you/seo-contracts" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/done-for-you/seo-contracts" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:title" content="${page.seo.title}" />`);
    const json = html.match(/<script type="application\/ld\+json" data-seo="jsonld" data-path="([^"]+)">([\s\S]*?)<\/script>/)!;
    expect(json[1]).toBe("/done-for-you/seo-contracts");
    expect(JSON.parse(json[2])["@graph"].map((n: any) => n["@type"])).toEqual(["Organization", "BreadcrumbList", "Service", "FAQPage"]);
    expect(html.match(/<link rel="canonical"/g)).toHaveLength(1);
  });

  it("any other path keeps the defaults with its own canonical and no JSON-LD", () => {
    const html = withSeoHead(shell, "/search");
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/search" />`);
    expect(html).not.toContain("application/ld+json");
  });
});

describe("the prerendered pages on the server", () => {
  const shell = read("client/index.html");
  let tmp = "";
  let publicDir = "";
  let server: Server;
  let base = "";
  const get = (p: string, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { headers });

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chub-prerender-"));
    publicDir = path.join(tmp, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, "index.html"), shell);
    for (const [route, h1] of [["/", "Home snapshot"], ["/features/site-scan", "Site Scan snapshot"]] as const) {
      const file = prerenderFile(publicDir, route);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, composePage(shell, route, `${consentSlot('<div data-testid="cookie-consent-banner">c</div>')}<main><h1>${h1}</h1></main>`));
    }
    // Not a marketing route: never served, even if a file is there.
    fs.mkdirSync(path.join(publicDir, PRERENDER_DIR, "search"), { recursive: true });
    fs.writeFileSync(path.join(publicDir, PRERENDER_DIR, "search", "index.html"), '<div id="root" data-prerendered="/search">x</div>');
    fs.writeFileSync(path.join(tmp, SEO_MANIFEST), JSON.stringify({ lastmod: { "/features/site-scan": "2026-09-30" } }));

    const app = express();
    // A signed-in visitor, as passport would mark one.
    app.use((req, _res, next) => {
      const signedIn = req.headers["x-test-user"] === "1";
      (req as any).isAuthenticated = () => signedIn;
      if (signedIn) (req as any).user = { id: 1 };
      next();
    });
    serveStatic(app, publicDir);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads only marketing routes that carry the prerender mark", () => {
    const pages = loadPrerenderedPages(publicDir);
    expect([...pages.keys()].sort()).toEqual(["/", "/features/site-scan"]);
  });

  it("ignores a snapshot from an older build (its bundles are gone)", () => {
    const built = shell.replace("</head>", '<script type="module" crossorigin src="/assets/index-NEW1.js"></script>\n<link rel="stylesheet" crossorigin href="/assets/index-NEW2.css">\n</head>');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chub-stale-"));
    try {
      fs.writeFileSync(path.join(dir, "index.html"), built);
      const write = (route: string, html: string) => {
        const file = prerenderFile(dir, route);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, html);
      };
      write("/", composePage(built, "/", "<main><h1>fresh</h1></main>"));
      write("/pricing", composePage(built.replace(/NEW/g, "OLD"), "/pricing", "<main><h1>stale</h1></main>"));
      expect([...loadPrerenderedPages(dir).keys()]).toEqual(["/"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the snapshot to every signed-out visitor, whatever the user agent", async () => {
    for (const ua of ["Mozilla/5.0 (iPhone)", "Googlebot/2.1 (+http://www.google.com/bot.html)", "curl/8"]) {
      const res = await get("/features/site-scan", { "user-agent": ua });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root" data-prerendered="/features/site-scan">');
      expect(html).toContain("<h1>Site Scan snapshot</h1>");
      expect(html).toContain('<template id="ch-consent-banner">');
      expect(res.headers.get("vary")).toMatch(/cookie/i);
    }
    // The canonical form of the path: a trailing slash or a query still gets the page's snapshot.
    expect(await (await get("/features/site-scan/?utm_source=x")).text()).toContain("Site Scan snapshot");
    expect(await (await get("/")).text()).toContain("Home snapshot");
  });

  it("serves the app shell to a signed-in visitor, and to paths that were not prerendered", async () => {
    const signedIn = await (await get("/features/site-scan", { "x-test-user": "1" })).text();
    expect(signedIn).not.toContain("data-prerendered");
    expect(signedIn).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/features/site-scan" />`);
    expect(signedIn).toContain("application/ld+json");
    const other = await (await get("/search")).text();
    expect(other).not.toContain("data-prerendered");
    const notBuilt = await (await get("/pricing")).text();
    expect(notBuilt).not.toContain("data-prerendered");
    expect(notBuilt).toContain(`<title>${ROUTE_META["/pricing"].title.replace(/&/g, "&amp;")}</title>`);
  });

  it("answers an unknown URL with an honest 404 (noindex, no canonical), and a wrong-case marketing URL with a 301", async () => {
    // A missing static file is not a page: a plain 404, never the app's HTML (server/static-assets.test.ts).
    const gone = await get("/assets/gone.js");
    expect([gone.status, gone.headers.get("content-type"), gone.headers.get("cache-control")]).toEqual([404, "text/plain; charset=utf-8", "no-store"]);
    for (const p of ["/nonexistent-xyz", "/features/no-such-feature", "/done-for-you/nope"]) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      const html = await res.text();
      expect(html, p).toContain('<meta name="robots" content="noindex" />');
      expect(html, p).not.toContain('rel="canonical"');
      expect(html, p).not.toContain("data-prerendered");
    }
    const moved = await fetch(`${base}/FEATURES/Site-Scan?x=1`, { redirect: "manual" });
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/features/site-scan?x=1");
    // The app's own pages still answer 200, with their own title where they have one.
    for (const p of ["/search", "/auth", "/free-site-scan", "/google-ads-guide/campaign-setup", "/review/AbC123", "/features/call-assistant"]) {
      expect((await get(p)).status, p).toBe(200);
    }
    const auth = await (await get("/auth")).text();
    expect(auth).toContain(`<title>${APP_PAGE_META["/auth"].title}</title>`);
    expect(auth).not.toContain(HOME_META.title);
  });

  it("never serves the snapshot files at their own URL, nor to the CRM host", async () => {
    expect((await get(`/${PRERENDER_DIR}/features/site-scan/index.html`)).status).toBe(404);
    const portal = await get("/features/site-scan", { "x-forwarded-host": "portal.constructhub.us" });
    const html = await portal.text();
    expect(html).not.toContain("data-prerendered");
    expect(portal.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("the sitemap carries the build's lastmod dates", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/features/site-scan</loc><lastmod>2026-09-30</lastmod>`);
    expect(xml.match(/<url>/g)!.length).toBe(PUBLIC_ROUTES.length);
  });
});

describe("composing a prerendered page", () => {
  const shell = read("client/index.html");

  it("puts the rendered page in #root, marked, inside the page's own head", () => {
    const html = composePage(shell, "/done-for-you", "<main><h1>Hi</h1></main>", [faqPageJsonLd([{ q: "Q?", a: "A." }])!]);
    expect(html).toContain('<div id="root" data-prerendered="/done-for-you"><main><h1>Hi</h1></main></div>');
    // index.html's static fallback is replaced, not kept beside the page.
    expect(html).not.toContain("max-width:720px");
    expect(html.match(/<div id="root"/g)).toHaveLength(1);
    expect(html).toContain(`<title>${ROUTE_META[DFY_PATH].title}</title>`);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)![1])["@graph"];
    expect(graph.map((n: any) => n["@type"])).toContain("FAQPage");
  });

  it("the cookie banner is inert until a visitor without a ch_consent cookie loads the page", () => {
    const slot = consentSlot('<div data-testid="cookie-consent-banner">c</div>');
    expect(slot).toMatch(/^<template id="ch-consent-banner"><div data-testid="cookie-consent-banner">c<\/div><\/template><script>/);
    const test = slot.match(/if\((\/[^/]+\/)\.test\(document\.cookie\)\)/)![1];
    const re = new Function(`return ${test}`)() as RegExp;
    expect(re.test("ch_consent=denied")).toBe(true);
    expect(re.test("a=1; ch_consent=granted")).toBe(true);
    expect(re.test("x_ch_consent=granted")).toBe(false);
    expect(re.test("")).toBe(false);
  });
});

describe("the admin index", () => {
  it("lists the done-for-you services as a second group after the features", () => {
    const { pages, services, serviceCounts } = adminFeaturePageRows();
    expect(services).toBe(DFY_PATH);
    const dfyRows = pages.filter((r) => r.group === "dfy");
    expect(dfyRows.map((r) => r.path)).toEqual(DFY_CATALOGUE.map((e) => e.path));
    expect(dfyRows.every((r) => r.groupLabel === "Done-For-You Services" && r.app === null)).toBe(true);
    const firstDfy = pages.findIndex((r) => r.group === "dfy");
    expect(pages.slice(0, firstDfy).every((r) => r.group !== "dfy" && r.group !== "site")).toBe(true);
    expect(serviceCounts.ready + serviceCounts.stub).toBe(DFY_PAGES.length);
  });
});
