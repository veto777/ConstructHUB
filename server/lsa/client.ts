/**
 * Google Ads / Local Services Ads (LSA) connection layer — MULTI-TENANT.
 *
 * Auth model: OAuth2. The app's client ID/secret + developer token live in env
 * secrets and are shared by every tenant. Each ConstructHUB user OAuth-connects
 * their OWN Google Ads account; their refresh token is stored per-user in the
 * `lsa_connections` table. Access tokens are minted on demand from the refresh
 * token and cached in-memory keyed by refresh token.
 *
 * All Google calls use Node's built-in global fetch(). We intentionally do NOT
 * use `googleapis`/`google-auth-library`: under tsx that path pulls in
 * node-fetch v3 -> data-uri-to-buffer and crashes at runtime.
 *
 * Mirrors a dormant `isConfigured()` pattern so the feature degrades gracefully
 * when app credentials are missing.
 */

// Optional fallback MCC (manager) login context. Per-tenant we prefer the
// account's own discovered login id; this is only a last-resort default.
export const DEFAULT_LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
// Google Ads API version — overridable via env so we can bump without code edits.
export const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v22";
const SCOPES = ["https://www.googleapis.com/auth/adwords"];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class GoogleAdsConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = "GoogleAdsConfigError"; }
}

/** True when the app-level credentials exist (client id/secret + dev token). */
export function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  );
}

/**
 * The OAuth redirect URI is intentionally FIXED and decoupled from the incoming
 * request host. Google requires every redirect URI to be pre-registered in the
 * Cloud Console OAuth client; deriving it from the request host would mean every
 * preview/custom/tenant domain needs its own registration — a hard scaling
 * bottleneck. Instead we always send ONE canonical URI, so a single registration
 * covers every user and account forever.
 *
 * Resolution order:
 *   1. LSA_OAUTH_REDIRECT_URI — full callback URL (use this for local dev).
 *   2. LSA_PUBLIC_BASE_URL    — base origin; "/api/lsa/oauth/callback" appended.
 *   3. canonical production domain.
 */
export function getRedirectUri(): string {
  const explicit = process.env.LSA_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (process.env.LSA_PUBLIC_BASE_URL || "https://constructhub.us").trim().replace(/\/$/, "");
  return `${base}/api/lsa/oauth/callback`;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",   // required to receive a refresh token
    prompt: "consent",        // force refresh-token issuance every time
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text.slice(0, 400)}`);
  }
  return resp.json() as Promise<TokenResponse>;
}

/* ----------------------- access-token cache (per refresh token) ----------------------- */

interface CachedToken { token: string; exp: number; }
const tokenCache = new Map<string, CachedToken>();

/**
 * Mint (and cache) an access token for a given refresh token. Cached until ~60s
 * before expiry so thousands of accounts under the same connection reuse one
 * token instead of hammering the token endpoint.
 */
export async function getAccessToken(refreshToken: string | null | undefined): Promise<string> {
  if (!refreshToken) throw new GoogleAdsConfigError("Not connected to Google Ads — connect first.");
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.exp > Date.now()) return cached.token;

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new GoogleAdsConfigError(`Could not refresh Google access token (re-connect may be required): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as TokenResponse;
  if (!data.access_token) throw new GoogleAdsConfigError("Google did not return an access token (re-connect may be required).");
  const ttl = (data.expires_in ?? 3600) * 1000;
  tokenCache.set(refreshToken, { token: data.access_token, exp: Date.now() + ttl - 60_000 });
  return data.access_token;
}

/** Drop a cached token (e.g. after a refresh failure forces re-connect). */
export function clearAccessToken(refreshToken: string | null | undefined): void {
  if (refreshToken) tokenCache.delete(refreshToken);
}

/**
 * Every account this OAuth user can reach DIRECTLY (digits-only ids). The real
 * LSA account is often NOT under any MCC — it shows up here instead, so this is
 * the authoritative starting point for discovering where leads live.
 */
export async function listAccessibleCustomers(refreshToken: string): Promise<string[]> {
  const accessToken = await getAccessToken(refreshToken);
  const resp = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`listAccessibleCustomers ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const names: string[] = data.resourceNames || [];
  return names.map((n) => String(n).split("/").pop() || "").map((s) => s.replace(/\D/g, "")).filter(Boolean);
}

/* ----------------------------- Ads REST query ----------------------------- */

/**
 * Run a GAQL query against a specific customer account, following pagination.
 * `customerId` and the login-customer-id header are digits-only (no dashes).
 */
export async function gaqlSearch(
  refreshToken: string,
  customerId: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<any[]> {
  const accessToken = await getAccessToken(refreshToken);
  const cid = String(customerId).replace(/\D/g, "");
  // Login context for this query. For directly-accessible accounts the account
  // must log in as itself, so we default login-customer-id to the queried account.
  const loginCid = String(loginCustomerId || customerId).replace(/\D/g, "");
  const results: any[] = [];
  let pageToken: string | undefined;

  do {
    const resp = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${cid}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
        "login-customer-id": loginCid,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google Ads API ${resp.status} (customer ${cid}): ${text.slice(0, 600)}`);
    }

    const data: any = await resp.json();
    if (Array.isArray(data.results)) results.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

/**
 * POST to an arbitrary Google Ads REST endpoint path (e.g. a custom verb like
 * `:provideLeadFeedback`). `path` is everything after the API version, starting
 * with `customers/...`. Returns the parsed JSON; throws with Google's error text
 * on a non-2xx so callers can surface the real message.
 */
export async function adsPost(
  refreshToken: string,
  customerId: string,
  path: string,
  body: unknown,
  loginCustomerId?: string | null,
): Promise<any> {
  const accessToken = await getAccessToken(refreshToken);
  const loginCid = String(loginCustomerId || customerId).replace(/\D/g, "");
  const resp = await fetch(`https://googleads.googleapis.com/${API_VERSION}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
      "login-customer-id": loginCid,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Google Ads API ${resp.status}: ${text.slice(0, 800)}`);
  }
  return text ? JSON.parse(text) : {};
}
