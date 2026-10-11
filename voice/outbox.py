"""Durable delivery of a finished call's paperwork: the end-of-call report (PUT /calls/:sid), the recording
(POST /recordings/:sid) and the recording's explicit status (POST /calls/:sid/artifacts). OWNER: engine.

Why: the app may be down, deploying or slow when a call ends, and the engine may restart before it comes back. A
report or a recording sent once, in memory, is lost then — the lead, the escalations and the minutes all hang off
the report. So `Call._finish` writes ONE job file per call to `<recordings_dir>/outbox/<sid>.json` BEFORE it
touches the network, delivers it straight away, and the reaper loop (server.py) drains whatever is left.

Crash safety — every step is a separate, atomic file write (temp file + fsync + os.replace), and every network
step is idempotent on the app side, so a crash between any two steps neither loses nor duplicates a delivery:
  1. job written (report + wav path)          crash before → nothing was sent yet; the wav, if any, stays on disk
  2. PUT report  → mark reportDone            crash between → the retry PUTs again; the app answers the stored
                                              result (internal-calls.ts claimCall: processedAt latch on callSid;
                                              its CRM work is durable tasks keyed on the call), so no lead, text or
                                              minute is delivered twice
  3. POST wav    → mark recordingDone         crash between → the retry uploads again; same R2 key, same row
  4. POST status → mark statusDone            crash between → sent again with the same `seq`; the app keeps only a
                                              newer seq, so a repeat or a late older status changes nothing
  5. unlink wav, then unlink the job          crash between → the job says done; the next drain just removes it

The app/engine contract (agreed with server/voice/internal-calls.ts — both ends live in this repository):
  idempotency  the call sid is the job id for every step: PUT /calls/:sid (processedAt latch), POST
               /recordings/:sid (one R2 key per sid), POST /calls/:sid/artifacts (ordered by the job's `statusSeq`)
  status       {"recording": {"state": "pending" | "failed" | "missing", "reason": str, "seq": int, "attempts": int}}
               failed  = the app refused the upload for good (the WAV is kept in the failed queue for a replay)
               missing = the WAV this job expected is gone from disk (nothing left to upload; the call says so)
               pending = a replay re-queued the upload (the console shows "uploading" again until it lands)
               A stored recording always wins on the app side; "available" needs no status (the upload sets it).

Failures are kept, never deleted:
  - a step the app rejects for good (400/404/413/422) is not retried: once the rest of the job has settled, the
    job — report payload, wav path, the app's answer — moves to `outbox/failed/<sid>.json` and the WAV stays on
    disk. A rejected report also holds its recording back (the app has no call to attach it to).
  - anything else backs off (30 s doubling to an hour) until `max_age_s` (3 days), then the job moves to
    `failed/` the same way ("expired").
  - `replay(sid)` (or `python outbox.py replay <sid>|--all` on the engine box, after correcting the cause) puts a
    failed job back in the queue: rejected steps are re-armed, steps already delivered stay delivered, a
    re-queued upload first tells the app "pending" again, and the reaper delivers it like any other job.
    `python outbox.py list` / `show <sid>` inspect the failed queue.

The clock is injectable (`clock=`) so the tests drive backoff and give-up without sleeping."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Protocol

log = logging.getLogger("voice.outbox")

SID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PERMANENT = {400, 404, 413, 422}


class DeliveryClient(Protocol):
    async def call_finished(self, call_sid: str, payload: dict[str, Any]) -> dict[str, Any]: ...
    async def upload_recording(self, call_sid: str, wav_path: Path) -> dict[str, Any]: ...
    # optional: async def artifact_status(self, call_sid: str, payload: dict[str, Any]) -> dict[str, Any]


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


def _why(res: dict[str, Any]) -> str:
    status = res.get("status")
    err = str(res.get("error") or "")[:200]
    return f"HTTP {status}: {err}" if status else err or "rejected"


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

    def _failed_path(self, sid: str) -> Path:
        if not SID_RE.match(sid):
            raise ValueError(f"bad call sid for the outbox: {sid!r}")
        return self.failed_dir / f"{sid}.json"

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

    def load_failed(self, sid: str) -> dict[str, Any] | None:
        try:
            return json.loads(self._failed_path(sid).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def pending(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(p.stem for p in self.root.glob("*.json") if SID_RE.match(p.stem))

    def failed(self) -> list[str]:
        """The failed queue: jobs the app rejected for good, or that ran out of time. Kept until replayed."""
        if not self.failed_dir.is_dir():
            return []
        return sorted(p.stem for p in self.failed_dir.glob("*.json") if SID_RE.match(p.stem))

    def _save(self, job: dict[str, Any]) -> None:
        _write_atomic(self._failed_path(job["sid"]) if job.get("failure") else self._path(job["sid"]), job)

    def _complete(self, job: dict[str, Any]) -> None:
        wav = Path(job["wav"]) if job.get("wav") else None
        # Only an upload the app accepted frees the WAV; a missing one has nothing to remove.
        if wav and job.get("recordingDone") and not job.get("recordingRejected") and not job.get("recordingMissing"):
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

    def _move_to_failed(self, job: dict[str, Any], failure: str, why: str) -> None:
        """Keep the whole job (report payload, wav path, the app's answers) in failed/; the WAV stays where it is."""
        self.failed_dir.mkdir(parents=True, exist_ok=True)
        job["failure"], job["failedAt"], job["lastError"] = failure, self.clock(), why
        if failure == "expired":
            job["gaveUpAt"] = job["failedAt"]
        _write_atomic(self._failed_path(job["sid"]), job)
        try:
            self._path(job["sid"]).unlink()
        except FileNotFoundError:
            pass
        log.error("outbox: call %s moved to the failed queue (%s after %d attempts: %s); wav kept at %s — "
                  "fix the cause, then `python outbox.py replay %s`", job["sid"], failure, job.get("attempts", 0), why,
                  job.get("wav"), job["sid"])

    def _queue_status(self, job: dict[str, Any], state: str, reason: str) -> None:
        """Tell the app where the recording stands; a newer status (higher seq) supersedes an unsent older one."""
        job["statusSeq"] = int(job.get("statusSeq", 0)) + 1
        job["statusOut"] = {"state": state, "reason": reason[:300], "seq": job["statusSeq"], "attempts": int(job.get("attempts", 0)) + 1}
        job["statusDone"] = False

    async def _send_status(self, client: Any, sid: str, job: dict[str, Any], errors: list[str]) -> None:
        out = job.get("statusOut")
        if not out or job.get("statusDone"):
            return
        send = getattr(client, "artifact_status", None)
        if send is None:   # a client without the endpoint (an older app): nothing to tell
            job["statusDone"] = True
            self._save(job)
            return
        res = await send(sid, {"recording": out})
        if res.get("ok"):
            job["statusDone"] = True
            self._save(job)
        elif res.get("status") in PERMANENT:
            job["statusDone"], job["statusRejected"] = True, res
            self._save(job)
            log.warning("call %s recording status %s refused by the app (%s)", sid, out.get("state"), _why(res))
        else:
            errors.append(f"status: {res.get('error') or res}")

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
                log.error("call %s report rejected by the app (%s); kept for a replay", sid, _why(res))
            else:
                errors.append(f"report: {res.get('error') or res}")
        # A replay announces itself before the upload, so the console says "uploading" again meanwhile.
        if job.get("reportDone") and not job.get("reportRejected") and (job.get("statusOut") or {}).get("state") == "pending":
            await self._send_status(client, sid, job, errors)
        wav = Path(job["wav"]) if job.get("wav") else None
        if job.get("reportDone") and not job.get("reportRejected") and not job.get("recordingDone"):
            if wav is None:
                job["recordingDone"] = True                       # this call had no recording
                self._save(job)
            elif not wav.exists():
                job["recordingDone"], job["recordingMissing"] = True, True
                self._queue_status(job, "missing", f"the recording file {wav.name} was gone from the phone system's disk")
                self._save(job)
                log.error("outbox: recording for %s is gone from %s; telling the app", sid, wav)
            else:
                up = await client.upload_recording(sid, wav)
                if up.get("recordingKey"):
                    job["recordingDone"] = True
                    job.pop("recordingRejected", None)
                    self._save(job)
                elif up.get("status") in PERMANENT:
                    job["recordingDone"], job["recordingRejected"] = True, up
                    self._queue_status(job, "failed", _why(up))
                    self._save(job)
                    log.error("call %s recording rejected by the app (%s); wav kept at %s for a replay", sid, _why(up), wav)
                else:
                    errors.append(f"recording: {up.get('error') or up}")
        if job.get("reportDone") and not job.get("reportRejected"):
            await self._send_status(client, sid, job, errors)
        settled = job.get("reportDone") and (job.get("reportRejected") or (job.get("recordingDone") and (not job.get("statusOut") or job.get("statusDone"))))
        if settled:
            if job.get("reportRejected") or job.get("recordingRejected"):
                why = "; ".join(f"{k}: {_why(job[k + 'Rejected'])}" for k in ("report", "recording") if job.get(k + "Rejected"))
                self._move_to_failed(job, "rejected", why)
                return "failed"
            self._complete(job)
            return "done"
        job["attempts"] = int(job.get("attempts", 0)) + 1
        job["lastError"] = "; ".join(errors)[:500]
        if now - float(job.get("createdAt", now)) >= self.max_age_s:
            if wav is not None and not job.get("recordingDone"):
                self._queue_status(job, "failed", "Recording upload retries expired: " + job["lastError"])
            self._move_to_failed(job, "expired", job["lastError"])
            # The terminal status is durable even if the app is still down. drain retries it from failed/.
            if job.get("reportDone") and not job.get("reportRejected"):
                await self._send_status(client, sid, job, errors)
            return "failed"
        job["nextAt"] = now + min(self.max_delay_s, self.base_delay_s * (2 ** (job["attempts"] - 1)))
        self._save(job)
        log.warning("call %s delivery pending (attempt %d, next in %.0fs): %s", sid, job["attempts"], job["nextAt"] - now, job["lastError"])
        return "retry"

    async def drain(self, client: DeliveryClient) -> dict[str, int]:
        """Deliver every due job once (the reaper calls this; a job not due yet is skipped). failed/ retries terminal statuses only; uploads require replay."""
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
        for sid in self.failed():
            if sid in self._inflight or self._path(sid).exists():
                continue
            job = self.load_failed(sid)
            if not job or not job.get("reportDone") or job.get("reportRejected") or not job.get("statusOut") or job.get("statusDone"):
                continue
            self._inflight.add(sid)
            try:
                await self._send_status(client, sid, job, [])
            except Exception as ex:
                log.warning("outbox: terminal status for %s pending: %s", sid, ex)
            finally:
                self._inflight.discard(sid)
        return counts

    def replay(self, sid: str) -> dict[str, Any]:
        """Put a failed job back in the queue after the cause was corrected. Rejected steps are re-armed; delivered
        steps stay delivered (the app is idempotent on the sid either way). Raises KeyError when there is no such
        failed job, FileExistsError when the sid is already queued."""
        job = self.load_failed(sid)
        if job is None:
            raise KeyError(sid)
        if self._path(sid).exists():
            raise FileExistsError(f"call {sid} is already in the outbox")
        now = self.clock()
        if job.pop("reportRejected", None) is not None:
            job["reportDone"] = False
        wav = Path(job["wav"]) if job.get("wav") else None
        if job.pop("recordingRejected", None) is not None or (wav is not None and not job.get("recordingDone")):
            job["recordingDone"] = False
            job.pop("recordingMissing", None)
            if wav is not None and wav.exists():
                self._queue_status(job, "pending", "replaying the upload after a correction")
        if not job.get("recordingDone") and job.get("statusOut") and job.get("statusOut", {}).get("state") != "pending":
            job.pop("statusOut", None)
            job["statusDone"] = True
        for k in ("failure", "failedAt", "gaveUpAt", "lastError", "statusRejected"):
            job.pop(k, None)
        job["replays"] = int(job.get("replays", 0)) + 1
        job["lastReplayAt"] = now
        job.update({"attempts": 0, "createdAt": now, "nextAt": now})
        self.root.mkdir(parents=True, exist_ok=True)
        _write_atomic(self._path(sid), job)                      # queued first …
        try:
            self._failed_path(sid).unlink()                       # … then out of failed/ (a crash between = both; the queue wins)
        except FileNotFoundError:
            pass
        log.info("outbox: call %s replayed from the failed queue (replay #%d)", sid, job["replays"])
        return job


def _summary(job: dict[str, Any]) -> str:
    steps = []
    for k in ("report", "recording"):
        steps.append(f"{k}={'rejected ' + _why(job[k + 'Rejected']) if job.get(k + 'Rejected') else 'missing' if k == 'recording' and job.get('recordingMissing') else 'done' if job.get(k + 'Done') else 'not sent'}")
    wav = job.get("wav")
    wav_state = f"{wav} ({'on disk' if wav and Path(wav).exists() else 'GONE'})" if wav else "none"
    return f"{job.get('sid')}  {job.get('failure', '?')}  {' '.join(steps)}  wav={wav_state}  replays={job.get('replays', 0)}  last={job.get('lastError', '')}"


def main(argv: list[str] | None = None, root: Path | None = None) -> int:
    """`python outbox.py list | show <sid> | replay <sid> | replay --all` — the failed queue on the engine box."""
    import argparse
    ap = argparse.ArgumentParser(prog="outbox.py", description="Inspect and replay the engine's failed delivery queue.")
    ap.add_argument("--root", type=Path, help="the outbox directory (default: <VOICE_RECORDINGS_DIR>/outbox)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sh = sub.add_parser("show")
    sh.add_argument("sid")
    rp = sub.add_parser("replay")
    rp.add_argument("sid", nargs="?")
    rp.add_argument("--all", action="store_true")
    a = ap.parse_args(argv)
    if root is None:
        root = a.root
    if root is None:
        from config import settings   # only the CLI needs the engine's settings
        root = settings.recordings_dir / "outbox"
    ob = Outbox(root)
    if a.cmd == "list":
        sids = ob.failed()
        for sid in sids:
            print(_summary(ob.load_failed(sid) or {"sid": sid}))
        print(f"{len(sids)} failed, {len(ob.pending())} queued")
        return 0
    if a.cmd == "show":
        job = ob.load_failed(a.sid) or ob.load(a.sid)
        if job is None:
            print(f"no job for {a.sid}", file=sys.stderr)
            return 1
        print(json.dumps(job, indent=2))
        return 0
    sids = ob.failed() if a.all else [a.sid] if a.sid else []
    if not sids:
        print("replay needs a sid or --all", file=sys.stderr)
        return 2
    rc = 0
    for sid in sids:
        try:
            ob.replay(sid)
            print(f"replayed {sid}: the engine's reaper delivers it on its next pass")
        except (KeyError, FileExistsError, ValueError) as ex:
            print(f"cannot replay {sid}: {ex}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
