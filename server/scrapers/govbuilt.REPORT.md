# GovBuilt — 2026-10-10

## 1. Platform and mechanism

Handles HTTPS `https://<tenant>.govbuilt.com/` and deeper stored AdvancedForms URLs by deriving the host. No hardcoded municipality. Anonymous GET `/activitysearchtool` verifies that the public grid and requested filter exist. GET `/PublicReport/GetAllContentToolModels` uses `contentType=case`, `filter=Address|ReferenceNumber|Name`, `days=0`, one-based `Start`, `Length=100`, and `isHideClosedStatus=false`. The observed `days=0` request returned current October 2026 records despite the UI label “Beyond 12 months”; it removes the default 30-day cutoff.

JSON pages are validated and paged to the reported filtered total. Duplicated/truncated pages and unrecognized responses throw. HTTP errors and CAPTCHA pages throw; no failures become empty successes. The endpoint was discovered in the public browser network log and its shipped SearchTool.js.

Only case types explicitly containing the word “Permit” are normalized. Unclassified cases are logged and omitted; if all matches are unclassified, the adapter throws rather than claiming no results. Raw JSON rows remain unchanged. Dates labeled Created Date/Last Activity and names labeled only Name are not relabeled as issue dates or contractor identities.

When `showCaseDetailsReport=true`, sourceUrl points to `/PublicReport/GetAllCaseDetailsData/<contentItemId>`. Detail fetches that public report and verifies its reference number; parcel, subtype and description can be enriched. Raw detail contains the untouched search row and the full fetched HTML. Without a public report, detail returns the exact search row; sourceUrl remains null.

## 2. Capabilities

- Search: address, permit/reference number, generic name. No company, license, contractor or keyword search. Business Name on this portal searches licenses, not construction permits.
- listRecent: **false**. Returns [] without a portal request. Created Date and generic “My Permits & Processes Date” are not verified issued/applied dates. No brute-force fallback.
- Detail: **true**, exact permit number. Public report enrichment is tenant-dependent. Duplicate exact numbers throw as ambiguous.
- Unknown dates, contractor, applicant and owner identities remain null. The generic Name field is retained only in raw. Known public coordinates come from applicationLocation JSON.

## 3. Live tests

All calls were sequential within this run, with at least 1 second between request starts per host, an honest ConstructHUB User-Agent, no account and no database. Times below are measured wall-clock milliseconds. Recent window: 2026-10-03 through 2026-10-10 inclusive (seven-day lookback at calendar-date precision). Contractor/company/license searches are not supported and were not substituted with unrelated fields.

### Milan, IL

Stored URL: https://milanil.govbuilt.com/

**search address 1st** — 50; 2656 ms; started 2026-10-10T17:59:09.384Z.

Sample 1: {"permitNumber": "BP-2026-0119", "address": "205 1st Ave W, Milan, IL 61264", "status": "Permit Issued", "issuedAt": null, "contractorName": null}

Sample 2: {"permitNumber": "EP-2026-0030", "address": "616 31st Ave W, Milan, IL 61264", "status": "Completed", "issuedAt": null, "contractorName": null}

**search permit BP-2026-0119** — 1; 1095 ms; started 2026-10-10T17:59:12.041Z.

Sample 1: {"permitNumber": "BP-2026-0119", "address": "205 1st Ave W, Milan, IL 61264", "status": "Permit Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

**search name Jim McIntyre** — 1; 2132 ms; started 2026-10-10T17:59:13.137Z.

Sample 1: {"permitNumber": "BP-2026-0119", "address": "205 1st Ave W, Milan, IL 61264", "status": "Permit Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

**recent 2026-10-03** — 0; 0 ms; started 2026-10-10T17:59:15.269Z.

No samples: unsupported listing (no request sent).

Adapter log: GovBuilt exposes creation/activity dates, not a verified issued/applied date listing; alerts unsupported

**detail BP-2026-0119** — 1; 1865 ms; started 2026-10-10T17:59:15.270Z.

Sample 1: {"permitNumber": "BP-2026-0119", "address": "205 1st Ave W, Milan, IL 61264", "status": "Permit Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

### Westwood, KS

Stored URL: https://westwood.govbuilt.com/#page-top

**search address 2809 W 50th** — 2; 1448 ms; started 2026-10-10T17:59:17.135Z.

Sample 1: {"permitNumber": "2026-000313", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

Sample 2: {"permitNumber": "2026-000309", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

**search permit 2026-000313** — 1; 2134 ms; started 2026-10-10T17:59:18.585Z.

Sample 1: {"permitNumber": "2026-000313", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

**search name Nadella** — 6; 1969 ms; started 2026-10-10T17:59:20.721Z.

Sample 1: {"permitNumber": "2026-000313", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

Sample 2: {"permitNumber": "2026-000309", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

**recent 2026-10-03** — 0; 0 ms; started 2026-10-10T17:59:22.691Z.

No samples: unsupported listing (no request sent).

Adapter log: GovBuilt exposes creation/activity dates, not a verified issued/applied date listing; alerts unsupported

**detail 2026-000313** — 1; 1885 ms; started 2026-10-10T17:59:22.691Z.

Sample 1: {"permitNumber": "2026-000313", "address": "2809 W 50th Terrace, Westwood, KS 66205, USA", "status": "Submitted", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

### Clear Creek County, CO

Stored URL: https://clearcreekcounty.govbuilt.com/

**search address 701 Beaver** — 1; 1699 ms; started 2026-10-10T17:59:24.577Z.

Sample 1: {"permitNumber": "MEC-26-077", "address": "701 Beaver Brook Canyon Rd, Evergreen, CO 80439", "status": "Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

Adapter log: GovBuilt omitted 3 cases not explicitly labeled as permits

**search permit MEC-26-077** — 1; 2243 ms; started 2026-10-10T17:59:26.277Z.

Sample 1: {"permitNumber": "MEC-26-077", "address": "701 Beaver Brook Canyon Rd, Evergreen, CO 80439", "status": "Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

**search name FOREST GLEN** — 1; 1827 ms; started 2026-10-10T17:59:28.520Z.

Sample 1: {"permitNumber": "MEC-26-077", "address": "701 Beaver Brook Canyon Rd, Evergreen, CO 80439", "status": "Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

**recent 2026-10-03** — 0; 0 ms; started 2026-10-10T17:59:30.347Z.

No samples: unsupported listing (no request sent).

Adapter log: GovBuilt exposes creation/activity dates, not a verified issued/applied date listing; alerts unsupported

**detail MEC-26-077** — 1; 2801 ms; started 2026-10-10T17:59:30.348Z.

Sample 1: {"permitNumber": "MEC-26-077", "address": "701 Beaver Brook Canyon Rd, Evergreen, CO 80439", "status": "Issued", "issuedAt": null, "contractorName": null}

Only 1 record returned; no second sample exists.

### Sunset Valley, TX

Stored URL: https://sunsetvalleytx.govbuilt.com/

**search address 100 Main St** — failed (no count); 1251 ms; started 2026-10-10T17:59:33.149Z.

Error: PortalBlockedError; HTTP status 404; HTTP 404 for https://sunsetvalleytx.govbuilt.com/activitysearchtool.

No records returned: request failed or search field unavailable; this is not a zero-result search.

## 4. Blocked and failed tenants

Sunset Valley, TX: stored homepage returned HTTP 200 with application forms, but the public search page returned HTTP 404. The adapter reports that failure. It did not search hidden/private data or submit an application. No GovBuilt CAPTCHA or HTTP 401/403/429 was encountered in the successful three tenants.

## 5. Coverage

22 of 22 GovBuilt targets have the handled host shape, representing 22 of 418 assignment entries. 3 tenants passed live searches; 1 tenant failed public-page availability; 18 were not live-tested. URL shape coverage is not proof of tenant search availability. All distinct GovBuilt labels are registered:

- GovBuilt
- GovBuilt online permit portal
- GovBuilt permitting platform
- GovBuilt (PDS of Kenton County)
- GovBuilt permitting portal
- GovBuilt online services portal

Sunset Valley is a known application-only landing in this sample. Its adapter search throws. In Clear Creek County, address “701 Beaver” matched 4 public cases, but only 1 was explicitly labeled as a permit; 3 were logged as unclassified and excluded. Labels such as Re-Roof or Power may describe additional permits, but are not automatically asserted to be permits by this conservative first implementation. The other case data is not fabricated or relabeled.

## 6. Known gaps and follow-up

GovBuilt alerts are not enabled. Establish true issued/applied date semantics before changing listRecent. Verify tenant-specific construction case classifications and public contractor roles to extend coverage beyond explicit Permit types. The public report's generic date is deliberately not mapped. Detail reports currently enrich only parcel, subtype, description and status; contractor sections were not available in the recorded report. Queries exceeding 100 pages (10,000 rows) throw rather than truncate.

Fixtures are genuine fetched responses; see fixtures/govbuilt/README.md and live-provenance.json. One public hidden token value is removed from the HTML fixture. Tests include normalization, tenant derivation, pagination guards, genuine report parsing, failure propagation and HTTP-200 CAPTCHA handling. Full repository TypeScript check passed.

Final HTTP-helper smoke check: Milan, IL, permit query `ConstructHUB-no-such-permit-20261010`, 0 genuine results in 1 seconds (live harness). Its raw empty response is recorded for offline tests.

Final validation: 26 tests passed across the 2 adapter test files using `npx vitest run server/scrapers/govbuilt.test.ts server/scrapers/citysquared.test.ts --configLoader runner`; `npx tsc --noEmit -p .` exited 0. The runner flag is required here because node_modules/.vite-temp is read-only. Registry aliases were checked offline with storage mocked.
