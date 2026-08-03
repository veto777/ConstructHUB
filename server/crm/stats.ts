/**
 * Home-page numbers and the org-wide Team Activity feed.
 *
 * /api/crm/stats     — the four headline cards (open estimates, jobs won,
 *                      unscheduled jobs, open invoices), count + dollars each.
 * /api/crm/team-activity — "Mike sent a bid", "Andrey moved Job 62 to
 *                      Scheduled": crm_team_activity rows (written at action
 *                      sites) merged with the estimate-event trail and
 *                      succeeded payments. (/api/crm/activity is the client-
 *                      facing inbox feed in schedule.ts — different audience.)
 */
import type { Express } from "express";
import { db } from "../db";
import {
  crmEstimates, crmProjects, crmInvoices, crmPayments, crmCustomers,
  crmMembers, crmEstimateEvents, crmTeamActivity,
  CRM_PROJECT_STAGE_META,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrg } from "./tenancy";

type GetUser = (req: any, res: any) => any;

/** Fire-and-forget team-activity write; never breaks the action it records. */
export async function logTeamActivity(args: {
  orgId: string;
  memberId?: string | null;
  actorLabel?: string | null;
  type: string;
  title: string;
  link?: string | null;
}): Promise<void> {
  try {
    await db.insert(crmTeamActivity).values({
      orgId: args.orgId,
      memberId: args.memberId ?? null,
      actorLabel: args.actorLabel ?? null,
      type: args.type,
      title: args.title.slice(0, 300),
      link: args.link ?? null,
    });
  } catch (e: any) {
    console.error("[crm] team activity log failed:", e?.message || e);
  }
}

export function projectStageLabel(status: string): string {
  return CRM_PROJECT_STAGE_META[status]?.label ?? status;
}

const OPEN_ESTIMATE = ["sent", "viewed"] as const;
const OPEN_INVOICE = ["sent", "partial"] as const;

export function registerCrmStatsRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/crm/stats", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const orgId = ctx.org.id;

    const [openEst] = await db.select({
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(${crmEstimates.totalCents}), 0)::bigint`,
    }).from(crmEstimates).where(and(
      eq(crmEstimates.orgId, orgId),
      inArray(crmEstimates.status, [...OPEN_ESTIMATE]),
    ));

    const [won] = await db.select({
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(coalesce(${crmEstimates.approvedTotalCents}, ${crmEstimates.totalCents})), 0)::bigint`,
    }).from(crmEstimates).where(and(
      eq(crmEstimates.orgId, orgId),
      eq(crmEstimates.status, "approved"),
    ));

    // Sold but not yet on the calendar: the "approved" pipeline stage.
    const [unscheduled] = await db.select({
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(coalesce(${crmProjects.contractValueCents}, 0)), 0)::bigint`,
    }).from(crmProjects).where(and(
      eq(crmProjects.orgId, orgId),
      eq(crmProjects.status, "approved"),
      isNull(crmProjects.archivedAt),
    ));

    const [openInv] = await db.select({
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(${crmInvoices.totalCents} - ${crmInvoices.paidCents}), 0)::bigint`,
    }).from(crmInvoices).where(and(
      eq(crmInvoices.orgId, orgId),
      inArray(crmInvoices.status, [...OPEN_INVOICE]),
    ));

    const num = (r: { count: number; totalCents: unknown }) =>
      ({ count: r.count, totalCents: Number(r.totalCents) });
    res.json({
      openEstimates: num(openEst),
      jobsWon: num(won),
      unscheduledJobs: num(unscheduled),
      openInvoices: num(openInv),
    });
  });

  app.get("/api/crm/team-activity", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const orgId = ctx.org.id;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "40")) || 40));

    const members = await db.select().from(crmMembers).where(eq(crmMembers.orgId, orgId));
    const memberName = (id: string | null | undefined): string | null => {
      if (!id) return null;
      const m = members.find((x) => x.id === id);
      return m ? (m.displayName || m.email || null) : null;
    };

    type Item = { id: string; at: string; actor: string; text: string; link: string | null };
    const items: Item[] = [];
    const money = (c: number) =>
      `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const logged = await db.select().from(crmTeamActivity)
      .where(eq(crmTeamActivity.orgId, orgId))
      .orderBy(desc(crmTeamActivity.createdAt)).limit(limit);
    for (const r of logged) {
      items.push({
        id: `a:${r.id}`,
        at: (r.createdAt ?? new Date()).toISOString(),
        actor: memberName(r.memberId) ?? r.actorLabel ?? "Someone",
        text: r.title,
        link: r.link,
      });
    }

    const events = await db.select({
      id: crmEstimateEvents.id,
      type: crmEstimateEvents.type,
      actor: crmEstimateEvents.actor,
      createdAt: crmEstimateEvents.createdAt,
      meta: crmEstimateEvents.meta,
      estNumber: crmEstimates.number,
      customerId: crmEstimates.customerId,
      custName: crmCustomers.displayName,
    }).from(crmEstimateEvents)
      .innerJoin(crmEstimates, eq(crmEstimateEvents.estimateId, crmEstimates.id))
      .innerJoin(crmCustomers, eq(crmEstimates.customerId, crmCustomers.id))
      .where(eq(crmEstimateEvents.orgId, orgId))
      .orderBy(desc(crmEstimateEvents.createdAt)).limit(limit * 2);
    for (const e of events) {
      const ref = e.estNumber ? `estimate ${e.estNumber}` : "an estimate";
      const member = memberName(e.actor);
      const link = `/crm/clients/${e.customerId}`;
      const at = (e.createdAt ?? new Date()).toISOString();
      // The team feed carries the wins and the touches; security noise
      // (denied gates, forward detection) stays on the client timeline.
      if (e.type === "sent") {
        items.push({ id: `e:${e.id}`, at, actor: member ?? "A teammate", text: `sent ${ref} to ${e.custName}`, link });
      } else if (e.type === "viewed") {
        items.push({ id: `e:${e.id}`, at, actor: e.custName, text: `opened ${ref}`, link });
      } else if (e.type === "approved") {
        items.push({ id: `e:${e.id}`, at, actor: e.custName, text: `approved (signed) ${ref} 🎉`, link });
      } else if (e.type === "declined") {
        items.push({ id: `e:${e.id}`, at, actor: e.custName, text: `declined ${ref}`, link });
      } else if (e.type === "shared") {
        const w = (e.meta as any)?.sharedWith;
        items.push({ id: `e:${e.id}`, at, actor: e.custName, text: `shared ${ref}${w ? ` with ${w}` : ""}`, link });
      }
    }

    const pays = await db.select({
      id: crmPayments.id,
      amountCents: crmPayments.amountCents,
      method: crmPayments.method,
      createdAt: crmPayments.createdAt,
      customerId: crmPayments.customerId,
      custName: crmCustomers.displayName,
    }).from(crmPayments)
      .innerJoin(crmCustomers, eq(crmPayments.customerId, crmCustomers.id))
      .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.status, "succeeded")))
      .orderBy(desc(crmPayments.createdAt)).limit(limit);
    for (const p of pays) {
      items.push({
        id: `p:${p.id}`,
        at: (p.createdAt ?? new Date()).toISOString(),
        actor: p.custName,
        text: `paid ${money(p.amountCents)}${p.method ? ` by ${p.method.toUpperCase()}` : ""}`,
        link: `/crm/clients/${p.customerId}`,
      });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ activity: items.slice(0, limit) });
  });
}
