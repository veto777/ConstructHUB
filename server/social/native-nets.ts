/**
 * ConstructHUB Direct — the networks that sign in on their own (not through a Facebook Page): Instagram login
 * (business accounts with no Facebook Page), Threads, TikTok, X and Bluesky. Each adapter knows its sign-in address, how
 * to turn the code into a long-lived token (and refresh it), who signed in, how to publish, and how to read a publish back.
 * server/social/native.ts stores the accounts and drives the queue; this file only speaks to the networks.
 *
 *   instagram (Instagram login)  SOCIAL_INSTAGRAM_APP_ID / _SECRET   graph.instagram.com     token 60 days, refreshable
 *   threads                      SOCIAL_THREADS_APP_ID / _SECRET     graph.threads.net       token 60 days, refreshable
 *   tiktok                       SOCIAL_TIKTOK_CLIENT_KEY / _SECRET  open.tiktokapis.com     access 24 h, refresh 365 days
 *   x                            SOCIAL_X_CLIENT_ID / _SECRET       api.x.com              access 2 h, rotating refresh
 *   bluesky                      SOCIAL_BLUESKY=on (no app keys)    the account's own PDS   access ~2 h, refresh ~90 days
 *   pinterest                    SOCIAL_PINTEREST_APP_ID / _SECRET  api.pinterest.com/v5    access 30 days, refresh 1 year
 *
 * Bluesky has no app registration and no review: the customer signs in with an app password made at
 * https://bsky.app/settings/app-passwords (docs/social-apps/bluesky.md). ConstructHUB keeps the session tokens, never
 * the password.
 */
import https from "node:https";
import { lookup } from "node:dns";
import { publicIP, siteUrl } from "../sitescan/http";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { xSplitText, xWeightedLength } from "../../shared/social-x";
import { recordFailure } from "../ops/issues";
import { SocialError } from "./client";

export type NetApi = "ig_login" | "threads" | "tiktok" | "x" | "bluesky" | "pinterest";
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
  bluesky: [],   // an app password is the whole grant; Bluesky has no scopes
  // Boards to pick from, pins to create and read back, who signed in (docs/social-apps/pinterest.md §2).
  pinterest: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
};
export const netScopes = (api: NetApi) => SCOPES[api];

/** Which of these networks have their app keys (Bluesky needs none: it is switched on with SOCIAL_BLUESKY=on). Pure on env. */
export function netConfigured(api: NetApi, env: NodeJS.ProcessEnv = process.env): boolean {
  if (api === "bluesky") return /^(on|true|1)$/i.test((env.SOCIAL_BLUESKY ?? "").trim());
  if (api === "pinterest") return /^\d{5,30}$/.test(env.SOCIAL_PINTEREST_APP_ID ?? "") && /^\S{16,}$/.test(env.SOCIAL_PINTEREST_APP_SECRET ?? "");
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
  if (api === "bluesky") throw new SocialError("Bluesky signs in with an app password, not a sign-in page; use the Bluesky form");
  if (api === "pinterest") return `https://www.pinterest.com/oauth/?${q({ client_id: env.SOCIAL_PINTEREST_APP_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.pinterest.join(","), state })}`;
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
  if (api === "bluesky") throw new SocialError("Bluesky signs in with an app password, not a sign-in page; use the Bluesky form");
  if (api === "pinterest") {
    const t = await pinterestToken({ grant_type: "authorization_code", code, redirect_uri: netRedirect(api) });
    const granted = String(t.scope ?? "").split(/[\s,]+/).filter(Boolean);
    if (!granted.includes("pins:write")) throw new SocialError("Pinterest didn't allow posting. Connect again and allow every permission it asks for.");
    const me = await pinterestCall("/user_account", t.access_token);
    if (!me?.username) throw new SocialError("Pinterest did not identify the signed-in account", 502);
    return { externalId: String(me.id ?? me.username), name: `@${me.username}`, picture: typeof me.profile_image === "string" ? me.profile_image : null, token: t.access_token, expiresAt: inSec(t.expires_in ?? 30 * 86400), refresh: t.refresh_token ?? null, scopes: granted };
  }
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

/** A fresh token when the stored one is close to expiring (TikTok, X, Bluesky: within 10 minutes; the others: within 7 days). */
export function needsRefresh(api: NetApi, expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  const left = expiresAt.getTime() - netDeps.now();
  return api === "tiktok" || api === "x" || api === "bluesky" ? left < 10 * 60_000 : left < 7 * 86_400_000;
}
export async function netRefresh(api: NetApi, token: string, refresh: string | null): Promise<Pick<Signed, "token" | "expiresAt" | "refresh">> {
  const env = netDeps.env();
  if (api === "bluesky") return blueskyRefresh(refresh);
  if (api === "pinterest") {
    if (!refresh) throw reconnect();
    const d = await pinterestToken({ grant_type: "refresh_token", refresh_token: refresh });
    return { token: d.access_token, expiresAt: inSec(d.expires_in ?? 30 * 86400), refresh: d.refresh_token ?? refresh };
  }
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

// ── Bluesky (AT Protocol): app-password session, facets, images, video (docs/social-apps/bluesky.md) ─────────────

export const BLUESKY_MAX_GRAPHEMES = 300;
const BLUESKY_IMAGE_BYTES = 1_000_000;          // the PDS refuses larger image blobs
const BLUESKY_VIDEO_BYTES = 100 * 1024 * 1024;  // video.bsky.app's limit
const BLUESKY_VIDEO_HOST = "https://video.bsky.app";
const BLUESKY_PUBLIC_API = "https://public.api.bsky.app";
const BLUESKY_DEFAULT_PDS = "https://bsky.social";
/** Bluesky app passwords are four groups of four, dashes between (never the account's main password). */
export const BLUESKY_APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;
const BLUESKY_HANDLE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** A Bluesky handle as the network wants it: no "@", no spaces, lower case. */
export function blueskyHandle(input: string): string {
  const h = String(input ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!BLUESKY_HANDLE.test(h)) throw new SocialError("Enter the Bluesky handle, like yourbusiness.bsky.social");
  return h;
}
/** The claims of an AT Protocol session JWT (sub = the account's DID, exp = seconds). No signature check: it is only used to find the PDS and the expiry. */
export function jwtClaims(token: string): { sub?: string; exp?: number; aud?: string } {
  try { return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")); } catch { return {}; }
}
const jwtExpiry = (token: string, fallbackSec: number): Date => { const e = Number(jwtClaims(token).exp); return e > 0 ? new Date(e * 1000) : new Date(netDeps.now() + fallbackSec * 1000); };

/** One XRPC call. Bluesky's errors come as { error, message }; expired or revoked sessions ask to reconnect. */
async function atp(base: string, nsid: string, init: { method?: string; bearer?: string; json?: unknown; body?: Uint8Array; contentType?: string; query?: Record<string, string> } = {}): Promise<any> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  else if (init.body) { headers["Content-Type"] = init.contentType ?? "application/octet-stream"; body = init.body as BodyInit; }
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  const url = `${base.replace(/\/$/, "")}/xrpc/${nsid}${init.query ? `?${q(init.query)}` : ""}`;
  let r: Response;
  try { r = await netDeps.http(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new SocialError("Bluesky didn't answer; check the post before sending it again", 502); }
  const d: any = await r.json().catch(() => null);
  if (!r.ok) {
    const code = String(d?.error ?? "");
    if (r.status === 429 || code === "RateLimitExceeded") throw new SocialError("Bluesky is limiting how fast we post; it will retry shortly", 429);
    // Signing in: a refused handle/password is the customer's to fix, not a lost session.
    if (nsid === "com.atproto.server.createSession" && (r.status === 401 || r.status === 400)) throw new SocialError("Bluesky didn't accept that handle and app password. Make a new app password at bsky.app/settings/app-passwords and try again.", 400);
    if (r.status === 401 || ["ExpiredToken", "InvalidToken", "AuthenticationRequired", "AccountTakedown", "AccountDeactivated"].includes(code)) throw reconnect();
    const say = String(d?.message || code).slice(0, 200);
    throw new SocialError(say ? `Bluesky refused it: ${say}` : "Bluesky refused the request", r.status >= 500 ? 502 : 400);
  }
  if (!d || typeof d !== "object") throw new SocialError("Bluesky sent an unreadable answer", 502);
  return d;
}

/** Where an account lives: its DID document's #atproto_pds service (bsky.social for most; self-hosters differ). Cached for a day. */
const pdsCache = new Map<string, { pds: string; until: number }>();
export async function blueskyPds(did: string): Promise<string> {
  const hit = pdsCache.get(did);
  if (hit && hit.until > netDeps.now()) return hit.pds;
  let doc: any = null;
  try {
    const url = did.startsWith("did:plc:") ? `https://plc.directory/${encodeURIComponent(did)}`
      : did.startsWith("did:web:") ? `https://${did.slice("did:web:".length).split(":")[0]}/.well-known/did.json` : null;
    if (url) { const r = await netDeps.http(url, { redirect: "error", signal: AbortSignal.timeout(20_000) }); if (r.ok) doc = await r.json().catch(() => null); }
  } catch { /* fall back to bsky.social */ }
  const svc = Array.isArray(doc?.service) ? doc.service.find((s: any) => s?.id === "#atproto_pds" || s?.type === "AtprotoPersonalDataServer") : null;
  const pds = typeof svc?.serviceEndpoint === "string" && /^https:\/\//.test(svc.serviceEndpoint) ? svc.serviceEndpoint.replace(/\/$/, "") : BLUESKY_DEFAULT_PDS;
  pdsCache.set(did, { pds, until: netDeps.now() + 86_400_000 });
  return pds;
}
/** `@handle` → DID, for mention facets. Null when Bluesky doesn't know it (the mention stays plain text). */
async function blueskyResolve(handle: string): Promise<string | null> {
  try { const d = await atp(BLUESKY_PUBLIC_API, "com.atproto.identity.resolveHandle", { query: { handle } }); return typeof d.did === "string" ? d.did : null; }
  catch { return null; }
}

/** Sign in with a handle and an app password: who it is, the session tokens, and the account's picture. */
export async function blueskyLogin(handleInput: string, appPassword: string): Promise<Signed> {
  const handle = blueskyHandle(handleInput);
  const password = String(appPassword ?? "").trim();
  if (!BLUESKY_APP_PASSWORD.test(password)) throw new SocialError("Use a Bluesky app password (four groups of four, like abcd-efgh-ijkl-mnop), not your main password. Make one at bsky.app/settings/app-passwords.");
  const did = await blueskyResolve(handle);
  if (!did) throw new SocialError("Bluesky doesn't know that handle. Check the spelling (yourbusiness.bsky.social, or your own domain).");
  const pds = await blueskyPds(did);
  const s = await atp(pds, "com.atproto.server.createSession", { json: { identifier: handle, password } });
  if (typeof s.accessJwt !== "string" || typeof s.refreshJwt !== "string" || typeof s.did !== "string") throw new SocialError("Bluesky did not open a session", 502);
  const profile = await atp(pds, "app.bsky.actor.getProfile", { bearer: s.accessJwt, query: { actor: s.did } }).catch(() => ({}));
  return { externalId: s.did, name: `@${typeof s.handle === "string" && s.handle ? s.handle : handle}`, picture: typeof profile.avatar === "string" ? profile.avatar : null,
    token: s.accessJwt, expiresAt: jwtExpiry(s.accessJwt, 7200), refresh: s.refreshJwt, scopes: SCOPES.bluesky };
}
/** A new access token from the refresh token (Bluesky rotates both). */
async function blueskyRefresh(refresh: string | null): Promise<Pick<Signed, "token" | "expiresAt" | "refresh">> {
  if (!refresh) throw reconnect();
  const did = String(jwtClaims(refresh).sub ?? "");
  const pds = did ? await blueskyPds(did) : BLUESKY_DEFAULT_PDS;
  const s = await atp(pds, "com.atproto.server.refreshSession", { method: "POST", bearer: refresh });
  if (typeof s.accessJwt !== "string") throw reconnect();
  return { token: s.accessJwt, expiresAt: jwtExpiry(s.accessJwt, 7200), refresh: typeof s.refreshJwt === "string" ? s.refreshJwt : refresh };
}

/** Graphemes, the unit Bluesky counts (an emoji is 1, not its code points). */
export function blueskyLength(text: string): number {
  let n = 0;
  for (const _ of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text.normalize("NFC"))) n++;
  return n;
}
export type BlueskyFacet = { index: { byteStart: number; byteEnd: number }; features: ({ $type: "app.bsky.richtext.facet#link"; uri: string } | { $type: "app.bsky.richtext.facet#tag"; tag: string } | { $type: "app.bsky.richtext.facet#mention"; did: string })[] };
/**
 * Links, #hashtags and @mentions as facets with UTF-8 byte offsets — without them Bluesky shows plain text. Pure except
 * for mentions, which `resolve` turns into DIDs (unknown handles stay plain). Trailing sentence punctuation stays outside
 * a link, like X's splitter.
 */
export async function blueskyFacets(text: string, resolve: (handle: string) => Promise<string | null> = blueskyResolve): Promise<BlueskyFacet[]> {
  const enc = new TextEncoder();
  const bytesBefore = (i: number) => enc.encode(text.slice(0, i)).length;
  const facets: BlueskyFacet[] = [];
  const link = /(?<![\w@.])((?:https?:\/\/|www\.)[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*)/giu;
  for (const m of text.matchAll(link)) {
    let raw = m[1];
    while (/[.,!?;:"'’”)]$/u.test(raw) && !(raw.endsWith(")") && (raw.match(/\(/g) ?? []).length >= (raw.match(/\)/g) ?? []).length)) raw = raw.slice(0, -1);
    const start = m.index!, end = start + raw.length;
    facets.push({ index: { byteStart: bytesBefore(start), byteEnd: bytesBefore(end) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: /^www\./i.test(raw) ? `https://${raw}` : raw }] });
  }
  const tag = /(?<![\w/#@])#([\p{L}\p{N}_]{1,64})(?![\p{L}\p{N}_])/gu;
  for (const m of text.matchAll(tag)) {
    if (/^\d+$/.test(m[1])) continue;   // "#1" is a number, not a tag
    const start = m.index!, end = start + m[0].length;
    facets.push({ index: { byteStart: bytesBefore(start), byteEnd: bytesBefore(end) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }] });
  }
  const mention = /(?<![\w@])@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?![\w.])/giu;
  for (const m of text.matchAll(mention)) {
    const did = await resolve(m[1].toLowerCase());
    if (!did) continue;
    const start = m.index!, end = start + m[0].length;
    facets.push({ index: { byteStart: bytesBefore(start), byteEnd: bytesBefore(end) }, features: [{ $type: "app.bsky.richtext.facet#mention", did }] });
  }
  // Facets may not overlap: keep the first by position, drop any that start inside an earlier one.
  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  const out: BlueskyFacet[] = [];
  for (const f of facets) if (!out.length || f.index.byteStart >= out[out.length - 1].index.byteEnd) out.push(f);
  return out;
}

/** What a Bluesky post will carry. Pure (tested): ≤ 300 graphemes, up to 4 images or one video, text optional with media. */
export function blueskyPlan(text: string, media: string[]): { kind: "text" } | { kind: "images"; urls: string[] } | { kind: "video"; url: string } {
  if (blueskyLength(text) > BLUESKY_MAX_GRAPHEMES) throw new SocialError(`Bluesky posts are at most ${BLUESKY_MAX_GRAPHEMES} characters`);
  if (!media.length) {
    if (!text.trim()) throw new SocialError("Bluesky needs text, photos or a video");
    return { kind: "text" };
  }
  const videos = media.filter(isVideo);
  if (videos.length) {
    if (media.length > 1) throw new SocialError("Bluesky takes one video, or up to four photos without a video");
    return { kind: "video", url: videos[0] };
  }
  if (media.length > 4) throw new SocialError("Bluesky takes up to four photos");
  return { kind: "images", urls: media };
}
/** A public HTTPS file, through the pinned-DNS transport (no bearer, no redirects), bounded. */
async function blueskyFetch(url: string, max: number, what: string): Promise<Buffer> {
  const safe = siteUrl(url);
  if (!safe.startsWith("https://")) throw new SocialError("Use a public HTTPS media URL");
  try {
    const response = await netDeps.mediaHttp(safe);
    if (!response.ok) throw new Error("download failed");
    const file = Buffer.from(await response.arrayBuffer());
    if (!file.length || file.length > max) throw new Error("invalid size");
    return file;
  } catch { throw new SocialError(`Bluesky couldn't read the ${what}; use a public HTTPS file under ${Math.round(max / 1024 / 1024)} MB`); }
}
/** An image Bluesky will take: under 1,000,000 bytes (re-encoded as JPEG when larger), with its aspect ratio. */
export async function blueskyImage(file: Buffer): Promise<{ bytes: Uint8Array; type: string; width: number; height: number }> {
  const meta = await sharp(file).metadata().catch(() => null);
  if (!meta?.width || !meta?.height) throw new SocialError("Bluesky couldn't read that image; use a JPEG, PNG or WebP");
  const type = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : meta.format === "gif" ? "image/gif" : "image/jpeg";
  if (file.length <= BLUESKY_IMAGE_BYTES) return { bytes: new Uint8Array(file), type, width: meta.width, height: meta.height };
  let img = sharp(file).rotate();
  let { width, height } = meta;
  if (Math.max(width, height) > 2000) { img = img.resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }); const s = 2000 / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
  for (const quality of [85, 75, 65, 55, 45]) {
    const out = await img.jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= BLUESKY_IMAGE_BYTES) return { bytes: new Uint8Array(out), type: "image/jpeg", width, height };
  }
  throw new SocialError("That image is too large for Bluesky even after shrinking; use a smaller one");
}
async function blueskyUploadImages(pds: string, token: string, urls: string[]) {
  const images: any[] = [];
  for (const url of urls) {
    const img = await blueskyImage(await blueskyFetch(url, 50 * 1024 * 1024, "photo"));
    const d = await atp(pds, "com.atproto.repo.uploadBlob", { bearer: token, body: img.bytes, contentType: img.type });
    if (!d.blob) throw new SocialError("Bluesky did not confirm the photo upload", 502);
    images.push({ image: d.blob, alt: "", aspectRatio: { width: img.width, height: img.height } });
  }
  return { $type: "app.bsky.embed.images", images };
}
/** Video goes through video.bsky.app with a service token from the account's PDS, then is polled until processed. */
async function blueskyUploadVideo(pds: string, did: string, token: string, url: string) {
  const file = await blueskyFetch(url, BLUESKY_VIDEO_BYTES, "video");
  const aud = `did:web:${new URL(pds).host}`;
  const auth = await atp(pds, "com.atproto.server.getServiceAuth", { bearer: token, query: { aud, lxm: "com.atproto.repo.uploadBlob", exp: String(Math.floor(netDeps.now() / 1000) + 30 * 60) } });
  if (typeof auth.token !== "string") throw new SocialError("Bluesky did not allow the video upload", 502);
  let job = await atp(BLUESKY_VIDEO_HOST, "app.bsky.video.uploadVideo", { bearer: auth.token, body: new Uint8Array(file), contentType: /\.mov(?:\?|$)/i.test(url) ? "video/quicktime" : "video/mp4", query: { did, name: `video-${netDeps.now()}.mp4` } });
  for (let i = 0; !job.blob && job.jobStatus?.state !== "JOB_STATE_COMPLETED"; i++) {
    const st = job.jobStatus ?? job;
    if (st.state === "JOB_STATE_FAILED") throw new SocialError(`Bluesky couldn't process the video${st.error ? `: ${String(st.error).slice(0, 160)}` : ""}`);
    if (st.blob) { job = st; break; }
    if (i >= 90) throw new SocialError("Bluesky took too long to process the video", 502);
    await netDeps.sleep(3000);
    const jobId = st.jobId ?? job.jobId;
    if (!jobId) throw new SocialError("Bluesky did not confirm the video upload", 502);
    job = await atp(BLUESKY_VIDEO_HOST, "app.bsky.video.getJobStatus", { bearer: auth.token, query: { jobId: String(jobId) } });
  }
  const blob = job.blob ?? job.jobStatus?.blob;
  if (!blob) throw new SocialError("Bluesky did not return the processed video", 502);
  return { $type: "app.bsky.embed.video", video: blob };
}
/** One post on Bluesky: text with facets, photos or a video. Published at once — there is nothing to poll. */
async function blueskyPublish(did: string, token: string, text: string, media: string[], handle: string): Promise<Plan> {
  const plan = blueskyPlan(text, media);
  const pds = await blueskyPds(did);
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text: text.normalize("NFC"), createdAt: new Date(netDeps.now()).toISOString() };
  const facets = await blueskyFacets(record.text as string);
  if (facets.length) record.facets = facets;
  if (plan.kind === "images") record.embed = await blueskyUploadImages(pds, token, plan.urls);
  if (plan.kind === "video") record.embed = await blueskyUploadVideo(pds, did, token, plan.url);
  const d = await atp(pds, "com.atproto.repo.createRecord", { bearer: token, json: { repo: did, collection: "app.bsky.feed.post", record } });
  if (typeof d.uri !== "string") throw new SocialError("Bluesky did not confirm the post; check the account before posting again", 502);
  const rkey = d.uri.split("/").pop();
  return { stage: "published", external: d.uri, url: handle && rkey ? `https://bsky.app/profile/${handle.replace(/^@/, "")}/post/${rkey}` : null };
}
/** Take a post down on Bluesky (disconnect keeps the session; deleting a post needs it). */
export async function blueskyDelete(did: string, token: string, uri: string): Promise<void> {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([\w.:~-]+)$/.exec(uri);
  if (!m) throw new SocialError("That isn't a Bluesky post", 400);
  await atp(await blueskyPds(did), "com.atproto.repo.deleteRecord", { bearer: token, json: { repo: did, collection: "app.bsky.feed.post", rkey: m[2] } });
}

// ── Pinterest (API v5): OAuth app, boards, image / carousel / video pins (docs/social-apps/pinterest.md) ─────────

const PINTEREST_API = "https://api.pinterest.com/v5";
const PINTEREST_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;   // Pinterest's limit for a video pin is 2 GB; ours is bounded by the media transport
export const PINTEREST_TITLE_MAX = 100;
export const PINTEREST_DESCRIPTION_MAX = 800;

/** One v5 call. Pinterest's errors come as { code, message }; 401 asks to reconnect; a Trial-access app is told so. */
async function pinterestRequest(path: string, init: RequestInit & { bearer?: string; json?: unknown; basic?: string; form?: Record<string, string> } = {}): Promise<any> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  if (init.form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(init.form); }
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  if (init.basic) headers.Authorization = `Basic ${init.basic}`;
  let r: Response;
  try { r = await netDeps.http(`${PINTEREST_API}${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new SocialError("Pinterest didn't answer; check the post before sending it again", 502); }
  if (r.status === 204) return {};
  const d: any = await r.json().catch(() => null);
  if (!r.ok) {
    const say = String(d?.message ?? "").slice(0, 200);
    if (r.status === 401 || /token.*(expired|invalid)|invalid_grant/i.test(say)) throw reconnect();
    if (r.status === 429) throw new SocialError("Pinterest is limiting how fast we post; it will retry shortly", 429);
    if (r.status === 403 && /trial/i.test(say)) throw new SocialError("Pinterest only lets this app post to the ConstructHUB account until Pinterest approves it (Standard access)", 403);
    throw new SocialError(say ? `Pinterest refused it: ${say}` : "Pinterest refused the request", r.status >= 500 ? 502 : 400);
  }
  if (!d || typeof d !== "object") throw new SocialError("Pinterest sent an unreadable answer", 502);
  return d;
}
const pinterestCall = (path: string, token: string, json?: unknown, method?: string) => pinterestRequest(path, { method: method ?? (json === undefined ? "GET" : "POST"), bearer: token, ...(json === undefined ? {} : { json }) });
/** OAuth token calls: the app's id and secret as HTTP Basic (Pinterest v5). */
async function pinterestToken(form: Record<string, string>) {
  const env = netDeps.env();
  const d = await pinterestRequest("/oauth/token", { method: "POST", basic: Buffer.from(`${env.SOCIAL_PINTEREST_APP_ID}:${env.SOCIAL_PINTEREST_APP_SECRET}`).toString("base64"), form });
  if (!d.access_token) throw new SocialError("Pinterest did not return a sign-in; reconnect the account", 409);
  return d;
}
/** The boards this account can pin to (all pages). */
export async function pinterestBoards(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let bookmark: string | null = null, i = 0; i < 20; i++) {
    const d = await pinterestCall(`/boards?${q({ page_size: 250, ...(bookmark ? { bookmark } : {}) })}`, token);
    for (const b of Array.isArray(d.items) ? d.items : []) if (b?.id) out.push({ id: String(b.id), name: String(b.name || b.id) });
    bookmark = typeof d.bookmark === "string" && d.bookmark ? d.bookmark : null;
    if (!bookmark) break;
  }
  return out;
}
const firstLink = /(?:https?:\/\/|www\.)[^\s<>()]+/i;
/**
 * What a pin will carry. Pure (tested): a board is required; title ≤ 100 (the composer's, else the first line); description ≤ 800;
 * the first link in the text becomes the pin's link; one photo, a carousel of 2–5 photos, or one video (with a cover photo
 * when one is given, else a frame from the video).
 */
export function pinterestPlan(text: string, media: string[], target: Record<string, any>) {
  const boardId = String(target.boardId ?? "").trim();
  if (!/^\d{1,30}$/.test(boardId)) throw new SocialError("Choose a Pinterest board for this post");
  if (!media.length) throw new SocialError("Pinterest needs a photo or a video");
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const title = String(target.title ?? "").trim().slice(0, PINTEREST_TITLE_MAX) || (lines[0] ?? "").slice(0, PINTEREST_TITLE_MAX);
  if (!title) throw new SocialError("Pinterest needs a title or a first line of text");
  const link = text.match(firstLink)?.[0].replace(/[.,!?;:"'’”)]+$/u, "");
  const base = { boardId, title, description: text.trim().slice(0, PINTEREST_DESCRIPTION_MAX), link: link ? (/^www\./i.test(link) ? `https://${link}` : link) : null };
  const videos = media.filter(isVideo), images = media.filter((u) => !isVideo(u));
  if (videos.length > 1) throw new SocialError("Pinterest takes one video per pin");
  if (videos.length) return { ...base, kind: "video" as const, url: videos[0], cover: images[0] ?? null };
  if (images.length > 5) throw new SocialError("Pinterest carousels take up to five photos");
  return images.length === 1 ? { ...base, kind: "image" as const, url: images[0] } : { ...base, kind: "carousel" as const, urls: images };
}
/** A cover for a video pin: the customer's photo, else the frame one second in (ffmpeg). Returns JPEG bytes. */
export async function pinterestCover(video: Buffer, coverUrl: string | null): Promise<Buffer> {
  if (coverUrl) return blueskyFetchPublic(coverUrl, 50 * 1024 * 1024, "cover photo");
  const dir = await mkdtemp(join(tmpdir(), "chub-pin-"));
  try {
    const src = join(dir, "video.mp4"), out = join(dir, "cover.jpg");
    await writeFile(src, video);
    await new Promise<void>((resolve, reject) => execFile("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1", "-i", src, "-frames:v", "1", "-q:v", "3", out], { timeout: 60_000 }, (e) => (e ? reject(e) : resolve())));
    return await readFile(out);
  } catch { throw new SocialError("Pinterest video pins need a cover photo: add one photo with the video"); }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const blueskyFetchPublic = (url: string, max: number, what: string) => blueskyFetch(url, max, what);
/** Video: register, upload to Pinterest's storage, wait for processing; returns the media id. */
async function pinterestUploadVideo(token: string, file: Buffer): Promise<string> {
  const reg = await pinterestCall("/media", token, { media_type: "video" });
  const id = reg.media_id, uploadUrl = reg.upload_url, params = reg.upload_parameters;
  if (typeof id !== "string" || typeof uploadUrl !== "string" || !params || typeof params !== "object") throw new SocialError("Pinterest did not start the video upload", 502);
  if (!/^https:\/\//.test(uploadUrl)) throw new SocialError("Pinterest sent an unusable upload address", 502);
  const form = new FormData();
  for (const [k, v] of Object.entries(params as Record<string, string>)) form.set(k, String(v));
  form.set("file", new Blob([new Uint8Array(file) as BlobPart], { type: "video/mp4" }), "video.mp4");
  let up: Response;
  try { up = await netDeps.http(uploadUrl, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(10 * 60_000) }); }
  catch { throw new SocialError("Pinterest's storage didn't accept the video; try again", 502); }
  if (!up.ok) throw new SocialError("Pinterest's storage refused the video", 502);
  for (let i = 0; ; i++) {
    const s = await pinterestCall(`/media/${encodeURIComponent(id)}`, token);
    if (s.status === "succeeded") return id;
    if (s.status === "failed") throw new SocialError("Pinterest couldn't process the video");
    if (i >= 60) throw new SocialError("Pinterest took too long to process the video", 502);
    await netDeps.sleep(5000);
  }
}
/** One pin: image, carousel or video. Pinterest returns the pin at once (a video keeps processing behind it). */
async function pinterestPublish(token: string, text: string, media: string[], target: Record<string, any>): Promise<Plan> {
  const plan = pinterestPlan(text, media, target);
  const body: Record<string, unknown> = { board_id: plan.boardId, title: plan.title, description: plan.description, ...(plan.link ? { link: plan.link } : {}) };
  if (plan.kind === "image") body.media_source = { source_type: "image_url", url: plan.url };
  else if (plan.kind === "carousel") body.media_source = { source_type: "multiple_image_urls", items: plan.urls.map((url) => ({ url })) };
  else {
    const video = await blueskyFetch(plan.url, Math.min(PINTEREST_VIDEO_BYTES, 250 * 1024 * 1024), "video");
    const cover = await pinterestCover(video, plan.cover);
    const mediaId = await pinterestUploadVideo(token, video);
    body.media_source = { source_type: "video_id", media_id: mediaId, cover_image_content_type: "image/jpeg", cover_image_data: cover.toString("base64") };
  }
  const d = await pinterestCall("/pins", token, body);
  if (!d?.id) throw new SocialError("Pinterest did not confirm the pin; check the board before posting again", 502);
  return { stage: "published", external: String(d.id), url: `https://www.pinterest.com/pin/${d.id}/` };
}
export async function pinterestDelete(token: string, id: string): Promise<void> {
  if (!/^\d{1,30}$/.test(id)) throw new SocialError("That isn't a Pinterest pin", 400);
  await pinterestCall(`/pins/${id}`, token, undefined, "DELETE");
}

/** Start a publish. Returns where it got to (a container / publish id to poll). */
export async function netPublish(api: NetApi, externalId: string, token: string, text: string, media: string[], target: Record<string, any>): Promise<Plan> {
  if (api === "bluesky") return blueskyPublish(externalId, token, text, media, String(target.blueskyHandle ?? ""));
  if (api === "pinterest") return pinterestPublish(token, text, media, target);
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
  if (api === "bluesky") { const rkey = container.split("/").pop(); return { state: "published", external: container, url: username && rkey ? `https://bsky.app/profile/${username.replace(/^@/, "")}/post/${rkey}` : null }; }
  if (api === "pinterest") return { state: "published", external: container, url: `https://www.pinterest.com/pin/${container}/` };
  const d = await call("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { json: { publish_id: container }, bearer: token });
  const st = d.data?.status;
  if (st === "FAILED") return { state: "failed", error: `TikTok couldn't post it${d.data?.fail_reason ? `: ${String(d.data.fail_reason).replace(/_/g, " ")}` : ""}` };
  if (st !== "PUBLISH_COMPLETE") return { state: "submitted" };
  const ids: string[] = d.data?.publicaly_available_post_id ?? [];
  // Private (SELF_ONLY) posts have no public id: published, without a public address.
  return { state: "published", external: ids[0], url: ids[0] && username ? `https://www.tiktok.com/@${username.replace(/^@/, "")}/video/${ids[0]}` : null };
}
