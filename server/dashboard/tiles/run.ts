/**
 * Run the business: the CRM snapshot, schedule, leads & follow-ups, texting
 * and the Agency workspace. CRM tiles read the ACTIVE org (ctx.crm, a
 * read-only lookup) through the same permission, division and object-policy
 * rules as the CRM's own endpoints — reusing those endpoints' functions
 * (crmStatsFor, crmAttentionFor, objectPolicy, orgSmsStatus). SPEC §3.4–3.5.
 */
import { and, gte, lt, ne, eq } from "drizzle-orm";
import { db } from "../../db";
import { crmAppointments } from "@shared/schema";
import { formatUsd } from "@shared/plan-copy";
import { crmStatsFor } from "../../crm/stats";
import { crmAttentionFor } from "../../crm/follow-ups";
import { objectPolicy } from "../../crm/object-access";
import { orgSmsStatus, SMS_NEEDS_PLAN, SMS_REQUIRED_PLAN } from "../../crm/sms";
import type { OrgContext } from "../../crm/tenancy";
import { dq } from "../pool";
import { int, metric, ok, watch, type TileOutcome, type TileSources } from "./types";

const DAY = 86_400_000;
/** Open prospect projects the leads tile reads (the CRM's own Needs-attention card reads 200). */
const LEAD_ROWS = 5000; // audit lane 1 F: 1,000 hid ~600 of a real account's 1,257 open leads

/** No CRM org yet: the gateway sets one up (the dashboard never creates it). */
const NO_ORG: TileOutcome = {
  status: "empty",
  message: "Your CRM is included with your plan.",
  cta: { label: "Set up the CRM", href: "/crm-app", surface: "app" },
};

/** Midnight UTC on `d`'s UTC calendar (the clock CRM `timestamp` columns keep). */
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The org clock's offset from UTC at `at`, in ms (positive east of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at.getTime();
}

/**
 * Midnight of the ORG's own calendar day containing `d`, as a UTC wall Date.
 * Appointments are booked and the schedule page is numbered by the local
 * clock, so "Today" must be the org timezone's day, not UTC's: at 6pm in
 * Los Angeles a UTC "today" already counts tomorrow morning's visits and has
 * dropped this evening's. Falls back to the UTC day when the org has no
 * usable timezone.
 */
export function startOfOrgDay(d: Date, timeZone: string | null | undefined): Date {
  const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone : null;
  if (!tz) return startOfUtcDay(d);
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return startOfUtcDay(d); }
  const reading = new Date(d.getTime() + offsetMs(d, tz)); // what the org clock reads at `d`
  const midnight = Date.UTC(reading.getUTCFullYear(), reading.getUTCMonth(), reading.getUTCDate());
  return new Date(midnight - offsetMs(new Date(midnight), tz));
}

/** The member's visible, not-cancelled appointments starting in [from, to). */
async function visibleAppointments(crm: OrgContext, from: Date, to: Date, ownOnly: boolean) {
  const rows = await db.select().from(crmAppointments).where(and(
    eq(crmAppointments.orgId, crm.org.id),
    ne(crmAppointments.status, "canceled"),
    gte(crmAppointments.startsAt, from),
    lt(crmAppointments.startsAt, to),
  )).limit(2000);
  if (ownOnly) {
    const me = crm.member.id;
    return rows.filter((a) => a.createdByMemberId === me || (a.dispatchedMemberIds ?? []).includes(me));
  }
  // Same rule as GET /api/crm/schedule: the object policy (division scope, and
  // a crew seat without viewAllJobs sees only visits it booked or is dispatched to).
  return objectPolicy(crm).filter("appointments", rows);
}

const openCrm = { label: "Open the CRM", href: "/crm", surface: "portal" as const };

export const runTiles: TileSources = {
  /** Only reached when the add-on module is on (tileAccess): a link into the CRM's Call Assistant. */
  callAssistant: async () => ok([], { label: "Open Call Assistant", href: "/call-assistant", surface: "app" }),
  async crm(ctx) {
    const crm = ctx.crm;
    if (!crm) return NO_ORG;
    if (!crm.permissions.seeReporting) {
      // Not a reporting seat: no org money, just their own day.
      const today = startOfOrgDay(ctx.now, crm.org.timezone);
      const visits = await visibleAppointments(crm, today, new Date(today.getTime() + DAY), true);
      return ok([metric("todayVisits", "Today's visits", visits.length, "count")], openCrm);
    }
    const s = await crmStatsFor(crm);
    return ok([
      metric("pipeline", "Pipeline value", s.openPipeline.totalCents, "cents", { hint: `${s.openPipeline.count.toLocaleString("en-US")} open project${s.openPipeline.count === 1 ? "" : "s"}` }),
      metric("openEstimates", "Open estimates", s.openEstimates.count, "count", { hint: `${formatUsd(s.openEstimates.totalCents)} quoted` }),
      metric("jobsWon", "Jobs won", s.jobsWon.count, "count", { hint: `${formatUsd(s.jobsWon.totalCents)} approved`, tone: s.jobsWon.count ? "good" : undefined }),
      metric("openInvoices", "Open invoices", s.openInvoices.count, "count", { hint: `${formatUsd(s.openInvoices.totalCents)} due` }),
      metric("unscheduled", "Sold, not scheduled", s.unscheduledJobs.count, "count", { tone: watch(s.unscheduledJobs.count) }),
      metric("clients", "Active clients", s.clients.count, "count"),
    ], openCrm);
  },

  async crmSchedule(ctx) {
    const crm = ctx.crm;
    if (!crm) return NO_ORG;
    const today = startOfOrgDay(ctx.now, crm.org.timezone);
    const visits = await visibleAppointments(crm, today, new Date(today.getTime() + 7 * DAY), false);
    const tomorrow = today.getTime() + DAY;
    return ok([
      metric("today", "Today", visits.filter((a) => a.startsAt.getTime() < tomorrow).length, "count"),
      metric("week", "Next 7 days", visits.length, "count"),
    ]);
  },

  async crmLeads(ctx) {
    const crm = ctx.crm;
    if (!crm) return NO_ORG;
    const a = await crmAttentionFor(crm, { cap: Infinity, rowLimit: LEAD_ROWS });
    const weekAgo = ctx.now.getTime() - 7 * DAY;
    const newLeads = a.newLeads.filter((l) => (l.createdAt?.getTime() ?? 0) >= weekAgo).length;
    // Past LEAD_ROWS open leads the lists are the newest ones only: say so instead of implying a total.
    const partial = a.truncated ? { hint: `newest ${LEAD_ROWS.toLocaleString("en-US")} leads counted` } : {};
    return ok([
      metric("newLeads7d", "New leads (7 days)", newLeads, "count", { tone: newLeads ? "good" : undefined, ...partial }),
      metric("followUpsDue", "Follow-ups due", a.followUpsDue.length, "count", { tone: watch(a.followUpsDue.length) }),
      metric("needEstimate", "Leads without an estimate", a.leadsNeedingEstimate.length, "count", { tone: watch(a.leadsNeedingEstimate.length), ...partial }),
    ]);
  },

  async texting(ctx) {
    const crm = ctx.crm;
    // No org: the gate let this through only on a plan with texting, so the CRM comes first.
    if (!crm) return NO_ORG;
    const [sms, usage] = await Promise.all([orgSmsStatus(crm.org), ctx.usage()]);
    // Texting follows the org OWNER's plan (orgSmsEntitled), not this seat's own:
    // a crew seat in a texting org is in, an owner on a plan without texting is not.
    if (!sms.planAllowsSms) return { status: "locked", requiredPlan: SMS_REQUIRED_PLAN, message: SMS_NEEDS_PLAN };
    const metrics = [metric("clientTexting", "Client texting", sms.canTextClients ? "On" : "Off", "text", { tone: sms.canTextClients ? "good" : undefined })];
    // Texts are metered on the org owner's allowance: show the count only when that's this account.
    if (crm.org.ownerUserId === ctx.userId) {
      metrics.push(metric("segments", "Texts used", usage.texts.used, "count", { limit: usage.texts.limit, hint: "this month" }));
    }
    return ok(metrics);
  },

  async agency(ctx) {
    const [[r], locations] = await Promise.all([
      dq(`SELECT (SELECT count(*)::int FROM agency_clients WHERE user_id=$1) clients,
                 (SELECT count(*)::int FROM agency_members WHERE user_id=$1) members`, [ctx.userId]),
      ctx.locations(),
    ]);
    if (!int(r.clients) && !int(r.members)) return { status: "empty" };
    return ok([
      metric("clients", "Clients", int(r.clients), "count"),
      metric("teammates", "Teammates", int(r.members), "count"),
      metric("locations", "Locations", locations, "count", { limit: ctx.ent.allowances?.locations }),
    ]);
  },
};
