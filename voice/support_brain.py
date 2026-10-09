"""Gabe's support line (server/support in the app) — the engine side.

The app holds every rule (verification, codes, limits, tickets); this brain only carries words: it sends each caller
turn to POST /api/voice-internal/support/turn and speaks the answer. It never sees an account, a code or an email.
Selected by server.py when the profile says `kind: "support"` (the number in SUPPORT_LINE_NUMBER)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from brain import Brain, SILENCE_TEXT
from decision import Decision

log = logging.getLogger("voice.support")
FAIL_SAY = "Sorry, I'm having trouble on my end. Please email support at constructhub dot us. Goodbye."


class SupportBrain(Brain):
    def __init__(self, app: Any, call_sid: str, caller_number: str, voice: str = "am_michael"):
        super().__init__({"persona": {"id": "gabe", "name": "Gabe", "voice": voice}, "timings": {"maxTurns": 40}}, caller_number)
        self.app, self.call_sid = app, call_sid

    @property
    def model_name(self) -> str:  # noqa: D401 — the app's state machine answers, not a model here
        return "support-line"

    async def greet(self) -> str:
        try:
            r = await self.app._c.post("/api/voice-internal/support/start", json={"callSid": self.call_sid, "from": self.caller})
            r.raise_for_status()
            g = r.json().get("say") or FAIL_SAY
        except Exception as e:  # noqa: BLE001
            log.warning("support start failed: %s", e)
            g = FAIL_SAY
            self.end_requested = True
        self._log("assistant", g)
        self.last_say = g
        return g

    async def respond(self, caller_text: str, *, silence: bool = False) -> Decision:
        async with self._lock:
            text = (caller_text or "").strip()
            if silence:
                self.silences += 1
                if self.silences >= self.silence_limit:
                    self.end_requested, self.outcome = True, "hangup"
                    return Decision(say="I haven't heard anything, so I'll let you go. Goodbye.", action="end_call")
                return Decision(say="Are you still there?", action="continue")
            self.silences = 0
            self._log("caller", text)
            self.turns += 1
            try:
                r = await self.app._c.post("/api/voice-internal/support/turn", json={"callSid": self.call_sid, "from": self.caller, "text": text}, timeout=30.0)
                r.raise_for_status()
                j = r.json()
                say, end = str(j.get("say") or FAIL_SAY), bool(j.get("end"))
            except Exception as e:  # noqa: BLE001
                log.warning("support turn failed: %s", e)
                say, end = FAIL_SAY, True
            self._log("assistant", say)
            self.last_say = say
            if end:
                self.end_requested, self.outcome = True, "info"
            return Decision(say=say, action="end_call" if end else "continue")

    def retract_last_reply(self) -> str | None:
        return None   # every turn changes the app's state; a reply is never taken back

    async def finish(self) -> None:
        try:
            await self.app._c.post("/api/voice-internal/support/end", json={"callSid": self.call_sid})
        except Exception as e:  # noqa: BLE001
            log.warning("support end failed: %s", e)

    async def report(self, ended_at: datetime | None = None, duration_seconds: int | None = None) -> dict[str, Any]:
        return {"outcome": self.outcome or "info", "support": True}
