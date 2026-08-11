/**
 * The org schedule: appointment CRUD plus the read-only feeds for the mobile
 * ribbon (day-grouped appointments with their project/customer context) and
 * the activity inbox (estimate views/approvals/declines + payments).
 *
 * The CRUD lives here (moved out of ops.ts) because the schedule page is the
 * primary editor: month/week calendar, crew assignment, project/customer
 * links. Same two rules as everywhere: org-scoped through requireOrg(), and
 * a crew member without viewAllJobs sees only visits they're dispatched to.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmAppointments, crmProjects, crmCustomers, crmMembers,
  crmEstimateEvents, crmEstimates, crmPayments,
  CRM_APPOINTMENT_STATUSES,
} from "@shared/schema";
import { and, asc, desc, eq, gte, lt, lte, inArray, ne } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { logTeamActivity } from "./stats";
import { divisionScopeOf, divisionVisible, divisionMapsForOrg } from "./divisions";

type GetUser = (req: any, res: any) => any;

const appointmentBody = z.object({
  projectId: z.string().max(64).nullable().optional(),
  jobId: z.string().max(64).nullable().optional(),
  customerId: z.string().max(64).nullable().optional(),
  title: z.string().min(1).max(200),
  notes: z.string().max(8000).nullable().optional(),
  crewNotes: z.string().max(8000).nullable().optional(),
  startsAt: z.string().max(60),
  endsAt: z.string().max(60).nullable().optional(),
  allDay: z.boolean().default(false),
  arrivalWindowMinutes: z.number().int().min(0).max(480).nullable().optional(),
  dispatchedMemberIds: z.array(z.string().max(64)).max(50).default([]),
});

const appointmentPatch = z.object({
  status: z.enum(CRM_APPOINTMENT_STATUSES as unknown as [string, ...string[]]).optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(8000).nullable().optional(),
  crewNotes: z.string().max(8000).nullable().optional(),
  startsAt: z.string().max(60).optional(),
  endsAt: z.string().max(60).nullable().optional(),
  allDay: z.boolean().optional(),
  arrivalWindowMinutes: z.number().int().min(0).max(480).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  customerId: z.string().max(64).nullable().optional(),
  dispatchedMemberIds: z.array(z.string().max(64)).max(50).optional(),
});

const parseTime = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export function registerCrmScheduleRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
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

    // Same visibility rule as ops.ts: a restricted tech sees only their
    // visits, and a division-scoped member only their division's.
    const visible = await visibleAppointments(ctx, rows);

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

  // ── Appointment CRUD ─────────────────────────────────────────────────────
  // The schedule page's month/week calendar edits through these. Lane a3's
  // client page books through the same endpoints — the response shapes below
  // are the contract: POST → 201 { appointment, conflicts }, PATCH → the row,
  // DELETE → { ok, deleted }.

  /** Visibility shared by the list: dispatched-only techs, division-scoped members. */
  async function visibleAppointments<T extends { appointment: typeof crmAppointments.$inferSelect }>(
    ctx: OrgContext, rows: T[],
  ): Promise<T[]> {
    let out = ctx.permissions.viewAllJobs
      ? rows
      : rows.filter((r) => (r.appointment.dispatchedMemberIds || []).includes(ctx.member.id));
    const scope = divisionScopeOf(ctx.member);
    if (scope) {
      const maps = await divisionMapsForOrg(ctx.org.id);
      out = out.filter((r) => divisionVisible(
        scope,
        (r.appointment.projectId ? maps.byProject.get(r.appointment.projectId) : undefined)
          ?? (r.appointment.customerId ? maps.byCustomer.get(r.appointment.customerId) : undefined)
          ?? null,
      ));
    }
    return out;
  }

  /** Confirm every linked id belongs to the caller's org (never trust the body). */
  async function linksBelongToOrg(ctx: OrgContext, data: {
    projectId?: string | null; customerId?: string | null; dispatchedMemberIds?: string[];
  }): Promise<string | null> {
    if (data.projectId) {
      const [p] = await db.select({ id: crmProjects.id }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, data.projectId))).limit(1);
      if (!p) return "Project not found in this organization";
    }
    if (data.customerId) {
      const [c] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, data.customerId))).limit(1);
      if (!c) return "Customer not found in this organization";
    }
    const memberIds = [...new Set(data.dispatchedMemberIds ?? [])];
    if (memberIds.length) {
      const found = await db.select({ id: crmMembers.id }).from(crmMembers)
        .where(and(eq(crmMembers.orgId, ctx.org.id), inArray(crmMembers.id, memberIds)));
      if (found.length !== memberIds.length) return "Crew member not found in this organization";
    }
    return null;
  }

  /**
   * Appointments in a window (`from`/`to` ISO, clamped to 400 days), enriched
   * with project/customer names and resolved crew names so the calendar needs
   * no lookups. Optional `projectId`/`customerId` filters let the project and
   * client pages pull just their visits.
   */
  app.get("/api/crm/appointments", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const from = req.query.from ? parseTime(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to ? parseTime(String(req.query.to)) : new Date(Date.now() + 60 * 86400000);
    if (!from || !to) return res.status(400).json({ message: "Invalid from/to date" });
    if (to.getTime() - from.getTime() > 400 * 86400000) {
      return res.status(400).json({ message: "Date range too large (max 400 days)" });
    }

    const where = and(
      eq(crmAppointments.orgId, ctx.org.id),
      gte(crmAppointments.startsAt, from), lte(crmAppointments.startsAt, to),
      req.query.projectId ? eq(crmAppointments.projectId, String(req.query.projectId)) : undefined,
      req.query.customerId ? eq(crmAppointments.customerId, String(req.query.customerId)) : undefined,
    );
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
      .where(where)
      .orderBy(asc(crmAppointments.startsAt))
      .limit(1000);

    const visible = await visibleAppointments(ctx, rows);
    const members = await db
      .select({ id: crmMembers.id, displayName: crmMembers.displayName, email: crmMembers.email })
      .from(crmMembers)
      .where(eq(crmMembers.orgId, ctx.org.id));
    const nameOf = new Map(members.map((m) => [m.id, m.displayName || m.email]));

    res.json({
      appointments: visible.map(({ appointment: a, projectName, projectNumber, customerName }) => ({
        ...a,
        projectName,
        projectNumber,
        customerName,
        crew: (a.dispatchedMemberIds || []).map((id) => nameOf.get(id)).filter(Boolean),
      })),
      statuses: CRM_APPOINTMENT_STATUSES,
    });
  });

  app.post("/api/crm/appointments", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = appointmentBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid appointment", issues: parsed.error.issues });
    const startsAt = parseTime(parsed.data.startsAt);
    if (!startsAt) return res.status(400).json({ message: "Invalid start time" });
    const endsAt = parseTime(parsed.data.endsAt);
    if (parsed.data.endsAt && !endsAt) return res.status(400).json({ message: "Invalid end time" });
    if (endsAt && endsAt < startsAt) {
      return res.status(400).json({ message: "End time must be at or after the start time" });
    }
    const badLink = await linksBelongToOrg(ctx, parsed.data);
    if (badLink) return res.status(400).json({ message: badLink });

    // Double-booking detection — Leap admits on camera it has none.
    const conflicts: any[] = [];
    if (parsed.data.dispatchedMemberIds.length && endsAt) {
      const sameDay = await db.select().from(crmAppointments)
        .where(and(eq(crmAppointments.orgId, ctx.org.id),
          gte(crmAppointments.startsAt, new Date(startsAt.getTime() - 86400000)),
          lte(crmAppointments.startsAt, new Date(startsAt.getTime() + 86400000))));
      for (const a of sameDay) {
        if (a.status === "canceled" || !a.endsAt) continue;
        const overlap = startsAt < a.endsAt && endsAt > a.startsAt;
        if (!overlap) continue;
        const clash = (a.dispatchedMemberIds || []).filter((m) => parsed.data.dispatchedMemberIds.includes(m));
        if (clash.length) conflicts.push({ appointmentId: a.id, title: a.title, startsAt: a.startsAt, memberIds: clash });
      }
    }
    const [row] = await db.insert(crmAppointments).values({
      ...parsed.data, orgId: ctx.org.id, startsAt, endsAt,
    } as any).returning();
    await logTeamActivity({
      orgId: ctx.org.id, memberId: ctx.member.id,
      type: "appointmentScheduled",
      title: `scheduled ${row.title}`,
      link: row.projectId ? `/crm/projects/${row.projectId}` : "/crm/schedule",
    });
    res.status(201).json({ appointment: row, conflicts });
  });

  app.patch("/api/crm/appointments/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [appt] = await db.select().from(crmAppointments)
      .where(and(eq(crmAppointments.orgId, ctx.org.id), eq(crmAppointments.id, req.params.id))).limit(1);
    if (!appt) return res.status(404).json({ message: "Appointment not found" });
    const dispatched = (appt.dispatchedMemberIds || []).includes(ctx.member.id);
    // A dispatched tech may progress their own visit without manageJobs.
    if (!ctx.permissions.manageJobs && !dispatched) {
      return res.status(403).json({ message: "Requires permission: manageJobs" });
    }
    const parsed = appointmentPatch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid patch", issues: parsed.error.issues });

    const patch: any = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.startsAt !== undefined) {
      const d = parseTime(parsed.data.startsAt);
      if (!d) return res.status(400).json({ message: "Invalid start time" });
      patch.startsAt = d;
    }
    if (parsed.data.endsAt !== undefined) {
      if (parsed.data.endsAt === null) {
        patch.endsAt = null;
      } else {
        const d = parseTime(parsed.data.endsAt);
        if (!d) return res.status(400).json({ message: "Invalid end time" });
        patch.endsAt = d;
      }
    }
    // Validate the MERGED window — patching only one end can't invert it.
    const mergedStart: Date = patch.startsAt ?? appt.startsAt;
    const mergedEnd: Date | null = patch.endsAt !== undefined ? patch.endsAt : appt.endsAt;
    if (mergedEnd && mergedEnd < mergedStart) {
      return res.status(400).json({ message: "End time must be at or after the start time" });
    }
    if (parsed.data.status === "on_my_way") patch.onMyWayAt = new Date();
    if (parsed.data.status === "started") patch.startedAt = new Date();
    if (parsed.data.status === "complete") patch.completedAt = new Date();
    if (!ctx.permissions.manageJobs) {
      // Techs can progress a visit, never re-crew or re-link it.
      delete patch.dispatchedMemberIds;
      delete patch.projectId;
      delete patch.customerId;
    } else {
      const badLink = await linksBelongToOrg(ctx, {
        projectId: parsed.data.projectId, customerId: parsed.data.customerId,
        dispatchedMemberIds: parsed.data.dispatchedMemberIds,
      });
      if (badLink) return res.status(400).json({ message: badLink });
    }
    const [row] = await db.update(crmAppointments).set(patch)
      .where(eq(crmAppointments.id, appt.id)).returning();
    if (parsed.data.startsAt && parsed.data.startsAt !== appt.startsAt.toISOString()) {
      await logTeamActivity({
        orgId: ctx.org.id, memberId: ctx.member.id,
        type: "appointmentRescheduled",
        title: `rescheduled ${row.title}`,
        link: row.projectId ? `/crm/projects/${row.projectId}` : "/crm/schedule",
      });
    }
    res.json(row);
  });

  app.delete("/api/crm/appointments/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const [appt] = await db.select().from(crmAppointments)
      .where(and(eq(crmAppointments.orgId, ctx.org.id), eq(crmAppointments.id, req.params.id))).limit(1);
    if (!appt) return res.status(404).json({ message: "Appointment not found" });
    await db.delete(crmAppointments)
      .where(and(eq(crmAppointments.orgId, ctx.org.id), eq(crmAppointments.id, appt.id)));
    await logTeamActivity({
      orgId: ctx.org.id, memberId: ctx.member.id,
      type: "appointmentDeleted",
      title: `removed ${appt.title} from the schedule`,
      link: "/crm/schedule",
    });
    res.json({ ok: true, deleted: appt.id });
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
