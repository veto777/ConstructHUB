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
  // When the Stripe subscription began (Stripe `start_date`); plain-SQL like
  // the cancel columns, written by ./sync recordCancellation.
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date timestamp`,
];

export const BILLING_COLUMNS: readonly string[] = ["billing_interval", "addons", "agency_locations", "cancel_at_period_end", "cancel_at", "start_date"];

/**
 * The account billing ledger (server/billing/ledger.ts): processed Stripe
 * event ids, invoices and one-time purchases. ONE definition — the account
 * schema's (server/account/schema.ts) — re-exported here for the webhook's
 * boot path; whichever ensure* runs first, the other is a no-op.
 */
export { BILLING_LEDGER_DDL } from "../account/schema";
import { BILLING_LEDGER_DDL } from "../account/schema";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export const BILLING_LEDGER_TABLES: readonly string[] = ["billing_events", "billing_invoices", "billing_purchases"];

/**
 * The ledger tables, idempotently (see BILLING_LEDGER_DDL). When all three
 * exist it only reads the catalog; otherwise every statement runs (each is
 * IF NOT EXISTS, so a partial set is completed, never duplicated).
 */
export async function ensureBillingLedgerSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [BILLING_LEDGER_TABLES]);
  if (rows.length === BILLING_LEDGER_TABLES.length) return;
  for (const statement of BILLING_LEDGER_DDL) await q.query(statement);
}

/**
 * Adds any missing billing column. When all of them already exist it only
 * reads the catalog, so a routine boot takes no table lock on `subscriptions`.
 * The ledger tables are checked the same way (two catalog reads, no DDL,
 * once everything exists).
 */
export async function ensureBillingSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = ANY($1)`,
    [BILLING_COLUMNS]);
  if (rows.length !== BILLING_COLUMNS.length) {
    for (const statement of BILLING_SUBSCRIPTION_DDL) await q.query(statement);
  }
  await ensureBillingLedgerSchema(q);
}
