/**
 * The client's paper trail in one place (owner, 2026-10-18): every estimate, signed contract, invoice and receipt a
 * client has, on their profile and in their portal — including everything imported from Housecall Pro.
 *
 * Receipts: HCP sent one per payment; its export carried none, so the CRM renders one per payment from the payment
 * records that WERE imported (amount, method, date, the invoice, the balance after it) — branded, printable, the
 * browser's Print → Save as PDF makes the file. One route for staff, one for the client behind the document gate.
 */
import type { Express } from "express";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { crmAttachments, crmCustomers, crmEstimates, crmInvoices, crmOrgs, crmPayments } from "@shared/schema";
import { requireOrg, requirePermission } from "./tenancy";
import { objectPolicy } from "./object-access";
import { requireDocSession } from "./portal";
import { type ReceiptData } from "./receipts";
import { serveStaffReceipt, buildPaymentReceipt, paymentReceiptPage as paymentReceiptDocument, receiptsForEstimates } from "./payment-receipts";

type GetUser = (req: any, res: any) => any;

const money = (c?: number | null) => `$${((c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const esc = (s?: string | null) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", check: "Check", wire: "Wire transfer", credit_card: "Credit card", ach: "Bank transfer (ACH)", card: "Card", other: "Other",
};
const RECEIPT_STATUSES = ["succeeded", "partially_refunded"];

/** A full, printable HTML page for ONE payment on an invoice: what was paid, how, when, and the balance after it. */
export function paymentReceiptPage(r: ReceiptData, paymentId: string): string | null {
  // The ledger in date order — payments AND refunds (negative entries) — so "paid to date" after this payment nets out
  // any money already returned before it (Codex audit: a refund between two payments must not print PAID IN FULL).
  // Ties on the same instant: refunds first, then by id, so the result never depends on query order.
  const ordered = [...r.payments].sort((a, b) =>
    (new Date(a.paidAt ?? 0).getTime() - new Date(b.paidAt ?? 0).getTime()) || (Math.sign(a.amountCents) - Math.sign(b.amountCents)) || a.id.localeCompare(b.id));
  const idx = ordered.findIndex((p) => p.id === paymentId && p.amountCents > 0);
  if (idx < 0) return null;
  const p = ordered[idx];
  const paidThrough = Math.max(0, ordered.slice(0, idx + 1).reduce((s, x) => s + x.amountCents, 0));
  const dueCents = r.totalCents - r.retainageCents;
  const balanceAfter = Math.max(0, dueCents - paidThrough);
  // Money returned AFTER this payment (a later refund, including a partial refund of this very payment): the receipt
  // is rendered on demand, so it says so and never stamps PAID IN FULL on an invoice that is no longer paid (Kimi audit).
  const refundedAfter = -ordered.slice(idx + 1).filter((x) => x.amountCents < 0).reduce((s, x) => s + x.amountCents, 0);
  const paidInFull = balanceAfter === 0 && refundedAfter === 0;
  const b = r.company;
  const date = p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";
  const title = `Receipt — ${r.invoice.number ?? "invoice"} — ${money(p.amountCents)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;background:#f6f6f6}
  .page{max-width:640px;margin:24px auto;background:#fff;padding:32px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 2px} .muted{color:#666;font-size:13px} table{width:100%;border-collapse:collapse;font-size:15px;margin:18px 0}
  td{padding:9px 0;border-bottom:1px solid #eee} td:last-child{text-align:right} .big{font-size:20px;font-weight:700}
  .paid{display:inline-block;background:#16a34a;color:#fff;font-weight:700;padding:5px 12px;border-radius:6px;font-size:13px}
  .actions{margin:0 0 16px;display:flex;gap:8px} button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.actions{display:none}}
</style></head><body><div class="page">
  <div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${esc(b.name)}</h1>
  <div class="muted">${[b.phone, b.email].filter(Boolean).map((x) => esc(x!)).join(" · ")}</div>
  <h2 style="font-size:17px;margin:22px 0 4px">Receipt</h2>
  <div class="muted">${esc(r.invoice.number ?? "")}${r.invoice.title ? ` · ${esc(r.invoice.title)}` : ""} · ${esc(date)}</div>
  <table>
    <tr><td>Received from</td><td>${esc(r.customer.displayName)}</td></tr>
    <tr><td>Amount received</td><td class="big">${money(p.amountCents)}</td></tr>
    <tr><td>Paid by</td><td>${esc(METHOD_LABELS[p.method ?? ""] ?? p.method ?? "Payment")}${p.note ? ` — ${esc(p.note)}` : ""}</td></tr>
    <tr><td>Invoice total</td><td>${money(r.totalCents)}${r.retainageCents ? ` <span class="muted">(${money(r.retainageCents)} retainage withheld)</span>` : ""}</td></tr>
    <tr><td>Paid to date (after this payment)</td><td>${money(paidThrough)}</td></tr>
    <tr><td>Balance after this payment</td><td>${paidInFull ? `<span class="paid">PAID IN FULL</span>` : money(balanceAfter)}</td></tr>
    ${refundedAfter > 0 ? `<tr><td>Refunded since this payment</td><td>${money(refundedAfter)}</td></tr>
    <tr><td>Balance now</td><td>${money(Math.max(0, dueCents - Math.max(0, ordered.reduce((s, x) => s + x.amountCents, 0))))}</td></tr>` : ""}
  </table>
  <p class="muted">Thank you for your business. Questions about this receipt? ${b.phone ? `Call ${esc(b.phone)}` : "Reply to the email it came with"}.</p>
  <p class="muted" style="margin-top:26px;font-size:11px">Receipt ${esc(paymentId)} · generated ${esc(new Date(r.generatedAt).toLocaleString("en-US"))}</p>
</div></body></html>`;
}

/** Every receipt (one per payment) on a set of invoices, newest first, with the links a caller should show. */
export async function receiptsForInvoices(orgId: string, invoices: { id: string; number: string | null; publicToken: string }[], audience: "crm" | "portal") {
  if (!invoices.length) return [];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const rows = await db.select().from(crmPayments)
    .where(and(eq(crmPayments.orgId, orgId), inArray(crmPayments.invoiceId, invoices.map((i) => i.id)), inArray(crmPayments.status, RECEIPT_STATUSES), gt(crmPayments.amountCents, 0)))
    .orderBy(desc(crmPayments.paidAt), desc(crmPayments.createdAt));
  return rows.map((p) => {
    const inv = byId.get(p.invoiceId!)!;
    return {
      paymentId: p.id, receiptNumber: p.receiptNumber ?? null, invoiceId: inv.id, invoiceNumber: inv.number,
      estimateId: null as string | null, estimateNumber: null as string | null,
      amountCents: p.amountCents, method: p.method, paidAt: p.paidAt ?? p.createdAt, provider: p.provider,
      link: audience === "crm" ? `/api/crm/receipts/${p.id}.html` : `/api/public/invoices/${inv.publicToken}/receipts/${p.id}.html`,
    };
  });
}

export function registerCrmClientDocumentRoutes(app: Express, getDevUser: GetUser): void {
  /** The client's documents: estimates, signed contracts, invoices, receipts — with the links to open each. */
  app.get("/api/crm/customers/:id/documents", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "seePrices")) return; // every document here is an amount
    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, String(req.params.id)))).limit(1);
    if (!cust || !(await objectPolicy(ctx).visible("customers", cust.id))) return res.status(404).json({ message: "Client not found" });
    // Seeing the client does not mean seeing every document: a seat assigned to one of the client's projects, or pinned
    // to one division, gets only the estimates and invoices it could open directly (Codex audit, 2026-10-18).
    const policy = objectPolicy(ctx);
    const [allEstimates, allInvoices] = await Promise.all([
      db.select().from(crmEstimates).where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.customerId, cust.id))).orderBy(desc(crmEstimates.createdAt)),
      db.select().from(crmInvoices).where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.customerId, cust.id), isNull(crmInvoices.voidedAt))).orderBy(desc(crmInvoices.createdAt)),
    ]);
    const [estimates, invoices] = await Promise.all([policy.filter("estimates", allEstimates), policy.filter("invoices", allInvoices)]);
    const estIds = estimates.map((e) => e.id);
    const contracts = estIds.length ? await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "contract"), inArray(crmAttachments.refId, estIds)))
      .orderBy(asc(crmAttachments.createdAt)) : [];
    const contractByEstimate = new Map<string, typeof contracts[number]>();
    for (const c of contracts) if (c.refId && !contractByEstimate.has(c.refId)) contractByEstimate.set(c.refId, c);
    // The bid as a document: a PDF filed on the estimate (kind "estimate" — the HCP import files Housecall Pro's own
    // PDF of every bid there; photos on the estimate share the kind and are not documents). Earliest PDF wins.
    const bidPdfs = estIds.length ? await db.select().from(crmAttachments)
      .where(and(eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.kind, "estimate"), eq(crmAttachments.mime, "application/pdf"), inArray(crmAttachments.refId, estIds)))
      .orderBy(asc(crmAttachments.createdAt)) : [];
    const bidPdfByEstimate = new Map<string, typeof bidPdfs[number]>();
    for (const b of bidPdfs) if (b.refId && !bidPdfByEstimate.has(b.refId)) bidPdfByEstimate.set(b.refId, b);
    const fileOf = (a: { id: string; fileName: string } | undefined) => (a ? { id: a.id, fileName: a.fileName, downloadUrl: `/api/crm/attachments/${a.id}/file` } : null);
    // Payments on invoices AND deposits / pay-in-full taken on the estimate before any invoice, newest first.
    const receipts = [...await receiptsForInvoices(ctx.org.id, invoices, "crm"), ...await receiptsForEstimates(ctx.org.id, estimates, "crm")]
      .sort((a, b) => new Date(b.paidAt ?? 0).getTime() - new Date(a.paidAt ?? 0).getTime());
    res.json({
      customer: { id: cust.id, displayName: cust.displayName },
      estimates: estimates.map((e) => ({
        id: e.id, number: e.number, title: e.title, status: e.status, totalCents: e.approvedTotalCents ?? e.totalCents,
        sentAt: e.sentAt, approvedAt: e.approvedAt, createdAt: e.createdAt,
        link: `/crm/estimates/${e.id}`, clientLink: `/e/${e.publicToken}`, imported: !!(e.customFields as any)?.hcpId,
        contract: fileOf(contractByEstimate.get(e.id)),
        bidPdf: fileOf(bidPdfByEstimate.get(e.id)),
      })),
      contracts: estimates.filter((e) => e.approvedAt).map((e) => {
        const c = contractByEstimate.get(e.id);
        // "pro approved" = marked approved by staff in Housecall Pro; the client never e-signed, so no signed copy exists anywhere.
        const signoff = String((e.customFields as any)?.hcpSignoff ?? "") || null;
        return { estimateId: e.id, estimateNumber: e.number, title: e.title, approvedAt: e.approvedAt, totalCents: e.approvedTotalCents ?? e.totalCents,
          attachmentId: c?.id ?? null, fileName: c?.fileName ?? null, downloadUrl: c ? `/api/crm/attachments/${c.id}/file` : null,
          signoff, bidPdf: fileOf(bidPdfByEstimate.get(e.id)) };
      }),
      invoices: invoices.map((i) => ({
        id: i.id, number: i.number, title: i.title, status: i.status, totalCents: i.totalCents, paidCents: i.paidCents ?? 0,
        dueCents: Math.max(0, i.totalCents - (i.retainageCents ?? 0) - (i.paidCents ?? 0)), sentAt: i.sentAt, paidAt: i.paidAt, createdAt: i.createdAt,
        link: `/crm/invoices?open=${i.id}`, clientLink: `/i/${i.publicToken}`, imported: !!(i.customFields as any)?.hcpId,
        receipts: receipts.filter((r) => r.invoiceId === i.id).length,
      })),
      receipts,
    });
  });

  /** Staff: one payment's receipt as a printable page (Print → Save as PDF). */
  app.get("/api/crm/receipts/:id.html", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Same gate as the Documents card that links here (seePrices + the invoice's object policy): a seat that can read
    // the amounts on the card can open the receipt behind them (Kimi audit — it used to demand manageInvoices too).
    if (!requirePermission(res, ctx, "seePrices")) return;
    // Any payment — on an invoice or a deposit on the estimate — with its receipt number and the job's balance.
    await serveStaffReceipt(ctx, req, res);
  });

  /** The client: the same receipt from their portal / invoice page, behind the document gate. */
  app.get("/api/public/invoices/:token/receipts/:paymentId.html", async (req: any, res) => {
    const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.publicToken, String(req.params.token))).limit(1);
    if (!inv) return res.status(404).send("Not found");
    if (!(await requireDocSession(req, res, inv.customerId))) return;
    const [pay] = await db.select().from(crmPayments)
      .where(and(eq(crmPayments.orgId, inv.orgId), eq(crmPayments.invoiceId, inv.id), eq(crmPayments.id, String(req.params.paymentId)), inArray(crmPayments.status, RECEIPT_STATUSES))).limit(1);
    if (!pay) return res.status(404).send("Not found");
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, inv.orgId)).limit(1);
    const r = org && await buildPaymentReceipt(org, pay);
    const html = r && paymentReceiptDocument(r);
    if (!html) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(html);
  });
}
