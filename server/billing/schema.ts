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

/**
 * Add-on introductory prices (server/billing/intro.ts): one row per account and
 * add-on whose intro coupon was attached — the "once per customer" record.
 * `ref` is the Stripe object it went on: a Checkout Session (cs_…, counts only
 * once that session completed) or a subscription (sub_…, counts at once).
 * Mirrored by `billingAddonIntros` in shared/schema.ts.
 */
export const BILLING_INTRO_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS billing_addon_intros (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     addon text NOT NULL,
     coupon_id text NOT NULL,
     ref text NOT NULL,
     created_at timestamp NOT NULL DEFAULT now(),
     UNIQUE (user_id, addon)
   )`,
];

/**
 * One-time purchase fulfilment (./fulfilment.ts) writes course_purchases /
 * service_purchases ON CONFLICT DO NOTHING against these: one row per Checkout
 * Session and item, whichever Stripe event carried it (completed,
 * async_payment_succeeded, a redelivery under a new event id). The tables are
 * drizzle's (shared/schema.ts, which declares the same indexes — keep the two
 * identical); the indexes are added here because this project applies schema
 * changes with idempotent statements, never drizzle-kit push. Partial
 * (stripe_session_id IS NOT NULL): a row granted by hand carries no session
 * and is not deduplicated.
 */
export const FULFILMENT_DDL: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS course_purchases_session_item_idx
     ON course_purchases (stripe_session_id, (COALESCE(module_id, 0)), (COALESCE(is_bundle, false)))
     WHERE stripe_session_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS service_purchases_session_item_idx
     ON service_purchases (stripe_session_id, service_type)
     WHERE stripe_session_id IS NOT NULL`,
];

export const FULFILMENT_INDEXES: readonly string[] = ["course_purchases_session_item_idx", "service_purchases_session_item_idx"];

/**
 * The fulfilment indexes, idempotently: a catalog read when both exist, else
 * the CREATE … IF NOT EXISTS statements. A table that already holds two rows
 * for one (session, item) makes the CREATE fail — that is reported with the
 * index name and the cause, never worked around by dropping the uniqueness.
 */
export async function ensureFulfilmentSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1)`,
    [FULFILMENT_INDEXES]);
  if (rows.length === FULFILMENT_INDEXES.length) return;
  for (const statement of FULFILMENT_DDL) {
    try {
      await q.query(statement);
    } catch (e: any) {
      const name = FULFILMENT_INDEXES.find((n) => statement.includes(n)) ?? "fulfilment index";
      throw new Error(`${name} could not be created (${e?.message || e}); purchase rows already duplicated for one checkout session must be resolved first`);
    }
  }
}

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
 * The ledger tables and the fulfilment indexes are checked the same way
 * (three catalog reads, no DDL, once everything exists).
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
  await ensureFulfilmentSchema(q);
  await ensureBillingIntroSchema(q);
}

/** The intro ledger table: a catalog read on a routine boot, the CREATE only when it is missing. */
export async function ensureBillingIntroSchema(q: Queryable): Promise<void> {
  const { rows } = await q.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'billing_addon_intros'`);
  if (rows.length) return;
  for (const statement of BILLING_INTRO_DDL) await q.query(statement);
}
