# Batch F — producer notes (slot 4, branch `video-batch-f`, 2026-10-08)

Rows: the audit's section (c) "Batch F — should-have" (F1–F26) plus five rows another producer had to
skip (`crm-hover`, `crm-integrations`, `crm-migrate`, `crm-client-portal-message`,
`crm-client-portal-preview`). Everything below was seen while operating the flows in slot 4.

## Not produced, and exactly what each one needs

| Row | helpKey | Why not | What would unblock it |
| --- | --- | --- | --- |
| F2 | `crm-estimate-extend` | No demo estimate is expired, and "Extend 7 days" sets the expiry to **today + 7 days** (`POST /api/crm/estimates/:id/extend`). On the seeded sent estimates (expiry 25 days out) the button moves the date *earlier* (E-2000: "Expires 11/2/2026" → "Expires 10/15/2026"); on a freshly sent one it changes nothing. The client's "This estimate expired" page cannot be reached either. | One sent, unanswered NY/TX estimate in `seed-demo.ts` with `expires_at` a few days in the past. |
| F6 | `crm-invoice-void` | Void asks with a native `window.confirm` ("Void INV-… ? This can't be undone."), which the recorder's browser dismisses, so the invoice is never voided. | A recorder option to accept a page dialog (and show it), or an in-page confirm dialog in `crm-client.tsx`. |
| F15 | `crm-team-remove` | Same: Remove asks with `window.confirm` (`crm-team.tsx`). The password-reset half alone is one click. | The same dialog handling. |
| F14 | `crm-jobcam-storage` | In a slot the meter reads "<0.1 of 5 GB" and nothing else: the amber "Almost full" note needs 80% and "Storage full / Request more storage" needs the limit. One line of true content. | A fixture or seed that puts the demo workspace at ~4.6 of 5 GB and at the limit (usage row), so the note and the request button exist. |
| F7 | `crm-sales-tax` | Already produced by Batch D (`video-batch-d`). Not repeated. | — |

## Produced with a caveat

- **`crm-integrations`** — the page's second card, Lead capture, shows the CRM host in a link field and
  in the embed code. `redact` only blurs after the recorder has scrolled to the element, so the video
  never scrolls through that card: it shows the top of the page (HOVER, the head of Lead capture), then
  opens the page again at its end (`/crm/integrations#:~:text=Report%20an%20issue` — the footer link, so
  no heading is tinted) and walks upward: Webhooks, API keys, CladAI, Stripe, Google Calendar. Lead
  capture is described in one line and has its own row (integrator). I checked every frame of both
  moves: the link field and embed code are never in frame.
- **`crm-hover`** — "Sync now" on the fixture account answers "3 scanned · 0 matched … · 0 created"
  (the three jobs are already imported), so the first report on the card ("3 by address") is what the
  narration reads, and the second is narrated as "nothing new". The video does not hover the "3D model"
  link (it leaves the site and its address would show in the status bar).
- **`crm-price-floor`** — the refusal is shown from a sales rep's session (`member:Priya Shah`); the
  rep's sidebar shows her real name and role, as the guide says. The toast reads "Could not create the
  estimate — Price lock: 'Cabinet refinishing, spray enamel' can't go below $3850.00/job — the floor set
  by the owner".
- **`crm-estimate-remind`** — recorded on a Florida client (Luis Orozco): his E-2002 is the only seeded
  estimate that is sent, opened and unanswered. The client half opens the reminder email's link.
- **`crm-jobcam-tags`** — starts on the job (Pipeline → Kane job → JobCam tab → Open feed), not on
  CRM → JobCam: in this worktree the Recent feed shows broken tiles for the photos other producers'
  seeds added (Batch E's "Line gaps" 1 — photo files are per worktree, rows are shared).
- **`crm-payment-methods`** — the page prints processor fee figures in its own help text; the narration
  names none of them.
- **`crm-client-portal-documents`** — the "Contract PDF" column is empty for the demo contract (the
  seeded approval has no generated PDF); the video opens nothing from that column.
- **Watch buttons are not mounted** (recipe step 8 edits shared client files).
- States: NY — hover (Oyelaran), client-portal-message (Ferrante), portal-signin (Lindqvist),
  portal-documents (Oyelaran), project-budget and price-floor (Wrenhaven), follow-up-cadence (Ferrante,
  with Brewster TX); TX — client-portal-preview, financing, estimate-attachments, client-question,
  client-decline (Halvorsen-Quist), estimate-tax-deposit, estimate-send-text (Brewster), pamphlets
  (Hadley, then Lindqvist NY); FL — estimate-remind and client-share (Orozco: the only sent, opened,
  unanswered estimate), jobcam-tags (only the Kane job has photos). The import file of `crm-migrate`
  holds two clients each from FL, NY and TX. Settings-only videos show no client.

## Line gaps (pipeline, seed, recorder, product)

1. **No way to blur from page load.** `redact` runs after `aim()` has smooth-scrolled the element into
   view (0.5–1 s of readable frames). Needed for: Lead capture (link + embed code), Settings → Calendar
   (the feed link, `input-calendar-feed-url`, holds host and token), team invite link, API key. A
   script-level `"blur": ["selector", …]` applied from an init script would cover all of them.
   Until then, any scroll that passes Settings → Calendar or Integrations → Lead capture must be
   checked frame by frame; my Settings videos stop above the Calendar card.
2. **No dialog handling.** `window.confirm` is used by Void invoice, Remove member, Revoke invite,
   Disconnect HOVER, delete daily log / price book item / material / labor rate / note / JobCam shot,
   Regenerate calendar feed. None of those can be filmed.
3. **check.ts "only N−1 of N frames"** hit twice in 31 runs (`crm-financing`, `crm-estimate-attachments`).
   The video stream was 16–40 ms shorter than the sound, and the last-frame grab (duration − 60 ms)
   fell past the last picture frame. Re-running `mux.ts … --end 4.02` (a 20 ms longer end card) and then
   `check.ts` passed both times; shortening the end card did not. `produce.ts` leaves `raw.mkv`
   (300–400 MB) behind when this happens — delete it by hand.
4. **ENOSPC.** The disk filled once during a mux (another producer's captures); the run died and left
   `raw.mkv`. A free-space check before `record` would fail earlier and cheaper.
5. **Thumbnail crop.** When the ringed element is wider than ~40% of the frame the crop is the whole
   screen and the ring is under the headline; a step that rings a small element (a pill, a field) gives
   a readable crop. A three-word headline with the accent in the middle covers the screenshot.
6. **Seed wishes.** An expired sent estimate (F2); a workspace near its JobCam limit (F14); one sent
   NY/TX estimate that is opened but unanswered (so `crm-estimate-remind` need not use Florida); a
   declined NY/TX estimate with a reason.
7. **Product notes seen while operating.**
   - "Extend 7 days" can shorten an expiry (it always sets today + 7 days); the toast says "The client
     has 7 more days from today."
   - Settings → SMS reads "Texting via SignalWire from +19415550100" — a carrier name on a customer
     page. `crm-estimate-send-text` ends framed below that line, but it passes through the frame while
     the page scrolls down to the SMS card.
   - The Divisions card in Settings still lists a Bellingham, WA address on the seeded HQ division
     (Batch D's note); scrolls past it are fast but it is in the page.
   - The client's Signed contracts table has an always-empty "Contract PDF" cell for an approval that
     has no PDF.
   - Company pamphlets are managed at the bottom of every *client's* page although they are company-wide.

## Recipes that worked

- A long page (Settings, a client's page): `highlight` a small element inside the card (its title
  text) to scroll there, then point at the controls. Check the frames of the scroll when it passes a
  card that shows a host or token.
- A toast as the target: `li[role="status"]:has-text("…")`.
- A field without a test id beside its label: `[role="tabpanel"]:visible div:has(> label:text-is("Cost $")) > input`.
- A custom list option when the row leaves after choosing it (Follow-ups → Off): `click` the trigger,
  then `click` `role=option[name="Off"]` (the `select` action re-rings the trigger, which is gone).
- A sales rep's refusal: `session: "member:Priya Shah"` with a `url`, then `session: "owner"` with a `url`.
- The portal's own sign-in on camera: `session: "client", url: "/"`, type the address into `form input`
  (a selector containing "email" trips the secrets test), click, then `fixture: email.link` with `open`.
