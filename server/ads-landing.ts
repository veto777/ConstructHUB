/**
 * Google Ads landing doors — https://constructhub.us/googleads-features (= /features),
 * /googleads-crm (= /features/crm) and /googleads-pricing (= /pricing, the 2026-10-09 campaign). Owner order 2026-10-07: "the same system
 * we created for the Alpine Google ads" (alpine wa-main server/ads-landing.ts),
 * for a NATIONWIDE campaign.
 *
 * A door exists for paid clicks only. Rules, in the order they are applied:
 *   1. Google's own crawlers (AdsBot-Google, Googlebot …) get the page ONLY
 *      after a reverse-DNS + forward-DNS check proves the IP is Google's. Google
 *      Ads disapproves an ad whose landing page its checker cannot fetch, and
 *      showing it something different is cloaking, so this is the one verified
 *      exception to "no bots". A fake Google user agent is a bot.
 *   2. Bots (no or scripted user agent, headless browsers, SEO scrapers, a
 *      spoofed crawler) get 403 and their IP is added to Click Guard's blocked
 *      list for this site — the hourly Google Ads script (Google Ads → Click
 *      Guard) then excludes it from the campaigns.
 *   3. Everyone else needs the one way in: a Google click id (gclid / gbraid /
 *      wbraid) AND the door's campaign key (k=…, the campaign's final-URL
 *      suffix). Anything else is quietly sent to the public page.
 *   4. Non-US visitors and datacenter / hosting networks never see the door;
 *      hosting IPs are excluded from Ads as well.
 *   5. A real visitor is served the page. Unlike Alpine (a local market), the
 *      visitor's IP is NOT excluded afterwards: nationwide, several people at
 *      one contractor research from one office IP. ADS_LP_EXCLUDE_VISITORS=1
 *      turns that on.
 * The page served is the public page itself — same prerendered HTML, same
 * React page (client routes /googleads-features, /googleads-crm) — with its
 * canonical on the public URL and noindex, and robots.txt disallows the doors,
 * so a door never competes with its page. Every hit is recorded in ads_lp_hits.
 *
 * Configuration (live .env):
 *   ADS_LP_KEYS            "ch_feat_2026,ch_crm_2026" (any listed key opens either door;
 *                          default: those two)
 *   ADS_LP_DOMAIN          the Click Guard site that receives the blocked IPs
 *                          (default constructhub.us — add it in Google Ads → Click Guard)
 *   ADS_LP_ALLOW_IPS       owner / office IPs: always served, never blocked
 *   ADS_LP_ASN_HEADER      a header Cloudflare sets with the visitor's ASN
 *                          (default x-visitor-asn; optional)
 *   ADS_LP_EXCLUDE_VISITORS=1   exclude served visitors too (off by default)
 */
import type { Express, Request, Response } from "express";
import dns from "node:dns/promises";
import { pool } from "./db";
import { visitorIp, edgeGeo, normalizeBlockedIp, isPublicIpv4 } from "./route-guards";
import { isPortalHost, isClientHost, requestHost } from "./site-context";

/** door path → the public page it serves. */
export const ADS_LANDINGS: Readonly<Record<string, string>> = {
  "/googleads-features": "/features",
  "/googleads-crm": "/features/crm",
  "/googleads-pricing": "/pricing",
};
export const ADS_LANDING_PATHS: readonly string[] = Object.keys(ADS_LANDINGS);
export const DEFAULT_ADS_LP_KEYS: readonly string[] = ["ch_feat_2026", "ch_crm_2026", "ch_price_2026"];

const CLICK_ID_RE = /^[A-Za-z0-9_-]{16,}$/;
const GOOGLE_UA_RE = /(AdsBot-Google|Googlebot|Google-InspectionTool|Mediapartners-Google|Google-Site-Verification|GoogleOther|Storebot-Google|APIs-Google|Google-AdWords|Google-Ads)/i;
const GOOGLE_HOST_RE = /\.(googlebot\.com|google\.com|googleusercontent\.com)$/i;
const BAD_BOT_RE = /(python-requests|aiohttp|httpx|scrapy|go-http-client|libwww-perl|curl\/|wget\/|java\/|okhttp|node-fetch|axios\/|undici|phantomjs|headlesschrome|puppeteer|playwright|selenium|masscan|nmap|nikto|sqlmap|zgrab|semrushbot|ahrefsbot|mj12bot|dotbot|dataforseo|serpstatbot|blexbot|petalbot|bytespider|gptbot|claudebot|ccbot|facebookexternalhit|bingbot|yandex|baiduspider|duckduckbot|slurp)/i;
/** Hosting / cloud networks (ASN). A person does not click an ad from a server. */
const HOSTING_ASNS: ReadonlySet<number> = new Set([
  16509, 14618, 396982, 8075, 14061, 63949, 16276, 24940, 20473, 9009, 60068, 212238, 60781, 28753, 51167,
  31898, 45102, 132203, 12876, 62240, 136787, 398101, 40021, 53667, 36352, 46606, 55286, 29802, 54290, 46562,
]);

export type AdsVerdict =
  | { action: "serve"; reason: "google_verified" | "visitor" | "owner" }
  | { action: "block"; reason: "no_user_agent" | "bot_user_agent" | "fake_google" }
  | { action: "redirect"; reason: "no_click_id" | "bad_key" | "non_us" | "hosting_network"; exclude?: boolean };

export type AdsRequestFacts = {
  userAgent: string;
  ip: string;
  country: string | null;
  asn: number | null;
  clickId: string | null;
  key: string | null;
  googleVerified: boolean;
  allowedIp: boolean;
};

/** The door's decision — pure, so every rule above is unit-tested (server/ads-landing.test.ts). */
export function adsVerdict(f: AdsRequestFacts, keys: readonly string[] = DEFAULT_ADS_LP_KEYS): AdsVerdict {
  if (f.allowedIp) return { action: "serve", reason: "owner" };
  const ua = f.userAgent.trim();
  if (GOOGLE_UA_RE.test(ua)) return f.googleVerified ? { action: "serve", reason: "google_verified" } : { action: "block", reason: "fake_google" };
  if (!ua) return { action: "block", reason: "no_user_agent" };
  if (BAD_BOT_RE.test(ua) || !/Mozilla\//.test(ua)) return { action: "block", reason: "bot_user_agent" };
  if (!f.clickId || !CLICK_ID_RE.test(f.clickId)) return { action: "redirect", reason: "no_click_id" };
  if (!f.key || !keys.includes(f.key)) return { action: "redirect", reason: "bad_key" };
  if (f.asn !== null && HOSTING_ASNS.has(f.asn)) return { action: "redirect", reason: "hosting_network", exclude: true };
  if (f.country && f.country !== "US") return { action: "redirect", reason: "non_us" };
  return { action: "serve", reason: "visitor" };
}

/** Reverse DNS names a Google host, and that host resolves back to the IP. */
export async function isVerifiedGoogleIp(ip: string): Promise<boolean> {
  try {
    const hosts = await dns.reverse(ip);
    for (const host of hosts) {
      if (!GOOGLE_HOST_RE.test(host)) continue;
      const back = await dns.lookup(host, { all: true });
      if (back.some((a) => a.address === ip)) return true;
    }
  } catch { /* no PTR / lookup failed: not verified */ }
  return false;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS ads_lp_hits (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    at timestamp NOT NULL DEFAULT now(),
    door text NOT NULL,
    ip text,
    country text,
    asn integer,
    user_agent text,
    action text NOT NULL,
    reason text NOT NULL,
    campaign_key text,
    click_id_kind text,
    campaign_id text,
    adgroup_id text,
    keyword text,
    device text,
    network text
  );
  CREATE INDEX IF NOT EXISTS ads_lp_hits_at_idx ON ads_lp_hits (at DESC);
  CREATE INDEX IF NOT EXISTS ads_lp_hits_ip_idx ON ads_lp_hits (ip);`;
let ready: Promise<void> | null = null;
const schemaReady = () => (ready ??= pool.query(DDL).then(() => undefined).catch((e: any) => {
  console.error("[ads-lp] could not create ads_lp_hits:", e?.message || e); ready = null;
}));

const q = (req: Request, name: string): string | null => {
  const v = req.query?.[name];
  return typeof v === "string" && v ? v.slice(0, 200) : null;
};

async function recordHit(req: Request, door: string, f: AdsRequestFacts, v: AdsVerdict): Promise<void> {
  try {
    await schemaReady();
    await pool.query(
      `INSERT INTO ads_lp_hits (door, ip, country, asn, user_agent, action, reason, campaign_key, click_id_kind, campaign_id, adgroup_id, keyword, device, network)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [door, f.ip, f.country, f.asn, f.userAgent.slice(0, 400), v.action, v.reason, f.key,
        q(req, "gclid") ? "gclid" : q(req, "gbraid") ? "gbraid" : q(req, "wbraid") ? "wbraid" : null,
        q(req, "utm_campaign"), q(req, "utm_adgroup"), q(req, "utm_term"), q(req, "dev"), q(req, "net")],
    );
  } catch (e: any) {
    console.error("[ads-lp] hit not recorded:", e?.message || e);
  }
}

/** Add the IP to Click Guard's blocked list for the door's site, so the Ads script excludes it. Never throws. */
async function excludeFromAds(ip: string, reason: string): Promise<void> {
  try {
    const clean = normalizeBlockedIp(ip);
    // A private or reserved IPv4 (a proxy hop, a test) is never an exclusion; IPv6 is taken as given.
    if (!clean || (!clean.includes(":") && !isPublicIpv4(clean))) return;
    const domain = String(process.env.ADS_LP_DOMAIN || "constructhub.us").toLowerCase();
    const { rows: [site] } = await pool.query(
      `SELECT id FROM tracked_domains WHERE lower(domain) = $1 AND is_active ORDER BY id LIMIT 1`, [domain]);
    if (!site) return; // no Click Guard site for this domain yet: the hit is still in ads_lp_hits
    await pool.query(
      `INSERT INTO blocked_ips (domain_id, ip_address, reason, source)
       SELECT $1, $2, $3, 'ads_lp'
        WHERE NOT EXISTS (SELECT 1 FROM blocked_ips WHERE domain_id = $1 AND ip_address = $2 AND is_active)`,
      [site.id, clean, `Ad landing door: ${reason}`.slice(0, 200)]);
  } catch (e: any) {
    console.error("[ads-lp] exclusion not recorded:", e?.message || e);
  }
}

const allowIps = () => new Set(String(process.env.ADS_LP_ALLOW_IPS || "").split(",").map((s) => s.trim()).filter(Boolean));
const keys = () => {
  const set = String(process.env.ADS_LP_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return set.length ? set : DEFAULT_ADS_LP_KEYS;
};

/** The door's HTML: the public page, canonical on the public URL, never indexed. */
export function doorHtml(pageHtml: string): string {
  return pageHtml.includes('name="robots"')
    ? pageHtml
    : pageHtml.replace(/<\/title>/i, () => `</title>\n    <meta name="robots" content="noindex, nofollow" />`);
}

/**
 * Register the doors. `pageFor(publicPath)` returns the HTML the site serves a
 * signed-out visitor at that public path (the prerendered snapshot, or the app
 * shell with that page's SEO head). Call before the static catch-all.
 */
export function registerAdsLanding(app: Express, pageFor: (publicPath: string) => string): void {
  void schemaReady();
  for (const [door, target] of Object.entries(ADS_LANDINGS)) {
    app.get(door, async (req: Request, res: Response, next) => {
      try {
        const host = requestHost(req);
        if (isPortalHost(host) || isClientHost(host)) return next();
        const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
        const ip = visitorIp(req);
        const ua = String(req.headers["user-agent"] || "");
        const asnRaw = req.headers[String(process.env.ADS_LP_ASN_HEADER || "x-visitor-asn").toLowerCase()];
        const asn = typeof asnRaw === "string" && /^\d{1,10}$/.test(asnRaw.trim()) ? Number(asnRaw.trim()) : null;
        const facts: AdsRequestFacts = {
          userAgent: ua, ip, country: edgeGeo(req).country, asn,
          clickId: q(req, "gclid") ?? q(req, "gbraid") ?? q(req, "wbraid"),
          key: q(req, "k"),
          googleVerified: GOOGLE_UA_RE.test(ua) ? await isVerifiedGoogleIp(ip) : false,
          allowedIp: allowIps().has(ip),
        };
        const verdict = adsVerdict(facts, keys());
        void recordHit(req, door, facts, verdict);
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, no-store");

        if (verdict.action === "block") {
          void excludeFromAds(ip, verdict.reason);
          return res.status(403).type("text/plain").send("Forbidden");
        }
        if (verdict.action === "redirect") {
          if (verdict.exclude) void excludeFromAds(ip, verdict.reason);
          return res.redirect(302, `${target}${query}`);
        }
        if (verdict.reason === "visitor" && process.env.ADS_LP_EXCLUDE_VISITORS === "1") void excludeFromAds(ip, "served visitor");
        return res.type("html").send(doorHtml(pageFor(target)));
      } catch (e: any) {
        console.error("[ads-lp] door failed:", e?.message || e);
        return res.redirect(302, target);
      }
    });
  }
}
