# Producing a walkthrough video — the recipe

One person (or agent), one video at a time, one **slot**. Eight slots (1–8) can work at once. Read
`CLAUDE.md` first; the pipeline's internals are in `VIDEO-PIPELINE.md`; the list of CRM videos and who
takes which is `CRM-VIDEO-PLAN.md`.

**Hard rules**

- Record only the demo workspace: "Aspire Interiors", signed in as "Demo Account". Never production,
  never the dev database's data, never a real company, customer, address, phone or email.
- Never touch port 5433 (production Postgres) — the tools refuse it, do not work around them.
- Every narrated sentence is true of what is on screen in *your* dry run. No feature that is not
  built, no price (prices live in the plan model and change), no promise.
- The voice engine answers live customer calls. Never call it except through `narrate.ts`.
- Do not push, merge or deploy. Commit on your branch; do not commit `analysis/`.

## The recipe

```bash
K=crm-pipeline          # the helpKey: its row in CRM-VIDEO-PLAN.md
N=2                     # your slot, 1–8 (ports 8181–8188); one producer per slot
```

1. **Help entry.** If `K` is not already a key in `shared/help/registry.ts`, write
   `shared/help/entries/crm/$K.ts` (copy `crm-create-estimate.ts`): `key` = the file name, `group:
   "CRM"`, a `route` that is a real `<Route path>` in `client/src/App.tsx` with no `:id`, 3–5 steps
   in `howToUse`. Every sentence from the code or from what you saw. Then
   `npx tsx scripts/tutorials/gen-index.ts`.
2. **Operate the flow.** `npx tsx scripts/tutorials/app.ts up $N` gives you a fresh copy of the demo
   workspace on `http://portal.constructhub.us:818$N` (the name is mapped to this machine inside the
   recorder's browser only). Write a first script — `docs/tutorials/scripts/$K.json`, copy
   `crm-schedule.json` — with placeholder narration and play it:
   ```bash
   npx tsx scripts/tutorials/record.ts docs/tutorials/scripts/$K.json --base http://portal.constructhub.us:818$N --dry --out /tmp/claude-1000/tut-dry-$K
   ```
   A dry run takes seconds, records nothing, and leaves `steps/NN.png` (LOOK at them) and
   `steps/NN.txt` — every `data-testid` on that screen with its text (`↓` = below the fold). Build the
   flow a few steps at a time. A dry run changes the slot's data; `app.ts down $N && app.ts up $N`
   starts clean.
3. **Write the narration from what really happened** (rules below), add the `youtube` and `thumbnail`
   blocks and three or more `chapter`s. `app.ts down $N`.
4. **Produce** — always without uploading first:
   ```bash
   npx tsx scripts/tutorials/produce.ts $K --slot $N --no-upload
   ```
   About four minutes: fresh database → app → warm-up → narrate → record → mux → thumbnail → check
   → app stopped, database dropped, raw capture deleted. Output: `analysis/video-out/$K/`.
5. **Inspect.** Open `contact-sheet-*.jpg` (every step's last frame, the two cards) and
   `thumbnail.jpg` + `thumbnail-320.png`. Check, frame by frame: the cursor is where the line says;
   the ring is on the right element; text is readable; no half-loaded page; only demo names; no
   cookie banner, assistant bubble or bell count; nothing important under the bottom sixth (captions
   sit there); the headline of the thumbnail reads at 320 px. `check.ts` already measured the rest
   (1920×1080, 30 fps, H.264 High + AAC 48 kHz stereo, −14 LUFS ±1, true peak ≤ −1 dBTP, captions on
   every line, three chapters).
6. **Fix and produce again** until a whole run is clean. Narration clips are cached by their text, so
   only a changed line reaches the voice engine.
7. **Upload the files you inspected** (not a new run):
   ```bash
   npx tsx scripts/tutorials/upload.ts $K        # create-only put to R2, then writes shared/help/videos/$K.json
   ```
8. **Make it reachable.** Put `<HelpButton k="$K" videoOnly />` beside the page's title — CRM pages
   pass it as `help={…}` to `CrmPageHeader`, or sit it after the page's `InfoTip`. (A key mounted in
   the client must exist in the registry; the test checks.)
9. **Verify and commit.**
   ```bash
   npm run check && npx vitest run server/help-registry server/tutorials shared
   git add docs/tutorials/scripts/$K.json shared/help/videos/$K.json shared/help/videos/index.ts \
           shared/help/entries client/src/…            # only your own files
   ```
   Tick your row in `CRM-VIDEO-PLAN.md` in your final report, not in the file (four producers would
   collide on it) — the coordinator updates the plan.

**Resuming after an interruption.** `produce.ts` cleans up after itself, also on Ctrl-C. If it was
killed hard: `ss -ltnp | grep 818$N` and kill that pid, then `npx tsx scripts/tutorials/app.ts down $N`
(stops the app and drops the slot's database). Whatever is in `analysis/video-out/$K/` is disposable;
`produce.ts` starts from nothing every time. If the upload was interrupted, run `upload.ts $K` again:
objects already in R2 are left alone and the manifest is written once all three are there. A stale
`index.ts` → `npx tsx scripts/tutorials/gen-index.ts`. `npx tsx scripts/tutorials/db.ts list` shows
which recording databases exist.

## Demo data

The workspace is "Aspire Interiors" (Sarasota, FL), signed in as "Demo Account". Everything in it is
invented (`scripts/seed-crm-demo.ts` + `scripts/tutorials/seed-demo.ts`): the people, the companies and
the street addresses are made up and were not checked against real ones; only the city / state / ZIP
pairs are real places. Use these names exactly — narration and selectors (`:has-text("…")`).

| State | Client (exact display name) | City | What they have |
| --- | --- | --- | --- |
| FL | Joe & Mary Kane | Sarasota | P-2001 In Progress · E-2001 approved · INV-2002 sent · JobCam photos · messages |
| FL | Dana Whitfield | Osprey | P-2002 Lead · **E-1996 declined** (her only estimate: she is the one client under Clients → Declined) |
| FL | Luis Orozco | Bradenton | P-2003 Estimating · E-2002 viewed, with **Good / Better / Best options** (Better recommended) · the one unanswered message |
| FL | The Mercer Group (company) | Sarasota | P-2004 Proposal Sent · pending ACH deposit |
| FL | Greta Ellison | Venice | P-2005 Scheduled · deposit by check · messages · a measurement report (fixtures) |
| FL | Tom & Priya Bauer | Sarasota | P-2006 Waiting on Trades · failed card payment |
| FL | Lan Nguyen | Bradenton | P-2007 Punch List · cash payment |
| FL | Vince Castellano | Venice | P-2008 Paid · INV-2001 paid |
| NY | Rosa & Stefan Ferrante | Brooklyn | P-1993 Lead · **follow-up due today** (weekly rhythm; Home → Needs attention, and Follow-ups) · visit in 3 days · message thread (answered) |
| NY | Tunde Oyelaran | Albany | P-1994 Approved · E-1997 approved (8% tax) · deposit by check · visit tomorrow · a measurement report (fixtures) |
| NY | Hannah Lindqvist | Buffalo | P-1995 Invoiced · INV-1999 sent (8.75% tax) · **four JobCam photos** (two visible to the client, one starred) |
| NY | Wrenhaven Dental Studio (company) | White Plains | P-1996 Estimating |
| TX | Caleb & Nora Hadley | Austin | P-1997 Scheduled · E-1998 approved (8.25% tax) · deposit by check · visit in 2 days · message thread (answered) · **four JobCam photos and a 4 s clip** · a measurement report (fixtures) |
| TX | Imani Brewster | Dallas | P-1998 Estimating · E-1999 draft (8.25% tax) |
| TX | Rafael Quintanilla | Houston | P-1999 Complete · INV-2000 partial (8.25% tax), half paid by check |
| TX | Halvorsen-Quist Properties (company) | San Antonio | P-2000 Proposal Sent · E-2000 sent (8.25% tax) · visit in 5 days · one read message |

The client list shows the newest first and mixes the states: Vince Castellano, Caleb & Nora Hadley,
Lan Nguyen, Rosa & Stefan Ferrante, Tom & Priya Bauer, Imani Brewster, Greta Ellison, Tunde Oyelaran,
The Mercer Group, Rafael Quintanilla, Luis Orozco, Hannah Lindqvist, Dana Whitfield, Halvorsen-Quist
Properties, Joe & Mary Kane, Wrenhaven Dental Studio. The New York and Texas documents carry numbers
below the Florida ones, so the next document made on camera is still E-2003, INV-2003 or P-2009.
With sixteen clients a short search can match more than one of them — type enough letters, and
look at the frame.

**Added on 2026-10-08 (three reseeds of the template, 03:29, 03:50 and 04:05 UTC — a copy made before
them has the older data).**

- **JobCam is on three jobs, one per state**: Kane (FL, six shots, `demo-photo-01`…`06`), Hadley (TX,
  `demo-photo-07`…`10` and the clip `demo-photo-11`) and Lindqvist (NY, `demo-photo-12`…`15`). The
  pictures are the drawn job-site scenes of `scripts/tutorials/assets/photos` (no more brown "Demo
  photo N" cards); the Recent feed still opens on the six Kane tiles. The files are in **one object
  store that every slot on the box reads** (`/tmp/claude-1000/constructhub-tutorials/jobcam-store`,
  the slot app's `JOBCAM_LOCAL_ROOT`), written by whichever copy seeds or reseeds — a broken or brown
  tile means that working copy has not merged this line yet (its app still reads its own `tmp/jobcam`).
- **Divisions** (Settings → Divisions): Aspire Interiors — Florida (Sarasota, headquarters), — New
  York (Albany) and — Texas (Austin), each with an invented "Demo …" street line, a suite and a
  `DEMO-<state>-1001` licence. The New York and Texas jobs run under their division, so their
  estimates and invoices carry that division's letterhead. **No sales-tax rate is set on any
  division or on the company** (see "Sales tax" below).
- **Quick Bid** works on the three clients with a measurement report (Ellison, Oyelaran, Hadley —
  the HOVER fixture's jobs, so only with fixtures on): the price book has two items priced per square
  foot of wall, `PT-EXT-SF` "Exterior repaint, per sq ft of wall" and `PT-WASH-SF` "Exterior wash and
  prep, per sq ft of wall".
- **Follow-ups, the Declined tab and Good / Better / Best** each have one row to show: see the table.
- **An estimate the client opened and has not answered**: E-1995, Wrenhaven Dental Studio (White
  Plains NY) — viewed twice. **An expired estimate**: E-1994, The Mercer Group (Sarasota FL) — sent
  five weeks ago, past its expiry date. Both number below the others (the next one made on camera is
  still E-2003), so Home's "Open estimates" and the Undecided tab count two more than before.

**The jobs, by state** — every one has a working project page (`/crm/projects/<id>`), a JobCam page
and a card on the pipeline. Use the name or the number in narration and in `:has-text("…")`.

| State | Number | Project name (exact) | Client | Stage | City |
| --- | --- | --- | --- | --- | --- |
| FL | P-2001 | Kane — whole-house hardwood | Joe & Mary Kane | In Progress | Sarasota |
| FL | P-2002 | Whitfield — kitchen backsplash + floors | Dana Whitfield | Lead | Osprey |
| FL | P-2003 | Orozco — LVP downstairs | Luis Orozco | Estimating | Bradenton |
| FL | P-2004 | Mercer — lobby refresh | The Mercer Group | Proposal Sent | Sarasota |
| FL | P-2005 | Ellison — master suite floors | Greta Ellison | Scheduled | Venice |
| FL | P-2006 | Bauer — cabinet refinishing | Tom & Priya Bauer | Waiting on Trades | Sarasota |
| FL | P-2007 | Nguyen — rental turnover LVP | Lan Nguyen | Punch List | Bradenton |
| FL | P-2008 | Castellano — guest bath tile | Vince Castellano | Paid | Venice |
| NY | P-1993 | Ferrante — parlor floor white oak | Rosa & Stefan Ferrante | Lead | Brooklyn |
| NY | P-1994 | Oyelaran — galley kitchen floor and tile | Tunde Oyelaran | Approved | Albany |
| NY | P-1995 | Lindqvist — baseboards and stair trim | Hannah Lindqvist | Invoiced | Buffalo |
| NY | P-1996 | Wrenhaven — reception flooring | Wrenhaven Dental Studio | Estimating | White Plains |
| TX | P-1997 | Hadley — bungalow LVP | Caleb & Nora Hadley | Scheduled | Austin |
| TX | P-1998 | Brewster — subway tile backsplash | Imani Brewster | Estimating | Dallas |
| TX | P-1999 | Quintanilla — kitchen cabinet respray | Rafael Quintanilla | Complete | Houston |
| TX | P-2000 | Halvorsen-Quist — duplex flooring, both units | Halvorsen-Quist Properties | Proposal Sent | San Antonio |

**Ids — find rows by name, not by id.** The ids of the Florida clients, jobs and documents are made
by the database and differ in every template build. The New York and Texas rows have fixed ids:

- **Clients and projects: uuids** (since the reseed of 2026-10-08 02:58 UTC / 2026-10-07 22:58 Eastern).
  They used to be `demo-client-hadley` / `demo-project-p-1997`, and the app refused those: the
  project page said "Project not found" and "See what the client sees" opened a signed-out portal.
  A selector that still names one (`card-project-demo-project-p-1994`, `project-demo-project-p-1998`,
  `pick-client-demo-client-ferrante`, `client-demo-client-…`, `thread-demo-client-…`) no longer
  matches — select by text (`[data-testid^="card-project-"]:has-text("P-1994")`) or use the id below.

  | Client | id | Project | id |
  | --- | --- | --- | --- |
  | Rosa & Stefan Ferrante | `e3d0aeaa-fa3e-5c70-847c-c758e5d4cf13` | P-1993 | `3f0147f4-5e28-5a22-8909-78d326b3a525` |
  | Tunde Oyelaran | `3d523658-5af0-5414-a9fc-23d1bd383a4e` | P-1994 | `e809dd9f-f4f3-5a0f-b8e7-b5bfda4c464a` |
  | Hannah Lindqvist | `c81a2dac-e323-5227-a95f-31409db3fc00` | P-1995 | `a8f16f80-e572-5aa3-8b17-685c69a55304` |
  | Wrenhaven Dental Studio | `51c23c0b-f6a4-5421-8722-3ded98941a9e` | P-1996 | `8e76e74e-9392-58fc-ae7f-6100a679dc3b` |
  | Caleb & Nora Hadley | `b5ac6e7a-ce39-50b1-a39e-5b326d166d80` | P-1997 | `51f02ef8-0dfa-50a4-8247-eb2012cb5482` |
  | Imani Brewster | `8b05f9de-dd79-5719-bbc6-622c2d75e07c` | P-1998 | `a8b8ca24-bbe4-5d0a-9771-c35aad18e517` |
  | Rafael Quintanilla | `106e2cea-befe-51ee-b75a-64890a2e5648` | P-1999 | `60e6b77c-b3f2-5866-850a-608ad8271f61` |
  | Halvorsen-Quist Properties | `922d4e0c-ba4f-5af1-882a-e3446b1f3772` | P-2000 | `00f12701-566f-50c4-acab-6b00c417dc58` |

- **Everything else keeps its readable id**, unchanged: `demo-estimate-e-1997`…`e-2000`,
  `demo-invoice-inv-1999`, `demo-invoice-inv-2000`, `demo-appt-01`…`16`, `demo-msg-01`…`11`,
  `demo-pay-01`…`07`, `demo-member-priya`, `demo-member-owen`, `demo-tag-1`…`4`, `demo-photo-01`…`15`,
  `demo-estimate-e-1996`.
  No page checks the shape of those (the page walk below opens every one), and scripts already
  select them (`invoice-demo-invoice-inv-2000`, `appointment-demo-appt-04`).

**Sales tax — what is true on screen (operated 2026-10-07, the same for FL, NY and TX).** The app does
not know a state's tax rate. A new estimate takes its rate from the job's *city* in a division's
tax table, else the division's default, else the company default (Settings) — and the demo workspace
has none of the three set. So:

- In the New estimate wizard the review step shows, for every client: "Sales tax — Added
  automatically from the client's address", and a **Total equal to the Subtotal**. No tax amount is
  shown there.
- The estimate it creates has **Tax $0.00** (rate 0%) — for a Florida client, a New York client and a
  Texas client alike. Do not say that tax "was added" or name a rate for a new estimate; "tax comes
  from the rate you set in Settings" is the most that is true, and only if you show that setting.
- The tax on the seeded documents (7% Florida, 8% Albany, 8.75% Buffalo, 8.25% Texas) was typed on
  each document, like the "Tax %" field of the estimate editor does. You may say an estimate "shows
  its tax above the total"; do not say the app worked the rate out from the state.

**Changing the demo data.** Add rows to `scripts/tutorials/seed-demo.ts` (fixed ids,
insert-if-absent, dates relative to now) — never rename, reorder or delete one, scripts find rows by
name. **A new client or project gets a uuid from `scripts/tutorials/demo-ids.ts`** (`demoClientId`,
`demoProjectId` — add its key to the list there), never a readable `demo-…` id: the app refuses those
(the file says where). Other tables may keep readable ids. Then, in this order:

```bash
npx vitest run server/tutorials                      # demo-ids.test.ts: every such id is a uuid the app accepts
npx tsx scripts/tutorials/app.ts up 8 --no-warm      # a free slot: a copy of the template + YOUR seeds
npx tsx scripts/tutorials/check-demo.ts 8            # opens every demo client, job, estimate, invoice, payment,
                                                     # visit and message thread; exit 1 on "not found", an error or a 4xx/5xx
npx tsx scripts/tutorials/db.ts reseed               # only now: the template, one transaction
npx tsx scripts/tutorials/app.ts down 8 && npx tsx scripts/tutorials/app.ts up 8 --no-warm
npx tsx scripts/tutorials/check-demo.ts 8            # the same walk on a fresh copy of the new template
npx tsx scripts/tutorials/app.ts down 8
```

**`check-demo.ts <slot>` is the thing to run after any seed change** — about three minutes, read-only,
some 85 pages. It reads the entities from the slot's database, so a row you add is walked without
touching the script. `db.ts reseed` applies the seed to the template in one transaction, so producers
can keep recording — a copy made at that moment holds the old data or the new, never half; it prints
the workspace's row counts before and after (`db.ts census <name>` prints them for any slot) and
refuses to finish if a client or project id is not a uuid. Never pass `--fixtures` to a reseed while a
producer is on older code (its pages would show accounts as connected that it cannot serve);
`produce.ts` adds the fixture rows to each slot. If a reseed waits for ever, a dead producer is holding
the template lock (`ps -ef | grep template.lock`): once you are sure it is dead, `reseed --without-lock`
— still one transaction. (`db.ts template --rebuild` drops the template and needs every producer
stopped.) A reseed changes counts and totals on Home, Pipeline and the lists: check your frames after one.

## House style

**Frame.** Every script: `"viewport": { "width": 1024, "height": 576 }, "zoom": 1.875` — a
1920×1080 master in which the page is laid out for a 1024-wide window, so everything is 25% larger
than on a 1280 screen and the content fills the frame. The CRM sidebar stays open (it is how people
find things; "Demo Account" fits). The zoom is the browser's real device scale, so the pixels are
real 1080p, not an upscale. The same file is the in-app video (5–8 MB for 70–80 s) and the YouTube
upload.

**Pacing.** 45–100 seconds, 12–20 steps, one task. One idea per step. The recorder holds each step
for its line plus a short pause — a long sentence is a long, still shot, so split it into two steps
that each point at something.

**Sentences.** Plain words for a contractor, second person, present tense. A sentence fits two caption
lines: 84 characters at most is safe (longer ones are split at a comma). Say the label exactly as the
screen shows it ("Choose Send estimate", "Tick who is going"). Phrase clicks as *choose / click /
tick / type / open* — never "simply", "just", "easily". Open by saying what the viewer will do; end
on where the feature is in the menu. No "welcome", no sign-off, no music.

**The demo is a demo.** Narration must never claim the demo company or its numbers are real customers
or real results — no "our customer", no "contractors see", no "this company made". Say what the screen
does.

**Forbidden.** Real customer or company names; emails that are not `@example.com`; phones outside
`555-01xx`; any price or plan price; claims about features that are not built or not configured in
the slot (a page that says "not configured" is not recorded — see BLOCKED in the plan); a provider's
own screen imitated (the checkout stand-in is said to be a stand-in); how the video
was made (tools, voices, vendors); anything typed that looks like a secret (use `{{PLACEHOLDER}}` +
`"redact": true`).

**Pointing.** `highlight` for "look here", `hover` for links, `click`, `type` (replaces the field;
date and time fields take `2026-10-09` / `13:30`), `select` (native and custom lists, by visible
name), `back`, `goto`, `wait`, `scroll-to` (bring a card of a long page under the header: `selector`,
`offset` — instead of a `#:~:text=` address, which leaves a purple highlight on the heading) — and
`upload`, `drag`, `session`, `fixture`, `wait-for` (next section). A `click` whose page asks "are you
sure?" with the browser's own box takes `"dialog": "accept"` (without it the recorder answers Cancel;
the box itself is never on camera — say what it asked). A `highlight` or `hover` may `"punch": 1.3` —
the page pushes in on the target for that step.
The ring is the brand orange everywhere. Use `{{DATE}}`, `{{DATE+1}}`
for dates — the demo data moves with the calendar, so never name a weekday or a date in narration.

**Selectors.** Prefer `[data-testid="…"]` (the dry run lists them). A row by its text:
`[data-testid^="client-"]:has-text("Joe & Mary Kane") a`. A generated id never goes in a script
(`[data-testid^="estimate-"]`, not the uuid) — ids change with every fresh database; ids that start
`demo-` (appointments, photos, members, messages, payments) are fixed by the seed and safe. Text
selectors (`text=Outstanding balance`) only where there is no test id.

**Chapters, YouTube, thumbnail** (all in the step script):

- `"chapter"` on at least three steps (the first step always opens one at 0:00), 10 s or more apart.
- `youtube.title` ≤ 70 characters, task first: "How to … | ConstructHUB CRM". `description`: two or
  three true sentences. ≤ 12 `tags`. Playlist "ConstructHUB CRM tutorials", category 28.
- `thumbnail.headline`: 2–5 punchy words, true to the video; `accent`: the one word on the orange
  pill; `step`: a `highlight`/`type`/`hover` step whose ring marks the key element (a `click` loses
  its ring).

**Secrets that appear by themselves** — a key shown right after "Create", a join link, an embed code
with the host in it — are blurred **from page load** with the script's own list, before the element
first paints: `"redactSelectors": ["[data-testid=\"text-new-api-key\"] code"]` (plain CSS selectors).
A step's `"redact": true` only blurs once that step reaches its target; use both when a later step
points at the secret (`crm-api-keys.json`).

**What a typed value may be** (the test reads the VALUE, not the selector's name): demo text; an email
only at `example.com`; a phone only `555-01xx`; nothing shaped like a key or a token; a password field
takes a `{{PLACEHOLDER}}`, and every placeholder is `"redact": true`. A key's *name*, a search and a
demo address are typed as they are — no xpath detours.

**Chapters are checked before anything is filmed.** `record.ts` works out from the lines' own lengths
where each chapter would start and refuses the script when fewer than three would be 10 s apart (a dry
run warns) — move the mark to a later step. **An outside link's address** (the status-bar bubble,
bottom-left) is drawn only in a script that sets `"showLinkAddress": true`. **Disk:** `produce.ts` will
not start with under 8 GB free; delete finished productions' `raw.mkv`, `narration/` and `steps/`
(never masters, captions, thumbnails, contact sheets or cuts).

**Dialogs.** `press` `Escape` is sent to the topmost open dialog (after a click inside one, focus used
to be on the page and the key did nothing). A target in the caption strip is brought up by moving its
dialog; where the dialog is a full-screen wrapper with a panel in it (the JobCam share sheet), the
panel is what moves. A change order's client page is reached with the `email.changeOrder` fixture; a
video that needs the setup checklist open starts with `"before": [{ "fixture": "auth.unfinishedSetup" }]`
(`FIXTURES.md`).

**Under load.** A click or a choice waits (up to 3.5 s) until what it asked the server for is back, so
steps no longer need a blanket `holdMs: 1200`; keep `holdMs` for what the viewer needs time to read.
A page that a click opened whole stays on screen at least 1.6 s before a `back` or a `goto` leaves it.
A refused screenshot is asked for again. `produce.ts` keeps the capture until mux and check have
passed and tries each of them once more; if it still fails, fix the cause and finish with
`npx tsx scripts/tutorials/produce.ts $K --from-raw [--no-upload]` — no second recording.

## Uploads, drags, a second person, connected accounts

A slot runs with the **tutorial fixtures** (`FIXTURES.md`): the demo company's Stripe account, HOVER,
Google Calendar and texting number read as connected, with stand-ins answering on this machine. Nothing
to set up — `produce.ts` and `app.ts up` do it (`--no-fixtures` for the workspace without them).

| Step | Fields | What happens on camera |
| --- | --- | --- |
| `upload` | `selector`, `files` | The pointer clicks the button or drop area and the files are chosen (the system file dialog is never shown). `files` are demo files under `scripts/tutorials/assets/` only: `photos/site-01.jpg` … `site-08.jpg` (drawn job-site scenes), `clip-floor-walkthrough.mp4`, `logo-aspire-interiors.png`, `care-guide.pdf`, `clients-import.csv`. A hidden `input[type=file]` can be the target too (no pointer). The dry run lists every file input (`⬆`). |
| `drag` | `selector`, `to` | Press, carry (the card is drawn following the pointer), drop. Works on the pipeline board. The dry run marks what can be dragged (`⇄`). |
| `session` | `session`, and `url` or `fixture` + `input` | The camera switches to another person's browser: `"owner"`, `"client"` (the homeowner, own cookies), `"member:Marco Delgado"` (really signed in as that team member — not relabelled). The previous picture is held until the new page has drawn. |
| `fixture` | `fixture`, `input`, `open` | Calls a fixture helper (`FIXTURES.md` lists them). `"open": true` opens the address it answers with — the link in an email, the checkout link — in the current session. |
| `wait-for` | `selector` and/or `text`, `state`, `timeoutMs` | Waits until it is on screen (or `"state": "hidden"`: gone). Use it for uploads and anything that finishes on its own time. It still needs a narration line. |

Patterns that work (see `crm-payment-link.json`, `crm-jobcam-upload.json`):

- **The homeowner, already signed in** — `{ "action": "session", "session": "client", "fixture": "email.signIn", "input": { "to": "greta.ellison@example.com" } }`
  opens their portal; add `"invoice": "INV-1999"` (or `"estimate"`) to land on that document instead.
- **The link in an email you just sent** — `{ "action": "session", "session": "client", "fixture": "email.link", "input": { "to": "…@example.com" } }`.
- **A payment** — create the link in the CRM, then in the client's session
  `{ "action": "fixture", "fixture": "stripe.checkout", "open": true }`, choose a method, click
  `button-checkout-pay`. Say that the checkout page is a stand-in.
- **Later** — `{ "action": "fixture", "fixture": "stripe.settle" }` (a bank payment clears),
  `email.opened` (the client opened the estimate ninety minutes ago).

Rules: a session switch is a cut, so say whose screen it is ("Now your client."). Connecting an account
is the provider's own screen and is never filmed or imitated — start from the connected state. Give a
`session` step back to `"owner"` a `holdMs` of a second so the page is seen before the next line.

## After merging `video-fixtures`

Your working copy keeps recording as it is until you merge; the template it copies is already the
new one. Merge `video-fixtures` into your branch when your current video is done, then:

- **New recorder actions** — `upload`, `drag`, `session`, `fixture`, `wait-for` (the table above;
  `FIXTURES.md` lists the fixture helpers).
- **Eight slots** — `--slot 1`…`8` (ports 8181–8188). Keep to the slot you were given.
- **Fixtures are on by default** in `produce.ts` and `app.ts up`: Stripe, HOVER, Google Calendar and
  texting read as connected, and five online payments are on the Payments page. Counts on Payments and
  on some client pages differ from what you recorded before — look at your frames. `--no-fixtures`
  records the workspace as it was.
- **Rows that are now recordable** — `CRM-VIDEO-PLAN.md`, "Unblocked on 2026-10-08": payments and
  payment links, the client's view of estimates and invoices, HOVER, Google Calendar, texting,
  uploads (photos, CSV import, attachments, logo), the pipeline drag, a team member's own view — and
  every row filmed on a New York or Texas project page.
- **Old ids in your scripts** — `grep -l 'demo-\(client\|project\)-' docs/tutorials/scripts/*.json`
  and replace each with the uuid from "Demo data" (or a `:has-text` selector) before you re-record.
- **After any change of yours to the seeds** — `check-demo.ts <slot>` ("Demo data").

## Cards (overview films only)

`{ "action": "card", "card": { … } }` draws a full-screen brand card over the page for that step
(`scripts/tutorials/card.ts`; nothing of it ships in the app): `kicker`, `headline` + `accent` (the
words on the orange pill), then either `stat` (`value`, `label` — a whole figure counts up) or exactly
two `columns` (them, then us with `"us": true`: `title`, `value`, `unit`, up to four `lines`), a
`footnote`, and `"mascot": true` for the gator. Everything that matters sits in the middle column, so
the phone cuts show the whole card. **A number on a card is a claim**: a card that shows a price is
refused without a footnote that says whose list price it is and the year; a film that names a price
lists where it was read in `youtube.sources` (label, url, date) and the companies it names in
`youtube.names` — both go into the description (SOURCES, the trademark line). A column's price never
counts up. Tutorials do not use cards and never say or show a price.

## Overview films ("Start here")

The films that say what ConstructHUB is are not tutorials: their facts and scripts live in
`docs/brand/FACT-BASE.md` and `docs/brand/VIDEO-SCRIPTS.md`, their help entries in
`shared/help/entries/start-here/` (keys start `brand-`; the group leads `/tutorials`, in the order
`START_HERE_ORDER` in `shared/help/registry.ts` gives). They are made on the same line. Two things
differ: a tour may cross both apps — a `goto` opens a `/crm…` path on the CRM host and any other path
on the main host, whatever the base. Their scripts find the demo clients and jobs by name; the one id they use is a fixed
demo uuid from "Ids" above (the tour opens the Hadleys' page AT its JobCam block: a `goto` with a
`selector` arrives already scrolled there, and nothing above it — the money totals — is ever filmed).
A film carries no Google logo: its script lists the side menu's three under `hideSelectors`. A film
that opens on its own hook card gets a 0.8 s title card and a 2.5 s end card instead of 1.8 s and 4 s. Nothing in a brand film names a competitor or states a competitor's price without the owner's
sign-off recorded in `VIDEO-SCRIPTS.md`.

**They are held.** Every film's help entry carries `youtube: { hold: true }`: `youtube-schedule.ts` and
`social-post.ts` never plan it and list it as "held for owner approval" until the owner releases it
(`--release <key>` on the run that posts it). The named comparisons (`brand-vs-…`) are also
`unlisted: true` — not in the app at all — and their manifests wait in `docs/brand/held-manifests/`;
"Releasing a held film" in `VIDEO-SCRIPTS.md` is the checklist (re-read every price first). Their
descriptions come from the `brand` variant of the builder: what ConstructHUB is, the two products,
links, sources, chapters, what the film says, how to start — no keyword bank, no length target.

## Publishing to YouTube

Producers do not upload anything: a production leaves everything upload-ready in
`analysis/video-out/<helpKey>/`, and **one** person or agent — the coordinator, never a producer slot
— runs the scheduler from an up-to-date checkout of `main` on vb11.

| File | What it is |
| --- | --- |
| `walkthrough.mp4` | The master: 1920×1080, 30 fps, H.264 High yuv420p + AAC 48 kHz stereo, −14 LUFS (true peak ≤ −1 dBTP), fast-start; a ≤ 2 s branded intro card and a 4 s end card ("More tutorials — constructhub.us/tutorials") |
| `captions.srt` | English captions with timing (`captions.vtt` is the in-app twin) |
| `thumbnail.jpg` | 1280×720, under 2 MB (`thumbnail-320.png`: the same at list size) |
| `youtube.json` | Channel (Construct HUB, `@ConstructHUB-t3v`, `UCRsxhhzhirrQCnqETChhyFw`), title, description with chapter timestamps from the step timings, "Try it" and in-app help links, tags, playlist, category, `madeForKids: false`, language `en`, `privacyStatus: "private"`, and the measured size / length / loudness of the file |

### The scheduler — `scripts/tutorials/youtube-schedule.ts`

Three videos a day, published **by YouTube itself**: each video is uploaded now as *private* with a
publish time (`status.publishAt`) and YouTube makes it public at that time. Nothing of ours has to be
running when a video goes out, and there is no cron.

```bash
cd ~/ConstructHUB-<checkout of main>          # the manifests in shared/help/videos decide what is eligible
S="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/youtube-schedule.ts"

npx tsx scripts/tutorials/youtube-schedule.ts   # DRY RUN (default): the table of what would go out and when
$S --go                                         # upload them: private + publish time, captions, thumbnail, playlist
$S --reconcile                                  # ask YouTube what really happened; update the ledger
$S --retry-thumbnails --go                      # set thumbnails that are not "ok" yet
npx tsx scripts/tutorials/youtube-schedule.ts --print-description crm-schedule     # the text one video gets
npx tsx scripts/tutorials/youtube-schedule.ts --update-descriptions                 # DRY: new text for what is already up
$S --update-descriptions --go                   # send it (title, description, tags only)
npx tsx scripts/tutorials/youtube-schedule.ts --calendar    # write docs/tutorials/youtube-calendar.md
npx tsx scripts/tutorials/youtube-schedule.ts --lint-all    # REPORT: every script in every worktree — rules, short descriptions
```

- **Title, description and tags are built at upload time** by `server/youtube/description.ts` — a
  producer changes nothing. YouTube allows 5,000 characters in a description (5,000 *bytes* through
  the API, and no `<` or `>`), so every video gets 4,300–4,900 characters of readable text: the search
  phrase and the benefit in the opening line ("How to … in ConstructHUB CRM - …", the part that shows
  above "Show more"), the script's `youtube.description`, who it is for and the link; *In this video*;
  the chapter list from `youtube.json` (only when it is one YouTube accepts — otherwise *Steps*,
  without times); *Step by step* (the narration, numbered); *What you need*, *Good to know* and the
  short version from the help entry; *Why contractors use this* and the *Search terms* line from the
  hand-written bank for the video's area (`AREAS` in that file — every sentence restates a help
  entry; add to it only what a help entry says); related tutorials (a link only once a video is
  public); *About ConstructHUB*; three to five hashtags. Wording that is shared between videos is
  picked by a hash of the help key, so descriptions are not copies of each other. Sentences in a
  script or entry that say "best", "#1", "guarantee", "included with", a data vendor's name or the
  CRM's host name are left out (and reported). A title is kept unless it is over 70 characters; tags
  are the script's own, then the area's, up to 450 characters.
  `--print-description <helpKey>` shows what a video would get. `--update-descriptions [helpKey…]`
  rebuilds the text of videos that are **already** posted or scheduled — dry by default (length and
  first 200 characters each; `--save DIR` writes them out to read), `--go` sends them
  (`videos.update`, `part=snippet`: nothing about the video, its schedule or its status changes) and
  records the text, its length and its sha256 in the ledger. `server/youtube/description.test.ts` lints the scripts
  committed in the checkout it runs in, and nothing else (no sibling worktree, no `analysis/` output —
  the same result on every machine). The lint over **every** worktree on the box, unfinished scripts in
  other people's folders included, is a report: `youtube-schedule.ts --lint-all` (exit 2 only when a
  rule is broken). **A description that cannot reach 4,300 characters from its own material is not an
  error and is never padded**: it is sent as it is, `--lint-all` and the dry run flag it
  ("! key: its description is N characters …"), and the cure is more true text in the help entry or
  the script. (The builder first adds the rest of the related tutorials, up to eight.)
- **When.** After a batch of videos has been merged to `main` and deployed (so the in-app page the
  description links to shows the video): dry run, read the table, `--go`, `--calendar`, commit the
  ledger and the calendar. `--reconcile` once a day while videos are going out — it exits 2 and
  prints `!!!!` lines when something needs a person.
- **The ledger**, `docs/tutorials/youtube-schedule.json` (committed), is the source of truth for what
  is posted: video id, link, status (`scheduled` / `published` / `failed`), the publish time in UTC
  and Eastern, the sha256 of the mp4 that went up, and how captions / thumbnail / playlist went. It
  is written after every video and every step, so an interrupted run loses nothing. **A key that is
  in the ledger is never uploaded again**, and a slot that is taken is never moved.
- **Eligible** = `walkthrough.mp4` + `captions.srt` + `youtube.json` in an out-dir, the mp4 is the
  encode `youtube.json` describes, **and** `shared/help/videos/<helpKey>.json` exists in the checkout
  the tool runs from (the video is merged). `--out-dir DIR` (repeatable) says where to look; by
  default every `~/ConstructHUB*/analysis/video-out`. The dry run lists what it found but will not
  post, and why; `--include-unmerged` (dry run only) previews those too.
- **Slots.** Every day in America/New_York gets one morning, one midday and one late time, each from
  its own pool (06:00 06:30 07:00 08:00 09:00 · 11:00 12:00 12:30 13:00 14:00 · 15:30 16:00 17:00
  18:30 19:30), picked from the date itself: always at least three hours apart, never the same time
  in the same slot two days running, the same answer every time it is asked, DST-correct. The host
  clock (UTC on vb11) plays no part. `--per-day 2` is morning + late; `--per-day 1` is one time a day
  from 06:00 09:00 12:00 14:00 16:00 18:30 08:00 11:00 15:00 19:30. New videos start tomorrow
  (Eastern) or on the last day in the ledger that still has a free slot; `--start YYYY-MM-DD` moves that.
- **Order**, `docs/tutorials/youtube-order.json`: tracks, one per area (getting started, clients and
  leads, estimates, schedule, invoices and payments, projects, JobCam, messages, team and settings,
  integrations, client portal), each in learning order. The scheduler takes one video from each track
  in turn, so a day's three videos come from three areas. A key that is not produced yet keeps its
  place and takes the next free slot when it arrives; a key in no track goes last, alphabetically.
  Add a new feature's key to its track when you add its row to `CRM-VIDEO-PLAN.md`.
- **Quota.** One run uploads at most `--max` videos (default 30; the project allows about 100
  uploads a day and customers' own uploads share that). When YouTube says the day's limit is used up
  the run stops cleanly; run it again after midnight Pacific.
- **A re-recorded in-app video** (its manifest in `shared/help/videos` no longer names the file that
  was uploaded) is reported by every dry run: `!!!! key: master changed since upload — run --replace
  key` while the old cut is still scheduled (it would go public at its time), `! key: …` once the old
  cut is public. `--replace` refuses any file that is not the merged master. A video that is not in the
  ledger — held, or simply not scheduled yet — needs nothing: its first upload takes the new master.
- **Held videos** are listed as `⏸ key: held for owner approval (reason)` and never planned;
  `--release key` plans them for that run. Two kinds: the overview films (`youtube: { hold: true }` on
  their help entries — the owner releases them), and **tutorial cuts that must not go out as they
  are**, each with its reason and what releases it in `shared/help/holds.ts`. A cut that must not be
  *shown in the app* either has its manifest moved to `docs/tutorials/held-manifests/` (its README says
  why). Re-record, delete the line, done.
- **A new cut of a posted video** is reported ("the mp4 … is NOT the file that was uploaded") and not
  re-uploaded. `--replace <helpKey>` uploads the new file into the same slot (or the next free one if
  the old one is already public) and prints the old video id: **delete that one by hand in YouTube
  Studio** — the tool never deletes a video, and an old scheduled video would otherwise go public too.
- **Category** is `youtube.json`'s `categoryId` (the step script's `youtube.category`, 28 by default);
  26 (Howto & Style) when it names none; `--category N` forces one for a run. Never made for kids.
- **Thumbnails.** The channel is phone-verified (since 2026-10-08), so `thumbnail.jpg` is set with the
  upload. A refusal is recorded as `failed: …` and shouted about; a video with no `thumbnail.jpg` yet
  is `pending`. `--retry-thumbnails --go` tries every one that is not `ok` again.
- **What it touches in production:** it reads the channel connection from the production database and
  saves the refreshed access token there (the same thing the server does). Nothing else is written.
  The plain dry run and `--calendar` use neither the database nor Google.
- **What YouTube requires for a scheduled upload:** the video must be private and never published;
  the time at least 15 minutes ahead (the tool keeps an hour). A Google Cloud project that has not
  passed YouTube's API audit gets its uploads locked private — this project's uploads did go public
  on 2026-10-07, so it is not locked today; if that ever changes, `--reconcile` reports the video as
  `LOCKED PRIVATE` once its time has passed.

The library is `server/youtube/schedule.ts` (tests: `server/youtube/schedule.test.ts`); the
description builder is `server/youtube/description.ts` with its file reading in
`description-sources.ts`; the YouTube calls are in `server/youtube/client.ts` (`uploadVideo` with
`publishAt`, `updateVideoSchedule`, `updateVideoSnippet`, `getVideoStatus`).

**The thumbnail template** (`scripts/tutorials/brand.ts`, rendered by `thumbnail.ts`): a saturated
brand-blue field (#1a73e8, brighter and deeper at the edges) with faint rays, an orange shape
(hsl 25 95% 53%) with a white edge, the headline in Anton — white, dark-blue edge, one word on an
orange pill — the kicker ("CRM Tutorial") on a white pill, a tilted, white-bordered crop of the
recording with the orange ring on the key element, the standing gator (the brand mascot, never
redrawn or recoloured) large on one side with a white outline, the CHUB logo on a white tile. Four
layouts — gator right or left, the orange as a slab or a sun — chosen from the help key, so a video
always gets the same one and a channel page gets all four. The bottom-right corner carries nothing
that matters (YouTube prints the length there). Anton is bundled (`scripts/tutorials/assets/`, SIL
OFL); nothing is fetched at render time. To try another layout: `thumbnail.ts <script> --variant 0-3`.
The in-app poster stays a plain frame of the video (`poster.jpg`) — the thumbnail is for YouTube.

## Social cuts

The 16:9 master is right for YouTube and wrong for a phone feed. `scripts/tutorials/social.ts` re-frames
a **finished** master — nothing is re-recorded, the voice engine is never called — into:

| File (in `analysis/video-out/<helpKey>/social/`) | What | For |
| --- | --- | --- |
| `vertical.mp4` | 1080×1920, 30 fps, H.264 High + AAC 48 kHz stereo, **59 s at most**, −14 LUFS (true peak ≤ −1 dBTP) | Instagram Reels, YouTube Shorts, Threads, X |
| `vertical-tiktok.mp4` | the same cut with the designed cover as its first half second (TikTok takes a moment of the video as its cover, not an image) | TikTok |
| `feed.mp4` | 1080×1350 (4:5), 89 s at most — normally the whole walkthrough | LinkedIn, Facebook, the Instagram feed |
| `cover-vertical.jpg`, `cover-feed.jpg` | the thumbnail's design restacked for a tall frame; headline, screenshot and gator inside the centre 4:5 | Instagram's cover image; a feed post's first image |
| `social.json` | what was measured of every file + the post text per platform | `social-upload.ts`, `social-post.ts` |
| `focus.json` | where the camera looked at each step, and how that was found | reading, when a cut looks wrong |

```bash
npx tsx scripts/tutorials/social.ts <helpKey>                       # finds the master in the known out-dirs
npx tsx scripts/tutorials/social.ts <helpKey> --out-dir DIR         # …or in DIR/<helpKey>/ (repeatable); --out FOLDER names it exactly
npx tsx scripts/tutorials/social.ts <helpKey> --only vertical       # one cut; --text-only rebuilds social.json's posts without encoding
npx tsx scripts/tutorials/social.ts --all [--out-dir DIR]… [--force]  # BACKFILL: every finished master that has no up-to-date cuts
npx tsx scripts/tutorials/produce.ts <helpKey> --slot N --no-upload --social   # a new video gets its cuts with the master
```

About 2½ minutes a cut on this box (every ffmpeg under the encode lock, niced, 4 threads). Then **look at
them** — a dozen frames of each (`ffmpeg -ss N -i vertical.mp4 -frames:v 1 f.jpg`): UI text readable at
phone size, the control being talked about in frame, captions inside their strip, only demo names.

**What a cut is.** A branded band with the kicker and the hook headline (the script's `thumbnail.headline`);
the recording full width underneath — a crop of about 1,000 of the master's 1,920 pixels that **follows the
highlighted control**, easing from step to step; large word-by-word captions (Anton capitals, white with a
dark edge, the word being said in the brand orange, two lines at most) in their own strip *under* the
recording, so they never cover a control; a thin orange progress bar; the gator and the address at the
bottom; a 2 s end card. The first second and a half is the headline, large, over the recording while the
camera pushes in — not a still title card. No music.

**Safe areas** (`SAFE_AREA` in `social-lib.ts`, tested): on the vertical cut nothing that must be read is in
the top 14% (the platform's tabs), the bottom 22% (account name, caption, audio) or the right 16% of the
caption strip (the like / comment / share column). The 4:5 cut has no overlay, only a margin.

**Fitting 59 s** (`planCut`, tested). The pause after every line is tightened from 450 ms + the step's
`holdMs` to 220 ms — cuts are only ever made in the silence between two lines, never inside a sentence, and
a step whose action ran longer than its line (typing, a page loading) keeps the action. If that is not
enough, picture and speech are sped up together by **8% at most**. If it still does not fit, the cut keeps
the steps from the start up to the last that fits — stopping at a chapter boundary when one is in the last
30% — and its end card reads "Full walkthrough on YouTube / constructhub.us/tutorials" instead of "More
tutorials at …". The feed cut has 89 s and nearly always holds the whole walkthrough.

**How the camera knows where to look.** `record.ts` now saves, for every step, the target's box, the moment
its ring was taken away and the pointer's path (`timings.json` → `steps[].target`, `ringOffMs`, `cursor`).
Masters recorded before that have none: `social.ts` then looks at the master four times a second and
**finds the recorder's ring** — a hollow rectangle of the brand orange (the app's solid orange buttons and
the selected menu item are told apart by being solid; a rectangle that stays put across three steps, such
as a focused field's outline, is not the ring). Where no ring is found: a field being typed in is located
by its own blue focus outline; a `highlight` with no ring is taken to be the selected menu item and gets
the whole menu; anything else (a page that has just opened, `back`, `wait`) gets a wide shot of the page.
After a click has landed the camera moves on to where the next step will point, so what the click opened
is in frame. The first video (Database Directory, 1280×720, blue ring) is handled the same way and
upscaled more — its text is softer than the others'.

**The post text** (`social-text.ts` → `social.json` → `platforms`). Built from the same true material as the
YouTube description: the hook headline, the producer's title, the help entry (what it is, what it does, how
to use it), the area's facts and search phrases, the area's hashtags. Instagram gets 1,200–1,800 characters
(hook, what it is, the numbered short version, three or four "why" lines, a search-phrase line, "Full
tutorial: link in bio / constructhub.us/tutorials"); TikTok two lines and five hashtags; LinkedIn 900–1,400
characters in a plainer voice with `https://constructhub.us/tutorials`; Facebook, X (≤ 270) and Threads
(≤ 480) shorter ones. Every post is linted before it is written (`lintPost`): the platform's length limit,
its hashtag count, the description's banned words (vendor names, "best", "guarantee", "included with",
the CRM's host name), no price the help entry does not state, no address but constructhub.us, nothing that
reads as a claim about real results. CRM posts say the CRM is a separate product with its own plans and
that the screen is a demo workspace; the permit-directory post does not call real directory data a demo.
**Instagram hashtags are five, not 8–12**: Instagram has capped a post at five since December 2025, and
more are blocked or stripped (`PLATFORM_RULES.instagram.hashtags` is the one place to change it).

## Posting to social

Through **Blotato** (`https://backend.blotato.com/v2`, header `blotato-api-key`). The workspace is
**shared with the owner's other brands**, so the poster is built to be unable to post anywhere else.

```bash
cd ~/ConstructHUB-<checkout of main>
npx tsx scripts/tutorials/social-upload.ts <helpKey>…          # 1. the cuts → R2 (create-only), each checked at its public address
S="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/social-post.ts"
$S [helpKey…]                                                  # 2. DRY RUN (default): accounts, times, files, every caption in full
$S [helpKey…] --go                                             # 3. create the posts
$S --reconcile                                                 # 4. a few minutes later, and daily: what became of each post
git add docs/tutorials/social-schedule.json && git commit      #    the ledger is the record — commit it
```

- **Media.** Blotato needs nothing uploaded to it — "pass any publicly accessible URL in `mediaUrls`". The
  cuts go to our own R2 as `tutorials/<helpKey>.social-<vertical|tiktok|feed|cover-vertical|cover-feed>.<hash8>.<ext>`
  and are served by the media route already in production (`https://constructhub.us/api/tutorials/media/…`,
  public, immutable, byte ranges) — no deploy needed. `social-upload.ts` never overwrites or deletes, asks
  every public address for its first bytes (206, right length, right type) and writes `social/hosted.json`;
  the poster refuses a file that changed since.
- **Who may be posted to.** `TUTORIAL_BLOTATO_ACCOUNT_IDS` in the production `.env`, comma-separated — the
  only accounts the tool will touch. Empty → it refuses to run. On top of that, every run: (1) the ids of the
  other brands' accounts (and of our own YouTube channel, which is posted through YouTube's API) are on a
  **built-in denylist** (`DENYLIST` in `social-post-lib.ts`) that no flag lifts — a typo in the env cannot
  reach another brand's audience; (2) Blotato's own account list must contain each id; (3) its username or
  full name must look like ConstructHUB (contain "construct" or "chub") unless you pass `--i-checked <id>`;
  (4) one bad id stops the whole run. The tool only **creates** posts and reads; it never edits, reschedules
  or deletes anything in the workspace (tested).
- **Adding an account** (after the owner connects it at my.blotato.com → Accounts): run the dry run — it
  prints nothing about other accounts, so list them once with
  `curl -s -H "blotato-api-key: $TUTORIAL_BLOTATO_KEY" https://backend.blotato.com/v2/users/me/accounts`
  (never paste the key anywhere), take the new account's `id`, append it to `TUTORIAL_BLOTATO_ACCOUNT_IDS`
  in `/home/voiceban/ConstructHUB-live/.env`, and run the dry run again: it must list the account by name.
  A **Facebook** account also needs its Page: `TUTORIAL_BLOTATO_PAGE_IDS=<accountId>:<pageId>` (page ids:
  `GET /v2/users/me/accounts/<accountId>/subaccounts`); a **LinkedIn** account posts to the personal
  profile unless a company page is given the same way. Today: 76607 Instagram `constructhubapp`, 38445
  LinkedIn "Construct HUB" (a profile — no company page is connected to it), 63054 TikTok `construct.hub`.
- **When.** By default a post follows its video on YouTube (`youtube-schedule.json`): the same Eastern day,
  30–90 minutes after YouTube publishes it; LinkedIn only on weekdays 08:30–17:00 Eastern, otherwise
  09:00–10:59 the next weekday. The minute is a hash of the video and the account — the same every time.
  Blotato does the timing (`scheduledTime`, an instant beside `post`); nothing of ours runs at post time.
  `--spread M` ignores YouTube's times: per account the first post goes out now and each next one M minutes
  (plus up to a third of M) later, accounts starting a few minutes apart.
- **A gentle start.** New accounts are flagged easily: an account gets **one post a day for its first 14
  days** (`--warmup-start YYYY-MM-DD` or `TUTORIAL_SOCIAL_START`; default: the day of the first post in the
  ledger; `--warmup-days N`), then three a day like YouTube. What does not fit a day moves to the next.
  `--per-day N` sets the share outright. `--platform instagram,tiktok` / `--account 76607` start one network
  at a time.
- **TikTok** is sent with every field it requires, set to what is true: public, comments / duets / stitches
  on, not a paid partnership, `isYourBrand: true` (it promotes our own product) and `isAiGenerated: true`
  (the narration is a synthetic voice). Its cover is the video's frame at 200 ms — the designed cover, which
  is the first half second of `vertical-tiktok.mp4`. Instagram gets `cover-vertical.jpg` as `coverImageUrl`,
  as a Reel shared to the feed. LinkedIn takes no cover: its first frame is the hook.
- **Never twice.** The ledger, `docs/tutorials/social-schedule.json`, holds one entry per video and account.
  It is written **before** each request (`sending`) and again after the answer, so an interrupted run cannot
  repeat a post: an entry whose answer never came stays `sending`, is never sent again by the tool, and
  `--reconcile` shouts about it — look in Blotato. Only a failure Blotato itself reported can be retried
  (`--retry-failed`).
- **Rate.** Blotato allows 30 post creations a minute; the tool makes one every six seconds, waits out a
  429 for as long as it says, and reads statuses a second apart.
- Blotato's limits and fields were read from its documentation on 2026-10-08 (`help.blotato.com/api/start`,
  the API reference and "Media Requirements"); they are quoted in the headers of `social-post-lib.ts` and
  `social-text.ts`. Not verified by a real post yet: that Instagram honours `coverImageUrl` and that LinkedIn
  accepts a 4:5 video through Blotato (its page lists 16:9, 9:16 and 1:1; LinkedIn itself takes 4:5).

## Pitfalls already hit (and what the tools now do about them)

- **The CRM only renders on its own host name.** Browse `http://portal.constructhub.us:<port>`; the
  recorder maps the name to 127.0.0.1 for its own browser. Anything the tools fetch from Node goes
  to 127.0.0.1 by address — a Node-side request to that host name would go to the real site.
- **"1080p" that is not.** A page emulated at a device scale is still filmed at CSS size. The
  recorder launches Chromium with a real `--force-device-scale-factor` and refuses frames of any
  other size.
- **Cold pages.** A dev server compiles a page the first time it is opened: seconds of blank screen
  after a click. `produce.ts` warms every page module first; a click that loads a whole new page
  (Preview, Back) is covered by a white veil until the app has drawn.
- **A button that opens a new tab** opens in the same tab in the recording; follow it with `back`.
- **Rows that reload** take the ring's element with them; the recorder puts the ring back.
- **A dialog's bottom button** can sit in the caption strip and cannot scroll up; the recorder warns
  ("is in the caption area"). Keep that step's line short.
- **The brand name is written "ConstructHUB"** in narration — the pronunciation lexicon makes the voice
  say "con-STRUCT hub"; any other spelling, or phoneme markup in a script, stops the narration.
- **A frame of the bare "ConstructHUB … Privacy Policy · Terms of Use" page, or a blank page**, fails
  `check.ts` (it reads every frame). The recorder holds the picture through page loads; if a video
  still has one, `deflash.ts` repairs it (`VIDEO-PIPELINE.md`).
- **Chapters closer than 10 s** are dropped by YouTube; `mux.ts` warns and `check.ts` fails under three.
- **The picture stopping early** while the voice plays on is caught by `check.ts` (stream lengths).
- **Recording databases are schemas today.** The dev role cannot create databases on this box, so a
  "database" `constructhub_tut_slotN` is a schema of that name inside `constructhub_dev`, reached
  with `search_path` (see `db.ts`). The app works in it; code that hard-codes `public.` (account
  erase/delete, the public API's key tables) would read the dev tables — none of that is in a CRM
  flow, but do not record those pages until the role has CREATEDB.
- **Stripe, HOVER, Google Calendar and texting read as connected in a slot** — through the tutorial
  fixtures, with no outside key (`FIXTURES.md`). `--no-fixtures` gives the old "not configured" pages.
- **Do not run anything heavy while a recording is being filmed** (tests, a build, another slot's
  boot): the page slows down, dialogs open late and a short step can end before its ring is seen. The
  recorder now holds every step at least 0.7 s after its action, but a quiet machine is the real fix.
- **A click that landed where the target used to be** (a bar slid in, a late scroll): the recorder looks
  again after the pointer has travelled and follows the target.
- **"Project not found" on a New York or Texas job** was a seed defect (readable ids like
  `demo-project-p-1997`; `GET /api/crm/projects/:id` only accepts a uuid), fixed in the template on
  2026-10-08 02:58 UTC: those clients and jobs now have uuids ("Demo data" lists them) and all
  sixteen project pages can be filmed. A script written before that which names an old id in a
  selector stops at that step with "no element" — replace the selector, the rest is unchanged.
  `check-demo.ts` and `server/tutorials/demo-ids.test.ts` keep it from coming back.
- **A copy of the template that never finishes** ("fresh database" for more than a few minutes, no
  `pg_dump` in `ps`): psql had stopped on an error and the copy waited for ever, holding the template
  lock. Fixed in `db.ts` on `video-fixtures` (the copy now fails with psql's message); on older code,
  kill that `produce.ts` and start it again.
- **Two producers copying the template at once** take about twice as long for that step; nothing breaks.
