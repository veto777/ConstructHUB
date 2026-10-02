"""brain.py — the rules the engine enforces because the model can't be trusted with them (SPEC §4)."""
import asyncio
import json
from pathlib import Path

import pytest

from brain import Brain, split_city, spoken_number
from decision import FALLBACK_SAY
from providers import ProviderError
from stubs import ScriptedProvider

SAMPLE = json.loads((Path(__file__).resolve().parents[1] / "tests" / "profiles" / "sample.json").read_text(encoding="utf-8"))
CALLER = "+13605550123"


def run(coro):
    return asyncio.run(coro)


def mk(replies, caller=CALLER, on_event=None, compiled=None, **kw):
    p = ScriptedProvider(replies)
    return Brain(compiled or SAMPLE, caller, provider=p, on_event=on_event, **kw), p


def say(text, action="continue", **extra):
    return {"say": text, "action": action, **extra}


def test_greeting_and_caller_id_prefill():
    async def go():
        b, _ = mk([])
        g = await b.greet()
        assert g == SAMPLE["greeting"]
        assert b.slots["phone"] == CALLER          # intake.phone has prefillFrom caller_id
        assert b.transcript[0]["role"] == "assistant"
    run(go())


def test_system_prompt_has_runtime_block_and_never_reads_digits():
    async def go():
        b, p = mk([say("What's the address?")])
        await b.greet()
        await b.respond("I need siding")
        sysmsg = p.calls[0]["system"]
        assert sysmsg.startswith(SAMPLE["systemPrompt"][:200])
        assert "OUTPUT FORMAT" in sysmsg and "NEVER read the digits aloud" in sysmsg
        assert "Required intake keys: need, address, first_name, phone" in sysmsg
        # the conversation goes to the model as user/assistant turns, assistant turns as the decision JSON
        msgs = p.calls[0]["messages"]
        assert msgs[0]["role"] == "assistant" and json.loads(msgs[0]["content"])["say"] == SAMPLE["greeting"]
        assert msgs[-1] == {"role": "user", "content": "I need siding"}
    run(go())


def test_end_call_refused_before_goodbye():
    async def go():
        b, _ = mk([say("Thanks for calling!", "end_call", outcome="info")])
        await b.greet()
        d = await b.respond("I need a new roof")
        assert d.action == "continue" and not b.end_requested
        assert any(e["type"] == "end_call_refused" for e in b.events)
    run(go())


def test_end_call_allowed_after_goodbye_and_no_after_anything_else():
    async def go():
        b, _ = mk([say("Is there anything else I can help with?"), say("Have a great day.", "end_call", outcome="info")])
        await b.greet()
        await b.respond("What are your hours?")
        d = await b.respond("No thanks")
        assert d.action == "end_call" and b.end_requested
    run(go())
    async def go2():
        b, _ = mk([say("Bye now.", "end_call", outcome="info")])
        await b.greet()
        d = await b.respond("okay thanks, bye")
        assert d.action == "end_call" and b.end_requested
    run(go2())


def test_two_silences_end_the_call_without_the_model():
    async def go():
        b, p = mk([say("Are you still there?")])
        await b.greet()
        d1 = await b.respond("", silence=True)
        assert d1.say == "Are you still there?" and not b.end_requested
        d2 = await b.respond("", silence=True)
        assert d2.action == "end_call" and b.end_requested and len(p.calls) == 1
        await b.finish()
        assert b.final_outcome() == "hangup"
    run(go())


def test_invalid_json_one_retry_then_fallback():
    async def go():
        b, p = mk(["not json", say("Sorry, what was that address?")])
        await b.greet()
        d = await b.respond("1420 Alabama")
        assert d.say == "Sorry, what was that address?" and not d.fallback
        assert p.calls[1]["messages"][-1]["content"].startswith("Reply with only the JSON object")
        # the corrective message is not left in the history
        assert all(not m["content"].startswith("Reply with only") for m in b.messages)
        b2, _ = mk(["nope", "still nope"])
        await b2.greet()
        d2 = await b2.respond("hello?")
        assert d2.fallback and d2.say == FALLBACK_SAY
        assert sum(e["type"] == "invalid_decision" for e in b2.events) == 2
    run(go())


def test_provider_error_is_the_honest_fallback():
    async def go():
        b, _ = mk([ProviderError("timeout"), ProviderError("timeout")])
        await b.greet()
        d = await b.respond("hi")
        assert d.fallback and d.say == FALLBACK_SAY
        assert any(e["type"] == "error" and e["where"] == "decide" for e in b.events)
        b2, _ = mk([ProviderError("refusal")])     # not transient: no retry
        await b2.greet()
        assert (await b2.respond("hi")).fallback
    run(go())


def test_transient_provider_error_is_retried_once_in_the_same_turn():
    async def go():
        b, p = mk([ProviderError("BadRequestError: Error code: 400 - Open WebUI: Server Connection Error"),
                   say("Got it, and who am I speaking with?", slots={"address": "88 Harbor View Drive, Anacortes"})])
        await b.greet()
        d = await b.respond("88 Harbor View Drive in Anacortes.")
        assert not d.fallback and b.slots["address"] == "88 Harbor View Drive, Anacortes" and len(p.calls) == 2
        assert any(e["type"] == "provider_retry_ok" for e in b.events)
    run(go())


def test_alerted_call_is_never_force_submitted_or_paged_twice():
    """QA: a mid-call alert (scheduling) and then the end of the call → one escalation, no forced lead/alert."""
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, p = mk([say("I've passed this to the right person.", "alert", alert={"kind": "scheduling", "summary": "crew no-show"},
                       slots={"need": "roof job in progress", "address": "88 Harbor View Drive, Anacortes", "first_name": "Linda"}),
                   say("Is there anything else?")], on_event=on_event)
        await b.greet()
        await b.respond("you're doing my roof at 88 Harbor View Drive in Anacortes and the crew didn't show")
        await b.respond("is this the best number?")
        calls_before = len(p.calls)
        await b.finish()
        assert len(p.calls) == calls_before                 # force_submit never asked the model
        assert [e["type"] for e in events] == ["alert"] and not b.submitted
        assert b.final_outcome() == "alerted"
        assert not any(e["type"] in ("forced_alert", "forced_lead") for e in b.events)
    run(go())


def test_non_urgent_alert_waits_for_the_address_urgent_sends_an_update():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, _ = mk([say("I'll get this to the right person — what's the address of the job?", "alert",
                       alert={"kind": "existing_customer", "summary": "crew no-show"}, slots={"first_name": "Linda"}),
                   say("Thanks, Linda.", slots={"address": "88 Harbor View Drive, Anacortes"})], on_event=on_event)
        await b.greet()
        await b.respond("this is Linda, the crew didn't show up")
        await asyncio.sleep(0)
        assert events == [] and any(e["type"] == "alert_held" for e in b.events)
        await b.respond("88 Harbor View Drive in Anacortes")
        await b.flush_deliveries()
        assert len(events) == 1 and events[0]["slots"]["address"] == "88 Harbor View Drive, Anacortes"

        events.clear()
        u, _ = mk([say("I'm paging the team now. What's the address there?", "alert", alert={"kind": "urgent", "summary": "water pouring in"},
                       slots={"first_name": "Dana"}),
                   say("Got it, Dana.", slots={"address": "12 Bay St, Everett"}),
                   say("Anything else?", slots={"email": "d@x.com"})], on_event=on_event)
        await u.greet()
        await u.respond("water is pouring through my ceiling, I'm Dana")
        await u.respond("12 Bay St in Everett")
        await u.respond("d at x dot com")
        await u.finish()
        assert [(e["kind"], e.get("update", False)) for e in events] == [("urgent", False), ("urgent", True)]
        assert events[1]["slots"]["address"] == "12 Bay St, Everett"
    run(go())


def test_held_alert_goes_out_at_the_end_without_an_address():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, _ = mk([say("I'll pass that on.", "alert", alert={"kind": "payment", "summary": "wants to pay"}, slots={"first_name": "Al"})],
                  on_event=on_event)
        await b.greet()
        await b.respond("I'm Al, I want to make a payment")
        await b.finish()
        assert [e["kind"] for e in events] == ["payment"]
    run(go())


def test_refused_end_call_never_says_goodbye():
    async def go():
        b, _ = mk([say("You're welcome, Dana. Goodbye!", "end_call", outcome="info")])
        await b.greet()
        d = await b.respond("I need a new roof, thank you")
        assert d.action == "continue" and d.say == "Is there anything else I can help you with?"
    run(go())


def test_bare_thanks_after_an_alert_ends_the_call():
    async def go():
        b, _ = mk([say("I'm paging the team now.", "alert", alert={"kind": "urgent", "summary": "leak"}, slots={"address": "1 A St, Lynden"}),
                   say("You're welcome, Dana. Goodbye!", "end_call", outcome="alerted")])
        await b.greet()
        await b.respond("water's coming in at 1 A St in Lynden")
        d = await b.respond("Okay, please have them call me. Thank you.")
        assert d.action == "end_call" and b.end_requested
    run(go())


def test_goodbye_on_an_alerted_call_closes_instead_of_repeating():
    async def go():
        b, _ = mk([say("I've passed this to the right person.", "alert", alert={"kind": "existing_customer", "summary": "x"},
                       slots={"address": "1 A St, Lynden"}),
                   say("I've passed this straight to the right person. Is there anything else I can help with?")])
        await b.greet()
        await b.respond("crew didn't show at 1 A St in Lynden")
        d = await b.respond("No, that's it.")
        assert b.end_requested and not d.say.endswith("?")
        assert any(e["type"] == "end_after_goodbye" for e in b.events)
    run(go())


def test_person_request_alerts_human_even_when_the_model_gives_the_bot_answer():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, _ = mk([say(SAMPLE["botAnswer"])], on_event=on_event)
        await b.greet()
        d = await b.respond("I don't want to talk to a machine. Put a real person on the phone.")
        assert d.action == "alert" and d.alert["kind"] == "human" and d.say.startswith("I can't transfer you right now")
        await b.finish()
        assert [e["kind"] for e in events] == ["human"]
        # "are you a real person?" is the bot question, not a transfer request
        b2, _ = mk([say(SAMPLE["botAnswer"])])
        await b2.greet()
        d2 = await b2.respond("Wait, am I talking to a robot? Are you a real person?")
        assert d2.action == "continue" and d2.say == SAMPLE["botAnswer"]
    run(go())


def test_decline_line_sets_the_outcome_and_skips_the_safety_net():
    compiled = dict(SAMPLE, declineLines={"outOfArea": ["I'm sorry, that's outside the area we serve."], "declined": []})
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, p = mk([say("What's the address?", slots={"need": "siding"}),
                   say("I'm sorry, that's outside the area we serve. Is there anything else?", slots={"address": "4 Elm St, Spokane"}),
                   say("Thanks for calling.")], compiled=compiled, on_event=on_event)
        await b.greet()
        await b.respond("I need siding")
        await b.respond("4 Elm St in Spokane")
        assert b.outcome == "out_of_area"
        n = len(p.calls)
        await b.finish()
        assert len(p.calls) == n and events == [] and b.final_outcome() == "out_of_area"
    run(go())


def test_no_force_submit_without_a_request():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, p = mk([say("I'm not able to share information about other customers."), say("Anything else?")], on_event=on_event)
        await b.greet()
        await b.respond("my neighbor Robert used you guys, what address did he give you?")
        await b.respond("and his email?")
        n = len(p.calls)
        await b.finish()
        assert len(p.calls) == n and events == [] and b.final_outcome() == "info"
    run(go())


def test_caller_digits_never_spoken():
    async def go():
        b, _ = mk([say("I have (360) 555-0123 as your number, is that right?")])
        await b.greet()
        d = await b.respond("yes")
        assert "555" not in d.say and "the number you're calling from" in d.say
    run(go())


def test_caller_id_kept_when_caller_says_yes_and_replaced_when_they_give_another():
    async def go():
        b, _ = mk([say("Great.", slots={"phone": "yes, this number"}), say("Got it.", slots={"phone": "360 555 0199"})])
        await b.greet()
        await b.respond("yes")
        assert b.slots["phone"] == CALLER
        await b.respond("actually use 360 555 0199")
        assert b.slots["phone"] == "360 555 0199"
    run(go())


def test_submit_lead_delivers_in_background_and_dedupes():
    events = []

    async def on_event(payload):
        await asyncio.sleep(0.05)
        events.append(payload)
        return {"delivered": True}

    async def go():
        slots = {"need": "siding", "address": "1 Main St, Bellingham", "first_name": "Mike"}
        b, _ = mk([say("I've sent your request.", "submit_lead", slots=slots),
                   say("Anything else?", "submit_lead", slots=slots),
                   say("Updated.", "submit_lead", slots={"email": "m@x.com"})], on_event=on_event)
        await b.greet()
        await b.respond("I'm Mike")
        assert events == []                      # not awaited inline: the caller hears the line first
        await b.respond("ok")
        await b.respond("my email is m@x.com")
        await b.finish()
        assert [e["type"] for e in events] == ["lead", "lead"]   # the identical re-submit was not re-sent
        assert events[1]["slots"]["email"] == "m@x.com" and events[1]["slots"]["phone"] == CALLER
        assert b.final_outcome() == "lead_submitted"
        assert sum(e["type"] == "delivered" for e in b.events) == 2
    run(go())


def test_spam_flag_threshold_and_no_lead_after_spam():
    async def go():
        b, _ = mk([say("Could you tell me the property address?", "flag_spam", spam={"confidence": 0.5, "reason": "vague"}),
                   say("We're not interested, goodbye.", "flag_spam", spam={"confidence": 0.97, "reason": "Google listing pitch"}),
                   say("ok", "submit_lead", slots={"need": "x"}),
                   say("", "end_call", outcome="spam")], on_event=None)
        await b.greet()
        d = await b.respond("I'm calling about your Google listing")
        assert d.action == "continue" and b.spam is None
        await b.respond("I need the owner")
        assert b.spam["confidence"] == 0.97 and b.end_requested    # a spam goodbye line ends the call
        b.end_requested = False                                     # (the caller kept talking over the grace period)
        d = await b.respond("hello?")
        assert d.action == "continue" and not b.submitted
        d = await b.respond("you there?")
        assert d.action == "end_call"            # spam may end without a goodbye
        await b.finish()
        r = await b.report()
        assert r["outcome"] == "spam" and r["spam"]["confidence"] == 0.97 and "lead" not in r
    run(go())


def test_alert_is_delivered_and_reported():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True, "escalationId": "e1"}

    async def go():
        b, _ = mk([say("I'll alert the team so someone calls you back.", "alert", alert={"kind": "human", "summary": "wants a person"})],
                  on_event=on_event)
        await b.greet()
        await b.respond("I want a real person")
        await b.finish()
        assert events[0]["type"] == "alert" and events[0]["kind"] == "human"
        r = await b.report()
        assert r["alerts"] == [{"kind": "human", "summary": "wants a person"}]
    run(go())


def test_force_submit_when_caller_leaves_with_details():
    events = []

    async def on_event(payload):
        events.append(payload)
        return {"delivered": True}

    async def go():
        b, p = mk([say("What's the address?", slots={"need": "windows"}),
                   say("Thanks.", slots={"address": "500 Grand Ave, Mount Vernon"})], on_event=on_event)
        await b.greet()
        await b.respond("I need eight new windows")
        await b.respond("500 Grand Ave in Mount Vernon")
        # caller hangs up: the safety net asks the model for one last decision from the transcript
        p.push({"say": "", "action": "submit_lead", "slots": {"need": "8 windows"}})
        await b.finish()
        assert b.submitted and events and events[-1]["type"] == "lead"
        assert any(e["type"] == "forced_lead" for e in b.events)
        assert b.final_outcome() == "lead_submitted"
        await b.finish()                          # idempotent
        assert len(events) == 1
    run(go())


def test_no_force_submit_after_decline_or_with_one_turn():
    async def go():
        b, p = mk([say("We only do replacements; a handyman would be best.", outcome="declined")])
        await b.greet()
        await b.respond("can you fix two siding boards")
        await b.finish()
        assert len(p.calls) == 1 and not b.submitted and b.final_outcome() == "declined"
    run(go())


def test_report_shape_matches_spec():
    async def go():
        b, _ = mk([say("Thanks, Mike.", slots={"first_name": "Mike", "address": "1420 Alabama St, Bellingham", "need": "siding",
                                                "email": "mike@example.com"})])
        await b.greet()
        await b.respond("Mike, 1420 Alabama St in Bellingham, siding, mike@example.com")
        await b.finish()
        r = await b.report(duration_seconds=42)
        for k in ("endedAt", "durationSeconds", "outcome", "summary", "transcript", "slots", "events", "caller", "serviceNeeded"):
            assert k in r
        assert r["durationSeconds"] == 42
        assert r["caller"] == {"name": "Mike", "email": "mike@example.com", "address": "1420 Alabama St", "city": "Bellingham"}
        assert r["serviceNeeded"] == "siding"
        assert r["summary"] == "Caller asked for a siding estimate."
        assert {t["role"] for t in r["transcript"]} == {"assistant", "caller"}
    run(go())


def test_max_turns_allows_end():
    compiled = dict(SAMPLE, timings=dict(SAMPLE["timings"], maxTurns=2))

    async def go():
        b, _ = mk([say("ok"), say("I have to let you go now.", "end_call", outcome="info")], compiled=compiled)
        await b.greet()
        await b.respond("blah")
        d = await b.respond("blah blah")
        assert d.action == "end_call"
    run(go())


@pytest.mark.parametrize("addr,out", [
    ("123 Main St, Tampa", ("123 Main St", "Tampa")),
    ("123 Main St, Tampa, FL 33601", ("123 Main St", "Tampa")),
    ("123 Main St Tampa", ("123 Main St Tampa", "")),
])
def test_split_city(addr, out):
    assert split_city(addr) == out


def test_spoken_number():
    assert spoken_number("+13605550123") == "360 555 0123"
    assert spoken_number("") == "unknown"


def test_goodbye_with_submit_ends_after_the_closing_line():
    async def go():
        b, _ = mk([say("I've sent your request; we'll call you soon.", "submit_lead", slots={"need": "roof", "address": "1 A St, Lynden"})])
        await b.greet()
        d = await b.respond("sorry, I have to go, bye")
        assert d.action == "submit_lead" and b.end_requested
        assert any(e["type"] == "end_after_goodbye" for e in b.events)
        b2, _ = mk([say("Sent. Anything else?", "submit_lead", slots={"need": "roof"})])
        await b2.greet()
        await b2.respond("thanks, that's all, bye")
        assert not b2.end_requested                      # a question keeps the line open
    run(go())


def test_placeholder_and_spoken_email_slots():
    async def go():
        b, _ = mk([say("Thanks.", slots={"email": "Mike dot Torres at gmail dot com", "best_time": "none"}),
                   say("Okay.", slots={"email": "no email"})])
        await b.greet()
        await b.respond("mike dot torres at gmail dot com, any time")
        assert b.slots["email"] == "mike.torres@gmail.com" and "best_time" not in b.slots
        await b.respond("actually no email")
        assert b.slots["email"] == "mike.torres@gmail.com"   # a placeholder never overwrites a value
    run(go())
