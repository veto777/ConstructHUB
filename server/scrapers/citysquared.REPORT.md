# CitySquared — 2026-10-10

## 1. Platform and mechanism

Handles `https://citysquared.com/#/app/<tenant>/landing`, `https://www.citysquared.com/#/app/<tenant>/landing`, and `#/app/map/<tenant>` shapes. The tenant comes from the stored hash path. The public app's settings and main JavaScript bundle provide the Municity5 base URL and anonymous service identifier. This is the identifier used by the signed-out public client, not a login/user credential. It is never logged or persisted by the adapter. Public bootstrap metadata is cached in memory for 1 hour.

GET `/M5Services/M5Service.svc/Service/3018/Tenants` resolves each tenant's service host. Bethel used services4.municity5.com; Fairfield used services6.municity5.com; Charlestown used municity5.com. Only HTTPS Municity5 service hosts are accepted. GET `Customer/<tenant>/PublicProfile` must enable public permits. GET `Customer/<tenant>/PublicFields?entity=Permit` restricts the query projection to visible public Permit fields plus the public record identifier. No private field or authenticated user profile is requested.

Read-only POST `Customer/<tenant>/FilteredSearch` searches Permit entities. JSON filters use `like` for search, `equals` for exact detail, and `greaterthanorequals`/`lessthan` for date ranges. The query sets includeDeleted=false and orders by Permit.Permit_ID. Subsequent pages add Permit_ID greater than the last received identifier; repeated, malformed or incomplete pages throw. Address columns vary: LegalAddress in Bethel/Charlestown; LegalAddr in Fairfield. Returned street-only addresses remain street-only.

The property lookup, public API and a public permit detail route were inspected in the browser. Normal searches use HTTP only, without login or browser contexts. Source URLs are the public `#/app/<tenant>/entity/Permit/<id>` pages.

## 2. Capabilities

- Search: address and permit number. Applicant-name search when ApplName is exposed by that tenant; otherwise it throws an explicit unsupported-field error. This is not contractor search.
- listRecent: **true**. Server date filters list PermitDate (permit/issue date), plus ApplicaDate1 (application date) where publicly available. Results are unioned by Permit_ID. The date window starts at since's calendar date and ends before the following UTC calendar day after the run date. No brute-force search.
- Detail: **true**, exact permit number through the public filtered endpoint. Returns all supported publicly exposed fields, not private full-object data. Ambiguous numbers throw.
- Contractor/company/license/keyword search unsupported. ContractorName and contractorLicense are null. Unknown fields remain null. Public permit rows without a permit number are logged and skipped, never assigned an invented number.
- Dates normalized to YYYY-MM-DD because the exposed government timestamps have local/calendar semantics. Valuation comes from public ConstCost. Raw is the untouched projected response row.

## 3. Live tests

All calls were sequential within this run, with at least 1 second between request starts per host, an honest ConstructHUB User-Agent, no account and no database. Times below are measured wall-clock milliseconds. Recent window: 2026-10-03 through 2026-10-10 inclusive (seven-day lookback at calendar-date precision). Contractor/company/license searches are not supported and were not substituted with unrelated fields.

### Bethel, CT

Stored URL: https://www.citysquared.com/#/app/BethelTownCT/landing

**search address 3 PARTRIDGE** — 9; 4761 ms; started 2026-10-10T17:59:34.401Z.

Sample 1: {"permitNumber": "06-710", "address": "23 PARTRIDGE DRIVE", "status": "Certificate", "issuedAt": "2006-12-05", "contractorName": null}

Sample 2: {"permitNumber": "6223", "address": "13 PARTRIDGE DRIVE", "status": "Certificate", "issuedAt": "1986-08-06", "contractorName": null}

**search permit M-26-0594** — 1; 2978 ms; started 2026-10-10T17:59:39.163Z.

Sample 1: {"permitNumber": "M-26-0594", "address": "3 PARTRIDGE DRIVE", "status": "Permit Issued", "issuedAt": "2026-10-07", "contractorName": null}

Only 1 record returned; no second sample exists.

**search name Smith** — failed (no count); 1910 ms; started 2026-10-10T17:59:42.142Z.

Error: Error; HTTP status None; CitySquared tenant does not expose ApplName publicly.

No records returned: request failed or search field unavailable; this is not a zero-result search.

**recent 2026-10-03** — 31; 3062 ms; started 2026-10-10T17:59:44.052Z.

Sample 1: {"permitNumber": "M-26-0594", "address": "3 PARTRIDGE DRIVE", "status": "Permit Issued", "issuedAt": "2026-10-07", "contractorName": null}

Sample 2: {"permitNumber": "B-26-0274", "address": "74 SOUTH STREET", "status": "Permit Issued", "issuedAt": "2026-10-05", "contractorName": null}

**detail M-26-0594** — 1; 2947 ms; started 2026-10-10T17:59:47.114Z.

Sample 1: {"permitNumber": "M-26-0594", "address": "3 PARTRIDGE DRIVE", "status": "Permit Issued", "issuedAt": "2026-10-07", "contractorName": null}

Only 1 record returned; no second sample exists.

### Charlestown, RI

Stored URL: https://citysquared.com/#/app/CharlestownTownRI/landing

**search address 4 LAGOON** — 17; 5568 ms; started 2026-10-10T17:59:50.062Z.

Sample 1: {"permitNumber": "616", "address": "4 LAGOON AVENUE", "status": "Issued", "issuedAt": "1992-06-25", "contractorName": null}

Sample 2: {"permitNumber": "40E", "address": "4 LAGOON AVENUE", "status": "Issued", "issuedAt": "1992-07-16", "contractorName": null}

**search permit 1169-26** — 1; 2975 ms; started 2026-10-10T17:59:55.630Z.

Sample 1: {"permitNumber": "1169-26", "address": "4 LAGOON AVENUE", "status": "Issued", "issuedAt": "2026-10-06", "contractorName": null}

Only 1 record returned; no second sample exists.

**search name Peter Sherman** — 1; 2986 ms; started 2026-10-10T17:59:58.605Z.

Sample 1: {"permitNumber": "1169-26", "address": "4 LAGOON AVENUE", "status": "Issued", "issuedAt": "2026-10-06", "contractorName": null}

Only 1 record returned; no second sample exists.

**recent 2026-10-03** — 50; 4010 ms; started 2026-10-10T18:00:01.592Z.

Sample 1: {"permitNumber": "1150-26", "address": "1065 SHANNOCK ROAD", "status": "Issued", "issuedAt": "2026-10-05", "contractorName": null}

Sample 2: {"permitNumber": "1151-26", "address": "15 MAPLEWOOD LANE", "status": "Issued", "issuedAt": "2026-10-05", "contractorName": null}

**detail 1169-26** — 1; 2949 ms; started 2026-10-10T18:00:05.603Z.

Sample 1: {"permitNumber": "1169-26", "address": "4 LAGOON AVENUE", "status": "Issued", "issuedAt": "2026-10-06", "contractorName": null}

Only 1 record returned; no second sample exists.

### Fairfield, CT

Stored URL: https://citysquared.com/#/app/FairfieldTownCT/landing

**search address Main** — 453; 6203 ms; started 2026-10-10T18:00:08.553Z.

Sample 1: {"permitNumber": "BLD-146987", "address": "MAIN STREET", "status": "Closed", "issuedAt": "2011-09-12", "contractorName": null}

Sample 2: {"permitNumber": "BLD-146384", "address": "MAIN STREET", "status": "Open", "issuedAt": "2011-03-31", "contractorName": null}

**search permit PZ-26-0676** — 1; 3438 ms; started 2026-10-10T18:00:14.759Z.

Sample 1: {"permitNumber": "PZ-26-0676", "address": "SPRING HILL ROAD", "status": "Permit Issued", "issuedAt": "2026-10-05", "contractorName": null}

Only 1 record returned; no second sample exists.

**search name Smith** — failed (no count); 1435 ms; started 2026-10-10T18:00:18.200Z.

Error: Error; HTTP status None; CitySquared tenant does not expose ApplName publicly.

No records returned: request failed or search field unavailable; this is not a zero-result search.

**recent 2026-10-03** — 157; 3977 ms; started 2026-10-10T18:00:19.639Z.

Sample 1: {"permitNumber": "E-26-1299", "address": "LEE DRIVE", "status": "Permit Issued", "issuedAt": "2026-10-05", "contractorName": null}

Sample 2: {"permitNumber": "PZ-26-0697", "address": "OLD POST ROAD", "status": "Permit Issued", "issuedAt": "2026-10-05", "contractorName": null}

**detail PZ-26-0676** — 1; 2996 ms; started 2026-10-10T18:00:23.620Z.

Sample 1: {"permitNumber": "PZ-26-0676", "address": "SPRING HILL ROAD", "status": "Permit Issued", "issuedAt": "2026-10-05", "contractorName": null}

Only 1 record returned; no second sample exists.

## 4. Blocked and failed tenants

No permit API HTTP 401/403/429 or CAPTCHA was encountered for the 3 live tenants. Applicant-name queries in Bethel and Fairfield failed explicitly because ApplName is not public there; this is not a no-results response. Charlestown applicant search succeeded. The initial honest bot User-Agent triggered a browser-compatibility overlay (not a CAPTCHA); a Chromium User-Agent with the same ConstructHUB bot/contact identification allowed normal browser inspection. The production HTTP adapter uses the supplied honest USER_AGENT helper.

A browser's optional Sentry telemetry endpoint returned HTTP 403; it was not a permit-data endpoint and was not retried or bypassed. The public page loaded Cloudflare's background script normally; no challenge was solved or bypassed. Production checks stop on HTTP blocking statuses or a challenge page.

## 5. Coverage

21 of 21 CitySquared targets have handled URL shapes, representing 21 of 418 assignment entries. 3 municipalities passed live searches and date listings; 18 have not been live-tested. Both landing and map hash routes are supported. No municipality identifier or service host is hardcoded. All distinct labels are registered:

- CitySquared
- CitySquared (Online Permitting Center)
- CitySquared (permit information by property)
- CitySquared (Online Building Permit Center)

Tenant field and public-profile permissions remain authoritative. A matching URL does not guarantee public permits, address/name fields, date fields or a working service. Such limitations throw rather than generate empty successes. No separate Municity URLs/labels occurred in this assigned CitySquared group; this adapter does not register unrelated CentralSquare labels.

## 6. Known gaps and follow-up

No contractor-role lookup yet. Bethel/Fairfield hide applicant names; Fairfield publishes street names without street numbers in LegalAddr. Do not reconstruct or invent missing address components. Some old Fairfield permit dates are corrupt future dates (including 9980-04-23); an initial unbounded lower-date query returned 163 rows, but the final bounded listing correctly returned 157. Charlestown's initial unbounded listing returned 51, versus 50 after the upper bound. These initial diagnostic counts are not the final test counts above.

Public field configuration or the public client bundle may change. Bootstrap/projection/response checks fail loudly if that happens. The global capability listing cannot express tenant-specific fields, so unsupported tenant fields throw at runtime. Validate more municipalities before claiming all 21 are functionally covered. Queries exceeding 100 pages (10,000 rows) throw. Pagination is live, not a transactionally frozen snapshot; an hourly poller should overlap its date window and deduplicate IDs. This adapter returns Permit entities, including those with application dates; separate Application entities without a Permit number are not yet covered.

Fixtures are unchanged live response bodies. Fixture provenance includes original endpoints and exact read-only request bodies, never authorization headers. Tests cover field permissions, date/record normalization, real pagination, failure propagation, HTTP-200 challenges, and URL shapes. Full repository TypeScript check passed.

Final HTTP-helper smoke check: Bethel, CT, permit query `ConstructHUB-no-such-permit-20261010`, 0 genuine results in 6 seconds (live harness). Its raw empty response is recorded for offline tests.

Final validation: 26 tests passed across the 2 adapter test files using `npx vitest run server/scrapers/govbuilt.test.ts server/scrapers/citysquared.test.ts --configLoader runner`; `npx tsc --noEmit -p .` exited 0. The runner flag is required here because node_modules/.vite-temp is read-only. Registry aliases were checked offline with storage mocked.
