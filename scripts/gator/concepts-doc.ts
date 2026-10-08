/**
 * Write docs/gator/CONCEPTS.md from concepts.ts — the writers' room is data, the document is its print-out.
 *
 *   npx tsx scripts/gator/concepts-doc.ts            write the file
 *   npx tsx scripts/gator/concepts-doc.ts --check    exit 1 when the file is not what the data says
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../tutorials/lib";
import { AI_NOTE, CHARACTER, CONCEPTS, FRAMING, MOTION_STYLE, NEGATIVE, lintConcept, postsOf, type Concept } from "./concepts";
import { PILOT, pilotCap } from "./higgsfield";
import { END_TAG_SEC } from "./layout";
import { VIRAL_RULES } from "./stream";

export const DOC = path.join(ROOT, "docs", "gator", "CONCEPTS.md");
const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");
const cueWords = (c: Concept) => [...new Set(c.shots.flatMap((s) => s.cues.map((q) => q.type)))].join(", ");

function conceptMd(c: Concept, n: number): string {
  const p = postsOf(c), sec = c.shots.reduce((x, s) => x + s.use, 0);
  const shots = c.shots.map((s) => [
    `**Shot ${s.id}** — ${s.use} s of a 5 s generation${s.shiftDown ? ` (picture moved down ${s.shiftDown} px for the caption)` : ""}`,
    `- Still prompt (after the character block): \`${s.scene}\``,
    `- Motion prompt: \`${s.motion}\``,
    `- Caption beats: ${s.beats.map((b) => `${b.at.toFixed(1)} s ${b.pos === "low" ? "(low) " : ""}“${b.text.toUpperCase()}”${b.accent ? ` — orange: ${b.accent.toUpperCase()}` : ""}`).join(" · ")}`,
    ...(s.bubble ? [`- Speech bubble at ${s.bubble.at} s: “${s.bubble.text}”`] : []),
  ].join("\n")).join("\n\n");
  return `### ${n}. ${c.title}${c.pilot ? " — PILOT, produced" : ""}

\`${c.id}\` · ${c.format} · ${c.evergreen ? "evergreen" : "trend / season dependent"}${c.timing ? ` — ${c.timing}` : ""} · ${(sec + END_TAG_SEC).toFixed(1)} s with the end tag

**Hook on screen:** “${c.hook.toUpperCase()}”

${shots}

**Sound:** ${c.sound} (cues: ${cueWords(c)})

**Instagram**
${quote(p.instagram!.text)}

**TikTok** (isAiGenerated: true)
${quote(p.tiktok!.text)}

**LinkedIn**${p.linkedin ? `\n${quote(p.linkedin.text)}` : " — skipped: the joke does not belong there."}

**YouTube Shorts** (containsSyntheticMedia: true) — title: \`${p.youtube!.title}\`
${quote(p.youtube!.text)}
`;
}

export function conceptsMd(): string {
  for (const c of CONCEPTS) { const bad = lintConcept(c); if (bad.length) throw new Error(`${c.id}: ${bad.join("; ")}`); }
  const cap = pilotCap(new Date(0));
  const one = 2 * (1.6 + PILOT.video.credits), usd = (cr: number) => `$${(cr * 0.0625).toFixed(2)}`;
  const by = (f: Concept["format"]) => CONCEPTS.filter((c) => c.format === f).map((c) => `[${c.title}](#${CONCEPTS.indexOf(c) + 1}-${c.title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")})`).join(" · ");
  return `# Gator shorts — the writers' room

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
- **No one else's audio.** The track is synthesised in \`scripts/gator/sound.ts\` (sines and seeded noise:
  engine hum, nail-gun pops, a bell, a swish, a clock, a plain kick-and-hat bed). The video models' own
  audio is not used. A platform's trending sound can be laid over it by the owner in the app.
- **The product is an end tag.** ${END_TAG_SEC} s: the logo, "Run the whole job.", constructhub.us. The joke lands first.
- **Every clip is AI-generated and labelled so**: TikTok \`isAiGenerated: true\`, YouTube
  \`status.containsSyntheticMedia: true\`, and "${AI_NOTE}" in the Instagram, LinkedIn and YouTube text
  (Blotato exposes no AI field for those two; on Instagram switch on "AI info" in the app after posting).
- \`lintConcept\` (tested) holds every concept to what a machine can check: hook ≤ 8 words, 1–3 shots,
  5–20 s, five hashtags, a harness wherever he is on a roof, no brand names, the AI note in every post.

## How a clip is made

\`\`\`bash
G="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/make.ts"
$G <conceptId> --plan              # free: prompts, estimated cost, the budget
$G <conceptId> --stills            # paid: one scene still per shot — then LOOK at each
$G <conceptId> --retake-still s2   # paid: a still was off-model, had text, or left no room for the caption
$G <conceptId> --videos            # paid: animate the approved stills — then LOOK at the frames
$G <conceptId> --retake-video s1   # paid: a new take of one clip
$G <conceptId> --assemble          # free: cut, captions, logo, end tag, sound, cover.jpg, review.jpg, social.json
$G --ledger                        # the cap, what is spent, every paid call
\`\`\`

Output: \`analysis/gator-shorts/<conceptId>/\` — \`clip.mp4\` (1080×1920, 30 fps, H.264 + AAC, about −14 LUFS),
\`cover.jpg\`, \`review.jpg\` (twelve frames on one sheet), \`social.json\` (per-platform text, hashtags,
\`aiGenerated: true\` and each platform's disclosure), the stills and raw clips of every take.

**Character consistency — what works.** The API has no trained-character feature that fits a cartoon mascot
(Soul ID is for people). The reliable method is two steps:

1. **A scene still drawn by an image-edit model that is handed the mascot's own artwork** — Grok Image 2.0
   (\`${PILOT.image.model}\`) with two references: the full figure and a close-up of the head, both cut from
   \`client/public/mascot/gator-standing-1024.v1.webp\` onto white. Every prompt starts with the same
   character block and ends with the same framing block (below). In the pilot 11 stills were drawn; all 11
   had the right hat, glasses, vest, hoodie, belt, boots and drawing style. 5 were rejected for other reasons:
   garbled lettering on a skip, a second tail lying on a tailgate, a square picture on white bands, a vignette,
   and one whose composition hid his face.
2. **Image-to-video from the approved still** — Kling 2.5 Turbo Standard (\`${PILOT.video.model}\`, 5 s,
   720×1280, 24 fps). It keeps what is in its first frame; he stayed on-model in all 7 clips.

Character block: \`${CHARACTER}\`

Framing block: \`${FRAMING}\`

Motion style (appended to every motion prompt): \`${MOTION_STYLE}\` Negative prompt: \`${NEGATIVE}\`

**Captions.** Bundled Anton capitals, white with a black edge, one word in the brand orange (#f97316), popping
in over three frames. Two zones (\`ZONES\` in \`layout.ts\`, tested against the tutorials' \`SAFE_AREA\`): *top*,
under the platform's tabs; *low*, above the platform's caption and clear of the like / comment / share column.
A beat that does not fit at 64 px or more is refused, not shrunk. The small CHUB logo sits bottom-left of the
safe area. Stills must leave the **top third** empty for the hook; when one does not, \`shiftDown\` moves the
picture down and mirrors the sky into the gap.

## Money

Higgsfield (\`https://api.higgsfield.ai\`, \`Authorization: Key <id>:<secret>\`) prices every call with a free
\`POST /estimate/{model}\`; 1 credit = $0.0625. Prices on 2026-10-08 for this account:

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

- **The cap** is in the ledger and enforced in code (\`assertWithinBudget\`): ${cap.credits} credits ($${cap.usd.toFixed(2)}) —
  ${PILOT.videos} videos × ${PILOT.video.credits} + ${PILOT.images} images × ${PILOT.image.credits}, set before the first paid call. A call that would pass it is
  refused before anything is sent. To raise it, edit \`cap\` in \`analysis/gator-shorts/ledger.json\` on purpose.
- **Never twice.** Each shot take has one ledger entry, written before the request leaves; a repeat run asks
  for nothing that is finished, polls what is in flight, and re-sends a lost request with the same
  \`Idempotency-Key\` (Higgsfield returns the first request). A changed prompt is a new take, by flag.
- **There is no balance endpoint** in the API (the balance is on console.higgsfield.ai only), so the ledger's
  own sum is the record of what this tool spent. Failed, moderated and cancelled requests are not charged.
- **The pilot** (2026-10-08): 11 stills + 7 clips = 41.12 credits = **$2.57** for three finished clips.
- **Per clip:** two shots, one take of everything = ${one.toFixed(2)} credits = **${usd(one)}**. At the pilot's retake
  rate (about 1.4 takes a shot) ≈ 13.7 credits = **$0.86**. **One clip a day ≈ ${usd(one * 30)}–$26 a month.**

## The pilot, honestly (2026-10-08)

Three clips, 7.9 s each, in \`analysis/gator-shorts/\` (git-ignored): \`two-day-job\`, \`shingle-rhythm\`,
\`while-youre-here\`. He is recognisably our gator in every frame looked at. What is still off:

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

The owner's cadence (2026-10-08), in code in \`scripts/tutorials/social-rate.ts\` (shared by both streams) and
\`scripts/gator/stream.ts\`, tested:

- **YouTube gets every walkthrough and no gator clips.** (The Shorts code is kept, switched off.)
- **TikTok, Instagram and LinkedIn: one tutorial cut and ${VIRAL_RULES.perDay} gator clips a day per account**, at least two
  hours apart: gator 07:30–08:15, the tutorial 10:15–11:00, gator 13:00–13:30, gator 18:30–20:30 Eastern; the
  minute moves every day. LinkedIn on weekdays keeps to business hours (08:00–08:15, 13:00–13:30,
  15:30–17:30) and at the weekend gets the tutorial and one gator clip; it only gets the tame clips.
- **Four posts a day per account**; if LinkedIn ("share limit") or Instagram ("account is restricted") refuses
  a post, that account drops to two a day for 48 hours and the refused clip moves to the next free slot,
  never sooner than 12 hours later.
- **Its own ledger**: \`docs/gator/viral-schedule.json\`, entries marked \`stream: "viral"\`; a clip goes to an
  account once.
- **Order**: evergreen concepts in the order below, a satisfying-work clip after every two jokes; the
  season / day-of-week ones when their note says.

\`\`\`bash
npx tsx scripts/tutorials/social-post.ts --stream viral            # DRY RUN: every finished clip × account — when, caption, request
npx tsx scripts/tutorials/social-post.ts --stream viral --go       # refused: the viral stream is not switched on
\`\`\`

Before it can be switched on: the owner approves the clips; the clips are uploaded to R2 (the tutorials'
media route serves \`gator-<id>.social-vertical.<hash>.mp4\` only once its name pattern is checked); the send
path writes the viral ledger before each request, as the tutorial poster does.

## The thirty concepts

- **Job-site pain:** ${by("job-site pain")}
- **POV:** ${by("POV")}
- **Satisfying work:** ${by("satisfying work")}
- **Product tie-ins:** ${by("product tie-in")}

Evergreen: ${CONCEPTS.filter((c) => c.evergreen).length}. Trend / season dependent: ${CONCEPTS.filter((c) => !c.evergreen).map((c) => c.title).join("; ")}. The "POV:" label
and the "X vs Y" split are formats that travel now and will date; the scenes under them do not.

${CONCEPTS.map((c, i) => conceptMd(c, i + 1)).join("\n")}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const md = conceptsMd();
  if (process.argv.includes("--check")) { if (!fs.existsSync(DOC) || fs.readFileSync(DOC, "utf8") !== md) { console.error("docs/gator/CONCEPTS.md is not what concepts.ts says — run scripts/gator/concepts-doc.ts"); process.exit(1); } console.log("docs/gator/CONCEPTS.md is up to date"); }
  else { fs.mkdirSync(path.dirname(DOC), { recursive: true }); fs.writeFileSync(DOC, md); console.log(`${path.relative(ROOT, DOC)}  ${CONCEPTS.length} concepts, ${md.length} characters`); }
}
