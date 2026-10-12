import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { pool } from "../db";
import type { PostPayload, SocialAccount, SocialClient, StatusResult, UploadStart } from "./provider";
import { publicMediaUrl } from "../../shared/social";
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
export async function reserveRequest(hash: string) {
  await pool.query(
    "INSERT INTO social_rate(key_hash) VALUES($1) ON CONFLICT DO NOTHING",
    [hash],
  );
  const r = await pool.query(
    "UPDATE social_rate SET next_at=clock_timestamp()+interval '2100 milliseconds' WHERE key_hash=$1 AND next_at<=clock_timestamp() RETURNING key_hash",
    [hash],
  );
  if (!r.rowCount)
    throw new SocialError("Blotato rate limit: retry shortly", 429);
}
export class BlotatoClient implements SocialClient {
  readonly provider = "blotato" as const;
  readonly hash: string;
  constructor(
    private key: string,
    private http: typeof fetch = fetch,
    private reserve = reserveRequest,
  ) {
    this.hash = createHash("sha256").update(key).digest("hex");
  }
  async request(path: string, body?: unknown) {
    if (
      !/^\/(users\/me\/accounts(?:\/[\w-]+\/subaccounts)?|social\/pinterest\/boards\?accountId=[\w-]+|posts(?:\/[\w-]+)?|media\/uploads)$/.test(
        path,
      )
    )
      throw new SocialError("Invalid Blotato resource");
    await this.reserve(this.hash);
    let r: Response;
    try {
      r = await this.http(`https://backend.blotato.com/v2${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "blotato-api-key": this.key,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new SocialError(
        "Blotato response unavailable; verify in Blotato before resubmitting",
        502,
      );
    }
    if (r.status === 429) {
      const delay = Math.max(
        60,
        Math.min(86400, Number(r.headers.get("retry-after")) || 60),
      );
      await pool.query(
        "UPDATE social_rate SET next_at=greatest(next_at,now()+$2*interval '1 second') WHERE key_hash=$1",
        [this.hash, delay],
      );
    }
    if (!r.ok)
      throw new SocialError(
        r.status === 401
          ? "Blotato key rejected; reconnect"
          : r.status === 429
            ? "Blotato rate limit: retry later"
            : "Blotato rejected the request",
        r.status === 401
          ? 401
          : r.status === 429
            ? 429
            : r.status >= 500
              ? 502
              : 400,
      );
    let data: any;
    try {
      data = await r.json();
    } catch {
      throw new SocialError("Invalid Blotato response", 502);
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new SocialError("Invalid Blotato response", 502);
    return data;
  }
  async accounts() {
    const data = await this.request("/users/me/accounts");
    if (!Array.isArray(data.items))
      throw new SocialError("Invalid account list", 502);
    return data.items.map((a: any) => ({
      id: String(a.id),
      platform: String(a.platform),
      name: String(a.fullname || a.username || a.platform),
    }));
  }
  async targets(a: SocialAccount) {
    const boards = a.platform === "pinterest";
    if (!boards && !["facebook", "linkedin", "youtube"].includes(a.platform)) return null;
    const data = await this.request(boards ? `/social/pinterest/boards?accountId=${a.id}` : `/users/me/accounts/${a.id}/subaccounts`);
    if (!Array.isArray(data.items)) throw new SocialError("Invalid page list", 502);
    return { kind: boards ? "boards" as const : "pages" as const, items: data.items.map((p: any) => ({ id: String(p.id), name: String(p.name || p.id) })) };
  }
  async submit(payload: PostPayload) {
    const data = await this.request("/posts", payload);
    if (typeof data.postSubmissionId !== "string" || !/^[-\w]+$/.test(data.postSubmissionId))
      throw new SocialError("Blotato did not confirm a submission ID", 502);
    return { submissionId: data.postSubmissionId };
  }
  async status(submissionId: string): Promise<StatusResult> {
    const data = await this.request(`/posts/${submissionId}`);
    const state = data.status === "published" ? "published" : data.status === "failed" ? "failed" : "submitted";
    const url = publicMediaUrl.safeParse(data.publicUrl);
    return { state, publicUrl: url.success ? url.data : null, error: state === "failed" ? "Blotato reports a failed post. Review it in Blotato." : null };
  }
  async startUpload(filename: string): Promise<UploadStart> {
    const data = await this.request("/media/uploads", { filename });
    return { publicUrl: publicMediaUrl.parse(data.publicUrl), presignedUrl: publicMediaUrl.parse(data.presignedUrl) };
  }
}
