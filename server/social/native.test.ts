/** ConstructHUB Direct (server/social/native.ts): plans, errors, sign-in state, and the client against a fake Meta + the dev database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import {
  NativeClient, ensureNativeSchema, facebookPlan, graphError, instagramPlan, nativeAllowlisted, nativeDeps, nativeNetworks, nativeNetworksFor, newOAuthState,
  oauthStateMatches, receiveUpload, metaAuthUrl, savePending, nativePendingList, nativeFinalize, removeNativeAccounts,
} from "./native";
import { clientFactory } from "./schedule";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const realHttp = nativeDeps.http;
afterEach(() => { nativeDeps.http = realHttp; nativeDeps.env = () => process.env; nativeDeps.now = () => Date.now(); });
function fakeMeta(answer: (path: string, params: URLSearchParams, method: string) => unknown) {
  const calls: { path: string; params: URLSearchParams; method: string }[] = [];
  nativeDeps.http = (async (url: any, init: any) => {
    const u = new URL(String(url));
    const params = init?.method === "POST" ? new URLSearchParams(String(init.body)) : u.searchParams;
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    calls.push({ path, params, method: init?.method ?? "GET" });
    const r = answer(path, params, init?.method ?? "GET");
    return r instanceof Response ? r : ok(r);
  }) as any;
  return calls;
}

describe("which networks are switched on", () => {
  it("a network that needs no review can open to everyone on its own", () => {
    const env = { SOCIAL_BLUESKY: "on", SOCIAL_X_CLIENT_ID: "x", SOCIAL_X_CLIENT_SECRET: "y" } as any;
    expect(nativeNetworksFor({ email: "customer@example.com" }, env)).toEqual([]);
    expect(nativeNetworksFor({ email: "customer@example.com" }, { ...env, SOCIAL_NATIVE_PUBLIC_NETWORKS: "bluesky" })).toEqual(["bluesky"]);
    expect(nativeNetworksFor({ email: "customer@example.com" }, { ...env, SOCIAL_NATIVE_PUBLIC: "true" })).toEqual(["x", "bluesky"]);
  });
  it("needs both the Meta app id and secret", () => {
    expect(nativeNetworks({} as any)).toEqual([]);
    expect(nativeNetworks({ SOCIAL_META_APP_ID: "1609986400506072" } as any)).toEqual([]);
    expect(nativeNetworks({ SOCIAL_META_APP_ID: "1609986400506072", SOCIAL_META_APP_SECRET: "0123456789abcdef0123" } as any)).toEqual(["facebook", "instagram"]);
    // Bluesky needs no app keys: a switch is enough (an app password is the customer's whole grant).
    expect(nativeNetworks({ SOCIAL_BLUESKY: "on" } as any)).toEqual(["bluesky"]);
    expect(nativeNetworks({ SOCIAL_PINTEREST_APP_ID: "1510000", SOCIAL_PINTEREST_APP_SECRET: "pin-secret-0123456789abcdef" } as any)).toEqual(["pinterest"]);
    expect(nativeNetworks({ SOCIAL_BLUESKY: "off" } as any)).toEqual([]);
  });
  it("is shown only to platform admins until it is opened to everyone", () => {
    const env = { SOCIAL_META_APP_ID: "1609986400506072", SOCIAL_META_APP_SECRET: "0123456789abcdef0123" } as any;
    expect(nativeNetworksFor({ email: "roofer@example.com" }, env)).toEqual([]);
    expect(nativeNetworksFor(null, env)).toEqual([]);
    expect(nativeNetworksFor({ email: "support@constructhub.us" }, env)).toEqual(["facebook", "instagram"]);
    expect(nativeNetworksFor({ email: "roofer@example.com" }, { ...env, SOCIAL_NATIVE_PUBLIC: "true" })).toEqual(["facebook", "instagram"]);
  });
  it("is shown to the reviewer accounts SOCIAL_NATIVE_EMAILS lists, whatever the case", () => {
    const env = { SOCIAL_META_APP_ID: "1609986400506072", SOCIAL_META_APP_SECRET: "0123456789abcdef0123",
      SOCIAL_NATIVE_EMAILS: "Meta.Reviewer@constructhub.us, tiktok-review@constructhub.us;  spaced@example.com" } as any;
    expect(nativeAllowlisted("meta.reviewer@constructhub.us", env)).toBe(true);
    expect(nativeAllowlisted(" TIKTOK-REVIEW@constructhub.us ", env)).toBe(true);
    expect(nativeAllowlisted("spaced@example.com", env)).toBe(true);
    expect(nativeAllowlisted("roofer@example.com", env)).toBe(false);
    expect(nativeAllowlisted("", env)).toBe(false);
    expect(nativeAllowlisted(null, { ...env, SOCIAL_NATIVE_EMAILS: "" })).toBe(false);
    expect(nativeNetworksFor({ email: "META.reviewer@constructhub.us" }, env)).toEqual(["facebook", "instagram"]);
    expect(nativeNetworksFor({ email: "roofer@example.com" }, env)).toEqual([]);
    expect(nativeNetworksFor({ email: "meta.reviewer@constructhub.us" }, { ...env, SOCIAL_NATIVE_EMAILS: undefined })).toEqual([]);
  });
  it("picks ConstructHUB Direct from the stored marker", () => {
    expect(clientFactory("native:chu1b2").provider).toBe("native");
    expect(() => new NativeClient("../x")).toThrow();
  });
});

describe("what each network receives", () => {
  it("Facebook: text, one photo, several photos, one video", () => {
    expect(facebookPlan("Hi", [])).toEqual({ kind: "text" });
    expect(facebookPlan("Hi", ["https://x.us/a.jpg"])).toEqual({ kind: "photo", url: "https://x.us/a.jpg" });
    expect(facebookPlan("Hi", ["https://x.us/a.jpg", "https://x.us/b.png"])).toEqual({ kind: "photos", urls: ["https://x.us/a.jpg", "https://x.us/b.png"] });
    expect(facebookPlan("Hi", ["https://x.us/a.mp4"])).toEqual({ kind: "video", url: "https://x.us/a.mp4" });
    expect(() => facebookPlan("Hi", ["https://x.us/a.mp4", "https://x.us/b.jpg"])).toThrow(/one video/);
  });
  it("Instagram: needs media; reels for video; carousels up to 10; caption limit", () => {
    expect(() => instagramPlan("Hi", [])).toThrow(/photo or a video/);
    expect(instagramPlan("Hi", ["https://x.us/a.mov"])).toEqual({ kind: "reel", url: "https://x.us/a.mov" });
    expect(instagramPlan("Hi", ["https://x.us/a.jpg"])).toEqual({ kind: "image", url: "https://x.us/a.jpg" });
    expect(instagramPlan("Hi", ["https://x.us/a.jpg", "https://x.us/b.mp4"])).toEqual({ kind: "carousel", items: [{ url: "https://x.us/a.jpg", video: false }, { url: "https://x.us/b.mp4", video: true }] });
    expect(() => instagramPlan("x".repeat(2201), ["https://x.us/a.jpg"])).toThrow(/2,200/);
  });
  it("turns Meta's errors into our sentences", () => {
    const expired = graphError({ code: 190, message: "Error validating access token" }, 400);
    expect(expired.status).toBe(409); expect((expired as any).reconnect).toBe(true);
    expect(graphError({ code: 4 }, 400).status).toBe(429);
    expect(graphError({ code: 200, message: "(#200) Requires pages_manage_posts" }, 403).message).toMatch(/didn't allow/);
    expect(graphError({ code: 100, error_user_msg: "Bad image" }, 400).message).toBe("The network refused it: Bad image");
  });
});

describe("the Meta sign-in address", () => {
  it("uses the saved configuration when there is one, the permission list otherwise", () => {
    nativeDeps.env = () => ({ SOCIAL_META_APP_ID: "1609986400506072" }) as any;
    const plain = new URL(metaAuthUrl("st"));
    expect(plain.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(plain.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/callback$/);
    nativeDeps.env = () => ({ SOCIAL_META_APP_ID: "1609986400506072", SOCIAL_META_CONFIG_ID: "123456789012" }) as any;
    const cfg = new URL(metaAuthUrl("st"));
    expect(cfg.searchParams.get("config_id")).toBe("123456789012");
    expect(cfg.searchParams.get("scope")).toBeNull();
  });
});

describe("sign-in state", () => {
  it("matches only the same user, the same state, in time", () => {
    const p = newOAuthState(7, 3, "facebook");
    expect(oauthStateMatches(p, 7, p.state)).toBe(true);
    expect(oauthStateMatches(p, 8, p.state)).toBe(false);
    expect(oauthStateMatches(p, 7, p.state + "x")).toBe(false);
    expect(oauthStateMatches(undefined, 7, p.state)).toBe(false);
    nativeDeps.now = () => Date.now() + 11 * 60_000;
    expect(oauthStateMatches(p, 7, p.state)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL || !process.env.GBP_TOKEN_KEY)("the client against a fake Meta (development database)", () => {
  const tenant = "chu999999b0";
  let fb = "", ig = "";
  beforeAll(async () => {
    await ensureNativeSchema();
    await removeNativeAccounts(tenant);
    await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]);
    const session = await savePending(tenant, 999999, "facebook", [
      { id: "1336027662933910", name: "Construct HUB", token: "PAGE_TOKEN", picture: null, ig: { id: "17841467935668597", username: "constructhubapp", picture: null } },
      { id: "222", name: "Other Page", token: "OTHER", picture: null, ig: null },
    ]);
    expect((await nativePendingList(session, tenant, 999999)).pages.map((p) => p.name)).toEqual(["Construct HUB", "Other Page"]);
    await expect(nativePendingList(session, "chu1b0", 999999)).rejects.toThrow(/expired/);   // someone else's tenant
    expect(await nativeFinalize(session, tenant, 999999, ["1336027662933910"])).toBe(1);
    const igSession = await savePending(tenant, 999999, "instagram", [{ id: "1336027662933910", name: "Construct HUB", token: "PAGE_TOKEN", picture: null, ig: { id: "17841467935668597", username: "constructhubapp", picture: null } }]);
    expect(await nativeFinalize(igSession, tenant, 999999, ["17841467935668597"])).toBe(1);
    const accts = await new NativeClient(tenant).accounts();
    fb = accts.find((a) => a.platform === "facebook")!.id; ig = accts.find((a) => a.platform === "instagram")!.id;
    expect(accts.map((a) => `${a.platform}:${a.name}`).sort()).toEqual(["facebook:Construct HUB", "instagram:@constructhubapp"]);
  });
  afterAll(async () => {
    await removeNativeAccounts(tenant);
    await pool.query("DELETE FROM social_native_submissions WHERE tenant=$1", [tenant]);
  });
  const post = (accountId: string, text: string, mediaUrls: string[] = []) => ({ post: { accountId, content: { text, mediaUrls, platform: "x" }, target: {} } });

  it("publishes a Facebook text post once, however often the worker retries", async () => {
    const calls = fakeMeta((path) => path.endsWith("/feed") ? { id: "1336027662933910_555" } : { permalink_url: "https://www.facebook.com/p/555" });
    const c = new NativeClient(tenant);
    const a = await c.submit(post(fb, "New roof done") as any, "post-1");
    const b = await c.submit(post(fb, "New roof done") as any, "post-1");
    expect(b.submissionId).toBe(a.submissionId);
    expect(calls.filter((x) => x.path.endsWith("/feed"))).toHaveLength(1);
    expect(calls[0].params.get("access_token")).toBe("PAGE_TOKEN");
    expect(await c.status(a.submissionId)).toEqual({ state: "published", publicUrl: "https://www.facebook.com/p/555", error: null });
  });

  it("publishes an Instagram reel after Meta finishes processing it", async () => {
    let finished = false;
    const calls = fakeMeta((path, params) => {
      if (path === "17841467935668597/media") return { id: "C1" };
      if (path === "C1") return { status_code: finished ? "FINISHED" : "IN_PROGRESS" };
      if (path === "17841467935668597/media_publish") return { id: "M1" };
      if (path === "M1") return { permalink: "https://www.instagram.com/reel/abc/" };
      throw new Error(`unexpected ${path} ${params}`);
    });
    const c = new NativeClient(tenant);
    const { submissionId } = await c.submit(post(ig, "Before and after", ["https://constructhub.us/api/files/social/t/media.mp4"]) as any, "post-2");
    expect(calls[0].params.get("media_type")).toBe("REELS");
    expect(await c.status(submissionId)).toEqual({ state: "submitted", publicUrl: null, error: null });
    finished = true;
    expect(await c.status(submissionId)).toEqual({ state: "published", publicUrl: "https://www.instagram.com/reel/abc/", error: null });
    expect(calls.filter((x) => x.path.endsWith("media_publish"))).toHaveLength(1);
  });

  it("an expired sign-in marks the account for reconnecting and nothing is half-sent", async () => {
    fakeMeta(() => ok({ error: { code: 190, message: "Session has expired" } }, 400));
    const c = new NativeClient(tenant);
    await expect(c.submit(post(fb, "Hi") as any, "post-3")).rejects.toThrow(/reconnect/);
    const { rows: [r] } = await pool.query("SELECT needs_reconnect FROM social_native_accounts WHERE id=$1", [fb]);
    expect(r.needs_reconnect).toBe(true);
    const { rowCount } = await pool.query("SELECT 1 FROM social_native_submissions WHERE tenant=$1 AND idem_key='post-3'", [tenant]);
    expect(rowCount).toBe(0);
    await pool.query("UPDATE social_native_accounts SET needs_reconnect=false WHERE id=$1", [fb]);
  });

  it("an upload link works once, for the user who opened it, with the type it was opened for", async () => {
    const c = new NativeClient(tenant);
    const up = await c.startUpload("roof.jpg", 999999);
    expect(up.publicUrl).toMatch(/\/api\/files\/social\/[a-f0-9]{32}\/media\.jpg$/);
    const token = up.presignedUrl.split("/").pop()!;
    const stored: string[] = [];
    const put = async (key: string) => { stored.push(key); return key; };
    await expect(receiveUpload(token, 1, Buffer.from("x"), "image/jpeg", put)).rejects.toThrow(/expired/);   // someone else
    await expect(receiveUpload(token, 999999, Buffer.from("x"), "video/mp4", put)).rejects.toThrow(/type/);
    await receiveUpload(token, 999999, Buffer.from("jpeg-bytes"), "image/jpeg", put);
    await expect(receiveUpload(token, 999999, Buffer.from("again"), "image/jpeg", put)).rejects.toThrow(/expired/);  // once
    expect(stored).toEqual([`social/${token}/media.jpg`]);
  });
});
