#!/usr/bin/env python3
"""ConstructHUB Call Assistant engine — the SignalWire media server (docs/call-assistant/SPEC.md §7).

Routes are unprefixed; the app proxies https://constructhub.us/voice/<route> here:
  POST /signalwire/voice   LaML webhook → verify → app /profile → <Reject/> | <Say+Hangup> | <Connect><Stream/><Hangup/>
  POST /signalwire/status  status callbacks (verified) → app /status
  GET  /media              the media WebSocket (8 kHz mu-law both ways) — one Call per stream
  GET  /health             {ok, models, activeCalls, …}
  GET  /samples/{id}.mp3   the persona samples (the app serves the same files at /persona-samples/)
  GET  /personas           bearer — the verified persona list (personas.json)
  POST /sim/session        bearer — {compiled, orgId?, callerNumber?, timezone?} → {sessionId, greeting, compiledVersion}
  POST /sim/turn           bearer — {sessionId, text, silence?} → Decision + {ended, outcome, events}
  DELETE /sim/session/{id} bearer — {ended, summary, report}
  POST /tts/preview        bearer — {personaId|voice, text} → audio/wav (24 kHz mono)

Multi-tenant port of Alpine's Janice server: the compiled profile fetched from the app at the webhook decides
the persona voice, greeting, timings, vocabulary and prompt for that call; the engine never touches Postgres.
Every hard-won media rule is kept (see Call): paced sender, time-based playback state, barge-in with echo
correlation, echo-sentence stripping, Whisper phantom filter, call-whisper filter, greeting delay, silence
watch, goodbye-then-grace hang-up, stall warning, unconditional hang-up."""
from __future__ import annotations

import asyncio
import base64
import difflib
import hashlib
import hmac
import io
import json
import logging
import re
import secrets
import time
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from aiohttp import web

import audio
from app_client import AppClient, CallProfile, ProfileUnavailable
from brain import Brain
from config import settings
from decision import SAY_MAX
from speech import DEFAULT_VOCAB, STT, TTS, VAD, load_personas, persona_voice, sentences, verify_personas

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── media tuning (Alpine's proven values; per-org timings come from the compiled profile) ───────────────
PREROLL = 10                                   # frames of audio kept before speech starts
WHISPER_RE = re.compile(r"^(call from|incoming call|this call is from|call for|you have a call)\b|landing pages?|call ?rail|tracking number", re.I)
WHISPER_WINDOW_S = 15.0                        # CallRail-style whisper announcements arrive in the first seconds
STALL_S = 8.0                                  # no inbound media for this long → warning (one-way audio upstream)
SHORT_OK = {"yes", "no", "okay", "ok", "okay goodbye", "goodbye", "bye", "bye bye", "thank you goodbye", "thanks bye", "correct",
            "that's right", "that's correct", "sure", "yeah", "yep", "nope", "no thanks", "no thank you", "thanks", "thank you",
            "yes please", "no that's it", "that's it", "that's all", "hello", "hello?"}
HALLUCINATIONS = {"you", "thank you", "thanks", "bye", "goodbye", "thank you for watching", "thanks for watching", "okay", "so", "um", "uh", "hmm", "the", "yeah"}
GENERIC_UNKNOWN = "I'm sorry, this number isn't set up to take calls right now. Goodbye."
GENERIC_DOWN = "I'm sorry, we can't take your call right now. Please try again in a few minutes. Goodbye."
SIM_TTL_S = 30 * 60
SIM_MAX_SESSIONS = 200
PENDING_TTL_S = 120

CLIENT = web.AppKey("client", AppClient)
PROVIDER = web.AppKey("provider", object)        # None → providers.make_provider() (voice/.env)
LOAD_MODELS = web.AppKey("load_models", bool)

stt: STT | None = None
tts: TTS | None = None
PERSONAS: dict[str, Any] = {"verified": False, "personas": []}
ACTIVE: set["Call"] = set()
SIM_SESSIONS: dict[str, dict[str, Any]] = {}
# callSid → (time, profile, stream token, from, to) minted at the verified webhook. The public /media socket only
# runs a call that presents the token from the <Stream> it was handed (QA: forged streams poisoned the spam ledger,
# filed leads and burned minutes); one use, then it is gone.
PENDING_PROFILES: dict[str, tuple[float, CallProfile, str, str, str]] = {}
GREET_CACHE: dict[str, bytes] = {}
STARTED = datetime.now(timezone.utc)


def twiml(xml: str) -> web.Response:
    return web.Response(text=f'<?xml version="1.0" encoding="UTF-8"?><Response>{xml}</Response>', content_type="text/xml")


def xml_escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def pcm24_to_mulaw(x: np.ndarray) -> bytes:
    return audio.mulaw_encode(audio.resample(x, TTS.SR, audio.PHONE_SR))


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


# ── SignalWire webhook verification ─────────────────────────────────────────────────────────────────────

def valid_signature(req: web.Request, form: dict[str, str]) -> bool:
    """Twilio-style request signing (HMAC-SHA1 of url + sorted form, base64). SignalWire's LaML webhooks sign the
    same way; the signing key and (older spaces) the API token are both accepted."""
    if settings.skip_signature:
        return True
    toks = [t for t in (settings.sw_signing_key, settings.sw_api_token) if t]
    if not toks:
        return False
    proto = req.headers.get("X-Forwarded-Proto", req.scheme)
    host = req.headers.get("X-Forwarded-Host", req.host)
    prefix = req.headers.get("X-Forwarded-Prefix", "")
    url = f"{proto}://{host}{prefix}{req.path}"
    s = url + "".join(k + form[k] for k in sorted(form))
    got = req.headers.get("X-Twilio-Signature") or req.headers.get("X-SignalWire-Signature") or ""
    mine = [base64.b64encode(hmac.new(t.encode(), s.encode(), hashlib.sha1).digest()).decode() for t in toks]
    ok = any(hmac.compare_digest(m, got) for m in mine)
    if not ok:
        log.info("signature mismatch url=%s got=%s", url, got[:12])
    return ok


SID_RE = re.compile(r"^[A-Za-z0-9-]{10,64}$")


async def call_lookup(call_sid: str) -> dict[str, Any] | None:
    """The call as our SignalWire project knows it (LaML REST), or None (unknown, not ours, or no credentials)."""
    sp, pj, tk = settings.sw_space_url, settings.sw_project_id, settings.sw_api_token
    if not (sp and pj and tk and call_sid and SID_RE.match(call_sid)):
        return None
    host = re.sub(r"^https?://", "", sp).strip("/")
    try:
        async with httpx.AsyncClient(timeout=8.0, auth=(pj, tk)) as c:
            r = await c.get(f"https://{host}/api/laml/2010-04-01/Accounts/{pj}/Calls/{call_sid}.json")
        return r.json() if r.status_code == 200 else None
    except Exception as e:  # noqa: BLE001
        log.warning("call lookup failed: %s", e)
        return None


def _last10(x: str | None) -> str:
    return "".join(ch for ch in (x or "") if ch.isdigit())[-10:]


async def call_is_real(call_sid: str, to: str) -> bool:
    """Fallback authenticity check: the CallSid must exist in our SignalWire project, be live, and be to `to`."""
    j = await call_lookup(call_sid)
    return bool(j) and j.get("status") in ("queued", "ringing", "in-progress") and _last10(j.get("to")) == _last10(to)


def said(text: str) -> str:
    """What a caller said, for the journal: the words only with VOICE_LOG_TRANSCRIPTS=1, else just the length."""
    return text if settings.log_transcripts else f"<{len(text or '')} chars>"


def mask(n: str | None) -> str:
    """A caller number in the journal: last four digits only (SPEC §17 — no PII in logs beyond the CRM's)."""
    d = "".join(c for c in (n or "") if c.isdigit())
    return f"…{d[-4:]}" if d else "unknown"


def e164(n: str) -> str:
    d = "".join(c for c in (n or "") if c.isdigit())
    if n.startswith("+") and d:
        return "+" + d
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    return n


# ── public (SignalWire) ─────────────────────────────────────────────────────────────────────────────────

async def signalwire_voice(req: web.Request) -> web.Response:
    form = {k: str(v) for k, v in (await req.post()).items()}
    call_sid, frm, to = form.get("CallSid", ""), e164(form.get("From", "")), e164(form.get("To", ""))
    if not SID_RE.match(call_sid):
        log.warning("rejected webhook with a malformed CallSid from %s", req.remote)
        return web.Response(status=400, text="bad CallSid")
    if not valid_signature(req, form):
        if await call_is_real(call_sid, to):
            log.info("webhook accepted via SignalWire call lookup (%s)", call_sid)
        else:
            log.warning("rejected unsigned/invalid webhook from %s", req.remote)
            return web.Response(status=403, text="bad signature")
    app: AppClient = req.app[CLIENT]
    if not (stt and tts):
        log.error("call %s refused: models not loaded", call_sid)
        return twiml(f"<Say>{xml_escape(GENERIC_DOWN)}</Say><Hangup/>")
    try:
        profile = await app.profile(to, frm, call_sid)
    except ProfileUnavailable as e:
        log.info("call %s → %s: %s", call_sid, to, e.code)
        return twiml(f"<Say>{xml_escape(e.say or GENERIC_UNKNOWN)}</Say><Hangup/>")
    except Exception as e:  # noqa: BLE001
        log.error("profile fetch failed for %s: %s", call_sid, e)
        return twiml(f"<Say>{xml_escape(GENERIC_DOWN)}</Say><Hangup/>")
    if (profile.caller or {}).get("blocked"):
        log.info("blocked spammer %s -> %s (%s)", mask(frm), to, call_sid)
        asyncio.create_task(report_blocked(app, profile, call_sid, frm, to))
        return twiml('<Reject reason="rejected"/>')
    if len(ACTIVE) >= settings.max_active_calls:
        log.warning("call %s refused: %d active calls (cap %d)", call_sid, len(ACTIVE), settings.max_active_calls)
        return twiml(f"<Say>{xml_escape(GENERIC_DOWN)}</Say><Hangup/>")
    now = time.time()
    for k, entry in list(PENDING_PROFILES.items()):
        if now - entry[0] > PENDING_TTL_S:
            PENDING_PROFILES.pop(k, None)
    token = secrets.token_urlsafe(24)
    PENDING_PROFILES[call_sid] = (now, profile, token, frm, to)
    log.info("incoming call %s -> %s (%s) org=%s persona=%s", mask(frm), to, call_sid, profile.org.get("name"), (profile.compiled.get("persona") or {}).get("id"))
    # <Hangup/> after the stream: when the engine closes the media socket the call ends, whatever happened before
    return twiml(f'<Connect><Stream url="{xml_escape(settings.media_ws_url)}">'
                 f'<Parameter name="from" value="{xml_escape(frm)}"/><Parameter name="to" value="{xml_escape(to)}"/>'
                 f'<Parameter name="callSid" value="{xml_escape(call_sid)}"/><Parameter name="token" value="{xml_escape(token)}"/>'
                 f'</Stream></Connect><Hangup/>')


async def report_blocked(app: AppClient, profile: CallProfile, call_sid: str, frm: str, to: str) -> None:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    persona = (profile.compiled.get("persona") or {}).get("id", "")
    await app.call_started({"callSid": call_sid, "to": to, "from": frm, "numberId": profile.number.get("id"), "startedAt": now,
                            "engine": settings.engine_name, "model": "", "persona": persona, "profileVersion": profile.version})
    await app.call_finished(call_sid, {"endedAt": now, "durationSeconds": 0, "outcome": "blocked", "summary": "", "transcript": [],
                                       "slots": {}, "events": [{"t": now, "type": "blocked"}], "caller": {"name": "", "email": "", "address": "", "city": ""},
                                       "serviceNeeded": ""})


async def signalwire_status(req: web.Request) -> web.Response:
    """Status callbacks: signed, or a CallSid our SignalWire project knows (any status — the call is usually over)."""
    form = {k: str(v) for k, v in (await req.post()).items()}
    call_sid = form.get("CallSid", "")
    if not valid_signature(req, form) and not await call_lookup(call_sid):
        log.warning("rejected unsigned/unknown status callback from %s", req.remote)
        return web.Response(status=403, text="bad signature")
    await req.app[CLIENT].status_callback({"callSid": call_sid, "callStatus": form.get("CallStatus"), "duration": form.get("CallDuration")})
    return web.Response(text="ok")


# ── the call ────────────────────────────────────────────────────────────────────────────────────────────

class Call:
    """One media stream. Caller audio (8 kHz mu-law) → VAD → Whisper → Brain → Kokoro → mu-law back."""

    def __init__(self, ws: web.WebSocketResponse, app: AppClient, provider: Any = None):
        self.ws, self.app, self.provider = ws, app, provider
        self.sid: str | None = None
        self.call_sid: str | None = None
        self.profile: CallProfile | None = None
        self.brain: Brain | None = None
        self.voice = "af_heart"
        self.vocab = DEFAULT_VOCAB
        self.frm = self.to = ""
        # timings (profile overrides)
        self.greeting_delay = settings.greeting_delay_s
        self.silence_prompt_s = 12.0
        self.max_call_s = 900
        # audio state
        self.pcm16 = np.zeros(0, np.float32)
        self.utter: list[np.ndarray] = []
        self.pre: list[np.ndarray] = []
        self.speaking, self.speech_n, self.silence_n, self.strong_n = False, 0, 0, 0
        self.playing, self.play_task, self.marks_pending = False, None, 0
        self.play_end_at = 0.0                 # wall-clock estimate of when the audio we sent finishes playing
        self.no_barge_until = 0.0
        self.played8k = np.zeros(0, np.float32)   # last 6 s we sent, for echo matching
        self.in8k = np.zeros(0, np.float32)       # last second of inbound audio
        self.rec_in: list[bytes] = []             # inbound mu-law frames (the caller leg)
        self.rec_out: list[tuple[float, np.ndarray]] = []   # (wall-clock start, 8 kHz pcm) we played (the assistant leg)
        self.out_q: asyncio.Queue = asyncio.Queue()
        self.sent_until = 0.0
        self.pending: list[np.ndarray] = []       # caller speech that arrived while a turn was in flight — never dropped
        self.overlapped = False
        self.last_ai_text = ""
        self.stt_s = 0.0
        self.ignore_input_until = 0.0
        self.silence_turn: asyncio.Task | None = None
        # tasks / bookkeeping
        self.vad: VAD | None = None
        self.turn_task: asyncio.Task | None = None
        self.watch_task: asyncio.Task | None = None
        self.sender_task: asyncio.Task | None = None
        self.stats_task: asyncio.Task | None = None
        self.greet_task: asyncio.Task | None = None
        self.cap_task: asyncio.Task | None = None
        self.started = time.time()
        self.started_at = datetime.now(timezone.utc)
        self.frames_in = 0
        self.last_in = time.time()
        self.closing = False
        self.finished = False
        self._mark_seen = False

    # ── outbound ────────────────────────────────────────────────────────────────────────────────────

    async def send(self, obj: dict[str, Any]) -> None:
        if not self.ws.closed:
            await self.ws.send_str(json.dumps(obj))

    def is_playing(self) -> bool:
        """SignalWire sends no mark events: the time estimate is the truth, so `playing` can never stick on."""
        if time.time() > self.play_end_at + 0.4:
            self.playing = False
            self.marks_pending = 0
        return self.playing

    async def sender(self) -> None:
        """Drains the outbound queue at real-time pace (with a short lead) so the carrier's playback buffer never
        overflows — flooded audio is dropped by SignalWire and the caller hears 'stops mid-sentence'."""
        while not self.ws.closed:
            mu, mark = await self.out_q.get()
            now = time.time()
            if self.sent_until < now:
                self.sent_until = now
            if self.sent_until - now > settings.pace_lead_s:
                await asyncio.sleep(self.sent_until - now - settings.pace_lead_s)
            if mu:
                await self.send({"event": "media", "streamSid": self.sid, "media": {"payload": base64.b64encode(mu).decode()}})
                self.sent_until += len(mu) / audio.PHONE_SR
            if mark:
                self.marks_pending += 1
                await self.send({"event": "mark", "streamSid": self.sid, "mark": {"name": mark}})

    def flush_out(self) -> None:
        while not self.out_q.empty():
            self.out_q.get_nowait()
        self.sent_until = 0.0
        # the assistant leg of the recording ends where playback was cut
        cut = time.time()
        trimmed = []
        for t0, pcm in self.rec_out:
            if t0 >= cut:
                continue
            keep = int((cut - t0) * audio.PHONE_SR)
            trimmed.append((t0, pcm[:keep] if keep < len(pcm) else pcm))
        self.rec_out = trimmed

    async def play_bytes(self, mu: bytes, mark: str) -> None:
        """Queue one sentence of audio; the sender paces it onto the line."""
        pcm8 = audio.mulaw_decode(mu)
        self.played8k = np.concatenate([self.played8k, pcm8])[-audio.PHONE_SR * 6:]
        start = max(time.time(), self.play_end_at)
        self.play_end_at = start + len(mu) / audio.PHONE_SR
        self.rec_out.append((start, pcm8))
        self.playing = True
        for i in range(0, len(mu), 160):
            self.out_q.put_nowait((mu[i:i + 160], None))
        self.out_q.put_nowait((b"", mark))

    async def speak(self, text: str) -> None:
        """Synthesize sentence by sentence, one sentence ahead of playback; cancellable by barge-in."""
        sents = sentences(text)
        if not sents:
            return
        synth = lambda s: asyncio.create_task(asyncio.to_thread(lambda: pcm24_to_mulaw(tts.synth(s, self.voice))))  # noqa: E731
        nxt = synth(sents[0])
        for n, s in enumerate(sents):
            mu = await nxt
            nxt = synth(sents[n + 1]) if n + 1 < len(sents) else None
            await self.play_bytes(mu, f"s{n}")

    async def wait_played(self, timeout: float = 20) -> None:
        t0 = time.time()
        while self.is_playing() and time.time() - t0 < timeout and not self.ws.closed:
            await asyncio.sleep(0.05)

    async def say(self, text: str) -> None:
        """Speak a reply, then watch for a caller who goes quiet after it."""
        text = " ".join((text or "").split())
        if not text:
            return
        self.last_ai_text = (self.last_ai_text + " " + text)[-600:]
        self.play_task = asyncio.create_task(self.speak(text))
        try:
            await self.play_task
        except asyncio.CancelledError:
            return
        await self.wait_played()
        if self.watch_task:
            self.watch_task.cancel()
        self.watch_task = asyncio.create_task(self.silence_watch())

    # ── lifecycle ───────────────────────────────────────────────────────────────────────────────────

    async def on_start(self, start: dict[str, Any]) -> bool:
        """Authenticate the stream, then set the call up. False (socket closed) when the stream is not a call we
        answered: /media is public, so caller id, number and CallSid from the client are never trusted on their own."""
        if self.brain is not None:
            return True   # a second "start" on the same socket changes nothing
        cp = start.get("customParameters") or {}
        self.sid = str(start.get("streamSid") or "")
        self.call_sid = str(start.get("callSid") or cp.get("callSid") or "")
        if not SID_RE.match(self.call_sid):
            log.warning("media stream refused: malformed CallSid")
            await self.ws.close()
            return False
        pending = PENDING_PROFILES.get(self.call_sid)
        token = str(cp.get("token") or "")
        if pending and token and hmac.compare_digest(pending[2], token):
            PENDING_PROFILES.pop(self.call_sid, None)
            self.profile, self.frm, self.to = pending[1], pending[3], pending[4]   # the webhook's (signed) numbers
        else:
            # No (or a wrong) token: only a CallSid our SignalWire project knows as live, to this number, may run.
            self.frm, self.to = e164(str(cp.get("from", ""))), e164(str(cp.get("to", "")))
            if pending or not await call_is_real(self.call_sid, self.to):
                log.warning("media stream refused: no valid stream token for %s", self.call_sid)
                await self.ws.close()
                return False
            try:
                self.profile = await self.app.profile(self.to, self.frm, self.call_sid)
            except Exception as e:  # noqa: BLE001
                log.error("stream %s without a profile (%s); hanging up", self.call_sid, e)
                await self.ws.close()
                return False
            if (self.profile.caller or {}).get("blocked"):
                log.info("blocked caller on a stream with no webhook profile (%s); hanging up", self.call_sid)
                await self.ws.close()
                return False
        p = self.profile
        c = p.compiled
        timings = c.get("timings") or {}
        self.greeting_delay = float(timings.get("greetingDelaySeconds", self.greeting_delay))
        self.silence_prompt_s = float(timings.get("silencePromptSeconds", self.silence_prompt_s))
        self.max_call_s = int(timings.get("maxCallSeconds", self.max_call_s))
        self.voice = persona_voice(PERSONAS, (c.get("persona") or {}).get("id", ""), (c.get("persona") or {}).get("voice") or "af_heart")
        vocab = c.get("vocabulary") or []
        self.vocab = (DEFAULT_VOCAB + " " + ", ".join(vocab) + ".") if vocab else DEFAULT_VOCAB
        sid = self.call_sid or self.sid

        async def on_event(payload: dict[str, Any]) -> dict[str, Any]:
            return await self.app.call_event(sid, payload)

        self.brain = Brain(c, self.frm, on_event=on_event, caller_info=p.caller, timezone=(p.org or {}).get("timezone"), provider=self.provider)
        self.vad = VAD()
        self.sender_task = asyncio.create_task(self.sender())
        self.stats_task = asyncio.create_task(self.stats())
        self.cap_task = asyncio.create_task(self.cap_watch())
        await self.app.call_started({"callSid": sid, "to": self.to, "from": self.frm, "numberId": p.number.get("id"),
                                     "startedAt": self.started_at.isoformat(timespec="seconds"), "engine": settings.engine_name,
                                     "model": self.brain.model_name, "persona": (c.get("persona") or {}).get("id", ""),
                                     "profileVersion": p.version})
        g = await self.brain.greet()
        log.info("call %s org=%s from=%s voice=%s mediaFormat=%s", sid, p.org.get("name"), mask(self.frm), self.voice, start.get("mediaFormat"))
        self.last_ai_text = g
        self.greet_task = asyncio.create_task(self.greet_after_delay(g))
        return True

    async def greet_after_delay(self, g: str) -> None:
        """Forwarded/bridged calls: the audio path isn't fully open at 'start'. Wait, drop bridge noise, then greet."""
        self.ignore_input_until = time.time() + self.greeting_delay
        await asyncio.sleep(self.greeting_delay)
        self.pcm16 = np.zeros(0, np.float32)
        self.utter, self.pre, self.speaking, self.speech_n = [], [], False, 0
        if self.vad:
            self.vad.reset()
        key = hashlib.sha1(f"{self.voice}|{g}".encode()).hexdigest()
        mu = GREET_CACHE.get(key)
        if mu is None:
            mu = await asyncio.to_thread(lambda: pcm24_to_mulaw(tts.synth(g, self.voice)))
            if len(GREET_CACHE) > 200:
                GREET_CACHE.clear()
            GREET_CACHE[key] = mu
        self.playing = True
        await self.play_bytes(mu, "greet")
        self.no_barge_until = self.play_end_at + 0.3   # nothing interrupts the greeting itself
        self.watch_task = asyncio.create_task(self.silence_watch())

    async def stats(self) -> None:
        """Every 10 s: is inbound audio still flowing? (a carrier stream that goes silent mid-call = one-way audio)"""
        while not self.ws.closed:
            await asyncio.sleep(10)
            gap = time.time() - self.last_in
            log.info("stream stats %s: in_frames=%d last_in=%.1fs ago out_queue=%d playing=%s speaking=%s", self.call_sid, self.frames_in, gap, self.out_q.qsize(), self.is_playing(), self.speaking)
            if gap > STALL_S:
                log.warning("inbound audio stalled: no media from the carrier for %.0fs (call %s)", gap, self.call_sid)

    async def cap_watch(self) -> None:
        """Hard cap on one call (profile.timings.maxCallSeconds): say goodbye and hang up."""
        await asyncio.sleep(max(30, self.max_call_s))
        if self.closing or not self.brain:
            return
        log.info("call %s reached the %ds cap", self.call_sid, self.max_call_s)
        if self.turn_task and not self.turn_task.done():
            self.turn_task.cancel()
        self.brain.end_requested = True
        self.brain.outcome = self.brain.outcome or "info"
        await self.say("I'm sorry, I have to let you go now. Thank you for calling, goodbye.")
        await self.wait_played()
        await self.close()

    # ── inbound ────────────────────────────────────────────────────────────────────────────────────

    async def on_media(self, payload: str) -> None:
        self.frames_in += 1
        self.last_in = time.time()
        raw = base64.b64decode(payload)
        self.rec_in.append(raw)
        if time.time() < self.ignore_input_until or self.vad is None:
            return   # bridge noise before the greeting is not the caller
        pcm8 = audio.mulaw_decode(raw)
        self.in8k = np.concatenate([self.in8k, pcm8])[-audio.PHONE_SR:]
        self.pcm16 = np.concatenate([self.pcm16, audio.resample(pcm8, audio.PHONE_SR, audio.STT_SR)])
        while len(self.pcm16) >= VAD.FRAME:
            f, self.pcm16 = self.pcm16[:VAD.FRAME], self.pcm16[VAD.FRAME:]
            await self.on_frame(f)

    async def on_frame(self, f: np.ndarray) -> None:
        prob = await asyncio.to_thread(self.vad.prob, f)
        if prob > settings.speech_on:
            if not self.speaking:
                self.speaking, self.speech_n, self.silence_n, self.strong_n = True, 0, 0, 0
                self.utter = list(self.pre)
                self.overlapped = time.time() < self.play_end_at - 0.3   # started clearly while the assistant was talking
            self.speech_n += 1
            self.silence_n = 0
            self.utter.append(f)
            rms = audio.rms(f)
            self.strong_n = self.strong_n + 1 if (prob > settings.barge_prob and rms > settings.barge_rms) else 0
            if self.speech_n == 3 and self.watch_task and not self.watch_task.done():
                self.watch_task.cancel()                       # caller is talking: no "are you still there?"
            if self.speech_n == 3 and self.silence_turn and not self.silence_turn.done() and not self.is_playing():
                self.silence_turn.cancel()
                log.info("silence prompt cancelled: caller started talking")
            if self.is_playing() and self.strong_n >= settings.barge_frames and time.time() > self.no_barge_until:
                # deliberate interruption? first make sure it isn't our own echo
                if self.sounds_like_echo():
                    self.strong_n = 0
                    log.info("ignored echo-like interruption")
                else:
                    self.flush_out()
                    await self.send({"event": "clear", "streamSid": self.sid})
                    self.playing, self.marks_pending, self.play_end_at = False, 0, 0.0
                    if self.play_task and not self.play_task.done():
                        self.play_task.cancel()
                    log.info("barge-in by caller")
            # a spam call hangs up regardless of a robocall that keeps talking (harness E4)
            if self.strong_n >= settings.barge_frames and self.brain and self.brain.end_requested and not self.closing \
                    and not self.brain.spam:
                self.brain.end_requested = False   # the caller kept talking: cancel the pending hang-up
                log.info("hang-up cancelled: caller is speaking")
        else:
            self.pre.append(f)
            self.pre = self.pre[-PREROLL:]
            if self.speaking:
                self.silence_n += 1
                self.utter.append(f)
                if self.silence_n >= settings.speech_end_frames:
                    self.speaking = False
                    if self.speech_n >= settings.min_speech_frames:
                        if self.turn_task is None or self.turn_task.done():
                            self.turn_task = asyncio.create_task(self.turn(np.concatenate(self.utter), self.overlapped))
                        else:
                            self.pending.append(np.concatenate(self.utter))   # speech during a turn: queued, never dropped
                            log.info("caller spoke during a turn; queued")
                    self.utter = []

    # ── turns ───────────────────────────────────────────────────────────────────────────────────────

    async def turn(self, pcm16: np.ndarray, overlapped: bool = False) -> None:
        try:
            await self._turn(pcm16, overlapped)
        except asyncio.CancelledError:
            pass
        finally:
            await self.drain_pending()

    async def drain_pending(self) -> None:
        if self.pending and not self.closing and self.brain and not self.brain.end_requested:
            audio_in = np.concatenate(self.pending)
            self.pending = []
            self.turn_task = asyncio.create_task(self.turn(audio_in))

    async def _turn(self, pcm16: np.ndarray, overlapped: bool) -> None:
        if audio.rms(pcm16) < 0.004 or not self.brain:
            return
        t_stt = time.time()
        text = await asyncio.to_thread(stt.transcribe, pcm16, self.vocab)
        self.stt_s = time.time() - t_stt
        norm = " ".join(re.sub(r"[.,!?]", " ", text.lower()).split())
        if not norm or (norm in HALLUCINATIONS and len(pcm16) < 24000):
            return   # Whisper's classic phantom phrases on near-silence; never let them end a call
        if self.last_ai_text:
            kept = self.strip_echo(text)
            if not kept:
                log.info("ignored echo of our own voice: %s", said(text))
                return
            if kept != text:
                log.info("stripped echo: %r -> %r", said(text), said(kept))
            text = kept
        if overlapped and len(text.split()) < 3 and norm not in SHORT_OK:
            log.info("ignored short fragment heard over our own voice: %s", said(text))
            return
        if time.time() - self.started < WHISPER_WINDOW_S and WHISPER_RE.search(text.strip()):
            log.info("ignored call-whisper announcement: %s", said(text))
            return
        await self.wait_played()   # still finishing a sentence? answer after it, not over it
        if self.watch_task:
            self.watch_task.cancel()
        if settings.log_transcripts:
            log.info("caller %s: %s", self.call_sid, text)
        else:
            log.info("caller %s: %d chars", self.call_sid, len(text))
        await self._respond(text, silence=False)

    async def _respond(self, text: str, silence: bool) -> None:
        t_brain = time.time()
        d = await self.brain.respond(text, silence=silence)
        log.info("ai %s: %s [%s] (stt %.1fs, brain %.1fs)", self.call_sid, d.say if settings.log_transcripts else f"{len(d.say)} chars", d.action,
                 0.0 if silence else self.stt_s, time.time() - t_brain)
        if d.say:
            await self.say(d.say)
        if self.brain.end_requested:
            await self.wait_played()
            await asyncio.sleep(1.5)            # grace: let a last word land before the line drops
            if self.brain.end_requested and (not self.speaking or self.brain.spam):
                await self.close()

    async def silence_watch(self) -> None:
        await asyncio.sleep(self.silence_prompt_s)
        if self.closing or (self.turn_task and not self.turn_task.done()) or not self.brain or self.brain.end_requested:
            return
        if self.speaking:   # VAD thinks the caller is mid-sentence; look again shortly rather than giving up
            await asyncio.sleep(4)
            if self.closing or (self.turn_task and not self.turn_task.done()) or self.brain.end_requested:
                return
        log.info("caller silent %.0fs (prompt %d)", self.silence_prompt_s, self.brain.silences + 1)
        self.silence_turn = self.turn_task = asyncio.create_task(self.turn_silence())

    async def turn_silence(self) -> None:
        try:
            if self.pending:   # the caller spoke after all — answer them instead
                return
            await self._respond("", silence=True)
        except asyncio.CancelledError:
            pass
        finally:
            await self.drain_pending()

    # ── echo ────────────────────────────────────────────────────────────────────────────────────────

    def sounds_like_echo(self) -> bool:
        """Normalized cross-correlation of the last 0.6 s of inbound audio against the last 6 s we played."""
        x = self.in8k[-4800:]
        y = self.played8k
        if len(x) < 2400 or len(y) < len(x):
            return False
        x = x - x.mean()
        y = y - y.mean()
        n = 1 << (len(x) + len(y) - 1).bit_length()
        corr = np.fft.irfft(np.fft.rfft(y, n) * np.conj(np.fft.rfft(x, n)), n)[:len(y) - len(x) + 1]
        ey = np.convolve(y * y, np.ones(len(x)), "valid")
        ex = float(np.sum(x * x))
        score = float(np.max(np.abs(corr) / (np.sqrt(ey * ex) + 1e-9)))
        log.info("echo check: corr=%.2f", score)
        return score > settings.echo_corr

    def strip_echo(self, text: str) -> str:
        """Remove sentences that are really our own voice coming back; return what the caller actually said."""
        ours = [o.strip().lower() for o in sentences(self.last_ai_text) if o.strip()]
        keep = []
        for sent in sentences(text):
            n = sent.strip().lower().strip(" .!?,")
            if not n:
                continue
            echo = any((len(n) >= 8 and n in o) or difflib.SequenceMatcher(None, n, o).ratio() > 0.72 for o in ours)
            if not echo:
                keep.append(sent.strip())
        return " ".join(keep)

    # ── end ─────────────────────────────────────────────────────────────────────────────────────────

    def _stop_tasks(self) -> None:
        me = asyncio.current_task()
        for t in (self.sender_task, self.stats_task, self.watch_task, self.greet_task, self.cap_task):
            if t and not t.done() and t is not me:
                t.cancel()

    async def close(self) -> None:
        """Hang up FIRST, then do the bookkeeping (force-submit, summary, report, recording upload): the caller must
        never sit on a silent line while we file paperwork, and a failure in it can never keep the line open."""
        if self.closing:
            return
        self.closing = True
        self._stop_tasks()
        try:
            await asyncio.wait_for(self.ws.close(), 5)
        except Exception as ex:  # noqa: BLE001
            log.warning("ws close failed (%s): %s", self.call_sid, ex)
        try:
            await self.finish()
        except Exception as ex:  # noqa: BLE001
            log.exception("finish failed after hang-up: %s", ex)

    def _recording(self) -> np.ndarray:
        inbound = audio.mulaw_decode(b"".join(self.rec_in))
        outbound = np.zeros(len(inbound), np.float32)
        for t0, pcm in self.rec_out:
            i = int((t0 - self.started) * audio.PHONE_SR)
            if i < 0:
                pcm, i = pcm[-i:], 0
            if i >= len(outbound):
                outbound = np.pad(outbound, (0, i + len(pcm) - len(outbound)))
            end = i + len(pcm)
            if end > len(outbound):
                outbound = np.pad(outbound, (0, end - len(outbound)))
            outbound[i:end] += pcm
        return audio.mix_legs(inbound, outbound)

    async def finish(self) -> None:
        try:
            await self._finish()
        finally:
            ACTIVE.discard(self)   # only now is the call really over (restart-when-idle watches activeCalls)

    async def _finish(self) -> None:
        if self.finished or not self.brain:
            self.finished = True
            return
        self.finished = True
        if self.turn_task and not self.turn_task.done() and asyncio.current_task() is not self.turn_task:
            self.turn_task.cancel()   # torn down mid-turn (caller hung up); never cancel ourselves
        self._stop_tasks()
        sid = self.call_sid or self.sid or "unknown"
        try:
            await asyncio.wait_for(self.brain.finish(), 30)
        except Exception as e:  # noqa: BLE001
            log.warning("brain.finish failed: %s", e)
        dur = int(time.time() - self.started)
        wav_path: Path | None = None
        if self.rec_in:
            try:
                wav_path = settings.recordings_dir / f"{sid}.wav"
                await asyncio.to_thread(audio.write_wav, wav_path, self._recording())
            except Exception as ex:  # noqa: BLE001
                log.warning("recording write failed: %s", ex)
                wav_path = None
        report = await self.brain.report(datetime.now(timezone.utc), dur)
        res = await self.app.call_finished(sid, report)
        log.info("call %s finished: %s (%ss) → %s", sid, report["outcome"], dur, json.dumps(res)[:200])
        if wav_path and wav_path.exists():
            up = await self.app.upload_recording(sid, wav_path)
            if up.get("recordingKey"):
                try:
                    wav_path.unlink()
                except OSError:
                    pass
            else:
                log.warning("recording kept at %s (upload failed: %s)", wav_path, up.get("error"))


async def media_ws(req: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(req)
    if not (stt and tts):
        log.error("media stream refused: models not loaded")
        await ws.close()
        return ws
    if len(ACTIVE) >= settings.max_active_calls:
        log.warning("media stream refused: %d active calls (cap %d)", len(ACTIVE), settings.max_active_calls)
        await ws.close()
        return ws
    call = Call(ws, req.app[CLIENT], req.app.get(PROVIDER))
    ACTIVE.add(call)
    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                ev = json.loads(msg.data)
            except ValueError:
                continue
            e = ev.get("event")
            if e == "start":
                if not await call.on_start(ev.get("start") or {}):
                    break
            elif call.brain is None:
                continue   # nothing but "start" counts before the stream is authenticated
            elif e == "media":
                if ev["media"].get("track", "inbound") == "inbound":
                    await call.on_media(ev["media"]["payload"])
            elif e == "mark":
                if not call._mark_seen:
                    call._mark_seen = True
                    log.info("carrier returns mark events")
                call.marks_pending = max(0, call.marks_pending - 1)
                if call.marks_pending == 0:
                    call.playing = False
                    call.play_end_at = min(call.play_end_at, time.time())
            elif e == "stop":
                log.info("carrier sent stop (%s)", call.call_sid)
                break
            elif e not in ("connected", "dtmf"):
                log.info("carrier event: %s", json.dumps(ev)[:300])
    finally:
        log.info("websocket closed: code=%s in_frames=%d (%s)", ws.close_code, call.frames_in, call.call_sid)
        if call.brain and not call.closing:   # the caller (or the carrier) hung up first
            call.closing = True
            try:
                await call.finish()
            except Exception as ex:  # noqa: BLE001
                log.exception("finish failed: %s", ex)
        elif not call.brain:
            ACTIVE.discard(call)
        # else: close() is running the bookkeeping and removes the call from ACTIVE when it is done
    return ws


SAMPLES_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "persona-samples"


async def persona_sample(req: web.Request) -> web.StreamResponse:
    """Public: the persona sample MP3s (client/public/persona-samples/). The app serves them itself at
    /persona-samples/<id>.mp3 (outside the /voice/* proxy); this copy stays for direct engine/tailnet checks."""
    name = req.match_info["name"]
    m = re.fullmatch(r"([a-z]{2,20})\.mp3", name)
    ids = {p["id"] for p in PERSONAS.get("personas", [])}
    path = SAMPLES_DIR / name
    if not m or m.group(1) not in ids or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400"})


async def health(req: web.Request) -> web.Response:
    """Public (it is reachable at https://constructhub.us/voice/health): liveness only. The settings summary (hosts,
    model, which secrets are set — never their values) is added for bearer callers (the app, the operator)."""
    out = {"ok": True, "models": bool(stt and tts), "activeCalls": len(ACTIVE), "simSessions": len(SIM_SESSIONS),
           "personasVerified": bool(PERSONAS.get("verified")), "startedAt": STARTED.isoformat(timespec="seconds")}
    if bearer_ok(req):
        out["settings"] = settings.describe()
    return web.json_response(out)


# ── internal (app → engine, bearer) ─────────────────────────────────────────────────────────────────────

async def personas(_req: web.Request) -> web.Response:
    return web.json_response(PERSONAS)


def _sim_gc() -> None:
    now = time.time()
    for k, s in list(SIM_SESSIONS.items()):
        if now - s["touched"] > SIM_TTL_S:
            SIM_SESSIONS.pop(k, None)


async def sim_session(req: web.Request) -> web.Response:
    body = await req.json()
    compiled = body.get("compiled") or {}
    if not compiled.get("systemPrompt"):
        return web.json_response({"code": "bad_request", "message": "compiled profile required"}, status=400)
    _sim_gc()
    if len(SIM_SESSIONS) >= SIM_MAX_SESSIONS:
        return web.json_response({"code": "busy", "message": "too many simulator sessions"}, status=503)
    sid = secrets.token_urlsafe(12)
    # simulator calls never reach the CRM: events are recorded on the brain only (dry run)
    brain = Brain(compiled, body.get("callerNumber") or "+15555550100", on_event=None, timezone=body.get("timezone"), provider=req.app.get(PROVIDER),
                  caller_info=body.get("caller") or {}, dry_run=True)
    greeting = await brain.greet()
    SIM_SESSIONS[sid] = {"brain": brain, "orgId": body.get("orgId"), "touched": time.time(), "seen": 0}
    return web.json_response({"sessionId": sid, "greeting": greeting, "compiledVersion": compiled.get("version"), "persona": {"name": brain.assistant, "voice": brain.voice}})


async def sim_turn(req: web.Request) -> web.Response:
    body = await req.json()
    s = SIM_SESSIONS.get(body.get("sessionId") or "")
    if not s or s.get("orgId") != body.get("orgId"):   # a session belongs to the org that opened it
        return web.json_response({"code": "unknown_session"}, status=404)
    brain: Brain = s["brain"]
    if brain.end_requested:
        return web.json_response({"code": "ended", "outcome": brain.final_outcome()}, status=409)
    s["touched"] = time.time()
    silence = bool(body.get("silence"))
    text = "" if silence else str(body.get("text") or "")
    if not text and not silence:
        return web.json_response({"code": "bad_request", "message": "text required"}, status=400)
    d = await brain.respond(text, silence=silence)
    new_events = brain.events[s["seen"]:]
    s["seen"] = len(brain.events)
    out = d.to_json()
    out.update({"ended": brain.end_requested, "outcome": brain.final_outcome() if brain.end_requested else None, "events": new_events})
    return web.json_response(out)


async def sim_delete(req: web.Request) -> web.Response:
    org = req.query.get("orgId")
    try:
        body = await req.json() if req.can_read_body else {}
    except ValueError:
        body = {}
    org = org or (body or {}).get("orgId")
    s = SIM_SESSIONS.get(req.match_info["id"])
    if s and s.get("orgId") != org:
        s = None
    if s:
        SIM_SESSIONS.pop(req.match_info["id"], None)
    if not s:
        return web.json_response({"ended": True, "summary": "", "report": None})
    brain: Brain = s["brain"]
    await brain.finish()
    report = await brain.report()
    return web.json_response({"ended": True, "summary": report["summary"], "report": report})


async def tts_preview(req: web.Request) -> web.Response:
    if not tts:
        return web.json_response({"code": "models_not_loaded"}, status=503)
    body = await req.json()
    text = " ".join(str(body.get("text") or "").split())[:SAY_MAX]
    if not text:
        return web.json_response({"code": "bad_request", "message": "text required"}, status=400)
    voice = body.get("voice") or persona_voice(PERSONAS, str(body.get("personaId") or ""), "")
    known = {p["voice"] for p in PERSONAS.get("personas", [])}
    if not voice or (voice not in known and not re.fullmatch(r"[a-z]{2}_[a-z]+", voice)):
        return web.json_response({"code": "bad_request", "message": "unknown persona"}, status=400)
    pcm = await asyncio.to_thread(tts.synth, text, voice)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TTS.SR)
        w.writeframes((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes())
    return web.Response(body=buf.getvalue(), content_type="audio/wav", headers={"Cache-Control": "no-store"})


# ── app ─────────────────────────────────────────────────────────────────────────────────────────────────

async def on_startup(app: web.Application) -> None:
    global stt, tts, PERSONAS
    log.info("settings: %s", json.dumps(settings.describe()))
    if app.get(CLIENT) is None:
        app[CLIENT] = AppClient()
    try:
        await app[CLIENT].health()
        log.info("app reachable at %s; internal secret accepted", settings.app_url)
    except Exception as e:  # noqa: BLE001
        log.warning("app health check failed (%s) — calls cannot be served until it passes", e)
    PERSONAS = load_personas()
    if app.get(LOAD_MODELS, True):
        try:
            log.info("loading models on %s…", settings.tts_device)
            tts = await asyncio.to_thread(TTS)
            stt = await asyncio.to_thread(STT)
            PERSONAS = await asyncio.to_thread(verify_personas, tts)
            settings.recordings_dir.mkdir(parents=True, exist_ok=True)
            log.info("models ready; personas verified: %s", [(p["id"], p["voice"]) for p in PERSONAS["personas"]])
        except Exception as e:  # noqa: BLE001
            log.exception("model load failed — /health reports models=false, calls are refused: %s", e)


async def on_cleanup(app: web.Application) -> None:
    await app[CLIENT].aclose()


def make_app(load_models: bool = True, client: AppClient | None = None, provider: Any = None) -> web.Application:
    """`client` / `provider` are injection points for the self-tests (a mock app, a stub brain provider)."""
    app = web.Application(middlewares=[internal_auth])
    app[LOAD_MODELS] = load_models
    app[CLIENT] = client
    app[PROVIDER] = provider
    app.add_routes([
        web.post("/signalwire/voice", signalwire_voice),
        web.post("/signalwire/status", signalwire_status),
        web.get("/media", media_ws),
        web.get("/health", health),
        web.get("/samples/{name}", persona_sample),
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
    problems = settings.startup_problems()
    if problems:
        for msg in problems:
            log.error("refusing to start: %s", msg)
        raise SystemExit(2)
    # On stop (deploys/restarts) keep serving active calls for up to 10 minutes before exiting (the unit's
    # TimeoutStopSec matches). Never restart during a live call: deploy/restart-when-idle.sh.
    web.run_app(make_app(), host=list(settings.bind), port=settings.port, access_log=None, shutdown_timeout=600)
