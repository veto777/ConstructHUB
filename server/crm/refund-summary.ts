import { pool } from "../db";

/** Include refund totals without changing the shared schema outside this lane. */
export async function invoiceRefundTotals<T extends { id: string }>(orgId: string, invoices: T[]): Promise<(T & { refundedCents: number })[]> {
  if (!invoices.length) return [];
  const { rows } = await pool.query(`select invoice_id, sum(invoice_credit_cents)::int as cents from crm_payment_refunds
    where org_id=$1 and invoice_id=any($2::varchar[]) group by invoice_id`, [orgId, invoices.map(i => i.id)]);
  const amounts = new Map(rows.map(r => [r.invoice_id, r.cents]));
  return invoices.map(i => ({ ...i, refundedCents: amounts.get(i.id) ?? 0 }));
}

export async function paymentRefundTotals<T extends { id: string }>(orgId: string, payments: T[]): Promise<(T & { refundedCents: number })[]> {
  if (!payments.length) return [];
  const { rows } = await pool.query(`select payment_id, sum(amount_cents)::int as cents from crm_payment_refunds
    where org_id=$1 and payment_id=any($2::varchar[]) group by payment_id`, [orgId, payments.map(p => p.id)]);
  const amounts = new Map(rows.map(r => [r.payment_id, r.cents]));
  return payments.map(p => ({ ...p, refundedCents: amounts.get(p.id) ?? 0 }));
}

export async function invoiceRefundRows(orgId: string, invoiceId: string) {
  const { rows } = await pool.query(`select id, amount_cents, invoice_credit_cents, created_at from crm_payment_refunds
    where org_id=$1 and invoice_id=$2 order by created_at,id`, [orgId,invoiceId]);
  return rows.map(r => ({ id: r.id as string, amountCents: r.amount_cents as number,
    invoiceCreditCents: r.invoice_credit_cents as number, createdAt: r.created_at as Date }));
}
