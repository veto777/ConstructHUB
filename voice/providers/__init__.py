"""Provider adapters for the brain. Every adapter has the same tiny interface:

    async decide(system: str, messages: list[{"role","content"}], temperature: float) -> str   # raw text
    async text(prompt: str, max_tokens: int) -> str                                             # a plain answer

The brain parses the raw text with decision.parse_decision(); the Anthropic adapter maps real tool use onto the
same JSON text so the brain never knows which provider answered. Pick with VOICE_AI_PROVIDER (openai | anthropic)."""
from __future__ import annotations

from config import settings


class ProviderError(Exception):
    pass


def make_provider(name: str | None = None):
    name = (name or settings.ai_provider or "openai").lower()
    if name == "anthropic":
        from .anthropic_tools import AnthropicProvider
        return AnthropicProvider()
    from .openai_compat import OpenAICompatProvider
    return OpenAICompatProvider()
