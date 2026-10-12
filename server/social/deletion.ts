/**
 * Data deletion for connected social accounts (ConstructHUB Direct, server/social/native.ts).
 *
 * Meta (Facebook / Instagram / Threads) calls these when a person removes ConstructHUB in their own settings or asks
 * Meta to have their data deleted. Each request carries `signed_request` = `<sig>.<payload>` (base64url), signed with
 * HMAC-SHA256 by the app secret of the app it concerns — our Facebook app (SOCIAL_META_APP_SECRET), its Threads app
 * (SOCIAL_THREADS_APP_SECRET) or its Instagram-login app (SOCIAL_INSTAGRAM_APP_SECRET). The signature IS the
 * authentication: these routes take no session.
 *
 *   POST /api/social/native/meta/data-deletion   → 200 {"url": ".../data-deletion?code=<c>", "confirmation_code": "<c>"}
 *   POST /api/social/native/meta/deauthorize     → 200 {"ok": true}
 *   POST /api/social/native/threads/uninstall    → 200 {"ok": true}
 *   POST /api/social/native/threads/delete       → 200 {"url": ..., "confirmation_code": ...}
 *   GET  /api/social/native/data-deletion/status?code=<c> → {"status": "completed", "completedAt": ...} (public)
 *
 * What is deleted: every connected account row (and its encrypted token) whose network id or connecting person's id
 * is the one Meta names. We record the request (code, network, id, times) so the person can check it was done.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { pool } from "../db";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const appBase = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/$/, "");

export type Network = "meta" | "threads" | "instagram";
export type SignedPayload = { user_id: string; algorithm?: string; issued_at?: number; expires?: number; [k: string]: unknown };

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The secrets a signed request may be signed with, per network (unset ones are skipped). Pure on env. */
export function secretsFor(network: Network, env: NodeJS.ProcessEnv = process.env): string[] {
  const all = { meta: env.SOCIAL_META_APP_SECRET, threads: env.SOCIAL_THREADS_APP_SECRET, instagram: env.SOCIAL_INSTAGRAM_APP_SECRET };
  // Meta's own callbacks can come from the Facebook app or (for an Instagram-login connection) the Instagram app.
  const keys = network === "meta" ? [all.meta, all.instagram] : network === "threads" ? [all.threads, all.meta] : [all.instagram];
  return keys.filter((k): k is string => typeof k === "string" && k.length >= 16);
}

/**
 * Meta's signed_request, verified: split at the first ".", HMAC-SHA256 of the ENCODED payload with the app secret,
 * constant-time compare with the decoded signature. Returns the payload, or null when nothing matches. Pure.
 */
export function parseSignedRequest(signed: unknown, secrets: string[]): SignedPayload | null {
  if (typeof signed !== "string" || signed.length > 4096) return null;
  const dot = signed.indexOf(".");
  if (dot < 1) return null;
  const sigPart = signed.slice(0, dot), payloadPart = signed.slice(dot + 1);
  if (!/^[\w-]+$/.test(sigPart) || !/^[\w-]+$/.test(payloadPart)) return null;
  const sig = b64url(sigPart);
  let ok = false;
  for (const secret of secrets) {
    const want = createHmac("sha256", secret).update(payloadPart).digest();
    if (want.length === sig.length && timingSafeEqual(want, sig)) { ok = true; break; }
  }
  if (!ok) return null;
  let payload: any;
  try { payload = JSON.parse(b64url(payloadPart).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  if (payload.algorithm && String(payload.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
  const uid = payload.user_id ?? payload.userId;
  if ((typeof uid !== "string" && typeof uid !== "number") || !/^\d{1,40}$/.test(String(uid))) return null;
  return { ...payload, user_id: String(uid) };
}

export const newConfirmationCode = () => Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export async function ensureDeletionSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS social_deletion_requests (
    code text PRIMARY KEY,
    platform text NOT NULL,
    external_user_id text NOT NULL,
    accounts_deleted integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz)`);
  // The person who connected an account (their app-scoped id), so a deletion naming them finds their rows.
  await pool.query("ALTER TABLE IF EXISTS social_native_accounts ADD COLUMN IF NOT EXISTS owner_user_id text");
}

/** Delete every connected account Meta's id points at, record the request, return its confirmation code. */
export async function deleteForExternalUser(platform: Network, externalUserId: string): Promise<{ code: string; deleted: number }> {
  await ensureDeletionSchema();
  const platforms = platform === "threads" ? ["threads"] : platform === "instagram" ? ["instagram"] : ["facebook", "instagram"];
  const exists = (await pool.query("SELECT to_regclass('social_native_accounts') AS t")).rows[0]?.t;
  let deleted = 0;
  if (exists) {
    const r = await pool.query(
      "DELETE FROM social_native_accounts WHERE platform = ANY($2::text[]) AND (owner_user_id = $1 OR external_id = $1)",
      [externalUserId, platforms]);
    deleted = r.rowCount ?? 0;
  }
  const code = newConfirmationCode();
  await pool.query(
    "INSERT INTO social_deletion_requests(code,platform,external_user_id,accounts_deleted,completed_at) VALUES($1,$2,$3,$4,now())",
    [code, platform, externalUserId, deleted]);
  return { code, deleted };
}

export async function deletionStatus(code: string): Promise<{ status: "completed" | "received"; completedAt: string | null } | null> {
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return null;
  await ensureDeletionSchema();
  const { rows: [r] } = await pool.query("SELECT completed_at FROM social_deletion_requests WHERE code=$1", [code]);
  if (!r) return null;
  return { status: r.completed_at ? "completed" : "received", completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null };
}

/** Registered without session auth: the signature authenticates each callback. */
export function registerDeletionRoutes(app: Express) {
  const handle = (network: Network, answer: "confirmation" | "ok") => async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const payload = parseSignedRequest(req.body?.signed_request, secretsFor(network));
    if (!payload) return res.status(400).json({ message: "Invalid signed_request" });
    try {
      const { code, deleted } = await deleteForExternalUser(network, payload.user_id);
      console.log(`[social] ${network} deletion callback: ${deleted} connected account(s) deleted, code ${code}`);
      if (answer === "ok") return res.json({ ok: true });
      res.json({ url: `${appBase()}/data-deletion?code=${code}`, confirmation_code: code });
    } catch (e) {
      console.error(`[social] ${network} deletion callback failed:`, (e as Error)?.message);
      res.status(500).json({ message: "Could not process the request" });
    }
  };
  app.post("/api/social/native/meta/data-deletion", handle("meta", "confirmation"));
  app.post("/api/social/native/meta/deauthorize", handle("meta", "ok"));
  app.post("/api/social/native/instagram/data-deletion", handle("instagram", "confirmation"));
  app.post("/api/social/native/instagram/deauthorize", handle("instagram", "ok"));
  app.post("/api/social/native/threads/delete", handle("threads", "confirmation"));
  app.post("/api/social/native/threads/uninstall", handle("threads", "ok"));
  app.get("/api/social/native/data-deletion/status", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const s = await deletionStatus(String(req.query.code ?? "").trim().toUpperCase());
      if (!s) return res.status(404).json({ message: "No deletion request with that code" });
      res.json(s);
    } catch {
      res.status(500).json({ message: "Could not look that up" });
    }
  });
}
