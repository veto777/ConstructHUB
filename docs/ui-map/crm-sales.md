# UI map — audit lane 4 (CRM sales: clients, estimates, invoices, payments, pipeline, projects, public pages)

Dev org for verification: "SKU Dry-Run" (id c5b47b8d-caa8-47e6-ae7e-6248ad5df565), timezone America/Los_Angeles,
dev user 1 (owner, all permissions). DB: constructhub_dev_a6 (shared — other lanes write to it, so list counts are
compared API-vs-SQL in the same second; per-document money is compared to the cent).

Legend for Status: OK / BUG / UNCLEAR / DEAD.
"Verified how" abbreviations: SQL = read-only psql on constructhub_dev_a6; API = curl against lane-4 dev server
(port 8304, dev bypass as user 1); CODE = read the server handler; E2E = exercised in a real browser via Playwright.

## 1. /crm/clients — client/src/pages/crm-clients.tsx

The client book: searchable, paged list of every client, with bid-outcome tabs (Job Won / Undecided / Declined).

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Page header "Clients" + subtitle | text | Titles the page; infoKey="clients" opens the info popover | crm-clients.tsx:180-186 | — (client only) | CODE | OK |
| "Export CSV" button (link-export-clients) | link (download) | Downloads every active client as a CSV (max 10,000), sorted by name; logs data.exported to the activity log | crm-clients.tsx:189-195 | GET /api/crm/customers/export.csv → server/crm/entities.ts:596 → SELECT crm_customers (org, archived_at IS NULL) ORDER BY display_name LIMIT 10000; gated by exportData permission | SQL (activity log shows data.exported rows=7506); pressed via curl — CSV row 1 was the just-created AUDIT client, headers as documented | OK |
| "Import" button (link-import-clients) | link | Goes to the import page | crm-clients.tsx:196-202 | — client route /crm/migrate exists (App.tsx:415) | curl 200 | OK |
| "New client" button (button-new-client) | button (dialog) | Opens the new-client dialog | crm-clients.tsx:203-208 | — (client only) | CODE | OK |
| Dialog fields: Client name*, Company, Email, Phone, Service address, City, State, ZIP, Notes | inputs | Form for a new client; email validated client-side; notes become intake notes on the client page | crm-clients.tsx:210-262 | POST /api/crm/customers → server/crm/entities.ts:547 → INSERT crm_customers (org_id, owner_member_id, portal_token generated); 409 on email/phone duplicate unless ?force=1 | Pressed: POST created "AUDIT-L4 Test Client" (id 5eecfa94…); duplicate POST with an existing phone returned 409 with the matching client, hint, and matches[] | OK |
| Duplicate warning (notice-duplicate-client) + per-client links (link-duplicate-<id>) | banner + links | On a 409, lists the existing client(s) and links to each | crm-clients.tsx:264-285 | — (client parses 409 body) | Triggered naturally with phone 555-0199 → 409 named QA-g11 client | OK |
| "Create anyway" (button-create-anyway) | button | Re-POSTs with ?force=1 to create the duplicate deliberately | crm-clients.tsx:287-291 | POST /api/crm/customers?force=1 (skips the dupe check) | CODE (same route as above) | OK |
| "Create client" (button-save-client) | button | Validates + POSTs the form; on success closes dialog, invalidates list, toasts "Client created … portal was created automatically" | crm-clients.tsx:292-295 | same POST; the portal = the portal_token minted in the INSERT (portalPath returned when the seat may share it) | Pressed (created AUDIT-L4 client, portalPath /portal/<token> returned) | OK |
| Search box (input-search-clients) | input | Debounced 250 ms search over name, email, phone (digits), address, city, ZIP, company; mirrors ?q= into the URL | crm-clients.tsx:305-310 | GET /api/crm/customers?paged=1&q=… → entities.ts:458 — ilike across 7 columns + digit-normalized phone match | SQL: `q=kane` → API total 0 and SQL count 0 (same second) | OK |
| Bid tabs (tabs-bid-status: All / Job Won / Undecided / Declined, tab-bid-<key>) | tabs | Filters the list server-side; the count after each label is the WHOLE-book count under the current search | crm-clients.tsx:311-327 | same GET with ?bidStatus= → entities.ts:487-537: outcome per customer from crm_estimates (any approved → won; else any sent/viewed → undecided; else any declined → declined; else none) | SQL CTE with identical CASE at the same second: won 953 / undecided 1844 / declined 4 / none 4704, total 7505 = API exactly | OK |
| Client table rows (client-<id>) | table + row click | Clicking a row (outside a link) opens the client page | crm-clients.tsx:392-400 | — client navigation to /crm/clients/:id (route App.tsx:396) | CODE | OK |
| Row: avatar + client name link | link | Opens the client page | crm-clients.tsx:401-413 | — | CODE | OK |
| Row: Contact (email / phone icons) | text | Shows stored email and phone; "—" when neither | crm-clients.tsx:414-430 | same SELECT (present()) | Spot-checked AUDIT row in CSV | OK |
| Row: Address | text | Service address line/city/state joined; "—" when empty | crm-clients.tsx:431-439 | same SELECT | CSV shows Bellingham, WA for AUDIT row | OK |
| Row: Bid pill (pill-bid-<id>) | status pill | Job Won / Undecided / Declined pill from the estimate outcome; "—" when no bids | crm-clients.tsx:440-447 | outcome map (see tabs) | Same computation as verified tab counts | OK |
| Row: Added date | text | created_at formatted with the browser's locale | crm-clients.tsx:448-450 | crm_customers.created_at | CSV created_at 2026-10-04T23:01:13Z = insert time | OK |
| Row: chevron link (aria "Open <name>") | link | Opens the client page | crm-clients.tsx:451-455 | — | CODE | OK |
| "Showing X of Y … clients — search to find others." (text-clients-showing) | text | Pager summary once more clients exist than loaded | crm-clients.tsx:461-466 | total from the paged response | CODE (+ load-more exercised by e2e) | OK |
| "Load more" (button-load-more-clients) | button | Fetches the next 100 rows (infinite scroll pages) | crm-clients.tsx:467-473 | same GET with offset= | CODE (getNextPageParam logic at :131) | OK |
| Empty states: "No clients match …" + Clear search (button-clear-search); "No clients yet" + New client | empty states | When the search/book is empty | crm-clients.tsx:334-361 | — | CODE | OK |

Notes / observations (not bugs):
- The list excludes archived clients (archived_at IS NULL) and caps the CSV at 10,000 rows; both are documented in code.
- Activity log column is `action` (e.g. "data.exported"), not activity_type.
- `curl -I` (HEAD) on export.csv runs the handler and logs a second data.exported row — harmless, browsers don't HEAD this.
