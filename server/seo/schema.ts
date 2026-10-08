import { LOCATION_SCHEMA_DDL } from "./locations";
import { pool } from "../db";
import { EXPLORER_SCHEMA_DDL } from "./explorer";
import { CREDIT_SCHEMA_DDL } from "./credits";
import { REPORT_SCHEMA_DDL } from "./reports";

/**
 * SEO toolset tables (rank tracker, keyword research, backlinks, competitor
 * gap, DataForSEO spend ledger). Idempotent: boot runs them, and
 * scripts/apply-schema-migration.ts spreads SEO_SCHEMA_DDL into its list.
 *
 * Tenancy follows the rest of the platform: every row carries user_id = the
 * paying account (an agency member acting in the owner's workspace spends the
 * owner's allowance — getDevUser maps res.locals.agencyOwner onto user.id).
 */
export const SEO_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_sites (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain text NOT NULL,
    location_code integer NOT NULL DEFAULT 2840,
    language_code text NOT NULL DEFAULT 'en',
    devices text NOT NULL DEFAULT 'both' CHECK (devices IN ('desktop','mobile','both')),
    serp_depth integer NOT NULL DEFAULT 10 CHECK (serp_depth BETWEEN 10 AND 100),
    next_rank_check_at timestamptz NOT NULL DEFAULT now(),
    next_backlinks_at timestamptz NOT NULL DEFAULT now(),
    last_rank_check_at timestamptz,
    last_backlinks_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, domain)
  )`,
  `CREATE TABLE IF NOT EXISTS seo_keywords (
    id serial PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keyword text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    search_volume integer,
    cpc numeric(10,4),
    difficulty integer,
    volume_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, keyword)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_keywords_site ON seo_keywords(site_id)`,
  // One rank-check run per site per trigger: the queued task ids live in
  // `tasks` while the standard queue works, polled by server/seo/jobs.ts.
  `CREATE TABLE IF NOT EXISTS seo_rank_runs (
    id uuid PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger text NOT NULL DEFAULT 'weekly',
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
    total integer NOT NULL DEFAULT 0,
    checked integer NOT NULL DEFAULT 0,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    error text,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS seo_rank_runs_site ON seo_rank_runs(site_id, created_at DESC)`,
  // One open run per site: two requests at once cannot both buy the same check.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_rank_runs_one_active ON seo_rank_runs(site_id) WHERE status IN ('queued','running')`,
  `CREATE TABLE IF NOT EXISTS seo_rank_checks (
    id bigserial PRIMARY KEY,
    keyword_id integer NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    run_id uuid REFERENCES seo_rank_runs(id) ON DELETE SET NULL,
    checked_on date NOT NULL DEFAULT current_date,
    device text NOT NULL CHECK (device IN ('desktop','mobile')),
    position integer,
    url text,
    serp_features jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (keyword_id, checked_on, device)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_rank_checks_site_date ON seo_rank_checks(site_id, checked_on DESC)`,
  `CREATE TABLE IF NOT EXISTS seo_backlink_snapshots (
    id serial PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    taken_on date NOT NULL DEFAULT current_date,
    summary jsonb NOT NULL,
    backlinks jsonb NOT NULL DEFAULT '[]'::jsonb,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, taken_on)
  )`,
  // DataForSEO spend, per paying account per calendar month (UTC). The cap in
  // server/seo/budget.ts reads the platform-wide sum of a month.
  `CREATE TABLE IF NOT EXISTS seo_api_usage (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month text NOT NULL,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    requests integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month)
  )`,
  // Site Explorer: saved domain reports (server/seo/explorer.ts).
  ...EXPLORER_SCHEMA_DDL,
  // The customer's SEO data credit (server/seo/credits.ts).
  ...CREDIT_SCHEMA_DDL,
  // Saved pages of Site Explorer reports and keyword overviews (server/seo/reports.ts).
  ...REPORT_SCHEMA_DDL,
  // Places a rank check can be run from (server/seo/locations.ts).
  ...LOCATION_SCHEMA_DDL,
  // A keyword can be tracked in several places: the same keyword in Tampa and in Clearwater is two rows.
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_code integer`,
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_name text`,
  `ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_site_id_keyword_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_keywords_site_keyword_place ON seo_keywords(site_id, keyword, coalesce(location_code, 0))`,
  // The Google map pack: this business's place in it (1-3, null = not in it) and who was in it.
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS local_position integer`,
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS local_pack jsonb`,
  // The name on the Google Business Profile (map-pack entries often carry no website), and alert settings.
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS business_name text`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS alert_drop integer NOT NULL DEFAULT 3`,
  // What changed between checks (server/seo/alerts.ts). `source` is what raised it (a rank run id, a snapshot date).
  `CREATE TABLE IF NOT EXISTS seo_alerts (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained')),
    source text NOT NULL,
    title text NOT NULL,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, kind, source)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id, created_at DESC)`,
];

export async function ensureSeoSchema() {
  for (const sql of SEO_SCHEMA_DDL) await pool.query(sql);
}
