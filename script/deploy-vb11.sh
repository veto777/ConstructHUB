#!/usr/bin/env bash
# Deploy ConstructHUB to production on vb11 (constructhub.us / portal.constructhub.us).
#
#   script/deploy-vb11.sh
#
# Production moved from vb7 to vb11 on 2026-09-26. LIVE is vb11
# ~/ConstructHUB-live — NOT vb11 ~/ConstructHUB, which is a dev tree. vb7 is
# now a guarded fallback (its units fail on purpose if restarted); failover
# runbook: vb7 ~/ConstructHUB/FAILOVER.md.
#
# Steps: build on the tower → rsync dist/ → sync dependencies if they
# changed → restart the service → VERIFY the boot (a deploy that leaves the
# CRM module dead fails loudly here, not when someone visits the portal).
#
# The dependency check exists because of 2026-08-01: a feature added pdfkit,
# the rsync only shipped dist/, and prod booted with
# "Failed to initialize CRM module: Cannot find module 'pdfkit'" — the
# static site kept serving while every /api/crm/* route was dead. Shipping
# dist/ without node_modules is only safe when dependencies are unchanged.
set -euo pipefail

HOST="vb11"
APP_DIR="/home/voiceban/ConstructHUB-live"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SSH=(ssh -o BatchMode=yes "$HOST")
RSYNC=(rsync -azc -e "ssh -o BatchMode=yes")

echo "== preflight =="
"${SSH[@]}" "test -f $APP_DIR/.env && test -d $APP_DIR/node_modules" \
  || { echo "ABORT: $HOST:$APP_DIR is not the live tree (.env/node_modules missing)" >&2; exit 1; }

echo "== build =="
cd "$ROOT"
npm run build

echo "== rsync dist/ =="
"${RSYNC[@]}" dist/ "$HOST:$APP_DIR/dist/"
# Old hashed bundles stay publicly fetchable by URL unless removed, and they can
# carry content later taken out of the client (e.g. paid guide text). Keep only
# the current build's assets.
"${RSYNC[@]}" --delete dist/public/assets/ "$HOST:$APP_DIR/dist/public/assets/"

echo "== dependency check =="
# ~/ConstructHUB-demo/node_modules is a symlink to this tree's node_modules,
# so an npm ci here also changes what the demo service loads on its next restart.
if "${RSYNC[@]}" --dry-run --out-format='%n' package.json package-lock.json \
    "$HOST:$APP_DIR/" | grep -q .; then
  echo "dependencies changed — syncing manifests and running npm ci on $HOST"
  "${RSYNC[@]}" package.json package-lock.json "$HOST:$APP_DIR/"
  "${SSH[@]}" "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"
else
  echo "dependencies unchanged — node_modules on $HOST already matches"
fi
# Live permit search launches Chromium through playwright-core; each version
# expects its own browser build. Idempotent: a no-op when the build is present.
"${SSH[@]}" "cd $APP_DIR && npx --no-install playwright-core install chromium-headless-shell >/dev/null" \
  || { echo "ABORT: could not install the headless browser playwright-core needs" >&2; exit 1; }

echo "== restart =="
"${SSH[@]}" "systemctl --user restart constructhub.service"

echo "== verify =="
# A boot that loses a module logs "Failed to initialize CRM module" but keeps
# serving static pages — catch it here.
# Boot seeding (13k portals + 8k routes) takes ~1-2 min on vb11 before the port opens; poll instead of a fixed sleep.
"${SSH[@]}" "for i in \$(seq 1 120); do curl -s -o /dev/null http://127.0.0.1:8110/ && exit 0; sleep 2; done; echo 'DEPLOY BROKEN: :8110 not listening after 240s' >&2; exit 1"
"${SSH[@]}" "
  set -e
  systemctl --user is-active constructhub.service
  if journalctl --user -u constructhub.service --since '-2min' --no-pager | grep -E 'Failed to initialize|Cannot find module|Fatal startup'; then
    echo 'DEPLOY BROKEN: boot errors above' >&2
    exit 1
  fi
  curl -fsS -o /dev/null -w 'local :8110 -> %{http_code}\n' http://127.0.0.1:8110/
  code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8110/api/crm/me)
  [ \"\$code\" = 401 ] || { echo \"DEPLOY BROKEN: /api/crm/me -> \$code (want 401)\" >&2; exit 1; }
  echo 'local :8110/api/crm/me -> 401 (CRM module up)'
"
code=$(curl -s -o /dev/null -w '%{http_code}' https://constructhub.us/)
[ "$code" = 200 ] || { echo "DEPLOY BROKEN: https://constructhub.us -> $code (want 200)" >&2; exit 1; }
echo "public https://constructhub.us -> 200"
echo "deploy OK"
