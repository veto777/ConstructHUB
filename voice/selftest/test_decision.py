"""decision.py — the strict JSON protocol (SPEC §4): cleanup, parsing, validation, fallbacks."""
import json

import pytest

from decision import ACTIONS, OUTCOMES, ESCALATION_KINDS, DecisionError, decision_json_schema, parse_decision


def test_plain_object():
    d = parse_decision('{"say": "What is the address?", "action": "continue", "slots": {"need": "siding"}}')
    assert d.say == "What is the address?" and d.action == "continue" and d.slots == {"need": "siding"}


def test_fenced_and_think_and_prose_around():
    raw = "<think>the caller wants siding</think>\nSure!\n```json\n{\"say\": \"Got it.\", \"action\": \"continue\"}\n```"
    assert parse_decision(raw).say == "Got it."
    assert parse_decision('```json\n{"say": "Hi.", "action": "continue"}\n```').say == "Hi."


def test_unclosed_think_and_tool_markup_stripped():
    raw = 'reasoning...</think>{"say": "Okay.", "action": "continue"}<tool_call>{"name":"x"}</tool_call>'
    assert parse_decision(raw).say == "Okay."
    with pytest.raises(DecisionError) as e:
        parse_decision("<think>never answered")
    assert e.value.reason == "empty"


def test_trailing_comma_and_braces_in_strings():
    d = parse_decision('{"say": "We do {decks} too.", "action": "continue", "slots": {"need": "deck",},}')
    assert d.say == "We do {decks} too." and d.slots == {"need": "deck"}


def test_tool_call_object_is_not_a_decision():
    with pytest.raises(DecisionError) as e:
        parse_decision('{"name": "submit_lead", "arguments": {"x": 1}}')
    assert e.value.reason == "tool_call_object"


@pytest.mark.parametrize("raw,reason", [
    ("no json here", "no_json"),
    ('{"say": "x", "action": "transfer"}', "bad_action:transfer"),
    ('{"say": "", "action": "continue"}', "empty_say"),
    ('{"say": "x", "action": "alert"}', "alert_without_alert"),
    ('{"say": "x", "action": "flag_spam"}', "flag_spam_without_spam"),
    ('{"say": "x", "action": "continue", "slots": ["a"]}', "slots_not_object"),
    ('{"say": 3, "action": "continue"}', "say_not_string"),
    ('[1, 2]', "no_json"),
])
def test_invalid(raw, reason):
    with pytest.raises(DecisionError) as e:
        parse_decision(raw)
    assert e.value.reason == reason


def test_end_call_may_have_empty_say():
    d = parse_decision('{"say": "", "action": "end_call", "outcome": "lead_submitted"}')
    assert d.action == "end_call" and d.outcome == "lead_submitted"


def test_stage_directions_and_markdown_removed():
    d = parse_decision('{"say": "*smiles* Thanks [note] so much (aside) **really**. Call ended.", "action": "continue"}')
    assert d.say.startswith("Thanks so much")
    assert "*" not in d.say and "[" not in d.say and "Call ended" not in d.say


def test_say_capped_at_sentence_boundary():
    long = ("This is a sentence that goes on. " * 20).strip()
    d = parse_decision(json.dumps({"say": long, "action": "continue"}))
    assert len(d.say) <= 400 and d.say.endswith(".")


def test_slots_normalized():
    d = parse_decision(json.dumps({"say": "ok", "action": "continue", "slots": {"a": 5, "b": None, "c": "", "d": {"x": 1}, "e": " v "}}))
    assert d.slots == {"a": "5", "e": "v"}


def test_alert_kind_and_spam_clamped():
    d = parse_decision('{"say": "ok", "action": "alert", "alert": {"kind": "bogus", "summary": "s"}}')
    assert d.alert == {"kind": "other", "summary": "s"}
    d = parse_decision('{"say": "no thanks", "action": "flag_spam", "spam": {"confidence": 1.7, "reason": "seo pitch"}}')
    assert d.spam == {"confidence": 1.0, "reason": "seo pitch"}
    d = parse_decision('{"say": "ok", "action": "continue", "outcome": "transferred"}')
    assert d.outcome is None


def test_schema_mirrors_typescript_enums():
    """shared/voice-profile.ts DECISION_ACTIONS / CALL_OUTCOMES / ESCALATION_KINDS — keep the Python copy in sync."""
    import re
    from pathlib import Path
    ts = (Path(__file__).resolve().parents[2] / "shared" / "voice-profile.ts").read_text(encoding="utf-8")

    def ts_list(name: str) -> list[str]:
        m = re.search(rf"export const {name} = \[([\s\S]*?)\] as const", ts)
        assert m, name
        return re.findall(r'"([a-z_]+)"', m.group(1))

    assert list(ACTIONS) == ts_list("DECISION_ACTIONS")
    assert list(OUTCOMES) == ts_list("CALL_OUTCOMES")
    assert sorted(ESCALATION_KINDS) == sorted(ts_list("ESCALATION_KINDS"))
    sch = decision_json_schema()
    assert sch["properties"]["action"]["enum"] == list(ACTIONS)
