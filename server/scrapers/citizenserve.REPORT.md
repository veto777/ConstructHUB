1. Platform & mechanism

CitizenServe: installation-bearing https://www[digits].citizenserve.com/Portal/ and /Portal/PortalController URLs. The installationID query key is case-insensitive; host and installation are derived from ctx.searchUrl. Unrelated hosts, vanity paths without an installation ID, and missing IDs throw. The adapter opens showSearchPage with type=Permit by polite GET. The verified pages are server-rendered HTML with a frm_PortalSearch POST form (DisplayCasesNPagging), not ASP.NET ViewState. Its validateAndSearch handler calls grecaptcha.execute before posting. No POST is sent and no token is obtained or bypassed.

Auth-free landing pages: yes. Auth-free unattended search: not verified; all 3 tested tenants require reCAPTCHA v3. This is a blocked-access adapter, not a successful permit scraper. An HTTP 200 CAPTCHA page becomes PortalBlockedError(status=403); the 403 is the adapter's block classification, not an observed HTTP response status.

Pottawattamie's advertised showPortalReports page lists “Permit Issued List” and “Permit Issued List (Public Information)”. Its getQuery handler also calls grecaptcha.execute before posting; no report was submitted. This rules out that public report menu as an unattended date-listing route in the tested tenant.

2. Capabilities

Search types advertised: none. Calling search for address, permit, or company reports the actual CAPTCHA block. listRecent: false; returns [] without network access and logs the limitation. No issue/application date polling is implemented. detail: false; no accessible record detail was obtained. All capabilities remain disabled rather than suggesting the 78 recognized URLs are scrapeable.

3. Live tests

Executed sequentially on 2026-10-10 UTC with the repository live-harness. Timings below are end-to-end subprocess seconds including tsx startup. A blocked count is unknown, never a zero-result claim. Recent uses since=2026-10-03T00:00:00.000Z (last 7 calendar days); its [] is the unsupported contract return, not evidence of no recent permits.

Pottawattamie County, IA

URL: https://www.citizenserve.com/Portal/PortalController?Action=showHomePage&ctzPagePrefix=Portal_&installationID=220

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:48:16.859218+00:00 | search address 100 Main St | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.922 |
| 2026-10-10T17:48:19.781817+00:00 | search permit 2026 | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.072 |
| 2026-10-10T17:48:21.854070+00:00 | search company KC Custom Signs | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.257 |
| 2026-10-10T17:48:24.110914+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.592 |

Samples: none available; no permit records were returned. No sample values fabricated.

Richfield, MN

URL: https://www4.citizenserve.com/Portal/PortalController?Action=showPermit&ctzPagePrefix=Portal_&installationID=420

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:48:25.703165+00:00 | search address 100 Main St | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.172 |
| 2026-10-10T17:48:27.875180+00:00 | search permit 2026 | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.888 |
| 2026-10-10T17:48:30.763836+00:00 | search company KC Custom Signs | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.150 |
| 2026-10-10T17:48:32.914579+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.567 |

Samples: none available; no permit records were returned. No sample values fabricated.

Merriam, KS

URL: https://www.citizenserve.com/Portal/PortalController?Action=showHomePage&ctzPagePrefix=Portal_&installationID=212&original_iid=0&original_contactID=0

| UTC start | Query | Count / outcome | Seconds |
| --- | --- | --- | --- |
| 2026-10-10T17:48:34.481761+00:00 | search address 100 Main St | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.138 |
| 2026-10-10T17:48:36.620192+00:00 | search permit 2026 | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.090 |
| 2026-10-10T17:48:38.710423+00:00 | search company KC Custom Signs | unknown — CitizenServe public search requires CAPTCHA; no search was submitted | 1.142 |
| 2026-10-10T17:48:40.852923+00:00 | recent 2026-10-03T00:00:00.000Z | 0 (unsupported; no portal request) | 0.589 |

Samples: none available; no permit records were returned. No sample values fabricated.

4. Blocked / failed tenants

Pottawattamie County, IA; Richfield, MN; Merriam, KS: all search-page HTTP responses were 200. All 9 address/permit/company calls stopped at the explicit reCAPTCHA v3 submit handler with a typed PortalBlockedError. No Cloudflare, Incapsula, 401, 403 or 429 HTTP responses were observed. Pottawattamie's reports page was also HTTP 200 with the same submit challenge. No bypass or login was attempted.

5. Coverage

78 / 80 CitizenServe-labelled target entries have a recognized installation URL shape (78 / 124 overall assigned entries). Successful unattended search coverage verified: 0 / 3 live-tested CitizenServe tenants. URL recognition is not scrape coverage.

Excluded: Bedford, OH — citizenserve.com/bedford vanity URL has no installationID; follow its public redirect in a future discovery pass rather than guessing one. Westminster, SC — oconeesc.com department page is not a CitizenServe portal. No records are fabricated for either.

Aliases / platform labels registered (every distinct target label for this vendor): `Citizenserve`, `Citizenserve portal`, `CitizenServe`, `Citizenserve (Building Permit Portal)`.

6. Known gaps and follow-up

No usable CitizenServe search or polling scraper was produced because all tested public search/report submissions require CAPTCHA. A follow-up needs a municipality-published auth-free export/API or vendor-approved public access. Do not replay the form without CAPTCHA or drive the browser to solve it. Resolve Bedford's vanity link through public redirect discovery. Verify remaining tenants independently before changing capabilities.

Fixtures: full real HTML bodies, with only uniqueID session tokens redacted. capture-manifest.json records URLs, HTTP status and filesystem capture timestamps. Unknown data is not inferred.

Validation: `npx vitest run --configLoader runner server/scrapers/citizenserve.test.ts server/scrapers/civicgov.test.ts` — 27 tests passed across 2 files, entirely offline. `npx tsc --noEmit -p .` passed. The default Vitest config bundler fails with EROFS writing `node_modules/.vite-temp`; runner mode avoids that shared read-only directory. No app/server/database was started. No login, CAPTCHA submission, write form, proxy, or browser was used. All adapter traffic uses politeFetch, its honest ConstructHUB User-Agent, and a minimum delay of max(1000 ms, ctx.politeness.minDelayMs).
