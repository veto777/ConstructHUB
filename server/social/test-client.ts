/**
 * Tests only: a SocialClient over a mocked HTTP function, so the queue, worker and routes can be exercised against
 * real Postgres without a network. Endpoints (all under https://provider.test):
 *   GET  /accounts                        → { items: [{ id, platform, name }] }
 *   GET  /accounts/<id>/pages | /boards   → { items: [{ id, name }] }
 *   POST /posts                           → { submissionId }
 *   GET  /posts/<id>                      → { status: "published" | "failed" | …, publicUrl }
 *   POST /uploads                         → { publicUrl, presignedUrl }
 * The stored key is sent as `x-fixture-key`. Keys are ConstructHUB connections (`native:<tenant>`), so the real
 * clientFactory accepts the same stored secret and `hash` matches what it computes.
 */
import { createHash } from "node:crypto";
import { pool } from "../db";
import { publicMediaUrl } from "../../shared/social";
import { encryptKey, SocialError } from "./client";
import type { PostPayload, SocialAccount, SocialClient, StatusResult, UploadStart } from "./provider";
import type { ClientFactory } from "./schedule";

export class FixtureClient implements SocialClient {
  readonly provider = "native" as const;
  readonly hash: string;
  constructor(private key: string, private http: typeof fetch) {
    this.hash = createHash("sha256").update(key).digest("hex");
  }
  private async request(path: string, body?: unknown) {
    let r: Response;
    try {
      r = await this.http(`https://provider.test${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "x-fixture-key": this.key, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SocialError("The social network did not answer; check the post before resubmitting", 502);
    }
    if (!r.ok) throw new SocialError("The social network rejected the request", r.status >= 500 ? 502 : 400);
    return r.json() as Promise<any>;
  }
  async accounts(): Promise<SocialAccount[]> {
    const data = await this.request("/accounts");
    return data.items.map((a: any) => ({ id: String(a.id), platform: String(a.platform), name: String(a.name || a.platform) }));
  }
  async targets(a: SocialAccount) {
    const boards = a.platform === "pinterest";
    if (!boards && !["facebook", "linkedin", "youtube"].includes(a.platform)) return null;
    const data = await this.request(`/accounts/${a.id}/${boards ? "boards" : "pages"}`);
    return { kind: boards ? "boards" as const : "pages" as const, items: data.items.map((p: any) => ({ id: String(p.id), name: String(p.name || p.id) })) };
  }
  async submit(payload: PostPayload) {
    return { submissionId: String((await this.request("/posts", payload)).submissionId) };
  }
  async status(submissionId: string): Promise<StatusResult> {
    const data = await this.request(`/posts/${submissionId}`);
    const state = data.status === "published" ? "published" : data.status === "failed" ? "failed" : "submitted";
    const url = publicMediaUrl.safeParse(data.publicUrl);
    return { state, publicUrl: url.success ? url.data : null, error: state === "failed" ? "The social network reports a failed post." : null };
  }
  async startUpload(filename: string): Promise<UploadStart> {
    const data = await this.request("/uploads", { filename });
    return { publicUrl: publicMediaUrl.parse(data.publicUrl), presignedUrl: publicMediaUrl.parse(data.presignedUrl) };
  }
}

/** Store a connection for `userId` (business or agency-wide) with the accounts `make(key)` reports. */
export async function connectFixture(userId: number, key: string, make: ClientFactory, businessId: number | null = null) {
  const accounts = await make(key).accounts();
  await pool.query(
    `INSERT INTO social_connections(user_id,key_enc,accounts,business_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,business_id) DO UPDATE SET key_enc=$2,accounts=$3,updated_at=now()`,
    [userId, encryptKey(key, userId), JSON.stringify(accounts), businessId],
  );
  return accounts;
}
