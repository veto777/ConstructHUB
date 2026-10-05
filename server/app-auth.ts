import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { pool } from "./db";
import { requestHost } from "./site-context";
import { safeNextPath } from "./app-shell";

export const appAuthHost = (req: Request) => requestHost(req);
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export function appChallenge(query: Request["query"]): string | null {
  return query.challenge_method === "S256" && typeof query.challenge === "string" && /^[A-Za-z0-9_-]{43}$/.test(query.challenge)
    ? query.challenge : null;
}
export async function ensureAppAuthSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_auth_codes (
    code_hash text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('login','redirect')),
    next text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes'
  ); ALTER TABLE app_auth_codes ADD COLUMN IF NOT EXISTS challenge text; CREATE INDEX IF NOT EXISTS app_auth_codes_expiry ON app_auth_codes(expires_at);`);
}

/** Only called after provider authentication or completion of a bound connect flow. */
export async function mintAppCode(userId: number, host: string, purpose: "login" | "redirect", challenge: string, next?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error("Invalid app PKCE challenge");
  const code = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO app_auth_codes(code_hash,user_id,host,purpose,next,challenge) VALUES($1,$2,$3,$4,$5,$6)",
    [hash(code), userId, host, purpose, safeNextPath(next) ?? "/", challenge]);
  return code;
}

/** DELETE RETURNING makes competing requests/replays single-use, including across processes. */
export async function consumeAppCode(code: unknown, host: string, verifier: unknown) {
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) return null;
  const { rows } = await pool.query<{ user_id: number; purpose: "login" | "redirect"; next: string; challenge: string | null }>(
    "DELETE FROM app_auth_codes WHERE code_hash=$1 AND host=$2 AND expires_at>now() RETURNING user_id,purpose,next,challenge",
    [hash(code), host]);
  const row = rows[0];
  // Consume before validating: even a missing or malformed verifier gets one try.
  if (!row?.challenge || typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const expected = Buffer.from(row.challenge);
  return expected.length === actual.length && timingSafeEqual(expected, Buffer.from(actual)) ? row : null;
}
