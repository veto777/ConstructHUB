#!/usr/bin/env bash
# Issue desk tool (read-only): the PRODUCTION app's journal — vb11, systemd --user
# constructhub.service. Claude may run this; it cannot change anything.
#
#   app-journal.sh [--since "2 hours ago"] [--until "2026-10-02 15:00"] [--grep PATTERN] [--lines N]
#
# Arguments are validated and quoted for the remote shell; nothing else is run there.
set -euo pipefail
HOST="${ISSUE_DESK_APP_SSH_HOST:-vb11}"
UNIT="constructhub.service"
since="2 hours ago"; until=""; pattern=""; lines=300
usage() { echo "usage: $(basename "$0") [--since TIME] [--until TIME] [--grep PATTERN] [--lines N]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --since) since="${2:-}"; shift 2 ;;
    --until) until="${2:-}"; shift 2 ;;
    --grep) pattern="${2:-}"; shift 2 ;;
    --lines|-n) lines="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
time_re='^[A-Za-z0-9 :+._-]{1,40}$'
[[ "$since" =~ $time_re ]] || { echo "--since: letters, digits, spaces and : + . _ - only" >&2; exit 2; }
[[ -z "$until" || "$until" =~ $time_re ]] || { echo "--until: letters, digits, spaces and : + . _ - only" >&2; exit 2; }
[[ "$lines" =~ ^[0-9]{1,4}$ ]] || { echo "--lines: 1-9999" >&2; exit 2; }
[ "${#pattern}" -le 200 ] || { echo "--grep: 200 characters at most" >&2; exit 2; }

remote="journalctl --user -u $UNIT --no-pager -o short-iso -n $lines --since $(printf %q "$since")"
[ -n "$until" ] && remote+=" --until $(printf %q "$until")"
[ -n "$pattern" ] && remote+=" --grep $(printf %q "$pattern")"
exec ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$remote"
