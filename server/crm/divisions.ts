/**
 * CRM divisions — one company, several operating arms (the owner runs a WA
 * headquarters and a Florida division).
 *
 * Three jobs live here:
 *   1. Org-scoped CRUD for crm_divisions (manageSettings to write, any member
 *      to read — the team page needs the list to scope members).
 *   2. Branding resolution for client-facing documents. An estimate or invoice
 *      takes its letterhead from its division — never the WA HQ address on FL
 *      work. Resolution order (first hit wins): the estimate's own division
 *      pick → the document's project's division → the customer's most recent
 *      project with a division → the org. Division fields that are null fall
 *      back to the org per field.
 *   3. Division list-scoping — STRICT. A member pinned to a division
 *      (divisionId set) who is not the owner sees ONLY their division's rows
 *      in list endpoints. Unassigned (null division) rows are visible only to
 *      owners and division-less members — the owner keeps Braxton out of WA
 *      and Mike/Andrey out of FL, with nothing leaking through the commons.
 *      The owner (and any division-less member) can also step INTO one
 *      division — a "workspace" (division-workspaces.ts, tenancy.ts
 *      attachActiveDivision) — and is then scoped exactly like a pinned
 *      member: divisionScopeOf(ctx) answers his workspace.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmDivisions, crmMembers, crmCustomers, crmProjects, crmEstimates, crmInvoices,
  type CrmOrg, type CrmDivision,
} from "@shared/schema";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";

type GetUser = (req: any, res: any) => any;

// ── Branding (pure — unit-tested in divisions.test.ts) ─────────────────────

export type CompanyBranding = {
  name: string;
  legalEntityName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  divisionName: string | null;
  divisionCode: string | null;
};

/**
 * Merge a division over the org into one letterhead. Name/contact/license
 * fall back per field; the address falls back as a BLOCK (a division street
 * address with the org's city would be an address that exists nowhere).
 */
export function companyBranding(
  org: Pick<CrmOrg, "name" | "legalEntityName" | "email" | "phone" | "website" | "logoUrl" |
    "addressLine1" | "addressLine2" | "city" | "state" | "postalCode" | "licenseNumber" | "licenseState">,
  division: Pick<CrmDivision, "name" | "code" | "email" | "phone" | "website" |
    "addressLine1" | "addressLine2" | "city" | "state" | "postalCode" | "licenseNumber" | "licenseState"> | null,
): CompanyBranding {
  const d = division ?? null;
  const dHasAddress = Boolean(d && (d.addressLine1 || d.addressLine2 || d.city || d.state || d.postalCode));
  return {
    name: d?.name ?? org.name,
    legalEntityName: org.legalEntityName,
    email: d?.email ?? org.email,
    phone: d?.phone ?? org.phone,
    website: d?.website ?? org.website,
    logoUrl: org.logoUrl,
    addressLine1: dHasAddress ? d!.addressLine1 : org.addressLine1,
    addressLine2: dHasAddress ? d!.addressLine2 : org.addressLine2,
    city: dHasAddress ? d!.city : org.city,
    state: dHasAddress ? d!.state : org.state,
    postalCode: dHasAddress ? d!.postalCode : org.postalCode,
    licenseNumber: d?.licenseNumber ?? org.licenseNumber,
    licenseState: d?.licenseState ?? org.licenseState,
    divisionName: d?.name ?? null,
    divisionCode: d?.code ?? null,
  };
}

// ── List scoping (pure — unit-tested) ───────────────────────────────────────

type ScopeMember = { role: string; divisionId: string | null };

/**
 * The division a member is PINNED to (never leaves): their divisionId unless
 * they are the owner. Owners and division-less members are unpinned and may
 * pick a division workspace instead (see divisionScopeOf).
 */
export function pinnedDivisionOf(member: ScopeMember): string | null {
  if (member.role === "owner") return null;
  return member.divisionId ?? null;
}

/** Only an unpinned member (the owner, a division-less admin) can switch division workspaces. */
export function canSwitchDivision(member: ScopeMember): boolean {
  return pinnedDivisionOf(member) === null;
}

/**
 * The division a request's lists are confined to, or null for "everything".
 *
 * Pass the request's OrgContext: a pinned member is confined to their
 * division; an unpinned member is confined to the division workspace they
 * picked (ctx.activeDivisionId, resolved by requireOrg from the
 * x-crm-division header / their saved pick), or sees everything in "All
 * divisions". Passing a bare member keeps the old pinned-only answer.
 */
export function divisionScopeOf(subject: ScopeMember | { member: ScopeMember; activeDivisionId?: string | null }): string | null {
  if ("member" in subject) return pinnedDivisionOf(subject.member) ?? subject.activeDivisionId ?? null;
  return pinnedDivisionOf(subject);
}

/**
 * The workspace a request runs in, from the x-crm-division header (or, when
 * the header is absent, the member's saved pick). Pure — the caller passes the
 * org's division ids.
 *   - pinned member → null (the header is IGNORED; their pin already scopes
 *     every list through divisionScopeOf, and a header can never widen it);
 *   - header "all" → null (All divisions);
 *   - header naming one of the org's divisions → that division;
 *   - header absent → the saved pick when it is still one of the org's divisions;
 *   - header naming anything else (a deleted or foreign division) → the saved
 *     pick, else null — never a division outside this org.
 */
export function resolveActiveDivision(
  member: ScopeMember & { activeDivisionId?: string | null },
  header: string | null | undefined,
  orgDivisionIds: readonly string[],
): string | null {
  if (!canSwitchDivision(member)) return null;
  const h = typeof header === "string" ? header.trim() : "";
  if (h.toLowerCase() === "all") return null;
  if (h && orgDivisionIds.includes(h)) return h;
  const saved = member.activeDivisionId ?? null;
  return saved && orgDivisionIds.includes(saved) ? saved : null;
}

/**
 * Is a row with this division visible to a member scoped to `scope`?
 * STRICT: a scoped member sees only their own division's rows — unassigned
 * (null) rows are NOT shared with them; only the unscoped (owners and
 * division-less members) see the commons.
 */
export function divisionVisible(scope: string | null, rowDivisionId: string | null | undefined): boolean {
  if (!scope) return true;
  return rowDivisionId === scope;
}

/**
 * The calendar's variant of the rule. An appointment inherits the scoping of
 * what it is LINKED to:
 *   - linked to a PROJECT → the project's division, STRICT (as above);
 *   - linked only to a CUSTOMER → customers are not division-scoped (every
 *     member can open any client page), so neither is the visit booked from
 *     it. Alpine Exteriors, 2026-08-24: a division-pinned admin booked a site
 *     visit from a client page → POST 201 → the visit vanished from their
 *     schedule AND the client page, because the customer's projects carried
 *     no division (null !== scope). Same class as the unlinked case below.
 *   - UNLINKED (no project, no customer — a sales meeting, a supplier run, a
 *     personal block) → an org calendar event every member sees.
 * `rowDivisionId` is the resolved division of the linked project (callers
 * may still pass a customer-inferred one; it is ignored unless a project is
 * linked).
 */
export function appointmentDivisionVisible(
  scope: string | null,
  appt: { projectId: string | null; customerId: string | null },
  rowDivisionId: string | null | undefined,
): boolean {
  if (!scope) return true;
  if (!appt.projectId) return true;
  return rowDivisionId === scope;
}

// ── DB-side resolution helpers ──────────────────────────────────────────────

export async function getDivision(orgId: string, id: string | null | undefined): Promise<CrmDivision | null> {
  if (!id) return null;
  const [d] = await db.select().from(crmDivisions)
    .where(and(eq(crmDivisions.orgId, orgId), eq(crmDivisions.id, id))).limit(1);
  return d ?? null;
}

/** The customer's most recent project that has a division, else the client's own explicit division, if any. */
async function latestCustomerProjectDivision(orgId: string, customerId: string): Promise<CrmDivision | null> {
  const fromProject = await latestProjectDivisionOnly(orgId, customerId);
  if (fromProject) return fromProject;
  const [c] = await db.select({ divisionId: crmCustomers.divisionId }).from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, customerId))).limit(1);
  return getDivision(orgId, c?.divisionId);
}

async function latestProjectDivisionOnly(orgId: string, customerId: string): Promise<CrmDivision | null> {
  const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
    .where(and(
      eq(crmProjects.orgId, orgId),
      eq(crmProjects.customerId, customerId),
      isNotNull(crmProjects.divisionId),
    ))
    .orderBy(desc(crmProjects.createdAt))
    .limit(1);
  return getDivision(orgId, p?.divisionId);
}

/** Branding division for an estimate: its explicit pick, else its project's, else the customer's latest project's, else null (= org). */
export async function resolveEstimateDivision(
  est: Pick<typeof crmEstimates.$inferSelect, "orgId" | "customerId" | "projectId" | "divisionId">,
): Promise<CrmDivision | null> {
  // An explicit division on the estimate wins — that's how a projectless
  // estimate still goes out under the right arm (FL vs WA).
  const own = await getDivision(est.orgId, est.divisionId);
  if (own) return own;
  if (est.projectId) {
    const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    const d = await getDivision(est.orgId, p?.divisionId);
    if (d) return d;
  }
  return latestCustomerProjectDivision(est.orgId, est.customerId);
}

/** Branding division for an invoice: its project's, else its estimate's project's, else the customer's latest project's. */
export async function resolveInvoiceDivision(
  inv: Pick<typeof crmInvoices.$inferSelect, "orgId" | "customerId" | "projectId" | "estimateId">,
): Promise<CrmDivision | null> {
  if (inv.projectId) {
    const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, inv.orgId), eq(crmProjects.id, inv.projectId))).limit(1);
    const d = await getDivision(inv.orgId, p?.divisionId);
    if (d) return d;
  }
  if (inv.estimateId) {
    const [e] = await db.select({ projectId: crmEstimates.projectId, divisionId: crmEstimates.divisionId })
      .from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, inv.orgId), eq(crmEstimates.id, inv.estimateId))).limit(1);
    // The estimate's explicit division carries through to its invoice.
    const ownDiv = await getDivision(inv.orgId, e?.divisionId);
    if (ownDiv) return ownDiv;
    if (e?.projectId) {
      const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, inv.orgId), eq(crmProjects.id, e.projectId))).limit(1);
      const d = await getDivision(inv.orgId, p?.divisionId);
      if (d) return d;
    }
  }
  return latestCustomerProjectDivision(inv.orgId, inv.customerId);
}

// ── List-scoping maps ───────────────────────────────────────────────────────

export type DivisionMaps = {
  byProject: Map<string, string | null>;
  byCustomer: Map<string, string | null>;
  byEstimate: Map<string, string | null>;
  byInvoice?: Map<string, string | null>;
};

/**
 * One pass over the org's projects/estimates so list endpoints can scope in JS.
 * A client's division: its explicit pick (crm_customers.division_id) → its most
 * recent project's → its most recent estimate's explicit pick → its assigned
 * owner member's. Every link is a real assignment; nothing is guessed.
 */
export async function divisionMapsForOrg(orgId: string): Promise<DivisionMaps> {
  const projects = await db.select({
    id: crmProjects.id, customerId: crmProjects.customerId,
    divisionId: crmProjects.divisionId, createdAt: crmProjects.createdAt,
  }).from(crmProjects).where(eq(crmProjects.orgId, orgId));
  const estimates = await db.select({
    id: crmEstimates.id, projectId: crmEstimates.projectId, customerId: crmEstimates.customerId,
    divisionId: crmEstimates.divisionId, createdAt: crmEstimates.createdAt,
  }).from(crmEstimates).where(eq(crmEstimates.orgId, orgId));
  const explicitCustomers = await db.select({ id: crmCustomers.id, divisionId: crmCustomers.divisionId })
    .from(crmCustomers).where(and(eq(crmCustomers.orgId, orgId), isNotNull(crmCustomers.divisionId)));

  const byProject = new Map(projects.map((p) => [p.id, p.divisionId]));
  const byCustomer = new Map<string, string | null>();
  for (const c of explicitCustomers) byCustomer.set(c.id, c.divisionId);
  for (const p of [...projects].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))) {
    if (!byCustomer.has(p.customerId)) byCustomer.set(p.customerId, p.divisionId);
  }
  for (const e of [...estimates].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))) {
    if (e.divisionId && !byCustomer.get(e.customerId)) byCustomer.set(e.customerId, e.divisionId);
  }
  const assignedCustomers = await db.select({ id: crmCustomers.id, divisionId: crmMembers.divisionId })
    .from(crmCustomers).innerJoin(crmMembers, and(eq(crmMembers.id, crmCustomers.ownerMemberId), eq(crmMembers.orgId, orgId)))
    .where(eq(crmCustomers.orgId, orgId));
  for (const c of assignedCustomers) if (!byCustomer.has(c.id)) byCustomer.set(c.id, c.divisionId);
  const byEstimate = new Map(estimates.map((e) => [
    e.id,
    // The estimate's explicit division pick wins over project/customer inference.
    e.divisionId ??
      ((e.projectId ? byProject.get(e.projectId) : undefined) ?? byCustomer.get(e.customerId) ?? null),
  ]));
  const maps: DivisionMaps = { byProject, byCustomer, byEstimate };
  const invoices = await db.select({
    id: crmInvoices.id, projectId: crmInvoices.projectId, estimateId: crmInvoices.estimateId, customerId: crmInvoices.customerId,
  }).from(crmInvoices).where(eq(crmInvoices.orgId, orgId));
  maps.byInvoice = new Map(invoices.map((i) => [i.id, docDivisionFromMaps(maps, i)]));
  return maps;
}

/** A document row's division per the resolution order, from prebuilt maps. */
export function docDivisionFromMaps(
  maps: DivisionMaps,
  doc: { projectId?: string | null; estimateId?: string | null; invoiceId?: string | null; customerId?: string | null },
): string | null {
  if (doc.projectId && maps.byProject.has(doc.projectId)) return maps.byProject.get(doc.projectId) ?? null;
  if (doc.estimateId && maps.byEstimate.has(doc.estimateId)) return maps.byEstimate.get(doc.estimateId) ?? null;
  // A payment against an invoice belongs where its invoice does.
  if (doc.invoiceId && maps.byInvoice?.has(doc.invoiceId)) return maps.byInvoice.get(doc.invoiceId) ?? null;
  if (doc.customerId) return maps.byCustomer.get(doc.customerId) ?? null;
  return null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

const divisionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  licenseNumber: z.string().max(80).nullable().optional(),
  licenseState: z.string().max(10).nullable().optional(),
  isHeadquarters: z.boolean().optional(),
  // Sales-tax override map, stored at custom_fields->taxRates:
  // { default: bps, cities: { CityName: bps } }. Resolved by server/crm/tax.ts.
  // Accepted on PATCH (merged, never a wholesale custom_fields replace).
  taxRates: z.object({
    default: z.number().int().min(0).max(3000).nullable().optional(),
    cities: z.record(z.number().int().min(0).max(3000)).optional(),
  }).nullable().optional(),
});

export function registerCrmDivisionRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /** Any member can read divisions — the team page scopes people with it. */
  app.get("/api/crm/divisions", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmDivisions)
      .where(eq(crmDivisions.orgId, ctx.org.id))
      .orderBy(desc(crmDivisions.isHeadquarters), asc(crmDivisions.name));
    res.json(rows);
  });

  // Create a division — the Divisions card on the Settings page (the first
  // division becomes headquarters; codes are unique per org).
  app.post("/api/crm/divisions", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const parsed = divisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid division", issues: parsed.error.issues });

    const dupe = await db.select({ id: crmDivisions.id }).from(crmDivisions)
      .where(and(eq(crmDivisions.orgId, ctx.org.id), sql`lower(${crmDivisions.code}) = ${parsed.data.code.toLowerCase()}`))
      .limit(1);
    if (dupe.length) return res.status(409).json({ message: `A division with code "${parsed.data.code}" already exists.` });

    if (parsed.data.isHeadquarters) {
      await db.update(crmDivisions).set({ isHeadquarters: false, updatedAt: new Date() })
        .where(eq(crmDivisions.orgId, ctx.org.id));
    }
    // The first division of an org is the headquarters by default.
    const isFirst = !(await db.select({ id: crmDivisions.id }).from(crmDivisions)
      .where(eq(crmDivisions.orgId, ctx.org.id)).limit(1)).length;
    // taxRates is PATCH-only (stored in custom_fields, not a column).
    const { taxRates: _taxRates, ...createData } = parsed.data;
    const [row] = await db.insert(crmDivisions).values({
      ...createData,
      isHeadquarters: parsed.data.isHeadquarters ?? isFirst,
      orgId: ctx.org.id,
    }).returning();
    res.status(201).json(row);
  });

  // Rename/re-scope a division or edit its address/tax rates — the Divisions
  // card's edit dialog on the Settings page.
  app.patch("/api/crm/divisions/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const parsed = divisionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid division", issues: parsed.error.issues });

    const [existing] = await db.select().from(crmDivisions)
      .where(and(eq(crmDivisions.orgId, ctx.org.id), eq(crmDivisions.id, req.params.id))).limit(1);
    if (!existing) return res.status(404).json({ message: "Division not found" });

    if (parsed.data.code && parsed.data.code.toLowerCase() !== existing.code.toLowerCase()) {
      const dupe = await db.select({ id: crmDivisions.id }).from(crmDivisions)
        .where(and(eq(crmDivisions.orgId, ctx.org.id), sql`lower(${crmDivisions.code}) = ${parsed.data.code.toLowerCase()}`))
        .limit(1);
      if (dupe.length) return res.status(409).json({ message: `A division with code "${parsed.data.code}" already exists.` });
    }
    // HQ is a single-winner flag: setting it clears the others.
    if (parsed.data.isHeadquarters === true) {
      await db.update(crmDivisions).set({ isHeadquarters: false, updatedAt: new Date() })
        .where(eq(crmDivisions.orgId, ctx.org.id));
    }
    // taxRates merges INTO custom_fields (never a wholesale replace) — the
    // same rule as the org's notificationPrefs.
    const { taxRates, ...patch } = parsed.data;
    const [row] = await db.update(crmDivisions)
      .set({
        ...patch,
        ...(taxRates !== undefined
          ? { customFields: { ...((existing.customFields as Record<string, unknown> | null) ?? {}), taxRates } }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(crmDivisions.id, existing.id))
      .returning();
    res.json(row);
  });

  /** Refuse to delete a division that's in use — history must keep resolving. */
  app.delete("/api/crm/divisions/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const [existing] = await db.select().from(crmDivisions)
      .where(and(eq(crmDivisions.orgId, ctx.org.id), eq(crmDivisions.id, req.params.id))).limit(1);
    if (!existing) return res.status(404).json({ message: "Division not found" });

    const [{ n: projects }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmProjects)
      .where(eq(crmProjects.divisionId, existing.id));
    const [{ n: members }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmMembers)
      .where(eq(crmMembers.divisionId, existing.id));
    // Estimates and clients carry their own division too: deleting it would
    // drop them out of every workspace and change their letterhead.
    const [{ n: estimates }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.divisionId, existing.id)));
    const [{ n: customers }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.divisionId, existing.id)));
    if (projects + members + estimates + customers > 0) {
      const used = [
        projects ? `${projects} project(s)` : null, estimates ? `${estimates} estimate(s)` : null,
        customers ? `${customers} client(s)` : null, members ? `${members} member(s)` : null,
      ].filter(Boolean).join(", ");
      return res.status(409).json({
        message: `This division is still in use by ${used}. Reassign them first.`,
        projects, members, estimates, customers,
      });
    }
    await db.delete(crmDivisions).where(eq(crmDivisions.id, existing.id));
    // Anyone whose saved workspace was this division lands back on All divisions.
    await db.update(crmMembers).set({ activeDivisionId: null })
      .where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.activeDivisionId, existing.id)));
    res.json({ ok: true });
  });
}
