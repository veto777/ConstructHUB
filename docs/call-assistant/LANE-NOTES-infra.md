# Lane notes — infra (branch `voice/infra`, 2026-10-02)

Small extensions to SPEC §8/§9 made inside this lane's files, for the integrator and the other lanes.

## Proxy (`server/voice/proxy.ts`)

- **Any** upgrade under `/voice/…` is tunneled (SPEC §8 names only `/voice/media`). `/voice/media` is what
  SignalWire uses; the general rule costs nothing and lets the engine add a second stream later. Upgrades
  elsewhere (`/vite-hmr`) are left to their own listeners.
- `/voice/api…` is refused with 404 before the engine sees it (so the public path can never be used to
  reach anything that looks like an internal API, even if the engine grew one).
- New env `VOICE_PROXY_TIMEOUT_MS` (default 30000): time to response headers / tunnel accept. 504
  `voice_engine_timeout` on expiry; 503 `voice_engine_unavailable` when the engine cannot be reached.
  Both are JSON, `Cache-Control: no-store`, no error detail leaks (the detail goes to the app log as
  `[voice-proxy] … ECONNREFUSED`).
- Headers added for the engine: `X-Forwarded-For` (appended), `X-Forwarded-Proto`, `X-Forwarded-Host`,
  `X-Forwarded-Prefix: /voice`. The engine lane can build its public URLs from these instead of
  `VOICE_PUBLIC_BASE` if it ever wants to.
- Extra exports the other lanes may use: `fetchEngineHealth(timeoutMs)` (direct GET of the engine's
  `/health`, null when down — meant for `/api/crm/voice/status` in the numbers/billing lane's Overview),
  `parseEngineTarget`, `stripVoicePrefix`, `isVoiceUpgrade`, `forwardHeaders`, `voiceProxyTimeoutMs`.
- Keep-alive agents (64 sockets) to the engine; no retries (a webhook retry comes from SignalWire).
- WebSocket tunnel timeouts: the TCP connect **and** the engine's first handshake byte must each arrive
  within `VOICE_PROXY_TIMEOUT_MS` (504 otherwise; an engine that hangs up before answering → 503). After
  the 101 there is no idle timeout (a call can be silent); TCP keep-alive (30 s) runs on both legs so a dead
  tailnet path is noticed. The engine → caller leg is piped only after the engine answers, so an engine
  EOF during the handshake becomes a clean 503 instead of a bare hang-up.

## For the engine lane (observed through the proxy, your files)

- `GET /health` is public through `https://constructhub.us/voice/health` (SignalWire and the healthcheck
  need no bearer). Today it returns the full `settings` dict: no secret values, but it does publish
  `app_url`, `public_base`, the AI provider/model and which credentials are set. Suggest returning only
  `ok`, `models`, `activeCalls`, `startedAt` without the bearer and the `settings` block only with it.
  `healthcheck.sh` / `restart-when-idle.sh` / `fetchEngineHealth` read only `ok`, `models`, `activeCalls`.
- Signature verification: the proxy forwards `X-SignalWire-Signature` untouched and the body byte-exact,
  but the URL SignalWire signed is the *public* one (`VOICE_PUBLIC_BASE` + path), not the engine's local
  path — build it from `VOICE_PUBLIC_BASE` (or `X-Forwarded-Proto/Host/Prefix`).

## Suggestion for the integrator / owner (not built)

- When the engine is down, SignalWire gets a 503 and plays its own error. A friendlier failure is a
  per-number **Fallback URL** pointing at an app route that answers LaML `<Dial>` to the org's own phone
  (forward the call to the office) — that needs the org lookup on the app side, so it belongs to the
  numbers lane; the proxy cannot know the org.

## Engine package (observed, not changed — engine lane's files)

- `voice/requirements.txt` says "install torch from the cu128 index if pip resolves a CPU wheel": the cu128
  index tops out at torch 2.11.0, so `torch==2.12.1` **cannot** come from it. Plain PyPI gives
  `2.12.1+cu130`, which is what the tower now runs (CUDA on, RTX PRO 6000). `install.sh` installs from PyPI
  by default and honours `TORCH_INDEX_URL` when the engine lane wants a specific CUDA build. Suggest fixing
  the comment.
- `/health` reports `activeCalls` (camelCase); Alpine's reports `active_calls`. `restart-when-idle.sh` and
  `healthcheck.sh` accept both — keep the key when the engine lane rewrites `health()`.
- `server.py` runs with `shutdown_timeout=600`; the unit's `TimeoutStopSec=620` depends on it.
- Kokoro's warm-up pulled `en-core-web-sm` (spaCy) on first use; it is in the venv now and `warmup.py`
  will do it again on a fresh box — no requirements change needed.

## Deploy (`voice/deploy/`)

- `install.sh` writes a systemd drop-in when run from a non-canonical checkout (a worktree); production
  runs from `/home/veto/ConstructHUB/voice` with no drop-in. The integrator should delete
  `~/.config/systemd/user/constructhub-voice.service.d/checkout.conf` once `voice/` is on `main` in
  `~/ConstructHUB` and re-run `install.sh` there.
- `Restart=on-failure` per the brief (Alpine uses `always`); `StartLimitBurst=5/600s` so a broken deploy
  cannot thrash the GPU.
- The dev stage left running on the tower is described in `RUNBOOK.md` §11 (engine from this worktree,
  dev app on :8201, relaunched by the gitignored `tmp/dev-app.sh`). It holds port 8152, which the engine lane will want for its own runs: stop it with
  `bash voice/deploy/restart-when-idle.sh stop` first, or point `VOICE_PORT` elsewhere in their `.env`.

## Not done / untested

- Nothing was deployed to vb11; the proxy has run only in the worktree's dev app and in `proxy.test.ts`.
- No SignalWire number was created or pointed anywhere.
- The HTTPS engine target (`VOICE_ENGINE_URL=https://…`) is implemented (tls.connect / https.request)
  but untested — the tower is reached over plain HTTP on the tailnet.
- Only the skeleton engine has been behind the proxy: a real call (paced media frames for minutes, barge-in
  marks) has not crossed the tunnel yet — the byte-exact relay is unit-tested with text + binary frames.
- `restart-when-idle.sh` with a *busy* engine was tested against a fake `/health` (`activeCalls: 1` → waits,
  then exit 3 "NOT restarting"); the real engine has never had a live call to wait for.
- Not run through Cloudflare's tunnel: production WSS goes caller → Cloudflare → cloudflared on vb11 → the
  app → tailnet → tower. cloudflared passes WebSocket upgrades by default; verify with the first test call.
- `HANDOFF.md`'s "Call Assistant" section is appended, not yet reflecting the other lanes.
