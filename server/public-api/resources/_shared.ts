/**
 * Shared plumbing for the public API's READ resources (lane l6-api-read).
 *
 * Every resource module exports a `ReadResource` ({ name, router, openapi }) built with `resource()`.
 * The router's paths are relative to `/api/v1/<name>` — the registry (server/public-api/index.ts,
 * lane 1) mounts it there behind its own middleware: Bearer `chub_…` auth, scope check, rate limit,
 * monthly quota and metering. Nothing here authenticates: a request reaches these handlers only
 * after lane 1's `verifyApiKey` put the key on `req.apiKey`.
 *
 * Contract with the registry middleware (stated in the lane report):
 *   - `req.apiKey` = { id, userId (or user_id), scopes } — the verified account_api_keys row.
 *   - `res.locals.apiRowCount` / `res.locals.apiUnits` — set by sendList/sendItem so the meter can
 *     charge "1 unit per call + 1 per 100 rows" (`readUnits`).
 *   - Errors are `{ error: { code, message, ...extra } }` with the HTTP status; the same shape the
 *     registry uses for 401/402/429.
 *
 * NO AI: this folder never imports openai, ai-config, ai-output, content generators, review
 * automation, social generators, sitescan providers, site-assistant or ads-consultant. Reads only.
 *
 * Tenancy: own data only, or — with `?workspace=<ownerUserId>` — an agency workspace the key's user
 * is a member of (agency_members), limited to the member's assigned clients exactly like the
 * in-app agency routes (server/agency/access.ts).
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z, ZodError } from "zod";
import { pool } from "../../db";
import { accessFor, workspaceEntitled, type AgencyAccess } from "../../agency/access";

export { camel } from "../../agency/access";

// ── Types the registry and the resources share ─────────────────────────────────────────────────

/** The verified key the registry middleware attaches to `req.apiKey`. */
export type ApiKeyContext = { id: string; userId: number; scopes: string[] };

/** One resource's slice of /api/v1/openapi.json; `paths` are relative to the API root. */
export type OpenApiFragment = {
  paths: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
  tags?: { name: string; description?: string }[];
};

/** Lane 1's registry function (server/public-api/index.ts). */
export type RegisterResource = (name: string, router: Router, openapiFragment: OpenApiFragment) => void;

export type ReadResource = { name: string; router: Router; openapi: OpenApiFragment };

/** Who the request reads as. `owner` is whose rows are read; `actor` is the key's user. */
export type Scope = {
  owner: number;
  actor: number;
  /** true for own data and all-clients workspace roles; false limits reads to assigned clients' locations. */
  allClients: boolean;
  /** The workspace membership when reading an agency workspace, else null. */
  access: AgencyAccess | null;
  keyId: string;
};

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function sendError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

// ── Request context ────────────────────────────────────────────────────────────────────────────

/** The verified key on the request, or 401. Accepts the row's snake_case `user_id` too. */
export function keyContext(req: Request): ApiKeyContext {
  const raw = (req as any).apiKey as Record<string, unknown> | undefined;
  const userId = Number(raw?.userId ?? raw?.user_id);
  if (!raw || !Number.isInteger(userId) || userId <= 0 || typeof raw.id !== "string") {
    throw new ApiError(401, "unauthorized", "Provide an API key as: Authorization: Bearer chub_…");
  }
  const scopes = Array.isArray(raw.scopes) ? raw.scopes.map(String) : [];
  return { id: raw.id, userId, scopes };
}

export const positiveId = z.coerce.number().int().positive().max(2147483647);
export const uuid = z.string().uuid();
/** A real calendar day: "2026-02-30" is refused here (400), not by Postgres's `::date` cast (500). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((s) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}, "Not a calendar date");
const workspaceParam = z.object({ workspace: positiveId.optional() });

/**
 * Own data by default. `?workspace=<ownerUserId>` reads an agency workspace the key's user belongs
 * to; a non-member gets 404 (no existence leak, like the in-app routes) and a workspace whose
 * owner's plan lacks the Agency module gets 402.
 */
export async function resolveScope(req: Request): Promise<Scope> {
  const key = keyContext(req);
  const { workspace } = workspaceParam.parse(req.query ?? {});
  if (!workspace || workspace === key.userId) {
    return { owner: key.userId, actor: key.userId, allClients: true, access: null, keyId: key.id };
  }
  let access: AgencyAccess;
  try {
    access = await accessFor(key.userId, workspace);
  } catch {
    throw new ApiError(404, "not_found", "Workspace not found");
  }
  if (!(await workspaceEntitled(workspace, key.userId))) {
    throw new ApiError(402, "plan_required", "Agency workspace is included with the Agency plan.", { requiredPlan: "agency" });
  }
  return { owner: workspace, actor: key.userId, allClients: access.allClients, access, keyId: key.id };
}

// ── SQL helpers ────────────────────────────────────────────────────────────────────────────────

/** Positional parameter builder: `p.add(v)` returns the `$n` placeholder for `v`. */
export class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/**
 * Rows of business_locations (`alias`) the scope may read: the owner's locations, and for a
 * limited workspace role only those of the member's assigned clients — the same predicate as
 * server/agency/access.ts `visibility()`, with parameters managed by `p`.
 */
export function locationScopeSql(scope: Scope, p: Params, alias = "l"): string {
  const owner = p.add(scope.owner), all = p.add(scope.allClients), actor = p.add(scope.actor);
  return `${alias}.user_id=${owner} AND (${all}::boolean OR EXISTS(SELECT 1 FROM agency_member_clients amc WHERE amc.user_id=${alias}.user_id AND amc.member_id=${actor} AND amc.client_id=${alias}.agency_client_id))`;
}

/**
 * Rows of an owner-keyed table (`alias`, with a user_id column) the scope may read. `locationExpr`
 * is the SQL expression giving the row's location id (null = the table has no location: then only
 * an all-clients scope reads it). A limited workspace role reads only rows tied to a visible
 * location; rows without one stay hidden from it.
 */
export function ownerScopeSql(scope: Scope, p: Params, alias: string, locationExpr: string | null): string {
  const owner = p.add(scope.owner), all = p.add(scope.allClients);
  if (!locationExpr) return `${alias}.user_id=${owner} AND ${all}::boolean`;
  const actor = p.add(scope.actor);
  return `${alias}.user_id=${owner} AND (${all}::boolean OR EXISTS(SELECT 1 FROM business_locations v JOIN agency_member_clients amc ON amc.user_id=v.user_id AND amc.client_id=v.agency_client_id WHERE v.id=${locationExpr} AND v.user_id=${owner} AND amc.member_id=${actor}))`;
}

export const LOCATION_COLUMNS = `l.id,l.business_name,l.place_id,l.google_cid,l.address,l.city,l.state,l.zip_code,l.country,l.phone,l.website,
  l.description,l.categories,l.services,l.service_areas,l.hours,l.opening_date,l.open_status,l.social_profiles,l.tags,
  l.business_photo_count,l.customer_photo_count,l.gbp_management_enabled,l.listings_count,l.review_count,l.new_review_count,
  l.monthly_views,l.avg_rank,l.avg_rating,l.gbp_account_name,l.gbp_location_name,l.agency_client_id,l.created_at,l.updated_at,
  c.name AS client_name`;
export const LOCATION_JOIN = "business_locations l LEFT JOIN agency_clients c ON c.user_id=l.user_id AND c.id=l.agency_client_id";

/** One location the scope may read, or null. Used to answer 404 before any per-location query. */
export async function visibleLocation(scope: Scope, id: number): Promise<Record<string, any> | null> {
  const p = new Params();
  const where = locationScopeSql(scope, p);
  const { rows: [row] } = await pool.query(
    `SELECT ${LOCATION_COLUMNS} FROM ${LOCATION_JOIN} WHERE ${where} AND l.id=${p.add(id)}`, p.values);
  return row ?? null;
}

/** The location named by `?locationId=` (or a path id) — 404 when the scope cannot read it. */
export async function requireLocation(scope: Scope, id: number): Promise<Record<string, any>> {
  const row = await visibleLocation(scope, id);
  if (!row) throw new ApiError(404, "not_found", "Location not found");
  return row;
}

// ── Pagination, envelopes, metering hints ──────────────────────────────────────────────────────

export const MAX_LIMIT = 200;
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
});
export type Page = z.infer<typeof pageSchema>;

/** The one pagination envelope on every collection — the same as the CRM /api/v1 resources. */
export function envelope<T>(data: T[], total: number, page: Page) {
  return { data, pagination: { total, limit: page.limit, offset: page.offset, hasMore: page.offset + data.length < total } };
}

/** Metering (lane 1): 1 unit per read call plus 1 per 100 rows returned. */
export const readUnits = (rows: number) => 1 + Math.floor(Math.max(0, rows) / 100);

function meterHint(res: Response, rows: number) {
  res.locals.apiRowCount = rows;
  res.locals.apiUnits = readUnits(rows);
}

export function sendList<T>(res: Response, data: T[], total: number, page: Page, extra: Record<string, unknown> = {}) {
  meterHint(res, data.length);
  return res.json({ ...envelope(data, total, page), ...extra });
}

export function sendItem<T>(res: Response, data: T) {
  meterHint(res, 1);
  return res.json({ data });
}

// ── Handlers and routers ───────────────────────────────────────────────────────────────────────

/** A resource handler: scope already resolved; throw ApiError/ZodError for the error envelope. */
export type ScopedHandler = (req: Request, res: Response, scope: Scope) => Promise<unknown>;

export function handler(fn: ScopedHandler): RequestHandler {
  return async (req, res) => {
    try {
      const scope = await resolveScope(req);
      await fn(req, res, scope);
    } catch (e: any) {
      if (res.headersSent) return;
      if (e instanceof ApiError) return sendError(res, e.status, e.code, e.message, e.extra);
      if (e instanceof ZodError) {
        return sendError(res, 400, "validation_error", "Invalid request", {
          issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      console.error("[public-api] read resource failed:", e?.message || e);
      return sendError(res, 500, "internal_error", "Something went wrong on our side.");
    }
  };
}

/** Every route here is a read; a key without the `read` scope is refused even if it reaches us. */
export const requireReadScope: RequestHandler = (req, res, next) => {
  try {
    const key = keyContext(req);
    if (!key.scopes.includes("read")) return sendError(res, 403, "insufficient_scope", "This API key has no read scope.");
    next();
  } catch (e: any) {
    if (e instanceof ApiError) return sendError(res, e.status, e.code, e.message, e.extra);
    throw e;
  }
};

/** Build a resource: its router carries the read-scope check and paths relative to `/api/v1/<name>`. */
export function resource(name: string, openapi: OpenApiFragment, build: (router: Router) => void): ReadResource {
  const router = Router();
  router.use(requireReadScope);
  build(router);
  // Anything else under the resource is a 404 in the API's own error shape, never Express's HTML page.
  router.use((_req, res) => sendError(res, 404, "not_found", `No such ${name} endpoint`));
  return { name, router, openapi };
}

// ── OpenAPI building blocks ────────────────────────────────────────────────────────────────────

export const OPENAPI = {
  /** `?workspace=` on every list/detail route. */
  workspaceParam: {
    name: "workspace", in: "query", required: false,
    description: "Read an agency workspace you are a member of: the workspace owner's user id. Omit for your own data.",
    schema: { type: "integer" },
  },
  pageParams: [
    { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 } },
    { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
  ],
  idParam: (name: string, type: "integer" | "string" = "integer", format?: string) => ({
    name, in: "path", required: true, schema: format ? { type, format } : { type },
  }),
  query: (name: string, schema: Record<string, unknown>, description?: string) => ({
    name, in: "query", required: false, schema, ...(description ? { description } : {}),
  }),
  errors: {
    400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    401: { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    402: { description: "The plan does not include this", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    403: { description: "The key lacks the read scope", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    404: { description: "Not found (or not yours)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    429: { description: "Rate limit or monthly quota exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  },
  list: (itemRef: string, extra: Record<string, unknown> = {}) => ({
    200: {
      description: "A page of results",
      content: { "application/json": { schema: { type: "object", properties: {
        data: { type: "array", items: { $ref: itemRef } },
        pagination: { $ref: "#/components/schemas/Pagination" },
        ...extra,
      } } } },
    },
  }),
  item: (itemRef: string) => ({
    200: { description: "The item", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: itemRef } } } } } },
  }),
  /** Schemas every fragment may reference; the registry merges duplicates by name. */
  baseSchemas: {
    Error: { type: "object", properties: { error: { type: "object", properties: {
      code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } }, required: ["error"] },
    Pagination: { type: "object", properties: {
      total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" }, hasMore: { type: "boolean" } } },
  },
};

export const dateTime = { type: "string", format: "date-time", nullable: true };
export const nullableString = { type: "string", nullable: true };
export const nullableInt = { type: "integer", nullable: true };
