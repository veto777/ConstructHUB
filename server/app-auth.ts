import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { pool } from "./db";
import { requestHost } from "./site-context";
import { safeNextPath } from "./app-shell";

export const appAuthHost = (req: Request) => requestHost(req);
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export async function ensureAppAuthSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_auth_codes (
    code_hash text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('login','redirect')),
    next text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes'
  ); CREATE INDEX IF NOT EXISTS app_auth_codes_expiry ON app_auth_codes(expires_at);`);
}

/** Only called after provider authentication or completion of a bound connect flow. */
export async function mintAppCode(userId: number, host: string, purpose: "login" | "redirect", next?: string) {
  const code = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO app_auth_codes(code_hash,user_id,host,purpose,next) VALUES($1,$2,$3,$4,$5)",
    [hash(code), userId, host, purpose, safeNextPath(next) ?? "/"]);
  return code;
}

/** DELETE RETURNING makes competing requests/replays single-use, including across processes. */
export async function consumeAppCode(code: unknown, host: string) {
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) return null;
  const { rows } = await pool.query<{ user_id: number; purpose: "login" | "redirect"; next: string }>(
    "DELETE FROM app_auth_codes WHERE code_hash=$1 AND host=$2 AND expires_at>now() RETURNING user_id,purpose,next",
    [hash(code), host]);
  return rows[0] ?? null;
}
