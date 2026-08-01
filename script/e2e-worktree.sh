#!/usr/bin/env bash
# Spin up (or tear down) an isolated swarm-agent lane:
#   - its own git worktree  ../ConstructHUB-<lane>   (branch lane/<lane>)
#   - its own database      constructhub_dev_<lane>  (clone of constructhub_dev)
#   - its own dev-server port  8130+N
#
#   script/e2e-worktree.sh a1              create lane a1
#   script/e2e-worktree.sh a1 --teardown   drop DB + remove worktree
#
# node_modules and .env are SYMLINKED from this checkout (same lockfile —
# saves ~525 MB and an npm ci per lane; if a lane ever needs different deps,
# replace the symlink with a real npm ci). The lane branch is never deleted
# by --teardown, so committed work survives teardown.
#
# Disk: each lane costs a source checkout (~520 MB) + a 34 MB database. Check
# df before spinning up more than a handful of lanes.
set -euo pipefail

lane="${1:?usage: e2e-worktree.sh <aN> [--teardown]}"
[[ "$lane" =~ ^a[0-9]+$ ]] || { echo "lane must look like a1, a2, a3, …" >&2; exit 1; }

n="${lane#a}"
port=$((8130 + n))
db="constructhub_dev_${lane}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wt="$(dirname "$root")/ConstructHUB-${lane}"

if [[ "${2:-}" == "--teardown" ]]; then
  npx tsx "$root/script/e2e-lane.ts" drop "$db" || true
  git -C "$root" worktree remove --force "$wt" || true
  echo "lane $lane torn down (branch lane/$lane kept)"
  exit 0
fi

git -C "$root" worktree add -b "lane/$lane" "$wt"
ln -sfn "$root/node_modules" "$wt/node_modules"
ln -sfn "$root/.env" "$wt/.env"
npx tsx "$root/script/e2e-lane.ts" create "$db"

cat <<EOF

lane $lane ready —
  cd "$wt"
  E2E_PORT=$port E2E_DB=$db npm run test:e2e   # boots its own dev server on :$port
EOF
