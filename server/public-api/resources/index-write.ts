/**
 * Public API — entry point for the WRITE routes. Each entry names the read
 * resource it joins (./register.ts composes one router per name, write routes
 * first) and carries an OpenAPI fragment whose paths are relative to
 * /api/v1/<name>:
 *
 *   locations      POST /{locationId}/posts    schedule a Google Business Profile update
 *   reviews        POST /{reviewId}/reply      reply to a Google review
 *   social-posts   POST /                      schedule a social post (businessId in the body)
 *   site-scans     POST /                      start a Site Scan
 *
 * `ensurePublicApiWriteSchema` (idempotent; also run lazily) adds the
 * gbp_content_jobs.source column API-created jobs carry.
 */
import { gbpPostsWriteRouter, gbpReplyWriteRouter, gbpPostsWriteOpenapi, gbpReplyWriteOpenapi, gbpWriteDefaults, type GbpWriteDeps } from "./gbp-write";
import { socialWriteRouter, socialWriteOpenapi, socialWriteDefaults, type SocialWriteDeps } from "./social-write";
import { sitescanWriteRouter, sitescanWriteOpenapi, sitescanWriteDefaults, type SitescanWriteDeps } from "./sitescan-write";
import type { RegisterResource } from "./shared-write";

export { PUBLIC_API_BASE, WRITE_UNITS, API_KEY_BEARER, rejectApiKeysOutsidePublicApi, requireWriteScope, apiKeyContext, type ApiKeyContext, type RegisterResource } from "./shared-write";
export { ensurePublicApiWriteSchema } from "./gbp-write";

export type WriteResourceDeps = { gbp?: GbpWriteDeps; social?: SocialWriteDeps; sitescan?: SitescanWriteDeps };

/** Every write route with its router factory and OpenAPI fragment, keyed by the resource it joins, in mount order. */
export function writeResources(deps: WriteResourceDeps = {}) {
  const gbp = deps.gbp ?? gbpWriteDefaults;
  return [
    { name: "locations", router: gbpPostsWriteRouter(gbp), openapi: gbpPostsWriteOpenapi },
    { name: "reviews", router: gbpReplyWriteRouter(gbp), openapi: gbpReplyWriteOpenapi },
    { name: "social-posts", router: socialWriteRouter(deps.social ?? socialWriteDefaults), openapi: socialWriteOpenapi },
    { name: "site-scans", router: sitescanWriteRouter(deps.sitescan ?? sitescanWriteDefaults), openapi: sitescanWriteOpenapi },
  ] as const;
}

/** Register the write routes on their own (tests); the app composes them with the reads through ./register.ts. */
export function registerWriteResources(registerResource: RegisterResource, deps: WriteResourceDeps = {}) {
  for (const r of writeResources(deps)) registerResource(r.name, r.router, r.openapi);
}

/** The write operations' OpenAPI paths (absolute, /api/v1-relative) + schemas merged (what the fragments add to openapi.json). */
export function writeOpenapiFragment() {
  const paths: Record<string, unknown> = {}, schemas: Record<string, unknown> = {};
  for (const r of writeResources()) {
    for (const [p, ops] of Object.entries(r.openapi.paths)) paths[p === "/" ? `/${r.name}` : `/${r.name}${p}`] = ops;
    Object.assign(schemas, r.openapi.components.schemas);
  }
  return { paths, components: { schemas } };
}
