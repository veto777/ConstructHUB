/**
 * Rank tracker history: how a site's tracked keywords moved over time, built
 * from the checks already stored in seo_rank_checks. Reading history never
 * spends SEO data.
 */
import { pool } from "../db";

export type CheckRow = { keywordId: number; checkedOn: string; position: number | null; volume: number | null };
export type RankDay = {
  date: string; checked: number; ranked: number;
  top3: number; top10: number; top20: number; top100: number; notRanked: number;
  averagePosition: number | null;
  /** Estimated share of the clicks available on the tracked keywords, 0-100. */
  visibility: number;
};

/**
 * Typical share of clicks by organic position (1-10). An estimate used only to
 * weight the visibility figure — the same idea as Ahrefs' "share of voice".
 */
export const CLICK_SHARE = [0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02];
export const clickShare = (position: number | null) => (position !== null && position >= 1 && position <= CLICK_SHARE.length ? CLICK_SHARE[Math.floor(position) - 1] : 0);

/** One summary per check date, oldest first. Volume-weighted when every keyword has a volume, else each keyword counts once. */
export function summarizeChecks(rows: CheckRow[]): RankDay[] {
  const byDate = new Map<string, CheckRow[]>();
  for (const r of rows) { const d = byDate.get(r.checkedOn); if (d) d.push(r); else byDate.set(r.checkedOn, [r]); }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => {
    const ranked = day.filter((r) => r.position !== null) as (CheckRow & { position: number })[];
    const weighted = day.every((r) => (r.volume ?? 0) > 0);
    const weight = (r: CheckRow) => (weighted ? (r.volume as number) : 1);
    const total = day.reduce((a, r) => a + weight(r), 0);
    const won = day.reduce((a, r) => a + weight(r) * clickShare(r.position), 0);
    const count = (lo: number, hi: number) => ranked.filter((r) => r.position >= lo && r.position <= hi).length;
    return {
      date, checked: day.length, ranked: ranked.length,
      top3: count(1, 3), top10: count(4, 10), top20: count(11, 20), top100: ranked.filter((r) => r.position > 20).length, notRanked: day.length - ranked.length,
      averagePosition: ranked.length ? Math.round((ranked.reduce((a, r) => a + r.position, 0) / ranked.length) * 10) / 10 : null,
      visibility: total ? Math.round((won / total / CLICK_SHARE[0]) * 1000) / 10 : 0,
    };
  });
}

export const HISTORY_DAYS = 365;

export async function rankHistory(siteId: number, device: "desktop" | "mobile", tag: string | null): Promise<RankDay[]> {
  const { rows } = await pool.query(
    `SELECT c.keyword_id AS "keywordId", c.checked_on::text AS "checkedOn", c.position, k.search_volume AS volume
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND c.device=$2 AND c.checked_on >= current_date - $3::int AND ($4::text IS NULL OR $4 = ANY(k.tags))
      ORDER BY c.checked_on`, [siteId, device, HISTORY_DAYS, tag]);
  return summarizeChecks(rows);
}

export type KeywordPoint = { date: string; desktop: number | null; mobile: number | null; url: string | null };

/** One row per check date with both devices side by side, oldest first. */
export function keywordSeries(rows: { checkedOn: string; device: string; position: number | null; url: string | null }[]): KeywordPoint[] {
  const byDate = new Map<string, KeywordPoint>();
  for (const r of rows) {
    const p = byDate.get(r.checkedOn) ?? { date: r.checkedOn, desktop: null, mobile: null, url: null };
    if (r.device === "desktop" || r.device === "mobile") p[r.device] = r.position;
    if (r.url && (!p.url || r.device === "desktop")) p.url = r.url;
    byDate.set(r.checkedOn, p);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** null when the keyword is not this account's. */
export async function keywordHistory(user: number, keywordId: number): Promise<{ keyword: string; points: KeywordPoint[] } | null> {
  const { rows: [k] } = await pool.query("SELECT id, keyword FROM seo_keywords WHERE id=$1 AND user_id=$2", [keywordId, user]);
  if (!k) return null;
  const { rows } = await pool.query(
    `SELECT checked_on::text AS "checkedOn", device, position, url FROM seo_rank_checks
      WHERE keyword_id=$1 AND checked_on >= current_date - $2::int ORDER BY checked_on`, [keywordId, HISTORY_DAYS]);
  return { keyword: k.keyword, points: keywordSeries(rows) };
}
