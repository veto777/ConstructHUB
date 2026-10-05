#!/usr/bin/env bash
# Runs only in GitHub Actions. checkout's built-in GITHUB_TOKEN authenticates the push.
set -euo pipefail
: "${GITHUB_ACTIONS:?This script is for GitHub Actions only}"
if [[ "$GITHUB_ACTIONS" != true ]]; then exit 1; fi
: "${GITHUB_SHA:?}" "${RUNNER_TEMP:?}"
report="$RUNNER_TEMP/ios-build-check/${GITHUB_SHA:0:12}.md"
result_tree="$(mktemp -d "$RUNNER_TEMP/ios-results.XXXXXX")"
rmdir "$result_tree"
git worktree add --detach "$result_tree" HEAD
trap 'git worktree remove --force "$result_tree"' EXIT
# A fresh orphan keeps source and build outputs out of the results branch.
git -C "$result_tree" switch --orphan "ios-results-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
for attempt in 1 2 3 4 5; do
  if git ls-remote --exit-code --heads origin ios-results > /dev/null; then
    git fetch origin refs/heads/ios-results:refs/remotes/origin/ios-results
    git -C "$result_tree" reset --hard refs/remotes/origin/ios-results
  fi
  mkdir -p "$result_tree/ios-build-check"
  cp "$report" "$result_tree/ios-build-check/"
  git -C "$result_tree" add ios-build-check
  if ! git -C "$result_tree" diff --cached --quiet; then
    git -C "$result_tree" -c user.name='github-actions[bot]' \
      -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
      commit -m "ci(ios): build result for ${GITHUB_SHA:0:12}" \
      -m 'Co-Authored-By: Codex <noreply@constructhub.us>'
  fi
  if git -C "$result_tree" push origin HEAD:refs/heads/ios-results; then exit 0; fi
  # Another run may have published first. Refetch its commit and reapply only this report.
  sleep "$attempt"
done
echo 'ERROR: Could not publish the iOS build result after five attempts.' >&2
exit 1
