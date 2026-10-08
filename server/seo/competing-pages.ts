/**
 * Rank tracker → the page Google shows for a search: tracked keywords for which Google has shown DIFFERENT pages of
 * the site from one check to the next. Going back and forth between two pages is a reason to look at whether the two
 * are competing for the search; a single change is more often a page that was moved or replaced, and is listed
 * apart. A third kind is one page seen under two addresses (http and https, with and without "www" or a last slash).
 * These are observations from saved checks — one page per check per device — not a diagnosis. Free.
 */
import { pool } from "../db";
import { pageKey } from "@shared/seo-page-key";

export const COMPETING_DAYS = 120;
export type CompetingCheck = { keywordId: number; keyword: string; volume: number | null; location?: string | null; device: string; checkedOn: string; position: number | null; url: string | null };
export type CompetingPage = { /** The address as Google showed it most recently. */ url: string; /** Checks in which this page was the one shown. */ times: number; best: number; lastSeen: string; lastPosition: number; /** Other ways the same page's address was written in these checks. */ alsoAs?: string[] };
export type CompetingKeyword = {
  keywordId: number; keyword: string; volume: number | null; /** The place the keyword is tracked in, when it has one. */ location: string | null; device: string;
  /**
   * "alternating": Google went from one page to another and back at least once. "changed": the page changed without
   * going back. "aliases": always the same page, but its address was written in more than one way.
   */
  kind: "alternating" | "changed" | "aliases";
  /** Checks in which the site ranked, in the period, and the dates of the first and last of them. */ checks: number; firstRanked: string; lastRanked: string;
  /** The newest check of this keyword on this device, ranked or not. Later than lastRanked = it has not ranked since. */ lastCheck: string;
  /** Times the page shown differed from the ranked check before. */ switches: number;
  /** The pages shown, the one shown most recently first. */ pages: CompetingPage[];
};

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|srsltid|gad_source|gbraid|wbraid|mc_cid|mc_eid)$/i;
/** The address exactly as a page: without its fragment and without the click-tracking parameters search engines and ads add (they never change what is served). Nothing else is folded. */
export function strictPageKey(url: string): string | null {
  const k = pageKey(url);
  if (!k) return null;
  const u = new URL(k);
  for (const name of [...u.searchParams.keys()]) if (TRACKING.test(name)) u.searchParams.delete(name);
  return u.toString();
}
/**
 * Addresses that are ALMOST certainly one page: the same but for http/https, "www" and a last slash. Used only to
 * tell "one page under two addresses" apart from "two pages" — the two are reported differently, neither is hidden.
 */
export function aliasKey(url: string): string | null {
  const k = strictPageKey(url);
  if (!k) return null;
  const u = new URL(k);
  // host, not hostname: a page on another port is another page.
  return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
}

/** Pure. Only checks where the site ranked with a known page count; a check where it did not rank says nothing about which page. */
export function findCompeting(rows: readonly CompetingCheck[]): { items: CompetingKeyword[]; /** Keywords with at least two ranked checks on one device: the only ones a change could have been seen in. */ comparable: number } {
  const groups = new Map<string, { all: CompetingCheck[]; ranked: CompetingCheck[] }>();
  for (const r of rows) {
    const k = `${r.keywordId}:${r.device}`;
    const g = groups.get(k) ?? groups.set(k, { all: [], ranked: [] }).get(k)!;
    g.all.push(r);
    if (r.position !== null && r.url && aliasKey(r.url)) g.ranked.push(r);
  }
  const perKeyword = new Map<number, CompetingKeyword>();
  const comparable = new Set<number>();
  const rank = { alternating: 0, changed: 1, aliases: 2 } as const;
  for (const { all, ranked } of groups.values()) {
    if (ranked.length < 2) continue;
    comparable.add(ranked[0].keywordId);
    ranked.sort((a, b) => a.checkedOn.localeCompare(b.checkedOn));
    const pages = new Map<string, CompetingPage & { written: Set<string> }>();
    let switches = 0, returned = false, before: string | null = null;
    const seen = new Set<string>();
    for (const c of ranked) {
      const key = aliasKey(c.url!)!, exact = strictPageKey(c.url!)!;
      if (before !== null && key !== before) { switches++; if (seen.has(key)) returned = true; }
      seen.add(key); before = key;
      const p = pages.get(key);
      if (!p) pages.set(key, { url: exact, times: 1, best: c.position!, lastSeen: c.checkedOn, lastPosition: c.position!, written: new Set([exact]) });
      else { p.times++; p.best = Math.min(p.best, c.position!); p.lastSeen = c.checkedOn; p.lastPosition = c.position!; p.url = exact; p.written.add(exact); }
    }
    const aliased = [...pages.values()].some((p) => p.written.size > 1);
    if (pages.size < 2 && !aliased) continue;
    const first = ranked[0];
    const found: CompetingKeyword = {
      keywordId: first.keywordId, keyword: first.keyword, volume: first.volume, location: first.location ?? null, device: first.device,
      kind: pages.size < 2 ? "aliases" : returned ? "alternating" : "changed", checks: ranked.length, firstRanked: first.checkedOn, lastRanked: ranked[ranked.length - 1].checkedOn,
      lastCheck: all.reduce((m, c) => (c.checkedOn > m ? c.checkedOn : m), first.checkedOn), switches,
      pages: [...pages.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.times - a.times || a.url.localeCompare(b.url))
        .map(({ written, ...p }) => ({ ...p, ...(written.size > 1 ? { alsoAs: [...written].filter((w) => w !== p.url).sort() } : {}) })),
    };
    // One line per keyword. When both devices were checked: the stronger kind, then the more changes, then desktop —
    // a fixed order, so the same checks always give the same line. The line says which device it is.
    const had = perKeyword.get(first.keywordId);
    const better = !had || rank[found.kind] < rank[had.kind] || (found.kind === had.kind && (found.switches > had.switches || (found.switches === had.switches && found.device < had.device)));
    if (better) perKeyword.set(first.keywordId, found);
  }
  const items = [...perKeyword.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.switches - a.switches || (b.volume ?? -1) - (a.volume ?? -1) || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : a.keywordId - b.keywordId));
  return { items, comparable: comparable.size };
}

/** The site's tracked keywords whose ranking page changed in the last COMPETING_DAYS days. Saved checks only. */
export async function competingPages(userId: number, siteId: number): Promise<{ days: number; /** Keywords with any check in the period. */ keywords: number; comparable: number; items: CompetingKeyword[] }> {
  const { rows } = await pool.query(
    `SELECT c.keyword_id AS "keywordId", k.keyword, k.search_volume AS volume, k.location_name AS location, c.device, c.checked_on::text AS "checkedOn", c.position, c.url
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND k.user_id=$2 AND c.checked_on >= current_date - $3::int
      ORDER BY c.checked_on, c.id`, [siteId, userId, COMPETING_DAYS]);
  return { days: COMPETING_DAYS, keywords: new Set(rows.map((r: any) => r.keywordId)).size, ...findCompeting(rows) };
}
