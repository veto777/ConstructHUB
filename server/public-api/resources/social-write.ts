/**
 * Public API — Social Media WRITE route, composed into the `social-posts`
 * resource (./register.ts):
 *
 *   POST /api/v1/social-posts   schedule the caller's text (and media URLs) to
 *                               a business's connected, mapped destinations
 *
 * A 5-unit write. The body is the Social Media page's contract
 * (shared/social.ts postSchema) plus `businessId`, and goes through
 * server/social/schedule.ts createPosts(): request-id idempotency,
 * destination/mapping validation, per-platform text and media rules, the user
 * lock. Rows are stored exactly as supplied with source='api',
 * ai_generated=false and auto_generated=false, so no AI worker ever touches
 * them. No AI module is imported here or below (social/schedule.ts is the
 * AI-free half of the social service).
 */
import { Router, type Request } from "express";
import { pool } from "../../db";
import { SocialError } from "../../social/client";
import { createPosts as createSocialPosts, ownedBusiness } from "../../social/schedule";
import { logActivity } from "../../account-events";
import { postSchema } from "@shared/social";
import { handle, idParam, openapiCommon, requireWriteScope, type ApiKeyContext } from "./shared-write";

export type SocialWriteDeps = { createPosts: typeof createSocialPosts };
export const socialWriteDefaults: SocialWriteDeps = { createPosts: createSocialPosts };

/** The page's post contract plus the business the post belongs to. */
export const socialPostInput = postSchema.extend({ businessId: idParam });

export function socialPostView(row: any) {
  const content = row.payload?.post?.content ?? {};
  return {
    id: row.id, businessId: row.business_id, requestId: row.request_id, state: row.state,
    platform: content.platform ?? null, destinationKey: row.destination_key, text: content.text ?? null,
    mediaUrls: Array.isArray(content.mediaUrls) ? content.mediaUrls : [],
    scheduledAt: row.scheduled_at, dueAt: row.due_at, source: row.source ?? "api", aiGenerated: !!row.ai_generated,
    publicUrl: row.public_url ?? null, error: row.error ?? null, createdAt: row.created_at,
  };
}

/** Schedule the caller's post to a business's mapped destinations; idempotent on requestId (same content replays). */
export async function scheduleSocialPost(userId: number, raw: unknown, meta: { keyId: string; req?: Request | null }, deps: SocialWriteDeps = socialWriteDefaults) {
  const { businessId, ...input } = socialPostInput.parse(raw);
  if (!(await ownedBusiness(userId, businessId))) throw new SocialError("Business not found", 404);
  const rows = await deps.createPosts(userId, input, businessId);
  const ids = rows.map((r: any) => r.id);
  // Mark the API as the author; a replay of an existing request keeps whatever source it had.
  const { rows: updated } = await pool.query(
    "UPDATE social_posts SET source='api' WHERE user_id=$1 AND business_id=$2 AND id=ANY($3::uuid[]) AND source IS NULL RETURNING id",
    [userId, businessId, ids],
  );
  const created = updated.length === rows.length && rows.length > 0;
  if (created) await logActivity(meta.req ?? null, userId, "api.social.post_scheduled", { businessId, requestId: input.requestId, count: rows.length, keyId: meta.keyId, draft: input.draft }).catch(() => {});
  return { created, rows: rows.map((r: any) => ({ ...r, source: updated.some((u: any) => u.id === r.id) ? "api" : r.source })) };
}

/** `social-posts` resource: POST /. */
export function socialWriteRouter(deps: SocialWriteDeps = socialWriteDefaults) {
  const router = Router();
  router.post("/", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const { created, rows } = await scheduleSocialPost(key.userId, req.body ?? {}, { keyId: key.id, req }, deps);
    res.status(created ? 201 : 200).json({ posts: rows.map(socialPostView), created });
  }));
  return router;
}

/** Fragment for the `social-posts` resource (paths relative to /api/v1/social-posts). */
export const socialWriteOpenapi = {
  paths: {
    "/": {
      post: {
        ...openapiCommon.writeOperation("Schedule a social post with your own text to a business's connected destinations", "social-posts"),
        operationId: "scheduleSocialPost",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostInput" } } } },
        responses: {
          "201": { description: "Queued (one row per destination)", content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostResult" } } } },
          "200": { description: "Already queued under this requestId (idempotent replay)", content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostResult" } } } },
          "400": openapiCommon.errorResponse("validation_error (platform text limits, media rules, past schedule time)"),
          "403": openapiCommon.errorResponse("insufficient_scope — the key lacks the write scope"), "404": openapiCommon.errorResponse("not_found — no such business of yours"),
          "409": openapiCommon.errorResponse("conflict — social account not connected, destinations not mapped to this business, requestId reused, or the queue is busy"),
        },
      },
    },
  },
  components: {
    schemas: {
      SocialDestination: {
        type: "object", required: ["accountId", "platform"],
        properties: {
          accountId: { type: "string" }, platform: { type: "string", enum: ["twitter", "facebook", "instagram", "linkedin", "threads", "bluesky", "tiktok", "youtube", "pinterest"] },
          pageId: { type: "string" }, boardId: { type: "string" }, title: { type: "string", maxLength: 100 },
          privacy: { type: "string", enum: ["public", "private", "unlisted"], default: "private" },
          tiktokPublic: { type: "boolean", default: false }, isBrandedContent: { type: "boolean", default: false }, isYourBrand: { type: "boolean", default: false },
        },
      },
      SocialPostInput: {
        type: "object", required: ["businessId", "requestId", "text", "destinations"],
        properties: {
          businessId: { type: "integer", description: "The location (business) whose connected social accounts publish the post" },
          requestId: { type: "string", format: "uuid", description: "Idempotency key" },
          text: { type: "string", maxLength: 63206 },
          destinations: { type: "array", minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/SocialDestination" }, description: "Must be mapped to the business in Social Media settings" },
          tweaks: { type: "object", additionalProperties: { type: "string" }, description: "Per-platform text overrides, keyed by platform" },
          mediaUrls: { type: "array", maxItems: 10, items: { type: "string", format: "uri" } },
          scheduledTime: { type: "string", format: "date-time", description: "Future publish time; omitted = next worker run" },
          draft: { type: "boolean", default: false, description: "true saves drafts for approval instead of queueing" },
        },
      },
      SocialPostResult: {
        type: "object",
        properties: {
          created: { type: "boolean" },
          posts: { type: "array", items: { type: "object", properties: {
            id: { type: "string", format: "uuid" }, businessId: { type: "integer" }, requestId: { type: "string" }, state: { type: "string", enum: ["draft", "queued", "submitting", "submitted", "published", "failed", "uncertain", "cancelled"] },
            platform: { type: "string" }, destinationKey: { type: "string" }, text: { type: "string" }, mediaUrls: { type: "array", items: { type: "string" } },
            scheduledAt: { type: "string", format: "date-time", nullable: true }, dueAt: { type: "string", format: "date-time" }, source: { type: "string", enum: ["api"] },
            aiGenerated: { type: "boolean", enum: [false] }, publicUrl: { type: "string", nullable: true }, error: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" },
          } } },
        },
      },
    },
  },
};
