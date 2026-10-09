/**
 * Call Assistant billing (numbers+billing lane): the price-book block, the
 * voice_usage meter and overage billing.
 *
 * Part 1 is pure (the price book — a separate service on its own subscription
 * since 2026-10-08 — the checkout rules and the minute maths). Part 2 runs the
 * meter against the development lane DB (rows in the year 2001, so nothing
 * real is touched; each account's Call Assistant subscription is its own
 * call_assistant_subscriptions row) and bills overage through a FAKE Stripe
 * that records every call — nothing leaves the box.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { cleanup, made, makeAccount, makeCall } from "./calls-fixtures";
import {
  ADDONS, PLANS, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, CALL_ASSISTANT_OVERAGE_RATES, CALL_NUMBER_MIN_DAYS,
  CALL_ASSISTANT_ANNUAL_MONTHS, SALES_THRESHOLD_CENTS, callAssistantTier, callAssistantTierOf, callAssistantIncluded,
} from "@shared/plans";

// Throwaway "p-voice-admin-…@example.invalid" accounts count as platform admins (the real ADMIN_EMAILS are never used).
vi.mock("../admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../admin")>();
  const testAdmin = (email?: string | null) => !!email && /^p-voice-admin-.*@example\.invalid$/i.test(email);
  return { ...real, isPlatformAdminEmail: (email?: string | null) => real.isPlatformAdminEmail(email) || testAdmin(email), isPlatformAdmin: (user: any) => real.isPlatformAdmin(user) || testAdmin(user?.email) };
});

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
// The overage safety switch (CALL_ASSISTANT_OVERAGE_BILLING, default off): on for these tests; one test turns it off.
process.env.CALL_ASSISTANT_OVERAGE_BILLING = "on";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

/** Each tier's included minutes, from the price book: the meter scenarios below are written relative to them. */
const tierMinutes = (t: string) => CALL_ASSISTANT_TIERS.find((x) => x.tier === t)!.includedMinutes;
const LITE = tierMinutes("lite"), SOLO = tierMinutes("solo"), CREW = tierMinutes("crew"), FLEET = tierMinutes("fleet");

// ── Part 1: pure ────────────────────────────────────────────────────────────

describe("Call Assistant price book: a separate service, four tiers (owner, 2026-10-08)", () => {
  it("500 / 1,000 / 2,000 / 5,000 minutes: prices, yearly prices (11 × monthly), numbers, one overage rate; 500 free spam calls on every tier", () => {
    expect(CALL_ASSISTANT_TIERS.map((t) => [t.tier, t.addon, t.name, t.monthlyCents, t.annualCents, t.includedMinutes, t.includedNumbers, t.overageCentsPerMinute])).toEqual([
      ["lite", "call_assistant_lite", "500 minutes", 24_900, 273_900, 500, 1, 50],
      ["solo", "call_assistant", "1,000 minutes", 34_900, 383_900, 1_000, 1, 50],
      ["crew", "call_assistant_crew", "2,000 minutes", 44_900, 493_900, 2_000, 2, 50],
      ["fleet", "call_assistant_fleet", "5,000 minutes", 99_900, 1_098_900, 5_000, 5, 50],
    ]);
    // Cheapest first: the order is the upgrade order; one overage rate (owner: 50 cents, every tier).
    for (let i = 1; i < CALL_ASSISTANT_TIERS.length; i++) {
      expect(CALL_ASSISTANT_TIERS[i].monthlyCents).toBeGreaterThan(CALL_ASSISTANT_TIERS[i - 1].monthlyCents);
      expect(CALL_ASSISTANT_TIERS[i].includedMinutes).toBeGreaterThan(CALL_ASSISTANT_TIERS[i - 1].includedMinutes);
      expect(CALL_ASSISTANT_TIERS[i].overageCentsPerMinute).toBe(CALL_ASSISTANT_TIERS[i - 1].overageCentsPerMinute);
    }
    expect(CALL_ASSISTANT_OVERAGE_RATES).toEqual([50]);
    // No tier held at a call (e.g. a platform admin, whose minutes are unlimited anyway): the one rate.
    expect(CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS).toBe(50);
    // Owner: "all plans cover 500 spam calls that aren't charged".
    expect(CALL_ASSISTANT_FREE_SPAM_CALLS).toBe(500);
    expect(CALL_NUMBER_MIN_DAYS).toBe(14);
    for (const t of CALL_ASSISTANT_TIERS) {
      const a = ADDONS[t.addon];
      // The add-on IS the tier: one source for the service's checkout, Stripe prices and the pages — and no plan sells it.
      expect(a).toMatchObject({ key: t.addon, name: `AI Call Assistant — ${t.name}`, monthlyCents: t.monthlyCents, annualCents: t.annualCents,
        availableOn: [], exclusiveGroup: "call_assistant_tier", grants: {} });
      // Launched (owner, 2026-10-02: "the call assistant is live not coming soon"): every tier is for sale.
      expect(a.preview ?? false).toBe(false);
      // Voice yearly prices use their own multiplier and are exempt from the sales threshold.
      expect(a.annualCents).toBe(a.monthlyCents * CALL_ASSISTANT_ANNUAL_MONTHS);
      expect(a.monthlyCents).toBeLessThan(SALES_THRESHOLD_CENTS);
      expect(a.setupCents).toBeUndefined();
      // No intro price any more.
      expect(a.introMonthlyCents).toBeUndefined();
      expect(a.introMonths).toBeUndefined();
      // The description quotes the tier's own numbers and the shared rules.
      expect(a.description).toContain(`${t.includedMinutes.toLocaleString("en-US")} call minutes a month`);
      expect(a.description).toContain("then $0.50 a minute");
      expect(a.description).toContain(`the first ${CALL_ASSISTANT_FREE_SPAM_CALLS} spam calls each month never count`);
    }
    // The extra number keeps the old contract's yearly price (10 ×): the repricing named the four tiers only.
    expect(ADDONS.call_number).toMatchObject({ key: "call_number", monthlyCents: 500, annualCents: 5000, availableOn: [] });
    expect(ADDONS.call_number.preview ?? false).toBe(false);
    expect(ADDONS.call_number.requires).toEqual(["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
  });

  it("the held tier: one per subscription; the original call_assistant key is the 1,000 minutes tier", () => {
    expect(callAssistantTierOf({ call_assistant: 1 })?.tier).toBe("solo");
    expect(callAssistantTierOf({ call_assistant_crew: 1, call_number: 2 })?.tier).toBe("crew");
    expect(callAssistantTierOf({ call_assistant_lite: 1 })?.tier).toBe("lite");
    expect(callAssistantIncluded({ call_assistant_lite: 1 })).toMatchObject({ numbers: 1, minutes: 500, overageCentsPerMinute: 50 });
    expect(callAssistantIncluded({ call_assistant_crew: 1 })).toMatchObject({ numbers: 2, minutes: 2_000, overageCentsPerMinute: 50 });
    expect(callAssistantTierOf({ call_number: 2 })).toBeNull();
    expect(callAssistantIncluded({ call_assistant_fleet: 1 })).toMatchObject({ numbers: 5, minutes: 5_000 });
    expect(callAssistantIncluded({})).toMatchObject({ tier: null, numbers: 0, minutes: 0 });
    expect(callAssistantTier("crew").name).toBe("2,000 minutes");
  });

  it("is sold on its OWN subscription, never through the platform add-on checkout; a tier request is a switch; the Stripe prices spell the cents", async () => {
    const { checkAddonsForPlan, mergeAddonRequest } = await import("../billing/order");
    const keys = ["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet", "call_number"] as const;
    for (const k of keys) expect(ADDONS[k].preview ?? false, k).toBe(false);
    // The platform checkout refuses every Call Assistant line on every plan (a separate service with its own checkout).
    for (const plan of ["starter", "pro", "growth", "agency"] as const) {
      for (const k of keys) expect(() => checkAddonsForPlan(plan, { [k]: 1 }), `${plan} + ${k}`).toThrow(/isn't a plan add-on/);
    }
    // Asking for another tier is a switch: the held one goes to 0 in the same change (the release preview reads it this way).
    expect(mergeAddonRequest({ call_assistant: 1, call_number: 2 }, { call_assistant_crew: 1 }))
      .toEqual({ call_assistant_lite: 0, call_assistant: 0, call_assistant_fleet: 0, call_assistant_crew: 1, call_number: 2 });
    expect(mergeAddonRequest({ call_assistant_lite: 1 }, { call_assistant: 1 }))
      .toEqual({ call_assistant_lite: 0, call_assistant: 1, call_assistant_crew: 0, call_assistant_fleet: 0 });
    expect(mergeAddonRequest({ call_assistant: 1, call_number: 1 }, { call_assistant_lite: 1 }))
      .toEqual({ call_assistant_lite: 1, call_assistant: 0, call_assistant_crew: 0, call_assistant_fleet: 0, call_number: 1 });
    expect(mergeAddonRequest({ call_assistant_crew: 1 }, { call_assistant_crew: 0 })).toEqual({ call_assistant_crew: 0 });
    // The Stripe price is the standard add-on spec (lookup key spells the price); the second tier keeps the original key.
    const { addonPriceSpec } = await import("../billing/prices");
    expect(addonPriceSpec("call_assistant", "month").lookupKey).toBe("chub_v1_addon_call_assistant_month_34900");
    expect(addonPriceSpec("call_assistant_crew", "year").lookupKey).toBe("chub_v1_addon_call_assistant_crew_year_493900");
    expect(addonPriceSpec("call_assistant_fleet", "month").lookupKey).toBe("chub_v1_addon_call_assistant_fleet_month_99900");
    expect(addonPriceSpec("call_assistant_lite", "month").lookupKey).toBe("chub_v1_addon_call_assistant_lite_month_24900");
    expect(addonPriceSpec("call_assistant_lite", "year").lookupKey).toBe("chub_v1_addon_call_assistant_lite_year_273900");
    expect(addonPriceSpec("call_number", "year").lookupKey).toBe("chub_v1_addon_call_number_year_5000");
    // The service's own order: a tier by key or add-on key, extra numbers capped for self-serve.
    const { parseCallAssistantOrder } = await import("./subscription");
    expect(parseCallAssistantOrder({ tier: "call_assistant_fleet", extraNumbers: 2 })).toEqual({ tier: "fleet", interval: "month", extraNumbers: 2 });
    expect(() => parseCallAssistantOrder({ tier: "lite", extraNumbers: 101 })).toThrow(/sales rep/);
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

  it("unlimited minutes (-1, platform admins): never overage, nothing counting down", async () => {
    const u = await import("./billing-usage");
    expect(u.summarizeVoiceUsage({ minutes: 9_000, includedMinutes: -1 }, "2026-10", -1))
      .toMatchObject({ minutes: 9_000, includedMinutes: -1, remainingMinutes: -1, overageMinutes: 0, overageCents: 0 });
    expect(u.summarizeVoiceUsage(null, "2026-10", -1)).toMatchObject({ includedMinutes: -1, remainingMinutes: -1, overageMinutes: 0 });
    // Overage accrues per call against the allowance in force (recordVoiceCallUsage): calls made while unlimited
    // accrued none, so a later, lower allowance never turns them into overage.
    expect(u.summarizeVoiceUsage({ minutes: 900, includedMinutes: -1, overageMinutes: 0 }, "2026-10", 500)).toMatchObject({ overageMinutes: 0, overageCents: 0 });
  });

  it("the overage sweep only runs in production with Stripe and the explicit switch", async () => {
    const { voiceOverageWorkerOffReason } = await import("./billing-usage");
    // The safety switch comes first: unset (the default) is off. On + Stripe is all it takes (a restart starts the
    // backlog sweep); VOICE_OVERAGE_WORKER_ENABLED=false is only a kill switch.
    expect(voiceOverageWorkerOffReason({} as any)).toMatch(/CALL_ASSISTANT_OVERAGE_BILLING/);
    expect(voiceOverageWorkerOffReason({ CALL_ASSISTANT_OVERAGE_BILLING: "on" } as any)).toMatch(/STRIPE_SECRET_KEY/);
    expect(voiceOverageWorkerOffReason({ CALL_ASSISTANT_OVERAGE_BILLING: "on", STRIPE_SECRET_KEY: "sk", VOICE_OVERAGE_WORKER_ENABLED: "false" } as any)).toMatch(/kill switch/);
    expect(voiceOverageWorkerOffReason({ CALL_ASSISTANT_OVERAGE_BILLING: "on", STRIPE_SECRET_KEY: "sk" } as any)).toBeNull();
    expect(voiceOverageWorkerOffReason({ CALL_ASSISTANT_OVERAGE_BILLING: "on", STRIPE_SECRET_KEY: "sk", NODE_ENV: "development" } as any)).toBeNull();
  });
});

// ── Part 2: the meter and overage billing on the lane DB ────────────────────

type Call = { method: string; params: Record<string, any>; opts?: { idempotencyKey?: string } };
type FakeItem = { id: string; customer: string; subscription: string | null; quantity: number; metadata: Record<string, string>; invoice: string | null };
/**
 * A Stripe that models what the claims rely on: invoice items with their customer, subscription, quantity and
 * metadata; an invoice created with pending_invoice_items_behavior "include" takes the customer's items that
 * are not on an invoice yet, and lists exactly those as its lines; items can be listed (paged) and retrieved.
 */
function fakeStripe(existingPrice: string | null = null) {
  const calls: Call[] = [];
  let n = 0;
  const items: FakeItem[] = [];
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
    invoiceItems: {
      create: async (params: any, opts?: any) => {
        calls.push({ method: "invoiceItems.create", params, opts });
        const id = `ii_fake_${++n}`;
        items.push({ id, customer: params.customer, subscription: params.subscription ?? null, quantity: params.quantity, metadata: params.metadata ?? {}, invoice: null });
        return { id };
      },
      list: async (params: any) => {
        calls.push({ method: "invoiceItems.list", params });
        const mine = items.filter((i) => i.customer === params.customer);
        const from = params.starting_after ? mine.findIndex((i) => i.id === params.starting_after) + 1 : 0;
        const page = mine.slice(from, from + params.limit);
        return { data: page, has_more: from + params.limit < mine.length };
      },
      retrieve: async (id: string) => { calls.push({ method: "invoiceItems.retrieve", params: { id } }); return items.find((i) => i.id === id)!; },
    },
    invoices: {
      create: async (params: any, opts?: any) => {
        calls.push({ method: "invoices.create", params, opts });
        const id = `in_fake_${n}`;
        for (const i of items) if (i.customer === params.customer && !i.invoice) i.invoice = id;
        return { id };
      },
      listLineItems: async (invoiceId: string, params: any) => {
        calls.push({ method: "invoices.listLineItems", params: { invoiceId, ...params } });
        return { data: items.filter((i) => i.invoice === invoiceId).map((i) => ({ id: `il_${i.id}`, invoice_item: i.id })), has_more: false };
      },
    },
  };
  return { stripe, calls, items };
}

describe("voice_usage meter + overage billing (lane DB, fake Stripe)", () => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const MONTH = "2001-01";
  const AT = new Date("2001-01-15T12:00:00Z");
  const users: number[] = [];
  const orgs: string[] = [];
  let usage: typeof import("./billing-usage");
  let payer = 0, unpaid = 0;

  /** An account with the service: a user and its own call_assistant_subscriptions row (the platform plan plays no part). */
  async function user(tier: string | null, extraNumbers = 0): Promise<number> {
    const { rows: [u] } = await db.query("insert into users(email,display_name,email_verified) values($1,'P-Voice billing',true) returning id", [`p-voice-billing-${randomUUID()}@example.invalid`]);
    users.push(u.id);
    await db.query("insert into call_assistant_subscriptions(user_id,tier,extra_numbers,status,stripe_subscription_id,stripe_customer_id,billing_interval) values($1,$2,$3,'active',$4,$5,'month')",
      [u.id, tier, extraNumbers, `sub_p_${randomUUID()}`, `cus_p_${randomUUID()}`]);
    return u.id;
  }
  /** A tier switch (or the tier removed), as the webhook writes it. */
  const setTier = (uid: number, tier: string | null, extraNumbers = 0) => db.query("update call_assistant_subscriptions set tier = $2, extra_numbers = $3 where user_id = $1", [uid, tier, extraNumbers]);
  /** Minutes recorded under earlier rates, as the meter holds them: the row's rate buckets (overage_rate_minutes). */
  const seedBuckets = (o: string, buckets: Record<string, number>) => db.query("update voice_usage set overage_minutes = $2, overage_rate_minutes = $3::jsonb where org_id = $1 and month = $4",
    [o, Object.values(buckets).reduce((n, m) => n + m, 0), JSON.stringify(buckets), MONTH]);

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    const { ensureVoiceSchema } = await import("./schema");
    const { pool } = await import("../db");
    await ensureVoiceSchema(pool);
    const { callAssistantSchemaReady } = await import("./subscription-store");
    await callAssistantSchemaReady();
    usage = await import("./billing-usage");
    payer = await user("solo");
    unpaid = await user(null);
  });
  afterAll(async () => {
    await db.query("delete from voice_overage_claims where org_id=any($1::text[])", [orgs]);
    await db.query("delete from voice_settle_jobs where account_user_id=any($1::int[])", [users]);
    await db.query("delete from voice_usage where org_id=any($1::text[])", [orgs]);
    await db.query("delete from call_assistant_subscriptions where user_id=any($1::int[])", [users]);
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
    expect(after).toMatchObject({ month: MONTH, calls: 3, minutes: 2, spamCalls: 1, blockedCalls: 1, spamFreeCalls: 1, spamFreeMinutes: 1, includedMinutes: SOLO, overageMinutes: 0 });
    // Concurrent end-of-call reports never lose a count.
    await Promise.all(Array.from({ length: 10 }, () => usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 2, at: AT })));
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 13, minutes: 22 });
    // An account whose subscription holds no tier still has its calls counted, all as overage (nothing included).
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
    await rec2("lead_submitted", SOLO);
    await rec2("spam", 30);
    expect(await usage.getVoiceUsageRow(o2, MONTH)).toMatchObject({ minutes: SOLO, overageMinutes: 0, spamFreeMinutes: 30 });
    await rec2("spam", 30);
    const over = await rec2("spam", 7);
    expect(over).toMatchObject({ minutes: SOLO + 7, overageMinutes: 7, spamFreeCalls: 2, spamFreeMinutes: 60 });

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
    const crew = await user("crew");
    const fleet = await user("fleet", 1);
    expect(await usage.recordVoiceCallUsage({ orgId: org(), accountUserId: crew, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: CREW });
    expect(await usage.recordVoiceCallUsage({ orgId: org(), accountUserId: fleet, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: FLEET });
  });

  it("overage accrues per call against the tier in force: a later upgrade never wipes it, a downgrade lowers the allowance from then on", async () => {
    // (1) 1,000 minutes, one call 50 past its included → 50 over. A one-day upgrade to 2,000 minutes afterwards keeps those 50.
    const solo = await user("solo");
    const o = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: SOLO + 50, at: AT })).toMatchObject({ includedMinutes: SOLO, overageMinutes: 50 });
    await setTier(solo, "crew");
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ minutes: SOLO + 51, includedMinutes: CREW, overageMinutes: 50 });
    // The bigger tier's included minutes cover the month up to them; the call that crosses them is over only by the part above (100).
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: CREW - (SOLO + 51) + 100, at: AT })).toMatchObject({ minutes: CREW + 100, overageMinutes: 150 });
    // Back to 1,000 minutes: every billable minute from here is over (the month is already past its included).
    await setTier(solo, "solo");
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: solo, outcome: "info", billedMinutes: 3, at: AT })).toMatchObject({ includedMinutes: SOLO, overageMinutes: 153 });

    // (2) 5,000 minutes, one 1-minute call, then a downgrade to 1,000 minutes, then a call 900 past its included → 901 over.
    const fleet = await user("fleet");
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: fleet, outcome: "info", billedMinutes: 1, at: AT })).toMatchObject({ includedMinutes: FLEET, overageMinutes: 0 });
    await setTier(fleet, "solo");
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: fleet, outcome: "info", billedMinutes: SOLO + 900, at: AT })).toMatchObject({ minutes: SOLO + 901, includedMinutes: SOLO, overageMinutes: 901 });

    // (3) A call that ends after the tier is gone keeps the month's allowance (it was answered while paid for).
    const gone = await user("solo");
    const o3 = org();
    await usage.recordVoiceCallUsage({ orgId: o3, accountUserId: gone, outcome: "info", billedMinutes: 100, at: AT });
    await setTier(gone, null);
    expect(await usage.recordVoiceCallUsage({ orgId: o3, accountUserId: gone, outcome: "info", billedMinutes: 5, at: AT })).toMatchObject({ minutes: 105, includedMinutes: SOLO, overageMinutes: 0 });

    // Free spam minutes never accrue overage, even past the allowance.
    const o4 = org();
    await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "info", billedMinutes: SOLO, at: AT });
    expect(await usage.recordVoiceCallUsage({ orgId: o4, accountUserId: payer, outcome: "spam", billedMinutes: 9, at: AT })).toMatchObject({ minutes: SOLO, overageMinutes: 0, spamFreeMinutes: 9 });
  });

  it("rate buckets: every call is priced at the rate in force when it is recorded (50¢ on every tier), and a month that spans a rate change bills each bucket at its own rate", async () => {
    const acct = await user("solo");
    const o = org();
    // 30 minutes past the included → 30 over at 50¢.
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 30, at: AT }))
      .toMatchObject({ includedMinutes: SOLO, overageMinutes: 30, overageRateMinutes: { "50": 30 }, overageCentsPerMinute: 50 });
    // Minutes recorded before the 2026-10-08 repricing sit in their own bucket (10¢); the meter keeps them at their rate.
    await seedBuckets(o, { "50": 30, "10": 120 });
    const row = (await usage.getVoiceUsageRow(o, MONTH))!;
    const s = usage.summarizeVoiceUsage(row, MONTH, 0);
    // NOT 150 × 50¢ ($75): 30 × 50¢ + 120 × 10¢ = $27.
    expect(s).toMatchObject({ overageMinutes: 150, overageCents: 2700, overageByRate: [{ centsPerMinute: 50, minutes: 30 }, { centsPerMinute: 10, minutes: 120 }] });
    // Spam is still free up to the allowance, at any rate.
    expect(await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "spam", billedMinutes: 4, at: AT }))
      .toMatchObject({ minutes: SOLO + 30, overageMinutes: 150, spamFreeCalls: 1, spamFreeMinutes: 4 });

    // Billing: one invoice item per rate, each on its own Price; the row records both buckets as billed.
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe();
    const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_m", stripeSubscriptionId: "sub_m", status: "active", billingInterval: "month" }) };
    const out = await usage.reportVoiceOverage(o, MONTH, deps);
    expect(out).toMatchObject({ reported: 150, reportedCents: 2700, lines: [{ centsPerMinute: 50, minutes: 30 }, { centsPerMinute: 10, minutes: 120 }] });
    const items = calls.filter((c) => c.method === "invoiceItems.create");
    expect(items.map((c) => [c.params.pricing.price, c.params.quantity, c.opts?.idempotencyKey])).toEqual([
      ["price_fake_overage_50", 30, `chub-voice-overage-${o}-${MONTH}-r50-30`],
      ["price_fake_overage_10", 120, `chub-voice-overage-${o}-${MONTH}-r10-120`],
    ]);
    expect(calls.filter((c) => c.method === "prices.create").map((c) => [c.params.unit_amount, c.params.lookup_key])).toEqual([
      [50, "chub_v1_meter_call_minutes_50"], [10, "chub_v1_meter_call_minutes_10"],
    ]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 150, overageReportedRateMinutes: { "50": 30, "10": 120 } });
    expect(usage.summarizeVoiceUsage(await usage.getVoiceUsageRow(o, MONTH), MONTH, 0)).toMatchObject({ overageReportedCents: 2700 });
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });

    // A later call: only its new 50¢ minutes are sent.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 6, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 6, reportedCents: 300, lines: [{ centsPerMinute: 50, minutes: 6 }] });
    expect(calls.map((c) => [c.method, c.opts?.idempotencyKey])).toEqual([["invoiceItems.create", `chub-voice-overage-${o}-${MONTH}-r50-36`]]);

    // A tier switch mid-month changes the allowance, never the rate: 500 → 5,000 → 500 minutes, every bucket 50¢.
    const lite = await user("lite");
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: LITE + 10, at: AT }))
      .toMatchObject({ includedMinutes: LITE, overageMinutes: 10, overageRateMinutes: { "50": 10 } });
    await setTier(lite, "fleet");
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: FLEET - (LITE + 10), at: AT }))
      .toMatchObject({ includedMinutes: FLEET, overageMinutes: 10, overageRateMinutes: { "50": 10 } });
    await setTier(lite, "lite");
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: lite, outcome: "info", billedMinutes: 7, at: AT }))
      .toMatchObject({ includedMinutes: LITE, overageMinutes: 17, overageRateMinutes: { "50": 17 } });
  });

  it("rate buckets on an annual subscription: one item per rate, each invoiced and recorded before the next", async () => {
    const acct = await user("lite");
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: LITE + 4, at: AT });
    await seedBuckets(o, { "50": 4, "10": 4 });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const out = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_a", status: "active", billingInterval: "year" }) });
    // 4 at 50¢ + 4 at 10¢.
    expect(out).toMatchObject({ reported: 8, reportedCents: 240, invoiceId: "in_fake_1", lines: [{ centsPerMinute: 50, invoiceId: "in_fake_1" }, { centsPerMinute: 10, invoiceId: "in_fake_2" }] });
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "invoiceItems.create", "invoices.create", "invoices.listLineItems", "prices.list", "invoiceItems.create", "invoices.create", "invoices.listLineItems"]);
    expect(calls.filter((c) => c.method === "invoices.create").map((c) => c.opts?.idempotencyKey)).toEqual([
      `chub-voice-overage-${o}-${MONTH}-r50-4-invoice`, `chub-voice-overage-${o}-${MONTH}-r10-4-invoice`,
    ]);
    expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => [c.params.pricing.price, c.params.quantity, c.params.subscription])).toEqual([
      ["price_existing_50", 4, undefined], ["price_existing_10", 4, undefined],
    ]);
  });

  it("a failure on one rate leaves the rates already sent recorded: the retry sends only the missing line (no reliance on Stripe's 24-hour key)", async () => {
    const acct = await user("solo");
    for (const interval of ["month", "year"] as const) {
      const oo = org();
      await usage.recordVoiceCallUsage({ orgId: oo, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 30, at: AT });
      await seedBuckets(oo, { "50": 30, "10": 120 });
      expect(await usage.getVoiceUsageRow(oo, MONTH)).toMatchObject({ overageRateMinutes: { "50": 30, "10": 120 }, overageReportedMinutes: 0 });
      // A Stripe with NO idempotency memory (a key older than 24 hours) that rejects the 10¢ price twice.
      usage.resetVoiceOveragePriceCache();
      const { stripe, calls } = fakeStripe();
      let failures = 2;
      const create = stripe.prices.create;
      stripe.prices.create = async (params: any, opts?: any) => {
        if (params.unit_amount === 10 && failures-- > 0) throw new Error("price create failed");
        return create(params, opts);
      };
      const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_f", stripeSubscriptionId: "sub_f", status: "active", billingInterval: interval }) };
      await expect(usage.reportVoiceOverage(oo, MONTH, deps)).rejects.toThrow("price create failed");
      // Both ranges are CLAIMED (the meter's "reported" = claimed) before Stripe is asked; the 50¢ claim went through
      // (and, annual, its invoice), the 10¢ claim is failed with its error and will be retried as it is.
      expect(await usage.getVoiceUsageRow(oo, MONTH)).toMatchObject({ overageReportedMinutes: 150, overageReportedRateMinutes: { "50": 30, "10": 120 } });
      expect((await usage.listVoiceOverageClaims(oo, MONTH)).map((c) => [c.centsPerMinute, c.state, c.error])).toEqual([[50, interval === "year" ? "invoiced" : "queued", null], [10, "failed", "price create failed"]]);
      await expect(usage.reportVoiceOverage(oo, MONTH, deps)).rejects.toThrow("price create failed");
      const out = await usage.reportVoiceOverage(oo, MONTH, deps);
      expect(out).toMatchObject({ reported: 120, reportedCents: 1200, lines: [{ centsPerMinute: 10, minutes: 120 }] });
      // Three runs, but the 50¢ minutes went to Stripe exactly once.
      expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => [c.params.pricing.price, c.params.quantity])).toEqual([
        ["price_fake_overage_50", 30], ["price_fake_overage_10", 120],
      ]);
      expect(calls.filter((c) => c.method === "invoices.create")).toHaveLength(interval === "year" ? 2 : 0);
      expect(await usage.getVoiceUsageRow(oo, MONTH)).toMatchObject({ overageReportedMinutes: 150, overageReportedRateMinutes: { "50": 30, "10": 120 } });
      expect(await usage.reportVoiceOverage(oo, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    }
  });

  it("annual: an invoice that fails leaves its claim failed with its item recorded, so the retry only invoices it (the item is never re-sent)", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: SOLO + 5, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const invoice = stripe.invoices.create;
    let fail = true;
    stripe.invoices.create = async (params: any, opts?: any) => { if (fail) { fail = false; throw new Error("invoice failed"); } return invoice(params, opts); };
    const deps = { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_i", stripeSubscriptionId: "sub_i", status: "active", billingInterval: "year" }) };
    await expect(usage.reportVoiceOverage(o, MONTH, deps)).rejects.toThrow("invoice failed");
    // Claimed (reported) before Stripe; the item was recorded the moment Stripe had it; the invoice step failed.
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageMinutes: 5, overageReportedMinutes: 5 });
    expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.state, c.stripeInvoiceItemId, c.stripeInvoiceId, c.error])).toEqual([["failed", "ii_fake_1", null, "invoice failed"]]);
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 5, invoiceId: expect.stringMatching(/^in_fake_/) });
    // The retry keeps the claim's item (Stripe already has it), asks whether it already sits on an invoice, and only
    // invoices it: one item ever sent, and the invoice under the claim's own key (the failed attempt threw before the
    // fake recorded it).
    expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => c.opts?.idempotencyKey)).toEqual([`chub-voice-overage-${o}-${MONTH}-r50-5`]);
    expect(calls.filter((c) => c.method === "invoiceItems.retrieve")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "invoices.create").map((c) => c.opts?.idempotencyKey)).toEqual([`chub-voice-overage-${o}-${MONTH}-r50-5-invoice`]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 5, overageReportedRateMinutes: { "50": 5 } });
    expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.state, c.stripeInvoiceItemId, c.error])).toEqual([["invoiced", "ii_fake_1", null]]);
  });

  it("overage: monthly subscription → one invoice item on the subscription, only the new minutes, idempotent", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: SOLO - 2, at: AT });
    const row = await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "lead_submitted", billedMinutes: 5, at: AT });
    expect(row).toMatchObject({ minutes: SOLO + 3, includedMinutes: SOLO, overageMinutes: 3, overageReportedMinutes: 0 });

    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe();
    const sub = { stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x", status: "active", billingInterval: "month" };
    const deps = { stripe, configured: () => true, subscriptionFor: async () => sub };
    const out = await usage.reportVoiceOverage(o, MONTH, deps);
    expect(out).toEqual({ reported: 3, reportedCents: 150, lines: [{ centsPerMinute: 50, minutes: 3, invoiceItemId: "ii_fake_1", invoiceId: null, claimId: expect.any(Number) }], invoiceItemId: "ii_fake_1", invoiceId: null });
    // The claim behind it: the range [0, 3) at 50¢, queued for the subscription's next invoice (not yet invoiced).
    expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.fromMinutes, c.toMinutes, c.centsPerMinute, c.state, c.stripeInvoiceItemId, c.stripeInvoiceId])).toEqual([[0, 3, 50, "queued", "ii_fake_1", null]]);
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "prices.create", "invoiceItems.create"]);
    expect(calls[1].params).toMatchObject({ currency: "usd", unit_amount: 50, lookup_key: usage.voiceOverageLookupKey(50) });
    expect(calls[1].params.recurring).toBeUndefined();
    expect(calls[2].params).toMatchObject({ customer: "cus_x", subscription: "sub_x", pricing: { price: "price_fake_overage_50" }, quantity: 3 });
    expect(calls[2].params.description).toContain("at $0.50 a minute");
    expect(calls[2].params.price).toBeUndefined(); // stripe-node 20 takes pricing.price, not price
    expect(calls[2].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r50-3`);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 3, overageReportedRateMinutes: { "50": 3 }, stripeUsageRecordId: "ii_fake_1" });

    // Again: nothing new, nothing sent.
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    // A late call in the same month: only its minutes, under a new key; the price is cached.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 4, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 4 });
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.create"]);
    expect(calls[0].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r50-7`);
  });

  it("overage: annual subscription → unattached item invoiced now; an ENDED subscription → the same, on its customer (never lost); no Stripe / no customer → nothing billed, minutes kept", async () => {
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: SOLO + 10, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");

    expect(await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => false })).toEqual({ reported: 0, reason: "stripe_unconfigured" });
    expect(await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: null, stripeSubscriptionId: "sub_y", status: "active", billingInterval: "year" }) }))
      .toEqual({ reported: 0, reason: "no_customer" });
    expect(await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => null })).toEqual({ reported: 0, reason: "no_customer" });
    expect(calls).toHaveLength(0);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageMinutes: 10, overageReportedMinutes: 0 });

    const out = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_y", stripeSubscriptionId: "sub_y", status: "active", billingInterval: "year" }) });
    expect(out).toMatchObject({ reported: 10, invoiceId: "in_fake_1" });
    // The invoice's own lines say which claims it carries.
    expect(calls.map((c) => c.method)).toEqual(["prices.list", "invoiceItems.create", "invoices.create", "invoices.listLineItems"]);
    expect(calls[1].params.subscription).toBeUndefined();
    expect(calls[1].params.pricing).toEqual({ price: "price_existing_50" });
    expect(calls[2].params).toMatchObject({ customer: "cus_y", pending_invoice_items_behavior: "include", auto_advance: true });

    // Ended (canceled at Stripe; the row keeps its customer): a gone monthly subscription takes no items, so the
    // minutes are invoiced now on the customer instead of being skipped (Codex audit 2026-10-09).
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: payer, outcome: "info", billedMinutes: 4, at: AT });
    calls.length = 0;
    const ended = await usage.reportVoiceOverage(o, MONTH, { stripe, configured: () => true, subscriptionFor: async () => ({ stripeCustomerId: "cus_y", stripeSubscriptionId: "sub_y", status: "canceled", billingInterval: "month" }) });
    expect(ended).toMatchObject({ reported: 4, reportedCents: 200, invoiceId: "in_fake_2" });
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.create", "invoices.create", "invoices.listLineItems"]);
    expect(calls[0].params.subscription).toBeUndefined();
    expect(calls[0].params.customer).toBe("cus_y");
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 14 });
  });

  it("overage is never lost when the subscription ends (Codex audits 2026-10-09): the end and its settlement job are one transaction, the job settles every outstanding month on the kept customer, and a sweep covers every finished month, not only last month", async () => {
    const { syncCallAssistantSubscription } = await import("./subscription");
    const acct = await user("solo");
    const { rows: [before] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct]);
    const o = org();
    // Two months outstanding: an old one a sweep missed, and the current one (cancelled mid-month, before any sweep).
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 3, at: new Date("2000-11-20T12:00:00Z") });
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 40, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const mine = () => calls.filter((c) => c.method === "invoiceItems.create" && c.params.customer === before.stripe_customer_id);
    // customer.subscription.deleted → the transition (Stripe read under the lock says canceled): the end and its settlement
    // job in one transaction, then the job runs — each month's item unattached (the subscription is gone) and invoiced now.
    const gone = { id: before.stripe_subscription_id, customer: before.stripe_customer_id, status: "canceled", metadata: { userId: String(acct) }, items: { data: [] }, cancel_at_period_end: false } as any;
    expect(await syncCallAssistantSubscription({ id: before.stripe_subscription_id }, null, { retrieve: async () => gone, settle: (uid) => usage.runVoiceSettlementsForAccount(uid, { stripe, configured: () => true }) })).toBe(acct);
    expect((await usage.listPendingVoiceSettlements(acct))).toEqual([]);
    expect(mine().map((c) => [c.params.subscription, c.params.quantity, c.params.metadata.chub_month])).toEqual([[undefined, 3, "2000-11"], [undefined, 40, MONTH]]);
    expect(calls.filter((c) => c.method === "invoices.create")).toHaveLength(2);
    expect(await usage.getVoiceUsageRow(o, "2000-11")).toMatchObject({ overageReportedMinutes: 3 });
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 40 });
    const { rows: [after] } = await db.query("select status, tier, stripe_customer_id, stripe_subscription_id from call_assistant_subscriptions where user_id = $1", [acct]);
    expect(after).toEqual({ status: "canceled", tier: null, stripe_customer_id: before.stripe_customer_id, stripe_subscription_id: before.stripe_subscription_id });
    // Nothing twice: the job is done, a second run has no job to run.
    calls.length = 0;
    expect(await usage.runVoiceSettlementsForAccount(acct, { stripe, configured: () => true })).toEqual([]);
    expect(calls).toEqual([]);

    // A call that was on the line when it ended still bills: the sweep (no month = every finished month) finds it
    // and bills the kept customer, invoiced now. Another account's months older than last month are swept too,
    // while the current month is left to accrue.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 2, at: AT });
    const acct2 = await user("lite");
    const o2 = org();
    await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: acct2, outcome: "info", billedMinutes: LITE + 5, at: new Date("2000-10-05T12:00:00Z") });
    await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: acct2, outcome: "info", billedMinutes: LITE + 6, at: new Date("2000-12-05T12:00:00Z") });
    await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: acct2, outcome: "info", billedMinutes: LITE + 7, at: new Date() });
    calls.length = 0;
    const sweep = await usage.reportAllVoiceOverage(undefined, { stripe, configured: () => true });
    expect(sweep.months).toEqual(expect.arrayContaining(["2000-10", "2000-12", MONTH]));
    expect(sweep.months).not.toContain(usage.voiceMonthKey());
    expect(mine().map((c) => [c.params.subscription, c.params.quantity, c.params.metadata.chub_month])).toEqual([[undefined, 2, MONTH]]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 42 });
    expect(await usage.getVoiceUsageRow(o2, "2000-10")).toMatchObject({ overageReportedMinutes: 5 });
    expect(await usage.getVoiceUsageRow(o2, "2000-12")).toMatchObject({ overageReportedMinutes: 6 });
    expect(await usage.getVoiceUsageRow(o2, usage.voiceMonthKey())).toMatchObject({ overageMinutes: 7, overageReportedMinutes: 0 });
    // A named month sweeps that month only.
    expect((await usage.reportAllVoiceOverage("2000-10", { stripe, configured: () => true })).months).toEqual([]);
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
    // A customer on the same month is unchanged: past the included minutes, the rest is overage.
    const o2 = org();
    expect(await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: payer, outcome: "info", billedMinutes: SOLO + 500, at: AT }))
      .toMatchObject({ includedMinutes: SOLO, overageMinutes: 500 });
  });

  it("claims (Codex audit #2): two settlements at once bill one range; a late call bills only the delta; a failed claim is retried as it is; a queued claim is invoiced when the subscription ends", async () => {
    const acct = await user("solo");
    const { rows: [subRow] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct]);
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 30, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const deps = { stripe, configured: () => true };
    // (1) The monthly report and the sweep running together (the real lock serialises them): one claim, one item.
    const [a, b] = await Promise.all([usage.reportVoiceOverage(o, MONTH, deps), usage.reportVoiceOverage(o, MONTH, deps)]);
    expect([a, b].map((r) => r.reported).sort()).toEqual([0, 30]);
    expect(calls.filter((c) => c.method === "invoiceItems.create")).toHaveLength(1);
    let claims = await usage.listVoiceOverageClaims(o, MONTH);
    expect(claims.map((c) => [c.fromMinutes, c.toMinutes, c.state, c.stripeSubscriptionId])).toEqual([[0, 30, "queued", subRow.stripe_subscription_id]]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 30 });

    // (2) A late call: only its minutes are claimed, from where the last claim ended; the ranges never overlap.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 7, at: AT });
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 7 });
    expect(calls.map((c) => [c.method, c.params.quantity, c.opts?.idempotencyKey])).toEqual([["invoiceItems.create", 7, `chub-voice-overage-${o}-${MONTH}-r50-37`]]);
    claims = await usage.listVoiceOverageClaims(o, MONTH);
    expect(claims.map((c) => [c.fromMinutes, c.toMinutes, c.state])).toEqual([[0, 30, "queued"], [30, 37, "queued"]]);

    // (3) A claim whose Stripe item fails stays `failed` with the error, the meter's counters untouched; the next run
    //     retries THAT claim as it is (same range, same key) — a call in between becomes a claim of its own after it.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 5, at: AT });
    const createItem = stripe.invoiceItems.create;
    stripe.invoiceItems.create = async () => { throw new Error("stripe item failed"); };
    await expect(usage.reportVoiceOverage(o, MONTH, deps)).rejects.toThrow("stripe item failed");
    claims = await usage.listVoiceOverageClaims(o, MONTH);
    expect(claims.map((c) => [c.fromMinutes, c.toMinutes, c.state, c.error])).toEqual([[0, 30, "queued", null], [30, 37, "queued", null], [37, 42, "failed", "stripe item failed"]]);
    // Claimed (the meter's "reported") before Stripe was asked: the failed claim's minutes are accounted for exactly once.
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 42 });
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 1, at: AT });
    stripe.invoiceItems.create = createItem;
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 6 });
    expect(calls.filter((c) => c.method === "invoiceItems.create").map((c) => [c.params.quantity, c.opts?.idempotencyKey])).toEqual([
      [5, `chub-voice-overage-${o}-${MONTH}-r50-42`], [1, `chub-voice-overage-${o}-${MONTH}-r50-43`],
    ]);
    claims = await usage.listVoiceOverageClaims(o, MONTH);
    expect(claims.map((c) => [c.fromMinutes, c.toMinutes, c.state])).toEqual([[0, 30, "queued"], [30, 37, "queued"], [37, 42, "queued"], [42, 43, "queued"]]);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 43 });
    expect(calls.filter((c) => c.method === "invoices.create")).toHaveLength(0); // monthly: queued for the subscription's next invoice

    // (4) The subscription ends before that invoice: "reported" was never "invoiced" — the settlement job invoices every
    //     queued claim now on the kept customer (one invoice takes every pending item), and the new minutes too.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 2, at: AT });
    await db.query("update call_assistant_subscriptions set status = 'canceled', tier = null where user_id = $1", [acct]);
    await usage.enqueueVoiceSettlement(db, { accountUserId: acct, stripeSubscriptionId: subRow.stripe_subscription_id, stripeCustomerId: subRow.stripe_customer_id, billingInterval: "month" });
    calls.length = 0;
    const [settled] = await usage.runVoiceSettlementsForAccount(acct, deps);
    expect(settled).toMatchObject({ claimed: 1, reportedMinutes: 2, queuedInvoiced: 0, invoiceId: "in_fake_5", outcome: "done" });
    // The new range was invoiced now (an ended subscription takes no items); that invoice included the four queued items,
    // and they were marked from the invoice's own lines.
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.create", "invoices.create", "invoices.listLineItems"]);
    expect(calls[0].params.subscription).toBeUndefined();
    expect(calls[1].params).toMatchObject({ customer: subRow.stripe_customer_id, pending_invoice_items_behavior: "include" });
    claims = await usage.listVoiceOverageClaims(o, MONTH);
    expect(claims.map((c) => [c.fromMinutes, c.toMinutes, c.state, c.stripeInvoiceId])).toEqual([
      [0, 30, "invoiced", "in_fake_5"], [30, 37, "invoiced", "in_fake_5"], [37, 42, "invoiced", "in_fake_5"], [42, 43, "invoiced", "in_fake_5"], [43, 45, "invoiced", "in_fake_5"],
    ]);
    // Nothing queued and nothing new: the job is done; nothing sent.
    calls.length = 0;
    expect(await usage.runVoiceSettlementsForAccount(acct, deps)).toEqual([]);
    expect(calls).toEqual([]);

    // (5) Queued claims with nothing new outstanding are still invoiced at the end (invoiceQueuedVoiceOverage).
    const acct2 = await user("lite");
    const { rows: [sub2] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct2]);
    const o2 = org();
    await usage.recordVoiceCallUsage({ orgId: o2, accountUserId: acct2, outcome: "info", billedMinutes: LITE + 9, at: AT });
    expect(await usage.reportVoiceOverage(o2, MONTH, deps)).toMatchObject({ reported: 9, invoiceId: null });
    await db.query("update call_assistant_subscriptions set status = 'canceled', tier = null where user_id = $1", [acct2]);
    await usage.enqueueVoiceSettlement(db, { accountUserId: acct2, stripeSubscriptionId: sub2.stripe_subscription_id, stripeCustomerId: sub2.stripe_customer_id, billingInterval: "month" });
    calls.length = 0;
    const [end2] = await usage.runVoiceSettlementsForAccount(acct2, deps);
    expect(end2).toMatchObject({ claimed: 0, reportedMinutes: 0, queuedInvoiced: 1, outcome: "done" });
    expect(calls.map((c) => [c.method, c.opts?.idempotencyKey])).toEqual([["invoices.create", `chub-voice-overage-queued-${sub2.stripe_subscription_id}-${(await usage.listVoiceOverageClaims(o2, MONTH))[0].id}`], ["invoices.listLineItems", undefined]]);
    expect((await usage.listVoiceOverageClaims(o2, MONTH)).map((c) => c.state)).toEqual(["invoiced"]);
    expect(await usage.invoiceQueuedVoiceOverage(acct2, sub2.stripe_subscription_id, deps)).toEqual({ claims: 0, invoiceId: null });
  });

  it("claims (Codex audit #3): a claim left `creating` is reconciled against Stripe before anything is created; a retry bills the claim's own stored request; overlapping ranges are refused; a failed settlement is recorded and the sweep retries it", async () => {
    const { pool } = await import("../db");
    const acct = await user("solo");
    const { rows: [subRow] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct]);
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 8, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls, items } = fakeStripe("price_existing");
    const deps = { stripe, configured: () => true };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    // (1) Claim under the lock, nothing at Stripe yet: the claim carries its whole request (its origin subscription,
    //     a UUID for the item's metadata), the meter counts it as claimed.
    const { claims: [claim] } = await usage.claimVoiceOverage(o, MONTH, deps);
    expect(claim).toMatchObject({ fromMinutes: 0, toMinutes: 8, minutes: 8, state: "creating", stripeCustomerId: subRow.stripe_customer_id, stripeSubscriptionId: subRow.stripe_subscription_id, billingInterval: "month", billedOnCustomer: false, idempotencyKey: `chub-voice-overage-${o}-${MONTH}-r50-8`, stripeInvoiceItemId: null });
    expect(claim.uid).toMatch(uuid);
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ overageReportedMinutes: 8 });
    expect(calls).toEqual([]);
    // A crash after the Stripe call and before the record (the attempt was counted first): the item exists at Stripe
    // with the claim's UUID and the whole request in its metadata — adopted, nothing created.
    items.push({ id: "ii_crashed", customer: subRow.stripe_customer_id, subscription: subRow.stripe_subscription_id, quantity: 8, metadata: { chub_kind: "voice_overage", chub_claim: claim.uid, chub_org: o, chub_month: MONTH, chub_cents_per_minute: "50", chub_minutes: "8" }, invoice: null });
    await pool.query("update voice_overage_claims set attempts = 1 where id = $1", [claim.id]);
    const line = await usage.processVoiceOverageClaim({ ...claim, attempts: 1 }, deps);
    expect(line).toMatchObject({ invoiceItemId: "ii_crashed", claimId: claim.id, minutes: 8 });
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.list"]);
    expect((await usage.listVoiceOverageClaims(o, MONTH))[0]).toMatchObject({ state: "queued", stripeInvoiceItemId: "ii_crashed", attempts: 2 });
    // An item that matches the UUID but not the request (another quantity) is NOT adopted; a listing that cannot be
    // completed fails closed (the claim stays creating, error "reconcile_incomplete", nothing created).
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 3, at: AT });
    calls.length = 0;
    const { claims: [second] } = await usage.claimVoiceOverage(o, MONTH, deps);
    expect(second).toMatchObject({ fromMinutes: 8, toMinutes: 11, state: "creating" });
    items.push({ id: "ii_wrong", customer: subRow.stripe_customer_id, subscription: subRow.stripe_subscription_id, quantity: 99, metadata: { chub_kind: "voice_overage", chub_claim: second.uid, chub_org: o, chub_month: MONTH, chub_cents_per_minute: "50", chub_minutes: "99" }, invoice: null });
    await pool.query("update voice_overage_claims set attempts = 1 where id = $1", [second.id]);
    const list = stripe.invoiceItems.list;
    stripe.invoiceItems.list = async () => { throw new Error("listing failed"); };
    await expect(usage.processVoiceOverageClaim({ ...second, attempts: 1 }, deps)).rejects.toThrow("listing failed");
    stripe.invoiceItems.list = async (params: any) => ({ ...(await list(params)), has_more: true });
    const [leased] = await pool.query("update voice_overage_claims set leased_until = null where id = $1 returning id", [second.id]).then((r) => r.rows);
    expect(leased).toBeTruthy();
    const { claims: [again] } = await usage.claimVoiceOverage(o, MONTH, deps);
    await expect(usage.processVoiceOverageClaim(again, deps)).rejects.toThrow(/reconcile_incomplete/);
    expect((await usage.listVoiceOverageClaims(o, MONTH))[1]).toMatchObject({ state: "creating", stripeInvoiceItemId: null, error: "reconcile_incomplete" });
    expect(calls.filter((c) => c.method === "invoiceItems.create")).toHaveLength(0);
    // With the listing whole again and no true match: created under the claim's own key, with its UUID in the metadata.
    stripe.invoiceItems.list = list;
    calls.length = 0;
    const { claims: [third] } = await usage.claimVoiceOverage(o, MONTH, deps);
    expect(third.id).toBe(second.id);
    await usage.processVoiceOverageClaim(third, deps);
    expect(calls.map((c) => c.method)).toEqual(["invoiceItems.list", "prices.list", "invoiceItems.create"]);
    expect(calls[2].params.metadata).toMatchObject({ chub_kind: "voice_overage", chub_claim: second.uid, chub_org: o, chub_month: MONTH, chub_cents_per_minute: "50", chub_minutes: "3" });
    expect(calls[2].opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r50-11`);
    expect(calls[2].params.subscription).toBe(subRow.stripe_subscription_id);

    // (2) A retry bills the claim's own stored request, never the account's subscription of today: the item fails once
    //     while the subscription is monthly; the account then moves to a different (annual) subscription; the retry still
    //     attaches the item to the subscription the claim was made under.
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 4, at: AT });
    const createItem = stripe.invoiceItems.create;
    stripe.invoiceItems.create = async () => { throw new Error("item failed once"); };
    await expect(usage.reportVoiceOverage(o, MONTH, deps)).rejects.toThrow("item failed once");
    stripe.invoiceItems.create = createItem;
    await db.query("update call_assistant_subscriptions set stripe_subscription_id = 'sub_replacement', billing_interval = 'year' where user_id = $1", [acct]);
    calls.length = 0;
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toMatchObject({ reported: 4 });
    const retried = calls.find((c) => c.method === "invoiceItems.create")!;
    expect(retried.params.subscription).toBe(subRow.stripe_subscription_id);
    expect(retried.opts?.idempotencyKey).toBe(`chub-voice-overage-${o}-${MONTH}-r50-15`);
    expect(calls.filter((c) => c.method === "invoices.create")).toHaveLength(0);
    expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.fromMinutes, c.toMinutes, c.state, c.stripeSubscriptionId, c.billingInterval])).toEqual([
      [0, 8, "queued", subRow.stripe_subscription_id, "month"], [8, 11, "queued", subRow.stripe_subscription_id, "month"], [11, 15, "queued", subRow.stripe_subscription_id, "month"],
    ]);

    // (3) The ranges can't overlap, as DATABASE invariants: the CHECKs refuse an empty or backwards range, a zero rate and a
    //     quantity that is not the range; the UNIQUE a second claim at one start; the EXCLUDE (btree_gist — this test
    //     database's user may create it) any overlapping range; and the claim function a range over an existing one.
    expect((await usage.voiceOverageAdminStatus()).constraints).toEqual({ btreeGist: true, overlapExclusion: true, rangeCheck: true });
    await expect(pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, idempotency_key) values ($1, $2, $3, 50, 20, 20, 0, 'k')", [o, acct, MONTH])).rejects.toThrow(/voice_overage_claims_range_check/);
    await expect(pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, idempotency_key) values ($1, $2, $3, 0, 20, 21, 1, 'k')", [o, acct, MONTH])).rejects.toThrow(/voice_overage_claims_rate_check/);
    await expect(pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, idempotency_key) values ($1, $2, $3, 50, 20, 25, 4, 'k')", [o, acct, MONTH])).rejects.toThrow(/voice_overage_claims_minutes_check/);
    await expect(pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, idempotency_key) values ($1, $2, $3, 50, 8, 9, 1, 'k')", [o, acct, MONTH])).rejects.toThrow(/duplicate key/);
    await expect(pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, idempotency_key) values ($1, $2, $3, 50, 9, 20, 11, 'k')", [o, acct, MONTH])).rejects.toThrow(/voice_overage_claims_no_overlap/);
    await pool.query("insert into voice_overage_claims (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, state, idempotency_key) values ($1, $2, $3, 50, 30, 40, 10, 'queued', 'k')", [o, acct, MONTH]);
    await db.query("update voice_usage set overage_minutes = 35, overage_rate_minutes = '{\"50\": 35}'::jsonb, overage_reported_minutes = 15, overage_reported_rate_minutes = '{\"50\": 15}'::jsonb where org_id = $1 and month = $2", [o, MONTH]);
    // The meter says 15 claimed and 35 owed, but a claim already covers [30, 40): the next claim starts at 40, so nothing new.
    expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "nothing_to_report" });
    await pool.query("delete from voice_overage_claims where org_id = $1 and from_minutes = 30", [o]);
    await db.query("update voice_usage set overage_minutes = 15, overage_rate_minutes = '{\"50\": 15}'::jsonb where org_id = $1 and month = $2", [o, MONTH]);

    // (4) A failed settlement is persisted work: the job records its failure (and an ops issue) and the sweep retries it until
    //     every claim of ITS subscription is verified invoiced. (The month's usage row names the subscription its latest call
    //     was under; the settlement claims only that subscription's months.)
    await db.query("update call_assistant_subscriptions set status = 'active', tier = 'solo', stripe_subscription_id = $2, billing_interval = 'month' where user_id = $1", [acct, subRow.stripe_subscription_id]);
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 6, at: AT });
    expect((await usage.getVoiceUsageRow(o, MONTH))!.stripeSubscriptionId).toBe(subRow.stripe_subscription_id);
    await db.query("update call_assistant_subscriptions set status = 'canceled', tier = null where user_id = $1", [acct]);
    await usage.enqueueVoiceSettlement(pool, { accountUserId: acct, stripeSubscriptionId: subRow.stripe_subscription_id, stripeCustomerId: subRow.stripe_customer_id, billingInterval: "month" });
    const createInvoice = stripe.invoices.create;
    stripe.invoices.create = async () => { throw new Error("invoice failed"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(usage.runVoiceSettlementsForAccount(acct, deps)).rejects.toThrow("invoice failed");
    expect((await usage.listPendingVoiceSettlements(acct)).map((j) => [j.state, j.attempts, j.error])).toEqual([["failed", 1, "invoice failed"]]);
    stripe.invoices.create = createInvoice;
    calls.length = 0;
    const sweep = await usage.sweepVoiceOverage(deps);
    expect(sweep).toMatchObject({ settlementsFailed: 0 });
    expect(sweep.settlementsRun).toBeGreaterThanOrEqual(1);
    expect(await usage.listPendingVoiceSettlements(acct)).toEqual([]);
    const { rows: [job] } = await pool.query("select state, attempts from voice_settle_jobs where stripe_subscription_id = $1 order by id desc limit 1", [subRow.stripe_subscription_id]);
    expect(job).toEqual({ state: "done", attempts: 2 });
    // Every claim of the month is invoiced now (the new 6 minutes on their own invoice, which also took the queued items,
    // each marked from the invoice's lines), and their origin subscription is still on them.
    expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.fromMinutes, c.toMinutes, c.state, c.stripeSubscriptionId])).toEqual([
      [0, 8, "invoiced", subRow.stripe_subscription_id], [8, 11, "invoiced", subRow.stripe_subscription_id], [11, 15, "invoiced", subRow.stripe_subscription_id], [15, 21, "invoiced", subRow.stripe_subscription_id],
    ]);
    expect(calls.filter((c) => c.method === "invoices.create" && c.params.customer === subRow.stripe_customer_id).length).toBeGreaterThanOrEqual(1);
    // Jobs are append-only: a done job is never reopened; new work for the subscription gets a new job.
    await usage.enqueueVoiceSettlement(pool, { accountUserId: acct, stripeSubscriptionId: subRow.stripe_subscription_id, stripeCustomerId: subRow.stripe_customer_id, billingInterval: "month" });
    expect((await pool.query("select state from voice_settle_jobs where stripe_subscription_id = $1 order by id", [subRow.stripe_subscription_id])).rows.map((r) => r.state)).toEqual(["done", "pending"]);
    expect((await usage.runVoiceSettlementsForAccount(acct, deps)).map((r) => r.outcome)).toEqual(["done"]);

    // (5) The safety net: a queued claim on an ended subscription with no job gets one on the next sweep.
    const acct3 = await user("lite");
    const { rows: [sub3] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct3]);
    const o3 = org();
    await usage.recordVoiceCallUsage({ orgId: o3, accountUserId: acct3, outcome: "info", billedMinutes: LITE + 2, at: AT });
    expect(await usage.reportVoiceOverage(o3, MONTH, deps)).toMatchObject({ reported: 2, invoiceId: null });
    await db.query("update call_assistant_subscriptions set status = 'canceled', tier = null where user_id = $1", [acct3]);
    const sweep2 = await usage.sweepVoiceOverage(deps);
    expect(sweep2.settlementsQueued).toBeGreaterThanOrEqual(1);
    expect((await usage.listVoiceOverageClaims(o3, MONTH)).map((c) => c.state)).toEqual(["invoiced"]);
    const { rows: [job3] } = await pool.query("select state from voice_settle_jobs where stripe_subscription_id = $1 order by id desc limit 1", [sub3.stripe_subscription_id]);
    expect(job3).toEqual({ state: "done" });
  });

  it("the meter record (Codex audit #5): a call is counted exactly once however often it is reported; a failed meter stays pending and the retry counts it once", async () => {
    const acct = await user("solo");
    const o = org();
    const callId = `call-${randomUUID()}`;
    // A pool whose transaction fails at the month's upsert once: the record stays pending, nothing is counted.
    let failOnce = true;
    const flaky = {
      query: (text: string, values?: unknown[]) => db.query(text, values as any),
      connect: async () => {
        const client = await db.connect();
        return {
          query: async (text: string, values?: unknown[]) => {
            if (failOnce && /INSERT INTO voice_usage/.test(text)) { failOnce = false; throw new Error("meter upsert failed"); }
            return client.query(text, values as any);
          },
          release: (err?: Error) => client.release(err),
        };
      },
    };
    await expect(usage.meterVoiceCall({ callId, orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 4, at: AT }, flaky as any)).rejects.toThrow("meter upsert failed");
    expect((await db.query("select state, attempts, error, billed_minutes from voice_call_meter where call_id = $1", [callId])).rows[0]).toEqual({ state: "pending", attempts: 1, error: "meter upsert failed", billed_minutes: 4 });
    expect(await usage.getVoiceUsageRow(o, MONTH)).toBeNull();
    // The retry worker meters it, once; a repeat of the end report afterwards counts nothing again.
    expect(await usage.retryPendingVoiceMeters(flaky as any)).toMatchObject({ metered: 1, failed: 0 });
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 1, minutes: 4 });
    expect((await db.query("select state, attempts, error from voice_call_meter where call_id = $1", [callId])).rows[0]).toEqual({ state: "done", attempts: 2, error: null });
    expect(await usage.meterVoiceCall({ callId, orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 4, at: AT }, flaky as any)).toMatchObject({ calls: 1, minutes: 4 });
    expect(await usage.retryPendingVoiceMeters(flaky as any)).toMatchObject({ pending: 0 });
    // Two reports of one new call at once: counted once.
    const callId2 = `call-${randomUUID()}`;
    await Promise.all([1, 2, 3].map(() => usage.meterVoiceCall({ callId: callId2, orgId: o, accountUserId: acct, outcome: "info", billedMinutes: 5, at: AT }, db as any)));
    expect(await usage.getVoiceUsageRow(o, MONTH)).toMatchObject({ calls: 2, minutes: 9 });
    await db.query("delete from voice_call_meter where call_id = any($1::text[])", [[callId, callId2]]);
  });

  it("a call is acknowledged only with its durable meter task (Codex audit #6): a failed initial insertion leaves the call unprocessed; a processed call flagged pending with no record is recovered from the call row — counted exactly once either way", async () => {
    const { acknowledgeCall } = await import("./internal-calls");
    const bag = made();
    const acct = await makeAccount(db, bag, { plan: null });
    orgs.push(acct.orgId);
    const call = await makeCall(db, acct.orgId);
    const at = AT;
    const flags = async () => (await db.query("select flags from voice_calls where id = $1", [call.id])).rows[0].flags ?? {};
    try {
      // (1) The INITIAL insertion fails: nothing is acknowledged (no processedAt, no meter row), the engine's retry runs again.
      const failing = { connect: async () => { const c = await db.connect(); return { query: async (text: string, values?: unknown[]) => { if (/INSERT INTO voice_call_meter/.test(text)) throw new Error("meter row failed"); return c.query(text, values as any); }, release: (e?: Error) => c.release(e) }; } };
      await expect(acknowledgeCall({ callId: call.id, orgId: acct.orgId, accountUserId: acct.userId, outcome: "info", billedMinutes: 6, at, patch: { processedAt: new Date().toISOString(), meterPending: true } }, failing)).rejects.toThrow("meter row failed");
      expect((await flags()).processedAt).toBeUndefined();
      expect((await db.query("select 1 from voice_call_meter where call_id = $1", [call.id])).rows).toEqual([]);
      // The retry acknowledges: the processed flag and the meter task in one transaction; then the count, once.
      await acknowledgeCall({ callId: call.id, orgId: acct.orgId, accountUserId: acct.userId, outcome: "info", billedMinutes: 6, at, patch: { processedAt: new Date().toISOString(), meterPending: true } }, db as any);
      expect((await flags()).processedAt).toBeTruthy();
      expect((await db.query("select state, billed_minutes from voice_call_meter where call_id = $1", [call.id])).rows[0]).toEqual({ state: "pending", billed_minutes: 6 });
      expect((await db.query("select outcome, billed_minutes from voice_calls where id = $1", [call.id])).rows[0]).toEqual({ outcome: "info", billed_minutes: 6 });
      expect(await usage.retryPendingVoiceMeters(db as any)).toMatchObject({ metered: 1, failed: 0 });
      expect(await usage.getVoiceUsageRow(acct.orgId, MONTH)).toMatchObject({ calls: 1, minutes: 6 });
      expect(await flags()).toMatchObject({ meterPending: false, metered: 6 });
      expect(await usage.retryPendingVoiceMeters(db as any)).toMatchObject({ pending: 0 });
      // (2) A processed call flagged pending with NO meter record (the safety net): recovered from the call row itself.
      const call2 = await makeCall(db, acct.orgId);
      await db.query("update voice_calls set outcome = 'info', billed_minutes = 4, started_at = $2, flags = '{\"processedAt\": \"2001-01-15T12:00:00Z\", \"meterPending\": true}'::jsonb where id = $1", [call2.id, at]);
      expect(await usage.retryPendingVoiceMeters(db as any)).toMatchObject({ pending: 1, metered: 1, failed: 0 });
      expect(await usage.getVoiceUsageRow(acct.orgId, MONTH)).toMatchObject({ calls: 2, minutes: 10 });
      expect((await db.query("select state from voice_call_meter where call_id = $1", [call2.id])).rows[0]).toEqual({ state: "done" });
      expect(await usage.retryPendingVoiceMeters(db as any)).toMatchObject({ pending: 0 });
      expect(await usage.getVoiceUsageRow(acct.orgId, MONTH)).toMatchObject({ calls: 2, minutes: 10 });
    } finally {
      await db.query("delete from voice_call_meter where org_id = $1", [acct.orgId]);
      await cleanup(db, bag);
    }
  });

  it("the safety switch (CALL_ASSISTANT_OVERAGE_BILLING, default off): off, minutes are metered and nothing reaches Stripe — no claim, no item, no invoice, settlement jobs recorded but not run; on, the same work is done", async () => {
    const acct = await user("solo");
    const { rows: [subRow] } = await db.query("select stripe_subscription_id, stripe_customer_id from call_assistant_subscriptions where user_id = $1", [acct]);
    const o = org();
    await usage.recordVoiceCallUsage({ orgId: o, accountUserId: acct, outcome: "info", billedMinutes: SOLO + 12, at: AT });
    usage.resetVoiceOveragePriceCache();
    const { stripe, calls } = fakeStripe("price_existing");
    const deps = { stripe, configured: () => true };
    const prior = process.env.CALL_ASSISTANT_OVERAGE_BILLING;
    try {
      delete process.env.CALL_ASSISTANT_OVERAGE_BILLING; // unset = off
      expect(usage.voiceOverageBillingState()).toBe("off");
      expect(usage.voiceOverageWorkerOffReason({ VOICE_OVERAGE_WORKER_ENABLED: "true", STRIPE_SECRET_KEY: "sk", NODE_ENV: "production" } as any)).toMatch(/CALL_ASSISTANT_OVERAGE_BILLING/);
      // Metered and visible, never claimed or charged.
      expect(await usage.reportVoiceOverage(o, MONTH, deps)).toEqual({ reported: 0, reason: "billing_off" });
      expect(usage.summarizeVoiceUsage(await usage.getVoiceUsageRow(o, MONTH), MONTH, SOLO)).toMatchObject({ overageMinutes: 12, overageReportedMinutes: 0 });
      expect(await usage.listVoiceOverageClaims(o, MONTH)).toEqual([]);
      // The end of the subscription: its job is recorded, not run.
      await db.query("update call_assistant_subscriptions set status = 'canceled', tier = null where user_id = $1", [acct]);
      await usage.enqueueVoiceSettlement(db, { accountUserId: acct, stripeSubscriptionId: subRow.stripe_subscription_id, stripeCustomerId: subRow.stripe_customer_id, billingInterval: "month" });
      expect(await usage.runVoiceSettlementsForAccount(acct, deps)).toEqual([]);
      expect((await usage.listPendingVoiceSettlements(acct)).map((j) => [j.state, j.attempts])).toEqual([["pending", 0]]);
      expect(await usage.sweepVoiceOverage(deps)).toMatchObject({ billing: "off", settlementsRun: 0, claimsRetried: 0, months: { orgs: 0 } });
      expect(calls).toEqual([]);
      expect((await usage.voiceOverageAdminStatus()).overageBilling).toBe("off");
      for (const v of ["ON", " on "]) { process.env.CALL_ASSISTANT_OVERAGE_BILLING = v; expect(usage.voiceOverageBillingState()).toBe("on"); }
      process.env.CALL_ASSISTANT_OVERAGE_BILLING = "yes";
      expect(usage.voiceOverageBillingState()).toBe("off");
      // On: the recorded job runs and the minutes are billed on the kept customer.
      process.env.CALL_ASSISTANT_OVERAGE_BILLING = "on";
      const [run] = await usage.runVoiceSettlementsForAccount(acct, deps);
      expect(run).toMatchObject({ claimed: 1, reportedMinutes: 12, outcome: "done" });
      expect(calls.map((c) => c.method)).toEqual(["prices.list", "invoiceItems.create", "invoices.create", "invoices.listLineItems"]);
      expect((await usage.listVoiceOverageClaims(o, MONTH)).map((c) => [c.minutes, c.state, c.billedOnCustomer, c.stripeSubscriptionId])).toEqual([[12, "invoiced", true, subRow.stripe_subscription_id]]);
      expect(await usage.listPendingVoiceSettlements(acct)).toEqual([]);
    } finally {
      process.env.CALL_ASSISTANT_OVERAGE_BILLING = prior;
    }
  });

  it("the sweep bills every org with unreported overage in the month and reports what it skipped", async () => {
    // Its own month so the other tests' rows don't count.
    const month = "2001-02", at = new Date("2001-02-10T00:00:00Z");
    const billed = org(), skipped = org();
    await usage.recordVoiceCallUsage({ orgId: billed, accountUserId: payer, outcome: "info", billedMinutes: SOLO + 2, at });
    await usage.recordVoiceCallUsage({ orgId: skipped, accountUserId: unpaid, outcome: "info", billedMinutes: 1, at });
    usage.resetVoiceOveragePriceCache();
    const { stripe } = fakeStripe("price_existing");
    const out = await usage.reportAllVoiceOverage(month, {
      stripe, configured: () => true,
      subscriptionFor: async (id) => (id === payer ? { stripeCustomerId: "cus_z", stripeSubscriptionId: "sub_z", status: "active", billingInterval: "month" } : null),
    });
    expect(out).toEqual({ month, months: [month], orgs: 1, reportedMinutes: 2, reportedCents: 100, skipped: { no_customer: 1 } });
  });
});
