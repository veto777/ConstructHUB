/**
 * The gator shorts' writers' room, as data. docs/gator/CONCEPTS.md is written FROM this file
 * (`npx tsx scripts/gator/concepts-doc.ts`), make.ts produces a clip from one entry, and
 * server/tutorials/gator.test.ts holds every entry to the house rules below.
 *
 * HOUSE RULES (the owner's brief, 2026-10-08)
 *   · Warm and trade-savvy. The joke is on the job, the clock, the weather, the paperwork or the gator
 *     himself — never on a customer's intelligence, never on a trade, never on a person.
 *   · Nothing unsafe shown as the way to do it. At height he wears a harness clipped to an anchor, and
 *     the hard hat and glasses never come off. Slapstick is obviously cartoon, never a how-to.
 *   · Nothing political, sexual, crude or demeaning. No real people, no other company's name, logo,
 *     character or vehicle badge, no real place names. Trucks and tools are generic and unmarked.
 *   · No music or audio that is anyone else's: the track is synthesised here (sound.ts) or silent.
 *   · The product is an end tag (1.5 s), at most one light line before it. The joke lands first.
 *   · Every clip is AI-generated and is labelled so wherever a platform has a label.
 */
import type { Cue } from "./sound";
import { MORE_CONCEPTS } from "./concepts-more";

/** What every still prompt starts with: the mascot, as drawn (client/public/mascot/gator-standing-1024.v1.webp). */
export const CHARACTER = [
  "Use the reference images: image 1 is the full-body model sheet of our mascot, image 2 is a close-up of his head.",
  "Draw THE SAME character, unchanged: a stocky cartoon alligator with green scaly skin and a cream-yellow jaw and belly, a long rounded snout with small white teeth showing in a confident closed-mouth smirk,",
  "a glossy yellow hard hat, black wraparound sunglasses with orange-tinted lenses (always on, eyes never visible), a black hoodie with the hood down, an orange hi-vis safety vest with yellow and silver reflective stripes worn over the hoodie,",
  "black cargo work trousers, a black tool belt with a tape measure, tan lace-up work boots, and a thick green tail with dark ridges.",
  "Same thick black outlines, same glossy cel-shaded cartoon sticker style, same colours and proportions as the references. The whole scene, background included, is drawn in that same bold cartoon style — not photorealistic.",
].join(" ");
/** …and ends with. */
export const FRAMING = "Vertical 9:16 illustration, full-bleed: the artwork fills the whole tall frame from edge to edge, with no border, margin, panel or white band. The character is large and sits in the middle band of the frame; the top third of the frame is calm, empty background (sky, wall or ceiling) with his hard hat below it, and the bottom quarter holds nothing important. Exactly one alligator. No people. No text, letters, numbers, signs with writing, logos, brand names, badges or watermarks anywhere.";
export const NEGATIVE = "text, letters, numbers, captions, logo, brand name, watermark, photorealistic, live action, extra limbs, extra fingers, deformed hands, second alligator, human, sunglasses removed, hard hat removed, flicker, morphing";
export const MOTION_STYLE = "2D cartoon animation, the same bold cel-shaded style as the image, smooth and simple motion. His hard hat and sunglasses stay on. Nothing morphs. No text appears.";

export type ShotBeat = { at: number; dur?: number; text: string; accent?: string; pos?: "top" | "low" };
export type Shot = {
  id: string;
  /** The scene for the still (between CHARACTER and FRAMING). */
  scene: string;
  /** What moves, for the image-to-video model (MOTION_STYLE is appended). */
  motion: string;
  /** Seconds of the generated clip that are used, from `from` (default 0), played at `speed` (default 1). */
  use: number; from?: number; speed?: number;
  /** Move the picture down by this many pixels (of 1920) when the still left too little room above his head for the caption; the sky above is mirrored into the gap. */
  shiftDown?: number;
  /** Caption beats, in seconds from the start of this shot as it plays. The first beat of the first shot is the hook. */
  beats: ShotBeat[];
  /** A speech bubble over the picture (x, y: the bubble's centre, in 1080×1920 pixels). */
  bubble?: { at: number; dur: number; text: string; x: number; y: number; tail: "left" | "right" };
  /** Sound cues, in seconds from the start of this shot as it plays. */
  cues: Cue[];
};
export type Format = "job-site pain" | "POV" | "satisfying work" | "product tie-in";
export type Concept = {
  id: string; title: string; format: Format;
  /** Evergreen, or tied to a season / a moment / a trend format that will date. */
  evergreen: boolean; timing?: string;
  /** On screen in the first frame, eight words at most. `hookAccent` is its orange word. */
  hook: string;
  shots: Shot[];
  /** The sound idea in a sentence (the cues are per shot). */
  sound: string;
  /** The caption every platform starts from: one or two lines, in the gator's voice. */
  caption: string;
  /** Five hashtags, without the #. The first three also go to LinkedIn and YouTube. */
  hashtags: string[];
  /** LinkedIn's version, in a plainer voice — or null when the joke does not belong there. */
  linkedin: string | null;
  /** The YouTube Shorts title, without the tag (≤ 80 characters). */
  youtubeTitle: string;
  /** One of the three pilots produced on 2026-10-08. */
  pilot?: boolean;
};

export const END_TAG = { line: "run the whole job.", brand: "ConstructHUB", site: "constructhub.us" };
export const AI_NOTE = "AI-generated animation of our mascot.";

const beat = (at: number, text: string, accent?: string, pos?: "top" | "low", dur?: number): ShotBeat => ({ at, text, ...(accent ? { accent } : {}), ...(pos ? { pos } : {}), ...(dur ? { dur } : {}) });

/** The three pilots (produced 2026-10-08); the other twenty-seven are in concepts-more.ts. */
const PILOTS: Concept[] = [
  {
    id: "two-day-job", title: "The “two-day” job", format: "job-site pain", evergreen: true, pilot: true,
    hook: "Driving to the “two-day” job",
    shots: [
      {
        id: "s1",
        scene: "He is driving a generic unmarked orange pickup truck at sunrise, seen from the passenger side inside the cab: both hands on the steering wheel, seat belt on, a paper coffee cup steaming in the cup holder, a ladder rack visible through the rear window, a quiet suburban road and a pink-orange sky through the windscreen.",
        motion: "He drives the pickup, both hands on the wheel, calmly bobbing his head to the radio. Houses and trees slide past the windows. The coffee steams. Gentle road vibration.",
        use: 3.4, shiftDown: 230, beats: [beat(0, "Driving to the “two-day” job", "“two-day”")],
        cues: [{ type: "engine", at: 0, dur: 3.4 }, { type: "beat", at: 0, dur: 3.4, bpm: 104, gain: 0.5 }],
      },
      {
        id: "s2",
        scene: "He stands in a driveway facing the viewer, holding a paper coffee cup, completely deadpan. Behind him is a two-storey house stripped down to its wooden studs, a blue tarp over the roof, scaffolding, stacks of lumber and a plain, unmarked skip with nothing written on it. Overcast afternoon light.",
        motion: "He stares at the viewer, deadpan, and takes one long slow sip of coffee. Behind him the blue tarp flaps in the wind and a single board drops off the house.",
        use: 3.0, beats: [beat(0.15, "Day 9.", "9.", "top")],
        cues: [{ type: "thud", at: 0.05 }, { type: "air", at: 0, dur: 3.0 }, { type: "sad", at: 0.5 }],
      },
    ],
    sound: "Engine hum and a plain kick-and-hat bed on the drive; cut to wind, a thud and a three-note “wah-wah” on the reveal.",
    caption: "“Should take about two days.” — me, nine days ago.",
    hashtags: ["contractorlife", "construction", "contractorhumor", "bluecollar", "jobsite"],
    linkedin: "Every estimator has said “about two days” at least once. Scope grows; the paperwork should keep up with it. A change order sent the same day saves the conversation nine days later.",
    youtubeTitle: "Driving to the “two-day” job… day 9",
  },
  {
    id: "shingle-rhythm", title: "No thoughts, just shingles", format: "satisfying work", evergreen: true, pilot: true,
    hook: "No thoughts. Just shingles.",
    shots: [
      {
        id: "s1",
        scene: "He kneels on a pitched residential roof under a clear blue sky, wearing a fall-arrest safety harness whose lanyard is clipped to a roof anchor, pressing a roofing nail gun onto a row of dark grey asphalt shingles. A neat stack of shingles sits beside him. The lower half of the roof is finished in perfectly straight rows; the upper half is bare underlayment.",
        motion: "He nails shingles in a steady rhythm: the nail gun kicks, he slides the next shingle into place, the nail gun kicks again. Calm, even, satisfying. The camera pushes in slowly.",
        use: 4.0, shiftDown: 300, beats: [beat(0, "No thoughts. Just shingles.", "shingles.")],
        cues: [{ type: "pop", at: 0.3, every: 0.5, until: 3.8 }, { type: "beat", at: 0, dur: 4.0, bpm: 120, gain: 0.45 }],
      },
      {
        id: "s2",
        scene: "He stands on the finished roof at golden hour with his arms crossed, wearing the fall-arrest safety harness with its lanyard clipped to a roof anchor, the nail gun resting at his feet. Every row of dark grey shingles behind him is perfectly straight. Rooftops and trees in the distance.",
        motion: "Arms crossed, he looks over the finished roof and nods slowly, satisfied. The camera pulls back slowly to show the perfectly straight rows of shingles. Warm light, a light breeze.",
        use: 2.4, beats: [beat(0.1, "Straight lines only.", "straight", "low")],
        cues: [{ type: "ding", at: 0.1 }, { type: "air", at: 0, dur: 2.6 }],
      },
    ],
    sound: "Nail-gun pops on the beat over a plain kick-and-hat bed; a bell on the finished roof.",
    caption: "Nothing to see here. Just a gator, a harness and very straight lines.",
    hashtags: ["roofing", "roofer", "satisfying", "construction", "contractorlife"],
    linkedin: "Good roofing is rhythm: line, shingle, four nails, next. The same goes for the paperwork around it. Tie off first, keep the lines straight.",
    youtubeTitle: "No thoughts. Just shingles. (gator roofing)",
  },
  {
    id: "while-youre-here", title: "“While you're here…”", format: "job-site pain", evergreen: true, pilot: true,
    hook: "Finally packed up. Going home.",
    shots: [
      {
        id: "s1",
        scene: "At dusk in a suburban driveway he leans back against the closed tailgate of a generic unmarked orange pickup truck, facing the viewer in a three-quarter view, relaxed and pleased, brushing his hands together. The truck bed behind him holds a ladder and black tool boxes. His one tail hangs low behind his legs. A house with a freshly built wooden porch stands further back. Warm evening light, long shadows. The dusk sky fills the whole top third of the frame, right out to every edge.",
        motion: "Leaning against the truck, he wipes his hands, lets out a long relieved breath, shoulders dropping, and gives a small satisfied nod toward the viewer. He stays where he is. Warm evening light.",
        use: 3.0, shiftDown: 90, beats: [beat(0, "Finally packed up. Going home.", "home.")],
        cues: [{ type: "air", at: 0, dur: 3.0 }, { type: "thud", at: 1.1 }, { type: "beat", at: 0, dur: 3.0, bpm: 96, gain: 0.4 }],
      },
      {
        id: "s2",
        scene: "Close-up from the chest up at dusk in the same driveway: he has frozen mid-step beside the same orange pickup truck, shoulders tense, head turned back over his shoulder toward the viewer, mouth a flat line. The porch light of the house glows softly far behind him.",
        motion: "He is frozen. Very slowly he turns his head toward the viewer and holds a long deadpan stare. Slow dramatic push-in on his face.",
        use: 3.4, shiftDown: 220, beats: [beat(0.1, "“While you're here…”", "here…”", "top")],
        cues: [{ type: "whoosh", at: 0 }, { type: "tick", at: 0.6, every: 0.5, until: 3.2 }],
      },
    ],
    sound: "An easy bed and a tailgate thud; then it cuts dead — a swish, and a clock ticking through the stare.",
    caption: "Three words that add two hours. (We love you. We'll do it. It's going on the change order.)",
    hashtags: ["contractorlife", "contractorhumor", "construction", "handyman", "bluecollar"],
    linkedin: "“While you're here…” is how good jobs grow — and how margins disappear when the extra work never reaches paper. Say yes, write it down, send it before you leave the driveway.",
    youtubeTitle: "“While you're here…” (every contractor knows)",
  },
];

export const CONCEPTS: Concept[] = [...PILOTS, ...MORE_CONCEPTS];

export const conceptById = (id: string): Concept => { const c = CONCEPTS.find((x) => x.id === id); if (!c) throw new Error(`${id} is not a concept (${CONCEPTS.map((x) => x.id).join(", ")})`); return c; };
export const stillPrompt = (s: Shot): string => `${CHARACTER} Scene: ${s.scene} ${FRAMING}`;
export const motionPrompt = (s: Shot): string => `The cartoon alligator in the hard hat and sunglasses. ${s.motion} ${MOTION_STYLE}`;

/* ── The post text ────────────────────────────────────────────────────────── */

export type ViralPlatform = "instagram" | "tiktok" | "linkedin" | "youtube";
export type ViralPost = { text: string; hashtags: string[]; title?: string };
const tags = (c: Concept, n: number) => c.hashtags.slice(0, n).map((t) => `#${t}`).join(" ");
const SIGN = `${END_TAG.brand} — ${END_TAG.line}`;

/** A concept's posts. LinkedIn is null when the joke does not belong there. */
export function postsOf(c: Concept): Record<ViralPlatform, ViralPost | null> {
  return {
    instagram: { text: `${c.caption}\n\n${SIGN} Link in bio · ${END_TAG.site}\n\n${AI_NOTE}\n\n${tags(c, 5)}`, hashtags: c.hashtags.slice(0, 5) },
    tiktok: { text: `${c.caption} ${tags(c, 5)}`, hashtags: c.hashtags.slice(0, 5) },
    linkedin: c.linkedin ? { text: `${c.linkedin}\n\n${SIGN} https://${END_TAG.site}\n\n(${AI_NOTE})\n\n${tags(c, 3)}`, hashtags: c.hashtags.slice(0, 3) } : null,
    youtube: { title: `${c.youtubeTitle} #Shorts`, text: `${c.caption}\n\n${SIGN} https://${END_TAG.site}\n\n${AI_NOTE}\n\n${tags(c, 3)} #Shorts`, hashtags: c.hashtags.slice(0, 3) },
  };
}

/** Words a caption, a hook or a prompt may not carry (brands, people, politics, crude). Checked by the tests. */
export const BANNED = /\b(ford|chevy|chevrolet|ram|toyota|dewalt|milwaukee|makita|home depot|lowe'?s|carhartt|tiktok sound|trump|biden|democrat|republican|election|sexy|damn|hell|stupid|idiot|dumb|karen|guarantee[ds]?|best)\b/i;
/** What is wrong with a concept — an empty list when it keeps the house rules that can be checked by machine. */
export function lintConcept(c: Concept): string[] {
  const bad: string[] = [], words = (s: string) => s.trim().split(/\s+/).length;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) bad.push("the id is not kebab-case");
  if (words(c.hook) > 8) bad.push(`the hook is ${words(c.hook)} words (8 at most)`);
  if (!c.shots.length || c.shots.length > 3) bad.push("one to three shots");
  if (c.shots[0]?.beats[0]?.at !== 0 || c.shots[0].beats[0].text !== c.hook) bad.push("the first beat of the first shot must be the hook, at 0 s");
  const sec = c.shots.reduce((n, s) => n + s.use, 0);
  if (sec < 4 || sec > 20) bad.push(`${sec.toFixed(1)} s of shots (5–20 s)`);
  for (const s of c.shots) {
    if ((s.shiftDown ?? 0) < 0 || (s.shiftDown ?? 0) > 300) bad.push(`${s.id}: shiftDown is 0–300`);
    if (s.use <= 0 || (s.from ?? 0) + s.use * (s.speed ?? 1) > 5 + 1e-9) bad.push(`${s.id}: uses more than the 5 s that are generated`);
    for (const b of s.beats) { if (b.at < 0 || b.at >= s.use) bad.push(`${s.id}: a beat starts outside the shot`); if (b.accent && !b.text.toLowerCase().includes(b.accent.toLowerCase())) bad.push(`${s.id}: the accent “${b.accent}” is not in “${b.text}”`); }
    if (/\b(roof|ladder|scaffold)/i.test(s.scene) && /\b(stands?|kneels?|sits?|climbs?|walks?) on (a |the )?(pitched |finished |residential )*(roof|ladder|scaffold)/i.test(s.scene) && !/harness|three points of contact|guard ?rail/i.test(s.scene)) bad.push(`${s.id}: he is at height without a harness, a guard rail or three points of contact in the prompt`);
    if (/sunglasses (off|removed)|without (his )?(hard hat|sunglasses)|takes off/i.test(`${s.scene} ${s.motion}`)) bad.push(`${s.id}: the hard hat and sunglasses stay on`);
  }
  if (c.hashtags.length !== 5 || c.hashtags.some((t) => !/^[a-z0-9]+$/.test(t))) bad.push("five hashtags, lower case, no #");
  if (c.youtubeTitle.length > 80 || /[<>]/.test(c.youtubeTitle)) bad.push("the YouTube title is over 80 characters or has < >");
  const everything = [c.title, c.hook, c.caption, c.linkedin ?? "", c.youtubeTitle, ...c.shots.flatMap((s) => [s.scene, s.motion, s.bubble?.text ?? "", ...s.beats.map((b) => b.text)])].join("\n");
  const m = BANNED.exec(everything);
  if (m) bad.push(`“${m[0]}” — a brand, a person, politics or a word we do not use`);
  const p = postsOf(c);
  if (p.instagram!.text.length > 2200 || p.tiktok!.text.length > 2200 || (p.linkedin && p.linkedin.text.length > 3000) || p.youtube!.title!.length > 100 || Buffer.byteLength(p.youtube!.text) > 5000) bad.push("a post is over its platform's limit");
  for (const k of ["instagram", "linkedin", "youtube"] as const) if (p[k] && !p[k]!.text.includes("AI-generated")) bad.push(`${k}: the post does not say it is AI-generated`);
  return bad;
}
