# Call Assistant — RUNBOOK (infra lane)

How the AI Call Assistant engine runs, where, and what to do when it does not. Contracts are in
`SPEC.md`; ownership in `LANES.md`. **Nothing here deploys itself** — every production step is run by a
person following this page. Secrets are named, never written down.

## 1. The shape

```
caller ──▶ SignalWire ──HTTPS/WSS──▶ https://constructhub.us/voice/*          (vb11, the app, :8110)
                                       server/voice/proxy.ts  ── tailnet ──▶  100.90.145.13:8152 (tower GPU)
                                                                               constructhub-voice.service
                                       /api/voice-internal/*  ◀── bearer ────  the engine (voice/, aiohttp)
```

- **Tower** (this box, RTX PRO 6000): the Python engine, user unit `constructhub-voice.service`, listening on
  `127.0.0.1:8152` **and** the tailnet address `100.90.145.13:8152` (`VOICE_BIND`). It shares the GPU with
  `alpine-voice*` (ports 8150/8151, its own venv/env/units) — the two never share anything and neither
  depends on the other. Models are loaded once per process (~3 GB VRAM when the engine lane lands them).
- **vb11** (production app): no GPU. `server/voice/proxy.ts` forwards `/voice/<rest>` to
  `${VOICE_ENGINE_URL}/<rest>` — HTTP streamed raw (SignalWire's form posts arrive before any body
  parser) and the `/voice/media` WebSocket upgrade tunneled over a plain TCP socket. The engine answers
  the app's internal API only with the bearer `VOICE_INTERNAL_SECRET`; the app checks the same value.
- **No new DNS or tunnel entries.** SignalWire's webhook base is the app's own domain; vb11 reaches the
  tower over the existing tailnet. The engine itself is never exposed publicly.

## 2. Environment (names only)

| where | file | keys |
|---|---|---|
| vb11 app | `~/ConstructHUB-live/.env` | `VOICE_ENGINE_URL` (`http://100.90.145.13:8152`), `VOICE_INTERNAL_SECRET`, `VOICE_PUBLIC_BASE` (`https://constructhub.us/voice`), `VOICE_PROXY_TIMEOUT_MS` (optional, 30000), `VOICE_ESCALATION_WORKER_ENABLED` |
| tower engine | `/home/veto/ConstructHUB/voice/.env` (gitignored, mode 600) | everything in `voice/.env.example`: `VOICE_PORT`, `VOICE_BIND`, `VOICE_APP_URL` (`https://constructhub.us`), `VOICE_INTERNAL_SECRET` (**same value**), `VOICE_PUBLIC_BASE`, the AI provider values, the SignalWire values (verification only), model/device settings |

The engine reads **only** `voice/.env` (through `config.py`). Operators copy ConstructHUB's own
`AI_INTEGRATIONS_OPENAI_*`, `AI_MODEL` and `SIGNALWIRE_*` values from the app's `.env` into it — never
anything from another project.

## 3. Install / update the engine on the tower

```bash
cd ~/ConstructHUB && git pull                      # the canonical checkout: /home/veto/ConstructHUB/voice
bash voice/deploy/install.sh                       # venv + requirements + .env from example + model warm-up + unit
$EDITOR voice/.env                                 # first time: fill VOICE_INTERNAL_SECRET, VOICE_APP_URL, AI_*, SIGNALWIRE_*
bash voice/deploy/install.sh --no-models --enable --start   # enable at login, start when idle
bash voice/deploy/healthcheck.sh https://constructhub.us    # local + tailnet + through the app
```

`install.sh` is idempotent. Flags: `--no-models` (skip the warm-up), `--no-unit` (venv only), `--enable`,
`--start` (goes through `restart-when-idle.sh`). When run from a checkout other than
`/home/veto/ConstructHUB/voice` (a lane worktree) it writes the drop-in
`~/.config/systemd/user/constructhub-voice.service.d/checkout.conf` pointing the unit at that checkout
and says so; delete the drop-in + `daemon-reload` to return to the canonical path.

Model warm-up (`deploy/warmup.py`) pulls faster-whisper `large-v3-turbo` into `VOICE_MODELS_DIR`
(`voice/models/`, gitignored), Kokoro-82M + the `af_heart` voice and Silero VAD into the Hugging Face
cache. Verified on the tower 2026-10-02: torch 2.12.1+cu130, CUDA on, all four stages ok.

## 4. Day-to-day

| do | command |
|---|---|
| status / logs | `systemctl --user status constructhub-voice` · `journalctl --user -u constructhub-voice -f` |
| health | `bash voice/deploy/healthcheck.sh [APP_URL]` — prints `ok`, `models`, `activeCalls` for local, tailnet and the proxy |
| **restart** | `bash voice/deploy/restart-when-idle.sh` — **never** `systemctl --user restart` by hand |
| stop | `bash voice/deploy/restart-when-idle.sh stop` |
| start | `bash voice/deploy/restart-when-idle.sh start` |

**The "never restart during a live call" rule.** A restart cuts every call in progress (Alpine learned it
on the owner's own call). `restart-when-idle.sh` polls `/health` until `activeCalls == 0` (up to
`--max-wait`, default 600 s) and only then restarts; it refuses (exit 3) if calls are still live. The unit's
`TimeoutStopSec=620` matches `server.py`'s `shutdown_timeout=600`, so even a system shutdown lets live
calls finish for up to ten minutes. A plain `systemctl --user restart` still *works* — it is the wrong tool.

## 5. The app side (vb11)

1. Deploy the app build as in `HANDOFF.md` (dump first, `bash script/deploy-vb11.sh`).
2. Set `VOICE_ENGINE_URL`, `VOICE_INTERNAL_SECRET`, `VOICE_PUBLIC_BASE` in the app's `.env`; restart the
   app service.
3. `curl -s https://constructhub.us/voice/health` → the engine's JSON through the proxy
   (`bash voice/deploy/healthcheck.sh https://constructhub.us` from the tower does the same).
4. `curl -s -H "Authorization: Bearer …" https://constructhub.us/api/voice-internal/health` → `{ok:true}`
   (503 `voice_internal_unconfigured` when the secret is unset on the app).

The proxy is registered in `server/index.ts` before every body parser; it needs nothing else. It never
proxies `/api/*`, and refuses `/voice/api…` with 404 so the public path can never reach the internal API
through the engine.

## 6. How SignalWire gets the webhook URLs

The numbers lane writes `voiceWebhookUrls()` (from `server/voice/proxy.ts`, derived from
`VOICE_PUBLIC_BASE`) on every purchased `IncomingPhoneNumber`:

- `VoiceUrl` = `https://constructhub.us/voice/signalwire/voice` (POST, form-encoded)
- `StatusCallback` = `https://constructhub.us/voice/signalwire/status`
- the media stream URL inside the LaML the engine returns = `wss://constructhub.us/voice/media`

Changing `VOICE_PUBLIC_BASE` after numbers exist means re-saving every number (the Numbers tab, or the
SignalWire dashboard). To verify a number: SignalWire dashboard → Phone Numbers → the number → Voice
settings must show the two URLs above. **No number is pointed at the engine by this lane** (owner decision;
see §10).

## 7. Secret rotation (`VOICE_INTERNAL_SECRET`)

1. `openssl rand -hex 32` (never a `chub_` prefix — that is the public-API key shape).
2. Put it in the app's `.env` on vb11 and restart the app (webhooks keep flowing: the proxy does not use
   the secret; only the engine's calls into `/api/voice-internal/*` do).
3. Put the same value in the tower's `voice/.env`, then `restart-when-idle.sh` the engine. Between steps 2
   and 3 the engine's internal calls fail (`401`) — the engine still answers calls but cannot load profiles,
   so rotate at a quiet hour and do 3 right after 2.
4. `healthcheck.sh` + one simulator turn from the Studio.

## 8. When SignalWire gets a 503 (or callers hear "the call assistant is unavailable")

The proxy answers `503 {code:"voice_engine_unavailable"}` when it cannot connect to the engine and
`504 {code:"voice_engine_timeout"}` when the engine accepted but sent nothing within
`VOICE_PROXY_TIMEOUT_MS` (for the media WebSocket: no handshake answer within that time). SignalWire then plays its own error to the caller (and with a Fallback URL set
on the number, calls that instead — the numbers lane may set one later). Check in this order:

1. **Engine process:** `systemctl --user is-active constructhub-voice` on the tower; `journalctl --user -u
   constructhub-voice -n 100`. A crash loop stops after 5 starts in 10 min (`StartLimitBurst`) —
   `systemctl --user reset-failed constructhub-voice` after fixing the cause.
2. **Bind:** `ss -ltn | grep 8152` must show both `127.0.0.1:8152` and `100.90.145.13:8152`. If only the
   loopback is there the tailnet interface came up after the engine — restart when idle.
3. **Tailnet:** from vb11, `curl -m 5 http://100.90.145.13:8152/health`. `tailscale status` on both ends.
4. **App env:** `VOICE_ENGINE_URL` on vb11 (default is right for the tower); the app's journal shows
   `[voice-proxy] … ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH` with the target.
5. **GPU:** `nvidia-smi` — the engine and `alpine-voice*` must both fit; an OOM shows in the engine log at
   model load. Nothing here restarts `alpine-voice*` (another project's unit).
6. **Timeouts (504):** the model provider is slow (`AI_TIMEOUT_MS` in `voice/.env`) or the engine is loading
   models after a restart (first `/health` shows `models:false`).

The internal API answering `503 voice_internal_unconfigured` means `VOICE_INTERNAL_SECRET` is unset on
the app; `401` means the two values differ.

## 9. Roll back

- **Engine:** `cd ~/ConstructHUB && git checkout <previous-good-sha> -- voice/` (or check out the previous
  tag), `bash voice/deploy/install.sh --no-models`, `bash voice/deploy/restart-when-idle.sh`. The venv is
  rebuilt only when `requirements.txt` changed. Models stay cached.
- **App:** redeploy the previous build to vb11 (HANDOFF runbook). Removing `VOICE_ENGINE_URL` does *not*
  disable the proxy — it falls back to the default tower address; to take the feature offline, stop the
  engine (`restart-when-idle.sh stop`): every `/voice/*` request then answers 503 and the CRM Overview tab
  shows the engine as down.
- **Numbers:** a purchased number keeps its webhook URLs; with the engine stopped callers hear
  SignalWire's error. To send callers elsewhere, change the number's Voice URL in the Numbers tab.

## 10. Alpine cut-over — OWNER decision, not a build step

Alpine's own receptionist (Janice — a separate project with its own checkout, units `alpine-voice*`, SignalWire number
**+1 360-585-8200**) keeps running untouched on the same GPU. Only when the owner says so:

- [ ] the ConstructHUB Call Assistant has passed the break test (SPEC §18.6) on the single
      `constructhub-test` number;
- [ ] an Alpine org exists in the CRM with the Call Assistant add-on and a published profile matching the
      rules in the owner's AI receptionist plan of 2026-10-01 (section "ALPINE RULES AS CONFIGURED");
- [ ] text escalations in the ConstructHUB profile reproduce Alpine's (WA/FL recipients, cadence);
- [ ] the owner repoints +1 360-585-8200's Voice URL / StatusCallback to the ConstructHUB webhook (the
      SignalWire dashboard, or the number is claimed into the Alpine org through the Numbers tab);
- [ ] Alpine's forwarding (CallRail + carriers) is left as is — it already lands on that number;
- [ ] `alpine-voice*` stays up until the owner confirms a week of clean calls, then the owner decides whether
      to stop it. Nobody in a ConstructHUB lane stops, restarts or reads the env of `alpine-voice*`.

## 11. Dev stage on the tower (what the infra lane left running, 2026-10-02)

- Unit installed from `voice/deploy/constructhub-voice.service` with the drop-in
  `constructhub-voice.service.d/checkout.conf` → runs from `~/ConstructHUB-voice-infra/voice` (venv
  `.venv`, env `voice/.env` with a freshly generated secret, `VOICE_SKIP_SIGNATURE=1`, no AI/SignalWire
  values). Started, **not enabled** at login (the worktree is temporary).
- A dev app spawned from the same worktree on `http://127.0.0.1:8201` (`tmp/dev-app.pid`, log
  `tmp/dev-app.log`, relaunch with `bash tmp/dev-app.sh` — gitignored; it reads the secret from
  `voice/.env` so both sides match) with `VOICE_ENGINE_URL=http://127.0.0.1:8152`, DB `constructhub_dev_a6`.
  Proven: `/voice/health` through the proxy on local + tailnet, the form webhook, the bearer-guarded
  `/voice/personas`, a `/voice/media` WebSocket 101 through the tunnel, 503 with the engine stopped,
  `restart-when-idle.sh stop|start|restart`; 2026-10-02 (resumed lane): the same again plus a proxy on a
  scratch port pointed at the **tailnet** address `100.90.145.13:8152` (HTTP 200 + WS 101).
- **No SignalWire number points at it.** To tear down: `restart-when-idle.sh stop`, `kill $(cat
  ~/ConstructHUB-voice-infra/tmp/dev-app.pid)`, delete the drop-in, `daemon-reload`.
