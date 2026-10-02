/**
 * Prerender the public marketing pages (shared/seo.ts MARKETING_ROUTES) into
 * full HTML, so Google and every other visitor get the page's text, headings,
 * links and structured data before any JavaScript runs (React shells cost
 * rankings). Runs at the end of `npm run build` (script/build.ts):
 *
 *   1. serve the fresh build (dist/public) from a throwaway local server — the
 *      SPA shell with each page's head (server/seo-html.ts), /api/auth/me
 *      answering "signed out" and every other /api call refused, so no
 *      database, session or secret is needed and nothing is written anywhere;
 *   2. open each page signed out in headless Chromium (playwright-core and its
 *      chromium-headless-shell — the same browser the live permit search uses);
 *   3. drop the client-only noise (cookie banner, Gabe's launcher, toasts) and
 *      write the rendered page, inside the build's own index.html with the
 *      page's <title>, description, canonical, Open Graph tags and JSON-LD,
 *      to dist/public/prerender/<path>/index.html.
 *
 * The cookie banner sits in the page flow at the top (it must never cover an
 * action), so leaving it out would push the page down when the app boots for a
 * visitor who hasn't answered yet. It ships as an inert <template> instead —
 * not page content — and a two-line script shows it before first paint only
 * when there is no ch_consent cookie, exactly as CookieConsent will.
 *
 * server/static.ts serves that file at the page's URL to every visitor who is
 * not signed in (never by user agent), and the app boots on top of it
 * (client/src/main.tsx). Numbers the page fetches at runtime (permit counts)
 * are not in the snapshot — the API is refused here — and fill in on boot.
 *
 * A route that fails is left out (the shell serves it, as before); the caller
 * decides how loud to be. Run alone: npx tsx script/prerender.ts [dist/public]
 */
import express from "express";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { chromium, type Browser } from "playwright-core";
import { MARKETING_ROUTES, canonicalPath, faqPageJsonLd, seoHeadFor, type JsonLd } from "../shared/seo";
import { withSeoHead } from "../server/seo-html";
import { PRERENDER_DIR } from "../server/static";

export type PrerenderResult = {
  written: string[];
  failed: { route: string; reason: string }[];
  /** API paths the pages asked for (refused while prerendering) — for the build log. */
  apiCalls: string[];
};

const CONSENT_BANNER = '[data-testid="cookie-consent-banner"]';

/** Client-only pieces that never belong in the snapshot's content. */
const NOISE = [
  '[data-testid="hub-launcher"]',
  '[data-testid="hub-welcome-bubble"]',
  '[data-testid="hub-panel"]',
  '[role="region"][aria-label^="Notifications"]',
];

/** prerender/<path>/index.html for a route ("/" → prerender/index.html). */
export const prerenderFile = (publicDir: string, route: string) =>
  path.join(publicDir, PRERENDER_DIR, route === "/" ? "" : route.slice(1), "index.html");

/**
 * The cookie banner for a visitor who hasn't answered (components/cookie-consent.tsx
 * shows it while there is no ch_consent cookie): inert until the script moves it
 * into the page, at the top of #root where the app renders it.
 */
export function consentSlot(bannerHtml: string): string {
  return `<template id="ch-consent-banner">${bannerHtml}</template>` +
    `<script>(function(){try{if(/(?:^|;\\s*)ch_consent=[^;]/.test(document.cookie))return}catch(e){}` +
    `var t=document.getElementById("ch-consent-banner");if(t)t.replaceWith(t.content)})()</script>`;
}

/** The build's index.html with the rendered page in #root (marked, so the app knows it booted on a snapshot). */
export function composePage(shell: string, route: string, rootHtml: string, extra: readonly JsonLd[] = []): string {
  const html = withSeoHead(shell, route, { extra });
  // index.html's #root holds only the static fallback (no nested <div>), so its first </div> closes it.
  const open = html.indexOf('<div id="root">');
  const close = open < 0 ? -1 : html.indexOf("</div>", open);
  if (open < 0 || close < 0 || html.slice(open + '<div id="root">'.length, close).includes("<div")) {
    throw new Error('index.html has no <div id="root"> holding only the static fallback');
  }
  return `${html.slice(0, open)}<div id="root" data-prerendered="${route}">${rootHtml}</div>${html.slice(close + "</div>".length)}`;
}

/** A throwaway server for the fresh build: no database, no session, no API beyond "signed out". */
function startShellServer(publicDir: string, shell: string, apiCalls: Set<string>): Promise<Server> {
  const app = express();
  app.get("/api/auth/me", (_req, res) => { res.json(null); });
  app.use("/api", (req, res) => {
    apiCalls.add(req.path);
    res.status(404).json({ message: "Not available while prerendering" });
  });
  app.use(`/${PRERENDER_DIR}`, (_req, res) => { res.status(404).end(); });
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res) => { res.type("html").send(withSeoHead(shell, canonicalPath(req.originalUrl))); });
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function renderRoute(browser: Browser, base: string, route: string): Promise<{ html: string; banner: string | null; faq: { q: string; a: string }[] }> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Count-ups show their real number at once; the snapshot never holds a "0" mid-animation.
    reducedMotion: "reduce",
    colorScheme: "light",
    serviceWorkers: "block",
    locale: "en-US",
  });
  try {
    // Only the local build: fonts, reCAPTCHA and analytics stay out of the snapshot (and its timing).
    await context.route("**/*", (r) => {
      const url = new URL(r.request().url());
      return url.hostname === "127.0.0.1" ? r.continue() : r.abort();
    });
    const page = await context.newPage();
    await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
    // React has replaced index.html's static fallback with the page (it carries testids; the fallback has none).
    await page.waitForFunction(() => {
      const root = document.getElementById("root");
      return !!root && !!root.querySelector("[data-testid]") && !root.querySelector(".animate-spin") && root.innerText.trim().length > 200;
    }, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    return await page.evaluate(([noise, consent]) => {
      const root = document.getElementById("root")!;
      if (/\bPage Not Found\b/.test(root.innerText)) throw new Error("rendered the 404 page");
      const banner = root.querySelector(consent)?.outerHTML ?? null;
      for (const el of Array.from(root.querySelectorAll([consent, ...noise].join(",")))) el.remove();
      // The FAQ as rendered (section#faq <details>): used when the page's FAQ isn't content data (/call-assistant).
      const faq = Array.from(document.querySelectorAll("section#faq details")).map((d) => {
        const q = d.querySelector("summary")?.textContent?.trim() ?? "";
        const a = Array.from(d.children).filter((c) => c.tagName !== "SUMMARY").map((c) => c.textContent?.trim() ?? "").join(" ").trim();
        return { q, a };
      }).filter((f) => f.q && f.a);
      return { html: root.innerHTML, banner, faq };
    }, [NOISE, CONSENT_BANNER] as const);
  } finally {
    await context.close();
  }
}

export async function prerenderMarketingPages(opts: {
  publicDir: string;
  routes?: readonly string[];
  concurrency?: number;
  log?: (message: string) => void;
}): Promise<PrerenderResult> {
  const { publicDir, routes = MARKETING_ROUTES, concurrency = 4, log = console.log } = opts;
  const shell = fs.readFileSync(path.join(publicDir, "index.html"), "utf-8");
  const apiCalls = new Set<string>();
  const result: PrerenderResult = { written: [], failed: [], apiCalls: [] };
  fs.rmSync(path.join(publicDir, PRERENDER_DIR), { recursive: true, force: true });

  const server = await startShellServer(publicDir, shell, apiCalls);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let browser: Browser | null = null;
  try {
    // CHROMIUM_PATH wins (as for the live permit search, server/scraper.ts); else playwright-core's headless shell.
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const queue = [...routes];
    const worker = async () => {
      for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
        try {
          const { html, banner, faq } = await renderRoute(browser!, base, route);
          // An FAQ the content data doesn't already describe becomes the page's FAQPage.
          const hasFaq = seoHeadFor(route)?.jsonLd.some((n) => n["@type"] === "FAQPage");
          const extra = !hasFaq && faq.length ? [faqPageJsonLd(faq)].filter((n): n is JsonLd => n !== null) : [];
          const file = prerenderFile(publicDir, route);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, composePage(shell, route, `${banner ? consentSlot(banner) : ""}${html}`, extra));
          result.written.push(route);
        } catch (err: any) {
          result.failed.push({ route, reason: String(err?.message ?? err).split("\n")[0] });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, routes.length)) }, worker));
  } finally {
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  result.apiCalls = [...apiCalls].sort();
  result.written.sort((a, b) => routes.indexOf(a) - routes.indexOf(b));
  log(`prerendered ${result.written.length} of ${routes.length} marketing pages into ${path.join(publicDir, PRERENDER_DIR)}`);
  return result;
}

// npx tsx script/prerender.ts [dist/public]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "prerender.ts")) {
  const publicDir = path.resolve(process.argv[2] ?? "dist/public");
  prerenderMarketingPages({ publicDir }).then((r) => {
    for (const f of r.failed) console.warn(`  not prerendered: ${f.route} — ${f.reason}`);
    if (r.apiCalls.length) console.log(`  API calls refused while prerendering: ${r.apiCalls.join(", ")}`);
    process.exit(r.failed.length ? 1 : 0);
  }).catch((err) => { console.error(err); process.exit(1); });
}
