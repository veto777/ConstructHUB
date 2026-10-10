1. Platform & mechanism

Implemented server/scrapers/iworq.ts and registered it in registry.ts. This is a guarded HTML adapter, not verified working automated search coverage: 0 successful live searches. The public search forms inspected require reCAPTCHA, which the adapter refuses to bypass.

Recognized hosts: portal.iworq.net and one tenant subdomain under portal.iworq.net (including underscores and hyphens). Recognized routes: /portalhome/{slug}, /{agency}/permits/{module}, /{agency}/new-permit/{module}/{template}, /{agency}/new-request/{module}/{template}. HTTP catalog URLs are accepted; only same-host HTTPS upgrades or same-origin redirects are followed. External government landing pages and case-management routes are rejected.

For a portal home, follow actual same-origin /permits/ links. For an application/request URL, derive /portalhome/{agency} and discover links there without loading or submitting the application. Agency and module IDs come from the published links, not a hardcoded tenant. Dearborn demonstrates why: its hostname slug is dearbornpermit but its permit agency is DEARBORNCOUNTY. All published permit modules are preflighted for the selected search type, including Douglas County's historical module.

Playwright page.on('request') and page.on('response') captured the first five targets, then the Douglas County, Graham County, and North Liberty search pages. There were 0 observed permit-data XHR/JSON requests on those three search-page loads. Search uses a server-rendered GET form: the published action is '?' with searchField and search parameters. Permit-number field permitnum_id, address field propertyaddress, and contractor field contractor_id were observed; custom fields are mapped only from their published labels. No protected query was replayed. North Liberty's initial HTML includes 15 public rows and ordinary /{agency}/permit/{module}/{recordId} detail links. The adapter does not return that unfiltered page as a search answer.

The adapter uses politeFetch, the shared ConstructHUB User-Agent, at least 1000 ms per host, explicit redirect checks, and the shared retry/backoff behavior. It does not need a browser at runtime. Survey browser traffic was sequential and throttled. Landing pages and initial listings are auth-free; automated search is not challenge-free. No login, access-code entry, CAPTCHA solving, or record-creating form submission was performed. Cottonwood's application page automatically invoked its own CAPTCHA verification during the initial browser survey; no application was submitted. Later browser probes disallowed POST.

2. Capabilities

Search types declared: address, permit, name, company. Actual fields are discovered separately for each tenant. Unsupported fields throw IworqUnsupportedError. License and keyword are not supported. All inspected search forms have an active g-recaptcha search button; search throws PortalBlockedError with status 403 to represent the challenge even when the page itself returned HTTP 200. This distinction is intentional: these are failures, not zero matching records.

listRecent: false. It returns [] without network traffic and logs that alerts are disabled. Douglas, Graham, Kennesaw, and Cottonwood did not expose a date-search option in the inspected current module. North Liberty exposes permit_dt_range labelled Permit Date, but it is CAPTCHA-protected and does not establish whether the date is issued or applied. Chamblee exposes a CAPTCHA-protected Application Date field (date1), not a verified unprotected recent listing. No date brute-force search was attempted.

Detail: false. Public detail links are preserved in sourceUrl when parsing a row, but lookup by permit number depends on the protected search. No detail capability is claimed.

Unknown fields are null. A generic Date column is retained only in raw and never relabelled issuedAt or appliedAt. raw.html is an exact slice of the fetched row, including whitespace. Only explicitly labelled issue/application/expiration dates are normalized.

3. Live tests

All times below are UTC on 2026-10-10. Elapsed milliseconds include the npx/tsx harness process startup. The recent window used since=2026-10-03T00:00:00Z (seven-day calendar window through the test day). A blocked/unsupported search has no result count; 'unavailable' must not be interpreted as 0 matches. All recent results have count 0 solely because listRecent=false; they are not evidence of zero issued permits.

24 harness runs across 7 tenants: 15 CAPTCHA-blocked searches, 2 unsupported searches, and 7 recent calls returning [] with the capability disabled. There were 0 successful search calls.

Exact harness commands, timestamps, outcomes, and error strings are recorded in fixtures/iworq/live-tests.json. Captured HTTP URLs/statuses/times are in fixtures/iworq/http-captures.json.

Douglas County, OR

URL: https://douglascounty.portal.iworq.net/portalhome/douglascounty

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:49:46.178Z | 2135 |
| permit | 2026 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:49:49.415Z | 2277 |
| company | Construction | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:49:52.793Z | 2088 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:49:55.981Z | 622 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Graham County, AZ

URL: https://grahamcounty.portal.iworq.net/portalhome/grahamcounty

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:49:57.704Z | 1970 |
| permit | 2026 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:50:00.776Z | 2015 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:50:03.892Z | 615 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Contractor query not run: the published form offers Permit #, Owner, and Parcel Address only.

North Liberty, IA

URL: https://portal.iworq.net/NORTHLIBERTY/permits/600

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 1252 Trinity Ln | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:50:05.607Z | 1470 |
| permit | 20261133 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:50:08.178Z | 1389 |
| company | Construction | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:50:10.668Z | 1403 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:50:13.171Z | 669 |

Search sample records: unavailable because all search calls were blocked. Separately, the public, unfiltered initial listing returned 15 rows at 2026-10-10T17:44:13.415Z. Two real rows from that listing (not search or recent results):

| permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- |
| 20261133 | 1252 Trinity Ln | null | null | null |
| 20261132 | 1252 Trinity Ln | null | null | null |

Both display Date=10/09/2026; that generic label is not treated as an issue date. Their Type of Work values are Z - Fence and Z - Patio. Source pages: https://portal.iworq.net/NORTHLIBERTY/permit/600/29798462 and https://portal.iworq.net/NORTHLIBERTY/permit/600/29797465. No detail page was fetched.

Clay County, NC

URL: https://portal.iworq.net/CLAYCOUNTY/new-request/700/3481

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: no discoverable search, exit 2 | 2026-10-10T17:50:14.940Z | 1050 |
| permit | 2026 | unavailable: no discoverable search, exit 2 | 2026-10-10T17:50:17.092Z | 1025 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:50:19.218Z | 604 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Contractor query not run: no contractor search field was exposed by the inspected page.

Kennesaw, GA

URL: https://kennesaw.portal.iworq.net/portalhome/kennesaw

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:35.951Z | 1997 |
| permit | 2026 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:39.050Z | 2219 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:51:42.369Z | 653 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Contractor query not run: no contractor search field was exposed by the inspected page.

Cottonwood Heights, UT

URL: https://cottonwoodheights.portal.iworq.net/COTTONWOODHEIGHTS/new-permit/600/1032

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:44.123Z | 1960 |
| permit | 2026 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:47.183Z | 1935 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:51:50.219Z | 561 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Contractor query not run: no contractor search field was exposed by the inspected page.

Chamblee, GA

URL: https://chamblee.portal.iworq.net/portalhome/chamblee

| Query type | Value | Count / outcome | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | 100 Main St | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:51.881Z | 1903 |
| permit | 2026 | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:54.885Z | 1911 |
| name | Smith | unavailable: reCAPTCHA, exit 2 | 2026-10-10T17:51:57.898Z | 1901 |
| recent | 2026-10-03T00:00:00Z | 0: unsupported capability, exit 0 | 2026-10-10T17:52:00.900Z | 582 |

Sample record 1: unavailable. Sample record 2: unavailable. No records were returned by these calls; none are fabricated.

Contractor query not run: no contractor search field was exposed by the inspected page.

Additional portal-home surveys (no adapter search queries):

- Dearborn County, IN — https://dearbornpermit.portal.iworq.net/portalhome/dearbornpermit — HTTP 200, links /DEARBORNCOUNTY/permits/600. The catalog label says Online Building Permit Application, but the page also offers public permit search. Its search page was not fetched. Counts and sample records unavailable.
- Hastings, NE — https://cityofhastings.portal.iworq.net/portalhome/cityofhastings — HTTP 200, links /HASTINGS/permits/600 and /HASTINGS/permits/601. The catalog label says Online Application Portal, but the page also offers public permit search. Those search pages were not fetched. Counts and sample records unavailable.

4. Blocked / failed tenants

The first five required survey targets were Douglas County, Graham County, Kennesaw, Cottonwood Heights, and Chamblee. All five have linked public permit searches; all five inspected current-module search forms require invisible reCAPTCHA. North Liberty is the sixth confirmed CAPTCHA-protected search tenant. Douglas's historical module 602 is also protected. Their search pages returned HTTP 200; the adapter emits typed challenge errors before query submission. No Cloudflare or Incapsula attribution is supported by the captured responses.

Initial curl probes of Douglas's portal home and North Liberty's listing returned plain HTTP 403 Forbidden. Later politeFetch and ordinary Playwright loads using the exact shared ConstructHUB User-Agent returned HTTP 200. The reason for the client-dependent responses is unknown. No proxy, VPN, CAPTCHA token reuse, or browser-fingerprint masking was used. These curl failures were diagnostic probes, not zero-result searches.

Clay County, NC — the stored /CLAYCOUNTY/new-request/700/3481 route returned HTTP 200 with a Service Requests submission form asking for owner, permit type, construction details, address, etc. The derived /portalhome/CLAYCOUNTY returned HTTP 200 with 'Portal home not set up' and 'This page does not exist.' There are no linked public searches. Both adapter searches threw a clear unsupported error. Count: 1 surveyed catalog endpoint classified as submission-only with no discoverable records search. This does not prove the jurisdiction has no other public records service. Confirmed inspection-only tenants: 0. Among the first five targets, application-only/inspection-only tenants: 0.

5. Coverage

524 / 528 catalog entries have accepted URL shapes. This is discovery/validation coverage, not successful scraping coverage. 9 unique tenants were surveyed over the network; 8 have public search links, 6 had search pages inspected and confirmed CAPTCHA-protected, and 1 has only the submission endpoint with no discoverable public search. The other 2 search-linked tenants were surveyed at their home pages only. 519 catalog entries were not live surveyed. Successful automated search tenants: 0.

Four excluded entries:

- Biscoe, NC: https://www.montgomerycountync.gov/departments/inspections — government department landing page, not an iWorQ portal.
- Chaves County, NM: https://www.chavescounty.gov/?splash=https%3a%2f%2fchavescountynm.portal.iworq.net%2fportalhome%2fchavescountynm&____isexternal=true — government external-link splash wrapper, not an iWorQ portal URL; its dedicated alias is not registered.
- Danville, IN: https://danvillein.portal.iworq.net/DANVILLEIN/new-case/400/763 — new-case submission route, not a verified permit route.
- Owego, NY: https://owego2.portal.iworq.net/OWEGO/cases/400 — cases listing route, not a verified permit route.

The accepted routes cover 480 portal-home entries, 25 direct permit listings, 14 new-permit forms, and 5 new-request forms. Those last 19 URLs are not assumed to be application-only tenants: Cottonwood demonstrates that a form URL can coexist with a public search portal.

Registered primary label and aliases: 27 distinct original strings, resolving to 24 case-insensitive registry keys. All distinct labels on accepted targets are included:

- iWorQ
- iWorQ Citizen Portal
- iWorQ permit portal
- iWorQ building permit portal
- iWorQ citizen portal (building permits)
- iWorQ citizen portal
- iWorQ Building Permits Portal
- iWorQ Building Permit Portal
- iWorQ E-Permits portal
- iWorQ (Online Building Permit Application)
- iWorQ (Permit Portal)
- iWorQ (Building and Onsite Wastewater Permits)
- iWorQ (Online Permit Portal)
- iWorQ (Online Application Portal)
- iWorQ (Permit Search)
- iWorQ Online Permit Portal
- iWorQ portal
- iWorQ (city link redirects to portal)
- iWorQ (Paris-Bourbon County joint planning)
- iWorQ (Citizens Permit Portal)
- iWorQ (independent city)
- Metro Hartsville/Trousdale County (iWorQ)
- iWorQ (zoning & floodplain permits)
- iWorQ (Permit Management)
- iWorQ (Building and Zoning Permits)
- iWorQ (Building Permit)
- iWorQ Permit Portal

6. Known gaps and follow-up

This does not unlock iWorQ search or alerts on any verified tenant. The unprotected GET path and pagination checks are implemented from the published form contract, but no successful unprotected query response was available to validate that path end to end. The real initial listing parser is covered offline with 15 North Liberty records. Historical layouts missing a permit-number column fail explicitly rather than inventing a number. No license search or detail fetch is implemented. The 100-page guard throws rather than returning truncated search results. Errors from any searched module abort the complete search rather than hiding partial coverage.

Follow-up should seek an officially supported public data export/API or government-published issued-permit feed, with permission where needed. Confirm whether any iWorQ tenant has CAPTCHA-free search before claiming working coverage or enabling alerts. Verify date semantics independently; Permit Date is not sufficient evidence of issue or application date. Survey the remaining tenants and investigate Clay's official records alternative, the two case-management URLs, and the two government wrapper URLs. Do not remove the CAPTCHA guard to improve apparent coverage.

Validation: 31 offline tests passed with `npx vitest run server/scrapers/iworq.test.ts --configLoader runner`. `npx tsc --noEmit -p .` passed. The exact default Vitest command could not load its config because the environment mounts node_modules/.vite-temp read-only (EROFS). The runner flag avoids that write without changing repository configuration. Tests mock politeFetch and legacy scraper imports; no network or database is needed. No application server was started.

Fixtures are real fetched HTML responses. Only CSRF tokens and CAPTCHA payload secrets were redacted. No government rows were manufactured or edited. The network logs also record the automatic CAPTCHA traffic from the initial Cottonwood page load. targets.json is not committed. No pushes were performed.
