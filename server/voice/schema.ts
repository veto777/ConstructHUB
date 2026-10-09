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
  // Every call gets a per-account number, "Call #57" (owner, 2026-10-02: "the calls being recorded should all have
  // an ID to them"). A BEFORE INSERT trigger assigns max+1 for the org under a per-org advisory lock, so engine
  // calls, simulator-free inserts and pushed-in calls (ingest.ts) all get one; existing rows are numbered by date
  // in VOICE_SCHEMA_BACKFILL, then (org_id, call_no) is made unique.
  `ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS call_no integer`,
  `CREATE OR REPLACE FUNCTION voice_calls_assign_no() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN
     IF NEW.call_no IS NULL THEN
       PERFORM pg_advisory_xact_lock(7181, hashtext(NEW.org_id));
       SELECT coalesce(max(call_no), 0) + 1 INTO NEW.call_no FROM voice_calls WHERE org_id = NEW.org_id;
     END IF;
     RETURN NEW;
   END $fn$`,
  `DO $do$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'voice_calls_assign_no' AND tgrelid = 'voice_calls'::regclass) THEN
       CREATE TRIGGER voice_calls_assign_no BEFORE INSERT ON voice_calls FOR EACH ROW EXECUTE FUNCTION voice_calls_assign_no();
     END IF;
   END $do$`,
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
  // The number is part of the service (owner, 2026-10-02): when the subscription
  // ends or no longer pays for a number, it is scheduled for release
  // (status 'releasing' + why + when decided) and released on SignalWire once
  // release_eligible_at has passed (server/voice/number-release.ts).
  `ALTER TABLE voice_numbers ADD COLUMN IF NOT EXISTS release_reason text`,
  `ALTER TABLE voice_numbers ADD COLUMN IF NOT EXISTS release_scheduled_at timestamp`,
  `CREATE INDEX IF NOT EXISTS voice_numbers_release_due_idx ON voice_numbers(release_eligible_at) WHERE status = 'releasing' AND release_reason IS NOT NULL`,
  // Tiers + spam (owner, 2026-10-02: "all plans cover 500 spam calls that aren't
  // charged"): spam calls whose minutes were not counted this month, and those
  // minutes (billing-usage.ts recordVoiceCallUsage). `minutes` stays the billable total.
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS spam_free_calls integer NOT NULL DEFAULT 0`,
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS spam_free_minutes integer NOT NULL DEFAULT 0`,
  // Per-tier overage (owner, 2026-10-02: "for the crew and fleet the cost per
  // minute is 5 not 10 cents"): each call's overage minutes are kept in the
  // bucket of the rate in force when it was recorded ({"10": 30, "5": 120}),
  // and billed per bucket (billing-usage.ts), so a mid-month tier switch bills
  // every call at its own tier's rate. overage_cents_per_minute = the rate in
  // force at the month's latest call (like included_minutes).
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS overage_rate_minutes jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS overage_reported_rate_minutes jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS overage_cents_per_minute integer`,
  // The weekly spam report (spam-report.ts): one claimed row per org per week
  // (Monday, UTC) — the claim is what makes the email + bell exactly once.
  `CREATE TABLE IF NOT EXISTS voice_spam_reports (
     id bigserial PRIMARY KEY,
     org_id varchar NOT NULL,
     week_start date NOT NULL,
     spam_calls integer NOT NULL DEFAULT 0,
     blocked_calls integer NOT NULL DEFAULT 0,
     email text,
     bell boolean NOT NULL DEFAULT false,
     created_at timestamp DEFAULT now(),
     UNIQUE (org_id, week_start)
   )`,
  // Overage claims (server/voice/billing-usage.ts): one row per range of an org-month's overage
  // minutes at one rate, written under the account's lock BEFORE its Stripe invoice item, so two
  // settlements can never bill overlapping minutes; keeps the item / invoice and its state.
  `CREATE TABLE IF NOT EXISTS voice_overage_claims (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     org_id text NOT NULL,
     account_user_id integer NOT NULL,
     month text NOT NULL,
     cents_per_minute integer NOT NULL,
     from_minutes integer NOT NULL,
     to_minutes integer NOT NULL,
     minutes integer,
     state text NOT NULL DEFAULT 'creating',
     stripe_customer_id text,
     stripe_subscription_id text,
     billing_interval text,
     invoice_now boolean NOT NULL DEFAULT false,
     billed_on_customer boolean NOT NULL DEFAULT false,
     idempotency_key text,
     attempts integer NOT NULL DEFAULT 0,
     leased_until timestamp,
     lease_token uuid,
     claim_uid uuid NOT NULL DEFAULT gen_random_uuid(),
     stripe_invoice_item_id text,
     stripe_invoice_id text,
     error text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     UNIQUE (org_id, month, cents_per_minute, from_minutes),
     CONSTRAINT voice_overage_claims_range_check CHECK (from_minutes >= 0 AND to_minutes > from_minutes),
     CONSTRAINT voice_overage_claims_rate_check CHECK (cents_per_minute > 0),
     CONSTRAINT voice_overage_claims_minutes_check CHECK (minutes IS NULL OR minutes = to_minutes - from_minutes)
   )`,
  // (Audit #5: every column the CREATE's constraints name is declared in the CREATE itself — a fresh database
  // creates the table in one statement; the ALTER … ADD COLUMN IF NOT EXISTS lines below only bring a table
  // created by an earlier version up to it, and the constraints are added LAST, after every column exists.)
  `CREATE INDEX IF NOT EXISTS voice_overage_claims_account_state_idx ON voice_overage_claims (account_user_id, state)`,
  // Audit #3: a claim is the unit of work and carries its whole Stripe request — the interval and
  // whether it is invoiced now (as of the claim), its minutes, its idempotency key, its attempts.
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS billing_interval text`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS invoice_now boolean NOT NULL DEFAULT false`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS minutes integer`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS idempotency_key text`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
  // While a processor holds a claim (its Stripe call in flight) no other processor takes it; a lease
  // that ran out (a crash) frees it for reconciliation; the token fences a stale processor's writes.
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS leased_until timestamp`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS lease_token uuid`,
  // Audit #4: a globally unique claim id goes into the Stripe item's metadata (reconciliation adopts an item by
  // it); the subscription a claim was created under is its origin — billed_on_customer says the item is
  // invoiced on the customer instead of queued for that subscription's invoice (invoice_now is the older name).
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS claim_uid uuid NOT NULL DEFAULT gen_random_uuid()`,
  `ALTER TABLE voice_overage_claims ADD COLUMN IF NOT EXISTS billed_on_customer boolean NOT NULL DEFAULT false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS voice_overage_claims_uid_idx ON voice_overage_claims (claim_uid)`,
  `CREATE INDEX IF NOT EXISTS voice_overage_claims_subscription_idx ON voice_overage_claims (stripe_subscription_id, state)`,
  // A range is never empty or negative, the rate is positive, and the billed quantity IS the range (the claim
  // function also refuses an overlap before inserting). Added once to a table created before they existed.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_range_check') THEN
       ALTER TABLE voice_overage_claims ADD CONSTRAINT voice_overage_claims_range_check CHECK (from_minutes >= 0 AND to_minutes > from_minutes);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_rate_check') THEN
       ALTER TABLE voice_overage_claims ADD CONSTRAINT voice_overage_claims_rate_check CHECK (cents_per_minute > 0);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_minutes_check') THEN
       ALTER TABLE voice_overage_claims ADD CONSTRAINT voice_overage_claims_minutes_check CHECK (minutes IS NULL OR minutes = to_minutes - from_minutes);
     END IF;
   END $$`,
  // Non-overlapping ranges as a DATABASE invariant, per org, month and rate (an account's orgs each have their
  // own meter): an EXCLUDE constraint on int4range, which needs btree_gist for the equality columns. The
  // extension is created when this database user may (a superuser, or one with CREATE on the database and
  // the extension trusted); when it cannot be, the application check stands alone and the admin card says so
  // (server/voice/billing-usage.ts voiceOverageAdminStatus).
  `DO $$ BEGIN
     BEGIN
       CREATE EXTENSION IF NOT EXISTS btree_gist;
     EXCEPTION WHEN OTHERS THEN
       RAISE NOTICE 'btree_gist not available: %', SQLERRM;
     END;
     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')
        AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_no_overlap') THEN
       ALTER TABLE voice_overage_claims ADD CONSTRAINT voice_overage_claims_no_overlap
         EXCLUDE USING gist (org_id WITH =, month WITH =, cents_per_minute WITH =, int4range(from_minutes, to_minutes) WITH &&);
     END IF;
   END $$`,
  // The subscription a month's latest call was under (settlement claims only its own subscription's months).
  `ALTER TABLE voice_usage ADD COLUMN IF NOT EXISTS stripe_subscription_id text`,
  // The metering record of one call (audit #5): written before the call is marked processed, moved to
  // `done` in the same transaction as the meter's upsert — so a call is counted exactly once, and one
  // whose metering failed stays `pending` for the retry worker (server/voice/billing-usage.ts).
  `CREATE TABLE IF NOT EXISTS voice_call_meter (
     call_id varchar PRIMARY KEY,
     org_id varchar NOT NULL,
     account_user_id integer NOT NULL,
     outcome text,
     billed_minutes integer NOT NULL DEFAULT 0,
     started_at timestamp,
     state text NOT NULL DEFAULT 'pending',
     attempts integer NOT NULL DEFAULT 0,
     error text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     metered_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS voice_call_meter_state_idx ON voice_call_meter (state)`,
  // The settlement a subscription's end owes, written in the same transaction as the end
  // (server/voice/subscription.ts) and run by the sweep until it is done.
  `CREATE TABLE IF NOT EXISTS voice_settle_jobs (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     account_user_id integer NOT NULL,
     stripe_subscription_id text NOT NULL,
     stripe_customer_id text,
     billing_interval text,
     state text NOT NULL DEFAULT 'pending',
     attempts integer NOT NULL DEFAULT 0,
     error text,
     leased_until timestamp,
     lease_token uuid,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     done_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS voice_settle_jobs_state_idx ON voice_settle_jobs (state)`,
  `CREATE INDEX IF NOT EXISTS voice_settle_jobs_subscription_idx ON voice_settle_jobs (stripe_subscription_id, state)`,
  // Audit #4: jobs are append-only (a done job is never reopened; new work gets a new job), so a subscription
  // may have several; the lease keeps a webhook and a sweep off one job together, the token fences stale writes.
  `ALTER TABLE voice_settle_jobs ADD COLUMN IF NOT EXISTS leased_until timestamp`,
  `ALTER TABLE voice_settle_jobs ADD COLUMN IF NOT EXISTS lease_token uuid`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_settle_jobs_stripe_subscription_id_key') THEN
       ALTER TABLE voice_settle_jobs DROP CONSTRAINT voice_settle_jobs_stripe_subscription_id_key;
     END IF;
   END $$`,
  // ── end lane: numbers+billing ──

  // ── lane: studio-backend — append here ──
  // ── end lane: studio-backend ──

  // ── lane: calls+crm — append here ──
  // ── end lane: calls+crm ──
];

/**
 * One-off data fixes that follow the DDL (idempotent, run after it). Rows
 * metered before per-tier rates had one rate for every tier, 10 cents: their
 * overage goes into that bucket (only rows with overage and no bucket yet).
 */
export const VOICE_SCHEMA_BACKFILL: readonly string[] = [
  `UPDATE voice_usage SET overage_rate_minutes = jsonb_build_object('10', overage_minutes),
     overage_reported_rate_minutes = jsonb_build_object('10', overage_reported_minutes),
     overage_cents_per_minute = COALESCE(overage_cents_per_minute, 10)
   WHERE overage_minutes > 0 AND overage_rate_minutes = '{}'::jsonb`,
  // Calls from before call numbers existed: numbered after the org's highest, oldest first. Then unique per org.
  `WITH m AS (SELECT org_id, coalesce(max(call_no), 0) AS base FROM voice_calls GROUP BY org_id),
        s AS (SELECT c.id, m.base + row_number() OVER (PARTITION BY c.org_id ORDER BY c.started_at, c.created_at, c.id) AS n
                FROM voice_calls c JOIN m ON m.org_id = c.org_id WHERE c.call_no IS NULL)
   UPDATE voice_calls v SET call_no = s.n FROM s WHERE v.id = s.id`,
  `CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_org_call_no_idx ON voice_calls(org_id, call_no)`,
];

export const VOICE_TABLES: readonly string[] = [
  "voice_profiles", "voice_profile_versions", "voice_numbers", "voice_calls", "voice_escalations", "voice_spam", "voice_usage",
  "voice_spam_reports",
];

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Creates whatever is missing; safe to run on every boot and repeatedly. */
export async function ensureVoiceSchema(q?: Queryable): Promise<void> {
  const client = q ?? (await import("../db")).pool;
  for (const statement of VOICE_SCHEMA_DDL) await client.query(statement);
  for (const statement of VOICE_SCHEMA_BACKFILL) await client.query(statement);
}
