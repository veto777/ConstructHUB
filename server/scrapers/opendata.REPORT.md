# Open data adapter report — 2026-10-10

40 jurisdictions: 31 cities and 9 counties, using 39 distinct dataset URLs. There are 12 Socrata configurations, 25 ArcGIS configurations, 2 CKAN configurations, and 1 Carto configuration. Charlotte is a jurisdiction-filtered view of the same official county dataset used for Mecklenburg County. This is a verified major-market selection, not a claim that the exact population-ranked top 40 or every permit category is covered.

Final acceptance: 137 native adapter queries, all successful: 40 address, 15 company, 1 license, 1 name, 40 permit, 40 recent. The 40 seven-day queries returned 14,981 source rows in total; 7 returned zero. Totals include renewals, revisions, repeated permit numbers, and the Charlotte/Mecklenburg overlap; they are not unique national permits. Four jurisdictions had blocked broad fixture probes during development; their final filtered adapter queries succeeded.

## 1. Platform and mechanism

Platform: `Open data`. Authentication: none. Browser: never used. Registry: imported and registered once; no aliases, as explicitly requested for this assignment. Existing transactional portal labels are not intercepted.

Tenant selection uses the exact `ctx.jurisdiction` key and checks `ctx.searchUrl` against that jurisdiction’s recorded catalog URL, verified dataset endpoint, or metadata endpoint. Arbitrary URLs and cross-tenant paths are rejected, including different tenants on the same Accela host. The adapter fetches only the configured official dataset after that check. An absent catalog URL must be replaced with the verified dataset URL by the merge step.

- Socrata: `/resource/<four-four>.json`, native `$where`, `$order=:id`, `$limit`, and `$offset`; metadata `/api/views/<id>.json`.
- ArcGIS: official `FeatureServer/<layer>` and queryable `MapServer/<layer>` services, using `/query`, native `where`, ordered pagination, transfer-limit flags, and WGS84 output geometry.
- CKAN: `/api/3/action/datastore_search_sql`, quoted resource IDs and column names, native SQL predicates and pagination. San Antonio’s fixture uses the documented `datastore_search` endpoint with a permit-type filter.
- Carto: Philadelphia’s city-published `phl.carto.com/api/v2/sql`, table `permits`, native SQL filters and ordered pagination. Official listing: https://opendataphilly.org/datasets/licenses-and-inspections-building-and-zoning-permits/.

All adapter requests use the provided ConstructHUB user-agent and polite-fetch helper, clamping the per-host delay to at least 1,000 ms. HTTP and API errors throw; 401/403/429 and access challenges use `PortalBlockedError`. No login, CAPTCHA solving, proxy, database connection, or application server was used. Pages are fetched until completion; repeated pages and the 1,000-page safety limit throw rather than return a silently truncated result.

## 2. Capabilities

Search: address and exact permit number for all configured datasets; name, company, and license only when the selected dataset (or its verified contacts dataset, section 7) publishes the corresponding mapped fields. Unsupported field searches throw explicitly. Keyword searches use published address, description, and type fields. Text searches are case-insensitive substring searches; split addresses match all input tokens. User LIKE wildcards are rejected. Quotes are escaped. Chicago company searches require the source contact role to begin with CONTRACTOR; all published contractor contact names are retained, separated by semicolons.

`listRecent = true`: native issue-date queries, except Fort Worth and Baltimore County, which list by application date. Calendar-day sources replay the entire since-day for hourly alerts; these sources cannot distinguish time within a day. The poller must deduplicate replays. Floating source timestamps retain their unzoned ISO representation; midnight-only floating dates become YYYY-MM-DD. No UTC offset is invented. Unknown fields, sentinels, invalid coordinates, and unpublished values become null; raw rows/features remain untouched.

`detail = false`: no separate detail scraper was verified. Exact permit search retrieves published dataset records and may return multiple rows for one permit. `sourceUrl` is copied from a published public record link when available, otherwise null.

| Jurisdiction | Kind | Native recent field | Precision | Additional searches |
|---|---|---|---|---|
| New York, NY | socrata | `issued_date` | calendar day | name |
| Los Angeles, CA | socrata | `issue_date` | calendar day | name, company (contacts: CofO, 2026-10-14) |
| Chicago, IL | socrata | `issue_date` | calendar day | name, company |
| Austin, TX | socrata | `issue_date` | calendar day | name, company |
| Seattle, WA | socrata | `issueddate` | calendar day | name, company |
| San Francisco, CA | socrata | `issued_date` | source timestamp | name, company (contacts: 3pee-9qhc, 2026-10-14) |
| Las Vegas, NV | arcgis | `ISSDTTM` | source timestamp | name |
| Miami-Dade County, FL | arcgis | `PermitIssuedDate` | calendar day | name, company, license |
| Columbus, OH | arcgis | `ISSUED_DT` | source timestamp | name |
| Detroit, MI | arcgis | `issued_date` | calendar day | none |
| Minneapolis, MN | arcgis | `issueDate` | source timestamp | name |
| Maricopa County, AZ | arcgis | `IssuedDate` | source timestamp | none |
| Los Angeles County, CA | arcgis | `ISSUANCE_DATE` | source timestamp | none |
| Mecklenburg County, NC | arcgis | `issuedate` | source timestamp | name |
| Portland, OR | arcgis | `ISSUEDATE` | source timestamp | none |
| Cincinnati, OH | socrata | `issueddate` | calendar day | name, company |
| Mesa, AZ | socrata | `issued_date` | calendar day | name, company, license |
| Philadelphia, PA | carto | `permitissuedate` | source timestamp | name, company |
| Nashville, TN | arcgis | `Date_Issued` | source timestamp | none |
| Fort Worth, TX | arcgis | `File_Date` | source timestamp | name |
| Wake County, NC | arcgis | `ISSUE_DATE` | source timestamp | name, company |
| Pierce County, WA | arcgis | `issuedDate` | source timestamp | none |
| Raleigh, NC | arcgis | `issueddate` | source timestamp | name, company, license |
| Tucson, AZ | arcgis | `ISSUEDATE` | source timestamp | none |
| Virginia Beach, VA | arcgis | `Building_Permits_IssueDate` | calendar day | none |
| Baltimore County, MD | arcgis | `APPL_DATE` | source timestamp | name |
| Montgomery County, MD | socrata | `issueddate` | source timestamp | none |
| Honolulu, HI | socrata | `issuedate` | calendar day | name, company |
| New Orleans, LA | socrata | `issuedate` | source timestamp | name, company, license |
| Boston, MA | ckan | `issued_date` | source timestamp | name |
| Washington, DC | arcgis | `ISSUE_DATE` | source timestamp | name |
| Baltimore, MD | arcgis | `IssuedDate` | source timestamp | none |
| Louisville, KY | arcgis | `ISSUE_DATE` | source timestamp | name, company |
| San Jose, CA | arcgis | `ISSUEDATEUTC` | source timestamp | name, company |
| Harris County, TX | arcgis | `ISSUEDDATE` | source timestamp | name, company (contacts: Projects DBANAME, 2026-10-14) |
| Charlotte, NC | arcgis | `issuedate` | source timestamp | name |
| Kansas City, MO | socrata | `issueddate` | calendar day | name, company, license |
| San Antonio, TX | ckan | `DATE ISSUED` | calendar day | name, company (primary contact, 2026-10-14) |
| San Diego, CA | arcgis | `APPROVAL_ISSUE_DATE` | source timestamp | name, company (permit holder, 2026-10-14) |
| Denver, CO | arcgis | `DATE_ISSUED` | source timestamp | name, company |

## 3. Live tests and verified metadata

Final acceptance requests ran from 2026-10-10T18:09:50.693Z through 2026-10-10T18:25:45.990Z. Every recent argument below was the live UTC clock minus seven days. Times are request start times; elapsed durations are milliseconds. Counts are complete returned rows, not counts inferred from fixture size. Zero is a successful empty native response. The two baseline records are from complete, saved API response fixtures; when a later broad fixture probe failed, the earlier successfully recorded response was retained. Each query shows up to two actual returned records; a one-row result cannot supply a second sample.

Reproduction for catalog tenants uses the existing harness, for example:
```sh
npx tsx server/scrapers/live-harness.ts opendata targets.json "Austin, TX" recent
npx tsx server/scrapers/live-harness.ts opendata targets.json "Chicago, IL" search permit "101046020"
npx tsx server/scrapers/live-harness.ts opendata targets.json "Seattle, WA" search company "CONSTRUCTION"
```
The acceptance run imported this same adapter, used each exact target URL where available, and used the verified dataset URL for the 11 entries without a usable target URL. Fixtures and recorded metadata are under `fixtures/opendata/`; `provenance.json` indexes every source schema.

### New York, NY

Dataset: **DOB NOW: Build – Approved Permits**. ID: `rbx6-tga4`.
Metadata endpoint: https://data.cityofnewyork.us/api/views/rbx6-tga4.json
Data endpoint: https://data.cityofnewyork.us/resource/rbx6-tga4.json
Adapter context URL: https://a810-dobnow.nyc.gov/publish/Index.html
Dataset restriction: `work_permit IS NOT NULL AND work_permit != 'Permit is not yet issued'`.
Recorded baseline: `fixtures/opendata/New_York__NY.json`. Two source records:
```json
[
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2020-09-15",
    "contractorName": null
  },
  {
    "permitNumber": "Q00484864-I1-GC-CX",
    "address": "89 MALBA DRIVE",
    "status": "Permit Issued",
    "issuedAt": "2022-12-26",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:15:46.532Z"** — 3055 rows; 2026-10-10T18:15:46.532Z; 3702 ms.
```json
[
  {
    "permitNumber": "M00653144-I1-GC",
    "address": "480 PARK AVENUE",
    "status": "Permit Issued",
    "issuedAt": "2026-10-05",
    "contractorName": null
  },
  {
    "permitNumber": "X01464780-I1-FN",
    "address": "5801 PALISADE AVENUE",
    "status": "Permit Issued",
    "issuedAt": "2026-10-05",
    "contractorName": null
  }
]
```

**address "193 COOK STREET"** — 18 rows; 2026-10-10T18:15:50.234Z; 6981 ms.
```json
[
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2020-09-15",
    "contractorName": null
  },
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2018-05-15",
    "contractorName": null
  }
]
```

**permit "B00035723-I1-FN"** — 9 rows; 2026-10-10T18:15:57.215Z; 122 ms.
```json
[
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2020-09-15",
    "contractorName": null
  },
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2018-05-15",
    "contractorName": null
  }
]
```

**name "CHUN LIN CHIANG"** — 72 rows; 2026-10-10T18:18:35.953Z; 2393 ms.
```json
[
  {
    "permitNumber": "B00035723-I1-FN",
    "address": "193 COOK STREET",
    "status": "Signed-off",
    "issuedAt": "2020-09-15",
    "contractorName": null
  },
  {
    "permitNumber": "Q00186706-I1-CC",
    "address": "37-10 10 STREET",
    "status": "Signed-off",
    "issuedAt": "2021-06-15",
    "contractorName": null
  }
]
```


### Los Angeles, CA

Dataset: **Building and Safety - Building Permits Issued from 2020 to Present (N)**. ID: `pi9x-tg5x`.
Metadata endpoint: https://data.lacity.org/api/views/pi9x-tg5x.json
Data endpoint: https://data.lacity.org/resource/pi9x-tg5x.json
Adapter context URL: https://www.ladbsservices2.lacity.org/OnlineServices/
Recorded baseline: `fixtures/opendata/Los_Angeles__CA.json`. Two source records:
```json
[
  {
    "permitNumber": "23016-90000-19250",
    "address": "1865 N CURSON AVE",
    "status": "Permit Finaled",
    "issuedAt": "2023-06-12",
    "contractorName": null
  },
  {
    "permitNumber": "24016-10000-36278",
    "address": "6937 ESTEPA DR",
    "status": "Permit Finaled",
    "issuedAt": "2024-11-13",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:15:57.777Z"** — 24 rows; 2026-10-10T18:15:57.777Z; 840 ms.
```json
[
  {
    "permitNumber": "26016-90000-27236",
    "address": "3268 N BERRY DR",
    "status": "Issued",
    "issuedAt": "2026-10-03",
    "contractorName": null
  },
  {
    "permitNumber": "26016-90000-27244",
    "address": "11150 N HASKELL AVE",
    "status": "Issued",
    "issuedAt": "2026-10-03",
    "contractorName": null
  }
]
```

**address "1865 N CURSON AVE"** — 1 rows; 2026-10-10T18:15:58.617Z; 1594 ms.
```json
[
  {
    "permitNumber": "23016-90000-19250",
    "address": "1865 N CURSON AVE",
    "status": "Permit Finaled",
    "issuedAt": "2023-06-12",
    "contractorName": null
  }
]
```

**permit "23016-90000-19250"** — 1 rows; 2026-10-10T18:16:00.211Z; 285 ms.
```json
[
  {
    "permitNumber": "23016-90000-19250",
    "address": "1865 N CURSON AVE",
    "status": "Permit Finaled",
    "issuedAt": "2023-06-12",
    "contractorName": null
  }
]
```


### Chicago, IL

Dataset: **Building Permits**. ID: `ydr8-5enu`.
Metadata endpoint: https://data.cityofchicago.org/api/views/ydr8-5enu.json
Data endpoint: https://data.cityofchicago.org/resource/ydr8-5enu.json
Adapter context URL: https://webapps1.chicago.gov/buildingrecords/
Recorded baseline: `fixtures/opendata/Chicago__IL.json`. Two source records:
```json
[
  {
    "permitNumber": "101046020",
    "address": "7529 N CLARK ST",
    "status": null,
    "issuedAt": "2024-09-18",
    "contractorName": "3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY"
  },
  {
    "permitNumber": "101070548",
    "address": "5330 S MASON AVE",
    "status": "COMPLETE",
    "issuedAt": "2025-08-22",
    "contractorName": "AFFORDABLE CONSTRUCTION & ELEC; A & SL CONSTRUCTION, INC.; J&K PLUMBING 1, INC.; SOLARTECH"
  }
]
```

**recent "2026-10-03T18:16:00.821Z"** — 667 rows; 2026-10-10T18:16:00.821Z; 1476 ms.
```json
[
  {
    "permitNumber": "B200508490",
    "address": "6103 N KIRKWOOD AVE",
    "status": "ACTIVE",
    "issuedAt": "2026-10-04",
    "contractorName": null
  },
  {
    "permitNumber": "B200508965",
    "address": "3825 N CICERO AVE",
    "status": "ACTIVE",
    "issuedAt": "2026-10-04",
    "contractorName": null
  }
]
```

**address "7529 N CLARK ST"** — 15 rows; 2026-10-10T18:16:02.297Z; 5545 ms.
```json
[
  {
    "permitNumber": "101046020",
    "address": "7529 N CLARK ST",
    "status": null,
    "issuedAt": "2024-09-18",
    "contractorName": "3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY"
  },
  {
    "permitNumber": "101046122",
    "address": "7529 N CLARK ST",
    "status": null,
    "issuedAt": "2024-09-19",
    "contractorName": "3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY"
  }
]
```

**permit "101046020"** — 1 rows; 2026-10-10T18:16:07.842Z; 165 ms.
```json
[
  {
    "permitNumber": "101046020",
    "address": "7529 N CLARK ST",
    "status": null,
    "issuedAt": "2024-09-18",
    "contractorName": "3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY"
  }
]
```

**company "3 S SUPPLY COMPANY"** — 1395 rows; 2026-10-10T18:16:08.008Z; 4106 ms.
```json
[
  {
    "permitNumber": "101046020",
    "address": "7529 N CLARK ST",
    "status": null,
    "issuedAt": "2024-09-18",
    "contractorName": "3 S SUPPLY COMPANY; INTEGRITY SIGN COMPANY"
  },
  {
    "permitNumber": "101071957",
    "address": "7560 S COTTAGE GROVE AVE",
    "status": null,
    "issuedAt": "2025-08-22",
    "contractorName": "3 S SUPPLY COMPANY; JAMES D AHERN COMPANY"
  }
]
```


### Austin, TX

Dataset: **Issued Construction Permits**. ID: `3syk-w9eu`.
Metadata endpoint: https://data.austintexas.gov/api/views/3syk-w9eu.json
Data endpoint: https://data.austintexas.gov/resource/3syk-w9eu.json
Adapter context URL: https://abc.austintexas.gov/web/permit/public-search-other
Recorded baseline: `fixtures/opendata/Austin__TX.json`. Two source records:
```json
[
  {
    "permitNumber": "2026-057877 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  },
  {
    "permitNumber": "2026-131792 PP",
    "address": "2109 TRAVIS HEIGHTS BLVD",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "Radiant Plumbing & AC"
  }
]
```

**recent "2026-10-03T18:16:12.565Z"** — 910 rows; 2026-10-10T18:16:12.565Z; 1323 ms.
```json
[
  {
    "permitNumber": "2026-057877 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  },
  {
    "permitNumber": "2026-131792 PP",
    "address": "2109 TRAVIS HEIGHTS BLVD",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "Radiant Plumbing & AC"
  }
]
```

**address "2823 E MARTIN LUTHER KING JR BLVD UNIT 105"** — 7 rows; 2026-10-10T18:16:13.888Z; 821 ms.
```json
[
  {
    "permitNumber": "2026-057877 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  },
  {
    "permitNumber": "2026-059706 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  }
]
```

**permit "2026-057877 EP"** — 1 rows; 2026-10-10T18:16:14.710Z; 538 ms.
```json
[
  {
    "permitNumber": "2026-057877 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  }
]
```

**company "CNV Electrical LLC"** — 135 rows; 2026-10-10T18:16:15.248Z; 4735 ms.
```json
[
  {
    "permitNumber": "2026-057877 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  },
  {
    "permitNumber": "2026-059706 EP",
    "address": "2823 E MARTIN LUTHER KING JR BLVD UNIT 105",
    "status": "Active",
    "issuedAt": "2026-10-09",
    "contractorName": "CNV Electrical LLC"
  }
]
```


### Seattle, WA

Dataset: **Building Permits**. ID: `76t5-zqzr`.
Metadata endpoint: https://data.seattle.gov/api/views/76t5-zqzr.json
Data endpoint: https://data.seattle.gov/resource/76t5-zqzr.json
Adapter context URL: https://services.seattle.gov/Portal/Customization/SEATTLE/welcome.aspx
Recorded baseline: `fixtures/opendata/Seattle__WA.json`. Two source records:
```json
[
  {
    "permitNumber": "6066909-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2005-07-27",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  },
  {
    "permitNumber": "6066930-CN",
    "address": "4701 31ST AVE W",
    "status": "Closed",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:16:20.373Z"** — 73 rows; 2026-10-10T18:16:20.373Z; 771 ms.
```json
[
  {
    "permitNumber": "6827214-CN",
    "address": "1901 1ST AVE W",
    "status": "Issued",
    "issuedAt": "2026-10-08",
    "contractorName": null
  },
  {
    "permitNumber": "7031013-CN",
    "address": "3318 23RD AVE S",
    "status": "Issued",
    "issuedAt": "2026-10-06",
    "contractorName": null
  }
]
```

**address "1100 FAIRVIEW AVE N"** — 114 rows; 2026-10-10T18:16:21.144Z; 1435 ms.
```json
[
  {
    "permitNumber": "6066909-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2005-07-27",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  },
  {
    "permitNumber": "6072563-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2006-05-08",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  }
]
```

**permit "6066909-CN"** — 1 rows; 2026-10-10T18:16:22.579Z; 637 ms.
```json
[
  {
    "permitNumber": "6066909-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2005-07-27",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  }
]
```

**company "FRED HUTCHINSON CANCER RES CTR"** — 83 rows; 2026-10-10T18:16:23.216Z; 1172 ms.
```json
[
  {
    "permitNumber": "6066909-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2005-07-27",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  },
  {
    "permitNumber": "6072563-CN",
    "address": "1100 FAIRVIEW AVE N",
    "status": "Completed",
    "issuedAt": "2006-05-08",
    "contractorName": "FRED HUTCHINSON CANCER RES CTR"
  }
]
```


### San Francisco, CA

Dataset: **Building Permits**. ID: `i98e-djp9`.
Metadata endpoint: https://data.sf.gov/api/views/i98e-djp9.json (was https://data.sfgov.org/api/views/i98e-djp9.json; see section 7)
Data endpoint: https://data.sf.gov/resource/i98e-djp9.json (was https://data.sfgov.org/resource/i98e-djp9.json, kept as an accepted alias)
Adapter context URL: https://sanfranciscoca.portal.opengov.com/
Recorded baseline: `fixtures/opendata/San_Francisco__CA.json`. Two source records:
```json
[
  {
    "permitNumber": "201601288200",
    "address": "323 16th Av",
    "status": "complete",
    "issuedAt": "2016-01-28T11:26:29.000",
    "contractorName": null
  },
  {
    "permitNumber": "201601288201",
    "address": "2380 Vallejo St",
    "status": "complete",
    "issuedAt": "2016-07-15T09:05:37.000",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:16:25.813Z"** — 284 rows; 2026-10-10T18:16:25.813Z; 313 ms.
```json
[
  {
    "permitNumber": "202107265067",
    "address": "645 05th St",
    "status": "issued",
    "issuedAt": "2026-10-09T13:56:30.000",
    "contractorName": null
  },
  {
    "permitNumber": "202107265067",
    "address": "88 Bluxome St",
    "status": "issued",
    "issuedAt": "2026-10-09T13:56:30.000",
    "contractorName": null
  }
]
```

**address "323 16th Av"** — 7 rows; 2026-10-10T18:16:26.126Z; 1257 ms.
```json
[
  {
    "permitNumber": "201601288200",
    "address": "323 16th Av",
    "status": "complete",
    "issuedAt": "2016-01-28T11:26:29.000",
    "contractorName": null
  },
  {
    "permitNumber": "8406518",
    "address": "323 16th Av",
    "status": "complete",
    "issuedAt": "1984-06-18",
    "contractorName": null
  }
]
```

**permit "201601288200"** — 1 rows; 2026-10-10T18:16:27.383Z; 792 ms.
```json
[
  {
    "permitNumber": "201601288200",
    "address": "323 16th Av",
    "status": "complete",
    "issuedAt": "2016-01-28T11:26:29.000",
    "contractorName": null
  }
]
```


### Las Vegas, NV

Dataset: **Building Permits **. ID: `9f2697a560194be6bc14963405b72656`.
Metadata endpoint: https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/OpenData_Building_Permits_/FeatureServer/0?f=json
Data endpoint: https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/OpenData_Building_Permits_/FeatureServer/0
Adapter context URL: https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/OpenData_Building_Permits_/FeatureServer/0
Recorded baseline: `fixtures/opendata/Las_Vegas__NV.json`. Two source records:
```json
[
  {
    "permitNumber": "C-189527",
    "address": "10101 BANBURRY CROSS DR",
    "status": "Closed",
    "issuedAt": "2011-06-29T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "C-189528",
    "address": "805 N MOJAVE RD",
    "status": "Closed",
    "issuedAt": "2011-06-16T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:09:50.692Z"** — 0 rows; 2026-10-10T18:09:50.693Z; 860 ms.
No matching sample records.

**address "10101 BANBURRY CROSS DR"** — 5 rows; 2026-10-10T18:09:51.553Z; 2669 ms.
```json
[
  {
    "permitNumber": "C-189527",
    "address": "10101 BANBURRY CROSS DR",
    "status": "Closed",
    "issuedAt": "2011-06-29T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "C-191202",
    "address": "10101 BANBURRY CROSS DR",
    "status": "Closed",
    "issuedAt": "2012-03-12T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "C-189527"** — 1 rows; 2026-10-10T18:09:54.222Z; 278 ms.
```json
[
  {
    "permitNumber": "C-189527",
    "address": "10101 BANBURRY CROSS DR",
    "status": "Closed",
    "issuedAt": "2011-06-29T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Miami-Dade County, FL

Dataset: **Building Permits Issued By Miami-Dade County - 2 Previous Years to Present**. ID: `6db5f56e886446df88313ca279e59120`.
Metadata endpoint: https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0?f=json
Data endpoint: https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0
Adapter context URL: https://www.miamidade.gov/Apps/RER/EPSPortal
Recorded baseline: `fixtures/opendata/Miami_Dade_County__FL.json`. Two source records:
```json
[
  {
    "permitNumber": "2025001822",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  },
  {
    "permitNumber": "2025001821",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  }
]
```

**recent "2026-10-03T18:09:54.706Z"** — 1053 rows; 2026-10-10T18:09:54.706Z; 1958 ms.
```json
[
  {
    "permitNumber": "2027000568",
    "address": "19501 NE 22 RD",
    "status": null,
    "issuedAt": "2026-10-04",
    "contractorName": "OWNER"
  },
  {
    "permitNumber": "2027000567",
    "address": "8350 NW 32 AVE",
    "status": null,
    "issuedAt": "2026-10-04",
    "contractorName": "DONE WRIGHT A/C AND ELECTRIC SERVICE I"
  }
]
```

**address "11800 SW 18 ST             COMM"** — 2 rows; 2026-10-10T18:09:56.664Z; 1272 ms.
```json
[
  {
    "permitNumber": "2025001822",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  },
  {
    "permitNumber": "2025001821",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  }
]
```

**permit "2025001822"** — 1 rows; 2026-10-10T18:09:57.936Z; 876 ms.
```json
[
  {
    "permitNumber": "2025001822",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  }
]
```

**company "DIAMOND CONTRACTORS GROUP INC"** — 12 rows; 2026-10-10T18:09:58.812Z; 1180 ms.
```json
[
  {
    "permitNumber": "2025001822",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  },
  {
    "permitNumber": "2025001821",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  }
]
```

**license "CGC1532895"** — 12 rows; 2026-10-10T18:21:41.277Z; 519 ms.
```json
[
  {
    "permitNumber": "2025001822",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  },
  {
    "permitNumber": "2025001821",
    "address": "11800 SW 18 ST             COMM",
    "status": null,
    "issuedAt": "2024-10-09",
    "contractorName": "DIAMOND CONTRACTORS GROUP INC"
  }
]
```


### Columbus, OH

Dataset: **Building Permits**. ID: `f7a785b863454d96a0fe3f5aa5368e7d`.
Metadata endpoint: https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json
Data endpoint: https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0
Adapter context URL: https://portal.columbus.gov/Permits/Default.aspx
Recorded baseline: `fixtures/opendata/Columbus__OH.json`. Two source records:
```json
[
  {
    "permitNumber": "PMLSM1602159",
    "address": "3831 CHARBONNETT CT",
    "status": "Final Inspection Approved",
    "issuedAt": "2016-06-16T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "RSWDR1803525",
    "address": "2406 BRIERS DR",
    "status": "Permit Issued",
    "issuedAt": "2018-07-30T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:00.907Z"** — 811 rows; 2026-10-10T18:10:00.907Z; 623 ms.
```json
[
  {
    "permitNumber": "ALTC2627467",
    "address": "200 W NATIONWIDE BLVD",
    "status": "Permit Issued",
    "issuedAt": "2026-10-05T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "PMEPI2639955",
    "address": "152 S TERRACE AVE",
    "status": "Permit Issued",
    "issuedAt": "2026-10-08T00:00:00.000Z",
    "contractorName": null
  }
]
```

**address "3831 CHARBONNETT CT"** — 3 rows; 2026-10-10T18:10:01.530Z; 3049 ms.
```json
[
  {
    "permitNumber": "PMLSM1602159",
    "address": "3831 CHARBONNETT CT",
    "status": "Final Inspection Approved",
    "issuedAt": "2016-06-16T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "WNDR1214118",
    "address": "3831 CHARBONNETT CT",
    "status": "Final Inspection Approved",
    "issuedAt": "2012-05-14T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "PMLSM1602159"** — 1 rows; 2026-10-10T18:10:04.579Z; 611 ms.
```json
[
  {
    "permitNumber": "PMLSM1602159",
    "address": "3831 CHARBONNETT CT",
    "status": "Final Inspection Approved",
    "issuedAt": "2016-06-16T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Detroit, MI

Dataset: **Building Permits**. ID: `86d47e86062e4beeb19344eb125b75d2`.
Metadata endpoint: https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0?f=json
Data endpoint: https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0
Adapter context URL: https://aca-prod.accela.com/DETROIT/Default.aspx
Recorded baseline: `fixtures/opendata/Detroit__MI.json`. Two source records:
```json
[
  {
    "permitNumber": "RES2026-01961",
    "address": "12805 La Salle Blvd",
    "status": null,
    "issuedAt": "2026-06-22",
    "contractorName": null
  },
  {
    "permitNumber": "RES2025-00921",
    "address": "19966 Meyers Rd",
    "status": null,
    "issuedAt": "2025-04-14",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:05.625Z"** — 142 rows; 2026-10-10T18:10:05.625Z; 849 ms.
```json
[
  {
    "permitNumber": "BLD2026-00593",
    "address": "920 Henry St",
    "status": null,
    "issuedAt": "2026-10-05",
    "contractorName": null
  },
  {
    "permitNumber": "BLD2025-00616",
    "address": "9197 Goodwin St",
    "status": null,
    "issuedAt": "2026-10-09",
    "contractorName": null
  }
]
```

**address "12805 La Salle Blvd"** — 1 rows; 2026-10-10T18:10:06.474Z; 1313 ms.
```json
[
  {
    "permitNumber": "RES2026-01961",
    "address": "12805 La Salle Blvd",
    "status": null,
    "issuedAt": "2026-06-22",
    "contractorName": null
  }
]
```

**permit "RES2026-01961"** — 1 rows; 2026-10-10T18:10:07.787Z; 648 ms.
```json
[
  {
    "permitNumber": "RES2026-01961",
    "address": "12805 La Salle Blvd",
    "status": null,
    "issuedAt": "2026-06-22",
    "contractorName": null
  }
]
```


### Minneapolis, MN

Dataset: **CCS_Permits**. ID: `df4bfccbe60b42a6a93fb7bc1fd84cc0`.
Metadata endpoint: https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0?f=json
Data endpoint: https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0
Adapter context URL: https://www.minneapolismn.gov/business-services/licenses-permits-inspections/construction-permits/
Recorded baseline: `fixtures/opendata/Minneapolis__MN.json`. Two source records:
```json
[
  {
    "permitNumber": "BLDG716044",
    "address": "1 1ST ST S",
    "status": "Closed",
    "issuedAt": "2018-06-28T09:48:24.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BLDG1075485",
    "address": "1 33RD ST W",
    "status": "Closed",
    "issuedAt": "2024-07-25T09:03:23.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:08.694Z"** — 534 rows; 2026-10-10T18:10:08.694Z; 1189 ms.
```json
[
  {
    "permitNumber": "BLDG1193930",
    "address": "1 MAIN ST SE",
    "status": "Issued",
    "issuedAt": "2026-10-08T11:00:28.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BLDG1202678",
    "address": "100 2ND ST NE #A270",
    "status": "Issued",
    "issuedAt": "2026-10-06T08:46:51.000Z",
    "contractorName": null
  }
]
```

**address "1 1ST ST S"** — 3196 rows; 2026-10-10T18:10:09.883Z; 5965 ms.
```json
[
  {
    "permitNumber": "BLDG716044",
    "address": "1 1ST ST S",
    "status": "Closed",
    "issuedAt": "2018-06-28T09:48:24.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BLDG791481",
    "address": "1811 1ST ST S",
    "status": "Closed",
    "issuedAt": "2020-06-23T13:30:00.000Z",
    "contractorName": null
  }
]
```

**permit "BLDG716044"** — 1 rows; 2026-10-10T18:10:15.848Z; 805 ms.
```json
[
  {
    "permitNumber": "BLDG716044",
    "address": "1 1ST ST S",
    "status": "Closed",
    "issuedAt": "2018-06-28T09:48:24.000Z",
    "contractorName": null
  }
]
```


### Maricopa County, AZ

Dataset: **Building Permits**. ID: `86909eb1ea9149308abaadba377f388f`.
Metadata endpoint: https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0?f=json
Data endpoint: https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0
Adapter context URL: https://maricopacountyaz-energovweb.tylerhost.net/apps/selfservice#/home
Recorded baseline: `fixtures/opendata/Maricopa_County__AZ.json`. Two source records:
```json
[
  {
    "permitNumber": "B202306811",
    "address": "12302 W Bell RD",
    "status": "Complete",
    "issuedAt": "2023-10-02T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B202307928",
    "address": "16804 S 54th ST",
    "status": "Complete",
    "issuedAt": "2023-08-16T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:17.054Z"** — 176 rows; 2026-10-10T18:10:17.054Z; 1446 ms.
```json
[
  {
    "permitNumber": "BLDC2600133",
    "address": "25606 S ARIZONA AVE",
    "status": "Issued",
    "issuedAt": "2026-10-09T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B202306295",
    "address": "15 N 85th PL",
    "status": "Issued",
    "issuedAt": "2026-10-09T00:00:00.000Z",
    "contractorName": null
  }
]
```

**address "12302 W Bell RD"** — 4 rows; 2026-10-10T18:10:18.500Z; 693 ms.
```json
[
  {
    "permitNumber": "B202306811",
    "address": "12302 W Bell RD",
    "status": "Complete",
    "issuedAt": "2023-10-02T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B202303207",
    "address": "12302 W Bell RD",
    "status": "Complete",
    "issuedAt": "2023-06-05T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "B202306811"** — 2 rows; 2026-10-10T18:10:19.193Z; 905 ms.
```json
[
  {
    "permitNumber": "B202306811",
    "address": "12302 W Bell RD",
    "status": "Complete",
    "issuedAt": "2023-10-02T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B202306811",
    "address": "12302 W Bell RD",
    "status": "Complete",
    "issuedAt": "2023-10-02T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Los Angeles County, CA

Dataset: **LA County Permitting (EPIC-LA Case History)**. ID: `b2a835d49c194029a525fb60cf24aa59`.
Metadata endpoint: https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0?f=json
Data endpoint: https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0
Adapter context URL: https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0
Dataset restriction: `MODULENAME = 'PermitManagement'`.
Recorded baseline: `fixtures/opendata/Los_Angeles_County__CA.json`. Two source records:
```json
[
  {
    "permitNumber": "PROPRPT-000004-2018",
    "address": "18105 Wakecrest Drive, Malibu CA 90265",
    "status": "New",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "PROPRPT-000003-2018",
    "address": "2112 Tortuga Street, Acton CA 93510",
    "status": "New",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:21.073Z"** — 743 rows; 2026-10-10T18:10:21.073Z; 2201 ms.
```json
[
  {
    "permitNumber": "UNC-BLDR200123000465",
    "address": "323 S Roosevelt Avenue, Pasadena CA 91107",
    "status": "Issued",
    "issuedAt": "2026-10-08T08:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "UNC-MECH201027003452",
    "address": "323 S Roosevelt Avenue, Pasadena CA 91107",
    "status": "Issued",
    "issuedAt": "2026-10-08T08:00:00.000Z",
    "contractorName": null
  }
]
```

**address "18105 Wakecrest Drive, Malibu CA 90265"** — 13 rows; 2026-10-10T18:10:23.274Z; 3214 ms.
```json
[
  {
    "permitNumber": "PROPRPT-000004-2018",
    "address": "18105 Wakecrest Drive, Malibu CA 90265",
    "status": "New",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "UNC-BLDR180102000001",
    "address": "18105 Wakecrest Drive, Malibu CA 90265",
    "status": "Finaled",
    "issuedAt": "2018-01-08T08:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "PROPRPT-000004-2018"** — 2 rows; 2026-10-10T18:10:26.488Z; 417 ms.
```json
[
  {
    "permitNumber": "PROPRPT-000004-2018",
    "address": "18105 Wakecrest Drive, Malibu CA 90265",
    "status": "New",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "PROPRPT-000004-2018",
    "address": "18105 Wakecrest Drive, Malibu CA 90265",
    "status": "New",
    "issuedAt": null,
    "contractorName": null
  }
]
```


### Mecklenburg County, NC

Dataset: **Building Permit Locations**. ID: `fc9d171ecd4d44a58c7dad840cd58aa2`.
Metadata endpoint: https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0?f=json
Data endpoint: https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0
Adapter context URL: https://aca-prod.accela.com/MECKLENBURG/Default.aspx
Recorded baseline: `fixtures/opendata/Mecklenburg_County__NC.json`. Two source records:
```json
[
  {
    "permitNumber": "B4680449",
    "address": "12425  ALBEMARLE RD",
    "status": "Complete",
    "issuedAt": "2024-08-20T16:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B4803939",
    "address": "3708  EASTWAY DR",
    "status": "Complete",
    "issuedAt": "2025-04-24T16:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:17:09.665Z"** — 30 rows; 2026-10-10T18:17:09.665Z; 1364 ms.
```json
[
  {
    "permitNumber": "B4838965",
    "address": "10225  LITTLE WHITEOAK RD",
    "status": "Issued",
    "issuedAt": "2026-10-05T16:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B4838949",
    "address": "2015  HACKNEY ST",
    "status": "Issued",
    "issuedAt": "2026-10-05T16:00:00.000Z",
    "contractorName": null
  }
]
```

**address "12425  ALBEMARLE RD"** — 1 rows; 2026-10-10T18:17:11.029Z; 1724 ms.
```json
[
  {
    "permitNumber": "B4680449",
    "address": "12425  ALBEMARLE RD",
    "status": "Complete",
    "issuedAt": "2024-08-20T16:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "B4680449"** — 1 rows; 2026-10-10T18:17:12.753Z; 1134 ms.
```json
[
  {
    "permitNumber": "B4680449",
    "address": "12425  ALBEMARLE RD",
    "status": "Complete",
    "issuedAt": "2024-08-20T16:00:00.000Z",
    "contractorName": null
  }
]
```


### Portland, OR

Dataset: **Residential Building Permits**. ID: `02d99db039e0428da88262bff513056a`.
Metadata endpoint: https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/89?f=json
Data endpoint: https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/89
Adapter context URL: https://www.portland.gov/permits
Recorded baseline: `fixtures/opendata/Portland__OR.json`. Two source records:
```json
[
  {
    "permitNumber": "95-051241-000-00-RS",
    "address": "9000 NE M L KING BLVD - Unit 223",
    "status": "Final",
    "issuedAt": "1996-01-30T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "94-000664-000-00-RS",
    "address": "7632 SW RUBY TER",
    "status": "Final",
    "issuedAt": "1995-01-17T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:31.474Z"** — 0 rows; 2026-10-10T18:10:31.474Z; 591 ms.
No matching sample records.

**address "9000 NE M L KING BLVD - Unit 223"** — 2 rows; 2026-10-10T18:10:32.065Z; 1082 ms.
```json
[
  {
    "permitNumber": "95-051241-000-00-RS",
    "address": "9000 NE M L KING BLVD - Unit 223",
    "status": "Final",
    "issuedAt": "1996-01-30T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "13-207151-000-00-MP",
    "address": "9000 NE M L KING BLVD - Unit 223",
    "status": "Final",
    "issuedAt": "2013-09-19T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "95-051241-000-00-RS"** — 1 rows; 2026-10-10T18:10:33.147Z; 897 ms.
```json
[
  {
    "permitNumber": "95-051241-000-00-RS",
    "address": "9000 NE M L KING BLVD - Unit 223",
    "status": "Final",
    "issuedAt": "1996-01-30T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Cincinnati, OH

Dataset: **Cincinnati Building Permits**. ID: `uhjb-xac9`.
Metadata endpoint: https://data.cincinnati-oh.gov/api/views/uhjb-xac9.json
Data endpoint: https://data.cincinnati-oh.gov/resource/uhjb-xac9.json
Adapter context URL: https://aca-prod.accela.com/CINCINNATI/Default.aspx
Recorded baseline: `fixtures/opendata/Cincinnati__OH.json`. Two source records:
```json
[
  {
    "permitNumber": "2012P00151",
    "address": "6210 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2012-01-19",
    "contractorName": "\"CONCORD FIRE PROTECTION INC\""
  },
  {
    "permitNumber": "2010P04401",
    "address": "5 TWIN HILLS RIDGE DR",
    "status": "CLOSED",
    "issuedAt": "2010-06-22",
    "contractorName": "\"ERNIE VILARDO\""
  }
]
```

**recent "2026-10-03T18:16:28.576Z"** — 174 rows; 2026-10-10T18:16:28.576Z; 758 ms.
```json
[
  {
    "permitNumber": "2026P08545",
    "address": "2537 MANDERY AV",
    "status": "ISSUED",
    "issuedAt": "2026-10-07",
    "contractorName": "\"HELP HOME SERVICES\""
  },
  {
    "permitNumber": "2026P08795",
    "address": "6111 ARGUS RD",
    "status": "ISSUED",
    "issuedAt": "2026-10-06",
    "contractorName": "\"HELP HOME SERVICE INC\""
  }
]
```

**address "6210 CENTER HILL AV"** — 12 rows; 2026-10-10T18:16:29.334Z; 1610 ms.
```json
[
  {
    "permitNumber": "2012P00151",
    "address": "6210 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2012-01-19",
    "contractorName": "\"CONCORD FIRE PROTECTION INC\""
  },
  {
    "permitNumber": "2011P09455",
    "address": "6210 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2012-02-06",
    "contractorName": "\"SIEMENS INDUSTRY INC\""
  }
]
```

**permit "2012P00151"** — 1 rows; 2026-10-10T18:16:30.944Z; 366 ms.
```json
[
  {
    "permitNumber": "2012P00151",
    "address": "6210 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2012-01-19",
    "contractorName": "\"CONCORD FIRE PROTECTION INC\""
  }
]
```

**company "\"CONCORD FIRE PROTECTION INC\""** — 462 rows; 2026-10-10T18:16:31.310Z; 1186 ms.
```json
[
  {
    "permitNumber": "2012P00151",
    "address": "6210 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2012-01-19",
    "contractorName": "\"CONCORD FIRE PROTECTION INC\""
  },
  {
    "permitNumber": "2011P06533",
    "address": "6300 CENTER HILL AV",
    "status": "CLOSED",
    "issuedAt": "2011-09-09",
    "contractorName": "\"CONCORD FIRE PROTECTION INC\""
  }
]
```


### Mesa, AZ

Dataset: **Building Permits**. ID: `dzpk-hxfb`.
Metadata endpoint: https://data.mesaaz.gov/api/views/dzpk-hxfb.json
Data endpoint: https://data.mesaaz.gov/resource/dzpk-hxfb.json
Adapter context URL: https://aca-prod.accela.com/MESA/Default.aspx
Recorded baseline: `fixtures/opendata/Mesa__AZ.json`. Two source records:
```json
[
  {
    "permitNumber": "BLD2003-00009",
    "address": "6360 E ODESSA ST",
    "status": "Finaled",
    "issuedAt": "2003-08-05",
    "contractorName": "ALLEN HOMES"
  },
  {
    "permitNumber": "BLD2003-00019",
    "address": "4115 E VALLEY AUTO DR",
    "status": "Issued",
    "issuedAt": "2003-07-01",
    "contractorName": "BAJA CONSTRUCTION CO INC"
  }
]
```

**recent "2026-10-03T18:16:33.041Z"** — 65 rows; 2026-10-10T18:16:33.041Z; 860 ms.
```json
[
  {
    "permitNumber": "PMT26-05413",
    "address": "1544 S 105TH PL",
    "status": "Issued",
    "issuedAt": "2026-10-05",
    "contractorName": "UNIVERSAL SIGN INSTALLATION LLC"
  },
  {
    "permitNumber": "PMT26-05985",
    "address": "151 E 1ST ST",
    "status": "Issued",
    "issuedAt": "2026-10-07",
    "contractorName": "GV Remodeling Inc"
  }
]
```

**address "6360 E ODESSA ST"** — 2 rows; 2026-10-10T18:16:33.901Z; 1425 ms.
```json
[
  {
    "permitNumber": "BLD2003-00009",
    "address": "6360 E ODESSA ST",
    "status": "Finaled",
    "issuedAt": "2003-08-05",
    "contractorName": "ALLEN HOMES"
  },
  {
    "permitNumber": "BLD2007-10829",
    "address": "6360 E ODESSA ST",
    "status": "Issued",
    "issuedAt": "2007-10-25",
    "contractorName": "ALLEN HOMES"
  }
]
```

**permit "BLD2003-00009"** — 1 rows; 2026-10-10T18:16:35.326Z; 450 ms.
```json
[
  {
    "permitNumber": "BLD2003-00009",
    "address": "6360 E ODESSA ST",
    "status": "Finaled",
    "issuedAt": "2003-08-05",
    "contractorName": "ALLEN HOMES"
  }
]
```

**company "ALLEN HOMES"** — 52 rows; 2026-10-10T18:16:35.776Z; 1003 ms.
```json
[
  {
    "permitNumber": "BLD2003-00009",
    "address": "6360 E ODESSA ST",
    "status": "Finaled",
    "issuedAt": "2003-08-05",
    "contractorName": "ALLEN HOMES"
  },
  {
    "permitNumber": "BLD2003-01324",
    "address": "5849 E LEONORA ST",
    "status": "Finaled",
    "issuedAt": "2003-11-18",
    "contractorName": "ALLEN HOMES"
  }
]
```


### Philadelphia, PA

Dataset: **Licenses and Inspections Building and Zoning Permits**. ID: `permits`.
Metadata endpoint: https://phl.carto.com/api/v2/sql?q=SELECT%20*%20FROM%20permits%20LIMIT%200
Data endpoint: https://phl.carto.com/api/v2/sql
Adapter context URL: https://eclipse.phila.gov/phillylmsprod/pub/lms/Login.aspx
Recorded baseline: `fixtures/opendata/Philadelphia__PA.json`. Two source records:
```json
[
  {
    "permitNumber": "EP-2024-003069",
    "address": "4088 CONSHOHOCKEN AVE",
    "status": "Completed",
    "issuedAt": "2025-05-07T04:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  },
  {
    "permitNumber": "MP-2021-006647",
    "address": "7510 NEWLAND ST",
    "status": "Completed",
    "issuedAt": "2022-12-28T05:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  }
]
```

**recent "2026-10-03T18:10:43.009Z"** — 379 rows; 2026-10-10T18:10:43.009Z; 1027 ms.
```json
[
  {
    "permitNumber": "CP-2026-005911",
    "address": "3701 MARKET ST",
    "status": "Issued",
    "issuedAt": "2026-10-06T04:00:00.000Z",
    "contractorName": "HSC BUILDERS & CONSTRUCTION"
  },
  {
    "permitNumber": "CP-2025-005924",
    "address": "7720-34 BUSTLETON AVE",
    "status": "Issued",
    "issuedAt": "2026-10-06T04:00:00.000Z",
    "contractorName": "COLLEEN HARTER"
  }
]
```

**address "4088 CONSHOHOCKEN AVE"** — 597 rows; 2026-10-10T18:10:44.036Z; 1228 ms.
```json
[
  {
    "permitNumber": "EP-2024-003069",
    "address": "4088 CONSHOHOCKEN AVE",
    "status": "Completed",
    "issuedAt": "2025-05-07T04:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  },
  {
    "permitNumber": "RP-2026-004390",
    "address": "4088 CONSHOHOCKEN AVE",
    "status": "Issued",
    "issuedAt": "2026-09-23T04:00:00.000Z",
    "contractorName": "BORCO CONSTRUCTION LLC"
  }
]
```

**permit "EP-2024-003069"** — 1 rows; 2026-10-10T18:10:45.264Z; 799 ms.
```json
[
  {
    "permitNumber": "EP-2024-003069",
    "address": "4088 CONSHOHOCKEN AVE",
    "status": "Completed",
    "issuedAt": "2025-05-07T04:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  }
]
```

**company "FRED DINARDO JR"** — 927 rows; 2026-10-10T18:10:46.063Z; 1245 ms.
```json
[
  {
    "permitNumber": "EP-2024-003069",
    "address": "4088 CONSHOHOCKEN AVE",
    "status": "Completed",
    "issuedAt": "2025-05-07T04:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  },
  {
    "permitNumber": "MP-2021-006647",
    "address": "7510 NEWLAND ST",
    "status": "Completed",
    "issuedAt": "2022-12-28T05:00:00.000Z",
    "contractorName": "FRED DINARDO JR"
  }
]
```


### Nashville, TN

Dataset: **Building Permits Issued**. ID: `2576bfb2d74f418b8ba8c4538e4f729f`.
Metadata endpoint: https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0?f=json
Data endpoint: https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0
Adapter context URL: https://epermits.nashville.gov/
Recorded baseline: `fixtures/opendata/Nashville__TN.json`. Two source records:
```json
[
  {
    "permitNumber": "2023007679",
    "address": "730 NASHBORO BLVD",
    "status": null,
    "issuedAt": "2023-11-06T06:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "2023052161",
    "address": "2405 C 12TH AVE S",
    "status": null,
    "issuedAt": "2023-11-14T06:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:47.703Z"** — 233 rows; 2026-10-10T18:10:47.703Z; 901 ms.
```json
[
  {
    "permitNumber": "2025037504",
    "address": "4012 C HILLSBORO PIKE",
    "status": null,
    "issuedAt": "2026-10-08T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "2025106046",
    "address": "3125 B RICHMOND HILL DR",
    "status": null,
    "issuedAt": "2026-10-07T05:00:00.000Z",
    "contractorName": null
  }
]
```

**address "730 NASHBORO BLVD"** — 1 rows; 2026-10-10T18:10:48.604Z; 933 ms.
```json
[
  {
    "permitNumber": "2023007679",
    "address": "730 NASHBORO BLVD",
    "status": null,
    "issuedAt": "2023-11-06T06:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "2023007679"** — 1 rows; 2026-10-10T18:10:49.537Z; 938 ms.
```json
[
  {
    "permitNumber": "2023007679",
    "address": "730 NASHBORO BLVD",
    "status": null,
    "issuedAt": "2023-11-06T06:00:00.000Z",
    "contractorName": null
  }
]
```


### Fort Worth, TX

Dataset: **CFW Development Permits Table**. ID: `d2740f4d746b4bfaa03e25de0376238b`.
Metadata endpoint: https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0?f=json
Data endpoint: https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0
Adapter context URL: https://aca-prod.accela.com/CFW/Default.aspx
Recorded baseline: `fixtures/opendata/Fort_Worth__TX.json`. Two source records:
```json
[
  {
    "permitNumber": "19EST-000012",
    "address": "1128 STELLA ST",
    "status": "Pending",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "23EST-000049",
    "address": null,
    "status": "Pending",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:10:50.776Z"** — 1113 rows; 2026-10-10T18:10:50.776Z; 1909 ms.
```json
[
  {
    "permitNumber": "CG26-00219",
    "address": "1480 NORTHEAST LOOP 820 FWY",
    "status": "Plan Review",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "CG26-00220",
    "address": "13391 QUAIL MEADOW DR",
    "status": "Plan Review",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**address "1128 STELLA ST"** — 7 rows; 2026-10-10T18:10:52.685Z; 5724 ms.
```json
[
  {
    "permitNumber": "19EST-000012",
    "address": "1128 STELLA ST",
    "status": "Pending",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "HCLC-19-086",
    "address": "1128 STELLA ST",
    "status": "Approved w/Conditions",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**permit "19EST-000012"** — 1 rows; 2026-10-10T18:10:58.409Z; 1179 ms.
```json
[
  {
    "permitNumber": "19EST-000012",
    "address": "1128 STELLA ST",
    "status": "Pending",
    "issuedAt": null,
    "contractorName": null
  }
]
```


### Wake County, NC

Dataset: **Building Permits**. ID: `6a9651b339b7413d8dc264f9ae1b3f6f`.
Metadata endpoint: https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0?f=json
Data endpoint: https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0
Adapter context URL: https://wakecountync-energovpub.tylerhost.net/apps/SelfService#/home
Recorded baseline: `fixtures/opendata/Wake_County__NC.json`. Two source records:
```json
[
  {
    "permitNumber": "0941568",
    "address": "1017 PENSELWOOD DR",
    "status": "Complete",
    "issuedAt": "1993-11-29T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "0020614",
    "address": "402 NORTH ST",
    "status": "Complete",
    "issuedAt": "2001-08-21T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:00.357Z"** — 90 rows; 2026-10-10T18:11:00.357Z; 433 ms.
```json
[
  {
    "permitNumber": "CBPR-161281-2025",
    "address": "725 MAIN ST",
    "status": "Complete",
    "issuedAt": "2026-10-06T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "CBPR-164555-2026",
    "address": "1640 OLD KNIGHT RD",
    "status": "Issued",
    "issuedAt": "2026-10-06T00:00:00.000Z",
    "contractorName": null
  }
]
```

**address "1017 PENSELWOOD DR"** — 1 rows; 2026-10-10T18:11:00.791Z; 1063 ms.
```json
[
  {
    "permitNumber": "0941568",
    "address": "1017 PENSELWOOD DR",
    "status": "Complete",
    "issuedAt": "1993-11-29T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "0941568"** — 1 rows; 2026-10-10T18:11:01.854Z; 808 ms.
```json
[
  {
    "permitNumber": "0941568",
    "address": "1017 PENSELWOOD DR",
    "status": "Complete",
    "issuedAt": "1993-11-29T00:00:00.000Z",
    "contractorName": null
  }
]
```

**company "CONSTRUCTION"** — 0 rows; 2026-10-10T18:11:02.662Z; 1118 ms.
No matching sample records.


### Pierce County, WA

Dataset: **Permits_Pierce_County**. ID: `7a2af86e0b64463b9caeb08c374a24ac`.
Metadata endpoint: https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Permits_Pierce_County/FeatureServer/0?f=json
Data endpoint: https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Permits_Pierce_County/FeatureServer/0
Adapter context URL: https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Permits_Pierce_County/FeatureServer/0
Recorded baseline: `fixtures/opendata/Pierce_County__WA.json`. Two source records:
```json
[
  {
    "permitNumber": "4",
    "address": "1269 KAMUS DR",
    "status": "Cancelled",
    "issuedAt": "1985-11-04T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "5",
    "address": "7102 HARTS LAKE LOOP RD S",
    "status": "Final",
    "issuedAt": "1985-11-05T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:04.128Z"** — 126 rows; 2026-10-10T18:11:04.128Z; 1355 ms.
```json
[
  {
    "permitNumber": "1028779",
    "address": "5853 116TH STCT E",
    "status": "Issued",
    "issuedAt": "2026-10-05T14:08:05.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "1056921",
    "address": "14615 138th AV E",
    "status": "Issued",
    "issuedAt": "2026-10-06T10:36:01.000Z",
    "contractorName": null
  }
]
```

**address "1269 KAMUS DR"** — 3 rows; 2026-10-10T18:11:05.483Z; 2414 ms.
```json
[
  {
    "permitNumber": "4",
    "address": "1269 KAMUS DR",
    "status": "Cancelled",
    "issuedAt": "1985-11-04T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "24634",
    "address": "1269 KAMUS DR",
    "status": "Cancelled",
    "issuedAt": "1987-08-06T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "4"** — 1 rows; 2026-10-10T18:11:07.897Z; 430 ms.
```json
[
  {
    "permitNumber": "4",
    "address": "1269 KAMUS DR",
    "status": "Cancelled",
    "issuedAt": "1985-11-04T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Raleigh, NC

Dataset: **Building Permits**. ID: `bdfad82b15344d37beb28d7f90b6c4be`.
Metadata endpoint: https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json
Data endpoint: https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0
Adapter context URL: https://raleighnc.gov/permits
Recorded baseline: `fixtures/opendata/Raleigh__NC.json`. Two source records:
```json
[
  {
    "permitNumber": "000571",
    "address": "10601 LUMLEY RD",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2000-04-26T15:16:18.000Z",
    "contractorName": "DJB (BEERS/DAVIDSON AND JONES"
  },
  {
    "permitNumber": "001769",
    "address": "400 S PEARTREE LN",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2000-07-03T13:59:20.000Z",
    "contractorName": "CENTURION CONSTRUCTION COMPANY"
  }
]
```

**recent "2026-10-03T18:11:08.542Z"** — 81 rows; 2026-10-10T18:11:08.542Z; 971 ms.
```json
[
  {
    "permitNumber": "BLDNR-011833-2026",
    "address": "1200 Oakwood Ave",
    "status": "Issued",
    "issuedAt": "2026-10-06T15:40:48.000Z",
    "contractorName": "DRB Group - North Carolina, LLC"
  },
  {
    "permitNumber": "BLDR-014787-2026",
    "address": "9204 Palm Bay Cir",
    "status": "Issued",
    "issuedAt": "2026-10-05T12:24:24.293Z",
    "contractorName": "Casella Holdings, LLC"
  }
]
```

**address "10601 LUMLEY RD"** — 1 rows; 2026-10-10T18:11:09.513Z; 2683 ms.
```json
[
  {
    "permitNumber": "000571",
    "address": "10601 LUMLEY RD",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2000-04-26T15:16:18.000Z",
    "contractorName": "DJB (BEERS/DAVIDSON AND JONES"
  }
]
```

**permit "000571"** — 1 rows; 2026-10-10T18:11:12.196Z; 145 ms.
```json
[
  {
    "permitNumber": "000571",
    "address": "10601 LUMLEY RD",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2000-04-26T15:16:18.000Z",
    "contractorName": "DJB (BEERS/DAVIDSON AND JONES"
  }
]
```

**company "DJB (BEERS/DAVIDSON AND JONES"** — 30 rows; 2026-10-10T18:11:12.341Z; 1630 ms.
```json
[
  {
    "permitNumber": "000571",
    "address": "10601 LUMLEY RD",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2000-04-26T15:16:18.000Z",
    "contractorName": "DJB (BEERS/DAVIDSON AND JONES"
  },
  {
    "permitNumber": "006125",
    "address": "8980 SOUTHALL RD",
    "status": "INACTIVE (INSPECTIONS COMPLETED)",
    "issuedAt": "2001-02-20T17:51:58.000Z",
    "contractorName": "DJB (BEERS/DAVIDSON AND JONES"
  }
]
```


### Tucson, AZ

Dataset: **Residential Permits**. ID: `d8132cd24a47442aa2ed35180b78cb51`.
Metadata endpoint: https://gis.tucsonaz.gov/public/rest/services/PublicMaps/PermitsCode/MapServer/85?f=json
Data endpoint: https://gis.tucsonaz.gov/public/rest/services/PublicMaps/PermitsCode/MapServer/85
Adapter context URL: https://cityoftucsonaz-energovweb.tylerhost.net/apps/selfservice#/home
Recorded baseline: `fixtures/opendata/Tucson__AZ.json`. Two source records:
```json
[
  {
    "permitNumber": "TC-RES-0826-04700",
    "address": "2128 N 3RD AV",
    "status": "In Review",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "T22CM07055",
    "address": "5329 S SIERRA PRIETA TR",
    "status": "Issued",
    "issuedAt": "2022-09-16T00:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:14.376Z"** — 108 rows; 2026-10-10T18:11:14.376Z; 791 ms.
```json
[
  {
    "permitNumber": "TC-RES-0926-05446",
    "address": "1948 E VERA CRUZ VISTA",
    "status": "Issued",
    "issuedAt": "2026-10-07T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "TC-RES-0926-05355",
    "address": "12046 E SAGUARO CREST PL",
    "status": "Issued",
    "issuedAt": "2026-10-06T00:00:00.000Z",
    "contractorName": null
  }
]
```

**address "2128 N 3RD AV"** — 1 rows; 2026-10-10T18:11:15.167Z; 960 ms.
```json
[
  {
    "permitNumber": "TC-RES-0826-04700",
    "address": "2128 N 3RD AV",
    "status": "In Review",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**permit "TC-RES-0826-04700"** — 1 rows; 2026-10-10T18:11:16.127Z; 966 ms.
```json
[
  {
    "permitNumber": "TC-RES-0826-04700",
    "address": "2128 N 3RD AV",
    "status": "In Review",
    "issuedAt": null,
    "contractorName": null
  }
]
```


### Virginia Beach, VA

Dataset: **Permits**. ID: `f40c03f52cfb4a068851fe9f2e62c44b`.
Metadata endpoint: https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json
Data endpoint: https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0
Adapter context URL: https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0
Recorded baseline: `fixtures/opendata/Virginia_Beach__VA.json`. Two source records:
```json
[
  {
    "permitNumber": "2019-UTIL-00001",
    "address": "310 EDWIN DR",
    "status": "Closed",
    "issuedAt": "2019-01-02",
    "contractorName": null
  },
  {
    "permitNumber": "2019-BDRA-00004",
    "address": "2324 SEA SHELL RD",
    "status": "Closed",
    "issuedAt": "2019-04-23",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:17.506Z"** — 0 rows; 2026-10-10T18:11:17.506Z; 913 ms.
No matching sample records.

**address "310 EDWIN DR"** — 40 rows; 2026-10-10T18:11:18.419Z; 1485 ms.
```json
[
  {
    "permitNumber": "2019-UTIL-00001",
    "address": "310 EDWIN DR",
    "status": "Closed",
    "issuedAt": "2019-01-02",
    "contractorName": null
  },
  {
    "permitNumber": "2019-FIRE-00507",
    "address": "310 EDWIN DR",
    "status": "Closed",
    "issuedAt": "2019-01-09",
    "contractorName": null
  }
]
```

**permit "2019-UTIL-00001"** — 1 rows; 2026-10-10T18:11:19.904Z; 547 ms.
```json
[
  {
    "permitNumber": "2019-UTIL-00001",
    "address": "310 EDWIN DR",
    "status": "Closed",
    "issuedAt": "2019-01-02",
    "contractorName": null
  }
]
```


### Baltimore County, MD

Dataset: **Active Permits (Baltimore County, MD)**. ID: `a241ce53514c4f48a04e6c58f186307e`.
Metadata endpoint: https://bcgis.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/0?f=json
Data endpoint: https://bcgis.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/0
Adapter context URL: https://bcgis.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/0
Recorded baseline: `fixtures/opendata/Baltimore_County__MD.json`. Two source records:
```json
[
  {
    "permitNumber": "B318898",
    "address": "1009 LESLIE AVE",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "B327746",
    "address": "600 WARREN RD",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:21.492Z"** — 0 rows; 2026-10-10T18:11:21.492Z; 472 ms.
No matching sample records.

**address "1009 LESLIE AVE"** — 2 rows; 2026-10-10T18:11:21.964Z; 828 ms.
```json
[
  {
    "permitNumber": "B318898",
    "address": "1009 LESLIE AVE",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "B350800",
    "address": "1009 LESLIE AVE",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```

**permit "B318898"** — 1 rows; 2026-10-10T18:11:22.792Z; 920 ms.
```json
[
  {
    "permitNumber": "B318898",
    "address": "1009 LESLIE AVE",
    "status": null,
    "issuedAt": null,
    "contractorName": null
  }
]
```


### Montgomery County, MD

Dataset: **Residential Permit**. ID: `m88u-pqki`.
Metadata endpoint: https://data.montgomerycountymd.gov/api/views/m88u-pqki.json
Data endpoint: https://data.montgomerycountymd.gov/resource/m88u-pqki.json
Adapter context URL: https://permittingservices.montgomerycountymd.gov/DPS/online/eSearch.aspx
Recorded baseline: `fixtures/opendata/Montgomery_County__MD.json`. Two source records:
```json
[
  {
    "permitNumber": "554239",
    "address": "10408 BIT AND SPUR LN",
    "status": "Finaled",
    "issuedAt": "2010-12-02T01:12:00.000",
    "contractorName": null
  },
  {
    "permitNumber": "762841",
    "address": "612 WOODSIDE PKWY",
    "status": "Finaled",
    "issuedAt": "2016-11-07T09:11:33.000",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:16:37.337Z"** — 66 rows; 2026-10-10T18:16:37.337Z; 601 ms.
```json
[
  {
    "permitNumber": "1132448",
    "address": "16404 HENRY DR",
    "status": "Issued",
    "issuedAt": "2026-10-07T11:10:06.000",
    "contractorName": null
  },
  {
    "permitNumber": "1133698",
    "address": "8620 FALLS RD",
    "status": "Issued",
    "issuedAt": "2026-10-05T02:10:58.000",
    "contractorName": null
  }
]
```

**address "10408 BIT AND SPUR LN"** — 2 rows; 2026-10-10T18:16:37.938Z; 1162 ms.
```json
[
  {
    "permitNumber": "554239",
    "address": "10408 BIT AND SPUR LN",
    "status": "Finaled",
    "issuedAt": "2010-12-02T01:12:00.000",
    "contractorName": null
  },
  {
    "permitNumber": "859094",
    "address": "10408 BIT AND SPUR LN",
    "status": "Finaled",
    "issuedAt": "2018-11-23T11:11:27.000",
    "contractorName": null
  }
]
```

**permit "554239"** — 1 rows; 2026-10-10T18:16:39.100Z; 940 ms.
```json
[
  {
    "permitNumber": "554239",
    "address": "10408 BIT AND SPUR LN",
    "status": "Finaled",
    "issuedAt": "2010-12-02T01:12:00.000",
    "contractorName": null
  }
]
```


### Honolulu, HI

Dataset: **Building Permits - January 1, 2005 through June 30, 2025**. ID: `4vab-c87q`.
Metadata endpoint: https://data.honolulu.gov/api/views/4vab-c87q.json
Data endpoint: https://data.honolulu.gov/resource/4vab-c87q.json
Adapter context URL: https://data.honolulu.gov/resource/4vab-c87q.json
Dataset restriction: `buildingpermitno IS NOT NULL`.
Recorded baseline: `fixtures/opendata/Honolulu__HI.json`. Two source records:
```json
[
  {
    "permitNumber": "905164",
    "address": "3004 HERMAN ST Honolulu / Waialae Kahala 96816",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2024-02-26",
    "contractorName": null
  },
  {
    "permitNumber": "830417",
    "address": "626 HOEHOE PL Honolulu / Waialae Kahala 96821",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2019-03-25",
    "contractorName": "Hawaii Energy Connection, LLC  \n99-1350 Koaha Pl  / State Lic: CT31046 / ID: 41043291 / PH: (808) 382-7920, (808) 524-7336 Ext: # 3, (808) 779-3445, (808) 954-6818, (808) 954-6847, (808) 954-6847, (808) 256-8026, (808) 721-8480, (808) 524-7336, (808) 954-6820"
  }
]
```

**recent "2026-10-03T18:16:40.576Z"** — 0 rows; 2026-10-10T18:16:40.576Z; 574 ms.
No matching sample records.

**address "3004 HERMAN ST Honolulu / Waialae Kahala 96816"** — 2 rows; 2026-10-10T18:16:41.150Z; 1412 ms.
```json
[
  {
    "permitNumber": "905164",
    "address": "3004 HERMAN ST Honolulu / Waialae Kahala 96816",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2024-02-26",
    "contractorName": null
  },
  {
    "permitNumber": "922850",
    "address": "3004 HERMAN ST Honolulu / Waialae Kahala 96816",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2025-05-22",
    "contractorName": "SUNRUN INSTALLATION SVS INC  \n550 Paiea St Suite 506 / State Lic: CT28011 / ID: 26488664 / PH: (808) 228-1603"
  }
]
```

**permit "905164"** — 1 rows; 2026-10-10T18:16:42.562Z; 5441 ms.
```json
[
  {
    "permitNumber": "905164",
    "address": "3004 HERMAN ST Honolulu / Waialae Kahala 96816",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2024-02-26",
    "contractorName": null
  }
]
```

**company "LKL CONSTRUCTION INC"** — 100 rows; 2026-10-10T18:16:48.003Z; 2205 ms.
```json
[
  {
    "permitNumber": "908832",
    "address": "138 KUUHALE ST Kailua 96734",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2024-05-31",
    "contractorName": "LKL CONSTRUCTION INC  \n248  Libby St  / State Lic: CT34910 / ID: 57959587 / PH: (808) 599-0399, (808) 389-0821"
  },
  {
    "permitNumber": "815557",
    "address": "3418 KILAUEA AVE Honolulu / Waialae Kahala 96816",
    "status": "Inspection(s) in Progress",
    "issuedAt": "2018-04-02",
    "contractorName": "LKL CONSTRUCTION INC  \n918 Puuhale Rd. Suite B / State Lic: CT34910 / ID: 57959587 / PH: (808) 599-0399"
  }
]
```


### New Orleans, LA

Dataset: **Permits - BLDS**. ID: `72f9-bi28`.
Metadata endpoint: https://data.nola.gov/api/views/72f9-bi28.json
Data endpoint: https://data.nola.gov/resource/72f9-bi28.json
Adapter context URL: https://onestopapp.nola.gov/
Recorded baseline: `fixtures/opendata/New_Orleans__LA.json`. Two source records:
```json
[
  {
    "permitNumber": "08BLD-06810",
    "address": "3608 1St St",
    "status": "Application Acceptance - Approved No Review",
    "issuedAt": "2008-09-21",
    "contractorName": null
  },
  {
    "permitNumber": "11BLD-08166",
    "address": "2725 Amelia St",
    "status": "Inspection - Pending",
    "issuedAt": "2012-01-11",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:25:43.326Z"** — 243 rows; 2026-10-10T18:25:43.326Z; 774 ms.
```json
[
  {
    "permitNumber": "26-28311-HVAC",
    "address": "1033 Milan St",
    "status": "Permit Issued",
    "issuedAt": "2026-10-07T08:15:05.000",
    "contractorName": "Sam Joseph Celino  Jr."
  },
  {
    "permitNumber": "26-28616-HVAC",
    "address": "4518 Longfellow Dr",
    "status": "Permit Issued",
    "issuedAt": "2026-10-05T16:49:08.000",
    "contractorName": "Craig M. Emery"
  }
]
```

**address "3608 1St St"** — 8 rows; 2026-10-10T18:25:44.100Z; 1210 ms.
```json
[
  {
    "permitNumber": "08BLD-06810",
    "address": "3608 1St St",
    "status": "Application Acceptance - Approved No Review",
    "issuedAt": "2008-09-21",
    "contractorName": null
  },
  {
    "permitNumber": "13-47383-SERV",
    "address": "3608 1St St",
    "status": "Permit Issued",
    "issuedAt": "2013-12-11",
    "contractorName": "Keith George Swanier  Sr."
  }
]
```

**permit "08BLD-06810"** — 1 rows; 2026-10-10T18:25:45.310Z; 680 ms.
```json
[
  {
    "permitNumber": "08BLD-06810",
    "address": "3608 1St St",
    "status": "Application Acceptance - Approved No Review",
    "issuedAt": "2008-09-21",
    "contractorName": null
  }
]
```

**company "CONSTRUCTION"** — 21702 rows; 2026-10-10T18:25:45.990Z; 22522 ms.
```json
[
  {
    "permitNumber": "11MCH-09632",
    "address": "2243 Halsey Ave",
    "status": "Inspection - Completed",
    "issuedAt": "2011-12-07",
    "contractorName": "Lucas Construction Corp"
  },
  {
    "permitNumber": "11MCH-09745",
    "address": "115 Decatur St",
    "status": "Inspection - Completed",
    "issuedAt": "2011-12-12",
    "contractorName": "Ellis Construction"
  }
]
```


### Boston, MA

Dataset: **Approved Building Permits**. ID: `6ddcd912-32a0-43df-9908-63574f8c7e77`.
Metadata endpoint: https://data.boston.gov/api/3/action/package_show?id=approved-building-permits
Data endpoint: https://data.boston.gov/api/3/action/datastore_search_sql
Adapter context URL: https://data.boston.gov/api/3/action/datastore_search_sql
Recorded baseline: `fixtures/opendata/Boston__MA.json`. Two source records:
```json
[
  {
    "permitNumber": "A1004007",
    "address": "20 Polk ST",
    "status": "Closed",
    "issuedAt": "2019-10-10T14:07:59",
    "contractorName": null
  },
  {
    "permitNumber": "A1007876",
    "address": "26-28 Chilcott PL",
    "status": "Open",
    "issuedAt": "2020-07-01T13:46:56",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:17:13.888Z"** — 83 rows; 2026-10-10T18:17:13.888Z; 335 ms.
```json
[
  {
    "permitNumber": "ALT1886866",
    "address": "1001 Boylston ST",
    "status": "Open",
    "issuedAt": "2026-10-07T18:02:34",
    "contractorName": null
  },
  {
    "permitNumber": "ALT1899310",
    "address": "549 Bennington ST",
    "status": "Open",
    "issuedAt": "2026-10-08T13:34:14",
    "contractorName": null
  }
]
```

**address "20 Polk ST"** — 1 rows; 2026-10-10T18:17:14.223Z; 798 ms.
```json
[
  {
    "permitNumber": "A1004007",
    "address": "20 Polk ST",
    "status": "Closed",
    "issuedAt": "2019-10-10T14:07:59",
    "contractorName": null
  }
]
```

**permit "A1004007"** — 1 rows; 2026-10-10T18:17:15.021Z; 967 ms.
```json
[
  {
    "permitNumber": "A1004007",
    "address": "20 Polk ST",
    "status": "Closed",
    "issuedAt": "2019-10-10T14:07:59",
    "contractorName": null
  }
]
```


### Washington, DC

Dataset: **Building Permits in 2026**. ID: `7296e6392349498bb6ba6ba3db836644`.
Metadata endpoint: https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18?f=json
Data endpoint: https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18
Adapter context URL: https://citizenaccess.dc.gov/
Recorded baseline: `fixtures/opendata/Washington__DC.json`. Two source records:
```json
[
  {
    "permitNumber": "B2602071",
    "address": "224 LONGFELLOW ST NW, WASHINGTON, DC 20011",
    "status": "PERMIT ISSUED",
    "issuedAt": "2026-01-26T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "AH2600342",
    "address": "200 MASSACHUSETTS AVE NW, WASHINGTON, DC 20001",
    "status": "EXPIRED",
    "issuedAt": "2026-01-26T05:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:37.025Z"** — 604 rows; 2026-10-10T18:11:37.025Z; 1007 ms.
```json
[
  {
    "permitNumber": "HO2700037",
    "address": "6311 33RD ST NW, WASHINGTON, DC 20015",
    "status": "PERMIT ISSUED",
    "issuedAt": "2026-10-07T04:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B2502811-EXT-2",
    "address": "4027 ELY PL SE, WASHINGTON, DC 20019",
    "status": "PERMIT ISSUED",
    "issuedAt": "2026-10-07T04:00:00.000Z",
    "contractorName": null
  }
]
```

**address "224 LONGFELLOW ST NW, WASHINGTON, DC 20011"** — 1 rows; 2026-10-10T18:11:38.033Z; 848 ms.
```json
[
  {
    "permitNumber": "B2602071",
    "address": "224 LONGFELLOW ST NW, WASHINGTON, DC 20011",
    "status": "PERMIT ISSUED",
    "issuedAt": "2026-01-26T05:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "B2602071"** — 1 rows; 2026-10-10T18:11:38.881Z; 972 ms.
```json
[
  {
    "permitNumber": "B2602071",
    "address": "224 LONGFELLOW ST NW, WASHINGTON, DC 20011",
    "status": "PERMIT ISSUED",
    "issuedAt": "2026-01-26T05:00:00.000Z",
    "contractorName": null
  }
]
```


### Baltimore, MD

Dataset: **Housing and Building Permits 2019-Present**. ID: `189e6d1c65df4e13b38c0027cee574f6`.
Metadata endpoint: https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3?f=json
Data endpoint: https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3
Adapter context URL: https://aca-prod.accela.com/BALTIMORE/Default.aspx
Recorded baseline: `fixtures/opendata/Baltimore__MD.json`. Two source records:
```json
[
  {
    "permitNumber": "BCCM-25-000001",
    "address": "401 W REDWOOD ST",
    "status": null,
    "issuedAt": "2025-02-20T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BCCM-25-000002",
    "address": "309 N HOWARD ST",
    "status": null,
    "issuedAt": "2025-07-14T04:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:40.389Z"** — 612 rows; 2026-10-10T18:11:40.389Z; 785 ms.
```json
[
  {
    "permitNumber": "BCCM-25-000823",
    "address": "3400 N CHARLES ST",
    "status": null,
    "issuedAt": "2026-10-08T04:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BCCM-25-001326",
    "address": "6101 MORAVIA PARK DR",
    "status": null,
    "issuedAt": "2026-10-08T04:00:00.000Z",
    "contractorName": null
  }
]
```

**address "401 W REDWOOD ST"** — 2 rows; 2026-10-10T18:11:41.174Z; 935 ms.
```json
[
  {
    "permitNumber": "BCCM-25-000001",
    "address": "401 W REDWOOD ST",
    "status": null,
    "issuedAt": "2025-02-20T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BCCM-25-000376",
    "address": "401 W REDWOOD ST",
    "status": null,
    "issuedAt": "2025-03-05T05:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "BCCM-25-000001"** — 1 rows; 2026-10-10T18:11:42.109Z; 948 ms.
```json
[
  {
    "permitNumber": "BCCM-25-000001",
    "address": "401 W REDWOOD ST",
    "status": null,
    "issuedAt": "2025-02-20T05:00:00.000Z",
    "contractorName": null
  }
]
```


### Louisville, KY

Dataset: **Louisville Metro KY - Active Construction Permits**. ID: `0251a88cefdc4ab3a0d85943074e6d7b`.
Metadata endpoint: https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0?f=json
Data endpoint: https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0
Adapter context URL: https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0
Recorded baseline: `fixtures/opendata/Louisville__KY.json`. Two source records:
```json
[
  {
    "permitNumber": "14BL1477",
    "address": "2517 GARDINER LN",
    "status": "Issued",
    "issuedAt": "2014-02-24T05:00:00.000Z",
    "contractorName": "HOWELL CONSTRUCTION"
  },
  {
    "permitNumber": "14BL1478",
    "address": "6315 LABOR LN",
    "status": "Issued",
    "issuedAt": "2014-02-24T05:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:43.269Z"** — 292 rows; 2026-10-10T18:11:43.269Z; 903 ms.
```json
[
  {
    "permitNumber": "BLD-FSS-26-00246",
    "address": "2501 EXPORT DR",
    "status": "Issued",
    "issuedAt": "2026-10-09T04:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "BLD-FEN-26-00020",
    "address": "3740 BARDSTOWN RD",
    "status": "Issued",
    "issuedAt": "2026-10-07T04:00:00.000Z",
    "contractorName": null
  }
]
```

**address "2517 GARDINER LN"** — 1 rows; 2026-10-10T18:11:44.172Z; 1137 ms.
```json
[
  {
    "permitNumber": "14BL1477",
    "address": "2517 GARDINER LN",
    "status": "Issued",
    "issuedAt": "2014-02-24T05:00:00.000Z",
    "contractorName": "HOWELL CONSTRUCTION"
  }
]
```

**permit "14BL1477"** — 1 rows; 2026-10-10T18:11:45.309Z; 884 ms.
```json
[
  {
    "permitNumber": "14BL1477",
    "address": "2517 GARDINER LN",
    "status": "Issued",
    "issuedAt": "2014-02-24T05:00:00.000Z",
    "contractorName": "HOWELL CONSTRUCTION"
  }
]
```

**company "HOWELL CONSTRUCTION"** — 28 rows; 2026-10-10T18:11:46.193Z; 1118 ms.
```json
[
  {
    "permitNumber": "14BL1477",
    "address": "2517 GARDINER LN",
    "status": "Issued",
    "issuedAt": "2014-02-24T05:00:00.000Z",
    "contractorName": "HOWELL CONSTRUCTION"
  },
  {
    "permitNumber": "14BL1780",
    "address": "10101 PLAUDIT WAY",
    "status": "Issued",
    "issuedAt": "2014-03-17T04:00:00.000Z",
    "contractorName": "HOWELL CONSTRUCTION"
  }
]
```


### San Jose, CA

Dataset: **Recent Building Permit (30 Days)**. ID: `ff98b7202b6f4c02a66b7c2634d07416/7`.
Metadata endpoint: https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/7?f=json
Data endpoint: https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/7
Adapter context URL: https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/7
Recorded baseline: `fixtures/opendata/San_Jose__CA.json`. Two source records:
```json
[
  {
    "permitNumber": "2026-129136-RS",
    "address": "372 S MONROE ST  , SAN JOSE CA 95128-5108",
    "status": null,
    "issuedAt": "2026-09-15T07:00:00.000Z",
    "contractorName": "SEYED HOSSEINI"
  },
  {
    "permitNumber": "2026-137137-RS",
    "address": "20  ATLAS AV  , SAN JOSE CA 95126-3101",
    "status": null,
    "issuedAt": "2026-09-10T07:00:00.000Z",
    "contractorName": "ZF HEATING & COOLING LLC  ISABELLA LIU"
  }
]
```

**recent "2026-10-03T18:11:47.682Z"** — 571 rows; 2026-10-10T18:11:47.682Z; 922 ms.
```json
[
  {
    "permitNumber": "2026-140952-MF",
    "address": "2040 N CAPITOL AV 1 , SAN JOSE CA 95132-1012",
    "status": null,
    "issuedAt": "2026-10-04T07:00:00.000Z",
    "contractorName": "LAM,THANHCONG VAN"
  },
  {
    "permitNumber": "2026-140944-RS",
    "address": "1352  OLD PARK PL  , SAN JOSE CA 95132-2534",
    "status": null,
    "issuedAt": "2026-10-04T07:00:00.000Z",
    "contractorName": "TD ROOFING INC Mrs LESLIE HOANG"
  }
]
```

**address "372 S MONROE ST  , SAN JOSE CA 95128-5108"** — 1 rows; 2026-10-10T18:11:48.604Z; 816 ms.
```json
[
  {
    "permitNumber": "2026-129136-RS",
    "address": "372 S MONROE ST  , SAN JOSE CA 95128-5108",
    "status": null,
    "issuedAt": "2026-09-15T07:00:00.000Z",
    "contractorName": "SEYED HOSSEINI"
  }
]
```

**permit "2026-129136-RS"** — 1 rows; 2026-10-10T18:11:49.420Z; 995 ms.
```json
[
  {
    "permitNumber": "2026-129136-RS",
    "address": "372 S MONROE ST  , SAN JOSE CA 95128-5108",
    "status": null,
    "issuedAt": "2026-09-15T07:00:00.000Z",
    "contractorName": "SEYED HOSSEINI"
  }
]
```

**company "SEYED HOSSEINI"** — 1 rows; 2026-10-10T18:11:50.416Z; 1004 ms.
```json
[
  {
    "permitNumber": "2026-129136-RS",
    "address": "372 S MONROE ST  , SAN JOSE CA 95128-5108",
    "status": null,
    "issuedAt": "2026-09-15T07:00:00.000Z",
    "contractorName": "SEYED HOSSEINI"
  }
]
```


### Harris County, TX

Dataset: **Permits**. ID: `AiPermitsService/1`.
Metadata endpoint: https://www.gis.hctx.net/arcgishcpid/rest/services/Permits/AiPermitsService/FeatureServer/1?f=json
Data endpoint: https://www.gis.hctx.net/arcgishcpid/rest/services/Permits/AiPermitsService/FeatureServer/1
Adapter context URL: https://epermits.harriscountytx.gov/PublicProjectStatus.aspx
Recorded baseline: `fixtures/opendata/Harris_County__TX.json`. Two source records:
```json
[
  {
    "permitNumber": "1905100027-RDW-001",
    "address": "7418 Evelyn Grove Dr Spring TX 77379",
    "status": "Issued",
    "issuedAt": "2019-05-13T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "1905100027-RSW-001",
    "address": "7418 Evelyn Grove Dr Spring TX 77379",
    "status": "Issued",
    "issuedAt": "2019-05-13T05:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:11:51.663Z"** — 804 rows; 2026-10-10T18:11:51.663Z; 1938 ms.
```json
[
  {
    "permitNumber": "2605150098-RDW-001",
    "address": "22643 Potterstone Peak Dr Katy TX 77449",
    "status": "Issued",
    "issuedAt": "2026-10-06T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "2411130087-AST-001",
    "address": "1401 Hugh Rd Bldg 2 Houston TX 77067",
    "status": "Issued",
    "issuedAt": "2026-10-07T05:00:00.000Z",
    "contractorName": null
  }
]
```

**address "7418 Evelyn Grove Dr Spring TX 77379"** — 3 rows; 2026-10-10T18:11:53.601Z; 5317 ms.
```json
[
  {
    "permitNumber": "1905100027-RDW-001",
    "address": "7418 Evelyn Grove Dr Spring TX 77379",
    "status": "Issued",
    "issuedAt": "2019-05-13T05:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "1905100027-RSW-001",
    "address": "7418 Evelyn Grove Dr Spring TX 77379",
    "status": "Issued",
    "issuedAt": "2019-05-13T05:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "1905100027-RDW-001"** — 1 rows; 2026-10-10T18:11:58.919Z; 239 ms.
```json
[
  {
    "permitNumber": "1905100027-RDW-001",
    "address": "7418 Evelyn Grove Dr Spring TX 77379",
    "status": "Issued",
    "issuedAt": "2019-05-13T05:00:00.000Z",
    "contractorName": null
  }
]
```


### Charlotte, NC

Dataset: **Building Permit Locations**. ID: `fc9d171ecd4d44a58c7dad840cd58aa2`.
Metadata endpoint: https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0?f=json
Data endpoint: https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0
Adapter context URL: https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0
Dataset restriction: `taxjuris = 'CHARLOTTE'`.
Recorded baseline: `fixtures/opendata/Charlotte__NC.json`. Two source records:
```json
[
  {
    "permitNumber": "B4803939",
    "address": "3708  EASTWAY DR",
    "status": "Complete",
    "issuedAt": "2025-04-24T16:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B1576804",
    "address": "9535 MONROE RD Unit: 120",
    "status": "Complete",
    "issuedAt": "2006-02-20T05:00:00.000Z",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:17:15.989Z"** — 15 rows; 2026-10-10T18:17:15.989Z; 1112 ms.
```json
[
  {
    "permitNumber": "B4838965",
    "address": "10225  LITTLE WHITEOAK RD",
    "status": "Issued",
    "issuedAt": "2026-10-05T16:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "B4838932",
    "address": "2801 S TRYON ST",
    "status": "Issued",
    "issuedAt": "2026-10-05T16:00:00.000Z",
    "contractorName": null
  }
]
```

**address "3708  EASTWAY DR"** — 1 rows; 2026-10-10T18:17:17.101Z; 1575 ms.
```json
[
  {
    "permitNumber": "B4803939",
    "address": "3708  EASTWAY DR",
    "status": "Complete",
    "issuedAt": "2025-04-24T16:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "B4803939"** — 1 rows; 2026-10-10T18:17:18.676Z; 1132 ms.
```json
[
  {
    "permitNumber": "B4803939",
    "address": "3708  EASTWAY DR",
    "status": "Complete",
    "issuedAt": "2025-04-24T16:00:00.000Z",
    "contractorName": null
  }
]
```


### Kansas City, MO

Dataset: **Permits - CPD Dataset**. ID: `ntw8-aacc`.
Metadata endpoint: https://data.kcmo.org/api/views/ntw8-aacc.json
Data endpoint: https://data.kcmo.org/resource/ntw8-aacc.json
Adapter context URL: https://compasskc.kcmo.org/EnerGov_Prod/SelfService#/home
Recorded baseline: `fixtures/opendata/Kansas_City__MO.json`. Two source records:
```json
[
  {
    "permitNumber": "CICO-200010001",
    "address": "9922 N Highland Pl",
    "status": "Closed",
    "issuedAt": "1999-05-19",
    "contractorName": null
  },
  {
    "permitNumber": "CICO-200010002",
    "address": "6421 E Gregory Blvd",
    "status": "Closed",
    "issuedAt": "1999-05-14",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:16:53.859Z"** — 0 rows; 2026-10-10T18:16:53.859Z; 560 ms.
No matching sample records.

**address "9922 N Highland Pl"** — 8 rows; 2026-10-10T18:16:54.419Z; 1201 ms.
```json
[
  {
    "permitNumber": "CICO-200010001",
    "address": "9922 N Highland Pl",
    "status": "Closed",
    "issuedAt": "1999-05-19",
    "contractorName": null
  },
  {
    "permitNumber": "CICO-CPBR-9914991",
    "address": "9922 N Highland Pl",
    "status": "Closed",
    "issuedAt": "1999-05-13",
    "contractorName": null
  }
]
```

**permit "CICO-200010001"** — 1 rows; 2026-10-10T18:16:55.621Z; 799 ms.
```json
[
  {
    "permitNumber": "CICO-200010001",
    "address": "9922 N Highland Pl",
    "status": "Closed",
    "issuedAt": "1999-05-19",
    "contractorName": null
  }
]
```

**company "R.W. ELECTRIC & CONSTRUCTION, INCORPORATED"** — 1057 rows; 2026-10-10T18:16:56.420Z; 2171 ms.
```json
[
  {
    "permitNumber": "CPBF-200522180",
    "address": "218 E 11th St",
    "status": "Issued",
    "issuedAt": "2004-10-26",
    "contractorName": "R.W. ELECTRIC & CONSTRUCTION, INCORPORATED"
  },
  {
    "permitNumber": "CPEC-2018-35982",
    "address": "8230 N Oak Trfy",
    "status": "Closed",
    "issuedAt": "2018-10-22",
    "contractorName": "R.W. ELECTRIC & CONSTRUCTION, INCORPORATED"
  }
]
```


### San Antonio, TX

Dataset: **Building Permits - PERMITS ISSUED**. ID: `c21106f9-3ef5-4f3a-8604-f992b4db7512`.
Metadata endpoint: https://data.sanantonio.gov/api/3/action/package_show?id=building-permits
Data endpoint: https://data.sanantonio.gov/api/3/action/datastore_search_sql
Adapter context URL: https://aca-prod.accela.com/COSA/Default.aspx
Dataset restriction: `"PERMIT TYPE" != 'Garage Sale'`.
Recorded baseline: `fixtures/opendata/San_Antonio__TX.json`. Two source records:
```json
[
  {
    "permitNumber": "COM-BLG-PMT24-40200788",
    "address": "8751 STATE HWY 151, City of San Antonio, TX 78245",
    "status": null,
    "issuedAt": "2025-01-01",
    "contractorName": null
  },
  {
    "permitNumber": "COM-BLG-PMT24-40200661",
    "address": "6215 BRITNEY CIRCLE, City of San Antonio, TX 78233",
    "status": null,
    "issuedAt": "2025-01-02",
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:12:11.673Z"** — 0 rows; 2026-10-10T18:12:11.673Z; 101 ms.
No matching sample records.

**address "8751 STATE HWY 151, City of San Antonio, TX 78245"** — 10 rows; 2026-10-10T18:12:11.774Z; 1039 ms.
```json
[
  {
    "permitNumber": "COM-BLG-PMT24-40200788",
    "address": "8751 STATE HWY 151, City of San Antonio, TX 78245",
    "status": null,
    "issuedAt": "2025-01-01",
    "contractorName": null
  },
  {
    "permitNumber": "COM-BLG-PMT24-40200788",
    "address": "8751 STATE HWY 151, City of San Antonio, TX 78245",
    "status": null,
    "issuedAt": "2025-01-01",
    "contractorName": null
  }
]
```

**permit "COM-BLG-PMT24-40200788"** — 7 rows; 2026-10-10T18:12:12.813Z; 953 ms.
```json
[
  {
    "permitNumber": "COM-BLG-PMT24-40200788",
    "address": "8751 STATE HWY 151, City of San Antonio, TX 78245",
    "status": null,
    "issuedAt": "2025-01-01",
    "contractorName": null
  },
  {
    "permitNumber": "COM-BLG-PMT24-40200788",
    "address": "8751 STATE HWY 151, City of San Antonio, TX 78245",
    "status": null,
    "issuedAt": "2025-01-01",
    "contractorName": null
  }
]
```


### San Diego, CA

Dataset: **Permit Approvals (Accela)**. ID: `9e20b434e8424f3eb248a0088f21a208/0`.
Metadata endpoint: https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/0?f=json
Data endpoint: https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/0
Adapter context URL: https://aca-prod.accela.com/SANDIEGO/Default.aspx
Dataset restriction: `APPROVAL_ID LIKE 'PMT-%'`.
Recorded baseline: `fixtures/opendata/San_Diego__CA.json`. Two source records:
```json
[
  {
    "permitNumber": "PMT-3235703",
    "address": "10165 Mc Kellar Ct, San Diego, CA 92121",
    "status": "Closed",
    "issuedAt": "2023-07-28T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "PMT-3040450",
    "address": "828 Prospect St, San Diego, CA 92037",
    "status": "Pending Invoice Payment",
    "issuedAt": null,
    "contractorName": null
  }
]
```

**recent "2026-10-03T18:12:14.037Z"** — 750 rows; 2026-10-10T18:12:14.037Z; 2336 ms.
```json
[
  {
    "permitNumber": "PMT-3417825",
    "address": "4182 Utah St, San Diego, CA 92104",
    "status": "Issued",
    "issuedAt": "2026-10-06T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "PMT-3431947",
    "address": "1222 01st Av, San Diego, CA",
    "status": "Issued",
    "issuedAt": "2026-10-08T00:00:00.000Z",
    "contractorName": null
  }
]
```

**address "10165 Mc Kellar Ct, San Diego, CA 92121"** — 25 rows; 2026-10-10T18:12:16.373Z; 3815 ms.
```json
[
  {
    "permitNumber": "PMT-3235703",
    "address": "10165 Mc Kellar Ct, San Diego, CA 92121",
    "status": "Closed",
    "issuedAt": "2023-07-28T00:00:00.000Z",
    "contractorName": null
  },
  {
    "permitNumber": "PMT-3304386",
    "address": "10165 Mc Kellar Ct, San Diego, CA 92121",
    "status": "Closed",
    "issuedAt": "2024-09-25T00:00:00.000Z",
    "contractorName": null
  }
]
```

**permit "PMT-3235703"** — 1 rows; 2026-10-10T18:12:20.188Z; 899 ms.
```json
[
  {
    "permitNumber": "PMT-3235703",
    "address": "10165 Mc Kellar Ct, San Diego, CA 92121",
    "status": "Closed",
    "issuedAt": "2023-07-28T00:00:00.000Z",
    "contractorName": null
  }
]
```


### Denver, CO

Dataset: **Residential Construction Permits**. ID: `014a873bf7444a658fc2ea0da7ad0704`.
Metadata endpoint: https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316?f=json
Data endpoint: https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316
Adapter context URL: https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316
Recorded baseline: `fixtures/opendata/Denver__CO.json`. Two source records:
```json
[
  {
    "permitNumber": "2012-RESCON-0000004625",
    "address": "3729 N LIPAN ST",
    "status": null,
    "issuedAt": "2012-11-15T03:28:55.000Z",
    "contractorName": "BUDGET GARAGES & CONSTRUCTION CO INC"
  },
  {
    "permitNumber": "2012-RESCON-0000004884",
    "address": "395 S GAYLORD ST BASEMENT",
    "status": null,
    "issuedAt": "2012-11-16T02:20:16.000Z",
    "contractorName": "GEELS CONSTRUCTION INC"
  }
]
```

**recent "2026-10-03T18:12:21.247Z"** — 70 rows; 2026-10-10T18:12:21.247Z; 971 ms.
```json
[
  {
    "permitNumber": "2026-RESCON-0001088",
    "address": "1346 S Logan ST Shoring",
    "status": null,
    "issuedAt": "2026-10-05T00:00:00.000Z",
    "contractorName": "RINKER CONSTRUCTION & DEVELOPMENT LLC"
  },
  {
    "permitNumber": "2026-RESCON-0002765",
    "address": "2843 W 27th AVE",
    "status": null,
    "issuedAt": "2026-10-05T00:00:00.000Z",
    "contractorName": "SKYLIGHT SPECIALISTS INC"
  }
]
```

**address "3729 N LIPAN ST"** — 1 rows; 2026-10-10T18:12:22.218Z; 1168 ms.
```json
[
  {
    "permitNumber": "2012-RESCON-0000004625",
    "address": "3729 N LIPAN ST",
    "status": null,
    "issuedAt": "2012-11-15T03:28:55.000Z",
    "contractorName": "BUDGET GARAGES & CONSTRUCTION CO INC"
  }
]
```

**permit "2012-RESCON-0000004625"** — 1 rows; 2026-10-10T18:12:23.386Z; 874 ms.
```json
[
  {
    "permitNumber": "2012-RESCON-0000004625",
    "address": "3729 N LIPAN ST",
    "status": null,
    "issuedAt": "2012-11-15T03:28:55.000Z",
    "contractorName": "BUDGET GARAGES & CONSTRUCTION CO INC"
  }
]
```

**company "BUDGET GARAGES & CONSTRUCTION CO INC"** — 267 rows; 2026-10-10T18:12:24.260Z; 3753 ms.
```json
[
  {
    "permitNumber": "2012-RESCON-0000004625",
    "address": "3729 N LIPAN ST",
    "status": null,
    "issuedAt": "2012-11-15T03:28:55.000Z",
    "contractorName": "BUDGET GARAGES & CONSTRUCTION CO INC"
  },
  {
    "permitNumber": "2012-RESCON-0000292477",
    "address": "1877 S LINCOLN ST GAR",
    "status": null,
    "issuedAt": "2012-09-10T01:38:23.000Z",
    "contractorName": "BUDGET GARAGES & CONSTRUCTION CO INC"
  }
]
```

## 4. Blocked and failed probes

No final acceptance search or listRecent query failed. These development/probe failures are preserved rather than presented as empty results:

- San Antonio: HTTP 403 on a broad SQL fixture request using `1=1`, resource `c21106f9-3ef5-4f3a-8604-f992b4db7512`, LIMIT 2. The response body was not retained by politeJson, so the challenge vendor/type is unknown. No challenge was bypassed. Its documented datastore_search API provided the fixture with a `PERMIT TYPE = Comm New Building Permit` filter; native SQL date, actual-address, and permit searches succeeded.
- Boston: HTTP 403 on a later broad datastore_search_sql fixture request using `1=1`, resource `6ddcd912-32a0-43df-9908-63574f8c7e77`. Earlier complete responses were retained; the final date, actual-address, and permit requests succeeded. Challenge type unknown; no authentication or challenge handling attempted.
- Mecklenburg County and Charlotte: HTTP 403 on later broad `1=1` ArcGIS fixture probes at the same county service (Charlotte also had its taxjuris predicate). Earlier complete fixtures were reused; final issue-date, actual-address, and permit searches succeeded. Challenge type unknown. These were fixture failures, not zero-result permit searches.
- Las Vegas: initial native address expression returned HTTP 200 with ArcGIS error 400, invalid where. Fixed by querying the numeric street number and individual text fields rather than unsupported CAST/concatenation. Final address search succeeds.
- San Diego: HTTP 200 with API error -2147467259, Invalid SQL statement, caused by an empty-string comparison. Null-only identifier checking is supported and now used for ArcGIS. Final recent/address/permit searches succeed.
- Honolulu: an early company query encountered source rows without a permit number. Native identifier filtering now excludes unidentifiable rows; final company search succeeds. Source placeholders such as NONE remain in raw and normalize to null.
- Los Angeles County: initial module filter produced empty results; a native distinct-value query verified PermitManagement, which is the final restriction. That verification response is saved in metadata/.
- Kansas City: an early company probe using the source placeholder Needs Contact was stopped rather than completing a 232,865-row placeholder search (that count is source metadata, not a completed adapter result). The final company query uses the metadata-published R.W. ELECTRIC & CONSTRUCTION, INCORPORATED and completes. Placeholder names normalize to null.
- New Orleans: the initially selected nbcf-m6c2 feed ended in 2024. Official catalog discovery verified current replacement 72f9-bi28 (Permits - BLDS), which is now configured and was retested.
- Discovery only: retired Socrata catalog contexts for Nashville, Baltimore, Detroit, and Chattanooga returned 404; current official ArcGIS replacements were used where verified. Boston’s incorrect package slug building-permits returned 404; approved-building-permits is verified. Houston’s city-linked PDD/Permit_Viewer/MapServer returned a JSON service-not-found 404; Houston was not configured. Dallas’s official dataset says it is historical and directs active tracking to Accela; it was not configured. No third-party copies were substituted.

Native maximum-date checks were also run to distinguish stale feeds from merely empty windows. These are source maxima, not inferred update guarantees; exact aggregate responses are in `latest-*.json`. LA subsequently returned 24 records once the calendar-day lookback was used.

| Jurisdiction | Maximum published recent-field value | Checked UTC |
|---|---|---|
| Los Angeles, CA | 2026-10-03T00:00:00.000 | 2026-10-10T18:13:31.721Z |
| Las Vegas, NV | 2026-10-02T00:00:00+00:00 | 2026-10-10T18:13:32.205Z |
| Portland, OR | 2026-10-01T17:04:50+00:00 | 2026-10-10T18:13:32.503Z |
| Virginia Beach, VA | 2026-07-31 | 2026-10-10T18:13:33.307Z |
| Baltimore County, MD | 2021-10-27T00:00:00+00:00 | 2026-10-10T18:13:33.626Z |
| Honolulu, HI | 2025-07-01T00:00:00.000 | 2026-10-10T18:13:33.941Z |
| Kansas City, MO | 2025-05-09T00:00:00.000 | 2026-10-10T18:13:35.039Z |
| San Antonio, TX | 2026-10-02 | 2026-10-10T18:13:35.578Z |
| New Orleans, LA | 2026-10-07T21:40:05.000 | 2026-10-10T18:25:52.566500+00:00 |

## 5. Coverage and merge instructions

29 / 254 targets.json rows have exact catalog URLs accepted by this adapter. Configured Louisville has a null target URL. Ten configured jurisdictions are absent from this targets file: Las Vegas, NV, Los Angeles County, CA, Pierce County, WA, Virginia Beach, VA, Baltimore County, MD, Honolulu, HI, Boston, MA, San Jose, CA, Charlotte, NC, Denver, CO. For these 11, supply the verified dataset endpoint as searchUrl. Exact city names were checked against server/data/all-cities.json.

Only `Open data` is registered; aliases: none. The supplied targets include Accela, EnerGov, city-site and other labels. Those labels describe the transactional websites and must not be globally aliased to open data. The merge step must route only OPENDATA_JURISDICTIONS by jurisdiction, preserving other adapters for other tenants.

225 catalog rows are not directly accepted. Louisville is excluded only because its current URL is null. The remaining 224 exact jurisdiction keys have no verified configured dataset in this implementation; many are same-named municipalities in other states, other transactional platforms, or information-only pages. None is guessed from its city name. The complete excluded-key list is:

- Alameda County, CA — no verified configured dataset.
- Albuquerque, NM — no verified configured dataset.
- Atlanta, GA — no verified configured dataset.
- Atlanta, IL — no verified configured dataset.
- Atlanta, IN — no verified configured dataset.
- Atlanta, TX — no verified configured dataset.
- Austin, AR — no verified configured dataset.
- Austin, IN — no verified configured dataset.
- Austin, MN — no verified configured dataset.
- Baltimore, OH — no verified configured dataset.
- Bexar County, TX — no verified configured dataset.
- Boston, NY — no verified configured dataset.
- Broward County, FL — no verified configured dataset.
- Charlotte, IA — no verified configured dataset.
- Charlotte, MI — no verified configured dataset.
- Clark County, ID — no verified configured dataset.
- Clark County, IN — no verified configured dataset.
- Clark County, KY — no verified configured dataset.
- Clark County, NV — no verified configured dataset.
- Clark County, OH — no verified configured dataset.
- Clark County, SD — no verified configured dataset.
- Clark County, WA — no verified configured dataset.
- Clark County, WI — no verified configured dataset.
- Cleveland, AL — no verified configured dataset.
- Cleveland, GA — no verified configured dataset.
- Cleveland, MN — no verified configured dataset.
- Cleveland, MO — no verified configured dataset.
- Cleveland, MS — no verified configured dataset.
- Cleveland, NY — no verified configured dataset.
- Cleveland, OK — no verified configured dataset.
- Cleveland, TN — no verified configured dataset.
- Cleveland, TX — no verified configured dataset.
- Cleveland, WI — no verified configured dataset.
- Columbus, GA — no verified configured dataset.
- Columbus, IN — no verified configured dataset.
- Columbus, KS — no verified configured dataset.
- Columbus, MI — no verified configured dataset.
- Columbus, MN — no verified configured dataset.
- Columbus, MS — no verified configured dataset.
- Columbus, ND — no verified configured dataset.
- Columbus, NE — no verified configured dataset.
- Columbus, TX — no verified configured dataset.
- Columbus, WI — no verified configured dataset.
- Cook County, IL — no verified configured dataset.
- Cook County, MN — no verified configured dataset.
- Cuyahoga County, OH — no verified configured dataset.
- Dallas County, IA — no verified configured dataset.
- Dallas County, TX — no verified configured dataset.
- Dallas, GA — no verified configured dataset.
- Dallas, NC — no verified configured dataset.
- Dallas, OR — no verified configured dataset.
- Dallas, PA — no verified configured dataset.
- Dallas, TX — no verified configured dataset.
- DeKalb County, GA — no verified configured dataset.
- DeKalb County, IN — no verified configured dataset.
- DeKalb County, TN — no verified configured dataset.
- Detroit, TX — no verified configured dataset.
- El Paso, IL — no verified configured dataset.
- El Paso, TX — no verified configured dataset.
- Fairfax County, VA — no verified configured dataset.
- Franklin County, FL — no verified configured dataset.
- Franklin County, GA — no verified configured dataset.
- Franklin County, IA — no verified configured dataset.
- Franklin County, ID — no verified configured dataset.
- Franklin County, IL — no verified configured dataset.
- Franklin County, IN — no verified configured dataset.
- Franklin County, KS — no verified configured dataset.
- Franklin County, KY — no verified configured dataset.
- Franklin County, MO — no verified configured dataset.
- Franklin County, NC — no verified configured dataset.
- Franklin County, NE — no verified configured dataset.
- Franklin County, OH — no verified configured dataset.
- Franklin County, TN — no verified configured dataset.
- Franklin County, TX — no verified configured dataset.
- Franklin County, VA — no verified configured dataset.
- Franklin County, WA — no verified configured dataset.
- Fresno, CA — no verified configured dataset.
- Fulton County, GA — no verified configured dataset.
- Fulton County, IL — no verified configured dataset.
- Fulton County, IN — no verified configured dataset.
- Fulton County, OH — no verified configured dataset.
- Gwinnett County, GA — no verified configured dataset.
- Harris County, GA — no verified configured dataset.
- Hillsborough County, FL — no verified configured dataset.
- Houston, AK — no verified configured dataset.
- Houston, DE — no verified configured dataset.
- Houston, MN — no verified configured dataset.
- Houston, MO — no verified configured dataset.
- Houston, MS — no verified configured dataset.
- Houston, TX — no verified configured dataset.
- Indianapolis, IN — no verified configured dataset.
- Jackson County, CO — no verified configured dataset.
- Jackson County, FL — no verified configured dataset.
- Jackson County, GA — no verified configured dataset.
- Jackson County, IA — no verified configured dataset.
- Jackson County, IN — no verified configured dataset.
- Jackson County, KS — no verified configured dataset.
- Jackson County, MN — no verified configured dataset.
- Jackson County, MO — no verified configured dataset.
- Jackson County, MS — no verified configured dataset.
- Jackson County, NC — no verified configured dataset.
- Jackson County, OR — no verified configured dataset.
- Jackson County, TX — no verified configured dataset.
- Jackson County, WI — no verified configured dataset.
- Jacksonville, AL — no verified configured dataset.
- Jacksonville, AR — no verified configured dataset.
- Jacksonville, FL — no verified configured dataset.
- Jacksonville, IL — no verified configured dataset.
- Jacksonville, NC — no verified configured dataset.
- Jacksonville, OR — no verified configured dataset.
- Jacksonville, TX — no verified configured dataset.
- Jefferson County, AL — no verified configured dataset.
- Jefferson County, AR — no verified configured dataset.
- Jefferson County, FL — no verified configured dataset.
- Jefferson County, GA — no verified configured dataset.
- Jefferson County, ID — no verified configured dataset.
- Jefferson County, IN — no verified configured dataset.
- Jefferson County, KS — no verified configured dataset.
- Jefferson County, MO — no verified configured dataset.
- Jefferson County, MT — no verified configured dataset.
- Jefferson County, NE — no verified configured dataset.
- Jefferson County, NY — no verified configured dataset.
- Jefferson County, OR — no verified configured dataset.
- Jefferson County, TN — no verified configured dataset.
- Jefferson County, TX — no verified configured dataset.
- Jefferson County, WA — no verified configured dataset.
- Jefferson County, WI — no verified configured dataset.
- Jefferson County, WV — no verified configured dataset.
- Kansas City, KS — no verified configured dataset.
- King County, WA — no verified configured dataset.
- Las Vegas, NM — no verified configured dataset.
- Louisville, CO — no verified configured dataset.
- Louisville, KY — configured dataset, but catalog URL is null.
- Louisville, MS — no verified configured dataset.
- Louisville, OH — no verified configured dataset.
- Marion County, FL — no verified configured dataset.
- Marion County, GA — no verified configured dataset.
- Marion County, IA — no verified configured dataset.
- Marion County, KS — no verified configured dataset.
- Marion County, OR — no verified configured dataset.
- Marion County, SC — no verified configured dataset.
- Marion County, TN — no verified configured dataset.
- Marion County, WV — no verified configured dataset.
- Mecklenburg County, VA — no verified configured dataset.
- Memphis, MI — no verified configured dataset.
- Memphis, TN — no verified configured dataset.
- Memphis, TX — no verified configured dataset.
- Miami, FL — no verified configured dataset.
- Miami, OK — no verified configured dataset.
- Milwaukee, WI — no verified configured dataset.
- Minneapolis, KS — no verified configured dataset.
- Montgomery County, AL — no verified configured dataset.
- Montgomery County, GA — no verified configured dataset.
- Montgomery County, IA — no verified configured dataset.
- Montgomery County, IN — no verified configured dataset.
- Montgomery County, KS — no verified configured dataset.
- Montgomery County, MO — no verified configured dataset.
- Montgomery County, NC — no verified configured dataset.
- Montgomery County, OH — no verified configured dataset.
- Montgomery County, TN — no verified configured dataset.
- Montgomery County, TX — no verified configured dataset.
- Montgomery County, VA — no verified configured dataset.
- Multnomah County, OR — no verified configured dataset.
- Nashville, AR — no verified configured dataset.
- Oklahoma City, OK — no verified configured dataset.
- Omaha, NE — no verified configured dataset.
- Orange County, FL — no verified configured dataset.
- Orange County, NC — no verified configured dataset.
- Orange County, TX — no verified configured dataset.
- Orange County, VA — no verified configured dataset.
- Orlando, FL — no verified configured dataset.
- Palm Beach County, FL — no verified configured dataset.
- Philadelphia, MS — no verified configured dataset.
- Phoenix, IL — no verified configured dataset.
- Phoenix, OR — no verified configured dataset.
- Pima County, AZ — no verified configured dataset.
- Pittsburgh, PA — no verified configured dataset.
- Portland, CT — no verified configured dataset.
- Portland, IN — no verified configured dataset.
- Portland, ME — no verified configured dataset.
- Portland, MI — no verified configured dataset.
- Portland, ND — no verified configured dataset.
- Portland, NY — no verified configured dataset.
- Portland, PA — no verified configured dataset.
- Portland, TN — no verified configured dataset.
- Portland, TX — no verified configured dataset.
- Riverside County, CA — no verified configured dataset.
- Sacramento County, CA — no verified configured dataset.
- Sacramento, CA — no verified configured dataset.
- Salt Lake County, UT — no verified configured dataset.
- San Bernardino County, CA — no verified configured dataset.
- San Diego County, CA — no verified configured dataset.
- San Jose, IL — no verified configured dataset.
- Santa Clara County, CA — no verified configured dataset.
- Shelby County, AL — no verified configured dataset.
- Shelby County, IA — no verified configured dataset.
- Shelby County, IL — no verified configured dataset.
- Shelby County, IN — no verified configured dataset.
- Shelby County, KY — no verified configured dataset.
- Shelby County, OH — no verified configured dataset.
- Shelby County, TN — no verified configured dataset.
- St. Louis, MO — no verified configured dataset.
- Tampa, FL — no verified configured dataset.
- Tarrant County, TX — no verified configured dataset.
- Travis County, TX — no verified configured dataset.
- Washington, CT — no verified configured dataset.
- Washington, GA — no verified configured dataset.
- Washington, IA — no verified configured dataset.
- Washington, IL — no verified configured dataset.
- Washington, IN — no verified configured dataset.
- Washington, ME — no verified configured dataset.
- Washington, MI — no verified configured dataset.
- Washington, MO — no verified configured dataset.
- Washington, NC — no verified configured dataset.
- Washington, NH — no verified configured dataset.
- Washington, NJ — no verified configured dataset.
- Washington, OK — no verified configured dataset.
- Washington, PA — no verified configured dataset.
- Washington, UT — no verified configured dataset.
- Wayne County, GA — no verified configured dataset.
- Wayne County, IN — no verified configured dataset.
- Wayne County, NC — no verified configured dataset.
- Wayne County, NE — no verified configured dataset.
- Wayne County, OH — no verified configured dataset.
- Wayne County, UT — no verified configured dataset.

## 6. Known gaps and follow-up

- This delivers 40 verified jurisdiction configurations, not universal coverage of the population-ranked largest 40. Houston, Phoenix, Dallas, King County, Jacksonville, Indianapolis, and other major jurisdictions remain outside this map. Verify their official current native dataset or use the corresponding transactional adapter; do not use mirrors to fill the count.
- Honolulu is explicitly a static historical extract; Kansas City is stale. Baltimore County’s active-development layer ends in 2021, Virginia Beach’s selected layer in July 2026. These support genuine native date queries but cannot provide current hourly alerts until the publishers refresh them or a current official replacement is verified. Review the maximum-date table before routing alerts.
- NYC is DOB NOW Build approved permits only: BIS legacy issuances and separately published electrical/elevator datasets are not included. LA starts in 2020. Seattle is building permits. Portland is residential permits. Montgomery County is residential permits. Denver is residential construction. Louisville is active construction permits. San Jose is the last-30-days layer. Washington is the 2026 layer and needs a verified next-year dataset at rollover. These are dataset scopes, not complete coverage of every trade/history in each city.
- San Antonio excludes garage-sale records and its current file ends on 2026-10-02 at verification. Fort Worth lists development applications by File_Date and includes development review categories; Baltimore County lists by APPL_DATE. They do not assert issuance where only an application date exists.
- Calendar-day fields cannot implement a strict sub-day cursor. Replaying the since-day is deliberate; the alerts poller needs deduplication and an overlapping lookback for publisher delays. Source refreshes can lag issue dates by days. Offset pagination is ordered but cannot provide a transactional snapshot while a publisher rewrites its data.
- Agency boundaries can include ETJs or other municipalities. Mecklenburg is the county publisher’s full coverage, while Charlotte applies the verified taxjuris filter. County and city results must not be double-counted.
- Source datasets may contain renewals, amendments, multiple addresses, or duplicate permit numbers. Rows are preserved rather than merged into invented records. Where the source does not publish contractor/status/valuation/coordinates/public record links, those values are null. No per-record browser scraping enriches missing fields.
- Follow up with metadata/schema freshness checks, official replacement feeds for stale datasets, additional NYC/Denver/Portland trade datasets, and year rollover for Washington. Update the verified URL allowlist if catalog URLs change; do not accept an arbitrary tenant on a shared host.

Validation: `npx vitest run server/scrapers/opendata.test.ts --configLoader runner` passes 26 tests, offline, across all four dataset kinds, schema maps, native query escaping, date precision, tenant validation, blocked/error responses, and pagination. `npx tsc --noEmit -p .` passes. The unmodified requested Vitest command cannot start in this container because node_modules/.vite-temp is read-only (EROFS); the runner option uses the same repository config without that cache write. No repository configuration was changed for the workaround.

## 7. Contractor and applicant names — verified 2026-10-14

Paid research reports search permits by a contractor company or a person's name. On 2026-10-10 seven configured datasets had no name field mapped, so those searches were refused. Each was re-checked on 2026-10-14 against live publisher metadata (Socrata `/api/views/<id>.json` column `fieldName`s, ArcGIS `<layer>?f=json` `fields`, CKAN `datastore_search` with `limit=1` plus the publisher's data dictionary), and with native queries that returned rows. New metadata files are under `fixtures/opendata/metadata/*_contacts.json`; `provenance.json` indexes their field names under each jurisdiction's `contacts` key, and the test suite checks every configured contacts column against them.

### Mechanisms

- `companyFields`: a company search also matches the listed mapped fields (default: `contractorName` only). This is used only where the publisher's sole company/person column is an applicant-type field. The value is published as `applicantName`, never relabelled as a contractor.
- `contacts`: a sibling dataset from the same publisher on the same host, keyed by permit number (or Harris County's project-number prefix). Company/name searches query the contacts first (company columns for both search types; person-name columns for name searches; optional role filter), then fetch the main permits by key in chunks of 100 (Socrata) or 40 (ArcGIS), with `IN (...)` or `LIKE '<key>-%'`. The matched names fill `contractorName` (plus `contractorLicense`) or `applicantName`. Raw rows are the untouched main-dataset rows. Address, permit, keyword, license and recent queries are unchanged and use only the main dataset. A server-side Socrata JOIN works on data.sf.gov but data.lacity.org answers `"joins are not supported"`, so the adapter uses the two-step lookup everywhere.
- `aliasUrls`: former endpoints of the same dataset after a publisher domain move, still accepted by `datasetFor`.

Cost: each contacts search costs one request per 1,000 contact rows plus one per key chunk, at ≥1 s per request. Very large builders are slow. For example, Harris County `DBANAME LIKE '%LENNAR HOMES%'` matches 48,912 projects (about 1,270 requests, more than 20 minutes). The aborted smoke run is not counted below.

### Per dataset

| Jurisdiction | Result | Fields |
|---|---|---|
| Los Angeles, CA | **Added contacts.** `pi9x-tg5x` publishes no name column; none of its siblings, `(N)` issued/submitted building, electrical or mechanical datasets, has one either (catalog search). The same publisher's **Building and Safety Certificate of Occupancy** (`3f9m-afei`, LADBS, rows updated 2026-10-12, max `cofo_issue_date` 2026-10-09) carries `contractors_business_name`, `license`, `principal_first_name`/`principal_last_name`, keyed by `pcis_permit` = `permit_nbr` (verified: `23047-10000-01366` exists in both). | key `pcis_permit`; company `contractors_business_name`; person `principal_first_name`+`principal_last_name`; license `license` → `contractorName`/`contractorLicense`. **Scope limit:** contractor names exist only for permits that reached a certificate of occupancy (mostly new buildings, ADUs, pools and major alterations), and only for those that are also in the 2020-present issued file. A miss is not proof that the contractor pulled no LA permits. Older LADBS permit dataset IDs probed (`yv23-pmwf`, `nbyu-2ha9`) return `authentication_required` and were not used. |
| San Francisco, CA | **Added contacts.** **Building Permits Contacts** (`3pee-9qhc`, rows updated 2026-10-14, 1,036,998 rows; roles: contractor 586,255, authorized agent-others, architect, engineer, lessee, payor, …), keyed by `permit_number`. The publisher moved from data.sfgov.org to **data.sf.gov** (301). The old redirector intermittently answered HTTP 428 with an empty body during chunked lookups, so both datasets now use data.sf.gov. The old URLs are kept in `aliasUrls`. | key `permit_number`; role `role` ∈ {contractor}; company `firm_name`; person `first_name`+`last_name`; license `license1` → `contractorName`/`contractorLicense`. Name searches match only contractor-role contacts, not architects/agents/applicants. |
| Harris County, TX | **Added contacts.** Layer 1 (Permits) has no name field. Layer 0 of the same `AiPermitsService` (**Projects**) publishes `DBANAME` and `PROJECTNUMBER`; permit numbers are `<PROJECTNUMBER>-<code>-<seq>` (verified: project `2610070060` → `2610070060-RESB-001`, `-RSW-001`, `-RDW-001`). `DBANAME` is the applicant's company (e.g. a septic consultant whose project names a different property owner), so it is published as **applicantName**, not as the contractor. `ePermits/FeatureServer/0` also has `PROPERTYOWNERNAME` but sits alongside phone/e-mail columns, so it was not added. | key `PROJECTNUMBER`, separator `-`; company `DBANAME` → `applicantName`. |
| San Diego, CA | **Mapped existing column.** `APPROVAL_PERMIT_HOLDER` was already in the configured layer (361,485 of 419,280 `PMT-%` rows populated; max issue date 2026-10-09). It names whoever holds the permit: contractors (e.g. "IRONCORE CONSTRUCTION", "New Day Solar") and also owners and organisations. | `applicantName: APPROVAL_PERMIT_HOLDER`; `companyFields: [applicantName]`. |
| San Antonio, TX | **Mapped existing column.** `PRIMARY CONTACT` is in the PERMITS ISSUED resource (data dictionary: "The primary contact on the application or permit record"; resource modified 2026-10-11). Values are people and/or companies (e.g. "COURTNEY CHAPPELL, LENNAR HOMES", "LENNAR HOMES"). | `applicantName: "PRIMARY CONTACT"`; `companyFields: [applicantName]`. |
| Fort Worth, TX | **No change.** The layer's fields are listed in `fixtures/opendata/metadata/Fort_Worth_TX.json`; `Owner_Full_Name` is already mapped for name searches. The only other name-like column is `B1_SPECIAL_TEXT`: no alias, no description, an Accela free-text application name. It mixes contractors ("SUNRUN INSTALLATION SERVICES INC", "DR Horton"), third-party inspectors ("Bureau Veritas - Tavolo Park - Integrity"), project names ("Orchard Farms") and code-compliance labels ("METRO CODE"). It is not a contractor field and was not mapped. The CFW ArcGIS org publishes no other permit/contractor service. Company search stays refused. | none |
| Los Angeles County, CA | **No change.** `EPIC-LA_Case_History_view` fields contain no contractor/applicant/owner name, and neither do the sibling county layers (`Rebuild_Permits_Issued`, `EPICLA_County_Recovery`, `LDU_Permit_VIEW`; Hub search for EPIC-LA). The only Hub result with contractor-style data is a third-party (shovelsai) extract, not an official source. | none |

### Houston and Dallas (not added)

- **Houston, TX:** data.houstontx.gov (CKAN, 9 permit results) has only aggregate monthly residential permit counts (`residential-building-permits`, modified 2026-05-01) and non-construction permits. The COH ArcGIS org (`cohgis_ago`) publishes sidewalk permits for 2020–2023 only. No current permit-level dataset with contractor or applicant names exists. Houston stays on the city-built adapter.
- **Dallas, TX:** the Socrata **Building Permits** dataset `e7gq-4sah` (has `contractor`) was last updated 2020-08-30. The DallasGIS layers `T_BU_Permits_FY2023_24` (`CONTRACTOR_NAME`; data last edited 2024-10-18) and `NewPermit_2008_2024` (no names; 2024-12-10) are not current. The only current official name-bearing permit data is **ROW Permits – Points** (`bw6g-a3ur`, `allcontractorsname`/`applicantcompanynamestored`, max `issuedate` 2026-09-18). It covers right-of-way permits only. A `DATASETS["Dallas, TX"]` entry would route Dallas's whole permit database (Accela DallasNow) to the open-data adapter through `registerJurisdictionAdapter`, so it was not added. Doing so needs an explicit decision to give right-of-way permits a separate database row.

### Live smoke searches (2026-10-14 local; adapter `search`, polite ≥1 s/host)

| Jurisdiction | Type | Value | Rows | ms | First record |
|---|---|---|---|---|---|
| Los Angeles, CA | company | POOL ICONS | 28 | 1,118 | 20047-10000-01102, 4420 N PORTOLA AVE, POOL ICONS INC (479446) |
| Los Angeles, CA | company | SHAPELL HOMES | 906 | 19,818 | 21010-20000-05182, 20114 W MARLOW LANE, SHAPELL HOMES INC |
| Los Angeles, CA | name | DONALD NARVAEZ | 30 | 1,997 | 20047-10000-01102 (principal of POOL ICONS INC) |
| San Francisco, CA | company | Terence Mcmahon Construction | 629 | 6,155 | 201601147100, 41 Mars St (license 797580) |
| San Francisco, CA | name | Andrew George Byrne | 629 | 6,936 | same contractor-role contact |
| Harris County, TX | company | G&B GROUP | 46 | 5,809 | 2208190147-RESB-001, 14254 Texarkana St. (applicant G&B GROUP LLC) |
| Harris County, TX | company | PS LIGHTWAVE | 511 | 25,503 | 1509140086-UGC-001, 4000 Peek Rd, Katy |
| San Diego, CA | company | IRONCORE CONSTRUCTION | 26 | 2,095 | PMT-3439414 |
| San Diego, CA | company | New Day Solar | 170 | 1,859 | PMT-3036958, 11724 Alderidge Ln |
| San Antonio, TX | company | LENNAR HOMES | 2,890 | 2,207 | RES-RBP-PMT25-36600004, 3734 ROCK MILL DAM |
| San Antonio, TX | name | COURTNEY CHAPPELL | 943 | 999 | TRE-AFF-PMT25-39002089 |

Row counts are source rows: SF returns one row per permit address, so 553 matched permit numbers gave 629 rows. San Francisco address and seven-day recent queries were re-run on data.sf.gov with `searchUrl` set to the new URL, the old data.sfgov.org alias and the OpenGov portal: 6 / 6 / 6 address rows and 213 recent rows. Validation: `npx tsc --noEmit -p .` passes, and `npx vitest run server/scrapers/opendata.test.ts server/scrapers/registry.test.ts` passes, with recorded contact and permit fixtures in `fixtures/opendata/*_contacts.json` and `*_contact_permits.json`.
