"""The STRICT JSON decision protocol (docs/call-assistant/SPEC.md §4) — Python mirror of
shared/voice-profile.ts `decisionSchema`, plus the cleanup server/ai-output.ts does for every AI feature.

A provider's raw reply goes through `parse_decision()`:
  1. strip fenced code, <think>/<reasoning> blocks, tool-call markup (XML, bracket markers, bare tool names,
     {"name":…,"arguments":…} objects);
  2. find the first balanced {…} object and json-parse it;
  3. validate: say ≤ 400 chars, action ∈ ACTIONS, slots = str→str, alert/spam/outcome shapes;
  4. anything invalid → DecisionError (the brain retries ONCE with a corrective message, then falls back).

Nothing here talks to a model or the network, so it is unit-testable in milliseconds (voice/selftest/)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

ACTIONS = ("continue", "submit_lead", "flag_spam", "alert", "end_call")
OUTCOMES = ("lead_submitted", "alerted", "declined", "out_of_area", "info", "spam", "blocked", "hangup", "voicemail", "error", "booked")
ESCALATION_KINDS = ("human", "urgent", "existing_customer", "estimate_missing", "scheduling", "contract", "payment", "complaint", "vendor", "other")
SAY_MAX = 400
SLOT_KEY_MAX, SLOT_VALUE_MAX = 60, 500

FALLBACK_SAY = "I'm sorry, could you say that one more time?"
RETRY_MESSAGE = 'Reply with only the JSON object: {"say": "...", "action": "continue|submit_lead|flag_spam|alert|end_call", "slots": {...}}. No other text.'


class DecisionError(ValueError):
    """The model's reply is not a usable decision; `reason` is short and loggable."""

    def __init__(self, reason: str, raw: str = ""):
        super().__init__(reason)
        self.reason, self.raw = reason, raw[:300]


@dataclass
class Decision:
    say: str = ""
    action: str = "continue"
    slots: dict[str, str] = field(default_factory=dict)
    alert: dict[str, str] | None = None          # {kind, summary}
    spam: dict[str, Any] | None = None           # {confidence: float, reason: str}
    outcome: str | None = None
    fallback: bool = False                       # True when the brain substituted the honest fallback line

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"say": self.say, "action": self.action, "slots": dict(self.slots)}
        if self.alert:
            d["alert"] = dict(self.alert)
        if self.spam:
            d["spam"] = dict(self.spam)
        if self.outcome:
            d["outcome"] = self.outcome
        if self.fallback:
            d["fallback"] = True
        return d


def fallback_decision() -> Decision:
    return Decision(say=FALLBACK_SAY, action="continue", fallback=True)


# ── cleanup (the parts of server/ai-output.ts that matter for a JSON answer) ────────────────────

_THINK_TAGS = "think|thinking|reasoning|reflection|analysis|scratchpad"
_TOOL_NAMES = "web_research|web_search|read_image|describe_image|code_interpreter|fetch_url|open_url"


def _strip_thinking(s: str) -> str:
    s = re.sub(rf"<({_THINK_TAGS})>[\s\S]*?</\1>", "", s, flags=re.I)
    s = re.sub(rf"\[({_THINK_TAGS})\][\s\S]*?\[/\1\]", "", s, flags=re.I)
    # a closing tag with no opening one: everything before it was reasoning
    end = -1
    for m in re.finditer(rf"</(?:{_THINK_TAGS})>|\[/(?:{_THINK_TAGS})\]", s, flags=re.I):
        end = m.end()
    if end >= 0:
        s = s[end:]
    # an opening tag that never closed: the answer never came
    return re.sub(rf"(?:<(?:{_THINK_TAGS})>|\[(?:{_THINK_TAGS})\])[\s\S]*$", "", s, flags=re.I)


def _strip_tool_calls(s: str) -> str:
    s = re.sub(r"<(tool_calls?|function_calls|tool_use|tool_response|tool_result)\b[^>]*>[\s\S]*?</\1>", "", s, flags=re.I)
    s = re.sub(r"<(tool_calls?|function_calls|tool_use)\b[^>]*>[\s\S]*$", "", s, flags=re.I)
    s = re.sub(r"<\|(?:tool_calls?|python_tag)[^|]*\|>[\s\S]*?(?:<\|/?(?:tool_calls?|eom|eot)[^|]*\|>|$)", "", s, flags=re.I)
    s = re.sub(r"<function=[^>]*>[\s\S]*?(?:</function>|$)", "", s, flags=re.I)
    s = re.sub(r"<parameter=[^>]*>[\s\S]*?(?:</parameter>|$)", "", s, flags=re.I)
    s = re.sub(r"</?(?:tool_calls?|function_calls|tool_use|tool_response|tool_result|function|parameter|invoke)\b[^>]*>", "", s, flags=re.I)
    s = re.sub(rf"\[(?:{_TOOL_NAMES}|tool_call)(?:\s*[:(][^\]\n]*)?\]", "", s, flags=re.I)
    s = re.sub(rf"^[ \t]*`?(?:{_TOOL_NAMES})`?[ \t]*:?[ \t]*$", "", s, flags=re.I | re.M)
    return s


def _first_json_object(s: str) -> str | None:
    """The first balanced {...} block (string-aware), or None."""
    start = s.find("{")
    while start >= 0:
        depth, in_str, i = 0, False, start
        while i < len(s):
            c = s[i]
            if in_str:
                if c == "\\":
                    i += 1
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
            i += 1
        start = s.find("{", start + 1)
    return None


def clean_reply(raw: str) -> str:
    """Fenced code, think blocks and tool-call markup removed; what is left should contain the JSON object."""
    s = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    m = re.match(r"^\s*```[a-z]*\n([\s\S]*?)\n?```\s*$", s, flags=re.I)
    if m:
        s = m.group(1)
    s = _strip_thinking(s)
    s = _strip_tool_calls(s)
    return s.strip()


# ── validation ──────────────────────────────────────────────────────────────────────────────────

def _clean_say(text: str) -> str:
    """Nothing the model shouldn't say out loud: stage directions, markdown, bracketed notes (Alpine's clean_speech)."""
    text = re.sub(r"\*[^*]*\*", " ", text)
    text = re.sub(r"\[[^\]]*\]|\((?![\d\s.-]+\))[^)]*\)", " ", text)   # asides go; "(360)" stays (it's a number)
    text = re.sub(r"[#_`~]", " ", text)
    text = re.sub(r"\b(call ended|end of call|hanging up now|submitting now)\.?", " ", text, flags=re.I)
    return " ".join(text.split())


def validate_decision(obj: Any, raw: str = "") -> Decision:
    if not isinstance(obj, dict):
        raise DecisionError("not_an_object", raw)
    # a tool-call shaped object is not a decision
    if "name" in obj and ("arguments" in obj or "parameters" in obj) and "say" not in obj:
        raise DecisionError("tool_call_object", raw)
    say = obj.get("say", "")
    if say is None:
        say = ""
    if not isinstance(say, str):
        raise DecisionError("say_not_string", raw)
    say = _clean_say(say)
    if len(say) > SAY_MAX:
        cut = say[:SAY_MAX]
        end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
        say = (cut[:end + 1] if end > SAY_MAX * 0.4 else cut).strip()
    action = obj.get("action") or "continue"
    if not isinstance(action, str) or action not in ACTIONS:
        raise DecisionError(f"bad_action:{str(action)[:30]}", raw)
    slots_in = obj.get("slots") or {}
    if not isinstance(slots_in, dict):
        raise DecisionError("slots_not_object", raw)
    slots: dict[str, str] = {}
    for k, v in slots_in.items():
        if not isinstance(k, str) or not k:
            continue
        if v is None or v == "":
            continue
        if isinstance(v, (int, float, bool)):
            v = str(v)
        if not isinstance(v, str):
            continue
        slots[k[:SLOT_KEY_MAX]] = v.strip()[:SLOT_VALUE_MAX]
    alert = None
    a = obj.get("alert")
    if isinstance(a, dict) and a.get("kind"):
        kind = str(a.get("kind"))
        if kind not in ESCALATION_KINDS:
            kind = "other"
        alert = {"kind": kind, "summary": str(a.get("summary") or "")[:600]}
    spam = None
    sp = obj.get("spam")
    if isinstance(sp, dict) and sp.get("confidence") is not None:
        try:
            conf = float(sp.get("confidence"))
        except (TypeError, ValueError):
            raise DecisionError("spam_confidence", raw)
        spam = {"confidence": max(0.0, min(1.0, conf)), "reason": str(sp.get("reason") or "")[:200]}
    outcome = obj.get("outcome")
    if outcome is not None:
        outcome = str(outcome)
        if outcome not in OUTCOMES:
            outcome = None
    if action == "alert" and not alert:
        raise DecisionError("alert_without_alert", raw)
    if action == "flag_spam" and not spam:
        raise DecisionError("flag_spam_without_spam", raw)
    if not say and action != "end_call":
        raise DecisionError("empty_say", raw)
    return Decision(say=say, action=action, slots=slots, alert=alert, spam=spam, outcome=outcome)


def parse_decision(raw: str) -> Decision:
    """Raw model text → Decision, or DecisionError."""
    cleaned = clean_reply(raw)
    if not cleaned:
        raise DecisionError("empty", raw)
    block = _first_json_object(cleaned)
    if block is None:
        raise DecisionError("no_json", raw)
    try:
        obj = json.loads(block)
    except json.JSONDecodeError:
        # common model slips: trailing commas, single quotes
        fixed = re.sub(r",\s*([}\]])", r"\1", block)
        try:
            obj = json.loads(fixed)
        except json.JSONDecodeError:
            raise DecisionError("bad_json", raw)
    return validate_decision(obj, raw)


def decision_json_schema() -> dict[str, Any]:
    """Mirror of server/voice/prompt-compiler.ts decisionJsonSchema() — shown to the model when the compiled
    profile doesn't carry its own."""
    return {
        "type": "object", "required": ["say", "action"], "additionalProperties": False,
        "properties": {
            "say": {"type": "string", "maxLength": SAY_MAX},
            "action": {"type": "string", "enum": list(ACTIONS)},
            "slots": {"type": "object", "additionalProperties": {"type": "string"}},
            "alert": {"type": "object", "required": ["kind", "summary"], "properties": {"kind": {"type": "string", "enum": list(ESCALATION_KINDS)}, "summary": {"type": "string"}}},
            "spam": {"type": "object", "required": ["confidence", "reason"], "properties": {"confidence": {"type": "number", "minimum": 0, "maximum": 1}, "reason": {"type": "string"}}},
            "outcome": {"type": "string", "enum": list(OUTCOMES)},
        },
    }
