/**
 * Call Assistant → the issue desk. Called once per finished call (from
 * processFinishedCall in server/voice/internal-calls.ts, which runs exactly
 * once per call — a retried end report never records twice) and from the
 * engine health probe (server/voice/billing.ts probeEngine).
 *
 * What is recorded — never the transcript, the caller's number or their details:
 *   - one-way audio suspicion: the assistant spoke, yet no caller speech was
 *     transcribed for more than ONE_WAY_AUDIO_SECONDS at the end of the call
 *     (the whole call, or after the caller's last words with the assistant
 *     prompting at least twice since) — what a call sounds like when the
 *     caller's audio never reaches the engine;
 *   - engine/provider errors the engine put in the report (events of type
 *     "error", grouped by where they happened), and an `error` outcome;
 *   - the engine unreachable (or up without its models) when the app probes it.
 */
import { recordIssue, normalizeForKey, type IssueInput } from "./issues";
import { scrubText } from "./scrub";

export const ONE_WAY_AUDIO_SECONDS = 20;

type Turn = { role: string; text: string; t?: string };
type Event = { type: string; t?: string; [k: string]: unknown };
export type CallReportFacts = {
  durationSeconds: number;
  outcome: string;
  transcript: Turn[];
  events: Event[];
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  engine?: string | null;
  model?: string | null;
};

const at = (s: unknown): number | null => {
  if (typeof s !== "string" || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

export type OneWayAudio = { reason: "no_caller_speech" | "caller_went_silent"; silentSeconds: number; assistantTurns: number; callerTurns: number };

/** The heuristic, pure. null = nothing suspicious. */
export function oneWayAudioSuspicion(r: CallReportFacts): OneWayAudio | null {
  if (r.outcome === "blocked" || r.outcome === "spam") return null;
  const duration = Number(r.durationSeconds) || 0;
  if (duration <= ONE_WAY_AUDIO_SECONDS) return null;
  const spoken = (t: Turn) => typeof t?.text === "string" && t.text.trim().length > 0;
  const caller = (r.transcript ?? []).filter((t) => t.role === "caller" && spoken(t));
  const assistant = (r.transcript ?? []).filter((t) => t.role === "assistant" && spoken(t));
  if (!assistant.length) return null;
  if (!caller.length) {
    return { reason: "no_caller_speech", silentSeconds: Math.round(duration), assistantTurns: assistant.length, callerTurns: 0 };
  }
  const start = at(r.answeredAt) ?? at(r.startedAt) ?? at(r.transcript[0]?.t);
  const end = at(r.endedAt) ?? (start !== null ? start + duration * 1000 : null);
  const lastCaller = at(caller[caller.length - 1].t);
  if (end === null || lastCaller === null) return null;
  const silent = (end - lastCaller) / 1000;
  const promptsSince = assistant.filter((t) => (at(t.t) ?? -Infinity) >= lastCaller).length;
  if (silent > ONE_WAY_AUDIO_SECONDS && promptsSince >= 2) {
    return { reason: "caller_went_silent", silentSeconds: Math.round(silent), assistantTurns: promptsSince, callerTurns: caller.length };
  }
  return null;
}

/** The engine's error events, grouped by where they happened. */
export function engineErrors(events: Event[]): { where: string; error: string; count: number }[] {
  const out = new Map<string, { where: string; error: string; count: number }>();
  for (const e of events ?? []) {
    if (e?.type !== "error") continue;
    const where = String(e.where ?? "engine").slice(0, 40);
    const error = scrubText(String(e.error ?? "").split("\n")[0], 300);
    const key = `${where}|${normalizeForKey(error, 120)}`;
    const cur = out.get(key);
    if (cur) cur.count++; else out.set(key, { where, error, count: 1 });
  }
  return [...out.values()];
}

export function recordCallReportIssues(
  call: { id: string; orgId: string },
  report: CallReportFacts,
  record: (input: IssueInput) => Promise<void> = recordIssue,
): void {
  try {
    const base = { callId: call.id, orgId: call.orgId, outcome: report.outcome, durationSeconds: Math.round(Number(report.durationSeconds) || 0), engine: report.engine ?? null, model: report.model ?? null };
    const owa = oneWayAudioSuspicion(report);
    if (owa) {
      void record({
        source: "call_assistant", severity: "warning",
        key: `one_way_audio|${owa.reason}`,
        title: owa.reason === "no_caller_speech"
          ? `Possible one-way audio: no caller speech in a ${base.durationSeconds}s call while the assistant spoke`
          : `Possible one-way audio: the caller went silent for ${owa.silentSeconds}s while the assistant kept prompting`,
        detail: { ...base, ...owa, thresholdSeconds: ONE_WAY_AUDIO_SECONDS },
      });
    }
    for (const e of engineErrors(report.events)) {
      void record({
        source: "call_assistant",
        key: `engine_error|${e.where}|${normalizeForKey(e.error, 120)}`,
        title: `Call Assistant engine error (${e.where}): ${e.error.slice(0, 120) || "no message"}`,
        detail: { ...base, where: e.where, error: e.error, inThisCall: e.count },
      });
    }
    if (report.outcome === "error") {
      const types: Record<string, number> = {};
      for (const e of report.events ?? []) if (typeof e?.type === "string") types[e.type.slice(0, 40)] = (types[e.type.slice(0, 40)] ?? 0) + 1;
      void record({
        source: "call_assistant",
        key: "call_outcome_error",
        title: "A call ended with outcome \"error\"",
        detail: { ...base, eventTypes: types, transcriptTurns: report.transcript?.length ?? 0 },
      });
    }
  } catch { /* the call's own processing never waits on, or fails over, the issue desk */ }
}

/** From the engine probe: unreachable, or up without its models. */
export function recordEngineHealth(status: { reachable: boolean; models: boolean; checkedAt: string }, engineHost: string, record: (input: IssueInput) => Promise<void> = recordIssue): void {
  try {
    if (!status.reachable) {
      void record({
        source: "health", severity: "critical", key: "voice_engine_unreachable",
        title: "Call Assistant engine unreachable (calls cannot be answered)",
        detail: { engine: engineHost, checkedAt: status.checkedAt, probe: "GET /health, 2.5 s timeout" },
      });
    } else if (!status.models) {
      void record({
        source: "health", severity: "warning", key: "voice_engine_models_not_loaded",
        title: "Call Assistant engine is up but its models are not loaded",
        detail: { engine: engineHost, checkedAt: status.checkedAt },
      });
    }
  } catch { /* nothing */ }
}
