/**
 * Share-link auth — pure (share-auth.test.ts). A link is an opaque token row:
 * it can be revoked, it can expire, it can carry a password, and a password
 * entered once is remembered by a signed cookie bound to that link.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export type ShareLinkLike = { token: string; revokedAt: Date | string | null; expiresAt: Date | string | null; passwordHash: string | null };
export type ShareState = "ok" | "revoked" | "expired";

export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function shareLinkState(link: ShareLinkLike, now = new Date()): ShareState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "ok";
}

/** scrypt with a random salt — "salt:hash" hex. */
export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySharePassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return true;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(String(password ?? "").normalize("NFKC"), Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** The cookie value that proves this browser unlocked this link: HMAC(token) under the app secret. */
export function signShareSession(token: string, secret: string): string {
  return createHmac("sha256", secret).update(`jobcam-share:${token}`).digest("base64url");
}

export function verifyShareSession(token: string, cookieValue: string | null | undefined, secret: string): boolean {
  if (!cookieValue) return false;
  const want = Buffer.from(signShareSession(token, secret));
  const got = Buffer.from(String(cookieValue));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Access decision for one request: the state, then the password gate. */
export function shareAccess(link: ShareLinkLike, cookieValue: string | null | undefined, secret: string, now = new Date()):
  { allowed: true } | { allowed: false; reason: ShareState | "locked" } {
  const state = shareLinkState(link, now);
  if (state !== "ok") return { allowed: false, reason: state };
  if (link.passwordHash && !verifyShareSession(link.token, cookieValue, secret)) return { allowed: false, reason: "locked" };
  return { allowed: true };
}

/** Expiry presets the share dialog offers; `custom` is a date the client sends. */
export function expiryFromPreset(preset: string | null | undefined, now = new Date()): Date | null {
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : null;
  return days ? new Date(now.getTime() + days * 86_400_000) : null;
}
