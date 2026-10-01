/**
 * Public API — Google Business Profile WRITE routes, composed into the read
 * resources of the same names (./register.ts):
 *
 *   POST /api/v1/locations/{locationId}/posts   schedule a Google update (post) with
 *                                               the caller's text, media URLs and time
 *   POST /api/v1/reviews/{reviewId}/reply       reply to a Google review with the
 *                                               caller's text (publish or draft)
 *
 * Both are 5-unit writes. The post is queued in gbp_content_jobs exactly as
 * supplied (source=api) and published by the existing content worker; the
 * reply goes through server/gbp/reply.ts reply() and all of its checks
 * (ownership, Google linkage, usable grant, location lock, Google confirmation).
 * No AI module is imported here or below (gbp/reply.ts is the AI-free half of
 * the GBP service).
 */
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { GoogleError } from "../../gbp/client";
import { ownedLocation, reply as replyToReview } from "../../gbp/reply";
import { logActivity } from "../../account-events";
import { publicMediaUrl } from "@shared/social";
import { handle, idParam, jsonError, openapiCommon, requireWriteScope, type ApiKeyContext } from "./shared-write";

export type GbpWriteDeps = { reply: typeof replyToReview };
export const gbpWriteDefaults: GbpWriteDeps = { reply: replyToReview };

/** API-created jobs carry source='api' so the UI and workers can tell them apart; idempotent, safe before or after the content schema. */
let schemaReady: Promise<void> | null = null;
export function ensurePublicApiWriteSchema() {
  schemaReady ??= pool.query("ALTER TABLE IF EXISTS gbp_content_jobs ADD COLUMN IF NOT EXISTS source text").then(() => undefined, (e) => { schemaReady = null; throw e; });
  return schemaReady;
}

const https = z.string().url().max(2000).refine((v) => new URL(v).protocol === "https:", "HTTPS required");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:MM").refine((value) => {
  const d = new Date(value + "Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 16) === value;
}, "Enter a valid calendar date and time");

/** Mirrors gbp/content.ts itemInput for kind='post', with media as public URLs instead of library photo ids. */
export const gbpPostInput = z.object({
  requestKey: z.string().uuid().optional(),
  text: z.string().trim().min(1, "Post text required").max(1500),
  mediaUrls: z.array(publicMediaUrl).max(10).default([]),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  topicType: z.enum(["STANDARD", "EVENT", "OFFER"]).default("STANDARD"),
  callToAction: z.object({ actionType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]), url: https.optional() }).strict().optional(),
  event: z.object({ title: z.string().min(1).max(58), start: localDateTime, end: localDateTime }).strict().optional(),
  offer: z.object({ couponCode: z.string().max(100).optional(), redeemOnlineUrl: https.optional(), termsConditions: z.string().max(5000).optional() }).strict().optional(),
}).strict().superRefine((v, c) => {
  if (v.topicType !== "STANDARD" && (!v.event || v.event.end <= v.event.start)) c.addIssue({ code: "custom", path: ["event"], message: "Event/offer requires a valid date range" });
  if (v.callToAction && v.callToAction.actionType !== "CALL" && !v.callToAction.url) c.addIssue({ code: "custom", path: ["callToAction", "url"], message: "Call to action URL required" });
});
export type GbpPostInput = z.infer<typeof gbpPostInput>;

const googleDate = (value: string) => {
  const d = new Date(value + "Z");
  return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, time: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() } };
};

/** The Google localPosts payload, built from the caller's fields only (same shape gbp/content.ts payloadFor produces). */
export function gbpPostPayload(v: GbpPostInput) {
  const start = v.event && googleDate(v.event.start), end = v.event && googleDate(v.event.end);
  return {
    languageCode: "en", topicType: v.topicType, summary: v.text,
    ...(v.mediaUrls.length ? { media: v.mediaUrls.map((sourceUrl) => ({ mediaFormat: "PHOTO", sourceUrl })) } : {}),
    ...(v.callToAction && v.topicType !== "OFFER" ? { callToAction: v.callToAction } : {}),
    ...(v.event ? { event: { title: v.event.title, schedule: { startDate: start!.date, startTime: start!.time, endDate: end!.date, endTime: end!.time } } } : {}),
    ...(v.topicType === "OFFER" ? { offer: v.offer || {} } : {}),
  };
}
const sortJson = (value: any): any => Array.isArray(value) ? value.map(sortJson) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortJson(value[k])])) : value;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(sortJson(a)) === JSON.stringify(sortJson(b));

export function gbpPostView(row: any) {
  const p = row.payload || {};
  return {
    id: String(row.id), locationId: row.location_id, requestKey: row.request_key, status: row.status,
    scheduledAt: row.due_at, text: p.summary ?? null, mediaUrls: Array.isArray(p.media) ? p.media.map((m: any) => m.sourceUrl) : [],
    topicType: p.topicType ?? "STANDARD", callToAction: p.callToAction ?? null, event: p.event ?? null, offer: p.offer ?? null,
    source: row.source ?? "api", googleName: row.google_name ?? null, error: row.error ?? null, createdAt: row.created_at,
  };
}

/**
 * Queue one Google update for a linked location. Idempotent on requestKey: the
 * same key with the same content returns the existing job; different content
 * under a used key is a 409.
 */
export async function scheduleGbpPost(userId: number, locationId: number, raw: unknown, meta: { keyId: string; req?: Request | null }) {
  const v = gbpPostInput.parse(raw);
  await ensurePublicApiWriteSchema();
  const { rows: [owned] } = await pool.query("SELECT id,gbp_location_name FROM business_locations WHERE id=$1 AND user_id=$2", [locationId, userId]);
  if (!owned) throw new GoogleError("invalid", "Location not found", 404);
  if (!owned.gbp_location_name) throw new GoogleError("invalid", "This location is not linked to a Google Business Profile listing", 409);
  const loc = await ownedLocation(userId, locationId);
  const target = { account: loc.gbp_account_name, location: loc.gbp_location_name, subject: loc.gbp_google_subject };
  const payload = gbpPostPayload(v);
  const requestKey = v.requestKey ?? randomUUID();
  const dueAt = v.scheduledAt ? new Date(v.scheduledAt) : new Date();
  const c = await pool.connect();
  let outcome: { created: boolean; row: any };
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1,hashtext($2))", [userId, requestKey]);
    const { rows: previous } = await c.query("SELECT * FROM gbp_content_jobs WHERE user_id=$1 AND request_key=$2 ORDER BY item_index", [userId, requestKey]);
    if (previous.length) {
      outcome = { created: false, row: previous };
    } else {
      const { rows: [row] } = await c.query(
        `INSERT INTO gbp_content_jobs(user_id,location_id,request_key,item_index,kind,payload,due_at,target,schedule,source)
         VALUES($1,$2,$3,0,'post',$4,$5,$6,'{}'::jsonb,'api') RETURNING *`,
        [userId, locationId, requestKey, JSON.stringify(payload), dueAt, JSON.stringify(target)],
      );
      outcome = { created: true, row };
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  if (!outcome.created) {
    const previous: any[] = outcome.row, [p] = previous;
    if (previous.length !== 1 || p.location_id !== locationId || p.kind !== "post" || !sameJson(p.payload, payload)) {
      throw new GoogleError("invalid", "requestKey was already used for different content", 409);
    }
    return { created: false, row: p };
  }
  await logActivity(meta.req ?? null, userId, "api.gbp.post_scheduled", { jobId: outcome.row.id, locationId, keyId: meta.keyId, scheduledAt: dueAt.toISOString() }).catch(() => {});
  return outcome;
}

export const gbpReplyInput = z.object({
  text: z.string().min(1, "Reply text required").max(4096),
  /** true (default) publishes to Google through the existing reply path; false saves a draft for the owner. */
  publish: z.boolean().default(true),
}).strict();

/** `locations` resource: POST /{locationId}/posts. Scope is checked per route so the read routes of the resource are untouched. */
export function gbpPostsWriteRouter(_deps: GbpWriteDeps = gbpWriteDefaults) {
  const router = Router();
  router.post("/:locationId/posts", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const locationId = idParam.parse(req.params.locationId);
    const { created, row } = await scheduleGbpPost(key.userId, locationId, req.body ?? {}, { keyId: key.id, req });
    res.status(created ? 201 : 200).json({ post: gbpPostView(row), created });
  }));
  return router;
}

/** `reviews` resource: POST /{reviewId}/reply. */
export function gbpReplyWriteRouter(deps: GbpWriteDeps = gbpWriteDefaults) {
  const router = Router();
  router.post("/:reviewId/reply", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const reviewId = idParam.parse(req.params.reviewId);
    const { text, publish } = gbpReplyInput.parse(req.body ?? {});
    if (publish && !text.trim()) return jsonError(res, 400, "validation_error", "Reply text required", { issues: [{ path: "text", message: "Reply text required" }] });
    // The existing reply path: ownership (404), Google linkage, grant checks, the location lock, Google's confirmation.
    const result: any = await deps.reply(key.userId, reviewId, text, publish ? "publish" : "draft", undefined, { req });
    await logActivity(req, key.userId, "api.gbp.review_replied", { reviewId, keyId: key.id, published: publish }).catch(() => {});
    res.status(publish ? 200 : 201).json({
      reply: { reviewId, status: result.replyStatus, comment: result.replyComment ?? null, draft: result.replyDraft ?? null, published: publish && result.replyStatus === "posted", source: "api" },
    });
  }));
  return router;
}

/** Fragment for the `locations` resource (paths relative to /api/v1/locations). */
export const gbpPostsWriteOpenapi = {
  paths: {
    // The same templated path as the read lane's GET /locations/{id}/posts (one path, two methods in openapi.json).
    "/{id}/posts": {
      post: {
        ...openapiCommon.writeOperation("Schedule a Google Business Profile update (post) with your own text, media URLs and time", "locations"),
        operationId: "scheduleGbpPost",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Location id" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/GbpPostInput" } } } },
        responses: {
          "201": { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/GbpPostResult" } } } },
          "200": { description: "Already queued under this requestKey (idempotent replay)", content: { "application/json": { schema: { $ref: "#/components/schemas/GbpPostResult" } } } },
          "400": openapiCommon.errorResponse("validation_error"), "403": openapiCommon.errorResponse("insufficient_scope — the key lacks the write scope"),
          "404": openapiCommon.errorResponse("not_found — no such location of yours"), "409": openapiCommon.errorResponse("conflict — location not linked to Google, or requestKey reused with different content"),
        },
      },
    },
  },
  components: {
    schemas: {
      GbpPostInput: {
        type: "object", required: ["text"],
        properties: {
          requestKey: { type: "string", format: "uuid", description: "Idempotency key; the same key + content returns the existing job" },
          text: { type: "string", maxLength: 1500 },
          mediaUrls: { type: "array", maxItems: 10, items: { type: "string", format: "uri", description: "Public HTTPS image URL (Google fetches it)" } },
          scheduledAt: { type: "string", format: "date-time", description: "When to publish; omitted or past = as soon as the worker runs" },
          topicType: { type: "string", enum: ["STANDARD", "EVENT", "OFFER"], default: "STANDARD" },
          callToAction: { type: "object", properties: { actionType: { type: "string", enum: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"] }, url: { type: "string", format: "uri" } } },
          event: { type: "object", properties: { title: { type: "string", maxLength: 58 }, start: { type: "string", example: "2026-10-01T09:00" }, end: { type: "string", example: "2026-10-01T17:00" } } },
          offer: { type: "object", properties: { couponCode: { type: "string" }, redeemOnlineUrl: { type: "string", format: "uri" }, termsConditions: { type: "string" } } },
        },
      },
      GbpPostResult: {
        type: "object",
        properties: {
          created: { type: "boolean" },
          post: { type: "object", properties: {
            id: { type: "string" }, locationId: { type: "integer" }, requestKey: { type: "string" }, status: { type: "string", enum: ["queued", "publishing", "published", "rejected", "failed", "uncertain", "cancelled"] },
            scheduledAt: { type: "string", format: "date-time" }, text: { type: "string" }, mediaUrls: { type: "array", items: { type: "string" } }, topicType: { type: "string" },
            source: { type: "string", enum: ["api"] }, googleName: { type: "string", nullable: true }, error: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" },
          } },
        },
      },
    },
  },
};

/** Fragment for the `reviews` resource (paths relative to /api/v1/reviews). */
export const gbpReplyWriteOpenapi = {
  paths: {
    "/{id}/reply": {
      post: {
        ...openapiCommon.writeOperation("Reply to a Google review with your own text (publish to Google, or save a draft)", "reviews"),
        operationId: "replyToGbpReview",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" }, description: "Review id" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/GbpReplyInput" } } } },
        responses: {
          "200": { description: "Published to Google", content: { "application/json": { schema: { $ref: "#/components/schemas/GbpReplyResult" } } } },
          "201": { description: "Draft saved", content: { "application/json": { schema: { $ref: "#/components/schemas/GbpReplyResult" } } } },
          "400": openapiCommon.errorResponse("validation_error, or the review is not an active Google review"),
          "403": openapiCommon.errorResponse("insufficient_scope, or google_permission / google_api_disabled"),
          "404": openapiCommon.errorResponse("not_found — no such review of yours"), "409": openapiCommon.errorResponse("google_reconnect_required, or conflict — the location is busy"),
          "503": openapiCommon.errorResponse("google_unavailable — Google did not confirm the reply"),
        },
      },
    },
  },
  components: {
    schemas: {
      GbpReplyInput: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 4096 }, publish: { type: "boolean", default: true, description: "false saves a draft for the owner instead of publishing" } } },
      GbpReplyResult: {
        type: "object",
        properties: { reply: { type: "object", properties: {
          reviewId: { type: "integer" }, status: { type: "string", enum: ["draft", "posted"] }, comment: { type: "string", nullable: true }, draft: { type: "string", nullable: true },
          published: { type: "boolean" }, source: { type: "string", enum: ["api"] },
        } } },
      },
    },
  },
};
