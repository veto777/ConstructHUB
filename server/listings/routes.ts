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
import { ListingStore, ListingError, type Scope } from "./store";
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
export function registerListingsRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  options: {
    store?: ListingStore;
    scope?: (req: Request, res: Response, user: any) => Promise<Scope | null>;
    load?: typeof loadListing;
    budget?: typeof takeBudget;
  } = {},
) {
  const store = options.store ?? new ListingStore(pool);
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
    app[method]("/api/listings" + path, async (req, res) => {
      const user = auth(req, res);
      if (!user) return;
      try {
        const scope = await scopeFor(req, res, user);
        if (!scope) return;
        if (
          method !== "get" &&
          !(await (options.budget ?? takeBudget)(
            `listings:${scope.actorId}`,
            30,
            1,
            600_000,
          ))
        )
          throw new ListingError(429, "Too many requests; try again later");
        await fn(req, res, scope);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ message: "Invalid input", issues: error.issues });
          return;
        }
        res.status(error instanceof ListingError ? error.status : 500).json({
          message:
            error instanceof ListingError
              ? error.message
              : "Listing operation failed",
        });
      }
    });
  };
  const requireAdmin = (scope: Scope) => {
    if (!scope.admin) throw new ListingError(403, "Platform admins only");
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
    const filters = z
      .object({
        kind: z.enum(["api", "aggregator", "partner", "submission"]).optional(),
        tier: z.coerce.number().int().min(1).max(4).optional(),
        category: z
          .enum([
            "general",
            "maps_nav",
            "social",
            "contractor",
            "trade_assoc",
            "manufacturer",
            "state_local",
            "ai",
          ])
          .optional(),
        trade: z.string().max(100).optional(),
        state: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        active: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      })
      .strict()
      .parse(req.query);
    res.json(await store.directories(filters));
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
      throw new ListingError(400, "Use a public HTTP(S) listing URL");
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
