/**
 * Follow-up cadences and the Home "needs attention" rollup.
 *
 * The owner's ask: a weekly/biweekly "who do I call" reminder per customer,
 * surfaced on Home so no lead goes cold, and a Needs-attention card that also
 * covers NEW leads and leads that still need an estimate — not just stalled
 * projects.
 *
 *   PATCH /api/crm/customers/:id/follow-up — set/clear the cadence (7|14|null)
 *                                            and/or stamp "followed up now".
 *   GET  /api/crm/follow-ups               — every cadenced customer, due first.
 *   GET  /api/crm/attention                — { followUpsDue, newLeads,
 *                                              leadsNeedingEstimate }.
 *
 * Same rules as everywhere: org-scoped, division-scoped for pinned members,
 * and names only — no money leaves these endpoints.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmCustomers, crmProjects, crmEstimates, CRM_PROJECT_STAGE_META,
} from "@shared/schema";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { logTeamActivity } from "./stats";
import { divisionScopeOf, divisionVisible, divisionMapsForOrg } from "./divisions";

type GetUser = (req: any, res: any) => any;

const DAY = 86400000;
/** "New" = landed in the last two weeks and hasn't moved down the pipeline. */
const NEW_LEAD_WINDOW_MS = 14 * DAY;

type FollowUpRow = {
  customerId: string;
  name: string;
  cadenceDays: number;
  lastFollowUpAt: string | null;
  dueAt: string;
  overdueDays: number;
  due: boolean;
};

/** Cadenced customers with their due math, due-first. Division-aware. */
async function followUpsForOrg(ctx: OrgContext): Promise<FollowUpRow[]> {
  const rows = await db
    .select({
      id: crmCustomers.id,
      name: crmCustomers.displayName,
      cadenceDays: crmCustomers.followUpCadenceDays,
      lastFollowUpAt: crmCustomers.lastFollowUpAt,
      createdAt: crmCustomers.createdAt,
    })
    .from(crmCustomers)
    .where(and(
      eq(crmCustomers.orgId, ctx.org.id),
      isNull(crmCustomers.archivedAt),
    ));

  const scope = divisionScopeOf(ctx.member);
  let maps: Awaited<ReturnType<typeof divisionMapsForOrg>> | null = null;
  if (scope) maps = await divisionMapsForOrg(ctx.org.id);

  const now = Date.now();
  const out: FollowUpRow[] = [];
  for (const c of rows) {
    if (!c.cadenceDays || c.cadenceDays < 1) continue;
    if (scope && maps && !divisionVisible(scope, maps.byCustomer.get(c.id) ?? null)) continue;
    const baseline = (c.lastFollowUpAt ?? c.createdAt ?? new Date(now)).getTime();
    const dueAt = baseline + c.cadenceDays * DAY;
    out.push({
      customerId: c.id,
      name: c.name,
      cadenceDays: c.cadenceDays,
      lastFollowUpAt: c.lastFollowUpAt ? c.lastFollowUpAt.toISOString() : null,
      dueAt: new Date(dueAt).toISOString(),
      overdueDays: Math.max(0, Math.floor((now - dueAt) / DAY)),
      due: now >= dueAt,
    });
  }
  out.sort((a, b) => Number(b.due) - Number(a.due) || a.dueAt.localeCompare(b.dueAt));
  return out;
}

export function registerCrmFollowUpRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /**
   * Set (or clear, null) a customer's follow-up cadence, and/or stamp the
   * follow-up as just done. Weekly/biweekly only — that is the owner's
   * actual rhythm; a free-form integer invites noise.
   */
  app.patch("/api/crm/customers/:id/follow-up", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = z.object({
      cadenceDays: z.union([z.literal(7), z.literal(14), z.null()]).optional(),
      markDone: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success || (parsed.data.cadenceDays === undefined && !parsed.data.markDone)) {
      return res.status(400).json({ message: "Send cadenceDays (7, 14 or null) and/or markDone: true" });
    }

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    const patch: any = { updatedAt: new Date() };
    if (parsed.data.cadenceDays !== undefined) patch.followUpCadenceDays = parsed.data.cadenceDays;
    if (parsed.data.markDone) patch.lastFollowUpAt = new Date();
    const [row] = await db.update(crmCustomers).set(patch)
      .where(eq(crmCustomers.id, cust.id)).returning();

    if (parsed.data.markDone) {
      await logTeamActivity({
        orgId: ctx.org.id, memberId: ctx.member.id,
        type: "followUp",
        title: `followed up with ${cust.displayName}`,
        link: `/crm/clients/${cust.id}`,
      });
    }
    res.json({
      id: row.id,
      followUpCadenceDays: row.followUpCadenceDays,
      lastFollowUpAt: row.lastFollowUpAt,
    });
  });

  /** Every customer with a cadence, due first — the "who do I call" list. */
  app.get("/api/crm/follow-ups", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    res.json({ followUps: await followUpsForOrg(ctx) });
  });

  /**
   * The Home Needs-attention card: follow-ups due, brand-new leads, and
   * leads with no estimate yet. Prospect-group stages only — once a project
   * leaves the first swimlane it is being worked, not "attention".
   */
  app.get("/api/crm/attention", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const orgId = ctx.org.id;

    const prospectStages = Object.entries(CRM_PROJECT_STAGE_META)
      .filter(([, m]) => m.group === "Prospect")
      .map(([k]) => k);

    const rows = await db
      .select({
        id: crmProjects.id,
        name: crmProjects.name,
        number: crmProjects.number,
        status: crmProjects.status,
        customerId: crmProjects.customerId,
        divisionId: crmProjects.divisionId,
        pmId: crmProjects.projectManagerMemberId,
        createdAt: crmProjects.createdAt,
        customerName: crmCustomers.displayName,
      })
      .from(crmProjects)
      .leftJoin(crmCustomers, eq(crmCustomers.id, crmProjects.customerId))
      .where(and(
        eq(crmProjects.orgId, orgId),
        isNull(crmProjects.archivedAt),
        inArray(crmProjects.status, prospectStages.length ? prospectStages : ["lead"]),
      ))
      .orderBy(desc(crmProjects.createdAt))
      .limit(200);

    const scope = divisionScopeOf(ctx.member);
    const visible = rows.filter((p) =>
      (ctx.permissions.viewAllJobs || p.pmId === ctx.member.id) &&
      (!scope || divisionVisible(scope, p.divisionId)));

    // An estimate "covers" a lead when it points at the project OR at the
    // lead's customer (estimates created from the client page carry no
    // projectId).
    const estimates = await db
      .select({ projectId: crmEstimates.projectId, customerId: crmEstimates.customerId })
      .from(crmEstimates)
      .where(eq(crmEstimates.orgId, orgId))
      .limit(2000);
    const coveredProjects = new Set(estimates.map((e) => e.projectId).filter(Boolean));
    const coveredCustomers = new Set(estimates.map((e) => e.customerId));

    const present = (p: (typeof visible)[number]) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      status: p.status,
      stageLabel: CRM_PROJECT_STAGE_META[p.status]?.label ?? p.status,
      customerName: p.customerName ?? null,
      createdAt: p.createdAt,
    });

    const cutoff = Date.now() - NEW_LEAD_WINDOW_MS;
    const newLeads = visible
      .filter((p) => (p.createdAt?.getTime() ?? 0) >= cutoff)
      .slice(0, 10)
      .map(present);
    const leadsNeedingEstimate = visible
      .filter((p) => !coveredProjects.has(p.id) && !coveredCustomers.has(p.customerId))
      .slice(0, 10)
      .map(present);

    const followUpsDue = (await followUpsForOrg(ctx)).filter((f) => f.due).slice(0, 10);
    res.json({ followUpsDue, newLeads, leadsNeedingEstimate });
  });
}
