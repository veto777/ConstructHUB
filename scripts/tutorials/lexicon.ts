/**
 * PRONUNCIATION LEXICON — applied to a narration line at the moment it is sent to the voice engine,
 * and nowhere else. Captions, titles, descriptions and narration.json keep the written spelling
 * ("ConstructHUB"); only the text the engine reads changes.
 *
 * Why it exists (owner, 2026-10-08): the narrator said "CON-struct hub" — the noun. The engine's
 * text front end (Kokoro's misaki) reads "construct" as noun or verb from the sentence around it, so
 * "Welcome to ConstructHUB" came out right and "in the ConstructHUB CRM" came out wrong. Respellings
 * ("Construct Hub", "construct hub", "Konstruct Hub", "kun-struckt hub", "Con struct Hub") were each
 * measured wrong in at least one carrier sentence. What is right in every carrier is misaki's inline
 * phoneme markup, which the engine passes through untouched: [Construct](/kənstɹˈʌkt/) — a reduced
 * first vowel and the stress on "struct".
 *
 * Measured on this engine (voice af_heart), four carrier sentences each; "con" = the voiced stretch
 * before the s, "struct" = the one after it:
 *   wrong (noun):  con 135–195 ms, first vowel F1 860–1140 Hz (a full "ah"), struct/con length 0.4–0.75
 *   right (verb):  con  90–105 ms, first vowel F1 390–540 Hz (a schwa),      struct/con length 0.9–1.2
 * and a speech recogniser still hears "Construct Hub".
 *
 * Adding an entry: test it through narrate.ts' voice (never call the engine any other way), measure
 * or at least transcribe it, then bump LEXICON_VERSION — the clip cache is keyed on it, so every
 * line the lexicon changes is spoken again and no line it leaves alone is.
 */
import { sha256 } from "./lib";

export const LEXICON_VERSION = "2026-10-08.1";

export type LexiconEntry = { term: string; match: RegExp; spoken: string; note: string };

const CONSTRUCT = "[Construct](/kənstɹˈʌkt/)";
/** Order matters: the address before the bare name. */
export const LEXICON: LexiconEntry[] = [
  { term: "constructhub.us", match: /\bconstruct[ -]?hub\.us\b/gi, spoken: `${CONSTRUCT} Hub dot U S`, note: "the address, written with its dot" },
  { term: "ConstructHUB", match: /\bconstruct[ -]?hub\b/gi, spoken: `${CONSTRUCT} Hub`, note: "con-STRUCT hub: the verb's stress, in every sentence position" },
];

/**
 * Terms heard and found right as written on this engine (speech recogniser + ear-level checks on
 * real clips, 2026-10-08) — they need no entry: CRM, JobCam, HOVER ("hover"), CHUB ("chub"), SKU,
 * API, CSV, SMS, ZIP, PDF, PNG, JPG, D.C., "dot U S", e-signature, Stripe, Google Calendar.
 */
export const HEARD_RIGHT_AS_WRITTEN = ["CRM", "JobCam", "HOVER", "CHUB", "SKU", "API", "CSV", "SMS", "ZIP", "PDF", "PNG", "JPG", "D.C.", "U S", "e-signature", "Stripe", "Google"] as const;

/** The text the engine reads for a narration line. The caption stays `text`. */
export function spokenText(text: string): string {
  let out = text;
  for (const e of LEXICON) out = out.replace(e.match, e.spoken);
  return out;
}

const MARKUP = /\[[^\]]*\]\(\/[^)]*\/\)/;
/** "construct" + "hub" in any spelling, with whatever is glued to it. */
const BRAND_SHAPED = /\w*[ck][o0u]n\W{0,2}stru[ck]{1,2}t\W{0,2}hubb?\w*/gi;
/**
 * Brand names the engine would still read by its own rules: a spelling the lexicon does not know
 * ("Con struct HUB", "ConstruktHub", "ConstructHUBs"). Phoneme markup typed into a script is refused
 * too — it would show in the captions. Empty when the line is safe to speak.
 */
export function unlexiconedBrandTerms(text: string): string[] {
  const found = new Set<string>();
  if (MARKUP.test(text)) found.add(MARKUP.exec(text)![0]);
  const byItsOwnRules = spokenText(text).split(`${CONSTRUCT} Hub`).join(" ");
  for (const m of byItsOwnRules.matchAll(BRAND_SHAPED)) found.add(m[0]);
  return [...found];
}

/** Does the lexicon change how this line is spoken? */
export const lexiconChanges = (text: string): boolean => spokenText(text) !== text;

/**
 * Cache file name of one spoken piece. A piece the lexicon leaves alone keeps the key it always had
 * (voice + text), so nothing is asked of the engine twice; a piece it changes is keyed on the
 * lexicon's version and the spoken text, so a new version speaks every affected piece again.
 */
export function ttsCacheName(narrator: string, text: string): string {
  const spoken = spokenText(text);
  return `${sha256(spoken === text ? `${narrator}\n${text}` : `${narrator}\nlexicon ${LEXICON_VERSION}\n${spoken}`).slice(0, 32)}.wav`;
}
