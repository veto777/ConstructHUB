"""Scripted calls — the Python reader of voice/tests/scenarios/*.txt.

Twin of server/voice/fixtures/scenarios.ts; keep the grammar identical:

  #! key: value          directive (id, title, tags, caller, clock, mode, prelude, expect.*)
  # anything             comment
  Hi, I need new siding  a caller line
  => {"say": ...}        the CANNED decision for the caller line above (mocked brain; live mode ignores it)
  <silence>              the caller says nothing for silencePromptSeconds
  <hangup>               the caller hangs up
  <whisper> text         a CallRail-style whisper in the first seconds (audio mode only)
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"


@dataclass
class SayMatcher:
    source: str
    test: Callable[[str], bool]


def say_matcher(source: str) -> SayMatcher:
    """`/regex/flags` → case-insensitive regex search; anything else → case-insensitive substring."""
    src = source.strip()
    m = re.match(r"^/(.+)/([a-z]*)$", src)
    if m:
        rx = re.compile(m.group(1), re.I)   # the scenario regexes use the JS/Python common subset
        return SayMatcher(src, lambda s: bool(rx.search(s)))
    needle = src.lower()
    return SayMatcher(src, lambda s: needle in s.lower())


@dataclass
class SlotCheck:
    key: str
    op: str   # ~ = !~ ?
    value: str


def parse_slot_check(spec: str) -> SlotCheck:
    m = re.match(r"^([a-z][a-z0-9_]*)\s*(!~|~|=|\?)\s*(.*)$", spec.strip())
    if not m:
        raise ValueError(f'bad expect.slot "{spec}" (use key ~ text | key = text | key !~ text | key ?)')
    return SlotCheck(m.group(1), m.group(2), m.group(3).strip())


@dataclass
class Line:
    kind: str                  # text | silence | hangup | whisper
    text: str = ""
    canned: str | None = None


@dataclass
class Expect:
    outcome: list[str] | None = None
    actions: list[str] = field(default_factory=list)
    never: list[str] = field(default_factory=list)
    slots: list[SlotCheck] = field(default_factory=list)
    say_never: list[SayMatcher] = field(default_factory=list)
    say_any: list[SayMatcher] = field(default_factory=list)
    say_once: list[SayMatcher] = field(default_factory=list)
    say_last: SayMatcher | None = None
    caller_never: list[SayMatcher] = field(default_factory=list)
    ended: bool | None = None
    max_turns: int | None = None
    alert: list[str] | None = None
    spam_min: float | None = None
    twiml: str | None = None
    notify: str | None = None
    lead: bool | None = None


@dataclass
class Scenario:
    id: str
    file: str
    title: str = ""
    tags: list[str] = field(default_factory=list)
    caller: str = "+13605550123"
    clock: str = ""
    mode: str = "sim"          # sim | audio | webhook
    prelude: list[tuple[str, int]] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    expect: Expect = field(default_factory=Expect)

    def spoken_lines(self) -> list[Line]:
        return [l for l in self.lines if l.kind in ("text", "silence")]


def _words(v: str) -> list[str]:
    return [w for w in re.split(r"[\s,]+", v.strip()) if w]


def parse_scenario(text: str, file: str = "<inline>") -> Scenario:
    sc = Scenario(id=re.sub(r"\.txt$", "", re.sub(r"^\d+-", "", Path(file).name)), file=file)
    last: Line | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#!"):
            m = re.match(r"^\s*([a-z_.]+)\s*:\s*(.*)$", line[2:], re.I)
            if not m:
                raise ValueError(f'{file}: bad directive "{line}"')
            key, value = m.group(1).lower(), m.group(2).strip()
            e = sc.expect
            if key == "id": sc.id = value
            elif key == "title": sc.title = value
            elif key == "tags": sc.tags = _words(value)
            elif key == "caller": sc.caller = value
            elif key == "clock": sc.clock = value
            elif key == "mode": sc.mode = value
            elif key == "prelude":
                for p in value.split(","):
                    pm = re.match(r"^([a-z0-9_-]+)(?:\s*x\s*(\d+))?$", p.strip(), re.I)
                    if not pm:
                        raise ValueError(f'{file}: bad prelude "{p}"')
                    sc.prelude.append((pm.group(1), int(pm.group(2) or 1)))
            elif key == "expect.outcome": e.outcome = [s.strip() for s in value.split("|") if s.strip()]
            elif key == "expect.actions": e.actions += _words(value)
            elif key == "expect.never": e.never += _words(value)
            elif key == "expect.slot": e.slots.append(parse_slot_check(value))
            elif key == "expect.say_never": e.say_never.append(say_matcher(value))
            elif key == "expect.say_any": e.say_any.append(say_matcher(value))
            elif key == "expect.say_once": e.say_once.append(say_matcher(value))
            elif key == "expect.say_last": e.say_last = say_matcher(value)
            elif key == "expect.caller_never": e.caller_never.append(say_matcher(value))
            elif key == "expect.ended": e.ended = value == "true"
            elif key == "expect.max_turns": e.max_turns = int(value)
            elif key == "expect.alert": e.alert = _words(value)
            elif key == "expect.spam_min": e.spam_min = float(value)
            elif key == "expect.twiml": e.twiml = value
            elif key == "expect.notify": e.notify = value
            elif key == "expect.lead": e.lead = value == "true"
            else:
                raise ValueError(f'{file}: unknown directive "{key}"')
            continue
        if line.startswith("#"):
            continue
        if line.startswith("=>"):
            if last is None or last.kind not in ("text", "silence"):
                raise ValueError(f"{file}: canned decision without a caller line: {line}")
            if last.canned is not None:
                raise ValueError(f"{file}: two canned decisions for one caller line: {line}")
            body = line[2:].strip()
            json.loads(body)   # must be valid JSON; the protocol check happens in the tests
            last.canned = body
            continue
        if line == "<silence>":
            last = Line("silence")
        elif line == "<hangup>":
            last = Line("hangup")
        elif line.startswith("<whisper>"):
            last = Line("whisper", line[len("<whisper>"):].strip())
        else:
            last = Line("text", line)
        sc.lines.append(last)
    if not sc.lines and sc.mode != "webhook":
        raise ValueError(f"{file}: no caller lines")
    sc.title = sc.title or sc.id
    return sc


def load_scenarios(directory: Path = SCENARIO_DIR) -> list[Scenario]:
    return [parse_scenario(p.read_text(encoding="utf-8"), str(p)) for p in sorted(directory.glob("*.txt"))]


def load_scenario(path_or_id: str, directory: Path = SCENARIO_DIR) -> Scenario:
    p = Path(path_or_id)
    if p.suffix == ".txt" and p.exists():
        return parse_scenario(p.read_text(encoding="utf-8"), str(p))
    for sc in load_scenarios(directory):
        if sc.id == path_or_id:
            return sc
    raise KeyError(f'unknown scenario "{path_or_id}"')
