/**
 * The engine-side rules the model cannot be trusted with (SPEC.md § 4),
 * as a small reference state machine the break test runs its scenarios through.
 * The engine lane ports these into voice/server.py / brain.py; the Python
 * twin for the harness is voice/tests/harness/policy.py. Keep them identical.
 *
 *   - end_call is honoured only after a caller goodbye / "nothing else",
 *     two silences in a row, or a spam flag; otherwise the call goes on;
 *   - a call ending without submit_lead but with ≥ 2 caller turns and a
 *     callback number (caller id or a slot) forces a submit from what was heard
 *     — unless the call was spam, declined, out of area or already escalated;
 *   - flag_spam ≥ flagAt → outcome spam, no lead, no notification;
 *     ≥ strikeAt → a strike on the caller's number (2 strikes = blocked);
 *   - alert → an escalation (notification) unless the call is spam;
 *   - maxTurns / maxCallSeconds end the call with what was collected.
 */
import type { CompiledProfile, Decision, CallOutcome } from "@shared/voice-profile";

export const GOODBYE_RE = /\b(good-?bye|bye+|see you|talk (?:to you )?later|that'?s (?:all|it|everything)|nothing else|no,? (?:that'?s|thats) (?:all|it)|no thanks?|no thank you|i'?m (?:all )?(?:set|done|good)|(?:i |we )?(?:have|got|need) to (?:go|run)|gotta go|thanks,? bye|thank you,? bye|all set)\b/i;
/** A bare "no" answer (fillers allowed: "Okay, no, thanks anyway."). Counts as a goodbye only after "anything else?". */
export const NOTHING_ELSE_RE = /^\s*(?:(?:ok(?:ay)?|oh|um+|uh+|well|alright|hmm)[\s,.!]+)*(?:no|nope|nah)\b[\s,.!]*(?:(?:ok(?:ay)?|that'?s (?:all|it)|thanks?|thank you|i'?m good|anyway|then)[\s,.!]*)*$/i;
/** The assistant's last line offered more help ("Anything else?"). */
export const ANYTHING_ELSE_RE = /anything else|something else|help (?:you )?with anything|else (?:i|we) can/i;
/** finish() reason when a scripted caller runs out of lines without the call ending (not a real hang-up). */
export const SCRIPT_END = "script_end";
/** The text the engine sends the brain for a silent caller (Alpine's wording). */
export const SILENCE_TEXT = "(silence — the caller hasn't said anything)";

export type TranscriptLine = { role: "caller" | "assistant" | "system"; text: string; t: number };
export type CallEvent = { t: number; type: string; decision?: Decision; detail?: string };

export type CallState = {
  callerNumber: string;
  callerTurns: number;
  assistantTurns: number;
  silences: number;
  /** cumulative slots (the model sends them cumulative; we merge defensively) */
  slots: Record<string, string>;
  actions: string[];
  alerts: { kind: string; summary: string }[];
  spam: { confidence: number; reason: string } | null;
  spamFlagged: boolean;
  strike: boolean;
  submitted: boolean;
  leadDelivered: boolean;
  notifications: number;
  ended: boolean;
  endReason: string;
  outcome: CallOutcome | null;
  transcript: TranscriptLine[];
  events: CallEvent[];
  lastCallerText: string;
  /** the assistant line before the current caller turn (for "anything else?" → "no") */
  lastAssistantSay: string;
  forcedSubmit: boolean;
};

export function newCallState(callerNumber: string): CallState {
  return {
    callerNumber, callerTurns: 0, assistantTurns: 0, silences: 0, slots: {}, actions: [], alerts: [], spam: null,
    spamFlagged: false, strike: false, submitted: false, leadDelivered: false, notifications: 0, ended: false,
    endReason: "", outcome: null, transcript: [], events: [], lastCallerText: "", lastAssistantSay: "", forcedSubmit: false,
  };
}

/** The caller is done: an explicit goodbye, or "no" right after the assistant asked "anything else?". */
export function isGoodbye(text: string, lastAssistantSay = ""): boolean {
  return GOODBYE_RE.test(text) || (NOTHING_ELSE_RE.test(text) && ANYTHING_ELSE_RE.test(lastAssistantSay));
}

function declinedOutcome(s: CallState): boolean {
  return s.outcome === "declined" || s.outcome === "out_of_area";
}

/** Record what the caller said (or didn't) before the brain answers. */
export function callerSpoke(s: CallState, text: string | null, t: number): string {
  if (text === null) {
    s.silences += 1;
    s.transcript.push({ role: "system", text: "silence", t });
    s.lastCallerText = "";
    return SILENCE_TEXT;
  }
  s.silences = 0;
  s.callerTurns += 1;
  s.lastCallerText = text;
  s.transcript.push({ role: "caller", text, t });
  return text;
}

/** Apply one Decision with the engine rules; returns what is actually spoken. */
export function applyDecision(s: CallState, d: Decision, compiled: CompiledProfile, t: number): { say: string; endedNow: boolean } {
  s.assistantTurns += 1;
  for (const [k, v] of Object.entries(d.slots ?? {})) if (typeof v === "string" && v.trim()) s.slots[k] = v.trim();
  s.actions.push(d.action);
  s.events.push({ t, type: "decision", decision: d });
  let endedNow = false;
  switch (d.action) {
    case "submit_lead":
      if (!s.spamFlagged) {
        s.submitted = true;
        if (!s.leadDelivered) { s.leadDelivered = true; s.notifications += 1; s.events.push({ t, type: "lead" }); }
      } else s.events.push({ t, type: "lead_suppressed", detail: "spam" });
      break;
    case "alert":
      if (d.alert) {
        s.alerts.push(d.alert);
        if (!s.spamFlagged) { s.notifications += 1; s.events.push({ t, type: "alert", detail: d.alert.kind }); }
      }
      break;
    case "flag_spam":
      if (d.spam) {
        s.spam = d.spam;
        if (d.spam.confidence >= compiled.spam.flagAt) { s.spamFlagged = true; s.events.push({ t, type: "spam", detail: d.spam.reason }); }
        if (d.spam.confidence >= compiled.spam.strikeAt) s.strike = true;
      }
      break;
    case "end_call": {
      const allowed = s.spamFlagged || s.silences >= compiled.timings.silencePromptsBeforeHangup || isGoodbye(s.lastCallerText, s.lastAssistantSay);
      if (allowed) {
        endedNow = true;
        s.endReason = s.spamFlagged ? "spam" : s.silences >= compiled.timings.silencePromptsBeforeHangup ? "silence" : "goodbye";
        if (d.outcome) s.outcome = d.outcome;
      } else {
        s.events.push({ t, type: "policy", detail: "end_call ignored: no goodbye, no double silence, not spam" });
      }
      break;
    }
    default: break;
  }
  if (d.outcome && !s.outcome && (d.outcome === "declined" || d.outcome === "out_of_area" || d.outcome === "info")) s.outcome = d.outcome;
  if (d.say) { s.transcript.push({ role: "assistant", text: d.say, t }); s.lastAssistantSay = d.say; }
  if (endedNow) finish(s, s.endReason);
  else if (s.assistantTurns >= compiled.timings.maxTurns) finish(s, "max_turns");
  return { say: d.say, endedNow: s.ended };
}

/** The caller hung up or the carrier stopped the stream. */
export function callerHungUp(s: CallState): void {
  if (!s.ended) finish(s, "carrier_stop");
}

export function finish(s: CallState, reason: string): void {
  if (s.ended) return;
  s.ended = true;
  s.endReason = reason;
  const callback = s.callerNumber || s.slots.phone;
  if (!s.submitted && !s.spamFlagged && !s.alerts.length && !declinedOutcome(s) && s.callerTurns >= 2 && callback && (s.slots.address || s.slots.need)) {
    s.submitted = true; s.forcedSubmit = true; s.leadDelivered = true; s.notifications += 1;
    s.events.push({ t: 0, type: "lead", detail: "forced submit from transcript" });
  }
  if (!s.outcome) {
    s.outcome = s.spamFlagged ? "spam"
      : s.submitted ? "lead_submitted"
      : s.alerts.length ? "alerted"
      : s.callerTurns <= 1 ? "hangup"
      : "info";
  }
  if (s.spamFlagged) s.outcome = "spam";
}

/** Per-org spam ledger: strikes per caller number; 2 strikes → blocked pre-answer. */
export class SpamLedger {
  strikes = new Map<string, number>();
  record(s: CallState): void {
    if (s.strike) this.strikes.set(s.callerNumber, (this.strikes.get(s.callerNumber) ?? 0) + 1);
  }
  blocked(number: string): boolean { return (this.strikes.get(number) ?? 0) >= 2; }
}
