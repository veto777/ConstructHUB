# AUDIT3 a4 — Social Media and Guides

Audited 2026-09-29 in `/home/veto/ConstructHUB-a4`, port **8159**, database **constructhub_dev_a4**. Read CLAUDE.md, HANDOFF.md's shipped-features section and FEATURE-a1 through FEATURE-a5. No production access, deploy, push, external publication, paid AI request, R2 write or SMTP delivery. Explicitly labelled fixture content was used only in tests; fixtures are cleaned up. Google, Blotato, upload storage and AI boundaries were injected/intercepted. `EMAIL_FORCE_SINK=1`; GBP sync, Social and Site Scan workers disabled; GBP content worker also disabled. No other lane's process or database was changed.

## Results

| Flow | How exercised | Result |
|---|---|---|
| Connect Blotato; encrypt key; clear input | Real PostgreSQL with injected accounts HTTP; browser connection fixture; inspect ciphertext, response and activity | PASS |
| Owner-bound encryption and tampering | Wrong-owner decryption and modified ciphertext tests | PASS |
| Authentication and key redaction | Invoke authentication middleware on every registered Social route; inspect dashboard/upload response keys; provider failures use generic safe errors | PASS |
| Disconnect | Assert key deletion, disabled automation, cancelled drafts/unsent queue and activity; browser disconnect | PASS; submitted provider work remains external |
| Account ownership | Forged account ID and other-owner creation/action attempts | PASS |
| Facebook Pages | Reject unverified page; discover subaccounts; save verified page payload | PASS |
| Pinterest boards / LinkedIn pages | Inject discovery responses, reject target before discovery, accept afterward; assert Pinterest request path and cross-owner denial | PASS |
| Nine platform text limits | Parameterized exact-limit/over-limit/blank tests for Twitter, Facebook, Instagram, LinkedIn, Threads, Bluesky, TikTok, YouTube and Pinterest | PASS |
| Required platform fields | Missing media, Facebook Page, Pinterest board, YouTube title; explicit YouTube privacy and TikTok disclosures | PASS; file codecs remain provider-validated |
| Platform tweaks | Browser compose/tweak; persisted payload and request-fingerprint tests | PASS |
| Media Library and pasted URL | Browser attachment; real owner-scoped library route; exclude another owner's and nonpublic photos | PASS |
| Media URL validation | Private/reserved literals, alternate IPv4 encodings, local suffixes, credentials, HTTP, IPv6 and nonstandard ports | FIXED `711faf2` |
| Blotato upload | Inject upload URL response; browser raw-byte PUT; assert resulting public URL in post; reject invalid filename/private returned URL | PASS |
| Save draft during upload | Hold browser PUT open and assert Save draft disabled until completion | FIXED `6a52db5` |
| Post now / durable queue | Real insert and worker with injected provider; acceptance becomes submitted, polling becomes published, never duplicate POST | PASS |
| Scheduled post | Future queue row stays local; browser local datetime converted to ISO; payload not independently scheduled at Blotato | PASS |
| Draft, edit, approve, cancel | Real draft hold/edit/approval/cancel, final-state guards, cross-owner action denial; browser AI draft edit/approval | PASS |
| Overlength approval edit | Attempt 281-character Twitter approval; preserve draft and return actionable 400 instead of generic 500 | FIXED `488a57f` |
| Repeated/conflicting submission | Identical retry returns original IDs, including after approval edit; changed text/media/draft rejected, duplicate destinations rejected | FIXED `70a25ab`; compact stable SHA-256 fingerprint `7e6e8e4` |
| Rate gate / restart persistence | Real SQL reservation; second client denied; mocked provider 429 persists 120-second cooldown without another HTTP request | PASS |
| Uncertain and interrupted POST | Inject timeout and persisted submitting state; repeated ticks never re-POST; verify safe error/notice | PASS |
| Definitive provider failure | Inject 400 and terminal polling statuses; stored failure and existing notification delivery | PASS |
| Publication notifications | Confirm notification only after published polling; failure and uncertainty use existing kinds, preferences service and email mock | PASS |
| Concurrent owner mutation | Advisory-lock contention test; worker/connection/settings share owner lock | PASS |
| Auto approval / explicit automatic permission | Real generated drafts versus queued automatic posts, disabling holds pending work, simulated restart rechecks authorization; browser settings | PASS |
| Daily/weekly cadence and blackout | Persisted next generation avoids repeat tick; timezone/overnight/equal-hour tests; dispatch blocks auto work but allows manual post during blackout | PASS |
| Content mix and source rotation | Offers/tips cycling with two offers proves second category visit uses the second offer | FIXED `7d3e10c` |
| Business, project and review sources | Inject generator and inspect factual profile/photo/comment context; missing sources fail without generation; photo URL preserved | PASS |
| Missing required target before AI | Missing Facebook Page produces 400; generator never invoked and no budget row consumed | FIXED `64922aa` |
| AI budget | Real daily budget exhaustion; generated content marked AI; forced preview remains draft | PASS |
| GBP import | Inject Google snapshot; owner/link scope, recent LIVE STANDARD filtering, repeated import, deletion reconciliation | PASS |
| Manually supplied GBP update | No Google grant; exclude stale imports, use explicit manual source without an external call | FIXED `22356ce` |
| Content source CRUD | Real route create/list/delete; other-owner deletion denied | PASS |
| Social guides | Verify actual composer, queue, auto controls against page code and browser walkthrough | PASS |
| Security walkthrough | Compare shipped Security & activity, Enable 2FA / Verify & Enable, recovery/device, notification and activity labels; guide browser assertions and direct route link | FIXED `cffba7f` |
| Profile Guard walkthrough | Compare actual preview, identity verification, snapshot approval, Approve/Reject and manual Google reporting controls; browser guide assertions | FIXED `cffba7f` |
| AI replies walkthrough | Compare actual location/settings/scope/backfill/draft controls; explain explicit auto-publication and low-rating policy | FIXED `cffba7f` |
| Posts & Photos walkthrough | Compare actual upload/caption/style/batch/cadence/approval/history labels; explain unsaved drafts and uncertain retry | FIXED `cffba7f` |
| Site Scan walkthrough | Added linked-location/no-comparison, scan/progress, AI drafts, PDF/shares/revocation, monthly history and public verification instructions; browser follows route | FIXED `cffba7f` |
| Sidebar discoverability | Browser keeps Google Business collapsed; Social Media, Site Scan and Guides remain visible; Posts & Photos stays with Locations | FIXED `0b4ba5b` |
| Mobile / accessibility | 390×844 browser checks every Social tab's control bounds plus Guides; labelled guide region replaces nested main; sidebar exposes expanded state | FIXED `6b8a2f9`, `cffba7f`, `0b4ba5b` |
| Whole-repository test portability | Two merged GBP suites initially failed solely because they hardcoded a2; retain localhost/dev-name guards while using this checkout's a4 DB | FIXED `99bb734`; both suites pass |

## Validation

- `CRM_TEST_SINGLE_PORT=true npx vitest run`: **897 passed, 43 skipped; 89 files passed, 2 skipped**. The skips are existing conditional/single-port suites, not claimed passes.
- Focused Social suite: **39 passed**, real lane SQL with injected external boundaries.
- `E2E_PORT=8159 E2E_DB=constructhub_dev_a4 npx playwright test --config playwright.social.config.ts`: **4 passed**. Covers compose/schedule/tweak/library/upload/approval/auto/disconnect, shipped guide links, collapsed-sidebar discovery and phone layout. One intermediate navigation encountered the static application bootstrap instead of the app; the subsequent complete run passed. No live provider success is inferred.
- `npm run check`: **0 TypeScript errors** on the final repeat.
- Every functional/UI fix includes a regression assertion in `server/social/social.test.ts` or `e2e/social-media.spec.ts`. Test harness portability is verified by executing both previously failing suites on a4. Additional coverage commits: `9ca3a68`, `329862a`, `f98a4b4`.
- Migration is idempotent: adds nullable `social_posts.request_hash`. Existing pre-audit requests without a fingerprint fail closed on reuse with a 409; they are never silently replaced or resent. Reconnect/key encryption, recent-auth controls, provider request budgets and uncertainty protections remain intact.

## Ranked open issues and limitations

No known critical/high defect remains in the exercised offline flows. These limitations remain explicit rather than being reported as successful live tests:

1. **P2 — Multi-location auto context is not selectable.** `server/social/service.ts:401` selects the first saved business, and `sourceFor` uses owner-wide sources. Repro: save two businesses, select social accounts for the second, generate; the model context uses the first business. This is the existing single-business auto-mode design; adding an owner-scoped location/source selector is recommended before using one account for unrelated businesses. Manual composition is unaffected.
2. **P2 — Private Media Library assets are unavailable to Social.** `server/social/routes.ts:132` filters for public HTTPS URLs; `server/social/service.ts:342` stops project generation without one. Repro: populate the library only with authenticated proxy URLs, then open Social's library picker or generate Project photos. Use a public URL or Blotato upload today. A narrowly scoped, expiring publication URL bridge would support the private library without making the bucket public.
3. **P2 — Provider-specific media acceptance remains unverified.** `shared/social.ts:164` infers Facebook reels from `.mp4`/`.mov`; media validation does not inspect MIME/codec/dimensions. Repro: paste an extensionless Facebook video URL, or a JPEG for YouTube; the local queue accepts it and final acceptance is left to Blotato. No live publishing was allowed in this audit. Explicit video selection and upload MIME metadata would improve preflight without unsafe URL fetching.
4. **P3 — Throughput and history bounds.** `server/social/service.ts:489` processes ten due rows per owner, and `:615` visits owners sequentially; a slow provider can delay later owners. `server/social/routes.ts:77` returns only the newest 200 rows, without pagination. Repro: inject slow HTTP for the first owner to observe later work waiting; create more than 200 destination rows to omit older history. No production-scale load benchmark was run. Preserve per-key pacing and owner locks when adding bounded cross-owner concurrency and cursor pagination.
5. **P3 — Queue review could show more destination/media detail.** `client/src/pages/social-media.tsx:884` renders platform, text, state and source, but not a named account/page/board or media preview. Repro: create drafts for two accounts on the same platform; their rows are difficult to distinguish. Recommend explicit destination labels and media links/previews before approval.

## Recommendations

- Keep approval mode the starting point, especially for multiple locations; make the chosen business and exact destinations visible before enabling automatic posting.
- Add independent worker health/backlog visibility; explain when queued work cannot run, as Posts & Photos already does.
- Keep source deletion/offer expiry and uncertain-result handling explicit. Never automatically resend an ambiguous remote submission.
- Preserve the existing tests as offline provider contracts. In a separately authorized staging exercise, validate real account scopes, upload CORS, network-specific media and final public URLs using owner-approved content.

Provider contract references checked read-only: [Blotato account/page/board discovery](https://help.blotato.com/rest-api-reference/accounts), [create post](https://help.blotato.com/rest-api-reference/publish-post), [post status](https://help.blotato.com/rest-api-reference/publish-post/get-post), and [presigned media upload](https://help.blotato.com/api-and-mcp-concepts/media-uploads-and-conversion). These support the mocked request/response shapes, not a claim of live acceptance.

LANE DONE a4
