1. Platform & mechanism

Standalone, anonymous HTTP adapter for classic Accela Citizen Access. No database, login, browser launch, API key, CAPTCHA bypass, or record-creating form submission. It uses politeFetch with the ConstructHUB User-Agent, at least 1,000 ms between request starts per host, the shared helper's backoff for blocked responses, a fresh cookie jar per operation, and live WebForms ViewState/event validation/CSRF fields.

Hosts include aca-prod.accela.com, aca-oregon.accela.com, aca.accela.com and dedicated ACA hosts. Accepted paths are /<agency>/, Default.aspx, Welcome.aspx, Login.aspx, customization/common/home.aspx, and Cap/CapHome.aspx. The tenant comes from ctx.searchUrl. HTTP inputs are upgraded to HTTPS. accelaSearchUrl discovers a same-agency Building/Permits/Development Services link; explicit stored CapHome modules are preserved, including CeresBuilding and DevServices. Inspection-only query flags are removed. Searches and paging post to Cap/CapHome.aspx; detail follows the actual public Cap/CapDetail.aspx link. No guessed record URLs.

Every navigation and record link is checked with assertAccelaAgency. Dedicated hosts that use an application path such as CitizenAccess bind the actual agency from their same-application CustomizedCssStyle.ashx?agencyCode=... link, then check both the application path and verified agency. Shared Oregon /oregon/ pages are not treated as a specific county. Their cross-agency records are rejected.

The exported legacy pure helpers are reused. The storage-backed scrapeAccela function is never called. Raw records preserve the original response row HTML, or the complete detail HTML, without reserializing it. Recorded fixtures are complete HTTP response bodies compressed losslessly with gzip; sources.json gives request URL, method, HTTP status, UTC capture time, query, and SHA-256 of the uncompressed body. No government records were invented.

2. Capabilities

Search: address, permit number, company/business name, professional license number, professional last name, and project-name keyword, where the tenant exposes the corresponding public field. Company/license/name use Search by Licensed Professional when offered, follow the resulting license-to-permit association, and deduplicate permits. General Search professional fields are used on tenants without that selector. Multiple matching license rows are supported within the same ten-result-page budget. Queries with additional license-list pages fail explicitly and ask for a narrower query.

listRecent: yes on tenants with General Search Start Date / End Date (txtGSStartDate / txtGSEndDate). It submits the requested start calendar date and current UTC calendar date to the portal's record/application-date search. It does not search guessed permit numbers. This is not an issuance-only feed. The generic grid heading Date is ambiguous, so it is not copied to issuedAt or appliedAt. Explicitly labeled application, issuance, and expiration dates are normalized to ISO; unreported dates stay null. ISO timestamps are reduced to calendar dates because the portal provides date-only controls.

Boulder County exposes no date fields: listRecent returns [] and sets capabilities.listRecent=false, as requested. A subsequent supported date call sets it true. The contract's capability flag is shared at adapter level, not keyed by tenant; see section 6 before wiring capability-based polling across different tenants.

Detail: yes, with exact record-number confirmation, public source URL, contractor names/licenses, applicant/owner, description, explicit dates and valuation where present. Missing fields stay null. Redacted email placeholders and navigation labels are not contractor names.

Paging follows the live Next postback and new ViewState, capped at ten result pages across an operation. The three live tenants used ten rows per page, rather than the assignment's assumed twenty. The code does not assume a fixed page size. Repeated pages, explicit too-many-results messages, unrecognized responses and an unfinished tenth page throw; partial records are not returned as a successful search. HTTP 401/403/429 and CAPTCHA/access challenges are surfaced as PortalBlockedError.

3. Live tests

All times below are UTC on 2026-10-10. The required seven-day checks submitted 2026-10-03 through 2026-10-10. “Error” is not zero results. For a page-limit failure, the displayed samples are observed partial records, not a returned complete dataset. For a one-record result there is only one real sample. Additional discovery probes follow the three full tenant suites.

Tampa, FL

Portal: https://aca-prod.accela.com/TAMPA/Default.aspx

- Query: company = "ACTION AIRCONDITIONING INC". Started 2026-10-10T17:50:22.608Z; 13475 ms; 14 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela search exceeds 10 pages; narrow the search or date window
  Observed before stopping: 100 distinct permit records across 10 result pages. Partial samples:
  {"permitNumber":"BTR-27-0633104","address":"2917 W Main St T 33607","status":"Issued","issuedAt":null,"contractorName":null}
  {"permitNumber":"BTR-27-0633031","address":"3503 W Corona St T 33629","status":"Issued","issuedAt":null,"contractorName":null}
- Query: address = "2917 W Main St". Started 2026-10-10T17:54:26.267Z; 2799 ms; 3 HTTP requests; statuses 200.
  Count: 4.
  Sample: {"permitNumber":"BTR-27-0633104","address":"2917 W Main St T 33607","status":"Issued","issuedAt":null,"contractorName":null}
  Sample: {"permitNumber":"BTR-20-0506031","address":"2917 W Main St T 33607","status":"Complete","issuedAt":null,"contractorName":null}
- Query: detail = "BTR-27-0633104". Started 2026-10-10T17:54:47.390Z; 4719 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"BTR-27-0633104","address":"2917 W Main St, T, 33607","status":"Issued","issuedAt":null,"contractorName":"DAVID Car RUSSELL / ACTION AIRCONDITIONING INC"}
- Query: recent = "2026-10-03". Started 2026-10-10T17:58:09.201Z; 11548 ms; 12 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela search exceeds 10 pages; narrow the search or date window
  Observed before stopping: 100 distinct permit records across 10 result pages. Partial samples:
  {"permitNumber":"BLD-27-0528700","address":"2342 W Chestnut St T 33607","status":"In Process","issuedAt":null,"contractorName":null}
  {"permitNumber":"BLDLP-27-000298","address":null,"status":"Complete","issuedAt":null,"contractorName":null}
- Query: recent = "2026-10-10". Started 2026-10-10T17:59:41.139Z; 2567 ms; 3 HTTP requests; statuses 200.
  Count: 8.
  Sample: {"permitNumber":"BLD-27-0528700","address":"2342 W Chestnut St T 33607","status":"In Process","issuedAt":null,"contractorName":null}
  Sample: {"permitNumber":"BLDLP-27-000298","address":null,"status":"Complete","issuedAt":null,"contractorName":null}
- Query: permit = "BTR-27-0633104". Started 2026-10-10T18:00:50.546Z; 4426 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"BTR-27-0633104","address":"2917 W Main St, T, 33607","status":"Issued","issuedAt":null,"contractorName":"DAVID Car RUSSELL / ACTION AIRCONDITIONING INC"}
- Query: license = "CAC042730". Started 2026-10-10T18:00:55.606Z; 3335 ms; 4 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela matched too many licensed professionals; refine the business name or license number
  Samples: none returned.

Sacramento, CA

Portal: https://aca-prod.accela.com/SACRAMENTO/Default.aspx

- Query: detail = "W8061". Started 2026-10-10T17:51:16.921Z; 3713 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"W8061","address":"100 MAIN AVE","status":"Closed","issuedAt":null,"contractorName":null}
- Query: recent = "2026-10-03". Started 2026-10-10T17:51:52.348Z; 11994 ms; 12 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela search exceeds 10 pages; narrow the search or date window
  Observed before stopping: 100 distinct permit records across 10 result pages. Partial samples:
  {"permitNumber":"RES-2622712","address":"6460 OAKRIDGE WAY, SACRAMENTO CA 95831","status":"Applied","issuedAt":null,"contractorName":null}
  {"permitNumber":"SIG-2622714","address":"5318 STOCKTON BLVD, SACRAMENTO CA 95820","status":"Plan Check Target","issuedAt":null,"contractorName":null}
- Query: recent = "2026-10-10". Started 2026-10-10T17:52:17.630Z; 2651 ms; 3 HTTP requests; statuses 200.
  Count: 6.
  Sample: {"permitNumber":"RES-2622712","address":"6460 OAKRIDGE WAY, SACRAMENTO CA 95831","status":"Applied","issuedAt":null,"contractorName":null}
  Sample: {"permitNumber":"SIG-2622714","address":"5318 STOCKTON BLVD, SACRAMENTO CA 95820","status":"Plan Check Target","issuedAt":null,"contractorName":null}
- Query: detail = "RES-2622712". Started 2026-10-10T17:53:14.756Z; 4599 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"RES-2622712","address":"6460 OAKRIDGE WAY","status":"Applied","issuedAt":null,"contractorName":"ME AND CEE INC"}
- Query: company = "ME AND CEE INC". Started 2026-10-10T17:53:43.843Z; 4702 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"RES-2622712","address":"6460 OAKRIDGE WAY","status":"Applied","issuedAt":null,"contractorName":"ME AND CEE INC"}
- Query: address = "100 Main". Started 2026-10-10T17:59:05.889Z; 2375 ms; 3 HTTP requests; statuses 200.
  Count: 2.
  Sample: {"permitNumber":"W8061","address":"100 MAIN AVE, SACRAMENTO CA","status":"Closed","issuedAt":null,"contractorName":null}
  Sample: {"permitNumber":"K4628","address":"100 MAIN AVE, SACRAMENTO CA","status":"Finaled","issuedAt":null,"contractorName":null}
- Query: permit = "W8061". Started 2026-10-10T18:00:46.375Z; 3534 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"W8061","address":"100 MAIN AVE","status":"Closed","issuedAt":null,"contractorName":null}

Lane County, OR

Portal: https://aca-oregon.accela.com/LANE_CO/Default.aspx

- Query: company = "RENEWABLE ELECTRIC LLC". Started 2026-10-10T17:51:53.469Z; 7935 ms; 8 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":"RENEWABLE ELECTRIC LLC"}
- Query: address = "89817 Territorial". Started 2026-10-10T17:52:18.766Z; 4727 ms; 5 HTTP requests; statuses 200.
  Count: 23.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY, Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":null}
  Sample: {"permitNumber":"509-BP26-02656","address":"89817 TERRITORIAL HWY, Elmira OR 97437","status":"Issued","issuedAt":null,"contractorName":null}
- Query: license = "C1229". Started 2026-10-10T17:53:45.006Z; 6124 ms; 6 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":"RENEWABLE ELECTRIC LLC"}
- Query: address = "100 Main". Started 2026-10-10T17:54:27.418Z; 2628 ms; 3 HTTP requests; statuses 200.
  Count: 0.
  Explicit no-records response. No samples.
- Query: recent = "2026-10-03". Started 2026-10-10T17:56:53.046Z; 12093 ms; 12 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela search exceeds 10 pages; narrow the search or date window
  Observed before stopping: 100 distinct permit records across 10 result pages. Partial samples:
  {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY, Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":null}
  {"permitNumber":"26TMP-003120","address":null,"status":null,"issuedAt":null,"contractorName":null}
- Query: detail = "509-BP26-02727". Started 2026-10-10T17:58:10.355Z; 5129 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":"RENEWABLE ELECTRIC LLC"}
- Query: permit = "509-BP26-02727". Started 2026-10-10T18:01:58.500Z; 4105 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":"RENEWABLE ELECTRIC LLC"}
- Query: recent = "2026-10-10". Started 2026-10-10T18:02:03.315Z; 3967 ms; 4 HTTP requests; statuses 200, 302.
  Count: 1.
  Sample: {"permitNumber":"509-BP26-02727","address":"89817 TERRITORIAL HWY Elmira OR 97437","status":"Application Submitted","issuedAt":null,"contractorName":"RENEWABLE ELECTRIC LLC"}

Linn County, OR

Portal: https://aca-oregon.accela.com/oregon/Default.aspx

- Query: recent = "2026-10-03". Started 2026-10-10T17:54:48.579Z; 3059 ms; 3 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela redirected outside the configured agency: https://aca-oregon.accela.com/oregon/Cap/CapDetail.aspx
  Samples: none returned.
- Query: address = "100 Main". Started 2026-10-10T17:59:42.248Z; 2991 ms; 3 HTTP requests; statuses 200.
  Result: error, no complete dataset returned. Accela redirected outside the configured agency: https://aca-oregon.accela.com/oregon/Cap/CapDetail.aspx
  Samples: none returned.

Cobb County, GA

Portal: https://cobbca.cobbcounty.gov/CitizenAccess/Default.aspx

- Query: address = "100 Main". Started 2026-10-10T17:53:15.852Z; 2127 ms; 3 HTTP requests; statuses 200, 302.
  Result: error, no complete dataset returned. Accela public search unavailable (login required or invalid module)
  Samples: none returned.

Boulder County, CO

Portal: https://aca-prod.accela.com/BOCO/Cap/CapHome.aspx?module=Building&TabName=Home

- Query: recent = "2026-10-03". Started 2026-10-10T17:56:52.095Z; 295 ms; 1 HTTP requests; statuses 200.
  Count: 0.
  No date-list capability; no permit search was submitted. No samples.

4. Blocked / failed tenants

Tampa, Sacramento, and Lane County: the seven-day date query exceeded the ten-page limit. Each yielded 100 distinct records on ten observed pages with more pages still available, so the adapter threw. Today-only date searches completed with 8, 6, and 1 records respectively. Tampa's tested company also exceeded the permit-page limit. The exact license CAC042730 produced 100+ historical licensed-professional matches before permit traversal and was rejected as too broad. These results were not silently truncated.

Linn County's stored /oregon/ URL returned statewide records from other agencies. The response was HTTP 200, but source record URLs carried agencyCode values different from oregon. The adapter rejected both address and recent results rather than label unrelated records as Linn County permits. The same target URL pattern occurs in 49 entries. Jurisdiction-specific portal URLs are needed.

Cobb County: the Building search GET returned HTTP 302 to Login.aspx, followed by HTTP 200 containing the login page. The adapter stopped with public search unavailable. It did not log in. The actual agency declaration COBBCO was observed on the public landing page.

Boulder County: HTTP 200, public General Search but no Start Date / End Date fields; date listing is unsupported, not an empty date search.

No HTTP 401, 403, 429, Cloudflare CAPTCHA, or Incapsula challenge was observed in these six live tenant probes. Typed blocked-error propagation is covered offline. No blocked challenge was bypassed, and no proxy was used.

5. Coverage

239 / 255 targets have a recognized classic ACA URL shape. Of those, 49 are the shared Oregon aggregate and 190 have potentially agency-specific application paths. These are URL-shape counts, not a claim that all tenants were live-verified. Three tenants were tested with address, permit, contractor and date queries; contractor queries completed on two and reached limits on Tampa. Six tenants were probed in total.

28 distinct platform labels are registered, including the primary platform Accela. Registration routes a label to strict URL validation; it does not make an unsupported city-information page or statewide aggregate scrapeable.

Registered labels:

- Accela
- Oregon ePermitting
- Accela Citizen Access
- Accela (BASS)
- Accela Citizen Access (CPPL Portal)
- Accela (ELM)
- Accela (CAGIS ezTrak)
- Accela (eConnect)
- Accela Citizen Access (Online Permit Center)
- Accela (PascoGateway)
- Accela (EZ Online Permitting)
- Aurora4Biz (Accela Citizen Access)
- Accela Citizen Access (E-Permits)
- Accela (DallasNow)
- Accela (Cabarrus County ACA, Harrisburg module)
- Accela (SimpliCITY)
- Accela Citizen Access (Building)
- Accela Citizen Access (city link)
- Oregon ePermitting (Accela)
- Accela (HillsGovHub)
- Accela (Oregon ePermitting)
- Accela (Develop901)
- Oregon ePermitting (Accela) — state BCD is the building department
- Accela Citizen Access (Ceres Building module)
- Accela (eBUILD) (independent city)
- Accela Citizen Access (OpenHillsboro Permit Portal)
- Accela Citizen Access (Cabarrus County central permitting, covers Kannapolis)
- Accela Citizen Access (Online Building Permit Portal)

The 16 rejected URL-shape entries are:
- Aurora, CO: https://www.auroragov.org/business_services/aurora4biz — City information page, not an ACA application URL.
- Pinehurst, NC: https://www.vopnc.org/our-government/departments/planning-inspections/planning — City information page, not an ACA application URL.
- Umatilla County, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Adams, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Athena, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Echo, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Fort Bragg, CA: https://ftbragg-prod.accela.com/portal/core/index — New Accela public-portal application, not classic WebForms ACA.
- Helix, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Hermosa Beach, CA: https://hermosabeach-prod.accela.com/portal/core/index — New Accela public-portal application, not classic WebForms ACA.
- Jurupa Valley, CA: https://jurupa-prod-publicportal.accela.com/core/index — New Accela public-portal application, not classic WebForms ACA.
- Milton Freewater, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Norfolk, MA: https://elicensing21.mass.gov/CitizenAccess/GeneralProperty/PropertyLookUp.aspx?isLicensee=Y — State licensing/property lookup, not a municipal permit search URL.
- Pilot Rock, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Stanfield, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Ukiah, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.
- Weston, OR: http://www.buildingpermits.oregon.gov/ — State entry link without an ACA agency path; requires a verified jurisdiction-specific URL.

The 49 shared Oregon entries requiring agency-specific URLs are: Linn County, OR; Redmond, OR; Jefferson County, OR; Milwaukie, OR; Dallas, OR; Monmouth, OR; Independence, OR; Sweet Home, OR; North Bend, OR; Hood River, OR; Harney County, OR; Warrenton, OR; Philomath, OR; Reedsport, OR; Oakridge, OR; Gearhart, OR; Lakeside, OR; Clatskanie, OR; Cannon Beach, OR; Aurora, OR; Benton County, OR; Clatsop County, OR; Columbia County, OR; Coos County, OR; Crook County, OR; Curry County, OR; Deschutes County, OR; Hood River County, OR; Jackson County, OR; Klamath County, OR; Lincoln County, OR; Malheur County, OR; Polk County, OR; Tillamook County, OR; Wasco County, OR; Yamhill County, OR; Astoria, OR; Central Point, OR; Coos Bay, OR; Fairview, OR; Forest Grove, OR; Mcminnville, OR; Newport, OR; Ontario, OR; Sandy, OR; Seaside, OR; Sherwood, OR; West Linn, OR; Woodburn, OR.

6. Known gaps and follow-up

- High-volume date ranges and large contractors need narrower date windows or a deliberate bounded date-partition strategy. Current behavior is an explicit error at the ten-page cap, including the required seven-day runs. There is no silent partial success and no number-search fallback.
- The shared capability flag cannot express per-tenant support. Under the requested contract, probing Boulder County sets the exported adapter's listRecent flag false until a supported date listing is invoked. A poller that globally skips the platform when this flag becomes false could skip date-capable tenants. The registry/poller owner should add per-database capability state or isolate capability probes; those files are outside this assignment's allowed edits.
- Oregon's 49 aggregate URLs need verified agency-specific replacements before records can safely be attributed to each listed city/county. No agency codes were guessed from jurisdiction names. The 10 Oregon state-entry links also need verified portal targets.
- New Accela /core/index portals require a separate adapter. City-information and licensing-lookup URLs need source correction. Cobb County requires an auth-free public search endpoint, if one exists.
- Name search means licensed professional last name; keyword means project name. Hidden tenant fields are not replaced by unrelated broad searches. Additional license-result pages require a narrower name or exact license.
- Only the stored/discovered permit module is searched. Explicit CeresBuilding, DevServices, Permits and similar modules are retained to avoid silently switching jurisdictions on a shared portal.
- Application-date listing does not guarantee alerts for an older application that is issued later. The portal's generic Date column remains unclassified. Issue-date/updated-date feeds and status-change monitoring need separate verified semantics.
- Detail searches require an exact match on the initial result page and a public detail link. Older installations exposing only JavaScript record links or nonstandard controls may need a browser fallback. No fallback attempts to solve CAPTCHA or authenticate.

Validation: 27 offline tests passed with npx vitest run server/scrapers/accela.test.ts --configLoader runner. The default config loader failed before tests with EROFS when trying to write node_modules/.vite-temp; runner mode uses the existing repository config without that write. npx tsc --noEmit -p . passed. The fixtures include full successful, empty, paginated, login-wall and cross-agency responses; no synthetic government fixtures.

Commits are on permits/adapter-accela. The initial address/permit implementation was committed as ca17e548. No push was performed. The final commit includes this report, tests, fixtures and the completed adapter.

