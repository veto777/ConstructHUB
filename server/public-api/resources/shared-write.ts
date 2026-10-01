/**
 * Public API — shared pieces for the WRITE resources (lane l7-api-write).
 *
 * The write resources are Express routers that lane 1's public-api router
 * mounts through `registerResource(name, router, openapiFragment)` after its
 * own middleware (API-key auth, scope check, 60/min rate limit, monthly unit
 * quota, metering). Everything here is defensive on top of that stack:
 *
 *   - `apiKeyContext` reads the verified key row the auth middleware attached
 *     (`req.apiKey`, or `res.locals.apiKey`), accepting `user_id` or `userId`.
 *   - `requireWriteScope` refuses keys without the `write` scope (403
 *     scope_required) and marks the request as a 5-unit write for metering
 *     (`res.locals.apiUnits`).
 *   - `handle` maps domain errors (zod, GoogleError, SocialError) to the
 *     `{ error: { code, message } }` envelope without leaking internals.
 *   - `rejectApiKeysOutsidePublicApi` is an app-level guard: a `chub_` bearer
 *     token on any route outside /api/v1 answers 401, so an API key can never be
 *     mistaken for a session on the AI routes (or anything else).
 *
 * NO AI RULE: nothing in server/public-api/resources/*-write.ts imports openai,
 * ai-config, ai-output, review-automation, sitescan/providers, site-assistant,
 * ads-consultant or any AI generator. API-created content is stored exactly as
 * supplied with source=api.
 */
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { GoogleError } from "../../gbp/client";
import { SocialError } from "../../social/client";

/** Where the growth resources live. The CRM keeps /api/v1/{customers,...}; growth is /api/v1/growth/<resource>. */
export const GROWTH_BASE = "/api/v1/growth";
/** Every write call costs this many units (contract). */
export const WRITE_UNITS = 5;
/** The bearer prefix of account API keys (`chub_<prefix>_<secret>`). */
export const API_KEY_BEARER = /^Bearer\s+chub_/i;

export type ApiScope = "read" | "write";
export type ApiKeyContext = { id: string; userId: number; scopes: string[] };
/** Lane 1's registry: name → router mounted at `${GROWTH_BASE}/${name}`, fragment merged into /api/v1/openapi.json. */
export type RegisterResource = (name: string, router: Router, openapiFragment: Record<string, unknown>) => void;

/** The verified key row lane 1's auth middleware attached to the request, normalised. */
export function apiKeyContext(req: Request, res: Response): ApiKeyContext | null {
  const raw: any = (req as any).apiKey ?? res.locals?.apiKey ?? (req as any).publicApiKey ?? null;
  if (!raw || typeof raw !== "object") return null;
  const userId = Number(raw.userId ?? raw.user_id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const scopes = Array.isArray(raw.scopes) ? raw.scopes.map((s: unknown) => String(s)) : [];
  return { id: String(raw.id ?? ""), userId, scopes };
}

export function jsonError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ error: { code, message, ...extra } });
}

/** Write resources need the `write` scope; the request is metered as one write (5 units). */
export const requireWriteScope: RequestHandler = (req, res, next) => {
  const key = apiKeyContext(req, res);
  if (!key) return jsonError(res, 401, "unauthorized", "Provide a valid API key as: Authorization: Bearer chub_…");
  if (!key.scopes.includes("write")) {
    return jsonError(res, 403, "scope_required", "This endpoint needs an API key with the write scope.", { scope: "write" });
  }
  res.locals.apiUnits = WRITE_UNITS;
  res.locals.apiKeyContext = key;
  next();
};

const zodIssues = (e: z.ZodError) => e.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));
const codeForStatus = (status: number) =>
  status === 404 ? "not_found" : status === 409 ? "conflict" : status === 429 ? "rate_limited" : status >= 500 ? "unavailable" : "invalid_request";

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
      if (e instanceof z.ZodError) return jsonError(res, 400, "invalid_request", "Request body failed validation.", { issues: zodIssues(e) });
      if (e instanceof GoogleError) {
        if (e.kind === "auth") return jsonError(res, 409, "google_reconnect_required", e.message);
        if (e.kind === "permission") return jsonError(res, 403, "google_permission", e.message);
        if (e.kind === "disabled") return jsonError(res, 403, "google_api_disabled", e.message);
        if (e.kind === "quota") { res.setHeader("Retry-After", "60"); return jsonError(res, 429, "google_quota", e.message); }
        if (e.kind === "transient") return jsonError(res, 503, "google_unavailable", e.message);
        return jsonError(res, e.status >= 400 && e.status < 600 ? e.status : 400, codeForStatus(e.status), e.message);
      }
      if (e instanceof SocialError) {
        if (e.status === 429) res.setHeader("Retry-After", "5");
        return jsonError(res, e.status, codeForStatus(e.status), e.message);
      }
      if (e instanceof TypeError) return jsonError(res, 400, "invalid_request", "Invalid request.");
      console.error("[public-api] write failed:", e instanceof Error ? e.message : e);
      jsonError(res, 500, "internal", "The request could not be completed. Try again.");
    }
  };
}

/**
 * App-level guard (mount before every route): an account API key authenticates
 * ONLY inside the public API router. Presenting one anywhere else — the session
 * routes, and in particular the AI routes (/api/gbp/content/:id/draft,
 * /api/gmb/review-response, /api/sitescan/jobs/:id/plan, /api/social/generate,
 * /api/site-assistant/chat) — is answered 401 before any handler runs, even on
 * routes that are otherwise anonymous.
 */
export const rejectApiKeysOutsidePublicApi: RequestHandler = (req, res, next) => {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && API_KEY_BEARER.test(auth) && !(req.path === "/api/v1" || req.path.startsWith("/api/v1/"))) {
    return jsonError(res, 401, "api_key_not_accepted", "API keys authenticate only /api/v1 requests. Sign in to use this feature.");
  }
  next();
};

/** Positive integer path parameter. */
export const idParam = z.coerce.number().int().positive().max(2147483647);

/** OpenAPI 3.1 pieces every write operation shares. */
export const openapiCommon = {
  errorResponse: (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
  }),
  schemas: {
    ApiError: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: { code: { type: "string" }, message: { type: "string" }, issues: { type: "array", items: { type: "object" } } },
        },
      },
    },
  },
  writeOperation: (summary: string, tag: string) => ({
    summary,
    tags: [tag],
    security: [{ apiKey: ["write"] }],
    "x-scope": "write",
    "x-units": WRITE_UNITS,
    "x-ai": "none — content is stored exactly as supplied (source=api); no AI generation or rewriting is reachable through the API",
  }),
};
