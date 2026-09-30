/**
 * Idempotent schema migration for the data-rebuild changes, applied with plain
 * ALTER statements instead of `drizzle-kit push`. Use this because push does a
 * full-schema reconciliation that trips over pre-existing drift on this database
 * (e.g. "relation citations_id_seq already exists"). These statements only touch
 * what the data rebuild needs and are safe to run repeatedly.
 *
 * Nothing here rewrites or renumbers existing rows: columns are added, NOT NULL
 * constraints relaxed, unique indexes added only where the data already
 * satisfies them, and the database's default time zone pinned for NEW sessions.
 *
 * Run:  DATABASE_URL="<prod url>" npx tsx scripts/apply-schema-migration.ts
 */
import pg from "pg";
import { STATE_GUIDES_LINK_STATUS_DDL } from "../server/state-guides-schema";
import { ensureDocNumberUniqueIndexes } from "../server/crm/doc-number";

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
  // State guides: per-agency link status + last-checked date; sos_url nullable.
  ...STATE_GUIDES_LINK_STATUS_DDL,
];

const UTC_NAMES = /^(UTC|Etc\/UTC|UCT|Etc\/UCT|GMT|Etc\/GMT|Zulu|Etc\/Zulu|Universal|Etc\/Universal)$/i;

/**
 * Every `timestamp` (without time zone) column holds UTC wall time. The app's
 * pool pins its sessions to UTC (server/db.ts); this makes UTC the database
 * default too, so psql, scripts and test fixtures that open their own
 * connections write now() on the same clock. It only changes what NEW
 * sessions default to — no row is touched. If the default was another zone,
 * rows that defaultNow() filled under it keep that zone's wall time; any
 * correction is a per-column owner decision and is NOT done here.
 */
async function pinDatabaseTimeZone(pool: pg.Pool): Promise<void> {
  const { rows: [{ tz }] } = await pool.query(`SELECT current_setting('TimeZone') AS tz`);
  if (UTC_NAMES.test(tz)) {
    console.log(`✓ database default TimeZone is already ${tz}`);
    return;
  }
  try {
    await pool.query(
      `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'UTC'); END $$`);
  } catch (e: any) {
    console.warn(`• skipped: ALTER DATABASE … SET timezone = 'UTC' (default is ${tz}) —`, e.message,
      "\n  Run it as the database owner, or keep relying on the per-session pin in server/db.ts.");
    return;
  }
  const check = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await check.connect();
  const { rows: [{ tz: now }] } = await check.query(`SELECT current_setting('TimeZone') AS tz`);
  await check.end();
  console.log(`✓ database default TimeZone ${tz} → UTC for new sessions (a new session now reports ${now})`);
  if (!UTC_NAMES.test(now)) {
    console.warn(`  ! a role-level setting still wins (${now}); check ALTER ROLE … SET timezone for this user.`);
  }
  console.warn(`  ! rows that defaultNow() wrote while the default was ${tz} keep ${tz} wall time; ` +
    "nothing was rewritten — correcting them is a per-column owner decision.");
}

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
  // CRM document numbers: UNIQUE (org_id, number) wherever no number repeats
  // yet. A table that still has repeats is skipped with the repeats named —
  // existing customer documents are never renumbered here.
  await ensureDocNumberUniqueIndexes(pool, undefined, (line) => console.log(`${line.endsWith(" added") ? "✓" : "•"} ${line}`));
  await pinDatabaseTimeZone(pool);
  await pool.end();
  console.log("\nSchema migration complete.");
}
main().catch((e) => { console.error(e); process.exit(1); });
