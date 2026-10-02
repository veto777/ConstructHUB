/**
 * The Call Assistant profile — ONE versioned JSON document per org that the
 * Agent Studio edits and server/voice/prompt-compiler.ts turns into the system
 * prompt, intake script and decision schema the engine (voice/) runs.
 *
 * This file is the contract for three lanes (docs/call-assistant/LANES.md):
 *   studio-frontend  renders and edits a VoiceProfile (every section below),
 *   studio-backend   validates it with voiceProfileSchema and compiles it,
 *   engine           consumes the CompiledProfile the app serves it.
 *
 * Rules: every field has a default so a brand-new org gets a usable profile
 * (`defaultVoiceProfile(org)`); the schema is strict (unknown keys are
 * dropped, not errors); nothing here is a secret. Phone numbers are E.164.
 */
import { z } from "zod";
import { VOICE_PERSONA_IDS, type VoicePersonaId } from "./voice-personas";

export const VOICE_PROFILE_SCHEMA_VERSION = 1;

// ── Small reusable pieces ────────────────────────────────────────────────────

/** +1XXXXXXXXXX — what SignalWire and the CRM store. */
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the international format, like +18135551234");
const shortText = (max: number) => z.string().trim().max(max);
const line = shortText(200);
const paragraph = shortText(2000);
const lines = (max = 50) => z.array(line).max(max);
const stateCode = z.string().regex(/^[A-Z]{2}$/, "Two-letter state code");
/** "HH:MM" 24h. */
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const dayHoursSchema = z.object({
  open: z.boolean().default(true),
  from: clock.default("08:00"),
  to: clock.default("17:00"),
});
export const hoursSchema = z.object({
  mon: dayHoursSchema.default({}), tue: dayHoursSchema.default({}), wed: dayHoursSchema.default({}),
  thu: dayHoursSchema.default({}), fri: dayHoursSchema.default({}),
  sat: dayHoursSchema.default({ open: false }), sun: dayHoursSchema.default({ open: false }),
});

// ── 1. Company ───────────────────────────────────────────────────────────────

export const serviceSchema = z.object({
  /** "Siding replacement" */
  name: line.min(1),
  /** Said to the caller when they ask what this covers. */
  details: paragraph.default(""),
  /** primary = pitched; secondary = only with/after a primary job; never pitched first. */
  tier: z.enum(["primary", "secondary"]).default("primary"),
});
export const declineSchema = z.object({
  /** "Repairs or patch jobs of any kind" */
  what: line.min(1),
  /** What the assistant says instead: "a local handyman company would be the best fit". */
  referral: line.default(""),
});
export const companySchema = z.object({
  name: line.min(1, "Company name"),
  /** How the assistant says the name on the phone, if different ("Alpine" for "Alpine Exteriors LLC"). */
  spokenName: line.default(""),
  tagline: line.default(""),
  /** The trade in one line: "licensed exterior contractor". */
  trade: line.default(""),
  services: z.array(serviceSchema).max(40).default([]),
  materials: lines(40).default([]),
  brands: lines(40).default([]),
  /** What we don't do, each with the referral line the assistant may say. */
  declines: z.array(declineSchema).max(40).default([]),
  hours: hoursSchema.default({}),
  timezone: z.string().min(1).default("America/Los_Angeles"),
  /** The office number for "what's your number?" — never the assistant's own line. */
  officePhone: e164.or(z.literal("")).default(""),
  website: shortText(300).default(""),
  /** Free text the assistant may read from: "family-owned since 1998, 3 crews". */
  about: paragraph.default(""),
});

// ── 2. Service area ──────────────────────────────────────────────────────────

export const countyRefSchema = z.object({
  /** counties.id in the ConstructHUB database (server/seed-all-counties.ts). */
  id: z.number().int().positive(),
  name: line.min(1),
  stateCode,
});
export const serviceAreaSchema = z.object({
  counties: z.array(countyRefSchema).max(400).default([]),
  /** Cities/areas named out loud to the caller, in the contractor's words. */
  spokenAreas: lines(60).default([]),
  /** Home state for addresses with no state. */
  defaultStateCode: stateCode.or(z.literal("")).default(""),
  /** What to do with an out-of-area caller. */
  outOfArea: z.enum(["decline", "take_lead_anyway"]).default("decline"),
  outOfAreaLine: line.default("I'm sorry, that's outside the area we serve."),
});

// ── 3. Credibility ───────────────────────────────────────────────────────────

export const credibilitySchema = z.object({
  yearsInBusiness: z.number().int().min(0).max(200).nullable().default(null),
  foundedYear: z.number().int().min(1800).max(2100).nullable().default(null),
  licenses: lines(20).default([]),
  insured: z.boolean().default(false),
  bonded: z.boolean().default(false),
  warranties: lines(20).default([]),
  awards: lines(20).default([]),
  /** "4.9 stars on Google (312 reviews)" — the contractor types it; nothing is fetched. */
  reviews: line.default(""),
  certifications: lines(20).default([]),
  memberships: lines(20).default([]),
});

// ── 4. Offers ────────────────────────────────────────────────────────────────

export const offersSchema = z.object({
  financing: z.object({
    available: z.boolean().default(false),
    /** "0% for 18 months through Synchrony, on approved credit". */
    details: paragraph.default(""),
  }).default({}),
  promotions: z.array(z.object({
    name: line.min(1),
    details: paragraph.default(""),
    /** ISO date; the assistant stops mentioning it after this day. */
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })).max(20).default([]),
  freeEstimate: z.boolean().default(true),
  freeEstimateLine: line.default("The estimate is free."),
  referralProgram: paragraph.default(""),
});

// ── 5. Policies ──────────────────────────────────────────────────────────────

export const policiesSchema = z.object({
  /** never = defer every price question to the estimator; ranges = read the typed ranges only. */
  pricing: z.enum(["never", "ranges"]).default("never"),
  priceRanges: z.array(z.object({ service: line.min(1), range: line.min(1) })).max(40).default([]),
  /** replacements_only = decline repairs with the referral line. */
  repairs: z.enum(["replacements_only", "repairs_and_replacements", "repairs_only"]).default("repairs_and_replacements"),
  minimumJob: line.default(""),
  /** What counts as an emergency and what the assistant promises. */
  emergencies: z.object({
    handle: z.boolean().default(true),
    definition: paragraph.default("storm damage, an active leak, or something unsafe"),
    line: line.default("I'm paging the team now; someone will call you right back."),
  }).default({}),
  /** Plain-language rules the compiler appends verbatim ("Never promise a start date"). */
  rules: lines(40).default([]),
});

// ── 6. Persona ───────────────────────────────────────────────────────────────

export const personaSchema = z.object({
  presetId: z.enum(VOICE_PERSONA_IDS).default("janice"),
  /** The name the assistant uses; defaults to the preset's. */
  assistantName: line.default(""),
  greeting: line.default(""),
  /** "Yes, I'm a virtual assistant, and I can help coordinate what you need." */
  botAnswer: line.default("Yes, I'm a virtual assistant, and I can help coordinate what you need."),
  /** Spoken languages; the engine's STT/TTS supports "en" today. */
  languages: z.array(z.enum(["en", "es"])).min(1).default(["en"]),
  /** Says "calls may be recorded" in the greeting (two-party-consent states). */
  recordingNotice: z.boolean().default(true),
  /** Short sentences, warm, no lists — tunable only within the compiler's bounds. */
  style: z.object({
    warmth: z.number().int().min(1).max(5).default(4),
    brevity: z.number().int().min(1).max(5).default(4),
    formality: z.number().int().min(1).max(5).default(2),
  }).default({}),
});

// ── 7. Intake ────────────────────────────────────────────────────────────────

export const INTAKE_VALIDATIONS = ["none", "address", "name", "phone", "email", "datetime", "yes_no", "choice"] as const;
export const intakeQuestionSchema = z.object({
  /** Slot key the decision protocol fills (`slots[key]`). Snake case. */
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, digits and _"),
  /** What the assistant asks, in its own words ("what's the street address and city?"). */
  prompt: line.min(1),
  required: z.boolean().default(true),
  validation: z.enum(INTAKE_VALIDATIONS).default("none"),
  /** For validation "choice". */
  choices: lines(20).default([]),
  /** Read the answer back once before moving on (email). */
  confirm: z.boolean().default(false),
  /** Never read the digits aloud (caller-id phone). */
  neverReadAloud: z.boolean().default(false),
  /** Prefill from caller id / the CRM when known, and only confirm. */
  prefillFrom: z.enum(["", "caller_id", "crm"]).default(""),
});
export const intakeSchema = z.object({
  questions: z.array(intakeQuestionSchema).min(1).max(20),
  /** After the last answer: submit and say this. */
  submitLine: line.default("I've sent your request to our team, and someone will call you to set up your free estimate."),
  /** "The moment the caller says goodbye, submit what you have." */
  submitOnGoodbye: z.boolean().default(true),
});

// ── 8. FAQ ───────────────────────────────────────────────────────────────────

export const faqSchema = z.array(z.object({
  question: line.min(1),
  answer: paragraph.min(1),
})).max(60);

// ── 9. Escalations ───────────────────────────────────────────────────────────

/** Situations the brain can name in an `alert` decision (SPEC.md "Decision protocol"). */
export const ESCALATION_KINDS = [
  "human",            // caller insists on a person
  "urgent",           // emergency per policies.emergencies
  "existing_customer",
  "estimate_missing",
  "scheduling",
  "contract",
  "payment",
  "complaint",
  "vendor",           // a supplier or sub, not a customer
  "other",
] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

export const escalationRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  kinds: z.array(z.enum(ESCALATION_KINDS)).min(1),
  channel: z.enum(["sms", "email"]),
  recipientName: line.min(1),
  /** E.164 for sms, an email address for email. */
  recipient: z.string().trim().min(3).max(200),
  /** Mustache-light template: {{callerName}} {{callback}} {{address}} {{summary}} {{assistant}} {{company}}. */
  template: paragraph.default(""),
  reminders: z.object({
    enabled: z.boolean().default(true),
    everyMinutes: z.number().int().min(15).max(24 * 60).default(120),
    /** Local hours (company.timezone) between which reminders go out. */
    fromHour: z.number().int().min(0).max(23).default(8),
    toHour: z.number().int().min(1).max(24).default(20),
    maxDays: z.number().int().min(1).max(30).default(14),
    followUpNextDay: z.boolean().default(true),
  }).default({}),
  enabled: z.boolean().default(true),
});
export const escalationsSchema = z.object({
  rules: z.array(escalationRuleSchema).max(30).default([]),
  /** What the assistant tells the caller after an alert. */
  callerLine: line.default("I've passed this straight to the right person and they'll get back to you."),
  /** A kind with no rule still goes to the org's CRM notification channels (bell/email/SMS). */
  fallbackToOwner: z.boolean().default(true),
});

// ── 10. Lead delivery ────────────────────────────────────────────────────────

export const leadDeliverySchema = z.object({
  crm: z.object({
    enabled: z.boolean().default(true),
    /** Create a pipeline project (stage "lead") as well as the client. */
    createProject: z.boolean().default(true),
    tags: lines(10).default(["call-assistant"]),
  }).default({}),
  email: z.object({
    enabled: z.boolean().default(true),
    /** Extra recipients beyond the org owners (the CRM's leadReceived pref decides the owners). */
    extraRecipients: z.array(z.string().email()).max(10).default([]),
  }).default({}),
  sms: z.object({
    enabled: z.boolean().default(false),
    recipients: z.array(e164).max(10).default([]),
  }).default({}),
  /** Call summaries for non-lead outcomes (info, declined) too. */
  notifyOnEveryCall: z.boolean().default(false),
});

// ── 11. Appointments (off by default) ────────────────────────────────────────

export const appointmentsSchema = z.object({
  enabled: z.boolean().default(false),
  crews: z.array(z.object({
    name: line.min(1),
    /** Availability windows per day. */
    windows: z.array(z.object({ day: z.enum(DAY_KEYS), from: clock, to: clock })).max(50).default([]),
  })).max(20).default([]),
  slotMinutes: z.number().int().min(15).max(480).default(90),
  bufferMinutes: z.number().int().min(0).max(240).default(30),
  /** Earliest offer, in hours from now. */
  leadTimeHours: z.number().int().min(0).max(24 * 14).default(20),
  confirmBySms: z.boolean().default(true),
});

// ── 12. Advanced ─────────────────────────────────────────────────────────────

export const advancedSchema = z.object({
  /** Appended to the system prompt verbatim, after the compiler's own rules (capped). */
  extraInstructions: shortText(4000).default(""),
  temperature: z.number().min(0).max(1).default(0.3),
  maxTurns: z.number().int().min(4).max(80).default(40),
  /** Seconds of caller silence after a question before "are you still there?". */
  silencePromptSeconds: z.number().int().min(5).max(60).default(12),
  /** Silence prompts before the assistant says goodbye and hangs up. */
  silencePromptsBeforeHangup: z.number().int().min(1).max(5).default(2),
  /** Hard cap on one call. */
  maxCallSeconds: z.number().int().min(60).max(3600).default(900),
  /** Seconds to wait for a forwarded call to bridge before the greeting. */
  greetingDelaySeconds: z.number().min(0).max(10).default(3),
  /** Lower = flags spam sooner. The engine maps it to the confidence thresholds. */
  spamSensitivity: z.enum(["low", "normal", "high"]).default("normal"),
  /** Extra words for the speech recognizer (brand names, cities). */
  vocabulary: lines(60).default([]),
});

// ── The whole profile ────────────────────────────────────────────────────────

export const voiceProfileSchema = z.object({
  schemaVersion: z.literal(VOICE_PROFILE_SCHEMA_VERSION).default(VOICE_PROFILE_SCHEMA_VERSION),
  company: companySchema,
  serviceArea: serviceAreaSchema.default({}),
  credibility: credibilitySchema.default({}),
  offers: offersSchema.default({}),
  policies: policiesSchema.default({}),
  persona: personaSchema.default({}),
  intake: intakeSchema.default({ questions: [] }),
  faq: faqSchema.default([]),
  escalations: escalationsSchema.default({}),
  leadDelivery: leadDeliverySchema.default({}),
  appointments: appointmentsSchema.default({}),
  advanced: advancedSchema.default({}),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type VoiceProfileInput = z.input<typeof voiceProfileSchema>;
export type IntakeQuestion = z.infer<typeof intakeQuestionSchema>;
export type EscalationRule = z.infer<typeof escalationRuleSchema>;
export type VoiceService = z.infer<typeof serviceSchema>;

/**
 * The default intake script (owner rules, 2026-10-01): need → address + city
 * → first name → confirm the caller-id number (never read digits aloud) →
 * a good email (read back once) → best time. Custom questions are added by
 * the Studio; keys are what the decision protocol's `slots` carry.
 */
export const DEFAULT_INTAKE_QUESTIONS: IntakeQuestion[] = [
  { key: "need", prompt: "What can we help you with today?", required: true, validation: "none", choices: [], confirm: false, neverReadAloud: false, prefillFrom: "" },
  { key: "address", prompt: "What's the street address and city for the property?", required: true, validation: "address", choices: [], confirm: false, neverReadAloud: false, prefillFrom: "" },
  { key: "first_name", prompt: "And who am I speaking with? A first name is fine.", required: true, validation: "name", choices: [], confirm: false, neverReadAloud: false, prefillFrom: "crm" },
  { key: "phone", prompt: "Is the number you're calling from the best one to reach you?", required: true, validation: "phone", choices: [], confirm: false, neverReadAloud: true, prefillFrom: "caller_id" },
  { key: "email", prompt: "What's a good email for the estimate?", required: false, validation: "email", choices: [], confirm: true, neverReadAloud: false, prefillFrom: "crm" },
  { key: "best_time", prompt: "When is the best time for someone to call you back?", required: false, validation: "none", choices: [], confirm: false, neverReadAloud: false, prefillFrom: "" },
];

/** A complete profile for a new org: the CRM's own company fields, the default script, nothing invented. */
export function defaultVoiceProfile(org: {
  name: string; timezone?: string | null; phone?: string | null; website?: string | null; state?: string | null;
  licenseNumber?: string | null; licenseState?: string | null; description?: string | null;
}): VoiceProfile {
  const phone = org.phone && /^\+[1-9]\d{6,14}$/.test(org.phone) ? org.phone : "";
  const license = org.licenseNumber ? [`${org.licenseState ? `${org.licenseState} ` : ""}license ${org.licenseNumber}`] : [];
  return voiceProfileSchema.parse({
    company: {
      name: org.name,
      timezone: org.timezone || "America/Los_Angeles",
      officePhone: phone,
      website: org.website ?? "",
      about: org.description ?? "",
    },
    serviceArea: { defaultStateCode: org.state && /^[A-Z]{2}$/.test(org.state) ? org.state : "" },
    credibility: { licenses: license },
    intake: { questions: DEFAULT_INTAKE_QUESTIONS },
  });
}

/** Strict parse with every default applied; throws ZodError (the API maps it to 400 with the issues). */
export function parseVoiceProfile(input: unknown): VoiceProfile {
  return voiceProfileSchema.parse(input);
}

// ── What the compiler produces and the engine runs ───────────────────────────

/** The brain's per-turn answer (SPEC.md "Decision protocol"). The engine validates it with the same shape in Python. */
export const DECISION_ACTIONS = ["continue", "submit_lead", "flag_spam", "alert", "end_call"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export const CALL_OUTCOMES = [
  "lead_submitted", "alerted", "declined", "out_of_area", "info", "spam", "blocked", "hangup", "voicemail", "error", "booked",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const decisionSchema = z.object({
  /** What the caller hears next; one or two short sentences. Empty only with end_call after a goodbye. */
  say: z.string().max(400),
  action: z.enum(DECISION_ACTIONS).default("continue"),
  /** Intake slots filled so far, keyed by intake question key. */
  slots: z.record(z.string().max(60), z.string().max(500)).default({}),
  alert: z.object({ kind: z.enum(ESCALATION_KINDS), summary: z.string().max(600) }).optional(),
  spam: z.object({ confidence: z.number().min(0).max(1), reason: z.string().max(200) }).optional(),
  outcome: z.enum(CALL_OUTCOMES).optional(),
});
export type Decision = z.infer<typeof decisionSchema>;

/** The compiled profile: deterministic output of server/voice/prompt-compiler.ts for one profile version. */
export type CompiledProfile = {
  schemaVersion: typeof VOICE_PROFILE_SCHEMA_VERSION;
  /** voice_profile_versions.version this was compiled from. */
  version: number;
  /** sha256 of the profile JSON, so the engine can cache per version. */
  hash: string;
  compiledAt: string;
  persona: { id: VoicePersonaId; voice: string; name: string };
  greeting: string;
  botAnswer: string;
  languages: string[];
  systemPrompt: string;
  /** Ordered intake script (key, prompt, required, validation, confirm, neverReadAloud, prefill). */
  intake: IntakeQuestion[];
  /** The JSON Schema text the system prompt shows the model for its decision object. */
  decisionSchema: Record<string, unknown>;
  /** Escalation kinds the profile handles (the rest fall back to the owner). */
  escalationKinds: EscalationKind[];
  /** Knobs the engine reads directly. */
  timings: {
    silencePromptSeconds: number;
    silencePromptsBeforeHangup: number;
    maxCallSeconds: number;
    greetingDelaySeconds: number;
    maxTurns: number;
  };
  style: { temperature: number };
  spam: { flagAt: number; strikeAt: number };
  vocabulary: string[];
  appointments: { enabled: boolean };
};
