/**
 * The Press Wire tables (shared/press.ts). Plain SQL on the shared pool, additive only, applied at boot.
 *
 *   press_orders       a paid package: credits bought, used and when they expire
 *   press_releases     one row per release: the customer's input, the AI's text, the wire's answers, the report
 *   press_messages     every email in and out of the pressrelease@ mailbox, tied to a release when the code matches
 *   press_inbox_state  the IMAP cursor (same shape as media_inbox_state)
 */
export const PRESS_DDL = `
CREATE TABLE IF NOT EXISTS press_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  email text NOT NULL,
  package_key text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('budget','premium')),
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
  tier text NOT NULL CHECK (tier IN ('budget','premium')),
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

CREATE TABLE IF NOT EXISTS press_inbox_state (
  mailbox text PRIMARY KEY, uid_validity text, last_uid bigint NOT NULL DEFAULT 0,
  last_pass_at timestamptz, last_pass_error text
);
`;

export async function ensurePressSchema(db: { query: (sql: string) => Promise<unknown> }) {
  await db.query(PRESS_DDL);
}
