/**
 * Sign in with Apple for the iPhone apps. App Store guideline 4.8: an app that offers Google sign-in must also offer
 * Sign in with Apple, and an account made that way must be deletable with its Apple grant revoked (5.1.1(v)).
 *
 * The app shows Apple's own sheet (ios/Shared/BrowserController.swift, bridge message "appleSignIn"), then posts
 * Apple's identity token from the open page so the session cookie lands in the app's web view:
 *
 *   POST /api/auth/apple { identityToken, nonce, authorizationCode?, givenName?, familyName?, purpose?, next? }
 *     purpose "login" (default) → { ok, next } | { requires2FA: true }
 *     purpose "reauth"          → { ok } — the identity check before a sensitive action (e.g. deleting the account)
 *   App only (403 app_only elsewhere). 401 when Apple's token doesn't check out.
 *
 * The token must be signed by Apple (its published keys), for one of our two apps (aud = bundle ID), unexpired, carry
 * sha256(nonce) — the nonce the app made for this one sign-in — and is accepted once. Apple's user id (`sub`) is the
 * same in both apps (one team). A first sign-in links to the open account with the same Apple-verified email (as Google
 * sign-in does), otherwise creates a verified account. 2FA accounts still enter their authenticator code.
 *
 * Revocation: when a server key is set (APPLE_SIGNIN_KEY_ID + APPLE_SIGNIN_KEY_FILE + APPLE_TEAM_ID), the one-time
 * authorizationCode is exchanged for Apple's refresh token (stored encrypted), and closing the account revokes it
 * (revokeAppleSignIn, called from server/account/delete.ts).
 */
import type { Express, Request, Response } from "express";
import { createHash, createPublicKey, createSign, verify as verifySig } from "crypto";
import { readFileSync } from "fs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db, pool } from "./db";
import { fromNativeApp, safeNextPath } from "./app-shell";
import { rateLimit } from "./growth-limits";
import { encryptToken, decryptToken } from "./gbp/token-crypto";
import { markRecentAuth, trustedDevice } from "./account-security";
import { logActivity } from "./account-events";
import { sendWelcomeEmail, appBaseUrl } from "./account/billing-emails";
import { notifyMemberLogin } from "./crm/owner-notify";
import { logMemberAuth } from "./crm/activity";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_AUDIENCES = ["us.constructhub.app", "us.constructhub.crm"];

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
export type AppleKeys = () => Promise<Jwk[]>;

let keyCache: { at: number; keys: Jwk[] } | null = null;
const appleKeys: AppleKeys = async () => {
  if (keyCache && Date.now() - keyCache.at < 60 * 60_000) return keyCache.keys;
  const res = await fetch(`${APPLE_ISSUER}/auth/keys`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`apple keys ${res.status}`);
  keyCache = { at: Date.now(), keys: ((await res.json()) as any).keys as Jwk[] };
  return keyCache.keys;
};

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// Each identity token signs in once (it stays valid for minutes). One server process, so memory is enough.
const used = new Map<string, number>();
function firstUse(token: string, exp: number): boolean {
  const now = Date.now();
  for (const [k, until] of used) if (until < now) used.delete(k);
  const key = sha256hex(token);
  if (used.has(key)) return false;
  used.set(key, exp * 1000);
  return true;
}

/** Apple's verified claims for this sign-in, or an Error. */
export async function verifyAppleToken(token: string, nonce: string, opts: { keys?: AppleKeys; now?: number } = {}): Promise<Record<string, any>> {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64json(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("unexpected alg/kid");
  let keys = await (opts.keys ?? appleKeys)();
  if (!keys.some((k) => k.kid === header.kid) && !opts.keys) { keyCache = null; keys = await appleKeys(); } // Apple rotated
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new Error("unknown kid");
  const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  if (!verifySig("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) throw new Error("bad signature");
  const c = b64json(parts[1]);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (c.iss !== APPLE_ISSUER) throw new Error("wrong issuer");
  if (!APPLE_AUDIENCES.includes(c.aud)) throw new Error("wrong audience");
  if (typeof c.exp !== "number" || c.exp < now) throw new Error("expired");
  if (typeof c.iat !== "number" || c.iat > now + 60) throw new Error("issued in the future");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("no subject");
  if (typeof c.nonce !== "string" || c.nonce !== sha256hex(nonce)) throw new Error("nonce mismatch");
  return c;
}

export async function ensureAppleAuthSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_apple_ids (
    sub text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text, client_id text NOT NULL, refresh_token text,
    created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz NOT NULL DEFAULT now()
  ); CREATE INDEX IF NOT EXISTS user_apple_ids_user ON user_apple_ids(user_id);`);
}

const signinKeyConfigured = () => !!(process.env.APPLE_SIGNIN_KEY_ID && process.env.APPLE_SIGNIN_KEY_FILE && process.env.APPLE_TEAM_ID);

/** Apple's client secret: a 5-minute ES256 JWT from the team's Sign in with Apple key, for one app (client_id). */
function clientSecret(clientId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "ES256", kid: process.env.APPLE_SIGNIN_KEY_ID })}.${b64({ iss: process.env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: APPLE_ISSUER, sub: clientId })}`;
  const sig = createSign("SHA256").update(data)
    .sign({ key: readFileSync(process.env.APPLE_SIGNIN_KEY_FILE!, "utf8"), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${data}.${sig}`;
}

/** The one-time authorizationCode → Apple's refresh token, kept (encrypted) only so account deletion can revoke it. */
async function keepRefreshToken(sub: string, clientId: string, code: string): Promise<void> {
  if (!signinKeyConfigured() || !code) return;
  const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret(clientId), code, grant_type: "authorization_code" }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.refresh_token) { console.warn(`[apple] code exchange ${res.status}: ${body.error ?? "no refresh token"}`); return; }
  await pool.query("UPDATE user_apple_ids SET refresh_token=$1 WHERE sub=$2", [encryptToken(body.refresh_token), sub]);
}

/** Account closing: revoke every Apple grant this account holds (best-effort; the rows go with the account's grants). */
export async function revokeAppleSignIn(userId: number): Promise<number> {
  const { rows } = await pool.query("SELECT sub, client_id, refresh_token FROM user_apple_ids WHERE user_id=$1 AND refresh_token IS NOT NULL", [userId]).catch(() => ({ rows: [] as any[] }));
  if (!rows.length || !signinKeyConfigured()) return 0;
  let revoked = 0;
  for (const r of rows) {
    try {
      const token = decryptToken(r.refresh_token);
      if (!token) continue;
      const res = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({ client_id: r.client_id, client_secret: clientSecret(r.client_id), token, token_type_hint: "refresh_token" }),
      });
      if (res.ok) revoked++; else console.warn(`[apple] revoke ${res.status} for user ${userId}`);
    } catch (e: any) { console.warn(`[apple] revoke failed for user ${userId}: ${e?.message ?? e}`); }
  }
  return revoked;
}

const body = z.object({
  identityToken: z.string().min(20).max(8000),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  authorizationCode: z.string().max(2000).optional(),
  givenName: z.string().max(100).optional(),
  familyName: z.string().max(100).optional(),
  purpose: z.enum(["login", "reauth"]).default("login"),
  next: z.string().max(2000).optional(),
}).strict();

/** The account for this Apple identity: linked before, else the open account with that verified email, else a new one. */
async function accountFor(claims: Record<string, any>, input: z.infer<typeof body>, req: Request) {
  const { rows: [link] } = await pool.query(
    "SELECT a.user_id, u.deletion_requested_at FROM user_apple_ids a JOIN users u ON u.id = a.user_id WHERE a.sub=$1", [claims.sub]);
  if (link) {
    if (link.deletion_requested_at) return null; // a closed account never signs in again
    const [user] = await db.select().from(users).where(eq(users.id, link.user_id));
    return user ? { user, created: false } : null;
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  // Apple always shares an address (real or its private relay) when asked; without one the account can't be told apart.
  if (!email || !verified) return null;
  const { rows: [byEmail] } = await pool.query("SELECT id FROM users WHERE lower(email)=$1 AND deletion_requested_at IS NULL ORDER BY id LIMIT 1", [email]);
  let user: typeof users.$inferSelect | undefined;
  let created = false;
  if (byEmail) {
    [user] = await db.select().from(users).where(eq(users.id, byEmail.id));
    if (user && !user.emailVerified) await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  } else {
    const { generateAccountId } = await import("./auth");
    const displayName = [input.givenName, input.familyName].map((s) => s?.trim()).filter(Boolean).join(" ") || null;
    [user] = await db.insert(users).values({ email, displayName, accountId: generateAccountId(), emailVerified: true } as any).returning();
    created = true;
    void sendWelcomeEmail(user.id, appBaseUrl(req)).catch((e: any) => console.error("[apple] welcome email failed:", e?.message || e));
  }
  if (!user) return null;
  await pool.query("INSERT INTO user_apple_ids(sub,user_id,email,client_id) VALUES($1,$2,$3,$4) ON CONFLICT (sub) DO NOTHING",
    [claims.sub, user.id, email, claims.aud]);
  return { user, created };
}

export function registerAppleAuthRoutes(app: Express, opts: { keys?: AppleKeys } = {}): void {
  app.use("/api/auth/apple", rateLimit("apple-signin", 20, 60));
  app.post("/api/auth/apple", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    if (!fromNativeApp(req)) return res.status(403).json({ code: "app_only", message: "Sign in with Apple is available in the ConstructHUB iPhone apps." });
    const input = body.safeParse(req.body ?? {});
    if (!input.success) return res.status(400).json({ message: "Invalid Sign in with Apple request" });
    let claims: Record<string, any>;
    try {
      claims = await verifyAppleToken(input.data.identityToken, input.data.nonce, { keys: opts.keys });
      if (!firstUse(input.data.identityToken, claims.exp)) throw new Error("token already used");
    } catch (e: any) {
      console.warn(`[apple] refused: ${e?.message ?? e}`);
      return res.status(401).json({ message: "Apple couldn't confirm this sign-in. Please try again." });
    }
    try {
      if (input.data.purpose === "reauth") {
        if (!req.user) return res.status(401).json({ message: "Not authenticated" });
        const { rows: [link] } = await pool.query("SELECT 1 FROM user_apple_ids WHERE sub=$1 AND user_id=$2", [claims.sub, req.user.id]);
        if (!link) return res.status(403).json({ message: "That Apple ID isn't the one linked to this account." });
        markRecentAuth(req, req.user.id);
        await logActivity(req, req.user.id, "security.reauthenticated", { method: "apple" });
        return res.json({ ok: true });
      }
      const account = await accountFor(claims, input.data, req);
      if (!account) return res.status(403).json({ message: "Apple didn't share a verified email address, so we can't sign you in." });
      const { user } = account;
      await pool.query("UPDATE user_apple_ids SET last_login_at=now() WHERE sub=$1", [claims.sub]);
      await keepRefreshToken(claims.sub, claims.aud, input.data.authorizationCode ?? "").catch((e: any) => console.warn(`[apple] code exchange failed: ${e?.message ?? e}`));
      if (user.totpEnabled && !(await trustedDevice(req, user.id))) {
        req.session.pending2FAUserId = user.id;
        req.session.pending2FAExpires = Date.now() + 10 * 60_000;
        return res.json({ requires2FA: true });
      }
      req.login(user, async (err) => {
        if (err) return res.status(500).json({ message: "Sign-in failed" });
        if (!user.totpEnabled) markRecentAuth(req, user.id);
        await logActivity(req, user.id, "auth.login_success", { method: "apple", created: account.created });
        notifyMemberLogin(user as any).catch((e: any) => console.error("[crm] login notify failed:", e?.message || e));
        logMemberAuth(user as any, "login").catch((e: any) => console.error("[crm] login activity failed:", e?.message || e));
        res.json({ ok: true, next: safeNextPath(input.data.next) ?? "/" });
      });
    } catch (e: any) {
      console.error(`[apple] sign-in failed: ${e?.message ?? e}`);
      res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
  });
}
