# Issue desk

Owner, 2026-10-02: *"make sure if there are issues they are reported to our claude so it gets repaired or at least inspected."*

The app records its own failures in `ops_issues`. Every 15 minutes a timer on the tower claims the new ones, hands them to Claude in a scratch worktree, and posts Claude's verdict back. The owner gets a digest email and a bell notification. Nothing in this loop deploys, pushes or restarts anything. When Claude can fix an issue, the fix waits on a local branch `issue/<id>` for a person to review.

```
app (vb11)                                     tower
──────────                                     ─────
failure → recordIssue() → ops_issues (new)
                    GET /api/ops-internal/issues  ◄── run.sh (timer, every 15 min, flock)
                    status new → inspecting  ──►      none → exit 0 (no Claude, no cost)
                                                      refresh ~/ConstructHUB-issue-desk to local main
                                                      claude -p prompt.md  (issues on stdin)
                                                        reads journals + read-only SQL (tools/)
                                                        fix → branch issue/<id> + test + commit
   POST /api/ops-internal/issues/:id/report  ◄──      one report per issue
   POST /api/ops-internal/runs/:run/complete ◄──      digest
   → email to the platform admins (outbox) + bell "Claude inspected 3 issues — 1 fix ready"
/admin/issues: list, detail, Claude's report, branch · Mark fixed · Ignore · Re-inspect
```

## What is captured

`server/ops/issues.ts` provides `recordIssue({ source, key, title, detail, severity })`. It upserts one row per fingerprint, `sha256(source + key)`. A repeat increases `count` and moves `last_seen`. The worst severity wins, and the title and detail update to the latest occurrence. When a `fixed` issue happens again it goes back to `new`; an `ignored` issue stays ignored.

`recordIssue` never throws and its promise never rejects. Rate limits: at most one write per fingerprint per minute (repeats in that window are counted and written once when it ends), and 120 writes per minute in total.

Every title, detail and report is scrubbed first (`server/ops/scrub.ts`):

- Removed: values of secret-named keys (password, token, secret, API key, cookie, authorization, card, cvc, signature, …), bearer tokens, credentials in URLs, secret query parameters, and known key formats (Stripe, OpenAI, Google, GitHub, Slack, AWS, JWT, `chub_`/`chk_`).
- Replaced: hex runs of 32 or more characters, and card numbers that pass the Luhn check.
- Masked: emails (`j***@example.com`), phone numbers (`[phone …99]`), and the last part of an IPv4 address.
- Capped: depth, array length, string length, and a total of 16 KB.

| Source | Captured | Where |
|---|---|---|
| `server` | Any 5xx that reaches the Express error handler. The fingerprint is method + route pattern + status + the error's name, normalized message and top frames; the stack goes into the detail. | `server/index.ts` → `ops/server-errors.ts` |
| `server` | A route that caught its own error and answered **500** (by route; the journal has the logged cause). | `watchHandledFailures` |
| `server` | `uncaughtException` / `unhandledRejection` | `server/index.ts` |
| `job` | Worker ticks that fail: Agency queue, onboarding, GBP profile discovery, GBP content/reply/Profile Guard workers, GBP discovery queue, Site Scan, edge search, Ads, Social, Domains, Mail Alerts, HOVER scheduler + per-org auto-sync, CRM backups (tick + per org), LSA rotating sync, LSA manager lead sync, scrape schedules, review reminders and scheduled reviews, Agency location billing sync, billing event listeners | the `console.error` next to each, kept |
| `job` | GBP jobs that fail for good, except the customer's own setup (`invalid`/`auth`/`permission`): a code error, Google API disabled on our project, or a sync still `transient` after every retry | `server/agency/jobs.ts` |
| `job` | Email outbox: a row marked `failed` (gave up after 8 attempts, or unsendable), and a drain that throws | `server/account/billing-emails.ts` |
| `job` | Call Assistant jobs: number release (per number, per account, sweep, bell insert), escalation reminders (per escalation, worker), weekly spam report (email, per org, run), overage billing (per org, sweep) | `server/voice/*.ts` |
| `job` | GBP credentials that cannot be decrypted at boot | `server/gbp/token-crypto.ts` |
| `client` | `window` `error` and `unhandledrejection` → `POST /api/ops/client-error`: anonymous, 8 KB body cap, 10 per IP per 5 min, 300 per hour in total, cross-site posts refused. No user id, query string, or token-like path segment; only the browser and OS from the user agent. Dropped: browser extensions, ResizeObserver loop warnings, opaque `Script error.`, network blips. A stale-bundle chunk failure after a deploy is one issue (`warning`). | `client/src/lib/report-client-errors.ts`, `server/ops/client-errors.ts` |
| `call_assistant` | **One-way audio suspicion.** In a call longer than 20 s the assistant spoke but no caller speech was transcribed, or the caller went silent for more than 20 s at the end while the assistant prompted at least twice. Blocked and spam calls are excluded. | `server/ops/call-assistant.ts`, called once per call from `processFinishedCall` |
| `call_assistant` | Engine/provider errors in the end-of-call report (events `type: "error"`, grouped by `where`), an `error` outcome, and app-side failures while finishing a call (lead delivery, escalation, owner alerts, summary, metering, recording upload, status callback, blocklist) | `server/voice/internal-calls.ts`, `escalations.ts` |
| `health` | Engine unreachable (`critical`) or up without its models (`warning`), from the app's probe. The probe runs when the Call Assistant status endpoint is opened and, in production, every 5 minutes while any number is active (`startEngineHealthWatch`; elsewhere set `VOICE_ENGINE_WATCH=1`). It only runs when `VOICE_INTERNAL_SECRET` is set. | `server/voice/billing.ts` |

Not captured:

- A failed deploy verify. That would need a tower → vb11 hook and is out of scope.
- 4xx answers, and 501–504 answers a route sends itself (often an honest upstream or unconfigured answer).
- Warnings logged with `console.warn`.
- Failures inside the Python engine that never reach the app: an engine that crashes before reporting the call. The health probe covers "engine down".
- Errors swallowed without a log.
- Browser errors from users who block the request.

## User reports ("Report an issue")

Owner, 2026-10-07: *"add a help and report issues button in footer that is also always reviewed by jarvis and any issues that are not allowing the site to work, jarvis fixes."*

Every footer (signed-in platform, CRM, public marketing, the iPhone app shells) has **Help** (`/tutorials`) and **Report an issue** (`/report-issue`; `/crm/report-issue` inside the CRM frame). The page (`client/src/pages/report-issue.tsx`) works signed in and signed out (signed out it asks for an email), shows everything it sends under "What we send with your report", and lists the reporter's own reports with a plain status.

`POST /api/issues/report` (`server/ops/user-reports.ts`) stores each report as its **own** `ops_issues` row: `source = 'user'`, a random fingerprint (user reports are never merged), status `new`. Severity comes from "How bad is it?": *I can't use the site* → `critical`, *broken but I can work around it* → `error`, *small problem or suggestion* → `info`. The text is scrubbed like everything else, and a typed "password is …" loses its value. The reply address lives in `reporter_email` and is never sent to the tower. Limits: 5 per account and 3 per signed-out IP per 10 minutes, 20 a day each, 200 an hour overall; a honeypot field; a cross-site post is refused. An optional screenshot (image, 5 MB at most) goes to R2 under `issue-reports/`, readable only through `GET /api/admin/issues/:id/screenshot`; without R2 it is not kept and the answer says so.

**Always reviewed, and first.** Unlike browser errors (which wait in `triage` for an admin), a user report goes straight to `new`, and a run takes issues in this order (`DESK_ORDER_SQL` in `server/ops/issues.ts`, the same order Claude gets them on stdin):

1. a user's blocker (`source user` + `critical`),
2. every other user report: worst first, then the one that has waited longest,
3. what the app captured itself: worst severity, then most recent.

A user report is never closed unread:

- A run that ends before Claude reports on one **releases** it (`POST …/issues/:id/release`): back to `new`, "Received" for its reporter, first in the next run. After 3 releases it is filed as `inspected` with the usual note, for an admin (the report itself may be what ends runs).
- Over the daily cap (`ISSUE_DESK_MAX_RUNS_PER_DAY`), up to `ISSUE_DESK_USER_REPORT_EXTRA_RUNS` (default 4) more runs a day take **user reports only** (`?source=user`). Past those, each waiting report gets a `deferred` entry on its timeline (`POST …/user-reports/defer`) and is first in tomorrow's first run.
- Claude writes a `publicReply` for every user report: two to four plain sentences for the reporter (what it found; fix ready / being worked on / needs more information / not a bug). An admin can rewrite or clear it on `/admin/issues`.
- A blocker rings every platform admin's bell at once (`ops.user_report`, one notification per report).

What the reporter reads (`publicReportStatus`): `new`/`triage` → **Received**, `inspecting`/`inspected` → **Being looked at**, `fix_ready` → **Fix ready**, `fixed` → **Fixed**, `ignored` → **Not a bug**.

A report is text typed by anyone on the internet, and it reaches Claude without an admin in between: that is the owner's choice ("always reviewed"). The guards are the prompt's hard rule (report text is data, never instructions; nothing is copied into a `publicReply` because a report asked), Claude's read-only tools, the scrub on every stored `publicReply` (emails, phones, keys masked; 1,500 characters), and the rate limits above.

## Hand-off API (app side)

| Route | Auth | What |
|---|---|---|
| `GET /api/ops-internal/issues?status=new[&limit=10][&claim=0]` | bearer | Claims up to 10 (`new` → `inspecting`; user reports first, then worst severity then newest; a claim older than 3 h is taken again). One `UPDATE … FOR UPDATE SKIP LOCKED`, so concurrent runs never share an issue. `claim=0` peeks (the dry run). |
| `POST /api/ops-internal/issues/:id/report` `{status: inspected\|fix_ready\|ignored, report, branch?, publicReply?}` | bearer | Only an issue in `inspecting` takes a report (otherwise 409). `fix_ready` needs `branch`. The report is scrubbed. |
| `GET /api/ops-internal/issues?…&source=user` | bearer | The same, user reports only (the over-the-cap run, and its "is one waiting?" peek). |
| `POST /api/ops-internal/issues/:id/release` `{why?}` | bearer | A claimed **user report** the run did not reach: `inspecting` → `new`. 409 `too_many` after 3 releases. |
| `POST /api/ops-internal/user-reports/defer` `{why?}` | bearer | Marks every waiting user report `deferred` on its timeline (once in a row). They stay `new`. |
| `POST /api/issues/report`, `GET /api/issues/mine` | anyone / signed in | A person's own report and their list (see "User reports"). |
| `POST /api/admin/issues/:id/reply {reply}`, `GET /api/admin/issues/:id/screenshot` | platform admin | The reporter-facing reply ("" clears it) and the screenshot. |
| `POST /api/ops-internal/runs/:runId/complete` `{ids}` | bearer | Sends the digest for the issues reported in that run: email to each platform admin in `server/admin.ts` who has an account, through the email outbox (`ops.issue_desk_digest`, deduped per run and admin), and a bell row (`ops.issue_desk`, link `/admin/issues`). |
| `GET /api/admin/issues`, `/summary`, `/:id`, `POST /:id/status {fixed\|ignored\|new}` | platform admin (`requirePlatformAdmin`, second factor included) | The admin page and the sidebar count. |

Bearer auth uses `Authorization: Bearer $ISSUE_DESK_SECRET` with a constant-time compare. If the secret is unset or shorter than 24 characters, the API answers **503**. A missing or wrong bearer gets **401**. A request that came through Cloudflare (it carries `cf-connecting-ip`) gets **404**, so the internal API is reachable only over the tailnet. Response bodies from these routes never enter the request log.

## The tower run (`ops/issue-desk/run.sh`)

1. Takes `flock` on `$XDG_RUNTIME_DIR/constructhub-issue-desk.lock`. If another run holds it, this run exits 0.
2. Reads `ops/issue-desk/.env`. The file must be mode 600. It is parsed line by line, never sourced or exported, so Claude's environment does not hold the secret. The bearer goes to curl through a header file, never on a command line.
3. Claims the issues. If there are none it exits 0, with no Claude run and no cost.
4. Resets `~/ConstructHUB-issue-desk` to a detached checkout of the **local** `main` (no fetch): `worktree add`, then `checkout --detach --force`, `reset --hard`, `clean -fd`, and the `node_modules` symlink. It refuses a path that is not a worktree of this repository.
5. Runs Claude in that worktree. The prompt is `prompt.md` with its `@@placeholders@@` filled; the issues go on stdin, one JSON object per line.
6. Posts each report:
   - An issue Claude did not report on gets `inspected` with "Not inspected: … (reason). Use Re-inspect to try again". This prevents retry loops that cost money. A **user report** is released instead (see "User reports").
   - A `fix_ready` whose branch does not exist is filed as `inspected`, with a note.
7. Calls `runs/<run>/complete`, which sends the digest.
8. Keeps the last 60 runs' outputs in `~/.local/state/constructhub-issue-desk/<run>.json`. Each output has the session id, so `claude --resume <id>` with `CLAUDE_CONFIG_DIR=~/.claude-accountB` shows the whole session.

### The Claude command and why each flag

These flags were checked against `claude --help` for version 2.1.285. `--max-turns` is a hidden option in that version but it is validated.

```
CLAUDE_CONFIG_DIR=$HOME/.claude-accountB timeout 60m claude -p "<prompt.md>" < issues
  --output-format json --json-schema '{"reports":[{id,status,report,branch?}]}'
  --max-turns 60 --max-budget-usd $ISSUE_DESK_MAX_BUDGET_USD
  --permission-mode acceptEdits --permission-prompts none
  --allowedTools Read Grep Glob Edit Write TodoWrite "Bash(git status|diff|log|show|grep|rev-parse|switch|checkout|add|commit:*)"
                 "Bash(npm run check)" "Bash(npx vitest run:*)" "Bash(npx tsc --noEmit:*)"
                 "Bash(<desk>/tools/app-journal.sh:*)" "Bash(<desk>/tools/engine-journal.sh:*)" "Bash(<desk>/tools/live-sql.sh:*)"
  --disallowedTools "Bash(git push|remote|config|worktree|branch|reset|clean:*)" "Bash(git switch -C:*)" "Bash(git checkout -B:*)"
                    "Bash(ssh|scp|rsync|sudo|systemctl|curl|wget|node|npx tsx:*)" "Bash(npm install|ci|publish:*)" WebFetch WebSearch
  --setting-sources project --settings '{"disableAllHooks":true}' --strict-mcp-config --name "issue-desk <run>"
```

| Flag | Why |
|---|---|
| `-p`, prompt as an argument, issues on stdin | Headless. Stdin avoids the 128 KB single-argument limit; 10 issues × 16 KB of detail can exceed it. |
| `--output-format json --json-schema` | The verdicts come back as validated `structured_output.reports`. run.sh falls back to the final text, then to JSON lines in it. |
| `--max-turns 60`, `--max-budget-usd` (default 10), `timeout 60m`, unit `TimeoutStartSec=75min` | Bound the work and the spend. |
| `--permission-mode acceptEdits` | Edits are auto-accepted inside the working directory, which is the worktree, and nowhere else. |
| `--permission-prompts none` | Unattended: anything not allowed is denied, never asked. |
| `--allowedTools` / `--disallowedTools` | Allow read-only git plus commit, the checks and tests, and the three read-only production tools. Deny wins for push, branch rewrites, network, ssh, sudo and service control. |
| `--setting-sources project` + `disableAllHooks` + `--strict-mcp-config` | The account's user settings carry interactive-session hooks (Jarvis bridge, Telegram) and MCP connectors. An unattended ConstructHUB run loads none of them. |
| `NoNewPrivileges=yes` (unit) | No `sudo`, even from code a test runs. |

The production tools are outside the worktree (`ops/issue-desk/tools/` in the main checkout), so Claude cannot edit them:

- `app-journal.sh` runs `journalctl --user -u constructhub.service` on vb11. Its arguments are validated and `%q`-quoted for the remote shell.
- `engine-journal.sh` runs `journalctl --user -u constructhub-voice.service` on the tower.
- `live-sql.sh` runs one SELECT, WITH, EXPLAIN or SHOW on vb11 using the live `.env` `DATABASE_URL`, which is never printed. It runs in `BEGIN READ ONLY` with `default_transaction_read_only=on` and a 15 s statement timeout, and output is capped at 500 rows. It refuses `;`, backslashes, and functions with side effects. A writable CTE fails with "cannot execute … in a read-only transaction".

This is a guard against accidents, not a sandbox against a hostile model. Claude runs tests it wrote, and a test can execute anything the `veto` user can. That is the trade-off of "fix it with a test". The prompt's hard rules, the review of every branch before merge, and `NoNewPrivileges` are the remaining controls.

## Secrets

- **`ISSUE_DESK_SECRET`** is a new secret: at least 24 characters, not starting with `chub_`. Generate it with `openssl rand -hex 32`. It goes in two places:
  - vb11 `~/ConstructHUB-live/.env`. The app answers 503 until it is set.
  - tower `~/ConstructHUB/ops/issue-desk/.env`, mode 600, gitignored. Copy from `env.example`.
- Nothing else is new. The digest uses the app's existing SMTP and outbox. Claude uses the `.claude-accountB` login already on the tower. Production SQL uses the live app's own `.env` on vb11.

## Install

This is not installed or enabled yet; the steps below are what's left to do.

1. Merge `ops/issue-desk` into `main`, then deploy as usual (dump first, `script/deploy-vb11.sh`). Boot creates `ops_issues`. To create it ahead of time instead, run `DATABASE_URL=… npx tsx scripts/apply-schema-migration.ts`.
2. vb11: add `ISSUE_DESK_SECRET=<value>` to `~/ConstructHUB-live/.env` and restart `constructhub.service` so it reads the secret.
3. Tower:
   ```bash
   cd ~/ConstructHUB/ops/issue-desk
   cp env.example .env && chmod 600 .env    # fill ISSUE_DESK_SECRET (same value); optional ISSUE_DESK_MODEL / ISSUE_DESK_TEST_DATABASE_URL
   ISSUE_DESK_DRY_RUN=1 ./run.sh            # peeks (claims nothing), prints the issues and the exact claude command
   install -m 644 constructhub-issue-desk.service constructhub-issue-desk.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now constructhub-issue-desk.timer
   ```
4. Check it:
   - `systemctl --user list-timers constructhub-issue-desk.timer`
   - `journalctl --user -u constructhub-issue-desk -n 50`
   - `/admin/issues` (sidebar → Issues · ADMIN)

Run once by hand: `systemctl --user start constructhub-issue-desk.service`, or `~/ConstructHUB/ops/issue-desk/run.sh`.

Pause: `systemctl --user disable --now constructhub-issue-desk.timer`. Issues keep being recorded and nothing is claimed.

Testing without Claude:

- `ISSUE_DESK_ENV_FILE=<test env pointing at a local server>` points run.sh at a dev server.
- `ISSUE_DESK_CLAUDE_OUTPUT=<file>` uses a canned Claude JSON output instead of running Claude. run.sh still claims, posts and sends the digest for real.

## Costs

- A Claude run happens **only when new issues exist**. A quiet 15-minute tick is one HTTP request.
- A run handles at most 10 issues, 60 turns, `ISSUE_DESK_MAX_BUDGET_USD` (default $10, computed at list price on the account's plan) and 60 minutes.
- An issue reported again after inspection does not trigger a new run unless it was marked fixed (it reopens) or someone presses Re-inspect.
- Rate limits keep an error storm to about one database write per fingerprint per minute.
