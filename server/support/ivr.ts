/**
 * Gabe's keypad line — the support line's overflow (owner, 2026-10-08: "If we can handle 6 callers, as soon as a 7th
 * caller is acquired he gets sent to the system we created"). Caller 7+ (or every caller while the GPU engine is down)
 * lands here: no speech recognition and no live voice, so it takes as many calls at once as the carrier does and costs
 * only the call minutes. Every line is a clip recorded once in Gabe's voice (scripts/support/clips.py → CLIPS below);
 * the caller answers on the keypad, and describes the problem in a short recording that the GPU engine transcribes
 * after the call (service.ts transcription sweep), when the ticket's emails go out.
 *
 * Pure, like line.ts, and it keeps line.ts's rules: the same words for a real and a made-up account, a code only to
 * contacts on file, 3 ID tries / 3 code tries / 2 codes, only serious issues open a ticket.
 */
import type { CallState, Category, Channel, Deps } from "./line";

/** Every clip Gabe can say on this line. The text is the source of truth; the audio is regenerated from it. */
export const CLIPS = {
  greet: "Hi, this is Gabe with ConstructHUB support. I'll help you by keypad. Please type your customer number, then press pound. For a CRM number, type just the seven digits.",
  id_again: "Sorry, I didn't get that. Please type your customer number, then press pound.",
  id_giveup: "I couldn't match that. Please email support at constructhub dot us, and we'll help you there. Goodbye.",
  channel: "To get your verification code by text, press 1. To get it by email, press 2.",
  sent_sms: "If that matches an account, I just texted a six-digit code to the phone on file, or emailed it if there's no phone on the account. Please type the code now. If it doesn't arrive, press star.",
  sent_email: "If that matches an account, I just emailed a six-digit code to the email on file. Please type the code now. If it doesn't arrive, press star.",
  send_refused: "I can't send another code right now. Please try again in an hour, or email support at constructhub dot us. Goodbye.",
  bad_code: "That code doesn't match. Please type the six digits again.",
  code_giveup: "That's too many tries, so I can't verify this call. Please email support at constructhub dot us. Goodbye.",
  category: "Thanks, you're verified. What's the problem? For a payment or billing problem, press 1. For logging in, press 2. For something in the app not working, press 3. For missing data, press 4. For anything else, press 5.",
  blocking: "Is it stopping you from working? Press 1 for yes, or 2 for no.",
  not_serious: "Thanks. That isn't something I open a ticket for on this line, but our how-to videos at constructhub dot us slash tutorials cover most questions, and you can email support at constructhub dot us anytime. Goodbye.",
  record: "After the tone, please describe what happened, with as much detail as you can. Press pound when you're done.",
  record_again: "I didn't hear a description. Let's try once more. After the tone, describe what happened, then press pound.",
  ticket_is: "Thanks. Your ticket number is",
  ticket_tail: "We'll email you a confirmation, and the team will reply by email. Goodbye.",
  ticket_cap: "You've already opened several tickets today, so I can't open another one on this line. Please email support at constructhub dot us, and the team will pick it up. Goodbye.",
  still_there: "Are you still there? Please use your keypad.",
  silent_bye: "I haven't heard anything, so I'll let you go. Please call back, or email support at constructhub dot us. Goodbye.",
  too_long: "I need to wrap up this call. Please email support at constructhub dot us with anything else. Goodbye.",
  fail: "Sorry, something went wrong on my end. Please email support at constructhub dot us. Goodbye.",
  t: "T.",
  d0: "zero.", d1: "one.", d2: "two.", d3: "three.", d4: "four.", d5: "five.", d6: "six.", d7: "seven.", d8: "eight.", d9: "nine.",
} as const;
export type ClipId = keyof typeof CLIPS;

/** What to do next: play these clips, then listen on the keypad (`digits` = how many to wait for), record, or hang up. */
export type IvrReply = { play: ClipId[]; listen?: { digits?: number }; record?: boolean; end: boolean };
/** One keypad event: the digits pressed (finished by # or the digit count), a finished recording, or a timeout. */
export type IvrInput = { digits?: string; recording?: { sid: string; seconds: number } | null; silence?: boolean };
export type IvrDeps = Pick<Deps, "now" | "findAccount" | "sendCode" | "hashCode"> & {
  /** Opens the ticket now; its description comes from the recording later. null = the daily cap. */
  openTicket(s: CallState, callerNumber: string, recordingSid: string | null): Promise<{ number: string } | null>;
};

const CODE_TTL = 10 * 60_000, MAX_TURNS = 40;
const CATS: Record<string, Category> = { "1": "payment", "2": "login", "3": "technical", "4": "data", "5": "other" };
const PROMPT: Partial<Record<string, IvrReply>> = {
  ivr_id: { play: ["greet"], listen: { digits: 8 }, end: false },
  choose_channel: { play: ["channel"], listen: { digits: 1 }, end: false },
  code_sent: { play: [], listen: { digits: 6 }, end: false },
  ivr_category: { play: ["category"], listen: { digits: 1 }, end: false },
  ivr_blocking: { play: ["blocking"], listen: { digits: 1 }, end: false },
  ivr_record: { play: ["record"], record: true, end: false },
};
const bye = (s: CallState, clip: ClipId): IvrReply => { s.step = "done"; return { play: [clip], end: true }; };
/** "T-00012" → the clips for "T, zero, zero, zero, one, two". */
export const ticketClips = (n: string): ClipId[] => n.replace(/[^T0-9]/gi, "").toUpperCase().split("").map((c) => (c === "T" ? "t" : (`d${c}` as ClipId)));

export const freshIvrState = (): CallState => ({ step: "ivr_id", idTries: 0, codeTries: 0, codesSent: 0, turns: 0, userId: null, crmOrgId: null, ref: null, email: null, phones: [], channel: null, codeHash: null, codeExpires: null, verified: false, intake: {}, aiTurns: [], ticketNumber: null });

export async function ivrTurn(s: CallState, input: IvrInput, callerNumber: string, d: IvrDeps): Promise<IvrReply> {
  const step = s.step as string;
  if (step === "done") return { play: ["too_long"], end: true };
  if (input.silence) {
    s.silences = (s.silences ?? 0) + 1;
    if (s.silences >= 3) return bye(s, "silent_bye");
    const p = step === "ivr_id" ? { play: ["id_again"] as ClipId[], listen: { digits: 8 }, end: false } : PROMPT[step];
    return p ? { ...p, play: ["still_there", ...p.play] } : { play: ["silent_bye"], end: true };
  }
  s.silences = 0;
  if (++s.turns > MAX_TURNS) return bye(s, "too_long");
  const keys = (input.digits ?? "").replace(/[^0-9*]/g, "");

  const sendTo = async (ch: Channel): Promise<IvrReply> => {
    if (s.codesSent >= 2) return bye(s, "send_refused");
    s.channel = ch; s.codesSent++;
    const acct = s.userId !== null && s.email ? { userId: s.userId, email: s.email, phones: s.phones } : null;
    const r = await d.sendCode(acct, s.ref ?? "", ch === "sms" && !s.phones.length ? "email" : ch, callerNumber);
    if (!r.allowed) return bye(s, "send_refused");
    s.codeHash = r.hash; s.codeExpires = d.now() + CODE_TTL; s.codeTries = 0; s.step = "code_sent";
    return { play: [ch === "sms" ? "sent_sms" : "sent_email"], listen: { digits: 6 }, end: false };
  };

  switch (step) {
    case "ivr_id": {
      const n = keys.replace(/\*/g, "");
      const id = n.length === 8 ? { kind: "customer" as const, value: n } : n.length === 7 ? { kind: "crm" as const, value: `CRM${n}` } : null;
      if (!id) { if (++s.idTries >= 3) return bye(s, "id_giveup"); return { play: ["id_again"], listen: { digits: 8 }, end: false }; }
      const acct = await d.findAccount(id);
      s.ref = id.value;
      if (acct) { s.userId = acct.userId; s.crmOrgId = acct.crmOrgId; s.email = acct.email; s.phones = acct.phones; }
      s.step = "choose_channel";   // the same question, account or not
      return { play: ["channel"], listen: { digits: 1 }, end: false };
    }
    case "choose_channel":
      if (keys === "1") return sendTo("sms");
      if (keys === "2") return sendTo("email");
      return { play: ["channel"], listen: { digits: 1 }, end: false };
    case "code_sent": {
      if (keys.includes("*")) return sendTo(s.channel === "sms" ? "email" : "sms");   // "it didn't arrive" → the other way
      if (s.codeExpires !== null && d.now() > s.codeExpires) return sendTo(s.channel ?? "email");
      const ok = keys.length === 6 && s.codeHash !== null && d.hashCode(keys) === s.codeHash;
      if (!ok) { if (++s.codeTries >= 3) return bye(s, "code_giveup"); return { play: ["bad_code"], listen: { digits: 6 }, end: false }; }
      s.verified = true; s.codeHash = null; s.step = "ivr_category";
      return { play: ["category"], listen: { digits: 1 }, end: false };
    }
    case "ivr_category": {
      if (!s.verified) return bye(s, "code_giveup");   // cannot happen; belt and braces
      const cat = CATS[keys];
      if (!cat) return { play: ["category"], listen: { digits: 1 }, end: false };
      if (cat === "other") return bye(s, "not_serious");
      s.intake = { category: cat, blocking: cat !== "technical" ? true : undefined };
      if (cat === "technical") { s.step = "ivr_blocking"; return { play: ["blocking"], listen: { digits: 1 }, end: false }; }
      s.step = "ivr_record"; return { play: ["record"], record: true, end: false };
    }
    case "ivr_blocking":
      if (keys === "2") return bye(s, "not_serious");
      if (keys !== "1") return { play: ["blocking"], listen: { digits: 1 }, end: false };
      s.intake.blocking = true; s.step = "ivr_record";
      return { play: ["record"], record: true, end: false };
    case "ivr_record": {
      if (!s.verified) return bye(s, "code_giveup");
      const rec = input.recording && input.recording.seconds >= 2 ? input.recording : null;
      if (!rec && !s.intake.steps) { s.intake.steps = "retry"; return { play: ["record_again"], record: true, end: false }; }   // one retry
      s.intake.steps = undefined;
      const t = await d.openTicket(s, callerNumber, rec?.sid ?? null);
      if (!t) return bye(s, "ticket_cap");
      s.ticketNumber = t.number; s.step = "done";
      return { play: ["ticket_is", ...ticketClips(t.number), "ticket_tail"], end: true };
    }
  }
  return bye(s, "too_long");
}
