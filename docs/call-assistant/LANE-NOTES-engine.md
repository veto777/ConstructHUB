# Lane notes: engine (branch `voice/engine`, 2026-10-02)

These are the contract details the engine settled inside its own files, for the integrator and the other lanes.
Where SPEC.md is silent, this file describes what the engine actually does.

## What was proven, and how

- **Self-tests:** `cd voice && .venv/bin/python -m pytest selftest -q` gives 65 passed. They need no GPU, no network
  and no AI provider: the brain gets a stub provider, the tests use a mock app (`selftest/mock_app.py`), and the
  media calls use a fake VAD/STT/TTS on the real `Call` loop.
  - Decision parser: about 20 cases.
  - Brain rules: end_call refusal, silences, retry and fallback, digit scrubbing, deduped background lead
    delivery, spam thresholds, force-submit, the report shape and the goodbye rule.
  - Webhook: signature on, no signature, unknown, paused, blocked, models down.
  - Status callback, the simulator API, `/tts/preview` and persona samples.
  - Three whole media calls: a lead, a mid-intake hang-up that forces a submit, and barge-in (never during the
    greeting).
  - Echo correlation and echo-sentence stripping.
- **Text simulator against ConstructHUB's AI (TruthCoder `truthcode-api`)** runs
  `python sim.py --profile tests/profiles/sample.json --script tests/scripts/<x>.txt` for `booking`, `spam`,
  `repair`, `human`, `goodbye_midintake` and `price_and_bot`. All six behaved correctly: a lead with the email read
  back, spam flagged at 0.95 and ended, the repair declined with a handyman referral and no lead, a human alert
  followed by the intake, a mid-intake goodbye that submits, the price question deferred, and "are you a bot" →
  yes. Every run exited 0 (no fallback line was used).
- **GPU smoke run of whole calls.** `selftest/e2e_media.py` played a synthetic Kokoro caller (`am_puck`) over the
  real `/media` protocol. The engine ran `server.py` on 127.0.0.1:8159 with the mock app on :8191. It used real
  Silero VAD, faster-whisper large-v3-turbo on CUDA, TruthCoder and Kokoro.
  - `booking`: lead_submitted, the lead event was posted mid-call, the engine hung up after the goodbye and a 1.67
    MB WAV was uploaded.
  - `spam`: spam, no events.
  - `goodbye_midintake`: lead_submitted.
  - Reply latency was **2.8 to 5.2 s after the caller stops**: about 1 s of end-of-turn silence, Whisper at about
    0.3 s, TruthCoder at **about 2.7 to 3.7 s per decision**, then Kokoro. The model is the bottleneck. See "For the
    owner" below.
- **Persona voices:** all six Kokoro ids exist (af_heart, am_michael, af_bella, af_sarah, am_adam, am_eric), so no
  swaps were needed and `voice/personas.json` has `verified: true`. The samples were rendered to
  `client/public/voice/samples/<id>.mp3` (6 to 7.5 s each, 64 kbps mono). Whisper transcribed each one back to its
  `sampleLine`.
- Port 8152 belongs to the infra lane's `constructhub-voice.service`, which runs from the infra worktree. The engine
  lane never touched it. Its own runs used port 8159 and were stopped afterwards.

## Not tested

- Nothing reached a real phone or SignalWire. No webhook arrived from SignalWire, no number was dialled and nothing
  was purchased.
- The SignalWire **signature** algorithm is Twilio-style: HMAC-SHA1 over the URL plus the sorted form, checked
  against `SIGNALWIRE_SIGNING_KEY` and then the API token. It is unit-tested against itself only. If SignalWire
  signs differently, the fallback looks the CallSid up through LaML REST. Alpine runs on that fallback (see
  Alpine's memory note).
- The **Anthropic adapter** has never run against the live API, because ConstructHUB has no key. Its request shapes
  are covered by stubbed-client tests. The default model is `claude-opus-5-5`, called with `tool_choice: auto`, no
  `thinking` parameter, `output_config.effort: "low"` and a "call decide" instruction, because current models
  reject forced tool use and disabled thinking. Earlier models such as `claude-haiku-4-5` and `claude-sonnet-5` get a
  forced `decide` call with thinking disabled. The 1.x SDK has no `temperature` parameter, so the profile's
  temperature applies only to the OpenAI-compatible path.
- Recording upload retry: a failed upload leaves the WAV in `VOICE_RECORDINGS_DIR` with a warning, and nothing
  retries it later.

## Contract details beyond SPEC.md (engine side)

**Webhook (`POST /signalwire/voice`)**
- Verification order: the signature (URL built from `X-Forwarded-Proto/Host/Prefix`, which the infra proxy sends),
  then a CallSid lookup (the call must be live and `to` must match), and otherwise a 403. With `VOICE_SKIP_SIGNATURE=1`
  everything is accepted; use that on a dev box only.
- What the app's answer turns into:
  - Live: `<Connect><Stream url="wss://…/voice/media"><Parameter from/to/callSid/></Stream></Connect><Hangup/>`. The
    trailing `<Hangup/>` makes "the engine closed the socket" equal "the call is over".
  - `caller.blocked`: `<Reject reason="rejected"/>`. The **engine itself** reports the blocked call with
    `POST /calls` followed by `PUT /calls/:sid {outcome:"blocked", durationSeconds:0, transcript:[], …}`.
  - 404 or 423: `<Say>{say or a generic line}</Say><Hangup/>`.
  - App unreachable or models not loaded: a generic "can't take your call right now" `<Say>` plus `<Hangup/>`.
- The profile fetched at the webhook is cached for 120 s per CallSid. A stream that arrives without one fetches its
  own, and hangs up if the caller is blocked.

**Status callbacks (`POST /signalwire/status`)** are verified (a signature, or any CallSid our project knows).
They are relayed to `POST /api/voice-internal/status` as `{callSid, callStatus, duration}`.

**Order of internal-API calls during one call**
1. `POST /calls` when the stream starts.
2. Zero or more `POST /calls/:sid/events`. These are sent **in the background** so the caller hears the next
   sentence first.
3. Hang-up.
4. `PUT /calls/:sid`, which can arrive up to about 45 s after the hang-up: a force-submit of at most 25 s, a summary
   of at most 20 s, and waiting for pending events.
5. `POST /recordings/:sid`.

So the SignalWire status callback usually reaches the app **before** the PUT, and calls+crm must accept either
order.

**Lead events:** `{type:"lead", slots}` carries the **cumulative** slots. A second lead event for the same call is
sent only when the slots changed, for example when an email is added after the submit. **calls+crm must treat it as
an update (upsert on callSid), not as a new lead.** `slots.phone` is the caller-ID number unless the caller gave
another one. Placeholder values ("none", "n/a", "caller", …) are dropped, and the email slot is normalized
("mike dot torres at gmail dot com" becomes `mike.torres@gmail.com`) or dropped.

**Alert events:** `{type:"alert", kind, summary, slots}`. The kind is clamped to `ESCALATION_KINDS`, and an unknown
kind becomes `other`.

**End-of-call report (`PUT`):** it carries the SPEC fields, plus `alerts[]` when any alert happened, `spam` when the
call was flagged at or above `flagAt`, and `lead:{requested:true}` when a submit happened.
- `endedAt` is ISO time in UTC.
- Each transcript line's `t` is ISO time with the org timezone offset.
- `events[]` types: `decision`, `invalid_decision`, `error`, `silence`, `spam`, `spam_ignored`, `alert`, `lead`,
  `forced_lead`, `forced_alert`, `delivered`, `end_call_refused` and `end_after_goodbye`.

**Rules for `outcome`:**
- `spam` comes only from a real `flag_spam` at or above `flagAt`.
- Otherwise `lead_submitted` if a submit happened.
- Otherwise the last non-final outcome the model gave, e.g. `declined` or `out_of_area`.
- Otherwise `alerted`.
- Otherwise `hangup` if the caller never spoke.
- Otherwise `info`.

A model's claim of `lead_submitted`, `spam` or `blocked` without the matching action is ignored.

**Hang-up rules** (all in `brain.py` / `server.py`):
- `end_call` is honoured only after a caller goodbye or "no" to "anything else?", two silences, spam, or the
  max-turn cap.
- **New:** if the caller said goodbye and the model answered with `submit_lead` plus a closing line that is not a
  question, that line ends the call. This is the goodbye rule in the owner's spec.
- **New:** a `flag_spam` at or above `flagAt` whose line is not a question ends the call after that line.
- Every hang-up waits 1.5 s of grace, and the hang-up is cancelled if the caller keeps talking. **The socket closes
  first, and the bookkeeping runs afterwards.** A caller never waits on a silent line while the report is filed.
- `activeCalls` in `/health` stays above 0 until the bookkeeping is done, so `restart-when-idle.sh` is safe.

**Recordings:** one mono 8 kHz PCM16 WAV with both legs mixed. The assistant leg is placed by wall-clock time and
cut where a barge-in stopped playback. The local file is deleted after the upload returns a `recordingKey`.

**Engine HTTP API used by the app**
- `POST /sim/session` takes `{compiled (required, a CompiledProfile), orgId?, callerNumber?, timezone?,
  caller?:{customer}}` and returns `{sessionId, greeting, compiledVersion, persona:{name, voice}}`. It answers 400 when
  `compiled.systemPrompt` is missing.
- `POST /sim/turn` takes `{sessionId, text, silence?}` and returns the Decision plus `{ended, outcome, events}`, where
  `events` are only the ones new since the last turn. It answers 404 `unknown_session` and 409 `ended`.
- `DELETE /sim/session/:id` returns `{ended, summary, report}`, after running the force-submit check. Sessions live
  in memory with a 30-minute TTL.
- Simulator turns **never** call the app: they are a dry run, and events are only listed.
- `POST /tts/preview` takes `{personaId | voice, text ≤ 400}` and returns `audio/wav` (24 kHz).
- `GET /personas` returns the `personas.json` document.
- These routes need the bearer.

**`/health` is public** because it is reachable at `https://constructhub.us/voice/health`. It returns liveness only:
`{ok, models, activeCalls, simSessions, personasVerified, startedAt}`. The `settings` summary is added only for
bearer callers; it lists hosts, the model and which secrets are set, never their values.

**`GET /samples/<id>.mp3` is public.** The proxy sends every `/voice/*` path to the engine, so the static files in
`client/public/voice/samples/` would never be served at `/voice/samples/…`. The engine serves them from the same
folder instead. They answer 503 while the engine is down. Alternatively, infra can exempt `/voice/samples/` in
`proxy.ts` and serve the static files.

## For the other lanes / the integrator

- **architect, `shared/voice-personas.ts`:** no voice ids changed. Set `sampleUrl: "/voice/samples/<id>.mp3"` for
  all six (they are served as described above).
- **studio-backend, prompt compiler:**
  - The engine appends its own block at the end of the system prompt:
    - an OUTPUT FORMAT rule with the decision JSON Schema from `compiled.decisionSchema`;
    - the RUNTIME line: current time in the org timezone, the caller ID in spoken form with "never read it aloud",
      the required intake keys, the slots so far and the turn count;
    - a note when the caller is a known CRM customer.

    **The compiler should therefore leave out the "current time" section.** It would be stale, and it would change
    the hash on every compile.
  - The text simulator showed that the intake must say "ask the optional email (read it back once) and best time
    **before** submit_lead, unless the caller is leaving". Otherwise the model submits right after the phone
    question. `voice/tests/profiles/sample.json` has wording that works.
  - The engine reads these fields from the compiled profile: `persona.{id,voice,name}`, `greeting`, `systemPrompt`,
    `intake[].{key,required,validation,prefillFrom}`, `decisionSchema`, `timings.*`, `style.temperature`,
    `spam.{flagAt,strikeAt}`, `vocabulary[]` (appended to Whisper's initial prompt) and `version`.
- **calls+crm:** see "Lead events" above (upsert), the PUT/status ordering, and the blocked-call report the engine
  sends itself.
- **harness:**
  - `voice/sim.py`, `voice/tests/profiles/sample.json` and `voice/tests/scripts/*.txt` were written by the
    engine lane, because the brief asked for them, so the harness has a starting point. They are the harness's
    files now. `sim.py` always calls `brain.finish()` (force-submit) and exits 1 when a fallback line was used.
  - The engine's own tests live in `voice/selftest/`, which the engine owns. `selftest/mock_app.py` can stand in
    for the app in `fake_signalwire.py` runs.
- **infra:** the `requirements.txt` torch comment is fixed (PyPI `2.12.1+cu130`). `/health` keeps `activeCalls`.
  `VOICE_MODELS_DIR` is now real: it is Whisper's download root, and unset means the Hugging Face cache.

## For the owner (decisions, not blockers)

- **Latency:** TruthCoder takes about 3 s per turn, so the caller waits about 3.5 to 4.5 s after they stop
  talking. Alpine's v1 uses Claude Sonnet 5 through the Anthropic API. Two ways to cut it:
  1. A faster model behind `AI_MODEL`.
  2. `VOICE_AI_PROVIDER=anthropic` with a ConstructHUB-owned key.

  The JSON protocol means nothing can be spoken before the whole decision arrives, so streaming would not help
  without a protocol change.
- **The AI endpoint the engine uses:** `~/ConstructHUB-a5/.env` points to `localhost:1106`, which nothing listens
  on from the tower, and its key is rejected with 401 by the live TruthCoder. So `voice/.env` uses ConstructHUB's
  **production** TruthCoder: vb11 `:8250` over the tailnet, with the key from `~/ConstructHUB-live/.env` (same
  hash). This is ConstructHUB's own provider, not Alpine's. The operator should confirm this is the intended
  endpoint for the engine.
