# City-built permit adapter report

1. Platform and mechanism

Public, auth-free HTTP forms and JSON APIs. The dispatcher uses the exact host and validates the stored URL path. Host dispatch identifies the agency; PPRBD additionally uses the explicit catalog jurisdiction to constrain its shared regional data. Unknown hosts throw `City-built: no site adapter for <host>`. No database or application server is needed. City-specific adapters follow observed official links to city-owned data hosts; generic vendor tenants are derived from the URL host.

| Host | Mechanism |
|---|---|
| www.pprbd.org | Official public GIS map: eight Permits_Full_{B,E,H,P,S,T,V,W}_WM/MapServer/0/query layers, OBJECTID pagination, address/number/contractor predicates. URL host selects the regional agency; catalog jurisdiction filters its records because the city entries share the same URL. |
| www.houstonpermittingcenter.org | City-linked cohtora.houstontx.gov WebFOCUS online_per_se public report POST. Decode primitive string tables and row arrays without executing scripts; verify metadata count and reject truncated report caches. |
| oceancitymd.gov | Town-linked ArcGIS Permit Tracker read-only FeatureServer/0/query, SQL address/number/date filters, OBJECTID pagination, WGS84 geometry. |
| apps.indepmo.org | City-linked open-data API at apps.independencemo.gov/opendata/api/opendata/dataset?code=V1BUILDINGPERMITS. Complete active-permit dataset filtered locally. |
| www.palmcoast.gov | /building/search public POST with anti-forgery form token and session cookie. PermitByAddress, PermitByPermitNumber, PermitByContractor and PermitByDateRange. |
| comdev.lyon-county.org | SAGE/Clear Village /CitizenPortal/PermitUI/PermitSearch.aspx ASP.NET form POST; submission-date range; full result-count validation. |
| ggcity.org | /buildingpermit/permits/search?search=; parses both historical permit detail and result tables. Excludes archive-document tables. |
| www3.coconutcreek.gov | /sd/permit/permit_status_02.asp public search POST. Permit numbers are submit-button values. Searches one category, then filters house numbers locally. |
| pdd.eugene-or.gov | /BuildingPermits/SearchBySiteAddress, SearchByPermitNumber, SearchByContractorName, SearchByPersonOrBusinessName and SearchByDateReceived. Exact matches load the public PermitReport iframe. |
| permitsearch.summitoh.net | /api/search/{address}, /AddressResult?id=, and /PermitResult?PermitNumber=. Queries over 25 matching properties throw rather than issue an unbounded request fan-out. |
| webapp.sjcfl.us | WATS SearchPermit.aspx GET + read-only ASP.NET search POST; viewstate and session cookies; result grid or exact-match detail. |
| www.johnstonnc.gov | /insp/permitbyaddress1.cfm and /insp/permit_by_apno.cfm public POST forms. Duplicate applicant rows grouped by permit number. |
| www.milamcountypermits.com | FireInspection360 /api/v1/permits/datatables/list/public POST; full DataTables columns, pagination, and local field filtering. Tenant comes entirely from host. |
| www.hayscountypermits.com | FireInspection360 /api/v1/permits/datatables/list/public POST; full DataTables columns, pagination, and local field filtering. Tenant comes entirely from host. |
| www.kaufmancountypermits.com | FireInspection360 /api/v1/permits/datatables/list/public POST; full DataTables columns, pagination, and local field filtering. Tenant comes entirely from host. |
| www.wilcopermits.com | FireInspection360 /api/v1/permits/datatables/list/public POST; full DataTables columns, pagination, and local field filtering. Tenant comes entirely from host. |

2. Capabilities

| Jurisdiction | Search | listRecent | detail |
|---|---|---|---|
| El Paso County, CO | address, permit, company, name | no | no |
| Hays County, TX | address, permit | no | no |
| Johnston County, NC | address, permit | no | no |
| Kaufman County, TX | address, permit | no | no |
| Lyon County, NV | address, permit, company, name | yes | no |
| Milam County, TX | address, permit | no | no |
| St. Johns County, FL | address, permit, company, license, name | yes | no |
| Summit County, OH | address, permit | no | site implementation only |
| Williamson County, TX | address, permit | no | no |
| Coconut Creek, FL | address, permit | no | no |
| Eugene, OR | address, permit, company, name | yes | no |
| Garden Grove, CA | address, permit | no | site implementation only |
| Houston, TX | address, permit | no | no |
| Independence, MO | address, permit | no | no |
| Manitou Springs, CO | address, permit, company, name | no | no |
| Monument, CO | address, permit, company, name | no | no |
| Ocean City, MD | address, permit | yes | no |
| Palm Coast, FL | address, permit, company | yes | no |
| Woodland Park, CO | address, permit, company, name | no | no |

St. Johns and Palm Coast list issue dates; Eugene and Lyon list application receipt/submission dates. Ocean City queries both DateIssd and DateRecd using the supplied ISO timestamp. The four HTML date feeds apply since values at date granularity; hourly consumers must deduplicate permit numbers. The registry has exact-label capability facades for WATS, Eugene, Lyon, Palm Coast and Ocean City over the same dispatcher, enabling these five feeds. The generic City-built adapter advertises only address/permit search and no date feed or detail because these capabilities are not shared by all hosts. `capabilitiesFor(ctx)` exposes the per-site capabilities.

The other fourteen jurisdictions return [] for listRecent and advertise false. FireInspection360 exposes status dates and a 36-month activity window, not an issue/application-date feed. Johnston explicitly says its date-search field is the certificate-of-occupancy date, so it is not used for new-permit alerts. Houston date filters use PAID_DATE, not issue/application dates. Other sites have no verified issue/application-date feed; PPRBD has an ambiguous PermitDate control as detailed below. No brute-force recent searches are performed. The default dispatcher does not expose detail; Summit and Garden Grove have site-level detail readers.

Unknown fields remain null. Johnston Date values are retained in raw rather than mislabeled as issue dates. Eugene report dates with two-digit years use the conventional 70 pivot (70–99 => 1900s; 00–69 => 2000s). Numeric valuations preserve reported zero. Raw rows/JSON are retained. Public attachment access tokens were redacted from recorded Summit HTML, and OWASP_CSRFTOKEN query parameters were redacted from the Ocean City fixture. Anonymous WebFOCUS session/anti-forgery tokens were redacted from Houston discovery responses. Palm Coast has a CAPTCHA only in a separate website-feedback widget; the permit-search form and its JavaScript do not require it. The adapter scopes challenge detection to the search page without that unrelated widget; it never submits feedback or solves CAPTCHA.

3. Live tests

All runs below used the original target URL as adapter context and followed the verified official data hosts described above. Times are UTC. Counts are actual returned records, not estimates. A recent count of 0 with capability false means unsupported, not an assertion that no permits exist. Historical failed runs remain listed; later successful reruns demonstrate fixes. Sample columns: permitNumber; address; status; issuedAt; contractorName.

### El Paso County, CO

https://www.pprbd.org/Search/Permit

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:43:07.778Z | address 4364 LASHELLE AVE | 10 | 7860 | B07983; 4364 LASHELLE AVE A-B; Finaled; null; THE RANGE COMPANY<br>F89972; 4364 LASHELLE AVE; Finaled; null; A & I SKYLINE, LLC |
| 2026-10-10T18:43:15.639Z | address 4364 LASHELLE AVE A-B | 1 | 8006 | B07983; 4364 LASHELLE AVE A-B; Finaled; null; THE RANGE COMPANY |
| 2026-10-10T18:43:23.645Z | permit B07983 | 1 | 8021 | B07983; 4364 LASHELLE AVE A-B; Finaled; null; THE RANGE COMPANY |
| 2026-10-10T18:43:31.667Z | company THE RANGE COMPANY | 249 | 8325 | A27748; 2055 BROMAN CT; Finaled; null; THE RANGE COMPANY<br>A31032; 4271 COLLEGE VIEW DR; Finaled; null; THE RANGE COMPANY |
| 2026-10-10T18:43:39.992Z | recent 2026-10-03T18:43:39.992Z | 0 | 0 | none |

### Hays County, TX

https://www.hayscountypermits.com/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:08:58.795Z | permit 2026-004 | 5 | 1618 | 2026-0048; 5115 FM 110; Awaiting Response; null; null<br>2026-0042; 1645 SH 80; Awaiting Response; null; null |
| 2026-10-10T18:09:00.414Z | address 5115 FM 110 | 1 | 81 | 2026-0048; 5115 FM 110; Awaiting Response; null; null |
| 2026-10-10T18:09:00.496Z | permit 2026-0048 | 1 | 1001 | 2026-0048; 5115 FM 110; Awaiting Response; null; null |
| 2026-10-10T18:09:01.497Z | recent 2026-10-03T18:09:01.497Z | 0 | 0 | none |

### Johnston County, NC

https://www.johnstonnc.gov/content.cfm?id=1843

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:09:01.498Z | address 102 MAIN | 3 | 283 | 174579; 102 MAIN ST, PINE LEVEL; null; null; CAROLINA BUILDING SYSTEMS<br>189485; 102 MAIN ST, PINE LEVEL; null; null; null |
| 2026-10-10T18:09:01.782Z | address 102 MAIN ST, PINE LEVEL | 0 | 4263 | none |
| 2026-10-10T18:09:06.045Z | permit 174579 | 1 | 286 | 174579; 102 MAIN ST, PINE LEVEL; null; null; CAROLINA BUILDING SYSTEMS |
| 2026-10-10T18:09:06.332Z | recent 2026-10-03T18:09:06.332Z | 0 | 0 | none |
| 2026-10-10T18:26:35.149Z | address 102 MAIN | 3 | 1110 | 174579; 102 MAIN ST, PINE LEVEL; null; null; CAROLINA COMFORT AIR INC<br>189485; 102 MAIN ST, PINE LEVEL; null; null; null |
| 2026-10-10T18:26:36.260Z | address 102 MAIN ST, PINE LEVEL | 3 | 209 | 174579; 102 MAIN ST, PINE LEVEL; null; null; CAROLINA COMFORT AIR INC<br>189485; 102 MAIN ST, PINE LEVEL; null; null; null |
| 2026-10-10T18:26:36.470Z | permit 174579 | 1 | 1638 | 174579; 102 MAIN ST, PINE LEVEL; null; null; CAROLINA COMFORT AIR INC |
| 2026-10-10T18:26:38.112Z | recent 2026-10-03T18:26:38.112Z | 0 | 0 | none |

### Kaufman County, TX

https://www.kaufmancountypermits.com/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:09:06.332Z | permit 2026-004 | 2 | 495 | 2026-0044; 3115 MISTY LN; Approved; null; null<br>2026-0041; 1065 IRON GATE BLVD; Approved; null; null |
| 2026-10-10T18:09:06.828Z | address 3115 MISTY LN | 3 | 580 | 2026-0244; 3115 MISTY LN; Approved; null; null<br>2026-0278; 3115 MISTY LN; Approved; null; null |
| 2026-10-10T18:09:07.408Z | permit 2026-0044 | 1 | 997 | 2026-0044; 3115 MISTY LN; Approved; null; null |
| 2026-10-10T18:09:08.405Z | recent 2026-10-03T18:09:08.405Z | 0 | 0 | none |

### Lyon County, NV

https://comdev.lyon-county.org/CitizenPortal/DefaultLyon.aspx

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:26:01.145Z | address MAIN | 86 | 1340 | 26-0668; 1290 W MAIN ST; Issued; null; null<br>26-0267; 720 S MAIN ST; Disapproved; null; null |
| 2026-10-10T18:26:02.486Z | address 1290 W MAIN ST | 16 | 1857 | 26-0668; 1290 W MAIN ST; Issued; null; null<br>26-0136; 1290 W MAIN ST; Completed; null; null |
| 2026-10-10T18:26:04.348Z | permit 26-0668 | 1 | 2039 | 26-0668; 1290 W MAIN ST; Issued; null; null |
| 2026-10-10T18:26:06.387Z | company SMITH | 3 | 6800 | 25-1140; 94 INDUSTRIAL PKWY; Completed; null; null<br>23-0711; 600 LAKE AVE; Completed; null; null |
| 2026-10-10T18:26:13.188Z | recent 2026-10-03T18:26:13.188Z | 25 | 1255 | 26-1193; 106 OAKMONT DR; Disapproved; null; null<br>26-1192; 704 ROBERTS CREEK DR; In Process; null; null |

### Milam County, TX

https://www.milamcountypermits.com/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:09:08.406Z | permit 2026-004 | 4 | 357 | 2026-0044; 9140 N US HIGHWAY 77; Approved; null; null<br>2026-0042; 9140 N US HIGHWAY 77; Approved; null; null |
| 2026-10-10T18:09:08.763Z | address 9140 N US HIGHWAY 77 | 2 | 702 | 2026-0044; 9140 N US HIGHWAY 77; Approved; null; null<br>2026-0042; 9140 N US HIGHWAY 77; Approved; null; null |
| 2026-10-10T18:09:09.465Z | permit 2026-0044 | 1 | 996 | 2026-0044; 9140 N US HIGHWAY 77; Approved; null; null |
| 2026-10-10T18:09:10.461Z | recent 2026-10-03T18:09:10.461Z | 0 | 0 | none |

### St. Johns County, FL

https://webapp.sjcfl.us/watswebx/Permit/SearchPermit.aspx

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:09:10.461Z | address MAIN | 537 | 8763 | 12611699; 224 N MAIN ST STE B; Open; 2026-10-09; EXEMPT<br>12611192; 109 N MAIN ST; Open; 2026-09-25; BURCHFIELD, JOSEPH G |
| 2026-10-10T18:09:19.224Z | address 224 N MAIN ST STE B | 1 | 8134 | 12611699; 224 N MAIN ST STE B; null; 2026-10-09; null |
| 2026-10-10T18:09:27.358Z | permit 12611699 | 1 | 1196 | 12611699; 224 N MAIN ST STE B; null; 2026-10-09; null |
| 2026-10-10T18:09:28.555Z | company BURCHFIELD, JOSEPH G | Error: St. Johns: missing result count (portal failure or changed layout) | 31906 | none |
| 2026-10-10T18:10:00.462Z | recent 2026-10-03T18:10:00.462Z | 808 | 13584 | 12611650; 205 DUCKWOOD LN; Open; 2026-10-10; THOMAS, JONATHAN THEODORE<br>12611651; 3081 S PONTE VEDRA BLVD; Open; 2026-10-10; THOMAS, JONATHAN THEODORE |

### Summit County, OH

https://permitsearch.summitoh.net/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:10:14.046Z | address 445 S MAIN ST | 11 | 5494 | CPR210041; 445 S MAIN ST, AKRON 44311; CLOSED; null; null<br>ME2101462; 3445 S MAIN ST, COVENTRY TWP 44319; DENIED; null; null |
| 2026-10-10T18:10:19.540Z | address 445 S MAIN ST, AKRON 44311 | 4 | 2923 | CPR210041; 445 S MAIN ST, AKRON 44311; CLOSED; null; null<br>RPR240950; 445 S MAIN ST 44312; COMPLY; null; null |
| 2026-10-10T18:10:22.463Z | permit CPR210041 | 1 | 1014 | CPR210041; 445 S MAIN ST, AKRON 44311; CLOSED; null; null |
| 2026-10-10T18:10:23.478Z | recent 2026-10-03T18:10:23.478Z | 0 | 0 | none |

### Williamson County, TX

https://www.wilcopermits.com/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:10:23.478Z | permit 2026-004 | 4 | 314 | 2026-0041; 2912 CR 175; Approved; null; null<br>2026-0040; 12527 W FM 487; Approved; null; null |
| 2026-10-10T18:10:23.792Z | address 2912 CR 175 | 1 | 760 | 2026-0041; 2912 CR 175; Approved; null; null |
| 2026-10-10T18:10:24.552Z | permit 2026-0041 | 1 | 1008 | 2026-0041; 2912 CR 175; Approved; null; null |
| 2026-10-10T18:10:25.560Z | recent 2026-10-03T18:10:25.560Z | 0 | 0 | none |

### Coconut Creek, FL

https://www3.coconutcreek.gov/sd/permit/permit_status_01.asp

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:10:25.561Z | address COPANS | 651 | 289 | 26002855; 4800 W COPANS RD; OPEN; null; null<br>26001692; COPANS RD; OPEN; null; null |
| 2026-10-10T18:10:25.851Z | address 4800 W COPANS RD | 452 | 865 | 26002855; 4800 W COPANS RD; OPEN; null; null<br>26001541; 4800 W COPANS RD; CLOSED; null; null |
| 2026-10-10T18:10:26.716Z | permit 26002855 | 1 | 893 | 26002855; 4800 W COPANS RD; OPEN; null; null |
| 2026-10-10T18:10:27.610Z | recent 2026-10-03T18:10:27.610Z | 0 | 0 | none |

### Eugene, OR

https://pdd.eugene-or.gov/buildingpermits/permitsearch

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:10:27.610Z | address 1047 W 18TH PL | 3 | 1983 | 10-00576-01; 1047 W 18TH PL; null; null; null<br>25-01320-01; 1047 W 18TH PL; null; null; null |
| 2026-10-10T18:10:29.593Z | address 1047 W 18TH PL | 3 | 2067 | 10-00576-01; 1047 W 18TH PL; null; null; null<br>25-01320-01; 1047 W 18TH PL; null; null; null |
| 2026-10-10T18:10:31.660Z | permit 10-00576-01 | Error: Eugene: missing search results table | 3473 | none |
| 2026-10-10T18:10:35.133Z | company SMITH | Error: Eugene: unrecognized permit row | 2805 | none |
| 2026-10-10T18:10:37.939Z | recent 2026-10-03T18:10:37.939Z | 139 | 2032 | 26-06513-01; 1047 W 18TH PL; null; null; null<br>26-06723-01; 1161 W 24TH AVE; null; null; null |
| 2026-10-10T18:12:44.878Z | address 1047 W 18TH PL | 3 | 2018 | 10-00576-01; 1047 W 18TH PL; null; null; null<br>25-01320-01; 1047 W 18TH PL; null; null; null |
| 2026-10-10T18:12:46.896Z | address 1047 W 18TH PL | 3 | 2002 | 10-00576-01; 1047 W 18TH PL; null; null; null<br>25-01320-01; 1047 W 18TH PL; null; null; null |
| 2026-10-10T18:12:48.899Z | permit 10-00576-01 | 1 | 6550 | 10-00576-01; 1047 W 18TH PL; Issued; null; null |
| 2026-10-10T18:12:55.449Z | company SMITH | 462 | 2998 | 07-02489-01; 2150 SILVER LEA CT; Finished; 2007-05-21; B & C SMITH CONTRACTING LLC<br>26-01354-01; 2322 W 28TH AVE; Active; 2026-09-17; BENJAMIN M SMITH CONSTRUCTION LLC |
| 2026-10-10T18:12:58.448Z | recent 2026-10-03T18:12:58.448Z | 139 | 2071 | 26-06513-01; 1047 W 18TH PL; null; null; null<br>26-06723-01; 1161 W 24TH AVE; null; null; null |

### Garden Grove, CA

https://ggcity.org/buildingpermit/start/index

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:10:39.972Z | address 10871 FORBES | Error: Garden Grove: invalid result link | 2231 | none |
| 2026-10-10T18:10:42.203Z | address 100 Main St | 0 | 270 | none |
| 2026-10-10T18:10:42.474Z | permit 2026-0044 | Error: Garden Grove: missing search results | 1480 | none |
| 2026-10-10T18:10:43.955Z | recent 2026-10-03T18:10:43.955Z | 0 | 0 | none |
| 2026-10-10T18:13:29.055Z | address 10871 FORBES | 27 | 2349 | 13-1510; null; Inspections; 2013-07-16; null<br>80952; null; Finaled; 2005-08-11; null |
| 2026-10-10T18:13:31.405Z | address 100 Main St | 0 | 315 | none |
| 2026-10-10T18:13:31.720Z | permit 13-1510 | 1 | 897 | 13-1510; 10871 FORBES AVE; Inspections; 2013-07-16; WAREHOUSE SOLUTIONS INC |
| 2026-10-10T18:13:32.617Z | recent 2026-10-03T18:13:32.617Z | 0 | 0 | none |

### Houston, TX

https://www.houstonpermittingcenter.org/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:36:43.410Z | address 1000 MAIN | Error: Houston: incomplete report data | 4239 | none |
| 2026-10-10T18:36:47.650Z | address 100 Main St | Error: Houston: incomplete report data | 5895 | none |
| 2026-10-10T18:36:53.564Z | permit 2026-0044 | Error: Houston: missing report metadata | 1731 | none |
| 2026-10-10T18:36:55.295Z | company SMITH | Error: Houston: incomplete report data | 4647 | none |
| 2026-10-10T18:36:59.942Z | recent 2026-10-03T18:36:59.942Z | 0 | 0 | none |
| 2026-10-10T18:37:34.416Z | address 1000 MAIN ST 116 | 2 | 4031 | 49003840; 1000 MAIN ST 116 77002; null; null; null<br>24040498; 1000 MAIN ST 116 77002; null; null; null |
| 2026-10-10T18:37:38.448Z | address 1000 MAIN ST 116 77002 | 2 | 4207 | 49003840; 1000 MAIN ST 116 77002; null; null; null<br>24040498; 1000 MAIN ST 116 77002; null; null; null |
| 2026-10-10T18:37:42.656Z | permit 49003840 | 1 | 4206 | 49003840; 1000 MAIN ST 116 77002; null; null; null |
| 2026-10-10T18:37:46.863Z | company SMITH | Error: Houston: report cache contains only part of the result; narrow the search | 4658 | none |
| 2026-10-10T18:37:51.522Z | recent 2026-10-03T18:37:51.522Z | 0 | 0 | none |
| 2026-10-10T18:38:33.734Z | company BBVA COMPASS BANK | Error: Houston: missing report metadata | 4324 | none |

### Independence, MO

https://apps.indepmo.org/apps/BuildingPermits

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:29:57.719Z | address 523 E LINWOOD AVE | 1 | 579 | 2016-02063; 523 E LINWOOD AVE; null; null; null |
| 2026-10-10T18:29:58.300Z | address 523 E LINWOOD AVE | 1 | 617 | 2016-02063; 523 E LINWOOD AVE; null; null; null |
| 2026-10-10T18:29:58.918Z | permit 2016-02063 | 1 | 1007 | 2016-02063; 523 E LINWOOD AVE; null; null; null |
| 2026-10-10T18:29:59.926Z | recent 2026-10-03T18:29:59.926Z | 0 | 0 | none |

### Manitou Springs, CO

https://www.pprbd.org/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:43:39.993Z | address 306 CANON AVE | 42 | 8014 | D09327; 306 CANON AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC.<br>D10938; 306 CANON AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC. |
| 2026-10-10T18:43:48.008Z | address 306 CANON AVE | 42 | 7982 | D09327; 306 CANON AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC.<br>D10938; 306 CANON AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC. |
| 2026-10-10T18:43:55.991Z | permit D09327 | 1 | 8006 | D09327; 306 CANON AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC. |
| 2026-10-10T18:44:03.997Z | company MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC. | 70 | 8018 | A89587; 311 MANITOU AVE; Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC.<br>A90814; 307 MANITOU AVE (MANITOU); Finaled; null; MURPHY CONSTRUCTORS OF COLORADO SPRINGS, INC. |
| 2026-10-10T18:44:12.015Z | recent 2026-10-03T18:44:12.015Z | 0 | 0 | none |

### Monument, CO

https://www.pprbd.org/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:44:12.016Z | address 17563 LEISURE LAKE DR | 4 | 8007 | J63739; 17563 LEISURE LAKE DR; Finaled; null; CENTURY COMMUNITIES<br>O92051; 17563 LEISURE LAKE DR; Finaled; null; ABOVE THE REST LLC |
| 2026-10-10T18:44:20.024Z | address 17563 LEISURE LAKE DR | 4 | 7982 | J63739; 17563 LEISURE LAKE DR; Finaled; null; CENTURY COMMUNITIES<br>O92051; 17563 LEISURE LAKE DR; Finaled; null; ABOVE THE REST LLC |
| 2026-10-10T18:44:28.006Z | permit J63739 | 1 | 8002 | J63739; 17563 LEISURE LAKE DR; Finaled; null; CENTURY COMMUNITIES |
| 2026-10-10T18:44:36.010Z | company CENTURY COMMUNITIES | 164 | 8006 | J59013; 17592 LEISURE LAKE DR; Finaled; null; CENTURY COMMUNITIES<br>J59015; 17578 LEISURE LAKE DR; Finaled; null; CENTURY COMMUNITIES |
| 2026-10-10T18:44:44.017Z | recent 2026-10-03T18:44:44.017Z | 0 | 0 | none |

### Ocean City, MD

https://oceancitymd.gov/oc/departments/planning-community-development/online-permitting/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:31:54.958Z | address 3505 COASTAL | 3 | 334 | 21-0004; 3505 COASTAL HIGHWAY - UNIT 1; Closed; null; null<br>22-0522; 3505 COASTAL HWY UNIT 1; Closed; 2022-03-30T04:00:00.000Z; null |
| 2026-10-10T18:31:55.293Z | address 3505 COASTAL HIGHWAY - UNIT 1 | 1 | 877 | 21-0004; 3505 COASTAL HIGHWAY - UNIT 1; Closed; null; null |
| 2026-10-10T18:31:56.170Z | permit 21-0004 | 1 | 957 | 21-0004; 3505 COASTAL HIGHWAY - UNIT 1; Closed; null; null |
| 2026-10-10T18:31:57.128Z | recent 2026-10-03T18:31:57.128Z | 86 | 1022 | 25-2318; 2007 HERRING WAY Unit A; Issued; 2026-10-05T16:30:20.000Z; null<br>25-2387; 709 KELLY RD UNIT A; Issued; 2026-10-05T17:17:28.000Z; null |

### Palm Coast, FL

https://www.palmcoast.gov/building/search

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:27:40.260Z | address 515 PALM COAST | 91 | 1766 | 2026100278; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-10-09; null<br>2026090665; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-09-25; null |
| 2026-10-10T18:27:42.027Z | address 515 PALM COAST PKWY SW UNIT 13 | 91 | 1543 | 2026100278; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-10-09; null<br>2026090665; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-09-25; null |
| 2026-10-10T18:27:43.570Z | permit 2026100278 | Error: Palm Coast: incomplete permit results | 1879 | none |
| 2026-10-10T18:27:45.450Z | company SMITH | 237 | 2187 | 2026050673; 72 AIRPORT COMMERCE CENTER WAY; FINAL; 2026-05-20; null<br>2026050672; 350 PALM COAST PKWY NE; FINAL; 2026-06-01; null |
| 2026-10-10T18:27:47.638Z | recent 2026-10-03T18:27:47.638Z | 187 | 1891 | 2026100338; 338 UNDERWOOD TRL; FINAL; 2026-10-09; null<br>2026100336; 19 PINTO LN; ISSUED; 2026-10-09; null |
| 2026-10-10T18:28:19.494Z | address 515 PALM COAST | 91 | 1290 | 2026100278; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-10-09; null<br>2026090665; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-09-25; null |
| 2026-10-10T18:28:20.786Z | address 515 PALM COAST PKWY SW UNIT 13 | 91 | 1783 | 2026100278; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-10-09; null<br>2026090665; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-09-25; null |
| 2026-10-10T18:28:22.570Z | permit 2026100278 | 1 | 2116 | 2026100278; 515 PALM COAST PKWY SW UNIT 13; ISSUED; 2026-10-09; null |
| 2026-10-10T18:28:24.687Z | company SMITH | 237 | 2204 | 2026050673; 72 AIRPORT COMMERCE CENTER WAY; FINAL; 2026-05-20; null<br>2026050672; 350 PALM COAST PKWY NE; FINAL; 2026-06-01; null |
| 2026-10-10T18:28:26.892Z | recent 2026-10-03T18:28:26.892Z | 187 | 1695 | 2026100338; 338 UNDERWOOD TRL; FINAL; 2026-10-09; null<br>2026100336; 19 PINTO LN; ISSUED; 2026-10-09; null |

### Woodland Park, CO

https://www.pprbd.org/

| Time | Query | Count or error | Duration ms | Two sample records (or all if fewer) |
|---|---|---|---|---|
| 2026-10-10T18:44:44.017Z | address 407 FOREST EDGE CIR | 1 | 8020 | Q63388; 407 FOREST EDGE CIR; Open; null; RELIABLE ROOFING SYSTEMS, INC |
| 2026-10-10T18:44:52.038Z | address 407 FOREST EDGE CIR | 1 | 7984 | Q63388; 407 FOREST EDGE CIR; Open; null; RELIABLE ROOFING SYSTEMS, INC |
| 2026-10-10T18:45:00.023Z | permit Q63388 | 1 | 8002 | Q63388; 407 FOREST EDGE CIR; Open; null; RELIABLE ROOFING SYSTEMS, INC |
| 2026-10-10T18:45:08.026Z | company RELIABLE ROOFING SYSTEMS, INC | 7 | 8063 | J84915; 307 E GUNNISON AVE; Finaled; null; RELIABLE ROOFING SYSTEMS, INC<br>L69712; 1020 SPRUCE HAVEN DR; Finaled; null; RELIABLE ROOFING SYSTEMS, INC |
| 2026-10-10T18:45:16.090Z | recent 2026-10-03T18:45:16.090Z | 0 | 0 | none |

4. Blocked and failed tenants

Every fetch outcome and deciding evidence is in fixtures/city-built/classification.json; numeric .html.gz files correspond to the original target array index. The classifier uses politeFetch, one-second host spacing, at most two different-host tasks, and a bounded Playwright attempt for detected JS shells. The broad fetch pass exceeded the 25-minute classification target while honoring the stricter two-request concurrency limit; exact first/last timestamps are retained per row. No challenge is solved, no login is attempted, and no application/payment/inspection request is submitted.

Marin returned HTTP 403. Alamance’s linked search form includes reCAPTCHA and is not queried. PPRBD Search/Permit, including tab=advanced, redirected to the homepage. Its official GIS map supplies the implemented read-only search path. The linked detail for Q63314 redirected to Permit/None, so detail and record-page URLs are not claimed. Pierce PALS loaded dashboard APIs and a maintenance notice. Public JSON address queries MAIN, 100 and PACIFIC returned HTTP 200 with []; no positive record was verified, so no adapter is claimed. Orange County’s PermitsAllTypes.aspx search contains a hidden recaptchaToken populated by enterprise reCAPTCHA; it was not submitted. Austin returned an Incapsula incident page with HTTP 200. Lancaster County NE’s linked search and Polk County NC’s embedded search returned 403. Montgomery County returned 500. Richardson search requires a reCAPTCHA token; it was not submitted. Los Gatos embeds Accela; Newmarket links Tyler Portico; Frankenmuth links BS&A payment search. Port St. Lucie permit detail requires a three-digit PIN; no PIN is guessed or entered. These are failures or exclusions, not empty permit searches.

| Verdict | Count |
|---|---|
| info-page | 522 |
| application-only | 57 |
| blocked | 72 |
| vendor | 278 |
| record-search | 22 |
| dead | 18 |

Classification timestamps: 2026-10-10T17:54:16.402Z through 2026-10-10T18:23:12.992Z.

Total: 969. Rendered responses: 41. Rows flagged for review: 244. Classification is evidence-based triage: a record-search link is a candidate, not proof of a working adapter; JS shells and login-only pages flagged reviewRequired need a follow-up. Dead means the fetch failed or returned an error during this run, not a permanent finding.

5. Coverage

19 / 969 catalog entries match an implemented host and stored URL shape; 18 have non-null labels resolvable through the registry. Shared FireInspection360 code covers Hays, Kaufman, Milam and Williamson counties (4 rows). Shared PPRBD GIS code covers El Paso County, Manitou Springs, Monument and Woodland Park (4 rows) with an explicit jurisdiction predicate; regional records are never assigned wholesale to each city. Garden Grove has a null catalog label: direct host dispatch works, but getAdapter(null) intentionally still returns null. Correcting that catalog label is outside the authorized files.

Registered generic aliases: `city-site`, `Online permitting`, `City online permit system`, `City portal`, `County portal`, `Pikes Peak Regional Building Department (PPRBD)`, `Pikes Peak Regional Building Department (regional-administered)`, `Houston Permitting Center`, `town online permitting`, `City of Independence Permits & Applications Center (city-specific)`, `Palm Coast Connect (city-specific)`, `Community Development Citizen Portal`, `WATS (county-specific)`, `County permit search`, `Jurisdiction's own portal`, `City permit portal`, `City of Eugene custom (Planning and Development permit search)`, `County permits portal`, `County permit portal`, `County Fire Marshal construction permit portal`, `FireInspection360 (WilcoPermits)`.

All other entries are excluded from this dispatcher: vendor routing belongs to the corresponding adapters, info/application pages do not provide verified public record searches, blocked/dead pages could not be verified, and remaining custom searches need site implementations. The classification retains exact evidence; supplemental-pages.json records linked searches used to refine initial classifications. Several links still need deeper verification, so candidate record-search counts are not adapter coverage. No blanket alias implies coverage of every URL carrying that label.

Remaining record-search candidates without a site adapter:

- Hollis, NH: https://www.hollisnh.gov/1277/Building-Permits-Forms — Archived Building Permits Search https://ecmcloud.vitalrecordscontrol.com/EclipseWeb/Guest?RequestId=c62c96d7-db6e-ef11-bab5-0affd866eebf&InstanceId=f434f127-49d7-e611-8132-0eb61c6741a1&AutoRedirect=true
- Los Gatos, CA: https://permits.losgatosca.gov/Home — Search Records https://permits.losgatosca.gov/Planning/Search-Records
- Port Saint Lucie, FL: https://pandapublicweb.cityofpsl.com/Bldg/PermitStatus.aspx — Search Permits on a Property /Bldg/PropertySearch.aspx
- Turlock, CA: https://ci.turlock.ca.us/buildinginturlock/buildingsafety/buildingpermits/researchpermits.asp — Research Permits /buildinginturlock/buildingsafety/buildingpermits/researchpermits.asp
- Westford, MA: https://permits.westfordma.gov/ — Search permits searchpermits.php
- Williston, VT: https://www.town.williston.vt.us/index.asp?Type=B_BASIC&SEC={EA79C1BC-18CF-44F2-8F00-2C93D305A73F} — Recent Permits & File Research index.asp?Type=B_LIST&SEC={670F3D2A-CEDD-4F5B-AAC9-BD65999EF986}
- Ishpeming, MI: http://www.co.marquette.mi.us/departments/building_codes/index.php#.XtLpQN5FxPY — Building Permit & Inspection Lookup departments/building_codes/building_permit_inspection_lookup.php
- Round Rock, TX: https://permits.roundrocktexas.gov/portal — Search Permits /portal/GuestAccess/Index

6. Known gaps and follow-up

The requested strict ten-largest-custom-jurisdiction milestone remains incomplete: some earlier-ranked candidates remain blocked or unimplemented. Nineteen target jurisdictions were implemented and live-tested, prioritizing reachable public records and the shared regional product; several earlier-ranked candidates remain blocked or unimplemented. Complete those in target order after resolving the recorded access/layout issues. Classifications that only identify a search link should be followed to verify search functionality, and flagged JS shells need longer targeted rendering.

St. Johns contractor search for BURCHFIELD, JOSEPH G returned a portal failure after about 32 seconds; SMITH also returned an explicit database execution timeout. Both are failures, not empty records. Generic labels intentionally do not advertise optional company/name/detail capabilities. PPRBD exact labels expose contractor/name searches via a capability facade. PPRBD’s GIS field is labeled only PermitDate, so it stays in raw; issue/application meaning was not verified and listRecent remains false despite the map having a date control. Garden Grove historical result rows omit addresses; unknown addresses stay null. Johnston exposes only the last six years in the tested search. FireInspection360 public search is limited to its 36-month activity window. Independence covers only the city’s active-permit open dataset, refreshed at the source timestamp shown in raw. Palm Coast throws on its 1,501-row display cap; use a narrower query, or add a verified CSV export parser in follow-up. Ocean City uses explicit service pagination and detects repeated pages. Houston may embed only 100 rows of a larger cached report, so broad queries throw; narrower searches work. Houston project numbers can have several permit-type rows, retained without inventing composite permit numbers; identical repeated rows are grouped with their originals in raw. Its buyer-name search reports maintenance, so only address and permit searches are advertised.

Verification: 25 offline tests passed. `npx vitest run server/scrapers/city-built.test.ts --configLoader runner` and `npx tsc --noEmit -p .`. The default Vitest config loader cannot write node_modules/.vite-temp in this read-only dependency mount, so the supported runner loader is used. No app or database was started.
