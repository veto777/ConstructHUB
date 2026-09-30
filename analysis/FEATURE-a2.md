# Feature lane a2 — Profile Guard and review management

Implemented in `/home/veto/ConstructHUB-a2`, branch `lane/a2`, starting at main
`7d2f1d4`. Only local port 8139 and `constructhub_dev_a2` were used. No deployment,
push, production access, real Google writes, paid AI calls, or outgoing SMTP.
Provider HTTP/AI/publishing were injected or mocked in tests; email used the sink.

## What was built and how to use it

- **Locations → open a linked location → Profile Guard.** Preview Google's current
  values, inspect the proposed snapshot, select watched fields, verify identity,
  then approve the snapshot and save Off, Notify, or Lockdown. All three modes and
  each watched field are per location. The Locations table shows mode, pending
  count, and failures.
- Guards cover business name, phone numbers, website, address, categories,
  description, regular/special hours, service area, opening date, and open status.
  Snapshots are owner-approved, not silently created by the worker. Preview tokens
  expire after ten minutes. Existing snapshots change through individual approvals
  or confirmed owner edits, never a bulk rebaseline that hides pending changes.
- The worker checks due locations every minute, with a 15-minute interval between
  attempts per location. It uses the existing Google client and database quota
  limiter. Live GET plus `getGoogleUpdated` masks/metadata produce field-specific
  old/new records with timestamps and source evidence. Stable pending changes are
  deduplicated; superseded changes remain in history. Off performs no checks.
- **Approve** accepts the detected value into the snapshot. **Reject** PATCHes the
  approved value back with its update mask and requires Google's returned location
  to confirm the restored value. **Lockdown** does that automatically on detection,
  including a check immediately upon enabling. Failed restores remain pending with
  an error and are retried on subsequent checks. Repeated live overwrites after a
  successful restore are detected again.
- Every approval/rejection/automatic revert records account activity and uses the
  existing user notification preferences. No new notification system or kinds were
  added; `KIND_DEFAULTS` was untouched.
- **Report** on a change, or **Report review** on a review, opens factual evidence,
  listing link when known, and a space for the owner's explanation. Copy the report,
  open Google's official form, select/paste the listing there, submit it, then choose
  **I submitted the form — mark reported**. The timestamp is local and never claims
  Google received anything just because a dialog/link was opened.
- Review sync emits `gbp.new_review` for each newly encountered Google review,
  including the initial import; repeated syncs do not notify again for unchanged
  stored reviews. Reply publishing records `gbp.reply_posted` after confirmation.
- **Google Reviews → Google Profile Reviews → AI reply settings and drafts queue**:
  select a linked location, choose Off / Draft for approval / Auto-publish, tone,
  sign-off, character limit, and rules per star rating. One- and two-star reviews
  stay drafts unless the owner explicitly enables their auto-publication.
- Future-only means the review's Google creation time is at or after enabling AI.
  Existing unanswered reviews require saved settings, **Preview existing reviews**,
  and **Confirm backfill**. Preview lists the exact reviews and whether each would
  become a draft or auto-publish. Tokens are owner/location bound, single-use,
  expire after ten minutes, and are invalidated by changed settings. Saving settings also cancels unstarted
  backfill entries so a previously confirmed draft batch cannot become auto-publish
  under different settings without a new preview/confirmation. Batches contain
  at most 50 reviews; repeat for additional batches.
- Drafts can be edited and explicitly published in the queue. AI system instructions
  prohibit invented facts and treat review text as untrusted input. Overlength,
  missing sign-off, failed generation, and publication failures stop automation and
  remain visible for manual handling. No guessed fallback reply is generated.
- AI uses `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`, the
  existing OpenAI SDK pattern, and `gpt-4o-mini`. Atomic growth budgets cap generation
  at 50 calls per user per UTC day; workers process at most 20 reviews per location
  per tick. Drafts and human replies are preserved when they race AI generation.
  Auto-publication calls the existing `reply()` and checks the expected draft again
  under the location lock before writing to Google.

## Integration and security

- `server/gbp/guard-schema.ts`: idempotent `ensureProfileGuardSchema()`, registered
  beside `ensureGbpSchema()` at boot. Own tables: `gbp_guard`, `gbp_guard_changes`,
  `gbp_reply_settings`, and `gbp_review_automation`. No drizzle schema push.
- `guard.ts`, `guard-routes.ts`, `profile-input.ts`: detection, decisions, typed
  writable Google field validation, authenticated/owner-scoped APIs, budgets,
  reports, and the recent-auth adapter. Unknown fields and malformed IDs are rejected.
- `review-automation.ts`: settings, preview/confirm, notifications, AI prompting,
  queue processing, and per-user budgets. Workers honor `GBP_SYNC_DISABLED=true`.
- `PATCH /api/gbp/locations/:id/profile` is the confirmed owner-edit path. It uses
  the same lock as Guard, writes the requested Google fields, and updates only those
  approved snapshot fields, suppressing self-generated alerts. Existing local-only
  location settings/social edits are still local; reading/importing Google data does
  not approve it into Guard. Future profile editors should use this PATCH path.
- `requireRecentAuth` was absent from starting main. The local
  `requireGuardRecentAuth()` adapter checks a server-session stamp bound to the owner,
  rejects future/expired stamps, and requires fresh credentials within five minutes.
  `/api/gbp/guard/reauth` verifies a password plus enabled TOTP, or TOTP for an account
  without a password; five attempts per ten minutes per user. No dev bypass. Swap
  this adapter and its UI for a1's account-wide re-auth flow when integrating a1.
  Google-only owners need a configured password or authenticator until that merge.
- New features store no API keys or provider tokens. Existing grant encryption is
  account-security lane territory; this lane does not introduce secret columns or
  return credentials. Disconnect/invalidation and unlink purge Guard snapshots,
  evidence, and AI settings; review deletion cascades automation/report receipts.
- Notifications use `gbp.profile_change`, `gbp.suggested_edit`,
  `gbp.change_reverted`, `gbp.new_review`, and `gbp.reply_posted`.

## Verification

Node 20.19.6, lane `.env` exported; server additionally started with
`EMAIL_FORCE_SINK=1 GBP_SYNC_DISABLED=true DEV_AUTH_BYPASS_USER1=true`.

- `npm run check`: **0 errors**.
- `CRM_TEST_SINGLE_PORT=true npx vitest run`: **805 passed, 43 skipped**;
  84 test files passed, two skipped by the existing environment/single-port harness.
  These skips are not claimed as tested.
- GBP-focused integration/unit tests: **55 passed**, including **22 new tests**
  across guard and review automation. Real a2 Postgres, fake Google HTTP, fake AI;
  Google-confirmed publication is additionally exercised through the real `reply()`
  with an injected Google client.
- `E2E_PORT=8139 E2E_DB=constructhub_dev_a2 npx playwright test -c playwright.gbp.config.ts`:
  **5 passed**, including two new browser flows. Covers snapshot review, verification,
  saving mode, approval/rejection, reports/local submission status, low-rating safety,
  backfill preview/confirmation, draft publication, and review reporting.
  Browser provider states use Playwright route fixtures; the existing disconnected
  API flow uses the real lane server. No live provider success is implied.
- Coverage also includes cross-owner access, input validation, stale/future auth,
  repeated worker checks, failed/repeated reverts, unchanged category labels,
  owner-edit suppression, report ownership, token expiry/replay, future-only scope,
  human/AI races, output length, daily budget exhaustion, and disconnect cleanup.

## Limits and owner configuration

- Enable the GBP APIs and connect a Google account with listing management access.
  Supply a working OpenAI key/base URL before using AI. Do not enable workers in
  development against real credentials; this lane kept them disabled. Leave
  `EMAIL_FORCE_SINK=1` in lanes; configure normal email delivery only outside lane work.
- Lockdown is a corrective PATCH, not a Google edit-blocking capability. Google may
  queue changes for publication. The UI says that explicitly. API failures, quota
  pressure, or a large backlog can extend the nominal 15-minute detection interval.
- Google does not identify a public suggester. `diffMask` attributes a Google update;
  other edits are labeled owner-outside-ConstructHUB **inferred, actor unavailable**.
  Evidence preserves masks and live/Google values. No unsupported public-edit
  attribution is fabricated.
- Google has no reporting API here, and no documented listing-prefill parameter for
  these forms. The user must pick the business or paste its listing URL. Redressal
  is for misleading/fraudulent business information, not routine corrections;
  negative reviews alone are not violations. Unknown listing links stay unavailable.
- Notification delivery is at least once around a process/DB failure; a crash between
  sending and marking a receipt can repeat a notice. Initial import notifies every
  encountered review. Removing a local review copy and syncing it again creates a
  new local receipt.
- Interrupted generation is not automatically replayed because publication may have
  happened remotely before a connection failed. Review/sync and handle the draft
  manually. The prompt constrains facts but cannot prove an LLM's factual accuracy;
  owners should use approval mode when they need to check every reply.
- History UI returns the latest 200 changes; the DB retains older records until
  disconnect/unlink/location deletion. Draft queue returns the latest 100 items.
  There is no new general-purpose visual profile editor in this lane; Guard provides
  snapshot review, change decisions, and the owner-edit server integration point.

Google references checked during implementation:
[Google-updated location and masks](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/getGoogleUpdated),
[location PATCH](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch),
[Business redressal form](https://support.google.com/business/contact/business_redressal_form),
[review reporting guidance](https://support.google.com/business/answer/4596773), and
[Reviews Management Tool](https://support.google.com/business/workflow/9945796).
