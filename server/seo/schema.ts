import { LOCATION_SCHEMA_DDL } from "./locations";
import { LIST_SCHEMA_DDL } from "./lists";
import { REPORT_SCHEDULE_DDL } from "./site-report";
import { VOICE_SCHEMA_DDL } from "./voice";
import { AI_SCHEMA_DDL } from "./ai-visibility";
import { GRID_SCHEMA_DDL } from "./grid";
import { RENDER_SCHEMA_DDL } from "./render-check";
import { KEYWORD_WATCH_DDL, KEYWORD_WATCH_ALERT_DDL } from "./keyword-watch";
import { GRID_WATCH_DDL } from "./grid-monitor";
import { TASK_SCHEMA_DDL } from "./tasks";
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
  // The linking sites lost since the snapshot before (named, with the page that linked): { since, lost: [...], lostTotal }.
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS changes jsonb`,
  // false until the link alerts this snapshot calls for have been raised (existing snapshots are long dealt with).
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS alerts_done boolean NOT NULL DEFAULT true`,
  `ALTER TABLE seo_backlink_snapshots ALTER COLUMN alerts_done SET DEFAULT false`,
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS alerts_tried_at timestamptz`,
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
  // AI visibility: saved answers from the assistants (server/seo/ai-visibility.ts).
  ...AI_SCHEMA_DDL,
  ...GRID_SCHEMA_DDL,
  // Rendering checks: pages fetched plain and in a browser (server/seo/render-check.ts).
  ...RENDER_SCHEMA_DDL,
  // Keyword watch: monthly snapshots of what a site ranks for (server/seo/keyword-watch.ts).
  ...KEYWORD_WATCH_DDL,
  // Followed competitors and the saved result pages (server/seo/voice.ts).
  ...VOICE_SCHEMA_DDL,
  // Scheduled SEO reports (server/seo/site-report.ts).
  ...REPORT_SCHEDULE_DDL,
  // Keyword lists (server/seo/lists.ts).
  ...LIST_SCHEMA_DDL,
  // What each lookup was, for the customer's usage history (server/seo/usage.ts).
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS label text`,
  `CREATE INDEX IF NOT EXISTS seo_reservations_user ON seo_reservations(user_id, created_at DESC)`,
  // Places a rank check can be run from (server/seo/locations.ts).
  ...LOCATION_SCHEMA_DDL,
  `CREATE INDEX IF NOT EXISTS seo_locations_loaded ON seo_locations(loaded_at DESC)`,
  // A keyword can be tracked in several places: the same keyword in Tampa and in Clearwater is two rows.
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_code integer`,
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_name text`,
  // The new rule is in place before the old one goes, so there is never a moment with neither.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_keywords_site_keyword_place ON seo_keywords(site_id, keyword, coalesce(location_code, 0))`,
  `ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_site_id_keyword_key`,
  // Every keyword carries the place it is checked from, so changing a site's default never moves a keyword's history.
  `UPDATE seo_keywords k SET location_code=s.location_code, location_name=CASE WHEN s.location_code=2840 THEN 'United States' ELSE k.location_name END
     FROM seo_sites s WHERE s.id=k.site_id AND k.location_code IS NULL
      AND NOT EXISTS (SELECT 1 FROM seo_keywords x WHERE x.site_id=k.site_id AND x.keyword=k.keyword AND x.location_code=s.location_code)`,
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
  // Set once the bell / email went out; a row without it is retried (server/seo/alerts.ts deliverPendingAlerts).
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS notified_at timestamptz`,
  // Ledger: a reservation closed as abandoned can still be settled for real if its call finishes late; refunds are recorded once.
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS refund_key text`,
  // The real outcome of a call that finished after its reservation was closed as abandoned, kept until it is applied.
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS late_actual_usd numeric(12,6)`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS late_customer_usd numeric(12,6)`,
  // Rank runs: checks the source reported as failed, and a refund that still has to be made.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS refund_due integer NOT NULL DEFAULT 0`,
  // Alerts: a delivery in progress holds a short lease; notified_at is set only once it went out.
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS claimed_at timestamptz`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS claim_token text`,
  // One list name per account, whatever the capitals.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_keyword_lists_name ON seo_keyword_lists(user_id, lower(name))`,
  // People who asked not to get an account's reports any more (server/seo/site-report-send.ts).
  `CREATE TABLE IF NOT EXISTS seo_report_optouts (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, email)
  )`,
  // A rank run remembers what paid for it and how many checks were accepted, to refund the ones that never come back.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS reservation_id uuid`,
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS posted integer NOT NULL DEFAULT 0`,
  ...TASK_SCHEMA_DDL,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false`,
  // Service-area planner: the services and towns a site used last ({ services: [...], towns: [...] }).
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS planner jsonb`,
  // Last: it changes a rule on seo_alerts, which must exist by now.
  ...GRID_WATCH_DDL,
  // After the grid's: the alert kinds for the keyword watch (it replaces the same rule with the full list).
  ...KEYWORD_WATCH_ALERT_DDL,
];

export async function ensureSeoSchema() {
  for (const sql of SEO_SCHEMA_DDL) await pool.query(sql);
}
