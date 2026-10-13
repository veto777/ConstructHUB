/**
 * "Connect with Cloudflare": Cloudflare's own sign-in-and-allow (self-managed OAuth clients, opened to every
 * account in June 2026) instead of asking a customer to copy their Global API Key. The customer signs in at
 * Cloudflare, ticks which of their accounts ConstructHUB may see, and we keep a short-lived access token plus a
 * refresh token — the same shape as the Search Console grant (edge_connections, method 'oauth'). The Global-Key
 * and pasted-token paths stay as fallbacks.
 *
 * The client itself lives in the support@constructhub.us Cloudflare account (Manage Account → OAuth clients →
 * "ConstructHUB", client id 33ee0795…); its secret is env CLOUDFLARE_OAUTH_CLIENT_ID / _SECRET on the live
 * server. Cloudflare's endpoints: dash.cloudflare.com/.well-known/openid-configuration.
 */
import { pool } from "../db";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { CloudflareClient } from "./client";
import { ProviderError, queue } from "./common";

export const CLOUDFLARE_OAUTH = {
  auth: "https://dash.cloudflare.com/oauth2/auth",
  token: "https://dash.cloudflare.com/oauth2/token",
  revoke: "https://dash.cloudflare.com/oauth2/revoke",
} as const;

/**
 * What the ConstructHUB client asks for; the ids are Cloudflare's API-token permission names. The write scopes
 * (WAF, firewall rules, DNS, cache purge) are marked optional on the client, so Cloudflare's consent page lets a
 * customer grant read-only access. offline_access = a refresh token.
 */
export const CLOUDFLARE_OAUTH_SCOPES = [
  "zone.read", "zone-settings.read", "analytics.read", "zone-waf.read", "zone-waf.write",
  "firewall-services.read", "firewall-services.write", "dns.read", "cache.purge",
  "memberships.read", "user-details.read", "offline_access",
] as const;

export const cloudflareOAuthConfigured = (env: NodeJS.ProcessEnv = process.env) =>
  !!(env.CLOUDFLARE_OAUTH_CLIENT_ID && env.CLOUDFLARE_OAUTH_CLIENT_SECRET);

/** Where to send the customer: Cloudflare's consent page for our client, back to `redirect` with `state`. */
export function cloudflareConsentUrl(redirect: string, state: string, env: NodeJS.ProcessEnv = process.env): string {
  const q = new URLSearchParams({
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!,
    redirect_uri: redirect,
    response_type: "code",
    scope: CLOUDFLARE_OAUTH_SCOPES.join(" "),
    state,
  });
  return `${CLOUDFLARE_OAUTH.auth}?${q}`;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };

/** One call to the token endpoint (client_secret_post). Cloudflare's reply is never reflected to the browser. */
async function tokenRequest(form: Record<string, string>, http: typeof fetch, env: NodeJS.ProcessEnv): Promise<Tokens> {
  let r: Response, t: any;
  try {
    r = await http(CLOUDFLARE_OAUTH.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET!, ...form }),
      signal: AbortSignal.timeout(20000),
    });
    t = await r.json();
  } catch {
    throw new ProviderError("Cloudflare sign-in is unavailable right now; try again in a minute");
  }
  if (!r.ok || typeof t?.access_token !== "string" || !t.access_token)
    throw new ProviderError(form.grant_type === "refresh_token" ? "Reconnect Cloudflare" : "Cloudflare did not complete the sign-in", 401);
  return t as Tokens;
}

/** The consent code from the callback → tokens. */
export const exchangeCloudflareCode = (code: string, redirect: string, http: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect }, http, env);

/** The scopes Cloudflare actually granted (a customer can decline the optional ones), as stored in permissions. */
export const grantedScopes = (tokens: Tokens): string[] => {
  const given = String(tokens.scope ?? "").split(/\s+/).filter(Boolean);
  return (given.length ? given : [...CLOUDFLARE_OAUTH_SCOPES]).filter((s) => s !== "offline_access");
};

/**
 * Saves (or refreshes, on a reconnect) the grant as the user's Cloudflare connection, keyed by the Cloudflare
 * user it belongs to, and queues the zone discovery the worker runs for every new connection.
 */
export async function saveCloudflareGrant(user: number, tokens: Tokens, http: typeof fetch = fetch) {
  const who = (await new CloudflareClient({ token: tokens.access_token }, http).call("/user")).result;
  if (!/^[a-f0-9]{32}$/.test(String(who?.id ?? ""))) throw new ProviderError("Cloudflare sign-in did not identify the account", 400);
  const email = typeof who.email === "string" && who.email.includes("@") ? who.email.toLowerCase() : null;
  const permissions = grantedScopes(tokens);
  const {
    rows: [c],
  } = await pool.query(
    `INSERT INTO edge_connections(user_id,provider,subject,email,token,refresh_token,expires_at,method,permissions)
    VALUES($1,'cloudflare',$2,$3,$4,$5,$6,'oauth',$7) ON CONFLICT(user_id,provider,subject) DO UPDATE SET
    email=$3,token=$4,refresh_token=COALESCE($5,edge_connections.refresh_token),expires_at=$6,method='oauth',permissions=$7 RETURNING id`,
    [
      user,
      who.id,
      email,
      encryptToken(tokens.access_token),
      tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      JSON.stringify(permissions),
    ],
  );
  await queue(user, c.id, null, "discover");
  return { id: c.id as number, email, permissions };
}

/**
 * A live access token for an 'oauth' connection row, refreshed through the refresh token when it is within a
 * minute of expiring (compare-and-set on the row, as the Search Console grant does, so two workers never race).
 */
export async function cloudflareOAuthToken(c: any, http: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (c.token && c.expires_at && new Date(c.expires_at).getTime() > Date.now() + 60000) return decryptToken(c.token)!;
  if (!c.refresh_token) throw new ProviderError("Reconnect Cloudflare", 401);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptToken(c.refresh_token)! }, http, env);
  const expires = new Date(Date.now() + Number(t.expires_in || 3600) * 1000);
  const encryptedAccess = encryptToken(t.access_token),
    encryptedRefresh = t.refresh_token ? encryptToken(t.refresh_token) : null;
  const updated = await pool.query(
    "UPDATE edge_connections SET token=$1,expires_at=$2,refresh_token=COALESCE($3,refresh_token) WHERE id=$4 AND user_id=$5 AND refresh_token IS NOT DISTINCT FROM $6 AND token IS NOT DISTINCT FROM $7",
    [encryptedAccess, expires, encryptedRefresh, c.id, c.user_id, c.refresh_token, c.token],
  );
  if (!updated.rowCount) throw new ProviderError("Cloudflare connection changed; retry", 409);
  c.token = encryptedAccess;
  c.refresh_token = encryptedRefresh ?? c.refresh_token;
  c.expires_at = expires;
  return t.access_token;
}

/** Best effort on disconnect: tell Cloudflare the grant is over (the customer can also revoke it in their profile). */
export async function revokeCloudflareGrant(c: any, http: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const token = c.refresh_token ? decryptToken(c.refresh_token) : c.token ? decryptToken(c.token) : null;
  if (!token) return false;
  try {
    const r = await http(CLOUDFLARE_OAUTH.revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET!, token }),
      signal: AbortSignal.timeout(20000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
