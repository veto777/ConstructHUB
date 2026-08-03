/**
 * The construction half: invoices + progress billing + retainage, the cost-code
 * budget ledger, scheduling with per-visit crews, change orders, punch lists,
 * daily logs, selections & allowances, and permit attachment.
 *
 * Verified absent from Leap's shipped bundle (zero hits for cost code, budget,
 * actual cost, retainage, punch list, daily log, allowance) and from Housecall
 * Pro's API. This file is the differentiator.
 *
 * Same two rules as everywhere: org-scoped queries, and money/cost stripped
 * server-side by permission.
 */
import type { Express } from "express";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmInvoices, crmInvoiceItems, crmCostCodes, crmPhases, crmBudgetLines,
  crmCommitments, crmCostEntries, crmAppointments, crmChangeOrders,
  crmPunchItems, crmDailyLogs, crmSelections, crmEstimateOptions,
  crmApiKeys, crmWebhooks, crmProjects, crmCustomers, crmOrgs, crmEstimates,
  crmEstimateItems, crmPayments, crmMembers, permitDatabases, propertyAppraisers,
  crmNotificationEnabled, crmEngagementSessions, crmCustomerNotes,
  CRM_WEBHOOK_EVENTS, CRM_CHANGE_ORDER_STATUSES, CRM_APPOINTMENT_STATUSES,
  CRM_PUNCH_STATUSES, CRM_SELECTION_STATUSES, CRM_COMMITMENT_TYPES,
  CRM_LINE_ITEM_KINDS,
} from "@shared/schema";
import { and, eq, gte, lte, desc, asc, sql, ilike, isNull } from "drizzle-orm";
import { requireOrg, requirePermission, requireOwnerRole, type OrgContext } from "./tenancy";
import { divisionScopeOf, divisionVisible, divisionMapsForOrg, docDivisionFromMaps } from "./divisions";
import { emitCrmEvent, webhookUrlIsSafe } from "./integrations";
import { autoSendPaymentReceipt } from "./receipts";
import { logActivity } from "./activity";
import { sendWithFallback } from "../email";
import { textOrgOwners } from "./sms";
import { notifyMembers } from "./notify";
import { getBaseUrl } from "../auth";

type GetUser = (req: any, res: any) => any;
const tok = () => randomBytes(24).toString("hex");

/** Human label for a payment method, used in the "payment received" email. */
const METHOD_LABELS: Record<string, string> = {
  cash: "cash", check: "check", wire: "wire transfer", credit_card: "credit card",
  ach: "bank transfer (ACH)", card: "card", other: "another method",
};

/**
 * Why an invoice may NOT be hard-deleted, or null when it can. A paid invoice
 * — or one with ANY payment row recorded against it — is a money trail and is
 * never deletable (voiding is the audit-preserving path for unpaid ones).
 */
export function invoiceDeleteRefusal(
  inv: { status: string; paidCents: number | null; paidAt: Date | null },
  paymentCount: number,
): string | null {
  if (inv.status === "paid" || (inv.paidCents ?? 0) > 0 || inv.paidAt) {
    return "This invoice has been paid — paid money trails are never deletable.";
  }
  if (paymentCount > 0) {
    return "Payments have been recorded against this invoice; it cannot be deleted.";
  }
  return null;
}

/** Tell the org owner money landed on an invoice (manual entry). Best-effort:
 *  email must never fail the request that recorded the payment. */
async function notifyPaymentRecorded(
  org: typeof crmOrgs.$inferSelect,
  inv: typeof crmInvoices.$inferSelect,
  amountCents: number,
  method: string,
) {
  // The org can silence this notification in Settings (default: on).
  if (!crmNotificationEnabled(org.customFields, "paymentReceived")) return;
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
  const owners = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active"), eq(crmMembers.role, "owner")));
  const to = new Set<string>();
  if (org.email) to.add(org.email);
  for (const m of owners) if (m.email) to.add(m.email);
  if (!to.size) return;
  const amount = `$${(amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const via = METHOD_LABELS[method] ?? method;
  const who = cust?.displayName ?? "a client";
  const doc = inv.number ?? "an invoice";
  await sendWithFallback({
    to: [...to].join(","),
    subject: `Payment received — ${amount} via ${via} from ${who} for invoice ${inv.number ?? ""}`.trim(),
    html: `<p><strong>${amount}</strong> received via <strong>${via}</strong> from ${who}` +
          ` for invoice <strong>${doc}</strong>${inv.title ? ` (${inv.title})` : ""}.</p>` +
          `<p>Recorded manually in ConstructHub CRM.</p>`,
  } as any);

  // Money landing is worth a buzz in the pocket — opt-in per org.
  await notifyMembers({
    org, pref: "paymentReceived",
    title: `${amount} received via ${via} from ${who} for invoice ${doc}`,
    smsHandled: true,
  });
  await textOrgOwners(org, `${org.name}: ${amount} received via ${via} from ${who} for invoice ${doc}.`, "paymentReceived");
}

export function registerCrmOpsRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }
  /** Confirm a project belongs to the caller's org before touching its children. */
  async function ownProject(orgId: string, projectId: string) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.id, projectId))).limit(1);
    return p ?? null;
  }

  // ══ INVOICES ══════════════════════════════════════════════════════════════

  const invItem = z.object({
    kind: z.string().max(30).default("labor"),
    name: z.string().min(1).max(300),
    description: z.string().max(4000).nullable().optional(),
    quantityMilli: z.number().int().min(0).default(1000),
    unit: z.string().max(20).nullable().optional(),
    unitPriceCents: z.number().int().min(0).default(0),
    costCodeId: z.string().max(64).nullable().optional(),
    taxable: z.boolean().default(true),
  });

  async function recalcInvoice(orgId: string, id: string) {
    const items = await db.select().from(crmInvoiceItems)
      .where(and(eq(crmInvoiceItems.orgId, orgId), eq(crmInvoiceItems.invoiceId, id)));
    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.id, id))).limit(1);
    if (!inv) return null;
    let subtotal = 0, taxable = 0, discount = 0;
    for (const i of items) {
      const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
      if (i.kind === "discount") { discount += Math.abs(line); continue; }
      subtotal += line;
      if (i.taxable) taxable += line;
    }
    const tax = Math.round((Math.max(0, taxable - discount) * (inv.taxRateBps || 0)) / 10000);
    const gross = Math.max(0, subtotal - discount + tax);
    // Retainage is withheld from the amount currently due, not deducted from
    // the contract — it becomes collectable at closeout.
    const retainage = Math.round((gross * (inv.retainageBps || 0)) / 10000);
    const [row] = await db.update(crmInvoices).set({
      subtotalCents: subtotal, discountCents: discount, taxCents: tax,
      totalCents: gross, retainageCents: retainage, updatedAt: new Date(),
    }).where(eq(crmInvoices.id, id)).returning();
    return row;
  }

  app.get("/api/crm/invoices", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!ctx.permissions.seePrices) return res.status(403).json({ message: "Requires permission: seePrices" });
    const where = [eq(crmInvoices.orgId, ctx.org.id)];
    if (req.query.projectId) where.push(eq(crmInvoices.projectId, String(req.query.projectId)));
    if (req.query.customerId) where.push(eq(crmInvoices.customerId, String(req.query.customerId)));
    let rows = await db.select().from(crmInvoices).where(and(...where))
      .orderBy(desc(crmInvoices.createdAt)).limit(500);
    // Division scoping — same resolution order as estimates (project →
    // estimate's project → customer's latest project).
    const divScope = divisionScopeOf(ctx.member);
    if (divScope) {
      const maps = await divisionMapsForOrg(ctx.org.id);
      rows = rows.filter((i) => divisionVisible(divScope, docDivisionFromMaps(maps, i)));
    }
    res.json(rows);
  });

  app.post("/api/crm/invoices", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageInvoices");
    if (!ctx) return;
    const parsed = z.object({
      customerId: z.string().min(1),
      projectId: z.string().nullable().optional(),
      estimateId: z.string().nullable().optional(),
      title: z.string().max(200).default("Invoice"),
      taxRateBps: z.number().int().min(0).max(3000).default(0),
      retainageBps: z.number().int().min(0).max(2000).default(0),
      dueInDays: z.number().int().min(0).max(365).default(30),
      notes: z.string().max(8000).nullable().optional(),
      items: z.array(invItem).max(300).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid invoice", issues: parsed.error.issues });
    const d = parsed.data;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmInvoices)
      .where(eq(crmInvoices.orgId, ctx.org.id));
    const [inv] = await db.insert(crmInvoices).values({
      orgId: ctx.org.id, customerId: d.customerId, projectId: d.projectId ?? null,
      estimateId: d.estimateId ?? null, number: `INV-${1000 + n + 1}`, title: d.title,
      taxRateBps: d.taxRateBps, retainageBps: d.retainageBps, notes: d.notes ?? null,
      publicToken: tok(), dueAt: new Date(Date.now() + d.dueInDays * 86400000),
    } as any).returning();
    if (d.items.length) {
      await db.insert(crmInvoiceItems).values(
        d.items.map((it, i) => ({ ...it, orgId: ctx.org.id, invoiceId: inv.id, sortOrder: i })) as any);
    }
    logActivity(ctx, "invoice.created", {
      entityType: "invoice", entityId: inv.id, customerId: inv.customerId,
      meta: { number: inv.number },
    });
    res.status(201).json(await recalcInvoice(ctx.org.id, inv.id));
  });

  /** Turn an approved estimate into an invoice — the normal path. */
  app.post("/api/crm/estimates/:id/invoice", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageInvoices");
    if (!ctx) return;
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!est.approvedAt) return res.status(409).json({ message: "Only an approved estimate can be invoiced." });
    const pct = Math.min(10000, Math.max(0, Number(req.body?.percentBps ?? 10000)));
    const retainageBps = Math.min(2000, Math.max(0, Number(req.body?.retainageBps ?? 0)));
    const items = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, est.id)))
      .orderBy(asc(crmEstimateItems.sortOrder));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmInvoices)
      .where(eq(crmInvoices.orgId, ctx.org.id));
    const [inv] = await db.insert(crmInvoices).values({
      orgId: ctx.org.id, customerId: est.customerId, projectId: est.projectId ?? null,
      estimateId: est.id, number: `INV-${1000 + n + 1}`,
      title: pct < 10000 ? `${est.title} — progress billing` : est.title,
      taxRateBps: est.taxRateBps, retainageBps, publicToken: tok(),
      dueAt: new Date(Date.now() + 30 * 86400000),
    } as any).returning();
    // Progress billing scales quantities, so line detail survives on every draw.
    await db.insert(crmInvoiceItems).values(items.map((i, idx) => ({
      orgId: ctx.org.id, invoiceId: inv.id, sortOrder: idx, kind: i.kind, name: i.name,
      description: i.description, unit: i.unit, unitPriceCents: i.unitPriceCents,
      quantityMilli: Math.round((i.quantityMilli * pct) / 10000), taxable: i.taxable,
    })) as any);
    logActivity(ctx, "invoice.created", {
      entityType: "invoice", entityId: inv.id, customerId: inv.customerId,
      meta: { number: inv.number, fromEstimate: est.number ?? est.id },
    });
    res.status(201).json(await recalcInvoice(ctx.org.id, inv.id));
  });

  /**
   * Record an offline payment (cash, check, Zelle…). Most contractors still
   * collect this way, and without it an invoice can never reach "paid" unless
   * Stripe is connected. Same credit math as the Stripe webhook path.
   */
  app.post("/api/crm/invoices/:id/payments", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "takePayment");
    if (!ctx) return;
    const parsed = z.object({
      amountCents: z.number().int().min(1).max(10_000_000_00),
      // cash/check/wire/credit_card are the manual rails; ach/card/other are
      // kept so older clients and imports still validate.
      method: z.enum(["cash", "check", "wire", "credit_card", "ach", "card", "other"]),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payment", issues: parsed.error.issues });

    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.voidedAt) return res.status(409).json({ message: "This invoice has been voided." });

    const outstanding = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
    if (outstanding <= 0) return res.status(409).json({ message: "This invoice is already paid in full." });
    // Overpayment would silently inflate paidCents past the contract; refuse it.
    if (parsed.data.amountCents > outstanding) {
      return res.status(400).json({
        message: `Only $${(outstanding / 100).toFixed(2)} is outstanding on this invoice.`,
        outstandingCents: outstanding,
      });
    }

    const [pay] = await db.insert(crmPayments).values({
      orgId: ctx.org.id, customerId: inv.customerId, invoiceId: inv.id,
      projectId: inv.projectId ?? null, provider: "manual", purpose: "progress",
      amountCents: parsed.data.amountCents, currency: "usd",
      method: parsed.data.method, status: "succeeded",
      note: parsed.data.note ?? null, paidAt: new Date(),
    } as any).returning();

    const paid = (inv.paidCents ?? 0) + parsed.data.amountCents;
    const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
    const [row] = await db.update(crmInvoices).set({
      paidCents: paid,
      status: paid >= due ? "paid" : "partial",
      paidAt: paid >= due ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(crmInvoices.id, inv.id)).returning();

    if (paid >= due) await emitCrmEvent(ctx.org.id, "invoice.paid", { invoiceId: inv.id, paidCents: paid });
    await emitCrmEvent(ctx.org.id, "payment.succeeded", {
      paymentId: pay.id, amountCents: pay.amountCents, method: pay.method,
      invoiceId: inv.id, projectId: inv.projectId,
    });
    // Tell the owner money landed (honors the paymentReceived notification pref).
    notifyPaymentRecorded(ctx.org, inv, parsed.data.amountCents, parsed.data.method)
      .catch((e: any) => console.error("[crm] payment-recorded email failed:", e?.message || e));
    // And email the client their receipt-to-date (honors paymentReceipt).
    autoSendPaymentReceipt(ctx.org.id, inv.id)
      .catch((e: any) => console.error("[crm] auto-receipt failed:", e?.message || e));
    logActivity(ctx, "payment.recorded", {
      entityType: "payment", entityId: pay.id, customerId: inv.customerId,
      meta: { amountCents: pay.amountCents, method: pay.method, number: inv.number, invoiceId: inv.id },
    });
    res.status(201).json({ payment: pay, invoice: row });
  });

  /** Void an unpaid invoice. Paid invoices keep their audit trail. */
  app.post("/api/crm/invoices/:id/void", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageInvoices");
    if (!ctx) return;
    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.voidedAt) return res.status(409).json({ message: "Already voided." });
    if ((inv.paidCents ?? 0) > 0) {
      return res.status(409).json({ message: "Payments have been recorded against this invoice; it can't be voided." });
    }
    const [row] = await db.update(crmInvoices).set({
      voidedAt: new Date(), status: "void", updatedAt: new Date(),
    }).where(eq(crmInvoices.id, inv.id)).returning();
    logActivity(ctx, "invoice.updated", {
      entityType: "invoice", entityId: inv.id, customerId: inv.customerId,
      meta: { number: inv.number, change: "voided" },
    });
    res.json(row);
  });

  /**
   * Hard-delete an invoice — OWNER only (requireOwnerRole, never a permission
   * flag), for cleaning up test documents. An invoice with ANY recorded
   * payment, or one already paid, is a money trail: 409, never deletable.
   * Line items and engagement sessions go with it in one transaction, and a
   * deletion note lands on the client's activity.
   */
  app.delete("/api/crm/invoices/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });

    const [{ n: paymentCount }] = await db.select({ n: sql<number>`count(*)::int` })
      .from(crmPayments)
      .where(and(eq(crmPayments.orgId, ctx.org.id), eq(crmPayments.invoiceId, inv.id)));
    const refusal = invoiceDeleteRefusal(inv, paymentCount);
    if (refusal) return res.status(409).json({ message: refusal });

    await db.transaction(async (tx) => {
      await tx.delete(crmInvoiceItems)
        .where(and(eq(crmInvoiceItems.orgId, ctx.org.id), eq(crmInvoiceItems.invoiceId, inv.id)));
      await tx.delete(crmEngagementSessions)
        .where(and(eq(crmEngagementSessions.orgId, ctx.org.id),
          eq(crmEngagementSessions.docType, "invoice"), eq(crmEngagementSessions.docId, inv.id)));
      await tx.delete(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, inv.id)));
    });

    console.log(`[crm] owner ${ctx.member.id} deleted invoice ${inv.number ?? inv.id} (${inv.id}) in org ${ctx.org.id}`);
    await db.insert(crmCustomerNotes).values({
      orgId: ctx.org.id, customerId: inv.customerId, authorMemberId: ctx.member.id,
      body: `Invoice ${inv.number ?? inv.id} ("${inv.title}") was permanently deleted by the account owner.`,
    }).catch(() => {});
    logActivity(ctx, "invoice.deleted", {
      entityType: "invoice", entityId: inv.id, customerId: inv.customerId,
      meta: { number: inv.number, title: inv.title },
    });
    res.json({ ok: true, deleted: inv.id });
  });

  // ══ COST CODES + BUDGET LEDGER ════════════════════════════════════════════

  app.get("/api/crm/cost-codes", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmCostCodes)
      .where(and(eq(crmCostCodes.orgId, ctx.org.id), eq(crmCostCodes.active, true)))
      .orderBy(asc(crmCostCodes.code));
    res.json(rows);
  });

  app.post("/api/crm/cost-codes", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const parsed = z.object({
      code: z.string().min(1).max(30), name: z.string().min(1).max(150),
      division: z.string().max(80).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid cost code", issues: parsed.error.issues });
    try {
      const [row] = await db.insert(crmCostCodes).values({ ...parsed.data, orgId: ctx.org.id } as any).returning();
      res.status(201).json(row);
    } catch { res.status(409).json({ message: "That cost code already exists." }); }
  });

  /** Seed a standard CSI-style starter set so budgets are usable immediately. */
  app.post("/api/crm/cost-codes/seed", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const STARTER = [
      ["01-000", "General Conditions", "01 General"],
      ["01-500", "Permits & Fees", "01 General"],
      ["02-000", "Demolition", "02 Existing Conditions"],
      ["03-000", "Concrete", "03 Concrete"],
      ["06-100", "Rough Carpentry", "06 Wood & Plastics"],
      ["06-200", "Finish Carpentry", "06 Wood & Plastics"],
      ["07-100", "Waterproofing", "07 Thermal & Moisture"],
      ["07-300", "Roofing", "07 Thermal & Moisture"],
      ["07-460", "Siding", "07 Thermal & Moisture"],
      ["07-600", "Gutters & Flashing", "07 Thermal & Moisture"],
      ["08-500", "Windows", "08 Openings"],
      ["08-100", "Doors", "08 Openings"],
      ["09-250", "Drywall", "09 Finishes"],
      ["09-900", "Painting", "09 Finishes"],
      ["15-000", "Plumbing", "15 Mechanical"],
      ["16-000", "Electrical", "16 Electrical"],
    ];
    let added = 0;
    for (const [code, name, division] of STARTER) {
      try {
        await db.insert(crmCostCodes).values({ orgId: ctx.org.id, code, name, division } as any);
        added++;
      } catch { /* already present */ }
    }
    res.json({ ok: true, added });
  });

  /**
   * Budget vs Committed vs Actual, per cost code. This single endpoint is the
   * thing neither Housecall Pro nor Leap can produce.
   */
  app.get("/api/crm/projects/:id/costing", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!ctx.permissions.seeCosts) return res.status(403).json({ message: "Requires permission: seeCosts" });
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });

    const codes = await db.select().from(crmCostCodes).where(eq(crmCostCodes.orgId, ctx.org.id));
    const codeById = new Map(codes.map((c) => [c.id, c]));
    const budgets = await db.select().from(crmBudgetLines)
      .where(and(eq(crmBudgetLines.orgId, ctx.org.id), eq(crmBudgetLines.projectId, proj.id)));
    const commitments = await db.select().from(crmCommitments)
      .where(and(eq(crmCommitments.orgId, ctx.org.id), eq(crmCommitments.projectId, proj.id)));
    const actuals = await db.select().from(crmCostEntries)
      .where(and(eq(crmCostEntries.orgId, ctx.org.id), eq(crmCostEntries.projectId, proj.id)));
    const changeOrders = await db.select().from(crmChangeOrders)
      .where(and(eq(crmChangeOrders.orgId, ctx.org.id), eq(crmChangeOrders.projectId, proj.id)));

    const keys = new Set<string>([
      ...budgets.map((b) => b.costCodeId),
      ...commitments.map((c) => c.costCodeId).filter(Boolean) as string[],
      ...actuals.map((a) => a.costCodeId).filter(Boolean) as string[],
    ]);
    const lines = [...keys].map((ccId) => {
      const budget = budgets.filter((b) => b.costCodeId === ccId).reduce((s, b) => s + b.budgetCents, 0);
      const committed = commitments.filter((c) => c.costCodeId === ccId).reduce((s, c) => s + c.amountCents, 0);
      const actual = actuals.filter((a) => a.costCodeId === ccId).reduce((s, a) => s + a.amountCents, 0);
      const cc = codeById.get(ccId);
      return {
        costCodeId: ccId, code: cc?.code ?? "—", name: cc?.name ?? "Unassigned",
        division: cc?.division ?? null,
        budgetCents: budget, committedCents: committed, actualCents: actual,
        // Committed-not-yet-invoiced is real exposure; ignoring it is how jobs
        // silently go over.
        remainingCents: budget - Math.max(committed, actual),
        varianceCents: budget - actual,
        overBudget: actual > budget && budget > 0,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    const approvedCO = changeOrders.filter((c) => c.approvedAt);
    // contractValueCents is the BASE contract by invariant (set at estimate
    // approval; CO approval deliberately does not fold into it — see the
    // public change-order respond route), so revised = base + approved COs.
    const totals = {
      budgetCents: lines.reduce((s, l) => s + l.budgetCents, 0),
      committedCents: lines.reduce((s, l) => s + l.committedCents, 0),
      actualCents: lines.reduce((s, l) => s + l.actualCents, 0),
      contractValueCents: proj.contractValueCents ?? 0,
      changeOrderCents: approvedCO.reduce((s, c) => s + c.amountCents, 0),
    };
    const revised = totals.contractValueCents + totals.changeOrderCents;
    res.json({
      project: { id: proj.id, name: proj.name, number: proj.number },
      lines, totals: {
        ...totals,
        revisedContractCents: revised,
        grossProfitCents: revised - totals.actualCents,
        marginBps: revised > 0 ? Math.round(((revised - totals.actualCents) / revised) * 10000) : 0,
      },
    });
  });

  app.put("/api/crm/projects/:id/budget", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({ lines: z.array(z.object({
      costCodeId: z.string().min(1), budgetCents: z.number().int().min(0),
      phaseId: z.string().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
    })).max(500) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid budget", issues: parsed.error.issues });
    await db.delete(crmBudgetLines)
      .where(and(eq(crmBudgetLines.orgId, ctx.org.id), eq(crmBudgetLines.projectId, proj.id)));
    if (parsed.data.lines.length) {
      await db.insert(crmBudgetLines).values(parsed.data.lines.map((l) => ({
        ...l, orgId: ctx.org.id, projectId: proj.id,
      })) as any);
    }
    res.json({ ok: true, count: parsed.data.lines.length });
  });

  /**
   * Individual budget lines. The PUT above replaces the whole budget in one
   * shot; these are the granular edits the costing UI makes. Same gate as the
   * costing endpoint itself: cost data is seeCosts, writes are manageJobs.
   *
   * A budget line is (cost code, phase?, amount, notes) — committed/actual
   * money relates to it by the (project, cost code) pair, not by line id.
   */
  const budgetLineSchema = z.object({
    costCodeId: z.string().min(1),
    phaseId: z.string().nullable().optional(),
    budgetCents: z.number().int().min(0),
    notes: z.string().max(2000).nullable().optional(),
  });

  /** Ledger rows already hanging off this line's (project, cost code) pair. */
  async function costCodeInUse(orgId: string, projectId: string, costCodeId: string) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(crmCommitments)
      .where(and(eq(crmCommitments.orgId, orgId), eq(crmCommitments.projectId, projectId),
        eq(crmCommitments.costCodeId, costCodeId)));
    const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(crmCostEntries)
      .where(and(eq(crmCostEntries.orgId, orgId), eq(crmCostEntries.projectId, projectId),
        eq(crmCostEntries.costCodeId, costCodeId)));
    return (c?.n ?? 0) + (a?.n ?? 0);
  }

  /** Cost codes are org-wide; phases are per-project. Validate accordingly. */
  async function budgetLineRefsError(orgId: string, projectId: string, costCodeId: string, phaseId?: string | null) {
    const [cc] = await db.select({ id: crmCostCodes.id }).from(crmCostCodes)
      .where(and(eq(crmCostCodes.orgId, orgId), eq(crmCostCodes.id, costCodeId))).limit(1);
    if (!cc) return "Cost code not found in this organization";
    if (phaseId) {
      const [ph] = await db.select({ id: crmPhases.id }).from(crmPhases)
        .where(and(eq(crmPhases.orgId, orgId), eq(crmPhases.projectId, projectId),
          eq(crmPhases.id, phaseId))).limit(1);
      if (!ph) return "Phase not found on this project";
    }
    return null;
  }

  app.post("/api/crm/projects/:id/budget-lines", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = budgetLineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid budget line", issues: parsed.error.issues });
    const bad = await budgetLineRefsError(ctx.org.id, proj.id, parsed.data.costCodeId, parsed.data.phaseId);
    if (bad) return res.status(400).json({ message: bad });
    const [row] = await db.insert(crmBudgetLines).values({
      ...parsed.data, phaseId: parsed.data.phaseId ?? null, orgId: ctx.org.id, projectId: proj.id,
    } as any).returning();
    res.status(201).json(row);
  });

  app.patch("/api/crm/budget-lines/:lineId", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    const [line] = await db.select().from(crmBudgetLines)
      .where(and(eq(crmBudgetLines.orgId, ctx.org.id), eq(crmBudgetLines.id, req.params.lineId))).limit(1);
    if (!line) return res.status(404).json({ message: "Budget line not found" });
    const parsed = budgetLineSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid budget line", issues: parsed.error.issues });
    const d = parsed.data;
    // Re-pointing the line at another cost code would cut the ledger rows on
    // the old (project, cost code) pair loose — same rule as delete.
    if (d.costCodeId && d.costCodeId !== line.costCodeId
        && await costCodeInUse(ctx.org.id, line.projectId, line.costCodeId)) {
      return res.status(409).json({ message: "This cost code already has committed or actual costs; the budget line can't be moved off it." });
    }
    const bad = await budgetLineRefsError(ctx.org.id, line.projectId, d.costCodeId ?? line.costCodeId, d.phaseId);
    if (bad) return res.status(400).json({ message: bad });
    const [row] = await db.update(crmBudgetLines).set({ ...d, updatedAt: new Date() } as any)
      .where(eq(crmBudgetLines.id, line.id)).returning();
    res.json(row);
  });

  app.delete("/api/crm/budget-lines/:lineId", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    const [line] = await db.select().from(crmBudgetLines)
      .where(and(eq(crmBudgetLines.orgId, ctx.org.id), eq(crmBudgetLines.id, req.params.lineId))).limit(1);
    if (!line) return res.status(404).json({ message: "Budget line not found" });
    // Refuse to orphan the ledger: with committed/actual rows on this cost
    // code, deleting the budget line would lose the variance comparison.
    if (await costCodeInUse(ctx.org.id, line.projectId, line.costCodeId)) {
      return res.status(409).json({ message: "This cost code already has committed or actual costs; it can't be removed from the budget." });
    }
    await db.delete(crmBudgetLines).where(eq(crmBudgetLines.id, line.id));
    res.json({ ok: true });
  });

  app.post("/api/crm/projects/:id/commitments", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      type: z.enum(CRM_COMMITMENT_TYPES as unknown as [string, ...string[]]).default("purchase_order"),
      costCodeId: z.string().nullable().optional(), vendorName: z.string().max(200).nullable().optional(),
      supplier: z.string().max(40).nullable().optional(), description: z.string().max(4000).nullable().optional(),
      amountCents: z.number().int().min(0), externalOrderId: z.string().max(120).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid commitment", issues: parsed.error.issues });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmCommitments)
      .where(eq(crmCommitments.orgId, ctx.org.id));
    const [row] = await db.insert(crmCommitments).values({
      ...parsed.data, orgId: ctx.org.id, projectId: proj.id, number: `PO-${1000 + n + 1}`,
    } as any).returning();
    res.status(201).json(row);
  });

  app.post("/api/crm/projects/:id/costs", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      source: z.enum(["vendor_bill", "labor", "expense"]).default("vendor_bill"),
      costCodeId: z.string().nullable().optional(), commitmentId: z.string().nullable().optional(),
      vendorName: z.string().max(200).nullable().optional(), memberId: z.string().nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
      amountCents: z.number().int().min(0), hoursMilli: z.number().int().min(0).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid cost entry", issues: parsed.error.issues });
    const [row] = await db.insert(crmCostEntries).values({
      ...parsed.data, orgId: ctx.org.id, projectId: proj.id,
    } as any).returning();
    res.status(201).json(row);
  });

  // ══ SCHEDULING ════════════════════════════════════════════════════════════

  app.get("/api/crm/appointments", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400000);
    const rows = await db.select().from(crmAppointments)
      .where(and(eq(crmAppointments.orgId, ctx.org.id),
        gte(crmAppointments.startsAt, from), lte(crmAppointments.startsAt, to)))
      .orderBy(asc(crmAppointments.startsAt)).limit(1000);
    // A crew member without viewAllJobs sees only visits they're dispatched to.
    const visible = ctx.permissions.viewAllJobs
      ? rows : rows.filter((a) => (a.dispatchedMemberIds || []).includes(ctx.member.id));
    res.json({ appointments: visible, statuses: CRM_APPOINTMENT_STATUSES });
  });

  app.post("/api/crm/appointments", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = z.object({
      projectId: z.string().nullable().optional(), jobId: z.string().nullable().optional(),
      customerId: z.string().nullable().optional(),
      title: z.string().min(1).max(200), notes: z.string().max(8000).nullable().optional(),
      crewNotes: z.string().max(8000).nullable().optional(),
      startsAt: z.string(), endsAt: z.string().nullable().optional(),
      allDay: z.boolean().default(false),
      arrivalWindowMinutes: z.number().int().min(0).max(480).nullable().optional(),
      dispatchedMemberIds: z.array(z.string().max(64)).max(50).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid appointment", issues: parsed.error.issues });
    const startsAt = new Date(parsed.data.startsAt);
    if (isNaN(startsAt.getTime())) return res.status(400).json({ message: "Invalid start time" });
    const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;

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
    const parsed = z.object({
      status: z.enum(CRM_APPOINTMENT_STATUSES as unknown as [string, ...string[]]).optional(),
      title: z.string().max(200).optional(), notes: z.string().max(8000).nullable().optional(),
      crewNotes: z.string().max(8000).nullable().optional(),
      startsAt: z.string().optional(), endsAt: z.string().nullable().optional(),
      dispatchedMemberIds: z.array(z.string().max(64)).max(50).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid patch", issues: parsed.error.issues });
    const patch: any = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.startsAt) patch.startsAt = new Date(parsed.data.startsAt);
    if (parsed.data.endsAt) patch.endsAt = new Date(parsed.data.endsAt);
    if (parsed.data.status === "on_my_way") patch.onMyWayAt = new Date();
    if (parsed.data.status === "started") patch.startedAt = new Date();
    if (parsed.data.status === "complete") patch.completedAt = new Date();
    if (!ctx.permissions.manageJobs) delete patch.dispatchedMemberIds; // techs can't re-crew
    const [row] = await db.update(crmAppointments).set(patch)
      .where(eq(crmAppointments.id, appt.id)).returning();
    res.json(row);
  });

  // ══ CHANGE ORDERS ═════════════════════════════════════════════════════════

  app.get("/api/crm/projects/:id/change-orders", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const rows = await db.select().from(crmChangeOrders)
      .where(and(eq(crmChangeOrders.orgId, ctx.org.id), eq(crmChangeOrders.projectId, proj.id)))
      .orderBy(desc(crmChangeOrders.createdAt));
    res.json(rows.map((c) => ({
      ...c, publicToken: undefined,
      amountCents: ctx.permissions.seePrices ? c.amountCents : undefined,
      costCents: ctx.permissions.seeCosts ? c.costCents : undefined,
      publicPath: ctx.permissions.manageEstimates ? `/co/${c.publicToken}` : undefined,
    })));
  });

  app.post("/api/crm/projects/:id/change-orders", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "approveChangeOrders");
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      title: z.string().min(1).max(200), description: z.string().max(20000).nullable().optional(),
      amountCents: z.number().int(), costCents: z.number().int().min(0).nullable().optional(),
      scheduleImpactDays: z.number().int().min(-365).max(365).default(0),
      costCodeId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid change order", issues: parsed.error.issues });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmChangeOrders)
      .where(eq(crmChangeOrders.orgId, ctx.org.id));
    const [row] = await db.insert(crmChangeOrders).values({
      ...parsed.data, orgId: ctx.org.id, projectId: proj.id, customerId: proj.customerId,
      number: `CO-${100 + n + 1}`, publicToken: tok(),
    } as any).returning();
    res.status(201).json({ ...row, publicPath: `/co/${row.publicToken}` });
  });

  /** Stamp a change order sent and hand back its public link — open tracking
   *  (firstViewedAt) only counts from this point, same rule as estimates. */
  app.post("/api/crm/change-orders/:id/send", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "approveChangeOrders");
    if (!ctx) return;
    const [co] = await db.select().from(crmChangeOrders)
      .where(and(eq(crmChangeOrders.orgId, ctx.org.id), eq(crmChangeOrders.id, req.params.id))).limit(1);
    if (!co) return res.status(404).json({ message: "Change order not found" });
    const [row] = await db.update(crmChangeOrders).set({
      sentAt: co.sentAt ?? new Date(),
      status: co.status === "draft" ? "sent" : co.status,
      updatedAt: new Date(),
    }).where(eq(crmChangeOrders.id, co.id)).returning();
    res.json({ changeOrder: { ...row, publicToken: undefined }, link: `${getBaseUrl(req)}/co/${co.publicToken}` });
  });

  /** Public: client approves/declines a change order. */
  app.get("/api/public/change-orders/:token", async (req: any, res) => {
    const [co] = await db.select().from(crmChangeOrders)
      .where(eq(crmChangeOrders.publicToken, String(req.params.token))).limit(1);
    if (!co) return res.status(404).json({ message: "This link is no longer valid." });
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, co.orgId)).limit(1);
    const [proj] = await db.select().from(crmProjects).where(eq(crmProjects.id, co.projectId)).limit(1);
    if (co.sentAt && !co.firstViewedAt && !co.approvedAt && !co.declinedAt) {
      await db.update(crmChangeOrders).set({ firstViewedAt: new Date() }).where(eq(crmChangeOrders.id, co.id));
    }
    res.json({
      changeOrder: {
        number: co.number, title: co.title, description: co.description,
        amountCents: co.amountCents, scheduleImpactDays: co.scheduleImpactDays,
        status: co.status, approvedAt: co.approvedAt, declinedAt: co.declinedAt,
        signatureName: co.signatureName,
      },
      company: { name: org?.name, phone: org?.phone, email: org?.email, logoUrl: org?.logoUrl },
      project: { name: proj?.name, number: proj?.number },
    });
  });

  app.post("/api/public/change-orders/:token/respond", async (req: any, res) => {
    const parsed = z.object({
      decision: z.enum(["approve", "decline"]),
      signatureName: z.string().min(2).max(120).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid response" });
    const [co] = await db.select().from(crmChangeOrders)
      .where(eq(crmChangeOrders.publicToken, String(req.params.token))).limit(1);
    if (!co) return res.status(404).json({ message: "This link is no longer valid." });
    if (co.approvedAt || co.declinedAt) return res.status(409).json({ message: "Already responded to." });
    const approve = parsed.data.decision === "approve";
    if (approve && !parsed.data.signatureName) return res.status(400).json({ message: "Please type your name to approve." });
    const [row] = await db.update(crmChangeOrders).set({
      status: approve ? "approved" : "declined",
      approvedAt: approve ? new Date() : null,
      declinedAt: approve ? null : new Date(),
      signatureName: approve ? parsed.data.signatureName ?? null : null,
      updatedAt: new Date(),
    }).where(eq(crmChangeOrders.id, co.id)).returning();
    // An approved CO moves the schedule; the MONEY is derived, not stored.
    // contractValueCents stays the BASE contract (set at estimate approval) and
    // the costing endpoint computes revised = base + approved COs — folding the
    // amount in here as well would count every approved CO twice.
    if (approve && co.scheduleImpactDays) {
      const [proj] = await db.select().from(crmProjects).where(eq(crmProjects.id, co.projectId)).limit(1);
      if (proj?.targetEndDate) {
        await db.update(crmProjects).set({
          targetEndDate: new Date(proj.targetEndDate.getTime() + co.scheduleImpactDays * 86400000),
          updatedAt: new Date(),
        }).where(eq(crmProjects.id, proj.id));
      }
    }
    res.json({ ok: true, status: row.status });
  });

  // ══ PUNCH LIST / DAILY LOGS / SELECTIONS ══════════════════════════════════

  const projectChild = (
    path: string, table: any, schema: z.ZodTypeAny, perm: any = "manageJobs", order: any = null,
  ) => {
    app.get(`/api/crm/projects/:id/${path}`, async (req: any, res) => {
      const ctx = await ctxFor(req, res);
      if (!ctx) return;
      const proj = await ownProject(ctx.org.id, req.params.id);
      if (!proj) return res.status(404).json({ message: "Project not found" });
      const rows = await db.select().from(table)
        .where(and(eq(table.orgId, ctx.org.id), eq(table.projectId, proj.id)))
        .orderBy(order ?? desc(table.createdAt)).limit(1000);
      res.json(rows);
    });
    app.post(`/api/crm/projects/:id/${path}`, async (req: any, res) => {
      const ctx = await ctxFor(req, res, perm);
      if (!ctx) return;
      const proj = await ownProject(ctx.org.id, req.params.id);
      if (!proj) return res.status(404).json({ message: "Project not found" });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: `Invalid ${path}`, issues: (parsed as any).error.issues });
      const inserted: any[] = await db.insert(table).values({
        ...(parsed.data as any), orgId: ctx.org.id, projectId: proj.id,
      }).returning() as any;
      res.status(201).json(inserted[0]);
    });
    app.patch(`/api/crm/${path}/:childId`, async (req: any, res) => {
      const ctx = await ctxFor(req, res, perm);
      if (!ctx) return;
      const parsed = (schema as any).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: `Invalid ${path}` });
      const updated: any[] = await db.update(table).set({ ...(parsed.data as any), updatedAt: new Date() })
        .where(and(eq(table.orgId, ctx.org.id), eq(table.id, req.params.childId))).returning() as any;
      if (!updated[0]) return res.status(404).json({ message: "Not found" });
      res.json(updated[0]);
    });
  };

  projectChild("punch-items", crmPunchItems, z.object({
    title: z.string().min(1).max(300), description: z.string().max(8000).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    status: z.enum(CRM_PUNCH_STATUSES as unknown as [string, ...string[]]).default("open"),
    assignedMemberId: z.string().max(64).nullable().optional(),
    photoUrls: z.array(z.string().max(1000)).max(30).nullable().optional(),
  }), "manageJobs", asc(crmPunchItems.status));

  projectChild("selections", crmSelections, z.object({
    category: z.string().max(100).nullable().optional(), name: z.string().min(1).max(200),
    description: z.string().max(8000).nullable().optional(),
    status: z.enum(CRM_SELECTION_STATUSES as unknown as [string, ...string[]]).default("pending"),
    allowanceCents: z.number().int().min(0).default(0),
    chosenOptionName: z.string().max(200).nullable().optional(),
    actualCents: z.number().int().min(0).nullable().optional(),
  }), "manageJobs");

  app.get("/api/crm/projects/:id/daily-logs", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const rows = await db.select().from(crmDailyLogs)
      .where(and(eq(crmDailyLogs.orgId, ctx.org.id), eq(crmDailyLogs.projectId, proj.id)))
      .orderBy(desc(crmDailyLogs.logDate)).limit(400);
    res.json(rows);
  });

  app.post("/api/crm/projects/:id/daily-logs", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      logDate: z.string().optional(), weather: z.string().max(100).nullable().optional(),
      tempF: z.number().int().min(-80).max(150).nullable().optional(),
      crewCount: z.number().int().min(0).max(500).nullable().optional(),
      hoursMilli: z.number().int().min(0).nullable().optional(),
      workCompleted: z.string().max(20000).nullable().optional(),
      delays: z.string().max(8000).nullable().optional(),
      visitors: z.string().max(2000).nullable().optional(),
      safetyNotes: z.string().max(8000).nullable().optional(),
      photoUrls: z.array(z.string().max(1000)).max(50).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid daily log", issues: parsed.error.issues });
    // Any crew member can file a log — that's the point of a daily log.
    const [row] = await db.insert(crmDailyLogs).values({
      ...parsed.data, orgId: ctx.org.id, projectId: proj.id,
      authorMemberId: ctx.member.id,
      logDate: parsed.data.logDate ? new Date(parsed.data.logDate) : new Date(),
    } as any).returning();
    res.status(201).json(row);
  });

  // ══ PERMITS — our moat, finally wired to the CRM ═══════════════════════════

  /** Find verified permit portals + appraisers for a project's jurisdiction. */
  app.get("/api/crm/projects/:id/permits/suggest", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const city = (proj.city || "").trim();
    const state = (proj.state || "").trim();
    if (!city && !state) {
      return res.json({ portals: [], appraisers: [], message: "Add a city and state to the project first." });
    }
    // HARD RULE: only real, verified, liveness-checked rows. Never synthesise.
    const portals = await db.select({
      id: permitDatabases.id, name: permitDatabases.name,
      jurisdiction: permitDatabases.jurisdiction, portalUrl: permitDatabases.portalUrl,
      searchUrl: permitDatabases.searchUrl, phone: permitDatabases.phone,
      linkStatus: permitDatabases.linkStatus,
    }).from(permitDatabases)
      .where(and(
        eq(permitDatabases.isActive, true),
        eq(permitDatabases.linkStatus, "live"),
        city ? ilike(permitDatabases.jurisdiction, `%${city}%`) : sql`true`,
      )).limit(15);
    const appraisers = await db.select({
      id: propertyAppraisers.id, name: propertyAppraisers.name,
      portalUrl: propertyAppraisers.portalUrl, searchUrl: propertyAppraisers.searchUrl,
    }).from(propertyAppraisers)
      .where(and(eq(propertyAppraisers.isActive, true),
        city ? ilike(propertyAppraisers.name, `%${city}%`) : sql`true`)).limit(10);
    res.json({ portals, appraisers, jurisdiction: [city, state].filter(Boolean).join(", ") });
  });

  app.patch("/api/crm/projects/:id/permit", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      permitPortalId: z.number().int().nullable().optional(),
      permitNumber: z.string().max(80).nullable().optional(),
      parcelNumber: z.string().max(80).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid permit data" });
    const [row] = await db.update(crmProjects)
      .set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(eq(crmProjects.id, proj.id)).returning();
    res.json(row);
  });

  // ══ PUBLIC API KEYS + WEBHOOKS ════════════════════════════════════════════

  app.get("/api/crm/api-keys", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const rows = await db.select().from(crmApiKeys)
      .where(and(eq(crmApiKeys.orgId, ctx.org.id), isNull(crmApiKeys.revokedAt)))
      .orderBy(desc(crmApiKeys.createdAt));
    res.json(rows.map(({ keyHash, ...r }) => r));
  });

  app.post("/api/crm/api-keys", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const name = String(req.body?.name || "").trim() || "API key";
    // Shown exactly once; only the hash is stored.
    const plain = `chk_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(plain).digest("hex");
    const [row] = await db.insert(crmApiKeys).values({
      orgId: ctx.org.id, name, keyHash, keyPrefix: plain.slice(0, 12),
      scopes: ["read"], createdByMemberId: ctx.member.id,
    } as any).returning();
    res.status(201).json({
      id: row.id, name: row.name, keyPrefix: row.keyPrefix, createdAt: row.createdAt,
      key: plain,
      warning: "Copy this now — it is never shown again.",
    });
  });

  app.delete("/api/crm/api-keys/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const [row] = await db.update(crmApiKeys).set({ revokedAt: new Date() })
      .where(and(eq(crmApiKeys.orgId, ctx.org.id), eq(crmApiKeys.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Key not found" });
    res.json({ ok: true });
  });

  app.get("/api/crm/webhooks", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const rows = await db.select().from(crmWebhooks).where(eq(crmWebhooks.orgId, ctx.org.id));
    res.json({ webhooks: rows.map(({ secret, ...r }) => r), events: CRM_WEBHOOK_EVENTS });
  });

  app.post("/api/crm/webhooks", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const parsed = z.object({
      url: z.string().url().max(500),
      events: z.array(z.enum(CRM_WEBHOOK_EVENTS as unknown as [string, ...string[]])).min(1).max(40),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid webhook", issues: parsed.error.issues });
    // SSRF guard: refuse anything that resolves to a private/loopback address
    // (covers IPv4-mapped IPv6, 0.0.0.0, ULA and DNS pointing at RFC1918).
    // Delivery re-checks on every send — see emitCrmEvent.
    if (!(await webhookUrlIsSafe(parsed.data.url))) {
      return res.status(400).json({ message: "That URL points at a private or unreachable address." });
    }
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const [row] = await db.insert(crmWebhooks).values({
      orgId: ctx.org.id, url: parsed.data.url, events: parsed.data.events, secret,
    } as any).returning();
    res.status(201).json({ ...row, secret, warning: "Copy this signing secret now." });
  });

  app.delete("/api/crm/webhooks/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    await db.delete(crmWebhooks)
      .where(and(eq(crmWebhooks.orgId, ctx.org.id), eq(crmWebhooks.id, req.params.id)));
    res.json({ ok: true });
  });

  // ══ ESTIMATE OPTIONS (good / better / best) ════════════════════════════════

  app.get("/api/crm/estimates/:id/options", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, req.params.id)))
      .orderBy(asc(crmEstimateOptions.tier));
    res.json(rows.map((o) => ({
      ...o,
      subtotalCents: ctx.permissions.seePrices ? o.subtotalCents : undefined,
      totalCents: ctx.permissions.seePrices ? o.totalCents : undefined,
      // Costs stay privileged inside option scopes too (the pm is cost-blind).
      items: Array.isArray(o.items)
        ? (o.items as any[]).map((i) => ({ ...i, unitCostCents: ctx.permissions.seeCosts ? i.unitCostCents : undefined }))
        : o.items,
    })));
  });

  /** Options are estimate edits: same lifecycle guards as the line items. */
  const optionEditGuard = (est: typeof crmEstimates.$inferSelect, res: any): boolean => {
    if (est.approvedAt || est.declinedAt) {
      res.status(409).json({ message: "This estimate has already been responded to and can no longer be edited." });
      return false;
    }
    if (est.expiresAt && est.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: "This estimate has expired." });
      return false;
    }
    return true;
  };

  app.post("/api/crm/estimates/:id/options", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!optionEditGuard(est, res)) return;
    const parsed = z.object({
      name: z.string().min(1).max(80), tier: z.number().int().min(1).max(9).default(1),
      description: z.string().max(8000).nullable().optional(),
      totalCents: z.number().int().min(0).default(0),
      recommended: z.boolean().default(false),
      // Default false: Leap leaked pricing by showing tier totals up front.
      showTotal: z.boolean().default(false),
      // The scope itself. When items are given they make the option
      // client-selectable on the public page, and the totals are COMPUTED
      // from them (never taken from the body) at the estimate's own tax rate.
      items: z.array(z.object({
        kind: z.enum(CRM_LINE_ITEM_KINDS as unknown as [string, ...string[]]).default("labor"),
        name: z.string().min(1).max(300),
        description: z.string().max(4000).nullable().optional(),
        quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
        unit: z.string().max(20).nullable().optional(),
        unitPriceCents: z.number().int().min(0).max(1_000_000_00).default(0),
        unitCostCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
        taxable: z.boolean().default(true),
      })).max(100).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid option", issues: parsed.error.issues });
    const items = parsed.data.items?.length ? parsed.data.items : null;
    let subtotal = parsed.data.totalCents, total = parsed.data.totalCents;
    if (items) {
      let taxable = 0;
      subtotal = 0;
      for (const i of items) {
        const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
        subtotal += line;
        if (i.taxable) taxable += line;
      }
      total = subtotal + Math.round((taxable * (est.taxRateBps || 0)) / 10000);
    }
    const [row] = await db.insert(crmEstimateOptions).values({
      name: parsed.data.name, tier: parsed.data.tier,
      description: parsed.data.description ?? null,
      recommended: parsed.data.recommended, showTotal: parsed.data.showTotal,
      orgId: ctx.org.id, estimateId: est.id,
      subtotalCents: subtotal, totalCents: total, items,
    } as any).returning();
    res.status(201).json(row);
  });

  /** Remove a typo'd tier. Same guards as adding one. */
  app.delete("/api/crm/estimates/:id/options/:optionId", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!optionEditGuard(est, res)) return;
    const gone = await db.delete(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id),
        eq(crmEstimateOptions.estimateId, est.id),
        eq(crmEstimateOptions.id, req.params.optionId))).returning({ id: crmEstimateOptions.id });
    if (!gone.length) return res.status(404).json({ message: "Option not found" });
    res.json({ ok: true });
  });
}

/** Phases — the layer Leap's users fake with custom work types. */
export function registerCrmPhaseRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/crm/projects/:id/phases", async (req: any, res) => {
    const user = getDevUser(req, res); if (!user) return;
    const ctx = await requireOrg(req, res, user.id); if (!ctx) return;
    const rows = await db.select().from(crmPhases)
      .where(and(eq(crmPhases.orgId, ctx.org.id), eq(crmPhases.projectId, req.params.id)))
      .orderBy(asc(crmPhases.sortOrder));
    res.json(rows);
  });

  app.post("/api/crm/projects/:id/phases", async (req: any, res) => {
    const user = getDevUser(req, res); if (!user) return;
    const ctx = await requireOrg(req, res, user.id); if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    const parsed = z.object({
      name: z.string().min(1).max(150),
      sortOrder: z.number().int().min(0).max(999).default(0),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid phase", issues: parsed.error.issues });
    const [proj] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).limit(1);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const [row] = await db.insert(crmPhases).values({
      orgId: ctx.org.id, projectId: proj.id, name: parsed.data.name,
      sortOrder: parsed.data.sortOrder,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    } as any).returning();
    res.status(201).json(row);
  });

  app.delete("/api/crm/phases/:phaseId", async (req: any, res) => {
    const user = getDevUser(req, res); if (!user) return;
    const ctx = await requireOrg(req, res, user.id); if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;
    // Budget lines reference phases; null them rather than orphan the money.
    await db.update(crmBudgetLines).set({ phaseId: null })
      .where(and(eq(crmBudgetLines.orgId, ctx.org.id), eq(crmBudgetLines.phaseId, req.params.phaseId)));
    await db.delete(crmPhases)
      .where(and(eq(crmPhases.orgId, ctx.org.id), eq(crmPhases.id, req.params.phaseId)));
    res.json({ ok: true });
  });
}
