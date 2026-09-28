import { pool } from "./db";

// Additive migration: legacy rows deliberately remain unowned.
export async function ensureGrowthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_recipient_preferences (
      user_id integer NOT NULL, email text NOT NULL, unsubscribed boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,email)
    );
    INSERT INTO review_recipient_preferences(user_id,email)
      SELECT DISTINCT user_id,lower(trim(client_email)) FROM review_requests WHERE unsubscribed=true
      ON CONFLICT(user_id,email) DO NOTHING;
    CREATE TABLE IF NOT EXISTS growth_budgets (
      key text NOT NULL, period text NOT NULL, used integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(key,period)
    );
    DELETE FROM growth_budgets WHERE created_at < now() - interval '62 days';
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS google_link_opened boolean NOT NULL DEFAULT false;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS google_link_opened_at timestamp;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS error_message text;
    ALTER TABLE ranking_grid_scans ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS ranking_grid_owner_idx ON ranking_grid_scans(user_id);
    ALTER TABLE search_queries ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS search_queries_owner_idx ON search_queries(user_id);
  `);
}
