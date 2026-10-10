# Long tail A survey — 2026-10-10

## 1. Platform and mechanism (survey recorded before adapter implementation)

140 targets: GovPilot 42, CityView 35, Cloudpermit 32, Schneider GeoPermits 31. These are target entries, not verified searchable tenant counts.

| Vendor | Three tenants opened | Public records search | Date listing | Mechanism and blockers |
| --- | --- | --- | --- | --- |
| CityView | Downers Grove IL; Manheim PA; Naples FL | Downers Grove yes, address/permit/parcel locator; Naples advertises Application Search but its locator returns a CAPTCHA; Manheim requires follow-up validation of its embedded portal | No date filter on the inspected Downers Grove locator | ASP.NET MVC HTML plus cookie-session JSON GET `/Permit/LocatorResults`, whose `View` is HTML and `LocationMarkers` contains public record links. Downers Grove stored `/Permit/Application` redirects to login but `/Permit/Locator` is public. A stateless locator-results request returned Session Expired; using the public locator's cookies succeeds. POST to this GET endpoint failed with 404. |
| GovPilot | Cranbury NJ; Columbine Valley CO; Columbia County WA | Cranbury yes, existing permit lookup by address/permit; other two are application forms, not permit search | None observed | Kendo JS public forms. Cranbury declares `ASTYPE='ADDSEL=dcee8,1'`; public JS uses JSON POST `https://api-main.govpilot.com/api/v1/lookup/address/module-search` with uid, tid and q. Auth-free test `Main` returned 1,787 real lookup rows. Do not submit inspection/application forms. |
| Cloudpermit | Aberdeen NC; Woodland WA; Holland NY | Aberdeen public-records page exposes 3,010 building-permit records; Woodland public page says no public records available; Holland exposes Cases/Complaints, not building permits | No issued/applied-date listing demonstrated | JavaScript app using Transit JSON `/api/command/public-records/config?branding=...` and public-records requests. Stored `/gov/map/...` redirects to tenant-slug `/public-records`. All three returned HTTP 200; no CAPTCHA. Public access depends on tenant/module configuration. |
| Schneider GeoPermits | Warren County IA; Jasper County IA; Wapello County IA | No public existing-permit search found on the three rendered jurisdiction pages | None observed | Angular app; public JSON client/workflow metadata under `permitting-api.schneidergis.com/api/`. Pages list START APPLICATION, Login and Signup. Contractor entries are registration applications, not searchable permit records. No applications were started. All three returned HTTP 200. |

Survey URLs are the exact entries in targets.json: Downers Grove `https://cvportal.downers.us/Permit/Application`; Manheim `https://cityview.manheimtownship.org/CityViewPortal`; Naples `https://cityview2.iharriscomputer.com/cityofnaplesflorida`; Aberdeen `https://us.cloudpermit.com/townofaberdeen/`; Woodland `https://us.cloudpermit.com/gov/map/US-WA79625/woodland`; Holland `https://us.cloudpermit.com/gov/map/US-NY35111`; the first three GovPilot and GeoPermits entries in targets.json. Full adapter test URLs will appear in the vendor reports.

## 2. Selection and capabilities

Build GovPilot and CityView: the two largest vendor groups each demonstrate actual public permit lookup. Scope is only public record searches, not application submission. Neither inspected search exposes an issue/application date filter, so `listRecent` will explicitly return [] with capability false unless further public evidence establishes one. CityView public permit detail pages are supported. Contractor/name/license search is not claimed from address/permit-only controls.

## 3–6. Live tests, failures, coverage and follow-up

Initial HTTP opens: all 12 returned 200 (Downers Grove after redirect). Rendered GeoPermits pages confirmed application-only navigation. Cloudpermit Holland showed 101 case/complaint records; these are not imported as permits. Vendor reports will record adapter queries, counts, sample records, exact alias coverage, exclusions, tests and gaps. No government records were fabricated, no login occurred, and no mutation forms were submitted.
