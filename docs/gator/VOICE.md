# The gator's voice

## Who he is

An adult man of about fifty: a gravelly baritone, dry, unhurried, deadpan. A foreman who has seen it all and
still likes the work. New York / North Jersey working-class in his sound and his wording — "he says", "lemme
tell you somethin'", "fuhgeddaboudit" — never a cartoon of an ethnicity, never an impression of a real person,
an actor or an existing character. Never mean, never crude; the joke is never on the customer.

**He has no name yet.** The brand names the headset gator "Gabe" (`client/src/components/mascot.tsx`); the
standing hard-hat gator is only "the brand mascot" there. Three to choose from — none is used until the owner
picks: **Mack**, **Richie**, **Hank**.

## The house method (owner's decision, 2026-10-08)

The owner listened to four samples of one line and said of the second: *"This is the only decent one."* That one
was **the video model's own generated voice** — so that is how he talks. Our own text-to-speech (below) is
retired for speech.

| | |
| --- | --- |
| Model | Kling 3.0 Standard image-to-video, `sound: "on"` (`kling-video/v3.0/std/image-to-video`), 2.016 credits ($0.126) per second; 3–15 s |
| The voice, in every prompt, verbatim | `VOICE_DESCRIPTION` in `scripts/gator/concepts.ts`: *"in the voice of a man of about fifty: a gravelly baritone, dry and unhurried, with a New York / North Jersey working-class accent, completely deadpan — no laughing, no shouting. No music and no other voices: only his voice and quiet room tone"* |
| The words | written in the prompt in quotes, exactly; numbers as words |
| On-model | the model has no negative prompt: the prompt says opaque dark sunglasses, eyes never visible, hard hat on, same vest, pose held, jaw moves only while speaking, no other character, no text |
| Voice reference / voice id | **none available**: no entry in the catalogue takes a voice reference. Kling 3.0's `elements` are account-registered Kling element ids (not creatable through this API); Wan 2.6/2.7 and Grok Imagine take an `audio_url`, but as a *driving* track, not a voice to imitate (tried: the jaw hangs open). No `seed` on Kling 3.0. |
| Every take is measured | `scripts/gator/voiceprint.ts` (pitch and brightness over the words he speaks) and `scripts/gator/asr.py` (local speech-to-text: faster-whisper base.en on the CPU) — `make.ts <id> --videos --takes 2` makes two takes, prints both, keeps the nearer one that says the line |
| Pulled together afterwards | pitch moved onto the reference by rate (never more than 12%; beyond that it sounds processed and is left alone), then one fixed chain: `highpass=f=75, bass=g=2:f=140, equalizer=f=3000:g=1.5, acompressor=threshold=-22dB:ratio=3, alimiter` and −14 LUFS |
| Captions | timed from the words the recogniser heard, never from the script's guess |

### The reference: the voice the owner approved

`talking-sample-2` (Kling 3.0 Standard, 5 s): median pitch **127 Hz** (middle half 110–178 Hz), spectral
centroid **1548 Hz**, speaking from 1.44 s. Recorded in `voiceprint.ts` as `REFERENCE`. A take is "in band" when
its pitch is within 15% and its brightness within 30%.

### How consistent it really is (measured, 2026-10-08 — nobody on this box can listen)

| Clip | Kind of delivery | Median pitch | vs 127 Hz | Brightness | Words heard |
| --- | --- | --- | --- | --- | --- |
| talking-sample-2 (the reference) | calm, to camera | 127 Hz | — | 1548 Hz | exact |
| talking-final-1, take 1 | calm, to camera | 134.5 Hz | +6% | 1429 Hz | exact |
| talking-final-1, take 2 | calm, to camera | 179.8 Hz | +42% | 1704 Hz | exact |
| moment-video — the gator's button | calm, after a sip | 130.1 Hz | +2% | 1452 Hz | exact |
| moment-ladders — the gator's button | calm, after a sip | 155.3 Hz | +22% | 1617 Hz | exact |
| selfie-leak, takes 1 / 2 | fast vlog | 190.5 / 175.8 Hz | +50% / +38% | 1698 / 1617 Hz | exact |
| selfie-roof, takes 1 / 2 | fast vlog, then a fall | 238.8 / 202.5 Hz | +88% / +59% | 1815 / 1753 Hz | exact |
| selfie-deck, takes 1 / 2 / 3 | fast vlog, then a fall | 275.9 / 242.4 / 242.4 Hz | +117% / +91% / +91% | 1720–1760 Hz | exact |

Plainly:

- **The words are reliable.** Every take said its line, in order (one "home owner" for "homeowner", "20" for
  "twenty"). Dialogue in quotes in the prompt works.
- **The voice is not one voice.** Calm, short lines to camera land within about a fifth of the reference —
  three of five takes inside the band. Fast, excited selfie vlogs measure 40–120% higher: either a different,
  lighter voice or shouting (the meter cannot tell which; some of that may be the meter itself being fooled by
  a rough voice). Two takes of the same prompt differ by up to 36%.
- **What helps:** the verbatim description; a short calm line; "deadpan, unhurried" in the action; two takes
  and keeping the nearer. **What does not exist:** a seed, a voice id, a voice reference.
- **The owner's ear is the final check.** These numbers say "probably the same sort of voice" or "probably
  not"; they do not say "sounds like the same guy".

### On-model while talking

- **Live-action gator:** stays on-model (hat, shades, vest) through speech, camera spin and falls in every take
  looked at; one take lost the vest for half a second mid-slide; in one the blast knocked the hard hat off.
- **Cartoon mascot:** Kling 3.0 makes his sunglasses see-through and gives him eyes within a second of speaking
  — in sample 2 and again in `talking-final-1` with the on-model wording in the prompt. That is off-model for
  the mascot. Until a model holds the glasses, **the cartoon mascot does not talk on camera**; he reacts, and
  the line belongs to the live gator or sits in a caption.

## Writing for him

- One or two short lines, dry, fragments. "Twenty years. Never said good years."
- For a vlog: a confident sentence the disaster can interrupt, and a short deadpan line after it.
- Numbers as words. One dialect word a clip at most.
- A product line stays true and light: "Found the permit office in ten seconds. Parking? Different story."
- Subtitles are burned into the captioned cut from what was heard; the pure cut carries nothing.

## What was tried first (kept for the record)

| | Voice | Mouth | Cost / 5 s | Verdict |
| --- | --- | --- | --- | --- |
| 1 | our own TTS | Wan 2.7 driven by the line (`audio_url`) | $0.50 | the jaw follows, but he turns front-on into a wide laughing face |
| 2 | **Kling 3.0's own voice** | the same model | $0.63 | **the owner's pick** — and it gave the cartoon mascot eyes |
| 3 | our own TTS | Kling 2.5, loose jaw | $0.21 | best-looking mascot; the voice has no accent |
| 4 | our own TTS | Wan 2.7 driven, held in profile | $0.50 | the jaw drops open and stays open |

Our own TTS (`scripts/gator/voice.ts`, recipe version 1): the Call Assistant's Kokoro engine, persona
`marcus` = Kokoro voice `am_adam`, pitched down 10%, tempo up 14%, bass and a little grit. Consistent and free — and
without any regional accent, which is why the owner passed on it. It stays in the code for a line that must be
identical every time (an end-tag sting, say); it is not the gator's speaking voice.

Other models with native speech, priced but not tried: PixVerse V6 ($0.26 / 5 s at 720p, has a seed and a
negative prompt — the next one to test for the mascot's glasses and for consistency), MiniMax H3 ($0.65), Kling
2.6 Pro ($0.70), Grok Imagine Video ($0.71), LTX 2.5 ($0.78 / 6 s); Seedance, Wan 3.0 and Cinema Studio are
token- or per-second-metered with no fixed estimate, so the budgeted client refuses them.

## What would make it better

- A model that accepts a voice reference (none in this catalogue today), or approval to try one outside it.
- The owner's ear on ten lines, to say which measured pitch range is "him" — then the band can be set from
  that instead of from one clip.
