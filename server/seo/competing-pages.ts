/**
 * Rank tracker → the page Google shows for a search: tracked keywords for which Google has shown DIFFERENT pages of
 * the site from one check to the next. Going back and forth between two pages is a reason to look at whether the two
 * are competing for the search; a single change is more often a page that was moved or replaced, and is listed
 * apart. A third kind is addresses that differ only by http/https, "www" or a last slash — possibly one page.
 * These are observations from saved checks — one page per check per device — not a diagnosis. Free.
 */
import { pool } from "../db";
import { pageKey } from "@shared/seo-page-key";

export const COMPETING_DAYS = 120;
export type CompetingCheck = { keywordId: number; keyword: string; volume: number | null; location?: string | null; device: string; checkedOn: string; position: number | null; url: string | null };
export type CompetingPage = { /** The address, exactly as Google showed it (less its fragment and click-tracking). */ url: string; /** Checks in which this address was the one shown. */ times: number; best: number; lastSeen: string; lastPosition: number };
export type CompetingKeyword = {
  keywordId: number; keyword: string; volume: number | null; /** The place the keyword is tracked in, when it has one. */ location: string | null; device: string;
  /**
   * "alternating": Google left one page for a clearly different one and came back at least once. "changed": it moved
   * to a clearly different page without coming back. "variants": every address shown differs from the others only by
   * http/https, "www" or a last slash — possibly one page, possibly not; that has not been checked.
   */
  kind: "alternating" | "changed" | "variants";
  /** Checks in which the site ranked AND the page was recorded, with the dates of the first and last of them. */ checks: number; firstRanked: string; lastRanked: string;
  /** The newest check in which the site ranked at all — later than lastRanked when the page of that check was not recorded. */ lastRankedAny: string;
  /** The newest check of this keyword on this device, ranked or not. Later than lastRankedAny = not found since. */ lastCheck: string;
  /** Times the exact address shown differed from the one in the ranked check before. */ switches: number;
  /** The addresses shown, the one shown most recently first. Nothing is merged. */ pages: CompetingPage[];
  /** Groups of the addresses above that differ only by http/https, "www" or a last slash. Left out when there are none. */ variants?: string[][];
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
 * Addresses that MAY be one page: the same but for http/https, "www" and a last slash. Whether they are is not
 * checked here (it takes a redirect or a canonical tag to know). Used only to keep the stronger claims — "went back
 * and forth", "changed page" — for addresses that are clearly different; nothing is merged or hidden because of it.
 */
export function aliasKey(url: string): string | null {
  const k = strictPageKey(url);
  if (!k) return null;
  const u = new URL(k);
  // host, not hostname: a page on another port is another page.
  return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
}

/**
 * Pure. Only checks where the site ranked with a known page count; a check where it did not rank says nothing about
 * which page. Every exact address is kept and counted on its own. Whether Google "went back and forth" or "changed
 * page" is judged between addresses that are clearly different pages — two spellings of what may be one address
 * (see aliasKey) never make that claim, and are reported as possible variants instead.
 */
export function findCompeting(rows: readonly CompetingCheck[]): { items: CompetingKeyword[]; /** Keywords with at least two ranked checks (page recorded) on one device: the only ones a change could have been seen in. */ comparable: number } {
  const groups = new Map<string, { all: CompetingCheck[]; ranked: CompetingCheck[] }>();
  for (const r of rows) {
    const k = `${r.keywordId}:${r.device}`;
    const g = groups.get(k) ?? groups.set(k, { all: [], ranked: [] }).get(k)!;
    g.all.push(r);
    if (r.position !== null && r.url && aliasKey(r.url)) g.ranked.push(r);
  }
  const perKeyword = new Map<number, CompetingKeyword>();
  const comparable = new Set<number>();
  const rank = { alternating: 0, changed: 1, variants: 2 } as const;
  const latest = (list: CompetingCheck[], from: string) => list.reduce((m, c) => (c.checkedOn > m ? c.checkedOn : m), from);
  for (const { all, ranked } of groups.values()) {
    if (ranked.length < 2) continue;
    comparable.add(ranked[0].keywordId);
    ranked.sort((a, b) => a.checkedOn.localeCompare(b.checkedOn));
    const pages = new Map<string, CompetingPage>();
    const families = new Map<string, Set<string>>();   // probably-one-page → the exact addresses seen for it
    let switches = 0, returned = false, beforeExact: string | null = null, beforeFamily: string | null = null;
    const seenFamilies = new Set<string>();
    for (const c of ranked) {
      const family = aliasKey(c.url!)!, exact = strictPageKey(c.url!)!;
      if (beforeExact !== null && exact !== beforeExact) switches++;
      if (beforeFamily !== null && family !== beforeFamily && seenFamilies.has(family)) returned = true;
      seenFamilies.add(family); beforeExact = exact; beforeFamily = family;
      (families.get(family) ?? families.set(family, new Set()).get(family)!).add(exact);
      const p = pages.get(exact);
      if (!p) pages.set(exact, { url: exact, times: 1, best: c.position!, lastSeen: c.checkedOn, lastPosition: c.position! });
      else { p.times++; p.best = Math.min(p.best, c.position!); p.lastSeen = c.checkedOn; p.lastPosition = c.position!; }
    }
    if (pages.size < 2) continue;
    const variants = [...families.values()].filter((f) => f.size > 1).map((f) => [...f].sort());
    const first = ranked[0], lastRanked = ranked[ranked.length - 1].checkedOn;
    const found: CompetingKeyword = {
      keywordId: first.keywordId, keyword: first.keyword, volume: first.volume, location: first.location ?? null, device: first.device,
      kind: families.size < 2 ? "variants" : returned ? "alternating" : "changed", checks: ranked.length, firstRanked: first.checkedOn, lastRanked,
      lastRankedAny: latest(all.filter((c) => c.position !== null), lastRanked), lastCheck: latest(all, lastRanked), switches,
      pages: [...pages.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.times - a.times || (a.url < b.url ? -1 : 1)),
      ...(variants.length ? { variants } : {}),
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
