/**
 * admin_access_grants (server/access-grants.ts): one row per grant a platform
 * admin made on /admin/access. Kept apart from the routes so
 * scripts/apply-schema-migration.ts can run it without loading the server.
 */
/** Idempotent DDL (boot runs it; so does scripts/apply-schema-migration.ts). Mirror: shared/schema.ts adminAccessGrants. */
export const ACCESS_GRANTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS admin_access_grants (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     subscription_id integer,
     plan text NOT NULL,
     days integer NOT NULL CHECK (days > 0),
     note text,
     granted_by_user_id integer NOT NULL,
     granted_by_email text NOT NULL,
     granted_at timestamptz NOT NULL DEFAULT now(),
     ends_at timestamptz NOT NULL,
     previous jsonb,
     revoked_at timestamptz,
     revoked_by_user_id integer,
     revoked_by_email text,
     replaced_at timestamptz,
     replaced_by_grant_id integer
   )`,
  `CREATE INDEX IF NOT EXISTS admin_access_grants_user_idx ON admin_access_grants (user_id, granted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_access_grants_open_idx ON admin_access_grants (ends_at) WHERE revoked_at IS NULL AND replaced_at IS NULL`,
];
