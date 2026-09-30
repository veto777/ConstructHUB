# Round 4 — Site Scan: why findings matter and how to fix them

Implemented locally in `/home/veto/ConstructHUB-a2`, port **8139**, database **constructhub_dev_a2**, starting from `5cd898d`. Earlier lane reports are preserved below.

## Built / where to use it

Open **Site Scan** (`/site-scan`). New scans include:

- Every finding type has a High/Medium/Low impact explanation, an authoritative Google/web.dev source, and ordered repair steps. Optional conventions, snippet lengths, heading counts, Maps embeds, short text, and AI crawler choices are explicitly distinguished from ranking requirements.
- A prioritized, searchable, paginated **Exactly how to fix** checklist. Broken links identify the source page, anchor text, target and measured HTTP status. Suggested replacements are candidates selected only from observed successful same-origin pages, never invented URLs. Images identify the file, measured bytes and a 300,000-byte optimization target (not a Google limit), with resize/compression instructions.
- Titles/descriptions use escaped, evidence-based draft snippets from the actual heading/body. These require review and are not automatically published. Existing optional AI plans remain clearly labelled AI DRAFT. GBP JSON-LD includes only synced facts and escapes script delimiters; service-area privacy and rich-result eligibility limitations are explained.
- HTML fingerprint detection for WordPress, WordPress/Elementor, Wix, Squarespace, GoDaddy, Webflow, Shopify and Duda; unmatched pages say **Custom/unknown**. Each fix supplies editor starting paths; versions/plans can differ.
- **Mark done / not done**, individually or for all fixes on the current results page. This records reported work, not verified success. **Rescan / retry PageSpeed** queues another scan. Results distinguish **fixed / still present / new / not checked**. Missing coverage or unmeasured targets never automatically mean fixed. A returning previously fixed issue becomes new and clears the reported-done flag. Comparisons use the same owner, site URL and linked client.
- **Send to my web person** sends the full prioritized checklist, sources, evidence and draft code through the existing email boundary. Lane sends go only to `tmp/email-outbox.jsonl`. Existing expiring/revocable share links expose the same read-only checklist and statuses with pagination. The web person does not receive account write access.
- **White-label PDF branding** accepts agency name and an uploaded PNG/JPEG logo. Logos are decoded, pixel-limited, resized and normalized locally; remote URLs/SVGs are rejected. Export PDF uses the saved branding and includes the full checklist, code, scores and measurement context.
- **Search client locations**, location pagination, cross-page selection, **Queue selected sites**, server-filtered scan history by status/name/URL and **History for selected client**. Bulk requests accept up to 1,000 owned synced locations, validate all of them before queueing and insert jobs in one database operation. The request makes zero Google calls.

## Scoring and PageSpeed

- Brand-core matching normalizes punctuation/case/legal suffixes and separates tagline text such as `Alpine Exteriors | Siding, Roofing & Windows`. Conservative one-character typo matching requires contiguous multiword names; it does not accept arbitrary shared words.
- Audit scores start at 100 with documented per-check-family deductions (critical 20, warning 8, info 2). Repeated service/area gaps count once per family, and Local deductions are capped at 30 because these are weak heuristics. One name mismatch cannot zero Local. These are audit indicators, not ranking predictions; prior scores use an older formula and should not be treated as strictly comparable.
- **What raised or lowered these scores?** lists the observed deduction reasons. Performance remains the mean of available Lighthouse measurements; missing measurements are excluded, never fabricated as zero.
- N/A explicitly distinguishes PageSpeed disabled, no successful pages, missing key, local budget exhaustion, provider quota, configuration/HTTP errors and request/timeout failures. Missing-key scans do not spend PageSpeed request budget. Add **PAGESPEED_API_KEY**, enable the PageSpeed Insights API and check key restrictions, then retry.

## Implementation and boundaries

- `server/sitescan/guidance.ts`: source registry, platform/brand matching, evidence and safe draft code, stable fix identity, conservative reconciliation and checklist export.
- `audit.ts`, `providers.ts`, `worker.ts`: extra crawl evidence, scoring explanations, provider failure causes, queued rescans and saved fix reports. PageSpeed calls reserve database-backed one-second slots shared by workers; no GBP API calls are needed.
- `agency.ts`, `routes.ts`: owner-scoped validated pagination/filtering, bulk enqueue, fix status, retry, checklist email, branding and PDF. Existing growth budget helpers and account activity logging are reused. Notifications still use **sitescan.completed / sitescan.regressed**; no new notification kinds and no KIND_DEFAULTS edits.
- `schema.ts`: idempotently adds `sitescan_jobs.fix_done`, history index, `sitescan_branding` and `sitescan_provider_budget`. Its existing boot registration beside GBP setup is reused. No drizzle-kit push.
- `client/src/pages/site-scan.tsx`, `client/src/components/site-scan-fixes.tsx`: owner/shared UI. `playwright.sitescan.config.ts` is now explicitly guarded to this lane.

## Configuration / honest limits

- GBP comparisons and schema require an existing synced profile snapshot. The bulk operation rejects the entire submission if any selected profile lacks a usable synced website; it never silently scans another client's site.
- Agency queue budget: **1,000 sites/owner/day**. Existing individual/rescan budget: **5/day**. Existing PageSpeed budgets remain **20 requests/owner/day and 100 project-wide/day** (two requests per sampled page); large batches may therefore complete with an explicit quota N/A. These conservative budgets must be reviewed alongside the owner's provider quotas before large-scale performance collection. Background crawling remains bounded/serial per process, with per-site delay, persisted checkpoints, leases and heartbeat.
- HTML-only crawler; it does not execute JavaScript. Max 500 pages per scan; link/image sampling and size limits remain documented in reports. CMS detection is a fingerprint heuristic, not a verified CMS integration. Platform paths are starting points; plugin installation, website changes and publication remain the web person's responsibility.
- Deterministic title/meta drafts are extracts, not claims of polished SEO copy. If a page has no useful factual content, there is no safe rewrite to invent. Snippet length thresholds, image targets and Local score weights are application heuristics.
- Verification is limited to current observed coverage. Removed pages, changed GBP baselines, incomplete crawls, unmeasured image/link targets, and failed PageSpeed measurements may remain **not checked**. Marking done never affects scores. Stable matching is per finding/page/target, not per repeated DOM occurrence of the same link.
- Legacy saved reports are preserved; the UI prompts a rescan for new guidance/tracking. No forced migration or recrawl of real client websites.
- Original monthly schedules remain capped at ten per account. Bulk scanning is explicit selection (including across result pages); it does not silently select every matching client. Existing unrelated Locations/GBP lists are outside this Site Scan lane.
- Email sharing is an explicit owner action; share URLs remain read-only, expire in 30 days and can be revoked. Logo persistence stores normalized image data, no new credentials. PageSpeed key is server configuration and is never returned/logged.
- No production access, deploy or push. Google, PageSpeed, AI, captcha and external publishing boundaries were mocked/injected in tests; email was forced into the local sink. Source documentation was read via public read-only web requests.

## Validation

- **TypeScript:** `npm run check` → 0 errors (repeated before commits).
- **Full Vitest:** `CRM_TEST_SINGLE_PORT=true npx vitest run` with lane DB/base URL exported → **92 files passed, 2 skipped; 963 tests passed, 43 skipped (1,006 total)**. Skips include the auxiliary-port suites excluded by the required single-port mode; no executed test was waived. One earlier full run hit a pre-existing randomized CRM phone fixture collision (expected a new customer, matched a historical fixture); the isolated test and subsequent full suite passed without changing CRM code/tests.
- **Playwright, signed in:** `E2E_PORT=8139 E2E_DB=constructhub_dev_a2 npx playwright test -c playwright.sitescan.config.ts` → **6 passed**, 1 signed-out-only test skipped. Includes original scan/progress/draft/PDF/share/revoke/schedule flow, public summary/captcha/verification, narrow viewport, and the new agency workflow.
- **Playwright, signed out:** same command with `--grep signed-out`, server and test env `DEV_AUTH_BYPASS_USER1=false` → **1 passed**. Free form rendered; private history/start/admin APIs denied anonymous access. A first cold-Vite attempt timed out before React mounted; after warm-up the flow passed, and the lane browser expectation timeout is now 30 seconds.
- **Scale:** API fixture seeded **1,000 owned locations**, checked first/last pages and search, bulk-queued all 1,000 via stored snapshots, tested quota enforcement, history filters and ownership; cleaned up. Browser independently seeded **1,000 locations**, searched client 0999, queued its scan, checked detected Webflow paths and missing PageSpeed explanation, copied draft code, marked done, delivered checklist to sink, saved/read back agency name + normalized logo, fetched a valid PDF, then mocked a repaired site and verified **fixed** while retaining reported done.
- **Unit/integration:** all platform fingerprints, every guide family, Alpine name case, conservative fuzzy negatives, repeated-gap score cap, link provenance/replacement candidates, measured image size, escaped schema/meta drafts, provider failure reasons, incomplete-coverage handling, returning fixed issues, authenticated/owner-scoped routes, invalid payload rejection, persisted status, source/code-bearing email through injected sender, and idempotent schema setup.
- Local backend commit: `c38b912` — evidenced guidance, verification and agency queue. The UI, browser tests and this report form the following local commit.
- Logs retained locally during the lane: `/tmp/a2-vitest-full2.log`, `/tmp/a2-vitest-final.log`, `/tmp/a2-playwright-final.log`, `/tmp/a2-playwright-auth2.log`, `/tmp/a2-check-final2.log`. No real external publishing or paid calls were required.

Sources checked for the guidance include [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [title links](https://developers.google.com/search/docs/appearance/title-link), [snippets](https://developers.google.com/search/docs/appearance/snippet), [LocalBusiness markup](https://developers.google.com/search/docs/appearance/structured-data/local-business), [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals), [AI features](https://developers.google.com/search/docs/appearance/ai-features), and [web.dev image performance](https://web.dev/learn/performance/image-performance). Individual findings link to the relevant specific document. Platform starting points were checked against Wix, Elementor, Squarespace, GoDaddy, Webflow, Shopify and Duda help documentation.

---

## Previous rounds (historical)

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
