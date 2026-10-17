import { pool } from "./db";
import { SCRAPE_SCHEDULE_DDL } from "./scrape-schedule-input";

// Additive migration: legacy rows deliberately remain unowned.
export async function ensureGrowthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_referral_settings (
      user_id integer PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, offer text NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS review_escalation_settings (
      user_id integer PRIMARY KEY, threshold integer NOT NULL DEFAULT 8 CHECK (threshold BETWEEN 1 AND 10),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS private_feedback_at timestamp;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS escalation_alerted_at timestamp;
    ALTER TABLE review_templates ADD COLUMN IF NOT EXISTS other_review_links jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS other_review_links jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS other_links_opened jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE review_templates ADD COLUMN IF NOT EXISTS primary_review_url text;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS primary_review_url text;
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
    -- Review requests linked to a CRM client and its project photos (server/crm/photo-library.ts).
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS crm_org_id varchar;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS crm_customer_id varchar;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS crm_photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS client_photo_ids jsonb;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS error_message text;
    ALTER TABLE ranking_grid_scans ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS ranking_grid_owner_idx ON ranking_grid_scans(user_id);
    ALTER TABLE search_queries ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS search_queries_owner_idx ON search_queries(user_id);
    -- The dashboard reads visits per tracked site and time window on every home load.
    CREATE INDEX IF NOT EXISTS click_visits_domain_visited_idx ON click_visits (domain_id, visited_at);
    CREATE INDEX IF NOT EXISTS vpn_visits_domain_visited_idx ON vpn_visits (domain_id, visited_at);
    CREATE INDEX IF NOT EXISTS tracked_domains_user_idx ON tracked_domains (user_id);
    -- Scrape schedules: a custom "every N hours" interval (NULL = the preset frequency).
    ${SCRAPE_SCHEDULE_DDL.join(";\n")};
  `);
}
