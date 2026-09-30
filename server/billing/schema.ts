/**
 * Idempotent ALTERs for the plan-billing columns on `subscriptions`.
 *
 *   billing_interval, addons, agency_locations — in shared/schema.ts (drizzle).
 *   cancel_at_period_end, cancel_at — NOT in the drizzle schema: read and
 *     written only with plain SQL by ./sync (recordCancellation /
 *     cancellationFor), so drizzle selects never depend on them.
 *
 * Additive only: no row rewritten. `addons` gets a constant default, so
 * existing rows read '{}' without an UPDATE; cancel_at_period_end stays NULL
 * ("not synced from Stripe yet") until the next webhook or plan change.
 *
 * The drizzle columns must exist before anything selects `subscriptions`
 * through drizzle (the select lists every schema column), so this runs at boot
 * (server/index.ts awaits it before routes register) and from
 * scripts/apply-schema-migration.ts. No imports on purpose — the migration
 * script uses the statements with its own pg pool.
 */
export const BILLING_SUBSCRIPTION_DDL: readonly string[] = [
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval text`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS agency_locations integer`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at timestamp`,
];

export const BILLING_COLUMNS: readonly string[] = ["billing_interval", "addons", "agency_locations", "cancel_at_period_end", "cancel_at"];

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Adds any missing billing column. When all of them already exist it only
 * reads the catalog, so a routine boot takes no table lock on `subscriptions`.
 */
export async function ensureBillingSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = ANY($1)`,
    [BILLING_COLUMNS]);
  if (rows.length === BILLING_COLUMNS.length) return;
  for (const statement of BILLING_SUBSCRIPTION_DDL) await q.query(statement);
}
