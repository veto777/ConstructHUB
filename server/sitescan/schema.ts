import { pool } from "../db";
export async function ensureSiteScanSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sitescan_jobs (
    id uuid PRIMARY KEY, user_id integer REFERENCES users(id) ON DELETE CASCADE,
    url text NOT NULL, page_cap integer NOT NULL CHECK(page_cap BETWEEN 1 AND 500), psi_pages integer NOT NULL DEFAULT 1,
    profile jsonb, state jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', report jsonb,
    error text, lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    share_hash text UNIQUE, share_expires timestamptz, ai_draft text
  );
  CREATE INDEX IF NOT EXISTS sitescan_jobs_owner ON sitescan_jobs(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS sitescan_schedules (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,url text NOT NULL,
    location_id integer, page_cap integer NOT NULL DEFAULT 150, psi_pages integer NOT NULL DEFAULT 1,
    next_at timestamptz NOT NULL DEFAULT now()+interval '1 month', PRIMARY KEY(user_id,url)
  );
  CREATE TABLE IF NOT EXISTS sitescan_leads (
    id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES sitescan_jobs(id) ON DELETE CASCADE,
    email text NOT NULL, verify_hash text NOT NULL UNIQUE, access_hash text NOT NULL UNIQUE,
    verified_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE sitescan_jobs ADD COLUMN IF NOT EXISTS fix_done jsonb NOT NULL DEFAULT '{}'::jsonb;
  CREATE INDEX IF NOT EXISTS sitescan_jobs_client_history ON sitescan_jobs(user_id,url,completed_at DESC);
  CREATE TABLE IF NOT EXISTS sitescan_branding (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, logo text
  );
  CREATE TABLE IF NOT EXISTS sitescan_provider_budget (id integer PRIMARY KEY, next_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO sitescan_provider_budget(id) VALUES(1) ON CONFLICT DO NOTHING;
  `);
}
