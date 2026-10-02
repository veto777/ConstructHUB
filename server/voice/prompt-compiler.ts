/**
 * VoiceProfile → CompiledProfile (SPEC.md § Prompt compiler). OWNER: studio-backend lane.
 *
 * Deterministic: the same profile + version always yields the same system
 * prompt, intake script and decision schema (snapshot-tested). The engine
 * never sees the raw profile — only this output, so prompt wording lives in
 * ONE place. The stub below returns a minimal but valid CompiledProfile so
 * other lanes can type against it and the simulator can round-trip.
 */
import { createHash } from "crypto";
import {
  VOICE_PROFILE_SCHEMA_VERSION, DECISION_ACTIONS, ESCALATION_KINDS, CALL_OUTCOMES,
  type VoiceProfile, type CompiledProfile,
} from "@shared/voice-profile";
import { VOICE_PERSONAS, DEFAULT_VOICE_PERSONA } from "@shared/voice-personas";

/** sha256 of the canonical profile JSON. */
export function profileHash(profile: VoiceProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/** JSON Schema shown to the model for its per-turn decision object. */
export function decisionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["say", "action"],
    additionalProperties: false,
    properties: {
      say: { type: "string", maxLength: 400 },
      action: { type: "string", enum: [...DECISION_ACTIONS] },
      slots: { type: "object", additionalProperties: { type: "string" } },
      alert: { type: "object", required: ["kind", "summary"], properties: { kind: { type: "string", enum: [...ESCALATION_KINDS] }, summary: { type: "string" } } },
      spam: { type: "object", required: ["confidence", "reason"], properties: { confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" } } },
      outcome: { type: "string", enum: [...CALL_OUTCOMES] },
    },
  };
}

const SPAM_THRESHOLDS = { low: { flagAt: 0.9, strikeAt: 0.98 }, normal: { flagAt: 0.8, strikeAt: 0.95 }, high: { flagAt: 0.7, strikeAt: 0.9 } } as const;

/**
 * STUB — the studio-backend lane replaces the body with the real compiler
 * (company → services/declines/referrals → service area → credibility →
 * offers → policies → persona/style → intake script → FAQ → escalation kinds
 * → lead rules → appointments → advanced; then the decision-protocol rules
 * and NO_TOOLS_RULE-style output discipline). Keep the signature.
 */
export function compileVoiceProfile(profile: VoiceProfile, version: number, now = new Date()): CompiledProfile {
  const persona = VOICE_PERSONAS[profile.persona.presetId] ?? VOICE_PERSONAS[DEFAULT_VOICE_PERSONA];
  const name = profile.persona.assistantName || persona.name;
  const spoken = profile.company.spokenName || profile.company.name;
  const greeting = profile.persona.greeting ||
    `Thank you for calling ${spoken}, this is ${name}${profile.persona.recordingNotice ? " — calls may be recorded" : ""}. What can we help you with today?`;
  return {
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    version,
    hash: profileHash(profile),
    compiledAt: now.toISOString(),
    persona: { id: persona.id, voice: persona.voice, name },
    greeting,
    botAnswer: profile.persona.botAnswer,
    languages: profile.persona.languages,
    // TODO(studio-backend): the real prompt. This placeholder states the job and nothing the profile didn't say.
    systemPrompt: [
      `You are ${name}, the virtual assistant answering the phone for ${profile.company.name}.`,
      `Reply ONLY with one JSON object matching the decision schema. "say" is spoken to the caller: one short sentence.`,
      `Collect, one question at a time: ${profile.intake.questions.map((q) => q.key).join(" → ")}.`,
    ].join("\n"),
    intake: profile.intake.questions,
    decisionSchema: decisionJsonSchema(),
    escalationKinds: [...new Set(profile.escalations.rules.filter((r) => r.enabled).flatMap((r) => r.kinds))],
    timings: {
      silencePromptSeconds: profile.advanced.silencePromptSeconds,
      silencePromptsBeforeHangup: profile.advanced.silencePromptsBeforeHangup,
      maxCallSeconds: profile.advanced.maxCallSeconds,
      greetingDelaySeconds: profile.advanced.greetingDelaySeconds,
      maxTurns: profile.advanced.maxTurns,
    },
    style: { temperature: profile.advanced.temperature },
    spam: SPAM_THRESHOLDS[profile.advanced.spamSensitivity],
    vocabulary: profile.advanced.vocabulary,
    appointments: { enabled: profile.appointments.enabled },
  };
}
