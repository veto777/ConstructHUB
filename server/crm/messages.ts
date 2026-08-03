/**
 * Quick messages — the Create menu's Message flow: a contractor picks any
 * client, writes one message, and sends it by email or text.
 *
 * Channel honesty (the whole point):
 *   - Email always works — sendWithFallback sinks to the dev outbox when no
 *     SMTP is configured, exactly like estimate sends.
 *   - Text works ONLY when SignalWire is configured (server/crm/sms.ts
 *     smsConfigured()). When it isn't, the route refuses with a 409 that
 *     names the missing env vars and points at Settings — the composer never
 *     shows a clickable dead Text button, and the API never pretends either.
 *     (Unlike bid reminders, which RECORD via the log provider, a manual
 *     "send a text" must not silently become a log line.)
 *
 * Recording: there is no crm_messages table by design — the outbound message
 * is appended to crm_customer_notes with the OUTBOUND_MESSAGE_PREFIX marker,
 * and the client timeline (notes-timeline.ts) surfaces marker notes as
 * "message" entries: 'Message sent via email to joe@…: "…"'. The same note
 * reads naturally in the Client 360 notes surface.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { crmCustomerNotes, crmCustomers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { sendWithFallback } from "../email";
import { normalizePhone, sendSms, smsMissingEnv, resolveSmsSender } from "./sms";

type GetUser = (req: any, res: any) => any;

// ── The timeline marker ─────────────────────────────────────────────────────

export type QuickMessageChannel = "email" | "text";

/** Prefix that marks a customer note as an outbound quick message. */
export const OUTBOUND_MESSAGE_PREFIX = "Message sent via ";

/** The note body — reads naturally in the notes list AND on the timeline. */
export function messageNoteBody(channel: QuickMessageChannel, to: string, body: string): string {
  const via = channel === "email" ? "email" : "text";
  const quoted = body.length > 160 ? `${body.slice(0, 160)}…` : body;
  return `${OUTBOUND_MESSAGE_PREFIX}${via} to ${to}: “${quoted}”`;
}

export function isOutboundMessageNote(body: string | null | undefined): boolean {
  return typeof body === "string" && body.startsWith(OUTBOUND_MESSAGE_PREFIX);
}

// ── Delivery (unit-tested without a server) ─────────────────────────────────

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

/**
 * Send one quick message. Email goes through sendWithFallback (dev outbox in
 * dev); text goes through the SMS provider seam — check `provider` before
 * claiming a text "went out". Callers gate text on smsConfigured() first;
 * deliverQuickMessage itself never refuses.
 */
export async function deliverQuickMessage(args: {
  channel: QuickMessageChannel;
  to: string;
  body: string;
  orgName: string;
  replyTo?: string;
  /** The org's custom_fields — picks ITS sender (own number / own account). */
  orgCustomFields?: unknown;
}): Promise<{ ok: boolean; provider: "email" | "signalwire" | "log"; error?: string }> {
  const { channel, to, body, orgName, replyTo, orgCustomFields } = args;
  if (channel === "email") {
    await sendWithFallback({
      to,
      subject: `Message from ${orgName}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
        <p style="font-size:15px;white-space:pre-wrap">${esc(body)}</p>
        <p style="font-size:12px;color:#999">— ${esc(orgName)}</p>
      </div>`,
      replyTo: replyTo || undefined,
    } as any);
    return { ok: true, provider: "email" };
  }
  const r = await sendSms(to, `${orgName}: ${body}`, orgCustomFields);
  return { ok: r.ok, provider: r.provider, error: r.error ?? undefined };
}

// ── Route ───────────────────────────────────────────────────────────────────

export function registerCrmMessageRoutes(app: Express, getDevUser: GetUser): void {
  app.post("/api/crm/messages", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageCustomers")) return;

    const parsed = z.object({
      customerId: z.string().min(1),
      channel: z.enum(["email", "text"]),
      body: z.string().trim().min(1).max(4000),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid message", issues: parsed.error.issues });
    const { customerId, channel, body } = parsed.data;

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, customerId))).limit(1);
    if (!cust) return res.status(404).json({ message: "Client not found" });

    let to: string;
    if (channel === "email") {
      if (!cust.email) {
        return res.status(400).json({ message: "This client has no email address — add one first." });
      }
      to = cust.email;
    } else {
      // Honest refusal, mirroring the composer's grayed-out Text option —
      // never a silent log-provider pretend for a manual send.
      if (!resolveSmsSender(ctx.org.customFields)) {
        return res.status(409).json({
          message: `Texting is off — enable it in Settings → Integrations (set ${smsMissingEnv().join(", ")} on the server).`,
          missing: smsMissingEnv(),
        });
      }
      const phone = normalizePhone(cust.phone);
      if (!phone) {
        return res.status(400).json({ message: "This client has no phone number — add one first." });
      }
      to = phone;
    }

    let result: Awaited<ReturnType<typeof deliverQuickMessage>>;
    try {
      result = await deliverQuickMessage({
        channel, to, body, orgName: ctx.org.name, replyTo: ctx.org.email || undefined,
        orgCustomFields: ctx.org.customFields,
      });
    } catch (e: any) {
      console.error("[crm] quick message failed:", e?.message || e);
      return res.status(502).json({ message: `The message could not be sent: ${String(e?.message || e).slice(0, 300)}` });
    }
    if (!result.ok) {
      return res.status(502).json({ message: `The message could not be sent: ${result.error ?? "provider error"}` });
    }

    // Record on the client timeline (via the notes marker) AFTER the send, so
    // a failed send never leaves a "you sent" entry behind.
    const [note] = await db.insert(crmCustomerNotes).values({
      orgId: ctx.org.id,
      customerId,
      authorMemberId: ctx.member.id,
      body: messageNoteBody(channel, to, body),
    }).returning();

    res.status(201).json({
      ok: true, channel, to, provider: result.provider,
      noteId: note.id, recordedAt: note.createdAt,
    });
  });
}
