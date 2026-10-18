/**
 * Punch list & final walkthrough — one section per scope of the approved work (shared/punch-list.ts), kept in
 * crm_punch_scopes and shown inside the client page's Job stage card from Job Scheduled on.
 *
 *   GET /api/crm/projects/:id/punch — the project's scopes; a project with none yet gets them derived from its
 *       approved estimates (titles + line items against the trades) and stored, so the list is the same for everyone.
 *   PUT /api/crm/projects/:id/punch — the whole list back (manageJobs): add / rename / remove scopes, their items,
 *       and each scope's "Walkthrough complete" (who/when recorded here, never trusted from the body). When EVERY
 *       scope's walkthrough is complete the job closes out through the same path as the tracker (project →
 *       complete, activity log, the Google Reviews pipeline picks it up).
 *
 * Photos for a scope are ordinary client photos tagged "punchlist--<scope>--" (attachments.ts), so the photo library
 * and the client portal show them. The portal gets the list read-only (`punchListsForCustomers`).
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { crmEstimateItems, crmEstimates, crmMembers, crmProjects, crmPunchScopes, type CrmPunchScopeRow } from "@shared/schema";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { objectPolicy } from "./object-access";
import { logActivity } from "./activity";
import { advanceJobStage } from "./job-stage-auto";
import { deriveScopes, normalizePunchItems, scopeKeyOf, type PunchItem, type PunchScope } from "@shared/punch-list";
import { stageOfProjectStatus } from "@shared/job-stage";

type GetUser = (req: any, res: any) => any;

const SCOPE_KEY = /^[a-z0-9_]{1,40}$/;

const scopeBody = z.object({
  scope: z.string().max(40).optional(),
  label: z.string().min(1).max(60),
  items: z.array(z.object({ id: z.string().max(40).optional(), text: z.string().max(500), doneAt: z.string().nullable().optional() })).max(200).default([]),
  walkthroughDone: z.boolean().default(false),
});
const putBody = z.object({ scopes: z.array(scopeBody).min(1, "Keep at least one scope").max(20) });

/** The scopes an approved job's estimates describe, from the project's own estimates, else the client's. */
async function derivedScopesFor(orgId: string, project: typeof crmProjects.$inferSelect) {
  let ests = await db.select().from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.projectId, project.id), eq(crmEstimates.status, "approved")));
  if (!ests.length) {
    ests = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, project.customerId), eq(crmEstimates.status, "approved")));
  }
  const items = ests.length ? await db.select().from(crmEstimateItems)
    .where(and(eq(crmEstimateItems.orgId, orgId), inArray(crmEstimateItems.estimateId, ests.map((e) => e.id)))) : [];
  // A change order adds to an existing scope, never a scope of its own, but its lines still count.
  return deriveScopes(ests.map((e) => ({
    title: /change order/i.test(e.title ?? "") ? null : e.title,
    items: items.filter((it) => it.estimateId === e.id).map((it) => ({ name: it.name, description: it.description })),
  })));
}

/** Stored rows for a project, seeded from the estimates the first time. */
export async function loadPunchScopes(orgId: string, project: typeof crmProjects.$inferSelect): Promise<CrmPunchScopeRow[]> {
  const rows = await db.select().from(crmPunchScopes)
    .where(and(eq(crmPunchScopes.orgId, orgId), eq(crmPunchScopes.projectId, project.id)))
    .orderBy(asc(crmPunchScopes.sortOrder), asc(crmPunchScopes.createdAt));
  if (rows.length) return rows;
  const seed = await derivedScopesFor(orgId, project);
  // Two first opens at once: the unique (project, scope) index makes the second a no-op, then both read the rows.
  await db.insert(crmPunchScopes).values(seed.map((s, i) => ({ orgId, projectId: project.id, scope: s.scope, label: s.label, items: [], sortOrder: i })))
    .onConflictDoNothing().catch(() => {});
  return db.select().from(crmPunchScopes)
    .where(and(eq(crmPunchScopes.orgId, orgId), eq(crmPunchScopes.projectId, project.id)))
    .orderBy(asc(crmPunchScopes.sortOrder), asc(crmPunchScopes.createdAt));
}

function present(rows: CrmPunchScopeRow[], memberName: (id: string | null) => string | null): PunchScope[] {
  return rows.map((r) => ({
    scope: r.scope, label: r.label, items: normalizePunchItems(r.items),
    walkthroughDoneAt: r.walkthroughDoneAt ? r.walkthroughDoneAt.toISOString() : null,
    walkthroughDoneBy: memberName(r.walkthroughDoneByMemberId),
  }));
}

async function memberNames(orgId: string, ids: (string | null)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = want.length ? await db.select({ id: crmMembers.id, name: crmMembers.displayName, email: crmMembers.email }).from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), inArray(crmMembers.id, want))) : [];
  const map = new Map(rows.map((m) => [m.id, m.name || m.email]));
  return (id: string | null) => (id ? map.get(id) ?? null : null);
}

export function registerCrmPunchListRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: "manageJobs"): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }
  /** The project, in this org and visible to this seat — else 404 (never "exists but not yours"). */
  async function projectFor(ctx: OrgContext, id: string, res: any) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, String(id)))).limit(1);
    if (!p || !(await objectPolicy(ctx).visible("projects", p.id))) { res.status(404).json({ message: "Project not found" }); return null; }
    return p;
  }

  app.get("/api/crm/projects/:id/punch", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const project = await projectFor(ctx, req.params.id, res);
    if (!project) return;
    const rows = await loadPunchScopes(ctx.org.id, project);
    res.json({ scopes: present(rows, await memberNames(ctx.org.id, rows.map((r) => r.walkthroughDoneByMemberId))), projectStatus: project.status });
  });

  app.put("/api/crm/projects/:id/punch", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = putBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid punch list", issues: parsed.error.issues });
    const project = await projectFor(ctx, req.params.id, res);
    if (!project) return;

    const existing = await loadPunchScopes(ctx.org.id, project);
    const byScope = new Map(existing.map((r) => [r.scope, r]));
    const now = new Date();
    const keep = new Set<string>();
    let i = 0;
    for (const s of parsed.data.scopes) {
      const label = s.label.replace(/\s+/g, " ").trim().slice(0, 60);
      const key = s.scope && SCOPE_KEY.test(s.scope) ? s.scope : scopeKeyOf(label) || `scope_${i + 1}`;
      if (keep.has(key)) continue; // the same scope twice: the first wins
      keep.add(key);
      const items: PunchItem[] = normalizePunchItems(s.items);
      const prior = byScope.get(key);
      const doneAt = s.walkthroughDone ? (prior?.walkthroughDoneAt ?? now) : null;
      const doneBy = s.walkthroughDone ? (prior?.walkthroughDoneAt ? prior.walkthroughDoneByMemberId : ctx.member.id) : null;
      if (prior) {
        await db.update(crmPunchScopes).set({ label, items, sortOrder: i, walkthroughDoneAt: doneAt, walkthroughDoneByMemberId: doneBy, updatedAt: now })
          .where(eq(crmPunchScopes.id, prior.id));
        if (s.walkthroughDone && !prior.walkthroughDoneAt) {
          logActivity(ctx, "punchlist.walkthrough_done", { entityType: "project", entityId: project.id, customerId: project.customerId, meta: { name: project.name, scope: label } });
        }
      } else {
        await db.insert(crmPunchScopes).values({
          orgId: ctx.org.id, projectId: project.id, scope: key, label, items, sortOrder: i,
          walkthroughDoneAt: doneAt, walkthroughDoneByMemberId: doneBy,
        }).onConflictDoNothing();
        if (s.walkthroughDone) logActivity(ctx, "punchlist.walkthrough_done", { entityType: "project", entityId: project.id, customerId: project.customerId, meta: { name: project.name, scope: label } });
      }
      i++;
    }
    for (const r of existing) if (!keep.has(r.scope)) await db.delete(crmPunchScopes).where(eq(crmPunchScopes.id, r.id));

    const rows = await loadPunchScopes(ctx.org.id, project);
    // Every walkthrough complete → the job closes out (same path as the tracker's Closed out; never a cancelled
    // or already-closed job, never backward).
    let closedOut = false;
    if (rows.length && rows.every((r) => r.walkthroughDoneAt) && stageOfProjectStatus(project.status) !== "closed_out") {
      const r = await advanceJobStage({
        orgId: ctx.org.id, to: "closed_out", trigger: "punchlist",
        actor: { memberId: ctx.member.id, label: ctx.member.displayName || ctx.member.email },
        projectId: project.id, meta: { scopes: rows.map((x) => x.label) },
      });
      closedOut = r.moved;
    }
    const [fresh] = await db.select({ status: crmProjects.status }).from(crmProjects).where(eq(crmProjects.id, project.id)).limit(1);
    res.json({ scopes: present(rows, await memberNames(ctx.org.id, rows.map((r) => r.walkthroughDoneByMemberId))), closedOut, projectStatus: fresh?.status ?? project.status });
  });
}

/** The client portal's read-only copy: each live project's scopes with their notes and walkthrough state. */
export async function punchListsForCustomers(customerIds: string[]) {
  if (!customerIds.length) return [];
  const projects = await db.select().from(crmProjects)
    .where(and(inArray(crmProjects.customerId, customerIds), isNull(crmProjects.archivedAt), ne(crmProjects.status, "cancelled")));
  if (!projects.length) return [];
  const rows = await db.select().from(crmPunchScopes)
    .where(inArray(crmPunchScopes.projectId, projects.map((p) => p.id)))
    .orderBy(asc(crmPunchScopes.sortOrder), asc(crmPunchScopes.createdAt));
  return projects
    .filter((p) => rows.some((r) => r.projectId === p.id))
    .map((p) => ({
      projectId: p.id, projectName: p.name, customerId: p.customerId, status: p.status,
      scopes: rows.filter((r) => r.projectId === p.id).map((r) => ({
        scope: r.scope, label: r.label, items: normalizePunchItems(r.items),
        walkthroughDoneAt: r.walkthroughDoneAt ? r.walkthroughDoneAt.toISOString() : null,
      })),
    }));
}
