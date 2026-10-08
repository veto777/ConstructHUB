# Batch E — producer notes (slot 1, branch `video-batch-e`, 2026-10-08)

Rows are the audit's section (c) "Batch E — must-have" (E1–E16). Everything below was seen while
operating the flows in a slot; nothing here is a guess unless it says so.

## Not produced, and exactly what each one needs

| Row | helpKey | Why not | What would unblock it |
| --- | --- | --- | --- |
| E1 | `crm-setup-checklist` | The "Finish setting up" card (`card-setup` on Home) is not rendered in the demo workspace: `GET /api/crm/onboarding` answers `showChecklist: false` because the owner's profile and the company details are complete and the team has more than one member. | A slot whose workspace has a required step open and `crm_orgs.onboarding_dismissed_at` null — a second, fresh demo workspace in the seed, or a fixture action that resets onboarding for the slot. Emptying the owner's mobile on camera would make the card appear, but that is a contrived first half for a "first day" video. |
| E5 | `crm-stripe-connect` | Connecting is Stripe's own onboarding (never filmed or imitated). | — (the connected state is shown in `crm-payment-link`, `crm-deposit-link`). |
| E9 | `crm-change-order-client-view` | The client's page `/co/<token>` cannot be reached by the recorder. "Mark sent & copy link" (`POST /api/crm/change-orders/:id/send`) only marks the change order sent and copies the link to the clipboard — **no email is sent**, so `email.link` has nothing to open (the plan's "send it on camera, then `email.link`" does not hold for change orders). The token is random per change order, the client portal does not list change orders, and the two seeded Kane change orders are already approved. | Any one of: a fixture action that hands over a change order's client link (e.g. `crm.changeOrderLink { number }` → `/co/<token>`, usable with `session: client`); or the product emailing the client when a change order is marked sent; or a recorder step that opens the address the page just put on the clipboard. |
| E10 | `crm-plans-choose` | The Settings card shows "CRM Max · billed monthly" with the button "Choose a CRM plan" (the demo plan is seeded without a live subscription), no trial-end or renewal line, and "No invoices yet". Both buttons leave for the platform's billing, which is not fixtured. What is left is one badge — under 45 s of true content. | A fixture for the platform's own billing (subscription with a renewal date, invoices list, the billing portal's return), or a seeded live CRM subscription row. |
| E11 | `crm-team-join` | A slot signs every visitor of the CRM in as the demo owner; the invitee's side needs a signed-out visitor. | A signed-out second session in the recorder / slot. |

## Produced with a caveat

- **`crm-estimate-client-options` (E12)** — no demo estimate has options or discount offers, so the
  video adds two options and one offer on camera first (13 short steps) and is 22 steps long. A seeded,
  sent NY/TX estimate with two or three selectable options (option lines from the price book) and one
  or two enabled offers would let this be re-recorded as a client-only video of about 60 s. It runs
  99 s, has no closing "where to find it" step (cut to stay under 100 s; the last lines name the
  client's page under Clients), and the ring of the Discounts / Options click is still fading over the
  dialog for a moment after each opens.
- **`crm-jobcam-share-link` (E8)** — see "Product defects" 1: the line "Prefilled from ." is on screen
  and the recipient is typed by hand. Re-record once the dialog prefills.
- **`crm-jobcam-upload` (E7)** — re-produced from the fixture proof. It now starts on the job
  (Pipeline → the job → JobCam tab → Open camera) instead of the JobCam feed, because the feed showed
  broken image tiles (see "Line gaps" 1). The help entry still says "CRM → JobCam → Open camera, and
  choose the project"; both routes are real.
- **Link fields** (`crm-deposit-link`, `crm-jobcam-share-link`) — the new link is readable for the
  length of the click that creates it, then blurred by the next step (`redact`). See "Line gaps" 3.
- **Watch buttons are not mounted.** Step 8 of the recipe (`<HelpButton k="…" videoOnly />` on the
  page) edits shared client files, which this batch was told not to touch. The eleven videos are in
  the registry and on `/tutorials`; their pages have no Watch button yet.

## Line gaps (pipeline, seed, recorder)

1. **JobCam demo photos are per worktree.** `seed-demo.ts` writes each demo photo's files under
   `process.cwd()/tmp/jobcam/jobcam/<org>/<id>/` while the rows go into the shared template. Rows another
   producer added and reseeded (`demo-photo-07` … `15`, 2026-10-08) have no files in any other
   worktree, so `/crm/jobcam` ("Recent") shows nine broken image tiles there. Needs a shared directory
   for the demo files, or the files made at slot boot from the rows.
2. **A reseed that changes ids breaks `produce.ts` in worktrees on older seed code.** Between the
   template reseed (uuids for NY/TX clients and projects) and merging `video-fixtures` 623be3b, three
   runs stopped in "fresh database" with `duplicate key value violates unique constraint
   "crm_projects_org_number_uniq"` (the old `seed-demo.ts` re-inserting P-1993…P-2000 under the old
   ids). Merging fixed it; a version check between the template and the worktree's seed would say so
   instead.
3. **`redact` only blurs at the start of a step.** A field that a click creates (the deposit link, the
   JobCam share link) is on screen unblurred until the next step begins. Needs "blur this selector as
   soon as it appears" on the click step.
4. **The JobCam share dialog is not lifted out of the caption strip.** The Revoke row of "Existing
   links" sits at about 88% of the frame height; the recorder warns "is in the caption area … cannot
   scroll up" and leaves it (the lift works for the shadcn dialogs).
5. **`press: Escape` did not close a dialog** that the pointer had just clicked in (Options dialog on a
   client page, twice). Clicking the dialog's own Close button works
   (`role=dialog >> role=button[name="Close"]`).
6. **A row scrolled out of an inner list is not brought back.** In the Options dialog's price-book
   list (`max-h-56 overflow-y-auto`), a row above the visible part was not scrolled into view and the
   click landed on the search field. Order the steps so the next row is below the last one.
7. **Possibly: editing `shared/help/**` while a slot is recording.** `gen-index.ts` and `upload.ts`
   rewrite files the dev server's client imports. Two runs that overlapped such a write failed (mux:
   "The capture drifted −207 ms … record again"; thumbnail: "Unable to capture screenshot") and passed
   when repeated; the machine's load average was 10–13 at the time, so the cause is not proven. Since
   then: no `gen-index` / `upload` while a `record` stage is running.

## Product defects seen (not fixed — client and server files are out of scope here)

1. **JobCam Share dialog does not prefill the client.** `client/src/components/jobcam/share-dialog.tsx`
   reads `customer.email`, `customer.phone` and `customer.displayName` from
   `GET /api/crm/customers/:id`, but that route answers `{ customer: {…}, … }`. Result: the recipient
   field is empty and the line reads "Prefilled from ." (visible in `crm-jobcam-share-link`).
2. **Optional discounts preview ignores ticked scopes.** On the client's estimate page, with a scope
   ticked, "Your new total" under Optional discounts is 95% of the *original* estimate ($23,119.10),
   while "Review selection" lists the right figures for the ticked scope ($23,895.32). The narration
   does not mention that line.
3. **The generated estimate's total differs by side until approval.** After "Generate my estimate" the
   client sees the total with the ticked discount ($23,895.32); the CRM's row for the same estimate
   shows it without ($25,152.97). The video says "The discount is confirmed when the client approves",
   which is what both screens state.
4. **Search on Clients blanks the list while it loads** (spinner for a moment after typing) — not a
   defect, but a `type` step into `input-search-clients` needs `"holdMs": 1200` or its last frame is
   the spinner.
