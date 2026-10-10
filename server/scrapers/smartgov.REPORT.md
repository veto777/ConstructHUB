SmartGov adapter report — live verification 2026-10-10 UTC

1. Platform & mechanism

Public HTTP GET and form POST on *.smartgovcommunity.com. Derives the origin from ctx.searchUrl; uses /ApplicationPublic/ApplicationSearch/AdvancedSearch followed by the advertised ApplicationSearchAdvanced/Search form action for field searches, with Module=Permitting to exclude license records. SearchPage follows the actual zero-based page controls. Public detail actions redirect to /PermittingPublic/PermitLandingPagePublic/Index/<record-id>. Authentication-free on all three tested tenants. Isolated cookies and the public JavaScript form timestamp validator are preserved. No browser, storage import, database, login, or legacy scrape function is used.

All requests use politeFetch with the ConstructHUB User-Agent/contact URL and at least 1000 ms per host (or the larger ctx delay). HTTP blocking is propagated; challenges are not bypassed. HTML errors and unrecognized result pages throw. The four registry wrappers were replaced; Skagit County and the other legacy lines were left alone.

2. Capabilities

Search: address, permit, name (primary contact), company (primary contractor). listRecent: yes, IssuedOn date range from the requested day through today, with all result pages. detail: yes, exact permit match followed by the public detail action. No license or keyword search is advertised: the public basic keyword form mixes permits and licenses, so it is not safe to expose as a permit-only search. Unknown values remain null. Search-row names have no role labels, so they are retained in raw instead of guessed to be contractors. The status date is only mapped to issuedAt when the status explicitly starts with Issued; closed/expired dates are not treated as issue dates. Detail uses explicitly labeled dates and contact roles.

3. Live tests

Counts below are complete normalized permit counts, not fabricated examples. Null means the portal response did not establish that field. Times are UTC start time and elapsed wall seconds. Date queries used since=2026-10-03. A test returning one record has only one sample; a zero-result/error test has no sample.

Tenant: Coconino County, AZ

URL: https://co-coconino-az.smartgovcommunity.com/Public/Home

- address "Main": 11 records (2026-10-10T17:49:04.279Z; 3.245 seconds).

```json
[
  {
    "permitNumber": "PZ-LDP-00-099",
    "address": "MAINE AVE, PARKS, AZ",
    "status": "Step 5 of 7: ISSUED - Permit has been issued. If applicable, scroll to the \"Inspections\" section to request inspections in the order shown in your portal. Refer to the Inspector Area Schedule as applicable to your permit type. Inspections requested out of order may be charged re-inspection fees. A request for a date DOES NOT mean it has been scheduled. If you have a minor revision to your plans, please e-mail plansubmittals@coconino.az.gov to request the Revision After Issue process.",
    "issuedAt": "2011-05-31",
    "contractorName": null
  },
  {
    "permitNumber": "PZ-LDP-01-072",
    "address": "MAINE AVE, PARKS, AZ",
    "status": "Step 5 of 7: ISSUED - Permit has been issued. If applicable, scroll to the \"Inspections\" section to request inspections in the order shown in your portal. Refer to the Inspector Area Schedule as applicable to your permit type. Inspections requested out of order may be charged re-inspection fees. A request for a date DOES NOT mean it has been scheduled. If you have a minor revision to your plans, please e-mail plansubmittals@coconino.az.gov to request the Revision After Issue process.",
    "issuedAt": "2011-04-08",
    "contractorName": null
  }
]
```

- permit "PZ-LDP-00-099": 1 records (2026-10-10T17:49:07.524Z; 3.017 seconds).

```json
[
  {
    "permitNumber": "PZ-LDP-00-099",
    "address": "MAINE AVE, PARKS, AZ",
    "status": "Step 5 of 7: ISSUED - Permit has been issued. If applicable, scroll to the \"Inspections\" section to request inspections in the order shown in your portal. Refer to the Inspector Area Schedule as applicable to your permit type. Inspections requested out of order may be charged re-inspection fees. A request for a date DOES NOT mean it has been scheduled. If you have a minor revision to your plans, please e-mail plansubmittals@coconino.az.gov to request the Revision After Issue process.",
    "issuedAt": "2011-05-31",
    "contractorName": null
  }
]
```

- company "PWI SOLAR": 1 records (2026-10-10T17:49:10.541Z; 3.060 seconds).

```json
[
  {
    "permitNumber": "BD-11-0516",
    "address": "12913 E OLD ROUTE 66",
    "status": "Step 7 of 7: CLOSED - This permit has completed the process and been closed.",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- recent "2026-10-03": 78 records (2026-10-10T17:49:13.601Z; 9.825 seconds).

```json
[
  {
    "permitNumber": "EQ-26-0931",
    "address": "1622 BELLAVISTA LOOP, WILLIAMS, AZ",
    "status": "Step 5 of 7: ISSUED - Permit has been issued. If applicable, scroll to the \"Inspections\" section to request inspections in the order shown in your portal. Refer to the Inspector Area Schedule as applicable to your permit type. Inspections requested out of order may be charged re-inspection fees. A request for a date DOES NOT mean it has been scheduled. If you have a minor revision to your plans, please e-mail plansubmittals@coconino.az.gov to request the Revision After Issue process.",
    "issuedAt": "2026-10-09",
    "contractorName": null
  },
  {
    "permitNumber": "EQ-26-0920",
    "address": "2146 BLUE RIDGE DR, HAPPY JACK, AZ",
    "status": "Step 5 of 7: ISSUED - Permit has been issued. If applicable, scroll to the \"Inspections\" section to request inspections in the order shown in your portal. Refer to the Inspector Area Schedule as applicable to your permit type. Inspections requested out of order may be charged re-inspection fees. A request for a date DOES NOT mean it has been scheduled. If you have a minor revision to your plans, please e-mail plansubmittals@coconino.az.gov to request the Revision After Issue process.",
    "issuedAt": "2026-10-09",
    "contractorName": null
  }
]
```

- detail "PZ-LDP-00-099": 1 records (2026-10-10T17:57:17.296Z; 4.150 seconds).

```json
[
  {
    "permitNumber": "PZ-LDP-00-099",
    "address": "MAINE AVE, PARKS, AZ",
    "status": "Expired",
    "issuedAt": "2011-05-31",
    "contractorName": null
  }
]
```

Tenant: Stevens County, WA

URL: https://co-stevens-wa.smartgovcommunity.com/Public/Home

- address "Main": 0 records (2026-10-10T17:49:33.074Z; 2.370 seconds).

- company "Construction": 4 records (2026-10-10T17:49:35.445Z; 2.971 seconds).

```json
[
  {
    "permitNumber": "RB-24-0130",
    "address": "4455 WILLIAMS VALLEY RD, CLAYTON, WA",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "RB-23-0036",
    "address": "6584 STONY WAY, NINE MILE FALLS, WA",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- recent "2026-10-03": 33 records (2026-10-10T17:49:38.417Z; 5.789 seconds).

```json
[
  {
    "permitNumber": "SA-26-289",
    "address": "NKA address, Kettle Falls, wa",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "SLE-26-034",
    "address": "NKA address, Kettle Falls, wa",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- permit "RB-24-0130": 1 records (2026-10-10T17:56:14.428Z; 2.255 seconds).

```json
[
  {
    "permitNumber": "RB-24-0130",
    "address": "4455 WILLIAMS VALLEY RD, CLAYTON, WA",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- detail "RB-24-0130": 1 records (2026-10-10T17:58:35.419Z; 4.216 seconds).

```json
[
  {
    "permitNumber": "RB-24-0130",
    "address": "4455 WILLIAMS VALLEY RD, CLAYTON, WA 99110",
    "status": "Closed",
    "issuedAt": "2024-08-30",
    "contractorName": null
  }
]
```

Tenant: Oro Valley, AZ

URL: https://twn-orovalley-az.smartgovcommunity.com/Public/Home

- address "La Canada": 7 records (2026-10-10T17:51:12.879Z; 2.290 seconds).

```json
[
  {
    "permitNumber": "2501935",
    "address": "La Canada Drive, Oro Valley, AZ",
    "status": "Permit Issued",
    "issuedAt": "2025-09-24",
    "contractorName": null
  },
  {
    "permitNumber": "2500630",
    "address": "La Canada From CDO Bridge/Lambert Ln La Canada/ Canada Hills/Oro Valley CC, Oro Valley, AZ",
    "status": "Permit Issued",
    "issuedAt": "2025-03-28",
    "contractorName": null
  }
]
```

- permit "2501935": 1 records (2026-10-10T17:51:15.170Z; 2.996 seconds).

```json
[
  {
    "permitNumber": "2501935",
    "address": "La Canada Drive, Oro Valley, AZ",
    "status": "Permit Issued",
    "issuedAt": "2025-09-24",
    "contractorName": null
  }
]
```

- company "Construction": 14 records (2026-10-10T17:51:18.166Z; 3.896 seconds).

```json
[
  {
    "permitNumber": "2301512",
    "address": "781 E CAMINO CORRIDA, TUCSON, AZ",
    "status": "Closed / COO",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "2202532",
    "address": "1130 W MOONLIT PL, TUCSON, AZ",
    "status": "Closed / COO",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- recent "2026-10-03": 40 records (2026-10-10T17:51:22.062Z; 5.969 seconds).

```json
[
  {
    "permitNumber": "2601906",
    "address": "2443 E NASTURTIUM ST, TUCSON, AZ",
    "status": "Permit Issued",
    "issuedAt": "2026-10-09",
    "contractorName": null
  },
  {
    "permitNumber": "2602118",
    "address": "11590 N CIVANO PL, TUCSON, AZ",
    "status": "Permit Issued",
    "issuedAt": "2026-10-09",
    "contractorName": null
  }
]
```

- detail "2501935": 1 records (2026-10-10T17:57:59.829Z; 4.160 seconds).

```json
[
  {
    "permitNumber": "2501935",
    "address": "La Canada Drive, Oro Valley, AZ",
    "status": "Expired",
    "issuedAt": "2025-09-24",
    "contractorName": null
  }
]
```

4. Blocked / failed tenants

No blocking or login requirement on the three tested tenants. Stevens address Main returned a genuine empty-result response. No requests were made to the Sachse short link. Parser development found a different advanced-search row layout; the final parser and recorded-response tests cover both basic and advanced layouts.

5. Coverage

152 / 153 SmartGov targets have the supported URL shape, or 152 / 285 of the entire supplied target file. Sachse, TX (https://bit.ly/SachsePermits) is excluded because it is a short link rather than a SmartGov tenant URL. Resolve and independently verify its destination before adding it. This is URL-shape coverage, not a claim that all 152 tenants are accessible.

Registered platform labels (case-insensitive lookup):

`SmartGov`, `SmartGov (Granicus)`, `SmartGov (Planning & Development portal)`, `SmartGov (via city redirect)`, `SmartGov Citizen Portal`, `SmartGov Community Portal`, `SmartGov Community portal`, `SmartGov Online Permit Center`, `SmartGov Online Permit Portal`, `SmartGov Online Permitting`, `SmartGov Online Permitting and Inspection Portal`, `SmartGov Online Portal`, `SmartGov Permit & Development Portal`, `SmartGov Permit Center`, `SmartGov Permit Management & Tracking`, `SmartGov Permit Portal`, `SmartGov Permitting & Licensing Portal`, `SmartGov Public Permit Portal`, `SmartGov Public Portal`, `SmartGov Public Portal (Granicus)`, `SmartGov Public Portal (via county permitting link)`, `SmartGov building permits online`, `SmartGov citizen portal`, `SmartGov community portal`, `SmartGov customer portal`, `SmartGov electronic permit/application system`, `SmartGov permit portal`, `SmartGov portal`, `SmartGov public portal`.

6. Known gaps and follow-up

Other SmartGov hostnames/custom domains and short links are rejected. Tenants without the expected public advanced form fail explicitly. Unlabeled search-row contact names remain null in normalized fields; use detail for explicitly labeled roles. Results are not enriched by issuing one detail request per permit. Name search is implemented; the live matrix focuses on address, permit, contractor and dates. Search has a 1000-page safety ceiling and throws rather than returning a truncated result. Search counts and final-page navigation are checked.

Validation: all four adapter suites pass offline, 30 tests total, using real recorded responses. Command: `npx vitest run --configLoader runner server/scrapers/smartgov.test.ts server/scrapers/etrakit.test.ts server/scrapers/click2gov.test.ts server/scrapers/ftg.test.ts`. The default Vitest config bundler fails with EROFS because node_modules/.vite-temp is read-only in this environment; runner avoids that write and uses the existing repository config. `npx tsc --noEmit -p .` passes. Tests do not make network requests. No app server or database was started.
