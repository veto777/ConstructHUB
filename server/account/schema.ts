/**
 * Account tables: Stripe event receipts, invoice and one-time purchase
 * mirrors, the transactional-email log and the public-API keys + metering.
 *
 * THE one definition of these tables. server/billing/schema.ts (the webhook's
 * ledger), server/account/billing-routes.ts and server/account/billing-emails.ts
 * import the slices below rather than carrying their own copies, so there is
 * exactly one DDL, one set of index names, and nothing to drift.
 *
 * Idempotent DDL (CREATE … IF NOT EXISTS only; no row is ever rewritten), run
 * at boot by server/routes.ts and by scripts/apply-schema-migration.ts. No
 * imports on purpose: the migration script uses the statements with its own
 * pg pool. The drizzle definitions live in shared/schema.ts.
 */

/** The billing ledger: processed Stripe event ids, invoices, one-time purchases. */
export const BILLING_LEDGER_DDL: readonly string[] = [
  // Every Stripe event the platform webhook accepted, so a redelivered event
  // is processed once (recordBillingEvent in server/billing/ledger.ts).
  `CREATE TABLE IF NOT EXISTS billing_events (
     stripe_event_id text PRIMARY KEY,
     type text,
     user_id integer,
     received_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS billing_events_user_idx ON billing_events(user_id, received_at DESC)`,
  // Mirror of the account's Stripe invoices (subscriptions): what Billing →
  // Invoices lists and what the invoice email links to.
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
  `CREATE INDEX IF NOT EXISTS billing_invoices_user_idx ON billing_invoices(user_id, created DESC)`,
  // One-time purchases (courses, services, reinstatement) with their receipts.
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
  `CREATE INDEX IF NOT EXISTS billing_purchases_user_idx ON billing_purchases(user_id, created DESC)`,
  // Duplicate indexes on the same columns under the names earlier builds used
  // (one definition now); dropping an index that is not there is a no-op.
  `DROP INDEX IF EXISTS billing_invoices_user_created`,
  `DROP INDEX IF EXISTS billing_invoices_user_created_idx`,
  `DROP INDEX IF EXISTS billing_purchases_user_created`,
  `DROP INDEX IF EXISTS billing_purchases_user_created_idx`,
];

/** Every transactional email sent, keyed so a retried webhook or a double click never sends the same document twice. */
export const EMAIL_LOG_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS email_log (
     id bigserial PRIMARY KEY,
     user_id integer,
     kind text,
     dedupe_key text UNIQUE,
     sent_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS email_log_user_idx ON email_log(user_id, sent_at DESC)`,
];

/** Public API keys (only a hash of the secret is stored) and their metering, one row per key per UTC day. */
export const API_KEYS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS account_api_keys (
     id text PRIMARY KEY,
     user_id integer NOT NULL,
     name text NOT NULL,
     prefix text NOT NULL,
     suffix text NOT NULL,
     secret_hash text NOT NULL,
     scopes text[] NOT NULL DEFAULT '{read}',
     monthly_unit_limit integer,
     expires_at timestamptz,
     last_used_at timestamptz,
     revoked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS account_api_keys_user_idx ON account_api_keys(user_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_api_keys_prefix_idx ON account_api_keys(prefix)`,
  `CREATE TABLE IF NOT EXISTS account_api_usage (
     key_id text NOT NULL,
     user_id integer NOT NULL,
     day date NOT NULL,
     units integer NOT NULL DEFAULT 0,
     requests integer NOT NULL DEFAULT 0,
     PRIMARY KEY (key_id, day)
   )`,
  `CREATE INDEX IF NOT EXISTS account_api_usage_user_idx ON account_api_usage(user_id, day)`,
];

export const ACCOUNT_SCHEMA_DDL: readonly string[] = [
  ...BILLING_LEDGER_DDL,
  ...EMAIL_LOG_DDL,
  ...API_KEYS_DDL,
  // A table created from the bare contract shape (no defaults) converges on
  // the same defaults; SET DEFAULT is idempotent and touches no row.
  `ALTER TABLE billing_events ALTER COLUMN received_at SET DEFAULT now()`,
  `ALTER TABLE email_log ALTER COLUMN sent_at SET DEFAULT now()`,
  `ALTER TABLE account_api_keys ALTER COLUMN created_at SET DEFAULT now()`,
  `ALTER TABLE account_api_keys ALTER COLUMN scopes SET DEFAULT '{read}'`,
  `ALTER TABLE account_api_usage ALTER COLUMN units SET DEFAULT 0`,
  `ALTER TABLE account_api_usage ALTER COLUMN requests SET DEFAULT 0`,
  // API-created Google posts carry their origin (server/public-api/resources/gbp-write.ts).
  `ALTER TABLE IF EXISTS gbp_content_jobs ADD COLUMN IF NOT EXISTS source text`,
];

export const ACCOUNT_TABLES: readonly string[] = [
  "billing_events", "billing_invoices", "billing_purchases", "email_log", "account_api_keys", "account_api_usage",
];

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Creates whatever is missing; safe to run on every boot and repeatedly. */
export async function ensureAccountSchema(q?: Queryable): Promise<void> {
  const client = q ?? (await import("../db")).pool;
  for (const statement of ACCOUNT_SCHEMA_DDL) await client.query(statement);
}
