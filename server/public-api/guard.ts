/**
 * App-level guard, mounted in server/index.ts before every route: an account
 * API key (`Authorization: Bearer chub_…`) authenticates ONLY the public API
 * router at /api/v1. Presenting one anywhere else — the session routes, the
 * AI routes (/api/gbp/content/:id/draft, /api/gmb/review-response,
 * /api/sitescan/jobs/:id/plan, /api/social/generate, /api/hub/chat),
 * /api/account/*, /api/crm/* — is answered 401 before any handler runs, even
 * on routes that are otherwise anonymous, so a key can never be mistaken for
 * a session. No imports on purpose: this file must stay AI-free and cheap.
 */
import type { RequestHandler } from "express";

export const PUBLIC_API_BASE = "/api/v1";
/** The bearer prefix of account API keys (`chub_<prefix>_<secret>`). */
export const API_KEY_BEARER = /^Bearer\s+chub_/i;

export const isPublicApiPath = (path: string) => path === PUBLIC_API_BASE || path.startsWith(`${PUBLIC_API_BASE}/`);

export const rejectApiKeysOutsidePublicApi: RequestHandler = (req, res, next) => {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && API_KEY_BEARER.test(auth) && !isPublicApiPath(req.path)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({
      error: { code: "unauthorized", message: "API keys authenticate only /api/v1 requests. Sign in to use this feature." },
      // The session routes' own clients read `message`.
      message: "API keys authenticate only /api/v1 requests. Sign in to use this feature.",
    });
  }
  next();
};
