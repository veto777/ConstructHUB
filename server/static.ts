import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import {
  PRIMARY_DOMAIN,
  SITE_DOMAINS,
  isPortalHost,
  isClientHost,
  requestHost,
} from "./site-context";
import { MARKETING_ROUTES, canonicalPath } from "@shared/seo";
import { isKnownPath, marketingRouteForCase } from "@shared/app-routes";
import { withRouteMeta, withSeoHead } from "./seo-html";
import { withGoogleTag } from "./google-tag";
import { registerAdsLanding, ADS_LANDING_PATHS } from "./ads-landing";
import { registerAdsLandingRecording } from "./ads-landing-recording";

export { withRouteMeta, withSeoHead };

const CANONICAL_HOST = PRIMARY_DOMAIN;
const BASE = `https://${CANONICAL_HOST}`;

// Public, indexable routes: every marketing page (shared/seo.ts — the same
// list the build prerenders). The sign-in page is left out (it has nothing to
// rank for) and so are app/dashboard routes — they render behind auth.
// Feature and service pages join once written: a stub (status "stub") is not
// listed. The retired one-off landing pages (/google-ads-landing, …) only
// redirect to their /features page, so they are not listed.
export const PUBLIC_ROUTES: readonly string[] = [...MARKETING_ROUTES];

/** Where the build writes the prerendered pages (script/prerender.ts), under dist/public. */
export const PRERENDER_DIR = "prerender";
/** The build's lastmod dates for the sitemap (script/build.ts), next to dist/index.cjs. */
export const SEO_MANIFEST = "seo-manifest.json";

/**
 * Retired pages and where they live now (301, so search engines move the old
 * URL's standing to the new one). Single tools are no longer sold on their own
 * — they are add-ons to a plan (shared/plans.ts ADDONS).
 */
export const RETIRED_ROUTES: Record<string, string> = {
  "/individual-pricing": "/pricing#add-ons",
};

/**
 * The sitemap: every public route with its <lastmod> — the build's date for
 * that page (the last commit of its content file), else `fallbackDate`.
 */
export function buildSitemap(lastmod: Readonly<Record<string, string>> = {}, fallbackDate = new Date().toISOString().slice(0, 10)): string {
  const urls = PUBLIC_ROUTES.map(
    (r) => `  <url><loc>${BASE}${r}</loc><lastmod>${lastmod[r] ?? fallbackDate}</lastmod></url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The hashed bundles a build's index.html loads (/assets/index-….js, /assets/index-….css). */
const assetRefs = (html: string) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

/**
 * The prerendered pages under `distPath`/prerender: "/features/site-scan" →
 * the HTML in prerender/features/site-scan/index.html. Only marketing routes,
 * so a stray file can never be served for another path, and only snapshots of
 * THIS build: the deploy copies dist/ without deleting old files, so a page the
 * latest build failed to prerender may still have an older snapshot on disk —
 * one pointing at bundles that no longer exist. A snapshot must load every
 * bundle the current index.html loads, or the shell serves that page. Empty
 * when the build shipped without them (the prerender step is allowed to fail).
 */
export function loadPrerenderedPages(distPath: string, indexHtml?: string): Map<string, string> {
  const pages = new Map<string, string>();
  const dir = path.join(distPath, PRERENDER_DIR);
  if (!fs.existsSync(dir)) return pages;
  let current: string[] = [];
  try {
    current = assetRefs(indexHtml ?? fs.readFileSync(path.join(distPath, "index.html"), "utf-8"));
  } catch { /* no index.html: nothing to match against */ }
  for (const route of MARKETING_ROUTES) {
    const file = path.join(dir, route === "/" ? "" : route.slice(1), "index.html");
    try {
      const html = fs.readFileSync(file, "utf-8");
      if (!html.includes('data-prerendered="')) continue;
      if (!current.every((ref) => html.includes(`"${ref}"`))) continue;
      pages.set(route, html);
    } catch { /* not prerendered: the shell serves it */ }
  }
  return pages;
}

function readLastmod(distRoot: string): Record<string, string> {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, SEO_MANIFEST), "utf-8"));
    return manifest && typeof manifest.lastmod === "object" ? manifest.lastmod : {};
  } catch {
    return {};
  }
}

/** The build's content-hashed bundles: /assets/<name>-<hash>.js|css|… (vite's assetsDir). */
export const HASHED_ASSETS_PREFIX = "/assets/";

const STATIC_FILE_RE = /\.(?:m?js|css|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp3|mp4|m4a|webm|wav|ogg|pdf|txt|xml|webmanifest|wasm)$/i;

/**
 * A URL that names a static file: anything under /assets/ and any path ending
 * in a file extension the build ships. When no file matches, the answer is a
 * plain 404 — never the app's HTML. A tab opened before a deploy asks for a
 * hashed bundle the deploy deleted (script/deploy-vb11.sh rsyncs assets with
 * --delete); answered with index.html the browser rejects it ("'text/html' is
 * not a valid JavaScript MIME type") and Cloudflare, which caches by file
 * extension, kept such an HTML answer under an image URL for 4 h (HANDOFF.md).
 */
export function isStaticFilePath(pathname: string): boolean {
  return pathname.startsWith(HASHED_ASSETS_PREFIX) || STATIC_FILE_RE.test(pathname);
}

/** A hashed bundle never changes under its name; everything else is revalidated. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** The HTML names the current bundles, so it is revalidated on every load (a reload after a deploy gets the new names). */
export const HTML_CACHE = "no-cache";

/** Signed in (a session the auth middleware recognised)? Then the page is the app frame, not the marketing snapshot. */
const isSignedIn = (req: express.Request) =>
  typeof (req as any).isAuthenticated === "function" ? !!(req as any).isAuthenticated() : !!(req as any).user;

export function serveStatic(app: Express, distPath = path.resolve(__dirname, "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  // The pages the build prerendered (full HTML for every visitor who is not
  // signed in — crawler or person alike, never by user agent) and the build's
  // lastmod dates; the build date stands in for a page without one.
  const prerendered = loadPrerenderedPages(distPath, indexHtml);
  // The Google tag (Ads conversions / GA4) rides on the marketing hosts' pages
  // only — never the CRM app or the client portal, which keep `indexHtml`.
  for (const [route, html] of prerendered) prerendered.set(route, withGoogleTag(html));
  const marketingHtml = withGoogleTag(indexHtml);
  const builtOn = fs.statSync(path.resolve(distPath, "index.html")).mtime.toISOString().slice(0, 10);
  const sitemapXml = buildSitemap(readLastmod(path.resolve(distPath, "..")), builtOn);

  // Every marketing domain serves the SAME content — constructhub.app is not a
  // redirect to constructhub.us, it is the site. Duplicate-content risk is
  // handled by the cross-domain canonical injected below (every page on every
  // domain declares the primary domain as the original), which is how Google
  // asks you to consolidate ranking signals across domains you own.
  //
  // The only redirect is www -> apex WITHIN the same domain, so each domain
  // keeps a single hostname rather than two.
  app.use((req, res, next) => {
    const host = requestHost(req);
    if (isPortalHost(host) || isClientHost(host)) return next();

    const wwwOf = SITE_DOMAINS.find((d) => host === `www.${d}`);
    if (wwwOf) {
      return res.redirect(301, `https://${wwwOf}${req.originalUrl}`);
    }
    next();
  });

  app.get("/robots.txt", (req, res) => {
    // The CRM and the client portal must never be crawled.
    if (isPortalHost(requestHost(req)) || isClientHost(requestHost(req))) {
      return res.type("text/plain").send(`User-agent: *\nDisallow: /\n`);
    }
    res
      .type("text/plain")
      .send(`User-agent: *\nAllow: /\n${ADS_LANDING_PATHS.map((p) => `Disallow: ${p}\n`).join("")}Sitemap: ${BASE}/sitemap.xml\n`);
  });

  // The Google Ads landing doors (server/ads-landing.ts): the public page behind
  // a click-id + campaign-key check, bots blocked and fed to Click Guard.
  registerAdsLanding(app, (publicPath) =>
    prerendered.get(publicPath) ?? withSeoHead(marketingHtml, publicPath, { origin: BASE }));
  registerAdsLandingRecording(app);

  for (const [from, to] of Object.entries(RETIRED_ROUTES)) {
    app.get(from, (_req, res) => res.redirect(301, to));
  }

  app.get("/sitemap.xml", (req, res) => {
    if (isPortalHost(requestHost(req)) || isClientHost(requestHost(req))) return res.status(404).type("text/plain").send("Not found");
    res.type("application/xml").send(sitemapXml);
  });

  // The prerendered files are served only at their page's own URL (below), never as /prerender/….
  app.use(`/${PRERENDER_DIR}`, (_req, res) => { res.status(404).type("text/plain").send("Not found"); });

  const assetsDir = path.join(distPath, HASHED_ASSETS_PREFIX);
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.startsWith(assetsDir)) res.setHeader("Cache-Control", IMMUTABLE_CACHE);
      else if (filePath.endsWith(".html")) res.setHeader("Cache-Control", HTML_CACHE);
    },
  }));

  // A static file that is not there (a bundle an earlier build shipped, a
  // mistyped image) is a short plain 404 on every host, marked no-store so no
  // browser or edge cache keeps it under that file's URL. A real app route
  // that happens to end in ".pdf" or the like still gets the app.
  app.use((req, res, next) => {
    if (!isStaticFilePath(req.path)) return next();
    if (!req.path.startsWith(HASHED_ASSETS_PREFIX) && isKnownPath(canonicalPath(req.originalUrl))) return next();
    res.status(404).setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("text/plain").send("Not found\n");
  });

  // Fall through to index.html with a per-path canonical injected, so every
  // SPA route declares its own canonical URL (GSC: "Duplicate without
  // user-selected canonical" fix).
  app.use("/{*path}", (req, res) => {
    // Every HTML answer below is revalidated: it names this build's hashed bundles.
    res.setHeader("Cache-Control", HTML_CACHE);
    // originalUrl, not req.path — inside app.use() req.path is stripped to the
    // mount remainder and always reads "/".
    if (isPortalHost(requestHost(req)) || isClientHost(requestHost(req))) {
      const html = indexHtml.replace(
        /<\/title>/i,
        `</title>\n    <meta name="robots" content="noindex, nofollow" />`,
      );
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      return res.type("html").send(html);
    }
    const pagePath = canonicalPath(req.originalUrl);
    // A marketing page in the wrong case ("/FEATURES/GBP") moves to its one URL.
    const cased = marketingRouteForCase(pagePath);
    if (cased) {
      const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      return res.redirect(301, `${cased}${query}`);
    }
    // The HTML depends on the session cookie (snapshot signed out, shell signed in).
    res.setHeader("Vary", "Cookie");
    const snapshot = prerendered.get(pagePath);
    if (snapshot && !isSignedIn(req)) return res.type("html").send(snapshot);
    // A URL the app doesn't answer is an honest 404 (the app shows its Not Found
    // page), never a 200 that reads as the home page to a search engine.
    if (!isKnownPath(pagePath)) {
      // No canonical: a page that doesn't exist names no URL as its original.
      const html = marketingHtml.replace(
        /<\/title>/i,
        () => `</title>\n    <meta name="robots" content="noindex" />`,
      );
      return res.status(404).type("html").send(html);
    }
    res.type("html").send(withSeoHead(marketingHtml, pagePath, { origin: BASE }));
  });
}
