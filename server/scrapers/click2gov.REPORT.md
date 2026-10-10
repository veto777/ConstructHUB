Click2Gov adapter report — live verification 2026-10-10 UTC

1. Platform & mechanism

Public HTTP session on /Click2GovBP/index.html or selectpermit.html. Derives the host and application directory from ctx.searchUrl, removes stale stored CSRF tokens, follows the advertised Select Permit/Search For Permits link, and posts exactly one of the public forms (#is0, #is1, #is3) with its current CSRF token. The tested DataTables layouts include the complete result set in the HTML response, so all rows are parsed without browser pagination. Duplicate permit rows retain additional raw rows. Status details are extracted from exact labels. Public record URLs encode the application number; a clean no-cookie/no-CSRF-token Tamarac detail URL was independently fetched successfully (HTTP 200). Authentication-free on Tamarac and Pompano Beach. No storage-backed code or browser.

All requests use politeFetch with the ConstructHUB User-Agent/contact URL and at least 1000 ms per host (or the larger ctx delay). HTTP blocking is propagated; challenges are not bypassed. HTML errors and unrecognized result pages throw. The four registry wrappers were replaced; Skagit County and the other legacy lines were left alone.

2. Capabilities

Search: address, permit, name and company. Name and company both use the portal Name search; its results can include owners and other associated names. The Contractor/Other Name column is ambiguous and is not falsely labeled contractorName or applicantName. Permit search uses the portal YY-NUMBER fields; displayed detail numbers are normalized to the eight-digit application-number form used by result links. detail: yes, exact permit only. listRecent: false, returns [] without a request. Neither of the two accessible tenants exposes a date search in the supported public forms. The [] for recent is unsupported functionality, not evidence of zero recently issued permits.

3. Live tests

Counts below are complete normalized permit counts, not fabricated examples. Null means the portal response did not establish that field. Times are UTC start time and elapsed wall seconds. Date queries used since=2026-10-03. A test returning one record has only one sample; a zero-result/error test has no sample.

Tenant: Tamarac, FL

URL: https://e-gov.tamarac.org/Click2GovBP/index.html

- address "7800 University": 77 records (2026-10-10T17:50:54.312Z; 2.340 seconds).

```json
[
  {
    "permitNumber": "00-00002397",
    "address": "7800 N UNIVERSITY DR",
    "status": "CANCELLED",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "04-00001727",
    "address": "7800 N UNIVERSITY DR",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- permit "00-00002397": 1 records (2026-10-10T17:50:56.676Z; 2.729 seconds).

```json
[
  {
    "permitNumber": "00-00002397",
    "address": "7800 N UNIVERSITY DR",
    "status": "CANCELLED",
    "issuedAt": null,
    "contractorName": "KING KOTE ASPHALT"
  }
]
```

- company "KING KOTE": 13 records (2026-10-10T17:50:59.406Z; 3.075 seconds).

```json
[
  {
    "permitNumber": "00-00000416",
    "address": "8321 SANDS POINT BLVD",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "00-00001971",
    "address": "6615 WESTWOOD BLVD",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:51:02.482Z; 0.000 seconds).

- detail "00-00002397": 1 records (2026-10-10T17:56:15.580Z; 2.129 seconds).

```json
[
  {
    "permitNumber": "00-00002397",
    "address": "7800 N UNIVERSITY DR",
    "status": "CANCELLED",
    "issuedAt": null,
    "contractorName": "KING KOTE ASPHALT"
  }
]
```

- empty "ZZZCONSTRUCTHUB": FAILED, count unknown (2026-10-10T17:56:46.751Z; 2.129 seconds). Unrecognized Click2Gov results or validation failure

- address "ZZZCONSTRUCTHUB": 0 records (2026-10-10T17:59:50.816Z; 2.129 seconds).

Tenant: Pompano Beach, FL

URL: https://c2g.pompanobeachfl.gov/Click2GovBP/selectpermit.html

- address "100 Atlantic": 408 records (2026-10-10T17:54:12.268Z; 1.686 seconds).

```json
[
  {
    "permitNumber": "99-00007758",
    "address": "100 W ATLANTIC BL",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "99-00007279",
    "address": "100 W ATLANTIC BL",
    "status": "APPROVED",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- permit "99-00007758": 1 records (2026-10-10T17:54:13.955Z; 1.373 seconds).

```json
[
  {
    "permitNumber": "99-00007758",
    "address": "100 W ATLANTIC BL HALL",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": "ALL AROUND WELDING INC"
  }
]
```

- company "Construction": 899 records (2026-10-10T17:54:15.328Z; 2.669 seconds).

```json
[
  {
    "permitNumber": "99-00007807",
    "address": "1133 W CYPRESS DR",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": null
  },
  {
    "permitNumber": "99-00007789",
    "address": "671 SW 5 CC",
    "status": "CERTIFICATE ISSUED",
    "issuedAt": null,
    "contractorName": null
  }
]
```

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:54:17.998Z; 0.000 seconds).

- detail "99-00007758": 1 records (2026-10-10T17:58:36.577Z; 1.066 seconds).

```json
[
  {
    "permitNumber": "99-00007758",
    "address": "100 W ATLANTIC BL HALL",
    "status": "CLOSED",
    "issuedAt": null,
    "contractorName": "ALL AROUND WELDING INC"
  }
]
```

Tenant: Seminole County, FL

URL: https://semc-egov.aspgov.com/Click2GovBP/index.html

- address "1101 First": FAILED, count unknown (2026-10-10T17:52:33.375Z; 0.245 seconds). Click2Gov public permit search unavailable

- permit: not attempted — No real permit number from prior query.

- company "Construction": FAILED, count unknown (2026-10-10T17:52:33.620Z; 0.990 seconds). Click2Gov public permit search unavailable

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:52:34.611Z; 0.000 seconds).

Tenant: Davis, CA

URL: https://davi-egov.aspgov.com/Click2GovBP/index.html?OWASP_CSRFTOKEN=WOV4-GQTS-2Y1G-Q2DJ-SLGO-CIWZ-CCQI-3BKY

- address "Russell": FAILED, count unknown (2026-10-10T17:52:51.832Z; 0.249 seconds). Click2Gov public permit search unavailable

- permit: not attempted — No real permit number from prior query.

- company "Construction": FAILED, count unknown (2026-10-10T17:52:52.081Z; 0.969 seconds). Click2Gov public permit search unavailable

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:52:53.051Z; 0.000 seconds).

Tenant: Laredo, TX

URL: https://lare-egov.aspgov.com/Click2GovBP/index.html

- address "Houston": FAILED, count unknown (2026-10-10T17:54:24.101Z; 0.253 seconds). Portal error at https://lare-egov.aspgov.com/Click2GovBP/index.html

- permit: not attempted — No real permit number from prior query.

- company "Construction": FAILED, count unknown (2026-10-10T17:54:24.354Z; 0.969 seconds). Portal error at https://lare-egov.aspgov.com/Click2GovBP/index.html

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:54:25.323Z; 0.000 seconds).

Tenant: Saint Petersburg, FL

URL: https://stpe-egov.aspgov.com/Click2GovBP/index.html

- address "Central": FAILED, count unknown (2026-10-10T17:55:23.530Z; 0.240 seconds). Portal error at https://stpe-egov.aspgov.com/Click2GovBP/index.html

- permit: not attempted — No real permit number from prior query.

- company "Construction": FAILED, count unknown (2026-10-10T17:55:23.771Z; 0.991 seconds). Portal error at https://stpe-egov.aspgov.com/Click2GovBP/index.html

- recent "2026-10-03": 0 records (unsupported; no HTTP request) (2026-10-10T17:55:24.762Z; 0.000 seconds).

4. Blocked / failed tenants

Seminole County (semc-egov.aspgov.com), Davis (davi-egov.aspgov.com), Laredo (lare-egov.aspgov.com), and Saint Petersburg (stpe-egov.aspgov.com) returned HTTP 200 pages titled Error Occurred, with a CentralSquare contact instruction and support ID. The pages did not expose a search form. This is an application/gateway error of undetermined cause; there is no evidence to label it Cloudflare or a CAPTCHA. Only ordinary public GET/search initialization was tried. No workaround or authentication was attempted. Earlier parser messages called these unavailable public forms; final error detection recognizes their error text and throws.

5. Coverage

13 / 13 Click2Gov targets have the supported /Click2GovBP URL shape, or 13 / 285 of the full target file. All distinct Click2Gov labels are registered. Other Click2Gov modules are rejected. Six target tenants were tested; two produced permits and four returned error pages. Do not interpret URL-shape coverage as live access to all 13.

Registered platform labels (case-insensitive lookup):

`CentralSquare Click2Gov`, `CentralSquare Click2Gov Building Permits`, `Click2Gov`, `Click2Gov Building Permit`, `Click2Gov Building Permits`, `Click2Gov Building Permits (C.O.A.S.T)`, `Click2Gov Building Permits (ePermits)`.

6. Known gaps and follow-up

No date-search implementation for any alternate tenant layout; keep listRecent=false until a real date-enabled form is recorded and verified. Server-side DataTables pagination explicitly throws rather than silently returning the first page. The supported common layouts return all rows in HTML. Broad name searches can have many duplicate permit/contact rows. Contact-role enrichment, contractor license search and alternate application-number formats need additional verified fixtures. Address input is split into an optional street number plus street text; directional/suffix parsing is not guessed.

Validation: all four adapter suites pass offline, 30 tests total, using real recorded responses. Command: `npx vitest run --configLoader runner server/scrapers/smartgov.test.ts server/scrapers/etrakit.test.ts server/scrapers/click2gov.test.ts server/scrapers/ftg.test.ts`. The default Vitest config bundler fails with EROFS because node_modules/.vite-temp is read-only in this environment; runner avoids that write and uses the existing repository config. `npx tsc --noEmit -p .` passes. Tests do not make network requests. No app server or database was started.
