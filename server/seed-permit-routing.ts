/**
 * "Building permits for <place> are issued by <county or town>" (2026-10-05 round 4; towns/townships as issuers added
 * 2026-10-07 from the fact-check). For places with no permit office of their own, server/data/permit-routing.json names
 * the county (or the town/township that contains them) that issues their building permits, with the official
 * page that says so and a quote from it (each checked by scripts' check-routing.py: the page loads and contains the
 * quote, and names the town or the county). Applied at boot after the portals; a place no longer listed is cleared.
 * County rows can be routed too (a consolidated city-county such as Philadelphia County -> Philadelphia).
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
    // One statement for all routes (8,000+ since 2026-10-07): a per-row loop took a minute at boot.
    const u = await c.query(`UPDATE permit_databases p SET issued_by=r.issued_by, issued_by_source=r.source, issued_by_quote=r.quote
      FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS r(jurisdiction, issued_by, source, quote)
      WHERE p.jurisdiction = r.jurisdiction
        AND (p.issued_by IS DISTINCT FROM r.issued_by OR p.issued_by_source IS DISTINCT FROM r.source OR p.issued_by_quote IS DISTINCT FROM r.quote)`,
      [routes.map((x) => x.jurisdiction), routes.map((x) => x.issuedBy), routes.map((x) => x.sourceUrl), routes.map((x) => x.quote)]);
    set = u.rowCount ?? 0;
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  return { set, cleared };
}
