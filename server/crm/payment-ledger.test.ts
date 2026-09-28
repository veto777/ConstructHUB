import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { reconcileStripeEvent, recordCheckoutPayment } from "./payment-ledger";
import { ensurePaymentLedgerSchema } from "./payment-ledger-schema";
import type Stripe from "stripe";

const org = randomUUID(), customer = randomUUID(), invoice = randomUUID();
const account = `acct_${randomUUID()}`, session = `cs_${randomUUID()}`, intent = `pi_${randomUUID()}`, charge = `ch_${randomUUID()}`;
const list = vi.fn();
const retrieve = vi.fn().mockResolvedValue({ latest_charge: { id: charge } });
const stripe = { checkout: { sessions: { list } }, paymentIntents: { retrieve } } as unknown as Stripe;
function event(type: string, object: any, id = `evt_${randomUUID()}`): Stripe.Event {
  return { id, type, account, data: { object: { ...object, metadata: { orgId: org } } } } as Stripe.Event;
}
const completed = (paid: boolean, id?: string) => event("checkout.session.completed", { id: session, payment_intent: intent, payment_status: paid ? "paid" : "unpaid" }, id);
const success = (id?: string) => event("payment_intent.succeeded", { id: intent, latest_charge: charge }, id);
async function snapshot() {
  const { rows: [payment] } = await pool.query('select * from crm_payments where org_id=$1',[org]);
  const { rows: [inv] } = await pool.query('select * from crm_invoices where id=$1',[invoice]);
  const { rows: events } = await pool.query('select * from crm_stripe_events where org_id=$1',[org]);
  return { payment, inv, events };
}
beforeAll(async () => {
  await ensurePaymentLedgerSchema();
  await pool.query(`insert into crm_orgs(id,name,owner_user_id) values($1,'Ledger fixture',1)`,[org]);
  await pool.query(`insert into crm_customers(id,org_id,display_name,portal_token) values($1,$2,'Ledger client',gen_random_uuid())`,[customer,org]);
  await pool.query(`insert into crm_invoices(id,org_id,customer_id,public_token,total_cents,status) values($1,$2,$3,gen_random_uuid(),1000,'sent')`,[invoice,org,customer]);
});
beforeEach(async () => {
  await pool.query('delete from crm_stripe_events where org_id=$1',[org]);
  await pool.query('delete from crm_payments where org_id=$1',[org]);
  await pool.query("update crm_invoices set paid_cents=0,status='sent',paid_at=null where id=$1",[invoice]);
  await recordCheckoutPayment({ orgId: org, customerId: customer, invoiceId: invoice, amountCents: 1000 }, { id: session, payment_intent: null } as Stripe.Checkout.Session, account);
  list.mockReset().mockResolvedValue({ data: [{ id: session }] });
});
afterAll(async () => {
  for (const table of ['crm_payment_accounts','crm_stripe_events','crm_payments','crm_invoices','crm_customers']) await pool.query(`delete from ${table} where org_id=$1`,[org]);
  await pool.query('delete from crm_orgs where id=$1',[org]);
  await pool.end();
});

describe('Stripe settlement — mocked provider, real Postgres transactions', () => {
  it('settles delayed ACH by Checkout ID without losing the session identifier', async () => {
    await reconcileStripeEvent(completed(false), stripe);
    expect((await snapshot()).payment.status).toBe('processing');
    await reconcileStripeEvent(event('checkout.session.async_payment_succeeded', { id: session, payment_intent: intent, payment_status: 'paid' }), stripe);
    const { payment, inv } = await snapshot();
    expect(payment.status).toBe('succeeded');
    expect(payment.checkout_session_id).toBe(session);
    expect(payment.payment_intent_id).toBe(intent);
    expect(payment.external_id).toBe(session);
    expect(inv.paid_cents).toBe(1000);
  });
  it('handles intent-first delivery and stale completed/failed/expired events', async () => {
    await reconcileStripeEvent(success(), stripe);
    expect(list).toHaveBeenCalledWith({ payment_intent: intent, limit: 2 }, { stripeAccount: account });
    await reconcileStripeEvent(completed(false), stripe);
    await reconcileStripeEvent(event('checkout.session.expired',{ id: session }), stripe);
    await reconcileStripeEvent(event('payment_intent.payment_failed',{ id: intent }), stripe);
    const { payment, inv } = await snapshot();
    expect(payment.charge_id).toBe(charge);
    expect(payment.status).toBe('succeeded');
    expect(inv.paid_cents).toBe(1000);
  });
  it('credits once for duplicate IDs, different success event IDs and concurrent delivery', async () => {
    const e = completed(true);
    await Promise.all([e,e,success(),completed(true)].map(e => reconcileStripeEvent(e,stripe)));
    const { inv, events } = await snapshot();
    expect(inv.paid_cents).toBe(1000);
    expect(events).toHaveLength(3);
  });
  it('serializes two different payments crediting the same invoice', async () => {
    const secondSession = `cs_${randomUUID()}`, secondIntent = `pi_${randomUUID()}`;
    await pool.query('update crm_payments set amount_cents=600 where org_id=$1',[org]);
    await recordCheckoutPayment({ orgId: org, customerId: customer, invoiceId: invoice, amountCents: 400 },
      { id: secondSession, payment_intent: secondIntent } as Stripe.Checkout.Session, account);
    await Promise.all([
      reconcileStripeEvent(completed(true), stripe),
      reconcileStripeEvent(event('payment_intent.succeeded', { id: secondIntent, latest_charge: `ch_${randomUUID()}` }), stripe),
    ]);
    expect((await snapshot()).inv.paid_cents).toBe(1000);
  });
  it('rolls back status and event claim when the invoice step crashes; retry credits once', async () => {
    const name = `crm_fault_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'simulated invoice write crash'; end $$`);
    await pool.query(`create trigger ${name} before update on crm_invoices for each row when (old.id='${invoice}') execute function ${name}()`);
    const e = completed(true);
    try {
      await expect(reconcileStripeEvent(e,stripe)).rejects.toThrow('simulated invoice write crash');
      const { payment, inv, events } = await snapshot();
      expect(payment.status).toBe('pending');
      expect(payment.settled_cents).toBe(0);
      expect(inv.paid_cents).toBe(0);
      expect(events).toHaveLength(0);
    } finally {
      await pool.query(`drop trigger if exists ${name} on crm_invoices`);
      await pool.query(`drop function if exists ${name}()`);
    }
    await reconcileStripeEvent(e,stripe);
    await reconcileStripeEvent(e,stripe);
    expect((await snapshot()).inv.paid_cents).toBe(1000);
  });
  it('does not cross connected-account boundaries', async () => {
    const e = completed(true); e.account = 'acct_foreign';
    await expect(reconcileStripeEvent(e,stripe)).rejects.toThrow();
    expect((await snapshot()).inv.paid_cents).toBe(0);
  });
  it('requests retry when a CRM event precedes recording its checkout', async () => {
    await pool.query('delete from crm_payments where org_id=$1',[org]);
    await expect(reconcileStripeEvent(completed(true),stripe)).rejects.toThrow('not recorded yet');
    expect((await snapshot()).events).toHaveLength(0);
  });
  it('backfills legacy identifiers by prefix without replacing them on repeated ensure', async () => {
    await pool.query(`update crm_payments set external_id=$2,checkout_session_id=null,payment_intent_id=null where org_id=$1`,[org,intent]);
    await ensurePaymentLedgerSchema();
    await ensurePaymentLedgerSchema();
    const { payment } = await snapshot();
    expect(payment.payment_intent_id).toBe(intent);
    expect(payment.checkout_session_id).toBeNull();
  });  it('does not guess the connected account for ambiguous legacy history', async () => {
    await pool.query(`insert into crm_payment_accounts(org_id,provider,external_account_id) values($1,'stripe',$2),($1,'stripe',$3)`,[org,account,'acct_prior']);
    try {
      await pool.query('update crm_payments set stripe_account_id=null where org_id=$1',[org]);
      await ensurePaymentLedgerSchema();
      expect((await snapshot()).payment.stripe_account_id).toBeNull();
    } finally { await pool.query('delete from crm_payment_accounts where org_id=$1',[org]); }
  });

});
