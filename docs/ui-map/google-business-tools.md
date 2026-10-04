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
