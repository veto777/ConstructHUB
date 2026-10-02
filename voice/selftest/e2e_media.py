#!/usr/bin/env python3
"""GPU smoke run of the WHOLE engine: a synthetic caller speaks scripted lines (Kokoro, a different voice) as 8 kHz
mu-law over the real /media protocol, against a running server.py, with selftest/mock_app.py standing in for the app.
Real Silero VAD, real faster-whisper, the real brain provider from voice/.env, real Kokoro, real pacing.

Not part of `pytest selftest` (needs the GPU, the models and the AI provider). The engine-lane smoke procedure:

  python selftest/mock_app.py --port 8191 --secret S --dump /tmp/mock-log.json &
  VOICE_PORT=8159 VOICE_BIND=127.0.0.1 VOICE_APP_URL=http://127.0.0.1:8191 VOICE_INTERNAL_SECRET=S \
    VOICE_PUBLIC_BASE=http://127.0.0.1:8159 VOICE_SKIP_SIGNATURE=1 python server.py &
  python selftest/e2e_media.py --engine http://127.0.0.1:8159 --mock http://127.0.0.1:8191 --secret S \
    --script tests/scripts/booking.txt --out /tmp/e2e

(The harness lane's tests/fake_signalwire.py is the full break-test caller; this is the engine's own proof.)"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
import time
from pathlib import Path

import httpx
import numpy as np
from aiohttp import ClientSession, WSMsgType

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import audio  # noqa: E402

LIVE = "+13605550100"
CALLER = "+13605550123"
CALLER_VOICE = "am_puck"


def load_script(path: str) -> list[str]:
    return [s.strip() for s in open(path, encoding="utf-8") if s.strip() and not s.strip().startswith("#")]


async def main(a: argparse.Namespace) -> int:
    from speech import TTS
    tts = TTS()
    lines = load_script(a.script)
    call_sid = f"CA-e2e-{int(time.time())}"
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.post(f"{a.engine}/signalwire/voice", data={"CallSid": call_sid, "From": CALLER, "To": LIVE, "CallStatus": "ringing"})
        print("webhook:", r.status_code, r.text[:200])
        if "<Stream" not in r.text:
            return 1

    ws_url = a.engine.replace("http://", "ws://") + "/media"
    heard: list[np.ndarray] = []
    state = {"last_media": 0.0, "media": 0, "closed": False}

    async with ClientSession() as s, s.ws_connect(ws_url) as ws:
        await ws.send_str(json.dumps({"event": "connected", "protocol": "Call", "version": "1.0.0"}))
        await ws.send_str(json.dumps({"event": "start", "start": {"streamSid": "MZ-e2e", "callSid": call_sid,
                                                                  "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000},
                                                                  "customParameters": {"from": CALLER, "to": LIVE, "callSid": call_sid}}}))
        t0 = time.time()

        async def reader():
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                ev = json.loads(msg.data)
                if ev.get("event") == "media":
                    heard.append(audio.mulaw_decode(base64.b64decode(ev["media"]["payload"])))
                    state["last_media"], state["media"] = time.time(), state["media"] + 1
            state["closed"] = True

        rt = asyncio.create_task(reader())
        silence = audio.mulaw_encode(np.zeros(160, np.float32))

        async def send(mu: bytes):
            for i in range(0, len(mu), 160):
                if ws.closed:
                    return
                await ws.send_str(json.dumps({"event": "media", "media": {"track": "inbound", "payload": base64.b64encode(mu[i:i + 160].ljust(160, b"\xff")).decode()}}))
                await asyncio.sleep(0.02)

        async def wait_reply(timeout: float = 40.0) -> float:
            """Send silence until the assistant has spoken and then gone quiet for 1.3 s; returns reply latency."""
            start, seen_at = time.time(), None
            n0 = state["media"]
            while time.time() - start < timeout and not state["closed"]:
                await send(silence)
                if state["media"] > n0 and seen_at is None:
                    seen_at = time.time()
                if seen_at and time.time() - state["last_media"] > 1.3:
                    break
            return (seen_at - start) if seen_at else -1.0

        lat = await wait_reply()
        print(f"[{time.time() - t0:5.1f}s] greeting heard (after {lat:.1f}s)")
        for line in lines:
            if state["closed"]:
                break
            if line == "(silence)":
                lat = await wait_reply(30)
                print(f"[{time.time() - t0:5.1f}s] CALLER (silent) → reply after {lat:.1f}s")
                continue
            pcm = tts.synth(line, CALLER_VOICE)
            mu = audio.mulaw_encode(audio.resample(pcm, TTS.SR, audio.PHONE_SR) * 0.9)
            print(f"[{time.time() - t0:5.1f}s] CALLER: {line}")
            await send(mu)
            lat = await wait_reply()
            print(f"[{time.time() - t0:5.1f}s]   assistant replied {lat:.1f}s after the caller stopped")
        # let the engine hang up on its own (goodbye + grace); else hang up like a caller would
        end = time.time() + 15
        while not state["closed"] and time.time() < end:
            await send(silence)
        hung_up_by_engine = state["closed"]
        if not ws.closed:
            await ws.send_str(json.dumps({"event": "stop", "stop": {"callSid": call_sid}}))
            await ws.close()
        rt.cancel()
    print("engine hung up:", hung_up_by_engine, "| outbound frames:", state["media"])
    if heard:
        audio.write_wav(out_dir / f"{call_sid}-assistant.wav", np.concatenate(heard))

    # the report reaches the mock app after the hang-up (summary + recording upload)
    async with httpx.AsyncClient(timeout=10, headers={"Authorization": f"Bearer {a.secret}"}) as h:
        rep = None
        for _ in range(120):
            log = (await h.get(f"{a.mock}/__log")).json()
            puts = [x for x in log if x["method"] == "PUT" and x["path"].endswith(f"/calls/{call_sid}")]
            recs = [x for x in log if x["path"].endswith(f"/recordings/{call_sid}")]
            if puts and recs:
                rep = puts[0]["body"]
                break
            await asyncio.sleep(0.5)
    if not rep:
        print("NO REPORT reached the mock app")
        return 1
    (out_dir / f"{call_sid}-report.json").write_text(json.dumps({"report": rep, "log": log}, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nTRANSCRIPT (as the engine heard it)")
    for t in rep["transcript"]:
        print(f"  {t['role']:9s} {t['text']}")
    print("\nOUTCOME:", rep["outcome"], "| duration", rep["durationSeconds"], "s")
    print("SLOTS:", json.dumps(rep["slots"], ensure_ascii=False))
    print("SUMMARY:", rep["summary"])
    print("EVENTS posted mid-call:", [x["body"].get("type") for x in log if x["path"].endswith(f"/calls/{call_sid}/events")])
    print("RECORDING:", recs[0]["body"])
    print("files:", out_dir)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="http://127.0.0.1:8159")
    ap.add_argument("--mock", default="http://127.0.0.1:8191")
    ap.add_argument("--secret", required=True)
    ap.add_argument("--script", default=str(HERE.parent / "tests" / "scripts" / "booking.txt"))
    ap.add_argument("--out", default="/tmp/constructhub-voice-e2e")
    sys.exit(asyncio.run(main(ap.parse_args())))
