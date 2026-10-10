/**
 * Code API tokens: short-lived (24–48 h) credentials a platform admin issues
 * from /admin/code-api for an AI agent or a developer.
 *
 *   Token:  chdev_<prefix 8>_<secret 64 hex>   shown ONCE at creation
 *   Stored: id dtk_…, prefix, suffix, sha256(token), scopes (read | write),
 *           its branch devapi/<id>, the base commit, who issued it, expiry.
 *
 * A chdev_ token authenticates ONLY /api/dev/v1 (./guard.ts) and never a
 * session route; the account API's chub_ keys never authenticate here.
 * Every request a token makes is written to dev_api_audit.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db";

export type DevScope = "read" | "write";
export const DEV_SCOPES: readonly DevScope[] = ["read", "write"];
export type HolderType = "agent" | "person";
export const HOLDER_TYPES: readonly HolderType[] = ["agent", "person"];

export const DEV_TOKEN_PREFIX = "chdev_";
export const DEV_TOKEN_RE = /^chdev_([a-z0-9]{8})_([a-f0-9]{64})$/;
/** Owner, 2026-10-10: a token lives 24 to 48 hours, then a new one is issued. */
export const MIN_TOKEN_HOURS = 24;
export const MAX_TOKEN_HOURS = 48;
/** Live (unrevoked, unexpired) tokens at once. */
export const MAX_LIVE_TOKENS = 10;
export const MAX_NAME = 80;

export type DevTokenRow = {
  id: string; prefix: string; suffix: string; name: string; holderType: HolderType; scopes: DevScope[];
  branch: string; baseSha: string; createdBy: number; createdByEmail: string;
  expiresAt: Date; revokedAt: Date | null; lastUsedAt: Date | null; submittedAt: Date | null; createdAt: Date;
};

export const DEV_API_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS dev_api_tokens (
     id text PRIMARY KEY,
     prefix text NOT NULL UNIQUE,
     suffix text NOT NULL,
     secret_hash text NOT NULL,
     name text NOT NULL,
     holder_type text NOT NULL,
     scopes text[] NOT NULL,
     branch text NOT NULL,
     base_sha text NOT NULL,
     created_by integer NOT NULL,
     created_by_email text NOT NULL,
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     last_used_at timestamptz,
     submitted_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dev_api_audit (
     id bigserial PRIMARY KEY,
     token_id text NOT NULL,
     at timestamptz NOT NULL DEFAULT now(),
     method text NOT NULL,
     path text NOT NULL,
     status integer NOT NULL,
     ip text,
     detail jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS dev_api_audit_token_idx ON dev_api_audit(token_id, at DESC)`,
];

export async function ensureDevApiSchema(): Promise<void> {
  for (const sql of DEV_API_DDL) await pool.query(sql);
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomPrefix = () => Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");

function toRow(r: any): DevTokenRow & { secretHash: string } {
  return {
    id: r.id, prefix: r.prefix, suffix: r.suffix, secretHash: r.secret_hash, name: r.name, holderType: r.holder_type,
    scopes: (r.scopes ?? []).filter((s: string): s is DevScope => s === "read" || s === "write"),
    branch: r.branch, baseSha: r.base_sha, createdBy: Number(r.created_by), createdByEmail: r.created_by_email,
    expiresAt: r.expires_at, revokedAt: r.revoked_at ?? null, lastUsedAt: r.last_used_at ?? null,
    submittedAt: r.submitted_at ?? null, createdAt: r.created_at,
  };
}
const publicRow = ({ secretHash: _h, ...row }: DevTokenRow & { secretHash: string }): DevTokenRow => row;

/** "Bearer chdev_…" or the bare token → its parts; null when it is not one. */
export function parseDevToken(bearer: string | undefined | null): { token: string; prefix: string } | null {
  const raw = String(bearer ?? "").trim().replace(/^Bearer\s+/i, "");
  const m = DEV_TOKEN_RE.exec(raw);
  return m ? { token: raw, prefix: m[1] } : null;
}

export type IssueInput = { name: unknown; holderType: unknown; hours: unknown; scopes: unknown };
export type ValidIssue = { name: string; holderType: HolderType; hours: number; scopes: DevScope[] };

/** The one plain sentence for a bad issue request, or the cleaned input. */
export function validateIssue(b: IssueInput): ValidIssue | string {
  const name = typeof b.name === "string" ? b.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_NAME) return `Name who the token is for (1 to ${MAX_NAME} characters).`;
  if (!HOLDER_TYPES.includes(b.holderType as HolderType)) return 'Say whether the token is for an "agent" or a "person".';
  if (!Number.isInteger(b.hours) || (b.hours as number) < MIN_TOKEN_HOURS || (b.hours as number) > MAX_TOKEN_HOURS) {
    return `A token lasts ${MIN_TOKEN_HOURS} to ${MAX_TOKEN_HOURS} hours.`;
  }
  if (!Array.isArray(b.scopes) || !b.scopes.length || !b.scopes.every((s) => DEV_SCOPES.includes(s))) return 'Choose the scopes: "read", or "read" and "write".';
  const scopes = DEV_SCOPES.filter((s) => (b.scopes as unknown[]).includes(s));
  if (scopes.includes("write") && !scopes.includes("read")) return 'A token that writes also needs "read".';
  return { name, holderType: b.holderType as HolderType, hours: b.hours as number, scopes };
}

/** A fresh id + token, before the branch exists (the branch name comes from the id). */
export function newTokenIdentity(): { id: string; prefix: string; secret: string; token: string; branch: string } {
  const id = `dtk_${randomBytes(9).toString("hex")}`;
  const prefix = randomPrefix();
  const secret = randomBytes(32).toString("hex");
  return { id, prefix, secret, token: `${DEV_TOKEN_PREFIX}${prefix}_${secret}`, branch: `devapi/${id.slice(4)}` };
}

export class DevTokenLimitError extends Error {
  status = 403;
  constructor(public limit: number) { super(`Up to ${limit} Code API tokens can be live at once. Revoke one first.`); }
}

/** Live tokens right now (unrevoked and unexpired). */
export async function countLiveTokens(q: { query: typeof pool.query } = pool): Promise<number> {
  const { rows: [r] } = await q.query("SELECT count(*)::int n FROM dev_api_tokens WHERE revoked_at IS NULL AND expires_at > now()");
  return r?.n ?? 0;
}

/** Store the token (its hash) under the live-token ceiling, in one locked transaction. */
export async function insertToken(identity: ReturnType<typeof newTokenIdentity>, input: ValidIssue, baseSha: string, admin: { id: number; email: string }): Promise<DevTokenRow> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(8161, 0)");
    if ((await countLiveTokens(c as any)) >= MAX_LIVE_TOKENS) throw new DevTokenLimitError(MAX_LIVE_TOKENS);
    const { rows: [r] } = await c.query(
      `INSERT INTO dev_api_tokens(id, prefix, suffix, secret_hash, name, holder_type, scopes, branch, base_sha, created_by, created_by_email, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(hours => $12)) RETURNING *`,
      [identity.id, identity.prefix, identity.secret.slice(-4), sha256(identity.token), input.name, input.holderType, input.scopes,
        identity.branch, baseSha, admin.id, admin.email, input.hours]);
    await c.query("COMMIT");
    return publicRow(toRow(r));
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** The ceiling check alone, before a branch is cut for a token that could not be stored. */
export async function assertUnderLimit(): Promise<void> {
  if ((await countLiveTokens()) >= MAX_LIVE_TOKENS) throw new DevTokenLimitError(MAX_LIVE_TOKENS);
}

/** Bearer → live token row, or null (unknown, wrong secret, revoked or expired). */
export async function verifyDevToken(bearer: string | undefined | null, now = new Date()): Promise<DevTokenRow | null> {
  const parsed = parseDevToken(bearer);
  if (!parsed) return null;
  const { rows: [r] } = await pool.query("SELECT * FROM dev_api_tokens WHERE prefix=$1", [parsed.prefix]);
  if (!r) return null;
  const row = toRow(r);
  const expected = Buffer.from(row.secretHash, "hex"), actual = Buffer.from(sha256(parsed.token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (row.revokedAt || new Date(row.expiresAt).getTime() <= now.getTime()) return null;
  pool.query("UPDATE dev_api_tokens SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')", [row.id]).catch(() => {});
  return publicRow(row);
}

/** Every token issued in the last `days` days, newest first (the admin page's list). */
export async function listTokens(days = 14): Promise<DevTokenRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM dev_api_tokens WHERE created_at > now() - make_interval(days => $1) ORDER BY created_at DESC LIMIT 200", [days]);
  return rows.map((r) => publicRow(toRow(r)));
}

export async function revokeToken(id: string): Promise<DevTokenRow | null> {
  const { rows: [r] } = await pool.query("UPDATE dev_api_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING *", [id]);
  return r ? publicRow(toRow(r)) : null;
}

export async function markSubmitted(id: string): Promise<void> {
  await pool.query("UPDATE dev_api_tokens SET submitted_at=now() WHERE id=$1", [id]);
}

export async function audit(tokenId: string, entry: { method: string; path: string; status: number; ip: string | null; detail?: Record<string, unknown> | null }): Promise<void> {
  await pool.query("INSERT INTO dev_api_audit(token_id, method, path, status, ip, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [tokenId, entry.method, entry.path.slice(0, 500), entry.status, entry.ip, entry.detail ? JSON.stringify(entry.detail) : null]);
}

export async function recentAudit(tokenId: string, limit = 50) {
  const { rows } = await pool.query("SELECT at, method, path, status, detail FROM dev_api_audit WHERE token_id=$1 ORDER BY at DESC LIMIT $2", [tokenId, limit]);
  return rows.map((r) => ({ at: new Date(r.at).toISOString(), method: r.method, path: r.path, status: r.status, detail: r.detail ?? null }));
}

export type TokenStatus = "live" | "expired" | "revoked";
export function tokenStatus(row: Pick<DevTokenRow, "revokedAt" | "expiresAt">, now = new Date()): TokenStatus {
  if (row.revokedAt) return "revoked";
  return new Date(row.expiresAt).getTime() <= now.getTime() ? "expired" : "live";
}
