/**
 * /api/v1/photos — the account's media library (folders and photos uploaded to ConstructHUB),
 * plus the helper behind /locations/{id}/media (photos and videos on the Google listing as last
 * synced). Storage keys are never exposed; `url` is the public URL already served to the app.
 *
 * The library has no location, so in an agency workspace only an all-clients role reads it.
 */
import { z } from "zod";
import { pool } from "../../db";
import { OPENAPI, Params, type Scope, dateTime, handler, nullableInt, nullableString, ownerScopeSql, pageSchema, positiveId, resource, sendList } from "./_shared";

export const PHOTO_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, folderId: { type: "integer" }, folderName: nullableString, name: { type: "string" }, url: { type: "string" },
  size: nullableInt, createdAt: dateTime,
} };
export const FOLDER_SCHEMA = { type: "object", properties: {
  id: { type: "integer" }, name: { type: "string" }, clientAddress: nullableString, lat: { type: "number", nullable: true },
  lon: { type: "number", nullable: true }, photoCount: { type: "integer" }, createdAt: dateTime,
} };
export const GBP_MEDIA_SCHEMA = { type: "object", properties: {
  name: { type: "string", description: "Google's media resource name (the item's id)" }, locationId: { type: "integer" }, source: { type: "string" },
  mediaFormat: nullableString, category: nullableString, googleUrl: nullableString, thumbnailUrl: nullableString,
  width: nullableInt, height: nullableInt, description: nullableString, attribution: nullableString, createTime: dateTime, syncedAt: dateTime,
} };

export const mediaQuerySchema = pageSchema.extend({
  source: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).optional(),
});

export async function listGbpMedia(locationId: number, q: z.infer<typeof mediaQuerySchema>) {
  const p = new Params();
  const where = [`m.location_id=${p.add(locationId)}`];
  if (q.source) where.push(`m.source=${p.add(q.source)}`);
  if (q.category) where.push(`m.category=${p.add(q.category.toUpperCase())}`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT m.* FROM gbp_media m WHERE ${sql} ORDER BY m.create_time DESC NULLS LAST, m.name LIMIT ${p.add(q.limit)} OFFSET ${p.add(q.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM gbp_media m WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  const items = rows.map((m) => ({
    name: m.name, locationId: m.location_id, source: m.source, mediaFormat: m.media_format, category: m.category,
    googleUrl: m.google_url, thumbnailUrl: m.thumbnail_url, width: m.width, height: m.height,
    description: m.description, attribution: m.attribution, createTime: m.create_time, syncedAt: m.synced_at,
  }));
  return { items, total };
}

const photoQuery = pageSchema.extend({ folderId: positiveId.optional(), q: z.string().trim().max(200).default("") });
const folderQuery = pageSchema.extend({ q: z.string().trim().max(200).default("") });

async function listPhotos(scope: Scope, q: z.infer<typeof photoQuery>) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "ph", null)];
  if (q.folderId) where.push(`ph.folder_id=${p.add(q.folderId)}`);
  if (q.q) where.push(`ph.name ILIKE ${p.add(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`)}`);
  const sql = where.join(" AND ");
  const from = "media_photos ph LEFT JOIN media_folders f ON f.id=ph.folder_id AND f.user_id=ph.user_id";
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT ph.id,ph.folder_id,f.name AS folder_name,ph.name,ph.url,ph.size,ph.created_at FROM ${from} WHERE ${sql} ORDER BY ph.created_at DESC, ph.id DESC LIMIT ${p.add(q.limit)} OFFSET ${p.add(q.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM ${from} WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  const items = rows.map((r) => ({ id: r.id, folderId: r.folder_id, folderName: r.folder_name, name: r.name, url: r.url, size: r.size, createdAt: r.created_at }));
  return { items, total };
}

async function listFolders(scope: Scope, q: z.infer<typeof folderQuery>) {
  const p = new Params();
  const where = [ownerScopeSql(scope, p, "f", null)];
  if (q.q) where.push(`f.name ILIKE ${p.add(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`)}`);
  const sql = where.join(" AND ");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    pool.query(`SELECT f.id,f.name,f.client_address,f.lat,f.lon,f.created_at,(SELECT count(*)::int FROM media_photos ph WHERE ph.folder_id=f.id AND ph.user_id=f.user_id) AS photo_count
                 FROM media_folders f WHERE ${sql} ORDER BY f.created_at DESC, f.id DESC LIMIT ${p.add(q.limit)} OFFSET ${p.add(q.offset)}`, p.values),
    pool.query(`SELECT count(*)::int total FROM media_folders f WHERE ${sql}`, p.values.slice(0, -2)),
  ]);
  const items = rows.map((r) => ({ id: r.id, name: r.name, clientAddress: r.client_address, lat: r.lat, lon: r.lon, photoCount: r.photo_count, createdAt: r.created_at }));
  return { items, total };
}

const common = { 400: OPENAPI.errors[400], 401: OPENAPI.errors[401], 403: OPENAPI.errors[403], 429: OPENAPI.errors[429] };

export const photosResource = resource("photos", {
  tags: [{ name: "Photos", description: "Your media library (uploaded photos, by folder)." }],
  paths: {
    "/photos": { get: {
      tags: ["Photos"], summary: "List library photos", operationId: "listPhotos",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("folderId", { type: "integer" }), OPENAPI.query("q", { type: "string" }, "Search by file name")],
      responses: { ...OPENAPI.list("#/components/schemas/Photo"), ...common },
    } },
    "/photos/folders": { get: {
      tags: ["Photos"], summary: "List library folders", operationId: "listPhotoFolders",
      parameters: [...OPENAPI.pageParams, OPENAPI.workspaceParam, OPENAPI.query("q", { type: "string" }, "Search by folder name")],
      responses: { ...OPENAPI.list("#/components/schemas/PhotoFolder"), ...common },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, Photo: PHOTO_SCHEMA, PhotoFolder: FOLDER_SCHEMA, GbpMedia: GBP_MEDIA_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const q = photoQuery.parse(req.query ?? {});
    const { items, total } = await listPhotos(scope, q);
    sendList(res, items, total, q);
  }));
  r.get("/folders", handler(async (req, res, scope) => {
    const q = folderQuery.parse(req.query ?? {});
    const { items, total } = await listFolders(scope, q);
    sendList(res, items, total, q);
  }));
});
