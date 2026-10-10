# SDL Portal adapter report — 2026-10-10

## 1. Platform & mechanism

Anonymous HTTP on sdlportal.com, www.sdlportal.com, and sync.sdlportal.com. Tenant identity is the URL's /towns/<state>/<county>/<town> path, including that path nested inside a stored /login?redirect= URL. Search, inspection/request, and application/form suffixes are normalized to the town's public search2 endpoint. The adapter does not submit those request/application forms.

The public search page and its search.js advertise GET /search2?st=permits&as=1&limit=100. Verified fields are loc (address), pc (permit/control number), kw (work-description keywords), psd/ped (issue timestamps), stps=all, and stpd=all. Native pc search matches permit OR control numbers, including partial matches. Results are HTML tables with Control #, Permit #, Issue Date, Location, Work Type, Work Description, Subcodes, and Status. The record's public /building/permits/<control> hyperlink is preserved as sourceUrl. raw.html is the exact original response substring for the row, not regenerated markup.

politeFetch supplies the ConstructHUB User-Agent and at least 1000 ms per-host delay. Login redirects are stopped and surfaced as PortalBlockedError (401 classification), even when the actual HTTP response is 302. CAPTCHA/challenge pages and HTTP 401/403/429 also throw. No login, write form, browser, database, or server was used.

## 2. Capabilities

- Search: address, permit number (native permit/control filter), work-description keyword.
- listRecent: yes, native issue-date range, then exact calendar-date filtering of returned records. SDL compares timestamps rather than treating equal midnight bounds as an inclusive day. Recorded tests for October 5 with identical UTC midnight bounds returned zero; the corrected query returned all 4 known October 5 permits. The adapter pads the native query from one day before the requested start through two days after the requested end, then discards permits whose displayed issue date is outside the exact requested range. This is a bounded native date search, not brute-force searching.
- A public search can be capped at 100 rows. A capped address/permit/keyword search throws and asks for a narrower query. A capped recent listing recursively divides the requested date range; if one logical day (including its timestamp margin) remains capped, it throws rather than returning an incomplete alert feed. Maximum 128 requests for a listing.
- Detail: no. A real Hazlet public detail page was fetched and recorded, but normalization across its separate subcode/contact tables is not implemented.
- Company/name/license: unsupported; no dedicated public permit filter was verified. Contractor and other unavailable fields remain null. Some public details do expose contractor sections, which require separate parsing and validation.
- Rows with only an application control number and no permit number are omitted. Control numbers are retained in raw/source links, not represented as permit numbers.

## 3. Live tests

Five tenants from targets.json received address, permit-number, and last-seven-day recent calls: 3 public successes (Hazlet, Monmouth Beach, Cherry Hill) and 2 login-only failures (Raritan, Spring Lake Heights). Company/license searches are unsupported and were not sent. Direct adapter calls used the same context as live-harness and recorded the HTTP responses. Hazlet address/permit checks also ran through live-harness.ts. Counts are numbered permits, not unnumbered applications. All run timestamps are UTC.

### Hazlet, NJ

Stored URL: https://www.sdlportal.com/towns/nj/monmouth/hazlettwp/search?st=permit

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 10 numbered permit records. 2026-10-10T17:58:49.860Z; 0.653 seconds.

  Sample: {"permitNumber": "2026-0685", "address": "17 CROMAN COURT", "status": "Open", "issuedAt": "2026-10-05", "contractorName": null}
  Sample: {"permitNumber": "2026-0688", "address": "3057 HIGHWAY 35", "status": "Open", "issuedAt": "2026-10-06", "contractorName": null}

- search address = 17 CROMAN COURT: 4 numbered permit records. 2026-10-10T17:53:28.612Z; 0.854 seconds.

  Sample: {"permitNumber": "2026-0685", "address": "17 CROMAN COURT", "status": "Open", "issuedAt": "2026-10-05", "contractorName": null}
  Sample: {"permitNumber": "2026-0411", "address": "17 CROMAN COURT", "status": "CA and Close Date Issued", "issuedAt": "2026-06-22", "contractorName": null}

- search permit = 2026-0685: 1 numbered permit records. 2026-10-10T17:53:30.419Z; 1.398 seconds.

  Sample: {"permitNumber": "2026-0685", "address": "17 CROMAN COURT", "status": "Open", "issuedAt": "2026-10-05", "contractorName": null}
  Only one record returned; no second sample exists.

- search keyword = water heater: ERROR: SDL search exceeds its 100-result limit; narrow the query; result count unknown, not zero. 2026-10-10T17:53:31.655Z; 0.844 seconds.
  No sample records: the request failed before a complete record set was available.
- search keyword = ConstructHUB-no-such-work-20261010: 0 numbered permit records. 2026-10-10T17:56:53.982Z; 0.734 seconds.
  No sample records: the verified search returned zero numbered permits.

### Monmouth Beach, NJ

Stored URL: https://www.sdlportal.com/towns/nj/monmouth/monmouthbeach

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 0 numbered permit records. 2026-10-10T17:58:51.893Z; 0.667 seconds.
  No sample records: the verified search returned zero numbered permits.
- search address = 1 Ocean: 31 numbered permit records. 2026-10-10T17:53:32.649Z; 0.627 seconds.

  Sample: {"permitNumber": "260155", "address": "11 OCEAN AVENUE", "status": "Open", "issuedAt": "2026-07-14", "contractorName": null}
  Sample: {"permitNumber": "p2018-0167+C", "address": "21 OCEAN AVENUE", "status": "Open", "issuedAt": "2020-05-05", "contractorName": null}

- search permit = 2026: 13 numbered permit records. 2026-10-10T17:53:33.665Z; 0.631 seconds.

  Sample: {"permitNumber": "p2018-0169+D", "address": "11 SOUTH ROAD", "status": "Open", "issuedAt": "2019-08-13", "contractorName": null}
  Sample: {"permitNumber": "p2003-0277", "address": "14 COOK STREET", "status": "CA and Close Date Issued", "issuedAt": "2003-10-30", "contractorName": null}

- search permit = 260155: 1 numbered permit records. 2026-10-10T18:02:33.367Z; 0.783 seconds.

  Sample: {"permitNumber": "260155", "address": "11 OCEAN AVENUE", "status": "Open", "issuedAt": "2026-07-14", "contractorName": null}
  Only one record returned; no second sample exists.


### Raritan, NJ

Stored URL: https://www.sdlportal.com/login?redirect=https%3A%2F%2Fwww.sdlportal.com%2Ftowns%2Fnj%2Fhunterdon%2Fraritantwp

- listRecent since 2026-10-03 through 2026-10-10 (issue date): ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:52:38.030Z; 0.322 seconds.
  No sample records: the request failed before a complete record set was available.
- search address = 100 Main St: ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:53:34.288Z; 0.216 seconds.
  No sample records: the request failed before a complete record set was available.
- search permit = 2026: ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:53:34.900Z; 0.198 seconds.
  No sample records: the request failed before a complete record set was available.

### Spring Lake Heights, NJ

Stored URL: https://www.sdlportal.com/towns/nj/monmouth/springlakeheights

- listRecent since 2026-10-03 through 2026-10-10 (issue date): ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:52:38.822Z; 0.384 seconds.
  No sample records: the request failed before a complete record set was available.
- search address = 100 Main St: ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:53:35.463Z; 0.156 seconds.
  No sample records: the request failed before a complete record set was available.
- search permit = 2026: ERROR: SDL redirected to login; result count unknown, not zero. 2026-10-10T17:53:36.145Z; 0.267 seconds.
  No sample records: the request failed before a complete record set was available.

### Cherry Hill, NJ

Stored URL: https://www.sdlportal.com/towns/nj/camden/cherryhilltwp/requests/inspection

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 75 numbered permit records. 2026-10-10T17:58:54.608Z; 1.361 seconds.

  Sample: {"permitNumber": "20262895", "address": "304 NATURE DR", "status": "Open", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "20262894", "address": "15 GREEN ACRE DR", "status": "Open", "issuedAt": "2026-10-08", "contractorName": null}

- search address = 304 NATURE DR: 7 numbered permit records. 2026-10-10T17:56:48.909Z; 1.474 seconds.

  Sample: {"permitNumber": "20262895", "address": "304 NATURE DR", "status": "Open", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "20250148", "address": "304 NATURE DR", "status": "Finals Passed", "issuedAt": "2025-01-21", "contractorName": null}

- search permit = 20262895: 1 numbered permit records. 2026-10-10T17:56:51.818Z; 1.486 seconds.

  Sample: {"permitNumber": "20262895", "address": "304 NATURE DR", "status": "Open", "issuedAt": "2026-10-08", "contractorName": null}
  Only one record returned; no second sample exists.


Additional boundary verification: the padded October 5-only Hazlet query returned 9 native rows spanning October 5–6, of which exactly 4 had issuedAt=2026-10-05: 2026-0685, 2025-0685+C, 2026-0686, 2026-0684. The offline test verifies all 4 are retained and the neighboring day is excluded. Bounded timestamp test responses, including failed same-midnight queries and raw hour-offset variants, are retained as fixtures.

## 4. Blocked / failed tenants

- Raritan: public /search redirects HTTP 302 to /login; following the initial survey redirect produced an HTTP 200 password form. Address, permit, and recent adapter calls fail explicitly. No records/count are asserted.
- Spring Lake Heights: the same HTTP 302 login wall for public search, address, permit, and recent. Initial recorded login form returned HTTP 200. No records/count are asserted.
- Delaware Township: both the stored /requests/permit application endpoint and derived /search returned HTTP 302 to login. No forms were submitted. A public permit search is not established for this tenant.
- Cherry Hill: the stored /requests/inspection page returned HTTP 200 and is a request workflow, not a permit listing. Its separate public search returned HTTP 200; normalization to that search produced the 75 recent permits above. Do not label this entire tenant inspection-only.
- An initial Hazlet advanced request with f=json and only the partial form parameters returned HTTP 500, recorded in hazlet-main.json as an HTML error response. The implemented adapter uses the verified complete HTML form request instead.
- Broad Hazlet queries Main (zero results), Middle (100+ capped results), and keyword water heater (100+ capped results) were surveyed. The capped keyword query throws; the adapter never represents it as zero or a complete 100-record answer.

No Cloudflare/Incapsula/CAPTCHA challenge or HTTP 403/429 was observed during the sampled requests.

## 5. Coverage

79 of 84 SDL-labeled targets have a supported canonical SDL town URL, directly or in a login redirect. This is URL-shape coverage, not public-access coverage: 3 tenants successfully returned records, 2 more were tested through all adapter operations and hit login, and Delaware's form/search pages were separately confirmed login-only. The remaining candidate tenants were not individually validated.

31 labels are registered (platform plus 30 aliases):

- SDL Portal
- SDL
- SDL Permit Portal
- SDL Portal (Building Inspection Portal)
- SDL Portal (Building Inspection)
- SDL Portal (Building Permits)
- SDL Portal (Citizen Login)
- SDL Portal (Citizen Portal)
- SDL Portal (Citizen/Contractor Portal)
- SDL Portal (Construction Permit)
- SDL Portal (Construction Permits)
- SDL Portal (Construction requests)
- SDL Portal (Construction work permit)
- SDL Portal (Inspection Request)
- SDL Portal (Inspection Requests)
- SDL Portal (Inspections)
- SDL Portal (My Permit Information)
- SDL Portal (Permit Tracking)
- SDL Portal (Permit and Inspection Portal)
- SDL Portal (Permit, Inspections & Property Information)
- SDL Portal (Permits and Inspections)
- SDL Portal (Permits)
- SDL Portal (Property/Permit Lookup)
- SDL Portal (Requests)
- SDL Portal (Schedule an Inspection)
- SDL Portal (Status of Building Permit)
- SDL Portal (borough construction permits)
- SDL Portal (city construction permits)
- SDL Portal (permit application)
- SDL Portal (permit search)
- SDL Portal (permit status search)

Excluded entries:

- New Providence, NJ — https://www.egovlink.com/newprovidence/action.asp — eGovLink, not this SDL layout. Its unique label SDL Portal (Building Department Online) is not registered.
- Berkeley Heights, NJ — http://sdl.town/sdlBrklyHghts — unresolved short link; no town identifier in the stored URL.
- Glen Ridge, NJ — https://sdl.town/GlenRidge — unresolved short link. Its unique label SDL Portal (Building Department Portal) is not registered.
- Linwood, NJ — https://sdl.town/Linwood — unresolved short link; no town identifier in the stored URL.
- Saddle River, NJ — https://sdl.town/SaddleRiver — unresolved short link. Its unique label SDL Portal (permit and property information) is not registered.

Other SDL and SDL Portal targets still use those two shared base labels, so these labels remain registered and unsupported URLs fail tenant validation. Application/request/inspection suffixes are not excluded solely because of their labels: the adapter uses the same tenant's public search when available, and throws when that search needs login.

## 6. Known gaps and follow-up

Resolve and verify the 4 sdl.town short links with normal public redirects, then add their tenant identities without assuming town-name spellings. Reclassify New Providence to its actual vendor upstream. Validate the remaining canonical towns individually. Login-only tenants require a municipality-published anonymous source or authorized vendor integration, not automatic sign-in. Contractor/license alerts require public detail normalization and a verified filter strategy; applicant/owner identities must not be substituted for contractor identity. A single date's padded native results can exceed 100 even when the target date itself has fewer than 100 permits; this intentionally produces an explicit incomplete-listing error until a verified server pagination mechanism is found. Public availability varies by tenant; platform capabilities alone do not guarantee tenant access.

Validation: 28 offline tests across both vendors pass with `npx vitest run --configLoader runner --cache=false server/scrapers/permiteyes.test.ts server/scrapers/sdl-portal.test.ts`. Default Vitest config bundling encounters EROFS in the read-only shared node_modules/.vite-temp; the runner flag uses the same repository config without that temporary write. `npx tsc --noEmit -p .` passes. All fixture tests run without network; no DB or application server was started.

Fixture provenance: fixtures/sdl-portal/provenance.json records exact adapter URLs, timestamps, status, and response hashes. Initial *.html survey files are public GET /search pages or /search2 results for their named tenants. search.js is /static/js/search.js. hazlet-main.html uses st=permits, as=1, loc=Main, limit=100, stps=all, stpd=all, psd=0, ped=0; hazlet-middle.html changes loc to Middle; hazlet-recent.html sets stpd=last7. sample-detail.html is the first Hazlet recent record's sourceUrl. Boundary fixtures use psd/ped Unix timestamps for the dates in their filenames (midnight UTC, or the explicitly named noon/04:00 UTC variants). Empty 302 response bodies for blocked endpoints are preserved as empty fixture files, with their status documented here.
