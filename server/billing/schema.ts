/**
 * Idempotent ALTERs for the plan-billing columns on `subscriptions`
 * (shared/schema.ts: billing_interval, addons, agency_locations).
 *
 * Additive only: three columns, no row rewritten. `addons` gets a constant
 * default, so existing rows read '{}' without an UPDATE.
 *
 * The columns must exist before anything selects `subscriptions` through
 * drizzle (the select lists every schema column), so this runs at boot and from
 * scripts/apply-schema-migration.ts. No imports on purpose — the migration
 * script uses the statements with its own pg pool.
 */
export const BILLING_SUBSCRIPTION_DDL: readonly string[] = [
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval text`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS agency_locations integer`,
];

const COLUMNS = ["billing_interval", "addons", "agency_locations"];

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Adds any missing billing column. When all three already exist it only reads
 * the catalog, so a routine boot takes no table lock on `subscriptions`.
 */
export async function ensureBillingSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = ANY($1)`,
    [COLUMNS]);
  if (rows.length === COLUMNS.length) return;
  for (const statement of BILLING_SUBSCRIPTION_DDL) await q.query(statement);
}
