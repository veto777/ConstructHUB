/**
 * The photo library: every CRM project photo of the org in one place, and the
 * bridges that hand them to the platform's Google tools.
 *
 * Where the photos come from (all crm_attachments kind "photo", refId = the
 * CRM client — server/crm/attachments.ts):
 *   - crew uploads from the client page: the stage rides in the stored name,
 *     "progress--x.jpg" / "finished--x.jpg";
 *   - HOVER capture photos: "hover-<jobId>-<imageId>.jpg" (server/crm/hover.ts);
 *   - everything else carries no tag. The CRM uploader always sends a stage,
 *     so an untagged, non-HOVER photo is one the homeowner shared from the
 *     client portal ("From clients"). That is an inference from the name, not
 *     a stored source column.
 * JobCam media (jobcam_media, R2) is a separate library and is not listed here.
 *
 * Scoping: a photo is visible exactly when its client is (objectPolicy — the
 * same rule GET /api/crm/attachments applies row by row). The list asks the
 * policy once per client, then pages in SQL over the visible clients, and runs
 * the page through the attachment policy again. Division and assignment rules
 * therefore come from object-access.ts / divisions.ts and nothing here.
 *
 * Bridges (platform routes, so the platform paywall applies — server/platform-access.ts):
 *   POST /api/photos/from-crm      → the Photo Optimizer's upload staging (geo-tag/optimize for a Google profile)
 *   POST /api/media/from-crm       → copies into a Media library folder (R2), which every platform tool reads
 *   review requests                → resolveReviewCrmLink(): the request keeps an allow-list of CRM photo ids that
 *                                    the review page streams through a token-scoped route (no copies, no public URL)
 * Each needs a signed-in platform user with platform access AND an active CRM membership that can see the photo.
 * Nothing here posts to Google: Business Profile API access was refused, so the tools prepare files to upload.
 */
import type { Express, Response } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import archiver from "archiver";
import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  crmAttachments, crmCustomers, crmMeasurements, crmMembers, crmProjects, mediaFolders, mediaPhotos, reviewRequests,
  type CrmPermission,
} from "@shared/schema";
import { requireOrg, type OrgContext } from "./tenancy";
import { objectPolicy } from "./object-access";
import { storedFilePath } from "./attachments";
import { likeContains } from "./entities";
import { requirePlatformAccess } from "../platform-access";
import { rateLimit } from "../growth-limits";
import { r2Configured, uploadToR2, getR2Url } from "../r2";
import { logError } from "../ops/log";

type GetUser = (req: any, res: any) => any;
type Attachment = typeof crmAttachments.$inferSelect;
type Customer = typeof crmCustomers.$inferSelect;
type Project = typeof crmProjects.$inferSelect;

// ── Classification ──────────────────────────────────────────────────────────

export const PHOTO_FILTERS = ["all", "progress", "finished", "client", "hover", "unstaged"] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];
export type PhotoSource = "crew" | "client" | "hover";

/** Stage, source and the display name of a stored photo file name (pure). */
export function classifyPhoto(fileName: string): {
  stage: "progress" | "finished" | null; source: PhotoSource; hoverJobId: string | null; displayName: string;
} {
  if (fileName.startsWith("progress--")) return { stage: "progress", source: "crew", hoverJobId: null, displayName: fileName.slice(10) || fileName };
  if (fileName.startsWith("finished--")) return { stage: "finished", source: "crew", hoverJobId: null, displayName: fileName.slice(10) || fileName };
  if (fileName.startsWith("hover-")) {
    const m = /^hover-(.+)-([^-]+)\.[A-Za-z0-9]+$/.exec(fileName);
    return { stage: null, source: "hover", hoverJobId: m ? m[1] : null, displayName: fileName };
  }
  return { stage: null, source: "client", hoverJobId: null, displayName: fileName };
}

const fn = crmAttachments.fileName;
const IS_PROGRESS = sql`${fn} like 'progress--%'`;
const IS_FINISHED = sql`${fn} like 'finished--%'`;
const IS_HOVER = sql`${fn} like 'hover-%'`;
/** The SQL twin of classifyPhoto for one filter (null = no condition). */
export function filterSql(f: PhotoFilter): SQL | null {
  switch (f) {
    case "progress": return IS_PROGRESS;
    case "finished": return IS_FINISHED;
    case "hover": return IS_HOVER;
    case "client": return sql`not (${IS_PROGRESS}) and not (${IS_FINISHED}) and not (${IS_HOVER})`;
    case "unstaged": return sql`not (${IS_PROGRESS}) and not (${IS_FINISHED})`;
    default: return null;
  }
}

/** A client's work as one word for the job filter: finished work vs work under way. */
const DONE_STATUSES = new Set(["complete", "invoiced", "paid"]);
const ACTIVE_STATUSES = new Set(["approved", "scheduled", "in_progress", "waiting_on_trades", "punch_list"]);
export const JOB_STATUS_FILTERS = ["all", "active", "completed"] as const;

// ── Context: an existing CRM membership, then the CRM's own gate ────────────

/**
 * requireOrg, but never creates a personal org: the platform tools call these
 * routes for accounts that may never have opened the CRM, and a photo picker
 * must not mint an empty company. No active membership → 404 no_crm_company.
 */
export async function photoCtx(req: any, res: any, getUser: GetUser): Promise<OrgContext | null> {
  const user = getUser(req, res);
  if (!user) return null;
  const [m] = await db.select({ id: crmMembers.id }).from(crmMembers)
    .where(and(eq(crmMembers.userId, user.id), eq(crmMembers.status, "active"))).limit(1);
  if (!m) {
    res.status(404).json({ code: "no_crm_company", message: "This account is not on a CRM team, so there are no project photos to show." });
    return null;
  }
  return requireOrg(req, res, user.id);
}

/** Taking photos OUT of the CRM (into a platform tool) is the same right as adding them: job or client rights. */
export const EXPORT_PERMS: readonly CrmPermission[] = ["manageJobs", "manageCustomers"];
function canExport(res: any, ctx: OrgContext): boolean {
  if (EXPORT_PERMS.some((p) => ctx.permissions[p])) return true;
  res.status(403).json({ message: "Requires permission: manageJobs or manageCustomers" });
  return false;
}

// ── Scope: the clients this seat may see, their projects ────────────────────

type Scope = {
  customers: Map<string, Customer>;
  projectsByCustomer: Map<string, Project[]>;
  /** HOVER job id → the (visible) project its measurement is filed to. */
  hoverProject: Map<string, string>;
};

async function chunked<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 5000) out.push(...await run(ids.slice(i, i + 5000)));
  return out;
}

async function buildScope(ctx: OrgContext, customers: Customer[]): Promise<Scope> {
  const policy = objectPolicy(ctx);
  const visible = await policy.filter("customers", customers);
  const ids = visible.map((c) => c.id);
  const projects = ids.length ? await policy.filter("projects", await chunked(ids, (chunk) =>
    db.select().from(crmProjects).where(and(eq(crmProjects.orgId, ctx.org.id), inArray(crmProjects.customerId, chunk), isNull(crmProjects.archivedAt)))
      .orderBy(desc(crmProjects.createdAt)))) : [];
  const projectsByCustomer = new Map<string, Project[]>();
  for (const p of projects) projectsByCustomer.set(p.customerId, [...(projectsByCustomer.get(p.customerId) ?? []), p]);
  const projectIds = new Set(projects.map((p) => p.id));
  const hoverProject = new Map<string, string>();
  if (ids.length) {
    const ms = await chunked(ids, (chunk) => db.select({ externalId: crmMeasurements.externalId, projectId: crmMeasurements.projectId })
      .from(crmMeasurements).where(and(eq(crmMeasurements.orgId, ctx.org.id), eq(crmMeasurements.provider, "hover"), inArray(crmMeasurements.customerId, chunk))));
    for (const m of ms) if (m.externalId && m.projectId && projectIds.has(m.projectId)) hoverProject.set(m.externalId, m.projectId);
  }
  return { customers: new Map(visible.map((c) => [c.id, c])), projectsByCustomer, hoverProject };
}

/** Every client of the org that has at least one photo, as this seat may see them. */
async function photoScope(ctx: OrgContext): Promise<Scope> {
  const rows = await db.select().from(crmCustomers).where(and(
    eq(crmCustomers.orgId, ctx.org.id),
    sql`exists (select 1 from crm_attachments a where a.org_id = ${crmCustomers.orgId} and a.kind = 'photo' and a.ref_id = ${crmCustomers.id})`,
  ));
  return buildScope(ctx, rows);
}

const addressOf = (c: Customer) => [c.addressLine1, c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
const matchesQ = (c: Customer, q: string) => {
  const hay = [c.displayName, c.companyName, c.addressLine1, c.city, c.postalCode, c.email].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};
function jobStatusOf(projects: Project[] | undefined): { active: boolean; completed: boolean } {
  return {
    active: !!projects?.some((p) => ACTIVE_STATUSES.has(p.status)),
    completed: !!projects?.some((p) => DONE_STATUSES.has(p.status)),
  };
}

/** The project a photo belongs to, when it can be told: a HOVER capture by its measurement, else the client's only project. */
function projectOf(scope: Scope, att: Attachment): Project | null {
  const list = scope.projectsByCustomer.get(att.refId ?? "") ?? [];
  const { hoverJobId } = classifyPhoto(att.fileName);
  if (hoverJobId) {
    const pid = scope.hoverProject.get(hoverJobId);
    const p = pid ? list.find((x) => x.id === pid) : undefined;
    if (p) return p;
  }
  return list.length === 1 ? list[0] : null;
}

// ── Presentation ────────────────────────────────────────────────────────────

const THUMB = (id: string, size: "sm" | "lg" = "sm") => `/api/crm/photos/${id}/thumb${size === "lg" ? "?size=lg" : ""}`;
function presentPhoto(scope: Scope, a: Attachment) {
  const c = scope.customers.get(a.refId ?? "");
  const cls = classifyPhoto(a.fileName);
  const p = projectOf(scope, a);
  return {
    id: a.id,
    fileName: cls.displayName,
    stage: cls.stage,
    source: cls.source,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
    thumbUrl: THUMB(a.id),
    url: THUMB(a.id, "lg"),
    downloadUrl: `/api/crm/attachments/${a.id}/file`,
    customer: c ? { id: c.id, name: c.displayName, address: addressOf(c) } : null,
    project: p ? { id: p.id, name: p.name, status: p.status } : null,
  };
}

// ── Query parsing ───────────────────────────────────────────────────────────

const listQuery = z.object({
  stage: z.enum(PHOTO_FILTERS).default("all"),
  jobStatus: z.enum(JOB_STATUS_FILTERS).default("all"),
  customerId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(60),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
type ListQuery = z.infer<typeof listQuery>;

const day = (s: string | undefined, end: boolean): Date | null => {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? "23:59:59.999" : "00:00:00"}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The visible client ids a query covers, plus the SQL that narrows the rows.
 * Returns null when nothing can match (an empty answer, not an error).
 */
async function narrow(ctx: OrgContext, scope: Scope, q: ListQuery): Promise<{ ids: string[]; conds: SQL[] } | null> {
  let customers = [...scope.customers.values()];
  const conds: SQL[] = [];
  if (q.customerId) customers = customers.filter((c) => c.id === q.customerId);
  if (q.projectId) {
    // The policy decides whether the project is there at all.
    const [proj] = await objectPolicy(ctx).filter("projects", await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, q.projectId))).limit(1));
    if (!proj) return null;
    customers = customers.filter((c) => c.id === proj.customerId);
    // A client with several jobs: leave out the HOVER captures filed to the OTHER jobs.
    const others = (scope.projectsByCustomer.get(proj.customerId) ?? []).filter((p) => p.id !== proj.id).map((p) => p.id);
    const otherJobs = [...scope.hoverProject.entries()].filter(([, pid]) => others.includes(pid)).map(([job]) => job);
    for (const job of otherJobs) conds.push(sql`${fn} not like ${`hover-${job.replace(/[\\%_]/g, (m) => `\\${m}`)}-%`}`);
  }
  if (q.q?.trim()) customers = customers.filter((c) => matchesQ(c, q.q!.trim()));
  if (q.jobStatus !== "all") {
    customers = customers.filter((c) => jobStatusOf(scope.projectsByCustomer.get(c.id))[q.jobStatus as "active" | "completed"]);
  }
  if (!customers.length) return null;
  const from = day(q.from, false), to = day(q.to, true);
  if (from) conds.push(gte(crmAttachments.createdAt, from));
  if (to) conds.push(lte(crmAttachments.createdAt, to));
  return { ids: customers.map((c) => c.id), conds };
}

const baseWhere = (ctx: OrgContext, ids: string[], conds: SQL[]) =>
  and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "photo"), inArray(crmAttachments.refId, ids), ...conds)!;

const FACETS = {
  all: sql<number>`count(*)::int`,
  progress: sql<number>`(count(*) filter (where ${IS_PROGRESS}))::int`,
  finished: sql<number>`(count(*) filter (where ${IS_FINISHED}))::int`,
  client: sql<number>`(count(*) filter (where ${filterSql("client")}))::int`,
  hover: sql<number>`(count(*) filter (where ${IS_HOVER}))::int`,
  unstaged: sql<number>`(count(*) filter (where ${filterSql("unstaged")}))::int`,
};
const EMPTY_FACETS = { all: 0, progress: 0, finished: 0, client: 0, hover: 0, unstaged: 0 };

/** The visible photos among `ids` (org, kind photo, then the attachment policy). Missing or hidden ids are dropped. */
export async function visiblePhotos(ctx: OrgContext, ids: string[]): Promise<Attachment[]> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const rows = await db.select().from(crmAttachments)
    .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "photo"), inArray(crmAttachments.id, uniq)));
  const allowed = await objectPolicy(ctx).filter("attachments", rows);
  const byId = new Map(allowed.map((a) => [a.id, a]));
  return uniq.map((id) => byId.get(id)).filter((a): a is Attachment => !!a);
}

// ── Renditions (thumbnails) ─────────────────────────────────────────────────

const RENDITIONS = { sm: 420, lg: 1600 } as const;
const THUMB_DIR = path.join(process.cwd(), "tmp", "crm-photo-thumbs");
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

/**
 * A size-capped JPEG of a stored photo, cached on disk by attachment id (ids
 * are never reused; a deleted photo's rendition is unreachable because every
 * read re-checks the row first). Null when the source cannot be decoded (HEIC
 * from an iPhone: libvips here has no HEVC decoder) or is missing.
 */
export async function rendition(att: Attachment, size: keyof typeof RENDITIONS): Promise<string | null> {
  const src = storedFilePath(att);
  if (!src) return null;
  const out = path.join(THUMB_DIR, att.orgId.replace(/[^\w-]/g, "_"), `${att.id.replace(/[^\w-]/g, "_")}-${size}.jpg`);
  if (fs.existsSync(out)) return out;
  if (att.sizeBytes > MAX_SOURCE_BYTES) return null;
  try {
    await withSlot(async () => {
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.${randomUUID()}.tmp`;
      await sharp(src, { failOn: "none", limitInputPixels: 120_000_000 }).rotate()
        .resize({ width: RENDITIONS[size], height: RENDITIONS[size], fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: size === "sm" ? 72 : 85, mozjpeg: true }).toFile(tmp);
      await fs.promises.rename(tmp, out);
    });
    return out;
  } catch {
    return null;
  }
}

function sendRendition(res: Response, file: string, maxAge = 86400) {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", `private, max-age=${maxAge}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(file).pipe(res);
}
function sendOriginal(res: Response, att: Attachment, name: string, inline: boolean) {
  const abs = storedFilePath(att);
  if (!abs) return void res.status(404).json({ message: "File not found" });
  res.setHeader("Content-Type", att.mime);
  res.setHeader("Content-Length", String(fs.statSync(abs).size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeZipName(name)}"`);
  fs.createReadStream(abs).pipe(res);
}

const safeZipName = (s: string) => String(s || "photo").replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "photo";

// ── CRM routes ──────────────────────────────────────────────────────────────

export function registerCrmPhotoLibraryRoutes(app: Express, getDevUser: GetUser): void {
  /** The Photos page grid (and the platform pickers): one page of photos plus per-filter counts. */
  app.get("/api/crm/photos", async (req: any, res) => {
    const parsed = listQuery.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Unknown photo filter." });
    const ctx = await photoCtx(req, res, getDevUser);
    if (!ctx) return;
    const q = parsed.data;
    const scope = await photoScope(ctx);
    const n = await narrow(ctx, scope, q);
    if (!n) return res.json({ photos: [], total: 0, facets: EMPTY_FACETS, limit: q.limit, offset: q.offset, nextOffset: null });
    const where = baseWhere(ctx, n.ids, n.conds);
    const [facets] = await db.select(FACETS).from(crmAttachments).where(where);
    const stageCond = filterSql(q.stage);
    const rows = await db.select().from(crmAttachments)
      .where(stageCond ? and(where, stageCond) : where)
      .orderBy(desc(crmAttachments.createdAt), desc(crmAttachments.id))
      .limit(q.limit).offset(q.offset);
    const page = await objectPolicy(ctx).filter("attachments", rows);
    const total = facets[q.stage];
    res.json({
      photos: page.map((a) => presentPhoto(scope, a)),
      total, facets, limit: q.limit, offset: q.offset,
      nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null,
    });
  });

  /** "By job": every visible client with photos — counts per stage, a cover photo, the newest job. */
  app.get("/api/crm/photos/jobs", async (req: any, res) => {
    const parsed = listQuery.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Unknown photo filter." });
    const ctx = await photoCtx(req, res, getDevUser);
    if (!ctx) return;
    const q = parsed.data;
    const scope = await photoScope(ctx);
    const n = await narrow(ctx, scope, q);
    if (!n) return res.json({ jobs: [], total: 0, limit: q.limit, offset: q.offset, nextOffset: null });
    const where = baseWhere(ctx, n.ids, n.conds);
    const stageCond = filterSql(q.stage);
    const groups = await db.select({ refId: crmAttachments.refId, last: sql<string>`max(${crmAttachments.createdAt})`, ...FACETS })
      .from(crmAttachments).where(where).groupBy(crmAttachments.refId)
      .having(stageCond ? sql`count(*) filter (where ${stageCond}) > 0` : undefined)
      .orderBy(sql`max(${crmAttachments.createdAt}) desc`);
    const page = groups.slice(q.offset, q.offset + q.limit);
    const pageIds = page.map((g) => g.refId!).filter(Boolean);
    // The cover: the newest finished shot, else the newest photo.
    const covers = pageIds.length ? (await db.execute(sql`
      select distinct on (ref_id) id, ref_id from crm_attachments
      where org_id = ${ctx.org.id} and kind = 'photo' and ref_id in ${pageIds}
      order by ref_id, (file_name like 'finished--%') desc, created_at desc, id desc`)).rows as { id: string; ref_id: string }[] : [];
    const coverOf = new Map(covers.map((c) => [c.ref_id, c.id]));
    res.json({
      jobs: page.map((g) => {
        const c = scope.customers.get(g.refId!)!;
        const projects = scope.projectsByCustomer.get(c.id) ?? [];
        const cover = coverOf.get(c.id);
        return {
          customer: { id: c.id, name: c.displayName, address: addressOf(c) },
          project: projects[0] ? { id: projects[0].id, name: projects[0].name, status: projects[0].status } : null,
          projectCount: projects.length,
          jobStatus: jobStatusOf(projects),
          counts: { all: g.all, progress: g.progress, finished: g.finished, client: g.client, hover: g.hover, unstaged: g.unstaged },
          cover: cover ? { id: cover, thumbUrl: THUMB(cover) } : null,
          lastPhotoAt: g.last,
        };
      }),
      total: groups.length, limit: q.limit, offset: q.offset,
      nextOffset: q.offset + page.length < groups.length ? q.offset + page.length : null,
    });
  });

  /** "Select client" (the review-request composer): a search over the clients this seat may see, with photo counts. */
  app.get("/api/crm/photos/clients", async (req: any, res) => {
    const ctx = await photoCtx(req, res, getDevUser);
    if (!ctx) return;
    const q = String(req.query.q ?? "").trim().slice(0, 200);
    const conds: SQL[] = [eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt)];
    // ?id= resolves one client (the CRM Photos page hand-off); the policy below still decides.
    if (typeof req.query.id === "string" && req.query.id) conds.push(eq(crmCustomers.id, req.query.id.slice(0, 64)));
    if (q) {
      const pat = likeContains(q);
      conds.push(or(ilike(crmCustomers.displayName, pat), ilike(crmCustomers.email, pat), ilike(crmCustomers.phone, pat),
        ilike(crmCustomers.addressLine1, pat), ilike(crmCustomers.city, pat), ilike(crmCustomers.companyName, pat))!);
    }
    const rows = await db.select().from(crmCustomers).where(and(...conds)).orderBy(desc(crmCustomers.updatedAt)).limit(300);
    const visible = (await objectPolicy(ctx).filter("customers", rows)).slice(0, 25);
    const ids = visible.map((c) => c.id);
    const counts = ids.length ? await db.select({ refId: crmAttachments.refId, n: sql<number>`count(*)::int` }).from(crmAttachments)
      .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "photo"), inArray(crmAttachments.refId, ids)))
      .groupBy(crmAttachments.refId) : [];
    const countOf = new Map(counts.map((c) => [c.refId, c.n]));
    res.json({
      clients: visible.map((c) => ({
        id: c.id, name: c.displayName, email: c.email, phone: c.phone, address: addressOf(c), photoCount: countOf.get(c.id) ?? 0,
      })),
    });
  });

  /** "Download" on the Photos page: up to 100 selected photos as one zip, foldered by client. */
  app.get("/api/crm/photos/download.zip", async (req: any, res) => {
    const ids = String(req.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > 100) return res.status(400).json({ message: "Pick 1 to 100 photos to download." });
    const ctx = await photoCtx(req, res, getDevUser);
    if (!ctx) return;
    const rows = await visiblePhotos(ctx, ids);
    if (rows.length !== new Set(ids).size) return res.status(404).json({ message: "Photo not found" });
    if (rows.reduce((s, a) => s + a.sizeBytes, 0) > 750 * 1024 * 1024) {
      return res.status(413).json({ message: "That selection is over 750 MB. Download fewer photos at a time." });
    }
    const names = new Map<string, string>();
    const customers = await db.select({ id: crmCustomers.id, name: crmCustomers.displayName }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), inArray(crmCustomers.id, [...new Set(rows.map((r) => r.refId!).filter(Boolean))])));
    for (const c of customers) names.set(c.id, c.name);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="project-photos.zip"`);
    const zip = archiver("zip", { store: true });
    zip.on("error", (err) => { logError("Photo zip failed:", err); try { res.destroy(err); } catch { /* gone */ } });
    zip.pipe(res);
    const used = new Set<string>();
    for (const a of rows) {
      const abs = storedFilePath(a);
      if (!abs) continue;
      const base = `${safeZipName(names.get(a.refId ?? "") ?? "Client")}/${safeZipName(classifyPhoto(a.fileName).displayName)}`;
      let name = base, i = 1;
      while (used.has(name)) name = base.replace(/(\.[^./]+)?$/, (ext) => ` (${++i})${ext}`);
      used.add(name);
      zip.file(abs, { name });
    }
    await zip.finalize().catch(() => {});
  });

  /** A photo's thumbnail (size=sm, default) or screen-size view (size=lg). Same visibility as the file itself. */
  app.get("/api/crm/photos/:id/thumb", async (req: any, res) => {
    const ctx = await photoCtx(req, res, getDevUser);
    if (!ctx) return;
    const [att] = await visiblePhotos(ctx, [String(req.params.id)]);
    if (!att) return res.status(404).json({ message: "Photo not found" });
    const file = await rendition(att, req.query.size === "lg" ? "lg" : "sm");
    if (!file) return res.status(415).json({ message: "No preview for this photo format." });
    sendRendition(res, file);
  });
}

// ── Platform bridges ────────────────────────────────────────────────────────

const idsBody = (max: number) => z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(max) });

/** Load the requested photos for a platform tool: export rights, and every id visible — else nothing (404). */
async function photosForTool(req: any, res: any, getUser: GetUser, ids: string[]): Promise<{ ctx: OrgContext; rows: Attachment[] } | null> {
  const ctx = await photoCtx(req, res, getUser);
  if (!ctx) return null;
  if (!canExport(res, ctx)) return null;
  const rows = await visiblePhotos(ctx, ids);
  if (rows.length !== new Set(ids).size) { res.status(404).json({ message: "Photo not found" }); return null; }
  return { ctx, rows };
}

async function customerNames(orgId: string, rows: Attachment[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.refId!).filter(Boolean))];
  if (!ids.length) return new Map();
  const cs = await db.select({ id: crmCustomers.id, name: crmCustomers.displayName }).from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, ids)));
  return new Map(cs.map((c) => [c.id, c.name]));
}

/** The Photo Optimizer's staging (routes.ts owns its in-memory upload map). Returns the optimizer's file id. */
export type StageForOptimizer = (file: { path: string; originalName: string; mimetype: string }) => string | null;

const MEDIA_STORAGE_UNAVAILABLE = "Photo storage is unavailable right now. Please try again later.";

export function registerCrmPhotoPlatformRoutes(app: Express, getDevUser: GetUser, stageForOptimizer: StageForOptimizer): void {
  const uploadDir = path.join(process.cwd(), "tmp", "photo-uploads");

  /**
   * "Optimize for Google profile": hand up to 10 CRM photos to the Photo
   * Optimizer as if they had been uploaded there (JPEG; other formats are
   * converted, HEIC is reported as skipped). The optimizer then geo-tags,
   * renames and watermarks them for upload to a Google Business Profile by hand.
   */
  app.post("/api/photos/from-crm", requirePlatformAccess, async (req: any, res) => {
    const parsed = idsBody(10).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick 1 to 10 photos — the Photo Optimizer works on 10 at a time." });
    const got = await photosForTool(req, res, getDevUser, parsed.data.ids);
    if (!got) return;
    const names = await customerNames(got.ctx.org.id, got.rows);
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const files: { id: string; originalName: string; size: number; attachmentId: string; thumbUrl: string }[] = [];
    const skipped: { attachmentId: string; reason: string }[] = [];
    for (const a of got.rows) {
      const src = storedFilePath(a);
      if (!src) { skipped.push({ attachmentId: a.id, reason: "The file is missing." }); continue; }
      const base = classifyPhoto(a.fileName).displayName.replace(/\.[^.]+$/, "");
      const originalName = safeZipName(`${names.get(a.refId ?? "") ? `${names.get(a.refId ?? "")} ` : ""}${base}`.trim()) + ".jpg";
      const dest = path.join(uploadDir, `crm-${randomUUID()}`);
      try {
        if (a.mime === "image/jpeg") await fs.promises.copyFile(src, dest);
        else await sharp(src, { failOn: "none" }).rotate().jpeg({ quality: 92 }).toFile(dest);
      } catch {
        skipped.push({ attachmentId: a.id, reason: /hei[cf]/i.test(a.mime) ? "iPhone HEIC photos can't be optimized here — save it as JPEG first." : "This photo could not be read." });
        continue;
      }
      const size = (await fs.promises.stat(dest)).size;
      const id = stageForOptimizer({ path: dest, originalName, mimetype: "image/jpeg" });
      if (!id) {
        await fs.promises.rm(dest, { force: true });
        return res.status(429).json({ message: "Upload storage is busy. Try again later.", files, skipped });
      }
      files.push({ id, originalName, size, attachmentId: a.id, thumbUrl: THUMB(a.id) });
    }
    res.json({ files, skipped });
  });

  /** "Save to Media library": copy CRM photos into one of the account's Media library folders. */
  app.post("/api/media/from-crm", requirePlatformAccess, async (req: any, res) => {
    const parsed = idsBody(60).extend({ folderId: z.coerce.number().int().positive() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick a folder and 1 to 60 photos." });
    const user = getDevUser(req, res);
    if (!user) return;
    const [folder] = await db.select().from(mediaFolders)
      .where(and(eq(mediaFolders.id, parsed.data.folderId), eq(mediaFolders.userId, user.id))).limit(1);
    if (!folder) return res.status(404).json({ message: "Folder not found" });
    const got = await photosForTool(req, res, getDevUser, parsed.data.ids);
    if (!got) return;
    if (!r2Configured()) return res.status(503).json({ message: MEDIA_STORAGE_UNAVAILABLE });
    const names = await customerNames(got.ctx.org.id, got.rows);
    const saved: (typeof mediaPhotos.$inferSelect)[] = [];
    const skipped: { attachmentId: string; reason: string }[] = [];
    try {
      for (const a of got.rows) {
        const src = storedFilePath(a);
        if (!src) { skipped.push({ attachmentId: a.id, reason: "The file is missing." }); continue; }
        const buffer = await fs.promises.readFile(src);
        const ext = ({ "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as Record<string, string>)[a.mime] ?? "jpg";
        const key = await uploadToR2(buffer, a.mime, "media", ext);
        const who = names.get(a.refId ?? "");
        const [photo] = await db.insert(mediaPhotos).values({
          userId: user.id, folderId: folder.id,
          name: `${who ? `${who} — ` : ""}${classifyPhoto(a.fileName).displayName}`.slice(0, 200),
          url: getR2Url(key), r2Key: key, size: buffer.length,
        }).returning();
        saved.push(photo);
      }
    } catch (err) {
      logError("Media library copy from CRM failed:", err);
      return res.status(500).json({ message: MEDIA_STORAGE_UNAVAILABLE, saved, skipped });
    }
    console.log(`[crm] member ${got.ctx.member.id} copied ${saved.length} CRM photo(s) to media folder ${folder.id} (org ${got.ctx.org.id})`);
    res.json({ saved, count: saved.length, skipped });
  });
}

// ── Review requests ─────────────────────────────────────────────────────────

/**
 * The composer's CRM link for POST /api/reviews/create: a picked client
 * (crmCustomerId) and/or ticked CRM photos (crmPhotoIds). Absent both → {}
 * (a hand-typed request, exactly as before). Otherwise the caller must be on
 * the CRM team and able to see the client / every photo; responds and returns
 * null when not. Photo entries become token URLs once the token exists.
 */
/** The most job photos a review request carries, picked by the contractor or the homeowner (owner rule: 5–10). */
export const HOMEOWNER_PICK_MAX = 10;
export const HOMEOWNER_PICK_MIN = 5;

export async function resolveReviewCrmLink(req: any, res: any, getUser: GetUser, body: any): Promise<{
  crmOrgId?: string; crmCustomerId?: string | null; photos?: { attachmentId: string; originalName: string }[];
} | null> {
  const customerId = typeof body?.crmCustomerId === "string" && body.crmCustomerId ? body.crmCustomerId.slice(0, 64) : null;
  const rawIds = Array.isArray(body?.crmPhotoIds) ? body.crmPhotoIds.filter((x: unknown) => typeof x === "string" && x).map((x: string) => x.slice(0, 64)) : [];
  if (!customerId && !rawIds.length) return {};
  // Job photos go 5–10 per request (owner rule); the composer holds the minimum, the server the maximum.
  if (rawIds.length > HOMEOWNER_PICK_MAX) { res.status(400).json({ message: `Pick up to ${HOMEOWNER_PICK_MAX} job photos per review request.` }); return null; }
  const ctx = await photoCtx(req, res, getUser);
  if (!ctx) return null;
  if (customerId && !await objectPolicy(ctx).visible("customers", customerId)) {
    res.status(404).json({ message: "Client not found" }); return null;
  }
  let photos: { attachmentId: string; originalName: string }[] = [];
  if (rawIds.length) {
    if (!canExport(res, ctx)) return null;
    const rows = await visiblePhotos(ctx, rawIds);
    if (rows.length !== new Set(rawIds).size) { res.status(404).json({ message: "Photo not found" }); return null; }
    photos = rows.map((a) => ({ attachmentId: a.id, originalName: safeZipName(classifyPhoto(a.fileName).displayName) }));
  }
  return { crmOrgId: ctx.org.id, crmCustomerId: customerId, photos };
}

export const reviewPhotoUrl = (token: string, attachmentId: string) => `/api/review/${encodeURIComponent(token)}/photos/${attachmentId}`;

type ReviewRow = typeof reviewRequests.$inferSelect;
async function reviewByToken(token: string): Promise<ReviewRow | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [r] = await db.select().from(reviewRequests)
    .where(and(eq(reviewRequests.token, token), isNull(reviewRequests.deletedAt))).limit(1);
  return r ?? null;
}
const idList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The homeowner may choose photos: the request is linked to a client and the contractor attached none of their own. */
export function homeownerMayChoose(r: Pick<ReviewRow, "crmOrgId" | "crmCustomerId" | "crmPhotoIds" | "clientPhotoIds" | "photos">): boolean {
  if (!r.crmOrgId || !r.crmCustomerId || idList(r.crmPhotoIds).length) return false;
  const photos = Array.isArray(r.photos) ? r.photos : [];
  return photos.length === 0 || r.clientPhotoIds != null;
}

async function customerPhotos(r: ReviewRow): Promise<Attachment[]> {
  const [cust] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, r.crmOrgId!), eq(crmCustomers.id, r.crmCustomerId!))).limit(1);
  if (!cust) return [];
  return db.select().from(crmAttachments)
    .where(and(eq(crmAttachments.orgId, r.crmOrgId!), eq(crmAttachments.kind, "photo"), eq(crmAttachments.refId, cust.id)))
    .orderBy(sql`(${IS_FINISHED}) desc`, sql`(${IS_PROGRESS}) desc`, sql`(${IS_HOVER}) asc`, desc(crmAttachments.createdAt))
    .limit(60);
}

const isOwner = (req: any, r: ReviewRow) => !!req.user && req.user.id === r.userId;

/**
 * The homeowner's side, all keyed by the review request's unguessable token:
 *   GET  /api/review/:token/project-photos        the linked client's photos to choose from (only when the contractor
 *                                                 attached none; a hand-typed request has none to offer)
 *   POST /api/review/:token/project-photos        save the homeowner's choice (up to 30) as the request's photos
 *   GET  /api/review/:token/photos/:id[?size=sm]  a screen-size (or thumbnail) JPEG of an allowed photo
 *   GET  /api/review/:token/photos/:id/download   the original file, as a download
 * An id is allowed only when it is on the request's own allow-list (the contractor's picks) or, while the homeowner
 * may choose, is a photo of the linked client in the linked org. Everything else is 404. Rate-limited per IP.
 */
export function registerReviewProjectPhotoRoutes(app: Express): void {
  const fileLimit = rateLimit("review-photo-file", 600, 600, 600_000);
  const chooseLimit = rateLimit("review-photo-choose", 30, 30, 600_000);
  const listLimit = rateLimit("review-photo-list", 60, 60, 600_000);

  app.get("/api/review/:token/project-photos", listLimit, async (req: any, res) => {
    const r = await reviewByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "Not found" });
    if (!homeownerMayChoose(r)) return res.json({ available: false, photos: [], selected: [] });
    const rows = await customerPhotos(r);
    res.json({
      available: rows.length > 0,
      photos: rows.map((a) => ({
        id: a.id, stage: classifyPhoto(a.fileName).stage,
        thumbUrl: `${reviewPhotoUrl(r.token, a.id)}?size=sm`, url: reviewPhotoUrl(r.token, a.id),
      })),
      selected: idList(r.clientPhotoIds),
    });
  });

  app.post("/api/review/:token/project-photos", chooseLimit, async (req: any, res) => {
    // The homeowner picks up to 10 (the owner's 5–10 rule; fewer is fine when the job has fewer).
    const parsed = z.object({ ids: z.array(z.string().min(1).max(64)).max(HOMEOWNER_PICK_MAX) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: `Choose up to ${HOMEOWNER_PICK_MAX} photos.` });
    const r = await reviewByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "Not found" });
    if (!homeownerMayChoose(r)) return res.status(409).json({ message: "This request already has its photos." });
    const allowed = new Map((await customerPhotos(r)).map((a) => [a.id, a]));
    const ids = [...new Set(parsed.data.ids)];
    if (ids.some((id) => !allowed.has(id))) return res.status(404).json({ message: "Photo not found" });
    if (ids.length && allowed.size >= HOMEOWNER_PICK_MIN && ids.length < HOMEOWNER_PICK_MIN) return res.status(400).json({ message: `Choose at least ${HOMEOWNER_PICK_MIN} photos.` });
    const photos = ids.map((id, i) => {
      const name = safeZipName(classifyPhoto(allowed.get(id)!.fileName).displayName).replace(/\.[^.]+$/, "");
      return { url: reviewPhotoUrl(r.token, id), originalName: `${name || `photo-${i + 1}`}.jpg` };
    });
    // The contractor previewing their own link sees the result but never writes the homeowner's choice.
    if (isOwner(req, r)) return res.json({ ok: true, preview: true, photos });
    await db.update(reviewRequests).set({ photos, clientPhotoIds: ids })
      .where(and(eq(reviewRequests.id, r.id), eq(reviewRequests.token, r.token)));
    res.json({ ok: true, photos });
  });

  const allowedPhoto = async (token: string, id: string): Promise<Attachment | null> => {
    const r = await reviewByToken(token);
    if (!r || !r.crmOrgId) return null;
    const [att] = await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.id, id), eq(crmAttachments.orgId, r.crmOrgId), eq(crmAttachments.kind, "photo"))).limit(1);
    if (!att) return null;
    if (idList(r.crmPhotoIds).includes(att.id)) return att;
    return homeownerMayChoose(r) && att.refId === r.crmCustomerId ? att : null;
  };

  app.get("/api/review/:token/photos/:id", fileLimit, async (req: any, res) => {
    const att = await allowedPhoto(String(req.params.token), String(req.params.id));
    if (!att) return res.status(404).json({ message: "Not found" });
    const file = await rendition(att, req.query.size === "sm" ? "sm" : "lg");
    if (file) return sendRendition(res, file, 3600);
    // No decodable rendition (HEIC): the original still downloads.
    sendOriginal(res, att, classifyPhoto(att.fileName).displayName, true);
  });

  app.get("/api/review/:token/photos/:id/download", fileLimit, async (req: any, res) => {
    const att = await allowedPhoto(String(req.params.token), String(req.params.id));
    if (!att) return res.status(404).json({ message: "Not found" });
    const name = typeof req.query.name === "string" && req.query.name ? req.query.name : classifyPhoto(att.fileName).displayName;
    sendOriginal(res, att, name, false);
  });
}

// Exported for tests.
export const __test = { buildScope, narrow };
