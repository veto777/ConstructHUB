/**
 * Public API — Social Media WRITE resource (`social`), mounted by lane 1 at
 * `${GROWTH_BASE}/social`:
 *
 *   POST /businesses/{businessId}/posts   schedule the caller's text (and media
 *                                         URLs) to that business's connected,
 *                                         mapped destinations
 *
 * A 5-unit write. The body is the same contract the Social Media page uses
 * (shared/social.ts postSchema) and goes through server/social/service.ts
 * createPosts(): request-id idempotency, destination/mapping validation,
 * per-platform text and media rules, the user lock. Rows are stored exactly as
 * supplied with source='api', ai_generated=false and auto_generated=false, so
 * no AI worker ever touches them. No AI module is imported here.
 */
import { Router, type Request } from "express";
import { pool } from "../../db";
import { SocialError } from "../../social/client";
import { createPosts as createSocialPosts, ownedBusiness } from "../../social/service";
import { logActivity } from "../../account-events";
import { postSchema } from "@shared/social";
import { GROWTH_BASE, handle, idParam, openapiCommon, requireWriteScope, type ApiKeyContext } from "./shared-write";

export type SocialWriteDeps = { createPosts: typeof createSocialPosts };
export const socialWriteDefaults: SocialWriteDeps = { createPosts: createSocialPosts };

export const socialPostInput = postSchema;

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
export async function scheduleSocialPost(userId: number, businessId: number, raw: unknown, meta: { keyId: string; req?: Request | null }, deps: SocialWriteDeps = socialWriteDefaults) {
  const input = socialPostInput.parse(raw);
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

export function socialWriteRouter(deps: SocialWriteDeps = socialWriteDefaults) {
  const router = Router();
  router.post("/businesses/:businessId/posts", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const businessId = idParam.parse(req.params.businessId);
    const { created, rows } = await scheduleSocialPost(key.userId, businessId, req.body ?? {}, { keyId: key.id, req }, deps);
    res.status(created ? 201 : 200).json({ posts: rows.map(socialPostView), created });
  }));
  return router;
}

const base = `${GROWTH_BASE}/social`;
export const socialWriteOpenapi = {
  paths: {
    [`${base}/businesses/{businessId}/posts`]: {
      post: {
        ...openapiCommon.writeOperation("Schedule a social post with your own text to a business's connected destinations", "social"),
        operationId: "scheduleSocialPost",
        parameters: [{ name: "businessId", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostInput" } } } },
        responses: {
          "201": { description: "Queued (one row per destination)", content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostResult" } } } },
          "200": { description: "Already queued under this requestId (idempotent replay)", content: { "application/json": { schema: { $ref: "#/components/schemas/SocialPostResult" } } } },
          "400": openapiCommon.errorResponse("Validation failed (platform text limits, media rules, past schedule time)"),
          "403": openapiCommon.errorResponse("Key lacks the write scope"), "404": openapiCommon.errorResponse("Business not found"),
          "409": openapiCommon.errorResponse("Social account not connected, destinations not mapped to this business, requestId reused, or the queue is busy"),
        },
      },
    },
  },
  components: {
    schemas: {
      ...openapiCommon.schemas,
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
        type: "object", required: ["requestId", "text", "destinations"],
        properties: {
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
