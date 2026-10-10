# EnerGov adapter report — 2026-10-10

## 1. Platform & mechanism

Implemented `server/scrapers/energov.ts` without calling storage-backed scrapers. It imports and reuses `enerGovApplicationUrl`, `enerGovSearchRequest`, `enerGovPageRequest`, `parseEnerGovResponse`, `assertEnerGovTenant`, and `parseEnerGovDetail`. No database, login, or browser is required by the adapter.

Direct URL shapes: any HTTP(S) host with `/.../selfservice[/tenant]`, or `/.../civic-access-public[/home]` with the sibling SelfService API still present. The latter was verified on Bloomington. Redirect discovery reads HTTP Location headers, meta refresh, literal location assignments, or a single published SelfService link. It never guesses municipal hosts. Multiple application links and ambiguous multi-tenant roots throw. A matching URL shape is not a guarantee of live service.

Auth-free JSON endpoints, relative to the derived SelfService application:

- GET `/api/Home/GetTenants` selects the tenant by URL suffix, or requires a single returned tenant. Tenant ID, name, URL, and culture come from that response.
- GET `/api/energov/search/criteria` supplies the complete version-specific request template. The adapter uses the UI’s `none` permit selectors and an advertised permit-number sort.
- POST `/api/energov/search/search` executes advanced address/permit/date searches or a permit-only keyword search. Pages are fetched sequentially; repeated, changing, missing, or over-100-page results throw without returning partial data.
- POST `/api/energov/permits/permitdetail` uses `{EntityId, ModuleId:1}` after exact permit-number resolution.
- POST `/api/energov/entity/contacts/search/search` pages public contacts and verifies each record ID/module before adding contractor, applicant, or owner names.

Civic Access source links use the observed `/civic-access-public/details/permit/:id` route; classic CSS source links retain `#/permit/:id`. The newer route was verified from Bloomington’s published route bundles.

Every request uses `politeFetch`, the ConstructHUB User-Agent/contact URL, and at least 1,000 ms between requests per host (or the higher context delay). HTTP 401/403/429 and recognized challenge responses become `PortalBlockedError`. Private contacts are not bypassed; detail fails explicitly if access is denied. Search rows remain untouched in `raw`; detail retains original search JSON, detail envelope, and contact response envelopes. Unknown fields are null.

## 2. Capabilities

- Search: **address, permit, keyword**. Keyword searches are the public permit index, not a contractor/person index.
- `listRecent`: **yes**, union of `PermitCriteria.IssueDateFrom/IssueDateTo` and `ApplyDateFrom/ApplyDateTo`, deduplicated by case ID. This is actual date filtering, not brute-force permit searches. Calendar-day inclusive bounds deliberately overlap the day containing `since`; local timestamps are returned as YYYY-MM-DD, and offset-bearing detail timestamps as full ISO. Callers should deduplicate hourly polls.
- Detail: **yes**, with public contacts, type, work class, dates, parcel, description, status, and visible valuation. Contractor licenses are null because no verified permit license-number field was found; free-text contact `Title` is not relabeled as a license.
- Company, name, license permit searches: **unsupported and throw**, not silent empty results. This is an unfulfilled part of the requested scope. Discovery found real license search criteria but no reliable public permit relationship. Details and evidence appear below.

## 3. Live tests

All tests ran on 2026-10-10 UTC with the honest bot User-Agent. Times below are measured elapsed seconds; the supplied harness rounds whole-second timings. Primary recent window: 2026-10-03 through 2026-10-10, inclusive. No test logged in or created a record.

### Bloomington, IN

Stored URL: https://energov.bloomington.in.gov/energov_prod/civic-access-public

| Mode / query | Count | Seconds |
|---|---:|---:|
| search address: `1004 S Madison` | 2 | 2 |
| search permit: `BHQA2025-0005` | 1 | 2.63 |
| recent issued OR applied: `2026-10-03` | 51 | 3.273 |
| detail: `CZC2026-08-0304` | 1 | 4 |

Address-search samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| BHQA2025-0005 | 1004 S Madison ST Bloomington IN 47403 | Complete | 2025-04-15 | null |
| rentpro_1363 | 1004 S Madison ST Bloomington IN 47403 | Issued | 2023-10-09 | null |

Recent samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CZC2026-08-0304 | 2106 E Wimbleton LN Bloomington IN 47401 | Complete | 2026-10-08 | null |
| CZC2026-09-0352 | 414 S College AVE Bloomington IN 47403 | Complete | 2026-10-07 | null |

Exact permit search returns one record, so there is no second sample:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| BHQA2025-0005 | 1004 S Madison ST Bloomington IN 47403 | Complete | 2025-04-15 | null |

Detail sample (one requested record):

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CZC2026-08-0304 | 2106 E Wimbleton LN   Bloomington, IN 47401 | Complete | 2026-10-08T19:31:50.000Z | null |

Company/name/license search is not advertised. The final adapter rejects these types before network access. It does not report zero permits for an unsupported filter.

### Kansas City, MO

Stored URL: https://compasskc.kcmo.org/EnerGov_Prod/SelfService#/home

| Mode / query | Count | Seconds |
|---|---:|---:|
| search address: `1008 E 44th` | 12 | 7 |
| search permit: `CICO-2026-01008` | 1 | 6.52 |
| recent issued OR applied: `2026-10-03` | 1260 | 162 |
| detail: `CICO-2026-01008` | 1 | 8 |

Address-search samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CD-STR-00423 | 1008 E 44th St Kansas City MO 64110 | Voided-City | null | null |
| CD-STR-00426 | 1008 E 44th St Kansas City MO 64110 | Expired | 2021-10-12 | null |

Recent samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CICO-2026-01008 | 1360 Main St Kansas City MO 64105 | Issued | 2026-10-05 | null |
| CICO-2026-01009 | 201 Grand Blvd Kansas City MO 64106 | Issued | 2026-10-05 | null |

Exact permit search returns one record, so there is no second sample:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CICO-2026-01008 | 1360 Main St Kansas City MO 64105 | Issued | 2026-10-05 | null |

Detail sample (one requested record):

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| CICO-2026-01008 | 1360 Main St   Kansas City, MO 64105 | Issued | 2026-10-05T13:50:19.000Z | null |

Company/name/license search is not advertised. The final adapter rejects these types before network access. It does not report zero permits for an unsupported filter.

### Taylorsville, UT

Stored URL: https://portal.taylorsvilleut.gov/EnerGov_Prod/selfservice

| Mode / query | Count | Seconds |
|---|---:|---:|
| search address: `4800 S 1000` | 2 | 3 |
| search permit: `ELEC-310493-2026` | 1 | 3.43 |
| recent issued OR applied: `2026-10-03` | 61 | 5 |
| detail: `ELEC-310493-2026` | 1 | 5 |

Address-search samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| 601071 |  4800 S 1000 W RD UT | Under Review | 1998-06-25 | null |
| 601503 |  4800 S 1000 W RD UT | Complete | 1999-03-23 | null |

Recent samples:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| ELEC-310493-2026 | 4126 S DAVENCREST LN Taylorsville UT 84129 | Issued | 2026-10-06 | null |
| ELEC-310547-2026 | 4773 S Simper Ln. SIMPER LANE TAYLORSVILLE UT 84129 | Issued | 2026-10-07 | null |

Exact permit search returns one record, so there is no second sample:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| ELEC-310493-2026 | 4126 S DAVENCREST LN Taylorsville UT 84129 | Issued | 2026-10-06 | null |

Detail sample (one requested record):

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| ELEC-310493-2026 | 4126 S DAVENCREST LN   Taylorsville, UT 84129 | Issued | 2026-10-06T15:17:58.000Z | David C Butler / Precision Air Management LLC |

Company/name/license search is not advertised. The final adapter rejects these types before network access. It does not report zero permits for an unsupported filter.

### Overland Park, KS

Stored URL: https://energov.opkansas.org/energov_prod/selfservice#/applicationAssistant?sectionName=All&showTemplates=false/

search address 8500: 1121 records, 24.462 seconds.

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| BLD-C-2017-02157 | 8500 SANTA FE DR   Overland Park KS 66212 | Void | null | null |
| BLD-C-2017-02395 | 8500 W 110TH ST   680 Overland Park KS 66210 | Complete/Finaled | 2017-12-13 | null |

search permit BLD-C-2017-02395: 1 records, 2.241 seconds.

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| BLD-C-2017-02395 | 8500 W 110TH ST   680 Overland Park KS 66210 | Complete/Finaled | 2017-12-13 | null |

recent 2026-10-03: 311 records, 10.31 seconds.

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| BLD-C-2026-00203 | 11006 W 120TH ST Overland Park KS 66213 | Issued | 2026-10-06 | null |
| BLD-C-2026-00229 | 11540 NALL AVE   Overland Park KS 66211 | Issued | 2026-10-05 | null |

The first browser bootstrap returned HTTP 200 with `Success:false` and an ErrorId. Incomplete direct payloads also returned 500. The final adapter with initialized selectors and sort succeeded; this tenant is not classified as persistently blocked. Address search completed all 23 pages (1,121 records).

### Landing-page checks

| Jurisdiction | Stored URL | Query | Count | Seconds |
|---|---|---|---:|---:|
| Larimer County, CO | https://onlineportal.larimer.org/ | address `100 Main St` | 0 | 4.344 |
| Carlsbad, CA | https://eg.carlsbadca.gov/ | address `100 Main St` | 0 | 12.764 |
| Eagle County, CO | https://css.eaglecounty.us/ | address `100 Main St` | 1 | 4.048 |
| Seguin, TX | https://eportal.seguintexas.gov/ | address `100 Main St` | 0 | 4.184 |

No records exist to sample for successful zero-result checks. Eagle County sample:

| permitNumber | address | status | issuedAt | contractorName |
|---|---|---|---|---|
| RES-4-18-18964 | 100 MAIN ST FULFORDAREA | Expired | 2018-05-07 | null |

### Company/license discovery — not shipped as a permit capability

The live CSS template exposes `LicenseCriteria.CompanyName`, `LicenseCriteria.LicenseNumber`, and `PermitCriteria.ContactId`. A full license request needs all six UI defaults: LicenseTypeId, LicenseClassId, LicenseStatusId, BusinessStatusId, CompanyTypeId, BusinessTypeId = `none`. Omitting BusinessStatusId caused HTTP 500; setting it returned real license records. This is evidence about the license directory, not permit-search support.

- Bloomington, company-license query `construction`: 1 license, `BL2026-000042`, White Oak Construction, status Issued, IssueDate 2026-08-21. License detail and public contacts worked; an exact license-number query also resolved that license.
- Taylorsville, company-license query `construction`: the first returned license was `GEN-30221-2020`, KEHL BROTHERS CONSTRUCTION, LLC, status Void, IssueDate 2020-07-31. Public license contacts identified its holder.
- Setting PermitCriteria.ContactId to the returned holder ID did **not** constrain permits: Bloomington advertised 18,078 records and Taylorsville 31,003. Only the first page was inspected. The adapter never ships this as contractor filtering.
- Direct `/search/searchcontact/` probes returned HTTP 500; `/permits/search/criteria` returned a semantic 404 on Taylorsville. No authentication was attempted.
- Taylorsville keyword `Precision Air Management` with ExactMatch=false returned 142 generic permit-index matches in 6 seconds, but did not include the known permit `ELEC-310493-2026`. A sampled match, `MECH-300033-2020`, actually named Superior Water and Air as contractor. ExactMatch=true returned 0 in 3.239 seconds. The known permit detail names `David C Butler / Precision Air Management LLC`. Thus public keyword matches cannot honestly be advertised as contractor search.
- Bloomington keyword `Dishman Construction LLC` returned 382 generic matches in 10 seconds. The inspected `CZC2026-08-0304` detail lists Dishman Construction LLC as Applicant, not Contractor. The adapter preserves that distinction.
- A prototype license-to-holder-to-keyword lookup for `BL2026-000042` reached an empty keyword response in 4.174 seconds; it was removed because absence from that index cannot establish absence of permits.

## 4. Blocked / failed tenants and other Tyler products

Centennial, CO: `https://cityofcentennialco-energovweb.tylerhost.net/apps/selfservice`. Address `100 Main St` failed at `/api/Home/GetTenants`: HTTP 403, three requests with the shared helper’s 5-second and 10-second backoff, 15.423 seconds total. Body is plain “403 Forbidden”; no vendor-specific challenge was identifiable. No permit count is claimed. Initial landing GET also returned 403.

Berkeley County, SC: `https://build.berkeleycountysc.gov/` returned HTTP 403 during the landing survey. No challenge bypass or further discovery was attempted. Its unique builders-portal label is not registered.

The separate-product survey inspected two tenants per product family. “Searchable” below means a public search form was observed; these forms were not implemented or submitted as adapters.

| Family | Jurisdiction | URL | HTTP | Searchable observation |
|---|---|---|---:|---|
| eSuite | Lawrence, IN | https://cityoflawrencein.nwerp.tylerapp.com/nwprod/eSuite.permits/ | 200 | Yes: public permit type, permit number, service address. |
| eSuite | Apex, NC | https://secure.apexnc.org/eSuite.Permits/WelcomePage.aspx | 200 | Yes: public permit type, permit number, service address; page explicitly says registration is unnecessary. |
| Munis | Wilmette, IL | https://wilmette.munisselfservice.com/css/citizens/PermitsInspections/Default.aspx | 200 | Yes: application reference and location form after accepting ordinary session cookies. Application reference is not the permit number. |
| Munis | Vanderburgh County, IN | https://cityofevansvillein.munisselfservice.com/css/citizens/PermitsInspections/Default.aspx | 200 | Yes: house number, street, parcel, application reference after ordinary session cookies. |
| Eden | Bonney Lake, WA | https://web.ci.bonney-lake.wa.us/Default.aspx?Build=PM.pmPermit.SearchForm&utask=normalview | 200 | Yes: public Permits Inquiry form; permit number, applicant, application/issue date and address fields. |
| Eden | Tumwater, WA | https://web.ci.tumwater.wa.us/eden/Default.aspx?Build=PM.pmPermit.SearchForm&utask=normalview | 200 | Yes: public Permits Inquiry form with permit number, applicant, application/issue date and address fields. |
| New World | Bowling Green, KY | https://esuites.bgky.org/eSuite.permits/WelcomePage.aspx | 200 | No public search form observed; contractor login only. |
| New World | Huntley, IL | https://huntleyil.nwerp.tylerapp.com/nwprod/esuite.permits/ | 200 | Yes: limited public permit-number/service-address search; page says fuller information requires FOIA. |

Munis initially redirected to an Upgrade.aspx JavaScript/cookie check when cookies were not retained. A normal cookie jar exposed the public search forms; this was not a login or challenge bypass. None of eSuite, Munis, Eden, New World, Municipal Online, or Portico is registered by this adapter.

## 5. Coverage

**360 / 404 stored entries have a supported direct shape or a live-verified redirect to one**: 356 direct (351 SelfService, 5 Civic Access), plus four root redirects. This is URL/mechanism coverage, not a claim that all 360 portals were tested or accessible. There are 78 distinct registered labels (77 aliases plus Tyler EnerGov). Tenant-specific availability and API version still determine success.

Registered labels (exact targets.json spellings; lookup is case-insensitive):

- Civic Access (Tyler EnerGov Self Service)
- EnerGov
- EnerGov (CompassKC)
- EnerGov (Tyler CSS)
- EnerGov (Tyler Civic Access)
- EnerGov (Wake County)
- EnerGov (eTrac Savannah)
- EnerGov CSS
- EnerGov CSS (APEX) (independent city)
- EnerGov CSS (PORT)
- EnerGov CSS (independent city)
- EnerGov Self Service
- PermitSLO (Tyler EnerGov Self Service)
- Tyler Civic Access (EnerGov)
- Tyler EnerGov
- Tyler EnerGov (APEX)
- Tyler EnerGov (Citizen Access Portal)
- Tyler EnerGov (Citizen Self Service)
- Tyler EnerGov (Citizen Self-Service)
- Tyler EnerGov (Civic Access / CSS)
- Tyler EnerGov (Civic Access / Citizens Self Service)
- Tyler EnerGov (Civic Access / Fairfield BUILD)
- Tyler EnerGov (Civic Access)
- Tyler EnerGov (Customer Self Service)
- Tyler EnerGov (Development Hub / Self Service)
- Tyler EnerGov (EPIC)
- Tyler EnerGov (LCAP)
- Tyler EnerGov (LPP portal)
- Tyler EnerGov (LandMARC)
- Tyler EnerGov (MAPPS)
- Tyler EnerGov (New Hanover County COAST; county issues building permits within the city)
- Tyler EnerGov (OneStop Shop)
- Tyler EnerGov (PLUS)
- Tyler EnerGov (Park City Portal)
- Tyler EnerGov (PermitMidland CSS)
- Tyler EnerGov (Scottsdale SPUR)
- Tyler EnerGov (Self Service)
- Tyler EnerGov (ePermit Center)
- Tyler EnerGov (ePlace)
- Tyler EnerGov (ePortal)
- Tyler EnerGov (eServices)
- Tyler EnerGov / Civic Access (Citizen Self Service)
- Tyler EnerGov CSS
- Tyler EnerGov Citizen Self Service
- Tyler EnerGov Citizen Self Service (Civic Access)
- Tyler EnerGov Citizen Self-Service
- Tyler EnerGov Civic Access
- Tyler EnerGov Civic Access (E-OneStop)
- Tyler EnerGov Civic Access (Self Service)
- Tyler EnerGov Client Self Service
- Tyler EnerGov Customer Self Service
- Tyler EnerGov Online Permitting Center
- Tyler EnerGov Self Service
- Tyler EnerGov Self Service (Citizen Self Service)
- Tyler EnerGov Self Service (City Access Portal)
- Tyler EnerGov Self Service (Civic Access Portal)
- Tyler EnerGov Self Service (Civic Access)
- Tyler EnerGov Self Service (EDGE)
- Tyler EnerGov Self Service (GO Permit)
- Tyler EnerGov Self Service (HV Works)
- Tyler EnerGov Self Service (Oakley Civic Access Portal)
- Tyler EnerGov Self Service (Oroville Civic Access)
- Tyler EnerGov Self Service (PACO)
- Tyler EnerGov Self Service (Palm Springs Online)
- Tyler EnerGov Self Service (Rancho Cordova Online)
- Tyler EnerGov Self Service (SHOP)
- Tyler EnerGov Self Service (SJ Connect Online)
- Tyler EnerGov Self Service (The HUB)
- Tyler EnerGov Self Service (Ventura OPS)
- Tyler EnerGov Self Service (Virtual Development Services)
- Tyler EnerGov Self Service (Westminster Build)
- Tyler EnerGov Self Service (hosted)
- Tyler EnerGov Self Service (iPermit)
- Tyler EnerGov Self Service (independent city)
- Tyler EnerGov SelfService
- Tyler EnerGov SelfService (Civic Access)
- Tyler EnerGov ePLACE
- Tyler EnerGov self-service

Excluded entries (44). Some share a generic label with supported tenants, but URL validation/discovery prevents treating their other product as CSS:

| Jurisdiction | Stored URL | Reason |
|---|---|---|
| Berkeley County, SC | https://build.berkeleycountysc.gov/ | Landing blocked HTTP 403; underlying application unverified. |
| Lawrence, IN | https://cityoflawrencein.nwerp.tylerapp.com/nwprod/eSuite.permits/ | eSuite / New World; different application and API. |
| Lincoln County, MO | https://ess.tyler-incode.com/lincolncountymo/Account/LogOn | Incode ESS login, not a public permit-search application. |
| Liberty, TX | https://libertytx.municipalonlinepayments.com/libertytx/buildingprojects | Municipal Online Services; different product. |
| Willows, CA | https://cityofwillowsca.municipalonlinepayments.com/cityofwillowsca | Municipal Online Services; different product. |
| Chatham County, GA | https://buildingsafety.chathamcountyga.gov/PermitsInspections/Forms | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Clay County, FL | https://public.claycountygov.com/permitsearch/ | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Lee County, NC | https://www.sanfordnc.net/247/Online-Permits-Plan-Reviews-Inspections | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Apex, NC | https://secure.apexnc.org/eSuite.Permits/WelcomePage.aspx | eSuite / New World; different application and API. |
| Bonney Lake, WA | https://web.ci.bonney-lake.wa.us/Default.aspx?Build=PM.PermitsHome&ClearErrors=Y | Eden inquiry or municipal page; separate adapter needed. |
| Bowling Green, KY | https://esuites.bgky.org/eSuite.permits/WelcomePage.aspx | eSuite / New World; different application and API. |
| Dania Beach, FL | https://cityofdaniabeachfl.nwerp.tylerapp.com/nwprod/eSuite.Permits/ | eSuite / New World; different application and API. |
| Dania, FL | https://cityofdaniabeachfl.nwerp.tylerapp.com/nwprod/eSuite.Permits/ | eSuite / New World; different application and API. |
| Danville, VA | https://onlinepermits.danvilleva.gov/portalprod | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Davie, FL | https://esuite.davie-fl.gov/eSuite.Permits/AdvancedSearchPage/AdvancedSearch.aspx | eSuite / New World; different application and API. |
| Elko, NV | https://logosesuite.elkocitynv.gov/esuite.permits/ | eSuite / New World; different application and API. |
| Grand Forks, ND | https://cityofgrandforksnd.nwerp.tylerapp.com/nwprod/esuite.permits/ | eSuite / New World; different application and API. |
| Huntley, IL | https://huntleyil.nwerp.tylerapp.com/nwprod/esuite.permits/ | eSuite / New World; different application and API. |
| Lafayette, IN | https://selfservice.lafayette.in.gov/mss/default.aspx | Munis / New World citizen services, not EnerGov CSS. |
| Lewisville, TX | https://etools.cityoflewisville.com/esuite.permits/ | eSuite / New World; different application and API. |
| Madison, AL | https://buildportal.madisonal.gov/esuite.permits/ | eSuite / New World; different application and API. |
| Marion, IA | https://esuite-marion-city-ia.tylertech.com/nwprod/eSuite.Permits/WelcomePage.aspx | eSuite / New World; different application and API. |
| Muncie, IN | https://esuite.cityofmuncie.com/eSuite.Permits/ | eSuite / New World; different application and API. |
| St. Charles, MO | https://esuite.stcharlescitymo.gov/esuite.permits/ | eSuite / New World; different application and API. |
| Truckee, CA | https://esuite.townoftruckee.com/esuite.permits/ | eSuite / New World; different application and API. |
| Tumwater, WA | https://web.ci.tumwater.wa.us/eden/Default.aspx?Build=PM.PermitsHome&ClearErrors=Y | Eden inquiry or municipal page; separate adapter needed. |
| Wilmette, IL | https://wilmette.munisselfservice.com/css/citizens/PermitsInspections/Default.aspx | Munis / New World citizen services, not EnerGov CSS. |
| Adams County, ID | https://adamsid-web.tylerhost.net/web/ | Different Tyler web application; CSS path not present or verified. |
| Burke County, NC | https://burkecountync.tylerportico.com/css/citizen-selfservice-bl/pi/dashboard/guest | Portico; not the legacy SelfService API. |
| Clallam County, WA | https://www.clallamcountywa.gov/PermitPortal | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Columbia County, GA | https://columbiacountyga.munisselfservice.com/css | Munis / New World citizen services, not EnerGov CSS. |
| Geauga County, OH | https://geaugacountyoh.nwerp.tylerapp.com/nwprod/eSuite.Permits/WelcomePage.aspx | eSuite / New World; different application and API. |
| Lake County, MT | https://lakecountymt-web.tylerhost.net/web/action/ACTIONGROUP72S1 | Different Tyler web application; CSS path not present or verified. |
| Moore County, NC | https://selfservice.moorecountync.gov/css/citizens/default.aspx | Munis / New World citizen services, not EnerGov CSS. |
| New Hanover County, NC | https://www.nhcgov.com/coast | Municipal information/custom application/redirect not verified as a unique CSS portal in this run. |
| Orleans County, NY | https://orleanscountyny-web.tylerhost.net/web/user/disclaimer | Different Tyler web application; CSS path not present or verified. |
| Sierra County, CA | https://sierraca-web.tylerhost.net/web | Different Tyler web application; CSS path not present or verified. |
| Vanderburgh County, IN | https://cityofevansvillein.munisselfservice.com/css/citizens/PermitsInspections/Default.aspx | Munis / New World citizen services, not EnerGov CSS. |
| Hagerstown, MD | https://mycity.hagerstownmd.org/css/citizens/PermitsInspections | Munis / New World citizen services, not EnerGov CSS. |
| Merced, CA | https://cityofmercedca.tylerportico.com/portal/launcher/ | Portico; not the legacy SelfService API. |
| Nags Head, NC | https://townofnagsheadnc.tylerportico.com/css/citizen-selfservice-bl/pi/dashboard/guest | Portico; not the legacy SelfService API. |
| Port Arthur, TX | https://cityofportarthurtx.tylerportico.com/portal/launcher/ | Portico; not the legacy SelfService API. |
| Tigard, OR | https://cityoftigardor.tylerportico.com/portal/launcher/ | Portico; not the legacy SelfService API. |
| Woodland, CA | https://www.cityofwoodland.gov/1342/Search-for-Permits-and-Inspections | Eden inquiry or municipal page; separate adapter needed. |

## 6. Known gaps and follow-up

- Company/name/license permit search remains unsupported. Implement it only after observing a genuine public contractor criterion or reliable permit relationship; do not reuse ignored ContactId or generic keyword hits as proof.
- List results usually contain no contractor/applicant names. The hourly poller receives date-filtered permits, but contractor-specific alerts need an explicit, separately budgeted detail-enrichment policy. The adapter does not silently fetch thousands of details per poll.
- New Civic Access is supported through a still-present sibling CSS API, not its new frontend API. Portico and installations that remove CSS need a separate implementation.
- Custom application paths without SelfService (for example Danville portalprod), multiple linked portals, and municipal landing pages not covered by the tested discovery forms need follow-up.
- Read-only date searches include the full starting calendar day because search rows do not provide timezone offsets. Results may overlap consecutive hourly polls. No fabricated timezone or intra-day precision is added.
- Paging has a 100-page ceiling and fails on unstable/repeated pages. Kansas City’s seven-day union took 162 seconds; callers need an appropriate timeout or smaller date windows.
- Contact access restrictions cause explicit detail failure. Tenant/header derivation currently requires GetTenants; older deployments without that endpoint need a carefully scoped browser bootstrap fallback.
- 403/CAPTCHA access is a coverage gap, not an empty dataset. No proxy, authentication, CAPTCHA bypass, or application creation was used.

Validation: `npx vitest run server/scrapers/energov.test.ts --configLoader runner` passed 28 offline tests. `npx tsc --noEmit -p .` passed. The exact default Vitest command fails before test loading because shared node_modules/.vite-temp is read-only (EROFS); the supported Vite runner config loader resolves this without changing repository configuration. Tests mock storage and HTTP; no network is used. Fixtures are real fetched response bodies (only JSON formatting changed), with provenance in fixtures/energov/README.md.
