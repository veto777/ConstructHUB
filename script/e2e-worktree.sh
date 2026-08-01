#!/usr/bin/env bash
# Spin up (or tear down) an isolated swarm-agent lane:
#   - its own git worktree  ../ConstructHUB-<lane>   (branch lane/<lane>)
#   - its own database      constructhub_dev_<lane>  (clone of constructhub_dev)
#   - its own dev-server port  8119 + N*10           (a1 → 8129, a2 → 8139, …)
#
#   script/e2e-worktree.sh a1              create lane a1
#   script/e2e-worktree.sh a1 --teardown   drop DB + remove worktree
#
# Idempotent: re-running create on an existing lane reuses the worktree and
# the existing lane/<lane> branch, and keeps an already-cloned DB (use
# `npm run e2e:lane -- recreate <db>` to reset it). --teardown never deletes
# the lane branch, so committed work survives teardown.
#
# node_modules and .env are SYMLINKED from this checkout (same lockfile —
# saves ~525 MB and an npm ci per lane; if a lane ever needs different deps,
# replace the symlink with a real npm ci).
#
# Disk: each lane costs a source checkout (~520 MB) + a 34 MB database. With
# ~61 GB free the default cap is 4 lanes (a1–a4). Check df before raising it.
set -euo pipefail

lane="${1:?usage: e2e-worktree.sh <aN> [--teardown]}"
[[ "$lane" =~ ^a[0-9]+$ ]] || { echo "lane must look like a1, a2, a3, …" >&2; exit 1; }

n="${lane#a}"
(( n >= 1 && n <= 4 )) || { echo "lane number must be 1–4 (disk budget: ~520 MB source + 34 MB DB per lane)" >&2; exit 1; }

port=$((8119 + n * 10))
db="constructhub_dev_${lane}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wt="$(dirname "$root")/ConstructHUB-${lane}"
branch="lane/${lane}"

if [[ "${2:-}" == "--teardown" ]]; then
  npx tsx "$root/script/e2e-lane.ts" drop "$db" || true
  git -C "$root" worktree remove --force "$wt" || true
  echo "lane $lane torn down (branch $branch kept)"
  exit 0
fi

if git -C "$root" worktree list --porcelain | grep -qx "worktree $wt"; then
  echo "worktree $wt already exists — reusing it"
elif git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$root" worktree add "$wt" "$branch"
else
  git -C "$root" worktree add -b "$branch" "$wt"
fi
ln -sfn "$root/node_modules" "$wt/node_modules"
ln -sfn "$root/.env" "$wt/.env"
if sudo -n -u postgres psql -lqt | cut -d'|' -f1 | grep -qw "$db"; then
  echo "database $db already exists — keeping it (npm run e2e:lane -- recreate $db to reset)"
else
  npx tsx "$root/script/e2e-lane.ts" create "$db"
fi

cat <<EOF

lane $lane ready —
  cd "$wt"
  E2E_PORT=$port E2E_DB=$db npm run test:e2e   # boots its own dev server on :$port
EOF
