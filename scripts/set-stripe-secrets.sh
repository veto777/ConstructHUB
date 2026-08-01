#!/usr/bin/env bash
# Set ConstructHUB's Stripe secrets on vb7 without them touching a chat log,
# a shell history file, or this machine's disk.
#
#   ./scripts/set-stripe-secrets.sh            # production  (~/ConstructHUB)
#   ./scripts/set-stripe-secrets.sh demo       # demo        (~/ConstructHUB-demo)
#
# Values are read with `read -s` (never echoed), piped over SSH, and written
# with a temp file + mv so a half-written .env can never be loaded. Existing
# keys are replaced in place; anything you leave blank is left untouched.
set -euo pipefail

TARGET="${1:-prod}"
case "$TARGET" in
  prod) REMOTE_DIR="~/ConstructHUB";      SERVICE="constructhub" ;;
  demo) REMOTE_DIR="~/ConstructHUB-demo"; SERVICE="constructhub-demo" ;;
  *) echo "usage: $0 [prod|demo]" >&2; exit 1 ;;
esac

VB7="voiceban@50.125.203.201"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -p 2252)
export SSH_ASKPASS="$HOME/.ssh/.vb_askpass" SSH_ASKPASS_REQUIRE=force

echo "Target: $TARGET  ($REMOTE_DIR on vb7, service $SERVICE)"
echo "Press Enter to skip any value you don't want to change."
echo

ask() {  # ask VAR_NAME "hint"
  local var="$1" hint="$2" val
  read -r -s -p "  $var ${hint}: " val
  echo
  printf '%s' "$val"
}

SK=$(ask STRIPE_SECRET_KEY "(sk_live_… or sk_test_…)")
CID=$(ask STRIPE_CONNECT_CLIENT_ID "(ca_…)")
CWH=$(ask STRIPE_CONNECT_WEBHOOK_SECRET "(whsec_… — the CONNECTED-accounts endpoint)")
WH=$(ask STRIPE_WEBHOOK_SECRET "(whsec_… — your own account's endpoint)")

# Refuse obviously wrong shapes early rather than after a restart.
[[ -n "$SK"  && ! "$SK"  =~ ^sk_(live|test)_ ]] && { echo "STRIPE_SECRET_KEY should start sk_live_ or sk_test_"; exit 1; }
[[ -n "$CID" && ! "$CID" =~ ^ca_            ]] && { echo "STRIPE_CONNECT_CLIENT_ID should start ca_"; exit 1; }
[[ -n "$CWH" && ! "$CWH" =~ ^whsec_         ]] && { echo "STRIPE_CONNECT_WEBHOOK_SECRET should start whsec_"; exit 1; }
[[ -n "$WH"  && ! "$WH"  =~ ^whsec_         ]] && { echo "STRIPE_WEBHOOK_SECRET should start whsec_"; exit 1; }

# Build the remote script on stdin so no secret ever appears in an argv the
# process list could expose.
{
  printf 'set -euo pipefail\ncd %s\nENV=.env\ncp -a "$ENV" ".env.bak.$(date +%%s)"\nTMP=$(mktemp)\ncp -a "$ENV" "$TMP"\n' "$REMOTE_DIR"
  for pair in "STRIPE_SECRET_KEY=$SK" "STRIPE_CONNECT_CLIENT_ID=$CID" \
              "STRIPE_CONNECT_WEBHOOK_SECRET=$CWH" "STRIPE_WEBHOOK_SECRET=$WH"; do
    k="${pair%%=*}"; v="${pair#*=}"
    [ -z "$v" ] && continue
    printf 'grep -v "^%s=" "$TMP" > "$TMP.n" && mv "$TMP.n" "$TMP"\nprintf "%%s\\n" %s >> "$TMP"\n' \
      "$k" "$(printf '%q' "$k=$v")"
  done
  printf 'chmod 600 "$TMP"\nmv "$TMP" "$ENV"\necho "  written:"; grep -oE "^STRIPE[A-Z_]*" "$ENV" | sed "s/^/    /"\n'
  printf 'systemctl --user restart %s\nsleep 8\necho "  service: $(systemctl --user is-active %s)"\n' "$SERVICE" "$SERVICE"
} | ssh "${SSH_OPTS[@]}" "$VB7" 'bash -s'

echo
echo "Done. Verify with:"
echo "  curl -s https://portal.constructionhub.app/api/crm/payments/status | python3 -m json.tool | head -20"
