/** ConstructHUB Direct — Instagram login, Threads, TikTok (server/social/native-nets.ts): plans, sign-in, refresh, and the
 * full publish path through NativeClient against fake networks and the development database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { netAuthUrl, netConfigured, netDeps, netExchange, needsRefresh, threadsPlan, tiktokPlan } from "./native-nets";
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
  it("TikTok: one video or up to 35 photos, private unless the customer chose otherwise", () => {
    const v = tiktokPlan("New roof", ["https://constructhub.us/api/files/social/t/media.mp4"], {});
    expect(v.kind).toBe("video");
    expect(v.body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(v.body.source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://constructhub.us/api/files/social/t/media.mp4" });
    const p = tiktokPlan("Before and after\nDone in two days", ["https://x.us/a.jpg", "https://x.us/b.jpg"], { privacyLevel: "PUBLIC_TO_EVERYONE", isAiGenerated: true });
    expect(p.kind).toBe("photo");
    expect(p.body.post_info).toMatchObject({ title: "Before and after", description: "Done in two days", privacy_level: "PUBLIC_TO_EVERYONE", is_aigc: true });
    expect(() => tiktokPlan("x", [], {})).toThrow(/video or photos/);
    expect(() => tiktokPlan("x", ["https://x.us/a.mp4", "https://x.us/b.jpg"], {})).toThrow(/one video/);
  });
});

describe("signing in", () => {
  it("sends each network to its own sign-in with our redirect and the scopes we use", () => {
    netDeps.env = () => ENV;
    const tt = new URL(netAuthUrl("tiktok", "st"));
    expect(tt.host).toBe("www.tiktok.com");
    expect(tt.searchParams.get("client_key")).toBe("awtiktokkey");
    expect(tt.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/tiktok\/callback$/);
    expect(tt.searchParams.get("scope")).toContain("video.publish");
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
  beforeAll(async () => { await ensureNativeSchema(); await removeNativeAccounts(tenant); await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]); });
  afterAll(async () => { await removeNativeAccounts(tenant); await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]); });
  const post = (accountId: string, text: string, mediaUrls: string[] = []) => ({ post: { accountId, content: { text, mediaUrls, platform: "x" }, target: {} } });

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
    const { submissionId } = await c.submit(post(tt.id, "Tear-off day", ["https://constructhub.us/api/files/social/t/media.mp4"]) as any, "tt-1");
    expect(refreshed).toBe(1);   // the 60-second token was refreshed before posting
    const init = calls.find((x) => x.url.pathname === "/v2/post/publish/video/init/")!;
    expect(init.body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(await c.status(submissionId)).toEqual({ state: "published", publicUrl: null, error: null });
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
