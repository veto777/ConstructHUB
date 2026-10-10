FTG Portal adapter report — live verification 2026-10-10 UTC

1. Platform & mechanism

Public ASP.NET FTGSearchControl form at /Permits/Search.aspx, preserving the tenant host, microapp query, cookies and hidden form state. Requests are read-only Search posts. SearchResults.aspx is reached through the portal redirect; advertised Next Page links are followed until exhausted. Header-based parsing requires an Application ID/permit column and preserves the untouched recorded response fixtures. Authentication-free on Sarasota. The Sarasota URL comes from server/data/permit-portals.json, not an invented host. No browser, login, database or storage-backed scraper.

All requests use politeFetch with the ConstructHUB User-Agent/contact URL and at least 1000 ms per host (or the larger ctx delay). HTTP blocking is propagated; challenges are not bypassed. HTML errors and unrecognized result pages throw. The four registry wrappers were replaced; Skagit County and the other legacy lines were left alone.

2. Capabilities

Search: address (street number/street name), permit/application ID, name (owner), company (contractor/agent). listRecent: yes, Application Date within dropdown. Selects a real bounded Last 30 days/3 months/1 year option covering since, follows all pages, then filters the explicit application date to since. This is a date listing, not brute-force permit searching. Requests outside the available bounded windows throw instead of using an unrestricted all-permits scan. detail: no; public Inquiry.aspx source links are retained but detail field extraction is not yet implemented. Applied dates are not mislabeled as issue dates.

3. Live tests

Counts below are complete normalized permit counts, not fabricated examples. Null means the portal response did not establish that field. Times are UTC start time and elapsed wall seconds. Date queries used since=2026-10-03. A test returning one record has only one sample; a zero-result/error test has no sample.

Tenant: Sarasota, FL

URL: https://ftgportal.sarasotafl.gov/Permits/Search.aspx?microapp=c

- address "1560 Main": 10 records (2026-10-10T17:52:02.639Z; 2.381 seconds).

```json
[
  {
    "permitNumber": "20153988",
    "address": "1560 MAIN ST",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2015-03-31"
  },
  {
    "permitNumber": "2021-010051",
    "address": "1560 MAIN ST",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2021-07-19"
  }
]
```

- permit "20153988": 1 records (2026-10-10T17:52:05.020Z; 3.110 seconds).

```json
[
  {
    "permitNumber": "20153988",
    "address": "1560 MAIN ST",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2015-03-31"
  }
]
```

- company "WILLIS": 490 records (2026-10-10T17:52:08.131Z; 39.119 seconds).

```json
[
  {
    "permitNumber": "20168072",
    "address": "1825 DR MARTIN LUTHER KING JR WAY",
    "status": "Plan Disapproved",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2016-09-23"
  },
  {
    "permitNumber": "2024-002872",
    "address": "1150 DR MARTIN LUTHER KING JR WAY",
    "status": "Plan Approved",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2024-01-03"
  }
]
```

- recent "2026-10-03": 171 records (2026-10-10T17:52:47.250Z; 44.170 seconds).

```json
[
  {
    "permitNumber": "2026-014020",
    "address": "3835 CALLIANDRA DR",
    "status": "Pending Pre-Pay",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2026-10-08"
  },
  {
    "permitNumber": "2027-000175",
    "address": "3158 SARALAKE CIR.",
    "status": "Pending Pre-Pay",
    "issuedAt": null,
    "contractorName": null,
    "appliedAt": "2026-10-06"
  }
]
```

- empty "ZZZCONSTRUCTHUB": FAILED, count unknown (2026-10-10T17:56:47.880Z; 2.364 seconds). Unrecognized FTG result page (not an empty search)

- address "ZZZCONSTRUCTHUB": 0 records (2026-10-10T17:59:51.986Z; 2.361 seconds).

4. Blocked / failed tenants

No HTTP block or login wall on Sarasota. A deliberately nonexistent address returned the portal's explicit "The entered criteria did not yield any results" response, and the final adapter returns []. There were no other supplied FTG tenants to attempt. Early parser failures for the Application ID column and empty-result wording were corrected using the real responses and are covered by tests.

5. Coverage

0 / 0 FTG entries in targets.json; the complete supplied file has 285 entries and none has an FTG label. Therefore three real FTG tenants from that file cannot be verified. One additional real tenant, Sarasota, was verified using the repository-listed URL https://ftgportal.sarasotafl.gov/Permits/Search.aspx?microapp=c. Registered labels: FTG Portal and FTG. Do not claim three-tenant FTG coverage.

Registered platform labels (case-insensitive lookup):

`FTG Portal`, `FTG`.

6. Known gaps and follow-up

Only one tenant verified; obtain at least two additional independently sourced FTG URLs before claiming broader compatibility. No detail extraction or license search. Date windows are relative to the portal's clock; the adapter selects a conservatively wider available window, then compares ISO calendar dates. Sarasota's 30-day query required 43 result pages (plus one search-form fetch in the recorded replay) to produce 171 records since 2026-10-03. Hourly polling can therefore be expensive; a tenant-provided narrower date endpoint would be preferable if it exists. The 1000-page ceiling and unknown application dates throw instead of returning partial recent data.

Validation: all four adapter suites pass offline, 30 tests total, using real recorded responses. Command: `npx vitest run --configLoader runner server/scrapers/smartgov.test.ts server/scrapers/etrakit.test.ts server/scrapers/click2gov.test.ts server/scrapers/ftg.test.ts`. The default Vitest config bundler fails with EROFS because node_modules/.vite-temp is read-only in this environment; runner avoids that write and uses the existing repository config. `npx tsc --noEmit -p .` passes. Tests do not make network requests. No app server or database was started.
