#!/usr/bin/env bash
# Deploy ConstructHUB to vb7 (constructhub.us / portal.constructhub.us).
#
#   script/deploy-vb7.sh
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

VB7="voiceban@50.125.203.201 -p 2252"
VB7_NODE="/home/voiceban/.nvm/versions/node/v20.20.2/bin"
APP_DIR="/home/voiceban/ConstructHUB"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export SSH_ASKPASS="$HOME/.ssh/.vb_askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0
SSH=(setsid -w ssh -p 2252 -o StrictHostKeyChecking=accept-new voiceban@50.125.203.201)
RSYNC=(setsid -w rsync -azc -e "ssh -p 2252 -o StrictHostKeyChecking=accept-new")

echo "== build =="
cd "$ROOT"
npm run build

echo "== rsync dist/ =="
"${RSYNC[@]}" dist/ "voiceban@50.125.203.201:$APP_DIR/dist/"

echo "== dependency check =="
# Compare dependency manifests against vb7; sync + npm ci only when they differ.
if "${RSYNC[@]}" --dry-run --out-format='%n' package.json package-lock.json \
    "voiceban@50.125.203.201:$APP_DIR/" | grep -q .; then
  echo "dependencies changed — syncing manifests and running npm ci on vb7"
  "${RSYNC[@]}" package.json package-lock.json "voiceban@50.125.203.201:$APP_DIR/"
  "${SSH[@]}" "export PATH=$VB7_NODE:\$PATH && cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"
else
  echo "dependencies unchanged — node_modules on vb7 already matches"
fi

echo "== restart =="
"${SSH[@]}" "systemctl --user restart constructhub"

echo "== verify =="
# A boot that loses a module logs "Failed to initialize CRM module" but keeps
# serving static pages — catch it here.
sleep 10
"${SSH[@]}" "
  set -e
  systemctl --user is-active constructhub
  if journalctl --user -u constructhub --since '-1min' --no-pager | grep -E 'Failed to initialize|Cannot find module|Fatal startup'; then
    echo 'DEPLOY BROKEN: boot errors above' >&2
    exit 1
  fi
  curl -fsS -o /dev/null -w 'local :8110 -> %{http_code}\n' http://127.0.0.1:8110/
  code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8110/api/crm/me)
  [ \"\$code\" = 401 ] || { echo \"DEPLOY BROKEN: /api/crm/me -> \$code (want 401)\" >&2; exit 1; }
  echo 'local :8110/api/crm/me -> 401 (CRM module up)'
"
echo "deploy OK"
