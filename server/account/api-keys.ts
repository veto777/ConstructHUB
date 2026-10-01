/**
 * Public API keys for an account (Account → API keys), and their metering.
 *
 *   Token:  chub_<prefix 8>_<secret 64 hex>   shown ONCE at creation
 *   Stored: id key_…, prefix, suffix (last 4 of the secret), sha256(token),
 *           scopes (read | write), optional per-key monthly unit cap, expiry.
 *
 *   createApiKey(userId, {name, scopes, monthlyUnitLimit?, expiresInDays?}) -> { secret, row }
 *   verifyApiKey(bearer)        -> row | null (hash compare; revoked/expired -> null)
 *   recordUnits(keyId, userId, units[, requests]) -> one row per key per UTC day
 *   unitsThisMonth(keyId | userId) -> units used since the 1st (UTC)
 *
 * These keys authenticate ONLY the /api/v1 public API (server/public-api); no
 * session route accepts them. The CRM's chk_ keys are a separate system.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db";

export type ApiScope = "read" | "write";
export const API_SCOPES: readonly ApiScope[] = ["read", "write"];
export const isApiScope = (v: unknown): v is ApiScope => v === "read" || v === "write";

export type ApiKeyRow = {
  id: string;
  userId: number;
  name: string;
  prefix: string;
  suffix: string;
  scopes: ApiScope[];
  monthlyUnitLimit: number | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** What a session endpoint lists: never the hash. */
export type ApiKeyItem = {
  id: string; name: string; prefix: string; suffix: string; scopes: ApiScope[];
  monthlyUnitLimit: number | null; unitsThisMonth: number;
  createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};

export const API_KEY_TOKEN_PREFIX = "chub_";
const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;
/** `chub_<prefix>_<secret>`; the prefix is lowercase alphanumeric, the secret hex. */
export const API_KEY_TOKEN_RE = /^chub_([a-z0-9]{8})_([a-f0-9]{64})$/;
export const MAX_KEY_NAME = 80;
export const MAX_EXPIRES_IN_DAYS = 3650;
/** last_used_at is written at most this often per key (one UPDATE per burst, not per call). */
const LAST_USED_THROTTLE_SECONDS = 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomPrefix = () => Array.from(randomBytes(PREFIX_LENGTH), (b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join("");

const COLUMNS = "id, user_id, name, prefix, suffix, secret_hash, scopes, monthly_unit_limit, expires_at, last_used_at, revoked_at, created_at";
function toRow(r: any): ApiKeyRow & { secretHash: string } {
  return {
    id: r.id, userId: Number(r.user_id), name: r.name, prefix: r.prefix, suffix: r.suffix, secretHash: r.secret_hash,
    scopes: (r.scopes ?? []).filter(isApiScope),
    monthlyUnitLimit: r.monthly_unit_limit == null ? null : Number(r.monthly_unit_limit),
    expiresAt: r.expires_at ?? null, lastUsedAt: r.last_used_at ?? null, revokedAt: r.revoked_at ?? null, createdAt: r.created_at,
  };
}
const publicRow = ({ secretHash: _hash, ...row }: ApiKeyRow & { secretHash: string }): ApiKeyRow => row;

/** Accepts "Bearer chub_…" or the bare token; null when it is not a chub_ token. */
export function parseApiKeyToken(bearer: string | undefined | null): { token: string; prefix: string } | null {
  const raw = String(bearer ?? "").trim().replace(/^Bearer\s+/i, "");
  const m = API_KEY_TOKEN_RE.exec(raw);
  return m ? { token: raw, prefix: m[1] } : null;
}

/** Does the Authorization header carry one of OUR tokens (even a malformed one)? */
export const looksLikeApiKey = (bearer: string | undefined | null) =>
  /^Bearer\s+chub_/i.test(String(bearer ?? "").trim());

export type CreateApiKeyInput = {
  name: string;
  scopes: readonly string[];
  monthlyUnitLimit?: number | null;
  expiresInDays?: number | null;
};

export class ApiKeyInputError extends Error {
  status = 400;
}

function validateName(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!n) throw new ApiKeyInputError("Give the key a name.");
  if (n.length > MAX_KEY_NAME) throw new ApiKeyInputError(`Key names are at most ${MAX_KEY_NAME} characters.`);
  return n;
}
function validateScopes(scopes: unknown): ApiScope[] {
  if (!Array.isArray(scopes) || !scopes.length) throw new ApiKeyInputError("Choose at least one scope: read or write.");
  const out = [...new Set(scopes)];
  if (!out.every(isApiScope)) throw new ApiKeyInputError("Scopes are read and write only.");
  return API_SCOPES.filter((s) => out.includes(s));
}
function validateUnitLimit(limit: unknown): number | null {
  if (limit === undefined || limit === null || limit === "") return null;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000) throw new ApiKeyInputError("The monthly unit limit must be a whole number of at least 1.");
  return n;
}
function validateExpiresInDays(days: unknown): number | null {
  if (days === undefined || days === null || days === "") return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXPIRES_IN_DAYS) throw new ApiKeyInputError(`Expiry is between 1 and ${MAX_EXPIRES_IN_DAYS} days.`);
  return n;
}

/**
 * Mint a key. The returned `secret` is the full token (chub_…) and is the only
 * time it exists in plaintext: show it once, never log it.
 */
export async function createApiKey(userId: number, input: CreateApiKeyInput): Promise<{ secret: string; row: ApiKeyRow }> {
  if (!Number.isInteger(userId) || userId <= 0) throw new ApiKeyInputError("An account is required.");
  const name = validateName(input.name);
  const scopes = validateScopes(input.scopes);
  const monthlyUnitLimit = validateUnitLimit(input.monthlyUnitLimit);
  const expiresInDays = validateExpiresInDays(input.expiresInDays);
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = randomPrefix();
    const secret = randomBytes(SECRET_BYTES).toString("hex");
    const token = `${API_KEY_TOKEN_PREFIX}${prefix}_${secret}`;
    const id = `key_${randomBytes(12).toString("hex")}`;
    try {
      const { rows: [r] } = await pool.query(
        `INSERT INTO account_api_keys(id, user_id, name, prefix, suffix, secret_hash, scopes, monthly_unit_limit, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
        [id, userId, name, prefix, secret.slice(-4), sha256(token), scopes, monthlyUnitLimit, expiresAt]);
      return { secret: token, row: publicRow(toRow(r)) };
    } catch (e: any) {
      if (e?.code === "23505" && attempt < 4) continue; // prefix collision: draw again
      throw e;
    }
  }
  throw new Error("createApiKey: could not allocate a unique key prefix");
}

/**
 * Resolve a bearer token to its key row, or null: unknown prefix, wrong
 * secret (constant-time compare), revoked or expired. Stamps last_used_at
 * (throttled) on success.
 */
export async function verifyApiKey(bearer: string | undefined | null, now = new Date()): Promise<ApiKeyRow | null> {
  const parsed = parseApiKeyToken(bearer);
  if (!parsed) return null;
  const { rows: [r] } = await pool.query(`SELECT ${COLUMNS} FROM account_api_keys WHERE prefix=$1`, [parsed.prefix]);
  if (!r) return null;
  const row = toRow(r);
  const expected = Buffer.from(row.secretHash, "hex");
  const actual = Buffer.from(sha256(parsed.token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) return null;
  pool.query(
    `UPDATE account_api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2))`,
    [row.id, LAST_USED_THROTTLE_SECONDS]).catch(() => {});
  return publicRow(row);
}

/** The account's live keys, newest first (revoked keys are gone from the list). */
export async function listApiKeys(userId: number): Promise<ApiKeyRow[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM account_api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`, [userId]);
  return rows.map((r) => publicRow(toRow(r)));
}

export async function getApiKey(userId: number, id: string): Promise<ApiKeyRow | null> {
  const { rows: [r] } = await pool.query(
    `SELECT ${COLUMNS} FROM account_api_keys WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL`, [userId, id]);
  return r ? publicRow(toRow(r)) : null;
}

/** Rename or re-cap a key the account owns; null when there is no such live key. */
export async function updateApiKey(userId: number, id: string, patch: { name?: unknown; monthlyUnitLimit?: unknown }): Promise<ApiKeyRow | null> {
  const sets: string[] = [], values: unknown[] = [userId, id];
  if (patch.name !== undefined) { values.push(validateName(patch.name)); sets.push(`name=$${values.length}`); }
  if (patch.monthlyUnitLimit !== undefined) { values.push(validateUnitLimit(patch.monthlyUnitLimit)); sets.push(`monthly_unit_limit=$${values.length}`); }
  if (!sets.length) return getApiKey(userId, id);
  const { rows: [r] } = await pool.query(
    `UPDATE account_api_keys SET ${sets.join(", ")} WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING ${COLUMNS}`, values);
  return r ? publicRow(toRow(r)) : null;
}

/** Revoke (soft-delete) a key the account owns; false when there was no live key. */
export async function revokeApiKey(userId: number, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE account_api_keys SET revoked_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL", [userId, id]);
  return rowCount === 1;
}

// ── Metering ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD of an instant, in UTC (the usage day). */
export const usageDay = (d = new Date()) => d.toISOString().slice(0, 10);
/** YYYY-MM-01 of the current UTC month: where this month's units start. */
export const apiMonthStart = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;
/** First instant of next month (UTC), when the monthly units reset. */
export const apiMonthResetsAt = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

/** Add units (and requests, default 1) to the key's row for today. */
export async function recordUnits(keyId: string, userId: number, units: number, requests = 1, now = new Date()): Promise<void> {
  const u = Math.max(0, Math.floor(Number(units) || 0)), r = Math.max(0, Math.floor(Number(requests) || 0));
  if (!u && !r) return;
  await pool.query(
    `INSERT INTO account_api_usage(key_id, user_id, day, units, requests) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key_id, day) DO UPDATE SET units = account_api_usage.units + EXCLUDED.units, requests = account_api_usage.requests + EXCLUDED.requests`,
    [keyId, userId, usageDay(now), u, r]);
}

/** Units used since the 1st of the month (UTC): by key (string id) or by account (numeric user id). */
export async function unitsThisMonth(ref: string | number, now = new Date()): Promise<number> {
  const byKey = typeof ref === "string";
  const { rows: [r] } = await pool.query(
    `SELECT coalesce(sum(units), 0)::int AS units FROM account_api_usage WHERE ${byKey ? "key_id" : "user_id"}=$1 AND day >= $2::date`,
    [ref, apiMonthStart(now)]);
  return r?.units ?? 0;
}

/** This month's units for the key and for the whole account, in one query. */
export async function monthlyUsage(keyId: string, userId: number, now = new Date()): Promise<{ key: number; user: number }> {
  const { rows: [r] } = await pool.query(
    `SELECT coalesce(sum(units) FILTER (WHERE key_id=$1), 0)::int AS key_units, coalesce(sum(units), 0)::int AS user_units
       FROM account_api_usage WHERE user_id=$2 AND day >= $3::date`,
    [keyId, userId, apiMonthStart(now)]);
  return { key: r?.key_units ?? 0, user: r?.user_units ?? 0 };
}

export type UsageDay = { date: string; units: number; requests: number; byKey: Record<string, number> };

/** Daily usage for the last `days` days (today included), oldest first, with per-key units. */
export async function usageByDay(userId: number, days = 30, now = new Date()): Promise<{ days: UsageDay[]; totals: { units: number; requests: number } }> {
  const span = Math.min(366, Math.max(1, Math.floor(Number(days) || 30)));
  const since = new Date(now.getTime() - (span - 1) * 86_400_000);
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS date, key_id, units, requests FROM account_api_usage
      WHERE user_id=$1 AND day >= $2::date AND day <= $3::date ORDER BY day ASC`,
    [userId, usageDay(since), usageDay(now)]);
  const byDate = new Map<string, UsageDay>();
  for (let i = 0; i < span; i++) {
    const date = usageDay(new Date(since.getTime() + i * 86_400_000));
    byDate.set(date, { date, units: 0, requests: 0, byKey: {} });
  }
  const totals = { units: 0, requests: 0 };
  for (const r of rows) {
    const d = byDate.get(r.date);
    if (!d) continue;
    d.units += r.units; d.requests += r.requests; d.byKey[r.key_id] = (d.byKey[r.key_id] ?? 0) + r.units;
    totals.units += r.units; totals.requests += r.requests;
  }
  return { days: [...byDate.values()], totals };
}

/** The session-endpoint shape for one key (no hash, no secret). */
export function serializeApiKey(row: ApiKeyRow, unitsUsedThisMonth = 0): ApiKeyItem {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: row.id, name: row.name, prefix: row.prefix, suffix: row.suffix, scopes: row.scopes,
    monthlyUnitLimit: row.monthlyUnitLimit, unitsThisMonth: unitsUsedThisMonth,
    createdAt: new Date(row.createdAt).toISOString(), lastUsedAt: iso(row.lastUsedAt), expiresAt: iso(row.expiresAt),
  };
}
