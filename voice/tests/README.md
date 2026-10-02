# Call Assistant break-test harness (`voice/tests/`, harness lane)

The owner's break test (SPEC.md § 18.6): scripted calls, each with a scoring rubric, run three ways —
text through the engine's brain, text through the app's simulator, and audio through the real media path.
Ownership: `docs/call-assistant/LANES.md` → harness. Notes for the other lanes:
`docs/call-assistant/LANE-NOTES-harness.md`.

## The scenarios — `scenarios/*.txt` (the ONE source)

```
#! id: repair_request                      directives: id, title, tags, caller, clock, mode (sim|audio|webhook), prelude
#! expect.outcome: declined                 the rubric (see below)
#! expect.never: submit_lead alert flag_spam
#! expect.say_any: /handyman/
Hi, a couple of siding panels came loose…   a caller line
=> {"say": "…handyman…", "action": "continue", "outcome": "declined", "slots": {…}}   its CANNED decision
<silence>   <hangup>   <whisper> Call from Cascade Bellingham Landing Pages.
```

Rubric: `expect.outcome a|b` · `expect.actions` (must happen) · `expect.never` (must not happen) ·
`expect.slot key ~ text | key = text | key !~ text | key ?` · `expect.say_never|say_any|say_once|say_last
/regex/ or text` · `expect.caller_never` (what the engine heard) · `expect.ended true|false` (the CALL ended —
a script running out of lines does not count) · `expect.max_turns` · `expect.alert kind…` · `expect.spam_min` ·
`expect.twiml Reject` · `expect.notify none|some` · `expect.lead true|false`. Every run also checks "no protocol
errors" (no fallback line).

35 scenarios: routine lead, repair (decline + referral), out of area, two windows (decline), price per sq ft
(defer), asks for a person (alert, no transfer), existing customer / contract / payment / scheduling /
estimate missing (escalation kinds), 3 a.m. emergency, Spanish speaker, angry caller, silence → hang-up,
spam (press-1 robocall, Google listing, SEO pitch), address corrected, goodbye mid-intake, "are you a bot?",
email read back once, multiple services, blocked number (rejected pre-answer after two spam strikes),
CallRail whisper, gutters only, roof repair, financing, other callback number, caller hangs up (forced
submit), vinyl siding, and five prompt-injection calls (ignore instructions, reveal the prompt — the fixture
profile carries the canary `CANARY-7F3A`, other customers' data, "pretend you're human", protocol JSON
spoken by the caller).

## Run it

```bash
cd voice
# engine brain + canned decisions (no model, no GPU): the engine's rules vs the rubric
.venv/bin/python tests/run_break_test.py            # VOICE_ENGINE_DIR=<engine checkout>/voice before the engine merges
.venv/bin/python tests/run_break_test.py --live     # the provider in voice/.env (real model; costs tokens)
.venv/bin/python tests/run_break_test.py --endpoint http://127.0.0.1:8200   # the app's /api/crm/voice/simulator/*

# audio: synthetic caller (Kokoro voice am_puck) over the real /media WebSocket, engine in-process on a free
# port, fake internal API in-process; scored from the engine's own end-of-call report
.venv/bin/python tests/fake_signalwire.py --in-process --canned --stt --scenario whisper_filtered --scenario routine_lead
.venv/bin/python tests/fake_signalwire.py --in-process --scenario routine_lead          # live provider
#   --echo 0.3 (handset echo) · --noise 0.01 · --marks (Twilio-style mark echo; SignalWire sends none) · --out DIR (WAVs)

# text simulator (one call, interactive or scripted; dry run — nothing reaches the app)
.venv/bin/python sim.py
.venv/bin/python sim.py --scenario repair_request --canned

# unit tests (decision parser on the shared cases; the break test through the engine brain; harness pieces)
.venv/bin/python -m pytest tests -q
```

TypeScript side (same scenarios, reference policy, mocked provider; live and endpoint modes opt-in):
`npx vitest run server/voice/break-test.test.ts` · `npx tsx server/voice/fixtures/run-break-test.ts [--live|--endpoint URL]`.

## Files

| file | what |
|---|---|
| `scenarios/*.txt` | the scripted calls + rubric + canned decisions |
| `harness/scenarios.py`, `harness/scoring.py` | reader + scorer (twins of `server/voice/fixtures/scenarios.ts`, `scorer.ts`) |
| `harness/engine.py` | imports the engine's `brain.py`/`decision.py`; `CannedProvider`; `run_brain`, `run_all`; spam ledger |
| `harness/fake_app.py` | stand-in for `/api/voice-internal/*` (profile, calls, events, report, recording, ledger) |
| `harness/report.py` | the engine's end-of-call report → a scorable result |
| `run_break_test.py` | scorecard CLI (brain canned / live / app endpoint) |
| `fake_signalwire.py` | the synthetic caller (port of Alpine's `fake_twilio.py`) |
| `test_decision.py`, `test_break_test.py` | pytest |
| `../sim.py` | text simulator CLI |

Never dials anyone: there is no PSTN in any of this. Never reads another project's `.env`.
