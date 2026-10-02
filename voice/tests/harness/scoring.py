"""Scores one scenario run against its rubric. Twin of server/voice/fixtures/scorer.ts — same checks, same names."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .scenarios import Scenario


@dataclass
class RunResult:
    """What a run produced, whatever drove it (engine Brain, the app's simulator, or a real media stream)."""
    outcome: str | None = None
    actions: list[str] = field(default_factory=list)       # actions as applied (after the engine's enforcement)
    slots: dict[str, str] = field(default_factory=dict)
    says: list[str] = field(default_factory=list)          # assistant lines after the greeting
    caller_lines: list[str] = field(default_factory=list)  # what the engine heard (transcript, caller role)
    ended: bool = False                                    # the CALL ended (not the script running out)
    end_reason: str = ""
    assistant_turns: int = 0
    alerts: list[dict[str, Any]] = field(default_factory=list)
    spam: dict[str, Any] | None = None
    twiml: str | None = None
    notifications: int = 0                                 # lead/alert deliveries the app would notify on
    lead: bool = False
    forced: bool = False
    errors: list[str] = field(default_factory=list)
    transcript: list[str] = field(default_factory=list)    # human-readable, for failures


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Card:
    id: str
    title: str
    checks: list[Check] = field(default_factory=list)
    skipped: str = ""

    @property
    def passed(self) -> int:
        return sum(1 for c in self.checks if c.ok)

    @property
    def ok(self) -> bool:
        return bool(self.skipped) or all(c.ok for c in self.checks)

    def failures(self) -> list[str]:
        return [f"{c.name}" + (f" ({c.detail})" if c.detail else "") for c in self.checks if not c.ok]


def score(sc: Scenario, r: RunResult) -> Card:
    e, card = sc.expect, Card(sc.id, sc.title)
    add = lambda name, ok, detail="": card.checks.append(Check(name, bool(ok), detail))  # noqa: E731
    acts = ",".join(r.actions) or "-"
    if e.outcome:
        add("outcome", (r.outcome or "") in e.outcome, f"got {r.outcome} want {'|'.join(e.outcome)}")
    for a in e.actions:
        add(f"action {a}", a in r.actions, f"actions: {acts}")
    for a in e.never:
        add(f"never {a}", a not in r.actions, f"actions: {acts}")
    for c in e.slots:
        v = str(r.slots.get(c.key, "") or "")
        if c.op == "?":
            ok = bool(v.strip())
        elif c.op == "=":
            ok = v.strip().lower() == c.value.lower()
        elif c.op == "~":
            ok = c.value.lower() in v.lower()
        else:
            ok = c.value.lower() not in v.lower()
        add(f"slot {c.key} {c.op} {c.value}".strip(), ok, f'got "{v}"')
    for m in e.say_never:
        hit = next((x for x in r.says if m.test(x)), None)
        add(f"say_never {m.source}", hit is None, f'said: "{hit}"' if hit else "")
    for m in e.say_any:
        add(f"say_any {m.source}", any(m.test(x) for x in r.says), f'last: "{r.says[-1]}"' if r.says else "no assistant lines")
    for m in e.say_once:
        n = sum(1 for x in r.says if m.test(x))
        add(f"say_once {m.source}", n == 1, f"matched {n} assistant lines")
    if e.say_last:
        add(f"say_last {e.say_last.source}", bool(r.says) and e.say_last.test(r.says[-1]), f'last: "{r.says[-1] if r.says else ""}"')
    for m in e.caller_never:
        hit = next((x for x in r.caller_lines if m.test(x)), None)
        add(f"caller_never {m.source}", hit is None, f'transcript has: "{hit}"' if hit else "")
    if e.ended is not None:
        add("ended", r.ended == e.ended, f"ended={r.ended} ({r.end_reason or '-'})")
    if e.max_turns is not None:
        add(f"max_turns {e.max_turns}", r.assistant_turns <= e.max_turns, f"assistant turns: {r.assistant_turns}")
    if e.alert:
        kinds = [a.get("kind") for a in r.alerts]
        for k in e.alert:
            add(f"alert {k}", k in kinds, f"alerts: {','.join(map(str, kinds)) or '-'}")
    if e.spam_min is not None:
        conf = float((r.spam or {}).get("confidence") or 0)
        add(f"spam_min {e.spam_min}", conf >= e.spam_min, f"spam: {r.spam or '-'}")
    if e.twiml:
        add(f"twiml {e.twiml}", e.twiml in (r.twiml or ""), f"twiml: {r.twiml or '-'}")
    if e.notify:
        want = {"none": r.notifications == 0, "one": r.notifications == 1}.get(e.notify, r.notifications > 0)
        add(f"notify {e.notify}", want, f"notifications: {r.notifications}")
    if e.lead is not None:
        add(f"lead {str(e.lead).lower()}", r.lead == e.lead, f"lead={r.lead}{' (forced)' if r.forced else ''}")
    add("no protocol errors", not r.errors, " | ".join(r.errors))
    return card


def skipped(sc: Scenario, why: str) -> Card:
    return Card(sc.id, sc.title, skipped=why)


def format_scorecard(cards: list[Card], label: str) -> str:
    w = max([10] + [len(c.id) for c in cards])
    out = [f"Break test — {label}"]
    for c in cards:
        mark = "SKIP" if c.skipped else "PASS" if c.ok else "FAIL"
        out.append(f"  {mark}  {c.id.ljust(w)}  {c.skipped or f'{c.passed}/{len(c.checks)}'}")
        out += [f"        - {f}" for f in c.failures()]
    ran = [c for c in cards if not c.skipped]
    out.append(f"  {sum(1 for c in ran if c.ok)}/{len(ran)} scenarios pass, {len(cards) - len(ran)} skipped")
    return "\n".join(out)
