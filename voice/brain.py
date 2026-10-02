"""The brain: compiled profile + transcript → one Decision per turn (docs/call-assistant/SPEC.md §4).

Pure text in / Decision out, shared by the phone server (server.py), the text simulator (sim.py) and the
app's Simulator tab (/sim/*). Provider-agnostic: `providers.make_provider()` returns the OpenAI-compatible
default (TruthCoder) or the Anthropic tools adapter; both hand back JSON text that decision.py validates.

What the engine enforces here, because the model cannot be trusted with it (port of Alpine's Brain):
  - `end_call` is honoured only after a caller goodbye / "nothing else", the silence limit, spam, or the
    turn/time caps; otherwise it becomes `continue` (the sentence is still spoken) — hanging up on someone
    mid-conversation is the worst mistake the assistant can make.
  - a call ending without `submit_lead` but with ≥ 2 caller turns, a callback number and no decline/spam
    forces a submit from the transcript (`force_submit`), so a caller who gave us their number never falls
    through the cracks.
  - `flag_spam` below the profile's `flagAt` threshold is ignored (logged); at/above it the call is spam and
    `end_call` is allowed; the app's ledger decides strikes/blocks from the confidence we report.
  - slots are cumulative and the caller-id number fills `phone` unless the caller gave another; the assistant
    never reads the caller's digits aloud (scrubbed from `say` as a last resort).
  - the invalid-JSON path: one corrective retry, then the honest fallback line and an `error` event."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

from decision import (Decision, DecisionError, FALLBACK_SAY, RETRY_MESSAGE, decision_json_schema, fallback_decision,
                      parse_decision)
from providers import ProviderError, make_provider

log = logging.getLogger("voice.brain")

SILENCE_TEXT = "(silence — the caller hasn't said anything)"
GOODBYE_RE = re.compile(
    r"\b(good ?bye|bye(?:[ -]?bye)?|see you|see ya|talk (?:to you )?later|have a (?:good|great|nice) (?:day|one|night|evening)|take care|"
    r"that(?:'s| is| would be) (?:all|it|everything)|nothing else|no(?:pe)?,? that(?:'s| is) (?:all|it)|i(?:'m| am) (?:all )?(?:done|good|set|finished)|"
    r"that(?:'ll| will) do|gotta go|(?:have|got|need) to (?:go|run)|i(?:'ll| will) let you go|that(?:'s| is) everything)\b", re.I)
# "no" / "no thanks" answers the assistant's "anything else?"; only then does it count as a goodbye
NO_RE = re.compile(r"^\s*(no|nope|nah|no thanks|no thank you|not (?:right )?now|i(?:'m| am) good|that(?:'s| is) it|that(?:'s| is) all)[\s.!,]*$", re.I)
ANYTHING_ELSE_RE = re.compile(r"anything else|something else|help you with anything|else (?:I|we) can", re.I)
DECLINE_OUTCOMES = ("declined", "out_of_area", "spam", "alerted", "blocked", "voicemail")

EventCb = Callable[[dict[str, Any]], Awaitable[Any]]
PLACEHOLDERS = {"none", "n/a", "na", "no", "nope", "unknown", "null", "nil", "-", "no email", "not provided", "declined", "not given",
                "caller", "the caller", "customer", "unknown caller", "anonymous"}
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def normalize_email(v: str) -> str:
    """'Mike dot Torres at gmail dot com' → 'mike.torres@gmail.com'; '' when it still isn't an email."""
    s = v.strip().lower()
    s = re.sub(r"\s+(?:at)\s+", "@", s)
    s = re.sub(r"\s*(?:\bdot\b|\.)\s*", ".", s)
    s = re.sub(r"\s+", "", s).strip(".")
    return s if EMAIL_RE.match(s) else ""


def _digits(s: str | None) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def spoken_number(number: str | None) -> str:
    d = _digits(number)[-10:]
    return f"{d[:3]} {d[3:6]} {d[6:]}" if len(d) == 10 else "unknown"


def split_city(address: str) -> tuple[str, str]:
    """'123 Main St, Tampa' → ('123 Main St', 'Tampa'); '123 Main St Tampa FL' → (whole, '')."""
    a = (address or "").strip()
    if "," in a:
        street, _, rest = a.partition(",")
        city = rest.strip().split(",")[0].strip()
        city = re.sub(r"\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$", "", city).strip()
        return street.strip(), city
    return a, ""


class Brain:
    def __init__(self, compiled: dict[str, Any], caller_number: str = "", *, provider: Any = None,
                 on_event: EventCb | None = None, caller_info: dict[str, Any] | None = None,
                 timezone: str | None = None, dry_run: bool = False):
        self.compiled = compiled
        self.caller = caller_number or ""
        self.caller_info = caller_info or {}
        self.on_event = on_event
        self.dry = dry_run
        self.provider = provider
        self.tz = self._tz(timezone)
        persona = compiled.get("persona") or {}
        self.assistant = persona.get("name") or "the assistant"
        self.voice = persona.get("voice") or "af_heart"
        timings = compiled.get("timings") or {}
        self.max_turns = int(timings.get("maxTurns") or 40)
        self.silence_limit = int(timings.get("silencePromptsBeforeHangup") or 2)
        spam = compiled.get("spam") or {}
        self.flag_at = float(spam.get("flagAt", 0.8))
        self.strike_at = float(spam.get("strikeAt", 0.95))
        self.temperature = float((compiled.get("style") or {}).get("temperature", 0.3))
        self.intake = compiled.get("intake") or []
        # state
        self.messages: list[dict[str, str]] = []
        self.transcript: list[dict[str, str]] = []
        self.events: list[dict[str, Any]] = []
        self.slots: dict[str, str] = {}
        self.submitted = False
        self.alerted = False
        self.alerts: list[dict[str, str]] = []
        self.spam: dict[str, Any] | None = None
        self.end_requested = False
        self.outcome: str | None = None
        self.silences = 0
        self.turns = 0
        self.last_say = ""
        self.started_at = datetime.now(self.tz)
        self._forced = False
        self._finished = False
        self._submitted_slots: dict[str, str] | None = None
        self._deliveries: list[asyncio.Task] = []
        self._lock = asyncio.Lock()
        # prefills from the CRM / caller id
        for q in self.intake:
            if q.get("prefillFrom") == "caller_id" and self.caller:
                self.slots[q["key"]] = self.caller
        cust = self.caller_info.get("customer") or {}
        if cust:
            for q in self.intake:
                if q.get("prefillFrom") == "crm" and q.get("validation") == "name" and cust.get("firstName"):
                    self.slots.setdefault(q["key"], cust["firstName"])
                if q.get("prefillFrom") == "crm" and q.get("validation") == "email" and cust.get("email"):
                    self.slots.setdefault(q["key"], cust["email"])

    @staticmethod
    def _tz(name: str | None) -> ZoneInfo:
        try:
            return ZoneInfo(name or "America/Los_Angeles")
        except Exception:  # noqa: BLE001
            return ZoneInfo("America/Los_Angeles")

    def _provider(self):
        if self.provider is None:
            self.provider = make_provider()
        return self.provider

    @property
    def model_name(self) -> str:
        try:
            return self._provider().model_name
        except ProviderError:
            return ""

    # ── transcript / events ───────────────────────────────────────────────────────────────────

    def _now(self) -> str:
        return datetime.now(self.tz).isoformat(timespec="seconds")

    def _log(self, role: str, text: str) -> None:
        self.transcript.append({"role": role, "text": text, "t": self._now()})

    def _event(self, type_: str, **detail: Any) -> dict[str, Any]:
        ev = {"t": self._now(), "type": type_, **detail}
        self.events.append(ev)
        return ev

    def _emit(self, payload: dict[str, Any]) -> None:
        """Mid-call delivery (lead / alert) through the server's callback, in the background: the caller hears the
        next sentence while the app files the lead. Never breaks the call; finish() waits for every delivery."""
        if self.on_event is None or self.dry:
            return
        self._deliveries.append(asyncio.create_task(self._deliver(payload)))

    async def _deliver(self, payload: dict[str, Any]) -> None:
        try:
            out = await self.on_event(payload)
            self._event("delivered", payload=payload.get("type"), result=out)
        except Exception as e:  # noqa: BLE001
            self._event("error", where="on_event", error=f"{type(e).__name__}: {e}"[:200])

    async def flush_deliveries(self, timeout: float = 15.0) -> None:
        pending = [t for t in self._deliveries if not t.done()]
        if pending:
            await asyncio.wait(pending, timeout=timeout)

    def caller_turns(self) -> int:
        return sum(1 for t in self.transcript if t["role"] == "caller")

    # ── prompt ────────────────────────────────────────────────────────────────────────────────

    def system_prompt(self) -> str:
        """The compiled prompt plus the runtime block only the engine knows (time, caller id, slots, turn)."""
        now = datetime.now(self.tz)
        schema = self.compiled.get("decisionSchema") or decision_json_schema()
        required = [q["key"] for q in self.intake if q.get("required")]
        lines = [
            self.compiled.get("systemPrompt", "").rstrip(),
            "",
            "OUTPUT FORMAT (engine rule, overrides everything above about format): reply with exactly ONE JSON object and nothing else — "
            "no prose, no markdown, no tool calls, no reasoning. Schema: " + json.dumps(schema, separators=(",", ":")),
            '"say" is spoken to the caller through text-to-speech: one short sentence (two only when confirming a submission). '
            '"slots" carries every intake value collected so far (cumulative). Use "submit_lead" once the required slots are filled, '
            '"alert" with {kind, summary} to hand the caller to a person, "flag_spam" with {confidence, reason} for telemarketers and scams, '
            '"end_call" with "outcome" only after the caller says goodbye or that they are done.',
            f"RUNTIME: current time {now.strftime('%A, %B %-d, %Y %-I:%M %p')} ({self.tz.key}). "
            f"Caller ID: {spoken_number(self.caller)} — it is already in the slots as the callback number; confirm it is the best number but NEVER read the digits aloud. "
            f"Required intake keys: {', '.join(required) or 'none'}. Slots so far: {json.dumps(self.slots, ensure_ascii=False)}. "
            f"Turn {self.turns} of {self.max_turns}.",
        ]
        if self.caller_info.get("customer"):
            c = self.caller_info["customer"]
            lines.append(f"This number belongs to an existing contact in our CRM: {c.get('firstName') or 'name unknown'}. Greet them by first name if known; don't ask for it again.")
        if self.turns >= self.max_turns - 2:
            lines.append("The call is near its turn limit: wrap up politely — submit what you have, then say goodbye.")
        return "\n".join(lines)

    # ── turns ─────────────────────────────────────────────────────────────────────────────────

    async def greet(self) -> str:
        g = self.compiled.get("greeting") or f"Thank you for calling, this is {self.assistant}. What can we help you with today?"
        self._log("assistant", g)
        self.messages.append({"role": "assistant", "content": json.dumps({"say": g, "action": "continue", "slots": {}})})
        self.last_say = g
        return g

    async def respond(self, caller_text: str, *, silence: bool = False) -> Decision:
        """One caller turn → one Decision (already enforced). The decision's `say` is what to speak."""
        async with self._lock:
            return await self._respond(caller_text, silence)

    async def _respond(self, caller_text: str, silence: bool) -> Decision:
        text = (caller_text or "").strip()
        if silence:
            self.silences += 1
            self._event("silence", count=self.silences)
            if self.silences >= self.silence_limit:
                d = Decision(say="I haven't heard anything, so I'll let you go. Goodbye.", action="end_call", outcome="hangup", slots=dict(self.slots))
                return await self._apply(d, caller_text=SILENCE_TEXT, goodbye_ok=True)
            text = SILENCE_TEXT
        else:
            self.silences = 0
            self._log("caller", text)
        self.turns += 1
        self.messages.append({"role": "user", "content": text or SILENCE_TEXT})
        caller_bye = not silence and self._caller_said_goodbye(text)
        goodbye_ok = caller_bye or self.silences >= self.silence_limit or self.turns >= self.max_turns
        d = await self._decide()
        return await self._apply(d, caller_text=text, goodbye_ok=goodbye_ok, caller_bye=caller_bye)

    def _caller_said_goodbye(self, text: str) -> bool:
        if GOODBYE_RE.search(text):
            return True
        return bool(NO_RE.match(text) and ANYTHING_ELSE_RE.search(self.last_say))

    async def _decide(self) -> Decision:
        """Provider → JSON → Decision; one corrective retry; then the honest fallback."""
        try:
            provider = self._provider()
        except ProviderError as e:
            self._event("error", where="provider", error=str(e))
            return fallback_decision()
        system = self.system_prompt()
        for attempt in (1, 2):
            try:
                raw = await provider.decide(system, self.messages, temperature=self.temperature)
            except ProviderError as e:
                self._event("error", where="decide", attempt=attempt, error=str(e))
                return fallback_decision()
            try:
                d = parse_decision(raw)
                if attempt == 2:
                    self.messages.pop()   # drop the corrective message; keep history clean
                self._event("decision", attempt=attempt, decision=d.to_json())
                return d
            except DecisionError as e:
                self._event("invalid_decision", attempt=attempt, reason=e.reason, raw=e.raw)
                if attempt == 1:
                    self.messages.append({"role": "user", "content": RETRY_MESSAGE})
                else:
                    self.messages.pop()
        return fallback_decision()

    async def _apply(self, d: Decision, *, caller_text: str, goodbye_ok: bool, caller_bye: bool = False) -> Decision:
        """Enforce the rules, record the assistant turn, deliver side effects."""
        # slots are cumulative; placeholders ("none", "n/a") are not values; the caller id is the callback number
        # unless the caller gave another
        self._merge_slots(d.slots)
        for q in self.intake:
            if q.get("prefillFrom") == "caller_id" and self.caller:
                v = self.slots.get(q["key"], "")
                if not v or len(_digits(v)) < 7 or re.search(r"caller|this number|same|yes|calling from", v, re.I):
                    self.slots[q["key"]] = self.caller
        d.slots = dict(self.slots)
        d.say = self._scrub_digits(d.say)

        if d.action == "flag_spam" and d.spam:
            if d.spam["confidence"] >= self.flag_at:
                self.spam = d.spam
                self.outcome = "spam"
                self._event("spam", **d.spam)
                if not d.say.rstrip().endswith("?"):   # "We're not interested, goodbye." is the last line of a spam call
                    self.end_requested = True
            else:
                self._event("spam_ignored", **d.spam)
                d.action = "continue"
        elif d.action == "alert" and d.alert:
            self.alerted = True
            self.alerts.append(d.alert)
            self._event("alert", **d.alert)
            self._emit({"type": "alert", "kind": d.alert["kind"], "summary": d.alert["summary"], "slots": dict(self.slots)})
        elif d.action == "submit_lead":
            if self.spam:
                d.action = "continue"
            elif self.slots != self._submitted_slots:   # a repeat submit only goes out when it adds or corrects something
                self.submitted = True
                self._submitted_slots = dict(self.slots)
                self._event("lead", slots=dict(self.slots))
                self._emit({"type": "lead", "slots": dict(self.slots)})
            # GOODBYE RULE: the caller said goodbye and the model submitted with a closing line → that line is the last
            # one (the server still waits the grace period and cancels the hang-up if the caller keeps talking)
            if caller_bye and d.action == "submit_lead" and not d.say.rstrip().endswith("?"):
                self.end_requested = True
                self._event("end_after_goodbye")
        elif d.action == "end_call":
            allowed = goodbye_ok or bool(self.spam) or self.turns >= self.max_turns
            if not allowed:
                self._event("end_call_refused", say=d.say)
                d.action = "continue"
                d.outcome = None
                if not d.say:
                    d.say = "Is there anything else I can help you with?"
            else:
                if d.outcome and d.outcome not in ("lead_submitted", "spam", "blocked"):   # those need a real submit / flag
                    self.outcome = d.outcome
                # the closing line is spoken right away; the force-submit safety net runs in finish(), after hang-up
                self.end_requested = True
        # an outcome on a non-final turn (e.g. continue + "declined" after a repair referral) is remembered; spam and
        # lead_submitted are never taken from the model's say-so (they come from flag_spam / an actual submit)
        if d.action != "end_call" and d.outcome and d.outcome not in ("lead_submitted", "spam", "blocked") and not self.spam:
            self.outcome = d.outcome

        if d.say:
            self._log("assistant", d.say)
            self.last_say = d.say
        self.messages.append({"role": "assistant", "content": json.dumps(d.to_json(), ensure_ascii=False)})
        return d

    def _merge_slots(self, new: dict[str, str]) -> None:
        kinds = {q.get("key"): q.get("validation") for q in self.intake}
        for k, v in new.items():
            v = (v or "").strip()
            if not v or v.lower().strip(".") in PLACEHOLDERS:
                continue
            if kinds.get(k) == "email":
                v = normalize_email(v)
                if not v:
                    continue
            self.slots[k] = v

    def _scrub_digits(self, say: str) -> str:
        """The caller's own number must never be read aloud (owner rule)."""
        d = _digits(self.caller)[-10:]
        if len(d) != 10 or not say:
            return say
        full = r"(?:\+?1[\s.-]*)?\(?\s*" + d[:3] + r"\s*\)?[\s.-]*" + d[3:6] + r"[\s.-]*" + d[6:]
        say = re.sub(full, "the number you're calling from", say)
        return re.sub(r"\b" + d[3:6] + r"[\s.-]*" + d[6:] + r"\b", "the number you're calling from", say)   # the 7-digit tail

    # ── end of call ───────────────────────────────────────────────────────────────────────────

    def _should_force_submit(self) -> bool:
        if self.submitted or self.spam or self._forced:
            return False
        if (self.outcome or "") in DECLINE_OUTCOMES:
            return False
        if self.caller_turns() < 2:
            return False
        callback = self.caller or next((v for k, v in self.slots.items() if len(_digits(v)) >= 10), "")
        return bool(callback)

    async def _maybe_force_submit(self) -> bool:
        if not self._should_force_submit():
            return False
        return await self.force_submit()

    async def force_submit(self) -> bool:
        """Safety net (Alpine's _force_submit): the call is ending and nothing was submitted. Ask the model for one
        last decision from a plain transcript — submit_lead if there is a callback number plus an address or a
        clear request, else alert kind=other — and apply it without speaking."""
        self._forced = True
        try:
            provider = self._provider()
            convo = "\n".join(f"{'Caller' if t['role'] == 'caller' else self.assistant}: {t['text']}" for t in self.transcript)
            prompt = ("Transcript of the call so far:\n" + convo +
                      "\n\n(system: the call is ending and no lead was submitted. If you have a callback number plus an address or a clear "
                      "request, answer with action submit_lead and every slot you know — a first name is enough, the caller-id number is "
                      "the callback. Otherwise answer with action alert, kind other, and a one-sentence summary so the office can call back. "
                      "\"say\" must be an empty string.)")
            raw = await asyncio.wait_for(provider.decide(self.system_prompt(), [{"role": "user", "content": prompt}], temperature=0.1), 25)
            try:
                d = parse_decision(raw)
            except DecisionError as e:
                # an empty "say" is fine here; retry the parse tolerating it
                if e.reason != "empty_say":
                    raise
                obj = json.loads(raw if raw.strip().startswith("{") else raw[raw.find("{"):raw.rfind("}") + 1])
                obj["say"] = ""
                obj["action"] = obj.get("action") or "submit_lead"
                d = Decision(say="", action=obj["action"], slots={k: str(v) for k, v in (obj.get("slots") or {}).items() if v},
                             alert=obj.get("alert"))
            self._merge_slots(d.slots)
            if d.action == "submit_lead":
                self.submitted = True
                self._submitted_slots = dict(self.slots)
                self._event("forced_lead", slots=dict(self.slots))
                self._emit({"type": "lead", "slots": dict(self.slots)})
                return True
            if d.action == "alert" and d.alert:
                self.alerted = True
                self.alerts.append(d.alert)
                self._event("forced_alert", **d.alert)
                self._emit({"type": "alert", "kind": d.alert["kind"], "summary": d.alert["summary"], "slots": dict(self.slots)})
            return False
        except Exception as e:  # noqa: BLE001
            self._event("error", where="force_submit", error=f"{type(e).__name__}: {e}"[:200])
            return False

    async def finish(self) -> None:
        """Called once the call is over for any reason (goodbye, caller hung up, carrier stop, cap, simulator end):
        force a submit when the caller left their details without one, then wait for every mid-call delivery.
        Idempotent."""
        if self._finished:
            return
        self._finished = True
        self.end_requested = True
        if await self._maybe_force_submit():
            self.outcome = "lead_submitted"
        await self.flush_deliveries()

    def final_outcome(self) -> str:
        if self.spam:
            return "spam"
        if self.submitted:
            return "lead_submitted"
        if self.outcome and self.outcome != "lead_submitted":   # a model claim of lead_submitted without a submit is ignored
            return self.outcome
        if self.alerted:
            return "alerted"
        if self.caller_turns() == 0:
            return "hangup"
        return "info"

    async def summary(self) -> str:
        if len(self.transcript) <= 1:
            return ""
        try:
            provider = self._provider()
            convo = "\n".join(f"{t['role']}: {t['text']}" for t in self.transcript)
            raw = await asyncio.wait_for(provider.text(
                "Summarize this phone call for the office in one or two plain sentences (who called, what they wanted, what happened). "
                "Plain text only: no heading, no markdown, no preamble, no JSON.\n\n" + convo, max_tokens=160), 20)
            s = re.sub(r"<[^>]+>", "", raw or "").strip().strip('"')
            return " ".join(s.split())[:600]
        except Exception as e:  # noqa: BLE001
            self._event("error", where="summary", error=f"{type(e).__name__}: {e}"[:200])
            return ""

    def caller_fields(self) -> dict[str, str]:
        name = self.slots.get("first_name") or self.slots.get("name") or ""
        address, city = split_city(self.slots.get("address", ""))
        city = self.slots.get("city") or city
        return {"name": name, "email": self.slots.get("email", ""), "address": address, "city": city}

    async def report(self, ended_at: datetime | None = None, duration_seconds: int | None = None) -> dict[str, Any]:
        """The end-of-call payload for PUT /api/voice-internal/calls/:callSid (SPEC §5)."""
        ended = ended_at or datetime.now(self.tz)
        dur = duration_seconds if duration_seconds is not None else int((ended - self.started_at).total_seconds())
        out = {
            "endedAt": ended.isoformat(timespec="seconds"),
            "durationSeconds": max(0, dur),
            "outcome": self.final_outcome(),
            "summary": await self.summary(),
            "transcript": list(self.transcript),
            "slots": dict(self.slots),
            "events": list(self.events),
            "caller": self.caller_fields(),
            "serviceNeeded": self.slots.get("need", ""),
        }
        if self.spam:
            out["spam"] = dict(self.spam)
        if self.submitted:
            out["lead"] = {"requested": True}
        if self.alerts:
            out["alerts"] = list(self.alerts)
        return out
