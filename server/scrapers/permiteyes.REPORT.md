# PermitEyes adapter report — 2026-10-10

## 1. Platform & mechanism

Anonymous HTTP, no browser or login. The supported layout is `https://permiteyes.us/<tenant>/*.php` (also a single subdomain of permiteyes.us). The adapter derives the tenant directory from ctx.searchUrl and opens its publicview.php. It reads the live table headings and advertised AJAX route, rather than assuming common column positions. Bellingham has 13 columns, Ludlow 14, and Fairhaven 10. Bellingham/Ludlow advertise ajax/getbuildingpublichome.php; Fairhaven advertises ajax/getpublichome.php. These are read-only POST requests using the public DataTables search parameters, with 100 rows per page and complete pagination. Native field searches preserve the portal's partial-match semantics.

politeFetch supplies the ConstructHUB identity and at least 1000 ms per-host delay. Redirects are inspected without automatically fetching login pages. HTTP failures, authentication, challenges, schema changes, incomplete pagination, and repeated pages throw errors. No authentication, CAPTCHA solving, form creation, database access, or application server was used.

## 2. Capabilities

- Search: address, permit number, applicant name. Name is the portal's applicant field, not a claim that the applicant is a contractor.
- listRecent: yes, through the public Issue Date column's native YYYY-MM-DD | YYYY-MM-DD range. Date granularity, inclusive calendar dates; no brute-force enumeration. Application-date listing is not exposed by this adapter.
- Detail: no. A fetched public electrical application view exists, but loading all its dynamic field data and supporting the vendor's many form-specific layouts is not implemented. Record sourceUrl follows the public view link metadata from the original row.
- Contractor/company/license search: no verified dedicated filter. contractorName and contractorLicense remain null. Missing description, owner, valuation, and dates remain null.
- Applications with no permit number are omitted; their application IDs are never relabeled as permit numbers. This adapter currently reads the building table, including its building/electrical/gas/plumbing permit types, not separate health/fire/other department tabs.

## 3. Live tests

Three real tenants from targets.json were tested by address, exact permit number, applicant name, and the last-seven-day date window. These are direct calls to the exported adapter with the same context as live-harness; response bodies were recorded unchanged. Initial Bellingham address/permit checks also used live-harness.ts. Counts below are numbered permit records; sample fields are exact normalized source values. Company/license requests are unsupported and were not sent. All dates/times below are UTC; portal dates are normalized calendar dates.

### Bellingham, MA

Stored URL: https://permiteyes.us/bellingham/publicview.php

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 33 numbered permit records. 2026-10-10T17:52:24.149Z; 1.294 seconds.

  Sample: {"permitNumber": "E-26-0497", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "E-26-0501", "address": "81 blackstone st", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}

- search address = 41 cross st: 3 numbered permit records. 2026-10-10T17:52:48.886Z; 1.244 seconds.

  Sample: {"permitNumber": "E-26-0497", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "R-26-0304", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-05-21", "contractorName": null}

- search permit = E-26-0497: 1 numbered permit records. 2026-10-10T17:55:07.987Z; 1.224 seconds.

  Sample: {"permitNumber": "E-26-0497", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Only one record returned; no second sample exists.

- search name = benjamin mahar: 39 numbered permit records. 2026-10-10T17:52:52.114Z; 1.283 seconds.

  Sample: {"permitNumber": "E-26-0497", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "E-26-0500", "address": "86 laurel ln", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}

- search permit = ConstructHUB-no-such-permit-20261010: 0 numbered permit records. 2026-10-10T17:54:18.135Z; 1.221 seconds.
  No sample records: the verified search returned zero numbered permits.
- listRecent since 2026-09-12 through 2026-10-10 (issue date): 195 numbered permit records. 2026-10-10T17:57:32.521Z; 2.271 seconds.

  Sample: {"permitNumber": "E-26-0497", "address": "41 cross st", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "E-26-0501", "address": "81 blackstone st", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}


### Ludlow, MA

Stored URL: https://permiteyes.us/ludlow/loginuser.php

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 85 numbered permit records. 2026-10-10T17:52:25.732Z; 1.243 seconds.

  Sample: {"permitNumber": "W-26-0741", "address": "159 west avenue", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "E-26-0423", "address": "198 sewall street", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}

- search address = 159 west avenue: 5 numbered permit records. 2026-10-10T17:52:53.601Z; 1.146 seconds.

  Sample: {"permitNumber": "W-26-0741", "address": "159 west avenue", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "G-2024-0100", "address": "159 west avenue", "status": "Closed", "issuedAt": "2024-07-29", "contractorName": null}

- search permit = W-26-0741: 1 numbered permit records. 2026-10-10T17:52:55.071Z; 1.141 seconds.

  Sample: {"permitNumber": "W-26-0741", "address": "159 west avenue", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Only one record returned; no second sample exists.

- search name = squier lumber: 20 numbered permit records. 2026-10-10T17:52:56.574Z; 1.170 seconds.

  Sample: {"permitNumber": "W-26-0741", "address": "159 west avenue", "status": "Permit Issued", "issuedAt": "2026-10-08", "contractorName": null}
  Sample: {"permitNumber": "R-2022-0609", "address": "27 chapin circle", "status": "Completed", "issuedAt": "2022-10-21", "contractorName": null}


### Fairhaven, MA

Stored URL: https://permiteyes.us/fairhaven/loginuser.php

- listRecent since 2026-10-03 through 2026-10-10 (issue date): 38 numbered permit records. 2026-10-10T17:52:27.369Z; 1.295 seconds.

  Sample: {"permitNumber": "E-26-0388", "address": "33 dartmouth street", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}
  Sample: {"permitNumber": "E-26-0387", "address": "10 howland road", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}

- search address = 33 dartmouth street: 2 numbered permit records. 2026-10-10T17:52:58.157Z; 1.243 seconds.

  Sample: {"permitNumber": "E-26-0388", "address": "33 dartmouth street", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}
  Sample: {"permitNumber": "R-26-0649", "address": "33 dartmouth street", "status": "Permit Issued", "issuedAt": "2026-09-14", "contractorName": null}

- search permit = E-26-0388: 1 numbered permit records. 2026-10-10T17:52:59.721Z; 1.229 seconds.

  Sample: {"permitNumber": "E-26-0388", "address": "33 dartmouth street", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}
  Only one record returned; no second sample exists.

- search name = eav solutions: 5 numbered permit records. 2026-10-10T17:53:01.293Z; 1.240 seconds.

  Sample: {"permitNumber": "E-26-0388", "address": "33 dartmouth street", "status": "Permit Issued", "issuedAt": "2026-10-09", "contractorName": null}
  Sample: {"permitNumber": "E-26-0312", "address": "20 rogers street", "status": "Complete", "issuedAt": "2026-08-18", "contractorName": null}


The longer Bellingham listing since 2026-09-12 returned 195 permits across two native result pages (100 + 95). This is date-filtered pagination, not an unfiltered crawl.

## 4. Blocked / failed tenants

No HTTP or authentication failure occurred in the three tested public lookups. Ludlow's stored loginuser.php is a login/application page (recorded as ludlow-login.html); its anonymous sibling publicview.php returned permits without login. Fairhaven likewise has a working anonymous sibling of the stored login URL. The stored login URL alone is not evidence that a tenant has no public lookup.

The legacy .net/.com ASP layouts and shared Berkshire pages listed below are deliberately rejected before network access. They are unimplemented, not proven login-only or dead.

## 5. Coverage

47 of 52 PermitEyes-labeled target entries have the supported single-tenant PHP URL shape. Only the 3 tenants above are live-validated; 47 is a URL-shape count, not a claim that all 47 portals are publicly accessible. The combined assignment has 136 entries.

Registered labels: PermitEyes; PermitEyes (Building Division); PermitEyes (Online Building Permit Applications).

Excluded entries:

- Lee, MA — https://permiteyes.us/berkshire/leepublicview.php
- Lenox, MA — https://permiteyes.us/berkshire/lenoxpublicview.php
- Adams, MA — https://permiteyes.us/berkshire/loginuser.php
- Maynard, MA — https://permiteyes.net/maynard/building/loginpages.asp
- Dalton, MA — https://permiteyes.com/Berkshire/user_logins.asp

The 3 Berkshire entries need verified municipality scoping within a shared regional database. The 2 ASP entries need separate layout discovery. Rejecting them avoids attributing another municipality's records to the requested jurisdiction.

## 6. Known gaps and follow-up

Validate the remaining 44 candidate target entries individually. Discover the Berkshire municipality filter and legacy ASP lookup before expanding their coverage. Add contractor/license data only from verified public detail fields, and preserve the distinction between applicant and contractor. Add other department tabs with their own schemas. The two-digit dates use a 1970/2069 pivot; dates that cannot be validated become null. The current live sample years are unambiguous modern dates. Concurrent portal edits can change a paginated snapshot; the adapter detects repeated or empty premature pages and has a 100,000-row guard.

Validation: 28 offline tests across both vendor files passed using `npx vitest run --configLoader runner --cache=false server/scrapers/permiteyes.test.ts server/scrapers/sdl-portal.test.ts`. The prescribed default Vitest invocation could not start because the shared node_modules/.vite-temp is read-only (EROFS); the runner uses the same repository config and test files without writing that cache. `npx tsc --noEmit -p .` passes. No DB/server was started.

Fixture provenance: fixtures/permiteyes/provenance.json includes exact adapter request URLs, POST bodies, HTTP status, capture times, and SHA-256 hashes. The initial survey fixtures are GETs of the tenant publicview.php pages and Ludlow loginuser.php; bellingham-main.json is a real 20-row POST response from ajax/getbuildingpublichome.php with columns[6][search][value]=Main, start=0, length=20, and order column 3 descending. sample-detail.html was fetched from the first Bellingham recent record's sourceUrl. Fixtures contain whole response bodies, with no invented records.
