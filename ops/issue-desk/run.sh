#!/usr/bin/env bash
# ConstructHUB issue desk — the tower side (docs/ops/ISSUE-DESK.md).
#
# Every 15 minutes (constructhub-issue-desk.timer), one run:
#   1. claim up to 10 new issues from the app (GET /api/ops-internal/issues?status=new);
#      none → exit 0 (no Claude run, no cost). The app hands them over in working order:
#      a user's blocker report, then every other user report (source "user", written on
#      /report-issue), then the failures the app captured itself;
#   2. refresh the scratch worktree ~/ConstructHUB-issue-desk to the local `main`;
#   3. run Claude headless in that worktree with prompt.md + the issues (stdin):
#      read-only production access through tools/, edits only inside the worktree,
#      a fix only on a branch issue/<id> — never a push, deploy or restart;
#   4. POST each issue's report back (POST /api/ops-internal/issues/:id/report; a user
#      report's also carries publicReply, the answer its reporter reads);
#      an issue Claude did not report on is marked inspected with a note saying so —
#      except a user report: that one is released (…/issues/:id/release), stays "new"
#      ("Received" to its reporter) and is first in the next run;
#   5. POST /api/ops-internal/runs/<run>/complete → the app emails the admins a
#      digest through its outbox and rings the bell.
#
# Config: ops/issue-desk/.env (mode 600, gitignored; see env.example). Read, never
# sourced, and never exported: Claude's environment does not hold the secret.
#
#   ISSUE_DESK_DRY_RUN=1            peek (claim=0), print the issues and the claude command; change nothing
#   ISSUE_DESK_ENV_FILE=<path>      another env file (testing against a local server)
#   ISSUE_DESK_CLAUDE_OUTPUT=<file> use this file as Claude's JSON output instead of running Claude (testing)
set -euo pipefail
umask 077

DESK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$DESK_DIR/tools"
REPO="$(git -C "$DESK_DIR" rev-parse --show-toplevel)"
ENV_FILE="${ISSUE_DESK_ENV_FILE:-$DESK_DIR/.env}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/constructhub-issue-desk"
DRY_RUN="${ISSUE_DESK_DRY_RUN:-0}"
FAKE_OUTPUT="${ISSUE_DESK_CLAUDE_OUTPUT:-}"

log() { printf '[issue-desk] %s\n' "$*" >&2; }
die() { log "$*"; exit 1; }

# ── one run at a time ──────────────────────────────────────────────────────────
LOCK="${XDG_RUNTIME_DIR:-/tmp}/constructhub-issue-desk.lock"
exec 9>"$LOCK"
flock -n 9 || { log "another run holds $LOCK — skipping this one"; exit 0; }

# ── config ─────────────────────────────────────────────────────────────────────
[ -f "$ENV_FILE" ] || die "no $ENV_FILE — copy env.example there (mode 600); see docs/ops/ISSUE-DESK.md"
[ "$(stat -c %a "$ENV_FILE")" = 600 ] || die "$ENV_FILE must be mode 600 (chmod 600 $ENV_FILE)"
ISSUE_DESK_SECRET=""; ISSUE_DESK_APP_URL="http://100.76.165.33:8110"; ISSUE_DESK_MAX_BUDGET_USD="10"
ISSUE_DESK_MODEL=""; ISSUE_DESK_TEST_DATABASE_URL=""; ISSUE_DESK_WORKTREE="$HOME/ConstructHUB-issue-desk"
ISSUE_DESK_TIMEOUT_MIN="60"; ISSUE_DESK_CLAUDE_CONFIG_DIR="$HOME/.claude-accountB"; ISSUE_DESK_MAX_RUNS_PER_DAY="6"
ISSUE_DESK_USER_REPORT_EXTRA_RUNS="4"
while IFS= read -r line; do
  [[ "$line" =~ ^(ISSUE_DESK_[A-Z_]+)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  case "$key" in
    ISSUE_DESK_SECRET|ISSUE_DESK_APP_URL|ISSUE_DESK_MAX_BUDGET_USD|ISSUE_DESK_MODEL|ISSUE_DESK_TEST_DATABASE_URL|ISSUE_DESK_WORKTREE|ISSUE_DESK_TIMEOUT_MIN|ISSUE_DESK_CLAUDE_CONFIG_DIR|ISSUE_DESK_MAX_RUNS_PER_DAY|ISSUE_DESK_USER_REPORT_EXTRA_RUNS)
      printf -v "$key" '%s' "$val" ;;
  esac
done < "$ENV_FILE"
[ "${#ISSUE_DESK_SECRET}" -ge 24 ] || die "ISSUE_DESK_SECRET is missing or shorter than 24 characters in $ENV_FILE"
APP_URL="${ISSUE_DESK_APP_URL%/}"
[[ "$ISSUE_DESK_MAX_BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "ISSUE_DESK_MAX_BUDGET_USD must be a number"
[[ "$ISSUE_DESK_TIMEOUT_MIN" =~ ^[0-9]+$ ]] || die "ISSUE_DESK_TIMEOUT_MIN must be whole minutes"
[[ "$ISSUE_DESK_MAX_RUNS_PER_DAY" =~ ^[0-9]+$ ]] || die "ISSUE_DESK_MAX_RUNS_PER_DAY must be a whole number"
[[ "$ISSUE_DESK_USER_REPORT_EXTRA_RUNS" =~ ^[0-9]+$ ]] || die "ISSUE_DESK_USER_REPORT_EXTRA_RUNS must be a whole number"
WT="$ISSUE_DESK_WORKTREE"

mkdir -p "$STATE_DIR"
# Daily cap on Claude runs: they draw on the same Claude account as everything else on the tower. Over the cap,
# new issues stay "new" (unclaimed) and the first run tomorrow takes them.
find "$STATE_DIR" -maxdepth 1 -name 'runs-*' -mtime +7 -delete 2>/dev/null || true
DAY_FILE="$STATE_DIR/runs-$(date +%F)"
RUNS_TODAY="$(cat "$DAY_FILE" 2>/dev/null || echo 0)"
[[ "$RUNS_TODAY" =~ ^[0-9]+$ ]] || RUNS_TODAY=0
OVER_CAP=0
if [ "$DRY_RUN" != 1 ] && [ -z "$FAKE_OUTPUT" ] && [ "$RUNS_TODAY" -ge "$ISSUE_DESK_MAX_RUNS_PER_DAY" ]; then OVER_CAP=1; fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# The bearer travels in a header file (curl -H @file), never on a command line.
printf 'Authorization: Bearer %s\n' "$ISSUE_DESK_SECRET" > "$WORK/auth"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"

# api METHOD PATH [BODY_FILE] → body in $WORK/resp, HTTP status on stdout
api() {
  local args=(-sS --max-time 30 -o "$WORK/resp" -w '%{http_code}' -X "$1" -H "@$WORK/auth")
  [ -n "${3:-}" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$3")
  curl "${args[@]}" "$APP_URL$2" || true   # a connection failure prints 000
}

# ── the daily cap never silently skips a person's report ────────────────────────
# Over the cap, captured failures wait for tomorrow. User reports do not: up to
# ISSUE_DESK_USER_REPORT_EXTRA_RUNS more runs a day take user reports only. Past
# those too, every waiting user report is marked "deferred" on its timeline (it
# stays "new", first in the next run) — skipped, but never unmarked.
SOURCE_Q=""
if [ "$OVER_CAP" = 1 ]; then
  code="$(api GET "/api/ops-internal/issues?status=new&source=user&limit=10&claim=0")"
  [ "$code" = 200 ] || die "daily cap reached ($RUNS_TODAY of $ISSUE_DESK_MAX_RUNS_PER_DAY) and checking for user reports failed: HTTP $code"
  waiting="$(jq '.issues | length' "$WORK/resp")"
  if [ "$waiting" = 0 ]; then
    log "daily cap reached ($RUNS_TODAY of $ISSUE_DESK_MAX_RUNS_PER_DAY Claude runs today): new issues wait for tomorrow (no user report is waiting)"
    exit 0
  fi
  if [ "$RUNS_TODAY" -ge $((ISSUE_DESK_MAX_RUNS_PER_DAY + ISSUE_DESK_USER_REPORT_EXTRA_RUNS)) ]; then
    jq -n --arg why "daily run cap ($RUNS_TODAY runs today)" '{why: $why}' > "$WORK/defer.json"
    code="$(api POST "/api/ops-internal/user-reports/defer" "$WORK/defer.json")"
    log "daily cap and the $ISSUE_DESK_USER_REPORT_EXTRA_RUNS extra user-report runs are used up: $waiting user report(s) wait, first in tomorrow's first run (marked deferred: HTTP $code $(jq -c '.deferred // empty' "$WORK/resp" 2>/dev/null))"
    exit 0
  fi
  log "daily cap reached, but $waiting user report(s) wait: this run takes user reports only"
  SOURCE_Q="&source=user"
fi

# ── 1. claim ───────────────────────────────────────────────────────────────────
claim=1; [ "$DRY_RUN" = 1 ] && claim=0
code="$(api GET "/api/ops-internal/issues?status=new&limit=10&claim=$claim$SOURCE_Q")"
[ "$code" = 200 ] || die "claiming issues failed: HTTP $code $(head -c 300 "$WORK/resp" 2>/dev/null)"
cp "$WORK/resp" "$WORK/issues.json"
count="$(jq '.issues | length' "$WORK/issues.json")"
if [ "$count" = 0 ]; then
  log "no new issues — nothing to do"
  exit 0
fi
ids="$(jq -c '[.issues[].id]' "$WORK/issues.json")"
log "run $RUN_ID: $count issue(s) $( [ "$claim" = 1 ] && echo claimed || echo 'waiting (dry run: not claimed)') — $ids"

# ── the Claude command ─────────────────────────────────────────────────────────
SCHEMA='{"type":"object","additionalProperties":false,"required":["reports"],"properties":{"reports":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["id","status","report"],"properties":{"id":{"type":"integer"},"status":{"type":"string","enum":["inspected","fix_ready","ignored"]},"report":{"type":"string"},"branch":{"type":"string"},"publicReply":{"type":"string"}}}}}}'
ALLOWED=(
  Read Grep Glob Edit Write TodoWrite
  "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git grep:*)" "Bash(git rev-parse:*)"
  "Bash(git switch:*)" "Bash(git checkout:*)" "Bash(git add:*)" "Bash(git commit:*)"
  "Bash(npm run check)" "Bash(npx vitest run:*)" "Bash(npx tsc --noEmit:*)"
  "Bash($TOOLS/app-journal.sh:*)" "Bash($TOOLS/engine-journal.sh:*)" "Bash($TOOLS/live-sql.sh:*)"
)
DENIED=(
  "Bash(git push:*)" "Bash(git remote:*)" "Bash(git config:*)" "Bash(git worktree:*)" "Bash(git branch:*)"
  "Bash(git switch -C:*)" "Bash(git checkout -B:*)" "Bash(git reset:*)" "Bash(git clean:*)"
  "Bash(ssh:*)" "Bash(scp:*)" "Bash(rsync:*)" "Bash(sudo:*)" "Bash(systemctl:*)" "Bash(curl:*)" "Bash(wget:*)"
  "Bash(npm install:*)" "Bash(npm ci:*)" "Bash(npm publish:*)" "Bash(npx tsx:*)" "Bash(node:*)"
  WebFetch WebSearch
)
CLAUDE=(claude -p "@PROMPT@"
  --output-format json --json-schema "$SCHEMA"
  --max-turns 60 --max-budget-usd "$ISSUE_DESK_MAX_BUDGET_USD"
  --permission-mode acceptEdits --permission-prompts none
  --allowedTools "${ALLOWED[@]}" --disallowedTools "${DENIED[@]}"
  --setting-sources project --settings '{"disableAllHooks":true}' --strict-mcp-config
  --name "issue-desk $RUN_ID")
[ -n "$ISSUE_DESK_MODEL" ] && CLAUDE+=(--model "$ISSUE_DESK_MODEL")

if [ -n "$ISSUE_DESK_TEST_DATABASE_URL" ]; then
  test_note="DATABASE_URL points at a development database, so DB-backed vitest files (server/**/*.test.ts) run with \`npx vitest run <files>\`."
else
  test_note="No development database is configured for this run: run only the test files that need no DATABASE_URL, and say which DB-backed tests could not run."
fi
prompt="$(cat "$DESK_DIR/prompt.md")"
prompt="${prompt//@@RUN_ID@@/"$RUN_ID"}"
prompt="${prompt//@@WORKTREE@@/"$WT"}"
prompt="${prompt//@@TOOLS@@/"$TOOLS"}"
prompt="${prompt//@@TEST_DB_NOTE@@/"$test_note"}"
CLAUDE[2]="$prompt"
# In the order the app returned them: user blockers, other user reports, then captured failures.
{ echo "ISSUES JSON (claimed for run $RUN_ID, one issue per line, in working order: user reports first):"; echo '<<<ISSUES_DATA_BEGIN>>>'
  # Data only (prompt.md): a marker line typed into a report cannot close the block early.
  jq -c '.issues[]' "$WORK/issues.json" | sed -e 's/<<<ISSUES_DATA_\(BEGIN\|END\)>>>/[marker removed]/g'
  echo '<<<ISSUES_DATA_END>>>'; } > "$WORK/stdin.txt"

if [ "$DRY_RUN" = 1 ]; then
  echo "== issues (dry run: peeked, not claimed) =="
  jq '.issues | map({id, source, severity, status, count, title, lastSeen})' "$WORK/issues.json"
  echo "== of those, user reports (worked first; never filed as 'not inspected') =="
  jq -c '[.issues[] | select(.source == "user") | .id]' "$WORK/issues.json"
  echo "== would refresh the worktree =="
  echo "$WT  ← local main ($(git -C "$REPO" rev-parse --short main))"
  echo "== would run, in $WT, with the issues on stdin ($(wc -c < "$WORK/stdin.txt") bytes) =="
  printf 'CLAUDE_CONFIG_DIR=%q timeout %sm' "$ISSUE_DESK_CLAUDE_CONFIG_DIR" "$ISSUE_DESK_TIMEOUT_MIN"
  printf ' %q' "${CLAUDE[0]}" "${CLAUDE[1]}"; printf ' "<%s with its @@placeholders@@ filled>"' "$DESK_DIR/prompt.md"
  printf ' %q' "${CLAUDE[@]:3}"; printf ' < issues-on-stdin\n'
  echo "== then POST each report to $APP_URL/api/ops-internal/issues/<id>/report and $APP_URL/api/ops-internal/runs/$RUN_ID/complete =="
  exit 0
fi

[ -z "$FAKE_OUTPUT" ] && echo $((RUNS_TODAY + 1)) > "$DAY_FILE"

# ── 2. refresh the worktree to the local main ──────────────────────────────────
git -C "$REPO" worktree prune
if ! git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [ -e "$WT" ] && die "$WT exists but is not a git worktree — not touching it"
  git -C "$REPO" worktree add --detach "$WT" main >/dev/null
fi
common_dir() { (cd "$1" && realpath "$(git rev-parse --git-common-dir)"); }
[ "$(common_dir "$WT")" = "$(common_dir "$REPO")" ] || die "$WT is a worktree of another repository — not touching it"
git -C "$WT" checkout --detach --force main -q
git -C "$WT" reset --hard -q main
git -C "$WT" clean -fdq
[ -e "$WT/node_modules" ] || ln -s "$REPO/node_modules" "$WT/node_modules"
mkdir -p "$WT/tmp"

# ── 3. Claude ──────────────────────────────────────────────────────────────────
out="$STATE_DIR/$RUN_ID.json"
cp "$WORK/issues.json" "$STATE_DIR/$RUN_ID.issues.json"
rc=0
if [ -n "$FAKE_OUTPUT" ]; then
  log "using $FAKE_OUTPUT as Claude's output (ISSUE_DESK_CLAUDE_OUTPUT)"
  cp "$FAKE_OUTPUT" "$out"
else
  envs=(CLAUDE_CONFIG_DIR="$ISSUE_DESK_CLAUDE_CONFIG_DIR")
  if [ -n "$ISSUE_DESK_TEST_DATABASE_URL" ]; then
    envs+=(DATABASE_URL="$ISSUE_DESK_TEST_DATABASE_URL" CRM_TEST_DATABASE_URL="$ISSUE_DESK_TEST_DATABASE_URL"
      PGOPTIONS="-c TimeZone=UTC" DEV_AUTH_BYPASS_USER1=true NODE_ENV=development STRIPE_SECRET_KEY= EMAIL_FORCE_SINK=1)
  fi
  log "running Claude in $WT (max 60 turns, \$$ISSUE_DESK_MAX_BUDGET_USD budget, ${ISSUE_DESK_TIMEOUT_MIN}m timeout)"
  (cd "$WT" && env -u ISSUE_DESK_SECRET "${envs[@]}" timeout --kill-after=60 "${ISSUE_DESK_TIMEOUT_MIN}m" "${CLAUDE[@]}" < "$WORK/stdin.txt" > "$out" 2> "$STATE_DIR/$RUN_ID.stderr") || rc=$?
  log "Claude exited $rc ($(jq -r '"\(.subtype // "?") · \(.num_turns // "?") turns · $\(.total_cost_usd // "?") · session \(.session_id // "?")"' "$out" 2>/dev/null || echo 'no JSON output'))"
fi

# Reports: the structured output, else the final text as JSON, else JSON lines in it.
jq -c '(.structured_output.reports // ((.result // "") | (try fromjson catch null) | .reports?) // []) | .[]?' "$out" > "$WORK/reports.jsonl" 2>/dev/null || true
if [ ! -s "$WORK/reports.jsonl" ]; then
  jq -r '.result // empty' "$out" 2>/dev/null | grep -E '^\s*\{.*"id".*\}\s*$' | jq -c 'select(.id and .status and .report)' > "$WORK/reports.jsonl" 2>/dev/null || true
fi
why="$(jq -r '[.subtype, .terminal_reason] | map(select(. != null)) | unique | join(", ")' "$out" 2>/dev/null || true)"
[ -n "$why" ] || why="exit code $rc"

# ── 4. post the reports ────────────────────────────────────────────────────────
posted=()
for id in $(jq -r '.issues[].id' "$WORK/issues.json"); do
  r="$(jq -c --argjson id "$id" 'select(.id == $id)' "$WORK/reports.jsonl" | head -n 1)"
  src="$(jq -r --argjson id "$id" '.issues[] | select(.id == $id) | .source' "$WORK/issues.json")"
  if [ -z "$r" ] && [ "$src" = user ]; then
    # A person's report the run never reached is not closed with a note: back to "new", first in the next run.
    jq -n --arg why "run ended first ($why)" '{why: ($why | .[0:80])}' > "$WORK/body.json"
    code="$(api POST "/api/ops-internal/issues/$id/release" "$WORK/body.json")"
    if [ "$code" = 200 ]; then log "user report #$id not reached → released (stays new, first next run)"; continue; fi
    log "user report #$id: release refused (HTTP $code $(head -c 120 "$WORK/resp")) — filing it for an admin instead"
  fi
  if [ -z "$r" ]; then
    jq -n --arg why "$why" '{status: "inspected", report: ("Not inspected: the issue-desk run ended before Claude reported on this issue (" + $why + "). Use Re-inspect on /admin/issues to try again.")}' > "$WORK/body.json"
  else
    status="$(jq -r '.status' <<<"$r")"; branch="$(jq -r '.branch // empty' <<<"$r")"
    note=""
    if [ "$status" = fix_ready ] && { [ -z "$branch" ] || ! git -C "$REPO" rev-parse -q --verify "refs/heads/$branch" >/dev/null; }; then
      note=" (Claude called this fix_ready, but branch '${branch:-none}' does not exist, so it is filed as inspected.)"
      status=inspected; branch=""
    fi
    [ "$status" = fix_ready ] || branch=""
    # publicReply (the answer the reporter reads) travels only with a user report.
    jq -n --arg s "$status" --arg b "$branch" --arg note "$note" --arg src "$src" --argjson r "$r" \
      '{status: $s, report: (($r.report // "") + $note)} + (if $b == "" then {} else {branch: $b} end)
       + (if $src == "user" and (($r.publicReply // "") | length) > 0 then {publicReply: ($r.publicReply | .[0:4000])} else {} end)' > "$WORK/body.json"
  fi
  code="$(api POST "/api/ops-internal/issues/$id/report" "$WORK/body.json")"
  if [ "$code" = 200 ]; then posted+=("$id"); log "issue #$id → $(jq -r .status "$WORK/body.json")"
  else log "issue #$id: report not stored (HTTP $code $(head -c 200 "$WORK/resp"))"; fi
done

# ── 5. digest ──────────────────────────────────────────────────────────────────
if [ "${#posted[@]}" -gt 0 ]; then
  printf '%s\n' "${posted[@]}" | jq -s '{ids: map(tonumber)}' > "$WORK/done.json"
  code="$(api POST "/api/ops-internal/runs/$RUN_ID/complete" "$WORK/done.json")"
  if [ "$code" = 200 ]; then log "digest: $(jq -r '"\(.title) — emailed \(.emailed), bell \(.notified)"' "$WORK/resp")"
  else log "digest failed: HTTP $code $(head -c 200 "$WORK/resp")"; fi
fi

# Keep the last 60 runs' logs.
ls -1t "$STATE_DIR"/*.json 2>/dev/null | grep -v '\.issues\.json$' | tail -n +61 | while read -r f; do rm -f "$f" "${f%.json}.issues.json" "${f%.json}.stderr"; done
log "run $RUN_ID done: ${#posted[@]}/$count report(s) stored"
