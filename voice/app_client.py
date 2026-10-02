"""The engine's client for the ConstructHUB internal API (docs/call-assistant/SPEC.md § Internal API).

Every call carries `Authorization: Bearer <VOICE_INTERNAL_SECRET>`. The engine never touches Postgres:
this module is its only way to read a profile or write a call. All methods are safe to call from the
media loop — short timeouts, no exceptions leak out except from `health()` (used at startup)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from config import settings

log = logging.getLogger("voice.app")
BASE = "/api/voice-internal"


class ProfileUnavailable(Exception):
    """The app answered 404 (unknown number) or 423 (paused/unpublished); `say` is the line to speak, if any."""

    def __init__(self, code: str, say: str = ""):
        super().__init__(code)
        self.code, self.say = code, say


@dataclass
class CallProfile:
    org: dict[str, Any]
    number: dict[str, Any]
    status: str
    version: int
    compiled: dict[str, Any]
    caller: dict[str, Any]

    @classmethod
    def from_json(cls, j: dict[str, Any]) -> "CallProfile":
        return cls(org=j["org"], number=j["number"], status=j["status"], version=int(j.get("version") or 0),
                   compiled=j["compiled"], caller=j.get("caller") or {"blocked": False})


class AppClient:
    def __init__(self, base_url: str = settings.app_url, secret: str = settings.internal_secret, timeout: float = 10.0):
        self._c = httpx.AsyncClient(base_url=base_url, timeout=timeout,
                                    headers={"Authorization": f"Bearer {secret}", "User-Agent": "constructhub-voice/1"})

    async def aclose(self) -> None:
        await self._c.aclose()

    async def health(self) -> dict[str, Any]:
        r = await self._c.get(f"{BASE}/health")
        r.raise_for_status()
        return r.json()

    async def profile(self, to: str, frm: str, call_sid: str) -> CallProfile:
        """GET /profile?to&from&callSid — the compiled profile + block status for one inbound call."""
        r = await self._c.get(f"{BASE}/profile", params={"to": to, "from": frm, "callSid": call_sid})
        if r.status_code in (404, 423):
            j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            raise ProfileUnavailable(j.get("code", str(r.status_code)), j.get("say", ""))
        r.raise_for_status()
        return CallProfile.from_json(r.json())

    async def call_started(self, payload: dict[str, Any]) -> str | None:
        """POST /calls → callId (None on failure; the call goes on regardless)."""
        try:
            r = await self._c.post(f"{BASE}/calls", json=payload)
            r.raise_for_status()
            return r.json().get("callId")
        except Exception as e:  # noqa: BLE001 — bookkeeping must never break a live call
            log.warning("call_started failed: %s", e)
            return None

    async def call_event(self, call_sid: str, payload: dict[str, Any]) -> dict[str, Any]:
        """POST /calls/:sid/events — an alert or lead that must not wait for the end of the call."""
        try:
            r = await self._c.post(f"{BASE}/calls/{call_sid}/events", json=payload)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("call_event failed: %s", e)
            return {"delivered": False, "error": str(e)[:200]}

    async def call_finished(self, call_sid: str, payload: dict[str, Any]) -> dict[str, Any]:
        """PUT /calls/:sid — the end-of-call report; the app runs lead delivery, escalations, spam, usage."""
        try:
            r = await self._c.put(f"{BASE}/calls/{call_sid}", json=payload, timeout=30.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("call_finished failed: %s", e)
            return {"error": str(e)[:200]}

    async def upload_recording(self, call_sid: str, wav_path: Path) -> dict[str, Any]:
        """POST /recordings/:sid with the WAV body; the app stores it in R2."""
        try:
            body = wav_path.read_bytes()   # ≤ 40 MB by contract; an AsyncClient cannot stream a sync file object
            r = await self._c.post(f"{BASE}/recordings/{call_sid}", content=body, headers={"Content-Type": "audio/wav"}, timeout=120.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("upload_recording failed: %s", e)
            return {"error": str(e)[:200]}

    async def status_callback(self, payload: dict[str, Any]) -> None:
        """POST /status — a SignalWire status callback relayed as-is."""
        try:
            await self._c.post(f"{BASE}/status", json=payload)
        except Exception as e:  # noqa: BLE001
            log.warning("status_callback failed: %s", e)
