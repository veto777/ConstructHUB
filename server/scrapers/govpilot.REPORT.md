# GovPilot adapter report — 2026-10-10

## 1. Platform and mechanism

Auth-free existing-permit lookup on `https://main.govpilot.com/web/public/<form>?uid=<agency>&ust=<state>...`. The adapter reads the actual form and requires its `ASTYPE='ADDSEL=<module>,1'` declaration, `addqs` control and permit-number instruction. It derives uid from the URL and tid from that declaration. No tenant or module is hardcoded.

The public form's `js/global.js`, function `InitAddressLU`, specifies JSON POST `https://api-main.govpilot.com/api/v1/lookup/address/module-search` with uid, tid, q and Kendo paging hints. This is a read-only lookup. It explicitly uses `serverPaging:false`: the observed `Main` request returned 1,787 rows despite a page-size hint of 100. No guessed paging calls are made. `politeFetch`/`politeJson` enforce the honest ConstructHUB User-Agent, at least 1,000 ms between requests per host, backoff and typed blocked errors. No browser or login is used and no inspection/application submission is made.

The response's `FADDRESS` labels permit number, address and description. The untouched JSON row is kept in raw. ID is a property ID and RID is an internal record ID: neither is substituted for permitNumber. 23 of the initial Cranbury Main response's 1,787 rows had only a control number, so 1,764 permits can be normalized. Mixed responses log omissions; an entirely control-only response throws instead of claiming no results. Dates, status and contractor fields remain null. No unique public permit-detail page was established, so sourceUrl is null; the inspection-submission form is not misrepresented as a permit page.

## 2. Capabilities

- Search: address and permit number, minimum 4 characters, matching the public lookup. The server uses substring matching; do not assume an exact match or deduplicate distinct RID rows solely by permit number.
- listRecent: **false**. The public lookup has no issued/applied-date filter or listing. `listRecent(since)` returns [] without network traffic or brute-force searches. This adapter does not enable hourly permit alerts.
- Detail: **false**. No independently verified read-only public detail route is implemented.
- Contractor/company, person/name, license and keyword: unsupported; requests throw.

## 3. Live tests

All times are UTC on 2026-10-10. Durations are measured wall-clock milliseconds. Database ID 0 is the live-harness sentinel, not a persisted jurisdiction ID. No database or app server was used. Search counts are normalized permit rows. Recent counts of 0 are an unsupported-operation result, not evidence that no permits were issued. Contractor/company/name/license queries were not attempted: neither public locator offers these search fields.

### Avalon, NJ

URL: https://main.govpilot.com/web/public/8cbc19df-997_Construction-Permit-Borough-of-Avalon?uid=6913&ust=NJ&pu=1&id=0

- `address 100 Dune` at 2026-10-10T17:53:03.356Z: 22 records, 887 ms, 2 HTTP requests.
  Sample: {"permitNumber": "20110420", "address": "3100 DUNE DRIVE", "status": null, "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "20070548", "address": "3100 DUNE DRIVE", "status": null, "issuedAt": null, "contractorName": null}.
- `permit 20110420` at 2026-10-10T17:55:28.669Z: 1 records, 636 ms, 2 HTTP requests.
  Sample: {"permitNumber": "20110420", "address": "3100 DUNE DRIVE", "status": null, "issuedAt": null, "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:55:30.786Z: 0 records, 1 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.

### Cranbury, NJ

URL: https://main.govpilot.com/web/public/23ab5fde-290_Construction-Permit-Township-of-Cranbury?uid=7199&ust=NJ&pu=1&id=0

- `address 23 NORTH MAIN` at 2026-10-10T17:55:18.494Z: 72 records, 786 ms, 2 HTTP requests.
  Sample: {"permitNumber": "24-015_1", "address": "23 NORTH MAIN STREET", "status": null, "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "24-085_3", "address": "23 NORTH MAIN STREET", "status": null, "issuedAt": null, "contractorName": null}.
- `permit 24-085` at 2026-10-10T17:55:20.759Z: 7 records, 812 ms, 2 HTTP requests.
  Sample: {"permitNumber": "24-085_3", "address": "23 NORTH MAIN STREET", "status": null, "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "24-085_2", "address": "23 NORTH MAIN STREET", "status": null, "issuedAt": null, "contractorName": null}.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:55:23.058Z: 0 records, 1 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.
- `permit CONSTRUCTHUB-NO-SUCH-PERMIT-20261010` at 2026-10-10T17:56:17.222Z: 0 records, 547 ms, 2 HTTP requests.
  The portal returned a genuine empty result. No sample records.

### Maplewood, NJ

URL: https://main.govpilot.com/web/public/129d48cb-7b2_Construction-Permit-Township-of-Maplewood?uid=7127&ust=NJ&pu=1&id=0

- `address 123 Maplewood` at 2026-10-10T17:52:43.198Z: 8 records, 904 ms, 2 HTTP requests.
  Sample: {"permitNumber": "2001-1079+A_1", "address": "123 MAPLEWOOD AVENUE", "status": null, "issuedAt": null, "contractorName": null}.
  Sample: {"permitNumber": "2001-1051", "address": "123 MAPLEWOOD AVENUE", "status": null, "issuedAt": null, "contractorName": null}.
- `permit 2001-1079+A_1` at 2026-10-10T17:55:24.565Z: 1 records, 1076 ms, 2 HTTP requests.
  Sample: {"permitNumber": "2001-1079+A_1", "address": "123 MAPLEWOOD AVENUE", "status": null, "issuedAt": null, "contractorName": null}.
  Only one record returned; a second sample does not exist.
- `recent 2026-10-03T00:00:00Z` at 2026-10-10T17:55:27.189Z: 0 records, 1 ms, 0 HTTP requests.
  Capability false; no network date query exists in this adapter; no samples.

## 4. Blocked or failed tenants

No HTTP 401/403/429, CAPTCHA or login wall occurred on the three tested existing-permit lookup tenants. The initial survey's Columbine Valley and Columbia County forms returned HTTP 200 but are application forms, not existing-permit searches. They are explicitly rejected, not returned as empty searches. All 33 direct `main.govpilot.com/web/public/` target forms were inspected read-only; 20 lacked the required permit-lookup declaration. No forms were submitted.

## 5. Coverage

42 total target entries. 33 have the direct public-form URL shape; **13 of 42** have the supported existing-permit-lookup configuration, confirmed by fetching their actual public forms. **3 of those 13** also passed live record searches; the other 10 have not been API-tested. 20 direct forms are application/property/concern or other unsupported forms. 9 have map/eforms/jet/marketing URL shapes outside this adapter. Do not count all 42 as working.

Registered labels: `GovPilot`, `GovPilot (Construction Permit)`, `GovPilot (Construction inspection request)`, `GovPilot (Construction Permit Inspection Request)`, `GovPilot (Construction Permit / Inspection Request)`, `GovPilot (Construction Permit / Inspections)`. A label can contain both supported and unsupported tenants: configuration validation still applies.

Supported form configurations:

- Cranbury, NJ — GovPilot — uid 7199, ADDSEL=dcee8,1.
- Avalon, NJ — GovPilot (Construction Permit / Inspection Request) — uid 6913, ADDSEL=dcee8,1.
- Maplewood, NJ — GovPilot (Construction Permit) — uid 7127, ADDSEL=dcee8,1.
- Clark, NJ — GovPilot (Construction Permit) — uid 7353, ADDSEL=dcee8,1.
- Hackensack, NJ — GovPilot (Construction inspection request) — uid 6978, ADDSEL=dcee8,1.
- Haddon Township, NJ — GovPilot (Construction Permit / Inspections) — uid 7071, ADDSEL=dcee8,1.
- Hopatcong, NJ — GovPilot (Construction Permit) — uid 7400, ADDSEL=dcee8,1.
- Leonia, NJ — GovPilot — uid 7020, ADDSEL=dcee8,1.
- Livingston, NJ — GovPilot (Construction Permit) — uid 7126, ADDSEL=dcee8,1.
- Oakland, NJ — GovPilot (Construction Permit) — uid 7004, ADDSEL=dcee8,1.
- Shamong, NJ — GovPilot (Construction Permit Inspection Request) — uid 7741, ADDSEL=dcee8,1.
- South Orange, NJ — GovPilot (Construction inspection request) — uid 6977, ADDSEL=dcee8,1.
- Union, NJ — GovPilot (Construction Permit Inspection Request) — uid 6840, ADDSEL=dcee8,1.

Excluded direct forms (all HTTP 200; application/property/other lookup, not the verified permit lookup):

- Columbine Valley, CO — GovPilot — ADDSEL0.
- Columbia County, WA — GovPilot — ADDSEL.
- Jackson County, MS — GovPilot — ADDSEL.
- Allendale, NJ — GovPilot — ADDSEL.
- Bellmawr, NJ — GovPilot (Construction Permit) — ADDSEL.
- Dell Rapids, SD — GovPilot — ADDSEL.
- Jamestown, NY — GovPilot (Building Permit Application) — ADDSEL.
- La Salle, IL — GovPilot — ADDSEL.
- Ovilla, TX — GovPilot — ADDSEL.
- Stevens Point, WI — GovPilot — ADDSEL0.
- Atlantic City, NJ — GovPilot — ADDSEL.
- Bladensburg, MD — GovPilot — ADDSEL.
- Brielle, NJ — GovPilot — no ASTYPE declaration.
- Harvey, IL — GovPilot — ADDSEL.
- Manasquan, NJ — GovPilot — ADDSEL.
- Millstone Township, NJ — GovPilot (Construction Permit Application) — ADDSEL.
- Point Pleasant Beach, NJ — GovPilot — no ASTYPE declaration.
- Pontiac, IL — GovPilot — ADDSEL.
- Rutland, VT — GovPilot — ADDSEL.
- Trenton, NJ — GovPilot (Construction Permit Application) — ADDSEL0.

Excluded other URL shapes (not fetched by this adapter):

- Bergenfield, NJ — https://www.govpilot.com/forms/main/1a45633f-1df/Crane-Permit/Borough-of-Bergenfield/NJ/6928/0.
- Bradley Beach, NJ — https://map.govpilot.com/map/NJ/bradleybeach.
- Elizabeth, NJ — https://www.govpilot.com/forms/main/c5ba88b3-d0d/Construction-Permit/City-of-Elizabeth/NJ/7414/0.
- Grand Terrace, CA — https://eforms-main.govpilot.com/CA/grandterracecitysanbernardinoca.
- Kingsburg, CA — https://eforms-main.govpilot.com/CA/kingsburgca.
- Montvale, NJ — https://eforms-main.govpilot.com/NJ/montvale.
- North College Hill, OH — https://main.govpilot.com/jet/public.html?fid=9CDE6778-A30F-4527-8D85-CEDC4F3D4791.
- Pompton Lakes, NJ — https://map.govpilot.com/map/NJ/pomptonlakes.
- Rockport, ME — https://map.govpilot.com/map/ME/rockporttownme.

## 6. Known gaps, fixtures and validation

Follow up on Cloudpermit public building records and GovPilot's public maps separately. Validate the remaining 10 lookup configurations with real records before claiming them as tested. Investigate public record detail and sanctioned date feeds; do not infer dates from permit numbers, use inspection-request mutation operations, enumerate record IDs, or claim alerts from this adapter. Historical control-only rows need a separate source for actual permit numbers.

The fixtures are real response bodies fetched on 2026-10-10. `provenance.json` records each captured URL, query, status and timestamp; `form-survey.json` records the full direct-form audit. Unit tests perform no network access.

Validation: `npx vitest run --configLoader runner server/scrapers/cityview.test.ts server/scrapers/govpilot.test.ts` passed 26 tests (15 CityView, 11 GovPilot). `npx tsc --noEmit -p .` passed. The default Vitest config bundler failed before tests with EROFS writing `node_modules/.vite-temp`; the runner option executes the same repository config without that write. No unrelated files were changed.
