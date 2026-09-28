# ConstructHUB CRM audit — lane a1

Audit date: 2026-09-28. Worktree `/home/veto/ConstructHUB-a1`, branch `lane/a1`, HTTP port **8129**, database **constructhub_dev_a1**. Read `CLAUDE.md` and `HANDOFF.md` before starting. No production access, deployment, push, real email, SMS or Stripe charge was performed. Email used the local sink; Stripe was disabled. Node 20.19.6 was selected explicitly because the shell defaults to Node 18, which cannot run this harness.

## Verification and limits

- Baseline TypeScript: zero errors.
- Baseline Vitest: **504 passed, 1 failed, 3 skipped** across 53 files. The failing STOP assertion expected “resume” while the implemented reply says “resubscribe.”
- The three configured-admin-gate integration tests spawn port 8199; excluded with `--testNamePattern='^(?!.*configured admin gate)'` to respect the lane-only port rule. Existing admin permission and pure gate tests still ran. Equivalent configured-gate checks were then run on **8129** with temporary fake gate credentials: ungated refusal, bad credentials, successful browser sign-in, separate-session isolation and eight-attempt rate limit all passed.
- Browser baseline: **168 passed, 2 flaky, 1 failed** in the parallel phase (171 scenarios, 10.8 minutes); **23 passed, 2 failed** in the explicit serial phase (25 scenarios, 6.7 minutes). Failures were obsolete mobile agenda and SMS fixture expectations. The first attempt reused a server without `VITE_FORCE_PORTAL=true`; discarded those growth-shell failures and reran with portal mode. A server-start race logged EADDRINUSE; the tests then exercised the owned, correctly configured 8129 server.
- Final TypeScript/Vitest validation: **zero type errors; 527 passed, 2 expected failures, 3 skipped**, 59 test files. The expected failures deliberately demonstrate the open ACH identifier and refund-credit defects using mocked Stripe and a mocked ledger. Final browser parallel phase: **171 passed, 2 flaky, 1 failed** (174 scenarios, 10.4 minutes). The failure selected another customer’s same-number invoice; after scoping the fixture to its customer, the targeted rerun passed. The two readiness flakes passed on retry. Final serial phase: **25 passed** (4.9 minutes). Thus all 199 distinct scenarios have passing executions after correction, but the combined command did not have a clean first-pass run; retry results are not presented as flake fixes.
- Additional verification: 59 literal GET endpoints probed with curl, no 5xx; isolated two-organization regression fixtures; concurrent offline-payment requests; signed-discount invoice reproduction; mocked Stripe webhook signature/error paths; new public change-order and mobile legal-page browser scenarios.
- Live Stripe onboarding/checkout/card/ACH settlement requires an `sk_test` key and test connected account. Google Calendar OAuth, live HOVER ingestion and R2 network persistence were not exercised against live providers; configured environment entries alone do not validate provider access. These are explicitly not certified by local fallback or mocked tests.
- PASS below means the named local scenarios passed, not that every possible role, provider response, concurrency interleaving or production data shape is proven safe. BROKEN-open rows can have working ordinary flows and still contain the documented defect.

## Feature matrix

API paths below are relative to `/api` unless written otherwise. The source-derived inventories after the matrix enumerate individual route declarations and page API references.

| Feature | Page/route | API | How verified | Status |
|---|---|---|---|---|
| CRM gateway / separate membership | `/crm-app` | `crm/me` | Code: gateway and `ensureOrgForUser`; growth-shell browser check | BROKEN-open: entitlement wording vs automatic org creation |
| Join / invitation lookup / accept / resend / revoke | `/crm/join`, Team | `crm/invitations/*`, `crm/members/*` | invite-accept and team-admin Vitest; e2e 08, 09, 45 | PASS |
| Home cards / onboarding / team activity | `/crm`, `/crm/home` | `crm/me`, `crm/stats`, `crm/onboarding`, `crm/team-activity` | stats/follow-ups tests; e2e 01 and smoke 41; curl | PASS for unscoped seats; division rollups open |
| Client list / search / creation / editing | `/crm/clients` | `crm/customers`, `crm/customers/:id` | e2e 02, client-360 tests; curl | PASS |
| Client 360 / notes / timeline / portal preview | `/crm/clients/:id` | `crm/customers/:id/{notes,timeline,activity,portal-preview}`, projects, estimates | client-360/activity/messages tests; e2e 03, 28, 48 | PASS |
| Pipeline / project creation / stage movement | `/crm/pipeline`, `/crm/projects/:id` | `crm/projects`, `crm/projects/:id`, `crm/jobs` | e2e 04, 05, 13, 48; isolated reference tests | FIXED 9e1b79d: reject foreign parent links |
| Estimate create / detail / edit after send | `/crm/estimates/new`, `/crm/estimates/:id` | `crm/estimates`, `crm/estimates/:id`, `:id/items` | estimate-edit, money, price-floor tests; e2e 03, 32, 46 | FIXED 9e1b79d for foreign project; BROKEN-open division access |
| Estimate lists / invoice lists / document filtering | `/crm/estimates`, `/crm/invoices` | `crm/estimates`, `crm/invoices` query filters | documents e2e 25; date/status/search tests | PASS for tested lists |
| Estimate options / packages / client selection | Estimate detail, `/e/:token` | `crm/estimates/:id/options*`, `public/estimates/:token/select-options` | option-items/selection/budget tests; e2e 36, 37 | PASS |
| Optional discounts / tax / deposits / rounding | Estimate editor/public estimate | `crm/estimates/:id/discounts`, public respond, invoice conversion | discounts/tax/mobile-math/money tests; e2e 27 | FIXED 72c5b28 for signed-discount invoice conversion; Stripe limitations below |
| Price book materials / labor / assemblies / accessories / formula | `/crm/pricebook` | `crm/pricebook/*`, `crm/estimates/:id/add-item` | formula/pricebook-items/price-floor tests; e2e 06, 32 | PASS |
| Contract e-sign from an estimate / signed PDF | `/e/:token`, client portal | public estimate respond; client contracts/download | contract-pdf, contract-delivery, link-gating tests; e2e 29 | PASS |
| Public estimate review / expiry / email verification / acceptance | `/e/:token` | `public/estimates/:token`, respond, client auth | e2e 10,17,20,27,29,36; link-gating and expiry tests | PASS local signatures, gating and option math |
| Public invoice / payment-disabled state | `/i/:token` | `public/invoices/:token`, pay | e2e 11,20,31; receipt/payment-link tests | PASS local display/gating; NOT-TESTABLE actual Stripe collection |
| Token customer portal | `/portal/:token` | `public/portal/:token` | e2e 12 valid/invalid token and estimate navigation | PASS |
| Client login / magic link / document hub / messages / uploads | `client.* /` (local `/?client=1`) | `client/auth/*`, `client/documents`, `client/comments`, photos/contracts | client-auth/messages/attachments tests; e2e 15,26,29; corrected customer-scoped invoice fixture | PASS local sink/auth and document access |
| Public lead form / embed / incoming client | `/lead-form/:token`, Integrations | `public/leads/:token`, `crm/integrations/lead-capture` | e2e 35-lead-capture: actual form submit and resulting CRM customer; source validation | PASS local submission |
| Legacy subscription contract-sign page | `/contract/sign/:token` | `contracts/:token`, `:token/sign`, `:token/checkout` | Read `server/routes.ts` and page; invalid token browser/API | NOT-TESTABLE full checkout: needs Stripe test account; separate from CRM estimate contract |
| Invoice creation / progress billing / retainage / void / delete | `/crm/invoices`, project/client | `crm/invoices`, `crm/estimates/:id/invoice`, invoice void/delete | money-pipeline, owner-delete; new isolated tests; e2e 11, 25, 30 | FIXED 9e1b79d and 72c5b28 |
| Offline payments / overpayment checks | Payments, invoice/client dialogs | `crm/invoices/:id/payments`, `crm/payments` | money-pipeline/receipts; e2e 46; two concurrent requests | FIXED b946e4d |
| Stripe status / link unavailable-state / payment rail settings | `/crm/payments`, take-payment dialogs | payments status/settings, invoice/estimate payment-link | payment-link/rail-policy; e2e 07, 46; mocked webhook tests | PASS local disabled-state and policy tests |
| Stripe Connect / actual card and ACH collection | Public invoice/estimate and payment links | payments connect/callback/refresh, public pay, Connect webhook | Code + mocked signature/error cases; no Stripe network calls | NOT-TESTABLE provider flow: needs sk_test; BROKEN-open reconciliation |
| Receipts / receipt resend | Invoice/client dialogs | `crm/invoices/:id/receipt`, `receipt/send` | receipts Vitest; e2e 31; local email sink | PASS |
| Change orders / schedule impact / client response | Project, `/co/:token` | project change-orders, CO send; public CO read/respond | money-pipeline; e2e 04; new e2e 49 sign/reload/duplicate refusal | PASS local response; UI confirmation FIXED 587ba39 |
| Cost codes / budgets / commitments / actual costs / phases | Project tabs | `crm/cost-codes`, projects costing/budget/commitments/costs/phases | money-pipeline/budget-options tests; e2e 04 | PASS exercised operations; comprehensive division enforcement open |
| Punch list / selections / daily logs / permit reference | Project tabs | project punch-items/selections/daily-logs/permits | e2e 04 tabs and add forms; source review | PASS exercised operations |
| Schedule / appointment CRUD / conflicts / per-user calendars | `/crm/schedule`, client scheduler | `crm/schedule`, `crm/appointments*`, members | appointments Vitest incl creator visibility; e2e 22, 47; mobile agenda test | PASS; obsolete mobile test FIXED c9d2f47 |
| iCal feed / rotation | Settings calendar card | `crm/calendar/feed-url`, `feed.ics`, rotate-feed-token | calendar tests and e2e 22; token refusal/rotation | PASS |
| Per-member/company Google Calendar synchronization | Settings | `crm/calendar/google/*` | Code, local status/unconfigured tests | NOT-TESTABLE external OAuth/sync: needs authorized OAuth connection |
| Inbox / unread / replies / client contact team | `/crm/inbox`, client portal | `crm/inbox*`, `client/comments`, `client/team` | inbox/messages/attachments tests; e2e 16, 26, 42 | PASS local sink and portal thread |
| SMS consent / suppression / own-number policy / inbound keywords | Settings, message composer | `crm/sms/*`, `crm/me/sms-consent`, `crm/messages` | sms/sms-compliance/notification-channel unit stubs + local keyword requests (no carrier sends) | FIXED 147ccf8: unsigned requests rejected when signing key configured |
| Documents / attachments / homeowner photos | Client/estimate/project/portal | `crm/attachments*`, client photos/contracts/downloads | attachments and contract tests; e2e 26, 29 | PASS local storage; NOT-TESTABLE R2 network persistence |
| Team / roles / permission redaction / divisions / org switch | `/crm/team`, org switcher | members/invitations/divisions/org/switch | team-admin, tenancy, redaction, divisions; e2e 18, 24 | FIXED 9e1b79d for tested cross-org writes and 05f99a6 for event price redaction; BROKEN-open division object access |
| Notification bell / channel preferences | Header, Settings | `crm/notifications*`, profile/org | notifications-bell, owner-notifications, notification-channels; UI smoke | PASS |
| Follow-up cadence / due list / attention | Home/client | customer follow-up, `crm/follow-ups`, `crm/attention` | follow-ups Vitest; home/client UI | PASS |
| Measurement reports / upload / confirm | `/crm/reports` | reports upload/list/confirm/download, measurement webhook | reports Vitest and e2e 23; stub data | PASS local formats; NOT-TESTABLE provider delivery |
| HOVER status / OAuth / sync controls | `/crm/integrations`, client measurements | `crm/integrations/hover/*`, customer measurements | hover Vitest, e2e 34/35; code | PASS local seams; NOT-TESTABLE live HOVER authorization/downloads |
| Quick Bid / measurement-driven estimate | Client quick-bid dialog | `crm/quick-bid`, measurements, pricebook items | quickbid Vitest; e2e 36-quick-bid | PASS |
| CSV migration / mapping / preview / import / dedupe | `/crm/migrate` | `crm/migrate/*` | migrate Vitest; e2e 21 | PASS exercised CSV imports |
| API keys / outbound webhooks / public read API | Integrations | `crm/api-keys`, `crm/webhooks`, `/api/v1/*` | e2e 14 key/webhook lifecycle; source SSRF checks; curl unauthorized paths | PASS exercised lifecycle; delivery retries not certified against external service |
| Settings / profile / company branding / payment preferences | Settings / Team company | profile/org/logo/payments settings | theme, tax, notifications tests; e2e 08,14,33 | PASS local settings and logo fallback |
| Legal pages | `/crm-terms`, `/crm-privacy` | None | New mobile browser smoke and content review | BROKEN-open: email-only Terms conflict with SMS Privacy text |
| Platform admin / beta invites | `/admin`, `/crm/admin` | `/api/admin/*` | admin Vitest excluding 8199 child; e2e 19 + smoke; separate 8129 gate fixture | PASS local role/gate checks including equivalent configured-gate scenarios on 8129; original 8199 child tests excluded |
| Scheduled/manual email backups / CSV/Excel output | Settings backup card | `crm/backups/*` | backups Vitest; e2e 39; sink payload | PASS export/sink; BROKEN-open restore coverage and CSV formula interpretation |
| Mobile ribbon / menus / theme / responsive documents | All CRM/client pages | Inherits page APIs | e2e 16,32,38,43 + new legal smoke | PASS tested layouts; baseline flakes recorded below |

## Fixed defects

| Commit | Defect and resulting behavior | Regression evidence |
|---|---|---|
| `147ccf8` | With a configured SMS signing key, omitting the signature no longer bypasses verification. Legacy no-key behavior remains explicit. | SMS helper tests cover absent, valid and invalid signatures; STOP wording assertion corrected. |
| `9e1b79d` | Invoice customer/project/estimate links, new estimate project links, project customer reassignment and job project reassignment reject another org's records before writing. | Six independent cross-org repros returned 201/200 before; now 400. Correctly linked invoice still returns 201. |
| `b946e4d` | Invoice balance checks and offline payment writes are atomic; deletion takes the same row lock; void checks the current paid balance in its update. | Two simultaneous $6 payments against $10 previously both returned 201; now one succeeds. Concurrent payment versus void/delete cannot both succeed. |
| `72c5b28` | Invoice conversion carries the signed optional discounts and prorates integer line cents. Invalid percentages return 400 before writing. Partial-draw line descriptions preserve original quantity/rate context. | Signed $90 estimate previously invoiced $100; full/half/33.33% draws verified. $1,000 line at 33.33% now yields $333.30 instead of $333.00. |
| `05f99a6` | Estimate event metadata is omitted for roles without seePrices; document history cannot bypass monetary field redaction. | A field seat previously received an event containing totalCents=98765; the API regression now checks it is absent. |
| `587ba39` | Public change-order approval confirms recording the response, without claiming a notification the handler never sends. | New browser scenario signs, reloads, verifies confirmation and rejects a second response. |
| `c9d2f47` | Browser sweeps snapshot control attributes once per page; Vite caches stay within each worktree; mobile agenda and SMS fixtures match current behavior, and portal invoice fixtures are customer-scoped. Adds mocked Stripe webhook checks; public/legal UI checks accompany 587ba39. | Final browser and Vitest results in Verification above. |

Each production fix was followed by a zero-error TypeScript check and passing lane-safe Vitest run before its commit. The two initial security commits share the same full validation run. Subsequent runs passed 519, 526 and 527 tests respectively, in addition to two explicitly expected Stripe failures and three excluded 8199-port tests. Expected failures are not counted as successfully working financial flows.

## Open issues, ranked

1. **High — division isolation is list-only in important object routes.** `server/crm/entities.ts:939`: a member scoped to division A sees no unassigned estimate in the list, but `GET /api/crm/estimates/<that-id>` returns 200 with the estimate and customer. Reproduced with a fresh org, two-organization fixtures and a division-scoped admin. Similar mutation routes authorize org/permission without a common division check. Fixing one read would leave alternate writes/download paths open; requires a shared object-access policy and a route-wide role/division test matrix. Org-wide statistics (`server/crm/stats.ts:58`) also intentionally ignore divisions. Do not treat a filtered list as an authorization boundary.
2. **High — Stripe reconciliation loses identifiers and is not atomic.** `server/crm/integrations.ts:338–396`: checkout lookup uses `externalId=sessionId`, then `applySettlement` overwrites externalId with the PaymentIntent ID. Reproduced in an explicitly expected-failure mocked regression: `checkout.session.completed` with `payment_status=unpaid` and intent `pi_X`, followed by `checkout.session.async_payment_succeeded` for session `cs_X`; the second session lookup no longer finds the row. A later intent event may rescue this, but delivery order must not be required. Status is also updated before invoice credit, so a DB error after status=succeeded can make retries skip credit. Requires durable separate provider identifiers, account binding and transactional/idempotent settlement; live behavior not exercised without a test key.
3. **High — refunds do not reverse the invoice balance.** `server/crm/integrations.ts:237–239, 355–382`: `charge.refunded` changes payment status to refunded and returns through the failure-event branch, leaving invoice paidCents/status unchanged. Partial refund amount is ignored. Reproduced in the second expected-failure mock: settle an invoice payment, then deliver a full-refund event; invoice still appears paid. Needs an explicit refund/credit ledger design, partial-refund handling and reconciliation tests before changing customer balances.
4. **High, configuration-dependent — the legacy SMS no-key fallback is still unauthenticated.** `server/crm/sms.ts:474–501`: without `SIGNALWIRE_SIGNING_KEY`, unsigned STOP/START requests are accepted; START clears suppression. Repro on the lane: post form-encoded From/Body to `/api/crm/sms/inbound` without a signature (covered by the keyword tests). The committed fix closes the missing-header bypass when a signing key IS configured. Closing the legacy no-key path safely requires the owner's provider signing key and a carrier round-trip, or an explicit decision to reject those requests; HANDOFF records why silently dropping carrier STOPs was previously unacceptable. No live configuration was inspected.
5. **Medium — legal communication claims conflict.** `client/src/pages/crm-legal.tsx:28,90–96` says the platform only emails and will never text/call, while Privacy discusses opted-in account-notification SMS (`:188` and §5). Repro: read Terms §3 alongside Privacy §5 and Settings SMS opt-in. Needs owner/attorney wording decision; this audit does not rewrite legal commitments.
6. **Medium — gateway entitlement claims do not match membership creation.** `client/src/pages/crm-gateway.tsx:35–44` treats any returned org as an active separate membership; `server/crm/tenancy.ts:29–93` creates an org for any authenticated user with no existing membership. Repro: fresh growth user requests `/api/crm/me`, then visits `/crm-app`; gets “Your CRM is active” without a separate CRM subscription check. Requires a product/billing decision, not an invented paywall.
7. **Medium — CSV exports preserve spreadsheet formulas.** `server/crm/backups.ts:100–105`, `server/crm/entities.ts:400–403`: quoting escapes CSV delimiters but does not neutralize a customer-controlled leading `=`, `+`, `-`, `@` or control character. Repro: client name `=1+1`, export CSV, inspect unprefixed cell; spreadsheet import may evaluate it. SpreadsheetML exports use explicit String cells. A shared spreadsheet-safe encoding needs an explicit compatibility policy for literal CSV re-import (prefixing cells changes their text), plus round-trip tests for both export paths.
8. **Medium — backups are exports, not complete restorable CRM backups.** `server/crm/backups.ts:1–23`: only clients, estimates and invoices are exported; attachments, signed PDFs, jobs, notes, payments, appointments, settings and restoration are absent. Repro: send backup now and inspect its three sheets/files. Label scope clearly and add a tested restore workflow before describing this as disaster recovery.

9. **Low — browser sweep readiness remains flaky under the parallel suite.** `e2e/03-crm-client-detail.spec.ts:73`, `e2e/23-reports.spec.ts:111`: final parallel run timed out waiting for readiness; both passed on retry and fresh-load checks passed. Repro: run the full parallel phase against the populated lane fixtures. No production exception was observed; isolate per-test data and capture readiness/request traces before treating retries as a fix.

## Recommended improvements (impact / effort)

1. **High / high:** centralize object authorization for org, division, assignment and permission; test every direct-ID read/write, not only lists and presenters.
2. **High / high:** transactional payment/refund ledger with immutable provider identifiers, idempotency keys, reconciliation jobs and crash/retry tests.
3. **High / medium:** complete data export plus restore rehearsal, including signed documents and attachments; display backup scope and last success/error clearly.
4. **High / medium:** independent test fixtures and cleanup for every browser test; avoid tests depending on accumulated demo rows. Run mobile agenda explicitly, record browser failures on first attempt. Cache isolation and sweep overhead were addressed here; independent fixtures remain outstanding.
5. **High / medium:** authenticated document policies consistent across estimates, invoices and change orders; clarify whether bearer-only change-order signing is intentional.
6. **Medium / low:** safe CSV export encoding and consistent numeric input bounds with atomic document creation, so oversized values cannot leave partial drafts.
7. **Medium / medium:** user-visible customer/org selector in the homeowner portal for people hiring multiple contractors; keep message/photo/financing actions bound to the selected account.
8. **Medium / medium:** show pending ACH, refund/partial refund, retainage release and reconciliation state clearly on invoices and receipts.
9. **Medium / low:** revise conflicting legal/contact copy after owner review; make disabled integrations name the missing setup step without implying success.
10. **Medium / medium:** division-aware reporting and paginated server-side lists; current hard caps and org-wide aggregates can mislead larger teams.
11. **Medium / medium:** add contractor workflows for refund/credit notes, retainage release, job closeout/warranty handoff and exportable audit trails.

## Reproduction commands

Use Node 20 from `/home/veto/.nvm/versions/node/v20.19.6/bin` in PATH. Load the lane `.env` without printing it; explicitly set `VITE_FORCE_PORTAL=true` when starting the CRM server. Tests used `CRM_TEST_BASE_URL=http://127.0.0.1:8129` and both database variables set to the local lane connection. No connection secret is included here.

```sh
npm run check
npm test -- --testNamePattern='^(?!.*configured admin gate)'
E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npm run test:e2e
E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npm run test:e2e:serial
E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npx playwright test e2e/49-audit-public.spec.ts
```

Raw local logs are retained in ignored `analysis/a1-evidence/`; they can contain synthetic fixture data and bearer links and are deliberately not committed. The inventories below contain code paths only.

## Source inventory: CRM route declarations

This includes middleware and duplicate declarations; order and gating must be read in the source. Dynamic project-child paths expand to `punch-items` and `selections`.

| Method | Route | Source |
|---|---|---|
| GET | `/api/crm/customers/:id/activity` | `server/crm/activity.ts:147` |
| GET | `/api/crm/members/:id/activity` | `server/crm/activity.ts:165` |
| GET | `/api/admin/gate` | `server/crm/admin.ts:139` |
| POST | `/api/admin/gate` | `server/crm/admin.ts:146` |
| GET | `/api/admin/overview` | `server/crm/admin.ts:162` |
| GET | `/api/admin/users` | `server/crm/admin.ts:193` |
| GET | `/api/admin/orgs` | `server/crm/admin.ts:250` |
| GET | `/api/admin/orgs/:id` | `server/crm/admin.ts:297` |
| GET | `/api/admin/beta-invites` | `server/crm/admin.ts:375` |
| POST | `/api/admin/beta-invites` | `server/crm/admin.ts:393` |
| DELETE | `/api/admin/beta-invites/:id` | `server/crm/admin.ts:476` |
| GET | `/api/crm/attachments` | `server/crm/attachments.ts:308` |
| POST | `/api/crm/attachments` | `server/crm/attachments.ts:327` |
| DELETE | `/api/crm/attachments/:id` | `server/crm/attachments.ts:389` |
| GET | `/api/crm/attachments/:id/file` | `server/crm/attachments.ts:413` |
| GET | `/api/crm/customers/:id/client-comments` | `server/crm/attachments.ts:429` |
| POST | `/api/crm/client-comments/:id/read` | `server/crm/attachments.ts:445` |
| POST | `/api/client/photos` | `server/crm/attachments.ts:461` |
| GET | `/api/client/attachments/:id/download` | `server/crm/attachments.ts:501` |
| GET | `/api/client/contracts` | `server/crm/attachments.ts:542` |
| POST | `/api/client/comments` | `server/crm/attachments.ts:572` |
| POST | `/api/public/estimates/:token/comment` | `server/crm/attachments.ts:638` |
| GET | `/api/public/estimates/:token/attachments` | `server/crm/attachments.ts:670` |
| GET | `/api/public/estimates/:token/attachments/:id` | `server/crm/attachments.ts:698` |
| GET | `/api/crm/backups/settings` | `server/crm/backups.ts:373` |
| PUT | `/api/crm/backups/settings` | `server/crm/backups.ts:385` |
| POST | `/api/crm/backups/send-now` | `server/crm/backups.ts:398` |
| GET | `/api/crm/calendar/feed.ics` | `server/crm/calendar.ts:309` |
| GET | `/api/crm/calendar/feed-url` | `server/crm/calendar.ts:324` |
| POST | `/api/crm/calendar/rotate-feed-token` | `server/crm/calendar.ts:341` |
| GET | `/api/crm/calendar/google/status` | `server/crm/calendar.ts:355` |
| GET | `/api/crm/calendar/google/connect` | `server/crm/calendar.ts:383` |
| GET | `/api/crm/calendar/google/callback` | `server/crm/calendar.ts:422` |
| POST | `/api/crm/calendar/google/sync` | `server/crm/calendar.ts:487` |
| POST | `/api/crm/calendar/google/disconnect` | `server/crm/calendar.ts:580` |
| POST | `/api/client/auth/request-link` | `server/crm/client-auth.ts:193` |
| GET | `/api/client/auth/verify` | `server/crm/client-auth.ts:257` |
| POST | `/api/client/auth/redeem` | `server/crm/client-auth.ts:303` |
| GET | `/api/client/auth/preview` | `server/crm/client-auth.ts:367` |
| POST | `/api/client/auth/logout` | `server/crm/client-auth.ts:376` |
| GET | `/api/client/documents` | `server/crm/client-auth.ts:393` |
| GET | `/api/crm/estimates/:id/discounts` | `server/crm/discounts.ts:197` |
| PUT | `/api/crm/estimates/:id/discounts` | `server/crm/discounts.ts:221` |
| GET | `/api/crm/divisions` | `server/crm/divisions.ts:275` |
| POST | `/api/crm/divisions` | `server/crm/divisions.ts:284` |
| PATCH | `/api/crm/divisions/:id` | `server/crm/divisions.ts:312` |
| DELETE | `/api/crm/divisions/:id` | `server/crm/divisions.ts:350` |
| GET | `/api/crm/customers` | `server/crm/entities.ts:308` |
| POST | `/api/crm/customers` | `server/crm/entities.ts:345` |
| GET | `/api/crm/customers/export.csv` | `server/crm/entities.ts:392` |
| GET | `/api/crm/customers/:id` | `server/crm/entities.ts:419` |
| PATCH | `/api/crm/customers/:id` | `server/crm/entities.ts:442` |
| DELETE | `/api/crm/customers/:id` | `server/crm/entities.ts:466` |
| GET | `/api/crm/projects` | `server/crm/entities.ts:545` |
| POST | `/api/crm/projects` | `server/crm/entities.ts:580` |
| PATCH | `/api/crm/projects/:id` | `server/crm/entities.ts:602` |
| GET | `/api/crm/jobs` | `server/crm/entities.ts:640` |
| POST | `/api/crm/jobs` | `server/crm/entities.ts:658` |
| PATCH | `/api/crm/jobs/:id` | `server/crm/entities.ts:670` |
| GET | `/api/crm/estimates` | `server/crm/entities.ts:700` |
| GET | `/api/crm/invoices` | `server/crm/entities.ts:786` |
| POST | `/api/crm/estimates` | `server/crm/entities.ts:875` |
| GET | `/api/crm/estimates/:id` | `server/crm/entities.ts:939` |
| PUT | `/api/crm/estimates/:id/items` | `server/crm/entities.ts:970` |
| PATCH | `/api/crm/estimates/:id` | `server/crm/entities.ts:1008` |
| DELETE | `/api/crm/estimates/:id` | `server/crm/entities.ts:1083` |
| GET | `/api/crm/lead-sources` | `server/crm/entities.ts:1109` |
| POST | `/api/crm/lead-sources` | `server/crm/entities.ts:1118` |
| PATCH | `/api/crm/customers/:id/follow-up` | `server/crm/follow-ups.ts:101` |
| GET | `/api/crm/follow-ups` | `server/crm/follow-ups.ts:138` |
| GET | `/api/crm/attention` | `server/crm/follow-ups.ts:149` |
| GET | `/api/crm/integrations/hover/status` | `server/crm/hover.ts:1212` |
| GET | `/api/crm/integrations/hover/connect` | `server/crm/hover.ts:1238` |
| GET | `/api/crm/integrations/hover/oauth/callback` | `server/crm/hover.ts:1254` |
| POST | `/api/crm/integrations/hover/register-webhook` | `server/crm/hover.ts:1300` |
| POST | `/api/crm/integrations/hover/sync` | `server/crm/hover.ts:1322` |
| POST | `/api/crm/integrations/hover/schedule` | `server/crm/hover.ts:1336` |
| POST | `/api/crm/integrations/hover/disconnect` | `server/crm/hover.ts:1348` |
| POST | `/api/crm/integrations/hover/webhook` | `server/crm/hover.ts:1376` |
| GET | `/api/crm/customers/:id/measurements` | `server/crm/hover.ts:1464` |
| GET | `/api/crm/inbox` | `server/crm/inbox.ts:47` |
| GET | `/api/crm/inbox/:customerId` | `server/crm/inbox.ts:86` |
| POST | `/api/crm/inbox/:customerId/read` | `server/crm/inbox.ts:123` |
| POST | `/api/crm/inbox/:customerId/reply` | `server/crm/inbox.ts:144` |
| GET | `/api/client/team` | `server/crm/inbox.ts:200` |
| GET | `/api/client/comments` | `server/crm/inbox.ts:263` |
| POST | `/api/crm/stripe/connect-webhook` | `server/crm/integrations.ts:190` |
| GET | `/api/v1/ping` | `server/crm/integrations.ts:255` |
| GET | `/api/v1/customers` | `server/crm/integrations.ts:269` |
| GET | `/api/v1/projects` | `server/crm/integrations.ts:280` |
| GET | `/api/v1/estimates` | `server/crm/integrations.ts:290` |
| GET | `/api/v1/invoices` | `server/crm/integrations.ts:300` |
| GET | `/api/v1/payments` | `server/crm/integrations.ts:310` |
| GET | `/api/v1` | `server/crm/integrations.ts:321` |
| GET | `/api/crm/integrations/lead-capture` | `server/crm/lead-capture.ts:163` |
| POST | `/api/crm/integrations/lead-capture/rotate` | `server/crm/lead-capture.ts:187` |
| GET | `/api/public/leads/:token` | `server/crm/lead-capture.ts:199` |
| POST | `/api/public/leads/:token` | `server/crm/lead-capture.ts:210` |
| POST | `/api/crm/messages` | `server/crm/messages.ts:92` |
| POST | `/api/crm/migrate/preview` | `server/crm/migrate.ts:251` |
| POST | `/api/crm/migrate/import` | `server/crm/migrate.ts:290` |
| POST | `/api/crm/migrate/assisted` | `server/crm/migrate.ts:400` |
| POST | `/api/client/comments` | `server/crm/notes-timeline.ts:148` |
| POST | `/api/client/photos` | `server/crm/notes-timeline.ts:149` |
| GET | `/api/crm/customers/:id/notes` | `server/crm/notes-timeline.ts:169` |
| POST | `/api/crm/customers/:id/notes` | `server/crm/notes-timeline.ts:198` |
| PATCH | `/api/crm/customers/:id/notes/:noteId` | `server/crm/notes-timeline.ts:227` |
| DELETE | `/api/crm/customers/:id/notes/:noteId` | `server/crm/notes-timeline.ts:260` |
| GET | `/api/crm/customers/:id/timeline` | `server/crm/notes-timeline.ts:288` |
| POST | `/api/client/financing-click` | `server/crm/notes-timeline.ts:467` |
| POST | `/api/crm/customers/:id/portal-preview` | `server/crm/notes-timeline.ts:506` |
| GET | `/api/crm/notifications` | `server/crm/notify.ts:88` |
| POST | `/api/crm/notifications/read-all` | `server/crm/notify.ts:106` |
| POST | `/api/crm/notifications/:id/read` | `server/crm/notify.ts:120` |
| GET | `/api/crm/invoices` | `server/crm/ops.ts:167` |
| POST | `/api/crm/invoices` | `server/crm/ops.ts:186` |
| POST | `/api/crm/estimates/:id/invoice` | `server/crm/ops.ts:234` |
| POST | `/api/crm/invoices/:id/payments` | `server/crm/ops.ts:283` |
| POST | `/api/crm/invoices/:id/void` | `server/crm/ops.ts:355` |
| DELETE | `/api/crm/invoices/:id` | `server/crm/ops.ts:384` |
| GET | `/api/crm/cost-codes` | `server/crm/ops.ts:424` |
| POST | `/api/crm/cost-codes` | `server/crm/ops.ts:433` |
| POST | `/api/crm/cost-codes/seed` | `server/crm/ops.ts:448` |
| GET | `/api/crm/projects/:id/costing` | `server/crm/ops.ts:483` |
| PUT | `/api/crm/projects/:id/budget` | `server/crm/ops.ts:546` |
| POST | `/api/crm/projects/:id/budget-lines` | `server/crm/ops.ts:607` |
| PATCH | `/api/crm/budget-lines/:lineId` | `server/crm/ops.ts:623` |
| DELETE | `/api/crm/budget-lines/:lineId` | `server/crm/ops.ts:646` |
| POST | `/api/crm/projects/:id/commitments` | `server/crm/ops.ts:662` |
| POST | `/api/crm/projects/:id/costs` | `server/crm/ops.ts:682` |
| GET | `/api/crm/projects/:id/change-orders` | `server/crm/ops.ts:707` |
| POST | `/api/crm/projects/:id/change-orders` | `server/crm/ops.ts:723` |
| POST | `/api/crm/change-orders/:id/send` | `server/crm/ops.ts:746` |
| GET | `/api/public/change-orders/:token` | `server/crm/ops.ts:761` |
| POST | `/api/public/change-orders/:token/respond` | `server/crm/ops.ts:782` |
| GET | `/api/crm/projects/:id/${path}` | `server/crm/ops.ts:822` |
| POST | `/api/crm/projects/:id/${path}` | `server/crm/ops.ts:832` |
| PATCH | `/api/crm/${path}/:childId` | `server/crm/ops.ts:844` |
| GET | `/api/crm/projects/:id/daily-logs` | `server/crm/ops.ts:873` |
| POST | `/api/crm/projects/:id/daily-logs` | `server/crm/ops.ts:884` |
| GET | `/api/crm/projects/:id/permits/suggest` | `server/crm/ops.ts:913` |
| PATCH | `/api/crm/projects/:id/permit` | `server/crm/ops.ts:944` |
| GET | `/api/crm/api-keys` | `server/crm/ops.ts:963` |
| POST | `/api/crm/api-keys` | `server/crm/ops.ts:972` |
| DELETE | `/api/crm/api-keys/:id` | `server/crm/ops.ts:990` |
| GET | `/api/crm/webhooks` | `server/crm/ops.ts:999` |
| POST | `/api/crm/webhooks` | `server/crm/ops.ts:1006` |
| DELETE | `/api/crm/webhooks/:id` | `server/crm/ops.ts:1027` |
| GET | `/api/crm/estimates/:id/options` | `server/crm/ops.ts:1037` |
| POST | `/api/crm/estimates/:id/options` | `server/crm/ops.ts:1067` |
| DELETE | `/api/crm/estimates/:id/options/:optionId` | `server/crm/ops.ts:1119` |
| GET | `/api/crm/projects/:id/phases` | `server/crm/ops.ts:1137` |
| POST | `/api/crm/projects/:id/phases` | `server/crm/ops.ts:1146` |
| DELETE | `/api/crm/phases/:phaseId` | `server/crm/ops.ts:1169` |
| GET | `/api/crm/payments/status` | `server/crm/payments.ts:152` |
| GET | `/api/crm/payments/connect/stripe` | `server/crm/payments.ts:186` |
| GET | `/api/crm/payments/connect/stripe/callback` | `server/crm/payments.ts:217` |
| POST | `/api/crm/payments/refresh` | `server/crm/payments.ts:272` |
| POST | `/api/crm/payments/disconnect` | `server/crm/payments.ts:299` |
| GET | `/api/crm/payments` | `server/crm/payments.ts:319` |
| POST | `/api/crm/invoices/:id/payment-link` | `server/crm/payments.ts:404` |
| POST | `/api/crm/estimates/:id/payment-link` | `server/crm/payments.ts:445` |
| GET | `/api/crm/payments/settings` | `server/crm/payments.ts:494` |
| PUT | `/api/crm/payments/settings` | `server/crm/payments.ts:506` |
| POST | `/api/crm/org/logo` | `server/crm/payments.ts:552` |
| GET | `/api/crm/org-logos/:file` | `server/crm/payments.ts:588` |
| GET | `/api/public/invoices/:token/pay-info` | `server/crm/payments.ts:604` |
| GET | `/api/public/estimates/:token/pay-info` | `server/crm/payments.ts:628` |
| POST | `/api/public/invoices/:token/pay` | `server/crm/payments.ts:638` |
| POST | `/api/public/estimates/:token/pay` | `server/crm/payments.ts:742` |
| POST | `/api/crm/estimates/:id/send` | `server/crm/portal.ts:235` |
| GET | `/api/public/estimates/:token` | `server/crm/portal.ts:457` |
| POST | `/api/public/estimates/:token/respond` | `server/crm/portal.ts:625` |
| POST | `/api/public/estimates/:token/select-options` | `server/crm/portal.ts:716` |
| POST | `/api/public/verify-access` | `server/crm/portal.ts:891` |
| POST | `/api/public/estimates/:token/share` | `server/crm/portal.ts:1001` |
| POST | `/api/crm/estimates/:id/preview-link` | `server/crm/portal.ts:1072` |
| POST | `/api/public/engagement/start` | `server/crm/portal.ts:1096` |
| POST | `/api/public/engagement/ping` | `server/crm/portal.ts:1153` |
| GET | `/api/crm/estimates/:id/engagement` | `server/crm/portal.ts:1172` |
| POST | `/api/crm/estimates/:id/extend` | `server/crm/portal.ts:1221` |
| GET | `/api/public/portal/:token` | `server/crm/portal.ts:1247` |
| POST | `/api/crm/invoices/:id/send` | `server/crm/portal.ts:1553` |
| GET | `/api/public/invoices/:token` | `server/crm/portal.ts:1625` |
| PUT | `/api/crm/org/price-floor-lock` | `server/crm/pricebook.ts:167` |
| GET | `/api/crm/pricebook/meta` | `server/crm/pricebook.ts:191` |
| GET | `/api/crm/pricebook/categories` | `server/crm/pricebook.ts:200` |
| POST | `/api/crm/pricebook/categories` | `server/crm/pricebook.ts:208` |
| GET | `/api/crm/pricebook/labor-rates` | `server/crm/pricebook.ts:221` |
| POST | `/api/crm/pricebook/labor-rates` | `server/crm/pricebook.ts:230` |
| GET | `/api/crm/pricebook/materials` | `server/crm/pricebook.ts:249` |
| POST | `/api/crm/pricebook/materials` | `server/crm/pricebook.ts:275` |
| PATCH | `/api/crm/pricebook/materials/:id` | `server/crm/pricebook.ts:285` |
| POST | `/api/crm/pricebook/materials/adjust` | `server/crm/pricebook.ts:299` |
| GET | `/api/crm/pricebook/items` | `server/crm/pricebook.ts:362` |
| POST | `/api/crm/pricebook/items` | `server/crm/pricebook.ts:380` |
| GET | `/api/crm/pricebook/items/:id` | `server/crm/pricebook.ts:415` |
| PATCH | `/api/crm/pricebook/items/:id` | `server/crm/pricebook.ts:432` |
| DELETE | `/api/crm/pricebook/items/:id` | `server/crm/pricebook.ts:471` |
| POST | `/api/crm/pricebook/items/:id/accessories` | `server/crm/pricebook.ts:490` |
| DELETE | `/api/crm/pricebook/items/:id/accessories/:accessoryId` | `server/crm/pricebook.ts:518` |
| POST | `/api/crm/pricebook/items/:id/preview` | `server/crm/pricebook.ts:530` |
| POST | `/api/crm/pricebook/formula/test` | `server/crm/pricebook.ts:555` |
| POST | `/api/crm/estimates/:id/add-item` | `server/crm/pricebook.ts:575` |
| GET | `/api/crm/pricebook/packages` | `server/crm/pricebook.ts:634` |
| POST | `/api/crm/pricebook/packages` | `server/crm/pricebook.ts:643` |
| POST | `/api/crm/estimates/:id/options/from-package` | `server/crm/pricebook.ts:671` |
| POST | `/api/crm/pricebook/seed` | `server/crm/pricebook.ts:738` |
| GET | `/api/crm/measurements` | `server/crm/pricebook.ts:832` |
| POST | `/api/crm/measurements` | `server/crm/pricebook.ts:842` |
| GET | `/api/crm/measurements/:id/symbols` | `server/crm/pricebook.ts:877` |
| POST | `/api/crm/quick-bid` | `server/crm/quickbid.ts:63` |
| GET | `/api/crm/invoices/:id/receipt` | `server/crm/receipts.ts:221` |
| POST | `/api/crm/invoices/:id/receipt/send` | `server/crm/receipts.ts:237` |
| POST | `/api/crm/reports/upload` | `server/crm/reports.ts:424` |
| POST | `/api/crm/reports/:id/confirm` | `server/crm/reports.ts:444` |
| GET | `/api/crm/reports` | `server/crm/reports.ts:511` |
| GET | `/api/crm/reports/:id/download` | `server/crm/reports.ts:545` |
| POST | `/api/crm/integrations/measurements/webhook` | `server/crm/reports.ts:603` |
| GET | `/api/client/reports/:id/download` | `server/crm/reports.ts:689` |
| GET | `/api/crm/me` | `server/crm/routes.ts:296` |
| PATCH | `/api/crm/profile` | `server/crm/routes.ts:331` |
| POST | `/api/crm/me/sms-consent` | `server/crm/routes.ts:377` |
| POST | `/api/crm/org/switch` | `server/crm/routes.ts:424` |
| GET | `/api/crm/onboarding` | `server/crm/routes.ts:446` |
| POST | `/api/crm/onboarding/dismiss` | `server/crm/routes.ts:515` |
| GET | `/api/crm/org` | `server/crm/routes.ts:532` |
| PATCH | `/api/crm/org` | `server/crm/routes.ts:540` |
| GET | `/api/crm/members` | `server/crm/routes.ts:613` |
| PATCH | `/api/crm/members/:id` | `server/crm/routes.ts:631` |
| DELETE | `/api/crm/members/:id` | `server/crm/routes.ts:707` |
| POST | `/api/crm/members/:id/send-password-reset` | `server/crm/routes.ts:753` |
| GET | `/api/crm/invitations` | `server/crm/routes.ts:802` |
| POST | `/api/crm/invitations` | `server/crm/routes.ts:818` |
| POST | `/api/crm/invitations/:id/resend` | `server/crm/routes.ts:925` |
| DELETE | `/api/crm/invitations/:id` | `server/crm/routes.ts:961` |
| GET | `/api/crm/invitations/lookup/:token` | `server/crm/routes.ts:994` |
| POST | `/api/crm/invitations/accept` | `server/crm/routes.ts:1010` |
| GET | `/api/crm/schedule` | `server/crm/schedule.ts:76` |
| GET | `/api/crm/appointments` | `server/crm/schedule.ts:201` |
| POST | `/api/crm/appointments` | `server/crm/schedule.ts:251` |
| PATCH | `/api/crm/appointments/:id` | `server/crm/schedule.ts:294` |
| DELETE | `/api/crm/appointments/:id` | `server/crm/schedule.ts:358` |
| GET | `/api/crm/activity` | `server/crm/schedule.ts:380` |
| POST | `/api/crm/sms/inbound` | `server/crm/sms.ts:510` |
| GET | `/api/crm/sms/status` | `server/crm/sms.ts:554` |
| PUT | `/api/crm/sms/sender` | `server/crm/sms.ts:568` |
| POST | `/api/crm/sms/test` | `server/crm/sms.ts:620` |
| POST | `/api/crm/estimates/:id/remind` | `server/crm/sms.ts:654` |
| GET | `/api/crm/stats` | `server/crm/stats.ts:58` |
| GET | `/api/crm/team-activity` | `server/crm/stats.ts:113` |
| POST | `/api/crm/estimates` | `server/crm/tax.ts:145` |

## Source inventory: pages and their direct API references

Shared dialogs, sidebar, bell and payment/attachment components add the API families listed above. Interpolated references below identify route families rather than concrete IDs.

| Page source | Direct API references |
|---|---|
| `client/src/pages/contract-sign.tsx` | `/api/contracts`; `/api/contracts/${token` |
| `client/src/pages/public-portal.tsx` | `/api/public/portal/${token` |
| `client/src/pages/crm-client.tsx` | `/api/crm/appointments`; `/api/crm/appointments?from=${from`; `/api/crm/customers`; `/api/crm/customers/${id`; `/api/crm/estimates`; `/api/crm/estimates/${estimate.id`; `/api/crm/estimates/${estimateId`; `/api/crm/inbox/${id`; `/api/crm/invoices/${invoiceId`; `/api/crm/invoices/${payFor.id`; `/api/crm/invoices?customerId=${id`; `/api/crm/me`; `/api/crm/members`; `/api/crm/org`; `/api/crm/payments`; `/api/crm/payments?customerId=${id`; `/api/crm/pricebook/items${itemQ`; `/api/crm/pricebook/items/${item.id`; `/api/crm/pricebook/packages`; `/api/crm/projects`; `/api/crm/schedule`; `/api/crm/sms/status` |
| `client/src/pages/public-lead-form.tsx` | `/api/public/leads/${token` |
| `client/src/pages/crm-inbox.tsx` | `/api/crm/activity`; `/api/crm/inbox`; `/api/crm/inbox/${customerId`; `/api/crm/inbox/${selected` |
| `client/src/pages/crm-admin.tsx` | `/api/admin/*`; `/api/admin/analytics`; `/api/admin/beta-invites`; `/api/admin/beta-invites/${id`; `/api/admin/gate`; `/api/admin/orgs`; `/api/admin/overview`; `/api/admin/users`; `/api/crm/me` |
| `client/src/pages/public-estimate.tsx` | `/api/client/auth/redeem`; `/api/public/estimates/${token` |
| `client/src/pages/crm-legal.tsx` |  |
| `client/src/pages/crm-payments.tsx` | `/api/crm/customers`; `/api/crm/invoices?customerId=${takeClientId`; `/api/crm/me`; `/api/crm/payments`; `/api/crm/payments/connect/stripe`; `/api/crm/payments/disconnect`; `/api/crm/payments/refresh`; `/api/crm/payments/status` |
| `client/src/pages/crm-settings.tsx` | `/api/crm/backups/send-now`; `/api/crm/backups/settings`; `/api/crm/calendar/feed-url`; `/api/crm/calendar/google/connect`; `/api/crm/calendar/google/disconnect`; `/api/crm/calendar/google/status`; `/api/crm/calendar/google/sync`; `/api/crm/calendar/rotate-feed-token`; `/api/crm/divisions`; `/api/crm/divisions/${created.id`; `/api/crm/divisions/${editingDivisionId`; `/api/crm/divisions/${id`; `/api/crm/lead-sources`; `/api/crm/me`; `/api/crm/me/sms-consent`; `/api/crm/org`; `/api/crm/org/logo`; `/api/crm/org/price-floor-lock`; `/api/crm/payments/settings`; `/api/crm/payments/status`; `/api/crm/sms/sender`; `/api/crm/sms/status`; `/api/crm/sms/test` |
| `client/src/pages/crm-gateway.tsx` | `/api/crm/me` |
| `client/src/pages/crm-migrate.tsx` | `/api/crm/customers`; `/api/crm/estimates`; `/api/crm/migrate/assisted`; `/api/crm/migrate/import`; `/api/crm/migrate/preview` |
| `client/src/pages/crm-estimate-detail.tsx` | `/api/crm/customers/${e.customerId`; `/api/crm/divisions`; `/api/crm/estimates`; `/api/crm/estimates/${id`; `/api/crm/estimates/:id;`; `/api/crm/estimates?`; `/api/crm/me` |
| `client/src/pages/crm-integrations.tsx` | `/api/crm/api-keys`; `/api/crm/api-keys/${id`; `/api/crm/calendar/google/status`; `/api/crm/integrations/hover/connect`; `/api/crm/integrations/hover/disconnect`; `/api/crm/integrations/hover/register-webhook`; `/api/crm/integrations/hover/schedule`; `/api/crm/integrations/hover/status`; `/api/crm/integrations/hover/sync`; `/api/crm/integrations/lead-capture`; `/api/crm/integrations/lead-capture/rotate`; `/api/crm/me`; `/api/crm/payments/status`; `/api/crm/webhooks`; `/api/crm/webhooks/${id`; `/api/v1.` |
| `client/src/pages/crm-documents.tsx` | `/api/crm/estimates`; `/api/crm/invoices`; `/api/crm/me` |
| `client/src/pages/public-invoice.tsx` | `/api/public/invoices/${token` |
| `client/src/pages/crm-join.tsx` | `/api/auth/me`; `/api/crm/invitations/accept`; `/api/crm/invitations/lookup`; `/api/crm/invitations/lookup/${token`; `/api/crm/me` |
| `client/src/pages/crm-project.tsx` | `/api/crm/me`; `/api/crm/projects`; `/api/crm/projects/${id` |
| `client/src/pages/crm-estimate-new.tsx` | `/api/crm/customers`; `/api/crm/customers${q`; `/api/crm/customers/${customer.id`; `/api/crm/divisions`; `/api/crm/estimates`; `/api/crm/estimates,`; `/api/crm/estimates/${created.id`; `/api/crm/pricebook/items${itemQ`; `/api/crm/pricebook/items/${item.id`; `/api/crm/pricebook/items?q=${encodeURIComponent(n` |
| `client/src/pages/crm-pricebook.tsx` | `/api/crm/me`; `/api/crm/pricebook/${k`; `/api/crm/pricebook/formula/test`; `/api/crm/pricebook/items`; `/api/crm/pricebook/items/${dlg.id`; `/api/crm/pricebook/items/${id`; `/api/crm/pricebook/items/${prev!.id`; `/api/crm/pricebook/items/${prev?.id`; `/api/crm/pricebook/labor-rates`; `/api/crm/pricebook/materials`; `/api/crm/pricebook/meta`; `/api/crm/pricebook/seed` |
| `client/src/pages/public-change-order.tsx` | `/api/public/change-orders/${token` |
| `client/src/pages/crm-schedule.tsx` | `/api/crm/appointments`; `/api/crm/appointments?from=${encodeURIComponent(range.from.toISOString(`; `/api/crm/customers`; `/api/crm/me`; `/api/crm/members`; `/api/crm/projects`; `/api/crm/schedule`; `/api/crm/schedule?days=${days` |
| `client/src/pages/crm-home.tsx` | `/api/crm/attention`; `/api/crm/customers`; `/api/crm/customers/${customerId`; `/api/crm/follow-ups`; `/api/crm/me`; `/api/crm/onboarding`; `/api/crm/onboarding/dismiss`; `/api/crm/projects`; `/api/crm/stats`; `/api/crm/team-activity` |
| `client/src/pages/crm-clients.tsx` | `/api/crm/customers`; `/api/crm/customers${qDebounced`; `/api/crm/me` |
| `client/src/pages/crm-pipeline.tsx` | `/api/crm/customers`; `/api/crm/me`; `/api/crm/members`; `/api/crm/projects`; `/api/crm/projects/${id`; `/api/crm/projects/${project.id` |
| `client/src/pages/crm-team.tsx` | `/api/crm/calendar/google/connect?scope=me`; `/api/crm/calendar/google/disconnect?scope=me`; `/api/crm/calendar/google/status`; `/api/crm/calendar/google/sync?scope=me`; `/api/crm/divisions`; `/api/crm/invitations`; `/api/crm/invitations/${id`; `/api/crm/me`; `/api/crm/members`; `/api/crm/members/${id`; `/api/crm/members/${memberId`; `/api/crm/onboarding`; `/api/crm/org`; `/api/crm/profile`; `/api/crm/sms/status` |
| `client/src/pages/crm-estimates.tsx` |  |
| `client/src/pages/crm-invoices.tsx` |  |
| `client/src/pages/client-portal.tsx` | `/api/client/auth/logout`; `/api/client/auth/request-link`; `/api/client/contracts`; `/api/client/documents`; `/api/client/photos`; `/api/public/estimates/${tok` |
| `client/src/pages/crm-reports.tsx` | `/api/crm/customers`; `/api/crm/me`; `/api/crm/reports`; `/api/crm/reports/${draft!.id`; `/api/crm/reports/upload` |

## Round 2 — CRM isolation, payment ledger, exports and deterministic browsers

Date: 2026-09-28. This section supersedes round-1 open issues **1, 2, 3, 7, 8 and 9** for the scenarios below. Scope stayed in CRM server code, CRM pages and CRM e2e, on lane/a1, port 8129 and constructhub_dev_a1. No production access, push, external messages or live Stripe calls. The source inventory above remains the broad feature inventory; the new source-scanned access matrix automatically covers direct-ID routes in the protected families, including nested history, PDFs and downloads.

### Round 2 feature matrix

| Feature | Page/route | API | How verified | Status |
|---|---|---|---|---|
| Client, estimate, invoice, project/job, change-order, document/attachment and appointment isolation | CRM clients, documents, projects, calendar | Direct-ID GET/POST/PATCH/PUT/DELETE routes, nested item/history/PDF/file routes | Shared object policy plus source-derived route matrix: division A receives 404 for B and unassigned fixtures even when assigned to the caller; actual file fixtures; assignment/price permissions, relink attempts, owner and unscoped admin checks | FIXED f033ec7 |
| Division-scoped lists and aggregates | CRM home, clients, documents, reports, calendar | stats, customer details/activity/timeline, projects/jobs, estimates/invoices/payments, attachments/reports/appointments | Real HTTP/DB assertions for scoped counts, totals and visible rows; code path review | FIXED f033ec7 |
| Whole-client portal grants | Client detail | customers GET/POST, customers/:id/portal-preview | Scoped seats receive no whole-client bearer link and cannot mint a broad preview; individual estimate access remains object-scoped; owner preview covered by browser | FIXED a2a2ad6 |
| Checkout/intent/charge reconciliation | Payments and public invoices | Connect webhook; invoice/estimate checkout creation | Separate durable IDs/account, prefix-only backfill; mocked Stripe + real Postgres transactions, ACH delayed success, intent-first order, stale failures, concurrent duplicates/two payments, crash rollback and retry | FIXED 18157d4 |
| Partial/full refund accounting | Payments, client, invoice and receipt | charge.refunded, payments, invoice lists/public invoice, receipt | Cumulative delta ledger, account/event idempotency, refund-before-success, stale/duplicate events, charge-only lookup, fees, crash rollback; browser partial/full invoice and receipt assertions | FIXED 7cad394 |
| Actual Stripe API checkout/onboarding/ACH/refund delivery | Public invoice/estimate, Payments | Stripe API and Connect webhook | Provider mocked; lane key intentionally blank | NOT-TESTABLE: needs sk_test and test connected account |
| CSV export safety | Client export and scheduled exports | customers/export.csv, export generation | Shared cell encoder; round-trip tests for = + - @ tab/CR, delimiters, quotes/newlines and benign cells | FIXED 5ea2fcf |
| Limited scheduled-export wording | Settings, export email | backup settings/send endpoints | UI/email explicitly name clients, estimates and invoices, exclusions and no restore; local sink and browser | FIXED c6066bc |
| Client-detail/report browser readiness | e2e 03 and 23 | Real fixture creation, report import/preview/confirm | Separate org per test, fixture cleanup, CRM shell readiness, explicit preview popup check; stable DOM markers prevent asynchronous control insertion from shifting click targets; 15 executions passed across three repetitions without retries | FIXED 7c96b80 + 9326390 |

### Round 2 validation

- `npm run check`: zero TypeScript errors.
- `npm test -- --testNamePattern='^(?!.*configured admin gate)'`: **722 passed, 3 skipped, 67 files passed**. The three excluded tests start port 8199 and violate this lane's port restriction. No expected-failure Stripe regressions remain; their replacements exercise actual database transactions with a mocked Stripe client.
- Financial regression file: 17 passing tests. Invoice/payment/event/refund writes roll back together when a trigger injects a failure between steps, and retry applies the credit or reversal once.
- The two formerly flaky specs passed **15/15** executions with two workers, three repetitions and zero retries after the final control-selection correction. Earlier failures led to the correction and are not counted as clean passes.
- Final targeted browser suite (client detail, reports, receipts, scheduled exports and refunds): **9 passed**, no retries. Earlier targeted division/PM/document checks also passed. This round did not repeat the entire round-1 199-scenario suite.
- One intermediate access test reached a server still running the previous code and failed on the exposed portal link; after restarting the owned lane process, the final suite validates the new restriction.
- CSV import retains the protective apostrophe as literal text; stripping it automatically would recreate formula risk on re-export.
- Local detailed evidence is in ignored `analysis/a1-evidence/`; it is not committed because runtime logs can include fixture bearer links. No environment secrets are in this report.

### Remaining open issues, ranked, with reproduction

1. **High, configuration-dependent — owner-deferred SMS no-key fallback (round-1 issue 4).** `server/crm/sms.ts:476`: without a signing key, post unsigned form data `From=<fixture number>&Body=START` to `/api/crm/sms/inbound`; the legacy path can clear suppression. Unchanged by explicit owner instruction. Provider credentials/carrier validation remain required.
2. **High for affected historical payments — ambiguous legacy account/refund history requires reconciliation.** `server/crm/payment-ledger-schema.ts:24` and `server/crm/payment-ledger.ts:67`: create a legacy payment with externalId but an org that has used two connected accounts; schema ensure deliberately leaves its account null. A status-only historical refunded row with no known settled balance is rejected rather than reverse an invented amount. Repro is pinned in payment-ledger tests. Owner must reconcile these records against authoritative Stripe history before replay; no automatic repair is safe from the stored fields alone.
3. **Medium — owner-deferred legal wording (round-1 issue 5).** `client/src/pages/crm-legal.tsx:92` and `:188`: compare the Terms “never text” claim with Privacy's opted-in account-notification texts and Settings. Unchanged by instruction; needs approved wording.
4. **Medium — owner-deferred entitlement policy (round-1 issue 6).** `server/crm/tenancy.ts:33`, `client/src/pages/crm-gateway.tsx:35`: a fresh authenticated growth user requests `/api/crm/me`, receives a new CRM org, then sees an active CRM gateway without a separate subscription check. Unchanged by instruction.
5. **Medium — postcommit notifications have no durable outbox.** `server/crm/integrations.ts:212`: terminate the process after settlement commits but before notification/receipt dispatch, then replay the event; the money remains correct but event deduplication prevents retrying that notification. Financial atomicity is fixed; reliable external delivery needs a separate durable dispatch design.

### Recommended improvements (ranked impact / effort)

1. **High / medium:** an owner-operated historical Stripe reconciliation tool, including ambiguous accounts, legacy status-only refunds and uncredited old settlements; compare against provider records and show an auditable proposed repair before applying it.
2. **High / medium:** a durable notification outbox with retry and delivery status, separate from the atomic accounting ledger.
3. **High / high:** complete export plus tested restore, including signed PDFs, attachments, jobs, notes, settings and payments. Current scheduled exports remain explicitly limited; no restore was built in this round.
4. **High / medium:** resolve the three owner-deferred SMS, legal and entitlement decisions with provider/product/legal evidence.
5. **Medium / medium:** push policy filters into indexed SQL and paginate lists/aggregates. The shared policy establishes one authorization definition, but per-object checks and pre-existing list caps merit load testing for larger contractors.
6. **Medium / medium:** extend isolated fixtures and explicit readiness to the remaining browser suite; enforce zero-retry runs in CI while preserving failure diagnostics.
7. **Medium / medium:** add an authorized refund/credit-note workflow, provider reconciliation status and retainage/closeout tools; current refund ingestion handles provider events but does not initiate refunds.
