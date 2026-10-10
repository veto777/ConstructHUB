# CityView adapter report — 2026-10-10

## 1. Platform and mechanism

Auth-free CityView ASP.NET MVC permit locators on tenant hosts and shared Harris hosts. Supported shapes are a root portal, a tenant application directory (for example `/CityViewPortal`, `/Portal`, `/portalserver`, `/publicportal`, `/prodportal`), or a controller path below that root (`/Permit/Application`, `/Permit/Locator`, `/Permit/InspectionLocator`, `/Account/Logon`, `/Property`). The adapter derives the root from the stored URL, then requires the actual public locator's form and results endpoint; an unrelated page or unsupported layout throws. BluePrince and the mislabeled Grimes news site are rejected.

GET `<root>/Permit/Locator` establishes an isolated public cookie session. GET `<root>/Permit/LocatorResults` supplies searchValue, category, pageNumber, appealPeriodStatusesOnly=false and isInspectionSearch=false. JSON contains a View HTML fragment and LocationMarkers. Paging follows the actual Next control, with duplicate-page and 500-page guards that throw rather than silently truncate. Exact searches can redirect to `<root>/Permit/Status?permitId=...`; public detail pages supply dates and descriptions. Record sourceUrl comes from public record links, never a guessed permit number. Raw preserves the original row HTML and matching untouched marker, or the full detail HTML. Coordinates are accepted only from explicitly WGS84 markers.

No browser, login, CAPTCHA solver, or application submission is used. The shared politeFetch helper supplies the honest ConstructHUB User-Agent and per-host delay of at least 1,000 ms. HTTP failures, login pages and CAPTCHAs throw; [] requires a recognized genuine empty-results response.

## 2. Capabilities

- Search: address and permit number. This is the portal's shared text locator; results may match secondary locations and should not be assumed to have an exact primary-address match.
- Detail: **true**, via exact permit search and the public Status page. Dates are parsed strictly from the portal's reported US dates. Missing fields remain null; list rows are not automatically expanded into N extra detail requests.
- listRecent: **false**. The inspected public locator has no issued/applied-date filter. Dates on individual detail pages do not constitute a date listing. `listRecent(since)` returns [] without network traffic or brute-force searches. This adapter does not enable hourly permit alerts.
- Contractor/company, person/name, license and keyword: unsupported. No contractor search field was present on the verified locator layout.

## 3. Live tests

All times are UTC on 2026-10-10. Durations are measured wall-clock milliseconds. Database ID 0 is the live-harness sentinel, not a persisted jurisdiction ID. No database or app server was used. Search counts are normalized permit rows. Recent counts of 0 are an unsupported-operation result, not evidence that no permits were issued. Contractor/company/name/license queries were not attempted: neither public locator offers these search fields.

### Carrollton, TX

URL: https://cityserve.cityofcarrollton.com/CityViewPortal/Permit/Locator

- `address 1111 S Main St` at 2026-10-10T17:52:34.455Z: 49 records, 3354 ms, 4 HTTP requests.
  Sample: {"permitNumber": "PRMH202605452", "address": "1111 S Main St, Suite: 4223, Carrollton, TX 75006", "status": "Permit(s) Issued", "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "PRMH202605304", "address": "1111 S Main St, Carrollton, TX 75006", "status": "Permit(s) Issued", "issuedAt": null, "contractorName": null}.
- `permit PRMH202605452` at 2026-10-10T17:55:11.933Z: 1 records, 3573 ms, 3 HTTP requests.
  Sample: {"permitNumber": "PRMH202605452", "address": "1111 S Main St, Suite: 4223, Carrollton, TX 75006", "status": "Permit(s) Issued", "issuedAt": "2026-09-28", "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:55:16.999Z: 0 records, 0 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.

### Downers Grove, IL

URL: https://cvportal.downers.us/Permit/Application

- `address 6840 MAIN ST` at 2026-10-10T17:54:59.777Z: 15 records, 1223 ms, 2 HTTP requests.
  Sample: {"permitNumber": "26-ELC-0131", "address": "6840 MAIN ST, DOWNERS GROVE, IL 60516", "status": "In Plan Check", "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "25-CRN-0061", "address": "6840 MAIN ST, DOWNERS GROVE, IL 60516", "status": "Closed", "issuedAt": null, "contractorName": null}.
- `permit 26-ELC-0131` at 2026-10-10T17:55:02.480Z: 1 records, 2579 ms, 3 HTTP requests.
  Sample: {"permitNumber": "26-ELC-0131", "address": "6840 MAIN ST, DOWNERS GROVE, IL 60516", "status": "In Plan Check", "issuedAt": null, "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `detail 26-ELC-0131` at 2026-10-10T17:55:06.516Z: 1 records, 2480 ms, 3 HTTP requests.
  Sample: {"permitNumber": "26-ELC-0131", "address": "6840 MAIN ST, DOWNERS GROVE, IL 60516", "status": "In Plan Check", "issuedAt": null, "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:55:10.453Z: 0 records, 0 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.

### Madison County, AL

URL: https://cityview.madisoncountyal.gov/Portal/

- `address 100 Main` at 2026-10-10T17:53:02.185Z: FAILED, no result count; 1171 ms; PortalBlockedError: CityView challenge/access denial. HTTP response statuses: 302, 200; typed error status 403. No sample records.

### Manheim, PA

URL: https://cityview.manheimtownship.org/CityViewPortal

- `address 100 Main` at 2026-10-10T17:57:16.882Z: FAILED, no result count; 556 ms; PortalBlockedError: CityView challenge/access denial. HTTP response statuses: 200; typed error status 403. No sample records.

### Monroe, NC

URL: https://cvportal.monroenc.org/portal

- `address 100 Main` at 2026-10-10T17:54:23.447Z: 0 records, 1207 ms, 2 HTTP requests.
  The portal returned a genuine empty result. No sample records.
- `address 109 S MAIN ST` at 2026-10-10T17:55:07.054Z: 5 records, 1258 ms, 2 HTTP requests.
  Sample: {"permitNumber": "PR21200420", "address": "109 S MAIN ST, MONROE, NC 28112", "status": "Closed", "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "PR14200975", "address": "109 S MAIN ST, MONROE, NC 28112", "status": "Closed", "issuedAt": null, "contractorName": null}.
- `permit PR21200420` at 2026-10-10T17:55:41.286Z: 1 records, 2580 ms, 3 HTTP requests.
  Sample: {"permitNumber": "PR21200420", "address": "109 S MAIN ST, MONROE, NC 28112", "status": "Closed", "issuedAt": null, "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:56:16.832Z: 0 records, 1 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.

## 4. Blocked or failed tenants

- Naples FL, `https://cityview2.iharriscomputer.com/cityofnaplesflorida`: the public landing page advertises Application Search, but `/CityofNaplesFlorida/Permit/Locator` leads to the CityView `cvCaptchaForm` / `Home/ProcessLocatorCaptcha` page (HTTP 200). Recorded as typed PortalBlockedError 403. No CAPTCHA was attempted.
- Manheim PA and Madison County AL: the recorder entries above show HTTP 200 CityView CAPTCHA pages (Madison first redirects with HTTP 302). Typed 403 denotes the content challenge, not an HTTP 403 response. No bypass or retries after detecting the challenge.
- Kane County IL, `https://cvportal.kanecountyil.gov/portalserver`: `search address "100 Main"` reached a sign-in page and threw typed PortalBlockedError 401. No login attempted; initial diagnostic duration not retained, no record count or samples.
- Cherokee County GA, `https://cityview.cherokeega.com/cvprodportal/Permit/InspectionLocator`: `search address "100 Main"` reached a Welcome page rather than the supported permit locator and threw. The stored URL is an inspection locator; standard permit search was not enabled by this probe. HTTP 200; diagnostic duration not retained, no record count or samples.
- Initial Downers Grove stateless LocatorResults GET returned Session Expired; an incorrect POST to this GET-only action ended in HTTP 404. The implemented adapter uses the public locator cookie session and GET, verified successfully. No error is treated as no results.

## 5. Coverage

35 CityView-labeled target entries. **33 of 35** have the MVC URL shapes handled by the adapter; this is potential structural coverage, not 33 verified successful scrapes. **3 tenants** passed live address and permit searches: Downers Grove, Carrollton, Monroe. Another 5 were inspected/probed but were challenged, required login or did not expose the supported locator: Naples, Manheim, Madison County AL, Kane County, Cherokee County. The other 25 structurally eligible entries remain untested.

Registered labels: `CityView`, `CityView Portal`, `CityView Portal (Harris/Granicus)`, `CityView Online Portal`, `CityView (CentralSquare)`. These cover all labels among the 33 structurally eligible entries. The `CityView` label also occurs on a bad data row, which is rejected by URL.

Excluded:

- Lexington County SC — label `Harris CityView BluePrince Portal`, URL `https://www.blueprinceportal.com/login`: distinct BluePrince login platform; no alias registered.
- Grimes IA — label `CityView`, URL `https://www.dmcityview.com/feature-2/2025/12/31/respite-places-that-restore-our-resilience/`: a magazine/news article, not a government permit portal.

## 6. Known gaps, fixtures and validation

Tenant public-access settings and CAPTCHA policies prevent universal coverage. Do not mark blocked tenants as empty or active scraper coverage. Validate the remaining 25 tenants, investigate official date-filtered reports/feeds, and add separately verified contractor fields only if the portal exposes them. No CityView date listing was established, so the alerts poller must respect listRecent=false. Search list rows lack dates that may exist on detail pages; use detail for one known record. The 500-page limit throws and asks callers to narrow excessively broad queries.

The fixtures are untouched real response bodies fetched on 2026-10-10; `provenance.json` records URLs, query values, status and timestamps. The initial Downers Grove Main fixture contains 20 rows and Next; the Carrollton address fixtures contain all 49 rows across three pages. Offline tests cover real no-results, CAPTCHA, exact redirects, dates, pagination, repeated pages and registry aliases.

Validation: `npx vitest run --configLoader runner server/scrapers/cityview.test.ts server/scrapers/govpilot.test.ts` passed 26 tests (15 CityView, 11 GovPilot). `npx tsc --noEmit -p .` passed. Plain `npx vitest run ...` failed before tests because the shared node_modules is read-only; --configLoader runner uses the same repository config without the forbidden temporary bundle write. No application server or database was started.
