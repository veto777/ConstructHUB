# Lane a2 — Google Business Profile integration audit

Date: 2026-09-28. Worktree `/home/veto/ConstructHUB-a2`, branch `lane/a2`, base `706e38f`, port **8139**, database **constructhub_dev_a2**. Read `CLAUDE.md`, `HANDOFF.md`, and the supplied a3 GBP integration map. No deployment, push, production database, SSH, real Google grant, live Stripe, SMS, or real email delivery was used.

## Changes and verification

- **a1e6099** — implement isolated GBP consent/grants, canonical imports, review sync/replies, real performance ingestion, shared quota enforcement and UI/tests. Existing profile/email Google login no longer stores or overwrites GBP credentials. Legacy grants without proven scopes are deliberately not migrated into connected grants; users must reconnect.
- **b4dec41** — isolate Vite's optimizer cache in the worktree. The first browser run reproduced 504 `Outdated Optimize Dep` responses with shared `node_modules`; separate `tmp/vite-cache` resolved the blank page.
- `npm run check`: **0 errors**.
- `npm test -- --exclude server/crm/admin.test.ts --exclude server/crm/hover.test.ts`: **522 tests / 59 files passed**. These two exclusions are required by the lane port restriction: they bind 8199 and 8465. An unrestricted `npm test` was **not run**, so full-suite certification is not claimed.
- `E2E_PORT=8139 E2E_DB=constructhub_dev_a2 npx playwright test --config playwright.gbp.config.ts`: **3 passed**. Real browser, actual React UI; real disconnected status plus mocked application responses for connected/sync/reply/performance scenarios.
- `npm run build`: **passed**, with existing large-bundle warnings.
- GBP tests include injected Google `fetch` responses, real isolated Postgres persistence/transactions, real Express HTTP routes without a grant, and OAuth state rejection. Fixtures are explicitly synthetic test records in `server/gbp/client.test.ts`, `service.test.ts`, `http.test.ts`, and `e2e/gbp.spec.ts`; integration fixtures are removed after tests.
- Curl on 8139: `/api/gbp/status` → 200 disconnected; `/api/gbp/accounts` and `/api/gbp/locations` → 401 with `needsAuth`; removed analytics seed → 410. No token or `.env` contents are included in this report.

The lane server was started with Node 20.19.6 and its `.env` exported. Final test runs set `GBP_SYNC_DISABLED=true` on the lane server so ephemeral fixture grants cannot trigger external background HTTP. Scheduling is tested separately with an injected sync function; the production default is enabled, ticking every minute and selecting locations due after six hours.

## Feature matrix

Scope follows `client/src/App.tsx` routes `/locations` and `/google-reviews`, their sidebar entries, their API calls, and the GBP-specific paths in `server/auth.ts`, `server/routes.ts`, and `server/gbp/`. CRM review requests, email templates/reminders, citations, public Places monitoring, rankings, Ads/LSA, and permit features belong to the other lanes and are not newly certified here.

| Feature | Page/route | API | How verified | Status |
|---|---|---|---|---|
| Normal Google login / GBP separation (#14) | Auth; Locations connect controls | `/api/auth/google`, callback; legacy `?gbp=1` redirects to dedicated connect | Code: basic login writes profile fields only; scope-negative, account-switch, callback-owner-binding tests; state rejection over actual HTTP | FIXED a1e6099 |
| GBP consent, actual scopes, Google account identity | Locations and Google Profile Reviews connection panel | GET `/api/gbp/connect`, `/api/gbp/callback`, `/api/gbp/status`; `/api/auth/me` | State bound to session, initiating user and 10-minute expiry; mocked token exchange + verified userinfo; status excludes credentials; Playwright disconnected/connected states | FIXED a1e6099 |
| Expiry / refresh / reconnect | Shared connection panel | Internal OAuth refresh; GET status | Concurrent refresh coalescing, account changes do not reuse another account's refresh token; `invalid_grant` persists reconnect-required; original ConstructHUB user identity retained | FIXED a1e6099 |
| Disconnect / revoke | Shared connection panel | POST `/api/gbp/disconnect`; Google OAuth revoke | Mocked remote revoke failure still disconnects locally and returns actionable manual-revocation message; no token returned | FIXED a1e6099 |
| Account enumeration | Import from GBP | GET `/api/gbp/accounts` | Paginated documented account responses, opaque token encoding, repeated-token guard, 20-item page limit; actual disconnected 401 | FIXED a1e6099 |
| Location enumeration / partial account errors | Locations → Add Location → Import from GBP | GET `/api/gbp/locations` | Paginated locations; per-account permission errors returned with account name and displayed; location mapper null fallbacks; 100-item page limit | FIXED a1e6099 |
| Authoritative import / deduplication | GBP import dialog | POST `/api/gbp/import`; GET `/api/locations`, `/:id` | Re-fetches Google locations before importing; ignores client-supplied business details; canonical account + location unique index; repeat import updates one row; fabricated resource rejected | FIXED a1e6099 |
| Local location edits cannot forge Google identity | Location detail | POST/PUT `/api/locations[/id]` | Canonical fields omitted from local create/update input; actual HTTP PUT cannot change imported resource identity | FIXED a1e6099 |
| Reviews sync: updated and deleted reviews | Google Reviews → Google Profile Reviews | POST `/api/gbp/locations/:id/sync`; GET `/api/google-profile-reviews` | v4 pagination at 50/page, upsert by full review name; edited content updated; complete snapshot soft-deletes absent reviews; failed later page leaves prior snapshot intact; malformed 200 rejected | FIXED a1e6099 |
| Per-location sync status / manual retry | Connection panels on both pages | GET `/api/gbp/status`; POST per-location sync | Independent reviews/performance last attempt, last success, last error; actual disconnected sync persists errors; Playwright checks never-synced, last-success and disabled-API error display | FIXED a1e6099 |
| Scheduled sync / overlapping work | Worker, enabled by default | Same sync service as manual endpoint | Six-hour due selection tested with injected callback; in-process worker overlap guard and database advisory lock per location; worker uses shared limiter | FIXED a1e6099 |
| Local reply drafts | Google Profile Reviews → Reply | PATCH `/api/google-profile-reviews/:id/reply` with `action=draft` | No Google HTTP; separate draft storage; old local replies migrated to drafts; real HTTP persistence and Playwright draft label; manual records labelled local | FIXED a1e6099 |
| Publish owner reply (#5) | Google Profile Reviews → Publish reply to Google | PATCH local reply with `action=publish`; Google PUT v4 review `/reply` | Google confirmation required before `posted`; denied request preserves confirmed state and saves error/draft; mocked service integration and Playwright confirmed-state flow | FIXED a1e6099 |
| Delete owner reply | Posted reply delete control | DELETE `/api/google-profile-reviews/:id/reply`; Google DELETE v4 review `/reply` | Failed remote delete preserves published reply; successful acknowledgement clears it; service tests and Playwright | FIXED a1e6099 |
| Review filters / local notes / local removal | Google Profile Reviews | GET list with location/rating/response/search; PATCH `/:id/note`; DELETE `/:id`; manual POST | Real HTTP search/rating/answered/unanswered/location filters, note update and local deletion; verified drafts remain unanswered; Playwright displays list; local removal explicitly says a synced copy returns on sync | PASS |
| Performance ingestion (#4) | Location → Insights | Google `fetchMultiDailyMetricsTimeSeries`; POST per-location sync; GET `/api/gbp/locations/:id/performance` | Seven supported daily metrics; first 90-day backfill, subsequent seven-day overlap; upserts real values; transactions preserve prior data on failure; tests distinguish protobuf omitted zero from absent series | FIXED a1e6099 |
| Performance availability / provenance | Insights and location overview | GET performance; legacy GET `/api/locations/:id/analytics` | Dedicated Google-only metric table; missing values shown as Unavailable, reported zero as 0; actual HTTP empty state and Playwright table; legacy unproven data excluded | FIXED a1e6099 |
| Remove random metrics | Former Seed Demo Data control/route | POST `/api/locations/:id/analytics/seed` now 410 | Random writer and button removed in all environments; legacy analytics/overview no longer present old demo aggregates as real metrics; actual HTTP test and curl | FIXED a1e6099 |
| Quotas / errors / retries | All Google API operations | Shared Google HTTP client | Postgres-backed 201ms request spacing shared across processes; virtual-clock 301-call test plus real DB cross-instance pacing; auth/permission/quota/disabled/transient classes; bounded exponential backoff and Retry-After | FIXED a1e6099 |
| Disabled API owner guidance | Import errors, sync status, reply failure | Provider error mapping | Both SERVICE_DISABLED and accessNotConfigured tested; exact called API name shown | FIXED a1e6099 |
| Live Google authorization, permissions, quota and data | Owner's Cloud project / real GBP | All four live Google services | No real grant exists in lane; all Google calls above use mocks | NOT-TESTABLE — owner grant and Cloud enablement required |
| Optional outbound location-info edits (#6) | Location Info / local preferences | No Business Information PATCH implementation | Code reviewed; local UI does not claim to publish edits | BROKEN-open — optional extension not implemented |
| Management notification preferences | Location → Settings | PUT `/api/locations/:id` | Code-only inventory; values remain local, with explicit UI explanation that delivery is not enabled here | BROKEN-open — delivery integration not implemented |
| Stripe / SMS live dependencies | Outside GBP scope | Stripe / SignalWire | Lane Stripe disabled; no SignalWire credentials; no live calls | NOT-TESTABLE — needs sk_test key / separate stub coverage; other-lane scope |

## Open issues, ranked

1. **P1 — Live acceptance remains owner-gated, not a successful live certification.** `server/gbp/routes.ts:13`, `server/gbp/client.ts:3`. Repro: on a configured deployment, use Connect Google Business Profile with an owner/manager account. Missing API enablement or an unregistered `/api/gbp/callback` prevents first use. Lane lacks the required real grant; use the checklist below. Application approval/quota are owner-supplied facts, not independently queried here.
2. **P2 — Optional location publication and edit audit trail are absent.** `client/src/pages/locations.tsx:578`, `server/gbp/routes.ts:9`. Repro: open Location Info/Settings; there is no explicit-confirm Business Information PATCH workflow. Local changes do not update the Google listing. Implement a reviewed field allowlist, updateMask, confirmation, actor/before/after audit record and failure reconciliation before enabling this optional feature.
3. **P2 — Full unfiltered test command conflicts with lane isolation.** `server/crm/admin.test.ts:238`, `server/crm/hover.test.ts:30`. Repro: unrestricted `npm test` starts a child server on 8199 and HOVER stub on 8465. Neither is this lane's permitted port. Both files were excluded rather than binding forbidden ports or modifying another lane's non-GBP scope. The reported 522-test result is the explicitly bounded run, not the complete suite.
4. **P2 — Review listing remains unpaginated at the database.** `server/routes.ts:4879` (GET profile reviews). Repro: import many locations/reviews, then request `/api/google-profile-reviews?search=...`; every user review is loaded and filtered in memory. Correct ownership is applied, but latency/memory grow with account size.
5. **P3 — Management preferences do not send change notifications.** `client/src/pages/locations.tsx:824`. Repro: save notification email/management preferences; no delivery worker consumes those settings. UI now explicitly describes this limitation. Actual automated review/performance sync is separate and enabled for imported locations while connected.
6. **P3 — Backfill and dashboard scope are deliberately bounded.** `server/gbp/service.ts:88`, `client/src/pages/locations.tsx:547`. Repro: first sync shows up to 90 days; ordinary resync revisits only seven prior days after its first populated response. There is no custom historical replay/date-range UI, export, monthly keyword ingestion, or restored comparison chart yet. Daily tables retain availability instead of fabricating aggregate changes.

## Owner checklist for first live run

In project **construction-hub-489119**, number **90021415768**, enable exactly the services consumed by this implementation:

| Cloud Console API name | Service identifier | Used for |
|---|---|---|
| **My Business Account Management API** | `mybusinessaccountmanagement.googleapis.com` | Account listing |
| **My Business Business Information API** | `mybusinessbusinessinformation.googleapis.com` | Location listing and canonical resource import |
| **Google My Business API** | `mybusiness.googleapis.com` | v4 reviews and owner reply PUT/DELETE |
| **Business Profile Performance API** | `businessprofileperformance.googleapis.com` | Daily performance metrics |

The project approval and 300 QPM quota do not automatically prove these APIs are enabled. Confirm API Library enablement and quotas in that same project. The app maps disabled-API errors to these exact names. Places, Google Ads/LSA, notifications and media APIs are not substitutes for these four services.

Verify the existing web OAuth client's project, configured client ID/secret (without putting either in logs), consent branding/authorized domains, support/privacy links, and requested scopes: `openid`, `email`, `profile`, **`https://www.googleapis.com/auth/business.manage`**. Verify sensitive-scope verification/publishing status; if still in Testing, explicitly allow the intended test users and account for expiring testing grants. Sign in to ConstructHUB first; connect the Google account that owns/manages the intended verified Business Profiles. The grant may belong to a different Google email than the ConstructHUB login and must not switch the ConstructHUB account.

Register the **new dedicated callback** on every enabled OAuth host. Default hosts from `server/site-context.ts` imply these exact URI pairs; preserve the existing login callback beside the new one:

| Host | GBP authorized redirect URI | Existing sign-in redirect URI to retain |
|---|---|---|
| Primary | `https://constructhub.us/api/gbp/callback` | `https://constructhub.us/api/auth/google/callback` |
| Primary portal (if used for OAuth) | `https://portal.constructhub.us/api/gbp/callback` | `https://portal.constructhub.us/api/auth/google/callback` |
| Alternate domain (if enabled) | `https://constructionhub.app/api/gbp/callback` | `https://constructionhub.app/api/auth/google/callback` |
| Alternate portal (if enabled) | `https://portal.constructionhub.app/api/gbp/callback` | `https://portal.constructionhub.app/api/auth/google/callback` |
| Lane development, only if deliberately used for a credentialed staging check | `http://127.0.0.1:8139/api/gbp/callback` | `http://127.0.0.1:8139/api/auth/google/callback` |

Production strips `www.` before selecting the OAuth base. If browsing development as `localhost` instead of `127.0.0.1`, register the corresponding exact `http://localhost:8139/...` pair. Verify actual `OAUTH_HOSTS`/domain configuration with the owner; no assumption is made about its secret environment values. The owned alternate domain is **constructionhub.app**, not `constructhub.app`.

After normal deployment by the owner: schema initialization creates the GBP tables/indexes idempotently and moves old unconfirmed local replies into drafts. Connect, verify displayed Google email, import one known location, inspect separate review/performance sync statuses, compare a sample of review names/content and daily metric values against Google, then deliberately publish/delete a test reply only with the owner's approval. Confirm revoked access produces Reconnect. Existing unknown-scope user tokens are not trusted. Reconnect all existing GBP users through the new flow. Leave `GBP_SYNC_DISABLED` unset/false for ordinary production scheduling.

Remote revoke failure still disconnects locally and asks the user to remove ConstructHUB access in their Google Account. A Google write that succeeds while the subsequent local DB write fails is reconciled by the next review sync; the app does not mark a failed operation as confirmed.

Documentation checked for fixtures and protocol details: [account listing](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list), [location listing](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list), [reviews list](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list), [review reply methods](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews), [daily metrics](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries), [DatedValue zero semantics](https://developers.google.com/my-business/reference/performance/rest/v1/TimeSeries). Page sizes are 20/100/50 for accounts/locations/reviews. A dated protobuf value omitted by Google means zero; an absent date or metric series remains unavailable.

## Recommended improvements (impact vs effort)

1. **High impact / small owner effort:** complete the Cloud/consent checklist and one credentialed staging acceptance run before advertising live integration availability.
2. **High / medium:** add cursor pagination and server-side filters to stored review lists; bulk sync selection with visible progress/cancellation for contractors managing many locations.
3. **High / medium:** add explicit-confirm profile edits with updateMask and an append-only audit trail; also keep a reply publish/delete activity history for support and team accountability.
4. **High / medium:** encrypt stored refresh credentials using deployment-managed keys and a documented rotation process; keep token-free API responses/logs as now.
5. **Medium-high / medium:** configurable historical replay, date ranges, CSV export and availability-aware charts/comparisons; do not revive unproven demo aggregates or interpret missing values as zero.
6. **Medium / medium:** provider-aware per-location retry timing, retry counts and stalled-worker visibility; coordinate any separate deployments sharing the same Google project quota. The DB limiter already coordinates processes sharing this database.
7. **Medium / medium:** implement real management notifications with per-location recipients and explicit delivery status; current local preferences are honestly labelled.
8. **Medium / small:** make the existing admin/HOVER tests accept isolated lane ports or in-process stubs so every lane can run the complete test command without crossing boundaries.
9. **Medium / medium:** per-location team permissions and assignments, response approval queues, and an explicit hide-local-review action distinct from deletion on Google (which this app does not offer).

Final housekeeping: only the server started by this audit on 8139 was stopped. Generated logs were removed after recording results. All source changes and this report are committed; no push or deployment was performed.
