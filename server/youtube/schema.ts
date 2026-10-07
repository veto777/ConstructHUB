/**
 * youtube_connection — the ONE site-level YouTube channel connection (the
 * company channel the tutorial videos are uploaded to; /admin/youtube).
 * Idempotent DDL: boot runs it (server/routes.ts) and so does
 * scripts/apply-schema-migration.ts. shared/schema.ts `youtubeConnection`
 * mirrors it.
 *
 * One row at most (id is pinned to 1). The row can exist without a
 * connection: a failed attempt keeps its last error here so the admin page
 * can say what went wrong. "Connected" means refresh_token IS NOT NULL.
 * Both tokens are stored encrypted (server/gbp/token-crypto.ts, AES-256-GCM,
 * the same as the Search Console grant) and never leave the server.
 */
export const YOUTUBE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS youtube_connection (
     id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     channel_id text,
     channel_title text,
     refresh_token text,
     access_token text,
     expires_at timestamptz,
     scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
     connected_by integer,
     connected_by_email text,
     connected_at timestamptz,
     needs_reconnect boolean NOT NULL DEFAULT false,
     last_error_code text,
     last_error text,
     last_error_at timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function ensureYoutubeSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of YOUTUBE_DDL) await target.query(sql);
}
