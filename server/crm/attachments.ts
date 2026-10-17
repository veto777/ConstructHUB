import { objectPolicy } from "./object-access";
/**
 * Client portal v2 — file exchange and homeowner comments.
 *
 * Three attachment kinds share crm_attachments (storagePath is a server-local
 * key, never a public URL — EVERY read goes through a gated route below):
 *   - pamphlet: org-level PDFs/images (brochures, warranties). Contractors
 *     manage them; clients of that org see them in the portal "From <company>"
 *     section.
 *   - estimate: files pinned to one estimate (refId = estimate id). They
 *     appear on the email-gated public estimate page and in the portal
 *     documents payload.
 *   - photo: job photos the HOMEOWNER uploads from the portal (refId =
 *     customer id, max 20 per customer). Contractors see them on the client
 *     detail page.
 *   - estimate_default: the org's "Add to all future estimates" set (refId
 *     null). Usually made by ticking a file on an estimate, so the row SHARES
 *     that file's storagePath; every new estimate gets a kind 'estimate' copy
 *     of each (estimate-default-files.ts). Contractor-only — clients see the
 *     copies on their estimates, never the library itself.
 * Because storagePaths can be shared, a delete unlinks the file on disk only
 * when no row still references it.
 * A fourth kind is SYSTEM-GENERATED, never uploaded:
 *   - contract: the signed-contract PDF minted when an estimate is approved
 *     (refId = estimate id, server/crm/contract-pdf.ts). Clients download it
 *     from the portal contracts section; contractors via the CRM file route.
 *   - measurement: a provider measurement PDF pulled from HOVER on ingest
 *     (refId = customer id, server/crm/hover.ts). Clients download it through
 *     the same gated route; contractors via the CRM file route.
 *
 * Client comments (crm_client_comments) are notes a homeowner sends from the
 * portal; the division's admin members (org owner as fallback) get an email,
 * gated by the org's 'clientComments' notification pref (default ON).
 *
 * Every client-side route is scoped to the session's customerIds — an id from
 * the request is only ever an allowance check, never a lookup key.
 */
import type { Express } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmAttachments,
  crmClientComments,
  crmCustomers,
  crmEstimates,
  crmMembers,
  crmOrgs,
  crmProjects,
  crmNotificationEnabled,
  crmNotificationChannel,
} from "@shared/schema";
import { notifyMembers } from "./notify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { allow as rateAllow, requireClient } from "./client-auth";
import { requireDocSession } from "./portal";
import { sendWithFallback } from "../email";
import { ESTIMATE_DEFAULT_KIND, fileKeyOf, lockStoragePath } from "./estimate-default-files";
import { portalBaseUrl } from "../site-context";
import { logActivity, recordActivity } from "./activity";
import { loadActorDirectory } from "./actors";
import { uploadLabelActor, type CrmActor } from "@shared/crm-actor";

type GetUser = (req: any, res: any) => any;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_PHOTOS_PER_CUSTOMER = 20;

// Local served-through-routes storage. tmp/ is gitignored and the directory
// is never statically mounted — files stream through the gated routes only.
const STORAGE_DIR = path.join(process.cwd(), "tmp", "crm-attachments");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

/** Multer errors (size cap, etc.) become clean 4xx instead of a 500. */
const singleFile = (field: string) => (req: any, res: any, next: any) =>
  upload.single(field)(req, res, (err: any) => {
    if (!err) return next();
    const tooBig = err?.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({
      message: tooBig ? "File too large — 10 MB max." : "Upload failed.",
    });
  });

const DOC_MIMES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const PHOTO_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

const safeName = (name: string) =>
  path.basename(String(name || "file")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";

/** Persist a validated upload; returns the row values for crm_attachments. */
async function storeFile(
  file: Express.Multer.File,
  allowed: Record<string, string>,
  orgId: string,
  kind: string,
  refId: string | null,
) {
  const ext = allowed[file.mimetype];
  if (!ext) return null;
  const storagePath = `${orgId}/${randomUUID()}.${ext}`;
  const abs = path.join(STORAGE_DIR, storagePath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, file.buffer);
  return {
    orgId,
    kind,
    refId,
    fileName: safeName(file.originalname),
    mime: file.mimetype,
    sizeBytes: file.size,
    storagePath,
  };
}

/** Who added a file — a member id, or a label for a non-member source. */
export type AttachmentUploader = {
  /** The team member who added it (null for client / system sources). */
  uploadedByMemberId?: string | null;
  /** "HOVER import", "System", the client's name… Defaults to "System" when no member is given. */
  uploadedByLabel?: string | null;
  /** member | client | system. Defaults to member with a member id, else system. */
  uploadedByKind?: "member" | "client" | "system" | null;
};

/** The uploader columns for a generated file: a member, else the label, else "System". */
export function generatedUploader(args: AttachmentUploader): {
  uploadedByMemberId: string | null; uploadedByLabel: string | null; uploadedByKind: string;
} {
  const memberId = args.uploadedByMemberId ?? null;
  const label = String(args.uploadedByLabel ?? "").trim().slice(0, 200) || null;
  return {
    uploadedByMemberId: memberId,
    uploadedByLabel: label ?? (memberId ? null : "System"),
    uploadedByKind: args.uploadedByKind ?? (memberId ? "member" : "system"),
  };
}

/**
 * Persist a SERVER-GENERATED PDF (the signed contract) through the same
 * storage as uploads — same directory, same containment rule, same gated
 * reads. kind is 'contract', refId the estimate id; the row is the record.
 * The uploader defaults to "System"; a caller that knows better says so
 * (HOVER imports pass uploadedByLabel "HOVER import").
 */
export async function storeGeneratedFile(args: {
  orgId: string;
  kind: string;
  refId: string | null;
  fileName: string;
  buffer: Buffer;
  mime: string;
  ext: string;
} & AttachmentUploader): Promise<typeof crmAttachments.$inferSelect> {
  const storagePath = `${args.orgId}/${randomUUID()}.${args.ext}`;
  const abs = path.join(STORAGE_DIR, storagePath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, args.buffer);
  const [row] = await db.insert(crmAttachments).values({
    orgId: args.orgId,
    kind: args.kind,
    refId: args.refId,
    fileName: safeName(args.fileName),
    mime: args.mime,
    sizeBytes: args.buffer.length,
    storagePath,
    ...generatedUploader(args),
  }).returning();
  return row;
}

export async function storeGeneratedPdf(args: {
  orgId: string;
  kind: string;
  refId: string | null;
  fileName: string;
  buffer: Buffer;
} & AttachmentUploader): Promise<typeof crmAttachments.$inferSelect> {
  return storeGeneratedFile({ ...args, mime: "application/pdf", ext: "pdf" });
}

/** The on-disk path of a stored attachment, or null when the row's key would
 *  escape the storage directory or the file is gone. Readers outside this file
 *  (the photo library, server/crm/photo-library.ts) resolve through this only. */
export function storedFilePath(att: { storagePath: string }): string | null {
  const abs = path.resolve(STORAGE_DIR, att.storagePath);
  if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep) || !fs.existsSync(abs)) return null;
  return abs;
}

/** Remove a stored file — callers first prove no row references it. */
async function unlinkStored(storagePath: string) {
  const abs = path.resolve(STORAGE_DIR, storagePath);
  if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep)) return;
  await fs.promises.unlink(abs).catch(() => {});
}

/**
 * `inline` shows an image in place; `pdfInline` (the contractor's own file route only — the in-app HOVER report
 * viewer uses ?inline=1) lets a PDF render inline too. Everything else downloads.
 */
function streamAttachment(res: any, att: typeof crmAttachments.$inferSelect, inline: boolean, pdfInline = false) {
  // storagePath is written by storeFile only (orgId/uuid.ext) — resolve and
  // confirm containment anyway so a hand-edited row can never escape the dir.
  const abs = path.resolve(STORAGE_DIR, att.storagePath);
  if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep) || !fs.existsSync(abs)) {
    return res.status(404).json({ message: "File not found" });
  }
  res.setHeader("Content-Type", att.mime);
  res.setHeader("Content-Length", String(att.sizeBytes));
  res.setHeader(
    "Content-Disposition",
    `${inline && (att.mime.startsWith("image/") || (pdfInline && att.mime === "application/pdf")) ? "inline" : "attachment"}; filename="${safeName(att.fileName)}"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(abs).pipe(res);
}

const present = (a: typeof crmAttachments.$inferSelect, url: string, uploadedBy: CrmActor | null = null) => ({
  id: a.id,
  kind: a.kind,
  refId: a.refId,
  fileName: a.fileName,
  mime: a.mime,
  sizeBytes: a.sizeBytes,
  createdAt: a.createdAt,
  // Same file on disk ⇔ same fileKey: how the estimate card tells which of
  // its files are also in the auto-attach set (storagePath never leaves).
  fileKey: fileKeyOf(a.storagePath),
  url: `${url}/${a.id}/file`,
  downloadUrl: `${url}/${a.id}/file`,
  // Who added it, by name (null on rows from before uploads were attributed).
  uploadedBy,
});

/** A stored row's uploader as an actor: the member, else the label, else null (not recorded). */
export function storedUploader(
  a: { uploadedByMemberId?: string | null; uploadedByLabel?: string | null; uploadedByKind?: string | null },
  member: (id: string) => CrmActor | null,
): CrmActor | null {
  if (a.uploadedByMemberId) {
    const m = member(a.uploadedByMemberId);
    if (m) return m;
  }
  if (a.uploadedByLabel) return uploadLabelActor(a.uploadedByLabel, a.uploadedByKind);
  return null;
}

/** What an attachment row is, for the activity-log meta (file names only — never storage keys). */
function attachmentMeta(a: typeof crmAttachments.$inferSelect, extra: Record<string, unknown> = {}) {
  // The stage tag is a photo-only convention — a PDF named "progress--x.pdf" keeps its name.
  const stage = a.kind !== "photo" ? null
    : a.fileName.startsWith("progress--") ? "progress" : a.fileName.startsWith("finished--") ? "finished" : null;
  return {
    kind: a.kind,
    // The parent (customer / estimate id) — lets the audit feed gate a row
    // for a restricted seat even after the attachment itself is deleted.
    refId: a.refId,
    fileName: stage ? a.fileName.slice(stage.length + 2) : a.fileName,
    stage,
    ...extra,
  };
}

/** The client and document number an attachment hangs off, for the log row. */
async function attachmentContext(a: typeof crmAttachments.$inferSelect): Promise<{ customerId: string | null; number: string | null }> {
  if ((a.kind === "photo" || a.kind === "measurement") && a.refId) return { customerId: a.refId, number: null };
  if ((a.kind === "estimate" || a.kind === "contract") && a.refId) {
    const [est] = await db.select({ customerId: crmEstimates.customerId, number: crmEstimates.number })
      .from(crmEstimates).where(and(eq(crmEstimates.id, a.refId), eq(crmEstimates.orgId, a.orgId))).limit(1);
    return { customerId: est?.customerId ?? null, number: est?.number ?? null };
  }
  return { customerId: null, number: null };
}

/**
 * Who owns this client's communication? The person assigned to the job:
 * the latest project's PM, else its sales rep, else whoever wrote the
 * latest estimate. Communication is the business — this person must never
 * miss a client message.
 */
export async function assignedMemberFor(
  orgId: string, customerId: string,
): Promise<{ memberId: string | null; divisionId: string | null }> {
  const [proj] = await db
    .select({
      divisionId: crmProjects.divisionId,
      pm: crmProjects.projectManagerMemberId,
      sales: crmProjects.salesMemberId,
    })
    .from(crmProjects)
    .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.customerId, customerId)))
    .orderBy(desc(crmProjects.createdAt))
    .limit(1);
  let memberId = proj?.pm ?? proj?.sales ?? null;
  if (!memberId) {
    const [est] = await db
      .select({ createdByMemberId: crmEstimates.createdByMemberId })
      .from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, customerId)))
      .orderBy(desc(crmEstimates.createdAt))
      .limit(1);
    memberId = est?.createdByMemberId ?? null;
  }
  return { memberId, divisionId: proj?.divisionId ?? null };
}

/** Notify about a new client message: the assigned member FIRST (bell +
 *  email + text per prefs), then the division admins, owner fallback.
 *  Silenced by the org's 'clientComments' notification pref. */
export async function notifyClientComment(
  org: { id: string; name: string; email: string | null; customFields: unknown },
  customer: typeof crmCustomers.$inferSelect,
  body: string,
  baseUrl: string,
  estimateRef?: string | null,
  toMemberId?: string | null,
) {
  if (!["inApp","email","sms"].some((c) => crmNotificationChannel(org.customFields, "clientComments", c as any))) return;

  const members = await db
    .select()
    .from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));

  // The client addressed someone by name — that person IS the assignee.
  const resolved = await assignedMemberFor(org.id, customer.id);
  const assignedId = toMemberId ?? resolved.memberId;
  const divisionId = resolved.divisionId;
  const context = estimateRef ? ` about estimate ${estimateRef}` : "";

  // The bell/sms fan-out matches the email fan-out below: admins pinned to
  // another division are not on the hook for this client.
  await notifyMembers({
    org: org as any, pref: "clientComments",
    title: `${customer.displayName} sent a message${context}`,
    body: body.slice(0, 200),
    link: `/crm/inbox?c=${customer.id}`,
    extraMemberIds: [
      ...(assignedId ? [assignedId] : []),
      ...members
        .filter((m) => m.role === "admin" && !(divisionId && m.divisionId && m.divisionId !== divisionId))
        .map((m) => m.id),
    ],
  });

  // Email: the assigned member is always on it; division admins ride along
  // (admins pinned to another division are not on the hook for this client).
  const recipients = new Set<string>();
  const assigned = members.find((m) => m.id === assignedId);
  if (assigned?.email) recipients.add(assigned.email);
  for (const m of members) {
    if (m.role !== "admin") continue;
    if (divisionId && m.divisionId && m.divisionId !== divisionId) continue;
    if (m.email) recipients.add(m.email);
  }
  if (!recipients.size) {
    // Fallback: the org owner (member row first, org record email last).
    for (const m of members) {
      if (m.role === "owner" && m.email) recipients.add(m.email);
    }
    if (!recipients.size && org.email) recipients.add(org.email);
  }
  if (!recipients.size) return;
  if (!crmNotificationChannel(org.customFields, "clientComments", "email")) return;

  const to = [...recipients].join(",");
  // Dev has no SMTP — the send is logged/stubbed there; the row is the record.
  console.log(`[crm] client comment notification → ${recipients.size} recipient(s) (org ${org.id})`);
  await sendWithFallback({
    to,
    subject: `💬 ${customer.displayName} sent you a message${context} — reply quickly`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
        <p style="font-size:16px"><strong>${esc(customer.displayName)}</strong> sent a note from the client portal${esc(context)}:</p>
        <blockquote style="border-left:3px solid #4f46e5;margin:16px 0;padding:8px 14px;color:#333;white-space:pre-wrap">${esc(body)}</blockquote>
        <p style="font-size:14px">
          <a href="${baseUrl}/crm/inbox?c=${customer.id}">Reply in Messages</a> ·
          <a href="${baseUrl}/crm/clients/${customer.id}">Open ${esc(customer.displayName)} in the CRM</a>
        </p>
        <p style="font-size:12px;color:#666">A client waiting on an answer is a client shopping elsewhere — a fast reply wins the job.</p>
      </div>`,
  } as any).catch((e: any) => console.error("[crm] client-comment notify failed:", String(e?.message || e).slice(0, 300)));
}

export function registerCrmAttachmentRoutes(app: Express, getDevUser: GetUser): void {
  // ── Contractor: list / upload / delete / read ─────────────────────────────

  app.get("/api/crm/attachments", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const kind = String(req.query.kind || "");
    const refId = String(req.query.refId || "");
    const conds = [eq(crmAttachments.orgId, ctx.org.id)];
    if (kind) conds.push(eq(crmAttachments.kind, kind));
    if (refId) conds.push(eq(crmAttachments.refId, refId));
    const rows = await db
      .select()
      .from(crmAttachments)
      .where(and(...conds))
      .orderBy(desc(crmAttachments.createdAt))
      .limit(500);
    const dir = await loadActorDirectory(ctx.org.id);
    res.json((await objectPolicy(ctx).filter("attachments", rows))
      .map((a) => present(a, "/api/crm/attachments", storedUploader(a, dir.member))));
  });

  app.post("/api/crm/attachments", singleFile("file"), async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const kind = String(req.body?.kind || "");
    if (kind !== "pamphlet" && kind !== "estimate" && kind !== "photo" && kind !== ESTIMATE_DEFAULT_KIND) {
      return res.status(400).json({ message: "kind must be pamphlet, estimate, estimate_default or photo" });
    }
    // Project photos are field work — a PM (manageJobs) uploads them without
    // needing customer-management rights. Everything else stays manageCustomers.
    if (kind === "photo") {
      if (!ctx.permissions.manageJobs && !ctx.permissions.manageCustomers) {
        return res.status(403).json({ message: "Requires permission: manageJobs" });
      }
    } else if (!requirePermission(res, ctx, "manageCustomers")) return;

    let refId: string | null = null;
    if (kind === "photo") {
      // Project photo onto a CLIENT's page: refId = customer id — the same
      // shelf as client-shared and HOVER photos, so every photo of the job
      // lives together (and the client sees progress in their portal too).
      refId = String(req.body?.refId || "");
      const [cust] = await db
        .select({ id: crmCustomers.id })
        .from(crmCustomers)
        .where(and(eq(crmCustomers.id, refId), eq(crmCustomers.orgId, ctx.org.id)))
        .limit(1);
      if (!cust) return res.status(404).json({ message: "Client not found" });
    }
    if (kind === "estimate") {
      refId = String(req.body?.refId || "");
      const [est] = await db
        .select({ id: crmEstimates.id })
        .from(crmEstimates)
        .where(and(eq(crmEstimates.id, refId), eq(crmEstimates.orgId, ctx.org.id)))
        .limit(1);
      if (!est) return res.status(404).json({ message: "Estimate not found" });
    }
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    const values = await storeFile(file, kind === "photo" ? PHOTO_MIMES : DOC_MIMES, ctx.org.id, kind, refId);
    if (!values) {
      return res.status(415).json({
        message: kind === "photo" ? "JPEG, PNG or HEIC photos only" : "PDF or image files only",
      });
    }
    // Stage tag ("progress" | "finished") rides in the stored name so the UI
    // (and the client portal) can badge it without a schema change.
    if (kind === "photo") {
      const stage = String(req.body?.stage || "");
      if (stage === "progress" || stage === "finished") {
        values.fileName = `${stage}--${values.fileName}`;
      }
    }

    const [row] = await db.insert(crmAttachments)
      .values({ ...values, uploadedByMemberId: ctx.member.id, uploadedByLabel: null, uploadedByKind: "member" }).returning();
    const where = await attachmentContext(row);
    logActivity(ctx, "attachment.added", {
      entityType: "attachment", entityId: row.id, customerId: where.customerId,
      meta: attachmentMeta(row, { number: where.number }),
    });
    const dir = await loadActorDirectory(ctx.org.id);
    res.status(201).json(present(row, "/api/crm/attachments", storedUploader(row, dir.member)));
  });

  app.delete("/api/crm/attachments/:id", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // PMs manage project photos; everything else needs manageCustomers.
    if (!ctx.permissions.manageCustomers) {
      const [att] = await db.select({ kind: crmAttachments.kind }).from(crmAttachments)
        .where(and(eq(crmAttachments.id, req.params.id), eq(crmAttachments.orgId, ctx.org.id)))
        .limit(1);
      if (!(att?.kind === "photo" && ctx.permissions.manageJobs)) {
        return res.status(403).json({ message: "Requires permission: manageCustomers" });
      }
    }

    const [att] = await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.id, req.params.id), eq(crmAttachments.orgId, ctx.org.id)))
      .limit(1);
    if (!att) return res.status(404).json({ message: "Attachment not found" });
    // storagePaths are shared (an auto-attach file is one file on disk under
    // many estimates) — unlink only once the LAST row naming it is gone.
    const orphaned = await db.transaction(async (tx) => {
      await lockStoragePath(tx, att.storagePath);
      const [row] = await tx.delete(crmAttachments)
        .where(and(eq(crmAttachments.id, att.id), eq(crmAttachments.orgId, ctx.org.id)))
        .returning();
      if (!row) return null;
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(crmAttachments)
        .where(eq(crmAttachments.storagePath, row.storagePath));
      return { unlink: n === 0 };
    });
    if (!orphaned) return res.status(404).json({ message: "Attachment not found" });
    if (orphaned.unlink) await unlinkStored(att.storagePath);
    const where = await attachmentContext(att);
    logActivity(ctx, "attachment.deleted", {
      entityType: "attachment", entityId: att.id, customerId: where.customerId,
      meta: attachmentMeta(att, { number: where.number }),
    });
    res.json({ ok: true });
  });

  /**
   * "Add to all future estimates" toggle for one file. on=true puts the file
   * in the org's auto-attach set — an estimate_default row sharing its
   * storagePath (no copy); on=false takes it out. Existing estimates are never
   * touched either way. Idempotent: on twice is one row, off twice is a no-op.
   * The id may be an estimate file, a company pamphlet, or a library row itself.
   */
  app.post("/api/crm/attachments/:id/estimate-default", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    const parsed = z.object({ on: z.boolean() }).strict().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Send { on: true | false }" });
    const on = parsed.data.on;

    const [src] = await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.id, req.params.id), eq(crmAttachments.orgId, ctx.org.id)))
      .limit(1);
    if (!src) return res.status(404).json({ message: "Attachment not found" });
    if (src.kind !== "estimate" && src.kind !== "pamphlet" && src.kind !== ESTIMATE_DEFAULT_KIND) {
      return res.status(400).json({ message: "Only estimate files and company pamphlets can be added to every estimate." });
    }

    const result = await db.transaction(async (tx) => {
      await lockStoragePath(tx, src.storagePath);
      // Re-read under the lock — a concurrent delete may have just removed it.
      const [still] = await tx.select({ id: crmAttachments.id }).from(crmAttachments)
        .where(and(eq(crmAttachments.id, src.id), eq(crmAttachments.orgId, ctx.org.id))).limit(1);
      if (!still) return null;
      const existing = await tx.select().from(crmAttachments)
        .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, ESTIMATE_DEFAULT_KIND),
          eq(crmAttachments.storagePath, src.storagePath)));
      if (on) {
        if (existing.length) return { on: true, defaultId: existing[0].id, changed: false, unlink: false };
        // The library row is the same file: it keeps whoever ORIGINALLY added
        // it; who put it in the set is the activity-log row below.
        const [row] = await tx.insert(crmAttachments).values({
          orgId: ctx.org.id, kind: ESTIMATE_DEFAULT_KIND, refId: null,
          fileName: src.fileName, mime: src.mime, sizeBytes: src.sizeBytes, storagePath: src.storagePath,
          uploadedByMemberId: src.uploadedByMemberId ?? null, uploadedByLabel: src.uploadedByLabel ?? null,
          uploadedByKind: src.uploadedByKind ?? null,
        }).returning();
        return { on: true, defaultId: row.id, changed: true, unlink: false };
      }
      if (!existing.length) return { on: false, defaultId: null, changed: false, unlink: false };
      await tx.delete(crmAttachments).where(inArray(crmAttachments.id, existing.map((r) => r.id)));
      // Toggling off a library-only upload removes its last reference.
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(crmAttachments)
        .where(eq(crmAttachments.storagePath, src.storagePath));
      return { on: false, defaultId: null, changed: true, unlink: n === 0 };
    });
    if (!result) return res.status(404).json({ message: "Attachment not found" });
    if (result.unlink) await unlinkStored(src.storagePath);
    if (result.changed) {
      console.log(`[crm] member ${ctx.member.id} ${on ? "added" : "removed"} "${src.fileName}" ${on ? "to" : "from"} future estimates (org ${ctx.org.id})`);
      const where = await attachmentContext(src);
      logActivity(ctx, on ? "attachment.default_on" : "attachment.default_off", {
        entityType: "attachment", entityId: result.defaultId ?? src.id, customerId: where.customerId,
        meta: attachmentMeta(src, { number: where.number }),
      });
    }
    res.json({ on: result.on, defaultId: result.defaultId });
  });

  /**
   * "Add from library": put one auto-attach file or company pamphlet on THIS
   * estimate — a kind 'estimate' row sharing the file's storagePath. Already
   * on the estimate → 200 with the existing row (idempotent), else 201.
   */
  app.post("/api/crm/estimates/:id/attachments/from-library", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    const parsed = z.object({ attachmentId: z.string().min(1).max(64) }).strict().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick a file from the library" });

    const [est] = await db.select({ id: crmEstimates.id }).from(crmEstimates)
      .where(and(eq(crmEstimates.id, req.params.id), eq(crmEstimates.orgId, ctx.org.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    const [src] = await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.id, parsed.data.attachmentId), eq(crmAttachments.orgId, ctx.org.id),
        inArray(crmAttachments.kind, [ESTIMATE_DEFAULT_KIND, "pamphlet"])))
      .limit(1);
    if (!src) return res.status(404).json({ message: "Library file not found" });

    const out = await db.transaction(async (tx) => {
      await lockStoragePath(tx, src.storagePath);
      const [still] = await tx.select({ id: crmAttachments.id }).from(crmAttachments)
        .where(eq(crmAttachments.id, src.id)).limit(1);
      if (!still) return null;
      const [dup] = await tx.select().from(crmAttachments)
        .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "estimate"),
          eq(crmAttachments.refId, est.id), eq(crmAttachments.storagePath, src.storagePath)))
        .limit(1);
      if (dup) return { row: dup, created: false };
      // A copy of a library file keeps its ORIGINAL uploader; who attached it
      // here is the activity-log row below ("attachment.attached").
      const [row] = await tx.insert(crmAttachments).values({
        orgId: ctx.org.id, kind: "estimate", refId: est.id,
        fileName: src.fileName, mime: src.mime, sizeBytes: src.sizeBytes, storagePath: src.storagePath,
        uploadedByMemberId: src.uploadedByMemberId ?? null, uploadedByLabel: src.uploadedByLabel ?? null,
        uploadedByKind: src.uploadedByKind ?? null,
      }).returning();
      return { row, created: true };
    });
    if (!out) return res.status(404).json({ message: "Library file not found" });
    if (out.created) {
      const where = await attachmentContext(out.row);
      logActivity(ctx, "attachment.attached", {
        entityType: "attachment", entityId: out.row.id, customerId: where.customerId,
        meta: attachmentMeta(out.row, { number: where.number, fromLibrary: true }),
      });
    }
    const dir = await loadActorDirectory(ctx.org.id);
    res.status(out.created ? 201 : 200).json(present(out.row, "/api/crm/attachments", storedUploader(out.row, dir.member)));
  });

  app.get("/api/crm/attachments/:id/file", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const [att] = await db
      .select()
      .from(crmAttachments)
      .where(and(eq(crmAttachments.id, req.params.id), eq(crmAttachments.orgId, ctx.org.id)))
      .limit(1);
    if (!att) return res.status(404).json({ message: "Attachment not found" });
    streamAttachment(res, att, req.query.inline === "1", true);
  });

  // ── Contractor: client comments (client detail page) ──────────────────────

  app.get("/api/crm/customers/:id/client-comments", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Only what the CLIENT sent from their portal (authorMemberId null). The
    // team's own replies live in the two-way inbox thread, not on this card.
    const rows = await db
      .select()
      .from(crmClientComments)
      .where(and(
        eq(crmClientComments.customerId, req.params.id),
        eq(crmClientComments.orgId, ctx.org.id),
        isNull(crmClientComments.authorMemberId),
      ))
      .orderBy(desc(crmClientComments.createdAt))
      .limit(200);
    // Same per-object policy as the inbox thread: a note tied to an estimate
    // this seat can't see stays hidden here too.
    res.json(
      (await objectPolicy(ctx).filter("client-comments", rows))
        .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, readAt: c.readAt })),
    );
  });

  app.post("/api/crm/client-comments/:id/read", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const [row] = await db
      .update(crmClientComments)
      .set({ readAt: new Date() })
      .where(and(eq(crmClientComments.id, req.params.id), eq(crmClientComments.orgId, ctx.org.id)))
      .returning();
    if (!row) return res.status(404).json({ message: "Comment not found" });
    res.json({ ok: true, readAt: row.readAt });
  });

  // ── Client portal: photo upload, gated download, comments ────────────────

  app.post("/api/client/photos", singleFile("file"), async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const customerId = String(req.body?.customerId || "");
    if (!client.customerIds.includes(customerId)) {
      return res.status(403).json({ message: "That is not your account" });
    }
    if (!rateAllow(`cphoto:${customerId}`, 30)) {
      return res.status(429).json({ message: "Too many uploads. Please try again later." });
    }
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    const [cust] = await db
      .select()
      .from(crmCustomers)
      .where(eq(crmCustomers.id, customerId))
      .limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(crmAttachments)
      .where(and(eq(crmAttachments.kind, "photo"), eq(crmAttachments.refId, customerId)));
    if (n >= MAX_PHOTOS_PER_CUSTOMER) {
      return res.status(409).json({ message: `Photo limit reached (${MAX_PHOTOS_PER_CUSTOMER} max)` });
    }

    const values = await storeFile(file, PHOTO_MIMES, cust.orgId, "photo", customerId);
    if (!values) return res.status(415).json({ message: "JPEG, PNG or HEIC photos only" });

    // The client did it: their name is the uploader (refId already links the customer).
    const clientName = String(cust.displayName ?? "").trim() || "Client";
    const [row] = await db.insert(crmAttachments)
      .values({ ...values, uploadedByMemberId: null, uploadedByLabel: clientName.slice(0, 200), uploadedByKind: "client" }).returning();
    recordActivity({
      orgId: cust.orgId, actorLabel: "client", action: "attachment.added",
      entityType: "attachment", entityId: row.id, customerId,
      meta: attachmentMeta(row, { byClient: true }),
    });
    res.status(201).json({
      id: row.id,
      fileName: row.fileName,
      createdAt: row.createdAt,
      downloadUrl: `/api/client/attachments/${row.id}/download`,
    });
  });

  app.get("/api/client/attachments/:id/download", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const [att] = await db
      .select()
      .from(crmAttachments)
      .where(eq(crmAttachments.id, req.params.id))
      .limit(1);
    if (!att) return res.status(404).json({ message: "File not found" });

    let allowed = false;
    if (att.kind === "photo" || att.kind === "measurement") {
      // Both key off the customer (refId = customer id): photos the homeowner
      // uploaded, measurement PDFs HOVER delivered for their property.
      allowed = !!att.refId && client.customerIds.includes(att.refId);
    } else if (att.kind === "estimate" || att.kind === "contract") {
      // estimate files and the signed-contract PDF both key off the estimate
      // (refId = estimate id) — allowed when the estimate belongs to one of
      // the session's customers.
      const [est] = await db
        .select({ customerId: crmEstimates.customerId })
        .from(crmEstimates)
        .where(eq(crmEstimates.id, att.refId ?? ""))
        .limit(1);
      allowed = !!est && client.customerIds.includes(est.customerId);
    } else if (att.kind === "pamphlet") {
      // Pamphlets are org-level: visible to any customer of that org.
      const rows = await db
        .select({ id: crmCustomers.id })
        .from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, att.orgId), inArray(crmCustomers.id, client.customerIds)))
        .limit(1);
      allowed = rows.length > 0;
    }
    if (!allowed) return res.status(404).json({ message: "File not found" });
    streamAttachment(res, att, req.query.inline === "1");
  });

  /** The client's signed-contract PDFs, keyed by estimate id so the portal's
   *  contracts section can attach a download link to each signed contract.
   *  Session-scoped exactly like the documents payload. */
  app.get("/api/client/contracts", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    if (!client.customerIds.length) return res.json({ contracts: [] });

    const estimates = await db
      .select({ id: crmEstimates.id })
      .from(crmEstimates)
      .where(inArray(crmEstimates.customerId, client.customerIds));
    const estimateIds = estimates.map((e) => e.id);
    if (!estimateIds.length) return res.json({ contracts: [] });

    const rows = await db
      .select()
      .from(crmAttachments)
      .where(and(eq(crmAttachments.kind, "contract"), inArray(crmAttachments.refId, estimateIds)))
      .orderBy(desc(crmAttachments.createdAt));
    res.json({
      contracts: rows.map((a) => ({
        id: a.id,
        estimateId: a.refId,
        fileName: a.fileName,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        downloadUrl: `/api/client/attachments/${a.id}/download`,
      })),
    });
  });

  app.post("/api/client/comments", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const parsed = z
      .object({
        customerId: z.string().max(64),
        body: z.string().min(1).max(4000),
        estimateId: z.string().max(64).optional(),
        toMemberId: z.string().max(64).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter a message first" });
    const { customerId, body, estimateId, toMemberId } = parsed.data;
    if (!client.customerIds.includes(customerId)) {
      return res.status(403).json({ message: "That is not your account" });
    }
    if (!rateAllow(`ccomment:${customerId}`, 30)) {
      return res.status(429).json({ message: "Too many messages. Please try again later." });
    }

    const [cust] = await db
      .select()
      .from(crmCustomers)
      .where(eq(crmCustomers.id, customerId))
      .limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    // estimateId is advisory context — verify it belongs to this customer
    // before storing it, silently drop it otherwise.
    let estRef: string | null = null;
    let estId: string | null = null;
    if (estimateId) {
      const [est] = await db.select({ id: crmEstimates.id, number: crmEstimates.number })
        .from(crmEstimates)
        .where(and(eq(crmEstimates.id, estimateId), eq(crmEstimates.customerId, customerId)))
        .limit(1);
      if (est) { estId = est.id; estRef = est.number; }
    }

    // "Message Mike" — only a real active member of this client's org.
    let toId: string | null = null;
    if (toMemberId) {
      const [m] = await db.select({ id: crmMembers.id }).from(crmMembers)
        .where(and(eq(crmMembers.id, toMemberId), eq(crmMembers.orgId, cust.orgId), eq(crmMembers.status, "active")))
        .limit(1);
      toId = m?.id ?? null;
    }

    const [row] = await db
      .insert(crmClientComments)
      .values({ orgId: cust.orgId, customerId, body: body.trim(), estimateId: estId, toMemberId: toId })
      .returning();

    // Fire-and-forget: the portal never blocks on (or leaks) mail delivery.
    void (async () => {
      const [o] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, cust.orgId)).limit(1);
      if (o) await notifyClientComment(o, cust, body.trim(), portalBaseUrl(req), estRef, toId);
    })().catch((e: any) => console.error("[crm] client-comment notify failed:", String(e?.message || e).slice(0, 300)));

    res.status(201).json({ id: row.id, createdAt: row.createdAt });
  });

  // ── Public estimate page: attachments ride the same email gate ────────────

  // "Ask a question" on the estimate page itself — lands in the same inbox
  // thread, tagged with the estimate, and pings the assigned member.
  app.post("/api/public/estimates/:token/comment", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });
    const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter a message first" });
    const [est] = await db
      .select()
      .from(crmEstimates)
      .where(eq(crmEstimates.publicToken, t))
      .limit(1);
    if (!est) return res.status(404).json({ message: "Not found" });
    if (!(await requireDocSession(req, res, est.customerId))) return;
    if (!rateAllow(`ccomment:${est.customerId}`, 30)) {
      return res.status(429).json({ message: "Too many messages. Please try again later." });
    }
    const [cust] = await db.select().from(crmCustomers)
      .where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!cust) return res.status(404).json({ message: "Not found" });

    const [row] = await db.insert(crmClientComments).values({
      orgId: est.orgId, customerId: est.customerId,
      body: parsed.data.body.trim(), estimateId: est.id,
    }).returning();

    void (async () => {
      const [o] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
      if (o) await notifyClientComment(o, cust, parsed.data.body.trim(), portalBaseUrl(req), est.number);
    })().catch((e: any) => console.error("[crm] estimate-comment notify failed:", String(e?.message || e).slice(0, 300)));

    res.status(201).json({ id: row.id, createdAt: row.createdAt });
  });

  app.get("/api/public/estimates/:token/attachments", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });
    const [est] = await db
      .select()
      .from(crmEstimates)
      .where(eq(crmEstimates.publicToken, t))
      .limit(1);
    if (!est) return res.status(404).json({ message: "Not found" });
    if (!(await requireDocSession(req, res, est.customerId))) return;

    const rows = await db
      .select()
      .from(crmAttachments)
      .where(and(eq(crmAttachments.kind, "estimate"), eq(crmAttachments.refId, est.id)))
      .orderBy(desc(crmAttachments.createdAt));
    res.json(
      rows.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        downloadUrl: `/api/public/estimates/${t}/attachments/${a.id}`,
      })),
    );
  });

  app.get("/api/public/estimates/:token/attachments/:id", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });
    const [est] = await db
      .select()
      .from(crmEstimates)
      .where(eq(crmEstimates.publicToken, t))
      .limit(1);
    if (!est) return res.status(404).json({ message: "Not found" });
    if (!(await requireDocSession(req, res, est.customerId))) return;

    const [att] = await db
      .select()
      .from(crmAttachments)
      .where(
        and(
          eq(crmAttachments.id, req.params.id),
          eq(crmAttachments.kind, "estimate"),
          eq(crmAttachments.refId, est.id),
        ),
      )
      .limit(1);
    if (!att) return res.status(404).json({ message: "File not found" });
    streamAttachment(res, att, false);
  });
}
