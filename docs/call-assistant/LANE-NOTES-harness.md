# Lane notes — harness (simulators, break test, shared fixtures)

*Branch `voice/harness`, 2026-10-02. For the integrator and the other lanes. Ownership per `LANES.md`:
`voice/sim.py`, `voice/tests/**`, `server/voice/fixtures/**`, plus `server/voice/break-test.test.ts`
(assigned to this lane by the brief) and this file.*

## What ships

| piece | where |
|---|---|
| 35 scripted calls with rubric + canned decisions (the owner's ≥ 20 + 5 prompt-injection + 10 more) | `voice/tests/scenarios/*.txt` |
| TS: reader, reference call policy, decision parser, scorer, runner (canned / live / endpoint), fixture builder, CLI | `server/voice/fixtures/*.ts` |
| TS vitest: corpus, parser cases, canned break test, 12 mutation tests, injection suite, mocked simulator endpoint, fixture shapes; `VOICE_LIVE_AI=1` live mode; `VOICE_SIM_BASE_URL` endpoint mode | `server/voice/break-test.test.ts` |
| Python: reader/scorer twins, engine-brain runner with `CannedProvider`, fake internal API, report scorer, scorecard CLI | `voice/tests/harness/*`, `voice/tests/run_break_test.py` |
| Synthetic caller over the real `/media` protocol (port of Alpine's `fake_twilio.py`), in-process engine or external | `voice/tests/fake_signalwire.py` |
| Text simulator CLI (engine brain, dry run, canned or live) | `voice/sim.py` |
| pytest: shared parser cases vs `voice/decision.py`; break test through the engine brain; harness units | `voice/tests/test_decision.py`, `voice/tests/test_break_test.py` |
| Shared fixtures | `server/voice/fixtures/compiled.v1.json`, `call-report.{lead,alert,urgent,declined,spam,forced,blocked}.json`, `decision-cases.json`, `profile.alpine-like.json` |

## Contract extensions (smallest sensible, inside harness files — architect please fold into SPEC)

1. **Simulator silence** (SPEC § 6 is silent on it): the harness sends a silent caller turn as
   `POST /simulator/turn {sessionId, text: "(silence)", silence: true}`. studio-backend's `brain.ts` already
   treats `"(silence)"`/empty text as silence; the engine's `/sim/turn` takes `silence: true`. Both work.
2. **Turn response**: the runner reads the Decision part of the turn response and ignores the bookkeeping
   keys (`ended`, `outcome` — `null` mid-call —, `events`, `turn`, `fallback`). A strict zod parse of the
   whole body fails on `outcome: null`; anyone validating the response should strip those keys first.
3. **Call fixtures** `call-report.<kind>.json` = `{ scenario, callSid, start, events, report }` where `start`
   is the `POST /calls` body, `events` the `POST /calls/:sid/events` bodies (mid-call lead/alert, with the
   slots known at that moment) and `report` the `PUT /calls/:sid` body (SPEC § 5). calls+crm tests use
   `.report` / `.events` directly. Kinds: lead, alert (existing_customer), urgent (alert + lead), declined,
   spam (no events, no lead), forced (forced submit at hang-up), blocked (0 s, pre-answer).
4. **compiled.v1.json** is built by `npx tsx server/voice/fixtures/build-fixtures.ts` with a fixed clock
   (2026-10-02T00:00Z). It was generated with **studio-backend's WIP compiler**
   (`--compiler ~/ConstructHUB-voice-studio-backend/server/voice/prompt-compiler.ts`) because the skeleton's
   stub prompt has no company facts. **Integrator: after studio-backend merges, re-run
   `build-fixtures.ts` (no flag) and commit; `--check` exits 1 when a fixture is stale.** The prompt keeps
   `{{now}}` / `{{caller}}` placeholders; the harness renders them from the scenario's `clock` and caller id.
5. **decision-cases.json** (32 cases) is the binding parser contract: engine `voice/decision.py` (pytest),
   the harness TS parser (vitest) and — automatically once merged — studio-backend's `server/voice/brain.ts`
   `parseDecision` (the vitest case imports it dynamically and skips while it is absent). The harness TS
   parser mirrors the engine's repairs (over-long `say` cut at a sentence, unknown alert kind → `other`,
   unknown outcome dropped, spam confidence clamped, trailing commas repaired, empty `say` only with `end_call`,
   tool-call objects rejected).
6. **Rubric semantics**: `expect.ended` means the CALL ended (goodbye, silence, spam, caller hang-up, caps); a
   script that runs out of lines is closed by the harness with reason `script_end` and scores `ended=false`.
   A bare "no" counts as the caller being done only right after the assistant offered "anything else?".

## Issues found (filed to lanes; the harness keeps them visible)

- **E1 — engine (`voice/brain.py` NO_RE)**: "Okay, no, thanks." / "No, okay, thanks anyway." after "anything
  else?" is not recognised as the caller being done, so `end_call` is refused: the assistant has already
  said "Thanks for calling… Goodbye." and the line stays open. Scenarios `repair_request`, `gutters_only`
  (xfail in `test_break_test.py` with this reason). Fix: allow leading/trailing fillers (okay, oh, well,
  anyway, then) around the bare "no" — the TS reference `NOTHING_ELSE_RE` in `fixtures/call-policy.ts`.
- **E2 — engine (`Brain._apply`)**: after a `flag_spam` ≥ flagAt, a later `alert` decision is still emitted to
  the app (SPEC § 4/§ 12: spam suppresses every notification). `submit_lead` is suppressed correctly.
  `test_no_notification_after_a_spam_flag` (xfail). The app side (calls+crm) should also ignore alerts on a
  call whose report says spam.
- **E3 — observation (audio)**: Whisper heard "call me, bye" as "call me by" on the synthetic call
  (`goodbye_mid_intake`); the canned brain still submitted, but a live model + GOODBYE_RE would not see a
  goodbye. Consider accepting a trailing "by." in the goodbye regex.
- **E4 — observation (audio)**: after a spam goodbye ("We're not interested… Goodbye."), a robocall that keeps
  talking inside the 1.5 s hang-up grace cancels the hang-up ("caller is speaking") and gets one more turn
  (spam_press1, spam_google_listing). Harmless (outcome spam, no notification) but a spam call should hang up
  regardless of caller speech.
- **Ownership overlap — engine branch**: `voice/engine` added `voice/sim.py`, `voice/tests/profiles/sample.json`
  and `voice/tests/scripts/*.txt` (harness-owned paths). The harness `voice/sim.py` is CLI-compatible
  (`--profile`, `--script` with `(silence)` rows, `--caller`, `--timezone`, `--json`) and adds `--scenario`,
  `--canned`, `<hangup>` and rubric scoring. **Integrator: on the add/add conflict take the harness copy**;
  the engine's `tests/scripts` + `tests/profiles` do not collide and can stay or be dropped.
- **studio-backend**: its `SILENCE_TEXT` is `"(silence)"`, the engine's brain uses `"(silence — the caller
  hasn't said anything)"`; both are internal, but the prompts should describe the same marker.

## Verified (and how)

- TS: `npx vitest run server/voice/break-test.test.ts` — canned break test 34/34 scored scenarios pass
  through the reference policy (+1 audio-only skip), mutation tests fail as they should, mocked endpoint path.
- Python, engine brain (`VOICE_ENGINE_DIR=~/ConstructHUB-voice-engine/voice`, its WIP working copy at
  2026-10-02 03:4x): 32/34 pass, 2 xfail (E1); parser 32/32 cases agree with `voice/decision.py`.
- Audio, `fake_signalwire.py --in-process --canned` (engine lane's WIP code, real Silero VAD + Whisper
  large-v3-turbo + Kokoro on the tower GPU, caller voice am_puck, fake internal API): **8/9 pass** —
  whisper_filtered (the CallRail whisper never reached the transcript), routine_lead (email read back once,
  digits never spoken), silence_hangup, spam_press1, blocked_second_call (two spam_google_listing preludes →
  the engine's real webhook answered `<Reject reason="rejected"/>`), goodbye_mid_intake, caller_hangs_up_mid_call
  (forced submit), are_you_a_bot; **repair_request fails = E1 reproduced on the media path** (the engine said
  goodbye and held the line 10 s). Turn latency (caller stops → first assistant audio) 0.55–0.78 s with the
  canned brain; recordings uploaded on every call.

## Not tested (honest list)

- **Live model**: the app's AI gateway (`AI_INTEGRATIONS_OPENAI_BASE_URL` = localhost:1106 in the dev `.env`)
  was not listening on the tower, so neither `VOICE_LIVE_AI=1` (TS) nor `run_break_test.py --live` (engine)
  ran against a real model. Both are wired and fail loudly (connection refused) rather than faking.
- **Endpoint mode against a real app**: the skeleton's simulator routes answer 501; studio-backend's are WIP.
  Run `VOICE_SIM_BASE_URL=http://127.0.0.1:82xx npx vitest run server/voice/break-test.test.ts` after
  integration (dev server, `DEV_AUTH_BYPASS_USER1=true`, user 1's org holding the add-on).
- **Audio with a live model**, `--echo`/`--noise` stress, Spanish audio, and anything on a real phone line.
