#!/usr/bin/env bash
# Is the ConstructHUB Call Assistant engine up? Checks the local port, the tailnet port and, when an
# app URL is given, the app's /voice/* proxy (the path SignalWire uses).
#
#   bash voice/deploy/healthcheck.sh [APP_URL]      e.g. https://constructhub.us or http://127.0.0.1:8201
#
# Exit 0 when every checked endpoint answers {ok:true}; 1 otherwise. Never prints secrets (the engine's
# /health already reports only whether they are set).
set -u
PORT="${VOICE_PORT:-8152}"
TAILNET="${VOICE_TAILNET_IP:-100.90.145.13}"
APP_URL="${1:-}"
rc=0
check() {
  local label=$1 url=$2 body
  body=$(curl -s -m 5 "$url") || body=""
  if printf '%s' "$body" | python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if j.get("ok") else 1)' 2>/dev/null; then
    printf '%-10s OK   %s  %s\n' "$label" "$url" "$(printf '%s' "$body" | python3 -c 'import json,sys; j=json.load(sys.stdin); print("models=%s activeCalls=%s%s" % (j.get("models"), j.get("activeCalls", j.get("active_calls")), " (skeleton)" if j.get("skeleton") else ""))')"
  else
    printf '%-10s DOWN %s  %s\n' "$label" "$url" "${body:0:120}"; rc=1
  fi
}
check local "http://127.0.0.1:$PORT/health"
check tailnet "http://$TAILNET:$PORT/health"
[ -n "$APP_URL" ] && check proxy "${APP_URL%/}/voice/health"
systemctl --user is-active --quiet constructhub-voice && echo "unit       active" || { echo "unit       NOT active (systemctl --user status constructhub-voice)"; }
exit $rc
