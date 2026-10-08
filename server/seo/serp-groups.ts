/**
 * Rank tracker → searches Google answers with the same pages. Two tracked keywords whose first-page results are
 * largely the same addresses are, to Google, the same question — one page can usually serve both, and two pages
 * aimed at them are aiming at one thing. Worked out from the result pages the last rank check already saved
 * (seo_rank_checks.serp_top, the first page of ordinary results — up to ten, in practice seven to nine) — free.
 *
 * What it rests on is said with every group: one check, on one date, on one device, in one place; "the same" means
 * at least SERP_SHARED of those addresses in common with the group's first keyword. Keywords tracked in different
 * places are never compared (their results differ because the place does). It is a snapshot, not a rule.
 */
import { pool } from "../db";
import { strictPageKey } from "./competing-pages";

/** Addresses two first pages must share for the searches to count as one. Four is the usual line in keyword grouping; on real pages (7–9 results) it is about half. */
export const SERP_SHARED = 4;
/** A result page with fewer addresses than this is too thin to compare. */
export const SERP_MIN_RESULTS = 6;
export type SerpCheck = { keywordId: number; keyword: string; volume: number | null; locationCode: number | null; location: string | null; position: number | null; /** The site's own page in these results. */ url: string | null; serpTop: unknown };
export type SerpGroupMember = { keywordId: number; keyword: string; volume: number | null; position: number | null; /** The site's own ranking page (exact address), or null. */ page: string | null; /** Addresses shared with the group's first keyword; the first keyword itself has all of its own. */ shared: number; of: number };
export type SerpGroup = {
  location: string | null; locationCode: number | null;
  /** The first keyword (highest volume) and the others whose results match it, most shared first. */ members: SerpGroupMember[];
  /** Searches a month across the members that have a figure, and how many have one. */ volume: number | null; measured: number;
  /** The site's own pages that rank within the group (exact addresses). More than one = different pages of the site answer what Google treats as one question. */ ownPages: string[];
  /** Members the site does not rank for at all. */ unranked: number;
};
export type SerpGroups = { groups: SerpGroup[]; /** Keywords with a usable saved result page. */ compared: number; /** Keywords checked but without one (too few results saved, or none). */ skipped: number; shared: number };

const top = (v: unknown): string[] => {
  const out: string[] = [];
  for (const e of Array.isArray(v) ? v : []) { const k = typeof (e as any)?.url === "string" ? strictPageKey((e as any).url) : null; if (k && !out.includes(k)) out.push(k); if (out.length >= 10) break; }
  return out;
};
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure and deterministic. Within one place: keywords are taken highest volume first (then by name); each joins the
 * first existing group whose FIRST keyword it shares at least SERP_SHARED addresses with, or starts a group. Being
 * compared with the first keyword only means a group cannot drift from one topic to another through a chain of
 * near-matches. Groups of one are not returned.
 */
export function groupBySerp(checks: readonly SerpCheck[], shared = SERP_SHARED): SerpGroups {
  const usable = checks.map((c) => ({ c, urls: top(c.serpTop) })).filter((x) => x.urls.length >= SERP_MIN_RESULTS);
  const byPlace = new Map<string, typeof usable>();
  for (const x of usable) { const k = String(x.c.locationCode ?? 0); (byPlace.get(k) ?? byPlace.set(k, []).get(k)!).push(x); }
  const groups: SerpGroup[] = [];
  for (const list of [...byPlace.entries()].sort(([a], [b]) => cmp(a, b)).map(([, l]) => l)) {
    list.sort((a, b) => (b.c.volume ?? -1) - (a.c.volume ?? -1) || cmp(a.c.keyword, b.c.keyword) || a.c.keywordId - b.c.keywordId);
    const open: { head: (typeof list)[number]; set: Set<string>; members: SerpGroupMember[] }[] = [];
    for (const x of list) {
      const member = (n: number): SerpGroupMember => ({ keywordId: x.c.keywordId, keyword: x.c.keyword, volume: x.c.volume, position: x.c.position, page: x.c.position !== null && x.c.url ? strictPageKey(x.c.url) : null, shared: n, of: x.urls.length });
      let placed = false;
      for (const g of open) {
        const n = x.urls.filter((u) => g.set.has(u)).length;
        if (n >= shared) { g.members.push(member(n)); placed = true; break; }
      }
      if (!placed) open.push({ head: x, set: new Set(x.urls), members: [member(x.urls.length)] });
    }
    for (const g of open) {
      if (g.members.length < 2) continue;
      const [head, ...rest] = g.members;
      rest.sort((a, b) => b.shared - a.shared || (b.volume ?? -1) - (a.volume ?? -1) || cmp(a.keyword, b.keyword));
      const members = [head, ...rest], vols = members.map((m) => m.volume).filter((v): v is number => typeof v === "number");
      groups.push({
        location: g.head.c.location, locationCode: g.head.c.locationCode, members,
        volume: vols.length ? vols.reduce((a, b) => a + b, 0) : null, measured: vols.length,
        ownPages: [...new Set(members.map((m) => m.page).filter((p): p is string => !!p))].sort(cmp), unranked: members.filter((m) => m.position === null).length,
      });
    }
  }
  // Groups where the site answers one question with several pages first, then the largest.
  groups.sort((a, b) => Number(b.ownPages.length > 1) - Number(a.ownPages.length > 1) || (b.volume ?? -1) - (a.volume ?? -1) || b.members.length - a.members.length || cmp(a.members[0].keyword, b.members[0].keyword));
  return { groups, compared: usable.length, skipped: checks.length - usable.length, shared };
}

/** The newest check of each of a site's keywords on one device, grouped. Saved rows only. */
export async function serpGroups(userId: number, siteId: number, device: "desktop" | "mobile"): Promise<SerpGroups & { device: string; checkedOn: string | null; oldest: string | null }> {
  // Each keyword's own newest check (keywords are not all checked on the same day), no older than five weeks.
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.keyword_id) c.keyword_id AS "keywordId", k.keyword, k.search_volume AS volume, k.location_code AS "locationCode", k.location_name AS location,
            c.position, c.url, c.serp_top AS "serpTop", c.checked_on::text AS "checkedOn"
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND k.user_id=$2 AND c.device=$3 AND c.checked_on >= current_date - 35
      ORDER BY c.keyword_id, c.checked_on DESC, c.id DESC`, [siteId, userId, device]);
  const dates = rows.map((r: any) => String(r.checkedOn)).sort();
  return { ...groupBySerp(rows), device, checkedOn: dates[dates.length - 1] ?? null, oldest: dates[0] ?? null };
}
