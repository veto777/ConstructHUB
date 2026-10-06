/**
 * "Building permits for <town> are issued by <county>" (2026-10-05, round 4). For towns with no permit office of
 * their own, server/data/permit-routing.json names the county that issues their building permits, with the official
 * page that says so and a quote from it (each checked by scripts' check-routing.py: the page loads and contains the
 * quote, and names the town or the county). Applied at boot after the portals; a town no longer listed is cleared.
 * The directory then links the county's own portal for that town — never a guessed or borrowed URL.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "./db";

type Route = { jurisdiction: string; issuedBy: string; sourceUrl: string; quote: string };

export const ROUTING_DDL = `ALTER TABLE permit_databases ADD COLUMN IF NOT EXISTS issued_by text,
  ADD COLUMN IF NOT EXISTS issued_by_source text, ADD COLUMN IF NOT EXISTS issued_by_quote text`;

export async function seedPermitRouting(): Promise<{ set: number; cleared: number }> {
  await pool.query(ROUTING_DDL);
  const routes: Route[] = JSON.parse(readFileSync(join(import.meta.dirname || __dirname, "data", "permit-routing.json"), "utf8"));
  const c = await pool.connect();
  let set = 0, cleared = 0;
  try {
    await c.query("BEGIN");
    const r = await c.query(`UPDATE permit_databases SET issued_by=NULL, issued_by_source=NULL, issued_by_quote=NULL
      WHERE issued_by IS NOT NULL AND NOT (jurisdiction = ANY($1::text[]))`, [routes.map((x) => x.jurisdiction)]);
    cleared = r.rowCount ?? 0;
    for (const x of routes) {
      const u = await c.query(`UPDATE permit_databases SET issued_by=$2, issued_by_source=$3, issued_by_quote=$4
        WHERE jurisdiction=$1 AND jurisdiction_type='city'
          AND (issued_by IS DISTINCT FROM $2 OR issued_by_source IS DISTINCT FROM $3 OR issued_by_quote IS DISTINCT FROM $4)`,
        [x.jurisdiction, x.issuedBy, x.sourceUrl, x.quote]);
      set += u.rowCount ?? 0;
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  return { set, cleared };
}
