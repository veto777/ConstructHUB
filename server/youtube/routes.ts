/**
 * The company YouTube channel connection (/admin/youtube). Platform admins
 * only — requirePlatformAdmin, the same gate as the rest of /api/admin:
 *
 *   GET  /api/admin/youtube/status       connected?, channel, scopes, last error, the redirect URI to register
 *   GET  /api/admin/youtube/connect      → Google consent (a browser navigation, not an XHR)
 *   GET  /api/admin/youtube/callback     ← Google; saves the connection or says why not, then → /admin/youtube
 *   POST /api/admin/youtube/disconnect   revoke at Google + delete everything stored
 *
 * Mirrors the Search Console connect (server/gsc/routes.ts): the same Google
 * OAuth client (GOOGLE_CLIENT_ID / _SECRET), the same redirect base
 * (oauthBaseUrl), a random one-time state kept in the admin's session, tokens
 * encrypted at rest. No response from these routes contains a token.
 */
import type { Express, Request, Response } from "express";
import { requirePlatformAdmin } from "../crm/admin";
import { originOk } from "../hub/access";
import { oauthBaseUrl } from "../site-context";
import {
  YoutubeError, completeConnect, consentUrl, expectedChannelId, newPendingState, oauthErrorCode, requestedScopes, revokeToken, stateMatches,
  type PendingState,
} from "./client";
import { deleteYoutubeConnection, recordYoutubeError, saveYoutubeConnection, youtubeRefreshTokenForRevoke, youtubeStatus } from "./store";
import type { Queryable } from "./schema";

declare module "express-session" {
  interface SessionData {
    youtubeOAuth?: PendingState;
  }
}

type GetUser = (req: any, res: any) => any;
export type YoutubeRouteOptions = { pool?: Queryable; http?: typeof fetch };

export const YOUTUBE_CALLBACK_PATH = "/api/admin/youtube/callback";
export const YOUTUBE_ADMIN_PAGE = "/admin/youtube";
/** The redirect URI Google must have on file — built exactly like the Search Console one. */
export const youtubeRedirectUri = (req: Request): string => `${oauthBaseUrl(req)}${YOUTUBE_CALLBACK_PATH}`;

const configured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export function registerYoutubeRoutes(app: Express, getUser: GetUser, opts: YoutubeRouteOptions = {}): void {
  const q = opts.pool, http = opts.http ?? fetch;
  const back = (res: Response, result: "connected" | "failed") => res.redirect(`${YOUTUBE_ADMIN_PAGE}?result=${result}`);
  const remember = async (code: string, message: string) => {
    try { await recordYoutubeError(code, message, q); } catch (e) { console.error("[youtube] could not save the last error:", (e as Error)?.message); }
  };

  app.get("/api/admin/youtube/status", async (req: Request, res: Response) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      res.json({
        ...(await youtubeStatus(q)),
        configured: configured(),
        expectedChannelId: expectedChannelId(),
        redirectUri: youtubeRedirectUri(req),
        requestedScopes: requestedScopes(),
      });
    } catch (e) {
      console.error("[youtube] status failed:", (e as Error)?.message);
      res.status(500).json({ message: "Could not load the YouTube connection. Try again." });
    }
  });

  app.get("/api/admin/youtube/connect", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser);
    if (!admin) return;
    res.setHeader("Cache-Control", "private, no-store");
    if (!configured()) return void res.status(503).json({ message: "Google OAuth is not configured" });
    const pending = newPendingState(admin.id, youtubeRedirectUri(req));
    req.session.youtubeOAuth = pending;
    // Saved before leaving for Google, so the callback always finds it.
    req.session.save((err) => {
      if (err) return void res.status(500).json({ message: "Could not start the connection. Try again." });
      res.redirect(consentUrl(pending.state, pending.redirect));
    });
  });

  app.get(YOUTUBE_CALLBACK_PATH, async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser);
    if (!admin) return;
    res.setHeader("Cache-Control", "private, no-store");
    const pending = req.session.youtubeOAuth;
    delete req.session.youtubeOAuth; // one use, whatever happens next
    if (!stateMatches(pending, admin.id, req.query.state)) {
      await remember("state", "The connection attempt could not be matched to this browser session (it may have expired after 10 minutes). Click Connect again.");
      return back(res, "failed");
    }
    if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
      const code = oauthErrorCode(req.query.error);
      await remember(code, code === "denied"
        ? "The Google permission screen was cancelled. Nothing was connected."
        : code === "scope"
          ? "Google rejected the requested scopes. Add them under Google Auth Platform → Data access, then connect again."
          : "Google did not complete the sign-in. Try connecting again.");
      return back(res, "failed");
    }
    try {
      const done = await completeConnect({ code: req.query.code, redirectUri: pending.redirect }, http);
      await saveYoutubeConnection(done, { id: admin.id, email: admin.email ?? null }, q);
      console.log(`[youtube] channel ${done.channelId} connected by user ${admin.id}`);
      back(res, "connected");
    } catch (e) {
      const known = e instanceof YoutubeError;
      if (!known) console.error("[youtube] callback failed:", (e as Error)?.message);
      await remember(known ? e.code : "exchange", known ? e.message : "The connection could not be saved. Try connecting again.");
      back(res, "failed");
    }
  });

  app.post("/api/admin/youtube/disconnect", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser);
    if (!admin) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    try {
      const token = await youtubeRefreshTokenForRevoke(q);
      const revoked = token ? await revokeToken(token, http) : false;
      const removed = await deleteYoutubeConnection(q);
      if (removed) console.log(`[youtube] channel disconnected by user ${admin.id} (revoked at Google: ${revoked})`);
      res.json({ disconnected: true, removed, revokedAtGoogle: revoked });
    } catch (e) {
      console.error("[youtube] disconnect failed:", (e as Error)?.message);
      res.status(500).json({ message: "Could not disconnect. Try again." });
    }
  });
}
