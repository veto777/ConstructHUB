/**
 * CRM entities — customers, projects, jobs, estimates.
 *
 * Two rules hold everywhere in this file:
 *   1. Every query is scoped by the caller's active org. Never trust an org id
 *      from the request.
 *   2. Prices and costs are stripped server-side based on permissions, not
 *      hidden in the UI. A PM shared onto a client list must not be able to read
 *      pricing out of the JSON.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmCustomers, crmProjects, crmJobs, crmEstimates, crmEstimateItems,
  crmEstimateEvents, crmLeadSources,
  CRM_PROJECT_STATUSES, CRM_JOB_STATUSES, CRM_LINE_ITEM_KINDS,
  CRM_PROJECT_STAGE_META,
} from "@shared/schema";
import { and, eq, desc, asc, ilike, or, sql, isNull } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");

// ── Presenters: the permission boundary ─────────────────────────────────────

/** Cost is stricter than price — a rep may see price but never margin. */
function presentEstimateItem(i: typeof crmEstimateItems.$inferSelect, ctx: OrgContext) {
  const base = {
    id: i.id, sortOrder: i.sortOrder, kind: i.kind, name: i.name,
    description: i.description, quantityMilli: i.quantityMilli, unit: i.unit,
    taxable: i.taxable, hiddenFromClient: i.hiddenFromClient,
  };
  return {
    ...base,
    unitPriceCents: ctx.permissions.seePrices ? i.unitPriceCents : undefined,
    unitCostCents: ctx.permissions.seeCosts ? i.unitCostCents : undefined,
  };
}

function presentEstimate(e: typeof crmEstimates.$inferSelect, ctx: OrgContext) {
  const money = ctx.permissions.seePrices;
  return {
    id: e.id, customerId: e.customerId, projectId: e.projectId, number: e.number,
    title: e.title, status: e.status, introText: e.introText, termsText: e.termsText,
    subtotalCents: money ? e.subtotalCents : undefined,
    discountCents: money ? e.discountCents : undefined,
    taxRateBps: money ? e.taxRateBps : undefined,
    taxCents: money ? e.taxCents : undefined,
    totalCents: money ? e.totalCents : undefined,
    depositCents: money ? e.depositCents : undefined,
    sentAt: e.sentAt, sentToEmail: e.sentToEmail,
    firstViewedAt: e.firstViewedAt, lastViewedAt: e.lastViewedAt, viewCount: e.viewCount,
    approvedAt: e.approvedAt, declinedAt: e.declinedAt, declineReason: e.declineReason,
    signatureName: e.signatureName, expiresAt: e.expiresAt,
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

function presentProject(p: typeof crmProjects.$inferSelect, ctx: OrgContext) {
  const money = ctx.permissions.seePrices;
  return {
    ...p,
    contractValueCents: money ? p.contractValueCents : undefined,
    budgetCents: ctx.permissions.seeCosts ? p.budgetCents : undefined,
    stageLabel: CRM_PROJECT_STAGE_META[p.status]?.label ?? p.status,
    stageGroup: CRM_PROJECT_STAGE_META[p.status]?.group ?? "Other",
  };
}

/** Recompute totals from line items. Client-supplied totals are ignored. */
async function recalcEstimate(orgId: string, estimateId: string) {
  const items = await db.select().from(crmEstimateItems)
    .where(and(eq(crmEstimateItems.orgId, orgId), eq(crmEstimateItems.estimateId, estimateId)));
  const [est] = await db.select().from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.id, estimateId))).limit(1);
  if (!est) return null;

  let subtotal = 0, taxable = 0, discount = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { discount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const taxBase = Math.max(0, taxable - discount);
  const tax = Math.round((taxBase * (est.taxRateBps || 0)) / 10000);
  const total = Math.max(0, subtotal - discount + tax);

  const [row] = await db.update(crmEstimates).set({
    subtotalCents: subtotal, discountCents: discount, taxCents: tax,
    totalCents: total, updatedAt: new Date(),
  }).where(eq(crmEstimates.id, estimateId)).returning();
  return row;
}

async function logEvent(orgId: string, estimateId: string, type: string, actor: string, req?: any, meta?: any) {
  await db.insert(crmEstimateEvents).values({
    orgId, estimateId, type, actor,
    ip: req ? String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() : null,
    userAgent: req ? String(req.headers["user-agent"] || "").slice(0, 300) : null,
    meta: meta ?? null,
  }).catch(() => {});
}

// ── Validation ──────────────────────────────────────────────────────────────

const customerSchema = z.object({
  displayName: z.string().min(1).max(200),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  altPhone: z.string().max(40).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  leadSourceId: z.string().max(64).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const projectSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(CRM_PROJECT_STATUSES as unknown as [string, ...string[]]).optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  trades: z.array(z.string().max(60)).max(20).nullable().optional(),
  projectManagerMemberId: z.string().max(64).nullable().optional(),
  salesMemberId: z.string().max(64).nullable().optional(),
  contractValueCents: z.number().int().min(0).nullable().optional(),
  budgetCents: z.number().int().min(0).nullable().optional(),
  permitNumber: z.string().max(80).nullable().optional(),
  parcelNumber: z.string().max(80).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const jobSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  trade: z.string().max(60).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(CRM_JOB_STATUSES as unknown as [string, ...string[]]).optional(),
  assignedMemberIds: z.array(z.string().max(64)).max(50).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const itemSchema = z.object({
  kind: z.enum(CRM_LINE_ITEM_KINDS as unknown as [string, ...string[]]).default("labor"),
  name: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
  unit: z.string().max(20).nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(1_000_000_00).default(0),
  unitCostCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  taxable: z.boolean().default(true),
  hiddenFromClient: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export function registerCrmEntityRoutes(app: Express, getDevUser: GetUser): void {
  /** Boilerplate every authed route needs: user + org + optional permission. */
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  app.get("/api/crm/customers", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const q = String(req.query.q || "").trim();
    const where = [eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt)];
    if (q) {
      where.push(or(
        ilike(crmCustomers.displayName, `%${q}%`),
        ilike(crmCustomers.email, `%${q}%`),
        ilike(crmCustomers.phone, `%${q}%`),
        ilike(crmCustomers.addressLine1, `%${q}%`),
      ) as any);
    }
    const rows = await db.select().from(crmCustomers).where(and(...where))
      .orderBy(desc(crmCustomers.createdAt)).limit(500);
    // The client list itself is shareable with a PM; pricing lives elsewhere.
    res.json(rows.map((c) => ({ ...c, portalToken: undefined })));
  });

  app.post("/api/crm/customers", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid customer", issues: parsed.error.issues });

    // Dedupe. Leap admits it cannot merge customer records or move a job between
    // them ("the answer is no, not currently"), so their users accumulate
    // duplicates permanently. Refuse the duplicate at the door instead, and tell
    // the caller which record already exists.
    const dupeOn = [
      parsed.data.email ? sql`lower(${crmCustomers.email}) = ${parsed.data.email.toLowerCase()}` : null,
      parsed.data.phone ? sql`regexp_replace(${crmCustomers.phone}, '[^0-9]', '', 'g') = ${parsed.data.phone.replace(/\D/g, "")}` : null,
    ].filter(Boolean) as any[];
    if (dupeOn.length && req.query.force !== "1") {
      const existing = await db.select().from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt),
          or(...dupeOn) as any)).limit(3);
      if (existing.length) {
        return res.status(409).json({
          message: "A client with that email or phone already exists.",
          matches: existing.map((c) => ({
            id: c.id, displayName: c.displayName, email: c.email, phone: c.phone,
          })),
          hint: "Open the existing client, or POST again with ?force=1 to create anyway.",
        });
      }
    }

    // The client portal is created WITH the customer — that's the requirement.
    const [row] = await db.insert(crmCustomers).values({
      ...parsed.data, orgId: ctx.org.id, ownerMemberId: ctx.member.id, portalToken: token(),
    } as any).returning();
    res.status(201).json({ ...row, portalToken: undefined, portalPath: `/portal/${row.portalToken}` });
  });

  app.get("/api/crm/customers/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!c) return res.status(404).json({ message: "Customer not found" });

    const projects = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.customerId, c.id)))
      .orderBy(desc(crmProjects.createdAt));
    const estimates = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.customerId, c.id)))
      .orderBy(desc(crmEstimates.createdAt));

    res.json({
      customer: { ...c, portalToken: undefined },
      // Only someone who can manage customers gets the shareable portal link.
      portalPath: ctx.permissions.manageCustomers ? `/portal/${c.portalToken}` : undefined,
      projects: projects.map((p) => presentProject(p, ctx)),
      estimates: estimates.map((e) => presentEstimate(e, ctx)),
    });
  });

  app.patch("/api/crm/customers/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = customerSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid customer", issues: parsed.error.issues });
    const [row] = await db.update(crmCustomers)
      .set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ message: "Customer not found" });
    res.json({ ...row, portalToken: undefined });
  });

  // ── Projects ──────────────────────────────────────────────────────────────

  app.get("/api/crm/projects", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmProjects.orgId, ctx.org.id), isNull(crmProjects.archivedAt)];
    if (req.query.status) where.push(eq(crmProjects.status, String(req.query.status)));
    if (req.query.customerId) where.push(eq(crmProjects.customerId, String(req.query.customerId)));
    // A field tech without viewAllJobs sees only projects they're PM on.
    if (!ctx.permissions.viewAllJobs) where.push(eq(crmProjects.projectManagerMemberId, ctx.member.id));

    const rows = await db.select().from(crmProjects).where(and(...where))
      .orderBy(desc(crmProjects.createdAt)).limit(500);
    res.json({
      projects: rows.map((p) => presentProject(p, ctx)),
      stages: CRM_PROJECT_STATUSES.map((s) => ({ key: s, ...CRM_PROJECT_STAGE_META[s] })),
    });
  });

  app.post("/api/crm/projects", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid project", issues: parsed.error.issues });

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, parsed.data.customerId))).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found in this organization" });

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmProjects)
      .where(eq(crmProjects.orgId, ctx.org.id));
    const [row] = await db.insert(crmProjects).values({
      ...parsed.data, orgId: ctx.org.id, number: `P-${1000 + n + 1}`,
    } as any).returning();
    res.status(201).json(presentProject(row, ctx));
  });

  app.patch("/api/crm/projects/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid project", issues: parsed.error.issues });
    // budget is cost-side data
    if (parsed.data.budgetCents !== undefined && !ctx.permissions.seeCosts) {
      return res.status(403).json({ message: "Requires permission: seeCosts" });
    }
    const patch: any = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.status) patch.stageChangedAt = new Date();
    const [row] = await db.update(crmProjects).set(patch)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Project not found" });
    res.json(presentProject(row, ctx));
  });

  // ── Jobs (per-trade scopes) ───────────────────────────────────────────────

  app.get("/api/crm/jobs", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmJobs.orgId, ctx.org.id)];
    if (req.query.projectId) where.push(eq(crmJobs.projectId, String(req.query.projectId)));
    const rows = await db.select().from(crmJobs).where(and(...where)).orderBy(asc(crmJobs.createdAt)).limit(500);
    const visible = ctx.permissions.viewAllJobs
      ? rows
      : rows.filter((j) => (j.assignedMemberIds || []).includes(ctx.member.id));
    res.json({ jobs: visible, statuses: CRM_JOB_STATUSES });
  });

  app.post("/api/crm/jobs", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = jobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid job", issues: parsed.error.issues });
    const [proj] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, parsed.data.projectId))).limit(1);
    if (!proj) return res.status(400).json({ message: "Project not found in this organization" });
    const [row] = await db.insert(crmJobs).values({ ...parsed.data, orgId: ctx.org.id } as any).returning();
    res.status(201).json(row);
  });

  app.patch("/api/crm/jobs/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = jobSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid job", issues: parsed.error.issues });
    const [row] = await db.update(crmJobs).set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(and(eq(crmJobs.orgId, ctx.org.id), eq(crmJobs.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Job not found" });
    res.json(row);
  });

  // ── Estimates ─────────────────────────────────────────────────────────────

  app.get("/api/crm/estimates", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmEstimates.orgId, ctx.org.id)];
    if (req.query.customerId) where.push(eq(crmEstimates.customerId, String(req.query.customerId)));
    if (req.query.status) where.push(eq(crmEstimates.status, String(req.query.status)));
    const rows = await db.select().from(crmEstimates).where(and(...where))
      .orderBy(desc(crmEstimates.createdAt)).limit(500);
    res.json(rows.map((e) => presentEstimate(e, ctx)));
  });

  app.post("/api/crm/estimates", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const schema = z.object({
      customerId: z.string().min(1),
      projectId: z.string().nullable().optional(),
      title: z.string().max(200).default("Estimate"),
      introText: z.string().max(8000).nullable().optional(),
      termsText: z.string().max(20000).nullable().optional(),
      taxRateBps: z.number().int().min(0).max(3000).default(0),
      depositCents: z.number().int().min(0).nullable().optional(),
      expiresInDays: z.number().int().min(1).max(365).default(30),
      items: z.array(itemSchema).max(300).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid estimate", issues: parsed.error.issues });
    const d = parsed.data;

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, d.customerId))).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found in this organization" });

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmEstimates)
      .where(eq(crmEstimates.orgId, ctx.org.id));

    const [est] = await db.insert(crmEstimates).values({
      orgId: ctx.org.id, customerId: d.customerId, projectId: d.projectId ?? null,
      number: `E-${1000 + n + 1}`, title: d.title, introText: d.introText ?? null,
      termsText: d.termsText ?? ctx.org.termsAndConditions ?? null,
      taxRateBps: d.taxRateBps, depositCents: d.depositCents ?? null,
      publicToken: token(), createdByMemberId: ctx.member.id,
      expiresAt: new Date(Date.now() + d.expiresInDays * 86400000),
    } as any).returning();

    if (d.items.length) {
      await db.insert(crmEstimateItems).values(
        d.items.map((it, idx) => ({ ...it, orgId: ctx.org.id, estimateId: est.id, sortOrder: it.sortOrder ?? idx })) as any,
      );
    }
    const fresh = await recalcEstimate(ctx.org.id, est.id);
    await logEvent(ctx.org.id, est.id, "created", ctx.member.id, req);
    res.status(201).json(presentEstimate(fresh ?? est, ctx));
  });

  app.get("/api/crm/estimates/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    const items = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)))
      .orderBy(asc(crmEstimateItems.sortOrder));
    const events = await db.select().from(crmEstimateEvents)
      .where(and(eq(crmEstimateEvents.orgId, ctx.org.id), eq(crmEstimateEvents.estimateId, e.id)))
      .orderBy(desc(crmEstimateEvents.createdAt)).limit(100);
    const [cust] = await db.select().from(crmCustomers)
      .where(eq(crmCustomers.id, e.customerId)).limit(1);
    res.json({
      estimate: presentEstimate(e, ctx),
      items: items.map((i) => presentEstimateItem(i, ctx)),
      events,
      customer: cust ? { id: cust.id, displayName: cust.displayName, email: cust.email, phone: cust.phone } : null,
      publicPath: ctx.permissions.manageEstimates ? `/e/${e.publicToken}` : undefined,
    });
  });

  app.put("/api/crm/estimates/:id/items", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ items: z.array(itemSchema).max(300) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid items", issues: parsed.error.issues });
    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    if (e.approvedAt) return res.status(409).json({ message: "This estimate has been approved and can no longer be edited." });

    await db.delete(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)));
    if (parsed.data.items.length) {
      await db.insert(crmEstimateItems).values(
        parsed.data.items.map((it, idx) => ({ ...it, orgId: ctx.org.id, estimateId: e.id, sortOrder: it.sortOrder ?? idx })) as any,
      );
    }
    const fresh = await recalcEstimate(ctx.org.id, e.id);
    res.json(presentEstimate(fresh ?? e, ctx));
  });

  app.get("/api/crm/lead-sources", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmLeadSources)
      .where(and(eq(crmLeadSources.orgId, ctx.org.id), eq(crmLeadSources.active, true)))
      .orderBy(asc(crmLeadSources.name));
    res.json(rows);
  });

  app.post("/api/crm/lead-sources", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "name required" });
    const [row] = await db.insert(crmLeadSources).values({ orgId: ctx.org.id, name }).returning();
    res.status(201).json(row);
  });
}

export { recalcEstimate, logEvent, presentEstimate, presentEstimateItem };
