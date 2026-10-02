"""The default brain: ConstructHUB's OpenAI-compatible provider (AI_INTEGRATIONS_OPENAI_BASE_URL / _API_KEY,
model AI_MODEL — TruthCoder's `truthcode-api` in production).

No native tool calling: the system prompt demands ONE JSON object per turn and we ask for
`response_format: json_object` when the server accepts it (TruthCoder does; a server that answers 400 to it is
remembered and the request repeated without it). Output cleanup lives in decision.py (same rules as
server/ai-output.ts: tool-call text, <think> blocks and reasoning are stripped before parsing)."""
from __future__ import annotations

import logging
from typing import Any

from openai import AsyncOpenAI, BadRequestError

from config import settings
from . import ProviderError

log = logging.getLogger("voice.provider.openai")


class OpenAICompatProvider:
    name = "openai"

    def __init__(self, base_url: str = settings.openai_base_url, api_key: str = settings.openai_api_key,
                 model: str = settings.ai_model, timeout: float = settings.ai_timeout_s):
        if not api_key:
            raise ProviderError("AI_INTEGRATIONS_OPENAI_API_KEY is not set in voice/.env")
        # a phone caller will not wait: fail fast and recover in conversation (the brain's fallback line)
        self.client = AsyncOpenAI(base_url=base_url or None, api_key=api_key, timeout=timeout, max_retries=1)
        self.model = model
        self.json_mode_ok: bool | None = None   # unknown → try; False → never again this process

    @property
    def model_name(self) -> str:
        return self.model

    async def _chat(self, messages: list[dict[str, Any]], max_tokens: int, temperature: float, json_mode: bool) -> str:
        kw: dict[str, Any] = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
        if json_mode and self.json_mode_ok is not False:
            kw["response_format"] = {"type": "json_object"}
        try:
            r = await self.client.chat.completions.create(**kw)
        except BadRequestError as e:
            if "response_format" in kw and ("response_format" in str(e).lower() or "json" in str(e).lower()):
                log.warning("server refused response_format; falling back to prompt-only JSON")
                self.json_mode_ok = False
                kw.pop("response_format")
                r = await self.client.chat.completions.create(**kw)
            else:
                raise ProviderError(f"{type(e).__name__}: {e}"[:200]) from e
        except Exception as e:  # noqa: BLE001 — timeouts, connection errors, 5xx
            raise ProviderError(f"{type(e).__name__}: {e}"[:200]) from e
        if "response_format" in kw and self.json_mode_ok is None:
            self.json_mode_ok = True
        choice = (r.choices or [None])[0]
        if choice is None:
            raise ProviderError("no choices")
        content = choice.message.content
        if isinstance(content, list):
            content = "".join(p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "") for p in content)
        if choice.finish_reason == "content_filter":
            raise ProviderError("content_filter")
        return content or ""

    async def decide(self, system: str, messages: list[dict[str, str]], temperature: float = 0.3, max_tokens: int = 400) -> str:
        return await self._chat([{"role": "system", "content": system}, *messages], max_tokens, temperature, json_mode=True)

    async def text(self, prompt: str, max_tokens: int = 200, temperature: float = 0.2) -> str:
        return await self._chat([{"role": "user", "content": prompt}], max_tokens, temperature, json_mode=False)
