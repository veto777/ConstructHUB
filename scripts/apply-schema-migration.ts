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
 *
 * The check reads where this session's zone came from (pg_settings.source).
 * A client override — PGOPTIONS="-c TimeZone=UTC" in the calling shell, as
 * the test recipe uses — or a SET is not the database default, so it is never
 * reported as one; the idempotent ALTER runs instead, and the result is read
 * back from the catalog, which a client override cannot mask.
 */
async function pinDatabaseTimeZone(pool: pg.Pool): Promise<void> {
  const { rows: [{ tz, source }] } = await pool.query(
    `SELECT setting AS tz, source FROM pg_settings WHERE name = 'TimeZone'`);
  const overridden = source === "client" || source === "session";
  if (UTC_NAMES.test(tz) && !overridden) {
    console.log(`✓ database default TimeZone is already ${tz} (source: ${source})`);
    return;
  }
  const was = overridden ? "the previous default" : tz;
  if (overridden) {
    console.log(`• this session's TimeZone ${tz} is a client override (PGOPTIONS?), not the database default — pinning UTC explicitly`);
  }
  try {
    await pool.query(
      `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'UTC'); END $$`);
  } catch (e: any) {
    console.warn(`• skipped: ALTER DATABASE … SET timezone = 'UTC' (default is ${was}) —`, e.message,
      "\n  Run it as the database owner, or keep relying on the per-session pin in server/db.ts.");
    return;
  }
  const { rows: [{ pinned, roleTz }] } = await pool.query(`
    SELECT EXISTS (SELECT 1 FROM pg_db_role_setting s
                    WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
                      AND s.setrole = 0 AND 'TimeZone=UTC' = ANY (s.setconfig)) AS pinned,
           (SELECT substring(c FROM '^TimeZone=(.*)$')
              FROM pg_db_role_setting s, unnest(s.setconfig) AS c
             WHERE s.setrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
               AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
               AND c LIKE 'TimeZone=%'
             ORDER BY s.setdatabase DESC LIMIT 1) AS "roleTz"`);
  if (!pinned) {
    console.warn("• ALTER DATABASE ran, but pg_db_role_setting shows no database-level TimeZone=UTC; check it by hand.");
    return;
  }
  console.log(`✓ database default TimeZone ${was} → UTC for new sessions`);
  if (roleTz && !UTC_NAMES.test(roleTz)) {
    console.warn(`  ! a role-level setting still wins for this user (TimeZone=${roleTz}); check ALTER ROLE … SET timezone.`);
  }
  console.warn(`  ! rows that defaultNow() wrote under ${was} keep that zone's wall time; ` +
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
