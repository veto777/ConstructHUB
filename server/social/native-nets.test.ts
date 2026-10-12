/** ConstructHUB Direct — Instagram login, Threads, TikTok (server/social/native-nets.ts): plans, sign-in, refresh, and the
 * full publish path through NativeClient against fake networks and the development database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { creatorInfoFrom, netAuthUrl, netConfigured, netDeps, netExchange, netPublish, needsRefresh, netScopes, threadsPlan, tiktokCreatorInfo, tiktokPlan } from "./native-nets";
import { NativeClient, ensureNativeSchema, nativeNetConnect, nativeNetworks, removeNativeAccounts } from "./native";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = {
  SOCIAL_INSTAGRAM_APP_ID: "3302777856582054", SOCIAL_INSTAGRAM_APP_SECRET: "ig-secret-0123456789abcdef",
  SOCIAL_THREADS_APP_ID: "1094264793301989", SOCIAL_THREADS_APP_SECRET: "th-secret-0123456789abcdef",
  SOCIAL_TIKTOK_CLIENT_KEY: "awtiktokkey", SOCIAL_TIKTOK_CLIENT_SECRET: "tt-secret-0123456789abcdef",
} as any;
const realHttp = netDeps.http;
afterEach(() => { netDeps.http = realHttp; netDeps.env = () => process.env; netDeps.now = () => Date.now(); });
function fake(answer: (url: URL, body: any, init: any) => unknown) {
  const calls: { url: URL; body: any; init: any }[] = [];
  netDeps.env = () => ENV;
  netDeps.http = (async (u: any, init: any) => {
    const url = new URL(String(u));
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? JSON.parse(raw) : undefined;
    calls.push({ url, body, init });
    const r = answer(url, body, init);
    return r instanceof Response ? r : ok(r);
  }) as any;
  return calls;
}

describe("which of these networks are switched on", () => {
  it("each needs its own app id and secret", () => {
    expect(netConfigured("tiktok", {} as any)).toBe(false);
    expect(nativeNetworks({ ...ENV } as any)).toEqual(["instagram_direct", "threads", "tiktok"]);
  });
});

describe("what each network receives", () => {
  it("Threads: text, one photo or video, carousels; 500 characters", () => {
    expect(threadsPlan("Hi", [])).toEqual({ kind: "text" });
    expect(threadsPlan("Hi", ["https://x.us/a.mp4"])).toEqual({ kind: "single", url: "https://x.us/a.mp4", video: true });
    expect(threadsPlan("Hi", ["https://x.us/a.jpg", "https://x.us/b.jpg"]).kind).toBe("carousel");
    expect(() => threadsPlan("x".repeat(501), [])).toThrow(/500/);
  });
  it("TikTok: one video or up to 35 photos, with the audience the customer chose", () => {
    const v = tiktokPlan("New roof", ["https://constructhub.us/api/files/social/t/media.mp4"], { privacyLevel: "MUTUAL_FOLLOW_FRIENDS" });
    expect(v.kind).toBe("video");
    expect(v.body.post_info.privacy_level).toBe("MUTUAL_FOLLOW_FRIENDS");
    expect(v.body.source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://constructhub.us/api/files/social/t/media.mp4" });
    const p = tiktokPlan("Before and after\nDone in two days", ["https://x.us/a.jpg", "https://x.us/b.jpg"], { privacyLevel: "PUBLIC_TO_EVERYONE", disabledComments: false });
    expect(p.kind).toBe("photo");
    expect(p.body.post_info).toEqual({ title: "Before and after", description: "Done in two days", privacy_level: "PUBLIC_TO_EVERYONE", disable_comment: false, brand_content_toggle: false, brand_organic_toggle: false });
    expect(() => tiktokPlan("x", [], { privacyLevel: "SELF_ONLY" })).toThrow(/video or photos/);
    expect(() => tiktokPlan("x", ["https://x.us/a.mp4", "https://x.us/b.jpg"], { privacyLevel: "SELF_ONLY" })).toThrow(/one video/);
  });
  it("TikTok: no audience chosen, or one the creator no longer offers, stops the post — no fallback", () => {
    const vid = ["https://x.us/a.mp4"];
    expect(() => tiktokPlan("x", vid, {})).toThrow(/Choose who can view this TikTok post/);
    expect(() => tiktokPlan("x", vid, { privacyLevel: "" })).toThrow(/Choose who can view/);
    expect(() => tiktokPlan("x", vid, { privacyLevel: "EVERYONE" })).toThrow(/options changed/);
    const creator = { privacyLevelOptions: ["SELF_ONLY", "FOLLOWER_OF_CREATOR"], commentDisabled: false, duetDisabled: false, stitchDisabled: false };
    expect(() => tiktokPlan("x", vid, { privacyLevel: "PUBLIC_TO_EVERYONE" }, creator)).toThrow(/again — your TikTok options changed/);
    expect(tiktokPlan("x", vid, { privacyLevel: "FOLLOWER_OF_CREATOR" }, creator).body.post_info.privacy_level).toBe("FOLLOWER_OF_CREATOR");
  });
  it("TikTok: branded content can't be private", () => {
    expect(() => tiktokPlan("x", ["https://x.us/a.mp4"], { privacyLevel: "SELF_ONLY", isBrandedContent: true })).toThrow(/cannot be set to private/);
    const ok = tiktokPlan("x", ["https://x.us/a.mp4"], { privacyLevel: "PUBLIC_TO_EVERYONE", isBrandedContent: true, isYourBrand: true });
    expect(ok.body.post_info).toMatchObject({ brand_content_toggle: true, brand_organic_toggle: true });
    expect(tiktokPlan("x", ["https://x.us/a.mp4"], { privacyLevel: "SELF_ONLY", isYourBrand: true }).body.post_info.brand_organic_toggle).toBe(true);
  });
  it("TikTok: comments / Duet / Stitch only when allowed, and never when the creator switched them off", () => {
    const vid = ["https://x.us/a.mp4"];
    // Unknown = not allowed (both field spellings: native disableX, Blotato's disabledX).
    expect(tiktokPlan("x", vid, { privacyLevel: "SELF_ONLY" }).body.post_info).toMatchObject({ disable_comment: true, disable_duet: true, disable_stitch: true });
    expect(tiktokPlan("x", vid, { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: false }).body.post_info)
      .toMatchObject({ disable_comment: false, disable_duet: true, disable_stitch: false });
    expect(tiktokPlan("x", vid, { privacyLevel: "SELF_ONLY", disabledComments: false, disabledDuet: false, disabledStitch: true }).body.post_info)
      .toMatchObject({ disable_comment: false, disable_duet: false, disable_stitch: true });
    const creator = { privacyLevelOptions: ["SELF_ONLY"], commentDisabled: true, duetDisabled: true, stitchDisabled: false };
    expect(tiktokPlan("x", vid, { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: false, disableStitch: false }, creator).body.post_info)
      .toMatchObject({ disable_comment: true, disable_duet: true, disable_stitch: false });
  });
  it("TikTok: creator info for the post panel, and 'can't post now' as an answer, not an error", async () => {
    expect(creatorInfoFrom({ creator_nickname: "Summit", creator_username: "summitroofing", creator_avatar_url: "https://p.tiktokcdn.com/a.jpg",
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY", "SOMETHING_NEW"], comment_disabled: true, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 300 }))
      .toEqual({ nickname: "Summit", username: "summitroofing", avatarUrl: "https://p.tiktokcdn.com/a.jpg", privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
        commentDisabled: true, duetDisabled: false, stitchDisabled: true, maxVideoPostDurationSec: 300, canPost: true });
    fake(() => ok({ data: {}, error: { code: "spam_risk_too_many_posts", message: "too many" } }, 403));
    expect(await tiktokCreatorInfo("tok")).toMatchObject({ canPost: false, message: "This TikTok account can't post right now. Try again later." });
    fake(() => ok({ data: {}, error: { code: "access_token_invalid" } }, 401));
    await expect(tiktokCreatorInfo("tok")).rejects.toMatchObject({ reconnect: true });
  });
  it("TikTok publish: re-asks creator info, sends nothing when the chosen audience is gone", async () => {
    const calls = fake((u) => u.pathname === "/v2/post/publish/creator_info/query/" ? { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } } : { data: { publish_id: "p1" }, error: { code: "ok" } });
    await expect(netPublish("tiktok", "open1", "tok", "x", ["https://x.us/a.mp4"], { privacyLevel: "PUBLIC_TO_EVERYONE" })).rejects.toThrow(/options changed/);
    expect(calls.some((c) => c.url.pathname.endsWith("/init/"))).toBe(false);
    await expect(netPublish("tiktok", "open1", "tok", "x", ["https://x.us/a.mp4"], {})).rejects.toThrow(/Choose who can view/);
    const p = await netPublish("tiktok", "open1", "tok", "x", ["https://x.us/a.mp4"], { privacyLevel: "SELF_ONLY", disabledComments: false });
    expect(p).toMatchObject({ stage: "tt_publish", container: "p1" });
    expect(calls.find((c) => c.url.pathname === "/v2/post/publish/video/init/")!.body.post_info).toMatchObject({ privacy_level: "SELF_ONLY", disable_comment: false, disable_duet: true });
  });
});

describe("signing in", () => {
  it("sends each network to its own sign-in with our redirect and the scopes we use", () => {
    netDeps.env = () => ENV;
    const tt = new URL(netAuthUrl("tiktok", "st"));
    expect(tt.host).toBe("www.tiktok.com");
    expect(tt.searchParams.get("client_key")).toBe("awtiktokkey");
    expect(tt.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/tiktok\/callback$/);
    expect(tt.searchParams.get("scope")).toBe("user.info.basic,user.info.profile,user.info.stats,video.publish");
    expect(netScopes("tiktok")).not.toContain("video.list");
    expect(new URL(netAuthUrl("ig_login", "st")).searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/instagram\/callback$/);
    expect(new URL(netAuthUrl("threads", "st")).host).toBe("threads.net");
  });
  it("refuses a TikTok sign-in that switched off posting", async () => {
    fake((u) => u.pathname.endsWith("/oauth/token/") ? { access_token: "a", refresh_token: "r", open_id: "o1", scope: "user.info.basic", expires_in: 86400 } : {});
    await expect(netExchange("tiktok", "code")).rejects.toThrow(/didn't allow posting/);
  });
  it("refreshes TikTok within 10 minutes of expiry and the others within 7 days", () => {
    const now = Date.now(); netDeps.now = () => now;
    expect(needsRefresh("tiktok", new Date(now + 5 * 60_000))).toBe(true);
    expect(needsRefresh("tiktok", new Date(now + 60 * 60_000))).toBe(false);
    expect(needsRefresh("threads", new Date(now + 3 * 86_400_000))).toBe(true);
    expect(needsRefresh("ig_login", null)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL || !process.env.GBP_TOKEN_KEY)("publishing through NativeClient (development database)", () => {
  const tenant = "chu999998b0";
  // Disconnecting revokes TikTok tokens: always against the fake network here.
  beforeAll(async () => { await ensureNativeSchema(); fake(() => ({})); await removeNativeAccounts(tenant); netDeps.http = realHttp; await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]); });
  afterAll(async () => { fake(() => ({})); await removeNativeAccounts(tenant); netDeps.http = realHttp; await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]); });
  const post = (accountId: string, text: string, mediaUrls: string[] = [], target: Record<string, unknown> = {}) => ({ post: { accountId, content: { text, mediaUrls, platform: "x" }, target } });

  it("connects Threads and publishes a text post once its container is ready", async () => {
    let ready = false;
    fake((u) => {
      if (u.host === "graph.threads.net" && u.pathname === "/oauth/access_token") return { access_token: "short" };
      if (u.pathname === "/access_token") return { access_token: "LONG", expires_in: 5184000 };
      if (u.pathname === "/v1.0/me") return { id: "th1", username: "constructhubapp" };
      if (u.pathname === "/v1.0/th1/threads") return { id: "C9" };
      if (u.pathname === "/v1.0/C9") return { status: ready ? "FINISHED" : "IN_PROGRESS" };
      if (u.pathname === "/v1.0/th1/threads_publish") return { id: "P9" };
      if (u.pathname === "/v1.0/P9") return { permalink: "https://www.threads.net/@constructhubapp/post/abc" };
      throw new Error(`unexpected ${u}`);
    });
    expect(await nativeNetConnect("threads", tenant, "code")).toBe("threads");
    const c = new NativeClient(tenant);
    const th = (await c.accounts()).find((a) => a.platform === "threads")!;
    expect(th.name).toBe("@constructhubapp");
    const { submissionId } = await c.submit(post(th.id, "Roof done before the rain") as any, "th-1");
    expect((await c.status(submissionId)).state).toBe("submitted");
    ready = true;
    expect(await c.status(submissionId)).toEqual({ state: "published", publicUrl: "https://www.threads.net/@constructhubapp/post/abc", error: null });
  });

  it("connects TikTok, refreshes the daily token, posts a private video and reads it back", async () => {
    let refreshed = 0;
    const calls = fake((u, body, init) => {
      if (u.pathname === "/v2/oauth/token/" && body.grant_type === "authorization_code") return { access_token: "A1", refresh_token: "R1", open_id: "open1", scope: "user.info.basic,video.publish", expires_in: 60 };
      if (u.pathname === "/v2/oauth/token/" && body.grant_type === "refresh_token") { refreshed++; return { access_token: "A2", refresh_token: "R2", expires_in: 86400 }; }
      if (u.pathname === "/v2/user/info/") return { data: { user: { open_id: "open1", username: "summitroofing", display_name: "Summit" } }, error: { code: "ok" } };
      if (u.pathname === "/v2/post/publish/creator_info/query/") return { data: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], creator_username: "summitroofing" }, error: { code: "ok" } };
      if (u.pathname === "/v2/post/publish/video/init/") { expect(init.headers.Authorization).toBe("Bearer A2"); return { data: { publish_id: "v_pub_1" }, error: { code: "ok" } }; }
      if (u.pathname === "/v2/post/publish/status/fetch/") return { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } };
      throw new Error(`unexpected ${u}`);
    });
    expect(await nativeNetConnect("tiktok", tenant, "code")).toBe("tiktok");
    const c = new NativeClient(tenant);
    const tt = (await c.accounts()).find((a) => a.platform === "tiktok")!;
    const { submissionId } = await c.submit(post(tt.id, "Tear-off day", ["https://constructhub.us/api/files/social/t/media.mp4"], { privacyLevel: "SELF_ONLY" }) as any, "tt-1");
    expect(refreshed).toBe(1);   // the 60-second token was refreshed before posting
    const init = calls.find((x) => x.url.pathname === "/v2/post/publish/video/init/")!;
    expect(init.body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(await c.status(submissionId)).toEqual({ state: "published", publicUrl: null, error: null });
  });

  it("the TikTok post panel's creator info comes fresh from TikTok for this connection's account only", async () => {
    let asked = 0;
    fake((u) => {
      if (u.pathname === "/v2/post/publish/creator_info/query/") { asked++; return { data: { creator_nickname: "Summit", creator_username: "summitroofing", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } }; }
      if (u.pathname === "/v2/oauth/token/") return { access_token: "A3", refresh_token: "R3", expires_in: 86400 };
      throw new Error(`unexpected ${u}`);
    });
    const c = new NativeClient(tenant);
    const tt = (await c.accounts()).find((a) => a.platform === "tiktok")!;
    expect(await c.tiktokCreatorInfo(tt.id)).toMatchObject({ username: "summitroofing", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600, canPost: true });
    await c.tiktokCreatorInfo(tt.id);
    expect(asked).toBe(2);   // never cached
    await expect(new NativeClient("chu999995b0").tiktokCreatorInfo(tt.id)).rejects.toThrow(/no longer connected/);
  });

  it("an Instagram-login account publishes a photo through graph.instagram.com", async () => {
    fake((u) => {
      if (u.host === "api.instagram.com") return { access_token: "short", user_id: 1 };
      if (u.pathname === "/access_token") return { access_token: "IGLONG", expires_in: 5184000 };
      if (u.pathname === "/v25.0/me") return { id: "app1", user_id: "1784100", username: "alpine" };
      if (u.pathname === "/v25.0/1784100/media") return { id: "IC1" };
      if (u.pathname === "/v25.0/IC1") return { status_code: "FINISHED" };
      if (u.pathname === "/v25.0/1784100/media_publish") return { id: "IM1" };
      if (u.pathname === "/v25.0/IM1") return { permalink: "https://www.instagram.com/p/xyz/" };
      throw new Error(`unexpected ${u}`);
    });
    expect(await nativeNetConnect("ig_login", tenant, "code")).toBe("instagram_direct");
    const c = new NativeClient(tenant);
    const ig = (await c.accounts()).find((a) => a.platform === "instagram")!;
    const { submissionId } = await c.submit(post(ig.id, "Fresh gutters", ["https://constructhub.us/api/files/social/t/media.jpg"]) as any, "ig-1");
    expect(await c.status(submissionId)).toEqual({ state: "published", publicUrl: "https://www.instagram.com/p/xyz/", error: null });
  });
});
