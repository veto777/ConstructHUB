/**
 * GET /api/v1/openapi.json — the API described from the registered resources'
 * fragments plus the built-in pieces (auth, errors, /me, limits).
 */
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { API_ERROR_CODES, API_EXTRA_ERROR_CODES } from "./errors";
import { listResources } from "./registry";
import { READ_UNITS, ROWS_PER_UNIT, WRITE_UNITS } from "./quota";
import { ACCOUNT_RATE_PER_MINUTE } from "./rate-limit";

/** The one error shape; every resource fragment's `Error` / `ApiError` schema is replaced by this. */
export const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object", required: ["code", "message"],
      properties: {
        code: { type: "string", enum: [...API_ERROR_CODES, ...API_EXTRA_ERROR_CODES] },
        message: { type: "string" },
        issues: { type: "array", description: "validation_error only", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } },
      },
      additionalProperties: true,
    },
  },
};

/**
 * A fragment path relative to the resource ("/" or "/{id}") is prefixed with
 * /<name>; a path that already starts with /<name> (a resource documenting
 * absolute paths) is used as is.
 */
export function resourcePath(name: string, fragmentPath: string): string {
  const p = fragmentPath === "" ? "/" : fragmentPath.startsWith("/") ? fragmentPath : `/${fragmentPath}`;
  if (p === `/${name}` || p.startsWith(`/${name}/`)) return p;
  return p === "/" ? `/${name}` : `/${name}${p}`;
}

const ME_SCHEMA = {
  type: "object",
  properties: {
    userId: { type: "integer" },
    key: {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, prefix: { type: "string" }, suffix: { type: "string" },
        scopes: { type: "array", items: { type: "string", enum: ["read", "write"] } },
        monthlyUnitLimit: { type: "integer", nullable: true }, expiresAt: { type: "string", format: "date-time", nullable: true },
      },
    },
    plan: {
      type: "object",
      properties: {
        key: { type: "string", nullable: true }, unitsPerMonth: { type: "integer" }, usedThisMonth: { type: "integer" },
        ratePerMinute: { type: "integer" }, resetsAt: { type: "string", format: "date-time" },
      },
    },
    resources: { type: "array", items: { type: "string" } },
  },
};

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

export function buildOpenApiDocument(): Record<string, unknown> {
  const base = (process.env.APP_URL || "https://constructhub.us").replace(/\/+$/, "");
  const paths: Record<string, unknown> = {
    "/me": {
      get: {
        operationId: "getMe", summary: "The account and key behind this token, with this month's usage", tags: ["account"],
        responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Me" } } } }, "401": errorResponse("Missing, invalid, revoked or expired key") },
      },
    },
  };
  const schemas: Record<string, unknown> = { Me: ME_SCHEMA };
  const tags: { name: string; description?: string }[] = [{ name: "account", description: "Who am I, usage" }];
  for (const r of listResources()) {
    for (const [p, item] of Object.entries(r.openapi.paths ?? {})) {
      const full = resourcePath(r.name, p);
      // Two routers under one name (reads + writes) each document their own methods on a path.
      paths[full] = { ...(paths[full] as Record<string, unknown> | undefined), ...(item as Record<string, unknown>) };
    }
    Object.assign(schemas, r.openapi.components?.schemas ?? {});
    for (const t of r.openapi.tags ?? []) if (!tags.some((x) => x.name === t.name)) tags.push(t);
  }
  // One error vocabulary: whatever a fragment named its error schema, the document carries the shared one.
  schemas.Error = ERROR_SCHEMA;
  if ("ApiError" in schemas) schemas.ApiError = ERROR_SCHEMA;
  return {
    openapi: "3.0.3",
    info: {
      title: "ConstructHUB API",
      version: "v1",
      description: [
        "Your account's data, for your own tools and automations.",
        "Authenticate with `Authorization: Bearer chub_…` (Account → API keys). A key has `read` and/or `write` scope.",
        `Metering: a read costs ${READ_UNITS} unit plus 1 per ${ROWS_PER_UNIT} rows returned; a write costs ${WRITE_UNITS} units. ` +
        "Units reset on the 1st of each month (UTC). Response headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-Units-Remaining.",
        "This API stores what you send. It never runs TruthCoder AI: posts, replies and social posts created here are published exactly as supplied (source: api), and AI settings cannot be changed through it.",
      ].join("\n\n"),
    },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ apiKey: [] }],
    tags,
    paths,
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "chub_<prefix>_<secret>" } },
      schemas,
    },
    "x-limits": {
      ratePerMinute: PLANS.pro.limits.apiRatePerMinute,
      accountRatePerMinute: ACCOUNT_RATE_PER_MINUTE,
      units: { read: `${READ_UNITS} + 1 per ${ROWS_PER_UNIT} rows`, write: WRITE_UNITS },
      unitsPerMonth: Object.fromEntries(PLAN_KEYS.map((k) => [k, PLANS[k].limits.apiUnitsPerMonth])),
      errors: { rateLimited: "429 rate_limited (Retry-After; scope key | account)", quota: "429 quota_exceeded (Retry-After until the 1st)", noApiOnPlan: "402 plan_required" },
    },
    "x-error-codes": {
      base: [...API_ERROR_CODES],
      extra: [...API_EXTRA_ERROR_CODES],
      shape: "{ error: { code, message, ...details } }",
    },
    "x-crm-api": {
      note: "CRM resources (customers, projects, estimates, invoices, payments) are a separate API with chk_ keys from Portal → Integrations.",
      index: `${base}/api/v1`,
    },
  };
}
