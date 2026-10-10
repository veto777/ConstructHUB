eTRAKiT adapter report — live verification 2026-10-10 UTC

1. Platform & mechanism

Public ASP.NET form requests with cookies, __VIEWSTATE, __EVENTVALIDATION, discovered field values and __EVENTTARGET. Derives the application root from /eTRAKiT/, /etrakit3/, /etrakit_prod/, /community-etrakit/, or a web-root installation and requests Search/permit.aspx. The response must identify eTRAKiT and expose a public permit-search form. Nothing is hard-wired to Bellingham. Telerik paging uses the actual grid name and Page;Next postback; custom NextPage controls are handled. Authentication-free permit searches were verified on Hillsborough, Shasta and Hanover. No browser, storage, database or legacy scraper calls.

All requests use politeFetch with the ConstructHUB User-Agent/contact URL and at least 1000 ms per host (or the larger ctx delay). HTTP blocking is propagated; challenges are not bypassed. HTML errors and unrecognized result pages throw. The four registry wrappers were replaced; Skagit County and the other legacy lines were left alone.

2. Capabilities

Search: address and permit; keyword, name, company and license are conditional on an explicitly labeled matching field in that tenant's permit-search dropdown. Missing fields throw instead of falling back to permit numbers or emitting contractor-directory entries as permits. None of the three tested tenants exposed a direct contractor/name/license permit filter. listRecent: yes at the platform level, using the Issued field with the public At Least operator and complete paging. Hillsborough supports it; Shasta and Hanover do not expose Issued and throw a descriptive unsupported-tenant error. The contract has a single platform-wide capability object, so it cannot express this tenant difference; the shared object is never mutated during requests. detail: no, because row-click detail postbacks and their associated contact tabs have not been implemented.

3. Live tests

Counts below are complete normalized permit counts, not fabricated examples. Null means the portal response did not establish that field. Times are UTC start time and elapsed wall seconds. Date queries used since=2026-10-03. A test returning one record has only one sample; a zero-result/error test has no sample.

Tenant: Hillsborough, CA

URL: https://hills-trk.aspgov.com/eTRAKiT/default.aspx

- address "100 Eucalyptus": 7 records (2026-10-10T17:49:15.609Z; 2.393 seconds).

```json
[
  {
    "permitNumber": "03PLB-00458",
    "address": "100 EUCALYPTUS",
    "status": null,
    "issuedAt": "2003-12-30",
    "contractorName": null
  },
  {
    "permitNumber": "05ELC-00014",
    "address": "100 EUCALYPTUS",
    "status": null,
    "issuedAt": "2005-08-02",
    "contractorName": null
  }
]
```

- permit "03PLB-00458": 1 records (2026-10-10T17:49:18.003Z; 2.179 seconds).

```json
[
  {
    "permitNumber": "03PLB-00458",
    "address": "100 EUCALYPTUS",
    "status": null,
    "issuedAt": "2003-12-30",
    "contractorName": null
  }
]
```

- company "Construction": FAILED, count unknown (2026-10-10T17:49:20.183Z; 0.733 seconds). eTRAKiT tenant does not expose company in public permit search

- recent "2026-10-03": 33 records (2026-10-10T17:49:20.916Z; 3.440 seconds).

```json
[
  {
    "permitNumber": "BLD26-0280",
    "address": "25 SOUTHDOWN CT",
    "status": null,
    "issuedAt": "2026-10-05",
    "contractorName": null
  },
  {
    "permitNumber": "COM25-0397",
    "address": "155 BELLA VISTA DR",
    "status": null,
    "issuedAt": "2026-10-05",
    "contractorName": null
  }
]
```

Tenant: Shasta County, CA

URL: https://permits.shastacounty.gov/etrakit/Search/permit.aspx

- address "1855 Placer": 95 records (2026-10-10T17:51:11.726Z; 20.527 seconds).

```json
[
  {
    "permitNumber": "M19-0608",
    "address": "1855 PLACER ST",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "M19-0612",
    "address": "1855 PLACER ST",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

- permit "M19-0608": 1 records (2026-10-10T17:51:32.254Z; 1.623 seconds).

```json
[
  {
    "permitNumber": "M19-0608",
    "address": "1855 PLACER ST",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

- company "Construction": FAILED, count unknown (2026-10-10T17:51:33.877Z; 1.095 seconds). eTRAKiT tenant does not expose company in public permit search

- recent "2026-10-03": FAILED, count unknown (2026-10-10T17:51:34.972Z; 1.017 seconds). eTRAKiT tenant does not expose issued in public permit search

Tenant: Hanover County, VA

URL: https://communitydevelopment.hanovercounty.gov/eTRAKiT/

- address "7516": 157 records (2026-10-10T17:54:22.956Z; 8.675 seconds).

```json
[
  {
    "permitNumber": "BI15-00000658-E",
    "address": "17516 OLD RIDGE ROAD",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "BC2019-00001",
    "address": "7516 COUNTY COMPLEX RD",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

- permit "BI15-00000658-E": 1 records (2026-10-10T17:54:31.631Z; 1.466 seconds).

```json
[
  {
    "permitNumber": "BI15-00000658-E",
    "address": "17516 OLD RIDGE ROAD",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

- company "Construction": FAILED, count unknown (2026-10-10T17:54:33.097Z; 1.111 seconds). eTRAKiT tenant does not expose company in public permit search

- recent "2026-10-03": FAILED, count unknown (2026-10-10T17:54:34.208Z; 1.031 seconds). eTRAKiT tenant does not expose issued in public permit search

4. Blocked / failed tenants

Rockingham County, NC: GET https://permits.rockinghamcountync.gov/etrakit/Search/permit.aspx returned HTTP 200 after redirecting to login.aspx?lt=either&rd=~/Search/permit.aspx; the recorded page has no guest control. Prescott, AZ: GET https://prsct.csqrcloud.com/community-etrakit/Search/permit.aspx returned HTTP 200 after redirecting to login.aspx?lt=contractor&rd=~/Search/permit.aspx; no guest control. These are login walls, not HTTP 401 responses; the adapter reports a logical PortalBlockedError with status 401 on such redirects. No login was attempted. Shasta's actual Search Contractors link is Search/aec.aspx, which also redirects to login. The legacy Search/contractor.aspx path on Hillsborough redirects to EtrakitError2.aspx. Recorded responses document both findings. Shasta and Hanover date-search attempts failed because their public dropdown has no Issued field, not because no permits were issued.

5. Coverage

118 / 119 eTRAKiT targets pass URL-shape derivation, or 118 / 285 of the entire supplied file. Coeur d'Alene, ID (https://building.cdaid.org/Permit/Search.aspx) is excluded: it is not one of the eTRAKiT application-root URL shapes. Root installations still must pass response-brand/form checks. This is syntactic coverage, not 118 verified live deployments; migrated, source-wrapper, stale and login-only entries may fail at runtime.

Registered platform labels (case-insensitive lookup):

`CentralSquare eTRAKiT`, `CentralSquare eTRAKiT online permitting`, `eTRAKiT`, `eTRAKiT (Building Portal)`, `eTRAKiT (CentralSquare cloud)`, `eTRAKiT (CentralSquare)`, `eTRAKiT (independent city)`.

6. Known gaps and follow-up

Contractor-directory traversal is not implemented; those entries must never be emitted as permit records. Follow up on tenants with a public AEC search and implement the associated permit list if available. Conditional company/name/license fields are supported by the request builder but were unavailable on all three verified permit forms. Keyword maps Description where present but was not part of the live query matrix. No detail method yet. Row-click-only results have sourceUrl=null because the grid does not advertise a public record hyperlink. Add tenant-specific alert eligibility outside this static capability contract. Date lower bounds are inclusive calendar days; the portal operator also admits any future issue dates. Paging is tested across two pages of recent records and live across multiple address pages; the 1000-page ceiling throws.

Validation: all four adapter suites pass offline, 30 tests total, using real recorded responses. Command: `npx vitest run --configLoader runner server/scrapers/smartgov.test.ts server/scrapers/etrakit.test.ts server/scrapers/click2gov.test.ts server/scrapers/ftg.test.ts`. The default Vitest config bundler fails with EROFS because node_modules/.vite-temp is read-only in this environment; runner avoids that write and uses the existing repository config. `npx tsc --noEmit -p .` passes. Tests do not make network requests. No app server or database was started.
