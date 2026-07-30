import pg from "pg";

/**
 * Direct dev-DB access for test setup/teardown that shouldn't fight product
 * constraints (seat limits, email delivery). Throwaway local database only.
 */
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export const ASPIRE_ORG = "b839980a-ad26-44d4-9e83-df427bd60fe8";
export const ALPINE_ORG = "1e3050c1-3cfd-4d9b-ba5a-1c19ce074897";

/** Create a pending invitation row; returns its token. */
export async function makeInvitation(orgId: string, email: string, role = "field"): Promise<string> {
  const token = `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await q(
    `insert into crm_invitations (org_id, email, role, token, expires_at)
     values ($1, $2, $3, $4, now() + interval '14 days')`,
    [orgId, email, role, token],
  );
  return token;
}

export async function deleteInvitation(token: string) {
  await q(`delete from crm_invitations where token = $1`, [token]);
}
