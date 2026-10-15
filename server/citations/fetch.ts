/**
 * Loading directory pages for the citation audit: plain HTTP first (cheap, SSRF-safe through sitescan/http.ts), a
 * headless browser when the site answers bots with 403 or renders only with JavaScript. Polite: one browser page at
 * a time, 1.5 s between requests to the same host, hard time caps. Nothing here interprets the page.
 */
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { makeSafeFetch, publicIP, siteUrl, type Transport } from "../sitescan/http";

export type Loaded = { url: string; status: number; body: string; mode: "http" | "browser"; blocked: boolean };
export type Loader = (url: string, mode: "http" | "browser") => Promise<Loaded>;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const HOST_GAP_MS = 1500;
const HTTP_TIMEOUT_MS = 12_000;
const BROWSER_NAV_MS = 25_000;
const BROWSER_SETTLE_MS = 8_000;

export const BLOCK_RE = /captcha|verify (?:that )?you are human|access denied|just a moment|checking your browser|unusual traffic|request blocked|are you a robot|pardon our interruption|attention required|enable javascript and cookies/i;

/** A refusal or a bot wall, judged from the status and the first part of the page. */
export function looksBlocked(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503 || status === 401) return true;
  const head = body.slice(0, 60_000).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return body.length < 30_000 && BLOCK_RE.test(head);
}

// ── politeness ────────────────────────────────────────────────────────────────────────────────────────────────────
const lastHit = new Map<string, number>();
async function polite(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const wait = (lastHit.get(host) ?? 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

/** A one-at-a-time lock (the shared browser). */
function makeLock() {
  let tail: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
const browserLock = makeLock();

// ── HTTP, with a browser's headers (the safe fetch's own transport announces the scanner) ─────────────────────────
const browserishTransport: Transport = (url, address) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      agent: false,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "identity" },
      lookup: ((_host: any, options: any, cb: any) => (options?.all ? cb(null, [address]) : cb(null, address.address, address.family))) as any,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk) => { bytes += chunk.length; if (bytes > 4_000_000) request.destroy(new Error("Response exceeded 4 MB limit")); else chunks.push(chunk); });
      response.on("end", () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString("utf8"), bytes, headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, String(v || "")])) }));
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error("Request timed out")), HTTP_TIMEOUT_MS);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
const httpFetch = makeSafeFetch(undefined, browserishTransport);

export async function loadHttp(url: string): Promise<Loaded> {
  await polite(url);
  try {
    const r = await httpFetch(url);
    return { url: r.url, status: r.status, body: r.body, mode: "http", blocked: looksBlocked(r.status, r.body) };
  } catch (e: any) {
    return { url, status: 0, body: "", mode: "http", blocked: true };
  }
}

// ── headless browser (server/scraper.ts's shared Chromium) ───────────────────────────────────────────────────────
async function publicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return publicIP(host);
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => publicIP(a.address));
  } catch { return false; }
}

export async function loadBrowser(url: string): Promise<Loaded> {
  const start = siteUrl(url);
  if (!(await publicHost(new URL(start).hostname))) return { url, status: 0, body: "", mode: "browser", blocked: true };
  await polite(start);
  return browserLock(async () => {
    const { newBrowserContext } = await import("../scraper");
    const context = await newBrowserContext();
    try {
      // Sub-requests may go anywhere public; anything aimed at a private address or a non-web scheme is dropped.
      await context.route("**/*", async (route) => {
        const u = route.request().url();
        try {
          const h = new URL(u).hostname;
          if (!/^https?:$/.test(new URL(u).protocol) || h === "localhost" || (isIP(h) && !publicIP(h))) return route.abort();
        } catch { return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      let status = 0;
      try {
        const resp = await page.goto(start, { waitUntil: "domcontentloaded", timeout: BROWSER_NAV_MS });
        status = resp?.status() ?? 0;
      } catch {
        return { url: start, status: 0, body: "", mode: "browser", blocked: true };
      }
      await page.waitForLoadState("networkidle", { timeout: BROWSER_SETTLE_MS }).catch(() => undefined);
      const body = await page.content().catch(() => "");
      const finalUrl = page.url();
      if (!(await publicHost(new URL(finalUrl).hostname))) return { url: finalUrl, status: 0, body: "", mode: "browser", blocked: true };
      return { url: finalUrl, status, body, mode: "browser", blocked: looksBlocked(status, body) };
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}

/** HTTP, then the browser when the site refused and the directory is known to need one. */
export const loadPage: Loader = async (url, mode) => {
  const first = await loadHttp(url);
  if (!first.blocked && first.status >= 200 && first.status < 400 && first.body.length > 2_000) return first;
  if (mode !== "browser") return first;
  const second = await loadBrowser(url);
  return second.blocked && !first.blocked ? first : second;
};
