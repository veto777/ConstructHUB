import { pool } from "../db";
export const SITESCAN_KINDS = {
  "sitescan.completed": {
    label: "Site Scan completed",
    inApp: true,
    email: false,
  },
  "sitescan.regressed": {
    label: "Site Scan score dropped or new critical issue",
    inApp: true,
    email: false,
  },
};
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
  );`);
}
