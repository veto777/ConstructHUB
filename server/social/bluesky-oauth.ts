/**
 * Bluesky "Sign in with Bluesky" — AT Protocol OAuth, the agency connect flow (like Meta / TikTok's button), with no
 * app registration and no review: the client is identified by a metadata document we host, the customer signs in on
 * their own Bluesky server and authorizes ConstructHUB. Confidential client (private_key_jwt) + DPoP-bound tokens.
 *
 *   client_id     = <APP_URL>/api/social/bluesky/client-metadata.json   (this URL IS the registration)
 *   redirect_uri  = <APP_URL>/api/social/bluesky/callback
 *   app key       = SOCIAL_BLUESKY_JWK (one ES256 private JWK; its public half is published at jwks.json)
 *
 * The app-password path (server/social/native-nets.ts) stays as a fallback; this is the self-serve agency path. The
 * pure post-planners (blueskyPlan / blueskyFacets / blueskyImage) are shared; only the HTTP differs (DPoP, not bearer).
 */
import { randomUUID, createHash, webcrypto } from "node:crypto";
import { SocialError } from "./client";
import { blueskyPds, blueskyPlan, blueskyFacets, blueskyImage, blueskyHandle, type Signed, type Plan, netDeps } from "./native-nets";

const { subtle } = webcrypto;
const te = new TextEncoder();
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const b64urlBytes = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(netDeps.now() / 1000);

const appBase = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/$/, "");
export const blueskyClientId = () => `${appBase()}/api/social/bluesky/client-metadata.json`;
export const blueskyRedirectUri = () => `${appBase()}/api/social/bluesky/callback`;
/** atproto (required) + transition:generic (read + write records, the posting permission as of 2026). */
export const BLUESKY_OAUTH_SCOPE = "atproto transition:generic";

/** Is the agency OAuth flow configured? (an ES256 private JWK in SOCIAL_BLUESKY_JWK). Pure on env. */
export function blueskyOauthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.SOCIAL_BLUESKY_JWK ?? "").trim();
  if (!raw) return false;
  try { const j = JSON.parse(raw); return j.kty === "EC" && j.crv === "P-256" && typeof j.d === "string" && typeof j.kid === "string"; } catch { return false; }
}
function appJwk(env: NodeJS.ProcessEnv = process.env): any {
  if (!blueskyOauthConfigured(env)) throw new SocialError("Bluesky sign-in isn't configured on the server", 503);
  return JSON.parse((env.SOCIAL_BLUESKY_JWK as string).trim());
}
const publicPart = (jwk: any) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });

/** The public half of the app key, served at jwks.json and named by the client metadata. */
export function blueskyJwks(env: NodeJS.ProcessEnv = process.env): { keys: any[] } {
  const j = appJwk(env);
  return { keys: [{ ...publicPart(j), kid: j.kid, use: "sig", alg: "ES256", key_ops: ["verify"] }] };
}
/** The client-metadata document — hosting it at client_id is the whole "app registration" for AT Protocol OAuth. */
export function blueskyClientMetadata(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    client_id: blueskyClientId(), application_type: "web", client_name: "ConstructHUB",
    client_uri: appBase(), policy_uri: `${appBase()}/privacy`, tos_uri: `${appBase()}/terms`,
    logo_uri: `${appBase()}/icon-512.png`,
    redirect_uris: [blueskyRedirectUri()], scope: BLUESKY_OAUTH_SCOPE,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "ES256",
    dpop_bound_access_tokens: true, jwks_uri: `${appBase()}/api/social/bluesky/jwks.json`,
    // Only the public half of appJwk is referenced here; the private key never leaves the server.
    ...(blueskyOauthConfigured(env) ? {} : {}),
  };
}

// ── signing ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function es256(header: object, payload: object, privJwk: any): Promise<string> {
  const key = await subtle.importKey("jwk", privJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(data));
  return `${data}.${b64urlBytes(new Uint8Array(sig))}`;
}
/** A per-connection DPoP keypair (never the app key): proves the client holds the key the tokens are bound to. */
export async function newDpopKey(): Promise<{ priv: any; pub: any }> {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  const pub = publicPart(priv);
  return { priv, pub };
}
async function dpopProof(dpop: { priv: any; pub: any }, htm: string, htu: string, opt: { nonce?: string; accessToken?: string } = {}): Promise<string> {
  const payload: Record<string, unknown> = { jti: randomUUID(), htm, htu: htu.split("#")[0].split("?")[0], iat: now() };
  if (opt.nonce) payload.nonce = opt.nonce;
  if (opt.accessToken) payload.ath = sha256(opt.accessToken);
  return es256({ typ: "dpop+jwt", alg: "ES256", jwk: dpop.pub }, payload, dpop.priv);
}
async function clientAssertion(audience: string): Promise<string> {
  const j = appJwk();
  const cid = blueskyClientId();
  return es256({ alg: "ES256", kid: j.kid }, { iss: cid, sub: cid, aud: audience, jti: randomUUID(), iat: now(), exp: now() + 300 }, j);
}

// ── HTTP with the DPoP nonce retry ───────────────────────────────────────────────────────────────────────────────
async function http(url: string, init: RequestInit): Promise<Response> {
  try { return await netDeps.http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new SocialError("Bluesky didn't answer; try again", 502); }
}
/** The server hands out a DPoP nonce and expects the next proof to carry it; the first try without it is normal. */
async function withDpop(dpop: { priv: any; pub: any }, htm: string, url: string, send: (dpopHeader: string) => Promise<Response>, accessToken?: string): Promise<Response> {
  let nonce: string | undefined;
  for (let i = 0; i < 2; i++) {
    const proof = await dpopProof(dpop, htm, url, { nonce, accessToken });
    const r = await send(proof);
    const fresh = r.headers.get("DPoP-Nonce");
    if ((r.status === 400 || r.status === 401) && fresh && fresh !== nonce) {
      const body = await r.clone().json().catch(() => null);
      if (i === 0 && (body?.error === "use_dpop_nonce" || !nonce)) { nonce = fresh; continue; }
    }
    return r;
  }
  throw new SocialError("Bluesky kept asking to retry the request", 502);
}

// ── discovery: handle → DID → PDS → authorization server → its endpoints ─────────────────────────────────────────
async function resolveHandle(handle: string): Promise<string> {
  const r = await http(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { method: "GET" });
  const d = await r.json().catch(() => null);
  if (!r.ok || typeof d?.did !== "string") throw new SocialError("Bluesky doesn't know that handle. Check the spelling.", 400);
  return d.did;
}
type AuthMeta = { issuer: string; authorization_endpoint: string; token_endpoint: string; pushed_authorization_request_endpoint: string };
async function authServerFor(pds: string): Promise<AuthMeta> {
  const pr = await (await http(`${pds}/.well-known/oauth-protected-resource`, { method: "GET" })).json().catch(() => null);
  const issuer = Array.isArray(pr?.authorization_servers) ? pr.authorization_servers[0] : null;
  if (typeof issuer !== "string" || !/^https:\/\//.test(issuer)) throw new SocialError("Bluesky didn't advertise a sign-in server for that account", 502);
  const m = await (await http(`${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, { method: "GET" })).json().catch(() => null);
  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "pushed_authorization_request_endpoint"]) {
    if (typeof m?.[k] !== "string" || !/^https:\/\//.test(m[k])) throw new SocialError("Bluesky's sign-in server metadata was incomplete", 502);
  }
  return m as AuthMeta;
}

export type PendingBsky = { state: string; verifier: string; dpop: { priv: any; pub: any }; token_endpoint: string; par_issuer: string; expires: number };
/**
 * Start a sign-in: resolve where the account lives, push the authorization request (PAR) with PKCE + a client
 * assertion + DPoP, and return the URL to send the browser to, plus the pending state to keep in the session.
 */
export async function blueskyAuthorizeUrl(handleInput: string): Promise<{ authUrl: string; pending: PendingBsky }> {
  const handle = blueskyHandle(handleInput);
  const did = await resolveHandle(handle);
  const pds = await blueskyPds(did);
  const meta = await authServerFor(pds);
  const dpop = await newDpopKey();
  const verifier = b64urlBytes(webcrypto.getRandomValues(new Uint8Array(32)));
  const challenge = sha256(verifier);
  const state = b64urlBytes(webcrypto.getRandomValues(new Uint8Array(24)));
  const form = {
    response_type: "code", client_id: blueskyClientId(), redirect_uri: blueskyRedirectUri(),
    scope: BLUESKY_OAUTH_SCOPE, state, code_challenge: challenge, code_challenge_method: "S256", login_hint: handle,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await clientAssertion(meta.issuer),
  };
  const r = await withDpop(dpop, "POST", meta.pushed_authorization_request_endpoint, (dpopHeader) =>
    http(meta.pushed_authorization_request_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", DPoP: dpopHeader }, body: new URLSearchParams(form) }));
  const d = await r.json().catch(() => null);
  if (!r.ok || typeof d?.request_uri !== "string") throw new SocialError(`Bluesky wouldn't start the sign-in${d?.error ? `: ${String(d.error_description || d.error).slice(0, 160)}` : ""}`, 502);
  const authUrl = `${meta.authorization_endpoint}?client_id=${encodeURIComponent(blueskyClientId())}&request_uri=${encodeURIComponent(d.request_uri)}`;
  return { authUrl, pending: { state, verifier, dpop, token_endpoint: meta.token_endpoint, par_issuer: meta.issuer, expires: netDeps.now() + 10 * 60_000 } };
}

/** Back from Bluesky: exchange the code for DPoP-bound tokens and read who signed in. */
export async function blueskyExchange(pending: PendingBsky, code: string): Promise<Signed & { dpopPriv: any; dpopPub: any; tokenEndpoint: string; pds: string }> {
  const form = {
    grant_type: "authorization_code", code, redirect_uri: blueskyRedirectUri(), client_id: blueskyClientId(), code_verifier: pending.verifier,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await clientAssertion(pending.par_issuer),
  };
  const r = await withDpop(pending.dpop, "POST", pending.token_endpoint, (dpopHeader) =>
    http(pending.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", DPoP: dpopHeader }, body: new URLSearchParams(form) }));
  const d = await r.json().catch(() => null);
  if (!r.ok || typeof d?.access_token !== "string" || typeof d?.sub !== "string") throw new SocialError(`Bluesky wouldn't finish the sign-in${d?.error ? `: ${String(d.error_description || d.error).slice(0, 160)}` : ""}`, 502);
  const did = d.sub as string;
  const pds = await blueskyPds(did);
  const profile = await pdsCall(did, d.access_token, pending.dpop, pds, "GET", "app.bsky.actor.getProfile", { actor: did }).catch(() => ({}));
  const handle = typeof profile.handle === "string" && profile.handle ? profile.handle : did;
  return {
    externalId: did, name: `@${handle}`, picture: typeof profile.avatar === "string" ? profile.avatar : null,
    token: d.access_token, expiresAt: new Date(netDeps.now() + (Number(d.expires_in) || 3600) * 1000),
    refresh: typeof d.refresh_token === "string" ? d.refresh_token : null, scopes: String(d.scope ?? BLUESKY_OAUTH_SCOPE).split(" ").filter(Boolean),
    dpopPriv: pending.dpop.priv, dpopPub: pending.dpop.pub, tokenEndpoint: pending.token_endpoint, pds,
  };
}

export type OauthSession = { accessToken: string; refresh: string | null; dpop: { priv: any; pub: any }; tokenEndpoint: string; pds: string; did: string; expiresAt: Date | null };
/** A fresh access token (rotates the refresh token too). Bluesky OAuth tokens are short; refresh within 5 minutes of expiry. */
export function oauthNeedsRefresh(expiresAt: Date | null): boolean { return !!expiresAt && expiresAt.getTime() - netDeps.now() < 5 * 60_000; }
export async function blueskyOauthRefresh(s: OauthSession): Promise<{ accessToken: string; refresh: string | null; expiresAt: Date }> {
  if (!s.refresh) throw reconnect();
  const issuer = new URL(s.tokenEndpoint).origin;
  const form = {
    grant_type: "refresh_token", refresh_token: s.refresh, client_id: blueskyClientId(),
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await clientAssertion(issuer),
  };
  const r = await withDpop(s.dpop, "POST", s.tokenEndpoint, (dpopHeader) =>
    http(s.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", DPoP: dpopHeader }, body: new URLSearchParams(form) }));
  const d = await r.json().catch(() => null);
  if (!r.ok || typeof d?.access_token !== "string") { if (r.status === 400 || r.status === 401) throw reconnect(); throw new SocialError("Bluesky wouldn't refresh the sign-in", 502); }
  return { accessToken: d.access_token, refresh: typeof d.refresh_token === "string" ? d.refresh_token : s.refresh, expiresAt: new Date(netDeps.now() + (Number(d.expires_in) || 3600) * 1000) };
}

function reconnect(): SocialError { const e = new SocialError("This Bluesky sign-in has expired or was removed; reconnect it under Connected accounts", 409); (e as any).reconnect = true; return e; }

// ── DPoP-authenticated calls to the account's PDS (publishing) ───────────────────────────────────────────────────
async function pdsCall(did: string, accessToken: string, dpop: { priv: any; pub: any }, pds: string, method: string, nsid: string, params?: Record<string, string>, body?: { json?: unknown; bytes?: Uint8Array; contentType?: string }): Promise<any> {
  const url = `${pds.replace(/\/$/, "")}/xrpc/${nsid}${params ? `?${new URLSearchParams(params)}` : ""}`;
  const r = await withDpop(dpop, method, url, (dpopHeader) => {
    const headers: Record<string, string> = { Authorization: `DPoP ${accessToken}`, DPoP: dpopHeader };
    let payload: BodyInit | undefined;
    if (body?.json !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body.json); }
    else if (body?.bytes) { headers["Content-Type"] = body.contentType ?? "application/octet-stream"; payload = body.bytes as BodyInit; }
    return http(url, { method, headers, body: payload });
  }, accessToken);
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const code = String(d?.error ?? "");
    if (r.status === 401 || ["ExpiredToken", "InvalidToken", "AuthenticationRequired"].includes(code)) throw reconnect();
    if (r.status === 429) throw new SocialError("Bluesky is limiting how fast we post; it will retry shortly", 429);
    throw new SocialError(d?.message ? `Bluesky refused it: ${String(d.message).slice(0, 180)}` : "Bluesky refused the request", r.status >= 500 ? 502 : 400);
  }
  if (!d || typeof d !== "object") throw new SocialError("Bluesky sent an unreadable answer", 502);
  return d;
}

/** Publish one post through the OAuth session (DPoP): text + facets, up to four photos, or one video. */
export async function blueskyOauthPublish(s: OauthSession, text: string, media: string[], handle: string): Promise<Plan> {
  const plan = blueskyPlan(text, media);
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text: text.normalize("NFC"), createdAt: new Date(netDeps.now()).toISOString() };
  const facets = await blueskyFacets(record.text as string);
  if (facets.length) record.facets = facets;
  if (plan.kind === "images") {
    const images: any[] = [];
    for (const url of plan.urls) {
      const img = await blueskyImage(await fetchPublic(url, 50 * 1024 * 1024, "photo"));
      const d = await pdsCall(s.did, s.accessToken, s.dpop, s.pds, "POST", "com.atproto.repo.uploadBlob", undefined, { bytes: img.bytes, contentType: img.type });
      if (!d.blob) throw new SocialError("Bluesky did not confirm the photo upload", 502);
      images.push({ image: d.blob, alt: "", aspectRatio: { width: img.width, height: img.height } });
    }
    record.embed = { $type: "app.bsky.embed.images", images };
  }
  if (plan.kind === "video") record.embed = await uploadVideo(s, plan.url);
  const d = await pdsCall(s.did, s.accessToken, s.dpop, s.pds, "POST", "com.atproto.repo.createRecord", undefined, { json: { repo: s.did, collection: "app.bsky.feed.post", record } });
  if (typeof d.uri !== "string") throw new SocialError("Bluesky did not confirm the post; check the account before posting again", 502);
  const rkey = d.uri.split("/").pop();
  return { stage: "published", external: d.uri, url: handle && rkey ? `https://bsky.app/profile/${handle.replace(/^@/, "")}/post/${rkey}` : null };
}
export async function blueskyOauthDelete(s: OauthSession, uri: string): Promise<void> {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([\w.:~-]+)$/.exec(uri);
  if (!m) throw new SocialError("That isn't a Bluesky post", 400);
  await pdsCall(s.did, s.accessToken, s.dpop, s.pds, "POST", "com.atproto.repo.deleteRecord", undefined, { json: { repo: s.did, collection: "app.bsky.feed.post", rkey: m[2] } });
}
async function uploadVideo(s: OauthSession, url: string) {
  const file = await fetchPublic(url, 100 * 1024 * 1024, "video");
  const aud = `did:web:${new URL(s.pds).host}`;
  const auth = await pdsCall(s.did, s.accessToken, s.dpop, s.pds, "GET", "com.atproto.server.getServiceAuth", { aud, lxm: "com.atproto.repo.uploadBlob", exp: String(now() + 30 * 60) });
  if (typeof auth.token !== "string") throw new SocialError("Bluesky did not allow the video upload", 502);
  let job = await (await http(`https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?${new URLSearchParams({ did: s.did, name: `video-${netDeps.now()}.mp4` })}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": /\.mov(?:\?|$)/i.test(url) ? "video/quicktime" : "video/mp4" }, body: new Uint8Array(file) as BodyInit })).json().catch(() => null);
  for (let i = 0; job && !job.blob && (job.jobStatus?.state ?? job.state) !== "JOB_STATE_COMPLETED"; i++) {
    const st = job.jobStatus ?? job;
    if (st.state === "JOB_STATE_FAILED") throw new SocialError("Bluesky couldn't process the video");
    if (st.blob) { job = st; break; }
    if (i >= 90) throw new SocialError("Bluesky took too long to process the video", 502);
    await netDeps.sleep(3000);
    job = await (await http(`https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?${new URLSearchParams({ jobId: String(st.jobId ?? job.jobId) })}`, { method: "GET", headers: { Authorization: `Bearer ${auth.token}` } })).json().catch(() => null);
  }
  const blob = job?.blob ?? job?.jobStatus?.blob;
  if (!blob) throw new SocialError("Bluesky did not return the processed video", 502);
  return { $type: "app.bsky.embed.video", video: blob };
}
async function fetchPublic(url: string, max: number, what: string): Promise<Buffer> {
  try {
    const r = await netDeps.mediaHttp(url);
    if (!r.ok) throw new Error("download failed");
    const file = Buffer.from(await r.arrayBuffer());
    if (!file.length || file.length > max) throw new Error("size");
    return file;
  } catch { throw new SocialError(`Bluesky couldn't read the ${what}; use a public HTTPS file under ${Math.round(max / 1024 / 1024)} MB`, 400); }
}
