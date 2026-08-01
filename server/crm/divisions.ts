/**
 * CRM divisions — one company, several operating arms (the owner runs a WA
 * headquarters and a Florida division).
 *
 * Three jobs live here:
 *   1. Org-scoped CRUD for crm_divisions (manageSettings to write, any member
 *      to read — the team page needs the list to scope members).
 *   2. Branding resolution for client-facing documents. An estimate or invoice
 *      takes its letterhead from its division — never the WA HQ address on FL
 *      work. Resolution order (first hit wins): the document's project's
 *      division → the customer's most recent project with a division → the
 *      org. Division fields that are null fall back to the org per field.
 *   3. Division list-scoping — STRICT. A member pinned to a division
 *      (divisionId set) who is not the owner sees ONLY their division's rows
 *      in list endpoints. Unassigned (null division) rows are visible only to
 *      owners and division-less members — the owner keeps Braxton out of WA
 *      and Mike/Andrey out of FL, with nothing leaking through the commons.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmDivisions, crmMembers, crmProjects, crmEstimates, crmInvoices,
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
  division: Pick<CrmDivision, "name" | "code" | "email" | "phone" |
    "addressLine1" | "addressLine2" | "city" | "state" | "postalCode" | "licenseNumber" | "licenseState"> | null,
): CompanyBranding {
  const d = division ?? null;
  const dHasAddress = Boolean(d && (d.addressLine1 || d.addressLine2 || d.city || d.state || d.postalCode));
  return {
    name: d?.name ?? org.name,
    legalEntityName: org.legalEntityName,
    email: d?.email ?? org.email,
    phone: d?.phone ?? org.phone,
    website: org.website,
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

/** The division a member's lists are confined to, or null for "everything". */
export function divisionScopeOf(member: { role: string; divisionId: string | null }): string | null {
  if (member.role === "owner") return null;
  return member.divisionId ?? null;
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

// ── DB-side resolution helpers ──────────────────────────────────────────────

export async function getDivision(orgId: string, id: string | null | undefined): Promise<CrmDivision | null> {
  if (!id) return null;
  const [d] = await db.select().from(crmDivisions)
    .where(and(eq(crmDivisions.orgId, orgId), eq(crmDivisions.id, id))).limit(1);
  return d ?? null;
}

/** The customer's most recent project that has a division, if any. */
async function latestCustomerProjectDivision(orgId: string, customerId: string): Promise<CrmDivision | null> {
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

/** Branding division for an estimate: its project's, else the customer's latest project's, else null (= org). */
export async function resolveEstimateDivision(
  est: Pick<typeof crmEstimates.$inferSelect, "orgId" | "customerId" | "projectId">,
): Promise<CrmDivision | null> {
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
    const [e] = await db.select({ projectId: crmEstimates.projectId }).from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, inv.orgId), eq(crmEstimates.id, inv.estimateId))).limit(1);
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
};

/** One pass over the org's projects/estimates so list endpoints can scope in JS. */
export async function divisionMapsForOrg(orgId: string): Promise<DivisionMaps> {
  const projects = await db.select({
    id: crmProjects.id, customerId: crmProjects.customerId,
    divisionId: crmProjects.divisionId, createdAt: crmProjects.createdAt,
  }).from(crmProjects).where(eq(crmProjects.orgId, orgId));
  const estimates = await db.select({
    id: crmEstimates.id, projectId: crmEstimates.projectId, customerId: crmEstimates.customerId,
  }).from(crmEstimates).where(eq(crmEstimates.orgId, orgId));

  const byProject = new Map(projects.map((p) => [p.id, p.divisionId]));
  const byCustomer = new Map<string, string | null>();
  for (const p of [...projects].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))) {
    if (!byCustomer.has(p.customerId)) byCustomer.set(p.customerId, p.divisionId);
  }
  const byEstimate = new Map(estimates.map((e) => [
    e.id,
    (e.projectId ? byProject.get(e.projectId) : undefined) ?? byCustomer.get(e.customerId) ?? null,
  ]));
  return { byProject, byCustomer, byEstimate };
}

/** A document row's division per the resolution order, from prebuilt maps. */
export function docDivisionFromMaps(
  maps: DivisionMaps,
  doc: { projectId?: string | null; estimateId?: string | null; customerId?: string | null },
): string | null {
  if (doc.projectId && maps.byProject.has(doc.projectId)) return maps.byProject.get(doc.projectId) ?? null;
  if (doc.estimateId && maps.byEstimate.has(doc.estimateId)) return maps.byEstimate.get(doc.estimateId) ?? null;
  if (doc.customerId) return maps.byCustomer.get(doc.customerId) ?? null;
  return null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

const divisionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  licenseNumber: z.string().max(80).nullable().optional(),
  licenseState: z.string().max(10).nullable().optional(),
  isHeadquarters: z.boolean().optional(),
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
    const [row] = await db.insert(crmDivisions).values({
      ...parsed.data,
      isHeadquarters: parsed.data.isHeadquarters ?? isFirst,
      orgId: ctx.org.id,
    }).returning();
    res.status(201).json(row);
  });

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
    const [row] = await db.update(crmDivisions)
      .set({ ...parsed.data, updatedAt: new Date() })
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
    if (projects + members > 0) {
      return res.status(409).json({
        message: `This division is still in use by ${projects} project(s) and ${members} member(s). Reassign them first.`,
        projects, members,
      });
    }
    await db.delete(crmDivisions).where(eq(crmDivisions.id, existing.id));
    res.json({ ok: true });
  });
}
