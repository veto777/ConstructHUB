1. Platform & mechanism

CivicGov 4: https://[www.]civicgov4.com/<tenant>/portal, /portal/, or /portal/index.php. Tenant and host come from ctx.searchUrl; the original landing query is retained. HTTP URLs are upgraded to HTTPS. Other hosts, vendor versions, and department URLs throw rather than guessing a tenant.

Auth-free: yes on tenants advertising Public Records Search. The adapter follows the publicRecordsSearch/index link in the fetched landing page, then replays the page's GET API with an isolated cookie jar and X-CSRF-Token. Routes observed: publicRecordsSearch/search (query + page), publicRecordsSearch/parcelDetails (parcel_number), publicRecordsSearch/getPermits (parcel_number + page). Both parcel and permit pagination are consumed. Source pages use permits/view?id=<id>&from_parcel_search=<parcel>. Parkville's SPA25-04 public detail page was fetched and confirmed to display that permit, without login.

A public application catalog (automated/portalHtml) contains permit types and Apply Online links, not permit records. The recorded Culpeper catalog is expressly rejected. No create/apply endpoint is called. A missing public-search link throws; it does not return []. Cookies and CSRF tokens never enter records or logs. raw retains the untouched permit JSON row and parcel JSON row under separate keys.

2. Capabilities

Search: address only, at least 3 characters; this public UI searches location or parcel text. Permit-number, company, name, license and keyword queries throw an unsupported-query error and send no requests. Applicant names are returned as applicantName, never relabeled as contractors. permit_number_display is the public identifier and can be an application display number when no issued permit number exists. file_date is mapped to appliedAt; issuedAt and contractorName remain null because this API does not report them.

listRecent: false; returns [] without requests, no brute-force parcel enumeration. No global issue/application date listing exists in the verified public UI. detail: false; the contract requests a permit number, but this public API requires an internal ID plus parcel context and exposes no permit-number lookup. Returned records still link to their public detail pages.

3. Live tests

Executed sequentially on 2026-10-10 UTC with the repository live-harness. Timings below are subprocess seconds including tsx startup. Recent uses since=2026-10-03T00:00:00.000Z (last 7 calendar days); [] is the unsupported contract return, not evidence of no recent permits. Local unsupported-query errors are distinguished from portal failures.

Parkville, MO

URL: https://www.civicgov4.com/mo_parkville/portal/

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:48:42.442242+00:00 | search address 405 Main St | 2 | 4.735 |
| 2026-10-10T17:48:48.177385+00:00 | search permit SPA25-04 | unknown — CivicGov public records search supports address only, not permit | 0.569 |
| 2026-10-10T17:48:49.746913+00:00 | search company KC Custom Signs | unknown — CivicGov public records search supports address only, not company | 0.580 |
| 2026-10-10T17:48:51.327256+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.559 |

Two real sample records:

- {"permitNumber": "SPA25-04", "address": "405 MAIN ST", "status": "Expired", "issuedAt": null, "contractorName": null, "appliedAt": "2025-01-13", "applicantName": "KC Custom Signs"}
- {"permitNumber": "A26-1449", "address": "405 MAIN ST", "status": "Portal Submitted", "issuedAt": null, "contractorName": null, "appliedAt": "2026-09-22", "applicantName": "Sergio cervantes"}

Jefferson County, MO

URL: https://www.civicgov4.com/mo_jeffersoncounty/portal/

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:48:52.886763+00:00 | search address 100 Main St | 0 | 4.667 |
| 2026-10-10T17:48:58.554462+00:00 | search permit 2026 | unknown — CivicGov public records search supports address only, not permit | 0.565 |
| 2026-10-10T17:49:00.119682+00:00 | search company KC Custom Signs | unknown — CivicGov public records search supports address only, not company | 0.576 |
| 2026-10-10T17:49:01.696423+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.588 |

Samples: none available; no permit records were returned. No sample values fabricated.

South Portland, ME

URL: https://www.civicgov4.com/me_southportland/portal/index.php

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:49:03.284888+00:00 | search address 100 Main St | 3 | 4.744 |
| 2026-10-10T17:49:09.029699+00:00 | search permit 2026 | unknown — CivicGov public records search supports address only, not permit | 0.620 |
| 2026-10-10T17:49:10.650614+00:00 | search company KC Custom Signs | unknown — CivicGov public records search supports address only, not company | 0.616 |
| 2026-10-10T17:49:12.267315+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.631 |

Two real sample records:

- {"permitNumber": "B20100478", "address": "100 MAIN ST", "status": "Closed", "issuedAt": null, "contractorName": null, "appliedAt": "2010-05-03", "applicantName": "ENPRO SERVICES OF MAINE, INC."}
- {"permitNumber": "B20101451", "address": "100 MAIN ST", "status": "Closed", "issuedAt": null, "contractorName": null, "appliedAt": "2010-12-21", "applicantName": "ENPRO SERVICES OF MAINE, INC."}

Culpeper County, VA

URL: https://www.civicgov4.com/va_culpeper/portal/index.php?r=portalPosts/view&id=21

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:49:13.899036+00:00 | search address 100 Main St | unknown — CivicGov tenant does not advertise Public Records Search; public permit access unavailable | 0.871 |
| 2026-10-10T17:49:15.770595+00:00 | search permit 2026 | unknown — CivicGov public records search supports address only, not permit | 0.600 |
| 2026-10-10T17:49:17.371546+00:00 | search company KC Custom Signs | unknown — CivicGov public records search supports address only, not company | 0.598 |
| 2026-10-10T17:49:18.970570+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.627 |

Samples: none available; no permit records were returned. No sample values fabricated.

Spring Lake, NC

URL: https://www.civicgov4.com/nc_springlake/portal/index.php

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:49:20.598820+00:00 | search address 100 Main St | unknown — CivicGov tenant does not advertise Public Records Search; public permit access unavailable | 0.888 |
| 2026-10-10T17:49:22.487590+00:00 | search permit 2026 | unknown — CivicGov public records search supports address only, not permit | 0.602 |
| 2026-10-10T17:49:24.090388+00:00 | search company KC Custom Signs | unknown — CivicGov public records search supports address only, not company | 0.620 |
| 2026-10-10T17:49:25.711291+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.601 |

Samples: none available; no permit records were returned. No sample values fabricated.

4. Blocked / failed tenants

Culpeper County, VA and Spring Lake, NC return HTTP 200 landing pages without an advertised Public Records Search link. The adapter fails explicitly. The report does not call these CAPTCHA or HTTP-403 blocks. The Culpeper Permits link and automated/portalHtml response were inspected: these are application catalogs, not public permit search.

Additional navigation-only survey (no record queries): Random Lake, WI; Webster City, IA; Boone, NC; Brunswick, ME; Marshall, MO; Walton County, GA — HTTP 200, no public-search link. Westfield, IN; Windham, NH; Pooler, GA — HTTP 200, public-search link present; record retrieval not tested. In total, 14 CivicGov landing pages surveyed: 6 advertise public search, 8 do not. No HTTP 401/403/429 or anti-bot challenge was observed. No disabled public route was probed or forced open.

5. Coverage

43 / 44 CivicGov-labelled target entries have a recognized CivicGov 4 tenant URL shape (43 / 124 overall assigned entries). 3 tenants completed address searches: Parkville=2, Jefferson County=0, South Portland=3. 2 more adapter-tested tenants fail explicitly because public search is not advertised. Presence of a recognized URL does not guarantee public search is enabled.

Excluded: Emporia, KS — emporiaks.gov/emporiacivicgovportal is a municipal landing URL, not a CivicGov 4 tenant endpoint. No tenant slug is guessed. The stored Jackson, MO URL explicitly points to site/login; that shape is recognized, but login is not attempted. Other CivicGov domains/versions are not claimed.

Aliases / platform labels registered (every distinct target label for this vendor): `CivicGov portal`, `CivicGov`, `CivicGov citizen permit portal`, `CivicGov Permit Portal`, `CivicGov permit/project portal`, `CivicGov permits portal`, `CivicGov (Online Licenses and Permits)`, `CivicGov Citizens Portal`.

6. Known gaps and follow-up

No global permit-number or contractor search, no hourly date polling, and no detail-by-number. Enabling public search is a tenant configuration choice; 8 of 14 surveyed landing pages did not advertise it. Follow up with municipality-published exports or enabled public records access. Other vendor versions and Emporia's municipal redirect require separate verification.

Address matching follows the vendor's substring location search, not geocoding or address normalization. Each search fails, without returning partial data, if it exceeds 20 parcel pages, 100 parcels, 100 permit pages per parcel, or 250 total requests. Extremely broad queries must be narrowed. Both pagination levels are implemented but the three exact-address live runs each needed only one page; multi-page metadata was recorded from Parkville's Main search (5 parcel pages), not exhaustively crawled. Cookies are isolated per call and redirects are refused; unexpected layouts and malformed JSON throw.

Recorded fixtures include entire HTML/JSON responses; only CSRF tokens are redacted. capture-manifest.json contains exact URLs/status/timestamps for the three end-to-end captures. Parkville's additional Main response is the first 25 parcel rows, with page=1/pages=5. It is a parcel fixture, not permit data. Capture reruns confirmed Parkville=2, Jefferson County=0, South Portland=3.

Validation: `npx vitest run --configLoader runner server/scrapers/citizenserve.test.ts server/scrapers/civicgov.test.ts` — 27 tests passed across 2 files, entirely offline. `npx tsc --noEmit -p .` passed. The default Vitest config bundler fails with EROFS writing `node_modules/.vite-temp`; runner mode avoids that shared read-only directory. No app/server/database was started. No login, CAPTCHA submission, write form, proxy, or browser was used. All adapter traffic uses politeFetch, its honest ConstructHUB User-Agent, and a minimum delay of max(1000 ms, ctx.politeness.minDelayMs).
