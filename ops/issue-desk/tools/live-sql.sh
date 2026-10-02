#!/usr/bin/env bash
# Issue desk tool (read-only): ONE query against the PRODUCTION database, run on
# vb11 with the live app's own DATABASE_URL (~/ConstructHUB-live/.env, never
# printed), inside a READ ONLY transaction with default_transaction_read_only=on
# and a 15 s statement timeout. Output: CSV, at most 500 rows.
#
#   live-sql.sh "SELECT status, count(*) FROM ops_issues GROUP BY 1"
#
# Refused: anything but SELECT / WITH / EXPLAIN (no ANALYZE) / SHOW / TABLE /
# VALUES, a second statement (;), a backslash (psql meta-commands), and the
# server functions with side effects a read-only transaction does not stop.
set -euo pipefail
HOST="${ISSUE_DESK_APP_SSH_HOST:-vb11}"
APP_DIR="${ISSUE_DESK_APP_DIR:-ConstructHUB-live}"
deny() { echo "live-sql: refused — $1" >&2; exit 2; }
[ $# -eq 1 ] && [ -n "${1// /}" ] || { echo "usage: $(basename "$0") \"SELECT …\"" >&2; exit 2; }
sql="$1"
[ "${#sql}" -le 4000 ] || deny "4000 characters at most"
# Trim whitespace and one trailing semicolon.
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; printf '%s' "${s%"${s##*[![:space:]]}"}"; }
sql="$(trim "$sql")"
sql="$(trim "${sql%;}")"
lower="$(printf '%s' "$sql" | tr '[:upper:]' '[:lower:]' | tr '\n\t' '  ')"
[[ "$lower" =~ ^(select|with|explain|show|table|values)[[:space:]\(] ]] || deny "only SELECT, WITH, EXPLAIN, SHOW, TABLE or VALUES"
[[ "$sql" != *";"* ]] || deny "one statement only (no ;)"
[[ "$sql" != *\\* ]] || deny "no backslashes"
side_effects='explain[[:space:]]*\(|explain[[:space:]]+analy|pg_terminate_backend|pg_cancel_backend|set_config|dblink|lo_import|lo_export|lo_unlink|pg_read_|pg_ls_|pg_stat_file|pg_sleep|pg_advisory|nextval|setval|pg_notify|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_create_|pg_drop_|pg_promote|txid_current|query_to_xml'
[[ ! "$lower" =~ ($side_effects) ]] || deny "that function or option has side effects"

b64="$(printf '%s' "$sql" | base64 -w0)"
exec ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "bash -s" <<REMOTE
set -eu
cd "\$HOME/$APP_DIR"
url="\$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']\$//')"
q="\$(printf '%s' '$b64' | base64 -d)"
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000' \
  psql "\$url" -X -q -v ON_ERROR_STOP=1 -P pager=off --csv -c 'BEGIN READ ONLY' -c "\$q" -c 'ROLLBACK' | head -n 501
rc=\${PIPESTATUS[0]}
if [ "\$rc" = 141 ]; then echo "(output cut at 500 rows)" >&2; rc=0; fi
exit "\$rc"
REMOTE
