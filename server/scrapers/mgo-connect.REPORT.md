# MGO Connect / MyGovernmentOnline report — 2026-10-10

## 1. Platform and mechanism

This vendor is not MyGov. The delivered adapter is an access diagnostic, not a working anonymous permit scraper. It recognizes `mgoconnect.org` / `www.mgoconnect.org` `/cp` paths containing one positive numeric `JID`, derived from the stored URL without guessing from the jurisdiction name. The three surveyed URLs identify JIDs 489, 418 and 491.

Anonymous GET `https://api.mgoconnect.org/cp/GetJurisdictionMenu/<JID>` returns the public tenant menu. Each surveyed menu marks `databind:UI.navigation.search` (Search Permits) with `isLoginRequired: true`. The adapter throws PortalBlockedError with status 401 to represent that declared login wall; the menu GET itself returned HTTP 200. It does not log in or call a protected record endpoint. A menu that allows guest search produces an explicit unimplemented-support error, never fabricated rows or an empty successful search.

Browser reconnaissance with the honest ConstructHUB user agent observed the app's own public metadata calls and its HTTP 401 session checks; no credentials were supplied. The public JavaScript declares POST `/api/v3/cp/project/search-projects` on api.mgoconnect.org, with a filters object containing JURISDICTIONID, PROJECTTYPEID, ADDRESS or PROJECTNUMBER, plus Rows/OffSet/SortField/SortOrder. One direct anonymous read-only search request for East Lyme (address Main, JID 489, PROJECTTYPEID 3, Rows 10, OffSet 0, dateCreated descending) returned HTTP 401 and `{"data":null,"message":"Unauthorized access","status":"fail"}`. No bypass was attempted. The API response and all three complete menu responses are fixtures.

## 2. Capabilities

Search: no anonymous types verified; capabilities.search is empty. Search calls expose the login wall, rather than claiming a successful search. The shipped UI contains address, project number, first/last name, business name and description fields, but presence in JavaScript is not evidence of anonymous access or supported adapter capabilities. License search is not implemented.

listRecent: false; returns `[]` locally, with a log explaining unsupported access. No issue/application date listing was validated. UI Created Before / Created After fields refer to project creation; date-only search is disallowed by the UI without other qualifying fields, and authenticated search was not attempted. Detail: false; no verified public detail access. No permit records, date values or contractor names are manufactured.

## 3. Live tests

All runs used the repository live-harness, on 2026-10-10 UTC. Elapsed time includes npx/Node startup. A blocked/unsupported search has no result count; it is not a successful zero-result query.

### East Lyme, CT

URL: https://www.mgoconnect.org/cp?JID=489

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address 100 Main St | 2026-10-10T17:50:11.719237+00:00 | 0.827 | BLOCKED: MGO Connect jurisdiction 489 marks public permit search as login-required; anonymous scraping unavailable |
| search permit 2026 | 2026-10-10T17:50:12.547087+00:00 | 0.811 | BLOCKED: MGO Connect jurisdiction 489 marks public permit search as login-required; anonymous scraping unavailable |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:13.359667+00:00 | 0.581 | 0 records; capability false, local unsupported return, no portal request |

Sample records: none. The search returned no public permit projects or was blocked, as recorded above; two real samples are unavailable.

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

### Live Oak, TX

URL: https://www.mgoconnect.org/cp?JID=418

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address 100 Main St | 2026-10-10T17:50:13.942202+00:00 | 0.796 | BLOCKED: MGO Connect jurisdiction 418 marks public permit search as login-required; anonymous scraping unavailable |
| search permit 2026 | 2026-10-10T17:50:14.739152+00:00 | 0.748 | BLOCKED: MGO Connect jurisdiction 418 marks public permit search as login-required; anonymous scraping unavailable |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:15.489354+00:00 | 0.544 | 0 records; capability false, local unsupported return, no portal request |

Sample records: none. The search returned no public permit projects or was blocked, as recorded above; two real samples are unavailable.

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

### Bay Saint Louis, MS

URL: https://www.mgoconnect.org/cp?JID=491

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address 100 Main St | 2026-10-10T17:50:16.034664+00:00 | 0.790 | BLOCKED: MGO Connect jurisdiction 491 marks public permit search as login-required; anonymous scraping unavailable |
| search permit 2026 | 2026-10-10T17:50:16.826272+00:00 | 0.777 | BLOCKED: MGO Connect jurisdiction 491 marks public permit search as login-required; anonymous scraping unavailable |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:17.604417+00:00 | 0.538 | 0 records; capability false, local unsupported return, no portal request |

Sample records: none. The search returned no public permit projects or was blocked, as recorded above; two real samples are unavailable.

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

## 4. Blocked or failed tenants

East Lyme, Live Oak and Bay Saint Louis: explicit Search Permits login requirement in each public menu. Public menu metadata HTTP 200; East Lyme's direct anonymous search HTTP 401; browser session checks HTTP 401. This is an account/login wall, not an observed Cloudflare or Incapsula CAPTCHA. We stopped at the wall and did not create accounts or submit any application forms.

## 5. Coverage

41 of 66 MGO-labelled entries (41 of all 141 assigned entries) contain supported tenant-identifying MGO Connect JID URLs. This is diagnostic URL coverage only. Working anonymous permit-data coverage is 0 verified tenants. All 66 MGO labels resolve to this diagnostic adapter; unsupported URLs fail clearly before a network request. Registered labels: `MGO Connect`, `MyGovernmentOnline (MGO Connect)`, `MyGovernmentOnline (MGO)`; the last label covers legacy login diagnostics only, not a legacy scraper.

25 entries are excluded from tenant-specific diagnostics because the stored URL lacks a JID, is a legacy login URL, or points at a government information page:

- Ellis County, TX — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Fort Bend County, TX — https://www.mgoconnect.org/cp/project-type-details/3?IsApplicationRestricted=false&SectionID=1 — shared portal/application page, no JID.
- Indian River County, FL — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Lowndes County, GA — https://mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Santa Rosa County, FL — https://www.santarosa.fl.gov/967 — government information page, not the vendor portal.
- Wilson County, TN — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Agoura Hills, CA — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Alexandria, LA — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Angleton, TX — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Apache Junction, AZ — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Cibolo, TX — https://mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Gonzales, LA — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Hammond, LA — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Lake Charles, LA — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Odessa, TX — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Pensacola, FL — https://www.mgoconnect.org/cp/home?returnUrl=%2Fcp%2Fportal — shared portal/application page, no JID.
- Plaquemines Parish, LA — https://plaqueminesparish.gov/265/Permits-Planning-Zoning — government information page, not the vendor portal.
- Ruston, LA — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- San Marcos, TX — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- Sevierville, TN — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.
- Shreveport, LA — https://www.mgoconnect.org/auth/login — shared login page, no tenant parameter.
- St. Bernard Parish, LA — https://www.mypermitnow.org/login.aspx?ReturnUrl=%2f — legacy login wall, no tenant parameter.
- St. James Parish, LA — https://www.mypermitnow.org/login.aspx?ReturnUrl=%2f — legacy login wall, no tenant parameter.
- Temple, TX — https://www.mgoconnect.org/cp/home?returnUrl=%2Fcp%2Fportal — shared portal/application page, no JID.
- Victoria, TX — https://www.mgoconnect.org/cp/portal — shared portal/application page, no JID.

## 6. Known gaps and follow-up

There is no shippable anonymous MGO permit-data scraper from the observed endpoints. Do not enable permit alerts for this vendor based on this adapter. Follow-up should find a documented genuinely anonymous public-record interface or vendor-authorized data feed, and resolve the 25 ambiguous/information/login URLs from authoritative jurisdiction sources. A working guest API must be independently verified with real records and recorded fixtures before changing capabilities. No auth tokens, credentials, login code, or speculative record parser were added.

Validation: the combined offline suite passed 16 tests using `npx vitest run --configLoader runner server/scrapers/mygov.test.ts server/scrapers/mgo-connect.test.ts`; `npx tsc --noEmit -p .` passed. Default Vitest bundling failed only because node_modules/.vite-temp is read-only (EROFS); the runner loader uses the unchanged repository test config. No DB or app server was required.
