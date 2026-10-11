"""outbox.py — durable, idempotent delivery of a finished call's report and recording, with a fake clock and a fake
app that behaves like server/voice/internal-calls.ts (a repeated PUT for a processed call answers the stored result
and delivers nothing again; a repeated recording upload overwrites the same key). "Crashes" are simulated by making
a step raise after the network call and then draining with a NEW Outbox on the same directory (an engine restart)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from outbox import Outbox


class Clock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


class FakeApp:
    """The app side: idempotent on callSid. `down` = transport failure; `reject` = a final HTTP status."""

    def __init__(self):
        self.down = False
        self.recording_down = False
        self.reject: int | None = None
        self.puts: list[str] = []
        self.uploads: list[str] = []
        self.processed: dict[str, dict[str, Any]] = {}
        self.leads_delivered = 0
        self.recordings: dict[str, bytes] = {}

    async def call_finished(self, sid: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.puts.append(sid)
        if self.down:
            return {"error": "connection refused", "status": None}
        if self.reject:
            return {"error": f"HTTP {self.reject}", "status": self.reject}
        if sid not in self.processed:          # the processedAt latch: the post-call work runs once
            self.leads_delivered += 1
            self.processed[sid] = {"callId": f"call-{sid}", "outcome": payload.get("outcome")}
        return dict(self.processed[sid])

    async def upload_recording(self, sid: str, wav: Path) -> dict[str, Any]:
        self.uploads.append(sid)
        if self.recording_down:
            return {"error": "HTTP 503", "status": 503}
        self.recordings[sid] = wav.read_bytes()   # same R2 key every time
        return {"recordingKey": f"voice/org/recordings/{sid}.wav", "seconds": 1}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def wav_in(tmp_path: Path, sid: str) -> Path:
    p = tmp_path / f"{sid}.wav"
    p.write_bytes(b"RIFF" + b"\0" * 60)
    return p


REPORT = {"outcome": "lead_submitted", "durationSeconds": 90, "recordingPending": True}


def test_happy_path_delivers_both_and_cleans_up(tmp_path):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA1")
    ob.enqueue("CA1", REPORT, wav)
    assert run(ob.deliver(app, "CA1")) == "done"
    assert app.puts == ["CA1"] and app.uploads == ["CA1"] and app.leads_delivered == 1
    assert not wav.exists() and ob.pending() == []


def test_job_is_on_disk_before_anything_is_sent(tmp_path):
    ob = Outbox(tmp_path / "outbox", Clock())
    ob.enqueue("CA2", REPORT, None)
    job = json.loads((tmp_path / "outbox" / "CA2.json").read_text())
    assert job["report"] == REPORT and job["reportDone"] is False and job["wav"] is None


def test_app_down_backs_off_then_delivers_after_restart(tmp_path):
    clock, app = Clock(), FakeApp()
    app.down = True
    ob = Outbox(tmp_path / "outbox", clock, base_delay_s=30, max_delay_s=3600)
    wav = wav_in(tmp_path, "CA3")
    ob.enqueue("CA3", REPORT, wav)
    assert run(ob.deliver(app, "CA3")) == "retry"
    assert run(ob.drain(app)) == {"waiting": 1}          # not due yet: no network call
    assert app.puts == ["CA3"]
    clock.t += 30
    assert run(ob.drain(app)) == {"retry": 1}            # second failure: next wait doubles
    assert ob.load("CA3")["nextAt"] == clock.t + 60
    assert wav.exists()
    # the engine restarts while the app is still down, then the app comes back
    app.down = False
    clock.t += 60
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app)) == {"done": 1}
    assert app.leads_delivered == 1 and app.uploads == ["CA3"] and not wav.exists() and ob2.pending() == []


def test_backoff_is_capped(tmp_path):
    clock, app = Clock(), FakeApp()
    app.down = True
    ob = Outbox(tmp_path / "outbox", clock, base_delay_s=30, max_delay_s=120, max_age_s=10**9)
    ob.enqueue("CA4", REPORT, None)
    for _ in range(8):
        run(ob.deliver(app, "CA4"))
        clock.t = ob.load("CA4")["nextAt"]
    assert ob.load("CA4")["nextAt"] - clock.t == 0 and ob.load("CA4")["attempts"] == 8
    clock.t += 1
    run(ob.deliver(app, "CA4"))
    assert ob.load("CA4")["nextAt"] - clock.t == 120


def test_crash_after_report_sent_before_it_was_marked_never_duplicates(tmp_path, monkeypatch):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA5")
    ob.enqueue("CA5", REPORT, wav)

    def crash(job):
        raise RuntimeError("engine killed")
    monkeypatch.setattr(ob, "_save", crash)
    with pytest.raises(RuntimeError):
        run(ob.deliver(app, "CA5"))
    assert app.leads_delivered == 1 and ob.load("CA5")["reportDone"] is False   # the app has it; we never noted it

    ob2 = Outbox(tmp_path / "outbox", clock)              # restart
    assert run(ob2.drain(app)) == {"done": 1}
    assert app.puts == ["CA5", "CA5"]                     # re-sent …
    assert app.leads_delivered == 1                       # … but delivered once (the app's latch)
    assert app.uploads == ["CA5"] and not wav.exists()


def test_crash_between_report_and_recording_uploads_only_the_recording(tmp_path, monkeypatch):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA6")
    ob.enqueue("CA6", REPORT, wav)

    async def killed(sid, path):
        raise RuntimeError("engine killed mid-upload")
    monkeypatch.setattr(app, "upload_recording", killed)
    with pytest.raises(RuntimeError):
        run(ob.deliver(app, "CA6"))
    assert ob.load("CA6")["reportDone"] is True and ob.load("CA6")["recordingDone"] is False
    monkeypatch.undo()

    app2 = FakeApp()
    app2.processed = app.processed
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app2)) == {"done": 1}
    assert app2.puts == [] and app2.uploads == ["CA6"] and not wav.exists()


def test_crash_after_recording_marked_done_only_cleans_up(tmp_path, monkeypatch):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA7")
    ob.enqueue("CA7", REPORT, wav)
    monkeypatch.setattr(ob, "_complete", lambda job: (_ for _ in ()).throw(RuntimeError("killed before cleanup")))
    with pytest.raises(RuntimeError):
        run(ob.deliver(app, "CA7"))
    job = ob.load("CA7")
    assert job["reportDone"] and job["recordingDone"] and wav.exists()

    app2 = FakeApp()
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app2)) == {"done": 1}
    assert app2.puts == [] and app2.uploads == [] and not wav.exists() and ob2.pending() == []


def test_recording_failure_retries_only_the_recording(tmp_path):
    clock, app = Clock(), FakeApp()
    app.recording_down = True
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA8")
    ob.enqueue("CA8", REPORT, wav)
    assert run(ob.deliver(app, "CA8")) == "retry"
    app.recording_down = False
    clock.t += 30
    assert run(ob.drain(app)) == {"done": 1}
    assert app.puts == ["CA8"] and app.uploads == ["CA8", "CA8"] and not wav.exists()


def test_a_final_rejection_is_not_retried_and_keeps_the_wav(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject = 404
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA9")
    ob.enqueue("CA9", REPORT, wav)

    async def rejected(sid, path):
        app.uploads.append(sid)
        return {"error": "HTTP 404", "status": 404}
    app.upload_recording = rejected  # type: ignore[method-assign]
    assert run(ob.deliver(app, "CA9")) == "done"
    assert app.puts == ["CA9"] and app.uploads == ["CA9"]
    assert wav.exists() and ob.pending() == []          # nothing to retry; the audio is not thrown away


def test_gives_up_after_max_age_and_keeps_the_wav(tmp_path):
    clock, app = Clock(), FakeApp()
    app.down = True
    ob = Outbox(tmp_path / "outbox", clock, max_age_s=3 * 86400)
    wav = wav_in(tmp_path, "CA10")
    ob.enqueue("CA10", REPORT, wav)
    assert run(ob.deliver(app, "CA10")) == "retry"
    clock.t += 3 * 86400
    assert run(ob.drain(app)) == {"failed": 1}
    assert ob.pending() == [] and (tmp_path / "outbox" / "failed" / "CA10.json").exists() and wav.exists()


def test_one_delivery_per_call_at_a_time(tmp_path):
    clock = Clock()
    ob = Outbox(tmp_path / "outbox", clock)
    ob.enqueue("CA11", REPORT, None)
    gate = asyncio.Event()

    class Slow(FakeApp):
        async def call_finished(self, sid, payload):
            await gate.wait()
            return await super().call_finished(sid, payload)
    app = Slow()

    async def both():
        first = asyncio.create_task(ob.deliver(app, "CA11"))
        await asyncio.sleep(0)
        second = await ob.deliver(app, "CA11")
        gate.set()
        return await first, second
    assert run(both()) == ("done", "busy")
    assert app.leads_delivered == 1 and app.puts == ["CA11"]


def test_reenqueue_keeps_steps_already_done(tmp_path):
    clock, app = Clock(), FakeApp()
    app.recording_down = True
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA12")
    ob.enqueue("CA12", REPORT, wav)
    run(ob.deliver(app, "CA12"))
    ob.enqueue("CA12", REPORT, wav)
    assert ob.load("CA12")["reportDone"] is True


def test_bad_sid_is_refused(tmp_path):
    with pytest.raises(ValueError):
        Outbox(tmp_path / "outbox", Clock()).enqueue("../etc/passwd", REPORT, None)
