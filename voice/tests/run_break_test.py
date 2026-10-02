#!/usr/bin/env python3
"""The owner's break test — scorecard for every scripted call in voice/tests/scenarios/.

  python tests/run_break_test.py                          engine brain + canned decisions (no model, no network)
  python tests/run_break_test.py --live                   engine brain + the provider in voice/.env (real model)
  python tests/run_break_test.py --endpoint http://127.0.0.1:8200
                                                          the app's /api/crm/voice/simulator/* (dev server,
                                                          DEV_AUTH_BYPASS_USER1=true, org holds the add-on)
  options: --only id,id · --tag injection · --compiled path · -v (all transcripts) · --json

Audio (the real media path, synthetic caller voice): tests/fake_signalwire.py.
VOICE_ENGINE_DIR=<another checkout's voice/> runs that engine's brain (e.g. the engine lane before it merges).
Exit 0 when every scenario that ran passed."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from harness.engine import CannedProvider, EngineUnavailable, load_compiled, run_all  # noqa: E402
from harness.scenarios import Scenario, load_scenarios  # noqa: E402
from harness.scoring import Card, RunResult, format_scorecard, score  # noqa: E402


# ── endpoint mode: the app's simulator (SPEC § 6) ─────────────────────────────────────────────────

def _http(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", "X-Requested-With": "break-test"})
    with urllib.request.urlopen(req, timeout=120) as r:   # noqa: S310 — a URL the operator passed
        return json.loads(r.read() or b"{}")


def run_endpoint(sc: Scenario, base: str) -> tuple[Card, RunResult]:
    r = RunResult()
    start = _http("POST", f"{base}/api/crm/voice/simulator/session", {"useDraft": True, "callerNumber": sc.caller})
    sid = start["sessionId"]
    r.transcript.append(f"AI: {start.get('greeting', '')}")
    last: dict = {}
    try:
        for line in sc.lines:
            if line.kind == "whisper":
                continue
            if line.kind == "hangup":
                r.ended, r.end_reason = True, "carrier_stop"
                break
            silence = line.kind == "silence"
            body = {"sessionId": sid, "text": "(silence)", "silence": True} if silence else {"sessionId": sid, "text": line.text}
            last = _http("POST", f"{base}/api/crm/voice/simulator/turn", body)
            if not silence:
                r.caller_lines.append(line.text)
            r.assistant_turns += 1
            r.actions.append(last.get("action", "continue"))
            if last.get("say"):
                r.says.append(last["say"])
            r.slots.update({k: str(v) for k, v in (last.get("slots") or {}).items() if v})
            if last.get("alert"):
                r.alerts.append(last["alert"])
            if last.get("spam"):
                r.spam = last["spam"]
            if last.get("fallback"):
                r.errors.append(f"turn {r.assistant_turns}: fallback line")
            r.transcript += [f"CALLER: {'<silence>' if silence else line.text}", f"AI: {last.get('say', '')}  [{last.get('action')}]"]
            if last.get("ended"):
                r.ended, r.end_reason = True, "engine"
                break
    finally:
        end = {}
        try:
            end = _http("DELETE", f"{base}/api/crm/voice/simulator/session/{sid}")
        except Exception:  # noqa: BLE001
            pass
    rep = end.get("report") or end
    r.outcome = rep.get("outcome") or last.get("outcome")
    r.slots.update({k: str(v) for k, v in (rep.get("slots") or {}).items() if v})
    r.lead = r.outcome == "lead_submitted" or "submit_lead" in r.actions
    r.notifications = sum(1 for a in r.actions if a in ("submit_lead", "alert")) if r.outcome != "spam" else 0
    if not r.ended:
        r.end_reason = "script_end"
    return score(sc, r), r


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="use the engine's configured provider (voice/.env) — costs tokens")
    ap.add_argument("--endpoint", help="app base URL: run through /api/crm/voice/simulator/*")
    ap.add_argument("--compiled", help="compiled profile JSON (default server/voice/fixtures/compiled.v1.json)")
    ap.add_argument("--only", help="comma-separated scenario ids")
    ap.add_argument("--tag", help="only scenarios with this tag")
    ap.add_argument("-v", action="store_true", help="print every transcript")
    ap.add_argument("--json", action="store_true", help="machine-readable cards")
    a = ap.parse_args()

    scenarios = load_scenarios()
    only = set(a.only.split(",")) if a.only else None
    pick = lambda sc: (not only or sc.id in only) and (not a.tag or a.tag in sc.tags)  # noqa: E731

    def show(card: Card, r: RunResult) -> None:
        if not a.json and (a.v or not card.ok):
            print(f"\n── {card.id} ──\n" + "\n".join(r.transcript))

    if a.endpoint:
        base = a.endpoint.rstrip("/")
        results = []
        for sc in scenarios:
            if pick(sc) and sc.mode == "sim":
                card, r = run_endpoint(sc, base)
                show(card, r)
                results.append((card, r))
        label = f"endpoint {base}"
    else:
        compiled = load_compiled(a.compiled)
        try:
            results = await run_all(scenarios, compiled, (lambda sc: None) if a.live else (lambda sc: CannedProvider(sc)), only=pick, on_result=show)
        except EngineUnavailable as e:
            print(f"engine not available: {e}", file=sys.stderr)
            return 2
        label = "engine brain + " + ("live provider (voice/.env)" if a.live else "canned decisions")
    cards = [c for c, _ in results]
    if a.json:
        print(json.dumps([{"id": c.id, "ok": c.ok, "skipped": c.skipped, "failures": c.failures()} for c in cards], indent=2))
    else:
        print("\n" + format_scorecard(cards, label))
    return 0 if all(c.ok for c in cards) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
