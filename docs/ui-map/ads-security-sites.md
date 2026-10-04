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
