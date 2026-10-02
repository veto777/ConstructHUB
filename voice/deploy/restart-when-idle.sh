#!/usr/bin/env bash
# Restart (or stop) the ConstructHUB Call Assistant engine ONLY when no call is live — modelled on
# Alpine's restart-when-idle.sh (a plain restart once killed the owner's live call).
#
#   bash voice/deploy/restart-when-idle.sh [restart|stop] [--max-wait SECONDS]
#
# Polls GET /health on the engine until activeCalls == 0 (up to --max-wait, default 600 s = the unit's
# stop budget), then runs the systemctl action. If the engine is down the action runs at once.
# Env: VOICE_UNIT (default constructhub-voice), VOICE_HEALTH_URL (default http://127.0.0.1:8152/health).
set -u
ACTION=restart; MAX_WAIT=600
while [ $# -gt 0 ]; do
  case "$1" in
    restart|stop|start) ACTION=$1 ;;
    --max-wait) shift; MAX_WAIT=${1:-600} ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
UNIT="${VOICE_UNIT:-constructhub-voice}"
URL="${VOICE_HEALTH_URL:-http://127.0.0.1:8152/health}"

active_calls() {
  # Prints the live-call count, or "down" when the engine does not answer. Accepts both key spellings.
  curl -s -m 3 "$URL" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
except Exception:
    print("down"); sys.exit()
print(int(j.get("activeCalls", j.get("active_calls", 0)) or 0))' 2>/dev/null || echo down
}

if [ "$ACTION" = start ]; then
  systemctl --user start "$UNIT" && echo "$UNIT started"; exit $?
fi

waited=0
while :; do
  n=$(active_calls)
  if [ "$n" = down ]; then echo "$UNIT: engine not answering at $URL — ${ACTION}ing now"; break; fi
  if [ "$n" = 0 ]; then break; fi
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "$UNIT: still $n active call(s) after ${MAX_WAIT}s — NOT ${ACTION}ing (re-run later or raise --max-wait)" >&2
    exit 3
  fi
  echo "$UNIT: $n active call(s), waiting… (${waited}s)"
  sleep 5; waited=$((waited + 5))
done
case "$ACTION" in stop) past=stopped ;; *) past=${ACTION}ed ;; esac
systemctl --user "$ACTION" "$UNIT" && echo "$UNIT $past"
