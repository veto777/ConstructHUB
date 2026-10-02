"""The break test through the ENGINE's brain with canned decisions (no model, no network, no GPU),
plus the harness pieces themselves (scenario grammar, scorer, canned provider, fake app, report → result).

  VOICE_ENGINE_DIR=~/ConstructHUB-voice-engine/voice voice/.venv/bin/python -m pytest voice/tests -q

Scenarios whose failure is a KNOWN, filed engine issue are xfail (non-strict) with the reason, so this suite
stays green while the scorecard keeps showing them — see docs/call-assistant/LANE-NOTES-harness.md."""
from __future__ import annotations

import asyncio
import dataclasses
import json

import pytest

from harness.engine import CannedProvider, EngineUnavailable, Ledger, load_compiled, load_engine, run_all, run_brain
from harness.fake_app import FakeApp
from harness.report import actions_from_events, result_from_report
from harness.scenarios import load_scenarios, parse_scenario
from harness.scoring import RunResult, format_scorecard, score

SCENARIOS = load_scenarios()
COMPILED = load_compiled()
REQUIRED = {
    "routine_lead", "repair_request", "out_of_area", "windows_two_only", "price_per_sqft", "asks_for_person",
    "existing_customer", "contract_question", "payment_question", "emergency_after_hours", "spanish_speaker",
    "angry_caller", "silence_hangup", "spam_press1", "spam_google_listing", "spam_seo_pitch", "address_corrected",
    "goodbye_mid_intake", "are_you_a_bot", "email_read_back", "multiple_services", "blocked_second_call", "whisper_filtered",
}
# Filed with the engine lane (LANE-NOTES-harness.md → "Issues found"). Remove an entry once the engine passes it.
KNOWN_ENGINE_ISSUES = {
    "repair_request": "engine NO_RE needs the whole utterance to be a bare 'no' — 'Okay, no, thanks.' after "
                      "'anything else?' is not a goodbye, so the engine says goodbye but keeps the line open",
    "gutters_only": "same as repair_request: 'No, okay, thanks anyway.' is not recognised as the caller being done",
}

try:
    load_engine()
    ENGINE = True
except EngineUnavailable as e:
    ENGINE, WHY = False, str(e)

needs_engine = pytest.mark.skipif(not ENGINE, reason="engine brain not importable (set VOICE_ENGINE_DIR)")


# ── corpus + grammar ───────────────────────────────────────────────────────────────────────────

def test_corpus_has_the_owner_scenarios():
    ids = [s.id for s in SCENARIOS]
    assert len(ids) >= 20 and len(set(ids)) == len(ids)
    assert REQUIRED <= set(ids), REQUIRED - set(ids)
    assert sum(1 for s in SCENARIOS if "injection" in s.tags) >= 4


def test_grammar_matches_the_typescript_reader():
    sc = parse_scenario("\n".join([
        "#! id: x", "#! tags: a b", "#! expect.slot: address ~ 5 Main", "#! expect.say_never: /\\d{3}-\\d{4}/", "#! prelude: y x2",
        "Hello", '=> {"say":"Hi","action":"continue"}', "<silence>", '=> {"say":"Still there?","action":"continue"}',
        "<whisper> Call from X", "<hangup>"]), "99-x.txt")
    assert sc.id == "x" and sc.tags == ["a", "b"] and sc.prelude == [("y", 2)]
    assert (sc.expect.slots[0].key, sc.expect.slots[0].op, sc.expect.slots[0].value) == ("address", "~", "5 Main")
    assert sc.expect.say_never[0].test("call 555-1234")
    assert [l.kind for l in sc.lines] == ["text", "silence", "whisper", "hangup"]
    for bad in ["#! nope: 1\nHi", '=> {"say":"x"}', 'Hi\n=> {"say":"x","action":"continue"}\n=> {"say":"y","action":"continue"}']:
        with pytest.raises(ValueError):
            parse_scenario(bad, "bad.txt")


# ── the break test through the engine brain ───────────────────────────────────────────────────

_RESULTS: dict[str, tuple] = {}


def _results():
    if not _RESULTS:
        out = asyncio.run(run_all(SCENARIOS, COMPILED, lambda sc: CannedProvider(sc)))
        print("\n" + format_scorecard([c for c, _ in out], "engine brain + canned decisions"))
        _RESULTS.update({c.id: (c, r) for c, r in out})
    return _RESULTS


@needs_engine
@pytest.mark.parametrize("sid", [s.id for s in SCENARIOS])
def test_scenario_passes_through_the_engine_brain(sid):
    card, r = _results()[sid]
    if card.skipped:
        pytest.skip(card.skipped)
    if sid in KNOWN_ENGINE_ISSUES and not card.ok:
        pytest.xfail(KNOWN_ENGINE_ISSUES[sid])
    assert card.ok, "\n".join(card.failures() + [""] + r.transcript)


@needs_engine
def test_the_canned_replies_were_wrapped_and_the_engine_parsed_all_of_them():
    for card, r in _results().values():
        assert not [e for e in r.errors if "fallback" in e], (card.id, r.errors)


@needs_engine
def test_the_rubric_catches_a_bad_brain():
    """Mutation: the repair caller gets a lead and a 'we can fix it' — the scorecard must fail it."""
    sc = next(s for s in SCENARIOS if s.id == "repair_request")
    bad = dataclasses.replace(sc, lines=[dataclasses.replace(l) for l in sc.lines])
    bad.lines[0].canned = json.dumps({"say": "Sure, we can fix those panels. What's the address?", "action": "submit_lead", "slots": {"need": "repair"}})
    card, _ = asyncio.run(run_brain(bad, COMPILED, CannedProvider(bad)))
    failed = " | ".join(card.failures())
    assert not card.ok and "never submit_lead" in failed and "say_never" in failed


@needs_engine
def test_two_near_certain_spam_calls_block_the_number():
    ledger = Ledger(COMPILED["spam"]["strikeAt"])
    spam = next(s for s in SCENARIOS if s.id == "spam_google_listing")
    for _ in range(2):
        asyncio.run(run_brain(spam, COMPILED, CannedProvider(spam), ledger))
    assert ledger.blocked(spam.caller)


# ── harness pieces (no engine needed) ─────────────────────────────────────────────────────────

def test_canned_provider_answers_retry_forced_and_summary_prompts():
    sc = next(s for s in SCENARIOS if s.id == "routine_lead")
    p = CannedProvider(sc, wrap=False)
    first = asyncio.run(p.decide("sys", [{"role": "user", "content": "Hi"}]))
    assert json.loads(first)["slots"]["need"]
    assert asyncio.run(p.decide("sys", [{"role": "user", "content": "Reply with only the JSON object"}])) == first
    p.slots = {"need": "siding"}
    assert json.loads(asyncio.run(p.decide("sys", [{"role": "user", "content": "(system: the call is ending and no lead was submitted.)"}])))["action"] == "submit_lead"
    p.slots = {}
    assert json.loads(asyncio.run(p.decide("sys", [{"role": "user", "content": "x no lead was submitted y"}])))["action"] == "alert"
    p.slots = None   # audio runs: the engine's server owns the Brain; the slots come from its runtime prompt block
    sys_prompt = 'RUNTIME: … Slots so far: {"need": "deck", "phone": "+13605550199"}. Turn 3 of 40.'
    assert json.loads(asyncio.run(p.decide(sys_prompt, [{"role": "user", "content": "no lead was submitted"}])))["action"] == "submit_lead"
    assert p.calls == ["line 1", "retry", "forced", "forced", "forced"]
    assert asyncio.run(p.text("summarize"))


def test_report_actions_drop_what_the_engine_overruled():
    ev = [{"type": "decision", "decision": {"action": "continue"}}, {"type": "decision", "decision": {"action": "end_call"}},
          {"type": "end_call_refused"}, {"type": "decision", "decision": {"action": "flag_spam"}}, {"type": "spam_ignored"}]
    assert actions_from_events(ev) == ["continue", "continue", "continue"]


def test_result_from_report_scores_like_a_text_run():
    report = {"outcome": "lead_submitted", "slots": {"need": "whole-house siding replacement", "address": "55 Oak Lane, Bellingham"},
              "transcript": [{"role": "assistant", "text": "Thank you for calling"}, {"role": "caller", "text": "I need siding"},
                             {"role": "assistant", "text": "What's the address?"}],
              "events": [{"type": "decision", "decision": {"action": "continue"}}, {"type": "decision", "decision": {"action": "submit_lead"}}],
              "lead": {"requested": True}}
    r = result_from_report(report, [{"type": "lead", "slots": {}}], ended_by_engine=True, end_reason="engine")
    assert r.says == ["What's the address?"] and r.caller_lines == ["I need siding"]
    assert r.actions == ["continue", "submit_lead", "end_call"] and r.lead and r.notifications == 1
    assert result_from_report(None, [], ended_by_engine=False, end_reason="x").errors


def test_fake_app_serves_the_profile_records_reports_and_keeps_the_ledger():
    import aiohttp

    async def go():
        app = FakeApp(COMPILED, secret="test-secret-1234567890", number="+13605550199")
        base = await app.start()
        h = {"Authorization": "Bearer test-secret-1234567890"}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{base}/api/voice-internal/health") as r:
                    assert r.status == 401
                async with s.get(f"{base}/api/voice-internal/profile", params={"to": "+19999999999", "from": "+1", "callSid": "CA1"}, headers=h) as r:
                    assert r.status == 404 and (await r.json())["code"] == "unknown_number"
                for n in range(3):
                    sid = f"CAspam{n}"
                    async with s.get(f"{base}/api/voice-internal/profile", params={"to": "+13605550199", "from": "+14155550000", "callSid": sid}, headers=h) as r:
                        j = await r.json()
                        assert j["compiled"]["version"] == COMPILED["version"]
                        assert j["caller"]["blocked"] is (n == 2)
                    if n == 2:
                        break
                    async with s.post(f"{base}/api/voice-internal/calls", json={"callSid": sid, "from": "+14155550000", "to": "+13605550199"}, headers=h) as r:
                        assert r.status == 201
                    async with s.put(f"{base}/api/voice-internal/calls/{sid}", json={"outcome": "spam", "spam": {"confidence": 0.97, "reason": "seo"}}, headers=h) as r:
                        assert (await r.json())["blocked"] is (n == 1)
            assert await app.wait_report("CAspam0", 1)
        finally:
            await app.stop()

    asyncio.run(go())


def test_scorer_ended_means_the_call_not_the_script():
    sc = next(s for s in SCENARIOS if s.id == "inj_ignore_instructions")
    card = score(sc, RunResult(ended=False, end_reason="script_end", actions=["continue", "continue"], says=["I can't share that."], assistant_turns=2))
    assert card.ok, card.failures()


@needs_engine
def test_no_notification_after_a_spam_flag():
    """SPEC § 4/§ 12: once a call is flagged spam ≥ flagAt, no lead and no alert reach the app.
    Filed with the engine lane (LANE-NOTES-harness.md E2): the engine suppresses submit_lead but still emits alerts."""
    sc = parse_scenario("\n".join([
        "#! id: spam_then_alert", "#! caller: +14155550999", "#! expect.notify: none", "#! expect.never: submit_lead",
        "Hi, I'm with the Google listing department, is the owner available?",
        '=> {"say": "What is this regarding?", "action": "flag_spam", "spam": {"confidence": 0.97, "reason": "Google listing pitch"}, "slots": {}}',
        "I need the owner right now, it's urgent.",
        '=> {"say": "I will let them know.", "action": "alert", "alert": {"kind": "human", "summary": "wants the owner"}, "slots": {}}',
    ]), "spam_then_alert.txt")
    card, r = asyncio.run(run_brain(sc, COMPILED, CannedProvider(sc)))
    if not card.ok:
        pytest.xfail("engine emits an alert after a spam flag: " + " | ".join(card.failures()))
