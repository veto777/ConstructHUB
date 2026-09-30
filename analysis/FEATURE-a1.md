# Lane a1 — Agency workspace and GBP onboarding

Implemented locally in `/home/veto/ConstructHUB-a1`. No deployment or push. All fixture data is labelled test data and removed after tests; no real Google, Blotato, OpenAI, Stripe or SMTP writes were made. Lane server: 8129; database: `constructhub_dev_a1`.

## What is available

- **Agency** in the growth sidebar (`/agency`): client records with contact email, notes, tags and optional folder; editable client records; workspace switching; team membership; onboarding; durable job progress.
- **Locations** now reads 50 rows per request. Search matches business/client name, address, city, state and Place ID. Client and status filters run in SQL. The dashboard counts locations that are synced, need reconnect, are unlinked, have pending Guard alerts, unanswered reviews or failed GBP content. Counts drill into the matching locations. A linked location without a successful sync is not counted as synced.
- Shared client/search/status controls and bulk location tools on Locations, its Guard/Insights/Citations detail screens, Google Profile Reviews/AI replies, Posts & Photos, Social and Site Scan. Select the current page or all matching locations. Changing search/client/status clears the effective selection. All-matching selections are frozen into job rows at submission, not expanded in the browser.
- Bulk sync, cached link-and-sync, unlink, client assignment, Guard mode, future AI reply settings, approved post/photo batches, and Site Scans. CSV streams matching or selected locations in bounded chunks and escapes spreadsheet formulas.
- Profile review statistics are computed for the full matching set. Reviews, scans, citation campaigns and social post lists page on the server at 50 rows. Social posts may be assigned to a client; the owner first assigns permitted destinations to that client in Social. Scoped members cannot publish to an unassigned social destination.
- Roles: owner (implicit, cannot be overwritten), admin, manager, viewer. Members can have all-client access or explicit client assignments. Viewers cannot mutate. Managers can operate accessible clients/locations. Admins can create clients with all-client access and inspect the team. Only the owner grants/revokes membership, configures invitation auto-accept-all and assigns social destinations.
- Every delegated legacy object route is checked against its actual location/client before passing owner identity to the existing handler. Unknown delegated routes fail closed with 404. Credentials, global automation and the owner-wide media library are not delegated. Queued jobs recheck membership and client access immediately before execution.

## Client email onboarding

1. Save a client with its contact email.
2. Connect the agency's Google account using the existing GBP connection. Agency → Settings exposes the connection and background discovery controls.
3. Agency → Onboarding: choose the client and connected agency Google email, enter the exact business name and an address or (preferably) Place ID, then email manager instructions.
4. A worker sends a ConstructHUB email containing the exact connected Google email, Google's help link and a copyable, expiring instructions link. The client adds that email as **Manager** in Business Profile → Business Profile settings → People and access. No client OAuth is needed.
5. The worker polls connected accounts, records invitations, accepts an unambiguous pending-request match, discovers the newly accessible listing, assigns it to the client and queues the first sync. Existing listings assigned to another client are not silently moved. A notification uses `notifyUser`; activity uses `logActivity`.

Status evidence: `sent` after delivery (`sent_at`; UI says “Email queued” before delivery), `opened` when the instructions link is visited, `invitation received`, `accepted`, `linked`, `expired`. “Opened” is a link visit, not proof a person read an email. Reminders are eligible after three days, at most two automatically; links expire after 30 days. A manual reminder is limited to one/day. Acceptance timeouts/crashes are recorded as uncertain and are not blindly retried.

Google endpoints verified against official docs on 2026-09-29:

- [List invitations](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts.invitations/list): `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts/{account}/invitations`. This method does **not** accept pageSize/pageToken; Google documents a maximum of 1,000 invitations per response.
- [Accept invitation](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts.invitations/accept): `POST https://mybusinessaccountmanagement.googleapis.com/v1/accounts/{account}/invitations/{id}:accept`, empty JSON body.
- [Google manager instructions](https://support.google.com/business/answer/3403100).

Matching prefers exact Place ID. Otherwise it requires normalized name **and** address. Conflicting Place IDs do not fall back to names. Ambiguous matches do not choose a client arbitrarily. Auto-accept-all is off by default and accepts location invitations without guessing client assignments; unmatched listings are available through the discovery cache for explicit linking/import.

## Queue and scale

`server/agency/schema.ts` owns idempotent schema ensures, registered beside `ensureGbpSchema`. No Drizzle schema push. The existing GBP project limiter (201 ms request spacing, shared database budget) remains the sole Google limiter.

The agency worker replaces the booted periodic inline sync sweep with persisted per-location jobs. It replenishes up to 500 scheduled jobs/tick, deduplicates active syncs, rotates by the least recently served agency, prioritizes explicit work over routine syncs and ages older jobs. Cross-process advisory locking prevents concurrent dispatch/recovery. Transient failures retry with backoff; quota deferrals stay queued without exhausting attempts. Bulk admission caps pending work at 20,000 per owner and payload expansion at 64 MiB per submission. CSV and UI never fetch all locations into browser memory.

GBP account/listing and linkage GETs read an owner-scoped discovery cache instead of calling Google. Import verifies a fresh (24-hour) cached Google identity and queues sync. OAuth completion queues background discovery. Manual refresh is available in Agency settings. Existing direct service APIs remain available to workers and mocked tests.

## Tests

Final verification (Node 20.19.6, exported lane environment):

- `npm run check`: exit 0, no TypeScript errors.
- `CRM_TEST_SINGLE_PORT=true npx vitest run`: **91 files passed, 2 skipped; 955 tests passed, 43 skipped**, 91.98 seconds. Existing single-port/optional integration skips are reported, not counted as passes.
- `E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npx playwright test --config=playwright.agency.config.ts`: **3 passed**. Growth browser server uses `VITE_FORCE_PORTAL=false`; CRM HTTP integrations still target this lane's DB and port.
- Targeted agency + Google client boundary run: **28 passed**, including Google's empty 200 accept-invitation response.
- `git diff --check`: clean.

Test coverage includes:

- Idempotent schema ensure; 5,000-location SQL paging/search/status counts and 1,000 explicitly assigned locations.
- 1,000 each of profile reviews, scans, citation campaigns and social posts: pagination and hidden-client isolation.
- HTTP handler validation, scoped legacy deep links, 404 isolation, viewer/admin/owner rules, frozen all-matching selection, idempotency, access revocation before job execution, worker fairness and priority.
- Guard snapshot prerequisites and reauthentication; AI drafts; content queue idempotency; Site Scan enqueue; unlink using existing services, all without external calls.
- Mocked Google invitation list/accept/discovery, exact agency-email instructions, token encryption, linking, sync queueing and non-replayed acceptance.
- Playwright: 1,000 locations, search, page two, select-all matching, bulk queue, CSV, deep link, client create/edit, scoped team assignment and email onboarding instructions/link-open status.

## Configuration and honest limits

- The local server is deliberately started with `GBP_SYNC_DISABLED=true`, `GBP_CONTENT_WORKER_ENABLED=false`, `SITESCAN_WORKER_DISABLED=true`, `SOCIAL_WORKER_DISABLED=true`, and `EMAIL_FORCE_SINK=1`. Thus browser-created work queues but does not call providers. Worker tests use injected Google clients and email functions.
- Deployment is outside this lane. To operate later, configure a persistent `GBP_TOKEN_KEY` (32-byte base64 AES-256-GCM key), Google OAuth and approved/enabled GBP APIs, `APP_URL`, and email delivery. Invitation link tokens are encrypted at rest and only hashes are used for lookup; agency responses and token paths are omitted/redacted in request logs.
- Keep the existing publishing and AI budgets. Site Scans remain limited to five/day/owner; content publishing remains 100/day/owner, AI replies 50/day/owner. Bulk actions queue under those limits rather than bypassing them.
- Bulk Guard enablement requires each location's existing approved snapshot. Locations without one fail with an explicit prerequisite, retaining the original security and approval flow. Bulk AI settings apply to future reviews; historical backfill retains its individual preview/confirm flow.
- Team members need an existing ConstructHUB login. Team membership does not invite/create a login by email; the email onboarding feature here is specifically Google manager access.
- Global Social automation and shared media/source libraries remain owner-controlled. Client filtering applies to mapped social posts and permitted destinations; existing unmapped posts belong to the all-client/owner view. This does not silently repurpose agency-wide automation for an individual client.
- Discovery and invitation polling are background tasks using the existing fully paged Google client. Very large multi-account discoveries can take several ticks' worth of wall time while sharing quota with other workers. No Google listing results or profile statistics are invented when discovery is incomplete.
- Google invitations missing both usable Place ID and address require agency review. Uncertain acceptance requires checking Google; there is no automatic re-accept button. Auto-accepted unmatched invitations are not automatically assigned to a guessed client.
- The profile-review tab uses agency filtering; the separate legacy customer review-request/template workflow is still personal-account functionality, not a client-delegated email campaign system.
- Existing provider APIs and schema modules are reused. **No new notification kind was introduced**, and `KIND_DEFAULTS` was not changed.
