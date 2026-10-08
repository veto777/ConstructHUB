/**
 * Tutorial FIXTURE rows for the demo workspace — the connected-account state the walkthrough
 * videos need (docs/tutorials/FIXTURES.md). Runs AFTER scripts/tutorials/seed-demo.ts:
 *
 *   TUTORIAL_FIXTURES=1 DATABASE_URL=<a recording database> npx tsx scripts/tutorials/seed-fixtures.ts
 *
 * What it writes — all of it fictional, every row id starting `tutfx-` (FIXTURE_MARK):
 *   · a stand-in connected payment account for Aspire Interiors (acct_tutfx…), cards and bank on;
 *   · five online payments in five states — paid by card, paid by bank, bank debit still
 *     processing, refunded, failed — on clients in Texas, New York and Florida;
 *   · the Google Calendar connection (calendar created, last synced this morning);
 *   · the company's own texting number (+1 941 555 0100) and the owner's texting consent;
 *   · a marker that asks the slot app to connect the HOVER stand-in when it boots (the HOVER
 *     token is encrypted with each slot's own secret, so it cannot be seeded here).
 *
 * RULES
 *   · ADDITIVE and idempotent: insert-if-absent with fixed ids; settings are only filled where
 *     empty. It never changes, renames or deletes a row of seed-demo.ts — step scripts find those
 *     by name — and it never touches an existing invoice or estimate.
 *   · ONE transaction of rows only (no DDL): a copy of the template taken while this runs sees
 *     all of it or none of it, the same guarantee as seed-demo.ts / `db.ts reseed`.
 *   · It refuses anything that is not a recording database on 127.0.0.1:5432, and refuses to
 *     run at all without TUTORIAL_FIXTURES=1 (server/tutorials/fixtures/gate.ts decides).
 *   · No government data, no real company, person, phone (555-01xx only) or email (example.com only).
 */
import { assertFixtureSeedAllowed, FIXTURE_MARK } from "../../server/tutorials/fixtures/gate";
import { FIXTURE_STRIPE_ACCOUNT, FIXTURE_STRIPE_BUSINESS } from "../../server/tutorials/fixtures/providers/stripe";
import { FIXTURE_GCAL_CALENDAR, FIXTURE_GCAL_REFRESH } from "../../server/tutorials/fixtures/providers/google-calendar";
import { FIXTURE_SMS_COMPANY_NUMBER } from "../../server/tutorials/fixtures/providers/sms";

assertFixtureSeedAllowed();
const { pool } = await import("../../server/db");
const client = await pool.connect();
const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params as any[])).rows;

const HOUR = 60, DAY = 24 * 60;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000);
const id = (name: string) => `${FIXTURE_MARK.id}${name}`;

async function main(): Promise<string> {
  const [org] = await q(`select id, custom_fields from crm_orgs where name = 'Aspire Interiors' order by created_at limit 1`);
  if (!org) throw new Error("Aspire Interiors does not exist — run scripts/seed-crm-demo.ts and scripts/tutorials/seed-demo.ts first");
  const orgId: string = org.id;
  const [owner] = await q(`select id from crm_members where org_id = $1 and role = 'owner' order by created_at limit 1`, [orgId]);
  if (!owner) throw new Error("the demo workspace has no owner member");
  const project = async (number: string): Promise<{ id: string; customer_id: string; contract_value_cents: number | null }> => {
    const [p] = await q(`select id, customer_id, contract_value_cents from crm_projects where org_id = $1 and number = $2`, [orgId, number]);
    if (!p) throw new Error(`no demo project ${number} — is scripts/tutorials/seed-demo.ts up to date in this database?`);
    return p;
  };

  // ── Payments: the connected account ────────────────────────────────────────────────────────────
  await q(`insert into crm_payment_accounts (id, org_id, provider, external_account_id, livemode, charges_enabled, ach_enabled, card_enabled, account_email, business_name,
             country, default_currency, connected_by_member_id, last_checked_at, created_at, updated_at)
           values ($1,$2,'stripe',$3,false,true,true,true,$4,$5,$6,$7,$8,$9,$10,$10) on conflict (id) do nothing`,
    [id("payacct-01"), orgId, FIXTURE_STRIPE_ACCOUNT, FIXTURE_STRIPE_BUSINESS.email, FIXTURE_STRIPE_BUSINESS.name, FIXTURE_STRIPE_BUSINESS.country, FIXTURE_STRIPE_BUSINESS.currency,
      owner.id, ago(2 * HOUR), ago(40 * DAY)]);

  // ── Payments: five online payments, five states, three states of the map ───────────────────────
  // Amounts are a share of the job's contract value (seed-demo.ts prices those from the price book).
  type Pay = { key: string; project: string; share: number; purpose: string; rail: "card" | "ach"; status: string; createdAgo: number; paidAgo?: number; fail?: string; refundedAgo?: number };
  const pays: Pay[] = [
    { key: "card-paid", project: "P-1997", share: 0.25, purpose: "progress", rail: "card", status: "succeeded", createdAgo: 1 * DAY + 3 * HOUR, paidAgo: 1 * DAY + 3 * HOUR - 4 },   // Hadley, Austin TX
    { key: "ach-paid", project: "P-1994", share: 0.4, purpose: "progress", rail: "ach", status: "succeeded", createdAgo: 6 * DAY, paidAgo: 2 * DAY + 5 * HOUR },                    // Oyelaran, Albany NY
    { key: "ach-processing", project: "P-2005", share: 0.4, purpose: "progress", rail: "ach", status: "processing", createdAgo: 14 * HOUR },                                        // Ellison, Venice FL
    { key: "card-refunded", project: "P-2007", share: 0.25, purpose: "progress", rail: "card", status: "refunded", createdAgo: 7 * DAY, paidAgo: 7 * DAY - 3, refundedAgo: 5 * DAY }, // Nguyen, FL
    { key: "ach-failed", project: "P-1999", share: 0.5, purpose: "final", rail: "ach", status: "failed", createdAgo: 2 * DAY + 2 * HOUR, fail: "The bank declined this payment." },   // Quintanilla, Houston TX
  ];
  for (const p of pays) {
    const pr = await project(p.project);
    if (!pr.contract_value_cents) throw new Error(`demo project ${p.project} has no contract value`);
    const cents = Math.round(pr.contract_value_cents * p.share);
    const key = p.key.replace(/-/g, ""), paid = p.status === "succeeded" || p.status === "refunded";
    const session = `cs_test_${FIXTURE_MARK.stripeObject}_seed${key}`, intent = `pi_${FIXTURE_MARK.stripeObject}_${p.rail}_seed${key}`;
    const charge = paid ? intent.replace(/^pi_/, "ch_") : null;
    await q(`insert into crm_payments (id, org_id, customer_id, project_id, provider, external_id, purpose, amount_cents, currency, method, status, application_fee_cents, failure_reason,
               paid_at, created_at, updated_at, checkout_session_id, payment_intent_id, charge_id, stripe_account_id, settled_cents, refunded_cents)
             values ($1,$2,$3,$4,'stripe',$5,$6,$7,'usd',$8,$9,0,$10,$11,$12,$13,$5,$14,$15,$16,$17,$18) on conflict (id) do nothing`,
      [id(`pay-${p.key}`), orgId, pr.customer_id, pr.id, session, p.purpose, cents, p.rail, p.status, p.fail ?? null,
        p.paidAgo != null ? ago(p.paidAgo) : null, ago(p.createdAgo), ago(p.refundedAgo ?? p.paidAgo ?? p.createdAgo),
        p.status === "failed" || paid || p.status === "processing" ? intent : null, charge, FIXTURE_STRIPE_ACCOUNT, paid ? cents : 0, p.status === "refunded" ? cents : 0]);
    if (p.status === "refunded")
      await q(`insert into crm_payment_refunds (id, org_id, payment_id, invoice_id, account_id, event_id, charge_id, amount_cents, invoice_credit_cents, cumulative_refunded_cents, created_at)
               values ($1,$2,$3,null,$4,$5,$6,$7,$7,$7,$8) on conflict (id) do nothing`,
        [id(`refund-${p.key}`), orgId, id(`pay-${p.key}`), FIXTURE_STRIPE_ACCOUNT, `evt_${FIXTURE_MARK.stripeObject}_seed${key}`, charge, cents, ago(p.refundedAgo!)]);
  }

  // ── Connections kept in the workspace's settings: only where nothing is set yet ────────────────
  const cf = (org.custom_fields ?? {}) as Record<string, any>;
  const add: Record<string, unknown> = {};
  if (!cf.googleCalendar) add.googleCalendar = {
    refreshToken: FIXTURE_GCAL_REFRESH, connectedAt: ago(33 * DAY).toISOString(), connectedByMemberId: owner.id,
    calendarId: FIXTURE_GCAL_CALENDAR, lastSyncAt: ago(3 * HOUR).toISOString(), lastSyncError: null,
  };
  // The company's own number: what lets it text clients (the shared platform number may not).
  if (!cf.sms) add.sms = { mode: "dedicated", fromNumber: FIXTURE_SMS_COMPANY_NUMBER };
  // HOVER's refresh token is encrypted with each slot's own secret: the slot app completes this at boot.
  if (!cf.hover) add.hover = { fixture: true, connectedAt: ago(21 * DAY).toISOString(), connectedByMemberId: owner.id, syncEveryHours: 6 };
  if (Object.keys(add).length)
    await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) || $2::jsonb where id = $1`, [orgId, JSON.stringify(add)]);
  // Carrier rule: the person who gets alert texts agreed to them. The owner's own (fictional) mobile.
  await q(`update crm_members set sms_consent_at = coalesce(sms_consent_at, $2), sms_consent_phone = coalesce(sms_consent_phone, '+19415550111'), phone = coalesce(phone, '(941) 555-0111')
            where id = $1`, [owner.id, ago(30 * DAY)]);

  const n = async (sql: string) => Number((await q(sql, [orgId, `${FIXTURE_MARK.id}%`]))[0].n);
  return `tutorial fixtures: ${await n(`select count(*)::int as n from crm_payment_accounts where org_id = $1 and id like $2`)} payment account, `
    + `${await n(`select count(*)::int as n from crm_payments where org_id = $1 and id like $2`)} online payments, `
    + `${await n(`select count(*)::int as n from crm_payment_refunds where org_id = $1 and id like $2`)} refund; calendar, texting and HOVER connection settings ${Object.keys(add).length ? `added (${Object.keys(add).join(", ")})` : "already present"}`;
}

// One transaction: all of it or none of it.
try {
  await client.query("begin");
  const summary = await main();
  await client.query("commit");
  console.log(summary);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
