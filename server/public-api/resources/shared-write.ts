/**
 * Public API — shared pieces for the WRITE routes.
 *
 * Write routes are Express routers composed into the resource of the same
 * name (./register.ts) and served at /api/v1/<name> behind the registry's own
 * middleware (API-key auth, scope by method, per-key + per-account rate
 * limit, monthly unit quota, metering). Everything here is defensive on top
 * of that stack:
 *
 *   - `apiKeyContext` reads the verified key row the auth middleware attached
 *     (`req.apiKey`), accepting `user_id` or `userId`.
 *   - `requireWriteScope` refuses keys without the `write` scope (403
 *     insufficient_scope) and marks the request as a 5-unit write for metering
 *     (`res.locals.apiUnits`).
 *   - `handle` maps domain errors (zod, GoogleError, SocialError) to the
 *     `{ error: { code, message } }` envelope with the API's one error
 *     vocabulary (../errors.ts), without leaking internals.
 *
 * NO AI RULE: nothing under server/public-api/resources reaches openai,
 * ai-config, ai-output, review-automation, sitescan/providers, hub/ai,
 * ads-consultant or any AI generator — directly or transitively (the session
 * services reused here are the AI-free halves: gbp/reply.ts,
 * social/schedule.ts, sitescan/audit.ts). API-created content is stored
 * exactly as supplied with source=api.
 */
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { GoogleError } from "../../gbp/client";
import { SocialError } from "../../social/client";
import { apiError, codeForStatus, type ApiErrorCode } from "../errors";

export { API_KEY_BEARER, PUBLIC_API_BASE, rejectApiKeysOutsidePublicApi } from "../guard";
/** Every write call costs this many units (contract). */
export const WRITE_UNITS = 5;

export type ApiScope = "read" | "write";
export type ApiKeyContext = { id: string; userId: number; scopes: string[] };
/** The registry: name → router mounted at /api/v1/<name>, fragment (paths relative to the resource) merged into openapi.json. */
export type RegisterResource = (name: string, router: Router, openapiFragment: Record<string, unknown>) => void;

/** The verified key row the auth middleware attached to the request, normalised. */
export function apiKeyContext(req: Request, res: Response): ApiKeyContext | null {
  const raw: any = (req as any).apiKey ?? res.locals?.apiKey ?? (req as any).publicApiKey ?? null;
  if (!raw || typeof raw !== "object") return null;
  const userId = Number(raw.userId ?? raw.user_id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const scopes = Array.isArray(raw.scopes) ? raw.scopes.map((s: unknown) => String(s)) : [];
  return { id: String(raw.id ?? ""), userId, scopes };
}

export function jsonError(res: Response, status: number, code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}) {
  apiError(res, status, code, message, extra);
}

/** Write routes need the `write` scope; the request is metered as one write (5 units). */
export const requireWriteScope: RequestHandler = (req, res, next) => {
  const key = apiKeyContext(req, res);
  if (!key) return jsonError(res, 401, "unauthorized", "Provide a valid API key as: Authorization: Bearer chub_…");
  if (!key.scopes.includes("write")) {
    return jsonError(res, 403, "insufficient_scope", 'This endpoint needs an API key with the "write" scope.', { required: "write", scopes: key.scopes });
  }
  res.locals.apiUnits = WRITE_UNITS;
  res.locals.apiKeyContext = key;
  next();
};

export const zodIssues = (e: z.ZodError) => e.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));

/**
 * Route wrapper: the handler gets the key context; thrown domain errors become
 * the API's error envelope. A Google "reconnect" failure is reported as 409
 * google_reconnect_required, never 401 — a 401 on the public API means the API
 * key itself was refused.
 */
export function handle(fn: (req: Request, res: Response, key: ApiKeyContext) => Promise<unknown>): RequestHandler {
  return async (req, res, next: NextFunction) => {
    try {
      const key: ApiKeyContext | undefined = res.locals.apiKeyContext ?? apiKeyContext(req, res) ?? undefined;
      if (!key) return jsonError(res, 401, "unauthorized", "Provide a valid API key as: Authorization: Bearer chub_…");
      await fn(req, res, key);
    } catch (e) {
      if (res.headersSent) return next(e);
      if (e instanceof z.ZodError) return jsonError(res, 400, "validation_error", "Request failed validation.", { issues: zodIssues(e) });
      if (e instanceof GoogleError) {
        if (e.kind === "auth") return jsonError(res, 409, "google_reconnect_required", e.message);
        if (e.kind === "permission") return jsonError(res, 403, "google_permission", e.message);
        if (e.kind === "disabled") return jsonError(res, 403, "google_api_disabled", e.message);
        if (e.kind === "quota") { res.setHeader("Retry-After", "60"); return jsonError(res, 429, "google_quota", e.message); }
        if (e.kind === "transient") return jsonError(res, 503, "google_unavailable", e.message);
        const status = e.status >= 400 && e.status < 600 ? e.status : 400;
        return jsonError(res, status, status >= 500 ? "upstream_unavailable" : codeForStatus(status), e.message);
      }
      if (e instanceof SocialError) {
        if (e.status === 429) res.setHeader("Retry-After", "5");
        const status = e.status >= 400 && e.status < 600 ? e.status : 400;
        return jsonError(res, status, status >= 500 ? "upstream_unavailable" : codeForStatus(status), e.message);
      }
      // Anything else is a server-side failure: logged and reported as 500. (Input problems surface as
      // ZodError/GoogleError/SocialError above; a TypeError here is a bug, never a client mistake.)
      console.error("[public-api] write failed:", e instanceof Error ? e.message : e);
      jsonError(res, 500, "internal_error", "The request could not be completed. Try again.");
    }
  };
}

/** Positive integer path parameter. */
export const idParam = z.coerce.number().int().positive().max(2147483647);

/** OpenAPI pieces every write operation shares (the Error schema is the registry's). */
export const openapiCommon = {
  errorResponse: (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  }),
  writeOperation: (summary: string, tag: string) => ({
    summary,
    tags: [tag],
    security: [{ apiKey: ["write"] }],
    "x-scope": "write",
    "x-units": WRITE_UNITS,
    "x-ai": "none — content is stored exactly as supplied (source=api); no AI generation or rewriting is reachable through the API",
  }),
};
