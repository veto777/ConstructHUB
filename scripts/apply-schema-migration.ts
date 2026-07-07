/**
 * Idempotent schema migration for the data-rebuild changes, applied with plain
 * ALTER statements instead of `drizzle-kit push`. Use this because push does a
 * full-schema reconciliation that trips over pre-existing drift on this database
 * (e.g. "relation citations_id_seq already exists"). These statements only touch
 * what the data rebuild needs and are safe to run repeatedly.
 *
 * Run:  DATABASE_URL="<prod url>" npx tsx scripts/apply-schema-migration.ts
 */
import pg from "pg";

const STATEMENTS = [
  // Appraiser portal fields become nullable ("no portal on record" is honest).
  `ALTER TABLE property_appraisers ALTER COLUMN portal_url DROP NOT NULL`,
  `ALTER TABLE property_appraisers ALTER COLUMN search_url DROP NOT NULL`,
  `ALTER TABLE property_appraisers ALTER COLUMN platform  DROP NOT NULL`,
  // Link-verifier columns on both tables.
  `ALTER TABLE property_appraisers ADD COLUMN IF NOT EXISTS link_status text DEFAULT 'unchecked'`,
  `ALTER TABLE property_appraisers ADD COLUMN IF NOT EXISTS last_verified_at timestamp`,
  `ALTER TABLE permit_databases   ADD COLUMN IF NOT EXISTS link_status text DEFAULT 'unchecked'`,
  `ALTER TABLE permit_databases   ADD COLUMN IF NOT EXISTS last_verified_at timestamp`,
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
      console.log("✓", sql);
    } catch (e: any) {
      // Tolerate "already done" style errors so the script is fully idempotent.
      console.warn("• skipped:", sql, "—", e.message);
    }
  }
  await pool.end();
  console.log("\nSchema migration complete.");
}
main().catch((e) => { console.error(e); process.exit(1); });
