# Gator shorts — the writers' room

<!-- Written by scripts/gator/concepts-doc.ts from scripts/gator/concepts.ts and concepts-more.ts. Edit the data, then run the script. -->

A second content stream beside the tutorials: short, funny, AI-generated clips starring the ConstructHUB
gator, for TikTok, Instagram Reels, YouTube Shorts and LinkedIn. The owner's brief: *"make ai content with
an alligator … driving to a jobsite, or installing shingles — funny stuff that can go viral"* and *"for
social media we want to mix in viral clips"*.

## House rules

- **Warm and trade-savvy.** The joke is on the job, the clock, the weather, the paperwork or the gator
  himself — never on a customer's intelligence, a trade or a person.
- **Nothing unsafe shown as the way to do it.** At height he wears a harness clipped to an anchor (or keeps
  three points of contact on a ladder); the hard hat and sunglasses never come off. Slapstick is obviously
  cartoon, never a how-to.
- **Nothing political, sexual, crude or demeaning.** No real people, no other company's name, logo, character
  or vehicle badge. Trucks and tools are generic and unmarked; no readable text is generated in a picture.
- **No one else's audio.** The track is synthesised in `scripts/gator/sound.ts` (sines and seeded noise:
  engine hum, nail-gun pops, a bell, a swish, a clock, a plain kick-and-hat bed). The video models' own
  audio is not used. A platform's trending sound can be laid over it by the owner in the app.
- **The product is an end tag.** 1.5 s: the logo, "Run the whole job.", constructhub.us. The joke lands first.
- **Every clip is AI-generated and labelled so**: TikTok `isAiGenerated: true`, YouTube
  `status.containsSyntheticMedia: true`, and "AI-generated animation of our mascot." in the Instagram, LinkedIn and YouTube text
  (Blotato exposes no AI field for those two; on Instagram switch on "AI info" in the app after posting).
- `lintConcept` (tested) holds every concept to what a machine can check: hook ≤ 8 words, 1–3 shots,
  5–20 s, five hashtags, a harness wherever he is on a roof, no brand names, the AI note in every post.

## How a clip is made

```bash
G="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/make.ts"
$G <conceptId> --plan              # free: prompts, estimated cost, the budget
$G <conceptId> --stills            # paid: one scene still per shot — then LOOK at each
$G <conceptId> --retake-still s2   # paid: a still was off-model, had text, or left no room for the caption
$G <conceptId> --videos            # paid: animate the approved stills — then LOOK at the frames
$G <conceptId> --retake-video s1   # paid: a new take of one clip
$G <conceptId> --assemble          # free: cut, captions, logo, end tag, sound, cover.jpg, review.jpg, social.json
$G --ledger                        # the cap, what is spent, every paid call
```

Output: `analysis/gator-shorts/<conceptId>/` — `clip.mp4` (1080×1920, 30 fps, H.264 + AAC, about −14 LUFS),
`cover.jpg`, `review.jpg` (twelve frames on one sheet), `social.json` (per-platform text, hashtags,
`aiGenerated: true` and each platform's disclosure), the stills and raw clips of every take.

**Character consistency — what works.** The API has no trained-character feature that fits a cartoon mascot
(Soul ID is for people). The reliable method is two steps:

1. **A scene still drawn by an image-edit model that is handed the mascot's own artwork** — Grok Image 2.0
   (`xai/grok-imagine-image-2.0`) with two references: the full figure and a close-up of the head, both cut from
   `client/public/mascot/gator-standing-1024.v1.webp` onto white. Every prompt starts with the same
   character block and ends with the same framing block (below). In the pilot 11 stills were drawn; all 11
   had the right hat, glasses, vest, hoodie, belt, boots and drawing style. 5 were rejected for other reasons:
   garbled lettering on a skip, a second tail lying on a tailgate, a square picture on white bands, a vignette,
   and one whose composition hid his face.
2. **Image-to-video from the approved still** — Kling 2.5 Turbo Standard (`kling-video/v2.5-turbo/standard/image-to-video`, 5 s,
   720×1280, 24 fps). It keeps what is in its first frame; he stayed on-model in all 7 clips.

Character block: `Use the reference images: image 1 is the full-body model sheet of our mascot, image 2 is a close-up of his head. Draw THE SAME character, unchanged: a stocky cartoon alligator with green scaly skin and a cream-yellow jaw and belly, a long rounded snout with small white teeth showing in a confident closed-mouth smirk, a glossy yellow hard hat, black wraparound sunglasses with orange-tinted lenses (always on, eyes never visible), a black hoodie with the hood down, an orange hi-vis safety vest with yellow and silver reflective stripes worn over the hoodie, black cargo work trousers, a black tool belt with a tape measure, tan lace-up work boots, and a thick green tail with dark ridges. Same thick black outlines, same glossy cel-shaded cartoon sticker style, same colours and proportions as the references. The whole scene, background included, is drawn in that same bold cartoon style — not photorealistic.`

Framing block: `Vertical 9:16 illustration, full-bleed: the artwork fills the whole tall frame from edge to edge, with no border, margin, panel, vignette or white band; the background scene (ground, walls, sky) is drawn right out to all four edges, never a plain white or blank backdrop. The character is large and sits in the middle band of the frame; the top third of the frame is calm, empty background (sky, wall or ceiling) with his hard hat below it, and the bottom quarter holds nothing important. Exactly one alligator. No people. No text, letters, numbers, signs with writing, logos, brand names, badges or watermarks anywhere.`

Motion style (appended to every motion prompt): `2D cartoon animation, the same bold cel-shaded style as the image, smooth and simple motion. His hard hat and sunglasses stay on. Nothing morphs. No text appears.` Negative prompt: `text, letters, numbers, captions, logo, brand name, watermark, photorealistic, live action, extra limbs, extra fingers, deformed hands, second alligator, human, sunglasses removed, hard hat removed, flicker, morphing`

**Captions.** Bundled Anton capitals, white with a black edge, one word in the brand orange (#f97316), popping
in over three frames. Two zones (`ZONES` in `layout.ts`, tested against the tutorials' `SAFE_AREA`): *top*,
under the platform's tabs; *low*, above the platform's caption and clear of the like / comment / share column.
A beat that does not fit at 64 px or more is refused, not shrunk. The small CHUB logo sits bottom-left of the
safe area. Stills must leave the **top third** empty for the hook; when one does not, `shiftDown` moves the
picture down and mirrors the sky into the gap.

## Money

Higgsfield (`https://api.higgsfield.ai`, `Authorization: Key <id>:<secret>`) prices every call with a free
`POST /estimate/{model}`; 1 credit = $0.0625. Prices on 2026-10-08 for this account:

| Call | Credits | USD |
| --- | --- | --- |
| Grok Image 2.0 edit, 2k, 9:16, medium, two reference images (what the pipeline sends) | 1.6 | $0.10 |
| …the same with one reference | 1.44 | $0.09 |
| Qwen Image 3 edit, 1k / 2k | 0.64 / 1.2 | $0.04 / $0.075 |
| Kling 2.5 Turbo Standard image-to-video, 5 s (what the pipeline uses) | 3.36 | $0.21 |
| Kling 2.5 Turbo Pro, 5 s | 5.6 | $0.35 |
| Kling 3.0 Standard, 5 s, sound off | 6.72 | $0.42 |
| Kling 3.0 Turbo, 5 s, 720p / 1080p | 8.96 / 11.2 | $0.56 / $0.70 |
| Wan 2.6 image-to-video, 5 s, 720p / 1080p | 8 / 12 | $0.50 / $0.75 |
| Hailuo 2.3 Standard, 6 s | 4.48 | $0.28 |
| PixVerse V6, 5 s, 720p / 1080p (15% discount shown) | 3.06 / 6.12 | $0.19 / $0.38 |
| Higgsfield DoP Standard | 9 | $0.56 |
| Seedance 2.0 | token-metered — no fixed estimate; the client refuses it | |

- **The cap** is in the ledger and enforced in code (`assertWithinBudget`): 57.6 credits ($3.60) —
  12 videos × 3.36 + 12 images × 1.44, set before the first paid call. A call that would pass it is
  refused before anything is sent. To raise it, edit `cap` in `analysis/gator-shorts/ledger.json` on purpose.
- **Never twice.** Each shot take has one ledger entry, written before the request leaves; a repeat run asks
  for nothing that is finished, polls what is in flight, and re-sends a lost request with the same
  `Idempotency-Key` (Higgsfield returns the first request). A changed prompt is a new take, by flag.
- **There is no balance endpoint** in the API (the balance is on console.higgsfield.ai only), so the ledger's
  own sum is the record of what this tool spent. Failed, moderated and cancelled requests are not charged.
- **The pilot** (2026-10-08): 11 stills + 7 clips = 41.12 credits = **$2.57** for three finished clips.
- **Per clip:** two shots, one take of everything = 9.92 credits = **$0.62**. At the pilot's retake
  rate (about 1.4 takes a shot) ≈ 13.7 credits = **$0.86**. **One clip a day ≈ $18.60–$26 a month.**

## The pilot, honestly (2026-10-08)

Three clips, 7.9 s each, in `analysis/gator-shorts/` (git-ignored): `two-day-job`, `shingle-rhythm`,
`while-youre-here`. He is recognisably our gator in every frame looked at. What is still off:

- The clips are 720×1280 at 24 fps from the model, enlarged to 1080×1920 at 30 fps: slightly soft, a little judder.
- His mouth opens into a toothy grin for a few frames in the shingle shot and in the tailgate shot — the
  mascot's closed-mouth smirk is not held throughout.
- The harness is drawn, but its lanyard is not visibly clipped to an anchor in either roof shot; in the
  second he stands near the ridge. Fine as a cartoon, not a safety illustration.
- The cab in the driving shot is a cut-away with no door, and the cup holder floats; the house behind
  "Day 9" is drawn more realistically than he is.
- The nail-gun pops are on a fixed beat, not on the picture's own kicks; the sound is plain synthesis.
- Three shots had the picture moved down (sky mirrored above) because the still left no room for the hook.
- Charming rather than laugh-out-loud. "While you're here…" reads best in the first two seconds.

## Mixing into the calendar

The owner's cadence (2026-10-08), in code in `scripts/tutorials/social-rate.ts` (shared by both streams) and
`scripts/gator/stream.ts`, tested:

- **YouTube gets every walkthrough and no gator clips.** (The Shorts code is kept, switched off.)
- **TikTok, Instagram and LinkedIn: one tutorial cut and 3 gator clips a day per account**, at least two
  hours apart: gator 07:30–08:15, the tutorial 10:15–11:00, gator 13:00–13:30, gator 18:30–20:30 Eastern; the
  minute moves every day. LinkedIn on weekdays keeps to business hours (08:00–08:15, 13:00–13:30,
  15:30–17:30) and at the weekend gets the tutorial and one gator clip; it only gets the tame clips.
- **Four posts a day per account**; if LinkedIn ("share limit") or Instagram ("account is restricted") refuses
  a post, that account drops to two a day for 48 hours and the refused clip moves to the next free slot,
  never sooner than 12 hours later.
- **Its own ledger**: `docs/gator/viral-schedule.json`, entries marked `stream: "viral"`; a clip goes to an
  account once.
- **Order**: evergreen concepts in the order below, a satisfying-work clip after every two jokes; the
  season / day-of-week ones when their note says.

```bash
npx tsx scripts/tutorials/social-post.ts --stream viral            # DRY RUN: every finished clip × account — when, caption, request
npx tsx scripts/tutorials/social-post.ts --stream viral --go       # refused: the viral stream is not switched on
```

Before it can be switched on: the owner approves the clips; the clips are uploaded to R2 (the tutorials'
media route serves `gator-<id>.social-vertical.<hash>.mp4` only once its name pattern is checked); the send
path writes the viral ledger before each request, as the tutorial poster does.

## The thirty concepts

- **Job-site pain:** [The “two-day” job](#1-the-two-day-job) · [“While you're here…”](#3-while-youre-here) · [The permit office closes at 4](#4-the-permit-office-closes-at-4) · [Monday 6 AM vs Friday 2 PM](#5-monday-6-am-vs-friday-2-pm) · [The estimate vs the change orders](#6-the-estimate-vs-the-change-orders) · [The client paid the same day](#7-the-client-paid-the-same-day) · [Zero percent chance of rain](#8-zero-percent-chance-of-rain) · [One quick supply run](#9-one-quick-supply-run) · [Where is my tape measure?](#10-where-is-my-tape-measure) · [The inspector pulls up](#11-the-inspector-pulls-up) · [11:59 on the jobsite](#12-1159-on-the-jobsite) · [Measure twice, cut once](#13-measure-twice-cut-once) · [First cold morning of the season](#14-first-cold-morning-of-the-season) · [The phone rings on the ladder](#15-the-phone-rings-on-the-ladder) · [A quick question at 9:47 PM](#16-a-quick-question-at-947-pm) · [The coffee ran out at 7:15](#17-the-coffee-ran-out-at-715) · [The dumpster on day three](#18-the-dumpster-on-day-three)
- **POV:** [POV: first one on site](#19-pov-first-one-on-site) · [POV: the bubble is dead centre](#20-pov-the-bubble-is-dead-centre) · [POV: zero punch list](#21-pov-zero-punch-list) · [POV: you finally organised the truck](#22-pov-you-finally-organised-the-truck) · [POV: inspection passed, first try](#23-pov-inspection-passed-first-try)
- **Satisfying work:** [No thoughts, just shingles](#2-no-thoughts-just-shingles) · [One snap of the chalk line](#24-one-snap-of-the-chalk-line) · [Deck boards, one after another](#25-deck-boards-one-after-another) · [One pass, no drips](#26-one-pass-no-drips) · [Smooth](#27-smooth) · [The cleanest jobsite on the street](#28-the-cleanest-jobsite-on-the-street)
- **Product tie-ins:** [Finding the permit office in seconds](#29-finding-the-permit-office-in-seconds) · [Sending the estimate from the truck](#30-sending-the-estimate-from-the-truck)

Evergreen: 27. Trend / season dependent: Monday 6 AM vs Friday 2 PM; Zero percent chance of rain; First cold morning of the season. The "POV:" label
and the "X vs Y" split are formats that travel now and will date; the scenes under them do not.

### 1. The “two-day” job — PILOT, produced

`two-day-job` · job-site pain · evergreen · 7.9 s with the end tag

**Hook on screen:** “DRIVING TO THE “TWO-DAY” JOB”

**Shot s1** — 3.4 s of a 5 s generation (picture moved down 230 px for the caption)
- Still prompt (after the character block): `He is driving a generic unmarked orange pickup truck at sunrise, seen from the passenger side inside the cab: both hands on the steering wheel, seat belt on, a paper coffee cup steaming in the cup holder, a ladder rack visible through the rear window, a quiet suburban road and a pink-orange sky through the windscreen.`
- Motion prompt: `He drives the pickup, both hands on the wheel, calmly bobbing his head to the radio. Houses and trees slide past the windows. The coffee steams. Gentle road vibration.`
- Caption beats: 0.0 s “DRIVING TO THE “TWO-DAY” JOB” — orange: “TWO-DAY”

**Shot s2** — 3 s of a 5 s generation
- Still prompt (after the character block): `He stands in a driveway facing the viewer, holding a paper coffee cup, completely deadpan. Behind him is a two-storey house stripped down to its wooden studs, a blue tarp over the roof, scaffolding, stacks of lumber and a plain, unmarked skip with nothing written on it. Overcast afternoon light.`
- Motion prompt: `He stares at the viewer, deadpan, and takes one long slow sip of coffee. Behind him the blue tarp flaps in the wind and a single board drops off the house.`
- Caption beats: 0.1 s “DAY 9.” — orange: 9.

**Sound:** Engine hum and a plain kick-and-hat bed on the drive; cut to wind, a thud and a three-note “wah-wah” on the reveal. (cues: engine, beat, thud, air, sad)

**Instagram**
> “Should take about two days.” — me, nine days ago.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #contractorhumor #bluecollar #jobsite

**TikTok** (isAiGenerated: true)
> “Should take about two days.” — me, nine days ago. #contractorlife #construction #contractorhumor #bluecollar #jobsite

**LinkedIn**
> Every estimator has said “about two days” at least once. Scope grows; the paperwork should keep up with it. A change order sent the same day saves the conversation nine days later.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #construction #contractorhumor

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Driving to the “two-day” job… day 9 #Shorts`
> “Should take about two days.” — me, nine days ago.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #contractorhumor #Shorts

### 2. No thoughts, just shingles — PILOT, produced

`shingle-rhythm` · satisfying work · evergreen · 7.9 s with the end tag

**Hook on screen:** “NO THOUGHTS. JUST SHINGLES.”

**Shot s1** — 4 s of a 5 s generation (picture moved down 300 px for the caption)
- Still prompt (after the character block): `He kneels on a pitched residential roof under a clear blue sky, wearing a fall-arrest safety harness whose lanyard is clipped to a roof anchor, pressing a roofing nail gun onto a row of dark grey asphalt shingles. A neat stack of shingles sits beside him. The lower half of the roof is finished in perfectly straight rows; the upper half is bare underlayment.`
- Motion prompt: `He nails shingles in a steady rhythm: the nail gun kicks, he slides the next shingle into place, the nail gun kicks again. Calm, even, satisfying. The camera pushes in slowly.`
- Caption beats: 0.0 s “NO THOUGHTS. JUST SHINGLES.” — orange: SHINGLES.

**Shot s2** — 2.4 s of a 5 s generation
- Still prompt (after the character block): `He stands on the finished roof at golden hour with his arms crossed, wearing the fall-arrest safety harness with its lanyard clipped to a roof anchor, the nail gun resting at his feet. Every row of dark grey shingles behind him is perfectly straight. Rooftops and trees in the distance.`
- Motion prompt: `Arms crossed, he looks over the finished roof and nods slowly, satisfied. The camera pulls back slowly to show the perfectly straight rows of shingles. Warm light, a light breeze.`
- Caption beats: 0.1 s (low) “STRAIGHT LINES ONLY.” — orange: STRAIGHT

**Sound:** Nail-gun pops on the beat over a plain kick-and-hat bed; a bell on the finished roof. (cues: pop, beat, ding, air)

**Instagram**
> Nothing to see here. Just a gator, a harness and very straight lines.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #roofing #roofer #satisfying #construction #contractorlife

**TikTok** (isAiGenerated: true)
> Nothing to see here. Just a gator, a harness and very straight lines. #roofing #roofer #satisfying #construction #contractorlife

**LinkedIn**
> Good roofing is rhythm: line, shingle, four nails, next. The same goes for the paperwork around it. Tie off first, keep the lines straight.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #roofing #roofer #satisfying

**YouTube Shorts** (containsSyntheticMedia: true) — title: `No thoughts. Just shingles. (gator roofing) #Shorts`
> Nothing to see here. Just a gator, a harness and very straight lines.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #roofing #roofer #satisfying #Shorts

### 3. “While you're here…” — PILOT, produced

`while-youre-here` · job-site pain · evergreen · 7.9 s with the end tag

**Hook on screen:** “FINALLY PACKED UP. GOING HOME.”

**Shot s1** — 3 s of a 5 s generation (picture moved down 90 px for the caption)
- Still prompt (after the character block): `At dusk in a suburban driveway he leans back against the closed tailgate of a generic unmarked orange pickup truck, facing the viewer in a three-quarter view, relaxed and pleased, brushing his hands together. The truck bed behind him holds a ladder and black tool boxes. His one tail hangs low behind his legs. A house with a freshly built wooden porch stands further back. Warm evening light, long shadows. The dusk sky fills the whole top third of the frame, right out to every edge.`
- Motion prompt: `Leaning against the truck, he wipes his hands, lets out a long relieved breath, shoulders dropping, and gives a small satisfied nod toward the viewer. He stays where he is. Warm evening light.`
- Caption beats: 0.0 s “FINALLY PACKED UP. GOING HOME.” — orange: HOME.

**Shot s2** — 3.4 s of a 5 s generation (picture moved down 220 px for the caption)
- Still prompt (after the character block): `Close-up from the chest up at dusk in the same driveway: he has frozen mid-step beside the same orange pickup truck, shoulders tense, head turned back over his shoulder toward the viewer, mouth a flat line. The porch light of the house glows softly far behind him.`
- Motion prompt: `He is frozen. Very slowly he turns his head toward the viewer and holds a long deadpan stare. Slow dramatic push-in on his face.`
- Caption beats: 0.1 s ““WHILE YOU'RE HERE…”” — orange: HERE…”

**Sound:** An easy bed and a tailgate thud; then it cuts dead — a swish, and a clock ticking through the stare. (cues: air, thud, beat, whoosh, tick)

**Instagram**
> Three words that add two hours. (We love you. We'll do it. It's going on the change order.)
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #construction #handyman #bluecollar

**TikTok** (isAiGenerated: true)
> Three words that add two hours. (We love you. We'll do it. It's going on the change order.) #contractorlife #contractorhumor #construction #handyman #bluecollar

**LinkedIn**
> “While you're here…” is how good jobs grow — and how margins disappear when the extra work never reaches paper. Say yes, write it down, send it before you leave the driveway.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #contractorhumor #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `“While you're here…” (every contractor knows) #Shorts`
> Three words that add two hours. (We love you. We'll do it. It's going on the change order.)
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #construction #Shorts

### 4. The permit office closes at 4

`permit-office-359` · job-site pain · evergreen · 9.5 s with the end tag

**Hook on screen:** “3:58 PM. PERMIT OFFICE CLOSES AT 4.”

**Shot s1** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `He sprints along a town pavement toward a plain civic office building with wide steps, a roll of blueprints tucked under one arm, leaning forward at full speed, small dust clouds at his boots. Late-afternoon sun.`
- Motion prompt: `He runs flat out toward the building, arms pumping, the blueprints under one arm, dust puffing behind his boots. The camera tracks alongside him.`
- Caption beats: 0.0 s “3:58 PM. PERMIT OFFICE CLOSES AT 4.” — orange: 4.

**Shot s2** — 4.8 s of a 5 s generation
- Still prompt (after the character block): `At the closed glass doors of a plain civic office building, blinds pulled down behind the glass, he holds a roll of blueprints hanging limp in one hand. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `He glances at the closed doors, then turns his head back to the viewer and talks, deadpan, with a small shrug. The roll of blueprints droops in his hand.`
- Caption beats: 0.1 s “3:59.” — orange: 3:59.

**Sound:** A fast tick and a racing bed for the sprint; a thud at the doors and the three-note “wah-wah”. (cues: beat, tick, thud, air)

**Instagram**
> Every contractor has lost this race at least once. Look the office up before you drive across the county.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #buildingpermit #construction #contractorhumor #generalcontractor

**TikTok** (isAiGenerated: true)
> Every contractor has lost this race at least once. Look the office up before you drive across the county. #contractorlife #buildingpermit #construction #contractorhumor #generalcontractor

**LinkedIn**
> Permit counters keep their own hours, and they are rarely the hours on the door. Knowing which office handles the job — and how it takes applications — before the drive is the cheapest hour saved all week.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #buildingpermit #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `3:58 PM. The permit office closes at 4. #Shorts`
> Every contractor has lost this race at least once. Look the office up before you drive across the county.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #buildingpermit #construction #Shorts

### 5. Monday 6 AM vs Friday 2 PM

`monday-vs-friday` · job-site pain · trend / season dependent — Post on a Friday afternoon; the “X vs Y” split is a format that travels now and will date. · 7.7 s with the end tag

**Hook on screen:** “MONDAY, 6 AM.”

**Shot s1** — 3 s of a 5 s generation
- Still prompt (after the character block): `Before dawn, under a single street light, he leans against the closed tailgate of a generic unmarked orange pickup truck, slumped, holding a very large paper coffee cup with both hands, shoulders heavy. Dark blue sky, a little mist.`
- Motion prompt: `He stands slumped, barely moving, and takes one slow, heavy sip of coffee. His head droops, then lifts again. Mist drifts past the street light.`
- Caption beats: 0.0 s “MONDAY, 6 AM.” — orange: MONDAY,

**Shot s2** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `In bright afternoon sun he walks toward a generic unmarked orange pickup truck with a bounce in his step, a tool bag swinging from one hand, chest out, a wide closed-mouth grin. Blue sky, a tidy finished jobsite behind him.`
- Motion prompt: `He struts toward the truck with a springy, rhythmic walk, swinging the tool bag in time, nodding along. Bright, sunny, upbeat.`
- Caption beats: 0.1 s “FRIDAY, 2 PM.” — orange: FRIDAY,

**Sound:** Near silence and a slow clock on Monday; a swish and a bright four-on-the-floor bed on Friday. (cues: air, tick, whoosh, beat)

**Instagram**
> Same gator. Same truck. Different animal.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #fridayfeeling #construction #bluecollar #contractorhumor

**TikTok** (isAiGenerated: true)
> Same gator. Same truck. Different animal. #contractorlife #fridayfeeling #construction #bluecollar #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Monday 6 AM vs Friday 2 PM (contractor edition) #Shorts`
> Same gator. Same truck. Different animal.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #fridayfeeling #construction #Shorts

### 6. The estimate vs the change orders

`estimate-vs-change-orders` · job-site pain · evergreen · 7.3 s with the end tag

**Hook on screen:** “THE ESTIMATE.”

**Shot s1** — 2.4 s of a 5 s generation
- Still prompt (after the character block): `He stands in a half-finished kitchen with bare stud walls, proudly holding up one single blank sheet of paper between two fingers, chest out.`
- Motion prompt: `He holds up the single sheet of paper proudly and gives one confident nod. The sheet flutters slightly.`
- Caption beats: 0.0 s “THE ESTIMATE.” — orange: ESTIMATE.

**Shot s2** — 3.4 s of a 5 s generation
- Still prompt (after the character block): `In the same half-finished kitchen he hugs a towering stack of blank paper that reaches above his hard hat, leaning back to balance it, peeking around the side of the stack.`
- Motion prompt: `He wobbles left and right, balancing the towering stack of paper. A few blank sheets slide off the top and drift down. He peeks around the stack at the viewer.`
- Caption beats: 0.1 s “THE CHANGE ORDERS.” — orange: CHANGE

**Sound:** One clean bell for the single sheet; a thud and a wobbling bed for the stack. (cues: ding, air, thud, beat)

**Instagram**
> Both are honest. One of them just had more time with the house.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #changeorder #construction #remodeling #contractorhumor

**TikTok** (isAiGenerated: true)
> Both are honest. One of them just had more time with the house. #contractorlife #changeorder #construction #remodeling #contractorhumor

**LinkedIn**
> An estimate is a snapshot; change orders are the record of what the house taught you afterwards. Writing each one down when it happens, with a price and a signature, is what keeps the final invoice from being a surprise to anyone.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #changeorder #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `The estimate vs the change orders #Shorts`
> Both are honest. One of them just had more time with the house.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #changeorder #construction #Shorts

### 7. The client paid the same day

`paid-same-day` · job-site pain · evergreen · 7.3 s with the end tag

**Hook on screen:** “CLIENT PAID THE INVOICE. SAME DAY.”

**Shot s1** — 2.2 s of a 5 s generation
- Still prompt (after the character block): `On a sunny jobsite he stands holding a phone in one hand close to his snout, frozen in surprise, eyebrows raised above his sunglasses. The phone screen glows and shows nothing readable.`
- Motion prompt: `He stares at the glowing phone, frozen, then slowly lifts his head toward the viewer in disbelief.`
- Caption beats: 0.0 s “CLIENT PAID THE INVOICE. SAME DAY.” — orange: PAID

**Shot s2** — 3.6 s of a 5 s generation
- Still prompt (after the character block): `On the same sunny jobsite he dances, both fists up, one boot off the ground, tail swung out to the side, a huge closed-mouth grin, the phone tucked in his tool belt.`
- Motion prompt: `He does a small joyful shuffle dance: stepping side to side, pumping both fists, tail swaying in time. Bright and bouncy.`
- Caption beats: 0.1 s “FINEST. CLIENT. EVER.” — orange: EVER.

**Sound:** A notification bell, a beat of silence, then a bouncy bed for the dance. (cues: ding, air, beat)

**Instagram**
> To everyone who pays the invoice the day it lands: we see you. We'd build you anything.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #smallbusiness #construction #contractorhumor #bluecollar

**TikTok** (isAiGenerated: true)
> To everyone who pays the invoice the day it lands: we see you. We'd build you anything. #contractorlife #smallbusiness #construction #contractorhumor #bluecollar

**LinkedIn**
> Nothing changes a contractor's week like an invoice paid the day it was sent. Clear line items and an easy way to pay make that day more likely — and it is worth saying thank you when it happens.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #smallbusiness #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `When the client pays the invoice the same day #Shorts`
> To everyone who pays the invoice the day it lands: we see you. We'd build you anything.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #smallbusiness #construction #Shorts

### 8. Zero percent chance of rain

`zero-percent-rain` · job-site pain · trend / season dependent — Seasonal: spring and storm season; any week the weather is the news. · 7.3 s with the end tag

**Hook on screen:** “FORECAST: 0% CHANCE OF RAIN.”

**Shot s1** — 2.6 s of a 5 s generation
- Still prompt (after the character block): `He stands on the grass just outside the wooden forms of a freshly poured, perfectly smooth concrete driveway slab — both boots on the grass, not on the concrete — holding a concrete float at his side, pleased, under a bright sky with one small grey cloud directly overhead.`
- Motion prompt: `He admires the smooth wet concrete and nods, satisfied. Above him the one small grey cloud grows and darkens.`
- Caption beats: 0.0 s “FORECAST: 0% CHANCE OF RAIN.” — orange: 0%

**Shot s2** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `Heavy cartoon rain pours straight down on him as he stands beside a wet concrete slab, soaked, holding a comically tiny umbrella over his hard hat. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `Rain pours straight down. He stands still under the tiny umbrella, water streaming off his hard hat, and stares at the viewer, deadpan.`
- Caption beats: 0.1 s “THE 0%:” — orange: 0%:

**Sound:** A calm bed; a thunder-thud, steady rain noise and the three-note “wah-wah”. (cues: air, beat, thud, sad)

**Instagram**
> The app said zero. The sky said “hold my float.”
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #concrete #contractorlife #construction #contractorhumor #bluecollar

**TikTok** (isAiGenerated: true)
> The app said zero. The sky said “hold my float.” #concrete #contractorlife #construction #contractorhumor #bluecollar

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Forecast said 0% chance of rain (pour day) #Shorts`
> The app said zero. The sky said “hold my float.”
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #concrete #contractorlife #construction #Shorts

### 9. One quick supply run

`one-quick-supply-run` · job-site pain · evergreen · 7.3 s with the end tag

**Hook on screen:** ““JUST ONE QUICK SUPPLY RUN.””

**Shot s1** — 2.6 s of a 5 s generation
- Still prompt (after the character block): `He stands beside a generic unmarked orange pickup truck parked on a jobsite, the truck bed completely empty, holding up one finger confidently.`
- Motion prompt: `He holds up one finger, nods confidently and pats the side of the empty truck.`
- Caption beats: 0.0 s ““JUST ONE QUICK SUPPLY RUN.”” — orange: ONE

**Shot s2** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `At sunset he stands beside the same parked a generic unmarked orange pickup truck, its bed now piled high with lumber, buckets and boxes strapped down, wiping his brow, tired, holding up four fingers.`
- Motion prompt: `He wipes his brow and holds up four fingers, shaking his head slowly. The sun sets behind the loaded, parked truck.`
- Caption beats: 0.1 s “TRIP FOUR.” — orange: FOUR.

**Sound:** A cheerful bell and bed; a thud and the “wah-wah” at sunset. (cues: ding, beat, thud, sad)

**Instagram**
> The list was three things. The list is never three things.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #construction #handyman #diy

**TikTok** (isAiGenerated: true)
> The list was three things. The list is never three things. #contractorlife #contractorhumor #construction #handyman #diy

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `“Just one quick supply run” (trip four) #Shorts`
> The list was three things. The list is never three things.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #construction #Shorts

### 10. Where is my tape measure?

`where-is-my-tape` · job-site pain · evergreen · 9.3 s with the end tag

**Hook on screen:** “WHERE IS MY TAPE MEASURE?”

**Shot s1** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `In a garage workshop he is bent over an open tool bag on a workbench, rummaging with both hands, tools scattered around, looking worried.`
- Motion prompt: `He rummages frantically through the tool bag, lifting tools and setting them down, then looks left and right.`
- Caption beats: 0.0 s “WHERE IS MY TAPE MEASURE?” — orange: TAPE

**Shot s2** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `Medium shot in the same garage workshop: he holds an orange tape measure up in one hand, just unclipped from his own tool belt. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `He holds the tape measure up, looks at it, then looks at the viewer and talks, deadpan, shaking his head slightly.`
- Caption beats: 

**Sound:** A busy bed for the search; cut to a swish and a slow clock for the reveal. (cues: beat, pop, whoosh, air)

**Instagram**
> Twenty minutes. It was on my belt for all twenty.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #tools #construction #carpentry

**TikTok** (isAiGenerated: true)
> Twenty minutes. It was on my belt for all twenty. #contractorlife #contractorhumor #tools #construction #carpentry

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Where is my tape measure? (it was on my belt) #Shorts`
> Twenty minutes. It was on my belt for all twenty.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #contractorhumor #tools #Shorts

### 11. The inspector pulls up

`inspector-pulls-up` · job-site pain · evergreen · 7.3 s with the end tag

**Hook on screen:** “WHEN THE INSPECTOR PULLS UP”

**Shot s1** — 2.4 s of a 5 s generation
- Still prompt (after the character block): `He sits relaxed on an upturned bucket on a tidy jobsite, sipping from a paper coffee cup, one boot stretched out. A framed wall stands behind him.`
- Motion prompt: `He sips his coffee calmly, then suddenly freezes and turns his head sharply toward something off-screen.`
- Caption beats: 0.0 s “WHEN THE INSPECTOR PULLS UP” — orange: INSPECTOR

**Shot s2** — 3.4 s of a 5 s generation
- Still prompt (after the character block): `He stands perfectly upright on the spotless jobsite with a push broom held like a staff, chest out, the framed wall behind him perfectly square, everything neatly stacked, a proud closed-mouth smile.`
- Motion prompt: `He sweeps one last perfectly clean stroke with the push broom, then stands to attention with the broom upright and nods once, proud.`
- Caption beats: 0.1 s “ALREADY READY.” — orange: READY.

**Sound:** Quiet morning air, a swish on the head turn, then a proud little march and a bell. (cues: air, whoosh, beat, ding)

**Instagram**
> No panic. The work was right before the truck pulled in.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #construction #contractorlife #buildinginspection #generalcontractor #contractorhumor

**TikTok** (isAiGenerated: true)
> No panic. The work was right before the truck pulled in. #construction #contractorlife #buildinginspection #generalcontractor #contractorhumor

**LinkedIn**
> The inspections that go quickly are the ones where nothing had to be tidied when the truck pulled in. Do it right while nobody is looking, and inspection day is just another Tuesday.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #construction #contractorlife #buildinginspection

**YouTube Shorts** (containsSyntheticMedia: true) — title: `When the inspector pulls up (already ready) #Shorts`
> No panic. The work was right before the truck pulled in.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #construction #contractorlife #buildinginspection #Shorts

### 12. 11:59 on the jobsite

`lunch-1159` · job-site pain · evergreen · 7.1 s with the end tag

**Hook on screen:** “11:59 AM.”

**Shot s1** — 2.4 s of a 5 s generation
- Still prompt (after the character block): `He holds a spirit level against a wooden post on a sunny jobsite, concentrating hard, snout close to the level.`
- Motion prompt: `He holds the level steady against the post, concentrating. Then his head snaps up as if he has heard something.`
- Caption beats: 0.0 s “11:59 AM.” — orange: 11:59

**Shot s2** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `He sits on the open tailgate of a generic unmarked orange pickup truck, parked, legs dangling, happily holding an enormous sandwich in both hands, a lunch cooler beside him.`
- Motion prompt: `He sits on the tailgate swinging his boots, takes a big happy bite of the enormous sandwich and chews, content.`
- Caption beats: 0.1 s “12:00 PM.” — orange: 12:00

**Sound:** A clock ticking toward noon; a bell on the cut and an easy bed for lunch. (cues: tick, air, ding, beat)

**Instagram**
> Nobody on this earth moves faster than a crew at noon.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #lunchbreak #construction #bluecollar #contractorhumor

**TikTok** (isAiGenerated: true)
> Nobody on this earth moves faster than a crew at noon. #contractorlife #lunchbreak #construction #bluecollar #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `11:59 AM vs 12:00 PM on the jobsite #Shorts`
> Nobody on this earth moves faster than a crew at noon.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #lunchbreak #construction #Shorts

### 13. Measure twice, cut once

`measure-twice` · job-site pain · evergreen · 7.7 s with the end tag

**Hook on screen:** “MEASURE TWICE. CUT ONCE.”

**Shot s1** — 3 s of a 5 s generation
- Still prompt (after the character block): `At a pair of sawhorses outdoors he bends over a long wooden board, measuring it carefully with an orange tape measure, a carpenter's pencil in his other hand.`
- Motion prompt: `He measures the board carefully with the tape, marks it with the pencil, then measures it a second time and nods.`
- Caption beats: 0.0 s “MEASURE TWICE. CUT ONCE.” — orange: TWICE.

**Shot s2** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `He holds a cut wooden board up across an open doorway frame; the board is clearly a hand's width too short and does not reach the other side. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `He holds the too-short board against the opening, looks at the gap, then slowly turns his head to the viewer, deadpan.`
- Caption beats: 0.2 s “STILL SHORT.” — orange: SHORT.

**Sound:** A patient bed with two pencil ticks; a thud and the “wah-wah”. (cues: beat, tick, thud, sad)

**Instagram**
> Measured twice. Cut once. Read the tape wrong both times.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #woodworking #contractorlife #contractorhumor #construction

**TikTok** (isAiGenerated: true)
> Measured twice. Cut once. Read the tape wrong both times. #carpentry #woodworking #contractorlife #contractorhumor #construction

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Measure twice, cut once… still short #Shorts`
> Measured twice. Cut once. Read the tape wrong both times.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #woodworking #contractorlife #Shorts

### 14. First cold morning of the season

`first-cold-morning` · job-site pain · trend / season dependent — Seasonal: the first frosty week of autumn. · 7.5 s with the end tag

**Hook on screen:** “FIRST COLD MORNING OF THE SEASON”

**Shot s1** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `At dawn he scrapes thick frost off the windscreen of a generic unmarked orange pickup truck with a tiny plastic card, bundled in a thick scarf over his hoodie, his breath a big white cloud.`
- Motion prompt: `He scrapes a small patch of frost off the windscreen with the tiny card, breath puffing out in white clouds. He pauses and looks at how much frost is left.`
- Caption beats: 0.0 s “FIRST COLD MORNING OF THE SEASON” — orange: COLD

**Shot s2** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `He sits in the driver's seat of the parked a generic unmarked orange pickup truck, seen through the side window, hunched over a steaming paper coffee cup held in both hands, a small clear patch scraped in the frosted windscreen.`
- Motion prompt: `He sits hunched and still, holding the steaming coffee close, a tiny shiver running through him. Steam rises from the cup.`
- Caption beats: 0.1 s “FIVE MORE MINUTES.” — orange: FIVE

**Sound:** Cold wind and scraping; then a quiet cab and a slow clock. (cues: air, pop, tick)

**Instagram**
> The scraper is in the other truck. It is always in the other truck.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #bluecollar #wintermorning #contractorhumor

**TikTok** (isAiGenerated: true)
> The scraper is in the other truck. It is always in the other truck. #contractorlife #construction #bluecollar #wintermorning #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `First cold morning of the season (jobsite edition) #Shorts`
> The scraper is in the other truck. It is always in the other truck.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #bluecollar #Shorts

### 15. The phone rings on the ladder

`phone-on-the-ladder` · job-site pain · evergreen · 7.5 s with the end tag

**Hook on screen:** “PHONE RINGS. YOU'RE ON THE LADDER.”

**Shot s1** — 3 s of a 5 s generation
- Still prompt (after the character block): `He stands on a stepladder beside a house wall, three points of contact: both boots on a rung and one hand gripping the ladder, a paintbrush in the other hand. A phone in his chest pocket glows and shakes with small vibration lines.`
- Motion prompt: `The phone in his pocket buzzes and glows. He glances down at it, shakes his head calmly and keeps hold of the ladder.`
- Caption beats: 0.0 s “PHONE RINGS. YOU'RE ON THE LADDER.” — orange: LADDER.

**Shot s2** — 3 s of a 5 s generation
- Still prompt (after the character block): `He stands on the ground beside the stepladder, both boots on the grass, holding the phone to the side of his head, relaxed, one hand on his hip.`
- Motion prompt: `Standing on the ground, he lifts the phone to the side of his head and nods along, relaxed.`
- Caption beats: 0.1 s “IT CAN WAIT TILL I'M DOWN.” — orange: DOWN.

**Sound:** A buzzing phone over quiet air; a bell and an easy bed once his boots are on the ground. (cues: tick, air, ding, beat)

**Instagram**
> Nobody's call is worth the fall. Boots on the ground first.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #laddersafety #contractorlife #construction #safetyfirst #painting

**TikTok** (isAiGenerated: true)
> Nobody's call is worth the fall. Boots on the ground first. #laddersafety #contractorlife #construction #safetyfirst #painting

**LinkedIn**
> Most calls on a jobsite arrive at the worst moment. The habit worth having is the boring one: climb down, then answer. A missed call costs a minute.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #laddersafety #contractorlife #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Phone rings while you're on the ladder #Shorts`
> Nobody's call is worth the fall. Boots on the ground first.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #laddersafety #contractorlife #construction #Shorts

### 16. A quick question at 9:47 PM

`quick-question-947` · job-site pain · evergreen · 7.5 s with the end tag

**Hook on screen:** “9:47 PM: “QUICK QUESTION…””

**Shot s1** — 3 s of a 5 s generation
- Still prompt (after the character block): `At night he sits sunk into a big armchair in a cosy living room, still in his full work gear and hard hat, boots up on a footstool, a blanket over his knees. A phone on the armrest lights up, glowing, showing nothing readable.`
- Motion prompt: `He dozes in the armchair. The phone on the armrest lights up and buzzes. His head lifts slowly.`
- Caption beats: 0.0 s “9:47 PM: “QUICK QUESTION…”” — orange: “QUICK

**Shot s2** — 3 s of a 5 s generation
- Still prompt (after the character block): `In the same armchair he holds the glowing phone in both hands and types with his thumbs, a small tired smile, the blanket still on his knees.`
- Motion prompt: `He types on the phone with both thumbs, nodding slightly, a small tired smile.`
- Caption beats: 0.1 s “ME, ANSWERING ANYWAY.” — orange: ANYWAY.

**Sound:** A sleepy room, one notification bell, then soft key taps. (cues: air, ding, tick)

**Instagram**
> It's never quick. I'm answering anyway. That's the job.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #smallbusiness #construction #contractorhumor #remodeling

**TikTok** (isAiGenerated: true)
> It's never quick. I'm answering anyway. That's the job. #contractorlife #smallbusiness #construction #contractorhumor #remodeling

**LinkedIn**
> The evening “quick question” is a sign of trust, and answering it well is part of the service. It is also why the answers belong in one place tomorrow morning — not in a text thread nobody can find in June.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #smallbusiness #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `9:47 PM: “quick question about the tile” #Shorts`
> It's never quick. I'm answering anyway. That's the job.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #smallbusiness #construction #Shorts

### 17. The coffee ran out at 7:15

`coffee-ran-out` · job-site pain · evergreen · 9.5 s with the end tag

**Hook on screen:** “7:15 AM. THE COFFEE IS GONE.”

**Shot s1** — 3.4 s of a 5 s generation
- Still prompt (after the character block): `On an early-morning jobsite he holds a steel thermos upside down above a paper cup, peering up into it. One single drop hangs from the thermos.`
- Motion prompt: `He shakes the upside-down thermos. One single drop falls into the cup. He peers into the thermos, then into the cup.`
- Caption beats: 0.0 s “7:15 AM. THE COFFEE IS GONE.” — orange: GONE.

**Shot s2** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `On an early-morning jobsite he holds an empty paper cup in one hand and a steel thermos hanging from the other. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `He looks into the empty cup, then at the viewer, and talks, deadpan and tired. A light wind moves a scrap of paper across the ground behind him.`
- Caption beats: 

**Sound:** Morning air, one drip, then the “wah-wah”. (cues: air, tick)

**Instagram**
> Some losses you feel all day.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #coffee #construction #bluecollar #contractorhumor

**TikTok** (isAiGenerated: true)
> Some losses you feel all day. #contractorlife #coffee #construction #bluecollar #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `7:15 AM and the coffee is already gone #Shorts`
> Some losses you feel all day.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #coffee #construction #Shorts

### 18. The dumpster on day three

`dumpster-day-three` · job-site pain · evergreen · 7.5 s with the end tag

**Hook on screen:** ““ONE DUMPSTER WILL BE PLENTY.””

**Shot s1** — 2.6 s of a 5 s generation
- Still prompt (after the character block): `He stands beside a large plain, unmarked, empty skip in a driveway, patting its side confidently, a demolition site behind him.`
- Motion prompt: `He pats the side of the empty skip confidently and nods.`
- Caption beats: 0.0 s ““ONE DUMPSTER WILL BE PLENTY.”” — orange: PLENTY.”

**Shot s2** — 3.4 s of a 5 s generation
- Still prompt (after the character block): `The same plain skip is now heaped far above its rim with broken drywall, old boards and cardboard. He stands on the ground beside it holding one more short board, looking up at the heap.`
- Motion prompt: `He looks up at the towering heap, then very gently places one more board on the edge of the pile and tiptoes backward. The heap wobbles slightly and holds.`
- Caption beats: 0.1 s “DAY THREE.” — orange: THREE.

**Sound:** A confident bed and a pat; tiptoe ticks and a relieved bell when it holds. (cues: thud, beat, tick, ding)

**Instagram**
> Demo always finds more house than the plans promised.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #demolition #remodeling #contractorlife #construction #contractorhumor

**TikTok** (isAiGenerated: true)
> Demo always finds more house than the plans promised. #demolition #remodeling #contractorlife #construction #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `“One dumpster will be plenty” (day three) #Shorts`
> Demo always finds more house than the plans promised.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #demolition #remodeling #contractorlife #Shorts

### 19. POV: first one on site

`pov-first-on-site` · POV · evergreen — The POV label is a trend format; the scene is evergreen. · 6.1 s with the end tag

**Hook on screen:** “POV: FIRST ONE ON SITE”

**Shot s1** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `At sunrise he stands alone on a quiet, empty building lot beside a generic unmarked orange pickup truck, holding a paper coffee cup, looking out at a golden sky, mist over the ground, a framed house in silhouette.`
- Motion prompt: `He takes a slow sip of coffee and breathes out, looking at the sunrise. Mist drifts over the ground. The light slowly brightens. Peaceful.`
- Caption beats: 0.0 s “POV: FIRST ONE ON SITE” — orange: FIRST · 2.6 s (low) “QUIETEST PART OF THE DAY.” — orange: DAY.

**Sound:** Just dawn air and one soft bell — the quiet is the point. (cues: air, ding)

**Instagram**
> Twenty minutes before the saws start. Nobody tell the others.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #sunrise #bluecollar #jobsite

**TikTok** (isAiGenerated: true)
> Twenty minutes before the saws start. Nobody tell the others. #contractorlife #construction #sunrise #bluecollar #jobsite

**LinkedIn**
> The first twenty minutes on site, before the saws start, are when the day gets planned. It is the quietest meeting of the week.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #construction #sunrise

**YouTube Shorts** (containsSyntheticMedia: true) — title: `POV: you're the first one on site #Shorts`
> Twenty minutes before the saws start. Nobody tell the others.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #construction #sunrise #Shorts

### 20. POV: the bubble is dead centre

`pov-bubble-dead-centre` · POV · evergreen · 5.9 s with the end tag

**Hook on screen:** “POV: THE BUBBLE IS DEAD CENTRE”

**Shot s1** — 4.4 s of a 5 s generation
- Still prompt (after the character block): `Close-up: a yellow spirit level rests on a wooden beam, its bubble sitting exactly between the two lines. His face is right beside the level, snout low to the beam, a slow satisfied smile.`
- Motion prompt: `The bubble in the spirit level drifts slightly and settles exactly in the centre. He watches it, then slowly smiles and nods. Slow push-in on the bubble.`
- Caption beats: 0.0 s “POV: THE BUBBLE IS DEAD CENTRE” — orange: DEAD · 2.8 s (low) “FIRST TRY.” — orange: FIRST

**Sound:** Quiet, then one bright bell as the bubble settles. (cues: air, ding)

**Instagram**
> No shims. No second look. Just centre.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #satisfying #construction #contractorlife #framing

**TikTok** (isAiGenerated: true)
> No shims. No second look. Just centre. #carpentry #satisfying #construction #contractorlife #framing

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `POV: the bubble is dead centre, first try #Shorts`
> No shims. No second look. Just centre.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #satisfying #construction #Shorts

### 21. POV: zero punch list

`pov-zero-punch-list` · POV · evergreen · 7.1 s with the end tag

**Hook on screen:** “POV: FINAL WALKTHROUGH. ZERO PUNCH LIST.”

**Shot s1** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `He walks through a bright, finished, empty kitchen with new cabinets and a clean floor, holding a clipboard whose page shows only a column of green tick marks and no writing.`
- Motion prompt: `He walks slowly through the finished kitchen, looking around, running one hand along the countertop, glancing at the clipboard.`
- Caption beats: 0.0 s “POV: FINAL WALKTHROUGH. ZERO PUNCH LIST.” — orange: ZERO

**Shot s2** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `In the same finished kitchen he stands with one fist raised in a small, restrained fist pump, the clipboard under his arm, a proud closed-mouth grin.`
- Motion prompt: `He does one small, restrained fist pump and nods, proud.`
- Caption beats: 0.1 s “NOTHING. NOT ONE THING.” — orange: NOTHING.

**Sound:** An easy walking bed; a bell on the fist pump. (cues: beat, ding)

**Instagram**
> It happens about twice a career. Let me have this.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #remodeling #contractorlife #construction #kitchenremodel #generalcontractor

**TikTok** (isAiGenerated: true)
> It happens about twice a career. Let me have this. #remodeling #contractorlife #construction #kitchenremodel #generalcontractor

**LinkedIn**
> A walkthrough with an empty punch list is not luck. It is every small thing closed out the day it was noticed, instead of saved for the end.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #remodeling #contractorlife #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `POV: final walkthrough with zero punch list #Shorts`
> It happens about twice a career. Let me have this.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #remodeling #contractorlife #construction #Shorts

### 22. POV: you finally organised the truck

`pov-organised-truck` · POV · evergreen · 7.3 s with the end tag

**Hook on screen:** “POV: YOU FINALLY ORGANISED THE TRUCK”

**Shot s1** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `He stands at the open tailgate of a generic unmarked orange pickup truck, presenting the truck bed with both hands: every tool in its own tray, boxes lined up, hoses coiled, a soft golden glow over it all.`
- Motion prompt: `He presents the perfectly organised truck bed with a proud sweep of his hand. A soft golden glow shimmers over the tools.`
- Caption beats: 0.0 s “POV: YOU FINALLY ORGANISED THE TRUCK” — orange: ORGANISED

**Shot s2** — 3 s of a 5 s generation
- Still prompt (after the character block): `He stands at the same open tailgate of a generic unmarked orange pickup truck, now a jumble of tangled extension cords, loose tools, empty paper cups and offcuts, scratching the back of his hard hat.`
- Motion prompt: `He looks at the jumbled truck bed and slowly scratches the back of his hard hat. A paper cup rolls off the tailgate.`
- Caption beats: 0.1 s “DAY TWO.” — orange: TWO.

**Sound:** A heavenly bell over the tidy bed; a thud and the “wah-wah” a day later. (cues: ding, air, thud, sad)

**Instagram**
> It was beautiful. For about nine hours.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #tools #truckorganization #construction #contractorhumor

**TikTok** (isAiGenerated: true)
> It was beautiful. For about nine hours. #contractorlife #tools #truckorganization #construction #contractorhumor

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `POV: you finally organised the truck (day two) #Shorts`
> It was beautiful. For about nine hours.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #tools #truckorganization #Shorts

### 23. POV: inspection passed, first try

`pov-passed-first-try` · POV · evergreen · 6.1 s with the end tag

**Hook on screen:** “POV: PASSED INSPECTION. FIRST TRY.”

**Shot s1** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `Inside a newly framed house he stands beside a wall stud that has a plain bright-green tag with nothing written on it stapled to it, arms crossed, a slow proud nod, sunlight through the framing.`
- Motion prompt: `He looks at the plain green tag on the stud, crosses his arms and nods slowly, proud. Sunbeams and dust drift through the framing. Slow push-in.`
- Caption beats: 0.0 s “POV: PASSED INSPECTION. FIRST TRY.” — orange: PASSED · 2.8 s (low) “ON TO THE NEXT ONE.” — orange: NEXT

**Sound:** A bell and a steady, proud bed. (cues: ding, beat)

**Instagram**
> Green tag. No notes. We ride at dawn.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #construction #framing #buildinginspection #contractorlife #generalcontractor

**TikTok** (isAiGenerated: true)
> Green tag. No notes. We ride at dawn. #construction #framing #buildinginspection #contractorlife #generalcontractor

**LinkedIn**
> Passing first time is mostly paperwork done early: the right permit, the right office, the inspection booked before the wall is closed. The framing is the easy part.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #construction #framing #buildinginspection

**YouTube Shorts** (containsSyntheticMedia: true) — title: `POV: passed inspection on the first try #Shorts`
> Green tag. No notes. We ride at dawn.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #construction #framing #buildinginspection #Shorts

### 24. One snap of the chalk line

`chalk-line-snap` · satisfying work · evergreen · 5.9 s with the end tag

**Hook on screen:** “CHALK LINE. ONE SNAP.”

**Shot s1** — 4.4 s of a 5 s generation
- Still prompt (after the character block): `He kneels on a clean plywood subfloor inside a framed house, holding a chalk line stretched tight across the floor with one hand, pinching the string up in the middle with the other, about to snap it.`
- Motion prompt: `He lifts the tight string and lets it snap down. A puff of blue chalk dust jumps up and a perfectly straight blue line is left across the plywood. He nods.`
- Caption beats: 0.0 s “CHALK LINE. ONE SNAP.” — orange: SNAP. · 2.6 s (low) “DEAD STRAIGHT.” — orange: STRAIGHT.

**Sound:** Silence, one crisp snap, a bell. (cues: air, pop, ding)

**Instagram**
> The most satisfying sound in framing. Fight me (politely).
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #framing #satisfying #construction #contractorlife

**TikTok** (isAiGenerated: true)
> The most satisfying sound in framing. Fight me (politely). #carpentry #framing #satisfying #construction #contractorlife

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Chalk line, one snap, dead straight #Shorts`
> The most satisfying sound in framing. Fight me (politely).
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #carpentry #framing #satisfying #Shorts

### 25. Deck boards, one after another

`deck-boards-rhythm` · satisfying work · evergreen · 8.1 s with the end tag

**Hook on screen:** “DECK BOARDS. ONE AFTER ANOTHER.”

**Shot s1** — 4.2 s of a 5 s generation
- Still prompt (after the character block): `He kneels on a half-built wooden deck in a back garden, driving a screw into a deck board with a cordless drill, a row of evenly spaced boards behind him and bare joists ahead.`
- Motion prompt: `He drives a screw with the drill, shifts along, drives the next, shifts along, in an even rhythm. The camera slides along the deck with him.`
- Caption beats: 0.0 s “DECK BOARDS. ONE AFTER ANOTHER.” — orange: ANOTHER.

**Shot s2** — 2.4 s of a 5 s generation
- Still prompt (after the character block): `He stands on the finished wooden deck with his arms crossed, every board evenly spaced and every screw in a straight line, evening sun.`
- Motion prompt: `Arms crossed, he looks along the perfectly even deck boards and nods. Slow pull back.`
- Caption beats: 0.1 s “EVEN GAPS. EVERY ONE.” — orange: EVEN

**Sound:** Drill hits on the beat; a bell on the finished deck. (cues: pop, beat, ding, air)

**Instagram**
> Same gap. Same line. Forty boards. No thoughts.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #deckbuilding #carpentry #satisfying #construction #contractorlife

**TikTok** (isAiGenerated: true)
> Same gap. Same line. Forty boards. No thoughts. #deckbuilding #carpentry #satisfying #construction #contractorlife

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Deck boards, one after another (satisfying) #Shorts`
> Same gap. Same line. Forty boards. No thoughts.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #deckbuilding #carpentry #satisfying #Shorts

### 26. One pass, no drips

`one-pass-no-drips` · satisfying work · evergreen · 6.1 s with the end tag

**Hook on screen:** “ONE PASS. NO DRIPS.”

**Shot s1** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `In an empty room with dust sheets on the floor he rolls a paint roller on an extension pole up a wall, standing on the floor, leaving a clean wide stripe of fresh sage-green paint on a pale wall.`
- Motion prompt: `He rolls the paint roller smoothly up and down the wall, leaving clean, even stripes of fresh paint that join without a mark. Calm and steady.`
- Caption beats: 0.0 s “ONE PASS. NO DRIPS.” — orange: DRIPS. · 3.0 s (low) “CUT IN. ROLL OUT. DONE.” — orange: DONE.

**Sound:** Soft roller swishes over a slow bed. (cues: whoosh, beat)

**Instagram**
> Paint that goes on like this is 90% prep. The gator did the prep.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #painting #satisfying #housepainter #contractorlife #remodeling

**TikTok** (isAiGenerated: true)
> Paint that goes on like this is 90% prep. The gator did the prep. #painting #satisfying #housepainter #contractorlife #remodeling

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `One pass, no drips (gator painting) #Shorts`
> Paint that goes on like this is 90% prep. The gator did the prep.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #painting #satisfying #housepainter #Shorts

### 27. Smooth

`smooth-concrete` · satisfying work · evergreen · 6.1 s with the end tag

**Hook on screen:** “SMOOTH.”

**Shot s1** — 4.6 s of a 5 s generation
- Still prompt (after the character block): `He kneels on kneeboards at the edge of a fresh grey concrete slab, sweeping a steel trowel across it in a wide arc, the surface behind the trowel glassy and reflecting the sky.`
- Motion prompt: `He sweeps the steel trowel across the wet concrete in slow, wide arcs. Behind the trowel the surface turns glassy smooth and reflects the sky. Slow push-in.`
- Caption beats: 0.0 s “SMOOTH.” — orange: SMOOTH. · 3.0 s (low) “DO NOT WALK ON IT.” — orange: NOT

**Sound:** Slow trowel swishes and open air. (cues: whoosh, air)

**Instagram**
> Glass. Do not walk on it. Yes, that includes the dog.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #concrete #satisfying #concretelife #construction #contractorlife

**TikTok** (isAiGenerated: true)
> Glass. Do not walk on it. Yes, that includes the dog. #concrete #satisfying #concretelife #construction #contractorlife

**LinkedIn** — skipped: the joke does not belong there.

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Smooth. (gator finishing concrete) #Shorts`
> Glass. Do not walk on it. Yes, that includes the dog.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #concrete #satisfying #concretelife #Shorts

### 28. The cleanest jobsite on the street

`cleanest-jobsite` · satisfying work · evergreen · 7.3 s with the end tag

**Hook on screen:** “END OF DAY. CLEANEST SITE ON THE STREET.”

**Shot s1** — 3.2 s of a 5 s generation
- Still prompt (after the character block): `At golden hour he pushes a wide push broom across a driveway, a neat line of sawdust ahead of the broom and spotless concrete behind it, tools stacked tidily by the garage.`
- Motion prompt: `He pushes the broom in long, even strokes. Sawdust gathers in a neat line ahead of it, leaving spotless concrete behind.`
- Caption beats: 0.0 s “END OF DAY. CLEANEST SITE ON THE STREET.” — orange: CLEANEST

**Shot s2** — 2.6 s of a 5 s generation
- Still prompt (after the character block): `He stands on the spotless driveway leaning on the push broom, tools stacked neatly, the house tidy behind him, a satisfied closed-mouth smile, warm evening light.`
- Motion prompt: `He leans on the broom, looks over the spotless driveway and nods once, satisfied.`
- Caption beats: 0.1 s “THAT'S THE REFERENCE.” — orange: REFERENCE.

**Sound:** Broom swishes on a slow bed; a bell at the end. (cues: whoosh, beat, ding, air)

**Instagram**
> The neighbours notice the broom before they notice the work. Sweep.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #satisfying #construction #remodeling #generalcontractor

**TikTok** (isAiGenerated: true)
> The neighbours notice the broom before they notice the work. Sweep. #contractorlife #satisfying #construction #remodeling #generalcontractor

**LinkedIn**
> A swept driveway at five o'clock is the cheapest marketing a contractor does. The neighbours are the next three jobs, and they are watching the kerb, not the framing.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #satisfying #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `End of day: the cleanest jobsite on the street #Shorts`
> The neighbours notice the broom before they notice the work. Sweep.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #satisfying #construction #Shorts

### 29. Finding the permit office in seconds

`permit-office-in-seconds` · product tie-in · evergreen · 9.3 s with the end tag

**Hook on screen:** “WHICH OFFICE HANDLES THIS PERMIT?”

**Shot s1** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `He stands at the bonnet of a generic unmarked orange pickup truck with a large blank paper map spread across it, the map showing only plain shapes and no writing, scratching the back of his hard hat, puzzled.`
- Motion prompt: `He looks over the big paper map, turning it one way and then the other, and scratches the back of his hard hat, puzzled.`
- Caption beats: 0.0 s “WHICH OFFICE HANDLES THIS PERMIT?” — orange: PERMIT?

**Shot s2** — 5 s of a 5 s generation
- Still prompt (after the character block): `He leans against a generic unmarked orange pickup truck holding a phone in one hand, its screen a soft plain glow with nothing readable; a folded paper map lies on the bonnet. He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.`
- Motion prompt: `He glances at the glowing phone, nods, then looks at the viewer and talks, dry and matter-of-fact, ending with a small shrug.`
- Caption beats: 

**Sound:** A puzzled clock; a bell and an easy bed when he finds it. (cues: tick, air, ding)

**Instagram**
> City or county? Which portal? Look the permit office up before you drive — the directory is at constructhub.us.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #buildingpermit #contractorlife #construction #generalcontractor #permits

**TikTok** (isAiGenerated: true)
> City or county? Which portal? Look the permit office up before you drive — the directory is at constructhub.us. #buildingpermit #contractorlife #construction #generalcontractor #permits

**LinkedIn**
> Half the time lost on a permit is spent finding out who issues it: the city, the county, or a portal with a different name. The ConstructHUB directory lists permit offices and portals by city and county, so the first call goes to the right counter.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #buildingpermit #contractorlife #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Which office handles this permit? Found it in seconds #Shorts`
> City or county? Which portal? Look the permit office up before you drive — the directory is at constructhub.us.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #buildingpermit #contractorlife #construction #Shorts

### 30. Sending the estimate from the truck

`estimate-from-the-truck` · product tie-in · evergreen · 7.3 s with the end tag

**Hook on screen:** “ESTIMATE SENT. STILL IN THE DRIVEWAY.”

**Shot s1** — 3 s of a 5 s generation
- Still prompt (after the character block): `He sits in the driver's seat of the parked a generic unmarked orange pickup truck, engine off, door open, seen from outside, tapping a phone with one thumb, a steaming paper coffee cup on the dashboard. A house and its front garden are behind the truck.`
- Motion prompt: `Sitting in the parked truck, he taps the phone a few times with his thumb, then gives one firm final tap and nods.`
- Caption beats: 0.0 s “ESTIMATE SENT. STILL IN THE DRIVEWAY.” — orange: SENT.

**Shot s2** — 2.8 s of a 5 s generation
- Still prompt (after the character block): `In the same parked a generic unmarked orange pickup truck he leans back in the seat and picks up the steaming paper coffee cup, relaxed, a satisfied closed-mouth smile.`
- Motion prompt: `He leans back, picks up the coffee, takes a calm sip and breathes out, relaxed. Steam rises from the cup.`
- Caption beats: 0.1 s “COFFEE'S STILL HOT.” — orange: HOT.

**Sound:** Thumb taps, a send swish and bell; an easy bed for the coffee. (cues: tick, whoosh, ding, beat)

**Instagram**
> Walk the job, price the job, send the estimate before you back out of the driveway. Estimates live in the ConstructHUB CRM — a separate product with its own plans.
> 
> ConstructHUB — run the whole job. Link in bio · constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #estimating #construction #smallbusiness #generalcontractor

**TikTok** (isAiGenerated: true)
> Walk the job, price the job, send the estimate before you back out of the driveway. Estimates live in the ConstructHUB CRM — a separate product with its own plans. #contractorlife #estimating #construction #smallbusiness #generalcontractor

**LinkedIn**
> The estimate that arrives while the contractor is still in the driveway wins more often than the better one that arrives on Thursday. Building it on the phone, from the job just walked, is the whole trick. (Estimates are part of the ConstructHUB CRM, a separate product with its own plans.)
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> (AI-generated animation of our mascot.)
> 
> #contractorlife #estimating #construction

**YouTube Shorts** (containsSyntheticMedia: true) — title: `Estimate sent before leaving the driveway #Shorts`
> Walk the job, price the job, send the estimate before you back out of the driveway. Estimates live in the ConstructHUB CRM — a separate product with its own plans.
> 
> ConstructHUB — run the whole job. https://constructhub.us
> 
> AI-generated animation of our mascot.
> 
> #contractorlife #estimating #construction #Shorts
