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
  ADDONS, PLANS, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, CALL_ASSISTANT_OVERAGE_RATES, CALL_NUMBER_MIN_DAYS,
  SALES_THRESHOLD_CENTS, ANNUAL_MONTHS, callAssistantTier, callAssistantTierOf, callAssistantIncluded,
} from "@shared/plans";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

// ── Part 1: pure ────────────────────────────────────────────────────────────

describe("Call Assistant price book: four tiers (owner, 2026-10-02)", () => {
  it("Lite / Solo / Crew / Fleet: prices, yearly prices, minutes, numbers, per-tier overage; 500 free spam calls on every tier", () => {
    expect(CALL_ASSISTANT_TIERS.map((t) => [t.tier, t.addon, t.monthlyCents, t.annualCents, t.includedMinutes, t.includedNumbers, t.overageCentsPerMinute])).toEqual([
      // Owner: "lets do 1000 min for $149 a month so 4 tiers instead of 3".
      ["lite", "call_assistant_lite", 14_900, 119_900, 1_000, 1, 10],
      ["solo", "call_assistant", 24_900, 199_900, 2_000, 1, 10],
      // Owner: "for the crew and fleet the cost per minute is 5 not 10 cents for overages".
      ["crew", "call_assistant_crew", 44_900, 359_900, 5_000, 5, 5],
      ["fleet", "call_assistant_fleet", 79_900, 639_900, 12_000, 20, 5],
    ]);
    // Cheapest first: the order is the upgrade order.
    for (let i = 1; i < CALL_ASSISTANT_TIERS.length; i++) {
      expect(CALL_ASSISTANT_TIERS[i].monthlyCents).toBeGreaterThan(CALL_ASSISTANT_TIERS[i - 1].monthlyCents);
      expect(CALL_ASSISTANT_TIERS[i].includedMinutes).toBeGreaterThan(CALL_ASSISTANT_TIERS[i - 1].includedMinutes);
      expect(CALL_ASSISTANT_TIERS[i].overageCentsPerMinute).toBeLessThanOrEqual(CALL_ASSISTANT_TIERS[i - 1].overageCentsPerMinute);
    }
    expect(CALL_ASSISTANT_OVERAGE_RATES).toEqual([10, 5]);
    // No tier held at a call (a platform admin on Solo's allowance): Solo's rate.
    expect(CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS).toBe(10);
    // Owner: "all plans cover 500 spam calls that aren't charged".
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
      expect(a.description).toContain(`$${(t.overageCentsPerMinute / 100).toFixed(2)} / minute`);
      expect(a.description).toContain(`the first ${CALL_ASSISTANT_FREE_SPAM_CALLS} spam calls each month never count`);
    }
    expect(ADDONS.call_assistant_crew.description).toContain("then $0.05 / minute");
    expect(ADDONS.call_assistant_lite.description).toContain("then $0.10 / minute");
    // The intro is Solo only (monthly billing; server/billing/intro.ts) — not Lite, Crew or Fleet.
    expect(ADDONS.call_assistant).toMatchObject({ introMonthlyCents: 9_900, introMonths: 3 });
    expect(ADDONS.call_assistant_lite.introMonthlyCents).toBeUndefined();
    expect(CALL_ASSISTANT_TIERS.filter((t) => t.introMonthlyCents).map((t) => t.tier)).toEqual(["solo"]);
    expect(ADDONS.call_assistant_crew.introMonthlyCents).toBeUndefined();
    expect(ADDONS.call_assistant_fleet.introMonthlyCents).toBeUndefined();
    expect(ADDONS.call_number).toMatchObject({ key: "call_number", monthlyCents: 500, preview: true });
    expect(ADDONS.call_number.requires).toEqual(["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
    expect(ADDONS.call_number.annualCents).toBe(ADDONS.call_number.monthlyCents * ANNUAL_MONTHS);
  });

  it("the held tier: one per subscription; a legacy call_assistant row is Solo", () => {
    expect(callAssistantTierOf({ call_assistant: 1 })?.tier).toBe("solo");
    expect(callAssistantTierOf({ call_assistant_crew: 1, call_number: 2 })?.tier).toBe("crew");
    expect(callAssistantTierOf({ call_assistant_lite: 1 })?.tier).toBe("lite");
    expect(callAssistantIncluded({ call_assistant_lite: 1 })).toMatchObject({ numbers: 1, minutes: 1_000, overageCentsPerMinute: 10 });
    expect(callAssistantIncluded({ call_assistant_crew: 1 })).toMatchObject({ overageCentsPerMinute: 5 });
    expect(callAssistantTierOf({ call_number: 2 })).toBeNull();
    expect(callAssistantIncluded({ call_assistant_fleet: 1 })).toMatchObject({ numbers: 20, minutes: 12_000 });
    expect(callAssistantIncluded({})).toMatchObject({ tier: null, numbers: 0, minutes: 0 });
    expect(callAssistantTier("crew").name).toBe("Crew");
  });

  it("buys through the existing add-on checkout once preview is lifted: plan, requires, exclusivity and preview rules", async () => {
    const { checkAddonsForPlan, mergeAddonRequest } = await import("../billing/order");
    // While in preview: refused, nothing charged — every tier.
    for (const t of CALL_ASSISTANT_TIERS) expect(() => checkAddonsForPlan("pro", { [t.addon]: 1 })).toThrow(/isn't available yet/);
    const keys = ["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet", "call_number"] as const;
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
      // Lite is a tier like the others: one at a time, starter can't have it.
      expect(() => checkAddonsForPlan("pro", { call_assistant_lite: 1, call_assistant: 1 })).toThrow(/can't both be on one subscription/);
      expect(() => checkAddonsForPlan("starter", { call_assistant_lite: 1 })).toThrow(/isn't available on the Starter plan/);
      // Asking for another tier is a switch: the held one goes to 0 in the same change.
      expect(mergeAddonRequest({ call_assistant: 1, call_number: 2 }, { call_assistant_crew: 1 }))
        .toEqual({ call_assistant_lite: 0, call_assistant: 0, call_assistant_fleet: 0, call_assistant_crew: 1, call_number: 2 });
      expect(mergeAddonRequest({ call_assistant_lite: 1 }, { call_assistant: 1 }))
        .toEqual({ call_assistant_lite: 0, call_assistant: 1, call_assistant_crew: 0, call_assistant_fleet: 0 });
      expect(mergeAddonRequest({ call_assistant: 1, call_number: 1 }, { call_assistant_lite: 1 }))
        .toEqual({ call_assistant_lite: 1, call_assistant: 0, call_assistant_crew: 0, call_assistant_fleet: 0, call_number: 1 });
      // Removing a tier switches nothing on; naming two tiers is refused, not guessed.
      expect(mergeAddonRequest({ call_assistant_crew: 1 }, { call_assistant_crew: 0 })).toEqual({ call_assistant_crew: 0 });
      expect(mergeAddonRequest({ call_assistant: 1 }, { call_assistant: 1, call_assistant_fleet: 1 })).toMatchObject({ call_assistant: 1, call_assistant_fleet: 1 });
      // The Stripe price is the standard add-on spec (lookup key spells the price); Solo keeps the original key.
      const { addonPriceSpec } = await import("../billing/prices");
      expect(addonPriceSpec("call_assistant", "month").lookupKey).toBe("chub_v1_addon_call_assistant_month_24900");
      expect(addonPriceSpec("call_assistant_crew", "year").lookupKey).toBe("chub_v1_addon_call_assistant_crew_year_359900");
      expect(addonPriceSpec("call_assistant_fleet", "month").lookupKey).toBe("chub_v1_addon_call_assistant_fleet_month_79900");
      expect(addonPriceSpec("call_assistant_lite", "month").lookupKey).toBe("chub_v1_addon_call_assistant_lite_month_14900");
      expect(addonPriceSpec("call_assistant_lite", "year").lookupKey).toBe("chub_v1_addon_call_assistant_lite_year_119900");
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
    expect(u.summarizeVoiceUsage({ minutes: 530, calls: 9, includedMinutes: 500, overageReportedMinutes: 10 }, "2026-10", 500, 10))
      .toMatchObject({ remainingMinutes: 0, overageMinutes: 30, overageCents: 300, overageCentsPerMinute: 10, overageReportedMinutes: 10, overageReportedCents: 100 });
    // Each rate bucket at its own rate: 30 min at 10¢ + 120 min at 5¢.
    expect(u.summarizeVoiceUsage({ minutes: 5150, includedMinutes: 5000, overageMinutes: 150, overageRateMinutes: { "10": 30, "5": 120 }, overageCentsPerMinute: 5 }, "2001-01", 0))
      .toMatchObject({ overageMinutes: 150, overageCents: 30 * 10 + 120 * 5, overageCentsPerMinute: 5, overageByRate: [{ centsPerMinute: 10, minutes: 30 }, { centsPerMinute: 5, minutes: 120 }] });
    // The row's accrued overage is what shows (and bills): an upgrade after the fact never erases it.
    const now = u.voiceMonthKey();
    expect(u.summarizeVoiceUsage({ minutes: 4500, includedMinutes: 2000, overageMinutes: 2500 }, now, 5000))
      .toMatchObject({ includedMinutes: 5000, remainingMinutes: 500, overageMinutes: 2500, overageCents: 2500 * CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS });
    // No allowance right now (cancelled): the month's snapshot stays; a past month always shows its own snapshot.
    expect(u.summarizeVoiceUsage({ minutes: 530, includedMinutes: 500, overageMinutes: 30 }, now, 0)).toMatchObject({ includedMinutes: 500, overageMinutes: 30 });
    expect(u.summarizeVoiceUsage({ minutes: 530, includedMinutes: 500, overageMinutes: 30 }, "2001-01", 5000)).toMatchObject({ includedMinutes: 500, overageMinutes: 30 });
    // Unlimited (-1): never overage.
    expect(u.summarizeVoiceUsage(null, now, -1)).toMatchObject({ includedMinutes: -1, remainingMinutes: -1, overageMinutes: 0 });
    // One Price per rate; the 10¢ key is the one used before per-tier rates.
    expect(u.voiceOverageLookupKey(10)).toBe("chub_v1_meter_call_minutes_10");
    expect(u.voiceOverageLookupKey(5)).toBe("chub_v1_meter_call_minutes_5");
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
      // An existing Price per lookup key ("…_minutes_10" → 10¢), id `<existingPrice>_<rate>`.
      list: async (params: any) => {
        calls.push({ method: "prices.list", params });
        const rate = Number(String(params.lookup_keys[0]).split("_").pop());
        return { data: existingPrice ? [{ id: `${existingPrice}_${rate}`, unit_amount: rate, currency: "usd" }] : [] };
      },
      create: async (params: any, opts?: any) => { calls.push({ method: "prices.create", params, opts }); return { id: `price_fake_overage_${params.unit_amount}` }; },
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

  it("overage accrues per call against the tier in force: a later upgrade never wipes it, a downgrade lowers the allowance from then on", async () => {
    const setAddons = (uid: number, addons: Record<string, number>) => db.query("update subscriptions set addons = $2 where user_id = $1", [uid, JSON.stringify(addons)]);
    // (1) Solo, one 4,500-minute call → 2,500 over. A one-day upgrade to Crew afterwards keeps those 2,500.
    const solo = await user({ call_assistant: 1 });
    const o = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 4500, at: AT })).toMatchObject({ includedMinutes: 2000, overageMinutes: 2500 });
    await setAddons(solo, { call_assistant_crew: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ minutes: 4501, includedMinutes: 5000, overageMinutes: 2500 });
    // Crew's 5,000 cover the month's minutes up to 5,000; the call that crosses it is over only by the part above.
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 600, at: AT })).toMatchObject({ minutes: 5101, overageMinutes: 2601 });
    // Back to Solo: every billable minute from here is over (the month is already past 2,000).
    await setAddons(solo, { call_assistant: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 3, at: AT })).toMatchObject({ includedMinutes: 2000, overageMinutes: 2604 });

    // (2) Fleet, one 1-minute call, then a downgrade to Solo, then 11,000 minutes → 9,001 over (Solo's 2,000 included).
    const fleet = await user({ call_assistant_fleet: 1 });
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: fleet, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: 12_000, overageMinutes: 0 });
    await setAddons(fleet, { call_assistant: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: fleet, outcome: "info", billedMinutes: 11_000, at: AT })).toMatchObject({ minutes: 11_001, includedMinutes: 2000, overageMinutes: 9001 });

    // (3) A call that ends after the add-on is gone keeps the month's allowance (it was answered while paid for).
    const gone = await user({ call_assistant: 1 });
    const o3 = org();
    await usage.recordVoiceCallUsage({ orgId: o3, accountUserId: gone, outcome: "info", billedMinutes: 100, at: AT });
    await setAddons(gone, {});
    expect(await usage.recordVoiceCallUsage({ orgId: o3, accountUserId: gone, outcome: "info", billedMinutes: 5, at: AT })).toMatchObject({ minutes: 105, includedMinutes: 2000, overageMinutes: 0 });

    // Free spam minutes never accrue overage, even past the allowance.
    const o4 = org();
    await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "info", billedMinutes: 2000, at: AT });
    expect(await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "spam", billedMinutes: 9, at: AT })).toMatchObject({ minutes: 2000, overageMinutes: 0, spamFreeMinutes: 9 });
  });

  it("per-tier overage: a month on Solo (10¢) then Crew (5¢) bills each call at the rate of the tier it was taken on", async () => {
    const setAddons = (uid: number, addons: Record<string, number>) => db.query("update subscriptions set addons = $2 where user_id = $1", [uid, JSON.stringify(addons)]);
    const acct = await user({ call_assistant: 1 });
    const o = org();
    // Solo: 2,030 minutes → 30 over at 10¢.
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 2030, at: AT }))
      .toMatchObject({ includedMinutes: 2000, overageMinutes: 30, overageRateMinutes: { "10": 30 }, overageCentsPerMinute: 10 });
    // Upgrade to Crew: 5,000 included; the month's 2,030 + 3,090 = 5,120 → this call is 120 over, at Crew's 5¢. Solo's 30 stay at 10¢.
    await setAddons(acct, { call_assistant_crew: 1 });
    const row = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 3090, at: AT });
    expect(row).toMatchObject({ minutes: 5120, includedMinutes: 5000, overageMinutes: 150, overageRateMinutes: { "10": 30, "5": 120 }, overageCentsPerMinute: 5 });
    // Spam is still free up to the allowance on Crew, at any rate.
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "spam", billedMinutes: 4, at: AT }))
      .toMatchObject({ minutes: 5120, overageMinutes: 150, spamFreeCalls: 1, spamFreeMinutes: 4 });
    const s = usage.summarizeVoiceUsage(row, MONTH, 0);
    // NOT 150 × 10¢ (= $15) or 150 × 5¢ (= $7.50): 30 × 10¢ + 120 × 5¢ = $9.
    expect(s).toMatchObject({ overageMinutes: 150, overageCents: 900, overageByRate: [{ centsPerMinute: 10, minutes: 30 }, { centsPerMinute: 5, minutes: 120 }] });

    // Billing: one invoice item per rate, each on its own Price; the row records both buckets as billed.
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe();
    const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_m", stripeSubscriptionId: "sub_m", status: "active", billingInterval: "month" }) };
    const out = await usage.reportVoiceOverage(o, MONTH, deps);
    expect(out).toMatchObject({ reported: 150, reportedCents: 900, lines: [{ centsPerMinute: 10, minutes: 30 }, { centsPerMinute: 5, minutes: 120 }] });
    const items = calls.filter((c) => c.method === "invoiceItems.create");
    expect(items.map((c) => [c.params.pricing.price, c.params.quantity, c.opts?.idempotencyKey])).toEqual([
      ["price_fake_overage_10", 30, `chub-voice-overage-${o}-${MONTH}-r10-30`],
      ["price_fake_overage_5", 120, `chub-voice-overage-${o}-${MONTH}-r5-120`],
    ]);
    expect(calls.filter((c) => c.method === "prices.create").map((c) => [c.params.unit_amount, c.params.lookup_key])).toEqual([
      [10, "chub_v1_meter_call_minutes_10"], [5, "chub_v1_meter_call_minutes_5"],
    ]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 150, overageReportedRateMinutes: { "10": 30, "5": 120 } });
    expect(usage.summarizeVoiceUsage(await usage.getVoiceUsageRow(o, MONTH), MONTH, 0)).toMatchObject({ overageReportedCents: 900 });
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });

    // A later Crew call: only its new 5¢ minutes are sent.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 6, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 6, reportedCents: 30, lines: [{ centsPerMinute: 5, minutes: 6 }] });
    expect(calls.map((c) => [c.method, c.opts?.idempotencyKey])).toEqual([["invoiceItems.create", `chub-voice-overage-${o}-${MONTH}-r5-126`]]);

    // Lite (10¢, 1,000 included) → Fleet (5¢): the same per-call rule.
    const lite = await user({ call_assistant_lite: 1 });
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: 1010, at: AT }))
      .toMatchObject({ includedMinutes: 1000, overageMinutes: 10, overageRateMinutes: { "10": 10 } });
    await setAddons(lite, { call_assistant_fleet: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: 10_990, at: AT }))
      .toMatchObject({ includedMinutes: 12_000, overageMinutes: 10, overageRateMinutes: { "10": 10 } });
    // And a downgrade to Lite: everything from here is over at Lite's 10¢.
    await setAddons(lite, { call_assistant_lite: 1 });
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: 7, at: AT }))
      .toMatchObject({ includedMinutes: 1000, overageMinutes: 17, overageRateMinutes: { "10": 17 } });
  });

  it("per-tier overage on an annual subscription: one item per rate, each invoiced and recorded before the next", async () => {
    const setAddons = (uid: number, addons: Record<string, number>) => db.query("update subscriptions set addons = $2 where user_id = $1", [uid, JSON.stringify(addons)]);
    const acct = await user({ call_assistant_lite: 1 });
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 1004, at: AT });
    await setAddons(acct, { call_assistant_fleet: 1 });
    await setAddons(acct, { call_assistant_crew: 1 });
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 4000, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const out = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_a", status: "active", billingInterval: "year" }) });
    // 1,004 + 4,000 = 5,004 on Crew → 4 over at 5¢; Lite's 4 at 10¢.
    expect(out).toMatchObject({ reported: 8, reportedCents: 60, invoiceId: "in_fake_1", lines: [{ centsPerMinute: 10, invoiceId: "in_fake_1" }, { centsPerMinute: 5, invoiceId: "in_fake_2" }] });
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "invoiceItems.create", "invoices.create", "prices.list", "invoiceItems.create", "invoices.create"]);
    expect(calls.filter((c) => c.method === "invoices.create").map((c) => c.opts?.idempotencyKey)).toEqual([
      `chub-voice-overage-${o}-${MONTH}-r10-4-invoice`, `chub-voice-overage-${o}-${MONTH}-r5-4-invoice`,
    ]);
    expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => [c.params.pricing.price, c.params.quantity, c.params.subscription])).toEqual([
      ["price_existing_10", 4, undefined], ["price_existing_5", 4, undefined],
    ]);
  });

  it("a failure on one rate leaves the rates already sent recorded: the retry sends only the missing line (no reliance on Stripe's 24-hour key)", async () => {
    const setAddons = (uid: number, addons: Record<string, number>) => db.query("update subscriptions set addons = $2 where user_id = $1", [uid, JSON.stringify(addons)]);
    const acct = await user({ call_assistant: 1 });
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 2030, at: AT });
    await setAddons(acct, { call_assistant_crew: 1 });
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 3090, at: AT });
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageRateMinutes: { "10": 30, "5": 120 }, overageReportedMinutes: 0 });

    for (const interval of ["month", "year"] as const) {
      const oo = interval === "month" ? o : org();
      if (interval === "year") {
        await setAddons(acct, { call_assistant: 1 });
        await usage.recordVoiceCallUsage({ orgId: oo, accountUserId: acct, outcome: "info", billedMinutes: 2030, at: AT });
        await setAddons(acct, { call_assistant_crew: 1 });
        await usage.recordVoiceCallUsage({ orgId: oo, accountUserId: acct, outcome: "info", billedMinutes: 3090, at: AT });
      }
      // A Stripe with NO idempotency memory (a key older than 24 hours) that rejects the 5¢ price twice.
      usage.resetVoiceOveragePriceCache();
      const { stripe, calls } = fakeStripe();
      let failures = 2;
      const create = stripe.prices.create;
      stripe.prices.create = async (params: any, opts?: any) => {
        if (params.unit_amount === 5 && failures-- > 0) throw new Error("price create failed");
        return create(params, opts);
      };
      const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_f", stripeSubscriptionId: "sub_f", status: "active", billingInterval: interval }) };
      await expect(usage.reportVoiceOverage(oo, MONTH, deps)).rejects.toThrow("price create failed");
      // The 10¢ line is recorded the moment Stripe has it (and, annual, its invoice).
      expect(await usage.getVoiceUsageRow(oo, MONTH)).toMatchObject({ overageReportedMinutes: 30, overageReportedRateMinutes: { "10": 30 } });
      await expect(usage.reportVoiceOverage(oo, MONTH, deps)).rejects.toThrow("price create failed");
      const out = await usage.reportVoiceOverage(oo, MONTH, deps);
      expect(out).toMatchObject({ reported: 120, reportedCents: 600, lines: [{ centsPerMinute: 5, minutes: 120 }] });
      // Three runs, but the 10¢ minutes went to Stripe exactly once.
      expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => [c.params.pricing.price, c.params.quantity])).toEqual([
        ["price_fake_overage_10", 30], ["price_fake_overage_5", 120],
      ]);
      expect(calls.filter((c) => c.method === "invoices.create")).toHaveLength(interval === "year" ? 2 : 0);
      expect(await usage.getVoiceUsageRow(oo, MONTH)).toMatchObject({ overageReportedMinutes: 150, overageReportedRateMinutes: { "10": 30, "5": 120 } });
      expect(await usage.reportVoiceOverage(oo, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    }
  });

  it("annual: an invoice that fails leaves its bucket unrecorded, so the retry invoices it", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 2005, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const invoice = stripe.invoices.create;
    let fail = true;
    stripe.invoices.create = async (params: any, opts?: any) => { if (fail) { fail = false; throw new Error("invoice failed"); } return invoice(params, opts); };
    const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_i", stripeSubscriptionId: "sub_i", status: "active", billingInterval: "year" }) };
    await expect(usage.reportVoiceOverage(o, MONTH, deps)).rejects.toThrow("invoice failed");
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageMinutes: 5, overageReportedMinutes: 0 });
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 5, invoiceId: expect.stringMatching(/^in_fake_/) });
    // The retry re-sends the item under the same key (Stripe returns the first one) and invoices it.
    expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => c.opts?.idempotencyKey)).toEqual([
      `chub-voice-overage-${o}-${MONTH}-r10-5`, `chub-voice-overage-${o}-${MONTH}-r10-5`,
    ]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 5, overageReportedRateMinutes: { "10": 5 } });
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
    expect(out).toEqual({ reported: 3, reportedCents: 30, lines: [{ centsPerMinute: 10, minutes: 3, invoiceItemId: "ii_fake_1", invoiceId: null }], invoiceItemId: "ii_fake_1", invoiceId: null });
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "prices.create", "invoiceItems.create"]);
    expect(calls[1].params).toMatchObject({ currency: "usd", unit_amount: 10, lookup_key: usage.voiceOverageLookupKey(10) });
    expect(calls[1].params.recurring).toBeUndefined();
    expect(calls[2].params).toMatchObject({ customer: "cus_x", subscription: "sub_x", pricing: { price: "price_fake_overage_10" }, quantity: 3 });
    expect(calls[2].params.description).toContain("at $0.10 a minute");
    expect(calls[2].params.price).toBeUndefined(); // stripe-node 20 takes pricing.price, not price
    expect(calls[2].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r10-3`);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 3, overageReportedRateMinutes: { "10": 3 }, stripeUsageRecordId: "ii_fake_1" });

    // Again: nothing new, nothing sent.
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    // A late call in the same month: only its minutes, under a new key; the price is cached.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 4, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 4 });
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.create"]);
    expect(calls[0].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r10-7`);
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
    expect(calls[1].params.pricing).toEqual({ price: "price_existing_10" });
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
    expect(out).toEqual({ month, orgs: 1, reportedMinutes: 2, reportedCents: 20, skipped: { no_live_subscription: 1 } });
  });
});
