/**
 * One receipt per payment, for every way money arrives — a deposit or
 * pay-in-full on the estimate page, a payment on a payment request (invoice),
 * or a check / cash / Zelle payment staff record by hand (owner, 2026-10-21:
 * "a receipt is generated automatically when the client pays the down payment
 * or paid in full").
 *
 *   - A human receipt number (R-1001…) is allocated the first time a payment's
 *     receipt is built, per org, under the same advisory-lock pattern as
 *     doc-number.ts, and stored on the payment, so it never changes.
 *   - The letterhead is the job's division (WA vs FL), never the org owner's
 *     details on the wrong division; with no division on the job, the
 *     client's division (by their latest estimate, else their state).
 *   - The balance is the JOB's: the signed contract less everything received
 *     through this payment, in date order — PAID IN FULL only at zero and
 *     only when nothing has been refunded since.
 *
 * Routes: the printable page for staff and for the client (behind the same
 * email gate as the estimate), a staff "resend", and the estimate's balance
 * ledger the CRM's payment card reads.
 */
import type { Express } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { crmCustomers, crmEstimates, crmInvoices, crmOrgs, crmPayments } from "@shared/schema";
import { receiptSettingsOf, paymentMethodLabel, offlinePaymentInstructionsFor } from "@shared/payment-settings";
import { estimateLedger, balanceAfterPayment, LEDGER_PAID_STATUSES, invoiceDueNowCents } from "@shared/estimate-ledger";
import { requireOrg, requirePermission, requireAnyPermission } from "./tenancy";
import { objectPolicy } from "./object-access";
import { requireDocSession } from "./portal";
import {
  companyBranding, resolveEstimateDivision, resolveInvoiceDivision, resolveClientDivision, divisionContactMember,
  type CompanyBranding,
} from "./divisions";
import { recordActivity } from "./activity";
import { paymentRefundTotals } from "./refund-summary";
import { sendWithFallback } from "../email";
import { sendSms, normalizePhone, orgCanTextClients } from "./sms";
import { logError } from "../ops/log";

type GetUser = (req: any, res: any) => any;
type Org = typeof crmOrgs.$inferSelect;
type Payment = typeof crmPayments.$inferSelect;

const money = (c?: number | null) => `$${((c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s?: string | null) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const portalOrigin = () => (process.env.PORTAL_URL || "https://portal.constructhub.us").replace(/\/+$/, "");
const RECEIPT_STATUSES = ["succeeded", "partially_refunded", "refunded"];

// ── Receipt numbers ─────────────────────────────────────────────────────────

/** The payment's receipt number, allocating R-<next> on first use. Null when the payment isn't this org's. */
export async function ensureReceiptNumber(orgId: string, paymentId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-doc-number:R:${orgId}`}))`);
    const [row] = await tx.select({ n: crmPayments.receiptNumber }).from(crmPayments)
      .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.id, paymentId))).limit(1);
    if (!row) return null;
    if (row.n) return row.n;
    const r: any = await tx.execute(sql`
      select greatest(1000, coalesce(max((substring(receipt_number from '^R-([0-9]{1,15})$'))::bigint), 0)) + 1 as next
        from crm_payments where org_id = ${orgId}`);
    const n = `R-${Number(r.rows?.[0]?.next ?? 1001)}`;
    await tx.update(crmPayments).set({ receiptNumber: n } as any)
      .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.id, paymentId)));
    return n;
  });
}

// ── The receipt ─────────────────────────────────────────────────────────────

export type PaymentReceipt = {
  receiptNumber: string;
  paymentId: string;
  status: string;
  amountCents: number;
  /** A card fee the client paid on top (recorded in the payment's note). */
  feeCents: number;
  method: string;
  /** Check #, reference or memo, as recorded. */
  note: string | null;
  paidAt: string;
  kind: "Deposit" | "Payment" | "Final payment";
  customer: { displayName: string; firstName: string | null; email: string | null; phone: string | null;
    address: string | null };
  company: CompanyBranding;
  contact: { name: string; email: string | null; phone: string | null } | null;
  /** "E-2007 — Siding, Windows" / "INV-1043 — Materials delivered (25%)". */
  forLabel: string;
  estimate: { id: string; number: string | null; title: string; publicToken: string | null } | null;
  invoice: { id: string; number: string | null; title: string; publicToken: string | null; dueNowCents: number } | null;
  contractCents: number;
  paidThroughCents: number;
  balanceAfterCents: number;
  refundedSinceCents: number;
  paidInFull: boolean;
};

/** A card fee passed through rides in the payment's note ("Card processing fee $30.00 paid by the client on top."). */
const feeFromNote = (note?: string | null) => {
  const m = /Card processing fee \$([\d,]+\.\d{2})/.exec(note ?? "");
  return m ? Math.round(parseFloat(m[1].replace(/,/g, "")) * 100) : 0;
};

/** Every payment on a signed estimate's job: taken on the estimate itself or on any of its invoices. */
async function jobPayments(orgId: string, estimateId: string): Promise<{ payments: (Payment & { refundedCents: number })[]; invoices: (typeof crmInvoices.$inferSelect)[] }> {
  const invoices = await db.select().from(crmInvoices)
    .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.estimateId, estimateId)))
    .orderBy(asc(crmInvoices.createdAt));
  const ids = invoices.map((i) => i.id);
  const rows = await db.select().from(crmPayments).where(and(
    eq(crmPayments.orgId, orgId),
    ids.length ? or(eq(crmPayments.estimateId, estimateId), inArray(crmPayments.invoiceId, ids)) : eq(crmPayments.estimateId, estimateId),
  )).orderBy(asc(crmPayments.paidAt), asc(crmPayments.createdAt));
  return { payments: await paymentRefundTotals(orgId, rows), invoices };
}

/** The signed total a job is paid against. */
const contractOf = (est: typeof crmEstimates.$inferSelect) => Math.max(0, est.approvedTotalCents ?? est.totalCents ?? 0);

export async function buildPaymentReceipt(org: Org, pay: Payment): Promise<PaymentReceipt | null> {
  if (!RECEIPT_STATUSES.includes(pay.status) || pay.amountCents <= 0) return null;
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, org.id), eq(crmCustomers.id, pay.customerId))).limit(1);
  if (!cust) return null;
  const [inv] = pay.invoiceId
    ? await db.select().from(crmInvoices).where(and(eq(crmInvoices.orgId, org.id), eq(crmInvoices.id, pay.invoiceId))).limit(1)
    : [undefined];
  const estimateId = pay.estimateId ?? inv?.estimateId ?? null;
  const [est] = estimateId
    ? await db.select().from(crmEstimates).where(and(eq(crmEstimates.orgId, org.id), eq(crmEstimates.id, estimateId))).limit(1)
    : [undefined];

  const division = (est ? await resolveEstimateDivision(est) : inv ? await resolveInvoiceDivision(inv) : null)
    ?? await resolveClientDivision(org.id, cust);
  const company = companyBranding(org, division);
  const contactMember = await divisionContactMember(org.id, division).catch(() => null);
  const contact = contactMember
    ? { name: contactMember.displayName || contactMember.email || company.name, email: contactMember.email ?? null, phone: (contactMember as any).phone ?? null }
    : null;

  let contract: number, ledgerRows: (Payment & { refundedCents: number })[];
  if (est) {
    contract = contractOf(est);
    ledgerRows = (await jobPayments(org.id, est.id)).payments;
  } else if (inv) {
    contract = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
    const rows = await db.select().from(crmPayments)
      .where(and(eq(crmPayments.orgId, org.id), eq(crmPayments.invoiceId, inv.id)));
    ledgerRows = await paymentRefundTotals(org.id, rows);
  } else {
    contract = pay.amountCents;
    ledgerRows = await paymentRefundTotals(org.id, [pay]);
  }
  const after = balanceAfterPayment(contract, ledgerRows, pay.id);
  if (!after) return null;

  const receiptNumber = pay.receiptNumber ?? await ensureReceiptNumber(org.id, pay.id);
  if (!receiptNumber) return null;

  const kind: PaymentReceipt["kind"] = after.balanceAfterCents === 0 ? "Final payment"
    : pay.purpose === "deposit" ? "Deposit" : "Payment";
  const forLabel = inv
    ? `${inv.number ? `${inv.number} — ` : ""}${inv.title}${est?.number ? ` (estimate ${est.number})` : ""}`
    : est ? `${est.number ? `${est.number} — ` : ""}${est.title}` : "Your project";
  const address = [cust.addressLine1, [cust.city, cust.state].filter(Boolean).join(", "), cust.postalCode].filter(Boolean).join(" ").trim() || null;
  return {
    receiptNumber, paymentId: pay.id, status: pay.status,
    amountCents: pay.amountCents, feeCents: feeFromNote(pay.note),
    method: paymentMethodLabel(pay.method), note: pay.note && !/^Card processing fee/.test(pay.note) ? pay.note : null,
    paidAt: (pay.paidAt ?? pay.createdAt ?? new Date()).toISOString(),
    kind,
    customer: { displayName: cust.displayName, firstName: cust.firstName ?? null, email: cust.email, phone: cust.phone, address },
    company, contact, forLabel,
    estimate: est ? { id: est.id, number: est.number, title: est.title, publicToken: est.publicToken } : null,
    invoice: inv ? { id: inv.id, number: inv.number, title: inv.title, publicToken: inv.publicToken, dueNowCents: invoiceDueNowCents(inv) } : null,
    contractCents: contract,
    ...after,
  };
}

const dateLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });

function letterhead(b: CompanyBranding): string {
  const addr = [b.addressLine1, b.addressLine2].filter(Boolean).join(", ");
  const city = [b.city, b.state].filter(Boolean).join(", ") + (b.postalCode ? ` ${b.postalCode}` : "");
  return [
    addr || city.trim() ? esc([addr, city.trim()].filter(Boolean).join(" · ")) : "",
    esc([b.phone, b.email, b.website].filter(Boolean).join(" · ")),
    b.licenseNumber ? `License ${esc(b.licenseNumber)}${b.licenseState ? ` (${esc(b.licenseState)})` : ""}` : "",
  ].filter(Boolean).join("<br>");
}

/** The receipt's rows, shared by the printable page and the email. */
function receiptRows(r: PaymentReceipt): string {
  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;color:#555">${k}</td><td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;${strong ? "font-weight:700;font-size:18px" : ""}">${v}</td></tr>`;
  return [
    row("Receipt number", esc(r.receiptNumber)),
    row("Date", esc(dateLong(r.paidAt))),
    row("Received from", esc(r.customer.displayName)),
    row("For", esc(r.forLabel)),
    row(r.kind === "Deposit" ? "Deposit received" : "Amount received", money(r.amountCents), true),
    r.feeCents > 0 ? row("Card processing fee", money(r.feeCents)) : "",
    r.feeCents > 0 ? row("Total charged", money(r.amountCents + r.feeCents)) : "",
    row("Paid by", esc(r.method) + (r.note ? ` — ${esc(r.note)}` : "")),
    row("Contract total", money(r.contractCents)),
    row("Paid to date", money(r.paidThroughCents)),
    row("Remaining balance", r.paidInFull
      ? `<span style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;padding:4px 10px;border-radius:6px;font-size:13px">PAID IN FULL</span>`
      : money(r.balanceAfterCents)),
    r.refundedSinceCents > 0 ? row("Refunded since", money(r.refundedSinceCents)) : "",
  ].join("");
}

function contactLine(r: PaymentReceipt): string {
  const c = r.contact;
  if (c) return `Questions? Contact ${esc(c.name)}${c.phone ? ` at ${esc(c.phone)}` : ""}${c.email ? ` · ${esc(c.email)}` : ""}${r.company.phone && r.company.phone !== c.phone ? `, or call our office at ${esc(r.company.phone)}` : ""}.`;
  return `Questions? ${r.company.phone ? `Call ${esc(r.company.phone)}` : "Reply to the email this came with"}${r.company.email ? ` or email ${esc(r.company.email)}` : ""}.`;
}

/** The full printable page (Print → Save as PDF). */
export function paymentReceiptPage(r: PaymentReceipt): string {
  const b = r.company;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(r.receiptNumber)} — ${esc(b.name)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;background:#f6f6f6}
  .page{max-width:680px;margin:24px auto;background:#fff;padding:32px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 4px} .muted{color:#666;font-size:13px;line-height:1.5} table{width:100%;border-collapse:collapse;font-size:15px;margin:18px 0}
  .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
  .logo{max-height:56px;max-width:200px} .actions{margin:0 0 16px;display:flex;gap:8px}
  button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.actions{display:none}}
</style></head><body><div class="page">
  <div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="head">
    <div>${b.logoUrl ? `<img class="logo" src="${esc(b.logoUrl)}" alt="${esc(b.name)}"><br>` : ""}<h1>${esc(b.name)}</h1><div class="muted">${letterhead(b)}</div></div>
    <div style="text-align:right"><div style="font-size:20px;font-weight:700">RECEIPT</div><div class="muted">${esc(r.receiptNumber)}</div></div>
  </div>
  ${r.customer.address ? `<p class="muted" style="margin-top:18px"><strong style="color:#111">${esc(r.customer.displayName)}</strong><br>${esc(r.customer.address)}</p>` : ""}
  <table>${receiptRows(r)}</table>
  <p class="muted">Thank you for your business. ${contactLine(r)}</p>
</div></body></html>`;
}

/** Where the client opens this receipt (behind the email gate of the document it belongs to). */
export function clientReceiptUrl(r: PaymentReceipt): string | null {
  if (r.estimate?.publicToken) return `${portalOrigin()}/api/public/estimates/${r.estimate.publicToken}/receipts/${r.paymentId}.html`;
  if (r.invoice?.publicToken) return `${portalOrigin()}/api/public/invoices/${r.invoice.publicToken}/receipts/${r.paymentId}.html`;
  return null;
}

export function paymentReceiptEmail(r: PaymentReceipt): { subject: string; html: string } {
  const b = r.company;
  const link = clientReceiptUrl(r);
  const what = r.kind === "Deposit" ? "deposit" : "payment";
  return {
    subject: `Receipt ${r.receiptNumber} from ${b.name} — ${money(r.amountCents)} ${what}${r.paidInFull ? " · PAID IN FULL" : ""}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;color:#111">
      <h2 style="margin:0 0 2px">${esc(b.name)}</h2>
      <p style="margin:0 0 18px;color:#555;font-size:13px">${letterhead(b)}</p>
      <p style="font-size:16px">Hi ${esc(r.customer.firstName?.trim() || r.customer.displayName)}, thank you — we received your ${what}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">${receiptRows(r)}</table>
      ${link ? `<p style="margin:24px 0"><a href="${link}" style="background:#111827;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">View / print your receipt</a></p>` : ""}
      <p style="margin:18px 0 0;font-size:13px;color:#666">${contactLine(r)}</p>
    </div>`,
  };
}

/**
 * Email (and text, when the org turned text receipts on) the receipt for one
 * payment. `force` is a staff resend: it ignores the automatic-receipt switch
 * but still needs an address. Logs to the client's Activity either way.
 */
export async function sendPaymentReceipt(orgId: string, paymentId: string, opts: { force?: boolean; sms?: boolean; actor?: { memberId: string | null; label: string } } = {}): Promise<{
  receipt: PaymentReceipt | null; emailed: boolean; texted: boolean; to: string | null; skipped?: "receipts_off" | "no_email" | "not_paid";
}> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const [pay] = await db.select().from(crmPayments).where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.id, paymentId))).limit(1);
  if (!org || !pay) return { receipt: null, emailed: false, texted: false, to: null, skipped: "not_paid" };
  const prefs = receiptSettingsOf(org.customFields);
  const wantEmail = opts.force ? true : prefs.email;
  const wantSms = opts.force ? opts.sms === true : prefs.sms;
  if (!wantEmail && !wantSms) return { receipt: null, emailed: false, texted: false, to: null, skipped: "receipts_off" };
  const receipt = await buildPaymentReceipt(org, pay);
  if (!receipt) return { receipt: null, emailed: false, texted: false, to: null, skipped: "not_paid" };

  let emailed = false, texted = false;
  const to = receipt.customer.email;
  if (wantEmail && to) {
    const { subject, html } = paymentReceiptEmail(receipt);
    try {
      await sendWithFallback({ to, subject, html, replyTo: receipt.contact?.email || receipt.company.email || undefined } as any);
      emailed = true;
    } catch (e: any) {
      logError("[crm] payment receipt email failed:", String(e?.message || e).slice(0, 300));
    }
  }
  const phone = normalizePhone(receipt.customer.phone);
  if (wantSms && phone && orgCanTextClients(org.customFields)) {
    const link = clientReceiptUrl(receipt);
    const body = `${receipt.company.name}: receipt ${receipt.receiptNumber} — ${money(receipt.amountCents)} received by ${receipt.method.toLowerCase()} for ${receipt.estimate?.number ?? receipt.invoice?.number ?? "your project"}. ${receipt.paidInFull ? "Paid in full. " : `Balance ${money(receipt.balanceAfterCents)}. `}Thank you!${link ? ` ${link}` : ""}`;
    const r = await sendSms(phone, body.slice(0, 320), org.customFields, org.id).catch(() => ({ ok: false } as { ok: boolean }));
    texted = r.ok === true;
  }
  recordActivity({
    orgId, actorMemberId: opts.actor?.memberId ?? null, actorLabel: opts.actor?.label ?? "System",
    action: "receipt.sent", entityType: "payment", entityId: pay.id, customerId: pay.customerId,
    meta: {
      receiptNumber: receipt.receiptNumber, to: to ?? phone, emailed, texted, resend: !!opts.force,
      number: receipt.estimate?.number ?? receipt.invoice?.number ?? null, paidInFull: receipt.paidInFull,
    },
  });
  return { receipt, emailed, texted, to, skipped: !to && !texted ? "no_email" : undefined };
}

// ── Lists for the documents card and the portal ─────────────────────────────

/** Receipts for payments taken on estimates before any invoice (deposits, pay-in-full). */
export async function receiptsForEstimates(orgId: string, estimates: { id: string; number: string | null; publicToken: string | null }[], audience: "crm" | "portal") {
  if (!estimates.length) return [];
  const byId = new Map(estimates.map((e) => [e.id, e]));
  const rows = await db.select().from(crmPayments).where(and(
    eq(crmPayments.orgId, orgId), inArray(crmPayments.estimateId, estimates.map((e) => e.id)), isNull(crmPayments.invoiceId),
    inArray(crmPayments.status, ["succeeded", "partially_refunded"]), sql`${crmPayments.amountCents} > 0`,
  )).orderBy(desc(crmPayments.paidAt), desc(crmPayments.createdAt));
  return rows.map((p) => {
    const est = byId.get(p.estimateId!)!;
    return {
      paymentId: p.id, receiptNumber: p.receiptNumber ?? null, estimateId: est.id, estimateNumber: est.number,
      invoiceId: null as string | null, invoiceNumber: null as string | null,
      amountCents: p.amountCents, method: p.method, paidAt: p.paidAt ?? p.createdAt, provider: p.provider,
      link: audience === "crm" ? `/api/crm/receipts/${p.id}.html` : `/api/public/estimates/${est.publicToken}/receipts/${p.id}.html`,
    };
  });
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function staffCtx(req: any, res: any, getDevUser: GetUser) {
  const user = getDevUser(req, res);
  if (!user) return null;
  const ctx = await requireOrg(req, res, user.id);
  if (!ctx) return null;
  if (!requirePermission(res, ctx, "seePrices")) return null; // every receipt and balance is an amount
  return ctx;
}

/** A payment this seat may see: its estimate or invoice must be visible under the seat's object policy. */
async function visiblePayment(ctx: any, paymentId: string): Promise<Payment | null> {
  const [pay] = await db.select().from(crmPayments).where(and(eq(crmPayments.orgId, ctx.org.id), eq(crmPayments.id, paymentId))).limit(1);
  if (!pay) return null;
  const policy = objectPolicy(ctx);
  if (pay.invoiceId) return (await policy.visible("invoices", pay.invoiceId)) ? pay : null;
  if (pay.estimateId) return (await policy.visible("estimates", pay.estimateId)) ? pay : null;
  return (await policy.visible("customers", pay.customerId)) ? pay : null;
}

/** Staff: any payment's receipt as a printable page; ?download=1 saves it. */
export async function serveStaffReceipt(ctx: any, req: any, res: any): Promise<void> {
  const pay = await visiblePayment(ctx, String(req.params.id));
  const r = pay && await buildPaymentReceipt(ctx.org, pay);
  if (!r) { res.status(404).json({ message: "Receipt not found" }); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="receipt-${r.receiptNumber}.html"`);
  res.send(paymentReceiptPage(r));
}

export function registerCrmPaymentReceiptRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/crm/payments/:id/receipt.html", async (req: any, res) => {
    const ctx = await staffCtx(req, res, getDevUser);
    if (!ctx) return;
    await serveStaffReceipt(ctx, req, res);
  });

  /** Staff: email (and optionally text) the receipt again. */
  app.post("/api/crm/payments/:id/receipt/send", async (req: any, res) => {
    const ctx = await staffCtx(req, res, getDevUser);
    if (!ctx) return;
    if (!requireAnyPermission(res, ctx, ["takePayment", "manageInvoices"])) return;
    const pay = await visiblePayment(ctx, String(req.params.id));
    if (!pay) return res.status(404).json({ message: "Payment not found" });
    const out = await sendPaymentReceipt(ctx.org.id, pay.id, {
      force: true, sms: req.body?.sms === true,
      actor: { memberId: ctx.member.id, label: ctx.member.displayName || ctx.member.email || "A team member" },
    });
    if (!out.receipt) return res.status(409).json({ message: "This payment hasn't been received, so there's no receipt for it." });
    if (!out.emailed && !out.texted) {
      return res.status(out.to ? 502 : 400).json({ message: out.to ? "The receipt email didn't go out — try again in a minute." : "This client has no email address on file. Add one first." });
    }
    res.json({ receiptNumber: out.receipt.receiptNumber, to: out.to, emailed: out.emailed, texted: out.texted });
  });

  /** The client: a deposit / pay-in-full receipt from the estimate page or portal, behind the estimate's email gate. */
  app.get("/api/public/estimates/:token/receipts/:paymentId.html", async (req: any, res) => {
    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, String(req.params.token))).limit(1);
    if (!est) return res.status(404).send("Not found");
    if (!(await requireDocSession(req, res, est.customerId))) return;
    const [pay] = await db.select().from(crmPayments)
      .where(and(eq(crmPayments.orgId, est.orgId), eq(crmPayments.id, String(req.params.paymentId)))).limit(1);
    let mine = !!pay && pay.estimateId === est.id;
    if (pay && !mine && pay.invoiceId) {
      const [inv] = await db.select({ estimateId: crmInvoices.estimateId }).from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, est.orgId), eq(crmInvoices.id, pay.invoiceId))).limit(1);
      mine = inv?.estimateId === est.id;
    }
    if (!pay || !mine) return res.status(404).send("Not found");
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
    const r = org && await buildPaymentReceipt(org, pay);
    if (!r) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(paymentReceiptPage(r));
  });

  /**
   * The estimate's balance card: contract, received, requested, left — the
   * payment requests (invoices) on it, every payment with its receipt, and
   * what a new request may still bill.
   */
  app.get("/api/crm/estimates/:id/ledger", async (req: any, res) => {
    const ctx = await staffCtx(req, res, getDevUser);
    if (!ctx) return;
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, String(req.params.id)))).limit(1);
    if (!est || !(await objectPolicy(ctx).visible("estimates", est.id))) return res.status(404).json({ message: "Estimate not found" });
    const [cust] = await db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, est.customerId))).limit(1);
    const { payments, invoices } = await jobPayments(ctx.org.id, est.id);
    const live = invoices.filter((i) => !i.voidedAt);
    const contract = contractOf(est);
    const ledger = estimateLedger(contract, payments, live);
    // Progress billing is tracked in basis points of the signed total (ops.ts estimateBilledBps): the share each
    // live invoice bills, so "the rest" is exactly what the server will still allow.
    const billedBps = live.reduce((sum, inv) => {
      const recorded = Number((inv.customFields as Record<string, unknown> | null)?.progressBps);
      if (Number.isInteger(recorded) && recorded > 0 && recorded <= 10000) return sum + recorded;
      return sum + (contract > 0 ? Math.round((inv.totalCents * 10000) / contract) : 10000);
    }, 0);
    res.json({
      estimate: { id: est.id, number: est.number, title: est.title, depositCents: est.depositCents ?? null,
        approvedAt: est.approvedAt, taxRateBps: est.taxRateBps ?? 0 },
      customer: cust ? { id: cust.id, displayName: cust.displayName, email: cust.email, phone: cust.phone } : null,
      ledger,
      billedBps: Math.min(10000, billedBps),
      remainingBps: Math.max(0, 10000 - billedBps),
      requests: live.map((i) => ({
        id: i.id, number: i.number, title: i.title, status: i.status, totalCents: i.totalCents,
        paidCents: i.paidCents ?? 0, dueNowCents: invoiceDueNowCents(i), dueAt: i.dueAt, sentAt: i.sentAt,
        sentToEmail: (i as any).sentToEmail ?? null, clientLink: `/i/${i.publicToken}`,
      })),
      payments: payments
        .filter((p) => (LEDGER_PAID_STATUSES as readonly string[]).includes(p.status) || p.status === "processing")
        .map((p) => ({
          id: p.id, receiptNumber: p.receiptNumber ?? null, amountCents: p.amountCents, refundedCents: p.refundedCents,
          method: paymentMethodLabel(p.method), provider: p.provider, note: p.note, status: p.status, purpose: p.purpose,
          paidAt: p.paidAt ?? p.createdAt, invoiceId: p.invoiceId,
          invoiceNumber: live.find((i) => i.id === p.invoiceId)?.number ?? null,
          receiptUrl: RECEIPT_STATUSES.includes(p.status) && p.amountCents > 0 ? `/api/crm/payments/${p.id}/receipt.html` : null,
        })),
      uninvoicedDeposits: payments
        .filter((p) => !p.invoiceId && (p.status === "succeeded" || p.status === "partially_refunded"))
        .map((p) => ({ id: p.id, amountCents: p.amountCents, refundedCents: p.refundedCents, status: p.status, paidAt: p.paidAt ?? p.createdAt })),
      offlineInstructions: offlinePaymentInstructionsFor(ctx.org.customFields, (await resolveEstimateDivision(est))?.customFields),
      sms: orgCanTextClients(ctx.org.customFields),
    });
  });
}
