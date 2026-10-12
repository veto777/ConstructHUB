/**
 * ConstructHUB Direct — our own Blotato (owner, 2026-10-12: "turn constructhub into our own blatato").
 *
 * The customer connects their social accounts through ConstructHUB's OWN developer apps (OAuth on each network's
 * sign-in page); the tokens live encrypted in our database and we publish to the networks' APIs ourselves. Nothing
 * of Blotato's or Outstand's is involved. A business's connection is a tenant id (`chu<user>b<business>`, the same
 * shape Outstand uses) stored as `native:<tenant>` in social_connections.key_enc, so the queue, schedule, AI writing
 * and calendar above (server/social/service.ts) do not know which provider publishes.
 *
 * Networks are switched on one by one, as each app is approved (docs/social-apps):
 *   facebook, instagram  Meta app: SOCIAL_META_APP_ID + SOCIAL_META_APP_SECRET (Facebook Login; Pages + Instagram
 *                        Graph API). Until App Review, only people with a role on the app can connect.
 * Tables: social_native_accounts (one row per connected Page / Instagram account, token encrypted with GBP_TOKEN_KEY),
 * social_native_pending (a sign-in waiting for the customer to pick pages, 15 minutes), social_native_submissions
 * (what we sent, and how far each network has got with it), social_native_uploads (media the composer uploaded).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
/** Tokens at rest: AES-256-GCM with GBP_TOKEN_KEY (server/gbp/token-crypto.ts). */
const enc = (v: string): string => { const b = encryptToken(v); if (!b) throw new SocialError("Social connections can't be stored right now", 503); return b; };
const dec = (v: string): string => { const t = decryptToken(v); if (!t) throw new SocialError("This account's saved sign-in can't be read; reconnect it", 409); return t; };
import { SocialError } from "./client";
import type { PostPayload, SocialAccount, SocialClient, StatusResult, SubmitResult, UploadStart } from "./provider";

export const NATIVE_MARK = "native:";
export const GRAPH = "https://graph.facebook.com/v25.0";
const PENDING_MINUTES = 15;
const UPLOAD_MAX_BYTES = 250 * 1024 * 1024;

/** Networks this provider can connect, given the apps configured. Pure on env. */
export function nativeNetworks(env: NodeJS.ProcessEnv = process.env): string[] {
  const meta = /^\d{6,30}$/.test(env.SOCIAL_META_APP_ID ?? "") && /^\S{16,}$/.test(env.SOCIAL_META_APP_SECRET ?? "");
  return meta ? ["facebook", "instagram"] : [];
}
export const nativeConfigured = (env: NodeJS.ProcessEnv = process.env) => nativeNetworks(env).length > 0;
/**
 * Until Meta approves the app (App Review), only people with a role on it can sign in, so customers do not see
 * ConstructHUB Direct: platform admins do, to test it on our own Page. SOCIAL_NATIVE_PUBLIC=true opens it to all. Pure on env.
 */
export function nativeNetworksFor(isAdmin: boolean, env: NodeJS.ProcessEnv = process.env): string[] {
  return isAdmin || env.SOCIAL_NATIVE_PUBLIC === "true" ? nativeNetworks(env) : [];
}

const appBase = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/$/, "");
export const nativeRedirectUri = () => `${appBase()}/api/social/native/callback`;

/** Meta Graph permissions requested (docs/social-apps/meta.md §2.2 — nothing beyond posting). */
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management", "instagram_basic", "instagram_content_publish"];

export const nativeDeps = { http: fetch as typeof fetch, env: () => process.env, now: () => Date.now() };

export const ensureNativeSchema = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS social_native_accounts (
    id text PRIMARY KEY,
    tenant text NOT NULL,
    platform text NOT NULL,
    external_id text NOT NULL,
    name text NOT NULL,
    picture text,
    parent_id text,
    token_enc text NOT NULL,
    token_expires_at timestamptz,
    scopes jsonb NOT NULL DEFAULT '[]',
    needs_reconnect boolean NOT NULL DEFAULT false,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant, platform, external_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS social_native_pending (
    session text PRIMARY KEY,
    tenant text NOT NULL,
    user_id integer NOT NULL,
    network text NOT NULL,
    data_enc text NOT NULL,
    expires_at timestamptz NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS social_native_submissions (
    id text PRIMARY KEY,
    idem_key text NOT NULL,
    tenant text NOT NULL,
    account_id text NOT NULL,
    platform text NOT NULL,
    stage text NOT NULL,
    container_id text,
    external_id text,
    public_url text,
    error text,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant, idem_key))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS social_native_uploads (
    token text PRIMARY KEY,
    user_id integer NOT NULL,
    r2_key text NOT NULL,
    content_type text NOT NULL,
    done boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL)`);
};

// ── Meta Graph calls ────────────────────────────────────────────────────────────────────────────────────────

/** A Graph error → our sentence. 190/102 = the login is no longer valid (reconnect); 4/17/32/613 = rate limit. Pure. */
export function graphError(err: any, status: number): SocialError {
  const code = Number(err?.code), sub = Number(err?.error_subcode);
  const say = String(err?.error_user_msg || err?.message || "").slice(0, 240);
  if (code === 190 || code === 102 || sub === 463 || sub === 460) {
    const e = new SocialError("This account's sign-in has expired or was removed; reconnect it under Connected accounts", 409);
    (e as any).reconnect = true;
    return e;
  }
  if ([4, 17, 32, 613, 80001, 80002, 80005].includes(code)) return new SocialError("The network is limiting how fast we post; it will retry shortly", 429);
  if (code === 10 || code === 200 || (code >= 200 && code < 300)) return new SocialError(`The network didn't allow it: ${say || "a permission is missing"}`, 403);
  return new SocialError(say ? `The network refused it: ${say}` : "The network refused the request", status >= 500 ? 502 : 400);
}

async function graph(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | boolean | undefined>, token?: string): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  if (token) q.set("access_token", token);
  const url = method === "GET" || method === "DELETE" ? `${GRAPH}/${path}?${q}` : `${GRAPH}/${path}`;
  let r: Response;
  try {
    r = await nativeDeps.http(url, {
      method, redirect: "error",
      ...(method === "POST" ? { body: q, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SocialError("The network didn't answer; check the post before sending it again", 502);
  }
  let data: any = null;
  try { data = await r.json(); } catch { /* checked below */ }
  if (!r.ok || data?.error) throw graphError(data?.error, r.status);
  if (!data || typeof data !== "object") throw new SocialError("The network sent an unreadable answer", 502);
  return data;
}

// ── connecting ──────────────────────────────────────────────────────────────────────────────────────────────

export type PendingOAuth = { state: string; userId: number; businessId: number | null; network: string; expires: number };
export const newOAuthState = (userId: number, businessId: number | null, network: string): PendingOAuth =>
  ({ state: randomBytes(32).toString("base64url"), userId, businessId, network, expires: nativeDeps.now() + 10 * 60_000 });
/** The callback belongs to the sign-in we started for this signed-in user, and it is not stale. Pure. */
export function oauthStateMatches(p: PendingOAuth | undefined | null, userId: number | undefined, state: unknown): p is PendingOAuth {
  if (!p || typeof state !== "string" || p.userId !== userId || p.expires < nativeDeps.now()) return false;
  const a = Buffer.from(p.state), b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where to send the customer to sign in. */
export function metaAuthUrl(state: string): string {
  const env = nativeDeps.env();
  const q = new URLSearchParams({ client_id: String(env.SOCIAL_META_APP_ID), redirect_uri: nativeRedirectUri(), state, response_type: "code", scope: META_SCOPES.join(",") });
  return `https://www.facebook.com/v25.0/dialog/oauth?${q}`;
}

type PendingPage = { id: string; name: string; token: string; picture: string | null; ig: { id: string; username: string; picture: string | null } | null };

/** The code from Meta → a long-lived user token → the Pages (with their own long-lived tokens) and linked Instagram accounts. */
export async function metaPagesFromCode(code: string): Promise<PendingPage[]> {
  const env = nativeDeps.env();
  const short = await graph("GET", "oauth/access_token", { client_id: env.SOCIAL_META_APP_ID, client_secret: env.SOCIAL_META_APP_SECRET, redirect_uri: nativeRedirectUri(), code });
  const long = await graph("GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: env.SOCIAL_META_APP_ID, client_secret: env.SOCIAL_META_APP_SECRET, fb_exchange_token: short.access_token });
  const pages: PendingPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const d = await graph("GET", "me/accounts", { fields: "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}", limit: 100, after }, long.access_token);
    for (const p of d.data ?? []) {
      if (!p?.id || !p?.access_token) continue;
      const ig = p.instagram_business_account;
      pages.push({ id: String(p.id), name: String(p.name || p.id), token: String(p.access_token), picture: p.picture?.data?.url ?? null,
        ig: ig?.id ? { id: String(ig.id), username: String(ig.username || ig.id), picture: ig.profile_picture_url ?? null } : null });
    }
    after = d.paging?.cursors?.after;
    if (!d.paging?.next || !after) break;
  }
  return pages;
}

export async function savePending(tenant: string, userId: number, network: string, pages: PendingPage[]): Promise<string> {
  const session = randomBytes(24).toString("base64url");
  await pool.query("DELETE FROM social_native_pending WHERE expires_at < now()");
  await pool.query("INSERT INTO social_native_pending(session,tenant,user_id,network,data_enc,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6||' minutes')::interval)",
    [session, tenant, userId, network, enc(JSON.stringify(pages)), String(PENDING_MINUTES)]);
  return session;
}

async function loadPending(session: string, tenant: string, userId: number): Promise<{ network: string; pages: PendingPage[] }> {
  if (!/^[\w-]{20,64}$/.test(session)) throw new SocialError("That connection link has expired; connect again");
  const { rows: [r] } = await pool.query("SELECT network,data_enc FROM social_native_pending WHERE session=$1 AND tenant=$2 AND user_id=$3 AND expires_at>now()", [session, tenant, userId]);
  if (!r) throw new SocialError("That connection link has expired; connect again");
  return { network: r.network, pages: JSON.parse(dec(r.data_enc)) };
}

/** The pages (Facebook) or Instagram accounts (Instagram) this sign-in can connect — names only, no tokens. */
export async function nativePendingList(session: string, tenant: string, userId: number) {
  const { network, pages } = await loadPending(session, tenant, userId);
  const items = network === "instagram"
    ? pages.filter((p) => p.ig).map((p) => ({ id: p.ig!.id, name: `@${p.ig!.username}`, kind: `linked to ${p.name}` }))
    : pages.map((p) => ({ id: p.id, name: p.name, kind: p.ig ? `Instagram @${p.ig.username}` : null }));
  return { network, pages: items };
}

/** Save the ticked pages / Instagram accounts as connected accounts; the pending sign-in is used up. */
export async function nativeFinalize(session: string, tenant: string, userId: number, ids: string[]): Promise<number> {
  const { network, pages } = await loadPending(session, tenant, userId);
  const want = new Set(ids);
  let n = 0;
  for (const p of pages) {
    if (network === "facebook" && want.has(p.id)) { await upsertAccount(tenant, "facebook", p.id, p.name, p.picture, null, p.token); n++; }
    if (network === "instagram" && p.ig && want.has(p.ig.id)) { await upsertAccount(tenant, "instagram", p.ig.id, `@${p.ig.username}`, p.ig.picture, p.id, p.token); n++; }
  }
  await pool.query("DELETE FROM social_native_pending WHERE session=$1", [session]);
  return n;
}

async function upsertAccount(tenant: string, platform: string, externalId: string, name: string, picture: string | null, parentId: string | null, token: string) {
  await pool.query(
    `INSERT INTO social_native_accounts(id,tenant,platform,external_id,name,picture,parent_id,token_enc,scopes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(tenant,platform,external_id) DO UPDATE SET name=$5,picture=$6,parent_id=$7,token_enc=$8,scopes=$9,needs_reconnect=false,last_error=null,updated_at=now()`,
    [randomUUID(), tenant, platform, externalId, name.slice(0, 200), picture, parentId, enc(token), JSON.stringify(META_SCOPES)]);
}

export async function removeNativeAccounts(tenant: string): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM social_native_accounts WHERE tenant=$1", [tenant]);
  await pool.query("DELETE FROM social_native_pending WHERE tenant=$1", [tenant]);
  return rowCount ?? 0;
}

// ── publishing ──────────────────────────────────────────────────────────────────────────────────────────────

type Row = { id: string; platform: string; external_id: string; name: string; parent_id: string | null; token_enc: string; needs_reconnect: boolean };
type Sub = { id: string; account_id: string; platform: string; stage: string; container_id: string | null; external_id: string | null; public_url: string | null; error: string | null; attempts: number };

const isVideo = (url: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(url);

/** What the Facebook publish call looks like for this content. Pure (tested). */
export function facebookPlan(text: string, media: string[]): { kind: "text" } | { kind: "photo"; url: string } | { kind: "photos"; urls: string[] } | { kind: "video"; url: string } {
  if (!media.length) return { kind: "text" };
  const videos = media.filter(isVideo);
  if (videos.length) {
    if (media.length > 1) throw new SocialError("Facebook takes one video per post, without photos alongside it");
    return { kind: "video", url: videos[0] };
  }
  if (media.length === 1) return { kind: "photo", url: media[0] };
  if (media.length > 10) throw new SocialError("Facebook takes up to 10 photos per post");
  return { kind: "photos", urls: media };
}

/** What the Instagram container looks like for this content. Pure (tested). */
export function instagramPlan(text: string, media: string[]): { kind: "image"; url: string } | { kind: "reel"; url: string } | { kind: "carousel"; items: { url: string; video: boolean }[] } {
  if (!media.length) throw new SocialError("Instagram needs a photo or a video");
  if (text.length > 2200) throw new SocialError("Instagram captions are at most 2,200 characters");
  if (media.length === 1) return isVideo(media[0]) ? { kind: "reel", url: media[0] } : { kind: "image", url: media[0] };
  if (media.length > 10) throw new SocialError("Instagram carousels take up to 10 photos or videos");
  return { kind: "carousel", items: media.map((url) => ({ url, video: isVideo(url) })) };
}

async function permalink(id: string, token: string): Promise<string | null> {
  const d = await graph("GET", id, { fields: "permalink_url" }, token).catch(() => null);
  const u = d?.permalink_url;
  return typeof u === "string" ? (u.startsWith("http") ? u : `https://www.facebook.com${u}`) : null;
}

export class NativeClient implements SocialClient {
  readonly provider = "native" as const;
  readonly hash: string;
  constructor(readonly tenant: string) {
    if (!/^chu\d{1,10}b\d{1,10}$/.test(tenant)) throw new SocialError("Invalid social connection", 500);
    this.hash = createHash("sha256").update(`native:${tenant}`).digest("hex");
  }
  private async rows(): Promise<Row[]> {
    const { rows } = await pool.query("SELECT id,platform,external_id,name,parent_id,token_enc,needs_reconnect FROM social_native_accounts WHERE tenant=$1 ORDER BY platform,name", [this.tenant]);
    return rows;
  }
  private async row(id: string): Promise<Row> {
    const { rows: [r] } = await pool.query("SELECT id,platform,external_id,name,parent_id,token_enc,needs_reconnect FROM social_native_accounts WHERE tenant=$1 AND id=$2", [this.tenant, id]);
    if (!r) throw new SocialError("That social account is no longer connected; reconnect it", 409);
    return r;
  }
  private async markReconnect(accountId: string, e: unknown) {
    if ((e as any)?.reconnect) await pool.query("UPDATE social_native_accounts SET needs_reconnect=true,last_error=$3,updated_at=now() WHERE tenant=$1 AND id=$2", [this.tenant, accountId, String((e as Error).message).slice(0, 300)]);
  }
  async accounts(): Promise<SocialAccount[]> {
    return (await this.rows()).map((r) => r.platform === "facebook"
      ? { id: r.id, platform: r.platform, name: r.name, pages: [{ id: r.id, name: r.name }] }
      : { id: r.id, platform: r.platform, name: r.name });
  }
  async targets(account: SocialAccount) {
    return account.platform === "facebook" ? { kind: "pages" as const, items: [{ id: account.id, name: account.name }] } : null;
  }

  async submit(payload: PostPayload, idempotencyKey: string): Promise<SubmitResult> {
    const key = idempotencyKey.slice(0, 200);
    const { rows: [seen] } = await pool.query("SELECT id FROM social_native_submissions WHERE tenant=$1 AND idem_key=$2", [this.tenant, key]);
    if (seen) return { submissionId: seen.id };   // never send the same post twice
    const acct = await this.row(payload.post.accountId);
    if (acct.needs_reconnect) throw new SocialError("This account's sign-in has expired; reconnect it under Connected accounts", 409);
    const token = dec(acct.token_enc);
    const text = payload.post.content.text ?? "";
    const media = (payload.post.content.mediaUrls ?? []).filter((u) => /^https:\/\//.test(u));
    const id = `nat_${randomUUID()}`;
    await pool.query("INSERT INTO social_native_submissions(id,idem_key,tenant,account_id,platform,stage) VALUES($1,$2,$3,$4,$5,'sending')",
      [id, key, this.tenant, acct.id, acct.platform]);
    try {
      if (acct.platform === "facebook") await this.facebookSend(id, acct, token, text, media);
      else if (acct.platform === "instagram") await this.instagramSend(id, acct, token, text, media);
      else throw new SocialError(`${acct.platform} isn't available for posting yet`);
    } catch (e) {
      await this.markReconnect(acct.id, e);
      // Nothing reached the network: the submission is forgotten so a retry can send it.
      const { rows: [s] } = await pool.query("SELECT stage FROM social_native_submissions WHERE id=$1", [id]);
      if (s?.stage === "sending") await pool.query("DELETE FROM social_native_submissions WHERE id=$1", [id]);
      throw e;
    }
    return { submissionId: id };
  }

  private async setSub(id: string, f: Partial<Sub>) {
    const keys = Object.keys(f);
    await pool.query(`UPDATE social_native_submissions SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1`, [id, ...keys.map((k) => (f as any)[k])]);
  }

  private async facebookSend(id: string, acct: Row, token: string, text: string, media: string[]) {
    const page = acct.external_id;
    const plan = facebookPlan(text, media);
    if (plan.kind === "video") {
      const d = await graph("POST", `${page}/videos`, { file_url: plan.url, description: text }, token);
      return this.setSub(id, { stage: "fb_video", external_id: String(d.id) });
    }
    let postId: string;
    if (plan.kind === "text") postId = (await graph("POST", `${page}/feed`, { message: text }, token)).id;
    else if (plan.kind === "photo") { const d = await graph("POST", `${page}/photos`, { url: plan.url, caption: text }, token); postId = d.post_id || d.id; }
    else {
      const ids: string[] = [];
      for (const url of plan.urls) ids.push((await graph("POST", `${page}/photos`, { url, published: false }, token)).id);
      const q: Record<string, string> = { message: text };
      ids.forEach((m, i) => (q[`attached_media[${i}]`] = JSON.stringify({ media_fbid: m })));
      postId = (await graph("POST", `${page}/feed`, q, token)).id;
    }
    await this.setSub(id, { stage: "published", external_id: String(postId), public_url: await permalink(String(postId), token) });
  }

  private async instagramSend(id: string, acct: Row, token: string, text: string, media: string[]) {
    const ig = acct.external_id;
    const plan = instagramPlan(text, media);
    let container: string;
    if (plan.kind === "image") container = (await graph("POST", `${ig}/media`, { image_url: plan.url, caption: text }, token)).id;
    else if (plan.kind === "reel") container = (await graph("POST", `${ig}/media`, { media_type: "REELS", video_url: plan.url, caption: text, share_to_feed: true }, token)).id;
    else {
      const children: string[] = [];
      for (const it of plan.items) children.push((await graph("POST", `${ig}/media`, it.video ? { media_type: "VIDEO", video_url: it.url, is_carousel_item: true } : { image_url: it.url, is_carousel_item: true }, token)).id);
      container = (await graph("POST", `${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: text }, token)).id;
    }
    await this.setSub(id, { stage: "ig_container", container_id: String(container) });
  }

  async status(submissionId: string): Promise<StatusResult> {
    const { rows: [s] } = await pool.query("SELECT * FROM social_native_submissions WHERE tenant=$1 AND id=$2", [this.tenant, submissionId]);
    if (!s) return { state: "failed", publicUrl: null, error: "We lost track of this post; check the account before posting it again" };
    if (s.stage === "published") return { state: "published", publicUrl: s.public_url, error: null };
    if (s.stage === "failed") return { state: "failed", publicUrl: null, error: s.error };
    const acct = await this.row(s.account_id).catch(() => null);
    if (!acct) return { state: "failed", publicUrl: null, error: "That social account is no longer connected" };
    const token = dec(acct.token_enc);
    try {
      if (s.stage === "fb_video") {
        const d = await graph("GET", s.external_id, { fields: "status,permalink_url" }, token);
        const st = d?.status?.video_status;
        if (st === "ready") { await this.setSub(s.id, { stage: "published", public_url: d.permalink_url ? `https://www.facebook.com${d.permalink_url}` : null }); return { state: "published", publicUrl: d.permalink_url ? `https://www.facebook.com${d.permalink_url}` : null, error: null }; }
        if (st === "error") return this.fail(s.id, "Facebook couldn't process the video");
        return { state: "submitted", publicUrl: null, error: null };
      }
      if (s.stage === "ig_container") {
        const d = await graph("GET", s.container_id, { fields: "status_code,status" }, token);
        if (d.status_code === "ERROR" || d.status_code === "EXPIRED") return this.fail(s.id, `Instagram couldn't process the media${d.status ? `: ${String(d.status).slice(0, 160)}` : ""}`);
        if (d.status_code !== "FINISHED") {
          if (s.attempts > 60) return this.fail(s.id, "Instagram took too long to process the media");
          await this.setSub(s.id, { attempts: s.attempts + 1 });
          return { state: "submitted", publicUrl: null, error: null };
        }
        await this.setSub(s.id, { stage: "ig_publishing" });
        const pub = await graph("POST", `${acct.external_id}/media_publish`, { creation_id: s.container_id }, token);
        const m = await graph("GET", String(pub.id), { fields: "permalink" }, token).catch(() => null);
        await this.setSub(s.id, { stage: "published", external_id: String(pub.id), public_url: m?.permalink ?? null });
        return { state: "published", publicUrl: m?.permalink ?? null, error: null };
      }
      if (s.stage === "ig_publishing" || s.stage === "sending") return { state: "submitted", publicUrl: null, error: null };
    } catch (e) {
      await this.markReconnect(acct.id, e);
      if ((e as SocialError).status === 429 || (e as SocialError).status === 502) return { state: "submitted", publicUrl: null, error: null };
      return this.fail(s.id, (e as Error).message);
    }
    return { state: "submitted", publicUrl: null, error: null };
  }
  private async fail(id: string, error: string): Promise<StatusResult> {
    await this.setSub(id, { stage: "failed", error });
    return { state: "failed", publicUrl: null, error };
  }

  // Media: the browser PUTs the file to our server (social_native_uploads), which stores it in R2 under a public,
  // unguessable address the networks fetch from (no redirects — Instagram requires that).
  async startUpload(filename: string, userId?: number): Promise<UploadStart> {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    const contentType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[ext];
    if (!contentType) throw new SocialError("Use a JPG, PNG, WEBP, MP4 or MOV file");
    const token = randomUUID().replace(/-/g, "");
    const name = `media.${ext === "jpeg" ? "jpg" : ext}`;
    const key = `social/${token}/${name}`;
    await pool.query("INSERT INTO social_native_uploads(token,user_id,r2_key,content_type,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')", [token, userId ?? 0, key, contentType]);
    return { presignedUrl: `${appBase()}/api/social/native/upload/${token}`, contentType, publicUrl: `${appBase()}/api/files/${key}` };
  }
}

/** The PUT behind startUpload: only the user who started it, once, within the hour, up to 250 MB. */
export async function receiveUpload(token: string, userId: number, body: Buffer, contentType: string | undefined, put: (key: string, b: Buffer, ct: string) => Promise<string>) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new SocialError("Invalid upload");
  const { rows: [u] } = await pool.query("SELECT * FROM social_native_uploads WHERE token=$1 AND user_id=$2 AND NOT done AND expires_at>now()", [token, userId]);
  if (!u) throw new SocialError("That upload link has expired; add the file again", 404);
  if (!body.length || body.length > UPLOAD_MAX_BYTES) throw new SocialError("Files must be under 250 MB");
  if (contentType && contentType.split(";")[0].trim() !== u.content_type) throw new SocialError("The file type changed during upload");
  await put(u.r2_key, body, u.content_type);
  await pool.query("UPDATE social_native_uploads SET done=true WHERE token=$1", [token]);
  return { ok: true };
}
export const NATIVE_UPLOAD_MAX_BYTES = UPLOAD_MAX_BYTES;
