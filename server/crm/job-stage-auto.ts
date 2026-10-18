/**
 * The job stage moves on its own (owner, 2026-10-17): a sent bid → Bid Submitted, an approved bid → Approved, a visit
 * on the calendar → Job Scheduled, an invoice out → In progress, every walkthrough done → Closed out. Always forward,
 * never back, never past Closed out, never a cancelled project (shared/job-stage.ts `nextAutoStatus`).
 *
 * `advanceJobStage` is the one path every trigger uses. It writes the project's status exactly as the manual
 * tracker toggle does (PATCH /api/crm/projects/:id — stageChangedAt, team activity, the stage webhook) and adds an
 * audit row ("project.stage_auto") naming the trigger. A client with no project yet gets one created from the
 * estimate that fired (the manual toggle used to do this in the browser; it now goes through here too).
 *
 * Side effects of a stage (`stageSideEffects`), shared with the manual route so a hand move behaves the same:
 *   Approved with nothing on the calendar → a friendly "call <client> to schedule the start date" task for the PM
 *   (else the sales rep, else the owner), notified like a self-estimate task; Job Scheduled or later → that task is
 *   marked done. Nothing here ever throws into the route that triggered it.
 */
import { db } from "../db";
import {
  crmAppointments, crmCustomers, crmEstimates, crmMembers, crmOrgs, crmProjects, crmTasks,
} from "@shared/schema";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { STAGE_PROJECT_STATUS, currentProject, jobStageLabel, nextAutoStatus, stageIndex, stageOfProjectStatus, type JobStage } from "@shared/job-stage";
import { recordActivity } from "./activity";
import { logTeamActivity, projectStageLabel } from "./stats";
import { queueCrmEvent, queueProjectStageChange, projectEventPayload } from "./integrations";
import { nextDocNumber } from "./entities";
import { adoptHoverMeasurementsForProject } from "./hover-share";
import { notifyMembers } from "./notify";
import { anchorPassesPhase } from "@shared/job-flow";
import { enterPhase, loadJobFlow } from "./job-flow";

type Project = typeof crmProjects.$inferSelect;
type Estimate = typeof crmEstimates.$inferSelect;

/** Who did it, for the audit row: a member, or a label ("client", "system"). */
export type StageActor = { memberId?: string | null; label: string };

export const SCHEDULE_START_SOURCE = "schedule_start";

/** The project a client's stage belongs to (newest live one), if any. */
export async function customerCurrentProject(orgId: string, customerId: string): Promise<Project | null> {
  const rows = await db.select().from(crmProjects)
    .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.customerId, customerId), isNull(crmProjects.archivedAt)));
  return currentProject(rows);
}

/** A project for a client who has none yet, made from the estimate that fired (named after it, in its division). */
async function createProjectFromEstimate(orgId: string, est: Estimate, status: string, customerName: string): Promise<Project> {
  const name = est.title?.trim() || `${customerName} job`;
  const row = await db.transaction(async (tx) => {
    const number = await nextDocNumber(tx, crmProjects, orgId, "P");
    const [inserted] = await tx.insert(crmProjects).values({
      orgId, customerId: est.customerId, number, name: name.slice(0, 200), status,
      divisionId: est.divisionId ?? null,
      contractValueCents: est.approvedAt ? (est.approvedTotalCents ?? est.totalCents) : null,
    } as any).returning();
    return inserted;
  });
  queueCrmEvent(orgId, "project.created", projectEventPayload(row));
  await adoptHoverMeasurementsForProject(row).catch(() => {});
  // The estimate now belongs to the project it created (the pipeline card shows the bid).
  if (!est.projectId) {
    await db.update(crmEstimates).set({ projectId: row.id, updatedAt: new Date() }).where(eq(crmEstimates.id, est.id)).catch(() => {});
  }
  return row;
}

/**
 * Move a job forward to `to`, if that is forward. Resolves the project from `projectId`, else the client's current
 * project, else (when `estimate` is given) creates one. Returns what happened; never throws.
 */
export async function advanceJobStage(args: {
  orgId: string;
  to: JobStage;
  /** What fired it, for the audit row: "estimate.sent", "estimate.approved", "appointment", "invoice.sent", "punchlist". */
  trigger: string;
  actor: StageActor;
  projectId?: string | null;
  customerId?: string | null;
  /** Lets a client with no project get one (bid sent / approved). */
  estimate?: Estimate | null;
  /** Set on approval: the signed total becomes the contract value. */
  contractValueCents?: number | null;
  meta?: Record<string, unknown>;
}): Promise<{ moved: boolean; created: boolean; project: Project | null; from: string | null; to: string | null }> {
  try {
    let project: Project | null = null;
    if (args.projectId) {
      const [p] = await db.select().from(crmProjects)
        .where(and(eq(crmProjects.orgId, args.orgId), eq(crmProjects.id, args.projectId))).limit(1);
      project = p ?? null;
    }
    const customerId = args.customerId ?? args.estimate?.customerId ?? project?.customerId ?? null;
    if (!project && customerId) project = await customerCurrentProject(args.orgId, customerId);

    if (!project) {
      if (!args.estimate) return { moved: false, created: false, project: null, from: null, to: null };
      const [cust] = await db.select({ name: crmCustomers.displayName }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, args.orgId), eq(crmCustomers.id, args.estimate.customerId))).limit(1);
      const status = STAGE_PROJECT_STATUS[args.to];
      const created = await createProjectFromEstimate(args.orgId, args.estimate, status, cust?.name ?? "Client");
      await logTeamActivity({
        orgId: args.orgId, memberId: args.actor.memberId ?? null, actorLabel: args.actor.memberId ? null : args.actor.label,
        type: "projectStage", title: `moved ${created.name} to ${projectStageLabel(status)}`, link: `/crm/projects/${created.id}`,
      });
      recordActivity({
        orgId: args.orgId, actorMemberId: args.actor.memberId ?? null, actorLabel: args.actor.label,
        action: "project.stage_auto", entityType: "project", entityId: created.id, customerId: created.customerId,
        meta: { name: created.name, number: created.number, from: null, to: status, stage: args.to, trigger: args.trigger, created: true, ...(args.meta ?? {}) },
      });
      await stageSideEffects({ orgId: args.orgId, project: created, from: null, actor: args.actor });
      await enterPhase({ orgId: args.orgId, project: created, phaseKey: args.to, trigger: args.trigger });
      return { moved: true, created: true, project: created, from: null, to: status };
    }

    const status = nextAutoStatus(project.status, args.to);
    if (!status) return { moved: false, created: false, project, from: project.status, to: null };
    const patch: Partial<Project> = { status, stageChangedAt: new Date(), updatedAt: new Date() };
    if (args.contractValueCents != null) patch.contractValueCents = args.contractValueCents;
    // A custom phase of the account's flow stays the current one unless this anchor is AHEAD of it (never backward).
    if (project.stageKey && anchorPassesPhase(await loadJobFlow(args.orgId), args.to, project.stageKey)) patch.stageKey = null;
    const [row] = await db.update(crmProjects).set(patch)
      .where(and(eq(crmProjects.orgId, args.orgId), eq(crmProjects.id, project.id))).returning();
    if (!row) return { moved: false, created: false, project, from: project.status, to: null };
    await logTeamActivity({
      orgId: args.orgId, memberId: args.actor.memberId ?? null, actorLabel: args.actor.memberId ? null : args.actor.label,
      type: "projectStage", title: `moved ${row.name} to ${projectStageLabel(row.status)}`, link: `/crm/projects/${row.id}`,
    });
    queueProjectStageChange(args.orgId, row.id, project.status, row.status);
    recordActivity({
      orgId: args.orgId, actorMemberId: args.actor.memberId ?? null, actorLabel: args.actor.label,
      action: "project.stage_auto", entityType: "project", entityId: row.id, customerId: row.customerId,
      meta: { name: row.name, number: row.number, from: project.status, to: row.status, stage: args.to, trigger: args.trigger, ...(args.meta ?? {}) },
    });
    await stageSideEffects({ orgId: args.orgId, project: row, from: project.status, actor: args.actor });
    await enterPhase({ orgId: args.orgId, project: row, phaseKey: args.to, trigger: args.trigger });
    return { moved: true, created: false, project: row, from: project.status, to: row.status };
  } catch (e: any) {
    console.error(`[crm] job stage auto-advance (${args.trigger}) failed:`, e?.message || e);
    return { moved: false, created: false, project: null, from: null, to: null };
  }
}

/** A live (not canceled) visit on the calendar for this project, soonest upcoming first. */
export async function projectAppointment(orgId: string, projectId: string) {
  const rows = await db.select().from(crmAppointments)
    .where(and(eq(crmAppointments.orgId, orgId), eq(crmAppointments.projectId, projectId), ne(crmAppointments.status, "canceled")))
    .orderBy(desc(crmAppointments.startsAt)).limit(50);
  const now = Date.now();
  const upcoming = rows.filter((a) => a.startsAt.getTime() >= now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return upcoming[0] ?? rows[0] ?? null;
}

/**
 * What a stage brings with it — called after EVERY status write, automatic or by hand (the project PATCH route),
 * so the reminder behaves the same however the job got there.
 */
export async function stageSideEffects(args: { orgId: string; project: Project; from: string | null; actor: StageActor }): Promise<void> {
  const stage = stageOfProjectStatus(args.project.status);
  if (!stage) return;
  try {
    if (stage === "approved") {
      if (!(await projectAppointment(args.orgId, args.project.id))) await ensureScheduleStartTask(args.orgId, args.project);
    } else if (stageIndex(stage) > stageIndex("approved")) {
      await completeScheduleStartTask(args.orgId, args.project.id);
    }
  } catch (e: any) {
    console.error("[crm] job stage side effects failed:", e?.message || e);
  }
}

/** The open "call the client to schedule the start date" task for a project, if any. */
async function openScheduleStartTask(orgId: string, projectId: string) {
  const [t] = await db.select().from(crmTasks).where(and(
    eq(crmTasks.orgId, orgId), eq(crmTasks.source, SCHEDULE_START_SOURCE), isNull(crmTasks.doneAt),
    sql`${crmTasks.meta} ->> 'projectId' = ${projectId}`,
  )).limit(1);
  return t ?? null;
}

/**
 * The friendly reminder after approval: one open task per project ("Call <client> to schedule the start date"),
 * assigned to the project's PM, else its sales member, else the org owner; the assignee (and the owners) get the
 * in-app notification the way a self-estimate task does.
 */
export async function ensureScheduleStartTask(orgId: string, project: Project): Promise<typeof crmTasks.$inferSelect | null> {
  if (await openScheduleStartTask(orgId, project.id)) return null;
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, project.customerId))).limit(1);
  if (!cust) return null;
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return null;
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  const byId = (id: string | null | undefined) => (id ? members.find((m) => m.id === id) ?? null : null);
  const assignee = byId(project.projectManagerMemberId) ?? byId(project.salesMemberId)
    ?? members.find((m) => m.role === "owner" && m.userId === org.ownerUserId) ?? members.find((m) => m.role === "owner") ?? null;
  const first = cust.firstName?.trim() || cust.displayName.split(/\s+/)[0];
  const job = project.name?.trim() || "job";
  const [task] = await db.insert(crmTasks).values({
    orgId, customerId: cust.id, divisionId: project.divisionId ?? null,
    assignedMemberId: assignee?.id ?? null, source: SCHEDULE_START_SOURCE,
    idempotencyKey: `${SCHEDULE_START_SOURCE}:${project.id}`,
    title: `Call ${cust.displayName} to schedule the start date`.slice(0, 300),
    body: `${first}'s ${job} is approved — nice work! Give ${first} a call, agree on a start date and put it on the calendar. The job moves to Job Scheduled on its own once the visit is there.${cust.phone ? ` ${cust.displayName}: ${cust.phone}.` : ""}`.slice(0, 2000),
    dueAt: new Date(Date.now() + 2 * 24 * 3600_000),
    meta: { projectId: project.id, projectName: project.name, kind: SCHEDULE_START_SOURCE },
  } as any).returning();
  await notifyMembers({
    org, pref: "jobApproved", type: "scheduleStart",
    title: `${cust.displayName}'s job is approved — call to schedule the start date`,
    body: `A friendly reminder: ${first}'s ${job} is ready to go on the calendar.`,
    link: `/crm/clients/${cust.id}`,
    extraMemberIds: assignee ? [assignee.id] : [],
  });
  return task;
}

/** The job is on the calendar (or past that): the reminder is done, by the system. */
export async function completeScheduleStartTask(orgId: string, projectId: string): Promise<boolean> {
  const t = await openScheduleStartTask(orgId, projectId);
  if (!t) return false;
  await db.update(crmTasks).set({ doneAt: new Date(), doneByMemberId: null }).where(eq(crmTasks.id, t.id));
  return true;
}

/** "Job Scheduled" in words for a toast or an audit line. */
export const autoStageLabel = (s: JobStage) => jobStageLabel(s) ?? s;
