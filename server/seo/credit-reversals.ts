/**
 * Refunds, disputes (chargebacks) and failed bank debits on SEO data credit packs (review M-3).
 *
 * A pack is credited once Stripe says its checkout is paid (credits.ts fulfilSeoCredits). Before this, nothing ever
 * took the credit back: a customer could buy credit, dispute or be refunded the charge, and keep or spend the credit.
 *
 * What happens now, per pack (one seo_credit_purchases row, found by its PaymentIntent):
 *  - refund (full or partial): the same share of the pack's credit is taken back. A refund that later fails or is
 *    cancelled gives it back. The amount is always reconciled to what Stripe says NOW (the charge's amount_refunded,
 *    read from Stripe, never the event's snapshot), so duplicate and out-of-order events change nothing twice.
 *  - dispute opened: the disputed share is put on hold (seo_credit_wallets.frozen_cents) — it cannot be spent while
 *    the dispute is open. Won (or an inquiry closed): released. Lost: removed for good. Read from Stripe NOW as well.
 *  - bank debit failed (checkout.session.async_payment_failed): nothing was credited (credit is granted only when the
 *    session is paid); a credit that somehow exists for that session is taken back in full.
 * Credit that was already spent cannot be taken from the balance: the rest is recorded as owed
 * (seo_credit_wallets.owed_cents). While anything is owed, lookups that cost credit are refused (credits.ts
 * reserveCredits) and the account says why in plain words (credits.ts creditNotice); the next pack bought pays it
 * first. Every movement is a seo_credit_ledger row with the Stripe ids. A dispute raises an ops issue.
 *
 * Idempotent: the webhook claims each event id once (billing_events), and every change here is to an absolute target,
 * so a replay moves nothing. Fails closed: a Stripe read that fails, or a refund for a pack whose checkout has not been
 * credited yet, throws — the webhook answers 400 and Stripe delivers the event again later.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";
import { recordIssue } from "../ops/issues";

type Id = string | { id: string } | null | undefined;
const idOf = (v: Id): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof v.id === "string" ? v.id : null);

/** What this module reads from Stripe (the real client satisfies it; tests pass a fake). */
export type ReversalStripe = {
  charges: { retrieve(id: string): Promise<{ id: string; amount: number; amount_refunded: number; payment_intent?: Id }> };
  disputes: { retrieve(id: string): Promise<{ id: string; amount: number; status: string; charge?: Id; payment_intent?: Id }> };
  checkout: { sessions: { list(params: { payment_intent: string; limit: number }): Promise<{ data: { id: string; mode?: string | null; payment_status?: string | null; metadata?: Record<string, string> | null }[] }> } };
};

/** The Stripe events that move SEO credit back. Each must be enabled on the live webhook endpoint (HANDOFF.md). */
export const SEO_CREDIT_REFUND_EVENTS = ["charge.refunded", "charge.refund.updated"] as const;
export const SEO_CREDIT_DISPUTE_EVENTS = [
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
] as const;
export const SEO_CREDIT_FAILED_EVENTS = ["checkout.session.async_payment_failed"] as const;
export const SEO_CREDIT_REVERSAL_EVENTS: readonly string[] = [...SEO_CREDIT_REFUND_EVENTS, ...SEO_CREDIT_DISPUTE_EVENTS, ...SEO_CREDIT_FAILED_EVENTS];

/** A dispute still being decided (an inquiry — "warning_" — included: it can become a chargeback). */
const OPEN_DISPUTE = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review"]);

export class SeoCreditNotYetCredited extends Error {
  constructor(pi: string) {
    super(`SEO credit for payment ${pi} has not been credited yet; this event is retried until it has`);
    this.name = "SeoCreditNotYetCredited";
  }
}

type Purchase = { id: number; user_id: number; cents: number; refunded_cents: number; disputed_lost_cents: number; stripe_session_id: string; stripe_payment_intent: string | null };
type Wallet = { balance: number; frozen: number; owed: number };
type Ids = { eventId: string; objectId: string | null; pi: string | null };

/**
 * The credit purchase a PaymentIntent paid for, or null when it paid for something else. A purchase recorded before
 * PaymentIntents were stored is found through its checkout session (and the PaymentIntent is saved on it).
 */
async function purchaseIdFor(pi: string, stripe: ReversalStripe): Promise<number | null> {
  const direct = await pool.query(`SELECT id FROM seo_credit_purchases WHERE stripe_payment_intent=$1`, [pi]);
  if (direct.rows[0]) return Number(direct.rows[0].id);
  const { data } = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
  const session = data[0];
  if (!session || session.metadata?.type !== "seo_credits") return null;
  const bySession = await pool.query(
    `UPDATE seo_credit_purchases SET stripe_payment_intent=$2 WHERE stripe_session_id=$1 AND stripe_payment_intent IS NULL RETURNING id`,
    [session.id, pi]);
  if (bySession.rows[0]) return Number(bySession.rows[0].id);
  const again = await pool.query(`SELECT id FROM seo_credit_purchases WHERE stripe_session_id=$1`, [session.id]);
  if (again.rows[0]) return Number(again.rows[0].id);
  // A credit checkout Stripe calls paid but we have not credited yet (its event is late): try again later, never skip.
  if (session.mode === "payment" && session.payment_status === "paid") throw new SeoCreditNotYetCredited(pi);
  return null; // never paid, so never credited: nothing to take back
}

async function lock(client: PoolClient, purchaseId: number): Promise<{ p: Purchase; w: Wallet }> {
  const { rows: [p] } = await client.query(`SELECT * FROM seo_credit_purchases WHERE id=$1 FOR UPDATE`, [purchaseId]);
  await client.query(`INSERT INTO seo_credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [p.user_id]);
  const { rows: [w] } = await client.query(`SELECT balance_cents, frozen_cents, owed_cents FROM seo_credit_wallets WHERE user_id=$1 FOR UPDATE`, [p.user_id]);
  return {
    p: { ...p, id: Number(p.id), user_id: Number(p.user_id), cents: Number(p.cents), refunded_cents: Number(p.refunded_cents), disputed_lost_cents: Number(p.disputed_lost_cents) },
    w: { balance: Number(w.balance_cents), frozen: Number(w.frozen_cents), owed: Number(w.owed_cents) },
  };
}

/** One wallet, moved in memory and written once; every move is a ledger row. Pure arithmetic, exported for tests. */
export class WalletMoves {
  readonly entries: { kind: string; wallet: number; frozen: number; owed: number }[] = [];
  constructor(public w: Wallet) {}
  private note(kind: string, wallet: number, frozen: number, owed: number) {
    if (wallet || frozen || owed) this.entries.push({ kind, wallet, frozen, owed });
  }
  /** Take credit back: from what is left to spend, the rest becomes owed. */
  take(kind: string, cents: number) {
    if (cents <= 0) return;
    const fromBalance = Math.min(this.w.balance, cents);
    this.w.balance -= fromBalance;
    this.w.owed += cents - fromBalance;
    this.note(kind, -fromBalance, 0, cents - fromBalance);
  }
  /** Give credit back: what is owed is settled first. */
  give(kind: string, cents: number) {
    if (cents <= 0) return;
    const settles = Math.min(this.w.owed, cents);
    this.w.owed -= settles;
    this.w.balance += cents - settles;
    this.note(kind, cents - settles, 0, -settles);
  }
  /** Put credit on hold (only what is there to hold). Returns what was held. */
  hold(kind: string, cents: number): number {
    const h = Math.max(0, Math.min(this.w.balance, cents));
    this.w.balance -= h;
    this.w.frozen += h;
    this.note(kind, -h, h, 0);
    return h;
  }
  /** Release held credit back to the customer. */
  release(kind: string, cents: number) {
    if (cents <= 0) return;
    this.w.frozen -= cents;
    this.note(kind, 0, -cents, 0);
    this.give(kind, cents);
  }
  /** Held credit that is gone for good (a lost dispute). */
  forfeit(kind: string, cents: number) {
    if (cents <= 0) return;
    this.w.frozen -= cents;
    this.note(kind, 0, -cents, 0);
  }
}

async function write(client: PoolClient, p: Purchase, m: WalletMoves, ids: Ids) {
  await client.query(`UPDATE seo_credit_wallets SET balance_cents=$2, frozen_cents=$3, owed_cents=$4, updated_at=now() WHERE user_id=$1`,
    [p.user_id, m.w.balance, m.w.frozen, m.w.owed]);
  for (const e of m.entries)
    await client.query(
      `INSERT INTO seo_credit_ledger(user_id, purchase_id, kind, wallet_delta, frozen_delta, owed_delta, stripe_event_id, stripe_object_id, stripe_payment_intent)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.user_id, p.id, e.kind, e.wallet, e.frozen, e.owed, ids.eventId, ids.objectId, ids.pi ?? p.stripe_payment_intent]);
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await work(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Bring a pack's refunded share to `refundedOfCharge` of `chargeAmount` (both as Stripe says now). */
async function reconcileRefund(purchaseId: number, refundedOfCharge: number, chargeAmount: number, ids: Ids, kind: "refund" | "payment_failed") {
  return inTransaction(async (client) => {
    const { p, w } = await lock(client, purchaseId);
    const share = chargeAmount > 0 ? Math.round((p.cents * Math.min(refundedOfCharge, chargeAmount)) / chargeAmount) : 0;
    const target = Math.min(share, p.cents - p.disputed_lost_cents); // never take the same credit twice
    const delta = target - p.refunded_cents;
    if (delta === 0) return { userId: p.user_id, moved: 0 };
    const m = new WalletMoves(w);
    if (delta > 0) m.take(kind, delta);
    else m.give(`${kind}_reversed`, -delta);
    await write(client, p, m, ids);
    await client.query(`UPDATE seo_credit_purchases SET refunded_cents=$2, reversed_at=now() WHERE id=$1`, [p.id, target]);
    console.warn(`[seo] credit ${kind}: user ${p.user_id} purchase ${p.id} refunded share now ${target}c of ${p.cents}c (${delta > 0 ? "took back" : "gave back"} ${Math.abs(delta)}c)`);
    return { userId: p.user_id, moved: delta };
  });
}

/** Bring a pack's dispute to its state at Stripe now: open = on hold, won = released, lost = removed. */
async function reconcileDispute(purchaseId: number, dispute: { id: string; amount: number; status: string }, ids: Ids) {
  return inTransaction(async (client) => {
    const { p, w } = await lock(client, purchaseId);
    const { rows: [prev] } = await client.query(`SELECT * FROM seo_credit_disputes WHERE dispute_id=$1 FOR UPDATE`, [dispute.id]);
    const held = Number(prev?.held_cents ?? 0), lost = Number(prev?.lost_cents ?? 0);
    const disputed = Math.min(p.cents, Math.max(0, Math.round(dispute.amount)));
    const m = new WalletMoves(w);
    let nowHeld = held, nowLost = lost;
    if (lost > 0) {
      // Lost is final at Stripe; a later (stale) event changes nothing.
    } else if (OPEN_DISPUTE.has(dispute.status)) {
      if (held < disputed) nowHeld = held + m.hold("dispute_hold", disputed - held);
    } else if (dispute.status === "lost") {
      m.forfeit("dispute_lost", held);
      nowHeld = 0;
      nowLost = Math.max(0, Math.min(disputed, p.cents - p.refunded_cents));
      // The part that was not on hold (spent before the dispute) is taken now; held beyond what was lost goes back.
      if (nowLost >= held) m.take("dispute_lost", nowLost - held);
      else m.give("dispute_released", held - nowLost);
    } else {
      // won, warning_closed, prevented, or anything else that is over without the money leaving: release.
      m.release("dispute_released", held);
      nowHeld = 0;
    }
    await client.query(
      `INSERT INTO seo_credit_disputes(dispute_id, purchase_id, user_id, status, amount_cents, held_cents, lost_cents)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (dispute_id) DO UPDATE SET status=EXCLUDED.status, amount_cents=EXCLUDED.amount_cents, held_cents=EXCLUDED.held_cents, lost_cents=EXCLUDED.lost_cents, updated_at=now()`,
      [dispute.id, p.id, p.user_id, dispute.status, dispute.amount, nowHeld, nowLost]);
    await write(client, p, m, ids);
    if (nowLost !== lost) await client.query(`UPDATE seo_credit_purchases SET disputed_lost_cents=$2, reversed_at=now() WHERE id=$1`, [p.id, nowLost]);
    return { userId: p.user_id, opened: !prev, status: dispute.status, held: nowHeld, lost: nowLost, purchase: p };
  });
}

/**
 * The webhook's entry for the events above. Returns the account the event was about (null when it was not about an
 * SEO credit pack — a course refund, a subscription dispute — which is left to the rest of the webhook).
 */
export async function applySeoCreditEvent(event: { id: string; type: string; data: { object: any } }, stripe: ReversalStripe): Promise<{ userId: number | null }> {
  const o = event.data.object;
  if ((SEO_CREDIT_REFUND_EVENTS as readonly string[]).includes(event.type)) {
    const chargeId = event.type === "charge.refunded" ? idOf(o?.id) : idOf(o?.charge);
    if (!chargeId) return { userId: null };
    const charge = await stripe.charges.retrieve(chargeId); // as Stripe has it now, whatever order the events came in
    const pi = idOf(charge.payment_intent);
    const purchaseId = pi ? await purchaseIdFor(pi, stripe) : null;
    if (!purchaseId) return { userId: null };
    const r = await reconcileRefund(purchaseId, Number(charge.amount_refunded) || 0, Number(charge.amount) || 0, { eventId: event.id, objectId: idOf(o?.id), pi }, "refund");
    return { userId: r.userId };
  }
  if ((SEO_CREDIT_DISPUTE_EVENTS as readonly string[]).includes(event.type)) {
    const disputeId = idOf(o?.id);
    if (!disputeId) return { userId: null };
    const dispute = await stripe.disputes.retrieve(disputeId);
    let pi = idOf(dispute.payment_intent);
    if (!pi) {
      const chargeId = idOf(dispute.charge);
      pi = chargeId ? idOf((await stripe.charges.retrieve(chargeId)).payment_intent) : null;
    }
    const purchaseId = pi ? await purchaseIdFor(pi, stripe) : null;
    if (!purchaseId) return { userId: null };
    const r = await reconcileDispute(purchaseId, dispute, { eventId: event.id, objectId: disputeId, pi });
    // A dispute is money leaving and a fee: the team hears of it (the customer's balance already says what changed).
    void recordIssue({
      source: "server", severity: r.opened ? "critical" : "warning", key: `seo-credit-dispute:${disputeId}:${r.status}`,
      title: `SEO credit pack disputed (${r.status}): user ${r.userId}, purchase ${r.purchase.id}, ${(r.purchase.cents / 100).toFixed(2)} USD`,
      detail: { disputeId, paymentIntent: pi, userId: r.userId, purchaseId: r.purchase.id, status: r.status, heldCents: r.held, lostCents: r.lost, eventId: event.id },
    });
    return { userId: r.userId };
  }
  if ((SEO_CREDIT_FAILED_EVENTS as readonly string[]).includes(event.type)) {
    const sessionId = idOf(o?.id);
    if (!sessionId || o?.metadata?.type !== "seo_credits") return { userId: null };
    const { rows: [p] } = await pool.query(`SELECT id, cents FROM seo_credit_purchases WHERE stripe_session_id=$1`, [sessionId]);
    if (!p) return { userId: Number(o?.metadata?.userId) || null }; // the usual case: never credited, nothing to undo
    const r = await reconcileRefund(Number(p.id), Number(p.cents), Number(p.cents), { eventId: event.id, objectId: sessionId, pi: idOf(o?.payment_intent) }, "payment_failed");
    return { userId: r.userId };
  }
  return { userId: null };
}
