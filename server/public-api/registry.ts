/**
 * Resource registry for the public API. A feature module registers its
 * resource from its own file:
 *
 *   import { registerResource } from "../public-api";
 *   const posts = Router();
 *   posts.get("/", async (req, res) => { … res.json({ data: rows, hasMore }) });
 *   posts.post("/", async (req, res) => { … });
 *   registerResource("posts", posts, { paths: { "/": {…}, "/{id}": {…} } });
 *
 * The router is served at /api/v1/<name> behind the shared auth, scope,
 * rate-limit and quota middleware (server/public-api/index.ts): by the time a
 * resource handler runs, req.publicApi holds the account and key, GET/HEAD
 * have passed the `read` scope and every other method the `write` scope, and
 * the response is metered when it is sent (set res.locals.apiRows to the row
 * count when the body does not carry a `data`/`items` array).
 *
 * OpenAPI fragment paths are RELATIVE to the resource ("/" and "/{id}"); the
 * assembler prefixes them with /<name>.
 *
 * NO AI RULE: a resource file must not import OpenAI or any TruthCoder
 * generator; server/public-api/no-ai.test.ts walks the import graph.
 */
import { Router } from "express";

export type OpenApiFragment = {
  /** Keys relative to the resource: "/" → /api/v1/<name>, "/{id}" → /api/v1/<name>/{id}. */
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
  tags?: { name: string; description?: string }[];
};

export type PublicResource = { name: string; router: Router; openapi: OpenApiFragment };

/** lowercase, digits and dashes; "/" separates a nested resource (billing/invoices). */
export const RESOURCE_NAME_RE = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

/**
 * Top-level paths the CRM's chk_-key API already serves at /api/v1
 * (server/crm/integrations.ts). The auth middleware hands those requests to
 * the CRM untouched, so no chub_ resource may take their names.
 */
export const CRM_RESERVED: ReadonlySet<string> = new Set(["customers", "projects", "estimates", "invoices", "payments", "ping"]);
/** Served by the public API itself. */
export const BUILT_IN: ReadonlySet<string> = new Set(["openapi.json", "me"]);

const resources = new Map<string, PublicResource>();

/** The router every registered resource hangs off; index.ts mounts it after the middleware. */
export const resourceRouter = Router();

export function registerResource(name: string, router: Router, openapi: OpenApiFragment = {}): PublicResource {
  if (!RESOURCE_NAME_RE.test(name)) {
    throw new Error(`registerResource: "${name}" is not a valid resource name (lowercase letters, digits, dashes; "/" for nesting)`);
  }
  const top = name.split("/")[0];
  if (CRM_RESERVED.has(top)) {
    throw new Error(`registerResource: "/api/v1/${top}" belongs to the CRM chk_-key API; choose another name (e.g. "billing/${top}")`);
  }
  if (BUILT_IN.has(top)) throw new Error(`registerResource: "${name}" is served by the public API itself`);
  if (resources.has(name)) throw new Error(`registerResource: "${name}" is already registered`);
  if (!router || typeof router !== "function") throw new Error(`registerResource: "${name}" needs an express Router`);
  const resource: PublicResource = { name, router, openapi: openapi ?? {} };
  resources.set(name, resource);
  resourceRouter.use(`/${name}`, router);
  return resource;
}

/** Registered resources in registration order. */
export function listResources(): PublicResource[] {
  return [...resources.values()];
}
