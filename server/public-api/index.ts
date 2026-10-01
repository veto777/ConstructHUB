/**
 * The public API — /api/v1 with chub_ keys (Account → API keys).
 *
 *   openapi.json   public, no auth
 *   authenticate   chub_ token → req.publicApi; CRM paths without one pass through
 *   rate limit     60/min/key (plan's apiRatePerMinute) → 429 rate_limited
 *   scope          GET/HEAD need read, everything else write → 403 insufficient_scope
 *   quota          plan units + per-key cap → 402 plan_required / 429 quota_exceeded,
 *                  then meters the response (X-Units-Remaining)
 *   /me            the account, key and usage behind the token
 *   resources      whatever feature modules registered with registerResource()
 *   404            JSON, never the SPA
 *
 * NO AI RULE: nothing in server/public-api/* imports OpenAI or a TruthCoder
 * generator (no-ai.test.ts walks the import graph). The API stores what the
 * caller sends; it never generates content and cannot change AI settings.
 */
import { Router, type ErrorRequestHandler, type Express } from "express";
import { apiMonthResetsAt, monthlyUsage } from "../account/api-keys";
import { authenticate, isCrmApiPath, scopeByMethod } from "./auth";
import { apiError } from "./errors";
import { buildOpenApiDocument } from "./openapi";
import { quota } from "./quota";
import { rateLimitByKey } from "./rate-limit";
import { listResources, resourceRouter } from "./registry";

export const PUBLIC_API_BASE = "/api/v1";

export { registerResource, listResources, CRM_RESERVED, type OpenApiFragment, type PublicResource } from "./registry";
export { requireScope, isCrmApiPath, type PublicApiContext } from "./auth";
export { apiError } from "./errors";
export { resetRateLimits, DEFAULT_RATE_PER_MINUTE } from "./rate-limit";
export { READ_UNITS, ROWS_PER_UNIT, WRITE_UNITS, unitsFor } from "./quota";
export { buildOpenApiDocument } from "./openapi";

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
    apiError(res, status, status >= 500 ? "internal_error" : String(err?.code || "bad_request").toLowerCase(),
      status >= 500 ? "Something went wrong on our side. Try again shortly." : String(err?.message || "Bad request"));
  };
  router.use(onError);
  return router;
}

/** Mount at /api/v1. Register BEFORE the CRM routes so the chk_ hand-off (auth.ts) applies. */
export function registerPublicApi(app: Express): Router {
  const router = createPublicApiRouter();
  app.use(PUBLIC_API_BASE, router);
  return router;
}
