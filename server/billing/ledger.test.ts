import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The billing ledger against a real Postgres (DATABASE_URL — the lane's
// scratch database): the idempotent DDL, the per-event claim, invoice and
// purchase upserts and the keyset-paged local listing. Every row is written
// under a throwaway "ACCT-l2" user and removed afterwards. Skipped without a
// database.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("billing ledger (database)", () => {
  let pool: typeof import("../db").pool;
  let ledger: typeof import("./ledger");
  let userId = 0;
  const tag = `ACCT-l2-${process.pid}-${Date.now().toString(36)}`;
  const id = (prefix: string, n: string | number) => `${prefix}_${tag}_${n}`;

  const invoice = (n: number, extra: Partial<import("./ledger").BillingInvoiceRow> = {}): import("./ledger").BillingInvoiceRow => ({
    id: id("in", n), userId, number: `CHUB-${n}`, status: "paid", amountPaid: 7900, amountDue: 0, currency: "usd",
    periodStart: new Date(Date.UTC(2026, 0, n)), periodEnd: new Date(Date.UTC(2026, 1, n)), description: `Pro — month ${n}`,
    hostedInvoiceUrl: `https://invoice.stripe.com/i/${tag}/${n}`, invoicePdf: null, created: new Date(Date.UTC(2026, 0, n, 12)),
    ...extra,
  });

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    ledger = await import("./ledger");
    await ledger.ensureBillingLedgerSchema(pool);
    await ledger.ensureBillingLedgerSchema(pool); // idempotent
    const { rows: [u] } = await pool.query(
      `INSERT INTO users(email, display_name) VALUES($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [`${tag.toLowerCase()}@example.invalid`, tag]);
    userId = u.id;
  });

  afterAll(async () => {
    if (userId) {
      await pool.query(`DELETE FROM billing_invoices WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM billing_purchases WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM billing_events WHERE stripe_event_id LIKE $1`, [`evt_${tag}_%`]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    await pool.end();
  });

  it("creates the three ledger tables with the contract's columns", async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1) ORDER BY table_name, ordinal_position`,
      [ledger.BILLING_LEDGER_DDL.length ? ["billing_events", "billing_invoices", "billing_purchases"] : []]);
    const cols = (t: string) => rows.filter((r) => r.table_name === t).map((r) => r.column_name);
    expect(cols("billing_events")).toEqual(expect.arrayContaining(["stripe_event_id", "type", "user_id", "received_at"]));
    expect(cols("billing_invoices")).toEqual(expect.arrayContaining(["id", "user_id", "number", "status", "amount_paid", "amount_due", "currency", "period_start", "period_end", "description", "hosted_invoice_url", "invoice_pdf", "created"]));
    expect(cols("billing_purchases")).toEqual(expect.arrayContaining(["id", "user_id", "kind", "description", "amount", "currency", "created", "receipt_url"]));
  });

  it("claims an event id once; a release lets it be claimed again; attribution fills the account", async () => {
    const event = { id: id("evt", 1), type: "invoice.paid" };
    expect(await ledger.recordBillingEvent(event)).toBe(true);
    expect(await ledger.recordBillingEvent(event)).toBe(false);
    expect(await ledger.billingEventSeen(event.id)).toBe(true);
    await ledger.attributeBillingEvent(event.id, userId);
    const { rows: [row] } = await pool.query(`SELECT type, user_id, received_at FROM billing_events WHERE stripe_event_id = $1`, [event.id]);
    expect(row).toMatchObject({ type: "invoice.paid", user_id: userId });
    expect(row.received_at).toBeInstanceOf(Date);
    await ledger.releaseBillingEvent(event.id);
    expect(await ledger.billingEventSeen(event.id)).toBe(false);
    expect(await ledger.recordBillingEvent(event)).toBe(true);
  });

  it("upserts an invoice: finalized then paid updates the same row", async () => {
    await ledger.upsertInvoice(invoice(1, { status: "open", amountPaid: 0, amountDue: 7900, invoicePdf: null }));
    await ledger.upsertInvoice(invoice(1, { invoicePdf: `https://pay.stripe.com/invoice/${tag}/1/pdf` }));
    const row = await ledger.getLocalInvoice(userId, id("in", 1));
    expect(row).toMatchObject({ id: id("in", 1), userId, status: "paid", amountPaid: 7900, amountDue: 0, number: "CHUB-1", invoicePdf: `https://pay.stripe.com/invoice/${tag}/1/pdf` });
    expect(row!.periodStart).toEqual(new Date(Date.UTC(2026, 0, 1)));
    // Stripe doesn't guarantee delivery order: a late invoice.finalized snapshot
    // (open, nothing paid yet) must not turn the paid row back into an open one.
    expect(await ledger.upsertInvoice(invoice(1, { status: "open", amountPaid: 0, amountDue: 7900, invoicePdf: null }))).toBe(false);
    expect(await ledger.getLocalInvoice(userId, id("in", 1))).toMatchObject({ status: "paid", amountPaid: 7900, amountDue: 0, invoicePdf: `https://pay.stripe.com/invoice/${tag}/1/pdf` });
    // A settled invoice still takes a later settled snapshot (the backfill's current state).
    expect(await ledger.upsertInvoice(invoice(1, { description: "Pro — month 1 (refreshed)" }))).toBe(true);
    expect((await ledger.getLocalInvoice(userId, id("in", 1)))!.description).toBe("Pro — month 1 (refreshed)");
    expect(await ledger.countLocalInvoices(userId)).toBe(1);
    // Another account can't read it.
    expect(await ledger.getLocalInvoice(userId + 1_000_000, id("in", 1))).toBeNull();
  });

  it("lists invoices newest first with keyset paging (hasMore, startingAfter)", async () => {
    for (let n = 2; n <= 5; n++) await ledger.upsertInvoice(invoice(n));
    const page1 = await ledger.listLocalInvoices(userId, { limit: 2 });
    expect(page1.invoices.map((r) => r.number)).toEqual(["CHUB-5", "CHUB-4"]);
    expect(page1.hasMore).toBe(true);
    const page2 = await ledger.listLocalInvoices(userId, { limit: 2, startingAfter: page1.invoices[1].id });
    expect(page2.invoices.map((r) => r.number)).toEqual(["CHUB-3", "CHUB-2"]);
    expect(page2.hasMore).toBe(true);
    const page3 = await ledger.listLocalInvoices(userId, { limit: 2, startingAfter: page2.invoices[1].id });
    expect(page3.invoices.map((r) => r.number)).toEqual(["CHUB-1"]);
    expect(page3.hasMore).toBe(false);
    // A cursor that isn't this account's invoice yields nothing rather than another account's page.
    expect((await ledger.listLocalInvoices(userId + 1_000_000, { limit: 2, startingAfter: page1.invoices[1].id })).invoices).toEqual([]);
  });

  it("upserts purchases, keeps a receipt URL a later write lacks, lists newest first", async () => {
    const purchase = (n: number, receiptUrl: string | null) => ({
      id: id("pi", n), userId, kind: "course" as const, description: `Master Class ${n}`, amount: 9900, currency: "usd",
      created: new Date(Date.UTC(2026, 2, n)), receiptUrl,
    });
    await ledger.upsertPurchase(purchase(1, `https://pay.stripe.com/receipts/${tag}/1`));
    await ledger.upsertPurchase(purchase(1, null));
    await ledger.upsertPurchase(purchase(2, null));
    const rows = await ledger.listLocalPurchases(userId);
    expect(rows.map((r) => [r.id, r.receiptUrl])).toEqual([[id("pi", 2), null], [id("pi", 1), `https://pay.stripe.com/receipts/${tag}/1`]]);
    expect(rows[0]).toMatchObject({ kind: "course", description: "Master Class 2", amount: 9900, currency: "usd" });
  });
});
