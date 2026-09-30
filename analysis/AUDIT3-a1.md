# AUDIT3 a1 — account security and notifications

Audited 2026-09-29/30 in `/home/veto/ConstructHUB-a1`, using only port **8129** and local database **constructhub_dev_a1**. Read `CLAUDE.md`, the shipped-features section of `HANDOFF.md`, and the five feature reports. No production access, deployment, push, real provider writes, paid calls, or SMTP delivery. `EMAIL_FORCE_SINK=1`; GBP sync/content, Social, and Site Scan workers disabled. Google/provider boundaries use existing injected fixtures; browser Google consent is intercepted. Synthetic accounts are explicitly test fixtures and are deleted by test teardown.

## Fixes

| Priority | Defect and change | Commit | Regression evidence |
|---|---|---|---|
| P1 | An old authenticated session could enroll an attacker-controlled authenticator, then grant itself fresh step-up. Require existing recent identity verification before both setup and activation. Conditional seed writes prevent replacing an enabled authenticator; activation and recovery-code insertion commit together and bind to the verified seed. | `27aa913` | Stale setup/activation denied before writes; replaced seed denied; two concurrent activations yield exactly one usable recovery-code set. |
| P1 | A remaining email-verification link bypassed subsequently enabled 2FA. Consume the link atomically and route to the second-factor challenge. Expiration comparisons use UTC consistently with stored timestamps. | `c4d9535` | Verification never calls login for the 2FA account; establishes pending challenge; replay rejected. |
| P2 | GBP failure and both Site Scan notifications were emitted but not configurable. Move all 15 growth account kinds into one registry and type notification producers against its keys; remove the disconnected maps. | `a78b946` | Every registered kind appears in preferences; each formerly missing kind can be disabled/re-enabled and actual delivery follows it. Unknown kinds rejected; security email remains mandatory. Browser toggles persist after reload. |
| P2 | Profile Guard's legacy verification did not log, and mode/profile changes discarded request attribution. Log verification and pass request metadata into existing activity records. | `0d3c917` | Real-DB route test verifies verification/mode records include request IP and user agent. Existing Guard/AI suites pass on the local audit lane; removed their hardcoded a2-only test restriction while retaining a local development-DB guard. |
| P2 | Security activity and remembered-device views could remain stale indefinitely after successful mutations. Invalidate the related queries after auth/GBP mutations; log recovery-code replacement before acknowledging it. | `9220ab7` | Browser revokes a device and immediately sees its activity entry/filter option without reload. |
| P3 | Notification popover was 384 px wide on a 320 px viewport. Constrain width to viewport minus margins and wrap content. | `1fc5788` | Browser reproduced right edge at 384 px; fixed panel is entirely inside the 320 px viewport. |
| P3 | Deleting another user's or a nonexistent remembered device falsely reported success and created a revocation event. Return 404 unless an owned row was removed; log the actual device ID. | `c04c580` | Cross-owner/absent requests create no false event; actual revocation creates one event. |
| P3 | Sign-out appeared only in CRM activity, leaving the account security log incomplete. Record account sign-out before acknowledging it. | `e05715d` | Sign-out endpoint regression checks actor IP/device and persisted account event before response. |

Additional browser coverage: `55d3210` exercises the Google-only email-code modal, wrong-code rejection, and automatic retry of authenticator setup.

## Flow coverage

`PASS` describes the specified local/injected exercise, not live provider certification.

| Flow | How exercised | Result |
|---|---|---|
| Settings → Security & activity | Real browser, authenticated fixture, activity filter and device list; direct route tests for password change | FIXED `9220ab7` |
| Password change | Wrong current password rejected; valid replacement hashes correctly; remembered devices removed; security event recorded | PASS |
| Password reset | Existing growth-isolation HTTP regression: reset token is single-use and authenticated/pending sessions are removed | PASS |
| Authenticator enrollment | QR and seed displayed, current code activates, ten codes returned; expired identity, replaced seed and concurrent activation cases | FIXED `27aa913` |
| Password + TOTP login | Actual HTTP/browser challenge and successful TOTP; expired pending challenge rejected by route test | PASS |
| Recovery sign-in | Actual recovery-code login; same code rejected in a second context; atomic concurrent consumption and ownership tests | PASS |
| Recovery-code replacement | Browser TOTP modal and retry; generated replacement makes old codes unusable in DB test | PASS |
| Lost authenticator after recovery sign-in | Browser recovery login deliberately does not grant step-up; protected action returns 403 | OPEN — requires a separate verified recovery policy; see ranked limits |
| Remember device | Browser remember/revoke; unit/integration signature tamper, different owner, expiration and revocation checks | PASS |
| Revoke unknown/foreign device | Direct endpoint tests against two fixture owners and persisted log | FIXED `c04c580` |
| 2FA off | Browser supplies actual TOTP, disables, returns to enrollment UI; protected server route reviewed against shared gate | PASS |
| Step-up: password | Browser stale-session Google disconnect/connect prompts password and retries original operation | PASS |
| Step-up: TOTP | Browser stale-session recovery-code replacement prompts authenticator and retries; password cannot replace enabled TOTP | PASS |
| Step-up: emailed code | Google-only fixture; browser sends to local sink, rejects wrong code, consumes correct code, retries enrollment; route expiry/attempt/owner/replay tests | PASS |
| Step-up: 12-hour/owner binding | Missing, exactly expired, future and cross-user timestamps denied; fresh timestamp allowed | PASS |
| Google connect/disconnect gate | Browser preflight and password modal; route/source audit plus Google OAuth tests; callback/revocation provider calls injected | PASS |
| Profile Guard mode gate | Existing Guard gate expiry/future/owner tests, route mode change with verified session, source check of `{reauth:true}` response | PASS |
| Google connected/disconnected alerts | Injected OAuth callback/revoke; browser seeded connected alert → remediation; actual local disconnect emits account email/IP/device notification | PASS |
| “Wasn't you?” | Opening alert is read-only; explicit disconnect uses step-up; browser follows reset link; Google-only guidance inspected | PASS |
| Google sign-in with 2FA | Actual callback handler with real fixture DB, mocked request/logout; remembered device allowed then revocation forces challenge | PASS |
| Email verification with enabled 2FA | Actual callback handler; no full login, pending second factor, link replay rejection | FIXED `c4d9535` |
| Account sign-out activity | Actual route handler and real DB, awaited response | FIXED `e05715d` |
| Guard verification/change activity | Route/service tests, request metadata assertions, existing approval/revert tests | FIXED `0d3c917` |
| Other sensitive activity producers | Password sign-in success/failure, 2FA success/failure, password change/reset, 2FA enable/disable, recovery replacement, GBP reply publish/delete reviewed with their existing integration coverage | PASS |
| Token encryption | Random-IV round trips; ciphertext tamper rejection; plaintext decrypt refusal; invalid/missing production key denied | PASS |
| Boot migrations | Actual server boot; repeated plaintext GBP-token and TOTP-seed migrations remain stable; corrupt authenticator ciphertext fails closed | PASS |
| Notification preferences | Registry-to-API equality, persisted channel choices and actual delivery; mandatory security email; desktop/mobile accessible switch names | FIXED `a78b946` |
| Notification bell | Browser unread count, alert navigation, mark-all-read; endpoint ownership predicates inspected | PASS |
| Mobile bell | 320 × 740 viewport, bounding-box assertion, readable controls | FIXED `1fc5788` |
| Keyboard/accessibility basics | Browser selects switches by accessible labels, interacts with modal controls, dismisses popover with Escape; labelled verification and activity filters inspected | PASS — not a full assistive-technology audit |
| Live Google / delivered security email | Explicitly prohibited real provider execution; only injected provider responses and local email sink | OPEN — requires a separately authorized provider smoke test |

Registry scope: `server/notification-kinds.ts` is the sole definition of every **account** kind emitted through `notifyUser`/`securityChanged`, including GBP, Social and Site Scan. The existing CRM organization/member notification system has its own channel matrix and audience semantics; its notification suites remain green and were not merged into per-user account preferences.

## Validation

- Final `npm run check`: **0 errors**.
- Final full Vitest result: `CRM_TEST_SINGLE_PORT=true npx vitest run`: **89 files passed, 2 skipped; 888 tests passed, 43 skipped**. The existing single-port/conditional skips are not counted as passes.
- `E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npx playwright test --config=playwright.security.config.ts`: **4 passed** with `DEV_AUTH_BYPASS_USER1=false` and `VITE_FORCE_PORTAL=false`.
- Final focused account-security suite: **17 passed** (real lane DB, injected request/provider boundaries).
- `git diff --check`: clean.
- Local logs: `tmp/audit3-vitest.log`, `tmp/audit3-check.log`, `tmp/audit3-browser.log`, `tmp/audit3-final-security.log` (not committed).

The first security subset was run before the fresh lane's GBP schema had bootstrapped and failed on missing `gbp_grants`; it passed after ordinary lane boot. The first browser attempt raced server startup and separately reproduced mobile overflow; subsequent complete browser runs passed. These failures are not counted as successful coverage.

## Ranked open limits and reproduction

1. **P2 — recovery login cannot replace a lost authenticator.** `server/auth.ts:425`, `server/account-security.ts:126`, `client/src/pages/settings.tsx:1186`. Repro: sign in with a recovery code, then request new recovery codes or disable 2FA without the original authenticator. Sign-in succeeds but protected actions still require TOTP. This is the shipped security policy and was preserved rather than weakening step-up. A separate verified account-recovery procedure is needed before this can safely change.
2. **P2 — device revocation does not terminate an existing signed-in session.** `server/account-security.ts:100` and the device DELETE route at `server/account-security.ts:141`. Repro: sign in and remember browser A, revoke its remembered-device record from browser B, then use A's existing session. Only subsequent sign-in loses remembered-device trust. Password reset does invalidate sessions; there is no general session-list/sign-out-all flow. This is an explicit shipped limit, not a claim that revocation signs out active sessions.
3. **P3 — activity filtering is restricted to the newest 200 rows.** `server/account-events.ts:107`, `client/src/components/account-security.tsx:42`. Repro: create more than 200 account events and look for an older type/date in Settings. Older rows remain in storage but cannot be selected in this view. UI discloses the limit; archival investigation needs paginated server-side filtering/export.
4. **Verification limit — real provider success and comprehensive accessibility/performance certification remain untested.** `server/gbp/routes.ts` provider boundaries and `client/src/components/account-security.tsx`. Repro requires real OAuth permissions/provider delivery or broader assistive-technology/load testing. The lane deliberately used mocks and local-only execution as required.

## Improvement recommendations

- Design an owner-verified lost-authenticator recovery procedure and an explicit session inventory/sign-out-all action; distinguish remembered-device trust from active sessions in the UI.
- Add paginated activity filters/export and readable labels for machine event names; preserve raw event kinds for investigation.
- Fetch all notification preferences in one SQL query instead of one query per registry entry (`server/account-events.ts:91`). Fifteen kinds are bounded today, but query count grows with future features.
- Offer a rate-limited “Resend code” action after a cooldown in the email verification modal. Today the owner must close/reopen the modal after a code expires (`client/src/components/recent-auth.tsx:38`). Keep the existing server budgets.
- Add a durable security-event/outbound-alert queue so transient email/database failure after a completed security mutation cannot obscure its delivery status. Keep mandatory security email enabled.

LANE DONE a1
