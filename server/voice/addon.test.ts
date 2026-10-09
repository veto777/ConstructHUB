/**
 * The Call Assistant module (architect-owned): the price book block, the
 * module entitlement from the service's OWN subscription (owner, 2026-10-08:
 * a separate service, bought with or without a platform plan) and the 402
 * every /api/crm/voice/* route answers without it. Pure functions — no server,
 * no DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: undefined as any }));
vi.mock("../db", () => ({
  pool: {
    query: vi.fn(async (text: string) => {
      if (/FROM users u/.test(text)) return { rows: mocks.row ? [mocks.row] : [] };
      return { rows: [] };
    }),
  },
  db: {},
}));
import {
  getEntitlements, addonModulesFor, addonModulesPausedFor, moduleEnabled, modulePaused, callAssistantAllowance, ADMIN_CALL_ASSISTANT_NUMBERS,
  sendModuleRequired, requireModule, allowancesFor,
} from "../entitlements";
import {
  ADDONS, ADDON_MODULES, ADDON_MODULE_UNLOCKED_BY, PLANS, PLAN_KEYS, MODULE_NAMES, SALES_THRESHOLD_CENTS, moduleName, isAddonModule,
  CALL_ASSISTANT_TIERS, CALL_ASSISTANT_TIER_ADDONS, CALL_ASSISTANT_ADDONS, CALL_ASSISTANT_ANNUAL_MONTHS, CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE,
  CALL_ASSISTANT_OVERAGE_RATES, CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, CALL_ASSISTANT_FROM_CENTS, CALL_ASSISTANT_NOT_INCLUDED_LINE,
  callAssistantTier, callAssistantAddonsOf, withoutCallAssistantAddons, isCallAssistantAddon,
} from "@shared/plans";
import { CRM_PLANS, CRM_PLAN_KEYS } from "@shared/crm-plans";
import { checkAddonsForPlan, BillingRequestError } from "../billing/order";
import { AGENCY_ONLY_MODULES, PLATFORM_ADDONS, addonLines } from "@shared/plan-copy";
import { voiceProfileSchema, defaultVoiceProfile, decisionSchema, DEFAULT_INTAKE_QUESTIONS } from "@shared/voice-profile";
import { VOICE_PERSONAS, VOICE_PERSONA_IDS } from "@shared/voice-personas";
import { compileVoiceProfile } from "./prompt-compiler";
import { VOICE_SCHEMA_DDL, VOICE_TABLES } from "./schema";

const res = () => { const r: any = { status: vi.fn(() => r), json: vi.fn(() => r), setHeader: vi.fn() }; return r; };
/** The platform subscription row as accountSubscriptionRow joins it (no Call Assistant columns: none bought). */
const customer = (plan: string | null, extra: Record<string, unknown> = {}) =>
  ({ email: "owner@example.invalid", plan, status: plan ? "active" : null, stripe_subscription_id: plan ? "sub_fixture" : null, current_period_end: null, ...extra });
/** The Call Assistant's own subscription, as the call_assistant_* columns the same query joins in (server/voice/subscription-store.ts). */
const callAssistant = (tier: string | null, status: string, extraNumbers = 0) => ({
  call_assistant_tier: tier, call_assistant_status: status, call_assistant_extra_numbers: extraNumbers,
  call_assistant_interval: "month", call_assistant_subscription_id: "sub_ca_fixture",
});

beforeEach(() => { mocks.row = undefined; });

describe("price book: the AI Call Assistant, a separate service (owner, 2026-10-08)", () => {
  it("four tiers named by their minutes, one overage rate, yearly at 11 × monthly, no intro, nothing above the top tier", () => {
    expect(CALL_ASSISTANT_TIERS.map((t) => [t.tier, t.addon, t.name, t.monthlyCents, t.annualCents, t.includedMinutes, t.includedNumbers, t.overageCentsPerMinute])).toEqual([
      ["lite", "call_assistant_lite", "500 minutes", 24_900, 273_900, 500, 1, 50],
      ["solo", "call_assistant", "1,000 minutes", 34_900, 383_900, 1_000, 1, 50],
      ["crew", "call_assistant_crew", "2,000 minutes", 44_900, 493_900, 2_000, 2, 50],
      ["fleet", "call_assistant_fleet", "5,000 minutes", 99_900, 1_098_900, 5_000, 5, 50],
    ]);
    // Voice keeps its independent annual multiplier and existing prices.
    expect(CALL_ASSISTANT_ANNUAL_MONTHS).toBe(11);
    for (const t of CALL_ASSISTANT_TIERS) {
      expect(t.annualCents).toBe(t.monthlyCents * CALL_ASSISTANT_ANNUAL_MONTHS);
      // The top tier is $999: listed. More minutes than it is a sales conversation, never a tier.
      expect(t.monthlyCents).toBeLessThan(SALES_THRESHOLD_CENTS);
      const a = ADDONS[t.addon];
      expect(a).toMatchObject({ key: t.addon, name: `AI Call Assistant — ${t.name}`, monthlyCents: t.monthlyCents, annualCents: t.annualCents, availableOn: [], exclusiveGroup: "call_assistant_tier", grants: {} });
      expect(a.introMonthlyCents).toBeUndefined();
      expect(a.introMonths).toBeUndefined();
      expect(a.preview ?? false).toBe(false);
      expect(a.setupCents).toBeUndefined();
      expect(a.description).toContain(`${t.includedMinutes.toLocaleString("en-US")} call minutes a month`);
      expect(a.description).toContain("then $0.50 a minute");
    }
    // Owner, 2026-10-08: 50 cents a minute on every tier (the 10¢ / 5¢ rates were below cost).
    expect(CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE).toBe(50);
    expect(CALL_ASSISTANT_OVERAGE_RATES).toEqual([50]);
    expect(CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS).toBe(50);
    expect(CALL_ASSISTANT_FROM_CENTS).toBe(24_900);
    expect(callAssistantTier("fleet").includedNumbers).toBe(5);
    // The extra number is a line of the same subscription, at the old contract's yearly price (10 × monthly; the repricing named the tiers only) too, and it needs a tier.
    expect(ADDONS.call_number).toMatchObject({ key: "call_number", monthlyCents: 500, annualCents: 5_000, availableOn: [], grants: {}, requires: CALL_ASSISTANT_TIER_ADDONS });
    expect(CALL_ASSISTANT_TIER_ADDONS).toEqual(["call_assistant_lite", "call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
    expect(CALL_ASSISTANT_ADDONS).toEqual([...CALL_ASSISTANT_TIER_ADDONS, "call_number"]);
    for (const key of CALL_ASSISTANT_ADDONS) expect(isCallAssistantAddon(key)).toBe(true);
    expect(isCallAssistantAddon("extra_seat")).toBe(false);
    expect(callAssistantAddonsOf("crew", 2)).toEqual({ call_assistant_crew: 1, call_number: 2 });
    expect(callAssistantAddonsOf("lite")).toEqual({ call_assistant_lite: 1 });
    expect(callAssistantAddonsOf(null, 2)).toEqual({});
    expect(withoutCallAssistantAddons({ call_assistant: 1, call_number: 2, extra_seat: 3 })).toEqual({ extra_seat: 3 });
  });

  it("no plan sells it — every platform plan AND every CRM plan says so at checkout, with the real starting price", () => {
    expect(CALL_ASSISTANT_NOT_INCLUDED_LINE).toBe("The AI Call Assistant — answers your phone 24/7, screens spam and files the lead (a separate service, from $249/mo)");
    for (const key of PLAN_KEYS) {
      // The CRM leads the list (owner, 2026-10-07); the Call Assistant follows it.
      expect(PLANS[key].notIncluded[0], key).toMatch(/ConstructHUB CRM/);
      expect(PLANS[key].notIncluded[1], key).toBe(CALL_ASSISTANT_NOT_INCLUDED_LINE);
      // A feature may reference the service only to exclude it (Unlimited: "Call Assistant minutes excluded").
      expect(PLANS[key].features.join(" "), key).not.toMatch(/(AI )?Call Assistant(?! minutes excluded)/);
    }
    for (const key of CRM_PLAN_KEYS) expect(CRM_PLANS[key].notIncluded, key).toContain(CALL_ASSISTANT_NOT_INCLUDED_LINE);
    // The platform's add-on list is the platform's: none of the Call Assistant's lines is on it.
    expect(PLATFORM_ADDONS.map((a) => a.key)).toEqual(["extra_seat", "protected_site", "texting_number", "competitor_pack", "grid_pack", "seo_basic", "seo_pro"]);
    expect(addonLines()).toHaveLength(PLATFORM_ADDONS.length);
    expect(addonLines().join("\n")).not.toMatch(/Call Assistant/);
  });

  it("is an add-on module, not a plan module: only Unlimited has modules of its own", () => {
    expect(ADDON_MODULES.callAssistant).toBe("call_assistant");
    expect(ADDON_MODULE_UNLOCKED_BY.callAssistant).toEqual(CALL_ASSISTANT_TIER_ADDONS);
    expect(isAddonModule("callAssistant")).toBe(true);
    expect(isAddonModule("adsManager")).toBe(false);
    expect(Object.keys(MODULE_NAMES)).not.toContain("callAssistant");
    // On the five-plan book only white-label reports and the Master Class are Unlimited-exclusive.
    expect(AGENCY_ONLY_MODULES).toEqual(["White-label reports", "Master Class"]);
    expect(moduleName("callAssistant")).toBe("AI Call Assistant");
    for (const k of PLAN_KEYS) expect((PLANS[k].modules as any).callAssistant).toBeUndefined();
  });

  it("the platform checkout refuses every Call Assistant line on every plan and sends the buyer to the service's own checkout", () => {
    const refusal = (fn: () => void): any => { try { fn(); } catch (e) { return e; } return null; };
    for (const plan of PLAN_KEYS) {
      for (const key of CALL_ASSISTANT_ADDONS) {
        const e = refusal(() => checkAddonsForPlan(plan, { [key]: 1 }));
        expect(e, `${plan} + ${key}`).toBeInstanceOf(BillingRequestError);
        expect(e).toMatchObject({ status: 400, code: "addon_unavailable" });
        expect(e.message).toMatch(/isn't a plan add-on/);
        expect(e.message).toMatch(/separate service with its own subscription, from \$249\/mo/);
        expect(e.message).toContain("/pricing#call-assistant");
      }
    }
    // The platform's own add-ons are untouched. protected_site is sold on starter now;
    // it is not sold on Unlimited, which includes unlimited protected sites.
    expect(() => checkAddonsForPlan("growth", { competitor_pack: 1 })).not.toThrow();
    expect(() => checkAddonsForPlan("starter", { protected_site: 1 })).not.toThrow();
    expect(() => checkAddonsForPlan("agency", { protected_site: 1 })).toThrow(/isn't available on the Unlimited plan/);
  });
});

describe("entitlements: the callAssistant module comes from the service's own subscription", () => {
  it("is on while that subscription holds a tier and is active or trialing; paused on a payment-needed status; never from a plan", () => {
    expect(addonModulesFor({ tier: "lite", status: "active" })).toEqual({ callAssistant: true });
    expect(addonModulesFor({ tier: "fleet", status: "trialing" })).toEqual({ callAssistant: true });
    expect(addonModulesFor({ tier: "solo", status: "past_due" })).toEqual({ callAssistant: false });
    expect(addonModulesFor({ tier: "solo", status: "canceled" })).toEqual({ callAssistant: false });
    expect(addonModulesFor({ tier: null, status: "active" })).toEqual({ callAssistant: false });
    expect(addonModulesFor(null)).toEqual({ callAssistant: false });
    expect(addonModulesFor(null, true)).toEqual({ callAssistant: true });
    expect(addonModulesFor({ tier: "solo", status: "past_due" }, true)).toEqual({ callAssistant: true });
    expect(addonModulesPausedFor({ tier: "solo", status: "past_due" })).toEqual({ callAssistant: true });
    expect(addonModulesPausedFor({ tier: "crew", status: "unpaid" })).toEqual({ callAssistant: true });
    expect(addonModulesPausedFor({ tier: null, status: "past_due" })).toEqual({ callAssistant: false });
    expect(addonModulesPausedFor({ tier: "solo", status: "canceled" })).toEqual({ callAssistant: false });
    expect(addonModulesPausedFor({ tier: "solo", status: "active" })).toEqual({ callAssistant: false });
    expect(addonModulesPausedFor({ tier: "solo", status: "past_due" }, true)).toEqual({ callAssistant: false });
    // The tiers raise no platform count limit.
    expect(allowancesFor("pro", { call_assistant: 2, call_number: 3 })).toEqual(PLANS.pro.limits);
  });

  it("buys the held tier's numbers and minutes plus extra numbers; platform admins get unlimited minutes and up to 5 numbers", () => {
    const allowance = (addons: Record<string, number>, isPlatformAdmin = false) =>
      callAssistantAllowance({ addonModules: { callAssistant: true }, addons, isPlatformAdmin });
    expect(allowance({ call_assistant_lite: 1 })).toEqual({ numbers: 1, minutes: 500, overageCentsPerMinute: 50 });
    expect(allowance({ call_assistant: 1, call_number: 3 })).toEqual({ numbers: 1 + 3, minutes: 1_000, overageCentsPerMinute: 50 });
    expect(allowance({ call_assistant_crew: 1 })).toEqual({ numbers: 2, minutes: 2_000, overageCentsPerMinute: 50 });
    expect(allowance({ call_assistant_fleet: 1, call_number: 1 })).toEqual({ numbers: 6, minutes: 5_000, overageCentsPerMinute: 50 });
    expect(callAssistantAllowance({ addonModules: { callAssistant: false }, addons: { call_assistant: 2 }, isPlatformAdmin: false })).toEqual({ numbers: 0, minutes: 0, overageCentsPerMinute: 0 });
    expect(allowance({}, true)).toEqual({ numbers: ADMIN_CALL_ASSISTANT_NUMBERS, minutes: -1, overageCentsPerMinute: 50 });
    expect(ADMIN_CALL_ASSISTANT_NUMBERS).toBe(5);
    // An admin who holds more keeps it: the admin ceiling is a floor, never a cut.
    expect(allowance({ call_assistant_fleet: 1, call_number: 2 }, true)).toEqual({ numbers: 7, minutes: -1, overageCentsPerMinute: 50 });
    expect(allowance({ call_assistant_lite: 1 }, true)).toEqual({ numbers: ADMIN_CALL_ASSISTANT_NUMBERS, minutes: -1, overageCentsPerMinute: 50 });
  });

  it("getEntitlements: a standalone subscription with NO platform plan turns the module on; a platform plan alone never does", async () => {
    mocks.row = { email: "owner@example.invalid", plan: null, status: null, stripe_subscription_id: null, current_period_end: null, ...callAssistant("crew", "active", 1) };
    const alone = await getEntitlements(7);
    expect(alone.plan).toBeNull();
    expect(alone.allowances).toBeNull();
    expect(alone.addonModules).toEqual({ callAssistant: true });
    expect(alone.addonModulesPaused).toEqual({ callAssistant: false });
    expect(alone.addons).toEqual({ call_assistant_crew: 1, call_number: 1 });
    expect(alone.callAssistant).toMatchObject({ tier: "crew", status: "active", extraNumbers: 1, interval: "month", stripeSubscriptionId: "sub_ca_fixture" });
    expect(moduleEnabled(alone, "callAssistant")).toBe(true);
    expect(callAssistantAllowance(alone)).toEqual({ numbers: 3, minutes: 2_000, overageCentsPerMinute: 50 });

    // A platform plan with a Call Assistant key left on its row by an older build grants nothing.
    mocks.row = customer("growth", { addons: { call_assistant: 1, competitor_pack: 1 } });
    const growth = await getEntitlements(7);
    expect(growth.plan).toBe("growth");
    expect(growth.addonModules).toEqual({ callAssistant: false });
    expect(growth.addons).toEqual({ competitor_pack: 1 });
    expect(growth.storedAddons).toEqual({ competitor_pack: 1 });
    expect(growth.callAssistant.status).toBeNull();
    expect(callAssistantAllowance(growth)).toEqual({ numbers: 0, minutes: 0, overageCentsPerMinute: 0 });

    // Both products on one account: the plan's add-ons and the service's lines in one map.
    mocks.row = customer("pro", { addons: { protected_site: 2 }, ...callAssistant("solo", "active") });
    const both = await getEntitlements(7);
    expect(both.plan).toBe("pro");
    expect(both.addons).toEqual({ protected_site: 2, call_assistant: 1 });
    expect(both.addonModules.callAssistant).toBe(true);
    expect(both.allowances?.protectedSites).toBe(PLANS.pro.limits.protectedSites + 2);

    // The legacy Platinum grant maps to Unlimited now — every module, still no service.
    mocks.row = customer("platinum", { stripe_subscription_id: null });
    const platinum = await getEntitlements(7);
    expect(platinum.modules).toEqual(PLANS.agency.modules);
    expect(platinum.addonModules).toEqual({ callAssistant: false });
  });

  // Owner, 2026-10-02: "As soon as they stop paying the agent stops working." The Call Assistant's OWN
  // subscription status decides; the platform plan is neither needed nor touched.
  it.each([
    ["active", true, false], ["trialing", true, false],
    ["past_due", false, true], ["unpaid", false, true], ["incomplete", false, true], ["paused", false, true],
    ["canceled", false, false], ["incomplete_expired", false, false],
  ] as const)("status %s: module on = %s, paused for payment = %s", async (status, on, paused) => {
    mocks.row = customer("pro", callAssistant("solo", status, 2));
    const ent = await getEntitlements(7);
    expect(ent.addonModules).toEqual({ callAssistant: on });
    expect(ent.addonModulesPaused).toEqual({ callAssistant: paused });
    expect(moduleEnabled(ent, "callAssistant")).toBe(on);
    expect(modulePaused(ent, "callAssistant")).toBe(paused);
    expect(ent.callAssistant.status).toBe(status);
    // The platform plan stays on whatever the service's status is (and the other way round).
    expect(ent.plan).toBe("pro");
    expect(ent.subscriptionStatus).toBe("active");
    // A paused subscription still shows what it bought (its numbers are held); an ended one shows nothing.
    expect(callAssistantAllowance(ent)).toEqual(on || paused
      ? { numbers: 3, minutes: callAssistantTier("solo").includedMinutes, overageCentsPerMinute: callAssistantTier("solo").overageCentsPerMinute }
      : { numbers: 0, minutes: 0, overageCentsPerMinute: 0 });
    expect(ent.addons).toEqual(on ? { call_assistant: 1, call_number: 2 } : {});
    expect(ent.storedAddons).toEqual({ call_assistant: 1, call_number: 2 });
  });

  it("platform admins keep the module whatever their own subscriptions say", async () => {
    const { ADMIN_EMAILS } = await import("../admin");
    mocks.row = customer("pro", { email: ADMIN_EMAILS[1], ...callAssistant("solo", "past_due") });
    const ent = await getEntitlements(7);
    expect(ent.addonModules).toEqual({ callAssistant: true });
    expect(ent.addonModulesPaused).toEqual({ callAssistant: false });
    mocks.row = { email: ADMIN_EMAILS[1], plan: null, status: null, stripe_subscription_id: null };
    expect((await getEntitlements(7)).addonModules).toEqual({ callAssistant: true });
  });

  it("requireModule answers 402 payment_required (not the buy prompt) for a paused subscription", async () => {
    const mw = requireModule("callAssistant");
    const next = vi.fn();
    mocks.row = customer(null, callAssistant("lite", "past_due"));
    const r = res(); await mw({ user: { id: 7 } } as any, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "payment_required", addon: "call_assistant", billingHref: "/settings?tab=billing" }));
    expect(r.json.mock.calls[0][0].message).toMatch(/Update your payment method/);
  });

  it("answers 402 call_assistant_required — a separate service, its own pricing link, no plan named", async () => {
    const r = res();
    sendModuleRequired(r, "callAssistant");
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json).toHaveBeenCalledWith({
      code: "call_assistant_required", addon: "call_assistant", href: "/pricing#call-assistant",
      message: "AI Call Assistant is a separate service with its own subscription, from $249/mo — no ConstructHUB plan needed. Choose a tier on Pricing to use it.",
    });
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toMatch(/requiredPlan|plan_required/);
    // The middleware: 401 signed out, 402 without the service (even on Agency), next() with it (even with no plan).
    const mw = requireModule("callAssistant");
    const next = vi.fn();
    const r401 = res(); await mw({} as any, r401, next); expect(r401.status).toHaveBeenCalledWith(401);
    mocks.row = customer("agency");
    const r402 = res(); await mw({ user: { id: 7 } } as any, r402, next); expect(r402.status).toHaveBeenCalledWith(402);
    expect(r402.json.mock.calls[0][0].code).toBe("call_assistant_required");
    expect(next).not.toHaveBeenCalled();
    mocks.row = customer(null, callAssistant("solo", "active"));
    const rOk = res(); await mw({ user: { id: 7 } } as any, rOk, next); expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("profile contract", () => {
  it("defaultVoiceProfile builds a valid profile from the org's own fields and the owner's intake order", () => {
    const p = defaultVoiceProfile({ name: "Alpine Exteriors", timezone: "America/New_York", phone: "+18135550100", state: "FL", licenseNumber: "CBC123", licenseState: "FL" });
    expect(voiceProfileSchema.safeParse(p).success).toBe(true);
    expect(p.company.officePhone).toBe("+18135550100");
    expect(p.serviceArea.defaultStateCode).toBe("FL");
    expect(p.credibility.licenses).toEqual(["FL license CBC123"]);
    expect(p.intake.questions.map((q) => q.key)).toEqual(["need", "address", "first_name", "phone", "email", "best_time"]);
    expect(p.intake.questions.find((q) => q.key === "phone")?.neverReadAloud).toBe(true);
    expect(p.intake.questions.find((q) => q.key === "email")?.confirm).toBe(true);
    expect(p.appointments.enabled).toBe(false);
    expect(p.persona.presetId).toBe("janice");
    expect(DEFAULT_INTAKE_QUESTIONS).toHaveLength(6);
  });

  it("rejects what the engine could not run", () => {
    const base = defaultVoiceProfile({ name: "X" });
    expect(voiceProfileSchema.safeParse({ ...base, company: { ...base.company, name: "" } }).success).toBe(false);
    expect(voiceProfileSchema.safeParse({ ...base, intake: { ...base.intake, questions: [] } }).success).toBe(false);
    expect(voiceProfileSchema.safeParse({ ...base, persona: { ...base.persona, presetId: "hal9000" } }).success).toBe(false);
    expect(voiceProfileSchema.safeParse({ ...base, company: { ...base.company, officePhone: "813-555-0100" } }).success).toBe(false);
  });

  it("the decision protocol accepts the documented shape and nothing looser", () => {
    expect(decisionSchema.safeParse({ say: "What's the address?", action: "continue" }).success).toBe(true);
    expect(decisionSchema.safeParse({ say: "Goodbye.", action: "end_call", outcome: "lead_submitted", slots: { need: "siding" } }).success).toBe(true);
    expect(decisionSchema.safeParse({ say: "x", action: "transfer" }).success).toBe(false);
    expect(decisionSchema.safeParse({ say: "x", action: "alert", alert: { kind: "ceo", summary: "" } }).success).toBe(false);
  });

  it("the compiler stub is deterministic and carries the persona's voice id", () => {
    const p = defaultVoiceProfile({ name: "Alpine Exteriors" });
    const now = new Date("2026-10-02T00:00:00Z");
    const a = compileVoiceProfile(p, 1, now), b = compileVoiceProfile(p, 1, now);
    expect(a).toEqual(b);
    expect(a.persona).toEqual({ id: "janice", voice: "af_heart", name: "Janice" });
    expect(a.greeting).toBe("Thank you for calling Alpine Exteriors, this is Janice — calls may be recorded. What can we help you with today?");
    expect(a.spam).toEqual({ flagAt: 0.8, strikeAt: 0.95 });
    expect(a.decisionSchema).toMatchObject({ required: ["say", "action"] });
  });

  it("personas are the fixed six with the fixed Kokoro ids", () => {
    expect(VOICE_PERSONA_IDS).toEqual(["janice", "gabe", "sofia", "maya", "marcus", "ethan"]);
    expect(Object.values(VOICE_PERSONAS).map((p) => p.voice)).toEqual(["af_heart", "am_michael", "af_bella", "af_sarah", "am_adam", "am_eric"]);
  });

  it("the DDL creates every table the spec names, idempotently", () => {
    for (const t of VOICE_TABLES) expect(VOICE_SCHEMA_DDL.some((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${t} (`))).toBe(true);
    for (const s of VOICE_SCHEMA_DDL) expect(s).toMatch(/IF NOT EXISTS|IF EXISTS|ADD COLUMN IF NOT EXISTS|CREATE OR REPLACE/);
  });
});
