import { describe, expect, it } from "vitest";
// The Call Assistant's issue-desk heuristics (server/ops/call-assistant.ts):
// one-way audio suspicion, engine errors from the report, the engine probe.
import type { IssueInput } from "./issues";
import { engineErrors, ONE_WAY_AUDIO_SECONDS, oneWayAudioSuspicion, recordCallReportIssues, recordEngineHealth, type CallReportFacts } from "./call-assistant";

const T0 = Date.parse("2026-10-02T15:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const say = (role: "caller" | "assistant", s: number, text = "…words…") => ({ role, text, t: at(s) });
const call = (over: Partial<CallReportFacts>): CallReportFacts => ({
  durationSeconds: 60, outcome: "hangup", transcript: [], events: [], answeredAt: at(0), endedAt: at(60), ...over,
});

describe("one-way audio suspicion", () => {
  it("flags a call where the assistant spoke and no caller speech was ever transcribed", () => {
    const r = oneWayAudioSuspicion(call({ durationSeconds: 34, endedAt: at(34), transcript: [say("assistant", 1, "Thanks for calling Acme, this is Janice."), say("assistant", 12, "Hello? Are you there?"), { role: "caller", text: "  ", t: at(14) }] }));
    expect(r).toEqual({ reason: "no_caller_speech", silentSeconds: 34, assistantTurns: 2, callerTurns: 0 });
  });

  it("flags a caller who went silent for more than 20 s while the assistant kept prompting", () => {
    const r = oneWayAudioSuspicion(call({
      durationSeconds: 70, endedAt: at(70),
      transcript: [say("assistant", 1), say("caller", 5, "my gutter is leaking"), say("assistant", 8), say("assistant", 30, "Are you still there?"), say("assistant", 50, "I can't hear you.")],
    }));
    expect(r).toEqual({ reason: "caller_went_silent", silentSeconds: 65, assistantTurns: 3, callerTurns: 1 });
  });

  it("does not flag normal calls", () => {
    // A conversation that ends right after the caller's last words.
    expect(oneWayAudioSuspicion(call({ durationSeconds: 45, endedAt: at(45), transcript: [say("assistant", 1), say("caller", 4), say("assistant", 8), say("caller", 40, "thanks, bye"), say("assistant", 41, "Goodbye!")] }))).toBeNull();
    // Short calls (≤ 20 s), however quiet.
    expect(oneWayAudioSuspicion(call({ durationSeconds: ONE_WAY_AUDIO_SECONDS, endedAt: at(20), transcript: [say("assistant", 1)] }))).toBeNull();
    // The assistant never spoke (nothing to say about one-way audio).
    expect(oneWayAudioSuspicion(call({ durationSeconds: 90, transcript: [] }))).toBeNull();
    // Blocked and spam calls.
    expect(oneWayAudioSuspicion(call({ outcome: "blocked", transcript: [say("assistant", 1)] }))).toBeNull();
    expect(oneWayAudioSuspicion(call({ outcome: "spam", transcript: [say("assistant", 1)] }))).toBeNull();
    // One long answer the caller listened to before hanging up (one assistant turn since): not a re-prompt pattern.
    expect(oneWayAudioSuspicion(call({ durationSeconds: 40, endedAt: at(40), transcript: [say("caller", 2, "what are your hours"), say("assistant", 4, "We're open…")] }))).toBeNull();
  });

  it("falls back to the duration when the transcript has no timestamps", () => {
    expect(oneWayAudioSuspicion({ durationSeconds: 25, outcome: "hangup", transcript: [{ role: "assistant", text: "Hi!" }], events: [] })?.reason).toBe("no_caller_speech");
    expect(oneWayAudioSuspicion({ durationSeconds: 25, outcome: "hangup", transcript: [{ role: "caller", text: "hi" }, { role: "assistant", text: "Hi!" }], events: [] })).toBeNull();
  });
});

describe("recording a finished call's issues", () => {
  it("records one-way audio, engine errors grouped by where, and an error outcome — never transcript text or caller details", () => {
    const seen: IssueInput[] = [];
    const record = async (i: IssueInput) => { seen.push(i); };
    recordCallReportIssues({ id: "call-1", orgId: "org-1" }, call({
      outcome: "error", durationSeconds: 30, endedAt: at(30), engine: "own", model: "m",
      transcript: [say("assistant", 1, "Hi, this is Janice for Jane Doe at 555-201-4499")],
      events: [
        { type: "error", where: "provider", error: "Connection refused to 10.0.0.5:8000" },
        { type: "error", where: "provider", error: "Connection refused to 10.0.0.5:8000" },
        { type: "error", where: "decide", attempt: 1, error: "timeout after 25s" },
        { type: "decision" },
      ],
    }), record);
    const keys = seen.map((s) => s.key);
    expect(keys).toEqual(["one_way_audio|no_caller_speech", expect.stringMatching(/^engine_error\|provider\|/), expect.stringMatching(/^engine_error\|decide\|/), "call_outcome_error"]);
    expect(seen.every((s) => s.source === "call_assistant")).toBe(true);
    expect((seen[1].detail as any).inThisCall).toBe(2);
    expect(JSON.stringify(seen)).not.toMatch(/Janice|Jane Doe|201-4499/);
    expect(seen[0].detail).toMatchObject({ callId: "call-1", orgId: "org-1", silentSeconds: 30 });
  });

  it("records nothing for a clean call and never throws", () => {
    const seen: IssueInput[] = [];
    recordCallReportIssues({ id: "c", orgId: "o" }, call({ transcript: [say("assistant", 1), say("caller", 3), say("caller", 58)] }), async (i) => { seen.push(i); });
    expect(seen).toEqual([]);
    expect(() => recordCallReportIssues({ id: "c", orgId: "o" }, null as any, async () => { throw new Error("x"); })).not.toThrow();
    expect(engineErrors(undefined as any)).toEqual([]);
  });

  it("the engine probe: unreachable is critical, model-less is a warning, healthy is silent", () => {
    const seen: IssueInput[] = [];
    const record = async (i: IssueInput) => { seen.push(i); };
    recordEngineHealth({ reachable: false, models: false, checkedAt: at(0) }, "100.90.145.13:8152", record);
    recordEngineHealth({ reachable: true, models: false, checkedAt: at(0) }, "100.90.145.13:8152", record);
    recordEngineHealth({ reachable: true, models: true, checkedAt: at(0) }, "100.90.145.13:8152", record);
    expect(seen.map((s) => [s.source, s.key, s.severity])).toEqual([
      ["health", "voice_engine_unreachable", "critical"],
      ["health", "voice_engine_models_not_loaded", "warning"],
    ]);
  });
});
