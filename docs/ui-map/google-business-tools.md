# Lane 2 UI map — Google Business tools

One section per page. Every container on each page is mapped element by element: each number/stat/badge, button, tab, link, input and select a user can see or press.

- Pages: /google-business, /google-profile, /gbp-content, /gmb-monitor, /locations, /google-reviews, /review/:token, /review/:token/unsubscribe, /schedules, /photos, /media-library, /social-media, /ranking-grid, /competitors, /mail-alerts.
- Environment: dev server on port 8302 (2026-10-04), signed in via dev bypass as user 1 (dev@constructhub.local, platform admin, accessPlan agency, hasGbpAccess=false); DB constructhub_dev_a6 via read-only psql; Playwright renders; routes confirmed in client/src/App.tsx.
- Status legend: OK = verified against SQL/API/render; BUG = verified wrong (see BUGS.md in the audit lane dir); UNCLEAR = could not prove either way (why is stated); DEAD = does nothing / goes nowhere.
- Verified how legend: SQL/curl/Playwright = actually executed; "code" = verified by reading the server route/storage code (pressing was unsafe or external).


---

*Batch 1 — pages /google-business, /google-profile, /gmb-monitor, /gbp-content.*

Auditor: lane2 subagent. Date: 2026-10-04. Environment: dev server http://127.0.0.1:8302, dev bypass signed in as user 1 (dev@constructhub.local, platform admin, hasGbpAccess=false). DB `constructhub_dev_a6` read via psql (SELECT only). Screenshots in this directory.

Backend cross-reference (verified by curl/SQL):
- `curl GET /api/locations?paged=true&offset=0` → `{"items":[104296 "K- Social workbench fixture" (not linked), 506025 "AI-TEST Ridgeline Roofing" (gbpLocationName=locations/aitest900001)], "total":2, "offset":0, "pageSize":50}`
- `curl GET /api/gmb/listings` → `[]` (SQL `SELECT count(*) FROM gmb_listings` → 0; `gmb_edit_history` → 0)
- `curl GET /api/gbp/content/506025` → `{"jobs":[],"style":null,"workerEnabled":false}`
- `curl GET /api/gbp/content/506025/photos` → `[]` (SQL `media_photos` → 0)
- `curl GET /api/gbp/status` → `{"connected":false,"accounts":[],"locations":[{"id":506025,…,"last_success":null}]}`
- `curl GET /api/gbp/linkage` → `{"total":2,"locations":[{"id":104296,"state":"unlinked"},{"id":506025,"state":"reconnect","accountEmail":null}]}`
- `curl GET /api/agency/me` (user 1) → `{"entitled":true,…}` (platform admin runs entitled per server/agency/access.ts:12-15)
- `curl GET /api/agency/dashboard?…` → `{"total":2,"synced":0,"reconnect":1,"unlinked":1,"guard":0,"unanswered":0,"failed":0}`
- `formatUsd(GBP_REINSTATEMENT_CENTS)` = `formatUsd(59900)` = `"$599"` (shared/plans.ts:413, shared/plan-copy.ts:20-26; recomputed with node)
- All 8 target routes exist in client/src/App.tsx: `/photos`:172, `/locations`:179, `/gmb-monitor`:174, `/ranking-grid`:175, `/pricing`:176 (also 294), `/google-profile`:180, `/gbp-content`:184, `/reinstatement`:191 (also 298), `/google-business`:192 (also 299), `/auth`:237.

---

## /google-business — client/src/pages/google-business.tsx

Marketing landing page for the Google Business Profile tool suite. When a user session exists it renders a compact in-app variant inside `AppPage`; signed-out visitors get the full public page. Static copy only — the code comment (google-business.tsx:19-20) states "No unsourced statistics on this page" and the copy is qualitative ("usually three" Local Pack etc.); no fabricated numbers found. Dev always renders the logged-in variant (dev bypass auto-authenticates every request, so the public variant was verified by code, not rendered).

### Logged-in variant (what dev renders) — container: AppPage header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-hero-title` ("Google Business") | text | Page title. | google-business.tsx:107 | client only: static copy | Playwright /google-business | OK |
| PageHeader description | text | One-line summary of the page. | google-business.tsx:107 | client only: static copy | Playwright | OK |
| `link-hero-start` ("Start monitoring") | button | Goes to the GMB Edit Monitor tool. | google-business.tsx:107 | client only: `<Link href="/gmb-monitor">`; route exists App.tsx:174 | Playwright (href=/gmb-monitor) | OK |

### Logged-in variant — container: Section "Your Google tools" (id="tools")

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section title "Your Google tools" + `link-hero-explore` ("Explore all tools") | link | Scrolls to this same tools section. | google-business.tsx:108 | client only: `<a href="#tools">` | Playwright (href=#tools) | OK |
| `card-tool-0` ("Profile monitor") | link | Opens the GMB Edit Monitor. | google-business.tsx:109 | client only: Link `/gmb-monitor` (App.tsx:174) | Playwright | OK |
| `card-tool-1` ("Ranking grid") | link | Opens the ranking grid tool. | google-business.tsx:109 | client only: Link `/ranking-grid` (App.tsx:175) | Playwright | OK |
| `card-tool-2` ("Photo optimizer") | link | Opens the photo optimizer. | google-business.tsx:109 | client only: Link `/photos` (App.tsx:172) | Playwright | OK |
| `card-tool-3` ("Locations") | link | Opens the locations manager. | google-business.tsx:109 | client only: Link `/locations` (App.tsx:179) | Playwright | OK |
| `card-tool-4` ("Reinstatement") | link | Opens the GBP reinstatement page. | google-business.tsx:109 | client only: Link `/reinstatement` (App.tsx:191) | Playwright | OK |

### Logged-in variant — container: `<details>` "About Google Business Profile"

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `badge-hero` ("Google Business Profile Suite for Contractors") | text | Product badge line (note: same testid as the public hero badge; the two variants never render together). | google-business.tsx:112 | client only: static copy | Playwright | OK |
| `card-stat-0..3` (Local Pack / Public Edits / Reviews / Calls & Directions) | text | Four qualitative points about how Google profiles work. No numbers. | google-business.tsx:113 | client only: static copy (opportunity array, google-business.tsx:21-26) | Playwright | OK |
| `card-pipeline-01..03` (Claim & Verify / Optimize / Check & Improve) | text | The 3-step service process. | google-business.tsx:114 | client only: static copy (pipeline array, :86-90) | Playwright | OK |
| `link-pipeline-cta` ("Open monitor") | button | Goes to the GMB Edit Monitor. | google-business.tsx:115 | client only: Link `/gmb-monitor` | Playwright | OK |
| `card-insight-0..5` (6 "things most contractors don't know") | text | Educational cards; all qualitative, no statistics. | google-business.tsx:116 | client only: static copy (keyPoints array, :92-99) | Playwright | OK |
| `card-comparison` ("Keep your details current…") | text | One-line without-vs-with summary. | google-business.tsx:117 | client only: static copy | Playwright | OK |
| `text-final-cta` ("Keep your profile up to date") | text | Closing line. | google-business.tsx:118 | client only: static copy | Playwright | OK |
| `link-final-start` ("Open monitor") | button | Goes to the GMB Edit Monitor. | google-business.tsx:119 | client only: Link `/gmb-monitor` | Playwright | OK |
| `link-final-pricing` ("View plans") | button | Goes to the pricing page. | google-business.tsx:119 | client only: Link `/pricing` (App.tsx:176) | Playwright | OK |

Note: the logged-in variant does NOT render the tool feature lists, so the "$599 flat rate" reinstatement price string does NOT appear for signed-in users on this page (verified: `document.body` text contains no "$599" on dev). Signed-out users see it in the public tools grid (below). The price still appears on `/reinstatement` itself. Observation, not a bug.

### Public variant (signed-out; verified by code — dev bypass prevents rendering it logged out)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Hero logo + `badge-hero` | badge | Branding for the suite. | google-business.tsx:131-137 | client only | code (could not render signed-out on dev) | OK |
| `text-hero-title` ("Own Your Local Search Results") | text | Public headline. | google-business.tsx:138-146 | client only | code | OK |
| Hero subcopy | text | Explains the suite. | google-business.tsx:147-150 | client only | code | OK |
| `link-hero-start` ("Start Monitoring") | button | Signed-out: goes to `/auth?mode=signup`; signed-in: `/gmb-monitor`. | google-business.tsx:153-157 | client only; `/auth` route App.tsx:237 | code | OK |
| `link-hero-explore` ("Explore All Tools") | button | Smooth-scrolls to `#tools`. | google-business.tsx:158-162 | client only | code | OK |
| 4 hero checkmarks (on-demand checks, AI review responses, ranking grids, SEO photos) | text | Feature teasers, qualitative. | google-business.tsx:164-177 | client only | code | OK |
| `card-stat-0..3` | text | Same four opportunity cards as logged-in variant. | google-business.tsx:193-201 | client only | code | OK |
| `card-tool-0..4` tools grid (GBP Monitor / Ranking Grid / SEO Photo Optimizer / Locations Manager / GBP Reinstatement) | link | Signed-out each card links to `/auth?mode=signup`; signed-in to the tool. Badges: Monitoring / Rankings / Optimization / Analytics / Recovery. | google-business.tsx:205-250 (tools array :28-84) | client only | code | OK |
| — "…$599 flat rate" feature bullet on the Reinstatement card | text | Renders `formatUsd(GBP_REINSTATEMENT_CENTS)` = "$599" — matches the price book constant 59_900 cents (shared/plans.ts:413). | google-business.tsx:82 | client only; constant verified by node recompute | code + node | OK |
| `card-pipeline-01..03` + `link-pipeline-cta` ("Start Monitoring Now") | text/button | 3-step process; CTA → `/gmb-monitor` (signed-in) or `/auth?mode=signup` (signed-out). | google-business.tsx:252-296 | client only | code | OK |
| `card-insight-0..5` | text | Same six insight cards. | google-business.tsx:298-326 | client only | code | OK |
| `card-comparison` (Without Protection vs With Our Suite) | text | Two-column qualitative comparison; no invented numbers. | google-business.tsx:328-378 | client only | code | OK |
| `text-final-cta` + `link-final-start` + `link-final-pricing` ("View Plans & Pricing") | text/button | Final CTA; pricing link → `/pricing` (exists, App.tsx:176/294). | google-business.tsx:380-406 | client only | code | OK |

Page totals /google-business: 31 mapped rows — OK 31, BUG 0, UNCLEAR 0, DEAD 0.

---

## /google-profile — client/src/pages/google-profile.tsx

Redirect shim for the sidebar "Google Profile" button: it asks how many locations the account has and routes accordingly — exactly 1 → that location's profile page (`/locations?location=<id>`), 0 → the Google import flow (`/locations?import=gbp`), more than 1 or any error → the locations list (`/locations`). While deciding it shows a spinner page.

### Container: redirect shim (whole page)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| `page-google-profile` + PageHeader "Google Profile" | text | Loading page shown while the location count is fetched. | google-profile.tsx:27-29 | client only | Playwright (transient) | OK |
| `GET /api/locations?paged=true&offset=0` | request | Counts the account's locations to pick the redirect target. | google-profile.tsx:15-18 | GET /api/locations → intercepted by server/agency/middleware.ts:29-33 (`app.use`, registered routes.ts:304, before routes.ts:2672) → `listLocations(a, filters.parse(req.query))` server/agency/access.ts:93-100 → SQL `SELECT l.*,c.name AS client_name FROM business_locations l LEFT JOIN agency_clients c … WHERE l.user_id=$1 AND (visibility) AND (client/q/folder/tag/status filters) ORDER BY l.id LIMIT 50 OFFSET $8` + `SELECT count(*)::int total` with the same WHERE. Envelope `{items,total,offset,pageSize:50}` returned because `?paged=true` (middleware.ts:32). Filters: q='', clientId none, folder none, tag none, status='all', offset=0 — no time window. For an agency member the visibility clause scopes to assigned clients; for the owner it is all their locations. | curl (returned total:2 for user 1) + code | OK |
| Redirect total==1 → `/locations?location=<id>` | link | One location: straight to its profile. | google-profile.tsx:22 | client only: `setLocation(`/locations?location=${data.items[0].id}`, {replace:true})` | code (dev user has 2 locations, branch unreachable here) | OK |
| Redirect total==0 → `/locations?import=gbp` | link | No locations: straight to importing from Google. | google-profile.tsx:23 | client only | code (branch unreachable on dev) | OK |
| Redirect total>1 or error → `/locations` | link | Several locations (or a failed request): show the list to pick from. | google-profile.tsx:20,24 | client only | Playwright: `/google-profile` landed on `http://127.0.0.1:8302/locations` (total=2 branch) | OK |

Page totals /google-profile: 5 mapped rows — OK 5, BUG 0, UNCLEAR 0, DEAD 0.

---

## /gmb-monitor — client/src/pages/gmb-monitor.tsx

GBP edit monitor: the owner adds Google Business listings by searching Google, then checks them on demand to spot changes (name, address, phone, website, category, hours, photo count, rating, review count) against Google's live Places data, with a per-listing edit history. Includes an AI review-response drafting tool. DB is empty for user 1 → the page renders its honest empty state (verified).

### Container: page header + actions

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-page-title` ("GMB Edit Monitor") | text | Page title. | gmb-monitor.tsx:552 | client only | Playwright | OK |
| PageHeader description + "Checks run on demand; this tool does not send automatic alerts." | text | Sets expectations: no automatic monitoring/alerts. | gmb-monitor.tsx:552,556 | client only (honest — no scheduler writes alerts for this tool) | Playwright | OK |
| `button-add-listing` ("Add business") | button | Toggles the "Find a business on Google" search card. | gmb-monitor.tsx:553,557-612 | client only (toggle) | Playwright (dialog opened) | OK |
| `button-check-all` ("Check all (N)") | button | Visible only when N≥1 listings have "Include in Check All" on; loops `POST /api/gmb/listings/:id/check` sequentially over the monitoring listings, then toasts a summary (counts of changes, baselines, failures — never reports "no changes" for listings that failed). | gmb-monitor.tsx:554,502-546 | per-listing: POST /api/gmb/listings/:id/check → server/routes.ts:1963-2054 (below) | code (hidden on dev: 0 listings, Playwright confirmed absent) | OK |

### Container: "Find a business on Google" card (Add business dialog)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `input-gmb-search` | input | Type a business name, address, or Google Maps URL (Enter also searches). | gmb-monitor.tsx:563-571 | client only | Playwright | OK |
| `button-gmb-search` (aria-label "Search Google") | button | Client requires ≥2 characters, then asks the server to search Google's Places database. | gmb-monitor.tsx:572-579,479-500 | POST /api/photos/business-search → server/routes.ts:985-… → Google Places (Text Search / findplacefromtext / place details by URL resolution via server/google-url-resolver.ts); requires `GOOGLE_PLACES_API_KEY` else 500 "Google Places API key not configured"; body `{query, pageToken?}`; returns `{results:[{placeId, companyName/name, address, phone, website, category}]}`. External Google call — not pressed. | Playwright for client validation; code for the endpoint | OK |
| `text-gmb-search-error` | text | Client-side error ("Enter at least 2 characters.") — no request is sent. | gmb-monitor.tsx:581-583 | client only | Playwright: typed "a", error shown, zero network requests to business-search | OK |
| `search-result-<i>` rows ("Add") | button | Clicking a result saves it as a monitored listing (isMonitoring defaults true). | gmb-monitor.tsx:584-610,590-597 | POST /api/gmb/listings → server/routes.ts:1934-1961 → `storage.createGmbListing` server/storage.ts:569-572 → INSERT gmb_listings (user_id, place_id, business_name, address, phone, website, category, hours=null, photo_count=null, rating=null, review_count=null, is_monitoring=true, last_checked_at=null); 400 unless placeId+businessName. No unique constraint on (user_id, place_id) — duplicate adds possible (see bugs file). | code (no results on dev; adding would write + needs Google API) | OK |

### Container: listings list (ListingCard per listing) — empty on dev

`GET /api/gmb/listings` (gmb-monitor.tsx:457-459) → server/routes.ts:1923-1932 → `storage.getGmbListings(user.id)` server/storage.ts:558-562 → `SELECT * FROM gmb_listings WHERE user_id=1 ORDER BY created_at DESC`. Returns `[]` (SQL count 0). Per-card elements (all verified by code; none rendered on dev):

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `listing-card-<id>` (businessName, address, phone, rating (reviewCount), category badge) | text | Shows the last data fetched from Google for the listing. | gmb-monitor.tsx:150-178 | values come from the gmb_listings row, updated by each check (routes.ts:2034-2045) | code + SQL (table empty) | OK |
| `switch-monitor-<id>` ("Include in Check All") | switch | Toggles whether this listing is included in "Check all". | gmb-monitor.tsx:181-190 | PATCH /api/gmb/listings/:id `{isMonitoring}` → server/routes.ts:2359-2374 → `storage.updateGmbListing` → UPDATE gmb_listings.is_monitoring (ownership-checked, 404 otherwise) | code (no rows to toggle on dev) | OK |
| `button-check-<id>` ("Check now") | button | Fetches the listing's live data from Google Places; first check saves a baseline, later checks diff against the previous snapshot and log every changed field to edit history; toast says "Baseline captured" vs "N change(s) detected" vs "No changes detected". | gmb-monitor.tsx:195-205,101-121 | POST /api/gmb/listings/:id/check → server/routes.ts:1963-2054 → Google Place Details (place_id; fields name,formatted_address,formatted_phone_number,website,types,opening_hours,photos,rating,user_ratings_total) → per changed field INSERT gmb_edit_history (listing_id, field_changed, old_value, new_value, detected_at default now) server/storage.ts:590-593; UPDATE gmb_listings (business_name, address, phone, website, category, hours, photo_count, rating, review_count, last_checked_at=now); response `{changes, currentData, baseline}` where baseline = no prior lastCheckedAt. External Google call + writes — not pressed. | code | OK |
| `button-history-<id>` ("Edit History") | button | Expands/collapses the edit history panel for the listing. | gmb-monitor.tsx:206-216,257-281 | when expanded: GET /api/gmb/listings/:id/history → server/routes.ts:2056-2069 → `storage.getGmbEditHistory` server/storage.ts:584-588 → SELECT gmb_edit_history WHERE listing_id=:id ORDER BY detected_at DESC | code | OK |
| `edit-history-<id>` items (field label, before/after, detected time) | text | One row per detected change ("Before" struck through in red, "After" in green). Field label map at gmb-monitor.tsx:26-39. | gmb-monitor.tsx:56-84 | rows from gmb_edit_history | code | OK |
| History empty state ("No edits detected yet" + hint) | empty-state | Shown when history is empty; hint differs before vs after the baseline check. | gmb-monitor.tsx:269-279 | client only | code | OK |
| `button-delete-<id>` (trash) → `dialog-delete-listing-<id>` | dialog | Confirms removal; warns that nothing changes on Google and it cannot be undone. | gmb-monitor.tsx:218-228,236-255 | on confirm: DELETE /api/gmb/listings/:id → server/routes.ts:2071-2084 → `storage.deleteGmbListing` server/storage.ts:579-582 → DELETE gmb_edit_history WHERE listing_id=:id, then DELETE gmb_listings WHERE id=:id (ownership-checked). Never pressed on seeded data; no rows exist on dev. | code | OK |
| `text-last-checked-<id>` ("Last checked: <date>" / "Not checked yet") | text | Shows when this listing was last checked against Google. | gmb-monitor.tsx:229-233 | value = gmb_listings.last_checked_at rendered with toLocaleDateString | code | OK |

### Container: empty state (what dev renders)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "No listings added yet" card | empty-state | Honest empty state — no listings, no fabricated data. | gmb-monitor.tsx:627-636 | backed by `SELECT count(*) FROM gmb_listings` → 0 | Playwright + SQL | OK |
| `button-add-first` ("Add your first business") | button | Opens the same Add business card. | gmb-monitor.tsx:633-635 | client only | Playwright | OK |

### Container: "Draft a review response" (collapsed `<details>`; client-side except one AI call)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| details summary "Draft a review response" | text | Expands the AI drafting tool. | gmb-monitor.tsx:638 | client only | Playwright (expanded) | OK |
| `card-review-response-tool` + intro copy | text | Explains: paste a review, edit the draft, then paste the reply into Google yourself. | gmb-monitor.tsx:340-346 | client only | Playwright | OK |
| `input-review-business` | input | Your business name, sent to the AI for context. | gmb-monitor.tsx:350-359 | client only until Generate | Playwright | OK |
| `input-reviewer-name` | input | Optional reviewer name for context. | gmb-monitor.tsx:360-369 | client only | Playwright | OK |
| `textarea-review-text` | input | The customer's review text (required before Generate). | gmb-monitor.tsx:372-382 | client only | Playwright | OK |
| `select-tone` (Professional / Empathetic / Grateful) | select | Tone for the AI draft. | gmb-monitor.tsx:384-397 | client only | Playwright | OK |
| `button-generate-response` | button | Disabled until review text is non-empty. Sends the four fields to the AI endpoint and shows the draft in an editable textarea. | gmb-monitor.tsx:398-407,296-320 | POST /api/gmb/review-response → server/routes.ts:2086-2098 → `reviewResponse` (server/ai-features.ts; prompt rules/delimiters live there) → returns `{response}`; 400 if reviewText empty, 400 if >5000 chars, 503 on AI provider failure. AI endpoint — NOT called (verified by code only). | code | OK |
| `textarea-generated-response` | input | Editable AI draft; a client-side rude-word list (gmb-monitor.tsx:324) flips the warning while typing. | gmb-monitor.tsx:410-419,322-327 | client only | code | OK |
| `warning-rude-content` | banner | Client-only warning when the edited draft contains words like "idiot", "liar", "scam", etc. | gmb-monitor.tsx:421-431 | client only | code | OK |
| `button-copy-response` | button | Copies the edited draft to the clipboard; toasts success or "browser blocked" with manual-copy advice. | gmb-monitor.tsx:433-441,329-337 | client only (navigator.clipboard) | code | OK |

Page totals /gmb-monitor: 28 mapped rows — OK 28, BUG 0, UNCLEAR 0, DEAD 0. (Suspicion logged in bugs file: duplicate placeId adds allowed.)

---

## /gbp-content — client/src/pages/gbp-content.tsx

"Posts & photos" editor for a Google-linked location: upload/rename/geotag photos, AI-draft captions and posts, compose Google updates (STANDARD/EVENT/OFFER), schedule and approve a publishing queue, and review/retry/cancel queued jobs. Below it sit the shared Google-connection banner (when no location is chosen) and a compact agency bulk workspace.

### Container: page header + location chooser

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| PageHeader "Posts & photos" + description | text | Page title. | gbp-content.tsx:23 | client only | Playwright | OK |
| "Link a location" header button | button | Shown when the chosen location is not linked (or none chosen); goes to Locations with the Google import panel. | gbp-content.tsx:23 | client only: Link `/locations?import=gbp` (App.tsx:179 route) | Playwright (present without param) | OK |
| Locations error line ("Unable to load locations. Please reload the page.") | text | Shown if the locations query fails. | gbp-content.tsx:24 | client only | code | OK |
| "Choose a profile" → Location `<select aria-label="Location">` | select | Lists only locations whose `gbpLocationName` is set ("Choose a linked location" + linked ones); selecting one loads the editor via `?location=<id>`. | gbp-content.tsx:25 | locations from `useQuery(['/api/locations?'+f.params])` where params = q:'',status:'all',offset:'0' (+clientId if set) — server/agency/middleware.ts:29-33 → listLocations (same as /google-profile above). `linked` filter is client-side on `gbpLocationName`. | Playwright (dev shows only "AI-TEST Ridgeline Roofing"; curl /api/locations total=2, 1 linked) | OK |
| `text-no-linked-locations` ("No locations are linked to Google Business Profile yet…") | empty-state | Shown when the account has zero linked locations. NOT visible on dev because 506025 is linked (renders the GbpConnection banner instead). | gbp-content.tsx:26 | client only | code (condition false on dev) | OK |

### Container: GbpConnection banner (`<GbpConnection context="content"/>`; renders when no `?location`) — client/src/components/gbp-connection.tsx

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google connection" Section title | text | Banner heading. | gbp-connection.tsx:115 | client only | Playwright | OK |
| Not-connected copy: "Google Business Profile not connected. Connect it and link a location to publish posts and photos." | banner | Honest empty state for this page's context (content wording, NOT_CONNECTED_COPY.content gbp-connection.tsx:94). | gbp-connection.tsx:116-117 | driven by GET /api/gbp/status → server/gbp/routes.ts:60-66 → `grantStatus(1)` server/gbp/grants.ts:5-11 → `SELECT … FROM gbp_grants WHERE user_id=1` (0 rows → connected:false, accounts:[]); plus per-location sync rows `SELECT l.id,…,s.kind,s.last_success,s.last_attempt,s.last_error FROM business_locations l LEFT JOIN gbp_grants g … LEFT JOIN gbp_sync_status s … WHERE l.user_id=1 AND l.gbp_location_name IS NOT NULL` (1 row: 506025, never synced) | curl (`accounts:[]`) + Playwright (exact copy verified) | OK |
| "Checking Google connection…" / "Unable to check Google connection" | text | Loading / error states of the status query (refetches every 30s). | gbp-connection.tsx:116 | same GET /api/gbp/status | code | OK |
| Connect button ("Connect Google Business Profile" / "Connect another Google account") | button | Starts Google OAuth (links to `/api/gbp/connect`). | gbp-connection.tsx:142 | GET /api/gbp/connect → server/gbp/routes.ts:32-43 → Google OAuth redirect (rate-limited 10/30s, routes.ts:26); unauthenticated-nav redirect to /locations?gbp=reauth. DO NOT CALL — verified by code only. | code | OK |
| `gbp-link-summary` ("0 synced · 0 ready to link · 1 not in a connected account…") | text | One-line tally of linkage states; only when accounts exist AND rows exist — on dev accounts is empty so this line is hidden (accounts.length===0 branch wins). | gbp-connection.tsx:136-139 | states from GET /api/gbp/linkage → server/gbp/routes.ts:103-115 (per location: gbp_location_name present + grant ok → synced; name present without grant → reconnect; placeId match in agency_discovery<24h → available; else unlinked) | curl (linkage shows 104296 unlinked, 506025 reconnect) | OK |
| Linkage error lines (`role="alert"`) | text | Per-account grant errors. | gbp-connection.tsx:140 | `errors` array from GET /api/gbp/linkage (`errors:[]` on dev) | curl | OK |
| "Sync details" `<details>` (open by default only for context='reviews'; here closed) with per-location rows, "Sync now" buttons | button | Lists linked locations with last sync result; "Sync now" triggers a sync. | gbp-connection.tsx:145-148 | rows from GET /api/gbp/status `locations` (dev: 506025 "Reviews and performance: Never synced"); Sync now → POST /api/gbp/locations/:id/sync → server/gbp/routes.ts:136 → not connected → `syncLocation` (server/gbp/service.ts; Google API calls, writes gbp_sync_status) — not pressed | Playwright (expanded: shows AI-TEST Ridgeline Roofing + Never synced) | OK |
| (Rendered only when accounts exist — none on dev) `gbp-account` rows, StatusPill Connected/Reconnect needed, "Reconnect", `button-view-google-profiles` → /locations?import=gbp, `button-open-google-business` → business.google.com, `button-disconnect-google-account` → POST /api/gbp/disconnect, `button-link-all-gbp` → POST /api/gbp/import | badge/button | Account management: view profiles, open Google, disconnect (purges synced Google data), link all ready locations. | gbp-connection.tsx:120-143 | POST /api/gbp/disconnect → routes.ts:67-86 (requires recent auth; deletes gbp_grants, purges synced data, revokes tokens); POST /api/gbp/import → routes.ts:116-124 (imports from agency_discovery cache, queues sync). Neither pressed. | code | OK |

### Container: location-unavailable banner (bad or unlinked `?location`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `gbp-content-location-unavailable` — "K- Social workbench fixture isn't linked to Google Business Profile." + "Link it in Locations" / "Choose another location" | banner | Shown when `?location` names an existing location without a Google link. | gbp-content.tsx:31-34 | client only (chosen from the locations list; `gbpLocationName` null) | Playwright (?location=104296) | OK |
| Same testid, "Location not found." wording | banner | Shown when `?location` names a deleted/foreign id. | gbp-content.tsx:31-34 | client only | code (not rendered on dev) | OK |

### Container: Editor (`?location=506025`) — status + photos/media library

Editor data: `GET /api/gbp/content/506025` → `{"jobs":[],"style":null,"workerEnabled":false}`; `GET /api/gbp/content/506025/photos` → `[]`. All content routes are wrapped by server/gbp/content.ts:307-321 (auth → `ownedLocation` server/gbp/reply.ts:21-25 = `SELECT * FROM business_locations WHERE id=$1 AND user_id=$2` + gbp account/location resource check → non-GET routes consume budget `gbp-content:<uid>` 180 per 10 min via growth_budgets, server/growth-limits.ts:14-20). The agency middleware (server/agency/middleware.ts:86,91-110) passes owners through to these routes.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Notice "Publishing worker is disabled. Queued content will wait until it is enabled." | banner | Warns that the background publisher is off (env `GBP_CONTENT_WORKER_ENABLED`); approvals still queue but nothing publishes until ops enables it. | gbp-content.tsx:96 | `workerEnabled` flag from GET /api/gbp/content/:location (content.ts:322) | Playwright (banner visible; curl shows workerEnabled:false) | OK |
| "Unable to load the queue or media library…" / error / status message lines | text | Query and operation feedback. | gbp-content.tsx:97-98 | client only | code | OK |
| "Photos and media library" `<details>` | text | Collapsible upload/library panel. | gbp-content.tsx:99 | client only | Playwright | OK |
| "Advanced photo settings" (pattern input `{business}-{city}-{n}`, EXIF title, GPS lat/lon; "Google strips EXIF on upload…" honesty copy) | input | Optional SEO filename pattern and EXIF metadata written into your own file copies. | gbp-content.tsx:100-102 | client only until upload/prepare | Playwright | OK |
| `Upload photos` file input (multiple, jpeg/png/webp, ≤100 files, 15 MB each) | input | Uploads each chosen photo one at a time with the current metadata settings; created copies land in the library. | gbp-content.tsx:103,56-79 | POST /api/gbp/content/:location/upload (multipart, one file per request) → server/gbp/content-upload.ts:39-69 → multer memory 15 MB/1 file → budget `gbp-content-upload:<uid>` 100/hour → `seoName` + `processPhoto` (EXIF) → R2 `media/` key (`uploadToR2`) → `media_folders` "GBP uploads" (created if missing) → INSERT `media_photos(user_id,folder_id,name,url,r2_key,size)`; returns `{id,name,url}`; client appends each id to the selection. Writes + R2 — not pressed. | code | OK |
| Photo grid (checkbox + thumbnail + name per photo; caption textarea for selected, maxLength 1500) | input | Select up to 100 photos and edit each caption draft. | gbp-content.tsx:104 | GET /api/gbp/content/:location/photos → content.ts:323-326 → `SELECT id,name,url,r2_key FROM media_photos WHERE user_id=1 ORDER BY created_at DESC LIMIT 1000` (url rewritten to signed `/api/public/gbp-media` link or public base) | curl ([]) + Playwright ("Your media library is empty.") | OK |
| "Your media library is empty." | empty-state | Honest empty state (0 media_photos rows). | gbp-content.tsx:105 | SQL media_photos count 0 | Playwright + SQL | OK |
| "<N> selected" | text | Count of selected photos (capped at 100). | gbp-content.tsx:105 | client only | Playwright | OK |
| "Apply filename and EXIF to selected copies" | button | Creates renamed, metadata-tagged copies of the selected photos in the library and re-selects the copies. | gbp-content.tsx:106 | POST /api/gbp/content/:location/prepare `{pattern,title,lat?,lon?,photoIds}` → content.ts/content-upload.ts:70-102 → budget 100/hour → reads each R2 object (≤15 MB) → `preparePhoto` → new R2 key → INSERT new media_photos row copying folder; 400 unless both lat+lon given together. Writes + R2 — not pressed. | code | OK |
| Photo category select (ADDITIONAL…COVER) | select | Google's media category for photo posts. | gbp-content.tsx:107 | values enforced by server `categories` (content.ts:30) | code | OK |

### Container: Editor — "AI drafts and style" (AI endpoints NOT called)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Instructions textarea (≤4000) | input | Owner guidance the AI may use where facts support it. | gbp-content.tsx:110 | sent to /draft and /learn prompts | code | OK |
| Example descriptions textarea (≤6000) | input | Example posts/descriptions as style reference. | gbp-content.tsx:111 | sent to /draft | code | OK |
| "Generate caption drafts" | button | AI-drafts a caption per selected photo (one request each); completed drafts survive a later failure. | gbp-content.tsx:112,84-93 | POST /api/gbp/content/:location/draft `{kind:'photo',photoIds:[one],instructions,examples}` → content.ts:387-405 → budget `gbp-content-ai:<uid>` 100/day → prompt `draftPrompt` (content.ts:268-286; strict no-invented-facts system prompt content.ts:230) → OpenAI chat (vision model when images) → `{drafts:[{photoId,text}]}`. NOT called. | code | OK |
| "Generate post draft" | button | AI-drafts one Google post from up to 10 selected photos + facts + style guidance. | gbp-content.tsx:112,91 | same POST /draft with `kind:'post'`, photoIds ≤10 → `{drafts:[{text}]}` | code | OK |
| "Learn from past updates" | button | Reads the location's historical Google posts and drafts editable style guidance (toasts "based on N past updates"). | gbp-content.tsx:112 | POST /api/gbp/content/:location/learn → content.ts:362-386 → budget 100/day → `pages()` through `/v4/{account}/{location}/localPosts` (Google API) → chunked AI summaries → `{summary, postCount, draft:true}`; returns "No previous Google updates found." when empty. NOT called. | code | OK |
| "Editable style guidance" textarea (AI draft until saved) | input | Holds the AI style draft or saved style; editable. | gbp-content.tsx:113 | pre-filled from GET /api/gbp/content/:location `style` (gbp_content_style row; null on dev) | curl (style:null) | OK |
| "Save style guidance" | button | Saves the textarea as this location's style guidance. | gbp-content.tsx:113 | PATCH /api/gbp/content/:location/style `{summary≤6000}` → content.ts:361 → `INSERT … ON CONFLICT(user_id,location_id) DO UPDATE` into gbp_content_style. Not pressed (would leave AUDIT data with no app delete path). | code | OK |

### Container: Editor — "Compose a Google update"

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Post type select (standard/event/offer) | select | Google's local post type. | gbp-content.tsx:116 | enforced by `itemInput.topicType` (content.ts:38-39) | Playwright | OK |
| "Post draft" textarea (≤1500) + "0/1500 characters. The first 10 selected photos will be attached." | input | The post text; up to 10 selected photos attach to the post. | gbp-content.tsx:117 | `summary` enforced ≤1500 by itemInput | Playwright | OK |
| Call to action select (none/BOOK/ORDER/SHOP/LEARN_MORE/SIGN_UP/CALL) + Action URL input (hidden for OFFER) | select/input | Optional CTA button on the post; non-CALL actions require an HTTPS URL (server-enforced, content.ts:50-51). | gbp-content.tsx:118 | `callToAction` in itemInput; `https` URL refine content.ts:32 | Playwright | OK |
| Event/offer fields (title ≤58, Starts/Ends datetime-local, coupon code for OFFER) + "Event and offer times use the Google location's local time." | input | Event window and optional coupon; server requires end > start for EVENT/OFFER (content.ts:48-49). | gbp-content.tsx:119 | `event`/`offer` in itemInput; converted to Google's date/time (content.ts:130,135-137) | Playwright | OK |
| "Add post to draft batch" (disabled without text or at 100 drafts) | button | Stashes the composed post into a local batch so several posts queue together; clears the textarea. | gbp-content.tsx:120 | client only state | Playwright | OK |
| Draft batch list (per draft: editable textarea + "Remove draft N") | input | Review/edit batch items before approving. | gbp-content.tsx:121 | client only | code | OK |

### Container: Editor — "Schedule and approve"

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "First publish (blank = now)" datetime-local | input | When the first item should publish; blank means immediately. | gbp-content.tsx:124 | `schedule.start` ISO; server default start=now | Playwright | OK |
| "Items per period" number + validation ("must be a whole number from 1 to 100", `aria-invalid`) | input | How many items share each day/week period; invalid values block both Approve buttons. | gbp-content.tsx:125-126,51 | client validation countValid; server `everyMinutes` 1..525600 (content.ts:53) | Playwright (error line renders when invalid) | OK |
| Cadence select (Per day / Per week / Custom times) | select | Spacing unit: 1440/count minutes (day), 10080/count (week), or an exact custom list. | gbp-content.tsx:125,80 | `scheduleTimes` (content.ts:57-91) computes due dates; custom requires exactly one ISO time per item (400 otherwise) | Playwright | OK |
| "Custom times" textarea (one ISO time per item) | input | Exact schedule list used when cadence is custom. | gbp-content.tsx:128 | parsed to ISO datetimes | code | OK |
| "Business hours only" checkbox → timezone, opening/closing hour, weekday checkboxes + "these are not inferred from Google" honesty copy | input | Moves any due time that falls outside the chosen hours/days forward to the next allowed hour. | gbp-content.tsx:129-130 | `businessHours` honored server-side in `scheduleTimes` (content.ts:74-86) and re-checked by the worker each tick (content.ts:185-191); close must follow open (400) | Playwright | OK |
| Schedule explainer + "Approving authorizes Google publishing… Unsaved drafts are lost on reload." | text | Honest copy about what approval means. | gbp-content.tsx:127,131 | client only | Playwright | OK |
| "Approve & queue photos" (needs ≥1 selected + valid count) | button | Queues each selected photo as its own Google media item (with its caption + category) on the computed schedule. | gbp-content.tsx:131,82-83 | POST /api/gbp/content/:location/queue `{requestKey, items:[{kind:'photo',photoIds:[id],summary,category}…], schedule}` → `enqueue` content.ts:140-172 → advisory lock per requestKey → idempotent replay of identical resubmits (409 on key reuse with different content) → INSERT `gbp_content_jobs(user_id,location_id,request_key,item_index,kind,payload,due_at,target,schedule)`; payload built by `payloadFor` (r2: media refs). Writes — not pressed. | code | OK |
| "Approve & queue post" (needs text or batch + valid count) | button | Queues the current post (or every post in the draft batch). | gbp-content.tsx:131 | same POST /queue with kind:'post' items (payload: topicType, summary, media ≤10, CTA, event/offer) | code | OK |

### Container: Editor — "Calendar, queue & history"

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Queue / Calendar toggle buttons (`aria-pressed`) | tab | Queue = creation order; Calendar = sorted by due date with per-day headings. | gbp-content.tsx:133-135 | client-side sort of `jobs` | Playwright (both buttons render) | OK |
| "Refresh Google status" | button | Re-queries Google for the latest state of published posts (catches REJECTED after approval). | gbp-content.tsx:133 | POST /api/gbp/content/:location/refresh → content.ts:328-352 → SELECT published post jobs (≤100) → Google GET per post → UPDATE `google_status` / status→rejected (+ user notification); returns `{refreshed:N}`. Not pressed (no published jobs; would still write budget counters). | code | OK |
| "No scheduled content yet." | empty-state | Honest empty state (gbp_content_jobs count 0). | gbp-content.tsx:134 | SQL `SELECT count(*) FROM gbp_content_jobs` → 0 | Playwright + SQL | OK |
| Job cards (`kind · due · status · Google: google_status`, payload summary/description/category, Google resource name, error line) | text | One card per queued/published job, polling the endpoint every 15s. | gbp-content.tsx:134-136,39 | rows from `SELECT * FROM gbp_content_jobs WHERE user_id=1 AND location_id=506025 ORDER BY due_at DESC LIMIT 1000` (content.ts:322) | code (no rows on dev) | OK |
| "Retry" (failed/uncertain only; uncertain asks "Check Google first…" confirm) | button | Puts the job back in the queue (due now); uncertain retries require confirming you checked Google to avoid duplicates. | gbp-content.tsx:137 | PATCH /api/gbp/content/:location/jobs/:id `{action:'retry',checkedGoogle?}` → content.ts:353-360 → UPDATE gbp_content_jobs SET status='queued', error=NULL, due_at=now WHERE status IN ('queued','failed') OR (status='uncertain' AND checkedGoogle); 409 otherwise | code (no jobs on dev) | OK |
| "Cancel" (queued/failed/uncertain) | button | Marks the job cancelled; it will not publish. | gbp-content.tsx:138 | same PATCH with `{action:'cancel'}` → status='cancelled' | code | OK |

Worker behavior (code-verified, not running for publishes on dev): server/gbp/content.ts:174-228 — every 15s when `GBP_CONTENT_WORKER_ENABLED=true`; recovers interrupted 'publishing' jobs to 'uncertain' (+notification); defers jobs whose business-hours window hasn't opened; 100 publishes/day budget (`gbp-content-publish:<uid>`, deferred to tomorrow with error note when exhausted); publishes via GoogleClient to `media` or `localPosts`; validates the returned resource name; REJECTED → status rejected + user notification; notifies `gbp.post_published`/`gbp.post_failed`; logs activity.

Media serving: `GET /api/public/gbp-media?k&exp&sig` (content.ts:290-306) — HMAC-signed (GBP_TOKEN_KEY/SESSION_SECRET), `media/` keys only, streams from R2, 1-hour signed URLs when no public base URL.

### Container: "Agency bulk actions" (`<AgencyWorkspace compact/>`) — client/src/components/agency-workspace.tsx

For user 1 `/api/agency/me` returns `entitled:true` (platform admin), so the compact variant renders `AgencyBulkWorkspace` (agency-workspace.tsx:35,70-122); without entitlement it would render null (:36).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `<details>` summary "Agency bulk actions" | text | Collapses the agency panel. | gbp-content.tsx:35 | client only | Playwright | OK |
| Section "Agency locations" + `/agency` link + "Agency · owner" caption + "Bulk location actions" expander | text/button | Identifies the open workspace and reveals the bulk table. | agency-workspace.tsx:91-92 | GET /api/agency/me → server/agency/routes.ts:65 (`entitled`, workspace name, role) | curl + Playwright | OK |
| Stat grid ("Locations" = total, "Need reconnect") — only when expanded | stat | Two real counts from the agency dashboard endpoint. | agency-workspace.tsx:91 | GET /api/agency/dashboard → server/agency/routes.ts:125 → `dashboard()` server/agency/access.ts:101-104 → `SELECT count(*) total, count(*) FILTER (WHERE <statusSql>)…` over business_locations+agency_clients with visibility filter (no time window). Dev values: total 2, reconnect 1 — matches linkage curl (506025 has no grant). | curl (dashboard JSON) + Playwright | OK |
| Client search input, client filter select, location-status select with live counts | input/select | Filter the agency location table; status counts shown per filter. | agency-workspace.tsx:95-99 | GET /api/agency/clients (search), GET /api/agency/locations?q&status&offset → server/agency/routes.ts:124 → `listLocations` (same query as /api/locations, agency-scoped) | curl /api/agency/locations (2 items) | OK |
| Location table rows `agency-location-<id>` (name button → location, client, address, Linked/Not linked pill), "Select page" / "Select all matching (N)" / "Clear selection", "Export … CSV" link | table/link | Review and select locations for a bulk action; CSV export of the current selection/match. | agency-workspace.tsx:101-110 | same GET /api/agency/locations; export → GET /api/agency/export (server/agency/routes.ts:130s, CSV) | Playwright (row agency-location-506025 present after expand) | OK |
| "Apply to selected locations" fieldset: bulk action select (Sync now / Link & sync / Unlink / Assign client / Set Guard mode / AI reply settings / Schedule post-photo batch / Start Site Scans) + per-action fields + "Queue selected action" | button | Queues the chosen action for every selected location (writes agency_jobs, runs from the agency worker). | agency-workspace.tsx:111-119,83-90 | POST /api/agency/bulk `{requestKey, action, payload, selection}` → server/agency/routes.ts:127-… → `queueBulk` (server/agency/jobs.ts) → INSERT agency_jobs rows; success text "N location actions queued. See Agency → Jobs…". Not pressed (writes). | code | OK |

Page totals /gbp-content: 58 mapped rows — OK 58, BUG 0, UNCLEAR 0, DEAD 0.

---

## Cross-page notes

- `GET /api/locations` is served by the agency middleware envelope for every signed-in user (`?paged=true` → `{items,total,offset,pageSize:50}`; without it → bare array). Both contracts confirmed by curl. `/google-profile`, `/gbp-content`, and `AgencyWorkspace` rely on it; all consistent.
- Rate-limit counters for GBP content live in table `growth_budgets` (INSERT … ON CONFLICT, server/growth-limits.ts:14-20): `gbp-content:<uid>` 180/10 min (all non-GET content routes), `gbp-content-upload:<uid>` 100/hour, `gbp-content-ai:<uid>` 100/day, `gbp-content-publish:<uid>` 100/day.
- Honesty checks passed everywhere on dev: gmb-monitor "No listings added yet" (SQL 0), gbp-content "Your media library is empty." (SQL 0), "No scheduled content yet." (SQL 0), worker-disabled notice (env flag false), GbpConnection not-connected copy (curl accounts:[]), agency stats match dashboard SQL filters. No fabricated numbers found.
- Not verified by pressing (per rules): all Google-external calls (business-search, check, sync, refresh, learn, connect OAuth), all AI endpoints (review-response, draft, learn), and all DB-writing endpoints (add/delete listing, upload, prepare, queue, style, jobs patch, bulk, import, disconnect). All were verified by reading server code.

---

*Batch 2 — page /locations (largest page: 8 detail tabs + add dialog + campaign detail).*

Audit date 2026-10-04. Dev server http://127.0.0.1:8302, dev bypass = user 1 (platform admin, accessPlan `agency`).
Seeded data: location 104296 "K- Social workbench fixture" (Testville TX, NOT Google-linked), location 506025 "AI-TEST Ridgeline Roofing" (Round Rock TX, gbp-linked: `gbp_location_name='locations/aitest900001'` but NO `gbp_grants` row → Google account disconnected). `gbp_grants` has 0 rows for user 1 → every "connected Google accounts" element renders its not-connected state.

## /locations — client/src/pages/locations.tsx

One-line purpose: the owner's home for business locations — a list (agency workspace) plus a per-location detail view (?location=<id>) with 8 tabs (insights, guard, info, services, photos, social, settings, citations).

FACT (recorded per instructions): `isPremiumPlus` is hard-coded `true` at `client/src/pages/locations.tsx:89` (`<LocationDetail … isPremiumPlus={true}/>`). The Citations tab is therefore never locked for any user, and the lock branch at locations.tsx:391-392/402-414 (`!(t.value === "citations" && !isPremiumPlus)`) is dead code.

### List page shell

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Business Profile Locations" title (text-locations-title) | text | Page title. | locations.tsx:91 | client only | Playwright /locations | OK |
| "Add location" button (button-add-location) | button | Opens the Add location dialog (Search Google / Import from GBP tabs). | locations.tsx:91, 92-94 | client only | Playwright clicked → dialog rendered (03-add-dialog-clicked.png) | OK |
| Add location dialog | dialog | Two tabs; `?import=gbp` opens it on the GBP tab (locations.tsx:74-77,93). | locations.tsx:92-94 | client only | Playwright /locations?import=gbp (02-import-gbp.png) | OK |
| "Location #N was not found…" alert (alert-location-not-found) + Dismiss | banner | A stale/foreign `?location=` id shows this, clears the param from the URL and falls back to the list. | locations.tsx:78-81, 95-98; showLocation() 60-66 | GET /api/locations/:id → server/routes.ts:2681 (404 when not owner) | Playwright /locations?location=999999 (30-location-not-found.png) | OK |
| `?gbp=reauth` effect | button | When /api/gbp/connect was opened as a page navigation, the server redirects here; the page runs startGbpConnect (recent-auth preflight, then Google's consent page). | locations.tsx:82-88 | GET /api/gbp/connect?format=json → server/gbp/routes.ts:32-43 (403 reauth → RecentAuthModal) | code only — must not start OAuth | OK |
| AgencyWorkspace list | container | The location list. In this account (agency plan, `/api/agency/me` entitled=true) it renders the agency bulk workspace, not the owner list. | locations.tsx:99 → agency-workspace.tsx:32-37 | see "AgencyWorkspace" container below | Playwright + curl | OK |
| GbpConnection banner (context="locations") | container | Google-connection status banner under the list. | locations.tsx:100 → gbp-connection.tsx:98-150 | see "GbpConnection" container below | Playwright + curl | OK |

### AddLocationDialog — "Search Google" tab

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search Google" tab (tab-search-google) | tab | Default tab: search Google's places database by name, address or Maps URL. | locations.tsx:229 | client only | Playwright 03-add-dialog-clicked.png | OK |
| "Import from GBP" tab (tab-import-gbp) | tab | Switch to importing profiles from a connected Google account. | locations.tsx:230 | client only | Playwright 02-import-gbp.png | OK |
| Search input (input-google-search) | input | Type a business name, address or Google Maps URL (Enter submits). | locations.tsx:234-240 | client only | Playwright | OK |
| Search button (button-google-search) | button | Validates ≥2 chars (toast otherwise), then searches. | locations.tsx:241-244 | POST /api/locations/search-google → server/routes.ts:2763-2970 → Google Places textsearch/details (no DB write). <2 chars → 400 {"message":"Type at least 2 characters…"}. | curl: 1-char → 400; live query "Ridgeline Roofing Round Rock" → 10 results w/ placeId/name/address/rating | OK |
| Search result rows (search-result-0…N) | button | One row per Google result; clicking POSTs a new location from it and closes the dialog. | locations.tsx:245-264, 143-165 | POST /api/locations → server/routes.ts:2692-2715 → INSERT business_locations (zod insertBusinessLocationSchema minus gbp fields, userId=1; plan-gated requirePlan + per-plan location cap with withAccountLock). Response = new location row. | code only — write not pressed (per-page rule: prefer read-only) | OK |
| "No results found" toast | text | Shown when Google returns nothing. | locations.tsx:133-135 | client only | code | OK |

### AddLocationDialog — "Import from GBP" tab

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| GBP lookup loader (gbp-lookup) | text | Spinner while profiles are fetched; retries up to 8× every 12 s when the account is freshly connected and discovery is still running. | locations.tsx:273-282, 177-183 | GET /api/gbp/locations → server/gbp/routes.ts:87-101 `cached` → agency_discovery JOIN gbp_grants (user_id, businessName ILIKE %q%, LIMIT 50 OFFSET); empty → INSERT agency_poll_grants … refreshing=true | curl GET /api/gbp/locations → 401 {kind:"auth",needsAuth:true} (no grants) | OK |
| "Connect your Google account…" empty state + Connect Google Business (button-connect-gbp / button-connect-gbp-initial) | empty-state / button | Shown when the fetch answers needsAuth/not connected/expired (or nothing found). The button is an <a href="/api/gbp/connect"> intercepted by RecentAuthModal's click listener → startGbpConnect → GET /api/gbp/connect?format=json → window.location.assign(consent URL). | locations.tsx:283-294, 354-365; recent-auth.tsx:21-25, 53-58 | GET /api/gbp/connect → server/gbp/routes.ts:32-43: rate-limited 10/30 min; browser navigations without recent auth redirect to /locations?gbp=reauth; JSON preflight returns {url} or 403 {reauth:true} | Playwright 02-import-gbp.png (connect state rendered); OAuth start not pressed, per instructions | OK |
| Retry (button-retry-gbp) | button | Re-fetches /api/gbp/locations after a non-auth failure. | locations.tsx:295-302 | same as gbp-lookup | code (no failure state reachable here) | OK |
| Warnings (account: message) | banner | Per-account errors from the fetch are listed. | locations.tsx:272 | GET /api/gbp/locations `errors` (always [] from `cached`) | code | OK |
| "Found N locations across your connected Google accounts" + Select All (button-select-all-gbp) | text / button | Header + select/deselect all checkboxes. | locations.tsx:305-316 | client only | code (0 locations in this env) | OK |
| GBP location rows (gbp-location-0…N) | button | Checkbox rows (businessName, address, phone, "Managed by" grant email); toggle adds/removes from the import set. | locations.tsx:317-336 | client only (data from agency_discovery.data jsonb) | code | OK |
| Needs-plan gate (gbp-import-needs-plan) | banner | If GET /api/entitlements has accessPlan=null, replaces the Import button with "needs a plan from $X/month" + See-plans link. | locations.tsx:110-111, 337-345 | GET /api/entitlements → server/routes.ts:249-268 | curl: accessPlan='agency' → gate not shown here; gate branch code-read | OK |
| Import N Locations (button-import-gbp) | button | POSTs the selected listings; toast "Imported N locations". | locations.tsx:346-351, 200-214 | POST /api/gbp/import → server/gbp/routes.ts:116-124 → validates against agency_discovery cache (24 h), importVerifiedLocations + queueSync per location → 202 {imported, queued} | code only — write not pressed | OK |

### LocationDetail shell (all 8 tabs)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "All locations" back (button-back-to-list) | button | Clears ?location (and tab/range/group/campaign params) back to the list. | locations.tsx:397; showLocation(null) 60-66 | client only | Playwright | OK |
| Location name header (text-detail-name) + address line | text | Business name + fullAddress(location). | locations.tsx:398; fullAddress agency-workspace.tsx:21-25 | data from GET /api/locations/:id → server/routes.ts:2681 (business_locations WHERE id AND user_id) | Playwright both fixtures | OK |
| 8 tab buttons (tab-insights, tab-guard, tab-info, tab-services, tab-photos, tab-social, tab-settings, tab-citations) | tab | Switch detail tab; unknown ?tab falls back to Insights and is removed from the URL. Citations tab would show a Lock icon + be disabled when !isPremiumPlus — never, see hard-coded fact. | locations.tsx:380-393, 400-418 | client only | Playwright: all 8 render and switch for 104296; 7 for 506025 | OK |
| Detail data source | text | The whole detail view is driven by one location row. | locations.tsx:79 | GET /api/locations/:id (see above) | curl + Playwright | OK |

### Insights tab — <LocationSearchSummary> + <InsightsTab>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Google Search Console card ("property totals · last 30 days") | stat / link | Shows GSC clicks/impressions for the location's linked property, last 30 days; "Open Search Console" links to /search-console. Renders nothing when the plan gate answers plan_required. | site-connections.tsx:280-304 | GET /api/gsc/locations/:id/summary → server/gsc/routes.ts:259-271 → locationSearchClicks server/gsc/service.ts:280-292: edge_location_links JOIN edge_assets JOIN gsc_analytics (dimension='date', date>=current_date-30) GROUP BY asset LIMIT 1. | curl → {"search":null}; Playwright: card shows "Search Console data unavailable. Connect an account and sync its property." | OK |
| GbpConnection banner (locationId) | container | Per-location Google connection section (sync details, Sync now). | locations.tsx:483 → gbp-connection.tsx | see GbpConnection container | Playwright 10/20-loc*-insights | OK |
| "Google performance — <range>, by <group>" heading + explainer + "Stored: first → last" | text | Describes the table; appends the stored first/last dates when metrics exist. | locations.tsx:484-491 | data.firstDate/lastDate from performance endpoint | Playwright (no dates shown, none stored) | OK |
| Range select (select-perf-range) | select | 30d / 90d / 6m / 12m / 18m / all. Kept in ?range (90d = default, param omitted). | locations.tsx:493-495, 457-465 | passes ?range to endpoint; server maps {'30d':30,'90d':90,'6m':183,'12m':366,'18m':548,'all':null} | Playwright + curl | OK |
| Group select (select-perf-group) | select | By day / week / month. Kept in ?group (day = default). | locations.tsx:496-498 | server groups with date_trunc($2, date) | Playwright + curl | OK |
| Performance table (table-performance) incl. Total row (row-performance-total), per-period rows, "not final yet" marker | table | One row per period (newest first), one column per metric; Total row sums the fetched range; periods whose last_day is after `pendingAfter` (today−5d) are greyed with a "not final yet" chip. | locations.tsx:469-478, 501-524 | GET /api/gbp/locations/:id/performance → server/gbp/routes.ts:139-153: SELECT to_char(date_trunc($2,date),'YYYY-MM-DD'), metric, sum(value), max(date) FROM gbp_daily_metrics WHERE location_id=$1 AND date>=current_date-$3 GROUP BY 1,2; span SELECT min/max(date); pendingAfter = today−5d (server clock, toISOString slice). | curl both fixtures → available:false, rows:[] (gbp_daily_metrics empty per SQL); table branch not renderable in this env — code-read | OK |
| "Performance unavailable. Link this location to Google and sync…" | empty-state | Shown when available=false (no rows). | locations.tsx:501-503 | see above | Playwright both fixtures — see bugs file: copy is wrong for an already-linked location | BUG |
| Loading / error states ("Loading performance…", "Unable to load performance.") | text | Query states. | locations.tsx:501 | client only | code | OK |

### Guard tab — <ProfileGuard> (client/src/components/profile-guard.tsx)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Unlinked card (card-guard-unlinked) | empty-state | When the location has no gbp_location_name: explains Guard and offers the one next step — GbpLinkCell if a connected account manages the listing, else a Connect Google button (link-guard-connect-gbp). | profile-guard.tsx:45-55 | GET /api/gbp/linkage (state per location) | Playwright 10-loc104296-guard — renders Connect variant (no grants) | OK |
| "How checks work" details | text | Every 15 minutes; lockdown reasserts but cannot block Google edits; public suggestions indistinguishable. | profile-guard.tsx:67 | client only (claim matches gbp worker cadence, not independently pressed) | Playwright | OK |
| "Current mode: X. Last checked …" | text | Mode + last check time (or "Not checked yet") + lastError alert when present. | profile-guard.tsx:68-69 | GET /api/gbp/locations/:id/guard → server/gbp/guard-routes.ts:69 → gbp_guard.mode/watched/snapshot/checked_at/last_error + gbp_guard_changes (200 latest) | curl 506025 → {mode:'off', snapshot:null, changes:[]}; Playwright | OK |
| Mode select (Off / Notify / Lockdown (auto-reject)) | select | Chooses the guard mode, saved with the Save button. | profile-guard.tsx:70 | PUT /api/gbp/locations/:id/guard → guard-routes.ts:71-78 → zod mode+watched(+token); 403 {reauth:true} unless recently verified (12 h shared / 5 min guard-local); configureGuard writes gbp_guard; lockdown triggers an immediate checkGuard | code only — changing mode needs reauth + would call Google; not pressed | OK |
| Watched fields checkboxes (11 fields) | input | Which profile fields Guard watches (title, phoneNumbers, websiteUri, storefrontAddress, categories, description, hours, specialHours, serviceArea, openingDate, status). | profile-guard.tsx:19, 71 | same PUT (watched array, GUARD_FIELDS enum) | Playwright 20-loc506025-guard (all rendered) | OK |
| "Preview current Google values" button | button | Fetches the live Google profile so the owner can approve it as the snapshot. | profile-guard.tsx:72 | POST …/guard/preview → guard-routes.ts:70 → previewSnapshot (live Google API) | code only — would call Google on a disconnected fixture; not pressed | OK |
| Snapshot <dl> ("Owner-approved snapshot" / "Review these values…") | text | Approved (or previewed) field values, pretty-printed. | profile-guard.tsx:73 | gbp_guard.snapshot jsonb | n/a here (snapshot null) | OK |
| Reauth explainer ("Saving Guard settings asks you to confirm it's you…12 hours") | text | Explains the step-up. | profile-guard.tsx:74 | matches requireGuardRecentAuth (guard-routes.ts:16-23, RECENT_AUTH_MS) | code | OK |
| "Save guard settings" / "Approve snapshot and save settings" button | button | PUTs mode+watched (+preview token when approving). | profile-guard.tsx:75 | PUT …/guard (above) | code only | OK |
| "Check now" button | button | Runs an immediate Guard check. | profile-guard.tsx:76 | POST …/guard/check → guard-routes.ts:79 → checkGuard (live Google read; writes gbp_guard_changes on diffs) | code only | OK |
| "Pending changes and history" list | text | Change cards: field — status, detected_at · source, approved vs detected values, error, Approve/Reject buttons (pending only), "Report" dialog, "Reported locally" marker. | profile-guard.tsx:77-83 | GET …/guard changes (above); POST …/guard/changes/:id {action:approve|reject} → guard-routes.ts:80-83 → resolveChange; GET/POST /api/gbp/reports/changes/:id → guard-routes.ts:86-92 (reported_at COALESCE now()) | Playwright "No detected changes." (gbp_guard_changes empty per SQL) | OK |
| GuardStatus component | badge | IMPORTED at locations.tsx:5 but never used anywhere in the client (dead import). | locations.tsx:5; profile-guard.tsx:21-25 | GET /api/gbp/guard/status | code (grep: no <GuardStatus usage) | DEAD |

### Info tab — <LocationInfoTab> + InfoRow

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Import from Google" button (button-import-google) | button | Only when placeId or gbpLocationName exists. Linked → runs a full GBP sync (syncLocation); unlinked-with-placeId → fetches Places details and overwrites name/address/city/state/zip/phone/website/categories/hours/googleCid. | locations.tsx:580-592, 555-570 | POST /api/locations/:id/import-google → server/routes.ts:2972-3038 → linked: syncLocation (gbp/service); else Google Places details + UPDATE business_locations (no businessPhotoCount — comment lines 3029-3030) | Playwright 20-loc506025-info (button shown); not pressed (writes/syncs) | OK |
| InfoRow "Google Place ID" (info-google-place-id) | text | placeId or "Not set"; "G" marker when Google-sourced. | locations.tsx:595 | business_locations.place_id | Playwright: both fixtures "Not set" (SQL place_id NULL) | OK |
| InfoRow "Google Maps link" / "Google CID" | link / text | If googleCid is an https URL → linked "Google Maps link"; else if googleCid set → shown as CID text; else "Not set". | locations.tsx:596-598, 573-574 | business_locations.google_cid | Playwright: both "Not set" (SQL google_cid NULL) | OK |
| InfoRow Business Name / Description / Address / Service Areas / Phone / Website / Opening Date | text | Straight from the location row; Address via fullAddress; "Not set" when empty. | locations.tsx:599-603, 613, 615 | business_columns of business_locations | Playwright both fixtures — matches SQL (506025 shows description + phone) | OK |
| InfoRow "Categories" | text | Comma-joined with "(n/100)" count when present. | locations.tsx:604-608 | business_locations.categories (text[]; 100 = Google's category limit) | Playwright "Not set" (categories NULL both fixtures) | OK |
| InfoRow "Services" | text | "<n> services" when present. | locations.tsx:609-612 | business_locations.services jsonb | Playwright: 104296 "Not set", 506025 "3 services" | OK |
| InfoRow "Hours" | text | Formats stored hours: array, {weekday_text}, or per-day map (Mon-Sun order; "X, every day" when uniform). | locations.tsx:614, 623-637 | business_locations.hours jsonb | Playwright "Not set" (hours NULL both) | OK |
| InfoRow "Open Status" | text | Only shown when gbpLocationName exists (GBP sync is the only honest source). | locations.tsx:616-617 | business_locations.open_status | Playwright: 506025 "G Open Status Not set"; 104296 row absent→"Not set" without G marker | OK |

### Services tab — <ServicesTab>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Services on your Google profile" + count badge (badge-service-count) | badge | Number of services on the location row. | locations.tsx:647-650 | business_locations.services (client-side length) | Playwright: 0 and 3 — matches SQL | OK |
| Card description | text | "Synced from your Google Business Profile…" when linked, else "Link this location…". | locations.tsx:651-653 | client only (location.gbpLocationName) | Playwright both | OK |
| Category chips (service-categories), first = "· primary" | badge | Category pills from the categories array. | locations.tsx:654-660 | business_locations.categories | n/a (categories NULL) — code | OK |
| Filter input (input-service-filter) | input | Only when >12 services; client-side substring filter. | locations.tsx:667-669 | client only | code (>12 needed) | OK |
| Service rows (service-row-N) | text | Check-marked list of services. | locations.tsx:670-677 | client only | Playwright 20-loc506025-services: 3 rows match SQL jsonb | OK |
| "No services synced yet." / "No services match" | empty-state | Zero-state and no-filter-match state. | locations.tsx:663-665, 678 | client only | Playwright 10-loc104296-services | OK |

### Photos tab — <PhotosTab>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Business photos & videos" tile (tab-photos-business) + count (text-business-photo-count) | stat / button | Shows the stored business photo count and switches the grid source to business. When linked, a count Google never reported should read "—", never 0 (code comment 694-696). | locations.tsx:697-711 | business_locations.business_photo_count (integer, nullable, DEFAULT 0 — schema.ts:363) | Playwright: 104296 unlinked shows "—" + hint; 506025 linked shows "0" although gbp_media is empty and no sync ever reported a count — see bugs file | BUG |
| "Customer photos & videos" tile (tab-photos-customer) + count (text-customer-photo-count) | stat / button | Same for customer photos. | locations.tsx:697-711 | business_locations.customer_photo_count (DEFAULT 0, schema.ts:364) | Playwright: same defect as above | BUG |
| Unlinked card ("Link this location…") | empty-state | Shown when not gbp-linked. | locations.tsx:713-716 | client only | Playwright 10-loc104296-photos | OK |
| "No business photos synced yet. Use Sync now on the Locations page…" card | empty-state | Shown for a linked location with no media rows. | locations.tsx:719-722 | GET /api/gbp/locations/:id/media items=[] | Playwright 20-loc506025-photos — see bugs file for Sync-now copy | BUG |
| Media grid (gbp-media-grid) + "Showing X of Y … synced …" caption | link / text | Thumbnails linking to the photo on Google; Video/category chip overlay. | locations.tsx:725-742 | GET /api/gbp/locations/:id/media → server/gbp/routes.ts:125-134: gbp_media WHERE location_id+source ORDER BY create_time DESC NULLS LAST LIMIT min(max(limit,1),600); total=count(*), syncedAt=max(synced_at) | curl 506025 → {total:0,items:[]}; grid unreachable in this env (code) | OK |
| "Show more (N more)" (button-more-photos) | button | Raises limit by 120 up to 600 (server cap 600). | locations.tsx:743-747 | same endpoint | code | OK |
| "Add or schedule photos in Posts & Photos" (button-posts-photos) | button | Navigates to /gbp-content. | locations.tsx:751-753 | client only: window.location.href='/gbp-content' | Playwright (button present) | OK |

### Social tab — <SocialProfilesTab>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| 7 platform inputs (input-social-facebook/instagram/linkedin/pinterest/tiktok/twitter/youtube) | input | URL inputs prefilled from location.socialProfiles. | locations.tsx:791-807, 47-55 | business_locations.social_profiles jsonb | Playwright all 7 render, empty for both fixtures (SQL social_profiles NULL) | OK |
| https validation ("Enter the full link, starting with https://") (text-social-error-*) | text | Client-side: any non-empty value must parse as https://; invalid disables Save. | locations.tsx:767, 809-813, 830-833 | server mirrors: PUT body validated by locationUpdateInput (server/route-guards.ts:163 for notificationEmail; socialProfiles schema in route-guards.ts:136-165) | code (client); server schema read | OK |
| "Save Social Profiles" (button-save-social) | button | PUTs trimmed profiles; server merges over the 7 keys and drops empties, keeping other (GBP-synced) keys. | locations.tsx:816-824, 769-783 | PUT /api/locations/:id → server/routes.ts:2717-2740 → UPDATE business_locations.social_profiles | code only — write not pressed | OK |

### Settings tab — <SettingsTab>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Notification email" copy ("ConstructHUB does not send location notifications yet…") | text | CLAIM verified: notification_email is written but never read — no server code sends location notifications (grep of server/ finds only schema/validation references). | locations.tsx:887-889 | PUT /api/locations/:id → business_locations.notification_email (zod: '' → null, email format) | code (grep server/ for notification_email — only route-guards.ts:163 validation) | OK |
| "Use account-level settings" switch (switch-account-settings) | switch | On = save null (use account email); off reveals the email input. | locations.tsx:891-899, 838-845 | notification_email NULL = account-level | Playwright | OK |
| Email input (input-notification-email) + error text (text-notification-email-error) | input | Location-specific notification email; regex validated client-side; Save disabled when invalid or unchanged. | locations.tsx:900-916, 830 | same PUT | Playwright | OK |
| "Save Settings" (button-save-settings) | button | PUT {notificationEmail}. | locations.tsx:917-925 | PUT /api/locations/:id (above) | code only — write not pressed | OK |
| "Delete Location" card + InfoTip (info-tip-delete-location) + Delete button (button-delete-location) | button / dialog | Opens the confirm dialog. InfoTip key "delete-location" exists (info-content.ts:179). | locations.tsx:929-951, 953 | client only | Playwright both fixtures — dialog opens | OK |
| Delete confirm dialog (dialog-delete-location): copy, type-name gate, Cancel (button-cancel-delete-location), Confirm (button-confirm-delete-location) | dialog | Non-linked: plain confirm. gbp-linked: must type the exact business name. Copy promises removal of: synced Google reviews/photos/performance, Guard settings+history, AI reply settings+posts/photos, Social connections/settings/posts, citation campaigns+marks. | locations.tsx:953-992, 879-882 | DELETE /api/locations/:id → server/routes.ts:2742-2761 in one transaction: DELETE citations WHERE campaign_id IN (campaigns of location); DELETE citation_campaigns; DELETE google_profile_reviews (user+location); DELETE business_locations. FK ON DELETE CASCADE covers: gbp_sync_status, gbp_media, gbp_daily_metrics, gbp_content_jobs, gbp_content_style, gbp_guard, gbp_guard_changes, gbp_reply_settings, agency_jobs, edge_location_links, social_connections/settings/posts/sources/business_config/bulk_jobs. gbp_review_automation cascades via google_profile_reviews. NOT deleted: location_analytics, sitescan_schedules (no FK — orphaned). | FK list via pg_constraint; handler read; delete NOT pressed on seeded rows. Copy claims match except orphaned location_analytics/sitescan_schedules (tables empty for these locations today) — see bugs file | OK |
| Post-delete toast ("Location deleted…Your Google listing is unchanged.") | text | Reassures the Google listing is untouched. | locations.tsx:868-873 | client only | code | OK |

### Citations tab — <CitationsTab> (list)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Citation Campaigns" heading + InfoTip (info-tip-citations) + explainer | text | What citations are and why they matter. InfoTip key "citations" exists (info-content.ts:169). | locations.tsx:1071-1078 | client only | Playwright (icon present) | OK |
| "New Campaign" (button-new-campaign) | button | Reveals the create form. | locations.tsx:1079-1081 | client only | Playwright 22-loc506025-citations-new-clicked | OK |
| Campaign Name input (input-campaign-name) + Create (button-create-campaign) + Cancel (button-cancel-campaign) | input / button | Create validates non-empty client-side, then POSTs. | locations.tsx:1084-1116, 1016-1037 | POST /api/citations/campaigns → server/routes.ts:3064-3072 → requireCitationsPlan (any paid plan, routes.ts:2663-2670) + insertCitationCampaignSchema → INSERT citation_campaigns (userId from session) | VERIFIED on AUDIT- campaign 96235 (created, then deleted) | OK |
| Campaign cards (card-campaign-N): name (text-campaign-name-N), "X listed · Y to add", status badge, delete (button-delete-campaign-N) | text / badge / button | Card click opens CampaignDetail (?campaign=N); delete opens the confirm dialog. Bad ?campaign= falls back to the list. | locations.tsx:1054-1065, 1128-1161 | GET /api/citations/campaigns?locationId=N → agency middleware server/agency/middleware.ts:63-67: citation_campaigns JOIN business_locations (+agency visibility) WHERE ($8::int IS NULL OR l.id=$8) ORDER BY p.id DESC LIMIT 50 (client re-filters by locationId) | curl both fixtures → [] (citation_campaigns empty; 60 orphan citations rows join to deleted campaigns and never surface) | OK |
| "No citation campaigns yet." empty state | empty-state | Rendered when the list is empty. | locations.tsx:1122-1126 | client only | Playwright both fixtures | OK |
| Delete campaign dialog (dialog-delete-campaign) | dialog | Confirms; copy counts marked sites from citationsFound+opportunitiesFound. | locations.tsx:1165-1186 | DELETE /api/citations/campaigns/:id → server/routes.ts:3074-3085 → DELETE citations WHERE campaign_id; DELETE campaign (owner-checked) | VERIFIED on AUDIT- campaign 96235 (0 rows left) | OK |

### Citations tab — <CampaignDetail>

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Back (button-back-to-campaigns), name (text-campaign-detail-name), business name | button / text | Header. | locations.tsx:1250-1257 | client only | code (needs a campaign) | OK |
| "Build checklist" / "Update checklist" (button-run-scan) | button | Inserts the 30 contractor directories (routes.ts:3088-3119) as citations rows; skips names already present; the Google Business Profile row is auto-marked isFound=true with lastChecked=now when the location is gbp-linked (listingUrl=google_cid or null). Then recounts. | locations.tsx:1258-1263, 1200-1204 | POST /api/citations/campaigns/:id/run → server/routes.ts:3146-3170 (plan-gated) → INSERT citations … ; recountCitations updates citation_campaigns.citations_found/opportunities_found/last_run_at | VERIFIED on AUDIT- 96235: 30 rows inserted, Google first, Google row isFound=true (fixture linked but no real listing), lastRunAt set | OK |
| 4 count tiles (text-citations-listed/wrong/missing/unchecked) | stat | Client-side counts from rows: listed=isFound&&!napConsistent-false… i.e. listed (isFound=true, napConsistent≠false), wrong (isFound=true, napConsistent=false), missing (isFound=false), unchecked (isFound null). | locations.tsx:1241-1246, 1270-1279, 1226-1229 | client-side over GET …/results rows | code + PATCH flow below | OK |
| Site rows (row-citation-N): siteName + category | text | Directory name and category, ordered Google first then by priority list (LEGACY "Google My Business" renamed; unknowns keep insertion order at end). | locations.tsx:1301-1306 | GET /api/citations/campaigns/:id/results → server/routes.ts:3124-3140 → citations WHERE campaign_id ORDER BY rank | VERIFIED on AUDIT- campaign (30 rows, Google first) | OK |
| "Search" link (link-search-N) | link | Client-built Google URL, new tab. Google Business Profile row → google.com/maps/search/?api=1&query="<businessName> <city>"; other rows → google.com/search?q=site:<siteUrl-no-protocol> "<businessName>" <city>. city = location.city or campaign.address 2nd comma part. | locations.tsx:1230-1240, 1307-1311 | client only — URL construction code-read; both forms well-formed (encodeURIComponent on the query) | code (no campaign row persisted to click; verified construction logic) | OK |
| Status select (select-citation-N): Not checked / Listed ✓ / Listed — wrong / Not listed | select | PATCHes the row; switching away from a listed state also clears any saved listing URL client-side. | locations.tsx:1312-1326, 1212-1215 | PATCH /api/citations/:id → server/routes.ts:3181-3206 → zod {status enum, listingUrl https-only ≤500}; map listed=[true,true], wrong=[true,false], missing=[false,null], unchecked=[null,null]; sets lastChecked (null when unchecked); recountCitations | VERIFIED: listed+https link → isFound=true/napConsistent=true + URL stored; wrong → [true,false] keeps URL; missing → [false,null]; http:// link → 400 "Enter a full link starting with https://"; counts updated 1/1 and matched SQL | OK |
| Listing URL input (input-listing-N) + "View" link (link-listing-N) + clear (button-clear-listing-N) | input / link / button | Input only for listed/wrong rows; saves on blur (Enter blurs); https validated (toast otherwise); View opens the saved URL; clear PATCHes listingUrl=null. | locations.tsx:1327-1358, 1216-1224 | same PATCH | VERIFIED via PATCH flow above; blur/click interactions code-read | OK |
| "Click Build checklist to list the 30 sites…" empty state | empty-state | Before the checklist is built. | locations.tsx:1285-1288 | client only | code | OK |

### Shared: AgencyWorkspace (client/src/components/agency-workspace.tsx)

This account gets the agency bulk workspace (`/api/agency/me` → entitled:true, role owner), so OwnLocations (the /api/locations?paged list) is DEAD in this environment; mapped by code.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| StatGrid "Locations" / "Need reconnect" | stat | 2 / 1 — matches SQL (2 locations; 506025 has gbp link but no live grant → reconnect). | agency-workspace.tsx:91-92 | GET /api/agency/dashboard → server/agency/access.ts:101-103 dashboard(): counts per statusSql — reconnect = gbp_location_name NOT NULL AND no live grant (access.ts:81) | curl {total:2,reconnect:1,unlinked:1} matches SQL | OK |
| Search input, client filter, status filter with counts | input / select | Filters the list; counts appended from dashboard stats. | agency-workspace.tsx:95-99 | GET /api/agency/locations?q=&status=&offset= → access.ts:93-100 listLocations: business_locations l LEFT JOIN agency_clients c, visibility + ILIKE on name/address/city/state/zip/place_id/client, statusSql filter, ORDER BY l.id LIMIT 50 OFFSET | curl all/status=reconnect/status=synced — 506025 under reconnect, none synced | OK |
| Location rows (agency-location-N): checkbox, name button (opens detail), client, address (fullAddress), Google pill "Linked"/"Not linked" | text / button | Row click opens the detail view. Pill derives ONLY from gbp_location_name presence → 506025 shows "Linked" while the same row is counted as "Needs reconnect" in the stat and filter — see bugs file. | agency-workspace.tsx:109 | same list endpoint | Playwright 01-locations-list | OK |
| "More" expander, Select page / Select all matching / Clear, "Export … CSV" links | button / link | Selection UI; export href /api/agency/export?… (GET download). | agency-workspace.tsx:101-108 | POST /api/agency/bulk for actions (not pressed) | code (selection requires clicks; export is a download link) | OK |
| Bulk action fieldset (sync/link/unlink/assign/guard/ai-replies/content/scan) | select / button | Queues bulk actions over selected/all-matching locations. | agency-workspace.tsx:111-119 | POST /api/agency/bulk → agency routes (queued jobs) | code only — writes, not pressed | OK |
| Pager ("1–2 of 2", Previous/Next page) | button | 50 per page via ?offset=. | agency-workspace.tsx:26-28, 110 | listLocations LIMIT 50 OFFSET | Playwright | OK |
| Plan upsell line | text | "Client workspaces, bulk actions… part of the Agency Workspace on the <plan> plan." | agency-workspace.tsx:67 | client only | Playwright | OK |
| OwnLocations branch (own-location-N, own-locations-empty, button-open-single-location, button-import-own-profile) | text / button | The non-agency owner list from /api/locations?paged=true with single-location shortcut and no-plan empty state. | agency-workspace.tsx:38-69 | GET /api/locations?paged=true → agency middleware server/agency/middleware.ts:29-33 → listLocations envelope | code only — unreachable with an agency plan (DEAD in this env) | DEAD |

### Shared: GbpConnection (client/src/components/gbp-connection.tsx) — list banner + per-location

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Business Profile not connected…" copy (locations context) | text | Shown when there are no connected accounts. Here: always (0 grants). | gbp-connection.tsx:92-96, 116-117 | GET /api/gbp/status → server/gbp/routes.ts:60-66: grantStatus (gbp_grants) + per-location sync rows (gbp_sync_status) for gbp-linked locations only | curl {connected:false, locations:[506025 row]}; Playwright | OK |
| Connected-account rows (gbp-account): pill Connected/Reconnect needed, email, Reconnect / View profiles (button-view-google-profiles) / Open in Google (button-open-google-business → business.google.com/locations?authuser=email) / Disconnect (button-disconnect-google-account) | badge / button | Per-account status and actions. Disconnect POSTs {subject} after confirm; purges that account's synced Google data. | gbp-connection.tsx:118-134 | GET /api/gbp/status (grantStatus); POST /api/gbp/disconnect → gbp/routes.ts:67-86 (recent-auth required; DELETE gbp_grants + purgeGoogleData; revokes token at Google) | code only — 0 accounts here; disconnect not pressed | OK |
| Link summary line (gbp-link-summary) | text | "N synced · N ready to link · N not in a connected account…" from /api/gbp/linkage states. | gbp-connection.tsx:136-139 | GET /api/gbp/linkage → gbp/routes.ts:103-115: per-location state synced/reconnect/available/unlinked (grant join + agency_discovery match on placeId, 24 h window) | curl: 104296 unlinked, 506025 reconnect | OK |
| Grant error alerts | banner | Per-grant errors from linkage. | gbp-connection.tsx:140 | linkage errors [] | n/a | OK |
| "Connect Google Business Profile / Connect another Google account" button | button | <a href="/api/gbp/connect"> → RecentAuthModal intercept → startGbpConnect preflight → Google consent. | gbp-connection.tsx:141-142 | GET /api/gbp/connect (see AddLocationDialog) | Playwright (button rendered); OAuth not started | OK |
| "Link & sync N ready locations" (button-link-all-gbp) | button | Links every `available` (discovered, unlinked-by-user=false) listing via POST /api/gbp/import. | gbp-connection.tsx:143 | POST /api/gbp/import → gbp/routes.ts:116-124 | code (0 available) | OK |
| Sync details <details> + per-location "Sync now" | button | For gbp-linked locations: account email, per-kind last success/error from gbp_sync_status; Sync now POSTs /api/gbp/locations/:id/sync (queued 202 when connected, inline syncLocation when not). | gbp-connection.tsx:145-148 | GET /api/gbp/status (locations rows); POST /api/gbp/locations/:id/sync → gbp/routes.ts:136 | Playwright 20-loc506025-insights shows "Sync details"; button not pressed (fixture has no grant — inline syncLocation would fail against Google) | OK |
| `?gbp=consent-failed` alert | banner | "Google connection was not completed…" when the OAuth callback fails. | gbp-connection.tsx:114, 135 | server redirect /locations?gbp=consent-failed (gbp/routes.ts:46,58) | code | OK |
| GbpLinkCell (gbp-link-N): Synced / Reconnect / Ready to link / Not linked states, Unlink (button-unlink-gbp-N), Link & sync (button-link-gbp-N) | badge / button | The per-location link widget. Reconnect state for 506025 (linked, grant gone): badge + "Its Google account was disconnected" + Reconnect + Unlink (POST /api/gbp/locations/:id/unlink, confirm; removes synced Google data, keeps the location). | gbp-connection.tsx:57-89 | GET /api/gbp/linkage; POST /api/gbp/locations/:id/unlink → gbp/routes.ts:135 → unlinkLocation | code only — rendered inside GuardUnlinked when a listing is available; not pressed here (unlink is a write) | OK |

### Shared: recent-auth (client/src/components/recent-auth.tsx) + InfoTip + LocationSearchSummary data flow

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| startGbpConnect preflight | button | GET /api/gbp/connect?format=json → on 403 {reauth:true} apiRequest opens RecentAuthModal; success navigates to Google's consent URL. Anchors href="/api/gbp/connect" are intercepted globally. | recent-auth.tsx:21-25, 53-60; queryClient.ts:23-27 | GET /api/gbp/connect (gbp/routes.ts:32-43); reauth endpoints /api/auth/reauth (GET method, POST verify, POST /email) | code only — OAuth must not be started; modal flow code-read | OK |
| RecentAuthModal (text-reauth-reason, button-reauth-send-code, button-reauth-google) | dialog | Password / authenticator / emailed 6-digit code (10 min expiry) step-up; Google step-up via /api/auth/google?reauth=1 for GBP connects. | recent-auth.tsx:31-86 | /api/auth/reauth* (account-security) | code only | OK |
| InfoTip (info-tip-<k>, info-dialog-<k>) | dialog | Renders a 16px ⓘ button (44px target) opening a plain-English explainer from INFO_CONTENT; unknown keys render nothing. Used on this page: k="delete-location" (settings), k="citations" (citations header). Both keys exist (info-content.ts:169,179). | info-tip.tsx:29-87 | client only (INFO_CONTENT static) | code + key existence | OK |
| Dead imports in locations.tsx | text | recharts (LineChart/Bar/XAxis/…, lines 43-45) and lucide icons MapPin/Phone/Mail/Users/Star/ChevronDown/Eye/MousePointerClick/Smartphone/Monitor (lines 34-37) imported but never used; GuardStatus (line 5) imported but unused. | locations.tsx:5, 34-45 | n/a | grep — no usages | DEAD |

## Server route index (this page's surface)

- GET /api/locations → server/routes.ts:2672 (owner list) ; GET /api/locations?paged=true → agency/middleware.ts:29-33 (envelope)
- GET /api/locations/:id → routes.ts:2681 ; POST /api/locations → routes.ts:2692 (plan + location cap) ; PUT /api/locations/:id → routes.ts:2717 (locationUpdateInput allowlist, route-guards.ts:136-165) ; DELETE /api/locations/:id → routes.ts:2742 (transaction, above)
- POST /api/locations/search-google → routes.ts:2763 ; POST /api/locations/:id/import-google → routes.ts:2972
- GET /api/entitlements → routes.ts:249
- GET /api/gbp/locations → gbp/routes.ts:87-101 ; POST /api/gbp/import → gbp/routes.ts:116 ; GET /api/gbp/connect → gbp/routes.ts:32 ; GET /api/gbp/status → :60 ; GET /api/gbp/linkage → :103 ; POST /api/gbp/disconnect → :67 ; GET /api/gbp/locations/:id/media → :125 ; GET /api/gbp/locations/:id/performance → :139 ; POST /api/gbp/locations/:id/unlink → :135 ; POST /api/gbp/locations/:id/sync → :136
- Guard: GET /api/gbp/locations/:id/guard → gbp/guard-routes.ts:69 ; PUT → :71 ; POST /preview → :70 ; POST /check → :79 ; POST /changes/:changeId → :80 ; GET /api/gbp/guard/status → :64 ; GET+POST /api/gbp/reports/{changes,reviews}/:id → :86-92
- Citations: GET /api/citations/campaigns → agency/middleware.ts:63-67 (owner+member) ; POST → routes.ts:3064 (plan-gated) ; DELETE /:id → routes.ts:3074 ; GET /:id/results → routes.ts:3124 ; POST /:id/run → routes.ts:3146 ; PATCH /api/citations/:id → routes.ts:3181
- GSC summary: GET /api/gsc/locations/:id/summary → gsc/routes.ts:259 → gsc/service.ts:280-292
- Agency: GET /api/agency/me, /api/agency/locations, /api/agency/dashboard, /api/agency/clients, POST /api/agency/bulk, GET /api/agency/export

## Element counts

Grouped totals (element rows in the map above):

| Container group | Total | OK | BUG | UNCLEAR | DEAD |
|---|---|---|---|---|---|
| List page shell | 7 | 7 | 0 | 0 | 0 |
| AddLocationDialog (both tabs) | 21 | 21 | 0 | 0 | 0 |
| LocationDetail shell | 4 | 4 | 0 | 0 | 0 |
| Insights tab | 8 | 7 | 1 | 0 | 0 |
| Guard tab | 14 | 13 | 0 | 0 | 1 |
| Info tab | 9 | 9 | 0 | 0 | 0 |
| Services tab | 6 | 6 | 0 | 0 | 0 |
| Photos tab | 7 | 5 | 2 | 0 | 0 |
| Social tab | 3 | 3 | 0 | 0 | 0 |
| Settings tab | 6 | 6 | 0 | 0 | 0 |
| Citations list | 7 | 7 | 0 | 0 | 0 |
| CampaignDetail | 8 | 8 | 0 | 0 | 0 |
| AgencyWorkspace | 9 | 8 | 0 | 0 | 1 |
| GbpConnection | 10 | 10 | 0 | 0 | 0 |
| Shared (recent-auth/InfoTip/dead imports) | 4 | 3 | 0 | 0 | 1 |
| **Total** | **123** | **117** | **3** | **0** | **3** |

(The agency-list "Linked" pill inconsistency and the delete-dialog orphan rows are recorded in bugs-batch2.md as additional minor findings; the hard-coded isPremiumPlus at locations.tsx:89 is recorded above as a fact, per instructions.)

---

*Batch 3 — pages /google-reviews, /review/:token, /review/:token/unsubscribe, /schedules.*

Audit date 2026-10-04. Dev server http://127.0.0.1:8302 (DEV_AUTH_BYPASS_USER1 — every request is user 1, platform admin). DB `constructhub_dev_a6`, read-only SQL. All four routes confirmed in client/src/App.tsx; `SHOW_GOOGLE_REVIEWS = true` (client/src/lib/features.ts:26).

Route registration:
- `/schedules` → SchedulesPage — App.tsx:32,170; signed-in only (App.tsx:337 SIGNED_IN_ONLY); page title "Scrape Schedules" (App.tsx:364)
- `/google-reviews` → GoogleReviewsPage — App.tsx:68,223 (feature-gated); signed-in only (App.tsx:341)
- `/review/:token/unsubscribe` → ReviewUnsubscribePage — App.tsx:70,224 (feature-gated); PUBLIC (not in SIGNED_IN_ONLY)
- `/review/:token` → ReviewFeedbackPage — App.tsx:69,225 (feature-gated); PUBLIC

**Dev-bypass caveat affecting all customer flows:** `isOwnerPreview` (server/route-guards.ts:170) is true for every request on this lane because all requests authenticate as user 1 and all 25 seeded review_requests belong to user 1. Result: the feedback/complete/track endpoints return `{preview:true, recorded:false}` and write nothing; the rating-restore path in the feedback page is skipped. Customer-mode behavior was verified by code + endpoint contract only. An AUDIT- row (id 928, audit-lane2@example.invalid) was created through the app's own create endpoint to exercise create/send/trash/unsubscribe paths; it was soft-deleted afterward and now sits in trash (16 trash rows = 15 seeded + 1 AUDIT).

**SQL ground truth (review_requests, 25 rows, all user_id=1):** 10 active (deleted_at IS NULL), 15 trashed. Active by status: sent 5 (ids 12,13,17,18,111), positive_feedback 3 (14,20,21), negative_feedback 2 (15,16), scheduled 0. Active aggregates: google_link_opened=3 (13,14,16), feedback_rating>=9 = 4 (13,14,20,21), status='sent' AND NOT unsubscribed = 3 (12,13,18), unsubscribed=2 (17,111), email_opened=8, link_clicked=8, review_submitted=0 (all rows), reminders_sent=0 (all rows), photos_downloaded=0 (all rows). No time window on any stat — the tiles count the full history of the account. created_at range 2026-09-29…2026-09-30.
Settings: review_templates 1 row (id 13 "R2-r1 template", is_default=t, google_profile_url `https://search.google.com/local/writereview?placeid=R2R1FIXTURE`). review_reminder_settings 1 row (enabled, maxReminders 3, intervalHours 48, 3 windows, timezone Asia/Tokyo). review_referral_settings 1 row (enabled=t, offer='x' — so referralOffer is live). review_recipient_preferences 10 rows (unsubscribe suppressions). google_profile_reviews 0, gbp_reply_settings 0, gbp_review_automation 0, scrape_schedules 0, sitescan_schedules 0.

---

## /google-reviews — client/src/pages/google-reviews.tsx
Purpose: owner dashboard — send review-request emails to clients, track the private feedback flow, manage Google Business Profile templates, reminder cadence, trash; second tab reads/replies to Google profile reviews.

### Header + tabs
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Reviews" title (text-reviews-title) | text | Page title; description switches with the tab | google-reviews.tsx:482 | — | Playwright | OK |
| "New review request" (button-new-review-request) | button | Opens the send dialog | google-reviews.tsx:487 | client only | Playwright | OK |
| Tab "Review requests" (tab-review-requests) | tab | Shows requests section | google-reviews.tsx:495 | client only; `?tab=` URL param via useUrlParam | Playwright | OK |
| Tab "Google profile reviews" (tab-profile-reviews) | tab | Shows GBP reviews section | google-reviews.tsx:496 | client only; sets `?tab=profile-reviews` | Playwright | OK |

### Stat tiles (Review requests tab)
Data source for all four: GET /api/reviews/list → server/routes.ts:5001 → storage.getReviewRequestsByUser (server/storage.ts:747) → `SELECT * FROM review_requests WHERE user_id=1 AND deleted_at IS NULL ORDER BY created_at DESC` — soft-deleted excluded, no time window. Client counts in-memory (useMemo filters at google-reviews.tsx:163-172 are search-only; the stats are inline filters at :502-505).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Total sent (stat-total-sent) | stat | Count of returned rows whose status ≠ scheduled/suppressed — i.e. everything ever sent | google-reviews.tsx:502 | GET /api/reviews/list → review_requests, user 1, deleted_at IS NULL; client filter `status !== "scheduled" && !== "suppressed"` | SQL `count(*) FILTER (WHERE deleted_at IS NULL AND status NOT IN ('scheduled','suppressed'))` = 10; Playwright shows 10 | OK |
| Google links opened (stat-google-links-opened) | stat | Requests where the client opened the Google review link | google-reviews.tsx:503 | same endpoint; filter `googleLinkOpened` (review_requests.google_link_opened bool) | SQL = 3 (ids 13,14,16); Playwright shows 3 | OK |
| Positive feedback (stat-positive) | stat | Requests with a private rating ≥ 9/10 (rating-based, NOT status-based) | google-reviews.tsx:504 | same endpoint; filter `feedbackRating >= 9` (review_requests.feedback_rating int) | SQL = 4 (ids 13,14,20,21); Playwright shows 4. Note: id 13 has status 'sent' (rating kept, status reset by an earlier resend) so this tile (4) disagrees with the count of "Positive" pills (3) | OK |
| Awaiting response (stat-pending) | stat | Requests still 'sent' and not unsubscribed | google-reviews.tsx:505 | same endpoint; filter `status === "sent" && !unsubscribed` | SQL = 3 (ids 12,13,18); Playwright shows 3. Note: id 13 already rated 9/10 yet counts as awaiting (see bugs file suspicion) | OK |

### Review requests list
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Search box (input-search-reviews) | input | Filters the loaded list client-side by name/email/phone/address substring (case-insensitive) | google-reviews.tsx:512-518 | client only: :163-172 | Playwright (renders when list non-empty) | OK |
| Clear search × (button-clear-search) | button | Clears the search box | google-reviews.tsx:520-524 | client only | code | OK |
| Empty state "No review requests yet" (button-first-review-request) | state | Shown when the account has no (non-trashed) requests; button opens send dialog | google-reviews.tsx:534-540 | client only | code (10 rows on dev, not shown) | OK |
| Request card (card-review-request-${id}) | card | One per request; click header to expand | google-reviews.tsx:551-554 | GET /api/reviews/list | Playwright counted 10 cards | OK |
| Client name (text-client-name-${id}) | text | Client name | google-reviews.tsx:566 | review_requests.client_name | Playwright | OK |
| Status pill (badge-status-${id}) | pill | Priority: "Google link opened" (green) → "Positive" → "Feedback" → null if unsubscribed → "Scheduled · date" → "Pending" | google-reviews.tsx:466-474 | client-side from status/googleLinkOpened/unsubscribed/scheduledFor | Playwright: first card shows "Positive"; screenshot shows Unsubscribed/Pending/Google link opened variants | OK |
| Rating badge "N/10" | badge | Shows recorded private rating when present | google-reviews.tsx:568-573 | review_requests.feedback_rating | Playwright (9/10 visible on two cards) | OK |
| Reminders badge "N reminders" | badge | Shows remindersSent when status='sent' and >0 | google-reviews.tsx:574-579 | review_requests.reminders_sent (=0 for all rows now; badge not rendered) | SQL | OK |
| Unsubscribed badge | badge | Red badge when the client unsubscribed | google-reviews.tsx:580-584 | review_requests.unsubscribed | Playwright (2 cards show it) | OK |
| Referral badge (thumbs up/down) | badge | Shows recorded referralFeedback | google-reviews.tsx:585-594 | review_requests.referral_feedback ('up' on id 20 → badge visible in screenshot) | Playwright + SQL | OK |
| Email / phone / address / project description lines | text | Contact + job lines on the card | google-reviews.tsx:596-607 | review_requests.client_email/client_phone/client_address/project_description | Playwright | OK |
| Preview eye (button-preview-${id}) | button | Opens `/review/<token>` in a new tab — the owner's own link; server treats it as preview and records nothing | google-reviews.tsx:610-619 | GET /api/review/:token → routes.ts:5364; isOwnerPreview guard (route-guards.ts:170) | Playwright (share link value matches `/review/<token>`); preview verified on feedback page | OK |
| Resend (button-resend-${id}) | button | Re-sends the request email. Hidden when unsubscribed. If the customer already answered, server keeps the answer and re-arming is skipped; otherwise status→'sent', remindersSent→0, nextReminderAt re-armed | google-reviews.tsx:620-632 | POST /api/reviews/:id/resend → routes.ts:5286; sendReviewRequestEmail (email.ts:401); storage.updateReviewRequest | code (not pressed — would email seeded clients) | OK |
| Delete (button-delete-${id} → button-confirm-delete-${id} / button-cancel-delete-${id}) | button ×2 | Soft-deletes into trash (14-day auto-purge) after an inline confirm | google-reviews.tsx:633-665 | DELETE /api/reviews/:id → routes.ts:5140 → storage.deleteReviewRequest (storage.ts:760, sets deleted_at=now) | verified on own AUDIT row 928 (trash 15→16 rows); not pressed on seeded rows | OK |
| Expand chevron (button-expand-${id}) | button | Toggles the tracking panel | google-reviews.tsx:556-559, 666 | client only | Playwright (panel opens) | OK |

### Expanded tracking panel (panel-tracking-${id}, google-reviews.tsx:671)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Personal review link (panel-share-link-${id}) | panel | Read-only input with the public link + copy/email helpers | google-reviews.tsx:672-735 | client only (value built from window.location.origin + token) | Playwright: input shows http://127.0.0.1:8302/review/72ffaa47-… (id 111) | OK |
| — input-review-link-${id} | input read-only | Selects all on click | google-reviews.tsx:683-689 | client only | Playwright | OK |
| — Copy link (button-copy-link-${id}) | button | navigator.clipboard.writeText(reviewUrl), toast on success/failure | google-reviews.tsx:690-704 | client only | code (clipboard needs permission) | OK |
| — Copy email (button-copy-email-body-${id}) | button | Copies a prefab mailto body with the link | google-reviews.tsx:705-719 | client only | code | OK |
| — Email (button-open-mailto-${id}) | button | Opens the owner's mail client (mailto: with prefab subject/body) — no server send | google-reviews.tsx:720-731 | client only | code | OK |
| Email opened tile | tile | Green dot + "Email opened" when emailOpened (or linkClicked); timestamp in Pacific via formatPST | google-reviews.tsx:737-751 | review_requests.email_opened / email_opened_at / link_clicked / link_clicked_at | SQL (8 of 10 active rows opened); Playwright tile renders | OK |
| Link clicked tile | tile | Green dot when the client hit /api/review/:token/click | google-reviews.tsx:753-761 | review_requests.link_clicked / link_clicked_at | SQL = 8 | OK |
| Photos tile | tile | "No photos" / "Photos downloaded" / "Not downloaded" + timestamp | google-reviews.tsx:763-771 | review_requests.photos (jsonb) length, photos_downloaded / photos_downloaded_at | SQL: all 0 photos → shows "No photos" | OK |
| Review method tile | tile | "AI generated" / "Wrote their own" / "No review yet" icon | google-reviews.tsx:773-784 | review_requests.review_method ('ai'/'own'/null) | SQL: ids 13,14,16='own' | OK |
| Completed flow tile (tile-flow-completed-${id}) | tile | Shown when lastStep is done/bonus_reviews | google-reviews.tsx:786-793 | review_requests.last_step | SQL: 5 active rows done | OK |
| Bounced tile (tile-flow-bounced-${id}) | tile | "Bounced: <step>" when lastStep set but reviewSubmitted false — see bugs file: review_submitted is never written true, so the second half of this condition is always true | google-reviews.tsx:794-801 | review_requests.last_step | SQL: id 26 'review', id 21 'referral' | OK |
| Private feedback block | panel | Categories badges + comments when rating<9 or comments/categories exist | google-reviews.tsx:804-821 | review_requests.feedback_categories (jsonb) / feedback_comments | SQL: ids 15,16 have categories/comments | OK |
| Referral response block | panel | "Would refer others / would not refer" when referralFeedback present | google-reviews.tsx:822-831 | review_requests.referral_feedback | SQL: id 20 'up' | OK |
| Sent / Last reminder footer | text | "Sent: <PST time>" and last reminder time | google-reviews.tsx:833-838 | review_requests.created_at / last_reminder_at, formatted America/Los_Angeles | code (all last_reminder_at null on dev) | OK |

### Google Business Profiles (templates) section
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Count badge (badge-template-count) | badge | "N" (unlimited) or "N/limit" | google-reviews.tsx:849, 159-161 | GET /api/entitlements → allowances.reviewTemplates (-1 here) + GET /api/review-templates count | curl (allowances.reviewTemplates=-1) + Playwright shows "1" | OK |
| Add profile (button-new-template) | button | Opens add/edit profile dialog; disabled atTemplateLimit | google-reviews.tsx:851 | POST /api/review-templates → routes.ts:5023 (plan gate requirePlan, resolveReviewLink short-link resolver, per-account lock, isDefault exclusivity) | Playwright enabled (limit -1) | OK |
| First-profile empty state (button-create-first-template) | state | Same, when no templates | google-reviews.tsx:853-859 | — | code (1 template on dev) | OK |
| Template card (card-template-${id}) | card | Name, default badge, URL, description; edit/delete | google-reviews.tsx:862-929 | GET /api/review-templates → routes.ts:5012 → storage.getReviewTemplatesByUser (storage.ts:783, WHERE user_id, no soft-delete on this table) | Playwright: 1 card "R2-r1 template" + Default badge | OK |
| Edit (button-edit-template-${id}) | button | Opens dialog prefilled | google-reviews.tsx:884-893 | PATCH /api/review-templates/:id → routes.ts:5075 (owner check via list, resolveReviewLink, default exclusivity) | code | OK |
| Delete (button-delete-template-${id} → confirm/cancel) | button ×2 | Inline confirm then DELETE | google-reviews.tsx:894-926 | DELETE /api/review-templates/:id → routes.ts:5114 (owner check) → storage.deleteReviewTemplate | code (not pressed — only 1 seeded template) | OK |
| Limit notice (text-template-limit) | text | "Profile limit reached… See plans" when at limit; links /pricing | google-reviews.tsx:930-936 | client only | code (limit -1 → hidden) | OK |
| Template dialog (modal-template) | dialog | Name*, Google review link* (client-side looksLikeGoogleReviewLink check + server resolveReviewLink), default description, "Set as default" checkbox | google-reviews.tsx:1648-1724 | POST/PATCH as above; tables review_templates (name, google_profile_url, project_description, is_default) | Playwright dialog opens; URL validation code-verified | OK |

### Follow-up reminders (ReminderSettingsCard, google-reviews.tsx:2251)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card (card-reminder-settings) + Active/Disabled pill (badge-reminder-status) | section | Collapsed by default; pill mirrors `enabled` | google-reviews.tsx:2311-2323 | GET /api/review-reminder-settings → routes.ts:5709 → review_reminder_settings (user row or defaults enabled/3×48h/3 windows/America_New_York) | Playwright shows "Active"; SQL row enabled=t | OK |
| Manage/Close | button | Expands the editor | google-reviews.tsx:2319 | client only | Playwright | OK |
| Automatic reminders switch (switch-reminders-enabled) | switch | Toggles enabled locally until saved | google-reviews.tsx:2332-2336 | PUT /api/review-reminder-settings → routes.ts:5726 (zod reminderSettingsInput, server/review-reminders.ts:3-13) | code (not saved — would mutate seeded settings) | OK |
| Interval select (select-interval) | select | 24h/48h/72h/4d/7d | google-reviews.tsx:2347-2361 | same PUT; review_reminder_settings.interval_hours | Playwright shows "Every 48 hours"; SQL 48 | OK |
| Max reminders select (select-max-reminders) | select | 1/2/3/5 | google-reviews.tsx:2369-2383 | same PUT; max_reminders | Playwright shows "3 reminders"; SQL 3 | OK |
| Delivery windows (select-window-start-${i} / -end-${i}) | selects | One row per reminder up to maxReminders; start 6:00 AM–8:00 PM, end must follow start; label shows timezone | google-reviews.tsx:2386-2430 | same PUT; time_windows jsonb + timezone string (display-only in UI — no timezone picker) | Playwright: "Delivery windows (Japan Standard Time)" (SQL timezone Asia/Tokyo), 3 window rows | OK |
| Save (button-save-reminder-settings) | button | PUT currentSettings (whole object) | google-reviews.tsx:2439-2448 | PUT → storage.upsertReminderSettings; 400 returns zod flatten, client parses first field error | code | OK |
| "How it works" notice | notice | Explains reminders stop on response/unsubscribe/max; every reminder email has an unsubscribe link | google-reviews.tsx:2433-2435 | matches server processReminders (routes.ts:5800-5861): every 5 min, inReminderWindow gate, sendReviewReminderEmail, reminders_sent+1, last_reminder_at, next_reminder_at until max | code | OK |

### How-it-works + platform links
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "How review requests work" (button-toggle-how-it-works) | collapsible | Static educational content (anti-gating policy, flow steps) | google-reviews.tsx:943-1008 | client only | code | OK |
| "Other review platforms" links (link-platform-yelp/bbb/angi/guildquality/homeadvisor/houzz/thumbtack/facebook) | external links | 8 hard-coded outbound links (biz.yelp.com, bbb.org/near-me, angi.com/pro/login, guildquality.com/login, pro.homeadvisor.com, houzz.com/pro/login, pro.thumbtack.com, business.facebook.com), target=_blank rel=noopener | google-reviews.tsx:1010-1035 | client only | code | OK |

### Trash section (renders only when trash non-empty, google-reviews.tsx:1037)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Trash header + count badge | section | Count badge = trash rows; description "Auto-deletes after 14 days" | google-reviews.tsx:1037-1041 | GET /api/reviews/trash → routes.ts:5128 (calls purgeExpiredTrash first: hard-deletes deleted_at < now-14d, storage.ts:772) | curl: 15 seeded rows pre-audit; Playwright shows section | OK |
| Show/Hide (button-toggle-trash) | button | Toggles the trashed list | google-reviews.tsx:1042-1049 | client only | Playwright | OK |
| Trash item (trash-item-${id}) | row | Name, email, rating-or-status badge, "Nd left" (client calc ceil(14 - age days)) | google-reviews.tsx:1052-1068 | review_requests WHERE user_id AND deleted_at IS NOT NULL ORDER BY deleted_at DESC | Playwright | OK |
| Restore (button-restore-${id}) | button | Clears deleted_at | google-reviews.tsx:1070-1079 | POST /api/reviews/:id/restore → routes.ts:5155 → storage.restoreReviewRequest (storage.ts:764) | curl on AUDIT row 928 (200, deleted_at→null, then re-deleted) | OK |
| Permanently delete (button-perm-delete-${id} → button-confirm-perm-delete-${id} / Cancel) | button ×2 | Inline confirm then hard DELETE | google-reviews.tsx:1080-1111 | DELETE /api/reviews/:id/permanent → routes.ts:5170 → storage.permanentlyDeleteReviewRequest (storage.ts:768) | code (not pressed) | OK |

### Send review request dialog (modal-send-review, google-reviews.tsx:1129)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| GMB profile select (select-gmb-profile) | select | Picks review_templates row; "__create__" option opens the profile dialog on top | google-reviews.tsx:1140-1169 | GET /api/review-templates | Playwright: "R2-r1 template (Default)" | OK |
| Add-profile inline notice (link-create-profile) | link | Opens profile dialog when no templates | google-reviews.tsx:1170-1177 | — | code | OK |
| Client name / email / phone / address (input-client-name/email/phone/address) | inputs | name+email required for Send | google-reviews.tsx:1180-1223 | POST /api/reviews/create body {clientName, clientEmail, clientPhone?, clientAddress?} | Playwright (Send disabled until name+email+template) | OK |
| Message mode toggle (button-mode-description / button-mode-personal) | segmented | Chooses projectDescription (feeds AI draft + email) vs personalMessage (replaces email body) | google-reviews.tsx:1225-1269 | POST body projectDescription? / personalMessage? | Playwright | OK |
| Photos: add (button-add-photos + hidden input-photo-upload), remove (button-remove-photo-${i}), Media Library (button-media-library-picker → modal-media-picker, media-folder-${id}, media-photo-${id}, button-attach-from-library) | file upload / picker | Up to 30 photos, uploaded in batches of 10; or attached from Media Library folders | google-reviews.tsx:1271-1420 | POST /api/upload/review-photos (multer array("photos",10) → routes.ts:5984); GET /api/media/folders (:1581), GET /api/media/folders/:id/photos (:1792) | code + route existence (no upload performed) | OK |
| Email theme picker (button-theme-${id} × 9) | swatches | navy-orange default … black-white; stored per request | google-reviews.tsx:1427-1466 | POST body emailTheme → review_requests.email_theme (all seeded rows 'navy-orange') | code (inside collapsed "Email appearance" section) | OK |
| BCC email (input-bcc-email, icon-bcc-info + tooltip-bcc-info, saved chips chip-bcc-${email} / button-select-bcc / button-remove-bcc / button-save-bcc) | input + tooltip + localStorage chips | Optional BCC for deliverability; last 3 saved in localStorage only | google-reviews.tsx:1468-1547 | POST body bccEmail → review_requests.bcc_email; client only for chips | code | OK |
| Schedule for later (checkbox-schedule-toggle, input-schedule-date, input-schedule-time, preset chips, "Will be sent on…" hint) | checkbox + datetime | When on, request is stored status='scheduled' and emailed later by processScheduledReviews (5-min loop) | google-reviews.tsx:1555-1620 | POST body scheduledFor (ISO) → routes.ts:4958-4977 status scheduled + scheduled_for; sender routes.ts:5863+ | code (date min = today local; no scheduled send pressed) | OK |
| Send (button-send-review-request) | button | Validates clientName+clientEmail+profile, POSTs create | google-reviews.tsx:1629-1642 | POST /api/reviews/create → routes.ts:4924: 401 no login; 400 missing fields/bad email; 409 isReviewSuppressed (verified: 409 for unsubscribed audit-lane2@example.invalid, no email sent); else insert review_requests (status sent, token uuid, google_profile_url from template/user, company_name/logo from users) + sendReviewRequestEmail + arm next_reminder_at when reminders enabled | curl with AUDIT row 928: 200 {id,token,message}; DB status=sent, next_reminder_at armed; email captured in tmp/email-outbox.jsonl (subject "AUDIT-Lane2-B3, how did your project go?") | OK |

### Profile-reviews tab (GoogleProfileReviewsTab, google-reviews.tsx:1729)
Data: GET /api/google-profile-reviews?paged=true&offset=… → routes.ts:5185 → google_profile_reviews WHERE user_id AND google_deleted=false ORDER BY review_date DESC, then in-memory filters (locationId/rating/response/search) and pagination envelope {items,total,unanswered,average,distribution,offset,pageSize}. Table empty on dev (0 rows) — all zeros verified honest: Playwright shows Reviews 0 / Unanswered 0 / Average "—", empty state "No Google profile reviews yet…", rating breakdown 0% bars.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| GbpConnection component | card | GBP account connect/linkage UI (queries /api/gbp/status, /api/gbp/linkage) | google-reviews.tsx:1868; components/gbp-connection.tsx | GET /api/gbp/status (connected=false on dev; one location "AI-TEST Ridgeline Roofing" id 506025) | curl + Playwright (connect card visible) | OK |
| AiReplySettings component | section | "AI review replies" settings (30 s refetch) | google-reviews.tsx:1869; components/ai-review-replies.tsx:22 | GET/PUT its own endpoints (ai-review-replies) | code (cross-feature, owned elsewhere) | OK |
| Stats (stat-total-profile-reviews / stat-unanswered / stat-avg-rating) | stats | total matching filters; unanswered = no replyComment; average toFixed(2) or "—" | google-reviews.tsx:1871-1875 | envelope total/unanswered/average (average null → "—") | curl envelope {total:0,unanswered:0,average:null,distribution:[0,0,0,0,0]} + Playwright | OK |
| Rating breakdown bars | bars | distribution[i] mapped 5→1 stars, pct rounded | google-reviews.tsx:1877-1891 | distribution from envelope | Playwright renders 0% (0) | OK |
| Toolbar: search (input-search-profile-reviews), location dropdown (dropdown-location-filter, input-location-search, option-location-all, option-location-loc-${id}), rating select (select-rating-filter), response select (select-response-filter), Clear filters (button-clear-filters), Pager | toolbar | Filters + 50-per-page pagination over the envelope | google-reviews.tsx:1896-1984 | GET /api/locations?${agency params} feeds the location list | code (empty list on dev) | OK |
| Review card (card-profile-review-${id}), note editor (button-add-note-${id}, input-note-${id}, button-save-note-${id}), reply editor (button-reply-${id}, input-reply-${id}, button-submit-reply-${id}), delete (button-delete-review-${id} + confirm), reply display/delete (button-delete-reply-${id}), draft (reply-draft-${id}, button-discard-draft-${id}), GoogleReport (profile-guard) | cards | Read/reply/note/delete synced GBP reviews; reply publishes to Google only when gbp.connected && googleReviewId, else saved as local draft | google-reviews.tsx:1999-2244 | PATCH /api/google-profile-reviews/:id/reply (routes.ts), PATCH …/note (:5255), DELETE …/:id (:5273) | code (0 rows; nothing to press) | OK |
| AgencyWorkspace compact | panel | Agency filter/workspace footer | google-reviews.tsx:2246; components/agency-workspace.tsx | /api/agency/me, /api/locations… | code (cross-feature) | OK |

Links on this page worth sanity-checking (existence only): /pricing (linked from limit notice) — exists in App.tsx; /review/:token preview route — verified; external platform URLs — external.

---

## /review/:token — client/src/pages/review-feedback.tsx (PUBLIC)
Purpose: the client's feedback page — private 1–10 rating, improvement categories/comments, referral opt-in, AI-assisted Google review drafting, photo downloads, and the "Leave a Google Review" link (google_profile_url). Token is a uuid; nothing here requires login.

Data load: GET /api/review/:token → routes.ts:5364 → storage.getReviewRequestByToken (storage.ts:742 — token lookup only, NO user scoping, NO deleted_at filter). Response: {id, clientName, companyName, companyLogoUrl, googleProfileUrl, projectDescription, photos, status, feedbackRating, reviewSubmitted, lastStep, referralOffer (from review_referral_settings when enabled — 'x' here), preview}. For non-owners the GET also writes link_clicked=true, link_clicked_at, and email_opened/email_opened_at if not set (mutating GET, owner-guarded). Bad token → 404 → page shows "Link Not Found" card (review-feedback.tsx:374-389; verified 404 by curl). Trashed token still returns full data (verified by curl on trashed id 244 — see bugs file).

Owner preview: `preview:true` returned when requester is the owner (always true on this dev lane) — page shows the amber "Preview — nothing you do here is recorded" banner (review-feedback.tsx:398-402), the track()/postFeedback()/completeFlowMutation() calls all short-circuit client- and server-side, and the restore effect returns early so the flow always starts at the rating step.

| Element (visible label / testid) | Kind | What it does, in plain words for the customer | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading spinner | state | While GET /api/review/:token loads | review-feedback.tsx:360-372 | — | Playwright | OK |
| Link Not Found card | state | 404 / no reviewData | review-feedback.tsx:374-389 | GET 404 verified by curl (bad token) | curl + code | OK |
| Preview banner (banner-review-preview) | banner | "Preview — nothing you do here is recorded for your customer" | review-feedback.tsx:398-402 | preview flag from GET /api/review/:token | Playwright shows banner for owner | OK |
| Company logo / initial (img-company-logo) + name (text-company-name) | image/text | Owner's companyLogoUrl (from users.company_logo_url, else initial) and companyName | review-feedback.tsx:404-426 | GET /api/review/:token fields | Playwright: "Alpine Exteriors Test" | OK |
| "Leave a Google Review" top button (link-google-review-always) | external link | Always-visible direct link to the owner's google_profile_url (target _blank, noopener); onClick beacons google-link-opened | review-feedback.tsx:428-437 | POST /api/review/:token/google-link-opened → routes.ts:5439 sets review_requests.google_link_opened(+_at) (first time only); anchor href = review_requests.google_profile_url | Playwright (renders); beacon code | OK |
| Rating step (rating-selector, button-rating-1..10, emoji feedback box, Continue button-submit-rating) | step | Pick 1–10; Continue POSTs feedback | review-feedback.tsx:442-525 | POST /api/review/:token/feedback {rating, categories?, comments?} → routes.ts:5412: 400 if rating not int 1–10; owner → {preview:true, recorded:false} (verified: no DB write); else review_requests.feedback_rating/categories/comments, status = positive_feedback (≥9) / negative_feedback, next_reminder_at=null | Playwright: 10 buttons, owner flow advances to referral step; POST contract verified (preview guard) | OK |
| Improvement step (text-improvement-heading, button-category-* × 8, input-improvement-comments, Submit Feedback button-submit-improvement, "Help me draft my honest review" button-improvement-draft, Google review section button-improvement-google-review) | step | For ratings ≤8: category chips + optional comments; Submit re-POSTs /feedback with same rating+categories+comments (records them, step→done); "Help me draft" saves notes and moves to describe; direct Google button opens google_profile_url then completes | review-feedback.tsx:527-628 | POST /api/review/:token/feedback (same as above); POST /complete when Google pressed | code (restore-to-improvement not reachable in owner preview; categories/comments render verified in code) | OK |
| Step progress bar (step-progress) | bar | Only on describe/review steps for high ratings ("Step 1 of 2", %) | review-feedback.tsx:630-647 | client only | Playwright: 0 on referral step (correct) | OK |
| Referral step (text-referral-heading, offer box, checkbox-referral-optin, Maybe Later button-skip-review, Continue button-leave-review) | step | Shown for rating ≥9 when owner enabled referral offer (enabled here, offer 'x'). Opt-in choice is client state until /complete | review-feedback.tsx:649-713 | referralOffer from GET (review_referral_settings.enabled → offer) | Playwright: "We Appreciate You!" + opt-in row after rating 10 | OK |
| Referral feedback step (button-referral-thumbs-up/down, Continue to Leave a Review button-continue-to-review, Skip — I don't want to leave a review button-skip-all) | step | Records sentiment, then describe; skip completes the flow immediately | review-feedback.tsx:715-796 | POST /api/review/:token/complete {referralOptIn, referralFeedback} → routes.ts:5448: sets last_step='done', referral_opt_in/referral_feedback (only when referral enabled), next_reminder_at=null; 409 if no rating first | code | OK |
| Describe step (text-describe-heading, input-review-highlights, Generate My Review button-generate-review, Skip — I'll write my own button-skip-describe) | step | Customer's own words → AI draft, or skip to write on Google directly | review-feedback.tsx:798-868 | POST /api/review/:token/generate-review {projectType (sent, ignored server-side), highlights} → routes.ts:5470: 409 owner preview / no rating; 400 highlights empty/>4000; budget takeBudget review-draft:owner:50 + per-request 5/day → 429 "Draft limit reached"; AI reviewFunnelDraft(companyName, rating, highlights) (AI endpoint — NOT called in audit); writes review_method='ai' | code only (AI endpoint excluded by rules; verified all guards by reading route) | OK |
| Review step (text-review-heading, generation spinner, text-generate-error, textarea-generated-review, button-copy-review, button-regenerate, photo block + link-download-photo-${i} + button-download-all-photos, Open Google & Leave Review button-open-google-review, copy-warning modal button-skip-copy/button-copy-and-go, photo-reminder modal button-skip-photos/button-download-and-continue) | step | Edit/copy the draft; gated so Google opens only after a successful copy (or explicit skip); downloads all request photos (POST track-photos) | review-feedback.tsx:870-1160, 1261-1358 | POST /api/review/:token/track-photos → routes.ts:5503 (photos_downloaded, first time); POST /google-link-opened; POST /complete; download hrefs are `<photo.url>/download?name=…` (R2 URLs) | code + Playwright (step renders in owner flow up to referral; review step code-mapped) | OK |
| Bonus step (link-bbb-review → https://www.bbb.org/, button-finish-bonus-reviews) | step | After a 10/10 complete: suggests BBB cross-post | review-feedback.tsx:1162-1223 | client only | code | OK |
| Done step (text-thank-you) | state | Thank-you screen; mentions referral follow-up when opted in | review-feedback.tsx:1225-1244 | client only | code | OK |
| Footer: Powered by ConstructHUB + "Unsubscribe from future emails" (link-unsubscribe) | link | Navigates to /review/:token/unsubscribe | review-feedback.tsx:1246-1258 | client only | Playwright href `/review/<token>/unsubscribe` | OK |
| Step tracking beacons | beacons | track-step POSTed on every step change (except rating and skips); track-review-method on "own" choices | review-feedback.tsx:144-169, 254-255, 860 | POST /api/review/:token/track-step {step} → routes.ts:5535 (review_requests.last_step); POST /track-review-method {method} → :5520 (review_method) | code (owner-suppressed on this lane) | OK |
| Resume-on-reload effect | behavior | Returning customer with a saved rating skips the rating step (→ referral/describe for ≥9, improvement for <9, done when lastStep done/bonus_reviews) | review-feedback.tsx:173-185 | reads feedbackRating/lastStep/referralOffer from GET /api/review/:token | code (owner preview returns early — verified by Playwright: Low2 token still shows rating step) | OK |
| beforeunload guard | behavior | Warns when leaving mid-flow with rating ≥9 before completion | review-feedback.tsx:153-161 | client only | code | OK |

---

## /review/:token/unsubscribe — client/src/pages/review-unsubscribe.tsx (PUBLIC)
Purpose: one-page unsubscribe for review emails — optional private note, single Unsubscribe action, resubscribe when already unsubscribed, or a way back to the feedback form.

Data load: GET /api/review/:token/unsubscribe-info → routes.ts:5740 → {clientName, companyName, unsubscribed: isReviewSuppressed(userId, email) from review_recipient_preferences, hasSubmitted: status !== 'sent'}. 404/{message} → "This link is no longer valid." (page checks `!info || info.message`, review-unsubscribe.tsx:105).

| Element (visible label / testid) | Kind | What it does, in plain words for the customer | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading / invalid states | states | Spinner; "This link is no longer valid." | review-unsubscribe.tsx:96-116 | GET unsubscribe-info 404 | curl (bad token not fetched; seeded tokens return data) | OK |
| Already-unsubscribed state (text-unsubscribed, Resubscribe button) | state | "You've been unsubscribed" + explanation; Resubscribe POSTs confirm:true | review-unsubscribe.tsx:118-141 | POST /api/review/:token/resubscribe → routes.ts:5790: 400 without confirm:true (verified); 403 when requester is the owner — "Only the customer can resubscribe from their email link" (verified by curl on AUDIT row); else resubscribeRecipient (server/review-suppression.ts:18) upserts review_recipient_preferences unsubscribed=false (future requests only) | Playwright (seeded unsubscribed token id 17 shows this state + button); 400/403 verified by curl | OK |
| Confirm screen (text-unsubscribe-heading, input-unsubscribe-feedback, button-submit-feedback-unsubscribe labeled "Unsubscribe" or "Send Note & Unsubscribe", error text) | form | Optional note + one-click unsubscribe; error shown on failure | review-unsubscribe.tsx:145-182 | POST /api/review/:token/unsubscribe {feedback?} → routes.ts:5756: unsubscribeRecipient (review-suppression.ts:7 — transaction: upsert preference unsubscribed=true + UPDATE all matching review_requests SET unsubscribed=true, next_reminder_at=null) then request row update unsubscribed=true, feedback_comments appended with "[Unsubscribe feedback]: " prefix | curl on AUDIT row 928: 200 {success:true}; DB verified (row unsubscribed, reminder disarmed, comments appended, preference row created) | OK |
| "Leave quick feedback instead" (link-leave-feedback) | link | Back to the feedback page /review/:token | review-unsubscribe.tsx:184-194 | client only | Playwright href `/review/<token>` | OK |
| RFC 8058 one-click | header flow | Mailbox providers POST form-encoded `List-Unsubscribe=One-Click` to /review/:token/unsubscribe (no /api prefix); the page GET serves the human flow | routes.ts:5777-5788 | POST /review/:token/unsubscribe → same unsubscribeRecipient + row update, 200 empty | curl on AUDIT row (200); form-encoded accepted | OK |

Note: the resubscribe 403-for-owner means on this dev lane an unsubscribed AUDIT address cannot be re-enabled through the app (customer-only by design). audit-lane2@example.invalid remains suppressed in review_recipient_preferences — a fake address, no side effects. The seeded suppressions (10 rows incl. qa-g06-unsub@example.com etc.) were not touched.

---

## /schedules — client/src/pages/schedules.tsx
Purpose: admin-only management of automatic permit-portal scrape schedules (scrape_schedules table) — shared schedules that keep the permit directory fresh. Sits behind the admin guard `app.use("/api/scrape-schedules", isAdmin)` (routes.ts:505-508, 403 "Administrator access required"); the page mirrors that with a 403 error branch (schedules.tsx:109-120). `sitescan_schedules` belongs to the Site Scan feature (server/sitescan/routes.ts) and is NOT used by this page.

Table state: scrape_schedules has 0 rows; GET /api/scrape-schedules → 200 [] (curl). Empty state verified honest by Playwright.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title (text-page-title) + description "Automatic permit refreshes… Admins only" | header | — | schedules.tsx:123-127 | — | Playwright | OK |
| 403 / load-error branch | state | "Administrator access is required to manage these shared schedules." when the query errors with 403 | schedules.tsx:109-120 | guard at routes.ts:505 (isAdmin); growth-isolation test asserts 403 for non-admin | code (user 1 is platform admin → not triggerable here) | OK |
| Add schedule (button-add-schedule / button-empty-add-schedule) + dialog | button/dialog | Opens create form | schedules.tsx:128-152, 212-224 | — | Playwright | OK |
| Schedule list cards (card-schedule-${id}) | list | Name (portal label), frequency, Active/Paused pill, "<searchType>: <value>", last-run date, toggle, delete | schedules.tsx:161-211 | GET /api/scrape-schedules → routes.ts:742 → storage.getScrapeSchedules (storage.ts:497, ORDER BY created_at DESC) — no user filter: schedules are global/shared | curl [] + Playwright (0 cards) | OK |
| Active/Paused pill | pill | From schedule.isActive | schedules.tsx:173-177 | scrape_schedules.is_active | code (no rows) | OK |
| Last run text | text | `Last run <locale date>` when lastRunAt set | schedules.tsx:181-186 | scrape_schedules.last_run_at | code | OK |
| Toggle (switch-schedule-${id}) | switch | Pauses/resumes; PATCH isActive | schedules.tsx:190-196 | PATCH /api/scrape-schedules/:id → routes.ts:785 (zod partial, "Nothing to update" when empty, 404 missing) → storage.updateScrapeSchedule (storage.ts:506) | code (no rows to toggle) | OK |
| Delete (button-delete-schedule-${id} → AlertDialog button-confirm-delete-schedule / button-cancel-delete-schedule) | button ×2 | Confirms then hard-deletes the schedule | schedules.tsx:197-207, 226-247 | DELETE /api/scrape-schedules/:id → routes.ts:806 (404 when missing) | code | OK |
| Empty state "No schedules yet" | state | Shown when list is empty | schedules.tsx:212-224 | — | Playwright | OK |
| Portal select (select-schedule-database) | select | Only "live-searchable" portals: governmentLinksAvailable && canScrapeGovernmentPortal, deduped by platform+searchUrl, sorted by jurisdiction | schedules.tsx:58-75, 300-311 | GET /api/databases?searchable=true → permit_databases list (curl returned rows; 106 options in the placeholder) | Playwright: "Select one of 106 live-searchable portals" | OK |
| Search type select (select-schedule-search-type) | select | address/name/company/license/permit | schedules.tsx:320-331 | POST body searchType (zod enum, routes.ts:749) | Playwright | OK |
| Frequency select (select-schedule-frequency) | select | daily/weekly/monthly | schedules.tsx:335-344 | POST body frequency; cadence: SCHEDULE_INTERVAL_MS daily 86 400 000 / weekly 7d / monthly 30d (routes.ts:819) | Playwright | OK |
| Search value input (input-schedule-search-value) | input | What to search the portal for (1–200 chars) | schedules.tsx:348-356 | POST body searchValue | Playwright | OK |
| Create (button-create-schedule) | button | Disabled until portal+value chosen; POSTs create | schedules.tsx:358-370 | POST /api/scrape-schedules → routes.ts:772: zod scheduleInput; 404/400 when the portal isn't schedulable (rejectScheduleTarget); insert scrape_schedules with next_run_at=now → picked up by the 15-min runDueScrapeSchedules loop (routes.ts:820+, claim via next_run_at, results into the shared permit cache, last_run_at after run) | code (no schedule created — creation would arm real scrapes against live portals) | OK |

No run-now button exists on this page (and no run-now endpoint); cadence is the only control. Links: none beyond the dialog.

---

## Cross-cutting notes
- Emails on dev sink to `tmp/email-outbox.jsonl` (server/email.ts:203-229). Only review-request kind observed there during audit: the 1 AUDIT email. email_log has no review kinds (only 'welcome' ×50 + ops digest).
- First-send email (email.ts:401-438) links to `/api/review/<token>/click` (records link_clicked/email_opened then redirects); it carries List-Unsubscribe(+Post) headers but NO visible unsubscribe footer and NO pixel image. Reminder emails (email.ts:440-489) include the visible "Unsubscribe" footer. The `/api/review/:token/pixel.png` endpoint (routes.ts:5325) has no caller anywhere in the codebase — DEAD (see bugs file).
- `reviewSubmitted` / review_submitted: returned by APIs, referenced once client-side (google-reviews.tsx:794), never written true by any server path — DEAD data element (see bugs file).
- Trash purge: storage.purgeExpiredTrash hard-deletes rows with deleted_at < now − 14 days (storage.ts:772-776); client "Nd left" badge uses the same 14-day window.
- AUDIT residue: review_requests id 928 (AUDIT-Lane2-B3, audit-lane2@example.invalid) soft-deleted in trash; review_recipient_preferences row for audit-lane2@example.invalid (unsubscribed=true — the resubscribe path is customer-only and returns 403 for the owner on this lane, so it stays suppressed); 1 email in tmp/email-outbox.jsonl to the fake address. No seeded rows were mutated (verified: id 12 email_opened/link_clicked unchanged — pixel GET was a no-op because the flags were already set; no feedback submitted against any seeded row).

---

*Batch 4 — pages /photos, /media-library, /social-media, /ranking-grid, /competitors, /mail-alerts.*

Audit date 2026-10-04. Worktree `/home/veto/ConstructHUB-audit2` (branch audit/2), dev server `http://127.0.0.1:8302`, signed in as user 1 (`dev@constructhub.local`, `isPlatformAdmin: true`, `accessPlan: "agency"`). DB: `constructhub_dev_a6` (read-only SQL). Screenshots + Playwright script in the lane2 dir.

**Route check (client/src/App.tsx):** `/photos` :172, `/media-library` :173, `/ranking-grid` :175, `/competitors` :177 (gated `SHOW_COMPETITOR_INTEL`), `/mail-alerts` :183, `/social-media` :185, `/competitors-landing` :221 (legacy landing, noted). `SHOW_COMPETITOR_INTEL = true`, `SHOW_AD_ACTIVITY = false` (client/src/lib/features.ts:13,35 — ad tab hidden because the only "ad source" was fabricated Places data; server `/api/ad-spy` answers 410, server/routes.ts:2454).

**Cross-cutting data facts (SQL, 2026-10-04):** `media_folders` 0, `media_photos` 0, `social_connections` 0, `social_posts` 0, `social_sources` 0, `social_bulk_jobs` 0, `social_settings` 0, `ranking_grid_scans` 0, `ranking_grid_results` 0, `mail_alert_messages` 0, `mail_alert_grants` 0, `mail_alert_addresses` 1 (user 1). `competitor_scans`: exactly 2 rows, both user 1, both **failed** (ids 2 "Tree Service / Forks, WA" and 3 "Roofing Contractor / Tampa, FL", `total_found` 0, error "Competitor search failed (INVALID_REQUEST)…", created 2026-09-29 23:20 UTC). The 596 `competitor_listings` rows are **orphans**: their `scan_id`s (14,15,17,18,20,22,24,25,57,58,120,121,123,124) do not exist in `competitor_scans`, and their `user_id`s are 14 other users (2131,2132,2138,2139,2145,2149,2275,2276,5078,5079,16744,16745,16749,16750) — they are not reachable through the API for user 1 (see /competitors).

---

## /photos — client/src/pages/photos.tsx
One-line purpose: batch SEO photo tool — watermark, geotag, rename, describe and download job photos.

Note: this page never reads `media_photos`; uploads live in server in-memory maps + disk (`uploadedFiles`, `processedFiles` in server/routes.ts). There is **no filename-pattern input** (filenames are generated server-side, `generateFileName`, routes.ts:1406) and **no link to /media-library** on the page (library integration is the "Save to media library" modal only). "Empty state" for media_photos is therefore N/A.

### Access notice
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| notice-photos-access ("Sign in to process photos…" / "Processing photos is included with every plan…") | conditional notice + link | Shown only when signed out or when `/api/entitlements` returns no accessPlan; links to /auth or /pricing | photos.tsx:1242-1254 | GET /api/entitlements → server/entitlements.ts:getEntitlements (accessPlan) | Playwright (user 1 has agency plan → notice correctly hidden) | OK |

### Templates (client-only)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| button-save-template / template-save-form / input-template-name / button-confirm-save-template | button + inline form | Saves current business info + categories + keywords + watermark settings as a named template | photos.tsx:1256-1305 | client only: localStorage key `gmb-photo-templates` (photos.tsx:207-221) | code | OK |
| template chip + menu (button-load-template-*, menu-rename-template-*, menu-overwrite-template-*, menu-delete-template-*) | chips + dropdown | Load / rename / overwrite / delete saved templates; empty text "No templates yet…" | photos.tsx:1308-1361 | client only: localStorage | Playwright (empty text shown) | OK |
| dialog-delete-template (button-cancel-delete-template / button-confirm-delete-template) | confirm dialog | Deletes template from browser storage | photos.tsx:1363-1382 | client only | code | OK |

### Business info
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| button-toggle-business / button-clear-business | collapsible section + clear | Shows/hides the business form; Clear wipes it (also removes localStorage) | photos.tsx:1385-1442 | client only (persisted `gmb-business-info`) | Playwright | OK |
| "Load from saved location" select-saved-location | select | Fills the form from one of the owner's Locations | photos.tsx:1446-1493 | GET /api/locations → server/routes.ts:2672 → business_locations WHERE user_id=1 ORDER BY created_at DESC (2 rows for user 1: 104296, 506025) | curl (2 locations) + code | OK |
| link-add-locations | link | Shown when no saved locations; goes to /locations (route exists) | photos.tsx:1494-1502 | — | code | OK |
| input-business-search + button-business-search | search input + button | Searches Google's business index by name/address/Maps URL (≥2 chars) | photos.tsx:1504-1528 | POST /api/photos/business-search → server/routes.ts:985 → Google Places text/findplace/details + maps-URL resolver; no DB | code (calls live Google API — not pressed) | OK |
| business-results list + button-load-more-results | result list | Pick a result to auto-fill the form; pageToken pagination | photos.tsx:1532-1587 | POST /api/photos/business-details → routes.ts:1244 (placeId) → Places details | code | OK |
| Manual fields (input-company-name, input-phone, input-address, input-city, input-county-state, input-website, input-services, input-copyright) | text inputs | Enter business facts used for watermark text, EXIF, descriptions | photos.tsx:1593-1674 | client only (localStorage) | Playwright | OK |

### Service area cities
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| switch-service-area-enabled | switch | Enables the optional service-area discovery | photos.tsx:1679-1699 | client only | Playwright | OK |
| chip-area-type-* (locality/neighborhood/administrative_area_level_3/2), slider-service-radius (5–50 mi), chip-density-* (low/medium/high/max) | chips + slider | Choose area types, radius and sampling density for discovery | photos.tsx:1703-1793 | client only | code | OK |
| button-find-service-areas | button | Reverse-geocodes rings of sample points around the business address and lists nearby cities/counties with distance | photos.tsx:1795-1836 | POST /api/photos/nearby-cities → server/routes.ts:1631 → Google Geocoding (ring sampling, haversine distance, radius clamped 5–50 mi); no DB | code (live Google API — not pressed) | OK |
| input-manual-cities + button-add-manual-cities, input-area-filter, area checkbox list, button-select-all-areas / button-clear-areas | input + list | Type cities by hand (pairs "City, ST" auto-detected), filter and tick areas; selections rotate into filenames/EXIF per photo | photos.tsx:1849-1931 | client only (sent later in process payload `serviceAreas`) | code | OK |

### Category & keywords
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| select-category portal dropdown + input-category-search + category-option-* | dropdown (portal) | Pick Google categories (22 construction trades with auto-keyword maps + full GBP_CATEGORIES list); typing filters | photos.tsx:1936-2047 | client only: static maps `categoryKeywords` (photos.tsx:80-147), `@/data/gbp-categories` | Playwright (dropdown renders) | OK |
| keyword rows (checkbox-keyword-*), button-remove-keyword-*, button-select-all-keywords / button-clear-keywords, input-custom-keyword + button-add-custom-keyword | checkbox list + inputs | Generated keyword checklist per category (modifier × trade expansion), custom keywords (comma/paste bulk add) | photos.tsx:2049-2208 | client only | code | OK |

### Photos
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| dropzone-photos + button-browse-files + input-file-upload + button-camera-capture | dropzone + file inputs | Accepts JPG/PNG (others counted and skipped with a toast); camera button opens the phone camera | photos.tsx:2227-2281 | client only until Process (client-side compress if ≥4 MB, photos.tsx:508-548) | Playwright (dropzone renders) | OK |
| photo thumbnails (photo-thumbnail-*), button-remove-photo-*, button-expand-photo-*, button-clear-photos | thumbnail grid | Preview grid; click opens editor; remove/clear | photos.tsx:2283-2356 | client only (object URLs) | code | OK |
| modal-photo-editor: img-photo-preview-large, button-prev-photo / button-next-photo, slider-brightness / slider-contrast / slider-saturation, button-auto-enhance, button-reset-filter, button-apply-filters-all, button-switch-photo-* | editor modal | Per-photo brightness/contrast/saturation (0.5–2.0), auto-enhance via server image analysis, reset, copy filters to all | photos.tsx:2358-2529 | POST /api/photos/auto-enhance → server/routes.ts:952 → analyzePhoto (server/photos-* image lib) on the uploaded temp file; no DB | code (AI/analysis endpoint — not called) | OK |

### Watermark
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| switch-watermark | switch | Enables/disables watermarking | photos.tsx:2534-2543 | client only | Playwright | OK |
| button-watermark-text-mode / button-watermark-image-mode, input-watermark-text | segmented buttons + input | Text watermark (defaults to company name) or logo image | photos.tsx:2544-2577 | client only | code | OK |
| button-upload-watermark-image / button-remove-watermark-image | file input + remove | Uploads a PNG/JPEG logo; stores id for processing | photos.tsx:2578-2622 | POST /api/photos/upload-watermark → server/routes.ts:971 (multer, in-memory `watermarkImages` map) | code | OK |
| slider-watermark-opacity (10–100%) | slider | Watermark opacity | photos.tsx:2624-2637 | client only | code | OK |
| switch-mirror-photos | switch | Flips every photo horizontally (rights warning shown) | photos.tsx:2641-2653 | client only (applied server-side at process) | Playwright | OK |

### Process & download
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| switch-ai-descriptions | switch | Off = 5 built-in template descriptions (server picks randomly); on = OpenAI-generated unique descriptions | photos.tsx:2656-2679 | POST /api/photos/generate-description → server/routes.ts:1302 (useAI→server/ai photoDescription, 502/503 on failure; template path needs companyName+service) | code (AI endpoint — not called) | OK |
| button-process-photos | primary button | 1) uploads each photo POST /api/photos/upload (multipart "photos", ≤10, in-memory map, 429 if ≥200 pending); 2) generates descriptions; 3) geocodes address if needed POST /api/media/geocode; 4) starts job POST /api/photos/process (1–10 fileIds, max 4 concurrent jobs, monthly "photos" quota reserved, 402 handled via rememberPlanPrompt) then polls GET /api/photos/process/:jobId every 2s; server watermarks/renames/writes EXIF to disk `processedDir` (no DB) | photos.tsx:1079-1200, 999-1075 | server/routes.ts:924, 1334, 1511 | code (write path — not executed) | OK |
| button-download-all | button | ZIP download of processed set | photos.tsx:2696-2712 | POST /api/photos/download-all/prepare → routes.ts:1541 (token, 10-min TTL) then GET /api/photos/download-all/:token → routes.ts:1551 (archiver zip) | code | OK |
| processed file rows (processed-file-*) + button-download-* | list + buttons | Per-file download of optimized photos | photos.tsx:2789-2814 | GET /api/photos/download/:fileId → routes.ts:1524 | code | OK |
| button-save-to-library + modal-save-to-library (folder-option-*, input-new-folder-name, button-confirm-save-library) | button + modal | Copies processed photos into a Media Library folder (creates folder if needed) | photos.tsx:2714-2787, 324-373 | GET /api/media/folders; POST /api/media/folders → routes.ts:1592 (insert media_folders user_id=1); POST /api/media/save-processed → routes.ts:1822 (uploadToR2 + insert media_photos user_id, folder_id, name, url, r2_key, size) | curl (folders []), code for write path | OK |
| EXIF disclaimer footnote | text | Honest note that Google strips EXIF on GBP upload | photos.tsx:2822-2824 | — | Playwright | OK |

### Recent batches (client-only) & platform links
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| card-recent-batches (row-batch-*, button-restore-batch-*, button-download-batch-*, button-remove-batch-*, button-clear-recent-batches) | local list | Last 3 batches kept in localStorage (`constructhub_recent_photo_batches`) so ZIP links survive reloads; hidden when empty | photos.tsx:2827-2902 | client only (processedIds re-downloaded via download-all/prepare) | code | OK |
| button-upload-google / button-upload-yelp | external links | Open business.google.com/locations and biz.yelp.com in new tabs | photos.tsx:2904-2929 | — | code | OK |

---

## /media-library — client/src/pages/media-library.tsx
One-line purpose: project photo folders with optional client GPS address; upload, preview, rename, download, delete photos.

Verified empty: `GET /api/media/folders` → `[]` (curl); Playwright shows "No folders yet" empty state with "Create your first folder" action. `media_folders`/`media_photos` 0 rows.

### Folder list (root view)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| heading-media-library + button-new-folder | header + button | Page title; opens New folder modal | media-library.tsx:377-391 | — | Playwright | OK |
| input-search-media | search input | Client-side filter of folder names | media-library.tsx:393-403 | client only | code | OK |
| text-empty-state ("No folders yet…") | empty state | Honest empty state with create action (button-empty-new-folder) | media-library.tsx:618-631 | — | Playwright + curl [] | OK |
| folder-grid / folder-card-* / folder-name-* (name + created date + clientAddress + GPS badge + "Click to view photos") | card grid | Folders newest-first; click opens folder | media-library.tsx:635-699 | GET /api/media/folders → server/routes.ts:1581 → SELECT * FROM media_folders WHERE user_id=1 ORDER BY created_at DESC | curl [] | OK |
| folder-menu-* (Edit folder / menu-delete-folder-*) | dropdown | Edit or delete a folder; delete dialog names the photo count (fetched per-folder) | media-library.tsx:652-673, 885-913 | GET /api/media/folders/:id/photos (count); DELETE /api/media/folders/:id → routes.ts:1772 (deletes R2 objects, media_photos rows, then folder row, all scoped user_id=1) | code (delete not pressed) | OK |

### New / edit folder modals
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| modal-new-folder (input-folder-name, input-folder-address, button-verify-address, button-confirm-create-folder) | modal | Creates a folder; optional client address can be verified to lat/lon (shown to 6 dp) and stored for GPS embedding | media-library.tsx:439-521 | POST /api/media/geocode → routes.ts:1752 (Google Geocoding, 404 if not found); POST /api/media/folders → routes.ts:1592 (insert media_folders: user_id, name, client_address, lat, lon) | code (write not pressed) | OK |
| modal-edit-folder (input-edit-folder-name, input-edit-folder-address, button-verify-edit-address, button-save-edit-folder) | modal | Renames / re-geocodes folder | media-library.tsx:523-591 | PATCH /api/media/folders/:id → routes.ts:1611 (update name/client_address/lat/lon WHERE id AND user_id=1) | code | OK |

### Folder view (photos)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| button-back-folders | link button | Returns to folder list | media-library.tsx:324-331 | — | code | OK |
| Folder header (heading-media-library, "GPS embedded"/"Address set" badge, address + coords, button-edit-folder, button-upload-photos + input-upload-photos) | header | Shows folder name/address; uploads up to 10 photos (any image/*) | media-library.tsx:332-375 | POST /api/media/upload (multipart folderId + photos[]) → routes.ts:1868 → uploadToR2 + insert media_photos (name=originalname, url, r2_key, size) | code (write not pressed) | OK |
| button-view-grid / button-view-list, button-select-all, button-delete-selected + dialog-delete-selected | view toggle + bulk select | Grid/list modes; multi-select; bulk delete with confirm ("Delete photos" → per-photo DELETE loop, partial-failure toast) | media-library.tsx:404-437, 915-934 | DELETE /api/media/photos/:id → routes.ts:1804 (R2 delete + row delete, user_id-scoped), called once per id | code | OK |
| text-empty-photos ("This folder is empty…" + button-empty-upload) | empty state | Honest per-folder empty state | media-library.tsx:708-721 | — | code | OK |
| photo-grid / photo-card-* (img, checkbox-photo-*, photo-menu-*) or photo-list / photo-list-item-* | grid/list of photos | Preview modal on click; per-photo menu: Preview / Rename / Download (direct a[href=photo.url]) / Delete | media-library.tsx:724-873 | GET /api/media/folders/:id/photos → routes.ts:1792 → media_photos WHERE folder_id AND user_id=1 ORDER BY created_at DESC; PATCH /api/media/photos/:id/rename → routes.ts:1905; DELETE /api/media/photos/:id → routes.ts:1804 | code | OK |
| modal-photo-preview | modal | Full-size preview with name/size overlay | media-library.tsx:593-609 | — | code | OK |
| Footer count line ("N photos · X MB total") | text | Count and summed size of filtered photos | media-library.tsx:876-881 | client only (sums photo.size) | code | OK |

---

## /social-media — client/src/pages/social-media.tsx
One-line purpose: compose once, publish/schedule to many social accounts through a Blotato API key; calendar/queue, AI auto-mode, content sources.

Facts: this page uses a **Blotato API key**, not per-platform OAuth; there are no per-platform connect cards. All social tables are empty. Verified via curl for business 104296: `connected:false, accounts:[], posts:[], total:0, defaults:[]`; `/api/social/media` → `[]`; `/api/social/sources` → `[]`. Without `?business=` the page shows the business picker and "Choose a business above. Add or import businesses in Locations" (/locations route exists).

### Header / business selection
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| PageHeader "Social Media" + "How it works" | header + button | Sets `?tab=guides` → renders GuidesContent | social-media.tsx:63-67 | — | Playwright | OK |
| BusinessSelector (component client/src/components/social-agency.tsx:32) | picker | Search/pick one of the owner's businesses or "All businesses" (all-clients calendar); sets `?business=` | social-media.tsx:68 | GET /api/social/businesses → server/social/routes.ts:93 → listBusinesses (business_locations owned by user) | Playwright (2 businesses listed: 104296 "K- Social workbench fixture", 506025 "AI-TEST Ridgeline Roofing") | OK |
| "Choose a business above…" hint | text | Shown when no business selected | social-media.tsx:72 | — | Playwright | OK |

### Blotato connection
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Blotato connection" section + StatusPill (Connected / Not connected) | section + pill | Shows effective connection state | social-media.tsx:256-325 | GET /api/social → server/social/routes.ts:148 dashboard → social_connections (user_id,business_id scoped) | curl connected:false; Playwright pill "Not connected" | OK |
| "Key to manage" scope select + "Effective connection" text | select + text | Choose business-only vs agency shared key; shows which is in effect (`connectionScope`) | social-media.tsx:266-275 | same dashboard payload (`agencyConnected`, `businessConnected`, `connectionScope`) | curl | OK |
| Blotato API key input + "Connect Blotato" / "Verify / replace key" button | input + button | Sends key to server; server verifies against Blotato and stores it encrypted (never displayed again) | social-media.tsx:276-303 | POST /api/social/connect → server/social/routes.ts:150 → service.ts:connect → INSERT social_connections(user_id,key_enc,accounts,business_id) ON CONFLICT UPDATE | code (would write + call Blotato — not pressed) | OK |
| Disconnect button | button | Removes the stored key; cancels queued posts/drafts and bulk jobs locally | social-media.tsx:304-313 | POST /api/social/disconnect → routes.ts:158 → DELETE social_connections; UPDATE social_settings enabled=false; UPDATE social_posts queued/draft→cancelled; UPDATE social_bulk_jobs→cancelled | code | OK |
| Connected accounts line ("name (platform) · …") | text | Lists Blotato accounts for the key | social-media.tsx:317-323 | dashboard `accounts` | curl [] | OK |

### Mapping editor
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| MappingEditor (social-media.tsx:328; client/src/components/social-agency.tsx:126-158) | panel | Map Blotato accounts/pages to the business; refresh pages/boards | social-agency.tsx:126-158 | GET /api/social/accounts; PUT /api/social/mapping; POST /api/social/accounts/:id/pages → server/social/routes.ts:106,102,161 | code | OK |

### Compose tab
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Post to" account checkboxes + per-platform options (refresh pages/boards, page/board select, YouTube title + privacy, TikTok public/branded/own-brand flags) | checkbox cards | Choose destinations; per-platform tweak fields | social-media.tsx:352-488 | POST /api/social/accounts/:id/pages (discoverPages) | code | OK |
| Post text textarea + per-platform tweak textareas with char counts (`socialLimits`) | textareas | Message + per-platform overrides with limits from @shared/social | social-media.tsx:489-513 | client validation | code | OK |
| "Public media URLs" textarea + validation + "Search synced business photos" + media library select + "Upload through Blotato" file input | media inputs | Attach up to 10 public HTTPS media URLs; search synced Media Library photos; or upload ≤100 MB via presigned URL | social-media.tsx:514-561 | GET /api/social/media → server/social/routes.ts:205 (media_photos of the business owner); POST /api/social/uploads → routes.ts:214 (presigned PUT, publicUrl) | curl [] for media; code for upload | OK |
| Schedule time (datetime-local) | input | Blank = post now; otherwise scheduledTime ISO | social-media.tsx:567-575 | client | code | OK |
| "Post now"/"Schedule post" + "Save draft" buttons + postBlocker hint text | buttons | Disabled with a plain reason until connected + destination + text (+media valid); submit → create posts | social-media.tsx:576-595 | POST /api/social/posts → server/social/routes.ts:164 → createPosts → INSERT social_posts (payload, state draft/queued, due_at) | code (write not pressed); Playwright buttons render disabled with hint "Connect Blotato above to post." | OK |

### Calendar & queue tab
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Toolbar: search, Calendar day date input, Status select (draft/queued/submitting/submitted/published/failed/uncertain/cancelled), Platform select | filters | Filters the post list (server-side via query params) | social-media.tsx:606-627 | GET /api/social?offset&search&state&platform&timezone&businessId&day → dashboard (social_posts WHERE user_id,business_id, filters; LIMIT 25) | curl total:0 | OK |
| "No posts yet. Compose your first update or generate an AI draft." + "0 matching posts" | empty state + count | Honest empty state | social-media.tsx:628-633 | — | curl; code | OK |
| Select this page / Approve selected drafts / Cancel selected posts + "N selected (up to 100)" + bulk error list | bulk actions | Bulk approve/cancel over selected draft/queued posts | social-media.tsx:634-639 | POST /api/social/posts/bulk-action → routes.ts:168 | code | OK |
| Pager + PostRow list (state Badge, business name or "Legacy / unassigned", platform, local time, AI-generated badge, editable draft text, Approve & queue / Cancel, View published post, Open Blotato status, submission id) | post list | Each post row with status pill and per-post actions | social-media.tsx:640-657, 1021-1123 | POST /api/social/posts/:id/action → routes.ts:179 (approve/cancel; UPDATE social_posts state) | code | OK |
| "Status refreshes every 15 seconds" note | text | Query refetchInterval 15000 | social-media.tsx:603 | — | code | OK |

### Auto mode tab
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Enable auto mode + Publishing mode (approval queue / fully automatic) | checkbox + select | Enable AI drafting; automatic publishes without review | social-media.tsx:669-692 | PUT /api/social/settings → server/social/routes.ts:197 → saveSettings → INSERT/UPDATE social_settings (settings jsonb) | curl default settings echoed; code for save | OK |
| Saved destinations + "Use accounts selected in Compose" | text + button | Copies compose destinations into settings | social-media.tsx:693-710 | client + same PUT | code | OK |
| Cadence (1–7) + period (week/day), content mix checkboxes (project/tips/reviews/offers/gbp), instructions, examples, timezone, blackout start/end (0–23), daily AI budget (0–20) | form | Auto-generation schedule and content controls; client-side zod mirror gives field-specific errors | social-media.tsx:711-839 | PUT /api/social/settings (autoSchema) | code | OK |
| data.lastError / next generation line | status text | Shows scheduler error / next run when connected+enabled | social-media.tsx:840-853 | dashboard fields | curl (absent, not enabled) | OK |
| "Save auto settings" + "Generate draft from saved settings" | buttons | Saves settings; enqueues a generation job | social-media.tsx:854-887 | PUT /api/social/settings; POST /api/social/generate → routes.ts:201 → enqueueBulk (INSERT social_bulk_jobs kind='generate') | code (AI endpoint — not called) | OK |
| "Sync recent GBP updates" button + sync status line | button + text | Queues a GBP-source refresh | social-media.tsx:895-901, 984 | POST /api/social/sources/sync-gbp → routes.ts:231 | code | OK |
| Content sources: kind select (offer / published GBP update), source text, attached-media list, "Add content source", sources list with Remove, "Sources expire … 30 days" note | source editor | Adds factual source text (+media URLs) the AI can turn into posts | social-media.tsx:902-1010 | POST /api/social/sources → routes.ts:240 (INSERT social_sources, 30-day window); GET /api/social/sources → routes.ts:235 (WHERE created_at > now()-30d); DELETE /api/social/sources/:id → routes.ts:257 | curl [] | OK |

---

## /ranking-grid — client/src/pages/ranking-grid.tsx
One-line purpose: run a geo-grid scan of Google Maps rankings for a keyword and view rank maps/reports.

Verified empty: `GET /api/ranking-grid/scans` → `[]` (curl); Playwright shows "No scans yet. Start your first ranking scan above." `ranking_grid_scans`/`ranking_grid_results` 0 rows. **GBP connection: the page does not use or hint about GBP at all** — business pick is a Google Places text search; there is no disable/hint tied to GBP.

### Scan form
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| input-business-search + button-search-business | search input + button | Search Google Places for the business (≥2 chars) | ranking-grid.tsx:707-735 | POST /api/photos/business-search → server/routes.ts:985 | code (live API — not pressed) | OK |
| Search results dropdown (button-select-business-*) | result list | Pick a place → fetch details + geocode | ranking-grid.tsx:737-751 | POST /api/photos/business-details → routes.ts:1244; POST /api/ranking-grid/geocode → routes.ts:2100 (placeId → lat/lon) | code | OK |
| Selected business chip + button-clear-business | chip + clear | Confirms selection; × clears | ranking-grid.tsx:754-774 | client only | code | OK |
| input-keyword | text input | Scan keyword, e.g. "Roofing Contractor" | ranking-grid.tsx:777-785 | sent to POST scans | Playwright | OK |
| Advanced · Grid size (select-grid-size: 3/5/7/9/11/13/15 ×, credit cost labels) + Point spacing (select-grid-distance: 0.5–20 mi) | selects | Grid dimensions; server accepts sizes {3,5,7,9,11,13,15}, spacing 0–20 mi | ranking-grid.tsx:787-818 | POST /api/ranking-grid/scans validation → server/routes.ts:2199 | code | OK |
| Summary box ("This scan will check N grid points… Total coverage…") + text-grid-credits ("Uses X credits…(0 used · unlimited this month)") | computed text | Client-computed coverage; credits from `gridCreditCost` + `/api/entitlements` usage line | ranking-grid.tsx:819-829 | GET /api/entitlements → server/entitlements.ts (usage.rankings) | Playwright ("0 used · unlimited this month" for admin) | OK |
| button-start-scan | primary button | Disabled until business+keyword; creates scan, expands it | ranking-grid.tsx:693-705 | POST /api/ranking-grid/scans → server/routes.ts:2190 (validate; trial limit 1 scan; reserveMonthlyQuota "rankings" credits; INSERT ranking_grid_scans status='running'; background runRankingGridScan → Places textsearch per grid point, INSERT ranking_grid_results per point (rank,total_results,top_competitors jsonb); UPDATE scan status + average_rank = mean of ranked points toFixed(1); refund on failure) | code (write + live API — not pressed) | OK |

### Scan history / cards / report
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| text-scan-history + ScanCard list (card-scan-*) | card list | All scans, 5 s polling while any is running | ranking-grid.tsx:834-858 | GET /api/ranking-grid/scans → server/routes.ts:2168 → storage.getRankingGridScans(ownerScope) (ranking_grid_scans by owner, newest first) | curl [] | OK |
| Scan card header: business name, keyword badge, grid/spacing, "Avg rank" (when set), "% Ranked" badge (completed), status badge (running/completed/failed), Report button, delete button | card header | Row facts straight from the scan row + expanded results | ranking-grid.tsx:906-980 | latestScan from GET /api/ranking-grid/scans/:id → routes.ts:2178 (scan + ranking_grid_results by scan_id) | code | OK |
| Expanded running progress (indeterminate spinner, "N / total" progress bar) | progress | Honest progress (results count / grid²) | ranking-grid.tsx:982-1009 | ranking_grid_results rows appear as scan runs | code | OK |
| Expanded completed: StatGrid (Grid points = gridSize², Average rank, Ranked n/total, Top 3) + RankDistributionChart (client-computed buckets 1-3/4-10/11-20/20+ with rounded %) | stats + chart | Client-side aggregates over returned results | ranking-grid.tsx:1011-1022, 315-379 | same GET results | code | OK |
| MapGridView (img-ranking-map, grid-cell-r*-* dots, zoom in/out/reset buttons, legend, "Zoom: n") | map overlay | Static map image with rank dots per grid cell; colors rank≤3 green, ≤10 yellow, ≤20 red, else gray; center square = business | ranking-grid.tsx:89-280 | GET /api/ranking-grid/map/:scanId?w&h&zoom → server/routes.ts:2122 (proxies Google Static Maps for scan center; ranking_grid_scans.lat/lon) | code | OK |
| button-full-report-* → ScanReport (text-report-title, summary rows, rank distribution, table-competitors top-10 with Found at / AR (avg rank toFixed(2)) / Best, print button) | report view | Full-page report; competitor table computed client-side from `topCompetitors` of all results (frequency, avg, best); Print → window.print | ranking-grid.tsx:381-560, 1044-1068 | client-side computeCompetitors over GET results | code | OK |
| button-delete-scan-* + dialog-delete-scan (button-confirm-delete-scan) | delete | Deletes scan + results after confirm | ranking-grid.tsx:861-882 | DELETE /api/ranking-grid/scans/:id → server/routes.ts:2251 (owner-scoped; storage.deleteRankingGridScan removes scan + results) | code (delete not pressed) | OK |

---

## /competitors — client/src/pages/competitors.tsx
One-line purpose: market scans that index competitors from Google Places and heuristic "signals worth a closer look" review analysis.

**What owner actually sees (verified):** the page is entirely behind the server's Competitor Intel plan gate, and for user 1 (platform admin) that gate answers **402 plan_required**, so the rendered page is the plan-locked state — title "Competitor intelligence", message "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it.", line "Competitor Intel is included with the Pro, Growth and Agency plans.", button "See the Pro plan" → /pricing. Screenshot `shot-competitors.png`. Root cause and bug entry in bugs-batch4.md. None of the scan UI below renders for user 1. SQL ground truth for the data that *would* render: 2 scans, both failed, `total_found` 0 → cards would show "{industry} — {location}", "10 mile radius • 9/29/2026 • 0 competitors found", Failed badge, error text "Competitor search failed (INVALID_REQUEST). Check provider access and quota." and a "Run this scan again" retry button; expanded state would be "No competitors found in this scan." The 596 `competitor_listings` rows are orphaned (parent scans deleted; owners are 14 other users) and are **not** returned by the API (both scan list and scan detail filter by `user_id`), so no on-screen number can be compared against them.

### Plan gate
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| loader-competitors | spinner | While the scans query loads | competitors.tsx:153-159 | GET /api/competitors/scans | Playwright (not seen — fast 402) | OK |
| text-locked-title / text-plan-required + plans line + button-upgrade-plan | gated screen | Shown when the scans query errors with 402 {code:"plan_required"} | competitors.tsx:161-184 | GET /api/competitors/scans → server/routes.ts:2386 requireCompetitorIntel → server/entitlements.ts:requirePlan test `(a) => a.competitorScans > 0` → 402 {code:"plan_required", requiredPlan:"pro", message} | curl (402 body), Playwright | BUG (see bugs file) |

### Market scan tab (code-mapped; not rendered for user 1)
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| tab-market-scan / tab-ad-spy (ad-spy hidden: SHOW_AD_ACTIVITY=false) | tabs | Market scan vs ad activity (ad tab dead by design; /api/ad-spy → 410) | competitors.tsx:189-201 | app.use("/api/ad-spy") → server/routes.ts:2454 (410) | code | OK |
| card-new-scan: select-industry (22 trades), input-location, select-radius (10/25/50/100), button-start-scan | form | Validate industry+location, then start a scan | competitors.tsx:204-257 | POST /api/competitors/scans → server/routes.ts:2407 (zod industry≤120/location≤250/radius 1–100; reserveMonthlyQuota "competitorScans"; INSERT competitor_scans status='running'; background runCompetitorScan → server/routes.ts:2599: competitorPlaces (Places textsearch pages) → per place Places details (reviews,phone,website) → analyzeReviews + analyzeBsScore (server/competitor-analysis.ts) → INSERT competitor_listings (place_id,business_name,address,phone,website,rating text,review_count,category,is_new=false,bs_score,bs_reasons,review_analysis,rank_history); UPDATE scan completed + total_found; on failure DELETE listings + status failed + error_message; refund scan) | code (write + live API — not pressed) | OK |
| Empty state "No market scans yet. Start your first scan above to index competitors." | empty state | Honest empty state | competitors.tsx:265-270 | — | code | OK |
| ScanCard (card-scan-*): title "{industry} — {location}", description "{radius} mile radius • {toLocaleDateString(createdAt)} • {totalFound \|\| 0} competitors found", status badges (Scanning…/Completed/Failed), delete button + dialog (button-confirm-delete-scan-*), failed row: text-scan-error-* + button-retry-scan-* ("Run this scan again" re-POSTs same params), completed note text-scan-note-* | scan cards | One card per scan from GET /api/competitors/scans (polls 1.5 s while running); date is browser-local from `created_at` (UTC) | competitors.tsx:750-853 | GET /api/competitors/scans → routes.ts:2386 (SELECT * FROM competitor_scans WHERE user_id=1 ORDER BY created_at DESC); DELETE → routes.ts:2438 (DELETE competitor_listings by scanId, then scan row, user-scoped) | SQL: 2 rows match this shape; code for buttons | OK |
| Expanded stats (Total Competitors = listings.length; Few signals bsScore<30; Some signals 30–59; More signals ≥60) | stat cards | Client-side counts over the expanded listings | competitors.tsx:873-892 | GET /api/competitors/scans/:id → routes.ts:2395 (scan + competitor_listings WHERE scan_id ORDER BY rating DESC, each passed through presentListing) | SQL (would be 0 listings for scans 2/3) | OK |
| Competitor cards (card-competitor-*): businessName, NEW badge (isNew), BS badge (Few/Some/More signals by score), "{n} AI" badge (reviewsLookingAi), address, rating + reviewCount, phone, website link, bsReasons list (3 collapsed, up to 20 expanded), button-review-analysis-* → ReviewAnalysisPanel (good/bad/common-phrases/generic %, reviewer photos %, name-pattern %, missing links, oldest sampled, velocity note, sample review quotes), BsMeter (score/100 bar) | listing cards + analysis | Per-competitor heuristic signals; **bsScore/bsReasons are recomputed at read time** by presentListing from name/rating/reviewCount/address + stored reviewAnalysis (velocity forced off) — displayed score can differ from stored `bs_score` | competitors.tsx:894-980, 627-748 | presentListing → server/competitor-analysis.ts:253, analyzeBsScore → :75-250 | code + SQL (columns verified) | OK |
| "No competitors found in this scan." | empty state | When a completed scan has no listings | competitors.tsx:982-984 | — | code | OK |

---

## /mail-alerts — client/src/pages/mail-alerts.tsx
One-line purpose: private email-in address that turns forwarded provider mail (Google, Cloudflare, registrars, Blotato) into classified, expiring alerts mapped to client locations.

Verified: `GET /api/mail-alerts/settings?page=1` returns `address: "alerts+1382ddff5f475faf087655fe28a7c76af432a7d4dd538e08@alerts.constructhub.test"`, `oauthEnabled: false`, `grants: []`, sender lists. `mail_alert_addresses` has 1 row (user 1, `token_cipher` length 109, created 2026-09-30 08:59:33 -04). `mail_alert_messages` 0 rows → list endpoint `{items:[],total:0}`. **Factually absent vs the brief: there is no copy button, no regenerate and no delete control for the address** — the address is a read-only input, and the server auto-creates it once (`ON CONFLICT DO NOTHING`, server/mail-alerts/service.ts:13-16) with no regenerate/delete endpoint anywhere in server/mail-alerts.

### Setup sections
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| link-mail-alerts-domains ("Manage domains") | link | Goes to /domains (route exists) | mail-alerts.tsx:74-79 | — | code | OK |
| "Set up Gmail forwarding" section: readOnly forwarding-address input | read-only input | Shows the owner's private address `alerts+<48-hex token>@<INBOUND_MAIL_DOMAIN>`; falls back to text "Inbound mail domain is not configured" when env missing | mail-alerts.tsx:100-114 | GET /api/mail-alerts/settings → server/mail-alerts/routes.ts:46 → forwardingAddress(id) (service.ts:9-24: INSERT mail_alert_addresses(user_id,token_hash,token_cipher) ON CONFLICT DO NOTHING; returns `alerts+${decryptToken(token_cipher)}@${domain}`) | curl + Playwright (address matches API; token segment 48 hex chars, domain alerts.constructhub.test) | OK |
| "How to set up" details (4-step Gmail forwarding/filter instructions) | disclosure | Setup guide mentioning the confirmation code/link below | mail-alerts.tsx:115-137 | — | Playwright | OK |
| "Known senders" details (provider sender addresses + registrar domains + "Only recognized alert subjects are retained") | disclosure | Lists recognized senders from settings.senders / registrarSenders | mail-alerts.tsx:138-150 | same settings payload (SENDERS, REGISTRAR_SENDERS from server/mail-alerts/classify.ts) | curl | OK |
| Security note ("Treat forwarded email as a reported alert, not proof…") | text | Honest trust warning | mail-alerts.tsx:151-155 | — | Playwright | OK |

### Gmail API section
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Optional Gmail API connection" section | section | If `oauthEnabled` false → shows disabled notice (env GMAIL_OAUTH_ENABLED !== "true"); forwarding works without it | mail-alerts.tsx:158-241 | settings.oauthEnabled (env) | curl oauthEnabled:false; Playwright shows disabled notice | OK |
| "Connect Gmail with read-only access" button | button | Requires recent auth (requestRecentAuth) then navigates to /api/mail-alerts/oauth/connect (Google OAuth — NOT started per rules) | mail-alerts.tsx:165-178 | GET /api/mail-alerts/oauth/connect → server/mail-alerts/gmail.ts:61 (Google OAuth redirect) | code | OK |
| "Sync all connected Gmail accounts" button (action("/sync")) | button | Sets next_sync=now() on grants (queued sync) | mail-alerts.tsx:179-185 | POST /api/mail-alerts/sync → routes.ts:132 (404 when OAuth disabled) | code | OK |
| Grants list (email · Connected/Reconnect required · last_error, per-grant Disconnect) + account pager | list | One row per saved Gmail connection (mail_alert_grants — 0 rows) | mail-alerts.tsx:187-232 | settings.grants (SELECT google_subject,email,needs_reconnect,last_error FROM mail_alert_grants WHERE user_id=1 ORDER BY email LIMIT 25); POST /api/mail-alerts/oauth/disconnect | curl grants:[] | OK |

### Provider inbox
| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| section-mail-inbox + Toolbar (search q; category select gbp/gsc/ads/cloudflare/registrar/blotato/forwarding; severity select critical/warning/info) | filters | Server-side filtered list; 5 s polling unless plan-gated | mail-alerts.tsx:242-297 | GET /api/mail-alerts?q&page&category&severity → server/mail-alerts/routes.ts:60 → mail_alert_messages WHERE user_id=1 AND expires_at>now() AND (subject ILIKE %q% OR sender ILIKE) AND category/severity/location_id filters ORDER BY received_at DESC, id DESC LIMIT 25 OFFSET (page-1)*25 + count(*) total | curl {items:[],total:0}; SQL count 0 | OK |
| Select page checkbox + "{n} selected" + "Mark selected as read" (action("/read")) | bulk action | Marks up to 100 alerts read | mail-alerts.tsx:298-332 | POST /api/mail-alerts/read → routes.ts:99 (UPDATE mail_alert_messages SET read_at=now() WHERE user_id AND id=ANY) | code | OK |
| Client search (GET /api/domains/locations?q&page) + "Unmapped" client select + client pager + "Map selected alerts" (action("/mapping")) | mapping controls | Maps selected alerts to a business location (or null = unmapped) | mail-alerts.tsx:333-388 | GET /api/domains/locations; POST /api/mail-alerts/mapping → routes.ts:110 (validates location belongs to user; UPDATE location_id) | code | OK |
| Alert cards (card-alert-*): subject; "{category} · {severity} · {sender} · {toLocaleString(received_at)} · Read/Unread · Client location {id} or Unmapped/ambiguous client"; Critical/Warning StatusPill; "Forwarding confirmation code: {code}"; "Confirm forwarding at Google" link; "Read matched message" details with body | message list | One card per retained alert; empty → "No matching provider alerts." | mail-alerts.tsx:391-467 | same GET (columns id,category,severity,sender,subject,body,confirmation_code,confirmation_link,domain_id,location_id,read_at,received_at); retention: expires_at = received_at + 30 days (service.ts MAIL_RETENTION_DAYS=30) | Playwright (empty state) | OK |
| Pager: "Previous alerts" / "Page {page} · {total} alerts" / "Next alerts" (disabled page*25>=total) | pagination | 25 per page | mail-alerts.tsx:468-494 | LIMIT 25 + total count | Playwright ("Page 1 · 0 alerts") | OK |
| Plan gate (PlanRequired module "domainsMailAlerts") | gated screen | 402 from settings or messages query → PlanRequired component instead of content | mail-alerts.tsx:82-95 | requireMailModule → server/mail-alerts/gmail.ts (module gate; user 1 agency plan passes) | curl 200 | OK |

---

## In-page links sanity check
- /photos → /auth?next=/photos, /pricing, /locations (all exist); business.google.com & biz.yelp.com external.
- /media-library → none internal beyond page itself.
- /social-media → /locations (exists), blotato.com external, my.blotato.com external, published post URLs external.
- /ranking-grid → none internal.
- /competitors → /pricing (exists).
- /mail-alerts → /domains (exists), Google forwarding confirmation link external.
