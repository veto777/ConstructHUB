/** One object visibility policy for CRM reads, mutations, files and history.
 * Route permissions still run after this visibility gate, so a denied object
 * always looks absent, including to a caller with a write permission.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as s from "@shared/schema";
import type { OrgContext } from "./tenancy";
import {
  divisionScopeOf, divisionVisible, divisionMapsForOrg, docDivisionFromMaps, pinnedDivisionOf, type DivisionMaps,
} from "./divisions";

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

/** Whole-client bearer grants expose every client document, so only seats
 * with organization-wide document access may mint or receive one. */
export function canShareWholeClientPortal(ctx: OrgContext): boolean {
  // The pin, not the workspace: the owner inside one division workspace still
  // holds organization-wide document access.
  return !pinnedDivisionOf(ctx.member) && ctx.permissions.viewAllJobs && ctx.permissions.seePrices && ctx.permissions.manageCustomers;
}

/**
 * The division a CRM object belongs to, by the one resolution order every
 * list, the workspace filter and the Divisions overview share: a project's own
 * division; an estimate's pick → its project → its client; a client's explicit
 * pick → its projects/estimates → its owner member's; an invoice → its project
 * → estimate → client; any other document → its project → estimate → invoice
 * → client. With no project/client, a visit or report falls back to the
 * division of the member who booked/requested it. null = unassigned.
 */
export async function objectDivision(
  kind: ObjectKind, r: any, m: DivisionMaps,
  memberDivision: (memberId: string) => Promise<string | null> | string | null,
): Promise<string | null> {
  let division: string | null = kind === "projects" ? r.divisionId ?? null
    : kind === "estimates" ? (m.byEstimate.has(r.id) ? m.byEstimate.get(r.id) ?? null : r.divisionId ?? null)
    : kind === "customers" ? m.byCustomer.get(r.id) ?? r.divisionId ?? null
    : kind === "invoices" && m.byInvoice?.has(r.id) ? m.byInvoice.get(r.id) ?? null
    : docDivisionFromMaps(m, r);
  if (!division && (kind === "customers" || kind === "appointments" || kind === "reports" || kind === "measurements")) {
    const memberId = kind === "customers" ? r.ownerMemberId : (!r.projectId && !r.customerId ? r.createdByMemberId ?? r.requestedByMemberId : null);
    if (memberId) division = await memberDivision(memberId);
  }
  return division ?? null;
}

export function objectPolicy(ctx: OrgContext) {
  const cached = new Map<string, Promise<any>>();
  const memberDivs = new Map<string, Promise<string | null>>();
  const memberDivision = (memberId: string): Promise<string | null> => {
    if (!memberDivs.has(memberId)) {
      memberDivs.set(memberId, db.select({ divisionId: s.crmMembers.divisionId }).from(s.crmMembers)
        .where(and(eq(s.crmMembers.orgId, ctx.org.id), eq(s.crmMembers.id, memberId))).limit(1)
        .then((rows) => rows[0]?.divisionId ?? null));
    }
    return memberDivs.get(memberId)!;
  };
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
      // A photo of a check behind a recorded payment: payment / invoice seats only, through the client it belongs to.
      if (r.kind === "payment_proof") {
        if (!ctx.permissions.takePayment && !ctx.permissions.manageInvoices) return false;
        return r.refId ? visible("customers", r.refId) : false;
      }
      // Org collateral: company pamphlets and the "add to all future
      // estimates" library (estimate_default, refId null).
      if (r.kind === "pamphlet" || r.kind === "estimate_default") return true;
      const parent = r.kind === "estimate" || r.kind === "contract" ? "estimates"
        : r.kind === "photo" || r.kind === "measurement" ? "customers" : null;
      return parent && r.refId ? visible(parent, r.refId) : !pinnedDivisionOf(ctx.member) && ctx.permissions.viewAllJobs;
    }
    const scope = divisionScopeOf(ctx);
    if (scope) {
      const division = await objectDivision(kind, r, await divisions(), memberDivision);
      // Workspace mode (an unpinned member inside one division): an unlinked
      // calendar event of a division-less booker is an org event, kept in
      // every workspace so the owner's own blocks never vanish.
      const orgEvent = kind === "appointments" && !division && !r.projectId && !r.customerId && !pinnedDivisionOf(ctx.member);
      if (!orgEvent && !divisionVisible(scope, division)) return false;
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

/** The CRM object an in-app link points at (/crm/clients/:id, /crm/inbox?c=:id, …), or null for an org-level link. */
export function linkedObject(link: string | null | undefined): { kind: ObjectKind; id: string } | null {
  if (!link) return null;
  const m = /^\/crm\/(clients|projects|estimates|invoices)\/([^/?#]+)/.exec(link);
  if (m) return { kind: m[1] === "clients" ? "customers" : m[1] as ObjectKind, id: m[2] };
  const inbox = /^\/crm\/inbox\?(?:.*&)?c=([^&#]+)/.exec(link);
  if (inbox) return { kind: "customers", id: inbox[1] };
  return null;
}

/** Called by requireOrg for every authenticated CRM request. Route templates
 * distinguish object IDs from static paths such as customers/export.csv. */
export async function authorizeObjectRequest(req: any, res: any, ctx: OrgContext): Promise<boolean> {
  const template: string = req.route?.path ?? "";
  if (!template.startsWith("/api/crm/")) return true;
  const policy = objectPolicy(ctx);
  req.crmObjectPolicy = policy;
  // A record hidden only by the division WORKSPACE (the owner is inside FL and
  // opened a WA link) still answers 404 — divisions stay separate — but says
  // why, so the app can offer to switch instead of claiming it doesn't exist.
  let allDivisions: ReturnType<typeof objectPolicy> | null = null;
  const notFound = async (kind: ObjectKind, id: string | undefined) => {
    if (id && ctx.activeDivisionId && !pinnedDivisionOf(ctx.member)) {
      allDivisions ??= objectPolicy({ ...ctx, activeDivisionId: null });
      if (await allDivisions.visible(kind, id)) {
        res.status(404).json({
          code: "other_division",
          message: "This record belongs to another division. Switch to All divisions (or its division) to open it.",
        });
        return false;
      }
    }
    res.status(404).json({ message: "Record not found" });
    return false;
  };
  const parts = template.split("/");
  for (let i = 3; i < parts.length - 1; i++) {
    const kind = parts[i] === "inbox" ? "customers" : parts[i];
    if (!(kind in objectTables) || !parts[i + 1].startsWith(":")) continue;
    const id = req.params[parts[i + 1].slice(1)];
    if (!id || !await policy.visible(kind as ObjectKind, id)) return notFound(kind as ObjectKind, id);
  }
  // Query filters and attachment references must not provide an alternate ID path.
  const refs = { customerId: "customers", projectId: "projects", estimateId: "estimates", invoiceId: "invoices", jobId: "jobs" } as const;
  for (const [key, kind] of Object.entries(refs)) {
    const id = req.query?.[key];
    if (id && (divisionScopeOf(ctx) || !ctx.permissions.viewAllJobs) && !await policy.visible(kind, String(id))) {
      return notFound(kind, String(id));
    }
  }
  if (parts[3] === "attachments") {
    const ref = req.method === "GET" ? req.query : req.body;
    const kind = ref?.kind === "estimate" || ref?.kind === "contract" ? "estimates" : "customers";
    if (ref?.refId && !await policy.visible(kind, String(ref.refId))) return notFound(kind, String(ref.refId));
  }
  // Mutations cannot relink an allowed object into a hidden division/object.
  // Unscoped seats retain their existing validation/error semantics.
  if (divisionScopeOf(ctx) || !ctx.permissions.viewAllJobs) {
    for (const [key, kind] of Object.entries(refs)) {
      const id = req.body?.[key];
      if (id && !await policy.visible(kind, String(id))) return notFound(kind, String(id));
    }
    // A PINNED member can never move work out of their division. The owner in
    // a division workspace may (that is how a record is reassigned; it then
    // leaves the workspace he is in).
    const pinned = pinnedDivisionOf(ctx.member);
    if (pinned && req.body && "divisionId" in req.body && req.body.divisionId !== pinned) {
      res.status(404).json({ message: "Record not found" }); return false;
    }
  }
  return true;
}
