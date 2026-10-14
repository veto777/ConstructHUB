/** The media@ relationships inbox tables (shared/media-inbox.ts). Additive only; applied at boot. */
export const MEDIA_INBOX_DDL = `
CREATE TABLE IF NOT EXISTS media_partners (
 id serial PRIMARY KEY, company text NOT NULL, domain text UNIQUE,
 kind text NOT NULL DEFAULT 'other' CHECK(kind IN ('directory','article','news','pbn','other')),
 status text NOT NULL DEFAULT 'talking' CHECK(status IN ('talking','agreed','finalized','declined')),
 contact_name text, contact_email text, summary text, agreement text, to_finalize text, cost_terms text,
 owner_question text, agreed_at timestamptz, added_to text, last_message_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_messages (
 id serial PRIMARY KEY, mailbox text NOT NULL, message_id text NOT NULL UNIQUE, thread_key text,
 direction text NOT NULL CHECK(direction IN ('in','out')), from_email text NOT NULL, from_name text, to_email text,
 cc text, subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', references_ids text,
 received_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','replied','needs_owner','automated','failed')),
 reason text, attempts integer NOT NULL DEFAULT 0, partner_id integer REFERENCES media_partners(id) ON DELETE SET NULL,
 reply_id integer REFERENCES media_messages(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_messages_thread ON media_messages(thread_key, received_at);
CREATE INDEX IF NOT EXISTS media_messages_status ON media_messages(status, received_at);
-- Follow-ups (owner, 2026-10-14): what each email we sent was for, and when an unanswered one was acted on.
ALTER TABLE media_messages ADD COLUMN IF NOT EXISTS purpose text, ADD COLUMN IF NOT EXISTS followed_up_at timestamptz;
ALTER TABLE media_partners ADD COLUMN IF NOT EXISTS tried_emails text[] NOT NULL DEFAULT '{}';
-- First-contact queue (owner, 2026-10-14: "find many many more"): vetted directories that publish an email, sent a
-- few a day so a new mailbox stays out of spam folders.
CREATE TABLE IF NOT EXISTS media_outreach_queue (
 id serial PRIMARY KEY, domain text NOT NULL UNIQUE, company text NOT NULL, kind text NOT NULL DEFAULT 'directory',
 to_email text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','skipped')), reason text,
 source text NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS media_outreach_queue_status ON media_outreach_queue(status, id);
-- Auto-reply next steps, acted on automatically (owner, 2026-10-14: "do everything automatically").
ALTER TABLE media_messages ADD COLUMN IF NOT EXISTS next_link text, ADD COLUMN IF NOT EXISTS next_contact text,
 ADD COLUMN IF NOT EXISTS next_contact_role text, ADD COLUMN IF NOT EXISTS acted_at timestamptz, ADD COLUMN IF NOT EXISTS action_result text;
CREATE TABLE IF NOT EXISTS media_inbox_state (
 mailbox text PRIMARY KEY, uid_validity text, last_uid bigint NOT NULL DEFAULT 0,
 last_pass_at timestamptz, last_pass_error text
);
`;

export async function ensureMediaInboxSchema(db: { query: (sql: string) => Promise<unknown> }) {
  await db.query(MEDIA_INBOX_DDL);
}
