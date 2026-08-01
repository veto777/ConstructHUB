/**
 * Client 360 — the per-customer behaviour log the owner asked for.
 *
 *   - Contractor notes (crm_customer_notes): org-scoped CRUD under the
 *     customer. manageCustomers to write; edit/delete is own-note, or any
 *     note for owner/admin (canModifyNote).
 *   - Activity timeline (GET /api/crm/customers/:id/timeline): one merged,
 *     newest-first feed of estimate events (sent/viewed/approved/declined),
 *     engagement sessions ("opened estimate E-101 · stayed 4m 12s"), payments,
 *     portal comments, attachment uploads and financing clicks.
 *   - Financing click tracking (POST /api/client/financing-click): recorded
 *     BEFORE the portal opens the lender link, attributed to the session
 *     customer whose org actually offers that exact link. The org is emailed,
 *     gated by the 'financeClick' notification pref (default ON).
 *   - Contractor portal preview (POST /api/crm/customers/:id/portal-preview):
 *     mints the HMAC grant verified in client-auth.ts. Preview sessions are
 *     read-only — the interceptors below refuse portal writes for them.
 *
 * Registered BEFORE the attachment routes (routes.ts) so the read-only
 * interceptors run ahead of the real comment/photo handlers.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmAttachments,
  crmClientComments,
  crmCustomerNotes,
  crmCustomers,
  crmEstimates,
  crmEstimateEvents,
  crmEngagementSessions,
  crmFinanceClicks,
  crmInvoices,
  crmMembers,
  crmOrgs,
  crmPayments,
  crmNotificationEnabled,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { financingLinksOf } from "./financing";
import {
  PORTAL_PREVIEW_TTL_MS,
  isContractorPreview,
  mintPortalPreviewGrant,
  requireClient,
} from "./client-auth";
import { clientPortalBaseUrl } from "../site-context";
import { sendWithFallback } from "../email";

type GetUser = (req: any, res: any) => any;

const READ_ONLY_MESSAGE =
  "Contractor preview is read-only — sign in as the client to make changes.";

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

// ── Pure helpers (unit-tested in client-360.test.ts) ────────────────────────

/** Edit/delete a note: the author, or any owner/admin of the org. */
export function canModifyNote(
  note: { authorMemberId: string | null },
  member: { id: string; role: string },
): boolean {
  if (member.role === "owner" || member.role === "admin") return true;
  return note.authorMemberId !== null && note.authorMemberId === member.id;
}

export type TimelineEntry = {
  id: string;
  kind: "estimate_event" | "engagement" | "payment" | "comment" | "attachment" | "finance_click";
  verb: string;
  text: string;
  ref: string | null;          // document ref (E-101, INV-204) where relevant
  at: string;                  // ISO timestamp
  durationSecs?: number | null;
  amountCents?: number | null;
};

/** Newest-first; ties break deterministically by id so the order is stable. */
export function mergeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => {
    const d = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** "4m 12s" — sub-minute stays read "45s". */
export function formatDurationSecs(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/** Email the org owner(s) when a client taps a financing link. */
async function notifyFinanceClick(
  org: typeof crmOrgs.$inferSelect,
  cust: typeof crmCustomers.$inferSelect,
  label: string,
  baseUrl: string,
) {
  if (!crmNotificationEnabled(org.customFields, "financeClick")) return;

  const members = await db
    .select()
    .from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  const recipients = new Set<string>();
  for (const m of members) {
    if (m.role === "owner" && m.email) recipients.add(m.email);
  }
  if (!recipients.size && org.email) recipients.add(org.email);
  if (!recipients.size) return;

  await sendWithFallback({
    to: [...recipients].join(","),
    subject: `💳 ${cust.displayName} applied for financing`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
        <p style="font-size:16px"><strong>${esc(cust.displayName)}</strong> tapped
          <strong>${esc(label)}</strong> in their client portal.</p>
        <p style="font-size:14px">
          <a href="${baseUrl}/crm/clients/${cust.id}">Open ${esc(cust.displayName)} in the CRM</a>
        </p>
      </div>`,
  } as any).catch((e: any) => console.error("[crm] finance-click notify failed:", String(e?.message || e).slice(0, 300)));
}

export function registerCrmClient360Routes(app: Express, getDevUser: GetUser): void {
  // ── Read-only enforcement for contractor preview sessions ────────────────
  // These run ahead of the real handlers (registration order in routes.ts).
  // Reads stay open; writes refuse with a message the portal toasts.
  const blockPreviewWrites = async (req: any, res: any, next: any) => {
    if (isContractorPreview(req)) {
      return res.status(403).json({ message: READ_ONLY_MESSAGE, contractorPreview: true });
    }
    next();
  };
  app.post("/api/client/comments", blockPreviewWrites);
  app.post("/api/client/photos", blockPreviewWrites);

  // ── Contractor notes on a customer ────────────────────────────────────────

  const noteBodySchema = z.object({ body: z.string().trim().min(1).max(4000) });

  /** Customer must belong to the caller's org — never an id from the body. */
  async function loadCustomer(req: any, res: any, ctx: OrgContext) {
    const [cust] = await db
      .select({ id: crmCustomers.id })
      .from(crmCustomers)
      .where(and(eq(crmCustomers.id, req.params.id), eq(crmCustomers.orgId, ctx.org.id)))
      .limit(1);
    if (!cust) {
      res.status(404).json({ message: "Client not found" });
      return null;
    }
    return cust;
  }

  app.get("/api/crm/customers/:id/notes", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!(await loadCustomer(req, res, ctx))) return;

    const rows = await db
      .select({
        note: crmCustomerNotes,
        authorName: crmMembers.displayName,
        authorEmail: crmMembers.email,
      })
      .from(crmCustomerNotes)
      .leftJoin(crmMembers, eq(crmMembers.id, crmCustomerNotes.authorMemberId))
      .where(and(eq(crmCustomerNotes.orgId, ctx.org.id), eq(crmCustomerNotes.customerId, req.params.id)))
      .orderBy(desc(crmCustomerNotes.createdAt))
      .limit(200);
    res.json(
      rows.map((r) => ({
        id: r.note.id,
        body: r.note.body,
        authorMemberId: r.note.authorMemberId,
        authorName: r.authorName ?? r.authorEmail ?? null,
        createdAt: r.note.createdAt,
      })),
    );
  });

  app.post("/api/crm/customers/:id/notes", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    if (!(await loadCustomer(req, res, ctx))) return;

    const parsed = noteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter the note first" });

    const [row] = await db
      .insert(crmCustomerNotes)
      .values({
        orgId: ctx.org.id,
        customerId: req.params.id,
        authorMemberId: ctx.member.id,
        body: parsed.data.body,
      })
      .returning();
    res.status(201).json({
      id: row.id,
      body: row.body,
      authorMemberId: row.authorMemberId,
      authorName: ctx.member.displayName ?? ctx.member.email ?? null,
      createdAt: row.createdAt,
    });
  });

  app.patch("/api/crm/customers/:id/notes/:noteId", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    if (!(await loadCustomer(req, res, ctx))) return;

    const parsed = noteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter the note first" });

    const [note] = await db
      .select()
      .from(crmCustomerNotes)
      .where(and(
        eq(crmCustomerNotes.id, req.params.noteId),
        eq(crmCustomerNotes.orgId, ctx.org.id),
        eq(crmCustomerNotes.customerId, req.params.id),
      ))
      .limit(1);
    if (!note) return res.status(404).json({ message: "Note not found" });
    if (!canModifyNote(note, ctx.member)) {
      return res.status(403).json({ message: "You can only edit your own notes" });
    }

    const [row] = await db
      .update(crmCustomerNotes)
      .set({ body: parsed.data.body })
      .where(eq(crmCustomerNotes.id, note.id))
      .returning();
    res.json({ id: row.id, body: row.body, authorMemberId: row.authorMemberId, createdAt: row.createdAt });
  });

  app.delete("/api/crm/customers/:id/notes/:noteId", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    if (!(await loadCustomer(req, res, ctx))) return;

    const [note] = await db
      .select()
      .from(crmCustomerNotes)
      .where(and(
        eq(crmCustomerNotes.id, req.params.noteId),
        eq(crmCustomerNotes.orgId, ctx.org.id),
        eq(crmCustomerNotes.customerId, req.params.id),
      ))
      .limit(1);
    if (!note) return res.status(404).json({ message: "Note not found" });
    if (!canModifyNote(note, ctx.member)) {
      return res.status(403).json({ message: "You can only delete your own notes" });
    }

    await db.delete(crmCustomerNotes).where(eq(crmCustomerNotes.id, note.id));
    res.json({ ok: true });
  });

  // ── The unified per-customer activity timeline ────────────────────────────

  app.get("/api/crm/customers/:id/timeline", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!(await loadCustomer(req, res, ctx))) return;

    const orgId = ctx.org.id;
    const customerId = req.params.id;

    const estimates = await db
      .select({ id: crmEstimates.id, number: crmEstimates.number, title: crmEstimates.title })
      .from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, customerId)));
    const invoices = await db
      .select({ id: crmInvoices.id, number: crmInvoices.number, title: crmInvoices.title })
      .from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.customerId, customerId)));
    const estById = new Map(estimates.map((e) => [e.id, e]));
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const estIds = estimates.map((e) => e.id);
    const invIds = invoices.map((i) => i.id);
    const refOf = (d: { number: string | null; title: string } | undefined) =>
      d ? d.number ?? d.title : null;

    const [events, sessions, payments, comments, photos, estimateAtts, clicks] = await Promise.all([
      estIds.length
        ? db.select().from(crmEstimateEvents)
            .where(and(
              eq(crmEstimateEvents.orgId, orgId),
              inArray(crmEstimateEvents.estimateId, estIds),
              inArray(crmEstimateEvents.type, ["sent", "viewed", "approved", "declined"]),
            ))
            .orderBy(desc(crmEstimateEvents.createdAt)).limit(200)
        : Promise.resolve([]),
      db.select().from(crmEngagementSessions)
        .where(eq(crmEngagementSessions.orgId, orgId))
        .orderBy(desc(crmEngagementSessions.startedAt)).limit(500),
      db.select().from(crmPayments)
        .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.customerId, customerId)))
        .orderBy(desc(crmPayments.createdAt)).limit(100),
      db.select().from(crmClientComments)
        .where(and(eq(crmClientComments.orgId, orgId), eq(crmClientComments.customerId, customerId)))
        .orderBy(desc(crmClientComments.createdAt)).limit(100),
      db.select().from(crmAttachments)
        .where(and(
          eq(crmAttachments.orgId, orgId),
          eq(crmAttachments.kind, "photo"),
          eq(crmAttachments.refId, customerId),
        ))
        .orderBy(desc(crmAttachments.createdAt)).limit(100),
      estIds.length
        ? db.select().from(crmAttachments)
            .where(and(
              eq(crmAttachments.orgId, orgId),
              eq(crmAttachments.kind, "estimate"),
              inArray(crmAttachments.refId, estIds),
            ))
            .orderBy(desc(crmAttachments.createdAt)).limit(100)
        : Promise.resolve([]),
      db.select().from(crmFinanceClicks)
        .where(and(eq(crmFinanceClicks.orgId, orgId), eq(crmFinanceClicks.customerId, customerId)))
        .orderBy(desc(crmFinanceClicks.createdAt)).limit(100),
    ]);

    const entries: TimelineEntry[] = [];

    for (const e of events) {
      const est = estById.get(e.estimateId);
      if (!est) continue;
      const ref = refOf(est);
      const text =
        e.type === "sent" ? `Estimate ${ref} sent to the client`
        : e.type === "viewed" ? `Opened estimate ${ref}`
        : e.type === "approved" ? `Estimate ${ref} approved (signed)`
        : `Estimate ${ref} declined`;
      entries.push({
        id: `ev-${e.id}`, kind: "estimate_event", verb: e.type, text, ref,
        at: (e.createdAt ?? new Date()).toISOString(),
      });
    }

    // Engagement rows are org-wide; keep only this customer's documents.
    for (const s of sessions) {
      const doc = s.docType === "estimate" ? estById.get(s.docId) : invById.get(s.docId);
      if (!doc) continue;
      const ref = refOf(doc);
      entries.push({
        id: `eng-${s.id}`, kind: "engagement", verb: "opened",
        text: `Opened ${s.docType} ${ref} · stayed ${formatDurationSecs(s.durationSecs ?? 0)}`,
        ref,
        at: (s.startedAt ?? new Date()).toISOString(),
        durationSecs: s.durationSecs ?? 0,
      });
    }

    for (const p of payments) {
      const ref = (p.invoiceId ? invById.get(p.invoiceId)?.number : null)
        ?? (p.estimateId ? refOf(estById.get(p.estimateId)) : null);
      entries.push({
        id: `pay-${p.id}`, kind: "payment", verb: "payment",
        text: `Payment of ${money(p.amountCents)} recorded${p.method ? ` via ${p.method}` : ""}${p.status !== "succeeded" ? ` (${p.status})` : ""}`,
        ref,
        at: (p.paidAt ?? p.createdAt ?? new Date()).toISOString(),
        amountCents: p.amountCents,
      });
    }

    for (const c of comments) {
      entries.push({
        id: `com-${c.id}`, kind: "comment", verb: "comment",
        text: `Sent a message from the portal — “${c.body.length > 80 ? `${c.body.slice(0, 80)}…` : c.body}”`,
        ref: null,
        at: (c.createdAt ?? new Date()).toISOString(),
      });
    }

    for (const a of photos) {
      entries.push({
        id: `att-${a.id}`, kind: "attachment", verb: "attachment",
        text: `Shared a photo — ${a.fileName}`,
        ref: null,
        at: (a.createdAt ?? new Date()).toISOString(),
      });
    }
    for (const a of estimateAtts) {
      const ref = refOf(estById.get(a.refId ?? ""));
      entries.push({
        id: `att-${a.id}`, kind: "attachment", verb: "attachment",
        text: `File attached to estimate ${ref} — ${a.fileName}`,
        ref,
        at: (a.createdAt ?? new Date()).toISOString(),
      });
    }

    for (const f of clicks) {
      entries.push({
        id: `fin-${f.id}`, kind: "finance_click", verb: "finance_click",
        text: `Applied for financing via ${f.label}`,
        ref: null,
        at: (f.createdAt ?? new Date()).toISOString(),
      });
    }

    res.json(mergeTimeline(entries));
  });

  // ── Financing click tracking (client portal) ──────────────────────────────
  // The portal calls this BEFORE opening the lender link. The click is
  // attributed to the session customer whose org actually offers that exact
  // { label, url } — a link the org never configured is a 400, not a log row.

  app.post("/api/client/financing-click", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    if (client.contractorPreview) {
      return res.status(403).json({ message: READ_ONLY_MESSAGE, contractorPreview: true });
    }
    const parsed = z
      .object({ label: z.string().trim().min(1).max(80), url: z.string().trim().min(10).max(1000) })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid financing click" });
    const { label, url } = parsed.data;

    const customers = client.customerIds.length
      ? await db.select().from(crmCustomers).where(inArray(crmCustomers.id, client.customerIds))
      : [];
    for (const cust of customers) {
      const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, cust.orgId)).limit(1);
      if (!org) continue;
      const offered = financingLinksOf(org).some((l) => l.url === url && l.label === label);
      if (!offered) continue;

      await db.insert(crmFinanceClicks).values({
        orgId: cust.orgId,
        customerId: cust.id,
        label,
        url,
      });
      // Fire-and-forget: the portal never blocks on (or leaks) mail delivery.
      void notifyFinanceClick(org, cust, label, clientPortalBaseUrl(req))
        .catch((e: any) => console.error("[crm] finance-click notify failed:", String(e?.message || e).slice(0, 300)));
      return res.status(201).json({ ok: true });
    }
    return res.status(400).json({ message: "That financing link is not offered by your contractor" });
  });

  // ── Contractor portal preview ("see what the client sees") ────────────────
  // Mints the HMAC grant verified by GET /api/client/auth/preview — 15
  // minutes, read-only, bound to this customer, excluded from analytics.

  app.post("/api/crm/customers/:id/portal-preview", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;
    if (!(await loadCustomer(req, res, ctx))) return;
    if (!process.env.SESSION_SECRET) {
      return res.status(503).json({ message: "Preview is not configured on this server." });
    }

    const grant = mintPortalPreviewGrant(req.params.id);
    // Dev renders the client face query-forced; production has a client host.
    const dev = process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT ? "&client=1" : "";
    res.json({
      url: `${clientPortalBaseUrl(req)}/api/client/auth/preview?grant=${encodeURIComponent(grant)}${dev}`,
      expiresAt: new Date(Date.now() + PORTAL_PREVIEW_TTL_MS),
    });
  });
}
