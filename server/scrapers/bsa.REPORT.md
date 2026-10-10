1. Platform & mechanism

BS&A Online. Auth-free public searches and record details: yes, on the tested tenants. No login, CAPTCHA solving, permit application submission, database, or browser is used.

Handled hosts: bsaonline.com and www.bsaonline.com. HTTP URLs are normalized to HTTPS. A positive numeric uid query parameter, case-insensitive, identifies the municipality. Any stored path with that uid, including stale application-session links and Contractors links, starts at the municipality home page. DirectUrl/Cd_PermitApplicationContractor/<id> is also handled: the two assigned shortcuts returned HTTP 302 to /Cd_PermitApplication/ApplyForPermitContractor?uid=3105 and ?uid=3102. The adapter derives that ID without opening the application. Other hosts, missing/ambiguous municipality IDs, and cross-tenant redirects throw.

The observed layout is ASP.NET MVC with an AJAX wizard and Telerik grids, rather than a ViewState form. The adapter replays the site's public requests with politeFetch and a cookie jar isolated to each search:

- GET /Home/MunicipalityHome and /SiteSearch/BuildingDepartmentRecordSearch, following the site's AdvancedRecordSearch session redirects.
- GET /SiteSearch/GetAdvancedRecordSearchFindRecordStepPartialView to read the available fields and their numeric values.
- GET /SiteSearch/GetPageOfFindRecordSearchResultsPartialView with the session GUID, search text, search type, and page.
- POST /SiteSearch/UpdateAdvancedRecordSearchFindRecordStep changes only the temporary search selection. GET /SiteSearch/GoToRecord follows its public record link.
- Address/name results are properties, not permits. The property parent supplies the normal SubPageAuthToken and reference key for GET /CD_PropertySearchV3/PropertyAndParcelDetails. The adapter reads the actual GridPermitsSelectBinding URL from the returned script and POSTs page/size to load its JSON. The initial HTML's empty grid is only a placeholder and is never accepted as zero permits.
- When a parcel opens a different associated property, the adapter reads CdPropertySelectModal and GridAssociatedPropertiesSelectBinding, selects the exact returned property GUID by ID or an unambiguous address, and loads that property's permits.
- Permit-number hits lead to /CD_RecordDetails/Permit. Details are parsed from labeled fields and the Contractor/Applicant/Owner sections.

Every network request, including redirects, uses the shared honest ConstructHUB User-Agent and a minimum delay of max(1000, ctx.politeness.minDelayMs). Shared backoff handles HTTP 401/403/429/503. Actual CAPTCHA/challenge pages throw PortalBlockedError. Ordinary global CAPTCHA script references are not mistaken for a presented challenge. No challenge was bypassed.

2. Capabilities

Search: address, permit, name. Name means the site's general Name tab; the successful live name test used a property owner's name. There is no verified contractor-only, company, license, or keyword search, so those types throw and are not advertised.

listRecent: no. The inspected Building Department forms in Rochester Hills, East Point, Kentwood, and Burton offered Record Number, Name, Address, and Parcel Number. No public issue/application-date listing or recent-permits view was found. listRecent returns [] with capabilities.listRecent=false and logs that it is unsupported. It makes no network requests and performs no brute-force search. Its zero counts below are not claims that no permits were issued.

Detail: yes. Exact permit-number lookup returns the public permit page, or null after a genuine search with no exact match. Ambiguous exact numbers throw. Record-number searches that encounter unsupported non-permit record layouts fail explicitly.

Unknown fields are null. Summary-grid person fields and construction values are unpopulated defaults, so contractorName, contractorLicense, applicantName, ownerName, description, and valuation remain null unless actually present in the supported response. Detail pages provide contractor/applicant/owner names; missing license, valuation, and coordinates remain null. JSON timestamps preserve their instant as full ISO; displayed calendar dates use YYYY-MM-DD. sourceUrl is the public permit link. raw retains the untouched JSON row or original permit-page main HTML.

3. Live tests

All times are UTC on 2026-10-10. Tests used the adapter itself, sequentially, with minDelayMs=1100. Initial live-harness checks also passed at minDelayMs=1000: Rochester Hills address "1008 ADELE" returned 11 permits in 14 seconds; permit "PB-2001-0568" returned 1 in 11 seconds. The measured validation runs below include session setup, redirects, and pagination. The application was never started.

Company/license/contractor-only searches were not run against any tenant because they are unsupported. Contractor values below come from actual public permit details.
Jurisdiction: Rochester Hills, MI

URL: https://bsaonline.com/Home/MunicipalityHome?uid=385

| Query type | Exact value / since | Count or failure | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | `1008 ADELE` | 11 | 2026-10-10T17:55:38.704Z | 14815 |
| permit | `PB-2001-0568` | 1 | 2026-10-10T17:59:39.011Z | 11372 |
| name | `CHERUKURI, RAVI B` | 11 | 2026-10-10T18:01:50.042Z | 14856 |
| recent | `2026-10-03T18:00:58.538Z` | 0 (unsupported; no network) | 2026-10-10T18:00:58.538Z | 0 |

Two actual sample records from these runs:

| permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- |
| PB-2001-0568 | 1008 ADELE CT | FINALED | 2001-09-05 | DELRAY HOMES INC |
| PE-2001-0709 | 1008 ADELE CT | FINALED | 2001-12-19 | null |

Jurisdiction: East Point, GA

URL: https://bsaonline.com/Home/MunicipalityHome?uid=2757

| Query type | Exact value / since | Count or failure | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | `2862 SEMMES ST 100` | 1 | 2026-10-10T17:57:15.792Z | 14567 |
| permit | `PB21-0081` | 1 | 2026-10-10T17:57:59.683Z | 10477 |
| address | `2862 SEMMES ST` | ERROR: public permit grid unavailable; no count returned | 2026-10-10T17:55:59.858Z | 22244 |
| recent | `2026-10-03T18:00:58.539Z` | 0 (unsupported; no network) | 2026-10-10T18:00:58.539Z | 0 |

Two actual sample records from these runs:

| permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- |
| PB25-0107 | 2862 SEMMES ST 100 (A) | Hold | null | null |
| PB21-0081 | 2862 SEMMES ST | Finaled | 2021-05-07 | WILLIAMS BURROUGHS CONSTRUCTION |

Jurisdiction: Kentwood, MI

URL: https://bsaonline.com/CD_MdbPermitApplication/PermitApplication?permitApplicationSessionGuid=1c163847-efe1-4794-9402-33fb02130116&uid=371

| Query type | Exact value / since | Count or failure | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | `3100 28TH ST SE` | 11 | 2026-10-10T17:56:41.626Z | 17066 |
| permit | `PB13036508` | 1 | 2026-10-10T17:58:35.815Z | 11486 |
| recent | `2026-10-03T18:00:58.539Z` | 0 (unsupported; no network) | 2026-10-10T18:00:58.539Z | 0 |

Two actual sample records from these runs:

| permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- |
| PB13036508 | 3100 28TH ST SE | FINALED | 2013-06-11 | JACK WORKMAN CORP |
| PB14036814 | 3100 28TH ST SE | FINALED | 2014-02-26T18:31:01.960Z | null |

Jurisdiction: Burton, MI

URL: https://bsaonline.com/Home/MunicipalityHome?uid=209

| Query type | Exact value / since | Count or failure | Start UTC | Elapsed ms |
| --- | --- | --- | --- | --- |
| address | `1009 ADAMS AVE` | ERROR: public permit grid unavailable; no count returned | 2026-10-10T18:00:31.572Z | 14294 |
| permit | `PB-2001-0568` | 0 | 2026-10-10T18:01:17.720Z | 6276 |
| recent | `2026-10-03T18:00:58.539Z` | 0 (unsupported; no network) | 2026-10-10T18:00:58.539Z | 0 |

No sample permit records: the address request failed explicitly, and the permit-number query returned 0. Two records cannot honestly be supplied.

4. Blocked / failed tenants

No HTTP 401, 403, 429, visible Cloudflare challenge, Incapsula challenge, or login wall occurred in the recorded adapter live runs. Public pages were served through Cloudflare and included background challenge scripts, but returned the requested public records without an interactive challenge.

Burton: the HTTP 200 property response for 1009 ADAMS AVE contains owner/attachment information but no public permit grid or its loading endpoint. The adapter throws "BS&A Online public permit grid unavailable for this property or municipality". The module's search form is present, so this is not evidence that the entire municipality has disabled Building Department records. No missing permits were inferred.

East Point: the broader address query "2862 SEMMES ST" includes 2862 SEMMES ST 200 (B), whose HTTP 200 property response omits the permit grid. The adapter throws for the entire query rather than returning a misleading partial list. The narrower suite-100 query succeeds after selecting its exact associated property.

Exploratory permit query "2026" was rejected by Rochester Hills and Kentwood with an HTTP 200 application error, "More detailed search term is required." This is an error, not zero results. Early curl discovery without a session cookie jar hit a redirect loop; the final adapter maintains cookies and rate-limits each manual redirect. Neither case was an authentication bypass.

The adapter also explicitly rejects a home page without the Building Department Record Search link, or a page stating that Building Department is unavailable for the municipality. No such whole-tenant disabled page was observed in the four tested municipalities.

5. Coverage

186 / 190 targets.json entries have a supported URL shape: 184 with a numeric uid query parameter, plus 2 verified DirectUrl shortcut shapes. This is URL-shape coverage, not a claim that all 186 tenants successfully expose permit records. Four municipalities were exercised live. All 10 distinct platform labels are registered, including the canonical platform and 9 aliases:

- BS&A Online
- BS&A Online permit application
- BS&A Online (Harrison Charter Township)
- BS&A Online e-permitting
- BS&A
- BS&A Online permit portal
- BS&A Online (myNixa)
- BS&A Online (Building Permit Inquiry)
- BS&A Online (building permit search/payment)
- BS&A Online (City of Hot Springs)

The 4 excluded entries are municipal information pages, not BS&A portal URLs, and have no supported tenant identifier:

- Berkley, MI: https://www.berkleymi.gov/Government/City%20Departments/Community%20Development/Building%20Permits/Building%20Permits
- Bridgeport, MI: https://www.bridgeportmi.org/departments/building_and_codes/permits.php
- Cadillac, MI: https://www.cadillac-mi.net/155/Applications-Permits
- Coldwater, MI: https://www.coldwater.org/560/7845/Building-Permits-Inspections

No targets.json entry was edited or committed. Application URLs with an explicit uid are handled by starting a public record search; no application form is submitted.

6. Known gaps and follow-up

- Alerts are unavailable until BS&A exposes a verified public issue/application-date listing or an authorized public feed. Do not substitute prefix enumeration for listRecent.
- Investigate whether omitted permit grids can be distinguished authoritatively between no permit history and hidden/unavailable data. The current behavior is deliberately an explicit failure, including when only one property in a multi-property result omits the grid.
- Contractor names are available in permit details. Address/name summary results keep them null; callers can use detail for enrichment. A dedicated contractor/company/license filter has not been verified.
- Other BS&A layouts and per-tenant module configurations may differ. The adapter fails explicitly on unknown forms, grids, result counts, or detail layouts. Broader searches matching more than 100 top-level records throw and ask for a narrower query. Permit grids are bounded to 100 pages of 10 rows; exceeding the bound throws instead of truncating. Associated-property selection is bounded to 100 properties.
- Resolve the 4 municipal information pages to source-verified BS&A tenant URLs in a separate directory-data task.
- No automated blocking condition occurred live; offline tests verify error propagation and challenge detection. No claim is made that every tenant is automation-accessible.

Validation: 18 offline tests passed with `npx vitest run server/scrapers/bsa.test.ts --configLoader runner`. The unmodified command without that flag fails before loading tests because the shared node_modules/.vite-temp directory is read-only (EROFS). The runner loader avoids that infrastructure write. `npx tsc --noEmit -p .` passed with exit code 0. Authored TypeScript passes `git diff --check`; recorded HTML retains the server's original CRLF/trailing whitespace instead of altering response fixtures. Fixture provenance is recorded in fixtures/bsa/README.md. The first implementation checkpoint is commit 2f621679; the final commit contains this report and the completed validation.
