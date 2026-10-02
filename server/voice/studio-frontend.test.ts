/**
 * Agent Studio (studio-frontend lane) — the pure helpers in
 * client/src/lib/voice-studio.ts that the wizard, editor and simulator share.
 * They live under client/ but import nothing from React or "@/", so the
 * server-side vitest suite checks them here (vitest only includes server/**).
 */
import { describe, expect, it } from "vitest";
import {
  STUDIO_SECTIONS, WIZARD_STEPS, addCounties, defaultIntakeQuestions, hasAllCountiesRegion, isFirstRun, mergeSimulatorEvents,
  moveItem, newEscalationRule, newIntakeQuestion, prettyPhone, profileDiffSummary, profileIssueText, regionCounties,
  simulatorErrorText, studioIssues, toE164,
} from "../../client/src/lib/voice-studio";
import { DEFAULT_INTAKE_QUESTIONS, defaultVoiceProfile, voiceProfileSchema, type VoiceProfile } from "@shared/voice-profile";

const WA = [
  { id: 101, name: "King", stateCode: "WA" },
  { id: 102, name: "Pierce", stateCode: "WA" },
  { id: 103, name: "Whatcom", stateCode: "WA" },
];

/** A profile that should pass both the Studio's checks and the server's zod schema. */
function complete(): VoiceProfile {
  const p = defaultVoiceProfile({ name: "Acme Siding", timezone: "America/Los_Angeles", state: "WA" });
  return {
    ...p,
    company: { ...p.company, services: [{ name: "Siding replacement", details: "", tier: "primary" }] },
    serviceArea: { ...p.serviceArea, counties: [WA[0], WA[1]] },
    escalations: { ...p.escalations, rules: [{ ...newEscalationRule([]), recipientName: "Mike", recipient: "+13605551234" }] },
  };
}

const apiError = (status: number, body: unknown) => new Error(`${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);

describe("isFirstRun", () => {
  it("is first run only when nothing was published and setup never finished", () => {
    expect(isFirstRun({ publishedVersion: null, setupCompletedAt: null })).toBe(true);
    expect(isFirstRun({ publishedVersion: 1, setupCompletedAt: null })).toBe(false);
    expect(isFirstRun({ publishedVersion: null, setupCompletedAt: "2026-10-02T00:00:00Z" })).toBe(false);
    expect(isFirstRun(null)).toBe(false);
  });
});

describe("studioIssues", () => {
  it("flags what a brand-new default profile is missing, by section", () => {
    const issues = studioIssues(defaultVoiceProfile({ name: "Acme" }));
    const sections = new Set(issues.map((i) => i.section));
    expect(sections.has("services")).toBe(true);
    expect(sections.has("serviceArea")).toBe(true);
    expect(sections.has("company")).toBe(false);
  });

  it("passes a complete profile, and that profile also passes the server schema", () => {
    const p = complete();
    expect(studioIssues(p)).toEqual([]);
    expect(() => voiceProfileSchema.parse(p)).not.toThrow();
  });

  it("catches the things zod would reject with a less friendly message", () => {
    const p = complete();
    const bad: VoiceProfile = {
      ...p,
      company: { ...p.company, name: " ", officePhone: "360-555-1234" },
      intake: { ...p.intake, questions: [...p.intake.questions, { ...p.intake.questions[0] }] },
      faq: [{ question: "Do you do decks?", answer: "" }],
      escalations: { ...p.escalations, rules: [{ ...p.escalations.rules[0], channel: "email", recipient: "not-an-email", kinds: [] }] },
      leadDelivery: { ...p.leadDelivery, sms: { enabled: true, recipients: ["555"] } },
      policies: { ...p.policies, pricing: "ranges", priceRanges: [] },
    };
    const msgs = studioIssues(bad).map((i) => `${i.section}: ${i.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      "company: Company name is required.",
      "company: Office phone must look like +13605551234.",
      'intake: Question #7: the key "need" is used twice.',
      "faq: FAQ #1 needs both a question and an answer.",
      "escalations: Mike: pick at least one situation.",
      "escalations: Mike: enter a valid email address.",
      'leadDelivery: "555" must look like +13605551234.',
      "policies: You chose to read price ranges, but none are listed.",
    ]));
    expect(() => voiceProfileSchema.parse(bad)).toThrow();
  });
});

describe("profileDiffSummary", () => {
  it("says first publish when nothing is live, and nothing when identical", () => {
    const p = complete();
    expect(profileDiffSummary(null, p)).toEqual(["First publish — the whole profile goes live."]);
    expect(profileDiffSummary(p, structuredClone(p))).toEqual([]);
  });

  it("names the sections that changed", () => {
    const a = complete();
    const b: VoiceProfile = structuredClone(a);
    b.persona.greeting = "Hi, you've reached Acme.";
    b.persona.presetId = "gabe";
    b.intake.questions.push(newIntakeQuestion("How old is the roof?", b.intake.questions));
    b.serviceArea.counties.push(WA[2]);
    b.appointments.enabled = true;
    b.advanced.temperature = 0.5;
    const lines = profileDiffSummary(a, b);
    expect(lines).toEqual(expect.arrayContaining([
      "Persona: voice janice → gabe",
      "Persona: greeting changed",
      "Intake: 6 questions → 7 questions",
      "Service area: 2 counties → 3 counties",
      "Appointments: turned ON",
      "Advanced: timings, style or spam sensitivity changed",
    ]));
    expect(lines).not.toContain("Company: name changed");
  });

  it("notices a reorder even when the count is the same", () => {
    const a = complete();
    const b = structuredClone(a);
    b.intake.questions = moveItem(b.intake.questions, 0, 1);
    expect(profileDiffSummary(a, b)).toContain("Intake: questions reordered or reworded");
  });
});

describe("editing helpers", () => {
  it("derives a valid, unique slot key for a custom question", () => {
    const qs = defaultIntakeQuestions();
    const q1 = newIntakeQuestion("Roughly how old is the roof?", qs);
    expect(q1.key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(q1.required).toBe(false);
    const q2 = newIntakeQuestion("Roughly how old is the roof?", [...qs, q1]);
    expect(q2.key).not.toBe(q1.key);
    expect(newIntakeQuestion("123 ???", qs).key).toBe("custom");
  });

  it("copies the default script so edits never mutate the shared constant", () => {
    const qs = defaultIntakeQuestions();
    qs[0].prompt = "changed";
    qs[0].choices.push("x");
    expect(DEFAULT_INTAKE_QUESTIONS[0].prompt).not.toBe("changed");
    expect(DEFAULT_INTAKE_QUESTIONS[0].choices).toEqual([]);
  });

  it("gives escalation rules unique ids that the schema accepts", () => {
    const r1 = newEscalationRule([]);
    const r2 = newEscalationRule([r1]);
    expect(r1.id).not.toBe(r2.id);
    expect(r1.id).toMatch(/^[a-z0-9_-]{1,40}$/);
    expect(r1.kinds).toEqual(["human", "urgent"]);
  });

  it("moves list items and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const same = ["a"];
    expect(moveItem(same, 0, 3)).toBe(same);
  });

  it("normalizes and prints US phone numbers", () => {
    expect(toE164("(360) 555-1234")).toBe("+13605551234");
    expect(toE164("1 360 555 1234")).toBe("+13605551234");
    expect(toE164("555")).toBe("555");
    expect(prettyPhone("+13605551234")).toBe("(360) 555-1234");
    expect(prettyPhone("+442071234567")).toBe("+442071234567");
  });
});

describe("county regions", () => {
  it("resolves both region shapes to real rows of this state only", () => {
    expect(regionCounties({ id: "r1", name: "A", stateCode: "WA", countyIds: [102, 999, 101, 102] }, WA).map((c) => c.id)).toEqual([102, 101]);
    expect(regionCounties({ id: "wa-x", name: "B", stateCode: "WA", counties: [WA[2], { id: 5, name: "Ghost", stateCode: "WA" }] }, WA).map((c) => c.id)).toEqual([103]);
    expect(regionCounties({ id: "r3", name: "C", stateCode: "WA" }, WA)).toEqual([]);
  });

  it("adds without duplicates and keeps order", () => {
    expect(addCounties([WA[1]], [WA[0], WA[1], WA[2]]).map((c) => c.id)).toEqual([102, 101, 103]);
  });

  it("detects the backend's own all-counties shortcut", () => {
    expect(hasAllCountiesRegion([{ id: "all-wa", name: "All", stateCode: "WA" }])).toBe(true);
    expect(hasAllCountiesRegion([{ id: "wa-puget-sound", name: "PS", stateCode: "WA" }])).toBe(false);
  });
});

describe("simulator helpers", () => {
  it("merges cumulative and incremental event lists without duplicates", () => {
    const e1 = { t: "1", type: "retry", detail: { reason: "no-json" } };
    const e2 = { t: "2", type: "lead" };
    expect(mergeSimulatorEvents([e1], [e1, e2])).toEqual([e1, e2]);
    expect(mergeSimulatorEvents([e1], [e2])).toEqual([e1, e2]);
    const cur = [e1];
    expect(mergeSimulatorEvents(cur, undefined)).toBe(cur);
  });

  it("explains every failure honestly and never as a reply", () => {
    expect(simulatorErrorText(apiError(503, { code: "voice_engine_unavailable" }))).toMatch(/never fakes/);
    expect(simulatorErrorText(apiError(502, { code: "ai_unavailable", message: "x" }))).toMatch(/AI provider did not answer/);
    expect(simulatorErrorText(apiError(409, { code: "unpublished" }))).toMatch(/Nothing is published/);
    expect(simulatorErrorText(apiError(409, { code: "paused" }))).toMatch(/paused/);
    expect(simulatorErrorText(apiError(404, { code: "unknown_session" }))).toMatch(/expired/);
    expect(simulatorErrorText(apiError(501, { code: "not_implemented" }))).toMatch(/isn't wired up/);
    expect(simulatorErrorText(apiError(400, { message: "Too long." }))).toBe("Too long.");
  });
});

describe("profileIssueText", () => {
  it("turns a dotted zod path into words", () => {
    const err = apiError(400, { code: "bad_request", issues: [{ path: "company.services.0.name", message: "Required" }, { path: "faq.0.answer", message: "x" }] });
    expect(profileIssueText(err)).toBe("Company › services #1 › name: Required (and 1 more)");
  });

  it("accepts array paths and plain messages", () => {
    expect(profileIssueText(apiError(400, { issues: [{ path: ["leadDelivery", "sms", "recipients", 0], message: "Use the international format" }] })))
      .toBe("Lead delivery › sms › recipients #1: Use the international format");
    expect(profileIssueText(apiError(409, { message: "Publish the assistant first." }))).toBe("Publish the assistant first.");
  });
});

describe("section maps", () => {
  it("every wizard step edits real editor sections, and every section has an editor entry", () => {
    const ids = new Set<string>(STUDIO_SECTIONS.map((s) => s.id));
    for (const step of WIZARD_STEPS) for (const sec of step.sections) expect(ids.has(sec)).toBe(true);
    // Every top-level profile key is reachable in the editor ("services" edits company too).
    const keys = Object.keys(voiceProfileSchema.shape).filter((k) => k !== "schemaVersion");
    for (const k of keys) expect(ids.has(k)).toBe(true);
  });
});
