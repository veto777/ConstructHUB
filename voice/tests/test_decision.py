"""The engine's decision-protocol parser (voice/decision.py) against the shared cases.

server/voice/fixtures/decision-cases.json is the ONE list of parser cases; the TypeScript reference parser
(server/voice/break-test.test.ts) and the app's simulator brain run the same file, so all three agree on
what a valid Decision is (SPEC.md § 4).

  VOICE_ENGINE_DIR=~/ConstructHUB-voice-engine/voice voice/.venv/bin/python -m pytest voice/tests/test_decision.py
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness.engine import EngineUnavailable, load_engine

CASES = json.loads((Path(__file__).resolve().parents[2] / "server" / "voice" / "fixtures" / "decision-cases.json").read_text())["cases"]

try:
    _, decision = load_engine()
except EngineUnavailable as e:   # the engine lane's files are not on this branch yet
    pytest.skip(str(e), allow_module_level=True)


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_parse_decision_matches_the_shared_case(case):
    e = case["expect"]
    try:
        d = decision.parse_decision(case["raw"])
    except decision.DecisionError as err:
        assert not e["ok"], f"rejected ({err.reason}) but the contract says valid"
        return
    assert e["ok"], f"accepted as {d.to_json()} but the contract says invalid"
    if "action" in e:
        assert d.action == e["action"]
    if "say" in e:
        assert d.say == e["say"]
    if "slots" in e:
        assert d.slots == e["slots"]
    if "alertKind" in e:
        assert (d.alert or {}).get("kind") == e["alertKind"]
    if "outcome" in e:
        assert d.outcome == e["outcome"]
    if "spamConfidence" in e:
        assert (d.spam or {}).get("confidence") == pytest.approx(e["spamConfidence"])
    if "sayMaxLen" in e:
        assert len(d.say) <= e["sayMaxLen"]


def test_fallback_is_the_honest_line_and_flagged():
    fb = decision.fallback_decision()
    assert fb.action == "continue" and fb.fallback and "say that" in fb.say.lower()


def test_every_canned_decision_in_the_scenarios_is_valid_for_the_engine():
    from harness.scenarios import load_scenarios
    for sc in load_scenarios():
        for i, line in enumerate(sc.spoken_lines()):
            assert line.canned, f"{sc.id} line {i + 1}: no canned decision"
            decision.parse_decision(line.canned)   # raises on an invalid canned decision
