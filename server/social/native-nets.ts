/**
 * ConstructHUB Direct — the networks that sign in on their own (not through a Facebook Page): Instagram login
 * (business accounts with no Facebook Page), Threads and TikTok. Each adapter knows its sign-in address, how to turn
 * the code into a long-lived token (and refresh it), who signed in, how to publish, and how to read a publish back.
 * server/social/native.ts stores the accounts and drives the queue; this file only speaks to the networks.
 *
 *   instagram (Instagram login)  SOCIAL_INSTAGRAM_APP_ID / _SECRET   graph.instagram.com     token 60 days, refreshable
 *   threads                      SOCIAL_THREADS_APP_ID / _SECRET     graph.threads.net       token 60 days, refreshable
 *   tiktok                       SOCIAL_TIKTOK_CLIENT_KEY / _SECRET  open.tiktokapis.com     access 24 h, refresh 365 days
 */
import { SocialError } from "./client";

export type NetApi = "ig_login" | "threads" | "tiktok";
export type Signed = { externalId: string; name: string; picture: string | null; token: string; expiresAt: Date | null; refresh: string | null; scopes: string[] };
export type Plan = { stage: string; container?: string; external?: string; url?: string | null };
export type Read = { state: "submitted" | "published" | "failed"; url?: string | null; external?: string; error?: string; stage?: string };

export const netDeps = { http: fetch as typeof fetch, env: () => process.env, now: () => Date.now() };
const base = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/$/, "");
export const netRedirect = (api: NetApi) => `${base()}/api/social/native/${api === "ig_login" ? "instagram" : api}/callback`;

const SCOPES: Record<NetApi, string[]> = {
  ig_login: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_insights"],
  threads: ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_read_replies", "threads_manage_replies", "threads_delete"],
  // No video.list: per-post TikTok stats are not read (server/social/insights.ts); docs/social-apps/tiktok.md §2.2.
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.publish"],
};
export const netScopes = (api: NetApi) => SCOPES[api];

/** Which of these networks have their app keys. Pure on env. */
export function netConfigured(api: NetApi, env: NodeJS.ProcessEnv = process.env): boolean {
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

export function netAuthUrl(api: NetApi, state: string): string {
  const env = netDeps.env();
  if (api === "ig_login") return `https://www.instagram.com/oauth/authorize?${q({ client_id: env.SOCIAL_INSTAGRAM_APP_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.ig_login.join(","), state })}`;
  if (api === "threads") return `https://threads.net/oauth/authorize?${q({ client_id: env.SOCIAL_THREADS_APP_ID, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.threads.join(","), state })}`;
  return `https://www.tiktok.com/v2/auth/authorize/?${q({ client_key: env.SOCIAL_TIKTOK_CLIENT_KEY, redirect_uri: netRedirect(api), response_type: "code", scope: SCOPES.tiktok.join(","), state })}`;
}

/** The code from the network → a long-lived token and who signed in. */
export async function netExchange(api: NetApi, code: string): Promise<Signed> {
  const env = netDeps.env();
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
  return api === "tiktok" ? left < 10 * 60_000 : left < 7 * 86_400_000;
}
export async function netRefresh(api: NetApi, token: string, refresh: string | null): Promise<Pick<Signed, "token" | "expiresAt" | "refresh">> {
  const env = netDeps.env();
  if (api === "ig_login") { const d = await call(`https://graph.instagram.com/refresh_access_token?${q({ grant_type: "ig_refresh_token", access_token: token })}`); return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: null }; }
  if (api === "threads") { const d = await call(`https://graph.threads.net/refresh_access_token?${q({ grant_type: "th_refresh_token", access_token: token })}`); return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: null }; }
  if (!refresh) throw reconnect();
  const d = await call("https://open.tiktokapis.com/v2/oauth/token/", { form: { client_key: String(env.SOCIAL_TIKTOK_CLIENT_KEY), client_secret: String(env.SOCIAL_TIKTOK_CLIENT_SECRET), grant_type: "refresh_token", refresh_token: refresh } });
  return { token: d.access_token, expiresAt: inSec(d.expires_in), refresh: d.refresh_token ?? refresh };
}

// ── publishing ─────────────────────────────────────────────────────────────────────────────────────────────

const isVideo = (u: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);

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

/** `disableX` (native) or Blotato's `disabledX` (shared/social.ts postPayload); unknown = not allowed. */
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
  const d = await call("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { json: { publish_id: container }, bearer: token });
  const st = d.data?.status;
  if (st === "FAILED") return { state: "failed", error: `TikTok couldn't post it${d.data?.fail_reason ? `: ${String(d.data.fail_reason).replace(/_/g, " ")}` : ""}` };
  if (st !== "PUBLISH_COMPLETE") return { state: "submitted" };
  const ids: string[] = d.data?.publicaly_available_post_id ?? [];
  // Private (SELF_ONLY) posts have no public id: published, without a public address.
  return { state: "published", external: ids[0], url: ids[0] && username ? `https://www.tiktok.com/@${username.replace(/^@/, "")}/video/${ids[0]}` : null };
}
