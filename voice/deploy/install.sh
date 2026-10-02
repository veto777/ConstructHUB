#!/usr/bin/env bash
# ConstructHUB Call Assistant engine — install or update it on the tower (infra lane).
#
#   bash voice/deploy/install.sh [--no-models] [--no-unit] [--enable] [--start]
#
# What it does (idempotent, safe to re-run):
#   1. creates voice/.venv (python3 -m venv) and installs voice/requirements.txt
#   2. copies voice/.env.example to voice/.env if there is none (you then fill it in)
#   3. warms the models up (downloads faster-whisper / Kokoro / Silero into the cache) unless --no-models
#   4. installs the user unit constructhub-voice.service (daemon-reload) unless --no-unit;
#      --enable also enables it at login, --start (re)starts it NOW — only when idle (restart-when-idle.sh)
#
# It never touches another project's units, venvs or env files. Docs: docs/call-assistant/RUNBOOK.md.
set -euo pipefail

VOICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="constructhub-voice.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PYTHON="${PYTHON:-python3}"
WITH_MODELS=1 WITH_UNIT=1 ENABLE=0 START=0
for arg in "$@"; do
  case "$arg" in
    --no-models) WITH_MODELS=0 ;;
    --no-unit) WITH_UNIT=0 ;;
    --enable) ENABLE=1 ;;
    --start) START=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

cd "$VOICE_DIR"
echo "== engine dir: $VOICE_DIR"

# 1. venv + requirements -----------------------------------------------------------------------------
if [ ! -x .venv/bin/python ]; then
  echo "== creating .venv with $("$PYTHON" --version 2>&1)"
  "$PYTHON" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --upgrade pip wheel
# requirements.txt is pinned by the engine lane. torch is resolved from PyPI (its Linux wheels ship
# CUDA); set TORCH_INDEX_URL to force a specific CUDA build, e.g. https://download.pytorch.org/whl/cu128
if [ -n "${TORCH_INDEX_URL:-}" ]; then
  torch_pin="$(grep -E '^torch==' requirements.txt | head -1 || true)"
  echo "== installing ${torch_pin:-torch} from $TORCH_INDEX_URL"
  .venv/bin/python -m pip install --quiet "${torch_pin:-torch}" --index-url "$TORCH_INDEX_URL"
fi
echo "== installing requirements.txt"
.venv/bin/python -m pip install --quiet -r requirements.txt
.venv/bin/python - <<'PY'
import importlib.util, sys
missing = [m for m in ("aiohttp", "httpx", "dotenv") if importlib.util.find_spec(m) is None]
if missing:
    sys.exit(f"venv is missing {missing} — the server cannot start")
have = {m: importlib.util.find_spec(m) is not None for m in ("torch", "faster_whisper", "kokoro", "silero_vad")}
print("== speech stack:", ", ".join(f"{k}={'ok' if v else 'MISSING'}" for k, v in have.items()))
PY

# 2. env --------------------------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "== created voice/.env from .env.example — fill in VOICE_INTERNAL_SECRET, VOICE_APP_URL and the AI/SignalWire values"
else
  chmod 600 .env || true
fi
mkdir -p recordings models

# 3. model warm-up -----------------------------------------------------------------------------------
if [ "$WITH_MODELS" = 1 ]; then
  echo "== warming models up (first run downloads them; ~2 GB)"
  .venv/bin/python deploy/warmup.py || echo "!! model warm-up failed — the service still starts, but calls need the models (see RUNBOOK)"
fi

# 4. unit -------------------------------------------------------------------------------------------
if [ "$WITH_UNIT" = 1 ]; then
  mkdir -p "$UNIT_DIR"
  if [ "$VOICE_DIR" != "/home/veto/ConstructHUB/voice" ]; then
    # A worktree / dev checkout: keep the committed unit canonical and point this install at the
    # checkout through a drop-in, so the production path is never edited by a lane.
    mkdir -p "$UNIT_DIR/$UNIT_NAME.d"
    cat > "$UNIT_DIR/$UNIT_NAME.d/checkout.conf" <<EOF
# Written by voice/deploy/install.sh — this box runs the engine from a non-canonical checkout.
# Delete this file (and daemon-reload) to go back to /home/veto/ConstructHUB/voice.
[Service]
WorkingDirectory=$VOICE_DIR
ExecStart=
ExecStart=$VOICE_DIR/.venv/bin/python server.py
EOF
    echo "== drop-in written: $UNIT_DIR/$UNIT_NAME.d/checkout.conf (engine runs from $VOICE_DIR)"
  else
    rm -f "$UNIT_DIR/$UNIT_NAME.d/checkout.conf"
  fi
  install -m 644 deploy/constructhub-voice.service "$UNIT_DIR/$UNIT_NAME"
  systemctl --user daemon-reload
  echo "== unit installed: $UNIT_DIR/$UNIT_NAME"
  [ "$ENABLE" = 1 ] && systemctl --user enable "$UNIT_NAME"
  if [ "$START" = 1 ]; then
    bash deploy/restart-when-idle.sh
  fi
fi

echo "== done. next: bash voice/deploy/healthcheck.sh"
