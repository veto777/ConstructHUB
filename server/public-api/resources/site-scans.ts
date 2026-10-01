/**
 * /api/v1/site-scans — website scans (sitescan_jobs): list, detail, and the full report of a
 * completed scan. Share links, worker leases and the in-app AI draft are not exposed. A scan
 * started for a location carries that location in `profile.id`; `?locationId=` filters on it.
 */
import { z } from "zod";
import { pool } from "../../db";
import {
  ApiError, OPENAPI, Params, type Scope, dateTime, handler, nullableInt, nullableString, ownerScopeSql, pageSchema, positiveId, requireLocation,
  resource, sendItem, sendList, uuid,
} from "./_shared";

export const SCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;

/** The scan's location id as an integer expression (profile.id is written by the app from the location row). */
const LOCATION_EXPR = "(CASE WHEN j.profile->>'id' ~ '^[0-9]{1,9}$' THEN (j.profile->>'id')::int END)";

const filterSchema = pageSchema.extend({
  locationId: positiveId.optional(),
  url: z.string().trim().max(2000).optional(),
  status: z.enum(SCAN_STATUSES).optional(),
  since: z.string().datetime().optional(),
});

export const SITE_SCAN_SCHEMA = { type: "object", properties: {
  id: { type: "string", format: "uuid" }, url: { type: "string" }, status: { type: "string", enum: [...SCAN_STATUSES] },
  locationId: nullableInt, businessName: nullableString, pageCap: { type: "integer" }, psiPages: { type: "integer" },
  pages: { ...nullableInt, description: "Pages crawled so far" }, scores: { type: "object", additionalProperties: true, nullable: true },
  error: nullableString, attempts: { type: "integer" }, createdAt: dateTime, completedAt: dateTime,
} };
export const SITE_SCAN_REPORT_SCHEMA = { type: "object", properties: {
  id: { type: "string", format: "uuid" }, url: { type: "string" }, status: { type: "string" }, completedAt: dateTime,
  report: { type: "object", additionalProperties: true, description: "The full scan report as stored" },
  fixDone: { type: "object", additionalProperties: true, description: "Findings the user marked fixed" },
} };

const COLUMNS = `j.id,j.url,j.status,${LOCATION_EXPR} AS location_id,j.profile->>'business_name' AS business_name,j.page_cap,j.psi_pages,
  jsonb_array_length(COALESCE(j.state->'pages','[]'::jsonb)) AS pages,j.report->'scores' AS scores,j.error,j.attempts,j.created_at,j.completed_at`;

export function siteScanItem(j: Record<string, any>) {
  return {
    id: j.id, url: j.url, status: j.status, locationId: j.location_id, businessName: j.business_name,
    pageCap: j.page_cap, psiPages: j.psi_pages, pages: j.pages, scores: j.scores, error: j.error, attempts: j.attempts,
    createdAt: j.created_at, completedAt: j.completed_at,
  };
}

async function listSiteScans(scope: Scope, f: z.infer<typeof filterSchema>) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "j", LOCATION_EXPR)];
  if (f.locationId) where.push(`${LOCATION_EXPR}=${p.add(f.locationId)}`);
  if (f.url) where.push(`j.url ILIKE ${p.add(`%${f.url.replace(/[\\%_]/g, "\\$&")}%`)}`);
  if (f.status) where.push(`j.status=${p.add(f.status)}`);
  if (f.since) where.push(`j.created_at >= ${p.add(f.since)}::timestamptz`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} FROM sitescan_jobs j WHERE ${sql} ORDER BY j.created_at DESC, j.id LIMIT ${p.add(f.limit)} OFFSET ${p.add(f.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM sitescan_jobs j WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  return { items: rows.map(siteScanItem), total };
}

async function ownScan(scope: Scope, id: string, columns: string) {
  const p = new Params();
  const where = ownerScopeSql(scope, p, "j", LOCATION_EXPR);
  const { rows: [row] } = await pool.query(`SELECT ${columns} FROM sitescan_jobs j WHERE ${where} AND j.id=${p.add(id)}`, p.values);
  if (!row) throw new ApiError(404, "not_found", "Site scan not found");
  return row;
}

const common = { 401: OPENAPI.errors[401], 402: OPENAPI.errors[402], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] };

export const siteScansResource = resource("site-scans", {
  tags: [{ name: "Site scans", description: "Website scans and their reports." }],
  paths: {
    "/site-scans": { get: {
      tags: ["Site scans"], summary: "List site scans", operationId: "listSiteScans",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("locationId", { type: "integer" }),
        OPENAPI.query("url", { type: "string" }, "Scans whose URL contains this"), OPENAPI.query("status", { type: "string", enum: [...SCAN_STATUSES] }),
        OPENAPI.query("since", { type: "string", format: "date-time" }, "Started on or after")],
      responses: { ...OPENAPI.list("#/components/schemas/SiteScan"), 400: OPENAPI.errors[400], ...common },
    } },
    "/site-scans/{id}": { get: {
      tags: ["Site scans"], summary: "One site scan", operationId: "getSiteScan",
      parameters: [OPENAPI.idParam("id", "string", "uuid"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/SiteScan"), 400: OPENAPI.errors[400], ...common },
    } },
    "/site-scans/{id}/report": { get: {
      tags: ["Site scans"], summary: "The full report of a completed scan", operationId: "getSiteScanReport",
      parameters: [OPENAPI.idParam("id", "string", "uuid"), OPENAPI.workspaceParam],
      responses: { ...OPENAPI.item("#/components/schemas/SiteScanReport"), 400: OPENAPI.errors[400],
        409: { description: "The scan has not completed; `status` says where it is", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ...common },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, SiteScan: SITE_SCAN_SCHEMA, SiteScanReport: SITE_SCAN_REPORT_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = filterSchema.parse(req.query ?? {});
    if (q.locationId) await requireLocation(scope, q.locationId);
    const { items, total } = await listSiteScans(scope, q);
    sendList(res, items, total, q);
  }));

  r.get("/:id", handler(async (req, res, scope) => {
    const id = uuid.parse(req.params.id);
    sendItem(res, siteScanItem(await ownScan(scope, id, COLUMNS)));
  }));

  r.get("/:id/report", handler(async (req, res, scope) => {
    const id = uuid.parse(req.params.id);
    const row = await ownScan(scope, id, "j.id,j.url,j.status,j.completed_at,j.report,j.fix_done");
    if (row.status !== "completed" || !row.report) {
      throw new ApiError(409, "scan_not_completed", `This scan is ${row.status}; the report is available once it completes.`, { status: row.status });
    }
    sendItem(res, { id: row.id, url: row.url, status: row.status, completedAt: row.completed_at, report: row.report, fixDone: row.fix_done ?? {} });
  }));
});
