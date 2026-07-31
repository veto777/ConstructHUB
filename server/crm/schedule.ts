/**
 * Read-only feeds for the mobile ribbon: the org schedule (appointments with
 * their project/customer context, day-grouped by the client) and the activity
 * inbox (estimate views/approvals/declines + payments, newest first).
 *
 * Same two rules as everywhere: org-scoped through requireOrg(), and a crew
 * member without viewAllJobs sees only visits they're dispatched to.
 */
import type { Express } from "express";
import { db } from "../db";
import {
  crmAppointments, crmProjects, crmCustomers, crmMembers,
  crmEstimateEvents, crmEstimates, crmPayments,
} from "@shared/schema";
import { and, asc, desc, eq, gte, lt, inArray, ne } from "drizzle-orm";
import { requireOrg, type OrgContext } from "./tenancy";

type GetUser = (req: any, res: any) => any;

export function registerCrmScheduleRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    return requireOrg(req, res, user.id);
  }

  /**
   * Appointments across the org's projects for the next N days (default 14,
   * max 60), starting at the top of today. Each row carries the project and
   * customer names plus resolved crew names so the client needs no lookups.
   */
  app.get("/api/crm/schedule", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;

    const parsed = parseInt(String(req.query.days ?? "14"), 10);
    const days = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 14, 1), 60);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 86400000);

    const rows = await db
      .select({
        appointment: crmAppointments,
        projectName: crmProjects.name,
        projectNumber: crmProjects.number,
        customerName: crmCustomers.displayName,
      })
      .from(crmAppointments)
      .leftJoin(crmProjects, eq(crmProjects.id, crmAppointments.projectId))
      .leftJoin(crmCustomers, eq(crmCustomers.id, crmAppointments.customerId))
      .where(and(
        eq(crmAppointments.orgId, ctx.org.id),
        ne(crmAppointments.status, "canceled"),
        gte(crmAppointments.startsAt, from),
        lt(crmAppointments.startsAt, to),
      ))
      .orderBy(asc(crmAppointments.startsAt))
      .limit(500);

    // Same visibility rule as ops.ts: a restricted tech sees only their visits.
    const visible = ctx.permissions.viewAllJobs
      ? rows
      : rows.filter((r) => (r.appointment.dispatchedMemberIds || []).includes(ctx.member.id));

    const members = await db
      .select({ id: crmMembers.id, displayName: crmMembers.displayName, email: crmMembers.email })
      .from(crmMembers)
      .where(eq(crmMembers.orgId, ctx.org.id));
    const nameOf = new Map(members.map((m) => [m.id, m.displayName || m.email]));

    res.json({
      days,
      appointments: visible.map(({ appointment: a, projectName, projectNumber, customerName }) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        allDay: a.allDay,
        arrivalWindowMinutes: a.arrivalWindowMinutes,
        notes: a.notes,
        projectId: a.projectId,
        projectName,
        projectNumber,
        customerName,
        crew: (a.dispatchedMemberIds || [])
          .map((id) => nameOf.get(id))
          .filter(Boolean),
      })),
    });
  });

  /**
   * The inbox: what clients did, newest first. Estimate events (viewed /
   * approved / declined) and payments (succeeded / failed / refunded), merged
   * into one feed — "Kane viewed estimate E-2001 · 2h ago".
   */
  app.get("/api/crm/activity", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;

    const events = await db
      .select({
        id: crmEstimateEvents.id,
        type: crmEstimateEvents.type,
        at: crmEstimateEvents.createdAt,
        estimateId: crmEstimateEvents.estimateId,
        estimateNumber: crmEstimates.number,
        estimateTitle: crmEstimates.title,
        customerName: crmCustomers.displayName,
      })
      .from(crmEstimateEvents)
      .innerJoin(crmEstimates, eq(crmEstimates.id, crmEstimateEvents.estimateId))
      .innerJoin(crmCustomers, eq(crmCustomers.id, crmEstimates.customerId))
      .where(and(
        eq(crmEstimateEvents.orgId, ctx.org.id),
        inArray(crmEstimateEvents.type, ["viewed", "approved", "declined"]),
      ))
      .orderBy(desc(crmEstimateEvents.createdAt))
      .limit(60);

    const canSeePrices = ctx.permissions.seePrices === true;
    const payments = canSeePrices
      ? await db
          .select({
            id: crmPayments.id,
            status: crmPayments.status,
            amountCents: crmPayments.amountCents,
            method: crmPayments.method,
            provider: crmPayments.provider,
            purpose: crmPayments.purpose,
            note: crmPayments.note,
            paidAt: crmPayments.paidAt,
            createdAt: crmPayments.createdAt,
            customerName: crmCustomers.displayName,
          })
          .from(crmPayments)
          .innerJoin(crmCustomers, eq(crmCustomers.id, crmPayments.customerId))
          .where(and(
            eq(crmPayments.orgId, ctx.org.id),
            inArray(crmPayments.status, ["succeeded", "failed", "refunded"]),
          ))
          .orderBy(desc(crmPayments.createdAt))
          .limit(60)
      : [];

    const feed = [
      ...events.map((e) => ({
        id: `est-${e.id}`,
        kind: "estimate" as const,
        type: e.type,
        at: e.at,
        customerName: e.customerName,
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        estimateTitle: e.estimateTitle,
      })),
      ...payments.map((p) => ({
        id: `pay-${p.id}`,
        kind: "payment" as const,
        type: p.status,
        at: p.paidAt ?? p.createdAt,
        customerName: p.customerName,
        amountCents: p.amountCents,
        method: p.method ?? p.provider,
        purpose: p.purpose,
        note: p.note,
      })),
    ]
      .filter((i) => i.at)
      .sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime())
      .slice(0, 80);

    res.json({ activity: feed });
  });
}
