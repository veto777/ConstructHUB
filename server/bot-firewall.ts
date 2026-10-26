/**
 * The crawler firewall (owner, 2026-10-16: "create all the firewalls in place that will not allow crawling other
 * than google crawl"; "make sure we dont allow anyone to scrape our site").
 *
 * Every request that came in through Cloudflare (it carries CF-Connecting-IP) passes three checks, in order:
 *   1. A request claiming to be a Google crawler is let in only when its IP reverse-resolves to a Google host
 *      that resolves back to the same IP (Google's documented check). A fake Googlebot gets 403.
 *   2. Any other crawler, scraper, HTTP library or headless browser is refused (403) by its user agent.
 *      Meta's ad crawler is the one exception, and only on pages (never /api): Meta reviews every ad's landing
 *      page and would reject the running ads without it. ALLOW_META_AD_CRAWLER=0 turns that off.
 *   3. Everyone else is rate limited per IP, so a scraper posing as a browser can't pull pages or data in bulk.
 *
 * Not checked: requests that never went through Cloudflare (the deploy's local checks, the tower), webhooks and
 * the machine-to-machine paths other services call (Stripe, SignalWire, inbound mail, Telegram, the Click Guard /
 * VPN Shield scripts on customers' sites and the Google Ads script, /.well-known, robots.txt), the public tutorial
 * media and the customers' post media the social networks' fetchers download (/api/tutorials/media,
 * /api/files/social), and the paid
 * Public/Code API when it carries its key (it has its own keys and limits).
 */
import type { NextFunction, Request, Response } from "express";
import { promises as dns } from "dns";

/** Paths other services call server-to-server; a browser user agent can't be expected there. */
const MACHINE_PATHS: readonly RegExp[] = [
  // Public tutorial media (walkthrough cuts, Instagram Stories): Instagram, TikTok, LinkedIn and Blotato fetch these
  // with their own fetchers, never a browser. Blocking them (2026-10-17..19) silently failed every scheduled post.
  /^\/api\/tutorials\/media\//,
  // A customer's post media (/api/files/social/<random token>/…): Facebook and Instagram download each photo or video
  // from here when it is published. Blocking them (2026-10-16..26) failed every Facebook/Instagram media post.
  /^\/api\/files\/social\//,
  /^\/voice\//,
  /webhook/i,
  /^\/api\/inbound-mail/,
  /^\/api\/click-guard\/(track|script|exclusion-list)\b/,
  /^\/api\/vpn-shield\/(track|script)\b/,
  /^\/\.well-known\//,
  /^\/robots\.txt$/,
];

/** The paid API with its own key: refused elsewhere by public-api/guard.ts and dev-api/guard.ts. */
const KEYED_API = /^\/api\/(v1|dev\/v1)\//;

/** Google's crawlers and fetchers (developers.google.com/search/docs/crawling-indexing/google-common-crawlers). */
const GOOGLE_UA = /Googlebot|Google-InspectionTool|GoogleOther|Google-Extended|AdsBot-Google|Mediapartners-Google|Storebot-Google|Google-Site-Verification|FeedFetcher-Google|APIs-Google|Google-Read-Aloud|Google-Safety|GoogleProducer|Google-Apps-Script/i;
/** Hosts a genuine Google crawler's IP reverse-resolves to. */
const GOOGLE_HOST = /\.(googlebot\.com|google\.com|googleusercontent\.com)$/i;

const META_AD_UA = /facebookexternalhit|meta-externalads|facebookcatalog/i;

/** Crawlers, scrapers, AI bots, HTTP libraries and automation. Anything not a browser that says what it is. */
const BOT_UA = /(?<!cu)bot\b|bot\/|crawl|spider|slurp|scrap|fetch|archiver|curl|wget|httpie|python|aiohttp|httpx|go-http-client|java\/|okhttp|node-fetch|axios|undici|got\s*\(|libwww|lwp::|perl|ruby|php\/|guzzle|postman|insomnia|headless|phantomjs|puppeteer|playwright|selenium|webdriver|chrome-lighthouse|gptbot|chatgpt|oai-searchbot|claudebot|claude-web|anthropic|ccbot|bytespider|perplexity|cohere-ai|diffbot|ahrefs|semrush|mj12|dotbot|petalbot|bingbot|bingpreview|yandexbot|yandex\.com\/bots|baiduspider|duckduckbot|duckassistbot|applebot|sogou web spider|exabot|seznambot|facebookexternalhit|meta-external|twitterbot|linkedinbot|slackbot|discordbot|whatsapp\/|telegrambot|skypeuripreview|embedly|quora link preview|pinterestbot|redditbot|ia_archiver|screaming frog|sitebulb|netcraft|zgrab|masscan|nmap|nikto|sqlmap|nuclei|httrack|wpscan/i;

export type FirewallVerdict = "machine" | "google" | "fake-google" | "meta-ad" | "bot" | "human";

/** The user-agent half of the decision (pure; the Google IP check is separate). */
export function classifyRequest(path: string, userAgent: string | undefined, opts: { hasApiKey?: boolean; allowMetaAds?: boolean } = {}): FirewallVerdict {
  if (MACHINE_PATHS.some((re) => re.test(path))) return "machine";
  if (KEYED_API.test(path) && opts.hasApiKey) return "machine";
  const ua = (userAgent ?? "").trim();
  if (!ua) return "bot";
  if (GOOGLE_UA.test(ua)) return "google";
  if (META_AD_UA.test(ua) && opts.allowMetaAds !== false && !path.startsWith("/api/")) return "meta-ad";
  if (BOT_UA.test(ua)) return "bot";
  // Real browsers all say Mozilla/5.0; a bare "Something/1.0" is a program.
  if (!/^Mozilla\/5\.0 /.test(ua)) return "bot";
  return "human";
}

// ── Google's documented reverse-then-forward DNS check, cached per IP ────────
const googleIpCache = new Map<string, { ok: boolean; until: number }>();
export async function isGoogleIp(ip: string, resolver: { reverse: (ip: string) => Promise<string[]>; lookup: (host: string) => Promise<{ address: string }[]> } = {
  reverse: (a) => dns.reverse(a),
  lookup: (h) => dns.lookup(h, { all: true }),
}): Promise<boolean> {
  const now = Date.now();
  const hit = googleIpCache.get(ip);
  if (hit && hit.until > now) return hit.ok;
  let ok = false;
  try {
    const hosts = await resolver.reverse(ip);
    for (const host of hosts) {
      if (!GOOGLE_HOST.test(host)) continue;
      const addrs = await resolver.lookup(host);
      if (addrs.some((a) => a.address === ip)) { ok = true; break; }
    }
  } catch { ok = false; }
  if (googleIpCache.size > 50_000) googleIpCache.clear();
  googleIpCache.set(ip, { ok, until: now + (ok ? 24 : 1) * 3600_000 });
  return ok;
}

// ── Per-IP rate limit for browsers ───────────────────────────────────────────
/** A minute's allowance per IP: page loads and API calls. A person clicking around never gets near these. */
export const RATE = { pagesPerMinute: 90, apiPerMinute: 600, blockMinutes: 10 } as const;
const STATIC = /^\/(assets|mascot|fonts|images|icons|favicon|apple-touch-icon|manifest|sw\.js)|\.(js|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|map|txt|xml|json)$/i;
type Bucket = { minute: number; pages: number; api: number; blockedUntil: number };
const buckets = new Map<string, Bucket>();

/** Over the limit? Counts this request. Exported for the tests. */
export function overRate(ip: string, path: string, now = Date.now()): boolean {
  if (STATIC.test(path)) return false;
  const minute = Math.floor(now / 60_000);
  let b = buckets.get(ip);
  if (!b || b.minute !== minute) {
    b = { minute, pages: 0, api: 0, blockedUntil: b?.blockedUntil ?? 0 };
    buckets.set(ip, b);
  }
  if (b.blockedUntil > now) return true;
  if (path.startsWith("/api/")) b.api++; else b.pages++;
  if (b.pages > RATE.pagesPerMinute || b.api > RATE.apiPerMinute) {
    b.blockedUntil = now + RATE.blockMinutes * 60_000;
    return true;
  }
  return false;
}
setInterval(() => {
  const minute = Math.floor(Date.now() / 60_000);
  for (const [ip, b] of buckets) if (b.minute < minute - 1 && b.blockedUntil < Date.now()) buckets.delete(ip);
}, 5 * 60_000).unref();

// ── The middleware ───────────────────────────────────────────────────────────
const blockedCounts = new Map<string, number>();
function noteBlock(kind: string, ip: string, ua: string, path: string) {
  const n = (blockedCounts.get(kind) ?? 0) + 1;
  blockedCounts.set(kind, n);
  // The first few of each kind, then every 500th: enough to see what is knocking without flooding the journal.
  if (n <= 20 || n % 500 === 0) console.warn(`[bot-firewall] ${kind} #${n} ${ip} ${path} ua="${ua.slice(0, 120)}"`);
}

export function botFirewall(req: Request, res: Response, next: NextFunction) {
  const ip = String(req.headers["cf-connecting-ip"] ?? "");
  // Not through Cloudflare: the server's own checks and the tower. The origin is not reachable from the internet.
  if (!ip) return next();
  const ua = String(req.headers["user-agent"] ?? "");
  const auth = String(req.headers.authorization ?? "");
  const verdict = classifyRequest(req.path, ua, {
    hasApiKey: /^Bearer (chub_|chdev_)/.test(auth) || typeof req.headers["x-api-key"] === "string",
    allowMetaAds: process.env.ALLOW_META_AD_CRAWLER !== "0",
  });
  if (verdict === "machine" || verdict === "meta-ad") return next();
  if (verdict === "bot") {
    noteBlock("bot", ip, ua, req.path);
    return res.status(403).set("Cache-Control", "no-store").type("text/plain").send("Automated access is not allowed.");
  }
  if (verdict === "google") {
    isGoogleIp(ip).then((ok) => {
      if (ok) return next();
      noteBlock("fake-google", ip, ua, req.path);
      res.status(403).set("Cache-Control", "no-store").type("text/plain").send("Automated access is not allowed.");
    }, () => res.status(403).set("Cache-Control", "no-store").type("text/plain").send("Automated access is not allowed."));
    return;
  }
  if (overRate(ip, req.path)) {
    noteBlock("rate", ip, ua, req.path);
    res.setHeader("Retry-After", String(RATE.blockMinutes * 60));
    return res.status(429).set("Cache-Control", "no-store").type("text/plain").send("Too many requests. Try again in a few minutes.");
  }
  next();
}
