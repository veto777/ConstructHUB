/**
 * The money on one signed estimate, in one place: what the contract is for,
 * what has been paid (deposits taken on the estimate and payments on its
 * invoices), what has been requested and is still open, and what is left.
 * The CRM's balance card, the payment-request dialog and the receipts all
 * read these numbers, so they never disagree. Integer cents throughout.
 */

/** Payment states that count as money received (net of refunds). */
export const LEDGER_PAID_STATUSES = ["succeeded", "partially_refunded", "refunded"] as const;

export type LedgerPayment = {
  id: string;
  amountCents: number;
  refundedCents?: number | null;
  status: string;
  invoiceId?: string | null;
  paidAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type LedgerInvoice = {
  id: string;
  totalCents: number;
  retainageCents?: number | null;
  paidCents?: number | null;
  voidedAt?: Date | string | null;
};

export type EstimateLedger = {
  /** The signed total (tax included). */
  contractCents: number;
  /** Received so far, net of refunds. */
  paidCents: number;
  refundedCents: number;
  /** Payments that are still settling (bank transfers take days). */
  processingCents: number;
  /** Everything billed on live payment requests (invoices). */
  billedCents: number;
  /** What the open requests still ask for right now. */
  openRequestsCents: number;
  /** What a new payment request may still bill. */
  remainingToBillCents: number;
  /** Contract less what has been received. */
  balanceCents: number;
  paidInFull: boolean;
};

const ms = (d?: Date | string | null) => (d ? new Date(d).getTime() : 0);
const net = (p: LedgerPayment) => Math.max(0, p.amountCents - Math.max(0, p.refundedCents ?? 0));
const isPaid = (p: LedgerPayment) => (LEDGER_PAID_STATUSES as readonly string[]).includes(p.status);

/** What an invoice asks for right now (retainage stays withheld). */
export function invoiceDueNowCents(inv: LedgerInvoice): number {
  return Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
}

export function estimateLedger(contractCents: number, payments: LedgerPayment[], invoices: LedgerInvoice[]): EstimateLedger {
  const contract = Math.max(0, Math.round(contractCents) || 0);
  const live = invoices.filter((i) => !i.voidedAt);
  const seen = new Set<string>();
  let paid = 0, refunded = 0, processing = 0;
  for (const p of payments) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (isPaid(p)) { paid += net(p); refunded += Math.max(0, p.refundedCents ?? 0); }
    else if (p.status === "processing") processing += Math.max(0, p.amountCents);
  }
  const billed = live.reduce((s, i) => s + Math.max(0, i.totalCents), 0);
  const open = live.reduce((s, i) => s + invoiceDueNowCents(i), 0);
  const balance = Math.max(0, contract - paid);
  return {
    contractCents: contract,
    paidCents: paid,
    refundedCents: refunded,
    processingCents: processing,
    billedCents: billed,
    openRequestsCents: open,
    remainingToBillCents: Math.max(0, contract - billed),
    balanceCents: balance,
    paidInFull: contract > 0 && balance === 0,
  };
}

/**
 * Deposits taken on the estimate before any invoice existed are credited to
 * the next invoice: oldest first, whole payments only, never past what that
 * invoice asks for (the same rule as POST /api/crm/estimates/:id/invoice).
 * Returns the credit a new request of `dueNowCents` would receive.
 */
export function depositCreditFor(uninvoicedDeposits: LedgerPayment[], dueNowCents: number): number {
  let credited = 0;
  const ordered = [...uninvoicedDeposits]
    .filter((p) => !p.invoiceId && (p.status === "succeeded" || p.status === "partially_refunded"))
    .sort((a, b) => ms(a.paidAt ?? a.createdAt) - ms(b.paidAt ?? b.createdAt));
  for (const p of ordered) {
    const n = net(p);
    if (n <= 0 || credited + n > dueNowCents) continue;
    credited += n;
  }
  return credited;
}

/**
 * Where one payment leaves the job, for its receipt: paid to date through this
 * payment (in date order, ties by id), the balance after it, and whether money
 * has gone back since — a receipt never stamps PAID IN FULL on a job a later
 * refund reopened.
 */
export function balanceAfterPayment(contractCents: number, payments: LedgerPayment[], paymentId: string): {
  paidThroughCents: number; balanceAfterCents: number; refundedSinceCents: number; paidInFull: boolean;
} | null {
  const paid = payments.filter(isPaid)
    .sort((a, b) => (ms(a.paidAt ?? a.createdAt) - ms(b.paidAt ?? b.createdAt)) || a.id.localeCompare(b.id));
  const idx = paid.findIndex((p) => p.id === paymentId);
  if (idx < 0) return null;
  const paidThrough = paid.slice(0, idx + 1).reduce((s, p) => s + Math.max(0, p.amountCents), 0);
  const refundedSince = paid.reduce((s, p) => s + Math.max(0, p.refundedCents ?? 0), 0);
  const balanceAfter = Math.max(0, Math.max(0, contractCents) - paidThrough);
  return {
    paidThroughCents: paidThrough,
    balanceAfterCents: balanceAfter,
    refundedSinceCents: refundedSince,
    paidInFull: contractCents > 0 && balanceAfter === 0 && refundedSince === 0,
  };
}
