/**
 * The decision loop in TypeScript (SPEC.md § Decision protocol), used by the
 * Studio's text Simulator so a contractor can try the assistant before the
 * engine is up, and as the reference the engine lane mirrors in voice/brain.py
 * + voice/decision.py. OWNER: studio-backend lane.
 *
 * One turn = system prompt (compiled, with {{now}}/{{caller}} rendered) +
 * the conversation so far → ONE JSON decision. The model's reply is cleaned the
 * way server/ai-output.ts cleans prose (tool-call / <think> markup stripped),
 * then the first balanced {…} object that parses and validates against
 * decisionSchema is taken; invalid → one retry with a corrective message;
 * still invalid → the honest fallback line and an `error` event.
 *
 * The rules the model cannot be trusted with live here, not in the prompt:
 *   - end_call is honoured only after a caller goodbye / "nothing else" /
 *     two silences / spam / the turn cap; otherwise it becomes `continue`;
 *   - a call ending without submit_lead or an alert, with ≥ 2 caller turns, a
 *     callback number and an address or a stated need, forces a submit from
 *     the slots (Alpine's _force_submit);
 *   - flag_spam at or above `strikeAt` is a strike (the app's ledger decides
 *     the block; this module only reports it).
 *
 * Provider: the app's OpenAI-compatible client (aiClient/aiModel), prompt-only
 * JSON (no response_format, no tools — the TruthCoder gateway refuses both).
 */
import type OpenAI from "openai";
import type { Decision, CompiledProfile, CallOutcome } from "@shared/voice-profile";
import { aiClient, aiErrorTag, type ChatClient } from "../ai-output";
import { aiModel } from "../ai-config";
import { renderSystemPrompt, type CallerContext } from "./prompt-compiler";
import { stripDecisionMarkup, firstJsonObject, parseJsonBlock, decisionFromObject } from "./decision";

export const FALLBACK_SAY = "I'm sorry, I'm having a little trouble on my end — could you say that one more time?";
export const RETRY_INSTRUCTION = "Reply with only the JSON object described in OUTPUT FORMAT — no prose, no markdown, no tool calls.";
export const SILENCE_TEXT = "(silence)";

export type TranscriptTurn = { role: "caller" | "assistant" | "system"; text: string; t: string };
export type BrainEvent = { t: string; type: string; decision?: Partial<Decision>; detail?: Record<string, unknown> };

// ── Cleaning + parsing ───────────────────────────────────────────────────────
// One parser for the app and the engine: ./decision.ts follows voice/decision.py and is pinned by
// server/voice/fixtures/decision-cases.json (the binding contract, also run against the engine by pytest).

/** Strip the markup an agent-style model leaks around its JSON (same families server/ai-output.ts strips). */
export function cleanDecisionText(raw: unknown): string {
  return typeof raw === "string" ? stripDecisionMarkup(raw) : "";
}

/** Every balanced {…} block in `s`, in order (string-aware); an unbalanced "{" is skipped, like the engine. */
export function jsonObjects(s: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (from < s.length) {
    const rest = s.slice(from);
    const block = firstJsonObject(rest);
    if (!block) break;
    out.push(block);
    from += rest.indexOf(block) + block.length;
  }
  return out;
}

export type ParsedDecision = { ok: true; decision: Decision } | { ok: false; reason: "empty" | "no-json" | "invalid"; text: string };

/** The first object in the reply that is a valid Decision (the engine's repairs applied). */
export function parseDecision(raw: unknown): ParsedDecision {
  const text = cleanDecisionText(raw);
  if (!text) return { ok: false, reason: "empty", text };
  const candidates = jsonObjects(text);
  if (!candidates.length) return { ok: false, reason: "no-json", text };
  for (const c of candidates) {
    const j = parseJsonBlock(c);
    if ("error" in j) continue;
    const r = decisionFromObject(j.obj);
    if (r.ok) return { ok: true, decision: r.decision };
  }
  return { ok: false, reason: "invalid", text };
}

// ── Caller-intent heuristics the engine enforces ─────────────────────────────

/** Unmistakable anywhere in the utterance. */
const GOODBYE_ANY = /\b(?:good-?bye|see ya|see you later|talk (?:to you )?later|take care|gotta go|got to go|have to go|need to go|not interested|stop calling)\b/i;
/** Only when the utterance ENDS with it ("12 Bye Lane" or "that's it, the roof leaks" are not goodbyes). */
const GOODBYE_END = /(?:^|[\s,.!])(?:bye(?:[\s-]bye| now)?|that'?s (?:all|it|everything)|nothing else|no,? (?:that'?s|thats) (?:all|it)|that'?ll (?:be|do) (?:it|all)|i'?m (?:all )?set|i'?m good|i'?m done|we'?re done)(?:[\s,.!]+(?:thanks|thank you)(?: so much)?)?[\s.!,]*$/i;
// fillers around the "no" are fine ("Okay, no, thanks." / "No, okay, thanks anyway.") — same rule as voice/brain.py NO_RE
const NO = /^\s*(?:(?:ok(?:ay)?|oh|um+|uh+|well|alright|hmm)[\s,.!]+)*(?:no|nope|nah|not really|i'?m good|that'?s all|that'?s it|nothing)\b[\s,.!]*(?:(?:ok(?:ay)?|that'?s (?:all|it)|thanks?|thank you|i'?m good|anyway|then|no)[\s,.!]*)*$/i;
const ANYTHING_ELSE = /anything else|something else|anything more|is there anything/i;

export function callerSaidGoodbye(text: string): boolean {
  return GOODBYE_ANY.test(text) || GOODBYE_END.test(text);
}

/** "Anything else?" → "no." */
export function callerDeclinedMore(lastAssistantSay: string | undefined, text: string): boolean {
  return !!lastAssistantSay && ANYTHING_ELSE.test(lastAssistantSay) && NO.test(text);
}

export const isSilence = (text: string) => !text.trim() || text.trim() === SILENCE_TEXT;

/** The callback number a lead can be filed under: a phone slot or the caller id. */
export function callbackNumber(slots: Record<string, string>, callerNumber?: string | null): string | null {
  for (const k of ["phone", "callback", "callback_number", "best_number"]) {
    const v = slots[k]?.replace(/[^\d+]/g, "");
    if (v && v.replace(/\D/g, "").length >= 7) return slots[k];
  }
  // "yes, this number is fine" → the caller id.
  return callerNumber || null;
}

// ── The session ──────────────────────────────────────────────────────────────

export type BrainOptions = {
  compiled: CompiledProfile;
  timezone: string;
  caller: CallerContext;
  /** Injected for tests; default = the app's AI client. */
  client?: ChatClient;
  model?: string;
  now?: () => Date;
  /** Logged with provider errors (never the key). */
  tag?: string;
};

export type TurnResult = Omit<Decision, "outcome"> & {
  ended: boolean;
  outcome: CallOutcome | null;
  events: BrainEvent[];
  /** The turn number (1-based, caller turns). */
  turn: number;
  /** True when the model's JSON could not be used and the fallback line was spoken. */
  fallback: boolean;
};

export class Brain {
  readonly compiled: CompiledProfile;
  readonly transcript: TranscriptTurn[] = [];
  readonly events: BrainEvent[] = [];
  slots: Record<string, string> = {};
  submitted = false;
  alerted = false;
  spam: { confidence: number; reason: string } | null = null;
  outcome: CallOutcome | null = null;
  ended = false;
  silences = 0;
  private messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  private readonly client: ChatClient;
  private readonly model: string;
  private readonly now: () => Date;
  private readonly timezone: string;
  private readonly caller: CallerContext;
  private readonly tag: string;

  constructor(opts: BrainOptions) {
    this.compiled = opts.compiled;
    this.timezone = opts.timezone;
    this.caller = opts.caller;
    this.client = opts.client ?? aiClient({ timeoutFallbackMs: 20_000, maxRetries: 0 });
    this.model = opts.model ?? aiModel();
    this.now = opts.now ?? (() => new Date());
    this.tag = opts.tag ?? "voice-sim";
  }

  private stamp() { return this.now().toISOString(); }
  private log(role: TranscriptTurn["role"], text: string) { this.transcript.push({ role, text, t: this.stamp() }); }
  private event(type: string, extra: Partial<BrainEvent> = {}) { const e: BrainEvent = { t: this.stamp(), type, ...extra }; this.events.push(e); return e; }
  get callerTurns() { return this.transcript.filter((t) => t.role === "caller").length; }
  private lastSay(): string | undefined { for (let i = this.transcript.length - 1; i >= 0; i--) if (this.transcript[i].role === "assistant") return this.transcript[i].text; return undefined; }

  /** The greeting (spoken by the engine before the first caller turn). */
  greet(): string {
    this.log("assistant", this.compiled.greeting);
    this.messages.push({ role: "assistant", content: this.compiled.greeting });
    return this.compiled.greeting;
  }

  private systemPrompt(): string {
    return renderSystemPrompt(this.compiled, { now: this.now(), timezone: this.timezone, caller: this.caller });
  }

  /** One model call; returns the parsed decision or the failure. */
  private async ask(extraUser?: string): Promise<ParsedDecision & { raw?: string }> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: this.systemPrompt() }, ...this.messages];
    if (extraUser) messages.push({ role: "user", content: extraUser });
    const completion = await this.client.chat.completions.create({
      model: this.model, messages, max_tokens: 400, temperature: this.compiled.style.temperature, stream: false,
    });
    const content = completion?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? "").join("") : "";
    return { ...parseDecision(raw), raw };
  }

  /** One caller turn → the decision the engine acts on. */
  async respond(callerText: string): Promise<TurnResult> {
    if (this.ended) return this.result({ say: "", action: "end_call", slots: this.slots, outcome: this.outcome ?? "hangup" }, false);
    const text = isSilence(callerText) ? SILENCE_TEXT : callerText.trim();
    this.log("caller", text);
    this.messages.push({ role: "user", content: text });
    if (text === SILENCE_TEXT) this.silences++; else this.silences = 0;

    let parsed: ParsedDecision & { raw?: string };
    let fallback = false;
    let providerFailed = false;
    try {
      parsed = await this.ask();
      if (!parsed.ok) {
        this.event("retry", { detail: { reason: parsed.reason, sample: (parsed.text || parsed.raw || "").slice(0, 200) } });
        parsed = await this.ask(RETRY_INSTRUCTION);
      }
    } catch (err) {
      providerFailed = true;
      this.event("error", { detail: { provider: aiErrorTag(err) } });
      console.warn(`[${this.tag}] provider error: ${aiErrorTag(err)}`);
      parsed = { ok: false, reason: "empty", text: "" };
    }
    let decision: Decision;
    if (parsed.ok) decision = parsed.decision;
    else {
      if (!providerFailed) this.event("error", { detail: { reason: parsed.reason, sample: (parsed.text || "").slice(0, 200) } });
      decision = { say: FALLBACK_SAY, action: "continue", slots: this.slots };
      fallback = true;
    }
    decision = this.enforce(decision, text);
    // The model sees its own JSON back, so slots stay cumulative across turns.
    this.messages.push({ role: "assistant", content: JSON.stringify(decision) });
    if (decision.say) this.log("assistant", decision.say);
    return this.result(decision, fallback);
  }

  /** The engine's rules on top of the model's choice. */
  private enforce(d: Decision, callerText: string): Decision {
    const out: Decision = { ...d, slots: { ...this.slots, ...(d.slots ?? {}) } };
    this.slots = out.slots;
    const t = this.compiled.spam;
    if (out.action === "flag_spam" && out.spam) {
      this.spam = out.spam;
      this.event("flag_spam", { decision: { spam: out.spam }, detail: { strike: out.spam.confidence >= t.strikeAt, flagged: out.spam.confidence >= t.flagAt } });
      if (out.spam.confidence < t.flagAt) { out.action = "continue"; this.spam = null; this.event("spam_below_threshold", { detail: { confidence: out.spam.confidence, flagAt: t.flagAt } }); }
    }
    if (out.action === "alert") {
      // a flagged spam call notifies nobody (SPEC §4/§12; same rule as voice/brain.py)
      if (out.alert && this.spamFlagged()) { out.action = "continue"; this.event("alert_suppressed_spam", { decision: { alert: out.alert } }); }
      else if (out.alert) { this.alerted = true; this.event("alert", { decision: { alert: out.alert, slots: out.slots } }); }
      else { out.action = "continue"; this.event("alert_without_kind"); }
    }
    if (out.action === "submit_lead") {
      if (this.spamFlagged()) { out.action = "continue"; this.event("submit_refused_spam"); }
      else { this.submitted = true; this.event("submit_lead", { decision: { slots: out.slots } }); }
    }
    if (out.action === "end_call") {
      const allowed = this.spamFlagged() || callerSaidGoodbye(callerText) || callerDeclinedMore(this.lastSay(), callerText) || this.silences >= 2
        || this.callerTurns >= this.compiled.timings.maxTurns;
      if (!allowed) {
        out.action = "continue";
        delete out.outcome;
        this.event("end_call_refused", { detail: { callerText: callerText.slice(0, 120) } });
        if (!out.say) out.say = "Is there anything else I can help you with?";
      } else this.end(out);
    } else if (this.callerTurns >= this.compiled.timings.maxTurns) {
      this.event("max_turns");
      out.action = "end_call";
      if (!out.say) out.say = "Thanks for calling, someone from the team will follow up. Goodbye.";
      this.end(out);
    }
    return out;
  }

  /** An address or a stated need is in the slots (the first intake question is the need; address-validated keys are addresses). */
  private hasRequest(): boolean {
    const keys = new Set(["need", "address", this.compiled.intake[0]?.key, ...this.compiled.intake.filter((q) => q.validation === "address").map((q) => q.key)]);
    return [...keys].some((k) => !!k && !!this.slots[k]?.trim());
  }

  private spamFlagged() { return !!this.spam && this.spam.confidence >= this.compiled.spam.flagAt; }

  private end(out: Decision) {
    let outcome: CallOutcome = out.outcome ?? "info";
    if (this.spamFlagged()) outcome = "spam";
    else if (!this.submitted && !this.alerted && !["declined", "out_of_area", "spam", "blocked"].includes(outcome) && this.callerTurns >= 2
      && this.hasRequest() && callbackNumber(this.slots, this.caller.callerNumber)) {
      // Alpine's _force_submit: a caller who gave us a number plus an address or a clear request never
      // falls through the cracks (a caller who only asked a question stays "info").
      this.submitted = true;
      outcome = "lead_submitted";
      this.event("forced_submit", { decision: { slots: this.slots } });
    } else if (this.submitted) outcome = outcome === "info" || outcome === "hangup" ? "lead_submitted" : outcome;
    else if (this.alerted && !this.submitted) outcome = "alerted";
    this.outcome = outcome;
    out.outcome = outcome;
    this.ended = true;
    this.event("end_call", { decision: { outcome } });
  }

  private result(d: Decision, fallback: boolean): TurnResult {
    const { outcome: _ignored, ...rest } = d;
    return { ...rest, ended: this.ended, outcome: this.outcome, events: this.events.slice(), turn: this.callerTurns, fallback };
  }

  /** What the call log would hold. */
  report() {
    return {
      transcript: this.transcript, slots: this.slots, events: this.events, outcome: this.outcome, ended: this.ended,
      submitted: this.submitted, alerted: this.alerted, spam: this.spam, callerTurns: this.callerTurns,
    };
  }
}
