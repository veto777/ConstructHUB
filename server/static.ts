import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import {
  PRIMARY_DOMAIN,
  SITE_DOMAINS,
  isPortalHost,
  requestHost,
} from "./site-context";

const CANONICAL_HOST = PRIMARY_DOMAIN;
const BASE = `https://${CANONICAL_HOST}`;

// Public, indexable routes (marketing + legal). App/dashboard routes are
// deliberately excluded — they render behind auth and shouldn't be indexed.
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/individual-pricing",
  "/google-ads-landing",
  "/google-ads-guide",
  "/google-ad-fraud",
  "/master-class-landing",
  "/lsa-guide",
  "/google-business",
  "/privacy",
  "/terms",
  "/auth",
];

/** Normalize a request path for the canonical tag: no query, no trailing
 * slash (except root), collapse to root on anything weird. */
function canonicalPath(reqPath: string): string {
  let p = (reqPath || "/").split("?")[0];
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  if (!p.startsWith("/") || p.includes("..")) p = "/";
  return p;
}

function buildSitemap(): string {
  const urls = PUBLIC_ROUTES.map(
    (r) => `  <url><loc>${BASE}${r === "/" ? "/" : r}</loc></url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  const sitemapXml = buildSitemap();

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
    if (isPortalHost(host)) return next();

    const wwwOf = SITE_DOMAINS.find((d) => host === `www.${d}`);
    if (wwwOf) {
      return res.redirect(301, `https://${wwwOf}${req.originalUrl}`);
    }
    next();
  });

  app.get("/robots.txt", (req, res) => {
    // The CRM must never be crawled.
    if (isPortalHost(requestHost(req))) {
      return res.type("text/plain").send(`User-agent: *\nDisallow: /\n`);
    }
    res
      .type("text/plain")
      .send(`User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", (req, res) => {
    if (isPortalHost(requestHost(req))) return res.status(404).type("text/plain").send("Not found");
    res.type("application/xml").send(sitemapXml);
  });

  app.use(express.static(distPath, { index: false }));

  // Fall through to index.html with a per-path canonical injected, so every
  // SPA route declares its own canonical URL (GSC: "Duplicate without
  // user-selected canonical" fix).
  app.use("/{*path}", (req, res) => {
    // originalUrl, not req.path — inside app.use() req.path is stripped to the
    // mount remainder and always reads "/".
    if (isPortalHost(requestHost(req))) {
      const html = indexHtml.replace(
        /<\/title>/i,
        `</title>\n    <meta name="robots" content="noindex, nofollow" />`,
      );
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      return res.type("html").send(html);
    }
    const canonical = `${BASE}${canonicalPath(req.originalUrl)}`;
    const html = indexHtml.replace(
      /<\/title>/i,
      `</title>\n    <link rel="canonical" href="${canonical}" />`,
    );
    res.type("html").send(html);
  });
}
