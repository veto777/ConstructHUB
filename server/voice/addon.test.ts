/**
 * The Call Assistant add-on module (architect-owned): the price book block,
 * the add-on-module entitlement and the 402 body every /api/crm/voice/* route
 * answers without it. Pure functions — no server, no DB.
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
  getEntitlements, addonModulesFor, moduleEnabled, modulePaused, callAssistantAllowance, sendModuleRequired, requireModule, allowancesFor,
} from "../entitlements";
import {
  ADDONS, ADDON_MODULES, ADDON_MODULE_UNLOCKED_BY, PLANS, PLAN_KEYS, MODULE_NAMES, planForModule, moduleName, isAddonModule,
  CALL_ASSISTANT_TIERS, CALL_ASSISTANT_TIER_ADDONS, callAssistantTier,
} from "@shared/plans";
import { checkAddonsForPlan, BillingRequestError } from "../billing/order";
import { AGENCY_ONLY_MODULES, addonLines } from "@shared/plan-copy";
import { voiceProfileSchema, defaultVoiceProfile, decisionSchema, DEFAULT_INTAKE_QUESTIONS } from "@shared/voice-profile";
import { VOICE_PERSONAS, VOICE_PERSONA_IDS } from "@shared/voice-personas";
import { compileVoiceProfile } from "./prompt-compiler";
import { VOICE_SCHEMA_DDL, VOICE_TABLES } from "./schema";

const res = () => { const r: any = { status: vi.fn(() => r), json: vi.fn(() => r), setHeader: vi.fn() }; return r; };
const customer = (plan: string | null, extra: Record<string, unknown> = {}) =>
  ({ email: "owner@example.invalid", plan, status: plan ? "active" : null, stripe_subscription_id: plan ? "sub_fixture" : null, current_period_end: null, ...extra });

beforeEach(() => { mocks.row = undefined; });

describe("price book: the Call Assistant add-ons", () => {
  it("are sold on Pro, Growth and Agency, grant no count limits, and stay in preview until the owner confirms pricing", () => {
    for (const key of [...CALL_ASSISTANT_TIER_ADDONS, "call_number"] as const) {
      expect(ADDONS[key].availableOn).toEqual(["pro", "growth", "agency"]);
      expect(ADDONS[key].grants).toEqual({});
      expect(ADDONS[key].preview).toBe(true);
      expect(ADDONS[key].setupCents).toBeUndefined();
    }
    // Owner, 2026-10-02: "annually price can be $1999 for this service" — its own number, not 10 × monthly.
    expect(ADDONS.call_assistant.annualCents).toBe(199_900);
    expect(ADDONS.call_number.annualCents).toBe(ADDONS.call_number.monthlyCents * 10);
    // An extra number needs any one tier.
    expect(ADDONS.call_number.requires).toEqual(["call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
    for (const t of CALL_ASSISTANT_TIERS) expect(ADDONS[t.addon].description).toContain(`${t.includedMinutes.toLocaleString("en-US")} call minutes`);
    expect(callAssistantTier("solo").includedNumbers).toBe(1);
    // Every add-on line the Hub assistant quotes still comes from the price book, preview ones included.
    expect(addonLines()).toHaveLength(Object.keys(ADDONS).length);
  });

  it("is an add-on module, not a plan module: the Agency-only list is unchanged", () => {
    expect(ADDON_MODULES.callAssistant).toBe("call_assistant");
    expect(ADDON_MODULE_UNLOCKED_BY.callAssistant).toEqual(["call_assistant", "call_assistant_crew", "call_assistant_fleet"]);
    expect(isAddonModule("callAssistant")).toBe(true);
    expect(isAddonModule("adsManager")).toBe(false);
    expect(Object.keys(MODULE_NAMES)).not.toContain("callAssistant");
    expect(AGENCY_ONLY_MODULES).toHaveLength(4);
    expect(planForModule("callAssistant")).toBe("pro");
    expect(moduleName("callAssistant")).toBe("AI Call Assistant");
    for (const k of PLAN_KEYS) expect((PLANS[k].modules as any).callAssistant).toBeUndefined();
  });

  it("checkout refuses a preview add-on and an extra number without the assistant", () => {
    expect(() => checkAddonsForPlan("pro", { call_assistant: 1 })).toThrow(BillingRequestError);
    try { checkAddonsForPlan("pro", { call_assistant: 1 }); } catch (e: any) { expect(e.status).toBe(409); expect(e.code).toBe("addon_unavailable"); }
    expect(() => checkAddonsForPlan("starter", { call_assistant: 1 })).toThrow(/isn't available on the Starter plan/);
    // The requires rule is checked after preview; it stays meaningful once preview is dropped.
    expect(() => checkAddonsForPlan("growth", { competitor_pack: 1 })).not.toThrow();
  });
});

describe("entitlements: the callAssistant add-on module", () => {
  it("is on only when the add-on is on the subscription, the plan sells it and the subscription is paid up", () => {
    expect(addonModulesFor("pro", { call_assistant: 1 }, "active")).toEqual({ callAssistant: true });
    // Any tier unlocks the module.
    expect(addonModulesFor("pro", { call_assistant_crew: 1 }, "active")).toEqual({ callAssistant: true });
    expect(addonModulesFor("growth", { call_assistant_fleet: 1 }, "trialing")).toEqual({ callAssistant: true });
    expect(addonModulesFor("pro", { call_number: 2 }, "active")).toEqual({ callAssistant: false });
    expect(addonModulesFor("pro", { call_assistant: 1 }, "trialing")).toEqual({ callAssistant: true });
    expect(addonModulesFor("pro", { call_assistant: 1 }, "past_due")).toEqual({ callAssistant: false });
    expect(addonModulesFor("pro", { call_assistant: 1 }, null)).toEqual({ callAssistant: false });
    expect(addonModulesFor("pro", {}, "active")).toEqual({ callAssistant: false });
    expect(addonModulesFor("starter", { call_assistant: 1 }, "active")).toEqual({ callAssistant: false });
    expect(addonModulesFor(null, { call_assistant: 1 }, "active")).toEqual({ callAssistant: false });
    expect(addonModulesFor(null, {}, null, true)).toEqual({ callAssistant: true });
    expect(addonModulesFor(null, {}, "past_due", true)).toEqual({ callAssistant: true });
    // The add-on raises no count limit.
    expect(allowancesFor("pro", { call_assistant: 2, call_number: 3 })).toEqual(PLANS.pro.limits);
  });

  it("buys the held tier's numbers and minutes plus extra numbers; platform admins get Solo's worth", () => {
    const allowance = (addons: Record<string, number>, isPlatformAdmin = false) =>
      callAssistantAllowance({ addonModules: { callAssistant: true }, addons, isPlatformAdmin });
    expect(allowance({ call_assistant: 1, call_number: 3 })).toEqual({ numbers: 1 + 3, minutes: 2000 });
    expect(allowance({ call_assistant_crew: 1 })).toEqual({ numbers: 3, minutes: 5000 });
    expect(allowance({ call_assistant_fleet: 1, call_number: 1 })).toEqual({ numbers: 6, minutes: 12_000 });
    expect(callAssistantAllowance({ addonModules: { callAssistant: false }, addons: { call_assistant: 2 }, isPlatformAdmin: false })).toEqual({ numbers: 0, minutes: 0 });
    expect(allowance({}, true)).toEqual({ numbers: 1, minutes: 2000 });
    // An admin who holds a tier gets that tier.
    expect(allowance({ call_assistant_fleet: 1 }, true)).toEqual({ numbers: 5, minutes: 12_000 });
  });

  it("getEntitlements reports addonModules beside modules, and legacy Platinum has no add-on", async () => {
    mocks.row = customer("growth", { addons: { call_assistant: 1 } });
    const growth = await getEntitlements(7);
    expect(growth.addonModules).toEqual({ callAssistant: true });
    expect(moduleEnabled(growth, "callAssistant")).toBe(true);
    expect(moduleEnabled(growth, "adsManager")).toBe(false);
    mocks.row = customer("platinum", { stripe_subscription_id: null });
    const platinum = await getEntitlements(7);
    expect(platinum.modules).toEqual({ agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true });
    expect(platinum.addonModules).toEqual({ callAssistant: false });
  });

  // Owner, 2026-10-02: "As soon as they stop paying the agent stops working." The plan keeps
  // past_due access (Stripe retries); the add-on module does not.
  it.each([
    ["active", true, false], ["trialing", true, false],
    ["past_due", false, true], ["unpaid", false, true], ["incomplete", false, true], ["paused", false, true],
    ["canceled", false, false], ["incomplete_expired", false, false],
  ] as const)("status %s: module on = %s, paused for payment = %s", async (status, on, paused) => {
    mocks.row = customer("pro", { status, addons: { call_assistant: 1, call_number: 2 } });
    const ent = await getEntitlements(7);
    expect(ent.addonModules).toEqual({ callAssistant: on });
    expect(ent.addonModulesPaused).toEqual({ callAssistant: paused });
    expect(moduleEnabled(ent, "callAssistant")).toBe(on);
    expect(modulePaused(ent, "callAssistant")).toBe(paused);
    expect(ent.subscriptionStatus).toBe(status);
    // A paused add-on still shows what it bought (its numbers are held); an ended one shows nothing.
    expect(callAssistantAllowance(ent)).toEqual(on || paused ? { numbers: 3, minutes: callAssistantTier("solo").includedMinutes } : { numbers: 0, minutes: 0 });
    // past_due keeps the PLAN's own access (only the add-on stops).
    if (status === "past_due") expect(ent.plan).toBe("pro");
  });

  it("platform admins keep the module whatever their own subscription says", async () => {
    const { ADMIN_EMAILS } = await import("../admin");
    mocks.row = customer("pro", { email: ADMIN_EMAILS[1], status: "past_due", addons: { call_assistant: 1 } });
    const ent = await getEntitlements(7);
    expect(ent.addonModules).toEqual({ callAssistant: true });
    expect(ent.addonModulesPaused).toEqual({ callAssistant: false });
  });

  it("requireModule answers 402 payment_required (not plan_required) for a paused add-on", async () => {
    const mw = requireModule("callAssistant");
    const next = vi.fn();
    mocks.row = customer("pro", { status: "past_due", addons: { call_assistant: 1 } });
    const r = res(); await mw({ user: { id: 7 } } as any, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "payment_required", addon: "call_assistant", billingHref: "/settings?tab=billing" }));
    expect(r.json.mock.calls[0][0].message).toMatch(/Update your payment method/);
  });

  it("answers the standard plan_required body with the add-on named", async () => {
    const r = res();
    sendModuleRequired(r, "callAssistant");
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json).toHaveBeenCalledWith({
      code: "plan_required", requiredPlan: "pro", addon: "call_assistant",
      message: "AI Call Assistant is an add-on for the Pro, Growth and Agency plans. Add it in Settings → Billing to use it.",
    });
    // The middleware: 401 signed out, 402 without the add-on, next() with it.
    const mw = requireModule("callAssistant");
    const next = vi.fn();
    const r401 = res(); await mw({} as any, r401, next); expect(r401.status).toHaveBeenCalledWith(401);
    mocks.row = customer("pro");
    const r402 = res(); await mw({ user: { id: 7 } } as any, r402, next); expect(r402.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
    mocks.row = customer("pro", { addons: { call_assistant: 1 } });
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
    for (const s of VOICE_SCHEMA_DDL) expect(s).toMatch(/IF NOT EXISTS|ADD COLUMN IF NOT EXISTS/);
  });
});
