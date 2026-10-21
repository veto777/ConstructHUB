/**
 * Schedule Bid (owner, 2026-10-21): "lets add a schedule Bid instead of Bid where you can connect leads to your
 * estimates you schedule in your calander … If a lead does not exist you make a new one. … This will alert you via
 * text 30 min before the bid so you dont miss it (you can turn it off in settings). The client also gets an email sent
 * of confirmation of this appointment."
 *
 * A bid is an ordinary calendar visit (crm_appointments) with kind = "bid", so it shows on the calendar, the client
 * page, the iCal feed and Google Calendar like every other visit. On top of that:
 *   - POST /api/crm/bids books it for a client. The dialog (client/src/components/schedule-bid.tsx) resolves the
 *     client first: an existing client, a lead (converted through POST /api/crm/leads/:id/convert) or a brand-new
 *     client. A brand-new client also gets a crm_leads row (source "manual", "Scheduled bid") so it is on the Leads
 *     page — the lead that did not exist yet.
 *   - The client gets a confirmation email (date and time in the company's time zone, the address, who is coming,
 *     an .ics invite), reply-to the company, noted on the client timeline. Stamped once (confirmation_sent_at).
 *   - 30 minutes before, the member who booked it and the crew dispatched to it get a text (and the bell), per
 *     Settings → Notifications → "Bid reminder" (text ON by default). Claimed once (reminder_sent_at); moving the bid
 *     clears the stamp (server/crm/schedule.ts PATCH) so the new time is reminded too.
 * A bid never moves the job stage: a sales visit is not a start date (server/crm/schedule.ts jobOnCalendar).
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmAppointments, crmCustomerNotes, crmCustomers, crmLeads, crmMembers, crmNotifications, crmOrgs,
  crmNotificationChannel,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { logActivity } from "./activity";
import { logTeamActivity } from "./stats";
import { queueCrmEvent } from "./integrations";
import { messageNoteBody } from "./messages";
import { normalizePhone, resolveSmsSender, sendSms } from "./sms";
import { buildICalendar } from "./ical";
import { sendWithFallback } from "../email";
import { appForLink, pushSoon } from "../apns";
import { siteBaseUrl } from "../site-context";
import { workerInterval } from "../workers";

type GetUser = (req: any, res: any) => any;
type Org = typeof crmOrgs.$inferSelect;
type Customer = typeof crmCustomers.$inferSelect;
type Appointment = typeof crmAppointments.$inferSelect;

export const BID_KIND = "bid";
/** How long before a bid the reminder text goes out. */
export const BID_REMINDER_MINUTES = 30;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

const parseTime = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/** "4783 Bayshore Drive, Blaine, WA 98230" — whatever parts the client has. */
export function customerAddress(c: Pick<Customer, "addressLine1" | "addressLine2" | "city" | "state" | "postalCode">): string | null {
  const line = [c.addressLine1, c.addressLine2].filter((x) => (x ?? "").trim()).join(" ");
  const tail = [c.city, [c.state, c.postalCode].filter((x) => (x ?? "").trim()).join(" ")].filter((x) => (x ?? "").trim()).join(", ");
  return [line, tail].filter(Boolean).join(", ") || null;
}

/** "Thursday, October 23 at 2:00 PM PDT" in the company's time zone (the browser's zone is never the client's). */
export function bidWhen(startsAt: Date, timezone: string | null | undefined): string {
  const tz = timezone || "America/Los_Angeles";
  try {
    const day = startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
    const time = startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: tz });
    return `${day} at ${time}`;
  } catch {
    return startsAt.toUTCString();
  }
}

/** "2:00 PM" in the company's time zone — the reminder text. */
function bidTime(startsAt: Date, timezone: string | null | undefined): string {
  try { return startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone || "America/Los_Angeles" }); }
  catch { return startsAt.toISOString().slice(11, 16); }
}


/** The confirmation email's subject, text and HTML (pure; the unit test reads it). */
export function bidConfirmationEmail(args: {
  org: Pick<Org, "name" | "phone" | "email" | "timezone">; customer: Pick<Customer, "displayName"> & { firstName?: string | null };
  startsAt: Date; endsAt: Date | null; address: string | null; estimator: string | null; notes?: string | null;
}): { subject: string; text: string; html: string } {
  const { org, customer, startsAt, address, estimator } = args;
  const first = customer.firstName?.trim() || (customer.displayName || "").trim().split(/\s+/)[0] || "there";
  const when = bidWhen(startsAt, org.timezone);
  const subject = `Your appointment with ${org.name} is confirmed — ${when}`;
  const rows: [string, string][] = [
    ["When", when],
    ...(address ? [["Where", address] as [string, string]] : []),
    ...(estimator ? [["Who's coming", estimator] as [string, string]] : []),
  ];
  const contact = [org.phone ? `call ${org.phone}` : null, "reply to this email"].filter(Boolean).join(" or ");
  const text = [
    `Hi ${first},`,
    "",
    `Your appointment with ${org.name} for an estimate is confirmed.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Need to change the time? Just ${contact}.`,
    "",
    `— ${org.name}`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;color:#1f2937">
  <p style="font-size:15px">Hi ${esc(first)},</p>
  <p style="font-size:15px">Your appointment with <b>${esc(org.name)}</b> for an estimate is confirmed.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;width:100%">
    ${rows.map(([k, v]) => `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:10px 14px;font-size:15px;font-weight:600">${esc(v)}</td></tr>`).join("\n    ")}
  </table>
  <p style="font-size:14px">Need to change the time? Just ${esc(contact)}.</p>
  <p style="font-size:14px;color:#6b7280">The calendar invite is attached.</p>
  <p style="font-size:14px">— ${esc(org.name)}</p>
</div>`;
  return { subject, text, html };
}

/**
 * Email the client the confirmation (once): reply-to the company, an .ics invite attached, a note on the client's
 * timeline. Returns why it was skipped, if it was.
 */
export async function sendBidConfirmation(org: Org, customer: Customer, appt: Appointment): Promise<{ sent: boolean; reason?: string }> {
  if (!customer.email) return { sent: false, reason: "the client has no email address" };
  const [estimator] = appt.createdByMemberId
    ? await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.id, appt.createdByMemberId))).limit(1)
    : [];
  const address = customerAddress(customer);
  const mail = bidConfirmationEmail({
    org, customer, startsAt: appt.startsAt, endsAt: appt.endsAt, address,
    // Only a real name goes to the client — never a teammate's login email.
    estimator: estimator?.displayName?.trim() || null, notes: appt.notes,
  });
  const ics = buildICalendar(org.name, [{
    id: appt.id, title: `Estimate appointment — ${org.name}`, customerName: null, projectName: null,
    location: address, notes: org.phone ? `Questions? Call ${org.name} at ${org.phone}.` : null,
    status: appt.status, startsAt: appt.startsAt, endsAt: appt.endsAt, allDay: appt.allDay,
    arrivalWindowMinutes: appt.arrivalWindowMinutes, updatedAt: appt.updatedAt,
  }]);
  await sendWithFallback({
    to: customer.email, subject: mail.subject, text: mail.text, html: mail.html,
    replyTo: org.email || undefined,
    attachments: [{ filename: "appointment.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
  } as any);
  await db.update(crmAppointments).set({ confirmationSentAt: new Date() }).where(eq(crmAppointments.id, appt.id));
  await db.insert(crmCustomerNotes).values({
    orgId: org.id, customerId: customer.id, authorMemberId: null,
    body: messageNoteBody("email", customer.email, `Appointment confirmed: ${bidWhen(appt.startsAt, org.timezone)}${address ? ` at ${address}` : ""}.`),
  }).catch((e: any) => console.error("[crm] bid confirmation note failed:", e?.message || e));
  return { sent: true };
}

const bidBody = z.object({
  customerId: z.string().min(1).max(64),
  startsAt: z.string().max(60),
  endsAt: z.string().max(60).nullable().optional(),
  title: z.string().trim().max(200).optional(),
  notes: z.string().max(8000).nullable().optional(),
  /** Who goes out to bid it; the booking member when empty. */
  dispatchedMemberIds: z.array(z.string().max(64)).max(20).optional(),
  /** Email the client a confirmation (default on). */
  sendConfirmation: z.boolean().default(true),
  /** The dialog just created this client: put the lead on the Leads page too. */
  newLead: z.boolean().default(false),
});

export function registerBidScheduleRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (!requirePermission(res, ctx, "manageJobs")) return null;
    return ctx;
  }

  app.post("/api/crm/bids", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const parsed = bidBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Check the bid's details.", issues: parsed.error.issues });
    const body = parsed.data;
    const startsAt = parseTime(body.startsAt);
    if (!startsAt) return res.status(400).json({ message: "Pick when the bid starts." });
    const endsAt = parseTime(body.endsAt);
    if (body.endsAt && !endsAt) return res.status(400).json({ message: "Invalid end time" });
    if (endsAt && endsAt <= startsAt) return res.status(400).json({ message: "The end must be after the start." });

    const [customer] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, body.customerId))).limit(1);
    if (!customer) return res.status(404).json({ message: "Client not found" });

    const crew = [...new Set(body.dispatchedMemberIds?.length ? body.dispatchedMemberIds : [ctx.member.id])];
    const found = await db.select({ id: crmMembers.id }).from(crmMembers)
      .where(and(eq(crmMembers.orgId, ctx.org.id), inArray(crmMembers.id, crew)));
    if (found.length !== crew.length) return res.status(400).json({ message: "Team member not found in this organization" });

    const [appt] = await db.insert(crmAppointments).values({
      orgId: ctx.org.id, customerId: customer.id, kind: BID_KIND,
      title: (body.title || `Bid — ${customer.displayName}`).slice(0, 200),
      notes: body.notes?.trim() || null, startsAt, endsAt,
      dispatchedMemberIds: crew, createdByMemberId: ctx.member.id,
    } as any).returning();

    // The lead that did not exist yet: a client made in the dialog goes on the Leads page, linked to the client.
    if (body.newLead) {
      const [existingLead] = await db.select({ id: crmLeads.id }).from(crmLeads)
        .where(and(eq(crmLeads.orgId, ctx.org.id), eq(crmLeads.customerId, customer.id))).limit(1);
      if (!existingLead) {
        await db.insert(crmLeads).values({
          orgId: ctx.org.id, source: "manual", sourceLabel: "Scheduled bid", name: customer.displayName,
          email: customer.email, phone: customer.phone, addressLine1: customer.addressLine1, city: customer.city,
          state: customer.state, postalCode: customer.postalCode, status: "contacted", customerId: customer.id,
          message: `Bid scheduled for ${bidWhen(startsAt, ctx.org.timezone)}.`,
        } as any).catch((e: any) => console.error("[crm] scheduled-bid lead insert failed:", e?.message || e));
      }
    }

    await logTeamActivity({
      orgId: ctx.org.id, memberId: ctx.member.id, type: "appointmentScheduled",
      title: `scheduled a bid with ${customer.displayName}`, link: `/crm/clients/${customer.id}`,
    });
    logActivity(ctx, "appointment.bid_scheduled", {
      entityType: "appointment", entityId: appt.id, customerId: customer.id,
      meta: { startsAt: appt.startsAt, name: customer.displayName },
    });
    queueCrmEvent(ctx.org.id, "appointment.scheduled", {
      appointmentId: appt.id, title: appt.title, status: appt.status, kind: BID_KIND,
      projectId: null, customerId: customer.id, jobId: null,
      startsAt: appt.startsAt, endsAt: appt.endsAt ?? null, allDay: appt.allDay, completedAt: null,
    });

    let confirmation: { sent: boolean; reason?: string } = { sent: false, reason: "not requested" };
    if (body.sendConfirmation) {
      try { confirmation = await sendBidConfirmation(ctx.org, customer, appt); }
      catch (e: any) {
        console.error("[crm] bid confirmation email failed:", e?.message || e);
        confirmation = { sent: false, reason: "the email could not be sent" };
      }
    }
    res.status(201).json({
      appointment: appt, confirmation,
      reminder: {
        minutes: BID_REMINDER_MINUTES,
        enabled: crmNotificationChannel(ctx.org.customFields, "bidReminder", "sms"),
        texting: !!resolveSmsSender(ctx.org.customFields),
      },
    });
  });

  /** Re-send the client's confirmation (after a reschedule, say). */
  app.post("/api/crm/bids/:id/confirm", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [appt] = await db.select().from(crmAppointments)
      .where(and(eq(crmAppointments.orgId, ctx.org.id), eq(crmAppointments.id, String(req.params.id)))).limit(1);
    if (!appt || !appt.customerId) return res.status(404).json({ message: "Appointment not found" });
    const [customer] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, appt.customerId))).limit(1);
    if (!customer) return res.status(404).json({ message: "Client not found" });
    try {
      const r = await sendBidConfirmation(ctx.org, customer, appt);
      if (!r.sent) return res.status(400).json({ message: `Not sent: ${r.reason}.` });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ message: `The email could not be sent: ${String(e?.message || e).slice(0, 300)}` });
    }
  });

  startBidReminders();
}

// ── The 30-minute reminder ──────────────────────────────────────────────────

/**
 * Claim every bid starting within the next 30 minutes whose reminder has not gone out (one UPDATE … RETURNING, so two
 * processes on one database never both text). A bid booked less than 30 minutes before it starts is skipped: the
 * person who booked it just saw it.
 */
export async function claimDueBidReminders(now = new Date()): Promise<Appointment[]> {
  const until = new Date(now.getTime() + BID_REMINDER_MINUTES * 60_000);
  return db.update(crmAppointments).set({ reminderSentAt: now })
    .where(and(
      eq(crmAppointments.kind, BID_KIND),
      isNull(crmAppointments.reminderSentAt),
      eq(crmAppointments.allDay, false),
      inArray(crmAppointments.status, ["scheduled", "on_my_way"]),
      sql`${crmAppointments.startsAt} > ${now}`,
      sql`${crmAppointments.startsAt} <= ${until}`,
      sql`${crmAppointments.createdAt} <= ${crmAppointments.startsAt} - interval '${sql.raw(String(BID_REMINDER_MINUTES))} minutes'`,
    ))
    .returning();
}

/** The reminder text (pure; the unit test reads it). */
export function bidReminderText(args: {
  orgName: string; customerName: string; startsAt: Date; timezone: string | null | undefined;
  address: string | null; phone: string | null; link: string; now?: Date;
}): string {
  const mins = Math.max(1, Math.round((args.startsAt.getTime() - (args.now ?? new Date()).getTime()) / 60_000));
  const parts = [
    `${args.orgName}: Bid with ${args.customerName} at ${bidTime(args.startsAt, args.timezone)} (in ${mins} min)`,
    args.address ? `— ${args.address}` : null,
    args.phone ? `· ${args.phone}` : null,
  ].filter(Boolean).join(" ");
  return `${parts}. ${args.link}`.slice(0, 320);
}

/** Text (and ring) the member who booked the bid and its crew; the owners when none of them is still on the team. */
export async function remindBid(appt: Appointment): Promise<{ texted: number; reason?: string }> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, appt.orgId)).limit(1);
  if (!org) return { texted: 0, reason: "org gone" };
  const [customer] = appt.customerId
    ? await db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, org.id), eq(crmCustomers.id, appt.customerId))).limit(1)
    : [];
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  const wanted = new Set([appt.createdByMemberId, ...(appt.dispatchedMemberIds ?? [])].filter(Boolean) as string[]);
  let recipients = members.filter((m) => wanted.has(m.id));
  if (!recipients.length) recipients = members.filter((m) => m.role === "owner");

  const name = customer?.displayName || appt.title;
  const link = customer ? `/crm/clients/${customer.id}` : "/crm/schedule";
  const title = `Bid with ${name} at ${bidTime(appt.startsAt, org.timezone)}`;
  const address = customer ? customerAddress(customer) : null;
  const mins = Math.max(1, Math.round((appt.startsAt.getTime() - Date.now()) / 60_000));

  if (crmNotificationChannel(org.customFields, "bidReminder", "inApp") && recipients.length) {
    await db.insert(crmNotifications).values(recipients.map((m) => ({
      orgId: org.id, memberId: m.id, type: "bidReminder", title: title.slice(0, 300),
      body: [`Starts in ${mins} minutes.`, address].filter(Boolean).join(" ").slice(0, 1000), link,
    }))).catch((e: any) => console.error("[crm] bid reminder bell failed:", e?.message || e));
    for (const m of recipients) if (m.userId) pushSoon(m.userId, appForLink(link), { title: `${org.name}: ${title}`, body: address, link });
  }

  if (crmNotificationChannel(org.customFields, "bidReminder", "email")) {
    for (const m of recipients) {
      if (!m.email) continue;
      await sendWithFallback({
        to: m.email, subject: `Reminder: ${title}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
          <p style="font-size:15px"><b>${esc(title)}</b> — starts in ${mins} minutes.</p>
          ${address ? `<p style="font-size:15px">${esc(address)}</p>` : ""}
          <p style="margin:20px 0"><a href="${esc(`${siteBaseUrl(null)}${link}`)}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Open the client</a></p>
          <p style="font-size:12px;color:#999">Turn this off in Settings → Notifications → Bid reminder.</p>
        </div>`,
      } as any).catch((e: any) => console.error("[crm] bid reminder email failed:", e?.message || e));
    }
  }

  if (!crmNotificationChannel(org.customFields, "bidReminder", "sms")) return { texted: 0, reason: "text reminders are off" };
  if (!resolveSmsSender(org.customFields)) return { texted: 0, reason: "texting isn't set up" };
  const numbers = new Set<string>();
  for (const m of recipients) { const p = normalizePhone(m.phone); if (p) numbers.add(p); }
  if (!numbers.size) { const p = normalizePhone(org.phone); if (p) numbers.add(p); }
  if (!numbers.size) return { texted: 0, reason: "nobody has a mobile number on file" };
  const body = bidReminderText({
    orgName: org.name, customerName: name, startsAt: appt.startsAt, timezone: org.timezone, address,
    phone: customer?.phone ?? null, link: `${siteBaseUrl(null)}${link}`,
  });
  let texted = 0;
  for (const to of numbers) {
    const r = await sendSms(to, body, org.customFields, org.id).catch((e: any) => {
      console.error("[crm] bid reminder text failed:", e?.message || e);
      return null;
    });
    if (r?.ok) texted++;
  }
  return { texted };
}

export async function runBidReminders(now = new Date()): Promise<number> {
  const due = await claimDueBidReminders(now);
  for (const appt of due) {
    await remindBid(appt).catch((e: any) => console.error("[crm] bid reminder failed:", e?.message || e));
  }
  return due.length;
}

let started = false;
/** Once per process: every minute, so a reminder lands between 29 and 30 minutes before the bid. */
export function startBidReminders(): void {
  if (started || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  started = true;
  workerInterval("CRM bid reminders", () => runBidReminders(), 60_000, { firstAfterMs: 20_000 });
}
