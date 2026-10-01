/**
 * The public API's resources, assembled: every feature resource lives at
 * /api/v1/<name> and a name has ONE router, whatever lane built which half.
 *
 *   account        GET /account
 *   locations      GET /locations, /locations/{id}, /{id}/reviews, /{id}/insights, /{id}/media, /{id}/posts
 *                  POST /locations/{id}/posts            schedule a Google Business Profile update
 *   reviews        GET /reviews, /reviews/{id}
 *                  POST /reviews/{id}/reply              reply to a Google review (publish or draft)
 *   insights       GET /insights?locationId=
 *   photos         GET /photos, /photos/folders
 *   gbp-posts      GET /gbp-posts, /gbp-posts/{id}
 *   social-posts   GET /social-posts, /social-posts/{id}
 *                  POST /social-posts                    schedule a social post (businessId in the body)
 *   site-scans     GET /site-scans, /site-scans/{id}, /site-scans/{id}/report
 *                  POST /site-scans                      start a Site Scan
 *   citations      GET /citations, /citations/campaigns, /citations/campaigns/{id}
 *
 * The write router of a name is mounted BEFORE its read router: the read
 * router ends with the resource's JSON 404, which must only answer once no
 * write route matched. OpenAPI fragments are merged per name (paths by method).
 *
 * NO AI RULE: nothing below reaches openai / ai-config / ai-output / a
 * TruthCoder generator (server/public-api/no-ai.test.ts walks this graph).
 */
import { Router } from "express";
import type { OpenApiFragment as RegistryFragment } from "../registry";
import type { OpenApiFragment } from "./_shared";
import { READ_RESOURCES } from "./index";
import { writeResources, type WriteResourceDeps } from "./index-write";

export type ResourceEntry = { name: string; router: Router; openapi: RegistryFragment };
/** The registry's signature (server/public-api/registry.ts registerResource). */
export type RegisterResource = (name: string, router: Router, openapi: RegistryFragment) => unknown;

function mergeFragments(name: string, fragments: OpenApiFragment[]): RegistryFragment {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {};
  const tags: { name: string; description?: string }[] = [];
  for (const f of fragments) {
    for (const [p, ops] of Object.entries(f.paths ?? {})) {
      const key = p === "" ? "/" : p;
      paths[key] = { ...paths[key], ...(ops as Record<string, unknown>) };
    }
    Object.assign(schemas, f.components?.schemas ?? {});
    for (const t of f.tags ?? []) if (!tags.some((x) => x.name === t.name)) tags.push(t);
  }
  if (!tags.length) tags.push({ name });
  return { paths, components: { schemas }, tags };
}

/** One entry per resource name, in mount order, with reads and writes composed. */
export function composeResources(deps: WriteResourceDeps = {}): ResourceEntry[] {
  const writes = writeResources(deps);
  const order: string[] = [];
  const byName = new Map<string, { routers: Router[]; fragments: OpenApiFragment[] }>();
  const add = (name: string, router: Router, openapi: OpenApiFragment, first: boolean) => {
    let slot = byName.get(name);
    if (!slot) { slot = { routers: [], fragments: [] }; byName.set(name, slot); order.push(name); }
    if (first) { slot.routers.unshift(router); slot.fragments.unshift(openapi); } else { slot.routers.push(router); slot.fragments.push(openapi); }
  };
  for (const r of READ_RESOURCES) add(r.name, r.router, r.openapi, false);
  for (const w of writes) add(w.name, w.router, w.openapi as OpenApiFragment, true);
  return order.map((name) => {
    const { routers, fragments } = byName.get(name)!;
    const router = routers.length === 1 ? routers[0] : Router();
    if (routers.length > 1) for (const r of routers) router.use(r);
    return { name, router, openapi: mergeFragments(name, fragments) };
  });
}

/** Register every resource with the registry (server/public-api/index.ts). Returns the names, in mount order. */
export function registerAllResources(register: RegisterResource, deps: WriteResourceDeps = {}): string[] {
  const entries = composeResources(deps);
  for (const e of entries) register(e.name, e.router, e.openapi);
  return entries.map((e) => e.name);
}
