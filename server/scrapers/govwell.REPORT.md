# GovWell adapter report — 2026-10-10

1. Platform and mechanism

Auth-free public GraphQL, discovered from Chromium's network log on the Macon County portal and its Public Dashboards link. No account, login, CAPTCHA solving, or permit application submission was used.

Handled URLs: `http(s)://app.govwell.com/<slug>` and `http(s)://app.govwelltech.com/<slug>`, including deeper application paths such as `/fairview/125/pick`. The first path segment supplies the tenant. The old govwelltech host is canonicalized to app.govwell.com: a real HEAD request to `https://app.govwelltech.com/black-mountain` returned HTTP 301 with `Location: https://app.govwell.com/black-mountain`.

Endpoint: `POST https://app.govwell.com/api/graphql`. Public operations observed in the browser were `GetPublishedDashboardsByOrganizationQuery` and `GetViewsDataForViewDashboardQuery`. The adapter requests their smaller, read-only selections: `organizationBySlug(slug).publishedViewDashboards` supplies view IDs, columns and saved filters; `getViewsDataForViewDashboard(dashboardId, inputs)` supplies `totalCount` and `rows`. It sends `searchQuery`, `limit: 50`, `offset`, and public filters. It retains saved filters, uses an unfiltered view when available, otherwise unions the published filtered views, and deduplicates record URLs. It throws instead of returning partial data if pagination repeats, is incomplete, or exceeds 10,000 rows per view.

Record URLs use the observed public route `/<slug>/public-record/<uuid>`. The untouched response row is stored in `raw`. Unknown fields remain null. The API's `isContact` flag is NOT treated as evidence that a record is not a permit: Cape Elizabeth returns it as true on real building and electrical permits. Drafts, test records, and violation-module records are excluded. No database access is used.

2. Capabilities

Search: address, permit, company, name, keyword. The server performs text search; typed searches then match the appropriate published fields. Company matches explicitly exposed contractors or applicant-company columns; an applicant company is not relabeled as a contractor. Name matches exposed applicant, property-owner, or contractor names. Keyword preserves the public search engine's matches. License search is not advertised because it was not verified.

listRecent: yes, with two actual server date filters, `RecordIssuedDate` and `RecordSubmittedDate`, combined as a union. Each uses `date: { type: "Exact", exactStart: "YYYY-MM-DD" }`. There is no brute-force text search. Timestamp precision is applied again when the timestamp is published. When an issue timestamp is hidden, the server's calendar-date filter is the available precision and `issuedAt` remains null. `appliedAt` uses `submittedAt`, never the system record-creation timestamp. The hourly poller must still handle an explicit error for a tenant that publishes no dashboards.

Detail: yes, exact permit-number lookup in public dashboards, returning the normalized public row and its public record URL. This does not promise additional form fields beyond the public dashboard. Ambiguous numbers across different public records throw.

3. Live tests

All tests below used the real targets.json entries on 2026-10-10. Counts are normalized records, not guessed totals. The seven-day runs share cutoff `2026-10-03T18:02:32Z`, calculated exactly seven days before those runs began. Separate earlier calendar-date runs from 2026-10-03T00:00:00Z also returned Macon 94, Raynham 34, Cape Elizabeth 34. The Macon date fixtures contain 60 issued rows and 76 submitted rows, with 42 overlapping records, yielding 94 unique records. All successful API calls were HTTP 200.

Macon County, NC

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address 120 LAURELWOOD | 7 | 1 | 2026-10-10 17:52:22 |
| search permit R-ADD-26-0085 | 1 | 1 | 2026-10-10 17:49:58 |
| search company Bumgarner Electric | 8 | 4 | 2026-10-10 17:53:38 |
| recent 2026-10-03T18:02:32Z | 94 | 5 | 2026-10-10 18:02:37 |
| detail R-ADD-26-0085 | 1 | 1 | 2026-10-10 17:59:05 |
| search name Vance Bailey | 2 | 1 | 2026-10-10 17:59:07 |
| search keyword Bumgarner Electric | 131 | 3 | 2026-10-10 18:01:29 |
| search permit CONSTRUCTHUB-NO-MATCH-20261010 | 0 | 1 | 2026-10-10 18:01:25 |

URL exactly as stored: https://app.govwell.com/macon-county-nc

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address 120 LAURELWOOD | R-ADD-26-0085 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Submitted | null | null |
| search address 120 LAURELWOOD | MC-19-001906 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Complete | 2019-12-12T05:00:00.000Z | null |
| search permit R-ADD-26-0085 | R-ADD-26-0085 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Submitted | null | null |
| search company Bumgarner Electric | ELC-26-0196 | 240 PITTS RD, FRANKLIN, NC 28734 | Complete | 2026-10-05T17:12:03.170Z | Bumgarner Electric Company |
| search company Bumgarner Electric | ELC-26-0151 | 478 GREGORY RD, FRANKLIN, NC 28734 | Issued | 2026-09-01T12:27:05.415Z | Bumgarner Electric Company |
| recent 2026-10-03T18:02:32Z | ELC-26-0199 | 1468 LAKESIDE DR, FRANKLIN, NC 28734 | Issued | 2026-10-09T15:34:14.570Z | Bumgarner Electric Company |
| recent 2026-10-03T18:02:32Z | MEC-26-0306 | 250 MOUNTAIN GROVE RD, FRANKLIN, NC 28734 | Issued | 2026-10-09T16:14:18.803Z | All Service Heating and Air Conditioning |
| detail R-ADD-26-0085 | R-ADD-26-0085 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Submitted | null | null |
| search name Vance Bailey | R-ADD-26-0085 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Submitted | null | null |
| search name Vance Bailey | BR-24-002120 | 120 LAURELWOOD DR, HIGHLANDS, NC 28741 | Expired | 2024-10-09T04:00:00.000Z | null |
| search keyword Bumgarner Electric | ELC-26-0196 | 240 PITTS RD, FRANKLIN, NC 28734 | Complete | 2026-10-05T17:12:03.170Z | Bumgarner Electric Company |
| search keyword Bumgarner Electric | ELC-26-0151 | 478 GREGORY RD, FRANKLIN, NC 28734 | Issued | 2026-09-01T12:27:05.415Z | Bumgarner Electric Company |

Raynham, MA

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address MAIN | 393 | 10 | 2026-10-10 17:53:49 |
| search permit ELC-26-0146 | 1 | 1 | 2026-10-10 17:54:12 |
| search company Southern New England Windows | 4 | 2 | 2026-10-10 17:58:48 |
| recent 2026-10-03T18:02:32Z | 34 | 2 | 2026-10-10 18:02:40 |

URL exactly as stored: https://app.govwell.com/raynham-ma

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address MAIN | ELC-26-0146 | 1134 NORTH MAIN STREET, RAYNHAM, MA 02767 | In Progress | null | null |
| search address MAIN | R-ROOF-26-0073 | 865 NORTH MAIN STREET, RAYNHAM, MA 02767 | Issued | null | null |
| search permit ELC-26-0146 | ELC-26-0146 | 1134 NORTH MAIN STREET, RAYNHAM, MA 02767 | In Progress | null | null |
| search company Southern New England Windows | R-ROOF-26-0079 | 4 WARD STREET, RAYNHAM, MA 02767 | Issued | null | null |
| search company Southern New England Windows | R-ROOF-26-0078 | 59 CHICKERING ROAD, RAYNHAM, MA 02767 | Issued | null | null |
| recent 2026-10-03T18:02:32Z | ELC-26-0147 | 151 HICKORY DRIVE, RAYNHAM, MA 02767 | Issued | null | null |
| recent 2026-10-03T18:02:32Z | R-ROOF-26-0084 | 50 SOUTH STREET WEST, RAYNHAM, MA 02767 | Issued | null | null |

Cape Elizabeth, ME

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address 21 KETTLE COVE ROAD | 7 | 11 | 2026-10-10 17:57:26 |
| search permit BLD-26-0205 | 1 | 11 | 2026-10-10 17:57:38 |
| search company LAPLANTE ELECTRIC | 19 | 15 | 2026-10-10 17:59:04 |
| recent 2026-10-03T18:02:32Z | 34 | 22 | 2026-10-10 18:03:03 |

URL exactly as stored: https://app.govwell.com/cape-elizabeth

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address 21 KETTLE COVE ROAD | BLD-26-0205 | 21 KETTLE COVE ROAD | Issued | 2026-10-09T14:19:20.534Z | null |
| search address 21 KETTLE COVE ROAD | 98-1424 | 21 KETTLE COVE ROAD, Cape Elizabeth 04107, Maine | Completed | null | null |
| search permit BLD-26-0205 | BLD-26-0205 | 21 KETTLE COVE ROAD | Issued | 2026-10-09T14:19:20.534Z | null |
| search company LAPLANTE ELECTRIC | ELEC-26-0280 | 28 VERNON ROAD | Paid | null | null |
| search company LAPLANTE ELECTRIC | ELEC-26-0275 | 120 OLD OCEAN HOUSE ROAD | Issued | 2026-10-06T11:37:19.816Z | null |
| recent 2026-10-03T18:02:32Z | BLD-26-0205 | 21 KETTLE COVE ROAD | Issued | 2026-10-09T14:19:20.534Z | null |
| recent 2026-10-03T18:02:32Z | ELEC-26-0279 | 8 OTTAWA ROAD | Issued | 2026-10-09T16:56:43.812Z | null |

4. Blocked or failed tenants

- Belle Glade, FL: stored URL `http://app.govwell.com/belle-glade-fl`. Unauthenticated GraphQL HTTP 200 returned an empty `publishedViewDashboards` array. A live harness address search for `100 Main St` threw `GovWell tenant has no published public record dashboards`; it did not return zero results. No records or samples are claimed.
- Rye Brook, NY: `https://app.govwell.com/rye-brook-ny`. Metadata probe HTTP 200, empty published dashboards. No record search or date listing was available through this mechanism; not called a successful zero-result search.
- Black Mountain, NC: `https://app.govwelltech.com/black-mountain`. Old host HTTP 301 to canonical portal; canonical GraphQL HTTP 200, empty published dashboards.
- Hutto, TX: metadata HTTP 200 published three dashboards (`ENG-PERMIT`, `Issued Building Permits`, `Residential New Building Permits`). Record search was not live-tested there. This is discovery evidence, not claimed successful record coverage.
- No live 401, 403, 429, login wall, or CAPTCHA was encountered on the three working tenants. HTTP failures and GraphQL authorization failures throw; partial GraphQL responses with errors are not accepted.

An initial Cape Elizabeth implementation rejected filtered-only views and then incorrectly excluded permits whose module had `isContact: true`. Those implementation failures were fixed; the final successful counts above supersede those attempts, and a real Cape response now guards this regression. An early Raynham company attempt also exposed string-valued company columns; these are now handled and the final company test above passes.

5. Coverage

The assignment contains 119 entries: 67 GovWell and 52 PermitLink. GovWell URL-shape support is 66 / 67 GovWell entries (66 / 119 overall), consisting of 62 app.govwell.com entries and 4 app.govwelltech.com entries. This is URL compatibility, not a claim that all 66 publish records. Full search/date tests succeeded on 3 tenants; 3 other inspected tenants publish no dashboards; Hutto was metadata-only. The remaining tenants were not live-tested. Butte and Silver Bow County share the same tenant.

Registered platform: `GovWell`. Registered aliases, preserving all supported target labels:
- `GovWell permit portal`
- `GovWell Permit Portal`
- `GovWell online permitting`
- `GovWell online building permit applications`
- `GovWell building permit application`
- `GovWell (Butte-Silver Bow permitting portal)`
- `GovWell (Bellevue Permits Portal)`
- `GovWell (town zoning permits)`
- `GovWell online permits`

Excluded: Plymouth, IN, `https://www.plymouthin.com/egov/apps/services/index.egov?view=item&id=5`, label `GovWell (via city link)`. This is a city information page, not a directly identified GovWell tenant, so the adapter rejects it and the label is not registered. No application-only vendor was registered: GovWell demonstrably has public records, but publication is tenant-controlled.

6. Known gaps and follow-up

- Ask jurisdictions without public dashboards to publish them, or research a separately documented public records source. Do not treat their current errors as absence of permits.
- Additional tenant-specific form fields, license numbers, point coordinates, and full form detail are not comprehensively mapped. Only verified, explicitly labeled public fields are normalized. Contractor references use the public registration label; owner-exemption references are not invented as contractors.
- Company/name coverage is limited to visible fields. Keyword can find more public rows than a typed company/name match when the matching form field is not exposed in the returned columns. For example, the later Macon keyword query returned 131 records while the earlier typed contractor query returned 8; these were different requests at different times.
- Public date filters have calendar-day precision where a timestamp is not exposed. Saved dashboard filters also constrain coverage. Cape's 11 overlapping views require more requests; a follow-up may safely batch read-only view inputs after validation.
- Revalidate other tenants before claiming successful coverage. Review newly introduced view types and fail visibly rather than silently changing the adapter's interpretation.

Fixture provenance and checks

All JSON fixtures are actual unauthenticated GraphQL responses fetched on 2026-10-10. No government rows were fabricated. `macon-address` used search `120 LAURELWOOD`; `macon-RecordIssuedDate-{0,50}` and `macon-RecordSubmittedDate-{0,50}` used dashboard 166, view 536831, limit 50 and date 2026-10-03; `macon-no-results` used `CONSTRUCTHUB-NO-MATCH-20261010`; `raynham-company` used dashboard 129, view 438350 and `Southern New England Windows`; `cape-two-records` used dashboard 10, view 112333, empty text and limit 2 for discovery. Metadata fixtures use their filename's tenant slug. GraphQL selection text and request builders are exported in govwell.ts. Bodies are stored intact as parsed JSON, with JSON serialization only.

Offline verification: `npx vitest run --configLoader runner server/scrapers/govwell.test.ts server/scrapers/permitlink.test.ts` passes 24 tests across both files. Registry alias tests mock the legacy scraper, so they require no database. `npx tsc --noEmit -p .` passes. The unmodified Vitest command initially failed before tests with EROFS while writing `node_modules/.vite-temp`; the supported `--configLoader runner` flag avoids this read-only environment issue. No repository config was changed.

Initial search checkpoint: commit `0722a46f`. Final work is committed separately on `permits/adapter-govwell`; no push.
