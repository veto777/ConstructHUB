import { invoiceRefundTotals } from "./refund-summary";
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
  crmCommitments, crmCostEntries, crmChangeOrders,
  crmPunchItems, crmDailyLogs, crmSelections, crmEstimateOptions,
  crmApiKeys, crmWebhooks, crmProjects, crmCustomers, crmOrgs, crmEstimates,
  crmEstimateItems, crmPayments, crmMembers,
  crmNotificationChannel, crmNotificationEnabled, crmEngagementSessions, crmCustomerNotes,
  CRM_WEBHOOK_EVENTS, CRM_CHANGE_ORDER_STATUSES,
  CRM_PUNCH_STATUSES, CRM_SELECTION_STATUSES, CRM_COMMITMENT_TYPES,
  CRM_LINE_ITEM_KINDS,
} from "@shared/schema";
import { and, eq, desc, asc, sql, isNull } from "drizzle-orm";
import { requireOrg, requirePermission, requireOwnerRole, stripMoney, type OrgContext } from "./tenancy";
import { divisionScopeOf, divisionVisible, divisionMapsForOrg, docDivisionFromMaps } from "./divisions";
import { requireCrmFeature, emitCrmEvent, webhookUrlIsSafe } from "./integrations";
import { autoSendPaymentReceipt } from "./receipts";
import { logActivity } from "./activity";
import { sendWithFallback } from "../email";
import { textOrgOwners } from "./sms";
import { notifyMembers } from "./notify";
import { getBaseUrl } from "../auth";
import { computeApprovalTotals } from "./discounts";
import { progressInvoiceItems } from "./invoice-math";
import { lockDocNumbers, nextDocNumber } from "./doc-number";
import { objectPolicy } from "./object-access";
import { suggestPermitOffices } from "./permit-suggest";

type GetUser = (req: any, res: any) => any;
const tok = () => randomBytes(24).toString("hex");

/** Human label for a payment method, used in the "payment received" email. */
const METHOD_LABELS: Record<string, string> = {
  cash: "cash", check: "check", wire: "wire transfer", credit_card: "credit card",
  ach: "bank transfer (ACH)", card: "card", other: "another method",
};

/** "$1,750.00" — the same formatting the UI uses, for server messages. */
const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Why an invoice may NOT be hard-deleted, or null when it can. A paid invoice
 * — or one with ANY payment row recorded against it — is a money trail and is
 * never deletable (voiding is the audit-preserving path for unpaid ones).
 * A partly paid invoice is told apart from a paid one: "has been paid" on a
 * $101-of-$300 invoice reads as if the balance were settled.
 */
export function invoiceDeleteRefusal(
  inv: { status: string; paidCents: number | null; paidAt: Date | null },
  paymentCount: number,
): string | null {
  if (inv.status === "paid" || inv.paidAt) {
    return "This invoice has been paid — paid money trails are never deletable.";
  }
  if ((inv.paidCents ?? 0) > 0) {
    return `Payments have been recorded against this invoice (${usd(inv.paidCents ?? 0)} so far) — money trails are never deletable.`;
  }
  if (paymentCount > 0) {
    return "Payments have been recorded against this invoice; it cannot be deleted.";
  }
  return null;
}

/**
 * How much of an approved estimate its live (non-void) invoices already bill,
 * in basis points. Invoices made by the estimate→invoice route record their
 * draw (custom_fields.progressBps); older or hand-built ones are measured by
 * money against the estimate's signed total. A zero-total estimate counts any
 * live invoice as billing it in full.
 */
export function estimateBilledBps(
  invoices: { totalCents: number; customFields: unknown }[],
  fullTotalCents: number,
): number {
  return invoices.reduce((sum, inv) => {
    const recorded = Number((inv.customFields as Record<string, unknown> | null)?.progressBps);
    if (Number.isInteger(recorded) && recorded > 0 && recorded <= 10000) return sum + recorded;
    if (fullTotalCents <= 0) return sum + 10000;
    return sum + Math.round((inv.totalCents * 10000) / fullTotalCents);
  }, 0);
}

/** Tell the org owner money landed on an invoice (manual entry). Best-effort:
 *  email must never fail the request that recorded the payment. The member who
 *  recorded it (`actorMemberId`) is excluded — they were there. */
async function notifyPaymentRecorded(
  org: typeof crmOrgs.$inferSelect,
  inv: typeof crmInvoices.$inferSelect,
  amountCents: number,
  method: string,
  actorMemberId?: string | null,
) {
  // The org can silence this notification in Settings (default: on); the gate
  // is per-channel — any of in-app/email/sms ON keeps the event alive.
  if (!["inApp", "email", "sms"].some((c) => crmNotificationChannel(org.customFields, "paymentReceived", c as any))) return;
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
  const owners = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active"), eq(crmMembers.role, "owner")));
  const to = new Set<string>();
  if (org.email) to.add(org.email);
  for (const m of owners) if (m.email && m.id !== actorMemberId) to.add(m.email);
  const amount = `$${(amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const via = METHOD_LABELS[method] ?? method;
  const who = cust?.displayName ?? "a client";
  const doc = inv.number ?? "an invoice";

  // Money landing is worth a buzz in the pocket — opt-in per org. The bell
  // never depends on there being an email inbox.
  await notifyMembers({
    org, pref: "paymentReceived",
    title: `${amount} received via ${via} from ${who} for invoice ${doc}`,
    excludeMemberIds: actorMemberId ? [actorMemberId] : [],
    smsHandled: true,
  });
  const texts = await textOrgOwners(org, `${org.name}: ${amount} received via ${via} from ${who} for invoice ${doc}.`, "paymentReceived");

  // Email when the channel is on — or when the owner text was skipped because
  // the month's text allowance is spent.
  if (to.size && (crmNotificationChannel(org.customFields, "paymentReceived", "email") || texts.limit)) {
    await sendWithFallback({
      to: [...to].join(","),
      subject: `Payment received — ${amount} via ${via} from ${who} for invoice ${inv.number ?? ""}`.trim(),
      html: `<p><strong>${amount}</strong> received via <strong>${via}</strong> from ${who}` +
            ` for invoice <strong>${doc}</strong>${inv.title ? ` (${inv.title})` : ""}.</p>` +
            `<p>Recorded manually in ConstructHub CRM.</p>`,
    } as any);
  }
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
    res.json(await invoiceRefundTotals(ctx.org.id, rows));
  });

  /** Standalone invoice (no estimate behind it) for the client page; line items are stored and totaled exactly like an estimate-converted invoice. */
  app.post("/api/crm/invoices", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageInvoices");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "seePrices")) return; // an invoice or payment is an amount
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
    // A document's own org_id does not authorize its foreign-key targets.
    const [customer] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, d.customerId))).limit(1);
    if (!customer) return res.status(400).json({ message: "Customer not found in this organization" });
    if (d.projectId && !(await ownProject(ctx.org.id, d.projectId))) {
      return res.status(400).json({ message: "Project not found in this organization" });
    }
    if (d.estimateId) {
      const [estimate] = await db.select({ id: crmEstimates.id }).from(crmEstimates)
        .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, d.estimateId))).limit(1);
      if (!estimate) return res.status(400).json({ message: "Estimate not found in this organization" });
    }
    // Number + insert in one transaction: the allocation lock is held until
    // this invoice exists, so no two invoices in the org share a number.
    const inv = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "INV", ctx.org.id);
      const [row] = await tx.insert(crmInvoices).values({
        orgId: ctx.org.id, customerId: d.customerId, projectId: d.projectId ?? null,
        estimateId: d.estimateId ?? null, number, title: d.title,
        taxRateBps: d.taxRateBps, retainageBps: d.retainageBps, notes: d.notes ?? null,
        publicToken: tok(), dueAt: new Date(Date.now() + d.dueInDays * 86400000),
      } as any).returning();
      if (d.items.length) {
        await tx.insert(crmInvoiceItems).values(
          d.items.map((it, i) => ({ ...it, orgId: ctx.org.id, invoiceId: row.id, sortOrder: i })) as any);
      }
      return row;
    });
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
    if (!requirePermission(res, ctx, "seePrices")) return; // an invoice or payment is an amount
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!est.approvedAt) return res.status(409).json({ message: "Only an approved estimate can be invoiced." });
    const draw = z.object({
      percentBps: z.number().int().min(1).max(10000).default(10000),
      retainageBps: z.number().int().min(0).max(2000).default(0),
    }).safeParse(req.body ?? {});
    if (!draw.success) return res.status(400).json({ message: "Invalid progress billing", issues: draw.error.issues });
    const { percentBps: pct, retainageBps } = draw.data;
    const items = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, est.id)))
      .orderBy(asc(crmEstimateItems.sortOrder));
    // Use the immutable selections accepted with the signature, not today's
    // editable offer definitions. The full invoice must honor that concession.
    const selected = Array.isArray(est.selectedDiscounts)
      ? est.selectedDiscounts.filter((s: any) => typeof s?.percentBps === "number") as { percentBps: number }[]
      : [];
    const approval = computeApprovalTotals(items, est.taxRateBps ?? 0, selected);
    const lines = progressInvoiceItems(items, pct, approval.optionalDiscountCents);

    // Progress billing may split an estimate across several invoices, but
    // never past 100% of it: a second click on "Create invoice" must not bill
    // the whole job again. The check runs under the numbering lock, so two
    // concurrent clicks cannot both pass it.
    const result = await db.transaction(async (tx) => {
      // Lock first, allocate only once the draw is allowed — a refused click
      // must not burn an invoice number.
      await lockDocNumbers(tx, "INV", ctx.org.id);
      const prior = await tx.select({
        id: crmInvoices.id, number: crmInvoices.number,
        totalCents: crmInvoices.totalCents, customFields: crmInvoices.customFields,
      }).from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.estimateId, est.id),
          isNull(crmInvoices.voidedAt)))
        .orderBy(asc(crmInvoices.createdAt));
      const billedBps = estimateBilledBps(prior, approval.totalCents);
      if (prior.length && billedBps + pct > 10000) {
        const numbers = prior.map((p) => p.number ?? "an invoice").join(", ");
        const one = prior.length === 1;
        const remainingBps = Math.max(0, 10000 - billedBps);
        return { error: {
          status: 409,
          message: remainingBps === 0
            ? `This estimate is already invoiced in full as ${numbers}. ${one ? "Open that invoice, or void it" : "Open those invoices, or void one"} before billing again.`
            : `${numbers} already ${one ? "bills" : "bill"} ${billedBps / 100}% of this estimate — only ${remainingBps / 100}% is left to invoice.`,
          invoices: prior.map((p) => ({ id: p.id, number: p.number })),
          billedBps: Math.min(10000, billedBps), remainingBps,
        } };
      }
      const number = await nextDocNumber(tx, "INV", ctx.org.id);
      const [row] = await tx.insert(crmInvoices).values({
        orgId: ctx.org.id, customerId: est.customerId, projectId: est.projectId ?? null,
        estimateId: est.id, number,
        title: pct < 10000 ? `${est.title} — progress billing` : est.title,
        taxRateBps: est.taxRateBps, retainageBps, publicToken: tok(),
        dueAt: new Date(Date.now() + 30 * 86400000),
        // The draw this invoice bills, so the next one knows what is left.
        customFields: { progressBps: pct },
      } as any).returning();
      if (lines.length) await tx.insert(crmInvoiceItems).values(lines.map((i, idx) => ({
        orgId: ctx.org.id, invoiceId: row.id, sortOrder: idx, kind: i.kind, name: i.name,
        description: i.description, unit: i.unit, unitPriceCents: i.unitPriceCents,
        quantityMilli: i.quantityMilli, taxable: i.taxable,
      })) as any);
      return { inv: row };
    });
    if (result.error) {
      const { status, ...body } = result.error;
      return res.status(status).json(body);
    }
    const { inv } = result;
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
    if (!requirePermission(res, ctx, "seePrices")) return; // an invoice or payment is an amount
    const parsed = z.object({
      amountCents: z.number().int().min(1).max(10_000_000_00),
      // cash/check/wire/credit_card are the manual rails; ach/card/other are
      // kept so older clients and imports still validate.
      method: z.enum(["cash", "check", "wire", "credit_card", "ach", "card", "other"]),
      note: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payment", issues: parsed.error.issues });

    // Serialize balance checks and ledger writes for this invoice. Without
    // the row lock two valid-looking requests can both spend the same balance.
    const result = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id)))
        .limit(1).for("update");
      if (!inv) return { error: { status: 404, message: "Invoice not found" } };
      if (inv.voidedAt) return { error: { status: 409, message: "This invoice has been voided." } };

      const outstanding = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
      if (outstanding <= 0) return { error: { status: 409, message: "This invoice is already paid in full." } };
      if (parsed.data.amountCents > outstanding) {
        return { error: {
          status: 400,
          message: `Only ${usd(outstanding)} is outstanding on this invoice.`,
          outstandingCents: outstanding,
        } };
      }

      const [pay] = await tx.insert(crmPayments).values({
        orgId: ctx.org.id, customerId: inv.customerId, invoiceId: inv.id,
        projectId: inv.projectId ?? null, provider: "manual", purpose: "progress",
        amountCents: parsed.data.amountCents, currency: "usd",
        method: parsed.data.method, status: "succeeded",
        note: parsed.data.note ?? null, paidAt: new Date(),
      } as any).returning();

      const paid = (inv.paidCents ?? 0) + parsed.data.amountCents;
      const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
      const [row] = await tx.update(crmInvoices).set({
        paidCents: paid, status: paid >= due ? "paid" : "partial",
        paidAt: paid >= due ? new Date() : null, updatedAt: new Date(),
      }).where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, inv.id))).returning();
      return { inv, pay, paid, due, row };
    });
    if (result.error) {
      const { status, ...body } = result.error;
      return res.status(status).json(body);
    }
    const { inv, pay, paid, due, row } = result;

    if (paid >= due) await emitCrmEvent(ctx.org.id, "invoice.paid", { invoiceId: inv.id, paidCents: paid });
    await emitCrmEvent(ctx.org.id, "payment.succeeded", {
      paymentId: pay.id, amountCents: pay.amountCents, method: pay.method,
      invoiceId: inv.id, projectId: inv.projectId,
    });
    // Tell the owner money landed (honors the paymentReceived notification pref).
    notifyPaymentRecorded(ctx.org, inv, parsed.data.amountCents, parsed.data.method, ctx.member.id)
      .catch((e: any) => console.error("[crm] payment-recorded email failed:", e?.message || e));
    // And email the client their receipt-to-date (honors paymentReceipt).
    autoSendPaymentReceipt(ctx.org.id, inv.id)
      .catch((e: any) => console.error("[crm] auto-receipt failed:", e?.message || e));
    // Say whether that receipt will actually go out — the same two gates
    // autoSendPaymentReceipt applies — so the UI never promises one it skips.
    const [receiptTo] = await db.select({ email: crmCustomers.email }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, inv.customerId))).limit(1);
    const receiptSkippedReason = !crmNotificationEnabled(ctx.org.customFields, "paymentReceipt")
      ? "receipts_off" : !receiptTo?.email ? "no_email" : null;
    logActivity(ctx, "payment.recorded", {
      entityType: "payment", entityId: pay.id, customerId: inv.customerId,
      meta: { amountCents: pay.amountCents, method: pay.method, number: inv.number, invoiceId: inv.id },
    });
    res.status(201).json({
      payment: pay, invoice: row,
      receiptQueued: receiptSkippedReason === null, receiptSkippedReason,
    });
  });

  /**
   * Reverse a mistyped MANUAL payment — OWNER only (role, not a permission
   * flag), with a stated reason. Nothing is deleted: the payment row keeps
   * its amount, method, note and date and is marked "reversed" (which every
   * succeeded-only total, receipt and report already excludes), the invoice
   * balance is restored under the same row lock the record route takes, and
   * the reversal lands on the client's notes and the audit log. Stripe
   * payments are never reversed here — their refunds come from Stripe.
   */
  app.post("/api/crm/payments/:id/reverse", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (ctx.member.role !== "owner") {
      return res.status(403).json({ message: "Only the account owner can reverse a payment." });
    }
    const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Say why the payment is being reversed (for example, \"typed $1,000 instead of $100\")." });
    }
    const reason = parsed.data.reason;

    const result = await db.transaction(async (tx) => {
      const [pay] = await tx.select().from(crmPayments)
        .where(and(eq(crmPayments.orgId, ctx.org.id), eq(crmPayments.id, req.params.id)))
        .limit(1).for("update");
      if (!pay) return { error: { status: 404, message: "Payment not found" } };
      if (pay.provider !== "manual") {
        return { error: { status: 409, message: "Only manually recorded payments can be reversed here. Refund online payments from your Stripe dashboard." } };
      }
      if (pay.status === "reversed") return { error: { status: 409, message: "This payment has already been reversed." } };
      if (pay.status !== "succeeded") return { error: { status: 409, message: "Only a recorded payment can be reversed." } };

      let invoice: typeof crmInvoices.$inferSelect | null = null;
      if (pay.invoiceId) {
        const [inv] = await tx.select().from(crmInvoices)
          .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, pay.invoiceId)))
          .limit(1).for("update");
        if (inv) {
          const paid = Math.max(0, (inv.paidCents ?? 0) - pay.amountCents);
          const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
          const status = inv.voidedAt ? "void"
            : paid > 0 && paid >= due ? "paid"
            : paid > 0 ? "partial"
            : inv.sentAt ? "sent" : "draft";
          [invoice] = await tx.update(crmInvoices).set({
            paidCents: paid, status,
            paidAt: status === "paid" ? inv.paidAt ?? new Date() : null, updatedAt: new Date(),
          }).where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, inv.id))).returning();
        }
      }
      const [row] = await tx.update(crmPayments).set({
        status: "reversed",
        failureReason: `Reversed by the account owner: ${reason}`,
        updatedAt: new Date(),
      }).where(and(eq(crmPayments.orgId, ctx.org.id), eq(crmPayments.id, pay.id),
        eq(crmPayments.status, "succeeded"))).returning();
      return { pay: row, invoice };
    });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    const { pay, invoice } = result;

    const when = (pay.paidAt ?? pay.createdAt ?? new Date()).toLocaleDateString("en-US");
    const via = METHOD_LABELS[pay.method ?? ""] ?? pay.method ?? "manual entry";
    await db.insert(crmCustomerNotes).values({
      orgId: ctx.org.id, customerId: pay.customerId, authorMemberId: ctx.member.id,
      body: `A ${usd(pay.amountCents)} payment (${via}, recorded ${when})` +
        `${invoice?.number ? ` on invoice ${invoice.number}` : ""} was reversed by the account owner. Reason: ${reason}`,
    }).catch(() => {});
    logActivity(ctx, "payment.reversed", {
      entityType: "payment", entityId: pay.id, customerId: pay.customerId,
      meta: { number: invoice?.number ?? null, amountCents: pay.amountCents, method: pay.method, reason, invoiceId: pay.invoiceId },
    });
    // Subscribers that were told payment.succeeded (and maybe invoice.paid)
    // hear about the reversal too, with the invoice balance it left behind.
    await emitCrmEvent(ctx.org.id, "payment.reversed", {
      paymentId: pay.id, amountCents: pay.amountCents, method: pay.method, reason,
      invoiceId: pay.invoiceId, projectId: pay.projectId,
      invoiceStatus: invoice?.status ?? null, invoicePaidCents: invoice?.paidCents ?? null,
    });
    res.json({ payment: pay, invoice });
  });

  /** Void an unpaid invoice. Paid invoices keep their audit trail. */
  app.post("/api/crm/invoices/:id/void", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageInvoices");
    if (!ctx) return;
    if (!requirePermission(res, ctx, "seePrices")) return; // an invoice or payment is an amount
    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.voidedAt) return res.status(409).json({ message: "Already voided." });
    if ((inv.paidCents ?? 0) > 0) {
      return res.status(409).json({ message: "Payments have been recorded against this invoice; it can't be voided." });
    }
    const [row] = await db.update(crmInvoices).set({
      voidedAt: new Date(), status: "void", updatedAt: new Date(),
    }).where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, inv.id),
      isNull(crmInvoices.voidedAt), sql`coalesce(${crmInvoices.paidCents}, 0) = 0`)).returning();
    if (!row) return res.status(409).json({ message: "The invoice changed; reload before voiding it." });
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
    const result = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id)))
        .limit(1).for("update");
      if (!inv) return { error: { status: 404, message: "Invoice not found" } };
      const [{ n: paymentCount }] = await tx.select({ n: sql<number>`count(*)::int` })
        .from(crmPayments)
        .where(and(eq(crmPayments.orgId, ctx.org.id), eq(crmPayments.invoiceId, inv.id)));
      const refusal = invoiceDeleteRefusal(inv, paymentCount);
      if (refusal) return { error: { status: 409, message: refusal } };
      await tx.delete(crmInvoiceItems)
        .where(and(eq(crmInvoiceItems.orgId, ctx.org.id), eq(crmInvoiceItems.invoiceId, inv.id)));
      await tx.delete(crmEngagementSessions)
        .where(and(eq(crmEngagementSessions.orgId, ctx.org.id),
          eq(crmEngagementSessions.docType, "invoice"), eq(crmEngagementSessions.docId, inv.id)));
      await tx.delete(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, inv.id)));
      return { inv };
    });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    const { inv } = result;

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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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

    // Money with no cost code is still money spent: it lands in one
    // "Unassigned" line instead of vanishing from every total.
    const UNASSIGNED = "__unassigned";
    const keyOf = (id: string | null | undefined) => id || UNASSIGNED;
    const keys = new Set<string>([
      ...budgets.map((b) => keyOf(b.costCodeId)),
      ...commitments.map((c) => keyOf(c.costCodeId)),
      ...actuals.map((a) => keyOf(a.costCodeId)),
    ]);
    const lines = [...keys].map((key) => {
      const budget = budgets.filter((b) => keyOf(b.costCodeId) === key).reduce((s, b) => s + b.budgetCents, 0);
      const committed = commitments.filter((c) => keyOf(c.costCodeId) === key).reduce((s, c) => s + c.amountCents, 0);
      const actual = actuals.filter((a) => keyOf(a.costCodeId) === key).reduce((s, a) => s + a.amountCents, 0);
      const ccId = key === UNASSIGNED ? null : key;
      const cc = ccId ? codeById.get(ccId) : undefined;
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      type: z.enum(CRM_COMMITMENT_TYPES as unknown as [string, ...string[]]).default("purchase_order"),
      costCodeId: z.string().nullable().optional(), vendorName: z.string().max(200).nullable().optional(),
      supplier: z.string().max(40).nullable().optional(), description: z.string().max(4000).nullable().optional(),
      amountCents: z.number().int().min(0), externalOrderId: z.string().max(120).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid commitment", issues: parsed.error.issues });
    // Numbered inside the insert transaction under the org's PO lock — never
    // count(*)+1, which repeats a number after a delete and races.
    const row = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "PO", ctx.org.id);
      const [inserted] = await tx.insert(crmCommitments).values({
        ...parsed.data, orgId: ctx.org.id, projectId: proj.id, number,
      } as any).returning();
      return inserted;
    });
    res.status(201).json(row);
  });

  app.post("/api/crm/projects/:id/costs", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "seeCosts");
    if (!ctx) return;
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
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
  // Appointment CRUD lives in schedule.ts (registerCrmScheduleRoutes) — the
  // calendar page is its editor, and lane a1 owns the crm_appointments logic.

  // ══ CHANGE ORDERS ═════════════════════════════════════════════════════════

  /** A change order as a seat may read it: the amount is a price, the cost is a cost; the token never ships. */
  const presentChangeOrder = (c: typeof crmChangeOrders.$inferSelect, ctx: OrgContext) =>
    ({ ...stripMoney(ctx, c, { price: ["amountCents"], cost: ["costCents"] }), publicToken: undefined });

  app.get("/api/crm/projects/:id/change-orders", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const rows = await db.select().from(crmChangeOrders)
      .where(and(eq(crmChangeOrders.orgId, ctx.org.id), eq(crmChangeOrders.projectId, proj.id)))
      .orderBy(desc(crmChangeOrders.createdAt));
    res.json(rows.map((c) => ({
      ...presentChangeOrder(c, ctx),
      publicPath: ctx.permissions.manageEstimates ? `/co/${c.publicToken}` : undefined,
    })));
  });

  app.post("/api/crm/projects/:id/change-orders", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "approveChangeOrders");
    if (!ctx) return;
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      title: z.string().min(1).max(200), description: z.string().max(20000).nullable().optional(),
      amountCents: z.number().int(), costCents: z.number().int().min(0).nullable().optional(),
      scheduleImpactDays: z.number().int().min(-365).max(365).default(0),
      costCodeId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid change order", issues: parsed.error.issues });
    // Same numbering rule as invoices and POs: allocated under the org's CO
    // lock inside the insert transaction (the CO series starts at CO-101).
    const row = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "CO", ctx.org.id);
      const [inserted] = await tx.insert(crmChangeOrders).values({
        ...parsed.data, orgId: ctx.org.id, projectId: proj.id, customerId: proj.customerId,
        number, publicToken: tok(),
      } as any).returning();
      return inserted;
    });
    logActivity(ctx, "changeorder.created", {
      entityType: "change_order", entityId: row.id, customerId: row.customerId,
      meta: { number: row.number, title: row.title, amountCents: row.amountCents },
    });
    res.status(201).json({ ...presentChangeOrder(row, ctx), publicPath: `/co/${row.publicToken}` });
  });

  /** Stamp a change order sent and hand back its public link — open tracking
   *  (firstViewedAt) only counts from this point, same rule as estimates. */
  app.post("/api/crm/change-orders/:id/send", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "approveChangeOrders");
    if (!ctx) return;
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "jobCosting")) return;
    const [co] = await db.select().from(crmChangeOrders)
      .where(and(eq(crmChangeOrders.orgId, ctx.org.id), eq(crmChangeOrders.id, req.params.id))).limit(1);
    if (!co) return res.status(404).json({ message: "Change order not found" });
    const [row] = await db.update(crmChangeOrders).set({
      sentAt: co.sentAt ?? new Date(),
      status: co.status === "draft" ? "sent" : co.status,
      updatedAt: new Date(),
    }).where(eq(crmChangeOrders.id, co.id)).returning();
    logActivity(ctx, "changeorder.sent", {
      entityType: "change_order", entityId: co.id, customerId: co.customerId,
      meta: { number: co.number, title: co.title },
    });
    res.json({ changeOrder: presentChangeOrder(row, ctx), link: `${getBaseUrl(req)}/co/${co.publicToken}` });
  });

  /** Public: client approves/declines a change order. */
  app.get("/api/public/change-orders/:token", async (req: any, res) => {
    const [co] = await db.select().from(crmChangeOrders)
      .where(eq(crmChangeOrders.publicToken, String(req.params.token))).limit(1);
    if (!co) return res.status(404).json({ message: "This link is no longer valid." });
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, co.orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    if (!await requireCrmFeature(res, org.ownerUserId, "jobCosting")) return;
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
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, co.orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    if (!await requireCrmFeature(res, org.ownerUserId, "jobCosting")) return;
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
    /** Money keys on the row, stripped per seat on every response (stripMoney). */
    money: { price?: readonly string[]; cost?: readonly string[] } = {},
  ) => {
    const present = (ctx: OrgContext, row: any) => stripMoney(ctx, row, money);
    app.get(`/api/crm/projects/:id/${path}`, async (req: any, res) => {
      const ctx = await ctxFor(req, res);
      if (!ctx) return;
      const proj = await ownProject(ctx.org.id, req.params.id);
      if (!proj) return res.status(404).json({ message: "Project not found" });
      const rows = await db.select().from(table)
        .where(and(eq(table.orgId, ctx.org.id), eq(table.projectId, proj.id)))
        .orderBy(order ?? desc(table.createdAt)).limit(1000);
      res.json(rows.map((r: any) => present(ctx, r)));
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
      res.status(201).json(present(ctx, inserted[0]));
    });
    app.patch(`/api/crm/${path}/:childId`, async (req: any, res) => {
      const ctx = await ctxFor(req, res, perm);
      if (!ctx) return;
      const parsed = (schema as any).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: `Invalid ${path}` });
      const updated: any[] = await db.update(table).set({ ...(parsed.data as any), updatedAt: new Date() })
        .where(and(eq(table.orgId, ctx.org.id), eq(table.id, req.params.childId))).returning() as any;
      if (!updated[0]) return res.status(404).json({ message: "Not found" });
      res.json(present(ctx, updated[0]));
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
    // The allowance and what the client's choice came to are prices the
    // homeowner is billed — a price-blind crew sees the selection, not the money.
  }), "manageJobs", null, { price: ["allowanceCents", "actualCents"] });

  const dailyLogSchema = z.object({
    logDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid log date.").optional(),
    weather: z.string().max(100).nullable().optional(),
    tempF: z.number().int().min(-80).max(150).nullable().optional(),
    crewCount: z.number().int().min(0).max(500).nullable().optional(),
    hoursMilli: z.number().int().min(0).nullable().optional(),
    workCompleted: z.string().max(20000).nullable().optional(),
    delays: z.string().max(8000).nullable().optional(),
    visitors: z.string().max(2000).nullable().optional(),
    safetyNotes: z.string().max(8000).nullable().optional(),
    photoUrls: z.array(z.string().max(1000)).max(50).nullable().optional(),
  });

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
    const parsed = dailyLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid daily log", issues: parsed.error.issues });
    // Any crew member can file a log — that's the point of a daily log.
    const [row] = await db.insert(crmDailyLogs).values({
      ...parsed.data, orgId: ctx.org.id, projectId: proj.id,
      authorMemberId: ctx.member.id,
      logDate: parsed.data.logDate ? new Date(parsed.data.logDate) : new Date(),
    } as any).returning();
    res.status(201).json(row);
  });

  /**
   * Load a daily log for an edit or delete: in the caller's org, on a project
   * the caller can see, and written by the caller unless they can manage jobs
   * (a crew member fixes their own typo; a PM or owner can fix anyone's).
   * "daily-logs" is not an object family the route-template gate knows, so
   * the project visibility check (division scope, assignment) runs here — a
   * log on a hidden project looks absent, even to someone with manageJobs.
   */
  async function editableDailyLog(ctx: OrgContext, logId: string, res: any) {
    const [log] = await db.select().from(crmDailyLogs)
      .where(and(eq(crmDailyLogs.orgId, ctx.org.id), eq(crmDailyLogs.id, logId))).limit(1);
    if (!log || !(await objectPolicy(ctx).visible("projects", log.projectId))) {
      res.status(404).json({ message: "Daily log not found" });
      return null;
    }
    if (log.authorMemberId !== ctx.member.id && !ctx.permissions.manageJobs) {
      res.status(403).json({ message: "Only the log's author or someone who can manage jobs can change it." });
      return null;
    }
    return log;
  }

  app.patch("/api/crm/daily-logs/:logId", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const parsed = dailyLogSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid daily log", issues: parsed.error.issues });
    const log = await editableDailyLog(ctx, req.params.logId, res);
    if (!log) return;
    const { logDate, ...rest } = parsed.data;
    const patch: Record<string, unknown> = { ...rest };
    if (logDate !== undefined) patch.logDate = new Date(logDate);
    if (!Object.keys(patch).length) return res.json(log);
    // crm_daily_logs has no updated_at column — nothing else to stamp.
    const [row] = await db.update(crmDailyLogs).set(patch as any)
      .where(and(eq(crmDailyLogs.orgId, ctx.org.id), eq(crmDailyLogs.id, log.id))).returning();
    res.json(row);
  });

  app.delete("/api/crm/daily-logs/:logId", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const log = await editableDailyLog(ctx, req.params.logId, res);
    if (!log) return;
    await db.delete(crmDailyLogs)
      .where(and(eq(crmDailyLogs.orgId, ctx.org.id), eq(crmDailyLogs.id, log.id)));
    res.json({ ok: true });
  });

  // ══ PERMITS — our moat, finally wired to the CRM ═══════════════════════════

  /** Find verified permit portals + appraisers for a project's jurisdiction. */
  app.get("/api/crm/projects/:id/permits/suggest", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const proj = await ownProject(ctx.org.id, req.params.id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    res.json(await suggestPermitOffices(proj.city || "", proj.state || ""));
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
    if (!await requireCrmFeature(res, ctx.org.ownerUserId, "api")) return;
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
    if (!parsed.success) {
      // One plain sentence for the toast; the raw issues stay for API callers.
      const issue = parsed.error.issues[0];
      const field = issue?.path?.[0];
      const message = field === "url"
        ? "Webhook URL must be a full web address, e.g. https://example.com/hooks/crm."
        : field === "events" && issue.code === "invalid_enum_value"
          ? `"${String(issue.received)}" isn't a webhook event this CRM sends.`
          : field === "events" && issue.code === "too_big"
            ? `Pick at most ${issue.maximum} events.`
            : field === "events" ? "Pick at least one event to send." : "Invalid webhook";
      return res.status(400).json({ message, issues: parsed.error.issues });
    }
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

  /** An option tier per seat: totals and line prices are prices, line costs are costs (the pm is cost-blind). */
  const presentOption = (o: typeof crmEstimateOptions.$inferSelect, ctx: OrgContext) => ({
    ...stripMoney(ctx, o, { price: ["subtotalCents", "totalCents"] }),
    items: Array.isArray(o.items)
      ? (o.items as any[]).map((i) => stripMoney(ctx, i, { price: ["unitPriceCents"], cost: ["unitCostCents"] }))
      : o.items,
  });

  app.get("/api/crm/estimates/:id/options", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmEstimateOptions)
      .where(and(eq(crmEstimateOptions.orgId, ctx.org.id), eq(crmEstimateOptions.estimateId, req.params.id)))
      .orderBy(asc(crmEstimateOptions.tier));
    res.json(rows.map((o) => presentOption(o, ctx)));
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
    res.status(201).json(presentOption(row, ctx));
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
