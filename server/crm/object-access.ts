/** One object visibility policy for CRM reads, mutations, files and history.
 * Route permissions still run after this visibility gate, so a denied object
 * always looks absent, including to a caller with a write permission.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as s from "@shared/schema";
import type { OrgContext } from "./tenancy";
import { divisionScopeOf, divisionVisible, divisionMapsForOrg, docDivisionFromMaps } from "./divisions";

export const objectTables = {
  customers: s.crmCustomers, projects: s.crmProjects, jobs: s.crmJobs,
  estimates: s.crmEstimates, invoices: s.crmInvoices, appointments: s.crmAppointments,
  "change-orders": s.crmChangeOrders, attachments: s.crmAttachments,
  payments: s.crmPayments, reports: s.crmMeasurements, measurements: s.crmMeasurements,
  "budget-lines": s.crmBudgetLines, phases: s.crmPhases,
  "punch-items": s.crmPunchItems, selections: s.crmSelections,
  "client-comments": s.crmClientComments,
} as const;
export type ObjectKind = keyof typeof objectTables;

export function objectPolicy(ctx: OrgContext) {
  const cached = new Map<string, Promise<any>>();
  let maps: ReturnType<typeof divisionMapsForOrg> | undefined;
  const divisions = () => maps ??= divisionMapsForOrg(ctx.org.id);
  async function row(kind: ObjectKind, id: string): Promise<any> {
    const key = `${kind}:${id}`;
    if (!cached.has(key)) {
      const table = objectTables[kind];
      cached.set(key, db.select().from(table).where(and(eq(table.orgId, ctx.org.id), eq(table.id, id)))
        .limit(1).then(rows => rows[0]));
    }
    return cached.get(key);
  }
  async function projectAssigned(id: string | null): Promise<boolean> {
    if (!id) return false;
    const p = await row("projects", id);
    if (!p) return false;
    if (p.projectManagerMemberId === ctx.member.id || p.salesMemberId === ctx.member.id) return true;
    const jobs = await db.select().from(s.crmJobs).where(and(eq(s.crmJobs.orgId, ctx.org.id), eq(s.crmJobs.projectId, id)));
    return jobs.some(j => j.assignedMemberIds?.includes(ctx.member.id));
  }
  async function visible(kind: ObjectKind, id: string): Promise<boolean> {
    const r = await row(kind, id);
    if (!r) return false;
    // Attachments inherit their actual parent, never merely the org.
    if (kind === "attachments") {
      if ((r.kind === "contract" || r.kind === "estimate") && !ctx.permissions.seePrices) return false;
      if (r.kind === "pamphlet") return true; // org price-book collateral
      const parent = r.kind === "estimate" || r.kind === "contract" ? "estimates"
        : r.kind === "photo" || r.kind === "measurement" ? "customers" : null;
      return parent && r.refId ? visible(parent, r.refId) : !divisionScopeOf(ctx.member) && ctx.permissions.viewAllJobs;
    }
    let division: string | null = null;
    const scope = divisionScopeOf(ctx.member);
    if (scope) {
      const m = await divisions();
      division = kind === "projects" ? r.divisionId
        : kind === "estimates" ? m.byEstimate.get(r.id)
        : kind === "customers" ? m.byCustomer.get(r.id)
        : docDivisionFromMaps(m, r);
      // An unlinked appointment belongs to its booker's division; a customer
      // belongs to its explicitly assigned owner's division when no project exists.
      if (!division && (kind === "customers" || kind === "appointments" || kind === "reports" || kind === "measurements")) {
        const memberId = kind === "customers" ? r.ownerMemberId : (!r.projectId && !r.customerId ? r.createdByMemberId ?? r.requestedByMemberId : null);
        if (memberId) {
          const [m] = await db.select().from(s.crmMembers).where(and(eq(s.crmMembers.orgId, ctx.org.id), eq(s.crmMembers.id, memberId))).limit(1);
          division = m?.divisionId ?? null;
        }
      }
      if (!divisionVisible(scope, division)) return false;
    }
    if (ctx.permissions.viewAllJobs) return true;
    if ((kind === "reports" || kind === "measurements") && r.requestedByMemberId === ctx.member.id) return true;
    if (kind === "appointments") return r.createdByMemberId === ctx.member.id || (r.dispatchedMemberIds ?? []).includes(ctx.member.id);
    if (kind === "jobs") return (r.assignedMemberIds ?? []).includes(ctx.member.id);
    if (kind === "customers") {
      if (r.ownerMemberId === ctx.member.id) return true;
      const projects = await db.select().from(s.crmProjects).where(and(eq(s.crmProjects.orgId, ctx.org.id), eq(s.crmProjects.customerId, r.id)));
      for (const p of projects) if (await visible("projects", p.id)) return true;
      return false;
    }
    if (kind === "projects") return projectAssigned(r.id);
    if (kind === "estimates" && r.createdByMemberId === ctx.member.id) return true;
    if (r.projectId) return projectAssigned(r.projectId);
    if (r.estimateId) return visible("estimates", r.estimateId);
    if (r.customerId) return visible("customers", r.customerId);
    return false;
  }
  async function filter<T extends { id: string }>(kind: ObjectKind, rows: T[]): Promise<T[]> {
    for (const r of rows) if ("orgId" in r && r.orgId === ctx.org.id) cached.set(`${kind}:${r.id}`, Promise.resolve(r));
    const allowed = await Promise.all(rows.map(r => visible(kind, r.id)));
    return rows.filter((_, i) => allowed[i]);
  }
  return { visible, filter };
}

/** Called by requireOrg for every authenticated CRM request. Route templates
 * distinguish object IDs from static paths such as customers/export.csv. */
export async function authorizeObjectRequest(req: any, res: any, ctx: OrgContext): Promise<boolean> {
  const template: string = req.route?.path ?? "";
  if (!template.startsWith("/api/crm/")) return true;
  const policy = objectPolicy(ctx);
  req.crmObjectPolicy = policy;
  const parts = template.split("/");
  for (let i = 3; i < parts.length - 1; i++) {
    const kind = parts[i] === "inbox" ? "customers" : parts[i];
    if (!(kind in objectTables) || !parts[i + 1].startsWith(":")) continue;
    const id = req.params[parts[i + 1].slice(1)];
    if (!id || !await policy.visible(kind as ObjectKind, id)) {
      res.status(404).json({ message: "Record not found" }); return false;
    }
  }
  // Query filters and attachment references must not provide an alternate ID path.
  const refs = { customerId: "customers", projectId: "projects", estimateId: "estimates", invoiceId: "invoices", jobId: "jobs" } as const;
  for (const [key, kind] of Object.entries(refs)) {
    const id = req.query?.[key];
    if (id && (divisionScopeOf(ctx.member) || !ctx.permissions.viewAllJobs) && !await policy.visible(kind, String(id))) {
      res.status(404).json({ message: "Record not found" }); return false;
    }
  }
  if (parts[3] === "attachments") {
    const ref = req.method === "GET" ? req.query : req.body;
    const kind = ref?.kind === "estimate" || ref?.kind === "contract" ? "estimates" : "customers";
    if (ref?.refId && !await policy.visible(kind, String(ref.refId))) {
      res.status(404).json({ message: "Record not found" }); return false;
    }
  }
  // Mutations cannot relink an allowed object into a hidden division/object.
  // Unscoped seats retain their existing validation/error semantics.
  if (divisionScopeOf(ctx.member) || !ctx.permissions.viewAllJobs) {
    for (const [key, kind] of Object.entries(refs)) {
      const id = req.body?.[key];
      if (id && !await policy.visible(kind, String(id))) {
        res.status(404).json({ message: "Record not found" }); return false;
      }
    }
    if (divisionScopeOf(ctx.member) && req.body && "divisionId" in req.body && req.body.divisionId !== divisionScopeOf(ctx.member)) {
      res.status(404).json({ message: "Record not found" }); return false;
    }
  }
  return true;
}
