#!/usr/bin/env python3
"""Text simulator: talk to the Call Assistant's brain without a phone, against a compiled-profile JSON.

  python sim.py                                                         interactive, fixture profile
  python sim.py --profile ../server/voice/fixtures/compiled.v1.json --script tests/scenarios/01-routine_lead.txt
  python sim.py --scenario routine_lead --canned                         replay the canned decisions (no model)
  python sim.py --script my-call.txt --json                              machine-readable transcript + report

Scripts: either a scenario file (voice/tests/scenarios/*.txt — directives, `=>` canned decisions and the
rubric, which is then scored) or plain caller lines, one per row; `#` comments; `(silence)` / `<silence>` is
a silent turn and `<hangup>` hangs up. The brain is the engine's own (brain.py + decision.py), so this is the
exact logic a caller gets — minus audio.

DRY RUN ALWAYS: nothing is posted to the app; mid-call lead/alert deliveries are printed instead.
Provider: --canned, or the one in voice/.env (VOICE_AI_PROVIDER + AI_* — ConstructHUB's own values).
Exit code 0 when every turn validated (no fallback line) and, for a scenario, its rubric passed."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "tests"))

from harness.engine import CannedProvider, load_compiled, load_engine, run_brain  # noqa: E402
from harness.scenarios import Line, Scenario, load_scenario, parse_scenario  # noqa: E402
from harness.scoring import format_scorecard  # noqa: E402


def read_script(path: str, caller: str) -> Scenario:
    text = Path(path).read_text(encoding="utf-8")
    if any(l.strip().startswith(("#!", "=>")) for l in text.splitlines()):
        return parse_scenario(text, path)
    sc = Scenario(id=Path(path).stem, file=path, caller=caller)
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        sc.lines.append(Line("silence") if s in ("(silence)", "<silence>") else Line("hangup") if s == "<hangup>" else Line("text", s))
    sc.title = sc.id
    return sc


async def interactive(compiled: dict, caller: str, timezone: str, as_json: bool) -> int:
    brain_mod, _ = load_engine()

    async def on_event(payload: dict) -> dict:
        print(f"   [dry run: would deliver → app] {json.dumps(payload, ensure_ascii=False)[:300]}")
        return {"delivered": "DRY RUN"}

    b = brain_mod.Brain(compiled, caller, on_event=on_event, timezone=timezone)
    print(f"[{b.assistant} · voice {b.voice} · model {b.model_name or '?'}]  (empty line = silence, Ctrl-D = hang up)")
    print("AI:", await b.greet())
    fallbacks = 0
    while not b.end_requested:
        try:
            text = input("CALLER: ")
        except EOFError:
            break
        d = await b.respond(text, silence=not text.strip())
        fallbacks += int(bool(getattr(d, "fallback", False)))
        tag = "" if d.action == "continue" else f"   [{d.action}" + (f" {d.alert}" if d.alert else "") + (f" {d.spam}" if d.spam else "") + (f" outcome={d.outcome}" if d.outcome else "") + "]"
        print("AI:", d.say or "(hangs up)", tag)
    await b.finish()
    flush = getattr(b, "flush_deliveries", None)
    if flush:
        await flush()
    report = await b.report()
    if as_json:
        print(json.dumps({"transcript": b.transcript, "report": report, "fallbacks": fallbacks}, ensure_ascii=False, indent=2))
    else:
        print("\nOUTCOME:", report["outcome"])
        print("SLOTS:", json.dumps(report["slots"], ensure_ascii=False))
        print("SUMMARY:", report["summary"])
    return 1 if fallbacks else 0


async def run(a: argparse.Namespace) -> int:
    compiled = load_compiled(a.profile)
    if not a.script and not a.scenario:
        if a.canned:
            print("--canned needs --script or --scenario", file=sys.stderr)
            return 2
        return await interactive(compiled, a.caller, a.timezone, a.json)
    sc = load_scenario(a.scenario) if a.scenario else read_script(a.script, a.caller)
    if a.caller_set:
        sc.caller = a.caller
    if sc.mode == "audio":
        print(f"note: {sc.id} is an audio scenario; its whisper lines are skipped here (use tests/fake_signalwire.py)")
        sc.mode = "sim"
    provider = CannedProvider(sc) if a.canned else None
    card, r = await run_brain(sc, compiled, provider, timezone=a.timezone)
    if a.json:
        print(json.dumps({"scenario": sc.id, "transcript": r.transcript, "outcome": r.outcome, "slots": r.slots, "actions": r.actions,
                          "alerts": r.alerts, "spam": r.spam, "lead": r.lead, "ended": r.ended, "errors": r.errors,
                          "score": {"ok": card.ok, "failures": card.failures()}}, ensure_ascii=False, indent=2))
    else:
        print("\n".join(r.transcript))
        has_rubric = len(card.checks) > 1
        if has_rubric:
            print("\n" + format_scorecard([card], "sim.py · " + ("canned" if a.canned else "provider from voice/.env")))
    return 0 if card.ok else 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", help="compiled profile JSON (CompiledProfile, or a saved /profile response); default: the harness fixture")
    ap.add_argument("--script", help="scenario file or plain caller lines")
    ap.add_argument("--scenario", help="a scenario id from tests/scenarios/")
    ap.add_argument("--canned", action="store_true", help="answer with the scenario's canned decisions (no model)")
    ap.add_argument("--caller", default="+13605550123", help="caller-id number (E.164)")
    ap.add_argument("--timezone", default="America/Los_Angeles")
    ap.add_argument("--json", action="store_true", help="print the transcript + report as JSON")
    a = ap.parse_args()
    a.caller_set = "--caller" in sys.argv
    sys.exit(asyncio.run(run(a)))


if __name__ == "__main__":
    main()
