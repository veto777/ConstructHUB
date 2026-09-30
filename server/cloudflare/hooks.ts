import { pool } from "../db";
import { listInput, ownedAsset } from "./common";
/** Read-only bridge: Click Guard / VPN Shield findings never publish rules automatically. */
export async function flaggedIpsForZone(
  user: number,
  asset: number,
  input: unknown,
) {
  const a = await ownedAsset(user, asset, "cloudflare"),
    p = listInput.parse(input);
  const sql = `SELECT b.ip_address,b.reason,'Click Guard' source FROM blocked_ips b JOIN tracked_domains d ON d.id=b.domain_id
    WHERE d.user_id=$1 AND b.is_active AND lower(regexp_replace(split_part(regexp_replace(d.domain,'^https?://','','i'),'/',1),'^www\\.','','i'))=$2
    UNION ALL SELECT v.ip_address,v.detection_method reason,'VPN Shield' source FROM vpn_visits v JOIN tracked_domains d ON d.id=v.domain_id
    WHERE d.user_id=$1 AND v.action='blocked' AND lower(regexp_replace(split_part(regexp_replace(d.domain,'^https?://','','i'),'/',1),'^www\\.','','i'))=$2`;
  const args = [user, a.domain, `%${p.q}%`];
  const { rows } = await pool.query(
    `SELECT DISTINCT * FROM (${sql}) f WHERE ip_address ILIKE $3 ORDER BY ip_address,source,reason LIMIT $4 OFFSET $5`,
    [...args, p.limit, (p.page - 1) * p.limit],
  );
  const {
    rows: [n],
  } = await pool.query(
    `SELECT count(*)::int total FROM (SELECT DISTINCT * FROM (${sql}) f WHERE ip_address ILIKE $3) s`,
    args,
  );
  return { items: rows, total: n.total };
}
