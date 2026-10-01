/**
 * The account billing ledger — what the Stripe webhook keeps locally so
 * Billing → Invoices / Purchases and the receipt emails never have to call
 * Stripe for a page view:
 *
 *   billing_events     one row per Stripe event id we processed (idempotency)
 *   billing_invoices   one row per Stripe invoice (in_…), newest first
 *   billing_purchases  one row per one-time checkout (pi_… / cs_…)
 *
 * Plain SQL on the shared pool (not drizzle), like the other add-on modules.
 * The tables are created idempotently (CREATE TABLE IF NOT EXISTS) at boot via
 * server/billing/schema.ts; the account foundation's ensureAccountSchema()
 * creates the same shapes — both orders are no-ops. Every INSERT names its
 * columns, so whichever DDL won, the rows are complete.
 *
 * Nothing here is ever guessed: every value comes from the Stripe object the
 * webhook verified (or the backfill fetched with the account's own customer
 * id); an absent value is stored as NULL.
 */
import { pool } from "../db";

export { BILLING_LEDGER_DDL, ensureBillingLedgerSchema } from "./schema";

export type BillingInvoiceRow = {
  /** Stripe invoice id (in_…). */
  id: string;
  userId: number;
  number: string | null;
  status: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  created: Date;
};

export type PurchaseKind = "course" | "service" | "reinstatement" | "other";

export type BillingPurchaseRow = {
  /** Stripe PaymentIntent id (pi_…) when the checkout has one, else the Checkout Session id (cs_…). */
  id: string;
  userId: number;
  kind: PurchaseKind;
  description: string;
  amount: number;
  currency: string;
  created: Date;
  receiptUrl: string | null;
};

/**
 * Claim a Stripe event for processing. True the first time an event id is
 * seen; false when it was already processed (Stripe retries, double
 * deliveries), in which case the webhook answers 200 and does nothing.
 * `userId` is usually unknown at claim time — attributeBillingEvent fills it
 * in once the handler resolved the account.
 */
export type BillingEventRef = { id: string; type?: string | null; userId?: number | null };

export async function recordBillingEvent(event: BillingEventRef, userId: number | null = null): Promise<boolean> {
  if (!event?.id || typeof event.id !== "string") throw new Error("recordBillingEvent: event.id is required");
  const owner = Number.isInteger(userId) ? userId : Number.isInteger(event.userId) ? event.userId! : null;
  const { rows } = await pool.query(
    `INSERT INTO billing_events(stripe_event_id, type, user_id, received_at) VALUES($1, $2, $3, now())
       ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id`,
    [event.id, event.type ?? null, owner]);
  return rows.length > 0;
}

/** Processing failed after the claim: forget the event so Stripe's retry is processed, not skipped. */
export async function releaseBillingEvent(eventId: string): Promise<void> {
  await pool.query(`DELETE FROM billing_events WHERE stripe_event_id = $1`, [eventId]);
}

/** Record which account an already-claimed event belonged to (first attribution wins). */
export async function attributeBillingEvent(eventId: string, userId: number): Promise<void> {
  await pool.query(`UPDATE billing_events SET user_id = $2 WHERE stripe_event_id = $1 AND user_id IS NULL`, [eventId, userId]);
}

export async function billingEventSeen(eventId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM billing_events WHERE stripe_event_id = $1`, [eventId]);
  return rows.length > 0;
}

/** Invoice statuses Stripe never leaves again: an `open` snapshot arriving later is stale, not a change. */
const SETTLED_INVOICE_STATUSES = ["paid", "void"];

/**
 * Insert or refresh an invoice row (Stripe sends finalized → paid for the
 * same id). Stripe does not guarantee delivery order, so an `invoice.finalized`
 * (status open, amount_paid 0) that lands after `invoice.paid` must not turn
 * the paid row back into an unpaid one: a settled row keeps its values when
 * the incoming snapshot is still draft/open. Returns false in exactly that
 * case (the snapshot was stale and nothing was written), true when the row
 * was inserted or refreshed.
 */
export async function upsertInvoice(row: BillingInvoiceRow): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO billing_invoices(id, user_id, number, status, amount_paid, amount_due, currency, period_start, period_end,
                                  description, hosted_invoice_url, invoice_pdf, created)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         user_id = COALESCE(EXCLUDED.user_id, billing_invoices.user_id),
         number = EXCLUDED.number, status = EXCLUDED.status, amount_paid = EXCLUDED.amount_paid,
         amount_due = EXCLUDED.amount_due, currency = EXCLUDED.currency, period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end, description = EXCLUDED.description,
         hosted_invoice_url = EXCLUDED.hosted_invoice_url, invoice_pdf = EXCLUDED.invoice_pdf, created = EXCLUDED.created
       WHERE NOT (billing_invoices.status = ANY($14) AND EXCLUDED.status IN ('draft', 'open'))
       RETURNING id`,
    [row.id, row.userId, row.number, row.status, row.amountPaid, row.amountDue, row.currency, row.periodStart, row.periodEnd,
      row.description, row.hostedInvoiceUrl, row.invoicePdf, row.created, SETTLED_INVOICE_STATUSES]);
  return rows.length > 0;
}

/** Insert or refresh a one-time purchase (a late receipt URL updates the row). */
export async function upsertPurchase(row: BillingPurchaseRow): Promise<void> {
  await pool.query(
    `INSERT INTO billing_purchases(id, user_id, kind, description, amount, currency, created, receipt_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         user_id = COALESCE(EXCLUDED.user_id, billing_purchases.user_id),
         kind = EXCLUDED.kind, description = EXCLUDED.description, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
         created = EXCLUDED.created, receipt_url = COALESCE(EXCLUDED.receipt_url, billing_purchases.receipt_url)`,
    [row.id, row.userId, row.kind, row.description, row.amount, row.currency, row.created, row.receiptUrl]);
}

const invoiceRow = (r: any): BillingInvoiceRow => ({
  id: r.id, userId: r.user_id, number: r.number ?? null, status: r.status ?? null,
  amountPaid: r.amount_paid ?? 0, amountDue: r.amount_due ?? 0, currency: r.currency ?? "usd",
  periodStart: r.period_start ? new Date(r.period_start) : null, periodEnd: r.period_end ? new Date(r.period_end) : null,
  description: r.description ?? null, hostedInvoiceUrl: r.hosted_invoice_url ?? null, invoicePdf: r.invoice_pdf ?? null,
  created: new Date(r.created),
});

const purchaseRow = (r: any): BillingPurchaseRow => ({
  id: r.id, userId: r.user_id, kind: r.kind ?? "other", description: r.description ?? "", amount: r.amount ?? 0,
  currency: r.currency ?? "usd", created: new Date(r.created), receiptUrl: r.receipt_url ?? null,
});

export async function countLocalInvoices(userId: number): Promise<number> {
  const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM billing_invoices WHERE user_id = $1`, [userId]);
  return r?.n ?? 0;
}

/**
 * The account's invoices, newest first, keyset-paged the way Stripe pages
 * (`startingAfter` = the last id of the previous page). Reads one row more
 * than `limit` to report hasMore without a count.
 */
export async function listLocalInvoices(userId: number, opts: { limit?: number; startingAfter?: string | null } = {}): Promise<{ invoices: BillingInvoiceRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  const values: unknown[] = [userId, limit + 1];
  let after = "";
  if (opts.startingAfter) {
    values.push(opts.startingAfter);
    after = `AND (created, id) < (SELECT created, id FROM billing_invoices WHERE id = $3 AND user_id = $1)`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM billing_invoices WHERE user_id = $1 ${after} ORDER BY created DESC, id DESC LIMIT $2`, values);
  return { invoices: rows.slice(0, limit).map(invoiceRow), hasMore: rows.length > limit };
}

export async function listLocalPurchases(userId: number, limit = 100): Promise<BillingPurchaseRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM billing_purchases WHERE user_id = $1 ORDER BY created DESC, id DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 100, 1), 500)]);
  return rows.map(purchaseRow);
}

export async function getLocalInvoice(userId: number, invoiceId: string): Promise<BillingInvoiceRow | null> {
  const { rows: [r] } = await pool.query(`SELECT * FROM billing_invoices WHERE user_id = $1 AND id = $2`, [userId, invoiceId]);
  return r ? invoiceRow(r) : null;
}
