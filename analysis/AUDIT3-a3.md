# AUDIT3 — lane a3: Posts & Photos and GBP profile sync

Audited 2026-09-29 in `/home/veto/ConstructHUB-a3`, branch `lane/a3`, port **8149**, database **constructhub_dev_a3**. Read `CLAUDE.md`, the shipped-features handoff, and feature reports relevant to the GBP/security integration. No production access, deployment, push, paid provider calls, external publishing, or other lane process changes. Only this lane's server was restarted. Email used `EMAIL_FORCE_SINK=1`; GBP, Social, Site Scan and content background workers were disabled. Explicit worker tests use injected Google clients.

## Outcome and validation

**13 fixes**, each in its own commit with regression coverage, plus three test-only commits. No known critical or high-severity issue remains in the exercised paths. The ranked remaining issues below are explicitly not claimed fixed.

- Final `CRM_TEST_SINGLE_PORT=true npx vitest run`: **890 passed, 43 skipped; 89 files passed, 2 skipped**, 77.37 seconds.
- Final `npm run check`: **0 errors**.
- `E2E_PORT=8149 E2E_DB=constructhub_dev_a3 npx playwright test --config playwright.content.config.ts`: **10 passed**, 9.1 seconds.
- `git diff --check`: clean.
- The first full run exposed two inherited test guards hardcoded to a2. `fc8c7e8` permits isolated localhost development lane databases, retaining rejection of production/nonlocal targets. Those 22 tests now execute on a3 rather than failing their setup.

Google, AI, uploads and storage are offline fixtures/injected boundaries. Queue, ownership, sync and state transitions use real lane Postgres. JPEG conversion and EXIF bytes are real. The browser's successful upload/AI/Google responses are fixtures; a 100-file browser pass does **not** establish live R2 throughput or Google acceptance. The existing 43 conditional/single-port skips are not counted as passes. Browser security enrollment is another lane's scope; this audit preserves auth, encryption and step-up invariants.

## Flow matrix

| Flow | How exercised | Result |
|---|---|---|
| Bulk upload: 100 versus 101 files | Browser selects 101 and asserts zero upload requests; selects 100 and verifies all 100 saved/selected through mocked upload boundary | PASS |
| Upload failure midway and retry | Second of two uploads fails; first photo/caption immediately visible; retry remaining file succeeds without re-uploading first | FIXED `e81a525` |
| SEO filename and EXIF title/GPS | Actual JPEG conversion, safe filename, decoded XPTitle and GPS hemispheres/degrees; injected upload verifies filename argument | PASS |
| Existing-library processing copies | Inspected owner-scoped copy INSERT and 15 MB read bound; actual processor tested independently | OPEN: partial batch recovery, issue 2 |
| Caption instructions/examples/style | Mocked vision boundary verifies image URL, supplied instructions/examples and saved style; editable browser captions remain drafts | PASS |
| Compose/generate/edit/approve | Browser manual two-post batch, AI draft editing, explicit approval; DB queue survives reload | PASS |
| STANDARD/EVENT/OFFER and CTA validation | Unit/integration payload construction, event local times, missing event/offer range, invalid CTA URL, cover-description suppression | PASS |
| Impossible event dates | Non-leap February 29 and 24:00 rejected; valid leap-day accepted without date normalization | FIXED `6657b3e` |
| Learn from past updates | Injected two-page Google history, learned guidance saved explicitly, subsequent caption prompt contains owner-edited style | PASS |
| Daily, weekly and custom cadence | Deterministic timestamp assertions; custom count and outside-hours rejection; browser weekly two-item elapsed spacing | PASS |
| Business hours/timezones/DST | Spring and autumn New York transitions, closed weekends, invalid timezone; due worker defers outside selected hours | PASS; same-day-window limit remains |
| Queue batch cap/ownership | Real DB accepts 100 photo jobs, rejects 101; cross-owner reads, media and writes denied | PASS |
| Durable dispatch and deduplication | Repeated request key, changed-content conflict, concurrent worker locks, one provider POST, persisted terminal state | PASS |
| Restart ambiguity/retry/cancel | Persisted `publishing` becomes `uncertain` without resend; retry needs Google-check acknowledgement; cancellation prevents dispatch | PASS |
| Relink protection | Change queued job's location resource; worker records failed linkage check and makes zero provider writes | PASS |
| Signed links minted at dispatch | Queue holds `r2:media/...`; clock advances two days; captured Google payload receives a fresh one-hour signed URL | PASS |
| Signature expiry/tampering/non-media keys | Key/expiry tampering, expired signatures and private-prefix signatures rejected; invalid public request makes zero storage calls | PASS |
| Missing signing configuration | Missing both secrets now refuses signing and rejects verification instead of using a predictable fallback | FIXED `619255d` |
| Public media streaming | Valid signed request streams fixture bytes; failing readable stream is contained by pipeline | FIXED `2f358c5` |
| Later Google moderation rejection | Refresh transitions published job to rejected, stores correction guidance, emits failure notification/activity; repeat refresh does not repeat notification | FIXED `0fc2bec` |
| Notifications/activity and budgets | Real notification/activity rows after injected worker success; AI budget refuses provider call; bounded retry behavior | PASS for normal execution; OPEN crash gap, issue 1 |
| Complete profile mapping | Deterministic fixture covers name, phone, website, all address fields, categories, description, service areas, freeform service, opening date/status, Place ID, Maps URI and seven social platforms | PASS |
| Structured services/hours/photo counts | Real DB sync asserts category service catalogue mapping, custom service, split/24-hour/closed hours and business/customer counts | PASS |
| Overnight profile hours | Monday-to-Tuesday and Sunday-to-Monday periods split into correct calendar-day intervals | FIXED `108d784` |
| Social removal and optional endpoint failures | Removed Google social link disappears; local-only keys survive; failed attributes/media preserve previous values and record warnings | FIXED `2069697` |
| Malformed successful profile response | Empty/mismatched Google profile must not erase saved phone, description, services or hours | FIXED `f4554cf` |
| Import on linked location without Place ID | Browser exposes button; real HTTP disconnected import retains actionable reconnect error; partial endpoint warning reaches UI | FIXED `a62947e` |
| Import on unlinked Places location | Browser fixture exercises existing import action and weekday-array display; server branch inspected, no paid Places call made | FIXED `47a659f` |
| Link & sync reporting | Mocked partial sync response shows actual profile/review problems instead of unconditional success copy | FIXED `d59c3d8` |
| Auto-link after connect | Real DB matching by Place ID, explicit-unlink exclusion, repeat-connect idempotence, injected connected-account client and sync | FIXED `2883cc8`: keeps discovery/import/sync on the connecting account |
| Photos tab discoverability/copy | Browser follows Posts & Photos button; stale unsupported-upload copy removed; null count differs from genuine zero | FIXED `4bfeb76` |
| Mobile/accessibility smoke | 375 px composer and Location Info/Services/Social/Photos tabs; no document-level horizontal overflow; actionable labels, alerts and buttons exercised through role/label locators | PASS within smoke scope; not a full accessibility certification |

## Ranked remaining issues

1. **P2 — notification/activity delivery is not durable across the result-save boundary.** `server/gbp/content.ts:214` saves the final queue state before `:215` sends a notification and `:216` records activity; both delivery errors are swallowed. Repro: terminate after the result UPDATE, or inject a notification-storage failure, then restart the worker. The published row is not reselected, so the notification can be permanently missing. The Google post must never be resent to repair this. This is a code-inspected, previously disclosed limitation; normal delivery is tested. Follow-up needs a persistent notification/activity outbox with independent delivery state and tests for crash recovery.

2. **P2 — existing-library metadata preparation lacks per-item recovery.** `server/gbp/content-upload.ts:80` through `:100`, UI `client/src/pages/gbp-content.tsx:85`. Repro: choose two library photos, allow the first copy INSERT, then fail the second storage read. The response reports failure while the first copy remains saved; the UI's success-only refresh/selection does not identify that completed copy. Repeating the whole preparation can create another copy. This is distinct from the fixed new-file upload flow. Code-inspected; not claimed as an exercised provider-failure regression. A robust follow-up should return per-item results or persist a preparation batch so retry targets only unfinished items, rather than pretending storage writes are transactionally reversible.

3. **P3 — publishing window and timezone UX limitations.** `server/gbp/content.ts:50` through `:80` accepts one same-day window only; `client/src/pages/gbp-content.tsx:59` interprets First publish in device time, while the separately entered timezone controls business-hour filtering. Repro: device in one timezone, enter another timezone under business hours, then inspect the queued timestamp; or request opening 22/closing 6. Elapsed cadence and manual opening hours are disclosed, but timezone scope could be clearer. Overnight **profile display** is fixed; overnight **publishing windows** remain unsupported.

4. **P3 — an initial unknown photo count can still look like zero in legacy/default rows.** `shared/schema.ts:339` and `:340` default both counts to zero. With the first photo endpoint unavailable, sync preserves those defaults and emits a warning. The Photos UI now renders explicit null as unavailable, but cannot infer whether an old zero was measured. Repro: newly created/default-count location, first media sync fails, then open Photos. A future migration should model unknown counts separately and retain per-field source/freshness metadata; do not guess which historical zeros are real.

## Recommendations and verification limits

- Prioritize durable notification delivery and resumable per-photo preparation; neither should trigger another Google publish.
- Label First publish explicitly as device-local time, display the selected business timezone beside queue times, and consider overnight/split/holiday publishing windows as a separate feature.
- Persist optional-field freshness and source status, so historical data after partial sync is visibly distinguishable from a fresh complete snapshot.
- Update the older `FEATURE-a3.md` configuration paragraph: default media publication now uses signed application URLs; a public bucket base is optional. Keep the app origin reachable by Google when a deployment is authorized.
- Test live Google eligibility, scopes, moderation, R2 availability, image dimensions and actual throughput only in a separately authorized provider-validation run. No live success is asserted here.
- Mapping review referenced Google's [Location resource](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations) and [getAttributes response](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/getAttributes). Provider documentation supports the field shapes; the offline fixtures establish application behavior, not provider availability.

LANE DONE a3
