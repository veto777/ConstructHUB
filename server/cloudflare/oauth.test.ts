import { describe, expect, it, vi } from "vitest";
import { CLOUDFLARE_OAUTH, CLOUDFLARE_OAUTH_SCOPES, cloudflareConsentUrl, cloudflareOAuthConfigured, exchangeCloudflareCode, grantedScopes, revokeCloudflareGrant } from "./oauth";
import { ProviderError } from "./common";

const env = { CLOUDFLARE_OAUTH_CLIENT_ID: "a".repeat(32), CLOUDFLARE_OAUTH_CLIENT_SECRET: "s-e-c-r-e-t" } as NodeJS.ProcessEnv;
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

describe("Connect with Cloudflare (OAuth)", () => {
  it("is off until both client settings exist", () => {
    expect(cloudflareOAuthConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(cloudflareOAuthConfigured({ CLOUDFLARE_OAUTH_CLIENT_ID: "x" } as NodeJS.ProcessEnv)).toBe(false);
    expect(cloudflareOAuthConfigured(env)).toBe(true);
  });

  it("sends the customer to Cloudflare's consent page for our client, with every scope and the state", () => {
    const url = new URL(cloudflareConsentUrl("https://constructhub.us/api/cloudflare/oauth/callback", "st4te", env));
    expect(`${url.origin}${url.pathname}`).toBe(CLOUDFLARE_OAUTH.auth);
    expect(url.searchParams.get("client_id")).toBe(env.CLOUDFLARE_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://constructhub.us/api/cloudflare/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([...CLOUDFLARE_OAUTH_SCOPES]);
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("exchanges the code with the client secret in the form body, never in the URL", async () => {
    const http = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe(CLOUDFLARE_OAUTH.token);
      const form = new URLSearchParams(init.body);
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("code")).toBe("c0de");
      expect(form.get("redirect_uri")).toBe("https://constructhub.us/api/cloudflare/oauth/callback");
      expect(form.get("client_id")).toBe(env.CLOUDFLARE_OAUTH_CLIENT_ID);
      expect(form.get("client_secret")).toBe(env.CLOUDFLARE_OAUTH_CLIENT_SECRET);
      return json({ access_token: "acc", refresh_token: "ref", expires_in: 3600, scope: "zone.read analytics.read offline_access" });
    });
    const t = await exchangeCloudflareCode("c0de", "https://constructhub.us/api/cloudflare/oauth/callback", http as any, env);
    expect(t.access_token).toBe("acc");
    expect(grantedScopes(t)).toEqual(["zone.read", "analytics.read"]);
  });

  it("treats a refused or malformed token reply as a failed sign-in and says nothing Cloudflare said", async () => {
    const refused = vi.fn(async () => json({ error: "invalid_grant", error_description: "secret-ish detail" }, 400));
    await expect(exchangeCloudflareCode("bad", "https://constructhub.us/x", refused as any, env)).rejects.toMatchObject({ status: 401 });
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const err = await exchangeCloudflareCode("c", "https://constructhub.us/x", down as any, env).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).not.toContain("ECONNRESET");
    expect(err.message).not.toContain("secret-ish");
  });

  it("falls back to the full scope list when Cloudflare omits scope, without offline_access", () => {
    expect(grantedScopes({ access_token: "a" })).toEqual(CLOUDFLARE_OAUTH_SCOPES.filter((s) => s !== "offline_access"));
  });

  it("revocation is best effort and reports whether Cloudflare accepted it", async () => {
    process.env.GBP_TOKEN_KEY ||= Buffer.alloc(32, 7).toString("base64");
    const { encryptToken } = await import("../gbp/token-crypto");
    const ok = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe(CLOUDFLARE_OAUTH.revoke);
      expect(new URLSearchParams(init.body).get("token")).toBe("ref");
      return new Response("", { status: 200 });
    });
    expect(await revokeCloudflareGrant({ refresh_token: encryptToken("ref") }, ok as any, env)).toBe(true);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await revokeCloudflareGrant({ refresh_token: encryptToken("ref") }, down as any, env)).toBe(false);
    expect(await revokeCloudflareGrant({}, ok as any, env)).toBe(false);
  });
});
