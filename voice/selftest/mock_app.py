"""A stand-in for the ConstructHUB app's internal API (/api/voice-internal/*, SPEC §5) so the engine can be tested
without Postgres, R2 or the real app. Every request is recorded in `app[LOG]`; the bearer is enforced like
server/voice/internal-auth.ts (503 when unset, 401 when wrong).

Numbers it knows (E.164):
  +13605550100  live    → the sample compiled profile (voice/tests/profiles/sample.json)
  +13605550142  paused  → 423 {code:"paused", say}
  anything else         → 404 {code:"unknown_number"}
Caller +13605550666 is on the block list (caller.blocked = true).

Run standalone (for the GPU smoke run):  python selftest/mock_app.py --port 8191 --secret <same as the engine>"""
from __future__ import annotations

import argparse
import hmac
import json
from pathlib import Path
from typing import Any

from aiohttp import web

HERE = Path(__file__).resolve().parent
SAMPLE = HERE.parent / "tests" / "profiles" / "sample.json"
LOG = web.AppKey("log", list)
COMPILED = web.AppKey("compiled", dict)
RECORDINGS = web.AppKey("recordings", dict)
LIVE, PAUSED, BLOCKED_CALLER = "+13605550100", "+13605550142", "+13605550666"


def make_mock_app(secret: str, compiled: dict[str, Any] | None = None) -> web.Application:
    app = web.Application(client_max_size=41 * 1024 * 1024)
    app[LOG] = []
    app[COMPILED] = compiled or json.loads(SAMPLE.read_text(encoding="utf-8"))
    app[RECORDINGS] = {}

    @web.middleware
    async def bearer(req: web.Request, handler):
        if not secret:
            return web.json_response({"code": "voice_internal_unconfigured"}, status=503)
        auth = req.headers.get("Authorization", "")
        if not (auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], secret)):
            return web.json_response({"code": "unauthorized"}, status=401)
        return await handler(req)

    app.middlewares.append(bearer)

    def log(req: web.Request, body: Any) -> None:
        req.app[LOG].append({"method": req.method, "path": req.path, "query": dict(req.query), "body": body})

    async def health(req):
        log(req, None)
        return web.json_response({"ok": True, "app": "constructhub"})

    async def profile(req):
        log(req, None)
        to, frm = req.query.get("to", ""), req.query.get("from", "")
        if to == PAUSED:
            return web.json_response({"code": "paused", "say": "Thanks for calling. We're closed right now, please call back later. Goodbye."}, status=423)
        if to != LIVE:
            return web.json_response({"code": "unknown_number"}, status=404)
        return web.json_response({
            "org": {"id": "org-test", "name": "Cascade Exteriors", "timezone": "America/Los_Angeles"},
            "number": {"id": "num-1", "label": "Main line", "location": "Bellingham", "isTest": True},
            "status": "live", "version": req.app[COMPILED].get("version", 1), "compiled": req.app[COMPILED],
            "caller": {"blocked": frm == BLOCKED_CALLER, "strikes": 2 if frm == BLOCKED_CALLER else 0, "customer": None},
        })

    async def calls_post(req):
        body = await req.json()
        log(req, body)
        return web.json_response({"callId": "call-" + body.get("callSid", "?")}, status=201)

    async def call_event(req):
        body = await req.json()
        log(req, body)
        return web.json_response({"delivered": True, "customerId": "cust-1" if body.get("type") == "lead" else None})

    async def call_put(req):
        body = await req.json()
        log(req, body)
        return web.json_response({"callId": "call-" + req.match_info["sid"], "outcome": body.get("outcome"), "customerId": None,
                                  "projectId": None, "blocked": False})

    async def recording(req):
        data = await req.read()
        log(req, {"bytes": len(data), "contentType": req.content_type})
        req.app[RECORDINGS][req.match_info["sid"]] = data
        return web.json_response({"recordingKey": f"voice/org-test/{req.match_info['sid']}.wav", "seconds": max(0, (len(data) - 44) // 16000)})

    async def status(req):
        body = await req.json()
        log(req, body)
        return web.json_response({"ok": True})

    async def dump_log(req):
        return web.json_response(req.app[LOG])

    app.add_routes([
        web.get("/__log", dump_log),
        web.get("/api/voice-internal/health", health),
        web.get("/api/voice-internal/profile", profile),
        web.post("/api/voice-internal/calls", calls_post),
        web.post("/api/voice-internal/calls/{sid}/events", call_event),
        web.put("/api/voice-internal/calls/{sid}", call_put),
        web.post("/api/voice-internal/recordings/{sid}", recording),
        web.post("/api/voice-internal/status", status),
    ])
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8191)
    ap.add_argument("--secret", required=True)
    ap.add_argument("--dump", help="write the request log here as JSON on exit")
    a = ap.parse_args()
    mock = make_mock_app(a.secret)

    async def dump(app: web.Application) -> None:
        if a.dump:
            Path(a.dump).write_text(json.dumps(app[LOG], indent=2, ensure_ascii=False), encoding="utf-8")

    mock.on_shutdown.append(dump)
    web.run_app(mock, host="127.0.0.1", port=a.port, access_log=None)
