#!/usr/bin/env python3
"""ConstructHUB Call Assistant engine — SKELETON (docs/call-assistant/SPEC.md § Engine).

Routes are unprefixed; the app proxies https://constructhub.us/voice/<route> here:
  POST /signalwire/voice   LaML webhook → verify → app /profile → <Reject/> | <Say+Hangup> | <Connect><Stream>
  POST /signalwire/status  status callbacks → app /status
  GET  /media              the media WebSocket (8 kHz mu-law both ways)
  GET  /health             {ok, models, activeCalls}
  GET  /personas           bearer — the verified persona list (personas.json)
  POST /sim/session        bearer — {compiled, orgId, callerNumber?} → {sessionId, greeting}
  POST /sim/turn           bearer — {sessionId, text} → Decision + {ended, outcome, events}
  DELETE /sim/session/{id} bearer — {ended, summary}
  POST /tts/preview        bearer — {personaId, text} → audio/wav

The engine lane fills the TODOs (audio.py, speech.py, brain.py, decision.py); this file already
answers /health and /personas, verifies the bearer, and gives every other route an honest 501."""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import secrets
from datetime import datetime

from aiohttp import web

from app_client import AppClient
from config import settings

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

ACTIVE: set[object] = set()
SIM_SESSIONS: dict[str, dict] = {}
STARTED = datetime.now()


def twiml(xml: str) -> web.Response:
    return web.Response(text=f'<?xml version="1.0" encoding="UTF-8"?><Response>{xml}</Response>', content_type="text/xml")


def bearer_ok(req: web.Request) -> bool:
    """Constant-time bearer check for app → engine routes. No secret configured → nothing is open."""
    if not settings.internal_secret:
        return False
    auth = req.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(auth[7:].strip(), settings.internal_secret)


@web.middleware
async def internal_auth(req: web.Request, handler):
    if req.path.startswith(("/sim/", "/tts/", "/personas")) and not bearer_ok(req):
        raise web.HTTPUnauthorized(text=json.dumps({"code": "unauthorized"}), content_type="application/json")
    return await handler(req)


def not_implemented(what: str) -> web.Response:
    return web.json_response({"code": "not_implemented", "lane": "engine", "todo": what}, status=501)


# ── public (SignalWire) ─────────────────────────────────────────────────────

async def signalwire_voice(req: web.Request) -> web.Response:
    # TODO(engine): verify (signing key / CallSid lookup) → app.profile(to, from, callSid) →
    #   blocked → <Reject reason="rejected"/> ; ProfileUnavailable → <Say>line</Say><Hangup/> ;
    #   else <Connect><Stream url=settings.media_ws_url><Parameter from/to/callSid/>
    form = dict(await req.post())
    log.info("webhook (skeleton) from=%s to=%s sid=%s", form.get("From"), form.get("To"), form.get("CallSid"))
    return twiml("<Say>The call assistant is not set up yet. Goodbye.</Say><Hangup/>")


async def signalwire_status(req: web.Request) -> web.Response:
    form = dict(await req.post())
    await req.app["client"].status_callback({"callSid": form.get("CallSid"), "callStatus": form.get("CallStatus"), "duration": form.get("CallDuration")})
    return web.Response(text="ok")


async def media_ws(req: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(req)
    # TODO(engine): the Call class (port of Alpine's server.py: paced sender, time-based playback,
    #   barge-in with echo check, whisper filter, greeting delay, silence watch, hang-up rules).
    log.warning("media stream opened but the engine is a skeleton; closing")
    await ws.close()
    return ws


async def health(_req: web.Request) -> web.Response:
    return web.json_response({"ok": True, "skeleton": True, "models": False, "activeCalls": len(ACTIVE),
                              "startedAt": STARTED.isoformat(timespec="seconds"), "settings": settings.describe()})


# ── internal (app → engine, bearer) ─────────────────────────────────────────

async def personas(_req: web.Request) -> web.Response:
    with open(settings.personas_file, encoding="utf-8") as f:
        return web.json_response(json.load(f))


async def sim_session(req: web.Request) -> web.Response:
    body = await req.json()
    compiled = body.get("compiled") or {}
    if not compiled.get("systemPrompt"):
        return web.json_response({"code": "bad_request", "message": "compiled profile required"}, status=400)
    sid = secrets.token_urlsafe(12)
    SIM_SESSIONS[sid] = {"compiled": compiled, "orgId": body.get("orgId"), "caller": body.get("callerNumber", ""), "turns": [], "created": datetime.now()}
    # TODO(engine): Brain(compiled).greet()
    return web.json_response({"sessionId": sid, "greeting": compiled.get("greeting", ""), "compiledVersion": compiled.get("version")})


async def sim_turn(req: web.Request) -> web.Response:
    body = await req.json()
    if body.get("sessionId") not in SIM_SESSIONS:
        return web.json_response({"code": "unknown_session"}, status=404)
    return not_implemented("Brain.respond(text) → Decision JSON")


async def sim_delete(req: web.Request) -> web.Response:
    SIM_SESSIONS.pop(req.match_info["id"], None)
    return web.json_response({"ended": True, "summary": ""})


async def tts_preview(_req: web.Request) -> web.Response:
    return not_implemented("Kokoro synth of {personaId, text} → audio/wav")


async def on_startup(app: web.Application) -> None:
    log.info("settings: %s", json.dumps(settings.describe()))
    app["client"] = AppClient()
    try:
        await app["client"].health()
        log.info("app reachable at %s; internal secret accepted", settings.app_url)
    except Exception as e:  # noqa: BLE001
        log.warning("app health check failed (%s) — calls cannot be served until it passes", e)
    # TODO(engine): load STT/TTS/VAD once (speech.py), verify persona voice ids, cache greetings.


async def on_cleanup(app: web.Application) -> None:
    await app["client"].aclose()


def make_app() -> web.Application:
    app = web.Application(middlewares=[internal_auth])
    app.add_routes([
        web.post("/signalwire/voice", signalwire_voice),
        web.post("/signalwire/status", signalwire_status),
        web.get("/media", media_ws),
        web.get("/health", health),
        web.get("/personas", personas),
        web.post("/sim/session", sim_session),
        web.post("/sim/turn", sim_turn),
        web.delete("/sim/session/{id}", sim_delete),
        web.post("/tts/preview", tts_preview),
    ])
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    # Keep serving active calls for up to 10 minutes on stop (deploys/restarts), like Alpine's unit.
    web.run_app(make_app(), host=list(settings.bind), port=settings.port, access_log=None, shutdown_timeout=600)
