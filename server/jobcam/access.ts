/**
 * Who may see / add / manage JobCam media — the CRM's own rules, applied to
 * media through its project:
 *   - see:    the project is visible to this seat (objectPolicy: viewAllJobs,
 *             division scope, PM/sales/crew assignment) — field crews included.
 *   - add:    anyone who can see the project (the camera is for the crew).
 *   - manage: delete/retag OTHER people's media, manage the tag list, share
 *             links — manageJobs or manageCustomers (the Project Photos rule).
 * Tenant isolation is the org id on every row, and every lookup is
 * org-scoped first, visibility-checked second.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { crmProjects } from "@shared/schema";
import type { OrgContext } from "../crm/tenancy";
import { objectPolicy } from "../crm/object-access";
import { divisionScopeOf } from "../crm/divisions";

export function canManageJobcam(ctx: OrgContext): boolean {
  return ctx.permissions.manageJobs || ctx.permissions.manageCustomers;
}

/** null = every project in the org (an unscoped seat with viewAllJobs); else the allowed ids. */
export async function visibleProjectIds(ctx: OrgContext): Promise<string[] | null> {
  if (ctx.permissions.viewAllJobs && !divisionScopeOf(ctx.member)) return null;
  const rows = await db.select().from(crmProjects).where(eq(crmProjects.orgId, ctx.org.id));
  const allowed = await objectPolicy(ctx).filter("projects", rows);
  return allowed.map((p) => p.id);
}

export async function visibleProject(ctx: OrgContext, projectId: string) {
  const [p] = await db.select().from(crmProjects)
    .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, projectId))).limit(1);
  if (!p) return null;
  const ok = await objectPolicy(ctx).visible("projects", p.id);
  return ok ? p : null;
}

export async function projectsById(orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, typeof crmProjects.$inferSelect>();
  const rows = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.id, ids)));
  return new Map(rows.map((p) => [p.id, p]));
}
