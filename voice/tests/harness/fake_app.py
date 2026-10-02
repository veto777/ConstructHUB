"""A stand-in for the ConstructHUB app's internal API (/api/voice-internal/*, SPEC.md § 5) for engine tests.

It serves ONE fixture org/number with a compiled profile, records everything the engine reports (call start,
mid-call events, the end-of-call report, the recording, status callbacks) and keeps the per-org spam ledger
the way the app does (§ 12: a strike per call with spam confidence ≥ strikeAt; 2 strikes → blocked pre-answer).
No database, no CRM, no notifications — the harness scores what the engine SENT.

    app = FakeApp(compiled, secret="…", number="+13605550199")
    base = await app.start("127.0.0.1", 0)      # → "http://127.0.0.1:<port>"
    …  engine runs with VOICE_APP_URL=base, VOICE_INTERNAL_SECRET=secret
    report = await app.wait_report(call_sid)
"""
from __future__ import annotations

import asyncio
import hmac
import secrets
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web

BASE = "/api/voice-internal"


@dataclass
class CallRecord:
    start: dict[str, Any] | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    report: dict[str, Any] | None = None
    recording_bytes: int = 0
    statuses: list[dict[str, Any]] = field(default_factory=list)


class FakeApp:
    def __init__(self, compiled: dict[str, Any], secret: str | None = None, number: str = "+13605550199",
                 org: dict[str, Any] | None = None, status: str = "live"):
        self.compiled = compiled
        self.secret = secret or secrets.token_urlsafe(24)
        self.number = number
        self.org = org or {"id": "org_fixture", "name": "Cascade Exteriors (fixture)", "timezone": "America/Los_Angeles"}
        self.status = status
        self.calls: dict[str, CallRecord] = {}
        self.strikes: dict[str, int] = {}
        self.blocked: set[str] = set()
        self.profile_requests: list[dict[str, str]] = []
        self.unauthorized = 0
        self._runner: web.AppRunner | None = None
        self._changed = asyncio.Event()

    # ── ledger (SPEC § 12) ─────────────────────────────────────────────────────────────────────────

    @property
    def strike_at(self) -> float:
        return float((self.compiled.get("spam") or {}).get("strikeAt", 0.95))

    def _ledger(self, caller: str, report: dict[str, Any]) -> bool:
        spam = report.get("spam") or {}
        if report.get("outcome") == "spam" and float(spam.get("confidence") or 0) >= self.strike_at:
            self.strikes[caller] = self.strikes.get(caller, 0) + 1
            if self.strikes[caller] >= 2:
                self.blocked.add(caller)
        return caller in self.blocked

    def rec(self, sid: str) -> CallRecord:
        return self.calls.setdefault(sid, CallRecord())

    # ── http ─────────────────────────────────────────────────────────────────────────────────────

    @web.middleware
    async def _auth(self, req: web.Request, handler):
        h = req.headers.get("Authorization", "")
        if not hmac.compare_digest(h.encode(), f"Bearer {self.secret}".encode()):
            self.unauthorized += 1
            return web.json_response({"code": "unauthorized"}, status=401)
        return await handler(req)

    async def health(self, _req: web.Request) -> web.Response:
        return web.json_response({"ok": True, "app": "constructhub-fake"})

    async def profile(self, req: web.Request) -> web.Response:
        q = {k: req.query.get(k, "") for k in ("to", "from", "callSid")}
        self.profile_requests.append(q)
        if q["to"] != self.number:
            return web.json_response({"code": "unknown_number"}, status=404)
        if self.status != "live":
            return web.json_response({"code": self.status, "say": "Thanks for calling. Please call back during business hours."}, status=423)
        return web.json_response({
            "org": self.org,
            "number": {"id": "num_fixture", "label": "constructhub-test", "location": "fixture", "isTest": True},
            "status": "live", "version": int(self.compiled.get("version") or 1), "compiled": self.compiled,
            "caller": {"blocked": q["from"] in self.blocked, "strikes": self.strikes.get(q["from"], 0), "customer": None},
        })

    async def calls_start(self, req: web.Request) -> web.Response:
        body = await req.json()
        self.rec(body.get("callSid", "")).start = body
        self._changed.set()
        return web.json_response({"callId": f"call_{body.get('callSid', '')}"}, status=201)

    async def calls_event(self, req: web.Request) -> web.Response:
        body = await req.json()
        self.rec(req.match_info["sid"]).events.append(body)
        self._changed.set()
        return web.json_response({"delivered": True})

    async def calls_finish(self, req: web.Request) -> web.Response:
        sid = req.match_info["sid"]
        body = await req.json()
        r = self.rec(sid)
        caller = (r.start or {}).get("from", "")
        first = r.report is None
        r.report = body
        blocked = self._ledger(caller, body) if first else caller in self.blocked   # idempotent PUT
        self._changed.set()
        return web.json_response({"callId": f"call_{sid}", "outcome": body.get("outcome"), "customerId": None, "projectId": None, "blocked": blocked})

    async def recordings(self, req: web.Request) -> web.Response:
        data = await req.read()
        sid = req.match_info["sid"]
        self.rec(sid).recording_bytes = len(data)
        self._changed.set()
        return web.json_response({"recordingKey": f"voice/{self.org['id']}/{sid}.wav", "seconds": max(0, (len(data) - 44) // 16000)})

    async def status_cb(self, req: web.Request) -> web.Response:
        body = await req.json()
        self.rec(str(body.get("callSid") or "")).statuses.append(body)
        return web.json_response({"ok": True})

    def make_app(self) -> web.Application:
        app = web.Application(middlewares=[self._auth], client_max_size=48 * 1024 * 1024)
        app.add_routes([
            web.get(f"{BASE}/health", self.health),
            web.get(f"{BASE}/profile", self.profile),
            web.post(f"{BASE}/calls", self.calls_start),
            web.post(f"{BASE}/calls/{{sid}}/events", self.calls_event),
            web.put(f"{BASE}/calls/{{sid}}", self.calls_finish),
            web.post(f"{BASE}/recordings/{{sid}}", self.recordings),
            web.post(f"{BASE}/status", self.status_cb),
        ])
        return app

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> str:
        self._runner = web.AppRunner(self.make_app(), access_log=None)
        await self._runner.setup()
        site = web.TCPSite(self._runner, host, port)
        await site.start()
        sock = site._server.sockets[0]  # type: ignore[union-attr]
        return f"http://{host}:{sock.getsockname()[1]}"

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()

    async def wait_report(self, sid: str, timeout: float = 45.0) -> dict[str, Any] | None:
        loop = asyncio.get_running_loop()
        end = loop.time() + timeout
        while loop.time() < end:
            r = self.calls.get(sid)
            if r and r.report is not None:
                return r.report
            self._changed.clear()
            try:
                await asyncio.wait_for(self._changed.wait(), timeout=max(0.05, end - loop.time()))
            except asyncio.TimeoutError:
                break
        r = self.calls.get(sid)
        return r.report if r else None
