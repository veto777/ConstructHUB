# KIMI BUILD REPORT — Lane a2: Estimates · Price book · Divisions

Date: 2026-08-11 · Branch: `lane/a2` · DB: `constructhub_dev_a2` · Port: 8139

Build target: the owner's field notes — estimates ship with no scope/verbiage,
descriptions "don't save / don't show", a sent estimate can't be edited or
deleted, the price book is "way too bland", and FL/WA divisions must be
unmistakably separate on client-facing documents.

---

## 1. The description bug — root cause (owner's #1 complaint)

The **server was never broken**. `crm_estimate_items.description` existed,
the create/PUT-items endpoints persisted it, and the public page rendered it
(`public-estimate.tsx:829`, `portal.ts publicEstimateView`). The break was
entirely in the two builders:

- **Mobile fast path** (`crm-estimate-new.tsx`, the `/crm/estimates/new`
  three-step builder): hardcoded `description: null` on every line item in the
  POST body, had **no input at all** for scope text, and did not pull the
  price-book item's description when one was tapped into the cart. Every
  estimate built here — the path the owner used — shipped bare lines
  ("Hardie Siding $30,000").
- **Desktop quick dialog** (`crm-client.tsx`, a1's file — NOT modified): the
  field labeled "Description" writes to the line's **name**; the real
  `description` field is always sent as null. Same symptom, same dialog the
  owner tried to type descriptions into. See "Open items" below.

So: descriptions "didn't save" because the builders never sent them, and
"didn't show" because nothing was ever stored to show.

### Fix
- `crm-estimate-new.tsx`: every cart line now carries an editable
  **scope & details** textarea, prefilled from the price-book item's
  description on add; the review step shows the scope per line; the POST body
  sends `description` (never hardcoded null). A **message to the client**
  (introText) field and a **division (letterhead)** pick were added to the
  review step, and the done screen links straight into the estimate.
- Line-item description limit raised 4000 → 8000 chars (long-form scope).
- Round-trip pinned by tests: save → CRM GET → gated public view (below).

## 2. Edit AND delete a sent estimate

- **New endpoint** `PATCH /api/crm/estimates/:id` (`server/crm/entities.ts`):
  edits title, introText, termsText, taxRateBps, depositCents, projectId,
  divisionId, status (never into "approved"), and line items (wholesale
  replace, price-floor enforced). Works on **draft and sent** estimates —
  the client link renders current rows immediately, no re-send needed.
  Totals are always recomputed server-side; client-supplied totals are
  ignored. An **approved** estimate is a signed contract: 409, same wall as
  the items PUT. Every edit logs an `updated` event (`afterSend` flag) and
  an `estimate.updated` activity — the trail stays honest.
- **Re-send revives** (`server/crm/portal.ts`): sending a declined / expired /
  cancelled estimate flips it back to `sent`, clears the stale decline, and
  mints a fresh 7-day window; the send event records `resend`/`revived`.
- **New page** `/crm/estimates/:id` (`crm-estimate-detail.tsx`): full view
  (items with scope text, totals, tracking strip, events trail, client-link
  copy, preview), an **Edit** mode with per-line name/kind/qty/unit/price/
  taxable/hidden + scope text and live total preview, **Send/Resend**, the
  client-selectable discount offers (reused `EstimateDiscounts`), and an
  owner-only **Delete** with a confirm dialog. Approved estimates render
  read-only with an explanation. Declined estimates tell the owner to edit
  and resend.
- **Documents Center** (`crm-documents.tsx`): every estimate row gets an
  **Open** action → the detail page. (The pre-existing owner delete in the
  list is untouched; e2e-pinned row navigation to the client page is
  untouched.) Delete was already owner-only server-side; it's now reachable
  from the estimate itself too.

## 3. Price book — templates & detail

- **10 trade templates** (`crm-pricebook.tsx`, "From template" button):
  HardiePlank/HardiePanel/HardieTrim, architectural re-roof, standing-seam
  metal, exterior repaint, seamless gutters, window replacement,
  soffit & fascia, composite deck resurfacing — each with multi-line,
  HCP-depth scope verbiage ("what's included" bullets, prep, cleanup,
  warranty). Picking one prefills the SKU dialog; price stays the owner's.
- SKU dialog: description is now a 6-row long-form editor labeled as what it
  is — the text the client reads on every estimate built from this SKU.
- SKU cards show a description preview so detail is visible at a glance.
- Server seed (`pricebook.ts`) now writes real scope verbiage instead of a
  one-liner.
- Per-sqft pricing untouched (owner said it's fine) — this adds the
  surrounding detail only. Templates flow into estimates automatically
  because the builder now pulls item descriptions.

## 4. Divisions FL / WA

- New column `crm_estimates.division_id` — an explicit letterhead pick on the
  estimate itself. Resolution order is now: **the estimate's own pick → its
  project's division → the customer's latest project → the org**
  (`divisions.ts resolveEstimateDivision`; invoices follow via
  `resolveInvoiceDivision`; list scoping maps updated to match). Before this,
  a projectless estimate always fell back to the org (WA HQ) letterhead.
- The owner can pick the division at creation (mobile builder review step)
  or any time after (detail-page editor; `PATCH` validates the division
  belongs to the org).
- The public estimate's letterhead now shows an explicit **division badge**
  ("Aspire Interiors — Washington · WA division") so FL and WA documents are
  unmistakably separate, on top of the already-correct name/address/license
  merge (`companyBranding`).
- Migration applied to `constructhub_dev_a2` with an idempotent
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (repo convention — drizzle-kit
  push trips on pre-existing drift, see `scripts/apply-schema-migration.ts`).
  Script kept at `scripts/add-estimate-division.ts`. **Other lanes/prod
  need the same statement** when this merges.

## 5. Files touched

Server:
- `server/crm/entities.ts` — PATCH route; `divisionId` on create + presenter;
  description limit 8000. (Estimate blocks only.)
- `server/crm/portal.ts` — re-send revives declined/expired/cancelled; send
  events record resend/revived.
- `server/crm/divisions.ts` — explicit-pick-first resolution for estimates
  and invoices; scoping maps.
- `server/crm/pricebook.ts` — richer seed verbiage.
- `shared/schema.ts` — `crm_estimates.division_id`.

Client:
- `client/src/pages/crm-estimate-new.tsx` — scope text per line, intro,
  division pick, done-screen link.
- `client/src/pages/crm-estimate-detail.tsx` — **new** detail/edit page.
- `client/src/pages/crm-documents.tsx` — per-row Open action for estimates.
- `client/src/pages/crm-pricebook.tsx` — templates, previews, long-form editor.
- `client/src/pages/public-estimate.tsx` — division badge, scope text more
  prominent.
- `client/src/App.tsx` — route registration only.

Tests:
- `server/crm/estimate-edit.test.ts` (8 vitest cases) — description
  round-trip (save → GET → public), edit-after-send with server-recomputed
  totals (discount math unchanged: $30,000 − $500 + 10% tax = $32,450),
  hostile-totals ignored, approved → 409 on PATCH and DELETE,
  declined → edit → resend revives, foreign-org estimate → 404 on
  GET/PATCH/DELETE (tenant isolation), sent-estimate delete, division
  letterhead on the public view + bogus-division 400 + fallback on clear.
- `e2e/46-estimate-detail.spec.ts` — list → Open → Edit → Save persists
  scope text; a sent estimate edits and deletes from the UI.

## 6. Verification

All gates re-run on the final merged code (HEAD `f8bd0fe`):

- `npm run check` (tsc) — **0 errors**.
- `npm test` (vitest, lane-pinned env) — **490/490 green** (52 files,
  incl. the 8 new estimate-edit tests).
- `npm run test:e2e` (`E2E_PORT=8139 E2E_DB=constructhub_dev_a2`) —
  **168/168 parallel + 25/25 serial = 193/193, exit 0**
  (`tmp/e2e-run-a2-final.log`), incl. the new `46-estimate-detail` spec.

Environment landmines (documented so the next run doesn't trip them):
- vitest needs `CRM_TEST_BASE_URL`/`DATABASE_URL`/`CRM_TEST_DATABASE_URL`
  pinned from `.env` — unpinned, it silently hits the main lane's server on
  8119 and new-feature tests fail bizarrely.
- The dev server for e2e must boot with `DEV_AUTH_BYPASS_USER1=true
  VITE_FORCE_PORTAL=true` (or playwright's own webServer block); without
  them the CRM routes render the marketing site and half the suite fails.
- The lane orchestrator reset `lane/a2` to merged `main` mid-session
  (23:49) and restarted lane servers — a dev server that dies with no log
  line around a merge window is that, not a crash.

Environment note: vitest needs `CRM_TEST_BASE_URL`/`DATABASE_URL`/
`CRM_TEST_DATABASE_URL` pinned from `.env` (vitest does not auto-load it —
unpinned, tests silently hit the main lane's server on 8119 and new-feature
tests fail bizarrely). e2e needs the dev server booted with
`DEV_AUTH_BYPASS_USER1=true VITE_FORCE_PORTAL=true` (or playwright's own
webServer block) — a server booted without those renders the marketing site
and fails ~half the suite. Both bit me once this run; documented in
`analysis/KIMI-DEBUG-REPORT-a2.md` already.

## 7. Open items / honest gaps

- **(RESOLVED by merge)** The `crm-client.tsx` quick dialog's "Description"
  field wrote the line *name* and had no scope input — a1's file, so I left
  it. The lane-merge commit `da83841` added a proper per-line Scope & details
  textarea there, crediting this lane's diagnosis.
- **(RESOLVED by merge)** `da83841` also added the
  `crm_estimates.division_id` ALTER to `server/crm/schema-ensure.ts`, so
  existing/prod DBs get the column at boot. The lane DB got it from
  `scripts/add-estimate-division.ts`.
- `status` is editable via PATCH/UI for un-approved estimates (per the
  brief); moving a sent estimate back to "draft" leaves `sentAt` set —
  harmless but cosmetically odd.
- The division badge shows when a division resolves; org-letterhead
  documents show no badge (nothing to disambiguate).

## 8. Mid-session lane merge

At ~23:24 the orchestrator merged lanes a1+a3 into this branch (`f9113a1`,
`309d232`, `da83841`) and validated "Suite 490/490". All gates in §6 were
re-run on the merged code: `npm run check` 0 errors, vitest **490/490**
(52 files), e2e per §6. A pre-existing test-infra bug surfaced and was
fixed here (`6786293`): `notifications.test.ts`'s pref restore flattened
granular `{sms:true}` channel objects to boolean `true` (sms silently OFF),
which broke e2e/37 on the shared org; e2e/37 now sets the channel itself.
Two environment landmines (not code bugs) cost one red run each and are
documented in §6: vitest needs the lane env pinned explicitly, and the e2e
dev server must boot with `DEV_AUTH_BYPASS_USER1=true VITE_FORCE_PORTAL=true`.
Two merge-integration test fixes landed here: e2e/37 sets its own
clientReengaged sms channel (`6786293`), and e2e/16-mobile's schedule
curated spec now opens the Agenda view before asserting the day-grouped
list (`f8bd0fe`) — a1's calendar page defaults to month view.
