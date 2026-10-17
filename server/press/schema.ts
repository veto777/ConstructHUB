/**
 * The Press Wire tables (shared/press.ts). Plain SQL on the shared pool, additive only, applied at boot.
 *
 *   press_orders       a paid package: credits bought, used and when they expire
 *   press_releases     one row per release: the customer's input, the AI's text, the wire's answers, the report
 *   press_messages     every email in and out of the pressrelease@ mailbox, tied to a release when the code matches
 *   press_inbox_state  the IMAP cursor (same shape as media_inbox_state)
 *   press_idea_marks   story ideas (ideas.ts) a customer dismissed or already turned into a release, per user
 *   press_autopilot    the monthly draft setting (autopilot.ts): on/off and the day of the month
 *   press_autopilot_runs  one row per user per month: the claim that keeps autopilot to one draft a month
 *   press_share_settings  where a live release is shared (share.ts): social destinations and Google Business Profiles
 *   press_shares       one row per release per place it was shared: the claim that makes sharing happen once
 * press_releases.send_* and press_autopilot.send_for_me hold "Send it for me" (send.ts).
 */
export const PRESS_DDL = `
CREATE TABLE IF NOT EXISTS press_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  email text NOT NULL,
  package_key text NOT NULL,
  tier text NOT NULL,
  credits integer NOT NULL,
  credits_used integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','paid')),
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS press_orders_session_uq ON press_orders (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS press_orders_user_idx ON press_orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS press_releases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  order_id integer REFERENCES press_orders(id) ON DELETE SET NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  code text NOT NULL UNIQUE,
  input jsonb NOT NULL,
  text jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  wire_notes text,
  wire_message_id text,
  live_url text,
  report jsonb,
  scheduled_for date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  live_at timestamptz,
  reported_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS press_releases_user_idx ON press_releases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS press_releases_status_idx ON press_releases (status, updated_at);

CREATE TABLE IF NOT EXISTS press_messages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  thread_key text,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  release_id integer REFERENCES press_releases(id) ON DELETE SET NULL,
  from_email text NOT NULL,
  from_name text,
  to_email text,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  kind text,
  reading jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','needs_owner','ignored','failed')),
  reason text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS press_messages_release_idx ON press_messages (release_id, received_at);
CREATE INDEX IF NOT EXISTS press_messages_status_idx ON press_messages (status, received_at);

-- Three tiers since 2026-10-16 (the wire's Budget / National / Premium): the tier check is replaced, never stacked.
ALTER TABLE press_orders DROP CONSTRAINT IF EXISTS press_orders_tier_check;
ALTER TABLE press_orders ADD CONSTRAINT press_orders_tier_check CHECK (tier IN ('budget','national','premium'));
ALTER TABLE press_releases DROP CONSTRAINT IF EXISTS press_releases_tier_check;
ALTER TABLE press_releases ADD CONSTRAINT press_releases_tier_check CHECK (tier IN ('budget','national','premium'));

CREATE TABLE IF NOT EXISTS press_inbox_state (
  mailbox text PRIMARY KEY, uid_validity text, last_uid bigint NOT NULL DEFAULT 0,
  last_pass_at timestamptz, last_pass_error text
);

CREATE TABLE IF NOT EXISTS press_idea_marks (
  user_id integer NOT NULL,
  idea_key text NOT NULL,
  mark text NOT NULL CHECK (mark IN ('dismissed','used')),
  release_id integer REFERENCES press_releases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idea_key)
);

CREATE TABLE IF NOT EXISTS press_autopilot (
  user_id integer PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  day_of_month integer NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  last_checked_at timestamptz,
  last_result text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS press_autopilot_runs (
  user_id integer NOT NULL,
  month text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('drafting','drafted','failed')),
  release_id integer REFERENCES press_releases(id) ON DELETE SET NULL,
  idea_key text,
  attempts integer NOT NULL DEFAULT 1,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

-- "Send it for me" (send.ts): a clean draft goes out at send_at unless the customer holds or edits it.
ALTER TABLE press_autopilot ADD COLUMN IF NOT EXISTS send_for_me boolean NOT NULL DEFAULT false;
ALTER TABLE press_releases ADD COLUMN IF NOT EXISTS send_for_me boolean NOT NULL DEFAULT false;
ALTER TABLE press_releases ADD COLUMN IF NOT EXISTS send_at timestamptz;
ALTER TABLE press_releases ADD COLUMN IF NOT EXISTS send_hash text;
ALTER TABLE press_releases ADD COLUMN IF NOT EXISTS send_note text;
CREATE INDEX IF NOT EXISTS press_releases_send_at_idx ON press_releases (send_at) WHERE send_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS press_share_settings (
  user_id integer PRIMARY KEY,
  destinations jsonb NOT NULL DEFAULT '[]'::jsonb,
  location_ids integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS press_shares (
  release_id integer NOT NULL REFERENCES press_releases(id) ON DELETE CASCADE,
  target_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('social','gbp')),
  label text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','queued','failed','skipped')),
  detail text,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, target_key)
);
`;

export async function ensurePressSchema(db: { query: (sql: string) => Promise<unknown> }) {
  await db.query(PRESS_DDL);
}
