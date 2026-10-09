/**
 * One live Call Assistant subscription per account under the REAL account lock
 * (server/billing/locks.ts, a Postgres advisory lock) against the development
 * lane DB: two subscription events for two live subscriptions arriving
 * together, the cancellation that fails, the retry job, and a stale "active"
 * snapshot that waited behind a cancellation. Stripe is a double (retrieve,
 * cancelDuplicate, retrieveStatus); nothing leaves the box. The row's user id
 * is a throwaway number (the table has no foreign key on it).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

// The ops issue a duplicate records (server/ops/issues.ts): spied, never written. The number-release decision is not under test.
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));
vi.mock("./number-release", () => ({ afterSubscriptionChange: vi.fn(async () => null), previewCallNumberReleases: async () => [] }));

import { pool } from "../db";
import { applyCallAssistantSubscription, retryDuplicateCancellations, DuplicateSubscriptionError, CALL_ASSISTANT_PRODUCT } from "./subscription";
import { callAssistantSchemaReady, callAssistantSubscriptionRow } from "./subscription-store";
/** The duplicate's own row (call_assistant_duplicate_cancellations). */
const duplicateRow = async (id: string) => (await pool.query("select duplicate_subscription_id, ours, state, attempts, error from call_assistant_duplicate_cancellations where duplicate_subscription_id = $1", [id])).rows[0];
import { listPendingVoiceSettlements, voiceOverageClaimsReady } from "./billing-usage";

/** A subscription item on the 1,000 minutes tier's price (role metadata), as Stripe hands it to the webhook. */
const tierItem = () => ({ id: `si_${randomUUID()}`, quantity: 1, current_period_end: 1893456000, price: { id: "price_solo", recurring: { interval: "month" }, metadata: { chub_kind: "addon", chub_key: "call_assistant", chub_interval: "month" } } });

describe("one live Call Assistant subscription per account, under the database lock (lane DB)", () => {
  // A throwaway account number far above any real user id.
  const userId = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  const customer = `cus_lock_${randomUUID()}`;
  /** What Stripe "has" for each subscription id: the transition reads it under the lock. */
  const stripeHas = new Map<string, any>();
  const live = (id: string, extra: Record<string, unknown> = {}) => {
    const s = { id, customer, status: "active", cancel_at_period_end: false, metadata: { userId: String(userId), product: CALL_ASSISTANT_PRODUCT }, items: { data: [tierItem()] }, ...extra } as any;
    stripeHas.set(id, s);
    return s;
  };
  const retrieve = async (id: string) => stripeHas.get(id);
  const row = () => callAssistantSubscriptionRow(userId);
  const apply = (snapshot: any, deps: Record<string, unknown> = {}) => applyCallAssistantSubscription(snapshot, null, { retrieve, settle: async () => {}, ...deps });

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    await callAssistantSchemaReady();
    await voiceOverageClaimsReady();
    await pool.query("delete from call_assistant_subscriptions where user_id = $1", [userId]);
    await pool.query("delete from voice_settle_jobs where account_user_id = $1", [userId]);
    await pool.query("delete from call_assistant_duplicate_cancellations where user_id = $1", [userId]);
  });
  afterAll(async () => {
    await pool.query("delete from call_assistant_subscriptions where user_id = $1", [userId]);
    await pool.query("delete from voice_settle_jobs where account_user_id = $1", [userId]);
    await pool.query("delete from call_assistant_duplicate_cancellations where user_id = $1", [userId]);
    await pool.end();
  });

  it("two live subscriptions arriving together: one is tracked, the other cancelled at Stripe — never both written, never neither", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cancelled: string[] = [];
    const deps = { cancelDuplicate: async (id: string) => { cancelled.push(id); } };
    const results = await Promise.all([apply(live("sub_a"), deps), apply(live("sub_b"), deps)]);
    expect(results).toEqual([userId, userId]);
    const r = (await row())!;
    expect(["sub_a", "sub_b"]).toContain(r.stripe_subscription_id);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).not.toBe(r.stripe_subscription_id);
    expect(r).toMatchObject({ status: "active", tier: "solo", stripe_customer_id: customer });
    expect(await duplicateRow(cancelled[0])).toMatchObject({ ours: true, state: "done", attempts: 1 });
    expect(error.mock.calls.some((c) => new RegExp(`DUPLICATE live Call Assistant subscription for user ${userId}: keeping ${r.stripe_subscription_id}, cancelling ${cancelled[0]}`).test(String(c[0])))).toBe(true);
    // The same two events again (Stripe retries, out of order): nothing changes, the duplicate is cancelled again.
    cancelled.length = 0;
    await Promise.all([apply(live("sub_b"), deps), apply(live("sub_a"), deps)]);
    expect((await row())!.stripe_subscription_id).toBe(r.stripe_subscription_id);
    expect(cancelled).toEqual([cancelled[0]]);
  });

  it("a cancellation that fails is remembered on the row and thrown (the webhook fails, Stripe retries); the retry job cancels it and clears the flag", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tracked = (await row())!.stripe_subscription_id;
    const failing = { cancelDuplicate: async () => { throw new Error("stripe down"); } };
    const err = await apply(live("sub_c"), failing).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateSubscriptionError);
    expect(err).toMatchObject({ userId, duplicateId: "sub_c" });
    expect(await row()).toMatchObject({ stripe_subscription_id: tracked, status: "active" });
    expect(await duplicateRow("sub_c")).toMatchObject({ ours: true, state: "pending", attempts: 1, error: "stripe down" });
    // A second duplicate arriving while the first is still pending gets its OWN row: nothing overwrites the first.
    const err2 = await apply(live("sub_d"), failing).catch((e) => e);
    expect(err2).toBeInstanceOf(DuplicateSubscriptionError);
    expect(await duplicateRow("sub_c")).toMatchObject({ state: "pending" });
    expect(await duplicateRow("sub_d")).toMatchObject({ state: "pending" });

    // The retry job (boot / every six hours): still live at Stripe → cancelled now; each row completed by its own id.
    const cancelled: string[] = [];
    const out = await retryDuplicateCancellations({ cancelDuplicate: async (id: string) => { cancelled.push(id); }, retrieveStatus: async () => "active" }, [userId]);
    expect(out).toEqual({ retried: 2, cancelled: 2, failed: 0 });
    expect(cancelled).toEqual(["sub_c", "sub_d"]);
    expect(await duplicateRow("sub_c")).toMatchObject({ state: "done", attempts: 2 });
    expect(await duplicateRow("sub_d")).toMatchObject({ state: "done" });
    expect(await retryDuplicateCancellations({ cancelDuplicate: async () => { throw new Error("never"); } }, [userId])).toEqual({ retried: 0, cancelled: 0, failed: 0 });

    // A retry that fails again keeps the row pending; one that finds the duplicate already ended at Stripe only marks it done.
    await pool.query("update call_assistant_duplicate_cancellations set state = 'pending' where duplicate_subscription_id = 'sub_c'");
    expect(await retryDuplicateCancellations({ cancelDuplicate: async () => { throw new Error("still down"); }, retrieveStatus: async () => "active" }, [userId])).toEqual({ retried: 1, cancelled: 0, failed: 1 });
    expect(await duplicateRow("sub_c")).toMatchObject({ state: "pending", error: "still down" });
    expect(await retryDuplicateCancellations({ cancelDuplicate: async () => { throw new Error("not asked"); }, retrieveStatus: async () => "canceled" }, [userId])).toEqual({ retried: 1, cancelled: 1, failed: 0 });
    expect(await duplicateRow("sub_c")).toMatchObject({ state: "done" });
  });

  it("a stale 'active' snapshot that waited behind a cancellation never restores access: Stripe is read under the lock; the end and its settlement job are one transaction", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tracked = (await row())!.stripe_subscription_id!;
    const activeSnapshot = { ...stripeHas.get(tracked) };
    // The cancellation lands at Stripe; two handlers race: the deletion, and an older "active" that queued behind it.
    stripeHas.set(tracked, { ...activeSnapshot, status: "canceled" });
    await Promise.all([apply({ ...activeSnapshot, status: "canceled" }), apply(activeSnapshot)]);
    const r = (await row())!;
    expect(r).toMatchObject({ stripe_subscription_id: tracked, status: "canceled", tier: null, extra_numbers: 0, stripe_customer_id: customer });
    expect((await listPendingVoiceSettlements(userId)).map((j) => [j.stripeSubscriptionId, j.stripeCustomerId, j.billingInterval, j.state])).toEqual([[tracked, customer, "month", "pending"]]);
    // Once more with the stale snapshot alone: still canceled, still one job.
    await apply(activeSnapshot);
    expect((await row())!.status).toBe("canceled");
    expect(await listPendingVoiceSettlements(userId)).toHaveLength(1);
  });
});
