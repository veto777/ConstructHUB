/** Bluesky "Sign in with Bluesky" (AT Protocol OAuth, DPoP): client metadata, discovery, PAR, token, refresh, publish. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { netDeps } from "./native-nets";
import {
  blueskyOauthConfigured, blueskyClientId, blueskyClientMetadata, blueskyJwks,
  blueskyAuthorizeUrl, blueskyExchange, blueskyOauthRefresh, blueskyOauthPublish, oauthNeedsRefresh, newDpopKey,
} from "./bluesky-oauth";

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const seg = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split(".")[i], "base64url").toString("utf8"));
const realHttp = netDeps.http, realMedia = netDeps.mediaHttp, realSleep = netDeps.sleep, realNow = netDeps.now;
afterEach(() => { netDeps.http = realHttp; netDeps.mediaHttp = realMedia; netDeps.sleep = realSleep; netDeps.now = realNow; });

function fake(answer: (url: URL, body: any, init: any) => unknown) {
  const calls: { url: URL; body: any; init: any }[] = [];
  netDeps.http = (async (u: any, init: any) => {
    const url = new URL(String(u));
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? JSON.parse(raw) : raw;
    calls.push({ url, body, init });
    const r = answer(url, body, init);
    return r instanceof Response ? r : ok(r);
  }) as any;
  return calls;
}

// A Bluesky OAuth server + one account's PDS. The PDS discovery and both DPoP endpoints demand a nonce on the first try.
const DID = "did:plc:roofer123";
function bsky(over: Record<string, (u: URL, b: any, i: any) => unknown> = {}) {
  return fake((u, b, i) => {
    const key = `${u.host}${u.pathname}`;
    if (over[key]) return over[key](u, b, i);
    if (u.pathname === "/xrpc/com.atproto.identity.resolveHandle") return u.searchParams.get("handle") === "roofer.bsky.social" ? { did: DID } : ok({ error: "InvalidRequest" }, 400);
    if (u.pathname === "/plc/" || u.host === "plc.directory") return { service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }] };
    if (u.pathname === "/.well-known/oauth-protected-resource") return { authorization_servers: ["https://auth.example.com"] };
    if (u.pathname === "/.well-known/oauth-authorization-server") return { issuer: "https://auth.example.com", authorization_endpoint: "https://auth.example.com/authorize", token_endpoint: "https://auth.example.com/token", pushed_authorization_request_endpoint: "https://auth.example.com/par" };
    if (u.pathname === "/par") return i.headers?.DPoP && seg(i.headers.DPoP, 1).nonce ? { request_uri: "urn:ietf:params:oauth:request_uri:abc", expires_in: 60 } : ok({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "nonce-1" });
    if (u.pathname === "/token") {
      if (!(i.headers?.DPoP && seg(i.headers.DPoP, 1).nonce)) return ok({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "nonce-2" });
      return b.grant_type === "refresh_token"
        ? { access_token: "acc2", refresh_token: "ref2", token_type: "DPoP", expires_in: 3600, scope: "atproto transition:generic" }
        : { access_token: "acc1", refresh_token: "ref1", token_type: "DPoP", expires_in: 3600, sub: DID, scope: "atproto transition:generic" };
    }
    if (u.pathname === "/xrpc/app.bsky.actor.getProfile") return { did: DID, handle: "roofer.bsky.social", avatar: "https://cdn.bsky.app/a.jpg" };
    if (u.pathname === "/xrpc/com.atproto.repo.createRecord") return i.headers?.DPoP && seg(i.headers.DPoP, 1).nonce ? { uri: `at://${DID}/app.bsky.feed.post/3kqr`, cid: "bafy" } : ok({ error: "use_dpop_nonce" }, 401, { "DPoP-Nonce": "pds-nonce" });
    if (u.pathname === "/xrpc/com.atproto.repo.uploadBlob") return { blob: { $type: "blob", ref: { $link: "bafyimg" }, mimeType: "image/png", size: 1 } };
    throw new Error(`unexpected ${u.href}`);
  });
}

const TEST_JWK = { set: async () => {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const j: any = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
  j.kid = "testkid"; process.env.SOCIAL_BLUESKY_JWK = JSON.stringify(j); process.env.APP_URL = "https://constructhub.us";
}};

describe("Bluesky OAuth — config, client metadata, jwks", () => {
  beforeAll(() => TEST_JWK.set());
  it("is configured only with a valid ES256 private JWK", () => {
    expect(blueskyOauthConfigured()).toBe(true);
    expect(blueskyOauthConfigured({ SOCIAL_BLUESKY_JWK: "" } as any)).toBe(false);
    expect(blueskyOauthConfigured({ SOCIAL_BLUESKY_JWK: '{"kty":"RSA"}' } as any)).toBe(false);
  });
  it("publishes a client-metadata document whose client_id is its own URL, and a public-only JWKS", () => {
    const m = blueskyClientMetadata();
    expect(m.client_id).toBe("https://constructhub.us/api/social/bluesky/client-metadata.json");
    expect(m.client_id).toBe(blueskyClientId());
    expect(m).toMatchObject({ token_endpoint_auth_method: "private_key_jwt", dpop_bound_access_tokens: true, scope: "atproto transition:generic", redirect_uris: ["https://constructhub.us/api/social/bluesky/callback"], grant_types: ["authorization_code", "refresh_token"] });
    const jwks = blueskyJwks();
    expect(jwks.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", kid: "testkid", use: "sig", alg: "ES256" });
    expect(jwks.keys[0].d).toBeUndefined();   // never expose the private half
  });
});

describe("Bluesky OAuth — sign-in, token, refresh, publish", () => {
  beforeAll(() => TEST_JWK.set());

  it("discovers the account's server, pushes the request with PKCE + client assertion + DPoP, and returns the approve URL", async () => {
    const calls = bsky();
    const { authUrl, pending } = await blueskyAuthorizeUrl("@Roofer.bsky.social");
    expect(authUrl.startsWith("https://auth.example.com/authorize?")).toBe(true);
    const au = new URL(authUrl);
    expect(au.searchParams.get("client_id")).toBe(blueskyClientId());
    expect(au.searchParams.get("request_uri")).toBe("urn:ietf:params:oauth:request_uri:abc");
    expect(pending.token_endpoint).toBe("https://auth.example.com/token");
    const par = calls.filter((c) => c.url.pathname === "/par");
    expect(par).toHaveLength(2);                                   // first 400 use_dpop_nonce, then retried with the nonce
    expect(par[0].body).toMatchObject({ response_type: "code", code_challenge_method: "S256", scope: "atproto transition:generic", login_hint: "roofer.bsky.social", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" });
    expect(par[0].body.code_challenge).toMatch(/^[\w-]{20,}$/);
    const dpop = seg(par[1].init.headers.DPoP, 1), dh = seg(par[1].init.headers.DPoP, 0);
    expect(dh).toMatchObject({ typ: "dpop+jwt", alg: "ES256" });
    expect(dh.jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(dh.jwk.d).toBeUndefined();                             // DPoP header carries only the public key
    expect(dpop).toMatchObject({ htm: "POST", htu: "https://auth.example.com/par", nonce: "nonce-1" });
    const assertion = seg(par[0].body.client_assertion, 1);
    expect(assertion).toMatchObject({ iss: blueskyClientId(), sub: blueskyClientId(), aud: "https://auth.example.com" });
  });

  it("exchanges the code for DPoP-bound tokens and reads who signed in", async () => {
    bsky();
    const { pending } = await blueskyAuthorizeUrl("roofer.bsky.social");
    const ex = await blueskyExchange(pending, "auth-code");
    expect(ex).toMatchObject({ externalId: DID, name: "@roofer.bsky.social", picture: "https://cdn.bsky.app/a.jpg", token: "acc1", refresh: "ref1", tokenEndpoint: "https://auth.example.com/token", pds: "https://pds.example.com" });
    expect(ex.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    expect(ex.dpopPriv.d).toBeTruthy();                          // the per-connection DPoP private key is kept for publishing
  });

  it("refreshes with the client assertion + DPoP and rotates the refresh token", async () => {
    bsky();
    const now = Date.now(); netDeps.now = () => now;
    expect(oauthNeedsRefresh(new Date(now + 2 * 60_000))).toBe(true);
    expect(oauthNeedsRefresh(new Date(now + 60 * 60_000))).toBe(false);
    const dpop = await newDpopKey();
    const f = await blueskyOauthRefresh({ accessToken: "acc1", refresh: "ref1", dpop, tokenEndpoint: "https://auth.example.com/token", pds: "https://pds.example.com", did: DID, expiresAt: new Date(now) });
    expect(f).toMatchObject({ accessToken: "acc2", refresh: "ref2" });
    await expect(blueskyOauthRefresh({ accessToken: "a", refresh: null, dpop, tokenEndpoint: "https://auth.example.com/token", pds: "https://pds.example.com", did: DID, expiresAt: null })).rejects.toMatchObject({ reconnect: true });
  });

  it("publishes a post against the PDS with a DPoP-bound Authorization and the access-token hash, published at once", async () => {
    const calls = bsky();
    const dpop = await newDpopKey();
    const p = await blueskyOauthPublish({ accessToken: "acc1", refresh: "ref1", dpop, tokenEndpoint: "https://auth.example.com/token", pds: "https://pds.example.com", did: DID, expiresAt: new Date(Date.now() + 3_600_000) }, "New roof #Roofing https://constructhub.us", [], "@roofer.bsky.social");
    expect(p).toEqual({ stage: "published", external: `at://${DID}/app.bsky.feed.post/3kqr`, url: "https://bsky.app/profile/roofer.bsky.social/post/3kqr" });
    const create = calls.filter((c) => c.url.pathname === "/xrpc/com.atproto.repo.createRecord");
    expect(create).toHaveLength(2);                              // 401 use_dpop_nonce, then retried with the PDS nonce
    expect(create[1].init.headers.Authorization).toBe("DPoP acc1");
    const proof = seg(create[1].init.headers.DPoP, 1);
    expect(proof).toMatchObject({ htm: "POST", htu: "https://pds.example.com/xrpc/com.atproto.repo.createRecord", nonce: "pds-nonce" });
    expect(proof.ath).toMatch(/^[\w-]{20,}$/);                   // SHA-256 of the access token binds the proof to it
    expect(create[1].body.record).toMatchObject({ $type: "app.bsky.feed.post", text: "New roof #Roofing https://constructhub.us" });
    expect(create[1].body.record.facets.map((f: any) => f.features[0].$type)).toEqual(["app.bsky.richtext.facet#tag", "app.bsky.richtext.facet#link"]);
  });
});
