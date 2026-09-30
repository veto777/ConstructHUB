# Feature lane a4 — Social Media and Guides

Built on `lane/a4` from main `7d2f1d4`, in `/home/veto/ConstructHUB-a4`. Only local port **8159** and database **constructhub_dev_a4** were used. No deploy, push, production access, real social publication, paid AI call, or live email delivery was performed.

## What was built

Growth sidebar → **Google Business → Social Media** (`/social-media`) and **Guides** (`/guides`).

- Customer-owned Blotato connection verified with `GET /users/me/accounts`; account IDs come from the provider. Keys are encrypted with AES-256-GCM, random IVs, authentication tags, and owner-bound associated data. API responses never include the key. Connect/disconnect use `logActivity`.
- Compose for X/Twitter, Facebook Pages, Instagram, LinkedIn profiles/pages, Threads, Bluesky, TikTok, YouTube and Pinterest. Platform tweaks and text counters; page/board discovery; YouTube title/privacy; TikTok visibility and commercial-content choices. Server validation checks owner account/page/board selection, text limits, and required media/target fields.
- Public HTTPS media URLs, existing owner-scoped Media Library photos, and the documented Blotato local-file upload flow (`POST /media/uploads`, browser PUT to a presigned URL). The Blotato key stays on the server. Social API response bodies are excluded from the existing request logger, including signed upload URLs.
- Save draft, post now, or schedule for a browser-local time. A durable Postgres queue owns scheduling; it submits to Blotato when due, rather than scheduling twice. Each destination has an independent row and state. Calendar day filter, chronological agenda, approval editing, cancellation, and history with provider status/publication links.
- Restart-safe worker, owner advisory locks across processes, unique request/destination keys, and a database-backed rate gate keyed by the SHA-256 fingerprint of the customer's Blotato key. Minimum spacing is 2.1 seconds, below 30 requests/minute even when a key is shared by multiple local users/processes. Provider 429 cooldown persists across restarts.
- Blotato acceptance is `submitted`, not `published`. Polling confirms published/failed. Network failures or interrupted POST acknowledgement become **uncertain** and are never automatically re-POSTed. This avoids duplicate publication when provider idempotency is not documented.
- Existing `notifyUser` delivers `social.post_published` and `social.post_failed` according to existing preferences. Uncertain submissions also use `social.post_failed` with explanatory text. No notification system or `KIND_DEFAULTS` edits were introduced. Activity-only strings: `social.connected`, `social.disconnected`, `social.auto_changed`; no new notification-kind map is needed.
- Auto mode: destinations, evenly spaced daily/weekly cadence, rotating content mix, business instructions, examples, IANA timezone, overnight blackout hours, approval vs explicit fully automatic permission, and a bounded per-user daily AI generation budget via `takeBudget`. Uses the existing OpenAI configuration through an injectable generator. Generated text remains labelled AI-generated, with approval drafts as the default.
- Real content sources: saved business profile, project photos from Media Library, synced Google review text, explicit contractor offer text, and recent published GBP standard updates. `Sync recent GBP updates` uses the existing multi-account Google client and quota gate, scoped to linked locations. The same import runs before automatic GBP generation. It accepts only `LIVE` / `STANDARD` posts from the last 30 days, filters media URLs, and reconciles each complete location snapshot. It does not depend on the other lane's Posts & Photos table. Offers/GBP text may also be entered manually.
- Guides cover connection, manual posts, auto mode, and the requested generic Profile Guard, AI review replies, Posts & Photos and Security walkthroughs. Other-lane labels are explicitly described as rollout-dependent.

## Files and migration

`server/social/{schema,client,service,routes,gbp-sources}.ts`, `shared/social.ts`, `client/src/pages/{social-media,guides}.tsx`, plus boot/router/sidebar wiring. `ensureSocialSchema()` runs beside `ensureGbpSchema()` at boot and is idempotent. New tables: `social_connections`, `social_rate`, `social_settings`, `social_posts`, `social_sources`. No drizzle-kit operation.

All Social API handlers require authentication; SQL is bound to `user_id`; path/body inputs use Zod; mutations use the existing growth rate limiter. The worker has no public trigger endpoint. In-flight mutations and disconnect/auto changes share an owner lock.

## Walkthroughs

### Get and connect Blotato

1. Visit [Blotato](https://www.blotato.com) and create your own account. **Blotato is a separate subscription you buy from Blotato.** Creating an API key activates its paid subscription; ConstructHUB does not bill it.
2. Connect the social accounts you manage inside Blotato. Grant the appropriate Facebook/LinkedIn page access.
3. In Blotato Settings → API, create/copy your key.
4. Open ConstructHUB → Social Media, paste **Blotato API key**, and choose **Connect Blotato**. The field clears after submission and the stored key cannot be retrieved.
5. Choose accounts in Compose. Use **Refresh pages** / **Refresh boards**, then select each target.
6. **Disconnect** removes the key, disables auto mode and cancels unsent local drafts/queue entries. It does not cancel already-accepted provider posts or your Blotato subscription.

### Manual posting

1. In Compose, choose accounts/pages and enter **Post text**.
2. Adjust each platform's text; watch its counter. Attach Media Library photos, paste public R2/other HTTPS URLs, or use **Upload through Blotato**.
3. Supply required title/privacy/media fields for the selected platform. TikTok defaults to private. YouTube also defaults to private.
4. Choose **Post now**, or fill **Schedule time** and choose **Schedule post**. **Save draft** holds the post locally.
5. Open **Calendar & queue**; filter a day or see the agenda/history. Edit a draft and **Approve & queue**. **Cancel** works only before submission.
6. Follow **View published post** or **Open Blotato status**. If uncertain, verify in Blotato before creating another post. The UI includes the submission ID when it was acknowledged.

### Auto mode

1. Save business details in Locations; add real public project photos to Media Library. Sync Google reviews if desired.
2. Select accounts/pages in Compose. Under Auto mode, choose **Use accounts selected in Compose**.
3. Configure cadence, content mix, instructions, examples, timezone, blackout hours, and daily AI request budget.
4. Add factual offers under **Content sources**; remove them when they expire. **Sync recent GBP updates** imports recent live standard updates from linked Google locations. Automatic GBP generation refreshes that source itself.
5. Choose **Approval queue**, enable auto mode, then **Save auto settings**. **Generate draft from saved settings** previews a draft without publishing, even when fully automatic is saved.
6. Review/edit drafts in Calendar & queue, then approve. Only choose **Fully automatic — publish without review** when that is your intended authorization.
7. Disable auto mode to stop generation and return pending unapproved automatically generated queued posts to drafts. Already submitted posts stay in Blotato. Missing sources/media and budget failures are shown in auto settings.

### Other feature walkthroughs (generic pending merge)

- **Profile Guard:** Open the location's Profile Guard. Choose Off, Notify or Lockdown. Review detected changes, approve/reject as appropriate, and use reporting to inspect actions and failed restorations.
- **AI review replies:** Open Google Reviews, sync reviews, generate a draft, check facts/tone/privacy, edit and publish or retain the draft. Automatic reply settings are an explicit publishing permission. Check posted status.
- **Posts & Photos:** Select the business and real media/update, generate and review an AI caption if wanted, set the schedule and confirm. Follow queue status and fix connection/media failures before retrying.
- **Security:** In Settings → Security, enable and verify 2FA, keep recovery codes private, remember only personal devices, remove old devices, complete requested re-authentication, set notification preferences, and inspect the activity log for unfamiliar connections/devices.

## Owner configuration

- Set `SOCIAL_ENCRYPTION_KEY` to a stable, securely generated 32-byte key encoded as **64 hexadecimal characters**. It is intentionally not provided or stored in this report. Back it up securely; rotation currently requires customers to reconnect.
- Configure the existing `AI_INTEGRATIONS_OPENAI_API_KEY` and optional base URL for generation. `SOCIAL_AI_MODEL` defaults to `gpt-4o-mini`. Validate the desired model/account before enabling paid production generation.
- Keep `SOCIAL_WORKER_DISABLED=true` in feature lanes/tests. The owner must unset it or set `false` in the approved deployment to run the 15-second worker. Keep `EMAIL_FORCE_SINK=1` in lanes.
- Customers buy/connect their own Blotato subscriptions/accounts. GBP sources require the existing Google permissions, enabled APIs, valid grant and linked locations. Public media must be reachable by the provider and comply with each network's format requirements.

## Validation

- `npm run check`: **0 errors**.
- `CRM_TEST_SINGLE_PORT=true npx vitest run` with Node 20 and the lane `.env` exported: **802 passed, 43 skipped; 83 test files passed, 2 skipped**. Existing auxiliary-port and explicitly disabled suites remain skipped; no skipped test is claimed as passed.
- **19 Social unit/integration tests** use real lane Postgres plus injected Blotato/Google fetch clients and an injected AI generator; email delivery is mocked. Covers migration re-entry, owner-bound encryption, limits, target validation, owner isolation, page lookup, idempotent enqueue, polling, drafts/schedules, crash/uncertain recovery, shared rate reservation, notifications, locks, AI budget/approval/automatic mode, disconnect, GBP source filtering/reconciliation, and route authentication/redaction.
- `E2E_PORT=8159 E2E_DB=constructhub_dev_a4 npx playwright test --config playwright.social.config.ts`: **1 passed**, exercising connect, key-field clearing, compose/tweak/media, schedule, AI draft approval, automatic settings, disconnect, and all Guides sections. Social API responses are browser fixtures; no provider request is sent. Server integration tests independently exercise persistence/state transitions.
- Mobile smoke check at 390 px: no browser page errors and no horizontal document overflow; the connection/composer navigation rendered correctly.
- Browser server needs `VITE_FORCE_PORTAL=false` for this growth feature, with `DEV_AUTH_BYPASS_USER1=true`. CRM browser specs instead use `VITE_FORCE_PORTAL=true`.

## Limits and honest caveats

- Live provider success has deliberately not been tested. Real subscriptions, token scopes, app permissions, account restrictions, media codecs/dimensions, CORS on upload storage, and provider availability still determine live outcomes.
- Scheduling is local and durable, so the app must be running to dispatch. Downtime delays posts; there is no cadence catch-up burst. Delivery is not precise to the second. Blackout applies to auto-generated work, not manually composed schedules; equal hours disable blackout.
- AI drafts use the first saved business location. The engine rotates evenly through selected content categories and available recent sources; it is not an image-vision analyzer or an offer-expiry parser. Missing/invalid media or sources block that generation and surface an error; no synthetic business facts are inserted as fallback. Approval remains the prudent default.
- GBP import is limited to 20 linked locations and recent live **standard** posts. Google offers/events are excluded to avoid losing expiry/terms. It is a read-only bridge and does not publish to Google. Source refresh reconciles only complete location snapshots.
- History is the latest 200 local destination rows; the calendar is a date-filtered agenda, not drag-and-drop. One page/board per connected account can be selected in a composition in this UI. Additional pages can be composed separately.
- Character counters are plain Unicode code-point counts; network-specific weighted URL/emoji rules, media restrictions, and optional advanced features remain provider-validated. No Stories, thread chains, thumbnails, platform-specific media overrides or video transcoding UI is included.
- Blotato does not document a create-post idempotency key. Uncertain submissions intentionally stop; the user must inspect Blotato before any manual replacement. Notifications are delivered at least once across a crash between delivery and its local completion marker, so a crash at that point can duplicate a notification, never a deliberate POST retry.
- Disconnect is local; revoke/delete the API key or cancel billing inside Blotato separately. Submitted posts cannot be cancelled from this initial UI. Key replacement does not rewrite already submitted payloads.
- Generic other-lane guides do not assert those features have shipped in this branch. The owner should adjust labels after merge.

## Can social posting work without Blotato?

**Yes, with separate direct network integrations; that is not implemented by this lane.** Each needs its own OAuth grants, secure token storage/refresh, account/page selection, media upload pipeline, scheduler/status handling and ongoing API maintenance.

| Network | Direct path and access requirements | Paid access considerations |
|---|---|---|
| Meta (Facebook/Instagram) | Meta Graph / Instagram publishing endpoints. Facebook Pages and eligible professional Instagram accounts, appropriate publishing permissions, and App Review/advanced access for a multi-customer app; business verification requirements depend on the chosen login/product permissions. Own-app test roles are not general customer approval. | Do not assume a paid subscription substitutes for review. No blanket per-post paid tier is established by the cited publishing docs; confirm the exact product in the app dashboard. |
| LinkedIn | Member posting can use the self-service Share on LinkedIn permission. Organization/page community management requires LinkedIn access vetting; Development → Standard tier involves an app review and demonstration. | Development/Standard are approval/access tiers, not a documented universal per-post subscription price. Confirm eligibility and any commercial agreement with LinkedIn. |
| TikTok | Content Posting API with approved `video.publish`, user authorization and compliant creator controls. Unaudited direct-post clients are restricted to private visibility; an audit is required to lift that restriction. | The cited direct-post guide does not establish a mandatory per-post paid tier. Approval/audit is the gate, not buying Blotato or TikTok account verification. |
| X | X API write endpoints, a developer app/project, user-context authorization and compliance with developer/automation policies. | Current documentation describes prepaid **pay-per-use credits**, not the historical Free/Basic/Pro monthly tiers. Configure spending limits; writes cost money and prices can change. |

Sources checked 2026-09-29:

- [Blotato quickstart (moved from `/api/start`)](https://help.blotato.com/start-with-an-ai-agent/start), [accounts/pages](https://help.blotato.com/rest-api-reference/accounts), [create post](https://help.blotato.com/rest-api-reference/publish-post), [status polling](https://help.blotato.com/rest-api-reference/publish-post/get-post), [media uploads](https://help.blotato.com/api-and-mcp-concepts/media-uploads-and-conversion). The documentation's full Markdown export was also read to verify target fields and local-file upload behavior.
- [Google local-post listing](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/list) and [LocalPost resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts).
- [Meta's official publishing sample](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md) and [App Review](https://developers.facebook.com/docs/app-review/). Meta's documentation site was not retrievable through the browsing tool; verify exact current permission/business-verification requirements in the owner dashboard before starting a direct integration.
- [LinkedIn Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) and [Community Management app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review).
- [TikTok Direct Post getting started](https://developers.tiktok.com/docs/en/content-posting-api-get-started) and [creator information/privacy controls](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info).
- [X pay-per-use pricing](https://docs.x.com/x-api/getting-started/pricing).
