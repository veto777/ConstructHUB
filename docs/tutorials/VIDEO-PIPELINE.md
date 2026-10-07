# Walkthrough videos — production pipeline

Status: **the pipeline is built and the first walkthrough exists** — Database Directory
(`database-directory`, recorded 2026-10-07). Every other entry has no video: the product shows
"Video walkthrough coming soon" inside its "i" panel and a "Video coming soon" badge on
`/tutorials`, and no play button. Keep it that way for an entry until its real recording is
uploaded: a video exists for the app only when it is listed in the manifest
`shared/help/videos.json` (written by `mux.ts --publish`, never by hand), and
`server/help-registry.test.ts` refuses anything else — never a placeholder, a sample clip or
someone else's video.

## Make a video (the whole run)

```bash
S=docs/tutorials/scripts/<helpKey>.json          # the step script; its name is its help key
# dev server on :8168 against the DEV database (CLAUDE.md), then:
set -a; . <(grep -E '^(VOICE_ENGINE_URL|VOICE_INTERNAL_SECRET)=' <env file>); set +a
npx tsx scripts/tutorials/narrate.ts $S          # 1. Janice clips, one per step  → narration/*.wav, narration.json
npx tsx scripts/tutorials/record.ts  $S          # 2. Playwright capture, each step held for its clip → raw.webm, timings.json
npx tsx scripts/tutorials/mux.ts     $S --publish # 3. walkthrough.mp4 + captions.vtt + poster.jpg; manifest + local store
npx tsx scripts/tutorials/check.ts   $S          # 4. measurements, and frames/ to LOOK at
set -a; . <(grep -E '^R2_' <production env file>); set +a
npx tsx scripts/tutorials/upload.ts <helpKey>    # 5. create-only put of the manifest's three keys
```

Everything lands in `analysis/video-out/<helpKey>/` (git-ignored). Narrate first: the recorder
holds each step for the measured length of its line. Change a line → `narrate.ts` again (only the
changed line is requested; clips are cached by text hash) → record → mux. The step script, the
manifest and nothing else are committed; then build and deploy as in `HANDOFF.md`, **after** the
upload (the manifest makes the player appear, so the files must already be in R2).

Owner request (2026-10-07): *"use the same janice voice and use higgsfield and create walk through
tutorial videos to explain to users how to use it. Use highlights or mouse movements and get people
dialed in. Have this next to the info and do a dedicated tutorial section that has all features and
all videos."*

## What exists (built, tested)

| Piece | Where |
| --- | --- |
| The help registry — one entry per feature and per Cloudflare / Search Console section; `video` is built from the manifest | `shared/help/registry.ts` (types: `shared/help/types.ts`) |
| The manifest of recorded videos (key, bytes, sha256 of each file; `durationSec`) and the key shape | `shared/help/videos.json`, `shared/help/videos.ts` |
| The "i" button + panel + video player with its captions track (`<HelpButton k="…" />`) | `client/src/components/help-button.tsx` |
| The Tutorials page | `client/src/pages/tutorials.tsx` → `/tutorials` |
| The media route: public, immutable, HTTP Range (206), `tutorials/` keys only | `server/tutorials/media.ts` → `GET /api/tutorials/media/:file` |
| Step-script type (zod) and its JSON Schema twin | `shared/help/step-script.ts`, `shared/help/step-script.schema.json` |
| Step scripts | `docs/tutorials/scripts/database-directory.json` (recorded), `cloudflare.connections.json` (example, not recorded) |
| The tools | `scripts/tutorials/narrate.ts`, `record.ts`, `mux.ts`, `check.ts`, `upload.ts` (`lib.ts` is shared; `npx tsc -p scripts/tutorials/tsconfig.json` type-checks them) |
| Tests that keep all of it honest | `server/help-registry.test.ts`, `server/tutorials/media.test.ts` |

What does **not** exist yet: a demo account with demo Cloudflare / Google connections (owner
inputs, below), any Higgsfield integration, and the other videos.

## The five stages

```
step script (JSON) ──▶ 2. narrate ──▶ narration/NN.wav + narration.json   (RUN FIRST)
        │
        ├──────────▶ 1. record ──▶ raw.webm + timings.json   (each step held for its clip)
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
  `parseTutorialScript` (`shared/help/step-script.ts`), opens a browser context with
  `recordVideo: { dir, size: script.viewport }` and `viewport: script.viewport`, and plays the
  steps in order.
- **Cursor overlay and highlight rings:** Playwright's video does not show the mouse pointer. The
  recorder injects (`context.addInitScript`) a small overlay: a cursor element that follows
  `mousemove`, a ripple on every click, and a ring that tracks its target element frame by frame
  (so it stays on it while the page scrolls or the list reloads). The pointer is moved in small
  eased steps along a slightly bowed path so it glides instead of jumping. The ring takes the
  surface accent (`--g-accent`), not a hard-coded colour, and the overlay is injected by the
  recorder only — it never ships in the app.
- **Per-step behaviour** (`action` in the script): `goto` · `highlight` (ring, no click) · `hover` ·
  `click` · `type` · `select` · `press` · `scroll` · `wait`. `selector` is a Playwright selector
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
- Record each script twice if a phone cut is wanted: 1280×800 and 390×844 (the "i" panel is a
  popover on desktop and a bottom sheet under 768 px).

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
- **The engine also answers live customer phone calls.** The tool calls it strictly one request at
  a time with a pause between requests, caches every piece by the hash of its text
  (`narration/cache/`), and retries a failed request slowly (8 s, 20 s, 45 s) instead of hammering.
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

`scripts/tutorials/mux.ts` (ffmpeg, always niced and thread-limited — the recording box may also
serve production):

1. **Audio track:** each `narration/<NN>.wav` laid at its step's narration time (built in code),
   peak-normalised to −3 dBFS → `narration.wav`.
2. **Video:** a ~2 s title card (plain `drawtext`: the entry's title and "ConstructHUB
   walkthrough" — no generated intro), then the capture cut to the first loaded page: H.264
   `yuv420p`, 30 fps, CRF 23, AAC, `-movflags +faststart` (the player uses `preload="metadata"`).
3. **Captions:** `captions.vtt` from the narration, a sentence at a time, each cue timed inside
   its clip.
4. **Poster:** `poster.jpg`, the end of a step (`--poster-step`, default 1) — a frame of the
   walkthrough itself.
5. **Length:** read with `ffprobe` and rounded to whole seconds — `durationSec`. Never typed.
6. **`--publish`:** copies the three files to the dev server's local store (`tmp/tutorials/`) under
   their content-hashed names and writes the entry in `shared/help/videos.json`.

Then `scripts/tutorials/check.ts`: codecs, moov-before-mdat, audio level (not clipped, not near
silence), captions spanning every clip — and `frames/` with the title card, the end of every step
and the last frame. **Open the frames**: the cursor visible, rings on the right elements, no
banner or popup, nothing unredacted, no half-loaded page. Re-record if anything is off.

### 5. Upload to R2 and switch the video on

R2 is the app's object store in production (env `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`); a dev box without `R2_ENDPOINT` reads `tmp/tutorials/`.

- **Keys:** `tutorials/<helpKey>.<hash8>.mp4`, `.vtt`, `.jpg`, where `<hash8>` is the first 8 hex
  digits of that file's sha256. A re-recorded video therefore has a new address and never fights
  the year-long `immutable` cache on the old one. The old objects are left in the bucket.
- **Upload:** `scripts/tutorials/upload.ts <helpKey>` — verifies each local file against the
  manifest (bytes, sha256), then puts it with `If-None-Match: *`. Create-only: an existing key is
  never overwritten and nothing is ever deleted. `--check` only HEADs the three keys.
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
| `viewport` | Recording size, e.g. `{ "width": 1280, "height": 800 }`. |
| `narrator` | Persona id; `"janice"` by default. |
| `steps[].action` | `goto` · `highlight` · `hover` · `click` · `type` · `select` · `press` · `scroll` · `wait`. |
| `steps[].selector` | Playwright selector of the target (not for `goto`, `wait`, `press`). |
| `steps[].url` | `goto` only: a root-relative path. |
| `steps[].value` | `type` / `select` / `press`. Secrets are `{{PLACEHOLDERS}}`. |
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

1. Deploy this branch (the upload for `database-directory` is done) and play the video on a real
   iPhone — Range/206 is implemented and tested, but only desktop Chromium has played it so far.
2. Listen to the narration once by ear: the tools measure level and timing, not pronunciation.
3. Owner inputs for the connected features: a demo Cloudflare account with one zone, a demo Google
   account with one Search Console property, and (only if the Higgsfield stage is wanted) a
   Higgsfield account / API key.
4. Write the remaining scripts — one per registry entry. Features that need no outside account
   (Search Permits, Property Records, Search History) can be recorded now.
