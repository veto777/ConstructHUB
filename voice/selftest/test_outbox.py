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
        self.status_down = False
        self.reject: int | None = None
        self.reject_recording: int | None = None
        self.puts: list[str] = []
        self.uploads: list[str] = []
        self.statuses: list[tuple[str, dict[str, Any]]] = []
        self.processed: dict[str, dict[str, Any]] = {}
        self.leads_delivered = 0
        self.recordings: dict[str, bytes] = {}
        self.recording_state: dict[str, tuple[int, str]] = {}   # sid → (seq, state), the app's flags.recording

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
        if self.reject_recording:
            return {"error": f"HTTP {self.reject_recording}", "status": self.reject_recording}
        self.recordings[sid] = wav.read_bytes()   # same R2 key every time
        return {"recordingKey": f"voice/org/recordings/{sid}.wav", "seconds": 1}

    async def artifact_status(self, sid: str, payload: dict[str, Any]) -> dict[str, Any]:
        """internal-calls.ts applyRecordingStatus: unknown call → 404; only a newer seq applies; a stored recording wins."""
        self.statuses.append((sid, payload))
        if self.status_down:
            return {"error": "HTTP 502", "status": 502}
        if sid not in self.processed:
            return {"error": "HTTP 404", "status": 404}
        rec = payload["recording"]
        seq, _ = self.recording_state.get(sid, (0, "pending"))
        applied = sid not in self.recordings and rec["seq"] > seq
        if applied:
            self.recording_state[sid] = (rec["seq"], rec["state"])
        return {"ok": True, "applied": applied}


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


def test_a_rejected_recording_is_kept_as_a_durable_failure_and_the_app_is_told(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject_recording = 413
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA9")
    ob.enqueue("CA9", REPORT, wav)
    assert run(ob.deliver(app, "CA9")) == "failed"
    assert app.puts == ["CA9"] and app.uploads == ["CA9"]            # not retried
    assert wav.exists() and ob.pending() == [] and ob.failed() == ["CA9"]
    job = ob.load_failed("CA9")
    assert job["failure"] == "rejected" and job["report"] == REPORT and job["wav"] == str(wav)
    assert job["recordingRejected"]["status"] == 413 and "recording: HTTP 413" in job["lastError"]
    # the console learns it at once: failed, with why — not "pending" for three days
    assert app.statuses == [("CA9", {"recording": {"state": "failed", "reason": "HTTP 413: HTTP 413", "seq": 1, "attempts": 1}})]
    assert app.recording_state["CA9"] == (1, "failed")
    assert run(ob.drain(app)) == {}                                     # failed/ is never drained by itself


def test_a_rejected_report_holds_its_recording_and_is_kept(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject = 422
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA20")
    ob.enqueue("CA20", REPORT, wav)
    assert run(ob.deliver(app, "CA20")) == "failed"
    assert app.uploads == [] and app.statuses == []                     # no call on the app side to attach it to
    job = ob.load_failed("CA20")
    assert job["reportRejected"]["status"] == 422 and job["report"] == REPORT and wav.exists()


def test_replay_after_correction_delivers_only_what_was_rejected(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject_recording = 413
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA21")
    ob.enqueue("CA21", REPORT, wav)
    assert run(ob.deliver(app, "CA21")) == "failed"
    app.reject_recording = None                                          # the app's limit was raised
    clock.t += 3600
    job = ob.replay("CA21")
    assert job["replays"] == 1 and job["recordingDone"] is False and job["reportDone"] is True
    assert ob.failed() == [] and ob.pending() == ["CA21"]
    # a NEW engine process (restart) drains the replayed job
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app)) == {"done": 1}
    assert app.puts == ["CA21"] and app.leads_delivered == 1             # the report was never re-sent
    assert app.uploads == ["CA21", "CA21"] and "CA21" in app.recordings and not wav.exists()
    # the replay said "pending" (seq 2) before the upload, so the console showed it uploading again
    assert [p["recording"]["state"] for _, p in app.statuses] == ["failed", "pending"]
    assert [p["recording"]["seq"] for _, p in app.statuses] == [1, 2]
    assert ob2.pending() == [] and ob2.failed() == []


def test_replay_of_a_rejected_report_sends_the_report_then_the_recording(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject = 400
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA22")
    ob.enqueue("CA22", REPORT, wav)
    run(ob.deliver(app, "CA22"))
    app.reject = None                                                    # e.g. the app learned a new outcome
    ob.replay("CA22")
    assert run(ob.drain(app)) == {"done": 1}
    assert app.puts == ["CA22", "CA22"] and app.leads_delivered == 1 and app.uploads == ["CA22"] and not wav.exists()


def test_replay_refuses_an_unknown_or_already_queued_job(tmp_path):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    with pytest.raises(KeyError):
        ob.replay("CA23")
    app.reject = 404
    ob.enqueue("CA23", REPORT, None)
    run(ob.deliver(app, "CA23"))
    ob.enqueue("CA23", REPORT, None)                                     # somehow queued again
    with pytest.raises(FileExistsError):
        ob.replay("CA23")


def test_a_missing_wav_is_reported_to_the_app_explicitly(tmp_path):
    clock, app = Clock(), FakeApp()
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA24")
    ob.enqueue("CA24", REPORT, wav)
    wav.unlink()                                                         # lost (disk cleanup, a bad restore …)
    assert run(ob.deliver(app, "CA24")) == "done"
    assert app.uploads == []
    assert app.statuses == [("CA24", {"recording": {"state": "missing", "reason": "the recording file CA24.wav was gone from the phone system's disk", "seq": 1, "attempts": 1}})]
    assert app.recording_state["CA24"] == (1, "missing") and ob.pending() == []


def test_status_delivery_is_retried_and_survives_a_restart_without_a_new_seq(tmp_path, monkeypatch):
    clock, app = Clock(), FakeApp()
    app.reject_recording = 413
    app.status_down = True
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA25")
    ob.enqueue("CA25", REPORT, wav)
    assert run(ob.deliver(app, "CA25")) == "retry"                       # rejected, but the app has not heard yet
    job = ob.load("CA25")
    assert job["recordingRejected"] and job["statusOut"]["seq"] == 1 and not job["statusDone"] and wav.exists()
    # the engine dies; the app recovers; the new process sends the SAME status (seq 1), then keeps the failure
    app.status_down = False
    clock.t += 30
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app)) == {"failed": 1}
    assert [p["recording"]["seq"] for _, p in app.statuses] == [1, 1] and app.uploads == ["CA25"]
    assert ob2.failed() == ["CA25"] and wav.exists()


def test_crash_after_rejection_was_noted_still_tells_the_app_after_restart(tmp_path, monkeypatch):
    clock, app = Clock(), FakeApp()
    app.reject_recording = 422
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA26")
    ob.enqueue("CA26", REPORT, wav)

    async def killed(*a, **k):
        raise RuntimeError("engine killed before the status went out")
    monkeypatch.setattr(ob, "_send_status", killed)
    with pytest.raises(RuntimeError):
        run(ob.deliver(app, "CA26"))
    assert ob.load("CA26")["recordingRejected"] and app.statuses == []
    ob2 = Outbox(tmp_path / "outbox", clock)
    assert run(ob2.drain(app)) == {"failed": 1}
    assert app.uploads == ["CA26"] and [p["recording"]["state"] for _, p in app.statuses] == ["failed"]


def test_an_old_app_without_the_status_endpoint_still_settles(tmp_path):
    clock, app = Clock(), FakeApp()
    app.reject_recording = 413
    ob = Outbox(tmp_path / "outbox", clock)

    class Old:   # call_finished + upload_recording only: no artifact_status
        call_finished = app.call_finished
        upload_recording = app.upload_recording
    wav = wav_in(tmp_path, "CA27")
    ob.enqueue("CA27", REPORT, wav)
    assert run(ob.deliver(Old(), "CA27")) == "failed" and ob.failed() == ["CA27"]


def test_cli_lists_shows_and_replays_the_failed_queue(tmp_path, capsys):
    from outbox import main
    clock, app = Clock(), FakeApp()
    app.reject_recording = 413
    ob = Outbox(tmp_path / "outbox", clock)
    wav = wav_in(tmp_path, "CA28")
    ob.enqueue("CA28", REPORT, wav)
    run(ob.deliver(app, "CA28"))
    assert main(["list"], root=tmp_path / "outbox") == 0
    out = capsys.readouterr().out
    assert "CA28  rejected" in out and "recording=rejected HTTP 413" in out and "on disk" in out and "1 failed, 0 queued" in out
    assert main(["show", "CA28"], root=tmp_path / "outbox") == 0
    assert json.loads(capsys.readouterr().out)["report"] == REPORT
    assert main(["replay", "CA28"], root=tmp_path / "outbox") == 0
    assert ob.pending() == ["CA28"] and ob.failed() == []
    assert main(["replay", "CA28"], root=tmp_path / "outbox") == 1    # no longer in failed/
    assert main(["replay"], root=tmp_path / "outbox") == 2


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
    job = ob.load_failed("CA10")
    assert job["failure"] == "expired" and job["report"] == REPORT and job["gaveUpAt"] == clock.t
    # the app is back: a deliberate replay delivers it (restart: a new Outbox)
    app.down = False
    ob.replay("CA10")
    assert run(Outbox(tmp_path / "outbox", clock).drain(app)) == {"done": 1}
    assert app.leads_delivered == 1 and app.uploads == ["CA10"] and not wav.exists() and ob.failed() == []


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


def test_real_app_client_sends_the_status_over_http(tmp_path):
    """The wire format end to end: AppClient → the mock app's /calls/:sid/artifacts (the shape internal-calls.ts parses)."""
    from aiohttp.test_utils import TestServer
    from app_client import AppClient
    from mock_app import LOG, make_mock_app
    secret = "selftest-secret-0123456789"

    async def go():
        mock = make_mock_app(secret)
        srv = TestServer(mock)
        await srv.start_server()
        client = AppClient(base_url=str(srv.make_url("")).rstrip("/"), secret=secret)
        try:
            ob = Outbox(tmp_path / "outbox", Clock())
            wav = wav_in(tmp_path, "CA-http-1")
            ob.enqueue("CA-http-1", REPORT, wav)
            wav.unlink()
            assert await ob.deliver(client, "CA-http-1") == "done"
            return [x for x in mock[LOG] if x["path"].endswith("/artifacts")]
        finally:
            await client.aclose()
            await srv.close()
    sent = run(go())
    assert len(sent) == 1 and sent[0]["path"] == "/api/voice-internal/calls/CA-http-1/artifacts"
    assert sent[0]["body"]["recording"]["state"] == "missing" and sent[0]["body"]["recording"]["seq"] == 1
