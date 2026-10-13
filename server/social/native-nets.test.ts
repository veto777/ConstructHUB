/** ConstructHUB Direct — Instagram login, Threads, TikTok (server/social/native-nets.ts): plans, sign-in, refresh, and the
 * full publish path through NativeClient against fake networks and the development database. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../db";
import { decryptToken } from "../gbp/token-crypto";
import { deletePost } from "./insights";
import { creatorInfoFrom, netAuthUrl, netConfigured, netDeps, netExchange, netPublish, netRefresh, netRedirect, xDelete, needsRefresh, netScopes, threadsPlan, tiktokCreatorInfo, tiktokPlan, blueskyLogin, blueskyPlan, blueskyLength, blueskyFacets, blueskyImage, blueskyDelete, netRead } from "./native-nets";
import { NativeClient, ensureNativeSchema, nativeNetConnect, nativeNetworks, newOAuthState, oauthStateMatches, removeNativeAccounts } from "./native";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { recordFailure } from "../ops/issues";
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));
const realSleep = netDeps.sleep;
const realMediaHttp = netDeps.mediaHttp;
afterEach(() => { netDeps.sleep = realSleep; netDeps.mediaHttp = realMediaHttp; vi.clearAllMocks(); });

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
    // Unknown = not allowed (both field spellings: native disableX, the stored payload's disabledX).
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

  it("X persists rotated tokens, published status and reply warnings, then deletes through v2", async () => {
    let refreshing = false;
    const calls = fake((u, body) => {
      if (u.pathname === "/2/oauth2/token") {
        refreshing = body.grant_type === "refresh_token";
        return { access_token: refreshing ? "rotated-access" : "first-access", refresh_token: refreshing ? "rotated-refresh" : "first-refresh", expires_in: refreshing ? 7200 : 1, scope: netScopes("x").join(" ") };
      }
      if (u.pathname === "/2/users/me") return { data: { id: "xuser", username: "roofer" } };
      if (u.pathname === "/2/tweets/xpost") return { data: { deleted: true } };
      if (u.pathname === "/2/tweets") return body.reply ? ok({ detail: "credits" }, 402) : { data: { id: "xpost" } };
      throw new Error("Unexpected network call");
    });
    netDeps.env = () => XENV;
    expect(await nativeNetConnect("x", tenant, "code", "verifier")).toBe("x");
    const c = new NativeClient(tenant);
    const x = (await c.accounts()).find(a => a.platform === "x")!;
    const payload = post(x.id, "Roof example.com");
    const sent = await c.submit(payload, "x-idem");
    expect(refreshing).toBe(true);
    const { rows: [stored] } = await pool.query("SELECT refresh_enc FROM social_native_accounts WHERE tenant=$1 AND id=$2", [tenant, x.id]);
    expect(decryptToken(stored.refresh_enc)).toBe("rotated-refresh");
    expect(stored.refresh_enc).not.toContain("rotated-refresh");
    expect(await c.status(sent.submissionId)).toMatchObject({ state: "published", publicUrl: "https://x.com/roofer/status/xpost", error: expect.stringContaining("Link reply failed") });
    const count = calls.length;
    expect(await c.submit(payload, "x-idem")).toEqual(sent);
    expect(calls).toHaveLength(count);
    expect((await new NativeClient("chu999995b0").status(sent.submissionId)).state).toBe("failed");
    expect(await deletePost(c, sent.submissionId)).toEqual({ network: "X" });
    expect((await c.status(sent.submissionId)).publicUrl).toBeNull();
  });

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

const XENV = { SOCIAL_X_CLIENT_ID: "test-client", SOCIAL_X_CLIENT_SECRET: "test-secret" };
describe("X adapter", () => {
  it("requires both keys, stores PKCE with one-use state and exposes only the S256 challenge", () => {
    expect(netConfigured("x", {})).toBe(false);
    expect(netConfigured("x", { SOCIAL_X_CLIENT_ID: "test-client" })).toBe(false);
    expect(nativeNetworks(XENV)).toEqual(["x"]);
    netDeps.env = () => XENV;
    const pending = newOAuthState(7, 3, "x");
    expect(pending.codeVerifier).toMatch(/^[\w-]{43}$/);
    expect(oauthStateMatches(pending, 7, pending.state)).toBe(true);
    expect(oauthStateMatches(pending, 8, pending.state)).toBe(false);
    const u = new URL(netAuthUrl("x", pending.state, pending.codeVerifier));
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(u.searchParams.get("code_challenge")).toBe(createHash("sha256").update(pending.codeVerifier!).digest("base64url"));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("tweet.read tweet.write users.read media.write offline.access");
    expect(u.searchParams.get("redirect_uri")).toBe(netRedirect("x"));
    expect(u.href).not.toContain(pending.codeVerifier!);
    expect(() => netAuthUrl("x", "state")).toThrow(/PKCE/);
  });
  it("exchanges immediately with Basic and verifier, reads users/me, and rotates refresh tokens", async () => {
    const calls = fake((u, body, init) => {
      if (u.pathname === "/2/oauth2/token") {
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("test-client:test-secret").toString("base64")}`);
        return { access_token: body.grant_type === "refresh_token" ? "new-access" : "access", refresh_token: body.grant_type === "refresh_token" ? "new-refresh" : "refresh", expires_in: 7200, scope: netScopes("x").join(" ") };
      }
      expect(u.pathname).toBe("/2/users/me");
      expect(u.searchParams.get("user.fields")).toBe("profile_image_url,username,name");
      expect(init.headers.Authorization).toBe("Bearer access");
      return { data: { id: "12", username: "roofer", name: "Roofing", profile_image_url: "https://img.example/a.jpg" } };
    });
    netDeps.env = () => XENV;
    const signed = await netExchange("x", "short-code", "verifier");
    expect(calls[0].body).toEqual({ grant_type: "authorization_code", code: "short-code", redirect_uri: netRedirect("x"), code_verifier: "verifier" });
    expect(signed).toMatchObject({ externalId: "12", name: "@roofer", token: "access", refresh: "refresh" });
    expect(needsRefresh("x", signed.expiresAt)).toBe(false);
    expect(needsRefresh("x", new Date(Date.now() + 300_000))).toBe(true);
    expect(await netRefresh("x", "access", "refresh")).toMatchObject({ token: "new-access", refresh: "new-refresh" });
    expect(calls[2].body).toEqual({ grant_type: "refresh_token", refresh_token: "refresh" });
  });
  it("publishes a URL-free main post and exactly one link reply, preserving main success on reply failure", async () => {
    const calls = fake((_u, body) => body.reply ? ok({ detail: "credits exhausted" }, 402) : { data: { id: "123" } });
    const p = await netPublish("x", "12", "access", "Our roof https://example.com/a and www.example.org", [], { xUsername: "@roofer" });
    expect(calls.map(c => c.body)).toEqual([{ text: "Our roof and" }, { text: "https://example.com/a\nwww.example.org", reply: { in_reply_to_tweet_id: "123" } }]);
    expect(p).toMatchObject({ stage: "published", external: "123", url: "https://x.com/roofer/status/123", error: expect.stringContaining("Main post published. Link reply failed:") });
    expect(recordFailure).toHaveBeenCalledWith("job", "X posting credits", expect.any(Error));
  });
  it("publishes a successful reply and deletes via v2", async () => {
    const calls = fake(() => ({ data: { id: "123", deleted: true } }));
    expect(await netPublish("x", "12", "access", "Hi example.com", [], { xUsername: "roofer" })).not.toHaveProperty("error");
    await xDelete("access", "123");
    expect(calls[2].url.pathname).toBe("/2/tweets/123");
    expect(calls[2].init.method).toBe("DELETE");
  });
  it.each([[401, {}, /reconnect/], [402, {}, /out of credits/], [403, { detail: "CreditsDepleted" }, /out of credits/], [429, {}, /try again later/], [403, { detail: "duplicate content" }, /already has this content/]])("maps X status %s", async (status, error, message) => {
    fake(() => ok(error, status as number));
    await expect(netPublish("x", "12", "access", "Hi", [], {})).rejects.toThrow(message as RegExp);
  });
  it("rejects weighted overflow and link-only text before any request", async () => {
    const calls = fake(() => { throw new Error("unexpected request"); });
    await expect(netPublish("x", "12", "access", "中".repeat(141), [], {})).rejects.toThrow(/280/);
    await expect(netPublish("x", "12", "access", "https://example.com", [], {})).rejects.toThrow(/main post/);
    await expect(netPublish("x", "12", "access", "Hi " + Array.from({ length: 12 }, (_, i) => `https://e${i}.com`).join(" "), [], {})).rejects.toThrow(/280/);
    expect(calls).toHaveLength(0);
  });
  it.each([false, true])("uploads image/video (video=%s) and polls processing before posting", async (video) => {
    const requests: { path: string; body: any }[] = [];
    netDeps.sleep = async () => {};
    netDeps.mediaHttp = async (url) => {
      expect(url).toMatch(/^https:\/\/media.example.com/);
      return new Response(new Uint8Array(video ? 5 * 1024 * 1024 + 1 : 10));
    };
    netDeps.http = (async (raw: any, init: any) => {
      const u = new URL(String(raw));
      if (u.hostname === "media.example.com") {
        expect(init.headers?.Authorization).toBeUndefined();
        expect(init.redirect).toBe("error");
        return new Response(new Uint8Array(video ? 5 * 1024 * 1024 + 1 : 10));
      }
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      requests.push({ path: u.pathname + u.search, body });
      expect(init.headers.Authorization).toBe("Bearer access");
      if (u.pathname.endsWith("/append")) return new Response(null, { status: 204 });
      if (u.pathname.endsWith("/finalize")) return ok({ data: { id: "media1", processing_info: { state: "pending", check_after_secs: 1 } } });
      if (u.search) return ok({ data: { processing_info: { state: "succeeded" } } });
      return ok({ data: { id: u.pathname.endsWith("/tweets") ? "post1" : "media1" } });
    }) as any;
    await netPublish("x", "12", "access", "Hi", [`https://media.example.com/a.${video ? "mp4" : "jpg"}`], { xUsername: "roofer" });
    expect(requests.at(-1)?.body).toEqual({ text: "Hi", media: { media_ids: ["media1"] } });
    if (video) {
      expect(requests[0].body).toEqual({ media_type: "video/mp4", total_bytes: 5 * 1024 * 1024 + 1, media_category: "tweet_video" });
      expect(requests.slice(1, 3).map(r => r.body.get("segment_index"))).toEqual(["0", "1"]);
      expect(requests[4].path).toBe("/2/media/upload?command=STATUS&media_id=media1");
    } else {
      expect(requests[0].path).toBe("/2/media/upload");
      expect(requests[0].body.get("media_category")).toBe("tweet_image");
      expect(requests[0].body.get("media").size).toBe(10);
    }
  });
});

describe("X account persistence without a database", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("encrypts the connection and saves every rotated refresh token inside a row lock", async () => {
    vi.stubEnv("GBP_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
    let saved: any;
    const query = vi.spyOn(pool, "query").mockImplementation((async (sql: string, args: any[]) => {
      if (sql.startsWith("INSERT INTO social_native_accounts")) saved = { id: args[0], tenant: args[1], platform: args[2], external_id: args[3], name: args[4], token_enc: args[7], api: args[9], refresh_enc: args[10], token_expires_at: args[11] };
      return { rows: sql.startsWith("SELECT") ? [saved] : [] };
    }) as any);
    let rotation = 0;
    fake((u, body) => {
      if (u.pathname === "/2/users/me") return { data: { id: "xuser", username: "roofer" } };
      expect(u.pathname).toBe("/2/oauth2/token");
      if (body.grant_type === "refresh_token") {
        expect(body.refresh_token).toBe(`refresh-${rotation}`);
        rotation++;
      }
      return { access_token: `access-${rotation}`, refresh_token: `refresh-${rotation}`, expires_in: 1, scope: netScopes("x").join(" ") };
    });
    netDeps.env = () => XENV;
    await nativeNetConnect("x", "chu999998b0", "code", "verifier");
    expect(saved.token_enc).not.toContain("access-0");
    expect(decryptToken(saved.refresh_enc)).toBe("refresh-0");
    const tx = vi.fn(async (sql: string, args?: any[]) => {
      if (sql.startsWith("SELECT")) { expect(sql).toContain("FOR UPDATE"); return { rows: [saved] }; }
      if (sql.startsWith("UPDATE")) {
        expect(args?.slice(0, 2)).toEqual(["chu999998b0", saved.id]);
        saved.token_enc = args![2]; saved.refresh_enc = args![3]; saved.token_expires_at = args![4];
      }
      return { rows: [] };
    });
    const release = vi.fn();
    vi.spyOn(pool, "connect").mockResolvedValue({ query: tx, release } as never);
    const c = new NativeClient("chu999998b0");
    expect((await c.credentials(saved.id)).token).toBe("access-1");
    expect(decryptToken(saved.refresh_enc)).toBe("refresh-1");
    expect((await c.credentials(saved.id)).token).toBe("access-2");
    expect(decryptToken(saved.refresh_enc)).toBe("refresh-2");
    expect(tx.mock.calls.map(c => c[0]).filter(s => s === "COMMIT")).toHaveLength(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalled();
  });
  it("returns a published post's persisted link-reply warning to the queue without retrying", async () => {
    vi.spyOn(pool, "query").mockResolvedValue({ rows: [{ stage: "published", public_url: "https://x.com/roofer/status/123", error: "Main post published. Link reply failed: try again later" }] } as never);
    const calls = fake(() => { throw new Error("must not repost"); });
    expect(await new NativeClient("chu999998b0").status("nat_123")).toEqual({ state: "published", publicUrl: "https://x.com/roofer/status/123", error: "Main post published. Link reply failed: try again later" });
    expect(calls).toHaveLength(0);
  });
  it("rejects an expired refresh grant as reconnect and leaves secrets out of the error", async () => {
    fake(() => ok({ error: "invalid_grant", error_description: "secret-do-not-log" }, 400));
    await expect(netRefresh("x", "access", "expired-refresh")).rejects.toMatchObject({ reconnect: true, message: expect.stringMatching(/reconnect/) });
  });
});

it("X supports a media-only main post when all text moves into the reply", async () => {
  netDeps.mediaHttp = async () => new Response(new Uint8Array([1, 2, 3]));
  const calls = fake(u => ({ data: { id: u.pathname === "/2/media/upload" ? "m1" : "p1" } }));
  await netPublish("x", "12", "access", "https://example.com", ["https://media.example.com/a.jpg"], { xUsername: "roofer" });
  expect(calls[1].body).toEqual({ media: { media_ids: ["m1"] } });
  expect(calls[2].body).toEqual({ text: "https://example.com", reply: { in_reply_to_tweet_id: "p1" } });
});
it("X does not post a video that failed processing or report unconfirmed deletion", async () => {
  netDeps.mediaHttp = async () => new Response(new Uint8Array([1, 2, 3]));
  const calls = fake(u => u.pathname.endsWith("/append") ? new Response(null, { status: 204 }) : u.pathname.endsWith("/finalize") ? { data: { processing_info: { state: "failed" } } } : { data: { id: "m1" } });
  await expect(netPublish("x", "12", "access", "Video", ["https://media.example.com/a.mp4"], {})).rejects.toThrow(/process the video/);
  expect(calls.some(c => c.url.pathname === "/2/tweets")).toBe(false);
  await expect(xDelete("access", "p1")).rejects.toThrow(/confirm deletion/);
});

describe("Bluesky (app password, facets, photos, video)", () => {
  // A 1×1 PNG: small enough to go up as-is.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const did = "did:plc:abc123";
  const bsky = (overrides: Partial<Record<string, (u: URL, body: any, init: any) => unknown>> = {}) => fake((u, body, init) => {
    const nsid = u.pathname.replace("/xrpc/", "");
    if (overrides[nsid]) return overrides[nsid]!(u, body, init);
    if (u.hostname === "plc.directory") return { service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }] };
    if (nsid === "com.atproto.identity.resolveHandle") return u.searchParams.get("handle") === "roofer.bsky.social" || u.searchParams.get("handle") === "friend.bsky.social" ? { did: u.searchParams.get("handle") === "friend.bsky.social" ? "did:plc:friend" : did } : ok({ error: "InvalidRequest", message: "Unable to resolve handle" }, 400);
    if (nsid === "com.atproto.server.createSession") return body.password === "abcd-efgh-ijkl-mnop" ? { accessJwt: jwt({ sub: did, exp: Math.floor(Date.now() / 1000) + 7200 }), refreshJwt: jwt({ sub: did, exp: Math.floor(Date.now() / 1000) + 90 * 86400 }), did, handle: "roofer.bsky.social" } : ok({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
    if (nsid === "app.bsky.actor.getProfile") return { did, handle: "roofer.bsky.social", avatar: "https://cdn.bsky.app/a.jpg" };
    if (nsid === "com.atproto.server.refreshSession") return { accessJwt: jwt({ sub: did, exp: Math.floor(Date.now() / 1000) + 7200 }), refreshJwt: "r2", did };
    if (nsid === "com.atproto.repo.uploadBlob") return { blob: { $type: "blob", ref: { $link: "bafyimg" }, mimeType: init.headers["Content-Type"], size: init.body.length } };
    if (nsid === "com.atproto.repo.createRecord") return { uri: `at://${did}/app.bsky.feed.post/3kabc`, cid: "bafycid" };
    if (nsid === "com.atproto.repo.deleteRecord") return {};
    if (nsid === "com.atproto.server.getServiceAuth") return { token: "svc-token" };
    if (nsid === "app.bsky.video.uploadVideo") return { jobId: "job1", state: "JOB_STATE_CREATED" };
    if (nsid === "app.bsky.video.getJobStatus") return { jobStatus: { jobId: "job1", state: "JOB_STATE_COMPLETED", blob: { $type: "blob", ref: { $link: "bafyvid" }, mimeType: "video/mp4", size: 3 } } };
    throw new Error(`Unexpected Bluesky call ${nsid}`);
  });

  it("is switched on by SOCIAL_BLUESKY, with no app keys", () => {
    expect(netConfigured("bluesky", { SOCIAL_BLUESKY: "on" } as any)).toBe(true);
    expect(netConfigured("bluesky", {} as any)).toBe(false);
    expect(() => netAuthUrl("bluesky", "st")).toThrow(/app password/);
  });
  it("signs in with a handle and an app password, finds the account's own PDS, and never accepts a main password", async () => {
    const calls = bsky();
    const s = await blueskyLogin("@Roofer.bsky.social", "abcd-efgh-ijkl-mnop");
    expect(s).toMatchObject({ externalId: did, name: "@roofer.bsky.social", picture: "https://cdn.bsky.app/a.jpg", refresh: expect.stringMatching(/^h\./), scopes: [] });
    expect(s.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 7000_000);
    expect(calls.find((c) => c.url.pathname.endsWith("createSession"))!.url.origin).toBe("https://pds.example.com");
    expect(calls.find((c) => c.url.pathname.endsWith("createSession"))!.body).toEqual({ identifier: "roofer.bsky.social", password: "abcd-efgh-ijkl-mnop" });
    await expect(blueskyLogin("roofer.bsky.social", "MyRealPassword123")).rejects.toThrow(/app password/);
    await expect(blueskyLogin("roofer.bsky.social", "zzzz-zzzz-zzzz-zzzz")).rejects.toThrow(/didn't accept/);
    await expect(blueskyLogin("nobody.bsky.social", "abcd-efgh-ijkl-mnop")).rejects.toThrow(/doesn't know that handle/);
    await expect(blueskyLogin("not a handle", "abcd-efgh-ijkl-mnop")).rejects.toThrow(/Enter the Bluesky handle/);
  });
  it("refreshes through the PDS named in the refresh token and keeps the new refresh token", async () => {
    bsky();
    const now = Date.now(); netDeps.now = () => now;
    expect(needsRefresh("bluesky", new Date(now + 5 * 60_000))).toBe(true);
    const f = await netRefresh("bluesky", "old", jwt({ sub: did, exp: 1 }));
    expect(f.refresh).toBe("r2");
    expect(f.expiresAt!.getTime()).toBeGreaterThan(now + 7000_000);
    await expect(netRefresh("bluesky", "old", null)).rejects.toMatchObject({ reconnect: true });
  });
  it("counts graphemes and plans text, up to four photos, or one video", () => {
    expect(blueskyLength("Hi 👋🏽 there")).toBe(10);
    expect(blueskyPlan("Hi", [])).toEqual({ kind: "text" });
    expect(blueskyPlan("", ["https://x.us/a.jpg"])).toEqual({ kind: "images", urls: ["https://x.us/a.jpg"] });
    expect(blueskyPlan("Hi", ["https://x.us/a.mp4"])).toEqual({ kind: "video", url: "https://x.us/a.mp4" });
    expect(() => blueskyPlan("", [])).toThrow(/needs text/);
    expect(() => blueskyPlan("😀".repeat(301), [])).toThrow(/300/);
    expect(blueskyLength("😀".repeat(300))).toBe(300);
    expect(() => blueskyPlan("x", ["https://x.us/a.mp4", "https://x.us/b.jpg"])).toThrow(/one video/);
    expect(() => blueskyPlan("x", Array(5).fill("https://x.us/a.jpg"))).toThrow(/four photos/);
  });
  it("marks links, tags and known mentions with UTF-8 byte offsets, nothing overlapping", async () => {
    const text = "Café ✔ new roof: https://constructhub.us/jobs/1). #Roofing #1 @friend.bsky.social @nobody.bsky.social www.x.us.";
    const resolve = async (h: string) => (h === "friend.bsky.social" ? "did:plc:friend" : null);
    const f = await blueskyFacets(text, resolve);
    const bytes = Buffer.from(text, "utf8");
    const slice = (i: { byteStart: number; byteEnd: number }) => bytes.subarray(i.byteStart, i.byteEnd).toString("utf8");
    expect(f.map((x) => [slice(x.index), x.features[0]])).toEqual([
      ["https://constructhub.us/jobs/1", { $type: "app.bsky.richtext.facet#link", uri: "https://constructhub.us/jobs/1" }],
      ["#Roofing", { $type: "app.bsky.richtext.facet#tag", tag: "Roofing" }],
      ["@friend.bsky.social", { $type: "app.bsky.richtext.facet#mention", did: "did:plc:friend" }],
      ["www.x.us", { $type: "app.bsky.richtext.facet#link", uri: "https://www.x.us" }],
    ]);
    expect(await blueskyFacets("plain words only", resolve)).toEqual([]);
  });
  it("publishes text with facets as one record, published at once with its bsky.app link", async () => {
    const calls = bsky();
    const p = await netPublish("bluesky", did, "tok", "New roof done #Roofing https://constructhub.us", [], { blueskyHandle: "@roofer.bsky.social" });
    expect(p).toEqual({ stage: "published", external: `at://${did}/app.bsky.feed.post/3kabc`, url: "https://bsky.app/profile/roofer.bsky.social/post/3kabc" });
    const rec = calls.find((c) => c.url.pathname.endsWith("createRecord"))!;
    expect(rec.url.origin).toBe("https://pds.example.com");
    expect(rec.init.headers.Authorization).toBe("Bearer tok");
    expect(rec.body).toMatchObject({ repo: did, collection: "app.bsky.feed.post", record: { $type: "app.bsky.feed.post", text: "New roof done #Roofing https://constructhub.us" } });
    expect(rec.body.record.facets.map((x: any) => x.features[0].$type)).toEqual(["app.bsky.richtext.facet#tag", "app.bsky.richtext.facet#link"]);
    expect(rec.body.record.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await netRead("bluesky", did, "tok", "published", `at://${did}/app.bsky.feed.post/3kabc`, "@roofer.bsky.social")).toMatchObject({ state: "published", url: "https://bsky.app/profile/roofer.bsky.social/post/3kabc" });
  });
  it("uploads photos to the PDS as blobs with their aspect ratio, and shrinks big ones under 1,000,000 bytes", async () => {
    const calls = bsky();
    netDeps.mediaHttp = async () => new Response(new Uint8Array(png));
    const p = await netPublish("bluesky", did, "tok", "Before and after", ["https://constructhub.us/api/files/a.png", "https://constructhub.us/api/files/b.png"], {});
    expect(p.stage).toBe("published");
    const ups = calls.filter((c) => c.url.pathname.endsWith("uploadBlob"));
    expect(ups).toHaveLength(2);
    expect(ups[0].init.headers["Content-Type"]).toBe("image/png");
    const rec = calls.find((c) => c.url.pathname.endsWith("createRecord"))!.body.record;
    expect(rec.embed.$type).toBe("app.bsky.embed.images");
    expect(rec.embed.images[0]).toMatchObject({ alt: "", aspectRatio: { width: 1, height: 1 }, image: { ref: { $link: "bafyimg" } } });
    const big = await blueskyImage(await sharp({ create: { width: 2600, height: 1800, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png({ compressionLevel: 0 }).toBuffer());
    expect(big.bytes.length).toBeLessThanOrEqual(1_000_000);
    expect(big).toMatchObject({ type: "image/jpeg", width: 2000, height: 1385 });
  });
  it("sends a video through video.bsky.app with a service token from the PDS and waits for processing", async () => {
    let polls = 0;
    const calls = bsky({ "app.bsky.video.getJobStatus": () => (++polls < 2 ? { jobStatus: { jobId: "job1", state: "JOB_STATE_ENCODING", progress: 50 } } : { jobStatus: { jobId: "job1", state: "JOB_STATE_COMPLETED", blob: { $type: "blob", ref: { $link: "bafyvid" }, mimeType: "video/mp4", size: 3 } } }) });
    netDeps.mediaHttp = async () => new Response(new Uint8Array([1, 2, 3]));
    netDeps.sleep = async () => {};
    const p = await netPublish("bluesky", did, "tok", "Job walkthrough", ["https://constructhub.us/api/files/walk.mp4"], { blueskyHandle: "@roofer.bsky.social" });
    expect(p.url).toBe("https://bsky.app/profile/roofer.bsky.social/post/3kabc");
    const auth = calls.find((c) => c.url.pathname.endsWith("getServiceAuth"))!;
    expect(auth.url.searchParams.get("aud")).toBe("did:web:pds.example.com");
    expect(auth.url.searchParams.get("lxm")).toBe("com.atproto.repo.uploadBlob");
    const up = calls.find((c) => c.url.pathname.endsWith("uploadVideo"))!;
    expect(up.url.origin).toBe("https://video.bsky.app");
    expect(up.url.searchParams.get("did")).toBe(did);
    expect(up.init.headers.Authorization).toBe("Bearer svc-token");
    expect(polls).toBe(2);
    expect(calls.find((c) => c.url.pathname.endsWith("createRecord"))!.body.record.embed).toEqual({ $type: "app.bsky.embed.video", video: { $type: "blob", ref: { $link: "bafyvid" }, mimeType: "video/mp4", size: 3 } });
  });
  it("an expired or revoked session asks to reconnect; rate limits ask to retry; deleting removes the record", async () => {
    bsky({ "com.atproto.repo.createRecord": () => ok({ error: "ExpiredToken", message: "Token has expired" }, 400) });
    await expect(netPublish("bluesky", did, "tok", "x", [], {})).rejects.toMatchObject({ reconnect: true });
    bsky({ "com.atproto.repo.createRecord": () => ok({ error: "RateLimitExceeded" }, 429) });
    await expect(netPublish("bluesky", did, "tok", "x", [], {})).rejects.toMatchObject({ status: 429 });
    const calls = bsky();
    await blueskyDelete(did, "tok", `at://${did}/app.bsky.feed.post/3kabc`);
    expect(calls.find((c) => c.url.pathname.endsWith("deleteRecord"))!.body).toEqual({ repo: did, collection: "app.bsky.feed.post", rkey: "3kabc" });
    await expect(blueskyDelete(did, "tok", "nonsense")).rejects.toThrow(/isn't a Bluesky post/);
  });
});
