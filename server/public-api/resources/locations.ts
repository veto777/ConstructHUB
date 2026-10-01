/**
 * /api/v1/locations — Google Business Profile locations (list, detail) and the per-location
 * sub-collections: reviews, insights, media, posts. Own locations, or an agency workspace's
 * (`?workspace=`) limited to the member's assigned clients.
 */
import { z } from "zod";
import { pool } from "../../db";
import {
  LOCATION_COLUMNS, LOCATION_JOIN, OPENAPI, Params, camel, dateTime, handler, isoDate, locationScopeSql, nullableInt, nullableString,
  pageSchema, positiveId, requireLocation, resource, sendItem, sendList,
} from "./_shared";
import { listReviews, REVIEW_FILTERS, REVIEW_SCHEMA, reviewFilterSchema } from "./reviews";
import { insightsFor, INSIGHTS_PARAMS, INSIGHTS_SCHEMA, insightsQuerySchema } from "./insights";
import { GBP_MEDIA_SCHEMA, listGbpMedia, mediaQuerySchema } from "./photos";
import { GBP_POST_SCHEMA, listGbpPosts, gbpPostFilterSchema } from "./gbp-posts";

export function locationItem(row: Record<string, any>) {
  const item = camel(row);
  return { ...item, gbpLinked: !!row.gbp_location_name };
}

const listQuery = pageSchema.extend({
  q: z.string().trim().max(200).default(""),
  clientId: positiveId.optional(),
  linked: z.enum(["true", "false"]).optional(),
  state: z.string().trim().max(2).optional(),
  updatedSince: isoDate.optional(),
});

export const LOCATION_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, businessName: { type: "string" }, placeId: nullableString, googleCid: nullableString,
  address: nullableString, city: nullableString, state: nullableString, zipCode: nullableString, country: nullableString,
  phone: nullableString, website: nullableString, description: nullableString,
  categories: { type: "array", items: { type: "string" }, nullable: true }, services: { type: "array", items: { type: "string" }, nullable: true },
  serviceAreas: { type: "array", items: { type: "string" }, nullable: true }, hours: { nullable: true }, openingDate: nullableString,
  openStatus: { ...nullableString, description: "Only a Google sync knows this; null = unknown." }, socialProfiles: { nullable: true },
  tags: { type: "array", items: { type: "string" }, nullable: true }, businessPhotoCount: nullableInt, customerPhotoCount: nullableInt,
  gbpManagementEnabled: { type: "boolean", nullable: true }, listingsCount: nullableInt, reviewCount: nullableInt, newReviewCount: nullableInt,
  monthlyViews: nullableInt, avgRank: { type: "number", nullable: true }, avgRating: { type: "number", nullable: true },
  gbpAccountName: nullableString, gbpLocationName: nullableString, gbpLinked: { type: "boolean" },
  agencyClientId: nullableInt, clientName: nullableString, createdAt: dateTime, updatedAt: dateTime,
} };

const common = { 401: OPENAPI.errors[401], 402: OPENAPI.errors[402], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] };

export const locationsResource = resource("locations", {
  tags: [{ name: "Locations", description: "Google Business Profile locations and their reviews, insights, media and posts." }],
  paths: {
    "/locations": { get: {
      tags: ["Locations"], summary: "List locations", operationId: "listLocations",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam,
        OPENAPI.query("q", { type: "string" }, "Search name, address, city, state, zip, place id or client name"),
        OPENAPI.query("clientId", { type: "integer" }, "Agency client id"),
        OPENAPI.query("linked", { type: "string", enum: ["true", "false"] }, "Only locations linked (or not) to a Google Business Profile"),
        OPENAPI.query("state", { type: "string" }, "Two-letter state"),
        OPENAPI.query("updatedSince", { type: "string", format: "date" })],
      responses: { ...OPENAPI.list("#/components/schemas/Location"), 400: OPENAPI.errors[400], ...common },
    } },
    "/locations/{id}": { get: {
      tags: ["Locations"], summary: "One location", operationId: "getLocation",
      parameters: [OPENAPI.idParam("id"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/Location"), ...common },
    } },
    "/locations/{id}/reviews": { get: {
      tags: ["Locations"], summary: "Reviews of one location", operationId: "listLocationReviews",
      parameters: [OPENAPI.idParam("id"), ...OPENAPI.pageParams, OPENAPI.workspaceParam, ...REVIEW_FILTERS],
      responses: { ...OPENAPI.list("#/components/schemas/Review"), 400: OPENAPI.errors[400], ...common },
    } },
    "/locations/{id}/insights": { get: {
      tags: ["Locations"], summary: "Daily Business Profile metrics of one location", operationId: "getLocationInsights",
      parameters: [OPENAPI.idParam("id"), OPENAPI.workspaceParam, ...INSIGHTS_PARAMS],
      responses: { ...OPENAPI.list("#/components/schemas/InsightDay", {
        totals: { type: "object", additionalProperties: { type: "integer" } },
        range: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } },
      }), 400: OPENAPI.errors[400], ...common },
    } },
    "/locations/{id}/media": { get: {
      tags: ["Locations"], summary: "Photos and videos on the Google listing (as last synced)", operationId: "listLocationMedia",
      parameters: [OPENAPI.idParam("id"), ...OPENAPI.pageParams, OPENAPI.workspaceParam,
        OPENAPI.query("source", { type: "string" }, "Media source as synced, e.g. owner or customer"),
        OPENAPI.query("category", { type: "string" })],
      responses: { ...OPENAPI.list("#/components/schemas/GbpMedia"), 400: OPENAPI.errors[400], ...common },
    } },
    "/locations/{id}/posts": { get: {
      tags: ["Locations"], summary: "Business Profile post/photo queue of one location", operationId: "listLocationPosts",
      parameters: [OPENAPI.idParam("id"), ...OPENAPI.pageParams, OPENAPI.workspaceParam,
        OPENAPI.query("status", { type: "string" }), OPENAPI.query("kind", { type: "string", enum: ["post", "photo"] })],
      responses: { ...OPENAPI.list("#/components/schemas/GbpPost"), 400: OPENAPI.errors[400], ...common },
    } },
  },
  components: { schemas: {
    ...OPENAPI.baseSchemas, Location: LOCATION_SCHEMA, Review: REVIEW_SCHEMA, InsightDay: INSIGHTS_SCHEMA, GbpMedia: GBP_MEDIA_SCHEMA, GbpPost: GBP_POST_SCHEMA,
  } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = listQuery.parse(req.query ?? {});
    const p = new Params();
    const where = [locationScopeSql(scope, p)];
    if (q.q) where.push(`concat_ws(' ',l.business_name,l.address,l.city,l.state,l.zip_code,l.place_id,c.name) ILIKE ${p.add(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`)}`);
    if (q.clientId) where.push(`l.agency_client_id=${p.add(q.clientId)}`);
    if (q.linked === "true") where.push("l.gbp_location_name IS NOT NULL");
    if (q.linked === "false") where.push("l.gbp_location_name IS NULL");
    if (q.state) where.push(`upper(l.state)=${p.add(q.state.toUpperCase())}`);
    if (q.updatedSince) where.push(`l.updated_at >= ${p.add(q.updatedSince)}::date`);
    const sql = where.join(" AND ");
    const [{ rows }, { rows: [{ total }] }] = await Promise.all([
      pool.query(`SELECT ${LOCATION_COLUMNS} FROM ${LOCATION_JOIN} WHERE ${sql} ORDER BY l.id LIMIT ${p.add(q.limit)} OFFSET ${p.add(q.offset)}`, p.values),
      pool.query(`SELECT count(*)::int total FROM ${LOCATION_JOIN} WHERE ${sql}`, p.values.slice(0, -2)),
    ]);
    sendList(res, rows.map(locationItem), total, q);
  }));

  r.get("/:id", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    sendItem(res, locationItem(await requireLocation(scope, id)));
  }));

  r.get("/:id/reviews", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const q = reviewFilterSchema.parse(req.query ?? {});
    await requireLocation(scope, id);
    const { items, total } = await listReviews(scope, { ...q, locationId: id });
    sendList(res, items, total, q);
  }));

  r.get("/:id/insights", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const q = insightsQuerySchema.parse(req.query ?? {});
    await requireLocation(scope, id);
    const { days, totals, range } = await insightsFor(id, q);
    sendList(res, days, days.length, { limit: Math.max(1, days.length), offset: 0 }, { totals, range });
  }));

  r.get("/:id/media", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const q = mediaQuerySchema.parse(req.query ?? {});
    await requireLocation(scope, id);
    const { items, total } = await listGbpMedia(id, q);
    sendList(res, items, total, q);
  }));

  r.get("/:id/posts", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const q = gbpPostFilterSchema.parse(req.query ?? {});
    await requireLocation(scope, id);
    const { items, total } = await listGbpPosts(scope, { ...q, locationId: id });
    sendList(res, items, total, q);
  }));
});
