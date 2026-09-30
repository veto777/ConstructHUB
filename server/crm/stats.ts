/**
 * Home-page numbers and the org-wide Team Activity feed.
 *
 * /api/crm/stats     — the four headline cards (open estimates, jobs won,
 *                      unscheduled jobs, open invoices), count + dollars each,
 *                      plus the open pipeline (every project not cancelled or
 *                      paid) and the active client count — real totals, not
 *                      bounded by the capped list endpoints the page loads.
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
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { objectPolicy } from "./object-access";
import { divisionScopeOf } from "./divisions";
import { requireOrg, requirePermission } from "./tenancy";

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
// The open book: every live project except the closed stages (the home
// page's "Pipeline value" — summing closed jobs made it grow forever).
const CLOSED_PROJECT = ["cancelled", "paid"] as const;
// Only these estimate-event types render in the team feed (see the loop
// below); filtering in SQL keeps the limit*2 fetch budget for renderable rows.
const FEED_EVENT_TYPES = ["sent", "viewed", "approved", "declined", "shared"] as const;

export function registerCrmStatsRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/crm/stats", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Org-wide revenue rollups — reporting seats only (field/sub are blind).
    if (!requirePermission(res, ctx, "seeReporting")) return;
    const orgId = ctx.org.id;

    // Reuse the object policy before aggregation, including assignment overrides.
    if (divisionScopeOf(ctx.member) || !ctx.permissions.viewAllJobs) {
      const access = objectPolicy(ctx);
      const estimates = await access.filter("estimates", await db.select().from(crmEstimates).where(eq(crmEstimates.orgId, orgId)));
      const projects = await access.filter("projects", await db.select().from(crmProjects).where(eq(crmProjects.orgId, orgId)));
      const invoices = await access.filter("invoices", await db.select().from(crmInvoices).where(eq(crmInvoices.orgId, orgId)));
      const customers = await access.filter("customers", await db.select().from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt))));
      const sum = <T,>(rows: T[], value: (r: T) => number) => ({ count: rows.length, totalCents: rows.reduce((n, r) => n + value(r), 0) });
      return res.json({
        openEstimates: sum(estimates.filter(e => (OPEN_ESTIMATE as readonly string[]).includes(e.status)), e => e.totalCents),
        jobsWon: sum(estimates.filter(e => e.status === "approved"), e => e.approvedTotalCents ?? e.totalCents),
        unscheduledJobs: sum(projects.filter(p => p.status === "approved" && !p.archivedAt), p => p.contractValueCents ?? 0),
        openInvoices: sum(invoices.filter(i => (OPEN_INVOICE as readonly string[]).includes(i.status)), i => Math.max(0, i.totalCents - i.paidCents)),
        openPipeline: sum(projects.filter(p => !p.archivedAt && !(CLOSED_PROJECT as readonly string[]).includes(p.status)), p => p.contractValueCents ?? 0),
        clients: { count: customers.length },
      });
    }

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
      // greatest() per row: a corrupt paid > total invoice must not drag the
      // org-wide open-balance below zero.
      totalCents: sql<number>`coalesce(sum(greatest(${crmInvoices.totalCents} - ${crmInvoices.paidCents}, 0)), 0)::bigint`,
    }).from(crmInvoices).where(and(
      eq(crmInvoices.orgId, orgId),
      inArray(crmInvoices.status, [...OPEN_INVOICE]),
    ));

    const [pipeline] = await db.select({
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(coalesce(${crmProjects.contractValueCents}, 0)), 0)::bigint`,
    }).from(crmProjects).where(and(
      eq(crmProjects.orgId, orgId),
      isNull(crmProjects.archivedAt),
      notInArray(crmProjects.status, [...CLOSED_PROJECT]),
    ));

    const [cl] = await db.select({ count: sql<number>`count(*)::int` })
      .from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt)));

    const num = (r: { count: number; totalCents: unknown }) =>
      ({ count: r.count, totalCents: Number(r.totalCents) });
    res.json({
      openEstimates: num(openEst),
      jobsWon: num(won),
      unscheduledJobs: num(unscheduled),
      openInvoices: num(openInv),
      openPipeline: num(pipeline),
      clients: { count: cl.count },
    });
  });

  app.get("/api/crm/team-activity", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Per-payment amounts and customer names — reporting seats only.
    if (!requirePermission(res, ctx, "seeReporting")) return;
    const orgId = ctx.org.id;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "40")) || 40));

    const members = await db.select().from(crmMembers).where(eq(crmMembers.orgId, orgId));
    const memberName = (id: string | null | undefined): string | null => {
      if (!id) return null;
      const m = members.find((x) => x.id === id);
      return m ? (m.displayName || m.email || null) : null;
    };

    const access = objectPolicy(ctx);
    const restricted = divisionScopeOf(ctx.member) || !ctx.permissions.viewAllJobs;
    type Item = { id: string; at: string; actor: string; text: string; link: string | null };
    const items: Item[] = [];
    const money = (c: number) =>
      `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const logged = await db.select().from(crmTeamActivity)
      .where(eq(crmTeamActivity.orgId, orgId))
      .orderBy(desc(crmTeamActivity.createdAt)).limit(limit);
    for (const r of logged) {
      if (restricted) {
        const ref = /^\/crm\/(clients|projects|estimates)\/([^/?]+)/.exec(r.link ?? "");
        if (!ref || !await access.visible(ref[1] === "clients" ? "customers" : ref[1] as "projects" | "estimates", ref[2])) continue;
      }
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
      estimateId: crmEstimates.id,
      estNumber: crmEstimates.number,
      customerId: crmEstimates.customerId,
      custName: crmCustomers.displayName,
    }).from(crmEstimateEvents)
      // Org predicates on every join, not just the where: a row whose FK
      // points at another org's record must drop out, not render.
      .innerJoin(crmEstimates, and(
        eq(crmEstimateEvents.estimateId, crmEstimates.id),
        eq(crmEstimates.orgId, orgId),
      ))
      .innerJoin(crmCustomers, and(
        eq(crmEstimates.customerId, crmCustomers.id),
        eq(crmCustomers.orgId, orgId),
      ))
      .where(and(
        eq(crmEstimateEvents.orgId, orgId),
        inArray(crmEstimateEvents.type, [...FEED_EVENT_TYPES]),
      ))
      .orderBy(desc(crmEstimateEvents.createdAt)).limit(limit * 2);
    for (const e of events) {
      if (restricted && !await access.visible("estimates", e.estimateId)) continue;
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
      .innerJoin(crmCustomers, and(
        eq(crmPayments.customerId, crmCustomers.id),
        eq(crmCustomers.orgId, orgId),
      ))
      .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.status, "succeeded")))
      .orderBy(desc(crmPayments.createdAt)).limit(limit);
    for (const p of pays) {
      if (restricted && !await access.visible("payments", p.id)) continue;
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
