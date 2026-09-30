# AUDIT3 a2 — Profile Guard, reviews and AI replies

Audited 2026-09-29 in `/home/veto/ConstructHUB-a2`, port **8139**, database **constructhub_dev_a2**. Read `CLAUDE.md`, the shipped-features HANDOFF section and feature reports, especially `FEATURE-a2.md` and the a1 security integration contract. Seven defects fixed in separate commits, each with a regression assertion/test. No deployment, push, production access, real Google writes, paid AI calls or outgoing SMTP. Provider responses and AI output are explicitly labelled test fixtures, not business data.

## Verification

- Node 20.19.6; `EMAIL_FORCE_SINK=1`. GBP, Social and Site Scan workers disabled; content worker explicitly disabled.
- `CRM_TEST_SINGLE_PORT=true npx vitest run`: **884 passed, 43 skipped; 90 files passed, 2 skipped**. Existing conditional/single-port skips are not claimed as coverage.
- `npm run check`: **0 errors**.
- `E2E_PORT=8139 E2E_DB=constructhub_dev_a2 npx playwright test -c playwright.gbp.config.ts`: **6 passed**, including the new 390px mobile regression. Google/AI and email-code UI responses are browser fixtures; disconnected API uses the lane server.
- With the lane environment exported and server `DEV_AUTH_BYPASS_USER1=false`: `E2E_PORT=8139 E2E_DB=constructhub_dev_a2 npx playwright test -c playwright.guard-auth.config.ts`: **1 passed**. Actual database, login, expired session, password step-up and Guard save; no intercepted application endpoints. No grant exists and Notify mode performs no provider call.
- Real Postgres integration tests use injected Google HTTP/AI. `audit-a2.test.ts` also tests default client selection using two encrypted fixture grants and an intercepting global fetch, verifying the bearer token for every request.
- Initial focused failures from absent boot-created tables disappeared after starting the prescribed lane server. Each fixed behavior was reproduced with a failing regression before its implementation change. The real-session browser test initially needed a more specific locator because the business name appears both in connection status and the locations list; this was a test selector issue.

## Flow coverage

| Flow | How exercised | Result |
|---|---|---|
| Snapshot preview and approval | Real DB + injected Google; owner mismatch, missing approval, invalid/reused token, approved snapshot; browser review/approve | PASS |
| Off / Notify / Lockdown | Per-location configuration, Off produces no HTTP, Notify detects, Lockdown reverts; worker due interval | PASS |
| Mode step-up | Missing/stale/future/foreign session tests; real bypass-disabled login, expired session, unchanged Off before verification, shared password modal/retry saves Notify | PASS |
| Shared verification UI and Google-only guidance | Removed obsolete five-minute/password-only inline form; browser email-code modal and original PUT retry | FIXED `8b51094` |
| Watched fields and pending history | Unwatch changed title, check another field, rewatch and restore original; preserve pending evidence until actually observed restored | FIXED `3c5ad99` |
| Live change versus getGoogleUpdated | Owner-change inference, Google diff/pending masks, suggestions while owner GET remains approved, category normalization and ordered address lines | PASS |
| Approve / reject | Approve updates snapshot without Google write; reject uses explicit updateMask and requires returned approved value | PASS |
| Unconfirmed reject response | Google returns correct location name but unchanged wrong value; 503, pending record preserved; confirmed retry succeeds | PASS (`6d5afbb` coverage) |
| Lockdown failure / retry / dedup | Permission failure stays pending with error; next check restores; unchanged pending dedup; repeated overwrite after successful restore creates new history | PASS |
| Confirmed owner profile edits | Reject ignored/mismatched Google PATCH response before changing snapshot; confirmed edits update only supplied fields and suppress own alerts | FIXED `ce7bb49` |
| Guard history and activity | Approved/reverted/superseded/no-longer-observed states and persisted activity/notifications checked in DB | PASS; history pagination limit below |
| Change report and mark reported | Owner-scoped factual evidence, official form link, listing link, opening report leaves receipt null; explicit submission acknowledgement sets local timestamp | PASS |
| Review report and mark reported | Actual stored review evidence and cross-owner denial; browser official form; local-only receipt logic | PASS |
| Initial review import / repeated sync | Two Google accounts, initial review from 2020, two complete syncs/location; exactly two new-review notifications total | PASS (`4b940bc` coverage) |
| Local reviews with report receipts | Local review must never produce a Google notification or consume AI generation | FIXED `94a7873` |
| AI settings / future-only / Off | Default Off, creation-time cutoff, existing draft preservation, limits, low-rating defaults and explicit override | PASS |
| Impossible AI settings | 101-character sign-off with maximum 100 rejected before generation | FIXED `d194248` |
| Existing-review backfill | Saved settings required; exact review/action preview, ownership, expiry, single-use token, settings invalidate token and cancel unstarted consent | PASS |
| Draft queue and manual approval | Browser edit/publish controls; DB draft preservation and failed publication remains visible | PASS |
| Auto-publish and 1–2-star rule | Injected AI plus real reply(); low ratings stay drafts by default, explicit opt-in permits publication | PASS |
| Review edited during AI generation | Change five-star review to one-star complaint; publication rechecks rating/text under location lock, retains draft for manual review, no Google call | FIXED `f3cb84a` |
| Human reply/draft race | Human draft wins during generation; stale expected draft rejected by reply() | PASS |
| AI output failure / budget | Overlong output and provider/publication errors stop automation; daily 50-call reservation prevents further generation | PASS |
| Reply publish / delete | Real reply() with mocked Google; failure preserves confirmed state; successful PUT/DELETE and notification/activity; cross-owner checks | PASS |
| Multi-Google-account locations | Preview, Guard checks, sync and reply PUT/DELETE all assert each location's own bearer token through default clientFor | PASS |
| Disconnect / unlink interplay | Subject-specific purge preserves other account's Guard/settings/reviews; unlink purges remaining automation, denies later preview without HTTP | PASS |
| Mobile / accessibility smoke | 390×844 long URL snapshot/history; actions within viewport, native labelled controls and accessible roles used by browser tests | FIXED `702986d`; not a comprehensive accessibility certification |
| Crash during review notification | Inspected delivery/receipt ordering; ordinary sync dedup separately tested | OPEN — delivery is at least once across a crash |
| Crash during AI generation | Inspected durable status and worker selection; no process-kill injection | OPEN — no lease or reconciliation action |
| Large history / queue | Inspected query limits and UI controls | OPEN — no pagination beyond 200 changes / 100 drafts |

## Ranked open issues and reproducible limits

1. **P2 — crash-window notification duplicates.** `server/gbp/review-automation.ts:85` sends the notification before `notified_at` is saved at line 86. Repro: interrupt after notification delivery but before that UPDATE, then sync again; the receipt still looks unsent. Ordinary repeat-sync dedup passes. This is an existing at-least-once delivery limitation, identified by code inspection; a process-kill fault injection was not performed. A durable delivery outbox with an idempotency key is needed to improve this safely without silently losing alerts.
2. **P2 — interrupted AI work has no explicit recovery state.** `server/gbp/review-automation.ts:102` persists `generating`; candidates at line 99 require null `ai_status`. Repro: stop the process during generation and restart; the row is excluded from future automatic work and remains labelled generating in the queue. Existing design intentionally avoids blindly replaying possibly published work. Add a lease/age indicator and a reconciliation/manual-recovery action, retaining the no-automatic-republish guarantee. Process interruption was assessed from persistence/query logic, not induced against the lane server.
3. **P3 — older pending items can be hidden by fixed result limits.** `server/gbp/guard-routes.ts:67` returns the newest 200 changes; `server/gbp/guard-routes.ts:97` returns the newest 100 draft/error entries. Repro: have 201 changes or 101 queued drafts and open the screen; oldest entries have no pagination path. Database evidence remains present. Add cursor pagination and prioritize pending/unresolved items.

Live Google acceptance/publication, provider quotas and eventual consistency remain unverified by design. Opening Google's report form is not evidence of submission or receipt. Lockdown cannot prevent Google edits; it can only detect and request restoration. Browser fixture success is not presented as live provider success.

## Improvements recommended

- Implement the outbox and interrupted-work reconciliation above before claiming exactly-once notifications or self-healing automation.
- Add pending-first pagination and visible counts/age to Guard history and the drafts queue.
- Extend mobile/accessibility coverage to keyboard focus, screen readers and long localized labels; this audit checked labelled controls, dialog use and a 390px layout rather than running a full accessibility scanner.
- Retire the now-unused legacy `/api/gbp/guard/reauth` adapter after compatibility review; the UI uses the shared account-security flow. No step-up, encryption, SSRF or budget invariant was weakened here.
- Keep a seeded local-lane boot step in test instructions: the focused GBP tests depend on shared schema initializers normally run by server startup.

LANE DONE a2
