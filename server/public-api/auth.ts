/**
 * API-key authentication for /api/v1 (chub_ keys) and the scope check.
 *
 * Coexistence with the CRM's chk_ keys: both APIs live under /api/v1. This
 * router is mounted first; a request that does not carry a chub_ token and
 * targets a CRM path (/, customers, projects, estimates, invoices, payments,
 * ping) leaves this router untouched (`next("router")`) and reaches the CRM
 * handlers exactly as before. A chub_ token never authenticates a CRM route
 * (those are answered 404 here, so they never reach the CRM), and a chub_ key
 * authenticates nothing outside this router.
 */
import type { RequestHandler } from "express";
import { isUnlimited, UNLIMITED, type PlanKey } from "@shared/plans";
import { looksLikeApiKey, verifyApiKey, type ApiKeyRow, type ApiScope } from "../account/api-keys";
import { cheapestPlanWhere, getEntitlements, TOP_PLAN } from "../entitlements";
import { CRM_RESERVED } from "./registry";
import { apiError } from "./errors";
import { DEFAULT_RATE_PER_MINUTE } from "./rate-limit";

export type PublicApiContext = {
  userId: number;
  key: ApiKeyRow;
  scopes: ApiScope[];
  plan: {
    key: PlanKey | null;
    /** 0 = the API is not part of the plan; -1 = unlimited (platform admins). */
    unitsPerMonth: number;
    ratePerMinute: number;
    /** The cheapest plan that includes the API, for 402s. */
    requiredPlan: PlanKey;
  };
  isPlatformAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      /** Set by the public API's authenticate middleware; absent on session routes. */
      publicApi?: PublicApiContext;
      /** The verified key row ({ id, userId, scopes, … }); what the resource handlers read. Same request lifetime as publicApi. */
      apiKey?: ApiKeyRow;
    }
  }
}

/** The cheapest plan whose API allowance is above zero. */
export const apiRequiredPlan = (): PlanKey => cheapestPlanWhere((l) => l.apiUnitsPerMonth > 0) ?? TOP_PLAN;

/** "/" or a top-level segment the CRM chk_ API serves. */
export function isCrmApiPath(path: string): boolean {
  const seg = path.replace(/^\/+/, "").split("/")[0] ?? "";
  return seg === "" || CRM_RESERVED.has(seg);
}

export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!looksLikeApiKey(header)) {
    // Not ours. CRM paths keep their own key system and their own 401s.
    if (isCrmApiPath(req.path)) return next("router");
    return apiError(res, 401, "unauthorized", "Provide an API key: Authorization: Bearer chub_… (create one in Account → API keys).");
  }
  try {
    const key = await verifyApiKey(header);
    if (!key) return apiError(res, 401, "invalid_api_key", "This API key is invalid, revoked or expired.");
    const ent = await getEntitlements(key.userId);
    req.apiKey = key;
    req.publicApi = {
      userId: key.userId,
      key,
      scopes: key.scopes,
      plan: {
        key: ent.accessPlan,
        unitsPerMonth: isUnlimited(ent.allowances?.apiUnitsPerMonth) ? UNLIMITED : Math.max(0, ent.allowances?.apiUnitsPerMonth ?? 0),
        ratePerMinute: ent.allowances?.apiRatePerMinute || DEFAULT_RATE_PER_MINUTE,
        requiredPlan: apiRequiredPlan(),
      },
      isPlatformAdmin: ent.isPlatformAdmin,
    };
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (e) {
    next(e);
  }
};

/** 403 insufficient_scope unless the key carries `scope`. */
export function requireScope(scope: ApiScope): RequestHandler {
  return (req, res, next) => {
    const ctx = req.publicApi;
    if (!ctx) return apiError(res, 401, "unauthorized", "Authenticate with an API key first.");
    if (!ctx.scopes.includes(scope)) {
      return apiError(res, 403, "insufficient_scope", `This key does not have the "${scope}" scope.`, { required: scope, scopes: ctx.scopes });
    }
    next();
  };
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** GET/HEAD need `read`; every other method needs `write`. */
export const scopeByMethod: RequestHandler = (req, res, next) =>
  requireScope(READ_METHODS.has(req.method.toUpperCase()) ? "read" : "write")(req, res, next);
