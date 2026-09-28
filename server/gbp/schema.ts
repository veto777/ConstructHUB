import { pool } from '../db';
export async function ensureGbpSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gbp_request_budget (id integer PRIMARY KEY CHECK(id=1), next_at timestamptz NOT NULL);
    INSERT INTO gbp_request_budget VALUES(1,now()) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS gbp_grants (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      google_subject text NOT NULL, email text NOT NULL, scopes text[] NOT NULL,
      access_token text, refresh_token text, expires_at timestamptz,
      reconnect_required boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS gbp_account_name text;
    ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS gbp_location_name text;
    CREATE UNIQUE INDEX IF NOT EXISTS gbp_location_identity ON business_locations(user_id, gbp_account_name, gbp_location_name);
    ALTER TABLE google_profile_reviews ADD COLUMN IF NOT EXISTS reply_draft text;
    ALTER TABLE google_profile_reviews ADD COLUMN IF NOT EXISTS reply_status text NOT NULL DEFAULT 'draft';
    ALTER TABLE google_profile_reviews ADD COLUMN IF NOT EXISTS reply_error text;
    ALTER TABLE google_profile_reviews ADD COLUMN IF NOT EXISTS google_deleted boolean NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS gbp_review_identity ON google_profile_reviews(user_id, google_review_id) WHERE google_review_id LIKE 'accounts/%/locations/%/reviews/%';
    UPDATE google_profile_reviews SET reply_draft=COALESCE(reply_draft,reply_comment),reply_comment=NULL,reply_date=NULL WHERE reply_status='draft' AND reply_comment IS NOT NULL;
    CREATE TABLE IF NOT EXISTS gbp_sync_status (
      location_id integer REFERENCES business_locations(id) ON DELETE CASCADE,
      kind text NOT NULL, last_success timestamptz, last_attempt timestamptz, last_error text, cursor_date date,
      PRIMARY KEY(location_id,kind)
    );
    CREATE TABLE IF NOT EXISTS gbp_daily_metrics (
      location_id integer REFERENCES business_locations(id) ON DELETE CASCADE,
      date date NOT NULL, metric text NOT NULL, value bigint NOT NULL,
      PRIMARY KEY(location_id,date,metric)
    );
  `);
}
