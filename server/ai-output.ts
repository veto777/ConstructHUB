/**
 * One output guard for every AI feature.
 *
 * The provider (TruthCoder, model truthcode:38) is an agent-style model behind an
 * OpenAI-compatible API. Even when no tools are sent it sometimes:
 *  - writes tool calls as text ("<tool_call><function=web_research>…</tool_call>",
 *    "[web_research: …]", a bare "web_research" line, a {"name":…,"arguments":…} object);
 *  - writes its reasoning into message.content ("I am not using a tool here because…",
 *    "Let me think…", "<think>…</think>", "**Wait...** The prompt contains…");
 *  - spends max_tokens on that reasoning and stops (finish_reason "length") before the answer.
 *
 * None of that may reach a user. The pattern for an AI path:
 *
 *   const client = aiClient();                       // AI_TIMEOUT_MS, at most one SDK retry
 *   const { text } = await aiComplete(client, {      // one retry on a bad answer, then AiAnswerError
 *     model: aiModel(), max_tokens: 900,
 *     messages: [{ role: "system", content: `…rules…\n${NO_TOOLS_RULE}` }, { role: "user", content }],
 *   }, { sources: [content], maxChars: 1500 });
 *
 * and the route maps AiAnswerError (and provider errors) to an honest 502/503.
 * Paths that call the HTTP API directly use aiAnswer(body, opts) on the parsed JSON.
 */
import OpenAI from "openai";
import { aiTimeoutMs } from "./ai-config";

/** Add to every system prompt: the model has no tools and must answer, not think aloud. */
export const NO_TOOLS_RULE =
  "You have no tools; never output tool calls, markers or your reasoning — reply with the final answer only.";

// Tool names the provider's agent prompt advertises (and the model then "calls" as text).
const TOOL_NAMES = ["web_research", "web_search", "read_image", "describe_image", "code_interpreter", "fetch_url", "open_url"];
const TOOL_ALT = TOOL_NAMES.join("|");

// "Wait..." / "**Wait**" / "Wait, the prompt…" / "Hmm" — not a marketing "Wait!" or "Wait, there's more".
const WAIT = String.raw`(?:\*\*)?(?:wait(?:\s*(?:\.{2,}|…)|\*\*|,\s+(?:I\b|let me\b|looking\b|actually\b|no\b|the (?:user|prompt|instructions?|rules?|system|review|request|task)\b))|hmm+\b)`;

// Phrases that only appear when the model talks about its task instead of doing it.
const REASONING_LEAK: RegExp[] = [
  /\bI(?:'m| am) not (?:using|calling) (?:a |any )?tools?\b/i,
  /\bthe (?:system|developer) (?:prompt|message|instructions?)\b/i,
  /\bthe user(?:'s)? (?:prompt|message|request|instructions?) (?:says|asks|wants|contains|is)\b/i,
  // At a line start only: an ads answer may well say "whenever the user wants a plumber".
  /^\s*(?:\*\*)?the user wants\b|\bthe user wants me\b/im,
  /\bprompt injection\b/i,
  /\blet me (?:think|re-?read|reconsider|re-?check|check the (?:prompt|rules|instructions)|look at the prompt)\b/i,
  /\b(?:my (?:rules?|instructions|guidelines|constraints)|the (?:instructions|guidelines|constraints)) (?:say|says|state|states|require|requires)\b/i,
  new RegExp(`^\\s*${WAIT}`, "im"),
  /\bLAW \d+\b/,
  /\bCITATION CONTRACT\b/i,
];

// The filler a planning paragraph opens with ("Okay, so …"); what follows it is judged.
const INTERJECTION = /^(?:okay|ok|alright|so|hmm+|wait)\b[,.…!]*\s+(?:so,?\s+)?/i;

// A leading paragraph that is the model planning its answer. A customer's own review
// ("The owner gave us a fair quote", "So the customer service was great", "I need to
// write a thank-you to this crew") must not match.
const REASONING_START: RegExp[] = [
  // Only planning verbs: a chat answer may well open with "Let's do the math".
  /^(?:let me|let's) (?:think|analy[sz]e|reason|draft|look at (?:the|this) (?:prompt|request|review))/i,
  /^I(?:'m| am) not (?:using|calling) (?:a |any )?tools?/i,
  /^(?:the user|the request|the task|the prompt|this request|this task)(?:'s)? (?:wants|is asking|asks|asked|has asked|needs|requires|contains|says|provided|gave)\b/i,
  /^(?:the customer|the reviewer|the business owner|the owner)(?:'s)? (?:wants|is asking|has asked) (?:me|us|a|an)\b/i,
  /^(?:the customer|the reviewer)'s (?:description|review|message|text) (?:says|mentions|contains)\b/i,
  /^(?:I need to|I should|I must|I have to|I'll need to|My (?:task|job|goal) is to) (?:(?:write|draft|craft|produce|generate|create) (?:a|an|the|this|my) (?:(?:short|brief|concise|professional|polite|public|final|good|warm) )?(?:reply|response|review|post|draft|caption|description|update|plan|answer)\b|respond\b|reply to (?:the|this)\b|answer (?:the|this)\b|make sure (?:not|I|the (?:reply|response|review|post|draft))\b|follow (?:the|these|my) (?:rules|instructions|guidelines)\b|avoid\b|be careful\b)/i,
  /^(?:\*\*)?(?:constraints|thinking|thoughts?|reasoning|drafting(?: the (?:response|reply|post))?)(?:\*\*)?\s*:?(?:\*\*)?\s*(?:$|\n)/i,
  new RegExp(`^${WAIT}`, "i"),
];

// "Here's the reply:" / "Final answer:" — what follows is the answer.
const ANSWER_LABEL = /^[ \t]*(?:\*\*)?(?:final (?:answer|response|reply|draft|version|post|caption|description)|here(?:'s| is) (?:the|my|a|your) (?:final |revised )?(?:reply|response|answer|draft|post|caption|description|review))(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*(?:\n|$)/gim;
// A bare label at the very start: "Reply: Thank you…".
const LEADING_LABEL = /^(?:\*\*)?(?:reply|response|answer|draft|caption|description)(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i;
// When a tool call was written, the sentence announcing it is not an answer either.
const TOOL_ANNOUNCEMENT = /[^.!?\n]*\b(?:let me|I'll|I will|I'm going to|I am going to|allow me to)\s+(?:quickly\s+)?(?:grab|search|look(?: that| it| this)? up|look into|research|check|pull up|fetch|browse|find|use|call|run|query|get)\b[^.!?\n]*[.!?…]*/gi;
const JSON_ANSWER_KEYS = ["reply", "response", "answer", "text", "content", "post", "update", "caption", "description", "draft", "review", "message", "summary", "plan"];

function stripToolCalls(s: string): { text: string; found: boolean } {
  const before = s;
  s = s
    // XML-style tool calls, closed or cut off.
    .replace(/<(tool_calls?|function_calls|tool_use|tool_response|tool_result)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(tool_calls?|function_calls|tool_use)\b[^>]*>[\s\S]*$/i, "")
    .replace(/<\|(?:tool_calls?|python_tag)[^|]*\|>[\s\S]*?(?:<\|\/?(?:tool_calls?|eom|eot)[^|]*\|>|$)/gi, "")
    .replace(/<function=[^>]*>[\s\S]*?(?:<\/function>|$)/gi, "")
    .replace(/<parameter=[^>]*>[\s\S]*?(?:<\/parameter>|$)/gi, "")
    .replace(/<\/?(?:tool_calls?|function_calls|tool_use|tool_response|tool_result|function|parameter|invoke)\b[^>]*>/gi, "")
    // Bracket markers: "[web_research: …]", "[web_research]", any "[snake_case_tool: …]".
    .replace(new RegExp(`\\[(?:${TOOL_ALT}|tool_call)(?:\\s*[:(][^\\]\\n]*)?\\]`, "gi"), "")
    .replace(/\[[a-z]+(?:_[a-z]+)+(?::[^\]\n]*)?\](?!\()/g, "")
    // A tool name alone on its line, and any line that talks about a provider tool.
    .replace(new RegExp(`^[ \\t]*\`?(?:${TOOL_ALT})\`?[ \\t]*:?[ \\t]*$`, "gim"), "")
    .replace(/^[ \t]*[a-z]+(?:_[a-z]+)+[ \t]*$/gm, "")
    .replace(new RegExp(`^.*\\b(?:${TOOL_ALT})\\b.*$`, "gim"), "")
    // The gateway's own preamble ("RESEARCH — LAW 15: …").
    .replace(/^[ \t]*(?:\*\*)?RESEARCH\s*[—–-]\s*LAW\s+\d+.*$/gim, "");
  s = stripJsonToolCalls(s);
  return { text: s, found: s !== before };
}

/** Remove {"name": "...", "arguments": ...} objects (balanced braces) wherever they sit. */
function stripJsonToolCalls(s: string): string {
  const head = /\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"(?:arguments|parameters)"\s*:/g;
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = head.exec(s))) {
    let depth = 0, i = m.index, inStr = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    out += s.slice(last, m.index);
    last = Math.min(s.length, i + 1);
    head.lastIndex = last;
  }
  return out + s.slice(last);
}

const THINK_TAGS = "think|thinking|reasoning|reflection|analysis|scratchpad";

function stripThinking(s: string): string {
  s = s
    .replace(new RegExp(`<(${THINK_TAGS})>[\\s\\S]*?<\\/\\1>`, "gi"), "")
    .replace(new RegExp(`\\[(${THINK_TAGS})\\][\\s\\S]*?\\[\\/\\1\\]`, "gi"), "");
  // A closing tag with no opening one: everything before it was the reasoning.
  const orphan = new RegExp(`<\\/(?:${THINK_TAGS})>|\\[\\/(?:${THINK_TAGS})\\]`, "gi");
  let m: RegExpExecArray | null, end = -1;
  while ((m = orphan.exec(s))) end = m.index + m[0].length;
  if (end >= 0) s = s.slice(end);
  // An opening tag that never closed ("<think>…", "[thinking]…"): the answer never came.
  return s.replace(new RegExp(`(?:<(?:${THINK_TAGS})>|\\[(?:${THINK_TAGS})\\])[\\s\\S]*$`, "i"), "");
}

const isReasoningStart = (p: string) => {
  const t = p.trim(), rest = t.replace(INTERJECTION, "");
  return REASONING_START.some((re) => re.test(t) || re.test(rest));
};
const isStrongReasoning = (p: string) => REASONING_LEAK.some((re) => re.test(p));

function stripReasoningParagraphs(s: string): string {
  // Take the text after the last "Final answer:" label when what precedes it is planning.
  const labels = [...s.matchAll(ANSWER_LABEL)];
  if (labels.length) {
    const lastLabel = labels[labels.length - 1];
    const prefix = s.slice(0, lastLabel.index);
    const after = s.slice(lastLabel.index! + lastLabel[0].length);
    if (after.trim() && (!prefix.trim() || isStrongReasoning(prefix) || prefix.split(/\n\s*\n/).some(isReasoningStart))) s = after;
  }
  let paras = s.split(/\n[ \t]*\n/);
  // Leading planning paragraphs.
  while (paras.length && (isReasoningStart(paras[0]) || !paras[0].trim())) paras.shift();
  // A good answer followed by "**Wait...** The prompt contains…": keep the answer only.
  const tail = paras.findIndex((p, i) => i > 0 && isStrongReasoning(p));
  if (tail > 0) paras = paras.slice(0, tail);
  // Trailing separators left behind ("***", "---").
  while (paras.length && /^\s*(?:[-*_]\s*){3,}\s*$/.test(paras[paras.length - 1])) paras.pop();
  return paras.join("\n\n");
}

/** A single JSON object/string answer ({"update":"…","length_check":492}) becomes its text. */
function unwrapJson(s: string): string {
  const t = s.trim();
  if (!/^(?:\{[\s\S]*\}|"[\s\S]*")$/.test(t)) return s;
  try {
    const v = JSON.parse(t);
    if (typeof v === "string") return v;
    if (!v || typeof v !== "object" || Array.isArray(v)) return s;
    for (const k of JSON_ANSWER_KEYS) if (typeof v[k] === "string" && v[k].trim()) return v[k];
    const strings = Object.values(v).filter((x): x is string => typeof x === "string").sort((a, b) => b.length - a.length);
    return strings[0] && strings[0].length >= 20 ? strings[0] : s;
  } catch { return s; }
}

// A sentence end, but not the "2." of a numbered list.
const SENTENCE_END = /(?<!(?:^|\s)\d{1,3})[.!?…](?:["'”’)\]]*)(?=\s|$)/gm;

/** Cut to at most `max` characters at a sentence end when one is reasonably close. */
export function fitChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  let cut = -1;
  for (const m of head.matchAll(SENTENCE_END)) cut = m.index! + m[0].length;
  if (cut >= max * 0.4) return head.slice(0, cut).trim();
  const space = head.lastIndexOf(" ");
  return (space > max * 0.5 ? head.slice(0, space) : head.slice(0, max - 1)).trim() + "…";
}

/** Drop sentences that match `pattern` (e.g. a meta remark about SEO). */
export function dropSentences(text: string, pattern: RegExp): string {
  return text
    .split(/\n/)
    .map((line) => (line.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [line]).filter((s) => !pattern.test(s)).join("").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface CleanOptions {
  /** Longest answer to return; cut at a sentence end. */
  maxChars?: number;
}

/**
 * The answer inside a raw model reply: tool calls, tool markers, think blocks,
 * reasoning paragraphs, labels and JSON wrappers removed; whitespace collapsed.
 * Returns "" when nothing but markup or reasoning was written.
 */
export function cleanAiText(raw: unknown, opts: CleanOptions = {}): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\r\n?/g, "\n");
  const fenced = s.trim().match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) s = fenced[1];
  s = stripThinking(s);
  const tools = stripToolCalls(s);
  s = tools.text;
  if (tools.found) s = s.replace(TOOL_ANNOUNCEMENT, "");
  s = unwrapJson(s);
  s = stripReasoningParagraphs(s);
  s = s.trim().replace(LEADING_LABEL, "");
  // Whole answer wrapped in quotes.
  const q = s.trim().match(/^["“]([^"“”]+)["”]$/);
  if (q) s = q[1];
  s = s
    .replace(/[ \t]+$/gm, "")
    .replace(/(\S)(?:[ \t]{2,}|\t)/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return opts.maxChars ? fitChars(s, opts.maxChars) : s;
}

/** Phone numbers, emails and (unless `links` is false) links in `text` that none of `sources` contains. */
export function unsuppliedContacts(text: string, sources: string[], links = true): string[] {
  const src = sources.join("\n").toLowerCase();
  const srcDigits = src.replace(/\D/g, "");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) {
    const digits = m[0].replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (!srcDigits.includes(digits)) found.push(m[0]);
  }
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) if (!src.includes(m[0].toLowerCase())) found.push(m[0]);
  if (links) for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi)) {
    const host = m[0].replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase().replace(/[.,;:!]+$/, "");
    if (!src.includes(host)) found.push(m[0]);
  }
  return found;
}

export interface AnswerOptions extends CleanOptions {
  /** Shortest usable answer after cleaning (default 20 characters). */
  minChars?: number;
  /**
   * Accept a reply cut at max_tokens, trimmed back to its last complete sentence
   * (long-form chat or plans). Short-form drafts leave this off: a cut reply is rejected.
   */
  allowTruncated?: boolean;
  /** Everything the model was given: contact details not found here are invented. */
  sources?: string[];
  /** Links may cite outside references (e.g. schema.org in a Site Scan plan); phones and emails are still checked. */
  allowLinks?: boolean;
  /** Extra patterns that mean the answer is unusable (e.g. a fragment of our own prompt). */
  forbid?: RegExp[];
  /** Feature-specific cleanup on the cleaned text (e.g. drop meta sentences), judged afterwards. */
  transform?: (text: string) => string;
}

export type AiAnswer =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: "empty" | "length" | "markup" | "reasoning" | "tool-call" | "filtered" | "invented-contact" | "forbidden"; text: string };

interface CompletionLike {
  choices?: Array<{ finish_reason?: string | null; message?: { content?: unknown; tool_calls?: unknown[] | null } | null } | null> | null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

const RESIDUAL_MARKUP = new RegExp(`</?(?:tool_calls?|function|parameter|think|thinking|reasoning|tool_response|invoke)\\b|<function=|\\b(?:${TOOL_ALT})\\b`, "i");

/** Judge one chat completion: the cleaned answer, or why it cannot be shown. */
export function aiAnswer(completion: CompletionLike | null | undefined, opts: AnswerOptions = {}): AiAnswer {
  const choice = completion?.choices?.[0];
  const finish = choice?.finish_reason ?? null;
  const raw = contentText(choice?.message?.content);
  const minChars = opts.minChars ?? 20;
  let text = cleanAiText(raw, opts.allowTruncated ? {} : opts);
  if (finish === "content_filter") return { ok: false, reason: "filtered", text };
  if (!text && (finish === "tool_calls" || (choice?.message?.tool_calls?.length ?? 0) > 0)) return { ok: false, reason: "tool-call", text };
  if (finish === "length") {
    if (!opts.allowTruncated) return { ok: false, reason: "length", text };
    // Keep only complete sentences of a cut reply.
    let end = text.lastIndexOf("\n\n");
    for (const m of text.matchAll(SENTENCE_END)) end = Math.max(end, m.index! + m[0].length);
    text = end > 0 ? text.slice(0, end).trim() : "";
    if (opts.maxChars) text = fitChars(text, opts.maxChars);
  } else if (opts.allowTruncated && opts.maxChars) text = fitChars(text, opts.maxChars);
  if (opts.transform) text = opts.transform(text).trim();
  if (text.replace(/[\s*_#>`~\-–—.…]/g, "").length < minChars) return { ok: false, reason: finish === "length" ? "length" : "empty", text };
  if (RESIDUAL_MARKUP.test(text)) return { ok: false, reason: "markup", text };
  if (text.includes(NO_TOOLS_RULE.slice(0, 40)) || REASONING_LEAK.some((re) => re.test(text))) return { ok: false, reason: "reasoning", text };
  if (opts.forbid?.some((re) => re.test(text))) return { ok: false, reason: "forbidden", text };
  if (opts.sources && unsuppliedContacts(text, opts.sources, !opts.allowLinks).length) return { ok: false, reason: "invented-contact", text };
  return { ok: true, text, truncated: finish === "length" };
}

/** True when the completion holds an answer that may be shown to a user. */
export function aiAnswerOk(completion: CompletionLike | null | undefined, opts: AnswerOptions = {}): boolean {
  return aiAnswer(completion, opts).ok;
}

/** The model answered, but with nothing a user can be shown (after one retry). */
export class AiAnswerError extends Error {
  constructor(public reason: string) {
    super("The AI did not return a usable answer");
    this.name = "AiAnswerError";
  }
}

/** Every AI client: AI_TIMEOUT_MS per call and at most one SDK retry. */
export function aiClient(opts: { timeoutFallbackMs?: number; maxRetries?: 0 | 1 } = {}): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: aiTimeoutMs(opts.timeoutFallbackMs ?? 60_000),
    maxRetries: Math.min(opts.maxRetries ?? 0, 1),
  });
}

/** What the retry adds to the first system message after a rejected answer. */
export function retryNote(reason: string): string {
  return `Your previous reply was rejected (${reason}). ${NO_TOOLS_RULE} Write the complete final text now.`;
}

/** The messages for a retry: the first system message gains the retry note. */
export function withRetryNote<M extends { role: string; content?: unknown }>(messages: M[], reason: string): M[] {
  const i = messages.findIndex((m) => m.role === "system" && typeof m.content === "string");
  if (i < 0) return [{ role: "system", content: retryNote(reason) } as unknown as M, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${retryNote(reason)}` } : m));
}

export interface ChatClient {
  chat: { completions: { create(params: any, options?: any): Promise<any> } };
}

/**
 * One chat completion judged by aiAnswer: a bad answer (markup, reasoning, cut at
 * max_tokens, empty) is retried once, then AiAnswerError. Provider errors propagate.
 */
export async function aiComplete(
  client: ChatClient,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  opts: AnswerOptions & { attempts?: number } = {},
): Promise<{ text: string; truncated: boolean }> {
  const attempts = Math.max(1, Math.min(opts.attempts ?? 2, 2));
  let reason = "empty";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const messages = attempt ? withRetryNote(params.messages, reason) : params.messages;
    const completion = await client.chat.completions.create({ ...params, messages, stream: false });
    const answer = aiAnswer(completion, opts);
    if (answer.ok) return { text: answer.text, truncated: answer.truncated };
    reason = answer.reason;
  }
  throw new AiAnswerError(reason);
}

/** A provider error as a log line without its body (which may echo the key). */
export function aiErrorTag(err: unknown): string {
  const e = err as { name?: string; status?: number; constructor?: { name?: string } } | null;
  if (e instanceof AiAnswerError) return `AiAnswerError(${e.reason})`;
  return [e?.constructor?.name || e?.name || "Error", e?.status ?? ""].filter(Boolean).join(" ");
}
