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
| FL | Dana Whitfield | Osprey | P-2002 Lead |
| FL | Luis Orozco | Bradenton | P-2003 Estimating · E-2002 viewed · the one unanswered message |
| FL | The Mercer Group (company) | Sarasota | P-2004 Proposal Sent · pending ACH deposit |
| FL | Greta Ellison | Venice | P-2005 Scheduled · deposit by check · messages |
| FL | Tom & Priya Bauer | Sarasota | P-2006 Waiting on Trades · failed card payment |
| FL | Lan Nguyen | Bradenton | P-2007 Punch List · cash payment |
| FL | Vince Castellano | Venice | P-2008 Paid · INV-2001 paid |
| NY | Rosa & Stefan Ferrante | Brooklyn | P-1993 Lead · visit in 3 days · message thread (answered) |
| NY | Tunde Oyelaran | Albany | P-1994 Approved · E-1997 approved (8% tax) · deposit by check · visit tomorrow |
| NY | Hannah Lindqvist | Buffalo | P-1995 Invoiced · INV-1999 sent (8.75% tax) |
| NY | Wrenhaven Dental Studio (company) | White Plains | P-1996 Estimating |
| TX | Caleb & Nora Hadley | Austin | P-1997 Scheduled · E-1998 approved (8.25% tax) · deposit by check · visit in 2 days · message thread (answered) |
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
  `demo-pay-01`…`07`, `demo-member-priya`, `demo-member-owen`, `demo-tag-1`…`4`, `demo-photo-01`…`06`.
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
name), `back`, `goto`, `wait` — and `upload`, `drag`, `session`, `fixture`, `wait-for` (next section).
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

## Publishing to YouTube

Nothing is uploaded to YouTube by the line: there are no YouTube credentials. Each production leaves
everything upload-ready in `analysis/video-out/<helpKey>/`:

| File | What it is |
| --- | --- |
| `walkthrough.mp4` | The master: 1920×1080, 30 fps, H.264 High yuv420p + AAC 48 kHz stereo, −14 LUFS (true peak ≤ −1 dBTP), fast-start; a ≤ 2 s branded intro card and a 4 s end card ("More tutorials — constructhub.us/tutorials") |
| `captions.srt` | English captions with timing (`captions.vtt` is the in-app twin) |
| `thumbnail.jpg` | 1280×720, under 2 MB (`thumbnail-320.png`: the same at list size) |
| `youtube.json` | Channel (Construct HUB, `@ConstructHUB-t3v`, `UCRsxhhzhirrQCnqETChhyFw`), title, description with chapter timestamps from the step timings, "Try it" and in-app help links, tags, playlist, category, `madeForKids: false`, language `en`, `privacyStatus: "private"`, and the measured size / length / loudness of the file |

By hand today: upload `walkthrough.mp4` in YouTube Studio, paste title / description / tags from
`youtube.json`, add `captions.srt` ("with timing"), set `thumbnail.jpg`, file it in the playlist.

`scripts/tutorials/youtube-upload.ts <helpKey>` is the next piece: a dry run by default (it prints
what it would send), `--upload` refuses without `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`
(OAuth, `youtube.upload` scope, granted by the channel's owner). It always uploads **private** — the
owner publishes. It is written from the API reference and has **never been run against Google**; the
first real upload is one video, by hand, with the owner watching.

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
