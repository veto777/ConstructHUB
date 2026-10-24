/**
 * Reputation Desk tables (shared/reputation.ts). Idempotent DDL: boot runs it (server/routes.ts).
 *   rep_scans    every scan: the free public ones (a lead) and a case's checks
 *   rep_cases    one client's restoration: the name searched, the terms, the plan
 *   rep_items    one thing to act on in a case: a search result, image, video, news story or prediction
 *   rep_assets   the owned assets built to push negatives down
 *   rep_brokers  a case's people-search / data-broker opt-outs (server/data/data-brokers.json keys)
 */
import type { Queryable } from "../ops/schema";

export const REPUTATION_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS rep_cases (
     id bigserial PRIMARY KEY,
     status text NOT NULL DEFAULT 'active',
     kind text NOT NULL DEFAULT 'person',
     client_name text NOT NULL,
     subject text NOT NULL,
     email text,
     phone text,
     terms text[] NOT NULL DEFAULT '{}',
     owned_domains text[] NOT NULL DEFAULT '{}',
     services text[] NOT NULL DEFAULT '{}',
     notes text,
     proposal_id bigint,
     origin_scan_id bigint,
     monitor_days integer NOT NULL DEFAULT 7,
     last_checked_at timestamptz,
     last_score integer,
     wiki jsonb NOT NULL DEFAULT '{}'::jsonb,
     events jsonb NOT NULL DEFAULT '[]'::jsonb,
     created_by integer,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS rep_scans (
     id bigserial PRIMARY KEY,
     case_id bigint REFERENCES rep_cases(id) ON DELETE CASCADE,
     token_hash text UNIQUE,
     query text NOT NULL,
     kind text NOT NULL DEFAULT 'person',
     name text,
     email text,
     phone text,
     ip_hash text,
     report jsonb,
     score integer,
     cost_usd numeric(10,4) NOT NULL DEFAULT 0,
     lead_status text NOT NULL DEFAULT 'new',
     lead_notes text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS rep_scans_case_idx ON rep_scans (case_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS rep_scans_leads_idx ON rep_scans (created_at DESC) WHERE case_id IS NULL`,
  `CREATE TABLE IF NOT EXISTS rep_items (
     id bigserial PRIMARY KEY,
     case_id bigint NOT NULL REFERENCES rep_cases(id) ON DELETE CASCADE,
     kind text NOT NULL DEFAULT 'result',
     key text NOT NULL,
     url text,
     domain text,
     title text NOT NULL DEFAULT '',
     snippet text NOT NULL DEFAULT '',
     sentiment text NOT NULL DEFAULT 'neutral',
     control text NOT NULL DEFAULT 'third_party',
     reason text,
     action text NOT NULL DEFAULT 'monitor',
     status text NOT NULL DEFAULT 'open',
     playbook text,
     best_position integer,
     last_position integer,
     last_term text,
     positions jsonb NOT NULL DEFAULT '[]'::jsonb,
     request jsonb,
     live_status integer,
     notes text,
     first_seen timestamptz NOT NULL DEFAULT now(),
     last_seen timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (case_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS rep_assets (
     id bigserial PRIMARY KEY,
     case_id bigint NOT NULL REFERENCES rep_cases(id) ON DELETE CASCADE,
     kind text NOT NULL DEFAULT 'profile',
     title text NOT NULL,
     url text,
     status text NOT NULL DEFAULT 'planned',
     last_position integer,
     notes text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS rep_brokers (
     id bigserial PRIMARY KEY,
     case_id bigint NOT NULL REFERENCES rep_cases(id) ON DELETE CASCADE,
     broker_key text NOT NULL,
     status text NOT NULL DEFAULT 'not_checked',
     listing_url text,
     evidence text,
     checked_at timestamptz,
     submitted_at timestamptz,
     notes text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (case_id, broker_key)
   )`,
];

export async function ensureReputationSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of REPUTATION_DDL) await target.query(sql);
}
