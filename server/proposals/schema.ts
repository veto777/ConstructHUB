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
  `CREATE INDEX IF NOT EXISTS proposals_kind_idx ON proposals (kind, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS proposals_session_idx ON proposals (stripe_session_id) WHERE stripe_session_id IS NOT NULL`,
];

export async function ensureProposalsSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of PROPOSALS_DDL) await target.query(sql);
}
