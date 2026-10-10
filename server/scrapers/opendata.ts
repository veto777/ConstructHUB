/** Official, metadata-verified permit datasets. See opendata.REPORT.md for provenance. */
import { politeJson, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

type Field = string | string[];
type MappedField = Exclude<keyof PermitRecord, "jurisdiction" | "databaseId" | "raw">;
export interface Dataset {
  kind: "socrata" | "arcgis" | "ckan" | "carto";
  url: string;
  title: string;
  id: string;
  metadataUrl: string;
  portalUrls: string[];
  fields: Partial<Record<MappedField, Field>> & { permitNumber: Field; address: Field };
  dateField: string;
  orderField: string;
  table?: string;
  dateType?: "timestamp" | "date";
  numericFields?: string[];
  geometryField?: string;
  scope?: string;
}

export const DATASETS: Record<string, Dataset> = /* DATASETS_START */ {
  "New York, NY": {
    "kind": "socrata",
    "url": "https://data.cityofnewyork.us/resource/rbx6-tga4.json",
    "title": "DOB NOW: Build – Approved Permits",
    "id": "rbx6-tga4",
    "metadataUrl": "https://data.cityofnewyork.us/api/views/rbx6-tga4.json",
    "portalUrls": [
      "https://a810-dobnow.nyc.gov/publish/Index.html"
    ],
    "fields": {
      "permitNumber": "work_permit",
      "address": [
        "house_no",
        "street_name"
      ],
      "permitType": "work_type",
      "status": "permit_status",
      "issuedAt": "issued_date",
      "expiresAt": "expired_date",
      "description": "job_description",
      "valuation": "estimated_job_costs",
      "lat": "latitude",
      "lng": "longitude",
      "applicantName": [
        "applicant_first_name",
        "applicant_last_name"
      ],
      "ownerName": "owner_name"
    },
    "dateField": "issued_date",
    "orderField": ":id"
  },
  "Los Angeles, CA": {
    "kind": "socrata",
    "url": "https://data.lacity.org/resource/pi9x-tg5x.json",
    "title": "Building and Safety - Building Permits Issued from 2020 to Present (N)",
    "id": "pi9x-tg5x",
    "metadataUrl": "https://data.lacity.org/api/views/pi9x-tg5x.json",
    "portalUrls": [
      "https://www.ladbsservices2.lacity.org/OnlineServices/"
    ],
    "fields": {
      "permitNumber": "permit_nbr",
      "address": "primary_address",
      "permitType": "permit_type",
      "workClass": "permit_sub_type",
      "status": "status_desc",
      "issuedAt": "issue_date",
      "appliedAt": "submitted_date",
      "description": "work_desc",
      "valuation": "valuation",
      "lat": "lat",
      "lng": "lon",
      "parcel": "apn"
    },
    "dateField": "issue_date",
    "orderField": ":id"
  },
  "Chicago, IL": {
    "kind": "socrata",
    "url": "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    "title": "Building Permits",
    "id": "ydr8-5enu",
    "metadataUrl": "https://data.cityofchicago.org/api/views/ydr8-5enu.json",
    "portalUrls": [
      "https://webapps1.chicago.gov/buildingrecords/"
    ],
    "fields": {
      "permitNumber": "permit_",
      "address": [
        "street_number",
        "street_direction",
        "street_name"
      ],
      "permitType": "permit_type",
      "status": "permit_status",
      "issuedAt": "issue_date",
      "appliedAt": "application_start_date",
      "description": "work_description",
      "valuation": "reported_cost",
      "lat": "latitude",
      "lng": "longitude"
    },
    "dateField": "issue_date",
    "orderField": ":id",
    "numericFields": [
      "street_number"
    ]
  },
  "Austin, TX": {
    "kind": "socrata",
    "url": "https://data.austintexas.gov/resource/3syk-w9eu.json",
    "title": "Issued Construction Permits",
    "id": "3syk-w9eu",
    "metadataUrl": "https://data.austintexas.gov/api/views/3syk-w9eu.json",
    "portalUrls": [
      "https://abc.austintexas.gov/web/permit/public-search-other"
    ],
    "fields": {
      "permitNumber": "permit_number",
      "address": "original_address1",
      "permitType": "permit_type_desc",
      "status": "status_current",
      "issuedAt": "issue_date",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "total_job_valuation",
      "lat": "latitude",
      "lng": "longitude",
      "contractorName": "contractor_company_name",
      "applicantName": "applicant_full_name",
      "sourceUrl": "link",
      "parcel": "tcad_id",
      "workClass": "work_class"
    },
    "dateField": "issue_date",
    "orderField": ":id"
  },
  "Seattle, WA": {
    "kind": "socrata",
    "url": "https://data.seattle.gov/resource/76t5-zqzr.json",
    "title": "Building Permits",
    "id": "76t5-zqzr",
    "metadataUrl": "https://data.seattle.gov/api/views/76t5-zqzr.json",
    "portalUrls": [
      "https://services.seattle.gov/Portal/Customization/SEATTLE/welcome.aspx"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittypedesc",
      "status": "statuscurrent",
      "issuedAt": "issueddate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcost",
      "lat": "latitude",
      "lng": "longitude",
      "contractorName": "contractorcompanyname",
      "sourceUrl": "link"
    },
    "dateField": "issueddate",
    "orderField": ":id"
  },
  "San Francisco, CA": {
    "kind": "socrata",
    "url": "https://data.sfgov.org/resource/i98e-djp9.json",
    "title": "Building Permits",
    "id": "i98e-djp9",
    "metadataUrl": "https://data.sfgov.org/api/views/i98e-djp9.json",
    "portalUrls": [
      "https://sanfranciscoca.portal.opengov.com/"
    ],
    "fields": {
      "permitNumber": "permit_number",
      "address": [
        "street_number",
        "street_name",
        "street_suffix"
      ],
      "permitType": "permit_type_definition",
      "status": "status",
      "issuedAt": "issued_date",
      "appliedAt": "filed_date",
      "description": "description",
      "valuation": "estimated_cost"
    },
    "dateField": "issued_date",
    "orderField": ":id",
    "geometryField": "location"
  }
} /* DATASETS_END */;
export const OPENDATA_JURISDICTIONS: string[] = Object.keys(DATASETS);

function canonical(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Unsupported portal protocol");
  return u.href.replace(/\/$/, "");
}
export function datasetFor(ctx: AdapterCtx): Dataset {
  const d = DATASETS[ctx.jurisdiction];
  if (!d) throw new Error(`No verified open-data dataset for ${ctx.jurisdiction}`);
  const input = canonical(ctx.searchUrl);
  if (![d.url, d.metadataUrl, ...d.portalUrls].some(u => canonical(u) === input)) {
    throw new Error(`URL is not a verified open-data source/catalog portal for ${ctx.jurisdiction}`);
  }
  return d;
}
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
function identifier(s: string, d: Dataset): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !(d.kind === "socrata" && s === ":id")) throw new Error(`Unsafe dataset field ${s}`);
  return d.kind === "ckan" || d.kind === "carto" ? `"${s}"` : s;
}
const parts = (field: Field | undefined): string[] => field ? Array.isArray(field) ? field : [field] : [];
function expression(field: Field, d: Dataset): string {
  const fs = parts(field).map(f => {
    const id = identifier(f, d);
    if (d.kind === "socrata" && d.numericFields?.includes(f)) return `${id}::text`;
    return id;
  });
  if (fs.length === 1) return fs[0];
  if (d.kind === "socrata") return fs.map(f => `coalesce(${f}, '')`).join(" || ' ' || ");
  return fs.map(f => `COALESCE(CAST(${f} AS VARCHAR), '')`).join(" || ' ' || ");
}
export function searchWhere(d: Dataset, q: { type: PermitSearchType; value: string }): string {
  const value = q.value.trim();
  if (!value || value.length > 300) throw new Error("Search value must contain 1–300 characters");
  // Do not let LIKE metacharacters turn an address search into a full-table scan.
  if (/[%_\\]/.test(value) && q.type !== "permit") throw new Error("Search wildcards are unsupported");
  const fields: (Field | undefined)[] = q.type === "address" ? [d.fields.address]
    : q.type === "permit" ? [d.fields.permitNumber]
    : q.type === "company" ? [d.fields.contractorName]
    : q.type === "name" ? [d.fields.applicantName, d.fields.ownerName, d.fields.contractorName]
    : q.type === "license" ? [d.fields.contractorLicense]
    : [d.fields.description, d.fields.permitType, d.fields.address];
  const available = fields.filter((f): f is Field => !!f);
  if (!available.length) throw new Error(`${q.type} search is not published by this dataset`);
  return "(" + available.map(f => q.type === "permit"
    ? `${expression(f, d)} = ${literal(value)}`
    : `upper(${expression(f, d)}) LIKE ${literal(`%${value.toUpperCase()}%`)}`).join(" OR ") + ")";
}
export function recentWhere(d: Dataset, since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(since) || !Number.isFinite(Date.parse(since))) throw new Error("Invalid ISO since date");
  const iso = new Date(since).toISOString();
  const value = d.kind === "arcgis" ? `TIMESTAMP ${literal(iso.slice(0, 19).replace("T", " "))}`
    : literal(d.kind === "socrata" && d.dateType !== "timestamp" ? iso.slice(0, 23) : iso);
  return `${identifier(d.dateField, d)} >= ${value}`;
}
export const PAGE_SIZE = 1000;
export function buildQuery(d: Dataset, where: string, offset = 0, limit = PAGE_SIZE): string {
  const u = new URL(d.url);
  const condition = d.scope ? `(${d.scope}) AND (${where})` : where;
  if (d.kind === "socrata") {
    u.searchParams.set("$where", condition); u.searchParams.set("$limit", String(limit));
    u.searchParams.set("$offset", String(offset)); u.searchParams.set("$order", identifier(d.orderField, d));
  } else if (d.kind === "arcgis") {
    u.pathname = u.pathname.replace(/\/$/, "") + "/query";
    Object.entries({ f: "json", where: condition, outFields: "*", returnGeometry: "true", outSR: "4326", resultOffset: String(offset), resultRecordCount: String(limit), orderByFields: d.orderField }).forEach(([k,v]) => u.searchParams.set(k,v));
  } else {
    const table = d.kind === "ckan" ? `"${d.id.replace(/"/g, '""')}"` : identifier(d.table!, d);
    u.searchParams.set(d.kind === "ckan" ? "sql" : "q", `SELECT * FROM ${table} WHERE ${condition} ORDER BY ${identifier(d.orderField, d)} LIMIT ${limit} OFFSET ${offset}`);
  }
  return u.href;
}
function textValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim(); return s || null;
}
function numberValue(value: unknown): number | null {
  const s = textValue(value); if (s === null) return null;
  const n = Number(s.replace(/[$,]/g, "")); return Number.isFinite(n) ? n : null;
}
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = textValue(value);
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value).toISOString() : null;
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isFinite(Date.parse(s)) ? s : null;
  const n = Date.parse(s); return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
export function parseRow(d: Dataset, raw: Record<string, unknown>, ctx: Pick<AdapterCtx, "jurisdiction" | "databaseId">): PermitRecord {
  const row = d.kind === "arcgis" ? raw.attributes as Record<string, unknown> : raw;
  if (!row || typeof row !== "object") throw new Error("Malformed permit row");
  const read = (name: MappedField): unknown => {
    const f = d.fields[name];
    return Array.isArray(f) ? f.map(k => textValue(row[k])).filter(Boolean).join(" ") || null : f ? row[f] : null;
  };
  const permitNumber = textValue(read("permitNumber"));
  if (!permitNumber) throw new Error("Dataset row has no permit number; refusing silent data loss");
  const out: PermitRecord = { permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId, raw };
  for (const k of ["address", "parcel", "permitType", "workClass", "description", "status", "contractorName", "contractorLicense", "applicantName", "ownerName"] as const) out[k] = textValue(read(k));
  for (const k of ["issuedAt", "appliedAt", "expiresAt"] as const) out[k] = isoDate(read(k));
  for (const k of ["valuation", "lat", "lng"] as const) out[k] = numberValue(read(k));
  const geom = (d.kind === "arcgis" ? raw.geometry : d.geometryField ? row[d.geometryField] : null) as { x?: number; y?: number; coordinates?: number[]; latitude?: string; longitude?: string } | null;
  out.lat ??= numberValue(geom?.y ?? geom?.coordinates?.[1] ?? geom?.latitude);
  out.lng ??= numberValue(geom?.x ?? geom?.coordinates?.[0] ?? geom?.longitude);
  const source = read("sourceUrl");
  const url = typeof source === "object" && source ? textValue((source as { url?: unknown }).url) : textValue(source);
  out.sourceUrl = url && /^https?:\/\//i.test(url) ? url : null;
  return out;
}
export function responseRows(d: Dataset, payload: unknown): { rows: Record<string, unknown>[]; more?: boolean } {
  const p = payload as any;
  if (p?.error || p?.success === false) {
    const code = Number(p.error?.code);
    if ([401,403,429,498,499].includes(code)) throw new PortalBlockedError(d.url, code, JSON.stringify(p.error));
    throw new Error(`Open-data API error: ${JSON.stringify(p.error ?? p)}`);
  }
  const rows = d.kind === "socrata" ? p : d.kind === "arcgis" ? p?.features : d.kind === "ckan" ? p?.result?.records : p?.rows;
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Malformed open-data response");
  return { rows, more: d.kind === "arcgis" ? p.exceededTransferLimit : undefined };
}
async function query(ctx: AdapterCtx, d: Dataset, where: string): Promise<PermitRecord[]> {
  const records: PermitRecord[] = [];
  let offset = 0;
  let previous: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const payload = await politeJson(buildQuery(d, where, offset), {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    const { rows, more } = responseRows(d, payload);
    const fingerprint = JSON.stringify(rows);
    if (rows.length && fingerprint === previous) throw new Error("Portal ignored pagination");
    previous = fingerprint;
    records.push(...rows.map(row => parseRow(d, row, ctx)));
    offset += rows.length;
    if (more === false || (more !== true && rows.length < PAGE_SIZE)) return records;
    if (!rows.length) throw new Error("Portal reports more records but returned no page");
  }
  throw new Error("Open-data pagination limit exceeded; narrow the query");
}
const adapter: PortalAdapter = {
  platform: "Open data",
  capabilities: { search: ["address", "permit", "name", "company", "license", "keyword"], listRecent: true, detail: false },
  async search(ctx, q) { const d = datasetFor(ctx); return query(ctx, d, searchWhere(d, q)); },
  async listRecent(ctx, since) { const d = datasetFor(ctx); return query(ctx, d, recentWhere(d, since)); },
};
export default adapter;
