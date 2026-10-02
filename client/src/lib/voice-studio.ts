/**
 * Agent Studio helpers — PURE (no React, no "@/" imports) so the server-side
 * vitest suite can check them (server/voice/studio-frontend.test.ts) and the
 * Studio pages (client/src/pages/crm-call-assistant/studio/*) can share them.
 *
 * OWNER: studio-frontend lane (docs/call-assistant/LANES.md). Response shapes
 * follow docs/call-assistant/SPEC.md § 6 (CRM API); anything added beyond the
 * spec is written down in docs/call-assistant/LANE-NOTES-studio-frontend.md.
 */
import {
  DEFAULT_INTAKE_QUESTIONS,
  ESCALATION_KINDS,
  type CompiledProfile,
  type DayKey,
  type EscalationKind,
  type EscalationRule,
  type IntakeQuestion,
  type VoiceProfile,
} from "@shared/voice-profile";

// ── API response shapes (SPEC § 6) ──────────────────────────────────────────

export type VoiceProfileResponse = {
  profile: VoiceProfile;
  publishedVersion: number | null;
  status: "draft" | "live" | "paused" | string;
  compiled: CompiledProfile | null;
  setupCompletedAt: string | null;
};

export type VoiceVersionRow = { version: number; note: string | null; createdAt: string; createdBy: string | null };
export type VoiceVersionDetail = VoiceVersionRow & { profile: VoiceProfile; compiled: CompiledProfile | null };

export type CountyRef = VoiceProfile["serviceArea"]["counties"][number];
/**
 * A region shortcut. SPEC § 6 says `countyIds`; the studio-backend lane
 * answers with resolved `counties` (+ `description`, `missing`) and an
 * "all-<state>" region of its own. The Studio accepts either shape.
 */
export type CountyRegion = {
  id: string; name: string; stateCode: string;
  countyIds?: number[]; counties?: CountyRef[]; description?: string; missing?: string[];
};
export type CountiesResponse = { counties: CountyRef[]; regions: CountyRegion[] };

/** The real county rows a region shortcut stands for (only ids present in this state's list). */
export function regionCounties(region: CountyRegion, stateCounties: CountyRef[]): CountyRef[] {
  const byId = new Map(stateCounties.map((c) => [c.id, c]));
  const ids = region.counties?.map((c) => c.id) ?? region.countyIds ?? [];
  const out: CountyRef[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const c = byId.get(id);
    if (c && !seen.has(id)) { seen.add(id); out.push(c); }
  }
  return out;
}

/** Adds counties to a selection, keeping order and dropping duplicates. */
export function addCounties(selected: CountyRef[], add: CountyRef[]): CountyRef[] {
  const ids = new Set(selected.map((c) => c.id));
  const next = selected.slice();
  for (const c of add) if (!ids.has(c.id)) { ids.add(c.id); next.push(c); }
  return next;
}

/** True when the backend already sends an "all counties in <state>" shortcut. */
export const hasAllCountiesRegion = (regions: CountyRegion[]) => regions.some((r) => r.id.startsWith("all-"));

export type SimulatorSession = { sessionId: string; greeting: string; compiledVersion: number | null };
export type SimulatorEvent = { t?: string | number; type: string; detail?: unknown; decision?: unknown };
export type SimulatorTurn = {
  say: string;
  action: "continue" | "submit_lead" | "flag_spam" | "alert" | "end_call";
  slots?: Record<string, string>;
  alert?: { kind: EscalationKind; summary: string };
  spam?: { confidence: number; reason: string };
  outcome?: string | null;
  /** The app backend returns the call's events so far (cumulative); the engine may return only new ones. */
  events?: SimulatorEvent[];
  ended?: boolean;
  /** Caller turn number (studio-backend extension). */
  turn?: number;
  /** True when the model's JSON was unusable and the honest fallback line was spoken. */
  fallback?: boolean;
};

/** Merge turn events into the running list without duplicates (works for cumulative or incremental lists). */
export function mergeSimulatorEvents(current: SimulatorEvent[], incoming: SimulatorEvent[] | undefined): SimulatorEvent[] {
  if (!incoming?.length) return current;
  const key = (e: SimulatorEvent) => `${e.t ?? ""}|${e.type}|${JSON.stringify(e.detail ?? null)}`;
  const seen = new Set(current.map(key));
  const next = current.slice();
  for (const e of incoming) { const k = key(e); if (!seen.has(k)) { seen.add(k); next.push(e); } }
  return next;
}

/** "STATUS: {json}" from apiRequest → { status, body }. */
export function parseApiError(err: unknown): { status: number | null; body: any } {
  const raw = typeof (err as any)?.message === "string" ? (err as any).message : String(err ?? "");
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!m) return { status: null, body: null };
  let body: any = null;
  try { body = JSON.parse(m[2]); } catch { body = m[2]; }
  return { status: Number(m[1]), body };
}

/** Plain words for a simulator failure. Never pretends the assistant replied. */
export function simulatorErrorText(err: unknown): string {
  const { status, body } = parseApiError(err);
  const code = body && typeof body === "object" ? body.code : null;
  const message = body && typeof body === "object" && typeof body.message === "string" ? body.message : null;
  if (code === "voice_engine_unavailable" || status === 503) return "The voice engine isn't reachable right now, so there is no reply to show. (The Simulator never fakes one.)";
  if (code === "ai_unavailable" || status === 502) return "The AI provider did not answer. Nothing was faked — try again in a moment.";
  if (code === "unpublished") return "Nothing is published yet. Run the draft, or publish first.";
  if (code === "paused") return "The assistant is paused. Run the draft, or resume it in Agent Studio.";
  if (code === "unknown_session") return "That simulated call has expired. Start a new one.";
  if (code === "session_ended") return "That simulated call has already ended. Start a new one.";
  if (status === 501) return "The Simulator backend isn't wired up yet (studio-backend lane).";
  return message ?? (typeof body === "string" && body ? body : "Something went wrong — please try again.");
}

const SECTION_BY_PATH: Record<string, string> = {
  company: "Company", serviceArea: "Service area", credibility: "Credibility", offers: "Offers", policies: "Policies",
  persona: "Persona", intake: "Intake questions", faq: "FAQ", escalations: "Escalations", leadDelivery: "Lead delivery",
  appointments: "Appointments", advanced: "Advanced",
};

/**
 * A profile 400 → one sentence. The backend sends zod issues with `path` as a
 * dotted string ("company.services.0.name"); arrays are accepted too.
 * Example: "Company › services #1 › name: Required".
 */
export function profileIssueText(err: unknown): string {
  const { status, body } = parseApiError(err);
  const issues = body && typeof body === "object" && Array.isArray(body.issues) ? body.issues : null;
  if (issues?.length) {
    const first = issues[0];
    const parts: Array<string | number> = Array.isArray(first.path) ? first.path : String(first.path ?? "").split(".").filter(Boolean);
    const words = parts.map((p, i) => {
      if (i === 0 && typeof p === "string" && SECTION_BY_PATH[p]) return SECTION_BY_PATH[p];
      if (typeof p === "number" || /^\d+$/.test(String(p))) return `#${Number(p) + 1}`;
      return String(p).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    });
    const where = words.join(" › ").replace(/ › #/g, " #");
    const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
    return `${where ? `${where}: ` : ""}${String(first.message ?? "is not valid")}${more}`;
  }
  if (body && typeof body === "object" && typeof body.message === "string") return body.message;
  if (status === 501) return "The Studio backend isn't wired up yet (studio-backend lane).";
  return typeof body === "string" && body ? body : "Something went wrong — please try again.";
}

/** First run = never published and the setup wizard never finished. */
export function isFirstRun(r: Pick<VoiceProfileResponse, "publishedVersion" | "setupCompletedAt"> | null | undefined): boolean {
  if (!r) return false;
  return r.publishedVersion == null && !r.setupCompletedAt;
}

// ── Static lists ─────────────────────────────────────────────────────────────

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" }, { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];
export const stateName = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;

export const US_TIMEZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Arizona (no DST)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export const ESCALATION_KIND_LABELS: Record<EscalationKind, string> = {
  human: "Caller insists on a person",
  urgent: "Emergency",
  existing_customer: "Existing customer",
  estimate_missing: "Estimate they never received",
  scheduling: "Scheduling a job",
  contract: "Contract question",
  payment: "Payment question",
  complaint: "Complaint",
  vendor: "Vendor or supplier",
  other: "Anything else",
};

export const INTAKE_VALIDATION_LABELS: Record<IntakeQuestion["validation"], string> = {
  none: "Free text", address: "Street address", name: "Name", phone: "Phone number", email: "Email",
  datetime: "Date or time", yes_no: "Yes / no", choice: "One of a list",
};

export const DECISION_ACTION_LABELS: Record<SimulatorTurn["action"], string> = {
  continue: "Continue", submit_lead: "Lead submitted", flag_spam: "Flagged as spam", alert: "Alert sent", end_call: "Call ended",
};

/** The editor's sections, in the compiler's order (SPEC § 3). */
export const STUDIO_SECTIONS = [
  { id: "company", label: "Company", blurb: "Name, what you do, hours." },
  { id: "services", label: "Services & don'ts", blurb: "What you sell, and what you decline." },
  { id: "serviceArea", label: "Service area", blurb: "Counties you serve." },
  { id: "credibility", label: "Credibility", blurb: "Years, licenses, warranties, reviews." },
  { id: "offers", label: "Offers", blurb: "Financing, promos, free estimates." },
  { id: "policies", label: "Policies", blurb: "Pricing, repairs, emergencies." },
  { id: "persona", label: "Persona", blurb: "Name, voice, greeting." },
  { id: "intake", label: "Intake questions", blurb: "What the assistant collects." },
  { id: "faq", label: "FAQ", blurb: "Answers to common questions." },
  { id: "escalations", label: "Escalations", blurb: "Who gets paged, and how." },
  { id: "leadDelivery", label: "Lead delivery", blurb: "CRM, email and text alerts." },
  { id: "appointments", label: "Appointments", blurb: "Off by default." },
  { id: "advanced", label: "Advanced", blurb: "Extra instructions and timings." },
] as const;
export type StudioSectionId = (typeof STUDIO_SECTIONS)[number]["id"];

/** Setup wizard steps (owner's PRODUCT SPEC order) → the sections each step edits. */
export const WIZARD_STEPS = [
  { id: "company", label: "Company", sections: ["company"] },
  { id: "services", label: "Services", sections: ["services"] },
  { id: "serviceArea", label: "Service area", sections: ["serviceArea"] },
  { id: "credibility", label: "Credibility", sections: ["credibility"] },
  { id: "offers", label: "Offers", sections: ["offers"] },
  { id: "policies", label: "Policies", sections: ["policies"] },
  { id: "persona", label: "Persona", sections: ["persona"] },
  { id: "intake", label: "Questions", sections: ["intake"] },
  { id: "delivery", label: "Delivery", sections: ["leadDelivery", "escalations"] },
  { id: "review", label: "Review", sections: [] },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

// ── Validation the Studio does before the server does (friendlier, same rules) ──

export type StudioIssue = { section: StudioSectionId; message: string };

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blocking problems a publish would hit (mirrors shared/voice-profile.ts), in plain words. */
export function studioIssues(p: VoiceProfile): StudioIssue[] {
  const out: StudioIssue[] = [];
  if (!p.company.name.trim()) out.push({ section: "company", message: "Company name is required." });
  if (p.company.officePhone && !E164.test(p.company.officePhone)) out.push({ section: "company", message: "Office phone must look like +13605551234." });
  if (p.company.services.length === 0) out.push({ section: "services", message: "Add at least one service the assistant can take calls about." });
  p.company.services.forEach((s, i) => { if (!s.name.trim()) out.push({ section: "services", message: `Service #${i + 1} has no name.` }); });
  p.company.declines.forEach((d, i) => { if (!d.what.trim()) out.push({ section: "services", message: `Decline #${i + 1} says nothing.` }); });
  if (p.serviceArea.counties.length === 0 && p.serviceArea.spokenAreas.length === 0)
    out.push({ section: "serviceArea", message: "Pick the counties you serve, or name the areas the assistant may say." });
  if (p.intake.questions.length === 0) out.push({ section: "intake", message: "The intake script needs at least one question." });
  const keys = new Set<string>();
  p.intake.questions.forEach((q, i) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(q.key)) out.push({ section: "intake", message: `Question #${i + 1}: the key must be lowercase letters, digits and _.` });
    if (keys.has(q.key)) out.push({ section: "intake", message: `Question #${i + 1}: the key "${q.key}" is used twice.` });
    keys.add(q.key);
    if (!q.prompt.trim()) out.push({ section: "intake", message: `Question #${i + 1} has no prompt.` });
    if (q.validation === "choice" && q.choices.length === 0) out.push({ section: "intake", message: `Question #${i + 1}: list the choices.` });
  });
  p.faq.forEach((f, i) => {
    if (!f.question.trim() || !f.answer.trim()) out.push({ section: "faq", message: `FAQ #${i + 1} needs both a question and an answer.` });
  });
  p.escalations.rules.forEach((r, i) => {
    const label = r.recipientName.trim() || `Rule #${i + 1}`;
    if (!r.recipientName.trim()) out.push({ section: "escalations", message: `Rule #${i + 1} needs the person's name.` });
    if (r.kinds.length === 0) out.push({ section: "escalations", message: `${label}: pick at least one situation.` });
    if (r.channel === "sms" && !E164.test(r.recipient)) out.push({ section: "escalations", message: `${label}: the text number must look like +13605551234.` });
    if (r.channel === "email" && !EMAIL.test(r.recipient)) out.push({ section: "escalations", message: `${label}: enter a valid email address.` });
  });
  p.leadDelivery.email.extraRecipients.forEach((e) => { if (!EMAIL.test(e)) out.push({ section: "leadDelivery", message: `"${e}" is not a valid email address.` }); });
  p.leadDelivery.sms.recipients.forEach((n) => { if (!E164.test(n)) out.push({ section: "leadDelivery", message: `"${n}" must look like +13605551234.` }); });
  if (p.policies.pricing === "ranges" && p.policies.priceRanges.length === 0)
    out.push({ section: "policies", message: "You chose to read price ranges, but none are listed." });
  return out;
}

export const issuesFor = (issues: StudioIssue[], sections: readonly StudioSectionId[]) =>
  issues.filter((i) => sections.includes(i.section));

// ── Diff summary for the publish dialog ──────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Human lines describing what changes between the published profile and the
 * draft ("Persona: greeting changed", "Intake: 6 → 7 questions"). Empty when
 * nothing differs. Section-level on purpose: the dialog is a sanity check,
 * the version history keeps the full documents.
 */
export function profileDiffSummary(published: VoiceProfile | null, draft: VoiceProfile): string[] {
  if (!published) return ["First publish — the whole profile goes live."];
  const lines: string[] = [];
  const field = (label: string, a: unknown, b: unknown) => { if (!same(a, b)) lines.push(label); };

  const c0 = published.company, c1 = draft.company;
  field("Company: name changed", c0.name, c1.name);
  field("Company: spoken name, trade or tagline changed", [c0.spokenName, c0.trade, c0.tagline], [c1.spokenName, c1.trade, c1.tagline]);
  if (!same(c0.services, c1.services)) lines.push(`Services: ${plural(c0.services.length, "service")} → ${plural(c1.services.length, "service")}`);
  field("Materials or brands changed", [c0.materials, c0.brands], [c1.materials, c1.brands]);
  if (!same(c0.declines, c1.declines)) lines.push(`Don'ts: ${c0.declines.length} → ${c1.declines.length}`);
  field("Hours or timezone changed", [c0.hours, c0.timezone], [c1.hours, c1.timezone]);
  field("Company: phone, website or about changed", [c0.officePhone, c0.website, c0.about], [c1.officePhone, c1.website, c1.about]);

  const a0 = published.serviceArea, a1 = draft.serviceArea;
  if (!same(a0.counties, a1.counties)) lines.push(`Service area: ${plural(a0.counties.length, "county", "counties")} → ${plural(a1.counties.length, "county", "counties")}`);
  field("Service area: spoken areas or out-of-area handling changed", [a0.spokenAreas, a0.defaultStateCode, a0.outOfArea, a0.outOfAreaLine], [a1.spokenAreas, a1.defaultStateCode, a1.outOfArea, a1.outOfAreaLine]);

  field("Credibility changed", published.credibility, draft.credibility);
  field("Offers changed", published.offers, draft.offers);
  field("Policies changed", published.policies, draft.policies);

  const p0 = published.persona, p1 = draft.persona;
  if (p0.presetId !== p1.presetId) lines.push(`Persona: voice ${p0.presetId} → ${p1.presetId}`);
  field("Persona: assistant name changed", p0.assistantName, p1.assistantName);
  field("Persona: greeting changed", p0.greeting, p1.greeting);
  field("Persona: bot answer, languages, recording notice or style changed", [p0.botAnswer, p0.languages, p0.recordingNotice, p0.style], [p1.botAnswer, p1.languages, p1.recordingNotice, p1.style]);

  const q0 = published.intake.questions, q1 = draft.intake.questions;
  if (q0.length !== q1.length) lines.push(`Intake: ${plural(q0.length, "question")} → ${plural(q1.length, "question")}`);
  else if (!same(q0, q1)) lines.push("Intake: questions reordered or reworded");
  field("Intake: submit line changed", [published.intake.submitLine, published.intake.submitOnGoodbye], [draft.intake.submitLine, draft.intake.submitOnGoodbye]);

  if (!same(published.faq, draft.faq)) lines.push(`FAQ: ${plural(published.faq.length, "answer")} → ${plural(draft.faq.length, "answer")}`);
  if (!same(published.escalations.rules, draft.escalations.rules)) lines.push(`Escalations: ${plural(published.escalations.rules.length, "rule")} → ${plural(draft.escalations.rules.length, "rule")}`);
  field("Escalations: caller line or owner fallback changed", [published.escalations.callerLine, published.escalations.fallbackToOwner], [draft.escalations.callerLine, draft.escalations.fallbackToOwner]);
  field("Lead delivery changed", published.leadDelivery, draft.leadDelivery);
  if (published.appointments.enabled !== draft.appointments.enabled) lines.push(`Appointments: ${draft.appointments.enabled ? "turned ON" : "turned off"}`);
  else field("Appointments: availability changed", published.appointments, draft.appointments);
  field("Advanced: extra instructions changed", published.advanced.extraInstructions, draft.advanced.extraInstructions);
  const { extraInstructions: _x0, ...adv0 } = published.advanced;
  const { extraInstructions: _x1, ...adv1 } = draft.advanced;
  field("Advanced: timings, style or spam sensitivity changed", adv0, adv1);
  return lines;
}

// ── Small editing helpers ────────────────────────────────────────────────────

/** A new intake question. The key is derived from the prompt and made unique. */
export function newIntakeQuestion(prompt: string, existing: IntakeQuestion[]): IntakeQuestion {
  const base = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 30) || "custom";
  let key = base;
  let n = 2;
  const taken = new Set(existing.map((q) => q.key));
  while (taken.has(key)) key = `${base.slice(0, 27)}_${n++}`;
  return { key, prompt, required: false, validation: "none", choices: [], confirm: false, neverReadAloud: false, prefillFrom: "" };
}

export function newEscalationRule(existing: EscalationRule[], kinds: EscalationKind[] = ["human", "urgent"]): EscalationRule {
  let n = existing.length + 1;
  const ids = new Set(existing.map((r) => r.id));
  while (ids.has(`rule-${n}`)) n++;
  return {
    id: `rule-${n}`,
    kinds: kinds.filter((k) => (ESCALATION_KINDS as readonly string[]).includes(k)),
    channel: "sms",
    recipientName: "",
    recipient: "",
    template: "",
    reminders: { enabled: true, everyMinutes: 120, fromHour: 8, toHour: 20, maxDays: 14, followUpNextDay: true },
    enabled: true,
  };
}

/** Move index `from` to index `to` in a copy of the list. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const defaultIntakeQuestions = (): IntakeQuestion[] => DEFAULT_INTAKE_QUESTIONS.map((q) => ({ ...q, choices: [...q.choices] }));

/** Loose US phone → E.164, or the input unchanged when it isn't ten or eleven digits. */
export function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim();
}

/** +13605551234 → (360) 555-1234 for display; anything else as-is. */
export function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const formatMinutes = (n: number) => `${Math.round(n).toLocaleString("en-US")} min`;
