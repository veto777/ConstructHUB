#!/usr/bin/env python3
"""Text simulator: talk to the Call Assistant's brain without a phone, against a compiled-profile JSON.

  python sim.py --profile tests/profiles/sample.json                       interactive
  python sim.py --profile tests/profiles/sample.json --script tests/scripts/booking.txt
  python sim.py ... --json                                                  machine-readable transcript + report

Scripts: one caller line per row; lines starting with # are comments; a row that is exactly "(silence)" is a
silence prompt. Dry run always: nothing is posted to the app (mid-call lead/alert events are printed instead).
Uses the provider in voice/.env (VOICE_AI_PROVIDER + AI_* — ConstructHUB's own values, never another project's).
Exit code 0 when the model answered every turn without a fallback, 1 otherwise (for the harness)."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from brain import Brain  # noqa: E402


def load_script(path: str) -> list[str]:
    lines = []
    for raw in open(path, encoding="utf-8"):
        s = raw.strip()
        if s and not s.startswith("#"):
            lines.append(s)
    return lines


async def run(args: argparse.Namespace) -> int:
    compiled = json.load(open(args.profile, encoding="utf-8"))
    if "compiled" in compiled and "systemPrompt" not in compiled:   # a /profile response was saved instead
        compiled = compiled["compiled"]

    async def on_event(payload: dict) -> dict:
        if not args.json:
            print(f"   [event → app] {json.dumps(payload, ensure_ascii=False)[:300]}")
        return {"delivered": "DRY RUN"}

    b = Brain(compiled, args.caller, on_event=on_event, timezone=args.timezone, dry_run=False)
    b.on_event = on_event
    out = lambda *a: None if args.json else print(*a)  # noqa: E731
    out(f"[{b.assistant} · voice {b.voice} · model {b.model_name or '?'}]")
    out("AI:", await b.greet())
    script = load_script(args.script) if args.script else None
    fallbacks = 0
    while not b.end_requested:
        if script is not None:
            if not script:
                break
            text = script.pop(0)
            out("CALLER:", text)
        else:
            try:
                text = input("CALLER: ")
            except EOFError:
                break
        d = await b.respond(text if text != "(silence)" else "", silence=(text == "(silence)"))
        if d.fallback:
            fallbacks += 1
        tag = "" if d.action == "continue" else f"   [{d.action}" + (f" {d.alert}" if d.alert else "") + (f" {d.spam}" if d.spam else "") + (f" outcome={d.outcome}" if d.outcome else "") + "]"
        out("AI:", d.say or "(hangs up)", tag)
        if b.end_requested:
            out(f"   [call ended: {b.final_outcome()}]")
    await b.finish()   # force-submit safety net + wait for deliveries (idempotent)
    report = await b.report()
    if args.json:
        print(json.dumps({"transcript": b.transcript, "report": report, "fallbacks": fallbacks}, ensure_ascii=False, indent=2))
    else:
        print("\nOUTCOME:", report["outcome"])
        print("SLOTS:", json.dumps(report["slots"], ensure_ascii=False))
        print("SUMMARY:", report["summary"])
        errs = [e for e in b.events if e["type"] in ("error", "invalid_decision", "end_call_refused")]
        for e in errs:
            print("   [note]", json.dumps(e, ensure_ascii=False)[:300])
    return 1 if fallbacks else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True, help="compiled profile JSON (CompiledProfile)")
    ap.add_argument("--script", help="scripted caller lines (tests/scripts/*.txt)")
    ap.add_argument("--caller", default="+13605550123", help="caller-id number (E.164)")
    ap.add_argument("--timezone", default="America/Los_Angeles")
    ap.add_argument("--json", action="store_true", help="print the transcript + end-of-call report as JSON")
    sys.exit(asyncio.run(run(ap.parse_args())))


if __name__ == "__main__":
    main()
