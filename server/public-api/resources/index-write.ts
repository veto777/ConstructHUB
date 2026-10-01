/**
 * Public API — entry point for the WRITE resources (lane l7-api-write).
 *
 * Lane 1's server/public-api/index.ts calls `registerWriteResources(registerResource)`
 * once it has built its router stack (API-key auth → scope check → 60/min rate
 * limit → monthly units → metering). Each resource is a plain Express router
 * mounted at `${GROWTH_BASE}/<name>` and an OpenAPI fragment for
 * GET /api/v1/openapi.json.
 *
 *   gbp       POST /locations/{locationId}/posts, POST /reviews/{reviewId}/reply
 *   social    POST /businesses/{businessId}/posts
 *   sitescan  POST /scans
 *
 * Also exported for the app: `rejectApiKeysOutsidePublicApi` (mount app-wide so
 * a `chub_` bearer answers 401 on every non-/api/v1 route, the AI routes
 * included) and `ensurePublicApiWriteSchema` (idempotent; also run lazily).
 */
import { gbpWriteRouter, gbpWriteOpenapi, gbpWriteDefaults, type GbpWriteDeps } from "./gbp-write";
import { socialWriteRouter, socialWriteOpenapi, socialWriteDefaults, type SocialWriteDeps } from "./social-write";
import { sitescanWriteRouter, sitescanWriteOpenapi, sitescanWriteDefaults, type SitescanWriteDeps } from "./sitescan-write";
import type { RegisterResource } from "./shared-write";

export { GROWTH_BASE, WRITE_UNITS, API_KEY_BEARER, rejectApiKeysOutsidePublicApi, requireWriteScope, apiKeyContext, type ApiKeyContext, type RegisterResource } from "./shared-write";
export { ensurePublicApiWriteSchema } from "./gbp-write";

export type WriteResourceDeps = { gbp?: GbpWriteDeps; social?: SocialWriteDeps; sitescan?: SitescanWriteDeps };

/** Every write resource with its router factory and OpenAPI fragment, in mount order. */
export function writeResources(deps: WriteResourceDeps = {}) {
  return [
    { name: "gbp", router: gbpWriteRouter(deps.gbp ?? gbpWriteDefaults), openapi: gbpWriteOpenapi },
    { name: "social", router: socialWriteRouter(deps.social ?? socialWriteDefaults), openapi: socialWriteOpenapi },
    { name: "sitescan", router: sitescanWriteRouter(deps.sitescan ?? sitescanWriteDefaults), openapi: sitescanWriteOpenapi },
  ] as const;
}

/** Register the write resources with lane 1's registry (one call per resource; a name may be registered once). */
export function registerWriteResources(registerResource: RegisterResource, deps: WriteResourceDeps = {}) {
  for (const r of writeResources(deps)) registerResource(r.name, r.router, r.openapi);
}

/** The write operations' OpenAPI paths + schemas merged (what the fragments add to /api/v1/openapi.json). */
export function writeOpenapiFragment() {
  const paths: Record<string, unknown> = {}, schemas: Record<string, unknown> = {};
  for (const f of [gbpWriteOpenapi, socialWriteOpenapi, sitescanWriteOpenapi]) {
    Object.assign(paths, f.paths);
    Object.assign(schemas, f.components.schemas);
  }
  return { paths, components: { schemas } };
}
