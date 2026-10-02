#!/usr/bin/env python3
"""Fake SignalWire: a synthetic caller that phones the engine through the REAL stream protocol.

Port of Alpine's tests/fake_twilio.py for ConstructHUB. Each scripted caller line (voice/tests/scenarios/*.txt)
is synthesized with a Kokoro voice no persona uses, sent as 8 kHz mu-law 20 ms frames in real time over the
engine's /media WebSocket; the assistant's audio is captured (and transcribed back with --stt), so the whole
loop runs: VAD → Whisper → brain → Kokoro → paced sender. At the end the engine's own report (which a fake
internal API receives) is scored with the scenario's rubric — including "the call ended itself".

Two ways to run it (both need the engine's venv: torch, kokoro, faster-whisper, silero):

  # 1. in-process (self-contained): this script starts the engine from VOICE_ENGINE_DIR (default: this
  #    checkout's voice/) on a free local port, wired to a fake app in the same process. Canned decisions
  #    make it deterministic (tests the media loop, not the model); drop --canned to use the engine's
  #    configured provider from voice/.env.
  .venv/bin/python tests/fake_signalwire.py --in-process --canned --scenario routine_lead --scenario whisper_filtered

  # 2. against an engine you started yourself, pointed at this script's fake app:
  #    VOICE_APP_URL=http://127.0.0.1:8231 VOICE_INTERNAL_SECRET=<same> VOICE_SKIP_SIGNATURE=1 VOICE_PORT=8153 python server.py
  .venv/bin/python tests/fake_signalwire.py --engine http://127.0.0.1:8153 --fake-app-port 8231 --secret <same> --scenario routine_lead

Options: --no-marks (default: SignalWire sends no mark events; --marks echoes them like Twilio) · --echo 0.3
(feed the assistant's audio back at this gain — handset echo) · --noise 0.01 (line noise) · --webhook (POST
/signalwire/voice first is now always done — the engine refuses a stream without the webhook's token; this flag only
prints the TwiML; needs VOICE_SKIP_SIGNATURE=1 on a loopback-only engine) · --stt (transcribe what
the assistant said, for the console) · --out DIR (WAVs of both legs) · --voice am_puck (the caller's voice).

Never dials anyone: there is no PSTN here, only a WebSocket to an engine on this machine."""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import secrets
import sys
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from harness.engine import CannedProvider, engine_dir, load_compiled  # noqa: E402
from harness.fake_app import FakeApp  # noqa: E402
from harness.report import result_from_report  # noqa: E402
from harness.scenarios import Scenario, load_scenario, load_scenarios  # noqa: E402
from harness.scoring import Card, format_scorecard, score  # noqa: E402

FRAME = 160            # 20 ms at 8 kHz
TO_NUMBER = "+13605550199"


def free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class SwitchProvider:
    """One provider for the in-process engine; the current scenario's CannedProvider answers."""
    model_name = "canned"

    def __init__(self) -> None:
        self.current: CannedProvider | None = None

    async def decide(self, *a: Any, **k: Any) -> str:
        assert self.current is not None
        return await self.current.decide(*a, **k)

    async def text(self, *a: Any, **k: Any) -> str:
        assert self.current is not None
        return await self.current.text(*a, **k)


class Caller:
    """One synthetic call over the media WebSocket."""

    def __init__(self, a: argparse.Namespace, audio: Any, tts: Any, stt: Any, compiled: dict[str, Any]):
        self.a, self.audio, self.tts, self.stt, self.compiled = a, audio, tts, stt, compiled
        self.heard: list[tuple[float, bytes]] = []      # (arrival time, mu-law bytes) from the engine
        self.sent: list[bytes] = []
        self.echo_q: list[bytes] = []
        self.marks_seen = 0
        self.clears = 0
        self.closed_at: float | None = None
        self.latencies: list[float] = []
        self._t_turn: float | None = None

    def synth(self, text: str) -> bytes:
        pcm = self.tts.synth(text, self.a.voice)
        return self.audio.mulaw_encode(self.audio.resample(pcm, 24000, 8000) * 0.9)

    def noise_frame(self) -> bytes:
        x = np.random.uniform(-self.a.noise, self.a.noise, FRAME).astype(np.float32) if self.a.noise else np.zeros(FRAME, np.float32)
        if self.a.echo and self.echo_q:
            e = self.audio.mulaw_decode(self.echo_q.pop(0)) * self.a.echo
            x = x + np.pad(e, (0, max(0, FRAME - len(e))))[:FRAME]
        return self.audio.mulaw_encode(x)

    async def run(self, sc: Scenario, engine: str, call_sid: str, token: str = "") -> tuple[bool, str]:
        """Plays the scenario. Returns (call ended — by the engine or a caller hang-up, end_reason)."""
        import aiohttp
        ws_url = engine.replace("http://", "ws://").replace("https://", "wss://").rstrip("/") + "/media"
        sid = "MZ" + secrets.token_hex(16)
        silence_s = float((self.compiled.get("timings") or {}).get("silencePromptSeconds", 12))
        async with aiohttp.ClientSession() as s, s.ws_connect(ws_url) as ws:
            async def send(ev: dict[str, Any]) -> None:
                if not ws.closed:
                    await ws.send_json(ev)

            async def media(chunk: bytes) -> None:
                self.sent.append(chunk)
                await send({"event": "media", "streamSid": sid, "media": {"track": "inbound", "payload": base64.b64encode(chunk).decode()}})

            async def receiver() -> None:
                async for m in ws:
                    if m.type != aiohttp.WSMsgType.TEXT:
                        break
                    ev = json.loads(m.data)
                    if ev.get("event") == "media":
                        if self._t_turn is not None:
                            self.latencies.append(time.time() - self._t_turn)
                            self._t_turn = None
                        b = base64.b64decode(ev["media"]["payload"])
                        self.heard.append((time.time(), b))
                        if self.a.echo:
                            self.echo_q.append(b)
                    elif ev.get("event") == "clear":
                        self.clears += 1
                        self.echo_q.clear()
                        print("   (barge-in: the engine cleared its playback)")
                    elif ev.get("event") == "mark":
                        self.marks_seen += 1
                        if self.a.marks:
                            await send({"event": "mark", "streamSid": sid, "mark": ev.get("mark")})
                self.closed_at = time.time()

            async def silence(sec: float) -> None:
                for _ in range(int(sec * 50)):
                    if ws.closed:
                        return
                    await media(self.noise_frame())
                    await asyncio.sleep(0.02)

            async def play(mu: bytes) -> None:
                for i in range(0, len(mu), FRAME):
                    if ws.closed:
                        return
                    await media(mu[i:i + FRAME])
                    await asyncio.sleep(0.02)

            async def wait_reply(max_wait: float) -> bool:
                """Keep the line alive until the assistant starts talking (True) or max_wait passes."""
                n0, t0 = len(self.heard), time.time()
                while len(self.heard) == n0 and time.time() - t0 < max_wait and not ws.closed:
                    await silence(0.2)
                return len(self.heard) > n0

            async def wait_quiet(max_s: float = 30) -> None:
                """Until the assistant has been silent for 1.2 s (it finished its sentence)."""
                t0 = time.time()
                while time.time() - t0 < max_s and not ws.closed:
                    await silence(0.3)
                    if self.heard and time.time() - self.heard[-1][0] > 1.2 and not self.echo_q:
                        return

            def heard_since(n0: int) -> str:
                if not self.a.stt or self.stt is None:
                    return f"({(len(self.heard) - n0) * FRAME / 8000:.1f}s of audio)"
                pcm = self.audio.mulaw_decode(b"".join(b for _, b in self.heard[n0:]))
                return self.stt.transcribe(self.audio.resample(pcm, 8000, 16000)) or "(unintelligible)"

            await send({"event": "connected", "protocol": "Call", "version": "0.2.0"})
            await send({"event": "start", "sequenceNumber": "1", "streamSid": sid, "start": {
                "streamSid": sid, "callSid": call_sid, "tracks": ["inbound"],
                "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
                "customParameters": {"from": sc.caller, "to": TO_NUMBER, "callSid": call_sid, "token": token}}})
            rx = asyncio.create_task(receiver())

            # CallRail-style whispers are heard in the first seconds, before/while the greeting is due
            lines = list(sc.lines)
            while lines and lines[0].kind == "whisper":
                w = lines.pop(0)
                print(f"WHISPER: {w.text}")
                await play(self.synth(w.text))
            await silence(0.5)
            if await wait_reply(20):
                n0 = 0
                await wait_quiet()
                print(f"AI (greeting): {heard_since(n0)}")
            else:
                print("   (no greeting within 20 s)")

            hung_up = False
            for line in lines:
                if ws.closed:
                    break
                n0 = len(self.heard)
                if line.kind == "hangup":
                    print("CALLER: <hangs up>")
                    await send({"event": "stop", "streamSid": sid, "stop": {"callSid": call_sid}})
                    hung_up = True
                    break
                if line.kind == "whisper":
                    print(f"WHISPER (late): {line.text}")
                    await play(self.synth(line.text))
                    continue
                if line.kind == "silence":
                    print("CALLER: <silence>")
                    got = await wait_reply(silence_s + 6)
                else:
                    print(f"CALLER: {line.text}")
                    await play(self.synth(line.text))
                    self._t_turn = time.time()
                    await silence(1.0)
                    got = await wait_reply(30)
                if got:
                    await wait_quiet()
                    print(f"AI: {heard_since(n0)}")
                elif not ws.closed:
                    print("   (no reply within the wait)")

            # the call should end itself after a goodbye (+ grace); give it a moment unless we hung up
            if not hung_up and not ws.closed:
                t0 = time.time()
                while not ws.closed and time.time() - t0 < self.a.end_wait:
                    await silence(0.2)
            # "ended" = the call ended (the engine hung up, or the caller did) — not the script running out of lines
            ended_by_engine = ws.closed and not hung_up
            reason = "engine" if ended_by_engine else "carrier_stop" if hung_up else "script_end"
            ended = ended_by_engine or hung_up
            if not ws.closed:
                if not hung_up:
                    await send({"event": "stop", "streamSid": sid, "stop": {"callSid": call_sid}})
                await ws.close()
            rx.cancel()
        return ended, reason

    def save(self, out: Path, call_sid: str) -> None:
        out.mkdir(parents=True, exist_ok=True)
        for name, chunks in (("assistant", [b for _, b in self.heard]), ("caller", self.sent)):
            pcm = self.audio.mulaw_decode(b"".join(chunks))
            with wave.open(str(out / f"{call_sid}-{name}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(8000)
                w.writeframes((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes())


async def post_webhook(engine: str, sc: Scenario, call_sid: str) -> str:
    import aiohttp
    form = {"CallSid": call_sid, "AccountSid": "fake-account", "From": sc.caller, "To": TO_NUMBER, "CallStatus": "ringing", "Direction": "inbound"}
    async with aiohttp.ClientSession() as s, s.post(engine.rstrip("/") + "/signalwire/voice", data=form) as r:
        return await r.text()


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", action="append", help="scenario id or path (repeatable); default: every audio/sim scenario")
    ap.add_argument("--tag", help="only scenarios with this tag")
    ap.add_argument("--in-process", action="store_true", help="start the engine (VOICE_ENGINE_DIR) inside this process")
    ap.add_argument("--canned", action="store_true", help="in-process: answer with the scenario's canned decisions")
    ap.add_argument("--engine", help="engine base URL you started (e.g. http://127.0.0.1:8153)")
    ap.add_argument("--fake-app-port", type=int, default=0, help="port for the fake internal API (with --engine)")
    ap.add_argument("--secret", default=os.environ.get("VOICE_INTERNAL_SECRET_TEST", ""), help="bearer the engine uses (with --engine)")
    ap.add_argument("--compiled", help="compiled profile JSON (default server/voice/fixtures/compiled.v1.json)")
    ap.add_argument("--webhook", action="store_true", help="POST /signalwire/voice before streaming (always for mode: webhook)")
    ap.add_argument("--marks", action="store_true", help="echo mark events back (Twilio); SignalWire never does (default off)")
    ap.add_argument("--no-marks", action="store_true", help="(default) do not echo mark events — kept for Alpine's flag name")
    ap.add_argument("--echo", type=float, default=0.0)
    ap.add_argument("--noise", type=float, default=0.0)
    ap.add_argument("--voice", default="am_puck", help="the caller's Kokoro voice (not a persona voice)")
    ap.add_argument("--stt", action="store_true", help="transcribe the assistant's audio for the console")
    ap.add_argument("--end-wait", type=float, default=10.0, help="seconds to wait for the engine to hang up after the last line")
    ap.add_argument("--out", help="directory for WAVs of both legs")
    a = ap.parse_args()
    if not a.in_process and not a.engine:
        ap.error("pass --in-process or --engine URL")

    compiled = load_compiled(a.compiled)
    if a.scenario:
        scenarios = [load_scenario(s) for s in a.scenario]
    else:
        scenarios = [s for s in load_scenarios() if s.mode in ("audio", "sim", "webhook") and (not a.tag or a.tag in s.tags)]
    all_scenarios = load_scenarios()

    fake = FakeApp(compiled, secret=a.secret or None, number=TO_NUMBER)
    runner = None
    switch = SwitchProvider()
    if a.in_process:
        fake_base = await fake.start("127.0.0.1", 0)
        os.environ.update({
            "VOICE_APP_URL": fake_base, "VOICE_INTERNAL_SECRET": fake.secret, "VOICE_SKIP_SIGNATURE": "1",
            "VOICE_RECORDINGS_DIR": str(Path(a.out or "/tmp") / "fake-signalwire-recordings"),
            "VOICE_BIND": "127.0.0.1",
        })
        d = engine_dir()
        sys.path.insert(0, str(d))
        import server  # noqa: E402  — the engine (reads its config now, with the env above winning over voice/.env)
        from aiohttp import web
        port = free_port()
        app = server.make_app(load_models=True, provider=switch if a.canned else None)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", port).start()
        engine = f"http://127.0.0.1:{port}"
        tts, stt = server.tts, server.stt
        if not (tts and stt):
            print("engine models did not load — see the log above", file=sys.stderr)
            return 2
        print(f"engine {d} in-process at {engine}; fake app at {fake_base}; {'canned decisions' if a.canned else 'live provider (voice/.env)'}")
    else:
        if not a.secret:
            ap.error("--secret (or VOICE_INTERNAL_SECRET_TEST) must match the engine's VOICE_INTERNAL_SECRET")
        fake_base = await fake.start("127.0.0.1", a.fake_app_port)
        engine = a.engine
        sys.path.insert(0, str(engine_dir()))
        from speech import STT, TTS  # noqa: E402
        tts, stt = TTS(), (STT() if a.stt else None)
        print(f"engine {engine}; fake app at {fake_base} (start the engine with VOICE_APP_URL={fake_base})")
    import audio  # noqa: E402  — the engine's codec

    cards: list[Card] = []
    try:
        for sc in scenarios:
            # webhook scenarios: run their preludes first so the fake app's ledger blocks the caller
            for pid, times in sc.prelude:
                pre = next(s for s in all_scenarios if s.id == pid)
                for _ in range(times):
                    import dataclasses
                    await call_one(a, dataclasses.replace(pre, caller=sc.caller), engine, fake, switch, audio, tts, stt, compiled, quiet=True)
            card = await call_one(a, sc, engine, fake, switch, audio, tts, stt, compiled)
            cards.append(card)
    finally:
        if runner:
            await runner.cleanup()
        await fake.stop()
    if fake.unauthorized:
        print(f"WARNING: the fake app refused {fake.unauthorized} request(s) with a wrong bearer")
    print("\n" + format_scorecard(cards, f"audio · {'in-process' if a.in_process else engine} · {'canned' if a.canned else 'live'}"))
    return 0 if all(c.ok for c in cards) else 1


async def call_one(a, sc: Scenario, engine: str, fake: FakeApp, switch: SwitchProvider, audio, tts, stt, compiled, quiet: bool = False) -> Card:
    call_sid = "CAfake" + secrets.token_hex(13)
    print(f"\n══ {sc.id} ══ {sc.title}{'  (prelude)' if quiet else ''}")
    switch.current = CannedProvider(sc)
    # Always the webhook first, like SignalWire: the engine only runs a /media stream that presents the token
    # from the <Stream> it handed out (needs VOICE_SKIP_SIGNATURE=1 on a loopback-only dev engine).
    twiml = await post_webhook(engine, sc, call_sid)
    if a.webhook or sc.mode == "webhook":
        print(f"WEBHOOK → {twiml[:160]}")
    if "<Connect" not in twiml:
        r = result_from_report(await fake.wait_report(call_sid, 10), [], ended_by_engine=True, end_reason="pre-answer", twiml=twiml)
        r.errors = [e for e in r.errors if "no end-of-call report" not in e]   # a rejected call may report blocked or nothing
        r.outcome = r.outcome or ("blocked" if "<Reject" in twiml else None)
        return score(sc, r)
    m = re.search(r'<Parameter name="token" value="([^"]+)"/>', twiml)
    caller = Caller(a, audio, tts, stt, compiled)
    t0 = time.time()
    ended, reason = await caller.run(sc, engine, call_sid, m.group(1) if m else "")
    report = await fake.wait_report(call_sid, 60)
    rec = fake.calls.get(call_sid)
    # the recording is uploaded after the end report: wait for it before scoring (and before the next call)
    for _ in range(100):
        if not report or (rec and rec.recording_bytes > 0):
            break
        await asyncio.sleep(0.1)
        rec = fake.calls.get(call_sid)
    r = result_from_report(report, rec.events if rec else [], ended_by_engine=ended, end_reason=reason, twiml=twiml)
    if a.out:
        caller.save(Path(a.out), call_sid)
    card = score(sc, r)
    print(f"   call {time.time() - t0:.0f}s · ended: {ended} ({reason}) · outcome {r.outcome} · recording {rec.recording_bytes if rec else 0} bytes"
          f" · marks sent {caller.marks_seen} · barge-ins {caller.clears} · turn latencies {[round(x, 2) for x in caller.latencies]}")
    if not card.ok and not quiet:
        print("   transcript (engine report):\n      " + "\n      ".join(r.transcript))
    return card


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
