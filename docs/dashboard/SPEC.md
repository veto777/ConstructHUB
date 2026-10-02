# Signed-in home dashboard: spec

*Spec agent, 2026-10-02, branch `dash/skeleton`. Owner's request: "Revamp the home page for the app once
you are logged in and make it an actual dashboard. So you can see all your features here like an actual
dashboard of goodies."*

The signed-in `/` (`client/src/pages/home.tsx`, `DashboardRouter` in `client/src/App.tsx`) currently shows
marketing copy ("Stop Guessing. Start Dominating.", stat tiles, "Your Complete Toolkit"). It becomes a working
dashboard in the **app's** visual language: shadcn/ui, Inter, the existing `AppSidebar` and header, light and
dark. It does not use the marketing fonts (Fraunces, Plus Jakarta Sans, Barlow). The marketing landing
(`landing.tsx`, `PublicRouter`) and the public chrome stay as they are.

**Already on this branch**
- `shared/dashboard.ts` holds the contract types, the tile catalogue (`DASHBOARD_TILES`), the groups, and the timeouts.
- `server/dashboard/access.ts` has `tileAccess(def, ent)`, the gate logic shared by the fixture and the aggregator.
- `server/dashboard/fixture.ts` builds sample payloads. Each one has `fixture: true` and uses the scenarios `full`, `new` and `noplan`.
- `server/dashboard/index.ts` registers `GET /api/dashboard` behind the session (`getDevUser`, 401 when signed out). It returns the fixture, and `?fixture=new|noplan` picks a scenario.
- `server/routes.ts` registers it with one line, after `registerAccountEventRoutes`.
- `server/dashboard/fixture.test.ts` checks the contract and the gates against the price book.

The frontend lane can start now. The backend lane replaces the fixture with the aggregator below.

---

## 0. Hard rules (from the repo CLAUDE.md, applied here)

1. **No fabricated numbers.** Every metric comes from a row the account owns, or from the active CRM org, or
   from the real reference directory (property appraisers and verified permit portals). If a value is
   unknown, it is `null`, which renders as "—". Nothing is estimated or derived from a hash. Ad spend and
   clicks are shown only when Google's own synced snapshot contains them. Only the skeleton sets
   `fixture: true`, and the client then shows a "Sample data" badge.
2. **Scoping.** Growth-side tiles filter on `user_id = <signed-in user>`. CRM tiles filter on
   `org_id = <active org>` and go through the same permission and division checks as `/api/crm/stats` and
   `/api/crm/attention`. The route is not in the agency delegation allowlist (`registerAgencyAccess`), so
   `getDevUser` returns the actor. An agency teammate therefore sees their own dashboard, never the owner's.
3. **The dashboard has no side effects.** It must not create a CRM org. `requireOrg` and `/api/crm/me` call
   `ensureOrgForUser`, which inserts one, so the dashboard uses a read-only lookup instead (§3.4). It also
   must not write `last_active_at`, spend quota, or call Google or another provider. It reads only what
   workers and pages have already stored.
4. **Plan gates are the server's.** `entitled` comes from `getEntitlements(userId)` through `tileAccess`
   (shared/plans.ts is the source of truth). A locked tile reads no feature data at all.
5. Keep the security rules in CLAUDE.md intact. The route registration adds nothing beyond one route.

---

## 1. Feature inventory (what the signed-in app offers today)

The inventory comes from walking `app-sidebar.tsx`, each page it links to, and the server route each page
reads. "Gate" is the check the server enforces today. "Goodies" are the numbers each tile shows, together
with their source.

| # | Feature (sidebar) | Page route | Existing endpoint(s) | Gate (server) | Goodies → source |
|---|---|---|---|---|---|
| 1 | CRM (portal) | portal `/crm` (`/crm-app` gateway) | `/api/crm/stats`, `/api/crm/attention`, `/api/crm/follow-ups`, `/api/crm/schedule`, `/api/crm/team-activity`, `/api/crm/onboarding` | CRM org membership; revenue needs the `seeReporting` permission | pipeline value, open estimates (count and $), jobs won, open invoices ($ due), sold but not scheduled, active clients → the `/api/crm/stats` logic |
| 2 | Permits: Search Permits | `/search` | `/api/search-queries`, `/api/search-results/recent`, `/api/entitlements` (usage) | `searches` meter (any plan) | searches used / limit this month (`growth_budgets`); searches in the last 7 days (`search_queries.user_id`); last search |
| 3 | Permits: Database Directory | `/databases` | `/api/databases`, `/api/databases/counts` | none | (link on the permits tile) |
| 4 | Permits: Property Records | `/property` | `/api/property-appraisers`, `/api/property-records/:countyId` | none | counties with an appraiser office → `count(DISTINCT county_id) FROM property_appraisers WHERE is_active` (reference data, NETR-sourced) |
| 5 | Permits: Scrape Schedules | `/schedules` | `/api/scrape-schedules` | none (global rows, not per user) | none: not per account, so no tile |
| 6 | Permits: Search History | `/history` | `/api/search-queries` | none | (link on the permits tile) |
| 7 | Google Business: Locations | `/locations` | `/api/locations`, `/api/gbp/status`, `/api/entitlements` | `requirePlan` (import, add) | locations linked / allowance (`locationCount`); Google accounts connected (`gbp_grants`); locations with a sync error (`gbp_sync_status.last_error`) |
| 8 | Google Business: Agency | `/agency` | `/api/agency/me`, `/api/agency/dashboard` | module `agencyWorkspace` | clients (`agency_clients`), teammates (`agency_members`) |
| 9 | Google Business: Domains | `/domains` | `/api/domains/connections` | module `domainsMailAlerts` | domains watched (`managed_domains`); expiring within 30 days (`state->>'expires'`); auto-renew off (`state->>'autoRenew' = 'false'`) |
| 10 | Google Business: Mail alerts | `/mail-alerts` | `/api/mail-alerts/settings` | module `domainsMailAlerts` | unread alerts (`mail_alert_messages.read_at IS NULL`); alerts in the last 7 days |
| 11 | Google Business: Posts & Photos | `/gbp-content` | `/api/gbp/content/*` | `requirePlan` (GBP management) | scheduled (`gbp_content_jobs.status='queued'`); published in 30 days (`status='published'`); need attention (`status IN ('failed','uncertain','rejected')`) |
| 12 | Google Business: GMB Edit Monitor (Profile Guard) | `/gmb-monitor` | `/api/gbp/guard/status` | `requirePlan` (Profile Guard) | locations guarded (`gbp_guard.mode<>'off'`) / allowance; edits awaiting review (`gbp_guard_changes.status='pending'`); last check (`max(checked_at)`) |
| 13 | Google Business: Ranking Grid | `/ranking-grid` | `/api/ranking-grid/scans` | `rankings` meter | credits used / limit (`growth_budgets`); last grid and its `average_rank` (`ranking_grid_scans`, latest `status='completed'`) |
| 14 | Google Business: Photo Optimizer + Media Library | `/photos`, `/media-library` | `/api/media/folders` | `photos` meter (any plan, fair use) | photos stored (`media_photos`); folders (`media_folders`) |
| 15 | Google Business: Reinstatement | `/reinstatement` | none (service page) | none | link tile only |
| 16 | Google Ads: Agency Ads & LSA | `/ads-manager` | `/api/ads/status`, `/api/ads/accounts`, `/api/ads/findings` | module `adsManager` | client accounts (`ads_accounts`, not manager); LSA accounts (`lsa=true`); audit findings (`count(*) FROM ads_findings WHERE user_id=$1`; the table has no open/resolved state); spend and clicks **only** if `ads_accounts.snapshot` carries Google's metrics (omitted otherwise) |
| 17 | Google Ads: Click Guard | `/google-ads` | `/api/click-guard/domains` (+ `/:id/analytics`) | allowance `protectedSites ≠ 0` (Pro+) | sites protected / allowance (`tracked_domains`); suspicious clicks in 30 days (`click_visits.is_suspicious`); IPs excluded (`blocked_ips.is_active`) |
| 18 | Google Ads: Ad Fraud, Ads Guide, LSA Guide | `/google-ad-fraud`, `/google-ads-guide`, `/lsa-guide` | content | none | links on the Guides tile |
| 19 | Google Ads: LSA Leads | `/lsa-leads` | `/api/lsa/status`, `/api/lsa/leads` | none today | leads in 30 days (`lsa_leads.user_id`); disputes in flight (`dispute_status IN ('scheduled','queued','sending')`); last sync (`lsa_connections.last_sync_at`). Cost only as `last_cost_total`, labelled "reported by Google" |
| 20 | Google Reviews | `/google-reviews` | `/api/google-profile-reviews?paged=true` (gives `average`, `unanswered`), `/api/reviews/list` | `requirePlan` for AI replies and templates; listing is open | average rating; new this week (`review_date > now()-7d`); awaiting reply (`reply_comment IS NULL`), all `NOT google_deleted`; review requests sent this month (`review_requests`) |
| 21 | Account Manager (platform admin only) | `/lsa-account-manager` | `/api/admin/lsa/*` | platform admin | **not on the dashboard** (cross-account admin tool) |
| 22 | Social Media | `/social-media` | `/api/social/*` | none in `server/social` today | connected (`social_connections`); scheduled (`social_posts.state='queued'`); published in 30 days (`state='published'`); failed (`state IN ('failed','uncertain')`) |
| 23 | Site Scan | `/site-scan` | `/api/sitescan` | `siteScans` meter | last overall score (`sitescan_jobs.report->'scores'->>'overall'`, latest `status='completed'`); scans used / limit; last scan date |
| 24 | Cloudflare | `/cloudflare` | `/api/cloudflare/*` | module `cloudflareSearchConsole` | zones (`edge_assets.provider='cloudflare'`); accounts connected (`edge_connections`); zones with an error |
| 25 | Search Console | `/search-console` | `/api/gsc/*` | module `cloudflareSearchConsole` | properties (`edge_assets.provider='gsc'`); clicks and impressions over 28 days (`gsc_analytics` where `dimension='date'`) |
| 26 | IP Tracker | `/ip-tracker` | `/api/click-guard/domains/:id/visits` | `protectedSites ≠ 0` | visits in 7 days; unique IPs in 7 days (`click_visits` joined to the user's `tracked_domains`) |
| 27 | VPN Shield | `/vpn-shield` | `/api/vpn-shield/domains` | `protectedSites ≠ 0` | VPN visits blocked in 30 days (`vpn_visits.action='blocked'`); unique IPs |
| 28 | Competitor Intel (`SHOW_COMPETITOR_INTEL`) | `/competitors` | `/api/competitors/scans` | allowance `competitorScans > 0` (Pro+) | scans used / limit; last scan; competitors found (`competitor_scans.total_found`, latest completed) |
| 29 | Master Class | `/master-class` | `/api/master-class-modules`, `/api/course-purchases` | none (sold separately) | modules unlocked of the active total (a bundle purchase unlocks all) |
| 30 | Pricing & Plans | `/pricing` | `/api/stripe/plans`, `/api/entitlements` | none | the header plan chip and usage |
| 31 | Settings, billing, usage | `/settings` (`?tab=billing`) | `/api/entitlements`, `/api/billing/*`, `/api/account/api-usage` | none | the header: plan, status, trial end, renewal, usage meters |
| 32 | Notifications | header bell | `/api/notifications` | none | unread count and the Recent feed (`user_notifications`, last 30 days) |
| 33 | Hub assistant (Gabe) | corner widget | `/api/hub/*` | none | the "Ask Gabe" nudge card |
| 34 | AI Call Assistant (upcoming, `voice/skeleton` → `docs/call-assistant/SPEC.md`) | portal `/crm/call-assistant` | future `GET /api/crm/voice/status` | `call_assistant` add-on (Pro/Growth/Agency, price is a placeholder) | **coming soon** in this build. After the voice routes merge: minutes used / included this month, calls answered, leads captured (`voice_usage`, `voice_calls`) |
| 35 | CRM texting | portal `/crm/settings` | `/api/crm/sms/status` | allowance `teamTextSegments ≠ 0` (Pro+) | text segments used / limit this month (`texts` meter); client texting on or off (`orgSmsStatus`) |

The dashboard does not show the public tools (free Site Scan, shared reports), the client portal, token
pages, or the platform admin tools.

---

## 2. `GET /api/dashboard` contract

The types are in `shared/dashboard.ts` and that file is authoritative. In summary:

```ts
DashboardPayload = {
  generatedAt: ISO; cached: boolean; fixture: boolean;
  account: { firstName, displayName, plan: PlanKey|null, planName, status: "active"|"trialing"|"past_due"|"none",
             isPlatformAdmin, trialEndsAt: ISO|null, renewsAt: ISO|null,
             usage: [{ key, label, used, limit /* -1 unlimited */, period: "monthly"|"count", href }],
             resetsAt: ISO, unreadNotifications: number };
  tiles: [{ key, group, title, description, href, surface: "app"|"portal", entitled, requiredPlan?, module?, addon?,
            status: "ok"|"empty"|"error"|"locked"|"coming_soon", message?,
            metrics: [{ key, label, value: number|string|null, format: "count"|"cents"|"score"|"rating"|"datetime"|"text",
                        limit?, hint?, tone? }],
            cta?: { label, href, surface }, links?: [...], updatedAt: ISO }];   // every DASHBOARD_TILES key, in order
  checklist: [{ key, label, description, done, href, surface }];                // only steps that apply to the plan
  recent: [{ id, at, source: "notification"|"crm", title, body?, href?, surface, severity, unread? }];  // newest first, ≤ 12
}
```

- **Auth.** This is a session route: `getDevUser` returns `401 {message:"Not authenticated"}` when signed out. It never returns 402, because locked features come back as `locked` tiles.
- **Headers.** `Cache-Control: private, no-store`.
- **`surface: "portal"`.** The `href` is a path on the CRM host. The client resolves it with `portalUrl()` (`client/src/lib/site.ts`) and navigates with a full page load.
- **Status rules.**
  - `locked` means `entitled: false`, `requiredPlan` is set, `metrics: []`, a `"Included with the <Plan> plan."` message, and a CTA to `/pricing`. Module tiles also carry `module`.
  - `empty` means entitled but nothing is set up yet (for example no Google grant, no tracked site, no scans). It has `metrics: []` and a setup CTA to the feature page.
  - `error` means the source threw or went past 3 s. It has `metrics: []`, a message ("<Title> didn't answer in time. Open the page for live numbers."), and keeps its link.
  - `coming_soon` is used only for `callAssistant` until `server/voice` exists.
  - `ok` has at least one metric. The link-only tiles (`guides`, `reinstatement`) are `ok` with no metrics.
- **Usage.** Meters with `limit === 0` (not in the plan) are omitted. The monthly meters come from
  `monthlyUsage(userId, ent)` (growth-quotas). `locations` comes from `locationCount`, `protectedSites` from
  `count(tracked_domains)`, and `crmSeats` from `getOwnerSeatUsage` (only when the user owns an org).
- **Flags.** Tiles behind a client feature flag (`flag` in the catalogue) are always sent. The client drops
  them while the flag is off.

### Tile keys (display order) and groups

| group | label | tiles (in order) |
|---|---|---|
| `grow` | Grow | `gbp`, `reviews`, `profileGuard`, `rankingGrid`, `gbpContent`, `social`, `siteScan`, `media` |
| `protect` | Protect | `clickGuard`, `ipTracker`, `vpnShield`, `cloudflare`, `searchConsole`, `domains`, `mailAlerts` |
| `win` | Win jobs | `permits`, `property`, `competitors`, `adsManager`, `lsaLeads` |
| `run` | Run the business | `crm` (rendered as the snapshot card, not in the grid), `crmSchedule`, `crmLeads`, `texting`, `callAssistant`, `agency` |
| `learn` | Learn | `masterClass`, `guides`, `reinstatement` |

Each tile's title, description, href, gate and links are in `DASHBOARD_TILES`. If the order or copy changes,
change it there and nowhere else.

### Getting-started checklist (`checklist`, in this order)

| key | done when | shown when |
|---|---|---|
| `connectGoogle` | a `gbp_grants` row exists for the user | always |
| `addLocation` | `business_locations` count > 0 | always |
| `turnOnGuard` | any `gbp_guard.mode <> 'off'` | has a plan |
| `runSiteScan` | any `sitescan_jobs` row for the user | has a plan |
| `requestReviews` | any `review_requests` row for the user | `SHOW_GOOGLE_REVIEWS` (client drops it while the flag is off) |
| `protectWebsite` | `tracked_domains` count > 0 | `allowances.protectedSites ≠ 0` |
| `setUpCrm` | active CRM membership **and** the CRM onboarding `profile` + `company` steps are done (same rules as `/api/crm/onboarding`) | always |
| `inviteTeammate` | the user's owned org has > 1 member (active or invited), or `agency_members` has a row for the owner | always |
| `addTextingNumber` | `orgSmsStatus(org).configured` | `allowances.clientTexting !== "none"` |

The card hides when every shown step is `done`. A step whose source fails is `done: false` and never blocks the page.

### Recent activity (`recent`)

The feed merges two sources, newest first, and keeps at most 12 items:
- Up to 10 `user_notifications` from the last 30 days. They map as `id "n:<id>"`, `title`, `body`, `link → href`, `severity`, and `unread = read_at IS NULL`.
- Up to 5 CRM team-activity items when the active membership has `seeReporting`. They are built by the same logic as `/api/crm/team-activity`, with `id "c:<id>"`, `title` set to `"<actor> <text>"`, `surface: "portal"`, and `href` set to the item's link.

---

## 3. Backend lane: the aggregator (`server/dashboard/**`)

### 3.1 Shape

```
server/dashboard/
  index.ts        registerDashboardRoutes: auth → cache → aggregate → json (drop ?fixture=)
  aggregate.ts    buildDashboard(userId, req): account + tiles + checklist + recent
  tiles/*.ts      one async function per tile (or per group): (ctx) => DashboardMetric[] | "empty"
  crm.ts          read-only org lookup + CRM numbers
  cache.ts        60 s per-user cache
  access.ts       (exists) tileAccess
  fixture.ts      (exists) keep for client-shape tests; no route uses it after the swap
  *.test.ts
```

`ctx` is computed once per request and shared by every tile:
`{ userId, now, ent: getEntitlements(userId), crm: CrmContext|null, monthKey }`. Each tile reads only `ctx`
and the DB.

### 3.2 Isolation and timeouts

```ts
const settled = await Promise.allSettled(DASHBOARD_TILES.map(def => withTimeout(computeTile(def, ctx), DASHBOARD_TILE_TIMEOUT_MS)));
```

- Locked and coming-soon tiles are decided by `tileAccess` before any query runs.
- If a tile rejects or times out, it becomes `status: "error"` with the standard message, and the error is logged once (`[dashboard] tile <key> failed: <message>`) without the user's data.
- The account header, checklist and recent feed are each settled separately and degrade the same way. A failed `usage` becomes `[]`, a failed `checklist` becomes `[]` so the card hides, and a failed `recent` becomes `[]`. If `getEntitlements` itself fails, the whole response is a 500 `{message:"Could not load your dashboard. Please try again."}`, because no gate can be computed without it.
- Timeouts do not cancel the SQL. Run each tile's queries with a statement timeout no longer than the budget. Use one `pool.connect()` per tile with `SET statement_timeout = 3000`, then `RESET` and release in `finally`. The alternative is to keep every query on an indexed `(user_id, created_at)` path and never touch the network. Both are acceptable. Whichever is used, a slow tile must not hold pool connections after the response.
- The whole request should finish in about 3.5 s in the worst case and in under 300 ms typically.

### 3.3 Cache

- The cache is in-memory, `Map<string, {at, payload}>`, keyed `${userId}:${activeOrgId ?? "-"}` because a session's pinned org changes the CRM numbers. TTL is `DASHBOARD_CACHE_MS` (60 s), with at most 5,000 entries (evict the oldest).
- A cached answer is returned with `cached: true` and its original `generatedAt`.
- Never cache an answer whose `account` failed. Errored tiles may be cached for the TTL, since retrying a broken source every second is worse.
- `?fresh=1` bypasses the cache at most once every 10 s per user. The Refresh button uses it, and anything sooner gets the cached answer.
- A change to what the account may see calls `forgetDashboard(userId)` (server/dashboard/cache.ts): change-plan, add-ons, every Stripe webhook that names an account, trial-code redeem/revoke, and a CRM seat updated or disabled. A build that started before the forget is answered but not stored. The key also carries a verified agency workspace (`…@<ownerId>`).

### 3.4 CRM context, read-only (no org creation)

`crm.ts` repeats `resolveOrg` from `server/crm/tenancy.ts` without the `ensureOrgForUser` fallback:
1. If `req.session.activeOrgId` is set and that org has an active membership for the user, use it.
2. Otherwise use the oldest active `crm_members` row for the user (the same stable order as `ensureOrgForUser`).
3. If there is none, `crm` is null. The CRM tiles are then `empty` with the CTA "Set up the CRM" → `/crm-app` (app surface, the gateway).

Permissions come from `crmEffectivePermissions(member.role, member.permissions)`.

- **`crm` tile.** This needs `seeReporting`. Use the exact rules of `/api/crm/stats`, including the division and object-policy path for restricted seats. **Extract-only refactor allowed:** move the handler body of `/api/crm/stats` into `export async function crmStatsFor(ctx)` in `server/crm/stats.ts`, and the `/api/crm/attention` body into `export async function crmAttentionFor(ctx)` in `server/crm/follow-ups.ts`. The routes then call those functions, with no change in behavior, and the existing CRM tests must stay green. A member without `seeReporting` gets `ok` showing only "Today's visits" (their own appointments) and the CTA "Open the CRM".
- **`crmSchedule`.** Counts `crm_appointments` with `status <> 'canceled'` (one l, as in `server/crm/schedule.ts`) starting today and starting this week (UTC wall time, like the rest of the CRM). It covers the org when `viewAllJobs`, and otherwise the member's own appointments (created by them or dispatched to them).
- **`crmLeads`.** `newLeads7d` and `followUpsDue` come from `crmAttentionFor(ctx)`.

### 3.5 Per-tile queries (all parameterised, `$1 = userId`)

All tiles use the same rule: when a feature has never been used (no grant, no rows), the tile is `empty`, not `ok` with zeros. Once the feature is set up, zeros are real numbers and the tile is `ok`.

- **`gbp`**
  - `locationCount(userId)` / `ent.allowances.locations`.
  - `count(*) FROM gbp_grants WHERE user_id=$1`.
  - `count(DISTINCT location_id) FROM gbp_sync_status s JOIN business_locations l ON l.id=s.location_id AND l.user_id=$1 WHERE s.last_error IS NOT NULL`.
  - `empty` when there are no grants and no locations.
- **`reviews`**
  - Over `google_profile_reviews WHERE user_id=$1 AND NOT google_deleted`: `avg(rating)` (null when there are none), the count with `review_date > now()-interval '7 days'`, and the count with `reply_comment IS NULL`.
  - `empty` when there are no reviews and no `review_requests`.
- **`profileGuard`**
  - `count(*) FROM gbp_guard WHERE user_id=$1 AND mode<>'off'` / `allowances.locations`.
  - `count(*) FROM gbp_guard_changes WHERE user_id=$1 AND status='pending'`.
  - `max(checked_at)`.
- **`rankingGrid`**
  - `usage.rankings`.
  - The latest `ranking_grid_scans WHERE user_id=$1 AND status='completed'`: `created_at` and `average_rank` (text, shown as is).
- **`gbpContent`**: counts by `status` over `gbp_content_jobs WHERE user_id=$1`, as in the inventory.
- **`social`**: counts by `state` over `social_posts WHERE user_id=$1`. The tile is `empty` when there is no `social_connections` row.
- **`siteScan`**
  - The latest completed `sitescan_jobs WHERE user_id=$1`: `(report->'scores'->>'overall')::int` and `completed_at`.
  - `usage.siteScans`.
- **`media`**: `count(*) FROM media_photos WHERE user_id=$1` and `count(*) FROM media_folders WHERE user_id=$1`.
- **`clickGuard`, `ipTracker`, `vpnShield`**
  - `tracked_domains WHERE user_id=$1` gives the site count against `allowances.protectedSites`.
  - Join `click_visits`, `blocked_ips` and `vpn_visits` on `domain_id = ANY(<the user's domain ids>)` with `visited_at` / `blocked_at` windows.
  - These tables have no `user_id`: always go through the user's `tracked_domains`.
- **`cloudflare`, `searchConsole`**
  - Use `edge_connections` and `edge_assets WHERE user_id=$1 AND provider=…`.
  - GSC: `sum(clicks)` and `sum(impressions)` over `gsc_analytics a JOIN edge_assets e ON e.id=a.asset_id AND e.user_id=$1 WHERE a.dimension='date' AND a.date > current_date - 28`.
- **`domains`, `mailAlerts`**: as in the inventory, from `managed_domains` and `mail_alert_messages WHERE user_id=$1`.
- **`permits`**
  - `usage.searches`.
  - `count(*) FROM search_queries WHERE user_id=$1 AND created_at > now()-'7 days'`.
  - `max(created_at)`.
  - The tile is `ok` (the meter is always meaningful).
- **`property`**: `count(DISTINCT county_id) FROM property_appraisers WHERE is_active`. This is reference data, so cache it process-wide for 10 minutes.
- **`competitors`**
  - `usage.competitorScans`.
  - The latest `competitor_scans WHERE user_id=$1 AND status='completed'`: `created_at` and `total_found`.
- **`adsManager`**
  - `ads_grants` existence (otherwise `empty`).
  - `count(*) FROM ads_accounts WHERE user_id=$1 AND NOT manager`, and the same with `lsa`.
  - `count(*) FROM ads_findings WHERE user_id=$1` (the latest audit's findings; there is no resolved state).
  - Spend and clicks: add them **only** if the backend lane finds Google's cost and click fields in `snapshot`. Document the fields it used in the PR. Otherwise leave these metrics out.
- **`lsaLeads`**
  - `lsa_connections.refresh_token IS NOT NULL` (otherwise `empty`).
  - `lsa_leads WHERE user_id=$1`: count in 30 days, and disputes in flight.
  - `last_sync_at`.
  - `last_cost_total`, only with the hint "reported by Google".
- **`texting`**
  - `usage.texts`.
  - `orgSmsStatus(org)` → `canTextClients` shown as "On" or "Off" (`text` format).
  - Without a CRM org: `empty`.
- **`agency`**: `count(*) FROM agency_clients WHERE user_id=$1`, `count(*) FROM agency_members WHERE user_id=$1`, and the location count.
- **`masterClass`**
  - Active `master_class_modules` count.
  - The user's `course_purchases`: a bundle counts as all modules, otherwise `count(DISTINCT module_id)`.
- **`callAssistant`**: always `coming_soon` until `server/voice` exists on main. **Do not import or query voice tables.** When the voice lanes merge, a follow-up switches it to the `addon` gate and reads `voice_usage` for the active org and month.
- **`guides`, `reinstatement`**: static, `ok`, no metrics.

### 3.6 Account header

- `plan`, `planName` and `isPlatformAdmin` come from `getEntitlements`.
- `status` comes from the access-deciding subscription row, using the same `SUBSCRIPTION_ORDER`. It is `active`, `trialing` or `past_due` when the status is one of those, and otherwise `none`. A Stripe-less grant (trial code) counts as `trialing`.
- `trialEndsAt` is `ent.grantEndsAt`, or `current_period_end` for a Stripe `trialing` row.
- `renewsAt` is `current_period_end` for an active Stripe row.
- `firstName` is the first word of `users.display_name`, otherwise null.
- `unreadNotifications` uses the `/api/notifications` count query.

### 3.7 Backend tests (`server/dashboard/*.test.ts`)

- Unit tests:
  - `tileAccess` (exists).
  - Status mapping: empty, ok, error and locked.
  - Timeout: a tile that never resolves becomes `error` in under 3.5 s, and the other tiles stay `ok`.
  - Cache: a second call is `cached: true`, a different `activeOrgId` gives a different entry, and `fresh` is throttled.
- Integration tests against the dev server (child server from the worktree, port 8240–8260):
  - Signed out → 401.
  - Seeded user A sees their counts and never user B's: insert rows for both, and assert A's numbers.
  - A user with no CRM membership gets the CRM tiles as `empty`, and `crm_orgs` row counts are unchanged before and after the request.
  - A Starter user gets `cloudflare` locked with `requiredPlan:"agency"`.
  - Breaking one source (for example by renaming a table inside a transaction, or with a test-only failure hook) leaves every other tile `ok`.

---

## 4. Frontend lane: the page

### 4.1 Files

- `client/src/pages/home.tsx` is rewritten. It becomes a thin page that fetches `/api/dashboard` and composes the parts below. Delete the marketing content and the particle canvas.
- `client/src/components/dashboard/**` holds:
  - `dashboard-header.tsx`
  - `usage-strip.tsx`
  - `checklist-card.tsx`
  - `crm-snapshot-card.tsx`
  - `tile-grid.tsx`
  - `dashboard-tile.tsx`
  - `locked-prompt.tsx`
  - `recent-activity.tsx`
  - `gabe-nudge.tsx`
  - `skeletons.tsx`
  - `format.ts` (metric formatting: `formatUsd` from `@shared/plan-copy`, relative time, `—` for null)
- `e2e/dashboard.spec.ts`.
- One small hook into the Gabe widget (see 4.6) is the only edit outside these paths.

### 4.2 Data

- Fetch with `useQuery<DashboardPayload>({ queryKey: ["/api/dashboard"], staleTime: DASHBOARD_CLIENT_STALE_MS, refetchOnWindowFocus: true })`.
- The Refresh button fetches `/api/dashboard?fresh=1` and writes the result into the same query key.
- Drop tiles whose `flag` is off (`SHOW_GOOGLE_REVIEWS`, `SHOW_COMPETITOR_INTEL` from `@/lib/features`).
- If the whole request fails, show a single inline error card with a retry button (`button-dashboard-retry`). The sidebar still works.
- When `fixture: true`, show a small "Sample data" badge next to the greeting (`badge-dashboard-fixture`).

### 4.3 Layout (inside the existing app shell: `AppSidebar` plus the header with `SidebarTrigger`, the notification bell and the theme toggle)

> **QA round (2026-10-02) — current order:** header → **Needs you today** (`dashboardAttention()` in shared/dashboard.ts: warn/bad metrics of answering tiles, meters over their limit, unread alerts, a past-due plan; one calm line when empty) → **CRM card** (money, then follow-ups / new leads / leads without an estimate / visits from the `crmLeads` and `crmSchedule` tiles, which have no grid tile) → checklist (the first open step is "Next step", the page's only solid button) → **Plan usage** card → grid (locked tiles fold into one row per group with a single "See plans") → recent + Gabe. Tile headlines show results; quotas the usage card meters come last. The diagram below is the original plan.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Good morning, Sam                         [Growth · Active] [Refresh]        │  header
│ Here's your business today.                renews Oct 19 · resets Nov 1      │
│ ─ usage strip: Permit searches 41/5,000 ▮▯ · Grid credits 6/30 · Site Scans 2/15 · Texts 214/1,500 · Locations 2/3 … │
├──────────────────────────────────────────────────────────────────────────────┤
│ Getting started (5 of 9) ▸ checklist rows with ✓ / → links     (hidden when all done) │
├──────────────────────────────────────────────────────────────────────────────┤
│ CRM snapshot: Pipeline $184,500 · Open estimates 4 ($62,300) · Jobs won 12 · Open invoices $9,800 · Sold, not scheduled 2 · Clients 38   [Open the CRM →] │
├──────────────────────────────────────────────────────────────────────────────┤
│ GROW            (grid 1 / 2 / 3 / 4 columns at <640 / sm / lg / 2xl)          │
│ [GBP] [Reviews] [Profile Guard] [Ranking Grid] [Posts] [Social] [Site Scan] [Photos] │
│ PROTECT  [Click Guard] [IP Tracker] [VPN Shield] [Cloudflare🔒] …             │
│ WIN JOBS [Permits] [Property] [Competitors] [Ads manager🔒] [LSA Leads]       │
│ RUN THE BUSINESS [Schedule] [Leads] [Texting] [AI Call Assistant · Soon] [Agency🔒] │
│ LEARN    [Master Class] [Guides] [Reinstatement]                              │
├───────────────────────────────────────────┬──────────────────────────────────┤
│ Recent activity (≤ 12, unread dot)         │ Ask Gabe: one nudge + button      │  (stacked on mobile)
└───────────────────────────────────────────┴──────────────────────────────────┘
```

- **Header.** It greets by time of day (local clock) and `firstName`, falling back to "Welcome back". The plan chip uses `planName` and `status`:
  - Trialing: "Trial ends <relative>", linking to `/pricing`.
  - Past due: a warn badge linking to `/settings?tab=billing`.
  - No plan: "Choose a plan" → `/pricing`.

  The usage strip shows one compact meter per `account.usage` row (shadcn `Progress`). A meter turns warn at ≥ 80 % and bad at 100 %, and `-1` shows "Unlimited". Each meter links to its `href`.
- **Checklist card.** It shows "Getting started", the done count out of the total, and a `Progress`. Rows show a check or a circle, the label and description, and link to `href`. It is hidden when every item is done. It can be collapsed, and the collapsed state is per browser (`localStorage` in try/catch).
- **CRM snapshot card.** This is the `crm` tile rendered wide: up to 6 metrics in a responsive row, plus the CTA. Every portal link uses `portalUrl()`.
  - `empty`: "Your CRM is included with your plan", with "Set up the CRM" → `/crm-app`.
  - `error`: the message and "Open the CRM".
  - `locked`: the locked prompt.
- **Tile.** It is a shadcn `Card`. The header shows the sidebar's icon for the feature (reuse the sidebar icons, and export them from `app-sidebar.tsx` only if needed) and the title, with a status badge on the right:
  - `locked`: a lock badge reading "<Plan>".
  - `coming_soon`: "Coming soon".
  - `error`: a muted warning icon.

  The body depends on status:
  - `ok`: up to 3 metrics. The value is large and tabular, the label and `hint` are muted, and `limit` renders "3 of 15" with a thin bar.
  - `empty`: `description` plus the CTA button.
  - `error`: `message` plus "Open <title>".
  - `locked`: the locked prompt.
  - `coming_soon`: `message` plus "See add-ons".

  The footer has the optional `links`. The whole card is not one link: the CTA and links are real `<a>`/`<Link>` elements, which keeps keyboard and screen-reader behaviour clean.
- **Locked prompt (the standard `plan_required` pattern).** The `Lock` icon, then "Included with the **<Plan>** plan." (using `PLANS[requiredPlan].name`), then a "See plans" link to `/pricing`. Module tiles add `MODULE_NAMES[module]` as the title tooltip, the same wording the sidebar `PlanBadge` and `components/plan-required.tsx` use. Do not render the full `PlanRequired` card inside a tile, because it is page-sized.
- **Recent activity.** A list of `recent`, each item with a relative time and an unread dot, linking to its href with portal links resolved. "View all" opens the notification bell's list (`/settings?tab=notifications`). When the list is empty it says "Nothing yet. Activity from your tools shows up here."
- **Gabe nudge.** `HubMascot`, plus one sentence chosen from the first undone checklist step ("Not sure where to start? Ask Gabe how to connect Google."), plus an "Ask Gabe" button (see 4.6). When everything is done: "Ask Gabe anything about your tools."
- **Skeletons.** While loading, show the header skeleton, 1 card skeleton, and 8 tile skeletons in the grid (`Skeleton`). Never show a spinner-only page.
- **Visuals.**
  - App tokens only: `bg-card`, `text-muted-foreground`, `border`, `primary`, and the existing tone colours (green, amber, red at 600 in light and 400 in dark). `font-sans` (Inter).
  - No gradients, no particle canvas, no marketing fonts.
  - Both themes must work: check light and dark screenshots.
  - The page is max width `max-w-screen-2xl` with `px-4 sm:px-6 py-6`. Tiles use `gap-4`.
  - Group headings are `text-sm font-semibold` with the group blurb muted.
- **Accessibility.**
  - Headings go h1 (greeting) → h2 (sections and group names) → h3 (tile titles).
  - Metrics use `<dl>`.
  - Status is never shown by colour alone.
  - Focus rings are visible.
  - Tap targets are ≥ 40 px on mobile.
  - No horizontal scroll at 360 px.

### 4.4 `data-testid` map (every control and region)

| element | testid |
|---|---|
| page root | `page-dashboard` |
| greeting | `text-dashboard-greeting` |
| plan chip | `badge-dashboard-plan` |
| sample-data badge | `badge-dashboard-fixture` |
| refresh button | `button-dashboard-refresh` |
| retry (whole-page error) | `button-dashboard-retry` |
| usage meter | `usage-<key>` (link inside: `link-usage-<key>`) |
| checklist card / collapse / row link | `card-dashboard-checklist` / `button-checklist-toggle` / `link-checklist-<key>` (row: `checklist-<key>`, with `data-done="true|false"`) |
| CRM snapshot card / CTA | `card-dashboard-crm` / `link-dashboard-crm` |
| group section | `section-dashboard-<group>` |
| tile | `tile-<key>`, with `data-status="<status>"` |
| tile metric | `metric-<key>-<metricKey>` |
| tile CTA / extra link | `link-tile-<key>` / `link-tile-<key>-<n>` |
| locked prompt link | `link-tile-<key>-plans` |
| recent list / item | `list-dashboard-recent` / `recent-<id>` |
| Gabe nudge button | `button-dashboard-ask-gabe` |
| skeleton root | `skeleton-dashboard` |

### 4.5 E2E (`e2e/dashboard.spec.ts`, growth-mode server: `VITE_FORCE_PORTAL=false`, `DEV_AUTH_BYPASS_USER1=true`)

Against the skeleton (fixture):
- `/` renders `page-dashboard` and never the old marketing hero text ("Stop Guessing").
- The `full` scenario shows every group. `tile-cloudflare` has `data-status="locked"`, its plans link points to `/pricing`, `tile-callAssistant` is `coming_soon` and `tile-social` is `error`, and the other tiles still render.
- `?fixture=new` (intercept with `page.route` to add the query, or call the API directly) shows the checklist with `data-done="false"` rows.
- Portal links resolve to the portal host.
- At a 375 px viewport there is no horizontal scroll and the grid is 1 column.
- Dark mode (`ThemeProvider` class `dark`) renders without unreadable text: snapshot the screenshot to `tmp/`.

After the swap, the same spec runs against the real API, asserting statuses rather than numbers.

### 4.6 "Ask Gabe" hook

`HubWidget` (`client/src/components/hub/hub-widget.tsx`) has no API for opening it from outside. The frontend
lane may add **only** a window event listener there, about 10 lines:
`window.addEventListener("constructhub:hub-open", (e) => { setOpen(true); /* optional e.detail.question prefill */ })`,
removed on unmount. `gabe-nudge.tsx` dispatches `new CustomEvent("constructhub:hub-open", { detail: { question } })`.
Nothing else in the widget changes. The nudge must not send a message on the user's behalf: it only opens the
widget and prefills the question.

---

## 4b. Per-user controls: clearing "Needs you today" and Customize (2026-10-02)

Owner: "lets make a way to clear these tasks" and "add a settings function that lets you
add all the features and make them in your order. Have checkboxes, etc."

- **Stored server-side per user** (`server/dashboard/prefs.ts`, rules in
  `shared/dashboard-prefs.ts`): `dashboard_prefs` (one layout row; none = default) and
  `dashboard_dismissals` (item key + the value it had + optional snooze end). Idempotent DDL
  at boot and in `scripts/apply-schema-migration.ts`; mirrored in `shared/schema.ts`.
- **Clearing**: each item has Done (×) and Snooze (until tomorrow 8 am / for a week, viewer's
  clock); "Clear all"; "Show cleared (N)" lists them with Restore / Restore all, and a toast
  offers Undo. A cleared item stays hidden while its signature (value, plus limit for a meter:
  `"3"`, `"12/10"`) is unchanged and its snooze has not ended; any change brings it back and
  the stale row is deleted. The payload now carries `attention` (computed on the server) and
  `cleared`; dismissals are applied to every answer, cached or not, from a fresh read.
- **Customize** (header button → sheet): every catalogue tool with a checkbox and its place
  (drag the grip via framer-motion `Reorder`, arrow buttons, or ↑ ↓ Home End on the grip),
  "Keep groups" (groups ordered too) or one list, Select all / none, section toggles (Needs
  you today, CRM snapshot, Getting started, Plan usage, Recent activity, Ask Gabe), Reset to
  default, Save / Cancel. The CRM card's three tiles are the "CRM snapshot" section.
  Hidden tiles are **not computed** (`hiddenTiles` carries plan access only), and their alerts
  leave Needs you today; a locked tile can be shown or hidden, never unlocked. Recent
  activity / the checklist are not read when their sections (and Gabe's) are off.
- **Routes** (session, user-scoped; writes need JSON + an Origin that is one of our hosts):
  `PUT|DELETE /api/dashboard/layout`, `PUT /api/dashboard/dismissals`,
  `DELETE /api/dashboard/dismissals[/:key]`. Saving a layout forgets the user's cached answer
  (and any in-flight build). Caps: 100 keys per list, 50 items per clear, 100 cleared rows per
  user, snooze ≤ 31 days; unknown tile/section keys are ignored.

## 5. File ownership (lanes)

| lane | owns | may touch (extract-only / one-liners) |
|---|---|---|
| **spec** (this branch) | `docs/dashboard/SPEC.md`, `shared/dashboard.ts` | n/a |
| **backend** | `server/dashboard/**`, the `registerDashboardRoutes` line in `server/routes.ts` | `server/crm/stats.ts` (export `crmStatsFor`), `server/crm/follow-ups.ts` (export `crmAttentionFor`): bodies moved out of the handlers, with no behavior change |
| **frontend** | `client/src/pages/home.tsx`, `client/src/components/dashboard/**`, `e2e/dashboard.spec.ts` | `client/src/components/hub/hub-widget.tsx` (the 4.6 listener only); `client/src/components/app-sidebar.tsx` (export the existing icon components only, no behavior change) |

`shared/dashboard.ts` is shared. A lane that needs a contract change adds optional fields only, says so in its
commit message, and leaves existing field meanings alone. Neither lane touches `landing.tsx`, the public chrome,
`shared/plans.ts`, or anything in `server/voice`.

## 6. Open questions for the owner (nothing here blocks the lanes)

1. **Card order.** Should the CRM snapshot sit above the tile grid (as specced, since it holds the money numbers), or below the checklist only for accounts that use the CRM?
2. **Call Assistant tile.** Should it link to `/pricing#add-ons`, or to a waitlist, while it is "coming soon"? The price ($249 a month) is still a placeholder in the voice spec, so the tile shows no price.
3. **Platform admins.** Should they see an "Admin" group (hub stats, beta invites)? It is left out for now: the dashboard shows the admin's own account like anyone else's.
