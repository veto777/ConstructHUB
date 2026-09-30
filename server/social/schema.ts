import { pool } from "../db";
export async function ensureSocialSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_connections(user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, key_enc text NOT NULL, accounts jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS social_rate(key_hash text PRIMARY KEY, next_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS social_settings(user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, settings jsonb NOT NULL, next_at timestamptz NOT NULL DEFAULT now(), sequence integer NOT NULL DEFAULT 0, last_error text);
    CREATE TABLE IF NOT EXISTS social_posts(id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id text NOT NULL, destination_key text NOT NULL, payload jsonb NOT NULL, state text NOT NULL, due_at timestamptz NOT NULL, ai_generated boolean NOT NULL DEFAULT false, auto_generated boolean NOT NULL DEFAULT false, source text, submission_id text, public_url text, error text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), notified_at timestamptz, UNIQUE(user_id,request_id,destination_key));
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS request_hash text;
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
    CREATE INDEX IF NOT EXISTS social_posts_due ON social_posts(state,due_at);
    CREATE INDEX IF NOT EXISTS social_posts_owner ON social_posts(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS social_sources(id bigserial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind text NOT NULL, text text NOT NULL, media_urls jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE social_sources ADD COLUMN IF NOT EXISTS external_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS social_source_external ON social_sources(user_id,external_key);
    ALTER TABLE social_connections ADD COLUMN IF NOT EXISTS business_id integer REFERENCES business_locations(id) ON DELETE CASCADE;
    ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS business_id integer REFERENCES business_locations(id) ON DELETE CASCADE;
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS business_id integer REFERENCES business_locations(id) ON DELETE CASCADE;
    ALTER TABLE social_sources ADD COLUMN IF NOT EXISTS business_id integer REFERENCES business_locations(id) ON DELETE CASCADE;
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS connection_hash text;
    ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_pkey;
    ALTER TABLE social_settings DROP CONSTRAINT IF EXISTS social_settings_pkey;
    CREATE UNIQUE INDEX IF NOT EXISTS social_connections_scope ON social_connections(user_id,business_id) NULLS NOT DISTINCT;
    CREATE UNIQUE INDEX IF NOT EXISTS social_settings_scope ON social_settings(user_id,business_id) NULLS NOT DISTINCT;
    ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_user_id_request_id_destination_key_key;
    CREATE UNIQUE INDEX IF NOT EXISTS social_posts_request_scope ON social_posts(user_id,business_id,request_id,destination_key) NULLS NOT DISTINCT;
    CREATE INDEX IF NOT EXISTS social_posts_business ON social_posts(user_id,business_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS social_sources_business ON social_sources(user_id,business_id,created_at DESC,id);
    -- An old global automatic setting cannot be safely assigned to an arbitrary business.
    UPDATE social_settings SET settings=jsonb_set(settings,'{enabled}','false'),
      last_error='Choose a business and configure its auto mode in Social Media'
      WHERE business_id IS NULL AND settings->>'enabled'='true';
    UPDATE social_posts SET state='draft' WHERE business_id IS NULL AND auto_generated AND approved_at IS NULL AND state='queued';
    CREATE TABLE IF NOT EXISTS social_business_config (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id integer PRIMARY KEY REFERENCES business_locations(id) ON DELETE CASCADE,
      destinations jsonb NOT NULL DEFAULT '[]', connection_hash text,
      sync_requested boolean NOT NULL DEFAULT false, sync_next_at timestamptz NOT NULL DEFAULT now(),
      sync_error text, synced_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS social_bulk_jobs (
      id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id integer NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
      request_id uuid NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
      state text NOT NULL DEFAULT 'queued', error text, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id,request_id,business_id)
    );
    ALTER TABLE social_bulk_jobs ADD COLUMN IF NOT EXISTS destinations jsonb;
    ALTER TABLE social_bulk_jobs ADD COLUMN IF NOT EXISTS connection_hash text;
    CREATE INDEX IF NOT EXISTS social_bulk_due ON social_bulk_jobs(id) WHERE state='queued';
    CREATE INDEX IF NOT EXISTS social_bulk_owner ON social_bulk_jobs(user_id,id DESC);
    CREATE INDEX IF NOT EXISTS social_business_owner ON social_business_config(user_id,business_id);
  `);
}
