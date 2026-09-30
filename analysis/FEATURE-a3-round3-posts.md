# Lane a3 — Google Business Posts & Photos

Implemented in `/home/veto/ConstructHUB-a3`, branch `lane/a3`, using only the a3 database and development server on port 8149. No deploy, push, production access, real Google publishing, R2 upload, SMTP delivery, or paid AI calls were performed.

## UI and usage

Open **Google Business → Posts & Photos** (`/gbp-content`). Choose an existing linked location; unlinked locations use the existing GBP connection controls.

1. Select library photos or choose up to 100 JPEG, PNG, or WebP files. Uploads run sequentially, at most 15 MB per request. Set a filename pattern (`{business}`, `{city}`, `{n}`), EXIF title and optional GPS pair. Existing-library processing creates copies rather than overwriting originals. New R2 objects preserve the SEO filename after a random directory component.
2. Supply instructions and/or example descriptions, then generate AI caption drafts. Each selected image is sent to the vision model. Captions are editable; caption generation never queues or publishes anything. The browser requests one caption at a time and retains completed captions if a later request fails.
3. Compose a STANDARD, EVENT, or OFFER update manually or generate a draft using the stored business profile, services, instructions, examples and saved style. Attach up to ten selected photos. Event and offer dates are entered in the location's local time. Add distinct posts to the editable draft batch for cadence publishing.
4. **Learn from past updates** retrieves every local-post page and generates themes, tone, length and CTA guidance. Large histories use bounded chunks and hierarchical summaries. Edit and explicitly save this guidance before it is used in new generations. No source posts means an honest empty result, not invented guidance.
5. Set the first publish time (blank means now), items per day/week or one custom timestamp per item. Optionally select a timezone, weekdays and opening/closing hours. These publishing hours are explicitly entered, not inferred from Google. Approve the photo set or post batch to create durable queue rows.
6. Queue/history shows per-item status, Google resource/state, errors, retry and cancel controls. The calendar is a date-grouped agenda. **Refresh Google status** retrieves current states for the latest 100 submitted local posts. A Google API acceptance does not itself guarantee public visibility.

## Server and persistence

- `server/gbp/content.ts`: boot migration, input validation, owner-scoped routes, AI adapter, scheduler, queue, worker, history learning, status refresh, and additional notification-kind map.
- `server/gbp/content-upload.ts`: authenticated upload/processing routes and SEO names, reusing `server/photo-processor.ts`.
- `server/r2.ts`: backward-compatible optional safe JPEG filename argument.
- `server/gbp/client.ts`: non-idempotent POST requests are never silently retried. Actionable Google error text is bounded and bearer credentials are redacted.
- `server/routes.ts`: registers `ensureGbpContentSchema`, routes, uploads and optional worker next to existing GBP boot setup.
- `client/src/pages/gbp-content.tsx`, sidebar and application routes: page and navigation.

`ensureGbpContentSchema()` creates `gbp_content_jobs` and `gbp_content_style`, plus indexes and an idempotent schedule column ensure. No drizzle-kit push. No new credentials or tokens are persisted or returned.

The queue snapshots the Google account/location/subject. Relinking prevents old jobs from publishing to a different target. Per-user submission keys and an advisory transaction lock deduplicate requests; attempts to reuse a key with different content are rejected. A database advisory worker lock and conditional claims serialize dispatch across processes. Jobs survive restarts. Business hours are checked again at dispatch, so late jobs do not publish outside the configured window.

Google's create APIs have no documented idempotency key. A timeout, invalid successful response or process interruption becomes `uncertain`, never an automatic resend. The UI requires acknowledgement that the user checked Google before retrying. This avoids claiming impossible remote exactly-once semantics. Definitive errors are `failed`; Google moderation rejection at create time is `rejected` and requires corrected content.

Quotas use existing `takeBudget` and the GBP database project limiter: 100 publish attempts/user/UTC day, 100 AI calls/user/UTC day, 100 processed photos/user/hour, and 180 content mutations/user/10 minutes. AI synthesis calls also consume budget. Exhausted publish budgets defer queued work to the next UTC day; business hours still apply. Google quota errors require explicit retry.

Successful submissions call `notifyUser('gbp.post_published')` and `logActivity`. Failures/interrupted work call `notifyUser('gbp.post_failed')`. New kind `gbp.post_failed` is declared only in exported `CONTENT_NOTIFICATION_KINDS` in this module. `KIND_DEFAULTS` is unchanged. It uses the existing notification system's fallback (in-app on, email off); the current global preference editor does not list this additional kind.

## Owner configuration

- Enable the approved Google My Business API and link the correct Google account/location using the existing flow.
- Configure `GBP_MEDIA_PUBLIC_BASE_URL` as a public HTTPS origin that serves R2 `media/` keys anonymously. The application's existing file proxy/private S3 endpoint is not used as Google's source URL. Configured public URLs are also used for library previews, including legacy two-segment R2 keys. Configure public access deliberately for publication assets; do not expose unrelated private bucket prefixes. Missing public-base configuration prevents photo queueing and vision generation.
- Existing `R2_*` credentials are needed for upload and metadata processing.
- Existing `AI_INTEGRATIONS_OPENAI_API_KEY` and optional base URL configure AI. `GBP_CONTENT_AI_MODEL` defaults to `gpt-4o-mini` and can be changed to a compatible vision/chat-completions model. AI is optional for manually composed content.
- Set `GBP_CONTENT_WORKER_ENABLED=true` only in the intended publishing environment. Default is disabled, visibly reported by the UI; enabled workers poll every 15 seconds. The development lane remains disabled. Email testing uses `EMAIL_FORCE_SINK=1`.

## Validation

All external boundaries in feature tests are mocked. JPEG/EXIF processing and SQL persistence are real.

- `npm run check`: zero TypeScript errors.
- `EMAIL_FORCE_SINK=1 CRM_TEST_SINGLE_PORT=true npx vitest run`: **796 passed, 43 skipped**, 83 passing files / 2 skipped files. The skips are existing suite behavior, including auxiliary-port suites disabled by the required single-port setting.
- `E2E_PORT=8149 E2E_DB=constructhub_dev_a3 npx playwright test --config playwright.content.config.ts`: **3 flows**: real API cadence/reload/cancellation; bulk-upload/caption/style approval with provider fixtures; AI-post editing, explicit approval and retry after Google failure.
- Thirteen focused unit/integration cases include DST/weekend scheduling, custom-time validation, owner isolation, submission deduplication, concurrent workers, restart ambiguity, cancellation/retry, real EXIF bytes, Google payloads, paginated learning, daily AI budgets, local event times, dispatch-time hours, error redaction and mocked vision HTTP payloads. Route handlers run in process without another listening port; browser HTTP uses 8149.

## Limits and honest caveats

- Google strips EXIF; GPS/title metadata is cosmetic, with no ranking benefit promised. Google does not accept cover-photo descriptions, and the API cannot edit media descriptions after creation. Both are explained in the UI.
- Google may reject photo dimensions, content, location eligibility or permissions; errors are preserved per item. Real provider acceptance remains unverified by design in this lane.
- Cadence means elapsed spacing; closed hours move items later and may reduce the count within a particular calendar day/week. Business hours support one same-day window; no overnight/split windows or holiday calendar. No infinite recurring content generation: a batch contains up to 100 explicitly approved items.
- Composition/caption drafts and unsaved learned guidance live in the current browser page; reloading loses unsaved drafts. Approved queue items and saved guidance are durable. Changing queued content requires canceling and submitting a corrected draft.
- The library and queue show the latest 1,000 records. Status refresh covers the latest 100 locally submitted posts. External historical posts are used for learning rather than imported as editable queue jobs.
- Learning very large histories and processing 100 existing-library copies can take a long request; AI budgets stop excess work with an explicit error. Uploading 100 files is bounded/sequential, not one giant buffered multipart request.
- Notification/activity delivery is best effort after the durable result is saved; notification failure does not retry an already successful Google write.

## Verified provider references

- [Google media resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media): public source URL, category, descriptions, cover restriction.
- [Google local-post create](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create) and [local-post resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts): v4 endpoint and post payload/state.
- [Official OpenAI GPT-4o mini documentation](https://developers.openai.com/api/docs/models/gpt-4o-mini) and [vision inputs](https://developers.openai.com/api/docs/guides/images-vision): vision-capable text generation and image URL content parts. Checked using the OpenAI Docs skill; no API calls were made for documentation verification.
