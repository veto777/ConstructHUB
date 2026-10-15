/**
 * Discovery: the search bank and what a search result turns into. Every source starts from a REAL search
 * result (DataForSEO Google organic, the same account the SEO toolset uses) or an admin's import — never from
 * a guessed domain. One query = one live organic request of DISCOVERY_DEPTH results, about $0.02 at the
 * vendor's live price (server/seo/pricing.ts); no search operators, which the vendor bills 5x.
 */
import type { BacklinkKind } from "@shared/backlinks";
import { request, assertOk, taskItems } from "../seo/dataforseo";
import { SERP_PAGE_USD } from "../seo/pricing";

/** Trades and adjacent topics a contractor's link can sit on. */
export const NICHES = [
  "roofing", "plumbing", "HVAC", "electrician", "home remodeling", "home improvement", "construction", "landscaping",
  "painting contractor", "flooring", "windows and doors", "solar installation", "siding", "gutters", "concrete contractor",
  "pest control", "pool builder", "kitchen remodeling", "bathroom remodeling", "real estate", "interior design", "home maintenance",
] as const;

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii",
  "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

/** Footprints per kind: `{n}` is a niche, `{s}` a state. Plain words and quotes only (no operators). */
export const QUERY_TEMPLATES: Record<Exclude<BacklinkKind, "pbn">, { per: "niche" | "state" | "once"; t: string }[]> = {
  guest_post: [
    { per: "niche", t: `{n} "write for us"` },
    { per: "niche", t: `{n} "submit a guest post"` },
    { per: "niche", t: `{n} "guest post guidelines"` },
    { per: "niche", t: `{n} "become a contributor"` },
    { per: "niche", t: `{n} blog "accepting guest posts"` },
    { per: "niche", t: `{n} blog "guest author"` },
    { per: "niche", t: `{n} "contribute an article"` },
  ],
  press_release: [
    { per: "once", t: `"submit press release" free` },
    { per: "once", t: `"submit your press release" small business` },
    { per: "once", t: `"press release distribution" construction industry` },
    { per: "niche", t: `{n} industry news "submit press release"` },
  ],
  directory: [
    { per: "niche", t: `{n} contractors directory "add your business"` },
    { per: "niche", t: `{n} "list your business" directory` },
    { per: "niche", t: `{n} association "member directory"` },
    { per: "niche", t: `find a {n} contractor "get listed"` },
  ],
  citation: [
    { per: "state", t: `{s} business directory "add your business"` },
    { per: "state", t: `{s} contractors association members` },
    { per: "state", t: `{s} chamber of commerce "member directory" contractors` },
    { per: "state", t: `{s} home builders association "member directory"` },
    { per: "state", t: `{s} remodelers association members` },
  ],
  resource_page: [
    { per: "niche", t: `{n} "helpful resources" homeowners` },
    { per: "niche", t: `{n} "useful links" homeowners` },
  ],
  editorial: [
    { per: "niche", t: `{n} magazine "submit a story"` },
    { per: "niche", t: `{n} news "contributors"` },
    { per: "state", t: `{s} local news "submit a news tip"` },
    { per: "once", t: `"journalist requests" home improvement experts` },
  ],
};

export type BankQuery = { kind: BacklinkKind; niche: string; query: string };

/** The whole bank (deterministic): every template × its niches or states. */
export function buildQueryBank(): BankQuery[] {
  const out: BankQuery[] = [];
  for (const [kind, templates] of Object.entries(QUERY_TEMPLATES) as [BacklinkKind, (typeof QUERY_TEMPLATES)["guest_post"]][]) {
    for (const { per, t } of templates) {
      if (per === "once") out.push({ kind, niche: "general", query: t });
      else if (per === "niche") for (const n of NICHES) out.push({ kind, niche: n, query: t.replace("{n}", n) });
      else for (const s of US_STATES) out.push({ kind, niche: s, query: t.replace("{s}", s) });
    }
  }
  const seen = new Set<string>();
  return out.filter((q) => (seen.has(q.query) ? false : (seen.add(q.query), true)));
}

/**
 * Sites a link-building database has no use for: social networks, marketplaces, search engines, Q&A and wikis
 * (no pitch reaches them and their links are nofollow) — matched on the host or any parent domain.
 */
export const EXCLUDED_DOMAINS = [
  "google.com", "youtube.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "pinterest.com", "tiktok.com",
  "reddit.com", "quora.com", "wikipedia.org", "amazon.com", "ebay.com", "etsy.com", "apple.com", "microsoft.com", "bing.com",
  "yahoo.com", "medium.com", "github.com", "fiverr.com", "upwork.com", "craigslist.org", "indeed.com", "glassdoor.com",
  // Platforms where anyone can post a profile/page (2026-10-13: a spammer's zillow.com profile was graded A).
  "zillow.com", "realtor.com", "trulia.com", "redfin.com", "freelancer.com", "peopleperhour.com", "guru.com", "issuu.com",
  "scribd.com", "slideshare.net", "tumblr.com", "flickr.com", "vimeo.com", "soundcloud.com", "behance.net", "dribbble.com",
  "about.me", "linktr.ee", "substack.com", "patreon.com", "gumroad.com", "producthunt.com", "trustpilot.com", "yelp.com",
  "homeadvisor.com", "angi.com", "thumbtack.com", "beacons.ai", "bbb.org", "nextdoor.com",
] as const;

/** A host as the database keys it: lower-case, no "www.", no trailing dot. null for anything that is not a public web host. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let host: string;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname;
  } catch { return null; }
  host = host.replace(/\.$/, "").replace(/^www\d?\./, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}

export function isExcluded(domain: string): boolean {
  return EXCLUDED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) || /\.(gov|mil)$/.test(domain);
}

/** One import line → a candidate (an admin pasting a vendor list or their own finds). Accepts a bare domain or a URL. */
export function parseImportLine(line: string): { domain: string; url: string } | null {
  const raw = line.trim().split(/[\s,;]+/)[0] ?? "";
  if (!raw || raw.startsWith("#")) return null;
  const domain = normalizeDomain(raw);
  if (!domain || isExcluded(domain)) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${domain}/`;
  return { domain, url };
}

export const DISCOVERY_DEPTH = 100;
/** Upper bound for one discovery query: every page of 10 at the live price. */
export const discoveryEstimateUsd = () => Math.ceil(DISCOVERY_DEPTH / 10) * SERP_PAGE_USD.live;

export type SerpHit = { domain: string; url: string; title: string | null; position: number };

/** Organic results → candidates: one per domain (its best-placed page), exclusions dropped. */
export function hitsFromItems(items: any[]): SerpHit[] {
  const out = new Map<string, SerpHit>();
  for (const it of items) {
    if (it?.type !== "organic" || typeof it.url !== "string") continue;
    const domain = normalizeDomain(it.url);
    if (!domain || isExcluded(domain) || out.has(domain)) continue;
    out.set(domain, { domain, url: it.url, title: typeof it.title === "string" ? it.title : null, position: Number(it.rank_absolute) || out.size + 1 });
  }
  return [...out.values()];
}

export const discoverDeps = { request };

/** One live Google organic search (United States, English). */
export async function searchOnce(query: string): Promise<{ hits: SerpHit[]; costUsd: number }> {
  const res = await discoverDeps.request("POST", "/serp/google/organic/live/regular", [
    { keyword: query, location_code: 2840, language_code: "en", depth: DISCOVERY_DEPTH },
  ]);
  const task = assertOk(res, { treatNoResultsAsEmpty: true });
  const costUsd = typeof task.cost === "number" ? task.cost : discoveryEstimateUsd();
  const items = (taskItems(task) as any[]) ?? [];
  return { hits: hitsFromItems(items), costUsd };
}
