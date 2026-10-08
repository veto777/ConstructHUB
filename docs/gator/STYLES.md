# Gator shorts — the styles experiment

<!-- Written by scripts/gator/styles-doc.ts from scripts/gator/styles.ts. Edit the data, then run the script. -->

The owner, 2026-10-08: *"We can try 10-12 dozen styles and whatever does well will use it."* So: a set of
distinct styles, two clips each (a style is not judged on one joke), every post carrying its style number,
and a scoreboard that says which to double down on (`scripts/gator/scoreboard.ts` → `SCOREBOARD.md`).
There are 15: the twelve first planned, and three the owner added from reference clips the same day (13–15).

**The same limits in every style:** harm is cartoon or absurd and he is fine afterwards; no realistic person
is hurt; nothing that reads as a real accident, an animal attack or cruelty; no real people, brands, leagues
or other creators' characters; nothing presented as safety advice; AI-generated label on every platform and
#AIContent in the caption. Nothing is posted before a person has looked at it (`daily.ts --approve`).

## The styles

| # | Style | What it is | Recipe | Model | About per clip | Example | LinkedIn | Made so far |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Selfie vlog goes wrong — live gator** | The photoreal gator films himself, talking fast and cocky; the disaster happens mid-sentence; he never stops talking. | Selfie still from the live model sheet → one 9–10 s take with the dialogue and the fixed voice description in the prompt; two takes, keep the better; pure + subtitled. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 42 credits ($2.63) | “Day one. New deck. Solid.” — the deck goes. | no | `selfie-deck`, `selfie-roof`, `selfie-leak` |
| 2 | **Selfie vlog goes wrong — cartoon mascot** | The same format with the brand mascot, drawn. | Selfie still from the mascot references → one take as style 1. Watch his sunglasses: the talking model tends to make them see-through. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 22 credits ($1.38) | The mascot on the two-day job: “Two days, he says—” (the tarp takes him). | no | `mascot-shed` |
| 3 | **One-shot found footage — the impossible skill** | A phone clip of the live gator doing a trade job absurdly well; nothing burned in. | Live still → one 8–10 s take, natural sound; pure only. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 19 credits ($1.19) | He walks the ridge with a bundle of shingles on his shoulder like he has done it for thirty years. | yes | `skill-blower`, `skill-tail` |
| 4 | **One-shot found footage — the fail he walks away from** | A phone clip of a clean slapstick fail; he is fine and it shows. | Live still → one 8–10 s take; pure; optional replay edit. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 19 credits ($1.19) | The wheelbarrow, the ramp, the flat tyre. | no | `fail-dominoes`, `fail-wheelbarrow` |
| 5 | **CCTV / doorbell / dashcam** | Fixed high camera, timestamp and camera name in the corner; something happens in frame. | High-angle still → one take; the overlay (CAM 03, a clock) is drawn in the edit, never by the model. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 19 credits ($1.19) | CAM 03: he rides the sliding ladder down like a surfboard and lands on his feet. | no | `cctv-ladder`, `cctv-shingles` |
| 6 | **Cartoon slapstick with a meme caption** | The mascot, two shots, big caption, a 1.5 s end tag — the pilot's look. | Stills from the mascot references → Kling 2.5 shots → captions, synthesised foley. | Kling 2.5 Turbo Standard image-to-video, 5 s (3.36 credits a shot), sound synthesised | 10 credits ($0.63) | “While you're here…” | yes | `while-youre-here`, `two-day-job`, `shingle-rhythm` |
| 7 | **Screaming-goat smash cut** | A contractor cliché line, then a hard cut to OUR goat screaming. | Gator shot (the line) + our own photoreal goat, one 3 s take with its own scream; the scream is the model's, never the meme's audio. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 24 credits ($1.50) | “My cousin can do it cheaper.” — goat. | no | `goat-cousin`, `goat-inch-short` |
| 8 | **POV: the coworker's phone** | “Bro look at the new guy” — handheld, a coworker filming the gator at work. | Over-the-shoulder live still → one take; a one-line caption in the phone-caption style in the captioned variant. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 19 credits ($1.19) | New guy's first day: the nail gun, a whole row, perfectly straight, in two seconds. | no | `pov-nailgun`, `pov-one-trip` |
| 9 | **Satisfying craft loop** | No joke: perfect work, hypnotic, loops. | Live or cartoon still → one take, natural sound; cut to loop. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 19 credits ($1.19) | Chalk line: one snap, dead straight. | yes | `satis-chalk`, `satis-caulk` |
| 10 | **Hot take to camera** | The gator, one trade cliché, one dry line. | Live still, three-quarter, coffee → one 5 s take with the line; subtitled. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 12 credits ($0.75) | “Measure once, cut twice. That's the trade.” | yes | `take-measure`, `take-caulk` |
| 11 | **Expectation vs reality** | Two shots, two words: the estimate / the change orders; day 1 / day 9. | Two stills → two shots, split by a hard cut with a label on each. | Kling 2.5 Turbo Standard image-to-video, 5 s (3.36 credits a shot), sound synthesised | 10 credits ($0.63) | The quote. / The house. | yes | `measure-twice`, `zero-percent-rain` |
| 12 | **Recurring-cast sketch** | The gator with the cast: the rooster apprentice, the possum inspector, the beaver framer, the raccoons. | Cast still from text → one take with dialogue; subtitled. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 22 credits ($1.38) | The rooster comes back with the board stretcher. | no | `cast-stretcher`, `cast-inspector` |
| 13 | **Viral moment + gator button** | A cast member stalls with total confidence right up to the drop; then the gator's dry line. | Cast scene 10 s + gator button 5 s, both with their own sound; subtitles from the heard words; 0.8 s tag. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 33 credits ($2.06) | “Lemme tell you somethin' about ladders—” / “Tie off.” | no | `moment-ladders`, `moment-video` |
| 14 | **The fall + instant replay** | The viewer sees the trap first; he walks into it; the impact is replayed four ways with music. | One static shot, 10 s → replay.ts (rewind, punch-in, mirror + freeze, slow motion) with CC0 music and a no-music export. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 22 credits ($1.38) | The bucket was full of concrete. | no | `fall-bucket`, `fall-wetfloor` |
| 15 | **Tiny gator, giant opponent** | A cat-sized gator in a tiny hard hat, an enormous invented man, one slap, a timber-fall, a deadpan look. | Still from text → one 10 s take; pure + replay edit. The man is invented, unbranded, and shown fine at the end. | Kling 3.0 Standard image-to-video, own sound (2.016 credits per second) | 22 credits ($1.38) | Lunch break. The big guy said go ahead. | no | `slap-arena`, `slap-jobsite` |

**Cost up front:** two clips of every style ≈ 628 credits ($39.25) at one take each; the talking styles
(1, 2, 12, 13) are budgeted at two takes. The cap for the whole experiment, pilot aside, is $100.00 and is
enforced in code (`higgsfield.ts`): at these prices all 30 clips fit with room for retakes.

## The look of each family

- **Live-action (1, 3, 4, 5, 7, 8, 9, 10, 12–15):** a photoreal alligator in the brand's hard hat, shades and
  vest; one model sheet (`analysis/gator-shorts/_live/`) is the reference for every still, so it is the same
  animal. ONE continuous take; **the "pure" cut carries nothing burned in** — no meme text, no logo, no end tag
  (the formula of the owner's reference clips). A "captioned" cut is rendered beside it (small subtitles of
  what is heard, or one short caption) for comparison and for muted feeds.
- **Cartoon (2, 6, 11):** the brand mascot from his own artwork; meme captions; the end tag.
- **Edits that cost nothing:** the instant replay (`replay.ts`), the CCTV overlay, the goat cutaway (the goat
  is generated once and reused).

## Posting plan for the test

The accounts are days old and have already pushed back once (2026-10-08: Instagram "restricted", LinkedIn
"share limit"). The shared rate rule (`scripts/tutorials/social-rate.ts`) holds for both streams together:
LinkedIn ≤ 3 posts per rolling 24 h until the profile is verified, Instagram ≤ 4 per 24 h for two weeks;
TikTok is kept to 6 a day by hand; YouTube is limited by the channel's own daily upload cap (the tutorials
use three).

- **TikTok and Instagram: two gator clips a day**, about 12:00 and 19:00 Eastern (minutes varied).
- **LinkedIn: one a weekday**, only the styles marked "yes".
- **YouTube Shorts: one a day** (the noon clip) when the upload cap allows.
- Each style's two clips land on **different days and different dayparts**:

| Day | ~12:00 Eastern | ~19:00 Eastern |
| --- | --- | --- |
| 1 | style 1 — Selfie vlog goes wrong — live gator | style 8 — POV: the coworker's phone |
| 2 | style 2 — Selfie vlog goes wrong — cartoon mascot | style 9 — Satisfying craft loop |
| 3 | style 3 — One-shot found footage — the impossible skill | style 10 — Hot take to camera |
| 4 | style 4 — One-shot found footage — the fail he walks away from | style 11 — Expectation vs reality |
| 5 | style 5 — CCTV / doorbell / dashcam | style 12 — Recurring-cast sketch |
| 6 | style 6 — Cartoon slapstick with a meme caption | style 13 — Viral moment + gator button |
| 7 | style 7 — Screaming-goat smash cut | style 14 — The fall + instant replay |
| 8 | style 8 — POV: the coworker's phone | style 15 — Tiny gator, giant opponent |
| 9 | style 9 — Satisfying craft loop | style 1 — Selfie vlog goes wrong — live gator |
| 10 | style 10 — Hot take to camera | style 2 — Selfie vlog goes wrong — cartoon mascot |
| 11 | style 11 — Expectation vs reality | style 3 — One-shot found footage — the impossible skill |
| 12 | style 12 — Recurring-cast sketch | style 4 — One-shot found footage — the fail he walks away from |
| 13 | style 13 — Viral moment + gator button | style 5 — CCTV / doorbell / dashcam |
| 14 | style 14 — The fall + instant replay | style 6 — Cartoon slapstick with a meme caption |
| 15 | style 15 — Tiny gator, giant opponent | style 7 — Screaming-goat smash cut |

Each clip goes through the review folder first: `daily.ts --approve <id>` queues it; nothing is queued by itself.

## Measuring

`scoreboard.ts` takes one reading per post at +2 h, +24 h and +72 h. YouTube comes from the API (views, likes,
comments, average view duration). **Blotato's API has no analytics endpoint**, so Instagram, TikTok and LinkedIn
counts are typed into `docs/gator/metrics-manual.csv` from each app's insights — the tool prints exactly which
rows it is waiting for. Clips are ranked within a platform by views and by engagement rate
((likes + comments + shares) / views); a style's score is the mean of its clips' ranks. The recommendation
("double down on X and Y, drop Z") appears only when every style has both clips at +72 h.
