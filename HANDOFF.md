# ConstructHUB — Handoff

_Last updated 2026-08-24. Repo: `veto777/ConstructHUB` (private). Local: `/home/veto/ConstructHUB` on the tower._

## 2026-09-15 — per-user calendars (Braxton's request)
- `crm_appointments.created_by_member_id` (stamped on POST; `schema-ensure` adds the column and best-effort
  backfills from `crm_team_activity` "scheduled <title>" rows ±2 min). Prod after deploy: Alpine Exteriors 33
  visits, 13 backfilled to Braxton; the 20 unmatched (mostly the 2026-07-31 import batch) stay unowned and show
  only under "Everyone's calendar".
- Schedule page filter (next to month/week/agenda): **My calendar** (default, remembered per browser) /
  **Everyone's calendar** / one entry per member. "Mine" = visits I booked OR am dispatched to.
- Visibility for members without `viewAllJobs` now includes visits they booked, not just dispatched ones;
  the booker may also progress their own visit without `manageJobs`.
- Tests: `server/crm/appointments.test.ts` (+2). Deployed to vb7 via `script/deploy-vb7.sh`; vb11 DEV tree synced.

## TL;DR
**LIVE at https://constructhub.us (+www) since 2026-07-10**, self-hosted on vb7 behind ConstructHUB's
own Cloudflare tunnel. Imported from a Replit dump, reviewed, refactored, and had its (~100% fabricated)
government data rebuilt with real, verified sources; deployed with a fresh Postgres and fresh secrets
where possible. See "Live deployment" below for the runbook; owner-pending items at the end.

## 🔁 2026-10-04 — Alpine's CRM re-synced from Housecall Pro
- A fresh read-only export (`analysis/hcp-export-2026-10-04/`, gitignored) was imported into the Alpine Exteriors org
  with `scripts/import-hcp.ts`, after a database backup. Zero errors. It created 33 customers, 48 estimates,
  21 invoices and 16 jobs, and updated 62 estimates and 12 invoices. The CRM now matches HCP's dashboard: 40
  unscheduled jobs ($1,321,532.67) and 35 open invoices ($744,576.96). Open estimates also match at 36 once one
  record is set aside.
- That record is estimate **#2686** (Karen Belli, $21,150, status sent), which was deleted in HCP after July. It was
  left in place; the owner decides whether to remove it.
- How to repeat the sync: HCP's API is MAX-only and Alpine is on Essentials, so the session comes from the owner's
  browser. In DevTools, open Application → Cookies → pro.housecallpro.com and copy the value of
  `_housecall-web_session_with_domain` (Chrome strips cookies from "Copy as cURL"). Load it into the scraper profile
  `analysis/hcp-crawl/profile` and run `dump.js` (with the `package.json` that says commonjs) in a new folder. Then
  run `import-hcp.ts`: first on a test-DB org, then on production through an SSH tunnel to vb11:5433, after a
  pg_dump.

## 🎨 2026-10-03 — every signed-in platform page redesigned ("less is more")
- Owner: "All these pages are so clunky and not user friendly … make them flow and look cleaner simpler and better!
  Less is more … Better design too." Scope: the ~37 signed-in platform pages. The CRM and marketing pages are separate.
- Foundation: `.app-theme` (brand orange, Plus Jakarta Sans, warm page, white cards; dark mode too) and the page kit
  `client/src/components/app-ui.tsx`. The rules are `docs/design/APP-UI.md` — follow them for every new page.
- Built by seven lanes: Codex lanes 1, 2, 4 and 6, Kimi lanes 3, 5 and 7. Each worked in its own worktree from a
  brief (session scratchpad `ui/`), then I polished: one tab style, styled disclosures, location cards on phones,
  and a word-spacing fix for buttons and inputs. Every page has 0 px overflow at 390 px. Testids are kept.

## 🧰 2026-10-02 evening — what is live now (all deployed to vb11; dump-first each time)
- **Call Assistant is LAUNCHED (purchasable).** Four tiers in `shared/plans.ts` CALL_ASSISTANT_TIERS: Lite $149
  (1,000 min, 1 number), Solo $249 ($99 × 3 monthly intro; 2,000 min, 1 number), Crew $449 (5,000 min, 5 numbers),
  Fleet $799 (12,000 min, 20 numbers). Overage 10¢ Lite/Solo, 5¢ Crew/Fleet. 500 spam calls/month free on every tier.
  The two "NOT deployed" entries below are merged, live and superseded by these numbers. Owner still to confirm:
  Lite yearly $1,199; the Stripe failed-payments setting (see the launch gate below).
- **Owner call rules (engine + compiler, `9931a36`):** a caller who asked for work is never hung up on: the spam flag
  is refused unless it sounds like a pitch or robocall, and only their own goodbye ends the call. Unusual or foreign names are
  spelled and read back. "Is <name> available?" (lawyers, firms, collections) gets "I'm not sure. This line is only
  for estimate requests." Personal or non-estimate matters get the estimates-only line, with no message taken. A lone
  early "bye" is treated as a misheard "hi", and queued caller speech is answered before any hang-up. Unanswered
  caller words are kept in the transcript as notes, and the summary gets labelled speakers. These mirror Alpine's
  Janice fixes from the same day. Published profiles keep their compiled prompt until republished; production had none.
- **Feature pages + SEO:** `/features` plus one page per feature and Done-For-You pages, a Features ▾ dropdown in the
  shared ribbon (`client/src/components/site-nav.tsx`) on every public page, and 47 prerendered pages with JSON-LD.
- **Google Profile access (Dennis):** discovery runs for every connected account. There is now a "Google Profile"
  sidebar entry, plus View profiles / Open in Google buttons. Accounts without a plan see "needs a plan" instead of a
  dead Import button.
- **Admin second factor:** a recent identity check (12 h) satisfies the admin gate; a refusal returns `{reauth:true}`
  and the client shows the verify dialog and retries. No more "Admin sign-in required" dead end.
- **Access grants** (`/admin/access`, sidebar "Access grants · ADMIN"): give any account a plan for 1–1000 days,
  extend, revoke. Trial codes go up to 1000 days.
- **Issue desk** (`/admin/issues`, docs/ops/ISSUE-DESK.md): the app records its own 5xx errors, job failures, Call
  Assistant problems and browser errors in `ops_issues`. The tower timer `constructhub-issue-desk.timer` (user unit,
  every 15 min) hands new issues to a headless Claude in `~/ConstructHUB-issue-desk`. Claude has read-only production
  tools and may put a fix on branch `issue/<id>`. It never pushes, deploys or restarts. Admins get a digest and a bell.
  `ISSUE_DESK_SECRET` is in vb11's `.env` and `ops/issue-desk/.env` (600, gitignored). There is a cap of $10 per run
  and 6 runs per day. **Browser reports start as "Needs review"**: they are anonymous input, so Claude only sees one
  after an admin presses Send to Claude. Review every `issue/<id>` branch before merging.
- **Trial invites are one click:** the invite email has an "Accept your invite" button that opens `/invite/<code>`.
  Signing in or signing up there brings the person back, and one click starts the trial. The code also works in
  Settings → Account. Giving access (trial codes, Access grants) never asks the admin for a verification code
  (owner's rule). `script/send-trial-invite.ts` sends one from the command line. Dennis
  (nextsteppainting@gmail.com) got an unlimited invite, TRIAL-B0190130, on 2026-10-02.
- **Janice call log** (`server/voice/ingest.ts`): Alpine's receptionist pushes every finished call to
  `/api/voice-ingest` over the tailnet only, authenticated with `VOICE_INGEST_SECRET`. Calls land in `voice_calls`
  under `VOICE_INGEST_ORG_ID` (Alpine Exteriors) with `engine='external'` and show on Call Assistant → Calls. They
  are records only: never billed, never a lead or alert.
- **Call Assistant Results panel** (Overview and Calls tabs, `client/src/pages/crm-call-assistant/results.tsx`):
  outcome tiles, calls by line, minutes and recordings over a chosen period. The numbers are counted from
  `voice_calls` by `callResultsSummary`, so pushed-in calls count too.
- **The Call Assistant is a platform page, NOT a CRM page** (owner: "the CRM is a standalone service"). Signed
  in, `constructhub.us/call-assistant` is the dashboard, in the main shell. The CRM sidebar and ribbon don't list
  it. The CRM's `/crm/call-assistant` and `/call-assistant` only redirect to the platform, keeping the query, so
  CRM-bell links still work. Leads still land in the CRM as clients.
- **Call numbers:** `voice_calls.call_no` is "Call #57", numbered per account by the `voice_calls_assign_no`
  trigger and unique per org. It shows in the list, the call's title and search (`#57`), and the ingest reply
  returns it as `callNo`. Janice's recordings are two-sided from 2026-10-02 evening. The 63 earlier ones are caller-only.

## ☎️ 2026-10-02 — Call Assistant tiers, 10¢ overage, 500 free spam calls — branch `ca/tiers`, NOT deployed
- Owner: "offer 3 different tiers … 3-5k min used a month … all plans cover 500 spam calls that aren't charged … we
  can charge 10 cents". Solo $249 (2,000 min, 1 number, the $99 × 3 intro), Crew $449 (5,000 min, 3 numbers), Fleet
  $799 (12,000 min, 5 numbers); one tier per subscription; overage $0.10/min; the first 500 spam calls a month free.
- Overage accrues **per call** against the tier in force when the call ends (server/voice/billing-usage.ts), so a
  mid-month upgrade never erases minutes already over, and a downgrade lowers the allowance from then on.
- Holding Crew or Fleet uses the Solo intro up (`markIntrosUsedByHeldAddons`, after every subscription write).
- The "never answer spam" promise is tied to forwarding: with no-answer forwarding spam still rings the contractor
  first; copy says so and tells them to switch to 'always' (CALL_ASSISTANT_SPAM.forwarding).
- **Owner decision:** "reports them" is built as a weekly spam report to the customer (email + bell + Calls → Spam
  blocked). Nothing is reported to SignalWire, carriers or the FTC. Say if you want that. All copy stays limited to
  "your spam report" until then.
- Still `preview: true` (nobody can buy any tier).

## ☎️ 2026-10-02 — Call Assistant billing rules (owner's words) — branch `ca/billing-rules`, NOT deployed
- Owner: "When a person cancels they lose their number … As soon as they stop paying the agent stops working. And
  annually price can be $1999". Answers the two open questions below (intro on annual: no; number on cancel: released).
- **Price:** `call_assistant` annual $1,999 (199900, not 10×). The $99 × 3 intro coupon is MONTHLY only
  (server/billing/intro.ts). Every surface: "$99/mo for your first 3 months, then $249/mo — or $1,999/yr".
- **Stop paying → paused:** add-on modules run only on active/trialing (`ADDON_MODULE_RUN_STATUSES`); past_due /
  unpaid / incomplete / paused → `ent.addonModulesPaused`: engine `/profile` 423 `payment_needed` on the next call,
  CRM reads open / edits 402 `payment_required`, Overview "Paused — update your payment method" → Billing.
- **Cancel → number released:** server/voice/number-release.ts, called from the Stripe webhook + add-on routes;
  scheduled ('releasing') until `release_eligible_at`, then released by a 15-min sweep (ON in production by default;
  `VOICE_NUMBER_RELEASE_WORKER_ENABLED=false` turns it off). past_due never releases. New columns
  `voice_numbers.release_reason`, `release_scheduled_at` (boot DDL + apply-schema-migration).
- Review round: a cancellation is final for every number (no restore on resubscribing within 14 days; only `unpaid`
  → card fixed and a re-added extra number restore); webhook subscription events re-read Stripe before writing the
  row; `VOICE_NUMBER_RELEASE_WORKER_ENABLED=false` now also stops the post-webhook background release; Billing asks
  before an add-on reduction releases numbers; after cancellation callers hear "no longer answered", not "try later".
- **Launch gate:** confirm Stripe → Billing → Subscriptions → Manage failed payments is set to *cancel the
  subscription* or *mark it unpaid*. On "leave it past-due" the agent stays paused (correct) but the number is held
  forever and the platform keeps paying SignalWire for it — past_due never releases.
- Still `preview: true` (nobody can buy it). Launch remains a separate step.

## ☎️ 2026-10-02 — AI Call Assistant built and deployed in admin preview (10:10 UTC)
- **Shape:** SignalWire → `https://constructhub.us/voice/*` (vb11 app, server/voice/proxy.ts, HTTP + WS) → tailnet →
  **tower** engine `constructhub-voice.service` (user unit, `/home/veto/ConstructHUB/voice`, venv `voice/.venv`,
  `127.0.0.1:8152` + `100.90.145.13:8152`; Silero VAD + faster-whisper large-v3-turbo + Kokoro, all on the RTX PRO 6000
  next to alpine-voice — they share nothing). Engine ↔ app: `/api/voice-internal/*` over the tailnet
  (`VOICE_APP_URL=http://100.76.165.33:8110`), bearer `VOICE_INTERNAL_SECRET` (same value in voice/.env and the live
  .env). Brain: ConstructHUB's TruthCoder (`truthcode-api` via `http://100.76.165.33:8250/api`, JSON decision protocol).
  Full design: docs/call-assistant/SPEC.md · ops: docs/call-assistant/RUNBOOK.md.
- **Never restart the engine with systemctl** — `bash voice/deploy/restart-when-idle.sh` (waits for activeCalls 0).
  Health: `bash voice/deploy/healthcheck.sh https://constructhub.us` (local / tailnet / proxy).
- **Product:** CRM → Call Assistant: Overview, Numbers (buy by state via SignalWire LaML, 14-day release rule),
  Agent Studio (wizard + advanced editor, compiled-prompt preview, versions, publish), Simulator, Calls (transcript,
  recording, outcome, spam ledger). Personas Janice/Gabe/Sofia/Maya/Marcus/Ethan. Calls → CRM client + project +
  activity + notifications; escalations by SMS/email with reminders; two-strike spam block pre-answer; minutes metered
  (voice_usage) with an overage job; two-party-consent states force the recording notice; lapsed orgs get 423 "paused".
- **Status: admin preview.** `call_assistant` / `call_number` are still `preview: true` in shared/plans.ts → nobody can
  buy it (409), the public pages say "Coming soon". Platform admins get the module + 1 number + 500 min to test.
  Launch = flip `preview` off after a real call through the carrier and a real Stripe intro-coupon purchase.
- Verified live: engine models loaded, health OK through the proxy, internal API 401 without the secret, forged
  webhook 400, media socket without a token 400. **Not yet exercised on production:** a real carrier call, R2 upload of
  a recording, the Stripe intro coupon. QA fixed 46 findings (incl. unauthenticated media WS, lapsed orgs still served).
- Open owner questions: intro on annual billing; number on cancel (release vs hold).

## 🏠 2026-10-02 — new landing (design B), signed-in dashboard, Call Assistant marketing (deployed 08:35 UTC)
- **Landing** (owner picked design B of three): Fraunces display + Plus Jakarta Sans body on cream paper, scoped by
  `.mkt-editorial` (client/src/index.css) so the app keeps Inter; hard-hat gator hero (srcSet 512/1024) on a navy grid
  panel; ONE orange — #F97316 for large accents/buttons, #AE4A04 (same hue, darker) for small text so it passes AA.
  Runner-up branch `design/c` kept; `design/a` was live for an hour, then replaced.
- **Signed-in home = dashboard** (client/src/pages/home.tsx + client/src/components/dashboard/**; GET /api/dashboard in
  server/dashboard/**, contract shared/dashboard.ts, spec docs/dashboard/SPEC.md): 29 tiles in 5 groups, each computed
  separately on a read-only pool with a 3 s limit, gates from getEntitlements applied before any query, 60 s per-user
  cache (cleared on plan/add-on/webhook changes; ?fresh=1 throttled), "Needs you today", CRM snapshot (read-only org
  lookup — never creates an org), getting-started checklist, recent activity. Indexes for the protect tiles run at boot
  (ensureGrowthSchema). server/crm/follow-ups.ts fix: "leads without an estimate" was over-counted above 2,000 estimates.
- **AI Call Assistant marketing** is live while the product is being built: /call-assistant, landing section, pricing
  line (CALL_ASSISTANT_INTRO in shared/plan-copy.ts: $99/mo × 3 months, then the price-book rate), "Call Assistant · NEW"
  in both sidebars, Gabe knowledge §30. The add-on is `preview: true` in shared/plans.ts → checkout refuses it (409,
  nothing charged), the CRM tab says "Coming soon", /voice/* answers 503. The voice_* tables exist (empty).
  Open owner questions: does the intro apply to annual billing; what happens to a bought number on cancel.
- Test env gotcha: the dev email sink tmp/email-outbox.jsonl hit Node's 512 MB string limit and failed 21 tests at
  read; it was trimmed to its last 2,000 lines. Trim it again if sink-reading tests fail with "Cannot create a string".

## 🐊 2026-10-01 — Gabe (Hub assistant) + the standing-gator mascot (deployed 2026-10-02 03:56 UTC)
- **Mascots** are the owner's artwork in client/public/mascot/ (checkerboard/noisy alpha cut out in-session;
  sources kept in the session scratchpad). `client/src/components/mascot.tsx`: `StandingGator` (hard hat + vest,
  arms crossed) stands to the right of the logo in the site sidebar (`app-sidebar.tsx`, 64px) and the CRM sidebar
  (`crm-sidebar.tsx`, 56px, hidden on the icon rail); `GabeAvatar` is the Hub assistant's face.
- **Hub assistant = "Gabe"** (branch hub/agent-rev merged, then hub/gabe): corner widget on every page; signed-out
  visitors get cached preset answers (pricing, features, setup); signed-in users get free chat through TruthCoder
  (`server/hub/*`: own client with maxRetries 0 + hard timeout, deterministic prefilter + output filter, per-visitor
  and global limits, never any client/user data, no tools). The old `/api/site-assistant/chat` and
  server/site-assistant.ts are gone; the public-API no-AI lists name server/hub/ai.ts and /api/hub/chat.
- **Fixes the verifiers forced before merge:** the Hub's provider pin now accepts `truthcode-api` (the live
  `AI_MODEL`) as well as `truthcode:38` — without it Gabe would have been "offline" on deploy; the output filter
  strips TruthCoder tool-call/reasoning markup and blocks prompt-dump n-grams beyond HARD RULES; the pre-filter
  knows the persona is Gabe; the launcher renders even when /api/hub/presets fails (panel says Gabe is offline).
- **Cloudflare gotcha (cost one redeploy):** a verifier fetched `/mascot/gabe-160.webp` on the live domain BEFORE
  the deploy; the SPA answered 200 text/html and Cloudflare cached that HTML under the image URL for 4 h (it caches
  by extension). The project has no valid Cloudflare API token to purge (`secrets/cf_dns_token.txt` is rejected), so
  the files are named `*.v1.webp` — a changed image gets a new version, never the same name. Never probe a new
  static path on the live domain before it is deployed.

## 🛠 2026-10-01 — audit-4 follow-ups: the four open items (deployed 15:49 UTC)
- **Texting allowance metered (Kimi A1-3)** — every outbound text with an org (manual client texts, reminders,
  estimate texts, invites, consent, re-engagement and owner alerts, the Settings test send) reserves its segments
  from the org owner's monthly `teamTextSegments` allowance through the growth_budgets meter
  (`quota:user:<ownerUserId>:texts:<YYYY-MM>`, UTC month; server/crm/sms.ts `reserveSmsSegments`, counter in
  server/crm/sms-segments.ts — GSM-7 160/153, UCS-2 70/67). Carrier failure refunds; manual sends answer the standard
  403 `limit_reached`; automated alerts skip the text, log once per org per month and fall back to email. Limits &
  usage shows the running total (`usage.texts`). Platform-level beta-invite texts (no org) are not metered.
- **F11 closed** — the vision caption works through the production loopback (`127.0.0.1:8250`, 18 s, HTTP 200);
  the 524 was the public Cloudflare path's 100 s cap, which production never uses.
- **Demo/ops scripts** (scripts/invite-team.ts, scripts/seed-crm-demo.ts) comp the owner on `agency`, not `platinum`.
- **F08/F09 — one-time fulfilment** (server/billing/fulfilment.ts `fulfilOneTimePurchase`, called from both
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`): rows are written only when the
  verified session says `payment_status === "paid"` (an unpaid completion grants nothing; the later async success
  grants it; `async_payment_failed` never does), once per session+item via partial unique indexes
  (`course_purchases(stripe_session_id, COALESCE(module_id,0), COALESCE(is_bundle,false))`,
  `service_purchases(stripe_session_id, service_type)`; `ON CONFLICT DO NOTHING`), all items of a session in one
  transaction — a failure rolls back, rethrows, the billing_events claim is released, the webhook answers 400 and
  Stripe's redelivery re-runs the session. Unreadable metadata throws (no guessed grants). DDL: `FULFILMENT_DDL` in
  server/billing/schema.ts (also in scripts/apply-schema-migration.ts; mirrored in shared/schema.ts). Live DB had 0
  purchase rows at deploy, so the indexes created cleanly.
- **F10 — email outbox**: email_log keeps the dedupe claim on a failed send and becomes `status='pending'` with the
  rendered message, attempts, next_attempt_at, last_error; `drainEmailOutbox()` runs every 60 s
  (`startEmailOutboxDrainer()` from server/routes.ts; `FOR UPDATE SKIP LOCKED`, 10-min lease, backoff
  1m→5m→15m→30m→1h→2h→4h, `failed` after 8 attempts — set `pending` to re-queue). The webhook response never waits
  on mail; a redelivery finds the claim and never double-sends. Known leftover: server/account/email.ts (unused
  lane-1 helper) still has the old delete-claim contract — delete it with server/billing/invoices.ts.

## 🔎 2026-10-01 — audit 4: Codex + Kimi audit of everything since 09-30 (deployed 05:15 UTC)
- Two independent audits of the price book, TruthCoder AI, account/billing/API work (briefs + full reports with
  evidence in the session scratchpad `audit4/`; branches `audit4/codex`, `audit4/kimi`, merged with `--no-ff`).
- **Codex fixed (7):** F01 API monthly quota race + under-metered reads (quota checks serialised through metering,
  real read cost, honest 503 on metering errors — server/public-api/quota.ts, quota-concurrency.test.ts); F02 site
  assistant now on the shared aiClient/aiComplete/timeout path; F03/F04 stale invoice-failure and stray-subscription
  events no longer email; F05 Stripe Connect checkouts can't enter platform course fulfilment; F06 GBP imports are
  atomic under the account location lock (`ImportLocationError`, server/gbp/import-limit.test.ts); F07 Ads
  integration Connect/Manage link opens the MCC manager.
- **Kimi fixed (9 commits):** site assistant hardening (same hole as F02, superset kept), dead `startGbpWorker`
  removed (the lapsed-account sync fix had landed in dead code — the live path in server/agency/jobs.ts was
  already right), test sinks honour `EMAIL_OUTBOX_FILE` / `VOICE_OUTBOX_PATH`, plan-gates test mkdir, Badge-in-<p>
  DOM nesting on Limits & usage, knowledge base no longer says "powered by OpenAI", scan refund test resets state.
- **Still open (owner/engineering):** F08 unpaid `checkout.session.completed` (payment_status=unpaid) still grants a
  course; F09 cart fulfilment DB failure is ack'd to Stripe with no retry; F10 failed billing email has no retry path
  → all three want one transactional one-time fulfilment with event idempotency + an email outbox (server/stripe.ts
  ~599–639). F11 vision caption hit a 524 via the public TruthCoder URL (production uses loopback :8250 — re-test
  there). Kimi A1-3: texting segment allowance (500/1,500 per month) is advertised but not metered server-side
  (server/crm/sms.ts, messages.ts); A1-8: scripts/invite-team.ts + seed-crm-demo.ts still seed `platinum`.
  Unverified: Profile Guard enable has no account-wide lock on downgraded accounts (server/routes.ts:208–226).
- Suite on main after the merge: run with Node 20 (`~/.nvm/versions/node/v20.19.6/bin` — vitest.config needs
  `util.parseEnv`; system Node 18 fails at startup) and `. ~/ConstructHUB-a5/.env` sourced.

## 🧾 2026-10-01 — account settings, billing documents, customer API (deployed 03:45 UTC)
- **Emails** (server/account/billing-emails.ts, one per Stripe event via email_log dedupe, $0 invoices skipped): welcome,
  subscription started, receipt per paid invoice, payment failed, plan/add-on changed, cancellation, one-time purchase.
  Webhook calls onStripeBillingEvent after recordBillingEvent (server/billing/ledger.ts); ledger tables billing_events /
  billing_invoices / billing_purchases (DDL in server/account/schema.ts).
- **Settings** (client/src/pages/settings/*): Ahrefs-style nav — Me (account, password & security, notifications) /
  Workspace (Billing: Subscriptions | Invoices | Payment methods | Purchases; Limits & usage; API keys; API usage; Audit log;
  Integrations). Old ?tab= names redirect.
- **Customer API** `/api/v1/<resource>` with `chub_<prefix>_<secret>` keys (server/public-api/*): account, locations (+POST
  posts), reviews (+POST reply), insights, photos, gbp-posts, social-posts (+POST), site-scans (+POST), citations, /me,
  /openapi.json (docs at /developers). Limits: plan units/month (Starter 0, Pro 10k, Growth 50k, Agency 250k; reads 1 +
  1/100 rows, writes 5), 60 req/min per key, 300/min per account, max 25 active keys, optional per-key cap + expiry.
  **No AI through the API**: server/public-api/no-ai.test.ts walks transitive imports and fails on any AI module;
  server/public-api/guard.ts (mounted first in server/index.ts) rejects chub_ keys on every non-/api/v1 route; API-created
  posts/replies are stored as supplied (source=api). CRM `chk_` keys on /api/v1/customers etc. are unchanged.
- Known leftovers: lane-1 server/account/email.ts and lane-2 server/billing/invoices.ts are unused duplicates (safe to
  delete); course/service fulfilment on a retried checkout.session.completed is not idempotent (pre-existing).

## 💲 2026-09-30 — new price book + TruthCoder AI (deployed 23:45 UTC)
- **Price book** (owner decisions): Starter $29 / Pro $79 / Growth $199 / Agency $349 incl. 10 locations then
  $15 / $10 / $7 per location (quote above 500); annual = 10x; no free plan; 1-day trial (one per Stripe customer);
  add-ons (location $19, seat $15, protected site $15, texting $29 + $29 setup, competitor pack $39); Agency-only:
  agency workspace, Ads/LSA manager, Cloudflare + Search Console, Domains + Gmail alerts; anything >= $1,000 is
  "Talk to a sales rep" (enforced server-side, incl. SEO contracts); CRM included in every plan. Gold/Platinum and
  /individual-pricing are gone (301 to /pricing#add-ons). Legacy keys map via LEGACY_PLAN_MAP (the one Platinum
  row = the owner = Agency).
- **Source of truth:** `shared/plans.ts` (prices, limits, modules, add-ons, bands) + `server/entitlements.ts`
  (getEntitlements, requireModule, 402 plan_required / 403 limit_reached). Never hard-code plan names or prices.
- **Billing:** Stripe Prices are created on first use by lookup key (`chub_v1_…`, amount encoded). Plan/add-on
  changes update the existing subscription (no second checkout). past_due keeps access while Stripe retries —
  **owner must set Stripe → Billing → Subscriptions → Manage failed payments to cancel/mark unpaid**. Agency
  extra-location quantity syncs daily (production only; yearly subs invoice immediately).
- **AI = TruthCoder** (owner's decision): live `.env` has `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:8250/api`
  (truthcoder-webui on the same host, bypasses Cloudflare's 100 s cap), `AI_MODEL=truthcode-api` (the key's API model
  name; verified in the vb11 `.env` 2026-10-01 — it is not `truthcode:38`, which is the preset the key is scoped to),
  `AI_VISION_MODEL=huihui_ai/qwen3-vl-abliterated:8b`, `AI_TIMEOUT_MS=180000`, and the named TruthCoder key **"ConstructHUB"**
  (scoped to truthcode:38 + the vision model; issued by the owner 2026-10-01; rotating his personal key no longer affects it).
  Keys are managed at https://truthcoder.com/api-keys (named, revocable; built by Kimi in the TruthCoder project).
  This is an owner-approved cross-project coupling — record it in `~/HUB/registry.json → known_tower_couplings`.

## 👷 2026-09-30 — Gabe, the corner assistant (merged to main 2026-10-01 as `abaea7a`; **NOT deployed**)
- **Why the widget is not on the live site (2026-10-01):** constructhub.us still serves the bundle built at 11:49
  (commit `30356cc`, before the Hub merge at 23:17): it has no `hub-launcher`, `/api/hub/presets` falls through to the
  SPA catch-all, and `/mascot/*.webp` are missing. **A Cloudflare purge changes nothing** — `index.html` is
  `cf-cache-status: DYNAMIC` (never cached) and the JS bundle is content-hashed. To ship: merge `hub/gabe` (the Gabe
  persona + review fixes), `npm run build` on the tower (Node 20), then `bash script/deploy-vb11.sh` (pg_dump first).
  Verify: the new `/assets/index-*.js` contains `hub-launcher`, and `curl -I https://constructhub.us/mascot/gabe-160.webp`
  returns `image/webp`, not `text/html`. The widget now shows its launcher even when `/api/hub/presets` is missing
  (panel says Gabe is offline, with a retry), so a server/client mismatch is visible instead of silent.
- Replaces the old site assistant (`server/site-assistant.ts`, `site-assistant-chat.tsx` — both removed). Now fronted by Gabe (see the 10-02 entry above); originally a cartoon
  crew member in the bottom-right corner (`client/src/components/hub/`). **Signed out** (marketing pages): 14 preset
  question chips only, no text box; answers come from `hub_preset_answers` (generated in the background through
  TruthCoder, cached per question + knowledge hash) or from price-book templates — a tap never calls the model.
  **Signed in** (growth app + CRM portal): chips + free-text chat. Never on homeowner token pages, `/auth`, `/admin`,
  the client host, or the Google Ads pages (their consultant chat stays). First signed-in visit shows a welcome bubble.
- **No tools, no DB in the AI path**: the model sees only the rules, the public knowledge pack
  (`server/data/hub-knowledge.md`, prices filled from `shared/plans.ts` / `plan-copy.ts`) and the visitor's redacted
  words. Every guardrail is deterministic code in `server/hub/` (pre-filter, output filter, signed turns, budgets,
  breaker, provider pin) — the model (abliterated) is not trusted. Spec + red-team list: `server/hub/redteam-cases.json`.
- Endpoints: `GET /api/hub/presets`, `POST /api/hub/preset {presetId}`, `POST /api/hub/chat` (JSON + same-origin
  `Origin` required), `GET /api/admin/hub-stats` (platform admin; also a card on /admin). Logs: one line
  `hub: <outcome> <reason> <ms>`; `/api/hub` bodies are excluded from the request logger; `hub_stats` holds counts only.
- Env (all optional): `HUB_AI_HOSTS` (default `127.0.0.1:8250`) + `HUB_EXPECTED_MODEL` (comma-separated; default
  `truthcode-api,truthcode:38` — the live `AI_MODEL` is `truthcode-api`, and a pin of only `truthcode:38` would have
  booted Gabe with chat offline) — production refuses chat on any other provider; `HUB_AI_TIMEOUT_MS` (45 s cap), `HUB_GLOBAL_DAILY_CAP` (1500),
  `HUB_MAX_CONCURRENCY` (3), `HUB_TURN_KEY` (else derived from SESSION_SECRET), `HUB_WARM_PRESETS=false` to skip warming.
- Tests: `npx vitest run server/hub/` (unit + in-process routes with a stub model), Playwright
  `-c playwright.hub.config.ts` (needs a bypass-on and a bypass-off dev server), live eval `scripts/hub-redteam.ts`.
- **Owner to confirm on the TruthCoder side** (we don't change it): the "ConstructHUB" key's `truthcode:38` preset has
  no tools, knowledge/RAG, web search or memory, and API calls are not saved as chats. A bare request reports ~600
  extra prompt tokens, so the server appears to add its own system prompt to every call.

## 🚀 2026-09-30 — round-4 lanes + pre-launch QA (deployed 16:08 UTC)
- **Shipped:** agency mode + email onboarding (a1), Site Scan fix guidance (a2), Google Ads/LSA manager (a3),
  Social business selector (a4), Cloudflare + Search Console (a5; Global Key is exchanged for a scoped token and
  never stored), domain registrars (point/update only, no transfer code) + Gmail alert forwarding (a7). None of
  these check a plan yet — gate them when pricing is decided.
- **QA:** 44-agent click-through (400 confirmed findings) → 3 fix rounds → Kimi manual pass (38 findings) → fixed.
  Findings/results: tower scratchpad of session b63db1cc (qa/, kimi-qa/). Pricing reviews (Codex, Kimi, Claude +
  side-by-side) are in the same scratchpad `pricing/` — owner decisions pending (13 pricing-page items wait).
- **Deploy script** now (1) deletes stale hashed bundles in `dist/public/assets` (old bundles stayed downloadable,
  incl. paid Google Ads guide text now served only by `/api/google-ads-guide/:slug`) and (2) runs
  `npx playwright-core install chromium-headless-shell` — live permit search was failing because playwright-core
  1.62 wanted build 1234 while vb11 had 1243. Scrapers use `CHROMIUM_PATH` or the managed build (no Replit path).
- **Boot migrations that ran on prod:** state_guides link-status columns; permit rows re-pointed to real
  counties (27,971) with placeholders cleaned (32,549) and 139 seeded duplicates removed; UNIQUE (org_id, number)
  on crm_invoices/estimates/projects/commitments (skipped automatically on any DB that has duplicates).
- **DB sessions are pinned to UTC** (`server/db.ts`); prod Postgres is already UTC. Tests: `PGOPTIONS="-c TimeZone=UTC"`.
- **Browser tests need three servers** (scratch DB `constructhub_dev_a6`): CRM specs → `VITE_FORCE_PORTAL=true` +
  bypass on; growth specs → portal false + bypass on (+ `INBOUND_MAIL_DOMAIN/SECRET` for domains-mail); anonymous
  specs (growth-reviews, growth-round2, profile-guard-auth, account-security) → bypass OFF. The dev server drops
  page loads under 3+ parallel workers (static index.html shown); failing sweeps pass at `E2E_WORKERS=1`.
  `growth-round2 › real provider failure` needs Google Places unconfigured.
- Pre-deploy dumps: vb11 `~/backups/constructhub-predeploy-*.sql.gz`.

## 🧩 Features shipped 2026-09-30 (security, Profile Guard, AI replies, Posts & Photos, Social, Guides)
Reports: `analysis/FEATURE-a1.md` (security), `-a2` (Profile Guard + AI review replies), `-a3` (Posts & Photos),
`-a4` (Social via Blotato + Guides). Pre-deploy dump: vb11 `backups/pre-features-20260930T002817Z.dump`.
**Production keys in vb11 `~/ConstructHUB-live/.env` — back them up; losing one forces reconnects:**
`GBP_TOKEN_KEY` (32B base64; encrypts Google tokens AND authenticator secrets — lose it = all 2FA + Google
connections reset), `SOCIAL_ENCRYPTION_KEY` (64 hex; customer Blotato keys). `GBP_CONTENT_WORKER_ENABLED=true`
(publishes scheduled posts/photos). Photos reach Google via 1-hour HMAC-signed `/api/public/gbp-media` links
(no public bucket). Honest limits: Google can't be blocked from edits (Lockdown auto-reverts); no API to report
edits/reviews (we prefill Google's form); Google strips EXIF (geotags cosmetic). Blotato = customer's own paid
subscription + API key.

## 🔍 Full audit 2026-09-28 (deployed 09-29 00:17 UTC)
Summary + owner actions + ranked next work: `analysis/AUDIT-SUMMARY-2026-09-28.md` (lane reports
AUDIT-a1/a2-gbp/a3/a4 beside it). Pre-deploy DB dump on vb11: `backups/pre-audit-deploy-20260929T001714Z.dump`.
Open owner items: enable the 4 GBP APIs + register `https://constructhub.us/api/gbp/callback`;
Stripe `sk_test_` key for lanes; SignalWire signing key on vb11; Terms-vs-Privacy SMS wording; CRM
entitlement policy. Lane envs have Stripe secrets BLANKED (only a live key exists) — keep it so.
Browser suites need their own server env: CRM specs → `VITE_FORCE_PORTAL=true` + bypass (let
Playwright boot it); growth-reviews → bypass OFF; `playwright.gbp.config.ts` is pinned to lane a2.

## 🟢 Production host: vb11 (moved from vb7 2026-09-26 22:52 UTC, 194s downtime)
- **LIVE = vb11 `~/ConstructHUB-live`** — NOT vb11 `~/ConstructHUB` (that is a dev tree; never deploy prod there).
- Units (vb11 `systemctl --user`): `constructhub.service` (:8110), `constructhub-demo.service` (:8111,
  `~/ConstructHUB-demo`, its `node_modules` symlinks to the live tree), `constructhub-tunnel.service`
  (d8436ec8, `~/.cloudflared/config-constructhub.yml`), `constructhub-db.service` (dedicated PG16 cluster
  `~/ConstructHUB-live/pgdata`, **port 5433**, dbs `constructhub` + `constructhub_demo`). Node `/usr/bin/node`.
  `.env` at `~/ConstructHUB-live/.env`.
- **Deploy:** `script/deploy-vb11.sh` (replaces `deploy-vb7.sh`). SSH via the tower's `vb11` alias (key auth).
- **vb7 = fallback only:** its units are disabled and guarded (`AssertPathExists`), so restarting them fails
  on purpose. vb11 mirrors DB dumps + `tmp/` to vb7 every 15 min. Failover runbook: vb7 `~/ConstructHUB/FAILOVER.md`.
- Migration done by the infra session; full card: `~/HUB/projects/constructhub.md`. The "Live deployment"
  section below is the **vb7-era history** (2026-07-10 → 09-26).

## Live deployment (2026-07-10) — vb7 era, superseded 2026-09-26 (see above)
- **Host:** vb7 (`voiceban@50.125.203.201 -p 2252`, password auth via `~/.ssh/.vb_askpass` on the tower).
- **App:** `~/ConstructHUB` on vb7, port **8110**, systemd `--user` **`constructhub.service`**
  (`node --env-file=.env dist/index.cjs`, Restart=always, enabled; linger on).
- **DB:** local Postgres 16 on vb7, role/db `constructhub` (password only in `~/ConstructHUB/.env` on vb7).
  Schema via `drizzle-kit push` + `scripts/apply-schema-migration.ts`. Seeders ran clean:
  3,139 counties · 32,965 permit databases · 3,040 appraisers (2,314 with real portals) · 717 verified
  portals applied (58 unmatched by jurisdiction naming — known, honest fallback covers them).
- **Tunnel:** own named tunnel **`constructhub` `d8436ec8-5bcc-4864-92e8-9d178c1a34a6`**, creds
  `~/.cloudflared/d8436ec8-*.json` on vb7, config `~/ConstructHUB/tunnel/config.yml`,
  **`constructhub-tunnel.service`** (systemd --user). Created on the tower via `cloudflared tunnel create`
  (account-level op using `~/.cloudflared/cert.pem`); DNS via the account-wide DNS token
  (`~/ConstructHUB/secrets/cf_dns_token.txt`, chmod 600).
- **DNS:** apex + www = proxied CNAME → `d8436ec8-….cfargotunnel.com`. **Rollback snapshot** (incl. old
  Replit A `34.111.179.208`): `tunnel/dns-rollback/constructhub.us.json` + `~/HUB/dns-rollback/`.
  MX/TXT (Google mail, DKIM, verifications) untouched.
- **Secrets:** `.env` on vb7 (600) from `Construct_hub_secrets.txt` + **fresh** `SESSION_SECRET` and DB
  password (the Replit-leaked ones were NOT reused). R2 verified live (bucket `constructhub`, has user
  logo uploads). `R2_ENDPOINT`/`R2_BUCKET_NAME` set.
- **Deploy update flow:** `script/deploy-vb7.sh` (now `script/deploy-vb11.sh`, retargeted 2026-09-26) — builds on the tower, rsyncs `dist/` (`-azc`
  checksums; a plain `-az` once shipped a partial `dist/data/` and the appraiser seed silently
  skipped), **syncs `package.json`/`package-lock.json` and runs `npm ci --omit=dev` on vb7 whenever
  they differ** (2026-08-01: a deploy shipped `dist/` needing `pdfkit` without installing it — static
  pages kept serving while every `/api/crm/*` route was dead), restarts `constructhub.service`, then
  **verifies the boot** (service active, no "Failed to initialize"/"Cannot find module" in the
  journal, `:8110` 200, `:8110/api/crm/me` 401) and fails loudly instead of leaving a broken deploy
  live. Do not hand-roll rsync + restart — use the script.

## What was done (13 commits, all pushed)

### 1. Code review + fixes (8 findings, all critical ones)
High-effort multi-agent review found 10 verified defects; fixed:
- **Stripe webhook** trusted forged/unsigned events → now fails closed, verifies the raw body.
- **Cart prices** came from the client → resolved server-side via `server/catalog.ts`.
- **Hardcoded session secret** fallback → removed; boot fails in prod if `SESSION_SECRET` unset.
- **Auth bypass** shipped in the default env (`NODE_ENV=development`) → decoupled to an explicit
  `DEV_AUTH_BYPASS_USER1` flag; `.env.example` now ships `NODE_ENV=production`.
- **SSRF** in the Google URL resolver → host allowlist + IP-literal block.
- **Unauthenticated ranking-grid routes** → now require auth.
- **Contract signing** was 100% broken (a `ReferenceError` typo) → fixed.
- **Inverted scheduler filter** (review emails never sent) → fixed.
- Partial: ranking-grid per-user ownership needs a `user_id` column migration (flagged, not done).

### 2. Type + dead-code cleanup
- **112 → 0 tsc errors** (`npm run check` clean; root cause of the 43 schema errors was
  `.omit({id:true})` on `generatedAlwaysAsIdentity` columns — NOT a version mismatch).
- Removed dead `server/replit_integrations/` and scratch `test_pcpao*.ts`.

### 3. Government data rebuilt (the big one)
The data was fabricated: guessed `.gov` URLs, hash-generated phones/addresses. All removed.
- **Appraisers:** 4,485 real county assessment offices, all 51 states, **3,482 (78%) with a real
  verified portal**, 83% with a real phone — scraped from NETR Online → `server/data/appraisers.json`.
- **Permit portals:** **632 verified real portals across 49 states** (Accela, Tyler EnerGov, eTRAKiT,
  SmartGov, OpenGov, CityView, CitizenServe, …) — discovered by two Fable multi-agent workflows, each
  URL passed a liveness + permit-specificity gate → `server/data/permit-portals.json`.
- **Honest fallback:** every jurisdiction with no verified portal shows a "Find permit portal" web
  search link, never a fake URL.
- **Schema:** appraiser `portal_url`/`search_url`/`platform` made nullable; added
  `link_status`/`last_verified_at` to both data tables.

### 4. Verified end-to-end against real Postgres
Ran on a throwaway local Postgres: schema migration ✓, full seed ✓ (3,136 counties, 3,038 real
appraisers, 319 permit rows with real portals), fabrication gone (permit phones 0) ✓, link verifier
✓ (64 live / 0 dead), API queries return real data ✓.

## Current state
- **LIVE at https://constructhub.us** (see "Live deployment" above). `npm run check`: **0 errors**.
  `npm run build`: **passes**. Tower pre-commit guard: clean on all commits.
- DNS was cut over from the old Replit deployment (Google Frontend `34.111.179.208`) on 2026-07-10;
  the Replit app + its DB were left untouched and still exist for the user-data export.
- **CRM (portal.constructhub.us): feature-complete per the owner's field notes and QA'd — see
  "CRM state (2026-08-24)" below.** Last full run: 505/505 vitest, 190+ e2e green.

## CRM state (2026-08-24)
The CRM was built out and hardened across 2026-08-01 → 08-24 (~60 commits; three multi-agent Kimi
sweeps whose reports live in `analysis/KIMI-*.md`). Shipped and live:

- **Communication:** notification bell + per-type In-app/Email/Text matrix (Settings); Messages
  center — two-way client threads with unread counts, waiting timers, assigned-member routing
  (job PM → sales → estimate writer); client portal Messages + Contact-us tab (assigned team w/
  direct lines) + contact footer; estimate "Ask a question" box.
- **Workflow:** editable month/week calendar (appointment CRUD, conflict warnings, auto-navigates
  to a new visit); pipeline with lead create/edit + true per-stage counts; Home stat cards,
  Team Activity, follow-up cadences; client page = HUB (schedule/pipeline/estimate/payment quick
  actions); Project Photos (PM uploads, progress/finished tags, visible in the client portal).
- **Money/docs:** estimate detail/editor — per-line scope & verbiage that renders on the client
  doc, **edit + delete after send** (client link updates, no re-send; signed = locked 409);
  price-book templates; FL/WA division letterheads; take-a-payment (manual recording live;
  online = Stripe checkout link, degrades 503 until the owner's Stripe is verified).
- **Platform:** `/admin` standalone console behind a credential gate (`ADMIN_GATE_USER/PASS` in
  vb7 `.env`); consent-gated first-party analytics + cookie banner; CRM gateway on the growth
  sidebar (`/crm-app`, separate membership); HOVER auto-sync (6h default) — every job creates/
  links a client + imports capture photos (9k+ photos imported).
- **SMS/10DLC (the strategy — do not regress):** carriers ban platform-texting-for-others, so the
  shared number texts ONLY ConstructHub's own users (contractor account notifications) — the model
  SignalWire accepted 8/18. Client texting requires the org's OWN number (`orgCanTextClients`);
  STOP/HELP/START webhook `POST /api/crm/sms/inbound` + `crm_sms_optouts` suppression; consent
  stamps + Privacy §5; optional voice "check your email" nudge (no 10DLC needed). Registration
  materials submitted 2026-08-22; approval pending.
- **Kimi lane workflow:** worktrees `~/ConstructHUB-a{1,2,3}` (ports 8129/39/49, DBs
  `constructhub_dev_aN`, sanitized `.env`); launch `kimi -p "$(cat KIMI-X.md)"` via setsid; check
  `git log main..lane/aN` AND `git status` (Kimi sometimes leaves work uncommitted). New e2e specs
  run in the lane harness (`E2E_PORT`/`E2E_DB`), not against a hand-started 8119. Beware stale tsx
  processes on 8119 serving old code — verify `/proc/<pid>/cwd`, restart, clear `node_modules/.vite`.

## Replit user-data export (pending — the one migration left)
The old Replit deployment HAD real users (their uploaded logos are in R2 bucket `constructhub`).
The new vb7 DB started fresh, so their accounts/purchases don't exist on the live site until this runs:
- Export only the **user-generated tables** from the Replit DB (`users`, `subscriptions`,
  `course_purchases`, `service_purchases`, `search_queries`, `business_locations`, `citations`,
  `review_requests`, `seo_contracts`, click/tracking tables) and load them into vb7's Postgres.
- All reference data (counties, cities, appraisers, permit portals, state guides) regenerates from
  code — never copy it from Replit.
- Blocker: the Replit `DATABASE_URL` was Replit-injected and is not on this box — the owner must pull
  the export from the Replit side (or copy that env var out of the Replit Secrets pane).

## Secrets
- Live secrets: `~/ConstructHUB/.env` on **vb7** (mode 600); tower copy at `~/ConstructHUB/.env`, both
  built from `~/Construct_hub_secrets.txt`. `.env.example` documents every key.
- `SESSION_SECRET` and the DB password on vb7 are **fresh** (generated at deploy, never in Replit).
- **⚠️ ROTATE THE REST** — Stripe, Google, R2, SMTP sat in the old Replit git history. Needs the
  provider dashboards (owner). `~/ConstructHUB/secrets/cf_dns_token.txt` = account-wide Cloudflare
  DNS token (owner-authorized shared account credential; see the tower memory note
  `cloudflare-account-access`).

## Env vars the app needs (see `.env.example`)
`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT`, Google OAuth
(`GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_PLACES_API_KEY`), Google Ads/LSA, R2 (`R2_*`), SMTP (`SMTP_*`),
Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), OpenAI (`AI_INTEGRATIONS_OPENAI_*`).
Canonical link bases (production): `PORTAL_URL=https://portal.constructhub.us`,
`CLIENT_URL=https://client.constructhub.us`, `APP_URL=https://constructhub.us` — when set they win
over Host-header derivation for every generated link (invites, magic links, doc emails).
Local dev only: `DEV_AUTH_BYPASS_USER1=true` (never in prod).

## Re-running / extending the data pipelines
- More appraiser refresh: `npx tsx scripts/scrape-netronline.ts` (resumable).
- More permit portals: add candidates + `npx tsx scripts/build-permit-portals.ts` (or run another
  discovery workflow → `server/data/_permit-candidates.json` → the same script verifies + merges).
- Periodic dead-link sweep (needs `DATABASE_URL`): `npx tsx scripts/verify-links.ts`.

## GBP API access timeline (Google Business Profile / "GMB" API)
The GMB features (GBP analytics, review management, competitor intel) need Google to grant GBP API
access. **✅ APPROVED 2026-09-23** (application #3, case `1-4033000042334`) — project `90021415768`
(`construction-hub-489119`) granted the default 300 QPM quota. Remaining activation step: enable the
Business Profile APIs in that project's API Library (owner console click — no gcloud/service-account
creds exist on any box). ⚠️ Google policy rider from the approval email: **no public statements or
press releases suggesting partnership/sponsorship/endorsement by Google** without prior written
approval. **2026-09-28: `SHOW_COMPETITOR_INTEL` and `SHOW_GOOGLE_REVIEWS` turned back ON and deployed**
(commits 19d15fd, 7ba311a, 22d63d6). The Google Reviews flow was made compliant first: every rating is
offered the Google review option, no reward is tied to a review (the +1% review bonus and the $5,000
drawing were removed; the 3% referral program stays, decoupled), no Yelp ask, and the "zero bad reviews"
explainer was rewritten. Competitor Intel copy says "public ad activity", never "spy". Google re-audits
sensitive-scope apps, so **never reintroduce review gating, review incentives or surveillance wording.**

| Date | Event |
|---|---|
| before 2026-03-09 | Application #1 submitted (exact date not on this box — it's in the alpinesidingcompany Gmail, case `7-1260000039820`) |
| 2026-03-09 23:07 | **Rejected** — "did not pass our internal quality checks"; likely cause per Replit-agent notes: competitor-surveillance marketing on the site |
| 2026-06-20 ~01:00 ET | Application #2 submitted (Replit era): consent-screen branding verified 12:47 AM (project `gmb-profile-500003`), official form filled ~1:02 AM; sensitive scope `business.manage`; Competitor Intel + review-gating hidden behind flags for the reviewer |
| 2026-07-09 | **Rejected again** (Alpine-account application). Google's stated criteria: requester email must be Owner/Manager of a Business Profile **verified ≥60 days**; website URL on the application must **match** the profile's listed website (official own-domain site) |
| **2026-09-08** | ~~Reapply window opens~~ (prior-session interpretation of "60 days from the 7/09 rejection"; Google's only documented 60-day rule is profile-verification age, already met — so we applied early). Note: the reminder routine id once recorded here (`trig_015TqJmLWrrjh2Ujm7cwJek3`) never existed — 404 verified 9/04 |
| 2026-09-04 | **Application #3 submitted** — case `1-4033000042334`, as `support@constructhub.us` (Primary owner of the "Construct HUB" GBP, ~80 days old, website constructhub.us), project number `90021415768` (`construction-hub-489119` — the same project serving the live site's Google OAuth). Same day, pre-submission: public pricing/vpn-shield/master-class pages scrubbed of "Ad Spy / BS Meter / spy on your site" marketing (ported to this repo as `fb9245d`) |
| **2026-09-23 06:48 ET** | **✅ APPROVED** — "your project (90021415768) has been approved to use the Google Business Profile API", default quota 300 QPM. Next steps per email: activate the API in the Cloud Console API Library. Policy rider: no public statements implying Google partnership/endorsement |

⚠️ The 60-day clock is on the **Business Profile's verification date**, not the rejection: if the GBP
profile that will back the application was verified after 2026-07-10, wait until *its* verification
date + 60 days. Evidence for all of the above: Gmail screenshots in `attached_assets/`
(`Screenshot_2026-06-19_215545_*.png`, `image_17819205*.png`, `image_17819315*.png`, `image_17819317*.png`),
`.agents/memory/competitor-intel-flag.md`, `replit.md`, `client/src/lib/features.ts`.

## Business records (not in git)
- **EIN assignment letter (IRS):** `~/ConstructHUB/private/EIN_ConstructHUB.pdf` on the tower.
  `private/` is gitignored — business documents never reach GitHub. Captured by the 48h 3-tier
  backup (internal `/mnt/data/site-backups/constructhub/*.code.tgz`, external, R2), so it survives
  a tower loss. Needed for: A2P 10DLC brand registration, Stripe business verification, banking.

## Open items
- [x] **SignalWire 10DLC campaign APPROVED 2026-08-26 — SMS LIVE 2026-08-27.** Campaign
      `ConstructHUB CRM Notifications` (`e51c79fa-…`) is active with +13605857553, +17278705005 and
      +12078862206 attached. Prod `SIGNALWIRE_FROM_NUMBER` switched to **+13605857553** — the old
      +13605858200 is a `messaging_integration_test` number SignalWire will not attach to a campaign.
      Test send to the owner's phone returned `delivered`. Opt-in screenshots: `private/signalwire-10dlc/`.
- [x] **Inbound STOP/HELP webhook** `https://portal.constructhub.us/api/crm/sms/inbound` set on all
      three campaign numbers via `PUT /api/relay/rest/phone_numbers/{id}` (2026-08-27); HELP reply verified.
- [ ] **Owner: install the SignalWire signing key.** SignalWire signs inbound webhooks with the
      project *signing key* (Dashboard → API Credentials → Signing Key → Show), not the API token — the
      app was 403'ing real carrier STOPs until 2026-08-27 (fixed: accepts + warns when the key is unset).
      Add `SIGNALWIRE_SIGNING_KEY=…` to vb7 `~/ConstructHUB/.env`, `systemctl --user restart constructhub`,
      then text STOP/START to +13605857553 from any campaign number and confirm 200s in the journal.
      Real STOP → suppression → START round-trip verified end to end on 2026-08-27.
- [ ] **Owner: Stripe payout verification** — unlocks live card/ACH capture for take-a-payment
      (currently clean 503 + manual recording).
- [ ] **Owner: HOVER measurement-file API access** — HOVER 401s all deliverable formats for API apps;
      ask HOVER support to enable. Unlocks sqft + report PDFs for auto-estimates (code ready).
- [ ] **Owner: attorney review** of CRM Terms/Privacy (incl. the new SMS §5).
- [ ] **Owner: Alpine Exteriors has TWO divisions both named "Alpine Exteriors"** (`c3c712bb…` with
      5 projects + Braxton; `5c48ea4c…` with 59 projects + Andrey/Mike). Division scoping is STRICT, so
      Braxton (admin, pinned to the small one) sees only 5 of 64 projects and none of the other arm's
      visits. Merge the divisions or unpin Braxton's `division_id` in /crm/team — a data decision, not code.
      (2026-08-24: the related "calendar isn't saving" report was a code bug, fixed + deployed — unlinked
      appointments were hidden from scoped members; see `appointmentDivisionVisible`. Same day, second
      report "scheduled from the client page, not on my schedule": customer-only appointments inherited
      the customer's inferred division (null for Braxton's test client) and were hidden from the creator.
      Rule now: project-linked = strict; customer-only + unlinked = every member. Fixed + deployed.)
- [ ] Design decisions flagged by audits: multi-org homeowner portal binding (`accounts[0]`),
      expired estimates not counted in client bid tabs, org-wide stats vs divisions,
      adopt `eslint-plugin-react-hooks` (the pipeline blank-screen class).
- [x] **GBP API access — APPROVED 2026-09-23** (application #3, case `1-4033000042334`; timeline above).
- [ ] **Enable the Business Profile APIs** in project `construction-hub-489119` (owner console click,
      links in the timeline section) — then build the GBP integration (OAuth scope `business.manage`,
      account/location listing, info edits, review display + owner replies, performance metrics).
- [x] Deploy — **DONE 2026-07-10** (live at constructhub.us, see "Live deployment").
- [ ] Rotate secrets (Google, SMTP, R2 — provider dashboards; SESSION_SECRET + DB pw already fresh).
      **Stripe: superseded by the cross-wire item below — the leaked key was GGG's, rotate it on the
      GGG side.**
- [x] **2026-08-01 STRIPE CROSS-WIRE — RESOLVED same day.** The `.env` keys were GGG's account;
      owner minted a fresh `sk_live_…` from the real **acct_1TzcYU9yWcdekSaP**, installed
      tower+vb7, BOTH webhook endpoints recreated under it with fresh secrets, fail-closed
      verified, Connect OAuth round-trip confirmed (Alpine Exteriors linked, direct charges +
      Stripe Checkout working end-to-end). **Still open on the GGG side: rotate GGG's leaked
      Stripe key (sat in Replit git history) — GGG-project task.**
- [x] CRM Stripe Connect **client id** — **DONE 2026-08-01.** Platform profile completed (Platform /
      direct charges / Stripe-hosted onboarding / Stripe carries risk), OAuth enabled,
      `STRIPE_CONNECT_CLIENT_ID` (`ca_Uzc1…Rsgf`, correct acct) on tower + vb7.
- [x] CRM Connect **OAuth redirect URIs** — **DONE 2026-08-01** (owner added all 3 callback URIs in
      the dashboard; portal.constructhub.us is Default).
- [ ] Stripe account banner "**Action required** — provide info to keep payouts enabled" — owner,
      Stripe dashboard → View task (business/identity verification).
- [ ] Real OpenAI key — `AI_INTEGRATIONS_OPENAI_API_KEY` is a boot-safe dummy; AI consultant/assistant
      endpoints error until a real key is set (Replit's modelfarm proxy no longer exists).
- [ ] **Export real user data from Replit** — see the "Replit user-data export" section above for the
      table list and the `DATABASE_URL` blocker. The Replit app + DB were left untouched.
- [ ] Ranking-grid per-user ownership (`user_id` column migration) — deferred from the review.
- [ ] Optional: keep expanding permit-portal coverage past 632 (pipeline is built for it).

## Call Assistant (AI phone receptionist) — infra, 2026-10-02

Spec `docs/call-assistant/SPEC.md`, runbook `docs/call-assistant/RUNBOOK.md`, lane notes `LANE-NOTES-*.md`.
Built in lanes on `voice/*` branches; not deployed to production by any lane.

- **Where it runs:** the Python engine (`voice/`) on the **tower GPU** as the user unit
  `constructhub-voice.service` (`127.0.0.1:8152` + tailnet `100.90.145.13:8152`). The vb11 app proxies
  `https://constructhub.us/voice/*` to it (`server/voice/proxy.ts`: raw HTTP + the media WebSocket; 503
  JSON when the engine is down). No new DNS/tunnel entries.
- **Units/ports on the tower:** `constructhub-voice` :8152. `alpine-voice*` (:8150/:8151) are another
  project's — never restarted, never read.
- **Secrets (names only):** `VOICE_INTERNAL_SECRET` — same value in the app `.env` (vb11) and in the tower's
  `voice/.env` (gitignored). App: `VOICE_ENGINE_URL`, `VOICE_PUBLIC_BASE`, `VOICE_PROXY_TIMEOUT_MS`. Engine:
  see `voice/.env.example`. Rotation steps in RUNBOOK §7.
- **The restart-when-idle rule:** never `systemctl --user restart constructhub-voice` by hand; use
  `bash voice/deploy/restart-when-idle.sh` (waits for `activeCalls == 0`; unit `TimeoutStopSec=620`).
- **Install/update on the tower:** `bash voice/deploy/install.sh` (venv, requirements, `.env` from example,
  model warm-up, unit). Health: `bash voice/deploy/healthcheck.sh https://constructhub.us`.
- **Owner-pending:** pricing confirmation (SPEC §14), the single `constructhub-test` number (numbers lane),
  and the Alpine cut-over of +1 360-585-8200 (RUNBOOK §10 — owner decision only).
- **Dev stage currently on the tower:** engine from `~/ConstructHUB-voice-infra/voice` via a systemd drop-in +
  a dev app on :8201 (RUNBOOK §11, teardown steps there).
