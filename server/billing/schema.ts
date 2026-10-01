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

/**
 * The account billing ledger (server/billing/ledger.ts): processed Stripe
 * event ids, invoices and one-time purchases. Exactly the shapes the account
 * foundation's ensureAccountSchema() creates — CREATE ... IF NOT EXISTS, so
 * whichever runs first the other is a no-op. Every INSERT names its columns.
 */
export const BILLING_LEDGER_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS billing_events (
     stripe_event_id text PRIMARY KEY,
     type text,
     user_id integer,
     received_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS billing_invoices (
     id text PRIMARY KEY,
     user_id integer,
     number text,
     status text,
     amount_paid integer,
     amount_due integer,
     currency text,
     period_start timestamptz,
     period_end timestamptz,
     description text,
     hosted_invoice_url text,
     invoice_pdf text,
     created timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS billing_invoices_user_created_idx ON billing_invoices(user_id, created DESC)`,
  `CREATE TABLE IF NOT EXISTS billing_purchases (
     id text PRIMARY KEY,
     user_id integer,
     kind text,
     description text,
     amount integer,
     currency text,
     created timestamptz,
     receipt_url text
   )`,
  `CREATE INDEX IF NOT EXISTS billing_purchases_user_created_idx ON billing_purchases(user_id, created DESC)`,
];

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
