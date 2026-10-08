/**
 * The cap on tracked sites (MAX_SITES in server/seo/routes.ts): it is on sites the account does not have yet — adding a
 * site it already tracks (to change its country, language or devices) is an update, allowed at the cap. The caller
 * runs this one add at a time per account, so the count cannot be raced.
 */
import { pool } from "../db";

export async function siteCapRefuses(user: number, domain: string, max: number, db: { query: typeof pool.query } = pool): Promise<boolean> {
  const { rows: [{ n, have }] } = await db.query("SELECT count(*)::int n, coalesce(bool_or(domain=$2), false) AS have FROM seo_sites WHERE user_id=$1", [user, domain]);
  return !have && n >= max;
}
