/**
 * Call Assistant tables — THE one DDL (docs/call-assistant/SPEC.md § Data).
 *
 * Idempotent (CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only; no row
 * is ever rewritten), run at boot by server/routes.ts and by
 * scripts/apply-schema-migration.ts. No imports on purpose, so the migration
 * script can use the statements with its own pg pool. The drizzle definitions
 * live in shared/schema.ts (the "Call Assistant" block) and must match.
 *
 * OWNERSHIP (LANES.md): the architect owns this file. A lane that needs a
 * column appends `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements INSIDE
 * its own marked block at the bottom (and mirrors them in shared/schema.ts),
 * never edits the CREATE TABLE text.
 *
 * Every table is org-scoped (org_id = crm_orgs.id). `account_user_id` on the
 * usage table is the paying account (crm_orgs.owner_user_id), the one whose
 * subscription holds the add-on.
 */

export const VOICE_SCHEMA_DDL: readonly string[] = [
  // One profile per org: the Studio's draft, the published copy the engine
  // runs, and the compiled prompt cached at publish time.
  `CREATE TABLE IF NOT EXISTS voice_profiles (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL UNIQUE,
     profile jsonb NOT NULL,
     published_version integer,
     published_profile jsonb,
     compiled jsonb,
     status text NOT NULL DEFAULT 'draft',
     setup_completed_at timestamp,
     updated_by_member_id varchar,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  // Every publish is a version (history, diff, roll back).
  `CREATE TABLE IF NOT EXISTS voice_profile_versions (
     id bigserial PRIMARY KEY,
     org_id varchar NOT NULL,
     profile_id varchar NOT NULL,
     version integer NOT NULL,
     profile jsonb NOT NULL,
     compiled jsonb,
     note text,
     created_by_member_id varchar,
     created_at timestamp DEFAULT now(),
     UNIQUE (org_id, version)
   )`,
  // Numbers an org owns on SignalWire (several per org, each with a label).
  `CREATE TABLE IF NOT EXISTS voice_numbers (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     phone_number text NOT NULL UNIQUE,
     label text,
     location text,
     state text,
     area_code text,
     locality text,
     provider text NOT NULL DEFAULT 'signalwire',
     provider_sid text,
     friendly_name text,
     voice_url text,
     status_callback_url text,
     status text NOT NULL DEFAULT 'active',
     is_test boolean NOT NULL DEFAULT false,
     forwarding_from text,
     monthly_cents integer NOT NULL DEFAULT 0,
     purchased_at timestamp DEFAULT now(),
     release_eligible_at timestamp,
     released_at timestamp,
     last_error text,
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS voice_numbers_org_idx ON voice_numbers(org_id, status)`,
  // One row per call; the transcript is JSON on the row (no turns table).
  `CREATE TABLE IF NOT EXISTS voice_calls (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     number_id varchar,
     call_sid text NOT NULL UNIQUE,
     direction text NOT NULL DEFAULT 'inbound',
     from_number text,
     to_number text,
     engine text,
     model text,
     persona text,
     profile_version integer,
     started_at timestamp NOT NULL DEFAULT now(),
     answered_at timestamp,
     ended_at timestamp,
     duration_seconds integer,
     billed_minutes integer,
     outcome text,
     caller_name text,
     caller_email text,
     caller_address text,
     caller_city text,
     service_needed text,
     summary text,
     transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
     slots jsonb,
     events jsonb,
     recording_key text,
     recording_seconds integer,
     customer_id varchar,
     project_id varchar,
     lead_delivered_at timestamp,
     spam_confidence numeric(3,2),
     spam_reason text,
     flags jsonb,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS voice_calls_org_started_idx ON voice_calls(org_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS voice_calls_org_outcome_idx ON voice_calls(org_id, outcome)`,
  `CREATE INDEX IF NOT EXISTS voice_calls_customer_idx ON voice_calls(customer_id)`,
  // Text/email escalations with reminders until the recipient confirms.
  `CREATE TABLE IF NOT EXISTS voice_escalations (
     id bigserial PRIMARY KEY,
     org_id varchar NOT NULL,
     call_id varchar,
     kind text NOT NULL,
     rule_id text,
     channel text NOT NULL,
     recipient text NOT NULL,
     recipient_name text,
     body text NOT NULL,
     sent_count integer NOT NULL DEFAULT 0,
     last_sent_at timestamp,
     last_provider_sid text,
     remind_every_minutes integer NOT NULL DEFAULT 120,
     remind_from_hour integer NOT NULL DEFAULT 8,
     remind_to_hour integer NOT NULL DEFAULT 20,
     max_days integer NOT NULL DEFAULT 14,
     follow_up_next_day boolean NOT NULL DEFAULT true,
     confirmed_at timestamp,
     reply_text text,
     followup_sent_at timestamp,
     closed_at timestamp,
     close_reason text,
     last_error text,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS voice_escalations_open_idx ON voice_escalations(org_id, closed_at)`,
  // Spam ledger: strikes per caller number; two near-certain spam calls block it pre-answer.
  `CREATE TABLE IF NOT EXISTS voice_spam (
     id bigserial PRIMARY KEY,
     org_id varchar NOT NULL,
     phone_number text NOT NULL,
     strikes integer NOT NULL DEFAULT 0,
     calls integer NOT NULL DEFAULT 0,
     last_confidence numeric(3,2),
     last_reason text,
     last_call_id varchar,
     blocked_at timestamp,
     unblocked_at timestamp,
     blocked_by text,
     first_seen_at timestamp DEFAULT now(),
     last_seen_at timestamp DEFAULT now(),
     UNIQUE (org_id, phone_number)
   )`,
  // Monthly minutes per org (the add-on's included minutes, then overage).
  `CREATE TABLE IF NOT EXISTS voice_usage (
     id bigserial PRIMARY KEY,
     org_id varchar NOT NULL,
     account_user_id integer NOT NULL,
     month text NOT NULL,
     calls integer NOT NULL DEFAULT 0,
     minutes integer NOT NULL DEFAULT 0,
     spam_calls integer NOT NULL DEFAULT 0,
     blocked_calls integer NOT NULL DEFAULT 0,
     included_minutes integer,
     overage_minutes integer NOT NULL DEFAULT 0,
     overage_reported_minutes integer NOT NULL DEFAULT 0,
     overage_reported_at timestamp,
     stripe_usage_record_id text,
     updated_at timestamp DEFAULT now(),
     UNIQUE (org_id, month)
   )`,
  `CREATE INDEX IF NOT EXISTS voice_usage_account_idx ON voice_usage(account_user_id, month)`,

  // ── lane: numbers+billing — append ALTER TABLE … ADD COLUMN IF NOT EXISTS here ──
  // ── end lane: numbers+billing ──

  // ── lane: studio-backend — append here ──
  // ── end lane: studio-backend ──

  // ── lane: calls+crm — append here ──
  // ── end lane: calls+crm ──
];

export const VOICE_TABLES: readonly string[] = [
  "voice_profiles", "voice_profile_versions", "voice_numbers", "voice_calls", "voice_escalations", "voice_spam", "voice_usage",
];

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Creates whatever is missing; safe to run on every boot and repeatedly. */
export async function ensureVoiceSchema(q?: Queryable): Promise<void> {
  const client = q ?? (await import("../db")).pool;
  for (const statement of VOICE_SCHEMA_DDL) await client.query(statement);
}
