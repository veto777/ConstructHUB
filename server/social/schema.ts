import { pool } from "../db";
export async function ensureSocialSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_connections(user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, key_enc text NOT NULL, accounts jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS social_rate(key_hash text PRIMARY KEY, next_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS social_settings(user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, settings jsonb NOT NULL, next_at timestamptz NOT NULL DEFAULT now(), sequence integer NOT NULL DEFAULT 0, last_error text);
    CREATE TABLE IF NOT EXISTS social_posts(id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id text NOT NULL, destination_key text NOT NULL, payload jsonb NOT NULL, state text NOT NULL, due_at timestamptz NOT NULL, ai_generated boolean NOT NULL DEFAULT false, auto_generated boolean NOT NULL DEFAULT false, source text, submission_id text, public_url text, error text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), notified_at timestamptz, UNIQUE(user_id,request_id,destination_key));
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
    ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
    CREATE INDEX IF NOT EXISTS social_posts_due ON social_posts(state,due_at);
    CREATE INDEX IF NOT EXISTS social_posts_owner ON social_posts(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS social_sources(id bigserial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind text NOT NULL, text text NOT NULL, media_urls jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE social_sources ADD COLUMN IF NOT EXISTS external_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS social_source_external ON social_sources(user_id,external_key);
  `);
}
