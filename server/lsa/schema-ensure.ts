import { pool } from "../db";

// Idempotent schema setup for the LSA feature. Run on boot instead of db:push so
// the tables/columns/indexes exist without a migration step. Every statement is
// "IF NOT EXISTS" so re-running is harmless and safe across restarts.
export async function ensureLsaSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lsa_connections (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id integer NOT NULL,
      refresh_token text,
      login_customer_id text,
      connected_email text,
      telegram_username text,
      telegram_chat_id text,
      telegram_link_token text,
      last_sync_at timestamp,
      last_sync_error text,
      last_sync_count integer DEFAULT 0,
      last_cost_total numeric(12,2),
      last_discovery_at timestamp,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lsa_accounts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id integer NOT NULL,
      connection_id varchar NOT NULL,
      customer_id text NOT NULL,
      login_customer_id text,
      descriptive_name text,
      is_manager boolean DEFAULT false,
      lsa_enrolled boolean,
      enabled boolean NOT NULL DEFAULT true,
      sync_cursor timestamp,
      last_error text,
      last_sync_at timestamp,
      lead_count integer DEFAULT 0,
      charged_count integer DEFAULT 0,
      disputed_count integer DEFAULT 0,
      cost_total numeric(12,2),
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lsa_leads (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id integer,
      lead_id text NOT NULL,
      customer_id text,
      lead_type text,
      category_id text,
      service_id text,
      contact_name text,
      contact_phone text,
      contact_email text,
      lead_status text,
      lead_charged boolean,
      lead_cost numeric(10,2),
      feedback_submitted boolean,
      survey_answer text,
      dispute_reason text,
      credit_state text,
      dispute_status text,
      dispute_scheduled_at timestamp,
      tg_alert_message_id text,
      lead_creation_time timestamp,
      raw_json jsonb,
      created_at timestamp DEFAULT now()
    );
  `);

  // Admin-centric LSA Account Manager tables (lsa_manager_*). Created idempotently
  // alongside the tenant tables so the admin console works in every environment
  // without a separate migration step.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lsa_manager_connection (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      manager_id text NOT NULL,
      refresh_token text NOT NULL,
      access_token text,
      token_expiry timestamp,
      developer_token text,
      status text NOT NULL DEFAULT 'active',
      connected_at timestamp NOT NULL DEFAULT now(),
      last_refreshed_at timestamp
    );

    CREATE TABLE IF NOT EXISTS lsa_manager_accounts (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      customer_id text NOT NULL UNIQUE,
      account_name text,
      user_id integer,
      link_type text NOT NULL DEFAULT 'self',
      link_status text NOT NULL DEFAULT 'active',
      is_lsa_enrolled boolean DEFAULT false,
      currency text,
      timezone text,
      lead_count integer NOT NULL DEFAULT 0,
      total_spend text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lsa_manager_invitations (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      target_customer_id text NOT NULL,
      account_name text,
      status text NOT NULL DEFAULT 'pending',
      created_by_admin_id integer NOT NULL,
      invited_at timestamp NOT NULL DEFAULT now(),
      resolved_at timestamp,
      notes text,
      google_invitation_resource_name text
    );

    CREATE TABLE IF NOT EXISTS lsa_manager_leads (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      account_id integer NOT NULL,
      google_lead_id text NOT NULL UNIQUE,
      lead_type text,
      status text NOT NULL DEFAULT 'new',
      customer_name text,
      customer_phone text,
      service_requested text,
      charged boolean NOT NULL DEFAULT false,
      charge_amount text,
      disputed boolean NOT NULL DEFAULT false,
      dispute_reason text,
      disputed_at timestamp,
      disputed_by_admin_id integer,
      lead_created_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      actor_email text NOT NULL,
      actor_id integer NOT NULL,
      action text NOT NULL,
      target_customer_id text,
      target_account_name text,
      parameters jsonb,
      result text NOT NULL DEFAULT 'success',
      error_message text,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  // Manager indexes (conflict targets for upserts + admin-console reads).
  const managerIndexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS lsa_manager_accounts_customer_uniq ON lsa_manager_accounts (customer_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS lsa_manager_leads_google_lead_uniq ON lsa_manager_leads (google_lead_id)`,
    `CREATE INDEX IF NOT EXISTS lsa_manager_leads_account_idx ON lsa_manager_leads (account_id)`,
    `CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at)`,
  ];
  for (const sql of managerIndexes) {
    await pool.query(sql);
  }

  // Columns added defensively in case an older version of any table exists.
  const alters = [
    `ALTER TABLE lsa_connections ADD COLUMN IF NOT EXISTS telegram_username text`,
    `ALTER TABLE lsa_connections ADD COLUMN IF NOT EXISTS telegram_chat_id text`,
    `ALTER TABLE lsa_connections ADD COLUMN IF NOT EXISTS telegram_link_token text`,
    `ALTER TABLE lsa_connections ADD COLUMN IF NOT EXISTS last_discovery_at timestamp`,
    `ALTER TABLE lsa_accounts ADD COLUMN IF NOT EXISTS lsa_enrolled boolean`,
    `ALTER TABLE lsa_accounts ADD COLUMN IF NOT EXISTS sync_cursor timestamp`,
    `ALTER TABLE lsa_accounts ADD COLUMN IF NOT EXISTS cost_total numeric(12,2)`,
    `ALTER TABLE lsa_leads ADD COLUMN IF NOT EXISTS user_id integer`,
    `ALTER TABLE lsa_leads ADD COLUMN IF NOT EXISTS dispute_scheduled_at timestamp`,
    `ALTER TABLE lsa_leads ADD COLUMN IF NOT EXISTS tg_alert_message_id text`,
  ];
  for (const sql of alters) {
    await pool.query(sql);
  }

  // Constraints & indexes. lead_id is globally unique (Google ids are global) and
  // is the upsert conflict target. Everything else is for tenant-scoped reads.
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS lsa_connections_user_id_uniq ON lsa_connections (user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS lsa_accounts_user_customer_uniq ON lsa_accounts (user_id, customer_id)`,
    `CREATE INDEX IF NOT EXISTS lsa_accounts_user_idx ON lsa_accounts (user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS lsa_leads_lead_id_uniq ON lsa_leads (lead_id)`,
    `CREATE INDEX IF NOT EXISTS lsa_leads_user_customer_idx ON lsa_leads (user_id, customer_id, lead_creation_time)`,
    `CREATE INDEX IF NOT EXISTS lsa_leads_dispute_status_idx ON lsa_leads (dispute_status)`,
    `CREATE INDEX IF NOT EXISTS lsa_leads_tg_alert_idx ON lsa_leads (tg_alert_message_id)`,
  ];
  for (const sql of indexes) {
    await pool.query(sql);
  }
}
