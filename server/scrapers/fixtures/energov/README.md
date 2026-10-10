# Recorded EnerGov responses

Fetched from public portals on 2026-10-10 UTC. These are actual response bodies, not generated permits. JSON indentation may differ from the wire; values and rows are unchanged. No cookies, authorization headers, or token responses are included. Request/response provenance below is sufficient to repeat each read-only query. Tenant headers are derived from each portal's public GetTenants response.

Application bases:

- Bloomington: https://energov.bloomington.in.gov/energov_prod/selfservice
- Kansas City: https://compasskc.kcmo.org/EnerGov_Prod/SelfService
- Taylorsville: https://portal.taylorsvilleut.gov/EnerGov_Prod/selfservice
- Overland Park: https://energov.opkansas.org/energov_prod/selfservice

| Files | Read-only request |
|---|---|
| bloomington-tenants.json, kansas-tenants.json, taylorsville-tenants.json | GET `{base}/api/Home/GetTenants` |
| bloomington-criteria.json | GET `{base}/api/energov/search/criteria` |
| bloomington-search.json, kansas-search.json, taylorsville-search.json | POST `{base}/api/energov/search/search`, advanced PermitCriteria.Address=`100`, page 1, page size 50, permit type/status `none`, sort `PermitNumber.keyword`. First-page snapshots; advertised totals are 255, 37,062, and 71 respectively. |
| bloomington-permit.json | Same search endpoint, PermitNumber=`BHQA2025-0005`, advanced permit search, page 1, size 50. |
| kansas-city-mo-permit.json | Same search endpoint, PermitNumber=`CICO-2026-01008`. |
| taylorsville-ut-permit.json | Same search endpoint, PermitNumber=`ELEC-310493-2026`. |
| overland-park-ks-permit.json | Same search endpoint, PermitNumber=`BLD-C-2017-02395`. |
| bloomington-recent.json | Advanced permit search, IssueDateFrom=`2026-10-03T00:00:00`, IssueDateTo=`2026-10-10T23:59:59`, page 1, size 50. 23 rows. |
| bloomington-applied-recent.json | Advanced permit search, ApplyDateFrom=`2026-10-03T00:00:00`, ApplyDateTo=`2026-10-10T23:59:59`, page 1, size 50. 37 rows. |
| bloomington-detail.json | POST `{base}/api/energov/permits/permitdetail`, EntityId=`d4cd98c1-2bb9-4c79-93ef-48883771183b`, ModuleId=1. |
| bloomington-contacts.json | POST `{base}/api/energov/entity/contacts/search/search`, same EntityId, ModuleId=1, PageNumber=1, PageSize=100, SortField empty, IsSortedInAscendingOrder=true. |
| taylorsville-detail.json, taylorsville-contacts.json | Same detail and contacts endpoints, EntityId=`3c958845-64bb-4f4e-a47d-c457573dc6c2`, ModuleId=1; permit `ELEC-310493-2026`. |
| bloomington-license-company.json | POST search endpoint, SearchModule=10, LicenseCriteria.CompanyName=`construction`, six selector fields set to `none`, page 1, size 50, sort `LicenseNumber.keyword`. A license-directory result, NOT a permit result. |
| taylorsville-company-keyword-empty.json | POST search endpoint, SearchModule=1, FilterModule=2, Keyword=`Precision Air Management`, ExactMatch=true, page 1, size 50. A genuine empty keyword-index response, NOT evidence of no contractor permits. |
| overland-ui-search-request.json | Actual POST payload captured from the CSS browser search for keyword `8500`. |
| overland-ui-search-failure.json | Actual HTTP 200 response to that captured UI request, Success=false and a server ErrorId. Final adapter searches succeeded later with fully initialized permit criteria/sort. |
| carlsbad-landing.html | GET https://eg.carlsbadca.gov/ — literal JavaScript redirect to SelfService. |
| seguin-landing.html | GET https://eportal.seguintexas.gov/ — meta-refresh redirect to SelfService. |
| centennial-blocked.html | HTTP 403 from GET https://cityofcentennialco-energovweb.tylerhost.net/apps/selfservice/api/Home/GetTenants; final adapter attempt at approximately 18:03 UTC. |

The browser observation used the same honest ConstructHUB bot user-agent as HTTP discovery and throttled requests. It did not log in, create applications, or bypass challenges. Other Tyler product observations and exact adapter test counts are in ../../energov.REPORT.md.

Civic Access public source-link routing was also checked against these published Bloomington frontend resources on 2026-10-10 (not stored as fixtures): `civic-access-public/main-Y2YGX3EM.js` loads the `details` route, `chunk-SVM7VADL.js` loads `permit` below it, and `chunk-RZ2AGLRL.js` defines `:id`. Thus the modern record link is `/civic-access-public/details/permit/:id`, not a guessed URL or a search-page link.
