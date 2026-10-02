/**
 * Raw model text → Decision (SPEC.md § 4). Harness-lane reference parser.
 *
 * The engine's `voice/decision.py` is the production copy; this TypeScript
 * twin exists so the break test can run the real provider from vitest and so
 * `decision-cases.json` (shared with `voice/tests/test_decision.py`) pins the
 * behaviour both must have:
 *
 *   1. strip ```json fences, <think>/<thinking>/<reasoning> blocks and
 *      tool-call markup (the way server/ai-output.ts does);
 *   2. take the FIRST balanced {…} object; parse it as JSON;
 *   3. validate with shared/voice-profile.ts decisionSchema (unknown keys dropped);
 *   4. on failure the caller retries ONCE with a corrective user message, then
 *      falls back to FALLBACK_DECISION and records an `error` event.
 */
import { decisionSchema, ESCALATION_KINDS, CALL_OUTCOMES, type Decision } from "@shared/voice-profile";

export const FALLBACK_DECISION: Decision = { say: "I'm sorry, could you say that one more time?", action: "continue", slots: {} };
export const RETRY_MESSAGE = "Reply with only the JSON object described in the instructions — no prose, no markup.";

const THINK = "think|thinking|reasoning|reflection|analysis|scratchpad";
const TOOL_NAMES = "web_research|web_search|read_image|describe_image|code_interpreter|fetch_url|open_url";

/** Markup removed (the steps of voice/decision.py clean_reply); what is left may or may not hold a JSON object. */
export function stripDecisionMarkup(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  const fenced = s.match(/^\s*```[a-z]*\n([\s\S]*?)\n?```\s*$/i);
  if (fenced) s = fenced[1];
  // reasoning: closed blocks, then an orphan closing tag (everything before it was reasoning), then an unclosed opener
  s = s.replace(new RegExp(`<(${THINK})>[\\s\\S]*?<\\/\\1>`, "gi"), "").replace(new RegExp(`\\[(${THINK})\\][\\s\\S]*?\\[\\/\\1\\]`, "gi"), "");
  const orphan = new RegExp(`<\\/(?:${THINK})>|\\[\\/(?:${THINK})\\]`, "gi");
  let m: RegExpExecArray | null, end = -1;
  while ((m = orphan.exec(s))) end = m.index + m[0].length;
  if (end >= 0) s = s.slice(end);
  s = s.replace(new RegExp(`(?:<(?:${THINK})>|\\[(?:${THINK})\\])[\\s\\S]*$`, "i"), "");
  // tool-call markup, with its arguments (an argument object must never be taken for the decision)
  s = s
    .replace(/<(tool_calls?|function_calls|tool_use|tool_response|tool_result)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(tool_calls?|function_calls|tool_use)\b[^>]*>[\s\S]*$/i, "")
    .replace(/<\|(?:tool_calls?|python_tag)[^|]*\|>[\s\S]*?(?:<\|\/?(?:tool_calls?|eom|eot)[^|]*\|>|$)/gi, "")
    .replace(/<function=[^>]*>[\s\S]*?(?:<\/function>|$)/gi, "")
    .replace(/<parameter=[^>]*>[\s\S]*?(?:<\/parameter>|$)/gi, "")
    .replace(/<\/?(?:tool_calls?|function_calls|tool_use|tool_response|tool_result|function|parameter|invoke)\b[^>]*>/gi, "")
    .replace(new RegExp(`\\[(?:${TOOL_NAMES}|tool_call)(?:\\s*[:(][^\\]\\n]*)?\\]`, "gi"), "")
    .replace(new RegExp(`^[ \\t]*\`?(?:${TOOL_NAMES})\`?[ \\t]*:?[ \\t]*$`, "gim"), "");
  // a fence that is not the whole reply (prose around it)
  s = s.replace(/```[a-z]*\n?([\s\S]*?)```/gi, "$1");
  return s.trim();
}

/** The first balanced {…} block, honouring strings and escapes; an unbalanced "{" is skipped (engine rule). */
export function firstJsonObject(s: string): string | null {
  let start = s.indexOf("{");
  while (start >= 0) {
    let depth = 0, inStr = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
    }
    start = s.indexOf("{", start + 1);
  }
  return null;
}

export type ParseFailure = "empty" | "no_json" | "bad_json" | "invalid";
export type ParsedDecision = { ok: true; decision: Decision } | { ok: false; reason: ParseFailure; detail?: string };

const SAY_MAX = 400;
const KINDS = new Set<string>(ESCALATION_KINDS);
const OUTCOMES = new Set<string>(CALL_OUTCOMES);

/** Over-long speech is cut at the last sentence end (engine rule) rather than rejected. */
function fitSay(say: string): string {
  if (say.length <= SAY_MAX) return say;
  const cut = say.slice(0, SAY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > SAY_MAX * 0.4 ? cut.slice(0, end + 1) : cut).trim();
}

/**
 * The model's object → the shape decisionSchema accepts, with the engine's repairs
 * (voice/decision.py validate_decision): numbers in slots become strings, empty
 * slots drop, an unknown alert kind becomes "other", an unknown outcome drops,
 * spam confidence is clamped to 0..1. Anything that is not a decision → null + why.
 */
export function normalizeDecisionObject(obj: unknown): { value: Record<string, unknown> } | { error: string } {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { error: "not an object" };
  const o = obj as Record<string, unknown>;
  if ("name" in o && ("arguments" in o || "parameters" in o) && !("say" in o)) return { error: "tool-call object, not a decision" };
  const say = o.say == null ? "" : o.say;
  if (typeof say !== "string") return { error: "say is not a string" };
  const out: Record<string, unknown> = { say: fitSay(say.trim()), action: o.action ?? "continue" };
  if (o.slots != null) {
    if (typeof o.slots !== "object" || Array.isArray(o.slots)) return { error: "slots is not an object" };
    const slots: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.slots as Record<string, unknown>)) {
      if (!k || v == null || v === "") continue;
      if (typeof v === "string") slots[k.slice(0, 60)] = v.trim().slice(0, 500);
      else if (typeof v === "number" || typeof v === "boolean") slots[k.slice(0, 60)] = String(v);
    }
    out.slots = slots;
  }
  const a = o.alert as Record<string, unknown> | undefined;
  if (a && typeof a === "object" && a.kind) out.alert = { kind: KINDS.has(String(a.kind)) ? String(a.kind) : "other", summary: String(a.summary ?? "").slice(0, 600) };
  const sp = o.spam as Record<string, unknown> | undefined;
  if (sp && typeof sp === "object" && sp.confidence != null) {
    const c = Number(sp.confidence);
    if (!Number.isFinite(c)) return { error: "spam.confidence is not a number" };
    out.spam = { confidence: Math.max(0, Math.min(1, c)), reason: String(sp.reason ?? "").slice(0, 200) };
  }
  if (o.outcome != null && OUTCOMES.has(String(o.outcome))) out.outcome = String(o.outcome);
  return { value: out };
}

export function parseDecisionText(raw: unknown): ParsedDecision {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "empty" };
  const cleaned = stripDecisionMarkup(raw);
  if (!cleaned) return { ok: false, reason: "empty" };
  const block = firstJsonObject(cleaned);
  if (!block) return { ok: false, reason: "no_json" };
  let obj: unknown;
  try { obj = JSON.parse(block); } catch {
    try { obj = JSON.parse(block.replace(/,\s*([}\]])/g, "$1")); } // trailing commas: the one slip worth repairing
    catch (e) { return { ok: false, reason: "bad_json", detail: String((e as Error).message).slice(0, 120) }; }
  }
  const n = normalizeDecisionObject(obj);
  if ("error" in n) return { ok: false, reason: "invalid", detail: n.error };
  const v = decisionSchema.safeParse(n.value);
  if (!v.success) return { ok: false, reason: "invalid", detail: v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) };
  const d = v.data;
  if (d.action === "alert" && !d.alert) return { ok: false, reason: "invalid", detail: "alert without alert{kind,summary}" };
  if (d.action === "flag_spam" && !d.spam) return { ok: false, reason: "invalid", detail: "flag_spam without spam{confidence,reason}" };
  if (!d.say && d.action !== "end_call") return { ok: false, reason: "invalid", detail: "empty say (allowed only with end_call)" };
  return { ok: true, decision: d };
}

/**
 * One turn with the retry rule: `ask(messages)` returns raw text; a bad first
 * answer gets one corrective retry; still bad → FALLBACK_DECISION + error.
 */
export async function decideWithRetry(
  ask: (extraUser: string | null) => Promise<string>,
): Promise<{ decision: Decision; raw: string[]; error?: string }> {
  const raws: string[] = [];
  let error: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(attempt ? RETRY_MESSAGE : null);
    raws.push(raw);
    const p = parseDecisionText(raw);
    if (p.ok) return { decision: p.decision, raw: raws, error };
    error = `${p.reason}${p.detail ? `: ${p.detail}` : ""}`;
  }
  return { decision: { ...FALLBACK_DECISION, slots: {} }, raw: raws, error };
}
