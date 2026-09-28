# ConstructHUB growth-platform audit — lane a3

Audit date: 2026-09-28. Worktree `/home/veto/ConstructHUB-a3`; branch `lane/a3`; application port **8149**; database **constructhub_dev_a3**. Read `CLAUDE.md`, `HANDOFF.md`, the sidebar/App routes, and restored commits `19d15fd`, `7ba311a`, `22d63d6`.

## Outcome and verification boundaries

This is **not a clean bill of health** for the growth platform. The customer review path is substantially safer, but public-ad intelligence is not backed by ad data, tenant isolation is incomplete in older permit/ranking features, and GBP reviews/replies/performance are not integrated. Those are release blockers for the corresponding promises.

All application/API/browser work targeted 8149 and the lane database. No production deployment, SSH, push, live Stripe transaction, real email/SMS, or R2 write was performed. Emails were captured in `tmp/email-outbox.jsonl`. Test records are explicitly synthetic contractor/customer fixtures, never government reference records. Google redirects were inspected without following them. The original test suite unexpectedly contains child-server groups on 8199 and 8465; the initial baseline exercised that existing harness. Subsequent runs explicitly excluded those groups to honor the single-port boundary. No other lane's server was stopped.

Verification levels below distinguish rendering, local CRUD, negative/configuration checks, and actual provider integration. A page rendering successfully does **not** establish that its external service works. Credential-dependent integrations are marked NOT-TESTABLE; code-confirmed defects are BROKEN-open even where their page rendered.

- Node 20.19.6; `npm run check`: zero errors after changes. `npm run build`: passed (existing large-chunk warning).
- Baseline: 507 passed, 1 failed (stale SMS response wording). Fixed the assertion in `5a876dc`; no SMS behavior changed.
- Latest restricted-lane Vitest run: **501 passed, 32 skipped (533 total)**. Command: `CRM_TEST_BASE_URL=http://127.0.0.1:8149 npm test -- -t '^(?!.*(configured admin gate|HOVER integration)).*$'`. **32 tests excluded**, not passed: configured-admin child-server and HOVER stub integration groups. This is not an unqualified full-suite pass.
- Review Playwright: **23 passed**, with bypass disabled and `/api/auth/me === null`: every integer rating 1–10 at 1440px and 375px, unsubscribe at both widths, and an injected failed-feedback response. Command: `E2E_PORT=8149 E2E_DB=constructhub_dev_a3 npx playwright test --config playwright.growth.config.ts`.
- Route sweep: 36 routes through Playwright, followed by signed-in and genuinely anonymous sweeps; no uncaught JS error in the initial sweep. Real login used for APIs that do not honor the local bypass.
- Additional UI interactions: email login, review request creation, trash, profile-review filter, competitor market/ad forms, and GBP connect empty state. API requests used both curl and fetch.
- Local artifacts (ignored, not committed): `analysis/a3-*-evidence.json`, `analysis/a3-ui-*.json`, validation logs, and `test-results/review-anonymous-{375,1440}.png`. Only sanitized findings and source inventories belong in this report.

## Fixes

| Commit | Change | Regression evidence |
|---|---|---|
| `5a876dc` | Align existing SMS STOP test with the current “resubscribe” response | Existing STOP/START integration test; no real SMS |
| `b717c85` | Trashed/unsubscribed requests excluded from reminder and scheduled queues; manual resend cannot undo unsubscribe | Two storage integration tests, including restore; actual unsubscribe→resend returns 409 |
| `8db67ba` | Unconditional Google link before rating and through the review flow; low ratings get draft assistance; neutral customer-fact-only prompt; integer rating validation; failed HTTP requests do not advance; remove stale low-rating-only privacy copy; anonymous dev routing follows actual session | Five draft-prompt cases; 23 logged-out browser tests |
| `0c7eb2c` | Mocked Stripe tests for forged prices/names/quantity, database module pricing, SEO contract requirement, plan prices, raw webhook signature verification | Seven mocked Stripe tests, no external Stripe calls |
| `40e853b` | Bind Google OAuth to browser session with state | Both basic login and GBP consent redirects carry state; wrong-state callbacks rejected before token exchange |
| `c486936` | Redact bearer paths in analytics page/referrer values | Shared redaction tests and actual analytics ingestion assertions |

Historical analytics rows were not rewritten; the owner should redact previously stored bearer paths before further export or sharing.

## Feature matrix

The exhaustive literal page/API-reference mapping and method-level server route inventory are appended below. `:id`, `:token`, and subroutes in this table refer to that inventory; “local” explicitly excludes Google/R2/Stripe provider execution.

| Feature | Page/route | API | How verified | Status |
|---|---|---|---|---|
| Public home and marketing navigation | `/`, `/landing` | Auth, shared cart, site assistant | Anonymous and signed-in browser sweeps; home after logout | PASS (render/navigation only) |
| Pricing, individual tools, cart display | `/pricing`, `/individual-pricing` | `/api/stripe/plans`, `/api/stripe/subscription`; checkout APIs | Browser render; catalog API; forged-item curl rejection; mocked price tests | PASS (catalog logic); actual payment NOT-TESTABLE needs `sk_test` |
| Per-tool landings | `/permits-landing`, `/google-ads-landing`, `/competitors-landing`, `/master-class-landing`, `/google-business` | Shared auth/cart; links to tools | Browser render; source/copy inspection | BROKEN-open: unsupported competitor/market claims below |
| Legal pages | `/privacy`, `/terms`, `/crm-privacy`, `/crm-terms` | None directly | Growth legal pages rendered; source navigation reviewed | PASS (render; legal adequacy not assessed) |
| Email signup and verification | `/auth` | `/api/auth/signup`, `verify-email`, `resend-verification` | Created dedicated local account; unverified login 403; verification 302; sink email; verified login 200 | PASS (signup/verification; resend source-reviewed) |
| Login/session/logout/reset | `/auth`, `/settings` | `/api/auth/login`, `me`, `logout`, `forgot-password`, `reset-password` | Browser login; logout returns anonymous; reset succeeds, replay 400; sink email | PASS (tested paths); session revocation concern below |
| Google login and GBP consent | `/auth`, location import | `/api/auth/google[?gbp=1]`, callback | Inspect Google redirect; state regression; invalid callback rejected | FIXED `40e853b`; completed Google consent NOT-TESTABLE needs owner account |
| 2FA and profile/password settings | `/settings`, auth 2FA | `/api/auth/profile`, `change-password`, `2fa/*` | Real setup→TOTP verify→logout→password challenge→TOTP login→disable; profile and password update APIs; settings rendered | PASS (local API flow) |
| Subscription and billing portal | `/pricing` | `/api/stripe/create-checkout`, `create-portal`, subscription | Subscription read; mocked catalog; disabled Stripe code path | NOT-TESTABLE needs `sk_test` key |
| Course/service checkout and SEO contract | `/master-class`, pricing, `/contract/sign/:token` | Course/cart checkout; `/api/contracts/*` | Catalog/contract-required mocked tests; real local synthetic contract create/read/sign/list and sink email | PASS local contract flow; payment NOT-TESTABLE needs `sk_test` |
| Permit search/live progress/details | `/search` | `/api/search`, `/api/search/live/:searchId`, `/api/permit-details/:resultId` | Browser search surface; isolated no-database-match search→progress/results→history delete; read detail code | BROKEN-open shared history/auth; live government scraping not exercised in this lane |
| Database directory | `/databases` | Counties, databases, counts, county-specific lookup | Curl unfiltered + FL filtered pagination; browser directory | PASS (directory functionality; data correctness owned by a4) |
| Property search/appraisers | `/property` | `/api/property-appraisers`, county lookup, property lookup/records | Browser; appraiser list API; code path | PASS (directory render); live record lookup NOT-TESTABLE not exercised |
| Search history | `/history` | Search queries/results/recent, delete routes | Browser; API reads; ownership code review | BROKEN-open shared unowned history |
| Scrape schedules/jobs | `/schedules` | `/api/scrape-schedules/*`, `/api/scrape*` | Browser; list + create disabled schedule→edit frequency→delete; source inspection | BROKEN-open anonymous/global schedule mutation; background execution not certified |
| Location CRUD/import/citations | `/locations` | `/api/locations/*`, `/api/gbp/*`, `/api/citations/*` | Local create/read/edit/delete + empty analytics; browser GBP-connect prompt; citation list | PASS local CRUD; provider import/citation run NOT-TESTABLE credentials/network not exercised |
| GBP location performance/management | Location detail tabs | `/api/locations/:id/analytics`, `/analytics/seed`, update location | Read aggregate response and all writers; demo generation code | BROKEN-open random demo metrics, no real performance fetch or outbound GBP updates |
| GMB Edit Monitor | `/gmb-monitor` | `/api/gmb/listings/*`, review-response | Local listing create/history/toggle/delete; browser; Places check implementation | PASS local CRUD; live monitoring/reply drafting NOT-TESTABLE needs provider credentials |
| Ranking grid | `/ranking-grid` | `/api/ranking-grid/*` | Browser and scan list; auth/storage/map source review | BROKEN-open cross-user scan access/deletion; live ranking NOT-TESTABLE |
| Photo processor/download | `/photos` | Upload, process, job status, download, archive; business lookup/AI helpers | Real PNG upload→Sharp process→download via curl; browser | PASS local transform; AI/business lookup NOT-TESTABLE |
| Media library | `/media-library` | `/api/media/*` | Folder create/rename/list-photos/delete; browser | PASS folder CRUD; R2 photo operations NOT-TESTABLE isolated bucket not configured |
| R2/logo/review-photo upload and proxy | Settings/reviews/media | `/api/upload/*`, `/api/files/*` | Source review; no writes to shared storage | NOT-TESTABLE isolated R2 bucket/endpoint required |
| Competitor market scans | `/competitors` | `/api/competitors/scans/*` | Signed-in UI market form + list; search/scoring code read | BROKEN-open radius and upstream-failure handling; live scan NOT-TESTABLE |
| BS Meter | Competitor scan detail | Stored `competitor_listings` analysis from scan | Algorithm and public claims inspected | BROKEN-open unsupported fraud inferences; requires redesign/validation |
| Public Ad Activity | Competitor Ad Activity tab | `/api/ad-spy/keywords/*` | UI tab/form/list; provider writer traced | BROKEN-open Google Places results falsely represented as ad observations |
| Review sender, templates, trash | `/google-reviews`, `/settings` | `/api/reviews/*`, `/api/review-templates/*` | Actual sink send via API and UI; template create/edit; delete/restore; UI trash | FIXED `b717c85` suppression; PASS local CRUD (permanent purge source-reviewed) |
| Review reminders/scheduled delivery | Review reminder settings | `/api/review-reminder-settings`; queue workers | Read settings; unit/integration queue eligibility tests; sink email implementation | FIXED `b717c85`; BROKEN-open timezone/settings validation and recipient-wide suppression |
| Customer feedback/Google option | `/review/:token` | Public review lookup, feedback, draft, mark, tracking | Real logged-out 1–10 flow desktop and 375px; failed response test; no Google tab followed | FIXED `8db67ba`; live AI NOT-TESTABLE dummy key |
| Customer unsubscribe | `/review/:token/unsubscribe` | Public unsubscribe info/action | Desktop + 375px; verify persisted opt-out; manual resend 409 | FIXED `b717c85`, `8db67ba`; cookie banner UX remains |
| Google profile reviews/replies/notes | `/google-reviews` Profile Reviews | `/api/google-profile-reviews/*` | Browser filter; API list; write/read code inspection | BROKEN-open local records and replies only, no Google sync/publish |
| Google Ads/Click Guard | `/google-ads` | `/api/click-guard/*` | Domain CRUD; local synthetic visit ingestion/read; analytics/blocks/visitors/pages/geo/platforms/online reads; generated Ads script | PASS local management; BROKEN-open tracking/claim issues below |
| Google Ads guide/ad-fraud guide | `/google-ads-guide`, section route, `/google-ad-fraud` | Shared cart/chat | Browser parent plus all 12 section routes without JS errors | PASS render |
| Ads consultant | Floating ads chat | `/api/ads-consultant/chat` | Input validation curl 400; UI shell and prompt review | NOT-TESTABLE actual chat needs OpenAI key; BROKEN-open abuse controls |
| LSA guide | `/lsa-guide` | Shared auth/cart | Browser and source | PASS render |
| LSA leads/OAuth | `/lsa-leads` | `/api/lsa/status`, accounts, leads, OAuth, sync/disputes/Telegram | Status/accounts/leads reads; OAuth missing-config 400; code review | NOT-TESTABLE Google Ads credentials, account and Telegram/dispute provider flows |
| LSA account manager | `/lsa-account-manager` | `/api/admin/lsa/*` | Browser Access Denied and API 403 as non-admin; code review | PASS negative authorization; live manager actions NOT-TESTABLE credentials |
| IP Tracker and embed | `/ip-tracker` | Click Guard analytics and script endpoints | Domain CRUD/read endpoints and script fetch; source | BROKEN-open cross-IP fingerprint test impossible; hardcoded live script origin |
| VPN Shield | `/vpn-shield` | `/api/vpn-shield/*` | Browser; stats/blocked/script reads, local settings save; synthetic signal POST returns blocked and persists; detection source | BROKEN-open claims exceed client-side heuristic enforcement; embed not executed against live origin |
| Master Class/state guides | `/master-class`, landing | Modules, purchases, `/api/state-guides/*` | Browser; modules/guides/purchases reads; entitlement source review | PASS render/catalog; full paid curriculum/entitlements not certified |
| Reinstatement / SEO inquiry | `/reinstatement`, pricing dialogs | `/api/reinstatement/request`, `/api/seo-inquiry` | Browser forms; actual local API submissions return 200 and sink emails | PASS request submission; external reinstatement/service delivery outside application test scope |
| Site assistant | Public home chat | `/api/site-assistant/chat` | Empty-input curl 400; knowledge/rate gate reviewed | BROKEN-open ineffective abuse control/test CAPTCHA; actual AI NOT-TESTABLE |
| Admin/beta codes/analytics | `/admin?portal=1`, settings/admin actions | `/api/admin/*`, `/api/beta-codes/*`, `/api/analytics/*` | Non-admin API denial; analytics consent tests; existing admin/beta tests; growth `/admin` 404 is host routing | PASS negative authorization; configured gate NOT-TESTABLE single-port restriction; analytics FIXED `c486936` |

## Open issues, ranked

### P1 — high

1. **Public Ad Activity invents ad observations from ordinary Google Places listings.** `server/routes.ts:2092` (`runAdSpyScan`) calls Places textsearch/details, not any ad source, then constructs `adHeadline` from business name + keyword + location and calls the listing rank an ad position. Device is merely copied from the request. Repro: add a keyword and refresh with a working Places key; inspect `ad_spy_results` and compare the writer—no ad auction/campaign was observed. UI promises actual ads at `client/src/pages/competitors-landing.tsx:185`. Requires a real ad data source and product decision; do not use these records as ad intelligence.

2. **Ranking scans lack per-user ownership.** `server/routes.ts:1726`, `1730`, `1740`, `1798`; schema/storage has no scan owner. Repro: account A creates a scan, account B lists/reads/deletes its ID. Authentication is present but every authenticated user shares the dataset. Requires owner-column migration/backfill and all queries/map routes scoped consistently.

3. **Permit search history and schedules are globally readable/mutable without authentication.** `server/routes.ts:192`, `364`, `369`, `376`, `392`, `397`, `406`, `415`. Repro logged out: GET `/api/search-queries` or `/api/scrape-schedules`; DELETE a known lane schedule/query ID succeeds without an owner check. History contains contractors' search terms. Requires a tenant/ownership design and migration, not just hiding pages. No government reference data was modified during this audit.

4. **Live-looking location metrics can be overwritten with random demo data.** `server/routes.ts:3113`; UI `client/src/pages/locations.tsx:573`, `664`. Repro: location → analytics → Seed Demo Data; endpoint deletes existing `location_analytics` and inserts 60 random days, also overwriting ratings/review counts. It is not restricted to a disposable demo environment. Keep demo data in a separate explicit demo store; no real GBP performance ingestion currently exists.

5. **“Google review reply” is only a local database update.** `server/routes.ts:5254`; `client/src/pages/google-reviews.tsx:1835`, `2240`. Repro: use a manually inserted profile-review row and submit a reply; API returns 200 and UI shows the reply, but the route only updates `google_profile_reviews`. No Google reply call exists. Empty state still says API approval is pending at page line 2075. Do not imply publication until the integration described below exists.

6. **Public AI/photo paths lack robust authorization, limits and cost controls.** `server/routes.ts:480`, `854`, `1615`; `server/ads-consultant.ts:168`; `server/site-assistant.ts:227`. Photo upload accepts up to 50×100MB and unbounded jobs; AI routes can be called without a paid account. Site-chat's “three messages” check trusts each submitted conversation array and uses a documented test CAPTCHA secret. Repro: repeatedly send a one-message history; the client-controlled count never trips the gate. Requires server-side per-user/IP budgets, payload limits and a real verification configuration before real provider keys are enabled.

### P2 — medium

7. **Competitor radius and success states are misleading.** `client/src/pages/competitors.tsx:114` sends industry/location/radius without coordinates; `server/routes.ts:2150` only uses radius when both lat/lon exist. Textsearch rejection JSON is not checked before marking the scan completed at line 2200. Repro: select different radii for the same UI search; request lacks lat/lon. A denied key produces completed/zero rather than a failed scan. Needs geocoding/geographic filtering and explicit provider-status handling.

8. **BS Meter presents weak heuristics as fraud evidence.** `server/routes.ts:2279`, `2336`, `2361`, `2447`; `client/src/pages/competitors-landing.tsx:175`, `542`. Reviewer-name shape, absent profile links/photos, generic wording and a tiny Places sample trigger “likely hired reviewers”/AI claims. Total lifetime review count is divided by the oldest *sampled* relative date. Repro: inspect an otherwise legitimate listing with high rating or sample reviews lacking `/reviews` author URLs; its score increases without verification. Label uncertainty and sample limits; remove definitive fraud accusations until independently validated.

9. **Review completion is claimed from opening Google, not submitting a review.** `server/routes.ts:5438`; `client/src/pages/review-feedback.tsx` `handleGoogleClick`/`markReviewedMutation`; dashboard `google-reviews.tsx:428`. Repro: submit rating, use the older step-specific Google action, close Google without posting; local record becomes `reviewed`. The new always-available anchor does not falsely mark completion. Requires separate “Google link opened” vs externally verified review states; Google cannot generally confirm an email-recipient identity from a review.

10. **Reminder timezone is ignored; validation is incomplete.** `server/routes.ts` `calculateNextReminderTime` hardcodes UTC hour +5 and does not use stored `timezone`; `PUT /api/review-reminder-settings` accepts arbitrary windows/timezone and replaces numeric 0 by defaults. Repro: save a Pacific timezone or an empty window list, schedule a reminder; timing is wrong or indexing a missing window throws. Current worker also hardcodes production link base rather than canonical lane/app origin. Needs validated settings and timezone/DST-aware calculation.

11. **Unsubscribe is request-specific, not recipient-wide.** `server/routes.ts:4944`, `5748`, schema `review_requests.unsubscribed`. The fixed resend route respects that request's opt-out, but creating another request for the same email starts a new subscription state. Repro: unsubscribe token A, create token B for the same recipient/company; B is sent. Decide and implement recipient/company suppression with an explicit resubscribe policy.

12. **Tracking embeds use a hardcoded production origin and weak signals.** `server/tracking-script.ts:6`; `server/routes.ts:4576`, `4593`, `3507`, `4377`. Repro fetch either generated script on 8149: it still posts to `https://constructhub.us`; therefore it was not installed/executed during this audit. Click Guard cross-IP fingerprint detection filters a list already restricted to the current IP, so the “different IP” branch cannot match. VPN Shield trusts client signals/user-agent and runs after page content arrives; it cannot prevent a non-JS fetch or reliably identify all VPNs. Requires truthful claims, configurable origin, and an enforcement/product decision.

13. **Password reset does not revoke existing sessions; auth abuse controls need review.** `server/auth.ts:493` only changes hash/reset fields; stored sessions stay valid. Signup/login/forgot-password lack the limiter used by CRM endpoints. Repro: establish session A, reset via session B, request `/api/auth/me` with A. Needs session invalidation and carefully scoped rate limits.

14. **OAuth token presence is mistaken for GBP authorization.** `server/auth.ts:142`, `546`; `server/routes.ts:2569`. Basic profile/email login also saves Google access tokens; `hasGbpAccess` checks token presence, with no persisted granted scopes. A later basic login can overwrite the GBP access token while retaining an old refresh token. Repro basic Google login → locations import UI believes access exists → GBP 401/403. Requires scope/account-aware token storage, not API approval alone.

15. **Contractor quotas and entitlement presentation are inconsistent.** `requirePlatinum` allows Gold and Platinum; competitor UI says exclusively Platinum and uses a dev-only visual bypass. Many paid feature limits in `PLANS` are not checked at mutation endpoints (e.g. photo processor); ranking trial count is global. Repro compare plan catalog limits with POST `/api/photos/process` and competitor Gold UI. Needs a single server entitlement/quota layer.

### P3 — lower / UX

16. **Cookie banner obscures mobile unsubscribe action.** `client/src/components/cookie-consent.tsx:87`; `review-unsubscribe.tsx:239`. Repro clean anonymous 375×900 browser on unsubscribe: fixed banner intercepts the bottom action. Dismiss Decline/Accept to continue (tested). Provide space for the banner or a layout that never covers withdrawal controls.

17. **Restored copy still overclaims surveillance/fraud abilities.** `server/site-assistant.ts:161` says “Ad spy”; competitor landing hero says “Know Everything,” line 222 says “Know their strategy before they know yours,” line 175 says it identifies who is buying reviews. Master Class line 1063 still values a 5-star review against disputed work despite the following explicit no-incentive rule. No Yelp solicitation remains in the customer review page; dashboard Yelp links are business-management links. Hardcoded 3% referral offer is separate from reviews but not configurable per contractor. Owner should approve that offer and soften unsubstantiated copy.

18. **Development auth parity is incomplete.** `server/auth.ts:518` supplies bypass user to `/me`, while review/settings handlers require a real Passport session. Repro with bypass on: `/api/auth/me` describes user 1; `/api/reviews/list` is 401. Audit used a real session. Centralize the explicitly gated test-auth adapter without changing production behavior.

## GBP API integration map — map only, no integration built

Project approval is supplied by the owner/HANDOFF: `construction-hub-489119`, project `90021415768`. Cloud API enablement and actual project quota were **not independently queried**. Approval does not establish working OAuth grants or data synchronization.

| Capability | Current UI/local endpoint | Current implementation and tables | Missing to go live |
|---|---|---|---|
| Consent and identity | Auth Google link; locations Import from GBP; `/api/auth/google?gbp=1` | `server/auth.ts`: profile/email plus `https://www.googleapis.com/auth/business.manage`; offline access + consent prompt. Callback stores `users.google_access_token`, `google_refresh_token`, `google_token_expiry`. Refresh via `https://oauth2.googleapis.com/token` in `getGbpAccessToken` | Enable project APIs/consent configuration; real owner grant/callback verification; store actual scopes/account binding; revoke/disconnect and secure token lifecycle. State now fixed |
| Accounts | `GET /api/gbp/accounts` | `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`, bearer token; maps name/accountName/type/role | Pagination; distinguish permission/quota/disabled-API failures from expired auth; retries/rate budgets |
| Locations | `/locations` import dialog; `GET /api/gbp/locations` | Lists accounts, then `GET https://mybusinessbusinessinformation.googleapis.com/v1/{account.name}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,metadata`; maps `gbpName`, address, placeId, mapsUri | Both account/location pagination; per-account errors currently swallowed and returned as success/empty; persist canonical account+location resource names |
| Import/local location edits | `POST /api/gbp/import`; `/api/locations` GET/POST/PUT/DELETE | Inserts into `business_locations`, deduplicates by user+business name, copies client-submitted fields. `gbpName` and account resource ID are discarded. `gbpManagementEnabled` is a local boolean | Authoritative import validation; durable resource IDs/uniqueness; updates need Business Information API PATCH with updateMask and explicit confirmation/error state. No outbound profile write exists |
| Reviews sync | `/google-reviews` Profile Reviews tab; `GET/POST /api/google-profile-reviews` | Local table only: userId/locationId/templateId/googleReviewId/reviewer fields/rating/comment/dates/reply/note. Manual POST does not import Google review identity. No sync endpoint/job or Google fetch | Paginated `GET https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`; resource mapping, unique Google identity/upsert, updated/deleted handling, sync status and retry strategy. [Google review data guide](https://developers.google.com/my-business/content/review-data) |
| Owner replies | `PATCH /api/google-profile-reviews/:id/reply`; Reply/Delete reply buttons | Updates local `reply_comment`, `reply_date`, `updated_at`; no Google request; note/delete local routes likewise local | `PUT .../v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply`, DELETE that reply resource; only mark published after confirmed provider success. [Google review resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews) |
| Performance | Location analytics tab; `GET /api/locations/:id/analytics`, POST seed | Aggregates `location_analytics` daily search/maps/mobile/desktop/site/directions/calls/messaging; no upstream collector; only writer is random demo seeding and local location aggregate edits | Real `GET https://businessprofileperformance.googleapis.com/v1/locations/{id}:fetchMultiDailyMetricsTimeSeries`; supported metric mapping, dates/timezones, uniqueness, incremental backfill, unavailable-vs-zero states. [Google performance reference](https://developers.google.com/my-business/reference/performance/rest) |
| Monitoring/change history | `/gmb-monitor`; `/api/gmb/listings/:id/check`, history, toggle | `gmb_listings`, `gmb_edit_history`; uses public Places details API, compares snapshots. AI review-response drafts through OpenAI only | GBP-authorized change data/polling, actual notification delivery and last successful check. Current flag does not itself create a GBP monitoring integration |
| Ranking/competitors | `/ranking-grid`, `/competitors` | Places nearby/textsearch/details/static map; `ranking_grid_scans/results`, `competitor_scans/listings`; unrelated to GBP business.manage | GBP approval does not provide competitor ads or complete third-party reviews. Real ad source and valid scoring/radius behavior are separate projects |
| Photo/media | `/photos`, `/media-library`, review attachments | Sharp/local processing and R2 `media_folders/media_photos`; customer emails link to files | No Google media publication endpoint. If product wants GBP media publishing, design an explicit owner-authorized publish flow; R2 storage alone does not publish to GBP |
| Review requests | Sender/templates/reminders and public token pages | `review_requests`, `review_templates`, `review_reminder_settings`; sink/SMTP email, token feedback and external Google link | Works independently of GBP access; no guaranteed recipient↔Google reviewer identity matching. Keep independent feedback and public-review choices |
| Ads/LSA | `/lsa-leads`, manager, Google Ads pages | Separate `https://www.googleapis.com/auth/adwords` OAuth; `lsa_connections`, accounts/leads/disputes; manager tables. API scope is not business.manage | Separate Google Ads app credentials/developer token and customer/MCC access; GBP approval does not unlock these |

Go-live sequence: owner enables the relevant APIs and confirms consent screen/callbacks; persist resource identity and scope-aware grants; implement paginated read-only location/review sync; implement explicit reply publishing; ingest real performance metrics; add quota/retry/error visibility and credentialed staging tests. Do not turn local replies/demo metrics into “live” claims while this is incomplete.

## Recommended improvements (ranked impact vs effort)

1. **High impact / large effort:** enforce per-user ownership in ranking, permit searches and schedules, including data migration and two-account isolation tests.
2. **High / medium-large:** replace fake ad activity with a real sourced provider or withdraw that product claim; give BS Meter uncertainty and provenance, not accusations.
3. **High / medium-large:** build GBP integration in the sequence above; expose connected scopes, last successful sync and provider errors. Label local notes/draft replies clearly.
4. **High / medium:** centralize entitlements, API budgets and upload limits; apply real server-side abuse controls before enabling paid AI providers.
5. **High / medium:** preserve true metric provenance; isolate demo data and distinguish unavailable data from zero. Add a real location-sync status panel.
6. **Medium-high / medium:** recipient/company unsubscribe suppression, validated timezone-aware reminders, idempotent outbox delivery, SMTP retry state and cancellation semantics.
7. **Medium / small:** simplify the review funnel: direct Google action plus optional private feedback; move referral marketing to a separate owner-configured feature. Make unsubscribe one direct action and keep it clear of cookie banners.
8. **Medium / medium:** honest funnel analytics (“email fetched,” “link opened,” “feedback submitted”) rather than treating tracking pixels or Google clicks as proof of human reading/posting.
9. **Medium / medium:** contractor-expected operational features: exportable permit leads, saved searches with actual scheduled status/errors, bulk location/review handling, per-location permissions, provider reconnect notices and audit trails for outbound changes.
10. **Medium / small-medium:** paginate queries at the database (profile reviews currently load all then filter); avoid downloading all 32,965 database rows when the filtered endpoint suffices; bound analytics date ranges.
11. **Medium / small:** remove stale API-approval copy, hardcoded live origins, outdated footer year, unsupported success statistics and surveillance wording; keep labels consistent across plan/marketing/backend.
12. **Medium / medium:** make the test harness lane-aware for every child server and provider stub so an unfiltered `npm test` cannot bind another lane's ports; retire dev-only UI entitlement bypasses and test actual sessions.

## Additional inventory notes

The following tables are a code-derived inventory, not additional runtime PASS claims. API-like query-cache keys (for example `/api/databases/county-state`) are included and may have a custom query function using a different URL. Dynamic query-key arrays join path segments; the server method list is the authoritative route list. The UI also emits a `/api/click-guard/pixel/:trackingId` noscript URL at `client/src/pages/google-ads.tsx:1550`, but no server route implements it; this is an additional broken fallback, not a verified tracker. Provider-dependent operations were left unexecuted where an isolated credential/bucket or real owner consent is required; these limits should be addressed before claiming complete end-to-end feature certification.

### Page and shared-component API references

| Source | API references |
|---|---|
| `client/src/components/ads-consultant-chat.tsx` | `/api/ads-consultant/chat` |
| `client/src/components/app-sidebar.tsx` | `/api/auth/logout`; `/api/auth/me`; `/api/counties`; `/api/databases/counts` |
| `client/src/components/cart-sheet.tsx` | `/api/auth/me`; `/api/contracts/create`; `/api/stripe/create-cart-checkout` |
| `client/src/components/cookie-consent.tsx` | `/api/analytics/consent`; `/api/analytics/events` |
| `client/src/components/doc-gate.tsx` | `/api/public/verify-access` |
| `client/src/components/engagement-tracker.tsx` | `/api/public/engagement/ping`; `/api/public/engagement/start` |
| `client/src/components/portal-messages.tsx` | `/api/client/comments`; `/api/client/comments?customerId=${customerId}`; `/api/client/team`; `/api/client/team?customerId=${customerId}` |
| `client/src/components/site-assistant-chat.tsx` | `/api/site-assistant/chat` |
| `client/src/pages/auth.tsx` | `/api/auth/forgot-password`; `/api/auth/google`; `/api/auth/google?beta=${encodeURIComponent(betaParam`; `/api/auth/google?next=${encodeURIComponent(nextParam`; `/api/auth/login`; `/api/auth/logout`; `/api/auth/me`; `/api/auth/resend-verification`; `/api/auth/reset-password`; `/api/auth/signup` |
| `client/src/pages/competitors-landing.tsx` | `/api/auth/me` |
| `client/src/pages/competitors.tsx` | `/api/ad-spy/keywords`; `/api/ad-spy/keywords/${id}`; `/api/ad-spy/keywords/${id}/refresh`; `/api/competitors/scans`; `/api/competitors/scans/${scanId}`; `/api/stripe/subscription` |
| `client/src/pages/contract-sign.tsx` | `/api/contracts`; `/api/contracts/${token}`; `/api/contracts/${token}/checkout`; `/api/contracts/${token}/sign` |
| `client/src/pages/crm-admin.tsx` | `/api/admin/*`; `/api/admin/analytics`; `/api/admin/beta-invites`; `/api/admin/beta-invites/${id}`; `/api/admin/gate`; `/api/admin/orgs`; `/api/admin/overview`; `/api/admin/users`; `/api/crm/me` |
| `client/src/pages/databases.tsx` | `/api/counties`; `/api/databases`; `/api/databases/counts`; `/api/databases?${queryParams}`; `/api/scrape`; `/api/scrape/status/${jobId}` |
| `client/src/pages/gmb-monitor.tsx` | `/api/gmb/listings`; `/api/gmb/listings/${listing.id}`; `/api/gmb/listings/${listing.id}/check`; `/api/gmb/review-response`; `/api/photos/business-search` |
| `client/src/pages/google-ad-fraud.tsx` | No direct API; static content/shared components |
| `client/src/pages/google-ads-guide-section.tsx` | No direct API; static content/shared components |
| `client/src/pages/google-ads-guide.tsx` | `/api/auth/me`; `/api/course-purchases` |
| `client/src/pages/google-ads-landing.tsx` | `/api/auth/me` |
| `client/src/pages/google-ads.tsx` | `/api/click-guard/domains`; `/api/click-guard/domains/${domain.id}/settings`; `/api/click-guard/domains/${domainId}/analytics?start=${dateStart}&end=${dateEnd}`; `/api/click-guard/domains/${domainId}/block`; `/api/click-guard/domains/${domainId}/block/${blockId}`; `/api/click-guard/domains/${domainId}/visits?start=${dateStart}&end=${dateEnd}`; `/api/click-guard/domains/${id}`; `/api/click-guard/pixel/${domain.trackingId}`; `/api/click-guard/script/${domain.trackingId}`; `/api/click-guard/script/${selectedDomain.trackingId}`; `/api/click-guard/script/${trackingId}` |
| `client/src/pages/google-business.tsx` | `/api/auth/me` |
| `client/src/pages/google-reviews.tsx` | `/api/auth/me`; `/api/google-profile-reviews`; `/api/google-profile-reviews${qs`; `/api/google-profile-reviews/${id}`; `/api/google-profile-reviews/${id}/note`; `/api/google-profile-reviews/${id}/reply`; `/api/locations`; `/api/media/folders`; `/api/media/folders/${folderId}/photos`; `/api/review-reminder-settings`; `/api/review-templates`; `/api/review-templates/${editingTemplate.id}`; `/api/review-templates/${id}`; `/api/reviews/${id}`; `/api/reviews/${id}/permanent`; `/api/reviews/${id}/resend`; `/api/reviews/${id}/restore`; `/api/reviews/create`; `/api/reviews/list`; `/api/reviews/trash`; `/api/stripe/subscription`; `/api/upload/review-photos` |
| `client/src/pages/history.tsx` | `/api/search-queries`; `/api/search-queries/${id}` |
| `client/src/pages/home.tsx` | No direct API; static content/shared components |
| `client/src/pages/individual-pricing.tsx` | No direct API; static content/shared components |
| `client/src/pages/ip-tracker.tsx` | `/api/click-guard/domains` |
| `client/src/pages/landing.tsx` | `/api/auth/me` |
| `client/src/pages/locations.tsx` | `/api/auth/google?gbp=1`; `/api/citations/campaigns`; `/api/citations/campaigns/${campaign.id}/run`; `/api/citations/campaigns/${id}`; `/api/gbp/import`; `/api/gbp/locations`; `/api/locations`; `/api/locations/${location.id}`; `/api/locations/${location.id}/analytics/seed`; `/api/locations/${location.id}/import-google`; `/api/locations/search-google`; `/api/stripe/subscription` |
| `client/src/pages/lsa-account-manager.tsx` | `/api/admin/lsa/accounts`; `/api/admin/lsa/accounts/${accountId}`; `/api/admin/lsa/accounts/${accountId}/campaigns`; `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/budget`; `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/settings`; `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/status`; `/api/admin/lsa/accounts/${accountId}/sync-leads`; `/api/admin/lsa/accounts?limit=${pageSize}&offset=${page`; `/api/admin/lsa/audit-log`; `/api/admin/lsa/invitations`; `/api/admin/lsa/invitations/${id}`; `/api/admin/lsa/leads/${leadId}/dispute`; `/api/admin/lsa/manager`; `/api/admin/lsa/manager/connect`; `/api/admin/lsa/manager/disconnect`; `/api/admin/lsa/manager/sync-accounts`; `/api/auth/me` |
| `client/src/pages/lsa-guide.tsx` | No direct API; static content/shared components |
| `client/src/pages/lsa-leads.tsx` | `/api/lsa/accounts`; `/api/lsa/accounts?q=${encodeURIComponent(debouncedQ`; `/api/lsa/disconnect`; `/api/lsa/disputes`; `/api/lsa/disputes/schedule`; `/api/lsa/leads`; `/api/lsa/leads/${lead.leadId}/good`; `/api/lsa/leads?customerId=${account.customerId}&filter=${filter}&page=${page}&pageSize=${pageSize}`; `/api/lsa/oauth/start`; `/api/lsa/status`; `/api/lsa/sync`; `/api/lsa/telegram/link`; `/api/lsa/telegram/unlink` |
| `client/src/pages/master-class-landing.tsx` | `/api/auth/me` |
| `client/src/pages/master-class.tsx` | `/api/course-purchases`; `/api/master-class-modules`; `/api/seo-inquiry`; `/api/state-guides`; `/api/stripe/create-course-checkout` |
| `client/src/pages/media-library.tsx` | `/api/media/folders`; `/api/media/folders/${editingFolder.id}`; `/api/media/folders/${folderId}`; `/api/media/folders/${folderId}/photos`; `/api/media/geocode`; `/api/media/photos/${id}`; `/api/media/photos/${photoId}`; `/api/media/photos/${photoId}/rename`; `/api/media/upload` |
| `client/src/pages/permits-landing.tsx` | `/api/auth/me` |
| `client/src/pages/photos.tsx` | `/api/locations`; `/api/media/folders`; `/api/media/geocode`; `/api/media/save-processed`; `/api/photos/auto-enhance`; `/api/photos/business-details`; `/api/photos/business-search`; `/api/photos/download-all/${token}`; `/api/photos/download-all/prepare`; `/api/photos/download/${processedId}`; `/api/photos/generate-description`; `/api/photos/nearby-cities`; `/api/photos/process`; `/api/photos/process/${jobId}`; `/api/photos/upload`; `/api/photos/upload-watermark` |
| `client/src/pages/pricing.tsx` | `/api/auth/me`; `/api/stripe/create-checkout`; `/api/stripe/create-portal`; `/api/stripe/plans`; `/api/stripe/subscription` |
| `client/src/pages/privacy-policy.tsx` | No direct API; static content/shared components |
| `client/src/pages/property.tsx` | `/api/property-appraisers` |
| `client/src/pages/ranking-grid.tsx` | `/api/photos/business-details`; `/api/photos/business-search`; `/api/ranking-grid/geocode`; `/api/ranking-grid/map/${scan.id}?w=${reqW}&h=${reqH}&zoom=${zoom}`; `/api/ranking-grid/scans`; `/api/ranking-grid/scans/${id}` |
| `client/src/pages/reinstatement.tsx` | `/api/reinstatement/request` |
| `client/src/pages/review-feedback.tsx` | `/api/review`; `/api/review/${token}`; `/api/review/${token}/feedback`; `/api/review/${token}/generate-review`; `/api/review/${token}/mark-reviewed`; `/api/review/${token}/track-photos`; `/api/review/${token}/track-review-method`; `/api/review/${token}/track-step` |
| `client/src/pages/review-unsubscribe.tsx` | `/api/review/${token}/unsubscribe`; `/api/review/${token}/unsubscribe-info` |
| `client/src/pages/schedules.tsx` | `/api/databases`; `/api/scrape-schedules`; `/api/scrape-schedules/${id}` |
| `client/src/pages/search.tsx` | `/api/counties`; `/api/databases/counts`; `/api/databases/county-state`; `/api/databases?filtered=true&stateCode=${scopeState}&limit=5000`; `/api/permit-details/${resultId}`; `/api/search`; `/api/search-queries`; `/api/search/live/${searchId}` |
| `client/src/pages/settings.tsx` | `/api/auth/2fa/disable`; `/api/auth/2fa/setup`; `/api/auth/2fa/verify`; `/api/auth/change-password`; `/api/auth/me`; `/api/auth/profile`; `/api/beta-codes`; `/api/beta-codes/generate`; `/api/beta-codes/redeem`; `/api/beta-codes/revoke/${id}`; `/api/beta-codes/status`; `/api/review-templates`; `/api/review-templates/${editingTemplate.id}`; `/api/review-templates/${id}`; `/api/upload/logo` |
| `client/src/pages/terms-of-use.tsx` | No direct API; static content/shared components |
| `client/src/pages/vpn-shield.tsx` | `/api/vpn-shield/domains`; `/api/vpn-shield/domains/${domainId}/settings`; `/api/vpn-shield/script/${selectedDomain.trackingId}` |

### Server method inventory

#### server/routes.ts

- `GET /api/counties` — `server/routes.ts:158`
- `GET /api/databases` — `server/routes.ts:163`
- `GET /api/databases/counts` — `server/routes.ts:181`
- `GET /api/databases/county/:countyId` — `server/routes.ts:186`
- `POST /api/search` — `server/routes.ts:192`
- `GET /api/search/live/:searchId` — `server/routes.ts:246`
- `POST /api/scrape` — `server/routes.ts:276`
- `GET /api/scrape/status/:jobId` — `server/routes.ts:312`
- `GET /api/scrape/jobs` — `server/routes.ts:320`
- `POST /api/permit-details/:resultId` — `server/routes.ts:327`
- `GET /api/search-queries` — `server/routes.ts:364`
- `DELETE /api/search-queries/:id` — `server/routes.ts:369`
- `DELETE /api/search-queries` — `server/routes.ts:376`
- `GET /api/search-results/recent` — `server/routes.ts:381`
- `GET /api/search-results/:queryId` — `server/routes.ts:386`
- `GET /api/scrape-schedules` — `server/routes.ts:392`
- `POST /api/scrape-schedules` — `server/routes.ts:397`
- `PATCH /api/scrape-schedules/:id` — `server/routes.ts:406`
- `DELETE /api/scrape-schedules/:id` — `server/routes.ts:415`
- `GET /api/property-appraisers` — `server/routes.ts:421`
- `GET /api/property-appraisers/county/:countyId` — `server/routes.ts:432`
- `POST /api/property-lookup` — `server/routes.ts:438`
- `GET /api/property-records/:countyId` — `server/routes.ts:474`
- `POST /api/photos/upload` — `server/routes.ts:480`
- `POST /api/photos/auto-enhance` — `server/routes.ts:504`
- `POST /api/photos/upload-watermark` — `server/routes.ts:523`
- `POST /api/photos/business-search` — `server/routes.ts:537`
- `POST /api/photos/business-details` — `server/routes.ts:796`
- `POST /api/photos/generate-description` — `server/routes.ts:854`
- `POST /api/photos/process` — `server/routes.ts:896`
- `GET /api/photos/process/:jobId` — `server/routes.ts:1058`
- `GET /api/photos/download/:fileId` — `server/routes.ts:1071`
- `POST /api/photos/download-all/prepare` — `server/routes.ts:1088`
- `GET /api/photos/download-all/:token` — `server/routes.ts:1098`
- `GET /api/media/folders` — `server/routes.ts:1128`
- `POST /api/media/folders` — `server/routes.ts:1139`
- `PATCH /api/media/folders/:id` — `server/routes.ts:1158`
- `POST /api/photos/nearby-cities` — `server/routes.ts:1178`
- `POST /api/media/geocode` — `server/routes.ts:1299`
- `DELETE /api/media/folders/:id` — `server/routes.ts:1319`
- `GET /api/media/folders/:id/photos` — `server/routes.ts:1339`
- `DELETE /api/media/photos/:id` — `server/routes.ts:1351`
- `POST /api/media/save-processed` — `server/routes.ts:1368`
- `POST /api/media/upload` — `server/routes.ts:1412`
- `PATCH /api/media/photos/:id/rename` — `server/routes.ts:1447`
- `GET /api/gmb/listings` — `server/routes.ts:1464`
- `POST /api/gmb/listings` — `server/routes.ts:1475`
- `POST /api/gmb/listings/:id/check` — `server/routes.ts:1504`
- `GET /api/gmb/listings/:id/history` — `server/routes.ts:1585`
- `DELETE /api/gmb/listings/:id` — `server/routes.ts:1600`
- `POST /api/gmb/review-response` — `server/routes.ts:1615`
- `POST /api/ranking-grid/geocode` — `server/routes.ts:1659`
- `GET /api/ranking-grid/map/:scanId` — `server/routes.ts:1681`
- `GET /api/ranking-grid/scans` — `server/routes.ts:1730`
- `GET /api/ranking-grid/scans/:id` — `server/routes.ts:1740`
- `POST /api/ranking-grid/scans` — `server/routes.ts:1752`
- `DELETE /api/ranking-grid/scans/:id` — `server/routes.ts:1798`
- `PATCH /api/gmb/listings/:id` — `server/routes.ts:1901`
- `GET /api/competitors/scans` — `server/routes.ts:1937`
- `GET /api/competitors/scans/:id` — `server/routes.ts:1946`
- `POST /api/competitors/scans` — `server/routes.ts:1958`
- `DELETE /api/competitors/scans/:id` — `server/routes.ts:1982`
- `GET /api/ad-spy/keywords` — `server/routes.ts:1995`
- `POST /api/ad-spy/keywords` — `server/routes.ts:2019`
- `DELETE /api/ad-spy/keywords/:id` — `server/routes.ts:2038`
- `GET /api/ad-spy/keywords/:id/advertisers` — `server/routes.ts:2051`
- `POST /api/ad-spy/keywords/:id/refresh` — `server/routes.ts:2076`
- `GET /api/locations` — `server/routes.ts:2512`
- `GET /api/locations/:id` — `server/routes.ts:2521`
- `POST /api/locations` — `server/routes.ts:2532`
- `PUT /api/locations/:id` — `server/routes.ts:2542`
- `DELETE /api/locations/:id` — `server/routes.ts:2555`
- `GET /api/gbp/accounts` — `server/routes.ts:2604`
- `GET /api/gbp/locations` — `server/routes.ts:2638`
- `POST /api/gbp/import` — `server/routes.ts:2702`
- `POST /api/locations/search-google` — `server/routes.ts:2742`
- `POST /api/locations/:id/import-google` — `server/routes.ts:2947`
- `GET /api/locations/:id/analytics` — `server/routes.ts:3003`
- `POST /api/locations/:id/analytics/seed` — `server/routes.ts:3113`
- `GET /api/citations/campaigns` — `server/routes.ts:3168`
- `POST /api/citations/campaigns` — `server/routes.ts:3177`
- `DELETE /api/citations/campaigns/:id` — `server/routes.ts:3187`
- `GET /api/citations/campaigns/:id/results` — `server/routes.ts:3200`
- `POST /api/citations/campaigns/:id/run` — `server/routes.ts:3245`
- `GET /api/state-guides` — `server/routes.ts:3347`
- `GET /api/state-guides/:stateCode` — `server/routes.ts:3352`
- `GET /api/master-class-modules` — `server/routes.ts:3360`
- `GET /api/course-purchases` — `server/routes.ts:3365`
- `POST /api/admin/test-email` — `server/routes.ts:3372`
- `POST /api/seo-inquiry` — `server/routes.ts:3395`
- `POST /api/reinstatement/request` — `server/routes.ts:3428`
- `POST /api/click-guard/track` — `server/routes.ts:3468`
- `OPTIONS /api/click-guard/track` — `server/routes.ts:3563`
- `GET /api/click-guard/domains` — `server/routes.ts:3570`
- `POST /api/click-guard/domains` — `server/routes.ts:3600`
- `DELETE /api/click-guard/domains/:id` — `server/routes.ts:3621`
- `GET /api/click-guard/domains/:id/analytics` — `server/routes.ts:3638`
- `GET /api/click-guard/domains/:id/visits` — `server/routes.ts:3747`
- `GET /api/click-guard/domains/:id/blocked` — `server/routes.ts:3776`
- `POST /api/click-guard/domains/:id/block` — `server/routes.ts:3792`
- `PATCH /api/click-guard/domains/:id/settings` — `server/routes.ts:3820`
- `GET /api/click-guard/exclusion-list/:trackingId` — `server/routes.ts:3838`
- `GET /api/click-guard/domains/:id/google-ads-script` — `server/routes.ts:3870`
- `DELETE /api/click-guard/domains/:id/block/:blockId` — `server/routes.ts:3963`
- `GET /api/click-guard/domains/:id/visitors` — `server/routes.ts:3980`
- `GET /api/click-guard/domains/:id/visitors/:visitorIp` — `server/routes.ts:4053`
- `GET /api/click-guard/domains/:id/pages` — `server/routes.ts:4114`
- `GET /api/click-guard/domains/:id/geo` — `server/routes.ts:4153`
- `GET /api/click-guard/domains/:id/platforms` — `server/routes.ts:4208`
- `GET /api/click-guard/domains/:id/online` — `server/routes.ts:4247`
- `OPTIONS /api/vpn-shield/track` — `server/routes.ts:4370`
- `POST /api/vpn-shield/track` — `server/routes.ts:4377`
- `GET /api/vpn-shield/domains` — `server/routes.ts:4469`
- `GET /api/vpn-shield/domains/:id/stats` — `server/routes.ts:4494`
- `GET /api/vpn-shield/domains/:id/blocked-visits` — `server/routes.ts:4552`
- `GET /api/vpn-shield/domains/:id/script` — `server/routes.ts:4568`
- `GET /api/vpn-shield/script/:trackingId` — `server/routes.ts:4591`
- `POST /api/vpn-shield/domains/:id/settings` — `server/routes.ts:4711`
- `POST /api/contracts/create` — `server/routes.ts:4743`
- `GET /api/contracts/:token` — `server/routes.ts:4780`
- `POST /api/contracts/:token/sign` — `server/routes.ts:4810`
- `GET /api/contracts/user/list` — `server/routes.ts:4857`
- `POST /api/contracts/:token/checkout` — `server/routes.ts:4869`
- `POST /api/reviews/create` — `server/routes.ts:4944`
- `GET /api/reviews/list` — `server/routes.ts:5017`
- `GET /api/review-templates` — `server/routes.ts:5028`
- `POST /api/review-templates` — `server/routes.ts:5039`
- `PATCH /api/review-templates/:id` — `server/routes.ts:5082`
- `DELETE /api/review-templates/:id` — `server/routes.ts:5117`
- `GET /api/reviews/trash` — `server/routes.ts:5131`
- `DELETE /api/reviews/:id` — `server/routes.ts:5143`
- `POST /api/reviews/:id/restore` — `server/routes.ts:5158`
- `DELETE /api/reviews/:id/permanent` — `server/routes.ts:5173`
- `GET /api/google-profile-reviews` — `server/routes.ts:5188`
- `POST /api/google-profile-reviews` — `server/routes.ts:5229`
- `PATCH /api/google-profile-reviews/:id/reply` — `server/routes.ts:5254`
- `PATCH /api/google-profile-reviews/:id/note` — `server/routes.ts:5272`
- `DELETE /api/google-profile-reviews/:id` — `server/routes.ts:5290`
- `POST /api/reviews/:id/resend` — `server/routes.ts:5303`
- `GET /api/review/:token/pixel.png` — `server/routes.ts:5334`
- `GET /api/review/:token/click` — `server/routes.ts:5349`
- `GET /api/review/:token` — `server/routes.ts:5371`
- `POST /api/review/:token/feedback` — `server/routes.ts:5413`
- `POST /api/review/:token/mark-reviewed` — `server/routes.ts:5438`
- `POST /api/review/:token/generate-review` — `server/routes.ts:5458`
- `POST /api/review/:token/track-photos` — `server/routes.ts:5487`
- `POST /api/review/:token/track-review-method` — `server/routes.ts:5503`
- `POST /api/review/:token/track-step` — `server/routes.ts:5517`
- `POST /api/beta-codes/generate` — `server/routes.ts:5531`
- `GET /api/beta-codes` — `server/routes.ts:5575`
- `POST /api/beta-codes/revoke/:id` — `server/routes.ts:5605`
- `POST /api/beta-codes/redeem` — `server/routes.ts:5635`
- `GET /api/beta-codes/status` — `server/routes.ts:5679`
- `GET /api/review-reminder-settings` — `server/routes.ts:5696`
- `PUT /api/review-reminder-settings` — `server/routes.ts:5713`
- `GET /api/review/:token/unsubscribe-info` — `server/routes.ts:5732`
- `POST /api/review/:token/unsubscribe` — `server/routes.ts:5748`
- `GET /api/files/:folder/:subfolder/:filename` — `server/routes.ts:5893`
- `POST /api/upload/logo` — `server/routes.ts:5925`
- `POST /api/upload/review-photos` — `server/routes.ts:5958`
- `GET /api/files/:folder/:subfolder/:filename/download` — `server/routes.ts:5985`
- `GET /api/admin/lsa/manager` — `server/routes.ts:6042`
- `POST /api/admin/lsa/manager/connect` — `server/routes.ts:6060`
- `POST /api/admin/lsa/manager/disconnect` — `server/routes.ts:6084`
- `POST /api/admin/lsa/manager/sync-accounts` — `server/routes.ts:6094`
- `GET /api/admin/lsa/accounts` — `server/routes.ts:6117`
- `POST /api/admin/lsa/accounts` — `server/routes.ts:6130`
- `GET /api/admin/lsa/accounts/:id` — `server/routes.ts:6150`
- `POST /api/admin/lsa/accounts/:id/sync-leads` — `server/routes.ts:6162`
- `GET /api/admin/lsa/accounts/:id/campaigns` — `server/routes.ts:6182`
- `PATCH /api/admin/lsa/accounts/:id/campaigns/:campaignId/settings` — `server/routes.ts:6200`
- `PATCH /api/admin/lsa/accounts/:id/campaigns/:campaignId/budget` — `server/routes.ts:6240`
- `PATCH /api/admin/lsa/accounts/:id/campaigns/:campaignId/status` — `server/routes.ts:6267`
- `GET /api/admin/lsa/invitations` — `server/routes.ts:6311`
- `POST /api/admin/lsa/invitations` — `server/routes.ts:6321`
- `PATCH /api/admin/lsa/invitations/:id` — `server/routes.ts:6360`
- `GET /api/admin/lsa/dispute-reasons` — `server/routes.ts:6409`
- `POST /api/admin/lsa/leads/:leadId/dispute` — `server/routes.ts:6414`
- `GET /api/admin/lsa/audit-log` — `server/routes.ts:6447`

#### server/auth.ts

- `GET /api/auth/google` — `server/auth.ts:200`
- `GET /api/auth/google/callback` — `server/auth.ts:225`
- `POST /api/auth/signup` — `server/auth.ts:255`
- `POST /api/auth/login` — `server/auth.ts:312`
- `POST /api/auth/2fa/login` — `server/auth.ts:357`
- `GET /api/auth/verify-email` — `server/auth.ts:403`
- `POST /api/auth/resend-verification` — `server/auth.ts:439`
- `POST /api/auth/forgot-password` — `server/auth.ts:466`
- `POST /api/auth/reset-password` — `server/auth.ts:493`
- `GET /api/auth/me` — `server/auth.ts:518`
- `PATCH /api/auth/profile` — `server/auth.ts:556`
- `POST /api/auth/change-password` — `server/auth.ts:612`
- `POST /api/auth/2fa/setup` — `server/auth.ts:643`
- `POST /api/auth/2fa/verify` — `server/auth.ts:680`
- `POST /api/auth/2fa/disable` — `server/auth.ts:717`
- `POST /api/auth/logout` — `server/auth.ts:754`

#### server/stripe.ts

- `GET /api/stripe/plans` — `server/stripe.ts:173`
- `GET /api/stripe/subscription` — `server/stripe.ts:177`
- `POST /api/stripe/create-checkout` — `server/stripe.ts:201`
- `POST /api/stripe/create-portal` — `server/stripe.ts:249`
- `POST /api/stripe/create-course-checkout` — `server/stripe.ts:275`
- `POST /api/stripe/create-cart-checkout` — `server/stripe.ts:344`
- `POST /api/stripe/webhook` — `server/stripe.ts:434`

#### server/tracking-script.ts

- `GET /api/click-guard/script/:trackingId` — `server/tracking-script.ts:4`

#### server/site-assistant.ts

- `POST /api/site-assistant/chat` — `server/site-assistant.ts:227`

#### server/ads-consultant.ts

- `POST /api/ads-consultant/chat` — `server/ads-consultant.ts:168`

#### server/analytics.ts

- `POST /api/analytics/consent` — `server/analytics.ts:73`
- `POST /api/analytics/events` — `server/analytics.ts:88`
- `GET /api/admin/analytics` — `server/analytics.ts:133`

#### server/lsa/routes.ts

- `GET /api/lsa/status` — `server/lsa/routes.ts:56`
- `GET /api/lsa/oauth/start` — `server/lsa/routes.ts:84`
- `GET /api/lsa/oauth/callback` — `server/lsa/routes.ts:96`
- `POST /api/lsa/disconnect` — `server/lsa/routes.ts:135`
- `POST /api/lsa/sync` — `server/lsa/routes.ts:150`
- `POST /api/lsa/discover` — `server/lsa/routes.ts:167`
- `GET /api/lsa/accounts` — `server/lsa/routes.ts:181`
- `PATCH /api/lsa/accounts/:id` — `server/lsa/routes.ts:210`
- `GET /api/lsa/leads` — `server/lsa/routes.ts:225`
- `POST /api/lsa/leads/:leadId/good` — `server/lsa/routes.ts:252`
- `POST /api/lsa/disputes` — `server/lsa/routes.ts:268`
- `POST /api/lsa/disputes/schedule` — `server/lsa/routes.ts:281`
- `POST /api/lsa/disputes/unschedule` — `server/lsa/routes.ts:297`
- `POST /api/lsa/telegram/link` — `server/lsa/routes.ts:311`
- `POST /api/lsa/telegram/unlink` — `server/lsa/routes.ts:330`
- `POST /api/lsa/telegram/webhook` — `server/lsa/routes.ts:344`

#### server/crm/admin.ts

- `GET /api/admin/gate` — `server/crm/admin.ts:139`
- `POST /api/admin/gate` — `server/crm/admin.ts:146`
- `GET /api/admin/overview` — `server/crm/admin.ts:162`
- `GET /api/admin/users` — `server/crm/admin.ts:193`
- `GET /api/admin/orgs` — `server/crm/admin.ts:250`
- `GET /api/admin/orgs/:id` — `server/crm/admin.ts:297`
- `GET /api/admin/beta-invites` — `server/crm/admin.ts:375`
- `POST /api/admin/beta-invites` — `server/crm/admin.ts:393`
- `DELETE /api/admin/beta-invites/:id` — `server/crm/admin.ts:476`

## Round 2 — growth-platform fixes (2026-09-28)

This section supersedes the corresponding round-1 findings above. Work stayed in `/home/veto/ConstructHUB-a3`, branch `lane/a3`, application port **8149**, database **constructhub_dev_a3**. No production access, deployment, push, live Stripe calls, real email/SMS, or external storage writes. Google token/scope storage, GBP handlers, Profile Reviews, location analytics, and `locations.tsx` were not changed. Public Ad Activity remains disabled and returns **410**.

### Verification and limits

- Node **20.19.6**, with the lane environment exported as instructed. `npm run check`: **0 errors**. Full `npm test`: **573 passed, 65 files**, no excluded suites. `npm run build`: passed; the existing large-client-chunk warning remains.
- Playwright growth audit: **27 passed**, using genuinely anonymous requests plus real signed sessions, at **1440px and 375px**. Covers every rating 1–10, Google availability, unsuccessful feedback, unsubscribe without dismissing cookies, owner history, Gold competitor access, provider failure display, custom referral settings, Google-open provenance, and neutral legacy BS Meter presentation.
- Curl against 8149: real PNG upload → Sharp transform → JPEG download **200**; excessive photo batch **400**; upload over **10 MiB** and **11-file** multipart upload both **413**; forged AI role and overlong message **400**; JSON over **32 KiB** **413**. With bypass enabled, both `/api/auth/me` and `/api/reviews/list` return **200**.
- Tests use lane-derived child ports: base+1 configured-admin server (**8150**), base+2 HOVER stub (**8151**), base+3 anonymous growth server (**8152**). Cleanup terminates only the spawned process groups; the old port-wide `fuser -k` was removed. The primary app remains 8149. No other lane's process was stopped.
- The baseline full suite passed **533** tests after fixing the harness. Intermediate complete runs passed **535, 537, 541, 546, 549, 566, 570, 571, and 573** tests as coverage grew. Repeated runs initially exhausted existing CRM in-memory limits and the new persistent auth buckets. The lane server was restarted for the former; guarded test setup now resets only development auth counters between runs for the latter. Limits remain enabled in application code. A test timestamp fixture was corrected to UTC, and customer fixtures now use distinct emails to respect recipient-wide suppression. Final numbers above are unfiltered passes, not ignored failures.
- Commands: `npm run check`; `npm test`; `npm run build`; `E2E_PORT=8149 E2E_DB=constructhub_dev_a3 npx playwright test --config playwright.growth.config.ts`. Browser checks ran with `DEV_AUTH_BYPASS_USER1=false` and an explicitly blank Google Places key. Vitest's main server ran with the lane's explicit dev bypass; its isolation child disabled it.
- Actual OpenAI completions, production CAPTCHA verification, successful Google geocoding/Places/ranking/map calls, real Google Ads exclusions, live email/SMS delivery, and R2 writes remain **NOT-TESTABLE with the lane credentials**. Provider responses and CAPTCHA success/denial are mocked where applicable. Stripe-dependent flows remain **NOT-TESTABLE (needs `sk_test` key)**; the seven mocked Stripe pricing/webhook tests still pass. No credentials or environment-file contents are included here.

### Round 2 feature matrix / disposition of every requested item

The round-1 page/API inventory remains the broader inventory. This table identifies every round-2 surface and its verification; new endpoints are listed explicitly.

| Feature / original issue | Page/route | API | How verified | Status / commits |
|---|---|---|---|---|
| Ranking ownership (#2; brief 1) | `/ranking-grid` | `/api/ranking-grid/scans`, `/:id`, `/map/:scanId`, `/geocode` | Two real accounts: each lists/reads its own scan; other-account and ownerless detail/map/delete return 404; anonymous calls 401. Nullable owner migration; trial count is personal. | **FIXED `6ea8398`**; provider execution NOT-TESTABLE |
| Permit history and shared schedules (#3; brief 2) | `/search`, `/history`, `/schedules`, directory scrape action | `/api/search`, `/search/live/:searchId`, `/search-queries[/:id]`, `/search-results/{recent,:queryId}`, `/scrape{,/jobs,/status/:jobId}`, `/scrape-schedules[/:id]`, `/permit-details/:resultId` | Two-account list/delete/result isolation, bulk delete preserves the other account, ownerless rows hidden, logged-out route-family tests, ordinary accounts cannot read/create system schedules; browser owner history/admin-only schedule state. | **FIXED `6ea8398`, `b6c62b4`, `002e537`** |
| Public AI/photo abuse controls (#6; brief 3) | Site/ads chats, `/photos`, public review draft | `/api/site-assistant/chat`, `/ads-consultant/chat`, `/photos/*`, `/gmb/review-response`, `/review/:token/generate-review` | Atomic concurrent budget test, per-user across-IP and per-IP across-user tests; truncated history cannot reset the free gate; production unset/test CAPTCHA secret fails closed after 3 requests; mocked CAPTCHA outcomes; live curl size/count/schema rejections and photo transformation. | **FIXED `91becd4`, `54715f4`** |
| Competitor radius and provider failures (#7; brief 4) | `/competitors` | `/api/competitors/scans[/:id]` | Mocked geocode around coordinate 0,0, radius query and exact distance filtering, denied/quota/invalid/network responses, genuine ZERO_RESULTS; browser missing-key scan shows clear failure. Running scans poll for completion. | **FIXED `a4c3d36`, `d30680d`, `002e537`**; successful provider flow NOT-TESTABLE |
| BS Meter (#8; brief 5) | Competitor scan detail, landings, home and pricing | Competitor listing analysis/read response | Sample-size and no-velocity unit tests; missing profile links no longer increase the score; legacy accusations sanitized on read; browser shows **5 reviews sampled** and heuristic limitations. No lifetime-count/oldest-sample rate remains. | **FIXED `8ae61ff`, `27d421f`** |
| Review funnel provenance (#9; brief 6) | `/review/:token`, request dashboard in `/google-reviews` | New `/api/review/:token/google-link-opened`, `/complete`; compatible `/mark-reviewed` | Real API and browser click with Google network request aborted: `google_link_opened=true`, `review_submitted=false`; private feedback status survives completion. Dashboard says **Google Links Opened**. Legacy completion booleans are not converted into asserted Google opens. | **FIXED `72edb89`** |
| Reminder validation/timezones (#10; brief 7) | Review reminder settings | `/api/review-reminder-settings`, reminder/scheduled workers | Invalid arrays/timezones/intervals/types rejected; maxReminders=0 persists; New York spring/fall and Los Angeles DST tests, nonexistent spring-hour test, interval never shortened; canonical-origin test. Worker rechecks delivery windows. | **FIXED `3541ade`** |
| Recipient-wide unsubscribe (#11; brief 8) | `/review/:token/unsubscribe`, sender/resend | Unsubscribe/info, new `/api/review/:token/resubscribe`, request create/resend/queues | Normalized case/whitespace email suppression across existing and future requests for contractor A, contractor B unaffected; anonymous explicit resubscribe only; contractor's authenticated request denied; old stopped requests stay stopped. Mobile and desktop browser unsubscribe pass without cookie dismissal. | **FIXED `277a12d`** |
| Tracking origin/fingerprint/claims (#12; brief 9) | `/google-ads`, `/ip-tracker`, `/vpn-shield`, related marketing | Tracking/VPN scripts and ingest; new `/api/public-config` | Both scripts use canonical configured origin, quote injected IDs safely; actual same-domain cross-IP fingerprint ingestion produces the signal; nonexistent noscript pixel removed from snippet; claims distinguish heuristic/browser behavior and separate Ads-script enforcement. | **FIXED `37455fc`, `27d421f`, `4beb2a2`** |
| Password reset and auth limits (#13; brief 10) | `/auth` | Signup/login/forgot/reset/2FA login | Reset revokes a real existing session **and pending 2FA session**; replay rejected; repeated account attempts reach 429 across signup/login/forgot; full CRM reset/login tests pass. Token update/session removal is transactional. | **FIXED `76de799`, `590f818`** |
| Entitlement wording/monthly limits (#15; brief 11) | `/competitors`, pricing, `/photos`, `/search`, `/ranking-grid` | Mutation endpoints and subscription catalog | Gold UI/server agreement; catalog-driven monthly search/photo/ranking reservations; atomic counter test; actual photo upload followed by six-photo Standard batch returns 403 with limit=5; failed photos refund their reservations. No paid-feature access gates were broadened or narrowed. | **FIXED `8297265`, `54715f4`, `27d421f`** for these limits |
| Per-tool site allocation limits (remaining part of #15) | Click Guard/IP Tracker/VPN Shield/Competitor Intel | Shared domain mutations/read surfaces; competitor market scans | Code inventory: multiple tools share the same domain rows; competitor scans have a location/industry rather than a website identity. A single domain cap cannot represent Premium's 3 Click Guard sites and 1 IP Tracker site. | **BROKEN-open**: requires a feature-to-site allocation model; see P2 below |
| Non-obscuring consent (#16; brief 12) | All pages, especially 375px unsubscribe | Consent banner/shared layout | Banner is in normal document flow, below portals in stacking order. Mobile unsubscribe buttons and competitor dropdown selection work without dismissing it. | **FIXED `1cc2c1d`, `98d4d9b`** |
| Honest copy and configurable referrals (#17; brief 13) | Growth marketing, Master Class, Settings → Profile, customer review | New GET/PUT `/api/review-referral-settings`; public review reads only enabled offer | Removed hardcoded 3% offer, surveillance/fraud-detection claims and disputed-work/review tradeoff. Per-contractor default OFF; enable requires terms; browser saves custom terms, sees them anonymously, disables offer and both referral cards disappear. Two-account API settings isolation. | **FIXED `16a70c2`, `27d421f`** |
| Dev auth parity (#18; brief 14) | `/me` and protected handlers | Passport session adapter used before protected routes | Unit tests: explicit flag required, production dev bypass rejected, real user preserved, test identity not persisted; curl `/me` and review list both 200 in dev; anonymous isolation child returns 401. Google scope/token handling untouched. | **FIXED `912eaee`, `590f818`** |
| Test harness (brief 15) | Vitest, growth Playwright | Admin child, HOVER stub, anonymous growth child | Full, unfiltered suite; every child port derived from lane, PID-owned cleanup, dev-DB guard, isolated persisted auth fixtures. | **FIXED `2e00c40`, `397909e`, `002e537`** |
| Public Ad Activity remains off | Competitor UI | `/api/ad-spy/*` | Browser has no Ad Activity tab; actual API 410 assertion. | **PASS — intentionally disabled; existing `4f1c356` retained** |

Operational bounds: public AI/photo JSON **32 KiB**, chat **10 messages / 4,000 characters per message**, photo multipart **10 files / 10 MiB each**, photo decoder **40 million input pixels**, active photo jobs **4 per app process / 1 per actor**. Rate and monthly quota counters are database-backed; concurrency tests prove atomic admission. Site-chat's first three requests are counted by IP and session, independent of submitted history. Production needs `RECAPTCHA_SECRET_KEY` plus client `VITE_RECAPTCHA_SITE_KEY`; documented test keys do not unlock the production gate. Background links and tracking use `APP_URL`; background link generation fails closed in production if it is missing.

Additive boot migration lives in `server/growth-schema.ts`; tables/columns are also in `shared/schema.ts`. Existing ranking/search rows are deliberately not assigned to user 1 or guessed owners. Admins can see their own and unowned legacy rows; other known owners remain isolated. Existing recipient opt-outs are copied to persistent preferences without overwriting an explicit resubscribe. No legacy click/completion value is treated as verified review publication.

### Remaining issues, ranked (Round 2)

1. **P2 — per-tool site quotas need a resource-model refactor (#15 partial).** `server/routes.ts:3368` creates a shared tracked domain without a feature allocation; `server/routes.ts:4237` exposes those same domains to VPN Shield. `server/routes.ts:2019` creates competitor scans by industry/location, with no monitored website identity. Repro with a Gold account: create two tracked domains through POST `/api/click-guard/domains`; both appear in the shared tools despite Gold's advertised one-site allowances. Premium's three Click Guard sites versus one IP Tracker site cannot safely be enforced by lowering a global domain cap. Required: explicit per-tool enabled-site assignments and migration of existing choices, then transactional cardinality checks. Monthly photo/search/ranking limits are fixed; **this part is not claimed complete**.
2. **P2 — several Click Guard settings remain stored preferences, not enforcement.** `client/src/pages/google-ads.tsx:1992`, `:2012`, `:2033`; ingest in `server/routes.ts` does not consult `blockByCountry`, `blockJsDisabled`, or `vpnBlocking`. Repro: toggle the preference, ingest the same visit, compare behavior. Copy now explicitly says these controls are not enforced. Implement appropriate enforcement or remove/disable the inert controls; do not restore “blocks every VPN/browser” claims. This is separate from the fixed origin and fingerprint bugs.
3. **P2 — ranking-provider error provenance remains weaker than competitor scans.** `server/routes.ts:1873`, `runRankingGridScan`: a Places response other than OK can still become an unranked grid point and the overall scan can finish “completed.” Repro with a provider stub returning REQUEST_DENIED to ranking textsearch. Competitor scans now fail clearly; ranking ownership/quota fixes do not certify ranking provider results. Apply the same provider-status/error model to ranking workers before promising live ranking reliability.
4. **P2 — legacy ad-fraud editorial page contains unsubstantiated statistics and accusations.** `client/src/pages/google-ad-fraud.tsx:28`, `:36`, `:221`, `:326`. Repro: open `/google-ad-fraud`; the page asserts measured fraud percentages and that the tracker captures every request without JavaScript, contradicting the implemented browser script. This page needs a full evidence-based editorial replacement; no source dataset was available to validate its claimed research. The operational Click Guard pages, guide, landings, and pricing claims were softened, but this separate article is not certified by this audit.
5. **P3 — photo jobs and artifact lifecycle remain process-local.** `server/routes.ts` `processingJobs`, `uploadedFiles`, `processedFiles`: active jobs are bounded and stale upload entries expire, but restart recovery and a complete artifact retention policy (including watermark/processed files) are not implemented. Repro: restart during a photo job; the status ID disappears. A durable queue and retention policy are a larger reliability follow-up.

Credential-dependent checks above are **NOT-TESTABLE**, not silently passed. Out-of-scope GBP findings (#4/#5/#14) belong to lane a2 and were not reclassified by this lane.

### Recommended improvements (ranked impact / effort)

1. **High / medium-large:** model per-tool site assignments explicitly and enforce Gold/Premium/Platinum site allowances without reducing another tool's purchased allowance.
2. **High / medium:** extend explicit provider failure/provenance handling to ranking jobs; show provider sample limits and last successful collection consistently.
3. **High / medium:** replace the unsupported ad-fraud article and remove inert security switches or implement them with verifiable semantics. Keep browser signals separate from server/network access control and Ads enforcement.
4. **Medium-high / medium-large:** durable photo/reminder jobs with idempotent delivery, retry state, cancellation, and artifact retention. Current reminder timezone logic is tested; concurrent-worker exactly-once email delivery is not guaranteed.
5. **Medium / small:** simplify unsubscribe to a direct one-action opt-out with optional feedback afterward; the current two-step flow is accessible but adds friction.
6. **Medium / medium:** isolated provider staging credentials and provider contract tests, including Google quota/permission failures, real CAPTCHA host configuration, and `sk_test` Stripe flows. Keep live credentials out of audit lanes.
7. **Medium / small-medium:** quota usage/reset visibility in the UI, scan cancellation and job progress/error histories, and DB-backed pagination for growing result/history collections.

### Final follow-up commits and verification

- `b6c62b4`: honest admin-only schedule error state; real-session browser assertion.
- `d30680d`: poll running competitor scans and avoid empty-success copy on failed scans; missing-provider browser assertion without reloading.
- `4beb2a2`: tracking setup/landing/pricing/guide copy describes browser signals and separately installed Ads exclusions; illustrative costs are not measured savings. Removed the guide's recommendation to assume repeat visitors are fraudulent and over-block them.
- `002e537`: repeatable customer fixtures, real-session browser coverage for ownership/settings/referrals/Google opens/legacy analysis, reminder validation and actual photo quota API tests, portable lane DB guard.
- Final code: **573/573 Vitest tests (65 files), typecheck 0 errors, production build passed**. Final browser run: **27/27 passed**. The last changes after that browser run were static tracking/guide copy; the full typecheck, tests, and build were rerun afterward. All required changes and this report are committed. Remaining limitations are explicitly listed above.
