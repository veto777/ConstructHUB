# AUDIT3 a5 — Site Scan and public free scan

Audited 2026-09-29 in `/home/veto/ConstructHUB-a5`, lane database `constructhub_dev_a5`, port **8169**. Read `CLAUDE.md`, the shipped-features section of `HANDOFF.md`, and `analysis/FEATURE-a5.md` before testing. No production access, deployment, push, paid provider calls, or external writes. All crawler, Google/PSI, AI and CAPTCHA test boundaries used explicit fixture adapters; email used an injected sender or `EMAIL_FORCE_SINK=1`. Background GBP, social, content and Site Scan workers were disabled in the server. Only the a5 server was restarted.

## Outcome and validation

**Ten product defects fixed in separate commits**, each with regression coverage. One additional test-portability fix permits the GBP suites to run against local audit-lane databases instead of requiring lane a2; the local-host and development-database guard remains enforced.

- `CRM_TEST_SINGLE_PORT=true EMAIL_FORCE_SINK=1 GBP_SYNC_DISABLED=true SOCIAL_WORKER_DISABLED=true SITESCAN_WORKER_DISABLED=true npx vitest run`: **893 passed, 43 skipped; 89 passing files, 2 skipped files**. No new Site Scan skips. Final log: `/tmp/constructhub-a5-audit-vitest.log`.
- `npm run check`: **0 errors**, including after the final source change.
- Site Scan tests included in that run: **46 passed** across the unit and integration files.
- `E2E_PORT=8169 E2E_DB=constructhub_dev_a5 npx playwright test --config playwright.sitescan.config.ts --grep-invert 'signed-out'`: **5 passed** against the server with explicit dev bypass enabled.
- Restarted only the a5 server with `DEV_AUTH_BYPASS_USER1=false`; the same browser command with `--grep 'signed-out'` and that environment flag: **1 passed**. The signed-out test is intentionally run separately because the account test needs an authenticated server.
- Initial full-suite attempts exposed the two a2-only test guards and an early-start race before the restarted server listened. Both were resolved before the clean complete run; failures were not hidden by exclusions.

## Flow matrix

| Flow | How exercised | Result |
|---|---|---|
| Account start and progress | Browser submits URL/cap/PSI selection; actual API queues job; injected crawler processes it; browser polls queued → completed | PASS |
| Page caps and input validation | API rejects cap 501/private URL; fixture BFS caps and resumes saved queue | PASS |
| Daily account scan and AI request caps | Exhaust persistent counters; assert 429 and no AI provider invocation | PASS |
| Expired worker lease/recovery | Integration sets expired running lease; worker persists report and completion notification | PASS |
| Redirect aliases | Alias before and after final destination; assert one page per final URL and no false duplicate-title finding | FIXED `706df22` |
| Robots and crawl policy | Longest allow/disallow, agent-specific rules, blocked redirect, unavailable robots fail-closed, canonical HTTPS/www bootstrap | PASS |
| Sitemaps | Nested sitemap-index fixture discovers child sitemap; excluded URL never becomes a crawled page | PASS |
| Technical/content/local/AI/performance findings | HTML fixtures exercise all five categories, noindex/nofollow, mixed content, headings, alt text, schema, bot policy and GBP gaps | PASS |
| Contractor JSON-LD | RoofingContractor, Plumber, Electrician, HVACBusiness array, full-schema-URL GeneralContractor; missing name remains flagged | FIXED `1792c87` |
| Scoring and missing data | Assert null score without pages/PSI, measured PSI mean, and overall arithmetic across available categories | PASS |
| PageSpeed quotas | Exhaust user allowance, process job, assert zero provider calls, null performance, and no global quota reservation | FIXED `17c5dea` |
| History/trend | Browser opens saved history; mobile fixture exercises long URL; prior-same-URL delta formula reviewed in UI | PASS — delta arithmetic reviewed, not a separate browser assertion |
| Monthly enqueue and regression notification | Competing scheduler ticks enqueue once; next HTTP-failure report emits `sitescan.regressed` | PASS |
| Schedule cap/update | Nine existing schedules plus concurrent tenth/eleventh; update existing schedule at limit | FIXED `a75b8f5` |
| Disable rescan after disconnect | Existing schedule references unavailable profile; disabling removes it successfully | FIXED `e6ab11a` |
| GBP comparison provenance/ownership | Mock Google sync, capture snapshot, change local phone/services, assert scan profile still matches Google; foreign owner gets null; disconnect purges snapshot | FIXED `573b67e` |
| AI fix plan and copy | Injected plan provider, 65-page batching, API persistence; browser copy uses explicit fixture draft | PASS |
| PDF | Browser calls actual account PDF route and checks PDF bytes; separate standard-font Unicode round-trip | PASS for ordinary text; OPEN non-Latin font issue below |
| Share create/rotate/revoke/expiry | Actual DB-backed APIs; stored hash differs from token, old rotated link 404, revoked/expired link 404; browser opens read-only shared report | PASS |
| Owner isolation | Foreign job read, plan, share create/delete, PDF all denied; anonymous account methods denied | PASS |
| SSRF: address variants | Decimal, hex, octal/short loopback, private/link-local/CGNAT, mapped and transition IPv6, credentials, protocols, ports 22/8080/65535 | PASS |
| SSRF: DNS/redirects | Mixed public/private answers, pinned address, redirect to metadata/IPv6/integer loopback, robots-excluded redirect; transport never reaches denied destination | PASS |
| Public entry points | `/free-site-scan` form/summary; real signed-out `/site-scan` at 390px; account/admin APIs 401 with bypass off | PASS |
| Public lead capture/email limits | Injected email, real lead persistence, normalized email budget; summary bearer cannot read full report | PASS |
| Verification and expiry | Emailed token unlocks full report; invalid/expired token rejected; browser verified report polls queued → completed | PASS |
| Public summary honesty | Withheld categories no longer claim “No findings”; omitted coverage no longer claims zero remaining URLs | FIXED `d1e8b43` |
| CAPTCHA server behavior | Missing/invalid tokens and mocked provider outage; no lead email or scan quota consumed; valid fixture succeeds | FIXED `569355a` |
| CAPTCHA retry UI | Mock Google widget; submit disabled until solved; rejection resets widget/token; solving again permits retry | FIXED `28f6c8b` |
| Admin leads | DB-backed route returns captured fixture leads for admin, hides token hashes, rejects ordinary/anonymous accounts; configured-gate code uses shared admin gate | PASS |
| Mobile/accessibility basics | 390px viewport, label-based controls, heading/status/alert locators, history button bounds and draft/preformatted content widths | FIXED `b5fe8eb` — formerly a 2,410px history button hidden by overflow |
| Configurable completion/regression channels | Emission verified; registry and preferences route inspected | OPEN shared notification registry integration below |
| Full regression suite portability | Two GBP test suites no longer reject a5 solely because their fixture guard named a2 | FIXED `c0e1849` |

Additional audit coverage commits: `8bc89e0` (expiry, ownership, quotas, admin, adversarial URLs), `4b511ca` (verification polling and signed-out browser behavior).

## Ranked open issues

1. **P2 — Site Scan notification preferences are absent from the shared registry.** `server/sitescan/schema.ts:2` declares the kinds, but `server/account-events.ts:103` enumerates only `KIND_DEFAULTS` and line 108 rejects unknown preference keys. Repro: GET notification preferences and look for `sitescan.completed`/`sitescan.regressed`; neither is listed in this checkout. Worker emission works using fallback channels (in-app on, email off). **Open integration dependency:** the user explicitly assigned registry unification to audit lane a1; this lane did not duplicate that shared-registry change. Recheck after merging a1.
2. **P2 — PDF text outside the standard font's character set is corrupted.** `server/sitescan/routes.ts:237` constructs PDFKit with its standard font. Repro using that same setup: write `Fixture contractor: 屋根修理`, then run `pdftotext`; the Japanese portion becomes unrelated characters. Repro artifact: `/tmp/constructhub-a5-audit-unicode.pdf`. Ordinary PDF generation passes. **Open:** needs a bundled, licensed font and appropriate script/shaping coverage rather than a dependency on fonts installed only on this audit machine.
3. **P3 — Expiry revokes access but does not delete retained lead/report data.** `server/sitescan/schema.ts:29`, `server/sitescan/routes.ts:398` and `:419`. Repro: expire a lead as the integration test does; verification/status access stops, but the row still exists and remains visible to an authorized admin. **Open:** there is no retention deletion worker; choose a retention period and implement bounded cleanup for leads, reports and stale jobs. This is an existing disclosed lifecycle limitation, not a bearer-token bypass.

## Recommendations and handoff

- After the snapshot migration, **sync existing GBP profiles once** before requesting comparisons. The new nullable `gbp_sync_status.profile_snapshot` is added idempotently by `ensureGbpSchema()`. Old local fields cannot safely be backfilled as Google facts; scans correctly require a fresh sync instead. No provider access was used to backfill audit data.
- Add a verified-report resend/recovery flow for temporary email-delivery failures, with separate delivery-attempt limits. Current capture relies on the initial email reaching the recipient.
- Add an explicit schedule list with next-run time and a direct cancel control, so contractors can manage previously scheduled URLs without retyping them.
- Add trend tests with changed coverage and clear coverage comparisons; heuristic score changes can reflect changed crawl coverage rather than a site regression.
- Extend browser accessibility coverage with an automated audit and keyboard-only dialog/navigation checks. Current coverage verifies accessible labels, headings, status/alert roles and responsive containment, not accessibility certification.
- Keep the existing SSRF socket pinning, redirect revalidation, lease checks, quota ceilings and draft-only provider boundaries intact.

The final local server is running on **8169 with auth bypass disabled**, all external workers disabled, and email sink enabled. To rerun the full authenticated suite, restart that lane server with explicit dev bypass enabled and wait until it is listening before invoking Vitest. No production or other-lane process was changed.

LANE DONE a5
