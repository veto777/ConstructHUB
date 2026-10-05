/**
 * Add every city in server/data/all-cities.json that has no directory row at all (2026-10-04: 2,884 incorporated
 * places from the Census Bureau's 2023 city and town population estimates were missing — Miramar FL, Lakewood CO,
 * West Valley City UT, Bloomington MN… — found by the round-2 portal research). The boot seeder only fills an empty
 * directory, so an existing database gets them here. Same row shape as server/seed-all-cities.ts: the place's own
 * name, its county resolved by name (never guessed — an unmatched county is skipped), no portal, link status "none".
 * Only jurisdictions with NO row in the directory are inserted, so a row removed on purpose never comes back.
 *
 * Run: npx tsx scripts/add-missing-cities.ts [--dry-run]   (needs DATABASE_URL)
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
import { buildCountyIndex, resolveCountyId } from "../server/city-county-resolver";

type City = { city: string; county: string; stateCode: string };
const dry = process.argv.includes("--dry-run");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // CITIES_JSON: the built copy on a server (dist/data/all-cities.json); default the source file.
  const cities: City[] = JSON.parse(readFileSync(process.env.CITIES_JSON || join(process.cwd(), "server", "data", "all-cities.json"), "utf8"));
  const { rows: counties } = await pool.query("SELECT id, name, state_code AS \"stateCode\" FROM counties");
  const index = buildCountyIndex(counties);
  const { rows: existing } = await pool.query("SELECT DISTINCT jurisdiction FROM permit_databases WHERE jurisdiction_type = 'city'");
  const have = new Set(existing.map((r) => String(r.jurisdiction)));
  const toAdd: { jurisdiction: string; countyId: number }[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const c of cities) {
    const jurisdiction = `${c.city}, ${c.stateCode}`;
    if (have.has(jurisdiction) || seen.has(jurisdiction)) continue;
    const countyId = resolveCountyId(index, c.county, c.stateCode);
    if (countyId === null) { unmatched.push(`${jurisdiction} (${c.county})`); continue; }
    seen.add(jurisdiction);
    toAdd.push({ jurisdiction, countyId });
  }
  console.log(`${toAdd.length} cities to add; ${unmatched.length} skipped (county not found): ${unmatched.slice(0, 8).join("; ")}`);
  if (!dry && toAdd.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of toAdd) {
        await client.query(
          `INSERT INTO permit_databases (name, jurisdiction, jurisdiction_type, county_id, is_active, link_status)
           VALUES ($1, $1, 'city', $2, false, 'none')`, [r.jurisdiction, r.countyId]);
      }
      await client.query("COMMIT");
      console.log(`added ${toAdd.length}`);
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
