/**
 * /api/v1/gbp-posts — the Business Profile publishing queue (gbp_content_jobs): posts and photo
 * uploads waiting, published, failed. Read only; items are returned as stored (the payload the
 * user supplied). Google resource names are included so a client can match them on the listing.
 */
import { z } from "zod";
import { pool } from "../../db";
import {
  ApiError, OPENAPI, Params, type Scope, dateTime, handler, nullableString, ownerScopeSql, pageSchema, positiveId, requireLocation, resource,
  sendItem, sendList,
} from "./_shared";

export const GBP_POST_STATUSES = ["queued", "publishing", "published", "failed", "uncertain", "rejected", "cancelled"] as const;

export const gbpPostFilterSchema = pageSchema.extend({
  status: z.string().trim().max(20).optional(),
  kind: z.enum(["post", "photo"]).optional(),
  requestKey: z.string().trim().max(200).optional(),
});
export type GbpPostFilter = z.infer<typeof gbpPostFilterSchema> & { locationId?: number };

export const GBP_POST_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, locationId: { type: "integer" }, kind: { type: "string", enum: ["post", "photo"] },
  status: { type: "string", description: `One of ${GBP_POST_STATUSES.join(", ")}` },
  requestKey: { type: "string" }, itemIndex: { type: "integer" },
  payload: { type: "object", additionalProperties: true, description: "The post or photo item exactly as queued" },
  schedule: { type: "object", additionalProperties: true },
  dueAt: dateTime, startedAt: dateTime, attempts: { type: "integer" },
  googleName: { ...nullableString, description: "Google's resource name once published" }, googleStatus: nullableString, error: nullableString,
  createdAt: dateTime,
} };

const COLUMNS = "j.id,j.location_id,j.kind,j.status,j.request_key,j.item_index,j.payload,j.schedule,j.due_at,j.started_at,j.attempts,j.google_name,j.google_status,j.error,j.created_at";

export function gbpPostItem(j: Record<string, any>) {
  return {
    id: j.id, locationId: j.location_id, kind: j.kind, status: j.status, requestKey: j.request_key, itemIndex: j.item_index,
    payload: j.payload, schedule: j.schedule ?? {}, dueAt: j.due_at, startedAt: j.started_at, attempts: j.attempts,
    googleName: j.google_name, googleStatus: j.google_status, error: j.error, createdAt: j.created_at,
  };
}

export async function listGbpPosts(scope: Scope, f: GbpPostFilter) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "j", "j.location_id")];
  if (f.locationId) where.push(`j.location_id=${p.add(f.locationId)}`);
  if (f.status) where.push(`j.status=${p.add(f.status)}`);
  if (f.kind) where.push(`j.kind=${p.add(f.kind)}`);
  if (f.requestKey) where.push(`j.request_key=${p.add(f.requestKey)}`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} FROM gbp_content_jobs j WHERE ${sql} ORDER BY j.due_at DESC, j.id DESC LIMIT ${p.add(f.limit)} OFFSET ${p.add(f.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM gbp_content_jobs j WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  return { items: rows.map(gbpPostItem), total };
}

const common = { 401: OPENAPI.errors[401], 402: OPENAPI.errors[402], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] };

export const gbpPostsResource = resource("gbp-posts", {
  tags: [{ name: "GBP posts", description: "The Business Profile post and photo publishing queue." }],
  paths: {
    "/gbp-posts": { get: {
      tags: ["GBP posts"], summary: "List queued, published and failed Business Profile posts/photos", operationId: "listGbpPosts",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("locationId", { type: "integer" }),
        OPENAPI.query("status", { type: "string", enum: [...GBP_POST_STATUSES] }), OPENAPI.query("kind", { type: "string", enum: ["post", "photo"] }),
        OPENAPI.query("requestKey", { type: "string" }, "All items of one bulk request")],
      responses: { ...OPENAPI.list("#/components/schemas/GbpPost"), 400: OPENAPI.errors[400], ...common },
    } },
    "/gbp-posts/{id}": { get: {
      tags: ["GBP posts"], summary: "One queue item", operationId: "getGbpPost",
      parameters: [OPENAPI.idParam("id"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/GbpPost"), ...common },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, GbpPost: GBP_POST_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = gbpPostFilterSchema.extend({ locationId: positiveId.optional() }).parse(req.query ?? {});
    if (q.locationId) await requireLocation(scope, q.locationId);
    const { items, total } = await listGbpPosts(scope, q);
    sendList(res, items, total, q);
  }));

  r.get("/:id", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const p = new Params();
    const where = ownerScopeSql(scope, p, "j", "j.location_id");
    const { rows: [row] } = await pool.query(`SELECT ${COLUMNS} FROM gbp_content_jobs j WHERE ${where} AND j.id=${p.add(id)}`, p.values);
    if (!row) throw new ApiError(404, "not_found", "Post not found");
    sendItem(res, gbpPostItem(row));
  }));
});
