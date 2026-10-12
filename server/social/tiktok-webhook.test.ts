/** TikTok webhooks (server/social/tiktok-webhook.ts): the signature check, the authorization.removed purge, and
 * disconnect revoking our access at TikTok — against fake networks and the development database. */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { pool } from "../db";
import { handleTikTokEvent, tiktokSignatureValid } from "./tiktok-webhook";
import { netDeps } from "./native-nets";
import { NativeClient, ensureNativeSchema, nativeNetConnect, removeNativeAccounts } from "./native";

const SECRET = "tt-secret-0123456789abcdef";
const sign = (t: number, body: string, secret = SECRET) => `t=${t},s=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const body = JSON.stringify({ client_key: "awtiktokkey", event: "authorization.removed", create_time: 1791800000, user_openid: "open-x", content: "{\"reason\":1}" });

describe("TikTok-Signature", () => {
  const now = 1_791_800_000_000, t = now / 1000;
  it("accepts TikTok's own signature over `${t}.${raw body}`", () => {
    expect(tiktokSignatureValid(Buffer.from(body), sign(t, body), SECRET, now)).toBe(true);
    expect(tiktokSignatureValid(body, sign(t - 120, body), SECRET, now)).toBe(true);
  });
  it("refuses another secret, a changed body, a malformed header or nothing at all", () => {
    expect(tiktokSignatureValid(body, sign(t, body, "another-secret-0123456789"), SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body.replace("open-x", "open-y"), sign(t, body), SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body, sign(t, body).replace(/^t=\d+/, `t=${t + 1}`), SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body, "s=abc", SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body, undefined, SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(undefined, sign(t, body), SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body, sign(t, body), undefined, now)).toBe(false);
  });
  it("refuses a request older (or further ahead) than 5 minutes", () => {
    expect(tiktokSignatureValid(body, sign(t - 301, body), SECRET, now)).toBe(false);
    expect(tiktokSignatureValid(body, sign(t + 301, body), SECRET, now)).toBe(false);
  });
});

const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const realHttp = netDeps.http;
function fake(answer: (u: URL, b: any) => unknown) {
  const calls: { url: URL; body: any }[] = [];
  netDeps.env = () => ({ SOCIAL_TIKTOK_CLIENT_KEY: "awtiktokkey", SOCIAL_TIKTOK_CLIENT_SECRET: SECRET } as any);
  netDeps.http = (async (u: any, init: any) => {
    const url = new URL(String(u));
    const b = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body: b });
    return ok(answer(url, b) ?? {});
  }) as any;
  return calls;
}
const signIn = (openId: string, token: string) => (u: URL, b: any) => {
  if (u.pathname === "/v2/oauth/token/") return { access_token: token, refresh_token: "R", open_id: openId, scope: "user.info.basic,video.publish", expires_in: 86400 };
  if (u.pathname === "/v2/user/info/") return { data: { user: { open_id: openId, username: openId, display_name: openId } }, error: { code: "ok" } };
  return {};
};
afterEach(() => { netDeps.http = realHttp; netDeps.env = () => process.env; });

describe.skipIf(!process.env.DATABASE_URL || !process.env.GBP_TOKEN_KEY)("authorization.removed and disconnect (development database)", () => {
  const tenant = "chu999994b0", other = "chu999994b1";
  afterAll(async () => {
    fake(() => ({}));
    await removeNativeAccounts(tenant); await removeNativeAccounts(other);
    netDeps.http = realHttp;
  });

  it("deletes that open_id's TikTok accounts and tokens everywhere, and nothing else", async () => {
    await ensureNativeSchema();
    fake(() => ({}));
    await removeNativeAccounts(tenant); await removeNativeAccounts(other);
    fake(signIn("open-gone", "TA"));
    await nativeNetConnect("tiktok", tenant, "code");
    await nativeNetConnect("tiktok", other, "code");
    fake(signIn("open-stays", "TB"));
    await nativeNetConnect("tiktok", tenant, "code");
    expect((await new NativeClient(tenant).accounts()).length).toBe(2);

    expect(await handleTikTokEvent(JSON.parse(body.replace("open-x", "open-gone")))).toEqual({ event: "authorization.removed", deleted: 2 });
    expect((await new NativeClient(tenant).accounts()).map((a) => a.name)).toEqual(["@open-stays"]);
    expect(await new NativeClient(other).accounts()).toEqual([]);
    expect(await handleTikTokEvent({ event: "authorization.removed", user_openid: "'; DROP TABLE x;--" })).toMatchObject({ deleted: 0 });
  });

  it("accepts post.publish.* events", async () => {
    expect(await handleTikTokEvent({ event: "post.publish.complete", user_openid: "open-stays", content: JSON.stringify({ publish_id: "v_pub_nope", publish_type: "DIRECT_PUBLISH" }) }))
      .toEqual({ event: "post.publish.complete", nudged: 0 });
    expect((await handleTikTokEvent({ event: "post.publish.failed", content: "not json" })).event).toBe("post.publish.failed");
  });

  it("disconnect revokes the TikTok token at TikTok before deleting it", async () => {
    const calls = fake(() => ({}));
    expect(await removeNativeAccounts(tenant)).toBe(1);
    const revoke = calls.filter((c) => c.url.pathname === "/v2/oauth/revoke/");
    expect(revoke).toHaveLength(1);
    expect(revoke[0].body).toEqual({ client_key: "awtiktokkey", client_secret: SECRET, token: "TB" });
  });
});
