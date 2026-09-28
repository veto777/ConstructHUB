import { test } from './crm-isolated-fixture';
import { expect } from '@playwright/test';
import { q } from './db';
import { gotoCrm, grantClientSession } from './helpers';
import { randomUUID } from 'node:crypto';

test('partial and full refunds remain visible on invoices and receipts', async ({ page, crmOrgId }) => {
  const c = await page.request.post('/api/crm/customers', { data: { displayName: 'Refund fixture' } });
  expect(c.ok()).toBeTruthy();
  const customer = await c.json();
  const r = await page.request.post('/api/crm/invoices', { data: { customerId: customer.id, title: 'Refund fixture', taxRateBps: 0, items: [{ kind: 'labor', name: 'Labor', quantityMilli: 1000, unitPriceCents: 1000 }] } });
  expect(r.ok()).toBeTruthy();
  const invoice = await r.json(), payment = randomUUID();
  // Provider webhook accounting is exercised with real transactions in payment-ledger.test.ts.
  // Seed its resulting ledger here: no real Stripe calls or customer messages.
  await q(`insert into crm_payments(id,org_id,customer_id,invoice_id,provider,method,amount_cents,status,settled_cents,refunded_cents) values($1,$2,$3,$4,'stripe','card',1000,'partially_refunded',1000,300)`, [payment,crmOrgId,customer.id,invoice.id]);
  await q(`insert into crm_payment_refunds(org_id,payment_id,invoice_id,account_id,event_id,charge_id,amount_cents,invoice_credit_cents,cumulative_refunded_cents) values($1,$2,$3,'acct_test','evt_partial','ch_test',300,300,300)`,[crmOrgId,payment,invoice.id]);
  await q(`update crm_invoices set paid_cents=700,status='partial' where id=$1`,[invoice.id]);
  await gotoCrm(page, `/crm/clients/${customer.id}`);
  await page.getByTestId(`button-receipt-${invoice.id}`).click();
  await expect(page.getByTestId('receipt-preview')).toContainText('Refund');
  await expect(page.getByTestId('receipt-total-paid')).toHaveText('$7.00');
  await expect(page.getByTestId('receipt-balance')).toHaveText('$3.00');
  await grantClientSession(page,[customer.id]);
  await page.goto(`/i/${invoice.publicToken}?client=1`);
  await expect(page.getByTestId('invoice-refunded')).toContainText('$3.00');
  await q(`insert into crm_payment_refunds(org_id,payment_id,invoice_id,account_id,event_id,charge_id,amount_cents,invoice_credit_cents,cumulative_refunded_cents) values($1,$2,$3,'acct_test','evt_full','ch_test',700,700,1000)`,[crmOrgId,payment,invoice.id]);
  await q(`update crm_payments set refunded_cents=1000,status='refunded' where id=$1`,[payment]);
  await q(`update crm_invoices set paid_cents=0,status='sent' where id=$1`,[invoice.id]);
  await gotoCrm(page, `/crm/clients/${customer.id}`);
  await page.getByTestId(`button-receipt-${invoice.id}`).click();
  await expect(page.getByTestId('receipt-total-paid')).toHaveText('$0.00');
  await expect(page.getByTestId('receipt-balance')).toHaveText('$10.00');
  await gotoCrm(page,'/crm/invoices');
  await expect(page.getByTestId(`button-receipt-${invoice.id}`)).toBeVisible();
});
