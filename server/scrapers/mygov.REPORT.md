# MyGov adapter report — 2026-10-10, name/company search added 2026-10-14

## 1. Platform and mechanism

MyGov is distinct from MyGovernmentOnline. Anonymous public search works on `https://public.mygov.us/<tenant>` and stored `/lookup`, `/module`, and `/templates` paths. The adapter derives the tenant slug from the exact stored URL, upgrades HTTP to HTTPS, and rejects unrelated hosts, credentials, ports, unrecognized paths and legacy app URLs.

Mechanism: GET `/<tenant>/lookup` establishes an anonymous PHP session and verifies a real city ID and the lookup component. POST `/<tenant>/getLookupResults` with `address_search` returns locations. For each location, POST `/oac/home/getLocationModules` with `location_id`; only `pi` (Permits) is followed. POST `/oac/home/getLocationModuleProjects` with `location_id` and `module=pi` returns the permit projects. Endpoints were discovered in the publicly served `AddressLookup-Cx5bNaup.js` bundle. Cookies stay within one invocation and the one fixed public host. No login, browser, CAPTCHA solving, writes to records or proxy is used. Each request uses politeFetch, the ConstructHUB user agent and at least 1,000 ms per host.

## 2. Capabilities

- Search: address only, at least three characters. More than 50 location matches throws a request-to-narrow error rather than silently truncating or crawling a whole town. All visible projects for each matched location are returned; the result count is checked against the public module count.
- Permit number, license and keyword: unsupported; these throw. Name and company: only on the six tenants in section 7 (published reports), never through the lookup. Public address lookup is not reinterpreted as another search type.
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

No hourly alerts, permit-number search or standalone detail are enabled. Contractor/name search exists only through the published reports in section 7. Follow-up should inspect additional tenant-configured public reports and verify their field/date semantics before adding date support; locate legitimate public lookup URLs for the three legacy entries; and survey the remaining 69 public-shaped tenants. Generic address queries need narrowing when they exceed 50 locations. Concurrent record changes can trigger an explicit incomplete-count error rather than return partial data.

Validation: `npx vitest run --configLoader runner server/scrapers/mygov.test.ts server/scrapers/mgo-connect.test.ts` passed 16 tests across 2 files, offline. `npx tsc --noEmit -p .` passed. The exact default vitest command was attempted but Vite's bundled config loader could not write into the environment's read-only node_modules/.vite-temp (EROFS); the runner loader runs the same repository config and tests without that write. No app server or database was started.

## 7. Name/company search through published tenant reports — verified live 2026-10-14

### What the public portal offers (checked 2026-10-14 UTC, anonymous, ≤1 request/s)

- The lookup is address-only. The public bundle `AddressLookup-Cx5bNaup.js` sends only `address_search` to `getLookupResults`; the other calls are `getLocationModules`, `getLocationModuleProjects`, `getModuleProjectDetails` (`id`, `module`, `location_id`), `getModuleProjectDocuments` and `gettotalamountdue`. There is no name, contractor, applicant, owner or keyword parameter.
- Project rows and project details have no contact fields. Crowley location 305 (1005 W Main) returned 30 `pi` projects. Their keys are `id, project_id, title, status, date_created, date_completed, date_status, code_id, description, flag_archived, module, item_date_started, item_date_archived, department_id, closing_status, flag_project_details, last_project_status, …, status_title, case_title`. Details for 29858, 29596, 26934 and 26143 add only `case_id`, `audits` (status steps), `documents` and `attached_docs` (PDF links). Generated permit PDFs may name a contractor, but they can only be reached address-first, so they don't give a name search.
- Some tenants publish reports at `/<tenant>/templates?module=reports` ("All reports"; `/<tenant>/module?module=reports` shows the top 5 only). Anyone can download them with GET `/<tenant>/downloadReport?moduleName=pi&id=<n>`, which returns `Content-Disposition: attachment; filename="<title>.xlsx|.pdf"`. These reports are configured per tenant, and several Excel ones have a `Permit Number` column plus named-contact columns.

### Survey of all 77 public.mygov.us tenants in server/data/permit-portals.json

- 63 publish no reports at all, including Canyon, Ferris and Dickinson TX. Fate (one report) and Rowlett (five) publish only non-permit reports.
- 12 publish permit (`moduleName=pi`) reports: Chickasha OK, Commerce TX, Crescent City CA, Crowley TX, Lancaster TX, Little Elm TX, Paris TX, Abilene TX, Texarkana TX, Westlake TX, Wichita Falls TX, Windham ME. All their permit reports were downloaded once and classified. Two Abilene reports (389, 390) answered HTTP 403 and were not retried.
- Not enabled: Westlake and Wichita Falls (PDF only); Crescent City (PDFs, and the one XLSX has no name column, only staff `Project Manager`); Chickasha (no name column); Commerce (itinerant-merchant PDF); Windham (name-bearing XLSX are stale, Feb 2025, or 2 rows); Texarkana's 5-year report 369 (no `Permit Number` column, so no record without inventing an identifier). PDFs are not parsed.

### Enabled tenants (`MYGOV_NAME_REPORTS`, registered by jurisdiction in registry.ts)

| Tenant | Report id — title | Name columns used | Observed issued-date window (2026-10-14) | Permits |
|---|---|---|---|---:|
| crowley_tx | 313 — Yearly Report of ALL Issued Permits (posted monthly) (Excel) | Name + Business Name (one row per contact), Property Contacts | 2025-10-01 – 2026-09-30 | 1,319 |
| crowley_tx | 375 — Report of Open Permits (Excel) | Name + Business Name | 2023-10-02 – 2026-09-30 | 1,002 |
| tx_texarkana | 280 — Permits Issued in the last year - YTD | Collaborators | 2025-01-02 – 2026-09-17 | 2,654 |
| tx_texarkana | 370 — Permits Issued in the last month | Collaborators | 2026-09-01 – 2026-10-02 | 289 |
| little_elm_tx | 15 — All Issued Permits - Commercial, Residential, and Pools (Within One Month) (LOCATIONS) | Contractor Name, Contractor Contact, Credential Contacts (role in parentheses) | 2026-01-03 – 2026-09-30 (the title says one month; the data covers more) | 1,952 |
| lancaster_tx | 15 — DCAD Report [LOCATIONS] | Credential Contacts | 2026-09-01 – 2026-09-30 | 143 |
| tx_abilene | 371 — TCADBuildingPermitsWithProjInfo | Issued To, Property Contacts, CO/TCO Issued To | 2026-09-01 – 2026-09-30 | 546 |
| tx_abilene | 423 — Irrigation Permits | Applicant, Credential Contacts, Collaborators, Property Contacts, Issued To | 2023-03-29 – 2025-04-15 | 214 |
| paris_texas | 372 — All Permits Media w/ Solar | Applicant | 2026-09-01 – 2026-09-29 | 69 |

Coverage is only each report's window, and the tenant regenerates the report on its own schedule. A name search on these tenants does not cover every permit the city ever issued.

### Mechanism and field semantics

- One GET per listed report (≥1,000 ms per host). Nothing else is requested: no lookup page and no session. The response must be an XLSX whose `Content-Disposition` file name equals the verified title. A renamed or repurposed report id throws. Files over 25 MB are refused. The XLSX is read with a small built-in ZIP/XML reader (`node:zlib`), with no new dependency.
- Rows are grouped into one record per permit number + address + type. Texarkana reuses numbers such as 25-000001 and 25-000002 for unrelated projects, and those stay separate.
- `Contractor Name` → `contractorName`. `Applicant` → `applicantName`, with phone numbers and e-mails removed. Every other name column has no role, or states it inside the text ("X Co (Plumbing Contractor)", "(owner)"). Those go to `raw.listedNames`, never `contractorName`; the research matcher already reads that field.
- Phone, mobile, e-mail, physical/mailing address, `Project Contacts Details` and staff columns (`Created By`, `Project Manager`, `* Issued By`) are dropped from `raw`.
- `Permit Issued Date` → `issuedAt`, `Expire Date` → `expiresAt`, and `Project Valuation` → `valuation` only when above 0. `Date Started` is project creation and is not used as `appliedAt`.
- `sourceUrl` is the public report download URL; there is no per-record page. `raw.report` records the report id, title, URL, permit count and the observed issued-date range.
- Matching: every word (≥2 characters) of the query must be a whole word of one name field: `contractorName`, `applicantName`, or one listed contact. Descriptions are not matched. Words split across two different contacts do not match.
- Tenants not in the table keep the platform adapter (address-only), so the research report still says "This portal has no name or company search" for them instead of reporting an error.

### Live smoke test (adapter, 2026-10-15T01:17Z = 2026-10-14 US time; names taken from each portal's own report)

| Tenant | Query | Hits | Seconds | Example |
|---|---|---:|---:|---|
| crowley_tx | company "Homepro Operating" | 235 | 2.2 | 24-001057, issued 2025-10-06, 900 Compass Rd |
| tx_texarkana | company "Perez Roofing" | 31 | 1.3 | 25-000001, issued 2025-01-02, 1924 W 13th |
| little_elm_tx | company "Warrior 153 Construction" | 1 | 1.1 | 26-002763, issued 2026-09-14, 1020 W Eldorado Pkwy. |
| lancaster_tx | company "TriVAN Roofing" | 1 | 0.9 | 26-002108, issued 2026-09-03, 526 N I-35E |
| tx_abilene | company "Quality Homes of Abilene" | 1 | 2.2 | 26-005617, issued 2026-09-18, 641 Matthew Ct |
| paris_texas | name "Ilya Lukasevich" | 1 | 0.7 | 26-001306, issued 2026-09-14, 2101 Lamar Ave., 101 |

All nine report file names matched their verified titles. No 401/403/429 or CAPTCHA was seen on these downloads.

### Tests

The `*-report-*.xlsx` fixtures are trimmed real downloads with contact details redacted (see fixtures/mygov/README.md). The tests cover:
- XLSX reading
- contact-row folding
- Texarkana's reused numbers
- labelled vs listed roles
- applicant contact-detail stripping
- refusal of reports without permit numbers or name columns
- one download per report, at ≥1,000 ms
- whole-word matching
- renamed-report and other-tenant refusal
- jurisdiction-only registration

### Follow-up

- Re-survey reports periodically: tenants add, rename and delete them.
- Ask Texarkana or MyGov whether report 369 (5 years) can include `Permit Number`.
- PDF-only tenants (Westlake, Wichita Falls) would need a PDF table parser, which has not been verified.
