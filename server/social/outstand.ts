/**
 * Outstand (https://www.outstand.so/docs): ConstructHUB's own account publishes for every customer. Each customer's
 * connection is a tenant id (`chu<user>b<business>`); their social accounts are connected through Outstand's OAuth
 * (POST /v1/social-networks/{network}/auth-url with tenant_id) and listed back with GET /v1/social-accounts?tenantId=.
 * Facebook, LinkedIn and Google Business come back with a session token and a "which pages?" step (pending → finalize).
 * Billing is per post on ConstructHUB's Outstand plan (pay-as-you-go, $19 a month for 3,000 posts, 2026-10-11).
 *
 *   OUTSTAND_API_KEY         the organization's API key (sk_live_…); unset = Outstand off
 *   OUTSTAND_WEBHOOK_SECRET  the webhook signing secret (HMAC-SHA256 of the raw body, header X-Outstand-Signature)
 *
 * Networks on Outstand's managed apps (nothing to register): facebook, instagram, linkedin, threads, tiktok, youtube,
 * pinterest, bluesky. X, Google Business, Reddit and Vimeo need our own app keys; Google Business posting stays on
 * ConstructHUB's own Google connection.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SocialError } from "./client";
import type { PostPayload, SocialAccount, SocialClient, StatusResult, SubmitResult, UploadStart } from "./provider";

export const OUTSTAND_BASE = "https://api.outstand.so";
export const outstandConfigured = (env: NodeJS.ProcessEnv = process.env) => /^\S{8,}$/.test(env.OUTSTAND_API_KEY ?? "");
/** The marker stored (encrypted) in social_connections.key_enc for an Outstand connection. */
export const OUTSTAND_MARK = "outstand:";
export const tenantFor = (userId: number, businessId: number | null) => `chu${userId}b${businessId ?? 0}`;
export const isTenant = (t: string) => /^chu\d{1,10}b\d{1,10}$/.test(t);

/** Our platform names ↔ Outstand's network names. */
const TO_NETWORK: Record<string, string> = { twitter: "x", facebook: "facebook", instagram: "instagram", linkedin: "linkedin", threads: "threads", bluesky: "bluesky", tiktok: "tiktok", youtube: "youtube", pinterest: "pinterest" };
const FROM_NETWORK: Record<string, string> = Object.fromEntries(Object.entries(TO_NETWORK).map(([k, v]) => [v, k]));
/** Networks a customer can connect from the Social Media page (OAuth on Outstand's managed apps). */
export const CONNECTABLE = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest", "threads"] as const;
export type Connectable = (typeof CONNECTABLE)[number];
/** These come back with a session token: the customer picks pages before the accounts exist. */
export const NEEDS_PAGE_PICK: ReadonlySet<string> = new Set(["facebook", "linkedin"]);

export const outstandDeps = { http: fetch as typeof fetch, env: () => process.env };

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
  const key = outstandDeps.env().OUTSTAND_API_KEY;
  if (!key) throw new SocialError("Social posting isn't switched on yet.", 503);
  let r: Response;
  try {
    r = await outstandDeps.http(`${OUTSTAND_BASE}${path}`, {
      method, redirect: "error",
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SocialError("The publishing service didn't answer; check the post before sending it again", 502);
  }
  let data: any = null;
  try { data = await r.json(); } catch { /* an empty body is checked below */ }
  if (!r.ok) {
    const say = typeof data?.error === "string" ? data.error.slice(0, 200) : "";
    if (r.status === 429) throw new SocialError("Social posting is busy; it will retry shortly", 429);
    if (r.status === 402) throw new SocialError("Social posting is paused on our side (billing). We've been told; your post is kept.", 503);
    if (r.status === 401 || r.status === 403) throw new SocialError("Social posting isn't authorized on our side; we've been told", 503);
    throw new SocialError(say ? `The network refused it: ${say}` : "The publishing service refused the request", r.status >= 500 ? 502 : 400);
  }
  if (!data || typeof data !== "object") throw new SocialError("The publishing service sent an unreadable answer", 502);
  return data;
}

/** A connected account as Outstand lists it → ours. Pure. */
export function accountFrom(a: any): SocialAccount | null {
  const platform = FROM_NETWORK[String(a?.network ?? "")];
  const id = typeof a?.id === "string" ? a.id : null;
  if (!platform || !id || !/^[\w-]{1,200}$/.test(id) || a?.isActive === false) return null;
  const name = String(a.nickname || a.username || platform);
  // A Facebook account on Outstand IS a Page (picked at connect time): it is its own page target.
  return platform === "facebook" ? { id, platform, name, pages: [{ id, name }] } : { id, platform, name };
}

/** The stored payload (Blotato-shaped, shared/social.ts) → an Outstand create-post body. Pure. */
export function outstandBody(p: PostPayload): Record<string, unknown> {
  const { content, target, accountId } = p.post;
  const network = TO_NETWORK[content.platform];
  if (!network) throw new SocialError(`${content.platform} isn't available for posting yet`);
  const media = (content.mediaUrls ?? []).map((url) => ({ url, filename: decodeURIComponent(new URL(url).pathname.split("/").pop() || "media") }));
  const body: Record<string, unknown> = { accounts: [accountId], containers: [{ content: content.text, ...(media.length ? { media } : {}) }] };
  if (network === "pinterest") body.pinterest = { board_id: target.boardId, ...(target.title ? { title: target.title } : {}) };
  if (network === "youtube") body.youtube = { title: target.title, privacyStatus: target.privacyStatus ?? "private", madeForKids: false, containsSyntheticMedia: !!target.containsSyntheticMedia };
  if (network === "tiktok") body.tiktok = {
    privacyLevel: target.privacyLevel ?? "SELF_ONLY", disableComment: target.disabledComments ?? true, disableDuet: target.disabledDuet ?? true, disableStitch: target.disabledStitch ?? true,
    brandContentToggle: !!target.isBrandedContent, brandOrganicToggle: !!target.isYourBrand, isAigc: !!target.isAiGenerated,
  };
  return body;
}

/** One post as Outstand reports it → our state. Pure. */
export function statusFrom(post: any, accountId?: string): StatusResult {
  const accounts: any[] = Array.isArray(post?.socialAccounts) ? post.socialAccounts : [];
  const a = (accountId && accounts.find((x) => x?.id === accountId)) || accounts[0];
  if (!a || a.status === "pending" || !a.status) return { state: "submitted", publicUrl: null, error: null };
  if (a.status === "failed") return { state: "failed", publicUrl: null, error: typeof a.error === "string" ? `The network refused it: ${a.error.slice(0, 300)}` : "The network refused the post" };
  const url = typeof a.url === "string" && /^https:\/\//.test(a.url) ? a.url : typeof a.permalink === "string" && /^https:\/\//.test(a.permalink) ? a.permalink : null;
  return { state: "published", publicUrl: url, error: null };
}

/** Is this webhook really from Outstand? `sha256=<hex>` of the raw body with our secret. Pure. */
export function webhookSigned(raw: Buffer | string | undefined, header: string | undefined, secret: string | undefined): boolean {
  if (!raw || !header || !secret) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export class OutstandClient implements SocialClient {
  readonly provider = "outstand" as const;
  readonly hash: string;
  constructor(readonly tenant: string) {
    if (!isTenant(tenant)) throw new SocialError("Invalid social connection", 500);
    this.hash = createHash("sha256").update(`outstand:${tenant}`).digest("hex");
  }
  async accounts(): Promise<SocialAccount[]> {
    const out: SocialAccount[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const d = await call("GET", `/v1/social-accounts?tenantId=${encodeURIComponent(this.tenant)}&limit=100&offset=${offset}`);
      const rows: any[] = Array.isArray(d.data) ? d.data : Array.isArray(d.accounts) ? d.accounts : [];
      for (const r of rows) { const a = accountFrom(r); if (a) out.push(a); }
      if (rows.length < 100) break;
    }
    return out;
  }
  async targets(account: SocialAccount) {
    if (account.platform === "facebook") return { kind: "pages" as const, items: [{ id: account.id, name: account.name }] };
    if (account.platform !== "pinterest") return null;
    const d = await call("GET", `/v1/pinterest/accounts/${encodeURIComponent(account.id)}/boards`);
    const rows: any[] = Array.isArray(d.data) ? d.data : Array.isArray(d.boards) ? d.boards : [];
    return { kind: "boards" as const, items: rows.filter((b) => b && b.id).map((b) => ({ id: String(b.id), name: String(b.name || b.id) })) };
  }
  async submit(payload: PostPayload, idempotencyKey: string): Promise<SubmitResult> {
    const d = await call("POST", "/v1/posts", outstandBody(payload), { "Idempotency-Key": idempotencyKey.slice(0, 255) });
    const id = d?.post?.id ?? d?.data?.id ?? d?.id;
    if (typeof id !== "string" || !/^[\w-]{1,200}$/.test(id)) throw new SocialError("The publishing service did not confirm the post", 502);
    // An account that resolves to nothing is dropped silently by Outstand: make sure ours is on it.
    const listed: any[] = d?.post?.socialAccounts ?? [];
    if (listed.length && !listed.some((a) => a?.id === payload.post.accountId)) throw new SocialError("That social account is no longer connected; reconnect it", 409);
    return { submissionId: id };
  }
  async status(submissionId: string): Promise<StatusResult> {
    const d = await call("GET", `/v1/posts/${encodeURIComponent(submissionId)}`);
    return statusFrom(d.post ?? d.data ?? d);
  }
  async startUpload(filename: string): Promise<UploadStart> {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    const contentType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[ext];
    if (!contentType) throw new SocialError("Use a JPG, PNG, WEBP, MP4 or MOV file");
    const d = await call("POST", "/v1/media/upload", { filename, content_type: contentType });
    const id = d?.data?.id, url = d?.data?.upload_url;
    if (typeof id !== "string" || typeof url !== "string" || !/^https:\/\//.test(url)) throw new SocialError("The upload could not be started", 502);
    return { presignedUrl: url, contentType, publicUrl: null, uploadId: id };
  }
  async confirmUpload(uploadId: string): Promise<string> {
    if (!/^[\w-]{1,200}$/.test(uploadId)) throw new SocialError("Invalid upload");
    const d = await call("POST", `/v1/media/${encodeURIComponent(uploadId)}/confirm`, {});
    const url = d?.data?.url ?? d?.url;
    if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new SocialError("The upload could not be confirmed", 502);
    return url;
  }

  // ── connecting (not part of SocialClient: only the Outstand connect screen uses these) ──
  async authUrl(network: Connectable, redirectUri: string): Promise<string> {
    const d = await call("POST", `/v1/social-networks/${network}/auth-url`, { redirect_uri: redirectUri, tenant_id: this.tenant, force_account_selection: true });
    const url = d?.data?.auth_url;
    if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new SocialError("Could not start the connection", 502);
    return url;
  }
  static async pending(session: string): Promise<{ network: string; pages: { id: string; name: string; kind: string | null }[] }> {
    if (!/^[\w.-]{8,400}$/.test(session)) throw new SocialError("That connection link has expired; connect again");
    const d = await call("GET", `/v1/social-accounts/pending/${encodeURIComponent(session)}`);
    const pages: any[] = d?.data?.availablePages ?? [];
    return { network: String(d?.data?.network ?? ""), pages: pages.filter((p) => p?.id).map((p) => ({ id: String(p.id), name: String(p.name || p.username || p.id), kind: p.type ? String(p.type) : null })) };
  }
  static async finalize(session: string, pageIds: string[]): Promise<number> {
    if (!/^[\w.-]{8,400}$/.test(session)) throw new SocialError("That connection link has expired; connect again");
    const d = await call("POST", `/v1/social-accounts/pending/${encodeURIComponent(session)}/finalize`, { selectedPageIds: pageIds });
    return Array.isArray(d?.connectedAccounts) ? d.connectedAccounts.length : 0;
  }
  async removeAll(): Promise<number> {
    let n = 0;
    for (const a of await this.accounts()) { await call("DELETE", `/v1/social-accounts/${encodeURIComponent(a.id)}`).catch(() => null); n++; }
    return n;
  }
}
