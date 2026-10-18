/**
 * Settings → Review sites → "Find review sites" (owner, 2026-10-17: "it extracts the sites from the profile which is
 * added in the settings here as a link"). The owner enters a link — their website, or a page on a review site — and
 * this reads that one page and lists the links on it that point at a known review platform. The list is only a set of
 * suggestions: the owner ticks what to add, nothing is saved here, and no address is ever built or guessed — every
 * URL returned was written on the page (or is the page itself). CLAUDE.md: never fabricate.
 *
 * The fetch is the SSRF-safe one from sitescan/http.ts: http/https on 80/443 only, DNS resolved and every address
 * checked public on every hop (the socket is pinned to the checked address), at most 3 redirects each re-checked,
 * 2 MB / 10 s per hop and a 15 s overall cap. Tests inject the resolver and transport (makeSafeFetch).
 */
import { makeSafeFetch, type PageResponse } from "./sitescan/http";
import type { ReviewPlatformKey } from "@shared/review-links";

export const FINDER_MAX_REDIRECTS = 3;
export const FINDER_TIMEOUT_MS = 15_000;
export const FINDER_MAX_RESULTS = 30;

/** A found link: a known platform key ("google" for a Google review/Maps link), "other" with the site's name. */
export type FoundReviewSite = { platform: ReviewPlatformKey | "google"; label?: string; url: string };

type HostRule = { hosts: string[]; platform: FoundReviewSite["platform"]; label?: string; path?: RegExp };

/** Review platforms by host (the host or any subdomain of it). Porch and Trustpilot have no key of their own: "other". */
const HOST_RULES: HostRule[] = [
  { hosts: ["yelp.com"], platform: "yelp" },
  { hosts: ["facebook.com", "fb.com"], platform: "facebook" },
  { hosts: ["bbb.org"], platform: "bbb" },
  { hosts: ["angi.com", "angieslist.com"], platform: "angi" },
  { hosts: ["homeadvisor.com"], platform: "homeadvisor" },
  { hosts: ["houzz.com"], platform: "houzz" },
  { hosts: ["guildquality.com"], platform: "guildquality" },
  { hosts: ["nextdoor.com"], platform: "nextdoor" },
  { hosts: ["thumbtack.com"], platform: "thumbtack" },
  { hosts: ["porch.com"], platform: "other", label: "Porch" },
  { hosts: ["trustpilot.com"], platform: "other", label: "Trustpilot" },
  // Google: only review / Maps place links, never google.com in general (fonts, analytics, tag manager…).
  { hosts: ["g.page"], platform: "google" },
  { hosts: ["search.google.com"], platform: "google", path: /^\/local\/(writereview|reviews)/i },
  { hosts: ["maps.app.goo.gl"], platform: "google" },
  { hosts: ["goo.gl"], platform: "google", path: /^\/maps\//i },
  { hosts: ["google.com", "maps.google.com"], platform: "google", path: /^\/maps(\/|$)/i },
];

/** Share buttons, pixels, plugins and log-in pages: on the platform's host, but never the business's page. */
const NOT_A_PROFILE = /^\/(sharer|share|dialog|plugins|tr|intent|login|signup|privacy|policies|terms|legal|help|about|search|business|ads|advertise|developers)(\/|\.php|$)/i;

function hostRule(u: URL): HostRule | null {
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const rule of HOST_RULES) {
    if (!rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (rule.path && !rule.path.test(u.pathname)) continue;
    return rule;
  }
  return null;
}

/** The link as a review-site suggestion, or null when it is not one (wrong host, a share button, the bare home page). */
export function classifyReviewLink(raw: string, base?: string): FoundReviewSite | null {
  let u: URL;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const rule = hostRule(u);
  if (!rule) return null;
  const isShortLink = ["g.page", "maps.app.goo.gl", "goo.gl"].includes(u.hostname.toLowerCase());
  if (!isShortLink && rule.platform !== "google" && (u.pathname === "/" || u.pathname === "" || NOT_A_PROFILE.test(u.pathname))) return null;
  if (isShortLink && (u.pathname === "/" || u.pathname === "")) return null;
  u.hash = "";
  // Tracking parameters are the page's, not the platform's; the rest of the address is kept as written.
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
  const url = u.href;
  if (url.length > 2000) return null;
  return rule.label ? { platform: rule.platform, label: rule.label, url } : { platform: rule.platform, url };
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");

/**
 * Every review-site link written on the page: href/src attributes plus absolute URLs anywhere in the HTML (JSON-LD
 * "sameAs" lists, data attributes, scripts). Deduped, in page order, at most FINDER_MAX_RESULTS.
 */
export function extractReviewSiteLinks(html: string, pageUrl: string): FoundReviewSite[] {
  const candidates: string[] = [];
  const text = decodeEntities(html.slice(0, 2_000_000));
  for (const m of text.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) candidates.push(m[1] ?? m[2] ?? m[3] ?? "");
  // JSON escapes "\/" in sameAs lists; unescape before matching.
  for (const m of text.replace(/\\\//g, "/").matchAll(/https?:\/\/[^\s"'<>()\\]+/gi)) candidates.push(m[0]);
  const found: FoundReviewSite[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const link = classifyReviewLink(raw.trim(), pageUrl);
    if (!link) continue;
    const key = link.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(link);
    if (found.length >= FINDER_MAX_RESULTS) break;
  }
  return found;
}

export type SafePageFetch = (url: string) => Promise<PageResponse>;
const defaultFetch: SafePageFetch = makeSafeFetch(undefined, undefined, FINDER_MAX_REDIRECTS);

export class ReviewSiteFinderError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The owner's typed link as an absolute http(s) URL ("acme.com" → https://acme.com/). */
export function finderInputUrl(raw: unknown): string {
  let v = String(raw ?? "").trim();
  if (!v || v.length > 2000 || /\s/.test(v)) throw new ReviewSiteFinderError("Enter your website or a review page address.", 400);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  let u: URL;
  try { u = new URL(v); } catch { throw new ReviewSiteFinderError("That is not a web address.", 400); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ReviewSiteFinderError("Use an http or https address.", 400);
  if (!u.hostname.includes(".")) throw new ReviewSiteFinderError("That is not a public web address.", 400);
  return u.href;
}

/**
 * Reads the page at `raw` and returns the review-site links on it. The page itself counts when it is on a review
 * platform (the owner pasted their Yelp page). Throws ReviewSiteFinderError with an owner-facing message.
 */
export async function findReviewSites(raw: unknown, fetchPage: SafePageFetch = defaultFetch, timeoutMs = FINDER_TIMEOUT_MS) {
  const input = finderInputUrl(raw);
  let page: PageResponse;
  let timer: NodeJS.Timeout | undefined;
  try {
    page = await Promise.race([
      fetchPage(input),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs); timer.unref?.(); }),
    ]);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (/private|non-public|port 80 or 443|public HTTP/i.test(msg)) throw new ReviewSiteFinderError("That address is not a public website.", 400);
    if (/Redirect limit/i.test(msg)) throw new ReviewSiteFinderError("That page redirects too many times.", 422);
    throw new ReviewSiteFinderError("Couldn't open that page. Check the address, or paste a different page.", 422);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (page.status < 200 || page.status >= 300) throw new ReviewSiteFinderError(`That page answered with an error (HTTP ${page.status}).`, 422);
  const type = (page.headers["content-type"] || "").toLowerCase();
  const found: FoundReviewSite[] = [];
  const self = classifyReviewLink(page.url) ?? classifyReviewLink(input);
  if (self) found.push(self);
  if (!type || /html|xml|text\/plain/.test(type)) {
    for (const link of extractReviewSiteLinks(page.body, page.url)) {
      if (found.some((f) => f.url.replace(/\/+$/, "").toLowerCase() === link.url.replace(/\/+$/, "").toLowerCase())) continue;
      if (found.length >= FINDER_MAX_RESULTS) break;
      found.push(link);
    }
  }
  return { scannedUrl: input, finalUrl: page.url, found };
}
