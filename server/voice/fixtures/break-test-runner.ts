/**
 * Runs one scenario (voice/tests/scenarios/*.txt) through a decision provider
 * and the reference call policy, and scores it. Three providers:
 *
 *   cannedProvider(sc)   replays the scenario's `=>` decisions (mocked mode;
 *                        every Nth reply is wrapped in fences / <think> markup
 *                        so the parser is exercised too);
 *   liveProvider()       the real OpenAI-compatible provider the app uses
 *                        (AI_INTEGRATIONS_OPENAI_*, AI_MODEL) — VOICE_LIVE_AI=1;
 *   endpointSession()    the app's /api/crm/voice/simulator/* routes on a
 *                        running server (VOICE_SIM_BASE_URL) — the engine then
 *                        applies its own policy and we score what it reports.
 */
import type { CompiledProfile, Decision } from "@shared/voice-profile";
import { decisionSchema } from "@shared/voice-profile";
import type { Scenario, CallerLine } from "./scenarios";
import { applyDecision, callerHungUp, callerSpoke, finish, newCallState, SpamLedger, SCRIPT_END, SILENCE_TEXT, type CallState } from "./call-policy";
import { decideWithRetry, parseDecisionText, normalizeDecisionObject } from "./decision-text";
import { score, skippedCard, type RunOutcome, type ScoreCard } from "./scorer";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface Provider {
  name: string;
  /** Raw model text for the next turn. `messages` holds the whole call so far (system first). */
  ask(messages: ChatMessage[], turn: { index: number; line: CallerLine }): Promise<string>;
}

export type RunOptions = {
  ledger?: SpamLedger;
  /** called after each turn (the runners print transcripts with it) */
  onTurn?: (info: { caller: string; raw: string; decision: Decision; say: string; state: CallState }) => void;
  /** endpoint mode: the server's per-turn report wins over the local policy */
  session?: EndpointSession;
};

/** The system prompt the brain sees: the compiled prompt + the protocol appendix the harness adds for live mode. */
export function protocolAppendix(compiled: CompiledProfile, callerNumber: string): string {
  return [
    "",
    "DECISION PROTOCOL (mandatory): every reply is exactly ONE JSON object and nothing else, matching this JSON Schema:",
    JSON.stringify(compiled.decisionSchema),
    `"say" is spoken to the caller: one short sentence (two only when confirming a submitted request), under 400 characters.`,
    `"action": continue | submit_lead (once you have a callback number plus an address or a clear request) | flag_spam (with "spam") | alert (with "alert") | end_call (with "outcome", only after the caller's goodbye, two silences, or spam).`,
    `"slots": every intake value collected so far, cumulative, keyed: ${compiled.intake.map((q) => q.key).join(", ")}.`,
    `The caller's number (caller id) is ${callerNumber}; use it as the callback number unless they give another, and NEVER read digits aloud.`,
    `A line "${"(silence — the caller hasn't said anything)"}" means the caller was silent: ask once if they are still there; on the second silence say goodbye and end_call with outcome "hangup".`,
  ].join("\n");
}

/** "Tuesday, October 6, 2026, 10:30 AM" for the scenario clock ("" = real now). */
export function spokenClock(clock: string, timezone = "America/Los_Angeles"): string {
  if (clock) {
    // the scenario clock is LOCAL wall time; format it without shifting zones
    const m = clock.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      return d.toLocaleString("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
  }
  return new Date().toLocaleString("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The prompt the live brain sees. The studio-backend compiler leaves two
 * per-call placeholders in the prompt — `{{now}}` and `{{caller}}` — which the
 * engine/app render at call start; the harness renders them from the
 * scenario (its `clock` directive and caller id) so time-dependent scenarios
 * (after-hours emergency) are reproducible.
 */
export function systemPromptFor(compiled: CompiledProfile, callerNumber: string, clock = ""): string {
  const last4 = callerNumber.replace(/\D/g, "").slice(-4);
  const prompt = compiled.systemPrompt
    .split("{{now}}").join(spokenClock(clock))
    .split("{{caller}}").join(`Caller ID ending in ${last4 || "unknown"} (already the callback number; never read it aloud).`);
  return prompt + "\n" + protocolAppendix(compiled, callerNumber);
}

// ── providers ──────────────────────────────────────────────────────────────

/** Deterministic wrappers that a real agent-style model produces; the parser must see through all of them. */
const WRAPPERS: ((json: string) => string)[] = [
  (j) => j,
  (j) => "```json\n" + j + "\n```",
  (j) => "<think>The caller gave the address; next I ask for the name.</think>\n" + j,
  (j) => "Here is my decision:\n" + j + "\nLet me know if you need anything else.",
  (j) => "<tool_call><function=web_research>{\"q\":\"siding\"}</function></tool_call>\n" + j,
];

export function cannedProvider(sc: Scenario): Provider {
  return {
    name: "canned",
    async ask(_messages, turn) {
      const line = turn.line;
      const canned = "canned" in line ? line.canned : undefined;
      if (!canned) throw new Error(`${sc.id}: no canned decision for line ${turn.index + 1}`);
      return WRAPPERS[turn.index % WRAPPERS.length](canned);
    },
  };
}

/** The real provider through the same client the app's AI features use. Needs AI_INTEGRATIONS_OPENAI_* in env. */
export function liveProvider(opts: { model?: string; temperature?: number; timeoutMs?: number } = {}): Provider {
  let client: any = null;
  return {
    name: `live:${opts.model ?? process.env.AI_MODEL ?? "truthcode-api"}`,
    async ask(messages) {
      if (!client) {
        const { aiClient } = await import("../../ai-output");
        client = aiClient({ timeoutFallbackMs: opts.timeoutMs ?? 30_000, maxRetries: 0 });
      }
      const { aiModel } = await import("../../ai-config");
      const r = await client.chat.completions.create({
        model: aiModel(opts.model), max_tokens: 400, temperature: opts.temperature ?? 0.2, messages, stream: false,
      });
      const c = r?.choices?.[0]?.message?.content;
      return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : "";
    },
  };
}

// ── endpoint mode (the app's simulator routes) ─────────────────────────────

export type EndpointSession = {
  start(sc: Scenario): Promise<{ greeting: string }>;
  /** `silence`: the caller said nothing (sent as text "(silence)" + silence:true — SPEC §6 extension, see LANE-NOTES-harness.md). */
  turn(text: string, silence?: boolean): Promise<{ decision: Decision; ended: boolean; outcome: string | null; raw?: string }>;
  end(): Promise<void>;
};

export function endpointSession(baseUrl: string, headers: Record<string, string> = {}): EndpointSession {
  let sessionId = "";
  const h = { "Content-Type": "application/json", ...headers };
  return {
    async start(sc) {
      const r = await fetch(`${baseUrl}/api/crm/voice/simulator/session`, { method: "POST", headers: h, body: JSON.stringify({ useDraft: true, callerNumber: sc.caller }) });
      if (!r.ok) throw new Error(`simulator/session ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      sessionId = j.sessionId;
      return { greeting: j.greeting ?? "" };
    },
    async turn(text, silence = false) {
      const body = silence ? { sessionId, text: "(silence)", silence: true } : { sessionId, text };
      const r = await fetch(`${baseUrl}/api/crm/voice/simulator/turn`, { method: "POST", headers: h, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`simulator/turn ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      // The turn response is a Decision plus bookkeeping (ended, outcome: null mid-call, events, turn, fallback):
      // normalise the decision part the same way the parser does, never trust the extra keys as protocol.
      const { ended, outcome, events: _events, turn: _turn, fallback: _fb, ...rest } = j ?? {};
      const n = normalizeDecisionObject({ ...rest, ...(outcome ? { outcome } : {}) });
      const d = "value" in n ? decisionSchema.safeParse(n.value) : null;
      if (!d?.success) throw new Error(`simulator/turn returned something that is not a Decision: ${JSON.stringify(j).slice(0, 200)}`);
      return { decision: d.data, ended: !!ended, outcome: outcome ?? null, raw: JSON.stringify(j) };
    },
    async end() {
      if (sessionId) await fetch(`${baseUrl}/api/crm/voice/simulator/session/${sessionId}`, { method: "DELETE", headers: h }).catch(() => {});
    },
  };
}

// ── the run ────────────────────────────────────────────────────────────────

export type RunResult = { card: ScoreCard; run: RunOutcome; transcript: string[] };

export async function runScenario(sc: Scenario, compiled: CompiledProfile, provider: Provider | null, opts: RunOptions = {}): Promise<RunResult> {
  const ledger = opts.ledger ?? new SpamLedger();
  const state = newCallState(sc.caller);
  const run: RunOutcome = { state, says: [], callerLines: [], errors: [] };
  const transcript: string[] = [];
  let t = 0;

  if (sc.mode === "webhook") {
    // pre-answer: the app's ledger decides before the stream opens
    const blocked = ledger.blocked(sc.caller);
    run.twiml = blocked ? '<Reject reason="rejected"/>' : "<Connect><Stream/></Connect>";
    state.ended = true; state.endReason = blocked ? "blocked" : "not_blocked"; state.outcome = blocked ? "blocked" : null;
    transcript.push(`WEBHOOK from=${sc.caller} → ${run.twiml}`);
    return { card: score(sc, run), run, transcript };
  }
  if (sc.mode === "audio" && !opts.session) {
    return { card: skippedCard(sc, "audio-only (fake_signalwire.py)"), run, transcript };
  }

  const messages: ChatMessage[] = [{ role: "system", content: systemPromptFor(compiled, sc.caller, sc.clock) }];
  let greeting = compiled.greeting;
  if (opts.session) greeting = (await opts.session.start(sc)).greeting || greeting;
  messages.push({ role: "assistant", content: greeting });
  state.transcript.push({ role: "assistant", text: greeting, t });
  state.lastAssistantSay = greeting;
  transcript.push(`AI: ${greeting}`);

  try {
    for (let i = 0; i < sc.lines.length && !state.ended; i++) {
      const line = sc.lines[i];
      t += 1;
      if (line.kind === "hangup") { transcript.push("CALLER: <hangup>"); callerHungUp(state); break; }
      if (line.kind === "whisper") { transcript.push(`WHISPER: ${line.text}`); continue; } // media-level only; the text path never sees it
      const text = callerSpoke(state, line.kind === "silence" ? null : line.text, t);
      if (line.kind === "text") run.callerLines.push(line.text);
      transcript.push(`CALLER: ${line.kind === "silence" ? "<silence>" : line.text}`);
      messages.push({ role: "user", content: text });

      let decision: Decision, raw = "";
      if (opts.session) {
        const r = await opts.session.turn(text, text === SILENCE_TEXT);
        decision = r.decision; raw = JSON.stringify(decision);
        const { say } = applyDecision(state, decision, compiled, t);
        if (r.ended && !state.ended) { finish(state, "engine"); if (r.outcome) state.outcome = r.outcome as CallState["outcome"]; }
        if (say) run.says.push(say);
        messages.push({ role: "assistant", content: raw });
        transcript.push(`AI: ${say}  [${decision.action}${state.ended ? " → ended" : ""}]`);
        opts.onTurn?.({ caller: text, raw, decision, say, state });
        continue;
      }
      if (!provider) throw new Error("no provider");
      const res = await decideWithRetry(async (extra) => {
        const msgs = extra ? [...messages, { role: "user" as const, content: extra }] : messages;
        return provider.ask(msgs, { index: i, line });
      });
      decision = res.decision; raw = res.raw[res.raw.length - 1];
      if (res.error) run.errors.push(`turn ${i + 1}: ${res.error}`);
      const p = parseDecisionText(raw);
      if (p.ok && p.decision.say.length > 400) run.errors.push(`turn ${i + 1}: say > 400 chars`);
      const { say } = applyDecision(state, decision, compiled, t);
      if (say) run.says.push(say);
      messages.push({ role: "assistant", content: JSON.stringify(decision) });
      transcript.push(`AI: ${say}  [${decision.action}${state.ended ? ` → ended (${state.endReason})` : ""}]`);
      opts.onTurn?.({ caller: text, raw, decision, say, state });
    }
  } finally {
    await opts.session?.end();
  }
  if (!state.ended) {
    // The script ran out of caller lines without the call ending: the harness closes it like a hang-up
    // (forced submit applies) but scores `ended` as false — the assistant did not end the call.
    finish(state, SCRIPT_END);
    transcript.push(`(script ended; call closed → ${state.outcome}${state.forcedSubmit ? ", forced submit" : ""})`);
  }
  ledger.record(state);
  return { card: score(sc, run), run, transcript };
}

/** Run every scenario in order (webhook preludes included) and return the cards. */
export async function runAll(
  scenarios: Scenario[], compiled: CompiledProfile, providerFor: (sc: Scenario) => Provider | null,
  opts: { only?: (sc: Scenario) => boolean; onResult?: (r: RunResult) => void; session?: (sc: Scenario) => EndpointSession | undefined } = {},
): Promise<RunResult[]> {
  const ledger = new SpamLedger();
  const results: RunResult[] = [];
  for (const sc of scenarios) {
    if (opts.only && !opts.only(sc)) continue;
    for (const p of sc.prelude) {
      const pre = scenarios.find((s) => s.id === p.id);
      if (!pre) throw new Error(`${sc.id}: prelude "${p.id}" not found`);
      for (let n = 0; n < p.times; n++) await runScenario({ ...pre, caller: sc.caller }, compiled, providerFor(pre), { ledger });
    }
    const r = await runScenario(sc, compiled, providerFor(sc), { ledger, session: opts.session?.(sc) });
    results.push(r);
    opts.onResult?.(r);
  }
  return results;
}
