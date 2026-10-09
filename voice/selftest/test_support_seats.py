"""Seats (review S-2): the public support line has its own small budget and can never take the seats customers'
Call Assistant calls need; a support call has a time limit and an idle limit with a spoken wrap-up; and every way a
call can end — or hang — gives its seat back. Mock carrier (signed webhooks, a media socket), mock app, fake speech."""
import asyncio
import base64
import dataclasses
import json
import time

import aiohttp
import pytest

import server
from mock_app import LIVE, LOG, SUPPORT
from test_server import FWD, FakeTTS, SILENT, FRAME_S, _call, answer, run, sign, start, stop, stream_token, webhook_form


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for box in (server.ACTIVE, server.PENDING_PROFILES, server.SUPPORT_RECENT):
        box.clear()
    monkeypatch.setattr(server, "REAP_EVERY_S", 0.1)
    yield
    for box in (server.ACTIVE, server.PENDING_PROFILES, server.SUPPORT_RECENT):
        box.clear()


def tune(monkeypatch, **over):
    monkeypatch.setattr(server, "settings", dataclasses.replace(server.settings, **over))


async def ring(tc, to, sid, frm):
    form = webhook_form(to=to, frm=frm, sid=sid)
    r = await tc.post("/signalwire/voice", data=form, headers={**FWD, "X-Twilio-Signature": sign("/signalwire/voice", form)})
    return await r.text()


async def status(tc, sid, call_status="completed"):
    form = {"CallSid": sid, "CallStatus": call_status, "CallDuration": "3"}
    return await tc.post("/signalwire/status", data=form, headers={**FWD, "X-Twilio-Signature": sign("/signalwire/status", form)})


async def connect(tc, sid, token, to, frm="+13605550123"):
    ws = await tc.ws_connect("/media")
    await ws.send_str(json.dumps({"event": "start", "start": {"streamSid": "MZ" + sid[-4:], "callSid": sid,
                                                              "customParameters": {"from": frm, "to": to, "callSid": sid, "token": token}}}))
    return ws


async def until(test, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if test():
            return True
        await asyncio.sleep(0.02)
    return False


async def frames(ws, seconds):
    for _ in range(int(seconds / FRAME_S)):
        if ws.closed:
            return
        try:
            await ws.send_str(json.dumps({"event": "media", "media": {"track": "inbound", "payload": base64.b64encode(SILENT).decode()}}))
        except Exception:  # noqa: BLE001 — the engine hung up
            return
        await asyncio.sleep(FRAME_S)


class Spoken(FakeTTS):
    said: list = []

    def synth(self, text, voice):
        Spoken.said.append(text)
        return super().synth(text, voice)


def is_stream(body):
    return "<Stream" in body


def is_keypad(body):
    return '<Redirect method="POST">https://constructhub.us/api/support/ivr</Redirect>' in body and "<Stream" not in body


# ── admission ──────────────────────────────────────────────────────────────────────────────────────

def test_seven_support_calls_at_once_leave_the_customers_seats_alone(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        assert server.settings.max_active_calls == 6 and server.settings.support_seats == 2
        got = [await ring(tc, SUPPORT, f"CA-support-{i:04d}", f"+1206555{i:04d}") for i in range(7)]
        assert [is_stream(b) for b in got] == [True, True] + [False] * 5
        assert all(is_keypad(b) for b in got[2:])                       # callers 3-7: the keypad line, not a seat
        assert server.seats() == {"support": 2, "assistant": 0, "total": 2}
        # Every seat the support line cannot hold is still there for customers' calls: 4 of 6.
        orgs = [await ring(tc, LIVE, f"CA-customer-{i:03d}", f"+1360555{i:04d}") for i in range(5)]
        assert [is_stream(b) for b in orgs] == [True, True, True, True, False]
        assert "can't take your call right now" in orgs[4]                 # the engine is genuinely full (6 of 6)
        assert server.seats() == {"support": 2, "assistant": 4, "total": 6}
        await stop(tc, ms)
    run(go())


def test_live_support_streams_hold_only_support_seats(monkeypatch):
    async def go():
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        socks = []
        for i in range(2):
            body = await ring(tc, SUPPORT, f"CA-live-sup-{i:03d}", f"+1206555{i:04d}")
            socks.append(await connect(tc, f"CA-live-sup-{i:03d}", stream_token(body), SUPPORT, f"+1206555{i:04d}"))
        assert await until(lambda: sum(1 for c in server.ACTIVE if c.brain) == 2)
        assert not server.PENDING_PROFILES and server.seats() == {"support": 2, "assistant": 0, "total": 2}
        for i in range(5):                                                   # five more support callers while both talk
            assert is_keypad(await ring(tc, SUPPORT, f"CA-more-sup-{i:03d}", f"+1425555{i:04d}"))
        orgs = [await ring(tc, LIVE, f"CA-live-org-{i:03d}", f"+1360555{i:04d}") for i in range(4)]
        assert all(is_stream(b) for b in orgs)
        # A support caller hangs up: that seat goes back to the SUPPORT budget only.
        await socks[0].close()
        assert await until(lambda: server.seats()["support"] == 1)
        assert is_stream(await ring(tc, SUPPORT, "CA-next-sup-001", "+14255559999"))
        assert "can't take your call right now" in await ring(tc, LIVE, "CA-live-org-9", "+13605559999")   # 2 + 4 = full
        assert len([x for x in mock[LOG] if x["path"].endswith("/support/end")]) == 1
        for ws in socks:
            await ws.close()
        await stop(tc, ms)
    run(go())


def test_the_support_budget_can_never_be_configured_to_take_every_seat(monkeypatch):
    async def go():
        tune(monkeypatch, support_max_calls=99, support_calls_per_hour=999)
        tc, _, ms = await start(monkeypatch=monkeypatch)
        assert server.settings.support_seats == 5
        got = [await ring(tc, SUPPORT, f"CA-greedy-{i:04d}", f"+1206555{i:04d}") for i in range(8)]
        assert sum(is_stream(b) for b in got) == 5
        assert is_stream(await ring(tc, LIVE, "CA-customer-x", "+13605550123"))   # one seat is always a customer's
        tune(monkeypatch, support_max_calls=0)
        server.PENDING_PROFILES.clear()
        assert is_keypad(await ring(tc, SUPPORT, "CA-zero-0001", "+12065550001"))  # 0 = keypad line only
        await stop(tc, ms)
    run(go())


def test_support_calls_per_hour_per_caller_and_overall(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        per = server.settings.support_calls_per_caller_hour
        got = []
        for i in range(per + 2):                                             # one caller, call after call
            got.append(await ring(tc, SUPPORT, f"CA-again-{i:04d}", "+12065550111"))
            server.PENDING_PROFILES.clear()                                  # (each call ended; its seat is free)
        assert [is_stream(b) for b in got] == [True] * per + [False, False]
        assert all(is_keypad(b) for b in got[per:])
        assert is_stream(await ring(tc, SUPPORT, "CA-other-0001", "+12065550222"))   # somebody else is not affected
        server.PENDING_PROFILES.clear()
        # A call that was sent to the keypad line for want of a seat is not counted against the caller.
        server.SUPPORT_RECENT.clear()
        for i in range(2):
            await ring(tc, SUPPORT, f"CA-hold-{i:04d}", f"+1425555{i:04d}")
        assert is_keypad(await ring(tc, SUPPORT, "CA-overflow-1", "+12065550333"))
        assert not [x for x in server.SUPPORT_RECENT if x[1] == "+12065550333"]
        # The carrier re-sending a webhook for a call we already answered is the same call.
        again = await ring(tc, SUPPORT, "CA-hold-0000", "+14255550000")
        assert is_stream(again) and server.seats()["support"] == 2 and len(server.SUPPORT_RECENT) == 2
        # Overall: the whole line.
        server.PENDING_PROFILES.clear()
        server.SUPPORT_RECENT.clear()
        tune(monkeypatch, support_calls_per_hour=3)
        got = []
        for i in range(5):
            got.append(await ring(tc, SUPPORT, f"CA-all-{i:06d}", f"+1503555{i:04d}"))
            server.PENDING_PROFILES.clear()
        assert [is_stream(b) for b in got] == [True, True, True, False, False]
        # An hour later the allowance is back.
        assert server.support_rate_ok("+15035550000", time.time() + 3601)
        await stop(tc, ms)
    run(go())


def test_sockets_that_never_prove_they_are_a_call_hold_no_seat_and_are_closed(monkeypatch):
    async def go():
        tune(monkeypatch, stream_start_s=0.4)
        tc, _, ms = await start(monkeypatch=monkeypatch)
        strangers = [await tc.ws_connect("/media") for _ in range(8)]        # /media is public
        assert len(server.ACTIVE) == 8 and server.seats()["total"] == 0
        orgs = [await ring(tc, LIVE, f"CA-real-{i:05d}", f"+1360555{i:04d}") for i in range(6)]
        assert all(is_stream(b) for b in orgs)                               # all six seats are still there
        for ws in strangers:
            msg = await ws.receive(timeout=3)
            assert msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING)
        assert await until(lambda: not server.ACTIVE)
        # …and they are bounded while they wait.
        tune(monkeypatch, stream_start_s=30)
        many = [await tc.ws_connect("/media") for _ in range(14)]
        refused = 0
        for ws in many:
            try:
                msg = await ws.receive(timeout=0.3)
                refused += msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING)
            except asyncio.TimeoutError:
                pass
        assert refused == 2 and sum(1 for c in server.ACTIVE if c.profile is None) == 12
        for ws in many:
            await ws.close()
        await stop(tc, ms)
    run(go())


def test_a_stream_without_a_webhook_seat_is_admitted_under_the_same_budgets(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)

        async def real(call_sid, to):
            return True
        monkeypatch.setattr(server, "call_is_real", real)                    # SignalWire knows these calls
        for i in range(2):
            await ring(tc, SUPPORT, f"CA-held-{i:05d}", f"+1206555{i:04d}")
        ws = await connect(tc, "CA-tokenless-1", "", SUPPORT, "+14255550001")  # e.g. the engine restarted mid-ring
        msg = await ws.receive(timeout=3)
        assert msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING)
        assert server.seats() == {"support": 2, "assistant": 0, "total": 2}
        ok = await connect(tc, "CA-tokenless-2", "", LIVE, "+13605550123")   # a customer's call still gets in
        assert await until(lambda: server.seats() == {"support": 2, "assistant": 1, "total": 3})
        await ok.close()
        await stop(tc, ms)
    run(go())


# ── time limits ────────────────────────────────────────────────────────────────────────────────────

def test_a_long_support_call_is_wrapped_up_and_ended_at_the_limit(monkeypatch):
    async def go():
        tune(monkeypatch, support_max_call_s=1, support_idle_s=0)
        monkeypatch.setattr(server, "MIN_CAP_S", 0)
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        Spoken.said = []
        monkeypatch.setattr(server, "tts", Spoken())
        body = await ring(tc, SUPPORT, "CA-long-00001", "+12065550123")
        ws = await connect(tc, "CA-long-00001", stream_token(body), SUPPORT, "+12065550123")
        t0 = time.time()
        feeder = asyncio.create_task(frames(ws, 8))                           # the caller never hangs up
        closed = False
        while time.time() - t0 < 6:
            msg = await ws.receive(timeout=6)
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                closed = True
                break
        took = time.time() - t0
        feeder.cancel()
        assert closed and 0.9 <= took < 4, took                               # ended by the engine, at the limit
        assert any("wrap up this call" in s for s in Spoken.said)             # …after saying so
        assert await until(lambda: not server.ACTIVE and server.seats()["total"] == 0)
        assert [x for x in mock[LOG] if x["path"].endswith("/support/end")]
        assert not [x for x in mock[LOG] if x["path"].endswith("/calls")]     # not an org's call: nothing billed or logged as one
        await stop(tc, ms)
    run(go())


def test_the_support_limit_is_the_engines_own_default_eight_minutes(monkeypatch):
    async def go():
        tc, _, ms = await start(monkeypatch=monkeypatch)
        body = await ring(tc, SUPPORT, "CA-default-01", "+12065550123")
        ws = await connect(tc, "CA-default-01", stream_token(body), SUPPORT, "+12065550123")
        assert await until(lambda: any(c.brain for c in server.ACTIVE))
        call = next(iter(server.ACTIVE))
        assert (call.max_call_s, call.idle_s) == (480, 60.0)
        body = await ring(tc, LIVE, "CA-default-02", "+13605550123")
        org = await connect(tc, "CA-default-02", stream_token(body), LIVE)
        assert await until(lambda: sum(1 for c in server.ACTIVE if c.brain) == 2)
        other = next(c for c in server.ACTIVE if c is not call)
        assert other.idle_s == 0 and other.max_call_s != 480                  # a customer's call keeps its profile's timings
        await ws.close()
        await org.close()
        await stop(tc, ms)
    run(go())


def test_a_support_caller_who_says_nothing_is_let_go(monkeypatch):
    async def go():
        tune(monkeypatch, support_idle_s=1)
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        Spoken.said = []
        monkeypatch.setattr(server, "tts", Spoken())
        body = await ring(tc, SUPPORT, "CA-idle-00001", "+12065550123")
        ws = await connect(tc, "CA-idle-00001", stream_token(body), SUPPORT, "+12065550123")
        feeder = asyncio.create_task(frames(ws, 8))                           # line open, audio flowing, no words
        t0 = time.time()
        closed = False
        while time.time() - t0 < 6:
            msg = await ws.receive(timeout=6)
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                closed = True
                break
        feeder.cancel()
        assert closed and time.time() - t0 < 5
        assert any("haven't heard anything" in s for s in Spoken.said)
        assert await until(lambda: not server.ACTIVE)
        await stop(tc, ms)
    run(go())


# ── every exit gives the seat back ─────────────────────────────────────────────────────────────────

def test_seats_are_released_on_every_exit_path(monkeypatch):
    async def go():
        tune(monkeypatch, support_calls_per_hour=999, support_calls_per_caller_hour=999)
        tc, mock, ms = await start(monkeypatch=monkeypatch)

        async def live(sid, to=SUPPORT):
            body = await ring(tc, to, sid, "+12065550123")
            ws = await connect(tc, sid, stream_token(body), to, "+12065550123")
            assert await until(lambda: any(c.call_sid == sid and c.brain for c in server.ACTIVE)), sid
            assert server.seats()["total"] == 1
            return ws

        async def freed(why):
            assert await until(lambda: server.seats()["total"] == 0 and not server.ACTIVE), why

        # 1. the caller hangs up
        ws = await live("CA-exit-hangup")
        await ws.close()
        await freed("caller hung up")
        # 2. the carrier sends "stop"
        ws = await live("CA-exit-stop01")
        await ws.send_str(json.dumps({"event": "stop"}))
        await freed("carrier stop")
        # 3. the carrier's status callback says the call is over while the socket is still open
        ws = await live("CA-exit-status")
        assert (await status(tc, "CA-exit-status")).status == 200
        await freed("status callback")
        # 4. answered, but the audio never connected and the carrier says the call ended
        assert is_stream(await ring(tc, SUPPORT, "CA-exit-noaudio", "+12065550123"))
        assert server.seats()["support"] == 1
        await status(tc, "CA-exit-noaudio", "no-answer")
        await freed("never connected")
        # 5. answered, never connected, no status callback at all: the reservation expires
        assert is_stream(await ring(tc, LIVE, "CA-exit-expire", "+12065550123"))
        assert server.seats()["assistant"] == 1
        assert server.reap(time.time() + server.PENDING_TTL_S + 1) == [] and server.seats()["total"] == 0
        # 6. a customer's call ends the same ways (its report is still filed)
        ws = await live("CA-exit-org001", LIVE)
        await status(tc, "CA-exit-org001")
        await freed("org status callback")
        assert await until(lambda: [x for x in mock[LOG] if x["method"] == "PUT" and x["path"].endswith("/calls/CA-exit-org001")])
        await stop(tc, ms)
    run(go())


def test_a_dead_stream_is_reaped_and_its_seat_released(monkeypatch):
    async def go():
        tune(monkeypatch, zombie_s=0.6)
        tc, mock, ms = await start(monkeypatch=monkeypatch)
        for sid, to in (("CA-zombie-sup1", SUPPORT), ("CA-zombie-org1", LIVE)):
            body = await ring(tc, to, sid, "+12065550123")
            ws = await connect(tc, sid, stream_token(body), to, "+12065550123")   # socket stays open; no audio ever arrives
            assert await until(lambda: server.seats()["total"] == 1)
            assert await until(lambda: server.seats()["total"] == 0 and not server.ACTIVE, 6), sid
            assert ws.closed or (await ws.receive(timeout=2)).type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING)
        assert [x for x in mock[LOG] if x["method"] == "PUT" and x["path"].endswith("/calls/CA-zombie-org1")]   # still reported
        await stop(tc, ms)
    run(go())


def test_the_hang_up_never_depends_on_the_goodbye_being_spoken():
    async def go():
        c = _call()
        c.brain = type("B", (), {"end_requested": False, "outcome": ""})()
        closed = []

        async def broken(text):
            raise RuntimeError("text-to-speech is down")

        async def close():
            closed.append(True)
        c.say, c.close = broken, close
        await c.wrap_up("reached the cap", server.SUPPORT_WRAP)
        assert closed == [True] and c.brain.end_requested

        async def stuck(text):
            await asyncio.sleep(3600)
        c.say, closed[:], c.wrapping_at = stuck, [], 0.0   # (a second call, for the test)
        real = asyncio.wait_for

        async def impatient(aw, timeout):
            return await real(aw, 0.05)
        server.asyncio.wait_for, keep = impatient, server.asyncio.wait_for
        try:
            await c.wrap_up("reached the cap", server.SUPPORT_WRAP)
        finally:
            server.asyncio.wait_for = keep
        assert closed == [True]
    run(go())


def test_the_reaper_frees_every_kind_of_stuck_seat():
    class WS:
        closed = False

        async def close(self):
            self.closed = True

    async def go():
        now = time.time()

        def call(sid, **over):
            c = _call()
            c.ws, c.call_sid, c.started, c.last_in, c.last_heard = WS(), sid, now, now, now
            c.profile = type("P", (), {"kind": over.pop("kind", "assistant")})()
            c.brain = object()
            closed = []

            async def close():
                closed.append("close")
                server.ACTIVE.discard(c)

            async def wrap_up(why, text):
                closed.append(("wrap_up", text))
                server.ACTIVE.discard(c)
            c.close, c.wrap_up, c.closed_by = close, wrap_up, closed
            for k, v in over.items():
                setattr(c, k, v)
            server.ACTIVE.add(c)
            return c

        healthy = call("CA-healthy")
        assert server.reap(now + 1) == [] and healthy in server.ACTIVE
        cases = {
            "no audio": call("CA-noaudio", last_in=now - server.settings.zombie_s - 1),
            "past its time cap": call("CA-overcap", started=now - 900 - server.CAP_GRACE_S - 1, max_call_s=900),
            "idle": call("CA-idle", kind="support", idle_s=60.0, started=now - 200, last_heard=now - 61, max_call_s=480),
            "bookkeeping stuck": call("CA-stuck", closing=True, closing_at=now - server.CLOSE_TTL_S - 1),
            "never started": call("CA-nostart", brain=None, started=now - server.STARTING_TTL_S - 1),
            "wrap-up never finished": call("CA-wrapstuck", wrapping_at=now - server.WRAP_TTL_S - 1),
        }
        saying_goodbye = call("CA-wrapping", kind="support", idle_s=60.0, started=now - 200, last_heard=now - 100, wrapping_at=now - 2)
        cases["no audio"].last_in = now - server.settings.zombie_s - 1
        done = dict(server.reap(now))
        await asyncio.sleep(0.05)   # the closes it scheduled
        assert {k: next(v for s, v in done.items() if s == c.call_sid).split(" for ")[0][:len(k)] for k, c in cases.items()} == {k: k for k in cases}
        assert cases["no audio"].closed_by == ["close"] and cases["past its time cap"].closed_by == ["close"]
        assert cases["idle"].closed_by == [("wrap_up", server.SUPPORT_IDLE_BYE)]
        assert cases["never started"].ws.closed
        assert saying_goodbye.closed_by == []                                 # one wrap-up per call: it is left to finish
        server.ACTIVE.discard(saying_goodbye)
        assert server.ACTIVE == {healthy}                                     # every stuck seat is free; the live call is not touched
        # A customer's call is never ended for being quiet (only the support line has the idle limit).
        quiet = call("CA-quiet-org", last_heard=now - 500, started=now - 500)
        assert server.reap(now) == [] and quiet in server.ACTIVE
        server.ACTIVE.clear()
    run(go())
