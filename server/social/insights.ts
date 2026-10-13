/**
 * ConstructHUB Direct — what posting alone never showed (owner, 2026-10-12: "you cant see followers, stats, likes, or
 * delete videos"): account stats, per-post stats, comments (read, reply, hide, delete) and deleting a published post,
 * for the accounts connected through our own apps (server/social/native.ts). Each network says what it allows:
 *
 *   Facebook Page   followers, reach/views/engagement; post reactions/comments/shares/reach; comments reply/hide/delete; delete post
 *   Instagram       followers/following/posts, reach/views/interactions; post likes/comments/reach/views/saves/shares;
 *                   comments reply/hide/delete; delete post (Facebook login: instagram_manage_contents)
 *   Threads         followers, views/likes/replies/reposts/quotes; replies reply/hide; delete post
 *   TikTok          followers/following/likes/videos; video likes/comments/shares/views (public videos only);
 *                   no comments and no deleting through the API
 *
 * Answers are cached for 10 minutes per account / post, and dropped after anything is changed.
 */
import { xDelete, blueskyDelete, pinterestDelete, redditDelete, tumblrDelete } from "./native-nets";
import { pool } from "../db";
import { SocialError } from "./client";
import { NativeClient, graphError, nativeDeps, type NativeRow } from "./native";

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
export const clearInsightsCache = () => cache.clear();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && nativeDeps.now() - hit.at < TTL) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: nativeDeps.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return value;
}
const forget = (prefix: string) => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };

// ── calls ──────────────────────────────────────────────────────────────────────────────────────────────────

type Api = "meta" | "ig_login" | "threads" | "tiktok" | "x" | "bluesky" | "pinterest" | "reddit" | "mastodon" | "tumblr";
const HOST: Record<Exclude<Api, "tiktok" | "x" | "bluesky" | "pinterest" | "reddit" | "mastodon" | "tumblr">, string> = {
  meta: "https://graph.facebook.com/v25.0", ig_login: "https://graph.instagram.com/v25.0", threads: "https://graph.threads.net/v1.0",
};
async function req(url: string, init: RequestInit): Promise<{ r: Response; d: any }> {
  let r: Response;
  try { r = await nativeDeps.http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new SocialError("The network didn't answer; try again in a moment", 502); }
  let d: any = null;
  try { d = await r.json(); } catch { /* checked by the caller */ }
  return { r, d };
}
/** Meta-family Graph (Facebook, Instagram, Threads hosts). */
async function g(api: keyof typeof HOST, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | boolean | undefined>, token: string): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  q.set("access_token", token);
  const url = method === "POST" ? `${HOST[api]}/${path}` : `${HOST[api]}/${path}?${q}`;
  const { r, d } = await req(url, method === "POST" ? { method, body: q, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : { method });
  if (!r.ok || d?.error) throw graphError(d?.error, r.status);
  return d ?? {};
}
async function tk(path: string, token: string, body?: unknown): Promise<any> {
  const { r, d } = await req(`https://open.tiktokapis.com${path}`, body === undefined
    ? { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    : { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
  const code = d?.error?.code;
  if (code === "access_token_invalid" || r.status === 401) throw graphError({ code: 190 }, 401);
  if (code === "scope_not_authorized") throw new SocialError("TikTok didn't allow ConstructHUB to read stats; reconnect TikTok and allow everything it asks", 403);
  if (code === "rate_limit_exceeded") throw new SocialError("TikTok is limiting how often we read stats; try again in a minute", 429);
  if (!r.ok || (code && code !== "ok")) throw new SocialError(`TikTok refused it: ${String(d?.error?.message || code || r.status).slice(0, 200)}`, r.status >= 500 ? 502 : 400);
  return d ?? {};
}
/** A metric the network may have retired or not offer for this account: null instead of failing everything. */
const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch((e) => { if ((e as any)?.reconnect) throw e; return null; });
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const sum = (...v: (number | null)[]) => (v.some((x) => x !== null) ? v.reduce<number>((a, b) => a + (b ?? 0), 0) : null);
const apiOf = (row: NativeRow): Api => (row.api as Api) || "meta";

// ── account stats ──────────────────────────────────────────────────────────────────────────────────────────

export type AccountStats = {
  accountId: string; platform: string; name: string; days: number;
  followers: number | null; following: number | null; posts: number | null; likes: number | null;
  reach: number | null; views: number | null; engagement: number | null;
  error: string | null; note: string | null;
};
const blank = (row: NativeRow, days: number): AccountStats => ({ accountId: row.id, platform: row.platform, name: row.name, days,
  followers: null, following: null, posts: null, likes: null, reach: null, views: null, engagement: null, error: null, note: null });

/** Meta's insights: a daily series summed, or a total_value. */
const insightTotal = (d: any): number | null => {
  const m = d?.data?.[0];
  if (!m) return null;
  if (m.total_value && num(m.total_value.value) !== null) return num(m.total_value.value);
  return Array.isArray(m.values) ? sum(...m.values.map((v: any) => num(v?.value))) : null;
};

async function accountStatsFor(row: NativeRow, token: string, days: number): Promise<AccountStats> {
  const out = blank(row, days);
  const until = Math.floor(nativeDeps.now() / 1000), since = until - days * 86400;
  const api = apiOf(row);
  if (api === "x") return { ...out, note: "See your statistics on X." };
  if (api === "bluesky") return { ...out, note: "See your statistics on Bluesky." };
  if (api === "pinterest") return { ...out, note: "See your statistics in Pinterest Analytics." };
  if (api === "reddit") return { ...out, note: "See your statistics on Reddit." };
  if (api === "mastodon") return { ...out, note: "See your statistics on your Mastodon server." };
  if (api === "tumblr") return { ...out, note: "See your statistics on Tumblr." };
  if (api === "tiktok") {
    const u = (await tk("/v2/user/info/?fields=follower_count,following_count,likes_count,video_count", token)).data?.user ?? {};
    Object.assign(out, { followers: num(u.follower_count), following: num(u.following_count), likes: num(u.likes_count), posts: num(u.video_count) });
    out.note = "TikTok gives totals only, not a breakdown by period.";
    return out;
  }
  if (api === "threads") {
    const metric = async (m: string) => insightTotal(await g("threads", "GET", `${row.external_id}/threads_insights`, { metric: m, since, until }, token));
    const [views, likes, replies, reposts, quotes, followers] = await Promise.all(["views", "likes", "replies", "reposts", "quotes", "followers_count"].map((m) => soft(metric(m))));
    Object.assign(out, { followers, views, likes, engagement: sum(likes, replies, reposts, quotes) });
    return out;
  }
  if (row.platform === "facebook") {
    const p = await g("meta", "GET", row.external_id, { fields: "followers_count,fan_count" }, token);
    out.followers = num(p.followers_count) ?? num(p.fan_count);
    const metric = async (m: string) => insightTotal(await g("meta", "GET", `${row.external_id}/insights`, { metric: m, period: "day", since, until }, token));
    const [reach, views, engagement] = await Promise.all(["page_impressions_unique", "page_views_total", "page_post_engagements"].map((m) => soft(metric(m))));
    Object.assign(out, { reach, views, engagement });
    return out;
  }
  // Instagram (Facebook login → graph.facebook.com; Instagram login → graph.instagram.com).
  const host = api === "ig_login" ? "ig_login" : "meta";
  const p = await g(host, "GET", row.external_id, { fields: "followers_count,follows_count,media_count" }, token);
  Object.assign(out, { followers: num(p.followers_count), following: num(p.follows_count), posts: num(p.media_count) });
  const metric = async (m: string) => insightTotal(await g(host, "GET", `${row.external_id}/insights`, { metric: m, period: "day", metric_type: "total_value", since, until }, token));
  const [reach, views, engagement] = await Promise.all(["reach", "views", "total_interactions"].map((m) => soft(metric(m))));
  Object.assign(out, { reach, views, engagement });
  if (reach === null && views === null) out.note = "Instagram shows period stats only for accounts with 100+ followers.";
  return out;
}

/** Stats for every account this connection has; one account failing does not hide the others. */
export async function accountStats(client: NativeClient, days: 7 | 28): Promise<AccountStats[]> {
  const rows = await client.listRows();
  return Promise.all(rows.map((row) => cached(`${client.tenant}:acct:${row.id}:${days}`, async () => {
    try {
      const { token } = await client.credentials(row.id);
      return await accountStatsFor(row, token, days);
    } catch (e) {
      await client.noteError(row.id, e);
      return { ...blank(row, days), error: (e as Error).message };
    }
  })));
}

// ── one published post ─────────────────────────────────────────────────────────────────────────────────────

export type PostStats = { likes: number | null; comments: number | null; shares: number | null; views: number | null; reach: number | null; saves: number | null; note: string | null; deleted: boolean };

/** The published post behind a ConstructHUB post: its submission, account row and a fresh token. */
async function published(client: NativeClient, submissionId: string) {
  const sub = await client.submissionRow(submissionId);
  if (!sub) throw new SocialError("This post wasn't published through ConstructHUB's own connection", 404);
  const { row, token } = await client.credentials(sub.account_id);
  return { sub, row, token, api: apiOf(row) };
}
/** Replying, hiding, deleting: only on a post the network has published (not queued, failed or already deleted). */
async function live(client: NativeClient, submissionId: string) {
  const p = await published(client, submissionId);
  if (p.sub.stage !== "published" || !p.sub.external_id) throw new SocialError(p.sub.stage === "deleted" ? "This post was deleted." : "This post isn't published yet.", 409);
  return p;
}

export async function postStats(client: NativeClient, submissionId: string): Promise<PostStats> {
  return cached(`${client.tenant}:post:${submissionId}`, async () => {
    const { sub, row, token, api } = await published(client, submissionId);
    const out: PostStats = { likes: null, comments: null, shares: null, views: null, reach: null, saves: null, note: null, deleted: sub.stage === "deleted" };
    if (out.deleted) return out;
    if (sub.stage !== "published") return { ...out, note: "Stats appear once the post is published." };
    if (api === "x") return { ...out, note: "See this post’s statistics on X." };
    if (api === "bluesky") return { ...out, note: "See this post’s statistics on Bluesky." };
    if (api === "pinterest") return { ...out, note: "See this pin’s statistics in Pinterest Analytics." };
    if (api === "reddit") return { ...out, note: "See this post’s statistics on Reddit." };
    if (api === "mastodon") return { ...out, note: "See this post’s statistics on your Mastodon server." };
    if (api === "tumblr") return { ...out, note: "See this post’s statistics on Tumblr." };
    const id = sub.external_id;
    if (api === "tiktok") {
      // Reading a video's numbers needs the video.list scope, which ConstructHUB does not ask for (docs/social-apps/tiktok.md §2.2).
      return { ...out, note: id ? "See this post's views and likes in the TikTok app." : "Private TikTok posts have no public stats." };
    }
    if (!id) return { ...out, note: "The network didn't return this post's ID, so its stats can't be read." };
    if (api === "threads") {
      const ins = await soft(g("threads", "GET", `${id}/insights`, { metric: "views,likes,replies,reposts,quotes" }, token));
      const m = (name: string) => insightTotal({ data: (ins?.data ?? []).filter((x: any) => x?.name === name) });
      return { ...out, views: m("views"), likes: m("likes"), comments: m("replies"), shares: sum(m("reposts"), m("quotes")) };
    }
    if (row.platform === "facebook") {
      const p = await g("meta", "GET", id, { fields: "reactions.summary(total_count),comments.summary(total_count),shares" }, token);
      const reach = await soft(g("meta", "GET", `${id}/insights`, { metric: "post_impressions_unique" }, token));
      return { ...out, likes: num(p.reactions?.summary?.total_count), comments: num(p.comments?.summary?.total_count), shares: num(p.shares?.count) ?? 0, reach: insightTotal(reach) };
    }
    const host = api === "ig_login" ? "ig_login" : "meta";
    const p = await g(host, "GET", id, { fields: "like_count,comments_count" }, token);
    const metric = async (m: string) => insightTotal(await g(host, "GET", `${id}/insights`, { metric: m }, token));
    const [reach, views, saves, shares] = await Promise.all(["reach", "views", "saved", "shares"].map((m) => soft(metric(m))));
    return { ...out, likes: num(p.like_count), comments: num(p.comments_count), reach, views, saves, shares };
  });
}

// ── comments ───────────────────────────────────────────────────────────────────────────────────────────────

export type Comment = { id: string; text: string; author: string; at: string | null; likes: number | null; hidden: boolean; mine: boolean; canHide: boolean; canDelete: boolean; replies: Comment[] };
const NO_TIKTOK_COMMENTS = "TikTok doesn't let apps read or answer comments; open the TikTok app for those.";

const cursor = (after?: string | null) => { if (after == null || after === "") return undefined; if (!/^[\w=+/.-]{1,400}$/.test(after)) throw new SocialError("Invalid page"); return after; };
const nextOf = (d: any): string | null => (d?.paging?.next && typeof d?.paging?.cursors?.after === "string" ? d.paging.cursors.after : null);

/** One page of a post's comments (25 at a time); `next` is the cursor for the following page, or null. */
export async function comments(client: NativeClient, submissionId: string, after?: string | null): Promise<{ comments: Comment[]; note: string | null; next: string | null }> {
  const page = cursor(after);
  return cached(`${client.tenant}:comments:${submissionId}${page ? `:${page}` : ""}`, async () => {
    const { sub, row, token, api } = await published(client, submissionId);
    if (api === "x") return { comments: [], note: "Manage replies on X.", next: null };
    if (api === "bluesky") return { comments: [], note: "Manage replies on Bluesky.", next: null };
    if (api === "pinterest") return { comments: [], note: "Manage comments on Pinterest.", next: null };
    if (api === "reddit") return { comments: [], note: "Manage replies on Reddit.", next: null };
    if (api === "mastodon") return { comments: [], note: "Manage replies on your Mastodon server.", next: null };
    if (api === "tumblr") return { comments: [], note: "Manage notes on Tumblr.", next: null };
    if (api === "tiktok") return { comments: [], note: NO_TIKTOK_COMMENTS, next: null };
    if (sub.stage !== "published" || !sub.external_id) return { comments: [], note: sub.stage === "deleted" ? "This post was deleted." : "Comments appear once the post is published.", next: null };
    const id = sub.external_id;
    if (api === "threads") {
      const d = await g("threads", "GET", `${id}/replies`, { fields: "id,text,username,timestamp,hide_status", reverse: true, ...(page ? { after: page } : {}) }, token);
      const me = row.name.replace(/^@/, "");
      return { note: null, next: nextOf(d), comments: (d.data ?? []).map((c: any): Comment => ({ id: String(c.id), text: String(c.text ?? ""), author: String(c.username ?? ""), at: c.timestamp ?? null, likes: null,
        hidden: c.hide_status === "HIDDEN", mine: c.username === me, canHide: c.username !== me, canDelete: c.username === me, replies: [] })) };
    }
    if (row.platform === "facebook") {
      const d = await g("meta", "GET", `${id}/comments`, { fields: "id,message,from{name,id},created_time,like_count,is_hidden,can_hide,can_remove,comments{id,message,from{name,id},created_time,is_hidden,can_hide,can_remove}", order: "reverse_chronological", limit: 25, ...(page ? { after: page } : {}) }, token);
      const map = (c: any): Comment => ({ id: String(c.id), text: String(c.message ?? ""), author: String(c.from?.name ?? "Facebook user"), at: c.created_time ?? null, likes: num(c.like_count),
        hidden: !!c.is_hidden, mine: c.from?.id === row.external_id, canHide: !!c.can_hide, canDelete: !!c.can_remove, replies: (c.comments?.data ?? []).map(map) });
      return { note: null, next: nextOf(d), comments: (d.data ?? []).map(map) };
    }
    const host = api === "ig_login" ? "ig_login" : "meta";
    const d = await g(host, "GET", `${id}/comments`, { fields: "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,hidden}", limit: 25, ...(page ? { after: page } : {}) }, token);
    const me = row.name.replace(/^@/, "");
    const map = (c: any): Comment => ({ id: String(c.id), text: String(c.text ?? ""), author: String(c.username ?? ""), at: c.timestamp ?? null, likes: num(c.like_count),
      hidden: !!c.hidden, mine: c.username === me, canHide: c.username !== me, canDelete: true, replies: (c.replies?.data ?? []).map(map) });
    return { note: null, next: nextOf(d), comments: (d.data ?? []).map(map) };
  });
}

const commentId = (id: string) => { if (!/^[\w.-]{1,120}$/.test(id)) throw new SocialError("Invalid comment"); return id; };

/**
 * The comment must be on this post (a reply to one of its comments counts) before anything is done to it: the post's
 * token can reach other objects too, and a stray id must never delete a post or someone else's comment.
 * Instagram and Threads say which post a comment is on; Facebook doesn't, so its post's comments (all levels) are read.
 */
async function commentOnPost(api: Api, row: any, postId: string, cid: string, token: string): Promise<void> {
  const wrong = () => new SocialError("That comment isn't on this post", 404);
  if (api === "threads") {
    const c = await g("threads", "GET", cid, { fields: "id,root_post" }, token).catch(() => null);
    if (String(c?.root_post?.id ?? "") !== postId) throw wrong();
    return;
  }
  if (row.platform !== "facebook") {
    const c = await g(api === "ig_login" ? "ig_login" : "meta", "GET", cid, { fields: "id,media{id}" }, token).catch(() => null);
    if (String(c?.media?.id ?? "") !== postId) throw wrong();
    return;
  }
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const d = await g("meta", "GET", `${postId}/comments`, { fields: "id", filter: "stream", limit: 100, ...(after ? { after } : {}) }, token);
    if ((d.data ?? []).some((c: any) => String(c?.id) === cid)) return;
    after = nextOf(d) ?? undefined;
    if (!after) break;
  }
  throw wrong();
}
const forgetPost = (tenant: string, submissionId: string) => { forget(`${tenant}:comments:${submissionId}`); forget(`${tenant}:post:${submissionId}`); };

/** Answer a comment as the business. */
export async function replyComment(client: NativeClient, submissionId: string, comment: string, message: string) {
  const text = message.trim();
  if (!text) throw new SocialError("Write a reply first");
  const { sub, row, token, api } = await live(client, submissionId);
  const cid = commentId(comment);
  if (api === "x") throw new SocialError("Manage replies on X.");
  if (api === "tiktok") throw new SocialError(NO_TIKTOK_COMMENTS);
  if (api === "reddit" || api === "mastodon" || api === "tumblr") throw new SocialError("Manage replies on the network itself.");
  await commentOnPost(api, row, String(sub.external_id ?? ""), cid, token);
  if (api === "threads") {
    if (text.length > 500) throw new SocialError("Threads replies are at most 500 characters");
    const c = await g("threads", "POST", `${row.external_id}/threads`, { media_type: "TEXT", text, reply_to_id: cid }, token);
    let pub: any = null;
    for (let i = 0; i < 4 && !pub; i++) {
      pub = await g("threads", "POST", `${row.external_id}/threads_publish`, { creation_id: c.id }, token).catch(async (e) => { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 1500)); return null; });
    }
    forgetPost(client.tenant, submissionId);
    return { id: String(pub.id) };
  }
  const d = row.platform === "facebook"
    ? await g("meta", "POST", `${cid}/comments`, { message: text }, token)
    : await g(api === "ig_login" ? "ig_login" : "meta", "POST", `${cid}/replies`, { message: text }, token);
  forgetPost(client.tenant, submissionId);
  return { id: String(d.id) };
}

/** Hide or show a comment (it stays for its author; nobody else sees it). */
export async function hideComment(client: NativeClient, submissionId: string, comment: string, hidden: boolean) {
  const { sub, row, token, api } = await live(client, submissionId);
  const cid = commentId(comment);
  if (api === "x") throw new SocialError("Manage replies on X.");
  if (api === "tiktok") throw new SocialError(NO_TIKTOK_COMMENTS);
  if (api === "reddit" || api === "mastodon" || api === "tumblr") throw new SocialError("Manage replies on the network itself.");
  await commentOnPost(api, row, String(sub.external_id ?? ""), cid, token);
  if (api === "threads") await g("threads", "POST", `${cid}/manage_reply`, { hide: hidden }, token);
  else if (row.platform === "facebook") await g("meta", "POST", cid, { is_hidden: hidden }, token);
  else await g(api === "ig_login" ? "ig_login" : "meta", "POST", cid, { hide: hidden }, token);
  forgetPost(client.tenant, submissionId);
  return { ok: true };
}

export async function deleteComment(client: NativeClient, submissionId: string, comment: string) {
  const { sub, row, token, api } = await live(client, submissionId);
  const cid = commentId(comment);
  if (api === "x") throw new SocialError("Manage replies on X.");
  if (api === "tiktok") throw new SocialError(NO_TIKTOK_COMMENTS);
  if (api === "reddit" || api === "mastodon" || api === "tumblr") throw new SocialError("Manage replies on the network itself.");
  await commentOnPost(api, row, String(sub.external_id ?? ""), cid, token);
  await g(api === "threads" ? "threads" : api === "ig_login" ? "ig_login" : "meta", "DELETE", cid, {}, token);
  forgetPost(client.tenant, submissionId);
  return { ok: true };
}

// ── deleting the published post ────────────────────────────────────────────────────────────────────────────

/** Delete it on the network; ConstructHUB keeps the record, marked deleted. Returns the network's name for the message. */
export async function deletePost(client: NativeClient, submissionId: string): Promise<{ network: string }> {
  const { sub, row, token, api } = await published(client, submissionId);
  const network = api === "x" ? "X" : api === "bluesky" ? "Bluesky" : api === "pinterest" ? "Pinterest" : api === "tiktok" ? "TikTok" : api === "threads" ? "Threads" : api === "reddit" ? "Reddit" : api === "mastodon" ? "Mastodon" : api === "tumblr" ? "Tumblr" : row.platform === "facebook" ? "Facebook" : "Instagram";
  if (sub.stage === "deleted") return { network };
  if (sub.stage !== "published") throw new SocialError("This post isn't published yet, so there's nothing to delete on the network.", 409);
  if (api === "tiktok") throw new SocialError("TikTok doesn't let apps delete videos; delete it in the TikTok app.");
  if (!sub.external_id) throw new SocialError(`The network didn't return this post's ID; delete it on ${network}.`);
  if (api === "x") await xDelete(token, sub.external_id);
  else if (api === "bluesky") { if (row.oauth_enc) await client.blueskyOauthDeletePost(row, sub.external_id); else await blueskyDelete(row.external_id, token, sub.external_id); }
  else if (api === "pinterest") await pinterestDelete(token, sub.external_id);
  else if (api === "reddit") await redditDelete(token, sub.external_id);
  else if (api === "mastodon") await client.mastodonDeletePost(row, sub.external_id);
  else if (api === "tumblr") await tumblrDelete(token, sub.external_id);
  else await g(api === "threads" ? "threads" : api === "ig_login" ? "ig_login" : "meta", "DELETE", sub.external_id, {}, token);
  await pool.query("UPDATE social_native_submissions SET stage='deleted',updated_at=now() WHERE tenant=$1 AND id=$2", [client.tenant, sub.id]);
  forgetPost(client.tenant, submissionId); forget(`${client.tenant}:acct:${row.id}`);
  return { network };
}
