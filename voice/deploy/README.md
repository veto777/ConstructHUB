# voice/deploy — the engine on the tower (infra lane)

| file | what |
|---|---|
| `constructhub-voice.service` | the systemd **user** unit (`TimeoutStopSec=620`, `Restart=on-failure`, runs from `/home/veto/ConstructHUB/voice`) |
| `install.sh` | venv + `requirements.txt` + `.env` from the example + model warm-up + unit install (`--no-models`, `--no-unit`, `--enable`, `--start`) |
| `warmup.py` | downloads/loads faster-whisper, Kokoro and Silero once so the first call does not wait |
| `restart-when-idle.sh` | the ONLY way to restart/stop: waits for `activeCalls == 0` first |
| `healthcheck.sh` | local + tailnet `/health`, and `/voice/health` through an app URL |

Runbook with every step, env name and failure mode: `docs/call-assistant/RUNBOOK.md`.
