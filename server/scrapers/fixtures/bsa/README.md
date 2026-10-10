These are real public BS&A Online responses fetched on 2026-10-10. No permit rows or response bodies were invented. HTML was saved as returned, including CRLF and trailing spaces; request-verification tokens, search-session GUIDs, and subpage authorization tokens were replaced with REDACTED where present. Cookies were not saved. JSON permit rows are unchanged.

The adapter's report records the live queries, result counts, sample records, and timing. All tests read these local files and mock HTTP; they make no network requests.

| Fixture | Source and request context |
| --- | --- |
| home.html | GET https://bsaonline.com/Home/MunicipalityHome?uid=385 |
| search-session.html | Rochester Hills; GET /SiteSearch/BuildingDepartmentRecordSearch?uid=385, following the server's AdvancedRecordSearch redirects with cookies |
| search-form.html | Rochester Hills; GET /SiteSearch/GetAdvancedRecordSearchFindRecordStepPartialView for that session |
| rochester-hills-address-results.html | GET /SiteSearch/GetPageOfFindRecordSearchResultsPartialView; uid=385, address search type=1, searchText=1008 ADELE, currentPage=1 |
| no-results.html | Same results endpoint; uid=385, address search type=1, searchText=100 Main, currentPage=1; explicit 0 results |
| select-result.json | POST /SiteSearch/UpdateAdvancedRecordSearchFindRecordStep selecting property 84f94d20-d02b-4267-88ca-a143010007d3, parcel 70-15-28-277-017; temporary search state only |
| property-parent.html | Rochester Hills; GET /SiteSearch/GoToRecord following its redirect to /SiteSearch/PropertyDetails, ReferenceKey=70-15-28-277-017, SearchFocus=Building Department |
| property-grid.html | GET /CD_PropertySearchV3/PropertyAndParcelDetails; uid=385, recordKey=7=84f94d20-d02b-4267-88ca-a143010007d3, with the token/reference returned by its parent page and X-Requested-With: XMLHttpRequest |
| rochester-hills-permits-page1.json | POST the page-advertised /CD_PropertySearchV2/GridPermitsSelectBinding URL; same property, uid=385, page=1, size=10; 10 rows, total=11 |
| rochester-hills-permits-page2.json | Same grid endpoint and property; page=2, size=10; 1 row, total=11 |
| permit-results.html | Rochester Hills; GET search-results partial; search type=6, searchText=PB-2001-0568, currentPage=1 |
| permit-detail.html | GET https://bsaonline.com/CD_RecordDetails/Permit?permitId=58826690-55e8-4bcf-8f89-a14301003a12&uid=385, reached through the public search selection |
| east-point-home.html | GET https://bsaonline.com/Home/MunicipalityHome?uid=2757 |
| east-point-search-session.html | East Point; BuildingDepartmentRecordSearch and its AdvancedRecordSearch redirects |
| east-point-search-form.html | East Point; GetAdvancedRecordSearchFindRecordStepPartialView |
| east-point-unit-results.html | East Point; search type=1, searchText=2862 SEMMES ST 100, page=1 |
| east-point-property-parent.html | East Point; public property parent for parcel 14015700110454; the portal initially selects property 23538 instead of search hit 31578 |
| associated-property-selector.html | GET /CD_PropertySearchV3/CdPropertySelectModal?uid=2757&parcelNumber=14015700110454 with the normal AJAX header |
| associated-properties.json | POST the advertised GridAssociatedPropertiesSelectBinding URL; page=1, size=20; 3 properties. PropertyGuid is the server's returned GUID, not a locally generated ID |
| east-point-property-grid.html | GET PropertyAndParcelDetails using the selected server-returned PropertyGuid 00007b5a-0000-0000-0000-000000000000 and parent token/reference |
| east-point-permits.json | POST advertised GridPermitsSelectBinding URL for property 31578; page=1, size=10; 1 permit, PB25-0107 |
| property-without-permit-grid.html | East Point's same-parcel property 2862 SEMMES ST 200 (B); HTTP 200 PropertyAndParcelDetails response omits GridPermits, so it must not be treated as an explicitly loaded zero-result grid |
| search-client.js | GET /Scripts/Search/AdvancedRecordSearch/Steps/Bsa.Global.AdvancedRecordSearchFindRecordStep.js?v=HJjFNqr5gt4cAB846tRQ9ksN3vQQQjS5cl_qmk3EjNw1; public script documenting the search requests |
| property-client.js | GET /Areas/Cd/Scripts/Cd_PropertySearchV3/Bsa.Cd.CdSiteSearchPropertyResult.js?v=Kt9CGn2ODXf2IALY6eseNThGHrM1hXEfqkJnRGeqNjM1; public script documenting parent-token use and property selection |

All relative paths above are on https://bsaonline.com. Session-specific query values are obtained from the preceding real response, not guessed. JSON grid envelopes can contain the server's modelState warning about its generated command=Telerik.Web.Mvc.GridCommand query value; the original envelopes are retained, and the data/total fields are validated by the parser.
