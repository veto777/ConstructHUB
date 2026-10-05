# Lane 1 — Call Assistant core (`/call-assistant`) — element map

Audit agent `ca`, 2026-10-04. Branch `audit/1`, worktree `/home/veto/ConstructHUB-audit1`.
Pages: `client/src/pages/crm-call-assistant/{index,overview,results,paused-banner,calls,calls-detail,calls-shared}.tsx?`.

**Test setup.** Dev user 1's active org is `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` ("SKU Dry-Run",
tz `America/Los_Angeles`, `voice_profiles` row = draft, never published) — the oldest membership wins
(`server/crm/tenancy.ts:37 ensureOrgForUser`, no session pin). Three AUDIT- calls were pushed through the
app's own ingest route (`registerVoiceIngestRoutes`, same code path as `server/voice/ingest.test.ts`; the
shared server on :8301 has no `VOICE_INGEST_SECRET` → 503, so the identical route ran on an ephemeral port,
`ca/push-audit-calls.mts`):

| call_sid | engine | outcome | dur | started_at (UTC) | LA local |
|---|---|---|---|---|---|
| AUDIT-CA-20261004-001 | external | lead_submitted | 130 s | 2026-10-04 23:05 | Oct 4 16:05 |
| AUDIT-CA-20261004-002 | external | spam | 12 s | 2026-10-04 23:20 | Oct 4 16:20 |
| AUDIT-CA-TZPROBE-001 | external | info | 60 s | 2026-10-01 05:00 | **Sep 30 22:00** (tz probe) |

Independent ground truth (psql): org-tz October window (>= 2026-10-01T07:00Z) = **2 calls / 2 min / 1 spam**;
30-day window = **3 calls / 3 min**; `voice_usage` and `voice_spam` (before the block test) = 0 rows.
Org `1e3050c1…` ("Alpine Exteriors Test", also user 1's) verified the all-zero empty states.
`ALLOWANCE`: platform-admin org → `minutes: -1` (unlimited). Screenshots + browser log in the lane dir.

Statuses: OK / BUG / UNCLEAR (why) / DEAD. "Code only" = shape verified against server code, not pressed.

---

## `/call-assistant` — page shell, plan gate, tab strip (`index.tsx`)

Route exists: `client/src/App.tsx:206`. Renders for the session org via `requireOrg` (membership → org owner
entitlements). Data: `GET /api/crm/me` (permissions), `GET /api/crm/voice/status` (everything else).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Call Assistant" title / `text-call-assistant-title` | Header | Names the page. | index.tsx:158 | — | Browser | OK |
| "live · Janice" / `badge-call-assistant-status` | Status pill | Shows `live · <receptionist>` when an outside receptionist's calls are in the log and our own assistant was never published; otherwise the profile status (live/paused/draft tone-mapped). | index.tsx:160-166 | GET /api/crm/voice/status → billing.ts:103 → `externalReceptionist` (ingest.ts:225, voice_calls engine='external', any in last 30 d) + voice_profiles.published_version | Browser: pill read "live · Janice" with 3 pushed calls; SQL count=3 | OK |
| Tab Overview / `tab-call-assistant-overview` | Tab | Shows the Overview panel; writes `?tab=overview`. | index.tsx:177-181 | client only (wouter navigate) | Browser: all 5 tabs clicked | OK |
| Tab Numbers / `tab-call-assistant-numbers` | Tab | Opens the Numbers panel (numbers lane's file). | index.tsx:187 | client only | Browser | OK |
| Tab Agent studio / `tab-call-assistant-studio` | Tab | Opens the Studio panel. | index.tsx:188-198 | client only | Browser | OK |
| Tab Simulator / `tab-call-assistant-simulator` | Tab | Opens the Simulator panel. | index.tsx:199 | client only | Browser | OK |
| Tab Calls / `tab-call-assistant-calls` | Tab | Opens the Calls panel (log/spam/escalations). | index.tsx:200 | client only | Browser | OK |
| `?tab=` deep link | URL | Opens the page on the named tab; unknown values fall back to overview. | index.tsx:76-79, 137-141 | client only | Browser (`?tab=calls`, `?tab=studio`) | OK |
| "Janice answers your phones today" / `notice-studio-external` | Notice | On the Studio tab only: explains the outside receptionist answers your phones and this studio is for ConstructHUB's own assistant. | index.tsx:189-196 | Same status query, `external` block | Browser: shown with data, absent on empty org | OK |
| Plan gate card / `plan-required-callAssistant` | Gate | When the org owner's subscription lacks the add-on (or every other /api/crm/voice/* route 402s): lock icon, "Add-on" badge, "Coming soon" badge when preview, the server's 402 message, and one way to Billing. | index.tsx:169-172, 82-131 | GET /api/crm/voice/status answers `enabled:false` without the add-on (billing.ts:103, skipModule); other routes 402 via voiceContext (context.ts) | Code only: user 1's orgs all hold the add-on (enabled=true), so the gate can't render in dev | OK |
| "Not available yet" / `button-call-assistant-unavailable` | Button (disabled) | Preview state of the add-on: dead button, no link. | index.tsx:102-103 | — | Code only | OK |
| "Add it in Billing" / `link-call-assistant-billing` | Link | Goes to Settings → Billing to buy the add-on. | index.tsx:105-107 | client: `/settings?tab=billing` (route exists, App.tsx:236) | Code only (route grep) | OK |
| "What's included" details + 5 bullets | Details | Marketing copy of what the assistant does. | index.tsx:109-115 | — | Code only | OK |
| Tier grid / `list-plan-required-tiers`, `text-plan-required-tier-*` | List | The four call-assistant tiers with price-book minutes/numbers/overage. | index.tsx:116-123 | shared/plan-copy `callAssistantTiers()` (price book — report-only) | Code only | OK |
| Intro line / `text-plan-required-intro` | Text | Solo intro price + spam allowance line + plan list. | index.tsx:124-127 | shared/plan-copy | Code only | OK |
| Paused banner (non-overview tabs) | Banner | When the add-on is bought but payment failed: banner above the tab strip on every tab except Overview (which shows it inside the panel). | index.tsx:176 | GET /api/crm/voice/status `paused:true` (billing.ts:107 `modulePaused`) | Code only: no paused org creatable without touching billing | OK |

## Overview tab (`overview.tsx`)

Panel `panel-call-assistant-overview`. Queries: status (shell), `GET /api/crm/voice/calls?limit=5`
(overview.tsx:30) for Recent calls, `GET /api/crm/voice/calls/summary?range=30d` via `<CallResults/>`.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading/empty panel state | Empty state | Shown while status loads or is missing. | overview.tsx:33-39 | — | Browser (brief flash) | OK |
| `banner-call-assistant-paused` inside panel | Banner | Overview's copy of the paused banner (see below). | overview.tsx:70, 79 | same as shell | Code only | OK |
| "Next step" text / `text-overview-next-step` | Text | Picks the one next action: outside receptionist live → "Janice answers your calls — N in the last 30 days"; else set up & publish; else get a number; else try the simulator. | overview.tsx:64-68, 83-85 | `external.callsLast30Days` = voice_calls engine='external' started_at >= now-30d (ingest.ts:231) | Browser: "Janice answers your calls — 2 in the last 30 days" (2 calls existed then); after the 3rd push the API read 3 = SQL count(*) FILTER started_at >= now()-30d | OK |
| "View calls" / `link-overview-next-calls` | Link button | Goes to the Calls tab. | overview.tsx:86 | client: `/call-assistant?tab=calls` | Browser | OK |
| "Assistant" tile / `metric-overview-assistant` | Stat tile | Live (green) with the receptionist's name and last-call date when an outside receptionist covers the lines and our assistant isn't published; otherwise the profile status (draft/paused) and live version. | overview.tsx:90-97 | external block (ingest.ts:225) — `lastCallAt` = max(started_at) of her calls | Browser: "Live / Janice, your own receptionist · last call Oct 4" — but see lastCallAt BUG (fixed in code, not yet on the running server) | BUG (fixed) |
| "Lines" tile (ext, no numbers) / `metric-overview-numbers` | Stat tile | When there are no ConstructHUB numbers but an outside receptionist: count of her distinct markets (min 1) and who answers. | overview.tsx:98-100 | `external.lines` = distinct flags.ingest->>'market' from her calls (ingest.ts:236) | Browser: "1 / FL · answered by Janice"; SQL distinct market = {FL,WA} → 2 after tz probe | OK |
| "Numbers" tile / `metric-overview-numbers` | Stat tile | Otherwise: how many numbers ring the assistant (released ones hidden) + how many the plan includes. | overview.tsx:101-104 | voice_numbers via listOrgNumbers (numbers.ts), status != 'released' (billing.ts:159) | Browser on empty org: "0 / 5 included"; SQL voice_numbers = 0 | OK |
| "Minutes this month" / `metric-overview-minutes` | Stat tile | Billed minutes this UTC month vs the included allowance (with calls count and overage $). When an outside receptionist is the only answerer, shows HER minutes/calls this calendar month in the org's time zone, "not billed here". | overview.tsx:105-111 | voice_usage row month='2026-10' (UTC key, billing-usage.ts:52 `voiceMonthKey`, `summarizeVoiceUsage`) OR `external.thisMonth.minutes` = round(sum(duration_seconds)/60) of her calls in the org-tz calendar month (ingest.ts:227-233) | Browser: "2 / 2 calls answered by Janice · not billed here" = SQL window count | OK |
| "Spam stopped this month" / `metric-overview-spam` | Stat tile | Own-engine: meter's spam+blocked calls this month + "N of 500 free spam calls used". External-only: HER spam-screened calls this org-tz month. | overview.tsx:112-118 | voice_usage.spam_calls+blocked_calls (billing-usage.ts:133) + free allowance; OR external.thisMonth.spam = her calls outcome IN (spam,blocked) in org-tz month (ingest.ts:234) | Browser: "1 / Screened out by Janice" = SQL count outcome=spam in window | OK |
| `metric-overview-calls` (sr-only) | Hidden text | Screen-reader/test anchor for the calls count folded into the minutes tile. | overview.tsx:121 | same sources as the tiles | Browser: "2 calls this month" | OK |
| "Your tier" card / `card-overview-tier`, `text-overview-tier` | Card | Names the held tier with its minutes/numbers, or "No tier on this account". | overview.tsx:128-136 | status `tier` from the owner's held add-ons (billing.ts:111 `callAssistantTierOf`) | Browser: "No tier on this account" (admin holds no tier) | OK |
| "Change tier"/"Choose a tier" / `link-overview-change-tier` | Link | Settings → Billing. | overview.tsx:137-141 | client: `/settings?tab=billing` | Code only (route exists) | OK |
| "Compare tiers" details / `list-overview-tiers`, `row-overview-tier-*` | Details | All four tiers with Current/Upgrade/Downgrade marks and proration note. | overview.tsx:143-160 | shared/plan-copy (price book — report-only) | Browser | OK |
| "Minutes used" % / `text-overview-minutes-pct` + `progress-overview-minutes` | Stat + bar | Billed minutes vs allowance; "Unlimited" and no bar for platform admins. | overview.tsx:164-171 | usage.minutes / allowance.minutes from status | Browser: "Unlimited", no bar | OK |
| "Billing details" details | Details | Meter rules: per-started-minute billing, first 500 spam calls free, blocked calls cost nothing; "For 2026-10." | overview.tsx:172-176 | status.usage.month (UTC month key) | Browser | OK |
| Price line / `text-overview-price` | Text | Solo intro price blurb. | overview.tsx:177-179 | shared/plan-copy (price — report-only) | Browser | OK |
| Badges: addon name, "Coming soon", plan, engine pill / `pill-overview-engine` | Badges/pill | Engine pill: "Engine not configured" (warning) / "Engine down" (danger) / "Engine starting" / "Engine up" from a cached ~30 s probe of the engine's /health. | overview.tsx:181-186 | billing.ts:49 `probeEngine` → GET {VOICE_ENGINE_URL}/health, cached 30 s; `configured` = VOICE_INTERNAL_SECRET set | Browser: "Engine not configured" (secret unset on dev — truthful) | OK |
| "Numbers ringing the assistant" card, "Manage" / `link-overview-numbers` | Card + link | Lists the numbers with label/location/test badge/status, or the "no number yet" hint. Manage → Numbers tab. | overview.tsx:190-212 | voice_numbers (billing.ts:159) | Browser: hint shown on empty org; row rendering code-only (no numbers in dev) | OK |
| "Recent calls" list / `list-overview-calls`, `link-overview-call-N` | List + links | Last 5 calls (newest first): number, outcome pill, summary, when; row click opens that call's detail sheet. "All calls" → Calls tab. | overview.tsx:215-241 | GET /api/crm/voice/calls?limit=5 → calls.ts:132 → voice_calls WHERE org, **outcome NOT IN (spam,blocked) or null**, started_at DESC | Browser: 1 row (call #1; the spam call #2 is silently excluded — see BUG ‡) | BUG |
| "No calls yet" / `text-overview-no-calls` | Empty state | When the log is empty or the query failed ("isn't available yet"). | overview.tsx:221-224 | same | Browser on zero-call org: honest zeros | OK |

† Timing note: the browser pass ran while 2 calls existed ("2 in the last 30 days" was correct then);
the tz-probe call (below) was pushed afterwards for the month-window check, after which the same API read 3.
Not a bug.

## Results panel (`results.tsx`) — rendered on Overview AND above the Calls tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Range picker / `select-results-range` | Select | "Last 7 days" / "Last 30 days" (default) / "This month" / "All time" — refetches the summary. | results.tsx:46-47, 64-71 | GET /api/crm/voice/calls/summary?range= → calls.ts:172 → `callResultsSummary` (calls.ts:86): voice_calls WHERE org AND started_at >= window; 7d/30d = UTC now-interval, month = **calendar month in the org's tz** (date_trunc at org tz), all = org only. Rounding: minutes = round(sum(duration_seconds)/60) | Browser: month=2/2min, 30d=3/3min after tz probe — matches psql with the 2026-10-01T07:00Z boundary exactly | OK |
| Loading skeletons | Skeleton | Six placeholder tiles while loading. | results.tsx:74-75 | — | Browser | OK |
| Error + "Try again" / `text-results-error` | Error state | Failed fetch message; Try again refetches. | results.tsx:76-77 | — | Code only | OK |
| Empty / `text-results-empty` | Empty state | "No calls in the last 30 days…" (honest zero) when total=0. | results.tsx:78-81 | same summary | Browser on zero-call org | OK |
| "N calls answered" / `text-results-total` | Headline stat | All calls in the window (any engine — ingested calls count). | results.tsx:84-85 | count(*) voice_calls, org, window | Browser: 2 (month) / 3 (30d) = SQL | OK |
| "N real callers" / `text-results-real` | Headline stat | Total minus spam/blocked. | results.tsx:86 | total − sum(outcomes spam+blocked) | Browser: 1 / SQL 1 | OK |
| "% became estimate requests" / `text-results-lead-rate` | Headline stat | Rounded leads ÷ real callers (hidden when no real calls). | results.tsx:87-89 | round(100 * (lead_submitted+booked) / real) | Browser: 100% (1/1) | OK |
| 6 outcome tiles / `tile-results-*`, `text-results-*` | Tiles + buttons | Estimate requests (lead_submitted+booked), Sent to a person (alerted), Questions answered (info), Declined (declined+out_of_area), Hung up (hangup+voicemail), Spam blocked (spam+blocked). Clicking opens the matching calls (outcome filter, or spam view). | results.tsx:34-41, 92-113 | same summary `outcomes` map | Browser: 1/0/0/0/0/1 = SQL group-by; clicks land on the right view/filter | OK |
| "Calls by line" / `list-results-lines`, `row-results-line` | Bar list | Per-line call and lead counts; bar width relative to the busiest line. Line label = ingested market + " line", else number label/phone/to_number, else "Unknown line". | results.tsx:115-126 | calls.ts:103-108: flags.ingest->>'market' || ' line', LEFT JOIN voice_numbers, leads = outcome IN (lead_submitted,booked) | Browser: "FL line — 2 calls · 1 estimate request"; WA probe call correctly stays out of month view | OK |
| "N minutes on the phone for you" / `text-results-minutes` | Stat | Total talked minutes in the window, rounded. | results.tsx:128 | round(sum(duration_seconds)/60) | Browser: 2 (month) = SQL | OK |
| "N of M calls recorded" / `text-results-recordings` | Stat | How many calls have a recording. | results.tsx:129 | count(recording_key) | Browser: 0 of 2 = SQL | OK |

## Paused banner (`paused-banner.tsx`)

Shows when the status is `paused:true` (add-on bought, subscription needs payment). Reads stay open, edits 402.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Paused — update your payment method" / `banner-call-assistant-paused`, `text-call-assistant-paused` | Banner | Warns the assistant stopped answering; callers hear a "taking a break" message; settings and the log stay readable. | paused-banner.tsx:11-12 | GET /api/crm/voice/status `paused` (entitlements `modulePaused`) | Code only (no paused org on dev) | OK |
| "Update payment method" / `link-call-assistant-paused-billing` | Link button | Billing page (or the billingHref the server sends). | paused-banner.tsx:13-15 | status.billingHref (`/settings?tab=billing`) | Code only | OK |
| "What happens to calls and numbers?" details | Details | Explains number retention: while Stripe retries (not `unpaid`), numbers are held; once `unpaid`, releasing → date shown, released → pick a new number after paying. | paused-banner.tsx:16-29 | status.subscriptionStatus + numberRelease from voice_numbers release_reason (billing.ts:151-155) | Code only | OK |

## Calls tab (`calls.tsx`) — log, spam, escalations

Panel `panel-call-assistant-calls`. Sub-views via `?view=` (spam/escalations; log is default), `?call=<id>`
opens the detail sheet, `?outcome=` pre-sets the log filter. `<CallResults/>` sits above the sub-view tabs.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Calls" / `button-calls-view-log` | Sub-tab | The call log (spam excluded). | calls.tsx:87-88 | — | Browser | OK |
| "Spam blocked" + badge / `button-calls-view-spam`, `badge-spam-this-month` | Sub-tab | Spam view; green badge = "Spam stopped this month" (meter + her screened calls). | calls.tsx:89-94 | GET /api/crm/voice/spam → calls.ts:251 → thisMonth.spamCalls = voice_usage(spam+blocked, UTC month) + outsideSpamThisMonth (voice_calls engine='external' outcome IN (spam,blocked), **org-tz month**, calls.ts:73) | Browser: badge 1 = SQL 1 | OK |
| "Escalations" + badge / `button-calls-view-escalations`, `badge-open-escalations` | Sub-tab | Escalations view; amber badge = open count. | calls.tsx:95-100 | GET /api/crm/voice/escalations?open=1 → calls.ts:296 → voice_escalations WHERE closed_at IS NULL, limit 200 | Browser: badge hidden at 0; SQL 0 rows | OK |
| Search box / `input-calls-search` | Input | Debounced (300 ms) text search over caller name, number, summary, service, city; "#57"/"57" also matches the per-org call number. | calls.tsx:149-158, 164 | GET /api/crm/voice/calls?q= → calls.ts:146-158 (ilike / call_no eq) | Browser: "AUDIT-Caller" → 1 row; junk → empty state | OK |
| Outcome filter / `select-calls-outcome` | Select | Filters the log by one outcome. Default "All outcomes (no spam)" — spam/blocked deliberately not offered (they live in the Spam view). | calls.tsx:165-173 | GET /api/crm/voice/calls?outcome= → calls.ts:140 | Browser: deep link ?outcome=lead_submitted → 1 row | OK |
| Log table / `table-calls`, `row-call-N`, `text-call-no-N` | Table + row clicks | Columns: Call #, When (viewer-local), Caller (name/number/city), Outcome pill (+ "Client" link when linked), What it was about, Length (+mic icon when recorded). Row click (or `button-open-call-N`) opens the detail sheet. | calls.tsx:198-270 | GET /api/crm/voice/calls?limit=25&page= → calls.ts:132: WHERE org AND (outcome NOT IN (spam,blocked) OR null) + filters, ORDER BY started_at DESC | Browser: 2 non-spam rows (calls #1,#3) with pills "Lead"/"Info"; SQL agrees | OK |
| `link-call-client-N` | Link (conditional) | Jumps to the linked CRM client. | calls.tsx:241-250 | customerId → /crm/clients/:id (route exists, App.tsx:396) | Code only (no linked customer in dev) | OK |
| Pager / `text-calls-total`, `button-calls-prev`, `button-calls-next` | Pager | "N calls · page X of Y" + prev/next (disabled at the ends). | calls.tsx:272-288 | page/limit params (calls.ts:38-39,160-162) | API: limit=2 page1=[1,3], page2=[]; buttons code-verified (25-row page needs 25+ calls — not fabricated) | OK |
| Spam summary card / `card-spam-summary`, `text-spam-this-month`, `text-spam-rejected`, `text-spam-numbers-blocked`, `text-spam-free-used` | Stats | Four numbers: spam stopped this month (meter + hers), rejected before answering (**meter's blocked only** — hers not counted, see BUG §), numbers blocked in the ledger, free spam calls used/limit (500). Headline/lead from the price book. | calls.tsx:321-350 | GET /api/crm/voice/spam (calls.ts:251-271): ledger listSpamLedger (spam.ts), blocked = entries blocked, usage meter + outside | Browser: 1 / 0 / 0 / 0 of 500; SQL: 1 spam, 0 blocked, ledger 0 blocked | BUG (§, latent) |
| Block-a-number form / `input-spam-block-number`, `button-spam-block` | Input + button | Blocks a number by hand: ledger row with "Blocked" status; its next calls are rejected before answering. Manage-permission only. | calls.tsx:360-383 | POST /api/crm/voice/spam/block {phoneNumber} → calls.ts:284 → spam.ts `blockNumber` → voice_spam row (blocked_by=member) + activity log | Browser: blocked +15550199003 → ledger row "Blocked", count 1 → matches SQL | OK |
| "Only members who can manage settings…" | Text | Shown instead of the form (and per-row buttons) without manageSettings. | calls.tsx:381-383 | voiceContext perm (context.ts) | Code only (user 1 manages) | OK |
| Ledger table / `table-spam-ledger`, `row-spam-N`, `pill-spam-status-N` | Table | Screened numbers: number, Blocked (auto)/(by hand)/Watching pill, strikes, calls, last reason (+confidence), last call. | calls.tsx:385-432 | GET /api/crm/voice/spam entries = voice_spam ledger, newest first | Browser: after unblock, row "Watching", blocked count back to 0 | OK |
| `button-spam-unblock-N` / `button-spam-block-N` | Buttons | Unblock → next calls answered again, strikes restart. Block (on a watching row) → blocks by hand. | calls.tsx:418-425 | POST /api/crm/voice/spam/:id/unblock → calls.ts:273 → spam.ts `unblockNumber` (sets unblocked_at; blocked = blocked_at && !unblocked_at) | Browser: unblock → "Watching", count 0; SQL unblocked_at set | OK |
| Spam calls list / `table-spam-calls` | Table | The spam/blocked calls themselves (same row layout as the log), latest 25; "Showing the latest N of M" when more. | calls.tsx:435-449 | GET /api/crm/voice/calls?spam=1 → calls.ts:138-141: outcome IN (spam,blocked) | Browser: 1 row (call #2) = SQL | OK |
| "No spam yet" / "None so far." | Empty states | Honest zeros for ledger and spam calls. | calls.tsx:388, 440 | — | Browser on zero org | OK |
| "Show closed" switch / `switch-escalations-closed` | Switch | Toggles escalations list between open-only and all. | calls.tsx:455-471 | GET /api/crm/voice/escalations(?open=1) → calls.ts:296-301 → voice_escalations, limit 200 | Browser: empty states both ways | OK |
| Escalations list / `list-escalations` | List | One `EscalationRow` per escalation. Ingested calls never file escalations, so for an outside-receptionist org this is always empty — honest, explained in the empty state. | calls.tsx:454-486 | listEscalations (escalations.ts) | Browser: "Nothing waiting"; flags.escalation renders only inside the call detail (record-only, ingest.ts header) | OK |
| `?view=spam` / `?view=escalations` / `?call=` | URL | Deep links: sub-view and open call sheet. Kept in the URL without navigation. | calls.tsx:40-52, 55-64 | — | Browser: all three verified | OK |

## Call detail sheet (`calls-detail.tsx`)

Sheet `sheet-call-detail`, opened by any call row or `?call=<id>`.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title / `text-call-detail-title`, `text-call-detail-no` | Header | "Call #N", caller name (or number), outcome pill ("In progress" when none). | calls-detail.tsx:35-39 | GET /api/crm/voice/calls/:id → calls.ts:185 → voice_calls row by org+id (404 otherwise) | Browser: "Call #1 AUDIT-Caller One Lead"; #2 spam | OK |
| Subtitle line | Text | When · length · from · to (number label) · answered by (persona). | calls-detail.tsx:40-43 | same row (+voice_numbers for the label) | Browser: "… · 2m 10s · from (555) 019-9001 to … · answered by Janice" | OK |
| Recording player / `audio-call-recording` | Audio | Streams the WAV from the app (never a public URL). Shown only when a recording exists. | calls-detail.tsx:54-59 | GET /api/crm/voice/calls/:id/recording → calls.ts:214 → R2 via recordings.ts, Range support | Code only: no recording in dev (R2 unconfigured — 503 by design) | OK |
| `link-call-customer` / `link-call-project` | Buttons | Link to the CRM client / project the call became. | calls-detail.tsx:61-74 | crmCustomers / crmProjects joined org-scoped (calls.ts:191-198); routes exist (App.tsx:396,409) | Code only (null in dev) | OK |
| Ingest section / `section-call-ingest`, `text-call-ingest-lead`, `text-call-ingest-escalation` | Section | For pushed calls: "Answered by Janice on the FL line", her raw outcome, the estimate form # and the escalation text she sent — record-only context. | calls-detail.tsx:76-89 | flags.ingest written by ingest.ts `toRow` (ingest.ts:117-125) | Browser: all three lines correct for call #1 | OK |
| Summary / `text-call-summary` | Text | The call's summary paragraph. | calls-detail.tsx:91-96 | voice_calls.summary | Browser | OK |
| Spam/blocked banner | Notice | "Rejected before answering — this number is blocked." or "Flagged as spam — nobody was notified…" with reason and confidence. | calls-detail.tsx:98-103 | voice_calls.spam_reason, spam_confidence | Browser: shown on call #2 (reason empty for ingested — renders just the headline) | OK |
| "What was collected" / `list-call-slots` | DL | The intake slots (need, address, …, best time) in order; phone values formatted. | calls-detail.tsx:105-117 | voice_calls.slots | Code only (null for ingested calls — they keep their data in summary/transcript) | OK |
| Escalations / `list-call-escalations` | List | EscalationRow for each escalation tied to this call. | calls-detail.tsx:119-126 | listEscalations by callId (calls.ts:203) | Code only (none in dev) | OK |
| Transcript / `list-call-transcript` | List | Caller/assistant/system turns; "assistant" is labelled with the persona's name. | calls-detail.tsx:129-145 | voice_calls.transcript (roles normalized by ingest.ts:86) | Browser: 2 turns, roles caller/assistant correct | OK |
| Reference line / `text-call-reference` | Text | Call #N · call SID · model · profile version — support reference. | calls-detail.tsx:147 | voice_calls.call_sid, model, profile_version | Browser: "Call #1 · Reference AUDIT-CA-20261004-001" | OK |
| `error-call-detail` | Error state | 404/error while loading the sheet. | calls-detail.tsx:45-50 | — | Code only | OK |

## Escalation row (`EscalationRow`, `calls-detail.tsx:159-201`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Kind badge + recipient + channel | Text | "Emergency" (kind label) to Mike via sms · sent 3×. | calls-detail.tsx:181-185 | presentEscalation (calls.ts:122) over voice_escalations | Code only (no rows) | OK |
| State pill / `pill-escalation-state-N` | Pill | waiting on … / confirmed / follow-up sent / closed — reason. | calls-detail.tsx:171-178, 185 | state derived from confirmed_at/followup_sent_at/closed_at | Code only | OK |
| Reply / last error lines | Text | The person's reply, or the last send failure. | calls-detail.tsx:187-188 | voice_escalations.reply_text, last_error | Code only | OK |
| "Mark handled" / `button-escalation-close-N` | Button | Closes the escalation; invalidates escalation queries. Any member may (the paged teammate often lacks manageSettings). | calls-detail.tsx:191-193 | POST /api/crm/voice/escalations/:id/close → calls.ts:304 → escalations.ts `closeEscalation` (sets closed_at with reason) | Code only — cannot create an escalation without triggering AI generation (forbidden); endpoint shape matches | UNCLEAR |
| "Open the call" / `button-escalation-call-N` | Button | Opens the linked call in the detail sheet. | calls-detail.tsx:194-196 | client only | Code only | OK |

## `calls-shared.ts` — shared formatters (client-only)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| OUTCOME_LABELS / outcomeLabel / outcomeTone | Maps | Outcome → pill text and tone (Lead/Booked green, Escalated amber, spam/blocked/error red, …). Unknown outcomes render as their raw name; null = "In progress". | calls-shared.ts:106-143 | — | Browser pills | OK |
| fmtPhone | Formatter | "+18135550100" → "(813) 555-0100"; non-US returned raw, empty → "Unknown number". | calls-shared.ts:146-150 | — | Browser | OK |
| fmtDuration | Formatter | Seconds → "2m 10s" / "45s"; null → "—". | calls-shared.ts:152-157 | — | Browser | OK |
| parseServerTime / fmtWhen | Formatter | Server sends UTC wall time without a zone; parse as UTC, show in the viewer's local time ("Today 4:05 PM"). | calls-shared.ts:159-177 | — | Browser (call times) | OK |

---

## BUG notes (see `bugs-ca.md` for full entries)

- **Assistant tile "last call" date** (`metric-overview-assistant`): `externalReceptionist` built `lastCallAt`
  with `new Date(rawString)` — local-zone parse on a UTC wall string. Live evidence: a call that started
  2026-10-04T23:20Z was served as `2026-10-05T03:20:00.000Z` (+4 h on the EDT dev box). **Fixed** in
  `server/voice/ingest.ts` + regression assertion in `server/voice/ingest.test.ts`.
- **Recent calls excludes spam** (`list-overview-calls`): the overview's "every call shows here" list silently
  omits spam/blocked calls (server default for `/calls`). For a spam-heavy outside-receptionist org the
  overview can say "No calls yet" while "Spam stopped this month" > 0. Not fixed (product call).
- **Mixed-engine tiles** (latent): if our own assistant is published AND an outside receptionist pushes calls,
  the overview minutes/spam tiles read the meter only (external branch requires `!ownLive`) while Results and
  the Spam view count meter+external — the 7e2512b disagreement returns in that configuration. Not fixed
  (owner decision on labelling/billing semantics).
- **"Rejected before answering"** (`text-spam-rejected`, latent): counts only the meter's blocked calls;
  an outside receptionist's `blocked` outcome calls count in "Spam stopped" but never here. Same family; not fixed.
