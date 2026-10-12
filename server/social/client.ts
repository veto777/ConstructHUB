import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
/**
 * A stable code the Social Media page can key on. A bare 503 reads as "ConstructHUB is restarting
 * or briefly unavailable"; this one means the server is not set up for Social Media at all
 * (reviewers, 2026-10-11), which no retry fixes.
 */
export const SOCIAL_MISCONFIGURED = "social_misconfigured";
export type SocialErrorCode = typeof SOCIAL_MISCONFIGURED;
export class SocialError extends Error {
  constructor(
    message: string,
    public status = 400,
    /** Set only for conditions the page names rather than retries. */
    public code?: SocialErrorCode,
  ) {
    super(message);
  }
}
/** The server lacks something Social Media needs (encryption key, AI provider): a 503 with the stable code. */
export function socialMisconfigured(message: string) {
  return new SocialError(message, 503, SOCIAL_MISCONFIGURED);
}
/** The JSON body a route sends for a SocialError: the message, plus the code when it carries one. */
export function socialErrorBody(e: SocialError): { message: string; code?: SocialErrorCode } {
  return e.code ? { message: e.message, code: e.code } : { message: e.message };
}
function boxKey() {
  const key = process.env.SOCIAL_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw socialMisconfigured("Social Media is not set up on this server yet: the key that protects connected social accounts is missing.");
  return Buffer.from(key, "hex");
}
export function encryptKey(plain: string, userId: number) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", boxKey(), iv);
  c.setAAD(Buffer.from(`social:${userId}`));
  const bytes = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), bytes].map((b) => b.toString("base64")).join(".");
}
export function decryptKey(box: string, userId: number) {
  const [iv, tag, bytes] = box.split(".").map((b) => Buffer.from(b, "base64"));
  const c = createDecipheriv("aes-256-gcm", boxKey(), iv);
  c.setAAD(Buffer.from(`social:${userId}`));
  c.setAuthTag(tag);
  return Buffer.concat([c.update(bytes), c.final()]).toString("utf8");
}
