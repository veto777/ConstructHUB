import { objectPolicy, canShareWholeClientPortal } from "./object-access";
/**
 * Client 360 — the per-customer behaviour log the owner asked for.
 *
 *   - Contractor notes (crm_customer_notes): org-scoped CRUD under the
 *     customer. manageCustomers to write; edit/delete is own-note, or any
 *     note for owner/admin (canModifyNote).
 *   - Activity timeline (GET /api/crm/customers/:id/timeline): one merged,
 *     newest-first feed of estimate events (sent/viewed/approved/declined),
 *     engagement sessions ("opened estimate E-101 · stayed 4m 12s"), payments,
 *     portal comments, attachment uploads and financing clicks. EVERY entry
 *     names who did it (`actor`, shared/crm-actor.ts): the member by name
 *     ("Veto Smith (Owner)" for the owner), the client by name, or the
 *     automatic source ("HOVER import", "Stripe", "System"). A historic row
 *     with nothing recorded is said so — never guessed.
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
  crmActivityLog,
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
import { clientPortalBaseUrl, portalBaseUrl } from "../site-context";
import { sendWithFallback } from "../email";
import { isOutboundMessageNote, OUTBOUND_MESSAGE_PREFIX } from "./messages";
import { loadActorDirectory, estimateEventActor } from "./actors";
import {
  actorLabel, actorSentence, clientActor, systemActor, uploadLabelActor,
  UNRECORDED_ACTOR, UNRECORDED_TEAM_ACTOR, type CrmActor,
} from "@shared/crm-actor";
import { INTEREST_EVENT_TYPES, interestEventText } from "@shared/self-estimate";

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
  kind: "estimate_event" | "engagement" | "payment" | "comment" | "attachment" | "finance_click" | "message";
  verb: string;
  /** Who did it, by name — never an id. recorded:false = nothing recorded who (historic). */
  actor: CrmActor;
  /** The full sentence, actor first ("Gabe Varnadore added a project photo …"). */
  text: string;
  /** The sentence without the actor — the UI bolds the name in front of it. Equal to
   *  `text` when the actor is not recorded (the sentence then says so itself). */
  actionText: string;
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

const quote = (body: string) => `“${body.length > 80 ? `${body.slice(0, 80)}…` : body}”`;

/** An entry's actor + sentence, built the one way: "<actor> <rest>". */
export function said(actor: CrmActor, rest: string): { actor: CrmActor; text: string; actionText: string } {
  const text = actorSentence(actor, rest);
  return { actor, text, actionText: rest };
}

/** A historic entry whose sentence states that nobody recorded who did it. */
function unrecorded(actor: CrmActor, sentence: string): { actor: CrmActor; text: string; actionText: string } {
  return { actor, text: sentence, actionText: sentence };
}

/**
 * One thread message on the timeline. crm_client_comments is two-way:
 * authorMemberId null = the client wrote it from the portal; set = a team
 * member's reply — which must never read as the client's message. `actor`
 * is the client (by name) or the replying member (by name).
 */
export function commentTimelineText(
  c: { body: string; authorMemberId: string | null },
  actor: CrmActor,
): string {
  if (!c.authorMemberId) return actorSentence(actor, `sent a message from the portal — ${quote(c.body)}`);
  return actorSentence(actor, `replied — ${quote(c.body)}`);
}

/** The stage tag the CRM upload route stores in front of the name. */
export function photoStage(fileName: string): "progress" | "finished" | "punchlist" | null {
  return fileName.startsWith("progress--") ? "progress" : fileName.startsWith("finished--") ? "finished"
    : fileName.startsWith("punchlist--") ? "punchlist" : null;
}

/**
 * Who added an attachment — from REAL evidence only, in this order:
 *   1. the row's own uploader columns (every insert path since 2026-10-17);
 *   2. a crm_activity_log row for the same attachment id;
 *   3. the KIND, which only server code sets: 'contract' PDFs are minted by
 *      the system, 'measurement' PDFs only by the HOVER import; estimate,
 *      pamphlet and library files only come from the team's CRM routes →
 *      "your team (uploader not recorded)";
 *   4. a photo with neither → not recorded at all. The FILE NAME is never
 *      evidence: the client portal keeps the homeowner's own file name, so a
 *      client can upload "progress--x.jpg" or "hover-1-2.jpg" themselves.
 *      (The stage tag may still label the photo in progress / finished.)
 */
export function resolveAttachmentActor(
  att: { kind: string; fileName: string; uploadedByMemberId?: string | null; uploadedByLabel?: string | null; uploadedByKind?: string | null },
  ev: {
    member: (id: string) => CrmActor | null;
    /** The activity-log actor recorded for this attachment's upload, if any. */
    logged?: CrmActor | null;
  },
): CrmActor {
  if (att.uploadedByMemberId) {
    const m = ev.member(att.uploadedByMemberId);
    if (m) return m;
    if (ev.logged) return ev.logged;
    return { kind: "member", name: "Former team member", recorded: true };
  }
  if (att.uploadedByLabel) return uploadLabelActor(att.uploadedByLabel, att.uploadedByKind);
  if (ev.logged) return ev.logged;
  if (att.kind === "contract") return systemActor("System");
  if (att.kind === "measurement") return systemActor("HOVER import");
  if (att.kind === "photo") return UNRECORDED_ACTOR;
  if (att.kind === "estimate" || att.kind === "pamphlet" || att.kind === "estimate_default") return UNRECORDED_TEAM_ACTOR;
  return UNRECORDED_ACTOR;
}

/**
 * A photo on the client's shelf, named by its uploader: "Gabe Varnadore
 * added a project photo (in progress) — IMG_3305.jpeg", "Carley Geiss shared
 * a photo — IMG_0042.jpg", "HOVER import added a photo — hover-1-2.jpg".
 */
export function photoTimelineText(fileName: string, actor: CrmActor): { actor: CrmActor; text: string; actionText: string } {
  const stage = photoStage(fileName);
  const name = stage ? fileName.slice(stage.length + 2) : fileName;
  const noun = stage ? `a project photo (${stage === "finished" ? "finished" : "in progress"})` : "a photo";
  if (actor.recorded === false) {
    if (actor.kind === "member") return unrecorded(actor, `Added by your team (uploader not recorded): ${noun} — ${name}`);
    // Neutral: nothing recorded who. The stage tag only labels the photo.
    return unrecorded(actor, stage
      ? `Project photo (${stage === "finished" ? "finished" : "in progress"}) added (uploader not recorded) — ${name}`
      : `Photo added (uploader not recorded) — ${name}`);
  }
  if (actor.kind === "client") return said(actor, `shared a photo — ${name}`);
  return said(actor, `added ${noun} — ${name}`);
}

/**
 * A file on one of the client's estimates. `attacher` is who put it on this
 * estimate (the library / auto-attach log row), `uploader` who added the file
 * in the first place — named too when they differ.
 */
export function estimateFileTimelineText(
  fileName: string, ref: string | null, attacher: CrmActor, uploader: CrmActor | null,
): { actor: CrmActor; text: string; actionText: string } {
  const on = `estimate ${ref ?? ""}`.trim();
  if (attacher.recorded === false) {
    return unrecorded(attacher, `Added by your team (uploader not recorded): ${fileName} on ${on}`);
  }
  const by = uploader && uploader.recorded !== false && actorLabel(uploader) !== actorLabel(attacher)
    ? ` (uploaded by ${actorLabel(uploader)})` : "";
  return said(attacher, `attached ${fileName} to ${on}${by}`);
}

export { estimateEventActor };

/** One estimate event as a named sentence; null = a type the timeline does not show. */
export function estimateEventText(
  type: string, ref: string | null, actor: CrmActor, meta: Record<string, any> = {},
): { actor: CrmActor; text: string; actionText: string } | null {
  const est = `estimate ${ref ?? ""}`.trim();
  if (actor.recorded === false) {
    const passive =
      type === "sent" ? `Estimate ${ref} sent to the client (sender not recorded)`
      : type === "extended" ? `Estimate ${ref} expiry extended (not recorded who)`
      : null;
    return passive ? unrecorded(actor, passive) : null;
  }
  switch (type) {
    case "sent": return said(actor, `sent ${est} to the client`);
    case "viewed": return said(actor, `opened ${est}`);
    case "approved": return said(actor, `approved (signed) ${est}`);
    case "declined": return said(actor, `declined ${est}`);
    case "shared": return said(actor, `shared ${est} with ${meta.sharedWith ?? "someone"}`);
    case "access_denied": return said(actor, `was blocked from ${est} — typed ${meta.attemptedEmail ?? "an unknown email"}`);
    case "forward_detected": return said(actor, `opened the ${est} link on a second device — likely forwarded`);
    case "options_selected": return said(actor, `selected their scopes on ${est}`);
    case "extended": return said(actor, `extended the expiry of ${est}`);
    default: return null;
  }
}

/** An outbound quick-message note ('Message sent via email to joe@…: "…"'), named. */
export function messageTimelineText(body: string, actor: CrmActor): { actor: CrmActor; text: string; actionText: string } {
  const rest = body.startsWith(OUTBOUND_MESSAGE_PREFIX) ? body.slice(OUTBOUND_MESSAGE_PREFIX.length) : body;
  if (actor.recorded === false) return unrecorded(actor, `${body} (sender not recorded)`);
  return said(actor, `sent a message via ${rest}`);
}

/** A payment line, named: Stripe payments are the client's, manual ones whoever recorded them. */
export function paymentTimelineText(
  p: { provider: string; amountCents: number; method: string | null; status: string },
  actor: CrmActor,
): { actor: CrmActor; text: string; actionText: string } {
  const amount = money(p.amountCents);
  const via = p.method ? ` via ${p.method}` : "";
  const status = p.status !== "succeeded" ? ` (${p.status})` : "";
  if (actor.recorded === false) return unrecorded(actor, `Payment of ${amount} recorded${via}${status} (not recorded who)`);
  if (p.provider === "stripe") return said(actor, `paid ${amount}${via} through Stripe${status}`);
  if (actor.kind === "member") return said(actor, `recorded a payment of ${amount}${via}${status}`);
  return said(actor, `recorded a payment of ${amount}${via}${status}`);
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
      .select({ note: crmCustomerNotes })
      .from(crmCustomerNotes)
      .where(and(eq(crmCustomerNotes.orgId, ctx.org.id), eq(crmCustomerNotes.customerId, req.params.id)))
      .orderBy(desc(crmCustomerNotes.createdAt))
      .limit(200);
    const dir = await loadActorDirectory(ctx.org.id);
    // A note with no author is an imported one: nothing recorded who wrote it.
    const authorOf = (id: string | null): CrmActor => (id
      ? dir.member(id) ?? { kind: "member", name: "Former team member", recorded: true }
      : { ...UNRECORDED_ACTOR, name: "Author not recorded" });
    // The owner's payment-reversal note states the amount; it is not shown to a price-blind seat.
    const shown = ctx.permissions.seePrices
      ? rows
      : rows.filter((r) => !/^A \$[\d,.]+ payment .* was reversed by the account owner\./.test(r.note.body ?? ""));
    res.json(
      shown.map((r) => {
        // A note imported from a HOVER job: its writer is HOVER's user, not a seat here.
        if (r.note.source === "hover" && !r.note.authorMemberId) {
          return {
            id: r.note.id,
            body: r.note.body,
            authorMemberId: null,
            author: null,
            authorName: r.note.sourceAuthor || "HOVER user",
            source: "hover",
            createdAt: r.note.createdAt,
          };
        }
        return {
          id: r.note.id,
          body: r.note.body,
          authorMemberId: r.note.authorMemberId,
          author: authorOf(r.note.authorMemberId),
          authorName: actorLabel(authorOf(r.note.authorMemberId)),
          source: r.note.source ?? null,
          createdAt: r.note.createdAt,
        };
      }),
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
    const author = (await loadActorDirectory(ctx.org.id)).member(ctx.member.id);
    res.status(201).json({
      id: row.id,
      body: row.body,
      authorMemberId: row.authorMemberId,
      author,
      authorName: author ? actorLabel(author) : null,
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

    let estimates = await db
      .select({ id: crmEstimates.id, number: crmEstimates.number, title: crmEstimates.title })
      .from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, customerId)));
    let invoices = await db
      .select({ id: crmInvoices.id, number: crmInvoices.number, title: crmInvoices.title })
      .from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.customerId, customerId)));
    const access = objectPolicy(ctx);
    estimates = await access.filter("estimates", estimates);
    invoices = await access.filter("invoices", invoices);
    const estById = new Map(estimates.map((e) => [e.id, e]));
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const estIds = estimates.map((e) => e.id);
    const invIds = invoices.map((i) => i.id);
    const refOf = (d: { number: string | null; title: string } | undefined) =>
      d ? d.number ?? d.title : null;

    const [events, sessions, payments, comments, notes, photos, estimateAtts, clicks] = await Promise.all([
      estIds.length
        ? db.select().from(crmEstimateEvents)
            .where(and(
              eq(crmEstimateEvents.orgId, orgId),
              inArray(crmEstimateEvents.estimateId, estIds),
              inArray(crmEstimateEvents.type, [
                "sent", "viewed", "approved", "declined",
                // Self-estimate interest (seeing a prompt card is not interest — not listed).
                ...INTEREST_EVENT_TYPES.filter((t) => t !== "interest_prompt_viewed"),
              ]),
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
      // Contractor notes — only the outbound-message marker subset lands on
      // the timeline (see messages.ts); plain notes stay in the notes surface.
      db.select().from(crmCustomerNotes)
        .where(and(eq(crmCustomerNotes.orgId, orgId), eq(crmCustomerNotes.customerId, customerId)))
        .orderBy(desc(crmCustomerNotes.createdAt)).limit(100),
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

    // ── Who did it: names for every source (one member query, plus the
    // activity-log rows that recorded attachment uploads / manual payments).
    const dir = await loadActorDirectory(orgId);
    const [custRow] = await db.select({ displayName: crmCustomers.displayName }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, customerId))).limit(1);
    const clientName = custRow?.displayName ?? null;
    const client = clientActor(clientName);
    const attIds = [...photos, ...estimateAtts].map((a) => a.id);
    const payIds = payments.map((p) => p.id);
    const loggedRows = attIds.length || payIds.length
      ? await db.select().from(crmActivityLog)
          .where(and(
            eq(crmActivityLog.orgId, orgId),
            inArray(crmActivityLog.entityId, [...attIds, ...payIds]),
            inArray(crmActivityLog.action, ["attachment.added", "attachment.attached", "attachment.auto_attached", "payment.recorded"]),
          ))
      : [];
    const loggedBy = (entityId: string, actions: string[]): CrmActor | null => {
      const r = loggedRows.find((x) => x.entityId === entityId && actions.includes(x.action));
      return r ? dir.logActor(r, clientName) : null;
    };

    const entries: TimelineEntry[] = [];

    for (const e of events) {
      const est = estById.get(e.estimateId);
      if (!est) continue;
      const ref = refOf(est);
      const meta = (e.meta ?? {}) as Record<string, any>;
      // Every type is EXPLICIT — an unmapped type is skipped, never mislabeled
      // (unknown types used to fall through to "declined").
      // Self-estimate interest events are the client's; ballpark amounts are prices, so a price-blind
      // seat reads the sentence without them.
      const interest = e.type.startsWith("interest_")
        ? interestEventText(e.type, ctx.permissions.seePrices ? meta : { ...meta, lowCents: null, highCents: null }, ref)
        : null;
      const line = e.type.startsWith("interest_")
        ? (interest ? said(client, interest.replace(/^Client /, "")) : null)
        : estimateEventText(e.type, ref, estimateEventActor(e.actor, dir, clientName), meta);
      if (!line) continue;
      entries.push({
        id: `ev-${e.id}`, kind: "estimate_event", verb: e.type, ...line, ref,
        at: (e.createdAt ?? new Date()).toISOString(),
      });
    }

    // Engagement rows are org-wide; keep only this customer's documents.
    // The public page is the client's — the visit reads as theirs.
    for (const s of sessions) {
      const doc = s.docType === "estimate" ? estById.get(s.docId) : invById.get(s.docId);
      if (!doc) continue;
      const ref = refOf(doc);
      entries.push({
        id: `eng-${s.id}`, kind: "engagement", verb: "opened",
        ...said(client, `opened ${s.docType} ${ref} · stayed ${formatDurationSecs(s.durationSecs ?? 0)}`),
        ref,
        at: (s.startedAt ?? new Date()).toISOString(),
        durationSecs: s.durationSecs ?? 0,
      });
    }

    // Payments are money: a price-blind seat gets no payment lines at all
    // (the same seat is refused GET /api/crm/payments).
    for (const p of ctx.permissions.seePrices ? await access.filter("payments", payments) : []) {
      const ref = (p.invoiceId ? invById.get(p.invoiceId)?.number : null)
        ?? (p.estimateId ? refOf(estById.get(p.estimateId)) : null);
      // Stripe = the client paid online; manual = whoever recorded it (the
      // activity log names them); any other provider is that source.
      const actor = p.provider === "stripe" ? client
        : p.provider === "manual" ? loggedBy(p.id, ["payment.recorded"]) ?? UNRECORDED_TEAM_ACTOR
        : systemActor(p.provider);
      entries.push({
        id: `pay-${p.id}`, kind: "payment", verb: "payment",
        ...paymentTimelineText(p, actor),
        ref,
        at: (p.paidAt ?? p.createdAt ?? new Date()).toISOString(),
        amountCents: p.amountCents,
      });
    }

    for (const c of await access.filter("client-comments", comments)) {
      const actor = c.authorMemberId
        ? dir.member(c.authorMemberId) ?? { kind: "member" as const, name: "Former team member", recorded: true }
        : client;
      const text = commentTimelineText(c, actor);
      entries.push({
        id: `com-${c.id}`, kind: "comment", verb: c.authorMemberId ? "reply" : "comment",
        actor, text, actionText: text.slice(actorLabel(actor).length).trim(),
        ref: null,
        at: (c.createdAt ?? new Date()).toISOString(),
      });
    }

    // Outbound quick messages (Create menu → Message). The note body reads
    // 'Message sent via email to joe@…: "…"'; its author sent it.
    for (const n of notes) {
      if (!isOutboundMessageNote(n.body)) continue;
      const actor = n.authorMemberId
        ? dir.member(n.authorMemberId) ?? { kind: "member" as const, name: "Former team member", recorded: true }
        : UNRECORDED_TEAM_ACTOR;
      entries.push({
        id: `msg-${n.id}`, kind: "message", verb: "message",
        ...messageTimelineText(n.body, actor),
        ref: null,
        at: (n.createdAt ?? new Date()).toISOString(),
      });
    }

    for (const a of photos) {
      const actor = resolveAttachmentActor(a, {
        member: dir.member, logged: loggedBy(a.id, ["attachment.added"]),
      });
      entries.push({
        id: `att-${a.id}`, kind: "attachment", verb: "attachment",
        ...photoTimelineText(a.fileName, actor),
        ref: null,
        at: (a.createdAt ?? new Date()).toISOString(),
      });
    }
    for (const a of estimateAtts) {
      const ref = refOf(estById.get(a.refId ?? ""));
      const uploader = resolveAttachmentActor(a, { member: dir.member, logged: loggedBy(a.id, ["attachment.added"]) });
      // Library / auto-attach copies keep the original uploader; the log row
      // says who (or what) put the file on THIS estimate.
      const attacher = loggedBy(a.id, ["attachment.attached", "attachment.auto_attached"]) ?? uploader;
      entries.push({
        id: `att-${a.id}`, kind: "attachment", verb: "attachment",
        ...estimateFileTimelineText(a.fileName, ref, attacher, uploader),
        ref,
        at: (a.createdAt ?? new Date()).toISOString(),
      });
    }

    for (const f of clicks) {
      entries.push({
        id: `fin-${f.id}`, kind: "finance_click", verb: "finance_click",
        ...said(client, `applied for financing via ${f.label}`),
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
      void notifyFinanceClick(org, cust, label, portalBaseUrl(req))
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

    if (!canShareWholeClientPortal(ctx)) return res.status(403).json({ message: "Whole-client preview requires organization-wide document access. Preview an individual estimate instead." });

    const grant = mintPortalPreviewGrant(req.params.id);
    // Dev renders the client face query-forced; production has a client host.
    const dev = process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT ? "&client=1" : "";
    res.json({
      url: `${clientPortalBaseUrl(req)}/api/client/auth/preview?grant=${encodeURIComponent(grant)}${dev}`,
      expiresAt: new Date(Date.now() + PORTAL_PREVIEW_TTL_MS),
    });
  });
}
