/**
 * Unlinked mentions: pages on other websites that use the business's exact name, and whether those websites link to
 * the business's site. A site that writes about the business without linking to it is the easiest link to ask for.
 *
 * Two lookups: the web pages that contain the exact name (one per website, the business's own site left out), then
 * the business's linking sites narrowed to those websites. Bought through server/seo/budget.ts.
 *
 * What it rests on, and what it does not claim:
 *  - A NAME IS NOT A BUSINESS. Other businesses share names ("Alpine Exteriors" is a company in Tampa, Dallas and
 *    Calgary as well as Bellingham). Each mention is read for the places the customer gives (their towns): "names
 *    one of your places" when the excerpt does, otherwise "same name — check it is you". Only the title and the excerpt
 *    the source returns are read, never the whole page, so a page about the business that does not name a town in its
 *    excerpt lands in the second group.
 *  - "Links to you" means the link database has a link from that website to the site — from any page of it, not
 *    necessarily the page that mentions the business. "No link found" can also be a link it has not crawled.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, safeDomain, normalizeDomain, type DfsTask } from "./dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD } from "./pricing";

/** Websites listed in one lookup (one page per website). */
export const MENTIONS_ROWS = 50;
export const MENTIONS_SEARCH_USD = 0.03, MENTIONS_LINKS_USD = BACKLINKS_REQUEST_USD + MENTIONS_ROWS * BACKLINKS_ROW_USD * 1.2;
/** What is set aside for one check — also the most it can cost. The second try buys only the link check. */
export const MENTIONS_ESTIMATE_USD = Math.round((MENTIONS_SEARCH_USD + MENTIONS_LINKS_USD) * 1e6) / 1e6;
export const MENTIONS_RETRY_USD = Math.round(MENTIONS_LINKS_USD * 1e6) / 1e6;
/** A saved check is shown for a week; "Check again" buys a new one. */
export const MENTIONS_CACHE_HOURS = 24 * 7;
export const MAX_PLACES = 8;
export const mentionsDeps = { request };

/** The name as searched: letters, digits, spaces and the punctuation names use — never a quote or a search operator. */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} &'’.,-]*$/u;
export const mentionsInput = z.object({
  name: z.string().trim().min(3, "Enter the business name as people write it.").max(80).transform((s) => s.replace(/\s+/g, " ")).refine((s) => NAME_RE.test(s), "Use the business name only — letters, numbers, spaces and & ' . , -"),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
  /** Ask again only for the link check when it did not load; the mentions already bought are kept and not bought again. */
  retryMissing: z.boolean().default(false),
}).strict();
/** The places a mention is read for (towns, a county, a street): words that show it is this business. Free to change. */
export const placesInput = z.array(z.string().trim().min(2).max(40)).max(MAX_PLACES);

export type MentionRow = {
  url: string; domain: string; title: string; snippet: string | null; published: string | null; authority: number | null;
  /** true = the link database has a link from this website to the site; false = none found; null = the link check did not load. */
  linksToYou: boolean | null;
};
export type MentionsPage = {
  name: string; domain: string; rows: MentionRow[];
  /** Pages the source has with the name (not websites; it counts every page). */ total: number | null;
  /** false = the link check did not load: "links to you" is unknown for every row. */ linksChecked: boolean;
  /** The link check had more rows than one lookup returns: a website not among them is unknown, not "no link". */ linksPartial?: boolean;
  fetchedAt: string;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** The search request. Pure. The name is searched as an exact phrase. */
export function mentionsRequest(name: string, domain: string): Record<string, unknown> {
  return {
    keyword: `"${name}"`, search_mode: "one_per_domain", limit: MENTIONS_ROWS,
    filters: [["main_domain", "<>", domain]],
    order_by: ["domain_rank,desc"],
  };
}
/** The link check: the site's linking websites narrowed to the ones that mention it. Pure. */
export function mentionLinksRequest(domain: string, websites: string[]): Record<string, unknown> {
  return { target: domain, include_subdomains: true, backlinks_status_type: "live", limit: MENTIONS_ROWS, filters: ["domain", "in", websites] };
}

/** One result as a row; null without a usable address, or when it is the site itself (any sub-domain of it). */
export function parseMention(item: any, domain: string): Omit<MentionRow, "linksToYou"> | null {
  const url = safeHttpUrl(item?.url), site = safeDomain(item?.main_domain) ?? safeDomain(item?.domain);
  if (!url || !site || site === domain || site.endsWith(`.${domain}`)) return null;
  const c = item?.content_info ?? {};
  const rank = num(item?.domain_rank), published = typeof c.date_published === "string" ? c.date_published.slice(0, 10) : null;
  return {
    url, domain: site, title: text(c.main_title, 200) ?? text(c.title, 200) ?? site, snippet: text(c.snippet, 400),
    published: published && /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : null,
    authority: rank === null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))),
  };
}

/** Pure: which websites the link check found linking (root domains; a sub-domain row counts for its website). */
export function linkingWebsites(items: any[], websites: string[]): Set<string> {
  const out = new Set<string>();
  for (const i of items) {
    const d = safeDomain(i?.domain);
    if (!d || (num(i?.backlinks) ?? 1) <= 0) continue;
    for (const w of websites) if (d === w || d.endsWith(`.${w}`)) out.add(w);
  }
  return out;
}

/** Find the mentions; then, if any, which of those websites link. A failed link check leaves "links to you" unknown. */
export async function fetchMentions(name: string, domain: string): Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean; /** What the customer pays: the parts that were delivered (a link check that failed is not charged). */ customerUsd: number }> {
  const target = normalizeDomain(domain) ?? domain;
  const task: DfsTask = assertOk(await mentionsDeps.request("POST", "/content_analysis/search/live", [mentionsRequest(name, target)]), { treatNoResultsAsEmpty: true });
  let costUsd = typeof task.cost === "number" ? task.cost : 0;
  const seen = new Set<string>(), rows: Omit<MentionRow, "linksToYou">[] = [];
  for (const i of taskItems(task)) { const r = parseMention(i, target); if (r && !seen.has(r.domain)) { seen.add(r.domain); rows.push(r); } }
  const page: MentionsPage = { name, domain: target, rows: rows.map((r) => ({ ...r, linksToYou: null })), total: num((task.result?.[0] as any)?.total_count), linksChecked: false, fetchedAt: new Date().toISOString() };
  if (!rows.length) return { data: { ...page, linksChecked: true }, costUsd, costUnknown: false, customerUsd: costUsd };
  const links = await checkLinks(page);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: links.data, costUsd: r6(costUsd + links.costUsd), costUnknown: links.costUnknown, customerUsd: r6(costUsd + (links.data.linksChecked ? links.costUsd : 0)) };
}

/** The link check for a saved page of mentions. Never throws: a failure leaves the rows' "links to you" unknown. */
export async function checkLinks(page: MentionsPage): Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean }> {
  const websites = [...new Set(page.rows.map((r) => r.domain))];
  if (!websites.length) return { data: { ...page, linksChecked: true }, costUsd: 0, costUnknown: false };
  try {
    const task: DfsTask = assertOk(await mentionsDeps.request("POST", "/backlinks/referring_domains/live", [mentionLinksRequest(page.domain, websites)]), { treatNoResultsAsEmpty: true });
    const items = taskItems(task), total = num((task.result?.[0] as any)?.total_count);
    const linking = linkingWebsites(items, websites);
    const partial = total !== null ? total > items.length : items.length >= MENTIONS_ROWS;
    return {
      data: { ...page, linksChecked: true, ...(partial ? { linksPartial: true } : {}), rows: page.rows.map((r) => ({ ...r, linksToYou: linking.has(r.domain) ? true : partial ? null : false })) },
      costUsd: typeof task.cost === "number" ? task.cost : 0, costUnknown: false,
    };
  } catch (e: any) {
    return { data: page, costUsd: typeof e?.costUsd === "number" ? e.costUsd : 0, costUnknown: e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0)) };
  }
}

export type PlaceRead = { place: string | null };
/** Pure: the first of the customer's places named in a mention's title or excerpt, as whole words; null = none. */
export function placeIn(row: { title: string; snippet: string | null }, places: readonly string[]): string | null {
  const hay = ` ${`${row.title} ${row.snippet ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const p of places) {
    const w = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (w.length >= 2 && hay.includes(` ${w} `)) return p;
  }
  return null;
}
/** The places to read for when the customer has given none: the towns of the site's tracked keywords ("Bellingham, WA" -> "Bellingham"). */
export function defaultPlaces(locationNames: (string | null)[]): string[] {
  const out: string[] = [];
  for (const n of locationNames) {
    const town = String(n ?? "").split(",")[0].trim();
    if (town && town.toLowerCase() !== "united states" && !out.some((x) => x.toLowerCase() === town.toLowerCase())) out.push(town);
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}
