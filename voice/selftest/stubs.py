"""Test doubles shared by the self-tests: a scripted brain provider."""
from __future__ import annotations

import json
from typing import Any


class ScriptedProvider:
    """Returns the queued raw replies in order (strings or dicts → JSON). `calls` records what the brain sent.
    When the queue runs dry it answers with a harmless continue (so a test failure reads clearly)."""

    name = "stub"
    model_name = "stub-model"

    def __init__(self, replies: list[Any] | None = None, text_reply: str = "Caller asked for a siding estimate."):
        self.replies = list(replies or [])
        self.calls: list[dict[str, Any]] = []
        self.text_reply = text_reply

    def push(self, *replies: Any) -> None:
        self.replies.extend(replies)

    async def decide(self, system: str, messages: list[dict[str, str]], temperature: float = 0.3, max_tokens: int = 400) -> str:
        self.calls.append({"system": system, "messages": [dict(m) for m in messages]})
        if not self.replies:
            return json.dumps({"say": "Okay.", "action": "continue", "slots": {}})
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r if isinstance(r, str) else json.dumps(r)

    async def text(self, prompt: str, max_tokens: int = 200, temperature: float = 0.2) -> str:
        return self.text_reply
