import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { isPlatformAdminEmail } from "../admin";
import { platformGatePassed, ADMIN_REAUTH_BODY } from "../crm/admin";
import { takeBudget } from "../growth-limits";
import { loadListing } from "../gbp/listing-editor";
import { siteUrl } from "../sitescan/http";
import { profileInput } from "./profile";
import { directoryCreateInput, directoryPatchInput } from "./directory";
import { DirectoryStore, DirectoryError, type Scope } from "./store";
import { catalogueQuery } from "./catalogue-query";
const id = z.coerce.number().int().positive().max(2147483647);
const statuses = z.enum([
  "queued",
  "submitted",
  "needs_owner_action",
  "live",
  "mismatch",
  "duplicate",
  "suppressed",
  "failed",
]);
export function registerDirectoryRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  options: {
    store?: DirectoryStore;
    scope?: (req: Request, res: Response, user: any) => Promise<Scope | null>;
    load?: typeof loadListing;
    budget?: typeof takeBudget;
  } = {},
) {
  const store = options.store ?? new DirectoryStore(pool);
  const load = options.load ?? loadListing;
  const scopeFor =
    options.scope ??
    (async (req, res, user) => {
      // Look up the actual actor, not an agency workspace owner's session-projected email.
      const actorId = (req.user as any)?.id ?? user.id;
      const {
        rows: [actor],
      } = await pool.query("SELECT email FROM users WHERE id=$1", [actorId]);
      const admin = isPlatformAdminEmail(actor?.email);
      if (admin && !platformGatePassed(req)) {
        res.status(403).json(ADMIN_REAUTH_BODY);
        return null;
      }
      return { userId: user.id, actorId, admin };
    });
  const route = (
    method: "get" | "post" | "put" | "patch",
    path: string,
    fn: (req: Request, res: Response, scope: Scope) => Promise<unknown>,
  ) => {
    const handler = async (req: Request, res: Response) => {
      const user = auth(req, res);
      if (!user) return;
      try {
        const scope = await scopeFor(req, res, user);
        if (!scope) return;
        if (
          method !== "get" &&
          !(await (options.budget ?? takeBudget)(
            `directories:${scope.actorId}`,
            30,
            1,
            600_000,
          ))
        )
          throw new DirectoryError(429, "Too many requests; try again later");
        await fn(req, res, scope);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ message: "Invalid input", issues: error.issues });
          return;
        }
        res.status(error instanceof DirectoryError ? error.status : 500).json({
          message:
            error instanceof DirectoryError
              ? error.message
              : "Directory profile operation failed",
        });
      }
    };
    app[method]("/api/directories" + path, handler);
    // Deprecated compatibility alias; both URLs run exactly the same handler.
    app[method]("/api/listings" + path, handler);
  };
  const requireAdmin = (scope: Scope) => {
    if (!scope.admin) throw new DirectoryError(403, "Platform admins only");
  };
  route("get", "/admin/profiles", async (req, res, scope) => {
    requireAdmin(scope);
    const filters = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict()
      .parse(req.query);
    res.json(await store.adminProfiles(scope, filters));
  });
  route("post", "/directories", async (req, res, scope) => {
    requireAdmin(scope);
    res
      .status(201)
      .json(
        await store.saveDirectory(
          scope,
          null,
          directoryCreateInput.parse(req.body),
        ),
      );
  });
  route("patch", "/directories/:id", async (req, res, scope) => {
    requireAdmin(scope);
    res.json(
      await store.saveDirectory(
        scope,
        id.parse(req.params.id),
        directoryPatchInput.parse(req.body),
      ),
    );
  });
  route("get", "/profiles/:locationId", async (req, res, scope) =>
    res.json(await store.profile(scope, id.parse(req.params.locationId))),
  );
  route("put", "/profiles/:locationId", async (req, res, scope) => {
    const edits = profileInput
      .refine((value) => Object.keys(value).length > 0, "Nothing changed")
      .parse(req.body);
    res.json(
      await store.saveProfile(scope, id.parse(req.params.locationId), edits),
    );
  });
  route(
    "post",
    "/profiles/:locationId/import-from-gbp",
    async (req, res, scope) => {
      const locationId = id.parse(req.params.locationId),
        location = await store.location(scope, locationId);
      // If linked Google fails, surface failure. Never relabel stale cached values as a fresh GBP read.
      const google = location.gbp_location_name
        ? (await load(location.user_id, locationId)).location
        : undefined;
      res.json(await store.saveProfile(scope, locationId, null, google));
    },
  );
  route("get", "/directories", async (req, res) => {
    const filters = catalogueQuery.parse(req.query);
    res.json(
      await store.directories(
        filters,
        req.query.limit !== undefined || req.query.offset !== undefined,
      ),
    );
  });
  route("get", "/directories/facets", async (req, res) => {
    res.json(await store.directoryFacets(catalogueQuery.parse(req.query)));
  });
  route("get", "/summary", async (req, res, scope) =>
    res.json(
      await store.summary(scope, id.optional().parse(req.query.location_id)),
    ),
  );
  route("get", "", async (req, res, scope) =>
    res.json(
      await store.list(
        scope,
        z
          .object({
            location_id: id.optional(),
            status: statuses.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .strict()
          .parse(req.query),
      ),
    ),
  );
  route("post", "", async (req, res, scope) => {
    const body = z
      .object({
        profile_id: id,
        directory_id: id,
        listing_url: z.string().max(2048),
      })
      .strict()
      .parse(req.body);
    let url: string;
    try {
      url = siteUrl(body.listing_url);
    } catch {
      throw new DirectoryError(
        400,
        "Use a public HTTP(S) directory profile URL",
      );
    }
    res
      .status(201)
      .json(await store.add(scope, body.profile_id, body.directory_id, url));
  });
  route("post", "/:id/recheck", async (req, res, scope) =>
    res.json(await store.recheck(scope, id.parse(req.params.id))),
  );
  route("get", "/profiles/:locationId/events", async (req, res, scope) =>
    res.json(
      await store.events(
        scope,
        id.parse(req.params.locationId),
        z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .default(100)
          .parse(req.query.limit),
        z.coerce.number().int().min(0).default(0).parse(req.query.after),
      ),
    ),
  );
}
