/**
 * The AI Call Assistant's own subscription (owner, 2026-10-08: a separate
 * service, bought with or without a platform plan): the order a request asks
 * for, how a Stripe subscription is read back and told apart from the platform
 * plan, the line items and in-place changes it gets, the row the webhook
 * writes, and the subscription state the entitlements read. Pure: a fake
 * price resolver stands in for Stripe and a recording pool for the database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const mocks = vi.hoisted(() => ({
  sql: [] as { text: string; values: any[] }[],
  /** What `SELECT * FROM call_assistant_subscriptions WHERE user_id` answers. */
  row: null as any,
  /** What the account lookups by subscription id / customer answer. */
  bySubscription: null as any,
  byCustomer: null as any,
}));
vi.mock("../db", () => {
  const query = vi.fn(async (text: string, values: any[] = []) => {
      if (/^\s*(CREATE (TABLE|INDEX)|ALTER TABLE)/.test(text)) return { rows: [] };
      // The account lock (server/billing/locks.ts) on a stand-in connection: its statements are not the writes under test.
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SELECT set_config|SELECT pg_advisory_xact_lock)/.test(text)) return { rows: [] };
      mocks.sql.push({ text, values });
      if (/FROM call_assistant_subscriptions WHERE user_id/.test(text)) return { rows: mocks.row ? [mocks.row] : [] };
      if (/FROM call_assistant_subscriptions WHERE stripe_subscription_id/.test(text)) return { rows: mocks.bySubscription ? [mocks.bySubscription] : [] };
      if (/FROM subscriptions WHERE stripe_customer_id/.test(text)) return { rows: mocks.byCustomer ? [mocks.byCustomer] : [] };
      if (/UPDATE call_assistant_subscriptions SET status = 'canceled'/.test(text)) return { rows: mocks.bySubscription ? [mocks.bySubscription] : [] };
      return { rows: [] };
  });
  return { pool: { query, connect: async () => ({ query, release() {} }) }, db: {} };
});
vi.mock("./number-release", () => ({ afterSubscriptionChange: vi.fn(async () => null), previewCallNumberReleases: async () => [] }));
// The ops issue a duplicate or a failed settlement records (server/ops/issues.ts): spied, never written.
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));

import {
  isCallAssistantSubscription, isCallAssistantCheckoutSession, parseCallAssistantOrder, describeCallAssistantSubscription,
  callAssistantLineItems, callAssistantChangeItems, callAssistantSummary, callAssistantPriceBook,
  applyCallAssistantSubscription, endCallAssistantSubscription, DuplicateSubscriptionError, CALL_ASSISTANT_PRODUCT, CALL_ASSISTANT_CHECKOUT_TYPE,
} from "./subscription";
import { callAssistantSubscriptionOf, joinedColumnsOf, NO_CALL_ASSISTANT, CALL_ASSISTANT_SUBSCRIPTION_DDL } from "./subscription-store";
import { BillingRequestError } from "../billing/order";
import { addonPriceSpec, type PriceSpec } from "../billing/prices";
import { ADDONS, CALL_ASSISTANT_TIERS } from "@shared/plans";

/** A subscription item on one of our prices (role metadata). */
const item = (id: string, priceId: string, quantity: number, role: { kind: string; key?: string }, interval = "month") =>
  ({ id, quantity, price: { id: priceId, recurring: { interval }, metadata: { chub_kind: role.kind, chub_key: role.key ?? "", chub_interval: interval } } }) as any;
const sub = (items: any[], extra: Record<string, unknown> = {}) =>
  ({ id: "sub_ca", customer: "cus_1", status: "active", metadata: {}, cancel_at_period_end: false, items: { data: items.map((i) => ({ current_period_end: 1893456000, ...i })) }, ...extra }) as any;
/** The transition reads the subscription from Stripe under the lock: here the snapshot stands in for Stripe unless a test says otherwise. */
const apply = (snapshot: any, hint: number | null = null, deps: Record<string, unknown> = {}) =>
  applyCallAssistantSubscription(snapshot, hint, { retrieve: async () => snapshot, ...deps });
/** A price resolver that answers with the spec's own lookup key, so every expectation reads the price book. */
const priceId = async (spec: PriceSpec) => `price_${spec.lookupKey}`;

beforeEach(() => { mocks.sql.length = 0; mocks.row = null; mocks.bySubscription = null; mocks.byCustomer = null; });

describe("telling the service's subscription apart from the platform plan's", () => {
  it("by the product mark, or by a tier line with no plan line beside it; a plan subscription that still carries a tier line stays the platform's", () => {
    expect(isCallAssistantSubscription(sub([], { metadata: { product: CALL_ASSISTANT_PRODUCT } }))).toBe(true);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "addon", key: "call_assistant_crew" })]))).toBe(true);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "addon", key: "call_assistant" }), item("si2", "p2", 2, { kind: "addon", key: "call_number" })]))).toBe(true);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "plan", key: "pro" }), item("si2", "p2", 1, { kind: "addon", key: "call_assistant" })]))).toBe(false);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "plan", key: "pro" })]))).toBe(false);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "addon", key: "call_number" })]))).toBe(false);
    expect(isCallAssistantSubscription(sub([item("si", "p", 1, { kind: "crm_plan", key: "crm_basic" })]))).toBe(false);
    expect(isCallAssistantSubscription(null)).toBe(false);
    expect(isCallAssistantCheckoutSession({ metadata: { type: CALL_ASSISTANT_CHECKOUT_TYPE } } as any)).toBe(true);
    expect(isCallAssistantCheckoutSession({ metadata: { type: "plan" } } as any)).toBe(false);
    expect(isCallAssistantCheckoutSession({ metadata: { type: "crm_plan" } } as any)).toBe(false);
  });
});

describe("the order a request asks for", () => {
  it("a tier by its key or its add-on key, monthly or yearly, extra numbers; the current subscription fills what a change leaves out", () => {
    expect(parseCallAssistantOrder({ tier: "crew", interval: "year", extraNumbers: 2 })).toEqual({ tier: "crew", interval: "year", extraNumbers: 2 });
    expect(parseCallAssistantOrder({ tier: "call_assistant_fleet" })).toEqual({ tier: "fleet", interval: "month", extraNumbers: 0 });
    expect(parseCallAssistantOrder({ addon: "call_assistant" })).toEqual({ tier: "solo", interval: "month", extraNumbers: 0 });
    expect(parseCallAssistantOrder({ extraNumbers: 3 }, { tier: "lite", interval: "year", extraNumbers: 1 })).toEqual({ tier: "lite", interval: "year", extraNumbers: 3 });
    expect(parseCallAssistantOrder({ tier: "solo" }, { tier: "lite", interval: "year", extraNumbers: 1 })).toEqual({ tier: "solo", interval: "year", extraNumbers: 1 });
  });

  it("refuses an unknown tier, interval or quantity before any Stripe call; more extra numbers than self-serve is a sales conversation; there is no tier above 5,000 minutes", () => {
    const refusal = (fn: () => void): any => { try { fn(); } catch (e) { return e; } return null; };
    for (const body of [{}, { tier: "mega" }, { tier: "call_number" }, { tier: "pro" }]) {
      const e = refusal(() => parseCallAssistantOrder(body));
      expect(e, JSON.stringify(body)).toBeInstanceOf(BillingRequestError);
      expect(e).toMatchObject({ status: 400, code: "unknown_tier" });
      expect(e.message).toContain("500 minutes, 1,000 minutes, 2,000 minutes, 5,000 minutes");
    }
    expect(refusal(() => parseCallAssistantOrder({ tier: "lite", interval: "week" }))).toMatchObject({ status: 400, code: "unknown_interval" });
    expect(refusal(() => parseCallAssistantOrder({ tier: "lite", extraNumbers: -1 }))).toMatchObject({ status: 400, code: "bad_quantity" });
    expect(refusal(() => parseCallAssistantOrder({ tier: "lite", extraNumbers: "2" }))).toMatchObject({ status: 400, code: "bad_quantity" });
    expect(refusal(() => parseCallAssistantOrder({ tier: "lite", extraNumbers: 101 }))).toMatchObject({ status: 409, code: "talk_to_sales" });
    expect(CALL_ASSISTANT_TIERS.map((t) => t.includedMinutes)).toEqual([500, 1000, 2000, 5000]);
  });
});

describe("reading a Stripe subscription back", () => {
  it("the tier, the interval, the extra numbers and the items that carry them", () => {
    const s = sub([item("si_t", "p_crew_y", 1, { kind: "addon", key: "call_assistant_crew" }, "year"), item("si_n", "p_num_y", 3, { kind: "addon", key: "call_number" }, "year"), item("si_x", "p_other", 1, { kind: "addon", key: "extra_seat" }, "year")]);
    const shape = describeCallAssistantSubscription(s);
    expect(shape.tier?.tier).toBe("crew");
    expect([shape.interval, shape.extraNumbers, shape.tierItem?.id, shape.numberItem?.id]).toEqual(["year", 3, "si_t", "si_n"]);
    const none = describeCallAssistantSubscription(sub([item("si_n", "p_num", 2, { kind: "addon", key: "call_number" })]));
    expect([none.tier, none.interval, none.extraNumbers, none.tierItem]).toEqual([null, "month", 2, null]);
    expect(describeCallAssistantSubscription(sub([])).interval).toBeNull();
  });
});

describe("what Stripe is asked for", () => {
  it("checkout line items: the tier's price for the interval, and the extra numbers if any — found by lookup key from the cents", async () => {
    expect(await callAssistantLineItems({ tier: "fleet", interval: "year", extraNumbers: 0 }, priceId)).toEqual([{ price: "price_chub_v1_addon_call_assistant_fleet_year_1098900", quantity: 1 }]);
    expect(await callAssistantLineItems({ tier: "lite", interval: "month", extraNumbers: 2 }, priceId)).toEqual([
      { price: "price_chub_v1_addon_call_assistant_lite_month_24900", quantity: 1 },
      { price: "price_chub_v1_addon_call_number_month_500", quantity: 2 },
    ]);
    expect(addonPriceSpec("call_number", "year").params.unit_amount).toBe(5000);
  });

  it("changes: the tier line re-priced in place (never a second tier), the number line added, re-quantified, re-priced or removed, an interval change moving every line", async () => {
    const tierItem = item("si_t", "price_chub_v1_addon_call_assistant_month_34900", 1, { kind: "addon", key: "call_assistant" });
    const numberItem = item("si_n", "price_chub_v1_addon_call_number_month_500", 2, { kind: "addon", key: "call_number" });
    const current = { tierItem, numberItem, extraNumbers: 2 };
    expect(await callAssistantChangeItems(current, { tier: "crew", interval: "month", extraNumbers: 2 }, priceId)).toEqual([
      { id: "si_t", price: "price_chub_v1_addon_call_assistant_crew_month_44900", quantity: 1 },
    ]);
    expect(await callAssistantChangeItems(current, { tier: "solo", interval: "month", extraNumbers: 2 }, priceId)).toEqual([]);
    expect(await callAssistantChangeItems(current, { tier: "solo", interval: "month", extraNumbers: 5 }, priceId)).toEqual([
      { id: "si_n", price: "price_chub_v1_addon_call_number_month_500", quantity: 5 },
    ]);
    expect(await callAssistantChangeItems(current, { tier: "solo", interval: "month", extraNumbers: 0 }, priceId)).toEqual([{ id: "si_n", deleted: true }]);
    expect(await callAssistantChangeItems(current, { tier: "solo", interval: "year", extraNumbers: 2 }, priceId)).toEqual([
      { id: "si_t", price: "price_chub_v1_addon_call_assistant_year_383900", quantity: 1 },
      { id: "si_n", price: "price_chub_v1_addon_call_number_year_5000", quantity: 2 },
    ]);
    expect(await callAssistantChangeItems({ tierItem, numberItem: null, extraNumbers: 0 }, { tier: "solo", interval: "month", extraNumbers: 1 }, priceId)).toEqual([
      { price: "price_chub_v1_addon_call_number_month_500", quantity: 1 },
    ]);
    expect(await callAssistantChangeItems({ tierItem: null, numberItem: null, extraNumbers: 0 }, { tier: "lite", interval: "month", extraNumbers: 0 }, priceId)).toEqual([
      { price: "price_chub_v1_addon_call_assistant_lite_month_24900", quantity: 1 },
    ]);
  });
});

describe("the row and what the client reads", () => {
  it("applies a Stripe subscription to the account's row: the tier and extras while live, none once ended; a late event for an older ended subscription never overwrites the live one", async () => {
    const live = sub([item("si_t", "p_solo", 1, { kind: "addon", key: "call_assistant" }), item("si_n", "p_num", 2, { kind: "addon", key: "call_number" })], { metadata: { userId: "7" }, cancel_at_period_end: true });
    expect(await apply(live)).toBe(7);
    const insert = mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!;
    expect(insert.values).toEqual([7, "cus_1", "sub_ca", "p_solo", "solo", 2, "active", "month", new Date(1893456000 * 1000), true]);
    // A recorded live subscription closes the checkout attempt that opened it, in the same transaction.
    expect(mocks.sql.some((q) => /UPDATE call_assistant_checkout_attempts SET state = 'done'/.test(q.text) && q.values[0] === 7)).toBe(true);

    mocks.sql.length = 0;
    const ended = sub([item("si_t", "p_solo", 1, { kind: "addon", key: "call_assistant" })], { status: "canceled", customer: "cus_1" });
    mocks.byCustomer = { user_id: 7 }; // no metadata: found by the Stripe customer
    expect(await apply(ended)).toBe(7);
    const endedInsert = mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!;
    expect(endedInsert.values.slice(4, 7)).toEqual([null, 0, "canceled"]);

    // The row tracks sub_live (active); a late "canceled" for sub_old changes nothing.
    mocks.sql.length = 0;
    mocks.row = { user_id: 7, stripe_subscription_id: "sub_live", status: "active" };
    const late = sub([item("si_t", "p_solo", 1, { kind: "addon", key: "call_assistant" })], { id: "sub_old", status: "canceled", metadata: { userId: "7" } });
    expect(await apply(late)).toBe(7);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);

    // Unknown account: nothing written, null back.
    mocks.row = null; mocks.byCustomer = null; mocks.sql.length = 0;
    expect(await apply(sub([], { customer: "cus_nobody" }))).toBeNull();
    expect(mocks.sql.some((q) => /INSERT INTO/.test(q.text))).toBe(false);

    // Ended by Stripe (customer.subscription.deleted, Stripe read under the lock): the tier goes, the history stays.
    mocks.sql.length = 0;
    mocks.bySubscription = { user_id: 7 };
    const gone = sub([item("si_t", "p_solo", 1, { kind: "addon", key: "call_assistant" })], { status: "canceled", metadata: { userId: "7" } });
    expect(await endCallAssistantSubscription({ id: "sub_ca" } as any, { retrieve: async () => gone })).toBe(7);
    expect(mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!.values.slice(2, 7)).toEqual(["sub_ca", "p_solo", null, 0, "canceled"]);
  });

  it("the summary, the price book and the DDL", () => {
    const row = { id: 1, user_id: 7, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_ca", stripe_price_id: "p", tier: "crew", extra_numbers: 2, status: "active", billing_interval: "year", current_period_end: null, cancel_at_period_end: false };
    expect(callAssistantSummary(row)).toMatchObject({ tier: "crew", tierName: "2,000 minutes", addon: "call_assistant_crew", status: "active", interval: "year", extraNumbers: 2, numbers: 4, minutes: 2000, addons: { call_assistant_crew: 1, call_number: 2 }, hasLiveSubscription: true });
    expect(callAssistantSummary({ ...row, status: "canceled", tier: null })).toMatchObject({ tier: null, tierName: null, extraNumbers: 0, numbers: 0, minutes: 0, addons: {}, hasLiveSubscription: false });
    expect(callAssistantSummary(undefined)).toMatchObject({ status: "inactive", hasLiveSubscription: false });
    const book = callAssistantPriceBook();
    expect(book).toMatchObject({ currency: "usd", overageCentsPerMinute: 50, freeSpamCalls: 500, annualMonths: 11, trialDays: 0, pricingHref: "/pricing#call-assistant", extraNumber: { monthlyCents: 500, annualCents: 5000, max: 100 } });
    expect(book.tiers).toBe(CALL_ASSISTANT_TIERS);
    for (const ddl of CALL_ASSISTANT_SUBSCRIPTION_DDL) expect(ddl).toMatch(/^(CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS call_assistant_|ALTER TABLE call_assistant_subscriptions ADD COLUMN IF NOT EXISTS)/);
  });

  it("the subscription state the entitlements read: the joined columns, a tier the price book doesn't know, no row at all", () => {
    expect(callAssistantSubscriptionOf({ call_assistant_tier: "fleet", call_assistant_status: "past_due", call_assistant_extra_numbers: "3", call_assistant_interval: "year", call_assistant_period_end: "2026-11-01T00:00:00Z", call_assistant_cancel_at_period_end: true, call_assistant_subscription_id: "sub_ca" }))
      .toEqual({ status: "past_due", tier: "fleet", extraNumbers: 3, addons: { call_assistant_fleet: 1, call_number: 3 }, interval: "year", currentPeriodEnd: new Date("2026-11-01T00:00:00Z"), cancelAtPeriodEnd: true, stripeSubscriptionId: "sub_ca" });
    // An unknown stored tier (a future key, a typo) grants nothing; extra numbers without a tier buy nothing.
    expect(callAssistantSubscriptionOf({ call_assistant_tier: "mega", call_assistant_status: "active", call_assistant_extra_numbers: 2 })).toMatchObject({ tier: null, addons: {}, extraNumbers: 2 });
    expect(callAssistantSubscriptionOf({ call_assistant_tier: null, call_assistant_status: "canceled" })).toMatchObject({ status: "canceled", tier: null, addons: {} });
    expect(callAssistantSubscriptionOf(null)).toBe(NO_CALL_ASSISTANT);
    expect(callAssistantSubscriptionOf({ call_assistant_status: null })).toBe(NO_CALL_ASSISTANT);
    expect(joinedColumnsOf(undefined)).toBeNull();
    expect(callAssistantSubscriptionOf(joinedColumnsOf({ id: 1, user_id: 7, stripe_customer_id: null, stripe_subscription_id: "s", stripe_price_id: null, tier: "lite", extra_numbers: 0, status: "active", billing_interval: "month", current_period_end: null, cancel_at_period_end: null })))
      .toMatchObject({ tier: "lite", status: "active", addons: { call_assistant_lite: 1 }, interval: "month", cancelAtPeriodEnd: null });
    expect(ADDONS.call_assistant_lite.name).toBe("AI Call Assistant — 500 minutes");
  });
});

describe("one live subscription per account, and the settlement a subscription's end owes (Codex audits 2026-10-09)", () => {
  const live = (id: string, extra: Record<string, unknown> = {}) =>
    sub([item("si_t", "p_solo", 1, { kind: "addon", key: "call_assistant" })], { id, status: "active", metadata: { userId: "7", product: CALL_ASSISTANT_PRODUCT }, ...extra });
  /** The duplicate's own row: written before the cancel, completed by its own id after it. */
  const duplicateRows = () => mocks.sql.filter((q) => /INSERT INTO call_assistant_duplicate_cancellations/.test(q.text)).map((q) => q.values);
  const duplicateDone = () => mocks.sql.filter((q) => /UPDATE call_assistant_duplicate_cancellations SET state = 'done'/.test(q.text)).map((q) => q.values);
  const duplicateFailed = () => mocks.sql.filter((q) => /UPDATE call_assistant_duplicate_cancellations SET attempts = attempts \+ 1, error = \$2/.test(q.text)).map((q) => q.values);

  it("a second LIVE subscription never replaces the tracked one: its own row first, then cancelled at Stripe (unused time credited) and completed by its own id, logged loudly; a stranger's is only noted", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.row = { user_id: 7, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live", status: "active" };
    const cancelled: string[] = [];
    const deps = { cancelDuplicate: async (id: string) => { cancelled.push(id); } };
    expect(await apply(live("sub_dup"), null, deps)).toBe(7);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(cancelled).toEqual(["sub_dup"]);
    // Its row (pending) BEFORE the cancel, done by its own id after it: a crash in between leaves the retry job its work.
    expect(duplicateRows()).toEqual([[7, "sub_live", "sub_dup", true, "pending"]]);
    expect(duplicateDone()).toEqual([["sub_dup"]]);
    expect(error.mock.calls.some((c) => /DUPLICATE live Call Assistant subscription for user 7: keeping sub_live, cancelling sub_dup/.test(String(c[0])))).toBe(true);
    // Not ours (no product mark, or another customer): kept out of the row, noted (skipped), not cancelled.
    cancelled.length = 0; error.mockClear(); mocks.sql.length = 0;
    expect(await apply(live("sub_other", { metadata: { userId: "7" } }), null, deps)).toBe(7);
    expect(await apply(live("sub_other2", { customer: "cus_2" }), null, deps)).toBe(7);
    expect(cancelled).toEqual([]);
    expect(duplicateRows()).toEqual([[7, "sub_live", "sub_other", false, "skipped"], [7, "sub_live", "sub_other2", false, "skipped"]]);
    expect(duplicateDone()).toEqual([]);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(error.mock.calls.filter((c) => /NOT cancelling \(not ours\)/.test(String(c[0])))).toHaveLength(2);
    // A cancel that fails is never swallowed: its row stays pending with the error, and the error is thrown so the webhook fails and Stripe retries it.
    mocks.sql.length = 0;
    const failed = await apply(live("sub_dup2"), null, { cancelDuplicate: async () => { throw new Error("stripe down"); } }).catch((e) => e);
    expect(failed).toBeInstanceOf(DuplicateSubscriptionError);
    expect(failed).toMatchObject({ userId: 7, duplicateId: "sub_dup2" });
    expect(duplicateRows()).toEqual([[7, "sub_live", "sub_dup2", true, "pending"]]);
    expect(duplicateFailed()).toEqual([["sub_dup2", "stripe down"]]);
    expect(duplicateDone()).toEqual([]);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(false);
    expect(error.mock.calls.some((c) => /could not cancel duplicate sub_dup2 \(its row stays pending for the retry\)/.test(String(c[0])))).toBe(true);
    // A late event for an older, ENDED subscription is still just ignored (no cancel, no row, no log).
    cancelled.length = 0; error.mockClear(); mocks.sql.length = 0;
    expect(await apply(live("sub_old", { status: "canceled" }), null, deps)).toBe(7);
    expect(cancelled).toEqual([]);
    expect(duplicateRows()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("every transition reads Stripe under the lock: an 'active' snapshot that waited behind a cancellation never restores access", async () => {
    mocks.row = { user_id: 7, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live", status: "active" };
    const staleActive = live("sub_live", { metadata: { userId: "7" } });
    const nowCanceled = live("sub_live", { status: "canceled", metadata: { userId: "7" } });
    expect(await applyCallAssistantSubscription(staleActive, null, { retrieve: async () => nowCanceled, settle: async () => {} })).toBe(7);
    const insert = mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!;
    expect(insert.values.slice(2, 7)).toEqual(["sub_live", "p_solo", null, 0, "canceled"]);
    // The reverse: a stale "canceled" when Stripe says active keeps the access.
    mocks.sql.length = 0;
    expect(await applyCallAssistantSubscription(nowCanceled, null, { retrieve: async () => staleActive })).toBe(7);
    expect(mocks.sql.find((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))!.values.slice(4, 7)).toEqual(["solo", 0, "active"]);
    expect(mocks.sql.some((q) => /INSERT INTO voice_settle_jobs/.test(q.text))).toBe(false);
  });

  it("the tracked subscription ending writes its settlement job in the SAME transaction as the end, then runs it; a settlement that fails is logged, the end stands", async () => {
    const settled: number[] = [];
    const deps = { settle: async (userId: number) => { settled.push(userId); mocks.sql.push({ text: "-- settle", values: [userId] }); } };
    mocks.row = { user_id: 7, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live", status: "active", billing_interval: "month" };
    mocks.bySubscription = { user_id: 7, status: "active" };
    const gone = live("sub_live", { status: "canceled", metadata: { userId: "7" } });
    expect(await endCallAssistantSubscription({ id: "sub_live" } as any, { ...deps, retrieve: async () => gone })).toBe(7);
    expect(settled).toEqual([7]);
    const texts = mocks.sql.map((q) => q.text);
    const job = texts.findIndex((t) => /INSERT INTO voice_settle_jobs/.test(t)), end = texts.findIndex((t) => /INSERT INTO call_assistant_subscriptions/.test(t)), run = texts.indexOf("-- settle");
    expect(job).toBeGreaterThanOrEqual(0);
    expect(job).toBeLessThan(end);
    expect(end).toBeLessThan(run);
    expect(mocks.sql[job].values).toEqual([7, "sub_live", "cus_1", "month"]);
    expect(mocks.sql[end].values.slice(4, 7)).toEqual([null, 0, "canceled"]);
    // customer.subscription.updated carrying the end: the same (unpaid is not an end: Stripe keeps the subscription — LIVE_STATUSES).
    for (const status of ["canceled", "incomplete_expired"]) {
      mocks.sql.length = 0; settled.length = 0;
      expect(await apply(live("sub_live", { status, metadata: { userId: "7" } }), null, deps)).toBe(7);
      expect(settled, status).toEqual([7]);
      expect(mocks.sql.some((q) => /INSERT INTO voice_settle_jobs/.test(q.text)), status).toBe(true);
    }
    for (const status of ["active", "past_due", "unpaid"]) {
      mocks.sql.length = 0; settled.length = 0;
      expect(await apply(live("sub_live", { status, metadata: { userId: "7" } }), null, deps)).toBe(7);
      expect(settled, status).toEqual([]);
      expect(mocks.sql.some((q) => /INSERT INTO voice_settle_jobs/.test(q.text)), status).toBe(false);
    }
    // A settlement that fails (Stripe down) is logged, the end is recorded, and the job row waits for the sweep.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sql.length = 0;
    expect(await apply(gone, null, { settle: async () => { throw new Error("stripe down"); } })).toBe(7);
    expect(mocks.sql.some((q) => /INSERT INTO voice_settle_jobs/.test(q.text))).toBe(true);
    expect(mocks.sql.some((q) => /INSERT INTO call_assistant_subscriptions/.test(q.text))).toBe(true);
    expect(error.mock.calls.some((c) => /settlement for user 7 after sub_live ended failed \(the sweep retries\)/.test(String(c[0])))).toBe(true);
  });
});
