/**
 * Builds the engine → app payloads (SPEC.md § 5) from a harness call run, so
 * the calls+crm lane can test lead delivery, escalations and the spam ledger
 * with realistic bodies without a phone, a GPU or a model:
 *
 *   start   — POST /api/voice-internal/calls
 *   events  — POST /api/voice-internal/calls/:callSid/events (mid-call lead / alert)
 *   report  — PUT  /api/voice-internal/calls/:callSid (the end-of-call report)
 *
 * `server/voice/fixtures/call-report.<kind>.json` are this function's output
 * for fixed scenarios (regenerate with build-fixtures.ts). Times are fixed so
 * the files are stable.
 */
import type { CompiledProfile } from "@shared/voice-profile";
import type { Scenario } from "./scenarios";
import type { CallState } from "./call-policy";

export type CallStartBody = {
  callSid: string; to: string; from: string; numberId?: string; startedAt: string;
  engine: string; model: string; persona: string; profileVersion: number;
};
export type CallEventBody =
  | { type: "alert"; kind: string; summary: string; slots: Record<string, string> }
  | { type: "lead"; slots: Record<string, string> };
export type CallReportBody = {
  endedAt: string; durationSeconds: number; outcome: string; summary: string;
  transcript: { role: "caller" | "assistant" | "system"; text: string; t: string }[];
  slots: Record<string, string>; events: { t: string; type: string; [k: string]: unknown }[];
  caller: { name: string; email: string; address: string; city: string };
  serviceNeeded: string;
  spam?: { confidence: number; reason: string };
  lead?: { requested: true };
  alerts?: { kind: string; summary: string }[];
};
export type CallFixture = { scenario: string; callSid: string; start: CallStartBody; events: CallEventBody[]; report: CallReportBody };

/** Seconds of call time per transcript step — plausible, fixed. */
const STEP_S = 8;

function iso(base: Date, seconds: number): string {
  return new Date(base.getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "55 Oak Lane, Bellingham" → street + city (the engine's split_city rule). */
export function splitCity(address: string): { address: string; city: string } {
  const a = (address || "").trim();
  if (!a.includes(",")) return { address: a, city: "" };
  const [street, ...rest] = a.split(",");
  const city = (rest.join(",").split(",")[0] ?? "").trim().replace(/\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/, "").trim();
  return { address: street.trim(), city };
}

/** One-line summary written the way the engine's summarizer is asked to (who, what, what happened) — deterministic. */
function summaryFor(s: CallState, sc: Scenario): string {
  const who = s.slots.first_name || "A caller";
  if (s.outcome === "spam") return `Spam call: ${s.spam?.reason ?? "telemarketer"}. No lead taken.`;
  if (s.outcome === "blocked") return "";
  const what = s.slots.need || sc.title;
  if (s.alerts.length) return `${who} called: ${what}. Escalated (${s.alerts.map((a) => a.kind).join(", ")}).`;
  if (s.submitted) return `${who} requested an estimate: ${what}${s.slots.address ? ` at ${s.slots.address}` : ""}.`;
  return `${who} called: ${what}. Outcome: ${s.outcome}.`;
}

export function callFixture(sc: Scenario, s: CallState, compiled: CompiledProfile, opts: { to?: string; startedAt?: string; model?: string } = {}): CallFixture {
  const base = new Date(opts.startedAt ?? "2026-10-06T17:30:00Z");
  const callSid = `CAtest${sc.id.replace(/[^a-z0-9]/gi, "").slice(0, 26)}`;
  const to = opts.to ?? "+13605550199";
  const start: CallStartBody = {
    callSid, to, from: sc.caller, startedAt: iso(base, 0), engine: "constructhub-voice", model: opts.model ?? "truthcode-api",
    persona: compiled.persona.id, profileVersion: compiled.version,
  };
  // Mid-call deliveries, in decision order, with the slots known at that moment (spam calls deliver nothing).
  const events: CallEventBody[] = [];
  const running: Record<string, string> = {};
  let leadSent = false;
  for (const e of s.events) {
    if (e.type !== "decision" || !e.decision) continue;
    for (const [k, v] of Object.entries(e.decision.slots ?? {})) if (v.trim()) running[k] = v.trim();
    if (s.spamFlagged) continue;
    if (e.decision.action === "alert" && e.decision.alert) events.push({ type: "alert", kind: e.decision.alert.kind, summary: e.decision.alert.summary, slots: { ...running } });
    if (e.decision.action === "submit_lead" && !leadSent) { leadSent = true; events.push({ type: "lead", slots: { ...running } }); }
  }
  const steps = s.transcript.length;
  const duration = Math.max(0, steps * STEP_S);
  const { address, city } = splitCity(s.slots.address ?? "");
  const report: CallReportBody = {
    endedAt: iso(base, duration),
    durationSeconds: duration,
    outcome: s.outcome ?? "info",
    summary: summaryFor(s, sc),
    transcript: s.transcript.map((l, i) => ({ role: l.role, text: l.text, t: iso(base, i * STEP_S) })),
    slots: { ...s.slots },
    events: s.events.map((e, i) => {
      const out: { t: string; type: string; [k: string]: unknown } = { t: iso(base, Math.min(duration, (i + 1) * STEP_S)), type: e.type };
      if (e.decision) out.decision = e.decision;
      if (e.detail) out.detail = e.detail;
      return out;
    }),
    caller: { name: s.slots.first_name ?? "", email: s.slots.email ?? "", address, city },
    serviceNeeded: s.slots.need ?? "",
  };
  if (s.spam && s.spamFlagged) report.spam = { ...s.spam };
  if (s.submitted) report.lead = { requested: true };
  if (s.alerts.length) report.alerts = s.alerts.map((a) => ({ ...a }));
  return { scenario: sc.id, callSid, start, events, report };
}

/** The pre-answer `blocked` call the engine reports when the app says caller.blocked (SPEC.md § 1 step 3). */
export function blockedFixture(sc: Scenario, compiled: CompiledProfile, opts: { to?: string; startedAt?: string } = {}): CallFixture {
  const at = new Date(opts.startedAt ?? "2026-10-06T17:30:00Z").toISOString().replace(/\.\d{3}Z$/, "Z");
  const callSid = `CAtest${sc.id.replace(/[^a-z0-9]/gi, "").slice(0, 26)}`;
  return {
    scenario: sc.id, callSid,
    start: { callSid, to: opts.to ?? "+13605550199", from: sc.caller, startedAt: at, engine: "constructhub-voice", model: "", persona: compiled.persona.id, profileVersion: compiled.version },
    events: [],
    report: {
      endedAt: at, durationSeconds: 0, outcome: "blocked", summary: "", transcript: [], slots: {}, events: [{ t: at, type: "blocked" }],
      caller: { name: "", email: "", address: "", city: "" }, serviceNeeded: "",
    },
  };
}
