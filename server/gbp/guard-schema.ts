import { pool } from '../db';
export async function ensureProfileGuardSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gbp_guard (
      location_id integer PRIMARY KEY REFERENCES business_locations(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','notify','lockdown')),
      watched text[] NOT NULL DEFAULT '{}', snapshot jsonb, observed jsonb NOT NULL DEFAULT '{}',
      preview jsonb, preview_token text, preview_expires timestamptz,
      checked_at timestamptz, last_attempt timestamptz, last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS gbp_guard_changes (
      id serial PRIMARY KEY, location_id integer NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field text NOT NULL, old_value jsonb, new_value jsonb, source text NOT NULL, evidence jsonb NOT NULL,
      detected_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending',
      resolved_at timestamptz, reported_at timestamptz, error text
    );
    CREATE INDEX IF NOT EXISTS gbp_guard_changes_owner ON gbp_guard_changes(user_id,location_id,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS gbp_guard_pending_field ON gbp_guard_changes(location_id,field) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS gbp_reply_settings (
      location_id integer PRIMARY KEY REFERENCES business_locations(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      settings jsonb NOT NULL, future_since timestamptz NOT NULL DEFAULT now(),
      preview_token text, preview_ids integer[], preview_expires timestamptz
    );
    CREATE TABLE IF NOT EXISTS gbp_review_automation (
      review_id integer PRIMARY KEY REFERENCES google_profile_reviews(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notified_at timestamptz, reported_at timestamptz, ai_status text, ai_error text,
      backfill boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
