/**
 * JobCam — member-facing API (mounted under /api/crm/jobcam so requireOrg's
 * object-visibility pass runs on every request, like the rest of the CRM).
 *
 *   Uploads (resumable multipart, see storage.ts + upload-state.ts)
 *     POST   /api/crm/jobcam/uploads                    register + open (returns part targets)
 *     GET    /api/crm/jobcam/uploads/:id                resume: which parts are done, fresh URLs
 *     PUT    /api/crm/jobcam/uploads/:id/parts/:n       proxy a part through the API
 *     POST   /api/crm/jobcam/uploads/:id/parts/:n       record the ETag of a direct-to-R2 part
 *     POST   /api/crm/jobcam/uploads/:id/complete       finish → processing (queue)
 *     DELETE /api/crm/jobcam/uploads/:id                abort
 *   Media
 *     GET    /api/crm/jobcam/media                      feed/search (project, customer, tags AND/OR, starred, q, dates, uploader)
 *     GET    /api/crm/jobcam/media/:id
 *     PATCH  /api/crm/jobcam/media/:id                  star / tags / caption / stamp / clientVisible
 *     DELETE /api/crm/jobcam/media/:id                  soft delete
 *     POST   /api/crm/jobcam/media/bulk                 star|unstar|tag|untag|client_show|client_hide|delete
 *     GET    /api/crm/jobcam/media/:id/file/:variant    thumb|display|poster|video|original (Range-aware)
 *   Tags, projects, usage
 *     GET/POST /api/crm/jobcam/tags · DELETE /api/crm/jobcam/tags/:id
 *     GET    /api/crm/jobcam/projects?lat&lng           visible projects, nearest first when the phone says where it is
 *     GET    /api/crm/jobcam/usage                      the org's storage meter (used, size, next size)
 *     POST   /api/crm/jobcam/storage-request            "Request more storage" (answered by a platform admin)
 *
 * Every route here needs JobCam on the org owner's CRM plan (plan.ts): CRM Max,
 * or the JobCam add-on on Basic / Essentials. Without it the answer is the 402
 * crm_plan_required body and the client shows the upgrade card.
 */
import type { Express } from "express";
import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, arrayContains, type SQL } from "drizzle-orm";
import { db } from "../db";
import { crmCustomers, crmMembers, crmProjects, jobcamMedia, jobcamTags, jobcamUploads, JOBCAM_MEDIA_KINDS } from "@shared/schema";
import type { JobcamMedia } from "@shared/schema";
import { requireOrg, type OrgContext } from "../crm/tenancy";
import { logActivity } from "../crm/activity";
import {
  validateUploadRequest, partPlan, markPart, missingParts, canComplete, completedParts, nextMediaStatus, uploadExpired,
  PART_URL_TTL_S, PART_SIZE,
} from "./upload-state";
import {
  createMultipart, directPartUrl, putPart, completeMultipart, abortMultipart, objectSize, getObject, deleteObject, mediaKey, storageMode, keyBelongsTo,
  type MultipartHandle,
} from "./storage";
import { enqueueMedia } from "./processor";
import {
  bumpJobcamUsage, getJobcamUsage, getJobcamStorage, jobcamStorageSnapshot, jobcamStorageRefusal, withJobcamStorageRoom,
  requestJobcamStorage, openJobcamStorageRequest,
} from "./usage";
import { canManageJobcam, visibleProject, visibleProjectIds, projectsById } from "./access";
import { requireJobcamPlan } from "./plan";
import { normalizeTagFilter, normalizeTags } from "./filters";

type GetUser = (req: any, res: any) => any;

const TAG_MAX = 40;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-/&.#']{0,39}$/u;

// ── Presentation ────────────────────────────────────────────────────────────

export type PresentedMedia = ReturnType<typeof presentMedia>;

/** One shape for every surface; `base` is the file-route prefix the viewer may use. */
export function presentMedia(
  m: JobcamMedia,
  base: string,
  extra: { project?: { id: string; name: string; number: string | null; address: string | null } | null; uploader?: { id: string; name: string } | null; showDetails?: boolean; guest?: boolean } = {},
) {
  const details = extra.showDetails !== false;
  const lat = m.exifLat ?? m.deviceLat ?? null;
  const lng = m.exifLng ?? m.deviceLng ?? null;
  const file = (variant: string) => `${base}/${m.id}/file/${variant}`;
  return {
    id: m.id,
    projectId: m.projectId,
    customerId: m.customerId,
    kind: m.kind,
    status: m.status,
    error: m.error,
    fileName: m.fileName,
    mime: m.mime,
    bytes: m.bytes,
    width: m.width,
    height: m.height,
    durationS: m.durationS,
    capturedAt: m.capturedAt ?? m.uploadedAt,
    uploadedAt: m.uploadedAt,
    starred: m.starred,
    // Team-only: whether the homeowner's portal shows this. Guests (share links, the portal) never get the flag.
    ...(extra.guest ? {} : { clientVisible: m.clientVisible }),
    tags: m.tags ?? [],
    caption: m.caption,
    stamp: m.stamp ?? null,
    lat: details ? lat : null,
    lng: details ? lng : null,
    gpsSource: details ? (m.exifLat != null ? "exif" : m.deviceLat != null ? "device" : null) : null,
    // The accuracy is the phone's fix; it says nothing about coordinates read from the file.
    gpsAccuracyM: details && m.exifLat == null && m.deviceLat != null ? m.gpsAccuracyM : null,
    mapUrl: details && lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null,
    uploader: details ? extra.uploader ?? null : null,
    project: extra.project ?? null,
    urls: {
      thumb: m.r2KeyThumb ? file("thumb") : null,
      display: m.kind === "photo" ? (m.r2KeyDisplay ? file("display") : null) : (m.r2KeyPoster ? file("poster") : null),
      poster: m.r2KeyPoster ? file("poster") : null,
      // The transcode when the original isn't browser-playable, else the original itself.
      video: m.kind === "video" && m.status === "ready" ? file("video") : null,
      original: file("original"),
    },
  };
}

export function projectSummary(p: typeof crmProjects.$inferSelect) {
  const address = [p.addressLine1, [p.city, p.state].filter(Boolean).join(", "), p.postalCode].filter(Boolean).join(" · ") || null;
  return { id: p.id, name: p.name, number: p.number, address };
}

/** `publicView`: a guest on a share link sees a crew member's display name, never their email address. */
export async function membersMap(orgId: string, publicView = false) {
  const rows = await db.select({ id: crmMembers.id, displayName: crmMembers.displayName, email: crmMembers.email })
    .from(crmMembers).where(eq(crmMembers.orgId, orgId));
  const out = new Map<string, { id: string; name: string }>();
  for (const m of rows) {
    const name = publicUploaderName(m.displayName, m.email, publicView);
    if (name) out.set(m.id, { id: m.id, name });
  }
  return out;
}

export function publicUploaderName(displayName: string | null | undefined, email: string | null | undefined, publicView: boolean): string | null {
  const dn = String(displayName ?? "").trim();
  if (publicView) return dn && !dn.includes("@") ? dn : null;
  return dn || String(email ?? "").trim() || null;
}

/** The variant → key/mime resolution the file routes share (member, share link, client portal). */
export function variantKey(m: JobcamMedia, variant: string): { key: string; mime: string } | null {
  switch (variant) {
    case "thumb": return m.r2KeyThumb ? { key: m.r2KeyThumb, mime: "image/jpeg" } : null;
    case "display": return m.r2KeyDisplay ? { key: m.r2KeyDisplay, mime: "image/jpeg" } : null;
    case "poster": return m.r2KeyPoster ? { key: m.r2KeyPoster, mime: "image/jpeg" } : null;
    case "video":
      if (m.kind !== "video") return null;
      return m.r2KeyVideo ? { key: m.r2KeyVideo, mime: "video/mp4" } : { key: m.r2KeyOriginal, mime: m.mime };
    case "original": return { key: m.r2KeyOriginal, mime: m.mime };
    default: return null;
  }
}

/** Stream one object with Range support; the caller has already authorised the media row. */
export async function streamVariant(req: any, res: any, m: JobcamMedia, variant: string, download = false, cacheS = 3600) {
  const v = variantKey(m, variant);
  if (!v) return res.status(404).json({ message: "Not available yet" });
  // The key must be this row's own object — never another tenant's, whatever the column says.
  if (!keyBelongsTo(v.key, m.orgId, m.id)) return res.status(404).json({ message: "File not found" });
  const obj = await getObject(v.key, v.mime, req.headers.range);
  if (!obj) return res.status(404).json({ message: "File not found" });
  res.status(obj.status);
  res.setHeader("Content-Type", obj.contentType || v.mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", `private, max-age=${cacheS}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (obj.contentLength !== undefined) res.setHeader("Content-Length", String(obj.contentLength));
  if (obj.contentRange) res.setHeader("Content-Range", obj.contentRange);
  if (download) {
    const name = (m.fileName || `${m.kind}-${m.id}`).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  }
  obj.body.on("error", () => { if (!res.headersSent) res.status(500); res.end(); });
  // A viewer who scrubs or closes the tab must not leave the storage read open.
  res.on("close", () => { if (!obj.body.destroyed) obj.body.destroy(); });
  obj.body.pipe(res);
}

// ── Feed query (shared by the member feed, the client page strip and the portal) ──

export type FeedQuery = {
  orgId: string;
  projectIds?: string[] | null;     // null = every project
  customerId?: string | null;
  kind?: "photo" | "video" | null;
  tags?: string[];
  tagMode?: "and" | "or";
  starred?: boolean;
  q?: string | null;
  from?: Date | null;
  to?: Date | null;
  uploaderId?: string | null;
  mediaIds?: string[] | null;
  readyOnly?: boolean;
  /** The homeowner portal: only what a team member chose to show. */
  clientVisibleOnly?: boolean;
  limit?: number;
  /** Cursor: items strictly older than this (capturedAt, id). */
  before?: { at: Date; id: string } | null;
};

/** A JS string list as one Postgres text[] (drizzle would otherwise spread it into a row). */
export function textArray(values: readonly string[]): SQL {
  if (!values.length) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

const feedAt = sql`coalesce(${jobcamMedia.capturedAt}, ${jobcamMedia.uploadedAt})`;

/** The feed's WHERE; null = the filter can match nothing (an empty id list). */
export function feedWhere(f: FeedQuery): SQL[] | null {
  const at = feedAt;
  const where: SQL[] = [eq(jobcamMedia.orgId, f.orgId), isNull(jobcamMedia.deletedAt)];
  if (f.readyOnly !== false) where.push(eq(jobcamMedia.status, "ready"));
  if (f.clientVisibleOnly) where.push(eq(jobcamMedia.clientVisible, true));
  if (f.projectIds) {
    if (!f.projectIds.length) return null;
    where.push(inArray(jobcamMedia.projectId, f.projectIds));
  }
  if (f.customerId) where.push(eq(jobcamMedia.customerId, f.customerId));
  if (f.kind) where.push(eq(jobcamMedia.kind, f.kind));
  if (f.starred) where.push(eq(jobcamMedia.starred, true));
  if (f.uploaderId) where.push(eq(jobcamMedia.uploaderMemberId, f.uploaderId));
  if (f.mediaIds) {
    if (!f.mediaIds.length) return null;
    where.push(inArray(jobcamMedia.id, f.mediaIds));
  }
  if (f.from) where.push(gte(at, f.from) as SQL);
  if (f.to) where.push(lte(at, f.to) as SQL);
  if (f.tags?.length) {
    // Case-insensitive on both sides: "Roof" on the media matches a "roof" filter.
    const wanted = f.tags.map((t) => t.toLowerCase());
    const lowered = sql`(select coalesce(array_agg(lower(x)), '{}') from unnest(coalesce(${jobcamMedia.tags}, '{}')) x)`;
    where.push(f.tagMode === "or" ? sql`${lowered} && ${textArray(wanted)}` : sql`${lowered} @> ${textArray(wanted)}`);
  }
  if (f.before) {
    where.push(sql`(${at}, ${jobcamMedia.id}) < (${f.before.at}, ${f.before.id})`);
  }
  if (f.q) {
    const pat = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Project name/number/address, uploader name, caption, file name, tag.
    where.push(or(
      ilike(jobcamMedia.caption, pat),
      ilike(jobcamMedia.fileName, pat),
      sql`exists (select 1 from unnest(coalesce(${jobcamMedia.tags}, '{}')) t where t ilike ${pat})`,
      sql`exists (select 1 from crm_projects p where p.id = ${jobcamMedia.projectId} and (p.name ilike ${pat} or p.number ilike ${pat} or p.address_line1 ilike ${pat} or p.city ilike ${pat}))`,
      sql`exists (select 1 from crm_members mm where mm.id = ${jobcamMedia.uploaderMemberId} and (mm.display_name ilike ${pat} or mm.email ilike ${pat}))`,
    )!);
  }
  return where;
}

export async function queryFeed(f: FeedQuery): Promise<JobcamMedia[]> {
  const where = feedWhere(f);
  if (!where) return [];
  const limit = Math.min(Math.max(1, f.limit ?? 100), 500);
  return db.select().from(jobcamMedia).where(and(...where)).orderBy(desc(feedAt), desc(jobcamMedia.id)).limit(limit);
}

/**
 * The one row a homeowner's portal session may open by id: theirs, ready, not
 * deleted and switched on for the client. A hidden shot is a 404 even when its
 * id is known.
 */
export function portalMediaWhere(customerIds: string[], id: string): SQL {
  return and(
    eq(jobcamMedia.id, id), inArray(jobcamMedia.customerId, customerIds), isNull(jobcamMedia.deletedAt),
    eq(jobcamMedia.status, "ready"), eq(jobcamMedia.clientVisible, true),
  )!;
}

export function parseFeedParams(q: Record<string, any>) {
  const str = (k: string) => (typeof q[k] === "string" && q[k].trim() ? String(q[k]).trim().slice(0, 300) : null);
  const date = (k: string) => { const s = str(k); if (!s) return null; const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; };
  const tags = normalizeTags(String(q.tags ?? "").split(","));
  let before: FeedQuery["before"] = null;
  const cursor = str("before");
  if (cursor) {
    const i = cursor.lastIndexOf("|");
    const d = new Date(cursor.slice(0, i));
    if (i > 0 && Number.isFinite(d.getTime())) before = { at: d, id: cursor.slice(i + 1) };
  }
  const kindRaw = str("kind");
  const kind: "photo" | "video" | null = kindRaw === "photo" || kindRaw === "video" ? kindRaw : null;
  return {
    tags, tagMode: normalizeTagFilter(str("mode")),
    starred: q.starred === "1" || q.starred === "true",
    q: str("q"), from: date("from"), to: date("to"),
    uploaderId: str("uploader"), kind,
    limit: Math.min(200, Math.max(1, Number(q.limit) || 100)),
    before,
  };
}

export const feedCursor = (m: JobcamMedia) => `${(m.capturedAt ?? m.uploadedAt ?? new Date()).toISOString()}|${m.id}`;

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerJobcamRoutes(app: Express, getDevUser: GetUser): void {
  const ctxFor = async (req: any, res: any): Promise<OrgContext | null> => {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    // Reads and writes alike: no JobCam on the plan, no JobCam.
    if (!(await requireJobcamPlan(res, ctx))) return null;
    return ctx;
  };
  const base = "/api/crm/jobcam/media";

  const mediaFor = async (ctx: OrgContext, id: string): Promise<JobcamMedia | null> => {
    const [m] = await db.select().from(jobcamMedia)
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), eq(jobcamMedia.id, id), isNull(jobcamMedia.deletedAt))).limit(1);
    if (!m) return null;
    return (await visibleProject(ctx, m.projectId)) ? m : null;
  };
  const canTouch = (ctx: OrgContext, m: JobcamMedia) => canManageJobcam(ctx) || m.uploaderMemberId === ctx.member.id;

  // ── Tags ──────────────────────────────────────────────────────────────────

  app.get("/api/crm/jobcam/tags", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const rows = await db.select().from(jobcamTags).where(eq(jobcamTags.orgId, ctx.org.id)).orderBy(asc(jobcamTags.name));
    // Usage counts so the picker can show the busy ones first.
    const counts = await db.select({ tag: sql<string>`t`, n: sql<number>`count(*)::int` })
      .from(sql`${jobcamMedia}, unnest(coalesce(${jobcamMedia.tags}, '{}')) t`)
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), isNull(jobcamMedia.deletedAt))).groupBy(sql`t`);
    const n = new Map(counts.map((c) => [c.tag.toLowerCase(), c.n]));
    res.json(rows.map((t) => ({ id: t.id, name: t.name, color: t.color, count: n.get(t.name.toLowerCase()) ?? 0 })));
  });

  // Any member may create a tag (CompanyCam: admins only — a crew that can't
  // name what it's shooting stops tagging).
  app.post("/api/crm/jobcam/tags", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const parsed = z.object({ name: z.string().trim().min(1).max(TAG_MAX), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).safeParse(req.body ?? {});
    if (!parsed.success || !TAG_RE.test(parsed.data.name)) return res.status(400).json({ message: "Tag names are 1–40 letters, numbers, spaces or - _ / & . #" });
    const name = parsed.data.name.replace(/\s+/g, " ");
    const [existing] = await db.select().from(jobcamTags)
      .where(and(eq(jobcamTags.orgId, ctx.org.id), sql`lower(${jobcamTags.name}) = lower(${name})`)).limit(1);
    if (existing) return res.json({ id: existing.id, name: existing.name, color: existing.color, count: 0, existed: true });
    const [row] = await db.insert(jobcamTags).values({ orgId: ctx.org.id, name, color: parsed.data.color ?? null, createdByMemberId: ctx.member.id }).returning();
    res.status(201).json({ id: row.id, name: row.name, color: row.color, count: 0 });
  });

  app.delete("/api/crm/jobcam/tags/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    if (!canManageJobcam(ctx)) return res.status(403).json({ message: "Requires permission: manageJobs" });
    const [row] = await db.delete(jobcamTags).where(and(eq(jobcamTags.orgId, ctx.org.id), eq(jobcamTags.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Tag not found" });
    // Strip it from media too — the tag list and the filters stay in step.
    await db.update(jobcamMedia).set({ tags: sql`array_remove(${jobcamMedia.tags}, ${row.name})`, updatedAt: new Date() })
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), arrayContains(jobcamMedia.tags, [row.name])));
    res.json({ ok: true });
  });

  // ── Projects for the camera (nearest first) ───────────────────────────────

  app.get("/api/crm/jobcam/projects", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const ids = await visibleProjectIds(ctx);
    const where: SQL[] = [eq(crmProjects.orgId, ctx.org.id), isNull(crmProjects.archivedAt)];
    if (ids) { if (!ids.length) return res.json({ projects: [], located: hasPos }); where.push(inArray(crmProjects.id, ids)); }
    const rows = await db.select().from(crmProjects).where(and(...where)).orderBy(desc(crmProjects.updatedAt)).limit(1000);
    // Where each project's media was shot (centroid) — real coordinates only,
    // from EXIF or the phone; the project's own lat/lng wins when set.
    const centroids = rows.length ? await db.select({
      projectId: jobcamMedia.projectId,
      lat: sql<number>`avg(coalesce(${jobcamMedia.exifLat}, ${jobcamMedia.deviceLat}))`,
      lng: sql<number>`avg(coalesce(${jobcamMedia.exifLng}, ${jobcamMedia.deviceLng}))`,
      n: sql<number>`count(*)::int`,
      last: sql<Date>`max(coalesce(${jobcamMedia.capturedAt}, ${jobcamMedia.uploadedAt}))`,
    }).from(jobcamMedia)
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), isNull(jobcamMedia.deletedAt), eq(jobcamMedia.status, "ready"), inArray(jobcamMedia.projectId, rows.map((p) => p.id))))
      .groupBy(jobcamMedia.projectId) : [];
    const byProject = new Map(centroids.map((c) => [c.projectId, c]));
    const customers = await db.select({ id: crmCustomers.id, name: crmCustomers.displayName }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), inArray(crmCustomers.id, [...new Set(rows.map((p) => p.customerId))])));
    const custName = new Map(customers.map((c) => [c.id, c.name]));
    const out = rows.map((p) => {
      const c = byProject.get(p.id);
      const plat = p.lat ?? (c && c.lat != null ? Number(c.lat) : null);
      const plng = p.lng ?? (c && c.lng != null ? Number(c.lng) : null);
      const distanceM = hasPos && plat != null && plng != null ? haversineM(lat, lng, plat, plng) : null;
      return {
        ...projectSummary(p), status: p.status, customerId: p.customerId, customerName: custName.get(p.customerId) ?? null,
        mediaCount: c?.n ?? 0, lastShotAt: c?.last ?? null, distanceM,
        locationSource: p.lat != null ? "project" : c && c.lat != null ? "media" : null,
      };
    });
    out.sort((a, b) => {
      if (hasPos && (a.distanceM != null || b.distanceM != null)) {
        if (a.distanceM == null) return 1;
        if (b.distanceM == null) return -1;
        return a.distanceM - b.distanceM;
      }
      return (b.lastShotAt ? new Date(b.lastShotAt).getTime() : 0) - (a.lastShotAt ? new Date(a.lastShotAt).getTime() : 0);
    });
    res.json({ projects: out.slice(0, 300), located: hasPos });
  });

  // ── Uploads ───────────────────────────────────────────────────────────────

  const uploadBody = z.object({
    projectId: z.string().min(1).max(64),
    fileName: z.string().trim().max(200).optional(),
    mime: z.string().min(3).max(100),
    bytes: z.number().int().positive(),
    durationS: z.number().nonnegative().max(24 * 3600).optional().nullable(),
    width: z.number().int().positive().max(20000).optional().nullable(),
    height: z.number().int().positive().max(20000).optional().nullable(),
    capturedAt: z.string().datetime({ offset: true }).optional().nullable(),
    deviceLat: z.number().min(-90).max(90).optional().nullable(),
    deviceLng: z.number().min(-180).max(180).optional().nullable(),
    gpsAccuracyM: z.number().nonnegative().max(100000).optional().nullable(),
    tags: z.array(z.string().max(TAG_MAX)).max(30).optional(),
    caption: z.string().trim().max(2000).optional().nullable(),
    stamp: z.object({ time: z.boolean().optional(), gps: z.boolean().optional(), project: z.boolean().optional(), logo: z.boolean().optional() }).optional().nullable(),
  });

  const handleOf = (u: typeof jobcamUploads.$inferSelect): MultipartHandle =>
    ({ mode: u.storageMode as "r2" | "local", key: u.key, storageUploadId: u.storageUploadId });

  const partTargets = async (u: typeof jobcamUploads.$inferSelect, ns: number[]) => {
    const h = handleOf(u);
    const proxy = (n: number) => `/api/crm/jobcam/uploads/${u.id}/parts/${n}`;
    return Promise.all(ns.map(async (n) => ({ n, url: (await directPartUrl(h, n)) ?? proxy(n), proxyUrl: proxy(n) })));
  };

  app.post("/api/crm/jobcam/uploads", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const parsed = uploadBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid upload", issues: parsed.error.issues });
    const b = parsed.data;
    const verdict = validateUploadRequest({ mime: b.mime, bytes: b.bytes, durationS: b.durationS ?? null });
    if (!verdict.ok) return res.status(verdict.status).json({ message: verdict.message });
    const project = await visibleProject(ctx, b.projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const plan = partPlan(b.bytes);
    const mediaId = crypto.randomUUID();
    const key = mediaKey(ctx.org.id, mediaId, `original.${verdict.ext}`);
    const capturedAt = b.capturedAt ? new Date(b.capturedAt) : null;
    const uploadId = crypto.randomUUID();
    // Storage: refuse to open when what is stored + what is already on its way
    // + this file would pass the org's size. The check and both rows are one
    // transaction under the org's storage lock, so two uploads opened together
    // cannot both squeeze past — the second one counts the first one's bytes.
    const room = await withJobcamStorageRoom(ctx.org.id, b.bytes, async (tx) => {
      const [media] = await tx.insert(jobcamMedia).values({
        id: mediaId, orgId: ctx.org.id, projectId: project.id, customerId: project.customerId,
        uploaderMemberId: ctx.member.id, kind: verdict.kind, status: "uploading",
        fileName: b.fileName?.slice(0, 200) || null, mime: b.mime.toLowerCase().split(";")[0], bytes: b.bytes,
        r2KeyOriginal: key, width: b.width ?? null, height: b.height ?? null, durationS: b.durationS ?? null,
        capturedAt: capturedAt && Number.isFinite(capturedAt.getTime()) ? capturedAt : null,
        deviceLat: b.deviceLat ?? null, deviceLng: b.deviceLng ?? null, gpsAccuracyM: b.gpsAccuracyM ?? null,
        tags: normalizeTags(b.tags ?? []), caption: b.caption || null, captionSource: b.caption ? "user" : null,
        stamp: b.stamp ?? null,
      }).returning();
      // The reservation: an open upload of b.bytes (the storage handle is filled in below).
      await tx.insert(jobcamUploads).values({
        id: uploadId, orgId: ctx.org.id, mediaId, memberId: ctx.member.id, storageMode: storageMode(), storageUploadId: null,
        key, partSize: plan.partSize, partsTotal: plan.partsTotal, partsDone: {}, bytes: b.bytes, status: "open",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });
      return media;
    });
    if (!room.ok) return res.status(403).json(room.refusal);
    const media = room.value;
    const dropReservation = async () => {
      await db.delete(jobcamUploads).where(eq(jobcamUploads.id, uploadId));
      await db.delete(jobcamMedia).where(eq(jobcamMedia.id, mediaId));
    };
    let handle: MultipartHandle;
    try {
      handle = await createMultipart(key, media.mime, uploadId);
    } catch (e: any) {
      await dropReservation();
      console.error("[jobcam] createMultipart failed:", e?.message || e);
      return res.status(502).json({ message: `Storage refused the upload: ${String(e?.message || e).slice(0, 200)}` });
    }
    const [upload] = await db.update(jobcamUploads).set({ storageMode: handle.mode, storageUploadId: handle.storageUploadId, updatedAt: new Date() })
      .where(eq(jobcamUploads.id, uploadId)).returning();
    if (!upload) {
      await abortMultipart(handle, uploadId).catch(() => {});
      await dropReservation();
      return res.status(409).json({ message: "This upload was cancelled" });
    }
    // Any member who can see a project may add to it; the tag list grows with capture.
    for (const t of media.tags ?? []) {
      await db.insert(jobcamTags).values({ orgId: ctx.org.id, name: t, createdByMemberId: ctx.member.id }).onConflictDoNothing();
    }
    res.status(201).json({
      uploadId: upload.id, mediaId, mode: handle.mode, partSize: plan.partSize, partsTotal: plan.partsTotal,
      parts: await partTargets(upload, Array.from({ length: plan.partsTotal }, (_, i) => i + 1)),
      urlTtlS: PART_URL_TTL_S,
    });
  });

  const uploadFor = async (ctx: OrgContext, id: string) => {
    // An upload belongs to the seat that opened it: nobody else in the org can
    // push parts into it, finish it or cancel it.
    const [u] = await db.select().from(jobcamUploads)
      .where(and(eq(jobcamUploads.orgId, ctx.org.id), eq(jobcamUploads.id, id), eq(jobcamUploads.memberId, ctx.member.id))).limit(1);
    return u ?? null;
  };

  /** Merge one part into parts_done in a single statement, so parallel parts never overwrite each other. */
  const recordPart = async (uploadRowId: string, n: number, etag: string): Promise<Record<string, string>> => {
    const [row] = await db.update(jobcamUploads).set({
      partsDone: sql`coalesce(${jobcamUploads.partsDone}, '{}'::jsonb) || jsonb_build_object(${String(n)}::text, ${etag}::text)`,
      updatedAt: new Date(),
    }).where(and(eq(jobcamUploads.id, uploadRowId), eq(jobcamUploads.status, "open"))).returning({ partsDone: jobcamUploads.partsDone });
    return ((row?.partsDone as any) ?? markPart(null, n, etag)) as Record<string, string>;
  };

  app.get("/api/crm/jobcam/uploads/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const u = await uploadFor(ctx, req.params.id);
    if (!u) return res.status(404).json({ message: "Upload not found" });
    const missing = missingParts(u.partsDone as any, u.partsTotal);
    res.json({
      uploadId: u.id, mediaId: u.mediaId, status: u.status, mode: u.storageMode, partSize: u.partSize, partsTotal: u.partsTotal,
      partsDone: Object.keys((u.partsDone as any) ?? {}).map(Number).sort((a, b) => a - b),
      parts: u.status === "open" ? await partTargets(u, missing) : [],
      expired: uploadExpired(u.createdAt),
    });
  });

  // Proxy path: the raw part body streams through us into storage (R2 or local).
  app.put("/api/crm/jobcam/uploads/:id/parts/:n", express.raw({ type: () => true, limit: PART_SIZE + 1024 * 1024 }), async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const u = await uploadFor(ctx, req.params.id);
    if (!u || u.status !== "open") return res.status(404).json({ message: "Upload not open" });
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1 || n > u.partsTotal) return res.status(400).json({ message: "Bad part number" });
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = n < u.partsTotal ? u.partSize : u.bytes - (u.partsTotal - 1) * u.partSize;
    if (body.length !== expected) return res.status(400).json({ message: `Part ${n} should be ${expected} bytes, got ${body.length}` });
    try {
      const etag = await putPart(handleOf(u), u.id, n, body);
      const done = await recordPart(u.id, n, etag);
      res.json({ n, etag, partsDone: Object.keys(done).length });
    } catch (e: any) {
      console.error("[jobcam] part upload failed:", e?.message || e);
      res.status(502).json({ message: `Storage refused part ${n}: ${String(e?.message || e).slice(0, 200)}` });
    }
  });

  // Direct path: the browser PUT the part to R2 and hands us the ETag.
  app.post("/api/crm/jobcam/uploads/:id/parts/:n", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const u = await uploadFor(ctx, req.params.id);
    if (!u || u.status !== "open") return res.status(404).json({ message: "Upload not open" });
    const n = Number(req.params.n);
    const etag = String(req.body?.etag ?? "").trim();
    if (!Number.isInteger(n) || n < 1 || n > u.partsTotal || !etag || etag.length > 200) return res.status(400).json({ message: "Bad part" });
    if (u.storageMode !== "r2") return res.status(400).json({ message: "Send the part body to this URL with PUT" });
    const done = await recordPart(u.id, n, etag);
    res.json({ n, etag, partsDone: Object.keys(done).length });
  });

  app.post("/api/crm/jobcam/uploads/:id/complete", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const u = await uploadFor(ctx, req.params.id);
    if (!u) return res.status(404).json({ message: "Upload not found" });
    const [m] = await db.select().from(jobcamMedia)
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), eq(jobcamMedia.id, u.mediaId))).limit(1);
    if (!m) return res.status(404).json({ message: "Media not found" });
    if (m.deletedAt) return res.status(409).json({ message: "This shot was deleted" });
    if (u.status === "completed") return res.json(presentMedia(m, base));
    if (u.status !== "open") return res.status(409).json({ message: "This upload was cancelled" });
    const done = (u.partsDone as any) ?? {};
    if (!canComplete(done, u.partsTotal)) {
      return res.status(409).json({ message: "Some parts are missing", missing: missingParts(done, u.partsTotal) });
    }
    if (uploadExpired(u.createdAt)) return res.status(409).json({ message: "This upload expired — send the file again." });
    // Storage is checked again here: the size may have been lowered, or the
    // meter recounted, since the upload was opened. A refused upload leaves
    // nothing behind — no multipart, no object, no rows.
    const refuseForStorage = async (refusal: NonNullable<ReturnType<typeof jobcamStorageRefusal>>) => {
      await abortMultipart(handleOf(u), u.id).catch(() => {});
      await deleteObject(u.key).catch(() => {});
      await db.update(jobcamUploads).set({ status: "aborted", updatedAt: new Date() }).where(eq(jobcamUploads.id, u.id));
      await db.delete(jobcamMedia).where(and(eq(jobcamMedia.id, m.id), eq(jobcamMedia.status, "uploading")));
      return res.status(403).json(refusal);
    };
    // Before storage assembles the parts (cheap to stop here: the parts are simply dropped)…
    const early = jobcamStorageRefusal(await jobcamStorageSnapshot(ctx.org.id, { excludeUploadId: u.id }), u.bytes);
    if (early) return refuseForStorage(early);
    try {
      await completeMultipart(handleOf(u), u.id, completedParts(done, u.partsTotal));
    } catch (e: any) {
      // A retried /complete after storage already assembled the object lands
      // here (the multipart id is gone); the size check below decides.
      if ((await objectSize(u.key)) === null) {
        console.error("[jobcam] complete failed:", e?.message || e);
        return res.status(502).json({ message: `Storage could not finish the upload: ${String(e?.message || e).slice(0, 200)}` });
      }
    }
    // The announced size is what the caps were checked against, so the stored
    // object must be exactly that — an unreadable size is a refusal, not a pass.
    const size = await objectSize(u.key);
    if (size === null) return res.status(502).json({ message: "Storage did not confirm the upload — try again." });
    if (size !== u.bytes) {
      await deleteObject(u.key).catch(() => {});
      await db.update(jobcamUploads).set({ status: "aborted", updatedAt: new Date() }).where(eq(jobcamUploads.id, u.id));
      await db.delete(jobcamMedia).where(eq(jobcamMedia.id, m.id));
      return res.status(409).json({ message: `The stored file is ${size} bytes but ${u.bytes} were announced — upload it again.` });
    }
    const next = nextMediaStatus(m.status as any, "complete");
    if (!next) return res.status(409).json({ message: `Media is already ${m.status}` });
    // …and for real on the stored size, under the org's storage lock, in the
    // same transaction as the open → completed move. Only one request wins that
    // move (a double tap must not log or queue twice).
    const moved = await withJobcamStorageRoom(ctx.org.id, size, async (tx) => {
      const [won] = await tx.update(jobcamUploads).set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(jobcamUploads.id, u.id), eq(jobcamUploads.status, "open"))).returning({ id: jobcamUploads.id });
      if (!won) return null;
      const [row] = await tx.update(jobcamMedia).set({ status: next, uploadedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobcamMedia.id, m.id)).returning();
      return row;
    }, { excludeUploadId: u.id });
    if (!moved.ok) return refuseForStorage(moved.refusal);
    const updated = moved.value;
    if (!updated) return res.json(presentMedia(m, base));
    enqueueMedia(m.id);
    logActivity(ctx, "jobcam.media.added", { entityType: "jobcam_media", entityId: m.id, customerId: m.customerId, meta: { kind: m.kind, projectId: m.projectId } });
    res.json(presentMedia(updated, base));
  });

  app.delete("/api/crm/jobcam/uploads/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const u = await uploadFor(ctx, req.params.id);
    if (!u) return res.status(404).json({ message: "Upload not found" });
    if (u.status === "open") {
      await abortMultipart(handleOf(u), u.id);
      await db.update(jobcamUploads).set({ status: "aborted", updatedAt: new Date() }).where(eq(jobcamUploads.id, u.id));
      await db.delete(jobcamMedia).where(and(eq(jobcamMedia.id, u.mediaId), eq(jobcamMedia.status, "uploading")));
    }
    res.json({ ok: true });
  });

  // ── Media ─────────────────────────────────────────────────────────────────

  app.get("/api/crm/jobcam/media", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const p = parseFeedParams(req.query);
    let projectIds: string[] | null = await visibleProjectIds(ctx);
    const one = typeof req.query.projectId === "string" ? req.query.projectId : null;
    if (one) {
      if (!(await visibleProject(ctx, one))) return res.status(404).json({ message: "Project not found" });
      projectIds = [one];
    }
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    const rows = await queryFeed({
      orgId: ctx.org.id, projectIds, customerId, ...p,
      readyOnly: req.query.all !== "1",
      limit: p.limit + 1,
    });
    const page = rows.slice(0, p.limit);
    const projects = await projectsById(ctx.org.id, [...new Set(page.map((m) => m.projectId))]);
    const members = await membersMap(ctx.org.id);
    res.json({
      media: page.map((m) => presentMedia(m, base, {
        project: projects.has(m.projectId) ? projectSummary(projects.get(m.projectId)!) : null,
        uploader: m.uploaderMemberId ? members.get(m.uploaderMemberId) ?? null : null,
      })),
      nextCursor: rows.length > p.limit ? feedCursor(page[page.length - 1]) : null,
      mode: storageMode(),
    });
  });

  app.get("/api/crm/jobcam/media/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const m = await mediaFor(ctx, req.params.id);
    if (!m) return res.status(404).json({ message: "Media not found" });
    const projects = await projectsById(ctx.org.id, [m.projectId]);
    const members = await membersMap(ctx.org.id);
    res.json(presentMedia(m, base, {
      project: projects.has(m.projectId) ? projectSummary(projects.get(m.projectId)!) : null,
      uploader: m.uploaderMemberId ? members.get(m.uploaderMemberId) ?? null : null,
    }));
  });

  const patchBody = z.object({
    starred: z.boolean().optional(),
    clientVisible: z.boolean().optional(),
    tags: z.array(z.string().max(TAG_MAX)).max(30).optional(),
    caption: z.string().trim().max(2000).nullable().optional(),
    stamp: z.object({ time: z.boolean().optional(), gps: z.boolean().optional(), project: z.boolean().optional(), logo: z.boolean().optional() }).nullable().optional(),
  });

  app.patch("/api/crm/jobcam/media/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const m = await mediaFor(ctx, req.params.id);
    if (!m) return res.status(404).json({ message: "Media not found" });
    const parsed = patchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid change", issues: parsed.error.issues });
    const b = parsed.data;
    // Starring is personal-ish but org-visible; captions/tags on someone else's shot — and what the
    // homeowner gets to see — need the uploader or manage rights.
    if ((b.tags !== undefined || b.caption !== undefined || b.stamp !== undefined || b.clientVisible !== undefined) && !canTouch(ctx, m)) {
      return res.status(403).json({ message: "Only the uploader or a manager can change this" });
    }
    const set: Partial<JobcamMedia> = { updatedAt: new Date() };
    if (b.starred !== undefined) set.starred = b.starred;
    if (b.clientVisible !== undefined) set.clientVisible = b.clientVisible;
    if (b.tags !== undefined) {
      set.tags = normalizeTags(b.tags);
      for (const t of set.tags) await db.insert(jobcamTags).values({ orgId: ctx.org.id, name: t, createdByMemberId: ctx.member.id }).onConflictDoNothing();
    }
    if (b.caption !== undefined) { set.caption = b.caption || null; set.captionSource = b.caption ? "user" : null; }
    if (b.stamp !== undefined) set.stamp = b.stamp;
    const [row] = await db.update(jobcamMedia).set(set).where(eq(jobcamMedia.id, m.id)).returning();
    if (b.clientVisible !== undefined && b.clientVisible !== m.clientVisible) {
      logActivity(ctx, b.clientVisible ? "jobcam.media.shown_to_client" : "jobcam.media.hidden_from_client", { entityType: "jobcam_media", entityId: m.id, customerId: m.customerId, meta: { kind: m.kind, projectId: m.projectId } });
    }
    res.json(presentMedia(row, base));
  });

  const softDelete = async (ctx: OrgContext, rows: JobcamMedia[]) => {
    const ids = rows.map((m) => m.id);
    if (!ids.length) return 0;
    // Only rows this statement actually flipped are taken off the storage meter
    // (two deletes of the same shot must not subtract twice).
    const flipped = await db.update(jobcamMedia).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), inArray(jobcamMedia.id, ids), isNull(jobcamMedia.deletedAt))).returning();
    for (const m of flipped) {
      if (m.status === "ready") await bumpJobcamUsage(ctx.org.id, { bytes: -(m.bytes + m.renditionBytes), kind: m.kind as "photo" | "video", count: -1 });
      logActivity(ctx, "jobcam.media.deleted", { entityType: "jobcam_media", entityId: m.id, customerId: m.customerId, meta: { kind: m.kind, projectId: m.projectId } });
    }
    return flipped.length;
  };

  app.delete("/api/crm/jobcam/media/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const m = await mediaFor(ctx, req.params.id);
    if (!m) return res.status(404).json({ message: "Media not found" });
    if (!canTouch(ctx, m)) return res.status(403).json({ message: "Only the uploader or a manager can delete this" });
    await softDelete(ctx, [m]);
    res.json({ ok: true });
  });

  // A failed job (ffmpeg hiccup, storage blip) can be run again by whoever may edit the shot.
  app.post("/api/crm/jobcam/media/:id/retry", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const m = await mediaFor(ctx, req.params.id);
    if (!m) return res.status(404).json({ message: "Media not found" });
    if (!canTouch(ctx, m)) return res.status(403).json({ message: "Only the uploader or a manager can retry this" });
    if (m.status !== "failed" || !nextMediaStatus("failed", "retry")) return res.status(409).json({ message: `Media is ${m.status}` });
    const [row] = await db.update(jobcamMedia).set({ status: "processing", error: null, updatedAt: new Date() })
      .where(and(eq(jobcamMedia.id, m.id), eq(jobcamMedia.status, "failed"))).returning();
    if (row) enqueueMedia(row.id);
    res.json(presentMedia(row ?? m, base));
  });

  app.post("/api/crm/jobcam/media/bulk", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const parsed = z.object({
      ids: z.array(z.string().max(64)).min(1).max(500),
      action: z.enum(["star", "unstar", "tag", "untag", "client_show", "client_hide", "delete"]),
      tags: z.array(z.string().max(TAG_MAX)).max(30).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid bulk action" });
    const { ids, action } = parsed.data;
    const tags = normalizeTags(parsed.data.tags ?? []);
    const rows = await db.select().from(jobcamMedia)
      .where(and(eq(jobcamMedia.orgId, ctx.org.id), inArray(jobcamMedia.id, ids), isNull(jobcamMedia.deletedAt)));
    const allowedIds = await visibleProjectIds(ctx);
    const visible = rows.filter((m) => !allowedIds || allowedIds.includes(m.projectId));
    const touchable = action === "star" || action === "unstar" ? visible : visible.filter((m) => canTouch(ctx, m));
    const tIds = touchable.map((m) => m.id);
    let n = 0;
    if (tIds.length) {
      if (action === "star" || action === "unstar") {
        await db.update(jobcamMedia).set({ starred: action === "star", updatedAt: new Date() }).where(inArray(jobcamMedia.id, tIds));
        n = tIds.length;
      } else if (action === "tag" && tags.length) {
        for (const t of tags) await db.insert(jobcamTags).values({ orgId: ctx.org.id, name: t, createdByMemberId: ctx.member.id }).onConflictDoNothing();
        await db.update(jobcamMedia).set({
          tags: sql`(select array_agg(distinct x) from unnest(coalesce(${jobcamMedia.tags}, '{}') || ${textArray(tags)}) x)`, updatedAt: new Date(),
        }).where(inArray(jobcamMedia.id, tIds));
        n = tIds.length;
      } else if (action === "untag" && tags.length) {
        for (const t of tags) {
          await db.update(jobcamMedia).set({ tags: sql`array_remove(${jobcamMedia.tags}, ${t})`, updatedAt: new Date() }).where(inArray(jobcamMedia.id, tIds));
        }
        n = tIds.length;
      } else if (action === "client_show" || action === "client_hide") {
        await db.update(jobcamMedia).set({ clientVisible: action === "client_show", updatedAt: new Date() }).where(inArray(jobcamMedia.id, tIds));
        n = tIds.length;
      } else if (action === "delete") {
        n = await softDelete(ctx, touchable);
      }
    }
    res.json({ ok: true, changed: n, skipped: ids.length - n });
  });

  app.get("/api/crm/jobcam/media/:id/file/:variant", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const m = await mediaFor(ctx, req.params.id);
    if (!m) return res.status(404).json({ message: "Media not found" });
    await streamVariant(req, res, m, String(req.params.variant), req.query.download === "1");
  });

  // ── Usage (Settings → Limits & usage) ─────────────────────────────────────

  app.get("/api/crm/jobcam/usage", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const [u, storage, request] = await Promise.all([
      getJobcamUsage(ctx.org.id), getJobcamStorage(ctx.org.id), openJobcamStorageRequest(ctx.org.id),
    ]);
    res.json({ ...u, ...storage, storageRequest: request ? { requestedAt: request.createdAt } : null, mode: storageMode() });
  });

  // "Request more storage": larger sizes are not for sale yet, so this is a
  // note to ConstructHUB (the Platform admin page lists it) — not a purchase.
  app.post("/api/crm/jobcam/storage-request", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const r = await requestJobcamStorage(ctx.org.id, ctx.member.id);
    if (!r.existed) logActivity(ctx, "jobcam.storage.requested", { entityType: "jobcam_storage", entityId: r.id });
    res.status(r.existed ? 200 : 201).json({ ok: true, requestedAt: r.createdAt, existed: r.existed });
  });
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

