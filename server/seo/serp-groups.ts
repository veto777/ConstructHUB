/**
 * Rank tracker → searches with largely the same results. Tracked keywords whose first-page results overlap heavily
 * with one another's are candidates for being one topic — worth a look at whether one page, or two, should serve
 * them. Worked out from the result pages the rank checks already saved (seo_rank_checks.serp_top, the first page of
 * ordinary results — up to ten, in practice seven to nine) — free.
 *
 * It is an overlap count, not Google's own grouping, and the page says so: "the same" means at least SERP_SHARED
 * addresses in common with the group's FIRST keyword (the others are not compared with each other); each keyword
 * brings its own newest check, so the results compared can be from different days — every member carries its date;
 * keywords tracked in different places are never compared (their results differ because the place does).
 */
import { pool } from "../db";
import { aliasKey, strictPageKey } from "./competing-pages";

/** Addresses two first pages must share for the searches to be put together. Four is the usual line in keyword grouping; on real pages (7–9 results) it is about half. */
export const SERP_SHARED = 4;
/** A result page with fewer addresses than this is too thin to compare. */
export const SERP_MIN_RESULTS = 6;
export type SerpCheck = { keywordId: number; keyword: string; volume: number | null; locationCode: number | null; location: string | null; position: number | null; /** The site's own page in these results. */ url: string | null; serpTop: unknown; checkedOn?: string | null };
export type SerpGroupMember = {
  keywordId: number; keyword: string; volume: number | null; position: number | null;
  /** The site's own ranking address (exact), or null — which, when `position` is a number, means "ranks, but the page was not recorded". */ page: string | null;
  /** Addresses shared with the group's first keyword; the first keyword itself has all of its own. */ shared: number; of: number;
  /** The day this keyword's results were saved. */ checkedOn: string | null;
};
export type SerpGroup = {
  location: string | null; locationCode: number | null;
  /** The first keyword (highest volume) and the others whose results overlap with it, most shared first. */ members: SerpGroupMember[];
  /** Searches a month across the members that have a figure, and how many have one. */ volume: number | null; measured: number;
  /** The site's own recorded addresses that rank within the group (exact). */ ownPages: string[];
  /**
   * How many addresses are left when those differing only by http/https, "www" or a last slash are counted once. It
   * is a count of addresses, not of pages: two of them may still be one page (a redirect, a canonical) — not checked.
   */ ownDistinct: number;
  /** Members the site is not found for at all, and members it ranks for without the page having been recorded. */ unranked: number; rankedNoPage: number;
  /** The earliest and latest day among the members' checks. */ from: string | null; to: string | null;
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
 * near-matches — and also that two members need not overlap with each other. Groups of one are not returned.
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
      const member = (n: number): SerpGroupMember => ({ keywordId: x.c.keywordId, keyword: x.c.keyword, volume: x.c.volume, position: x.c.position, page: x.c.position !== null && x.c.url ? strictPageKey(x.c.url) : null, shared: n, of: x.urls.length, checkedOn: x.c.checkedOn ? String(x.c.checkedOn).slice(0, 10) : null });
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
      const ownPages = [...new Set(members.map((m) => m.page).filter((p): p is string => !!p))].sort(cmp);
      const days = members.map((m) => m.checkedOn).filter((d): d is string => !!d).sort();
      groups.push({
        location: g.head.c.location, locationCode: g.head.c.locationCode, members,
        volume: vols.length ? vols.reduce((a, b) => a + b, 0) : null, measured: vols.length,
        ownPages, ownDistinct: new Set(ownPages.map((p) => aliasKey(p) ?? p)).size,
        unranked: members.filter((m) => m.position === null).length, rankedNoPage: members.filter((m) => m.position !== null && !m.page).length,
        from: days[0] ?? null, to: days[days.length - 1] ?? null,
      });
    }
  }
  // Groups in which clearly different pages of the site rank first, then the largest.
  groups.sort((a, b) => Number(b.ownDistinct > 1) - Number(a.ownDistinct > 1) || (b.volume ?? -1) - (a.volume ?? -1) || b.members.length - a.members.length || cmp(a.members[0].keyword, b.members[0].keyword));
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
