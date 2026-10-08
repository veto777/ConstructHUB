/**
 * The SEO dashboard's shared SQL: site groups (one group whatever the letter case) and every site's newest positions.
 */
import { pool } from "../db";

/**
 * The group a site is put in, as SQL inside `UPDATE seo_sites`: `set` says whether the group is being changed, `name`
 * is the new name ("" or null = no group). A name that matches another of the account's groups in any letter case takes
 * that group's spelling, so "Roofing" and "roofing" are one group.
 */
export const groupNameSql = (set: string, name: string) =>
  `CASE WHEN ${set} THEN coalesce((SELECT o.group_name FROM seo_sites o WHERE o.user_id=seo_sites.user_id AND o.id<>seo_sites.id AND lower(o.group_name)=lower(nullif(${name}, '')) ORDER BY o.id LIMIT 1), nullif(${name}, '')) ELSE group_name END`;

export type DashboardRank = { top3: number; top10: number; ranked: number; checked: number; checkedOn: string | null; firstOn: string | null; device: "desktop" | "mobile" | null };

/**
 * Every site's newest positions in one query, on ONE device per site — desktop when the site tracks it, else mobile —
 * never the better of two devices. Each keyword's newest check of that device; the dates they span are returned, so
 * the card can say what its numbers rest on.
 */
export async function dashboardRanks(siteIds: number[]): Promise<Map<number, DashboardRank>> {
  const { rows } = await pool.query(
    `SELECT site_id, device, count(*) FILTER (WHERE position<=3)::int AS top3, count(*) FILTER (WHERE position<=10)::int AS top10,
            count(*) FILTER (WHERE position IS NOT NULL)::int AS ranked, count(*)::int AS checked, max(checked_on)::text AS checked_on, min(checked_on)::text AS first_on
       FROM (SELECT DISTINCT ON (c.keyword_id) c.site_id, c.device, c.position, c.checked_on FROM seo_rank_checks c JOIN seo_sites s ON s.id=c.site_id
              WHERE c.site_id = ANY($1::int[]) AND c.device = CASE WHEN s.devices='mobile' THEN 'mobile' ELSE 'desktop' END
              ORDER BY c.keyword_id, c.checked_on DESC, c.id DESC) x
      GROUP BY site_id, device`, [siteIds]);
  return new Map(rows.map((r: any) => [r.site_id, { top3: r.top3, top10: r.top10, ranked: r.ranked, checked: r.checked, checkedOn: r.checked_on, firstOn: r.first_on, device: r.device }]));
}
