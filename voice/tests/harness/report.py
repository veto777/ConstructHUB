"""The engine's end-of-call report (PUT /api/voice-internal/calls/:sid, SPEC § 5) → a scorable RunResult.

Used by fake_signalwire.py: on the real media path the harness cannot see the brain's decisions directly, so it
scores what the engine REPORTED (transcript, slots, events, outcome) plus what the fake app received mid-call."""
from __future__ import annotations

from typing import Any

from .scoring import RunResult


def actions_from_events(events: list[dict[str, Any]]) -> list[str]:
    """Applied actions: the brain's `decision` events, minus the ones the engine overruled
    (end_call_refused → that end_call did not happen; spam_ignored → that flag_spam did not happen)."""
    out: list[str] = []
    for e in events:
        t = e.get("type")
        if t == "decision":
            out.append(((e.get("decision") or {}).get("action")) or "continue")
        elif t in ("end_call_refused", "spam_ignored"):
            want = "end_call" if t == "end_call_refused" else "flag_spam"
            for i in range(len(out) - 1, -1, -1):
                if out[i] == want:
                    out[i] = "continue"
                    break
    return out


def result_from_report(report: dict[str, Any] | None, mid_call_events: list[dict[str, Any]], *, ended_by_engine: bool,
                       end_reason: str, twiml: str | None = None) -> RunResult:
    r = RunResult(twiml=twiml, ended=ended_by_engine, end_reason=end_reason)
    if not report:
        r.errors.append("no end-of-call report reached the app")
        return r
    transcript = report.get("transcript") or []
    assistant = [t.get("text", "") for t in transcript if t.get("role") == "assistant"]
    r.says = assistant[1:] if assistant else []          # the first assistant line is the greeting
    r.caller_lines = [t.get("text", "") for t in transcript if t.get("role") == "caller"]
    r.assistant_turns = len(r.says)
    r.outcome = report.get("outcome")
    r.slots = {k: str(v) for k, v in (report.get("slots") or {}).items() if v not in (None, "")}
    events = report.get("events") or []
    r.actions = actions_from_events(events)
    if ended_by_engine and end_reason == "engine" and "end_call" not in r.actions:
        r.actions.append("end_call")      # the engine's own hang-up (second silence, caps) logs no model decision
    r.alerts = list(report.get("alerts") or [])
    r.spam = report.get("spam")
    r.lead = bool((report.get("lead") or {}).get("requested")) or r.outcome == "lead_submitted"
    r.forced = any(e.get("type") == "forced_lead" for e in events)
    # what the app would notify on: mid-call deliveries, or the report's lead/alerts when nothing came mid-call
    r.notifications = sum(1 for e in mid_call_events if e.get("type") in ("lead", "alert"))
    if not r.notifications and r.outcome != "spam":
        r.notifications = (1 if r.lead else 0) + len(r.alerts)
    for e in events:
        if e.get("type") == "error":
            r.errors.append(f"engine error event: {str(e)[:200]}")
        if e.get("type") == "decision" and (e.get("decision") or {}).get("fallback"):
            r.errors.append("fallback line used")
    for t in transcript:
        r.transcript.append(f"{t.get('role', '?').upper()}: {t.get('text', '')}")
    return r
