# CRM walkthrough videos — the plan

Every CRM video to make, one focused task each, 45–100 seconds. **67 rows**, split into four batches
(A–D) for four producers working at once. A batch owns its rows: each video is its own step script
(`docs/tutorials/scripts/<helpKey>.json`), its own help entry (`shared/help/entries/crm/<helpKey>.ts`,
when the key is not already in `shared/help/registry.ts`) and its own manifest
(`shared/help/videos/<helpKey>.json`) — no two batches write the same file. How to make one:
`docs/tutorials/PRODUCER-GUIDE.md`.

The list was made by operating the CRM in a recording slot on 2026-10-07 (every sidebar item, the
Create menu, the client page, the project page and its tabs, the estimate flow through the client's
preview, the schedule dialogs). **Operate each flow again before scripting it** — a row says what the
video is about, not what the buttons are called today.

- **Route** is the help entry's `route`: a real `<Route path>` in `client/src/App.tsx` without an id
  (a client or project page uses its list's route; the script clicks through to it).
- **Keys already in the registry** (no new entry file): `crm-home`, `crm-clients`, `crm-messages`,
  `crm-pipeline`, `crm-schedule`, `jobcam`, `crm-estimates`, `crm-invoices`, `crm-pricebook`,
  `crm-payments`, `crm-team`, `crm-integrations`. Every other key needs its entry file first.
- **Difficulty** — easy: reads a page, clicks, highlights. medium: creates or changes something, or
  needs a little more demo data. hard: needs recorder work (file upload, drag, the client host and
  its one-time code) or an outside test account.
- **BLOCKED** rows cannot be recorded truthfully in a slot (the reason is in the row). As of 2026-10-08
  no row waits for an outside account any more: a slot runs with the **tutorial fixtures**
  (`FIXTURES.md`) — stand-ins for Stripe, HOVER, Google Calendar and texting behind a safety gate — and
  the recorder has `upload`, `drag`, `session`, `fixture` and `wait-for` steps (`PRODUCER-GUIDE.md`).
  Rows that changed are marked **UNBLOCKED** with what to use; the full list is at the end of this
  file. Never stub a page or a response yourself: a connected account comes from a fixture or not at all.
- Demo data that a row asks to "seed" goes in `scripts/tutorials/seed-demo.ts` (idempotent, fictional,
  example.com, 555-01xx) followed by `npx tsx scripts/tutorials/db.ts template --rebuild` — one
  producer at a time, when no producer is recording. Prefer creating what you need inside the video.

Not planned as videos: Settings → staff console, the Platform Admin link, and JobCam capture itself
(a phone camera; the feed, timeline, tags and sharing are covered).


## Batch A — Clients, leads and the pipeline (14 videos: 10 easy, 3 medium, 1 hard)

| # | helpKey | Title | Route | The viewer learns | Demo data it needs | Difficulty | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `crm-clients` | Find a client and read their page | `/crm/clients` | Search the list, open a client, and see what the page keeps together. | Seeded clients (Kane has everything). | easy | DONE |
| A2 | `crm-home` | Read the Home dashboard | `/crm` | What the four counters, Needs attention and Activity tell you each morning. | Seeded pipeline, estimates, invoices. | easy | — |
| A3 | `crm-create-menu` | The Create button | `/crm` | Start an estimate, invoice, lead, message or customer from anywhere. | None. | easy | — |
| A4 | `crm-client-new` | Add a client | `/crm/clients` | New client: name, email, phone, address — and the portal they get. | None (use a new fictional client, example.com email, 555-01xx phone). | easy | — |
| A5 | `crm-client-edit` | Edit or delete a client | `/crm/clients` | Change contact details; what Delete asks before it removes someone. | A throwaway client created in the video. | easy | — |
| A6 | `crm-client-import` | Import clients from a spreadsheet | `/crm/clients` | Import: choose a CSV, map the columns, review, import; Export CSV. | UNBLOCKED: `upload` with `clients-import.csv` (six fictional clients, FL / NY / TX). Same page as D13 — see the audit. | hard | — |
| A7 | `crm-client-bid-status` | Sort clients by bid status | `/crm/clients` | The All / Job Won / Undecided / Declined tabs and where the status comes from. | Seeded clients; add one Declined in the seed. | easy | — |
| A8 | `crm-client-notes` | Client notes and the activity timeline | `/crm/clients` | Add a private note; read the timeline of sends, opens, visits and payments. | Kane (messages, estimate opens). | easy | — |
| A9 | `crm-client-portal-preview` | See what the client sees | `/crm/clients` | Open a client's portal as they see it; copy the portal link. | Kane. | medium | — |
| A10 | `crm-client-quick-actions` | Quick actions on a client | `/crm/clients` | Schedule, estimate, pipeline and payment straight from the client page. | Kane. | easy | — |
| A11 | `crm-lead-new` | Add a lead | `/crm/pipeline` | New lead: who, what job, where it came from — and where it lands on the board. | Lead sources seeded. | easy | — |
| A12 | `crm-pipeline` | Read the pipeline board | `/crm/pipeline` | The stage groups (Prospect, Sales, Production…) and what a card shows. | Seeded projects in every stage. | easy | — |
| A13 | `crm-pipeline-move` | Move a job to the next stage | `/crm/pipeline` | Drag a card, or use the stage menu on it. | Seeded board. UNBLOCKED: `drag` a card onto `[data-testid="stage-col-<stage>"]` (verified on the board), and show the stage menu too. | medium | — |
| A14 | `crm-follow-ups` | Work your follow-ups | `/crm` | Needs attention: fresh leads, follow-ups due, leads waiting on an estimate. | Add a couple of follow-ups due today to the seed. | medium | — |

## Batch B — Estimates, invoices, payments and the price book (18 videos: 4 easy, 9 medium, 5 hard)

| # | helpKey | Title | Route | The viewer learns | Demo data it needs | Difficulty | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | `crm-create-estimate` | Create and send an estimate | `/crm/estimates/new` | Pick the client, add work from the price book, review, send, preview. | Price book, Dana Whitfield. | medium | DONE |
| B2 | `crm-estimates` | Find and filter estimates | `/crm/estimates` | Filter by status and date, search, open one, read its tracking line. | Seeded estimates in several statuses (add Draft, Declined, Expired). | easy | — |
| B3 | `crm-estimate-edit` | Edit and resend an estimate | `/crm/estimates` | Change a line, save, and Resend; what the client's link shows after. | A sent estimate (created in the video or seeded). | medium | — |
| B4 | `crm-estimate-options` | Offer good / better / best options | `/crm/clients` | Add package options to an estimate and mark one recommended. | Kane's or Orozco's estimate; price book packages. | hard | — |
| B5 | `crm-estimate-discounts` | Add a discount | `/crm/estimates` | Discounts on an estimate: fixed or percent, optional for the client. | A draft estimate. | medium | — |
| B6 | `crm-estimate-client-view` | What your client does with an estimate | `/crm/estimates` | The client's side: confirm email, read, ask a question, approve by typing their name. | UNBLOCKED: send the estimate, then `session: "client"` with `fixture: "email.link"` (the emailed link, opened as the client), or `email.signIn` + `estimate` to start signed in. | hard | — |
| B7 | `crm-estimate-approved` | When a client approves | `/crm/estimates` | What changes: status, the signed copy, the project moving to Approved, converting to an invoice. | Seeded approved estimate E-2001. | medium | — |
| B8 | `crm-quick-bid` | Quick Bid from measurements | `/crm/clients` | Price a job from a measurement report and your per-square-foot rates. | A parsed measurement report on a client + quick-bid rates (seed both). | hard | — |
| B9 | `crm-change-orders` | Write a change order | `/crm/pipeline` | Project → Change orders: add one, send it for approval, see the revised contract. | Kane project (has COs). | medium | — |
| B10 | `crm-invoices` | Find and filter invoices | `/crm/invoices` | Status filters (Draft, Sent, Partial, Paid, Void, Overdue), search, open, receipt. | Seeded invoices (add Partial and Overdue). | easy | — |
| B11 | `crm-invoice-create` | Create and send an invoice | `/crm/invoices` | From an approved estimate or from scratch: lines, due date, send. | Approved estimate E-2001. | medium | — |
| B12 | `crm-payment-record` | Record a check or cash payment | `/crm/clients` | Record payment on an invoice: amount, method, note; the balance updates. | Kane's open invoice INV-2002. | easy | — |
| B13 | `crm-payment-reverse` | Reverse a payment | `/crm/payments` | Reverse a recorded payment with a reason; what the ledger keeps. | Seeded manual payments. | medium | — |
| B14 | `crm-payments` | The Payments page | `/crm/payments` | Every payment and its state (succeeded, pending, failed), and Take a payment. | UNBLOCKED: the `stripe` fixture — the account reads connected, and five seeded online payments (paid by card, paid by bank, processing, refunded, failed; TX / NY / FL) sit beside the manual ones. `stripe.settle` / `stripe.refund` change one on camera. Do not film Connect / Disconnect. | hard | — |
| B15 | `crm-payment-link` | Send a payment link | `/crm/payments` | Take a payment: pick the client, amount, send the card/ACH link. | UNBLOCKED and PRODUCED 2026-10-08 (not uploaded): `docs/tutorials/scripts/crm-payment-link.json` — Hannah Lindqvist (Buffalo NY), INV-1999, the stand-in checkout in the client's session, back to Payments. | hard | produced |
| B16 | `crm-pricebook` | Tour the price book | `/crm/pricebook` | Price Chart, Materials, Labor and Formulas — what each tab is for. | Seeded price book. | easy | — |
| B17 | `crm-pricebook-add` | Add a price book item | `/crm/pricebook` | Add SKU: name, code, unit, price, scope of work; preview a quantity. | None. | medium | — |
| B18 | `crm-pricebook-template` | Start a price book from a template | `/crm/pricebook` | From template: pick a trade and bring its items in. | Empty-ish category to show the import. | medium | — |

## Batch C — Projects, schedule, JobCam and messages (17 videos: 10 easy, 7 medium, 0 hard)

| # | helpKey | Title | Route | The viewer learns | Demo data it needs | Difficulty | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `crm-schedule` | Schedule and edit an appointment | `/crm/schedule` | Add a visit, link the client and crew, my calendar vs everyone's, change a time. | Seeded week of appointments. | medium | DONE |
| C2 | `crm-schedule-views` | Month, week and agenda | `/crm/schedule` | Switch views, move between weeks, jump back to Today, one person's calendar. | Seeded week. | easy | — |
| C3 | `crm-schedule-from-client` | Book a visit from a client's page | `/crm/clients` | Schedule appointment on the client page; it lands on the calendar too. | Kane. | easy | — |
| C4 | `crm-schedule-calendar-feed` | Put the schedule in your phone's calendar | `/crm/settings` | Settings → calendar: copy the private feed link; regenerate it. | None (blur the link: redact). | medium | — |
| C5 | `crm-project` | Read a project page | `/crm/pipeline` | Revised contract, budget, committed, actual cost, gross profit — and the tabs. | Kane project P-2001. | easy | — |
| C6 | `crm-project-costing` | Budget and costs | `/crm/pipeline` | Costing tab: budget lines by cost code, add an actual cost, watch the margin. | Kane project (budget + costs seeded). | medium | — |
| C7 | `crm-project-punch-list` | Punch list | `/crm/pipeline` | Add punch items, assign, tick them off. | Kane / Nguyen project. | easy | — |
| C8 | `crm-project-daily-log` | Daily logs | `/crm/pipeline` | Write today's log: who was on site, what got done, weather, notes. | Kane project. | easy | — |
| C9 | `crm-project-selections` | Selections | `/crm/pipeline` | Track what the client still has to choose, with a due date. | Kane project (seed two selections). | medium | — |
| C10 | `crm-project-permits` | Permits on a project | `/crm/pipeline` | Record a permit, its number and status against the job. | Kane project (seed one permit). | medium | — |
| C11 | `crm-project-new` | Start a project for a client | `/crm/clients` | New project on a client: name, trades — and its card on the pipeline. | Dana Whitfield. | easy | — |
| C12 | `jobcam` | The JobCam feed | `/crm/jobcam` | Every job-site photo by project: search, tags, starred, photos/videos, dates. | Six demo photos (colour cards). | easy | — |
| C13 | `crm-jobcam-timeline` | JobCam timeline and a photo's details | `/crm/jobcam` | Timeline view; open a photo: caption, tags, who took it, when. | Demo photos. | easy | — |
| C14 | `crm-jobcam-share` | Show photos to your client | `/crm/jobcam` | Visible to client on a photo; select several; share. | Demo photos. | medium | — |
| C15 | `crm-jobcam-project` | Photos on a project | `/crm/pipeline` | Project → JobCam tab; Open camera (shown, not used: capture needs a phone). | Kane project. | easy | — |
| C16 | `crm-messages` | Answer client messages | `/crm/inbox` | The inbox: who is waiting, open a thread, reply; Client activity tab. | Three seeded threads, one unread. | easy | — |
| C17 | `crm-message-send` | Send a client an email or text | `/crm` | Create → Message: pick the client, write, send by email; when Text is available. | None. Email goes to the dev outbox. Text: the `sms` fixture gives the demo company its own number (+1 941 555 0100), so Text is available and a send lands in the slot's SMS outbox — it can be shown. | medium | — |

## Batch D — Team, settings, integrations and everything else (18 videos: 6 easy, 9 medium, 3 hard)

| # | helpKey | Title | Route | The viewer learns | Demo data it needs | Difficulty | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | `crm-team-profile` | Your profile | `/crm/team` | My profile: name, title, mobile — how the crew sees you. | None. | easy | — |
| D2 | `crm-team-invite` | Invite a team member | `/crm/team` | Team tab: email, role, send the invite; resend or cancel it. | Seats free on the demo plan. Invite goes to the outbox (example.com). | medium | — |
| D3 | `crm-team-roles` | Roles and permissions | `/crm/team` | What each role can do; switch one permission for one person. | Six seeded members. | medium | — |
| D4 | `crm-team-divisions` | Divisions | `/crm/team` | Company tab: add a division with its own name, address and licence. | Two seeded divisions (demo licence numbers). | medium | — |
| D5 | `crm-company-settings` | Company profile and branding | `/crm/settings` | Name, logo, address, licence — and where they print. | `upload` with `logo-aspire-interiors.png` (made for the demo). | medium | — |
| D6 | `crm-document-defaults` | Document defaults | `/crm/settings` | Deposit, tax rate, estimate and invoice footers, terms, warranty text. | Seeded defaults. | easy | — |
| D7 | `crm-notifications` | Notifications | `/crm/settings` | Which alerts you get and how; the bell. | A few seeded notifications (the recorder hides only the unread count). | easy | — |
| D8 | `crm-integrations` | Integrations tour | `/crm/integrations` | What each card connects: HOVER, lead capture, calendar, API keys, webhooks. | None. | easy | — |
| D9 | `crm-lead-capture` | Lead capture form for your website | `/crm/integrations` | Copy the embed code or the link; where a submission lands. | Then submit the public form once (new document: needs the form's host route). | medium | — |
| D10 | `crm-hover` | Connect HOVER | `/crm/integrations` | Connect once; reports land on the matching client. | UNBLOCKED: the `hover` fixture — the card reads connected (webhook verified, last sync, auto-sync), Sync now runs the real sync against three stand-in jobs, and Ellison (FL), Oyelaran (NY) and Hadley (TX) each have a measurement, a PDF and a photo. Connecting itself is HOVER's own sign-in: say it, do not film it — retitle "HOVER reports on your clients". | hard | — |
| D11 | `crm-api-keys` | API keys and webhooks | `/crm/integrations` | Create a read-only key (shown once), add a webhook. | None. Blur the key (redact). | medium | — |
| D12 | `crm-reports` | Import a measurement report | `/crm/reports` | Upload the PDF or paste the text, review the parse, confirm — the client is matched. | A fictional report text written for the video. | medium | — |
| D13 | `crm-migrate` | Bring your data from another CRM | `/crm/migrate` | Pick what to import, upload the export, preview before anything is written. | UNBLOCKED: `upload` with `clients-import.csv`. | hard | — |
| D14 | `crm-client-portal` | The client portal, from the homeowner's side | `/crm/clients` | What a client finds: estimates, invoices, photos, messages. | Via “See what the client sees” on Kane (same tab in the recording). | medium | — |
| D15 | `crm-client-portal-message` | A client sends you a message | `/crm/clients` | The client writes from the portal; it appears in Messages with the unread badge. | UNBLOCKED: `session: "client"` with `fixture: "email.signIn"` (the client signed in to their portal), write the message, then `session: "owner"`. | hard | — |
| D16 | `crm-billing` | CRM plans and seats | `/crm/team` | Where your plan and seats show; adding a seat. NO PRICES SPOKEN — the page shows them. | Demo plan is seeded active; checkout itself needs Stripe (do not record it). | medium | — |
| D17 | `crm-report-issue` | Report an issue from the CRM | `/crm/report-issue` | Say what happened, check the page, send — and follow the report. | None. The report is stored in the recording database only. | easy | — |
| D18 | `crm-search` | Find anything fast | `/crm` | The sidebar toggle, dark mode, and where each page's “i” and Watch button are. | None. | easy | — |


## Unblocked on 2026-10-08 — fixtures and recorder actions

What each previously blocked or "hard" video now uses. **Operate the flow first, as always** — only
B15 and E7 have been filmed; the rest are unblocked in the sense that nothing outside the slot is
missing. Keys E–G are the rows proposed by the coverage audit (not yet rows of this plan).

| helpKey | Was waiting for | Use |
| --- | --- | --- |
| `crm-payments` (B14) | Stripe test account | `stripe` fixture + seeded payments; `stripe.settle`, `stripe.refund`, `stripe.fail` |
| `crm-payment-link` (B15) | Stripe test account | **Produced.** `session: client` + `email.signIn`, `stripe.checkout` (`open`), the stand-in checkout |
| `crm-deposit-link` (E16) | Stripe test account | Same, from `button-deposit-link-*` on an approved estimate |
| `crm-invoice-client-view` (E4) | Stripe (pay buttons) | `session: client` + `email.signIn` with `invoice`; the Pay buttons work |
| `crm-payment-methods` (F10) | Stripe connected, to save | `stripe` fixture; operate first |
| `crm-hover` (D10) | HOVER sandbox | `hover` fixture (connected card, Sync now, measurements on three clients) |
| `crm-google-calendar` (E13) | Google credentials | `google-calendar` fixture: connected card, Sync now with real counts. Not the consent screen |
| `crm-sms-setup` (E6) | A text sender | `sms` fixture: Configured, own number, consent, Send test (lands in the SMS outbox) |
| `crm-estimate-remind` (F16), `crm-estimate-send-text` (F17) | A text sender | `sms` fixture; `sms.last` shows what went out |
| `crm-message-send` (C17, text half) | A text sender | `sms` fixture |
| `crm-jobcam-upload` (E7) | File upload | **Produced.** `upload` (three drawn photos), `wait-for`, `session: client` |
| `crm-client-import` (A6), `crm-migrate` (D13) | File upload | `upload` with `clients-import.csv` |
| `crm-estimate-attachments` (F18), `crm-pamphlets` (F19) | File upload | `upload` with `care-guide.pdf` |
| `crm-client-photos` (G4), `crm-company-settings` (D5, logo) | File upload | `upload` with `photos/…`, `logo-aspire-interiors.png` |
| `crm-estimate-client-view` (B6), `crm-estimate-client-options` (E12), `-question` (F20), `-share` (F21), `-decline` (F22) | Client host + emailed link | `session: client` + `email.link` / `email.signIn` with `estimate` |
| `crm-client-portal-message` (D15), `crm-client-portal-signin` (F25) | Client host + emailed link | `session: client`; for F25 type the email on camera, then `fixture: email.link` with `open` |
| `crm-change-order-client-view` (E9), `crm-jobcam-share-link` (E8) | A known public token | Send it on camera, then `email.link` opens what was emailed — no fixed token needed |
| `crm-estimate-tracking` (E3) | Seeded opens | `email.opened` (visits at believable earlier times) or a real open in the client's session |
| `crm-team-crew-view` (G6) | A second sign-in | `session: "member:Marco Delgado"` (really signed in as that member) |
| `crm-pipeline-move` (A13) | Drag | `drag` |

**Still blocked**

| helpKey | Why |
| --- | --- |
| `crm-stripe-connect` (E5) | Connecting is Stripe's own onboarding: it cannot be filmed honestly and is never imitated. The connected state, Refresh and Disconnect can be shown inside B14 |
| `crm-team-join` (E11) | Needs a signed-out visitor: a slot signs every CRM visitor in as the demo owner. Recorder / slot work |
| `crm-plans-choose` (E10), `crm-billing` (D16, checkout), `crm-jobcam-storage` (F14, add-on purchase) | The platform's own billing is not fixtured (only the CRM's connected payments are). Stop at the button, as written |
| `crm-setup-checklist` (E1) | Needs a workspace whose onboarding is unfinished (seed) |
| Project pages of the New York and Texas jobs (any row filmed on them) | Their ids (`demo-project-p-…`) are not uuids and the project page answers "Project not found" — a seed fix in `seed-demo.ts` |
| `crm-project-permits` (C10), packages in `crm-estimate-options` (B4), lead source in `crm-lead-new` (A11) | The product has no screen for it (audit, section e) |
