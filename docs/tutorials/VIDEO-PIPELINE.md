# Walkthrough videos — production pipeline

Status: **plan only. No video, audio, poster or caption file exists yet**, and nothing in this
document has been run. Every `video` in the help registry is `null`, so the product shows
"Video walkthrough coming soon" inside each "i" panel and a "Video coming soon" badge on
`/tutorials`, and no play button anywhere. Keep it that way until a real recording is uploaded:
never point `video` at a placeholder, a sample clip or someone else's video
(`server/help-registry.test.ts` → "claims no video that does not exist").

Owner request (2026-10-07): *"use the same janice voice and use higgsfield and create walk through
tutorial videos to explain to users how to use it. Use highlights or mouse movements and get people
dialed in. Have this next to the info and do a dedicated tutorial section that has all features and
all videos."*

## What already exists (built, tested)

| Piece | Where |
| --- | --- |
| The help registry — one entry per feature and per Cloudflare / Search Console section, each with a `video` slot | `shared/help/registry.ts` (types: `shared/help/types.ts`) |
| The "i" button + panel + video player (`<HelpButton k="…" />`) | `client/src/components/help-button.tsx` |
| The Tutorials page | `client/src/pages/tutorials.tsx` → `/tutorials` |
| Step-script type (zod) and its JSON Schema twin | `shared/help/step-script.ts`, `shared/help/step-script.schema.json` |
| One complete example script (Cloudflare → Connections) | `docs/tutorials/scripts/cloudflare.connections.json` |
| Tests that keep all of it honest | `server/help-registry.test.ts` |

What does **not** exist yet: the recorder, the narration renderer, the mux script, any upload
tooling, and a demo account with demo connections. Those are the work below.

## The five stages

```
step script (JSON) ──▶ 1. record ──▶ raw.webm + timings.json
        │
        ├──────────▶ 2. narrate ──▶ narration.wav (one clip per step, Janice's voice)
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

- **Recorder to write:** `scripts/tutorials/record.ts`. It loads a script with
  `parseTutorialScript` (`shared/help/step-script.ts`), opens a browser context with
  `recordVideo: { dir, size: script.viewport }` and `viewport: script.viewport`, and plays the
  steps in order.
- **Cursor overlay and highlight rings:** Playwright's video does not show the mouse pointer. The
  recorder injects (`context.addInitScript`) a small overlay: an absolutely-positioned cursor
  element that follows `mousemove`, and a ring element the recorder positions over the target's
  `boundingBox()` before each action. Move with `page.mouse.move(x, y, { steps: 25 })` so the
  pointer glides instead of jumping; show the ring ~400 ms before a click and fade it after. The
  overlay must use the surface accent (`--g-accent`), not a hard-coded colour, and must be
  injected by the recorder only — it never ships in the app.
- **Per-step behaviour** (`action` in the script): `goto` · `highlight` (ring, no click) · `hover` ·
  `click` · `type` · `select` · `press` · `scroll` · `wait`. `selector` is a Playwright selector
  (`[data-testid="…"]`, `role=button[name="…"]`, `label:has-text("…") input`, `text=…`).
  `caption` is drawn as a lower-third by the overlay and becomes the `.vtt` cue; `narration` is
  what the voice says; `holdMs` adds dwell time; `redact: true` blurs the target (CSS
  `filter: blur()`) for keys, emails and client names.
- **Timing:** the recorder writes `timings.json` — for every step, the video time at which it
  started. Record *after* the narration clips exist (stage 2) so each step can wait
  `max(clip length, action time) + holdMs`; then picture and voice line up without editing.
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

- **Renderer to write:** `scripts/tutorials/narrate.ts` (calls the engine) or
  `voice/render_tutorial.py` (imports `speech.TTS` directly, like `render_samples.py`). For each
  step it sends `{ personaId: script.narrator, text: step.narration }` and saves
  `narration/<index>.wav`, then writes each clip's length to `narration.json` for the recorder.
- `/tts/preview` takes at most 400 characters. The step schema allows 600 for `narration`; split a
  longer line on sentence ends and join the clips, or keep lines under 400.
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

`ffmpeg` is the tool (already required on the voice box by `render_samples.py`). Script to write:
`scripts/tutorials/mux.ts`.

1. **Audio track:** place each `narration/<index>.wav` at its step's start time from
   `timings.json` (ffmpeg `adelay` + `amix`, or build one WAV in code) → `narration.wav`.
2. **Video:** transcode Playwright's `.webm` to H.264 + AAC MP4 with the narration, e.g.
   `ffmpeg -i raw.webm -i narration.wav -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -c:a aac -b:a 128k -movflags +faststart walkthrough.mp4`.
   `+faststart` matters: the player uses `preload="metadata"`.
3. **Intro/outro** (only if stage 3 produced them): concat with the same codec settings.
4. **Captions:** write `captions.vtt` from the script — one cue per step, start = the step's time
   in `timings.json`, end = the next step's start, text = `caption`. (A second, fuller track can
   use `narration` as the cue text; the player takes one `captions` URL today.)
5. **Poster:** one frame as `poster.jpg`, e.g. `ffmpeg -ss 2 -i walkthrough.mp4 -frames:v 1 -q:v 3 poster.jpg`.
6. **Length:** read it with `ffprobe -v error -show_entries format=duration -of csv=p=0 walkthrough.mp4`
   and round to whole seconds — that is `durationSec`. Never type a duration by hand.

Watch the finished file end to end before uploading: the cursor visible, rings on the right
elements, nothing unredacted, narration matching what is on screen.

### 5. Upload to R2 and switch the video on

R2 is already the app's object store (`server/r2.ts`; env `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`).

- **Keys:** `tutorials/<helpKey>/walkthrough.mp4`, `tutorials/<helpKey>/captions.vtt`,
  `tutorials/<helpKey>/poster.jpg`. Upload with `putToR2Key(key, body, contentType)` (fixed keys;
  a re-upload overwrites) with content types `video/mp4`, `text/vtt`, `image/jpeg`.
- **Serving:** `GET /api/files/:folder/:subfolder/:filename` (`server/routes.ts`) already serves
  any three-part key publicly with a long cache, so the files are reachable at
  `/api/files/tutorials/<helpKey>/walkthrough.mp4`. Two things to fix **before** the first video
  goes live:
  1. That route does not pass the `Range` header on (`getFromR2` accepts `{ range }`, the route
     does not use it). Safari and iOS need byte ranges to play and seek MP4 — add Range/206
     support to the route (or serve `tutorials/` from a public R2 domain) and test on an iPhone.
  2. It sends `Cache-Control: … immutable` for a year. A re-recorded video must therefore get a
     new key (e.g. `walkthrough-v2.mp4`), not overwrite the old one.
- **Registry:** set the entry's `video` in `shared/help/registry.ts` (today
  `HELP_ENTRIES` maps every entry to `video: null`; add a per-key map of real videos beside it):

  ```ts
  video: {
    url: "/api/files/tutorials/cloudflare.connections/walkthrough.mp4",
    durationSec: 94,            // from ffprobe, not typed from memory
    poster: "/api/files/tutorials/cloudflare.connections/poster.jpg",
    captions: "/api/files/tutorials/cloudflare.connections/captions.vtt",
  }
  ```

  (The numbers above show the shape only; no such file exists.) The test suite then requires the
  URL to sit under `tutorials/`, end in `.mp4`/`.webm`, and carry a whole-second duration. With
  `video` set, the play button appears beside the "i", the panel offers "Watch the walkthrough",
  and the Tutorials card shows the player.
- Build, `rsync` and restart as in `HANDOFF.md`. Check `/tutorials` and the feature's "i" panel on
  a desktop and a phone.

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
| `steps[].caption` | On-screen caption and `.vtt` cue, ≤ 160 characters. |
| `steps[].narration` | What the voice says over the step. |
| `steps[].holdMs` | Extra dwell time after the action. |
| `steps[].redact` | Blur the target in the recording. |

Writing rules: one idea per step; the narration says only what the registry entry says (it is the
verified text — do not add claims the "i" panel does not make); plain words; no step that changes
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

## Order of work for the next session

1. Owner inputs: a demo Cloudflare account with one zone, a demo Google account with one Search
   Console property, and (only if the Higgsfield stage is wanted) a Higgsfield account/API key.
2. Write `narrate` → `record` → `mux` (stages 2, 1, 4) and run them on
   `cloudflare.connections.json`. Review the file.
3. Add Range support to `/api/files` (stage 5), upload, set `video` for that one key, deploy,
   check on a phone.
4. Write the remaining scripts — one per registry entry, Cloudflare and Search Console first.
