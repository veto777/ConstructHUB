/** Read-only bridge to published GBP updates; independent of the Posts & Photos lane's schema. */
import { pool } from "../db";
import { clientFor } from "../gbp/service";
import { resource } from "../gbp/client";
import { publicMediaUrl } from "../../shared/social";
import { SocialError } from "./client";
export async function syncGbpSources(userId: number, make = clientFor, businessId: number | null = null) {
  const { rows: locations } = await pool.query(
    `SELECT l.* FROM business_locations l JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject
    WHERE l.user_id=$1 AND ($2::int IS NULL OR l.id=$2) AND l.gbp_location_name IS NOT NULL AND NOT g.reconnect_required AND 'https://www.googleapis.com/auth/business.manage'=ANY(g.scopes) ORDER BY l.id LIMIT 20`,
    [userId,businessId],
  );
  if (!locations.length)
    throw new SocialError(
      "Connect and link a Google Business Profile in Locations first",
      409,
    );
  let imported = 0;
  for (const l of locations) {
    const parent = `${resource(l.gbp_account_name, "accounts")}/${resource(l.gbp_location_name, "locations")}`;
    const posts = await make(userId, l.gbp_google_subject).pages(
      "reviews",
      `/v4/${parent}/localPosts`,
      "localPosts",
    );
    const eligible = posts.filter(
      (p: any) =>
        p.state === "LIVE" &&
        p.topicType === "STANDARD" &&
        typeof p.summary === "string" &&
        p.summary.trim() &&
        p.name?.startsWith(`${parent}/localPosts/`) &&
        Date.parse(p.createTime) > Date.now() - 30 * 86400000,
    );
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "DELETE FROM social_sources WHERE user_id=$1 AND external_key LIKE $2",
        [userId, `${parent}/localPosts/%`],
      );
      for (const p of eligible) {
        const media = (p.media || [])
          .map((m: any) => m.googleUrl || m.sourceUrl)
          .filter((url: any) => publicMediaUrl.safeParse(url).success)
          .slice(0, 10);
        await c.query(
          `INSERT INTO social_sources(user_id,kind,text,media_urls,external_key,created_at,business_id) VALUES($1,'gbp',$2,$3,$4,$5,$6)`,
          [
            userId,
            p.summary,
            JSON.stringify(media),
            p.name,
            new Date(p.createTime),
            businessId,
          ],
        );
        imported++;
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return { imported };
}
