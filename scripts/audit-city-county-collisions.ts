/**
 * Enumerate every city that shares its name with a county of the same state, and report what the old CRM permit
 * matcher (substring) returned, what the fixed one returns, and what the routing data says. Read-only.
 *
 *   npx tsx scripts/audit-city-county-collisions.ts            # from server/data/*.json (no database)
 *   npx tsx --env-file=.env scripts/audit-city-county-collisions.ts --db   # over the directory in DATABASE_URL (dev only)
 *   … --out report.json   writes the full case list; … --all   prints every case, not only the wrong ones
 */
import { writeFileSync } from "fs";
import { enumerateCollisions, seedDirectoryRows, summariseExposure, suspectRoutes } from "../server/permit-collision-audit";
import type { DirectoryRow } from "../server/permit-jurisdiction";

async function dbRows(): Promise<DirectoryRow[]> {
  const url = process.env.DATABASE_URL || "";
  if (/:5433\b/.test(url)) throw new Error("Refusing to run against port 5433 (production).");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(`SELECT p.id, p.name, p.jurisdiction, p.jurisdiction_type AS "jurisdictionType",
      p.county_id AS "countyId", c.name AS "countyName", c.state_code AS "countyStateCode", p.portal_url AS "portalUrl",
      p.search_url AS "searchUrl", p.is_active AS "isActive", p.link_status AS "linkStatus", p.issued_by AS "issuedBy",
      p.issued_by_source AS "issuedBySource"
      FROM permit_databases p LEFT JOIN counties c ON c.id = p.county_id`);
    return rows;
  } finally { await pool.end(); }
}

async function main() {
  const args = process.argv.slice(2);
  const rows = args.includes("--db") ? await dbRows() : seedDirectoryRows();
  const cases = enumerateCollisions(rows);
  const wrongBefore = cases.filter((c) => c.wrongBefore);
  const show = args.includes("--all") ? cases : wrongBefore;
  for (const c of show) {
    console.log(`${c.city}, ${c.stateCode} | on record in: ${c.actualCounties.join("/") || "?"} | routing: ${c.routedTo ?? "-"} | before: ${c.legacy.join("; ") || "-"} | now [${c.now.basis}]: ${c.now.offices.join("; ") || "-"}`);
  }
  const summary = {
    source: args.includes("--db") ? "database" : "server/data/*.json",
    sameNameCollisions: cases.length,
    cityIsInThatCounty: cases.filter((c) => c.inSameNameCounty).length,
    cityIsNotInThatCounty: cases.filter((c) => !c.inSameNameCounty).length,
    oldMatcherReturnedTheWrongSameNameCounty: wrongBefore.length,
    newMatcherReturnsTheWrongSameNameCounty: cases.filter((c) => c.wrongNow).length,
    wholeSubstringClass: summariseExposure(rows),
    routesToASameOrOtherCountyTheCityDataDisagreesWith: suspectRoutes(rows).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  const out = args.indexOf("--out");
  if (out >= 0 && args[out + 1]) writeFileSync(args[out + 1], JSON.stringify({ summary, cases, suspectRoutes: suspectRoutes(rows) }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
