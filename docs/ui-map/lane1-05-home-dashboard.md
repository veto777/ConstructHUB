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
