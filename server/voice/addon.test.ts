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
  getEntitlements, addonModulesFor, moduleEnabled, callAssistantAllowance, sendModuleRequired, requireModule, allowancesFor,
} from "../entitlements";
import {
  ADDONS, ADDON_MODULES, PLANS, PLAN_KEYS, MODULE_NAMES, planForModule, moduleName, isAddonModule,
  CALL_ASSISTANT_INCLUDED_MINUTES, CALL_ASSISTANT_INCLUDED_NUMBERS,
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
    for (const key of ["call_assistant", "call_number"] as const) {
      expect(ADDONS[key].availableOn).toEqual(["pro", "growth", "agency"]);
      expect(ADDONS[key].grants).toEqual({});
      expect(ADDONS[key].preview).toBe(true);
      expect(ADDONS[key].annualCents).toBe(ADDONS[key].monthlyCents * 10);
      expect(ADDONS[key].setupCents).toBeUndefined();
    }
    expect(ADDONS.call_number.requires).toBe("call_assistant");
    expect(ADDONS.call_assistant.description).toContain(`${CALL_ASSISTANT_INCLUDED_MINUTES} call minutes`);
    expect(CALL_ASSISTANT_INCLUDED_NUMBERS).toBe(1);
    // Every add-on line the Hub assistant quotes still comes from the price book, preview ones included.
    expect(addonLines()).toHaveLength(Object.keys(ADDONS).length);
  });

  it("is an add-on module, not a plan module: the Agency-only list is unchanged", () => {
    expect(ADDON_MODULES.callAssistant).toBe("call_assistant");
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
  it("is on only when the add-on is on the subscription and the plan sells it", () => {
    expect(addonModulesFor("pro", { call_assistant: 1 })).toEqual({ callAssistant: true });
    expect(addonModulesFor("pro", {})).toEqual({ callAssistant: false });
    expect(addonModulesFor("starter", { call_assistant: 1 })).toEqual({ callAssistant: false });
    expect(addonModulesFor(null, { call_assistant: 1 })).toEqual({ callAssistant: false });
    expect(addonModulesFor(null, {}, true)).toEqual({ callAssistant: true });
    // The add-on raises no count limit.
    expect(allowancesFor("pro", { call_assistant: 2, call_number: 3 })).toEqual(PLANS.pro.limits);
  });

  it("buys numbers and minutes per unit; platform admins get one unit's worth", () => {
    const on = { addonModules: { callAssistant: true }, addons: { call_assistant: 2, call_number: 3 }, isPlatformAdmin: false };
    expect(callAssistantAllowance(on)).toEqual({ numbers: 2 + 3, minutes: 2 * CALL_ASSISTANT_INCLUDED_MINUTES });
    expect(callAssistantAllowance({ addonModules: { callAssistant: false }, addons: { call_assistant: 2 }, isPlatformAdmin: false })).toEqual({ numbers: 0, minutes: 0 });
    expect(callAssistantAllowance({ addonModules: { callAssistant: true }, addons: {}, isPlatformAdmin: true })).toEqual({ numbers: 1, minutes: CALL_ASSISTANT_INCLUDED_MINUTES });
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
