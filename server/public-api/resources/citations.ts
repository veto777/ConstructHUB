/**
 * /api/v1/citations — citation campaigns and the directory listings they found (citations).
 * Citations belong to a campaign; a campaign may belong to a location (`?locationId=`).
 * A campaign without a location has no client in an agency workspace: only an all-clients role
 * reads it there.
 */
import { z } from "zod";
import { pool } from "../../db";
import {
  ApiError, OPENAPI, Params, type Scope, dateTime, handler, nullableInt, nullableString, ownerScopeSql, pageSchema, positiveId, requireLocation,
  resource, sendItem, sendList,
} from "./_shared";

const campaignQuery = pageSchema.extend({ locationId: positiveId.optional(), status: z.string().trim().max(20).optional() });
const citationQuery = pageSchema.extend({
  locationId: positiveId.optional(),
  campaignId: positiveId.optional(),
  found: z.enum(["true", "false"]).optional(),
  napConsistent: z.enum(["true", "false"]).optional(),
  category: z.string().trim().max(60).optional(),
});

export const CAMPAIGN_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, locationId: nullableInt, campaignName: { type: "string" }, businessName: { type: "string" },
  address: nullableString, phone: nullableString, country: nullableString, keywords: { type: "array", items: { type: "string" }, nullable: true },
  status: nullableString, lastRunAt: dateTime, citationsFound: nullableInt, opportunitiesFound: nullableInt, createdAt: dateTime,
} };
export const CITATION_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, campaignId: { type: "integer" }, locationId: nullableInt, siteName: { type: "string" }, siteUrl: nullableString,
  listingUrl: nullableString, isFound: { type: "boolean", nullable: true }, napConsistent: { type: "boolean", nullable: true },
  category: nullableString, domainAuthority: nullableInt, lastChecked: dateTime, createdAt: dateTime,
} };

const CAMPAIGN_COLUMNS = "c.id,c.location_id,c.campaign_name,c.business_name,c.address,c.phone,c.country,c.keywords,c.status,c.last_run_at,c.citations_found,c.opportunities_found,c.created_at";
const CITATION_COLUMNS = "x.id,x.campaign_id,c.location_id,x.site_name,x.site_url,x.listing_url,x.is_found,x.nap_consistent,x.category,x.domain_authority,x.last_checked,x.created_at";
const CITATION_JOIN = "citations x JOIN citation_campaigns c ON c.id=x.campaign_id";

export function campaignItem(c: Record<string, any>) {
  return {
    id: c.id, locationId: c.location_id, campaignName: c.campaign_name, businessName: c.business_name, address: c.address, phone: c.phone,
    country: c.country, keywords: c.keywords, status: c.status, lastRunAt: c.last_run_at, citationsFound: c.citations_found,
    opportunitiesFound: c.opportunities_found, createdAt: c.created_at,
  };
}
export function citationItem(x: Record<string, any>) {
  return {
    id: x.id, campaignId: x.campaign_id, locationId: x.location_id, siteName: x.site_name, siteUrl: x.site_url, listingUrl: x.listing_url,
    isFound: x.is_found, napConsistent: x.nap_consistent, category: x.category, domainAuthority: x.domain_authority,
    lastChecked: x.last_checked, createdAt: x.created_at,
  };
}

async function listCampaigns(scope: Scope, f: z.infer<typeof campaignQuery>) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "c", "c.location_id")];
  if (f.locationId) where.push(`c.location_id=${p.add(f.locationId)}`);
  if (f.status) where.push(`c.status=${p.add(f.status)}`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM citation_campaigns c WHERE ${sql} ORDER BY c.created_at DESC, c.id DESC LIMIT ${p.add(f.limit)} OFFSET ${p.add(f.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM citation_campaigns c WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  return { items: rows.map(campaignItem), total };
}

async function listCitations(scope: Scope, f: z.infer<typeof citationQuery>) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "c", "c.location_id")];
  if (f.locationId) where.push(`c.location_id=${p.add(f.locationId)}`);
  if (f.campaignId) where.push(`x.campaign_id=${p.add(f.campaignId)}`);
  if (f.found === "true") where.push("x.is_found IS TRUE");
  if (f.found === "false") where.push("x.is_found IS NOT TRUE");
  if (f.napConsistent === "true") where.push("x.nap_consistent IS TRUE");
  if (f.napConsistent === "false") where.push("x.nap_consistent IS FALSE");
  if (f.category) where.push(`x.category=${p.add(f.category)}`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ${CITATION_COLUMNS} FROM ${CITATION_JOIN} WHERE ${sql} ORDER BY x.domain_authority DESC NULLS LAST, x.id LIMIT ${p.add(f.limit)} OFFSET ${p.add(f.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM ${CITATION_JOIN} WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  return { items: rows.map(citationItem), total };
}

const common = { 401: OPENAPI.errors[401], 402: OPENAPI.errors[402], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] };

export const citationsResource = resource("citations", {
  tags: [{ name: "Citations", description: "Citation campaigns and the directory listings found." }],
  paths: {
    "/citations": { get: {
      tags: ["Citations"], summary: "List citations", operationId: "listCitations",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("locationId", { type: "integer" }), OPENAPI.query("campaignId", { type: "integer" }),
        OPENAPI.query("found", { type: "string", enum: ["true", "false"] }), OPENAPI.query("napConsistent", { type: "string", enum: ["true", "false"] }),
        OPENAPI.query("category", { type: "string" })],
      responses: { ...OPENAPI.list("#/components/schemas/Citation"), 400: OPENAPI.errors[400], ...common },
    } },
    "/citations/campaigns": { get: {
      tags: ["Citations"], summary: "List citation campaigns", operationId: "listCitationCampaigns",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("locationId", { type: "integer" }), OPENAPI.query("status", { type: "string" })],
      responses: { ...OPENAPI.list("#/components/schemas/CitationCampaign"), 400: OPENAPI.errors[400], ...common },
    } },
    "/citations/campaigns/{id}": { get: {
      tags: ["Citations"], summary: "One citation campaign", operationId: "getCitationCampaign",
      parameters: [OPENAPI.idParam("id"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/CitationCampaign"), ...common },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, Citation: CITATION_SCHEMA, CitationCampaign: CAMPAIGN_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = citationQuery.parse(req.query ?? {});
    if (q.locationId) await requireLocation(scope, q.locationId);
    const { items, total } = await listCitations(scope, q);
    sendList(res, items, total, q);
  }));

  r.get("/campaigns", handler(async (req, res, scope) => {
    const q = campaignQuery.parse(req.query ?? {});
    if (q.locationId) await requireLocation(scope, q.locationId);
    const { items, total } = await listCampaigns(scope, q);
    sendList(res, items, total, q);
  }));

  r.get("/campaigns/:id", handler(async (req, res, scope) => {
    const id = positiveId.parse(req.params.id);
    const p = new Params();
    const where = ownerScopeSql(scope, p, "c", "c.location_id");
    const { rows: [row] } = await pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM citation_campaigns c WHERE ${where} AND c.id=${p.add(id)}`, p.values);
    if (!row) throw new ApiError(404, "not_found", "Campaign not found");
    sendItem(res, campaignItem(row));
  }));
});
