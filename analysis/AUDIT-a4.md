# ConstructHUB government data audit — lane a4

Audit date: 2026-09-28. Worktree `/home/veto/ConstructHUB-a4`, branch `lane/a4`, application port 8159, database `constructhub_dev_a4`. CLAUDE.md, HANDOFF.md, the original scraper, portal builder, link checker and both seeders were read before implementation. Data and evidence commit: **2e06dc5**.

## Outcome and limits

Checked every record in both input files: 4,485 assessment-office records and 632 permit portals, including all 4,114 originally populated URLs (3,763 distinct URLs). Revisited NETR for all 4,485 offices across 50 states and DC, including missing URLs and phones. Published 2,206 assessment links and 428 permit links with successful content and jurisdiction/source evidence. Appraiser phone coverage increased from 3,704 to 4,194. Phones match current source rows and valid formats; no phone calls were made.

Updated 1,193 previously populated URLs, added verified URLs to 330 previously empty office records, and nulled 1,810 previously populated URLs that could not meet the verification bar. There are 2,279 appraiser and 204 permit null URLs after the audit. **Null does not mean the government office is closed or its website is necessarily dead.** It includes blocked, timed-out, ambiguous and login/JavaScript pages whose subject or jurisdiction could not be established. The original candidate remains in non-public reference metadata for later review. No new jurisdiction records were invented.

This completes the data audit, but cannot establish that every listed office works: municipal coverage gaps in the database schema and inaccessible external sites remain open below. Current NETR pages yielded a recognized assessment-office row for 4,345 entries; 140 had no recognized current assessment office. Unknown names use a neutral property-records label. No invented phone, address or replacement URL was added.

## Verification rules and evidence

The rerunnable checker uses GET with a browser user agent, a bounded eight-worker pool and per-host serialization. Requests time out after 18 seconds including body reads. Transient network errors, 429 and 5xx receive three attempts with exponential backoff. Redirect destinations, final HTTP status, attempts, timestamps and reasons are recorded. Parked/for-sale sites, soft 404s and generic vendor homepages fail. A 403, empty JavaScript shell or unrelated login page is never treated as proof of a working government portal.

A second GET review establishes property/permit topic and jurisdiction; Chromium rendered 1,300 inconclusive pages, accepting 414 after content and jurisdiction checks. Browser review uses four workers, serializes each host, and does not submit forms, log in or bypass CAPTCHA. Replacement URLs come from current NETR listings or official pages linking the destination. Seven manually sourced candidates were checked against their actual official source links. Broad keyword matching remains a heuristic, not a guarantee that every workflow behind a portal is operational.

`gov-data-audit.json` contains one record per input with old URL, final URL, original verdict/reason, decision and replacement evidence. `gov-netr-refresh.json`, `gov-jurisdiction-review.json`, `gov-browser-review.json`, `gov-replacement-review.json` and `gov-manual-verification.json` preserve the supporting checks. `gov-data-validation.json` independently verifies all 5,117 indices, every published URL's accepted source/jurisdiction evidence, absence of generic vendor homepages, and all 4,194 phones against source rows. Verification timestamps describe the actual checks; seeding does not pretend to recheck websites at startup.

## Feature matrix

| Feature | Page/route | API | How verified | Status |
|---|---|---|---|---|
| Property office directory, state/county filters, contact and official link | `/property`, `/property?countyId=…` | GET `/api/property-appraisers` | Real lane API, Chromium page/filter/deep-link checks, null/dead fixture, source phone validation | FIXED 32026f8, 2e06dc5 |
| County office lookup and property lookup | Search/property flows | GET `/api/property-appraisers/county/:countyId`; GET `/api/property-records/:countyId`; POST `/api/property-lookup` | curl and real database mutation restored by Playwright; dead links omitted while office remains | FIXED e48235d |
| Permit directory, filtering, counts and official links | `/databases` | GET `/api/databases`, `/api/databases/counts`, `/api/counties`, `/api/databases/county/:countyId` | curl full/filter/county calls; Chromium real page and unavailable-link fixtures; legacy contact suppression fixture | FIXED 82fb1f9, 2e06dc5 |
| Directory/sidebar coverage wording | Sidebar and `/search` | GET `/api/databases/counts` | Code inspection and rendered pages; directory entries are no longer described as active sources | FIXED 82fb1f9 |
| Permit search result property lookup | `/search` | POST `/api/search`; GET `/api/search/live/:searchId`; DELETE `/api/search-queries/:id` | Real empty-scope search and cleanup; Playwright result fixture verifies selected county deep link instead of hardcoded Florida ID mapping | FIXED cffbc4e |
| Unavailable government links and contact fallback | Property, databases, search | Directory and lookup APIs above | Playwright verifies honest search fallback and absence of broken Visit/Search links; unsupported legacy contacts hidden | FIXED 82fb1f9 |
| Manual scrape eligibility | `/databases` | POST `/api/scrape`; GET `/api/scrape/status/:jobId` | Real API rejects stored unverified portal; unit tests and code review gate supported platform/host before dispatch | FIXED 82fb1f9 |
| Successful external scrape and portal record submission | `/databases`, `/search`, external websites | Scrape/status and external portal forms | Landing-page GET/render verified; authenticated searches, submissions and successful end-to-end adapter results were not exercised | NOT-TESTABLE without appropriate portal access/fixtures; adapter limitations below |
| CRM project government suggestions | Project permit panel | GET `/api/crm/projects/:id/permits/suggest`; GET `/api/crm/me` | Real temporary project: Portland ME excludes verified Portland OR; state-name alias works; absent state gives empty suggestions; cleanup complete | FIXED daacfc6 |
| CRM city-to-county office resolution | Project permit panel | GET `/api/crm/projects/:id/permits/suggest` | Read exact matching path; municipal/county mismatch remains | BROKEN-open |
| Reference refresh of existing rows | Startup seeders | Internal Drizzle transactions | Old→new→null→repeat lane DB test, stable IDs/notes, no duplicates, stale verdict protection | FIXED b277a58, b5acf87 |
| Missing county permit insertion | Startup permit seeder | Internal Drizzle transaction | Allen County IN insertion twice retains one ID; full seed adds only exact county/state matches | FIXED 3581229 |
| Municipal reference coverage | County-bound schema/seeders | Property/permit directory APIs | Compare all JSON jurisdictions with lane DB; complete unmatched list in coverage artifact | BROKEN-open |
| Source discovery and repeatable link audit | `scripts/` | NETR/official website GETs | All input records processed; recognized regional office labels unit-tested; source evidence validator passes | FIXED 1d30f19, 1be71fb |

## Per-state counts

Before columns classify original URLs after HTTP/content/jurisdiction/browser review: **L** live, **D** dead, **U** unverified, **N** originally absent. After L/null counts describe published data; published dead links are zero in every state. **Fixed** means an existing nonempty URL changed to a verified URL, including legitimate redirect normalization; it does not imply every old URL was dead. **Nulled** means a previously populated URL is now null. **Added** means a verified URL filled an existing empty record, not a newly created office. Phone changes include additions, removals and replacements. Original and final URLs and individual reasons are in the machine report.

### Assessment offices

| State | Records | Before L | Before D | Before U | Before N | After L | After null | Fixed | Nulled | Added | Phones added | Phones changed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AK | 50 | 5 | 1 | 4 | 40 | 6 | 44 | 4 | 4 | 0 | 1 | 1 |
| AL | 71 | 4 | 0 | 5 | 62 | 35 | 36 | 2 | 5 | 31 | 62 | 63 |
| AR | 84 | 33 | 0 | 51 | 0 | 33 | 51 | 31 | 51 | 0 | 0 | 1 |
| AZ | 15 | 9 | 0 | 6 | 0 | 9 | 6 | 2 | 6 | 0 | 0 | 0 |
| CA | 58 | 33 | 11 | 14 | 0 | 36 | 22 | 10 | 22 | 0 | 0 | 0 |
| CO | 64 | 46 | 1 | 16 | 1 | 47 | 17 | 15 | 16 | 0 | 0 | 1 |
| CT | 173 | 117 | 10 | 42 | 4 | 118 | 55 | 81 | 51 | 0 | 0 | 14 |
| DC | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| DE | 3 | 2 | 0 | 0 | 1 | 3 | 0 | 0 | 0 | 1 | 0 | 0 |
| FL | 67 | 34 | 0 | 33 | 0 | 34 | 33 | 17 | 33 | 0 | 0 | 1 |
| GA | 159 | 122 | 0 | 37 | 0 | 129 | 30 | 126 | 30 | 0 | 0 | 10 |
| HI | 4 | 2 | 0 | 2 | 0 | 2 | 2 | 1 | 2 | 0 | 0 | 0 |
| IA | 100 | 37 | 1 | 62 | 0 | 39 | 61 | 33 | 61 | 0 | 0 | 2 |
| ID | 44 | 23 | 9 | 9 | 3 | 23 | 21 | 12 | 18 | 0 | 0 | 4 |
| IL | 102 | 64 | 8 | 24 | 6 | 65 | 37 | 32 | 31 | 0 | 0 | 7 |
| IN | 92 | 45 | 4 | 42 | 1 | 45 | 47 | 5 | 46 | 0 | 0 | 2 |
| KS | 105 | 60 | 8 | 36 | 1 | 60 | 45 | 23 | 44 | 0 | 0 | 3 |
| KY | 121 | 0 | 0 | 1 | 120 | 37 | 84 | 0 | 1 | 37 | 119 | 119 |
| LA | 65 | 32 | 7 | 25 | 1 | 32 | 33 | 18 | 32 | 0 | 0 | 1 |
| MA | 367 | 142 | 22 | 174 | 29 | 145 | 222 | 96 | 196 | 3 | 5 | 19 |
| MD | 24 | 0 | 0 | 24 | 0 | 0 | 24 | 0 | 24 | 0 | 0 | 0 |
| ME | 294 | 174 | 16 | 69 | 35 | 175 | 119 | 57 | 85 | 1 | 3 | 11 |
| MI | 83 | 51 | 10 | 22 | 0 | 54 | 29 | 34 | 29 | 0 | 0 | 2 |
| MN | 87 | 34 | 5 | 45 | 3 | 35 | 52 | 29 | 50 | 1 | 2 | 2 |
| MO | 115 | 69 | 10 | 28 | 8 | 71 | 44 | 26 | 36 | 0 | 0 | 6 |
| MS | 92 | 54 | 3 | 23 | 12 | 54 | 38 | 43 | 26 | 0 | 0 | 0 |
| MT | 56 | 0 | 0 | 56 | 0 | 0 | 56 | 0 | 56 | 0 | 0 | 0 |
| NC | 100 | 51 | 1 | 23 | 25 | 54 | 46 | 19 | 24 | 3 | 8 | 9 |
| ND | 53 | 28 | 4 | 15 | 6 | 32 | 21 | 13 | 17 | 2 | 1 | 7 |
| NE | 93 | 34 | 2 | 56 | 1 | 34 | 59 | 12 | 58 | 0 | 0 | 2 |
| NH | 238 | 57 | 24 | 136 | 21 | 58 | 180 | 37 | 160 | 1 | 3 | 12 |
| NJ | 21 | 0 | 0 | 0 | 21 | 20 | 1 | 0 | 0 | 20 | 20 | 20 |
| NM | 33 | 23 | 2 | 6 | 2 | 23 | 10 | 9 | 8 | 0 | 0 | 1 |
| NV | 17 | 16 | 0 | 1 | 0 | 16 | 1 | 3 | 1 | 0 | 0 | 0 |
| NY | 62 | 6 | 0 | 5 | 51 | 24 | 38 | 4 | 5 | 18 | 45 | 45 |
| OH | 88 | 40 | 2 | 45 | 1 | 41 | 47 | 31 | 46 | 0 | 0 | 3 |
| OK | 77 | 47 | 2 | 28 | 0 | 47 | 30 | 12 | 30 | 0 | 0 | 0 |
| OR | 36 | 15 | 0 | 17 | 4 | 17 | 19 | 6 | 17 | 2 | 2 | 2 |
| PA | 67 | 50 | 3 | 14 | 0 | 50 | 17 | 20 | 17 | 0 | 0 | 3 |
| RI | 39 | 25 | 0 | 13 | 1 | 25 | 14 | 18 | 13 | 0 | 0 | 6 |
| SC | 46 | 27 | 2 | 17 | 0 | 28 | 18 | 22 | 18 | 0 | 0 | 3 |
| SD | 66 | 15 | 5 | 21 | 25 | 15 | 51 | 5 | 26 | 0 | 0 | 1 |
| TN | 96 | 10 | 0 | 86 | 0 | 13 | 83 | 11 | 83 | 0 | 0 | 0 |
| TX | 254 | 25 | 4 | 20 | 205 | 203 | 51 | 40 | 6 | 160 | 205 | 249 |
| UT | 29 | 13 | 3 | 12 | 1 | 14 | 15 | 9 | 14 | 0 | 0 | 1 |
| VA | 133 | 20 | 3 | 27 | 83 | 60 | 73 | 7 | 30 | 40 | 80 | 80 |
| VT | 252 | 37 | 24 | 30 | 161 | 39 | 213 | 17 | 54 | 2 | 11 | 17 |
| WA | 39 | 29 | 0 | 9 | 1 | 29 | 10 | 17 | 9 | 0 | 1 | 3 |
| WI | 72 | 4 | 0 | 1 | 67 | 12 | 60 | 3 | 1 | 8 | 41 | 41 |
| WV | 55 | 41 | 4 | 10 | 0 | 50 | 5 | 27 | 5 | 0 | 0 | 12 |
| WY | 23 | 15 | 4 | 4 | 0 | 15 | 8 | 6 | 8 | 0 | 0 | 1 |
| **Total** | 4485 | 1820 | 215 | 1447 | 1003 | 2206 | 2279 | 1045 | 1606 | 330 | 609 | 787 |

### Permit portals

| State | Records | Before L | Before D | Before U | Before N | After L | After null | Fixed | Nulled | Added | Phones added | Phones changed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AL | 9 | 9 | 0 | 0 | 0 | 9 | 0 | 2 | 0 | 0 | 0 | 0 |
| AR | 6 | 4 | 0 | 2 | 0 | 4 | 2 | 2 | 2 | 0 | 0 | 0 |
| AZ | 17 | 15 | 0 | 2 | 0 | 15 | 2 | 5 | 2 | 0 | 0 | 0 |
| CA | 110 | 81 | 1 | 28 | 0 | 82 | 28 | 31 | 28 | 0 | 0 | 0 |
| CO | 24 | 17 | 0 | 7 | 0 | 17 | 7 | 1 | 7 | 0 | 0 | 0 |
| CT | 10 | 4 | 0 | 6 | 0 | 4 | 6 | 1 | 6 | 0 | 0 | 0 |
| DE | 2 | 1 | 0 | 1 | 0 | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| FL | 55 | 43 | 0 | 12 | 0 | 43 | 12 | 13 | 12 | 0 | 0 | 0 |
| GA | 18 | 10 | 0 | 8 | 0 | 10 | 8 | 3 | 8 | 0 | 0 | 0 |
| HI | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| IA | 11 | 8 | 0 | 3 | 0 | 8 | 3 | 5 | 3 | 0 | 0 | 0 |
| ID | 9 | 7 | 0 | 2 | 0 | 7 | 2 | 3 | 2 | 0 | 0 | 0 |
| IL | 21 | 14 | 0 | 7 | 0 | 14 | 7 | 7 | 7 | 0 | 0 | 0 |
| IN | 10 | 7 | 0 | 3 | 0 | 7 | 3 | 4 | 3 | 0 | 0 | 0 |
| KS | 8 | 4 | 0 | 4 | 0 | 4 | 4 | 2 | 4 | 0 | 0 | 0 |
| KY | 2 | 0 | 0 | 2 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| LA | 3 | 1 | 0 | 2 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | 0 |
| MA | 18 | 7 | 0 | 11 | 0 | 7 | 11 | 3 | 11 | 0 | 0 | 0 |
| MD | 11 | 9 | 0 | 2 | 0 | 9 | 2 | 2 | 2 | 0 | 0 | 0 |
| ME | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| MI | 3 | 1 | 0 | 2 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | 0 |
| MN | 12 | 11 | 0 | 1 | 0 | 11 | 1 | 1 | 1 | 0 | 0 | 0 |
| MO | 9 | 4 | 0 | 5 | 0 | 4 | 5 | 1 | 5 | 0 | 0 | 0 |
| MS | 2 | 0 | 0 | 2 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| MT | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | 0 |
| NC | 17 | 11 | 0 | 6 | 0 | 11 | 6 | 3 | 6 | 0 | 0 | 0 |
| ND | 4 | 3 | 0 | 1 | 0 | 3 | 1 | 0 | 1 | 0 | 0 | 0 |
| NE | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 | 0 | 0 | 0 | 0 |
| NH | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| NJ | 3 | 3 | 0 | 0 | 0 | 3 | 0 | 2 | 0 | 0 | 0 | 0 |
| NM | 5 | 3 | 0 | 2 | 0 | 3 | 2 | 1 | 2 | 0 | 0 | 0 |
| NV | 6 | 3 | 0 | 3 | 0 | 3 | 3 | 2 | 3 | 0 | 0 | 0 |
| NY | 8 | 4 | 0 | 4 | 0 | 4 | 4 | 2 | 4 | 0 | 0 | 0 |
| OH | 20 | 12 | 0 | 8 | 0 | 12 | 8 | 4 | 8 | 0 | 0 | 0 |
| OK | 5 | 2 | 0 | 3 | 0 | 2 | 3 | 1 | 3 | 0 | 0 | 0 |
| OR | 17 | 9 | 0 | 8 | 0 | 9 | 8 | 1 | 8 | 0 | 0 | 0 |
| PA | 7 | 2 | 0 | 5 | 0 | 2 | 5 | 1 | 5 | 0 | 0 | 0 |
| RI | 6 | 0 | 0 | 6 | 0 | 0 | 6 | 0 | 6 | 0 | 0 | 0 |
| SC | 9 | 6 | 0 | 3 | 0 | 6 | 3 | 3 | 3 | 0 | 0 | 0 |
| SD | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| TN | 14 | 12 | 0 | 2 | 0 | 12 | 2 | 1 | 2 | 0 | 0 | 0 |
| TX | 67 | 50 | 0 | 17 | 0 | 50 | 17 | 16 | 17 | 0 | 0 | 0 |
| UT | 8 | 4 | 0 | 4 | 0 | 4 | 4 | 1 | 4 | 0 | 0 | 0 |
| VA | 18 | 11 | 0 | 7 | 0 | 11 | 7 | 3 | 7 | 0 | 0 | 0 |
| VT | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| WA | 28 | 19 | 0 | 9 | 0 | 19 | 9 | 7 | 9 | 0 | 0 | 0 |
| WI | 6 | 3 | 0 | 3 | 0 | 3 | 3 | 2 | 3 | 0 | 0 | 0 |
| WV | 2 | 1 | 1 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| WY | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| **Total** | 632 | 426 | 2 | 204 | 0 | 428 | 204 | 148 | 204 | 0 | 0 | 0 |

Permit states absent from the table have no records in this reference file; that is a coverage gap, not verified absence of permit offices.

## Database propagation proof

Sentinel-only behavior was replaced with transactional, advisory-locked natural-key updates of source-owned rows. Custom offices and user notes are preserved. Newer database link verdicts are not overwritten by stale reference timestamps. Nulls propagate and disable the link instead of leaving the previous broken URL active. The permit seeder only inserts missing rows when both county name and state match exactly; it never guesses a city's parent county.

The focused old-data/update/repeat/restore test is recorded in `gov-seeding-test.json`. Applying the actual updated JSON twice produced `gov-data-db-proof.json`:

| Table | Before | After | Repeat | URLs changed | Phones changed | Status changed | Repeat changes |
|---|---:|---:|---:|---:|---:|---:|---:|
| property_appraisers | 3,040 | 3,040 | 3,040 | 2,051 | 696 | 2,635 | 0 |
| permit_databases | 32,992 | 32,992 | 32,992 | 422 | 0 | 744 | 0 |

All prior IDs and notes survived. Earlier exact county insertions added 27 rows (32,965→32,992); the full proof starts after those insertions. The final database has 1,637 live appraiser links and 494 live permit rows; these differ from reference-file counts because of schema coverage, existing rows and newer verdict protection. Fifty-five stored unverified legacy permit URLs are suppressed by API/UI. All 275 stored legacy permit phone values lack current provenance and are suppressed with legacy email/address fields; they remain in storage to avoid destructive edits.

## Open issues, ranked

1. **P1 — County-only model loses municipal assessment coverage.** `shared/schema.ts:93`, `server/seed-all-appraisers.ts:68`. Repro: find ME/Abbot in `appraisers.json` and compare `/api/property-appraisers`; the town cannot map to an exact county row. `gov-seed-coverage.json` lists **1,444 unmatched source records**; one additional normalized duplicate accounts for the 4,485→3,040 projection. Some source entries are historic districts rather than current offices. Name normalization alone is not authoritative geographic identity. Fix requires jurisdiction types and verified geographic identifiers, not invented county IDs.
2. **P2 — 31 city permit references have no safe database match.** `server/seed-permit-portals.ts:49`. Repro: inspect the unmatched city list in `gov-seed-coverage.json` and compare an entry with the permit API; the seeder logs no matching row and declines to guess a parent county. Add authoritative city/county relationships before inserting these references. The 27 exact county gaps were fixed.
3. **P2 — External verification remains inconclusive for many offices.** `server/government-url-check.ts:1`, `scripts/apply-gov-data-audit.ts:1`, per-record reasons in `gov-data-audit.json`. Repro: choose a nulled record with a blocked/timeout/jurisdiction reason and retry its preserved candidate URL with the checker/browser. For example all 24 Maryland assessment URLs remain unverified. A human with normal browser access may establish legitimate sites behind anti-bot or login barriers. Nulls prevent unsafe claims but reduce one-click coverage. For 140 source entries no recognized current assessment-office row was found; further official research is needed.
4. **P2 — Successful scraping is not supported uniformly across verified portals.** `server/scraper.ts:596`, `server/scraper.ts:1270`. Repro: select a non-Bellingham eTRAKiT portal or non-Skagit Custom portal. The previous adapter would query a hardcoded jurisdiction; the new guard withholds automated scraping while retaining a verified official link. Implement target-specific adapters and fixture-backed result assertions before enabling them. Landing-page liveness does not prove record search, download or login works.
5. **P2 — CRM office suggestions still use city-name text matching.** `server/crm/ops.ts:908`. Repro: a Tampa, FL project may not suggest the Hillsborough county assessor because the office name lacks “Tampa.” Cross-state leakage and absent-state behavior are fixed; reliable city→county resolution needs verified geographic mapping.
6. **P2 — Legacy permit contacts lack source provenance.** `server/seed-all-states.ts:243`, `server/seed.ts:44`. Repro: compare stored permit contact fields with sanitized `/api/databases` responses; the API deliberately omits them. Existing phone/address/email values were not promoted as verified. Research official contact sources and add field-level provenance before restoring contact actions.

## Recommended improvements

| Rank | Improvement | Impact | Effort |
|---|---|---|---|
| 1 | Represent county, city, town and assessment district explicitly, with authoritative geographic IDs and relationships | High: recovers municipal coverage and accurate CRM suggestions | High |
| 2 | Schedule resumable link/source checks, retain verdict history, and queue blocked/ambiguous results for human review | High: prevents silent link decay and recovers false negatives | Medium |
| 3 | Show source and actual “last verified” date beside contact/link details, with a report-bad-link action | High: makes coverage and freshness understandable | Low–medium |
| 4 | Implement and test adapters per jurisdiction/vendor deployment; expose supported search fields and result provenance | High: reliable contractor record search | High |
| 5 | Store field-level official provenance for permit phones, addresses, email, fees and application requirements | High: useful office contact and application preparation | Medium–high |
| 6 | Provide saved jurisdictions and notifications when a previously unavailable office becomes verified | Medium: reduces repeat contractor lookup work | Medium |

## Validation and isolation notes

- `npm run check`: **0 errors**. Separate `npx tsc --project scripts/tsconfig.gov-audit.json`: **0 errors**.
- `npm test`: **489 passed, 32 skipped**, 56 test files passed and one skipped. The skipped suites require auxiliary listeners, so this is not a claim that all 521 tests ran.
- Targeted Playwright: **9 passed**, using `E2E_PORT=8159 E2E_DB=constructhub_dev_a4 E2E_WORKERS=1` and the three `government-*.spec.ts` files.
- Real curl smoke: **12 recorded calls**, including directory/filter/county APIs, property lookup, empty-scope live search and deletion of the created search query; all returned 200. See `gov-api-smoke.json`. Successful populated external searches were not claimed.
- Full source/evidence validator: **5,117 records**, **2,634 published verified URLs**, **4,194 source-matching phones**.
- Lane database old/new/repeat proof: stable IDs and notes, no repeat changes or duplicate insertions. No production database, deployment, push, real email/SMS or live payment action was used. Existing Stripe, auth, session and SSRF invariants were retained.

Two pre-existing environment/test issues were discovered during verification. The lane CRM test base URL initially pointed at 8129; initial attempts received connection refused before it was corrected locally to 8159. The existing test harness also started an admin child on 8199 and a HOVER stub on 8465 and contained `fuser -k 8199`. Those paths ran before discovery; a collision occurred, and whether the old cleanup affected another process could not be established. Commit 9745dfa removes port-wide process cleanup and provides `CRM_TEST_SINGLE_PORT=true`, now enabled in the lane environment, so final tests stay on the authorized application port and skip auxiliary suites. No unrelated process was deliberately killed.

The initial dependency directory was a symlink into the main checkout, so default TypeScript/Vite caches could land outside this worktree before discovery. The local dependency directory now contains package symlinks with local cache directories, and commit 162ee4a puts TypeScript build metadata under this worktree's `.cache`. No application source outside the lane was intentionally edited. These isolation corrections are recorded rather than presenting the initial runs as cleanly isolated. Environment contents and secrets are not included in committed evidence.

## Rerun

Use Node 20.19.6 or newer compatible Node 20; the system Node 18 cannot load the installed Cheerio dependency. From this worktree:

```sh
npx tsx scripts/audit-gov-data.ts --fresh
npx tsx scripts/refresh-netr-audit.ts --fresh
npx tsx scripts/review-gov-live.ts
npx tsx scripts/review-gov-live.ts --replacements
npx tsx scripts/browser-review-gov.ts
npx tsx scripts/verify-gov-candidates.ts
npx tsx scripts/apply-gov-data-audit.ts
npx tsx scripts/validate-gov-data-audit.ts
```

Review source evidence before accepting new manual candidates. Candidate URLs retained on nulled records are recheckable without republishing them. Ordinary audit/source runs resume checkpoints; `--fresh` starts a new evidence round. Apply checks the input hashes and completion evidence and is idempotent. The legacy portal builder now preserves current entries and null tombstones, and requires linked-source evidence for additions; the old link verifier now uses the same GET/content verdicts.

The database proof scripts `scripts/test-gov-seeding.ts`, `scripts/apply-gov-data-lane.ts` and `scripts/report-gov-seed-coverage.ts` explicitly guard the lane database identity. Run them with the lane environment loaded and only against `constructhub_dev_a4`; the full application is started with `npm run dev` using the lane environment on 8159. No production rollout was performed or authorized.
