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
import { LIVE_CONCEPTS } from "./concepts-live";

/** What every still prompt starts with: the mascot, as drawn (client/public/mascot/gator-standing-1024.v1.webp). */
export const CHARACTER = [
  "Use the reference images: image 1 is the full-body model sheet of our mascot, image 2 is a close-up of his head.",
  "Draw THE SAME character, unchanged: a stocky cartoon alligator with green scaly skin and a cream-yellow jaw and belly, a long rounded snout with small white teeth showing in a confident closed-mouth smirk,",
  "a glossy yellow hard hat, black wraparound sunglasses with orange-tinted lenses (always on, eyes never visible), a black hoodie with the hood down, an orange hi-vis safety vest with yellow and silver reflective stripes worn over the hoodie,",
  "black cargo work trousers, a black tool belt with a tape measure, tan lace-up work boots, and a thick green tail with dark ridges.",
  "Same thick black outlines, same glossy cel-shaded cartoon sticker style, same colours and proportions as the references. The whole scene, background included, is drawn in that same bold cartoon style — not photorealistic.",
].join(" ");
/** …and ends with. */
export const FRAMING = "Vertical 9:16 illustration, full-bleed: the artwork fills the whole tall frame from edge to edge, with no border, margin, panel, vignette or white band; the background scene (ground, walls, sky) is drawn right out to all four edges, never a plain white or blank backdrop. The character is large and sits in the middle band of the frame; the top third of the frame is calm, empty background (sky, wall or ceiling) with his hard hat below it, and the bottom quarter holds nothing important. Exactly one alligator. No people. No text, letters, numbers, signs with writing, logos, brand names, badges or watermarks anywhere.";
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
  /**
   * He talks (docs/gator/VOICE.md). The line is spoken in his one voice (voice.ts) and starts `lead`
   * seconds into the shot (default 0.5). Write it for the voice: dry, short, trade-savvy.
   */
  say?: { text: string; lead?: number };
  /**
   * Which model animates the shot. Default "kling" (Kling 2.5 Turbo Standard, 720p). "kling-pro": the
   * same family's Pro tier, for a hero shot. "wan-talk": Wan 2.7 driven by the spoken line, so the jaw
   * follows the words (needs `say`). "kling-voice": Kling 3.0 with its own generated voice — a
   * the first comparison sample. "talk": THE HOUSE METHOD since the owner heard the samples (2026-10-08):
   * Kling 3.0 Standard with its own sound, the fixed voice description below, the line in quotes; every
   * take is measured against the approved voice and transcribed (voiceprint.ts, asr.py).
   */
  video?: "kling" | "kling-pro" | "wan-talk" | "kling-voice" | "talk";
  /** Seconds to generate for this shot (default 5; only "talk" may ask for more — up to 15 — for a longer line or a one-take vlog). */
  seconds?: number;
  /** "live": the photoreal alligator (concepts-live.ts) instead of the cartoon mascot — set by the concept. */
  look?: "live";
  /** The whole prompt for the video model, used as written (the live one-take formats write their own). */
  rawMotion?: boolean;
  /** The whole prompt for the STILL, used as written and drawn without the gator's reference (a shot of the supporting cast, the goat, a trap). */
  rawStill?: boolean;
  /** "none": the speaker in this shot is not the gator (a member of the cast) — his voice note is not added and the take is not held to his voice. */
  voice?: "none";
  /** How loud this shot's own generated sound sits in the mix, 0–1 (default 0.7; a scream is 0.9, room tone 0.3). */
  ownGain?: number;
  /**
   * Put the shot's "pop" cues where the picture actually moves instead of on a fixed beat: "peaks" = every
   * burst of motion found in the clip (a nail gun, a drill), "max" = the single biggest one (a chalk line).
   */
  sync?: "peaks" | "max";
  /** Animate a still that was already drawn and approved for another shot: "<conceptId>/<shotId>". */
  stillFrom?: string;
  /** Use the CLIP that was already made and approved for another shot ("<conceptId>/<shotId>") — the goat is generated once. */
  videoFrom?: string;
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
  /** "live": the photoreal alligator, found-footage look. Default: the cartoon mascot. */
  look?: "live";
  /**
   * "oneshot": ONE continuous take and nothing burned into the picture — no meme text, no logo, no end tag
   * (the formula of the owner's reference clips); a captioned variant is rendered beside it for comparison.
   * Default: the meme-caption cut with the end tag.
   */
  cut?: "oneshot";
  /** Small subtitles of what is HEARD (lower third), instead of big caption beats for spoken lines — when the line is the joke. */
  subtitles?: boolean;
  /** Seconds of end tag (default 1.5; 0.8 for the fail formats; 0 for none). */
  endTagSec?: number;
  /** false: no logo bug over the picture. */
  logo?: boolean;
  /** "cctv": a camera name and a running clock in the corner, drawn in the edit (never by the model) — part of the picture, also in the pure cut. */
  overlay?: "cctv";
  /** A one-shot's meme caption for its CAPTIONED variant only (seven words at most); the pure cut never carries it. */
  meme?: string;
  /** The style of the styles experiment (docs/gator/STYLES.md), carried into the viral ledger. */
  style?: number;
  /** Not one of the thirty: a test piece (a voice sample). Left out of the document and the queue. */
  sample?: boolean;
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

/**
 * PRODUCTION NOTES — what phase 2 (2026-10-08) changed in a concept when it was made: who talks and what
 * he says, which shots get the dearer model, where the foley follows the picture. Merged over the shots.
 */
const DEADPAN34 = "He stands in three-quarter view, his long snout in profile, facing the viewer with a flat, unimpressed, closed mouth.";
const PRODUCTION: Record<string, Record<string, Partial<Shot>>> = {
  "permit-office-359": {
    s1: { video: "kling-pro" },
    s2: { video: "kling-pro", use: 4.8, say: { text: "Closes at four. It's three fifty-nine. Fuhgeddaboudit.", lead: 0.5 }, cues: [{ type: "thud", at: 0.05 }, { type: "air", at: 0, dur: 4.8 }],
      scene: `At the closed glass doors of a plain civic office building, blinds pulled down behind the glass, he holds a roll of blueprints hanging limp in one hand. ${DEADPAN34}`,
      motion: "He glances at the closed doors, then turns his head back to the viewer and talks, deadpan, with a small shrug. The roll of blueprints droops in his hand." },
  },
  "where-is-my-tape": {
    s1: { video: "kling-pro" },
    s2: { video: "kling-pro", use: 4.6, beats: [], say: { text: "Twenty minutes. On my belt. The whole time.", lead: 0.5 }, cues: [{ type: "whoosh", at: 0 }, { type: "air", at: 0, dur: 4.6 }],
      scene: `Medium shot in the same garage workshop: he holds an orange tape measure up in one hand, just unclipped from his own tool belt. ${DEADPAN34}`,
      motion: "He holds the tape measure up, looks at it, then looks at the viewer and talks, deadpan, shaking his head slightly." },
  },
  "measure-twice": {
    s2: {
      scene: `He holds a cut wooden board up across an open doorway frame; the board is clearly a hand's width too short and does not reach the other side. ${DEADPAN34}`,
      motion: "He holds the too-short board against the opening, looks at the gap, then slowly turns his head to the viewer, deadpan." },
  },
  "permit-office-in-seconds": {
    s2: { use: 5.0, beats: [], say: { text: "Found the permit office in ten seconds. Parking? Different story.", lead: 0.3 }, cues: [{ type: "ding", at: 0.05, gain: 0.6 }, { type: "air", at: 0, dur: 5.0 }],
      scene: `He leans against a generic unmarked orange pickup truck holding a phone in one hand, its screen a soft plain glow with nothing readable; a folded paper map lies on the bonnet. ${DEADPAN34}`,
      motion: "He glances at the glowing phone, nods, then looks at the viewer and talks, dry and matter-of-fact, ending with a small shrug." },
  },
  "coffee-ran-out": {
    s2: { use: 4.6, beats: [], say: { text: "Seven fifteen. No coffee. Long day, my friend.", lead: 0.5 }, cues: [{ type: "air", at: 0, dur: 4.6 }],
      scene: `On an early-morning jobsite he holds an empty paper cup in one hand and a steel thermos hanging from the other. ${DEADPAN34}`,
      motion: "He looks into the empty cup, then at the viewer, and talks, deadpan and tired. A light wind moves a scrap of paper across the ground behind him." },
  },
  "zero-percent-rain": {
    s2: {
      scene: `Heavy cartoon rain pours straight down on him as he stands beside a wet concrete slab, soaked, holding a comically tiny umbrella over his hard hat. ${DEADPAN34}`,
      motion: "Rain pours straight down. He stands still under the tiny umbrella, water streaming off his hard hat, and stares at the viewer, deadpan." },
  },
  "chalk-line-snap": { s1: { sync: "max" } },
  "deck-boards-rhythm": { s1: { sync: "peaks" } },
};
/** The ten made in phase 2, in the order they were made. */
export const PHASE2_IDS = ["permit-office-359", "where-is-my-tape", "measure-twice", "permit-office-in-seconds", "coffee-ran-out", "zero-percent-rain", "chalk-line-snap", "deck-boards-rhythm", "pov-first-on-site", "paid-same-day"];
/** Which style of the experiment a cartoon concept belongs to (docs/gator/STYLES.md); the live ones carry theirs. */
const STYLE_OF: Record<string, number> = { "two-day-job": 6, "shingle-rhythm": 6, "while-youre-here": 6, "measure-twice": 11, "zero-percent-rain": 11 };
export const CONCEPTS: Concept[] = [...PILOTS, ...MORE_CONCEPTS].map((c) => ({ ...c, ...(STYLE_OF[c.id] ? { style: STYLE_OF[c.id] } : {}), ...(PRODUCTION[c.id] ? { shots: c.shots.map((s) => ({ ...s, ...(PRODUCTION[c.id][s.id] ?? {}) })) } : {}) }));

/** Voice samples (2026-10-08): the same line, the same still, two ways of making him talk. */
const PROFILE = "He keeps the same three-quarter profile as in the image the whole time — he does not turn to face the viewer; only his eyes-line, jaw and shoulders move. Deadpan, unimpressed, never smiling or laughing. He lowers the coffee cup and talks; when he has finished he shakes his head once, slowly.";
const sampleTalk = (id: string, video: "wan-talk" | "kling-voice" | "kling", motion = "He lowers the coffee cup, looks straight at the viewer, deadpan, and talks. When he has finished he shakes his head once, slowly."): Concept => ({
  id, title: `Talking sample (${video})`, format: "job-site pain", evergreen: true, sample: true,
  hook: "Day 9.",
  shots: [{
    id: "s1", stillFrom: "two-day-job/s2", scene: "", video,
    motion,
    use: 5.0, say: { text: "Two days, he says. Two days.", lead: 0.7 },
    beats: [beat(0, "Day 9.", "9."), { at: 0.7, text: "Two days, he says. Two days.", accent: "says.", pos: "low" }],
    cues: [{ type: "air", at: 0, dur: 5.0 }, { type: "thud", at: 0.1, gain: 0.5 }],
  }],
  sound: "Open air; the line carries it.",
  caption: "Two days, he says.", hashtags: ["contractorlife", "construction", "contractorhumor", "bluecollar", "jobsite"], linkedin: null, youtubeTitle: "Two days, he says",
});
/** The owner's talking samples in the house method (2026-10-08): three lines, one voice — to judge consistency. */
const finalTalk = (id: string, stillFrom: string, hook: string, accent: string, line: string, motion: string, seconds = 5): Concept => ({
  id, title: `Talking final (${line})`, format: "job-site pain", evergreen: true, sample: true, hook,
  shots: [{ id: "s1", stillFrom, scene: "", video: "talk", seconds, motion, use: seconds, say: { text: line }, beats: [beat(0, hook, accent)], cues: [] }],
  sound: "His voice and the room; nothing else.",
  caption: line, hashtags: ["contractorlife", "construction", "contractorhumor", "bluecollar", "jobsite"], linkedin: null, youtubeTitle: hook.replace(/[<>]/g, ""),
});
export const FINALS: Concept[] = [
  finalTalk("talking-final-1", "two-day-job/s2", "Day 9.", "9.", "Two days, he says. Two days.", "He holds his coffee cup, looks at the viewer and talks, unimpressed; when he has finished he shakes his head once, slowly."),
  finalTalk("talking-final-2", "permit-office-359/s2", "3:59 PM.", "3:59", "Permit office closes at four. It's three fifty-nine.", "He stands at the closed office doors holding the roll of plans, looks at the viewer and talks, unimpressed, with a small shrug at the end.", 6),
  finalTalk("talking-final-3", "while-youre-here/s2", "Almost made it home.", "home.", "“While you're here.” Three words. Three more hours.", "He stands frozen beside the truck, looking at the viewer over his shoulder, and talks, flat and tired; a slow blink-less stare at the end.", 6),
];
export const SAMPLES: Concept[] = [
  sampleTalk("talking-sample-1", "wan-talk"), sampleTalk("talking-sample-2", "kling-voice"),
  sampleTalk("talking-sample-3", "kling", PROFILE), sampleTalk("talking-sample-4", "wan-talk", PROFILE),
];

export const conceptById = (id: string): Concept => { const c = [...CONCEPTS, ...SAMPLES, ...FINALS, ...LIVE_CONCEPTS].find((x) => x.id === id); if (!c) throw new Error(`${id} is not a concept (${CONCEPTS.map((x) => x.id).join(", ")})`); return c; };
export const LIVE_CHARACTER = "Use the reference image: it shows the animal. THE SAME animal, unchanged: a real adult American alligator standing upright on its hind legs like a person — photorealistic, real scales, real proportions, dark olive-green hide, pale cream throat and belly, long snout — wearing a yellow construction hard hat, dark wraparound safety sunglasses and an orange hi-vis safety vest with silver reflective stripes.";
export const LIVE_FRAMING = "A photograph, not an illustration: it looks like a frame from an ordinary phone video — flat natural daylight, slightly imperfect framing, everything in focus, no cinematic lighting, no blur, no filter. Vertical 9:16, filling the frame edge to edge. Exactly one alligator. No people. No text, letters, numbers, logos, brand names or watermarks anywhere.";
export const stillPrompt = (s: Shot): string => (s.rawStill ? s.scene : s.look === "live" ? `${LIVE_CHARACTER} Scene: ${s.scene} ${LIVE_FRAMING}` : `${CHARACTER} Scene: ${s.scene} ${FRAMING}`);
export const TALKING = "He is speaking: his long jaw opens and closes clearly with every word, like a cartoon character talking, and closes when he stops.";
export const SILENT = "His mouth stays closed in his usual smirk the whole time; no teeth-baring grin.";
/**
 * THE VOICE, as every talking prompt describes it — verbatim, never reworded (a generated voice is a new
 * performance each time; the same words are the first thing that keeps it the same man).
 */
export const VOICE_DESCRIPTION = "in the voice of a man of about fifty: a gravelly baritone, dry and unhurried, with a New York / North Jersey working-class accent, completely deadpan — no laughing, no shouting. No music and no other voices: only his voice and quiet room tone";
/** What the talking model must not change about him (it has no negative prompt; sample 2 gave him eyes). */
export const ON_MODEL_TALKING = "His sunglasses are opaque and dark with an orange tint at all times: his eyes are never visible, not even for a frame. His hard hat stays on. The same vest and hoodie, the same bold cartoon drawing style throughout. He keeps the pose and the three-quarter angle of the image. His long jaw moves only while he is speaking and is shut before and after. No other character appears. No text appears.";
export const LIVE_VOICE_NOTE = `His voice is ${VOICE_DESCRIPTION.replace(/^in /, "")}.`;
export function motionPrompt(s: Shot): string {
  if (s.rawMotion) return s.say && s.voice !== "none" ? `${s.motion} ${LIVE_VOICE_NOTE}` : s.motion;
  const who = "The cartoon alligator in the hard hat and sunglasses.";
  if (s.video === "talk") return `${who} ${s.motion} He starts speaking almost at once and says, ${VOICE_DESCRIPTION}: "${s.say!.text}" ${ON_MODEL_TALKING}`;
  return `${who} ${s.motion} ${s.say ? (s.video === "kling-voice" ? `He says, in a gravelly, warm, dry New Jersey accent: "${s.say.text}" ` : "") + TALKING : SILENT} ${MOTION_STYLE}`;
}

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
export const BANNED = /\b(ford|chevy|chevrolet|ram|toyota|dewalt|milwaukee|makita|home depot|lowe'?s|carhartt|tiktok sound|trump|biden|democrat|republican|election|sexy|damn|hell|stupid|idiot|dumb|karen|guarantee[ds]?|the best|best in)\b/i;
/** What is wrong with a concept — an empty list when it keeps the house rules that can be checked by machine. */
export function lintConcept(c: Concept): string[] {
  const bad: string[] = [], words = (s: string) => s.trim().split(/\s+/).length;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) bad.push("the id is not kebab-case");
  // A one-shot's hook is its caption line (nothing is burned in), so it may be a sentence.
  if (words(c.hook) > (c.cut === "oneshot" || c.subtitles ? 14 : 8)) bad.push(`the hook is ${words(c.hook)} words (${c.cut === "oneshot" || c.subtitles ? 14 : 8} at most)`);
  if (!c.shots.length || c.shots.length > 3) bad.push("one to three shots");
  if (c.meme && words(c.meme) > 7) bad.push("the meme caption is over seven words");
  if (c.cut === "oneshot") { if (c.shots.length !== 1 || c.shots[0].beats.length) bad.push("a one-shot clip is one shot with nothing burned in"); }
  else if (c.subtitles && !c.shots[0]?.beats.length) { /* the line is the joke: subtitles only, no hook burned in */ }
  else if (c.shots[0]?.beats[0]?.at !== 0 || c.shots[0].beats[0].text !== c.hook) bad.push("the first beat of the first shot must be the hook, at 0 s");
  const sec = c.shots.reduce((n, s) => n + s.use, 0);
  if (sec < (c.style === 17 ? 2 : 4) || sec > 20) bad.push(`${sec.toFixed(1)} s of shots (5–20 s)`);
  if (c.look === "live" && c.shots.some((s) => s.look !== "live")) bad.push("a live concept's shots are live");
  for (const s of c.shots) {
    if ((s.shiftDown ?? 0) < 0 || (s.shiftDown ?? 0) > 300) bad.push(`${s.id}: shiftDown is 0–300`);
    if (s.seconds !== undefined && (s.video !== "talk" || s.seconds < 3 || s.seconds > 15 || !Number.isInteger(s.seconds))) bad.push(`${s.id}: \`seconds\` is 3–15, for a shot with the model's own sound`);
    if (s.rawStill && /alligator/i.test(s.scene) && !/hard hat/i.test(s.scene)) bad.push(`${s.id}: a still with the gator in it names his hard hat`);
    if (s.use <= 0 || (s.from ?? 0) + s.use * (s.speed ?? 1) > (s.seconds ?? 5) + 1e-9) bad.push(`${s.id}: uses more than the ${s.seconds ?? 5} s that are generated`);
    if (s.say && (s.say.text.length > 260 || (s.video !== "talk" && (s.say.lead ?? 0.5) + 1 > s.use))) bad.push(`${s.id}: the spoken line is too long for the shot`);
    if ((s.video === "wan-talk" || s.video === "kling-voice" || (s.video === "talk" && !s.rawMotion && !s.videoFrom)) && !s.say && !s.videoFrom) bad.push(`${s.id}: a talking model needs a line`);
    for (const b of s.beats) { if (b.at < 0 || b.at >= s.use) bad.push(`${s.id}: a beat starts outside the shot`); if (b.accent && !b.text.toLowerCase().includes(b.accent.toLowerCase())) bad.push(`${s.id}: the accent “${b.accent}” is not in “${b.text}”`); }
    if (!s.stillFrom && !s.videoFrom && !s.scene.trim()) bad.push(`${s.id}: no scene`);
    if (/\b(roof|ladder|scaffold)/i.test(s.scene) && /\b(stands?|kneels?|sits?|climbs?|walks?) on (a |the )?(pitched |finished |residential )*(roof|ladder|scaffold)/i.test(s.scene) && !/harness|three points of contact|guard ?rail/i.test(s.scene)) bad.push(`${s.id}: he is at height without a harness, a guard rail or three points of contact in the prompt`);
    if (/sunglasses (off|removed)|without (his )?(hard hat|sunglasses)|takes off/i.test(`${s.scene} ${s.motion}`)) bad.push(`${s.id}: the hard hat and sunglasses stay on`);
  }
  if (c.hashtags.length !== 5 || c.hashtags.some((t) => !/^[a-z0-9]+$/.test(t))) bad.push("five hashtags, lower case, no #");
  if (c.youtubeTitle.length > 80 || /[<>]/.test(c.youtubeTitle)) bad.push("the YouTube title is over 80 characters or has < >");
  const everything = [c.title, c.hook, c.caption, c.linkedin ?? "", c.youtubeTitle, ...c.shots.flatMap((s) => [s.scene, s.motion, s.bubble?.text ?? "", s.say?.text ?? "", ...s.beats.map((b) => b.text)])].join("\n");
  const m = BANNED.exec(everything);
  if (m) bad.push(`“${m[0]}” — a brand, a person, politics or a word we do not use`);
  const p = postsOf(c);
  if (p.instagram!.text.length > 2200 || p.tiktok!.text.length > 2200 || (p.linkedin && p.linkedin.text.length > 3000) || p.youtube!.title!.length > 100 || Buffer.byteLength(p.youtube!.text) > 5000) bad.push("a post is over its platform's limit");
  for (const k of ["instagram", "linkedin", "youtube"] as const) if (p[k] && !p[k]!.text.includes("AI-generated")) bad.push(`${k}: the post does not say it is AI-generated`);
  return bad;
}
