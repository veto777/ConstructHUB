/**
 * proposals + proposal_files (shared/proposals.ts). Idempotent DDL: boot runs it (server/routes.ts).
 * A template and an offer share one table (kind); an offer is a copy of a template made for one recipient.
 * The attached PDF lives in Postgres (bytea, at most MAX_PDF_BYTES) so a proposal needs no object storage.
 */
import type { Queryable } from "../ops/schema";

export const PROPOSALS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS proposal_files (
     id bigserial PRIMARY KEY,
     name text NOT NULL,
     content_type text NOT NULL DEFAULT 'application/pdf',
     bytes integer NOT NULL,
     data bytea NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS proposals (
     id bigserial PRIMARY KEY,
     kind text NOT NULL CHECK (kind IN ('template', 'offer')),
     name text NOT NULL,
     status text NOT NULL DEFAULT 'draft',
     public_token text NOT NULL UNIQUE,
     template_id bigint,
     recipient_name text,
     recipient_email text,
     recipient_company text,
     content jsonb NOT NULL DEFAULT '{}'::jsonb,
     file_id bigint REFERENCES proposal_files(id) ON DELETE SET NULL,
     expires_at timestamptz,
     selection jsonb,
     totals jsonb,
     signature jsonb,
     payment_method text,
     card_fee_cents integer NOT NULL DEFAULT 0,
     paid_cents integer,
     payment_status text,
     stripe_session_id text,
     stripe_customer_id text,
     stripe_subscription_id text,
     events jsonb NOT NULL DEFAULT '[]'::jsonb,
     created_by integer,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     sent_at timestamptz,
     viewed_at timestamptz,
     signed_at timestamptz,
     paid_at timestamptz
   )`,
  // CC'd on the offer email, the signed copy and the payment receipt (comma-separated).
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS recipient_cc text`,
  // A test copy (the admin signs it like the client; payment is off) and when the company signed (first send).
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS countersigned_at timestamptz`,
  // Open tracking, like CRM estimates: opens counted once per IP per 30 minutes; the "came back" alert once a day.
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS first_view_ip text`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_view_ip text`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reopen_alerted_on date`,
  // What's due today can be paid in parts (owner, 2026-10-25): one row per Stripe Checkout, any amount up to what's
  // left, each on its own card or bank account. amount_cents is before the card fee. Auto-pay is a subscription
  // schedule made once it's all paid (shared/proposals.ts autoPaySchedule), starting a month later.
  `CREATE TABLE IF NOT EXISTS proposal_payments (
     id bigserial PRIMARY KEY,
     proposal_id bigint NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
     stripe_session_id text NOT NULL UNIQUE,
     method text NOT NULL CHECK (method IN ('ach', 'card')),
     amount_cents integer NOT NULL CHECK (amount_cents > 0),
     fee_cents integer NOT NULL DEFAULT 0,
     status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'paid', 'failed', 'expired')),
     payment_intent_id text,
     payment_method_id text,
     card_last4 text,
     created_at timestamptz NOT NULL DEFAULT now(),
     paid_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS proposal_payments_proposal_idx ON proposal_payments (proposal_id, created_at)`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS stripe_schedule_id text`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS autopay_starts_at timestamptz`,
  // Invoices for what's still due today (shared/proposals.ts invoiceLines): sent by the admin, or every day once
  // part of it is paid (runProposalReminders) unless paused.
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS invoice_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_invoice_at timestamptz`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reminders_paused boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS proposals_kind_idx ON proposals (kind, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS proposals_session_idx ON proposals (stripe_session_id) WHERE stripe_session_id IS NOT NULL`,
];

export async function ensureProposalsSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of PROPOSALS_DDL) await target.query(sql);
}
