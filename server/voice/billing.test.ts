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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  ADDONS, PLANS, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_MINUTE_OVERAGE_CENTS, CALL_NUMBER_MIN_DAYS,
  SALES_THRESHOLD_CENTS, ANNUAL_MONTHS, callAssistantTier, callAssistantTierOf, callAssistantIncluded,
} from "@shared/plans";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

// ── Part 1: pure ────────────────────────────────────────────────────────────

describe("Call Assistant price book: three tiers (owner, 2026-10-02)", () => {
  it("Solo / Crew / Fleet: prices, yearly prices, minutes, numbers; 10¢ overage and 500 free spam calls on every tier", () => {
    expect(CALL_ASSISTANT_TIERS.map((t) => [t.tier, t.addon, t.monthlyCents, t.annualCents, t.includedMinutes, t.includedNumbers])).toEqual([
      ["solo", "call_assistant", 24_900, 199_900, 2_000, 1],
      ["crew", "call_assistant_crew", 44_900, 359_900, 5_000, 3],
      ["fleet", "call_assistant_fleet", 79_900, 639_900, 12_000, 5],
    ]);
    // Owner: "yes we can charge 10 cents" … "all plans cover 500 spam calls that aren't charged".
    expect(CALL_MINUTE_OVERAGE_CENTS).toBe(10);
    expect(CALL_ASSISTANT_FREE_SPAM_CALLS).toBe(500);
    expect(CALL_NUMBER_MIN_DAYS).toBe(14);
    for (const t of CALL_ASSISTANT_TIERS) {
      const a = ADDONS[t.addon];
      // The add-on IS the tier: one source for checkout, Stripe prices and the pages.
      expect(a).toMatchObject({ key: t.addon, name: `AI Call Assistant — ${t.name}`, monthlyCents: t.monthlyCents, annualCents: t.annualCents,
        availableOn: ["pro", "growth", "agency"], preview: true, exclusiveGroup: "call_assistant_tier", grants: {} });
      // Each yearly price is its own number (not 10 × monthly); it shows despite the $1,000 sales threshold (add-on annuals are exempt).
      expect(a.annualCents).not.toBe(a.monthlyCents * ANNUAL_MONTHS);
      expect(a.monthlyCents).toBeLessThan(SALES_THRESHOLD_CENTS);
      expect(a.setupCents).toBeUndefined();
      // The description quotes the tier's own numbers and the shared rules.
      expect(a.description).toContain(`${t.includedMinutes.toLocaleString("en-US")} call minutes`);
      expect(a.description).toContain(`$${(CALL_MINUTE_OVERAGE_CENTS / 100).toFixed(2)} / minute`);
      expect(a.description).toContain(`${CALL_ASSISTANT_FREE_SPAM_CALLS} spam calls a month never count`);
    }
    // The intro is Solo only (monthly billing; server/billing/intro.ts).
    expect(ADDONS.call_assistant).toMatchObject({ introMonthlyCents: 9_900, introMonths: 3 });
    expect(ADDONS.call_assistant_crew.introMonthlyCents).toBeUndefined();
    expect(ADDONS.call_assistant_fleet.introMonthlyCents).toBeUndefined();
    expect(ADDONS.call_number).toMatchObject({ key: "call_number", monthlyCents: 500, preview: true });
    expect(ADDONS.call_number.requires).toEqual(["call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
    expect(ADDONS.call_number.annualCents).toBe(ADDONS.call_number.monthlyCents * ANNUAL_MONTHS);
  });

  it("the held tier: one per subscription; a legacy call_assistant row is Solo", () => {
    expect(callAssistantTierOf({ call_assistant: 1 })?.tier).toBe("solo");
    expect(callAssistantTierOf({ call_assistant_crew: 1, call_number: 2 })?.tier).toBe("crew");
    expect(callAssistantTierOf({ call_number: 2 })).toBeNull();
    expect(callAssistantIncluded({ call_assistant_fleet: 1 })).toMatchObject({ numbers: 5, minutes: 12_000 });
    expect(callAssistantIncluded({})).toMatchObject({ tier: null, numbers: 0, minutes: 0 });
    expect(callAssistantTier("crew").name).toBe("Crew");
  });

  it("buys through the existing add-on checkout once preview is lifted: plan, requires, exclusivity and preview rules", async () => {
    const { checkAddonsForPlan, mergeAddonRequest } = await import("../billing/order");
    // While in preview: refused, nothing charged — every tier.
    for (const t of CALL_ASSISTANT_TIERS) expect(() => checkAddonsForPlan("pro", { [t.addon]: 1 })).toThrow(/isn't available yet/);
    const keys = ["call_assistant", "call_assistant_crew", "call_assistant_fleet", "call_number"] as const;
    const saved = keys.map((k) => ADDONS[k].preview);
    try {
      for (const k of keys) delete ADDONS[k].preview;
      for (const plan of ["pro", "growth", "agency"] as const) {
        for (const t of CALL_ASSISTANT_TIERS) {
          expect(() => checkAddonsForPlan(plan, { [t.addon]: 1 })).not.toThrow();
          expect(() => checkAddonsForPlan(plan, { [t.addon]: 1, call_number: 2 })).not.toThrow();
        }
      }
      expect(() => checkAddonsForPlan("starter", { call_assistant_crew: 1 })).toThrow(/isn't available on the Starter plan/);
      expect(() => checkAddonsForPlan("pro", { call_number: 1 })).toThrow(/needs one of these add-ons/);
      // Exactly one tier, one unit.
      expect(() => checkAddonsForPlan("pro", { call_assistant: 1, call_assistant_crew: 1 })).toThrow(/can't both be on one subscription/);
      expect(() => checkAddonsForPlan("pro", { call_assistant_fleet: 2 })).toThrow(/one per subscription/);
      // Asking for another tier is a switch: the held one goes to 0 in the same change.
      expect(mergeAddonRequest({ call_assistant: 1, call_number: 2 }, { call_assistant_crew: 1 }))
        .toEqual({ call_assistant: 0, call_assistant_fleet: 0, call_assistant_crew: 1, call_number: 2 });
      // Removing a tier switches nothing on; naming two tiers is refused, not guessed.
      expect(mergeAddonRequest({ call_assistant_crew: 1 }, { call_assistant_crew: 0 })).toEqual({ call_assistant_crew: 0 });
      expect(mergeAddonRequest({ call_assistant: 1 }, { call_assistant: 1, call_assistant_fleet: 1 })).toMatchObject({ call_assistant: 1, call_assistant_fleet: 1 });
      // The Stripe price is the standard add-on spec (lookup key spells the price); Solo keeps the original key.
      const { addonPriceSpec } = await import("../billing/prices");
      expect(addonPriceSpec("call_assistant", "month").lookupKey).toBe("chub_v1_addon_call_assistant_month_24900");
      expect(addonPriceSpec("call_assistant_crew", "year").lookupKey).toBe("chub_v1_addon_call_assistant_crew_year_359900");
      expect(addonPriceSpec("call_assistant_fleet", "month").lookupKey).toBe("chub_v1_addon_call_assistant_fleet_month_79900");
      expect(addonPriceSpec("call_number", "year").lookupKey).toBe("chub_v1_addon_call_number_year_5000");
    } finally {
      keys.forEach((k, i) => { ADDONS[k].preview = saved[i]; });
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
    // The spam call's minute is free (the first of the month's 500); the blocked one costs nothing at all.
    expect(after).toMatchObject({ month: MONTH, calls: 3, minutes: 2, spamCalls: 1, blockedCalls: 1, spamFreeCalls: 1, spamFreeMinutes: 1, includedMinutes: 2000, overageMinutes: 0 });
    // Concurrent end-of-call reports never lose a count.
    await Promise.all(Array.from({ length: 10 }, () => usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 2, at: AT })));
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 13, minutes: 22 });
    // An account without the add-on still has its calls counted, all as overage (nothing included).
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: unpaid, outcome: "info", durationSeconds: 120, at: AT })).toMatchObject({ includedMinutes: 0, minutes: 2, overageMinutes: 2 });
  });

  it("spam calls: their minutes don't count toward the included minutes or overage up to the free allowance, then count normally", async () => {
    const o = org();
    // A small allowance (3) stands in for the 500 so the boundary is cheap to cross; the default is the price book's.
    const rec = (outcome: string, billedMinutes: number, free = 3) => usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome, billedMinutes, at: AT }, undefined, free);
    await rec("spam", 2);
    await rec("spam", 0); // a 0-minute spam call uses none of the allowance
    await rec("blocked", 9); // blocked: rejected before answering, 0 minutes, never uses the allowance
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 3, minutes: 0, spamCalls: 2, blockedCalls: 1, spamFreeCalls: 1, spamFreeMinutes: 2 });
    await rec("spam", 1);
    await rec("spam", 4);
    // The allowance (3) is used up: the next spam calls count like any call.
    await rec("spam", 5);
    const row = await rec("spam", 6);
    expect(row).toMatchObject({ spamCalls: 6, spamFreeCalls: 3, spamFreeMinutes: 7, minutes: 11 });
    const s = usage.summarizeVoiceUsage(row, MONTH, 2000);
    expect(s).toMatchObject({ minutes: 11, spamCallsThisMonth: 7, freeSpamCalls: 3, freeSpamMinutes: 7, freeSpamCallsLimit: CALL_ASSISTANT_FREE_SPAM_CALLS });

    // Over the included minutes: free spam minutes never become overage; past the allowance they do.
    const o2 = org();
    const rec2 = (outcome: string, billedMinutes: number) => usage.recordVoiceCallUsage({ orgId: o2, accountUserId: payer, outcome, billedMinutes, at: AT }, undefined, 2);
    await rec2("lead_submitted", 2000);
    await rec2("spam", 30);
    expect(await usage.getVoiceUsageRow(o2, MONTH)).toMatchObject({ minutes: 2000, overageMinutes: 0, spamFreeMinutes: 30 });
    await rec2("spam", 30);
    const over = await rec2("spam", 7);
    expect(over).toMatchObject({ minutes: 2007, overageMinutes: 7, spamFreeCalls: 2, spamFreeMinutes: 60 });

    // Concurrent spam calls at the boundary never hand out more free calls than the allowance.
    const o3 = org();
    await Promise.all(Array.from({ length: 8 }, () => usage.recordVoiceCallUsage({ orgId: o3, accountUserId: payer, outcome: "spam", billedMinutes: 1, at: AT }, undefined, 5)));
    expect(await usage.getVoiceUsageRow(o3, MONTH)).toMatchObject({ calls: 8, spamFreeCalls: 5, minutes: 3 });

    // The default allowance is the price book's 500.
    const o4 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "spam", billedMinutes: 3, at: AT })).toMatchObject({ minutes: 0, spamFreeCalls: 1 });
    await db.query("update voice_usage set spam_free_calls = $2 where org_id = $1 and month = $3", [o4, CALL_ASSISTANT_FREE_SPAM_CALLS, MONTH]);
    expect(await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "spam", billedMinutes: 3, at: AT })).toMatchObject({ minutes: 3, spamFreeCalls: CALL_ASSISTANT_FREE_SPAM_CALLS });
    // A new month starts the allowance over.
    expect(await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "spam", billedMinutes: 3, at: new Date("2001-02-01T00:00:00Z") })).toMatchObject({ month: "2001-02", minutes: 0, spamFreeCalls: 1 });
  });

  it("the included minutes follow the held tier", async () => {
    const crew = await user({ call_assistant_crew: 1 });
    const fleet = await user({ call_assistant_fleet: 1, call_number: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: org(), accountUserId: crew, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: 5000 });
    expect(await usage.recordVoiceCallUsage({ orgId: org(), accountUserId: fleet, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: 12_000 });
  });

  it("overage: monthly subscription → one invoice item on the subscription, only the new minutes, idempotent", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: 1998, at: AT });
    const row = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: 5, at: AT });
    expect(row).toMatchObject({ minutes: 2003, includedMinutes: 2000, overageMinutes: 3, overageReportedMinutes: 0 });

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
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 2010, at: AT });
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

  it("the sweep bills every org with unreported overage in the month and reports what it skipped", async () => {
    // Its own month so the other tests' rows don't count.
    const month = "2001-02", at = new Date("2001-02-10T00:00:00Z");
    const billed = org(), skipped = org();
    await usage.recordVoiceCallUsage({ orgId: billed, accountUserId: payer, outcome: "info", billedMinutes: 2002, at });
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
