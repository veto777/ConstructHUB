/**
 * The prompt compiler (studio-backend lane): VoiceProfile → CompiledProfile.
 * Pure — no DB, no server. Snapshots live in __snapshots__/prompt-compiler.test.ts.snap;
 * a wording change to the system prompt shows up there for review (vitest -u to accept).
 */
import { describe, expect, it } from "vitest";
import {
  defaultVoiceProfile, parseVoiceProfile, voiceProfileSchema, DECISION_ACTIONS, ESCALATION_KINDS, type VoiceProfile, type VoiceProfileInput,
} from "@shared/voice-profile";
import {
  compileVoiceProfile, renderSystemPrompt, callerLine, hoursToSpoken, countiesToSpoken, spokenPhone, clockToSpoken, isoDateToSpoken,
  joinAnd, profileHash, SPAM_THRESHOLDS, NOW_PLACEHOLDER, CALLER_PLACEHOLDER, spokenNow,
} from "./prompt-compiler";

const NOW = new Date("2026-10-02T15:04:00Z");

/** An Alpine-like exterior contractor, written the way an owner would fill the Studio. */
function richProfile(over: Partial<VoiceProfileInput> = {}): VoiceProfile {
  const base = defaultVoiceProfile({ name: "Cascade Exteriors LLC", timezone: "America/Los_Angeles", phone: "+13605550142", state: "WA", licenseNumber: "CASCAEL123AB", licenseState: "WA" });
  return parseVoiceProfile({
    ...base,
    company: {
      ...base.company,
      spokenName: "Cascade Exteriors",
      trade: "licensed exterior contractor",
      services: [
        { name: "siding replacement", details: "James Hardie fiber cement and LP SmartSide, whole-house", tier: "primary" },
        { name: "window replacement", details: "", tier: "primary" },
        { name: "gutters", details: "seamless aluminum", tier: "secondary" },
      ],
      materials: ["fiber cement", "engineered wood", "vinyl"],
      brands: ["James Hardie", "Milgard"],
      declines: [{ what: "roofing", referral: "a local roofing company would be the best fit for that" }, { what: "interior remodels", referral: "" }],
      hours: { ...base.company.hours, sat: { open: true, from: "09:00", to: "13:00" } },
      website: "cascade-exteriors.example",
      about: "Family-owned, three crews",
    },
    serviceArea: {
      counties: [
        { id: 3001, name: "Whatcom", stateCode: "WA" }, { id: 3002, name: "Skagit", stateCode: "WA" },
        { id: 3003, name: "Snohomish", stateCode: "WA" }, { id: 3004, name: "King", stateCode: "WA" },
      ],
      spokenAreas: ["from the Canadian border down to Seattle"],
      defaultStateCode: "WA",
      outOfArea: "decline",
      outOfAreaLine: "I'm sorry, we only work from the Canadian border down to Seattle.",
    },
    credibility: { yearsInBusiness: 18, licenses: ["WA CASCAEL123AB"], insured: true, bonded: true, warranties: ["10-year workmanship warranty"], reviews: "4.9 stars on Google", certifications: ["James Hardie Elite Preferred"] },
    offers: {
      financing: { available: true, details: "0% for 12 months on approved credit" },
      promotions: [{ name: "Fall siding special", details: "10% off whole-house siding", endsOn: "2026-11-30" }],
      freeEstimate: true,
      referralProgram: "$250 for every referral that signs",
    },
    policies: {
      pricing: "ranges",
      priceRanges: [{ service: "whole-house siding", range: "$25,000 to $60,000 for most homes" }],
      repairs: "replacements_only",
      minimumJob: "We don't take jobs under $5,000",
      emergencies: { handle: true, definition: "storm damage or siding torn off the house", line: "I'm alerting the team right now." },
      rules: ["Never promise a start date"],
    },
    persona: { ...base.persona, presetId: "gabe", style: { warmth: 4, brevity: 5, formality: 2 } },
    intake: {
      ...base.intake,
      questions: [
        ...base.intake.questions,
        { key: "heard_about", prompt: "How did you hear about us?", required: false, validation: "choice", choices: ["Google", "a neighbor", "a yard sign"] },
      ],
    },
    faq: [{ question: "Do you pull permits?", answer: "Yes, we pull every permit the city requires." }],
    escalations: {
      rules: [
        { id: "on-call", kinds: ["urgent", "human"], channel: "sms", recipientName: "Dan", recipient: "+13605550199" },
        { id: "office", kinds: ["payment", "scheduling", "existing_customer"], channel: "email", recipientName: "Office", recipient: "office@cascade-exteriors.example" },
      ],
    },
    advanced: { ...base.advanced, extraInstructions: "If someone asks about decks, say we partner with a deck builder.", spamSensitivity: "high", vocabulary: ["Hardie", "Bellingham"] },
    ...over,
  });
}

/** Headings in the fixed order SPEC.md § Prompt compiler names. */
const SECTION_MARKERS = [
  "You are ", "YOUR JOB:", "WHAT WE DO:", "SERVICE AREA", "CREDIBILITY", "ESTIMATES:", "PRICING:", "EMERGENCY", "NO LIVE TRANSFER",
  "COLLECT, conversationally", "ANSWERS YOU MAY GIVE", "SPAM SCREENING:", "HANGING UP", "GOODBYE RULE:", "OUTPUT FORMAT", "ADDITIONAL INSTRUCTIONS", "Current time:",
];

describe("compileVoiceProfile", () => {
  it("compiles a brand-new org's default profile (snapshot)", () => {
    const compiled = compileVoiceProfile(defaultVoiceProfile({ name: "Acme Roofing" }), 1, NOW);
    expect(compiled).toMatchSnapshot();
  });

  it("compiles a fully filled-in profile (snapshot of the system prompt and the engine knobs)", () => {
    const { systemPrompt, ...rest } = compileVoiceProfile(richProfile(), 7, NOW);
    expect(systemPrompt).toMatchSnapshot();
    expect(rest).toMatchSnapshot();
  });

  it("is deterministic: same profile + version + instant → identical output; the hash follows the content", () => {
    const p = richProfile();
    expect(compileVoiceProfile(p, 3, NOW)).toEqual(compileVoiceProfile(structuredClone(p), 3, NOW));
    expect(compileVoiceProfile(p, 3, NOW).hash).toBe(profileHash(p));
    const changed = richProfile({ faq: [{ question: "Are you insured?", answer: "Yes." }] });
    expect(compileVoiceProfile(changed, 3, NOW).hash).not.toBe(profileHash(p));
    // Only compiledAt moves with the clock.
    const later = compileVoiceProfile(p, 3, new Date("2027-01-01T00:00:00Z"));
    expect({ ...later, compiledAt: "" }).toEqual({ ...compileVoiceProfile(p, 3, NOW), compiledAt: "" });
  });

  it("keeps the fixed section order", () => {
    const prompt = compileVoiceProfile(richProfile(), 1, NOW).systemPrompt;
    const at = SECTION_MARKERS.map((m) => prompt.indexOf(m));
    for (const [i, idx] of at.entries()) expect(idx, SECTION_MARKERS[i]).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("states only facts the profile holds — empty sections say nothing", () => {
    const empty = compileVoiceProfile(defaultVoiceProfile({ name: "Acme Roofing" }), 1, NOW).systemPrompt;
    expect(empty).not.toContain("CREDIBILITY");
    expect(empty).not.toContain("ANSWERS YOU MAY GIVE");
    expect(empty).not.toContain("PROMOTIONS");
    expect(empty).not.toContain("ADDITIONAL INSTRUCTIONS");
    expect(empty).toContain("WHAT WE DO: the company has not listed its services yet");
    expect(empty).toContain("SERVICE AREA: not specified");
    expect(empty).toContain("PRICING: never quote prices");
    expect(empty).not.toMatch(/\$\d/);
    expect(empty).not.toContain("office number");

    const rich = compileVoiceProfile(richProfile(), 1, NOW).systemPrompt;
    expect(rich).toContain("18 years in business; licensed (WA CASCAEL123AB); insured and bonded");
    expect(rich).toContain(" - whole-house siding: $25,000 to $60,000 for most homes");
    expect(rich).toContain("Valid through November 30, 2026");
    expect(rich).toContain("say it slowly, digit by digit: 360 555 0142.");
    expect(rich).toContain('roofing → say "a local roofing company would be the best fit for that"');
    expect(rich).toContain("REPAIRS: we do full replacements and new installations only");
    expect(rich).toContain("SECONDARY SERVICES: gutters");
    expect(rich).toContain("Washington: Whatcom, Skagit, Snohomish and King counties");
    expect(rich).toContain(`say "I'm sorry, we only work from the Canadian border down to Seattle."`);
    expect(rich).toContain(" - Never promise a start date.");
  });

  it("a company that does not give free estimates or financing is never said to", () => {
    const p = richProfile({ offers: { freeEstimate: false, financing: { available: false } } as any });
    const prompt = compileVoiceProfile(p, 1, NOW).systemPrompt;
    expect(prompt).toContain("do not say the estimate is free");
    expect(prompt).not.toContain("free-estimate request form");
    expect(prompt).toContain("FINANCING: if asked, say financing is not something you can speak to");
  });

  it("writes the intake script in order with the owner's rules for caller-id and email", () => {
    const c = compileVoiceProfile(richProfile(), 1, NOW);
    expect(c.intake.map((q) => q.key)).toEqual(["need", "address", "first_name", "phone", "email", "best_time", "heard_about"]);
    const prompt = c.systemPrompt;
    const order = c.intake.map((q) => prompt.indexOf(`[${q.key}]`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toMatch(/\[phone\][^\n]*NEVER read the digits out loud/);
    expect(prompt).toMatch(/\[email\][^\n]*read it back once to confirm/);
    expect(prompt).toMatch(/\[heard_about\][^\n]*choices: Google, a neighbor and a yard sign; optional/);
    expect(prompt).toContain("Required before submitting: need, address, first_name, phone");
    expect(prompt).toContain('slot key (need, address, first_name, phone, email, best_time, heard_about)');
  });

  it("tells the model the strict JSON decision protocol and ships the matching JSON Schema", () => {
    const c = compileVoiceProfile(richProfile(), 1, NOW);
    expect(c.systemPrompt).toContain("every turn you reply with exactly ONE JSON object and nothing else");
    for (const a of DECISION_ACTIONS) expect(c.systemPrompt).toContain(`"${a}"`);
    expect(c.decisionSchema).toMatchObject({
      type: "object", required: ["say", "action"],
      properties: { action: { enum: [...DECISION_ACTIONS] }, alert: { properties: { kind: { enum: [...ESCALATION_KINDS] } } } },
    });
    // Extra instructions come after the protocol and cannot displace it.
    expect(c.systemPrompt.indexOf("ADDITIONAL INSTRUCTIONS")).toBeGreaterThan(c.systemPrompt.indexOf("OUTPUT FORMAT"));
    expect(c.systemPrompt).toContain("unless they contradict the output format");
  });

  it("persona, greeting, spam thresholds, timings and escalation kinds come straight from the profile", () => {
    const c = compileVoiceProfile(richProfile(), 7, NOW);
    expect(c.version).toBe(7);
    expect(c.persona).toEqual({ id: "gabe", voice: "am_michael", name: "Gabe" });
    expect(c.greeting).toBe("Thank you for calling Cascade Exteriors, this is Gabe — calls may be recorded. What can we help you with today?");
    expect(c.systemPrompt).toContain("You are a man named Gabe.");
    expect(c.spam).toEqual(SPAM_THRESHOLDS.high);
    expect(c.vocabulary).toEqual(["Hardie", "Bellingham"]);
    expect(c.escalationKinds).toEqual(["urgent", "human", "payment", "scheduling", "existing_customer"]);
    expect(c.systemPrompt).toContain('a complaint about work or service → kind "complaint" (goes to the owner)');
    expect(c.systemPrompt).toMatch(/making a payment or a question about one → kind "payment"\n/);
    const named = compileVoiceProfile(richProfile({ persona: { presetId: "maya", assistantName: "Rosa", greeting: "Cascade, this is Rosa.", recordingNotice: false } as any }), 1, NOW);
    expect(named.persona).toEqual({ id: "maya", voice: "af_sarah", name: "Rosa" });
    expect(named.greeting).toBe("Cascade, this is Rosa.");
    const noNotice = compileVoiceProfile(richProfile({ persona: { presetId: "janice", recordingNotice: false } as any }), 1, NOW);
    expect(noNotice.greeting).toBe("Thank you for calling Cascade Exteriors, this is Janice. What can we help you with today?");
    for (const s of ["low", "normal", "high"] as const) {
      const p = richProfile({ advanced: { spamSensitivity: s } as any });
      expect(compileVoiceProfile(p, 1, NOW).spam).toEqual(SPAM_THRESHOLDS[s]);
    }
    expect(c.timings).toEqual({ silencePromptSeconds: 12, silencePromptsBeforeHangup: 2, maxCallSeconds: 900, greetingDelaySeconds: 3, maxTurns: 40 });
  });

  it("emergencies off → no urgent alerts promised", () => {
    const p = richProfile({ policies: { emergencies: { handle: false } } as any });
    const prompt = compileVoiceProfile(p, 1, NOW).systemPrompt;
    expect(prompt).toContain("the company does not take emergency or urgent-response work");
    expect(prompt).not.toContain('kind "urgent", tell them');
  });

  it("appointments stay off by default; on, the assistant still never confirms a time itself", () => {
    expect(compileVoiceProfile(richProfile(), 1, NOW).systemPrompt).toContain("You do NOT schedule appointments");
    const p = richProfile({ appointments: { enabled: true, crews: [{ name: "Crew A", windows: [{ day: "tue", from: "08:00", to: "12:00" }] }] } as any });
    const c = compileVoiceProfile(p, 1, NOW);
    expect(c.appointments).toEqual({ enabled: true });
    expect(c.systemPrompt).toContain("Crew A: Tue 8:00 AM–12:00 PM");
    expect(c.systemPrompt).toContain("you do NOT confirm a time yourself");
  });
});

describe("per-call rendering", () => {
  it("fills {{now}} in the company's timezone and {{caller}} without ever exposing the raw E.164", () => {
    const c = compileVoiceProfile(richProfile(), 1, NOW);
    expect(c.systemPrompt).toContain(NOW_PLACEHOLDER);
    expect(c.systemPrompt).toContain(CALLER_PLACEHOLDER);
    const r = renderSystemPrompt(c, { now: NOW, timezone: "America/Los_Angeles", caller: { callerNumber: "+13605550123", customer: { firstName: "Pat", email: "pat@example.invalid" } } });
    expect(r).not.toContain(NOW_PLACEHOLDER);
    expect(r).not.toContain(CALLER_PLACEHOLDER);
    expect(r).toContain("Current time: Friday, October 2, 2026 8:04 AM (America/Los_Angeles");
    expect(r).toContain("Caller ID: 360 555 0123 (never read it aloud).");
    expect(r).toContain("The CRM knows this number as Pat (email pat@example.invalid)");
    expect(callerLine({ callerNumber: null })).toBe("Caller ID: withheld or unknown.");
    expect(spokenNow(NOW, "Not/AZone")).toBe(NOW.toISOString());
  });
});

describe("formatters", () => {
  it("speak hours, counties, phones, clocks and dates the way people say them", () => {
    expect(hoursToSpoken(voiceProfileSchema.parse({ company: { name: "x" }, intake: { questions: [{ key: "need", prompt: "?" }] } }).company.hours))
      .toBe("Monday to Friday 8:00 AM to 5:00 PM; closed Saturday and Sunday");
    expect(countiesToSpoken([{ id: 1, name: "Pinellas", stateCode: "FL" }, { id: 2, name: "King", stateCode: "WA" }, { id: 3, name: "Pierce", stateCode: "WA" }]))
      .toBe("Florida: Pinellas County; Washington: King and Pierce counties");
    expect(spokenPhone("+18135550100")).toBe("813 555 0100");
    expect(clockToSpoken("00:30")).toBe("12:30 AM");
    expect(clockToSpoken("12:00")).toBe("12:00 PM");
    expect(isoDateToSpoken("2026-02-01")).toBe("February 1, 2026");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
    expect(joinAnd(["a"])).toBe("a");
  });
});
