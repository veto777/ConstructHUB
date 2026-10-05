/**
 * One-time, idempotent fixes to the permit directory found by the audit (lane 6, 2026-10-04). Safe to re-run.
 *   - "88, KY" is the community of Eighty Eight, Kentucky (Barren County) — the name, not a garbage row.
 *   - "Do̱a Ana" (a mangled ñ) is Doña Ana County, NM; the county also existed a second time as "Dona Ana": the two
 *     merge into one "Doña Ana" county.
 *   - "Saint George, UT" duplicated "St. George, UT" (Washington County); a stray "Duluth, GA" sat in Fulton County
 *     (Duluth is Gwinnett's). The duplicates go; anything pointing at them moves to the row that stays.
 * The seed files carry the same corrections (server/data/all-cities.json, server/seed-all-counties.ts,
 * server/data/permit-portals.json), so a boot never re-adds them.
 * Run: npx tsx scripts/fix-directory-names.ts [--dry-run]   (needs DATABASE_URL)
 */
import pg from "pg";

const dry = process.argv.includes("--dry-run");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  const log: string[] = [];
  const run = async (label: string, sql: string, values: unknown[] = []) => {
    const r = await c.query(sql, values);
    if (r.rowCount) log.push(`${label}: ${r.rowCount}`);
    return r;
  };
  try {
    await c.query("BEGIN");
    // Doña Ana: keep the "Dona Ana" county (the cities hang off it), rename it, fold the mangled one into it.
    const { rows: [keep] } = await c.query("SELECT id FROM counties WHERE state_code = 'NM' AND name IN ('Dona Ana', 'Doña Ana') ORDER BY id LIMIT 1");
    const { rows: mangled } = await c.query("SELECT id FROM counties WHERE state_code = 'NM' AND name LIKE 'Do%Ana' AND name NOT IN ('Dona Ana', 'Doña Ana')");
    if (keep) {
      for (const m of mangled) {
        for (const t of ["permit_databases", "property_appraisers", "property_records", "search_queries"]) {
          await run(`${t} county ${m.id}→${keep.id}`, `UPDATE ${t} SET county_id = $1 WHERE county_id = $2`, [keep.id, m.id]);
        }
        await run(`counties delete ${m.id}`, "DELETE FROM counties WHERE id = $1", [m.id]);
      }
      await run("county name Doña Ana", "UPDATE counties SET name = 'Doña Ana' WHERE id = $1 AND name <> 'Doña Ana'", [keep.id]);
    }
    await run("Doña Ana County row", `UPDATE permit_databases SET name = 'Doña Ana County, NM', jurisdiction = 'Doña Ana County, NM'
      WHERE jurisdiction LIKE 'Do%Ana County, NM' AND jurisdiction <> 'Doña Ana County, NM'`);
    await run("Eighty Eight, KY", "UPDATE permit_databases SET name = 'Eighty Eight, KY', jurisdiction = 'Eighty Eight, KY' WHERE jurisdiction = '88, KY'");
    // Duplicates: repoint references to the surviving row, then delete.
    const dupes: [string, string, string][] = [
      ["Saint George, UT", "St. George, UT", "Washington"],
      ["Duluth, GA", "Duluth, GA", "Gwinnett"],
    ];
    for (const [dupJur, keepJur, keepCounty] of dupes) {
      const { rows: [k] } = await c.query(
        `SELECT p.id FROM permit_databases p JOIN counties co ON co.id = p.county_id WHERE p.jurisdiction = $1 AND co.name = $2 ORDER BY p.id LIMIT 1`, [keepJur, keepCounty]);
      if (!k) continue;
      const { rows: gone } = await c.query(
        `SELECT p.id FROM permit_databases p JOIN counties co ON co.id = p.county_id WHERE p.jurisdiction = $1 AND p.id <> $2
           AND (p.jurisdiction <> $3 OR co.name <> $4)`, [dupJur, k.id, keepJur, keepCounty]);
      for (const g of gone) {
        for (const t of ["search_results", "scrape_schedules"]) {
          await run(`${t} ${g.id}→${k.id}`, `UPDATE ${t} SET database_id = $1 WHERE database_id = $2`, [k.id, g.id]);
        }
        await run(`delete ${dupJur} #${g.id}`, "DELETE FROM permit_databases WHERE id = $1", [g.id]);
      }
    }
    await c.query(dry ? "ROLLBACK" : "COMMIT");
    console.log((dry ? "[dry run] " : "") + (log.length ? log.join("\n") : "nothing to fix"));
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
