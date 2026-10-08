# Producing a walkthrough video — the recipe

One person (or agent), one video at a time, one **slot**. Four slots (1–4) can work at once. Read
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
N=2                     # your slot, 1–4 (ports 8181–8184); one producer per slot
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
below the Florida ones, so the next document made on camera is still E-2003, INV-2003 or P-2009. Their
ids start `demo-` (`demo-client-hadley`, `demo-project-p-1997`, `demo-estimate-e-1998`,
`demo-invoice-inv-2000`, `demo-appt-13`…`16`, `demo-msg-07`…`11`, `demo-pay-05`…`07`) and are fixed.
With sixteen clients a short search can match more than one of them — type enough letters, and
look at the frame.

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

**Changing the demo data.** Add rows to `scripts/tutorials/seed-demo.ts` (fixed `demo-` ids,
insert-if-absent, dates relative to now) — never rename, reorder or delete one, scripts find rows by
name. Then `npx tsx scripts/tutorials/db.ts reseed`: it applies the seed to the template in one
transaction, so producers can keep recording — a copy made at that moment holds the old data or the
new, never half. (`db.ts template --rebuild` drops the template and needs every producer stopped.)
A reseed changes counts and totals on Home, Pipeline and the lists: check your frames after one.

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

**Forbidden.** Real customer or company names; emails that are not `@example.com`; phones outside
`555-01xx`; any price or plan price; claims about features that are not built or not configured in
the slot (a page that says "not configured" is not recorded — see BLOCKED in the plan); how the video
was made (tools, voices, vendors); anything typed that looks like a secret (use `{{PLACEHOLDER}}` +
`"redact": true`).

**Pointing.** `highlight` for "look here", `hover` for links, `click`, `type` (replaces the field;
date and time fields take `2026-10-09` / `13:30`), `select` (native and custom lists, by visible
name), `back`, `goto`, `wait`. The ring is the brand orange everywhere. Use `{{DATE}}`, `{{DATE+1}}`
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

## Overview films ("Start here")

The films that say what ConstructHUB is are not tutorials: their facts and scripts live in
`docs/brand/FACT-BASE.md` and `docs/brand/VIDEO-SCRIPTS.md`, their help entries in
`shared/help/entries/start-here/` (keys start `brand-`; the group leads `/tutorials`, in the order
`START_HERE_ORDER` in `shared/help/registry.ts` gives). They are made on the same line. Two things
differ: a tour may cross both apps — a `goto` opens a `/crm…` path on the CRM host and any other path
on the main host, whatever the base. Their scripts find the demo clients and jobs by name, never by
id. The Hadley job (Austin, TX) carries three demo photos for these
films. Nothing in a brand film names a competitor or states a competitor's price without the owner's
sign-off recorded in `VIDEO-SCRIPTS.md`.

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
  records the text, its length and its sha256 in the ledger. The lint that every script in the repo
  (and in the sibling worktrees) yields a valid description is `server/youtube/description.test.ts`.
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
- **Stripe and HOVER are not configured in a slot** — on purpose (no outside keys). Their pages say
  so on screen; those videos are BLOCKED in the plan.
- **Two producers copying the template at once** take about twice as long for that step; nothing breaks.
