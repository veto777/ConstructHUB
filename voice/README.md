# ConstructHUB Call Assistant — engine (`voice/`)

The Python media server that answers a SignalWire call, hears the caller
(Silero VAD + faster-whisper), decides what to say (the brain: an
OpenAI-compatible model behind a strict JSON decision protocol), speaks
(Kokoro-82M) and reports everything to the ConstructHUB app over the internal
API. It runs on the **tower GPU** as the user unit `constructhub-voice.service`
(127.0.0.1:8152 + tailnet 100.90.145.13:8152); the vb11 app proxies
`https://constructhub.us/voice/*` to it. Full contracts: `docs/call-assistant/SPEC.md`.

**It never touches Postgres.** Profile in, call report out — all through
`/api/voice-internal/*` on the app with the bearer `VOICE_INTERNAL_SECRET`.

## Layout (ownership in `docs/call-assistant/LANES.md`)

| file | what | lane |
|---|---|---|
| `server.py` | aiohttp app: SignalWire webhook, `/media` WebSocket, `/health`, `/sim/*`, `/tts/preview`, `/personas` | engine |
| `config.py` | `voice/.env` → settings (one place) | engine |
| `app_client.py` | the internal-API client (profile, calls, events, recordings, status) | engine |
| `audio.py` | mu-law codec + resampling (port of Alpine's) | engine |
| `speech.py` | STT / TTS / VAD wrappers, loaded once | engine |
| `brain.py` | the decision loop: compiled profile + transcript → `Decision` JSON (provider-agnostic) | engine |
| `decision.py` | validation + cleanup of the model's JSON (tool-call/`<think>` stripping, one retry, honest fallback) | engine |
| `personas.json` | verified Kokoro voice ids (mirrored in `shared/voice-personas.ts`) | engine |
| `providers/` | `openai_compat.py` (default, TruthCoder) · `anthropic_tools.py` (optional, real tool use) | engine |
| `render_samples.py` | verify persona voice ids + render `client/public/persona-samples/<id>.mp3` | engine |
| `selftest/` | the engine's own tests (`pytest selftest`: no GPU, no network) + `mock_app.py` + `e2e_media.py` (GPU smoke) | engine |
| `sim.py` | text simulator CLI (`python sim.py --profile tests/profiles/sample.json --script tests/scripts/booking.txt`) | harness (first version by engine) |
| `tests/` | `fake_signalwire.py` synthetic caller, scripted calls, decision-protocol unit tests | harness (sample profile + scripts by engine) |
| `deploy/` | systemd unit, install script, `RUNBOOK.md` pointer | infra |

## Setup (tower)

```bash
cd ~/ConstructHUB/voice
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # torch CUDA wheel first if pip picks CPU
cp .env.example .env && $EDITOR .env     # VOICE_INTERNAL_SECRET must equal the app's
python server.py                         # http://127.0.0.1:8152/health
```

## Tests

```bash
cd voice
.venv/bin/python -m pytest selftest -q            # 101 tests, ~40 s, no GPU/network/AI (stub provider, fake VAD/STT/TTS, mock app)
.venv/bin/python sim.py --profile tests/profiles/sample.json --script tests/scripts/booking.txt   # real AI provider, text only
```

GPU smoke run of a whole call (real VAD + Whisper + brain + Kokoro, synthetic caller over `/media`, mock app):
see the header of `selftest/e2e_media.py`. Use a free port (e.g. 8159) — `constructhub-voice.service` owns 8152.

Models download on first run to the Hugging Face cache. Kokoro voice ids are
verified at startup; a missing id is swapped for the closest match and the
final list written to `personas.json` — then mirror it in
`shared/voice-personas.ts`.

## Hard-won rules carried over from Alpine's Janice (keep them)

- **Pace outbound audio** at real time (0.8 s lead); SignalWire drops flooded audio and the caller hears "stops mid-sentence".
- **Playback state is time-based** (SignalWire sends no mark events); never let `playing` stick on.
- **Barge-in** needs ~0.65 s of loud, confident speech **and** a negative echo-correlation check; nothing interrupts the greeting.
- **Strip echo sentences** from transcripts (our own voice through the handset); ignore Whisper's phantom phrases on near-silence.
- **Whisper filter + greeting delay**: forwarded calls bridge late and CallRail-style "call whisper" announcements arrive in the first seconds.
- **Hang up only after the caller's goodbye** (+1.5 s grace, cancelled if they speak); force a lead submit before any hang-up when the caller gave a number.
- **Spam**: ask what the call is about first; flag telemarketers; no notifications for spam; two near-certain spam calls from a number → blocked pre-answer (the app's ledger decides; the engine asks at the webhook).
- **Never restart the service while a call is live** — the unit's stop timeout keeps active calls up to 10 minutes; use `deploy/restart-when-idle.sh`.

Secrets: this directory's `.env` is gitignored. Nothing from another project's
env is ever read or copied here.
