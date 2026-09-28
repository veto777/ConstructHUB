import { pool } from "../db";

/** Additive and repeatable: existing IDs are copied only by an unambiguous
 * Stripe prefix. An account is backfilled only if the org has used one
 * distinct Stripe account; ambiguous history is deliberately left unbound. */
export async function ensurePaymentLedgerSchema() {
  await pool.query(`
    alter table crm_payments add column if not exists checkout_session_id text;
    alter table crm_payments add column if not exists payment_intent_id text;
    alter table crm_payments add column if not exists charge_id text;
    alter table crm_payments add column if not exists stripe_account_id text;
    alter table crm_payments add column if not exists settled_cents integer not null default 0;
    alter table crm_payments add column if not exists refunded_cents integer not null default 0;
    update crm_payments set checkout_session_id=external_id
      where provider='stripe' and checkout_session_id is null and external_id ~ '^cs_';
    update crm_payments set payment_intent_id=external_id
      where provider='stripe' and payment_intent_id is null and external_id ~ '^pi_';
    update crm_payments set charge_id=external_id
      where provider='stripe' and charge_id is null and external_id ~ '^ch_';
    update crm_payments p set stripe_account_id=a.account
      from (select org_id,min(external_account_id) as account from crm_payment_accounts
        where provider='stripe' group by org_id having count(distinct external_account_id)=1) a
      where p.org_id=a.org_id and p.provider='stripe' and p.stripe_account_id is null;
    update crm_payments set settled_cents=amount_cents
      where provider='stripe' and status='succeeded' and settled_cents=0;
    create index if not exists crm_payments_checkout_session_idx on crm_payments(stripe_account_id,checkout_session_id);
    create index if not exists crm_payments_payment_intent_idx on crm_payments(stripe_account_id,payment_intent_id);
    create index if not exists crm_payments_charge_idx on crm_payments(stripe_account_id,charge_id);
    create table if not exists crm_payment_refunds (
      id varchar primary key default gen_random_uuid(), org_id varchar not null,
      payment_id varchar not null, invoice_id varchar, account_id text not null,
      event_id text not null, charge_id text not null, amount_cents integer not null check(amount_cents>0),
      invoice_credit_cents integer not null check(invoice_credit_cents>=0),
      cumulative_refunded_cents integer not null, created_at timestamp not null default now(),
      unique(account_id,event_id)
    );
    create index if not exists crm_refunds_invoice_idx on crm_payment_refunds(org_id,invoice_id);
    create index if not exists crm_refunds_payment_idx on crm_payment_refunds(org_id,payment_id);
    create table if not exists crm_stripe_events (
      account_id text not null, event_id text not null, org_id varchar not null,
      payment_id varchar not null, event_type text not null,
      applied_at timestamp not null default now(), primary key(account_id,event_id)
    );
  `);
}
