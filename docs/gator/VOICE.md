# The gator's voice

One recipe, so every clip is the same guy. The code is `scripts/gator/voice.ts` (`VOICE`); change the
recipe there, bump `version`, and say so here.

## Who he is

An adult man: gravelly, warm, dry, quick. A foreman who has seen it all and still likes the work. New York /
New Jersey in his rhythm and his wording — "he says", "my friend", "fuhgeddaboudit" — never a cartoon of an
ethnicity, never an impression of a real person, an actor or an existing cartoon character. He is never
mean, never crude, and the joke is never on the customer.

**He has no name yet.** The brand names the headset gator "Gabe" (the Hub assistant,
`client/src/components/mascot.tsx`); the standing hard-hat gator is only "the brand mascot" there. Three to
choose from — none is used anywhere until the owner picks: **Mack**, **Richie**, **Hank**.

## The recipe (locked 2026-10-08, version 1)

| | |
| --- | --- |
| Engine | our own voice engine — the Call Assistant's Kokoro-82M service (`POST /tts/preview {personaId, text}`, 24 kHz mono), the one `scripts/tutorials/narrate.ts` uses. Self-hosted: no cost per line, no new service. |
| Voice | persona `marcus` = Kokoro voice `am_adam` (American male). Not `gabe` / `am_michael`: that is Gabe's voice. |
| Pitch | played at 0.90 of its rate (about 1.8 semitones lower) |
| Pace | then `atempo=1.14` — a touch quicker than the engine reads, pitch unchanged |
| Tone | `highpass=f=70, bass=g=5:f=150:w=0.8, equalizer=f=2800:t=q:w=1.2:g=2.5, treble=g=-3:f=7000, acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=5, asoftclip=type=tanh:threshold=0.6` — chest, a little grit, an even level |
| Output | 48 kHz mono, the engine's silence trimmed; cached by the hash of the recipe and the text in `analysis/gator-shorts/_voice/` |
| In the mix | the line peaks at 0.7 of full scale, the sound bed is held to 0.16 while a clip has speech; the clip is then brought to −14 LUFS. `make.ts` refuses a clip whose line is less than 10 dB over the bed, or whose mix clips. |

The engine answers live customer calls: one request at a time across every producer (the tutorials'
`tts.lock`), a pause after each, and a line that was said before is never asked for again.

**What this voice is not.** The engine has six American voices and no regional ones, so there is **no real
New York / New Jersey accent** in it — only a lower, rougher, quicker American man. The accent lives in the
writing. Nobody on the production box can listen: the level, the length and the line-over-bed margin are
measured; whether "Fuhgeddaboudit" comes out right is not. **A person must listen to every talking clip
before it is approved** (the review sheet asks).

## Writing for him

- One or two short lines a clip, 60 characters at most each, said in under four seconds. Dry. Fragments.
  "Twenty minutes. On my belt. The whole time."
- Rhythm over spelling. "He says." "My friend." "Different story." Use at most one dialect word a clip, spelled
  the way it should sound (`Fuhgeddaboudit.`) — and listen to it.
- Numbers as words ("three fifty-nine", "seven fifteen"): the engine reads digits its own way.
- A product line stays true and light: "Found the permit office in ten seconds. Parking? Different story."
- The captions burn the line in, sentence by sentence, low on the frame — every clip works with the sound off.

## How he "talks" on screen — what was tried (2026-10-08)

Four samples of the same line on the same still ("Two days, he says. Two days."):

| | Voice | Mouth | Cost / 5 s shot | What it looked like |
| --- | --- | --- | --- | --- |
| 1 | the recipe | Wan 2.7 image-to-video driven by the line (`audio_url`) | $0.50 | The jaw follows the words — but the model turned him to face the camera, where the long snout becomes a wide laughing face that is not our gator. |
| 2 | Kling 3.0 Standard's own generated voice (`sound: on`, the line and "New Jersey accent" in the prompt) | the same model | $0.63 | It speaks, and can attempt the accent — a different man every time, so it cannot be the house voice; and it made his sunglasses see-through. Comparison only. |
| 3 | the recipe | **Kling 2.5 Turbo Standard**, told he is speaking, in three-quarter profile, deadpan | **$0.21** | **The house method.** He stays on-model; the jaw opens and closes like a cartoon character talking. Not locked to the words — a puppet's sync — which reads fine at feed speed with captions. |
| 4 | the recipe | Wan 2.7 driven by the line, held in profile | $0.50 | On-model, but the jaw drops open on the first word and stays open past the end: a laugh, not speech. |

Verified: the catalogue has no text-to-speech model and no lip-sync-to-video model; speech comes only from
video models' own audio (Kling 2.6 / 3.0 `sound`, Seedance / Wan 3.0 / LTX / PixVerse `generate_audio`) or
from audio-driven image-to-video (Wan 2.6 / 2.7 `audio_url`, Grok Imagine Video `audio_url`). Assumed, not
tested: that Wan 2.6 and Grok behave like Wan 2.7 on a snout.

**The rule:** a talking shot is `video: "kling"` (or `"kling-pro"`) with `say: { text, lead }`; the shot's
still shows him in three-quarter profile, mouth shut; the line is voice-over from the recipe. If a jaw looks
wrong, the fallback is the line delivered while he only reacts (a look, a shrug) — often funnier.

## What would make it better

- A real accent needs a voice the engine does not have: a Kokoro-compatible voice pack trained or blended
  for it, or an owner-approved voice from a service we do not use today. Both are decisions for the owner.
- A person's ear on the first ten lines, to tune pitch and pace once and lock version 2.
