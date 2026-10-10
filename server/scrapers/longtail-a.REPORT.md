# Long tail A survey — 2026-10-10

## 1. Platform and mechanism (survey recorded before adapter implementation)

140 targets: GovPilot 42, CityView 35, Cloudpermit 32, Schneider GeoPermits 31. These are target entries, not verified searchable tenant counts.

| Vendor | Three tenants opened | Public records search | Date listing | Mechanism and blockers |
| --- | --- | --- | --- | --- |
| CityView | Downers Grove IL; Manheim PA; Naples FL | Downers Grove yes, address/permit/parcel locator; Naples advertises Application Search but its locator returns a CAPTCHA; Manheim advertises Status and Fees but its locator returns a CAPTCHA | No date filter on the inspected Downers Grove locator | ASP.NET MVC HTML plus cookie-session JSON GET `/Permit/LocatorResults`, whose `View` is HTML and `LocationMarkers` contains public record links. Downers Grove stored `/Permit/Application` redirects to login but `/Permit/Locator` is public. A stateless locator-results request returned Session Expired; using the public locator's cookies succeeds. POST to this GET endpoint failed with 404. |
| GovPilot | Cranbury NJ; Columbine Valley CO; Columbia County WA | Cranbury yes, existing permit lookup by address/permit; other two are application forms, not permit search | None observed | Kendo JS public forms. Cranbury declares `ASTYPE='ADDSEL=dcee8,1'`; public JS uses JSON POST `https://api-main.govpilot.com/api/v1/lookup/address/module-search` with uid, tid and q. Auth-free test `Main` returned 1,787 real lookup rows. Do not submit inspection/application forms. |
| Cloudpermit | Aberdeen NC; Woodland WA; Holland NY | Aberdeen public-records page exposes 3,010 building-permit records; Woodland public page says no public records available; Holland exposes Cases/Complaints, not building permits | No issued/applied-date listing demonstrated | JavaScript app using Transit JSON `/api/command/public-records/config?branding=...` and public-records requests. Stored `/gov/map/...` redirects to tenant-slug `/public-records`. All three returned HTTP 200; no CAPTCHA. Public access depends on tenant/module configuration. |
| Schneider GeoPermits | Warren County IA; Jasper County IA; Wapello County IA | No public existing-permit search found on the three rendered jurisdiction pages | None observed | Angular app; public JSON client/workflow metadata under `permitting-api.schneidergis.com/api/`. Pages list START APPLICATION, Login and Signup. Contractor entries are registration applications, not searchable permit records. No applications were started. All three returned HTTP 200. |

Survey URLs are the exact entries in targets.json: Downers Grove `https://cvportal.downers.us/Permit/Application`; Manheim `https://cityview.manheimtownship.org/CityViewPortal`; Naples `https://cityview2.iharriscomputer.com/cityofnaplesflorida`; Aberdeen `https://us.cloudpermit.com/townofaberdeen/`; Woodland `https://us.cloudpermit.com/gov/map/US-WA79625/woodland`; Holland `https://us.cloudpermit.com/gov/map/US-NY35111`; the first three GovPilot and GeoPermits entries in targets.json. Full adapter test URLs will appear in the vendor reports.

## 2. Selection and capabilities

Build GovPilot and CityView: the two largest vendor groups each demonstrate actual public permit lookup. Scope is only public record searches, not application submission. Neither inspected search exposes an issue/application date filter, so `listRecent` will explicitly return [] with capability false unless further public evidence establishes one. CityView public permit detail pages are supported. Contractor/name/license search is not claimed from address/permit-only controls.

## 3–6. Live tests, failures, coverage and follow-up

Initial HTTP opens: all 12 returned 200 (Downers Grove after redirect). Rendered GeoPermits pages confirmed application-only navigation. Cloudpermit Holland showed 101 case/complaint records; these are not imported as permits. The completed vendor reports record adapter queries, counts, sample records, exact alias coverage, exclusions, tests and gaps. No government records were fabricated, no login occurred, and no mutation forms were submitted.

## Final outcome

The initial survey above was written before adapter implementation (preserved in commit 076a4254). Selection was by vendor target count among vendors with demonstrated public permit search: GovPilot 42 and CityView 35. It was not a claim that all tenants in those groups are publicly searchable. Cloudpermit also has public building records (Aberdeen) and remains a worthwhile next adapter; the sampled GeoPermits jurisdiction pages did not expose record search.

| Adapter | Potential/configuration coverage | Live address searches | Permit-number searches | Date listing | Detail |
| --- | --- | --- | --- | --- | --- |
| CityView | 33/35 compatible URL shapes; 3 successful record-search tenants, 5 blocked/unavailable probes, 25 not yet tested | Downers Grove 15; Carrollton 49; Monroe 5 | Downers Grove 1; Carrollton 1; Monroe 1 | No | Yes |
| GovPilot | 13/42 verified public-lookup forms; 3 successful record-search tenants, 10 forms not API-tested | Cranbury 72; Maplewood 8; Avalon 22 | Cranbury 7; Maplewood 1; Avalon 1 | No | No |

The last-seven-days call `listRecent("2026-10-03T00:00:00Z")` returned 0 for each of those six tenants because the capability is false; those are not government no-permit counts. No alert coverage is claimed. Contractor/name/license searches are unsupported on these public locators. All unknown fields are null. Exact queries, timestamps, durations, two samples where available, source URLs, exclusions and fixture provenance are in [cityview.REPORT.md](cityview.REPORT.md) and [govpilot.REPORT.md](govpilot.REPORT.md).

Blocked CityView tenants: Naples, Manheim and Madison County AL show CAPTCHA pages; Kane County requires sign-in; Cherokee County does not expose the supported permit locator. BluePrince Lexington County and the Grimes magazine article are excluded. GovPilot excludes 20 direct non-permit-search forms and 9 unsupported URL shapes. HTTP failures and unrecognized responses throw rather than returning empty results.

Validation: 26 offline tests passed with `npx vitest run --configLoader runner server/scrapers/cityview.test.ts server/scrapers/govpilot.test.ts`; `npx tsc --noEmit -p .` passed. The default Vitest loader encountered EROFS in shared node_modules, so the runner loader was used with the unchanged repository configuration. No database, app server, login, CAPTCHA bypass or mutation form submission was used. Nothing was pushed.

### Exact initial survey URLs

- CityView, Downers Grove, IL: https://cvportal.downers.us/Permit/Application
- CityView, Manheim, PA: https://cityview.manheimtownship.org/CityViewPortal
- CityView, Naples, FL: https://cityview2.iharriscomputer.com/cityofnaplesflorida
- GovPilot, Cranbury, NJ: https://main.govpilot.com/web/public/23ab5fde-290_Construction-Permit-Township-of-Cranbury?uid=7199&ust=NJ&pu=1&id=0
- GovPilot, Columbine Valley, CO: https://main.govpilot.com/web/public/7ae3f635-ff5_Building-Permit-Application-With-Plan-Review-COLUMBINE-VALLEY?uid=9360&ust=CO&pu=1&id=0
- GovPilot, Columbia County, WA: https://main.govpilot.com/web/public/35a46a9f-cd7_Building-Permit-COLUMBIA-COUNTY?uid=16026&ust=WA&pu=1&id=0
- Cloudpermit, Aberdeen, NC: https://us.cloudpermit.com/townofaberdeen/
- Cloudpermit, Woodland, WA: https://us.cloudpermit.com/gov/map/US-WA79625/woodland
- Cloudpermit, Holland, NY: https://us.cloudpermit.com/gov/map/US-NY35111
- GeoPermits, Warren County, IA: https://permitting.schneidergis.com/jurisdiction/cd30961b-df5d-4584-87de-fbe7ef3cdd06
- GeoPermits, Jasper County, IA: https://permitting.schneidergis.com/jurisdiction/0942d49a-5fe3-4a40-b053-edd2fd4bef98
- GeoPermits, Wapello County, IA: https://permitting.schneidergis.com/jurisdiction/cd909e52-e0a8-43c4-b173-7b4613fb2e5f
