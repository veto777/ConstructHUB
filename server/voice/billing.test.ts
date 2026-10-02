/**
 * Call Assistant billing (numbers+billing lane): the price-book block, the
 * voice_usage meter and overage billing.
 *
 * Part 1 is pure (the price book, the add-on checkout rules with `preview`
 * lifted in-process, the minute maths). Part 2 runs the meter against the
 * development lane DB (rows in the year 2001, so nothing real is touched) and
 * bills overage through a FAKE Stripe that records every call — nothing
 * leaves the box.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  ADDONS, PLANS, CALL_ASSISTANT_INCLUDED_MINUTES, CALL_ASSISTANT_INCLUDED_NUMBERS, CALL_MINUTE_OVERAGE_CENTS, CALL_NUMBER_MIN_DAYS,
  SALES_THRESHOLD_CENTS, ANNUAL_MONTHS,
} from "@shared/plans";

// Throwaway "p-voice-admin-…@example.invalid" accounts count as platform admins (the real ADMIN_EMAILS are never used).
vi.mock("../admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../admin")>();
  const testAdmin = (email?: string | null) => !!email && /^p-voice-admin-.*@example\.invalid$/i.test(email);
  return { ...real, isPlatformAdminEmail: (email?: string | null) => real.isPlatformAdminEmail(email) || testAdmin(email), isPlatformAdmin: (user: any) => real.isPlatformAdmin(user) || testAdmin(user?.email) };
});

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

// ── Part 1: pure ────────────────────────────────────────────────────────────

describe("Call Assistant price book (PLACEHOLDER pricing, owner to confirm)", () => {
  it("call_assistant and call_number are the add-ons the SPEC names, still in preview, never a sales-only price", () => {
    expect(ADDONS.call_assistant).toMatchObject({ key: "call_assistant", monthlyCents: 24_900, availableOn: ["pro", "growth", "agency"], preview: true });
    // Owner, 2026-10-02: "annually price can be $1999" — the add-on's own annual price; it shows
    // (add-on annual prices are exempt from the sales threshold, like plan annual prices).
    expect(ADDONS.call_assistant.annualCents).toBe(199_900);
    expect(ADDONS.call_number).toMatchObject({ key: "call_number", monthlyCents: 500, requires: "call_assistant", preview: true });
    expect(ADDONS.call_number.annualCents).toBe(ADDONS.call_number.monthlyCents * ANNUAL_MONTHS);
    for (const a of [ADDONS.call_assistant, ADDONS.call_number]) {
      expect(a.setupCents ?? 0).toBeLessThan(SALES_THRESHOLD_CENTS);
      expect(a.availableOn).not.toContain("starter");
    }
    expect([CALL_ASSISTANT_INCLUDED_MINUTES, CALL_ASSISTANT_INCLUDED_NUMBERS, CALL_MINUTE_OVERAGE_CENTS, CALL_NUMBER_MIN_DAYS]).toEqual([500, 1, 15, 14]);
    // The description quotes the same numbers the constants hold.
    expect(ADDONS.call_assistant.description).toContain(`${CALL_ASSISTANT_INCLUDED_MINUTES} call minutes`);
    expect(ADDONS.call_assistant.description).toContain(`$${(CALL_MINUTE_OVERAGE_CENTS / 100).toFixed(2)} / minute`);
  });

  it("buys through the existing add-on checkout once preview is lifted: plan, requires and preview rules", async () => {
    const { checkAddonsForPlan } = await import("../billing/order");
    // While in preview: refused, nothing charged.
    expect(() => checkAddonsForPlan("pro", { call_assistant: 1 })).toThrow(/isn't available yet/);
    const saved = [ADDONS.call_assistant.preview, ADDONS.call_number.preview];
    try {
      delete ADDONS.call_assistant.preview;
      delete ADDONS.call_number.preview;
      for (const plan of ["pro", "growth", "agency"] as const) {
        expect(() => checkAddonsForPlan(plan, { call_assistant: 1 })).not.toThrow();
        expect(() => checkAddonsForPlan(plan, { call_assistant: 1, call_number: 2 })).not.toThrow();
      }
      expect(() => checkAddonsForPlan("starter", { call_assistant: 1 })).toThrow(/isn't available on the Starter plan/);
      expect(() => checkAddonsForPlan("pro", { call_number: 1 })).toThrow(/needs the AI Call Assistant add-on/);
      // The Stripe price is the standard add-on spec (lookup key spells the price).
      const { addonPriceSpec } = await import("../billing/prices");
      expect(addonPriceSpec("call_assistant", "month").lookupKey).toBe("chub_v1_addon_call_assistant_month_24900");
      expect(addonPriceSpec("call_number", "year").lookupKey).toBe("chub_v1_addon_call_number_year_5000");
    } finally {
      ADDONS.call_assistant.preview = saved[0];
      ADDONS.call_number.preview = saved[1];
    }
    expect(PLANS.pro.name).toBeTruthy();
  });

  it("minute maths: every started minute bills, blocked calls cost nothing, the summary never goes negative", async () => {
    const u = await import("./billing-usage");
    expect([0, 1, 59, 60, 61, 600].map(u.billedMinutesFor)).toEqual([0, 1, 1, 1, 2, 10]);
    expect(u.billedMinutesFor(null)).toBe(0);
    expect(u.billedMinutesFor(-5)).toBe(0);
    expect(u.voiceMonthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(u.voiceResetsAt(new Date("2026-12-15T00:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
    expect(u.previousVoiceMonth(new Date("2026-01-01T03:00:00Z"))).toBe("2025-12");
    expect(u.summarizeVoiceUsage(null, "2026-10", 500)).toMatchObject({ calls: 0, minutes: 0, includedMinutes: 500, remainingMinutes: 500, overageMinutes: 0, overageCents: 0, resetsAt: "2026-11-01T00:00:00.000Z" });
    expect(u.summarizeVoiceUsage({ minutes: 530, calls: 9, includedMinutes: 500, overageReportedMinutes: 10 }, "2026-10", 500))
      .toMatchObject({ remainingMinutes: 0, overageMinutes: 30, overageCents: 30 * CALL_MINUTE_OVERAGE_CENTS, overageReportedMinutes: 10 });
    // A second unit bought mid-month raises what's included; a cancelled one never lowers what the month already granted.
    expect(u.summarizeVoiceUsage({ minutes: 530, includedMinutes: 500 }, "2026-10", 1000).overageMinutes).toBe(0);
    expect(u.summarizeVoiceUsage({ minutes: 530, includedMinutes: 500 }, "2026-10", 0).overageMinutes).toBe(30);
    expect(u.voiceOverageLookupKey()).toBe(`chub_v1_meter_call_minutes_${CALL_MINUTE_OVERAGE_CENTS}`);
  });

  it("unlimited minutes (-1, platform admins): never overage, nothing counting down", async () => {
    const u = await import("./billing-usage");
    expect(u.summarizeVoiceUsage({ minutes: 9_000, includedMinutes: -1 }, "2026-10", -1))
      .toMatchObject({ minutes: 9_000, includedMinutes: -1, remainingMinutes: -1, overageMinutes: 0, overageCents: 0 });
    expect(u.summarizeVoiceUsage(null, "2026-10", -1)).toMatchObject({ includedMinutes: -1, remainingMinutes: -1, overageMinutes: 0 });
    // A month that was unlimited stays unlimited (the snapshot only ever grows), even if the allowance is read lower later.
    expect(u.summarizeVoiceUsage({ minutes: 900, includedMinutes: -1 }, "2026-10", 500)).toMatchObject({ includedMinutes: -1, overageMinutes: 0 });
  });

  it("the overage sweep only runs in production with Stripe and the explicit switch", async () => {
    const { voiceOverageWorkerOffReason } = await import("./billing-usage");
    expect(voiceOverageWorkerOffReason({} as any)).toMatch(/VOICE_OVERAGE_WORKER_ENABLED/);
    expect(voiceOverageWorkerOffReason({ VOICE_OVERAGE_WORKER_ENABLED: "true", NODE_ENV: "production" } as any)).toMatch(/STRIPE_SECRET_KEY/);
    expect(voiceOverageWorkerOffReason({ VOICE_OVERAGE_WORKER_ENABLED: "true", STRIPE_SECRET_KEY: "sk", NODE_ENV: "development" } as any)).toMatch(/not a production/);
    expect(voiceOverageWorkerOffReason({ VOICE_OVERAGE_WORKER_ENABLED: "true", STRIPE_SECRET_KEY: "sk", NODE_ENV: "production" } as any)).toBeNull();
  });
});

// ── Part 2: the meter and overage billing on the lane DB ────────────────────

type Call = { method: string; params: Record<string, any>; opts?: { idempotencyKey?: string } };
function fakeStripe(existingPrice: string | null = null) {
  const calls: Call[] = [];
  let n = 0;
  const stripe = {
    prices: {
      list: async (params: any) => { calls.push({ method: "prices.list", params }); return { data: existingPrice ? [{ id: existingPrice, unit_amount: CALL_MINUTE_OVERAGE_CENTS, currency: "usd" }] : [] }; },
      create: async (params: any, opts?: any) => { calls.push({ method: "prices.create", params, opts }); return { id: "price_fake_overage" }; },
    },
    invoiceItems: { create: async (params: any, opts?: any) => { calls.push({ method: "invoiceItems.create", params, opts }); return { id: `ii_fake_${++n}` }; } },
    invoices: { create: async (params: any, opts?: any) => { calls.push({ method: "invoices.create", params, opts }); return { id: `in_fake_${n}` }; } },
  };
  return { stripe, calls };
}

describe("voice_usage meter + overage billing (lane DB, fake Stripe)", () => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const MONTH = "2001-01";
  const AT = new Date("2001-01-15T12:00:00Z");
  const users: number[] = [];
  const orgs: string[] = [];
  let usage: typeof import("./billing-usage");
  let payer = 0, unpaid = 0;

  async function user(addons: Record<string, number>, plan = "pro"): Promise<number> {
    const { rows: [u] } = await db.query("insert into users(email,display_name,email_verified) values($1,'P-Voice billing',true) returning id", [`p-voice-billing-${randomUUID()}@example.invalid`]);
    users.push(u.id);
    await db.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id,stripe_customer_id,addons,billing_interval) values($1,$2,'active',$3,$4,$5,'month')",
      [u.id, plan, `sub_p_${randomUUID()}`, `cus_p_${randomUUID()}`, JSON.stringify(addons)]);
    return u.id;
  }

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    const { ensureVoiceSchema } = await import("./schema");
    const { pool } = await import("../db");
    await ensureVoiceSchema(pool);
    usage = await import("./billing-usage");
    payer = await user({ call_assistant: 1 });
    unpaid = await user({});
  });
  afterAll(async () => {
    await db.query("delete from voice_usage where org_id=any($1::text[])", [orgs]);
    await db.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await db.query("delete from users where id=any($1::int[])", [users]);
    await db.end();
    const { pool } = await import("../db");
    await pool.end();
  });
  const org = () => { const id = `test-voice-billing-${randomUUID()}`; orgs.push(id); return id; };

  it("counts calls, minutes, spam and blocked calls atomically, with the included-minutes snapshot", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", durationSeconds: 61, at: AT });
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "spam", durationSeconds: 20, at: AT });
    const after = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "blocked", durationSeconds: 300, at: AT });
    expect(after).toMatchObject({ month: MONTH, calls: 3, minutes: 3, spamCalls: 1, blockedCalls: 1, includedMinutes: 500, overageMinutes: 0 });
    // Concurrent end-of-call reports never lose a count.
    await Promise.all(Array.from({ length: 10 }, () => usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 2, at: AT })));
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 13, minutes: 23 });
    // An account without the add-on still has its calls counted, all as overage (nothing included).
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: unpaid, outcome: "info", durationSeconds: 120, at: AT })).toMatchObject({ includedMinutes: 0, minutes: 2, overageMinutes: 2 });
  });

  it("overage: monthly subscription → one invoice item on the subscription, only the new minutes, idempotent", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: 498, at: AT });
    const row = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: 5, at: AT });
    expect(row).toMatchObject({ minutes: 503, includedMinutes: 500, overageMinutes: 3, overageReportedMinutes: 0 });

    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe();
    const sub = { stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x", status: "active", billingInterval: "month" };
    const deps = { stripe, configured: () => true, subscriptionFor: async () => sub };
    const out = await usage.reportVoiceOverage(o, MONTH, deps);
    expect(out).toEqual({ reported: 3, invoiceItemId: "ii_fake_1", invoiceId: null });
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "prices.create", "invoiceItems.create"]);
    expect(calls[1].params).toMatchObject({ currency: "usd", unit_amount: CALL_MINUTE_OVERAGE_CENTS, lookup_key: usage.voiceOverageLookupKey() });
    expect(calls[1].params.recurring).toBeUndefined();
    expect(calls[2].params).toMatchObject({ customer: "cus_x", subscription: "sub_x", pricing: { price: "price_fake_overage" }, quantity: 3 });
    expect(calls[2].params.price).toBeUndefined(); // stripe-node 20 takes pricing.price, not price
    expect(calls[2].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-3`);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 3, stripeUsageRecordId: "ii_fake_1" });

    // Again: nothing new, nothing sent.
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    // A late call in the same month: only its minutes, under a new key; the price is cached.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 4, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 4 });
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.create"]);
    expect(calls[0].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-7`);
  });

  it("overage: annual subscription → unattached item invoiced now; no Stripe / no live subscription → nothing billed, minutes kept", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 510, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");

    expect(await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => false })).toEqual({ reported: 0, reason: "stripe_unconfigured" });
    expect(await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_y", stripeSubscriptionId: "sub_y", status: "canceled", billingInterval: "year" }) }))
      .toEqual({ reported: 0, reason: "no_live_subscription" });
    expect(calls).toHaveLength(0);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageMinutes: 10, overageReportedMinutes: 0 });

    const out = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_y", stripeSubscriptionId: "sub_y", status: "active", billingInterval: "year" }) });
    expect(out).toMatchObject({ reported: 10, invoiceId: "in_fake_1" });
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "invoiceItems.create", "invoices.create"]);
    expect(calls[1].params.subscription).toBeUndefined();
    expect(calls[1].params.pricing).toEqual({ price: "price_existing" });
    expect(calls[2].params).toMatchObject({ customer: "cus_y", pending_invoice_items_behavior: "include", auto_advance: true });
  });

  it("a platform admin's minutes are unlimited: recorded, never overage, never billed", async () => {
    const { rows: [u] } = await db.query("insert into users(email,display_name,email_verified) values($1,'P-Voice admin',true) returning id", [`p-voice-admin-${randomUUID()}@example.invalid`]);
    users.push(u.id);
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: u.id, outcome: "lead_submitted", billedMinutes: 600, at: AT });
    const row = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: u.id, outcome: "info", billedMinutes: 400, at: AT });
    expect(row).toMatchObject({ calls: 2, minutes: 1000, includedMinutes: -1, overageMinutes: 0 });
    const { stripe, calls } = fakeStripe();
    const out = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x", status: "active", billingInterval: "month" }) });
    expect(out).toEqual({ reported: 0, reason: "nothing_to_report" });
    expect(calls).toEqual([]);
    // A customer on the same month is unchanged: past the included 500, the rest is overage.
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: payer, outcome: "info", billedMinutes: 1000, at: AT }))
      .toMatchObject({ includedMinutes: 500, overageMinutes: 500 });
  });

  it("the sweep bills every org with unreported overage in the month and reports what it skipped", async () => {
    // Its own month so the other tests' rows don't count.
    const month = "2001-02", at = new Date("2001-02-10T00:00:00Z");
    const billed = org(), skipped = org();
    await usage.recordVoiceCallUsage({ orgId: billed, accountUserId: payer, outcome: "info", billedMinutes: 502, at });
    await usage.recordVoiceCallUsage({ orgId: skipped, accountUserId: unpaid, outcome: "info", billedMinutes: 1, at });
    usage.resetVoiceOveragePriceCache();
    const { stripe } = fakeStripe("price_existing");
    const out = await usage.reportAllVoiceOverage(month, {
      stripe, configured: () => true,
      subscriptionFor: async (id) => (id === payer ? { stripeCustomerId: "cus_z", stripeSubscriptionId: "sub_z", status: "active", billingInterval: "month" } : null),
    });
    expect(out).toEqual({ month, orgs: 1, reportedMinutes: 2, skipped: { no_live_subscription: 1 } });
  });
});
