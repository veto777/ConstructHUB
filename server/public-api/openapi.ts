/**
 * GET /api/v1/openapi.json — the API described from the registered resources'
 * fragments plus the built-in pieces (auth, errors, /me, limits).
 */
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { listResources } from "./registry";
import { READ_UNITS, ROWS_PER_UNIT, WRITE_UNITS } from "./quota";

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object", required: ["code", "message"],
      properties: {
        code: { type: "string", enum: ["unauthorized", "invalid_api_key", "insufficient_scope", "rate_limited", "plan_required", "quota_exceeded", "not_found", "validation_error", "internal_error"] },
        message: { type: "string" },
      },
      additionalProperties: true,
    },
  },
};

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
  const schemas: Record<string, unknown> = { Error: ERROR_SCHEMA, Me: ME_SCHEMA };
  const tags: { name: string; description?: string }[] = [{ name: "account", description: "Who am I, usage" }];
  for (const r of listResources()) {
    for (const [p, item] of Object.entries(r.openapi.paths ?? {})) {
      const suffix = p === "/" || p === "" ? "" : p.startsWith("/") ? p : `/${p}`;
      paths[`/${r.name}${suffix}`] = item;
    }
    Object.assign(schemas, r.openapi.components?.schemas ?? {});
    for (const t of r.openapi.tags ?? []) if (!tags.some((x) => x.name === t.name)) tags.push(t);
  }
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
      units: { read: `${READ_UNITS} + 1 per ${ROWS_PER_UNIT} rows`, write: WRITE_UNITS },
      unitsPerMonth: Object.fromEntries(PLAN_KEYS.map((k) => [k, PLANS[k].limits.apiUnitsPerMonth])),
      errors: { rateLimited: "429 rate_limited (Retry-After)", quota: "429 quota_exceeded (Retry-After until the 1st)", noApiOnPlan: "402 plan_required" },
    },
    "x-crm-api": {
      note: "CRM resources (customers, projects, estimates, invoices, payments) are a separate API with chk_ keys from Portal → Integrations.",
      index: `${base}/api/v1`,
    },
  };
}
