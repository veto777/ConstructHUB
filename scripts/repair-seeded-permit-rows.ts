/**
 * Repair permit_databases rows written by the old city/county seeders:
 *  - city rows filed under the old Replit county ids move to the county that
 *    server/data/all-cities.json names (by county name + state, never guessed);
 *  - seeded copies that then duplicate a row for the same jurisdiction + county go;
 *  - templated placeholders ("City of …", "Contact … Building Department …",
 *    searchable "address", Active with no portal) become honest nulls.
 * Idempotent. Dry run by default; pass --apply to write.
 *
 * Run:  DATABASE_URL="<url>" npx tsx scripts/repair-seeded-permit-rows.ts [--apply]
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const { repairSeededPermitRows } = await import("../server/seed-all-cities");
const { pool } = await import("../server/db");

const apply = process.argv.includes("--apply");
try {
  const report = await repairSeededPermitRows({ dryRun: !apply });
  console.log(JSON.stringify({ applied: apply, ...report }, null, 2));
  if (!apply) console.log("Dry run only — re-run with --apply to write these changes.");
} finally {
  await pool.end();
}
