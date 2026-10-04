# UI map — lane 1 (Kimi): Call Assistant, platform shell, home dashboard, settings, small pages

Element-by-element audit of every page in lane 1, 2026-10-04. Each section below was produced
by an audit agent that read the page code, pressed what was safe to press, and recomputed every
number against the dev database (constructhub_dev_a6) with independent SQL. Statuses: OK / BUG /
UNCLEAR / DEAD. See BUGS.md in the lane dir for the bug list and REPORT.md for the summary.

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

# Lane 1 · audit/1 — Call Assistant: Numbers + Simulator (audit agent "num")

Dev server: http://127.0.0.1:8301 (portal mode, dev platform admin user 1, pinned org = "SKU Dry-Run" c5b47b8d).
DB: `constructhub_dev_a6`. Facts established first: `voice_numbers` has **0 rows** (whole DB); owner subscription
user 1 = plan `standard`/active, addons `{}` — the Numbers API's `allowance.numbers = 5` is the platform-admin
ceiling `ADMIN_CALL_ASSISTANT_NUMBERS` (server/entitlements.ts:139), not a tier. Server has **no SignalWire
credentials and VOICE_NUMBERS_MOCK is off** → API says `configured:false, mock:false`; the number-release sweep
worker is OFF (server/voice/index.ts:46 logs it; number-release.ts:445 — not production, flag unset). Both facts
match what the UI shows.

Route check: client/src/App.tsx:206 `/call-assistant` → CrmCallAssistantPage (portal); :309 marketing landing;
:401-402 redirect the old /crm/call-assistant path. Tabs: client/src/pages/crm-call-assistant/index.tsx:42-44
(`numbers`, `simulator` exist), panels wired at :187 (NumbersPanel, `canManage` = `me.permissions.manageSettings`)
and :199 (SimulatorPanel). Deep links `?tab=numbers` / `?tab=simulator` verified live in the browser.

## /call-assistant?tab=numbers — Numbers tab (client/src/pages/crm-call-assistant/numbers.tsx)

Host query: `GET /api/crm/voice/numbers` (react-query default GET of key `NUMBERS_KEY`, client/src/lib/queryClient.ts:83).
Response shapes: `NumbersResponse` (numbers-shared.tsx:41-53). Rows render only when `status !== "released"`; the
released ones go in the `<details>` at the bottom. `manage = canManage && d.canManage && !d.paused` (numbers.tsx:62) —
when a payment fails the whole tab goes read-only and the server also refuses writes (402, server/voice/context.ts:57-67).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "0 of 5 numbers in use" (text-voice-numbers-allowance) | stat | Says how many of the allowed numbers this workspace currently holds. | numbers.tsx:72-74 | GET /api/crm/voice/numbers → server/voice/numbers.ts:244 GET handler → `allowance.used` = rows with status IN (pending,active,releasing) minus final-release rows (heldNumberCount, numbers.ts:139-145; countsAgainstAllowance, :134-137) on voice_numbers (org_id = current org). No time window. | SQL (0 rows) + curl 200 + browser | OK |
| "…included with your tier; more are $5/mo each…" | hint | Explains how many numbers the tier includes and the add-on price. | numbers.tsx:75-77 | Same GET → allowance.includedNumbers (= allowance.numbers − addons.call_number), extraNumberMonthlyCents = ADDONS.call_number.monthlyCents (500) from shared/plans.ts:358-363 | curl 200 (`includedNumbers:5, extraNumberMonthlyCents:500`) | OK |
| "Mock carrier — not real numbers" badge (badge-voice-numbers-mock-list) | badge | Shown only when the dev/mock carrier is on, so nobody mistakes fake numbers for real. | numbers.tsx:80 | Same GET → `mock` = numbersMockEnabled() (numbers.ts:75; env VOICE_NUMBERS_MOCK) | curl 200 (`mock:false`) — correctly absent on dev | OK |
| "Add a number" button (button-voice-number-add) | button | Opens the buy wizard (state → pick → details). Hidden when the carrier isn't connected, the tier is full, or the user can't manage settings. | numbers.tsx:81-83 → numbers-buy.tsx:26 | Opens wizard only; first real call is the wizard's search: GET /api/crm/voice/numbers/search (below) | browser — absent on dev because `configured:false`; code for open state | OK |
| "How numbers work" disclosure + 3 rules (text-voice-numbers-rule-own / -cancel / -payment) | details/list | Static house rules: you keep your own number and forward it; cancelling releases the assistant number; a failed payment pauses the assistant but the number is held while the card is retried. | numbers.tsx:89-94; copy shared/plan-copy.ts:280-284 | Client only (static copy). The payment rule matches the server hold rule: numbersKeptFor (server/voice/number-release.ts:107-137) keeps numbers for past_due (7e2512b); only `unpaid` releases. | browser (all 3 lines) + code | OK |
| "Numbers can't be bought on this server yet" banner (card-voice-numbers-unconfigured) | banner | Warns that the phone carrier isn't connected here; nothing can be charged. | numbers.tsx:98-105 | Shown when GET /numbers → `configured:false` = no SignalWire env and mock off (numbers.ts:257) | browser + curl 200 | OK |
| "Every number your tier includes is in use" card (card-voice-numbers-full) + "Open billing" link (link-voice-numbers-billing) | card + link | Shown at the allowance ceiling; links to Settings → Billing to add the extra-number add-on. Link href `/settings?tab=billing` exists (App route verified by pattern used across the app; the route table has /settings). | numbers.tsx:107-120 | Client only; the server independently refuses a buy past the ceiling with 402-style limit_reached (numbers.ts:291,308 limitBody) | code only (dev org is at 0/5 so the card is correctly not rendered) | OK |
| "No numbers yet" empty state (viewer-only) | empty state | Tells a non-manager that only managers can buy/release. | numbers.tsx:122-124 | Client only; shown when `!manage && shown.length === 0` | code only (dev user is a manager, so this branch not renderable here) | OK |
| Buy wizard (card-voice-number-buy) — see next section | wizard | 3-step buy flow. Not reachable on this dev server (carrier unconfigured hides the entry). | numbers.tsx:126-133 → numbers-buy.tsx | — | code only (endpoints exercised via curl below) | OK |
| Number row card (card-voice-number-<id>) — phone, pill, badges, label line, dates line | card per number | One card per held number: the number, a status pill (Active/Setting up/Releasing/Released/Not confirmed), "Test number"/"Mock" badges, label·location·forwarded-from, and "Bought … · can be released … · $5/mo extra number | included". | numbers.tsx:135-186; pill numbers-shared.tsx:92-103 | GET /numbers → numberView (numbers.ts:184-197) on voice_numbers row (label, location, forwarding_from, monthly_cents snapshot, purchased_at, release_eligible_at, releasable = active && release_eligible_at ≤ now) | SQL 0 rows + browser (no list rendered) | OK |
| "Not answering calls: being released because …" line (text-voice-number-releasing-<id>) | notice | On a releasing row: why it's going back and the date it returns to the carrier. | numbers.tsx:158-164 | Same GET → release_reason → releaseReasonText (number-release.ts:91-98: addon_removed / over_allowance / payment_failed / subscription ended) | code only (no rows on dev) | OK |
| last-error line (text-voice-number-error-<id>) | notice | Shows the carrier error on a row whose release/purchase failed. | numbers.tsx:165 | Same GET → voice_numbers.last_error | code only | OK |
| "Edit" button (button-voice-number-edit-<id>) + dialog inputs Label/Location/"Line forwarded to it" + Cancel/Save (input-voice-number-edit-label/-location/-forwarding-from, button-voice-number-edit-save) | button + dialog | Edits the row's label, location and the caller's line that forwards to it. Save sends PATCH with all three fields; a non-US forwarding number is refused. | numbers.tsx:167-171, 229-268 | PATCH /api/crm/voice/numbers/:id → numbers.ts:341 → UPDATE voice_numbers SET label/location/forwarding_from (forwardingFrom run through toE164, 400 if not a US number; "constructhub-test" label reserved). WHERE id AND org_id AND status ≠ 'released' | curl PATCH on unknown id → 404; shape matches; write path not pressable (no rows) | OK |
| "Release" / "Dismiss" button (button-voice-number-release-<id>) | button | Release (active rows, disabled until the carrier's 14-day minimum passes; tooltip names the date) asks confirmation, then gives the number back to the carrier. Dismiss (failed rows) removes an unfinished purchase without calling the carrier. | numbers.tsx:172-179, 201-224 | DELETE /api/crm/voice/numbers/:id → numbers.ts:364 → released row: UPDATE status 'releasing' → carrier release(provider_sid) → UPDATE status 'released', released_at=now (numbers.ts:395-399); failed/stale-pending row: DELETE row, `{dismissed:true}` (:373-377); too early → 409 code too_early with the date (:386-392) | curl DELETE unknown id → 404; full flow code-only (would release a real carrier number — never pressed); UI disabled/tooltip logic matches server minDays=14 | OK |
| "…released number(s)" <details> (details-voice-numbers-released) | details | Collapsible history of released numbers with the date. | numbers.tsx:188-195 | Same GET (rows with status='released' filtered out of the main list, collected here) | browser — absent (0 rows) | OK |
| Forwarding card (card-voice-forwarding) | card | "Forward your existing line": instructions per carrier with the chosen assistant number filled into the star codes. | numbers.tsx:197 → numbers-forwarding.tsx | GET /numbers → forwarding.carriers / forwarding.advice = static FORWARDING_CARRIERS + FORWARDING_ADVICE (numbers.ts:51-67) | browser — 9 carriers, advice, empty-state text all render | OK |
| — "Buy a number first" empty text (text-voice-forwarding-none) | empty state | Without an active number the steps can't fill in, and the card says so honestly. | numbers-forwarding.tsx:49-50 | client only | browser (text present) | OK |
| — Number picker (select-voice-forwarding-number) / "Forward to (xxx) xxx-xxxx" (text-voice-forwarding-number) | select / text | Chooses which active number the instructions fill in. Shown only when ≥2 active numbers. | numbers-forwarding.tsx:25-28, 53-62 | client only (filters numbers[] to status='active') | code only (0 numbers on dev) | OK |
| — "Copy digits" button (button-voice-forwarding-copy) | button | Copies the chosen number without the "+1" so it can be pasted into a star code. | numbers-forwarding.tsx:31-38, 63-66 | client only (navigator.clipboard) | code only (no number to copy on dev) | OK |
| — "Before you forward" disclosure | details | Three tips from the server (start with no-answer forwarding, test-call yourself, keep the old number on your ads). | numbers-forwarding.tsx:70-72 | static FORWARDING_ADVICE (numbers.ts:63-67) | browser (renders) | OK |
| — 9 carrier accordions (forwarding-carrier-att/-verizon/-tmobile/-spectrum/-xfinity/-googlevoice/-callrail/-tollfree/-other) | accordion | Per-carrier forwarding steps; "<assistant number>" is replaced with the picked number's digits. With no active number the placeholder stays literal (the empty-state text above explains why). | numbers-forwarding.tsx:74-87 | static copy (numbers.ts:51-61) | browser — all 9 render; AT&T steps show the literal placeholder pre-purchase | OK |

## /call-assistant?tab=numbers — Buy wizard (client/src/pages/crm-call-assistant/numbers-buy.tsx)

Not openable on this dev server (entry button hidden, `configured:false`). Every endpoint below was exercised
directly; none writes anything here (search 503s before any carrier call; buy 503s before its DB transaction —
`voice_numbers` still 0 rows afterwards; verified by SQL).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Step 1 of 3 — where your callers are" | text | Wizard progress line. | numbers-buy.tsx:82-84 | client only | code only | OK |
| State select (select-voice-number-state, option-voice-number-state-*) | select | Picks the state to search in; the 50 states + DC, exactly the codes the server accepts. | numbers-buy.tsx:91-98 | GET /api/crm/voice/numbers/search validates isUsStateCode (numbers-signalwire.ts:19) | curl state=XX → 400 "Pick a US state"; WA → 503 signalwire_unconfigured (no creds, nothing bought) | OK |
| Area code input (input-voice-number-area-code) + "An area code is three digits." | input | Optional 3-digit filter; digits only, client-validated, server re-validates. | numbers-buy.tsx:99-105 | same GET → 400 on non-3-digit (numbers.ts:227) | curl + code | OK |
| City input (input-voice-number-city) | input | Optional city filter (max 60 chars). | numbers-buy.tsx:106-109 | same GET → `city` param, str(...,60) (numbers.ts:234) | code | OK |
| "Find numbers" button (button-voice-number-search) | button | Asks the carrier for up to 10 candidates and moves to the pick step. | numbers-buy.tsx:48-55, 115-117 | GET /api/crm/voice/numbers/search?state&limit=10[&areaCode][&city] → numbers.ts:221 → SignalWire AvailablePhoneNumbers (or mock client); on paused subscription → 402 payment_needed (:231) | curl → 503 signalwire_unconfigured on dev; shape matches | OK |
| "Cancel" button (button-voice-number-cancel) | button | Closes the wizard (only shown when the org already has numbers). | numbers-buy.tsx:118 | client only | code only | OK |
| Search loading / error / none states | states | Spinner while asking the carrier; the carrier's error verbatim; "No numbers available there right now" when empty. | numbers-buy.tsx:125-132 | same GET | curl 503 body matches apiErrorMessage rendering | OK |
| Price line (text-voice-number-price) | text | Says whether the next number is included in the add-on or would bill $5/mo as an extra. | numbers-buy.tsx:135-139 | same GET → `monthlyCents` = nextNumberMonthlyCents(v, held) (numbers.ts:153-155: 0 while under the included count, else ADDONS.call_number.monthlyCents) | curl field present; value code-verified | OK |
| Candidate radios (option-voice-number-<phone>, up to 10) | radio | Pick one of the offered numbers; each shows locality/region and "can text". | numbers-buy.tsx:140-152 | same GET → numbers[] (phoneNumber, locality, region, capabilities) | code only (503 on dev, no candidates) | OK |
| "Change area" (button-voice-number-back) / "Use this number" (button-voice-number-next) | buttons | Back to step 1; "Use this number" pre-fills the location and goes to the details step (disabled until one is picked). | numbers-buy.tsx:155-158 | client only | code only | OK |
| Chosen number line (text-voice-number-chosen) | text | Recaps the picked number and locality. | numbers-buy.tsx:164-167 | client only | code only | OK |
| Label / Location / "Line you'll forward" inputs (input-voice-number-label/-location/-forwarding-from) | inputs | Optional name and place for the number, and the caller's line to forward; forwarding must be a US number. | numbers-buy.tsx:168-181 | POST body { phoneNumber, label?, location?, forwardingFrom?, state, locality } → numbers.ts:266 → toE164 validation (400 otherwise), INSERT voice_numbers (status 'pending') under an org advisory lock, then carrier purchase; failure paths mark 'failed' or delete the reservation (:315-330); success → status 'active', provider_sid, purchased_at, release_eligible_at = purchased + 14 days (:332-337) | curl POST fake number → 503 signalwire_unconfigured before any write; SQL still 0 rows; never pressed a real buy (would provision a carrier number) | OK |
| minDays copy ("The carrier keeps a number for at least 14 days…") + mock note | text | Sets the expectation that a number can't be released for 14 days. | numbers-buy.tsx:182-186 | CALL_NUMBER_MIN_DAYS = 14 (shared/plans.ts:367); enforced by DELETE too_early (numbers.ts:386-392) | code (values match) | OK |
| "Back" (button-voice-number-back-pick) / "Buy (xxx) xxx-xxxx" (button-voice-number-buy) | buttons | Back to picking; Buy purchases the number, then hands it to the forwarding instructions. | numbers-buy.tsx:187-193 | POST /api/crm/voice/numbers (above) → 201 { number, mock }; the wizard then closes and the forwarding card scrolls to the new number (justBought, numbers.tsx:130,197) | code only + curl 503 path | OK |
| "Mock carrier" badge (badge-voice-numbers-mock) | badge | On a dev/mock server, marks the wizard as fake so nobody thinks a real number was bought. | numbers-buy.tsx:80 | POST/search `mock` flag = numbersMockEnabled() | curl `mock:false` on dev — badge correctly absent | OK |

## /call-assistant?tab=numbers — Release/dismiss semantics (server truth vs UI)

The DELETE route is the one destructive button on these pages; it was verified by code and by safe curls
(unknown id → 404), never pressed against a real row (no AUDIT- creatable — buying provisions a carrier number).

- `active` row, past 14 days → UI "Release" enabled → DELETE → row 'releasing' → `carrierForRow(row).release(providerSid)`
  (the carrier is chosen by the ROW's provider, never the env — numbers.ts:116-118, so a mock row can't release a
  real one) → row 'released' with released_at. Failure → row back to 'active' with last_error shown by the UI. **UI matches.**
- `failed` row (or `pending` stale > 10 min) → DELETE deletes the row, `{dismissed:true}`, no carrier call —
  the UI's "Remove this unfinished purchase" dialog says exactly this. **UI matches.** (Gap: the UI only offers
  Dismiss on `failed`; a stale-`pending` row has no button at all — reported in bugs-num.md, low.)
- `releasing` with a scheduled reason → 409 release_scheduled with the date; `pending`/`releasing` otherwise → 409 busy.
- `active` inside 14 days → UI disables the button with the date in the tooltip; server 409 too_early with the same date. **Match.**
- Number-release sweep worker: OFF on this dev server (not production, flag unset) — nothing to sweep; `voice_numbers` is empty.

## /call-assistant?tab=simulator — Simulator (client/src/pages/crm-call-assistant/simulator.tsx)

Host queries: `GET /api/crm/voice/profile` (PROFILE_KEY — gate + first-run hint + source select), then
`POST /api/crm/voice/simulator/session`, `POST …/turn`, `DELETE …/session/:id`. Backend on this server: the in-app
brain (VOICE_SIM_BACKEND unset → "app", simulator.ts:48-50); sessions live in process memory (30-min TTL, max 6/org,
simulator.ts:29-30,109-111). A turn is a paid model call, capped at 150/org/hour (SIM_TURNS_PER_HOUR, simulator.ts:33).
The UI was run for real: Start call → greeting rendered → Hang up → "Call ended — outcome: hangup." No turn was ever
sent (that would invoke the AI — verified by code instead). Nothing the Simulator does touches the CRM or sends anything.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Plan-required gate (panel wraps CallAssistantPlanRequired) | gate | If the workspace doesn't have the Call Assistant add-on (402 plan_required), the tab shows a "buy it" prompt instead of the simulator. | simulator.tsx:86-87; plan-required.tsx:28-38 | GET /api/crm/voice/profile through voiceContext → 402 plan_required when the module is missing (server/voice/context.ts:58-61) | curl status 200 (module present for dev admin) → gate not renderable here; mapping code-verified | OK |
| "Finish the setup in Agent Studio first" hint (text-simulator-no-profile) | hint | Shown when the profile was never published and setup never completed: the draft may be incomplete. | simulator.tsx:96; isFirstRun voice-studio.ts:156-159 | GET /api/crm/voice/profile → publishedVersion==null && !setupCompletedAt | browser — present (org profile is an unpublished draft) | OK |
| "Run against" select (select-simulator-source) | select | Picks which compiled profile the simulated call runs: the published one or the current draft. "Published" is disabled when nothing is published; with nothing published the select silently starts on Draft. | simulator.tsx:45-47, 99-107 | POST /api/crm/voice/simulator/session body { useDraft } → simulator.ts:92, compiledFor (:70-80): draft = previewDraft compile of voice_profiles/voice_profile_versions; published = publishedState, 409 code unpublished/paused otherwise | browser — options "Published (nothing yet)" (disabled) + "Draft (unpublished edits)"; curl useDraft:false → 409 unpublished | OK |
| "Caller number (optional)" input (input-simulator-caller) | input | Lets the assistant greet a known client by name, as on a real call; must be a phone number. | simulator.tsx:108-111 | POST session body { callerNumber? } → zod regex ^\+[1-9]\d{6,14}$ (simulator.ts:61); a matched CRM customer is attached via callerStatus (profile-store) — no CRM write | browser (renders); valid "+13605550142" path code-verified; invalid input rejected 400 — generic message nit reported in bugs-num.md | OK |
| "Start call" button (button-simulator-start) | button | Starts a simulated call: compiles the chosen profile, creates an in-memory session, shows the assistant's greeting. Disabled while the profile loads or when "Published" is picked with nothing published. | simulator.tsx:85, 112-115 | POST /api/crm/voice/simulator/session → simulator.ts:92-118 → 200 { sessionId, greeting, compiledVersion, backend, draft } (greet() is the compiled greeting — no AI call) | browser — pressed for real: greeting "Thank you for calling SKU Dry-Run, this is Janice…" | OK |
| Start-call error line (text-simulator-error) | error | Shows why a call couldn't start (engine down, unpublished, paused, rate limit, plan gate) — never a fake reply. | simulator.tsx:117, 49-54 | 503 voice_engine_unavailable (engine backend), 409 unpublished/paused, 429 rate_limited, 402; mapped by simulatorErrorText (voice-studio.ts:110-122) | code (mappings read); no error triggered live | OK |
| Source badge (badge-simulator-source) + session id | badge/text | "Draft" or "Published vN" for the running session, plus its short id. | simulator.tsx:124-126 | from the session response (compiledVersion, sessionId) | browser — showed "Draft" | OK |
| "Hang up" button (button-simulator-end) | button | Ends the simulated call; the server summarizes it (outcome, turns, lead/alert flags). | simulator.tsx:128, 78-82 | DELETE /api/crm/voice/simulator/session/:id → simulator.ts:162-177 → brain.report() summary, row dropped from memory (nothing in the DB) | browser — pressed: "Call ended — outcome: hangup."; curl on unknown id → 200 {ended:true, summary:""} | OK |
| "New call" button (button-simulator-reset) | button | Clears the chat on the screen only; the old server session just expires by itself. | simulator.tsx:129, 83 | client only (no request) | browser — worked | OK |
| Message log (simulator-log, simulator-message-<i>) + "thinking…" | chat | Shows each caller line and the assistant's reply; per reply it badges the brain's decision. | simulator.tsx:132-153 | POST /api/crm/voice/simulator/turn { sessionId, text } → simulator.ts:121-150 → Brain.respond (the ONLY AI-touching call on these pages — not pressed; verified by code) | browser (greeting message); turn code-only | OK |
| Per-decision badges: action (simulator-action-<i>), "Alert: …", "Spam NN%", "Fallback line" (simulator-fallback-<i>) | badges | What the brain decided: continue/end_call/…, an escalation alert, a spam verdict, or that the model's answer was unusable and it asked the caller to repeat. | simulator.tsx:139-146 | turn response fields action/alert/spam/fallback (TurnResult, server/voice/brain.ts) | code only (needs a turn) | OK |
| "Call ended — outcome: …" line (text-simulator-ended) | text | Confirms the call is over and names the outcome (hangup, …). | simulator.tsx:153 | ended state from turn response or DELETE summary | browser — showed after Hang up | OK |
| Text input (input-simulator-text) + Send button (button-simulator-send) | input + button | Types the next caller line and sends it. Input locks while the assistant thinks; both lock once the call ended. | simulator.tsx:155-158 | POST /api/crm/voice/simulator/turn (above) | browser — both correctly disabled after Hang up; send not pressed (AI) | OK |
| "Last decision" panel (simulator-last-action) + alert/spam summary | panel | The most recent decision's action label, with its alert or spam reason. | simulator.tsx:163-168 | same turn response | browser — panel present, "—" before any turn | OK |
| "Slots collected" panel (simulator-slots / simulator-slot-<k>) | panel | Intake answers the assistant has gathered so far (name, address, need, …). | simulator.tsx:169-181 | turn response slots, merged client-side (mergeSimulatorEvents/slots, voice-studio.ts) | browser — "Nothing yet." | OK |
| "Events" panel (simulator-events) | panel | Things that happened during the call (lead submitted, alert raised, …). | simulator.tsx:182-189 | turn response events[], merged client-side | browser — "None." | OK |
| "Nothing here reaches your CRM or pages anyone — the Simulator is a sandbox." | note | Honest sandbox note; matches the server (no CRM writes, no notifications). | simulator.tsx:190 | sessions are process-memory only; callerStatus is a read | code + browser | OK |

## Cross-checks against the audit's bug shapes

- **Label vs source**: "in use" counts the same `voice_numbers` rows the list renders (modulo released/final-release
  exclusions, both from one query). No second source anywhere on these pages.
- **Hard-coded fallbacks**: none found — every number on these pages comes from the API or is honestly static copy
  (rules, forwarding steps). `formatDate`/`formatPhone` pass through unknown shapes rather than inventing values.
- **Routes**: every link (`/settings?tab=billing`, `/call-assistant?tab=…`) and every endpoint the buttons call exists
  with the same method and body the server parses.
- **Toggle/save mismatch**: no toggles on these pages; the Edit dialog saves exactly the three fields the PATCH reads.
- **Worker note**: the number-release sweep (which would flip 'releasing' rows to 'released' and could restore some)
  is OFF on dev — consistent with an empty table; flagged in the map so nobody "verifies" it here.
- **past_due holding (7e2512b)**: the only UI surface about it on these pages is the rules line "the number is held
  while the payment is retried" and the `paused` read-only state — both match `numbersKeptFor` (past_due → held) and
  `modulePaused` (writes 402). Nothing on these pages claims a count that past_due would change.

# Lane 1 · 03 — Call Assistant Agent Studio (`/call-assistant?tab=studio`)

Audit 2026-10-04, agent "studio", worktree ConstructHUB-audit1 (branch audit/1).
Dev server 8301, signed in as dev platform admin (user 1, org `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` "SKU Dry-Run").
The org's `voice_profiles` row is a never-published draft (`status='draft'`, `published_version=NULL`, `setup_completed_at=NULL`), so the tab opens in the **setup wizard**; "Skip to the editor" reaches the advanced editor. All section fields edit one JSON document (`VoiceProfile`, shared/voice-profile.ts) that is written by **PUT /api/crm/voice/profile** into `voice_profiles.profile` (jsonb) and returned byte-identical by GET (verified live: `profile equal: True` against SQL). AI generation is never triggered by this page: publish/compile is the pure function `compileVoiceProfile` (server/voice/prompt-compiler.ts), verified by code + `server/voice/profile.test.ts`.

Every backend route below goes through `voiceContext` (server/voice/context.ts): 401 → org membership → callAssistant add-on on the org OWNER's subscription (402 `plan_required` when not bought; 402 `payment_required` when past-due — reads stay open, writes are refused) → `manageSettings` permission (403) on writes.

---

## StudioPanel shell — `client/src/pages/crm-call-assistant/studio.tsx`

Decides wizard vs editor from GET /api/crm/voice/profile.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Loading your assistant…" / `studio-loading` | Loading state | Spinner while the profile is fetched. | studio.tsx:27 | GET /api/crm/voice/profile → server/voice/profile.ts:219 → voice_profiles (org row, created from crm_orgs fields on first access by profile-store.ts:getOrCreateProfile) | code only | OK |
| Plan-required panel (`plan-required-callAssistant`) | Error state | Shown when the profile GET answers 402 (add-on not bought / payment needed); links to Billing. | studio.tsx:28-29 | same GET — 402 body `{code: plan_required\|payment_required}` from context.ts | code + e2e spec "without the add-on" | OK |
| "Couldn't load the assistant" / 501 empty state | Error state | Shown on other load errors (501 = studio backend not wired). | studio.tsx:30-37 | same GET | code only | OK |
| "Your assistant hasn't been set up yet" empty state | Empty state | First-run org + user without manageSettings: explains only owners/admins can run the setup. | studio.tsx:40-46 | client only (canManage from /api/crm/me `permissions.manageSettings`) | code + e2e "members without manageSettings" | OK |
| Wizard ↔ editor switch (`isFirstRun`) | Routing logic | First run = never published AND setup never completed → wizard; otherwise editor. | studio.tsx:39, lib/voice-studio.ts:156-159 | GET /profile fields `publishedVersion`, `setupCompletedAt` (voice_profiles.published_version, setup_completed_at) | live (draft org → wizard shown), SQL | OK |

## Setup wizard — `client/src/pages/crm-call-assistant/studio/wizard.tsx`

10 steps (company, services, serviceArea, credibility, offers, policies, persona, intake, delivery = leadDelivery+escalations, review). Every **Next** PUT-saves the whole draft; the review step blocks Publish until `studioIssues` (client mirror of the server zod schema, lib/voice-studio.ts:257-290) is empty.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Set up your assistant" header | Static text | Intro. | wizard.tsx:65 | — | live screenshot | OK |
| "Skip to the editor" / `button-wizard-skip` | Button | Leaves the wizard and opens the advanced editor with the current draft. | wizard.tsx:68 | client only | live — see BUG-1 (was stale; fixed) | OK |
| Step chips ×10 / `wizard-step-<id>` | Stepper | Shows progress; click past step → jump (validates + saves the current step first); ✓ / ⚠ / number per state; a failed save paints the chip red (`data-save-failed`). | wizard.tsx:71-89 | PUT /api/crm/voice/profile on forward moves | live (validation toast seen; save verified in SQL) | OK |
| Step issues panel / `wizard-step-issues` | Inline errors | Lists this step's blocking problems (plain words) while you edit. | wizard.tsx:98-102 | client only (mirrors shared/voice-profile.ts schema) | live | OK |
| "Back" / `button-wizard-back` | Button | Previous step (no save). | wizard.tsx:107 | client only | live | OK |
| "Saving…" indicator | Status text | Spinner text while a step save is in flight. | wizard.tsx:109 | — | live | OK |
| "Next" / `button-wizard-next` | Button | Validates the step, PUT-saves the draft, then advances. Failed save → stays, red chip. | wizard.tsx:115, 42-59 | PUT /api/crm/voice/profile → profile.ts:227 → voice_profiles.profile (+updated_at/updated_by_member_id) | live: SQL showed saved value | OK |
| "Publish and go live" / `button-wizard-publish` | Button | Saves, then publishes: POST /profile/publish `{note:"Initial setup", setupCompleted:true}` → server validates, compiles (pure), writes voice_profile_versions (version=max+1), copies draft to published_profile+compiled, status 'live', stamps setup_completed_at. No AI call. Then opens the editor. Disabled while any issue remains. | wizard.tsx:111-113, 36-40 | POST /api/crm/voice/profile/publish → profile.ts:259 → profile-store.ts:publishProfile → voice_profile_versions INSERT + voice_profiles UPDATE | code + server vitest "setup wizard merges…" + e2e fixture (badge v1) | OK |
| Review summary rows ×11 / `review-row-<section>-<i>` | Read-only rows + jump | One line per area ("What the assistant will know"); click jumps to the step that edits it. | wizard.tsx:125-160 | client only | live screenshot; escalations row fixed (BUG-3) | OK |
| Review issues list / `wizard-review-issues` | Inline errors | Every remaining blocking issue, click → jump to its step. | wizard.tsx:144-150 | client only | e2e fixture (`toHaveCount(0)` when clean) | OK |
| "Next: Publish, then try it in the Simulator" badge | Hint | Points at the Simulator tab (route exists: /call-assistant?tab=simulator). | wizard.tsx:161 | client only | route check in index.tsx | OK |

## Editor — action bar, nav — `client/src/pages/crm-call-assistant/studio/editor.tsx`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Status badge / `badge-studio-status` | Status pill | draft / live / paused — the profile's state. | editor.tsx:94 | GET /profile `.status` = voice_profiles.status ('draft'→'live' on publish, 'paused' via /pause) | live ("draft"), e2e (live/paused) | OK |
| "v<N>" badge / `badge-studio-version` | Badge | The published version number; hidden until the first publish. | editor.tsx:95 | GET /profile `.publishedVersion` = voice_profiles.published_version | e2e fixture (v1→v2) | OK |
| "Unsaved changes" / "All changes saved" / `text-studio-dirty` | Status text | Compares the open draft to what the server last returned. | editor.tsx:96, 41 | client only | live | OK |
| "<n> to fix before publishing" / `text-studio-issues` | Inline errors | Count of blocking problems (same rules the server enforces). | editor.tsx:97 | client only (studioIssues = friendly mirror of shared/voice-profile.ts zod schema) | live ("2 to fix"); e2e | OK |
| "Setup wizard" / `button-studio-wizard` | Button | Re-runs the setup wizard, seeded from the SAVED draft. Disabled while there are unsaved edits (they would be dropped silently — BUG-2, fixed). | editor.tsx:101 | client only | e2e regression test | OK |
| "Pause"/"Resume" / `button-studio-pause` | Button | Pauses the live assistant (callers hear a short message, call ends) or resumes. Only shown after a publish; 409 "Publish the assistant first." if never published. | editor.tsx:102-106 | POST /api/crm/voice/profile/pause|resume → profile.ts:276 → voice_profiles.status | live: 409 on unpublished org (no write, SQL unchanged); e2e fixture toggle | OK |
| "Save draft" / `button-studio-save` | Button | PUTs the whole draft; server re-validates (400 + plain issues on bad data); toast "Draft saved"; dirty flag clears. | editor.tsx:107-109 | PUT /api/crm/voice/profile → profile.ts:227 → voice_profiles.profile | live: SQL round-trip + reload | OK |
| "Publish" / `button-studio-publish` | Button | Opens the publish dialog (disabled while issues exist or a save is running). | editor.tsx:110 | (dialog → POST /profile/publish) | live (disabled state) | OK |
| "Read-only: only members who manage settings…" / `text-studio-readonly` | Note | Shown instead of the buttons when canManage is false. | editor.tsx:115 | client only (canManage from /api/crm/me) | e2e | OK |
| Section nav ×16 / `studio-nav-<id>` | Nav | 14 form sections + Prompt preview + Version history; ⚠ on sections with issues. | editor.tsx:70-88 | client only | live (all 16 clicked) | OK |
| Section select (mobile) / `select-studio-section` | Select | Same nav as a dropdown on small screens. | editor.tsx:118-126 | client only | e2e mobile test | OK |

## Editor — Prompt preview (`studio-nav-preview`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Refresh" / `button-preview-refresh` | Button | Re-runs the compile of the SAVED draft. | editor.tsx:161 | GET /api/crm/voice/profile/preview → profile.ts:288 → profile-store.ts:previewDraft → compileVoiceProfile(draft) (pure; version = next) | live (greeting/persona matched server draft) | OK |
| Unsaved-changes warning / `text-preview-dirty` | Banner | Reminds that unsaved edits are not in the preview. | editor.tsx:165 | client only | code only | OK |
| Stat tiles ×6 / `preview-persona`, `preview-intake`, `preview-spam`, `preview-silence`, `preview-limits`, `preview-compiled` | Stats | Persona voice, question count, spam thresholds, silence timing, turn/call caps, compile time+hash — all from the compiled output. | editor.tsx:172-179 | GET /profile/preview → compiled jsonb-shaped output (in-memory) | live (values matched defaults: Janice/af_heart, 6 questions, 40 turns, 900s) | OK |
| "Greeting" / `preview-greeting` | Compiled text | The exact first sentence the caller hears (default built from company+assistant name + recording notice). | editor.tsx:182 | same GET → prompt-compiler.ts:186-189 | live ("Thank you for calling …, this is Janice — calls may be recorded. …") | OK |
| "System prompt" / `preview-system-prompt` | Compiled text | The full instruction document the AI is given per call. | editor.tsx:186 | same GET | live + e2e fixture | OK |
| "Intake script" / `preview-intake-list` | Ordered list | The questions, in order, with slot keys and (optional) flags. | editor.tsx:190 | same GET | live (6 default keys) | OK |

## Editor — Version history (`studio-nav-versions`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Version rows / `list-versions`, `row-version-<n>` | List | One row per publish: v-badge (highlighted = live), note, date+author. | editor.tsx:234-244 | GET /api/crm/voice/profile/versions → profile.ts:302 → profile-store.ts:listVersions → voice_profile_versions (org-scoped, desc) + crm_members display name as `author`; `published` = (version == voice_profiles.published_version) | live: "Nothing published yet." on draft org; vitest asserts [version, note, published, author] vs DB; e2e fixture | OK |
| "View"/"Hide" / `button-version-view-<n>` | Button | Shows that version's compiled system prompt below. | editor.tsx:240 | GET /api/crm/voice/profile/versions/:n → profile.ts:309 → voice_profile_versions.profile/compiled | e2e fixture + vitest | OK |
| Version prompt / `version-detail-prompt` | Read-only text | The compiled prompt of that version ("(not compiled)" when absent). | editor.tsx:253 | same GET | e2e fixture | OK |
| "Restore" / `button-version-restore-<n>` + confirm dialog (`dialog-version-restore`, cancel/confirm) | Button + dialog | Copies that version's profile into the DRAFT (voice_profiles.profile). Live assistant unchanged until the next publish. Warns when unsaved edits exist. | editor.tsx:241, 258-271 | POST /api/crm/voice/profile/versions/:n/restore → profile.ts:320 → profile-store.ts:restoreVersion (saveDraft of the version's profile) | e2e fixture + vitest (engine still runs old version after restore) | OK |
| Empty state / `text-versions-empty` | Empty state | "Nothing published yet." | editor.tsx:232 | same GET (0 rows) | live | OK |

## Editor — Publish dialog (`dialog-publish`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Publish version <N+1>" title | Dialog title | Next version number = publishedVersion+1 (server computes max(versions)+1 — same unless a row was deleted, which the UI never does). | editor.tsx:299 | POST /profile/publish → version = max(voice_profile_versions.version)+1 | code + vitest | OK |
| "What changes" list / `list-publish-diff`, `text-publish-no-changes` | Diff summary | Human lines diffing the draft against the live published version (fetched via GET /versions/:publishedVersion); first publish says so. | editor.tsx:286-313 | GET /api/crm/voice/profile/versions/:n | e2e fixture ("Persona: greeting changed", "FAQ: 0 answers → 1 answer") | OK |
| "Note (optional)" / `input-publish-note` | Input | A short note stored on the version row (UI maxLength 200; server accepts up to 500). | editor.tsx:317 | POST /profile/publish → voice_profile_versions.note | e2e fixture (note persisted + shown in history) | OK |
| "Cancel" / `button-publish-cancel` | Button | Closes without publishing. | editor.tsx:321 | — | e2e | OK |
| "Publish" / `button-publish-confirm` | Button | Saves the draft first if dirty, then publishes: validate → compile (pure, no AI) → INSERT voice_profile_versions → UPDATE voice_profiles (published_version, published_profile, compiled, status 'live', setup_completed_at stamp) → returns {version, compiled}. Toast "Published version N". | editor.tsx:322-324, 290-294 | POST /api/crm/voice/profile/publish → profile.ts:259 → profile-store.ts:publishProfile (advisory-lock serialized) | code + vitest + e2e fixture (badge v1→v2) | OK |

## Section: Company — `studio/section-company.tsx` (CompanySection)

All fields write `profile.company.*` in the local draft; persisted by Save/Publish (PUT → voice_profiles.profile). Live round-trip verified for name+tagline (save → SQL → reload → same values).

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Company name" / `input-company-name` | Input (200) | The legal name; required. | section-company.tsx:19-20 | PUT /profile → profile.company.name (schema: 1-200 chars) | live + SQL | OK |
| "Spoken name (optional)" / `input-company-spoken-name` | Input (200) | How the assistant says the name on the phone. | :21-22 | profile.company.spokenName | live | OK |
| "Trade, in one line" / `input-company-trade` | Input (200) | "We are a …" line. | :23-24 | profile.company.trade | live ("Construction & Remodeling" from org industry) | OK |
| "Tagline (optional)" / `input-company-tagline` | Input (200) | May be used when a caller asks what the company is about. | :25-27 | profile.company.tagline | live round-trip | OK |
| "Office phone" / `input-company-phone` | Input (tel) | Number the assistant gives for "what is your number?"; normalized to E.164 by toE164 on change. | :28-29 | profile.company.officePhone (schema: E.164 or "") | live; server 400 on bad value verified | OK |
| "Website" / `input-company-website` | Input (300, url) | Company website. | :30-31 | profile.company.website | live | OK |
| "Timezone" / `select-company-timezone` | Select | Company clock for hours/call-backs; 7 US zones. | :32-34 | profile.company.timezone | live ("Pacific (Los Angeles)") | OK |
| "About the company" / `textarea-company-about` | Textarea (2000, 4 rows) | Plain facts the assistant may read from; blank = says nothing. | :36-39 | profile.company.about | live | OK |
| Hours — 7 day switches + from/to time inputs / `switch-hours-<day>`, `input-hours-<day>-from/to` | Switch + 2 time inputs ×7 | Office hours per weekday (closed Sat/Sun by default). Hint: the assistant answers 24/7 either way; hours decide "call back today vs tomorrow". Compiler speaks them ("OFFICE HOURS: …", prompt-compiler.ts:294-295). | fields.tsx:163-188 | profile.company.hours.<day> {open,from,to} (schema HH:MM 24h) | live (08:00-17:00 Mon-Fri, closed weekends) + compiler code | OK |

## Section: Services & don'ts — `studio/section-company.tsx` (ServicesSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Add service" / `button-add-service` | Button | Adds an empty service row. (No client cap; the schema caps at 40 and studioIssues shows "too many entries" before the server 400s.) | section-company.tsx:59-62 | profile.company.services[] (max 40) | live + schema compare | OK |
| Service row / `row-service-<i>`: name `input-service-name-<i>`, tier radios `radio-service-tier-<i>-primary|secondary`, details `textarea-service-details-<i>`, remove `row-service-<i>-remove` | Repeater | What you sell; "Primary" is pitched, "Only with a primary job" never alone. Empty-name rows block publishing. | :66-90 | profile.company.services[i] {name(1-200), details(≤2000), tier} | live (empty state text seen; add/edit in e2e) | OK |
| "No services yet…" / `text-services-empty` | Empty state | Explains at least one service is required. | :65 | — | live | OK |
| "Materials" / `list-materials` (+input/add/chips/remove) | Chip list (max 40) | What you install; the assistant recommends only these. | :95-96 | profile.company.materials | schema max matches UI (40=40) | OK |
| "Brands" / `list-brands` | Chip list (max 40) | Brands you carry. | :97-98 | profile.company.brands | same | OK |
| "Add a don't" / `button-add-decline` + rows `row-decline-<i>` (`input-decline-what-<i>`, `input-decline-referral-<i>`, remove) | Repeater | What to politely decline + where to send the caller instead. | :101-127 | profile.company.declines[i] {what(1-200), referral} | live + e2e | OK |

## Section: Service area — `studio/section-service-area.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "State" / `select-county-state` | Select | Picks which state's county list to show (51 options). | section-service-area.tsx:60-65 | GET /api/crm/voice/counties?state=XX → profile.ts:331 → counties table (state_code=XX, name-sorted) | live (39 WA counties) | OK |
| "Find a county" / `input-county-search` | Input | Filters the county list by name. | :69 | client only | live | OK |
| Region shortcuts / `button-region-<id>` (live: wa-border-to-tacoma, wa-puget-sound; "All of <state>" hidden because the backend already sends `all-wa`; `button-region-clear`) | Buttons | Add a whole region at once / clear the picker state. Counts + "missing" tooltip are honest about unmatched counties. | :76-91 | region defs from server/voice/counties.ts REGION_SHORTCUTS resolved against the counties table | live API regions; e2e | OK |
| County checkboxes / `checkbox-county-<id>` (39 in WA) | Checkboxes | Toggle a county in/out of the service area. | :100-111 | profile.serviceArea.counties[] {id,name,stateCode}; server verifyCountyRefs rejects unknown ids (400, verified live) | live + SQL | OK |
| "Selected" panel / `selected-counties`, count `badge-county-count`, chips `chip-county-<id>` (+ `-remove`) | Panel | Shows chosen counties grouped by state; × removes. | :116-139 | same jsonb path | live ("0 counties") | OK |
| "Home state" / `select-default-state` | Select | State assumed when a caller gives no state; "" allowed ("— none —"). | :140-143 | profile.serviceArea.defaultStateCode ('' or 2 letters) | live | OK |
| "Areas the assistant names out loud" / `list-spoken-areas` | Chip list (max 60) | Spoken phrasing for the area ("the Puget Sound area"). | :147-149 | profile.serviceArea.spokenAreas | schema 60=60 | OK |
| "Caller is outside the area" / `select-out-of-area` | Select | Decline politely vs take the lead anyway (flagged). | :152-154 | profile.serviceArea.outOfArea | live | OK |
| "Out-of-area line" / `input-out-of-area-line` | Input (200) | The exact polite line said to out-of-area callers. | :155-156 | profile.serviceArea.outOfAreaLine | live | OK |

## Section: Credibility — `studio/section-trust.tsx` (CredibilitySection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Years in business" / `input-years-in-business` | Number 0-200, blank=null | Spoken when relevant; blank skips. | section-trust.tsx:19-20 | profile.credibility.yearsInBusiness (int 0-200 nullable) | schema+UI bounds match; live render | OK |
| "Founded (year)" / `input-founded-year` | Number 1800-2100, blank=null | The founding year. | :21-22 | profile.credibility.foundedYear | same | OK |
| "Insured" / `switch-insured`, "Bonded" / `switch-bonded` | Switches | Trust facts the assistant may state. | :25-26 | profile.credibility.insured/bonded | live | OK |
| "Licenses" `list-licenses`, "Warranties" `list-warranties`, "Certifications" `list-certifications`, "Awards" `list-awards`, "Memberships" `list-memberships` | Chip lists (max 20 each) | Typed by you; the assistant quotes as-is, never invents. | :29-33 | profile.credibility.{licenses,warranties,certifications,awards,memberships} | schema 20=20 | OK |
| "Reviews and ratings" / `input-reviews` | Input (200) | e.g. "4.9 stars on Google (312 reviews)" — quoted as typed. | :34-35 | profile.credibility.reviews | live | OK |

## Section: Offers — `studio/section-trust.tsx` (OffersSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Financing available" / `switch-financing` + "Financing details" `textarea-financing-details` (2000) | Switch + textarea | Lets the assistant answer financing questions with the typed details. | section-trust.tsx:47-52 | profile.offers.financing.{available,details} | live | OK |
| "Estimates are free" / `switch-free-estimate` + "How the assistant says it" `input-free-estimate-line` | Switch + input (200) | Free-estimate policy and the exact wording. | :54-55 | profile.offers.{freeEstimate,freeEstimateLine} | live | OK |
| "Add promotion" / `button-add-promotion` + rows `row-promotion-<i>` (name `input-promotion-name-<i>`, "Ends on" `input-promotion-ends-<i>` date, details `textarea-promotion-details-<i>`, remove) | Repeater (schema max 20) | Current promotions; the assistant stops mentioning one after its end date (compiler omits expired — prompt-compiler offersSection). | :57-85 | profile.offers.promotions[i] {name(1-200), details, endsOn(YYYY-MM-DD\|null)} | schema + compiler code | OK |
| "Referral program (optional)" / `textarea-referral-program` | Textarea (2000) | The referral terms. | :86-87 | profile.offers.referralProgram | live | OK |

## Section: Policies — `studio/section-trust.tsx` (PoliciesSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Price questions" / `select-pricing` | Select | never = defer every price to the estimator; ranges = read the typed ranges only. | section-trust.tsx:99-101 | profile.policies.pricing | live ("Never quote…") | OK |
| "Repairs" / `select-repairs` | Select | repairs+replacements / replacements only (uses the referral lines) / repairs only. | :102-108 | profile.policies.repairs | live | OK |
| "Add range" / `button-add-price-range` + rows `row-price-range-<i>` (`input-price-range-service-<i>`, `input-price-range-range-<i>`, remove) | Repeater (shown when pricing=ranges; schema max 40; empty list blocks publish) | Typed price ranges the assistant may read. | :110-130 | profile.policies.priceRanges[i] {service,range} | e2e clamp test covers sibling pattern; schema compare | OK |
| "Minimum job (optional)" / `input-minimum-job` | Input (200) | Said when a request is too small. | :132-133 | profile.policies.minimumJob | live | OK |
| "Handle emergencies" / `switch-emergencies` + "What counts as an emergency" `textarea-emergency-definition` (2000) + "What the assistant promises" `textarea-emergency-line` (200) | Switch + textareas | Emergency handling toggle, definition, and the promise line. | :135-145 | profile.policies.emergencies.{handle,definition,line} | live | OK |
| "Extra rules, verbatim" / `list-rules` | Chip list (max 40) | Appended to the prompt word for word. | :147-148 | profile.policies.rules | hint matches compiler (extraSection) | OK |

## Section: Persona — `studio/section-persona.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Voice cards ×6 / `card-persona-<id>` (radiogroup `persona-cards`) | Radio cards | Pick the voice (Janice/Gabe/Sofia/Maya/Marcus/Ethan); name, gender badge, blurb, sample line. | section-persona.tsx:53-83 | profile.persona.presetId (enum, shared/voice-personas.ts); GET /api/crm/voice/personas → profile.ts:341 → personaList() (sampleUrl only when client/public/persona-samples/<id>.mp3 exists) | live API returned all 6 with sampleUrls; files exist; e2e | OK |
| "Play sample" / `button-persona-play-<id>` | Icon button | Plays the pre-rendered sample mp3; disabled with "Sample not rendered yet" when the file is missing (`text-persona-no-sample-<id>`). Client-side audio only — no server call. | :71-76 | client only (static file /persona-samples/<id>.mp3) | live API + files on disk | OK |
| "Assistant's name" / `input-assistant-name` | Input (200) | Blank = the voice's own name. | :87-88 | profile.persona.assistantName | live | OK |
| "When asked 'are you a bot?'" / `input-bot-answer` | Input (200) | The honest answer the assistant gives. | :89-90 | profile.persona.botAnswer | live | OK |
| "Greeting" / `textarea-greeting` | Textarea (200) | Blank = built from company+assistant name; the compiler appends "calls may be recorded" when required (prompt-compiler.ts:183-189). | :92-93 | profile.persona.greeting | live preview matched the rule | OK |
| 'Say "calls may be recorded"' / `switch-recording-notice` | Switch (forced on + disabled in all-party-consent states) | Two-party-consent states are derived from service-area counties + home state (recordingNoticeStates, shared/voice-profile.ts:388); the compiler forces the notice regardless of the switch. Hint names the states. | :94-97 | profile.persona.recordingNotice; compiler overrides per profile | code + live render | OK |
| Warmth / `slider-style-warmth`, Brevity / `slider-style-brevity`, Formality / `slider-style-formality` | Sliders 1-5 + value labels | Style knobs the compiler maps to prompt phrasing bounds. | :99-106 | profile.persona.style.{warmth,brevity,formality} (1-5) | live (4/4/2 = defaults) | OK |
| "Languages: English. Spanish is on the roadmap…" | Static note | Honest statement; schema only allows "en" today. | :108 | profile.persona.languages (["en"]) | schema | OK |

## Section: Intake questions — `studio/section-intake.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Question rows / `row-intake-<i>`: prompt `input-intake-prompt-<i>`, "Required" `switch-intake-required-<i>` (`-sm-` variant in the options panel), reorder `button-intake-up-<i>`/`button-intake-down-<i>` + drag handle, remove `button-intake-remove-<i>`, options toggle `button-intake-options-<i>` | Repeater (schema min 1, max 20 — Add disables at 20) | The ordered questions asked one at a time. Keys are normalized to [a-z0-9_]; duplicates/blank prompts/bad keys block publish. | section-intake.tsx:44-105 | profile.intake.questions[i] {key,prompt,required,validation,choices,confirm,neverReadAloud,prefillFrom} | live (6 defaults render); e2e reorder test | OK |
| Options panel / `panel-intake-options-<i>`: "Slot key" `input-intake-key-<i>`, "Answer looks like" `select-intake-validation-<i>`, "Choices" `list-intake-choices-<i>` (when validation=choice, max 20), "Already known from" `select-intake-prefill-<i>`, "Read back once" `switch-intake-confirm-<i>`, "Never read aloud" `switch-intake-never-read-<i>` | Sub-form | Where each answer lands in the lead, its format, prefill source (caller-id confirm / CRM), and read-back behavior. | :80-101 | same jsonb paths | e2e (options panel follows its question on reorder) | OK |
| "Ask a custom question…" / `input-intake-new` + "Add" / `button-intake-add` | Input + button | Appends a custom question with a derived unique key. | :108-113 | profile.intake.questions[] | live + e2e | OK |
| "Default script" / `button-intake-reset` | Button | Restores the 6 owner-written default questions (lib/voice-studio.ts:446). | :114 | client only | live | OK |
| "After the last answer" / `input-submit-line` | Input (200) | Closing line said once the lead is filed. | :118-119 | profile.intake.submitLine | live | OK |
| "Goodbye = submit immediately" / `switch-submit-on-goodbye` | Switch | File what was collected the moment the caller says goodbye. | :120-121 | profile.intake.submitOnGoodbye | live | OK |

## Section: FAQ — `studio/section-rest.tsx` (FaqSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| FAQ rows / `row-faq-<i>`: `input-faq-question-<i>`, `textarea-faq-answer-<i>`, remove | Repeater (schema max 60; Add disables at 60) | Q/A pairs the assistant answers verbatim, ahead of everything else. | section-rest.tsx:18-32 | profile.faq[i] {question,answer} — blank either blocks publish | live empty state; e2e add+publish | OK |
| "Add question" / `button-add-faq` | Button | Adds an empty FAQ row. | :35-37 | profile.faq[] | e2e | OK |

## Section: Escalations — `studio/section-rest.tsx` (EscalationsSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Rule rows / `row-escalation-<i>`: id badge, "Enabled" `switch-escalation-enabled-<i>`, situation checkboxes `checkbox-escalation-<i>-<kind>` (9 kinds), "Page" `input-escalation-name-<i>`, "By" `select-escalation-channel-<i>` (sms/email), recipient `input-escalation-recipient-<i>` (E.164-normalized on blur for sms), "Message" `textarea-escalation-template-<i>` (+placeholder placeholder list), remove | Repeater (schema max 30; Add disables at 30) | Who gets paged per situation; blank name/kinds/recipient block publish. First enabled rule matching a kind wins (server/voice/escalations.ts). | section-rest.tsx:54-126 | profile.escalations.rules[i]; at call time escalations.ts sends SMS via crm sms / email and writes voice_escalations | e2e (E.164 blur test); server behavior in escalations.test.ts | OK |
| "Remind until they reply" `switch-escalation-reminders-<i>` + "Every" `input-escalation-every-<i>` (15-1440), "From" `input-escalation-from-<i>` (0-23h), "Until" `input-escalation-to-<i>` (1-24h), "For up to" `input-escalation-days-<i>` (1-30 days), follow-up `switch-escalation-followup-<i>` | Switch + 4 number fields + switch | Reminder cadence; worker resends unconfirmed escalations (server/voice/escalations.ts, 30-min worker, production only). | :105-123 | profile.escalations.rules[i].reminders.* — UI bounds match schema exactly | schema compare | OK |
| "Add rule" / `button-add-escalation` | Button | New rule with default kinds human+urgent, id rule-N. | :129-131 | profile.escalations.rules[] | e2e | OK |
| "What the caller hears after an alert" / `input-caller-line` | Input (200) | Spoken right after an alert is sent. | :135 | profile.escalations.callerLine | live | OK |
| "No matching rule → notify the owners" / `switch-fallback-owner` | Switch | Unmatched kinds go to the org's CRM channels; urgent/human ALWAYS reach owners too (server/voice/escalations.ts:251 — matches the hint text). | :136-137 | profile.escalations.fallbackToOwner | server code | OK |

## Section: Lead delivery — `studio/section-rest.tsx` (LeadDeliverySection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "File the lead in the CRM" / `switch-crm-enabled` + "Also start a pipeline project" `switch-crm-create-project` + "Tags on the client" `list-crm-tags` (max 10) | Switch + switch + chip list | Creates/matches the client (by phone) with transcript+recording; optional stage-"lead" project; tags applied. | section-rest.tsx:161-169 | profile.leadDelivery.crm.{enabled,createProject,tags} — consumed at call time by server/voice/leads.ts | live defaults (on/on/["call-assistant"]); schema 10=10 | OK |
| "Email the lead" / `switch-email-enabled` + "Extra email recipients" `list-email-recipients` (max 10, lowercased) | Switch + chip list | Lead email to notification subscribers plus extras. | :171-177 | profile.leadDelivery.email.{enabled,extraRecipients} (zod email) | schema | OK |
| "Text the lead" / `switch-sms-enabled` + "Text these numbers" `list-sms-recipients` (max 10, E.164) | Switch + chip list | SMS from the CRM texting number, metered like any text. | :179-185 | profile.leadDelivery.sms.{enabled,recipients} | schema; studioIssues validates E.164 | OK |
| "Send a summary for every call" / `switch-notify-every-call` | Switch | Also summarize non-lead calls; spam/hangups never notify. | :187-188 | profile.leadDelivery.notifyOnEveryCall | live | OK |

## Section: Appointments — `studio/section-rest.tsx` (AppointmentsSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Let the assistant book estimates" / `switch-appointments-enabled` | Switch | Off by default and honest about it: "Booking tools are not live yet; turning this on records your availability." Compiled profile only carries `appointments.enabled`. | section-rest.tsx:202-203 | profile.appointments.enabled; compiler output `appointments:{enabled}` (prompt-compiler.ts) | live + compiler code | OK |
| "Visit length" `input-slot-minutes` (15-480), "Buffer between" `input-buffer-minutes` (0-240), "Earliest offer" `input-lead-time-hours` (0-336), "Confirm by text" `switch-confirm-sms` | 3 number fields + switch | Availability knobs; bounds match the schema exactly. | :206-211 | profile.appointments.{slotMinutes,bufferMinutes,leadTimeHours,confirmBySms} | schema compare | OK |
| "Add crew" / `button-add-crew` + crew rows `row-crew-<i>` (name `input-crew-name-<i>`, windows: day `select-crew-<i>-window-<k>-day`, from/to `input-crew-<i>-window-<k>-from/to`, remove window `button-crew-<i>-window-<k>-remove`, "Add window" `button-crew-<i>-add-window`, remove crew) | Repeater (schema max 20 crews / 50 windows) | Crew availability windows. | :213-247 | profile.appointments.crews[i] {name(1-200), windows[{day,from,to}]} | schema compare | OK |

## Section: Advanced — `studio/section-rest.tsx` (AdvancedSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Additional instructions" / `textarea-extra-instructions` | Textarea (4000) | Appended to the system prompt verbatim after every built-in rule. | section-rest.tsx:261-262 | profile.advanced.extraInstructions (≤4000) | live | OK |
| "Creativity" / `input-temperature` | Number 0-1 (step .05) | Model temperature; 0.3 tested default. | :264 | profile.advanced.temperature | live (0.3) | OK |
| "Max turns per call" / `input-max-turns` | Number 4-80 | Turn cap; clamps on blur; 999 blocks Publish. | :265 | profile.advanced.maxTurns | e2e clamp test | OK |
| "Max call length" / `input-max-call-seconds` | Number 60-3600 (step 30) | Hard cap on one call, seconds. | :266 | profile.advanced.maxCallSeconds | live (900) | OK |
| "Advanced timing" `<details>`: "Silence before 'still there?'" `input-silence-seconds` (5-60), "Silence prompts before goodbye" `input-silence-prompts` (1-5), "Greeting delay" `input-greeting-delay` (0-10, step .5) | Disclosure + 3 number fields | Silence handling + forwarded-call bridge delay. | :268-273 | profile.advanced.{silencePromptSeconds,silencePromptsBeforeHangup,greetingDelaySeconds} | live (12/2/3) | OK |
| "Spam sensitivity" / `select-spam-sensitivity` | Select | low/normal/high → compiler maps to flag/strike confidence thresholds (SPAM_THRESHOLDS). Hint about two near-certain calls blocking a number matches server/voice/spam.ts. | :274-276 | profile.advanced.spamSensitivity | compiler + spam.ts code | OK |
| "Words the listener should know" / `list-vocabulary` | Chip list (max 60) | Extra recognizer vocabulary (brands, towns). | :277-278 | profile.advanced.vocabulary | schema 60=60 | OK |

## Notes / context

- `POST /api/crm/voice/profile/setup` (profile.ts:240, `applyWizard`) is a complete parallel wizard-merge API, but **no UI element calls it** — the frontend wizard edits the full profile and uses PUT /profile + POST /publish. The route is exercised by server/voice/profile.test.ts. Not a bug; noted so nobody assumes the UI depends on it.
- Client-side `studioIssues` mirrors the server zod schema (same file: shared/voice-profile.ts) — Publish/Next are disabled for anything the server would 400 on, so the server limits and UI hints were compared field by field (all numeric bounds and maxLengths match; e.g. intake ≤20, FAQ ≤60, escalation rules ≤30, reminders 15-1440/0-23/1-24/1-30).
- The publish/compile path never calls an AI provider: `compileVoiceProfile` is a pure string builder (sha256 hash, deterministic); AI is only used by the Simulator and live calls.

# Lane 1 · Audit 04 — Platform shell (sidebar, top bar, notifications, cart, payment banner, Hub)

Every signed-in platform (growth) page shares this chrome. Audited 2026-10-04 against the dev
server at `127.0.0.1:8301` (portal mode; the platform face was opened with `?portal=0`, which
`client/src/lib/site.ts` explicitly supports), signed in as dev platform admin user 1
(dev@constructhub.local). Counts verified with read-only SQL on `constructhub_dev_a6` and with
`curl` against the same APIs the components call.

Verification shorthand: **SQL** = independent read-only query; **curl** = same API the component
calls; **browser** = Playwright chromium against the dev server; **route check** = path exists in
`client/src/App.tsx` and lands where the label says; **code only** = traced in source, not pressed.

Shell-wide facts that every section relies on:

- The platform shell frame is rendered by `client/src/App.tsx:678-716` (the non-portal branch):
  `AppSidebar` + a 56 px header (`SidebarTrigger`, `RecentAuthModal`, `NotificationBell`,
  `/settings` link, `CartSheet`, `ThemeToggle`), then `PaymentNeededBanner`, then the routed page
  and a small footer. The Hub launcher floats outside the flow (`App.tsx:714`).
- On this dev host the app is portal-forced (`VITE_FORCE_PORTAL=true`), so any in-app navigation
  that drops the `?portal=0` query flips the SPA into CRM-portal chrome. That is a dev/test
  artifact of the force flag (`client/src/lib/site.ts:17-29`); on the real marketing host
  (`constructhub.us`) the same links render the platform pages they name. All route checks below
  were done with `?portal=0` appended.

## Sidebar (`client/src/components/app-sidebar.tsx`)

Collapsible groups; children render only while the group is open. The Admin group
(`<details open>`, `app-sidebar.tsx:529-591`) sits below the Tools group inside the scrollable
content — on a 900 px-high window it starts clipped (content 907 px vs 711 px viewport), which is
a layout fact, not a bug: it renders and scrolls into view.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Logo `link-logo-home` | link | Goes to the signed-in home dashboard (`/`). | app-sidebar.tsx:421 | Route check: `/` → `HomePage` (App.tsx:166) | route check, browser | OK |
| `CRM` `link-nav-crm` | link | Opens the CRM gateway page ("Open your CRM" jumps to the CRM portal host). | app-sidebar.tsx:439 | GET `/api/crm/me` decides member vs. plans (crm-gateway.tsx:40-41); route `/crm-app` → `CrmGatewayPage` (App.tsx:204) | route check, browser (h1 "ConstructHub CRM", `button-open-crm` present) | OK |
| Group `Permits & Databases` `link-nav-group-permits-&-databases` | disclosure | Expands/collapses the five permit links. Open automatically when a permit page is showing. | app-sidebar.tsx:291-306 | client only | browser | OK |
| `link-nav-permits-&-databases-landing` (external icon) | link | Opens the feature intro page for permits. | app-sidebar.tsx:308 | route check: `/features/permits` → `FeaturePageRoute` (App.tsx:209; slug in shared/feature-pages/index.ts) | route check | OK |
| `Search Permits` `link-nav-search-permits` | link | Opens the permit search tool. | app-sidebar.tsx:207,321 | route check: `/search` → `SearchPage` (App.tsx:167); browser h1 "Search permits" | route check, browser | OK |
| `Database Directory` `link-nav-database-directory` | link | Opens the directory of county/city permit databases. | app-sidebar.tsx:208 | route check: `/databases` → `DatabasesPage` (App.tsx:168) | route check | OK |
| `Property Records` `link-nav-property-records` | link | Opens property owner/parcel lookups. | app-sidebar.tsx:209 | route check: `/property` → `PropertyPage` (App.tsx:169) | route check | OK |
| `Scrape Schedules` `link-nav-scrape-schedules` | link | Opens the (admin) refresh schedules for the shared permit directory. | app-sidebar.tsx:210 | route check: `/schedules` → `SchedulesPage` (App.tsx:170); API gated `isAdmin` (routes.ts:505-508) | route check | OK |
| `Search History` `link-nav-search-history` | link | Opens this account's past permit searches. | app-sidebar.tsx:211 | route check: `/history` → `HistoryPage` (App.tsx:171) | route check | OK |
| Group `Google Business` `link-nav-group-google-business` + `link-nav-google-business-landing` | disclosure + link | Expands the Google Business tools; the little arrow opens the Google Business overview page. | app-sidebar.tsx:216-234,307-311 | landing `/google-business` → `GoogleBusinessPage` (App.tsx:192) | route check | OK |
| `Google Profile` `link-nav-google-profile` | link | Opens the connected Google profile page. | app-sidebar.tsx:222 | route check: `/google-profile` → `GoogleProfilePage` (App.tsx:180) | route check | OK |
| `Agency` `link-nav-agency` | link | Opens the agency workspace (client workspaces). Lock icon shows when the plan doesn't include it. | app-sidebar.tsx:223,393-399 | `/api/agency/me` → `{entitled}` (verified user 1: `entitled:true`, so no lock); route `/agency` → `AgencyPage` (App.tsx:178) | curl, route check | OK |
| `Locations` `link-nav-locations` | link | Opens the GBP locations manager. | app-sidebar.tsx:224 | route check: `/locations` → `LocationsPage` (App.tsx:179) | route check | OK |
| `Domains` `link-nav-domains` | link | Opens the domains/expiry tool. Plan-gated (lock when not included). | app-sidebar.tsx:225 | `/api/entitlements` → `modules.domainsMailAlerts` (user 1: `true` → no lock); route `/domains` → `DomainsPage` (App.tsx:182) | curl, route check | OK |
| `Mail alerts` `link-nav-mail-alerts` | link | Opens provider alert-email matching. Same plan gate as Domains. | app-sidebar.tsx:226 | same as above; route `/mail-alerts` → `MailAlertsPage` (App.tsx:183) | curl, route check | OK |
| `Posts & Photos` `link-nav-posts-&-photos` | link | Opens scheduled Google posts/photo uploads. | app-sidebar.tsx:227 | route check: `/gbp-content` → `GbpContentPage` (App.tsx:184) | route check | OK |
| `GMB Edit Monitor` `link-nav-gmb-edit-monitor` | link | Opens the profile-edit watcher. | app-sidebar.tsx:228 | route check: `/gmb-monitor` → `GmbMonitorPage` (App.tsx:174) | route check | OK |
| `GMB Ranking Grid` `link-nav-gmb-ranking-grid` ("Popular" sr-only) | link | Opens the map rank grid tool; the "Popular" tag is a screen-reader-only label, not a count. | app-sidebar.tsx:229,197-199 | route check: `/ranking-grid` → `RankingGridPage` (App.tsx:175) | route check | OK |
| `Photo Optimizer` `link-nav-photo-optimizer` | link | Opens the photo optimizer. | app-sidebar.tsx:230 | route check: `/photos` → `PhotosPage` (App.tsx:172) | route check | OK |
| `Media Library` `link-nav-media-library` (sub-item) | link | Opens the stored optimized photos. | app-sidebar.tsx:231,331-344 | route check: `/media-library` → `MediaLibraryPage` (App.tsx:173); browser h1 "Media library" | route check, browser | OK |
| `Reinstatement` `link-nav-reinstatement` | link | Opens the suspended-profile appeal service. | app-sidebar.tsx:233 | route check: `/reinstatement` → `ReinstatementPage` (App.tsx:191) | route check | OK |
| Group `Google Ads` `link-nav-group-google-ads` + `link-nav-google-ads-landing` | disclosure + link | Expands the ads tools; the arrow opens the Click Guard feature page. | app-sidebar.tsx:237-249 | landing `/features/click-guard` → `FeaturePageRoute` (slug in shared/feature-pages) | route check | OK |
| `Agency Ads & LSA` `link-nav-agency-ads-&-lsa` ("New") | link | Opens client ad accounts/audits. Plan-gated lock. | app-sidebar.tsx:242 | `/api/entitlements` → `modules.adsManager` (`true` for user 1); route `/ads-manager` → `AdsManagerPage` (App.tsx:194) | curl, route check | OK |
| `Click Guard` `link-nav-click-guard` ("Popular") | link | Opens the ad-click fraud tool. | app-sidebar.tsx:243 | route check: `/google-ads` → `GoogleAdsPage` (App.tsx:195) | route check | OK |
| `Ad Fraud` `link-nav-ad-fraud` | link | Opens the ad-fraud guide page. | app-sidebar.tsx:244 | route check: `/google-ad-fraud` → `GoogleAdFraudPage` (App.tsx:200) | route check | OK |
| `Ads Guide` `link-nav-ads-guide` | link | Opens the Google Ads guide. | app-sidebar.tsx:245 | route check: `/google-ads-guide` → `GoogleAdsGuidePage` (App.tsx:198) | route check | OK |
| `LSA Guide` `link-nav-lsa-guide` | link | Opens the Local Services Ads guide. | app-sidebar.tsx:246 | route check: `/lsa-guide` → `LsaGuidePage` (App.tsx:201) | route check | OK |
| `LSA Leads` `link-nav-lsa-leads` ("New") | link | Opens LSA leads/disputes. | app-sidebar.tsx:247 | route check: `/lsa-leads` → `LsaLeadsPage` (App.tsx:202) | route check | OK |
| `Google Reviews` `link-nav-google-reviews` ("Recommended") | link | Opens the review-request/monitoring tool. | app-sidebar.tsx:252,471-484 | route check: `/google-reviews` → `GoogleReviewsPage` (App.tsx:223; flag `SHOW_GOOGLE_REVIEWS=true`, features.ts) | route check | OK |
| `Call Assistant` `link-nav-call-assistant` ("New") | link | Opens the AI call-assistant dashboard. | app-sidebar.tsx:257,495-524 | route check: `/call-assistant` → `CrmCallAssistantPage` (App.tsx:206) | route check | OK |
| `Social Media` `link-nav-social-media` | link | Opens the social posting tool. | app-sidebar.tsx:258 | route check: `/social-media` → `SocialMediaPage` (App.tsx:185) | route check | OK |
| `Site Scan` `link-nav-site-scan` | link | Opens the site SEO/speed scanner. | app-sidebar.tsx:259 | route check: `/site-scan` → `SiteScanPage` (App.tsx:189) | route check | OK |
| `Cloudflare` `link-nav-cloudflare` | link | Opens Cloudflare zones/traffic. Plan-gated lock. | app-sidebar.tsx:260 | `/api/entitlements` → `modules.cloudflareSearchConsole` (`true`); route `/cloudflare` → `CloudflarePage` (App.tsx:187) | curl, route check | OK |
| `Search Console` `link-nav-search-console` | link | Opens Search Console clicks/impressions. Same plan gate. | app-sidebar.tsx:261 | same; route `/search-console` → `SearchConsolePage` (App.tsx:188) | curl, route check | OK |
| `IP Tracker` `link-nav-ip-tracker` ("Popular") | link | Opens the site-visitor IP tracker. | app-sidebar.tsx:262 | route check: `/ip-tracker` → `IpTrackerPage` (App.tsx:203) | route check | OK |
| `VPN Shield` `link-nav-vpn-shield` ("New") | link | Opens the VPN/proxy blocker. | app-sidebar.tsx:263 | route check: `/vpn-shield` → `VpnShieldPage` (App.tsx:219) | route check | OK |
| `Competitor Intel` `link-nav-competitor-intel` + `link-nav-competitor-intel-landing` | link + link | Opens the competitor benchmark tool; the arrow opens its intro page. | app-sidebar.tsx:264 | `/competitors` → `CompetitorsPage` (App.tsx:177); `/features/competitors` → `FeaturePageRoute`; flag on | route check | OK |
| `Master Class` `link-nav-master-class` + `link-nav-master-class-landing` | link + link | Opens the course page; the arrow opens its feature intro. | app-sidebar.tsx:265 | `/master-class` → `MasterClassPage` (App.tsx:190); `/features/master-class` → `FeaturePageRoute` | route check | OK |
| Group `Pricing & Plans` `link-nav-group-pricing-&-plans` | disclosure | Expands plan/subscription links. | app-sidebar.tsx:268-281,525 | client only | browser | OK |
| `Subscription Plans` `link-nav-subscription-plans` | link | Opens the pricing page. | app-sidebar.tsx:273 | route check: `/pricing` → `PricingPage` (App.tsx:176) | route check | OK |
| `Add-ons` `link-nav-add-ons` | link | Opens pricing scrolled to the add-ons section. | app-sidebar.tsx:274,321 + scrollToFragment (app-sidebar.tsx:175-187) | route check: `/pricing#add-ons` → same page, `scrollToFragment` scrolls to the `#add-ons` anchor | route check, code only | OK |
| `All features` `link-nav-all-features` | link | Opens the catalogue of every feature intro page. | app-sidebar.tsx:276 | route check: `/features` → `FeaturesCataloguePage` (App.tsx:208) | route check | OK |
| `Master Class` (pricing group) `link-nav-pricing-master-class` | link | Opens the Master Class intro page. Distinct testid because the title repeats. | app-sidebar.tsx:277 | route check: `/features/master-class` → `FeaturePageRoute` | route check | OK |
| `SEO Services` `link-nav-seo-services` | link | Opens pricing scrolled to the done-for-you services. | app-sidebar.tsx:279 | route check: `/pricing#services` → `PricingPage` + fragment scroll | route check, code only | OK |
| Admin disclosure "Admin" | disclosure | Platform admins only (from `/api/auth/me` → `isPlatformAdmin`); holds the four admin links, open by default. | app-sidebar.tsx:529-533 | GET `/api/auth/me` → `isPlatformAdmin:true` for user 1 (verified) | curl, browser | OK |
| `Account Manager` `link-nav-lsa-account-manager` | link | Opens the LSA account manager (admin). | app-sidebar.tsx:537 | route check: `/lsa-account-manager` → `LsaAccountManagerPage` (App.tsx:231) | route check | OK |
| `Feature pages` `link-nav-admin-feature-pages` | link | Opens the admin index of feature intro pages. | app-sidebar.tsx:549 | route check: `/admin/feature-pages` → `AdminFeaturePagesPage` (App.tsx:214) | route check | OK |
| `Access grants` `link-nav-admin-access` | link | Opens granting/revoking plan access (admin). | app-sidebar.tsx:561 | route check: `/admin/access` → `AdminAccessPage` (App.tsx:216) | route check | OK |
| `Issues` `link-nav-admin-issues` + badge `badge-nav-issues-new` | link + count badge | Opens the issue desk; the orange badge is how many captured issues are still brand-new. | app-sidebar.tsx:573-587,387-392 | GET `/api/admin/issues/summary` → `issueSummary()` (server/ops/issues.ts:307) → `ops_issues` `WHERE status='new'` (no time window). API returned `new:10`, then `new:11` — SQL `SELECT count(*) FROM ops_issues WHERE status='new'` matched both times. Badge capped at "99+". | SQL + curl + browser (badge 10 visible, screenshot 02) | OK |
| `Directory totals` disclosure (footer) | disclosure | Expands two quiet directory statistics. | app-sidebar.tsx:595-604 | see next two rows | browser | OK |
| `Counties` (inside disclosure) | stat | Number of counties in the permit directory. | app-sidebar.tsx:596-599,368-370,402 | GET `/api/counties` → `storage.getCounties()` (server/storage.ts:200) → `SELECT * FROM counties`. API returned 3,139; SQL `SELECT count(*) FROM counties` = 3,139. | SQL + curl | OK |
| `Directory entries` (inside disclosure) | stat | Total permit-database rows (county + city + other jurisdiction types). | app-sidebar.tsx:600-603,364-366,401 | GET `/api/databases/counts` → `getDatabaseCounts()` (server/storage.ts:274) → `count(*) FROM permit_databases` grouped by `jurisdictionType`, summed. API `total:32,853`; SQL `SELECT count(*) FROM permit_databases` = 32,853. | SQL + curl | OK |
| User name/avatar `text-user-name` | display | Shows the signed-in person's name (or email) and avatar/initial. | app-sidebar.tsx:606-621,372-374 | GET `/api/auth/me` → `displayName` ("Veto") | curl, browser | OK |
| Settings gear `button-settings` | link | Opens Account settings. | app-sidebar.tsx:623-627 | route check: `/settings` → `SettingsPage` (App.tsx:236) | route check | OK |
| Sign out `button-logout` | button | Signs out: POSTs logout, clears cached data, loads the home page signed out. | app-sidebar.tsx:628-637,404-416 | POST `/api/auth/logout` (server/auth.ts:924) destroys the session, logs `auth.logout` to `account_activity`. Curl → `{"ok":true}` 200. (Not clicked in the browser, to keep the dev session.) | curl, code only | OK |
| `Sign In / Sign Up` `link-login` (signed out only) | link | Shows instead of the user footer when signed out; goes to the auth page. | app-sidebar.tsx:641-646 | route check: `/auth` → `AuthPage` (App.tsx:237) | code only | OK |
| Plan lock badges on gated links (`badge-plan-*`) | badge | A small lock icon with a tooltip naming the plan that unlocks a module page; shows only when the account's plan lacks that module. Unknown (still loading) shows nothing. | app-sidebar.tsx:144-151,157-169,393-399 | `/api/entitlements` → `modules.*`, `/api/agency/me` → `entitled` (user 1 has all four modules `true` + agency `entitled:true`, so no locks rendered — verified via API) | curl, browser | OK |

## Top bar (`client/src/App.tsx:683-694` header + shell footer)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Sidebar collapse `button-sidebar-toggle` | icon button | Collapses the sidebar to icons / expands it. Remembers the choice per browser (`localStorage`, ui/sidebar.tsx provider). | App.tsx:636,684; ui/sidebar.tsx:256 | client only | code only | OK |
| Recent-auth dialog (no trigger; part of `RecentAuthModal`) | hidden dialog | Appears by itself when a sensitive action needs a fresh identity check: "Continue with Google" or an emailed 6-digit code, then the action continues. | recent-auth.tsx:31-86 | GET `/api/auth/reauth` (server/account-security.ts:109, returns method + google + masked email); POST `/api/auth/reauth/email` (line 115, emails code, session-held 10 min); POST `/api/auth/reauth` (line 124, verifies password/TOTP/code → `markRecentAuth`). Covered by server/account-security.test.ts. | code only (endpoints + tests exist) | OK |
| Bell button `button-notification-bell` + count `badge-notification-count` | icon button + badge | Opens the notifications popover; the orange badge is the count of unread in-app notifications from the last 30 days ("99+" above 99). | account-security.tsx:10-13 | GET `/api/notifications` (server/account-events.ts:78) → unread = `count(*) FROM user_notifications WHERE user_id=$1 AND read_at IS NULL AND created_at > now() - interval '30 days'`. SQL matched the API at every check: 37, then 40, then 41 as new ones arrived. | SQL + curl + browser | OK |
| Settings gear `link-header-settings` | icon link | Opens Account settings. | App.tsx:687-690 | route check: `/settings` → `SettingsPage`; browser-verified with `?portal=0` (title "Account settings") | route check, browser | OK |
| Cart button `button-cart-trigger` + count `badge-cart-count` | icon button + badge | Opens the cart sheet; the badge counts checkout items + sales-rep items waiting in the cart. | cart-sheet.tsx:84-96 | client only until checkout (see Cart section) | browser | OK |
| Theme `button-theme-toggle` (sun/moon) | icon button | Switches light/dark. Saves to the browser's `localStorage` under `theme`; on load an inline script in `index.html` re-applies `dark` before first paint. | theme-toggle.tsx:5-20; theme-provider.tsx:15-40; index.html:23-24 | client only | browser (light→dark persisted across reload; key read back = `theme`; html class toggles; restored to light) | OK |
| Payment-needed banner `banner-payment-needed` | banner | Red banner under the header when a payment is owed. See its own section. | payment-needed-banner.tsx:11-26 | GET `/api/entitlements` → `paymentNeeded` | curl + code (hidden for user 1: `paymentNeeded:false`) | OK |
| Footer `link-dashboard-footer-email` | mail link | Opens the user's mail app to support@constructhub.us. | App.tsx:702 | client only | code only | OK |
| Footer `link-dashboard-footer-terms` / `link-dashboard-footer-privacy` | links | Opens the Terms / Privacy pages. | App.tsx:704,706 | route check: `/terms` → `TermsOfUsePage`, `/privacy` → `PrivacyPolicyPage` (App.tsx:229-230) | route check | OK |
| Footer copyright line | text | "© <year> ConstructHUB…" from `copyrightNotice()`. | App.tsx:708,79 | client only | code only | OK |

## Notifications dropdown (`client/src/components/account-security.tsx` `NotificationBell`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Popover trigger (bell, above) | — | Opens this dropdown; re-checks every 30 s. | account-security.tsx:11,13 | GET `/api/notifications` (below) | browser | OK |
| "Notifications" heading + "Mark all read" | heading + button | Marks every unread notification read (whole account, not just 30 days). Disables while saving; shows an error line if it fails. | account-security.tsx:13-14 | POST `/api/notifications/read` with `{}` (server/account-events.ts:84-90) → `UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`. Same mutation the per-item button uses (with `ids`). | code only (per-item variant pressed instead; not bulk-pressing 40 dev rows) | OK |
| Empty state "Nothing new in the last 30 days." | text | Shows when there are zero notification rows in the last 30 days (read or unread). | account-security.tsx:16 | same GET (list is `WHERE user_id=$1 AND created_at > now() - 30 days ORDER BY created_at DESC LIMIT 100`) | code only | OK |
| Loading / error lines | text | "Loading notifications…" while fetching; "Unable to load notifications." on failure. | account-security.tsx:15 | same GET | code only | OK |
| Each row: title link (`<a href={n.link ?? '/settings?tab=security'}>`) | link | Opens the notification's page (full page load) and marks that one read. Stored links on dev: `/site-scan`, `/settings?tab=security`, `/settings?tab=api-keys` — all valid routes. | account-security.tsx:17 | same POST `/api/notifications/read` with `{ids:[n.id]}` then navigate to `link` | SQL (distinct links), route check | OK |
| Each row: body text + timestamp | text | The notification's message and when it happened (browser-local formatting). | account-security.tsx:17 | from `user_notifications.body / created_at` | browser | OK |
| Each unread row: "Mark read" | button | Marks just that notification read; the row stays listed but unbolded and loses the button. | account-security.tsx:17 | POST `/api/notifications/read` `{ids:[id]}` → `read_at=now()` for those ids | browser + SQL (clicked; row 6518 got `read_at`, count dropped 42→41; badge updated) | OK |
| Unread styling | style | Unread rows render in bold until marked read. | account-security.tsx:17 | — | browser | OK |

Note (not a bug): the badge count has no 100-row cap while the list stops at 100 rows, so with more than 100 unread in 30 days the badge would outnumber the visible rows. The label is "Notifications (N unread)", and N is the true count — consistent.

## Cart (`client/src/components/cart-sheet.tsx` + `client/src/contexts/cart-context.tsx`)

There is no separate `/cart` route — the sheet IS the cart, so the badge and the sheet necessarily read one source: `CartContext` state hydrated from the browser's `localStorage` keys `constructhub_cart` (checkout lines) and `constructhub_cart_sales` (sales-rep requests). No cart table exists in the DB (checked `information_schema.tables`); nothing is stored server-side until checkout.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Trigger + badge `button-cart-trigger` / `badge-cart-count` | icon button + badge | Opens the sheet; badge shows `checkout items + waiting sales items` ("99+…" uncapped — renders the raw sum). | cart-sheet.tsx:84-96,72 | client only (localStorage) | browser | OK |
| Sheet title + "N items" | heading + badge | "Shopping Cart" with the checkout-line count (sales items excluded — they aren't bought). | cart-sheet.tsx:99-105 | client only | browser | OK |
| Empty state `text-cart-empty` + `link-browse-courses` / `link-browse-services` | text + buttons | "Your cart is empty" with two jump buttons: Master Class (`/master-class`) and Services (`/pricing#services`). | cart-sheet.tsx:108-127 | route check both targets | route check, browser | OK |
| Sales-request section `section-cart-sales` | card | Lists items priced $1,000+ that were turned away from checkout; each row has "Talk to sales" (sends a sales inquiry, then removes the row) and a dismiss ×. | cart-sheet.tsx:131-158 | TalkToSalesButton → POST sales inquiry endpoint (talk-to-sales component; Stripe never involved) | code only | OK |
| Item card `card-cart-item-*` (name, description, type badge, price, remove ×) | card + button | One per checkout line; × removes just that line. Type badge labels course module/bundle/service bundle/service. | cart-sheet.tsx:159-194 | client only | browser (injected scaffolding item rendered; removed via × path not pressed — Clear cart used) | OK |
| Subtotal `text-cart-total` | stat | Sum of the checkout lines' prices (client-computed display; the server re-resolves every price at checkout and never trusts these). | cart-sheet.tsx:197-205,171-173 | — | browser ($499 test line ⇒ $499) | OK |
| Checkout error line `text-cart-error` | text | Shows the server's error message (e.g. Stripe not configured on dev, or the 409 "talk to a sales rep" refusal) until the cart changes or the sheet reopens. | cart-sheet.tsx:207-211,75-79 | — | code only | OK |
| `button-cart-checkout` "Proceed to checkout" | button | Sends the cart's checkout lines to the server; on success redirects to Stripe's hosted checkout; 401 → sign-in prompt; other errors → toast/inline. Hidden when there are no checkout lines. | cart-sheet.tsx:213-231,43-60 | POST `/api/stripe/create-cart-checkout` (server/stripe.ts:512): re-resolves each price server-side (`master_class_modules.price`, `COURSE_BUNDLE`, `DFY_CATALOG`), refuses ≥$1,000 items with 409 `talk_to_sales`, refuses duplicate/bundle-overlap carts (400), refuses SEO-contract packages (400), then creates the Stripe Checkout session. Empty cart → 400 "Cart is empty" (verified by curl). Stripe off on dev ⇒ "Stripe not configured" is the expected endpoint state, verified by code + stripe-not-configured.test.ts. | curl (400 empty), code only | OK |
| `button-clear-cart` "Clear cart" | button | Empties the checkout lines (waiting sales requests stay until sent/dismissed). | cart-sheet.tsx:235-244 | client only | browser (badge 1 → gone; `localStorage` back to `[]`) | OK |
| `?cart_success=1` / `?cart_canceled=1` handling | side effect | After a Stripe redirect back: success clears the cart and toasts "Purchase successful!"; canceled toasts "No charges were made…". | cart-sheet.tsx:25-39 | Stripe redirect targets (server sets `success_url`/`cancel_url`) | code only | OK |
| Cart add-to-cart entries (pricing page, master-class page) | buttons (elsewhere) | The only producers of cart rows: pricing page services and master-class modules/bundle. Both hide the Add button and show "Talk to a sales rep" for anything ≥ $1,000 (`showsPrice`/`isSalesOnlyCartItem`). On current catalog data every item is ≥ $1,000, so no UI path can add a checkout line today — a pricing/catalog state, not a shell defect. | pricing.tsx:753-773; master-class.tsx:2509-2533,2560-2580; cart-context.tsx:125-131 | server mirror: `isSalesOnly` (server/catalog.ts:50) = `!showsPrice`, same `SALES_THRESHOLD_CENTS` ($100_000) both sides | code only + SQL (module prices 150000–200000 cents) | OK |

## Payment-needed banner (`client/src/components/payment-needed-banner.tsx`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Banner itself `banner-payment-needed` | banner | Shows on every signed-in platform page while the account's subscription status is one of "payment needed" (past_due, unpaid, incomplete, paused) — except platform admins. Copy: "Your last payment didn't go through. Your plan is paused until it's paid." | payment-needed-banner.tsx:11-20 | GET `/api/entitlements` (routes.ts:249-268) → `paymentNeeded = !isPlatformAdmin && PAYMENT_NEEDED_STATUSES.includes(subscriptionStatus)`; `PAYMENT_NEEDED_STATUSES` (shared/plans.ts:447) = past_due/unpaid/incomplete/paused, all outside `ACCESS_STATUSES` (active/trialing, line 434) — so "your plan is paused" matches what the plan gate enforces. For user 1: `subscriptionStatus:"active"` + platform admin ⇒ banner correctly hidden (verified absent in browser screenshots). | curl + code + browser (absent) | OK |
| "Update card" `link-payment-needed-billing` | button link | Opens Account settings → Billing, where the card can be updated; the comment in routes.ts:261 notes the plan comes back on its own once Stripe collects. | payment-needed-banner.tsx:21-23 | route check: `/settings?tab=billing` → `SettingsPage` billing section (`settings-section-billing` rendered, browser-verified) | route check, browser | OK |

## Hub assistant (`client/src/components/hub/hub-widget.tsx` — "Gabe")

Visible on growth-surface pages for signed-in users (hidden on token pages, auth, legal, `/admin/*`, client portal — `hubVisible`, hub-widget.tsx:52-68; confirmed absent on `/admin/issues` in the browser). The launcher is a fixed round gator button bottom-right; signed-in it offers preset chips plus free-text chat.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Launcher `hub-launcher` (+ `hub-welcome-dot`) | floating button | Opens Gabe's panel. First time a new builder account sees it, it carries an orange dot and (desktop, 15 s) a welcome bubble. | hub-widget.tsx:339-360,118-128 | GET `/api/hub/presets` (server/hub/routes.ts:184) → `tier`/`chat`; dev bypass ⇒ user 1 is `builder`, `chat:true` (verified) | browser, curl | OK |
| Welcome bubble `hub-welcome-bubble` | popover | "Welcome aboard! … Want a hand setting things up?" — × dismisses; "Show me around" opens the panel in welcome mode (welcome preset chips first). | hub-widget.tsx:318-337 | same GET (`welcome` preset ids) | browser (seen and opened via "Show me around" flow — greeting was the welcome variant) | OK |
| Panel header (mascot, "Gabe — your ConstructHUB guide", status line) | display | Shows Gabe's state (idle / "Thinking it over…"). | hub-widget.tsx:380-389 | — | browser | OK |
| `hub-new-chat` | icon button | Clears the transcript and starts over (only after messages exist). | hub-widget.tsx:390-395 | client only | browser (hidden with no messages — correct) | OK |
| `hub-close` | icon button | Closes the panel (Esc works too); focus returns to the launcher. | hub-widget.tsx:396-399,155-159 | client only | browser | OK |
| Greeting `hub-greeting` | text | First message: welcome variant, builder intro, browse intro, or an "my radio's down" offline notice. | hub-widget.tsx:308-314,402 | — | browser (welcome greeting shown) | OK |
| Message list `hub-messages` | log | The conversation; user bubbles right, Gabe left (markdown with page links that navigate and close the panel). Scrolls to a new answer's first line. | hub-widget.tsx:401-422,130-137 | — | code only | OK |
| Thinking indicator `hub-thinking` | animation | Three bouncing dots while Gabe answers. | hub-widget.tsx:424-435 | — | code only | OK |
| Offline state `hub-offline` + `hub-retry` | text + button | If `/api/hub/presets` can't be reached, the panel says so and offers "Try again" (re-fetches). | hub-widget.tsx:302-305,437-444 | GET `/api/hub/presets` | code only | OK |
| Quick-question chips `hub-chip-*` | buttons | Preset questions; tapping posts the question and shows the cached/template answer. "More questions"/"Fewer" expands the full preset list. Ignored while busy. | hub-widget.tsx:293-300,446-463 | POST `/api/hub/preset` `{presetId}` (server/hub/routes.ts:196) — zod-validated preset id, per-IP budget, answer from cache/template; 429 `slowdown` when over budget. 16 presets; 4 welcome chips seen in browser. | browser (chips render; POST verified by code + server/hub/routes.test.ts; not fired — AI generation) | OK |
| Chat input `hub-input` + char counter + `hub-send` | textarea + button | Free-text questions (signed-in builders only; 500-char cap, Enter sends). Sends the signed conversation plus the current page's `pageKey`. | hub-widget.tsx:467-505,232-280 | POST `/api/hub/chat` (server/hub/routes.ts:218): origin check → schema → signed-in builder → turn-signature check (`tampered`/`reset`) → per-minute/daily budgets → pre-filter → model call → output filter; replies carry `conversationId`/`index`/`sig` for the next turn. 401/403 `presetsOnly` downgrades the panel to chips. | browser (input + send render), code + server/hub/routes.test.ts (not fired — AI generation) | OK |
| Chat-off note `hub-chat-off` | text | Builder whose email isn't verified (and not dev bypass) sees "Chat with Gabe is off right now. The quick questions still work." | hub-widget.tsx:490-492 | `chat: builder && providerOk()` in the presets response | code only | OK |
| Signed-out CTA `hub-signup-cta` / `hub-signup-link` | text + link | Signed-out visitors: "Create a free account to ask Gabe anything." → `/auth`. | hub-widget.tsx:493-500 | route check: `/auth` → `AuthPage` | code only | OK |
| "Ask Gabe" dashboard nudge (`constructhub:hub-open` event) | integration | The dashboard's "Ask Gabe" button opens the panel with the question typed in (never auto-sends). | hub-widget.tsx:168-178; dashboard/gabe-nudge.tsx | client only | code only | OK |
| UI flags in localStorage (`hub.welcomeSeen`) | persistence | Only welcome-seen flags persist; the transcript never does. | hub-widget.tsx:48,70-71,188-195 | — | code only | OK |

# Lane 1 · Home dashboard — element map (audit 2026-10-04)

Scope: the signed-in home page (`client/src/pages/home.tsx`) and every component in
`client/src/components/dashboard/`. Server side: `server/dashboard/**` plus the CRM
helpers the CRM tiles reuse (`crmStatsFor`, `crmAttentionFor`, `crmTeamActivityFor`,
`orgSmsStatus`, `getOwnerSeatUsage`, `monthlyUsage`).

How the page loads: one `GET /api/dashboard` (`server/dashboard/index.ts`) returns the
whole payload — account header, every tile (each computed on its own 3 s budget), the
"Needs you today" list, cleared list, layout, hidden tiles, checklist, recent feed. A
60 s per-user server cache; the header Refresh button sends `?fresh=1` (throttled to
one per 10 s). Writes: `PUT/DELETE /api/dashboard/layout`, `PUT/DELETE
/api/dashboard/dismissals[/:key]`. The app shell itself gates on `GET /api/auth/me`
(`server/auth.ts:668`).

Verified against the live dev server (portal mode, dev bypass = user 1 "Veto", platform
admin, active CRM org `c5b47b8d…` "SKU Dry-Run", org timezone America/Los_Angeles), with
independent SQL on `constructhub_dev_a6`. All SQL/pref writes were test data and were
removed afterwards (`dashboard_prefs` and `dashboard_dismissals` are back to 0 rows for
user 1).

Legend for "Verified how": SQL = recomputed from the DB and matched the API value;
API = payload/curl check; browser = Playwright on `http://127.0.0.1:8301/?portal=0`;
code only = read-through, no live data could exercise it.

## Home page container (`client/src/pages/home.tsx`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Dashboard root `page-dashboard` | Region | The whole signed-in home page. | home.tsx:123 | GET /api/dashboard → server/dashboard/index.ts → aggregate.ts buildDashboard | browser | OK |
| Loading skeleton `skeleton-dashboard` | Skeleton | Grey placeholder shapes (header, card, 8 tiles) while the first dashboard answer loads. Purely visual — no sample numbers. | skeletons.tsx:21 | none (client only) | browser | OK |
| Error card `card-dashboard-error` | Alert | "Your dashboard didn't load" with the reason (server unreachable vs empty), shown when no payload arrived. | home.tsx:76 | none (client only) | code only | OK |
| Try again `button-dashboard-retry` | Button | Re-fetches GET /api/dashboard after a failure. | home.tsx:82 | GET /api/dashboard | code only | OK |
| Feature-flag drop of tiles | Filter (client) | Tiles behind an off client flag (SHOW_GOOGLE_REVIEWS, SHOW_COMPETITOR_INTEL — both on in this build) and their attention items are removed client-side; the server still computes them. | home.tsx:30-43 | n/a | code only | OK |
| Section visibility (`show.needs/crm/checklist/usage/recent/gabe`) | Layout gate | Renders each page section only when the saved layout has it on. Server also skips reading the checklist/recent feeds when those sections are off (aggregate.ts:117-123). | home.tsx:93-116 | dashboard_prefs.layout.sections | browser (customize save/reload) | OK |

## Dashboard header (`dashboard-header.tsx`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Greeting `text-dashboard-greeting` | Text | "Good morning/afternoon/evening" by the viewer's own clock, plus the first word of the account display name ("Good evening, Veto"); "Welcome back" when there is no name. Re-renders every minute. | dashboard-header.tsx:83,93 | account.firstName ← server/dashboard/account.ts accountHeader → users.display_name | browser + SQL (display_name "Veto") | OK |
| Plan chip `badge-dashboard-plan` | Link/badge | One pill for the plan state: "… trial · ends <relative>", "… · Payment past due" (amber), "… · Active" (green), or "No plan yet · Choose a plan". Click goes to /pricing (trial/none) or /settings?tab=billing (active/past_due). `data-plan-status` carries the status. | dashboard-header.tsx:16-52 | account.{planName,status,trialEndsAt} ← account.ts accountHeader → getEntitlements (subscriptions/users.access_grants); renewsAt/endsAt ← subscriptions row (SUBSCRIPTION_ORDER) | browser (shows "Agency · Active" for the platform admin: planName is the access plan, Agency = top plan) | OK |
| Meta line `text-dashboard-meta` | Text | Small grey facts after the chip: "Renews <date>" (active paid plan), "Plan ends <date>" (cancel-at-period-end), "Usage resets <date>" (when any monthly meter exists), always "Updated <relative>". | dashboard-header.tsx:84-97 | account.renewsAt/endsAt ← subscriptions.current_period_end / cancel_at; resetsAt ← growth-quotas.ts resetsAt (first of next month, **UTC**) | browser ("Usage resets Nov 1 · Updated just now"); renewsAt/endsAt paths code-only (user 1 has a Stripe-less grant) | OK (note: the monthly meters reset at 00:00 UTC — for an LA org that is 5pm PT the previous day; the printed date is the UTC date. Billing-meter territory, reported not changed.) |
| Refresh `button-dashboard-refresh` | Button | Re-fetches the dashboard bypassing the server's 60 s cache (`?fresh=1`, server allows one fresh build per 10 s per user; sooner clicks answer from the cache). Writes the answer into the same query cache; failure shows a "Couldn't refresh" toast. | home.tsx:58-69 | GET /api/dashboard?fresh=1 → index.ts allowFresh | browser (clicked; meta updated; no errors) | OK |
| "Sample data" badge `badge-dashboard-fixture` | Badge | Appears in the header only when the payload came from the dev-only sample scenarios (`?fixture=full|new|noplan`). Real accounts never see it. | dashboard-header.tsx:104 | GET /api/dashboard?fixture=… → fixture.ts (NODE_ENV !== production only) | browser (fixture scenario shows it) | OK |
| Open CRM (button) | Link | Solid button into the CRM gateway page (/crm-app), which sets up or opens the workspace. | dashboard-header.tsx:106 | client only; /crm-app → CrmGatewayPage (App.tsx:204) | browser (href /crm-app) | OK |
| Customize `button-dashboard-customize` | Button | Opens the "Customize dashboard" sheet (tiles, order, sections). | dashboard-header.tsx:107 | see Customize dialog section | browser | OK |
| More ▸ Manage plan `link-dashboard-manage-plan` | Menu link | Shown when the account has any plan status but "none"; opens Settings ▸ Billing. | dashboard-header.tsx:111 | client only; /settings?tab=billing → Settings billing section | browser | OK |
| More ▸ Feature pages `link-dashboard-feature-pages` | Menu link | Platform admins only; opens the feature-page status console. The API behind that page 403s non-admins (mirrors this gate). | dashboard-header.tsx:112 | client only; /admin/feature-pages → admin-feature-pages.tsx | browser (present for user 1) | OK |

## Plan usage card (`dashboard-header.tsx` UsageCard + `usage-strip.tsx`)

One meter per counted feature the plan includes; `-1` limit prints "· Unlimited" (platform
admin runs on the top plan, so every meter shows Unlimited here). Warn tone at ≥ 80 %,
"bad"/"Limit reached" at 100 % for monthly meters; standing counts (locations, sites,
seats) say "All in use" and only "Over your plan's limit" when used > limit (usage-strip.tsx:14-20).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card `card-dashboard-usage` ("Plan usage") | Card | Holds the meter strip; not rendered when the plan has no counted features. | dashboard-header.tsx:121-129 | account.usage ← server/dashboard/account.ts accountUsage | browser | OK |
| Permit searches `usage-searches` | Meter + link | Searches used this month vs the plan; opens Search Permits. | usage-strip.tsx:22 | growth_budgets key quota:user:<id>:searches:<UTC month>, period '0' (monthlyUsage, growth-quotas.ts:198) | SQL (used 0 in 2026-10; API 0) | OK |
| Ranking-grid credits `usage-rankings` | Meter + link | Grid scans used this month; opens the Ranking Grid. | usage-strip.tsx:22 | growth_budgets …:rankings:<month> | SQL+API (0/0) | OK |
| Site Scans `usage-siteScans` | Meter + link | Site scans used this month; opens Site Scan. | usage-strip.tsx:22 | growth_budgets …:siteScans:<month> | SQL (16) = API (16) | OK |
| Competitor scans `usage-competitorScans` | Meter + link | Competitor scans used this month; opens Competitor Intel. | usage-strip.tsx:22 | growth_budgets …:competitorScans:<month> | SQL+API (0) | OK |
| Texts `usage-texts` | Meter + link | Text segments used this month; opens Settings ▸ Billing. | usage-strip.tsx:22 | growth_budgets …:texts:<month> | SQL (313) = API (313) | OK |
| Locations `usage-locations` | Meter + link | Standing count of linked locations vs plan; opens Locations. | usage-strip.tsx:22 | used ← entitlements.ts locationCount (business_locations WHERE user_id); limit ← plan allowances | SQL (2) = API (2) | OK |
| Protected websites `usage-protectedSites` | Meter + link | Standing count of Click Guard sites vs plan; opens Click Guard. | usage-strip.tsx:22 | used ← count(tracked_domains WHERE user_id); limit ← allowances.protectedSites | SQL (12) = API (12) | OK |
| CRM seats `usage-crmSeats` | Meter + link | Standing count of team seats on the owner's plan (CRM + Agency teams share it); opens the CRM Team page. Only present for org owners. | usage-strip.tsx:22 | account.ts accountUsage → crm/tenancy.ts getOwnerSeatUsage (distinct u:<id>/e:<email> holders across owned orgs' members + agency_members) | SQL+API (used 4-5 while other lanes edited teams; limit -1) | OK |
| Meter tone/state text ("Almost at the limit", "Limit reached", "All in use", "Over your plan's limit") | Text | Derived client-side from used/limit/period. | usage-strip.tsx:14-20,38 | same source as the meter | code only (all Unlimited here, so tones can't trigger) | OK |

## "Needs you today" card (`needs-today.tsx`)

The action list the server computed: every tile metric already marked warn/bad, usage
meters at/over limit (monthly at limit = bad; standing count over = warn), unread
alerts, a past-due plan (shared/dashboard.ts dashboardAttention). Cleared/snoozed items
are taken out by the route on every answer, fresh from `dashboard_dismissals`.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card `card-dashboard-needs` + heading count | Card | Lists the numbers that want action, worst (bad) first. `data-count` = live items, `data-cleared` = hidden ones. | needs-today.tsx:174-179 | dashboardAttention over every tile + account (shared/dashboard.ts:344-377) | browser (4 items) + SQL cross-check of each value | OK |
| Item row `needs-<tileKey>.<metric>` | Row | Shows the number, label, source and hint, coloured by tone; the row is a link to the tool. | needs-today.tsx:196-222 | per-item source = the tile's own query (see Tile grid rows) | browser (4 rows: Click Guard 13 warn, CRM sold-not-scheduled 503 warn, leads-without-estimate 655 warn, unread alerts 41 warn) | OK |
| Item link `link-needs-<key>` | Link | Opens the tool behind the item (e.g. /google-ads, portal /crm, /crm/pipeline, /settings?tab=notifications). | needs-today.tsx:205-211 | item.href from the tile/usage/notifications definition | browser (hrefs verified) | OK |
| Done `button-needs-done-<key>` | Button | Marks the item "done": it stays hidden until its number changes. Not offered for "Payment past due" (its number never changes while past due — the server also refuses a Done on it, shared/dashboard-prefs.ts:341). | needs-today.tsx:225-237 | PUT /api/dashboard/dismissals {items:[{key,value,until:null}], scope} → prefs.ts saveDashboardDismissals → dashboard_dismissals (upsert by user+scope+key) | API roundtrip (PUT cleared:1; row in DB; wrong-value and moving-value cases verified: item returns when the value changes) | OK |
| Snooze `button-needs-snooze-<key>` + menu | Button + menu | Hides the item until tomorrow 8:00 or for a week (viewer's clock, shared/dashboard-prefs.ts snoozeUntil). | needs-today.tsx:238-260 | same PUT with until (server caps at 31 days) | API roundtrip (snoozed item moved to cleared with until; gone from attention) | OK |
| Clear all `button-needs-clear-all` | Button | Marks every Done-able item done in one tap (snooze-only items skipped). | needs-today.tsx:182-192 | same PUT, batched (≤ 50 items server-side) | code only (button present; same endpoint verified) | OK |
| Undo (toast action) `button-needs-undo` | Toast button | Immediately restores the just-cleared items. | needs-today.tsx:86-95 | DELETE /api/dashboard/dismissals/:key for each | code only | OK |
| Show cleared `button-needs-show-cleared` | Toggle | Expands the list of hidden items with the reason ("Snoozed until …" / "Done · comes back if the number changes"). | needs-today.tsx:109-121 | payload.cleared ← index.ts withDismissals → prefs.ts splitAttention (value must match attentionSignature; ended snoozes dropped) | browser (toggle absent at 0; verified via API cleared array) | OK |
| Cleared row `cleared-<key>` | Row | One hidden item with its number, note and Restore button. | needs-today.tsx:131-153 | same | API | OK |
| Restore / Restore all `button-needs-restore[-all]-<key>` | Button | Puts items back into "Needs you today". CRM items restore only within the org they were cleared in (`?scope=`). | needs-today.tsx:127-129,141-150 | DELETE /api/dashboard/dismissals[/:key][?scope=] → prefs.ts deleteDashboardDismissals | API (restored:1; row gone; final DB count 0) | OK |
| Empty state (`data-count="0"`) | Text | "Nothing needs you today. Your numbers are below." | needs-today.tsx:157-171 | n/a | code only | OK |

## CRM snapshot card (`crm-snapshot-card.tsx`)

The "crm" tile rendered wide above the grid, with the leads/schedule tiles' numbers on
its second row (those tiles never appear as grid cards — shared/dashboard-prefs.ts:34).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card `card-dashboard-crm` + title/description | Card | "ConstructHub CRM" with the tile's one-line description; an account without a CRM sees "Your CRM is included with your plan." | crm-snapshot-card.tsx:47-58 | tiles/run.ts crm → crm/stats.ts crmStatsFor (org = active CRM org, read-only lookup) | browser | OK |
| Open the CRM `link-dashboard-crm` | Link | Opens the CRM (portal host). When the CRM is empty the label is "Set up the CRM" → /crm-app. | crm-snapshot-card.tsx:60-66 | client only | browser (href portal…/crm) | OK |
| Pipeline value `metric-crm-pipeline` | Stat | Dollars of every live project (not cancelled/paid, not archived); hint counts them. | crm-snapshot-card.tsx:69-73 → dashboard-tile.tsx:19 | crm_projects WHERE org_id, archived_at IS NULL, status NOT IN (cancelled,paid); sum contract_value_cents | SQL (2,437 / $2,971,666.74) = API | OK |
| Open estimates `metric-crm-openEstimates` | Stat | Estimates sent or being viewed, with total quoted dollars. | crm-snapshot-card.tsx:69-73 | crm_estimates status IN (sent,viewed); sum total_cents | SQL (2,316 / $3,807,758.13) = API | OK |
| Jobs won `metric-crm-jobsWon` | Stat | Approved estimates (count + approved dollars), green when any. | crm-snapshot-card.tsx:69-73 | crm_estimates status='approved'; sum coalesce(approved_total_cents,total_cents) | SQL (1,602 / $6,627,666.05) = API | OK |
| Open invoices `metric-crm-openInvoices` | Stat | Unpaid invoice balance (sent/partial), floor 0 per row. | crm-snapshot-card.tsx:69-73 | crm_invoices status IN (sent,partial); sum greatest(total_cents-paid_cents,0) | SQL (540 / $677,683.55) = API | OK |
| Sold, not scheduled `metric-crm-unscheduled` | Stat | Projects approved but not archived (sold, still to put on the calendar); warn tone when any → also a "Needs you today" item. | crm-snapshot-card.tsx:69-73 | crm_projects status='approved' AND archived_at IS NULL | SQL (502→503) = API (moves as other lanes work) | OK |
| Active clients `metric-crm-clients` | Stat | Customers not archived. | crm-snapshot-card.tsx:69-73 | crm_customers archived_at IS NULL | SQL (7,506) = API | OK |
| Today's work row `row-dashboard-crm-work` | Link row | Follow-ups due, New leads (7 days), Leads without an estimate (from the leads tile) and Today / Next 7 days visits (from the schedule tile) — each linking to its own CRM page. A visit count already on the first row (crew seats) is not repeated. | crm-snapshot-card.tsx:18-29,74-94 | run.ts crmLeads (crm/follow-ups.ts crmAttentionFor) and crmSchedule | browser + SQL | OK, except: |
| "Today" `metric-crmSchedule-today` | Stat | Visits starting today. **Was BUG: counted a UTC day** — at 5-9pm Pacific the tile counted tomorrow morning's visits and dropped this evening's, disagreeing with the schedule page it links to. Fixed to the org timezone's day (crm_orgs.timezone). | crm-snapshot-card.tsx:74-94; fix server/dashboard/tiles/run.ts startOfOrgDay | crm_appointments WHERE org_id, status≠'canceled', starts_at in [org-day start, +1d) — visible-appointment rules (object policy: division scope, crew see only own/dispatched) | SQL (0) = API (0); fix verified by server/dashboard/org-day.test.ts | OK (fixed this audit) |
| "Next 7 days" `metric-crmSchedule-week` | Stat | Visits in the next 7 days, same window fix as "Today". | crm-snapshot-card.tsx:74-94 | crm_appointments starts_at in [org-day start, +7d), limit 2000 rows | SQL (1) = API (1); same fix | OK (fixed this audit) |
| "Today's visits" (crew seat hero) | Stat | For a member without reporting permission the card shows only their own day (visits they booked or are dispatched to). Same window fix. | tiles/run.ts crm (non-reporting branch) | visibleAppointments(ownOnly) | code only (user 1 is an owner) | OK (fixed this audit) |
| New leads (7 days) `metric-crmLeads-newLeads7d` | Stat | Prospect-stage projects created in the last 7 days. Hint "newest 1,000 leads counted" appears when the open-lead read hit its 1,000-row cap; the 7-day count itself is unaffected by the cap (all 7-day leads fit in the newest 1,000 whenever under 1,000). | tiles/run.ts crmLeads | crm_projects status IN (Prospect group), archived_at IS NULL, created_at ≥ now-7d, visibility (viewAllJobs/PM/division); reads the newest 1000 prospect rows first | SQL (752, all 7-day leads inside the cap) ≈ API (752-753, ±1 = build-time boundary) | OK |
| Follow-ups due `metric-crmLeads-followUpsDue` | Stat | Customers whose follow-up cadence is due (shared CRM function). | tiles/run.ts crmLeads → follow-ups.ts | customers with cadence_days, due = last_follow_up/created + cadence | code only (0 here; shared CRM logic) | OK |
| Leads without an estimate `metric-crmLeads-needEstimate` | Stat | Visible prospects with no estimate pointing at the project or its customer. **Counted over the newest 1,000 open leads only** — for a 1,912-lead org the API showed 655 while the true count is 1,257. The hint "newest 1,000 leads counted" discloses the cap; lifting it is a perf/product decision (the CRM's own card caps at 200). | tiles/run.ts crmLeads (LEAD_ROWS=1000) | newest 1000 prospect rows → anti-join on estimates (project or customer) | SQL: capped window counts 655 inside newest 1,000; uncapped truth 1,257 | OK with disclosed cap (reported, not changed) |
| Schedule / Pipeline links `link-tile-crmSchedule`, `link-tile-crmLeads` | Links | Quick links into the CRM schedule and pipeline. | crm-snapshot-card.tsx:101-115 | client only (portal /crm/schedule, /crm/pipeline) | browser | OK |
| Work-source error note `text-dashboard-crm-work-error` | Text | "Leads and follow-ups / The schedule didn't load. Open the CRM for live numbers." when one of those tiles errored. | crm-snapshot-card.tsx:40-41,95-100 | tile status 'error' (source threw / 3 s timeout) | code only | OK |
| Locked CRM prompt `locked-crm` (compact) | Upsell box | "Included with the Starter/paid plan." + "See what it does" (/features/crm) + "See plans" (/pricing). Rendered when the tile is locked. | crm-snapshot-card.tsx:122-126, locked-prompt.tsx | tileAccess gate (access.ts) mirrors requireModule/requirePlan; server never reads CRM data for a locked tile | browser (fixture=noplan) | OK |
| CRM tile error state | Text | "The CRM didn't answer in time…" + still links to the CRM. | crm-snapshot-card.tsx:116-121 | tile status 'error' | code only | OK |

## Getting-started checklist (`checklist-card.tsx`)

Server: server/dashboard/checklist.ts — steps that apply to the plan, each `done` from
real state; the card hides when every shown step is done. The collapse choice is
localStorage-only (`constructhub:dashboard:checklist-collapsed`) — per browser, by design.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card `card-dashboard-checklist` ("Getting started") | Card | Setup steps with a progress bar; hidden entirely when all applicable steps are done or none apply. | checklist-card.tsx:14-24 | buildChecklist (per-step SQL below) | browser ("5 of 9 done") | OK |
| Count `text-checklist-count` + progress | Text/bar | "N of M done" and a bar. | checklist-card.tsx:29-31 | same | browser (5/9; matches API) | OK |
| Toggle `button-checklist-toggle` | Button | Collapses/expands the step grid; remembered in this browser's localStorage only. | checklist-card.tsx:33-45 | client only | browser | OK |
| Step row `checklist-<key>` / `link-checklist-<key>` | Link | Each step links where the step is done: Connect Google → /locations; Add a location → /locations; Turn on Profile Guard → /locations; Run a Site Scan → /site-scan; Ask for a review → /google-reviews; Protect your website → /google-ads; Set up the CRM → /crm-app (or portal /crm); Invite a teammate → /crm/team?tab=team (or /crm-app); Turn on client texting → /crm/settings. | checklist-card.tsx:46-84 | done-flags: gbp_grants row; business_locations count; gbp_guard mode≠'off'; sitescan_jobs row; review_requests row; tracked_domains count; CRM onboarding (member profile + org details, respecting manageSettings); >1 active/invited member in an owned org or an agency_members row; orgSmsStatus(org).configured | browser + SQL (each flag matched: grants 0 → connectGoogle open; locations 2 → done; guarded 0 → open; scans 6 → done; requests 25 → done; domains 12 → done; member display_name empty → setUpCrm open; members 2-3 → inviteTeammate done; no SMS sender → addTextingNumber open) | OK |
| "Next step" badge + Start button look `badge-checklist-next` | Badge/button-look | The first open step is highlighted "Next step" with a Start arrow (visual only — the whole row is the link). | checklist-card.tsx:64-76 | client only | browser | OK |

## Tile grid (`tile-grid.tsx`) and tile cards (`dashboard-tile.tsx`)

The tools, in the user's order, grouped ("Keep groups" on) or one list. Locked tiles fold
into one compact row per group (or under the list): icon, name, plan chip, a "See what it
does" link to the feature intro page, and one "See plans" (or "See add-ons" when every
locked tile is an add-on) link to /pricing. Every tile keeps `tile-<key>` and
`data-status`.

Verified tile-by-tile against SQL for user 1 (values move as other lanes work the shared
DB; each match was re-run at verification time):

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Group headings `section-dashboard-<group>` (Grow / Protect / Win jobs / Run the business / Learn) | Sections | Group label + one-line blurb; groups in the order their first tile appears in the user's layout. | tile-grid.tsx:131-156 | layout.order via dashboardGroupsInOrder | browser | OK |
| Ungrouped list `section-dashboard-all` ("Your tools — In your order.") | Section | The keepGroups=off layout: one grid in the user's order, locked tiles in one row beneath. | tile-grid.tsx:112-129 | same | code only (keepGroups on here) | OK |
| All-hidden empty state `text-dashboard-tiles-empty` + Choose tools | Empty state | "You've hidden every tool from your dashboard. They're all still in the menu." with a button that opens Customize. | tile-grid.tsx:100-111 | n/a | code only | OK |
| Locked row `locked-row-<group>` ("On a higher plan" / "Not on your plan") | Upsell row | One row for the group's locked tiles: plan chips with per-tile "see what it does" intro links and a single "See plans" (/pricing, or /pricing#add-ons when all locked tiles are add-ons, e.g. only the AI Call Assistant). | tile-grid.tsx:23-89 | tileAccess requiredPlan / addon (access.ts) | browser (fixture=noplan: chips "Included with the Starter/Pro/Agency plan", callAssistant chip "Add-on", links /features/<slug>, /pricing) | OK |
| Status pill `status-<key>` ("Coming soon") | Badge | **Unreachable in this build**: the coming_soon status needs an add-on marked `preview` in shared/plans.ts, and none is (comment at plans.ts:353: every Call Assistant tier is for sale). The pill branch is dead code, as is the whole `locked` branch of DashboardTileCard (TileGrid filters locked tiles into LockedRow before rendering cards). | dashboard-tile.tsx:71-97, 141-145 | access.ts addon gate | code only | DEAD (code only, nothing a user can see) |
| Error pill `status-<key>` ("Didn't load") | Badge | Tile source threw or hit the 3 s budget; the tile still links to its page. | dashboard-tile.tsx:86-91 | aggregate.ts withTimeout → error message | code only | OK |
| "Not set up" pill `status-<key>` | Badge | Entitled but nothing set up yet; the CTA becomes a solid outline button (e.g. "Connect Cloudflare"). | dashboard-tile.tsx:92-93 | source EMPTY outcome | browser (8 empty tiles with correct CTAs/links) | OK |

Per-tile numbers (hero metric first, then up to two secondary rows; each prints as
`metric-<tileKey>-<metric>`; the card chrome is dashboard-tile.tsx:101-198 and every
number is fetched inside GET /api/dashboard):

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Google Business Profile `tile-gbp` | Tile + numbers | Counts Google accounts (grants), locations with a sync error, and linked locations vs plan; "Connect Google" CTA when no grant. Extra link: GMB Edit Monitor → /gmb-monitor. | dashboard-tile.tsx:101-198; tiles/grow.ts:10 gbp | gbp_grants (user_id, reconnect_required); gbp_sync_status.last_error joined to business_locations (user_id); locationCount(business_locations) | SQL (0 accounts / 0 sync issues / 2 locations) = API | OK |
| Google Reviews `tile-reviews` | Tile + numbers | Average rating, reviews from the last 7 days, and reviews still without a reply; while no review is imported it shows review requests sent and sent in the last 30 days instead. | tiles/grow.ts:29 reviews | google_profile_reviews (user_id, google_deleted IS NOT TRUE; avg rating, review_date > now-7d, reply_comment IS NULL); review_requests (user_id, created_at > now-30d); EXISTS gbp_grants | SQL (0 reviews; 25 requests, 25 in 30d) = API | OK |
| Profile Guard `tile-profileGuard` | Tile + numbers | Google-profile edits waiting on a review, locations guarded, and when it last checked; CTA opens the location with pending edits. | tiles/grow.ts:57 profileGuard | gbp_guard (user_id, mode≠'off', max checked_at); gbp_guard_changes status='pending' | SQL (0 pending / 0 guarded / no last check) = API | OK |
| GMB Ranking Grid `tile-rankingGrid` | Tile (empty) | "Run a grid" until the first scan; then last grid's average rank, when it ran, and this month's grid credits vs plan. | tiles/grow.ts:75 rankingGrid | ranking_grid_scans (user_id, status='completed', latest); growth_budgets …:rankings:<UTC month> | API empty; SQL (0 scans) agrees | OK |
| Posts & Photos `tile-gbpContent` | Tile (empty) | Scheduled posts, published in the last 30 days, and posts needing attention (failed/uncertain/rejected). | tiles/grow.ts:91 gbpContent | gbp_content_jobs (user_id; queued; published with coalesce(started_at,due_at,created_at) > now-30d; failed/uncertain/rejected) | API empty; SQL shape | OK |
| Social Media `tile-social` | Tile (empty) | Scheduled posts, published in the last 30 days, failed posts; "Connect social accounts" until a social account is linked. | tiles/grow.ts:106 social | social_connections (user_id) EXISTS; social_posts (user_id; state='queued'; published & updated_at > now-30d; failed/uncertain) | API empty; code only | OK |
| Site Scan `tile-siteScan` | Tile + numbers | Last completed scan's overall score (green ≥ 80, amber ≥ 50), scans used this month vs plan, and when the last scan ran. | tiles/grow.ts:122 siteScan | sitescan_jobs (user_id, status='completed', report scores.overall, latest completed_at); growth_budgets …:siteScans:<month> | SQL (score 90, last 2026-10-01T01:37Z, meter 16) = API | OK |
| Photo Optimizer `tile-media` | Tile (empty) | Photos stored and folders in the media library; "Upload photos" CTA. Extra link: Optimize photos → /photos. | tiles/grow.ts:140 media | media_photos (user_id) count; media_folders (user_id) count | API empty; SQL (0/0) agrees | OK |
| Click Guard `tile-clickGuard` | Tile + numbers | Suspicious clicks in the last 30 days (warn when any), IPs currently excluded, and sites protected vs plan. | tiles/protect.ts:12 clickGuard | click_visits (domain_id IN user's tracked_domains, is_suspicious, visited_at > now-30d); blocked_ips (is_active); count(tracked_domains) | SQL (13 / 2 / 12) = API | OK |
| IP Tracker `tile-ipTracker` | Tile + numbers | Website visits in the last 7 days and distinct visitor IPs in the same window. | tiles/protect.ts:26 ipTracker | click_visits (same domain scope, visited_at > now-7d; count + count DISTINCT ip_address) | SQL (55 visits / 29 unique) = API | OK |
| VPN Shield `tile-vpnShield` | Tile + numbers | VPN/proxy visits blocked in the last 30 days and how many distinct IPs that was. | tiles/protect.ts:38 vpnShield | vpn_visits (domain scope, action='blocked', visited_at > now-30d; count + distinct ip) | SQL (0 / 0) = API | OK |
| Cloudflare `tile-cloudflare` | Tile (empty) | Zones, connected accounts, and zones reporting an error across the Cloudflare connections. | tiles/protect.ts:50 cloudflare | edge_connections (user_id, provider='cloudflare'); edge_assets (same; count, error IS NOT NULL) | API empty (no connections) | OK |
| Search Console `tile-searchConsole` | Tile (empty) | Synced Search Console properties, clicks and impressions over the last 28 days; shows "—" (never 0) until a day of data has synced. | tiles/protect.ts:63 searchConsole | edge_connections/edge_assets (provider='gsc'); gsc_analytics joined to the user's gsc assets (dimension='date', date > current_date - 28, sum clicks/impressions) | API empty; null-vs-0 rule code-verified | OK |
| Domains `tile-domains` | Tile + numbers | Domains watched, any expiring within 30 days (already-lapsed included), and domains with auto-renew off. | tiles/protect.ts:81 domains | managed_domains (user_id); state->>'expires' within ceil ≤ 30 days (same rule as server/domains/service.ts); state->>'autoRenew' = 'false' | SQL (3 / 0 / 0) = API | OK |
| Mail alerts `tile-mailAlerts` | Tile + numbers | Unread provider-alert emails and alerts received in the last 7 days (unexpired only). | tiles/protect.ts:99 mailAlerts | mail_alert_messages (user_id, expires_at > now; read_at IS NULL; received_at > now-7d); mail_alert_addresses / mail_alert_grants EXISTS | SQL (0 / 0, forwarding address set) = API | OK |
| Search Permits `tile-permits` | Tile + numbers | Permit searches in the last 7 days, when you last searched, and this month's searches vs plan. Extra links: Search history → /history, Database directory → /databases; platform admins also get Scrape Schedules → /schedules. | tiles/win.ts:15 permits | search_queries (user_id, created_at > now-7d, max created_at); growth_budgets …:searches:<month> | SQL (7, last 2026-09-30, meter 0) = API; admin link rendered | OK |
| Property Records `tile-property` | Link tile | No count by design (reference data is the same for every account): "Look up a property" → /property. | tiles/win.ts:31 property | none (static ok([]) outcome) | browser | OK |
| Competitor Intel `tile-competitors` | Tile + numbers | Competitors found by the last completed scan, when it ran, and this month's scans vs plan; "—" until a scan completes. | tiles/win.ts:33 competitors | competitor_scans (user_id, latest status='completed' total_found/created_at); growth_budgets …:competitorScans:<month> | SQL (2 scans, none completed → —) = API | OK |
| Agency Ads & LSA `tile-adsManager` | Tile (empty) | Client ad accounts, which have Local Services, and audit findings from the latest audit. Ad spend/clicks are deliberately not shown (the snapshot has no metrics fields — nothing is estimated). Extra admin link: Account Manager → /lsa-account-manager. | tiles/win.ts:49 adsManager | ads_grants EXISTS; ads_accounts (user_id, NOT manager; lsa); ads_findings (user_id) | API empty (no ads_grants); spend omission documented in the file header | OK |
| LSA Leads `tile-lsaLeads` | Tile (empty) | LSA leads from the last 30 days, disputes in flight, last sync, and last reported cost. | tiles/win.ts:63 lsaLeads | lsa_connections (user_id, refresh_token NOT NULL; last_sync_at, last_cost_total); lsa_leads (coalesce(lead_creation_time, created_at) > now-30d; dispute_status IN scheduled/queued/sending) | API empty (no connection row); SQL agrees | OK |
| Texting `tile-texting` | Tile + numbers | Whether client texting is configured for the CRM org, and (org owner only) texts used this month vs the org owner's plan. Locked when the org owner's plan has no texting. | tiles/run.ts:103 texting | orgSmsStatus(crm_orgs.customFields) sender configured; growth_budgets …:texts:<month> on the OWNER's allowance | API ("Off"; owner meter 313 = usage strip) | OK |
| AI Call Assistant `tile-callAssistant` | Link tile | No numbers on the dashboard (the page has its own meters): "Open Call Assistant" → /call-assistant when the add-on is on. Without the add-on the tile is locked ("Included with the Pro plan"); its locked-row chip reads "Add-on". | tiles/run.ts:55 callAssistant; gate access.ts addon | none (static link); gate = entitlements.addonModules.callAssistant, mirrors requireModule | browser (ok for platform admin; fixture=noplan shows locked + add-on chip) | OK |
| Agency workspace `tile-agency` | Tile + numbers | Agency clients, agency teammates, and locations vs plan. | tiles/run.ts:119 agency | agency_clients (user_id); agency_members (user_id); locationCount | SQL (2 clients / 0 teammates / 2 locations) = API | OK |
| Master Class `tile-masterClass` | Tile + numbers | Course modules unlocked (a bundle unlocks all), of the active modules. | tiles/learn.ts:10 masterClass | master_class_modules (is_active) count; course_purchases (user_id; is_bundle unlocks all; distinct active module_id otherwise) | SQL (0 of 4) = API | OK |
| Guides `tile-guides` | Link tile | "Browse guides" → /guides plus extra links: Google Ads guide, LSA guide, Ad fraud. | tiles/learn.ts:23 guides | none (static link tile) | browser (hrefs verified) | OK |
| Reinstatement `tile-reinstatement` | Link tile | "Get help" → /reinstatement. | tiles/learn.ts:24 reinstatement | none (static link tile) | browser | OK |

## Recent activity (`recent-activity.tsx`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card `list-dashboard-recent` | Feed | The user's own notifications (30 days, up to 10) merged with the active org's Team Activity (up to 5, reporting seats only — same gate as /api/crm/team-activity), newest first, at most 12 shown. | recent-activity.tsx:40-73 | server/dashboard/recent.ts buildRecent: user_notifications created_at > now-30d LIMIT 10 + crmTeamActivityFor(org, 5) (crm_team_activity + estimate events sent/viewed/approved/declined/shared + succeeded payments) | SQL (44 notifications in 30d; 5 CRM items merged with 7 notification rows = 12 on screen) | OK |
| Row `recent-<id>` | Link/row | Title, optional body, severity prefix ("Urgent ·", "Needs a look ·", "CRM ·") and relative time; unread notifications get a dot and bold title. Rows link to the notification's path (CRM paths go to the portal host; non-path links are dropped, never guessed). | recent-activity.tsx:8-37,60-68 | recent.ts notifications()/crmActivity() | browser (dots on unread; portal hrefs) | OK |
| View all `link-dashboard-recent-all` | Link | Opens Settings ▸ Notifications. | recent-activity.tsx:45-51 | client only; /settings?tab=notifications is a valid section | browser | OK |
| Empty state `text-dashboard-recent-empty` | Text | "Nothing yet. Activity from your tools shows up here." | recent-activity.tsx:53-56 | n/a | code only | OK |

## Ask Gabe nudge (`gabe-nudge.tsx`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Sentence `text-dashboard-gabe` | Text | One line built from the first open checklist step ("Ask Gabe how to connect Google."); generic line when the checklist is done. | gabe-nudge.tsx:23-27 | payload.checklist | browser | OK |
| Ask Gabe `button-dashboard-ask-gabe` | Button | Opens the Hub assistant with the question typed in — a window event the Hub widget listens for; nothing is sent. | gabe-nudge.tsx:28,40-43 | client only (HUB_OPEN_EVENT) | browser (Hub opened, textarea prefilled "How do I connect Google?") | OK |

## Customize dashboard sheet (`customize-dashboard.tsx`)

Everything edits a client-side draft; nothing persists until Save. Saved to the account
(server table `dashboard_prefs`), so it follows the user across devices — verified:
hide + reorder survived a full page reload, and Reset (DELETE) restored the default.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Sheet `sheet-customize-dashboard` | Dialog | "Choose what shows and in what order." Draft resets from the saved layout each time it opens. | customize-dashboard.tsx:116-133,237-243 | payload.layout (readDashboardLayout) | browser | OK |
| Count `text-customize-count` | Text | "N of M shown". | customize-dashboard.tsx:248 | n/a | browser ("26 of 26", "25 of 26" after one hide) | OK |
| Select all / none `button-customize-select-all/none` | Buttons | Shows or hides every listed tool at once. | customize-dashboard.tsx:250-252 | n/a | code only | OK |
| Keep groups `switch-customize-keep-groups` | Switch | Grouped headings vs one flat list; turning it on re-groups the order (groupContiguous). | customize-dashboard.tsx:169,254-262 | layout.keepGroups | browser | OK |
| Tile rows `customize-tile-<key>` + checkbox `checkbox-customize-<key>` | Checkbox row | Show/hide per tool. Hidden tools leave the grid **but their alerts stay in "Needs you today"** (the server still computes hidden tiles — verified: hiding clickGuard removed the tile but kept its attention item). Locked tools show a plan "Add-on"/plan chip; they can be shown/hidden but never unlocked here. | customize-dashboard.tsx:135-225 | layout.hidden (PUT /api/dashboard/layout) — server: aggregate.ts computes every tile, splitDashboardTiles moves hidden ones to hiddenTiles | browser + API (hide persisted; attention kept; hiddenTiles lists it) | OK |
| Reorder grip `handle-customize-<key>` (drag or ↑↓ Home End), arrow buttons `button-customize-up/down-<key>` | Reorder | Moves the tool within its group (or the flat list); the order persists. | customize-dashboard.tsx:39-105 | layout.order | browser (moved Social Media below Site Scan; order saved, survived reload) | OK |
| Group up/down `button-customize-group-up/down-<group>` | Buttons | Moves a whole group (and its tools) in the grouped view. | customize-dashboard.tsx:180-186 | layout.order | code only | OK |
| Plan/Add-on/Coming soon chips in rows | Badges | `badge-customize-locked-<key>` etc. — same plan facts as the locked rows. | customize-dashboard.tsx:213-218 | hiddenTiles/tiles status | browser (fixture) | OK |
| Sections checkboxes `checkbox-customize-section-<key>` (6: Needs you today, CRM snapshot, Getting started, Plan usage, Recent activity, Ask Gabe) | Checkboxes | Show/hide whole page sections. The server also skips reading the checklist/recent feeds when those sections are off. | customize-dashboard.tsx:310-333 | layout.sections | browser | OK |
| Reset to default `button-customize-reset` | Button | Draft back to the catalogue default (disabled when already default). On Save, a default layout is stored as **no row** (DELETE /api/dashboard/layout). | customize-dashboard.tsx:339-346; use-dashboard-prefs.ts:102-107 | PUT saves {order, hidden, sections, keepGroups}; DELETE dashboard_prefs row | browser + API (reset restored tile; DB row count back to 0) | OK |
| Cancel `button-customize-cancel` / Save `button-customize-save` | Buttons | Cancel discards the draft; Save PUTs the layout (or DELETEs when it equals the default), closes the sheet, and refetches the dashboard. Failed saves roll back the optimistic update and toast. | customize-dashboard.tsx:227-232,347-349 | parseDashboardLayoutInput validates (caps 100 keys/60 chars; unknown keys dropped, newer-client safe) | browser + API | OK |

## Server routes these pages call

| METHOD /path | Handler | What it does | Verified how | Status |
|---|---|---|---|---|
| GET /api/dashboard | server/dashboard/index.ts:95 | Per-user aggregate (60 s cache, pinned-org keyed; ?fresh=1 throttled; ?fixture= dev-only sample payloads). | SQL + browser | OK |
| PUT /api/dashboard/layout | index.ts:135 | Saves tile order/hidden/sections/keepGroups (default stored as no row); forgets the cached dashboard. | API roundtrip | OK |
| DELETE /api/dashboard/layout | index.ts:150 | Back to the default layout. | API roundtrip | OK |
| PUT /api/dashboard/dismissals | index.ts:162 | Clear/snooze "Needs you today" items ({items:[{key,value,until}], scope}); CRM items scoped to the payload's org; ≤ 50 per call; snooze ≤ 31 days; "billing" can't be Done. | API roundtrip + unit tests | OK |
| DELETE /api/dashboard/dismissals[/:key] | index.ts:174,185 | Restore one or all clears; `?scope=` limits CRM-item restores to one org. | API roundtrip | OK |
| GET /api/auth/me | server/auth.ts:668 | The app shell's session check the page renders behind (not dashboard-specific). | browser | OK |

Notes for other lanes / the owner (reported, not changed):
- Monthly meters (usage strip, "this month" hints, "Usage resets …") run on the **UTC
  month**; an LA org's counts roll at 5pm PT on the last day of the month. Billing rules —
  reported only.
- `crmLeads.needEstimate` is capped at the newest 1,000 open leads (hint discloses it);
  the uncapped truth for the test org was 1,257 vs the 655 shown.
- The app shell also renders the sidebar, notification bell, cart, cookie banner and the
  Hub (Gabe) launcher around this page — owned by other lanes, not mapped here.

# Lane 1 · Settings — the account-side tabs (`/settings`)

Audit agent: setme · branch audit/1 · 2026-10-04
Scope: the settings shell and the **Me** tabs (My account, Password & security, Notifications) plus
**Workspace → Integrations** and **Workspace → Audit log**. The other Workspace tabs (Billing,
Limits & usage, API keys, API usage) render panels owned by other lanes — they are listed in the
shell map only as nav entries. Dev user: platform admin id 1 (dev@constructhub.local) on
`constructhub_dev_a6`. The dev server runs portal-mode, so pages were verified in the growth app via
`?portal=0` (portal mode renders CRM home for `/settings`; the growth settings page is unreachable
there by design of `PortalRouter` — App.tsx:388).

Server files behind these pages: `server/auth.ts` (me, profile, change-password, 2FA),
`server/account-security.ts` (devices, recovery codes, reauth), `server/account-events.ts`
(notification prefs, account activity), `server/account/integrations-route.ts` (integrations),
`server/routes.ts` (review-templates, beta-codes, upload/logo, review-referral-settings),
`server/gbp/routes.ts` (gbp status/disconnect).

Legend — Verified how: SQL = read-only psql on constructhub_dev_a6; curl = GET/PUT against
127.0.0.1:8301/api (dev bypass user 1); browser = Playwright chromium with ch_consent=denied;
route check = route exists in client/src/App.tsx; code only = no live proof taken.

## Shell (`/settings`, client/src/pages/settings.tsx + settings/nav.tsx + settings/sections.tsx + settings/shared.tsx)

The shell: header "Account settings / Manage your account and workspace.", a close button, a left
rail (lg+) or sheet menu (below lg) with two groups, the section header (title + description + ⓘ
InfoTip from lib/info-content.ts), and the active section's panel. The open section is `?tab=` so
reloads/deep links reopen it; old tab names (profile, password, plans, invoices, usage, api, audit…)
resolve through TAB_ALIASES (sections.tsx:76). `/settings/billing[?billing=invoices]` and
`/settings/api[?api=usage]` redirect to `?tab=` (App.tsx:133-150). Unknown `?tab=` falls back to
My account. Signed-out visitors are sent to `/auth?next=/settings…` (SIGNED_IN_ONLY, App.tsx:336).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Account settings" title / text-settings-title | Heading | Names the page. | settings.tsx:66 | — client only | browser | OK |
| Close (X) / button-close-settings | Button | Goes back one entry if you arrived in-app, otherwise home (`/`). | settings.tsx:67-82 (previousEntryIsInApp:30) | — client only | code only | OK |
| Left rail "Me" group (My account, Password & security, Notifications) / nav-settings-group-me, button-settings-tab-account|security|notifications | Nav buttons | Switch the open section; sets `?tab=`. | nav.tsx:23-49, sections.tsx:27-30 | — client only | browser | OK |
| Left rail "Workspace" group (Billing, Limits & usage, API keys, API usage, Audit log, Integrations) / nav-settings-group-workspace, button-settings-tab-{id} | Nav buttons | Switch the open section; Billing deep views via ?view=. Billing/Limits/API panels are other lanes' pages. | nav.tsx:23-49, sections.tsx:31-36 | — client only | browser | OK |
| Mobile "Settings section: …" menu / button-settings-menu, sheet-settings-menu, button-settings-menu-{id} | Sheet + buttons | Below lg the rail becomes a menu button opening the same two groups in a left sheet. | nav.tsx:51-94 | — client only | code only | OK |
| Section header title + description + ⓘ / text-settings-section-title | Header + info popover | Shows the section's name, one-line description and an ⓘ explainer (infoKey → lib/info-content.ts:631-715, all 9 keys exist). | shared.tsx:19-37, sections.tsx:28-36 | — client only | route check (info-content.ts) | OK |
| `?tab=` / `?view=` URL params | URL state | Remember the open section (and Billing inner tab) across reloads/shared links; old names keep working. | settings.tsx:44-48, sections.tsx:76-104, hooks/use-url-param.ts | — client only | browser | OK |
| Loading state / LoadingCard | Placeholder | "Loading…" spinner while a panel's data loads. | shared.tsx:39-47 | — client only | code only | OK |
| Unknown section → My account | Redirect | A bad `?tab=` value opens My account instead of a blank page. | sections.tsx:99-104 | — client only | browser (portal=0 sanity) | OK |

## My account (client/src/pages/settings/me-account.tsx → section-account)

Seeds from `GET /api/auth/me` (server/auth.ts:668 → users row for session user; fields id, accountId,
email, displayName, avatarUrl, emailVerified, googleId(bool), companyName, companyLogoUrl,
googleProfileUrl, totpEnabled, hasPassword, hasGbpAccess, isPlatformAdmin, createdAt).

**Profile information card (card-profile)**

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Avatar image / img-avatar | Image | Shows your profile photo, or initial-based placeholder. | me-account.tsx:174-188 | GET /api/auth/me → auth.ts:678 → users.avatar_url | SQL vs curl — both null for user 1 → placeholder shown | OK |
| Change-photo camera button / button-change-avatar, input-avatar-upload | File input | Picks a photo, downsizes to ≤256px/~400KB, uploads, then saves the URL on your profile. | me-account.tsx:115-132, 189-208 | POST /api/upload/logo {imageData,type:"avatar"} → routes.ts:5947 → R2 ("avatars"), then PATCH /api/auth/me … PATCH /api/auth/profile {avatarUrl} → auth.ts:736-742 → users.avatar_url (accepts data:, http(s), /api/files/) | code only (R2 not configured on dev → 503 toast path verified at routes.ts:5970) | OK |
| Name + email + "Verified" badge / text-profile-name, text-profile-email | Text + badge | Shows your display name, sign-in email, and a green "Verified" badge only when the email is verified. | me-account.tsx:210-218 | GET /api/auth/me → auth.ts:674-679 → users.display_name, users.email, users.email_verified | browser ("Veto", "dev@constructhub.local", no badge) = SQL | OK |
| Display name / input-display-name | Input (required) | Your name across the app; Save is blocked while empty. Writes users.display_name. | me-account.tsx:222-239, 69-73 | PATCH /api/auth/profile → auth.ts:705-709 → users.display_name (trim, ≤200, 400 if empty) | code only | OK |
| Email / input-email | Input (disabled) | Shows your sign-in email; cannot be edited here. | me-account.tsx:240-249 | GET /api/auth/me → users.email | browser = SQL | OK |
| Company name / input-company-name | Input | Your business name — printed on review-request emails; saving also rewrites it on your past review requests. Writes users.company_name. | me-account.tsx:250-260 | PATCH /api/auth/profile → auth.ts:710, 745-749 → users.company_name + review_requests.company_name (same userId) | browser ("Alpine Exteriors Test") = SQL | OK |
| Company logo / img-company-logo, button-remove-logo, logo-placeholder, input-logo-upload | Image + remove + file input | Shows your logo on review emails. Upload resizes and stores to R2; if storage fails the image stays in the form and is stored inline when you save. Writes users.company_logo_url. | me-account.tsx:261-305, 134-153 | POST /api/upload/logo {type:"company-logo"} → routes.ts:5947 → R2 "logos/company"; PATCH /api/auth/profile {companyLogoUrl} → auth.ts:711-720 → users.company_logo_url (≤1.5M chars, data:/http//api/files/ only) | code only (user 1 has ""; placeholder shown — SQL) | OK |
| Save changes / button-save-profile | Button | Saves name, company, logo. Never sends googleProfileUrl, so an old saved link can't block an unrelated save. | me-account.tsx:160-169, 65-83 | PATCH /api/auth/profile → auth.ts:698-767 → users; response = updated profile; client invalidates /api/auth/me | code only | OK |
| "Review referral settings" / details>summary | Collapsed section | Opens the referral-offer editor (toggle + 500-char terms → PUT /api/review-referral-settings → routes.ts:5702, parsed by referralSettingsInput). Current dev data {enabled:true, offer:"x"} is another lane's fixture — not touched. | me-account.tsx:312; review-referral-settings.tsx | GET/PUT /api/review-referral-settings → routes.ts:5698-5705 | curl (GET {enabled:true,offer:"x"}) | OK |

**Google Business Profiles card (card-gmb-profiles)** — the review-request destinations. Reads
`GET /api/review-templates` (routes.ts:5012 → storage.getReviewTemplatesByUser → review_templates
where user_id = you).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Add profile" / button-add-gmb-profile | Button | Opens the Add/Edit dialog. | me-account.tsx:423-425 | — client only | code only | OK |
| Empty state / empty-gmb-profiles | Empty state | "No GMB profiles added yet" when you have none. | me-account.tsx:430-435 | — client only | code only (user 1 has 1 row → list shown) | OK |
| Profile row (icon, name, "Default" badge, link) / gmb-profile-{id}, text-gmb-name-{id} | Row + badge | Lists one GMB location; the Default badge marks which one review requests use out of the box. | me-account.tsx:438-460 | GET /api/review-templates → review_templates.name, google_profile_url, is_default | browser 1 row "R2-r1 template", isDefault badge = SQL id 13 | OK |
| "Set Default" / button-set-default-{id} | Button | Makes that profile the default (only on non-default rows). | me-account.tsx:462-472 | PATCH /api/review-templates/:id {isDefault:true} → routes.ts:5098-5104 → clears other defaults, sets review_templates.is_default | code only | OK |
| Edit pencil / button-edit-gmb-{id} | Button | Opens the dialog pre-filled. | me-account.tsx:473-482 | — client only | code only | OK |
| Remove trash / button-delete-gmb-{id} + dialog-confirm-delete-gmb (Cancel / button-confirm-delete-gmb "Remove profile") | Button + confirm dialog | Deletes the profile after a confirm. Already-sent requests keep their link. | me-account.tsx:483-520, 373-385 | DELETE /api/review-templates/:id → routes.ts:5114 → storage.deleteReviewTemplate → review_templates (own rows only → 404 otherwise) | code only — NOT pressed (no AUDIT- template created; only fixture row exists) | OK |
| Dialog fields: "Profile / Location Name" / input-gmb-name; "Google Review Link" / input-gmb-url (+ format hint); "Description" / input-gmb-description; Cancel / button-cancel-gmb; Save / button-save-gmb | Dialog inputs + buttons | Adds or edits a profile. The link is validated client-side (Google hosts / g.page / goo.gl / share.google / maps) and re-checked server-side only when changed. | me-account.tsx:522-587, 45-55 | POST /api/review-templates → routes.ts:5023 (plan limit on review_templates count, resolveReviewLink) → review_templates.*; PATCH → routes.ts:5075 | code only | OK |

**Account details card (card-account)**

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Account ID / text-account-id | Code | Your unique identifier for support. Shows "—" when null. | me-account.tsx:608-616 | GET /api/auth/me → auth.ts:675 → users.account_id | browser "—" = SQL (NULL for user 1; 10/12 other users have one) | OK |
| Member since / text-member-since | Text | When you joined, in your browser's locale. | me-account.tsx:617-625 | GET /api/auth/me → users.created_at | browser "7/29/2026" = SQL 2026-07-29 | OK |
| Login method / text-login-method | Badge | "Google" when a Google account is linked, else "Email & Password". | me-account.tsx:626-642 | GET /api/auth/me → auth.ts:680 → users.google_id present | browser "Email & Password", googleId=false = SQL google_id NULL | OK |

Note: the badge only distinguishes Google vs not. For the rare account with neither a Google link
nor a password (possible shape per auth.ts email-code reauth path; true for dev user 1,
hasPassword=false) it still says "Email & Password". Dev-only shape — reported, not fixed.

**Trials and invite codes (platform admins only; open by default for admins)** — BetaAccessSection.
Reads `GET /api/beta-codes/status` (routes.ts:5675 → subscriptions row without stripe id, live
trial = status trialing/active and current_period_end in the future, joined with the newest
unrevoked redeemed beta_access_codes row) and, for admins, `GET /api/beta-codes` (routes.ts:5599 →
all beta_access_codes + redeemer user fields).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Trial status banner / text-beta-active, text-trial-plan | Banner | "Agency trial active" + time remaining while a trial grant is live; otherwise the code-entry form. Plan name from PLANS[effectivePlanKey(subscription plan)]. | me-account.tsx:820-855, 704-709 | GET /api/beta-codes/status → routes.ts:5675-5695 → subscriptions + beta_access_codes | curl {active:false}; browser shows entry form | OK |
| Code entry / input-beta-code + Activate / button-redeem-beta | Input + button | Redeems a trial code for the Agency plan; billing/limits/agency caches refresh after. | me-account.tsx:836-853, 719-737 | POST /api/beta-codes/redeem → routes.ts:5649 → beta_access_codes lookup (not revoked/used/expired) → redeemTrialCode | code only — NOT pressed (no AUDIT- code created) | OK |
| Admin "New Trial" / button-toggle-create-trial + create form (Unlimited ∞ / input-unlimited-toggle, days / input-trial-days + text-trial-days, quick picks button-trial-days-{7,30,365,1000}, recipient name/email inputs, generate / button-generate-trial) | Admin form | Creates a trial invite (1–1000 days or until-revoked), optionally emails it; copies the invite link to the clipboard; the toast reports truthfully whether the email sent. | me-account.tsx:859-971, 739-768 | POST /api/beta-codes/generate → routes.ts:5550 → isAdmin gate → trialCodeDays bounds → insert beta_access_codes (code TRIAL-XXXXXXXX, expiresAt now+days or 2099 for unlimited) + sendTrialInviteEmail | code only — NOT pressed | OK |
| Code list rows / row-beta-code-{id}, text-beta-code-{id}, button-copy-code-{id}, badge-status-{id}, button-revoke-{id} | Rows + badges + buttons | Lists every code: copy the invite link, a length badge (∞ or Nd), status (Pending / Active=redeemed / Expired / Revoked) and a Revoke button (except revoked/expired). | me-account.tsx:980-1050, 770-808 | GET /api/beta-codes → routes.ts:5599; POST /api/beta-codes/revoke/:id → routes.ts:5627 → revokeBetaAccessCode + endRevokedTrial | browser 10 rows = curl | OK |
| Status badge logic | Badge | revoked→"Revoked", redeemed→"Active", past redemption window→"Expired", else "Pending". Note: "Active" reflects the code being redeemed, not whether the trial itself is still live — reported as observation. | me-account.tsx:803-808 | — client only | code only | OK |
| "No trial codes yet" / text-no-codes | Empty state | Shown when the admin list is empty. | me-account.tsx:1046-1049 | — client only | code only | OK |

**Delete account (card-danger-zone)** — there is no self-serve deletion endpoint (comment at
me-account.tsx:594-599); "Request deletion" opens a dialog whose action is a prefilled
`mailto:support@constructhub.us` naming the account email + ID. Nothing is deleted by the app.
Per audit rules this is report-only.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Request deletion" / button-delete-account | Button | Opens the confirm dialog. | me-account.tsx:661-664 | — client only | browser (not pressed) | OK |
| Dialog: Cancel / button-cancel-request-deletion; "Email support@constructhub.us" / link-request-deletion-email; privacy-policy link | Dialog + mailto link | Composing the email is the request; support handles deletion under the privacy policy; the /privacy link renders the PrivacyPolicyPage (App.tsx:325). | me-account.tsx:668-685 | — client only (mailto + route check) | route check | OK |

## Password & security (client/src/pages/settings/me-security.tsx → section-security)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Two-factor card / card-two-factor | Card | Container for 2FA setup/disable/recovery codes. | me-security.tsx:206-360 | — client only | browser | OK |
| "Enable 2FA" / button-enable-2fa | Button | Starts TOTP setup: stores an encrypted secret (not yet enabled) and shows QR + manual key. | me-security.tsx:291-300, 157-168 | POST /api/auth/2fa/setup → auth.ts:803 (requires recent auth, 403 {reauth:true} otherwise → client opens the verify-identity dialog) → users.totp_secret (encrypted v1:), returns secret + QR data URL | code only — NOT pressed (would touch the dev admin's 2FA state) | OK |
| QR image / img-2fa-qr, secret / text-2fa-secret, copy / button-copy-2fa-secret | Image + code + copy | Shows the scannable QR and the manual entry key during setup. | me-security.tsx:303-331 | — client only | code only | OK |
| Verify code / input-verify-2fa-code + "Verify & Enable" / button-verify-2fa | Input + button | Verifies the first code; on success enables 2FA and shows 10 one-time recovery codes (each usable once, never shown again). | me-security.tsx:332-353, 170-185 | POST /api/auth/2fa/verify → auth.ts:842 → TOTP validate(window 1) → account-security.ts:66 activateTwoFactor (tx: users.totp_enabled=true + 10 rows account_recovery_codes) + security.2fa_changed activity/notification | code only — NOT pressed | OK |
| Recovery codes block + "I saved my codes" | One-time display | Lists the new codes after enable/regenerate; dismiss button. | me-security.tsx:211-217 | — client only | code only | OK |
| "Generate new recovery codes" | Button | Replaces all recovery codes (requires recent auth → verify-identity dialog). | me-security.tsx:218-232 | POST /api/auth/2fa/recovery-codes → account-security.ts:152-159 → replaceRecoveryCodes → DELETE+INSERT account_recovery_codes (tx) + security.recovery_codes_changed | code only — NOT pressed | OK |
| "2FA is enabled" panel + "Disable 2FA" / button-disable-2fa | Banner + button | Shows when enabled; opens the disable flow. | me-security.tsx:233-252 | state from GET /api/auth/me → users.totp_enabled | browser: not shown for user 1 (totp_enabled=f = SQL) | OK |
| Disable code / input-disable-2fa-code + "Confirm Disable" / button-confirm-disable-2fa + Cancel / button-cancel-disable-2fa | Input + buttons | Disables 2FA after a valid authenticator code; wipes secret, recovery codes and remembered devices. | me-security.tsx:254-281, 187-201 | POST /api/auth/2fa/disable → auth.ts:883 → users.totp_enabled=false, totp_secret=null, DELETE account_recovery_codes, revokeDevices + security.2fa_changed | code only — NOT pressed (never disable the dev admin's 2FA) | OK |
| "Cancel Setup" / button-cancel-2fa-setup | Button | Abandons setup (the stored secret stays but 2FA stays off; next setup overwrites it). | me-security.tsx:354-356 | — client only | code only | OK |
| Change password card / card-change-password (only when hasPassword) | Card + 3 password inputs + 2 show/hide eye toggles + "Update password" / button-change-password | Changes your password after checking the current one; signs out remembered devices and emails/notifies you. | me-security.tsx:45-147, 71-146 | POST /api/auth/change-password → auth.ts:769 → bcrypt compare → users.password_hash, revokeDevices (DELETE account_trusted_devices), security.password_changed activity + notifyUser + CRM owner-notification | code only — NOT pressed | OK |
| "No password" card / card-no-password | Card | For accounts without a password: explains you sign in with Google (or "nothing to change here"). | me-security.tsx:23-39 | GET /api/auth/me → hasPassword=!!users.password_hash, googleId | browser: shown for user 1 ("This account has no password set…") = SQL (no password_hash, no google_id) | OK |
| Remembered devices card ("No remembered devices.", per-device "Revoke device") | Card + list | Lists trusted devices (cookie-remembered for 30 days) with expiry; Revoke deletes one. | account-security.tsx:77 | GET /api/auth/devices → account-security.ts:140 → account_trusted_devices WHERE user_id AND expires_at>now() ORDER BY created_at DESC; DELETE /api/auth/devices/:id → :145 (id must be 32 hex; logs security.device_revoked) | browser "No remembered devices." = SQL count 0 | OK |
| "Wasn't you?" card (only with ?google=<subject>) | Card | Security remediation: disconnect that Google account + reset password links. | account-security.tsx:74-76 | POST /api/gbp/disconnect {subject} → gbp/routes.ts:67 (requires recent auth; 404 for unknown subject); GET /api/gbp/status → gbp/routes.ts:60 → gbp_grants | code only (no ?google= link followed) | OK |
| Account activity card (activity-type select, since date, rows / row-account-activity, "Most recent 200 events.") | Card + filter + list | The same 200 newest events as the Audit log, security-focused, client-filtered by kind and since-local-midnight. | account-security.tsx:78-82 | GET /api/account-activity → account-events.ts:107 → account_activity WHERE user_id=1 ORDER BY created_at DESC LIMIT 200 | browser 200 rows, 25 kind options; SQL 307 rows total → 200 returned | OK |

## Notifications (client/src/pages/settings/me-notifications.tsx → section-notifications → @/components/account-security.tsx NotificationPreferences)

One card listing every notification kind in the registry (server/notification-kinds.ts +
cloudflare/domains/api-key kind files — 25 kinds). "Security emails are always on. Changes save
immediately." Each row: label, an **In app** switch, an **Email** switch (labelled "Email (always
on)" and disabled for the 12 security kinds).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Preference rows (25) / switches aria-label "{label}: In app" / "{label}: Email" | Switch rows | Each flip immediately PUTs that one kind and re-reads the list. | account-security.tsx:20-24 | GET /api/notification-prefs → account-events.ts:91 → per kind: user_notification_prefs row if present else KIND_DEFAULTS; email forced true when kind.security. PUT /api/notification-prefs {prefs:[{kind,inApp,email}]} → :96 → INSERT … ON CONFLICT UPDATE user_notification_prefs(user_id,kind,in_app,email) | browser 25 rows/12 always-on; SQL: stored rows for social.post_failed, cloudflare.connected read back correctly | OK |
| "Email (always on)" enforcement | Disabled switch | Security kinds ignore the stored email flag: GET forces email=true and the sender (channelsFor, account-events.ts:41-46) forces email on regardless. | account-security.tsx:23 | channelsFor: email = d.security ? true : p.email — verified by PUTting email=false for security.password_changed: stored f, GET returned true | curl PUT + SQL + GET | OK |
| In-app toggle round-trip (AUDIT-safe) | Switch | Flipping "Site Scan completed" In app off/on wrote and re-wrote user_notification_prefs (in_app f→t), GET reflected each state; restored to defaults. | account-security.tsx:23 | PUT/GET as above | curl + SQL + browser (UI flip checked→unchecked→checked) | OK |
| Error line / role=alert | Text | Shows load/save errors. | account-security.tsx:23 | — | code only | OK |

## Integrations (client/src/pages/settings/integrations.tsx → section-integrations)

Every row comes from `GET /api/account/integrations` (server/account/integrations-route.ts:141 —
purely stored rows, nothing probed live; per-service queries of gbp_grants, ads_grants/ads_accounts,
edge_connections/edge_assets, social_connections, domain_connections/managed_domains,
mail_alert_grants/mail_alert_addresses). Badge: Connected / Not connected / Reconnect needed. Button
label Manage / Reconnect / Connect by status; href is the page that manages the connection. If the
endpoint is missing (404 or HTML fallback), an honest fallback card lists the manage pages instead
(all 8 fallback hrefs exist as routes, incl. /crm/integrations and /crm/payments, App.tsx:410-413).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading / Checking connections… | Placeholder | While GET /api/account/integrations loads. | integrations.tsx:55 | — | code only | OK |
| Error card / text-integrations-error | Error | 5xx/other failures surface as an error, never as an empty list. | integrations.tsx:57-65 | — | code only | OK |
| Fallback card / card-integrations-unavailable | Card + 8 links row-integration-page | Only when the status endpoint doesn't exist on the server: "Connection status isn't available on this server yet" + link per manage page. | integrations.tsx:67-88, 26-35 | — client only (route check for all 8 hrefs) | route check | OK |
| Empty state / text-integrations-empty | Empty state | "No integrations reported" when the endpoint returns zero items. | integrations.tsx:96-101 | — | code only | OK |
| Google Business Profile / row-integration-google_business, badge-integration-status-google_business, link-integration-manage-google_business | Row + badge + Connect/Manage | Status from gbp_grants: reconnect_required → "Reconnect needed" + which account; else Connected with the account emails; else Not connected. Manage → /google-business. | integrations.tsx:103-121; integrations-route.ts:50-57 | GET → SELECT email,reconnect_required FROM gbp_grants WHERE user_id=1 | browser "Not connected — No Google account connected." = SQL count 0 | OK |
| Google Ads manager / row-integration-google_ads | Row + badge + link | From ads_grants (manager) + ads_accounts count; unverified managers say so. Manage → /ads-manager. | integrations-route.ts:59-66 | ads_grants WHERE user_id=1 | browser "Not connected" = SQL 0 | OK |
| Cloudflare / row-integration-cloudflare | Row + badge + link | From edge_connections provider='cloudflare' (a Google token that expired with no refresh token → Reconnect needed) + edge_assets zone count. Manage → /cloudflare. | integrations-route.ts:69-86 | edge_connections/edge_assets WHERE user_id AND provider | browser "Not connected" = SQL 0 | OK |
| Google Search Console / row-integration-search_console | Row + badge + link | Same builder, provider='gsc', properties counted. Manage → /search-console. | integrations-route.ts:69-86 | edge_connections/edge_assets provider='gsc' | browser "Not connected" = SQL 0 | OK |
| Blotato (social media) / row-integration-blotato | Row + badge + link | From social_connections: account count, agency-wide vs per-business keys. Manage → /social-media. | integrations-route.ts:88-96 | social_connections WHERE user_id=1 | browser "Not connected" = SQL 0 | OK |
| Domain registrars / row-integration-registrars | Row + badge + link | From domain_connections (+ provider:label) and managed_domains count; without a key it says how many domains are monitored manually. Manage → /domains. | integrations-route.ts:98-107 | domain_connections, managed_domains WHERE user_id=1 | browser "Not connected — No registrar API key; 3 domains monitored manually." = SQL 3 domains, 0 connections | OK |
| Gmail alert forwarding / row-integration-gmail_alerts | Row + badge + link | From mail_alert_grants (needs_reconnect → Reconnect) + a forwarding address counts as connected. Manage → /mail-alerts. | integrations-route.ts:109-122 | mail_alert_grants, mail_alert_addresses WHERE user_id=1 | browser "Connected — Forwarding address set; no Gmail account connected." = SQL 1 address row, 0 grants | OK |

## Audit log (client/src/pages/settings/audit-log.tsx → section-audit-log)

Source: `GET /api/account-activity` → account-events.ts:107 → `SELECT id,kind,detail,ip,user_agent,
created_at FROM account_activity WHERE user_id=… ORDER BY created_at DESC LIMIT 200` (no time
window; everything ever recorded is kept in the table, only the newest 200 are returned). Times are
timestamptz rendered with `new Date().toLocaleString()` — browser-local time, and the `<time>`
element carries the UTC instant in `datetime`. Labels via the shared activityLabel map
(account-security.tsx:42).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Filters (mobile) button | Button | Below sm the filter grid collapses behind a Filters toggle. | audit-log.tsx:109 | — client only | code only | OK |
| Area select / select-audit-area | Select | Filters rows by the part before the dot in the kind (auth, security, google, gbp, sitescan, social, ads, agency…); options derived from the loaded rows. Resetting clears the Event choice. | audit-log.tsx:111-123, 68, 74-76 | — client only (labels: AREA_LABELS :28) | browser 8 area options; area=security → 28 rows | OK |
| Event select / select-audit-kind | Select | Filters to one exact kind; options depend on the chosen area. | audit-log.tsx:124-136, 69-72 | — client only (activityLabel) | browser 25 options; narrowing worked | OK |
| Since date / input-audit-since | Date input | Keeps rows at or after local midnight of the chosen day (activitySince, account-security.tsx:52). | audit-log.tsx:137-140, 77 | — client only | browser since=2026-10-02 → 54 rows = SQL count on the same 200-row window (>= 2026-10-02T00:00-04) | OK |
| Search / input-audit-search | Input | Case-insensitive match on label, kind, IP, user agent, or detail.email. | audit-log.tsx:141-147, 78-83 | — client only | e2e (settings-shell.spec.ts:260-265) | OK |
| Count line / text-audit-count | Text | "N of M events · the most recent 200 are kept. IP and device describe the request and may reflect a proxy." | audit-log.tsx:150-155 | M = rows returned (≤200) | browser "200 of 200" — copy BUG: older events are NOT deleted; 307 rows exist for user 1, the API just returns the newest 200. See bugs file. | BUG |
| Export CSV / button-audit-export | Button | Downloads the filtered view as CSV (disabled when nothing matches). Time column is UTC ISO while the table shows browser-local times; not labelled. | audit-log.tsx:156-158, 86-101 | — client only | browser: 201 lines (header+200), filename constructhub-audit-log-YYYY-MM-DD.csv, header Time,Event,Kind,Area,IP,Device,Email | OK (CSV-timezone note in bugs file) |
| Error line / text-audit-error | Error | API failures surface here. | audit-log.tsx:160 | — | code only | OK |
| Table header (Time / Event / IP / Device) | Header | xl+ grid header; below xl each row stacks its fields. | audit-log.tsx:167-169 | — | browser screenshot | OK |
| Empty states / text-audit-empty, text-audit-no-match | Text | "Sign-ins, security changes and tool activity will appear here." when there are no rows at all; "No activity matches these filters." when filters hide everything. | audit-log.tsx:170-175 | — | code only | OK |
| Event rows / row-audit-event (time, text-audit-event + area line, IP or "Unavailable", device summary or "Unavailable") | Rows | One row per event: local time, plain-language label (tooltip = raw kind), area (+ email from detail), IP, and a short device name (full UA in tooltip; "Unavailable" when null — background jobs log with no request). | audit-log.tsx:176-191, 37-44 | per-row: account_activity.kind/detail/ip/user_agent/created_at | browser: first row local "10/4/2026, 7:20:25 PM" = datetime attr 2026-10-04T23:20:25.949Z (EDT) ✓; "Social media: auto changed" label matches kind social.auto_changed; null ip/ua rows show "Unavailable" = SQL NULL | OK |
| CSV formula neutralisation | Behaviour | Cells starting with =,+,-,@,tab,CR are prefixed with ' so a spreadsheet never runs a logged email/UA as a formula. | audit-log.tsx:46-57 | — | e2e (settings-shell.spec.ts:275-278) | OK |

## Element counts

| Section | Total | OK | BUG | UNCLEAR | DEAD |
|---|---|---|---|---|---|
| Shell | 9 | 9 | 0 | 0 | 0 |
| My account | 34 | 34 | 0 | 0 | 0 |
| Password & security | 15 | 15 | 0 | 0 | 0 |
| Notifications | 4 | 4 | 0 | 0 | 0 |
| Integrations | 11 | 11 | 0 | 0 | 0 |
| Audit log | 13 | 12 | 1 | 0 | 0 |
| **Total** | **86** | **85** | **1** | **0** | **0** |

(Two observations logged in the bugs file without status BUG: the login-method badge edge case for
a no-password/no-Google account, and the CSV Time column being UTC while the table is local.)

# Lane 1-07 — Settings: Billing, Limits & usage, API keys/usage

Audit date 2026-10-04, worktree `/home/veto/ConstructHUB-audit1` (branch audit/1), dev server
http://127.0.0.1:8301 signed in as dev platform admin user 1 (dev@constructhub.local).
All platform settings pages render via the settings shell `/settings?tab=<id>`; on a portal-forced
dev host append `&portal=0`. Legacy deep links `/settings/billing[?billing=…]` and
`/settings/api[?api=usage]` redirect into the shell (verified: → `/settings?tab=invoices`,
`→ /settings?tab=api-usage`, `→ /settings?tab=billing`).

Server-side ground truth for every number on these pages:

- `GET /api/stripe/subscription` → server/stripe.ts:223 → `subscriptionRowFor` +
  `subscriptionSummary` (server/billing/sync.ts:170) → `subscriptions` row for the user
  (`SUBSCRIPTION_ORDER`, server/entitlements.ts:205: a row with an access status wins, then newest),
  plus `cancel_at_period_end` / `cancel_at` / `start_date` from the same row.
- `GET /api/entitlements` → server/routes.ts:249 → `getEntitlements` (server/entitlements.ts:267,
  users ⋈ subscriptions) + `locationCount` = `SELECT count(*) FROM business_locations WHERE user_id=$1`
  + `monthlyUsage` (server/growth-quotas.ts:198 → `growth_budgets` rows
  `quota:user:{id}:{searches|rankings|siteScans|competitorScans|texts}:{YYYY-MM UTC}`, `period='0'`)
  + `resetsAt` = first instant of next UTC month. User-scoped, never org-scoped.
- Billing ledgers: `GET /api/billing/invoices|payment-methods|purchases` →
  server/account/billing-routes.ts:409,422,431 → `billing_invoices` / `billing_purchases`
  (`WHERE user_id=$1 … ORDER BY COALESCE(created,'epoch') DESC, id DESC`, keyset cursor resolved
  inside the same user scope) and Stripe for cards. Payment methods are never stored locally.
- API keys: `GET|POST /api/account/api-keys`, `PATCH|DELETE …/:id`, `GET /api/account/api-usage` →
  server/account/api-key-routes.ts:230-335 → `account_api_keys` (secrets hashed; prefix/suffix only),
  `account_api_usage` (`day` buckets, per calendar month UTC for the quota, per day for the series).

Status legend: OK / BUG / UNCLEAR / DEAD. "Verified how": SQL = read-only psql against
constructhub_dev_a6; curl = dev-bypass API call; browser = Playwright on the live dev server;
"code only" = read end-to-end, not exercisable on dev (Stripe is off; expected per lane rules).

---

## Settings shell (routing, shared by all tabs)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Left nav rows (My account…Integrations) `button-settings-tab-*` | nav buttons | Open the matching settings section; Workspace group holds Billing / Limits & usage / API keys / API usage / Audit log / Integrations | client/src/pages/settings/sections.tsx:27 (registry), client/src/pages/settings/nav.tsx | none — client only: `go(section)` swaps the section, `?tab=` in the URL | browser | OK |
| Section title + description | heading | Shows the selected section's label and one-line description | sections.tsx:27 (`label`/`description`) | none — client only | browser | OK |
| ⓘ info tip `info-tip-account-billing` etc. | icon button | Opens the help popover for the section (lib/info-content.ts `infoKey`) | sections.tsx:33 (`infoKey`) | none — client only | code only | OK |
| `?tab=` routing + aliases (`invoices` → billing section + inner view, `usage` → limits…) | URL state | Deep links and old tab names land on the right section/tab; unknown tabs fall back to My account | client/src/pages/settings/sections.tsx:76 (TAB_ALIASES), resolveSettingsTab:99 | none — client only | browser (invalid tab → account) | OK |
| `/settings/billing` → `/settings?tab=billing` (+`?billing=invoices|payment-methods|purchases|subscriptions`) | redirect | Old billing URLs keep working, landing on the right inner tab | client/src/App.tsx:133 (SettingsBillingRedirect) | none — client only | browser | OK |
| `/settings/api` → `/settings?tab=api-keys` (+`?api=usage`) | redirect | Old API URL keeps working | client/src/App.tsx:144 (SettingsApiRedirect) | none — client only | browser | OK |

## plan & billing (the "Subscriptions" tab body: PlanBillingSection)

Section id `billing` in the shell renders `BillingPanel` with `SubscriptionsPanel` (statement) +
`PlanBillingSection` below it (client/src/pages/settings/account-panels.tsx:22). Everything here
reads `GET /api/stripe/subscription` (useSubscription, client/src/pages/settings/use-billing.tsx:23)
and `GET /api/entitlements` (useEntitlements, use-billing.tsx:29).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Current plan" card `card-current-plan` | card | The plan box: name, status badge, legacy note, interval/price line, renewal line, action buttons | client/src/pages/settings/plan-billing.tsx:108 | — | browser | OK |
| "Loading your plan…" / "Couldn't load your plan." `text-current-plan` | status text | While the subscription query loads or after a failure | plan-billing.tsx:115-120 | GET /api/stripe/subscription | browser | OK |
| Plan name + status badge `badge-plan-status` ("Standard plan · Active") | text + badge | The bought plan's name (legacy name kept, e.g. "Standard") and the subscription row's status, worded: Active/Trial/Payment past due/Unpaid/Canceled/…/Paused | plan-billing.tsx:123-127 (STATUS_LABELS:26) | GET /api/stripe/subscription → subscriptions.status (row per SUBSCRIPTION_ORDER) | browser + SQL (subscriptions row: plan=standard, status=active); paused label added by this audit (was raw "paused") | OK |
| Legacy note `text-legacy-match` ("Your features now match Starter.") | text | For old plan names: features follow the mapped new plan; Stripe-bought legacy keeps its old price until a plan change | plan-billing.tsx:129-133 | GET /api/stripe/subscription → LEGACY_PLAN_MAP (shared/plans.ts:422) | browser (standard → "Your features now match Starter.") | OK |
| Interval + price line `text-plan-interval` ("Billed monthly · $29/mo") | text | Billing interval and the price-book price for the plan+interval; hidden when the server reports no interval or a legacy plan | plan-billing.tsx:134-138, priceText:93-100 | Prices: shared/plans.ts only (PLANS[*].monthlyCents/annualCents); subscription: subscriptions.billing_interval | browser ($29/$79/$199/$349 = price book ✓); "—" case code only | OK |
| Renewal / end line `text-plan-period` ("Renews Oct 31, 2026" / "Trial ends …" / "Ends …" / "No end date" / "Access granted by ConstructHUB until …") | text | Reads subscriptions.current_period_end (timestamptz, shown in the viewer's time zone); ≥2099 reads "No end date"; Stripe-less grants say who granted the access | plan-billing.tsx:80-91 | GET /api/stripe/subscription → subscriptions.current_period_end, cancel_at_period_end, stripe_subscription_id | code only (dev row has no period end → line hidden, verified in browser) | OK |
| Past-due alert "Your last payment didn't go through. Update your card in Manage billing." | alert line | Shows under the plan name when the subscription status is past_due/unpaid/incomplete | plan-billing.tsx:142-144 (PAYMENT_PROBLEM_STATUSES, client/src/lib/pricing-display.ts:263) | Same status field | code only (user 1 is active); note: "paused" is NOT in this list though the server counts it as paymentNeeded — see bugs | OK |
| "Change plan" / "Choose a plan" `button-upgrade` | button | Goes to /pricing (keeps a yearly interval as ?interval=year); without a plan the label is "Choose a plan" | plan-billing.tsx:158 | none — client route /pricing (App.tsx:176) | browser (clicked → /pricing) | OK |
| "Manage billing" `button-manage-billing` | button | Opens Stripe's billing portal: POST /api/stripe/create-portal → {url} → browser leaves for Stripe. Only shown when the subscription row has a Stripe id | plan-billing.tsx:161-165; hook client/src/pages/settings/use-billing.tsx:45 | POST /api/stripe/create-portal → server/stripe.ts:416 → stripe.billingPortal.sessions.create (return_url /pricing) | curl on dev: 400 "No subscription found" (user 1 has no Stripe customer — Stripe off on dev, expected); code path verified | OK (verified by code) |
| 4 plan cards `card-plan-starter|pro|growth|agency` | link cards | Plan name, "Current"/"Matches" badge, price-book price at the current interval, tagline; click → /pricing | plan-billing.tsx:168-185 | Prices from shared/plans.ts (planPriceCents) | browser (Starter carries "Matches" for this user; $29/$79/$199/$349 ✓) | OK |
| "Usage this month" card `card-usage` (UsageCard) | card | This month's allowances as the server counts them, each with a usage bar | plan-billing.tsx:387-451 | GET /api/entitlements | browser | OK |
| "Platform admin: every feature is on…" `text-usage-admin` | text | For platform admins: explains every limit reads unlimited and per-day caps still apply | plan-billing.tsx:402-406 | GET /api/entitlements → isPlatformAdmin | browser | OK |
| Locations row `usage-locations` ("2 · unlimited") | meter row | Count of this account's business_locations rows vs the plan limit (-1 = unlimited/fair use) | plan-billing.tsx:407-418 | /api/entitlements → locationCount → `SELECT count(*) FROM business_locations WHERE user_id=1` | SQL (count=2 ✓) + browser | OK |
| 5 monthly meter rows `usage-searches|rankings|siteScans|competitorScans|texts` ("16 used · unlimited") | meter rows + progress bars | Permit searches / Ranking-grid credits / Site Scans / Competitor Intel scans / Text segments used this UTC calendar month vs limit; bar only for finite limits; red at ≥100% | plan-billing.tsx:419-441 (USAGE_METERS, client/src/lib/pricing-display.ts:149) | /api/entitlements → growth_budgets keys `quota:user:1:{feature}:2026-10`, period='0' | SQL (siteScans=16, texts=313 match; searches/rankings/competitorScans=0 — no rows, default 0) + browser | OK |
| "Monthly counts reset November 1." `text-usage-resets` | text | Reset date = first of next month, formatted in UTC on purpose | plan-billing.tsx:442-447 | resetsAt() → next UTC month | browser (resetsAt 2026-11-01 → "November 1") | OK |
| "Add-ons" card `card-addons` | card | One row per add-on the plan sells, with − qty + controls; plus the Agency locations row and the Call Assistant tier picker when applicable | plan-billing.tsx:191-330 | POST /api/stripe/addons; GET /api/stripe/addons/release-preview | browser (card visible; controls disabled here: legacy non-Stripe plan) | OK |
| Add-on intro copy + proration note | text | How add-on billing works (prorated, invoiced right away; a failed card changes nothing) | plan-billing.tsx:197-200 | — (copy; matches server behaviour in server/stripe.ts:350) | code only | OK |
| "not bought through Stripe checkout" note `text-addons-no-stripe` | text | Explains add-ons need a Stripe-bought plan; points to Pricing | plan-billing.tsx:201-204 | — (driven by view.viaStripe = subscriptions.stripe_subscription_id) | browser (shown for user 1) | OK |
| Agency "Client locations" row `row-billing-locations` (input `input-billing-locations`, Update `button-billing-locations`, quote `text-billing-locations-quote`, sales `button-billing-locations-sales`) | input + buttons | Agency only: type a location count, see the per-location quote, Update → POST /api/stripe/change-plan {plan:"agency", interval?, locations}; above AGENCY_SELF_SERVE_MAX_LOCATIONS a "talk to sales" button opens the inquiry dialog | plan-billing.tsx:210-254 | POST /api/stripe/change-plan → server/stripe.ts:317 → applyToSubscription (prorated Stripe update); quote: agencyQuote (shared/plans.ts AGENCY_LOCATION_BANDS) | code only (user 1's plan is Starter — row not rendered; verified by route check) | OK |
| Call Assistant row `row-billing-call-assistant` + tier text `text-billing-call-assistant-tier` + Remove `button-billing-call-assistant-remove` + `CallAssistantTierPicker` | rows + buttons | Shows the held tier; the picker lists Lite/Solo/Crew/Fleet at the price book's prices; a switch POSTs /api/stripe/addons with the new tier (server swaps the held one, prorated); reducing below held numbers opens the release confirm dialog | plan-billing.tsx:255-283; picker client/src/components/call-assistant-tiers.tsx:82; dialog use-billing.tsx:101 | POST /api/stripe/addons → server/stripe.ts:350; GET /api/stripe/addons/release-preview → server/stripe.ts:397 → previewCallNumberReleases (voice_numbers) | code only (plan Starter doesn't sell it; prices $149/$249/$449/$799 = shared/plans.ts ✓) | OK |
| Add-on rows `row-billing-addon-*` with − `button-addon-dec-*`, qty `text-addon-qty-*`, + `button-addon-inc-*` | stepper buttons | + adds one (POST /api/stripe/addons {addons:{key:qty+1}}); − asks first when the add-on holds Call Assistant numbers, otherwise sets qty−1; a reduction becomes account credit | plan-billing.tsx:284-327; use-billing.tsx:63-75 | POST /api/stripe/addons (prorated Stripe subscription update, server/stripe.ts:350-396) | browser (rows for extra_location $19/mo and extra_seat $15/mo = price book ✓; disabled: not editable on a legacy non-Stripe plan) | OK |
| Number-release confirm dialog `dialog-addon-number-release` ("Keep my number" / "Release the number(s)") | alert dialog | Before a change that would release phone numbers: lists the numbers (with org names), warns they can't be kept or moved | use-billing.tsx:120-163 | GET /api/stripe/addons/release-preview → {numbers:[{phoneNumber, orgName}]} | code only (no Call Assistant numbers on dev) | OK |
| "Payment method & invoices" card `card-payment-method` | card | Points at Stripe's portal for card/invoices/cancellation, or to Pricing when there is no Stripe subscription | plan-billing.tsx:332-374 | — | browser | OK |
| Portal text `text-billing-portal` | text | "Your card, invoices and cancellation are managed in Stripe's secure billing portal." (or the no-Stripe explanation) | plan-billing.tsx:340-355 | — (driven by view.viaStripe) | browser | OK |
| Cancel-releases note `text-billing-cancel-numbers` | text | When the account holds Call Assistant numbers on a Stripe plan: warns cancelling releases numbers X, Y | plan-billing.tsx:345-349 | GET /api/stripe/addons/release-preview?cancel=1 | code only; curl of the endpoint returns {numbers:[]} for user 1 | OK |
| "Manage billing" `button-portal-billing` / "See plans" `button-add-payment` | button | Stripe plan → billing portal (same create-portal call); no Stripe plan → /pricing | plan-billing.tsx:357-371 | POST /api/stripe/create-portal → server/stripe.ts:416 | browser (See plans shown; portal call 400 on dev — expected) | OK |

## subscriptions (SubscriptionsPanel — statement at the top of the Billing tab)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Subscription" card `card-subscription` | card | A read-only statement: plan, interval, start, next billing date, price, add-ons, total | client/src/pages/settings/billing/subscriptions-panel.tsx:106 | — | browser | OK |
| Header buttons (hidden in the shell) `button-change-plan`, `button-manage-billing` | buttons | Standalone use shows Change plan + Manage billing; the settings shell passes showActions:false because the plan cards below carry the actions | subscriptions-panel.tsx:112-121; account-panels.tsx:29 | POST /api/stripe/create-portal (portal) | code only; shell verified in browser (exactly one Manage billing on the page — see e2e) | OK |
| Plan row `text-subscription-plan` + status badge `badge-subscription-status` | text + badge | Stored plan name (legacy names kept) + status label incl. "Paused" | subscriptions-panel.tsx:143-145 (STATUS_LABELS:16) | GET /api/stripe/subscription → subscriptions.plan/status | browser ("Standard"/"Active") | OK |
| Legacy note `text-subscription-legacy` | text | "Your features match the {Plan} plan." | subscriptions-panel.tsx:146-148 | LEGACY_PLAN_MAP | browser | OK |
| Past-due alert | alert line | Same payment-problem line as the plan card (past_due/unpaid/incomplete) | subscriptions-panel.tsx:149-151 | same status field | code only | OK |
| "Billing" row `text-subscription-interval` | text | monthly/yearly from subscriptions.billing_interval, "—" when unknown | subscriptions-panel.tsx:153-155 | subscriptions.billing_interval | browser ("—" for user 1) | OK |
| "Start date" row `text-subscription-start` | text | When the Stripe subscription began (start_date), falling back to the row's period start; "—" when never synced | subscriptions-panel.tsx:156-158, 59 | subscriptions.start_date (recordCancellation, server/billing/sync.ts:137) | browser ("—"); format rules via format.ts:24 | OK |
| "Next billing date" row `text-subscription-next` | text | Period end worded by case: "Ends … (won't renew)" when cancelling, "Trial ends … — first charge that day" when trialing, plain date when renewing, "No end date" for ≥2099, "Access granted by ConstructHUB until …" for admin grants | subscriptions-panel.tsx:159-161, 64-72 | subscriptions.current_period_end + cancel_at_period_end + stripe_subscription_id | browser ("—"); trial/cancel wording covered by e2e | OK |
| "Price" row `text-subscription-price` | text | Price-book price for plan+interval ("$199/mo for 12 locations" style for Agency), or "your existing price (kept until you change plans)" for legacy, "priced with your sales rep" above self-serve | subscriptions-panel.tsx:162-167, 76-92 | shared/plans.ts only; subscriptions.agency_locations for the count | browser (legacy note shown, no number ✓); Pro price case in e2e | OK |
| "Add-ons" rows `list-subscription-addons` / "None" `text-subscription-no-addons` | list | Each held add-on with its quantity and, when the interval is known, its price-book price; quantities from the subscription row | subscriptions-panel.tsx:168-185, 94-103 | GET /api/stripe/subscription → subscriptions.addons (jsonb) | browser ("None"); priced rows in e2e | OK |
| "Total" row `text-subscription-total` + reset note | text | Plan + add-ons total per interval, only when a price could be computed; note that monthly allowances reset at entitlements.resetsAt | subscriptions-panel.tsx:186-193 | price book + /api/entitlements.resetsAt | code only (hidden for legacy/unknown-interval — verified by e2e absence assertions) | OK |
| Loading skeleton / error `text-subscription-error` / empty state `text-no-subscription` | states | Loading shimmer; error message; "No active plan" with the trial offer or the stored subscription's status | subscriptions-panel.tsx:124-140 | — | browser (empty state not shown — plan exists) | OK |

## payment methods (PaymentMethodsPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Payment methods" card `card-payment-methods` | card | The cards Stripe holds for this account | client/src/pages/settings/billing/payment-methods-panel.tsx:36 | — | browser | OK |
| "Manage" `button-payment-methods-manage` | button | Opens Stripe's billing portal (add/replace/remove cards). Only rendered when at least one card exists | payment-methods-panel.tsx:42-47 | POST /api/stripe/create-portal | code only (empty here) | OK |
| Card rows `row-payment-method-*` | list rows | Brand label (Visa/Mastercard/…/bank name), "•••• last4", "Expires MM/YY" (red "Expired" when past), "Default" badge for the card the subscription charges | payment-methods-panel.tsx:59-80 | GET /api/billing/payment-methods → listPaymentMethods (server/account/billing-routes.ts:367) → Stripe customers.listPaymentMethods; default = subscription's default_payment_method, else customer invoice_settings | curl on dev: {methods:[]} (Stripe off — expected); row rendering incl. expired/Default covered by mocked e2e | OK (verified by code) |
| Empty state `text-payment-methods-empty` + "See plans" `button-payment-methods-plans` | text + button | No card on file → explanation + shortcut to /pricing | payment-methods-panel.tsx:53-57 | — | browser | OK |
| Loading/error `text-payment-methods-error` | states | — | payment-methods-panel.tsx:49-52 | — | code only | OK |

## invoices (InvoicesPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Invoices" card `card-invoices` | card | Every Stripe invoice on the account, newest first, paged 20 at a time | client/src/pages/settings/billing/invoices-panel.tsx:40 | — | browser | OK |
| Table `table-invoices` (wide) / cards `card-invoice-*` (phone) | table/list | One row per invoice: number (or id), created date, billing period, amount, status badge, View/PDF links | invoices-panel.tsx:56-103 | GET /api/billing/invoices?limit=20[&starting_after=] → server/account/billing-routes.ts:409 → `billing_invoices WHERE user_id=1 ORDER BY COALESCE(created,'epoch') DESC, id DESC` | SQL (0 rows for user 1 = "No invoices yet" ✓); row rendering/pagination via mocked e2e | OK |
| Amount cell `text-invoice-amount-*` | number | Paid invoices show amount_paid; open/uncollectible show amount_due (fallback amount_paid) | invoices-panel.tsx:21, 78 | billing_invoices.amount_paid / amount_due (cents → formatMoney) | mocked e2e (paid/open cases) | OK |
| Status badge `badge-invoice-status-*` (Paid/Open/Uncollectible/Draft/Void) | badge | billing_invoices.status worded; colours: paid default, open secondary, uncollectible destructive, else outline | invoices-panel.tsx:17-18, 79 | billing_invoices.status (Stripe invoice status, webhook-written; drafts never stored) | mocked e2e | OK |
| "View" / "PDF" links `link-invoice-view-*`, `link-invoice-pdf-*` | external links | Open Stripe's hosted invoice page / PDF in a new tab; rendered only for http(s) URLs — a non-URL can never become an href | invoices-panel.tsx:119-140 (httpUrl guard format.ts:66) | billing_invoices.hosted_invoice_url / invoice_pdf | mocked e2e (incl. javascript: URL refused) | OK |
| Period cell `text-invoice-period-*` | text | "Sep 1 – Oct 1, 2026" from period_start/period_end | invoices-panel.tsx:77 (formatPeriod format.ts:40) | billing_invoices.period_start/end | mocked e2e | OK |
| "Load more" `button-invoices-more` | button | Fetches the next keyset page (?starting_after=<last id>) | invoices-panel.tsx:104-110 | pageOf (cursor validated inside user scope — another account's id → 400) | code only (hasMore false here); e2e covers paging | OK |
| Empty state `text-invoices-empty` | text | "No invoices yet. Your first one is created when a plan starts billing." | invoices-panel.tsx:50-53 | — | browser | OK |
| Download note in card description | text | "Each one is also emailed to you when it's paid." | invoices-panel.tsx:43 | — (copy) | code only | OK |

## purchases (PurchasesPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Purchases" card `card-purchases` | card | One-time payments outside the subscription: courses, services, reinstatement | client/src/pages/settings/billing/purchases-panel.tsx:21 | — | browser | OK |
| Table `table-purchases` / phone cards `card-purchase-*` | table/list | Description (or "Purchase"), kind badge (Course/Service/Reinstatement/Purchase), date, amount, receipt link | purchases-panel.tsx:35-75 | GET /api/billing/purchases → server/account/billing-routes.ts:431 → `billing_purchases WHERE user_id=1 ORDER BY created DESC` | SQL (0 rows = empty state ✓); rows via mocked e2e | OK |
| Kind badge `badge-purchase-kind-*` | badge | From checkout metadata: type master_class → Course, reinstatement → Reinstatement, cart items → Course/Service/Other | purchases-panel.tsx:50 | billing_purchases.kind (purchaseRow, billing-routes.ts:247-260) | mocked e2e | OK |
| "Receipt" link `link-purchase-receipt-*` | external link | Stripe's receipt page for that payment (http(s) only) | purchases-panel.tsx:84-94 | billing_purchases.receipt_url | mocked e2e | OK |
| Empty state `text-purchases-empty` | text | "No one-time purchases on this account." | purchases-panel.tsx:32 | — | browser | OK |

## limits & usage (LimitsUsageSection)

Reads `GET /api/entitlements` for plan/allowances/usage, then one list endpoint per standing count.
Header card: plan name (or "All features, unlimited" for platform admins), "Platform admin" badge,
reset line, "Billing" and "Change plan" buttons (`button-limits-billing` → billing section,
`button-limits-change-plan` → /pricing, client/src/pages/settings/limits-usage.tsx:349-352).
Without a plan: `card-limits-no-plan` + "Compare plans" (`button-limits-choose-plan` → /pricing) +
"Open billing" (`button-limits-open-billing`). Verified in browser (admin header shown).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Row `limit-locations` ("Google Business Profile locations") | limit row | Included per plan (Agency: "10 included, then per location" + "Billed for N locations."), used = linked locations count, bar vs ceiling; add-on extra_location stepper (`button-limit-addon-inc/dec-extra_location`) or Agency "Change location count" → billing | limits-usage.tsx:157-168 | /api/entitlements → locations.used = count(business_locations) ; Agency hint: view.locations = subscriptions.agency_locations | browser ("2 used", Unlimited) + SQL | OK |
| Row `limit-guardCadenceMinutes` ("Profile Guard edit checks") | limit row | "Every N min" — how often Profile Guard compares the listing to its snapshot; not a usage count | limits-usage.tsx:169-176 | /api/entitlements → allowances.guardCadenceMinutes (admin: fastest cadence, 15) | browser ("Every 15 min") | OK |
| Row `limit-gridCredits` ("Ranking-grid credits") | meter row | Plan's monthly grid credits; used from entitlements.usage.rankings; Agency hint "N per location each month"; add-on competitor note in hint | limits-usage.tsx:176-178 | growth_budgets `quota:user:1:rankings:2026-10` | browser ("0 used this month") + SQL | OK |
| Row `limit-reviewTemplates` ("Review request templates") | limit row | Included count; used = number of the account's review templates | limits-usage.tsx:179-186 | GET /api/review-templates → storage.getReviewTemplatesByUser(user.id) (server/routes.ts:5012) | browser ("1 used") + curl (1 template ✓) | OK |
| Row `limit-autoPublishAiReplies` ("AI review replies publish automatically") | limit row | Included/Not included; hint that drafts wait for approval when excluded | limits-usage.tsx:187-194 | /api/entitlements → allowances.autoPublishAiReplies | browser ("Included") | OK |
| Row `limit-protectedSites` ("Protected websites (Click Guard + IP Tracker + VPN Shield)") | limit row | Included count; used = number of tracked domains; add-on protected_site stepper | limits-usage.tsx:200-208 | GET /api/click-guard/domains → storage.getTrackedDomains(user.id) (server/routes.ts:3484) | browser ("12 used") + curl (12 domains ✓) | OK |
| Row `limit-siteScans` ("Site Scans") | meter row | Monthly Site Scans; used from entitlements.usage.siteScans; Agency per-location hint | limits-usage.tsx:209-211 | growth_budgets `quota:user:1:siteScans:2026-10` (16 ✓) | browser + SQL | OK |
| Row `limit-competitorScans` ("Competitor Intel scans") | meter row | Monthly competitor scans; add-on competitor_pack stepper ("10 more each month") | limits-usage.tsx:212 | growth_budgets `quota:user:1:competitorScans:2026-10` (0 ✓) | browser + SQL | OK |
| Row `limit-permitSearches` ("Permit searches") | meter row | Monthly permit searches | limits-usage.tsx:218 | growth_budgets `quota:user:1:searches:2026-10` (0; the 16 shown in September's row is last month's) | browser + SQL | OK |
| Row `limit-crmSeats` ("CRM seats (estimates, invoices, payments)") | limit row | Included seats; used = distinct seat holders across the owner's CRM orgs (+ agency team); add-on extra_seat stepper | limits-usage.tsx:219-227 | GET /api/crm/me → getSeatUsage (server/crm/tenancy.ts:176 → seatHolders: crm_members status active/invited of owner's orgs + owner + agency_members) | browser ("4 used"); SQL: 4 distinct holders (3 invited emails + u:1) ✓ | OK |
| Row `limit-teamTextSegments` ("Team text alerts") | meter row | Monthly text segments; hint explains the 160/70-char segment counting | limits-usage.tsx:228-230 | growth_budgets `quota:user:1:texts:2026-10` (313 ✓) — reserved in server/crm/sms.ts before sending | browser + SQL | OK |
| Row `limit-clientTexting` ("Two-way client texting") | limit row | none → "Not included"; included → "1 number included"; byo_or_addon → "Your SignalWire number or the texting add-on"; add-on texting_number stepper | limits-usage.tsx:231-242 | /api/entitlements → allowances.clientTexting | browser ("Included (own or dedicated number)" — admin variant) | OK |
| Row `limit-callAssistantMinutes` ("Call Assistant minutes") | meter row | Shown on plans that sell the add-on: included minutes of the held tier, used this month, overage line ($ over included minutes on the next invoice); paused state says "Paused — update your payment method"; embeds the tier picker (`row-limit-call-assistant-tier`) | limits-usage.tsx:256-288 | GET /api/crm/voice/status → server/voice/billing.ts:103 → voice_usage (org+month, server voice month key) via summarizeVoiceUsage; paused from entitlements | browser (admin: "Unlimited", "0 used this month") + curl (usage 0, allowance minutes −1) | OK |
| Row `limit-callAssistantNumbers` ("Call Assistant phone numbers") | limit row | Numbers the held tier (+ extras) allows; used = held active numbers; add-on call_number stepper | limits-usage.tsx:289-300 | /api/crm/voice/status → listOrgNumbers(voice_numbers) + numberAllowance | browser ("5" incl. admin ceiling, "0 of 5") + curl | OK |
| Row `limit-apiUnitsPerMonth` ("API units") | meter row | Monthly API unit allowance; used = plan.usedThisMonth from the keys endpoint; hint explains unit costs; "Manage API keys" button → api-keys section | limits-usage.tsx:309-319 | GET /api/account/api-keys → unitsThisMonth (account_api_usage, day ≥ month start) | browser ("69 used this month") + SQL (69 ✓) | OK |
| Row `limit-apiRatePerMinute` ("API requests per minute") | limit row | Per-key rate cap from the plan | limits-usage.tsx:320-325 | /api/entitlements → allowances.apiRatePerMinute (60) | browser ("60 / min per key") | OK |
| Per-row add-on steppers `button-limit-addon-inc/dec-*`, qty `text-limit-addon-qty-*`, "managed in Billing" link | steppers + link | Same POST /api/stripe/addons flow as Billing (with the same release-confirm dialog for number add-ons); hidden entirely for platform admins; "Coming soon" badge for preview add-ons (steppers disabled) | limits-usage.tsx:396-448 | POST /api/stripe/addons; GET /api/stripe/addons/release-preview | browser (hidden for admin); flow verified on Billing | OK |
| "Monthly counts reset November 1." `text-limits-resets` | text | Reset line (UTC) + Agency per-location growth note + admin explanation | limits-usage.tsx:342-347 | resetsAt() | browser | OK |

## api keys (ApiKeysPanel in the shell; tabs version in client/src/pages/settings/api/index.tsx)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Your data, your tools" alert `banner-api-no-ai` + `link-api-docs` | banner + link | The API-never-generates notice (verbatim on every API surface) + link to /developers (API reference) | client/src/pages/settings/api/api-keys-panel.tsx:115-124 | — (/developers route, App.tsx:235) | browser | OK |
| Quota card `card-api-quota` "API units this month" `text-api-quota` + bar + `text-api-rate` | card + meter | Plan-wide units used this UTC month vs allowance; bar for finite limits; unit-cost and per-key rate copy; exhausted note (429 until reset) | api-keys-panel.tsx:265-289 | GET /api/account/api-keys → plan.usedThisMonth (unitsThisMonth, server/account/api-key-routes.ts:152) | browser ("69 used · fair use") + SQL (69 ✓). Minor: admins see "fair use" though their −1 means unlimited (see bugs) | OK |
| Upgrade card `card-api-upgrade` + "See plans" `button-api-upgrade` | card + button | Starter (0 units): explains API starts with Pro; button → /pricing | api-keys-panel.tsx:132-147 | plan.apiEnabled from apiAllowance (api-key-routes.ts:60) | code only (admin has API on) | OK |
| "Generate API key" `button-generate-key` | button | Opens the generate dialog; disabled when the plan has no API | api-keys-panel.tsx:155-157 | — | browser | OK |
| Key table `table-api-keys` / phone cards `list-api-keys` | table/list | One row per ACTIVE key: title, masked key (chub_prefix…suffix), scope badges, units this month, limit ("Plan" or number), added, last used, expires; revoked keys are not listed | api-keys-panel.tsx:166-221 | GET /api/account/api-keys → `account_api_keys WHERE user_id=1 AND revoked_at IS NULL ORDER BY created_at DESC` + per-key month units | browser (empty for user 1 — all 5 existing keys are revoked ✓ SQL); full row via live create below | OK |
| Row menu `button-key-menu-*` → Rename / Set monthly limit / Revoke… | menu | Rename → PATCH {name}; limit → PATCH {monthlyUnitLimit|null}; revoke → confirm dialog then DELETE | api-keys-panel.tsx:306-325 | PATCH /api/account/api-keys/:id (api-key-routes.ts:288); DELETE (…:316, sets revoked_at — row kept for history) | browser (rename + limit + revoke exercised on an AUDIT- key; row updated then gone) | OK |
| Generate dialog `dialog-generate-key` (title input `input-key-name`, scope checkboxes `checkbox-scope-read|write`, limit `input-key-limit`, expiry select `select-key-expiry`, submit `button-generate-submit`) | dialog + form | Creates the key: name (1-80), ≥1 scope, optional per-key monthly cap (≤ plan units), expiry 30/90/365 days/never. Create is step-up protected: 403 reauth → verification dialog → retry | api-keys-panel.tsx:327-400 | POST /api/account/api-keys → api-key-routes.ts:245 → createApiKey (server/account/api-keys.ts; max 25 active keys) + security event (activity log + notification + email); secret returned once, written past the JSON logger | browser end-to-end: reauth via emailed code from the local sink → key shown once → row appears with expiry 2027-10-04 (365 d ✓) | OK |
| New-key dialog `dialog-new-key` (`text-new-key`, copy `button-copy-key`, Done) | dialog | The one time the full key is visible; copy button; closing forgets it | api-keys-panel.tsx:403-434 | — | browser | OK |
| Revoke dialog `dialog-revoke-key` ("Keep key" / "Revoke key") | alert dialog | Confirms; revoke stops the key immediately (401 for callers) | api-keys-panel.tsx:239-259 | DELETE → revoked_at=now(); security event | browser (revoked AUDIT- key; keys list empty after ✓, usage history kept the key id) | OK |
| Rename dialog `dialog-rename-key`, Limit dialog `dialog-limit-key` | dialogs | PATCH name / monthly cap; blank limit = plan allowance; client-side cap ≤ plan units | api-keys-panel.tsx:441-496 | PATCH | browser (both exercised) | OK |
| Empty state `text-api-keys-empty` | text | "No API keys yet…" (or "No API keys on this account." when the plan lacks API) | api-keys-panel.tsx:160-163 | — | browser | OK |
| Loading/error `text-api-keys-error` | states | — | api-keys-panel.tsx:129 | — | code only | OK |

## api usage (ApiUsagePanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "API usage" card `card-api-usage` + description | card | Units and requests per day for the last 30 days, stacked by key | client/src/pages/settings/api/api-usage-panel.tsx:63-67 | — | browser | OK |
| Stat tiles `text-usage-total-units`, `text-usage-total-requests`, `text-usage-active-keys` | stats | Totals over the window; "Keys used" = keys with any use in the window (revoked keys still count) | api-usage-panel.tsx:75-79, 58-59 | GET /api/account/api-usage?days=30 → usageSeries (api-key-routes.ts:162): `account_api_usage WHERE user_id=1`, zero-filled `generate_series(CURRENT_DATE-29, CURRENT_DATE)` | browser (69 / 69 / 5) + SQL (69 units, 69 requests, 5 keys on 2026-10-01 ✓) | OK |
| Bar chart `chart-api-usage` | chart | One stacked bar per day, one colour per key; legend names keys (revoked ones read "Revoked key abc123") | api-usage-panel.tsx:86-95 | same endpoint (by_key per day) | browser (single Oct 1 bar, 5 legend entries "Revoked key …") | OK |
| Day table `table-api-usage` / phone list `list-api-usage` | table/list | Newest first: day, requests, units, per-key breakdown ("Name (chub_…): N · …") | api-usage-panel.tsx:97-133 | same endpoint | browser (Oct 1: 69/69 with per-key breakdown matching SQL by-key sums 1/59/3/3/3) | OK |
| Empty state `text-api-usage-empty` | text | No API calls in the last N days | api-usage-panel.tsx:80-84 | — | code only (data present) | OK |
| Loading/error `text-api-usage-error` | states | — | api-usage-panel.tsx:69-72 | — | code only | OK |

## Cross-checks against SQL (dev user 1)

- `subscriptions`: one row, plan `standard` (legacy → Starter), status `active`, no Stripe ids, no
  period end → statement shows "Standard/Active", interval/start/next "—", legacy price note ✓.
- `business_locations`: 2 rows → UsageCard "2 · unlimited", limit-locations "2 used" ✓
  (billed count for Agency pricing would be 1 distinct `gbp_location_name` — not shown for this user).
- `growth_budgets` (2026-10, period '0'): siteScans 16, texts 313; searches/rankings/competitorScans
  absent → 0. Every meter on both pages matches ✓.
- `billing_invoices` / `billing_purchases`: 0 rows for user 1 → both empty states ✓. List endpoints
  filter `user_id=$1` (cursor resolved in the same scope — no cross-account window) ✓ code.
- `account_api_keys`: 5 rows, all revoked → key list empty; `account_api_usage` October: 69 units /
  69 requests across 5 key ids → quota "69 used", usage stats 69/69/5, by-key sums match per-key ✓.
- CRM seats: 4 distinct holders (u:1 across 4 orgs + 3 invited emails) → "4 used" ✓.
- review-templates: 1 → "1 used" ✓; click-guard domains: 12 → "12 used" ✓.
- POST /api/stripe/create-portal on dev: 400 "No subscription found" (no Stripe customer; Stripe off
  on dev — expected); the portal button path verified by code and by the mocked e2e.

# Lane 1 · audit/1 — History, Invite, Admin Access / Feature Pages / Issues (audit agent "small")

Dev server: http://127.0.0.1:8301 (**portal mode** — the marketing-app pages are reached with `?portal=0`,
see client/src/lib/site.ts:20-29; without it `/history`, `/invite/:code`, `/admin/*` fall into the portal
catch-all → CRM home). Dev bypass signs every request in as platform admin user 1 (dev@constructhub.local),
so a second account can't be exercised through this server; second-account flows were verified with the
in-process vitest suites and by code. DB `constructhub_dev_a6` is **shared with other lanes** — row counts
move while you watch (search_queries for user 1 read 7→9→7 during this audit; ops_issues 16→17).

Note on page 2: client/src/pages/invite.tsx is the **trial-invite redemption** page (`/invite/:code`), not a
team-invite page. There is no role picker, no send button, no pending-invites list on it; team invites live
in the CRM (out of my list). The job brief's description of invite.tsx didn't match the file; the map below
documents what is actually there.

Test data created through the app and cleaned up: account `audit-small-lane@example.test` (id 17876),
grants 163 (pro 7d, then replaced) and 164 (starter 3d, then revoked), trial code `TRIAL-117E813A`
(generated → revoked, never redeemed), issue #48 "Browser error: AUDIT-small-lane client error probe"
(client-error report → marked fixed; issue rows have no delete). Nothing real was touched.

---

## /history — Search history (client/src/pages/history.tsx, 191 lines)

Route: App.tsx:171 (signed-in dashboard). Reads `GET /api/search-queries` (react-query default GET).
Server: search_queries **for the signed-in account only** (`ownedBy(searchQueries.userId, ownerScope)`),
`ORDER BY created_at DESC LIMIT 50` (server/storage.ts:324-326). No status/filter/pagination UI — the
server's 50-row cap *is* the page size. Compared API response to SQL: 7 rows for user 1, same ids/types/
county/timestamps (transient 9 during another lane's activity, back to 7 after).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Search history" title (text-page-title) + "Rerun a recent permit search with one tap." | header | Names the page. | history.tsx:83-84 | — | browser | OK |
| "Clear all" button (button-clear-all-history) | button | Opens the confirm dialog that deletes the whole history. Only shown when there is at least one row. | history.tsx:85-96 | (dialog confirm) DELETE /api/search-queries → server/routes.ts:725 → storage.deleteAllSearchQueries (storage.ts:338-344): deletes search_results rows of the account's queries, then the account's search_queries rows. No time window — everything, which is what the dialog copy says. | browser (shown, count>0) + code; not pressed (would delete user 1's real history) | OK |
| Loading skeleton (history-loading) | placeholder | 5 pulsing bars while the list loads. | history.tsx:99-104 | — | browser | OK |
| History list (list-history) | list | The account's last 50 saved searches, newest first. | history.tsx:105-152 | GET /api/search-queries → routes.ts:712 → storage.getSearchQueries (storage.ts:324-326): SELECT * FROM search_queries WHERE user_id = owner ORDER BY created_at DESC LIMIT 50 | SQL `SELECT … WHERE user_id=1` (7 rows) = API ids/order | OK |
| Row icon | icon | Picture for the search type: pin (address), person (name), building (company), file (license/permit), magnifier (anything else, e.g. keyword). | history.tsx:30-36, 108-123 | client only: maps query.searchType | browser | OK |
| Row text: search value + type + date (card-query-<id>) | row | Shows what was searched, the type ("Address", "License #", underscores become spaces), and when (browser-local time via toLocaleString). | history.tsx:110-131 | Same GET; search_value / search_type / created_at columns verbatim | browser + SQL | OK |
| "Search again" row link (link-search-again-<id>) | link | Opens the Search page with this query's type, value and county pre-filled (it does not run it). | history.tsx:38-43, 115-136 | client only: `/search?type=<searchType>&q=<searchValue>&loc=county-<countyId>` (loc only when countyId set). Search page reads type/q/loc/state from the URL (client/src/pages/search.tsx:77-81, 122-128), with aliases permit_number→permit, company_name→company. | browser: href `/search?type=address&q=K-main&loc=county-554`; landed, inputs prefilled (q=K-main) | OK |
| Row "X" delete button (button-delete-query-<id>) | button | Deletes that one search and its saved results; list refreshes. Another account's row would 404. | history.tsx:138-148 | DELETE /api/search-queries/:id → routes.ts:717 → canReadQuery (404 cross-account) → storage.deleteSearchQuery (storage.ts:333-336): DELETE search_results WHERE query_id, then DELETE search_queries WHERE id | code + server/growth-isolation.test.ts:87-96 (404 for another account); not pressed on real rows | OK |
| Empty state "No searches yet" + "Search permits" button (link-history-search) | empty state | Shown when there is nothing; button goes to the Search page. | history.tsx:153-164 | —; /search route exists (App.tsx:167) | code (user 1 has rows, state not reachable) | OK |
| Clear-all dialog: title, "This removes your whole search history…", Cancel (button-cancel-clear-history), "Delete all" (button-confirm-clear-history) | dialog | Confirms before wiping everything. Title quotes the exact count when under 50 ("Delete all 7 searches?"); at the 50-cap it says "Delete your entire search history?" — accurate, since the list may be hiding older rows. Confirm deletes all and toasts "History cleared"; list invalidates. | history.tsx:166-188 | DELETE /api/search-queries (see above) | code + copy check against LIMIT 50 | OK |

## /invite/:code — trial invite redemption (client/src/pages/invite.tsx, 104 lines)

Routes: App.tsx:181 (signed-in) and :290 (signed-out). The code is uppercased/trimmed
(invite.tsx:20) and must match `^[A-Z0-9-]{4,40}$`. Real codes look like `TRIAL-XXXXXXXX`
(server/routes.ts:5565). The page reads `GET /api/auth/me` to decide signed-out vs signed-in
(server/auth.ts:668 — returns the fresh user row or null).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Loading your invite…" card | placeholder | Shown while the account check loads. | invite.tsx:45 | GET /api/auth/me (above) | browser | OK |
| "This invite link is incomplete" card | notice | Bad or missing code (not 4–40 of A-Z 0-9 -): tells the visitor to reopen the email link or enter the code in Settings → Account. Signed-out visitors also get the site header. | invite.tsx:47-57 | client only (regex on the URL param) | browser: `/invite/x%3F` → card shown | OK |
| Signed-out: "You're invited to ConstructHUB" (text-invite-title), invite copy, "Create your account" (button-invite-signup) → `/auth?mode=signup&next=/invite/<code>`, "I already have an account" (button-invite-signin) → `/auth?next=/invite/<code>`, "Invite code: <code>" | card + buttons | Offers sign-up or sign-in, carrying this page as the return address so the trial activates on the account the visitor signs into. | invite.tsx:59-81 | /auth route exists in both routers (App.tsx:237, :289) | code only — the dev bypass signs every browser/API request in as user 1, so the signed-out state cannot render on this server (UNCLEAR why: environment, not page) | OK |
| Signed-in: "Accept your free trial" (text-invite-title), "The trial goes on the account you're signed in to: <email>" (text-invite-account) | card | Names the exact account the trial will land on, so it is never silently applied to the wrong one. | invite.tsx:92-97 | GET /api/auth/me → users row (email) | browser: shows dev@constructhub.local | OK |
| "Start my trial" button (button-invite-accept) | button | One click activates the trial on the shown account; while it runs the button shows "Activating…". | invite.tsx:98-100 | POST /api/beta-codes/redeem {code} → server/routes.ts:5649 → storage.getBetaAccessCodeByCode (beta_access_codes.code, uppercased); refuses 404 unknown / 400 revoked / 400 already used / 400 expired (code.expires_at < now, redeem window only) → server/entitlements.ts:415 redeemTrialCode: per-user advisory lock (7170); refuses 409 while a live Stripe subscription or a no-end-date grant exists; UPDATE beta_access_codes SET redeemed_by_user_id, redeemed_at WHERE still unused; then the trial: UPDATE or INSERT subscriptions (plan = TRIAL_CODE_PLAN, status 'trialing', current_period_end = max(existing end, now + trialDays days), Stripe ids/add-ons cleared on takeover) | browser: revoked code → error line "This code has been revoked."; 409 no-end-grant path seen live (as user 1, refused before any write); insert/upsert path by code + plan-gates.test.ts | OK |
| Error line (text-invite-error) | notice | Shows the server's refusal reason ("This code has been revoked.", "already been used", "has expired", paid-plan refusal…). | invite.tsx:101 | same POST's 4xx body | browser | OK |
| Success card: "Your trial is active" (text-invite-done), server message, "Open your dashboard" (button-invite-dashboard) → `/` | card + button | Shown after a successful redeem with the server's message (trial length or "until an admin ends it"); button goes to the dashboard. On success the page also refreshes billing/limits queries (beta-codes/status, stripe/subscription, entitlements, agency/me, dashboard). | invite.tsx:28-35, 83-90 | POST response {message, plan, expiresAt}; the listed GET keys invalidated client-side | code only — success path needs a signed-in non-admin, impossible through the dev bypass | OK |
| "Not you? Sign out from the menu, then open the invite link again." | hint | Static pointer to sign out. | invite.tsx:102 | client only | browser | OK |
| (Server side of the invite email) — the link the visitor opens is `<base>/invite/<code>`, built by trialInviteUrl when an admin generates the code with a recipient; sendTrialInviteEmail goes to the local sink on dev | — | — | — | POST /api/beta-codes/generate (routes.ts:5550): INSERT beta_access_codes (code, expiresAt = now + days, trialDays 1–1000 or 0 = until revoked, recipient…); emailed flag returned honestly. Revoke: POST /api/beta-codes/revoke/:id (routes.ts:5627) → endRevokedTrial ends only this code's trial. Status for Settings: GET /api/beta-codes/status (routes.ts:5675): live = subscriptions row without Stripe with status trialing/active and current_period_end in the future, plus newest unrevoked redeemed code | generated + revoked code TRIAL-117E813A live (id 1325, `revoked=t`); invite email reported `emailed:true` into the sink; SQL verified | OK |

## /admin/access — Access grants (client/src/pages/admin-access.tsx, 544 lines)

Route: App.tsx:216. Platform admins only (403 otherwise; a "Verify it's you" state when the admin
second-factor gate answers 403 reauth). One GET feeds everything:
`GET /api/admin/access-grants?q=` → server/access-grants.ts:401 → `{accounts, active, ended, maxDays}`:
- accounts = searchAccounts (access-grants.ts:208-218): users LEFT JOIN LATERAL the deciding
  subscriptions row (SUBSCRIPTION_ORDER), email ILIKE / display_name ILIKE / company_name ILIKE / id = #n,
  exact id then exact email first, id DESC, LIMIT 20.
- active/ended = listAccessGrants (:136-148): admin_access_grants JOIN users, LEFT JOIN the grant's
  subscription; active = not revoked/replaced and ends_at > now, ending-soonest first; ended = everything
  else, most recently ended first, LIMIT 20.
Verified live: created account audit-small-lane@example.test (17876), granted pro 7d → SQL showed
subscriptions row updated in place (plan pro, status active, current_period_end = granted_at+7d) and
admin_access_grants row 163; re-granted starter 3d → old grant marked replaced, subscription end moved;
revoked → subscriptions status canceled with current_period_end = now, grant revoked_at set. List at every
step matched SQL.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Access grants" header + "Give an account temporary access to a plan." | header | Names the page. | admin-access.tsx:504 | — | browser | OK |
| "Find an account" card (card-find-account) + search box (input-access-search) + spinner + hint | input | Searches accounts by email, name, company or #id (250 ms debounce). Empty shows the 20 newest accounts; the hint says exactly that, and "up to 20" when searching. | admin-access.tsx:506-522 | GET /api/admin/access-grants?q=… (searchAccounts above; ILIKE with %/_ escaped; #id or bare id matches exactly; LIMIT 20) | browser: typed "audit-small-lane" → row appeared; empty list showed 11 newest (12 while another lane added an account — matches max(users.id) checks) | OK |
| Account row (row-account-<id>): email, "#<id> · name · company" | row | One row per matched account with its current access summary. | admin-access.tsx:250-260 | Same GET → accessFor (access-grants.ts:155-197): deciding subscriptions row via SUBSCRIPTION_ORDER; plan via activePlanKey; source = stripe if a live Stripe sub, else grant when an admin_access_grants row holds that exact subscription (grantHoldsRow :83-86), else trial_code when status trialing or a redeemed beta code, else "grant" fallback | browser + SQL (user 1's row) | OK |
| Access summary (text-access-<id>): source badge (badge-access-source-<id>: "Paid (Stripe)" / "Granted" / "Trial code" / "No plan"), plan name (or Stripe status in parentheses), "ends <date>" / "no end date" (open-ended = year ≥ 2099), "Admin" tag | badges | Says where the account's access comes from and when it runs out. | admin-access.tsx:77-93 | Same GET → AccountAccess {plan, planName, source, status, endsAt} from subscriptions.current_period_end | browser + SQL: user 1 (seeded Stripe-less sub, NULL end) shows "Granted · no end date"; AUDIT account showed "No plan" before and "Granted · ends Oct 11" after the grant | OK (see UNCLEAR-1 for the fallback) |
| "Grant access" / "Change or extend" / "Close" button (button-open-grant-<id>) | button | Expands the grant form under the row. Platform admins instead see "Platform admins already have every feature." and no button. | admin-access.tsx:261-275 | client only | browser: opened on AUDIT account | OK |
| Grant form (form-grant-<id>): Plan select (select-grant-plan-<id>, one option per plan with $/mo) + plan tagline | select | Picks which plan to give; defaults to the account's current plan (or starter). | admin-access.tsx:102, 144-160 | client only (PLANS from shared/plans.ts); GRANTABLE_PLANS = all PLAN_KEYS | browser (select + tagline render; option nodes mount in a Radix portal when opened) | OK |
| Days input (input-grant-days-<id>) "Days (1–1,000)" + quick picks 7/30/90/"1 year"/"1,000 days" (button-grant-days-<n>-<id>) | input + buttons | How many days the access lasts; quick picks fill the box. Anything but a whole 1–1000 shows a red hint. | admin-access.tsx:161-190 | client only (validGrantDays / ACCESS_GRANT_QUICK_DAYS from shared/access-grants.ts:8-11); server re-validates (grantInputError, access-grants.ts:383-393) | browser: 5 quick picks, "45" → live "Ends Wed, Nov 18, 2026 … (45 days from now)" | OK |
| "Ends <date> (<n> days from now)" line (text-grant-ends-<id>) | computed text | Live preview of the end date the grant will set (now + days, browser time). | admin-access.tsx:194-199 | client only: grantEndsAt(days) = now + days×86.4e9 (shared/access-grants.ts:21-23); the server uses the same math at write time | browser (above) | OK |
| Note textarea (input-grant-note-<id>) "(optional, only admins see it)" | input | An internal note on the grant, max 500 characters. | admin-access.tsx:201-213 | POST body note → admin_access_grants.note (trimmed; blank → NULL) | browser + grant 163 note visible in SQL and the ended list | OK |
| "…has <plan> now (…). This grant replaces it." (text-grant-replaces-<id>) | notice | Warns that granting replaces whatever access the account currently has. | admin-access.tsx:134-136, 215 | Matches server: grantAccess replaces the deciding subscriptions row in place and marks earlier open grants replaced (access-grants.ts:281-284) | live: re-grant replaced grant 163 | OK |
| "Grant access" submit (button-grant-<id>) + confirm dialog (dialog-confirm-grant: plan/days/end summary, "We email them…", Cancel button-cancel-grant, "Grant access" button-confirm-grant) | button + dialog | Asks for confirmation, then grants: writes/updates the subscription, records the grant, emails the account. Toast shows the server's message ("Pro access granted to … until … We emailed …."). | admin-access.tsx:217-245 | POST /api/admin/access-grants {userId, plan, days, note?} → access-grants.ts:414 → requirePlatformAdmin + Origin check + grantInputError → grantAccess (:244-294): advisory lock per user; 409 if a live Stripe sub; UPDATE subscriptions (plan, status active, end, Stripe fields cleared) or INSERT; INSERT admin_access_grants (with previous sub snapshot); older open grants of that user marked replaced; admin_audit_log row; account activity "billing.access_granted"; transactional email accessGrantedEmail (local sink on dev) → 201 {grant, account, email, message} | live full round-trip on AUDIT account: 201, email "sent", SQL rows verified; blocked panel (text-grant-blocked-<id>) shown client-side when paidStripe — matches the 409 | OK |
| "Active grants (n)" card (card-active-grants) | card + count | Every grant currently holding access; the count in the title is grants.length from the same list. | admin-access.tsx:334-340 | Same GET → listAccessGrants active (ends_at > now, not revoked/replaced, ordered ends_at ASC) | live: 1 after granting, 0 after revoke; SQL `admin_access_grants` matched at each step | OK |
| Active grant row (row-active-grant-<id>): account + note, plan badge, "Granted by" email, Started, Ends (text-grant-ends-at-<id>), Days left (text-grant-days-left-<id>) | row | One row per live grant; Days left is whole days until the end (a part day counts as one; 0 once past). | admin-access.tsx:351-359 | Same GET → grantDaysLeft (shared/access-grants.ts:26-29) on admin_access_grants.ends_at | live: 7-day grant showed 7 | OK |
| "Extend" button (button-extend-grant-<id>) + dialog (dialog-extend-grant: "…has <plan> until … A new grant replaces the end date, counted from now." + the same GrantForm) | button + dialog | Grants again on the same account — the new grant's end date replaces the old one (the old row becomes "Replaced"). | admin-access.tsx:361-363, 374-384 | POST /api/admin/access-grants (same as above; accountOfGrant feeds the form) | live: extended grant 163 → 164; SQL: 163 replaced_at set, subscriptions.end moved to +3d | OK |
| "Revoke" button (button-revoke-grant-<id>) + confirm (dialog-confirm-revoke: "Access ends now instead of <date>…", "Keep access" button-cancel-revoke, "Revoke access" button-confirm-revoke) | button + dialog | Ends the grant immediately: the account's plan features stop, their data stays. Toast says "Access revoked" (or "Nothing to revoke" if it had already ended). | admin-access.tsx:364-366, 386-406 | POST /api/admin/access-grants/:id/revoke → access-grants.ts:459 → revokeAccessGrant (:302-333): 404 unknown; if the grant is no longer active → {changed:false} idempotent; else UPDATE subscriptions SET status 'canceled', current_period_end = now (only the row the grant wrote — never a Stripe row); UPDATE admin_access_grants revoked_at/by; audit + account activity | live on grant 164: message "…has ended.", SQL subscriptions canceled + grant revoked; "Nothing to revoke" branch by code | OK |
| "No account has granted access right now." (text-no-active-grants) | empty state | Shown when no grant is live. | admin-access.tsx:338-339 | same GET → active = [] | browser | OK |
| "Recently ended" card (card-ended-grants): rows (row-ended-grant-<id>) with account, plan, granted by, started, days, ended date, "How" badge (badge-ended-status-<id>: Revoked/Expired/Replaced) + explanation text | card + rows | The 20 most recently ended grants and why each ended. | admin-access.tsx:418-459 | Same GET → ended = NOT (open) ORDER BY coalesce(revoked_at, replaced_at, ends_at) DESC LIMIT 20, re-sorted; grantStatus (:89-99): revoked_at → "Revoked by …"; replaced_at → "Replaced by a newer grant"; ends_at ≤ now → "Ran to its end date"; a subscription no longer matching (paid plan / trial code took over) → "Replaced by a paid plan" / "Replaced by a trial code" / "Changed outside this page" | live: grants 163/164 appear with Replaced/Revoked badges matching SQL | OK |
| "No grant has ended yet." (text-no-ended-grants) | empty state | Shown when nothing has ever ended. | admin-access.tsx:424-425 | same GET | code (was non-empty during audit) | OK |
| Loading / "Verify it's you" (button-admin-access-verify) / denied (page-admin-access-denied, "Platform admins only", "Back to the dashboard" → /) | states | Loading line; if the admin second factor demands a fresh check, a Verify button retries the same GET; a 401/403 becomes the denied card. | admin-access.tsx:475-500 | requirePlatformAdmin (server/crm/admin.ts) with skipGate for the GET; 403 reauth body → verify state | code only — the admin gate env isn't configured on this dev server, so the verify state can't render (UNCLEAR why: environment) | OK |

UNCLEAR-1: an account whose deciding subscriptions row is Stripe-less and active, but was **not** created
by this page (no matching admin_access_grants row, no trial code, not trialing) — e.g. user 1's seeded dev
row — is labeled "Granted" by the fallback at server/access-grants.ts:176, while the Active grants card
shows none. Production code creates such rows only via this page or trial codes, so the fallback is usually
right (it also covers pre-tracking legacy grants); whether seed/legacy rows should say something else is an
owner call. Same fallback drives the "Change or extend" button label.

## /admin/feature-pages — Feature pages (client/src/pages/admin-feature-pages.tsx, 133 lines)

Route: App.tsx:214. One read: `GET /api/admin/feature-pages` → server/feature-pages.ts:81 →
adminFeaturePageRows() (:35-78): pure data from the shared catalogues — no DB. counts.ready/stub count
FEATURE_PAGES (shared/feature-pages.ts), serviceCounts count DFY_PAGES (shared/dfy-pages.ts); "external"
rows (callAssistant, reinstatement) sit in the groups but outside the ready/stub denominators, same as the
copy implies. Verified live: 30 ready / 0 stub / 5 services ready; 38 rows in 8 groups rendered.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Feature pages" header + "Open public catalogue" (link-admin-features-catalogue) and "Services catalogue" (link-admin-dfy-catalogue) | header + buttons | The catalogue buttons open /features and /done-for-you. | admin-feature-pages.tsx:74-77 | —; both routes exist (App.tsx:208-212) | browser + route check | OK |
| Stat "Features written <n>" hint "of <ready+stub> feature pages" / Stat "Feature stubs" / Stat "Services written" hint "of … service pages" (text-feature-pages-counts) | stats | How many feature/service intro pages are written vs still placeholders. | admin-feature-pages.tsx:78-84 | Same GET → counts {ready, stub} = FEATURE_PAGES by status; serviceCounts = DFY_PAGES by status | live: 30/0 and 5/0 rendered; matches the constants the rows come from | OK |
| Group sections (card-admin-feature-group-<key>): Grow 8, Protect 7, Win jobs 5, Run the business 6, Learn 3, The platform 2, Done-For-You 6, Site 1 | sections | Every feature intro page, then the done-for-you services, then the home landing. | admin-feature-pages.tsx:85-130 | Same GET → pages[] grouped by row.group (FEATURE_CATALOGUE + DFY_CATALOGUE + the landing row) | live: 8 groups, 38 rows | OK |
| Row title + status badge (Ready / Stub / Own page / Page, with explanatory tooltips) | badge | Says whether the page is written (Ready), a placeholder (Stub), hand-built outside the template (Own page), or a plain site page (Page). | admin-feature-pages.tsx:95-102 | Same GET → row.status from the catalogue constants | live: all rows render, 0 stubs, 2 "Own page" (/call-assistant, /reinstatement), 2 "Page" (landing + …) | OK |
| "Replaces <legacy path> (redirects here)" / "(still live until this page is ready)" | note | On rows that retire an old landing page: ready → the old URL redirects; stub → the old page is still live. | admin-feature-pages.tsx:103-107 | Same GET → legacyPath from featurePageByKey; the redirect is LegacyLanding (client/src/pages/features.tsx:210-213): renders Replace→/features/<slug> when the feature's flag is on, else 404 | code + route check: /permits-landing, /google-ads-landing, /competitors-landing, /master-class-landing all registered (App.tsx:196-201, :221-222, :318-319); all four features are "ready" so the redirect branch applies | OK |
| Public page link (link-admin-feature-public-<key>) → row.path (/features/<slug>, /call-assistant, /reinstatement, /landing, /done-for-you/<slug>) | link | Opens the public intro page. | admin-feature-pages.tsx:109-112 | client only (wouter Link) | route check: /features/:slug (App.tsx:209), /done-for-you/:slug (:212), /call-assistant (:206), /reinstatement (:191), /landing (:327) all exist; 200 on /google-reviews checked for the flag-gated route (SHOW_GOOGLE_REVIEWS/SHOW_COMPETITOR_INTEL are true, client/src/lib/features.ts:9,23) | OK |
| "In the app" link (link-admin-feature-app-<key>) or "—" | link | Opens the tool inside the app; CRM pages (surface "portal": /crm, /crm/schedule, /crm/pipeline, /crm/settings) open on the CRM host via portalUrl() as a full page load; "—" when the service has no in-app tool. | admin-feature-pages.tsx:113-123 | client only: DashLink (client/src/components/dashboard/dash-link.tsx:16-21) → portalUrl (client/src/lib/site.ts:63-70) prefixes portal. on non-CRM hosts; all four CRM routes exist in App.tsx:393-403 | code — on this portal-mode bare host the portal. prefix doesn't resolve in a browser (environment); every "app" href exists as a route | OK |
| Loading / denied (page-admin-feature-pages-denied, "Platform admins only", "See every feature" → /features) | states | Same pattern as /admin/access. | admin-feature-pages.tsx:49-64 | 401/403 from the same GET (isPlatformAdmin, server/admin.ts) | code only (admin gate not configured on dev) | OK |

## /admin/issues — Issue desk (client/src/pages/admin-issues.tsx, 287 lines)

Route: App.tsx:218. List: `GET /api/admin/issues?status=&source=` → server/ops/routes.ts:77 →
listIssues (server/ops/issues.ts:280) on **ops_issues** — list and total filtered by status+source,
newest last_seen first, LIMIT 50; counts = per-status GROUP BY (see BUG-1: it ignored the source filter
until this audit's fix). Drawer: `GET /api/admin/issues/:id` (routes.ts:85 → getIssue :300, detail +
timeline). Actions: `POST /api/admin/issues/:id/status {status: fixed|ignored|new}` (routes.ts:97 →
setIssueStatusByAdmin :315; anything else 400 — "inspecting" is refused). Verified live: recorded a client
error (POST /api/ops/client-error) → issue #48 in "triage" → drawer showed detail → marked fixed → SQL
ops_issues row shows status fixed and history [reported, fixed by "d***@constructhub.local"].

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| "Issues" header + "Review failures, inspect reports, and track fixes." | header | Names the page. | admin-issues.tsx:214 | — | browser | OK |
| Status tabs (filter-status-all, filter-status-triage, -new, -inspecting, -inspected, -fix_ready, -fixed, -ignored) with per-tab counts | tabs | Filter the list by status; each tab shows how many issues have that status (within the chosen source). "All" = the sum. | admin-issues.tsx:206-227 | Same GET → payload.counts (per-status GROUP BY, filtered by source only after this audit's fix; never by the selected status, so counts don't move when a tab is chosen) | SQL `GROUP BY status` matched the tab numbers at every step (16, then 17 when another lane added an issue) | OK after BUG-1 fix (was BUG) |
| Source filter (select-issue-source): All sources / Server / Background job / Browser / Call Assistant / Health check | select | Narrows the list to one kind of capture. | admin-issues.tsx:228-234 | Same GET → ?source= (zod enum; bogus → 400) | live: health → 2 rows = SQL `WHERE source='health'` count | OK |
| List header + rows (row-issue-<id>): severity dot (Critical/Error/Warning/Info), title, branch line when present, Source, Count ("×n" on mobile), Last seen ("… ago", full date on hover), status pill, chevron | row | One row per issue (no detail JSON). Clicking opens the drawer. | admin-issues.tsx:237-277 | Same GET → ops_issues (id, source, severity, title, count, first_seen, last_seen, status, report, branch, inspected_at, claimed_at), ORDER BY last_seen DESC, id DESC LIMIT 50 | live: 16 rows rendered = SQL; row click opened drawer | OK |
| "Showing the <n> most recent of <total>." | note | Appears only when more than 50 match. | admin-issues.tsx:280-282 | same GET → total = COUNT(*) with the same filters | code only (17 < 50) | OK |
| Empty state (empty-issues): "No issues marked … from …" + "When something fails, it shows up here and Claude takes a look." | empty state | Shown when the current filters match nothing; the sentence names the chosen filters. | admin-issues.tsx:245-250 | same GET → issues = [] | code only | OK |
| Auto-refresh | behaviour | Re-asks the list every 60 s once data has loaded (never re-prompts verification on a timer). | admin-issues.tsx:175-179 | same GET | code only | OK |
| Drawer (drawer-issue): status pill, severity pill, source pill, #<id>, title (text-issue-title), "Seen <n> times · last <when> ago" | sheet | The full issue: what happened, how often, when. | admin-issues.tsx:84-102 | GET /api/admin/issues/:id → ops_issues row + history (404 → "Couldn't load this issue.") | live on #48 | OK |
| "Mark fixed" (button-issue-fixed) | button | Marks the issue fixed; disabled when already fixed. | admin-issues.tsx:105-107 | POST …/status {status:"fixed"} → setIssueStatusByAdmin → UPDATE ops_issues status, history += {event:"fixed", by: masked admin email} | live: status + history in SQL; button disabled in browser after | OK |
| "Ignore" (button-issue-ignore) | button | Marks it ignored (noise we don't act on); disabled when already ignored. | admin-issues.tsx:108-110 | same POST with {status:"ignored"} | covered by the route test suite (fixed→ignored→reinspect chain); not pressed on real issues | OK |
| "Send to Claude" / "Re-inspect" (button-issue-reinspect) | button | "Send to Claude" on a browser-reported issue (triage) hands it to the issue desk for inspection; "Re-inspect" on an inspected one sends it back (status new, claim cleared) so the next 15-minute run picks it up. Disabled while new/inspecting. | admin-issues.tsx:111-113 | same POST with {status:"new"} → status new, claimed_at = NULL, history += {event:"reinspect"} | covered by the route test suite; **not pressed live on purpose** — "Send to Claude" would hand the issue to the tower/Claude | OK |
| Details grid: Count, First seen, Last seen, Inspected, Branch (text-issue-branch, "No fix branch" when none) | stats | Timestamps and the fix branch when Claude filed a report with one. | admin-issues.tsx:116-127 | same GET → count, first_seen, last_seen, inspected_at, branch | live on #48 ("No fix branch") | OK |
| "Claude's report" (text-issue-report) or status-aware fallback copy | section | Claude's write-up when the tower inspected it; otherwise an honest "not inspected yet" line (triage explains browser reports only reach Claude after "Send to Claude" — true: triage rows are invisible to the tower until claimed, shared/ops-issues.ts:17). | admin-issues.tsx:129-136 | same GET → report | code (no inspected-with-report rows live) | OK |
| Timeline | list | Newest first: reported / reopened / claimed / inspected / fix_ready / ignored / fixed / reinspect, with who (claude, issue desk, masked admin). | admin-issues.tsx:138-151 | same GET → history[] | live: [reported, fixed by d***@…] on #48 | OK |
| "Detail" JSON (text-issue-detail) + "Scrubbed when captured…" note | pre | The captured detail (server scrubbed secrets; emails/phones masked). | admin-issues.tsx:153-157 | same GET → detail | live on #48 | OK |
| Loading / verify (button-admin-issues-verify) / denied (page-admin-issues-denied) | states | Same pattern as /admin/access: spinner; "Verify it's you" retry when the admin gate asks; "Platform admins only" on 401/403. | admin-issues.tsx:182-204 | requirePlatformAdmin | code only (gate not configured on dev) | OK |

BUG-1 (fixed this audit): with a source chosen, the tab counts ignored it — e.g. "Health check" shows 2
rows but the tabs claimed "All 17 · New 10" (screenshot 05-admin-issues-source-filter.png). Root cause:
listIssues computed counts with a bare `GROUP BY status`. Fixed in server/ops/issues.ts:289-297 (counts now
carry the source filter, never the status filter) with a regression test in server/ops/issues.test.ts.

