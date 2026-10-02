"""Optional brain: Anthropic with REAL tool use, behind VOICE_AI_PROVIDER=anthropic + VOICE_ANTHROPIC_API_KEY
(a ConstructHUB-owned key only; none exists today, so this adapter is UNTESTED against the live API — the
request shapes are exercised by voice/selftest/test_providers.py with a stubbed client).

The model gets one tool, `decide`, whose input schema IS the decision object, so the brain receives the same JSON
text the OpenAI-compatible path produces and decision.py validates it the same way.

Two request shapes, picked by model id (the API refuses the other one with a 400):
  - current models (Claude Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1): forced tool_choice and disabled thinking are
    both rejected, so we send tool_choice auto + an explicit "call decide" instruction, no thinking parameter, and
    `output_config.effort = low` (a phone caller can't wait for deep reasoning). A text-only answer still goes through
    the JSON parser, then the brain's one retry.
  - earlier models (Haiku 4.5, Sonnet 5/4.6, Opus 5/4.x): tool_choice forced to `decide`, thinking disabled
    explicitly (Sonnet-class models think by default — Alpine's lesson).
The 1.x SDK has no sampling parameters on messages.create, so the profile's temperature is not sent."""
from __future__ import annotations

import json
import logging
from typing import Any

from config import settings
from decision import decision_json_schema
from . import ProviderError

log = logging.getLogger("voice.provider.anthropic")

DECIDE_TOOL = {
    "name": "decide",
    "description": "Your ONLY output every turn: what to say to the caller and what to do. Call it exactly once per turn.",
    "input_schema": decision_json_schema(),
}
CALL_DECIDE = "\n\nEvery turn, answer by calling the `decide` tool exactly once. Do not write any text outside the tool call."

# models that refuse forced tool_choice and thinking {type: disabled}
_NO_FORCED_TOOL = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1")


def modern_model(model: str) -> bool:
    return any(model == m or model.startswith(m + "-") or model.startswith("anthropic." + m) for m in _NO_FORCED_TOOL)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str = settings.anthropic_api_key, model: str = settings.anthropic_model,
                 timeout: float = settings.ai_timeout_s, client: Any = None):
        if client is None:
            if not api_key:
                raise ProviderError("VOICE_ANTHROPIC_API_KEY is not set in voice/.env")
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=1)
        self.client, self.model = client, model

    @property
    def model_name(self) -> str:
        return self.model

    def decide_request(self, system: str, messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
        """The messages.create kwargs for one decision turn (exposed for the self-tests)."""
        kw: dict[str, Any] = {
            "model": self.model, "max_tokens": max_tokens, "tools": [DECIDE_TOOL],
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
        }
        if modern_model(self.model):
            kw.update(system=system + CALL_DECIDE, tool_choice={"type": "auto"}, output_config={"effort": "low"})
        else:
            kw.update(system=system, tool_choice={"type": "tool", "name": "decide"}, thinking={"type": "disabled"})
        return kw

    async def decide(self, system: str, messages: list[dict[str, str]], temperature: float = 0.3, max_tokens: int = 1024) -> str:
        try:
            r = await self.client.messages.create(**self.decide_request(system, messages, max_tokens))
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"{type(e).__name__}: {e}"[:200]) from e
        if getattr(r, "stop_reason", "") == "refusal":
            raise ProviderError("refusal")
        for blk in r.content:
            if getattr(blk, "type", "") == "tool_use" and getattr(blk, "name", "") == "decide":
                return json.dumps(blk.input)
        # no tool call: hand back whatever text came, the parser will judge it
        return " ".join(getattr(b, "text", "") for b in r.content if getattr(b, "type", "") == "text")

    async def text(self, prompt: str, max_tokens: int = 400, temperature: float = 0.2) -> str:
        kw: dict[str, Any] = {"model": self.model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
        if modern_model(self.model):
            kw["output_config"] = {"effort": "low"}
        else:
            kw["thinking"] = {"type": "disabled"}
        try:
            r = await self.client.messages.create(**kw)
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"{type(e).__name__}: {e}"[:200]) from e
        return " ".join(getattr(b, "text", "") for b in r.content if getattr(b, "type", "") == "text").strip()
