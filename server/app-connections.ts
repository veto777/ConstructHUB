import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db, pool } from "./db";
import { fromNativeApp, safeNextPath } from "./app-shell";
import { appAuthHost, mintAppCode } from "./app-auth";
import { rateLimit } from "./growth-limits";

/** Only these callback paths may use a state-bound, request-local identity. */
export const APP_CONNECTIONS = {
  gbp: { callback: "/api/gbp/callback", fields: ["gbpOAuth"] },
  ads: { callback: "/api/ads/callback", fields: ["adsOAuth"] },
  gsc: { callback: "/api/gsc/callback", fields: ["gscOAuth"] },
  gmail: { callback: "/api/mail-alerts/oauth/callback", fields: ["mailOAuth"] },
  lsa: { callback: "/api/lsa/oauth/callback", fields: ["lsaOauthState", "lsaAppRedirect"] },
  calendar: { callback: "/api/crm/calendar/google/callback", fields: ["googleCalendarState", "googleCalendarOrgId", "googleCalendarScope", "googleCalendarMemberId"] },
} as const;
type Purpose = keyof typeof APP_CONNECTIONS;
export async function ensureAppConnectionsSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_oauth_states (
    state text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose text NOT NULL, host text NOT NULL, next text NOT NULL,
    payload jsonb NOT NULL, google_url text NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
  ); CREATE INDEX IF NOT EXISTS app_oauth_states_expiry ON app_oauth_states(expires_at);`);
}

/** Called AFTER each start's auth, recent-auth, entitlement and input checks. */
export async function appConnectUrl(req: Request, purpose: Purpose, googleUrl: string, next: string): Promise<string> {
  if (!fromNativeApp(req)) return googleUrl;
  if (!req.user) throw new Error("Connection requires authentication");
  const url = new URL(googleUrl), originalState = url.searchParams.get("state");
  if (url.origin !== "https://accounts.google.com" || !originalState) throw new Error("Invalid consent URL");
  const state = `app.${originalState}`;
  url.searchParams.set("state", state);
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  if (callback.hostname !== appAuthHost(req) || callback.pathname !== APP_CONNECTIONS[purpose].callback) throw new Error("Connection callback must use the app's host");
  const payload: Record<string, unknown> = {};
  // Preserve the selected organization/workspace, never passport or recentAuth.
  for (const key of [...APP_CONNECTIONS[purpose].fields, "activeOrgId", "agencyOwner"]) {
    const value = (req.session as any)[key];
    if (value !== undefined) payload[key] = value === originalState ? state
      : value && typeof value === "object" && value.state === originalState ? { ...value, state } : value;
  }
  await pool.query("INSERT INTO app_oauth_states(state,user_id,purpose,host,next,payload,google_url) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [state, req.user.id, purpose, appAuthHost(req), safeNextPath(next) ?? "/", payload, url.toString()]);
  for (const key of APP_CONNECTIONS[purpose].fields) delete (req.session as any)[key];
  // A real GET navigation in WKWebView, including for POST-based Ads starts.
  // The shell then intercepts the redirect to Google and opens the auth sheet.
  return `/api/app/oauth/open?state=${encodeURIComponent(state)}`;
}

export async function finishAppConnection(req: Request, res: Response, next: string) {
  const connection = res.locals?.appConnection as { user_id: number; host: string; next: string } | undefined;
  if (!connection) return res.redirect(next);
  const code = await mintAppCode(connection.user_id, connection.host, "redirect", safeNextPath(next) ?? connection.next);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  return res.redirect(`constructhub://auth-done?code=${code}`);
}

export function registerAppConnections(app: Express) {
  app.get("/api/app/oauth/open", rateLimit("app-oauth-open", 30, 60), async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    if (typeof req.query.state !== "string" || req.query.state.length > 256) return res.sendStatus(400);
    const { rows: [row] } = await pool.query("SELECT google_url FROM app_oauth_states WHERE state=$1 AND user_id=$2 AND host=$3 AND expires_at>now()",
      [req.query.state, req.user.id, appAuthHost(req)]);
    if (!row) return res.status(400).json({ message: "Connection expired. Please start again." });
    res.redirect(row.google_url);
  });
  // Runs before the normal module/agency/org gates, which still authorize this
  // exact callback. Does NOT call login or put passport in the sheet's session.
  app.use(async (req, res, next) => {
    const entry = Object.entries(APP_CONNECTIONS).find(([, value]) => value.callback === req.path);
    if (req.method !== "GET" || !entry || typeof req.query.state !== "string" || req.query.state.length > 256) return next();
    try {
      const { rows: [row] } = await pool.query("DELETE FROM app_oauth_states WHERE state=$1 AND purpose=$2 AND host=$3 AND expires_at>now() RETURNING *",
        [req.query.state, entry[0], appAuthHost(req)]);
      if (!row) {
        if (req.query.state.startsWith("app.")) return res.status(400).json({ message: "Invalid or expired app connection" });
        return next();
      }
      const [user] = await db.select().from(users).where(eq(users.id, row.user_id));
      if (!user) return res.sendStatus(401);
      req.user = user;
      // Only restore keys from this provider's explicit allowlist.
      for (const key of [...entry[1].fields, "activeOrgId", "agencyOwner"]) {
        delete (req.session as any)[key];
        if (row.payload[key] !== undefined) (req.session as any)[key] = row.payload[key];
      }
      res.locals.appConnection = row;
      next();
    } catch (err) { next(err); }
  });
}
