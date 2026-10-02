"""server.py — webhook, verification, internal routes, simulator, and one whole media call (fake VAD/STT/TTS, real
Call loop, real pacing/playback timing, mock app). No GPU, no network."""
import asyncio
import base64
import copy
import hashlib
import hmac
import json
from pathlib import Path

import numpy as np
import pytest
from aiohttp.test_utils import TestClient, TestServer

import audio
import server
from app_client import AppClient
from conftest import TEST_ENV
from mock_app import BLOCKED_CALLER, LIVE, LOG, PAUSED, make_mock_app
from stubs import ScriptedProvider

SECRET = TEST_ENV["VOICE_INTERNAL_SECRET"]
SIGNING_KEY = TEST_ENV["SIGNALWIRE_SIGNING_KEY"]
FWD = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "constructhub.us", "X-Forwarded-Prefix": "/voice"}
AUTH = {"Authorization": f"Bearer {SECRET}"}
SAMPLE = json.loads((Path(__file__).resolve().parents[1] / "tests" / "profiles" / "sample.json").read_text(encoding="utf-8"))


def sign(path: str, form: dict) -> str:
    s = f"https://constructhub.us/voice{path}" + "".join(k + form[k] for k in sorted(form))
    return base64.b64encode(hmac.new(SIGNING_KEY.encode(), s.encode(), hashlib.sha1).digest()).decode()


class FakeTTS:
    SR = 24000

    def synth(self, text, voice):
        # 0.25 s of a quiet tone per sentence-ish chunk: enough to exercise pacing and playback state
        n = int(0.25 * self.SR)
        return (0.02 * np.sin(np.arange(n) * 2 * np.pi * 440 / self.SR)).astype(np.float32)


class FakeSTT:
    def __init__(self):
        self.queue = []

    def transcribe(self, pcm16k, vocabulary=""):
        return self.queue.pop(0) if self.queue else ""


class FakeVAD:
    FRAME = 512

    def prob(self, f):
        return 1.0 if audio.rms(f) > 0.05 else 0.0

    def reset(self):
        pass


async def start(compiled=None, provider=None, models=True, monkeypatch=None):
    mock = make_mock_app(SECRET, compiled)
    mock_srv = TestServer(mock)
    await mock_srv.start_server()
    client = AppClient(base_url=str(mock_srv.make_url("")).rstrip("/"), secret=SECRET)
    app = server.make_app(load_models=False, client=client, provider=provider or ScriptedProvider())
    if models and monkeypatch is not None:
        monkeypatch.setattr(server, "stt", FakeSTT())
        monkeypatch.setattr(server, "tts", FakeTTS())
        monkeypatch.setattr(server, "VAD", FakeVAD)
        monkeypatch.setattr(server, "GREET_CACHE", {})   # each test's fake TTS renders its own greeting
    tc = TestClient(TestServer(app))
    await tc.start_server()
    return tc, mock, mock_srv


async def stop(tc, mock_srv):
    await tc.close()
    await mock_srv.close()


def run(coro):
    return asyncio.run(coro)


# ── public + bearer ────────────────────────────────────────────────────────────────────────────────

def test_health_public_and_bearer_routes(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        r = await tc.get("/health")
        j = await r.json()
        assert r.status == 200 and j["ok"] is True and "activeCalls" in j and "settings" not in j   # public: liveness only
        r = await tc.get("/health", headers=AUTH)
        j = await r.json()
        assert j["settings"]["internal_secret"] is True and "selftest" not in json.dumps(j)   # never the value
        for method, path in (("GET", "/personas"), ("POST", "/sim/session"), ("POST", "/sim/turn"), ("POST", "/tts/preview"),
                             ("DELETE", "/sim/session/x")):
            r = await tc.request(method, path)
            assert r.status == 401, path
            r = await tc.request(method, path, headers={"Authorization": "Bearer wrong-secret-0000000"})
            assert r.status == 401, path
        r = await tc.get("/personas", headers=AUTH)
        j = await r.json()
        assert [p["id"] for p in j["personas"]] == ["janice", "gabe", "sofia", "maya", "marcus", "ethan"]
        await stop(tc, ms)
    run(go())


# ── webhook ────────────────────────────────────────────────────────────────────────────────────────

def webhook_form(to=LIVE, frm="+13605550123", sid="CA-test-0001"):
    return {"CallSid": sid, "From": frm, "To": to, "CallStatus": "ringing", "AccountSid": "proj"}


def test_webhook_rejects_unsigned(monkeypatch):
    async def go():
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        r = await tc.post("/signalwire/voice", data=webhook_form(), headers=FWD)
        assert r.status == 403
        form = webhook_form()
        r = await tc.post("/signalwire/voice", data=form, headers={**FWD, "X-Twilio-Signature": "bogus"})
        assert r.status == 403
        assert not [x for x in mock[LOG] if x["path"].endswith("/profile")]   # never asked the app
        await stop(tc, ms)
    run(go())


def test_webhook_live_number_connects_stream(monkeypatch):
    async def go():
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        form = webhook_form()
        r = await tc.post("/signalwire/voice", data=form, headers={**FWD, "X-SignalWire-Signature": sign("/signalwire/voice", form)})
        body = await r.text()
        assert r.status == 200 and r.content_type == "text/xml"
        assert '<Stream url="wss://constructhub.us/voice/media">' in body
        assert '<Parameter name="callSid" value="CA-test-0001"/>' in body and body.endswith("</Connect><Hangup/></Response>")
        prof = [x for x in mock[LOG] if x["path"].endswith("/profile")][0]
        assert prof["query"] == {"to": LIVE, "from": "+13605550123", "callSid": "CA-test-0001"}
        assert "CA-test-0001" in server.PENDING_PROFILES
        server.PENDING_PROFILES.clear()
        await stop(tc, ms)
    run(go())


def test_webhook_unknown_paused_blocked_and_models_down(monkeypatch):
    async def go():
        tc, mock, ms = await start(monkeypatch=monkeypatch)

        async def post(form):
            r = await tc.post("/signalwire/voice", data=form, headers={**FWD, "X-Twilio-Signature": sign("/signalwire/voice", form)})
            return r.status, await r.text()

        st, body = await post(webhook_form(to="+13605550199", sid="CA-unknown"))
        assert st == 200 and "<Say>" in body and "<Hangup/>" in body and "<Stream" not in body
        st, body = await post(webhook_form(to=PAUSED, sid="CA-paused"))
        assert "closed right now" in body and "<Hangup/>" in body
        st, body = await post(webhook_form(frm=BLOCKED_CALLER, sid="CA-blocked"))
        assert '<Reject reason="rejected"/>' in body and "<Stream" not in body
        for _ in range(50):   # the blocked call is reported in the background
            puts = [x for x in mock[LOG] if x["method"] == "PUT" and x["path"].endswith("/calls/CA-blocked")]
            if puts:
                break
            await asyncio.sleep(0.02)
        assert puts[0]["body"]["outcome"] == "blocked" and puts[0]["body"]["durationSeconds"] == 0
        monkeypatch.setattr(server, "stt", None)
        st, body = await post(webhook_form(sid="CA-down"))
        assert "can't take your call right now" in body and "<Stream" not in body
        await stop(tc, ms)
    run(go())


def test_status_callback(monkeypatch):
    async def go():
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        form = {"CallSid": "CA-s1", "CallStatus": "completed", "CallDuration": "42"}
        r = await tc.post("/signalwire/status", data=form, headers=FWD)
        assert r.status == 403      # unsigned and no SignalWire credentials to look it up
        r = await tc.post("/signalwire/status", data=form, headers={**FWD, "X-Twilio-Signature": sign("/signalwire/status", form)})
        assert r.status == 200
        st = [x for x in mock[LOG] if x["path"].endswith("/status")][0]
        assert st["body"] == {"callSid": "CA-s1", "callStatus": "completed", "duration": "42"}
        await stop(tc, ms)
    run(go())


# ── simulator ──────────────────────────────────────────────────────────────────────────────────────

def test_sim_session_turn_delete(monkeypatch):
    async def go():
        prov = ScriptedProvider([
            {"say": "What's the address?", "action": "continue", "slots": {"need": "roof"}},
            {"say": "Sent! Anything else?", "action": "submit_lead", "slots": {"address": "1 Main St, Ferndale", "first_name": "Ann"}},
            {"say": "Bye now.", "action": "end_call", "outcome": "lead_submitted"},
        ])
        tc, mock, ms = await start(provider=prov, monkeypatch=monkeypatch)
        r = await tc.post("/sim/session", json={"compiled": {}}, headers=AUTH)
        assert r.status == 400
        r = await tc.post("/sim/session", json={"compiled": SAMPLE, "orgId": "org-test"}, headers=AUTH)
        j = await r.json()
        sid = j["sessionId"]
        assert j["greeting"] == SAMPLE["greeting"] and j["compiledVersion"] == 1 and j["persona"]["voice"] == "af_heart"
        r = await tc.post("/sim/turn", json={"sessionId": sid, "text": "new roof please"}, headers=AUTH)
        j = await r.json()
        assert j["say"] == "What's the address?" and j["ended"] is False and j["slots"]["phone"] == "+15555550100"
        r = await tc.post("/sim/turn", json={"sessionId": sid, "text": "1 Main St Ferndale, I'm Ann"}, headers=AUTH)
        j = await r.json()
        assert j["action"] == "submit_lead" and any(e["type"] == "lead" for e in j["events"])
        r = await tc.post("/sim/turn", json={"sessionId": sid, "text": "no that's all, bye"}, headers=AUTH)
        j = await r.json()
        assert j["ended"] is True and j["outcome"] == "lead_submitted"
        r = await tc.post("/sim/turn", json={"sessionId": sid, "text": "hello?"}, headers=AUTH)
        assert r.status == 409
        r = await tc.delete(f"/sim/session/{sid}", headers=AUTH)
        j = await r.json()
        assert j["ended"] is True and j["report"]["outcome"] == "lead_submitted" and j["summary"]
        # the simulator never reaches the CRM
        assert not [x for x in mock[LOG] if "/calls" in x["path"]]
        r = await tc.post("/sim/turn", json={"sessionId": sid, "text": "x"}, headers=AUTH)
        assert r.status == 404
        await stop(tc, ms)
    run(go())


def test_tts_preview(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        r = await tc.post("/tts/preview", json={"personaId": "gabe", "text": "Hello there."}, headers=AUTH)
        assert r.status == 200 and r.content_type == "audio/wav"
        data = await r.read()
        assert data[:4] == b"RIFF" and len(data) > 1000
        r = await tc.post("/tts/preview", json={"personaId": "nobody", "text": "x"}, headers=AUTH)
        assert r.status == 400
        await stop(tc, ms)
    run(go())


# ── one whole call over the media WebSocket ────────────────────────────────────────────────────────

FRAME_S = 0.02
SILENT = audio.mulaw_encode(np.zeros(160, np.float32))
LOUD = audio.mulaw_encode((0.3 * np.sin(np.arange(160) * 2 * np.pi * 300 / 8000)).astype(np.float32))


def test_media_call_end_to_end(monkeypatch):
    compiled = copy.deepcopy(SAMPLE)
    compiled["timings"].update(greetingDelaySeconds=0.2, silencePromptSeconds=20)
    prov = ScriptedProvider([
        {"say": "Thanks, Mike. I've sent your request to our team.", "action": "submit_lead",
         "slots": {"need": "siding", "address": "1420 Alabama St, Bellingham", "first_name": "Mike"}},
        {"say": "Have a great day.", "action": "end_call", "outcome": "lead_submitted"},
    ])

    async def go():
        tc, mock, ms = await start(compiled=compiled, provider=prov, monkeypatch=monkeypatch)
        server.stt.queue[:] = ["I need new siding at 1420 Alabama Street in Bellingham, this is Mike.", "Okay, thanks, bye."]
        form = webhook_form(sid="CA-media-1")
        r = await tc.post("/signalwire/voice", data=form, headers={**FWD, "X-Twilio-Signature": sign("/signalwire/voice", form)})
        assert "<Stream" in await r.text()
        ws = await tc.ws_connect("/media")
        await ws.send_str(json.dumps({"event": "connected", "protocol": "Call", "version": "1.0.0"}))
        await ws.send_str(json.dumps({"event": "start", "start": {"streamSid": "MZ1", "callSid": "CA-media-1", "mediaFormat": {"encoding": "audio/x-mulaw"},
                                                                  "customParameters": {"from": "+13605550123", "to": LIVE, "callSid": "CA-media-1"}}}))
        got = {"media": 0, "mark": 0, "first_media_at": None}
        closed = asyncio.Event()

        async def reader():
            async for msg in ws:
                ev = json.loads(msg.data)
                if ev["event"] == "media":
                    got["media"] += 1
                    got["first_media_at"] = got["first_media_at"] or asyncio.get_running_loop().time()
                elif ev["event"] == "mark":
                    got["mark"] += 1
            closed.set()

        rt = asyncio.create_task(reader())
        t0 = asyncio.get_running_loop().time()

        async def frames(payload, seconds):
            for _ in range(int(seconds / FRAME_S)):
                if ws.closed:
                    return
                await ws.send_str(json.dumps({"event": "media", "media": {"track": "inbound", "payload": base64.b64encode(payload).decode()}}))
                await asyncio.sleep(FRAME_S)

        await frames(SILENT, 1.2)                 # greeting delay + the greeting itself (fake TTS ≈ 0.25 s)
        assert got["media"] > 0 and got["first_media_at"] - t0 >= 0.15   # greeting waited for the delay
        await frames(LOUD, 0.6)                   # the caller speaks…
        await frames(SILENT, 2.5)                 # …stops (≈ 0.96 s ends the turn), hears the reply
        await frames(LOUD, 0.6)                   # "okay, thanks, bye"
        await frames(SILENT, 4.0)                 # reply + 1.5 s grace → the engine hangs up
        await asyncio.wait_for(closed.wait(), 5)
        rt.cancel()
        for _ in range(200):                      # bookkeeping happens AFTER the hang-up
            puts = [x for x in mock[LOG] if x["method"] == "PUT" and x["path"].endswith("/calls/CA-media-1")]
            recs = [x for x in mock[LOG] if x["path"].endswith("/recordings/CA-media-1")]
            if puts and recs:
                break
            await asyncio.sleep(0.05)
        started = [x for x in mock[LOG] if x["method"] == "POST" and x["path"].endswith("/calls")][0]["body"]
        assert started["callSid"] == "CA-media-1" and started["numberId"] == "num-1" and started["persona"] == "janice"
        events = [x for x in mock[LOG] if x["path"].endswith("/calls/CA-media-1/events")]
        assert events and events[0]["body"]["type"] == "lead" and events[0]["body"]["slots"]["phone"] == "+13605550123"
        rep = puts[0]["body"]
        assert rep["outcome"] == "lead_submitted", rep
        roles = [t["role"] for t in rep["transcript"]]
        assert roles == ["assistant", "caller", "assistant", "caller", "assistant"], rep["transcript"]
        assert rep["caller"]["name"] == "Mike" and rep["caller"]["city"] == "Bellingham"
        assert recs[0]["body"]["contentType"] == "audio/wav" and recs[0]["body"]["bytes"] > 8000
        assert got["media"] > 20 and got["mark"] >= 3
        assert not server.ACTIVE
        assert not list(Path(TEST_ENV["VOICE_RECORDINGS_DIR"]).glob("CA-media-1*"))   # deleted after upload
        await stop(tc, ms)
    run(go())


def test_media_call_caller_hangs_up_mid_intake_forces_submit(monkeypatch):
    compiled = copy.deepcopy(SAMPLE)
    compiled["timings"].update(greetingDelaySeconds=0.1, silencePromptSeconds=20)
    prov = ScriptedProvider([
        {"say": "What's the street address?", "action": "continue", "slots": {"need": "8 windows"}},
        {"say": "And who am I speaking with?", "action": "continue", "slots": {"address": "500 Grand Ave, Mount Vernon"}},
        {"say": "", "action": "submit_lead", "slots": {}},          # the force-submit decision
    ])

    async def go():
        tc, mock, ms = await start(compiled=compiled, provider=prov, monkeypatch=monkeypatch)
        server.stt.queue[:] = ["I want eight new windows.", "500 Grand Ave in Mount Vernon."]
        ws = await tc.ws_connect("/media")   # no webhook first: the stream fetches its own profile
        await ws.send_str(json.dumps({"event": "start", "start": {"streamSid": "MZ2", "callSid": "CA-media-2",
                                                                  "customParameters": {"from": "+13605550123", "to": LIVE, "callSid": "CA-media-2"}}}))

        async def frames(payload, seconds):
            for _ in range(int(seconds / FRAME_S)):
                await ws.send_str(json.dumps({"event": "media", "media": {"payload": base64.b64encode(payload).decode()}}))
                await asyncio.sleep(FRAME_S)

        await frames(SILENT, 0.8)
        await frames(LOUD, 0.5)
        await frames(SILENT, 2.0)
        await frames(LOUD, 0.5)
        await frames(SILENT, 2.0)
        await ws.send_str(json.dumps({"event": "stop", "stop": {}}))   # the caller hangs up
        await ws.close()
        for _ in range(200):
            puts = [x for x in mock[LOG] if x["method"] == "PUT" and x["path"].endswith("/calls/CA-media-2")]
            if puts:
                break
            await asyncio.sleep(0.05)
        rep = puts[0]["body"]
        assert rep["outcome"] == "lead_submitted"
        assert any(e["type"] == "forced_lead" for e in rep["events"])
        assert [x["body"]["type"] for x in mock[LOG] if x["path"].endswith("/calls/CA-media-2/events")] == ["lead"]
        await stop(tc, ms)
    run(go())


# ── echo handling (pure functions on a Call) ──────────────────────────────────────────────────────

class _WS:
    closed = False


def _call():
    return server.Call(_WS(), None)


def test_echo_correlation_detects_our_own_voice_not_the_caller():
    c = _call()
    rng = np.random.default_rng(7)
    ours = (0.2 * rng.standard_normal(8000 * 4)).astype(np.float32)
    c.played8k = ours
    c.in8k = 0.5 * ours[8000:8000 + 6000]                   # our audio coming back, attenuated and delayed
    assert c.sounds_like_echo()
    c.in8k = (0.2 * rng.standard_normal(6000)).astype(np.float32)   # someone else talking
    assert not c.sounds_like_echo()


def test_strip_echo_keeps_only_what_the_caller_said():
    c = _call()
    c.last_ai_text = "Thanks, Mike. Is the number you're calling from the best one to reach you?"
    assert c.strip_echo("Is the number you're calling from the best one to reach you?") == ""
    assert c.strip_echo("Is the number you're calling from the best one to reach you? Yes it is.") == "Yes it is."
    assert c.strip_echo("My email is mike at gmail dot com.") == "My email is mike at gmail dot com."


class LongTTS(FakeTTS):
    def synth(self, text, voice):
        n = int(3.0 * self.SR)
        return (0.02 * np.sin(np.arange(n) * 2 * np.pi * 440 / self.SR)).astype(np.float32)


def test_barge_in_clears_playback_but_never_during_the_greeting(monkeypatch):
    compiled = copy.deepcopy(SAMPLE)
    compiled["timings"].update(greetingDelaySeconds=0.1, silencePromptSeconds=30)
    prov = ScriptedProvider([{"say": "Here is a long answer about our services.", "action": "continue"},
                             {"say": "Sure, go ahead.", "action": "continue"}])

    async def go():
        tc, mock, ms = await start(compiled=compiled, provider=prov, monkeypatch=monkeypatch)
        monkeypatch.setattr(server, "tts", LongTTS())
        server.stt.queue[:] = ["What do you do?", "Wait, one more thing."]
        ws = await tc.ws_connect("/media")
        await ws.send_str(json.dumps({"event": "start", "start": {"streamSid": "MZ3", "callSid": "CA-barge",
                                                                  "customParameters": {"from": "+13605550123", "to": LIVE, "callSid": "CA-barge"}}}))
        clears = []

        async def reader():
            async for msg in ws:
                ev = json.loads(msg.data)
                if ev["event"] == "clear":
                    clears.append(asyncio.get_running_loop().time())

        rt = asyncio.create_task(reader())

        async def frames(payload, seconds):
            for _ in range(int(seconds / FRAME_S)):
                await ws.send_str(json.dumps({"event": "media", "media": {"payload": base64.b64encode(payload).decode()}}))
                await asyncio.sleep(FRAME_S)

        await frames(SILENT, 0.5)
        await frames(LOUD, 1.0)          # talks over the greeting: never a barge-in
        assert clears == []
        await frames(SILENT, 4.0)        # greeting ends; the overlapped utterance is answered after it
        await frames(LOUD, 1.0)          # interrupts the 3-second reply
        await frames(SILENT, 0.5)
        assert len(clears) == 1
        await ws.close()
        rt.cancel()
        for _ in range(100):
            if [x for x in mock[LOG] if x["method"] == "PUT"]:
                break
            await asyncio.sleep(0.05)
        await stop(tc, ms)
    run(go())


def test_persona_samples_are_served_publicly(monkeypatch):
    """/voice/samples/<id>.mp3 is proxied to the engine, so the engine must serve the Studio's sample files."""
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        server.PERSONAS = server.load_personas()
        for pid in ("janice", "gabe", "sofia", "maya", "marcus", "ethan"):
            r = await tc.get(f"/samples/{pid}.mp3")
            assert r.status == 200 and r.content_type == "audio/mpeg", pid
            assert len(await r.read()) > 10_000
        for bad in ("nobody.mp3", "janice.wav", "..%2Fpersonas.json", "JANICE.mp3"):
            r = await tc.get(f"/samples/{bad}")
            assert r.status == 404, bad
        await stop(tc, ms)
    run(go())
