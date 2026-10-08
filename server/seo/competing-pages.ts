/**
 * Rank tracker → pages competing for the same search: tracked keywords for which Google has shown DIFFERENT pages of
 * the site from one check to the next. When it goes back and forth between two pages, the two are usually competing
 * (one strong page tends to do better than two half-strong ones); a single change is more often a page that was moved
 * or replaced, and is listed apart, without that claim. Built from the checks already saved — free.
 */
import { pool } from "../db";

export const COMPETING_DAYS = 120;
export type CompetingCheck = { keywordId: number; keyword: string; volume: number | null; device: string; checkedOn: string; position: number | null; url: string | null };
export type CompetingPage = { url: string; /** Checks in which this page was the one shown. */ times: number; best: number; lastSeen: string; lastPosition: number };
export type CompetingKeyword = {
  keywordId: number; keyword: string; volume: number | null; device: string;
  /** "alternating": Google went from one page to another and back at least once. "changed": it changed page once. */
  kind: "alternating" | "changed";
  /** Checks in which the site ranked, in the period. */ checks: number; /** Times the page shown differed from the check before. */ switches: number;
  /** The pages shown, the one shown most recently first. */ pages: CompetingPage[];
};

/**
 * One page, however its address was written: http or https, with or without www, with or without a last slash and
 * without a fragment are the same page here — otherwise a site that moved to https would look like two pages competing.
 * The path's case and the query string are kept: those can be different pages.
 */
export function samePageKey(url: string): string | null {
  try { const u = new URL(url); return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`; } catch { return null; }
}

/** Pure. Only checks where the site ranked with a known page count; a check where it did not rank says nothing about which page. */
export function findCompeting(rows: readonly CompetingCheck[]): CompetingKeyword[] {
  const groups = new Map<string, CompetingCheck[]>();
  for (const r of rows) {
    if (r.position === null || !r.url || !samePageKey(r.url)) continue;
    const k = `${r.keywordId}:${r.device}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const perKeyword = new Map<number, CompetingKeyword>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.checkedOn.localeCompare(b.checkedOn));
    const pages = new Map<string, CompetingPage>();
    let switches = 0, returned = false, before: string | null = null;
    const seen = new Set<string>();
    for (const c of list) {
      const key = samePageKey(c.url!)!;
      if (before !== null && key !== before) { switches++; if (seen.has(key)) returned = true; }
      seen.add(key); before = key;
      const p = pages.get(key);
      if (!p) pages.set(key, { url: c.url!, times: 1, best: c.position!, lastSeen: c.checkedOn, lastPosition: c.position! });
      else { p.times++; p.best = Math.min(p.best, c.position!); p.lastSeen = c.checkedOn; p.lastPosition = c.position!; p.url = c.url!; }
    }
    if (pages.size < 2) continue;
    const first = list[0];
    const found: CompetingKeyword = {
      keywordId: first.keywordId, keyword: first.keyword, volume: first.volume, device: first.device,
      kind: returned ? "alternating" : "changed", checks: list.length, switches,
      pages: [...pages.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.times - a.times),
    };
    // One line per keyword: when both devices were checked, the one where the pages changed more.
    const had = perKeyword.get(first.keywordId);
    if (!had || (found.kind === "alternating" && had.kind !== "alternating") || (found.kind === had.kind && found.switches > had.switches)) perKeyword.set(first.keywordId, found);
  }
  return [...perKeyword.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "alternating" ? -1 : 1) || b.switches - a.switches || (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword));
}

/** The site's tracked keywords whose ranking page changed in the last COMPETING_DAYS days. Saved checks only. */
export async function competingPages(userId: number, siteId: number): Promise<{ days: number; keywords: number; items: CompetingKeyword[] }> {
  const { rows } = await pool.query(
    `SELECT c.keyword_id AS "keywordId", k.keyword, k.search_volume AS volume, c.device, c.checked_on::text AS "checkedOn", c.position, c.url
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND k.user_id=$2 AND c.checked_on >= current_date - $3::int
      ORDER BY c.checked_on`, [siteId, userId, COMPETING_DAYS]);
  return { days: COMPETING_DAYS, keywords: new Set(rows.map((r: any) => r.keywordId)).size, items: findCompeting(rows) };
}
