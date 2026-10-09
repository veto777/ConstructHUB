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

echo "== source guard =="
# 2026-10-07: a deploy run from the shared working copy shipped another session's UNCOMMITTED, type-failing
# edits to production for about 90 seconds (that checkout had been switched to a feature branch minutes
# earlier). Production is only ever built from committed code on main that type-checks. Deploy from the
# release checkout, never from a directory someone is editing:
#   cd ~/ConstructHUB-release && git merge --ff-only <tested commit> && script/deploy-vb11.sh
# DEPLOY_ALLOW_UNSAFE=1 skips the branch and clean-tree checks (say why in HANDOFF.md if you use it).
cd "$ROOT"
if [ "${DEPLOY_ALLOW_UNSAFE:-}" != "1" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "main" ] || { echo "ABORT: on branch '$branch', not main: production is built from main only" >&2; exit 1; }
  dirty="$(git status --porcelain --untracked-files=no)"
  [ -z "$dirty" ] || { echo "ABORT: uncommitted changes in $ROOT; commit them or deploy from ~/ConstructHUB-release:" >&2; echo "$dirty" | head -10 >&2; exit 1; }
fi
echo "building $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

echo "== type check =="
npm run check

echo "== build =="
npm run build

echo "== rsync dist/ =="
# Itemized so the restart below can be skipped when nothing on the server changed (2026-10-09 review H5: 49
# restarts in 24 h, each closing the port for 7-19 s; many shipped an identical build).
dist_changes="$("${RSYNC[@]}" -i dist/ "$HOST:$APP_DIR/dist/" | grep -cE '^[<>ch*]' || true)"
# Old hashed bundles stay publicly fetchable by URL unless removed, and they can
# carry content later taken out of the client (e.g. paid guide text). Keep only
# the current build's assets.
asset_changes="$("${RSYNC[@]}" -i --delete dist/public/assets/ "$HOST:$APP_DIR/dist/public/assets/" | grep -cE '^[<>ch*]' || true)"
echo "dist/: $dist_changes file(s) changed, assets: $asset_changes"

echo "== dependency check =="
# ~/ConstructHUB-demo/node_modules is a symlink to this tree's node_modules,
# so an npm ci here also changes what the demo service loads on its next restart.
deps_changed=0
if "${RSYNC[@]}" --dry-run --out-format='%n' package.json package-lock.json \
    "$HOST:$APP_DIR/" | grep -q .; then
  echo "dependencies changed — syncing manifests and running npm ci on $HOST"
  "${RSYNC[@]}" package.json package-lock.json "$HOST:$APP_DIR/"
  "${SSH[@]}" "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"
  deps_changed=1
else
  echo "dependencies unchanged — node_modules on $HOST already matches"
fi
# Live permit search launches Chromium through playwright-core; each version
# expects its own browser build. Idempotent: a no-op when the build is present.
"${SSH[@]}" "cd $APP_DIR && npx --no-install playwright-core install chromium-headless-shell >/dev/null" \
  || { echo "ABORT: could not install the headless browser playwright-core needs" >&2; exit 1; }

echo "== restart =="
# Nothing new on the server -> no restart (DEPLOY_FORCE_RESTART=1 restarts anyway). Every restart closes the port
# for the boot's length, and the app drains in-flight requests first (server/shutdown.ts: up to SHUTDOWN_DRAIN_MS,
# 20 s; the unit's TimeoutStopSec must stay above that — see HANDOFF.md "Graceful shutdown").
if [ "$dist_changes" = 0 ] && [ "$asset_changes" = 0 ] && [ "$deps_changed" = 0 ] && [ "${DEPLOY_FORCE_RESTART:-}" != "1" ]; then
  echo "nothing changed on $HOST — the running process already serves this build; no restart (DEPLOY_FORCE_RESTART=1 to restart anyway)"
  echo "deploy OK (no-op)"
  exit 0
fi
restart_began=$(date +%s)
"${SSH[@]}" "systemctl --user restart constructhub.service"

echo "== verify =="
# A boot that loses a module logs "Failed to initialize CRM module" but keeps
# serving static pages — catch it here.
# Boot seeding (13k portals + 8k routes) takes ~1-2 min on vb11 before the port opens; poll instead of a fixed sleep.
"${SSH[@]}" "for i in \$(seq 1 240); do curl -s -o /dev/null http://127.0.0.1:8110/ && exit 0; sleep 1; done; echo 'DEPLOY BROKEN: :8110 not listening after 240s' >&2; exit 1"
echo "port closed for about $(( $(date +%s) - restart_began ))s (drain + stop + boot)"
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
