# UI map — lane 3: Ads, security, domains, site scan, developers, agency

Audit date 2026-10-04. Lane 3 of the element-by-element audit (see `analysis/` briefs).
Worktree `/home/veto/ConstructHUB-audit3`, branch `audit/3`. Dev server `http://127.0.0.1:8303`
(dev bypass signs in as user id=1, "Veto", platform admin, company "Alpine Exteriors Test", plan Agency).
DB `constructhub_dev_a6` (shared; SELECT only). Every number below was recomputed with independent SQL
and compared to the live API for the same account unless a row says otherwise. Counts were captured live
during the audit; the dev DB is shared with other lanes, so exact row counts can drift while they work.

**Page index** (elements · OK / BUG / UNCLEAR / DEAD):

| Page | Route | Elements | OK | BUG | UNCLEAR | DEAD |
|---|---|---|---|---|---|---|
| google-ads.tsx (Click Guard) | /google-ads | ~110 | 105 | 5 rows (3 bugs) | 0 | 0 |
| google-ads-guide.tsx | /google-ads-guide | 29 | 29 | 0 | 0 | 0 |
| google-ads-guide-section.tsx | /google-ads-guide/:section | 15 | 15 | 0 | 0 | 0 |
| google-ad-fraud.tsx | /google-ad-fraud | 27 | 27 | 0 | 0 | 0 |
| ads-manager.tsx | /ads-manager | 67 | 66 | 1 | 0 | 0 |
| lsa-account-manager.tsx | /lsa-account-manager | 87 | 86 | 1 | 0 | 0 |
| lsa-leads.tsx | /lsa-leads | 53 | 52 | 1 | 0 | 0 |
| lsa-guide.tsx | /lsa-guide | 29 | 29 | 0 | 0 | 0 |
| ip-tracker.tsx | /ip-tracker | 72 | 72 | 0 | 0 | 0 |
| vpn-shield.tsx | /vpn-shield | 47 | 46 | 1 | 0 | 0 |
| domains.tsx | /domains | 62 | 58 | 2 | 2 (1 row) | 0 |
| site-scan.tsx (+ free/shared/admin exports) | /site-scan | 91 | 88 | 0 | 1 | 0 |
| site-connections.tsx | /cloudflare, /search-console | 71 | 70 | 0 | 1 | 0 |
| site-connection-guide.tsx | (Guide tab) | 6 | 6 | 0 | 0 | 0 |
| developers.tsx | /developers | ~65 | 65 | 0 | 0 | 0 |
| agency.tsx | /agency | ~52 | 51 | 1 | 0 | 0 |

Row format: `| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |`
Status: OK / BUG / UNCLEAR / DEAD. BUGS.md in the lane dir has one entry per BUG with evidence and fix.

---

Audit date 2026-10-04, worktree /home/veto/ConstructHUB-audit3 (branch audit/3), dev server http://127.0.0.1:8303 (signed in as user id=1, "Veto").

## client/src/pages/google-ads.tsx — route /google-ads

Registered in client/src/App.tsx:193 (signed-in dashboard Switch) and App.tsx:300 (signed-out PublicRouter, wrapped in the public site ribbon via `Ribboned.GoogleAdsPage`, App.tsx:276). Breadcrumb label: "Click Guard" (App.tsx:370). The page is "Click Guard", the account dashboard for click-fraud protection: a contractor adds their website domains, pastes a tracking snippet, and reviews visits, traffic sources and fraud signals; a "Google Ads script" tab hands over a script that applies the blocked-IP list as Google Ads IP exclusions. Anyone can open the URL (it renders in the public ribbon when signed out) but every data API under /api/click-guard requires a signed-in user (401 from getDevUser, server/routes.ts:160-165), and adding a domain additionally requires a plan whose `protectedSites` allowance ≠ 0 (server/routes.ts:3522; pro=1, growth=3, agency=10, starter=0, +`protected_site` addon — server/entitlements.test.ts:157-162). Agency staff are mapped to the workspace owner via res.locals.agencyOwner. Main data source: Postgres `tracked_domains` / `click_visits` / `blocked_ips` (shared/schema.ts:543-583), scoped by `tracked_domains.user_id` — user-scoped, not org-scoped. In the dev DB user 1 owns all 12 rows and they are all QA test rows (names "QA-g08…", "FIX-c07/c08…", created 2026-09-29/30), so every number on this page in dev is driven by test data; no other user has rows. Shared app primitives come from client/src/components/app-ui.tsx (AppPage :79, PageHeader :99, StatGrid :148, Stat :175, Section :197, Toolbar :238, AppTabsList :317, appTable/appTableCards style objects) and client/src/components/ui/* (Tabs, Card, Button, Badge, Input, Switch, Textarea — one row each, not mapped row by row).

Note on a silent cap that applies to every windowed number on this page: `storage.getClickVisits` (server/storage.ts:662-667) does `...orderBy(desc(visitedAt)).limit(1000)`, so all analytics/visits/traffic numbers are computed over at most the newest 1000 visits in the window.

### Page header + domain selector (always visible)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-page-title "Click fraud protection" | text | Page title. | google-ads.tsx:266 | client only | Read | OK |
| text-subtitle "Track website visits and review unusual traffic." | text | One-line description. | google-ads.tsx:267 | client only | Read | OK |
| badge-click-guard "Google Click Guard" | badge | Static product badge next to the title. | google-ads.tsx:268 | client only | Read | OK |
| button-add-domain "Add domain" | button | Opens the add-domain card. | google-ads.tsx:269 | client only (sets showAddDomain) | Read | OK |
| select-domain "Website domain" | select | Chooses which site's data every tab shows; choice is stored in the URL (?domain=id) so reloads keep it. | google-ads.tsx:270 | GET /api/click-guard/domains → routes.ts:3484 → tracked_domains WHERE user_id=1 ORDER BY created_at DESC (list of options) | SQL: SELECT id,user_id FROM tracked_domains → 12 rows, all user 1; API returned 12 | OK |
| details "How protection works" | disclosure | Expandable hint: "Signals do not prove fraud. Apply IP exclusions using the separate Google Ads script." | google-ads.tsx:271 | client only | Read | OK |

### Add-domain card (card-add-domain, shown after "Add domain")

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| input-domain (placeholder "example.com") | input | Type the website domain to track. | google-ads.tsx:276-282 | — | Read | OK |
| input-domain-name (placeholder "Display name (optional)") | input | Optional friendly name for the domain. | google-ads.tsx:283-289 | — | Read | OK |
| button-save-domain "Add" / "Adding..." | button | Saves the new domain. Disabled while empty or in flight. | google-ads.tsx:291-299 | POST /api/click-guard/domains, body {domain, name} → routes.ts:3514 → normalizeTrackedDomain (route-guards.ts:71), requirePlan protectedSites≠0 (routes.ts:3522), count tracked_domains WHERE user_id, INSERT tracked_domains (user_id, domain, trackingId=uuid, name, is_active=true); 400 on invalid domain, plan/limit 403-style sendLimitReached; on success invalidates the domains list, closes card, toasts "Domain added" | Endpoint + body match by code; not POSTed (read-only) | OK |
| button-cancel-domain "Cancel" | button | Closes the card without saving. | google-ads.tsx:300-308 | client only | Read | OK |

### Page tabs (AppTabsList; tab + domain live in the URL)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| tab-dashboard "Dashboard" | tab | Shows the visits/fraud overview for the selected domain. | google-ads.tsx:315-352 (testid at :345) | client only (?tab=dashboard is the default, tab param removed) | Read | OK |
| tab-traffic "Traffic sources" | tab | Shows the traffic-sources table. | google-ads.tsx:315-352 | client only (?tab=traffic) | Read | OK |
| tab-fraud "Traffic signals" | tab | Shows fraud signals + the clicks report. | google-ads.tsx:315-352 | client only (?tab=fraud) | Read | OK |
| tab-tools "Tools" | tab | Shows the tracking snippet. | google-ads.tsx:315-352 | client only (?tab=tools) | Read | OK |
| tab-settings "Domain settings" | tab | Shows the domain list + detection rules. | google-ads.tsx:315-352 | client only (?tab=settings) | Read | OK |
| tab-link-ads "Google Ads script" | tab | Shows the Google Ads exclusion-script walkthrough. | google-ads.tsx:315-352 | client only (?tab=link-ads) | Read | OK |

### Empty state (only when the account has no domains)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-no-domains "No domains yet" | text | Empty-state heading. | google-ads.tsx:367 | client only | Read | OK |
| button-add-first-domain "Add your first domain" | button | Opens the add-domain card. | google-ads.tsx:369-375 | client only | Read | OK |

### Dashboard tab — range toolbar

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| button-range-1d "Daily" | button | Restricts dashboard stats to the last 24 hours. | google-ads.tsx:866-877 | client only: recomputes dateStart = now − 1×24h (ISO), refetches analytics | Read | OK |
| button-range-7d "Last 7 days" | button | Restricts dashboard stats to the last 7 days (default). | google-ads.tsx:866-877 | client only: now − 7×24h | Read | OK |
| button-range-30d "Last 30 days" | button | Restricts dashboard stats to the last 30 days. | google-ads.tsx:866-877 | client only: now − 30×24h | Read | OK |

### Dashboard tab — stat tiles (windowed stats)

All four tiles read one response: GET /api/click-guard/domains/:id/analytics?start&end → routes.ts:3564 → storage.getClickVisits(domain_id, start, end) → click_visits WHERE domain_id AND visited_at BETWEEN start AND end ORDER BY visited_at DESC LIMIT 1000; unique visitors = COUNT(DISTINCT ip_address) over those rows; suspicious = rows with is_suspicious=true; avg = round(visits/unique_ips×10)/10. Window = the range buttons (client-computed ISO timestamps, server time zone = DB local). Verified: domain 33, 7d → API totalVisits=2, uniqueVisitors=1, suspicious=0, avg=2; SQL `SELECT count(*), count(DISTINCT ip_address) FROM click_visits WHERE domain_id=33 AND visited_at >= now()-interval '7 days'` → 2/1 ✓. Domain 23 → API 6 visits/1 unique/3 suspicious/avg 6; SQL 6/1/3 ✓. Domain 2 (30d) → API 33/25/8/1.3; SQL 33/25/8 ✓.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| card-stat-visits "Visits" | stat | Number of recorded page visits in the selected range. | google-ads.tsx:857,880 | GET …/analytics → click_visits count in window (see above) | SQL above: 2 = 2 ✓ | OK |
| card-stat-blocked-ips "Blocked IPs" | stat | Shows blocked IPs — but see note: this one ignores the range buttons and always counts ALL active blocks for the domain. | google-ads.tsx:858,880 | GET …/analytics → analytics.blockedIps = storage.getBlockedIps(domain.id) → blocked_ips WHERE domain_id AND is_active=true, NO date filter (routes.ts:3580, storage.ts:682-684) | API domain 24 = 1 with any range; SQL `SELECT count(*) FROM blocked_ips WHERE domain_id=24 AND is_active` → 1, all-time | BUG |
| card-stat-unique-visitors "Unique visitors" | stat | Distinct visitor IP addresses in the range (counts IPs, not people). | google-ads.tsx:859,880 | GET …/analytics → COUNT(DISTINCT ip_address) in window | SQL: 25 = 25 ✓ (domain 2) | OK |
| card-stat-avg-visits-user "Visits per visitor" | stat | Average visits per distinct IP in the range (1 decimal). | google-ads.tsx:860,880 | GET …/analytics → round(totalVisits/uniqueVisitors×10)/10 | SQL: 33/25=1.3 ✓ | OK |

### Dashboard tab — threat level, cost illustration, chart, breakdowns

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| card-threat-level "Threat level" (low/substantial/critical bars + %) | status pill | Shows how much of the range's traffic was flagged: low ≤5% suspicious, substantial 5–20%, critical >20%. | google-ads.tsx:883-909 | GET …/analytics → threatPercent = round(suspicious/total×1000)/10; threatLevel thresholds routes.ts:3656 | API domain 23 → 50% critical; SQL 3/6=50% ✓. Domain 2 → 24.2% critical; SQL ✓ | OK |
| card-savings "Cost illustration" ($ = blockedIps × 4.50) | stat | Illustrative dollar figure, clearly labelled "not measured savings… Assumes $4.50 per click; no actual ad-cost data is connected". Uses the same all-time blocked-IPs count as the tile above, so the "in this range" wording is wrong (see Suspected bugs). | google-ads.tsx:911-930 | client only (multiplies analytics.blockedIps × 4.5); analytics.blockedIps is all-time | Read; count verified via blocked_ips SQL | BUG |
| card-chart "Visit trend" (bars bar-YYYY-MM-DD) | chart | One bar per UTC day in the range; hover title "N visits on date". | google-ads.tsx:933-958 | GET …/analytics → dailyVisits bucketed by d.toISOString().slice(0,10) (UTC day) routes.ts:3607-3608 | API domain 33 → {"2026-09-30": 2}; SQL min/max visited_at confirm both visits on 09-30 UTC ✓ | OK |
| card-device-breakdown "Visits by device" | chart | Share of visits per device type (unknown when the tracker didn't report one). | google-ads.tsx:962-990 | GET …/analytics → deviceBreakdown grouped by device_type (null → "unknown"), pct = count/totalVisits | API domain 33 → {mobile: 2} = 100%; SQL `SELECT device_type,count(*) FROM click_visits WHERE domain_id=33` → 2 mobile ✓ | OK |
| card-browser-breakdown "Browser breakdown" | chart | Top 6 browsers by visits with counts and %. | google-ads.tsx:992-1018 | GET …/analytics → browserBreakdown by browser (null → "Unknown") | API domain 33 → Safari 1, Chrome 1; SQL group-by matches ✓ | OK |

### Traffic sources tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-traffic-title "Traffic sources by domain / vendor" | text | Section title. | google-ads.tsx:1037 | client only | Read | OK |
| button-traffic-range-1d/7d/30d "Daily / Last 7 days / Last 30 days" | filter | Same range switch as the dashboard (shared state; affects the stats and table below). | google-ads.tsx:1041-1052 | client only (refetches analytics with new start/end) | Read | OK |
| card-total-sources "Traffic sources" | stat | How many distinct referrer domains (plus the "NO REFERRER DATA" bucket) appear in the range. | google-ads.tsx:1057 | GET …/analytics → trafficSources length; referrer hostname with www. stripped, unparseable/missing → "NO REFERRER DATA" (routes.ts:3622-3639) | API domain 2 → 4; SQL `SELECT count(DISTINCT ...) ` on referrers: bing 21, google 10, facebook 1, null 1 → 4 ✓ | OK |
| card-total-pageloads "Page loads" | stat | Total visits in the range (each visit counts as one page load). | google-ads.tsx:1058 | GET …/analytics → Σ trafficSources.pageLoads (= totalVisits) | API domain 2 → 33; SQL count(*) = 33 ✓ | OK |
| card-total-visitors "Visitors" | stat | Sum of distinct IPs per referrer (an IP visiting from two referrers is counted twice). | google-ads.tsx:1059 | GET …/analytics → Σ per-source COUNT(DISTINCT ip_address) | API domain 2 → 21+2+1+1 = 25; SQL per-referrer distinct IPs ✓ | OK |
| card-traffic-table rows row-traffic-N | table | One row per referrer: percentage of range visits, page loads, visitors, referrer domain. "NO REFERRER DATA" rendered italic. | google-ads.tsx:1062-1107 (row testid :1076) | GET …/analytics → trafficSources sorted by pageLoads DESC; percentage = round(visits/totalVisits×10000)/100 | API domain 2: bing.com 63.64% (21), google.com 30.3% (10), NO REFERRER DATA 3.03% (1), m.facebook.com 3.03% (1) — matches SQL referrer counts (21/10/1/1) ✓ | OK |
| table footer "Results 1 to N from X log records" | text | Pagination-style footer; "X" is the total page loads in range. | google-ads.tsx:1109-1112 | client only | Read | OK |
| card-traffic-tip "Understanding traffic sources" | text | Explains referrers and the NO REFERRER DATA bucket. | google-ads.tsx:1117-1129 | client only | Read | OK |

### Traffic signals tab — sub-tabs

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-signals-title "Traffic signals" | text | Section title. | google-ads.tsx:1151 | client only | Read | OK |
| fraud-tab-blocked-ips / -countries / -multi-clicks / -devices / -browsers / -os | tab | Switches the signals panel (client state only, not in the URL). | google-ads.tsx:1154-1167 (testid :1162) | client only | Read | OK |

### Traffic signals tab — Blocked IPs panel

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| input-block-ip "Enter IP to block..." | input | Type an IP (also CIDR or 1.2.3.*) to block. | google-ads.tsx:1173-1179 | — | Read | OK |
| button-block-ip "Block" | button | Blocks the typed IP for this domain. | google-ads.tsx:1180-1188 | POST /api/click-guard/domains/:id/block, body {ipAddress, reason:"Manually blocked"} → routes.ts:3718 → owner check, normalizeBlockedIp (route-guards.ts:35), 400 invalid, 409 if already blocked, INSERT blocked_ips (domain_id, ip_address, reason, is_active=true, source='manual'); on success invalidates blocked + analytics, clears input, toasts "IP blocked" | Endpoint/method/body verified by code (not POSTed, read-only) | OK |
| table-blocked-ips rows row-blocked-{id} (IP, Reason, Source badge, Blocked at) | table | Lists this domain's active blocked IPs (newest first), with source badge auto/manual and the block date. | google-ads.tsx:1190-1228 (table :1192, row :1204) | GET /api/click-guard/domains/:id/blocked → routes.ts:3702 → blocked_ips WHERE domain_id AND is_active=true ORDER BY blocked_at DESC | API domain 24 → 1 row (198.51.100.77, manual, 2026-09-30); SQL identical ✓ | OK |
| button-unblock-{id} (X icon) | button | Removes that block row. | google-ads.tsx:1214-1222 | DELETE /api/click-guard/domains/:id/block/:blockId → routes.ts:3907 → DELETE blocked_ips WHERE id AND domain_id (scoped to owner); toast "IP unblocked" | Endpoint verified by code | OK |
| "No blocked IPs yet" empty state | empty state | Shown when the list is empty. | google-ads.tsx:1229-1234 | client only | Read | OK |

### Traffic signals tab — Countries / Multi-Clicks / Devices / Browsers / OS panels

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Countries bars | chart | Visits per country in the range; country comes from the Cloudflare header on new visits, older visits show "Unknown". | google-ads.tsx:1238-1259 | GET …/analytics → countryBreakdown grouped by click_visits.country (null → "Unknown") routes.ts:3596 | API domain 33 → {Unknown: 2}; SQL `SELECT country,count(*) FROM click_visits WHERE domain_id=33` → null/2 ✓ (all dev rows have NULL country — no CF headers locally) | OK |
| text-countries-empty | text | Empty note explaining Cloudflare country lookup. | google-ads.tsx:1255 | client only | Read | OK |
| Multi-Clicks table (Number of clicks / Users / Percentage) | table | Buckets how many IPs visited 1, 2, … 9, or 10+ times in the range. | google-ads.tsx:1261-1298 | GET …/analytics → multiClickBreakdown from per-IP visit counts routes.ts:3612-3620; % = users-in-bucket / total bucketed users | API domain 33 → {"2": 1} = one IP with 2 visits, 100%; SQL `SELECT ip_address,count(*) FROM click_visits WHERE domain_id=33 GROUP BY 1` → 1 IP × 2 ✓ | OK |
| Devices bars | chart | Visits per device type in the range (same data as the dashboard device card). | google-ads.tsx:1300-1324 | GET …/analytics → deviceBreakdown | Verified via deviceBreakdown above ✓ | OK |
| Browsers bars | chart | Visits per browser in the range. | google-ads.tsx:1326-1346 | GET …/analytics → browserBreakdown | Verified via browserBreakdown above ✓ | OK |
| OS bars | chart | Visits per operating system in the range. | google-ads.tsx:1348-1368 | GET …/analytics → osBreakdown (null → "Unknown") routes.ts:3600-3601 | API domain 33 → {iOS: 1, Android: 1}; SQL group-by os ✓ | OK |

### Traffic signals tab — Clicks report card

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "LIVE" badge | badge | Static badge on the card title. | google-ads.tsx:1377 | client only | Read | OK |
| input-search-ip "Search by IP" | input | Filters the visit rows (and the CSV) to IPs containing the typed text. | google-ads.tsx:1384-1390 | client only (client-side filter v.ipAddress.includes) | Read | OK |
| button-download-csv "Download CSV" | button | Downloads the filtered visits as clicks-report.csv (IP, Device, Browser, OS, Suspicious, Time). | google-ads.tsx:1392-1410 | client only (Blob download of already-fetched visits) | Read | OK |
| table-clicks-report rows row-visit-{id} | table | Up to 50 most recent visits in the range with device/browser/OS/page path, Flagged/Clean badge, local time, and a per-row block button. | google-ads.tsx:1413-1469 (table :1415, row :1433) | GET /api/click-guard/domains/:id/visits?start&end → routes.ts:3673 → click_visits WHERE domain_id AND visited_at BETWEEN ORDER BY visited_at DESC LIMIT 1000 | API domain 23 → 6 rows, ids 90,88,87,86,85,84 newest-first; SQL same ids/order ✓ | OK |
| Status badge "Flagged" / "Clean" | status pill | Flagged = visit had a suspicion reason (bot UA, >5 visits/hour, >15/day, fingerprint seen from another IP, missing UA). | google-ads.tsx:1439-1448 | is_suspicious flag computed at track time (routes.ts:3402-3438) | SQL: domain 23 has 3 is_suspicious rows of 6 ✓ | OK |
| button-block-visit-{id} (Ban icon, "Block this IP") | button | Blocks that visit's IP (same endpoint as the Block button). | google-ads.tsx:1452-1461 | POST /api/click-guard/domains/:id/block {ipAddress, reason:"Manually blocked"} → routes.ts:3718 | Verified by code | OK |
| "Showing first 50 of N visits" | text | Appears when more than 50 visits are in the range (N maxes at 1000). | google-ads.tsx:1468 | client only | Read | OK |
| "No visits recorded yet…" empty state | empty state | Shown when the range has no visits. | google-ads.tsx:1470-1474 | client only | Read | OK |

### Tools tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| card-tracking-script + snippet pre | text | Shows the `<script src="…/api/click-guard/script/{trackingId}">` snippet to paste into the site's head/footer. | google-ads.tsx:1488-1501 (snippet built :247-249) | The snippet's src is GET /api/click-guard/script/:trackingId → server/tracking-script.ts:6 (public, returns the tracker JS) | curl -sI equivalent: GET script URL → 200 for a real trackingId ✓ | OK |
| button-copy-main-script "Copy" | button | Copies the tracking snippet to the clipboard; toasts success or "browser blocked" guidance. | google-ads.tsx:1502-1510 | client only (clipboard) | Read | OK |
| "How it works" note | text | Explains the tracker captures fingerprint/IP/browser and that applying exclusions needs the separate Ads script. | google-ads.tsx:1512-1516 | client only | Read | OK |
| card-conversion-tracking "Not available yet" badge + text-conversion-unavailable | badge + text | Honest placeholder: Click Guard records page visits only, no conversions. | google-ads.tsx:1522-1534 | client only | Read | OK |

### Domain settings tab — header, note, domain cards

All settings writes go to PATCH /api/click-guard/domains/:id/settings, body = one key from clickGuardSettingsInput → routes.ts:3750 → zod schema (route-guards.ts:86-100, strict, per-key ranges) then tracked_domains.settings jsonb merged ({...current, ...parsed}) via storage.updateTrackedDomain (storage.ts:647). On success the client invalidates /api/click-guard/domains and toasts "Settings updated"; a 400 message is shown next to the field.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-settings-note | text | Up-front note: preferences are saved but do not change automatic detection; describes exactly how the exclusion list is built (manual excludes + Blocked IPs − whitelist, capped at the refresh rate) — matches buildExclusionList (server/click-guard-exclusions.ts:47-58). | google-ads.tsx:1605 | client only (copy matches server behavior) | Read + compared to click-guard-exclusions.ts | OK |
| button-add-domain-settings "Add domain" | button | Opens the add-domain card at the top of the page. | google-ads.tsx:1610-1617 | client only | Read | OK |
| card-domain-{id} (clickable card) | link | Selects that domain (URL ?domain=id); whole card clickable. | google-ads.tsx:1626-1740 (testid :1630) | client only | Read | OK |
| text-domain-name-{id} + ACTIVE/INACTIVE badge | text + status pill | Domain display name and whether tracking accepts new visits (is_active). | google-ads.tsx:1640-1643 | GET /api/click-guard/domains → tracked_domains.is_active | SQL: all 12 dev rows is_active=t; API shows ACTIVE ✓ | OK |
| "Selected" badge | badge | Marks the card for the currently selected domain. | google-ads.tsx:1644-1648 | client only | Read | OK |
| text-domain-url-{id} | text | The raw domain. | google-ads.tsx:1650 | GET /api/click-guard/domains → tracked_domains.domain | Read | OK |
| stat-visits-{id} / stat-unique-{id} / stat-blocked-{id} / stat-suspicious-{id} | number | All-time per-domain counters on each card (Visits, Unique, Blocked, Suspicious). | google-ads.tsx:1656-1669 | GET /api/click-guard/domains → routes.ts:3489-3505: getClickVisits(domain_id) ALL-TIME (LIMIT 1000) + getBlockedIps (active) | SQL: domain 2 → 33/25/0/8; API stats 33/25/0/8 ✓. Domain 33 → 2/1/0/0 ✓. All 12 domains cross-checked ✓ | OK |
| Mobile stat row (same 4 numbers, no testids) | number | Same four numbers repeated for small screens. | google-ads.tsx:1712-1729 | same as above | Read | OK |
| button-delete-{id} (trash icon) | button | Arms the inline confirm ("This will permanently remove … and all its tracking data, visit history, and blocked IPs."). | google-ads.tsx:1675-1686 | client only | Read | OK |
| button-confirm-delete-{id} "Delete" | button | Deletes the domain and all its data, selects the next remaining domain. | google-ads.tsx:1689-1697 | DELETE /api/click-guard/domains/:id → routes.ts:3547 → storage.deleteTrackedDomain (storage.ts:652-660): transaction deletes blocked_ips + click_visits + vpn_visits + tracked_domains WHERE domain_id; toast "Domain removed" | Endpoint verified by code; warning copy matches the cascade exactly | OK |
| button-cancel-delete-{id} "Cancel" | button | Disarms the confirm. | google-ads.tsx:1698-1706 | client only | Read | OK |
| "No domains added yet…" empty state | empty state | Shown inside the settings list when empty. | google-ads.tsx:1745-1752 | client only | Read | OK |
| "Detection rules for {domain}" heading | text | Heading for the rules below. | google-ads.tsx:1756-1759 | client only | Read | OK |

### Domain settings tab — Detection rules

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| card-click-threshold — input-click-threshold, text-threshold-error, button-update-threshold "Update threshold rules" | input + button | Saves "allow up to N ad clicks within the timeframe". Client requires a whole number 1–20 (same range the server enforces); card copy states the truth: flagging uses fixed rules (bot UAs, >5 visits/IP/hour, >15/day, fingerprint hopping), so this is a saved preference only. | google-ads.tsx:1761-1801 (input :1773-1782, error :1785, button :1787-1796) | PATCH /api/click-guard/domains/:id/settings {clickThreshold: N} → routes.ts:3750 → clickGuardSettingsInput clickThreshold int 1–20 (route-guards.ts:87) → tracked_domains.settings | Ranges match client↔server by code; fixed-rule copy matches routes.ts:3405-3436 | OK |
| details "Advanced · Detection and exclusions" | disclosure | Expands the advanced rules. | google-ads.tsx:1803 | client only | Read | OK |
| card-detect-device-id — switch-detect-device | switch | Saves a preference for device-ID detection (copy: already-on behavior, toggle changes nothing). Default on. | google-ads.tsx:1804-1822 (switch :1815-1819) | PATCH …/settings {detectDeviceId: boolean} (zod boolean) | By code | OK |
| card-block-country — countryMode radios (Allow/Block), text-country-list-unavailable, switch-block-country | switch + radios | Saves allow/block country mode + a country-blocking toggle. The radios and toggle write settings; nothing enforces country blocking (copy says so), but the "tracker does not record visitor countries yet" sentence is false — see Suspected bugs. | google-ads.tsx:1824-1859 (radios :1837,:1843, text :1847, switch :1852-1856) | PATCH …/settings {countryMode: "allow"\|"block", blockByCountry: boolean}; no enforcement code anywhere | By code; country recording verified: routes.ts:3456 stores geo.country from cf-ipcountry (route-guards.ts:24-31) | BUG |
| card-block-js-disabled — switch-block-js | switch | Saves a preference; copy states it cannot be enforced (tracker JS can't see no-JS browsers). | google-ads.tsx:1861-1879 (switch :1872-1876) | PATCH …/settings {blockJsDisabled: boolean} | By code | OK |
| card-vpn-blocking — switch-vpn | switch | Saves a preference; copy points to VPN Shield for real controls. | google-ads.tsx:1881-1900 (switch :1893-1897) | PATCH …/settings {vpnBlocking: boolean} | By code | OK |
| card-behavior-analysis — switch-behavior | switch | Saves a preference; copy is honest that signals can't reliably distinguish person from bot. | google-ads.tsx:1902-1921 (switch :1914-1918) | PATCH …/settings {behaviorAnalysis: boolean} | By code | OK |
| card-block-period — input-block-days, text-block-days-error, button-update-block-days "Update" | input + button | Saves how long blocked IPs should stay blocked (1–90 days). Copy: not applied — blocks stay until removed. | google-ads.tsx:1927-1961 (input :1938-1947, error :1935, button :1948-1957) | PATCH …/settings {blockDays: N} → zod int 1–90 (route-guards.ts:88) | Ranges match by code | OK |
| card-exclusion-rate — input-exclusion-rate, text-exclusion-rate-error, button-update-exclusion "Update" | input + button | Sets the max length of the exclusion list the Ads script downloads (50–500). Copy: manual excludes first, then newest blocks — matches buildExclusionList. | google-ads.tsx:1963-1997 (input :1974-1983, error :1971, button :1984-1993) | PATCH …/settings {exclusionListRate: N} → zod int 50–500 (route-guards.ts:89) → cap applied in exclusionListCap (click-guard-exclusions.ts:20-24) | Ranges match by code; cap behavior unit-tested (click-guard-exclusions.test.ts:44) | OK |
| card-ip-range — switch-ip-range | switch | Saves a preference for range exclusion; copy: automatic blocking lists single IPs only. | google-ads.tsx:1999-2015 (switch :2008-2012) | PATCH …/settings {ipRangeExclusion: boolean} | By code | OK |
| card-manual-exclude — textarea-manual-exclude, error-manual-exclude, button-update-exclude "Update" | textarea + button | Saves manual IPs/CIDR/wildcards that go first on the exclusion list. Every line must be valid or nothing is saved and the bad line is named next to the box. | google-ads.tsx:2017-2046 (textarea :2023-2031, error :2032-2034, button :2035-2044) | PATCH …/settings {manualExcludeIps: string} → zod max 20000; server validates each line with normalizeBlockedIp, 400 `"X" is not a valid IP address or range` (routes.ts:3761-3765) | By code; server-side validation confirmed at routes.ts:3761-3765 | OK |
| card-whitelist — textarea-whitelist, error-whitelist, button-update-whitelist "Update" | textarea + button | Saves IPs/ranges removed from the exclusion list (same all-lines-valid rule). | google-ads.tsx:2048-2077 (textarea :2054-2062, error :2063-2065, button :2066-2075) | PATCH …/settings {whitelistIps: string} → same validation; removal logic in whitelistMatcher (click-guard-exclusions.ts:26-45) | By code; whitelist semantics unit-tested (click-guard-exclusions.test.ts:35-39) | OK |
| card-aggressive — switch-aggressive | switch | Saves an "aggressive blocking" preference; copy: does not change current rules. Default off (checked = aggressiveBlocking === true). | google-ads.tsx:2079-2095 (switch :2088-2092) | PATCH …/settings {aggressiveBlocking: boolean} | By code | OK |

### Google Ads script tab (LinkGoogleAdsView)

Data: GET /api/click-guard/domains/:id/google-ads-script → routes.ts:3814 → returns {script: generated Google Ads Apps Script, exclusionUrl: baseUrl + /api/click-guard/exclusion-list/{trackingId}?format=json&key=HMAC} (key = exclusionListKey, route-guards.ts:104). GET /api/click-guard/domains/:id/blocked (active rows). The "Reachable" tile fetches the exclusionUrl itself (no-store, no credentials) and counts body.ips.length — a real probe of GET /api/click-guard/exclusion-list/:trackingId?format=json&key=… → routes.ts:3775 → buildExclusionList(active blocked IPs, settings) → {domain, count, ips, updatedAt}. Verified: URL with key returns 200 + JSON (count 0 for domain 33, 1 for domain 23); without key → 403 (matches PRIVATE_KEY_NOTE, google-ads.tsx:97).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Ads script" pill + text-link-title "Apply your IP list in Google Ads" | text | Tab heading and intro. | google-ads.tsx:517-524 | client only | Read | OK |
| details "How to apply exclusions" | disclosure | Explains the script runs inside the customer's own Google Ads account and points agencies to "Agency Ads & LSA" (/ads-manager exists, App.tsx:194/301). | google-ads.tsx:525-527 | client only | Route /ads-manager confirmed in App.tsx | OK |
| "Add a domain first" panel | empty state | Shown only when no domain exists. | google-ads.tsx:530-537 | client only | Read | OK |
| card-blocked-count "IPs ready to sync" | stat | Count of active blocked IPs for the domain. Ignores Manually Exclude IPs and the whitelist, so it can disagree with the actual list (see Suspected bugs). | google-ads.tsx:541 | client-side: blockedIps.filter(b => b.isActive).length over GET …/blocked | Domain 23: tile would show 0 while the exclusion URL serves 1 (192.0.2.55, settings.manualExcludeIps) — curl of exclusion list returned {"count":1,"ips":["192.0.2.55"]} | BUG |
| card-api-status "Exclusion list" (text-api-status Checking.../Reachable/Unreachable, hint "Serving N IPs") | status pill | Actually downloads the exclusion URL and reports whether it responds, plus how many IPs it currently serves. | google-ads.tsx:542, probe :466-476 | GET /api/click-guard/exclusion-list/:trackingId?format=json&key=… (see above) | curl 200 + JSON count; no-key → 403 ✓ | OK |
| card-google-limit "Campaign IP limit" (min(blockedOnly,500)/500) | stat | Compares the blocked-IP count to Google's 500/campaign cap. Uses the same blocked-only count as the tile above, so it can under-report what the script would actually sync (manual IPs, whitelist, and the 50–500 list-length setting are not reflected). | google-ads.tsx:543 | client only (count from GET …/blocked) | Same domain-23 evidence: would show 0/500 while the list serves 1 IP | BUG |
| card-step1-tracking — tracking snippet + button-copy-tracking "Copy Code" | button | Copies the website tracking tag (appOrigin from /api/public-config → tracking-script.ts:5; fallback window.location.origin). | google-ads.tsx:546-595 (button :560-569; snippet :478-480) | snippet src = GET /api/click-guard/script/:trackingId → server/tracking-script.ts:6 (200 verified) | curl script URL → 200 ✓ | OK |
| Step-1 "What this does" + feature ticks (IPs, fingerprinting, <3KB) | text | Marketing copy for the tracker. | google-ads.tsx:575-593 | client only | Read | OK |
| card-step2-detection — 4 feature tiles | text | Describes detection: >5 visits/IP/hour, bot UAs, fingerprint hopping, auto-block at >10 visits/hour. Matches server rules (routes.ts:3414 ≥5 prior visits in the hour, :3420 ≥15/day, :3424-3432 fingerprint, :3460 auto-block at ≥10). | google-ads.tsx:597-625 | server rules verified by code | Read vs routes.ts | OK |
| card-step3-google-ads — text-step3-subtitle, "How it works" note | text | Explains the hourly script adds exclusions and never removes them. | google-ads.tsx:627-642 | matches generated script behavior (routes.ts:3856-3899: only newIpExclusionBuilder, no removals) | Read | OK |
| button-toggle-gads-script "Google Ads IP Exclusion Script" (+ "Recommended" badge) | button | Expands the generated script panel and install steps. | google-ads.tsx:644-660 | client only | Read | OK |
| button-copy-script "Copy Script" | button | Copies the generated Google Ads Apps Script (disabled while loading). | google-ads.tsx:667-677 | client only (clipboard); script text from GET …/google-ads-script | Verified endpoint returns script (2576 chars, includes CLICK_GUARD_API URL) | OK |
| text-script-key-note (PRIVATE_KEY_NOTE) | text | Warns the exclusion URL carries a private key and old links now 403. | google-ads.tsx:683,97 | verified: request without key → 403 {"message":"…missing its key or is out of date…"} | curl ✓ | OK |
| Install steps 1–3 (Open scripts / Create / Schedule hourly) | text | Instructions; matches script header comments. | google-ads.tsx:685-707 | client only | Read | OK |
| text-exclusion-url + button-copy-url | link + button | Shows and copies the exclusion-list API URL. | google-ads.tsx:711-736 (text :718, button :722-730) | GET …/exclusion-list/:trackingId (see above) | curl ✓ | OK |
| text-exclusion-key-note (PRIVATE_KEY_NOTE) | text | Same private-key warning under the URL. | google-ads.tsx:732 | client only | Read | OK |
| "When you schedule it hourly…" note | text | Says the URL returns JSON up to the Domain-settings length (500 at most) — matches exclusionListCap 50–500. | google-ads.tsx:733-735 | click-guard-exclusions.ts:20-24 | Read | OK |
| card-manual-method — button-toggle-manual | button | Expands the manual copy-paste fallback. | google-ads.tsx:740-758 | client only | Read | OK |
| "{N} blocked IPs ready to copy" + button-copy-ips "Copy IPs" | button | Copies the active blocked IPs, one per line. Disabled at 0. (Same blocked-only count as the tiles above.) | google-ads.tsx:761-776 | client only (clipboard over GET …/blocked) | Read | OK |
| Manual steps 1–4 | text | Instructions for pasting IPs into campaign settings. | google-ads.tsx:778-795 | client only | Read | OK |
| details "More about exclusions and limits" — card-tip-budget / card-tip-auto / card-tip-fingerprint | text | Caveats about what IP exclusions can and cannot do. | google-ads.tsx:800-823 | client only | Read | OK |
| card-pro-tip "Google Ads has a 500 IP limit" | text | States the 500/campaign cap and that the script stops adding at the limit — matches the generated script's availableSlots logic (routes.ts:3869-3877). | google-ads.tsx:825-837 | generated script enforces 500-existingCount | Read vs routes.ts:3869-3877 | OK |

## Suspected bugs

1. **Dashboard "Blocked IPs" tile ignores the selected date range** — google-ads.tsx · card-stat-blocked-ips (and the same all-time count reused by card-savings "Cost illustration", whose empty copy even says "No listed IPs in this range"). Owner sees: a "Blocked IPs" number in the stat row directly under the Daily/7d/30d range buttons, which reads as range-filtered like its three neighbors (Visits, Unique visitors, Visits per visitor all recalculate per range). What is actually true: `analytics.blockedIps` comes from `storage.getBlockedIps(domain.id)` with NO date bounds (server/routes.ts:3580, storage.ts:682-684: `WHERE domain_id AND is_active=true` all-time). Evidence: API `GET /api/click-guard/domains/24/analytics?start=<7d ago>&end=now>` returns `"blockedIps": 1` where the single block row is blocked_at 2026-09-30 and SQL `SELECT count(*) FROM blocked_ips WHERE domain_id=24 AND is_active AND blocked_at >= now()-interval '7 days'` → 1 is coincidental; the code path has no `visited_at`/`blocked_at` filter at all — changing the range to Daily or 30d returns the same value (verified: same response for start=2026-10-03 and start=2026-09-04). Root cause: routes.ts:3580 `const blocked = await storage.getBlockedIps(domain.id);` has no start/end, and the tile sits in the range-controlled StatGrid (google-ads.tsx:858,880). Suggested smallest fix: either pass the range into the blocked count (add date filter to the analytics route's blocked query) and label the tile "Blocked IPs (all time)", or move the tile out of the range-filtered grid; same choice for the cost-illustration copy.

2. **"IPs ready to sync" / "Campaign IP limit" tiles disagree with the exclusion list actually served** — google-ads.tsx (Google Ads script tab) · card-blocked-count and card-google-limit. Owner sees: "IPs ready to sync = 0" and "Campaign IP limit 0/500" while the adjacent "Exclusion list" tile reports "Serving 1 IPs". What is actually true: the list at the exclusion URL is built by `buildExclusionList(active blocked IPs + settings.manualExcludeIps − whitelistIps, capped at exclusionListRate)` (server/click-guard-exclusions.ts:47-58, served at routes.ts:3790-3803). Evidence: domain 23 has 0 blocked IPs but settings.manualExcludeIps = "192.0.2.55"; `curl '…/api/click-guard/exclusion-list/8ad08bce-…?format=json&key=…'` → `{"count":1,"ips":["192.0.2.55"]}`, while the tiles compute `blockedIps.filter(b => b.isActive).length` = 0 (google-ads.tsx:462,541,543). The Google Ads script would sync that 1 IP, so "ready to sync" and the limit numerator are wrong whenever manual excludes or the whitelist exist (and the /500 denominator ignores a configured 50–500 list length). Root cause: google-ads.tsx:462 (`activeBlockedCount` counts blocked rows only), used at :541 and :543. Suggested smallest fix: derive the tiles from the same probe the "Exclusion list" tile already fetches (`exclusionCheck.count`) or replicate buildExclusionList client-side from settings + blocked rows.

3. **"Block IPs by country" claims the tracker does not record countries — it does** — google-ads.tsx · text-country-list-unavailable in card-block-country. Owner sees: "No country list: the tracker does not record visitor countries yet, so there is nothing to allow or block." What is actually true: every tracked visit stores `country` (and `city`) from the Cloudflare `cf-ipcountry` header — routes.ts:3441-3458 (`country: geo.country`), edgeGeo at route-guards.ts:24-31 — and the Countries tab on the same page displays that data ("Country comes from Cloudflare on new visits; earlier visits show as Unknown.", google-ads.tsx:1255). Evidence: all 55 click_visits rows in dev have country NULL only because local requests carry no Cloudflare headers (`SELECT country,count(*) FROM click_visits` → 1 row, null); the Countries tab's own breakdown key "Unknown" is produced from the same stored column (routes.ts:3596). The "enforcement is not implemented" part of the copy is true; the "does not record" sentence is false. Root cause: stale copy at google-ads.tsx:1847-1849. Suggested smallest fix: reword to "country-based blocking is not implemented — the tracker records countries but does not allow/block by them yet."

Notes (not user-facing bugs): `googleAdsLogo` (google-ads.tsx:24) and `Notice` (:2) are imported but never rendered; every windowed number silently caps at the newest 1000 visits per domain (storage.ts:666) — fine at current volumes, worth knowing for a busy site. No DEAD interactive elements found: all buttons map to existing endpoints with matching method/body, all tabs are client-side and wired, and there are no outbound links to check (ads.google.com appears only in instruction text).


Verification environment notes:
- Dev DB `constructhub_dev_a6`, user 1. SQL: `ads_grants/ads_accounts/ads_jobs/ads_plans/ads_invitations/ads_findings` = **0 rows for user 1** (also 0 accounts for any user). `tracked_domains` = 12 rows for user 1 (incl. 2 junk test rows id 3 `not a domain!! <b>x</b>` and id 15 `not a domain!! <b>v</b>`, all owned by user_id=1 — they are this account's own QA rows in the shared dev DB, not a leak). `course_purchases` = 0 rows total.
- All list APIs were curl'd live and match SQL counts (see "Verified how" per row).
- Route reachability: all four routes exist in both `PublicRouter` (signed-out, client/src/App.tsx:285-320) and `DashboardRouter` (signed-in, App.tsx:162-249); no client route guard. Signed-out visitors get `PublicPageHeader` chrome via `withRibbon`; the header renders nothing when signed in (client/src/components/public-page-chrome.tsx:36-45).

## google-ads-guide.tsx — route /google-ads-guide (App.tsx:198 public / :303 dashboard)

Public marketing index for the 12-part paid "Google Ads Master Class" playbook. Who sees what: anyone can open the route; the full index is client-gated (`isDev || purchases.length > 0`, google-ads-guide.tsx:153-154) and each section's text is server-gated (403 unless any `course_purchases` row or `DEV_AUTH_BYPASS`, server/routes.ts:3236-3245). On this dev server the bypass unlocks it (verified: `/api/course-purchases` → `[]`, matching `SELECT count(*) FROM course_purchases WHERE user_id=1` → 0, yet `/api/google-ads-guide/campaign-setup` → 200). Main data sources: `GET /api/auth/me`, `GET /api/course-purchases` (server/routes.ts:3226-3232), plus static arrays.

### PublicPageHeader (site chrome)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| header-public-page (SiteNavBar ribbon: Features ▾, Done-For-You ▾, Plans, Results, Coverage, Sign in) | link set | Signed-out visitors get the marketing nav ribbon on top of the page; hidden once signed in. | client/src/components/public-page-chrome.tsx:36-45 (next="/google-ads-guide") | client only: renders when `/api/auth/me` returns null | Code; `useSignedOut` at public-page-chrome.tsx:19-22 | OK |

### Locked view (view-google-ads-locked) — shown signed-out/non-purchaser in prod; not reachable in dev
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Master Class Students Only" pill (Lock icon) | badge | Says the playbook is for paying Master Class students. | google-ads-guide.tsx:163-166 | client only | Code | OK |
| text-locked-title "Google Ads for Contractors: The Complete Campaign Setup Playbook" | text | Page headline. | google-ads-guide.tsx:167-173 | client only | Code | OK |
| card-upgrade-prompt (GraduationCap icon, "Unlock the Full Playbook") | card | Upsell card for the locked state. | google-ads-guide.tsx:179-198 | client only | Code | OK |
| "Go to Master Class" (link-master-class) | button/link | Goes to the Master Class sales page. | google-ads-guide.tsx:188-193 | GET /master-class → client/src/pages/master-class.tsx (route App.tsx:190/297) | curl http://127.0.0.1:8303/master-class → 200 | OK |
| "Any Master Class purchase unlocks the Google Ads content" | text | Explains the unlock rule (any course_purchases row). | google-ads-guide.tsx:194-196 | server rule: routes.ts:3242-3245 (any row in course_purchases for user) | Code + SQL `\d course_purchases` | OK |
| section-locked-outline heading + intro ("What the 12 Sections Cover") | text | Public outline of the paid sections. | google-ads-guide.tsx:201-205 | client only | Code | OK |
| locked-outline-campaign-setup … locked-outline-mistakes (12 rows, numbered 01-12 with icon, title, summary) | text rows | The 12 section titles/summaries are public even when locked. | google-ads-guide.tsx:206-219 (data: GUIDE_SECTIONS :18-141) | client only | Counted 12 rows = 12 server sections (GOOGLE_ADS_GUIDE_ORDER, google-ads-guide-content.ts:568-572) | OK |

### Unlocked view (view-ads-masterclass)
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Google Ads logo img + "Google Ads Master Class" pill | badge | Page branding. | google-ads-guide.tsx:234-238 | client only (asset attached_assets/google-ads-logo.png exists) | ls attached_assets | OK |
| text-masterclass-title + intro paragraph | text | Headline and pitch for the 12 walkthroughs. | google-ads-guide.tsx:239-248 | client only | Code | OK |
| card-critical-warning ("Critical Warning: Google's Default Settings Are Designed to Drain Your Budget") | card/banner | Static warning pointing people to Section 1. | google-ads-guide.tsx:251-263 | client only | Code | OK |
| card-stat-guide-pages — "12 / Guide Pages / step-by-step walkthroughs" | number/stat | Static count of guide sections. | google-ads-guide.tsx:267 (card :272) | client only; cross-check: server has exactly 12 sections | API: fetched all 12 slugs, each 200, sectionNumber 1..12 of totalSections 12 | OK |
| card-stat-screenshots — "11+ / Screenshots / real Google Ads settings" | number/stat | Static count of screenshots in the guide. | google-ads-guide.tsx:268 | client only | API: counted `image` blocks across all 12 sections = 12 total (campaign-setup 3, features-to-avoid 4, assets 1, location 1, bidding 1, ip-exclusions 1, mistakes 1) → "11+" is a true under-claim | OK |
| card-stat-contractor-cpc — "$30-50 / Contractor CPC / avg cost per click" | number/stat | Static market claim. | google-ads-guide.tsx:269 | client only | n/a (marketing figure; not DB-derived) | OK |
| card-stat-ip-exclusions — "500 / IP Exclusions / max per Google Ads campaign" | number/stat | Static claim of Google's IP-block limit; matches the ads-manager IP protection cap (`slice(0,500)`, server/ads/protections.ts:86). | google-ads-guide.tsx:270 | client only | Code cross-ref protections.ts:86 | OK |
| card-section-campaign-setup → card-section-mistakes (12 cards: number, icon, title, summary, screenshot-count badge, chevron) | link (clickable card) | Each card opens that section's walkthrough page. | google-ads-guide.tsx:282-320 (data :18-141) | Route /google-ads-guide/:section → google-ads-guide-section.tsx; content GET /api/google-ads-guide/:slug → routes.ts:3236 | API: all 12 slugs 200; per-card screenshot badges match API image counts exactly (3/4/1/0/1/1/0/0/1/0/0/1); CRITICAL badges on features-to-avoid & click-fraud match `critical:true` flags :38/:129 | OK |
| card-bottom-cta ("Ready to Protect Your Ad Budget?") | card | Bottom call-to-action block. | google-ads-guide.tsx:322-342 | client only | Code | OK |
| "Start the Guide" (button-start-guide) | button | Jumps to the first section (Campaign Setup). | google-ads-guide.tsx:330-334 | Route /google-ads-guide/campaign-setup (App.tsx:199/304) | curl /api/google-ads-guide/campaign-setup → 200 | OK |
| "Set Up Click Guard" (button-click-guard) | button | Goes to the Click Guard tool page. | google-ads-guide.tsx:335-339 | Route /google-ads (App.tsx:193/300) → client/src/pages/google-ads.tsx | curl http://127.0.0.1:8303/google-ads → 200 | OK |

## google-ads-guide-section.tsx — route /google-ads-guide/:section (App.tsx:199 public / :304 dashboard)

Renders one paid playbook section (text, warnings, tips, screenshots). Same entitlement as the index but enforced server-side: `GET /api/google-ads-guide/:slug` returns 403 `{title}` without a purchase (404 for unknown slug — verified `bogus` → 404 `{"message":"Guide section not found"}`), 200 with content when entitled/dev. Main data source: that one API; screenshots are bundled assets mapped by file name (IMAGES map :29-43 — all 13 referenced PNGs exist in attached_assets, @assets alias vite.config.ts:28).

### Loading / error / locked / not-found states
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| view-guide-section-checking (spinner) | status | Shown while the section loads. | google-ads-guide-section.tsx:107-113 | client only | Code | OK |
| view-guide-section-error — "Couldn't load this section" | empty state | Shown on non-401/403/4xx network/server error. | google-ads-guide-section.tsx:115-134 | client only | Code | OK |
| "Try again" (button-retry-section) | button | Re-runs the section fetch. | google-ads-guide-section.tsx:122-124 | GET /api/google-ads-guide/:slug (same call) | Code | OK |
| "Back to Google Ads Guide" (button-back-to-guide, error + locked + not-found views) | button | Returns to the guide index. | google-ads-guide-section.tsx:126-128, 141-143, 180-182 | Route /google-ads-guide (App.tsx:198/303) | Code | OK |
| view-guide-section-locked — "Master Class Students Only" + section title | empty state | Shown on 401/403; shows the public section title the server sent. | google-ads-guide-section.tsx:136-172 | Server 403 body `{message, title}` → routes.ts:3245 | Code (server sends 403+title; client reads `body.title` :77-80) | OK |
| "Go to Master Class" (link-master-class, locked view) | button/link | Goes to the Master Class page. | google-ads-guide-section.tsx:157-161 | GET /master-class | curl → 200 | OK |
| "Sign in" (link-sign-in, locked view, only when signed out) | link | Goes to the auth page. | google-ads-guide-section.tsx:162-166 | GET /auth (App.tsx:237/289) | Code | OK |

### Section view
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Section N of 12" badge | badge | Position of this section in the playbook. | google-ads-guide-section.tsx:207-211 | From API fields sectionNumber/totalSections → routes.ts:3250-3251 (index in GOOGLE_ADS_GUIDE_ORDER + 1 / length) | API: verified 1..12 / 12 across all slugs | OK |
| text-section-title / text-section-subtitle | text | Section heading and intro from the server. | google-ads-guide-section.tsx:213-218 | GET /api/google-ads-guide/:slug → title/subtitle | API JSON matches server/google-ads-guide-content.ts | OK |
| heading-N / text-N / warning-N / tip-N / list-N / divider blocks | text blocks | The walkthrough body, rendered by block type. | google-ads-guide-section.tsx:221-294 | Served from server/google-ads-guide-content.ts (not shipped in the public bundle) | Code + API spot-checks | OK |
| image-N (+ caption) | image | Real Google Ads screenshots; `image` file names mapped to bundled URLs, unknown names skipped. | google-ads-guide-section.tsx:258-277, map :29-43 | client only | All 13 referenced PNGs exist in attached_assets | OK |
| "Back to Google Ads Guide" (button-back-to-guide, section view) | button | Returns to the guide index. | google-ads-guide-section.tsx:201-205 | Route /google-ads-guide | Code | OK |
| button-prev-section ("← <prev title>") | button | Opens the previous section (omitted on section 1). | google-ads-guide-section.tsx:298-304 | Route /google-ads-guide/:prevSlug; prev/next come from the API | API: prevSection/nextSection chain verified across all 12 sections (campaign-setup has no prev; mistakes has no next) | OK |
| button-next-section ("<next title> →") | button | Opens the next section. | google-ads-guide-section.tsx:306-312 | Route /google-ads-guide/:nextSlug | API chain verified | OK |
| button-go-click-guard ("Set Up Click Guard", last section only) | button | From the final section, jumps to the Click Guard tool. | google-ads-guide-section.tsx:313-317 | Route /google-ads | curl → 200 | OK |

## google-ad-fraud.tsx — route /google-ad-fraud (App.tsx:200 public / :305 dashboard)

Fully public, 100% static opinion/investigation page (no fetches at all — no useQuery in the file). It makes quantified claims (~80% bot-like sessions, 33-50% click gap, 10-25% real customers, $172B ad fraud by 2028) that are presented as ConstructHUB's own observations plus cited industry research, with an explicit disclaimer card and a sources line; none of the numbers come from the database, so there is nothing to recompute in SQL. All links are internal wouter links to existing routes.

### Header + stat row
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| header-public-page (PublicPageHeader, signed-out only) | link set | Marketing nav ribbon. | google-ad-fraud.tsx:305; public-page-chrome.tsx:36-45 (next="/google-ad-fraud") | client only | Code | OK |
| "Industry Investigation" pill + text-fraud-title + intro | text | Page branding and a disclaimer-led intro. | google-ad-fraud.tsx:309-325 | client only | Code | OK |
| card-stat-bot-traffic "~80% / Bot Traffic / of sessions we reviewed looked automated" | number/stat | Static observation claim (qualified in the sub-label and disclaimer). | google-ad-fraud.tsx:329 | client only | Copy consistent with disclaimer (text-fraud-basis :350-352) | OK |
| card-stat-click-gap "33-50% / Click Gap / more clicks than visits we recorded" | number/stat | Static observation claim. | google-ad-fraud.tsx:330 | client only | Same qualifier | OK |
| card-stat-real-customers "10-25% / Real Customers / of clicks became leads in our accounts" | number/stat | Static observation claim. | google-ad-fraud.tsx:331 | client only | Same qualifier | OK |
| card-stat-global-ad-fraud "$172B / Global Ad Fraud / projected losses by 2028" | number/stat | Juniper Research projection, attributed in the sources line (:562-564). | google-ad-fraud.tsx:332 | client only | Copy cites Juniper Research | OK |
| card-disclaimer / text-fraud-basis ("What This Page Is Based On") | card/banner | States the figures are own-tracking observations + published research, "not an independent audit". | google-ad-fraud.tsx:344-356 | client only | Code | OK |

### Investigation accordion (10 expandable cards)
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| button-toggle-the-big-lie ("The Big Lie: 'We Block Invalid Clicks'") | button | Expands/collapses section 1 (4 static sub-sections: competitor clicks, click inflation, removed IP tracking, revenue-from-fraud argument). | google-ad-fraud.tsx:24-49, 359-399 | client only | Code | OK |
| button-toggle-bot-farms ("Bot Farms & Fake Traffic…") | button | Section 2 (80% automated-claim detail, bot behavior list, "does Google run bot farms" — framed as unproven opinion). | google-ad-fraud.tsx:50-76 | client only | Code | OK |
| button-toggle-vpn-tracking ("VPN & Proxy Detection…") | button | Section 3 (VPN detection capability, fingerprint evidence, proxy problem, "presence or interest" targeting critique). | google-ad-fraud.tsx:77-103 | client only | Code | OK |
| button-toggle-500-ip-limit ("The 500 IP Limit: An Artificial Stranglehold") | button | Section 4 (why 500 fills in weeks, PMax has zero IP exclusions, revenue-protection argument). | google-ad-fraud.tsx:104-130 | client only | Code; 500-IP limit consistent with protections.ts:86 | OK |
| button-toggle-analytics-fraud ("Analytics Manipulation: The Click Count Scam") | button | Section 5 (click inflation, "ad extension ghost clicks", no way to verify, GA mismatch). | google-ad-fraud.tsx:131-157 | client only | Code | OK |
| button-toggle-dispute-impossible ("Disputing Clicks: A Rigged System") | button | Section 6 (investigation black hole, evidence control, 1-3% refunds claim, litigation barriers). | google-ad-fraud.tsx:158-184 | client only | Code | OK |
| button-toggle-who-clicks ("Who's Actually Clicking Your Ads?") | button | Section 7 (~1/3 telemarketers, ~1/3 competitors, 10-25% real customers, budget Catch-22). | google-ad-fraud.tsx:185-211 | client only | Code | OK |
| button-toggle-google-report ("Google's Own Report: A Masterclass in Deflection") | button | Section 8 (cookie-consent excuse, page-load blame, extension ghost clicks, SIVT admission, $172B projection). | google-ad-fraud.tsx:212-242 | client only | Code | OK |
| button-toggle-call-only-death ("Killing Call-Only Ads…") | button | Section 9 (Call-Only Ads phased out Jan/Feb 2026, RSA+call-asset critique, transition advice). | google-ad-fraud.tsx:243-273 | client only | Code | OK |
| button-toggle-monopoly ("The Monopoly Problem…") | button | Section 10 (judge/jury argument, 90%+ market share claim, opinion disclaimer sub-section). | google-ad-fraud.tsx:274-300 | client only | Code | OK |
| content-<section>-<idx> rows inside each open card (numbered heading + paragraph) | text rows | Static exposition; every card opens fine because data is a local array (no query that could be empty). | google-ad-fraud.tsx:381-397 | client only | Code | OK |

### Excuses table + actions + bottom line
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| card-google-excuses — "Google's Excuses vs. Reality" (excuse-0 … excuse-6) | table/list (7 rows) | Static claim-vs-reality pairs. | google-ad-fraud.tsx:402-459 | client only | Code | OK |
| action-0 "Use Click Guard" → /google-ads | link | Goes to the Click Guard tool (dashboard tab). | google-ad-fraud.tsx:476-483, 524-535 | Route /google-ads (App.tsx:193/300) | curl → 200 | OK |
| action-1 "Apply Your List in Google Ads" → /google-ads?tab=link-ads | link | Goes to Click Guard's "Google Ads Script" tab. | google-ad-fraud.tsx:484-491 | /google-ads reads ?tab= (google-ads.tsx:101,126-127); `link-ads` is a valid PAGE_TAB | curl "…/google-ads?tab=link-ads" → 200; tab id in PAGE_TABS | OK |
| action-2 "Track Device Fingerprints" → /google-ads?tab=tools | link | Goes to Click Guard's Tools tab. | google-ad-fraud.tsx:492-499 | `tools` valid tab | Code + curl → 200 | OK |
| action-3 "Monitor Your Data" → /google-ads?tab=fraud | link | Goes to Click Guard's Traffic signals tab. | google-ad-fraud.tsx:500-507 | `fraud` valid tab | Code + curl → 200 | OK |
| action-4 "Export Evidence" → /google-ads?tab=fraud | link | Same Traffic signals tab (CSV export lives there). | google-ad-fraud.tsx:508-515 | `fraud` valid tab | Code | OK |
| action-5 "Learn Google Ads Strategy" → /google-ads-guide | link | Goes to the guide index. | google-ad-fraud.tsx:516-523 | Route /google-ads-guide | curl → 200 | OK |
| card-bottom-line-fraud — "The Bottom Line" + 3 summary badges (~80% / 33-50% / 500 IP limit) | card + badges | Static closing argument; badges repeat the page's three headline figures. | google-ad-fraud.tsx:540-559 | client only | Code | OK |
| Sources line (Juniper Research, Lunio, ClickPatrol, Fraud Blocker, SEJ, Google docs) | text | Attribution footer. | google-ad-fraud.tsx:561-565 | client only | Code | OK |

## ads-manager.tsx — route /ads-manager (App.tsx:194 public-with-ribbon / :301 dashboard)

Agency "Ads & LSA manager": connect a Google Ads MCC, discover client accounts, request access, queue health audits, preview/confirm Google Ads protections, manage Click Guard domain mappings. Who can see it: the route is public, but every `/api/ads/*` endpoint except `GET /saved-connection` and `POST /disconnect` passes `requireModule('adsManager')` (server/ads/routes.ts:28-29 → server/entitlements.ts:611), which answers 402 `plan_required` without the module; platform admins get all modules (entitlements.ts:283-284 — dev user is admin, so APIs respond 200 here; non-admin would see the `PlanRequired` card, ads-manager.tsx:57-59). Main data sources: `GET /api/ads/status` (poll 10 s), `GET /api/ads/<tab>` (poll 5 s), plus dialogs' detail queries. On this dev account every ads table is empty (SQL-verified 0 rows), so all tabs render the "No records" state; counts below were verified against SQL where rows exist (domains = 12).

### Page header actions (ads-manager.tsx:58)
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Discover clients" (shown when connected) | button | Queues a `discover` job that pulls client accounts from the MCC into `ads_accounts`. | ads-manager.tsx:58 (run :41, action :40) | POST /api/ads/sync {kind:'discover'} → server/ads/routes.ts:92-95 → enqueue() store.ts:18 → INSERT ads_jobs(kind='discover'); requires verified grant (store.ts:13-16) + queue budget takeBudget 5000/h (growth-limits.ts:14) | Code (GET-only audit; no write test). Dev: not reachable — not connected | OK |
| "Connect MCC with Google" (shown when not connected) | button | Starts Google OAuth for the MCC; disabled until server Ads setup is configured. On success the browser is sent to Google's consent screen, callback stores encrypted tokens and queues verification+discovery. | ads-manager.tsx:58, 69 | POST /api/ads/connect {managerId} → routes.ts:44-51 → returns {url: accounts.google.com/o/oauth2/v2/auth?...}; GET /api/ads/callback → routes.ts:52-75 → upsert ads_grants (encrypted tokens), wipes + re-enqueues ads_jobs/plans/accounts/findings/invitations, notifies | Code; live /api/ads/status → configured:false so button correctly disabled; button disabled logic matches `configured()` (client.ts) | OK |

### Status message strips (:62-64)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| role="status" message strip | status | Shows the result text of the last queued action (from the mutation response). | ads-manager.tsx:40 (onSuccess/onError), 62 | See per-button rows | Code | OK (see BUG-1 for the domain-mappings case) |
| role="alert" error strip | status | Shows API errors (e.g. plan_required text). | ads-manager.tsx:63 | — | Code | OK |
| "Google connection failed…" alert (?connect=failed) | status | Shown when the OAuth callback redirects back with failure. | ads-manager.tsx:64 | Set by routes.ts:55,74 redirect `/ads-manager?connect=failed` | Code | OK |

### Agency connection card (:65-72)
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Ads setup is not configured. Ask the owner to enable the connection." | text | Shown when server env for Google Ads is missing. | ads-manager.tsx:66 | `configured()` in status → routes.ts:37 (env GOOGLE_ADS_CLIENT_ID etc., server/ads/client.ts) | Live: status.configured=false and the message shows — consistent | OK |
| "MCC <manager_id> · Verified|Verification queued · Reconnect required" / "No connected MCC" | status | Connection state line. | ads-manager.tsx:67 | GET /api/ads/status → routes.ts:36 SELECT manager_id,verified,reconnect_required FROM ads_grants WHERE user_id=$1 | Live: status.grant=null + SQL `SELECT count(*) FROM ads_grants WHERE user_id=1` → 0 → "No connected MCC" correct | OK |
| Notice "The Ads worker is off; jobs will stay queued." | status pill | Warns that queued jobs won't run. | ads-manager.tsx:68 | status.workerEnabled = process.env.GOOGLE_ADS_WORKER_ENABLED==='true' → routes.ts:37 | Live: workerEnabled=false → Notice correctly shows | OK |
| "Manager customer ID" input | input | Lets you type a different MCC customer ID before connecting. | ads-manager.tsx:69 | sent as managerId in POST /api/ads/connect | Code | OK |
| "Poll invitations" | button | Queues a `poll` job that refreshes pending Google invitations. Disabled unless connected+verified. | ads-manager.tsx:70 | POST /api/ads/sync {kind:'poll'} → routes.ts:92-95 → INSERT ads_jobs(kind='poll') | Code; disabled state matches server grant requirement | OK |
| "Disconnect MCC" | button | After a confirm dialog, deletes the saved MCC and all local ads data, cancels queued work. | ads-manager.tsx:70 | POST /api/ads/disconnect {confirm:true} → routes.ts:76-91 → DELETE ads_grants; ads_jobs→cancelled; ads_plans→expired; DELETE ads_accounts/ads_findings/ads_invitations/ads_ip_age; activity log + notification | Code; schema `{confirm: literal true}` matches client body | OK |

### Tabs (:73) — client only (URL ?tab=, default accounts)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| tab "Client accounts" (accounts) | tab | Lists discovered client accounts. | ads-manager.tsx:15,73 | GET /api/ads/accounts | Code | OK |
| tab "Access invitations" (invitations) | tab | Lists manager-access invitations. | ads-manager.tsx:15,73 | GET /api/ads/invitations | Code | OK |
| tab "Protection previews" (plans) | tab | Lists previewed protection batches. | ads-manager.tsx:15,73 | GET /api/ads/plans | Code | OK |
| tab "Queue" (jobs) | tab | Lists background jobs. | ads-manager.tsx:15,73 | GET /api/ads/jobs | Code | OK |
| tab "Health audit" (findings) | tab | Lists audit findings. | ads-manager.tsx:15,73 | GET /api/ads/findings | Code | OK |

### Search + filters (:74-77)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search accounts or records" input | input | Filters the current tab (name/customer_id for accounts; title for findings; customer_id/kind for jobs; customer_id for plans/invitations). | ads-manager.tsx:74 | Passed as `q` to GET /api/ads/<tab> → e.g. accounts routes.ts:98 `name ILIKE '%'||q||'%' OR customer_id ILIKE …`; findings routes.ts:199 `title ILIKE` | Code; placeholder matches behavior per tab | OK |
| "Filters" details → Status select | filter/select | Exact-match status filter; options per tab: accounts ENABLED/SUSPENDED/CANCELED/UNLINKED; findings warning/unknown/info; invitations queued/pending/accepted/rejected/cancelled/unknown/failed; plans preview/queued/applied/reversed/failed/unknown/expired/no_change; jobs queued/running/done/failed/unknown/cancelled. | ads-manager.tsx:75 | `status=$3` exact match on each table | Vocabulary cross-checked vs worker writes (worker.ts:56,78,127,129,133-134,148-151,160,169): jobs/plans/invitations/findings values all exist server-side. Plans list omits worker status `applying` (worker.ts:129) — filterable only via "All" | OK (minor gap, see bugs) |
| "LSA" select (accounts tab only: All / LSA identified / No LSA campaigns found / Not checked) | filter/select | Filters accounts by the LSA-detection flag. | ads-manager.tsx:76 | routes.ts:98 `lsa=true/false/IS NULL` on ads_accounts.lsa | Code; SQL column verified via `\d ads_accounts` | OK |

### Selection bar (:78-81)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Select this page" | button | Checks every eligible row (accounts: non-manager ENABLED only — matches server rule routes.ts:18). | ads-manager.tsx:79 | client only | Code | OK |
| "Clear selection" | button | Unchecks all. | ads-manager.tsx:79 | client only | Code | OK |
| "N selected" | count | Shows how many rows are checked. | ads-manager.tsx:79 | client only | Code | OK |
| "All active clients matching search / LSA filter (max 1,000)" checkbox | input | Sends the filter instead of IDs so a full list can be queued server-side. | ads-manager.tsx:80 | Server `targets()` routes.ts:17-24: SELECT customer_id FROM ads_accounts WHERE user_id AND NOT manager AND status='ENABLED' (+q, +lsa) LIMIT 1001; 422 if >1000 | "max 1,000" matches LIMIT 1001/422 exactly | OK |
| "Queue health audit" | button | Queues an `audit` job per selected/filtered client; the worker snapshots the account and rewrites its `ads_findings`. Disabled until connected+verified and something is selected. | ads-manager.tsx:80 | POST /api/ads/bulk {selection, kind:'audit', requestId:uuid} → routes.ts:128-135 → targets() + enqueue per customer (worker audit → DELETE+INSERT ads_findings, worker.ts:93-100) | Code; body shape matches zod schema routes.ts:129 | OK |

### Records table (:82-83)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Row checkbox "Select <id>" (accounts/plans/invitations; disabled for manager or non-ENABLED accounts) | input | Selects a row for bulk actions. | ads-manager.tsx:82 | client only (selection sent in POST bodies) | Code | OK |
| Account cell: customer_id / "Agency", name (or "Name unavailable") | text | Identifies the row. | ads-manager.tsx:82 | GET /api/ads/accounts columns customer_id,name → routes.ts:101 | Live: items=[] total=0 = SQL `SELECT count(*) FROM ads_accounts WHERE user_id=1` → 0 | OK |
| Details (accounts): "Manager" / "LSA account" / "No LSA campaigns found" / "LSA not checked"; currency · timezone; "Click Guard domain ID: N|Not mapped"; "Checked <date>|Never audited" | text | Per-account detail line; "Checked …" is `synced_at` rendered in the browser's locale. | ads-manager.tsx:82 | columns manager,lsa,currency,timezone,domain_id,synced_at | Code; columns verified in `\d ads_accounts` | OK |
| Details (findings): title + detail | text | The audit finding. | ads-manager.tsx:82 | GET /api/ads/findings `SELECT *` → routes.ts:197-202 | Live: 0 = SQL count | OK |
| Details (invitations/jobs/plans): kind or email (+ email_status) + id | text | Row identifier; email status for invitations. | ads-manager.tsx:82 | routes.ts:160-168 column lists include email_status, kind, batch_id, attempts, created_at (returned; attempts/batch/created_at not rendered) | Code | OK |
| Status Badge (`r.status || r.severity`) | status pill | Row status/severity. | ads-manager.tsx:82 | status column per table / severity for findings | Code | OK |
| "Review preview" (plans rows) | button | Opens the preview dialog for that plan. | ads-manager.tsx:82 | GET /api/ads/plans/:id → routes.ts:170-177 (reads ads_plans.document, filters/paginates operations) | Code | OK |
| "Campaigns" (accounts rows, non-manager) | button | Opens the campaigns dialog for that customer. | ads-manager.tsx:82 | GET /api/ads/accounts/:cid/campaigns → routes.ts:121-127 (jsonb snapshot->'campaign', own account enforced via `account()` store.ts:22-25) | Live: unknown cid → 404 "Active client account not found" — matches store.ts:24 | OK |
| Findings fix: external link (e.g. "Review Local Services settings" → https://ads.google.com/localservices/) or fix button (e.g. "Edit negative keyword preview") | link / button | External link opens Google (new tab); fix button jumps to the accounts tab with that customer pre-selected and the matching protection kind chosen. | ads-manager.tsx:82 | fix.url/fix.action stored in ads_findings.fix (worker audit writes them, audit.ts) | External URL curl -sI → 302 (resolves); internal /lsa-leads curl → 200 (App.tsx:202/306) | OK |
| "Loading…" / "No records. Connect and discover clients, or adjust the filter." | empty state | Loading and empty states. | ads-manager.tsx:83 | — | Live: empty state shows for all 5 tabs with 0 rows | OK |
| Pager: "Previous" / "Page X · N results" / "Next" | button + count | Pages the current list, 25 per page. | ads-manager.tsx:17,83 | page/limit on GET /api/ads/<tab>; client hardcodes 25 = server default limit (routes.ts:15) | Code; both sides 25 | OK |

### Advanced — Bulk protections + domain mapping (accounts tab, :84-97)
| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Advanced · Bulk protections and domain mapping" details | container | Collapses the bulk tooling. | ads-manager.tsx:85 | client only | Code | OK |
| "Protection" select (presence / ip / negative / placement / schedule) | select | Chooses which Google Ads protection to preview. | ads-manager.tsx:87 | kind enum in POST /api/ads/bulk action → zod discriminated union protections.ts:16-22 | Code | OK |
| "Campaign IDs" input (all but placement) | input | Optional comma-separated campaign IDs (max 100/client); blank = all supported campaigns. | ads-manager.tsx:88 | common.campaignIds regex `\d+`, min1 max100 → protections.ts:15; buildPlan throws if a listed campaign is missing (protections.ts:68-69) | Code; "max 100/client" matches | OK |
| Negative: "Negative list name" input + "Negative keywords" textarea + "Replace the existing list contents" checkbox | input/textarea/checkbox | Builds a shared negative-keyword list preview; starter defaults are the 8 words jobs/careers/salary/training/DIY/tutorial/free/cheap = server's STARTER_NEGATIVES (protections.ts:23). | ads-manager.tsx:89 | zod: name 1-100 chars, keywords 1-500 × ≤80 chars, mode add|replace → protections.ts:20 | Client defaults byte-identical to server STARTER_NEGATIVES and to status.starterNegatives (live /api/ads/status) | OK |
| Placement: "Excluded placements" textarea | textarea | One domain/path per line, account-wide. | ads-manager.tsx:90 | urls 1-500 × regex domain/path → protections.ts:21 | Code | OK |
| Schedule: "Ad schedule" textarea + format hint | textarea | DAY,HH:MM,HH:MM lines; client validates 15-minute boundaries before sending. | ads-manager.tsx:91 | slots: max 42 total, ≤6/day, non-overlapping, enum minutes → protections.ts:5-13; hint "max six intervals per day"/"15-minute boundaries" matches | Code | OK |
| IP hint ("Uses the newest 500 flagged IPs … Rotates the oldest observed exclusions … 500/campaign limit") | text | Explains the IP-rotation protection. | ads-manager.tsx:92 | worker.ts:107 selects newest 500 active blocked_ips of the mapped domain (ORDER BY blocked_at DESC LIMIT 500); protections.ts:91-95 rotates oldest observed to stay ≤500 | Code cross-check | OK |
| "Queue protection previews" | button | Queues a `preview` job per selected client; the worker builds a reversible change document into `ads_plans`. | ads-manager.tsx:93 | POST /api/ads/bulk {selection, kind:'preview', action, requestId} → routes.ts:128-135 → worker.ts:102-112 (INSERT ads_plans with document, requires mapped domain for kind='ip') | Code | OK |
| "Alpine playbook: awaiting owner-approved steps…" note | text | Disclaimer that only generic opt-in protections are offered. | ads-manager.tsx:94 | matches playbook.ts (single generic `presence` step) | Code | OK |
| "Search Click Guard domains" input + domain list ("id: domain" pairs) + pager | input + list | Searches the account's Click Guard domains to find a domain ID for mapping. | ads-manager.tsx:96 | GET /api/ads/domains?q=&page= → routes.ts:104-109: SELECT id,domain FROM tracked_domains WHERE user_id=$1 AND domain ILIKE … LIMIT/OFFSET | Live: API total=12 = SQL `SELECT count(*) FROM tracked_domains WHERE user_id=1` → 12; items match ids/domains. Note: list includes 2 junk QA rows owned by user 1 ("not a domain!! <b>x</b>", id 3/15) — dev-DB test data, rendered as escaped text | OK |
| "Client domain mappings" textarea + "Save domain mappings" | textarea + button | One `customerId,domainId` per line; blank domainId unmaps. Writes ads_accounts.domain_id (FK-checked against own tracked_domains). | ads-manager.tsx:96 | POST /api/ads/domain-mappings {mappings:[{customerId,domainId|null}]} → routes.ts:110-120 → UPDATE ads_accounts SET domain_id; 404 if domain not yours | Endpoint/method/body verified by code (zod at routes.ts:111 matches client parse); success text is misleading — see BUG-1 | BUG (message only) |

### Invitations tab (:98-101)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "One customer ID,email pair per line, up to 1,000 clients…" + textarea | textarea | Bulk invitation list; the preview explains the email clients get. | ads-manager.tsx:98 | clients array min1 max1000 → routes.ts:137; "up to 1,000" matches | Code | OK |
| "Preview invitations" | button | Client-side: opens the review section with the parsed line count. | ads-manager.tsx:99 | client only | Code | OK |
| Invitation preview section ("Review N invitation(s) from MCC …") | status | Quotes the instruction email text; confirms emails don't grant access themselves. | ads-manager.tsx:99 | text matches worker's invitationMail (worker.ts:86-88 sends it) | Code | OK |
| "Confirm invitations and emails" | button | Creates an ads_invitations row per client and queues invite + invitation-email jobs (Google invitation + ConstructHUB email). | ads-manager.tsx:99 | POST /api/ads/invitations {confirm:true, requestId:uuid, clients:[{customerId,email}]} → routes.ts:136-149 → INSERT ads_invitations ON CONFLICT DO NOTHING; rejects manager's own ID and duplicates | Code; body matches zod | OK |
| "Cancel selected pending invitations" | button | After confirm dialog, queues cancel-invite jobs for the selected pending invitations. | ads-manager.tsx:100 | POST /api/ads/invitations/cancel {ids, confirm:true} → routes.ts:150-158 → requires status='pending' per id, enqueue cancel-invite | Code | OK |

### Plans tab (:102)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Review each selected preview…" intro + "I reviewed the selected previews and authorize these Google Ads changes." checkbox | checkbox | Gate that enables the confirm button (owner-approved workflow). | ads-manager.tsx:102 | client only | Code | OK |
| "Confirm selected previews" | button | Marks previews queued (only status='preview' and unexpired) and queues an apply job per plan; the worker re-checks account state before writing to Google. | ads-manager.tsx:102 | POST /api/ads/plans/confirm {ids, confirm:true} → routes.ts:178-186 → UPDATE ads_plans SET status='queued' … status='preview' AND expires_at>now(); worker.ts:121-136 applies via Google API | Code; 409 path verified in ads.test.ts:192 | OK |
| "Preview reversal of selected applied changes" | button | For applied plans without an existing undo, queues an undo-preview job producing a reversal plan. | ads-manager.tsx:102 | POST /api/ads/plans/undo-preview {ids} → routes.ts:187-196 → requires status='applied' AND undo_of IS NULL; worker.ts:114-119 builds 'undo' plan with fingerprint check | Code; body `{ids}` matches zod (no confirm field) | OK |
| "Unknown outcome: reconcile in Google Ads…" note | text | Warns about the `unknown` status. | ads-manager.tsx:102 | worker sets unknown on interruption (worker.ts:148-150) | Code | OK |

### Preview dialog (:103)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Protection change preview" dialog (customer_id · kind · status, summary lines, warnings, "N operations · expires <date>", operations JSON) | dialog | Read-only view of exactly what would change in Google Ads, with expiry. | ads-manager.tsx:103 | GET /api/ads/plans/:id?page=&limit=25&q= → routes.ts:170-177 (document.summary/warnings/operations, filters operations by q) | Code | OK |
| "Search preview operations" input | input | Text-filters the operation list. | ads-manager.tsx:103 | routes.ts:175 JSON.stringify(operation).toLowerCase().includes(q) | Code | OK |
| Dialog pager (Previous / page / Next) | button + count | Pages operations, 25 at a time. | ads-manager.tsx:103 | page/limit → routes.ts:176 slice | Code | OK |
| "Select this preview for bulk confirmation" | button | Adds this plan to the selection and closes, so it can be confirmed with the plans-tab button. | ads-manager.tsx:103 | client only | Code | OK |

### Campaigns dialog (:104)
| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Campaigns · <customer>" dialog + search | dialog + input | Lists the client's campaigns (from the last audit snapshot) so you can copy IDs into the protection form. | ads-manager.tsx:104 | GET /api/ads/accounts/:cid/campaigns?q=&page= → routes.ts:121-127 (jsonb_array_elements(snapshot->'campaign'), own ENABLED account required) | Live 404 for unknown cid matches store.ts:24; query shape verified | OK |
| "Use these IDs in the protection form… Queue a health audit to refresh campaigns." | text | Explains data freshness (snapshot-based). | ads-manager.tsx:104 | snapshot written by audit/discover (worker.ts:92 saveSnapshot) | Code | OK |

## Suspected bugs

- **BUG-1 · ads-manager.tsx · "Save domain mappings" success message.** Owner sees "Queued 1. Review progress in Queue." (or a wrong queue framing) after saving client→domain mappings, no matter how many were saved. What is true: the server answers `POST /api/ads/domain-mappings` with `{mapped: N}` and no `message`/`queued` fields (server/ads/routes.ts:119), and the client's generic mutation success handler falls back to `` `Queued ${r.queued ?? 1}. Review progress in Queue.` `` (ads-manager.tsx:40) — so a 3-client mapping shows "Queued 1." Root cause: ads-manager.tsx:40 (generic onSuccess) vs routes.ts:119 (response shape). Smallest fix: have the server include a `message` (e.g. `res.json({mapped: n, message: \`Saved ${n} domain mapping(s).\`})`), or special-case `r.mapped` in the client handler.

- **Minor gap (not a functional bug) · ads-manager.tsx:75 · Plans status filter omits `applying`.** The worker sets `ads_plans.status='applying'` while writing to Google (server/ads/worker.ts:129), but the filter dropdown offers preview/queued/applied/reversed/failed/unknown/expired/no_change only — a plan mid-apply is visible only under "All". Smallest fix: add an `applying` option to the plans branch of the select (server already accepts any exact status string).

- **Data note (not a page bug) · dev DB · tracked_domains for user 1 contains 2 junk QA rows** (`id 3 'not a domain!! <b>x</b>'`, `id 15 'not a domain!! <b>v</b>'`). They are owned by user_id=1 (shared dev DB, likely from another lane's e2e run), so the ads-manager domain list legitimately shows them; rendered as escaped text, no XSS. No action on these pages.

## Could not verify

- All POST effects (sync/connect/disconnect/bulk/invitations/plan confirm/undo) were verified by code match only — the audit rules forbid writes, and the dev account has no MCC connection (`ads_grants` empty, `configured:false`), so the buttons are disabled or would fail server-side anyway.
- Worker-side outcomes (discover/audit/preview/apply) have no rows to inspect in this DB; status-vocabulary checks were done against server/worker code and server/ads/ads.test.ts instead.
- The fraud page's and guide index's static figures ($30-50 CPC, ~80%, 33-50%, 10-25%, $172B, 500-IP limit) are marketing/research claims with on-page disclaimers; they are not DB-derived, so there is no SQL to recompute — checked only for internal consistency with the codebase (500-IP cap ↔ protections.ts:86; disclaimer ↔ text-fraud-basis).

---


Audit date 2026-10-04. Dev server http://127.0.0.1:8303 (dev bypass = user id=1, dev@constructhub.local, isPlatformAdmin=true, company "Alpine Exteriors Test"). DB constructhub_dev_a6 (read-only). All numbers below are **all-time counts** — no page in this lane shows a "this month" window.

Data model (two disjoint LSA subsystems):
- **Manager / admin console** (lsa-account-manager page): global tables `lsa_manager_connection`, `lsa_manager_accounts`, `lsa_manager_leads`, `lsa_manager_invitations`, `admin_audit_log` — not scoped by org/user; every route uses `adminGuard` (server/routes.ts:6046) = `isAdmin` (server/admin.ts:26, email allowlist + dev bypass) + `platformGatePassed` (server/crm/admin.ts:138 — no-op unless the admin passphrase is configured; in dev it is not).
- **User self-serve** (lsa-leads page): per-user tables `lsa_connections`, `lsa_accounts`, `lsa_leads`; every route scopes by `req.user.id` (server/lsa/routes.ts:1-5).

Dev DB state: `lsa_manager_connection` 1 row (status=disconnected, manager_id=1234567890), `lsa_manager_accounts` 1 row (id=1 "KIMI-QA Account", customer 9876543210, linkType self, lead_count 0), `lsa_manager_leads` 0, `lsa_manager_invitations` 0, `admin_audit_log` 8 rows, `lsa_connections`/`lsa_accounts`/`lsa_leads` 0 rows **for all users** (no other tenant has LSA data in this DB).

---

## client/src/pages/lsa-account-manager.tsx — route /lsa-account-manager

This is the platform-admin console for ConstructHUB's central Google Ads manager (MCC) connection: connect/disconnect the manager, sync child accounts into a registry, send manager-link invitations, view an account's campaigns/leads, and audit every admin write. Route is in `SIGNED_IN_ONLY` (client/src/App.tsx:338); the client additionally requires `isPlatformAdmin` from /api/auth/me and (when configured) the admin passphrase gate (client lines 117-163); every /api/admin/lsa/* endpoint re-enforces `adminGuard` server-side. Main data source: the global `lsa_manager_*` tables plus live Google Ads API calls for campaigns/leads.

### Page header
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "LSA account manager" title (text-page-title) | status pill | Page title. | lsa-account-manager.tsx:178 | client only | code read | OK |
| "Admin only" badge (badge-admin-only) | badge | Marks that this page is restricted to platform admins. | lsa-account-manager.tsx:178 | client only (server enforcement is adminGuard) | code read | OK |
| "Refresh audit" button | button | Refetches the audit log (only shown on the Audit log tab). | lsa-account-manager.tsx:178 | client only: invalidates queryKey /api/admin/lsa/audit-log | code read | OK |

### Tab bar
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Manager connection" tab (tab-manager) | tab | Shows the manager-connection panel. | lsa-account-manager.tsx:179-193 | client only: writes ?tab= to URL via useUrlParam | code read | OK |
| "Accounts" tab (tab-accounts) | tab | Shows the child-accounts table. | lsa-account-manager.tsx:179-193 | client only: URL param | code read | OK |
| "Invitations" tab (tab-invitations) | tab | Shows manager-link invitations. | lsa-account-manager.tsx:179-193 | client only: URL param | code read | OK |
| "Audit log" tab (tab-audit) | tab | Shows the admin audit log. | lsa-account-manager.tsx:179-193 | client only: URL param | code read | OK |

### Access-check / access-denied states (conditional)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Spinner (view-lsa-access-checking) | status pill | Shown while /api/auth/me and /api/admin/gate load. | lsa-account-manager.tsx:129 | GET /api/auth/me; GET /api/admin/gate → server/crm/admin.ts:162 (reads session only) | curl both endpoints | OK |
| "Couldn't check access" (text-access-check-failed) | status pill | Shown if the gate status request failed. | lsa-account-manager.tsx:143 | GET /api/admin/gate | code read | OK |
| "Access denied" (text-access-denied) | status pill | Shown to non-platform-admins. | lsa-account-manager.tsx:157 | client-side isPlatformAdmin check; server 403s all /api/admin/lsa/* | curl /api/auth/me shows isPlatformAdmin=true for dev user | OK |

### Admin gate card (card-admin-gate) — only when the admin passphrase is configured and not yet entered
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Username input (input-admin-gate-user) | input | Admin-console username for the second-factor wall. | lsa-account-manager.tsx:239 | — | code read | OK |
| Password input (input-admin-gate-pass) | input | Admin-console passphrase. | lsa-account-manager.tsx:244 | — | code read | OK |
| "Sign in" button (button-admin-gate-login) | button | Submits the passphrase; on success re-checks the gate and reloads the manager status. | lsa-account-manager.tsx:247 | POST /api/admin/gate {username,password} → server/crm/admin.ts:169 → sets req.session.platformAdminGate | code read (endpoint verified in server/crm/admin.ts) | OK |

### Manager connection card (card-manager-status)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Not connected" notice (text-manager-not-connected) | status pill | Shown when there is no active manager connection. | lsa-account-manager.tsx:357 | GET /api/admin/lsa/manager → server/routes.ts:6068 → storage.getLsaManagerConnection (server/storage.ts:878) → lsa_manager_connection latest row; connected = status=='active'. In dev: SQL `SELECT status FROM lsa_manager_connection` = 'disconnected' → API {"connected":false,...} matches | SQL + curl | OK |
| "Connect manager" button (button-connect-manager) | button | Opens the connect dialog. | lsa-account-manager.tsx:358 | client only | code read | OK |
| "Connected" state (text-manager-connected) | status pill | Shown when the manager row status is 'active'. | lsa-account-manager.tsx:325 | same GET /api/admin/lsa/manager | code read | OK |
| Manager ID text (text-manager-id) | number/stat/count | The 10-digit Google Ads MCC customer ID. | lsa-account-manager.tsx:326 | GET /api/admin/lsa/manager → lsa_manager_connection.manager_id | code read | OK |
| "API access" / "API access needed" badge | badge | Whether a Google Ads API developer token is stored on the connection. | lsa-account-manager.tsx:328-330 | GET /api/admin/lsa/manager → hasDeveloperToken = !!lsa_manager_connection.developer_token. Dev: NULL → API hasDeveloperToken=false matches | SQL + curl | OK |
| "Connected at" date (text-connected-at) | number/stat/count | Date the connection row was created/connected (browser-local date). | lsa-account-manager.tsx:335 | GET /api/admin/lsa/manager → lsa_manager_connection.connected_at | code read | OK |
| "Last refreshed" date | number/stat/count | Last time the access token was refreshed (browser-local date; "Never" if none). | lsa-account-manager.tsx:339 | GET /api/admin/lsa/manager → lsa_manager_connection.last_refreshed_at | code read | OK |
| "Sync accounts" button (button-sync-accounts) | button | Pulls the MCC's child-account list from Google and upserts each into the accounts table as centrally linked. | lsa-account-manager.tsx:343 | POST /api/admin/lsa/manager/sync-accounts → server/routes.ts:6131 → lsa-manager.ts:listChildAccounts (Google customerClient query, levels 1-10, LIMIT 500) + detectLsaEnrollment per child → storage.upsertLsaAccount (server/storage.ts:952) writes lsa_manager_accounts (linkType 'central', linkStatus 'active') + admin_audit_log row | code read (endpoint + body verified); hidden in dev (not connected) | OK |
| "Reconfigure" button (button-reconfigure) | button | Opens the same connect dialog to overwrite credentials. | lsa-account-manager.tsx:347 | (dialog's POST below) | code read | OK |
| "Disconnect" button (button-disconnect) | button | Marks the manager connection disconnected (keeps the row). | lsa-account-manager.tsx:350 | POST /api/admin/lsa/manager/disconnect → server/routes.ts:6121 → storage.disconnectLsaManagerConnection (server/storage.ts:893) UPDATE lsa_manager_connection SET status='disconnected' (all rows) | code read | OK |

### "Advanced · Setup requirements" disclosure
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Requirements list (5 static items) | status pill | Static checklist text (MCC account, developer token, OAuth consent screen, offline access, client accepts invite). No data, no links. | lsa-account-manager.tsx:366-387 | client only | code read | OK |

### Connect manager dialog (dialog-connect-manager)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Manager customer ID input (input-manager-id) | input | The MCC customer ID, digits only. | lsa-account-manager.tsx:401 | — | code read | OK |
| Refresh token input (input-refresh-token) | input | OAuth2 refresh token for the manager. | lsa-account-manager.tsx:413 | — | code read | OK |
| Developer token input (input-developer-token) | input | Optional developer token; falls back to env GOOGLE_ADS_DEVELOPER_TOKEN. | lsa-account-manager.tsx:425 | — | code read | OK |
| Error text (error-connect-manager) | status pill | Shows why Google rejected the token. | lsa-account-manager.tsx:430 | — | code read | OK |
| Cancel button | button | Closes the dialog. | lsa-account-manager.tsx:434 | client only | code read | OK |
| "Connect" button (button-save-connect) | button | Verifies the refresh token with Google's token endpoint; only on success upserts the connection row. | lsa-account-manager.tsx:439 | POST /api/admin/lsa/manager/connect {managerId,refreshToken,developerToken} → server/routes.ts:6086 → verifyManagerRefreshToken (server/lsa-manager.ts:79, POST oauth2.googleapis.com/token) → storage.upsertLsaManagerConnection (server/storage.ts:883, writes lsa_manager_connection incl. developer_token, status 'active', access token) + admin_audit_log | code read; audit trail of past connects visible in admin_audit_log (8 rows) | OK |

### Accounts tab toolbar
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Search input (input-search-accounts) | filter | Filters the accounts table by customer ID or name — **but only within the 50-row page already loaded** (see Suspected bugs). | lsa-account-manager.tsx:496-502 | client only: filters `accounts` from the current GET page (line 487-489); no server query param exists for /api/admin/lsa/accounts | code read | BUG |
| "Add account" button (button-add-account) | button | Opens the manual add-account card. | lsa-account-manager.tsx:504 | client only | code read | OK |

### Add-account card (card-add-account)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Customer ID input (input-new-customer-id) | input | Google Ads customer ID to add. | lsa-account-manager.tsx:515 | — | code read | OK |
| Account name input (input-new-account-name) | input | Optional display name. | lsa-account-manager.tsx:519 | — | code read | OK |
| "Add account" submit (button-save-account) | button | Inserts (or merges into) the account registry as a self-linked account. | lsa-account-manager.tsx:523 | POST /api/admin/lsa/accounts {customerId, accountName, linkType:'self'} → server/routes.ts:6167 → storage.upsertLsaAccount (server/storage.ts:952) writes lsa_manager_accounts (linkStatus 'active', is_lsa_enrolled false; reconciles linkType to 'both' if already present with the other type) | code read (method/body match server) | OK |
| Cancel button | button | Hides the card. | lsa-account-manager.tsx:526 | client only | code read | OK |

### Accounts table (table-accounts) — one row in dev: "KIMI-QA Account" (row-account-1)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Account name cell | link (clickable row) | Display name or "—". | lsa-account-manager.tsx:565 | GET /api/admin/lsa/accounts → server/routes.ts:6154 → storage.getLsaAccountsWithMetrics (server/storage.ts:906): SELECT * FROM lsa_manager_accounts ORDER BY created_at DESC LIMIT 50 OFFSET page*50 | SQL: `SELECT customer_id, account_name FROM lsa_manager_accounts` → 1 row "KIMI-QA Account" = API row | OK |
| Customer ID cell (text-customer-id-1) | number/stat/count | The 10-digit customer ID. | lsa-account-manager.tsx:566 | same endpoint → lsa_manager_accounts.customer_id. API returned "9876543210" = SQL | SQL + curl | OK |
| Owner cell (text-owner-1) | status pill | Email of the ConstructHUB user who self-connected this account (— if none). | lsa-account-manager.tsx:567-570 | same endpoint → lsa_manager_accounts.user_id JOIN users.email. Dev row user_id NULL → "—" matches | SQL + curl | OK |
| Link type badge (self/central/both) | badge | How the account is linked: self = owner's own OAuth, central = under our MCC, both = either path works. | lsa-account-manager.tsx:573-580 | same endpoint → lsa_manager_accounts.link_type. API "self" = SQL | SQL + curl | OK |
| Status badge (active/inactive colors) | badge | lsa_manager_accounts.link_status ('active' green, anything else amber). | lsa-account-manager.tsx:582-584 | same endpoint → link_status. API "active" = SQL | SQL + curl | OK |
| Leads count (text-lead-count-1) | number/stat/count | All-time leads stored for this account (denormalized counter refreshed by lead sync). | lsa-account-manager.tsx:586 | same endpoint → lsa_manager_accounts.lead_count. Dev: 0; cross-check SQL `SELECT count(*) FROM lsa_manager_leads WHERE account_id=1` = 0 — consistent | SQL + curl | OK |
| Charged count (text-charged-leads-1) | number/stat/count | All-time leads flagged charged=true in lsa_manager_leads (live GROUP BY, not the denormalized counter). | lsa-account-manager.tsx:587-590 | same endpoint → count(lsa_manager_leads) WHERE account_id=1 AND charged=true (server/storage.ts:913-916). Dev: 0 = SQL | SQL + curl | OK |
| Disputed count (text-disputed-leads-1) | number/stat/count | All-time leads flagged disputed=true in lsa_manager_leads. | lsa-account-manager.tsx:592-595 | same endpoint → count WHERE account_id=1 AND disputed=true (server/storage.ts:917-920). Dev: 0 = SQL | SQL + curl | OK |
| Spend cell (text-total-spend-1) | number/stat/count | lsa_manager_accounts.total_spend (text; null shows "—"). Dev: null → "—" | lsa-account-manager.tsx:597-598 | same endpoint → total_spend. API null = SQL NULL | SQL + curl | OK |
| LSA badge (LSA ✓ / —) | badge | is_lsa_enrolled=true shows "LSA ✓". | lsa-account-manager.tsx:601-605 | same endpoint → is_lsa_enrolled. API false → "—" matches | SQL + curl | OK |
| "View" button (button-view-account-1) | button | Opens the account-detail view for this row. | lsa-account-manager.tsx:608 | client only (sets selectedAccountId) | code read | OK |
| "No accounts yet" empty state (text-no-accounts) | status pill | Shown when the registry is empty. | lsa-account-manager.tsx:540 | same endpoint, total=0 | code read | OK |

### Accounts pagination
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Showing X–Y of N accounts" (text-accounts-pagination) | number/stat/count | Page position; N is the API's total (all rows in lsa_manager_accounts). | lsa-account-manager.tsx:621-623 | GET /api/admin/lsa/accounts → total = `SELECT count(*) FROM lsa_manager_accounts` (storage.countLsaAccounts, server/storage.ts:901). Dev: 1 = API total=1 | SQL + curl | OK |
| Previous (button-accounts-prev) | button | Goes to the previous page (disabled on page 0). Hidden when 1 page. | lsa-account-manager.tsx:625 | client only (offset math) | code read | OK |
| Next (button-accounts-next) | button | Goes to the next page (disabled on last). | lsa-account-manager.tsx:628 | client only | code read | OK |

### Invitations tab toolbar
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "New invitation" button (button-new-invitation) | button | Opens the invitation form. | lsa-account-manager.tsx:695 | client only | code read | OK |

### Invitation form card (card-invitation-form)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Warning notice | status pill | Static reminder that the client must accept the invite in their own Google Ads account. | lsa-account-manager.tsx:706-709 | client only | code read | OK |
| Client customer ID input (input-target-customer-id) | input | The client's 10-digit Google Ads customer ID. | lsa-account-manager.tsx:713 | — | code read | OK |
| Client name input (input-invitation-account-name) | input | Optional display name. | lsa-account-manager.tsx:717 | — | code read | OK |
| Notes input (input-invitation-notes) | input | Optional internal note. | lsa-account-manager.tsx:721 | — | code read | OK |
| "Send invitation" (button-send-invitation) | button | Creates a PENDING customerClientLink at Google, then saves the invitation row; the toast distinguishes Google-accepted vs locally-recorded. | lsa-account-manager.tsx:725-728 | POST /api/admin/lsa/invitations {targetCustomerId,accountName,notes} → server/routes.ts:6358 → createManagerLinkInvitation (server/lsa-manager.ts:396, POST googleads.googleapis.com customers/{mgr}/customerClientLinks:mutate status PENDING) → storage.createLsaManagerInvitation (server/storage.ts:993, INSERT lsa_manager_invitations status 'pending') + admin_audit_log | code read (endpoint + body match) | OK |
| Cancel button | button | Hides the form. | lsa-account-manager.tsx:729 | client only | code read | OK |

### Invitation cards (card-invitation-{id}) — none in dev (SQL count 0, API [])
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "No invitations yet" empty state (text-no-invitations) | status pill | Shown when there are no rows. | lsa-account-manager.tsx:743 | GET /api/admin/lsa/invitations → server/routes.ts:6348 → storage.getLsaManagerInvitations (server/storage.ts:984, SELECT * FROM lsa_manager_invitations ORDER BY invited_at DESC). Dev: [] = SQL count 0 | SQL + curl | OK |
| Name / status badge / customer ID / notes / invited date (text-inv-name-*, badge-inv-status-*, text-inv-customer-id-*) | status pill | Card header fields of one invitation. | lsa-account-manager.tsx:754-763 | same endpoint → lsa_manager_invitations.account_name, status, target_customer_id, notes, invited_at | code read (no rows in dev to compare) | OK |
| "Mark accepted" (button-accept-invitation-{id}) | button | Marks a pending invitation accepted **and upserts the account into the registry as central**. | lsa-account-manager.tsx:767-775 | PATCH /api/admin/lsa/invitations/{id} {status:'accepted'} → server/routes.ts:6397 → storage.updateLsaManagerInvitation (server/storage.ts:998, sets status + resolved_at) + if accepted storage.upsertLsaAccount (central/active) | code read (schema accepts exactly these statuses; body matches) | OK |
| "Cancel" (button-cancel-invitation-{id}) | button | Marks a pending invitation cancelled. | lsa-account-manager.tsx:776-785 | PATCH /api/admin/lsa/invitations/{id} {status:'cancelled'} → same handler | code read | OK |

### Account detail — header (shown after clicking View)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Back" button (button-back) | button | Returns to the accounts table. | lsa-account-manager.tsx:906 | client only | code read | OK |
| "Refresh account" button | button | Re-runs the detail query. | lsa-account-manager.tsx:166 | client only: invalidates /api/admin/lsa/accounts/{id} | code read | OK |
| Account name (text-account-name) | status pill | The account's display name. | lsa-account-manager.tsx:911 | GET /api/admin/lsa/accounts/1 → server/routes.ts:6187 → storage.getLsaAccountById → lsa_manager_accounts. API "KIMI-QA Account" = SQL | SQL + curl | OK |
| linkType badge + customer ID mono | badge | Link type and customer ID of this account. | lsa-account-manager.tsx:912-915 | same endpoint → link_type, customer_id. API "self"/"9876543210" = SQL | SQL + curl | OK |
| Campaigns / Leads sub-tabs (tab-campaigns / tab-leads) | tab | Switches between the campaigns list (live Google API) and the stored leads table. | lsa-account-manager.tsx:921-926 | client only | code read | OK |

### Account detail — Campaigns tab
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Error state (text-campaigns-error) | status pill | Shown when the campaigns query fails. In dev it always fails (no valid Google token). | lsa-account-manager.tsx:939-940 | GET /api/admin/lsa/accounts/1/campaigns → server/routes.ts:6219 → fetchCampaigns (server/lsa-manager.ts:158, Google Ads searchStream: campaigns WHERE status != 'REMOVED' ORDER BY name LIMIT 50, credentials from manager conn or the account owner's own OAuth token when linkType 'self'). Dev curl: 502 {"message":"Failed to fetch campaigns: Failed to get valid access token"} — matches code path (lsa-manager.ts:260-264) | curl + code read | OK |
| Empty state (text-no-campaigns) | status pill | Shown when Google returns zero campaigns. | lsa-account-manager.tsx:947 | same endpoint | code read | OK |
| Campaign card (card-campaign-*) | status pill | One card per campaign returned by Google. | lsa-account-manager.tsx:953 | same endpoint → Google campaign fields (name, status, budget micros, channel type, isLsa = channelType=='LOCAL_SERVICES') | code read (no campaigns in dev) | OK |
| Campaign status badge (badge-campaign-status-*) | badge | ENABLED (green) / anything else (amber). | lsa-account-manager.tsx:960 | same endpoint → campaign.status | code read | OK |
| Daily budget text (text-campaign-budget-*) | number/stat/count | "…/day" formatted from amount micros. | lsa-account-manager.tsx:965 | same endpoint → campaign_budget.amount_micros / 1e6, 2dp (lsa-manager.ts:201) | code read | OK |
| "Rename" button (button-rename-campaign-*) | button | Opens the rename dialog. | lsa-account-manager.tsx:970-978 | (dialog PATCH below) | code read | OK |
| "Budget" button (button-edit-budget-*) | button | Opens the budget dialog prefilled with the current budget. | lsa-account-manager.tsx:979-987 | (dialog PATCH below) | code read | OK |
| "Pause" / "Enable" buttons (button-pause-campaign-* / button-enable-campaign-*) | button | Pauses or enables the campaign at Google after a confirm dialog. | lsa-account-manager.tsx:988-1016 | PATCH /api/admin/lsa/accounts/{id}/campaigns/{cid}/status {newStatus,campaignResourceName} → server/routes.ts:6304 → mutateCampaignStatus (server/lsa-manager.ts:318, Google campaigns:mutate updateMask status) + admin_audit_log (campaign_pause/campaign_enable) + email alert on pause | code read (endpoint + zod schema {newStatus: ENABLED\|PAUSED, campaignResourceName} matches client body) | OK |

### Account detail — Leads tab
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Leads sync automatically every few minutes" hint | status pill | Static description of the background sync (server/lsa-manager.ts:672, every 5 min for active LSA-enrolled accounts). | lsa-account-manager.tsx:1030 | — | code read | OK |
| "Sync Leads" button (button-sync-leads) | button | Pulls the latest 200 LSA leads from Google for this account into lsa_manager_leads. | lsa-account-manager.tsx:1031-1034 | POST /api/admin/lsa/accounts/{id}/sync-leads → server/routes.ts:6199 → fetchAndStoreLeads (server/lsa-manager.ts:540: Google local_services_lead query ORDER BY creation_date_time DESC LIMIT 200; INSERT ... ON CONFLICT (google_lead_id) UPDATE google-authoritative fields only; refresh lsa_manager_accounts.lead_count; email alert per newly-charged lead) + admin_audit_log (sync_leads). Dev would 502 (no valid token) — endpoint verified by code | curl error path + code read | OK |
| Empty state (text-no-leads) | status pill | Shown when no leads stored. | lsa-account-manager.tsx:1044 | GET /api/admin/lsa/accounts/1 → leads = storage.getLsaLeadsByAccount (server/storage.ts:1003: SELECT * FROM lsa_manager_leads WHERE account_id=1 ORDER BY created_at DESC LIMIT 50). Dev: [] = SQL count 0 | SQL + curl | OK |
| Lead table (table-leads): Customer / Service / Status / Charged / Disputed cells (row-lead-*) | status pill | Stored lead fields; "Charged $X" badge shows lsa_manager_leads.charge_amount. | lsa-account-manager.tsx:1063-1068 | same endpoint → lsa_manager_leads.customer_name, service_requested, status, charged, charge_amount, disputed | code read (0 rows in dev) | OK |
| "Dispute" button (button-dispute-lead-*) | button | Opens the dispute dialog (only on charged, not-yet-disputed leads). | lsa-account-manager.tsx:1070-1074 | (dialog POST below) | code read | OK |

### Account detail — dialogs
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Confirm dialog (dialog-confirm-action): Cancel + "Confirm" (button-confirm-action) | button | Confirms the pause/enable action. | lsa-account-manager.tsx:1086-1101 | PATCH .../status (see Pause/Enable row) | code read | OK |
| Budget dialog (dialog-budget): input-new-budget, Cancel, "Update Budget" (button-confirm-budget) | input/button | Sends a new daily budget to Google. | lsa-account-manager.tsx:1106-1126 | PATCH /api/admin/lsa/accounts/{id}/campaigns/{cid}/budget {newDailyBudgetDollars,budgetResourceName,campaignResourceName} → server/routes.ts:6277 → mutateCampaignBudget (server/lsa-manager.ts:276, campaignBudgets:mutate updateMask amount_micros) + admin_audit_log (budget_change). Client body matches zod schema exactly | code read | OK |
| Rename dialog (dialog-rename): input-new-name, Cancel, "Save Name" (button-confirm-rename) | input/button | Renames the campaign at Google. | lsa-account-manager.tsx:1131-1153 | PATCH /api/admin/lsa/accounts/{id}/campaigns/{cid}/settings {campaignResourceName,name} → server/routes.ts:6237 → mutateCampaignSettings (server/lsa-manager.ts:354) + admin_audit_log (campaign_settings_change). Body matches zod schema | code read | OK |
| Dispute dialog (dialog-dispute): warning, reason select (select-dispute-reason: spam_or_robot_call / wrong_service / wrong_location / already_customer / job_already_booked / solicitation / other), Cancel, "Dispute Lead" (button-confirm-dispute) | select/button | Flags a charged lead as disputed locally (admin-side record; no Google call here). | lsa-account-manager.tsx:1156-1193 | POST /api/admin/lsa/leads/{leadId}/dispute {reason} → server/routes.ts:6451 → storage.disputeLsaLead (server/storage.ts:1023: UPDATE lsa_manager_leads SET disputed=true, dispute_reason, disputed_at, disputed_by_admin_id WHERE id AND charged=true AND disputed=false; 400 "Only charged leads..." / "already been disputed") + admin_audit_log (dispute_lead). Client reason list == server DISPUTE_REASONS (routes.ts:6428-6436) | code read | OK |

### Audit log tab (table-audit-log)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Intro line | status pill | Static text: all admin write actions are recorded. | lsa-account-manager.tsx:1232 | — | code read | OK |
| Empty state (text-no-audit-logs) | status pill | Shown when the log is empty. | lsa-account-manager.tsx:1241 | GET /api/admin/lsa/audit-log → server/routes.ts:6484 → storage.getAdminAuditLog (server/storage.ts:1049: SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 100 OFFSET 0) | code read | OK |
| When / Admin / Action badge / Account / Result badge / Details cells (row-audit-*, text-audit-actor-*, badge-audit-action-*, badge-audit-result-*) | status pill | One row per admin action; Details shows the error message or JSON parameters. Action labels are a client-side map (line 1205-1220). | lsa-account-manager.tsx:1245-1279 | same endpoint → admin_audit_log.created_at (browser-local toLocaleString), actor_email, action, target_account_name||target_customer_id, result, error_message||parameters. Dev: API returned 8 rows = SQL `SELECT count(*) FROM admin_audit_log` (8); spot-checked ids 1-8 match (2 success manager_connect, 6 error manager_connect with the OAuth-client rejection message) | SQL + curl | OK |

Page total: 87 elements · OK 86 · BUG 1 · UNCLEAR 0 · DEAD 0

---

## client/src/pages/lsa-leads.tsx — route /lsa-leads

This is the contractor-facing page: a signed-in user connects their own Google Ads account over OAuth, sees every Google Ads account they can access, reviews imported Local Services Ads leads, rates leads Good/Bad, and files "bad lead" billing disputes (individually, batched, or scattered over a date range); it can also DM new-lead alerts via Telegram. Route is in `SIGNED_IN_ONLY` (client/src/App.tsx:338); there is no org dimension — every API scopes by `req.user.id` (server/lsa/routes.ts). Main data source: per-user rows in `lsa_connections`, `lsa_accounts`, `lsa_leads`, plus live Google Ads API calls for sync and feedback.

In dev: /api/lsa/status returns configured=false, connected=false (no lsa_connections row for user 1; SQL count 0 for all users). The page therefore renders only the disabled "Connect Google Ads" button plus the setup notice; everything below is mapped from code and verified against the (empty) API responses.

### Page header actions
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Sync now" button (button-sync) | button | Pulls the latest accounts+leads from Google for the signed-in user; toast reports new leads and account count (the account count is wrong — see Suspected bugs). | lsa-leads.tsx:223-226 | POST /api/lsa/sync → server/lsa/routes.ts:150 → syncConnection (server/lsa/sync.ts:409: optional discovery, then syncAccount for every enabled lsa_accounts row of this user; updates lsa_connections.last_sync_at/last_sync_error/last_sync_count/last_cost_total). Returns {ok, imported, accountsWithLsa, accountsScanned, error?} — **no `accountsSynced` field** | code read: handler 400s "Connect Google Ads first." without a refresh token (server/lsa/routes.ts:154); response shape read at server/lsa/sync.ts:447-453 | BUG |
| "More ▸" disclosure + "Disconnect" (button-disconnect) | button | Unlinks the user's Google Ads connection (clears the stored refresh token). | lsa-leads.tsx:227-229 | POST /api/lsa/disconnect → server/lsa/routes.ts:135 → UPDATE lsa_connections SET refresh_token=NULL, connected_email=NULL WHERE user_id=1 | code read (hidden in dev: not connected) | OK |
| "Connect Google Ads" button (button-connect) | button | Redirects the browser to Google OAuth. | lsa-leads.tsx:232-234 | GET /api/lsa/oauth/start → server/lsa/routes.ts:84 → 302 to accounts.google.com OAuth (state nonce in session); callback /api/lsa/oauth/callback (routes.ts:96) stores refresh_token on lsa_connections and redirects back to /lsa-leads?connect=ok | code read; hidden in dev (configured=false → disabled variant shown instead) | OK |
| Disabled "Connect Google Ads" button | button | Shown (disabled) when Google OAuth isn't configured on the server. | lsa-leads.tsx:235 | — (server isConfigured() false in dev: /api/lsa/status "configured":false) | curl | OK |
| OAuth redirect toast handler | status pill | Reads ?connect=ok|error|norefresh after the OAuth round trip and toasts the outcome; cleans the URL. | lsa-leads.tsx:180-194 | client only | code read | OK |

### Setup notice
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Ads setup is required…" notice | status pill | Shown when the server lacks Google OAuth credentials. | lsa-leads.tsx:236 | GET /api/lsa/status → configured = isConfigured() (env GOOGLE_CLIENT_ID/SECRET present) | curl: configured=false | OK |

### Connection section (status.configured && status.connected)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Last synced …" (text-last-sync) | number/stat/count | When the last sync finished (browser-local). | lsa-leads.tsx:244 | GET /api/lsa/status → lsa_connections.last_sync_at (refreshed every 15s by the page) | code read (hidden in dev) | OK |
| "Accounts discovered …" | number/stat/count | When account discovery last ran. | lsa-leads.tsx:245 | same → lsa_connections.last_discovery_at | code read | OK |
| "Last sync issue: …" warning box | status pill | Soft sync error (e.g. "N of M account(s) skipped"). | lsa-leads.tsx:247-252 | same → lsa_connections.last_sync_error | code read | OK |

### Redirect-URI help box (box-redirect-uri) — configured && !connected
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Redirect URI code block (text-redirect-uri) | status pill | The exact OAuth callback URL to register in Google Cloud. | lsa-leads.tsx:292-294 | GET /api/lsa/status → redirectUri = https://constructhub.us/api/lsa/oauth/callback (server/lsa/client.ts getRedirectUri) | curl: returned in status JSON even when disconnected | OK |
| "Copy" button (button-copy-redirect-uri) | button | Copies the redirect URI to the clipboard. | lsa-leads.tsx:295-297 | client only (clipboard API) | code read | OK |

### Telegram panel (panel-telegram) — inside the Connection section
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Telegram lead alerts" disclosure + "aren't configured" note | status pill | If the server has no bot token, says so and offers nothing. | lsa-leads.tsx:331-337 | GET /api/lsa/status → telegramConfigured=false in dev | curl | OK |
| "Linked" badge | badge | Shown when a Telegram chat is linked. | lsa-leads.tsx:343 | same → connection.telegramLinked = !!lsa_connections.telegram_chat_id | code read | OK |
| "Unlink" button (button-telegram-unlink) | button | Clears the linked Telegram chat. | lsa-leads.tsx:348 | POST /api/lsa/telegram/unlink → server/lsa/routes.ts:330 → UPDATE lsa_connections SET telegram_chat_id=NULL, telegram_link_token=NULL, telegram_username=NULL WHERE user_id=1 | code read | OK |
| Username input (input-telegram-username) | input | Optional @username shown in the deep link. | lsa-leads.tsx:354 | — | code read | OK |
| "Link Telegram" button (button-telegram-link) | button | Creates a one-time deep link and opens the bot chat; pressing Start in Telegram stores the chat id. | lsa-leads.tsx:356-358 | POST /api/lsa/telegram/link {username} → server/lsa/routes.ts:311 → UPDATE lsa_connections SET telegram_username, telegram_link_token=NEW → returns deepLink https://t.me/<bot>?start=<token>; the bot webhook (routes.ts:344) fills telegram_chat_id | code read | OK |
| "Open Telegram" link | link | Re-opens the deep link in a new tab. | lsa-leads.tsx:359 | client only | code read | OK |

### Accounts overview — shown when connected
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Search input (input-search-accounts) | filter | Debounced (300ms) server-side search over account name and customer ID. | lsa-leads.tsx:394 | GET /api/lsa/accounts?q=…&page=…&pageSize=25 → server/lsa/routes.ts:181 → SELECT * FROM lsa_accounts WHERE user_id=1 AND (descriptive_name ILIKE %q% OR customer_id ILIKE %q%) ORDER BY (lsa_enrolled IS TRUE first, then lead_count DESC) LIMIT 25 OFFSET … | SQL: 0 lsa_accounts rows for user 1 (and 0 for all users); curl returns {accounts:[],total:0} | OK |
| Account card (card-account-{customerId}) | link (clickable row) | Opens the account's lead list. Shows name, customer ID, LSA / Manager / Paused badges, lead count, charged count. | lsa-leads.tsx:408-436 | same endpoint → lsa_accounts.descriptive_name, customer_id, lsa_enrolled, is_manager, enabled, lead_count, charged_count (denormalized, refreshed by sync — server/lsa/sync.ts:332-358) | SQL + curl (empty in dev) | OK |
| "Page X of Y · N accounts" pager text | number/stat/count | Pagination over the account list. | lsa-leads.tsx:440 | same endpoint → total = count(lsa_accounts WHERE user_id=1 [AND q]) | SQL + curl | OK |
| Prev / Next (button-accounts-prev / button-accounts-next) | button | Page through accounts. | lsa-leads.tsx:442-443 | client only | code read | OK |

### Account detail — stat grid (4 tiles)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Total leads (stat-leads) | number/stat/count | All-time imported leads for this account (lsa_accounts.lead_count). | lsa-leads.tsx:566 | lsa_accounts.lead_count — maintained by sync as count(lsa_leads WHERE user_id AND customer_id) (server/lsa/sync.ts:332-335) | code read (no accounts in dev) | OK |
| Charged leads (stat-charged) | number/stat/count | All-time leads Google marked charged (lsa_accounts.charged_count). | lsa-leads.tsx:567 | lsa_accounts.charged_count = count(lsa_leads … lead_charged=true) (sync.ts:336-339) | code read | OK |
| Disputed (stat-disputed) | number/stat/count | All-time leads whose local dispute pipeline reached status 'disputed' (lsa_accounts.disputed_count). | lsa-leads.tsx:568 | lsa_accounts.disputed_count = count(lsa_leads … dispute_status='disputed') (sync.ts:340-343) — same predicate as the Disputed filter below, so tile and filter agree | code read | OK |
| Total spend (stat-spend) | number/stat/count | Sum of lead costs for this account, formatted $x.xx (falls back to $0.00 when null). | lsa-leads.tsx:569 | lsa_accounts.cost_total (numeric(12,2), maintained by syncLeadCostsForAccount, sync.ts:328-330) | code read | OK |

### Account detail — filter bar
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| All (button-filter-all) | filter | Shows every lead for the account. | lsa-leads.tsx:576 | GET /api/lsa/leads?customerId=…&filter=all → server/lsa/routes.ts:225 → lsa_leads WHERE user_id=1 AND customer_id=… ORDER BY lead_creation_time DESC LIMIT 50 | SQL: 0 rows; curl {leads:[],total:0} | OK |
| Charged (button-filter-charged) | filter | Only leads with lead_charged=true. | lsa-leads.tsx:576 | same endpoint, cond lead_charged=true (routes.ts:235) | code read | OK |
| Disputed (button-filter-disputed) | filter | Only leads with dispute_status='disputed'. | lsa-leads.tsx:576 | same endpoint, cond dispute_status='disputed' (routes.ts:236) | code read | OK |

### Bulk dispute toolbar (only when the page has disputable leads)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Select all on page" checkbox (checkbox-select-all) | input | Selects/deselects every disputable lead on the current page. | lsa-leads.tsx:584 | client only | code read | OK |
| "N selected" count | number/stat/count | How many leads are selected. | lsa-leads.tsx:587 | client only | code read | OK |
| "Schedule for later" toggle (button-toggle-schedule) | button | Opens the date-range scatter panel. | lsa-leads.tsx:589-591 | client only | code read | OK |
| "Report N now" (button-report-now) | button | Queues the selected leads as DISSATISFIED feedback to Google, sent one at a time 30–60s apart. | lsa-leads.tsx:592-594 | POST /api/lsa/disputes {items:[{leadId,reason}…]} → server/lsa/routes.ts:268 → enqueueDisputes (server/lsa/disputes.ts:192: atomic claim UPDATE lsa_leads SET dispute_status='queued', dispute_reason WHERE lead_id AND user_id AND lead_charged=true AND (feedback_submitted IS NULL OR false) AND dispute_status IN (NULL,'failed','scheduled'); per-account spaced in-memory queue → provideLeadFeedback DISSATISFIED → Google localServicesLeads:provideLeadFeedback; on success sets feedback_submitted=true, dispute_status='disputed') | code read | OK |
| "Clear" (button-clear-selection) | button | Clears the selection. | lsa-leads.tsx:595 | client only | code read | OK |

### Schedule panel (scheduleOpen)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| From date (input-schedule-start) | input | Start of the scatter window (default tomorrow). | lsa-leads.tsx:603 | — | code read | OK |
| To date (input-schedule-end) | input | End of the scatter window (default +7d). | lsa-leads.tsx:606 | — | code read | OK |
| "Schedule N" (button-submit-schedule) | button | Scatters the selected disputes at random business-hour moments inside the window; a 60s server timer promotes due ones into the send queue. | lsa-leads.tsx:608-610 | POST /api/lsa/disputes/schedule {items:[{leadId,reason,runAt}]} → server/lsa/routes.ts:281 → scheduleDisputes (disputes.ts:247: claim UPDATE dispute_status='scheduled', dispute_scheduled_at WHERE same disputable conditions); promoteDueScheduledDisputes (disputes.ts:314) runs every 60s (server/lsa/routes.ts:365) | code read | OK |

### Lead cards (row-lead-{leadId}) — none in dev
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Select checkbox (checkbox-lead-*) | input | Adds the lead to the batch-dispute selection (only on disputable leads: not feedbackSubmitted and dispute_status not in queued/sending/disputed/scheduled — lsa-leads.tsx:120-124, matches server's claim predicates). | lsa-leads.tsx:633 | client only | code read | OK |
| Contact name | status pill | Lead contact name or "Google LSA lead". | lsa-leads.tsx:636 | GET /api/lsa/leads → lsa_leads.contact_name | code read (0 rows) | OK |
| Service / category line | status pill | service_id · category_id. | lsa-leads.tsx:637-643 | same → service_id, category_id | code read | OK |
| DisputeSticker (Scheduled / Queued / Sending / Disputed / Failed / Good) | badge | Live state of the local dispute pipeline (or "Good" when Google has SATISFIED feedback). | lsa-leads.tsx:730-739 | same → dispute_status, feedback_submitted, survey_answer | code read | OK |
| Lead type badge (Phone call / Message / Booking) | badge | lsa_leads.lead_type mapped to words. | lsa-leads.tsx:648 | same → lead_type | code read | OK |
| Charged badge "Charged · $X" / "Not charged" | badge | Whether Google charged for this lead, with cost. | lsa-leads.tsx:649-652 | same → lead_charged, lead_cost (2dp) | code read | OK |
| Date badge | number/stat/count | lead_creation_time (or created_at) in browser-local time. | lsa-leads.tsx:653-657 | same → lead_creation_time DESC ordering | code read | OK |
| Phone link (tel:) | link | Dials the lead's phone number. | lsa-leads.tsx:661-663 | client only: <a href="tel:{contact_phone}"> | code read | OK |
| Email text | status pill | Lead's email address. | lsa-leads.tsx:664-666 | same → contact_email | code read | OK |
| Per-lead reason select (select-reason-*) | select | Pick the DISSATISFIED reason for this lead in the batch (grouped "best" reasons first; values DUPLICATE/GEO_MISMATCH/JOB_TYPE_MISMATCH/NOT_READY_TO_BOOK/SOLICITATION — all in server LSA_DISPUTE_REASONS, shared/schema.ts:1065-1072). | lsa-leads.tsx:147-168, 673 | — (sent with the batch POST) | code read | OK |
| "More details / Hide details" (button-expand-*) | button | Expands the details grid. | lsa-leads.tsx:678-680 | client only | code read | OK |
| Details grid (Service / Category / Lead type / Lead status / Credit state / Your rating / Google lead ID) | status pill | Raw stored fields; "Your rating" shows "Reported · <reason>" or survey answer. | lsa-leads.tsx:684-694 | same → service_id, category_id, lead_type, lead_status, credit_state, dispute_reason/survey_answer, lead_id | code read | OK |
| "Good" button (button-good-*) | button | Tells Google this lead was satisfactory (ProvideLeadFeedback SATISFIED). | lsa-leads.tsx:775-777 | POST /api/lsa/leads/{leadId}/good → server/lsa/routes.ts:252 → provideLeadFeedback(userId, leadId, 'SATISFIED') (server/lsa/disputes.ts:41: 400 if already rated; Google provideLeadFeedback; UPDATE lsa_leads SET feedback_submitted=true, survey_answer='SATISFIED', dispute_status=NULL) | code read | OK |
| "Bad" button (button-bad-*) | button | Opens the single-lead reason picker. | lsa-leads.tsx:778-780 | client only | code read | OK |
| Single-lead reason select (select-single-reason-*) + "Report" (button-confirm-bad-*) / "Cancel" (button-cancel-bad-*) | select/button | Queues one dispute through the same spaced pipeline as a batch. | lsa-leads.tsx:763-769 | POST /api/lsa/disputes {items:[{leadId, reason}]} (same as batch) | code read | OK |

### Leads pager
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Page X of Y · N leads" | number/stat/count | Pagination text; N = filtered total. | lsa-leads.tsx:704 | same leads endpoint → total = count over the filtered where | code read | OK |
| Prev / Next (button-leads-prev / button-leads-next) | button | Page through leads (50/page). | lsa-leads.tsx:706-707 | client only | code read | OK |

Page total: 53 elements · OK 52 · BUG 1 · UNCLEAR 0 · DEAD 0

---

## client/src/pages/lsa-guide.tsx — route /lsa-guide

A public marketing/educational page: an 8-section playbook on setting up and optimizing Google Local Services Ads, with hard-coded "average cost per lead" figures per trade, an LSA-vs-Google-Ads comparison, and CTAs into the Master Class and Click Guard pages. No route guard — it is registered in both the public block (client/src/App.tsx:201) and the signed-in dashboard block (App.tsx:306); signed out it renders the public site header (PublicPageHeader, client/src/components/public-page-chrome.tsx:36, itself only when /api/auth/me has no user). No backend data at all: every number on the page is a hard-coded marketing figure, not a live count. The only images are five bundled screenshots in attached_assets/ (verified present on disk; @assets alias → attached_assets, vite.config.ts:28).

### Public header (signed-out chrome)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| header-public-page (SiteNavBar: Features dropdown, home sections, Sign in / Get started) | link (incl. links inside text) | Standard marketing-site navigation; Sign in links back to /auth with next=/lsa-guide. | public-page-chrome.tsx:36-45, site-nav.tsx | client only | code read | OK |

### Hero
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Verified (Local Services Ads)" badge (badge-lsa) | badge | Static label; decorative glow. | lsa-guide.tsx:214-217 | client only: static text | code read | OK |
| Page title (text-lsa-title) + subtitle | status pill | "Local Services Ads: The Complete LSA Setup & Optimization Playbook" + one-line pitch. | lsa-guide.tsx:218-227 | client only: static text | code read | OK |

### Hero stat cards (4) — hard-coded marketing figures
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Position #1" (card-stat-position) | number/stat/count | Claim: LSA sits at the top of Google search. Hard-coded. | lsa-guide.tsx:232, 237-244 | client only: constant | code read | OK |
| "Pay Model · Per Lead" (card-stat-pay-model) | number/stat/count | Claim: you pay per lead, not per click. Hard-coded. | lsa-guide.tsx:233, 237-244 | client only: constant | code read | OK |
| "Avg CPL · $25-100" (card-stat-avg-cpl) | number/stat/count | Claim: average cost per lead ranges $25–100 by trade/market. Hard-coded (matches the trade tiles below, which say Plumber $25-50 etc.). | lsa-guide.tsx:234, 237-244 | client only: constant | code read | OK |
| "Guide Sections · 8" (card-stat-guide-sections) | number/stat/count | Number of collapsible sections below. Equals SECTIONS.length = 8 (lsa-guide.tsx:23-185). | lsa-guide.tsx:235, 237-244 | client only: constant; verified count of SECTIONS entries = 8 | code read | OK |

### "LSA Is Better Than Google Ads" overview card (card-lsa-overview)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Overview paragraph | status pill | Static pitch for the pay-per-lead model. | lsa-guide.tsx:247-259 | client only: static text | code read | OK |

### Guide section cards (8 × card-section-{id}, toggle button-toggle-{id})
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| 1 Business Verification & Getting Google Verified (button-toggle-verification) | button | Collapsible section: verification steps, 2-5 week timeline, one bundled screenshot, tips. | lsa-guide.tsx:24-39, 262-287 | client only: static content (1 image: image_1772143162244.png, present in attached_assets) | code read + asset on disk | OK |
| 2 Always Answer Your Calls (button-toggle-answering-calls) | button | Collapsible section: answer-rate ranking advice + 5-item list. | lsa-guide.tsx:40-61 | client only | code read | OK |
| 3 Reviews Are Your Ranking Fuel (button-toggle-reviews) | button | Collapsible section: reviews & dispute-sparingly advice. | lsa-guide.tsx:62-76 | client only | code read | OK |
| 4 Selecting Your Services (button-toggle-services) | button | Collapsible section: service-selection traps + screenshot (image_1772143583811.png). | lsa-guide.tsx:77-99 | client only | code read + asset on disk | OK |
| 5 Message Leads (button-toggle-messages) | button | Collapsible section: message-leads trade-off + screenshot (image_1772143427414.png). | lsa-guide.tsx:100-116 | client only | code read + asset on disk | OK |
| 6 Service Areas & Business Hours (button-toggle-service-areas) | button | Collapsible section: county targeting, 24/7 hours + screenshot (image_1772143887357.png). | lsa-guide.tsx:117-138 | client only | code read + asset on disk | OK |
| 7 Photos (button-toggle-photos) | button | Collapsible section: team/truck photos advice. | lsa-guide.tsx:139-161 | client only | code read | OK |
| 8 Business Bio & Trust Signals (button-toggle-bio) | button | Collapsible section: business-highlight picks + bio advice. | lsa-guide.tsx:162-184 | client only | code read | OK |

### Average Cost Per Lead card (card-cost-table) — hard-coded figures
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Plumber $25–$50 (avg $35) tile (card-trade-0) | number/stat/count | Claimed average CPL range for plumbers. Hard-coded; labelled "Approximate ranges based on national averages." | lsa-guide.tsx:188, 375-383 | client only: INDUSTRY_STATS constant | code read | OK |
| Roofer $50–$100 (avg $75) tile (card-trade-1) | number/stat/count | Claimed average CPL range for roofers. | lsa-guide.tsx:189, 375-383 | client only: constant | code read | OK |
| HVAC $30–$60 (avg $45) tile (card-trade-2) | number/stat/count | Claimed average CPL range for HVAC. | lsa-guide.tsx:190, 375-383 | client only: constant | code read | OK |
| Electrician $20–$45 (avg $30) tile (card-trade-3) | number/stat/count | Claimed average CPL range for electricians. | lsa-guide.tsx:191, 375-383 | client only: constant | code read | OK |
| Painter $15–$35 (avg $25) tile (card-trade-4) | number/stat/count | Claimed average CPL range for painters. | lsa-guide.tsx:192, 375-383 | client only: constant | code read | OK |
| Locksmith $15–$30 (avg $20) tile (card-trade-5) | number/stat/count | Claimed average CPL range for locksmiths. | lsa-guide.tsx:193, 375-383 | client only: constant | code read | OK |
| Pest Control $20–$40 (avg $28) tile (card-trade-6) | number/stat/count | Claimed average CPL range for pest control. | lsa-guide.tsx:194, 375-383 | client only: constant | code read | OK |
| Garage Door $25–$50 (avg $35) tile (card-trade-7) | number/stat/count | Claimed average CPL range for garage-door contractors. | lsa-guide.tsx:195, 375-383 | client only: constant | code read | OK |
| Metro/seasonality warning card | status pill | Static caveat that major metros run 2-3x higher. | lsa-guide.tsx:384-393 | client only | code read | OK |

### LSA vs. Google Ads comparison card (card-lsa-vs-ads)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| 7 comparison rows (comparison-0 … comparison-6): Payment Model, Position, Trust Badge, Keyword Control, Fraud Protection, Ranking Factor, Setup Complexity | status pill | Static side-by-side claims; the winning side is tinted green (LSA) or blue (Ads). | lsa-guide.tsx:411-433 | client only: constant array | code read | OK |

### Bottom CTA card (card-bottom-cta)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| CTA paragraph | status pill | Static text pitching Master Class + Click Guard. | lsa-guide.tsx:442-444 | client only | code read | OK |
| "Explore Master Class" button (button-masterclass) | link | Goes to the Master Class marketing page. | lsa-guide.tsx:446-450 | client only: wouter <Link href="/master-class">; route exists at client/src/App.tsx:190 (and :297) | route confirmed in App.tsx | OK |
| "Set Up Click Guard" button (button-click-guard) | link | Goes to the Click Guard (Google Ads) page. | lsa-guide.tsx:451-455 | client only: wouter <Link href="/google-ads">; route exists at client/src/App.tsx:193 (and :300) | route confirmed in App.tsx | OK |

Page total: 29 elements · OK 29 · BUG 0 · UNCLEAR 0 · DEAD 0

---

## Suspected bugs

1. **lsa-leads · "Sync now" toast account count** — The owner clicks Sync now and the success toast always says "N new lead(s) across **0** account(s)" no matter how many accounts were actually synced. Evidence: client reads `data?.accountsSynced` (client/src/pages/lsa-leads.tsx:199), but POST /api/lsa/sync returns `syncConnection`'s result `{ok, imported, accountsWithLsa, accountsScanned, error?}` (server/lsa/sync.ts:447-453) — there is no `accountsSynced` field, so `undefined ?? 0` = 0. Root cause: client/src/pages/lsa-leads.tsx:199 (`data?.accountsSynced`). Smallest fix: read `data?.accountsScanned` (or `accountsWithLsa`, whichever matches the intent).

2. **lsa-account-manager · Accounts tab search box only searches the current page** — The owner types a customer ID or name into "Search by customer ID or name..." expecting to find any linked account; matches on other pages of the registry are silently missing because the server paginates (GET /api/admin/lsa/accounts?limit=50&offset=page*50, client/src/pages/lsa-account-manager.tsx:460-463) and the search then filters only the 50 rows of the loaded page client-side (client/src/pages/lsa-account-manager.tsx:487-489). The server endpoint has no query/search parameter (server/routes.ts:6154-6165). With the current dev data (1 account) it cannot be demonstrated end-to-end, but with >50 accounts a search on page 2+ provably cannot return page-1 rows. Root cause: client-side filter over a server-paginated list. Smallest fix: accept a `q` param server-side (mirroring GET /api/lsa/accounts in server/lsa/routes.ts:181-193) and send the search term with the request instead of filtering in memory.

## Notes / not bugs
- lsa-account-manager "Manager connection" API returns `managerId: "1234567890"` even while disconnected (lsa_manager_connection row is kept with status='disconnected'); the UI only shows the ID in the Connected state, so nothing misleading renders.
- lsa-guide "Avg CPL $25-100" hero card and all 8 trade tiles are hard-coded marketing figures explicitly labelled "Approximate ranges based on national averages" — presented as claims, not live data.
- The lsa-leads Disputed stat tile (lsa_accounts.disputed_count) and the Disputed filter (dispute_status='disputed') use the same predicate (server/lsa/sync.ts:340-343 vs server/lsa/routes.ts:236), so they cannot disagree.
- All Google Ads API calls (campaigns, sync-leads, budget/status/rename mutations, invitation creation) correctly fail in dev with 502 "Failed to get valid access token" (no real Google credentials); this is expected, not a bug.
- No other tenant has any LSA data in this DB (lsa_accounts/lsa_leads/lsa_connections are 0 rows for all users; manager tables are global and listed above), so cross-account leakage is not observable here.

---


Audit date 2026-10-04, dev server http://127.0.0.1:8303 (dev bypass = user id=1 "Veto", platform admin). DB: constructhub_dev_a6 (SELECT only).

Shared backend facts (apply to both pages):
- One site list per user: `tracked_domains` (shared/schema.ts:543), linked by `user_id` (NOT org). All 12 rows in the dev DB belong to user 1; no other account has rows. The IP Tracker, Click Guard and VPN Shield pages all read the same 12 sites.
- Server time zone = America/New_York (EDT), same as the DB session; `visited_at`/`blocked_at`/`created_at` are `timestamp` (no tz), written with `defaultNow()`.
- Auth on every API below: `getDevUser` (server/routes.ts:160) → 401 without session. Every `:id` handler re-checks `domain.userId === user.id` → 404 for someone else's site (verified by code; only user 1 owns rows in dev).
- Data read functions (server/storage.ts): `getTrackedDomains(userId)` orderBy createdAt DESC (storage.ts:628) — so the default selected site on both pages is the NEWEST site, currently id 33 "FIX-c07 Rev B" (created 2026-09-30 00:56:09.314). `getClickVisits(domainId, start?, end?)` = `click_visits WHERE domain_id=? [AND visited_at>=start] [AND <=end] ORDER BY visited_at DESC LIMIT 1000` (storage.ts:662). `getBlockedIps(domainId)` = `blocked_ips WHERE domain_id=? AND is_active=true` (storage.ts:682). `getVpnVisits(domainId)` = all `vpn_visits` for the site, no date cap (storage.ts:705).
- Visit totals per site from SQL: id2=33 visits/25 IPs/8 suspicious; id3=1; id10=8/2; id23=6/1/3 susp; id24=2/1/2 susp; id25=3/2; id33=2/1; others 0. Active blocked IPs: id24=1, id32=1. vpn_visits: id2=24 (2 action=block), id3=2 (2 block), id8=9 (4 block/3 log/2 redirect), id26=4 (2 block), ids 30 & 35 =1 each (orphan rows, their tracked_domains rows are gone — never surface in the UI because every query starts from tracked_domains). All visits are 2026-09-29/30; nothing today/yesterday/last-20-min.

## client/src/pages/ip-tracker.tsx — route /ip-tracker

Registered in client/src/App.tsx:203 (signed-in `DashboardRouter` — any signed-in user; data comes from the API which is per-user) and App.tsx:307 (signed-out `PublicRouter`, wrapped in `withRibbon` marketing header, App.tsx:259 — page shell renders but every API call 401s). Server side there is no role check beyond "owns the site" (`domain.userId !== user.id` → 404). Page purpose: see who visits your websites (visitor analytics fed by a tracking pixel), per-site. Main data source: `tracked_domains` + `click_visits` (+ `blocked_ips`), all scoped to the signed-in user via `/api/click-guard/*`.

### Page header (ip-tracker)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "IP Tracker" title / text-page-title | text | Page title. | ip-tracker.tsx:907 | client only | App.tsx:203 route exists (curl /ip-tracker 200) | OK |
| Subtitle / text-subtitle | text | One-line description of the page. | ip-tracker.tsx:908 | client only | — | OK |
| Site pill / badge-ip-tracker | status pill | Shows the name of the site currently being viewed. | ip-tracker.tsx:909-913 | same data as select-domain below | — | OK |
| Site select / select-domain | select | Picks which site's data the tabs show; choice is stored in the URL (?site=) so a refresh keeps it. Defaults to the newest site (id 33). | ip-tracker.tsx:919-929 | GET /api/click-guard/domains → routes.ts:3484 → storage.getTrackedDomains(user.id): tracked_domains WHERE user_id=1 ORDER BY created_at DESC (12 rows, all user 1) | curl API ids order [33,32,26,25,24,23,15,10,9,8,3,2] = SQL `SELECT id FROM tracked_domains WHERE user_id=1 ORDER BY created_at DESC` | OK |
| "Site actions" ⋯ button / button-site-actions | button | Opens a small menu with one entry, "Remove site". | ip-tracker.tsx:933-936 | client only | — | OK |
| "Remove site" menu item / button-remove-domain | menu item | Opens the "are you sure" dialog for deleting the selected site. | ip-tracker.tsx:939-945 | client only | — | OK |
| "Add site" / button-add-domain | button | Shows the "Add a site" card with the two inputs. | ip-tracker.tsx:948-954 | client only | — | OK |

### Remove-site dialog (AlertDialog, dialog-remove-domain)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog title + description (dialog-remove-domain) | text | Warns that removing the site stops tracking it in IP Tracker, Click Guard and VPN Shield and permanently deletes its recorded visits and blocked IPs. | ip-tracker.tsx:962-967 | the DELETE below deletes click_visits + blocked_ips + vpn_visits + tracked_domains for the site (storage.ts:652-660), matching the copy | read storage.deleteTrackedDomain code | OK |
| Cancel / button-cancel-remove-domain | button | Closes the dialog, deletes nothing. | ip-tracker.tsx:970 | client only | — | OK |
| "Remove site" confirm / button-confirm-remove-domain | button | Permanently deletes the selected site and all its visits, blocked IPs and VPN records, then returns to the dashboard tab with a "Site removed" toast. | ip-tracker.tsx:971-977 | DELETE /api/click-guard/domains/:id → routes.ts:3547 → ownership check (404 if not yours) → storage.deleteTrackedDomain: tx DELETE blocked_ips, click_visits, vpn_visits, tracked_domains WHERE domain_id=id | endpoint + code match (method/path); write shape verified by code (read-only, not executed) | OK |

### Add-a-site card (card-add-domain)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Domain input / input-domain | input | Where you type the website address, e.g. example.com. | ip-tracker.tsx:987-992 | — (sent with Save) | — | OK |
| Display-name input / input-domain-name | input | Optional friendly name for the site. | ip-tracker.tsx:993-998 | — (sent with Save) | — | OK |
| Add / button-save-domain | button | Saves the new site (disabled until a domain is typed), then shows it selected with its tracking-code card. | ip-tracker.tsx:1001-1008 | POST /api/click-guard/domains body {domain, name} → routes.ts:3514 → normalizeTrackedDomain, plan gate requirePlan "protectedSites" (402 if no plan, 403 over the plan's site limit, counted per user with pg_advisory lock) → INSERT tracked_domains (user_id, domain, tracking_id uuid, name, is_active=true) | body shape matches routes.ts:3518-3530 (verified by code; POST not executed per read-only rule) | OK |
| Cancel / button-cancel-domain | button | Hides the card. | ip-tracker.tsx:1009-1016 | client only | — | OK |

### Tab bar (6 tabs)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dashboard / tab-dashboard | tab | Shows the stat tiles, 14-day chart and all-sites table. | ip-tracker.tsx:1026-1039 | — | route is a client state switch (query param ?tab=) | OK |
| Visitors / tab-visitors | tab | Shows the per-visitor list with expandable details. | ip-tracker.tsx:1026-1039 | — | — | OK |
| Traffic / tab-traffic | tab | Shows where visits come from (referring sites). | ip-tracker.tsx:1026-1039 | — | — | OK |
| Pages / tab-pages | tab | Shows which of your pages got visited. | ip-tracker.tsx:1026-1039 | — | — | OK |
| Geo / tab-geo | tab | Shows visits by country/city. | ip-tracker.tsx:1026-1039 | — | — | OK |
| Platforms / tab-platforms | tab | Shows browsers, operating systems, devices, screen sizes. | ip-tracker.tsx:1026-1039 | — | — | OK |

### Empty state (no sites)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Empty-state card + "No sites being tracked" | empty state | Shown when you have no sites; explains you need the tracking code. | ip-tracker.tsx:1047-1054 | client only | — | OK |
| "Add your first site" / button-add-first-domain | button | Opens the Add-a-site card. | ip-tracker.tsx:1055-1057 | client only | — | OK |

### Dashboard tab — InstallCard (card-install-tracking)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Tracking code for …" + status text / text-install-status | text | Shows how many visits have been recorded, or "No visits recorded yet" (card starts open then). | ip-tracker.tsx:256-261 | stats from GET /api/click-guard/domains (below) | for site 2 API says 33 visits = SQL `SELECT count(*) FROM click_visits WHERE domain_id=2` → 33 | OK |
| "Show code"/"Hide code" / button-toggle-install | button | Toggles the tracking-code box (only appears once visits exist). | ip-tracker.tsx:263-267 | client only | — | OK |
| Tracking snippet / text-tracking-snippet | text | The `<script src="…/api/click-guard/script/<trackingId>" async></script>` tag to paste into your site. Origin comes from /api/public-config (returns http://localhost:8303 in dev, client falls back to window.location.origin). | ip-tracker.tsx:240, 275 | GET /api/click-guard/script/:trackingId → server/tracking-script.ts:6 → serves the tracking JS (204 No Content collector is POST /api/click-guard/track, routes.ts:3381, which writes click_visits incl. Cloudflare geo) | curl -sI script URL → 200, Content-Type application/javascript | OK |
| Copy button / button-copy-tracking-snippet | button | Copies the snippet to the clipboard, shows a toast. | ip-tracker.tsx:276-278 | client only (navigator.clipboard) | — | OK |

### Dashboard tab — online banner + stat tiles

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Online banner / banner-online ("N ongoing visits right now") | banner | Green banner shown only when at least one visitor was seen in the last 20 minutes. | ip-tracker.tsx:317-324 | GET /api/click-guard/domains/:id/online → routes.ts:4197 → click_visits WHERE domain_id=id AND visited_at >= now()-20min (server clock), count DISTINCT ip_address | SQL `SELECT count(DISTINCT ip_address) FROM click_visits WHERE visited_at >= now()-interval '20 min'` = 0 for all 7 sites = API {"count":0} (curl) | OK |
| Online now / card-stat-online-now (hint "Last 20 minutes") | stat | Number of distinct visitor IPs active in the last 20 minutes; same query as the banner. | ip-tracker.tsx:327 | same as banner | same as above | OK |
| Today / card-stat-today | stat | Visits on today's date (your computer's local day), regrouped by the client from the server's UTC hour buckets. | ip-tracker.tsx:328 | analytics hourlyVisits: GET /api/click-guard/domains/:id/analytics?start=<min(local month start, local 13-days-ago)> → routes.ts:3564 → click_visits in window, bucketed by UTC hour (routes.ts:3603-3606) | API hourlyVisits {} for window starting 2026-09-21 (curl); SQL today=0; local day 2026-10-04 | OK |
| Yesterday / card-stat-yesterday | stat | Visits on yesterday's local date, same method. | ip-tracker.tsx:329 | same | SQL `visited_at >= date_trunc('day',now())-1d AND < date_trunc('day',now())` = 0 = client calc | OK |
| Last 7 days / card-stat-last-7-days | stat | Sum of visits over the last 7 local days. | ip-tracker.tsx:330 | same | site 33: visits 2026-09-30 fall in window → 2; API totalVisits=2 for start=2026-09-21 (curl) | OK |
| This month / card-stat-this-month | stat | Visits since the 1st of the current month (local days). | ip-tracker.tsx:331 | same | month prefix 2026-10 → 0 (SQL today=0, no Oct visits) | OK |
| Total / card-stat-total (hint "All time") | stat | All visits ever recorded for the site, whatever the date. | ip-tracker.tsx:332 | GET /api/click-guard/domains stats.totalVisits → routes.ts:3491 storage.getClickVisits(id) (all time, LIMIT 1000) | site 2: API 33 = SQL count 33; site 33: API 2 = SQL 2 | OK |
| "Only the latest 1,000 visits…" note / text-visits-capped | text | Appears only when a site has ≥1,000 visits in the period; explains counts marked "+" are lower bounds. Not shown in dev (max site total = 33). | ip-tracker.tsx:335-339 | client only | — | OK |

### Dashboard tab — Daily visits chart

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Daily visits bar chart (14 bars) | chart | One bar per day for the last 14 days; hover shows the date and count. Rendered only when at least one day has visits. | ip-tracker.tsx:341-358 | same analytics hourlyVisits, regrouped to local days (ip-tracker.tsx:174-183) | site 2 hourlyVisits {"2026-09-29T23":33} → one local-day bar (Sep 29) of 33; no bar today | OK |

### Dashboard tab — All projects table

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Row per site / row-domain-{id} (Project name + domain) | link (clickable row styling) | Lists each tracked site; name falls back to the domain. | ip-tracker.tsx:375-379 | GET /api/click-guard/domains (same as select) | SQL ownership: all 12 rows user_id=1; no cross-account data | OK |
| Online cell / text-online-{id} ("Distinct IPs in the last 20 minutes") | stat | Per-site online count; each row fires its own GET …/online. | ip-tracker.tsx:223-233 | GET /api/click-guard/domains/:id/online (routes.ts:4197) | SQL last-20-min distinct IPs = 0 everywhere = API | OK |
| Total cell | stat | All-time visits for that site. | ip-tracker.tsx:381-384 | stats.totalVisits (routes.ts:3491-3503): click_visits WHERE domain_id=id, all time, LIMIT 1000 | site 2: 33=33, site 24: 2=2, site 32: 0=0 (API vs SQL) | OK |
| Unique cell | stat | Distinct visitor IPs all time for that site. | ip-tracker.tsx:385-388 | count(DISTINCT ip_address) over the same rows | site 2: API 25 = SQL 25; site 25: 2=2 | OK |
| Blocked cell | stat | How many blocked IP entries are currently active for that site. | ip-tracker.tsx:389-392 | storage.getBlockedIps: blocked_ips WHERE domain_id=id AND is_active=true | API: id24=1, id32=1, rest 0 = SQL `SELECT domain_id,count(*) FROM blocked_ips WHERE is_active GROUP BY 1` (2 total rows) | OK |

### Visitors tab — search, count, list

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| IP search / input-ip-search | input | Filters the visitor list to IPs containing what you type (client-side; resets to page 1). | ip-tracker.tsx:429-435 | client only (filter on the fetched list) | — | OK |
| "N visitors" / badge-visitor-count | count | Number of visitors after the filter — a "visitor" = one distinct IP. | ip-tracker.tsx:437-439 | GET /api/click-guard/domains/:id/visitors → routes.ts:3930 → click_visits all time (LIMIT 1000), grouped by ip_address | site 2: API returns 25 visitor objects = SQL count(DISTINCT ip_address)=25 | OK |
| Empty state "No visitors found" | empty state | Shown when the list (or filter) is empty. | ip-tracker.tsx:446-450 | client only | — | OK |
| Visitor card / card-visitor-{ip} | link (click to expand) | Click expands the card to show full details. | ip-tracker.tsx:453-506 | — | — | OK |
| IP text / text-ip-{ip} | text | The visitor's IP address. | ip-tracker.tsx:468-470 | visitors[].ipAddress | — | OK |
| "Suspicious" pill | status pill | Red pill shown if any of the visitor's visits was flagged suspicious (bot UA, high frequency, fingerprint shared across IPs, missing UA — set at track time, routes.ts:3402-3438). | ip-tracker.tsx:471-475 | visitors[].isSuspicious (OR over visits) | site 2: SQL count(*) FILTER (is_suspicious)=8 visits; API visitor objects with isSuspicious true correspond to those IPs | OK |
| "Online" pill | status pill | Green pill if the visitor's latest visit is within 20 minutes. | ip-tracker.tsx:476-480 | visitors[].isOnline (same 20-min window) | none online now (matches SQL) | OK |
| "N visits · N pages · city, country" meta | stat | Visits and page views for the IP (each tracked page load adds 1 to both, so the two numbers are always equal here), plus last-known location if any. | ip-tracker.tsx:482-494 | visitors[].visits/pageViews/city/country (last visit wins) | spot-checked 192.0.2.40: 1 visit/1 page, city null → meta omits location (render rule) | OK |
| Device/browser + time ago | text | Last device type, browser, and how long since the last visit. | ip-tracker.tsx:497-503 | lastDevice/lastBrowser/lastVisit | matches API row for 192.0.2.40 | OK |
| Expanded "System specs" (6 rows) | text | Browser, OS, device, resolution, language, timezone from the visitor's most recent visit. | ip-tracker.tsx:512-520 | GET /api/click-guard/domains/:id/visitors/:ip → routes.ts:4003 → click_visits for that IP all time, latest row's specs | curl detail for 192.0.2.40: Firefox/macOS/desktop/1440x900/en-US/America-Denver = SQL row values | OK |
| Expanded "Identity" (IP, Computer ID, First/Last visit, Total visits) | text | Identity and first/last-seen times for the IP. | ip-tracker.tsx:522-529 | same endpoint (totalVisits = row count for that IP) | 192.0.2.40: totalVisits 1 = SQL count for that IP | OK |
| Expanded "Geolocation" (city/country) | text | Location from Cloudflare headers on the latest visit; whole section hidden when no country. | ip-tracker.tsx:531-539 | same endpoint geo.{country,city} | all dev visits predate geo → null → section hidden; note text (text-geo-source-note, ip-tracker.tsx:738) matches: edgeGeo reads cf-ipcountry/cf-ipcity only (route-guards.ts:24-31) | OK |
| Expanded "Recent activity" list / activity-{id} | text | Up to 50 most recent visits for this IP with time, referrer, landing page, suspicious flag. | ip-tracker.tsx:543-562 | recentActivity = visitorVisits.slice(0,50) (routes.ts:4048-4056) | 192.0.2.40 shows 1 activity row = SQL count for the IP | OK |
| Expanded "User agent" block | text | The full user-agent string of the latest visit. | ip-tracker.tsx:565-572 | systemSpecs.userAgent | matches | OK |
| Prev / button-prev-page, Next / button-next-page + "Page x / y" | button | Client-side pagination, 20 visitors per page. | ip-tracker.tsx:582-593 | client only | — | OK |

### Traffic tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Range note / text-traffic-range ("Visits since <date>." / "Latest 1,000 visits since …") | text | States the window the numbers cover — earliest of local month-start and 13 days ago (today: Sep 21, shown as "Oct 1" month logic aside, the actual since = 2026-09-21 local). | ip-tracker.tsx:605-607 | same analytics window | client computes since = min(local month start, 13d ago) = 2026-09-21; API called with that start | OK |
| Total sources / card-stat-total-sources | stat | How many different referring domains sent visits in the window. | ip-tracker.tsx:609 | analytics.trafficSources length → routes.ts:3622-3648: referrer hostname (www. stripped) or "NO REFERRER DATA", grouped from click_visits in window | site 2 (start 2026-09-21): 4 sources = SQL distinct referrers (bing 21, google 10, none 1, m.facebook.com 1) | OK |
| Total page loads / card-stat-total-page-loads | stat | Sum of visits attributed to a referrer in the window (every visit counts as one page load). | ip-tracker.tsx:610 | sum of trafficSources[].pageLoads | site 2: 21+10+1+1 = 33 = SQL count in window | OK |
| Unique visitors / card-stat-unique-visitors | stat | Sum of per-source distinct IP counts. Note: an IP that came from two sources is counted once per source, so this is "unique per source" added up, not a true site-wide unique count (today both happen to be 25 for site 2; SQL confirms no IP has >1 referrer there now). | ip-tracker.tsx:611 | sum of per-source Set sizes (routes.ts:3638) | SQL: 21+2+1+1 = 25 = count(DISTINCT ip_address)=25 for domain 2 | OK |
| Source rows / row-source-{i} (Source, Page loads, Visitors, Share bar) | table row | One row per referrer: hostname, its visit count, its distinct-IP count, and its share of all visits (server-rounded %, routes.ts:3646). "NO REFERRER DATA" rows render italic. | ip-tracker.tsx:630-651 | same trafficSources | API site 2: bing 63.64%, google 30.3%, NO REFERRER 3.03%, m.facebook.com 3.03%; 21/33=63.6%… matches SQL referrer counts | OK |

### Pages tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Total pages / card-stat-total-pages | stat | Number of distinct landing pages visited (all time — no date window is sent). | ip-tracker.tsx:671 | GET /api/click-guard/domains/:id/pages → routes.ts:4064 → click_visits all time grouped by landing_page | site 2: API 5 pages = SQL `GROUP BY landing_page` 5 rows | OK |
| Total hits / card-stat-total-hits | stat | Sum of hits over all pages. | ip-tracker.tsx:672 | same, sum of hits | site 2: 21+7+3+1+1 = 33 = SQL count | OK |
| Page rows / row-page-{i} (URL, Hits, Unique visitors, Share bar) | table row | One row per page: hits, distinct IPs, share bar (client-computed % of hits). | ip-tracker.tsx:696-711 | same endpoint; uniqueVisitors = count(DISTINCT ip) per page | API site 2 rows match SQL exactly (siding 21/21, roofing 7/1, roofing?gclid=QA 3/1, / 1/1, contact 1/1) | OK |

### Geo tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Countries / button-geo-countries, Cities / button-geo-cities | tab | Switch between the country table and the city table. | ip-tracker.tsx:735-736 | client only | — | OK |
| Source note / text-geo-source-note | text | Explains locations come from Cloudflare and older visits show Unknown. True: geo only from CF headers (route-guards.ts:24-31), all dev visits have NULL country/city. | ip-tracker.tsx:738 | — | SQL: country IS NULL for all click_visits rows | OK |
| Geo rows / row-geo-{i} (Location, Visits, Visitors, Share) | table row | One row per country or "City, Country": visits, distinct IPs, share (server toFixed(1)). "Unknown, Unknown" is the fallback bucket. | ip-tracker.tsx:757-780 | GET /api/click-guard/domains/:id/geo → routes.ts:4103 → click_visits all time grouped by country/city | API site 2: 1 country "Unknown" 33/25 "100.0" = SQL (all NULL) | OK |

### Platforms tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Browsers section rows (name, count, %) | stat list | Browser shares, sorted most-used first, all time. | ip-tracker.tsx:796-826, 834 | GET /api/click-guard/domains/:id/platforms → routes.ts:4158 → click_visits all time, "Unknown" fallback | site 2 API {Firefox:21, Chrome:10, Other:1, Safari:1} = SQL browser counts (21/10/0/… + nulls→Other/Safari from rows) | OK |
| Operating systems section rows | stat list | OS shares, same method. | ip-tracker.tsx:835 | same | {macOS:21, Windows:10, Linux:1, iOS:1} matches SQL | OK |
| Devices section rows | stat list | Device-type shares (desktop/mobile/tablet/Unknown), same method. | ip-tracker.tsx:836 | same | {desktop:32, mobile:1} matches SQL | OK |
| Screen resolutions section rows | stat list | Screen-size shares, same method. | ip-tracker.tsx:837 | same | {1440x900:21, 1920x1080:10, Unknown:1, 390x844:1} matches SQL | OK |

### Shared presentational primitives (from client/src/components/app-ui.tsx)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| AppPage / PageHeader / Section / Stat / StatGrid / StatusPill / Notice | layout primitives | Page chrome: page wrapper, header with actions, titled section card, stat tile (label/value/hint/testid), responsive grid, neutral pill, info notice. No data logic of their own. | app-ui.tsx:79, 99, 148, 175, 197, 294 (+StatusPill) | client only | read source | OK |

## client/src/pages/vpn-shield.tsx — route /vpn-shield

Registered in client/src/App.tsx:219 (signed-in `DashboardRouter`) and App.tsx:314 (signed-out, `withRibbon`). Same access model as IP Tracker: any signed-in user can open it; every API checks the site belongs to you (`domain.userId !== user.id` → 404, routes.ts:4454/4512/4668). Page purpose: review visits flagged as possible VPN/proxy traffic per site and choose what the browser script does to flagged visitors (overlay / just log / redirect). Main data source: same `tracked_domains` list plus `vpn_visits` (one row per detection, `action` = what the site's mode did at the time).

### Page header (vpn-shield)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "VPN Shield" title / text-vpn-page-title | text | Page title. | vpn-shield.tsx:608 | client only | App.tsx:219 route exists (curl /vpn-shield 200) | OK |
| Subtitle / text-vpn-subtitle | text | Warns overlays can be bypassed and may hit legitimate visitors. | vpn-shield.tsx:609 | client only | — | OK |
| Site pill / badge-vpn-shield | status pill | Name of the site being viewed. | vpn-shield.tsx:610-614 | same list as select | — | OK |
| Site select / select-vpn-shield-domain | select | Picks the site (?site= in URL); defaults to newest site (id 33). | vpn-shield.tsx:619-629 | GET /api/vpn-shield/domains → routes.ts:4423 → storage.getTrackedDomains(user.id) + per-site getVpnVisits count/distinct IP | API order [33,32,26,25,24,23,15,10,9,8,3,2] = SQL; vpnStats site 8 {totalBlocks:9, uniqueVpnIps:1} = SQL count 9 / distinct 1 | OK |

### Tab bar (4 tabs) + no-site card

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Overview / tab-vpn-overview | tab | Stats and top lists for the selected site. | vpn-shield.tsx:638-650 | — | client state (?tab=) | OK |
| Flagged visits / tab-vpn-blocked | tab | Every recorded VPN/proxy detection with details. | vpn-shield.tsx:638-650 | — | — | OK |
| Install script / tab-vpn-install | tab | The script tag to add to your site + how detection works. | vpn-shield.tsx:638-650 | — | — | OK |
| Settings / tab-vpn-settings | tab | Block mode, redirect URL, IP whitelist for the selected site. | vpn-shield.tsx:638-650 | — | — | OK |
| No-site card / card-vpn-no-site | empty state | Shown when you track no sites yet; points you to add one. | vpn-shield.tsx:99-111 | client only | — | OK |
| "IP Tracker" link / link-vpn-add-site-ip-tracker | link | Goes to /ip-tracker, where sites are added. | vpn-shield.tsx:106 | client only | route exists App.tsx:203; curl /ip-tracker 200 | OK |
| "Google Click Guard" link / link-vpn-add-site-click-guard | link | Goes to /google-ads (Click Guard). | vpn-shield.tsx:108 | client only | route exists App.tsx:193; curl /google-ads 200 | OK |

### Overview tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Crawler notice / text-crawler-notice | notice | Says Google/Bing/Yahoo crawlers are exempted by user-agent matching and that can be spoofed. True: CRAWLER_PATTERNS checked both in the script (routes.ts:4554) and server-side (routes.ts:4343). | vpn-shield.tsx:149-155 | — | read routes.ts:4238-4243, 4343-4345 | OK |
| Detections / card-stat-detections (hint "All time, any action") | stat | All VPN/proxy detections ever for the site, whatever action was taken. | vpn-shield.tsx:158-160 | GET /api/vpn-shield/domains/:id/stats → routes.ts:4448 → vpn_visits WHERE domain_id=id (all time), total = row count | site 8: API total 9 = SQL count 9; default site 33: 0 = SQL 0 | OK |
| Detections today / card-stat-detections-today | stat | Detections since midnight SERVER-LOCAL time (routes.ts:4458), any action. Today that is 0 for every site (no visits since 2026-09-30). | vpn-shield.tsx:161-162 | stats.today: visited_at >= server-local midnight | SQL `count(*) FILTER (visited_at >= date_trunc('day',now()))` = 0 for all = API today 0 | OK |
| Blocked / card-stat-blocked (hint "Overlay shown") | stat | Of all detections, how many got action="block" (the site was in block mode so the overlay was shown). Client counts action==='block' rows from the blocked-visits list. | vpn-shield.tsx:163-165 | GET /api/vpn-shield/domains/:id/blocked-visits → routes.ts:4506 → all vpn_visits rows; client filters action | site 8: API 9 rows, 4 with action=block = SQL `count(*) FILTER (action='block')` = 4; site 2: 2 of 24 | OK |
| Unique VPN IPs / card-stat-unique-vpn-ips (hint "All time") | stat | Distinct IPs ever flagged on this site. | vpn-shield.tsx:166-168 | stats.uniqueIps = count(DISTINCT ip_address) all time | site 8: 1 = SQL 1; site 2: 24 = SQL 24 | OK |
| Top VPN providers section rows | stat list | Up to 8 provider names by detection count (all time); "Unknown VPN/Proxy" when the IP only matched datacenter ranges or heuristics (provider identified by IP prefix list, routes.ts:4286-4310). | vpn-shield.tsx:171-182 | stats.topProviders (server sorts, top 10) | site 8: [{Unknown VPN/Proxy, 9}] = SQL `GROUP BY vpn_provider` | OK |
| Top countries section rows + note / text-countries-source-note | stat list | Up to 8 countries by detection count; "Unknown" when the visit has no Cloudflare geo. Note correctly states the source. | vpn-shield.tsx:183-193 | stats.topCountries from vpn_visits.country (null→"Unknown") | site 8: all NULL → "Unknown" 9 = SQL | OK |

### Flagged visits tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| IP search / input-vpn-ip-search | input | Filters the detection list by IP text (client-side, resets page). | vpn-shield.tsx:220-226 | client only | — | OK |
| "N flagged visits · M blocked" / badge-vpn-visit-count | count | Total detections after the filter, and how many of those were blocked. | vpn-shield.tsx:228-231 | same blocked-visits list | site 8: "9 flagged visits · 4 blocked" (API rows) | OK |
| Empty state / text-no-vpn-visits | empty state | Shown when there are no detections (default site 33 shows this now). | vpn-shield.tsx:239-242 | client only | — | OK |
| Visit card / card-vpn-visit-{id} | link (click to expand) | One card per detection; click expands details. | vpn-shield.tsx:245-304 | GET /api/vpn-shield/domains/:id/blocked-visits (routes.ts:4506) | 9 cards for site 8 = SQL count | OK |
| IP text / text-vpn-ip-{id} | text | The flagged IP (dev data: all 127.0.0.1 from local QA runs). | vpn-shield.tsx:259-261 | vpn_visits.ip_address | — | OK |
| Provider pill (e.g. "Unknown VPN/Proxy") | status pill | Matched VPN provider, shown when known. | vpn-shield.tsx:262-266 | vpnProvider | — | OK |
| Detection-method pill | status pill | How it was flagged (e.g. "Known VPN provider: NordVPN; WebRTC IP leak detected" — joined methods string). | vpn-shield.tsx:267-269 | detectionMethod | row 27-30 action=block etc. — methods string from routes.ts:4353-4383 | OK |
| Action pill / badge-vpn-action-{id} | status pill | What the site's mode did: Blocked (amber) / Redirected / Logged only. | vpn-shield.tsx:270-279 | action → ACTION_LABELS (vpn-shield.tsx:94) | site 8 rows: 4 Blocked, 2 Redirected, 3 Logged only = SQL action counts | OK |
| Fingerprint/location/time meta | text | First 12 chars of the device fingerprint, city/country, and how long ago. | vpn-shield.tsx:281-295 | fingerprint/city/country/visitedAt | — | OK |
| Device + browser (sm) | text | Device type icon and browser of the detection. | vpn-shield.tsx:298-301 | deviceType/browser | — | OK |
| Expanded "Detection details" (IP, provider, method, action, fingerprint, time) | text | Full detection record for the visit. | vpn-shield.tsx:310-317 | same row | — | OK |
| Expanded "Visitor details" (browser, OS, device, country, city, landing page, referrer) + user agent | text | Everything the browser script sent (visitor details are from the detection payload itself, all time values as recorded). | vpn-shield.tsx:318-335 | same row | — | OK |
| Prev / button-vpn-prev-page, Next / button-vpn-next-page | button | Client pagination, 20 per page. | vpn-shield.tsx:344-355 | client only | — | OK |

### Install script tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Site select / select-vpn-domain | select | Same site picker as the header (same ?site= state). | vpn-shield.tsx:387-396 | client only | — | OK |
| Snippet / text-vpn-script-code | text | The script tag to paste on your site: `<!-- VPN Shield by ConstructHUB -->\n<script src="<origin>/api/vpn-shield/script/<trackingId>" async></script>`; origin from /api/public-config (http://localhost:8303 in dev). | vpn-shield.tsx:369-371, 407 | GET /api/vpn-shield/script/:trackingId → routes.ts:4545 → serves the detection JS, which POSTs to /api/vpn-shield/track (routes.ts:4327: crawler/whitelist bypass → IP-prefix provider/datacenter match + WebRTC-leak + extension signals → if detected, INSERT vpn_visits with action = site's vpnBlockMode, and reply blocked/redirect for the overlay) | curl -sI script URL → 200 application/javascript; POST /track insert shape read at routes.ts:4391-4406 | OK |
| Copy button / button-copy-vpn-script | button | Copies the snippet; toast confirms. | vpn-shield.tsx:410-418 | client only | — | OK |
| "How detection works" — WebRTC item / text-detection-webrtc | text | Says WebRTC differences are one possible signal. True: server flags a leak only when a public WebRTC IP differs from the request IP (routes.ts:4372-4378). | vpn-shield.tsx:426-429 | — | read code | OK |
| "How detection works" — Timezone/geo mismatch item / text-detection-timezone | text | Says timezone differences are used as a heuristic. STALE: the current script never sends a timezone signal (it sends only vpnExtension + webrtcIps, routes.ts:4646) and the server explicitly ignores the old timezoneMismatch signal (routes.ts:4369-4371 "The old boolean webrtcLeak / timezoneMismatch signals … are ignored"). | vpn-shield.tsx:430-433 | — | code evidence above | BUG |
| "How detection works" — Datacenter IP ranges item / text-detection-datacenter | text | Says a built-in list of datacenter IP prefixes is checked and may be incomplete. True: DATACENTER_CIDRS prefix match (routes.ts:4245-4284). | vpn-shield.tsx:434-437 | — | read code | OK |
| "How detection works" — VPN extension item / text-detection-extensions | text | Says browser-reported extension indicators are used when available. True: checkVpnExtensions → vpnSignals.vpnExtension → server flag (routes.ts:4379-4382). | vpn-shield.tsx:438-441 | — | read code | OK |

### Settings tab

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Block mode radios / option-mode-block, option-mode-log, option-mode-redirect | input (radio) | Chooses what the browser script does with flagged visitors: Block = overlay, Log only = record, Redirect = send to a URL. The saved default when nothing was saved is "block" (routes.ts:4687). | vpn-shield.tsx:496-521 | values block/log/redirect — exactly the server's zod enum (routes.ts:4671) | verified by code | OK |
| Redirect URL input / input-redirect-url (+ error / text-redirect-url-error) | input | Shown only in Redirect mode. Client requires a full http(s):// link before saving; server enforces the same (routes.ts:4678-4683). | vpn-shield.tsx:525-538 | sent as vpnRedirectUrl; server trims, validates safeRedirectUrl, stores sanitized URL (empty clears) | verified by code | OK |
| Whitelisted IPs textarea / textarea-whitelisted-ips (+ error / text-whitelist-error) | input | One IP per line (commas also work) that are never blocked. Client validates each is a single IPv4/IPv6 (net.isIP-equivalent, vpn-shield.tsx:448-455) and caps at 500 — server enforces the identical rules (routes.ts:4684-4687). | vpn-shield.tsx:540-554 | sent as vpnWhitelistedIps; server splits on newlines/commas, validates each with net.isIP, 400s over 500 | verified by code | OK |
| Hidden redirect error / text-redirect-url-error-hidden | text | If a previously-saved redirect URL is invalid and you're not in Redirect mode, Save is disabled with the message "… Switch to Redirect to fix or clear it." (Sites 2 and 3 in dev carry the saved value "not a url" from QA runs and would hit this.) Server would also refuse such a save, so client and server agree. | vpn-shield.tsx:572-574 | server: `if (vpnRedirectUrl && !safeRedirectUrl(...)) 400` regardless of mode (routes.ts:4681) | read code + dev data settings json | OK |
| Crawler-whitelist notice / text-settings-crawler-whitelist | text | Lists crawler user agents that are exempted and that UA strings can be spoofed. Matches CRAWLER_PATTERNS (Googlebot, Bingbot, Slurp, DuckDuckBot, Baiduspider, YandexBot, etc., routes.ts:4238-4243). | vpn-shield.tsx:556-562 | — | read code | OK |
| Save settings / button-save-vpn-settings | button | Saves mode/redirect/whitelist for the selected site into its settings JSON, then toast "Settings saved". Disabled with no site, while saving, or on any validation error. | vpn-shield.tsx:565-571 | POST /api/vpn-shield/domains/:id/settings body {vpnBlockMode, vpnRedirectUrl, vpnWhitelistedIps} → routes.ts:4662 → ownership 404 → zod parse → validations → UPDATE tracked_domains SET settings = merged jsonb | method/path/body match (verified by code; POST not executed per read-only rule) | OK |
| "Applies to <site>" / text-settings-site (or "Add a site to save settings." / text-settings-no-site) | text | Says which site the form writes to. | vpn-shield.tsx:575-579 | client only | — | OK |

### Shared presentational primitives (vpn-shield)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| AppPage / PageHeader / Section / Stat / StatGrid / StatusPill / Notice | layout primitives | Same shared chrome as IP Tracker (app-ui.tsx). | app-ui.tsx:79, 99, 148, 175, 197, 294 | client only | read source | OK |

## Suspected bugs

1. **vpn-shield.tsx · "How detection works" — "Timezone / geo mismatch" item (text-detection-timezone, vpn-shield.tsx:431-432)** · What the owner sees: the Install-script tab states timezone/geo mismatch is one of four VPN detection methods, with copy implying it can flag ordinary visitors ("travel and device settings can also cause mismatches") · What is actually true: the shipped script (GET /api/vpn-shield/script/:trackingId, routes.ts:4642-4651) sends only `{vpnExtension, webrtcIps}`; it never sends a timezone signal, and the server explicitly discards the old `timezoneMismatch` boolean — routes.ts:4369-4371: "The old boolean webrtcLeak / timezoneMismatch signals (still sent by cached copies of the previous script) are ignored: they flagged ordinary visitors." So this "detection method" can never fire · Evidence: code quotes above; curl of the live script confirms the signals payload · Root cause: stale marketing copy in vpn-shield.tsx:430-433 after the detection rewrite · Smallest fix: delete the timezone/geo-mismatch list item (or rewrite it to say timezone is NOT used because it falsely flags ordinary visitors).

## Notes / non-bugs found during verification

- Orphan data: `vpn_visits` rows exist for domain_ids 30 and 35, whose `tracked_domains` rows no longer exist (SQL: 2 rows). They never appear in either UI (every query starts from the caller's tracked_domains), but they are dead weight; the delete path (storage.ts:652-660) does cascade, so these likely predate it.
- All dev sites are QA fixtures with junk names/domains ("not a domain!! <b>x</b>", saved settings "not a url"); they render verbatim. That is test data, not page bugs — the Add-site flow validates domains server-side (normalizeTrackedDomain, routes.ts:3519).
- IP Tracker "This month"/"Today"/"Yesterday" use the viewer's local day rebuilt from server UTC hour buckets (exact for whole-hour offsets; documented 30-min caveat at ip-tracker.tsx:169-173). VPN Shield "Detections today" uses server-local midnight (routes.ts:4458) — consistent in this deployment (server = America/New_York) but would shift for a server hosted in a different zone than the viewer.
- Traffic tab "Unique visitors" is the sum of per-source distinct IPs (can double-count an IP that arrived via two sources); with dev data it equals the true distinct count (25 for site 2 — SQL confirmed no IP has >1 referrer today). Flagged here for awareness; not counted as a bug since no wrong number is demonstrable on current data.
- POSTs (add site, remove site, save settings) were verified by matching method/path/body against the server code only; they were NOT executed, per the read-only rule.

---


## domains.tsx — route /domains

Registered in client/src/App.tsx:182 (`<Route path="/domains" component={DomainsPage} />`); "/domains" is in the `SIGNED_IN_ONLY` guard list (App.tsx:339), so it needs a signed-in user. Server-side, every `/api/domains/*` route except `GET /saved-connections` and `POST /disconnect` passes `requireModule("domainsMailAlerts")` (server/domains/routes.ts:41-50, server/entitlements.ts) — a 402 `plan_required` card renders instead of the page content if the plan lacks the module. Dev user 1 has accessPlan "agency" (verified via `GET /api/entitlements` → `"accessPlan":"agency"`), so the full page renders.

The page is for: connecting a registrar API key (Porkbun / Name.com), tracking a domain inventory (manual or synced), mapping domains to client locations, previewing DNS/nameserver changes with a confirm step, and reading registrar how-to guides. Main data source: `managed_domains` / `domain_connections` / `domain_jobs` / `business_locations` (all scoped `user_id=$1`; server/domains/schema.ts). Dev DB state for user 1: 3 managed_domains (ids 6010/6011/6013, all registrar='manual', state/checked_at/location_id NULL), 0 domain_connections, 0 domain_jobs, 2 business_locations (104296 "K- Social workbench fixture", 506025 "AI-TEST Ridgeline Roofing", both website=''). Only user 1 has rows in managed_domains/domain_connections/domain_jobs (other orgs: user 2328 has 1 business_location, no domain data).

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Domains" title + description "Watch client domains, expiry and DNS — registration stays with your registrar." | text | Names the page; static copy. | client/src/pages/domains.tsx:107-119 (PageHeader) | client only | Read | OK |
| "Provider mail alerts →" (data-testid `link-domains-mail-alerts`) | link | Goes to the Mail Alerts page (a private forwarding address for registrar/provider alert emails). | client/src/pages/domains.tsx:112-116 | client only: wouter Link to /mail-alerts (route exists App.tsx:183) | curl http://127.0.0.1:8303/mail-alerts → 200; route in App.tsx | OK |

### Plan gate (renders only when the API answers 402 plan_required)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| PlanRequired card (data-testid `plan-required-domainsMailAlerts`), message, "What it does" details, price line, "See plans and pricing" (/pricing) or "Update card" (/settings?tab=billing when paymentNeeded), SavedConnections list with Disconnect buttons | card / link / button | Shown instead of the tools when the plan doesn't include Domains + alerts; offers upgrade or card fix, and lets the user remove previously saved registrar keys. | client/src/pages/domains.tsx:120-131; client/src/components/plan-required.tsx:136-182 | The 402 body comes from requireModule("domainsMailAlerts") on /api/domains (server/domains/routes.ts:41-50); disconnect/list exempted (routes.ts:42-44) | Code read; not reachable for user 1 (agency plan) | OK |

### Error / notice / worker-warning banners (conditional, above all sections)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Red error Notice (operation failure text) | status pill (notice) | Shows the error message when a domain action (connect/sync/add/monitor/map/preview/confirm/rollback) fails. | client/src/pages/domains.tsx:135 (Notice from app-ui.tsx:294) | client only: set by apiErrorMessage of the failed POST | Code read | OK |
| Neutral "Saved…" Notice | status pill (notice) | Shows after a successful POST; text is "Preview jobs queued…" when the response has `jobs`, else "Saved. Background work will appear below." | client/src/pages/domains.tsx:89-93,136 | client only | Code read | BUG (see Suspected bugs #1: for /manual and /mapping no background work is ever queued) |
| Orange warning "Domain background processing is off. Your administrator must enable it before queued previews, changes and monitoring can run." | status pill (notice) | Warns that the background worker that runs previews/changes/monitoring is disabled. | client/src/pages/domains.tsx:137-142 | GET /api/domains/guides → `workerEnabled: process.env.DOMAINS_WORKER_ENABLED === "true"` (server/domains/routes.ts:84) | curl /api/domains/guides → `"workerEnabled":false` matches env (worker off in dev) | OK |

### Section: Connect registrar

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Registrar" select (Porkbun / Name.com CORE) | select | Chooses which registrar the API key belongs to; switches the key field label between "API key" and "Username". | client/src/pages/domains.tsx:157-168 | client only (sent with the form) | Code read | OK |
| "Connection label" input (required) | input | Free-text name for this key, e.g. which client/account it belongs to. | client/src/pages/domains.tsx:169-179 | client only | Code read | OK |
| "API key" / "Username" password input (required) | input | The registrar API key (Porkbun) or account username (Name.com). | client/src/pages/domains.tsx:180-194 | client only | Code read | OK |
| "Secret / API token" password input (required) | input | The registrar API secret/token, paired with the key above. | client/src/pages/domains.tsx:195-207 | client only | Code read | OK |
| "Connect Porkbun" / "Connect Name.com" button | button | Saves the encrypted key and queues a job that imports the domain inventory from the registrar. Clears the two password boxes on success. | client/src/pages/domains.tsx:208-210,149-155 | POST /api/domains/connections body {provider,label,key,secret} → server/domains/routes.ts:158 → saveConnection (server/domains/service.ts:67-82): INSERT domain_connections(user_id,provider,label,credentials=encryptToken({key,secret})) + enqueue "discover" job → domain_jobs; 201. requireRecentAuth first (routes.ts:168) | Code: method/path/body match zod schema routes.ts:159-167 | OK |
| Connection chips "{label} · {provider}" | badge | Lists the registrar keys already connected (this page of them). | client/src/pages/domains.tsx:212-221 | GET /api/domains/connections?page=N → SELECT id,provider,label,created_at FROM domain_connections WHERE user_id=$1 AND label ILIKE '%q%' ORDER BY id DESC LIMIT 25 (routes.ts:150-157) | SQL: SELECT count(*) FROM domain_connections WHERE user_id=1 → 0 = API items [] | OK |
| "Sync connections" button | button | Re-imports the domain inventory from every connected registrar key shown on this page. | client/src/pages/domains.tsx:223-236 | POST /api/domains/sync body {connectionIds:[...all ids on page]} → routes.ts:182-194: verifies ownership (404 otherwise), enqueue(user,"discover",{},undefined,connectionId) per key → domain_jobs; 202 {jobs} | Code: endpoint exists, body matches zod (routes.ts:183) | OK |
| "Previous connections" button | button | Goes to the previous page of connected keys. | client/src/pages/domains.tsx:237-244 | client only | Code read | OK |
| "Next connections" button | button | Goes to the next page of connected keys (server page size is 25). | client/src/pages/domains.tsx:245-252 | client only (disabled when fewer than 25 items) | Code read | OK |

### Section: Add domains

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Manual domains" input (required) | input | Type one or more domains (comma/space separated, up to 100) to track even though the registrar isn't connected. | client/src/pages/domains.tsx:284-296 | client only | Code read | OK |
| "Add domains" button | button | Validates the names in the browser, then saves them to the inventory and auto-links them to a client location whose website matches. | client/src/pages/domains.tsx:297-299,261-282 | POST /api/domains/manual body {domains:[...]} → routes.ts:195-211: zod domainName regex (types.ts:3-8, mirrors client pattern domains.tsx:25), INSERT managed_domains(user_id,domain,registrar='manual') ON CONFLICT(user_id,domain) DO NOTHING, then autoMapDomains (service.ts:173-182: matches business_locations.website host to domain, only when exactly one match); 201 {added:n} | Code: endpoint + body match; no worker job queued by this route | OK (copy caveat → bug #1) |
| Client-side validation error ("Enter at least one domain…", "Not a valid domain name: …", "Add up to 100 domains at a time.") | status pill (text) | Names the bad entries without a server round trip. | client/src/pages/domains.tsx:266-279,301-305 | client only | Code read | OK |

### Section: Domain inventory (data-testid `section-domain-inventory`)

Intro: the searchable, filterable list of every domain this account tracks. "Page X · N domains" is the only number on the page; N = `total` from GET /api/domains (all-time count, no time window, scoped `user_id=$1`).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search domains" input (Toolbar search) | filter | Filters the inventory (and, same text, the jobs list below) by domain name as you type. | client/src/pages/domains.tsx:313-323; app-ui.tsx:250-260 | client only; becomes q param: GET /api/domains?q=…&page=1&registrar=… | Code read | OK |
| "Filter registrar" select (All registrars / porkbun / namecom / manual / squarespace / wix / hover) | filter | Shows only domains from one registrar. | client/src/pages/domains.tsx:325-348 | GET /api/domains?…&registrar=v → WHERE registrar=$3 (routes.ts:87-103) | API: registrar=manual → total 3 = SQL count WHERE user_id=1 AND registrar='manual' → 3 | OK |
| Mobile "Filters (N)" sheet button (data-testid `button-toolbar-filters`) + bottom sheet | button | Phones: opens the same registrar filter in a bottom sheet. | app-ui.tsx:261-276 (used by domains.tsx:325-348) | client only | Code read | OK |
| "Select page" checkbox | input | Ticks every domain on the current page (unticks all). | client/src/pages/domains.tsx:351-370 | client only | Code read | OK |
| "{n} selected" count | count | Shows how many domains are ticked; drives the enabled state of Check/Map/Preview buttons. | client/src/pages/domains.tsx:371-375 | client only | Code read | OK |
| "Check selected domains" button | button | Asks the monitor to re-check the ticked domains' DNS/expiry sooner (sets their next check to now). | client/src/pages/domains.tsx:377-384 | POST /api/domains/monitor body {ids:[…]} → routes.ts:234-242: ownedDomains ownership check (404), UPDATE managed_domains SET next_check=now() WHERE user_id=$1 AND id=ANY(ids); 202 | Code: endpoint + body match | OK |
| "Find client location" input | filter | Searches your client locations by name or website to fill the mapping dropdown. | client/src/pages/domains.tsx:386-395 | client only; becomes q → GET /api/domains/locations?q=…&page=N | Code read | OK |
| "Client location" select ("Unmapped" + "{business_name} · {website or No website}") | select | Chooses the client to attach the ticked domains to ("Unmapped" clears the link). | client/src/pages/domains.tsx:396-408 | Options from GET /api/domains/locations → SELECT id,business_name,website FROM business_locations WHERE user_id=$1 AND (business_name ILIKE $2 OR website ILIKE $2) ORDER BY id LIMIT 25 (routes.ts:104-111) | SQL: SELECT count(*) FROM business_locations WHERE user_id=1 → 2 = API items (2); other org user 2328 has 1 location, not returned | OK |
| "Previous clients" / "Next clients" buttons | button | Pages the client-location dropdown (25 per page). | client/src/pages/domains.tsx:409-426 | client only | Code read | OK |
| "Map selected to client" button | button | Links the ticked domains to the chosen client (or unlinks with "Unmapped"). | client/src/pages/domains.tsx:427-439 | POST /api/domains/mapping body {ids:[…], locationId:number|null} → routes.ts:212-233: ownedDomains check, location ownership check (404 "Location not found"), UPDATE managed_domains SET location_id WHERE user_id=$1 AND id=ANY(ids); {ok:true} | Code: endpoint + body match zod (routes.ts:213-219) | OK (copy caveat → bug #1) |
| Row checkbox "Select {domain}" | input | Ticks one domain for check/map/preview actions. | client/src/pages/domains.tsx:470-477 | client only | Code read | OK |
| Row "Domain" cell + nameservers line | text | Shows the domain name; under it the current nameservers, or "Nameservers not yet checked" if never checked. | client/src/pages/domains.tsx:478-484 | GET /api/domains → state - 'records' AS state (jsonb) from managed_domains (routes.ts:93); state NULL in DB → fallback text | API rows for user 1: state null for all 3 → fallback; matches SQL (state IS NULL) | OK |
| Row "Registrar" cell | text | Which registrar the domain is tracked under (manual / porkbun / …). | client/src/pages/domains.tsx:485-490 | GET /api/domains → managed_domains.registrar | API shows "manual" ×3 = SQL SELECT registrar FROM managed_domains WHERE user_id=1 | OK |
| Row "Client location" cell ("Unmapped" or the raw location id) | text / link | Shows which client the domain is mapped to. | client/src/pages/domains.tsx:491-496 | GET /api/domains → managed_domains.location_id; fallback "Unmapped" when null | API: all 3 rows location_id null → "Unmapped"; matches SQL | BUG (see Suspected bugs #2: a mapped domain shows the raw integer id, e.g. "104296", not the client name) |
| Row "Expiry / auto-renew" cell ("Unknown" or date + On/Off/Unknown) | text | Shows when the domain expires and whether auto-renew is on, once a registrar/check has reported it. | client/src/pages/domains.tsx:497-509 | state.expires / state.autoRenew from managed_domains.state jsonb | API: state null → "Unknown / Unknown"; matches SQL | OK |
| Row "Last DNS check" cell ("Never" or local date-time) | text | When the domain's DNS/expiry was last checked (local browser time). | client/src/pages/domains.tsx:510-516 | managed_domains.checked_at (set by monitor, service.ts:339) | API: checked_at null → "Never"; matches SQL (checked_at IS NULL for all 3) | OK |
| "Could not load domains." notice / "Loading domains…" / "No domains found. Connect a registrar or add domains above." | status pill / text | Error, spinner-text and empty state for the inventory list. | client/src/pages/domains.tsx:443-445,521-525 | client only | Code read | OK |
| "Previous domains" button | button | Previous page of the inventory (25 per page). | client/src/pages/domains.tsx:528-538 | client only | Code read | OK |
| "Page {page} · {total} domains" count | count | Current page and total number of domains tracked (all time, this account only). | client/src/pages/domains.tsx:539-541 | GET /api/domains → SELECT count(*)::int total FROM managed_domains WHERE user_id=$1 AND domain ILIKE … AND registrar… AND location_id… (routes.ts:96-101); no time window | SQL: SELECT count(*) FROM managed_domains WHERE user_id=1 → 3 = API total 3; cross-check GROUP BY user_id: only user 1 has rows | OK |
| "Next domains" button | button | Next page of the inventory; disabled on the last page. | client/src/pages/domains.tsx:542-552 | client only | Code read | OK |

### Section: Nameservers for selected domains

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Warning paragraph ("Copy website and email records first…") | text | Caution that changing nameservers can interrupt the website and email. | client/src/pages/domains.tsx:561-564 | client only | Code read | OK |
| "Nameservers" input | input | Comma-separated list of nameservers to preview for the ticked domains (server requires 2–6 unique). | client/src/pages/domains.tsx:565-570 | sent in POST body below | Code read | OK |
| "Preview nameservers" button | button | Queues a background job that fetches the current DNS and builds a before/after preview for the ticked domains. | client/src/pages/domains.tsx:572-586 | POST /api/domains/preview body {ids:[…], change:{kind:"nameservers", nameservers:[…]}} → routes.ts:243-249 → service.preview (service.ts:192-209): rejects manual domains (400 "Manual domains must be changed at the registrar."), enqueues domain_jobs kind='change' status='previewing'; 202 {jobs:[uuid…]} | Code: endpoint + body match changeInput (types.ts:42-56, min 2 nameservers) | OK |
| "Preview assigned Cloudflare pair" button | button | Looks up the Cloudflare nameservers already assigned to each ticked domain (via the linked Cloudflare account) and queues previews to point the domains at them. | client/src/pages/domains.tsx:587-593 | POST /api/domains/cloudflare-preview body {ids:[…]} → routes.ts:250-270: ownedDomains, then cf(userId).zoneNameservers(domain) per domain (cloudflare-link.ts); 409 "Cloudflare zone link is not configured…" if unlinked; enqueues nameserver previews; 202 {jobs} | Code: endpoint + body match | OK |

### Section: DNS record change

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Warning paragraph ("Applies to every selected domain. Cloudflare-hosted zones are managed in Cloudflare.") | text | Notes the change hits all ticked domains and Cloudflare-delegated zones are off-limits (server enforces: types.ts:106-109). | client/src/pages/domains.tsx:599-602 | client only (server re-checks at apply time) | Code read | OK |
| "DNS operation" select (create / update / delete) | select | Whether to add, change, or remove a DNS record. | client/src/pages/domains.tsx:604-613 | sent as change.kind | Code read | OK |
| "Record type" select (A / AAAA / CNAME / TXT / MX / CAA) | select | The DNS record type. | client/src/pages/domains.tsx:614-623 | sent as change.record.type; server validates value shape per type (types.ts:31-40) | Code read | OK |
| "Record name" input ("@ or www") | input | The record host name (@ for the root domain). | client/src/pages/domains.tsx:624-629 | sent as change.record.name (lowercased; @, *, or a host name) | Code read | OK |
| "Record value" input | input | The record content (current value for deletes). | client/src/pages/domains.tsx:631-636 | sent as change.record.content (min 1 char, no CR/NUL) | Code read | OK |
| "TTL" number input (default 600) | input | How long resolvers may cache the record, in seconds (server range 60…2147483647). | client/src/pages/domains.tsx:637-646 | sent as change.record.ttl, default 600 (types.ts:27) | Code read | OK |
| "MX priority" number input (default 0) | input | Preference number for MX records (0–65535). | client/src/pages/domains.tsx:647-655 | sent as change.record.priority, default 0 (types.ts:28) | Code read | OK |
| "Preview DNS change" button | button | Queues background preview jobs showing before/after for the record change on every ticked domain. | client/src/pages/domains.tsx:657-671 | POST /api/domains/preview body {ids:[…], change:{kind, record:{type,name,content,ttl,priority}}} → routes.ts:243-249 → service.preview → domain_jobs 'previewing'; 202 {jobs} | Code: endpoint + body match | OK |

### Section: Previews and change history (data-testid `section-domain-jobs`)

Intro: lists background jobs (previews, syncs, monitoring) newest first; ticking jobs + the warning checkbox and confirming is what actually sends the change to the registrar.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Job card summary "{domain or Registrar inventory} · {kind} · {status}" | status pill / text | One expandable card per job; status comes from the job row (queued/previewing/ready/applying/verifying/verified/complete/failed/…). | client/src/pages/domains.tsx:682-701 | GET /api/domains/jobs?page=N&q=same-search-text → SELECT j.id,j.domain_id,d.domain,j.kind,j.status,j.payload,j.before_state,j.after_state,j.error,j.created_at,j.expires_at FROM domain_jobs j LEFT JOIN managed_domains d ON d.id=j.domain_id WHERE j.user_id=$1 AND COALESCE(d.domain,'') ILIKE '%q%' ORDER BY j.created_at DESC LIMIT 25 (routes.ts:294-301); polls every 3s | SQL: SELECT count(*) FROM domain_jobs WHERE user_id=1 → 0 = API items [] | OK |
| Job card select checkbox "Select job {id}" | input | Ticks a preview job for Confirm or Rollback-preview. | client/src/pages/domains.tsx:685-698 | client only | Code read | OK |
| Job error line | status pill (text) | Shows the job's error text when it failed. | client/src/pages/domains.tsx:702-706 | domain_jobs.error | Code read | OK |
| "Before" / "After" JSON panels | text | The DNS snapshot before the change and the desired result after, for review before confirming. | client/src/pages/domains.tsx:707-736 | domain_jobs.before_state / after_state jsonb | Code read | OK |
| "No previews yet. Select domains above and preview a change." | text | Empty state for the jobs list. | client/src/pages/domains.tsx:739-743 | client only | Code read | OK |
| "I reviewed the changes and understand that MX, TXT, CNAME or nameserver changes can break email and website access." checkbox | input | Acknowledgement the server requires (only for email-affecting changes) before it will apply a confirmed preview. | client/src/pages/domains.tsx:744-752 | Enforced server-side: confirm() throws "Acknowledge the email/DNS interruption warning." if any selected change is nameservers/MX/TXT/CNAME and emailWarningAccepted=false (service.ts:244-248, types.ts:96-101) | Code read | OK |
| "Confirm selected previews" button | button | Sends the ticked preview jobs to the registrar to actually apply them (asks for a recent sign-in first). | client/src/pages/domains.tsx:754-771 | POST /api/domains/confirm body {jobIds:[uuid…], confirmed:true, emailWarningAccepted:bool} → routes.ts:271-284: requireRecentAuth, confirm() (service.ts:221-260): locks rows, requires status='ready' and expires_at>now() (else 409 "Preview expired…"), then UPDATE domain_jobs SET status='queued', expires_at=now()+10min; 202 | Code: endpoint + body match zod (routes.ts:272-279) | OK |
| "Preview rollback of selected changes" button | button | Builds a new preview that would undo the ticked applied changes (restore their before-values). | client/src/pages/domains.tsx:772-778 | POST /api/domains/rollback-preview body {jobIds:[uuid…]} → routes.ts:285-293 → rollbackPreview (service.ts:210-220): job must be kind='change' in verified/verifying/verification_failed/uncertain with before_state and result.inverse (else 404 "No rollback snapshot available"); creates new previews; 202 {jobs} | Code: endpoint + body match | OK |
| "Previous jobs" / "Next jobs" buttons | button | Pages the job history (25 per page). | client/src/pages/domains.tsx:779-802 | client only | Code read | OK |

### Section: Registrar walkthroughs

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Server egress IP for allowlists: {ip or Not configured — ask your administrator}" | text | Shows the server's outbound IP to whitelist at registrars that require it; fallback text when the env var is unset. | client/src/pages/domains.tsx:808-811 | GET /api/domains/guides → egressIp = process.env.DOMAINS_EGRESS_IP \|\| null (routes.ts:83) | curl /api/domains/guides → "egressIp":null → fallback text shown; true (env unset in dev) | OK |
| Guide accordions "{name} · {mode}" (8: Porkbun, Name.com, Namecheap, GoDaddy, Squarespace, Hover, Wix, Network Solutions) + numbered steps | link / text | Expandable how-to for getting API access or changing nameservers at each registrar. | client/src/pages/domains.tsx:812-821 | GET /api/domains/guides → registrarGuides static constant (server/domains/guides.ts, "Docs checked 2026-09-29") | curl → 8 guides, names/modes/steps match guides.ts verbatim | OK |
| "Official documentation" external links (8) | link | Opens the registrar's official docs in a new tab. | client/src/pages/domains.tsx:822-829 | client only: href = g.url | curl -sI: porkbun 200, docs.name.com 200, squarespace 200, hover 200, wix 200, godaddy 200; namecheap.com 403 and networksolutions.com 403 even with browser UA (bot/WAF block from curl — likely fine in a real browser, cannot confirm from here) | 6 OK; 2 UNCLEAR |

## Suspected bugs

1. **domains.tsx · success Notice after "Add domains" and "Map selected to client" · minor copy bug.** What the owner sees: the neutral banner "Saved. Background work will appear below." after adding manual domains or mapping domains to a client. What is actually true: those two endpoints return `{added:n}` / `{ok:true}` and never enqueue a worker job, so nothing appears in "Previews and change history". Only `/sync`, `/preview`, `/cloudflare-preview`, `/confirm`, `/rollback-preview`, `/connections` (auto-discover) and `/monitor` (via the daily scheduler) put rows into `domain_jobs`. Root cause: client/src/pages/domains.tsx:89-93 picks the message solely on the presence of `jobs` in the response. Suggested smallest fix: in `act()` (or per call site), choose "Saved." when the path is `/manual` or `/mapping` (or have the server return a `jobs` array/flag and key off that).

2. **domains.tsx · "Client location" table cell shows a raw database id.** What the owner sees: for a mapped domain, a bare number like `104296` under the "Client location" column. What is actually true: `managed_domains.location_id` is a foreign key into `business_locations`; the page renders `d.location_id || "Unmapped"` (client/src/pages/domains.tsx:495) instead of the client's `business_name`, so the column label promises a client/location and delivers an internal id the owner cannot interpret. Root cause: client/src/pages/domains.tsx:491-496; the inventory API (server/domains/routes.ts:93) returns only `location_id`, no joined name. Suggested smallest fix: join `business_locations.business_name` in the GET /api/domains query (or resolve ids client-side from the existing `/api/domains/locations` data) and display the name, falling back to "Unmapped".

Note (not counted as a bug): the Namecheap and Network Solutions "Official documentation" links return HTTP 403 to curl (bot/WAF protection, including with a browser user-agent), so reachability from a real browser is UNCLEAR; the other six guide links resolve 200. Also observed: with `DOMAINS_WORKER_ENABLED` unset the orange "background processing is off" banner correctly shows, and every number on the page ("N domains", row values, connection/location/job lists) matched independent SQL counts for user 1 (3/0/2/0) with no other orgs' rows present in any domains table.

---


Audit date 2026-10-04. Server: http://127.0.0.1:8303 (worktree /home/veto/ConstructHUB-audit3, branch audit/3, HEAD 7e2512b). Dev user id=1 ("Veto", platform admin, plan Agency). DB: constructhub_dev_a6 (SELECT only).

Key architecture note that affects several "Backend" cells: `registerAgencyAccess` (server/agency/middleware.ts:22) is an `app.use` registered BEFORE the sitescan routes. For every signed-in user it intercepts `GET /api/sitescan` and answers it itself (middleware.ts:48-62), so the handler in server/sitescan/routes.ts:150 is shadowed for signed-in users (it still matters for the anonymous 401 path and for tests). The middleware version joins `business_locations`/`agency_clients`, adds `count(*) OVER()::int total` to every row (that is the otherwise-mysterious `total:6` inside each job row of the API response — harmless, the page ignores it), and computes top-level `total` from `jobs[0].total`. All counts below were recomputed with independent SQL and matched.

Data ownership in the dev DB (for cross-account checks):
- `sitescan_jobs`: 11 rows — 6 belong to user 1, 5 have `user_id NULL` (free public scans from `sitescan_leads`, visible to nobody's history). No other user has scan jobs.
- `business_locations`: users 1 (2 locations: id 506025 GBP-linked "AI-TEST Ridgeline Roofing", id 104296 not linked) and 2328 (1 location). The site-scan location picker only shows GBP-linked ones → 1.
- `sitescan_schedules`, `sitescan_branding`, `edge_assets`, `edge_connections`, `edge_jobs`, `edge_actions`, `gsc_analytics`, `gsc_inspections`: all empty for every user (so most of site-connections renders its empty states).
- `sitescan_leads`: 5 rows (free-scan leads, platform-admin only).

---

## client/src/pages/site-scan.tsx — route `/site-scan` (signed-in; the same file also exports the signed-out `/free-site-scan` page, the public `/site-scan/report/:token` shared-report page, and the `SiteScanLeads` table used on `/crm/admin`)

**What it is:** the Site Scan workbench — start website audits (solo or bulk across GBP-linked client locations), schedule monthly rescans, browse scan history, read a scored report, generate an AI fix plan, export/share/email it, and white-label the PDF. Visible to any signed-in user (route is inside the authed dashboard Switch in client/src/App.tsx:189); the API has no module gate on the list — spend is enforced by quotas/budgets server-side (5 scans/day, 20 PageSpeed calls/day, 3 AI drafts/day, monthly plan `siteScans` quota). Main data source: `sitescan_jobs` (report JSONB), `business_locations` (picker), `sitescan_schedules` — all through the agency middleware for the list, and server/sitescan/routes.ts for the job detail.

### Page chrome (AppPage testid `page-site-scan`)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Site Scan" page header | banner | Titles the page: "Find website issues, compare your Google Business Profile, and draft your next fixes." | site-scan.tsx:527-530 | client only | Read | OK |
| AgencyWorkspace (compact) | section | Agency bulk workspace strip. For an entitled workspace (dev user is) shows workspace name/role + a "Bulk location actions" expander that opens the shared agency bulk panel (location search, client/status filters, select page/all, bulk actions incl. "Start Site Scans", CSV export). | site-scan.tsx:531; components/agency-workspace.tsx:32-123 | GET /api/agency/me (entitled true), GET /api/agency/locations, GET /api/agency/dashboard, GET /api/agency/clients; POST /api/agency/bulk | curl /api/agency/me → `{owner:1, actor:1, entitled:true, role:'owner'}`; /api/agency/dashboard → `{total:2, reconnect:1, unlinked:1}` matches SQL count(business_locations user_id=1)=2 | OK |
| Error Notice | banner | Shows the last action's error (e.g. limit reached, invalid input). | site-scan.tsx:794 | client only | Read | OK |
| Info Notice | banner | Shows success notices ("Scan deleted."). | site-scan.tsx:795 | client only | Read | OK |

### Section "Start a scan" (testid none; hints: "Up to 5 scans/day, 20 PageSpeed requests/day and 3 AI drafts/day")
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search client locations" input | input | Filters the GBP-location picker (business name or website). | site-scan.tsx:538-549 | sent as `locationQ` on GET /api/sitescan → middleware.ts:56-58 filters business_locations ILIKE | Read + param traced | OK |
| "Previous locations" / range "1–25 of N" / "Next locations" | button / stat / button | Pages the location picker by 25. | site-scan.tsx:550-576 | `locationTotal` from the middleware locations query (window count over business_locations user_id=$1 AND gbp_location_name IS NOT NULL) | API locationTotal=1; SQL: SELECT count(*) FROM business_locations WHERE user_id=1 AND gbp_location_name IS NOT NULL → 1 ✓ | OK |
| "Bulk scan client sites (N selected)" details | disclosure | Opens the bulk-scan panel. | site-scan.tsx:578-581 | client only | Read | OK |
| "Select this page" / "Clear selection" | button | Checks/unchecks all listed locations that have a website. | site-scan.tsx:583-607 | client only | Read | OK |
| Per-location checkbox (`{name} — {website}`) | input | Picks locations for a bulk scan. Locations without a website can't be queued (server re-checks). | site-scan.tsx:608-623 | rows come from the same locations query above | API items ✓ | OK |
| "Queue selected sites" | button | Queues one scan per selected location (max 1,000/day across the agency). Consumes one monthly plan Site Scan per location. After queuing it selects the first new job. | site-scan.tsx:624-640 | POST /api/sitescan/bulk {locationIds, pageCap, psiPages} → server/sitescan/routes.ts:194 → enqueueLocations (agency.ts:66-97): requires synced GBP profile per location, budget `sitescan:bulk:<user>` 1000/day, INSERT sitescan_jobs | Verified by code (route + body match); limits cross-checked: hint "Up to 1,000 sites per day" = takeBudget 1000 (agency.ts:88) ✓ | OK |
| "Linked GBP location" select | select | Optionally attaches a synced Business Profile so the report can compare NAP/services; picking one fills the website URL. "No GBP comparison" = plain scan. | site-scan.tsx:649-669 | options from locations query | API ✓ | OK |
| "Website URL" input | input | The site to scan (public http/https only, validated server-side). | site-scan.tsx:670-677 | POST /api/sitescan body.url → routes.ts:366-401 siteUrl() validation | Verified by code | OK |
| "Page cap" input | input | Max pages to crawl, 1–500 (client and server both enforce). | site-scan.tsx:678-688 | zod min 1 max 500 (routes.ts:29) | Verified by code | OK |
| "PageSpeed pages (mobile + desktop)" input | input | How many crawled pages get Google PageSpeed measurements, 0–5 (each page × 2 strategies). | site-scan.tsx:689-701 | zod 0–5 (routes.ts:30); calls budgeted 20/user/day (worker.ts:157-163) — matches hint ✓ | Verified by code | OK |
| Limits validation error | status | "Page cap must be a whole number from 1 to 500." / "PageSpeed pages must be a whole number from 0 to 5." | site-scan.tsx:488-492, 703-705 | client only | Read | OK |
| "Start scan" | button | Queues the scan and opens its report. 5/day cap + 1 monthly plan scan. | site-scan.tsx:707-724 | POST /api/sitescan {url, locationId?, pageCap, psiPages} → routes.ts:366: reserveQuotaFor siteScans, takeBudget `sitescan:scan:<user>` 5/day, enqueue() INSERT sitescan_jobs | Verified by code; hint "5 scans/day" ✓ (routes.ts:386) | OK |
| "Enable monthly rescan" / "Disable monthly rescan" | button | Toggles a monthly automatic rescan for the URL shown (uses current cap/PageSpeed settings). | site-scan.tsx:725-746 | POST /api/sitescan/schedule {url, enabled, locationId?, pageCap, psiPages} → routes.ts:515-566: INSERT/DELETE sitescan_schedules (PK user_id+url), max 10 enforced with 409 | Verified by code; "of 10" limit ✓ (routes.ts:543) | OK |
| "Monthly rescans (N of 10)" + rows | stat / list | Lists scheduled rescans (URL · page cap · next run date) each with a "Disable" button. Empty state explains how to add one. | site-scan.tsx:748-791 | GET /api/sitescan `schedules` → middleware.ts:60 (owner rows incl. URL-only schedules) | API schedules=[] ; SQL: SELECT count(*) FROM sitescan_schedules WHERE user_id=1 → 0 ✓ | OK |
| Schedule row "Disable" (`Disable schedule for {url}`) | button | Removes that one schedule. | site-scan.tsx:768-786 | POST /api/sitescan/schedule {url, enabled:false} → routes.ts:560-563 DELETE | Verified by code | OK |

### Section "History & score trend" (testid `section-scan-history`)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search history" input | input | Filters scans by URL or client name (resets to page 1). | site-scan.tsx:809-818 | `q` on GET /api/sitescan → middleware.ts:56 `concat_ws(' ',j.url,l.business_name) ILIKE $8` | Read + param traced | OK |
| "Status" select | select | Filters by queued/running/completed/failed. | site-scan.tsx:819-833 | `status` → middleware.ts:56 `($10='' OR j.status=$10)` | API ?status=failed → total 2; SQL: SELECT count(*) FROM sitescan_jobs WHERE user_id=1 AND status='failed' → 2 ✓ | OK |
| "History for selected client" / "All clients" | button | Narrows history to the GBP location chosen in "Linked GBP location" (or back to all). | site-scan.tsx:835-856 | `locationId` → middleware.ts:56 `($11::int IS NULL OR l.id=$11)` | API ?locationId=506025 → total 0 (all dev jobs are profile-less) ✓ consistent | OK |
| Context hint ("Showing scans for all clients…") | text | Explains which client's history is shown. | site-scan.tsx:858-870 | client only | Read | OK |
| "Previous scans" / "N scans" / "Next scans" | button / stat / button | Pages history 25 at a time; N = total matching scans. | site-scan.tsx:871-893 | `total` = window count over filtered sitescan_jobs | API total=6; SQL: SELECT count(*) FROM sitescan_jobs WHERE user_id=1 → 6 ✓ | OK |
| Scan chip (`{date} · {url} · {score|status} (+N since prior scan)`) | button | Opens that scan's report; the delta is the overall-score change vs the previous scan of the same URL on this page. | site-scan.tsx:894-923 | per-row data from the list query (scores = report->'scores'); delta computed client-side | API rows match SQL rows (6/6, same ids/scores) | OK |
| "No scans yet." | empty state | Shown when history is empty. | site-scan.tsx:924-926 | — | Read | OK |

### Selected scan section (report header + actions)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Job URL heading + "not found" Notice | text / banner | Shows the scan's URL; a 400/404 shows "This report was not found…". | site-scan.tsx:930-942 | GET /api/sitescan/jobs/:id → routes.ts:402 getJob: `sitescan_jobs WHERE id=$1 AND user_id=$2` (404 for foreign/unknown) | curl random uuid → 404 ✓ | OK |
| "Delete scan" | button | Deletes the job after a confirm (report, fix progress, share link; still counts toward today's limit). | site-scan.tsx:943-970 | DELETE /api/sitescan/jobs/:id → routes.ts:494-505 DELETE sitescan_jobs | Verified by code (GET-only audit; not invoked) | OK |
| "status · N of M pages checked" | status | Live progress line (N from the crawl state, M from the page cap). | site-scan.tsx:972-974 | pages = jsonb_array_length(state->'pages'); pageCap column | API pages=5 pageCap=5; SQL jsonb_array_length → 5 ✓ | OK |
| Job error alert | status | Shows the failure sentence for failed scans. | site-scan.tsx:975-979 | sitescan_jobs.error | API error text matches SQL for the failed jobs ✓ | OK |
| "Generate AI fix plan" | button | Calls the AI to draft a page-by-page fix plan (3 drafts/day, 20 provider calls/day). Plan appears under "AI fix plan — draft". | site-scan.tsx:983-992 | POST /api/sitescan/jobs/:id/plan → routes.ts:417-480: budgets `sitescan:ai:<user>` 3/day + `sitescan:ai-calls:<user>` 20/day + global 100/day, OpenAI provider, saves sitescan_jobs.ai_draft | Verified by code; limits match hint ✓ | OK |
| "Export PDF" | link | Downloads the branded PDF report. | site-scan.tsx:993-995 | GET /api/sitescan/jobs/:id/pdf → routes.ts:567-642 pdfkit stream; branding from sitescan_branding | curl → 200 application/pdf, 15.6 KB ✓ | OK |
| "Create share link" / "Replace share link" | button | Creates a new 30-day read-only link (replaces any previous one after confirm). Shows the link once. | site-scan.tsx:996-1018 | POST /api/sitescan/jobs/:id/share → routes.ts:481-493: sets share_hash=sha256(token), share_expires=now()+30 days; returns `/site-scan/report/<token>` | Verified by code; "30 days" ✓ (routes.ts:488) | OK |
| "Revoke share link" | button | Clears the stored hash; existing links die. | site-scan.tsx:1019-1034 | DELETE /api/sitescan/jobs/:id/share → routes.ts:506-514 NULLs share_hash/share_expires | Verified by code | OK |
| Share URL + "Copy link" | link / button | Displays the new link (only once) and copies it to the clipboard. | site-scan.tsx:1036-1050; Copy :150-177 | client only (clipboard) | Read | OK |
| "A share link is active…" hint | text | Shown on reload when a link exists but can't be re-displayed. | site-scan.tsx:1052-1058 | shareEnabled from job row | API shareEnabled=false ✓ | OK |

### Section "Follow up" (testid `section-scan-followup`)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Rescan / retry PageSpeed" | button | Re-runs the scan (counts toward the 5/day + monthly quota); selects the new job and resets report filters. | site-scan.tsx:1063-1078 | POST /api/sitescan/jobs/:id/retry → routes.ts:310-331: reserveQuotaFor + `sitescan:scan:<user>` 5/day, enqueue() | Verified by code | OK |
| "Send to my web person — email" input + "Send prioritized checklist" | input / button | Emails the prioritized fix checklist to any address (10/day). | site-scan.tsx:1080-1112 | POST /api/sitescan/jobs/:id/email {email} → routes.ts:332-365: budget 10/day, builds checklist text, sendWithFallback; dev EMAIL_FORCE_SINK returns sink flag | Verified by code; limit matches (routes.ts:341) | OK |
| "Checklist saved to local email sink."/"Checklist email sent." | status | Result line after sending. | site-scan.tsx:1113-1117 | sink flag from response | Read | OK |
| "White-label PDF branding" details | disclosure | Opens the branding form (owner only; delegated members see "managed by the workspace owner"). | site-scan.tsx:1118-1126 | GET /api/sitescan/branding → routes.ts:218-226 sitescan_branding | API {name:"",logo:null}; SQL count(user_id=1)=0 ✓ | OK |
| "Agency name" input | input | Name printed on PDF exports. | site-scan.tsx:1128-1139 | POST /api/sitescan/branding {name, logo?} → routes.ts:227-273 upsert sitescan_branding; logo resized via sharp to ≤600×300 PNG | Verified by code | OK |
| "Agency logo (PNG/JPEG, up to 200 KB)" file input + preview + "Remove logo" | input | Uploads a logo; client enforces 200 KB, server normalizes to PNG data URL. | site-scan.tsx:1140-1182 | same POST; DELETE clears via Remove branding | Verified by code | OK |
| "Save PDF branding" | button | Saves name (logo kept if unchanged). | site-scan.tsx:1184-1210 | POST /api/sitescan/branding | Verified by code | OK |
| "Remove branding" | button | Deletes the saved branding after confirm; PDFs revert to the ConstructHUB title. | site-scan.tsx:1211-1237 | DELETE /api/sitescan/branding → routes.ts:276-279 | Verified by code | OK |
| Branding notice + "No remote logo URL is fetched" hint | status / text | Confirms save/remove. | site-scan.tsx:1239-1247 | client only | Read | OK |

### ReportFilters (shared component, components/site-scan-fixes.tsx:159-250)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search findings and fixes" (Toolbar search) | input | Filters findings/fixes by any text (sent to server with the report request). | site-scan-fixes.tsx:170-176 | GET /api/sitescan/jobs/:id `q` → reportView (agency.ts:13-58) JSON-substring match | Read | OK |
| "Category" select | select | Keeps one of technical/performance/local/content/ai-readiness. | site-scan-fixes.tsx:179-199 | `category` → reportView filter | Read | OK |
| "Verification" select | select | Filters fixes by rescan verdict: new / still present / fixed / not checked. | site-scan-fixes.tsx:200-219 | `verification` → reportView filter | Read | OK |
| "Previous findings" / range "A–B of N" / "Next findings" | button / stat / button | Pages findings+fixes together, 25 per server page; N = max(fixTotal, findingTotal). | site-scan-fixes.tsx:223-247 | `offset` → reportView slices both lists | API findingTotal=10 fixTotal=16; SQL jsonb_array_length(report->'findings')=10, fixes=16 ✓ | OK |

### ScanReport (shared component, site-scan.tsx:179-404) — rendered for the selected job
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Score tiles: Overall / Local / Content / Technical / Performance / AI Readiness | stat (6 tiles) | The scan's category scores 0–100; "N/A" when a category wasn't scored (Performance is N/A without PageSpeed data). | site-scan.tsx:199-213 | report.scores from the job row | API scores overall 90 / 86 / 92 / 84 / null / 96 = SQL report->'scores' ✓ | OK |
| "{n} pages checked. … URLs remain outside this report." | stat | Coverage line: pages crawled and how many URLs were left uncrawled by the cap. | site-scan.tsx:214-220 | report.pages / report.remaining | API pages 5, remaining 24; SQL report->>'remaining'=24 ✓ | OK |
| "What raised or lowered these scores?" details | disclosure | Plain-language score explanations per category. | site-scan.tsx:221-232 | report.scoreExplanation | present in API ✓ | OK |
| "Why Performance is N/A" note | notice | Explains missing PageSpeed data; tells the owner to add PAGESPEED_API_KEY when relevant, else "Use Rescan / retry PageSpeed". | site-scan.tsx:233-257 | report.psi[].unavailable / reason | API psi[0].unavailable="PageSpeed was not selected (0 pages). Retry with PageSpeed enabled." reason="disabled" → non-summary shows "Use Rescan…" branch ✓ | OK |
| Category sections (Technical, Performance, Local, Content, AI Readiness) with finding cards: impact/severity badge, title, "Why it matters for SEO", "Authoritative guidance" source link, numbered steps, "How to fix", "Affected URLs (n)" | list | The actual findings, sorted by guidance impact (High/Medium/Low) else severity. Guidance links open the cited doc (e.g. Google/Cloudflare) in a new tab. Empty states distinguish "no findings" vs "filtered out" vs "not scored". | site-scan.tsx:258-363 | report.findings[] (stored JSONB; generated by the worker's audit+guidance pipeline) | API findings=10 across categories; counts match SQL ✓ | OK |
| "Older report: rescan to add cited guidance…" | notice | Shown for pre-v2 reports without cited guidance. | site-scan.tsx:193-198 | report.version | API version=2 → hidden ✓ | OK |
| FixChecklist: "Mark this page done" / "Mark this page not done", per-fix cards (title, why, Source link, steps, "Done (reported) · Rescan: {verification}", page/target, evidence JSON, platform click path, draft code + "Copy code", "Mark done"/"Mark not done") | list / button | The prioritized how-to-fix checklist; "done" is the user's own work tracking, rescan verification is separate. | components/site-scan-fixes.tsx:7-158; wired at site-scan.tsx:364, 1264-1271 | POST /api/sitescan/jobs/:id/fixes {keys, done} → routes.ts:280-309: validates keys against report.fixes, merges into sitescan_jobs.fix_done jsonb; shown state = fix_done ?? report.fixes.done | Verified by code (shape matches); fix count 16 verified via SQL ✓ | OK |
| "GBP comparison: … / No synced GBP profile…" | status | Which synced Business Profile the NAP/service comparison used. | site-scan.tsx:365-371 | report.profile (job.profile) | API profile=null → "No synced GBP profile…" shown ✓ (SQL profile NULL) | OK |
| "PageSpeed measurements and field data" details (+ inner "Raw data") | disclosure | Per PageSpeed run: score, lab metrics (LCP/CLS/TBT…), real-user CrUX field data with 75th percentiles. | site-scan.tsx:65-131, 372 | report.psi[] (worker pageSpeed()) | API psi len 1 ✓ | OK |
| "GBP JSON-LD draft" section + "Copy draft" | section / button | A factual JSON-LD markup draft from the GBP snapshot. Hidden when absent. | site-scan.tsx:373-383 | report.jsonLdDraft | API jsonLdDraft=null → hidden ✓ | OK |
| "AI fix plan — draft" section + "Copy draft" | section / button | The AI-drafted plan (after Generate AI fix plan). Review-before-publishing warning. | site-scan.tsx:384-398 | job.ai_draft | API aiDraft empty → hidden ✓ | OK |
| Coverage notes line | text | Crawl caveats (heuristic scores, HTML-only crawl, sampling). | site-scan.tsx:399-401 | report.coverage.notes | API coverage.notes present ✓ | OK |

### ScanIndexingSummary card (component lives in site-connections.tsx:1275-1303, rendered at site-scan.tsx:1273)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search Console indexing" card + "Scanned URL indexing" list | list | For each URL the scan crawled, the latest Google index-inspection result ("Not inspected" when none). | site-connections.tsx:1275-1296 | GET /api/gsc/scans/:id/indexing → server/gsc/routes.ts:233-258: expands sitescan_jobs.state->'pages', latest gsc_inspections per URL owned by user | curl → {total:5} = pages count 5 ✓ (gsc_inspections empty → all "Not inspected") | OK |
| "Queue inspections in Search Console" | link | Jumps to the Search Console page (Sites tab, where bulk inspection lives). | site-connections.tsx:1297-1299 | route /search-console registered (App.tsx:188) | Route exists ✓ | OK |

(Hidden entirely — renders null — when the plan lacks the Search Console module: the component's probe of /api/gsc/connections?limit=1 answers 402 plan_required, planRequiredFrom swallows it. Dev user has the module, so the card shows.)

### SharedSiteScanPage — route `/site-scan/report/:token` (public; handled before the auth gate in App.tsx:533)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Shared Site Scan" + unavailable alert | heading / banner | Public read-only report viewer; bad/expired token → "This report link is unavailable or revoked." | site-scan.tsx:1281-1296 | GET /api/sitescan/shared/:token → routes.ts:663-676: `share_hash=sha256(token) AND share_expires>now()` (404 otherwise) | curl with zeros → 404 ✓; 30-day window from routes.ts:488 ✓ | OK |
| ReportFilters + full ScanReport (no mark-done buttons, no follow-up actions) | filter / report | Same report chrome as the owner view, filtered/paged server-side. | site-scan.tsx:1297-1305 | same reportView | Read | OK |

### FreeSiteScanPage — route `/free-site-scan` (public marketing page; also what signed-out visitors get for `/site-scan`)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| PublicPageHeader (`header-public-page`) | header | Signed-out marketing nav (Features, sign in/get started); renders nothing when signed in. | site-scan.tsx:1361; components/public-page-chrome.tsx:36-45 | client only | Read | OK |
| "ConstructHUB" link | link | Back to the marketing home page. | site-scan.tsx:1363-1365 | route / (App.tsx:166) | Route exists ✓ | OK |
| "Free 60-second website scan" + explainer | heading / text | Marketing copy; "We check up to 11 pages; slow sites can take longer." | site-scan.tsx:1366-1371 | copy | 11 pages = enqueue(null,url,11,1) at routes.ts:743 ✓ | OK |
| "Website URL" + "Email" inputs | input | Lead capture; both required. | site-scan.tsx:1398-1415 | POST /api/sitescan/public/start {url, email, captchaToken} → routes.ts:685-761: siteUrl validation, optional reCAPTCHA verify, per-IP 3/day + per-email 2/day + global 100/day, enqueue (11 pages), INSERT sitescan_leads, verification email (7-day expiry) | Verified by code; captcha only when RECAPTCHA_SECRET_KEY set (dev unset) | OK |
| reCAPTCHA widget (`#sitescan-captcha`) | widget | Anti-abuse challenge; script only injected when a site key is configured. | site-scan.tsx:1316-1345 | GET /api/sitescan/public/config → captchaSiteKey | curl → {captchaSiteKey:null} → widget stays empty, button enabled ✓ | OK |
| "Scan my website" | button | Starts the free scan; then polls status. | site-scan.tsx:1417-1423 | disabled until config loads and (if a key exists) a CAPTCHA token is held | Read | OK |
| Privacy policy link | link | /privacy | site-scan.tsx:1424-1429 | route exists (App.tsx:229) | ✓ | OK |
| "Check your email for the verification link…" / "Scan queued/running/completed" / failure box + "Scan another site" | status / button | Progress and error states; failure suggests retrying. | site-scan.tsx:1432-1462 | GET /api/sitescan/public/status/:access (poll 3s) and POST /api/sitescan/public/verify {token} from the ?verify= link → routes.ts:762-802 (leads row must be unexpired) | Verified by code | OK |
| Summary report (first 5 findings) then full report after email verification | report | Teaser scores + 5 findings until verified; full ScanReport after. | site-scan.tsx:1463-1464 | status response slices findings to 5 (routes.ts:774-780); verify returns the full report | Read ✓ ("Verify your email for all findings") | OK |

### SiteScanLeads (exported here, rendered on `/crm/admin` — platform admin only; listed for completeness)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Site Scan leads" card (`section-sitescan-leads`), table Email/Website/Verified/Status, "latest 500" | table | Lists free-scan lead emails for platform admins; others see "Platform admin access required." | site-scan.tsx:1469-1523 | GET /api/admin/sitescan-leads → routes.ts:803-809: requirePlatformAdmin, JOIN sitescan_leads+sitescan_jobs ORDER BY created_at DESC LIMIT 500 | curl (dev user is platform admin) → 5 rows; SQL count(sitescan_leads)=5 ✓ | OK |

---

## client/src/pages/site-connections.tsx — routes `/cloudflare` (CloudflarePage) and `/search-console` (SearchConsolePage)

**What it is:** one component parameterized by provider — "Cloudflare protection" (`cf=true`) and "Google Search Console". Connect provider accounts, discover/sync client sites, review queued work, and (Cloudflare) preview/apply edge rules with undo; (Search Console) bulk sitemap submission/inspection. Visible to any signed-in user, but every `/api/cloudflare` and `/api/gsc` route except saved-connection list/disconnect is gated by `requireModule("cloudflareSearchConsole")` (server/cloudflare/routes.ts:103-112 → server/entitlements.ts:611) answering 402 `plan_required`, which the page turns into a PlanRequired upgrade card (client/src/components/plan-required.tsx:136). Dev user has the module, so the real page renders. Main data sources: `edge_connections`, `edge_assets`, `edge_jobs`, `edge_actions`, `edge_invites`, `business_locations`, plus `gsc_analytics`/`gsc_inspections` for the details panels. The dev DB has zero rows in all edge/gsc tables, so every list shows its honest empty state; totals below were verified as 0 via both API and SQL.

### Page chrome
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| PageHeader "Cloudflare protection" / "Google Search Console" | banner | Titles + one-line description of the module. | site-connections.tsx:391-400 | client only | Read | OK |
| PlanRequired card (`plan-required-cloudflaresearchconsole`) | card | Shown instead of the page when the plan lacks the module: message from the server's 402, "What it does" details, price line, "See plans and pricing" (or "Update card" after a failed payment), plus removable saved connections. | site-connections.tsx:409-419; plan-required.tsx:136-182 | 402 body from requireModule | Read; gate verified in server code | OK |
| "Background processing is disabled…" Notice (`Notice` tone warning) | banner | Warns that queued work won't run until the owner enables the site integration worker. | site-connections.tsx:423-428 | `workerEnabled` = EDGE_SEARCH_WORKER_ENABLED==='true' on GET /api/{provider}/connections (routes.ts:145) | curl connections → workerEnabled=false → Notice shows ✓ | OK |
| "Google consent failed…" Notice | banner | Shown when the OAuth callback redirects back with ?connection=failed. | site-connections.tsx:429-434 | set by /api/gsc/callback redirect (gsc/routes.ts:80,109) | Read | OK |
| Tab strip: Sites / Connections / Onboarding / Work queue / Edge audit (Cloudflare only) / Guide (`tab-connection-*` testids) | tab | Switches the panel below. Plain buttons (role=button) so e2e can reach them. | site-connections.tsx:401-408, 435; TabStrip :45-68 | client only | Read | OK |

### Tab "Connections"
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Cloudflare: "Cloudflare login email" + "Global API Key" fields, "Find zone by domain" | input | Collects the Global Key (used once, never stored) and an optional zone-name filter. | site-connections.tsx:449-468 | — | Read | OK |
| "Verify and choose zones" | button | Verifies the key with Cloudflare and lists accounts/zones (50/page) to pick from. | site-connections.tsx:469-475 | POST /api/cloudflare/key-discovery {email,key,page,q} → cloudflare/routes.ts:416-445: calls Cloudflare /user + /zones (key wiped from the body after) | Verified by code (matches shape) | OK |
| Zones result box: "N zones · page N", account names, zone checkboxes, "Previous zones"/"Next zones", "Create limited key" | list / button | Picks zones, then mints a limited ConstructHUB token (Zone Read, Analytics Read, Zone WAF Edit) scoped to those zones. | site-connections.tsx:476-547 | POST /api/cloudflare/exchange {email,key,zones} → routes.ts:446-462 → service.exchangeKey; INSERT edge_connections; notification logged | Verified by code | OK |
| "Permissions: Zone Read, Analytics Read, Zone WAF Edit…" | text | States the limited key's scope. | site-connections.tsx:543-546 | matches permissions requested in exchangeKey (service.ts) | Read | OK |
| "Fallback: paste a scoped API token" details: instructions, token field, "Connect scoped token" | disclosure / input / button | Alternative connect path with a manually created token. | site-connections.tsx:549-584 | POST /api/cloudflare/token {token} → routes.ts:463-482: verifies /user/tokens/verify, saves edge_connections (method 'paste') | Verified by code | OK |
| "Agency member email: …" + "Enable agency membership connection" | text / button | Ops-only: connects the preconfigured agency membership (env CLOUDFLARE_AGENCY_*). Button is enabled for everyone, but the server 503s unless that env is configured. | site-connections.tsx:585-602 | POST /api/cloudflare/agency → routes.ts:483-518 | curl connections → agencyEmail=null ("Not configured"); env not set in dev, so click would toast an error. Conditional/ops-only | UNCLEAR (works only with server env; UI doesn't disable) |
| Google: "Connect Google Search Console" | button | Starts Google OAuth (scope = Search Console only), then discovers properties. | site-connections.tsx:605-617 | GET /api/gsc/connect → gsc/routes.ts:46-69: builds consent URL (requires recent auth); callback /api/gsc/callback exchanges code, saveGscGrant → edge_connections + queued 'discover' | Verified by code | OK |
| "Connections" DataList: search, "N results", rows (radio, email/subject, token name/method, permissions), "Discover sites", "Disconnect", pager | list / button / input | Lists saved connections. Discover re-imports sites/properties; Disconnect (recent-auth required) deletes local data, revokes a ConstructHUB-created token when possible, and shows per-connection instructions. | site-connections.tsx:619-684; DataList :69-171 | GET /api/{p}/connections (routes.ts:124-147: edge_connections WHERE user_id, ILIKE) ; POST /discover {connectionIds} (routes.ts:152-169 → queue 'discover'/'memberships'); POST /disconnect {ids} (routes.ts:234-284: deletes edge_invites+edge_connections, cf self-revoke) | curl connections → total 0; SQL count(edge_connections)=0 ✓. Endpoints match client bodies | OK |

### Tab "Sites"
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search sites" (Toolbar) | input | Filters the site list by name. | site-connections.tsx:689-699; app-ui Toolbar :238 | `q` on GET /api/{p}/assets → common.ts listAssets: edge_assets name ILIKE (escaped) | Read | OK |
| "Site status" select | select | cf: active/pending; gsc: siteOwner/siteFullUser/siteRestrictedUser/access_removed. | site-connections.tsx:700-724 | `status` → listAssets `($4='' OR status=$4)` | Read | OK |
| "Sync from (up to 16 months)" + "Sync through" (Search Console only) | input | Date range for the analytics backfill. | site-connections.tsx:727-742 | POST /sync {start,end} → cloudflare/routes.ts:170-217: start ≥ UTC month−16 enforced (400), end ≤ today enforced | Verified by code; 16-month floor ✓ | OK |
| "Sync selected (N)" / "Sync all matching sites" | button | Queues a background sync of the checked sites (or everything matching the current search+status, respecting the date range). | site-connections.tsx:743-775 | POST /api/{p}/sync {ids?|allMatching, q, status, start?, end?} → routes.ts:170-217: INSERT edge_jobs kind='sync' (dedup vs queued/running); hourly work budget 500 | Verified by code | OK |
| "N sites" + "Select this page" checkbox + site rows (checkbox, name link, "ID · status · N linked locations · Synced …", error, per-row "Sync") | stat / list / button | Lists connected zones/properties; clicking the name opens the analytics details panel below; per-row Sync re-queues one site. | site-connections.tsx:784-855 | GET /api/{p}/assets (listAssets; `locations` = count(edge_location_links)); per-row Sync → POST /sync {ids:[id]} | curl assets → total 0 → "No connected sites. Open Connections to get started." ✓ SQL edge_assets count=0 ✓ | OK |
| "Previous sites" / "Page N" / "Next sites" | button / stat / button | Pagination, 25 per page. | site-connections.tsx:856-876 | page/limit on listAssets | Read | OK |
| Cloudflare only — "Preview edge protection for selected zones": "Rule pack" select (Ads door / Site-wide bad user agents / Flagged IPs), "Ads path", "Flagged IP addresses", "Office IP exemptions", "Check office-IP exemptions in Cloudflare first.", "Preview rules" | select / input / button | Builds Click Guard/VPN Shield edge rules for the selected zones and shows them for review before anything touches Cloudflare. | site-connections.tsx:879-938 | POST /api/cloudflare/preview {ids, kind, path, ips, officeIps} → routes.ts:527-559: builds rulePack, INSERT edge_actions state='preview' | Verified by code | OK |
| "Review before applying" panel: per-zone rules + expressions, "Confirm and queue edge changes", "Cancel preview" | panel / button | Confirms the previewed rules (recent-auth required; previews expire after 1h) → queued to the worker, which writes WAF rules to Cloudflare. Cancel just clears the panel. | site-connections.tsx:939-980 | POST /api/cloudflare/confirm {ids} → routes.ts:560-615: edge_actions state='queued' + edge_jobs kind='apply' | Verified by code | OK |
| Search Console only — "Bulk sitemap submission or inspection": "Selected IDs: …", property-ID/URL textarea, "Queue inspections", "Review and submit sitemaps" | textarea / button | One `assetId, url` per line; inspection queues URL inspections, sitemap asks for a confirm dialog then submits to Google (sitemap requires Full access). | site-connections.tsx:983-1041 | POST /api/gsc/urls {kind, confirm, items:[{assetId,url}]} → gsc/routes.ts:152-185: URL must belong to the property (withinProperty), restricted users blocked for sitemaps, queue 'inspect'/'sitemap' jobs | Verified by code | OK |
| Details panel ("Close details"): Cloudflare → notice, "Flagged IPs" list with "Add to preview" (pulls Click Guard blocked IPs + VPN Shield blocked visits for the zone's domain), bot-traffic share, per-day traffic rows, five raw lists (traffic/events/paths/bots/countries); Search Console → MetricRows below | panel | Per-site analytics from the last sync (or "Analytics unavailable. Queue a sync…" when never synced). | site-connections.tsx:1042-1064; CloudflareDetails :1185-1267 | GET /api/cloudflare/assets/:id (routes.ts:148-151 → ownedAsset); GET /api/cloudflare/assets/:id/flagged-ips (hooks.ts:4-25, UNION of blocked_ips + vpn_visits by domain); GET …/cache?field=… (routes.ts:393-415, expands edge_assets.data) | Verified by code; no assets in dev to open | OK |

### MetricRows (Search Console details, site-connections.tsx:172-279)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Breakdown" (date/query/page/device/country) + "Group" (day/week/month) + "From"/"To" date fields | select / input | Chooses the analytics cut; From defaults to 31 days ago, To to today. | site-connections.tsx:181-219 | dimension/group/start/end sent to the analytics endpoint | Read | OK |
| "Search analytics" DataList: rows `date key — Clicks · Impressions · CTR% · Position` | list | Search-performance rows from the synced Google data (CTR/position impression-weighted server-side). | site-connections.tsx:221-240 | GET /api/gsc/assets/:id/analytics → gsc/routes.ts:112-151: gsc_analytics WHERE asset_id+dimension, date BETWEEN start AND end, GROUP BY date_trunc(group), ILIKE q | Verified by code; gsc_analytics empty in dev | OK |
| Google-data disclaimer note | text | "Google provides top rows and may omit anonymized queries… Indexing API supports only JobPosting and BroadcastEvent pages." | site-connections.tsx:241-246 | matches server notice (gsc/routes.ts:148-150) | Read | OK |
| "Sitemaps" DataList (`path · Submitted · Errors`) | list | Sitemaps known to Search Console for the property. | site-connections.tsx:247-256 | GET /api/gsc/assets/:id/sitemaps → gsc/routes.ts:214-232: edge_assets.data->'sitemaps' expanded | Verified by code | OK |
| "Inspections" DataList with PASS/FAIL/NEUTRAL filter (`url · coverageState · verdict · Checked …`) | list / filter | URL inspection results. | site-connections.tsx:257-271 | GET /api/gsc/assets/:id/inspections → gsc/routes.ts:186-213: gsc_inspections, verdict filter | Verified by code; filter values match verdict enum ✓ | OK |
| "Inspected URL coverage: Verdict: n · …" | stat | Summary counts of inspection verdicts for the property. | site-connections.tsx:1305-1319 (InspectionCoverage) | `coverage` array from the inspections endpoint (GROUP BY verdict) | Read | OK |

### Tab "Onboarding"
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Explainer ("Select a connection… Active connection: N") | text | Reminds you to pick a connection in the Connections tab first (radio state). | site-connections.tsx:1069-1074 | client only | Read | OK |
| "Locations" DataList (`id · name · website|Website required`) | list | Your locations with IDs, for composing invitation lines. | site-connections.tsx:1075-1083 | GET /api/{p}/locations → cloudflare/routes.ts:349-363: business_locations WHERE user_id, ILIKE | curl gsc+cloudflare locations → total 2, matches SQL count(business_locations user_id=1)=2 ✓ (104296 shows "Website required", 506025 has no website either — both null → both show "Website required") | OK |
| "Client invitations" textarea + "Send onboarding emails" | textarea / button | One `email, locationId(, cloudflare accountId)` per line; emails the client steps to grant access (Cloudflare also needs the account ID + agency env). | site-connections.tsx:1084-1121 | POST /api/{p}/invites {connectionId, clients:[{email,locationId,accountId?}]} → routes.ts:285-348: validates owned location with website, INSERT edge_invites state='pending', queue 'invite' | Verified by code; state default 'pending' matches the Invitations filter values ✓ (schema.ts:39-42) | OK |
| "Invitations" DataList (`email · domain · state`, filter pending/accepted) | list / filter | Tracks sent invitations and their acceptance state. | site-connections.tsx:1122-1131 | GET /api/{p}/invites → routes.ts:364-380: edge_invites WHERE user_id+provider | Verified by code; table empty in dev | OK |

### Tab "Work queue"
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Work queue" DataList (`#id · kind · state — error`, filter queued/running/done/failed/uncertain) | list / filter | Background integration jobs for this provider. | site-connections.tsx:1134-1145 | GET /api/{p}/jobs → cloudflare/routes.ts:218-233: edge_jobs JOIN edge_connections (kind or error ILIKE) | curl → total 0; SQL edge_jobs=0 ✓ | OK |

### Tab "Edge audit" (Cloudflare only)
| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Edge audit" DataList (`name · kind · state`, before/latest snapshot sample-block counts) | list | Every previewed/applied edge change, with a warning that sampled events don't prove causation. | site-connections.tsx:1146-1180 | GET /api/cloudflare/actions → cloudflare/routes.ts:616-631: edge_actions JOIN edge_assets | curl → total 0; SQL edge_actions=0 ✓ | OK |
| "Undo ConstructHUB rules" (rows in state applied/uncertain) | button | Queues removal of ConstructHUB-managed rules for that zone. | site-connections.tsx:1166-1177 | POST /api/cloudflare/undo {ids:[id]} → routes.ts:560-615: state='reverting' + edge_jobs kind='undo' (recent-auth) | Verified by code | OK |

### Other exports in this file (not elements of these two pages)
| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| LocationSearchSummary | card | "Google Search Console · property totals · last 30 days" card used on the Locations page insights tab (client/src/pages/locations.tsx:421), not on these pages. | site-connections.tsx:280-304 | GET /api/gsc/locations/:id/summary → gsc/routes.ts:259-271 → service.locationSearchClicks: gsc_analytics dimension='date', date ≥ current_date−30, one property per location (ORDER BY a.id LIMIT 1) | Read (out of scope page) | OK |
| ScanIndexingSummary | card | (Mapped above under site-scan.) | site-connections.tsx:1275-1303 | — | — | OK |

---

## client/src/pages/site-connection-guide.tsx — no route of its own; rendered as the "Guide" tab of both `/cloudflare` and `/search-console` (site-connections.tsx:436)

**What it is:** static how-to content for the two integrations. No data, no buttons except three external documentation links; same content on both provider pages. Client-only.

### Card "Put a client site behind Cloudflare"
| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| 5-step onboarding list (create account, DNS review, nameservers, registrar steps, wait for Active) | text | Walks a contractor through moving a client domain onto Cloudflare. | site-connection-guide.tsx:10-40 | client only | Read | OK |
| "Cloudflare setup instructions" | link | Official Cloudflare full-setup doc (new tab). | site-connection-guide.tsx:41-48 | https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/ | curl -sI -L → 200 ✓ | OK |

### Card "Connect Cloudflare to ConstructHUB"
| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Paragraphs: recommended Global-Key flow, what the limited token can/cannot do, agency-membership option and its breadth, fallback custom token, what Disconnect does, rule-preview caveats | text | Explains the connection security model (Global Key used once, never saved) and warns that rules can block real customers. | site-connection-guide.tsx:56-112 | client only | Read | OK |
| "Cloudflare role reference" | link | Cloudflare roles doc. | site-connection-guide.tsx:113-120 | https://developers.cloudflare.com/fundamentals/manage-members/roles/ | curl -sI -L → 200 ✓ | OK |

### Card "Connect Google Search Console"
| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| 5-step list (connect agency account, invite client user Full, worker maps properties by domain, sync up to 16 months, sitemaps/inspection) + owner-setup and disconnect paragraphs | text | How the Search Console integration works, including the property-overlap choice and the Indexing API limitation. | site-connection-guide.tsx:128-173 | client only | Read | OK |
| "Search Console API quotas" | link | Google's Search Console limits doc. | site-connection-guide.tsx:174-181 | https://developers.google.com/webmaster-tools/limits | curl -sI -L → 200 ✓ | OK |

---

## Suspected bugs

1. **site-scan.tsx · location picker count on an empty page (`locationTotal`)** — the owner sees "No Business Profile-linked locations" (and loses the "N of total" range) if they page past the end of the location list, even when locations exist. What is true: `locationTotal` comes from `locations[0].total` — a window function read off the rows of the *current page* — so an empty page (OFFSET ≥ total) reports 0. Evidence: GET /api/sitescan?locationOffset=25 → `locationTotal:0` while SQL `SELECT count(*) FROM business_locations WHERE user_id=1 AND gbp_location_name IS NOT NULL` = 1. Root cause: server/agency/middleware.ts:58 and :61 (`locationTotal: locations[0]?.total ?? 0`). Smallest fix: compute `locationTotal` with a separate `count(*)` query (or `COALESCE((SELECT total FROM locations LIMIT 1), (SELECT count(*) ...))` when the page is empty).

2. **Delegated-agency path · "Queue selected sites" (POST /api/sitescan/bulk) always 404s for delegated members** — a team member working in an owner's workspace sees the bulk-scan checkboxes (the location list is workspace-wide via the middleware) but the POST falls through the access layer: middleware.ts:83 only delegates POSTs to exact paths `/api/sitescan`, `/api/sitescan/schedule`, `/api/citations/campaigns`; `/api/sitescan/bulk` reaches line 86 (`member` → no early next), matches no object regex, and hits `if (id === undefined) throw missing()` → 404 "Record not found". Root cause: server/agency/middleware.ts:83 (path allowlist omits `/api/sitescan/bulk`). Smallest fix: include `/api/sitescan/bulk` in the allowlist with a locationIds→locationAccess loop (or an explicit "any of these locations" check). NOTE: verified by code only — the dev session is an owner, and creating a member session would need writes.

3. **Scan history silently drops scans whose linked Business Profile location was deleted (owner and member)** — a scan started with a GBP profile (`sitescan_jobs.profile` set) disappears from "History & score trend" if the `business_locations` row it points at is later deleted, because the list query only keeps profile-less jobs via the OR fallback `j.profile IS NULL`; a job with a dangling `profile->>'id'` fails `l.user_id=$1` on the LEFT JOIN and is filtered out (the shadowed owner route in server/sitescan/routes.ts:150-193 would have listed it). Root cause: server/agency/middleware.ts:56 (WHERE clause). Cannot verify with dev data — all 6 user-1 jobs have `profile IS NULL` — so this is code-derived; smallest fix: add `OR (j.user_id=$1 AND l.id IS NULL)`-style branch for owner-visible rows.

4. **Cloudflare "Enable agency membership connection" button is enabled for everyone but only works with server env** — the owner sees an enabled button; on click the server answers 503 "Agency owner, token and email are not configured" unless `CLOUDFLARE_AGENCY_USER_ID/TOKEN/EMAIL` are set. The page does show "Agency member email: Not configured" next to it, so it fails honestly rather than silently. Root cause: site-connections.tsx:590-601 (no disable on `!config.data?.agencyEmail`) + cloudflare/routes.ts:483-493. Smallest fix: disable the button (with the same tooltip) when `agencyEmail` is null. Classified UNCLEAR-by-design rather than a hard BUG.

Not bugs but noted: the GET /api/sitescan response carries a `total` field inside every job row (window-function artifact of the agency middleware, middleware.ts:56); the page ignores it. The history/status filter, per-client filter, search, and both counts were independently reproduced by SQL and matched the API exactly (6/6 jobs, 1/1 location, 0 schedules, 2 failed, 5 admin leads; all edge/gsc tables empty).

## Element counts

- client/src/pages/site-scan.tsx (incl. free/shared/admin exports): 91 elements mapped — OK 88, BUG 0, UNCLEAR 1 (agency-membership button is on site-connections), DEAD 0; +3 conditional-bug entries listed above that are server-side, not element status.
- client/src/pages/site-connections.tsx (both providers): 71 elements mapped — OK 70, UNCLEAR 1 ("Enable agency membership connection"), DEAD 0.
- client/src/pages/site-connection-guide.tsx: 6 elements mapped — OK 6.
- Suspected bugs: 4 (1 minor count bug, 2 delegated-member code-path bugs, 1 env-gated button), of which #2/#3 are code-verified only (no delegated-member session possible under SELECT-only rules).

---


Audited 2026-10-04 against worktree /home/veto/ConstructHUB-audit3 (branch audit/3), dev server http://127.0.0.1:8303 (dev bypass = user id 1, "Veto", isPlatformAdmin, company "Alpine Exteriors Test", accessPlan "agency" per /api/entitlements). DB: constructhub_dev_a6, SELECT only. Every number recomputed with SQL and compared to the live API JSON.

---

## client/src/pages/developers.tsx — route /developers

Public API reference page. It renders static documentation (authentication, limits, the no-AI rule, CRM API note) plus a live endpoint reference generated from `GET /api/v1/openapi.json`. The route is registered twice in client/src/App.tsx:235 (signed-in dashboard router) and App.tsx:316 (public router) — no guard, anyone can view it; there is no server-side access check on openapi.json (server/public-api/index.ts:51 serves it publicly, `Cache-Control: public, max-age=300`). Main data source: `GET /api/v1/openapi.json` (assembled by server/public-api/openapi.ts:64 `buildOpenApiDocument` from the registered resource fragments). Signed in, the public masthead/footer render nothing (public-page-chrome.tsx:37,72 return null when a session exists).

### Public masthead (signed-out visitors only, data-testid="header-public-page")

Rendered by PublicPageHeader → SiteNavBar (client/src/components/public-page-chrome.tsx:36-45, client/src/components/site-nav.tsx:321-357). Hidden when signed in (verified: dev session → header absent). The two dropdown panels are generated from the feature/service catalogues (shared/feature-pages, shared/dfy-pages), so individual dropdown items are data-driven (`nav-item-*` per catalogue entry); the stable chrome is mapped row by row.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| ConstructHUB logo (link-public-home) | link | Goes to the home page. | site-nav.tsx:326 | client only: wouter Link to `/` | Route `/` in App.tsx:166 (dashboard) / App.tsx:288 (public) | OK |
| Features ▾ (nav-dropdown-features) | menu | Opens a panel listing every feature page from the catalogue, plus "See every feature". | site-nav.tsx:150-175 | client only; entries from shared/feature-pages FEATURE_CATALOGUE | Code read; catalogue import verified | OK |
| Done-For-You ▾ (nav-dropdown-dfy) | menu | Opens a panel listing every done-for-you service, plus "See all services". | site-nav.tsx:176-195 | client only; entries from shared/dfy-pages DFY_CATALOGUE | Code read | OK |
| Plans (link-nav-plans) | link | Jumps to the Plans section of the home page (`/#plans`). | site-nav.tsx:64-84,331-333 | client only | Code read | OK |
| Results (link-nav-stats) | link | Jumps to the Results section of the home page (`/#stats`). | site-nav.tsx:331-333 | client only | Code read | OK |
| Coverage (link-nav-coverage) | link | Jumps to the Coverage section of the home page (`/#coverage`). | site-nav.tsx:331-333 | client only | Code read | OK |
| Sign In (link-nav-signin) | link | Goes to the sign-in page, returning here after (`/auth?next=%2Fdevelopers`). | site-nav.tsx:345-347 | client only; /auth route App.tsx:237/289 | Code read | OK |
| Get Started (link-nav-getstarted) | link | Goes to the sign-up mode of the auth page. | site-nav.tsx:348-350 | client only; /auth route | Code read | OK |
| ☰ menu button (button-landing-menu) | button | Opens the slide-over mobile menu with the same links (fold-out Features/Done-For-You groups, Pricing, Sign In, theme toggle). | site-nav.tsx:242-251, 237-315 | client only | Code read | OK |
| "See every feature" (nav-features-all) / "See all services" (nav-dfy-all) | link | Footer of each dropdown panel; goes to /features and /done-for-you. | site-nav.tsx:169, 189 | client only; routes App.tsx:208-212/310-313 | Code read | OK |

### Hero (title, description, Manage API keys)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Kicker "Developers" | text | Small orange section label above the headline. | developers.tsx:126 (Kicker primitive feature-landing/primitives.tsx:27) | client only | Code read | OK |
| Page title (text-developers-title) | text | Shows the API document's title ("ConstructHUB API" — same as the fallback, so it never visibly changes). | developers.tsx:127 | GET /api/v1/openapi.json → info.title; live value "ConstructHUB API" | curl /api/v1/openapi.json (200 JSON, 66,025 bytes) | OK |
| Description paragraph | text | Two-sentence intro; comes from the OpenAPI document's description, with "Version v1." appended from info.version. | developers.tsx:128-131 | same doc, info.description + info.version="v1" | curl; version string present | OK |
| Manage API keys (link-developers-keys) | link | Orange button to the API-keys settings section (Account → API keys). | developers.tsx:133 | client only: `/settings/api` → SettingsApiRedirect (App.tsx:145-152) → `/settings?tab=api-keys` | /settings/api route App.tsx:234; tab "api-keys" exists (pages/settings/sections.tsx:33,45,91) | OK |

### Alert banner "What the API doesn't do" (data-testid="banner-developers-no-ai")

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Banner text (text-developers-no-ai) | text | States that API keys don't get AI features, and that posts/replies/social posts sent through the API are stored exactly as sent (source: api) with no AI rewriting; AI settings can't be read or changed via the API. Sentence constant is shared with the API-keys settings panel. | developers.tsx:139-148; API_NO_AI_NOTICE at pages/settings/api/api-keys-panel.tsx:31 | Claim enforced server-side: server/public-api has no AI imports (no-ai.test.ts walks the import graph); openapi.ts:98 documents the same rule; writes stamp source: api (gbp-write.ts ensurePublicApiWriteSchema / content jobs) | curl openapi.json info.description (same rule); code read of public-api dir | OK |

### Card "Authentication" (data-testid="card-developers-auth")

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Base URL (text-developers-base-url) | text | Shows the API base: window origin + `/api/v1` (https://constructhub.us in prod, http://127.0.0.1:8303 in dev). | developers.tsx:157-158 | matches server mount: app.use("/api/v1", router) — server/public-api/index.ts:106-110 (PUBLIC_API_BASE guard.ts:13) | curl http://127.0.0.1:8303/api/v1 → 200 CRM index JSON | OK |
| Header line `Authorization: Bearer chub_<prefix>_<secret>` | text | Shows how a key is sent; keys are created in Settings → API keys. | developers.tsx:159-160 | server/public-api/auth.ts authenticates the bearer (chub_ prefix enforced, guard.ts rejectApiKeysOutsidePublicApi) | Code read (auth.ts, guard.ts) | OK |
| Scopes badges `read` / `write` | badge | Explains the two scopes: read lists/exports, write creates/updates. | developers.tsx:161-162 | server/public-api/auth.ts scopeByMethod: GET/HEAD=read, others=write → 403 insufficient_scope | Code read (index.ts:58, auth.ts) | OK |
| curl example (text-developers-curl) | text | Copy-paste curl that fetches the OpenAPI document with a bearer key. | developers.tsx:164-167 | GET /api/v1/openapi.json is public (served before authenticate — index.ts:51-56) | curl without key → 200 | OK |
| Footnote about keys never signing in to the app | text | Explains a key only works under /api/v1 and can be revoked. | developers.tsx:168-170 | keys are API-only credentials (account/api-keys.ts); no session is created | Code read | OK |

### Card "Limits and units" (data-testid="card-developers-limits")

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Rate limit bullet: "60 requests per minute per key … 429 with Retry-After" | text | States the per-key rate limit and the over-limit error. | developers.tsx:181 | server/public-api/rate-limit.ts:15 DEFAULT_RATE_PER_MINUTE=60; 429 rate_limited with Retry-After (rate-limit.ts:69-75); per-account cap 300/min across all keys | grep constants; code read | OK |
| Units bullet: "a read costs 1 unit plus 1 per 100 rows; a write 5" | text | Explains how API usage is metered. | developers.tsx:182 | server/public-api/quota.ts:21-23,28-31 READ_UNITS=1, ROWS_PER_UNIT=100, WRITE_UNITS=5 | grep constants | OK |
| Monthly quota bullet: plan units, optional per-key cap, 429 quota_exceeded / 402 plan_required | text | Explains the monthly unit quota and what error you get when exhausted or when the plan has no API access. | developers.tsx:183 | quota.ts:72-78 (unitsPerMonth<=0 → 402 plan_required), 86-100 (429 quota_exceeded, Retry-After until the 1st); month resets 1st UTC (account/api-keys.ts:248 apiMonthResetsAt) | grep; code read | OK |
| Headers bullet: X-RateLimit-Limit / -Remaining / X-Units-Remaining | text | Lists the metering headers on responses. | developers.tsx:184 | rate-limit.ts:60-61 sets X-RateLimit-*; quota.ts:101 sets X-Units-Remaining | grep | OK |
| Plan units table (table-developers-plan-units), one row-plan-units-<key> per plan | table | Shows each plan's monthly API units; a 0 shows as "No API access". Rendered only when every plan carries the value (true today). | developers.tsx:186-200; planUnits() 83-89; PLAN_KEYS order starter/pro/growth/agency (shared/plans.ts:16) | Shared price book shared/plans.ts limits.apiUnitsPerMonth: Starter 0, Pro 10,000, Growth 50,000, Agency 250,000 (plans.ts:102,125,148,171). Same numbers the server enforces via ctx.plan.unitsPerMonth (quota.ts) | Compared table source values to plans.ts lines; server uses the same PLANS map (openapi.ts:5,113) | OK |
| Fallback line (text-developers-plan-units) | text | "Your plan's monthly units are shown in Settings → API keys." — only shown if a plan lacks the units value (not reachable today). | developers.tsx:198-199 | client only | Code read | OK |

### Endpoints reference (data-testid="section-developers-endpoints")

One `<Card>` per OpenAPI tag (`card-developers-tag-<slug>`), each containing one expandable `<details>` row per operation (`endpoint-<method>-<path>`, developers.tsx:254-316: method pill, path, scope/Deprecated badges, summary; expanding shows description, unit cost, parameters, request body, responses, and a curl snippet for GETs). Live document on this server has 24 paths / 27 operations grouped under 12 tags. Loading shows 2 skeletons; failure or an empty path list shows the honest unpublished note (text-developers-unpublished, developers.tsx:214-219) — fetchOpenApi (developers.tsx:95-102) treats a non-JSON 200 as "not published". Tag grouping BUG noted in Suspected bugs: built-in `/me` is tagged `account` while the account resource uses `Account`, and the four write operations carry lowercase resource-name tags (`locations`, `reviews`, `site-scans`, `social-posts`) so they render as separate one-operation sections apart from their Title-case read sections.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Generated from /api/v1/openapi.json" (link-developers-openapi) | link | Raw JSON of the same document, for API clients / your own AI to read. | developers.tsx:209 | GET /api/v1/openapi.json → server/public-api/index.ts:51-54 → openapi.ts:64 buildOpenApiDocument | curl → 200 application/json; parsed 24 paths/27 ops | OK |
| Skeleton rows (2) | text | Placeholder while the document loads. | developers.tsx:212-213 | n/a | Code read | OK |
| Unpublished note (text-developers-unpublished) | text | Shown when the reference can't be loaded or lists nothing; static auth/limits info still applies. | developers.tsx:214-219 | n/a (fetch error path) | Code read | OK |
| GET /me (endpoint-get-me) | link | Expandable doc for "the account and key behind this token, with this month's usage". | developers.tsx:260-315 | GET /api/v1/me → public-api/index.ts:61-81 → account/api-keys.ts monthlyUsage (account_api_usage.units summed for UTC month, key + account) | Operation present in live doc; handler code read | OK |
| GET /account (endpoint-get-account) | link | Expandable doc for your account, plan, limits and API usage. | same row pattern | GET /api/v1/account → resources/account.ts (accountResource) | Live doc; resources/index.ts:23,36-39 | OK |
| GET /locations, /locations/{id}, /locations/{id}/reviews, /locations/{id}/insights, /locations/{id}/media, /locations/{id}/posts | link | Expandable docs for listing/reading locations and their reviews, daily metrics, media, post queue. | developers.tsx:254-316 | GET /api/v1/locations* → resources/locations.ts (locationsResource) | Live doc lists all 6; resources/index.ts:9-10,24 | OK |
| GET /reviews, /reviews/{id} | link | Expandable docs for listing/reading reviews. | same | GET /api/v1/reviews* → resources/reviews.ts | Live doc | OK |
| GET /insights | link | Expandable doc for daily metrics for one location (?locationId=). | same | GET /api/v1/insights → resources/insights.ts | Live doc | OK |
| GET /photos, /photos/folders | link | Expandable docs for the media library. | same | GET /api/v1/photos* → resources/photos.ts | Live doc | OK |
| GET /gbp-posts, /gbp-posts/{id} | link | Expandable docs for the Business Profile post/photo queue. | same | GET /api/v1/gbp-posts* → resources/gbp-posts.ts | Live doc | OK |
| GET /social-posts, /social-posts/{id} | link | Expandable docs for scheduled social posts. | same | GET /api/v1/social-posts* → resources/social-posts.ts | Live doc | OK |
| GET /site-scans, /site-scans/{id}, /site-scans/{id}/report | link | Expandable docs for site scans and their full reports. | same | GET /api/v1/site-scans* → resources/site-scans.ts | Live doc | OK |
| GET /citations, /citations/campaigns, /citations/campaigns/{id} | link | Expandable docs for citations and campaigns. | same | GET /api/v1/citations* → resources/citations.ts | Live doc | OK |
| POST /locations/{id}/posts (scope badge "write", 5 units) | link | Expandable doc for scheduling a Google Business Profile update with your own text. | same | POST /api/v1/locations/:id/posts → resources/gbp-write.ts gbpPostsWriteRouter (compose: resources/index-write.ts:29; registered per register.ts) | Live doc (tag `locations` — see bugs); index-write.ts | OK |
| POST /reviews/{id}/reply (write, 5 units) | link | Expandable doc for replying to a Google review with your own text. | same | POST /api/v1/reviews/:id/reply → resources/gbp-write.ts gbpReplyWriteRouter (index-write.ts:30) | Live doc | OK |
| POST /social-posts (write, 5 units) | link | Expandable doc for scheduling a social post with your own text. | same | POST /api/v1/social-posts → resources/social-write.ts (index-write.ts:31) | Live doc | OK |
| POST /site-scans (write, 5 units) | link | Expandable doc for starting a Site Scan (uses one of the plan's monthly scans). | same | POST /api/v1/site-scans → resources/sitescan-write.ts (index-write.ts:32) | Live doc | OK |

### Card "CRM API" (data-testid implicit; card at developers.tsx:235)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| CRM API card text | text | Explains the CRM's separate `chk_…` keys (created in the portal under Integrations) for customers, projects, estimates, invoices, payments; both key types share the /api/v1 base and bearer header; webhooks are signed `ConstructHUB-Signature`. | developers.tsx:235-243 | GET /api/v1 → server/crm/integrations.ts:311 returns the CRM index JSON (name ConstructHub CRM Public API, resources list, webhook signature scheme) | curl http://127.0.0.1:8303/api/v1 → 200 JSON matching every claim (auth chk_, pagination, 5 resources, ConstructHUB-Signature webhooks) | OK |
| `/api/v1` link inside the text | link | Opens the CRM API index JSON. | developers.tsx:241 | same as above | curl 200 | OK |

### Public footer (signed-out visitors only, data-testid="footer-public-page")

Rendered by PublicPageFooter (public-page-chrome.tsx:71-94); null when signed in (verified).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Home | link | Goes to the home page. | public-page-chrome.tsx:76 | client only | Route App.tsx:166/288 | OK |
| Features (link-public-footer-features) | link | Goes to the features catalogue. | public-page-chrome.tsx:78 | client only | Route App.tsx:208/310 | OK |
| Done-For-You (link-public-footer-dfy) | link | Goes to the services catalogue. | public-page-chrome.tsx:80 | client only | Route App.tsx:211/312 | OK |
| AI Call Assistant (link-public-footer-call-assistant) | link | Goes to the Call Assistant marketing page. | public-page-chrome.tsx:82 | client only | Route App.tsx:206/309 | OK |
| support@constructhub.us | link | Opens the user's mail client. | public-page-chrome.tsx:84 | mailto: | Code read | OK |
| Terms / Privacy | link | Legal pages. | public-page-chrome.tsx:86-88 | client only | Routes App.tsx:229-230/325-326 | OK |
| Footer guides (footer-guides): Google Ads Guide (link-footer-guide-google-ads-guide), LSA Guide, Click Fraud, Google Business Profile Tools | link | Four free guides linked from every public footer. | public-page-chrome.tsx:51-69 | client only | Routes exist: App.tsx:199-202 (dashboard), 303-306 (public) for the guide pages; /google-business App.tsx:192/299 | OK |
| Copyright line | text | © notice from lib/marketing copyrightNotice(). | public-page-chrome.tsx:91 | client only | Code read | OK |

---

## client/src/pages/agency.tsx — route /agency

The Agency workspace: an agency (or a contractor wearing an agency hat) manages client records, client business locations in bulk, team roles, Google onboarding emails, a background job queue, and workspace settings. Route /agency is signed-in only (App.tsx:178; listed in SIGNED_IN_ONLY App.tsx:339, redirected to /auth when signed out). Access is workspace-based: every `/api/agency/*` call (except /me and /workspace) requires the workspace OWNER's plan to include the Agency workspace module — server/agency/routes.ts:56-58 (`workspaceEntitled`, 402 plan_required otherwise); membership/role checks in server/agency/access.ts (accessFor, requireAdmin/requireWrite). Dev user 1 is owner of workspace "Agency" with the Agency plan: /api/agency/me → `{owner:1, actor:1, role:"owner", entitled:true}`. Main data sources: `/api/agency/me` (role/entitlement), `/api/agency/locations` + `/api/agency/dashboard` (locations tab), `/api/agency/clients`, `/api/agency/team`, `/api/agency/onboarding`, `/api/agency/jobs`, `/api/agency/google`. All list endpoints are scoped to `user_id = workspace owner` (SQL verified: agency_clients/agency_members/agency_onboarding/agency_jobs have rows only for user 1; business_locations has rows for users 1 (2 rows) and 2328 (1 row) — no cross-org leakage for this user).

### Page header + workspace switcher (all tabs)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Add location" button (header action, Locations tab only) | button | Opens the Locations page with the "import from Google" dialog. | agency.tsx:64 | client only: link to `/locations?import=gbp` → LocationsPage opens AddLocationDialog with the gbp tab (pages/locations.tsx:74-77,92-93) | Route /locations App.tsx:179; locations.tsx reads `import` param | OK |
| Workspace select (aria-label "Workspace") | select | Switches between your own workspace and agency workspaces you belong to; saves the choice, clears cached data and reloads. | agency.tsx:57 | POST /api/agency/workspace {owner} → server/agency/routes.ts:71-76 → sets session.agencyOwner (accessFor(actor,owner) verifies membership; plan check for others' workspaces) | Route exists with matching body (zod {owner:positiveId}); /me shows workspaces:[{user_id:1}] so only "My workspace" is listed for user 1 | OK |
| Role label next to the switcher | text | Shows your role in the open workspace (owner/admin/manager/viewer). | agency.tsx:57 | from /api/agency/me role | API shows role "owner" | OK |
| Tab bar: Locations · Clients · Team (admin+) · Onboarding · Jobs · Settings (owner only) (AppTabsList) | tab | Switches the section below; ?tab= persists the choice in the URL (bad values fall back to Locations). | agency.tsx:25-27,66 | Team tab requires admin, Settings requires owner — matches server (GET /api/agency/team requireAdmin routes.ts:100; PUT /settings owner-only routes.ts:78) | Code both sides; dev user is owner so all 6 tabs render | OK |
| Message line (role=status / role=alert) | text | Success ("Saved. Queued work appears in Jobs or Onboarding.") or error feedback from the last action; scrolls into view. | agency.tsx:32-35,67 | client only | Code read | OK |

### Not-entitled state (PlanRequired card) — conditional, not shown for this user

Shown when /api/agency/me says entitled=false (owner lacks the Agency plan): a short "you're a member of agency workspace(s)" note + switcher when applicable, then the PlanRequired card (components/plan-required.tsx:136-182: module heading + plan badge, message from /api/entitlements paymentNeeded or the 402 body, "What it does" details, price line, "See plans and pricing" (or "Update card" when the last payment failed) and removable saved connections). Server gate for everything below is the same Agency-plan check.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| plan-required-agencyWorkspace card (text-plan-required-message, link-plan-required-pricing / link-plan-required-billing) | card/button | Tells the owner the Agency workspace needs the Agency plan ($349/mo, 10 locations) and links to /pricing (or to billing when a payment failed). | plan-required.tsx:136-182 | server/entitlements getEntitlements + sendPlanRequired (402 {code:plan_required, requiredPlan:"agency"}); plan facts from shared/plans.ts agency monthlyCents 34900, limits.locations 10 | plans.ts:152-174 read; entitlements API answers accessPlan "agency" for user 1 so card not rendered in dev | OK |

### Locations tab → AgencyWorkspace → AgencyBulkWorkspace (client/src/components/agency-workspace.tsx:70-123)

Rendered because /api/agency/me entitled=true. Data: `GET /api/agency/locations?q=&status=&offset=&clientId=` (listLocations, server/agency/access.ts:93-100) and `GET /api/agency/dashboard` (dashboard(), access.ts:101-104). Both scope to the owner's rows via visibility() (access.ts:63-64: `l.user_id=$1` plus per-member client assignment).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Stat "Locations" = 2 | number | Count of locations in the open workspace matching the current search/client filter (any status). | agency-workspace.tsx:91 (Stat app-ui.tsx:175) | GET /api/agency/locations → count(*) FROM business_locations l LEFT JOIN agency_clients c … WHERE l.user_id=1 AND (visibility) AND (filters) | API total=2; SQL: SELECT count(*) FROM business_locations WHERE user_id=1 → 2. Match | OK |
| Stat "Need reconnect" = 1 | number | Count of locations whose Google listing is linked but the connected Google account/grant is missing or needs reconnect. | agency-workspace.tsx:91 | GET /api/agency/dashboard → count(*) FILTER (gbp_location_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gbp_grants g WHERE g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject AND NOT g.reconnect_required)) | API reconnect=1; SQL recompute (same FILTER) → 1 (location 506025 "AI-TEST Ridgeline Roofing"). Match | OK |
| "Agency" crumb + workspace name · role | link/text | Breadcrumb back to /agency and the open workspace's name/role. | agency-workspace.tsx:92 | /api/agency/me workspace.name = "Agency" | API | OK |
| Search input (placeholder "Global location search") | input | Filters the location list (and the status counts) by text matched against business name, address, city, state, ZIP, place ID and client name. | agency-workspace.tsx:95 (Toolbar app-ui.tsx:238) | passed as q to /api/agency/locations and /api/agency/dashboard: concat_ws(' ',l.business_name,l.address,l.city,l.state,l.zip_code,l.place_id,c.name) ILIKE '%q%' (escapes %,_) | Code read; tested ?q=roofing → 1 row (506025) | OK |
| "Find client…" input | input | Filters the client dropdown options below it. | agency-workspace.tsx:96 | client only (filters the /api/agency/clients?q= query that fills the selects) | Code read | OK |
| Client filter select (aria-label "Client filter") | select | Limits the list/counts to one accessible client ("All accessible clients" = everything your role can see). | agency-workspace.tsx:97 | clientId param → `l.agency_client_id=$4` in locationFilter (access.ts:88-89) | Code read | OK |
| Location status select (aria-label "Location status", 7 options with live counts) | select | Filters by Google/Guard/review/post status; each non-All option shows its count from the dashboard. Options: All statuses, Synced, Needs reconnect, Not linked, Guard alerts, Unanswered reviews, Failed posts. | agency-workspace.tsx:98; statusLabels:29 | statusSql map access.ts:78-86 (synced=linked+live grant+successful sync ever; reconnect=linked but grant missing/reconnect_required; unlinked=gbp_location_name IS NULL; guard=pending gbp_guard_changes; unanswered=reviews without a reply not google_deleted; failed=gbp_content_jobs in failed/uncertain/rejected). Counts from /api/agency/dashboard which forces status 'all' but keeps q/clientId | API {total:2,synced:0,reconnect:1,unlinked:1,guard:0,unanswered:0,failed:0}; SQL recomputed each FILTER → identical | OK |
| "Could not load locations." error line | text | Shown if the locations query errors. | agency-workspace.tsx:100 | n/a | Code read | OK |
| Select page / Select all matching (N) / Clear selection / "N selected" | button | Bulk-selection controls for the table checkboxes ("all matching" selects every row under the current filters, not just this page). | agency-workspace.tsx:102-108 | client only (selection state); the server re-applies filters for allMatching selections | Code read | OK |
| Export selected CSV / Export matching CSV (`/api/agency/export?…`) | link | Downloads a CSV of the selected or filtered locations (ID, client, business, address, city, state, place ID, Google location). | agency-workspace.tsx:106,108 | GET /api/agency/export → server/agency/routes.ts:132-141 → streams business_locations (+client name) rows through locationFilter, cursor-paged 500s; optional ids re-checked per-row via locationAccess | curl (GET) → 200 text/csv with exactly the 2 rows of user 1 (104296, 506025), matching the list | OK |
| Locations table rows (agency-location-<id>) | table / clickable rows | Each row: checkbox (aria-label "Select <name>"), location name button (opens that location on the Locations page), client name ("Unassigned" when none), full address, Google Linked/Not linked pill. | agency-workspace.tsx:109 | data from listLocations: SELECT l.*, c.name client_name FROM business_locations l LEFT JOIN agency_clients c … WHERE visibility+filters ORDER BY l.id LIMIT 50 OFFSET | API rows == SQL SELECT * FROM business_locations WHERE user_id=1 ORDER BY id (2 rows, ids 104296/506025, client NULL). Match | OK |
| Pager: Previous page / "1–2 of 2" / Next page | button | Pages the 50-row location list. | agency-workspace.tsx:110 (Pager:26-28) | offset param → LIMIT 50 OFFSET | Code read | OK |
| Bulk action select (aria-label "Bulk action", 8 options) | select | Chooses what to apply to the selected locations: Sync now, Link & sync, Unlink, Assign client, Set Guard mode, AI reply settings, Schedule post/photo batch, Start Site Scans. | agency-workspace.tsx:112 | POST /api/agency/bulk {requestKey: uuid, action, payload, selection:{ids|allMatching+filters}} → server/agency/routes.ts:127-131 → jobs.ts queueBulk: parses bulkInput, checks per-location access, dedupes by requestKey, caps queue at 20,000 pending, inserts one agency_jobs row per location (INSERT … SELECT FROM locationJoin WHERE filters AND (allMatching OR id=ANY(ids))), returns 202 {queued:n} | Route + body schema verified (jobs.ts:17-21,29-56); each action's payload validated by validatePayload (jobs.ts:22-28) | OK |
| Assign to client select | select | Shown for action=assign; picks the client to assign. | agency-workspace.tsx:113 | payload {clientId} → validatePayload assign → clientAccess check; job performJob updates business_locations.agency_client_id (jobs.ts:92-95) | Code read | OK |
| Guard mode select (Off/Notify/Lockdown) + approval note | select/text | Shown for action=guard; sets Profile Guard mode. The note states locations without an approved snapshot fail safely. | agency-workspace.tsx:114 | payload {mode, watched[11 fields]} → validatePayload guard (jobs.ts:23) → configureGuard (gbp/guard.ts); POST /api/agency/bulk itself 403s with {reauth:true} unless recent identity check (routes.ts:129, gbp/guard-routes.ts) | Client watched list == GUARD_FIELDS (guard.ts:10); schema match | OK |
| AI reply mode select (Off / Draft / Auto-publish 3–5★) + tone input + sign-off input + note | select/input | Shown for action=ai-replies; configures AI review-reply behavior for future reviews on selected locations. | agency-workspace.tsx:115 | payload {mode, scope:'future', tone, signOff} → validatePayload ai-replies → replySettingsSchema (gbp/review-automation.ts:12-20, defaults fill maxLength 600 etc.) → saveReplySettings per location | Schema fields match; note "Low ratings stay drafts" matches shouldAutoPublish (rating>2 unless allowLowRatingAuto, review-automation.ts:23) | OK |
| Content kind select (Post/Photo batch) + approved-content textarea + media photo IDs input + batch start time + note | select/input | Shown for action=content; queues an approved post or photo batch for every selected location. | agency-workspace.tsx:116 | payload {approved:true, items:[{kind:'post',summary,photoIds}|per-photo {kind:'photo',…}], schedule:{start ISO}} → validatePayload content (jobs.ts:25) → itemInput/scheduleInput (gbp/content.ts:37-56); enqueueContent per location (jobs.ts:96); "Photos must belong to the agency" enforced by itemInput id checks | Payload shape matches schemas; note about content queue/daily budget matches enqueue path | OK |
| Unlink explanatory note | text | States unlink removes synced Google data here and stops syncing, but does not remove the listing from Google. | agency-workspace.tsx:117 | action=unlink payload {} → performJob → unlinkLocation (gbp/service) clears gbp_* fields | Code read | OK |
| "Queue selected action" / "Approve & queue batch" button | button | Queues the chosen action for all selected locations; on success shows "<n> location actions queued. See Agency → Jobs for progress and failures." | agency-workspace.tsx:118 | POST /api/agency/bulk (above) → 202; worker runAgencyJobs (jobs.ts:114-147) runs each agency_jobs row per plan (non-sync actions fail with agencyPlanPaused when the plan lapses; sync requires an active plan) | Endpoint verified (routes.ts:127); success message text from onSuccess agency-workspace.tsx:90 | OK |
| Bulk result message (role=status) | text | Result of the last bulk queue attempt. | agency-workspace.tsx:121 | client only | Code read | OK |

### Clients tab (agency.tsx:72-75)

Data: `GET /api/agency/clients?q=&offset=` → routes.ts:83-89 — agency_clients WHERE user_id=owner AND (allClients OR assigned) AND name/contact_email/folder/tags ILIKE, LIMIT 50 + count.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Search input (aria-label "Search agency records") | input | Filters clients by name, contact email, folder or tags. | agency.tsx:69 | q → concat_ws ILIKE (routes.ts:84-85) | Code read | OK |
| Client form (write roles only): name, contact email, "More client details" (folder, tags, notes) | input | Creates a new client or edits the one loaded via "Edit"; tags are comma-separated. | agency.tsx:73 | POST /api/agency/clients {name,contactEmail,notes,tags,folder} → routes.ts:90-94 INSERT agency_clients(user_id=owner) (admin+allClients required); PUT /api/agency/clients/:id same body → routes.ts:95-98 UPDATE | Body matches clientInput zod (routes.ts:27); endpoint verified | OK |
| Create client / Save client button | button | Validates name (and email format) client-side, then sends the create/update. | agency.tsx:38-42,73 | as above | Code read | OK |
| New client (ghost, while editing) | button | Clears the form back to create mode. | agency.tsx:73 | client only | Code read | OK |
| Client rows: name, "email · folder · tags", notes, "Edit <name>" | link/button | Lists each client; Edit loads it into the form. | agency.tsx:74 | GET list as above | API items: 2 clients (ids 21, 22) == SQL SELECT count(*) FROM agency_clients WHERE user_id=1 → 2. Fields match columns | OK |
| Pager | button | Pages clients (50/page). | agency.tsx:79 | total from count(*) | API total=2 | OK |

### Team tab (admin+; agency.tsx:76)

Data: `GET /api/agency/team?q=&offset=` → routes.ts:99-102 — agency_members JOIN users (email ILIKE), each with ARRAY of agency_member_clients client_ids, LIMIT 50.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Team roles and access" details | text | Explains roles: owners manage membership, admins manage clients, managers manage locations, viewers read; unassigned locations need all-client access. | agency.tsx:76 | matches access model (access.ts requireAdmin/requireWrite; visibility() requires allClients or assignment) | Code read both sides | OK |
| Member form (owner only): registered email, role select (admin/manager/viewer), "All clients" checkbox, client IDs input + live "id: name" list, Save member | input/select/button | Adds a registered ConstructHUB user to the team or updates their role/client access; client IDs must be numbers from the listed clients. | agency.tsx:76 | PUT /api/agency/team {email,role,allClients,clientIds} → routes.ts:103-122: looks up users.id by lower(email), validates clientIds belong to owner, inserts/updates agency_members + agency_member_clients under a seat lock (403 seatLimitBody when the owner's plan seats are full) | Body matches zod (routes.ts:106); endpoint verified; members list empty for user 1 (API total=0, SQL agency_members WHERE user_id=1 → 0) | OK |
| Member rows: "email · role · clients" + Remove member (owner only) | text/button | Lists each member; Remove deletes them from the workspace. | agency.tsx:76 | DELETE /api/agency/team/:member_id → routes.ts:123 DELETE agency_members (owner only) | Endpoint verified; no rows in dev | OK |
| Pager | button | Pages members. | agency.tsx:79 | total via count(*) OVER() | API total=0 | OK |

### Onboarding tab (agency.tsx:77)

Data: `GET /api/agency/onboarding?q=&offset=` → routes.ts:177-180 — agency_onboarding JOIN agency_clients, scoped per member assignment, business_name ILIKE, 50 rows; each item gets a `link` built from its encrypted token (`APP_URL/api/agency-onboarding/<token>`). Note: this endpoint returns **no `total`**, so the Pager total on this tab is a client-side guess — see Suspected bugs. Refreshes every 10 s.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Search input | input | Filters requests by business name. | agency.tsx:69 | r.business_name ILIKE '%q%' (routes.ts:178) | Code read | OK |
| Onboarding form (write roles): client select, agency Google account select, business name, address, Place ID | select/input | Builds the "email Google manager instructions" request: which client, which connected agency Google email the client should invite, and the exact Google business name plus address or Place ID. | agency.tsx:77 | options from /api/agency/clients and /api/agency/google (grantStatus, gbp/grants.ts) — for user 1: google.accounts=[] | API /api/agency/google → {connected:false, accounts:[]} | OK |
| "No agency Google account is connected…" note + Connect agency Google account link (owner) | link | Explains the button is disabled until an agency Google account is connected; the owner gets a direct connect link. | agency.tsx:77 | link → GET /api/gbp/connect (server/gbp/routes.ts:32-44) — starts Google OAuth, or redirects a plain navigation to /locations?gbp=reauth when identity wasn't recently verified | Route verified; rate-limited google-connections (routes.ts:26) | OK |
| Email manager instructions button | button | Validates the four fields client-side, then queues the instructions email to the client's contact address. | agency.tsx:49-55,77 | POST /api/agency/onboarding {clientId,subject,businessName,address?,placeId?} → routes.ts:176 → onboarding.ts createOnboarding: validates client + contact email, verifies subject against gbp_grants with the business.manage scope, daily cap 100/owner (takeBudget), INSERT agency_onboarding (status 'sent', expires_at now()+30 days, token hashed+encrypted) → 202 {queued}; the onboarding worker (onboarding.ts:112-141, 1-min tick) actually sends the email and later accepts the matching Google invitation | Schema match (onboardingInput onboarding.ts:22); defaults verified in DB (\d agency_onboarding: status 'sent', expires_at now()+30 days); "reminders after three and six days" matches worker reminder_at/reminders<2 logic; "expire after 30 days" matches default | OK |
| "What the client receives" details | text | Explains the client keeps ownership, adds the agency email as Manager; reminders after 3 and 6 days; expiry after 30 days. | agency.tsx:77 | matches sendOnboarding/instructions() text and pollInvitations auto-accept flow | Code read | OK |
| Request rows: business name, "status · contact → agency email", error line, read-only link input, Copy link, Send reminder | text/button/input | Lists each request; Copy link copies the client's instructions URL to the clipboard; Send reminder re-queues the reminder email (once per day per request). A fresh request shows "Email queued" until the worker marks it sent. | agency.tsx:77 | GET list as above; POST /api/agency/onboarding/:id/remind → routes.ts:181-183: owner-scoped, rate-limited 1/day (takeBudget), sets reminder_at=now()-4d/reminders≤1 so the worker sends on its next tick; Copy link is client-only clipboard | Route verified; 0 rows for user 1 (API items=[], SQL agency_onboarding WHERE user_id=1 → 0) | OK |
| Pager | button | Pages requests — **total is guessed client-side** (see bugs). | agency.tsx:79 | API returns no total | curl response lacks "total"; other endpoints include it | BUG |

### Jobs tab (agency.tsx:78)

Data: `GET /api/agency/jobs?q=&offset=` → routes.ts:142-145 — agency_jobs JOIN business_locations (+client) WHERE visibility+filters, ORDER BY created_at DESC, 50 rows, count(*) OVER() total. Refreshes every 10 s.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Search input | input | Filters jobs by location text (business name/address/etc.). | agency.tsx:69 | q via locationFilter concat_ws ILIKE (routes.ts:143-144) | Code read | OK |
| Job rows: "business · action · status" + error line | text | Shows each queued/running/finished background action (sync, unlink, link, guard, ai-replies, assign, content, scan) and its error when failed. | agency.tsx:78 | agency_jobs columns id,batch_id,action,location_id,status,error,created_at,finished_at + business_name | API items=[] total=0; SQL SELECT count(*) FROM agency_jobs WHERE user_id=1 → 0 | OK |
| "No queued actions." empty state | text | Shown when the jobs list is empty. | agency.tsx:78 | n/a (list is all jobs, not just queued — text only appears when there are none at all) | Code read | OK |
| Pager | button | Pages jobs. | agency.tsx:79 | total from count(*) OVER() | API total=0 | OK |

### Settings tab (owner only; agency.tsx:71)

Data: current values from /api/agency/me → workspace {name, auto_accept_all} (workspace row verified: name "Agency", auto_accept_all false, updated 2026-09-30).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Agency name input (placeholder = current name) | input | Renames the agency workspace (falls back to the current name when left blank). | agency.tsx:71 | PUT /api/agency/settings {name, autoAcceptAll} → routes.ts:77-82 → INSERT … ON CONFLICT (user_id) DO UPDATE agency_workspaces(name, auto_accept_all, updated_at) + activity log | Body matches zod; endpoint verified by code | OK |
| "Auto-accept all location invitations" checkbox + explanation ("Unmatched invitations stay unassigned… Current setting: disabled") | input/text | When on, the background worker accepts any unmatched Google invitation on connected agency accounts; when off, only invitations matching an open onboarding request are accepted. The text states the current setting. | agency.tsx:71 | auto_accept_all read by pollInvitations (onboarding.ts:48,64); persisted by the same PUT | DB column auto_accept_all=false matches "Current setting: disabled" | OK |
| Save agency settings button | button | Saves name + auto-accept choice. | agency.tsx:71 | PUT /api/agency/settings (above) | Code read | OK |
| Connect agency Google account link | link | Starts Google OAuth for an agency Google account (asks to verify identity first when needed). | agency.tsx:71 | GET /api/gbp/connect (gbp/routes.ts:32) | Route verified | OK |
| Refresh Google listings in background button | button | Queues a refresh of the connected accounts' Google Business Profile discovery (used by "Import from GBP" and Link & sync). | agency.tsx:71 | POST /api/agency/google/refresh {} → routes.ts:169-175: requireAdmin + allClients, rate-limited 1/10min per owner, marks agency_poll_grants refresh_requested=true for every connected gbp_grant → 202 {queued}; worker runs refreshDiscovery (jobs.ts:61-67) | Endpoint + body verified; admin role required matches "owner-only tab" | OK |
| Pager | button | Hidden on this tab (`tab!=='settings'` guard). | agency.tsx:79 | n/a | Code read | OK |

### Fallback locations list (non-entitled owners only — not reachable for this user)

When /me says entitled=false, AgencyWorkspace renders OwnLocations (agency-workspace.tsx:38-69): own-location table served by `GET /api/locations?paged=true&q=&status=&offset=` (intercepted by the agency middleware for every signed-in user, server/agency/middleware.ts:29-33 → listLocations with the same filters), single-location shortcut card, empty state with "Import your Business Profile" (/locations?import=gbp) and, when the account has no plan at all, a "See plans" button (/pricing) plus a note that bulk features need the Agency plan (link to /pricing). All links/routes verified above; the location limit copy uses STARTING_MONTHLY_CENTS from shared/plan-copy.

---

## Suspected bugs

1. **agency · Onboarding tab pager shows a guessed total** — Owner sees "1–50 of 51"-style ranges on the Onboarding tab: `Pager` receives `list?.total ?? (items.length===50 ? offset+51 : offset+items.length)` (client/src/pages/agency.tsx:79) because `GET /api/agency/onboarding` is the only list endpoint that returns `{items}` with **no `total`** (server/agency/routes.ts:177-180; clients/team/jobs all return a real total — e.g. curl /api/agency/team shows `"total":0`). Evidence: `curl -s http://127.0.0.1:8303/api/agency/onboarding?q=&status=all&offset=0` → `{"items":[]}` (no total key). With exactly 50 items it shows "of 51" and enables a Next page that then reads "51–50 of 50". Root cause: routes.ts:177-180 omits a `count(*)` (unlike routes.ts:101 and :144 which use `count(*) OVER()`). Smallest fix: add `count(*) OVER()::int total` to the onboarding SELECT and return `{items, total}` — then agency.tsx:79's fallback never engages.

2. **developers · Endpoint reference splits into near-duplicate tag sections** — The owner sees two "account" sections (`account` with GET /me, `Account` with GET /account) and four one-off lowercase sections (`locations`, `reviews`, `site-scans`, `social-posts`) holding only the write operations, separate from the Title-case read sections (`Locations`, `Reviews`, `Site scans`, `Social posts`) — so e.g. the GET and POST docs for `/locations/{id}/posts` live in different cards. Evidence: live doc — GET /me has `tags:["account"]` (server/public-api/openapi.ts:69) while GET /account has `tags:["Account"]` (resources/account.ts:50,54); writes get `tags:[tag]` with the lowercase resource name (resources/shared-write.ts:117 via index-write.ts:29-32). 12 tag cards render where 8 would do. Root cause: tag strings aren't normalized across the built-in doc, read fragments, and write fragments. Smallest fix: use one canonical tag per resource (e.g. "account" everywhere and Title-case tags for writes, or normalize case when building `tags` in openapi.ts:76-84 and in the page's `tags` memo developers.tsx:107-111).

### Notes (not element bugs)
- client/src/pages/agency.tsx imports `useAgencyFilter` from agency-workspace but never uses it (dead import, agency.tsx:6); the page keeps its own useState search/offset.
- developers.tsx:184 says the rate-limit/quota headers appear "on every response"; they are set only once a request passes key authentication (401/404 responses carry none) — materially true for real API calls, not worth an owner-facing change.

## Verification summary

- Recomputed with SQL (psql, SELECT only) and matched against live API JSON for: locations total (2=2), dashboard status counts (synced 0, reconnect 1, unlinked 1, guard 0, unanswered 0, failed 0 — all six matched), clients (2=2), team members (0=0), onboarding (0=0), jobs (0=0), CSV export rows (2 rows, same ids as the list).
- Cross-org check: agency_clients/agency_members/agency_onboarding/agency_jobs contain rows only for user_id=1; business_locations also has one row for user 2328, which never appears in user 1's API responses (visibility filter `l.user_id=$1` confirmed in every query).
- Buttons verified by code against server handlers: POST/PUT /api/agency/clients, PUT/DELETE /api/agency/team, POST /api/agency/workspace, PUT /api/agency/settings, POST /api/agency/bulk (+ per-action payload schemas), POST /api/agency/google/refresh, POST /api/agency/onboarding(+/:id/remind), GET /api/agency/export.
- Links verified: /settings/api → settings?tab=api-keys (section exists), /locations?import=gbp (dialog opens, locations.tsx:74-77), /pricing, /features, /done-for-you, /call-assistant, guide routes, /api/v1 (200 CRM index), /api/v1/openapi.json (200 JSON), /api/gbp/connect (route exists; navigation → /locations?gbp=reauth without recent auth), external https://support.google.com/business/answer/3403100 (200 via GET).
- Could not verify by execution (no writes allowed): POST/PUT/DELETE side effects (client create, member save, bulk queue, settings save, onboarding send) — verified by matching request shapes to the server's zod schemas and handlers instead. The OwnLocations fallback and PlanRequired card don't render for this entitled dev user — mapped by code read only.
