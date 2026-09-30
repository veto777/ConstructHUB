import { pool } from '../db';
/** Owner-scoped agency MCC storage; intentionally separate from the legacy admin MCC. */
export async function ensureAdsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads_grants (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      connection_id uuid NOT NULL DEFAULT gen_random_uuid(), manager_id text NOT NULL,
      refresh_token text NOT NULL, access_token text, expires_at timestamptz,
      reconnect_required boolean NOT NULL DEFAULT false, verified boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(), last_poll_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS ads_accounts (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, customer_id text NOT NULL,
      name text, manager boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'UNKNOWN',
      lsa boolean, currency text, timezone text, last_seen timestamptz,
      snapshot jsonb, synced_at timestamptz, error text, domain_id integer REFERENCES tracked_domains(id) ON DELETE SET NULL,
      PRIMARY KEY(user_id,customer_id)
    );
    CREATE INDEX IF NOT EXISTS ads_accounts_filter ON ads_accounts(user_id,status,lsa,customer_id);
    CREATE TABLE IF NOT EXISTS ads_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id text NOT NULL, email text NOT NULL, resource_name text,
      status text NOT NULL DEFAULT 'queued', email_status text NOT NULL DEFAULT 'not_sent',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ads_invitations_owner ON ads_invitations(user_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS ads_invitation_open ON ads_invitations(user_id,customer_id)
      WHERE status IN ('queued','pending','unknown');
    CREATE TABLE IF NOT EXISTS ads_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id uuid NOT NULL, customer_id text NOT NULL, batch_id uuid NOT NULL,
      kind text NOT NULL, input jsonb NOT NULL, document jsonb NOT NULL,
      status text NOT NULL DEFAULT 'preview', expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
      inverse jsonb, after_document jsonb, undo_of uuid REFERENCES ads_plans(id),
      error text, created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
    );
    ALTER TABLE ads_plans ALTER COLUMN expires_at SET DEFAULT now()+interval '24 hours';
    CREATE INDEX IF NOT EXISTS ads_plans_owner ON ads_plans(user_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS ads_undo_open ON ads_plans(undo_of) WHERE status IN ('preview','queued','applying','applied','unknown');
    CREATE TABLE IF NOT EXISTS ads_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id uuid NOT NULL, batch_id uuid NOT NULL, customer_id text,
      kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', dedupe text NOT NULL,
      status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, error text,
      due_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
      UNIQUE(user_id,dedupe)
    );
    CREATE INDEX IF NOT EXISTS ads_jobs_due ON ads_jobs(due_at,created_at) WHERE status='queued';
    CREATE INDEX IF NOT EXISTS ads_jobs_owner ON ads_jobs(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS ads_findings (
      id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id text NOT NULL, kind text NOT NULL, severity text NOT NULL,
      title text NOT NULL, detail text NOT NULL, fix jsonb, checked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ads_findings_owner ON ads_findings(user_id,customer_id,severity,id);
    CREATE TABLE IF NOT EXISTS ads_ip_age (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, customer_id text NOT NULL,
      resource_name text NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,customer_id,resource_name)
    );
    CREATE TABLE IF NOT EXISTS ads_request_budget (id integer PRIMARY KEY CHECK(id=1),next_at timestamptz NOT NULL);
    INSERT INTO ads_request_budget VALUES(1,now()) ON CONFLICT DO NOTHING;
  `);
}
