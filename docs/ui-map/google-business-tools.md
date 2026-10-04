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
