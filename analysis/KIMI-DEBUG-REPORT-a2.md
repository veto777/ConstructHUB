# KIMI DEBUG REPORT — Lane a2 (UI/UX, client portal, e2e)

Date: 2026-08-08 · Branch: `lane/a2` · DB: `constructhub_dev_a2` · Port: 8139

Status legend: **FIXED** (committed) · **OPEN** (not fixed) · **DESIGN** (needs design input)

---

## 0. Verification summary (updated as runs complete)

| Suite | Result |
|---|---|
| `npm run check` (tsc) | 0 errors throughout |
| vitest (376 tests / 43 files) | **376/376 green** (run 8) |
| e2e parallel phase, baseline | 66 passed / 41 failed → root-caused to the consent banner (D1) + stale specs |
| e2e parallel phase, post-fix | 135 passed / 5 flaky (HMR-churn artifacts) / 1 failed (own spec bug, fixed) |
| e2e full (parallel + serial), clean | **187/187 green** — see §6 |

Environment notes for whoever re-runs this lane:
- vitest's dev-server suites need BOTH `DATABASE_URL` and `CRM_TEST_DATABASE_URL` pinned to the lane DB (different files read different vars) plus `CRM_TEST_BASE_URL=http://127.0.0.1:8139`. Unpinned, they silently hit `constructhub_dev` (main lane's DB) and fail in bizarre cross-wired ways.
- The dev server for vitest needs stub integration env: `HOVER_CLIENT_ID/HOVER_CLIENT_SECRET` (any value; the test provides the HTTP stub via `tmp/hover-stub.json`) and `GOOGLE_CLIENT_SECRET` (the lane `.env` ships only `GOOGLE_CLIENT_ID` — a half-configured env fails the calendar honesty tests).
- `npm run dev` does NOT load `.env`; boot with `npx tsx --env-file=.env server/index.ts` (same as the e2e webServer block) or the server dies on the missing Stripe key.

---

## 1. Rules-of-Hooks audit (the shipped crash class)

Full audit of `client/src/pages` (68 files) and `client/src/components` (73 files):
pattern-scanned (brace-depth-aware checker validated against the pre-fix
pipeline file) + manual review of every early-return region.

- **No remaining instances.** The `crm-pipeline.tsx` crash fixed in `68dc6d8`
  was the only one. Fragile-but-legal spots noted for the future:
  `crm-settings.tsx` (~40 hooks before the early returns — most likely
  regression site), `locations.tsx:1270`, `lsa-account-manager.tsx:124`,
  `crm-estimate-new.tsx:250` (mid-component returns; any hook added below
  them reintroduces the crash).
- **Regression guard added**: `e2e/41-page-smoke.spec.ts` hard-loads every
  main CRM page (empty query cache) and asserts content + zero console/page
  errors — the exact condition the crash shipped under.
- **DESIGN/OPEN (tooling)**: the repo has no ESLint at all, which is how the
  crash shipped. Recommend adding `eslint-plugin-react-hooks`
  (`rules-of-hooks: error`) — one config file, would have caught it at CI.

## 2. Defects found & fixed (recently shipped features)

### Messages inbox (`crm-inbox.tsx`)
- **D2 · FIXED · broken core feature** — Thread select / mobile back button /
  bell-item deep-link were dead clicks. `?c=` was read from
  `window.location.search` with `useLocation()` expected to re-render, but
  wouter 3.3.5's `useLocation` subscribes to the *pathname only* — a
  query-only navigation re-rendered nothing until a lucky 20s poll. Fixed
  with wouter's `useSearch`. (`897078c`, e2e `42-crm-inbox`)
- **D3 · FIXED** — Enter-key reply ignored `isPending` → double-Enter posted
  duplicate replies (server has no idempotency). Guard added. (`897078c`)
- **D4 · FIXED** — Messages arriving in an already-open thread were never
  marked read (latched `readOnce` ref) — badges/waiting-timer kept counting
  while you were reading. Latch removed; server UPDATE is a no-op when
  nothing is unread. (`897078c`)
- **D5 · FIXED** — Invalid/deleted `?c=` rendered an empty conversation with
  a working-looking reply box that 404'd on send. Error state + reply box
  disabled until the thread loads. (`897078c`)
- **D6 · FIXED** — Client name in the conversation header was a raw `<a
  href>` (full SPA reload). Now a wouter `Link`. (`897078c`)
- **D7 · FIXED** — Header crumb said "Inbox", page/sidebar say "Messages";
  the second ternary branch was dead code. (`897078c`)

### Notifications bell + settings channel matrix
- Bell logic (badge counts, mark-all-read, click→navigate+mark-read)
  reviewed — sound. Deep-link defect was D2. e2e coverage added (`42`).
- Channel matrix (`crm-settings.tsx`): PATCH sends the full
  `{inApp,email,sms}` object for the toggled key and the server merges
  per-key — verified correct, legacy booleans upgrade sanely on first
  toggle. No defect.

### Home (`crm-home.tsx`)
- **D8 · FIXED** — With an empty stage list, `undefined === undefined` made
  EVERY project a "lead to follow up". Guarded. (`9ce4325`)
- **D9 · FIXED** — "Open invoices" stat card linked teammates without
  `seePrices` to a page that 403s them. Card de-links when the user can't
  use the target. (`9ce4325`)
- **D10 · FIXED** — projects/team-activity query errors showed "All caught
  up"/"Nothing yet" (misleading empties). Honest inline errors. (`43d9f13`)

### Clients (`crm-clients.tsx`)
- **D11 · FIXED** — Search fired one server request per keystroke. 250ms
  debounce. (`9ce4325`)
- Won/Undecided/Declined tabs, counts, pills, mobile table cards reviewed —
  sound (pill fallbacks, tab+search composition all correct).

### Client portal (`client-portal.tsx`, `portal-messages.tsx`)
- **D12 · FIXED** — "Message now" preselect stuck forever: tapping it for
  member A, then opening Messages later still targeted A. Preselect now
  clears once consumed. (`f52d868`)
- **D13 · OPEN (edge case, needs data-model thought)** — Multi-org
  homeowners: Messages thread, Contact tab team list, and the ribbon camera
  upload all bind to `accounts[0]` — a client with jobs at two contractors
  sends photos/messages to the wrong one. Not a one-line fix; flagged for
  design (needs an account selector in the portal chrome).
- Contact footer wrap at 320px, left mobile drawer, tel:/mailto:, To-picker
  "office" sentinel — verified sound (static + e2e `15`/`26`).

### Public estimate (`public-estimate.tsx`)
- **D14 · FIXED** — Contractor preview of an approved-but-unpaid estimate
  showed a live Pay button despite the preview banner promising payments are
  disabled. Gated on `!preview`. (`f52d868`)
- Sales-rep card, Ask-a-question send/sent-state, discount ticking, logo
  chips, sticky approve bar — reviewed sound (e2e `10`, `27`, `32`).

### Join flow (`crm-join.tsx` + `auth.tsx`)
- **D15 · FIXED · broken-feature** — `?next=` was lost on the
  email/password path: signup → verify email → redirect hardcoded to
  `/?auth=verified`; the invitee never got back to the accept screen. The
  Google path carried it via session `authNext`…
- **D16 · FIXED · latent since passport 0.7** — …except it didn't:
  passport's sessionmanager *regenerates the session on login*, wiping
  `authNext` (and `pending2FAUserId` on the Google→2FA leg — that flow could
  never have worked). verify-email now captures the destination before
  `req.login`; Google callback uses `keepSessionInfo`; the 2FA logout uses
  `keepSessionInfo` too. (`5194b32`, e2e `45-join-flow`)
- **D17 · FIXED · security (moderate)** — `next` validation `/^\/[^\/]/`
  accepted `/\evil.com`; browsers normalize `\` → `/`, turning it into a
  protocol-relative external redirect after OAuth. Regex rejects backslash
  in all three spots. (`56e4a65`, pinned by e2e `45`)

### Platform admin + cookie consent
- **Gate verified live** (server started with `ADMIN_GATE_USER/PASS` in the
  shell, per the brief): gate form renders, wrong creds → 401 toast, Enter
  submits from either field, right creds open the console with standalone
  chrome (no org sidebar), analytics section renders (Top pages shows
  normalized `/e/:token` — D19 confirmed in the UI), org detail sheet opens
  with seats/members/recent estimates. No page errors.
- **D18 · FIXED** — Gate form: Enter in the username field did nothing (only
  the password input had a handler). Wrapped in a real `<form>`. (`52881e0`)
- **D1 · FIXED · the suite-killer** — The consent banner's full-width fixed
  wrapper intercepted pointer events across the bottom of every page in
  fresh sessions: blocked home cards, sweeps, the mobile ribbon, and the
  estimate Approve bar. It shipped with zero e2e and turned 41/107 parallel
  tests red. Wrapper is `pointer-events-none` (card opts back in), the card
  anchors to the corner on desktop, and it floats above sticky bars
  (Approve bar, portal ribbon, CRM mobile ribbon). (`f52d868`, `83f5cde`,
  e2e `44-cookie-consent`)
- **D19 · FIXED · privacy** — Pageview beacons sent raw paths, recording
  bearer tokens (`/e/<token>`) into analytics + `/admin` Top pages. Paths
  normalized to `/e/:token` etc. client-side. (`f52d868`, pinned by e2e `44`)

### Server-side (found while triaging vitest)
- **D20 · FIXED** — HOVER photo sync rewrote `raw_payload` from the stale
  pre-PDF row, silently wiping `pdfAttachmentId` — every measurement lost
  its PDF link. Merge against the current row. (`7d51bf0`, vitest
  `hover.test.ts` 17/17)

## 3. Error-state sweep (loading/error/empty for every query)

Full audit of all 21 `crm-*.tsx` pages + portal/public pages. Defect class:
API 500 → misleading empty state / forever spinner / blank page. Fixed
(`43d9f13`, 10 files): integrations blank page on `/api/crm/me` error,
integrations hover + lead-capture forever-spinners, admin org-drawer
forever-spinner, admin "Platform admins only" misdiagnosis on network
error, inbox/home/project/team/settings/estimate-new/options/preview
misleading empties. Worst single item: the payments-settings form seeded
hardcoded defaults on API error — saving would have silently overwritten
real settings; the form now hides behind an error instead.

## 4. Link & dark-mode audits

- **Links**: every static `Link`/`navigate`/`<a href>` target in
  `client/src` resolves (routes, API paths, public files). One dead end:
  **D21 · FIXED** — the `/settings` gear on the five marketing landing
  pages silently re-rendered the landing page for signed-out visitors (the
  route exists only in the signed-in router). Gear hidden when signed out.
  (`5af2089`)
- **Dark mode**: new components (bid pills, bell, inbox bubbles, banner,
  portal) all use semantic tokens or `dark:` pairs. One missing `dark:`
  variant on a home checklist icon — fixed (`5af2089`). Deliberate white
  logo chips noted as intentional.

## 5. Layout sweep (375px / 1280px)

`e2e/43-layout-sweep.spec.ts` — every main CRM page at both widths: content
renders, zero horizontal overflow. All green. (Footer-clipping sibling hunt:
nothing found beyond the consent banner, D1.)

Visual probes (screenshots, `tmp/probe-shots/`): client portal at 320px and
375px — contact footer wraps, left drawer opens/navigates, Messages thread +
To-picker render, ribbon's solid raised camera button anchored, photo share
view clean, no horizontal scroll, no console/page errors. Public estimate at
375px — rep card, Ask-a-question, share card, signature card, sticky Approve
bar all render; the consent banner floats above the bar.

## 5b. Spec maintenance forced by shipped UI changes (not product bugs)

- `16-mobile`: page title is "Messages" (was "Inbox"); activity feed moved
  behind the Client activity tab.
- `26-portal-v2` / `28-client-360`: portal Messages rebuilt with a To-picker;
  old comment-box testids gone. Specs moved to the new testids.
- `09-crm-join`: phone is required before accept (button disabled without);
  spec now fills it — and asserts the disabled state.
- `08-crm-team`: re-selecting the current role never fires onValueChange —
  no mutation, no toast. Spec now picks a different non-owner role.
- `02-crm-clients`: ~1k accumulated test clients made 80 full-page sweep
  reloads blow the 240s timeout; capped at 30 controls (row links are
  redundant after the first few). **Perf note for design**: the clients page
  renders all rows, no pagination — fine at 1k, will hurt at 50k.

## 6. Final verification runs

| Suite | Final result |
|---|---|
| `npm run check` (tsc) | **0 errors** (re-run after every commit) |
| vitest — 43 files / 376 tests | **376/376 green** (runs 8 + final confirmation) |
| e2e parallel phase — 163 tests (incl. new 41–45) | **162 passed, 0 failed, 0 flaky** |
| e2e serial phase (@serial) — 25 tests | **25 passed, 0 failed** |
| e2e total, clean full run (`tmp/e2e-run5.log`) | **187/187 green** |

Journey: baseline parallel phase was 66 passed / 41 failed, serial never
ran. Root causes, in order of blast radius: the consent banner's
click-swallowing wrapper (D1, ~30 failures), specs stale against shipped UI
(Messages rename, To-picker rebuild, required phone, standalone admin
shell), the clients-sweep timeout on accumulated data, and one real copy
assertion. Run 4: 186/187 (only the stale admin-shell spec). Run 5: fully
green.

New e2e coverage added by this lane:
- `41-page-smoke` — fresh-load render of every main CRM page (hooks-crash
  regression guard).
- `42-crm-inbox` — thread select via `?c=`, mark-read on open, Enter-reply,
  bell badge/mark-all/deep-link, mobile back.
- `43-layout-sweep` — 375px/1280px horizontal-scroll + render check on
  every main page.
- `44-cookie-consent` — accept/decline persistence, no re-show, beacons
  only after accept, server refuses declined beacons, token-normalized
  paths, wrapper never blocks controls.
- `45-join-flow` — signup→verify→back-to-invite, no-next fallback, hostile
  `next=` refused.

## 7. Unresolved / needs design input

- **D13** (multi-org portal binding) — above.
- **ESLint react-hooks** — tooling recommendation, §1.
- Dev-server processes on this box get killed sporadically by an external
  actor (a sibling lane agent, `ConstructHUB-a1`, runs broad `pkill`-style
  cleanup; my server died twice mid-vitest with no error output).
  Worked around with a supervisor loop; not a code defect.
