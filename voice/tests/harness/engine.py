"""Drive the ENGINE's own brain (voice/brain.py + voice/decision.py) through a scripted call.

The harness never re-implements the engine's rules in Python: it imports the engine modules and scores what
they do. `VOICE_ENGINE_DIR` points at another checkout's voice/ (e.g. the engine lane's worktree before it
merges); default = this checkout's voice/.

  CannedProvider   replays a scenario's `=>` decisions through the engine's provider interface
                   (decide/text/model_name), wrapped in fences / <think> / tool-call markup so the engine's
                   parser is exercised; answers the engine's forced-submit and summary prompts too.
  run_brain()      one scenario → RunResult (scoring.py), the same rules the TypeScript runner scores.
  run_all()        every scenario in order, preludes first (feeds the spam ledger for the webhook scenario).
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .scenarios import Scenario
from .scoring import Card, RunResult, score, skipped

VOICE_DIR = Path(__file__).resolve().parents[2]


class EngineUnavailable(RuntimeError):
    pass


def engine_dir() -> Path:
    return Path(os.environ.get("VOICE_ENGINE_DIR") or VOICE_DIR).resolve()


def load_engine() -> tuple[Any, Any]:
    """(brain module, decision module) from the engine checkout, or EngineUnavailable with the reason."""
    d = engine_dir()
    if not (d / "brain.py").exists() or not (d / "decision.py").exists():
        raise EngineUnavailable(f"no engine at {d} (brain.py/decision.py missing — set VOICE_ENGINE_DIR to the engine's voice/)")
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
    try:
        return importlib.import_module("brain"), importlib.import_module("decision")
    except Exception as e:  # noqa: BLE001
        raise EngineUnavailable(f"engine import failed from {d}: {type(e).__name__}: {e}") from e


WRAPPERS = [
    lambda j: j,
    lambda j: "```json\n" + j + "\n```",
    lambda j: "<think>The caller answered; next I ask the following intake question.</think>\n" + j,
    lambda j: "Here is my decision:\n" + j + "\nLet me know if you need anything else.",
    lambda j: '<tool_call><function=web_research>{"q":"siding"}</function></tool_call>\n' + j,
]
FORCED_MARK = "no lead was submitted"
IDLE_REPLY = json.dumps({"say": "Is there anything else I can help you with?", "action": "continue", "slots": {}})


def _slots_from_prompt(system: str) -> dict[str, str]:
    """The engine's runtime block says "Slots so far: {…}." — used when the harness does not hold the Brain
    (audio runs, where the server creates it)."""
    import re
    m = re.search(r"Slots so far: (\{.*?\})\. ", system or "")
    try:
        return json.loads(m.group(1)) if m else {}
    except ValueError:
        return {}


class CannedProvider:
    """The engine's provider interface, answering from a scenario's canned decisions.

    Line selection: `pin(i)` before a turn (text runs know which caller line is being answered); otherwise
    the next canned decision in order (audio runs, where the engine decides when a turn happens)."""

    model_name = "canned"

    def __init__(self, sc: Scenario, wrap: bool = True):
        self.canned = [l.canned or IDLE_REPLY for l in sc.spoken_lines()]
        self.wrap = wrap
        self.next_index = 0
        self.pinned: int | None = None
        self.last = IDLE_REPLY
        self.calls: list[str] = []          # "line N" / "retry" / "forced" / "idle"
        self.slots: dict[str, str] | None = None   # the brain's slots (run_brain wires it) for the forced-submit answer

    def pin(self, index: int | None) -> None:
        self.pinned = index

    async def decide(self, system: str, messages: list[dict[str, str]], temperature: float = 0.3, max_tokens: int = 400) -> str:
        last_user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        if FORCED_MARK in last_user:
            # what a sane model answers to the engine's forced-submit prompt: submit when there is a request or an
            # address to file, otherwise a short "other" alert so the office can call back
            self.calls.append("forced")
            slots = self.slots if self.slots is not None else _slots_from_prompt(system)
            if slots.get("need") or slots.get("address"):
                return json.dumps({"say": "", "action": "submit_lead", "slots": {}})
            return json.dumps({"say": "", "action": "alert", "alert": {"kind": "other", "summary": "Call ended before a request was given; caller may need a call back."}, "slots": {}})
        if last_user.startswith("Reply with only"):
            self.calls.append("retry")
            return self.last
        idx = self.pinned if self.pinned is not None else self.next_index
        self.next_index = idx + 1
        self.pinned = None
        if idx >= len(self.canned):
            self.calls.append("idle")
            self.last = IDLE_REPLY
            return IDLE_REPLY
        self.calls.append(f"line {idx + 1}")
        raw = self.canned[idx]
        self.last = WRAPPERS[idx % len(WRAPPERS)](raw) if self.wrap else raw
        return self.last

    async def text(self, prompt: str, max_tokens: int = 200, temperature: float = 0.2) -> str:
        return "Canned summary: the harness replayed a scripted call."


@dataclass
class Ledger:
    """Per-org spam ledger as the app keeps it (SPEC § 12): a strike per call with confidence ≥ strikeAt; 2 = blocked."""
    strike_at: float = 0.95
    strikes: dict[str, int] = field(default_factory=dict)

    def record(self, caller: str, r: RunResult) -> None:
        if r.spam and float(r.spam.get("confidence") or 0) >= self.strike_at:
            self.strikes[caller] = self.strikes.get(caller, 0) + 1

    def blocked(self, caller: str) -> bool:
        return self.strikes.get(caller, 0) >= 2


async def run_brain(sc: Scenario, compiled: dict[str, Any], provider: Any = None, ledger: Ledger | None = None,
                    timezone: str = "America/Los_Angeles") -> tuple[Card, RunResult]:
    """One scenario through the engine's Brain. provider=None → the engine's configured provider (live)."""
    ledger = ledger or Ledger(float((compiled.get("spam") or {}).get("strikeAt", 0.95)))
    r = RunResult()
    if sc.mode == "webhook":
        blocked = ledger.blocked(sc.caller)
        r.twiml = '<Reject reason="rejected"/>' if blocked else "<Connect><Stream/></Connect>"
        r.outcome = "blocked" if blocked else None
        r.ended, r.end_reason = True, "blocked" if blocked else "not_blocked"
        r.transcript.append(f"WEBHOOK from={sc.caller} → {r.twiml}")
        return score(sc, r), r
    if sc.mode == "audio":
        return skipped(sc, "audio-only (fake_signalwire.py)"), r

    brain_mod, _ = load_engine()
    delivered: list[dict[str, Any]] = []

    async def on_event(payload: dict[str, Any]) -> dict[str, Any]:
        delivered.append(payload)
        return {"delivered": True}

    brain = brain_mod.Brain(compiled, sc.caller, provider=provider, on_event=on_event, timezone=timezone)
    if isinstance(provider, CannedProvider):
        provider.slots = brain.slots
    greeting = await brain.greet()
    r.transcript.append(f"AI: {greeting}")
    spoken = 0
    for line in sc.lines:
        if line.kind == "whisper":
            r.transcript.append(f"WHISPER: {line.text}  (audio-only; not sent)")
            continue
        if line.kind == "hangup":
            r.transcript.append("CALLER: <hangup>")
            await brain.finish()
            r.ended, r.end_reason = True, "carrier_stop"
            break
        if isinstance(provider, CannedProvider):
            provider.pin(spoken)
        spoken += 1
        silence = line.kind == "silence"
        r.transcript.append(f"CALLER: {'<silence>' if silence else line.text}")
        d = await brain.respond("" if silence else line.text, silence=silence)
        r.assistant_turns += 1
        r.actions.append(d.action)
        if d.say:
            r.says.append(d.say)
        if getattr(d, "fallback", False):
            r.errors.append(f"turn {spoken}: fallback line (the brain's reply never validated)")
        extra = " ".join(x for x in [f"alert={d.alert}" if d.alert else "", f"spam={d.spam}" if d.spam else "", f"outcome={d.outcome}" if d.outcome else ""] if x)
        r.transcript.append(f"AI: {d.say or '(silent)'}  [{d.action}{' ' + extra if extra else ''}]")
        if brain.end_requested:
            r.ended, r.end_reason = True, "engine"
            break
    if not r.ended:
        await brain.finish()
        r.end_reason = "script_end"
        r.transcript.append("(script ended; call closed by the harness)")

    flush = getattr(brain, "flush_deliveries", None)   # mid-call deliveries run in the background in the engine
    if flush:
        await flush()
    r.outcome = brain.final_outcome()
    r.slots = {k: str(v) for k, v in brain.slots.items()}
    r.alerts = list(brain.alerts)
    r.spam = dict(brain.spam) if brain.spam else None
    r.lead = bool(brain.submitted)
    r.forced = any(e.get("type") == "forced_lead" for e in brain.events)
    r.caller_lines = [t["text"] for t in brain.transcript if t.get("role") == "caller"]
    r.notifications = sum(1 for p in delivered if p.get("type") in ("lead", "alert"))
    for e in brain.events:
        if e.get("type") == "error":
            r.errors.append(f"engine error event: {json.dumps(e)[:200]}")
    r.transcript.append(f"(outcome {r.outcome}; slots {json.dumps(r.slots)}; deliveries {[p.get('type') for p in delivered]})")
    ledger.record(sc.caller, r)
    return score(sc, r), r


async def run_all(scenarios: list[Scenario], compiled: dict[str, Any], provider_for, only=None, on_result=None) -> list[tuple[Card, RunResult]]:
    """provider_for(sc) → a provider (None = the engine's live provider). Preludes run first with the scenario's caller."""
    import dataclasses
    ledger = Ledger(float((compiled.get("spam") or {}).get("strikeAt", 0.95)))
    out = []
    for sc in scenarios:
        if only and not only(sc):
            continue
        for pid, times in sc.prelude:
            pre = next((s for s in scenarios if s.id == pid), None)
            if pre is None:
                raise KeyError(f'{sc.id}: prelude "{pid}" not found')
            for _ in range(times):
                await run_brain(dataclasses.replace(pre, caller=sc.caller), compiled, provider_for(pre), ledger)
        card, r = await run_brain(sc, compiled, provider_for(sc), ledger)
        out.append((card, r))
        if on_result:
            on_result(card, r)
    return out


def load_compiled(path: str | Path | None = None) -> dict[str, Any]:
    """The compiled fixture (server/voice/fixtures/compiled.v1.json) or a saved /profile response."""
    p = Path(path) if path else VOICE_DIR.parent / "server" / "voice" / "fixtures" / "compiled.v1.json"
    j = json.loads(p.read_text(encoding="utf-8"))
    return j["compiled"] if "compiled" in j and "systemPrompt" not in j else j
