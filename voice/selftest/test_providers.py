"""providers/* — request shapes with stubbed clients (no network). The Anthropic adapter is otherwise UNTESTED:
ConstructHUB owns no Anthropic key today."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from decision import parse_decision
from providers import ProviderError
from providers.anthropic_tools import AnthropicProvider, modern_model
from providers.openai_compat import OpenAICompatProvider


class FakeMessages:
    def __init__(self, content, stop_reason="tool_use"):
        self.content, self.stop_reason, self.kw = content, stop_reason, None

    async def create(self, **kw):
        self.kw = kw
        return SimpleNamespace(content=self.content, stop_reason=self.stop_reason)


def anth(model, content, stop_reason="tool_use"):
    msgs = FakeMessages(content, stop_reason)
    return AnthropicProvider(model=model, client=SimpleNamespace(messages=msgs)), msgs


DECISION = {"say": "What's the address?", "action": "continue", "slots": {"need": "roof"}}


@pytest.mark.parametrize("model,modern", [
    ("claude-opus-5-5", True), ("claude-sonnet-5-5", True), ("claude-fable-5-1", True),
    ("claude-haiku-4-5", False), ("claude-sonnet-5", False), ("claude-opus-4-8", False),
])
def test_anthropic_request_shape(model, modern):
    p, msgs = anth(model, [SimpleNamespace(type="tool_use", name="decide", input=DECISION)])
    raw = asyncio.run(p.decide("SYSTEM", [{"role": "user", "content": "hi"}]))
    assert parse_decision(raw).slots == {"need": "roof"}
    kw = msgs.kw
    assert modern_model(model) is modern
    assert kw["tools"][0]["name"] == "decide" and "temperature" not in kw
    if modern:
        assert kw["tool_choice"] == {"type": "auto"} and "thinking" not in kw and kw["output_config"] == {"effort": "low"}
        assert kw["system"].startswith("SYSTEM") and "decide" in kw["system"]
    else:
        assert kw["tool_choice"] == {"type": "tool", "name": "decide"} and kw["thinking"] == {"type": "disabled"}
        assert kw["system"] == "SYSTEM"


def test_anthropic_text_reply_and_refusal():
    p, _ = anth("claude-opus-5-5", [SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(DECISION))], "end_turn")
    assert parse_decision(asyncio.run(p.decide("S", [{"role": "user", "content": "x"}]))).say == DECISION["say"]
    p, _ = anth("claude-opus-5-5", [], "refusal")
    with pytest.raises(ProviderError):
        asyncio.run(p.decide("S", [{"role": "user", "content": "x"}]))


def test_anthropic_requires_key():
    with pytest.raises(ProviderError):
        AnthropicProvider(api_key="", client=None)


class FakeCompletions:
    def __init__(self, reject_json_mode=False):
        self.reject = reject_json_mode
        self.calls = []

    async def create(self, **kw):
        self.calls.append(kw)
        if self.reject and "response_format" in kw:
            import httpx
            from openai import BadRequestError
            resp = httpx.Response(400, request=httpx.Request("POST", "http://x/chat/completions"))
            raise BadRequestError("response_format json_object is not supported", response=resp, body=None)
        msg = SimpleNamespace(content=json.dumps(DECISION))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")])


def oa(reject=False):
    p = OpenAICompatProvider(base_url="http://127.0.0.1:9/api", api_key="k", model="truthcode-api")
    fake = FakeCompletions(reject)
    p.client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return p, fake


def test_openai_json_mode_and_system_first():
    p, fake = oa()
    raw = asyncio.run(p.decide("SYS", [{"role": "user", "content": "hi"}], temperature=0.2))
    assert parse_decision(raw).say == DECISION["say"]
    kw = fake.calls[0]
    assert kw["model"] == "truthcode-api" and kw["response_format"] == {"type": "json_object"}
    assert kw["messages"][0] == {"role": "system", "content": "SYS"} and kw["temperature"] == 0.2
    assert p.json_mode_ok is True


def test_openai_falls_back_when_server_refuses_json_mode():
    p, fake = oa(reject=True)
    raw = asyncio.run(p.decide("SYS", [{"role": "user", "content": "hi"}]))
    assert parse_decision(raw).action == "continue"
    assert "response_format" not in fake.calls[-1] and p.json_mode_ok is False
    asyncio.run(p.decide("SYS", [{"role": "user", "content": "again"}]))
    assert "response_format" not in fake.calls[-1]      # remembered for the process


def test_openai_requires_key():
    with pytest.raises(ProviderError):
        OpenAICompatProvider(api_key="")
