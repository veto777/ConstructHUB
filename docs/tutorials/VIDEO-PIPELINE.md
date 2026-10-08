# Walkthrough videos — production pipeline

Status (2026-10-07): **the pipeline is a production line.** Four walkthroughs exist — Database
Directory, and the first three CRM videos (Clients, Create and send an estimate, Schedule). To make
the next one, follow `docs/tutorials/PRODUCER-GUIDE.md`; the CRM list is `docs/tutorials/CRM-VIDEO-PLAN.md`.
This file explains how the pieces work.

Every entry without a video shows "Video walkthrough coming soon" in its "i" panel and a "Video
coming soon" badge on `/tutorials`, and no play button. A video exists for the app only when it has
a manifest file, `shared/help/videos/<helpKey>.json`, written by `upload.ts` after the objects were
really put in R2 — and `server/help-registry.test.ts` refuses anything else: never a placeholder, a
sample clip or someone else's video.

## Make a video (the whole run)

```bash
npx tsx scripts/tutorials/produce.ts <helpKey> --slot N --no-upload   # ~4 min; look at the contact sheets
npx tsx scripts/tutorials/upload.ts <helpKey>                          # the inspected files → R2, then the manifest
```

`produce.ts` runs: fresh recording database `constructhub_tut_slot<N>` → the app for that slot on
port 8180+N → warm-up → `narrate.ts` → `record.ts` → `mux.ts` → `thumbnail.ts` → `check.ts` →
(`upload.ts`, unless `--no-upload`) → app stopped by its listening pid → database dropped → raw
capture deleted. Everything lands in `analysis/video-out/<helpKey>/` (git-ignored). The step script,
the manifest and the generated index are committed; build and deploy as in `HANDOFF.md` **after** the
upload (the manifest makes the player appear, so the files must already be in R2).

Owner requests: 2026-10-07 *"use the same janice voice and use higgsfield and create walk through
tutorial videos to explain to users how to use it. Use highlights or mouse movements and get people
dialed in. Have this next to the info and do a dedicated tutorial section that has all features and
all videos."* — and, after the first one: *"This video is fantastic. I want them made for every
single feature we have! Start with the CRM make hundreds of videos if you have to!"* — then: every
video also goes to YouTube (channel "Construct HUB"), with catchy thumbnails in the brand blue and
orange with the mascot.

## The production line

| Piece | Where |
| --- | --- |
| One command per video | `scripts/tutorials/produce.ts <helpKey> [--slot 1-4] [--no-upload] [--keep-raw]` |
| Recording databases: `template`, `fresh <name>`, `drop <name>`, `list`, `mode` — names must match `/^constructhub_tut_[a-z0-9_]+$/`, server must be 127.0.0.1:5432 (5433 is production) | `scripts/tutorials/db.ts` |
| The demo workspace: "Aspire Interiors" (Sarasota FL), owner "Demo Account" | `scripts/seed-crm-demo.ts` + `scripts/tutorials/seed-demo.ts` (a CRM plan, six team members, a week of appointments around today, three message threads, six JobCam colour cards, payments in several states; moves every date forward to today on each fresh copy) |
| The app for a slot: dev server on 8180+N, signed in as user 1, environment built from nothing (no SMTP, SignalWire, Stripe, Google, HOVER, R2 or voice keys; `EMAIL_FORCE_SINK=1`; `SEO_JOBS_DISABLED=true`; no edge or GBP worker); `up N` / `down N` for operating by hand | `scripts/tutorials/app.ts` |
| Machine-wide locks under `/tmp/claude-1000/constructhub-tutorials/`: `tts.lock` (one voice request at a time, 250 ms pause, shared clip cache `tts-cache/`), `encode.lock` (one ffmpeg at a time, `nice -n 10`, `-threads 4`), `slot<N>.lock` | `scripts/tutorials/lib.ts` (`withLock`, `run`) |
| Intro card, end card and the YouTube thumbnail (our artwork, bundled Anton font) | `scripts/tutorials/brand.ts`, `thumbnail.ts`, `assets/` |
| One manifest file per video + one file per new help entry, collected through generated indexes (`merge=union`) | `shared/help/videos/`, `shared/help/entries/<group>/`, `scripts/tutorials/gen-index.ts` |
| YouTube metadata per video; the scheduler that posts three a day through YouTube's own scheduled publishing, with its ledger, order and calendar | `youtube.json` from `mux.ts`; `scripts/tutorials/youtube-schedule.ts`, `server/youtube/schedule.ts`, `docs/tutorials/youtube-{schedule,order}.json`, `youtube-calendar.md` — see "Publishing to YouTube" in `PRODUCER-GUIDE.md` |

**Recording databases are schemas today.** The intended design is `CREATE DATABASE <name> TEMPLATE
constructhub_tut_template`. The dev role (`constructhub_dev`) has no CREATEDB on vb11 and
`sudo -u postgres` asks for a password, so `db.ts` runs in **schema mode**: the same names are
schemas inside the dev database `constructhub_dev`, a connection reaches one with
`search_path=<name>` (never `public`), and `fresh` is `pg_dump` of the template schema, renamed in
the stream, into `psql` (15–35 s). `db.ts mode` says which is in use. The database mode is written
and switches on by itself when the role can create databases (`ALTER ROLE constructhub_dev CREATEDB`
as a superuser, then `db.ts template`), but it has **never run here**. The template takes ~3 minutes
to build (schema from `shared/schema.ts` via `drizzle-kit export`, `apply-schema-migration.ts`, the
demo owner as user 1, three boots of the app for its own ensure/seed path, the two demo seeds).

**House framing.** `"viewport": { "width": 1024, "height": 576 }, "zoom": 1.875`: the page is laid
out for a 1024-wide window and filmed at 1920×1080 real pixels — 25% larger than on a 1280 screen,
the content fills the frame, the CRM sidebar stays open and "Demo Account" is not truncated. The
first video (Database Directory, 1280×720 at zoom 1) had its content in the left half with small
text; nothing new is recorded that way. The 1080p master is also the in-app file (5–8 MB for 70–80 s
— under the ~12 MB a 90 s video may weigh), so there is no second rendition.

## What exists (built, tested)

| Piece | Where |
| --- | --- |
| The help registry — one entry per feature and per Cloudflare / Search Console section, plus the entries collected from `shared/help/entries/`; `video` is built from the manifest | `shared/help/registry.ts` (types: `shared/help/types.ts`) |
| The manifest: one file per video (key, bytes, sha256 of each file; `durationSec`; `uploaded`: when, and each object's R2 ETag) | `shared/help/videos/<helpKey>.json`, `shared/help/videos.ts` |
| The "i" button + panel + video player with its captions track (`<HelpButton k="…" />`; `videoOnly` renders just a "Watch" button — used on CRM pages, which have their own "i") | `client/src/components/help-button.tsx` |
| The Tutorials page | `client/src/pages/tutorials.tsx` → `/tutorials` |
| The media route: public, immutable, HTTP Range (206), `tutorials/` keys only | `server/tutorials/media.ts` → `GET /api/tutorials/media/:file` |
| Step-script type (zod) and its JSON Schema twin | `shared/help/step-script.ts`, `shared/help/step-script.schema.json` |
| Step scripts | `docs/tutorials/scripts/` — `database-directory`, `crm-clients`, `crm-create-estimate`, `crm-schedule` (recorded), `cloudflare.connections` (example, not recorded) |
| The tools | `scripts/tutorials/` (`npx tsc -p scripts/tutorials/tsconfig.json` type-checks them) |
| Tests that keep all of it honest | `server/help-registry.test.ts`, `server/tutorials/media.test.ts`, `server/tutorials/production-line.test.ts` |

What does **not** exist yet: demo Cloudflare / Google connections, a Stripe test account and a HOVER
sandbox for the demo workspace (owner inputs), any Higgsfield integration, YouTube credentials, a
drag action and a file-upload action in the recorder, and the other videos.

## The five stages

```
step script (JSON) ──▶ 2. narrate ──▶ narration/NN.wav + narration.json   (RUN FIRST)
        │
        ├──────────▶ 1. record ──▶ raw.mkv + timings.json    (each step held for its clip)
        │
        ├──────────▶ 3. (optional) Higgsfield intro / outro / avatar segment
        │
        └──────────▶ 4. mux + captions + poster ──▶ walkthrough.mp4, captions.vtt, poster.jpg
                                                         │
                                                         ▼
                                            5. upload to R2 `tutorials/…` and set `video`
```

One step script produces one video. Its filename is its help key (`<helpKey>.json`), and the test
suite refuses a script whose `helpKey` is not in the registry.

### 1. Scripted screen capture (Playwright)

Playwright is already a dev dependency (`@playwright/test`, `playwright` in `package.json`; the
e2e suite lives in `e2e/`).

- **Recorder:** `scripts/tutorials/record.ts`. It loads a script with
  `parseTutorialScript` (`shared/help/step-script.ts`), launches Chromium with a window of the
  script's `viewport` and `--force-device-scale-factor=<zoom>`, films it from Chromium's own
  screencast — every frame, at device pixels, copied as JPEG into `raw.mkv` (Playwright's
  `recordVideo` and an emulated device scale both film at CSS size, which would make the 1080p an
  upscale) — and plays the steps in order.
- **Cursor overlay and highlight rings:** a headless capture does not show the mouse pointer. The
  recorder injects (`context.addInitScript`) a small overlay: a cursor element that follows
  `mousemove`, a ripple on every click, and a ring that tracks its target element frame by frame
  (so it stays on it while the page scrolls or the list reloads). The pointer is moved in small
  eased steps along a slightly bowed path so it glides instead of jumping. The ring is the brand
  orange on every surface (the first video used the surface accent), and the overlay is injected by
  the recorder only — it never ships in the app. A target in the bottom 17% of the page — where
  captions are drawn — is scrolled up first; one that cannot scroll is reported.
- **Per-step behaviour** (`action` in the script): `goto` · `highlight` (ring, no click) · `hover` ·
  `click` · `type` · `select` · `press` · `scroll` · `wait` · `back`. `selector` is a Playwright selector
  (`[data-testid="…"]`, `role=button[name="…"]`, `label:has-text("…") input`, `text=…`).
  `narration` is what the voice says, and it is also the captions track (`captions.vtt`);
  `caption` is the step's short label (the recorder's log and `timings.json`; it is not drawn on
  the video, because the player already shows the captions track there); `holdMs` adds dwell
  time; `redact: true` blurs the target (CSS `filter: blur()`) for keys, emails and client names.
- **Timing:** the recorder writes `timings.json` — for every step, when it started and ended and
  when its narration starts. It records *after* the narration clips exist (stage 2) and holds each
  step for `max(clip length + pad, action time) + holdMs`, so picture and voice line up without
  editing. The video's clock starts a variable few hundred ms after the recorder's, so the recorder
  shows a black "sync" frame before the first step and after the last; `mux.ts` finds both, uses
  them to place the audio, and refuses a capture whose two ends disagree by more than 120 ms.
- **What is kept out of a public video** (in the recording context only — the database is never
  written): cookie `ch_consent=denied` (no cookie banner), the assistant bubble and its "Welcome
  aboard" popup hidden, and the signed-in account presented as "Demo Account" with a customer's
  menu and no unread notifications (the `/api/auth/me` and `/api/notifications` responses are
  relabelled / emptied on their way to the page). Everything else on screen is the product running
  against the dev database.
- **Link addresses:** hovering a link that leaves the site shows its real address bottom-left, the
  way a desktop browser's status bar does. `select` works on native `<select>`s and on the app's
  custom listboxes (it opens the list, wheels to the option and clicks it). `type` replaces what
  the field holds.
- **Demo account:** run against the DEV database only (`constructhub_dev` on `127.0.0.1:5432`;
  never the production port) on a dev server started as in `CLAUDE.md`, signed in as a demo user
  whose plan includes the feature (Cloudflare and Search Console need the plan that includes the
  "Cloudflare + Search Console" module — read it from `planForModule`, do not hard-code it).
  Sensitive buttons ask for an identity check (`requireRecentAuth`); the recorder either completes
  it on camera as a step or verifies once before recording starts.
- **Real screens only.** A walkthrough shows what the product really does. For Cloudflare and
  Search Console that means a real demo Cloudflare zone and a real Google account owned by the
  owner — **owner inputs, not in the repo**. Typed secrets are never written in a script: use
  `{{PLACEHOLDER}}` values (the example uses `{{DEMO_CLOUDFLARE_EMAIL}}`,
  `{{DEMO_CLOUDFLARE_GLOBAL_KEY}}`, `{{DEMO_ZONE_NAME}}`) that the recorder fills from its
  environment at record time, and mark those steps `redact: true` (the test suite enforces both).
  Do not stub API responses to fake a connected account, and never record against production or
  a real client's data.
- The CRM renders only on its own host name: the recorder maps `portal.constructhub.us` (and
  `client.constructhub.us`) to 127.0.0.1 for its browser, and `produce.ts` browses
  `http://portal.constructhub.us:<port>` for a CRM entry.
- `--dry` plays a script in seconds without recording: a screenshot and a list of every
  `data-testid` per step. It is how a script is written.

### 2. Narration — the Call Assistant's "Janice" voice

What the code says about that voice (read, not assumed):

| Fact | Value | Source |
| --- | --- | --- |
| TTS model | **Kokoro-82M**, Hugging Face repo `hexgrad/Kokoro-82M`, run locally by the voice engine (not a hosted TTS API) | `voice/speech.py` (`KOKORO_REPO`, `KPipeline(lang_code="a", …)`) |
| Janice's voice id | **`af_heart`** | `shared/voice-personas.ts` → `VOICE_PERSONAS.janice.voice`; mirrored in `voice/personas.json` (`personas[].id == "janice"`, `voice`) |
| Persona key | `janice` (also `DEFAULT_VOICE_PERSONA`) | `shared/voice-personas.ts` |
| Output | 24 kHz mono float PCM; the engine's preview route returns `audio/wav` | `voice/speech.py` (`SR = 24000`), `voice/server.py` |
| Engine route | `POST /tts/preview` with `{ personaId \| voice, text }`, text ≤ 400 characters, bearer-protected | `voice/server.py`, `docs/call-assistant/LANE-NOTES-engine.md` |
| Where the app finds the engine | env `VOICE_ENGINE_URL`; bearer from env `VOICE_INTERNAL_SECRET` (`Authorization: Bearer …`) | `docs/call-assistant/SPEC.md`, `server/voice/internal-auth.ts` |
| Device | env `VOICE_TTS_DEVICE` (default `cuda`; `cpu` works) | `voice/config.py` |
| Existing offline renderer to model on | `voice/render_samples.py` (renders each persona's sample line to `client/public/persona-samples/<id>.mp3` with ffmpeg) | `voice/render_samples.py` |

- **Renderer:** `scripts/tutorials/narrate.ts`. For each step it sends
  `{ personaId: script.narrator, text: step.narration }` to `/tts/preview`, trims the ~0.3 s / ~0.5 s
  of silence the engine leaves around a line, saves `narration/<NN>.wav` and writes each clip's
  measured length to `narration.json` for the recorder.
- `/tts/preview` takes at most 400 characters. A longer line is split on sentence ends and the
  pieces are joined.
- **The engine also answers live customer phone calls.** Every request is made under a machine-wide
  `flock` (`tts.lock`) — one at a time across all producers, 250 ms pause — every piece is cached by
  the hash of its voice and text in a cache all producers share, and a failed request is retried
  slowly (8 s, 20 s, 45 s) instead of hammered. `VOICE_ENGINE_URL` and `VOICE_INTERNAL_SECRET` come
  from the environment or are read at run time from the live env file; they are never printed.
- `narrator` defaults to `"janice"`; the schema accepts the other five persona ids only so a
  script can be re-voiced without a code change.
- Kokoro runs on the tower GPU for the live engine and is shared with phone calls. Render
  narration when no call is active, or on CPU. No speech provider API key is needed, and none is
  in the repo.

### 3. Higgsfield pass (optional)

The owner named Higgsfield for the videos. In this pipeline it is an **optional** stage for the
parts a screen capture cannot make: a short intro and outro card, or an avatar segment.

- **Owner input required:** a Higgsfield account and its API key (or the owner running the
  generation in Higgsfield's own app and handing over the files). **No Higgsfield key, client or
  integration exists in this repo** — nothing here calls Higgsfield, and this document does not
  describe its API because that has not been verified. Read Higgsfield's current documentation
  before writing any integration.
- Keep the product demonstration itself as the real screen recording from stage 1. Generated
  footage must not show product screens, numbers, client names or results that are not real.
- If a generated segment speaks, it must use the stage-2 narration audio (the Janice voice), not
  a different generated voice, so every video sounds the same.
- Outputs land beside the recording as `intro.mp4` / `outro.mp4` and are joined in stage 4. Skip
  the stage entirely when the files are absent — the pipeline must work without it.

### 4. Mux, captions and poster (ffmpeg)

`scripts/tutorials/mux.ts` (ffmpeg, always under the encode lock, niced, 4 threads — the recording
box also serves production):

1. **Audio track:** each `narration/<NN>.wav` laid at its step's narration time (built in code),
   → `narration.wav`; in the encode it is loudness-normalised (two-pass `loudnorm`) to −14 LUFS
   integrated with a true peak of −1 dBTP or lower, 48 kHz stereo AAC.
2. **Video:** a 1.8 s branded intro card (title, kicker, logo, gator — `brand.ts`), the capture cut
   to the first loaded page, a 4 s end card ("More tutorials — constructhub.us/tutorials"): H.264
   High `yuv420p`, 30 fps, CRF 23, `-movflags +faststart` (the player uses `preload="metadata"`).
3. **Captions:** `captions.vtt` (the app) and `captions.srt` (YouTube) from the narration, a
   sentence at a time, each cue timed inside its clip.
4. **Poster:** `poster.jpg`, 1280 wide, the end of a step (`--poster-step`, default 1) — a frame of
   the walkthrough itself.
5. **Length:** read with `ffprobe` and rounded to whole seconds — `durationSec`. Never typed.
6. **`youtube.json`:** title, description with chapters from the step timings, tags, playlist —
   see "Publishing to YouTube" in `PRODUCER-GUIDE.md`. `mux.ts` publishes nothing.

Then `scripts/tutorials/check.ts`: codecs, size, frame rate, moov-before-mdat, picture and sound of
the same length, loudness and true peak, captions spanning every clip, the SRT twin, `youtube.json`
— and `frames/` plus `contact-sheet-N.jpg` with the intro card, the end of every step and the end card. **Open the frames**: the cursor visible, rings on the right elements, no
banner or popup, nothing unredacted, no half-loaded page. Re-record if anything is off.

### 5. Upload to R2 and switch the video on

R2 is the app's object store in production (env `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`); a dev box without `R2_ENDPOINT` reads `tmp/tutorials/`.

- **Keys:** `tutorials/<helpKey>.<hash8>.mp4`, `.vtt`, `.jpg`, where `<hash8>` is the first 8 hex
  digits of that file's sha256. A re-recorded video therefore has a new address and never fights
  the year-long `immutable` cache on the old one. The old objects are left in the bucket.
- **Upload:** `scripts/tutorials/upload.ts <helpKey>` — verifies each local file against what
  `mux.ts` measured (bytes, sha256), puts it with `If-None-Match: *`, HEADs it, and only then writes
  the manifest file with the ETags R2 answered. Create-only: an existing key is never overwritten
  and nothing is ever deleted. `--check` HEADs the three keys and compares sizes and ETags. The R2
  keys are read at run time from the live env file and never printed.
- **Serving:** `GET /api/tutorials/media/<helpKey>.<hash8>.<ext>` (`server/tutorials/media.ts`):
  public, `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes`, and `206`
  for a `Range` request — Safari and iOS will not play or seek an MP4 without byte ranges, which is
  why this is not `/api/files/…` (that route does not forward `Range`). It serves only names of
  that exact shape under the fixed `tutorials/` prefix, with the content type taken from the
  extension.
- **Registry:** nothing to type. `shared/help/registry.ts` builds `video` (url, measured
  `durationSec`, poster, captions) from the manifest; the play button, "Watch the walkthrough" and
  the Tutorials player appear for that key.
- Upload, then build, `rsync` and restart as in `HANDOFF.md`. Check `/tutorials` and the feature's
  "i" panel on a desktop and on an iPhone (not yet done for the first video — see below).

## Step scripts

Type: `TutorialScript` / `TutorialStep` in `shared/help/step-script.ts` (parse with
`parseTutorialScript`). JSON Schema for editors: `shared/help/step-script.schema.json`.

| Field | Meaning |
| --- | --- |
| `helpKey` | The registry entry the video belongs to. The file is named `<helpKey>.json`. |
| `title` | The video's title. |
| `viewport` | The page's size in CSS pixels — `{ "width": 1024, "height": 576 }` in the house style. |
| `zoom` | Device scale; the video is viewport × zoom — `1.875` → 1920×1080. |
| `youtube` | `title` (≤ 70), `description`, `tags` (≤ 12), `playlist`, `category`. |
| `thumbnail` | `headline` (2–5 words), `accent`, `kicker`, `step`. |
| `narrator` | Persona id; `"janice"` by default. |
| `steps[].action` | `goto` · `highlight` · `hover` · `click` · `type` · `select` · `press` · `scroll` · `wait` · `back`. |
| `steps[].chapter` | Starts a YouTube chapter with this name. |
| `steps[].selector` | Playwright selector of the target (not for `goto`, `wait`, `press`). |
| `steps[].url` | `goto` only: a root-relative path. |
| `steps[].value` | `type` / `select` / `press`. Secrets are `{{PLACEHOLDERS}}`; `{{DATE}}`, `{{DATE+1}}` are days relative to today. |
| `steps[].caption` | The step's short label, ≤ 160 characters (logs and `timings.json`). |
| `steps[].narration` | What the voice says over the step — and the captions track. |
| `steps[].holdMs` | Extra dwell time after the action. |
| `steps[].redact` | Blur the target in the recording. |

Writing rules: one idea per step; every narrated sentence is true of the product as it runs — it
says what the registry entry says (the verified text) or what is on the screen at that moment, and
names real rows chosen from the dev database, never invented ones; plain words; no step that changes
something irreversible on a real account.

### Example — Cloudflare → Connections

The full script is `docs/tutorials/scripts/cloudflare.connections.json` (13 steps; parsed by the
test suite). Every selector in it exists in `client/src/pages/site-connections.tsx` today:
`tab-connection-connections`, `help-button-cloudflare.connections`, the "Cloudflare login email"
and "Global API Key" fields, the "Verify and choose zones" and "Create limited key" buttons, the
permissions line, the "Connections" list heading and `tab-connection-work-queue`. Its first steps:

```json
{
  "helpKey": "cloudflare.connections",
  "title": "Cloudflare: connect an account",
  "viewport": { "width": 1280, "height": 800 },
  "narrator": "janice",
  "steps": [
    { "action": "goto", "url": "/cloudflare",
      "caption": "Open Cloudflare from the sidebar",
      "narration": "This is the Cloudflare page. Before it can show anything, it needs access to a Cloudflare account. Let's connect one.",
      "holdMs": 800 },
    { "action": "click", "selector": "[data-testid=\"tab-connection-connections\"]",
      "caption": "Open the Connections tab",
      "narration": "Open the Connections tab." },
    { "action": "type", "selector": "label:has-text(\"Global API Key\") input",
      "value": "{{DEMO_CLOUDFLARE_GLOBAL_KEY}}",
      "caption": "Paste the Global API Key",
      "narration": "Then paste the key.",
      "redact": true }
  ]
}
```

## What is next

1. Produce the CRM plan (`CRM-VIDEO-PLAN.md`): four batches, one producer per slot.
2. Grant the dev role CREATEDB (or pre-create the databases) so recording databases are real
   databases, as designed; then test `db.ts` in database mode.
3. Owner inputs: a Stripe test-mode account and a HOVER sandbox for the demo workspace (three BLOCKED
   videos), a demo Cloudflare account and a
   demo Google account for the platform videos, and (only if wanted) Higgsfield.
4. Recorder: a drag action (pipeline), a file-upload action (imports, logo), the client host with its
   one-time code (the homeowner's side of an estimate).
5. Deploy this branch and play a video on a real iPhone — Range/206 is implemented and tested, but
   only desktop Chromium has played them. Listen to the narration once by ear: the tools measure
   level and timing, not pronunciation.
6. Re-record Database Directory in the house framing (it is still the 1280×720 original).
