import { pool } from "../db";
/**
 * Backlinks database (shared/backlinks.ts). Additive `IF NOT EXISTS` only, like server/competitors/schema.ts,
 * so it is safe on every database and on every boot.
 *
 *   backlink_sources      one row per site (domain is unique); the vetter leases rows (lease_token/lease_until)
 *   backlink_queries      the search bank discovery rotates through (kind + niche + the words searched)
 *   backlink_events       what happened to a source, newest last (discovered, vetted, status, outreach…)
 *   backlink_outreach     pitch emails: drafted → approved by an admin → sent (sending is off by default)
 *   backlink_suppression  addresses/domains that must never be emailed again (opt-outs, bounces, admin)
 *   backlink_spend        what discovery/metrics cost per month, against BACKLINKS_MONTHLY_BUDGET_USD
 */
export async function ensureBacklinkSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backlink_sources (
      id serial PRIMARY KEY,
      domain text NOT NULL UNIQUE,
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'discovered',
      tier text,
      score integer,
      niches text[] NOT NULL DEFAULT '{}',
      discovered_url text,
      discovered_via text,
      submit_url text,
      contact_url text,
      contact_emails text[] NOT NULL DEFAULT '{}',
      signals jsonb,
      metrics jsonb,
      reasons text[] NOT NULL DEFAULT '{}',
      link_type text NOT NULL DEFAULT 'unknown',
      price_usd numeric(10,2),
      turnaround_days integer,
      notes text,
      attempts integer NOT NULL DEFAULT 0,
      lease_token uuid,
      lease_until timestamptz,
      vetted_at timestamptz,
      metrics_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS backlink_sources_status ON backlink_sources(status, vetted_at);
    CREATE INDEX IF NOT EXISTS backlink_sources_kind_tier ON backlink_sources(kind, tier);
    ALTER TABLE backlink_sources ADD COLUMN IF NOT EXISTS contacts_checked_at timestamptz;
    CREATE TABLE IF NOT EXISTS backlink_queries (
      id serial PRIMARY KEY,
      kind text NOT NULL,
      niche text NOT NULL,
      query text NOT NULL UNIQUE,
      runs integer NOT NULL DEFAULT 0,
      found integer NOT NULL DEFAULT 0,
      new_found integer NOT NULL DEFAULT 0,
      cost_usd numeric(10,4) NOT NULL DEFAULT 0,
      last_run_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS backlink_events (
      id bigserial PRIMARY KEY,
      source_id integer NOT NULL REFERENCES backlink_sources(id) ON DELETE CASCADE,
      at timestamptz NOT NULL DEFAULT now(),
      type text NOT NULL,
      detail jsonb
    );
    CREATE INDEX IF NOT EXISTS backlink_events_source ON backlink_events(source_id, at);
    CREATE TABLE IF NOT EXISTS backlink_outreach (
      id serial PRIMARY KEY,
      source_id integer NOT NULL REFERENCES backlink_sources(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'draft',
      to_email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      approved_by integer,
      sent_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS backlink_outreach_source ON backlink_outreach(source_id);
    CREATE TABLE IF NOT EXISTS backlink_suppression (
      value text PRIMARY KEY,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS backlink_spend (
      month text PRIMARY KEY,
      usd numeric(10,4) NOT NULL DEFAULT 0
    );
  `);
}
