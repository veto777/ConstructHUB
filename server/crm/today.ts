/**
 * "Today" — the work queue.
 *
 * The gap this fills: every screen in the CRM (and in Housecall Pro and Leap)
 * shows you *state* — lists of projects, estimates, invoices. None of them
 * answer the only question a contractor actually opens the app with: **what
 * needs me right now, and why?**
 *
 * This computes that server-side so the answer is identical on desktop and
 * mobile, and so "why now" is a fact rather than a UI guess. Every item carries
 * a reason, an age, a deep link, and a money figure where one exists.
 *
 * Permission rules are the same as everywhere else: money is stripped without
 * seePrices, and a member without viewAllJobs only sees their own work.
 */
import type { Express } from "express";
import { db } from "../db";
import {
  crmEstimates, crmInvoices, crmProjects, crmCustomers, crmAppointments,
  crmDailyLogs, crmPunchItems, crmChangeOrders, crmBudgetLines, crmCostEntries,
} from "@shared/schema";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { requireOrg, type OrgContext } from "./tenancy";

type GetUser = (req: any, res: any) => any;

const DAY = 86_400_000;
const daysSince = (d?: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / DAY) : null);

export type TodayItem = {
  id: string;
  kind: string;
  /** How loudly this should shout. Drives ordering and colour. */
  urgency: "now" | "soon" | "watch";
  title: string;
  /** The specific fact that put this on the list — never a vague label. */
  reason: string;
  ageDays: number | null;
  amountCents?: number;
  href: string;
  /** The single action that clears it, phrased as a verb. */
  action: string;
};

const RANK: Record<TodayItem["urgency"], number> = { now: 0, soon: 1, watch: 2 };

export function registerCrmTodayRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/crm/today", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx: OrgContext | null = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const org = ctx.org.id;
    const money = ctx.permissions.seePrices;
    const mine = !ctx.permissions.viewAllJobs;
    const items: TodayItem[] = [];

    const [projects, estimates, invoices, appts, logs, punch, changeOrders, customers] =
      await Promise.all([
        db.select().from(crmProjects).where(and(eq(crmProjects.orgId, org), isNull(crmProjects.archivedAt))),
        db.select().from(crmEstimates).where(eq(crmEstimates.orgId, org)),
        db.select().from(crmInvoices).where(eq(crmInvoices.orgId, org)),
        db.select().from(crmAppointments).where(eq(crmAppointments.orgId, org)),
        db.select().from(crmDailyLogs).where(eq(crmDailyLogs.orgId, org)),
        db.select().from(crmPunchItems).where(eq(crmPunchItems.orgId, org)),
        db.select().from(crmChangeOrders).where(eq(crmChangeOrders.orgId, org)),
        db.select().from(crmCustomers).where(eq(crmCustomers.orgId, org)),
      ]);

    const custName = new Map(customers.map((c) => [c.id, c.displayName]));
    const projById = new Map(projects.map((p) => [p.id, p]));
    const visibleProject = (id?: string | null) =>
      !mine || (id ? projById.get(id)?.projectManagerMemberId === ctx.member.id : false);

    // ── Estimates ────────────────────────────────────────────────────────────
    for (const e of estimates) {
      if (e.approvedAt || e.declinedAt || !e.sentAt) continue;
      if (mine && !visibleProject(e.projectId)) continue;
      const who = custName.get(e.customerId) ?? "a client";
      const sentAge = daysSince(e.sentAt);
      const expiresIn = e.expiresAt ? Math.ceil((e.expiresAt.getTime() - Date.now()) / DAY) : null;

      if (expiresIn !== null && expiresIn <= 0) {
        items.push({
          id: `est-exp-${e.id}`, kind: "estimate", urgency: "now",
          title: `${who} — ${e.title}`,
          reason: "Expired without an answer. Re-issue it or let it go.",
          ageDays: sentAge, amountCents: money ? e.totalCents : undefined,
          href: `/crm/clients/${e.customerId}`, action: "Re-issue",
        });
      } else if (e.firstViewedAt) {
        // Opened but silent is the hottest lead in the business — they were
        // interested enough to look and something stopped them.
        const seen = daysSince(e.firstViewedAt) ?? 0;
        if (seen >= 2) {
          items.push({
            id: `est-seen-${e.id}`, kind: "estimate", urgency: seen >= 5 ? "now" : "soon",
            title: `${who} — ${e.title}`,
            reason: `Opened it ${seen === 0 ? "today" : `${seen} day${seen === 1 ? "" : "s"} ago`}${
              e.viewCount > 1 ? ` and came back ${e.viewCount} times` : ""
            }, still no answer.`,
            ageDays: seen, amountCents: money ? e.totalCents : undefined,
            href: `/crm/clients/${e.customerId}`, action: "Call them",
          });
        }
      } else if ((sentAge ?? 0) >= 2) {
        items.push({
          id: `est-unseen-${e.id}`, kind: "estimate", urgency: (sentAge ?? 0) >= 6 ? "soon" : "watch",
          title: `${who} — ${e.title}`,
          reason: `Sent ${sentAge} days ago and never opened. Check the email landed.`,
          ageDays: sentAge, amountCents: money ? e.totalCents : undefined,
          href: `/crm/clients/${e.customerId}`, action: "Resend",
        });
      } else if (expiresIn !== null && expiresIn <= 2) {
        items.push({
          id: `est-exp-soon-${e.id}`, kind: "estimate", urgency: "soon",
          title: `${who} — ${e.title}`,
          reason: `Expires in ${expiresIn} day${expiresIn === 1 ? "" : "s"}.`,
          ageDays: sentAge, amountCents: money ? e.totalCents : undefined,
          href: `/crm/clients/${e.customerId}`, action: "Follow up",
        });
      }
    }

    // ── Won work that nobody has scheduled ───────────────────────────────────
    const apptByProject = new Set(appts.filter((a) => a.status !== "canceled").map((a) => a.projectId));
    for (const p of projects) {
      if (mine && p.projectManagerMemberId !== ctx.member.id) continue;
      if (p.status !== "approved") continue;
      if (apptByProject.has(p.id)) continue;
      const age = daysSince(p.stageChangedAt);
      items.push({
        id: `proj-unsched-${p.id}`, kind: "project", urgency: (age ?? 0) >= 3 ? "now" : "soon",
        title: p.name,
        reason: `Approved ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`} and still has no date on the calendar.`,
        ageDays: age, amountCents: money ? (p.contractValueCents ?? undefined) : undefined,
        href: `/crm/projects/${p.id}`, action: "Schedule it",
      });
    }

    // ── Live jobs going quiet ────────────────────────────────────────────────
    const lastLog = new Map<string, Date>();
    for (const l of logs) {
      const cur = lastLog.get(l.projectId);
      if (!cur || (l.logDate && l.logDate > cur)) lastLog.set(l.projectId, l.logDate!);
    }
    for (const p of projects) {
      if (mine && p.projectManagerMemberId !== ctx.member.id) continue;
      if (p.status !== "in_progress") continue;
      const since = daysSince(lastLog.get(p.id) ?? p.stageChangedAt);
      if ((since ?? 0) >= 3) {
        items.push({
          id: `proj-quiet-${p.id}`, kind: "project", urgency: "watch",
          title: p.name,
          reason: `In progress but no daily log for ${since} days. Is it actually moving?`,
          ageDays: since, href: `/crm/projects/${p.id}`, action: "Log the day",
        });
      }
    }

    // ── Money out the door ───────────────────────────────────────────────────
    for (const inv of invoices) {
      if (inv.voidedAt || inv.paidAt) continue;
      if (mine && !visibleProject(inv.projectId)) continue;
      const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
      if (due <= 0) continue;
      const who = custName.get(inv.customerId) ?? "a client";
      const overdue = inv.dueAt ? Math.floor((Date.now() - inv.dueAt.getTime()) / DAY) : null;
      if (overdue !== null && overdue > 0) {
        items.push({
          id: `inv-late-${inv.id}`, kind: "invoice", urgency: overdue >= 14 ? "now" : "soon",
          title: `${who} — ${inv.number ?? "invoice"}`,
          reason: `${overdue} day${overdue === 1 ? "" : "s"} overdue.`,
          ageDays: overdue, amountCents: money ? due : undefined,
          href: `/crm/clients/${inv.customerId}`, action: "Chase payment",
        });
      } else if (!inv.sentAt) {
        items.push({
          id: `inv-draft-${inv.id}`, kind: "invoice", urgency: "soon",
          title: `${who} — ${inv.number ?? "invoice"}`,
          reason: "Invoice is still a draft. Nobody has been asked to pay it.",
          ageDays: daysSince(inv.createdAt), amountCents: money ? due : undefined,
          href: `/crm/clients/${inv.customerId}`, action: "Send it",
        });
      }
    }

    // ── Change orders sitting unsigned ───────────────────────────────────────
    for (const co of changeOrders) {
      if (co.approvedAt || co.declinedAt || !co.sentAt) continue;
      if (mine && !visibleProject(co.projectId)) continue;
      const age = daysSince(co.sentAt);
      if ((age ?? 0) < 2) continue;
      items.push({
        id: `co-${co.id}`, kind: "change_order", urgency: (age ?? 0) >= 5 ? "now" : "soon",
        title: `${co.number ?? "Change order"} — ${co.title}`,
        reason: `Unsigned for ${age} days. Work may be running ahead of the paperwork.`,
        ageDays: age, amountCents: money ? co.amountCents : undefined,
        href: `/crm/projects/${co.projectId}`, action: "Chase signature",
      });
    }

    // ── Jobs bleeding margin (cost side only) ────────────────────────────────
    if (ctx.permissions.seeCosts) {
      const [budgets, actuals] = await Promise.all([
        db.select().from(crmBudgetLines).where(eq(crmBudgetLines.orgId, org)),
        db.select().from(crmCostEntries).where(eq(crmCostEntries.orgId, org)),
      ]);
      const budgetBy = new Map<string, number>();
      for (const b of budgets) budgetBy.set(b.projectId, (budgetBy.get(b.projectId) ?? 0) + b.budgetCents);
      const actualBy = new Map<string, number>();
      for (const a of actuals) actualBy.set(a.projectId, (actualBy.get(a.projectId) ?? 0) + a.amountCents);
      for (const [pid, budget] of budgetBy) {
        if (budget <= 0) continue;
        const spent = actualBy.get(pid) ?? 0;
        const p = projById.get(pid);
        if (!p || p.status === "paid" || p.status === "cancelled") continue;
        if (mine && p.projectManagerMemberId !== ctx.member.id) continue;
        const pct = Math.round((spent / budget) * 100);
        if (pct >= 90) {
          items.push({
            id: `budget-${pid}`, kind: "budget", urgency: pct >= 100 ? "now" : "soon",
            title: p.name,
            reason: pct >= 100
              ? `Over budget — ${pct}% of the estimate is already spent.`
              : `${pct}% of budget spent and the job isn't closed.`,
            ageDays: null, amountCents: spent - budget > 0 ? spent - budget : undefined,
            href: `/crm/projects/${pid}`, action: "Review costs",
          });
        }
      }
    }

    // ── Punch list blocking closeout ─────────────────────────────────────────
    const openPunch = new Map<string, number>();
    for (const pi of punch) {
      if (pi.status === "done" || pi.status === "wont_fix") continue;
      openPunch.set(pi.projectId, (openPunch.get(pi.projectId) ?? 0) + 1);
    }
    for (const [pid, n] of openPunch) {
      const p = projById.get(pid);
      if (!p || !["complete", "punch_list", "invoiced"].includes(p.status)) continue;
      if (mine && p.projectManagerMemberId !== ctx.member.id) continue;
      items.push({
        id: `punch-${pid}`, kind: "punch", urgency: "watch",
        title: p.name,
        reason: `${n} punch item${n === 1 ? "" : "s"} still open — this is what stops final payment.`,
        ageDays: null, href: `/crm/projects/${pid}`, action: "Close them out",
      });
    }

    items.sort((a, b) =>
      RANK[a.urgency] - RANK[b.urgency] ||
      (b.amountCents ?? 0) - (a.amountCents ?? 0) ||
      (b.ageDays ?? 0) - (a.ageDays ?? 0));

    // A queue of 300 items is not a queue, it's a second inbox. Cap what we
    // send and roll the tail up by kind, so a busy contractor still gets a
    // finite list of "do these now" plus an honest count of what's behind it.
    // Ordering already put the biggest money and the oldest items on top.
    const CAP = 40;
    const shown = items.slice(0, CAP);
    const rest = items.slice(CAP);
    const rollup = Object.values(
      rest.reduce((acc: Record<string, any>, i) => {
        const k = `${i.kind}:${i.urgency}`;
        acc[k] ??= { kind: i.kind, urgency: i.urgency, count: 0, totalCents: 0 };
        acc[k].count++;
        acc[k].totalCents += i.amountCents ?? 0;
        return acc;
      }, {}),
    ).sort((a: any, b: any) => RANK[a.urgency as TodayItem["urgency"]] - RANK[b.urgency as TodayItem["urgency"]] || b.count - a.count);

    res.json({
      items: shown,
      truncated: rest.length,
      rollup: money ? rollup : rollup.map((r: any) => ({ ...r, totalCents: undefined })),
      counts: {
        now: items.filter((i) => i.urgency === "now").length,
        soon: items.filter((i) => i.urgency === "soon").length,
        watch: items.filter((i) => i.urgency === "watch").length,
      },
      // Money genuinely at risk right now: unanswered estimates + unpaid invoices.
      atRiskCents: money
        ? items.filter((i) => i.kind === "estimate" || i.kind === "invoice")
               .reduce((s, i) => s + (i.amountCents ?? 0), 0)
        : undefined,
      generatedAt: new Date().toISOString(),
    });
  });
}
