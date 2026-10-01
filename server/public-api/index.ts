/**
 * The public API — /api/v1 with chub_ keys (Account → API keys).
 *
 *   openapi.json   public, no auth
 *   authenticate   chub_ token → req.publicApi + req.apiKey; CRM paths without one pass through
 *   rate limit     60/min/key (plan's apiRatePerMinute) and 300/min/account → 429 rate_limited
 *   scope          GET/HEAD need read, everything else write → 403 insufficient_scope
 *   quota          plan units + per-key cap → 402 plan_required / 429 quota_exceeded,
 *                  then meters the response (X-Units-Remaining)
 *   /me            the account, key and usage behind the token
 *   resources      /api/v1/<name> — server/public-api/resources (reads + writes, one router per name)
 *   404            JSON, never the SPA
 *
 * Error codes are one vocabulary everywhere (./errors.ts API_ERROR_CODES).
 *
 * NO AI RULE: nothing in server/public-api/* imports OpenAI or a TruthCoder
 * generator, directly or transitively (no-ai.test.ts walks the import graph
 * from every file here, resources included). The API stores what the caller
 * sends; it never generates content and cannot change AI settings.
 */
import { Router, type ErrorRequestHandler, type Express } from "express";
import { apiMonthResetsAt, monthlyUsage } from "../account/api-keys";
import { authenticate, isCrmApiPath, scopeByMethod } from "./auth";
import { apiError, codeForStatus } from "./errors";
import { PUBLIC_API_BASE } from "./guard";
import { buildOpenApiDocument } from "./openapi";
import { quota } from "./quota";
import { rateLimitByKey } from "./rate-limit";
import { listResources, registerResource, resourceRouter } from "./registry";
import { registerAllResources } from "./resources/register";

export { PUBLIC_API_BASE, rejectApiKeysOutsidePublicApi, isPublicApiPath } from "./guard";
export { registerResource, listResources, CRM_RESERVED, type OpenApiFragment, type PublicResource } from "./registry";
export { requireScope, isCrmApiPath, type PublicApiContext } from "./auth";
export { apiError, codeForStatus, API_ERROR_CODES, API_EXTRA_ERROR_CODES, type ApiErrorCode } from "./errors";
export { resetRateLimits, DEFAULT_RATE_PER_MINUTE, ACCOUNT_RATE_PER_MINUTE } from "./rate-limit";
export { READ_UNITS, ROWS_PER_UNIT, WRITE_UNITS, unitsFor } from "./quota";
export { buildOpenApiDocument } from "./openapi";

let resourcesRegistered = false;
/** Mount every feature resource (reads + writes) once per process; a second call is a no-op. */
export function ensureResourcesRegistered(): string[] {
  if (resourcesRegistered) return listResources().map((r) => r.name);
  resourcesRegistered = true;
  return registerAllResources(registerResource);
}

export function createPublicApiRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(buildOpenApiDocument());
  });

  router.use(authenticate);
  router.use(rateLimitByKey);
  router.use(scopeByMethod);
  router.use(quota);

  router.get("/me", async (req, res, next) => {
    try {
      const ctx = req.publicApi!;
      const used = await monthlyUsage(ctx.key.id, ctx.userId);
      const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
      res.json({
        userId: ctx.userId,
        key: {
          id: ctx.key.id, name: ctx.key.name, prefix: ctx.key.prefix, suffix: ctx.key.suffix, scopes: ctx.scopes,
          monthlyUnitLimit: ctx.key.monthlyUnitLimit, usedThisMonth: used.key, expiresAt: iso(ctx.key.expiresAt),
        },
        plan: {
          key: ctx.plan.key, unitsPerMonth: ctx.plan.unitsPerMonth, usedThisMonth: used.user,
          ratePerMinute: ctx.plan.ratePerMinute, resetsAt: apiMonthResetsAt(),
        },
        resources: listResources().map((r) => r.name),
      });
    } catch (e) {
      next(e);
    }
  });

  router.use(resourceRouter);

  router.use((req, res) => {
    const crmHint = isCrmApiPath(req.path)
      ? " CRM resources (customers, projects, estimates, invoices, payments) are a separate API that uses chk_ keys from Portal → Integrations."
      : "";
    apiError(res, 404, "not_found", `No resource at ${req.method} ${req.baseUrl}${req.path}. See ${req.baseUrl}/openapi.json.${crmHint}`);
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) console.error("[public-api]", err?.stack || err?.message || err);
    if (res.headersSent) return;
    if (status >= 500) return apiError(res, 500, "internal_error", "Something went wrong on our side. Try again shortly.");
    // Body-parser failures (malformed JSON, too large) and other 4xx without a code of ours.
    const isBodyError = typeof err?.type === "string" && err.type.startsWith("entity.");
    apiError(res, status, codeForStatus(status), isBodyError ? "The request body could not be read as JSON." : String(err?.message || "Bad request"));
  };
  router.use(onError);
  return router;
}

/** Mount at /api/v1 with every resource registered. Register BEFORE the CRM routes so the chk_ hand-off (auth.ts) applies. */
export function registerPublicApi(app: Express): Router {
  ensureResourcesRegistered();
  const router = createPublicApiRouter();
  app.use(PUBLIC_API_BASE, router);
  return router;
}
