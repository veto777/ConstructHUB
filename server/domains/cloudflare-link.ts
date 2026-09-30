import { pool } from "../db";

export interface CloudflareZoneLink {
  zoneNameservers(domain: string): Promise<string[] | null>;
}

/** Nameservers Cloudflare assigned to this owner's zone, from the last zone discovery (no network call). */
export const cloudflareZoneLinkFor = (userId: number): CloudflareZoneLink => ({
  async zoneNameservers(domain: string) {
    const { rows: [a] } = await pool.query(
      `SELECT data->'nameServers' ns FROM edge_assets
       WHERE user_id=$1 AND provider='cloudflare' AND lower(domain)=lower($2) ORDER BY synced_at DESC NULLS LAST, id DESC LIMIT 1`,
      [userId, domain]);
    const ns = Array.isArray(a?.ns) ? a.ns.filter((n: unknown) => typeof n === "string") : [];
    return ns.length ? ns : null;
  },
});

/** Fallback when Cloudflare is not connected. */
export const cloudflareZoneLink: CloudflareZoneLink = {
  async zoneNameservers() {
    return null;
  },
};
