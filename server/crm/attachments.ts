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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { allow as rateAllow, requireClient } from "./client-auth";
import { requireDocSession } from "./portal";
import { sendWithFallback } from "../email";
import { portalBaseUrl } from "../site-context";

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

/**
 * Persist a SERVER-GENERATED PDF (the signed contract) through the same
 * storage as uploads — same directory, same containment rule, same gated
 * reads. kind is 'contract', refId the estimate id; the row is the record.
 */
export async function storeGeneratedPdf(args: {
  orgId: string;
  kind: string;
  refId: string | null;
  fileName: string;
  buffer: Buffer;
}): Promise<typeof crmAttachments.$inferSelect> {
  const storagePath = `${args.orgId}/${randomUUID()}.pdf`;
  const abs = path.join(STORAGE_DIR, storagePath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, args.buffer);
  const [row] = await db.insert(crmAttachments).values({
    orgId: args.orgId,
    kind: args.kind,
    refId: args.refId,
    fileName: safeName(args.fileName),
    mime: "application/pdf",
    sizeBytes: args.buffer.length,
    storagePath,
  }).returning();
  return row;
}

function streamAttachment(res: any, att: typeof crmAttachments.$inferSelect, inline: boolean) {
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
    `${inline && att.mime.startsWith("image/") ? "inline" : "attachment"}; filename="${safeName(att.fileName)}"`,
  );
  fs.createReadStream(abs).pipe(res);
}

const present = (a: typeof crmAttachments.$inferSelect, url: string) => ({
  id: a.id,
  kind: a.kind,
  refId: a.refId,
  fileName: a.fileName,
  mime: a.mime,
  sizeBytes: a.sizeBytes,
  createdAt: a.createdAt,
  url: `${url}/${a.id}/file`,
  downloadUrl: `${url}/${a.id}/file`,
});

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

  await notifyMembers({
    org: org as any, pref: "clientComments",
    title: `${customer.displayName} sent a message${context}`,
    body: body.slice(0, 200),
    link: `/crm/inbox?c=${customer.id}`,
    extraMemberIds: [
      ...(assignedId ? [assignedId] : []),
      ...members.filter((m) => m.role === "admin").map((m) => m.id),
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
  console.log(`[crm] client comment notification → ${to}`);
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
    res.json(rows.map((a) => present(a, "/api/crm/attachments")));
  });

  app.post("/api/crm/attachments", singleFile("file"), async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;

    const kind = String(req.body?.kind || "");
    if (kind !== "pamphlet" && kind !== "estimate") {
      return res.status(400).json({ message: "kind must be pamphlet or estimate" });
    }
    let refId: string | null = null;
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

    const values = await storeFile(file, DOC_MIMES, ctx.org.id, kind, refId);
    if (!values) return res.status(415).json({ message: "PDF or image files only" });

    const [row] = await db.insert(crmAttachments).values(values).returning();
    res.status(201).json(present(row, "/api/crm/attachments"));
  });

  app.delete("/api/crm/attachments/:id", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;

    const [row] = await db
      .delete(crmAttachments)
      .where(and(eq(crmAttachments.id, req.params.id), eq(crmAttachments.orgId, ctx.org.id)))
      .returning();
    if (!row) return res.status(404).json({ message: "Attachment not found" });
    await fs.promises.unlink(path.resolve(STORAGE_DIR, row.storagePath)).catch(() => {});
    res.json({ ok: true });
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
    streamAttachment(res, att, req.query.inline === "1");
  });

  // ── Contractor: client comments (client detail page) ──────────────────────

  app.get("/api/crm/customers/:id/client-comments", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(crmClientComments)
      .where(and(eq(crmClientComments.customerId, req.params.id), eq(crmClientComments.orgId, ctx.org.id)))
      .orderBy(desc(crmClientComments.createdAt))
      .limit(200);
    res.json(
      rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, readAt: c.readAt })),
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

    const [row] = await db.insert(crmAttachments).values(values).returning();
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
