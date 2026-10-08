/**
 * Customers' own YouTube channels (Social Media → YouTube). Idempotent DDL:
 * boot runs it (server/routes.ts) and so does scripts/apply-schema-migration.ts.
 * shared/schema.ts mirrors the three tables.
 *
 *   youtube_customer_connections  one row per ConstructHUB account (user_id is
 *     the primary key, so one account has at most one channel; connecting
 *     again replaces it). Scoped like the other customer connections of the
 *     Social Media tool and Search Console: by the signed-in account. Both
 *     tokens are stored encrypted (server/gbp/token-crypto.ts, AES-256-GCM) and
 *     never leave the server. "Connected" means refresh_token IS NOT NULL — the
 *     row can exist with only a last error (a failed attempt).
 *
 *   youtube_customer_videos  one row per video a customer sends: first the
 *     file arriving in our storage (state receiving → ready), then the
 *     background upload to their channel (queued → uploading → processing →
 *     published | failed). The stored file is deleted once YouTube has it, and
 *     after 24 hours whatever happened.
 *
 *   youtube_upload_daily  how many uploads were started per Pacific day
 *     (YouTube's quota day): one row per account, and user_id 0 for the whole
 *     Google project (customers and the company channel together).
 */
import type { Queryable } from "./schema";

export const YOUTUBE_CUSTOMER_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS youtube_customer_connections (
     user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     channel_id text,
     channel_title text,
     channel_thumbnail text,
     refresh_token text,
     access_token text,
     expires_at timestamptz,
     scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
     connected_at timestamptz,
     needs_reconnect boolean NOT NULL DEFAULT false,
     last_error_code text,
     last_error text,
     last_error_at timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS youtube_customer_videos (
     id uuid PRIMARY KEY,
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     file_name text NOT NULL,
     mime text NOT NULL,
     bytes bigint NOT NULL,
     storage_mode text NOT NULL,
     storage_key text NOT NULL,
     storage_upload_id text,
     part_size integer NOT NULL,
     parts_total integer NOT NULL,
     parts_done jsonb NOT NULL DEFAULT '{}'::jsonb,
     file_deleted_at timestamptz,
     state text NOT NULL DEFAULT 'receiving',
     title text,
     description text,
     tags jsonb NOT NULL DEFAULT '[]'::jsonb,
     privacy text,
     made_for_kids boolean,
     certified_at timestamptz,
     channel_id text,
     channel_title text,
     youtube_video_id text,
     actual_privacy text,
     sent_bytes bigint NOT NULL DEFAULT 0,
     quota_day date,
     quota_spent boolean NOT NULL DEFAULT false,
     error_code text,
     error text,
     lease_until timestamptz,
     next_check_at timestamptz,
     checks integer NOT NULL DEFAULT 0,
     queued_at timestamptz,
     published_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS youtube_customer_videos_owner ON youtube_customer_videos (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS youtube_customer_videos_work ON youtube_customer_videos (state, queued_at) WHERE state IN ('queued','uploading','processing')`,
  `CREATE TABLE IF NOT EXISTS youtube_upload_daily (
     day date NOT NULL,
     user_id integer NOT NULL,
     used integer NOT NULL DEFAULT 0,
     PRIMARY KEY (day, user_id)
   )`,
];

export async function ensureYoutubeCustomerSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of YOUTUBE_CUSTOMER_DDL) await target.query(sql);
}
