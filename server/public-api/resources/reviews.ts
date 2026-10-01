/**
 * /api/v1/reviews — Google reviews as synced (list with filters, detail). The AI reply draft is
 * not part of the API: it is the in-app assistant's working text, and the API exposes no AI feature.
 */
import { z } from "zod";
import { pool } from "../../db";
import {
  OPENAPI, Params, type Scope, dateTime, handler, isoDate, nullableInt, nullableString, ownerScopeSql, pageSchema, positiveId,
  requireLocation, resource, sendItem, sendList, ApiError,
} from "./_shared";

export const reviewFilterSchema = pageSchema.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  unanswered: z.enum(["true", "false"]).optional(),
  since: isoDate.optional(),
  until: isoDate.optional(),
  includeDeleted: z.enum(["true", "false"]).default("false"),
});
export type ReviewFilter = z.infer<typeof reviewFilterSchema> & { locationId?: number };

export const REVIEW_FILTERS = [
  OPENAPI.query("rating", { type: "integer", minimum: 1, maximum: 5 }),
  OPENAPI.query("minRating", { type: "integer", minimum: 1, maximum: 5 }),
  OPENAPI.query("unanswered", { type: "string", enum: ["true", "false"] }, "Only reviews without (or with) a published reply"),
  OPENAPI.query("since", { type: "string", format: "date" }, "Review date on or after"),
  OPENAPI.query("until", { type: "string", format: "date" }, "Review date on or before"),
  OPENAPI.query("includeDeleted", { type: "string", enum: ["true", "false"], default: "false" }, "Include reviews Google has since removed"),
];

export const REVIEW_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, locationId: nullableInt, googleReviewId: nullableString,
  reviewer: { type: "object", properties: { name: { type: "string" }, photoUrl: nullableString, profileUrl: nullableString } },
  rating: { type: "integer" }, comment: nullableString, reviewDate: dateTime,
  reply: { type: "object", properties: { comment: nullableString, status: { type: "string" }, date: dateTime, error: nullableString } },
  isNew: { type: "boolean", nullable: true }, googleDeleted: { type: "boolean" }, internalNote: nullableString,
  createdAt: dateTime, updatedAt: dateTime,
} };

const COLUMNS = "r.id,r.location_id,r.google_review_id,r.reviewer_name,r.reviewer_photo_url,r.reviewer_profile_url,r.rating,r.comment,r.review_date,r.reply_comment,r.reply_status,r.reply_date,r.reply_error,r.is_new,r.google_deleted,r.internal_note,r.created_at,r.updated_at";

export function reviewItem(r: Record<string, any>) {
  return {
    id: r.id, locationId: r.location_id, googleReviewId: r.google_review_id,
    reviewer: { name: r.reviewer_name, photoUrl: r.reviewer_photo_url, profileUrl: r.reviewer_profile_url },
    rating: r.rating, comment: r.comment, reviewDate: r.review_date,
    reply: { comment: r.reply_comment, status: r.reply_status, date: r.reply_date, error: r.reply_error },
    isNew: r.is_new, googleDeleted: r.google_deleted, internalNote: r.internal_note,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function listReviews(scope: Scope, f: ReviewFilter) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "r", "r.location_id")];
  if (f.locationId) where.push(`r.location_id=${p.add(f.locationId)}`);
  if (f.rating) where.push(`r.rating=${p.add(f.rating)}`);
  if (f.minRating) where.push(`r.rating>=${p.add(f.minRating)}`);
  if (f.unanswered === "true") where.push("r.reply_comment IS NULL");
  if (f.unanswered === "false") where.push("r.reply_comment IS NOT NULL");
  if (f.since) where.push(`r.review_date >= ${p.add(f.since)}::date`);
  if (f.until) where.push(`r.review_date < (${p.add(f.until)}::date + 1)`);
  if (f.includeDeleted !== "true") where.push("NOT r.google_deleted");
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} FROM google_profile_reviews r WHERE ${sql} ORDER BY r.review_date DESC, r.id DESC LIMIT ${p.add(f.limit)} OFFSET ${p.add(f.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM google_profile_reviews r WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  return { items: rows.map(reviewItem), total };
}

const common = { 401: OPENAPI.errors[401], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] };

export const reviewsResource = resource("reviews", {
  tags: [{ name: "Reviews", description: "Google reviews as synced from Business Profile." }],
  paths: {
    "/reviews": { get: {
      tags: ["Reviews"], summary: "List reviews", operationId: "listReviews",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("locationId", { type: "integer" }), ...REVIEW_FILTERS],
      responses: { ...OPENAPI.list("#/components/schemas/Review"), 400: OPENAPI.errors[400], ...common },
    } },
    "/reviews/{id}": { get: {
      tags: ["Reviews"], summary: "One review", operationId: "getReview",
      parameters: [OPENAPI.idParam("id"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/Review"), ...common },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, Review: REVIEW_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = reviewFilterSchema.extend({ locationId: positiveId.optional() }).parse(req.query ?? {});
    if (q.locationId) await requireLocation(scope, q.locationId);
    const { items, total } = await listReviews(scope, q);
    sendList(res, items, total, q);
  }));

  r.get("/:id", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const p = new Params();
    const where = ownerScopeSql(scope, p, "r", "r.location_id");
    const { rows: [row] } = await pool.query(`SELECT ${COLUMNS} FROM google_profile_reviews r WHERE ${where} AND r.id=${p.add(id)}`, p.values);
    if (!row) throw new ApiError(404, "not_found", "Review not found");
    sendItem(res, reviewItem(row));
  }));
});
