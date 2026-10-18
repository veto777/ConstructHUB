/**
 * The job flow on the server (shared/job-flow.ts): the account's phases, and the alerts a phase sends the moment a
 * job ENTERS it — by hand on the tracker (PATCH /api/crm/projects/:id with a status or a stageKey), at creation, or
 * by an automatic move (server/crm/job-stage-auto.ts). Every entry point calls `enterPhase`.
 *
 * Once per project per phase: a crm_stage_alerts row (unique on project + phase) is claimed before anything is sent,
 * so a job that bounces back and forth never alerts the client twice for the same phase.
 *
 * Routing:
 *   client / email → deliverQuickMessage through the org's sender (reply-to the company), noted on the client timeline
 *   client / sms   → deliverQuickMessage → sendSms (STOP opt-outs, the plan's allowance, the org's own texting number);
 *                    skipped with a reason when the client has no phone, replied STOP, or texting isn't set up
 *   staff / email  → sendWithFallback to the member's email (the PM, the sales rep, the owner(s) or one named member)
 *   staff / sms    → sendSms to the member's mobile through the org's sender (skipped when texting isn't set up)
 *   staff / both   → an in-app bell row + iPhone push as well, like every other staff notification
 * A PM or sales alert with nobody in that seat goes to the owner(s) instead (named in the log).
 *
 * Every send and every skip is one crm_activity_log row ("project.phase_alert", actor "System") with the phase, the
 * channel, the recipient and the reason, so the client timeline and the member audit tell the whole story.
 * Nothing here ever throws into the route that moved the job.
 */
import { db } from "../db";
import { crmCustomerNotes, crmCustomers, crmMembers, crmNotifications, crmOrgs, crmProjects, crmStageAlerts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { normalizeJobFlow, phaseOf, renderPhaseTemplate, type FlowAlert, type JobFlow } from "@shared/job-flow";
import { recordActivity } from "./activity";
import { deliverQuickMessage, messageNoteBody } from "./messages";
import { CLIENT_TEXT_NEEDS_OWN_NUMBER, isSmsOptedOut, normalizePhone, orgCanTextClients, orgSmsEntitled, resolveSmsSender, sendSms } from "./sms";
import { sendWithFallback } from "../email";
import { appForLink, pushSoon } from "../apns";
import { siteBaseUrl } from "../site-context";
import type { StageActor } from "./job-stage-auto";

type Org = typeof crmOrgs.$inferSelect;
type Project = typeof crmProjects.$inferSelect;
type Member = typeof crmMembers.$inferSelect;

export const SYSTEM_ACTOR: StageActor = { memberId: null, label: "System" };

export const jobFlowOf = (orgCustomFields: unknown): JobFlow =>
  normalizeJobFlow((orgCustomFields as Record<string, unknown> | null | undefined)?.jobFlow);

export async function loadJobFlow(orgId: string): Promise<JobFlow> {
  const [org] = await db.select({ customFields: crmOrgs.customFields }).from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  return jobFlowOf(org?.customFields);
}

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

/** "Oct 18, 2026" in the company's time zone. */
function todayIn(timezone: string | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  try { return new Date().toLocaleDateString("en-US", { ...opts, timeZone: timezone || undefined }); }
  catch { return new Date().toLocaleDateString("en-US", opts); }
}

type Outcome = { result: "sent" | "skipped"; recipient: string | null; reason?: string; provider?: string };

/** The staff an alert addresses: the seat holder, else the owner(s); named for the log. */
function staffFor(alert: FlowAlert, project: Project, org: Org, members: Member[]): { who: Member[]; seat: string; fellBack: boolean } {
  const byId = (id: string | null | undefined) => (id ? members.find((m) => m.id === id) ?? null : null);
  // Every active owner, the account owner first.
  const owners = () => members.filter((m) => m.role === "owner").sort((a, b) => Number(b.userId === org.ownerUserId) - Number(a.userId === org.ownerUserId));
  const staff = alert.staff ?? "pm";
  if (staff === "owner") return { who: owners(), seat: "owner", fellBack: false };
  if (staff === "pm") {
    const pm = byId(project.projectManagerMemberId) ?? byId(project.salesMemberId);
    return pm ? { who: [pm], seat: "project manager", fellBack: false } : { who: owners(), seat: "project manager", fellBack: true };
  }
  if (staff === "sales") {
    const rep = byId(project.salesMemberId);
    return rep ? { who: [rep], seat: "sales rep", fellBack: false } : { who: owners(), seat: "sales rep", fellBack: true };
  }
  const one = byId(staff);
  return one ? { who: [one], seat: one.displayName || one.email, fellBack: false } : { who: [], seat: "a team member who is no longer active", fellBack: false };
}

const memberName = (m: Member) => m.displayName || m.email;

/**
 * A job entered `phaseKey`: send that phase's alerts (once per project per phase) and log each one. `org` saves a
 * query when the caller has it. Returns what happened, mostly for tests; never throws.
 */
export async function enterPhase(args: {
  orgId: string; project: Project; phaseKey: string | null | undefined;
  /** "manual", "created", or the automatic trigger ("estimate.sent", "appointment", …). */
  trigger: string;
  org?: Org | null;
}): Promise<Outcome[]> {
  const out: Outcome[] = [];
  try {
    if (!args.phaseKey) return out;
    const org = args.org ?? (await db.select().from(crmOrgs).where(eq(crmOrgs.id, args.orgId)).limit(1))[0];
    if (!org) return out;
    const flow = jobFlowOf(org.customFields);
    const phase = phaseOf(flow, args.phaseKey);
    if (!phase || !phase.alerts.length) return out;

    // Claim the (project, phase) slot first: the unique index makes a second entry a no-op.
    const claimed = await db.insert(crmStageAlerts).values({ orgId: args.orgId, projectId: args.project.id, phaseKey: phase.key })
      .onConflictDoNothing().returning({ id: crmStageAlerts.id });
    if (!claimed.length) return out;

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, args.orgId), eq(crmCustomers.id, args.project.customerId))).limit(1);
    if (!cust) return out;
    const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, args.orgId), eq(crmMembers.status, "active")));
    const vars = {
      client: cust.displayName, first: cust.firstName?.trim() || cust.displayName.split(/\s+/)[0],
      job: args.project.name?.trim() || "job", phase: phase.label, company: org.name, date: todayIn(org.timezone),
    };
    const link = `/crm/clients/${cust.id}`;

    for (const alert of phase.alerts) {
      const body = renderPhaseTemplate(alert.template, vars);
      const log = (o: Outcome) => {
        out.push(o);
        recordActivity({
          orgId: args.orgId, actorMemberId: null, actorLabel: SYSTEM_ACTOR.label, action: "project.phase_alert",
          entityType: "project", entityId: args.project.id, customerId: cust.id,
          meta: {
            name: args.project.name, number: args.project.number, phase: phase.key, phaseLabel: phase.label, trigger: args.trigger,
            to: alert.to, staff: alert.to === "staff" ? alert.staff ?? "pm" : undefined, channel: alert.channel,
            recipient: o.recipient, result: o.result, reason: o.reason, provider: o.provider, preview: body.slice(0, 200),
          },
        });
      };
      try {
        if (alert.to === "client") log(await alertClient(org, cust, alert, body));
        else {
          const { who, seat, fellBack } = staffFor(alert, args.project, org, members);
          if (!who.length) { log({ result: "skipped", recipient: null, reason: `nobody to send to (${seat})` }); continue; }
          for (const m of who) {
            const o = await alertStaff(org, m, alert, body, `${vars.client}'s ${vars.job} — ${phase.label}`, link);
            log(fellBack ? { ...o, reason: [`no ${seat} on the job — sent to the owner`, o.reason].filter(Boolean).join("; ") } : o);
          }
        }
      } catch (e: any) {
        log({ result: "skipped", recipient: null, reason: String(e?.message || e).slice(0, 200) });
      }
    }
  } catch (e: any) {
    console.error("[crm] phase alerts failed:", e?.message || e);
  }
  return out;
}

async function alertClient(org: Org, cust: typeof crmCustomers.$inferSelect, alert: FlowAlert, body: string): Promise<Outcome> {
  if (alert.channel === "email") {
    if (!cust.email) return { result: "skipped", recipient: null, reason: "the client has no email address" };
    await deliverQuickMessage({ channel: "email", to: cust.email, body, orgName: org.name, replyTo: org.email || undefined, orgCustomFields: org.customFields, orgId: org.id });
    await noteOnTimeline(org.id, cust.id, "email", cust.email, body);
    return { result: "sent", recipient: cust.email, provider: "email" };
  }
  const phone = normalizePhone(cust.phone);
  if (!phone) return { result: "skipped", recipient: null, reason: "the client has no phone number" };
  // The same honesty the Message composer has: a STOP, no plan, no sender or no own number is a skip, never a pretend.
  if (await isSmsOptedOut(org.id, phone).catch(() => false)) return { result: "skipped", recipient: phone, reason: "the client replied STOP (opted out of texts)" };
  const sender = resolveSmsSender(org.customFields);
  if (!sender) return { result: "skipped", recipient: phone, reason: "texting isn't set up (Settings → Integrations)" };
  if (!(await orgSmsEntitled(org.id))) return { result: "skipped", recipient: phone, reason: "the plan does not include texting" };
  if (!orgCanTextClients(org.customFields)) return { result: "skipped", recipient: phone, reason: CLIENT_TEXT_NEEDS_OWN_NUMBER };
  const r = await deliverQuickMessage({ channel: "text", to: phone, body, orgName: org.name, orgCustomFields: org.customFields, orgId: org.id });
  if (!r.ok) return { result: "skipped", recipient: phone, reason: r.error ?? (r.limit ? "the month's text allowance is spent" : "the text could not be sent"), provider: r.provider };
  await noteOnTimeline(org.id, cust.id, "text", phone, body);
  return { result: "sent", recipient: phone, provider: r.provider };
}

/** The client timeline shows the message like one sent from the composer (no author = the system). */
async function noteOnTimeline(orgId: string, customerId: string, channel: "email" | "text", to: string, body: string) {
  await db.insert(crmCustomerNotes).values({ orgId, customerId, authorMemberId: null, body: messageNoteBody(channel, to, body) })
    .catch((e: any) => console.error("[crm] phase alert note failed:", e?.message || e));
}

async function alertStaff(org: Org, m: Member, alert: FlowAlert, body: string, title: string, link: string): Promise<Outcome> {
  // The bell + iPhone push go along with either channel.
  await db.insert(crmNotifications).values({ orgId: org.id, memberId: m.id, type: "jobPhase", title: title.slice(0, 300), body: body.slice(0, 1000), link })
    .catch((e: any) => console.error("[crm] phase notification insert failed:", e?.message || e));
  if (m.userId) pushSoon(m.userId, appForLink(link), { title: `${org.name}: ${title}`, body, link });

  if (alert.channel === "email") {
    if (!m.email) return { result: "skipped", recipient: memberName(m), reason: `${memberName(m)} has no email address` };
    await sendWithFallback({
      to: m.email, subject: `${org.name}: ${title}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
        <p style="font-size:15px;white-space:pre-wrap">${esc(body)}</p>
        <p style="margin:20px 0"><a href="${esc(`${siteBaseUrl(null)}${link}`)}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Open the client in the CRM</a></p>
        <p style="font-size:12px;color:#999">Sent by ${esc(org.name)}'s job flow (Settings → Job flow).</p>
      </div>`,
    } as any);
    return { result: "sent", recipient: m.email, provider: "email" };
  }
  const phone = normalizePhone(m.phone);
  if (!phone) return { result: "skipped", recipient: memberName(m), reason: `${memberName(m)} has no mobile number on their profile` };
  if (!resolveSmsSender(org.customFields)) return { result: "skipped", recipient: phone, reason: "texting isn't set up (Settings → Integrations)" };
  const r = await sendSms(phone, `${org.name}: ${body}`.slice(0, 320), org.customFields, org.id);
  if (!r.ok) return { result: "skipped", recipient: phone, reason: r.error ?? "the text could not be sent", provider: r.provider };
  return { result: "sent", recipient: phone, provider: r.provider };
}
