/**
 * The public API's READ resources (lane l6-api-read). The registry (server/public-api/index.ts,
 * lane 1) calls `registerReadResources(registerResource)` once; each resource is then mounted at
 * /api/v1/<name> behind the registry's auth, scope, rate-limit, quota and metering middleware,
 * and its OpenAPI fragment joins /api/v1/openapi.json.
 *
 * Resources and their routes (relative to /api/v1):
 *   account       GET /account
 *   locations     GET /locations, /locations/{id}, /locations/{id}/reviews, /locations/{id}/insights,
 *                 /locations/{id}/media, /locations/{id}/posts
 *   reviews       GET /reviews, /reviews/{id}
 *   insights      GET /insights?locationId=
 *   photos        GET /photos, /photos/folders
 *   gbp-posts     GET /gbp-posts, /gbp-posts/{id}
 *   social-posts  GET /social-posts, /social-posts/{id}
 *   site-scans    GET /site-scans, /site-scans/{id}, /site-scans/{id}/report
 *   citations     GET /citations, /citations/campaigns, /citations/campaigns/{id}
 *
 * None of the names collide with the CRM's /api/v1 resources (customers, projects, estimates,
 * invoices, payments, ping), so they can share the /api/v1 root.
 */
import type { ReadResource, RegisterResource } from "./_shared";
import { accountResource } from "./account";
import { locationsResource } from "./locations";
import { reviewsResource } from "./reviews";
import { insightsResource } from "./insights";
import { photosResource } from "./photos";
import { gbpPostsResource } from "./gbp-posts";
import { socialPostsResource } from "./social-posts";
import { siteScansResource } from "./site-scans";
import { citationsResource } from "./citations";

export type { ReadResource, RegisterResource, OpenApiFragment, ApiKeyContext } from "./_shared";
export { readUnits } from "./_shared";

export const READ_RESOURCES: readonly ReadResource[] = [
  accountResource, locationsResource, reviewsResource, insightsResource, photosResource,
  gbpPostsResource, socialPostsResource, siteScansResource, citationsResource,
];

/** Register every read resource with the registry. Returns the resource names, in mount order. */
export function registerReadResources(register: RegisterResource): string[] {
  for (const r of READ_RESOURCES) register(r.name, r.router, r.openapi);
  return READ_RESOURCES.map((r) => r.name);
}
