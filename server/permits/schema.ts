import { pool } from "../db";

/**
 * Permit alerts tables (shared/schema.ts permitWatches / permits / permitWatchHits / permitPollState).
 * Idempotent, run at boot (server/routes.ts) and by the tests; every statement is IF NOT EXISTS.
 */
export const PERMIT_ALERTS_DDL = `
CREATE TABLE IF NOT EXISTS permit_watches(
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  database_ids integer[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  last_matched_at timestamptz
);
CREATE INDEX IF NOT EXISTS permit_watches_owner ON permit_watches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS permit_watches_databases ON permit_watches USING gin(database_ids) WHERE active;

CREATE TABLE IF NOT EXISTS permits(
  id bigserial PRIMARY KEY,
  database_id integer NOT NULL,
  permit_number text NOT NULL,
  jurisdiction text NOT NULL,
  address text,
  address_norm text,
  parcel text,
  lat double precision,
  lng double precision,
  permit_type text,
  work_class text,
  description text,
  status text,
  issued_at text,
  applied_at text,
  expires_at text,
  valuation double precision,
  contractor_name text,
  contractor_license text,
  applicant_name text,
  owner_name text,
  source_url text,
  raw jsonb,
  content_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS permits_database_number ON permits(database_id, permit_number);
CREATE INDEX IF NOT EXISTS permits_first_seen ON permits(database_id, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS permit_watch_hits(
  id bigserial PRIMARY KEY,
  watch_id bigint NOT NULL REFERENCES permit_watches(id) ON DELETE CASCADE,
  permit_id bigint NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
  reason text,
  matched_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  channel_results jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS permit_watch_hits_once ON permit_watch_hits(watch_id, permit_id);
CREATE INDEX IF NOT EXISTS permit_watch_hits_by_watch ON permit_watch_hits(watch_id, matched_at DESC);

CREATE TABLE IF NOT EXISTS permit_poll_state(
  database_id integer PRIMARY KEY,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failing_since timestamptz,
  last_count integer NOT NULL DEFAULT 0
);
`;

export async function ensurePermitAlertsSchema(): Promise<void> {
  await pool.query(PERMIT_ALERTS_DDL);
}
