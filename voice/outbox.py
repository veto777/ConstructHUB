"""Durable delivery of a finished call's paperwork: the end-of-call report (PUT /calls/:sid) and the recording
(POST /recordings/:sid). OWNER: engine.

Why: the app may be down, deploying or slow when a call ends, and the engine may restart before it comes back. A
report or a recording sent once, in memory, is lost then — the lead, the escalations and the minutes all hang off
the report. So `Call._finish` writes ONE job file per call to `<recordings_dir>/outbox/<sid>.json` BEFORE it
touches the network, delivers it straight away, and the reaper loop (server.py) drains whatever is left.

Crash safety — every step is a separate, atomic file write (temp file + fsync + os.replace), and every network
step is idempotent on the app side, so a crash between any two steps neither loses nor duplicates a delivery:
  1. job written (report + wav path)          crash before → nothing was sent yet; the wav, if any, stays on disk
  2. PUT report  → mark reportDone            crash between → the retry PUTs again; the app answers the stored
                                              result (internal-calls.ts claimCall: processedAt latch on callSid),
                                              so no lead, text or minute is delivered twice
  3. POST wav    → mark recordingDone         crash between → the retry uploads again; same R2 key, same row
  4. unlink wav, then unlink the job          crash between → the job says done; the next drain just removes it
A step the app rejects for good (400/404/413/422) is not retried; anything else backs off (30 s doubling to an
hour) until `max_age_s` (3 days), then the job moves to `outbox/failed/` and the WAV stays on disk, as before.

The clock is injectable (`clock=`) so the tests drive backoff and give-up without sleeping."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Protocol

log = logging.getLogger("voice.outbox")

SID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PERMANENT = {400, 404, 413, 422}


class DeliveryClient(Protocol):
    async def call_finished(self, call_sid: str, payload: dict[str, Any]) -> dict[str, Any]: ...
    async def upload_recording(self, call_sid: str, wav_path: Path) -> dict[str, Any]: ...


def _write_atomic(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    try:   # the rename itself survives a power cut only once the directory is synced
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


class Outbox:
    def __init__(self, root: Path, clock: Callable[[], float] = time.time, *, base_delay_s: float = 30.0,
                 max_delay_s: float = 3600.0, max_age_s: float = 3 * 86400.0):
        self.root, self.clock = Path(root), clock
        self.failed_dir = self.root / "failed"
        self.base_delay_s, self.max_delay_s, self.max_age_s = base_delay_s, max_delay_s, max_age_s
        self._inflight: set[str] = set()   # one delivery per call at a time (the inline send vs. the drain)

    def _path(self, sid: str) -> Path:
        if not SID_RE.match(sid):
            raise ValueError(f"bad call sid for the outbox: {sid!r}")
        return self.root / f"{sid}.json"

    def enqueue(self, sid: str, report: dict[str, Any], wav: Path | None) -> Path:
        """Persist the job before anything is sent. Re-enqueueing a sid keeps the steps already done."""
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(sid)
        now = self.clock()
        job = self.load(sid) or {"sid": sid, "createdAt": now, "attempts": 0, "reportDone": False, "recordingDone": False}
        job.update({"report": report, "wav": str(wav) if wav else None, "nextAt": now})
        _write_atomic(path, job)
        return path

    def load(self, sid: str) -> dict[str, Any] | None:
        try:
            return json.loads(self._path(sid).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def pending(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(p.stem for p in self.root.glob("*.json") if SID_RE.match(p.stem))

    def _save(self, job: dict[str, Any]) -> None:
        _write_atomic(self._path(job["sid"]), job)

    def _complete(self, job: dict[str, Any]) -> None:
        wav = Path(job["wav"]) if job.get("wav") else None
        if wav and job.get("recordingDone"):
            try:
                wav.unlink()
            except FileNotFoundError:
                pass
            except OSError as ex:
                log.warning("outbox: could not remove %s: %s", wav, ex)
        try:
            self._path(job["sid"]).unlink()
        except FileNotFoundError:
            pass

    def _give_up(self, job: dict[str, Any], why: str) -> None:
        self.failed_dir.mkdir(parents=True, exist_ok=True)
        job["gaveUpAt"], job["lastError"] = self.clock(), why
        _write_atomic(self.failed_dir / f"{job['sid']}.json", job)
        try:
            self._path(job["sid"]).unlink()
        except FileNotFoundError:
            pass
        log.error("outbox: gave up on call %s after %d attempts (%s); wav kept at %s", job["sid"], job.get("attempts", 0), why, job.get("wav"))

    async def deliver(self, client: DeliveryClient, sid: str) -> str:
        """One attempt at whatever is left for this call: "done" | "retry" | "failed" | "busy" | "missing" | "waiting"."""
        if sid in self._inflight:
            return "busy"
        self._inflight.add(sid)
        try:
            return await self._deliver(client, sid)
        finally:
            self._inflight.discard(sid)

    async def _deliver(self, client: DeliveryClient, sid: str) -> str:
        job = self.load(sid)
        if job is None:
            return "missing"
        now = self.clock()
        if float(job.get("nextAt", 0)) > now:
            return "waiting"
        errors: list[str] = []
        if not job.get("reportDone"):
            res = await client.call_finished(sid, job.get("report") or {})
            if res.get("callId") or res.get("outcome"):
                job["reportDone"], job["result"] = True, res
                self._save(job)                                   # step 2 is durable before step 3 starts
                log.info("call %s report delivered → %s", sid, json.dumps(res)[:200])
            elif res.get("status") in PERMANENT:
                job["reportDone"], job["reportRejected"] = True, res
                self._save(job)
                log.error("call %s report rejected by the app (%s): %s", sid, res.get("status"), res.get("error"))
            else:
                errors.append(f"report: {res.get('error') or res}")
        wav = Path(job["wav"]) if job.get("wav") else None
        if job.get("reportDone") and not job.get("recordingDone"):
            if wav is None or not wav.exists():
                if wav is not None:
                    log.warning("outbox: recording for %s is gone from %s; nothing to upload", sid, wav)
                job["recordingDone"] = True
                self._save(job)
            else:
                up = await client.upload_recording(sid, wav)
                if up.get("recordingKey"):
                    job["recordingDone"] = True
                    self._save(job)
                elif up.get("status") in PERMANENT:
                    job["recordingDone"], job["recordingRejected"] = True, up
                    job["wav"] = None   # keep the file (as before), but never delete it for a rejected upload
                    self._save(job)
                    log.error("call %s recording rejected by the app (%s); kept at %s", sid, up.get("status"), wav)
                else:
                    errors.append(f"recording: {up.get('error') or up}")
        if job.get("reportDone") and job.get("recordingDone"):
            self._complete(job)
            return "done"
        job["attempts"] = int(job.get("attempts", 0)) + 1
        job["lastError"] = "; ".join(errors)[:500]
        if now - float(job.get("createdAt", now)) >= self.max_age_s:
            self._give_up(job, job["lastError"])
            return "failed"
        job["nextAt"] = now + min(self.max_delay_s, self.base_delay_s * (2 ** (job["attempts"] - 1)))
        self._save(job)
        log.warning("call %s delivery pending (attempt %d, next in %.0fs): %s", sid, job["attempts"], job["nextAt"] - now, job["lastError"])
        return "retry"

    async def drain(self, client: DeliveryClient) -> dict[str, int]:
        """Deliver every due job once (the reaper calls this; a job not due yet is skipped)."""
        counts: dict[str, int] = {}
        for sid in self.pending():
            try:
                r = await self.deliver(client, sid)
            except asyncio.CancelledError:
                raise
            except Exception as ex:  # noqa: BLE001 — one bad job must not stop the rest
                log.exception("outbox: delivering %s failed: %s", sid, ex)
                r = "error"
            counts[r] = counts.get(r, 0) + 1
        return counts
