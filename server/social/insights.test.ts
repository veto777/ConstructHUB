/** ConstructHUB Direct — stats, comments and deleting (server/social/insights.ts) against fake networks and the development database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { NativeClient, ensureNativeSchema, nativeDeps, nativeFinalize, nativeNetConnect, removeNativeAccounts, savePending } from "./native";
import { netDeps } from "./native-nets";
import { accountStats, clearInsightsCache, comments, deleteComment, deletePost, hideComment, postStats, replyComment } from "./insights";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const realHttp = nativeDeps.http, realNet = netDeps.http;
type Call = { host: string; path: string; params: URLSearchParams; method: string };
function fake(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  const http = (async (url: any, init: any) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const params = method === "POST" && init.body instanceof URLSearchParams ? init.body : u.searchParams;
    const c = { host: u.host, path: u.pathname.replace(/^\/v\d+\.\d+\//, "/"), params, method };
    calls.push(c);
    const r = answer(c);
    return r instanceof Response ? r : ok(r);
  }) as any;
  nativeDeps.http = http; netDeps.http = http;
  return calls;
}
afterEach(() => { nativeDeps.http = realHttp; netDeps.http = realNet; netDeps.env = () => process.env; clearInsightsCache(); });

describe.skipIf(!process.env.DATABASE_URL || !process.env.GBP_TOKEN_KEY)("stats, comments and deleting (development database)", () => {
  const tenant = "chu999997b0";
  const c = new NativeClient(tenant);
  const acct: Record<string, string> = {};
  const sub = async (platform: string, external: string | null, stage = "published") => {
    const id = `nat_test_${platform}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query("INSERT INTO social_native_submissions(id,idem_key,tenant,account_id,platform,stage,external_id) VALUES($1,$1,$2,$3,$4,$5,$6)", [id, tenant, acct[platform], platform, stage, external]);
    return id;
  };
  beforeAll(async () => {
    await ensureNativeSchema();
    await removeNativeAccounts(tenant);
    await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]);
    const fb = await savePending(tenant, 999997, "facebook", [{ id: "111", name: "Summit Roofing", token: "PAGE", picture: null }] as any);
    await nativeFinalize(fb, tenant, 999997, ["111"]);
    const ig = await savePending(tenant, 999997, "instagram", [{ id: "111", name: "Summit Roofing", token: "PAGE", picture: null, ig: { id: "1784", username: "summitroofing", picture: null } }] as any);
    await nativeFinalize(ig, tenant, 999997, ["1784"]);
    netDeps.env = () => ({ SOCIAL_THREADS_APP_ID: "1", SOCIAL_THREADS_APP_SECRET: "th-secret-0123456789", SOCIAL_TIKTOK_CLIENT_KEY: "k", SOCIAL_TIKTOK_CLIENT_SECRET: "tt-secret-0123456789" } as any);
    fake(({ host, path, params }) => {
      if (host === "graph.threads.net" && path === "/oauth/access_token") return { access_token: "short" };
      if (path === "/access_token") return { access_token: "THLONG", expires_in: 5184000 };
      if (path === "/me") return { id: "th1", username: "summitroofing" };
      if (path === "/v2/oauth/token/") return { access_token: "TT", refresh_token: "R", open_id: "o1", scope: "user.info.basic,video.publish", expires_in: 86400 };
      if (path === "/v2/user/info/") return { data: { user: { open_id: "o1", username: "summit", display_name: "Summit" } }, error: { code: "ok" } };
      throw new Error(`unexpected ${host}${path} ${params}`);
    });
    await nativeNetConnect("threads", tenant, "code");
    await nativeNetConnect("tiktok", tenant, "code");
    for (const a of await c.accounts()) acct[a.platform] = a.id;
  });
  // Disconnecting revokes the TikTok token at TikTok: answered by the fake, never the real network.
  afterAll(async () => { fake(() => ({})); await removeNativeAccounts(tenant); nativeDeps.http = realHttp; netDeps.http = realNet; await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]); });

  it("reads each account's followers and period stats; one failing does not hide the others", async () => {
    const calls = fake(({ host, path, params }) => {
      if (host === "graph.facebook.com" && path === "/111") return { followers_count: 1520 };
      if (host === "graph.facebook.com" && path === "/111/insights") return { data: [{ name: params.get("metric"), values: [{ value: 10 }, { value: 15 }] }] };
      if (host === "graph.facebook.com" && path === "/1784") return { followers_count: 80, follows_count: 12, media_count: 30 };
      if (host === "graph.facebook.com" && path === "/1784/insights") return ok({ error: { code: 100, message: "Not enough followers" } }, 400);
      if (host === "graph.threads.net" && path === "/th1/threads_insights") return params.get("metric") === "followers_count" ? { data: [{ total_value: { value: 44 } }] } : { data: [{ total_value: { value: 3 } }] };
      if (host === "open.tiktokapis.com") return ok({ error: { code: "access_token_invalid" } }, 401);
      throw new Error(`unexpected ${host}${path}`);
    });
    const stats = await accountStats(c, 28);
    const by = Object.fromEntries(stats.map((s) => [s.platform, s]));
    expect(by.facebook).toMatchObject({ followers: 1520, reach: 25, views: 25, engagement: 25, error: null });
    expect(by.instagram).toMatchObject({ followers: 80, following: 12, posts: 30, reach: null, note: expect.stringMatching(/100\+ followers/) });
    expect(by.threads).toMatchObject({ followers: 44, views: 3, likes: 3, engagement: 12 });
    expect(by.tiktok.error).toBeTruthy();
    const { rows: [tt] } = await pool.query("SELECT needs_reconnect FROM social_native_accounts WHERE id=$1", [acct.tiktok]);
    expect(tt.needs_reconnect).toBe(true);   // an expired sign-in asks for reconnecting, as publishing does
    await pool.query("UPDATE social_native_accounts SET needs_reconnect=false,last_error=null WHERE id=$1", [acct.tiktok]);
    // cached for 10 minutes: asking again makes no calls
    const n = calls.length;
    await accountStats(c, 28);
    expect(calls.length).toBe(n);
  });

  it("a Facebook post: reactions, comments, shares, reach", async () => {
    const id = await sub("facebook", "111_222");
    fake(({ path }) => {
      if (path === "/111_222") return { reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } };
      if (path === "/111_222/insights") return { data: [{ values: [{ value: 340 }] }] };
      throw new Error(`unexpected ${path}`);
    });
    expect(await postStats(c, id)).toMatchObject({ likes: 9, comments: 2, shares: 1, reach: 340, deleted: false });
  });

  it("Facebook comments: read with replies, reply, hide, delete — and the list is re-read after each change", async () => {
    const id = await sub("facebook", "111_333");
    let listed = 0;
    const calls = fake(({ path, method, params }) => {
      if (path === "/111_333/comments" && method === "GET" && params.get("filter") === "stream") return { data: [{ id: "c1" }, { id: "c2" }] };
      if (path === "/111_333/comments" && method === "GET") { listed++; return { data: [{ id: "c1", message: "Great work!", from: { name: "Ann", id: "9" }, created_time: "2026-10-11T12:00:00+0000", like_count: 1, is_hidden: false, can_hide: true, can_remove: true,
        comments: { data: [{ id: "c2", message: "Thanks Ann", from: { name: "Summit Roofing", id: "111" }, can_hide: false, can_remove: true }] } }] }; }
      if (path === "/c1/comments" && method === "POST") return { id: "c3" };
      if (path === "/c1" && method === "POST") return { success: true };
      if (path === "/c2" && method === "DELETE") return { success: true };
      throw new Error(`unexpected ${method} ${path}`);
    });
    const r = await comments(c, id);
    expect(r.comments[0]).toMatchObject({ id: "c1", author: "Ann", text: "Great work!", canHide: true, mine: false });
    expect(r.comments[0].replies[0]).toMatchObject({ id: "c2", mine: true });
    expect(await replyComment(c, id, "c1", "  Thank you!  ")).toEqual({ id: "c3" });
    expect(calls.find((x) => x.path === "/c1/comments")!.params.get("message")).toBe("Thank you!");
    await hideComment(c, id, "c1", true);
    expect(calls.find((x) => x.path === "/c1" && x.method === "POST")!.params.get("is_hidden")).toBe("true");
    await deleteComment(c, id, "c2");
    await comments(c, id);
    expect(listed).toBe(2);
    await expect(replyComment(c, id, "../x", "hi")).rejects.toThrow(/Invalid comment/);
    // An id that is not one of this post's comments (another post, say) is refused before anything is sent.
    await expect(deleteComment(c, id, "111_999")).rejects.toThrow(/isn't on this post/);
    expect(calls.some((x) => x.path === "/111_999")).toBe(false);
  });

  it("Instagram: post stats, comment replies go to /replies, hiding uses hide", async () => {
    const id = await sub("instagram", "IM1");
    const calls = fake(({ path, params, method }) => {
      if (path === "/IM1") return { like_count: 14, comments_count: 3 };
      if (path === "/IM1/insights") return { data: [{ values: [{ value: ({ reach: 200, views: 450, saved: 4, shares: 2 } as any)[params.get("metric")!] }] }] };
      if (path === "/IM1/comments" && params.get("after") === "CUR2") return { data: [{ id: "k5", text: "Later", username: "dee", hidden: false, replies: { data: [] } }] };
      if (path === "/IM1/comments") return { data: [{ id: "k1", text: "Nice", username: "bob", timestamp: "2026-10-11T12:00:00+0000", hidden: false, replies: { data: [] } }], paging: { cursors: { after: "CUR2" }, next: "https://graph/next" } };
      if (path === "/k1" && method === "GET") return { id: "k1", media: { id: "IM1" } };
      if (path === "/k9" && method === "GET") return { id: "k9", media: { id: "IM2" } };
      if (path === "/k1/replies" && method === "POST") return { id: "k2" };
      if (path === "/k1" && method === "POST") return { success: true };
      throw new Error(`unexpected ${method} ${path}`);
    });
    expect(await postStats(c, id)).toMatchObject({ likes: 14, comments: 3, reach: 200, views: 450, saves: 4, shares: 2 });
    const page1 = await comments(c, id);
    expect(page1.comments[0]).toMatchObject({ author: "bob", canHide: true });
    expect(page1.next).toBe("CUR2");
    expect((await comments(c, id, "CUR2")).comments[0]).toMatchObject({ id: "k5" });
    await expect(hideComment(c, id, "k9", true)).rejects.toThrow(/isn't on this post/);
    expect(await replyComment(c, id, "k1", "Thanks Bob")).toEqual({ id: "k2" });
    await hideComment(c, id, "k1", true);
    expect(calls.find((x) => x.path === "/k1" && x.method === "POST")!.params.get("hide")).toBe("true");
  });

  it("Threads: replies read, answered (create then publish) and hidden", async () => {
    const id = await sub("threads", "T1");
    const calls = fake(({ path, method }) => {
      if (path === "/T1/insights") return { data: [{ name: "views", values: [{ value: 90 }] }, { name: "likes", values: [{ value: 5 }] }, { name: "replies", values: [{ value: 1 }] }, { name: "reposts", values: [{ value: 1 }] }, { name: "quotes", values: [{ value: 0 }] }] };
      if (path === "/T1/replies") return { data: [{ id: "r1", text: "When can you come by?", username: "carl", hide_status: "NOT_HUSHED" }] };
      if (path === "/th1/threads" && method === "POST") return { id: "CONT" };
      if (path === "/th1/threads_publish" && method === "POST") return { id: "R2" };
      if (path === "/r1/manage_reply") return { success: true };
      if (path === "/r1" && method === "GET") return { id: "r1", root_post: { id: "T1" } };
      throw new Error(`unexpected ${method} ${path}`);
    });
    expect(await postStats(c, id)).toMatchObject({ views: 90, likes: 5, comments: 1, shares: 1 });
    expect((await comments(c, id)).comments[0]).toMatchObject({ id: "r1", canHide: true, canDelete: false });
    expect(await replyComment(c, id, "r1", "Tomorrow at 9")).toEqual({ id: "R2" });
    expect(calls.find((x) => x.path === "/th1/threads")!.params.get("reply_to_id")).toBe("r1");
    await hideComment(c, id, "r1", true);
  });

  it("TikTok: no per-post stats (no video.list scope), no comments and no deleting", async () => {
    const id = await sub("tiktok", "7300");
    fake(({ path }) => { throw new Error(`unexpected ${path}`); });   // nothing is asked of TikTok
    expect(await postStats(c, id)).toMatchObject({ likes: null, views: null, note: expect.stringMatching(/TikTok app/) });
    expect((await comments(c, id)).note).toMatch(/TikTok doesn't let apps/);
    await expect(deletePost(c, id)).rejects.toThrow(/delete it in the TikTok app/);
    await expect(replyComment(c, id, "x1", "hi")).rejects.toThrow(/TikTok/);
  });

  it("deleting a published post removes it on the network and marks it deleted, once", async () => {
    const id = await sub("facebook", "111_444");
    const calls = fake(({ path, method }) => {
      if (path === "/111_444" && method === "DELETE") return { success: true };
      throw new Error(`unexpected ${method} ${path}`);
    });
    expect(await deletePost(c, id)).toEqual({ network: "Facebook" });
    expect(await deletePost(c, id)).toEqual({ network: "Facebook" });   // already deleted: no second call
    expect(calls.filter((x) => x.method === "DELETE")).toHaveLength(1);
    expect((await postStats(c, id)).deleted).toBe(true);
    expect(await c.status(id)).toEqual({ state: "published", publicUrl: null, error: null });
  });

  it("refuses a submission of another connection", async () => {
    await expect(postStats(new NativeClient("chu999996b0"), await sub("facebook", "111_555"))).rejects.toThrow(/wasn't published/);
  });
});
