/** Durable provider IDs and transactionally applied Stripe events. Kept in the
 * CRM lane; schema-ensure owns the additive SQL migration. */
import type Stripe from "stripe";
import { pool } from "../db";

export async function recordCheckoutPayment(values: Record<string, any>, session: Stripe.Checkout.Session, account: string) {
  const mapping: Record<string, string> = {
    orgId: "org_id", customerId: "customer_id", invoiceId: "invoice_id", estimateId: "estimate_id",
    projectId: "project_id", purpose: "purpose", amountCents: "amount_cents", currency: "currency",
    method: "method", applicationFeeCents: "application_fee_cents", note: "note",
  };
  const entries = Object.entries(mapping).filter(([key]) => values[key] !== undefined);
  const columns = entries.map(([, col]) => col);
  const params = entries.map(([key]) => values[key]);
  columns.push("provider", "status", "external_id", "checkout_session_id", "payment_intent_id", "stripe_account_id");
  params.push("stripe", "pending", session.id, session.id, stripeId(session.payment_intent), account);
  await pool.query(`insert into crm_payments (${columns.join(',')}) values (${params.map((_, i) => `$${i + 1}`).join(',')})`, params);
}

const supported = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired",
  "payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded",
]);
function stripeId(value: any): string | null { return typeof value === "string" ? value : value?.id ?? null; }

export type SettlementResult = { paymentId: string; orgId: string; invoiceId: string | null; paymentIntentId: string | null; newlySettled: boolean; invoicePaid: boolean; status: string; refundDelta: number } | null;

export async function reconcileStripeEvent(event: Stripe.Event, stripe: Stripe): Promise<SettlementResult> {
  if (!supported.has(event.type)) return null;
  if (!event.id || !event.account) throw new Error("Connected event ID and account are required");
  const object = event.data.object as any;
  const isRefund = event.type === "charge.refunded";
  if (isRefund && (!Number.isSafeInteger(object.amount_refunded) || object.amount_refunded < 0 || !object.id)) throw new Error("Invalid cumulative refund amount");
  const isSession = event.type.startsWith("checkout.session.");
  let sessionId = isSession ? object.id : null;
  const intentId = isSession || isRefund ? stripeId(object.payment_intent) : object.id;
  let chargeId = isRefund ? object.id : isSession ? null : stripeId(object.latest_charge);
  const succeeded = event.type === "payment_intent.succeeded" || event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && object.payment_status === "paid");
  const find = async () => (await pool.query(`select id from crm_payments where provider='stripe'
    and stripe_account_id=$1 and (checkout_session_id=$2 or payment_intent_id=$3 or charge_id=$4
      or external_id=any($5::text[]))`, [event.account, sessionId, intentId, chargeId, [sessionId, intentId, chargeId].filter(Boolean)])).rows;
  let matches = await find();
  let crmMetadata = object.metadata?.orgId;
  // An intent may arrive before checkout.completed supplies the PI ID. Resolve
  // its Checkout session on the *event's connected account*, never by invoice
  // metadata alone (multiple sessions can refer to the same invoice).
  if (!matches.length && intentId && !sessionId) {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: intentId, limit: 2 }, { stripeAccount: event.account });
    if (sessions.data.length > 1) throw new Error("Ambiguous Checkout sessions for intent");
    if (sessions.data.length === 1) { sessionId = sessions.data[0].id; crmMetadata ||= sessions.data[0].metadata?.orgId; matches = await find(); }
  }
  if (!matches.length) {
    if (crmMetadata) throw new Error("CRM payment not recorded yet; retry event");
    return null; // An unrelated direct charge on this connected account.
  }
  if (matches.length !== 1) throw new Error("Ambiguous Stripe payment identifiers");
  if (isSession && succeeded && intentId) {
    const pi = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: event.account });
    chargeId = stripeId(pi.latest_charge);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [pay] } = await client.query(`select * from crm_payments where id=$1 and stripe_account_id=$2 for update`, [matches[0].id, event.account]);
    if (!pay) throw new Error("Payment disappeared before reconciliation");
    if (pay.status === "refunded" && pay.settled_cents === 0) throw new Error("Legacy refunded payment requires balance reconciliation");
    for (const [column, value] of [["checkout_session_id", sessionId], ["payment_intent_id", intentId], ["charge_id", chargeId]]) {
      if (value && pay[column!] && pay[column!] !== value) throw new Error("Conflicting Stripe payment identifier");
    }
    const claimed = await client.query(`insert into crm_stripe_events(account_id,event_id,org_id,payment_id,event_type)
      values($1,$2,$3,$4,$5) on conflict(account_id,event_id) do nothing returning event_id`, [event.account,event.id,pay.org_id,pay.id,event.type]);
    if (!claimed.rowCount) { await client.query("COMMIT"); return null; }
    // A refunded charge proves capture even if its success event has not arrived.
    const newlySettled = (succeeded || isRefund) && pay.settled_cents === 0;
    const settledCents = newlySettled ? pay.amount_cents : pay.settled_cents;
    const refundedCents = Math.max(pay.refunded_cents, isRefund ? object.amount_refunded : 0);
    const refundDelta = refundedCents - pay.refunded_cents;
    const principalRefundDelta = Math.min(refundedCents, pay.amount_cents) - Math.min(pay.refunded_cents, pay.amount_cents);
    const creditDelta = Math.max(0, settledCents - refundedCents) - Math.max(0, pay.settled_cents - pay.refunded_cents);
    if (refundDelta > 0) {
      await client.query(`insert into crm_payment_refunds(org_id,payment_id,invoice_id,account_id,event_id,charge_id,amount_cents,invoice_credit_cents,cumulative_refunded_cents)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pay.org_id,pay.id,pay.invoice_id,event.account,event.id,chargeId,refundDelta,principalRefundDelta,refundedCents]);
    }
    const status = refundedCents >= pay.amount_cents && settledCents > 0 ? "refunded"
      : refundedCents > 0 ? "partially_refunded"
      : settledCents > 0 ? "succeeded"
      : event.type.endsWith("expired") ? "canceled"
      : event.type.endsWith("failed") ? "failed"
      : ["failed", "canceled"].includes(pay.status) ? pay.status : "processing";
    await client.query(`update crm_payments set checkout_session_id=coalesce(checkout_session_id,$2),
      payment_intent_id=coalesce(payment_intent_id,$3), charge_id=coalesce(charge_id,$4),
      status=$5, settled_cents=$6, paid_at=case when $6>0 then coalesce(paid_at,now()) else paid_at end,
      failure_reason=$7, refunded_cents=$8, updated_at=now() where id=$1`,
      [pay.id,sessionId,intentId,chargeId,status,settledCents,
        status === "failed" ? object.last_payment_error?.message ?? null : null, refundedCents]);
    let invoicePaid = false;
    if ((creditDelta !== 0 || isRefund) && pay.invoice_id) {
      const { rows: [inv] } = await client.query(`select * from crm_invoices where id=$1 and org_id=$2 for update`, [pay.invoice_id,pay.org_id]);
      if (!inv) throw new Error("Settlement invoice not found");
      const paid = inv.paid_cents + creditDelta;
      if (paid < 0) throw new Error("Invoice balance inconsistent with payment ledger");
      const due = Math.max(0, inv.total_cents - inv.retainage_cents);
      invoicePaid = paid >= due;
      await client.query(`update crm_invoices set paid_cents=$2, status=$3,
        paid_at=case when $3='paid' then coalesce(paid_at,now()) else null end, updated_at=now() where id=$1`,
        [inv.id,paid,inv.voided_at ? "void" : paid >= due ? "paid" : paid > 0 ? "partial" : "sent"]);
    }
    if (newlySettled && pay.estimate_id) {
      await client.query(`insert into crm_estimate_events(org_id,estimate_id,type,actor,meta) values($1,$2,'paid','client',$3::jsonb)`,
        [pay.org_id,pay.estimate_id,JSON.stringify({ amountCents: pay.amount_cents, method: pay.method })]);
    }
    await client.query("COMMIT");
    return { paymentId: pay.id, orgId: pay.org_id, invoiceId: pay.invoice_id, paymentIntentId: intentId ?? pay.payment_intent_id, newlySettled: newlySettled && !isRefund, invoicePaid, status, refundDelta };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
