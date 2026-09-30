# Feature lane a5 — Cloudflare and Google Search Console

## Built and where to find it

Growth sidebar → **Cloudflare** (`/cloudflare`) and **Search Console** (`/search-console`). Both pages have Sites, Connections, Onboarding, Work queue, and Guide tabs. Cloudflare also has Edge audit. Guides includes the complete setup walkthrough. These are growth-app pages, not the CRM portal.

- Cloudflare Global API Key exchange: verify identity, browse accounts/zones in pages, choose zones, discover permission-group IDs, create `ConstructHUB (YYYY-MM-DD)`, verify and encrypt only the new scoped token. The Global Key remains in browser form memory during selection and in each server request only. It is cleared after the exchange. There is no persistent exchange session or key cache.
- Requested permissions are **Zone Read, Analytics Read, Zone WAF Edit** (the API's equivalent `Write` spelling is accepted). Rules use zone Rulesets, so no DNS, billing, account-wide firewall, account rulesets, user-token-management, or zone-settings permission is requested. Fail closed if a necessary permission group is unavailable.
- Scoped-token fallback verifies `/user/tokens/verify` and zone-list access. Connect/disconnect require existing account step-up authentication, activity entries and mandatory security email via `notifyUser`; no parallel notification system.
- Agency member mode verifies the configured agency token. An hourly discovery job accepts pending memberships only for explicitly onboarded account IDs belonging to the configured ConstructHUB agency owner, discovers account zones and matches website domains to owned locations. Accepted memberships are also reconciled for interrupted onboarding. Client instructions and acceptance emails use durable jobs and the existing mail provider/sink.
- Analytics use Cloudflare GraphQL: daily requests, page views, unique visitors, threats, countries, recent firewall events with action/source/rule, top paths, and bot-score distribution when available. Bot share is score 1–29 divided by all scored requests; unscored/unavailable traffic is not invented. UTC date/day scope and adaptive sampling limits are shown.
- Edge protection: select zones, choose a pack or flagged IPs, add office IP exemptions, preview exact expressions, confirm with re-auth, then watch the queue. Packs include ads click-ID + UA/method checks, non-Google verified-bot restriction, 10 requests/10 seconds on the ads path; site-wide bad-UA blocking and 120 requests/10 seconds flood control. Cloudflare's verified-bot signal plus Google ASN and crawler UA identify the Google exemption; this is an edge rule, not origin reverse/forward DNS verification.
- Click Guard / VPN Shield integration is a small read-only `flaggedIpsForZone` hook: open a matching zone, find owned-domain flagged IPs, add them to the preview. No flag auto-publishes a block.
- Writes append ConstructHUB rules instead of overwriting a customer's ruleset. Saved action IDs bind confirmation to the exact owner/zone/preview for one hour; confirmation cannot be reused. Undo deletes only ConstructHUB rule IDs/refs and can reconcile a provider write that succeeded before its database checkpoint. Before/latest cache timestamps and sampled block counts support impact review; they are not causal attribution.
- Search Console OAuth uses the existing Google client and consent pattern with its own callback/state and encrypted grant records. It does not change GBP or Calendar credentials or scopes.
- Onboarding emails tell clients to grant the agency Google email **Full** access in Search Console → Settings → Users and permissions. The worker detects properties through `sites.list` and maps exact normalized website hosts to owned locations.
- Cached Search Analytics: clicks, impressions, weighted CTR/position by date, query, page, device, country; day/week/month aggregation; date selection up to 16 calendar months. The worker splits requested history into 28-day windows and paginates Google rows. Browser requests never fan out to Google.
- Cached sitemap lists, explicitly confirmed bulk submissions, queued URL Inspection, and coverage of **inspected URLs only**. All submitted/inspected URLs must be inside the selected property. Inspection budgets are keyed by the external property across owners/grants, limited to 1,900/day and 500/minute, below Google's published 2,000/day and 600/minute limits. General pages use sitemaps and inspection monitoring; no unsupported general-page Indexing API promise.
- Locations → Insights adds Search Console property totals beside GBP. Property-wide totals are not location-attributed traffic; when overlapping properties map to a location, one property is chosen instead of summing duplicate totals. Site Scan reports show cached per-URL indexing via an owner-scoped read-only hook.

## Agency scale, persistence and safety

`ensureCloudflareSearchSchema()` is registered beside `ensureGbpSchema()`. All new tables/indexes belong to this module: `edge_connections`, `edge_assets`, `edge_location_links`, `edge_jobs`, `edge_actions`, `edge_invites`, `edge_request_budget`, `gsc_analytics`, `gsc_inspections`. No drizzle-kit push or shared business-location schema edits.

New lists use database pagination/search/filtering. Page size is capped at 100 (UI 25), explicit bulk sets at 100. Sync all matching sites inserts jobs with a database operation; it does no Google calls. New browser sync submissions are refused when the existing queue already exceeds 10,000 pending jobs; a large accepted sync/history batch can expand beyond that threshold in the background. Google `sites.list` itself has no pagination: one background request imports its response, then local lists paginate normally. Cloudflare zone discovery continues in 50-zone jobs. Work queues coalesce identical active payloads with a unique database index.

A database-wide pace slot spaces each provider's calls by at least 260 ms, below 240 QPM and the 300-QPM Google project target. A worker processes one job per tick. Connection advisory locks serialize execution and disconnect across processes. Read jobs retry with backoff; uncertain provider writes/emails are not blindly replayed. Interrupted edge writes become uncertain and can be undone by discovering their deterministic rule refs. Work queue displays errors without provider credential-bearing payloads.

Tokens use existing `v1` AES-256-GCM token crypto and `GBP_TOKEN_KEY`; agency environment credentials are not copied to the database. Route bodies are bounded to 64 KB. The dedicated credential parser consumes malformed JSON errors so Express's `err.body` cannot enter the general logger. Cloudflare/GSC response bodies are excluded from request logs. Fixed provider hosts, timeouts, authenticated owner scope, validated identifiers/URLs, growth budgets, OAuth state/expiry and step-up checks are enforced.

New notification kinds, exported from `server/cloudflare/notification-kinds.ts` and included in the existing registry: `cloudflare.connected`, `cloudflare.disconnected`, `cloudflare.edge_changed`. `KIND_DEFAULTS` was not edited. Google connections reuse `google.connected` / `google.disconnected`; activity details identify Search Console.

## Owner configuration

1. Keep a persistent, backed-up **GBP_TOKEN_KEY** (32 bytes, base64) in production. Development uses the existing development-key fallback; production fails closed without the key.
2. Enable **EDGE_SEARCH_WORKER_ENABLED=true** on the intended app worker. Defaults off. While off, the UI clearly says queued work is waiting. Other workers and production were not touched in this lane.
3. For member onboarding set **CLOUDFLARE_AGENCY_EMAIL**, **CLOUDFLARE_AGENCY_TOKEN**, and **CLOUDFLARE_AGENCY_USER_ID** to the ConstructHUB owner authorized to use that credential. The agency credential needs user Memberships read/edit plus zone discovery/analytics/WAF rights for its invited memberships; configure the corresponding user/zone scopes in Cloudflare. Other ConstructHUB users cannot borrow that credential.
4. Add `https://www.googleapis.com/auth/webmasters` under Google Cloud → Google Auth Platform → Data Access; enable the Search Console API. Register the app's `/api/gsc/callback` redirect URI (local testing uses port 8169). Existing `GOOGLE_CLIENT_ID/SECRET` are reused. Sensitive-scope verification may be required; consent testing-mode token lifetimes are unsuitable for durable agency connections.
5. Email uses the existing delivery configuration. This lane exports **EMAIL_FORCE_SINK=1** and mocks email in provider integration tests. No real email or provider write was made for validation.

## Client walkthrough

### Cloudflare onboarding

1. Create a Cloudflare account and add the existing domain. Choose a plan; compare imported DNS with the current authoritative records. Preserve origin addresses and mail MX/TXT records. **The website stays hosted where it is.** Cloudflare is the DNS/proxy/security layer. Unproxied web traffic bypasses these rules.
2. Copy Cloudflare's exact assigned nameservers. Coordinate DNSSEC before changing them. In GoDaddy use Domain Portfolio → DNS → Nameservers → Change. In Namecheap use Domain List → Manage → Nameservers → Custom DNS. Google Domains registrations are managed by Squarespace: Domains → DNS → Domain Nameservers → custom nameservers. In Bluehost use Domains → DNS → Nameservers → Edit. Registrar labels may vary; their current help is authoritative.
3. Wait for Cloudflare to show **Active**; propagation can take up to 48 hours. Verify the website and mail before applying rules.
4. My Profile → API Tokens → Global API Key → View. Enter the Cloudflare login email/key under ConstructHUB → Cloudflare → Connections. Verify, search/select zones, Create limited key. The displayed token name and three permission groups identify what was granted. Never send the Global Key by email.
5. Alternative membership: invite the configured agency email under Manage Account → Members. For a selected domain, **Domain Administrator** is the domain-scoped role permitting these operations; it also grants full domain/DNS management and is broader than the scoped token. **Analytics** and **Firewall** are account-scoped alternatives covering every domain in the account, not per-domain roles. Do not grant Super Administrator or billing permissions. If broad domain rights are unacceptable, use the scoped token.
6. Fallback token: My Profile → API Tokens → Create Token → Custom token → Zone/Zone/Read, Zone/Analytics/Read, Zone/WAF/Edit. Include only the selected specific zones. Continue to summary → Create Token → paste in ConstructHUB's fallback field.
7. Undo protection before disconnecting if it should stop. Disconnect deletes cached data, jobs, and local credentials. ConstructHUB-created tokens are deleted using themselves if Cloudflare permits; otherwise the response tells you to delete the named token under My Profile → API Tokens. Pasted tokens and agency memberships must be revoked in Cloudflare. **Previously applied rules remain at Cloudflare after local disconnect.**

### Search Console onboarding

1. Agency connects Google in Connections and selects that connection for onboarding. Existing client locations need valid website URLs.
2. In Onboarding, find location IDs using the paginated search. Enter `client-email, location-id` per line and send instructions. The client grants the shown agency email **Full** property access.
3. Use Discover sites or wait for hourly discovery. Select properties and queue sync; choose a start date for historical data. Open a property to see its cached report and inspection coverage.
4. For sitemap submission or inspection enter `property-id, URL` per line. Sitemap submission asks for explicit confirmation. Inspections are queued and cannot request indexing.
5. Disconnect clears only local Search Console credentials/data. Revoking ConstructHUB at Google is account-wide for this OAuth client and may also disconnect GBP/Calendar; do that deliberately in the Google Account permissions UI.

## Honest limits and provider differences

- New external API tests use injected mocks throughout. Global-Key token creation is implemented as requested with X-Auth-Email/X-Auth-Key, but its live acceptance was intentionally not probed. Cloudflare's current Create Token documentation advertises API-token authorization with API Tokens Write; if an account rejects Global-Key creation, the UI reports the failure and the scoped-token fallback is required. The Global Key is never retained to work around a rejection.
- Cloudflare no longer exposes the old configurable **High** security level: current documentation describes Always protected, with security_level used for Under Attack mode. The pack does **not** silently substitute Under Attack mode or claim High was enabled. The guide explains this playbook deviation.
- WAF custom-rule counts, rate-limiting features, retention and bot-score fields depend on the Cloudflare plan. Provider refusal is visible. A partially applied pack has saved remote refs and an undo path. Preview cannot guarantee that a particular subscription accepts every rule.
- Cloudflare traffic is daily UTC data; events are the latest 100 and paths the top 20 for the window, with adaptive sampling. Unique visitors are shown per day, not summed into an invented cross-day unique count. These are caches, not complete firewall event export/history. Clicking Sync captures a new snapshot for before/latest comparison.
- GSC rows are Google's top rows and can omit anonymized queries. Current days are delayed. Coverage is only for URLs actually inspected, not Google's complete Page Indexing report. During pagination/failure, the report may be incomplete; the UI says so. No fabricated zeros fill absent data.
- Domain matching is exact after common normalization; one property can map to several owned locations sharing a site. It does not decide which client owns a shared multi-brand domain. The lane does not add a second agency/client authorization model; the a1 lane can consume the owner-scoped hooks.
- GSC automatically discovers grants hourly; analytics refresh is explicitly queued by the user. The worker must be enabled for discovery, onboarding emails, remote changes, and data sync. Connection metadata verification is synchronous; no list request performs per-site Google calls.
- Email delivery failures and ambiguous writes are surfaced as uncertain jobs instead of being sent/applied twice. Check the provider before retrying. No automated pruning policy for historical finished jobs or accumulated Search Analytics is introduced here.

## Test evidence

Validation uses only `/home/veto/ConstructHUB-a5`, port **8169**, database **constructhub_dev_a5**, Node **20.19.6**. No deployment, production access, git push, or other-lane process changes.

- `npm run check`: **zero errors**.
- Focused `server/cloudflare/*.test.ts` and `server/gsc/client.test.ts` (**20 new tests**): real lane-Postgres integration tests with injected Cloudflare/Google fetch and mocked email; Global-Key redaction (provider and malformed-JSON errors), encryption, permissions, OAuth state/scope, GBP grant isolation, owner/auth/reauth rejection, 1,000-location/property pagination, bulk enqueue with zero Google calls, metrics, property URL restrictions, daily inspection quota, explicit action confirmation, incremental apply/undo, uncertain writes, agency acceptance, disconnect, office exemptions and Site Scan cache isolation.
- Playwright `e2e/edge-search.spec.ts`: seeds 1,000 actual lane locations and 1,000 assets for each provider. Uses the real app/DB for pagination, bulk preview, step-up reauth, durable edge jobs, cached GSC analytics/inspection results, bulk sync/inspection enqueue and onboarding location search. External worker remains disabled; provider behavior is tested with mocks in Vitest.
- Browser commands: export lane env, `E2E_PORT=8169 E2E_DB=constructhub_dev_a5 npx playwright test --config playwright.edge-search.config.ts`. Growth browser server needs **VITE_FORCE_PORTAL=false**; true is for the separate CRM browser specs. Both use dev auth bypass.
- Full suite: `CRM_TEST_SINGLE_PORT=true CRM_TEST_BASE_URL=http://127.0.0.1:8169 CRM_TEST_DATABASE_URL="$DATABASE_URL" npx vitest run`. Single-port mode deliberately skips auxiliary-port suites; optional paid/credential-dependent cases also retain their existing skips. Final full run: **964 passed, 43 skipped**, **93 passing files / 2 skipped files**.

## Primary references checked

- [Cloudflare token creation](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/create/), [permission groups](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [membership API](https://developers.cloudflare.com/api/resources/memberships/), [account and domain roles](https://developers.cloudflare.com/fundamentals/manage-members/roles/).
- [Cloudflare nameserver setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/), [current Security Level behavior](https://developers.cloudflare.com/waf/tools/security-level/), [firewall GraphQL events](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-firewall-events/), [bot scores](https://developers.cloudflare.com/bots/concepts/bot-score/).
- [Google Search Console API](https://developers.google.com/webmaster-tools/v1/api_reference_index), [usage quotas](https://developers.google.com/webmaster-tools/limits).

## Final verification

- TypeScript: `npm run check` exited **0**.
- Full Vitest: **964 passed, 43 skipped**; 95 files (93 passed, 2 skipped), 76.90 seconds in the recorded final backend run. Skips are the existing single-port/optional-integration gates.
- Playwright: **2 passed**, 2.9 seconds; each provider exercised with 1,000 seeded assets and 1,000 seeded locations.
- Provider-boundary review additionally covers Cloudflare's documented `string` GraphQL scalar, rotating encrypted Google refresh tokens, and successful empty-body sitemap submissions.
- Backend commit: `b119a4b`. UI, Guides, browser specs and this report are in the following local commit. Nothing pushed or deployed.

Repeated full-suite runs can exhaust CRM’s existing in-memory limit of 10 password-reset emails per organization. Restart only the a5 dev server between repeated full runs; do not weaken that application limit. One repeated run encountered this 429 condition and was rerun against a fresh lane server.
