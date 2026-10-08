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
import { request, assertOk, taskItems, safeHttpUrl, safeDomain, normalizeDomain, type Deadline, type DfsTask } from "./dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD } from "./pricing";
import { sameUrlKey } from "./audit-pages";

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
/** Whether a name can be searched as written (letters, digits, spaces and & ' . , -; 3-80 characters). */
export const nameOk = (name: string) => { const n = name.trim().replace(/\s+/g, " "); return n.length >= 3 && n.length <= 80 && NAME_RE.test(n); };
export const mentionsInput = z.object({
  name: z.string().trim().min(3, "Enter the business name as people write it.").max(80).transform((s) => s.replace(/\s+/g, " ")).refine((s) => NAME_RE.test(s), "Use the business name only — letters, numbers, spaces and & ' . , -"),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
  /** Ask again only for the link check when it did not load; the mentions already bought are kept and not bought again. */
  retryMissing: z.boolean().default(false),
  /** With refresh: when the saved answer the page was showing was fetched. A newer saved answer (another request bought
   *  it meanwhile) is returned instead of buying again. */
  replaces: z.string().datetime().optional(),
}).strict();
/** The places a mention is read for (towns, a county, a street): words that show it is this business. Free to change. */
export const placesInput = z.array(z.string().trim().min(2).max(40)).max(MAX_PLACES);

/** How a name is compared for the customer's marks: case and spacing do not matter. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
/** A page as compared for the customer's verdicts: http/https, "www", a last slash and the fragment do not matter. */
export const pageKeyOf = (url: string) => sameUrlKey(url);
export const markInput = z.object({
  name: z.string().trim().min(3).max(80),
  /** The page the verdict is about (a verdict is about one page: a directory can list several businesses). */
  url: z.string().trim().max(2048).refine((u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } }, "Not a web address"),
  /** null = take the mark back. */
  verdict: z.enum(["mine", "not_mine"]).nullable(),
}).strict();
export type MentionRow = {
  url: string; domain: string; title: string; snippet: string | null; published: string | null; authority: number | null;
  /** true = the link database has a link from this website to the site; false = none found; null = the link check did not load. */
  linksToYou: boolean | null;
};
export type MentionsPage = {
  name: string; domain: string; rows: MentionRow[];
  /** Pages the source has with the name (not websites; it counts every page). */ total: number | null;
  /** false = the link check did not load: "links to you" is unknown for every row. */ linksChecked: boolean;
  /** When the link check that is shown was made (a second try is later than the search). */ linksCheckedAt?: string | null;
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

/**
 * Whether a host is the site's own: the tracked host or a sub-domain of it. Nothing above the tracked host is assumed
 * to be the same business (alice.github.io is not bob.github.io, and which part of a name is the registrable domain
 * is not guessed); such a page shows as a mention the customer can mark "Not us".
 */
export function ownHost(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, ""), d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}
/** One result as a row; null without a usable address, or when it is the business's own site (see ownHost). */
export function parseMention(item: any, domain: string): Omit<MentionRow, "linksToYou"> | null {
  const url = safeHttpUrl(item?.url), site = safeDomain(item?.main_domain) ?? safeDomain(item?.domain);
  if (!url || !site) return null;
  // Judged on the page's own host as well as the website it is filed under.
  if (ownHost(site, domain) || ownHost(new URL(url).hostname, domain)) return null;
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
export async function fetchMentions(name: string, domain: string, opts: { /** The claim owner's deadline (see dataforseo.ts Deadline), when the check is made under a claim. */ deadline?: Deadline } = {}): Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean; /** What the customer pays: the parts that were delivered (a link check that failed is not charged). */ customerUsd: number }> {
  const target = normalizeDomain(domain) ?? domain;
  const task: DfsTask = assertOk(await mentionsDeps.request("POST", "/content_analysis/search/live", [mentionsRequest(name, target)], undefined, { deadline: opts.deadline }), { treatNoResultsAsEmpty: true });
  let costUsd = typeof task.cost === "number" ? task.cost : 0;
  const seen = new Set<string>(), rows: Omit<MentionRow, "linksToYou">[] = [];
  for (const i of taskItems(task)) { const r = parseMention(i, target); if (r && !seen.has(r.domain)) { seen.add(r.domain); rows.push(r); } }
  const page: MentionsPage = { name, domain: target, rows: rows.map((r) => ({ ...r, linksToYou: null })), total: num((task.result?.[0] as any)?.total_count), linksChecked: false, fetchedAt: new Date().toISOString() };
  if (!rows.length) return { data: { ...page, linksChecked: true, linksCheckedAt: null }, costUsd, costUnknown: false, customerUsd: costUsd };
  const links = await checkLinks(page, opts);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: links.data, costUsd: r6(costUsd + links.costUsd), costUnknown: links.costUnknown, customerUsd: r6(costUsd + (links.data.linksChecked ? links.costUsd : 0)) };
}

/** The link check for a saved page of mentions. Never throws: a failure leaves the rows' "links to you" unknown. */
export async function checkLinks(page: MentionsPage, opts: { deadline?: Deadline } = {}): Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean }> {
  const websites = [...new Set(page.rows.map((r) => r.domain))];
  if (!websites.length) return { data: { ...page, linksChecked: true, linksCheckedAt: null }, costUsd: 0, costUnknown: false };
  try {
    const task: DfsTask = assertOk(await mentionsDeps.request("POST", "/backlinks/referring_domains/live", [mentionLinksRequest(page.domain, websites)], undefined, { deadline: opts.deadline }), { treatNoResultsAsEmpty: true });
    const items = taskItems(task), total = num((task.result?.[0] as any)?.total_count);
    const linking = linkingWebsites(items, websites);
    const partial = total !== null ? total > items.length : items.length >= MENTIONS_ROWS;
    return {
      data: { ...page, linksChecked: true, linksCheckedAt: new Date().toISOString(), ...(partial ? { linksPartial: true } : {}), rows: page.rows.map((r) => ({ ...r, linksToYou: linking.has(r.domain) ? true : partial ? null : false })) },
      costUsd: typeof task.cost === "number" ? task.cost : 0, costUnknown: false,
    };
  } catch (e: any) {
    // A lookup never sent (the owner's deadline had passed) says so: its cost is known to be nothing.
    return { data: page, costUsd: typeof e?.costUsd === "number" ? e.costUsd : 0, costUnknown: e?.costUnknown === false ? false : e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0)) };
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
