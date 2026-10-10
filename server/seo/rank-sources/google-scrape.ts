/**
 * Our own headless browser on the real Google results page, searched from the place (`uule`): the organic results,
 * the site's position, whether a map pack showed. Google has required JavaScript for search since early 2025, so a
 * plain fetch gets nothing; a browser does, until Google decides the address is a bot and serves a CAPTCHA (the office
 * address already gets one). A proxy is where the browser's traffic leaves from:
 *
 *   SEO_SCRAPE_PROXY   e.g. socks5://127.0.0.1:1081 (a local relay in front of a proxy that needs a password —
 *                      Chromium cannot send one itself) or http://user:pass@host:port
 *   SEO_SCRAPE_CHROME  the browser executable when playwright-core's own lookup fails
 *
 * Against Google's terms of service for automated access; kept for the owner's accuracy comparison.
 */
import { hostOf, ownIn, uuleFor, type RankObservation, type RankQuery, type RankSource, type SerpResult } from "./types";

/** What the page script hands back, before it is judged here. */
export type ScrapeRaw = {
  finalUrl: string; title: string; text: string;
  links: { title: string; href: string }[];
  mapPack: boolean;
};

/** The organic results and the page's state from the raw page. Pure. */
export function fromScrape(raw: ScrapeRaw, target: string): Pick<RankObservation, "top" | "position" | "url" | "mapPack" | "features" | "error"> {
  const captcha = /\/sorry\//.test(raw.finalUrl) || /unusual traffic|not a robot|recaptcha/i.test(raw.text);
  if (captcha) return { top: [], position: null, url: null, mapPack: null, features: [], error: "captcha" };
  if (/before you continue/i.test(raw.text) && raw.links.length === 0) return { top: [], position: null, url: null, mapPack: null, features: [], error: "consent wall" };
  const top: SerpResult[] = [];
  const seen = new Set<string>();
  for (const l of raw.links) {
    const domain = hostOf(l.href);
    if (!domain || /(^|\.)google\.[a-z.]+$/.test(domain) || seen.has(l.href)) continue;
    seen.add(l.href);
    top.push({ position: top.length + 1, domain, url: l.href, title: l.title || null });
    if (top.length >= 10) break;
  }
  const features: string[] = ["organic"];
  if (raw.mapPack) features.push("local_pack");
  if (/People also ask/i.test(raw.text)) features.push("people_also_ask");
  if (/AI Overview/i.test(raw.text)) features.push("ai_overview");
  if (/Sponsored/i.test(raw.text)) features.push("paid");
  if (!top.length) return { top, position: null, url: null, mapPack: raw.mapPack, features, error: "no results parsed" };
  return { top, ...ownIn(top, target), mapPack: raw.mapPack, features };
}

export const scrapeDeps = { env: () => process.env };

const UA = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  mobile: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

async function browser() {
  const { chromium } = await import("playwright-core");
  const env = scrapeDeps.env();
  const proxy = env.SEO_SCRAPE_PROXY?.trim();
  return chromium.launch({ headless: true, executablePath: env.SEO_SCRAPE_CHROME?.trim() || undefined, ...(proxy ? { proxy: { server: proxy } } : {}) });
}

export const scrapeSource: RankSource = {
  name: "scrape",
  label: "Own browser on the Google results page",
  async available() {
    try { const b = await browser(); await b.close(); return { ok: true }; }
    catch (e: any) { return { ok: false, why: `no headless browser: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)}` }; }
  },
  async check(q) {
    const t0 = Date.now();
    const base: RankObservation = { source: "scrape", keyword: q.keyword, device: q.device, place: q.place ? { code: q.place.code, label: q.place.label } : null, position: null, url: null, top: [], mapPack: null, localPosition: null, features: [], costUsd: 0, ms: 0 };
    let b: Awaited<ReturnType<typeof browser>> | null = null;
    try {
      b = await browser();
      const ctx = await b.newContext({
        locale: "en-US", timezoneId: "America/New_York", userAgent: UA[q.device],
        viewport: q.device === "mobile" ? { width: 412, height: 915 } : { width: 1366, height: 900 }, isMobile: q.device === "mobile", hasTouch: q.device === "mobile",
      });
      const page = await ctx.newPage();
      const params = new URLSearchParams({ q: q.keyword, hl: q.languageCode, gl: "us", num: "10", pws: "0" });
      if (q.place) params.set("uule", uuleFor(q.place.canonical));
      await page.goto(`https://www.google.com/search?${params}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2000);
      const raw: ScrapeRaw = await page.evaluate(() => {
        const links: { title: string; href: string }[] = [];
        for (const h3 of Array.from(document.querySelectorAll("#search h3, #rso h3, div[data-snc] h3, a h3"))) {
          const a = (h3.closest("a") || h3.querySelector("a")) as HTMLAnchorElement | null;
          const href = a?.getAttribute("href") || "";
          if (/^https?:\/\//.test(href)) links.push({ title: (h3.textContent || "").trim().slice(0, 120), href });
        }
        const mapPack = !!document.querySelector('div.rllt__details, [data-attrid*="kc:/local"], a[href*="/maps/place"], [aria-label*="Local Results"], div[data-local-attribute]');
        return { finalUrl: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 20000), links, mapPack };
      });
      return { ...base, ms: Date.now() - t0, ...fromScrape(raw, q.domain) };
    } catch (e: any) {
      return { ...base, ms: Date.now() - t0, error: String(e?.message ?? e).split("\n")[0].slice(0, 160) };
    } finally {
      await b?.close().catch(() => {});
    }
  },
};
