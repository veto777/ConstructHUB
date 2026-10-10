# MyGov adapter report — 2026-10-10

## 1. Platform and mechanism

MyGov is distinct from MyGovernmentOnline. Anonymous public search works on `https://public.mygov.us/<tenant>` and stored `/lookup`, `/module`, and `/templates` paths. The adapter derives the tenant slug from the exact stored URL, upgrades HTTP to HTTPS, and rejects unrelated hosts, credentials, ports, unrecognized paths and legacy app URLs.

Mechanism: GET `/<tenant>/lookup` establishes an anonymous PHP session and verifies a real city ID and the lookup component. POST `/<tenant>/getLookupResults` with `address_search` returns locations. For each location, POST `/oac/home/getLocationModules` with `location_id`; only `pi` (Permits) is followed. POST `/oac/home/getLocationModuleProjects` with `location_id` and `module=pi` returns the permit projects. Endpoints were discovered in the publicly served `AddressLookup-Cx5bNaup.js` bundle. Cookies stay within one invocation and the one fixed public host. No login, browser, CAPTCHA solving, writes to records or proxy is used. Each request uses politeFetch, the ConstructHUB user agent and at least 1,000 ms per host.

## 2. Capabilities

- Search: address only, at least three characters. More than 50 location matches throws a request-to-narrow error rather than silently truncating or crawling a whole town. All visible projects for each matched location are returned; the result count is checked against the public module count.
- Permit number, name, company, license and keyword: unsupported; these throw. Public address lookup is not reinterpreted as another search type.
- listRecent: false. Returns `[]` without requests, never brute-forces addresses. No generic issue/application date listing was verified. Crowley does publish tenant-configured PDF/Excel monthly reports, so this is not a claim that no MyGov tenant ever publishes date-based data. Those report schemas and coverage are not implemented.
- Detail: false. A location/project-ID details XHR exists but there is no verified permit-number resolver or record-specific public page. The adapter does not claim standalone detail support.
- Unknown fields are null. `code_id` is the displayed project/permit number, title becomes permitType, status_title becomes status, and the complete untouched project row is raw. `date_created` is project creation and `date_completed` may mean archived; neither is mislabeled as issuedAt/appliedAt. Contractor and issue/application dates are not returned by the verified listing. No record deep link was found, so sourceUrl is null.

## 3. Live tests

All runs used the repository live-harness, on 2026-10-10 UTC. Elapsed time includes npx/Node startup. A blocked/unsupported search has no result count; it is not a successful zero-result query.

### Crowley, TX

URL: https://public.mygov.us/crowley_tx

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address 1005 W Main | 2026-10-10T17:49:54.028942+00:00 | 7.716 | 55 records |
| search permit 24-000750 | 2026-10-10T17:50:01.745826+00:00 | 0.563 | UNSUPPORTED: MyGov public lookup does not support permit search; only address is verified |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:02.309596+00:00 | 0.549 | 0 records; capability false, local unsupported return, no portal request |

Two actual returned sample records:

```json
[
  {
    "permitNumber": "26-000014",
    "address": "1005 W Main St, Crowley, TX 76036",
    "status": "In Review",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "26-000007",
    "address": "1005 W Main St, Crowley, TX 76036",
    "status": "Archived",
    "issuedAt": null,
    "contractorName": null
  }
]
```

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

### Russell, KS

URL: https://public.mygov.us/russell_ks

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address 832 N Main | 2026-10-10T17:50:02.859445+00:00 | 3.776 | 0 records |
| search permit 2026 | 2026-10-10T17:50:06.637081+00:00 | 0.558 | UNSUPPORTED: MyGov public lookup does not support permit search; only address is verified |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:07.196468+00:00 | 0.553 | 0 records; capability false, local unsupported return, no portal request |

Sample records: none. The search returned no public permit projects or was blocked, as recorded above; two real samples are unavailable.

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

### Barling, AR

URL: https://public.mygov.us/barling_ar

| Query | Started UTC | Seconds | Result |
|---|---|---:|---|
| search address Main | 2026-10-10T17:50:07.750241+00:00 | 2.821 | 0 records |
| search permit 2026 | 2026-10-10T17:50:10.572641+00:00 | 0.572 | UNSUPPORTED: MyGov public lookup does not support permit search; only address is verified |
| recent 2026-10-03T17:49:54.028926+00:00 | 2026-10-10T17:50:11.146449+00:00 | 0.572 | 0 records; capability false, local unsupported return, no portal request |

Sample records: none. The search returned no public permit projects or was blocked, as recorded above; two real samples are unavailable.

Contractor/company/license/name search: unsupported, so no contractor query was submitted.

Additional live Crowley queries: address `412 E Main` returned 1 record in 3 seconds (harness rounded time): permit `24-000750`, address `412 E Main St, Crowley, TX 76036`, status `Archived`, issuedAt null, contractorName null. Address `408 E Main` returned 0 records in 2 seconds. Broad discovery query `Main` returned more than 50 address locations, not a permit list. Russell location queries `340 S Main St.` and `1205 S Main St` returned empty project arrays during reconnaissance.

## 4. Blocked or failed tenants

No 401/403/429 or CAPTCHA was encountered on the three MyGov tenants tested. Unsupported permit searches intentionally throw before making a request. Barling's actual source returns a placeholder-looking location `100 Main St, City Name, AK 11111`; all public module project counts there are zero. No permit record is created from that location. The unchanged response is retained as evidence.

## 5. Coverage

72 of 75 MyGov-labelled target entries have a supported public URL shape (72 of all 141 assigned entries). Only three tenants were live tested; URL-shape coverage is not proof that all 72 have searchable public permits. Registry labels: `MyGov`, `MyGov Permits & Licenses`, `MyGov public portal`, `MyGov permits` (all four distinct labels in this vendor's targets).

Excluded legacy URLs:

- Augusta, KS — `https://app.mygov.us/create_login_next.php?cityid=845`: account creation.
- University City, MO — `https://app.mygov.us/pi/citizen/download_forms.php?citiesID=362`: legacy form download.
- Watauga, TX — `https://app.mygov.us/pi/citizen/download_forms.php?citiesID=401`: legacy form download.

The adapter does not guess replacement slugs. Stored templates/module URLs are resolved to their tenant's public lookup, including license-template links; lookup availability is validated at runtime.

## 6. Known gaps and follow-up

No hourly alerts, permit-number search, contractor search, or standalone detail are enabled. Follow-up should inspect additional tenant-configured public reports and verify their field/date semantics before adding date support; locate legitimate public lookup URLs for the three legacy entries; and survey the remaining 69 public-shaped tenants. Generic address queries need narrowing when they exceed 50 locations. Concurrent record changes can trigger an explicit incomplete-count error rather than return partial data.

Validation: `npx vitest run --configLoader runner server/scrapers/mygov.test.ts server/scrapers/mgo-connect.test.ts` passed 16 tests across 2 files, offline. `npx tsc --noEmit -p .` passed. The exact default vitest command was attempted but Vite's bundled config loader could not write into the environment's read-only node_modules/.vite-temp (EROFS); the runner loader runs the same repository config and tests without that write. No app server or database was started.
