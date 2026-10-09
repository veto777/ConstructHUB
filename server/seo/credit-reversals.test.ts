/**
 * Refunds, disputes and failed bank debits on SEO data credit packs (review M-3).
 *
 * Part 1 needs nothing: the wallet arithmetic, the customer's wording, and that the webhook routes every event here.
 * Part 2 needs a local development database (DATABASE_URL; skipped without one): the real ledger, with a fake Stripe
 * that answers like Stripe does — the object as it is NOW, whatever event is being processed.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const issues = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("../ops/issues", () => ({ recordIssue: vi.fn(async (i: any) => { issues.list.push(i); }), recordFailure: vi.fn(async () => {}) }));

import { WalletMoves, SEO_CREDIT_REVERSAL_EVENTS, applySeoCreditEvent, SeoCreditNotYetCredited, type ReversalStripe } from "./credit-reversals";
import { creditNotice, owedCreditMessage, frozenCreditMessage } from "./credits";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("the wallet arithmetic", () => {
  it("taking back spends what is left first and records the rest as owed; giving back settles what is owed first", () => {
    const m = new WalletMoves({ balance: 500, frozen: 0, owed: 0 });
    m.take("refund", 2500);
    expect(m.w).toEqual({ balance: 0, frozen: 0, owed: 2000 });
    m.give("refund_reversed", 2100);
    expect(m.w).toEqual({ balance: 100, frozen: 0, owed: 0 });
    expect(m.entries).toEqual([
      { kind: "refund", wallet: -500, frozen: 0, owed: 2000 },
      { kind: "refund_reversed", wallet: 100, frozen: 0, owed: -2000 },
    ]);
  });
  it("a hold takes only what is there, a release gives it back, a forfeit removes it", () => {
    const m = new WalletMoves({ balance: 3000, frozen: 0, owed: 0 });
    expect(m.hold("dispute_hold", 5000)).toBe(3000);
    expect(m.w).toEqual({ balance: 0, frozen: 3000, owed: 0 });
    m.release("dispute_released", 1000);
    expect(m.w).toEqual({ balance: 1000, frozen: 2000, owed: 0 });
    m.forfeit("dispute_lost", 2000);
    expect(m.w).toEqual({ balance: 1000, frozen: 0, owed: 0 });
    const none = new WalletMoves({ balance: 10, frozen: 0, owed: 0 });
    none.take("refund", 0);
    none.give("x", 0);
    expect(none.entries).toEqual([]);
  });
});

describe("what the customer reads", () => {
  it("says why, in plain words and their own dollars — never the data source or what it costs us", () => {
    const owed = owedCreditMessage(2000), frozen = frozenCreditMessage(5000);
    expect(owed).toContain("$20.00 below zero");
    expect(owed).toMatch(/refunded or disputed/);
    expect(owed).toMatch(/add credit/i);
    expect(frozen).toContain("$50.00");
    expect(frozen).toMatch(/on hold while a dispute/);
    for (const text of [owed, frozen, creditNotice(2000, 5000)!]) expect(text).not.toMatch(/dataforseo|wholesale|markup|vendor|provider|stripe/i);
    expect(creditNotice(0, 0)).toBeNull();
    expect(creditNotice(0, 5000)).toBe(frozen);
  });
});

describe("the webhook", () => {
  const stripeTs = fs.readFileSync(path.join(ROOT, "server/stripe.ts"), "utf8");
  it("sends every refund, dispute and failed-debit event here, and none of them sends a billing email", () => {
    for (const type of SEO_CREDIT_REVERSAL_EVENTS) expect(stripeTs, type).toContain(`case "${type}":`);
    const block = stripeTs.slice(stripeTs.indexOf('case "charge.refunded":'), stripeTs.indexOf('case "invoice.paid":'));
    expect(block).toContain("applySeoCreditEvent(event");
    expect(block).toContain("sendBillingEmail = false");
    const failed = stripeTs.slice(stripeTs.indexOf('case "checkout.session.async_payment_failed":'), stripeTs.indexOf('case "charge.refunded":'));
    expect(failed).toContain("applySeoCreditEvent(event");
    // Still verifies the raw body and fails closed before any of it (CLAUDE.md Security).
    expect(stripeTs.indexOf("stripe.webhooks.constructEvent(rawBody")).toBeLessThan(stripeTs.indexOf('case "charge.refunded":'));
  });
  it("tags the credit checkout's payment, and does not change a pack's price or contents", () => {
    const route = stripeTs.slice(stripeTs.indexOf('"/api/seo/credits/checkout"'), stripeTs.indexOf('"/api/stripe/create-course-checkout"'));
    expect(route).toContain('payment_intent_data: { metadata: { userId: String(user.id), type: "seo_credits", cents: String(cents) } }');
    expect(route).toContain("unit_amount: cents");
    expect(route).toContain("quantity: 1");
  });
  it("the operator note lists every event type that must be enabled on the live endpoint", () => {
    const handoff = fs.readFileSync(path.join(ROOT, "HANDOFF.md"), "utf8");
    const note = handoff.slice(handoff.indexOf("OWNER/OPERATOR ACTION: enable these event types"));
    expect(note.length).toBeGreaterThan(0);
    for (const type of [...SEO_CREDIT_REVERSAL_EVENTS, "checkout.session.async_payment_succeeded"]) expect(note.slice(0, 2500), type).toContain(`\`${type}\``);
  });
});

// ── Part 2: against Postgres ─────────────────────────────────────────────────────────────────────────
const DB = !!process.env.DATABASE_URL;
describe.skipIf(!DB)("against the ledger (local dev database)", () => {
  let pool: any, credits: typeof import("./credits"), userId = 0;
  const email = `credit-reversal-${process.pid}-${Date.now()}@example.invalid`;
  // A fake Stripe: the objects as they are now. Tests change them, then deliver an event.
  const charges = new Map<string, { id: string; amount: number; amount_refunded: number; payment_intent: string }>();
  const disputes = new Map<string, { id: string; amount: number; status: string; charge: string; payment_intent: string }>();
  const sessions = new Map<string, { id: string; mode: string; payment_status: string; metadata: Record<string, string> }>();
  const stripe: ReversalStripe = {
    charges: { retrieve: async (id) => { const c = charges.get(id); if (!c) throw new Error("No such charge"); return { ...c }; } },
    disputes: { retrieve: async (id) => { const d = disputes.get(id); if (!d) throw new Error("No such dispute"); return { ...d }; } },
    checkout: { sessions: { list: async ({ payment_intent }) => ({ data: sessions.has(payment_intent) ? [sessions.get(payment_intent)!] : [] }) } },
  };
  let n = 0;
  const ev = (type: string, object: any) => ({ id: `evt_test_${process.pid}_${++n}`, type, data: { object } });
  /** A paid credit pack: Stripe's session, charge and our fulfilment. */
  async function buy(cents: number, opts: { fulfil?: boolean; legacy?: boolean } = {}) {
    const k = `${process.pid}_${++n}`, pi = `pi_test_${k}`, cs = `cs_test_${k}`, ch = `ch_test_${k}`;
    sessions.set(pi, { id: cs, mode: "payment", payment_status: "paid", metadata: { type: "seo_credits", userId: String(userId), cents: String(cents) } });
    charges.set(ch, { id: ch, amount: cents, amount_refunded: 0, payment_intent: pi });
    if (opts.fulfil !== false)
      expect(await credits.fulfilSeoCredits({ id: cs, mode: "payment", payment_status: "paid", amount_total: cents, payment_intent: opts.legacy ? null : pi, metadata: sessions.get(pi)!.metadata }, userId, `evt_paid_${k}`)).toBe(cents);
    return { pi, cs, ch };
  }
  const wallet = async () => {
    const { rows: [w] } = await pool.query("SELECT balance_cents, frozen_cents, owed_cents FROM seo_credit_wallets WHERE user_id=$1", [userId]);
    return { balance: w.balance_cents, frozen: w.frozen_cents, owed: w.owed_cents };
  };
  const spend = (cents: number) => credits.reserveCredits(userId, 0, cents);
  const refund = (ch: string, total: number) => { charges.get(ch)!.amount_refunded = total; return applySeoCreditEvent(ev("charge.refunded", { id: ch }), stripe); };

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    credits = await import("./credits");
    for (const ddl of credits.CREDIT_SCHEMA_DDL) await pool.query(ddl);
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [email])).rows[0].id;
  });
  afterAll(async () => {
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  });
  beforeEach(async () => {
    issues.list.length = 0;
    await pool.query("DELETE FROM seo_credit_ledger WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM seo_credit_disputes WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM seo_credit_purchases WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM seo_credit_usage WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM seo_credit_wallets WHERE user_id=$1", [userId]);
  });

  it("a full refund takes the whole pack back, on the record with the Stripe ids", async () => {
    const { ch, pi } = await buy(5000);
    expect(await wallet()).toEqual({ balance: 5000, frozen: 0, owed: 0 });
    expect(await refund(ch, 5000)).toEqual({ userId });
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
    const { rows } = await pool.query("SELECT kind, wallet_delta, owed_delta, stripe_object_id, stripe_payment_intent, stripe_event_id FROM seo_credit_ledger WHERE user_id=$1 ORDER BY id", [userId]);
    expect(rows.map((r: any) => [r.kind, r.wallet_delta, r.owed_delta])).toEqual([["purchase", 5000, 0], ["refund", -5000, 0]]);
    expect(rows[1]).toMatchObject({ stripe_object_id: ch, stripe_payment_intent: pi });
    expect(rows[1].stripe_event_id).toMatch(/^evt_test_/);
    expect((await pool.query("SELECT refunded_cents FROM seo_credit_purchases WHERE stripe_payment_intent=$1", [pi])).rows[0].refunded_cents).toBe(5000);
  });

  it("a partial refund takes back the same share; a second partial refund takes only the difference", async () => {
    const { ch } = await buy(10000);
    await refund(ch, 2500);
    expect(await wallet()).toEqual({ balance: 7500, frozen: 0, owed: 0 });
    await refund(ch, 6000);
    expect(await wallet()).toEqual({ balance: 4000, frozen: 0, owed: 0 });
  });

  it("a refund after the credit was spent leaves it owed: lookups stop, the account says why, the next pack settles it", async () => {
    const { ch } = await buy(2500);
    await spend(2000);
    expect(await wallet()).toEqual({ balance: 500, frozen: 0, owed: 0 });
    await refund(ch, 2500);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 2000 });
    // Refused — the month's allowance included — with the reason.
    await expect(credits.reserveCredits(userId, 4000, 10)).rejects.toMatchObject({ name: "SeoCreditOwed", owedCents: 2000 });
    await expect(credits.reserveCredits(userId, 4000, 10)).rejects.toThrow(/\$20\.00 below zero/);
    const status = await credits.creditStatus(userId, 4000);
    expect(status).toMatchObject({ availableCents: 0, owedCents: 2000, walletCents: 0 });
    expect(status.notice).toContain("$20.00 below zero");
    // The next pack pays what is owed first.
    await buy(5000);
    expect(await wallet()).toEqual({ balance: 3000, frozen: 0, owed: 0 });
    expect(await credits.reserveCredits(userId, 4000, 10)).toMatchObject({ fromIncluded: 10 });
    const kinds = (await pool.query("SELECT kind, wallet_delta, owed_delta FROM seo_credit_ledger WHERE user_id=$1 ORDER BY id", [userId])).rows.map((r: any) => [r.kind, r.wallet_delta, r.owed_delta]);
    expect(kinds).toEqual([["purchase", 2500, 0], ["refund", -500, 2000], ["purchase", 5000, 0], ["owed_settled", -2000, -2000]]);
  });

  it("a dispute puts the disputed credit on hold; won, it comes back", async () => {
    const { ch, pi } = await buy(5000);
    disputes.set("dp_won", { id: "dp_won", amount: 5000, status: "needs_response", charge: ch, payment_intent: pi });
    await applySeoCreditEvent(ev("charge.dispute.created", { id: "dp_won" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 5000, owed: 0 });
    await expect(spend(100)).rejects.toMatchObject({ name: "SeoCreditShort" });        // cannot be spent while open
    expect((await credits.creditStatus(userId, 0)).notice).toMatch(/\$50\.00 .* on hold while a dispute/);
    expect(issues.list[0]).toMatchObject({ severity: "critical", key: "seo-credit-dispute:dp_won:needs_response" });
    disputes.get("dp_won")!.status = "under_review";
    await applySeoCreditEvent(ev("charge.dispute.updated", { id: "dp_won" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 5000, owed: 0 });
    disputes.get("dp_won")!.status = "won";
    await applySeoCreditEvent(ev("charge.dispute.closed", { id: "dp_won" }), stripe);
    expect(await wallet()).toEqual({ balance: 5000, frozen: 0, owed: 0 });
    expect(issues.list.at(-1)).toMatchObject({ key: "seo-credit-dispute:dp_won:won" });
  });

  it("a dispute lost removes the credit; what was already spent becomes owed", async () => {
    const { ch, pi } = await buy(5000);
    await spend(1000);
    disputes.set("dp_lost", { id: "dp_lost", amount: 5000, status: "needs_response", charge: ch, payment_intent: pi });
    await applySeoCreditEvent(ev("charge.dispute.created", { id: "dp_lost" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 4000, owed: 0 });
    disputes.get("dp_lost")!.status = "lost";
    await applySeoCreditEvent(ev("charge.dispute.closed", { id: "dp_lost" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 1000 });
    expect((await pool.query("SELECT disputed_lost_cents FROM seo_credit_purchases WHERE stripe_payment_intent=$1", [pi])).rows[0].disputed_lost_cents).toBe(5000);
    // A stale event for the same dispute (Stripe now says lost) changes nothing.
    await applySeoCreditEvent(ev("charge.dispute.updated", { id: "dp_lost" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 1000 });
  });

  it("duplicate and out-of-order events move the credit once, to what Stripe says now", async () => {
    const { ch, pi } = await buy(10000);
    // Two partial refunds; the events arrive late and twice. Each read of the charge says the total so far.
    charges.get(ch)!.amount_refunded = 6000;
    const late = ev("charge.refunded", { id: ch });
    await applySeoCreditEvent(late, stripe);
    await applySeoCreditEvent(late, stripe);
    await applySeoCreditEvent(ev("charge.refund.updated", { id: "re_1", charge: ch }), stripe);
    expect(await wallet()).toEqual({ balance: 4000, frozen: 0, owed: 0 });
    // One refund then failed at the bank: Stripe's total goes down, and that credit comes back.
    charges.get(ch)!.amount_refunded = 2000;
    await applySeoCreditEvent(ev("charge.refund.updated", { id: "re_2", charge: ch }), stripe);
    expect(await wallet()).toEqual({ balance: 8000, frozen: 0, owed: 0 });
    // A dispute closed (lost) is delivered before it was opened: one removal, and the late "created" adds nothing.
    disputes.set("dp_ooo", { id: "dp_ooo", amount: 8000, status: "lost", charge: ch, payment_intent: pi });
    await applySeoCreditEvent(ev("charge.dispute.closed", { id: "dp_ooo" }), stripe);
    await applySeoCreditEvent(ev("charge.dispute.created", { id: "dp_ooo" }), stripe);
    await applySeoCreditEvent(ev("charge.dispute.funds_withdrawn", { id: "dp_ooo" }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
    // Refunded + lost never take back more than the pack.
    charges.get(ch)!.amount_refunded = 10000;
    await applySeoCreditEvent(ev("charge.refunded", { id: ch }), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
    const { rows: [p] } = await pool.query("SELECT refunded_cents, disputed_lost_cents FROM seo_credit_purchases WHERE stripe_payment_intent=$1", [pi]);
    expect(p.refunded_cents + p.disputed_lost_cents).toBe(10000);
  });

  it("a bank debit that fails is never credited; a credit that somehow exists for it is taken back", async () => {
    const k = `${process.pid}_ach`, session = { id: `cs_test_${k}`, mode: "payment", payment_status: "unpaid", amount_total: 2500, payment_intent: `pi_test_${k}`, metadata: { type: "seo_credits", userId: String(userId), cents: "2500" } };
    expect(await credits.fulfilSeoCredits(session, userId)).toBe(0);                 // completed unpaid: nothing yet
    expect(await applySeoCreditEvent(ev("checkout.session.async_payment_failed", session), stripe)).toEqual({ userId });
    expect((await pool.query("SELECT 1 FROM seo_credit_purchases WHERE user_id=$1", [userId])).rowCount).toBe(0);
    // Credited (it settled), then reported failed: the whole pack comes back out.
    expect(await credits.fulfilSeoCredits({ ...session, payment_status: "paid" }, userId)).toBe(2500);
    await applySeoCreditEvent(ev("checkout.session.async_payment_failed", session), stripe);
    await applySeoCreditEvent(ev("checkout.session.async_payment_failed", session), stripe);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
    expect((await pool.query("SELECT kind FROM seo_credit_ledger WHERE user_id=$1 ORDER BY id", [userId])).rows.map((r: any) => r.kind)).toEqual(["purchase", "payment_failed"]);
  });

  it("a refund that arrives before the pack was credited is retried, never skipped", async () => {
    const { ch, cs, pi } = await buy(5000, { fulfil: false });
    charges.get(ch)!.amount_refunded = 5000;
    await expect(applySeoCreditEvent(ev("charge.refunded", { id: ch }), stripe)).rejects.toBeInstanceOf(SeoCreditNotYetCredited);
    await credits.fulfilSeoCredits({ id: cs, mode: "payment", payment_status: "paid", amount_total: 5000, payment_intent: pi, metadata: sessions.get(pi)!.metadata }, userId);
    await applySeoCreditEvent(ev("charge.refunded", { id: ch }), stripe);           // Stripe's retry
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
  });

  it("a pack bought before payments were recorded is found through its checkout; other payments are left alone", async () => {
    const { ch, pi } = await buy(2500, { legacy: true });
    await refund(ch, 2500);
    expect(await wallet()).toEqual({ balance: 0, frozen: 0, owed: 0 });
    expect((await pool.query("SELECT stripe_payment_intent FROM seo_credit_purchases WHERE user_id=$1", [userId])).rows[0].stripe_payment_intent).toBe(pi);
    // A course refund, a subscription dispute: not ours.
    charges.set("ch_course", { id: "ch_course", amount: 9900, amount_refunded: 9900, payment_intent: "pi_course" });
    sessions.set("pi_course", { id: "cs_course", mode: "payment", payment_status: "paid", metadata: { type: "course" } });
    expect(await applySeoCreditEvent(ev("charge.refunded", { id: "ch_course" }), stripe)).toEqual({ userId: null });
    charges.set("ch_invoice", { id: "ch_invoice", amount: 4900, amount_refunded: 0, payment_intent: "pi_invoice" });
    disputes.set("dp_invoice", { id: "dp_invoice", amount: 4900, status: "needs_response", charge: "ch_invoice", payment_intent: "pi_invoice" });
    expect(await applySeoCreditEvent(ev("charge.dispute.created", { id: "dp_invoice" }), stripe)).toEqual({ userId: null });
    expect(issues.list).toEqual([]);
    // Stripe unreachable: the event fails (the webhook answers 400 and Stripe delivers it again).
    await expect(applySeoCreditEvent(ev("charge.refunded", { id: "ch_missing" }), stripe)).rejects.toThrow("No such charge");
  });
});
