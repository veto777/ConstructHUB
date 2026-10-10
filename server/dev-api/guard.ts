/**
 * App-level guard, mounted in server/index.ts before every route: a Code API
 * token (`Authorization: Bearer chdev_…`) authenticates ONLY /api/dev/v1.
 * Anywhere else it is answered 401 before any handler runs, so a token can
 * never be mistaken for a session. No imports on purpose: cheap and AI-free.
 */
import type { RequestHandler } from "express";

export const DEV_API_BASE = "/api/dev/v1";
export const DEV_TOKEN_BEARER = /^Bearer\s+chdev_/i;

export const isDevApiPath = (path: string) => {
  const p = path.toLowerCase();
  return p === DEV_API_BASE || p.startsWith(`${DEV_API_BASE}/`);
};

export const rejectDevTokensOutsideDevApi: RequestHandler = (req, res, next) => {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && DEV_TOKEN_BEARER.test(auth) && !isDevApiPath(req.path)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({
      error: { code: "unauthorized", message: `Code API tokens authenticate only ${DEV_API_BASE} requests.` },
      message: `Code API tokens authenticate only ${DEV_API_BASE} requests.`,
    });
  }
  next();
};
