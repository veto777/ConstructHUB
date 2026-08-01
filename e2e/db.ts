import pg from "pg";
import { createHash, randomBytes } from "crypto";

/**
 * Direct dev-DB access for test setup/teardown that shouldn't fight product
 * constraints (seat limits, email delivery). Throwaway local database only.
 *
 * Lane isolation: E2E_DB picks the database name (default constructhub_dev)
 * so each agent runs against its own constructhub_dev_* clone. The name must
 * start with constructhub_dev — the live database is never an e2e target.
 */
const e2eDb = process.env.E2E_DB ?? "constructhub_dev";
if (!e2eDb.startsWith("constructhub_dev")) {
  throw new Error(
    `E2E_DB must start with "constructhub_dev" (got "${e2eDb}") — refusing to touch the live database`,
  );
}

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/${e2eDb}`,
});

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Insert a client session row exactly as a redeemed magic link would;
 * returns the RAW crm_client cookie token. The public document pages are
 * email-gated — specs that browse them as "the client" need this.
 */
export async function makeClientSession(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return raw;
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
