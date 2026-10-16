/**
 * The cap on tracked sites (MAX_SITES in server/seo/routes.ts): it is on sites the account does not have yet — adding a
 * site it already tracks is answered with that site, allowed at the cap. The caller runs this one add at a time per
 * account, so the count cannot be raced.
 */
import { pool } from "../db";

export async function siteCapRefuses(user: number, domain: string, max: number, db: { query: typeof pool.query } = pool): Promise<boolean> {
  const { rows: [{ n, have }] } = await db.query("SELECT count(*)::int n, coalesce(bool_or(domain=$2), false) AS have FROM seo_sites WHERE user_id=$1", [user, domain]);
  return !have && n >= max;
}

export type NewSiteSettings = { locationCode: number; languageCode: string; devices: string; serpDepth: number };

/**
 * POST /api/seo/sites' write (review w3-r2 M1): a new domain is inserted with the given settings; a domain the account
 * already has is returned exactly as stored — never reset to the add's settings (an "Add to my sites" button sends
 * only the domain, so the zod defaults would otherwise overwrite a tracked site's country, language, devices and SERP
 * depth). Settings change only through the site's own settings route.
 */
export async function addSiteOrExisting(user: number, domain: string, s: NewSiteSettings, db: { query: typeof pool.query } = pool): Promise<{ site: any; existing: boolean }> {
  const { rows: [site] } = await db.query(
    `INSERT INTO seo_sites(user_id,domain,location_code,language_code,devices,serp_depth) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(user_id,domain) DO NOTHING
     RETURNING *, 0 AS keyword_count`,
    [user, domain, s.locationCode, s.languageCode, s.devices, s.serpDepth]);
  if (site) return { site, existing: false };
  const { rows: [have] } = await db.query(
    `SELECT s.*, (SELECT count(*)::int FROM seo_keywords k WHERE k.site_id=s.id) AS keyword_count
     FROM seo_sites s WHERE s.user_id=$1 AND s.domain=$2`, [user, domain]);
  return { site: have, existing: true };
}
