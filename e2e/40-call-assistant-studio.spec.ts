import { expect, test, type Page, type Route } from "@playwright/test";
import { gotoCrm } from "./helpers";
import { defaultVoiceProfile, type VoiceProfile } from "../shared/voice-profile";
import { VOICE_PERSONA_LIST } from "../shared/voice-personas";
import { ADDONS, CALL_ASSISTANT_TIERS } from "../shared/plans";
import { CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SPAM, callAssistantIntroShort } from "../shared/plan-copy";

/**
 * Call Assistant — Agent Studio, Overview and Simulator (studio-frontend lane).
 *
 * The UI is exercised against FIXTURE backends: every /api/crm/voice/* call is
 * answered in the browser by a small stateful mock that follows
 * docs/call-assistant/SPEC.md § 6 (and the studio-backend lane's extensions:
 * regions carry `counties`, an "all-<state>" region, cumulative simulator
 * events). The real server still serves the page, the session and /api/crm/me,
 * so the shell, routing and plan gate are the real ones. Nothing here touches
 * the database, the engine or SignalWire.
 */

const WA_COUNTIES = [
  { id: 9001, name: "Island", stateCode: "WA" },
  { id: 9002, name: "King", stateCode: "WA" },
  { id: 9003, name: "Pierce", stateCode: "WA" },
  { id: 9004, name: "San Juan", stateCode: "WA" },
  { id: 9005, name: "Skagit", stateCode: "WA" },
  { id: 9006, name: "Snohomish", stateCode: "WA" },
  { id: 9007, name: "Spokane", stateCode: "WA" },
  { id: 9008, name: "Whatcom", stateCode: "WA" },
];
const BORDER_TO_TACOMA = ["Whatcom", "San Juan", "Skagit", "Island", "Snohomish", "King", "Pierce"];

type Version = { version: number; note: string | null; createdAt: string; createdBy: string | null; profile: VoiceProfile };

type MockOpts = { enabled?: boolean; published?: boolean; engineDownOnTurn?: number; failPuts?: number };

class VoiceMock {
  draft: VoiceProfile;
  status: "draft" | "live" | "paused" = "draft";
  publishedVersion: number | null = null;
  setupCompletedAt: string | null = null;
  versions: Version[] = [];
  puts: VoiceProfile[] = [];
  publishes: Array<Record<string, unknown>> = [];
  simTurns = 0;
  simSessionBodies: Array<Record<string, unknown>> = [];
  unblocked: string[] = [];
  spamEntries = [
    { id: 41, phoneNumber: "+13605550199", strikes: 2, calls: 5, blocked: true, blockedBy: "auto", lastReason: "Sales pitch about Google listings", lastConfidence: 0.97, lastSeenAt: "2026-10-01T16:00:00.000Z" },
    { id: 42, phoneNumber: "+13605550142", strikes: 1, calls: 1, blocked: false, blockedBy: null, lastReason: "Robocall", lastConfidence: 0.9, lastSeenAt: "2026-10-02T09:00:00.000Z" },
  ];

  constructor(private opts: MockOpts = {}) {
    // What the backend seeds a new org with: the CRM's own company fields, nothing invented.
    this.draft = defaultVoiceProfile({ name: "Acme Siding LLC", timezone: "America/Los_Angeles", state: "WA" });
    if (opts.published) {
      this.draft = {
        ...this.draft,
        company: { ...this.draft.company, name: "Acme Siding", services: [{ name: "Siding replacement", details: "", tier: "primary" }] },
        serviceArea: { ...this.draft.serviceArea, counties: WA_COUNTIES.slice(0, 2) },
      };
      this.publish({ note: "seed" });
    }
  }

  compiled(version: number) {
    const persona = VOICE_PERSONA_LIST.find((p) => p.id === this.draft.persona.presetId)!;
    return {
      schemaVersion: 1, version, hash: "abc123def4567890", compiledAt: "2026-10-02T12:00:00.000Z",
      persona: { id: persona.id, voice: persona.voice, name: this.draft.persona.assistantName || persona.name },
      greeting: this.draft.persona.greeting || `Thank you for calling ${this.draft.company.name}, this is ${persona.name}.`,
      botAnswer: this.draft.persona.botAnswer, languages: ["en"],
      systemPrompt: `FIXTURE SYSTEM PROMPT for ${this.draft.company.name}\n## Intake\n${this.draft.intake.questions.map((q) => `- ${q.key}`).join("\n")}`,
      intake: this.draft.intake.questions, decisionSchema: {}, escalationKinds: ["human", "urgent"],
      timings: { silencePromptSeconds: 12, silencePromptsBeforeHangup: 2, maxCallSeconds: 900, greetingDelaySeconds: 3, maxTurns: 40 },
      style: { temperature: 0.3 }, spam: { flagAt: 0.8, strikeAt: 0.95 }, vocabulary: [], appointments: { enabled: false },
    };
  }

  publish(body: Record<string, unknown>) {
    const version = (this.publishedVersion ?? 0) + 1;
    this.versions.unshift({ version, note: (body.note as string) ?? null, createdAt: "2026-10-02T12:00:00.000Z", createdBy: null, profile: structuredClone(this.draft) });
    this.publishedVersion = version;
    this.status = "live";
    if (body.setupCompleted) this.setupCompletedAt = "2026-10-02T12:00:00.000Z";
    this.publishes.push(body);
    return { version, compiled: this.compiled(version), status: this.status };
  }

  profileResponse() {
    return {
      profile: this.draft, status: this.status, publishedVersion: this.publishedVersion,
      compiled: this.publishedVersion ? this.compiled(this.publishedVersion) : null, setupCompletedAt: this.setupCompletedAt,
    };
  }

  statusResponse() {
    return {
      enabled: this.opts.enabled !== false,
      // `preview` as server/voice/billing.ts reports it: from the price book (false since the launch).
      addon: { key: "call_assistant", name: "AI Call Assistant", preview: ADDONS.call_assistant.preview === true, availableOn: ["pro", "growth", "agency"] },
      plan: "pro",
      allowance: { numbers: 1, minutes: 500 },
      pricing: { includedMinutes: 500, overageCentsPerMinute: 10, freeSpamCalls: 500 },
      tier: { key: "solo", addon: "call_assistant", name: "Solo" },
      tiers: CALL_ASSISTANT_TIERS.map((t) => ({ key: t.tier, addon: t.addon, name: t.name, monthlyCents: t.monthlyCents, annualCents: t.annualCents, includedMinutes: t.includedMinutes, includedNumbers: t.includedNumbers, preview: ADDONS[t.addon].preview === true })),
      canManage: true,
      engine: { configured: true, reachable: false, models: false, checkedAt: "2026-10-02T00:00:00.000Z" },
      numbers: [{ id: "n1", phoneNumber: "+13605550100", label: "Main line", location: "Bellingham", status: "active", isTest: true }],
      profile: { status: this.status, publishedVersion: this.publishedVersion },
      usage: { month: "2026-10", minutes: 120, calls: 14, overageMinutes: 0, spamCallsThisMonth: 37, freeSpamCalls: 30, freeSpamMinutes: 41, freeSpamCallsLimit: 500 },
    };
  }

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/crm\/voice/, "");
    const method = req.method();
    const body = (() => { try { return req.postDataJSON() ?? {}; } catch { return {}; } })();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    if (path === "/status") return json(this.statusResponse());
    if (this.opts.enabled === false) {
      return json({ code: "plan_required", requiredPlan: "pro", addon: "call_assistant", message: "AI Call Assistant is an add-on." }, 402);
    }
    if (path === "/profile" && method === "GET") return json(this.profileResponse());
    if (path === "/profile" && method === "PUT") {
      if ((this.opts.failPuts ?? 0) > 0) {
        this.opts.failPuts!--;
        return json({ code: "invalid", issues: [{ path: "offers.promotions.0.name", message: "String must contain at least 1 character(s)" }] }, 400);
      }
      this.draft = structuredClone(body.profile);
      this.puts.push(structuredClone(body.profile));
      return json(this.profileResponse());
    }
    if (path === "/profile/publish") return json(this.publish(body));
    if (path === "/profile/pause") { this.status = "paused"; return json({ status: "paused" }); }
    if (path === "/profile/resume") { this.status = "live"; return json({ status: "live" }); }
    if (path === "/profile/preview") return json({ compiled: this.compiled((this.publishedVersion ?? 0) + 1), version: (this.publishedVersion ?? 0) + 1 });
    if (path === "/profile/versions") return json({ versions: this.versions.map(({ profile: _p, ...v }) => v) });
    const ver = /^\/profile\/versions\/(\d+)(\/restore)?$/.exec(path);
    if (ver) {
      const v = this.versions.find((x) => x.version === Number(ver[1]));
      if (!v) return json({ code: "not_found" }, 404);
      if (ver[2]) { this.draft = structuredClone(v.profile); return json({ ...this.profileResponse(), restoredFrom: v.version }); }
      return json({ ...v, compiled: this.compiled(v.version) });
    }
    if (path === "/counties") {
      const state = url.searchParams.get("state");
      const counties = state === "WA" ? WA_COUNTIES : [];
      const regions = state === "WA" ? [
        { id: "wa-border-to-tacoma", name: "Canadian border to Tacoma", stateCode: "WA", description: BORDER_TO_TACOMA.join(", "),
          counties: WA_COUNTIES.filter((c) => BORDER_TO_TACOMA.includes(c.name)), missing: [] },
        { id: "all-wa", name: "All counties in WA", stateCode: "WA", description: `${counties.length} counties`, counties, missing: [] },
      ] : [];
      return json({ state, counties, regions });
    }
    if (path === "/personas") return json({ personas: VOICE_PERSONA_LIST });
    if (path === "/calls/summary") return json({ range: "30d", total: 14, minutes: 37, recordings: 12, firstCallAt: "2026-09-05T15:00:00.000Z", outcomes: { lead_submitted: 5, info: 4, hangup: 3, spam: 2 }, lines: [{ label: "Main line", calls: 14, leads: 5 }] });
    if (path.startsWith("/calls")) return json({ calls: [{ id: "c1", startedAt: "2026-10-02T15:00:00.000Z", fromNumber: "+13605551111", outcome: "lead_submitted", summary: "Hardie siding, whole house" }] });
    if (path === "/simulator/session" && method === "POST") {
      this.simSessionBodies.push(body);
      return json({ sessionId: "sim-session-0001", greeting: "Thank you for calling Acme Siding, this is Janice.", compiledVersion: this.publishedVersion ?? 0 });
    }
    if (path === "/simulator/turn") {
      this.simTurns++;
      if (this.opts.engineDownOnTurn === this.simTurns) return json({ code: "voice_engine_unavailable", message: "down" }, 503);
      const events = [{ t: "2026-10-02T12:00:01Z", type: "turn" }];
      if (this.simTurns >= 2) events.push({ t: "2026-10-02T12:00:02Z", type: "lead" });
      return json({
        say: this.simTurns === 1 ? "What's the street address and city for the property?" : "Thanks, I've sent that to our team.",
        action: this.simTurns === 1 ? "continue" : "submit_lead",
        slots: this.simTurns === 1 ? { need: "new siding" } : { need: "new siding", address: "1 Main St, Bellingham" },
        ended: false, outcome: null, events, turn: this.simTurns, fallback: false,
      });
    }
    if (path.startsWith("/simulator/session/") && method === "DELETE") return json({ ended: true, summary: "Stopped after 2 caller turns; a lead was submitted." });
    if (path.startsWith("/numbers")) return json({ numbers: [], allowance: { numbers: 1 }, forwarding: [] });
    if (path === "/spam") {
      return json({
        entries: this.spamEntries, blocked: this.spamEntries.filter((e) => e.blocked).length,
        thisMonth: { month: "2026-10", spamCalls: 37, screened: 30, rejected: 7, freeSpamCalls: 30, freeSpamMinutes: 41, freeSpamCallsLimit: 500 },
      });
    }
    const unblock = path.match(/^\/spam\/(\d+)\/unblock$/);
    if (unblock && method === "POST") {
      this.unblocked.push(unblock[1]);
      const entry = this.spamEntries.find((e) => String(e.id) === unblock[1])!;
      Object.assign(entry, { blocked: false, strikes: 0 });
      return json({ unblocked: true, entry });
    }
    if (path === "/escalations" || path.startsWith("/escalations?")) return json({ escalations: [] });
    return json({ code: "not_implemented", lane: "fixture", todo: path }, 501);
  }
}

async function mockVoice(page: Page, opts: MockOpts = {}, me?: { manageSettings: boolean }) {
  const mock = new VoiceMock(opts);
  await page.route(/\/api\/crm\/voice\//, (route) => mock.handle(route));
  if (me) {
    await page.route(/\/api\/crm\/me(\?|$)/, async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      await route.fulfill({ response: res, json: { ...j, permissions: { ...(j.permissions ?? {}), manageSettings: me.manageSettings } } });
    });
  }
  return mock;
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("Call Assistant — Agent Studio", () => {
  test("first run: the setup wizard collects every step and publishes version 1", async ({ page }) => {
    const errors = trackErrors(page);
    const mock = await mockVoice(page);
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-wizard")).toBeVisible();

    // Company: prefilled from the CRM; Next is blocked while the name is blank.
    await expect(page.getByTestId("input-company-name")).toHaveValue("Acme Siding LLC");
    await page.getByTestId("input-company-name").fill("");
    await page.getByTestId("button-wizard-next").click();
    await expect(page.getByTestId("wizard-step-issues")).toContainText("Company name is required");
    await page.getByTestId("input-company-name").fill("Acme Siding");
    await page.getByTestId("button-wizard-next").click();

    // Services & don'ts.
    await expect(page.getByTestId("section-services")).toBeVisible();
    await page.getByTestId("button-add-service").click();
    await page.getByTestId("input-service-name-0").fill("Siding replacement");
    await page.getByTestId("button-add-decline").click();
    await page.getByTestId("input-decline-what-0").fill("Repairs");
    await page.getByTestId("input-decline-referral-0").fill("a local handyman would be the best fit");
    await page.getByTestId("button-wizard-next").click();

    // Service area: the region shortcut adds its seven real counties; one checkbox adds Spokane.
    await expect(page.getByTestId("section-service-area")).toBeVisible();
    await page.getByTestId("button-region-wa-border-to-tacoma").click();
    await expect(page.getByTestId("badge-county-count")).toHaveText("7 counties");
    await page.getByTestId("checkbox-county-9007").click();
    await expect(page.getByTestId("badge-county-count")).toHaveText("8 counties");
    await expect(page.getByTestId("button-region-all")).toHaveCount(0); // backend's own all-wa shortcut is used instead
    await page.getByTestId("button-wizard-next").click();

    // Credibility, offers, policies.
    await page.getByTestId("switch-insured").click();
    await page.getByTestId("button-wizard-next").click();
    await expect(page.getByTestId("section-offers")).toBeVisible();
    await page.getByTestId("button-wizard-next").click();
    await expect(page.getByTestId("section-policies")).toBeVisible();
    await page.getByTestId("button-wizard-next").click();

    // Persona: pick Gabe; samples not rendered yet → the play button says so honestly.
    await expect(page.getByTestId("persona-cards")).toBeVisible();
    await page.getByTestId("card-persona-gabe").click();
    await expect(page.getByTestId("card-persona-gabe")).toHaveAttribute("aria-checked", "true");
    // The samples ship in client/public/persona-samples/ (served by the app, outside the /voice/* proxy).
    await expect(page.getByTestId("button-persona-play-gabe")).toBeEnabled();
    const sample = await page.request.get("/persona-samples/gabe.mp3");
    expect(sample.status()).toBe(200);
    expect(sample.headers()["content-type"]).toContain("audio/mpeg");
    await page.getByTestId("button-wizard-next").click();

    // Intake: add a custom question and move it up one.
    await expect(page.getByTestId("list-intake-questions")).toBeVisible();
    await page.getByTestId("input-intake-new").fill("Roughly how old is the siding?");
    await page.getByTestId("button-intake-add").click();
    await expect(page.getByTestId("input-intake-prompt-6")).toHaveValue("Roughly how old is the siding?");
    await page.getByTestId("button-intake-up-6").click();
    await expect(page.getByTestId("input-intake-prompt-5")).toHaveValue("Roughly how old is the siding?");
    await page.getByTestId("button-wizard-next").click();

    // Delivery & escalations: an SMS rule; the number is normalized to E.164 on blur.
    await expect(page.getByTestId("section-lead-delivery")).toBeVisible();
    await page.getByTestId("button-add-escalation").click();
    await page.getByTestId("input-escalation-name-0").fill("Mike");
    await page.getByTestId("input-escalation-recipient-0").fill("(360) 555-1234");
    await page.getByTestId("input-escalation-recipient-0").blur();
    await expect(page.getByTestId("input-escalation-recipient-0")).toHaveValue("+13605551234");
    await page.getByTestId("button-wizard-next").click();

    // Review → publish.
    await expect(page.getByTestId("wizard-review")).toBeVisible();
    await expect(page.getByTestId("wizard-review-issues")).toHaveCount(0);
    await page.getByTestId("button-wizard-publish").click();
    await expect(page.getByTestId("studio-editor")).toBeVisible();
    await expect(page.getByTestId("badge-studio-version")).toHaveText("v1");

    // What reached the backend is the whole profile the wizard built.
    expect(mock.publishes.at(-1)).toMatchObject({ setupCompleted: true });
    const saved = mock.puts.at(-1)!;
    expect(saved.company.name).toBe("Acme Siding");
    expect(saved.company.services.map((s) => s.name)).toEqual(["Siding replacement"]);
    expect(saved.company.declines[0]).toEqual({ what: "Repairs", referral: "a local handyman would be the best fit" });
    expect(saved.serviceArea.counties.map((c) => c.id).sort()).toEqual(WA_COUNTIES.map((c) => c.id).sort());
    expect(saved.credibility.insured).toBe(true);
    expect(saved.persona.presetId).toBe("gabe");
    expect(saved.intake.questions[5].prompt).toBe("Roughly how old is the siding?");
    expect(saved.intake.questions[5].key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(saved.escalations.rules[0]).toMatchObject({ recipientName: "Mike", recipient: "+13605551234", channel: "sms", kinds: ["human", "urgent"] });
    expect(errors).toEqual([]);
  });

  test("editor: edit, save, publish with a diff, preview, restore a version", async ({ page }) => {
    const errors = trackErrors(page);
    const mock = await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-editor")).toBeVisible();
    await expect(page.getByTestId("badge-studio-version")).toHaveText("v1");
    await expect(page.getByTestId("text-studio-dirty")).toHaveText("All changes saved");

    // Persona: change the greeting → dirty → save draft.
    await page.getByTestId("studio-nav-persona").click();
    await page.getByTestId("textarea-greeting").fill("Acme Siding, this is Janice. How can I help?");
    await expect(page.getByTestId("text-studio-dirty")).toHaveText("Unsaved changes");
    await page.getByTestId("button-studio-save").click();
    await expect(page.getByTestId("text-studio-dirty")).toHaveText("All changes saved");
    expect(mock.puts.at(-1)!.persona.greeting).toBe("Acme Siding, this is Janice. How can I help?");

    // A blocking problem disables Publish and marks the section in the nav.
    await page.getByTestId("studio-nav-faq").click();
    await page.getByTestId("button-add-faq").click();
    await expect(page.getByTestId("text-studio-issues")).toContainText("1 to fix");
    await expect(page.getByTestId("button-studio-publish")).toBeDisabled();
    await page.getByTestId("input-faq-question-0").fill("Do you do decks?");
    await page.getByTestId("textarea-faq-answer-0").fill("No — siding only.");
    await expect(page.getByTestId("button-studio-publish")).toBeEnabled();

    // Publish: the dialog shows what changed against v1; unsaved edits are saved first.
    await page.getByTestId("button-studio-publish").click();
    await expect(page.getByTestId("dialog-publish")).toBeVisible();
    await expect(page.getByTestId("list-publish-diff")).toContainText("Persona: greeting changed");
    await expect(page.getByTestId("list-publish-diff")).toContainText("FAQ: 0 answers → 1 answer");
    await page.getByTestId("input-publish-note").fill("New greeting + decks FAQ");
    await page.getByTestId("button-publish-confirm").click();
    await expect(page.getByTestId("badge-studio-version")).toHaveText("v2");
    expect(mock.puts.at(-1)!.faq).toEqual([{ question: "Do you do decks?", answer: "No — siding only." }]);
    expect(mock.publishes.at(-1)).toMatchObject({ note: "New greeting + decks FAQ" });

    // Prompt preview shows the compiled draft from the backend.
    await page.getByTestId("studio-nav-preview").click();
    await expect(page.getByTestId("preview-system-prompt")).toContainText("FIXTURE SYSTEM PROMPT for Acme Siding");
    await expect(page.getByTestId("preview-intake-list")).toContainText("best_time");

    // Version history: restore v1 into the draft (greeting back to blank).
    await page.getByTestId("studio-nav-versions").click();
    await expect(page.getByTestId("row-version-2")).toContainText("New greeting + decks FAQ");
    await page.getByTestId("button-version-restore-1").click();
    await page.getByTestId("button-version-restore-confirm").click();
    await page.getByTestId("studio-nav-persona").click();
    await expect(page.getByTestId("textarea-greeting")).toHaveValue("");

    // Pause / resume.
    await page.getByTestId("button-studio-pause").click();
    await expect(page.getByTestId("badge-studio-status")).toHaveText("paused");
    await page.getByTestId("button-studio-pause").click();
    await expect(page.getByTestId("badge-studio-status")).toHaveText("live");
    expect(errors).toEqual([]);
  });

  test("wizard: a failed draft save keeps the step (red chip) instead of moving on with a checkmark", async ({ page }) => {
    const mock = await mockVoice(page, { failPuts: 1 });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-wizard")).toBeVisible();
    await page.getByTestId("button-wizard-next").click();
    await expect(page.getByTestId("wizard-step-company")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("wizard-step-company")).toHaveAttribute("data-save-failed", "true");
    expect(mock.puts).toHaveLength(0);
    // the next save works: the wizard moves on and the chip is no longer red
    await page.getByTestId("button-wizard-next").click();
    await expect(page.getByTestId("wizard-step-services")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("wizard-step-company")).not.toHaveAttribute("data-save-failed", "true");
    expect(mock.puts).toHaveLength(1);
  });

  test("wizard: Skip to the editor opens the draft the wizard just saved (no stale cache)", async ({ page }) => {
    const mock = await mockVoice(page);
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-wizard")).toBeVisible();
    await page.getByTestId("input-company-name").fill("Acme Siding");
    await page.getByTestId("button-wizard-next").click(); // saves the draft
    expect(mock.puts).toHaveLength(1);
    await page.getByTestId("button-wizard-skip").click();
    await expect(page.getByTestId("studio-editor")).toBeVisible();
    // The editor must show what the wizard saved — not the cached pre-wizard copy.
    await expect(page.getByTestId("input-company-name")).toHaveValue("Acme Siding");
  });

  test("editor: the setup wizard is disabled while there are unsaved edits", async ({ page }) => {
    await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-editor")).toBeVisible();
    await page.getByTestId("studio-nav-persona").click();
    await page.getByTestId("textarea-greeting").fill("A greeting I have not saved");
    await expect(page.getByTestId("text-studio-dirty")).toHaveText("Unsaved changes");
    // Entering the wizard now would seed it from the SAVED draft and drop this edit silently.
    await expect(page.getByTestId("button-studio-wizard")).toBeDisabled();
    await page.getByTestId("button-studio-save").click();
    await expect(page.getByTestId("text-studio-dirty")).toHaveText("All changes saved");
    await expect(page.getByTestId("button-studio-wizard")).toBeEnabled();
  });

  test("editor: a value the server would refuse (max turns 999) blocks Publish; the field clamps on blur", async ({ page }) => {
    await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("studio-editor")).toBeVisible();
    await page.getByTestId("studio-nav-advanced").click();
    await page.getByTestId("input-max-turns").fill("999");
    await expect(page.getByTestId("button-studio-publish")).toBeDisabled();
    await expect(page.getByTestId("text-studio-issues")).toContainText("1 to fix");
    await page.getByTestId("input-max-turns").blur();
    await expect(page.getByTestId("input-max-turns")).toHaveValue("80");
    await expect(page.getByTestId("button-studio-publish")).toBeEnabled();
  });

  test("intake: an open options panel moves with its question", async ({ page }) => {
    await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await page.getByTestId("studio-nav-intake").click();
    await page.getByTestId("button-intake-options-1").click();
    await expect(page.getByTestId("input-intake-key-1")).toHaveValue("address");
    await page.getByTestId("button-intake-down-1").click();
    await expect(page.getByTestId("panel-intake-options-1")).toHaveCount(0);
    await expect(page.getByTestId("input-intake-key-2")).toHaveValue("address");
  });

  test("members without manageSettings see the Studio read-only", async ({ page }) => {
    await mockVoice(page, { published: true }, { manageSettings: false });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("text-studio-readonly")).toBeVisible();
    await expect(page.getByTestId("button-studio-save")).toHaveCount(0);
    await expect(page.getByTestId("input-company-name")).toBeDisabled();
  });

  test("mobile: sections switch through a select, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("select-studio-section")).toBeVisible();
    await expect(page.getByTestId("studio-nav")).toBeHidden();
    await page.getByTestId("select-studio-section").click();
    await page.getByRole("option", { name: "Intake questions" }).click();
    await expect(page.getByTestId("section-intake")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Call Assistant — Overview and Simulator", () => {
  test("overview shows status, minutes, numbers and recent calls", async ({ page }) => {
    await mockVoice(page, { published: true });
    await gotoCrm(page, "/call-assistant?tab=overview");
    await expect(page.getByTestId("metric-overview-minutes")).toContainText("120");
    await expect(page.getByTestId("text-overview-minutes-pct")).toHaveText("24%");
    await expect(page.getByTestId("row-overview-number-0")).toContainText("(360) 555-0100");
    // Same labels as the Calls tab, and each row opens that call.
    await expect(page.getByTestId("row-overview-call-0")).toContainText("Lead");
    await expect(page.getByTestId("link-overview-call-0")).toHaveAttribute("href", /^\/call-assistant\?tab=calls&call=/);
    // The engine is probed: configured but not answering reads "Engine down", never "configured".
    await expect(page.getByTestId("pill-overview-engine")).toHaveText("Engine down");
    // Launched: no "Coming soon" badge while the price book sells the add-on.
    expect(ADDONS.call_assistant.preview ?? false).toBe(false);
    await expect(page.getByTestId("badge-overview-preview")).toHaveCount(0);
    await expect(page.getByText("Pricing is being finalized")).toHaveCount(0);
    // The tier, the tiers to move between, and this month's spam (owner, 2026-10-02).
    await expect(page.getByTestId("text-overview-tier")).toHaveText("Solo — 2,000 minutes and 1 local number a month");
    for (const t of CALL_ASSISTANT_TIERS) await expect(page.getByTestId(`row-overview-tier-${t.tier}`)).toContainText(t.name);
    await expect(page.getByTestId("row-overview-tier-solo")).toContainText("Current");
    await expect(page.getByTestId("row-overview-tier-fleet")).toContainText("Upgrade");
    // Four tiers (owner, 2026-10-02): Lite is below Solo; Crew and Fleet pay 5¢ a minute over, Lite and Solo 10¢.
    await expect(page.locator('[data-testid^="row-overview-tier-"]')).toHaveCount(4);
    await expect(page.getByTestId("row-overview-tier-lite")).toContainText("Downgrade");
    for (const t of CALL_ASSISTANT_TIERS) await expect(page.getByTestId(`row-overview-tier-${t.tier}`)).toContainText(`${t.overageCentsPerMinute}¢/min over`);
    await expect(page.getByTestId("link-overview-change-tier")).toHaveAttribute("href", "/settings?tab=billing");
    await expect(page.getByTestId("metric-overview-spam")).toContainText("37");
    await expect(page.getByTestId("metric-overview-spam")).toContainText("30 of 500 free spam calls used");
  });

  test("calls: the Spam blocked view shows this month's count and the ledger; a false positive is unblocked in one click", async ({ page }) => {
    const errors = trackErrors(page);
    const mock = await mockVoice(page, { published: true }, { manageSettings: true });
    await gotoCrm(page, "/call-assistant?tab=calls");
    await expect(page.getByTestId("badge-spam-this-month")).toHaveText("37");
    await page.getByTestId("button-calls-view-spam").click();
    await expect(page.getByTestId("card-spam-summary")).toContainText(CALL_ASSISTANT_SPAM.headline);
    await expect(page.getByTestId("text-spam-this-month")).toHaveText("37");
    await expect(page.getByTestId("text-spam-rejected")).toHaveText("7");
    await expect(page.getByTestId("text-spam-numbers-blocked")).toHaveText("1");
    await expect(page.getByTestId("text-spam-free-used")).toHaveText("30 / 500");
    await expect(page.getByTestId("pill-spam-status-41")).toHaveText("Blocked (auto)");
    await page.getByTestId("button-spam-unblock-41").click();
    await expect(page.getByTestId("pill-spam-status-41")).toHaveText("Watching");
    expect(mock.unblocked).toEqual(["41"]);
    expect(errors).toEqual([]);
  });

  test("simulator: a turn shows the decision and slots; engine down is said, never faked", async ({ page }) => {
    const errors = trackErrors(page);
    const mock = await mockVoice(page, { published: true, engineDownOnTurn: 3 });
    await gotoCrm(page, "/call-assistant?tab=simulator");
    await page.getByTestId("input-simulator-caller").fill("360 555 1111");
    await page.getByTestId("button-simulator-start").click();
    expect(mock.simSessionBodies[0]).toEqual({ useDraft: false, callerNumber: "+13605551111" });
    await expect(page.getByTestId("simulator-message-0")).toContainText("this is Janice");

    await page.getByTestId("input-simulator-text").fill("I need new siding");
    await page.getByTestId("button-simulator-send").click();
    await expect(page.getByTestId("simulator-action-2")).toHaveText("Continue");
    await expect(page.getByTestId("simulator-slot-need")).toContainText("new siding");

    await page.getByTestId("input-simulator-text").fill("1 Main St, Bellingham");
    await page.getByTestId("input-simulator-text").press("Enter");
    await expect(page.getByTestId("simulator-last-action")).toHaveText("Lead submitted");
    await expect(page.getByTestId("simulator-slot-address")).toContainText("Bellingham");
    // Cumulative events from the backend are not duplicated.
    await expect(page.getByTestId("simulator-events").locator("li")).toHaveCount(2);

    await page.getByTestId("input-simulator-text").fill("hello?");
    await page.getByTestId("button-simulator-send").click();
    await expect(page.getByTestId("text-simulator-error")).toContainText("never fakes");
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(3); // greeting + two real replies, no invented third

    await page.getByTestId("button-simulator-end").click();
    await expect(page.getByTestId("text-simulator-ended")).toBeVisible();
    await page.getByTestId("button-simulator-reset").click();
    await expect(page.getByTestId("button-simulator-start")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("without the add-on, the plan prompt replaces the tabs", async ({ page }) => {
    await mockVoice(page, { enabled: false });
    await gotoCrm(page, "/call-assistant?tab=studio");
    await expect(page.getByTestId("plan-required-callAssistant")).toBeVisible();
    await expect(page.getByTestId("tabs-call-assistant")).toHaveCount(0);
    // On sale (launched): the prompt links Billing to buy it — no "Coming soon", no disabled "Not available yet".
    await expect(page.getByTestId("link-call-assistant-billing")).toHaveAttribute("href", "/settings?tab=billing");
    await expect(page.getByTestId("button-call-assistant-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("badge-call-assistant-preview")).toHaveCount(0);
    await expect(page.getByTestId("plan-required-callAssistant")).not.toContainText("Pricing is being finalized");
  });
});

// Owner, 2026-10-02: "As soon as they stop paying the agent stops working" — the CRM says so and links Billing.
test.describe("Call Assistant — paused for a payment", () => {
  test("a payment-needed subscription shows Paused with a way to Billing; the Numbers tab states the number rules", async ({ page }) => {
    // The CRM's voice API answered as server/voice/billing.ts does for a past_due owner (mocked: no subscription is touched).
    const status = {
      enabled: false, paused: true, pausedReason: "payment_needed", billingHref: "/settings?tab=billing", subscriptionStatus: "past_due",
      addon: { key: "call_assistant", name: ADDONS.call_assistant.name, preview: ADDONS.call_assistant.preview === true, availableOn: ADDONS.call_assistant.availableOn, monthlyCents: ADDONS.call_assistant.monthlyCents, annualCents: ADDONS.call_assistant.annualCents },
      plan: "pro", allowance: { numbers: 1, minutes: 500 }, units: { callAssistant: 1, callNumber: 0 },
      pricing: { includedMinutes: 500, overageCentsPerMinute: 15, numberMinDays: 14 },
      engine: { configured: true, reachable: true, models: true, checkedAt: new Date().toISOString() },
      numbersProvider: { configured: true, mock: true }, canManage: true,
      numbers: [{ id: "n1", phoneNumber: "+13605550100", label: "Main line", location: "Bellingham", status: "active", isTest: false }],
      profile: { status: "live", publishedVersion: 2 }, usage: { month: "2026-10", minutes: 12, calls: 3, overageMinutes: 0 },
    };
    const number = {
      id: "n1", phoneNumber: "+13605550100", label: "Main line", location: "Bellingham", state: "WA", areaCode: "360", locality: "Bellingham",
      provider: "mock", providerSid: "PNmock", friendlyName: "Main", voiceUrl: null, statusCallbackUrl: null, status: "active", isTest: false,
      forwardingFrom: null, monthlyCents: 0, purchasedAt: "2026-09-01T00:00:00.000Z", releaseEligibleAt: "2026-09-15T00:00:00.000Z", releasable: true,
      releasedAt: null, lastError: null, createdAt: "2026-09-01T00:00:00.000Z", releaseReason: null, releaseReasonText: null, releaseScheduledAt: null,
    };
    const numbers = {
      numbers: [number], allowance: { numbers: 1, used: 1, remaining: 0, includedNumbers: 1, extraNumberMonthlyCents: 500 }, nextNumberMonthlyCents: 500,
      minDays: 14, forwarding: { carriers: [], advice: [] }, webhooks: { voiceUrl: "", statusCallbackUrl: "", mediaUrl: "" },
      configured: true, mock: true, canManage: true, paused: true,
    };
    await page.route("**/api/crm/voice/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/crm/voice/status") return json(status);
      if (path === "/api/crm/voice/numbers") return json(numbers);
      if (path.startsWith("/api/crm/voice/calls")) return json({ calls: [] });
      return route.fulfill({ status: 402, contentType: "application/json", body: JSON.stringify({ code: "payment_required", message: "paused" }) });
    });

    await gotoCrm(page, "/call-assistant?tab=overview");
    const banner = page.getByTestId("banner-call-assistant-paused");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("text-call-assistant-paused")).toHaveText("Paused — update your payment method");
    await expect(page.getByTestId("link-call-assistant-paused-billing")).toHaveAttribute("href", "/settings?tab=billing");
    await expect(page.getByTestId("plan-required-callAssistant")).toHaveCount(0);
    await expect(page.getByTestId("text-overview-price")).toContainText(callAssistantIntroShort());

    await page.getByTestId("tab-call-assistant-numbers").click();
    await expect(page.getByTestId("banner-call-assistant-paused")).toBeVisible();
    await expect(page.getByTestId("text-voice-numbers-rule-own")).toHaveText(CALL_ASSISTANT_NUMBER_RULES.ownNumbers);
    await expect(page.getByTestId("text-voice-numbers-rule-cancel")).toHaveText(CALL_ASSISTANT_NUMBER_RULES.cancel);
    await expect(page.getByTestId("text-voice-numbers-rule-payment")).toHaveText(CALL_ASSISTANT_NUMBER_RULES.payment);
    // Read-only while paused: no buying, no releasing.
    await expect(page.getByTestId("card-voice-number-n1")).toBeVisible();
    await expect(page.getByTestId("button-voice-number-release-n1")).toHaveCount(0);
    await expect(page.getByTestId("button-voice-number-add")).toHaveCount(0);
  });
});
