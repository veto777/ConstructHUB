# PermitLink adapter report — 2026-10-10

1. Platform and mechanism

Auth-free guest records are available; this vendor is not application-only. On Thompson's real `DocumentLink.PublicLogin.cls` page, the public `Guest Usage - View Only` handler links to `DocumentLink.GuestPermitListCenter.cls`. Direct guest-table requests returned records without logging in or creating an account.

Handled shapes: `http(s)://[www.]permitlinkonline.com/csp/<tenant>/DocumentLink.<page>.cls`, corresponding permitlinkusa-online.com URLs, and the permitlinkusaonline.com spelling present in targets. Tenant and host come from the supplied URL; HTTPS is used. The public guest page is resolved within the same `/csp/<tenant>/` directory. Other URL shapes are rejected.

This is an InterSystems ZEN application. Initial guest HTML includes records, but subsequent filters use session-specific `%25CSP.Broker.cls` requests. The adapter uses `ctx.browser()` and the public table's own filter/refresh methods; it does not invent JSON endpoints or replay signed broker tokens. `HouseNumber` and `Location` implement address search; `PermitID` implements permit search. House number and permit number are portal prefix filters; street is the portal's case-insensitive containment filter. Results are paginated through the public snapshot table and checked against `rowCount`; repeated/incomplete pages and more than 100 pages throw instead of returning partial results.

All vendor requests carry the honest ConstructHUB User-Agent, start at least max(1000, ctx.politeness.minDelayMs) apart, and finish before the next vendor request starts in the context. Nonessential images/styles/fonts are not loaded. The browser context closes on success and failure. HTTP 401/403/429/503 and detected challenges are typed blocks and stop further requests. No login, permit application submission, payment action, or CAPTCHA bypass was used.

2. Capabilities

Search: address and permit. Company, name, keyword and license search are not advertised. A generic Form Data search exists in the public page, but its field coverage and failure/no-match behavior have not been validated for these search types.

listRecent: no. The observed guest table displays issue dates and has a permit-year control, but its public filters do not include an issue/application date range. `listRecent` validates the URL and returns [] without opening a browser or scanning permits; `capabilities.listRecent` is false. The zero counts below mean unsupported listing, not zero recent permits.

Detail: no. The table's View/Print workflow is stateful and uses per-document form handlers; no stable per-record public page was verified. `sourceUrl` stays null instead of pointing every record to a generic list. Public document IDs remain in the untouched raw HTML rows for follow-up. Issued dates and property owners are mapped when present. Contractor, applicant, license, valuation and other unavailable fields remain null. Shared `Draft` placeholders are excluded because they are not permit numbers.

3. Live tests

All tests below used targets.json entries on 2026-10-10. Counts are actual normalized records. Three tenants passed both address and permit search. The additional Thompson pagination query returned 127 numbered permits after reading all result pages and verifying the total, including rows excluded as Draft. The seven-day calls use `2026-10-03T18:02:32Z` and return 0 because this adapter explicitly does not support date listing. Contractor searches were not run because that capability is not advertised.

Thompson, CT

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address 0 WEST THOMPSON RD | 5 | 12 | 2026-10-10 17:52:32 |
| search permit 26-35IWA | 1 | 12 | 2026-10-10 17:52:11 |
| search address THOMPSON HILL | 127 | 16 | 2026-10-10 18:03:38 |
| search permit CONSTRUCTHUB-NO-MATCH-20261010 | 0 | 12 | 2026-10-10 17:58:40 |
| recent 2026-10-03T18:02:32Z | 0 | 0 | 2026-10-10 18:02:34 |

URL exactly as stored: https://permitlinkusa-online.com/csp/thompsonct/DocumentLink.PublicLogin.cls

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address 0 WEST THOMPSON RD | 26-35IWA | 0 WEST THOMPSON RD | Closed | null | null |
| search address 0 WEST THOMPSON RD | 26-33IWA | 0 WEST THOMPSON RD | Incomplete | null | null |
| search permit 26-35IWA | 26-35IWA | 0 WEST THOMPSON RD | Closed | null | null |
| search address THOMPSON HILL | 26-529CA | 376 THOMPSON HILL RD | Closed | 2026-10-02 | null |
| search address THOMPSON HILL | 26-263B | 354 THOMPSON HILL RD | Approved | 2026-10-05 | null |

Deep River, CT

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address 103 UNION ST | 2 | 12 | 2026-10-10 17:53:59 |
| search permit 26-2D | 1 | 12 | 2026-10-10 17:54:12 |
| recent 2026-10-03T18:02:32Z | 0 | 0 | 2026-10-10 18:02:35 |

URL exactly as stored: https://permitlinkonline.com/csp/deepriver/DocumentLink.PublicWelcome.cls

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address 103 UNION ST | 26-2D | 103 UNION ST | Approved | 2026-10-07 | null |
| search address 103 UNION ST | 26-19Z | 103 UNION ST | Payment Due | null | null |
| search permit 26-2D | 26-2D | 103 UNION ST | Approved | 2026-10-07 | null |

Middlefield, CT

| Query | Count | Elapsed seconds | Completed UTC |
| --- | ---: | ---: | --- |
| search address LAKE SHORE DR | 2 | 12 | 2026-10-10 17:54:34 |
| search permit 26-24P | 1 | 12 | 2026-10-10 18:01:37 |
| recent 2026-10-03T18:02:32Z | 0 | 0 | 2026-10-10 18:02:35 |

URL exactly as stored: https://permitlinkusa-online.com/csp/middlefield/DocumentLink.PublicWelcome.cls

Two sample records per query where at least two records were returned; a one-record query has one sample. Zero-result queries have no sample.

| Query | permitNumber | address | status | issuedAt | contractorName |
| --- | --- | --- | --- | --- | --- |
| search address LAKE SHORE DR | 26-14G | 79 LAKE SHORE DR | Approved | 2026-10-07 | null |
| search address LAKE SHORE DR | 25-140B | 43 LAKE SHORE DR | Closed | 2025-10-15 | null |
| search permit 26-24P | 26-24P | 11 CIDER MILL RD | Approved | 2026-10-07 | null |

4. Blocked or failed tenants

No final live search failed or encountered 401/403/429, a CAPTCHA, or a login wall on Thompson, Deep River or Middlefield. Guest documents and broker calls returned HTTP 200. All three return HTTP 404 for optional `/csp/backfix.js`; this does not prevent public table search.

The first Thompson harness attempt incorrectly made that optional 404 fatal, then aborted its broker request and received a HyperEvent error dialog. This was an adapter defect, not a portal block, and was corrected. A later pagination test timed out because the server preserves `lastUpdate` while navigating a snapshot; the adapter now waits for the changed first-row document ID and current page. The final pagination run passed with 127 records. Generic public guest/search layouts on the other 49 entries were not live-tested, so no success is claimed for them.

5. Coverage

PermitLink URL-shape support is 52 / 52 assigned PermitLink entries (52 / 119 overall), representing 51 distinct stored URLs. Host counts: permitlinkusa-online.com 22, permitlinkonline.com 16, www.permitlinkonline.com 12, www.permitlinkusa-online.com 1, permitlinkusaonline.com 1. Windham and Willimantic share a tenant. These counts describe URL compatibility, not a complete live audit. Search was verified on 3 entries, spanning the two primary non-www hosts; redirects to supported vendor hosts are permitted. The other host variants and tenants remain unverified live.

Registered platform: `PermitLink`. Registered alias: `PermitLink online permits`. No assigned PermitLink label or URL shape was excluded. A tenant that disables public guest records will throw, never be reported as a successful empty search. Combined with GovWell, the two adapters recognize 118 / 119 assigned URL shapes; Plymouth's city-information URL is deliberately excluded.

6. Known gaps and follow-up

- No alerts/date enumeration capability is claimed. Find a publicly documented issued-permit date list before enabling it. A year picker or issue-date column alone is insufficient.
- Investigate the generic Form Data search, View/Print public form handlers, and contractor/license field mapping using only public guest actions. Any record-detail URL must be verified with a fresh unauthenticated session before filling sourceUrl.
- Search latency is roughly 12 seconds for a one-page query because the legacy JavaScript requests are intentionally serialized and rate-limited. The 127-record pagination test took 16 seconds. Do not remove rate limiting to speed it up.
- Address input should use the portal's street spelling and omit city/state for its street filter. Other form/table versions may need additional column mappings. The adapter fails explicitly on an unrecognized table.
- Test the remaining 49 entries, especially old hostname variants, before claiming records access on them. The current URL support is not proof of public access on every tenant.

Fixture provenance and checks

All HTML fixtures are real captures from 2026-10-10, not fabricated records. `thompson-guest.html`, `deepriver-guest.html` and `middlefield-guest.html` are complete GET response bodies from each tenant's guest route. `thompson-filtered-dom.html` is the complete browser DOM after searching permit `26-35IWA`. `thompson-empty-dom.html` is the complete browser DOM after searching `CONSTRUCTHUB-NO-MATCH-20261010`. They retain the portal response content, including its legacy scripts; no government rows were edited. The normalized raw row preserves its exact input HTML substring.

Offline verification: `npx vitest run --configLoader runner server/scrapers/govwell.test.ts server/scrapers/permitlink.test.ts` passes 24 tests. Tests include real tables from all three tenants, a real empty result, exact raw-row preservation, typed HTTP blocks, and context cleanup on failures. `npx tsc --noEmit -p .` passes. The plain Vitest invocation initially hit an EROFS write to the shared read-only node_modules/.vite-temp directory before executing tests; `--configLoader runner` resolves that environment issue without changing repo config.

Initial search checkpoint: commit `0722a46f`. Final work is committed separately on `permits/adapter-govwell`; no push.
