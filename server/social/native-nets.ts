/**
 * ConstructHUB Direct — the networks that sign in on their own (not through a Facebook Page): Instagram login
 * (business accounts with no Facebook Page), Threads, TikTok and X. Each adapter knows its sign-in address, how to turn
 * the code into a long-lived token (and refresh it), who signed in, how to publish, and how to read a publish back.
 * server/social/native.ts stores the accounts and drives the queue; this file only speaks to the networks.
 *
 *   instagram (Instagram login)  SOCIAL_INSTAGRAM_APP_ID / _SECRET   graph.instagram.com     token 60 days, refreshable
 *   threads                      SOCIAL_THREADS_APP_ID / _SECRET     graph.threads.net       token 60 days, refreshable
 *   tiktok                       SOCIAL_TIKTOK_CLIENT_KEY / _SECRET  open.tiktokapis.com     access 24 h, refresh 365 days
 *   x                            SOCIAL_X_CLIENT_ID / _SECRET       api.x.com              access 2 h, rotating refresh
 */
import https from "node:https";
import { lookup } from "node:dns";
import { publicIP, siteUrl } from "../sitescan/http";
import { createHash } from "node:crypto";
import { xSplitText, xWeightedLength } from "../../shared/social-x";
import { recordFailure } from "../ops/issues";
import { SocialError } from "./client";

export type NetApi = "ig_login" | "threads" | "tiktok" | "x";
export type Signed = { externalId: string; name: string; picture: string | null; token: string; expiresAt: Date | null; refresh: string | null; scopes: string[] };
export type Plan = { error?: string; stage: string; container?: string; external?: string; url?: string | null };
export type Read = { state: "submitted" | "published" | "failed"; url?: string | null; external?: string; error?: string; stage?: string };

export const netDeps = { http: fetch as typeof fetch, mediaHttp: xMediaFetch, env: () => process.env, now: () => Date.now(), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
const base = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/$/, "");
export const netRedirect = (api: NetApi) => `${base()}/api/social/native/${api === "ig_login" ? "instagram" : api}/callback`;

const SCOPES: Record<NetApi, string[]> = {
  x: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
  ig_login: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_insights"],
  threads: ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_read_replies", "threads_manage_replies", "threads_delete"],
  // No video.list: per-post TikTok stats are not read (server/social/insights.ts); docs/social-apps/tiktok.md §2.2.
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.publish"],
};
export const netScopes = (api: NetApi) => SCOPES[api];

/** Which of these networks have their app keys. Pure on env. */
export function netConfigured(api: NetApi, env: NodeJS.ProcessEnv = process.env): boolean {
  if (api === "x") return !!env.SOCIAL_X_CLIENT_ID?.trim() && !!env.SOCIAL_X_CLIENT_SECRET?.trim();
  if (api === "ig_login") return /^\d{6,30}$/.test(env.SOCIAL_INSTAGRAM_APP_ID ?? "") && /^\S{16,}$/.test(env.SOCIAL_INSTAGRAM_APP_SECRET ?? "");
  if (api === "threads") return /^\d{6,30}$/.test(env.SOCIAL_THREADS_APP_ID ?? "") && /^\S{16,}$/.test(env.SOCIAL_THREADS_APP_SECRET ?? "");
  return /^\S{6,}$/.test(env.SOCIAL_TIKTOK_CLIENT_KEY ?? "") && /^\S{16,}$/.test(env.SOCIAL_TIKTOK_CLIENT_SECRET ?? "");
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────

function reconnect(): SocialError {
  const e = new SocialError("This account's sign-in has expired or was removed; reconnect it under Connected accounts", 409);
  (e as any).reconnect = true;
  return e;
}
/** One network call → JSON, with the network's errors turned into our sentences. */
async function call(url: string, init: RequestInit & { form?: Record<string, string>; json?: unknown; bearer?: string } = {}): Promise<any> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(init.form); }
  if (init.json !== undefined) { headers["Content-Type"] = "application/json; charset=UTF-8"; body = JSON.stringify(init.json); }
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  let r: Response;
  try {
    r = await netDeps.http(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new SocialError("The network didn't answer; check the post before sending it again", 502);
  }
  let d: any = null;
  try { d = await r.json(); } catch { /* checked below */ }
  // TikTok wraps everything in { data, error: { code: "ok" | … } }; Meta's hosts use { error: { code, message } }.
  const tk = d?.error && typeof d.error.code === "string" ? d.error : null;
  if (tk && tk.code !== "ok") {
    const tag = (e: SocialError) => Object.assign(e, { tiktokCode: String(tk.code) });
    if (["access_token_invalid", "scope_not_authorized", "token_not_authorized_for_specified_scope"].includes(tk.code) || r.status === 401) throw tag(reconnect());
    if (tk.code === "rate_limit_exceeded" || tk.code === "spam_risk_too_many_posts") throw tag(new SocialError("TikTok is limiting how fast we post; it will retry shortly", 429));
    throw tag(new SocialError(`TikTok refused it: ${String(tk.message || tk.code).slice(0, 200)}`, r.status >= 500 ? 502 : 400));
  }
  const me = d?.error && typeof d.error === "object" && !tk ? d.error : null;
  if (!r.ok || me) {
    const code = Number(me?.code);
    if (code === 190 || r.status === 401) throw reconnect();
    if ([4, 17, 32, 613].includes(code) || r.status === 429) throw new SocialError("The network is limiting how fast we post; it will retry shortly", 429);
    const say = String(me?.error_user_msg || me?.message || d?.error_message || "").slice(0, 200);
    throw new SocialError(say ? `The network refused it: ${say}` : "The network refused the request", r.status >= 500 ? 502 : 400);
  }
  if (!d || typeof d !== "object") throw new SocialError("The network sent an unreadable answer", 502);
  return d;
}
const q = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
};
const inSec = (s: unknown) => (Number(s) > 0 ? new Date(netDeps.now() + Number(s) * 1000) : null);

// ── signing in ─────────────────────────────────────────────────────────────────────────────────────────────

export function netAuthUrl(api: NetApi, state: string, verifier?: string): string {
  const env = netDeps.env();
  if (api === "x") {
    if (!verifier) throw new SocialError("X sign-in requires PKCE; connect again");
    return `https://x.com/i/oauth2/authorize?${q({ client_id: env.SOCIAL_X_CLIENT_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.x.join(" "), state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })}`;
  }
  if (api === "ig_login") return `https://www.instagram.com/oauth/authorize?${q({ client_id: env.SOCIAL_INSTAGRAM_APP_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.ig_login.join(","), state })}`;
  if (api === "threads") return `https://threads.net/oauth/authorize?${q({ client_id: env.SOCIAL_THREADS_APP_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.threads.join(","), state })}`;
  return `https://www.tiktok.com/v2/auth/authorize/?${q({ client_key: env.SOCIAL_TIKTOK_CLIENT_KEY, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.tiktok.join(","), state })}`;
}

/** The code from the network → a long-lived token and who signed in. */
export async function netExchange(api: NetApi, code: string, verifier?: string): Promise<Signed> {
  const env = netDeps.env();
  if (api === "x") {
    if (!verifier) throw new SocialError("X sign-in requires PKCE; connect again");
    const t = await xToken({ grant_type: "authorization_code", code, redirect_uri: netRedirect(api), code_verifier: verifier });
    const me = (await xCall("/users/me?user.fields=profile_image_url,username,name", t.access_token)).data;
    if (!me?.id || !me?.username) throw new SocialError("X did not identify the signed-in account", 502);
    return { externalId: String(me.id), name: `@${me.username}`, picture: me.profile_image_url ?? null, token: t.access_token, expiresAt: inSec(t.expires_in ?? 7200), refresh: t.refresh_token, scopes: String(t.scope ?? "").split(" ").filter(Boolean) };
  }
  if (api === "ig_login") {
    const short = await call("https://api.instagram.com/oauth/access_token", { form: { client_id: String(env.SOCIAL_INSTAGRAM_APP_ID), client_secret: String(env.SOCIAL_INSTAGRAM_APP_SECRET), grant_type: "authorization_code", redirect_uri: netRedirect(api), code } });
    const long = await call(`https://graph.instagram.com/access_token?${q({ grant_type: "ig_exchange_token", client_secret: env.SOCIAL_INSTAGRAM_APP_SECRET, access_token: short.access_token })}`);
    const me = await call(`https://graph.instagram.com/v25.0/me?${q({ fields: "id,user_id,username,profile_picture_url", access_token: long.access_token })}`);
    return { externalId: String(me.user_id ?? me.id), name: `@${me.username}`, picture: me.profile_picture_url ?? null, token: long.access_token, expiresAt: inSec(long.expires_in), refresh: null, scopes: SCOPES.ig_login };
  }
  if (api === "threads") {
    const short = await call("https://graph.threads.net/oauth/access_token", { form: { client_id: String(env.SOCIAL_THREADS_APP_ID), client_secret: String(env.SOCIAL_THREADS_APP_SECRET), grant_type: "authorization_code", redirect_uri: netRedirect(api), code } });
    const long = await call(`https://graph.threads.net/access_token?${q({ grant_type: "th_exchange_token", client_secret: env.SOCIAL_THREADS_APP_SECRET, access_token: short.access_token })}`);
    const me = await call(`https://graph.threads.net/v1.0/me?${q({ fields: "id,username,threads_profile_picture_url", access_token: long.access_token })}`);
    return { externalId: String(me.id), name: `@${me.username}`, picture: me.threads_profile_picture_url ?? null, token: long.access_token, expiresAt: inSec(long.expires_in), refresh: null, scopes: SCOPES.threads };
  }
  const t = await call("https://open.tiktokapis.com/v2/oauth/token/", { form: { client_key: String(env.SOCIAL_TIKTOK_CLIENT_KEY), client_secret: String(env.SOCIAL_TIKTOK_CLIENT_SECRET), code, grant_type: "authorization_code", redirect_uri: netRedirect(api) } });
  const granted = String(t.scope ?? "").split(",").filter(Boolean);
  if (!granted.includes("video.publish")) throw new SocialError("TikTok didn't allow posting. Connect again and leave “Post to TikTok” switched on.");
  const u = await call(`https://open.tiktokapis.com/v2/user/info/?${q({ fields: "open_id,display_name,avatar_url,username" })}`, { bearer: t.access_token });
  const user = u.data?.user ?? {};
  return { externalId: String(t.open_id ?? user.open_id), name: user.username ? `@${user.username}` : String(user.display_name || "TikTok"), picture: user.avatar_url ?? null, token: t.access_token, expiresAt: inSec(t.expires_in), refresh: t.refresh_token ?? null, scopes: granted };
}

/** A fresh token when the stored one is close to expiring (TikTok: within 10 minutes; the others: within 7 days). */
export function needsRefresh(api: NetApi, expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  const left = expiresAt.getTime() - netDeps.now();
  return api === "tiktok" || api === "x" ? left < 10 * 60_000 : left < 7 * 86_400_000;
}
export async function netRefresh(api: NetApi, token: string, refresh: string | null): Promise<Pick<Signed, "token" | "expiresAt" | "refresh">> {
  const env = netDeps.env();
  if (api === "ig_login") { const d = await call(`https://graph.instagram.com/refresh_access_token?${q({ grant_type: "ig_refresh_token", access_token: token })}`); return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: null }; }
  if (api === "threads") { const d = await call(`https://graph.threads.net/refresh_access_token?${q({ grant_type: "th_refresh_token", access_token: token })}`); return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: null }; }
  if (!refresh) throw reconnect();
  if (api === "x") {
    const d = await xToken({ grant_type: "refresh_token", refresh_token: refresh });
    return { token: d.access_token, expiresAt: inSec(d.expires_in ?? 7200), refresh: d.refresh_token };
  }
  const d = await call("https://open.tiktokapis.com/v2/oauth/token/", { form: { client_key: String(env.SOCIAL_TIKTOK_CLIENT_KEY), client_secret: String(env.SOCIAL_TIKTOK_CLIENT_SECRET), grant_type: "refresh_token", refresh_token: refresh } });
  return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: d.refresh_token ?? refresh };
}

// ── publishing ─────────────────────────────────────────────────────────────────────────────────────────────

const isVideo = (u: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);

/** X errors never include the remote response in logs (it can contain credentials). */
async function xRequest(path: string, init: RequestInit): Promise<any> {
  let r: Response;
  try { r = await netDeps.http(`https://api.x.com/2${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new SocialError("X didn't answer; check the post before sending it again", 502); }
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.errors?.length || d?.error) {
    const detail = JSON.stringify(d ?? {}).toLowerCase();
    if (r.status === 401 || d?.error === "invalid_grant") throw reconnect();
    if (r.status === 402 || /credits/.test(detail)) {
      const e = new SocialError("X posting is paused: the ConstructHUB X account is out of credits", 402);
      void recordFailure("job", "X posting credits", e);
      throw e;
    }
    if (r.status === 429) throw new SocialError("X is limiting how fast we post; try again later", 429);
    if (/duplicate/.test(detail)) throw new SocialError("X already has this content; change the text before posting again");
    throw new SocialError("X refused the request; check the content and account permissions", r.status >= 500 ? 502 : 400);
  }
  if (r.status === 204) return {};
  if (!d) throw new SocialError("X sent an unreadable answer", 502);
  return d;
}
function xCall(path: string, token: string, json?: unknown, method?: string) {
  return xRequest(path, { method: method ?? (json === undefined ? "GET" : "POST"), headers: { Authorization: `Bearer ${token}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
}
async function xToken(form: Record<string, string>) {
  const env = netDeps.env();
  const d = await xRequest("/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${env.SOCIAL_X_CLIENT_ID}:${env.SOCIAL_X_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  if (!d.access_token || !d.refresh_token) throw new SocialError("X did not return a renewable sign-in; reconnect the account", 409);
  return d;
}
export async function xDelete(token: string, id: string): Promise<void> {
  const d = await xCall(`/tweets/${encodeURIComponent(id)}`, token, undefined, "DELETE");
  if (d.data?.deleted !== true) throw new SocialError("X did not confirm deletion; check the post on X", 502);
}
/** Built-in HTTPS transport with the same pinned-public-DNS policy as sitescan/http. */
function xMediaFetch(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      signal: AbortSignal.timeout(60_000),
      lookup: (hostname, options, callback) => lookup(hostname, { all: true }, (err, addresses) => {
        if (err || !addresses.length || addresses.some((a) => !publicIP(a.address))) return callback(new Error("Media must use a public address"), "", 4);
        if ((options as any).all) (callback as any)(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }),
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Media download failed")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 250 * 1024 * 1024) request.destroy(new Error("Media too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(new Response(new Uint8Array(Buffer.concat(chunks)))));
    });
    request.on("error", reject);
  });
}
async function xUpload(token: string, url: string): Promise<string> {
  // Pin public DNS results to the socket, reject redirects, bound bytes; no bearer on media downloads.
  const safe = siteUrl(url);
  if (!safe.startsWith("https://")) throw new SocialError("Use a public HTTPS media URL");
  let file: Buffer;
  try {
    const response = await netDeps.mediaHttp(safe);
    if (!response.ok) throw new Error("download failed");
    file = Buffer.from(await response.arrayBuffer());
    if (!file.length || file.length > 250 * 1024 * 1024) throw new Error("invalid size");
  } catch { throw new SocialError("X couldn't read the media; use a public HTTPS file under 250 MB"); }
  const video = isVideo(url);
  const type = video ? (/\.mov(?:\?|$)/i.test(url) ? "video/quicktime" : "video/mp4") : (/\.png(?:\?|$)/i.test(url) ? "image/png" : /\.webp(?:\?|$)/i.test(url) ? "image/webp" : "image/jpeg");
  const bytes = new Uint8Array(file);
  const multipart = async (path: string, data: Uint8Array, fields: Record<string, string>) => {
    const body = new FormData();
    body.set("media", new Blob([data as BlobPart], { type }), "media");
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return xRequest(path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  };
  let d: any;
  if (!video) d = await multipart("/media/upload", bytes, { media_category: "tweet_image" });
  else {
    d = await xCall("/media/upload/initialize", token, { media_type: type, total_bytes: bytes.length, media_category: "tweet_video" });
    const id = d.data?.id;
    if (!id) throw new SocialError("X did not confirm the media upload", 502);
    for (let offset = 0, i = 0; offset < bytes.length; offset += 5 * 1024 * 1024, i++) {
      await multipart(`/media/upload/${id}/append`, bytes.slice(offset, offset + 5 * 1024 * 1024), { segment_index: String(i) });
    }
    d = await xCall(`/media/upload/${id}/finalize`, token, undefined, "POST");
    for (let i = 0; d.data?.processing_info && d.data.processing_info.state !== "succeeded"; i++) {
      if (d.data.processing_info.state === "failed") throw new SocialError("X couldn't process the video");
      if (i >= 60) throw new SocialError("X took too long to process the video", 502);
      await netDeps.sleep(Math.min(30, Math.max(1, Number(d.data.processing_info.check_after_secs) || 1)) * 1000);
      d = await xCall(`/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`, token);
    }
    return String(id);
  }
  if (!d.data?.id) throw new SocialError("X did not confirm the media upload", 502);
  return String(d.data.id);
}
async function xPublish(token: string, text: string, media: string[], username: string): Promise<Plan> {
  const { main, reply } = xSplitText(text);
  if (!main && !media.length) throw new SocialError("X needs text or media in the main post after links move to a reply");
  if (xWeightedLength(main) > 280 || xWeightedLength(reply) > 280) throw new SocialError("X main posts and link replies are at most 280 weighted characters");
  if (media.length > 4 || (media.some(isVideo) && media.length !== 1)) throw new SocialError("X takes up to four images or one video");
  const ids: string[] = [];
  for (const url of media) ids.push(await xUpload(token, url));
  const d = await xCall("/tweets", token, { ...(main ? { text: main } : {}), ...(ids.length ? { media: { media_ids: ids } } : {}) });
  if (!d.data?.id) throw new SocialError("X did not confirm the post; check the account before posting again", 502);
  const plan: Plan = { stage: "published", external: String(d.data.id), url: username ? `https://x.com/${username.replace(/^@/, "")}/status/${d.data.id}` : null };
  if (reply) {
    try {
      const sent = await xCall("/tweets", token, { text: reply, reply: { in_reply_to_tweet_id: String(d.data.id) } });
      if (!sent.data?.id) throw new SocialError("X did not confirm the link reply; check X before retrying", 502);
    }
    catch (e) { plan.error = `Main post published. Link reply failed: ${(e as Error).message}`; }
  }
  return plan;
}

/** Threads: what the container looks like. Pure (tested). */
export function threadsPlan(text: string, media: string[]): { kind: "text" } | { kind: "single"; url: string; video: boolean } | { kind: "carousel"; items: { url: string; video: boolean }[] } {
  if (text.length > 500) throw new SocialError("Threads posts are at most 500 characters");
  if (!media.length) return { kind: "text" };
  if (media.length === 1) return { kind: "single", url: media[0], video: isVideo(media[0]) };
  if (media.length > 20) throw new SocialError("Threads carousels take up to 20 photos or videos");
  return { kind: "carousel", items: media.map((url) => ({ url, video: isVideo(url) })) };
}

// ── TikTok: creator info, the post itself (Content Sharing Guidelines, docs/social-apps/tiktok.md §5.2) ─────────

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type CreatorInfo = {
  nickname: string; username: string; avatarUrl: string | null; privacyLevelOptions: string[];
  commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number | null;
  canPost: boolean; message?: string;
};
/** TikTok error codes that mean "this creator can't post right now" (not a broken connection). */
const CANT_POST = ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap", "spam_risk_too_many_pending_share", "spam_risk"];
export const TIKTOK_CANT_POST = "This TikTok account can't post right now. Try again later.";
export const TIKTOK_PRIVACY_CHANGED = "Choose who can view this TikTok post again — your TikTok options changed";
export const TIKTOK_PRIVACY_MISSING = "Choose who can view this TikTok post before it is sent";
export const TIKTOK_BRANDED_PRIVATE = "Branded content visibility cannot be set to private. Choose who can view this TikTok post again";

/** creator_info/query's data → what the post panel shows. Pure (tested). */
export function creatorInfoFrom(d: any): CreatorInfo {
  const opts = Array.isArray(d?.privacy_level_options) ? d.privacy_level_options.map(String).filter((o: string) => (TIKTOK_PRIVACY as readonly string[]).includes(o)) : [];
  const max = Number(d?.max_video_post_duration_sec);
  return {
    nickname: String(d?.creator_nickname ?? ""), username: String(d?.creator_username ?? ""), avatarUrl: typeof d?.creator_avatar_url === "string" ? d.creator_avatar_url : null,
    privacyLevelOptions: opts, commentDisabled: !!d?.comment_disabled, duetDisabled: !!d?.duet_disabled, stitchDisabled: !!d?.stitch_disabled,
    maxVideoPostDurationSec: Number.isFinite(max) && max > 0 ? max : null,
    canPost: opts.length > 0, ...(opts.length ? {} : { message: TIKTOK_CANT_POST }),
  };
}
/** Asked fresh every time (never cached): TikTok requires the panel to reflect the creator's settings now. */
export async function tiktokCreatorInfo(token: string): Promise<CreatorInfo> {
  try {
    const ci = await call("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { json: {}, bearer: token });
    return creatorInfoFrom(ci.data);
  } catch (e) {
    const code = (e as any)?.tiktokCode;
    if (code && CANT_POST.some((c) => code === c || code.startsWith(`${c}_`))) {
      return { nickname: "", username: "", avatarUrl: null, privacyLevelOptions: [], commentDisabled: true, duetDisabled: true, stitchDisabled: true, maxVideoPostDurationSec: null, canPost: false, message: TIKTOK_CANT_POST };
    }
    throw e;
  }
}
/** Let go of our access at TikTok (disconnect). Best effort: the caller deletes the stored rows either way. */
export async function tiktokRevoke(token: string): Promise<void> {
  const env = netDeps.env();
  await call("https://open.tiktokapis.com/v2/oauth/revoke/", { form: { client_key: String(env.SOCIAL_TIKTOK_CLIENT_KEY), client_secret: String(env.SOCIAL_TIKTOK_CLIENT_SECRET), token } });
}

/** `disableX` (native) or the stored payload's `disabledX` (shared/social.ts postPayload); unknown = not allowed. */
const off = (...v: unknown[]) => { const f = v.find((x) => x !== undefined && x !== null); return f === undefined ? true : !!f; };

/**
 * TikTok: video (one) or photos (up to 35), pulled from our verified domain. Pure (tested).
 * The privacy level is the one the customer chose — never a default, never a silent fallback: when it is missing or the
 * creator no longer offers it (`creator`, from creator_info at send time), the post stops and asks for a new choice.
 */
export function tiktokPlan(text: string, media: string[], target: Record<string, any>, creator?: Pick<CreatorInfo, "privacyLevelOptions" | "commentDisabled" | "duetDisabled" | "stitchDisabled">) {
  if (!media.length) throw new SocialError("TikTok needs a video or photos");
  const videos = media.filter(isVideo);
  if (videos.length && media.length > 1) throw new SocialError("TikTok takes one video, or photos without a video");
  if (!videos.length && media.length > 35) throw new SocialError("TikTok photo posts take up to 35 photos");
  const privacy = typeof target.privacyLevel === "string" ? target.privacyLevel : "";
  if (!privacy) throw new SocialError(TIKTOK_PRIVACY_MISSING);
  if (!(TIKTOK_PRIVACY as readonly string[]).includes(privacy)) throw new SocialError(TIKTOK_PRIVACY_CHANGED);
  if (creator && !creator.privacyLevelOptions.includes(privacy)) throw new SocialError(TIKTOK_PRIVACY_CHANGED);
  if (target.isBrandedContent && privacy === "SELF_ONLY") throw new SocialError(TIKTOK_BRANDED_PRIVATE);
  const brand = { brand_content_toggle: !!target.isBrandedContent, brand_organic_toggle: !!target.isYourBrand };
  const disable_comment = off(target.disableComment, target.disabledComments) || !!creator?.commentDisabled;
  if (videos.length) {
    const post_info = {
      title: text.slice(0, 2200), privacy_level: privacy, disable_comment,
      disable_duet: off(target.disableDuet, target.disabledDuet) || !!creator?.duetDisabled,
      disable_stitch: off(target.disableStitch, target.disabledStitch) || !!creator?.stitchDisabled,
      ...brand, is_aigc: !!target.isAiGenerated,
    };
    return { kind: "video" as const, body: { post_info, source_info: { source: "PULL_FROM_URL", video_url: videos[0] } } };
  }
  // Photo posts: no Duet / Stitch (TikTok's photo post_info has neither).
  const [first, ...rest] = text.split("\n");
  return { kind: "photo" as const, body: {
    post_info: { title: first.slice(0, 90), description: (rest.length ? rest.join("\n") : text).slice(0, 4000), privacy_level: privacy, disable_comment, ...brand },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: media },
    post_mode: "DIRECT_POST", media_type: "PHOTO" } };
}

/** Start a publish. Returns where it got to (a container / publish id to poll). */
export async function netPublish(api: NetApi, externalId: string, token: string, text: string, media: string[], target: Record<string, any>): Promise<Plan> {
  if (api === "ig_login") {
    if (!media.length) throw new SocialError("Instagram needs a photo or a video");
    const host = `https://graph.instagram.com/v25.0/${externalId}/media`;
    let id: string;
    if (media.length === 1) {
      id = (await call(host, { form: isVideo(media[0]) ? { media_type: "REELS", video_url: media[0], caption: text, share_to_feed: "true", access_token: token } : { image_url: media[0], caption: text, access_token: token } })).id;
    } else {
      if (media.length > 10) throw new SocialError("Instagram carousels take up to 10 photos or videos");
      const kids: string[] = [];
      for (const u of media) kids.push((await call(host, { form: isVideo(u) ? { media_type: "VIDEO", video_url: u, is_carousel_item: "true", access_token: token } : { image_url: u, is_carousel_item: "true", access_token: token } })).id);
      id = (await call(host, { form: { media_type: "CAROUSEL", children: kids.join(","), caption: text, access_token: token } })).id;
    }
    return { stage: "ig_container", container: String(id) };
  }
  if (api === "threads") {
    const plan = threadsPlan(text, media);
    const host = `https://graph.threads.net/v1.0/${externalId}/threads`;
    let id: string;
    if (plan.kind === "text") id = (await call(host, { form: { media_type: "TEXT", text, access_token: token } })).id;
    else if (plan.kind === "single") id = (await call(host, { form: plan.video ? { media_type: "VIDEO", video_url: plan.url, text, access_token: token } : { media_type: "IMAGE", image_url: plan.url, text, access_token: token } })).id;
    else {
      const kids: string[] = [];
      for (const it of plan.items) kids.push((await call(host, { form: it.video ? { media_type: "VIDEO", video_url: it.url, is_carousel_item: "true", access_token: token } : { media_type: "IMAGE", image_url: it.url, is_carousel_item: "true", access_token: token } })).id);
      id = (await call(host, { form: { media_type: "CAROUSEL", children: kids.join(","), text, access_token: token } })).id;
    }
    return { stage: "th_container", container: String(id) };
  }
  if (api === "x") return xPublish(token, text, media, String(target.xUsername ?? ""));
  tiktokPlan(text, media, target);   // the customer's own choices are complete before TikTok is asked anything
  // The creator's settings now: the chosen privacy level must still be offered (no fallback), and they must be able to post.
  const ci = await tiktokCreatorInfo(token);
  if (!ci.canPost) throw new SocialError(ci.message ?? TIKTOK_CANT_POST, 409);
  const plan = tiktokPlan(text, media, target, ci);
  const url = plan.kind === "video" ? "https://open.tiktokapis.com/v2/post/publish/video/init/" : "https://open.tiktokapis.com/v2/post/publish/content/init/";
  const d = await call(url, { json: plan.body, bearer: token });
  const pid = d.data?.publish_id;
  if (typeof pid !== "string") throw new SocialError("TikTok did not confirm the post", 502);
  return { stage: "tt_publish", container: pid, external: ci.username || undefined };
}

/** How far a publish has got; publishes Instagram / Threads containers once they are ready. */
export async function netRead(api: NetApi, externalId: string, token: string, stage: string, container: string, username?: string | null): Promise<Read> {
  if (api === "ig_login") {
    const s = await call(`https://graph.instagram.com/v25.0/${container}?${q({ fields: "status_code,status", access_token: token })}`);
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") return { state: "failed", error: `Instagram couldn't process the media${s.status ? `: ${String(s.status).slice(0, 160)}` : ""}` };
    if (s.status_code !== "FINISHED") return { state: "submitted" };
    const pub = await call(`https://graph.instagram.com/v25.0/${externalId}/media_publish`, { form: { creation_id: container, access_token: token } });
    const m = await call(`https://graph.instagram.com/v25.0/${pub.id}?${q({ fields: "permalink", access_token: token })}`).catch(() => null);
    return { state: "published", external: String(pub.id), url: m?.permalink ?? null };
  }
  if (api === "threads") {
    const s = await call(`https://graph.threads.net/v1.0/${container}?${q({ fields: "status,error_message", access_token: token })}`);
    if (s.status === "ERROR" || s.status === "EXPIRED") return { state: "failed", error: `Threads couldn't process the post${s.error_message ? `: ${String(s.error_message).slice(0, 160)}` : ""}` };
    if (s.status !== "FINISHED") return { state: "submitted" };
    const pub = await call(`https://graph.threads.net/v1.0/${externalId}/threads_publish`, { form: { creation_id: container, access_token: token } });
    const m = await call(`https://graph.threads.net/v1.0/${pub.id}?${q({ fields: "permalink", access_token: token })}`).catch(() => null);
    return { state: "published", external: String(pub.id), url: m?.permalink ?? null };
  }
  if (api === "x") return { state: "published", external: container, url: username ? `https://x.com/${username.replace(/^@/, "")}/status/${container}` : null };
  const d = await call("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { json: { publish_id: container }, bearer: token });
  const st = d.data?.status;
  if (st === "FAILED") return { state: "failed", error: `TikTok couldn't post it${d.data?.fail_reason ? `: ${String(d.data.fail_reason).replace(/_/g, " ")}` : ""}` };
  if (st !== "PUBLISH_COMPLETE") return { state: "submitted" };
  const ids: string[] = d.data?.publicaly_available_post_id ?? [];
  // Private (SELF_ONLY) posts have no public id: published, without a public address.
  return { state: "published", external: ids[0], url: ids[0] && username ? `https://www.tiktok.com/@${username.replace(/^@/, "")}/video/${ids[0]}` : null };
}
