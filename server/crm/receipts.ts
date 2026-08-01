/**
 * Receipt-to-date: what the client has paid on an invoice so far and what's
 * still owing. One click previews it, a second click emails it — and every
 * successful payment (manual or Stripe) emails one automatically, unless the
 * org turned the 'paymentReceipt' notification pref off in Settings.
 *
 * Same two rules as everywhere: org-scoped queries, and the send is gated on
 * manageInvoices.
 */
import type { Express } from "express";
import { db } from "../db";
import {
  crmInvoices, crmInvoiceItems, crmPayments, crmCustomers, crmOrgs,
  crmNotificationEnabled,
} from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { companyBranding, resolveInvoiceDivision, type CompanyBranding } from "./divisions";
import { sendWithFallback } from "../email";

type GetUser = (req: any, res: any) => any;

const money = (c?: number | null) =>
  `$${((c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

/** Human label for a payment method on the receipt. */
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", check: "Check", wire: "Wire transfer", credit_card: "Credit card",
  ach: "Bank transfer (ACH)", card: "Card", other: "Other",
};

export interface ReceiptData {
  invoice: {
    id: string; number: string | null; title: string; status: string;
    createdAt: Date | null; dueAt: Date | null; paidAt: Date | null;
  };
  customer: {
    displayName: string; email: string | null;
    addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  };
  items: {
    name: string; description: string | null; kind: string;
    quantityMilli: number; unit: string | null; unitPriceCents: number; lineTotalCents: number;
  }[];
  subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  retainageCents: number;
  payments: { id: string; amountCents: number; method: string | null; note: string | null; paidAt: Date | null }[];
  totalPaidCents: number;
  balanceCents: number;
  paidInFull: boolean;
  company: CompanyBranding;
  generatedAt: string;
}

/** Assemble the receipt for an invoice row the caller has already verified. */
export async function buildReceiptData(
  org: typeof crmOrgs.$inferSelect,
  inv: typeof crmInvoices.$inferSelect,
): Promise<ReceiptData | null> {
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
  if (!cust) return null;
  const items = await db.select().from(crmInvoiceItems)
    .where(eq(crmInvoiceItems.invoiceId, inv.id)).orderBy(asc(crmInvoiceItems.sortOrder));
  const payments = await db.select().from(crmPayments)
    .where(and(eq(crmPayments.orgId, inv.orgId), eq(crmPayments.invoiceId, inv.id), eq(crmPayments.status, "succeeded")))
    .orderBy(asc(crmPayments.paidAt));

  // Retainage is withheld until closeout, so "owing" is the due amount less
  // what's been paid — the same math the pay page and webhook use.
  const dueCents = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
  const totalPaidCents = inv.paidCents ?? 0;
  const balanceCents = Math.max(0, dueCents - totalPaidCents);

  return {
    invoice: {
      id: inv.id, number: inv.number, title: inv.title, status: inv.status,
      createdAt: inv.createdAt, dueAt: inv.dueAt, paidAt: inv.paidAt,
    },
    customer: {
      displayName: cust.displayName, email: cust.email,
      addressLine1: cust.addressLine1, city: cust.city, state: cust.state, postalCode: cust.postalCode,
    },
    items: items.map((i) => ({
      name: i.name, description: i.description, kind: i.kind,
      quantityMilli: i.quantityMilli, unit: i.unit, unitPriceCents: i.unitPriceCents,
      lineTotalCents: Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
    })),
    subtotalCents: inv.subtotalCents, discountCents: inv.discountCents,
    taxCents: inv.taxCents, totalCents: inv.totalCents,
    retainageCents: inv.retainageCents ?? 0,
    payments: payments.map((p) => ({
      id: p.id, amountCents: p.amountCents, method: p.method, note: p.note, paidAt: p.paidAt,
    })),
    totalPaidCents,
    balanceCents,
    paidInFull: totalPaidCents >= dueCents,
    company: companyBranding(org, await resolveInvoiceDivision(inv)),
    generatedAt: new Date().toISOString(),
  };
}

/** Branded HTML body for the receipt email. */
export function receiptHtml(r: ReceiptData): string {
  const b = r.company;
  const itemRows = r.items
    .filter((i) => i.kind !== "discount")
    .map((i) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${(i.quantityMilli / 1000).toLocaleString("en-US")}${i.unit ? ` ${esc(i.unit)}` : ""}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.lineTotalCents)}</td>
    </tr>`).join("");
  const paymentRows = r.payments.map((p) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-US") : "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(METHOD_LABELS[p.method ?? ""] ?? p.method ?? "Payment")}${p.note ? ` — ${esc(p.note)}` : ""}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(p.amountCents)}</td>
    </tr>`).join("");
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px">
    <h2 style="margin:0 0 4px">Receipt — ${esc(r.invoice.number ?? "invoice")}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px">${esc(b.name)} · payments to date</p>
    ${r.paidInFull ? `<p style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;
        padding:6px 14px;border-radius:6px;margin:0 0 16px">PAID IN FULL</p>` : ""}
    <p style="font-size:14px"><strong>Bill to:</strong> ${esc(r.customer.displayName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
      <thead><tr style="color:#666;font-size:12px;text-align:left">
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Item</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd;text-align:right">Qty</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="font-size:14px;text-align:right;margin:4px 0">
      ${r.discountCents ? `Discount −${money(r.discountCents)} &nbsp; ` : ""}${r.taxCents ? `Tax ${money(r.taxCents)} &nbsp; ` : ""}
      <strong>Invoice total ${money(r.totalCents)}</strong></p>
    <h3 style="margin:18px 0 6px;font-size:15px">Payments received</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="color:#666;font-size:12px;text-align:left">
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Date</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd">Method</th>
        <th style="padding:6px 8px;border-bottom:2px solid #ddd;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>
    <p style="font-size:16px;text-align:right;margin:14px 0 2px"><strong>Total paid: ${money(r.totalPaidCents)}</strong></p>
    <p style="font-size:16px;text-align:right;margin:2px 0">
      ${r.paidInFull ? `<strong>Balance owing: ${money(0)}</strong>` : `<strong>Balance owing: ${money(r.balanceCents)}</strong>`}
    </p>
    ${r.retainageCents ? `<p style="font-size:13px;color:#666;text-align:right">${money(r.retainageCents)} retainage is withheld until closeout.</p>` : ""}
    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
    <p style="font-size:13px;color:#666">
      ${esc(b.name)}${b.phone ? ` &middot; ${esc(b.phone)}` : ""}${b.website ? ` &middot; ${esc(b.website)}` : ""}
      ${b.addressLine1 ? `<br>${esc([b.addressLine1, b.addressLine2].filter(Boolean).join(", "))}${b.city ? `, ${esc(b.city)}` : ""}${b.state ? `, ${esc(b.state)}` : ""}${b.postalCode ? ` ${esc(b.postalCode)}` : ""}` : ""}
      ${b.licenseNumber ? `<br>License ${esc(b.licenseNumber)}${b.licenseState ? ` (${esc(b.licenseState)})` : ""}` : ""}
    </p>
  </div>`;
}

/**
 * Record the email attempt on the invoice (custom_fields->'receipt') so the
 * CRM — and the test suite — can see a receipt went out, even when SMTP is
 * down in dev. Merges; never clobbers sibling keys.
 */
async function noteReceiptEmail(
  inv: typeof crmInvoices.$inferSelect, to: string, emailed: boolean,
): Promise<void> {
  const cf = ((inv.customFields as Record<string, unknown> | null) ?? {});
  const prev = (cf.receipt as Record<string, unknown> | undefined) ?? {};
  await db.update(crmInvoices).set({
    customFields: {
      ...cf,
      receipt: {
        attempts: Number(prev.attempts ?? 0) + 1,
        lastTo: to,
        lastAt: new Date().toISOString(),
        lastEmailed: emailed,
      },
    },
    updatedAt: new Date(),
  }).where(eq(crmInvoices.id, inv.id));
}

/**
 * Auto-receipt: after ANY successful payment lands on an invoice, email the
 * client their receipt-to-date. Honors the org's 'paymentReceipt' pref
 * (default ON). Best-effort — callers fire-and-forget; a mail failure must
 * never fail the payment that triggered it.
 */
export async function autoSendPaymentReceipt(orgId: string, invoiceId: string): Promise<void> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return;
  // The org can silence the auto-receipt in Settings (default: on).
  if (!crmNotificationEnabled(org.customFields, "paymentReceipt")) return;
  const [inv] = await db.select().from(crmInvoices)
    .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.id, invoiceId))).limit(1);
  if (!inv || (inv.paidCents ?? 0) <= 0) return;
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
  if (!cust?.email) return;

  const receipt = await buildReceiptData(org, inv);
  if (!receipt) return;
  let emailed = false;
  try {
    await sendWithFallback({
      to: cust.email,
      subject: `Receipt from ${receipt.company.name} — ${inv.number ?? "your invoice"}${receipt.paidInFull ? " (paid in full)" : ""}`,
      html: receiptHtml(receipt),
      replyTo: receipt.company.email || undefined,
    } as any);
    emailed = true;
  } catch (e: any) {
    console.error("[crm] auto-receipt email failed:", String(e?.message || e).slice(0, 300));
  }
  await noteReceiptEmail(inv, cust.email, emailed).catch(() => {});
}

export function registerCrmReceiptRoutes(app: Express, getDevUser: GetUser): void {
  /** The receipt-to-date data for the preview dialog. */
  app.get("/api/crm/invoices/:id/receipt", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageInvoices")) return;

    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    const receipt = await buildReceiptData(ctx.org, inv);
    if (!receipt) return res.status(404).json({ message: "Customer not found" });
    res.json(receipt);
  });

  /** Email the receipt to the invoice's customer. Pointless with $0 paid. */
  app.post("/api/crm/invoices/:id/receipt/send", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageInvoices")) return;

    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.voidedAt) return res.status(409).json({ message: "This invoice has been voided." });
    if ((inv.paidCents ?? 0) <= 0) {
      return res.status(409).json({
        message: "No payments have been recorded on this invoice yet — a receipt would show $0 paid.",
      });
    }
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });
    const to = cust.email;
    if (!to) return res.status(400).json({ message: "This client has no email address. Add one first." });

    const receipt = await buildReceiptData(ctx.org, inv);
    if (!receipt) return res.status(404).json({ message: "Customer not found" });

    let emailed = false, emailError: string | null = null;
    try {
      await sendWithFallback({
        to,
        subject: `Receipt from ${receipt.company.name} — ${inv.number ?? "your invoice"}${receipt.paidInFull ? " (paid in full)" : ""}`,
        html: receiptHtml(receipt),
        replyTo: receipt.company.email || undefined,
      } as any);
      emailed = true;
    } catch (e: any) {
      emailError = String(e?.message || e).slice(0, 300);
      console.error("[crm] receipt send failed:", emailError);
    }

    await noteReceiptEmail(inv, to, emailed).catch(() => {});
    res.json({ receipt, to, emailed, emailError });
  });
}
