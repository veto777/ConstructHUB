/**
 * Google Ads / Local Services Ads (LSA) connection layer.
 *
 * Auth model: OAuth2 (user clicks "Connect Google Ads" in admin). The app's
 * client ID/secret + developer token live in env secrets; the per-user refresh
 * token is stored in the `google_ads_config` DB table (single row). Access
 * tokens are minted on demand from the refresh token.
 *
 * All Google calls (OAuth authorize URL, code exchange, refresh-token, and the
 * LSA query via googleAds:search + GAQL) use Node's built-in global fetch().
 * We intentionally do NOT use `googleapis`/`google-auth-library` here: under tsx
 * that path pulls in node-fetch v3 -> data-uri-to-buffer and crashes at runtime.
 *
 * Mirrors the GSC client's `isConfigured()` dormant pattern so cron/UI degrade
 * gracefully when credentials are missing.
 */
import { db } from "../db";
import { googleAdsConfig, type GoogleAdsConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

// MCC (manager) account that owns the LSA account. Digits only, no dashes.
export const LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "1142738633").replace(/\D/g, "");
// Google Ads API version — overridable via env so we can bump without code edits.
export const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v22";
const SCOPES = ["https://www.googleapis.com/auth/adwords"];

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

/** Build the redirect URI from the incoming request host (must match a URI registered in Google Cloud). */
export function getRedirectUri(host: string): string {
  return `https://${host}/api/admin/google-ads/oauth/callback`;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

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

/* ----------------------- token / config persistence ----------------------- */

export async function loadConfig(): Promise<GoogleAdsConfig | undefined> {
  const rows = await db.select().from(googleAdsConfig).limit(1);
  return rows[0];
}

export async function saveRefreshToken(refreshToken: string): Promise<void> {
  const existing = await loadConfig();
  if (existing) {
    await db.update(googleAdsConfig)
      .set({ refreshToken, loginCustomerId: LOGIN_CUSTOMER_ID, lastSyncError: null, updatedAt: new Date() })
      .where(eq(googleAdsConfig.id, existing.id));
  } else {
    await db.insert(googleAdsConfig).values({ refreshToken, loginCustomerId: LOGIN_CUSTOMER_ID });
  }
}

export async function isConnected(): Promise<boolean> {
  const c = await loadConfig();
  return Boolean(c?.refreshToken);
}

async function getAccessToken(): Promise<string> {
  const c = await loadConfig();
  if (!c?.refreshToken) throw new GoogleAdsConfigError("Not connected to Google Ads — click Connect first.");
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new GoogleAdsConfigError(`Could not refresh Google access token (re-connect may be required): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as TokenResponse;
  if (!data.access_token) throw new GoogleAdsConfigError("Google did not return an access token (re-connect may be required).");
  return data.access_token;
}

/**
 * Every account this OAuth user can reach DIRECTLY (digits-only ids). The real
 * LSA account is often NOT under our MCC — it shows up here instead, so this is
 * the authoritative starting point for finding where leads live.
 */
export async function listAccessibleCustomers(): Promise<string[]> {
  const accessToken = await getAccessToken();
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
export async function gaqlSearch(customerId: string, query: string, loginCustomerId?: string): Promise<any[]> {
  const accessToken = await getAccessToken();
  const cid = String(customerId).replace(/\D/g, "");
  // Login context for this query. For directly-accessible accounts (e.g. an LSA
  // account that is NOT under our MCC) the account must log in as itself, so we
  // default the login-customer-id to the account being queried.
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
  customerId: string,
  path: string,
  body: unknown,
  loginCustomerId?: string,
): Promise<any> {
  const accessToken = await getAccessToken();
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
