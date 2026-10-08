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
- **Stripe and HOVER are not configured in a slot** — on purpose (no outside keys). Their pages say
  so on screen; those videos are BLOCKED in the plan.
- **Two producers copying the template at once** take about twice as long for that step; nothing breaks.
