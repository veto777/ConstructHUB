/**
 * Call Assistant personas: a name the contractor can pick in the Agent Studio
 * and the Kokoro-82M voice id the engine (voice/) speaks with.
 *
 * MIRROR of voice/personas.json — the engine lane verifies every voice id
 * against the Kokoro-82M voice pack at startup, swaps a missing one for the
 * closest match and writes the final list to voice/personas.json; this file
 * is updated to match (docs/call-assistant/LANES.md). The Studio plays each
 * persona's sample from client/public/voice/samples/<id>.mp3 (engine lane).
 */
export type VoicePersonaId = "janice" | "gabe" | "sofia" | "maya" | "marcus" | "ethan";
export const VOICE_PERSONA_IDS = ["janice", "gabe", "sofia", "maya", "marcus", "ethan"] as const satisfies readonly VoicePersonaId[];

export type VoicePersona = {
  id: VoicePersonaId;
  name: string;
  /** Kokoro-82M voice id (af_* female American, am_* male American). */
  voice: string;
  gender: "female" | "male";
  /** One line the Studio shows beside the sample button. */
  blurb: string;
  /** What the sample says (the engine lane pre-renders it). */
  sampleLine: string;
  /** Public path of the pre-rendered sample; null until the engine lane renders it. */
  sampleUrl: string | null;
};

const SAMPLE = (name: string, company = "your company") =>
  `Thank you for calling ${company}, this is ${name}. Calls may be recorded. What can we help you with today?`;

export const VOICE_PERSONAS: Record<VoicePersonaId, VoicePersona> = {
  janice: { id: "janice", name: "Janice", voice: "af_heart", gender: "female", blurb: "Warm and unhurried — the front-desk voice callers trust.", sampleLine: SAMPLE("Janice"), sampleUrl: null },
  gabe: { id: "gabe", name: "Gabe", voice: "am_michael", gender: "male", blurb: "Friendly and direct, like the crew lead picking up the phone.", sampleLine: SAMPLE("Gabe"), sampleUrl: null },
  sofia: { id: "sofia", name: "Sofia", voice: "af_bella", gender: "female", blurb: "Bright and upbeat.", sampleLine: SAMPLE("Sofia"), sampleUrl: null },
  maya: { id: "maya", name: "Maya", voice: "af_sarah", gender: "female", blurb: "Calm and professional.", sampleLine: SAMPLE("Maya"), sampleUrl: null },
  marcus: { id: "marcus", name: "Marcus", voice: "am_adam", gender: "male", blurb: "Deep and steady.", sampleLine: SAMPLE("Marcus"), sampleUrl: null },
  ethan: { id: "ethan", name: "Ethan", voice: "am_eric", gender: "male", blurb: "Young and energetic.", sampleLine: SAMPLE("Ethan"), sampleUrl: null },
};

export const VOICE_PERSONA_LIST: VoicePersona[] = VOICE_PERSONA_IDS.map((id) => VOICE_PERSONAS[id]);
export const DEFAULT_VOICE_PERSONA: VoicePersonaId = "janice";
export const isVoicePersonaId = (v: unknown): v is VoicePersonaId =>
  typeof v === "string" && (VOICE_PERSONA_IDS as readonly string[]).includes(v);
