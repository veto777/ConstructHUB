/**
 * The SOCIAL CUT of a walkthrough — everything that can be decided without a browser or an encoder
 * (docs/tutorials/PRODUCER-GUIDE.md, "Social cuts"). scripts/tutorials/social.ts does the rendering.
 *
 * A 16:9 master (60–100 s, calm, captions in a player) is right for YouTube and wrong for a phone
 * feed. From the SAME recording and the SAME narration — nothing is re-recorded, nothing new is said —
 * two cuts are made:
 *
 *   vertical  1080×1920, at most 59 s   Instagram Reels, TikTok, YouTube Shorts, Threads, X
 *   feed      1080×1350 (4:5), ≤ 89 s    LinkedIn, Facebook, the Instagram feed
 *
 * What is decided here, purely (and tested in server/tutorials/social.test.ts):
 *   · the layouts and their platform safe areas,
 *   · which steps a cut keeps, how the pauses are tightened and how much the speech is sped up,
 *   · the caption phrases (two lines at most) and when each word is the active one,
 *   · where the camera looks at every moment (the crop that follows the highlighted control),
 *   · finding the recorder's orange ring in a frame, for masters recorded before target boxes were saved.
 */
import { sentencesOf } from "./lib";

/* ── Layouts and safe areas ───────────────────────────────────────────────── */

export type Rect = { x: number; y: number; w: number; h: number };
export type CutName = "vertical" | "feed";
export const CUT_NAMES: readonly CutName[] = ["vertical", "feed"];

/**
 * Parts of the frame a platform draws its own interface over, as fractions of the frame.
 * Vertical (Reels / TikTok / Shorts): the top ~14% carries the tabs, search and the back arrow; the
 * bottom ~22% carries the account name, the caption and the audio line; the right ~16% (in the lower
 * two thirds) is the like / comment / share column. Nothing that must be read goes there.
 * A 4:5 feed post has no overlay: only a small margin, so a crop to the grid loses nothing.
 */
export const SAFE_AREA: Record<CutName, { top: number; bottom: number; left: number; right: number }> = {
  vertical: { top: 0.14, bottom: 0.22, left: 0.05, right: 0.16 },
  feed: { top: 0.02, bottom: 0.02, left: 0.03, right: 0.03 },
};

export type Layout = {
  name: CutName; width: number; height: number;
  /** HARD cap on the finished file, end card included (59 s qualifies as a Short / Reel everywhere). */
  maxSec: number; endCardSec: number;
  /** Kicker + hook headline. */
  header: Rect;
  /** The screen recording: full width, a crop of the master that follows the action. */
  panel: Rect;
  /** The progress bar's track, directly under the panel. */
  bar: Rect;
  /** Where the burned-in captions are drawn (two lines at most). */
  captions: Rect;
  /** Mascot + address: under the platform's own caption on a Reel, visible everywhere else. */
  footer: Rect;
  /** Caption type size (the em, in px) and the master pixels a normal shot shows across the panel. */
  captionPx: number; baseCropW: number;
};

export const LAYOUTS: Record<CutName, Layout> = {
  vertical: {
    name: "vertical", width: 1080, height: 1920, maxSec: 59, endCardSec: 2,
    header: { x: 54, y: 276, w: 972, h: 222 },
    panel: { x: 0, y: 512, w: 1080, h: 780 },
    bar: { x: 0, y: 1292, w: 1080, h: 10 },
    captions: { x: 54, y: 1312, w: 853, h: 182 },
    footer: { x: 0, y: 1500, w: 1080, h: 420 },
    captionPx: 78, baseCropW: 1000,
  },
  feed: {
    name: "feed", width: 1080, height: 1350, maxSec: 89, endCardSec: 2,
    header: { x: 40, y: 30, w: 1000, h: 168 },
    panel: { x: 0, y: 206, w: 1080, h: 800 },
    bar: { x: 0, y: 1006, w: 1080, h: 10 },
    captions: { x: 50, y: 1026, w: 980, h: 178 },
    footer: { x: 0, y: 1210, w: 1080, h: 140 },
    captionPx: 78, baseCropW: 1000,
  },
};

/** The part of a cut's frame no platform interface covers. */
export function safeRect(l: Pick<Layout, "name" | "width" | "height">): Rect {
  const s = SAFE_AREA[l.name];
  return { x: Math.round(l.width * s.left), y: Math.round(l.height * s.top), w: Math.round(l.width * (1 - s.left - s.right)), h: Math.round(l.height * (1 - s.top - s.bottom)) };
}
export const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* ── Which steps a cut keeps, and how tight ───────────────────────────────── */

export type CutStepInput = {
  index: number;
  /** Recorder clock, ms (timings.json). */
  startMs: number; narrationStartMs: number; narrationMs: number; endMs: number;
  /** The script's holdMs for the step (dwell after the line) and whether it opens a chapter. */
  holdMs?: number; chapter?: boolean;
};
export type CutSegment = {
  step: number;
  /** What is kept of the step, on the recorder's clock. */
  srcStartMs: number; srcEndMs: number;
  /** Where it lands in the cut, in ms, after the speed-up. */
  outStartMs: number; outEndMs: number;
  /** The step's narration in the cut. */
  speechStartMs: number; speechEndMs: number;
};
export type CutPlan = {
  /** 1 … MAX_SPEED: picture and sound together. */
  speed: number;
  segments: CutSegment[];
  /** Length of the walkthrough part, and of the whole file with its end card. */
  bodyMs: number; totalMs: number;
  /** The cut stops before the master does: the end card sends the viewer to the full video. */
  truncated: boolean;
  steps: number[];
};

/** Speech is never played faster than this (it stops sounding like a person). */
export const MAX_SPEED = 1.08;
/** The pause kept after a line (the master holds 450 ms + the step's holdMs). */
export const TIGHT_TAIL_MS = 220;
/** What record.ts waits after a line by default (`--pad`). */
export const RECORD_PAD_MS = 450;
/** Kept clear under the hard cap, for frame rounding and the container. */
export const CAP_MARGIN_MS = 200;

/**
 * How much of a step is kept: from its start to a short pause after its line. When the action itself
 * ran longer than the line (typing, a page that loads), the step is kept to the end of the action.
 * A cut is always made in silence, between two lines — never inside a sentence.
 */
export function keptEndMs(s: CutStepInput, tailMs = TIGHT_TAIL_MS): number {
  const speechEnd = s.narrationStartMs + s.narrationMs;
  const hold = s.holdMs ?? 0;
  const actionRanLong = s.endMs - speechEnd > RECORD_PAD_MS + hold + 80;
  const actionEnd = actionRanLong ? s.endMs - hold : speechEnd;
  return Math.min(s.endMs, Math.max(speechEnd, actionEnd) + tailMs);
}

/**
 * Plan a cut of at most `maxSec` seconds with a `endCardSec` end card.
 *  1. Tighten every pause. Fits? Done, at normal speed.
 *  2. Otherwise speed picture and speech up together, by no more than MAX_SPEED.
 *  3. Still too long? Keep the steps from the start (the opening line says what the video is about)
 *     up to the last one that fits — ending on a chapter boundary when one is in the last 30% —
 *     and mark the cut `truncated`.
 */
export function planCut(steps: readonly CutStepInput[], o: { maxSec: number; endCardSec: number; maxSpeed?: number; tailMs?: number; gridMs?: number }): CutPlan {
  if (!steps.length) throw new Error("no steps");
  const maxSpeed = o.maxSpeed ?? MAX_SPEED;
  const budget = o.maxSec * 1000 - o.endCardSec * 1000 - CAP_MARGIN_MS;
  if (budget <= 0) throw new Error("the cap leaves no room for the walkthrough");
  // `gridMs` (a frame of the master): a step ends on a frame, so picture and sound are cut at the same instant.
  const onGrid = (ms: number, s: CutStepInput) => (o.gridMs ? Math.min(s.endMs, Math.ceil(ms / o.gridMs - 1e-6) * o.gridMs) : ms);
  const kept = (n: number) => steps.slice(0, n).map((s, i) => ({ s, end: onGrid(keptEndMs(s, i === n - 1 ? RECORD_PAD_MS : o.tailMs), s) }));
  const lengthOf = (n: number) => kept(n).reduce((sum, k) => sum + (k.end - k.s.startMs), 0);

  let n = steps.length, speed = 1, truncated = false;
  const all = lengthOf(n);
  if (all > budget) {
    if (all / maxSpeed <= budget) speed = Math.ceil((all / budget) * 1000) / 1000;
    else {
      speed = maxSpeed; truncated = true;
      while (n > 1 && lengthOf(n) / speed > budget) n--;
      if (lengthOf(n) / speed > budget) throw new Error(`the first step alone is longer than ${o.maxSec} s`);
      // A chapter boundary a little earlier is a better place to stop than the middle of a task.
      for (let m = n; m >= 2; m--) {
        if (lengthOf(m) < lengthOf(n) * 0.7) break;
        if (steps[m]?.chapter) { n = m; break; }
      }
    }
  }
  const segments: CutSegment[] = [];
  let at = 0;
  for (const { s, end } of kept(n)) {
    const len = end - s.startMs;
    segments.push({
      step: s.index, srcStartMs: s.startMs, srcEndMs: end,
      outStartMs: at / speed, outEndMs: (at + len) / speed,
      speechStartMs: (at + s.narrationStartMs - s.startMs) / speed, speechEndMs: (at + s.narrationStartMs - s.startMs + s.narrationMs) / speed,
    });
    at += len;
  }
  const bodyMs = at / speed;
  return { speed, segments, bodyMs, totalMs: bodyMs + o.endCardSec * 1000, truncated, steps: segments.map((g) => g.step) };
}

/* ── Captions: phrases of two lines at most, one active word at a time ─────── */

/** Advance widths of Anton (scripts/tutorials/assets/Anton-Regular.ttf), per 1000 units of em — captions are set in capitals. */
const ANTON: Record<string, number> = {
  "0": 494, "1": 331, "2": 494, "3": 494, "4": 494, "5": 494, "6": 494, "7": 494, "8": 494, "9": 494, " ": 234, "!": 229, "\"": 429, "#": 546, "$": 462, "%": 1057,
  "&": 520, "'": 214, "(": 291, ")": 291, "*": 452, "+": 355, ",": 236, "-": 311, ".": 229, "/": 405, ":": 242, ";": 245, "?": 492, "@": 864,
  A: 485, B: 479, C: 474, D: 493, E: 412, F: 399, G: 485, H: 499, I: 227, J: 466, K: 472, L: 397, M: 746, N: 498, O: 486, P: 472, Q: 494, R: 477, S: 461, T: 396, U: 474,
  V: 469, W: 712, X: 484, Y: 446, Z: 410, "’": 232, "—": 563, "–": 400,
};
/** Width of a caption string in px at `px` type size (capitals, as drawn). */
export const textWidth = (text: string, px: number): number => {
  let w = 0;
  for (const ch of text.toUpperCase()) w += ANTON[ch] ?? 500;
  return (w * px) / 1000;
};

export type CaptionPhrase = { words: string[]; lines: string[][] };
export const MAX_PHRASE_WORDS = 7;

/** Break one phrase's words into at most two lines, as even as possible; null when they do not fit. */
function twoLines(words: string[], maxW: number, px: number): string[][] | null {
  if (textWidth(words.join(" "), px) <= maxW && words.length <= 3) return [words];
  let best: string[][] | null = null, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = textWidth(words.slice(0, i).join(" "), px), b = textWidth(words.slice(i).join(" "), px);
    if (a > maxW || b > maxW) continue;
    if (Math.max(a, b) < bestScore) { bestScore = Math.max(a, b); best = [words.slice(0, i), words.slice(i)]; }
  }
  if (!best && textWidth(words.join(" "), px) <= maxW) return [words];
  // A short phrase reads better on one line than as two stubs.
  if (best && textWidth(words.join(" "), px) <= maxW * 0.62) return [words];
  return best;
}

/**
 * Narration → caption phrases. A phrase never crosses a sentence end, has at most
 * MAX_PHRASE_WORDS words, fits two lines of `maxW` px at `px`, and breaks after a comma when there
 * is one. A last phrase of a single word takes a word from the phrase before it.
 */
export function chunkCaption(text: string, maxW: number, px: number): CaptionPhrase[] {
  const out: CaptionPhrase[] = [];
  for (const sentence of sentencesOf(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    const phrases: string[][] = [];
    let cur: string[] = [];
    for (const w of words) {
      if (textWidth(w, px) > maxW) throw new Error(`the word “${w}” is wider than a caption line`);
      const next = [...cur, w];
      if (cur.length && (next.length > MAX_PHRASE_WORDS || !twoLines(next, maxW, px))) { phrases.push(cur); cur = [w]; }
      else cur = next;
      if (/[,;:—–]$/.test(w) && cur.length >= 3 && words.length - (phrases.flat().length + cur.length) >= 2) { phrases.push(cur); cur = []; }
    }
    if (cur.length) phrases.push(cur);
    const last = phrases[phrases.length - 1], prev = phrases[phrases.length - 2];
    if (last && prev && last.length === 1 && prev.length >= 3 && twoLines([prev[prev.length - 1], ...last], maxW, px)) last.unshift(prev.pop()!);
    for (const p of phrases) out.push({ words: p, lines: twoLines(p, maxW, px)! });
  }
  return out;
}

export type WordTime = { word: string; startMs: number; endMs: number };
/** A silence inside a clip, in ms from the clip's start. */
export type Gap = { startMs: number; endMs: number };

const wordWeight = (w: string): number => {
  const letters = w.replace(/[^A-Za-z0-9]/g, "").length;
  return letters + 1.5 + (/[.!?]["”’)]*$/.test(w) ? 4 : /[,;:—–]$/.test(w) ? 2 : 0);
};

/**
 * When each word of a narration clip is being said. There is no forced alignment here: time is
 * shared out by the length of the words (a comma and a full stop take a little longer). When the
 * silences inside the clip are known, the longest of them are taken as the pauses between its
 * sentences, so every sentence starts on time and the estimate only has to hold within one.
 */
export function wordTimes(text: string, clipStartMs: number, clipMs: number, gaps: readonly Gap[] = []): WordTime[] {
  const sents = sentencesOf(text).map((s) => s.split(/\s+/).filter(Boolean)).filter((s) => s.length);
  if (!sents.length) return [];
  // Sentence spans inside the clip.
  let spans: { from: number; to: number }[] | null = null;
  const inner = gaps.filter((g) => g.startMs > 120 && g.endMs < clipMs - 120 && g.endMs - g.startMs >= 110);
  if (sents.length > 1 && inner.length >= sents.length - 1) {
    const cuts = [...inner].sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs)).slice(0, sents.length - 1).sort((a, b) => a.startMs - b.startMs);
    spans = sents.map((_s, i) => ({ from: i === 0 ? 0 : cuts[i - 1].endMs, to: i === sents.length - 1 ? clipMs : cuts[i].startMs }));
    // The pauses must be roughly where the words say they are, or they are not sentence pauses.
    const total = sents.reduce((n, s) => n + s.reduce((m, w) => m + wordWeight(w), 0), 0);
    let acc = 0;
    for (let i = 0; i < sents.length - 1 && spans; i++) {
      acc += sents[i].reduce((m, w) => m + wordWeight(w), 0);
      if (Math.abs(spans[i].to / clipMs - acc / total) > 0.22) spans = null;
    }
  }
  if (!spans) {
    const weights = sents.map((s) => s.reduce((m, w) => m + wordWeight(w), 0)), total = weights.reduce((a, b) => a + b, 0);
    let from = 0;
    spans = weights.map((w) => { const to = from + (clipMs * w) / total; const span = { from, to }; from = to; return span; });
  }
  const out: WordTime[] = [];
  sents.forEach((words, i) => {
    const { from, to } = spans![i];
    // The pause after the last word of a sentence is not that word's time when the span was measured.
    const weights = words.map((w, k) => (k === words.length - 1 && gaps.length ? wordWeight(w.replace(/[.!?,;:]+$/, "")) : wordWeight(w)));
    const total = weights.reduce((a, b) => a + b, 0);
    let t = from;
    words.forEach((word, k) => {
      const len = ((to - from) * weights[k]) / total;
      out.push({ word, startMs: Math.round(clipStartMs + t), endMs: Math.round(clipStartMs + t + len) });
      t += len;
    });
  });
  return out;
}

/** Silences of at least `minMs` in 16-bit mono PCM (a narration clip), by 10 ms windows. */
export function findGaps(samples: Int16Array, sampleRate: number, minMs = 110, threshold = 420): Gap[] {
  const win = Math.round(sampleRate / 100), gaps: Gap[] = [];
  let quietFrom = -1;
  const n = Math.floor(samples.length / win);
  for (let i = 0; i <= n; i++) {
    let peak = 0;
    if (i < n) for (let k = i * win; k < (i + 1) * win; k++) { const v = Math.abs(samples[k]); if (v > peak) peak = v; }
    const quiet = i < n && peak < threshold;
    if (quiet && quietFrom < 0) quietFrom = i;
    if (!quiet && quietFrom >= 0) { if ((i - quietFrom) * 10 >= minMs) gaps.push({ startMs: quietFrom * 10, endMs: i * 10 }); quietFrom = -1; }
  }
  return gaps;
}

export type CaptionEvent = { startMs: number; endMs: number; lines: string[][]; active: number };
/** How long a phrase stays after its last word, when nothing follows it. */
export const CAPTION_LINGER_MS = 260;

/**
 * The caption track of a cut: for every word, one event that shows its whole phrase with that word
 * active. `clips` are the narration lines on the cut's clock (after tightening and speed-up).
 */
export function captionEvents(clips: readonly { text: string; startMs: number; endMs: number; gaps?: readonly Gap[] }[], maxW: number, px: number, endMs: number): CaptionEvent[] {
  const events: CaptionEvent[] = [];
  clips.forEach((clip, c) => {
    const times = wordTimes(clip.text, clip.startMs, clip.endMs - clip.startMs, clip.gaps ?? []);
    const stop = Math.min(clip.endMs + CAPTION_LINGER_MS, clips[c + 1]?.startMs ?? endMs, endMs);
    let k = 0;
    const phrases = chunkCaption(clip.text, maxW, px);
    phrases.forEach((phrase, p) => {
      phrase.words.forEach((_w, i) => {
        const t = times[k + i], next = times[k + i + 1];
        const lastOfClip = p === phrases.length - 1 && i === phrase.words.length - 1;
        const end = lastOfClip ? stop : next ? next.startMs : t.endMs;
        if (end > t.startMs) events.push({ startMs: t.startMs, endMs: end, lines: phrase.lines, active: i });
      });
      k += phrase.words.length;
    });
  });
  return events;
}

const assClock = (ms: number): string => {
  const cs = Math.max(0, Math.round(ms / 10));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** Anton's line box is 1.733 em (OS/2 winAscent + winDescent over the em): libass sizes type by that box. */
export const ASS_SIZE_PER_EM = (2876 + 674) / 2048;
/** Brand orange hsl(25 95% 53%) = #f97316, as ASS writes a colour (BGR). */
const ASS_ORANGE = "&H1673F9&", ASS_WHITE = "&HFFFFFF&";

/** Distance between the two caption lines' centres, and the height their ink takes (capitals are 0.86 em tall). */
export const captionPitch = (l: Pick<Layout, "captionPx">): number => Math.round(l.captionPx * 1.16);
export const captionInkHeight = (l: Pick<Layout, "captionPx">, lines = 2): number => Math.round((lines - 1) * captionPitch(l) + l.captionPx * 0.86 + 2 * 6);

/** The captions as an ASS file: heavy capitals, white with a dark stroke, the active word in the brand orange. */
export function assFile(events: readonly CaptionEvent[], l: Layout): string {
  const cx = Math.round(l.captions.x + l.captions.w / 2), cy = Math.round(l.captions.y + l.captions.h / 2);
  const size = Math.round(l.captionPx * ASS_SIZE_PER_EM);
  const head = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${l.width}`, `PlayResY: ${l.height}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Anton,${size},&H00FFFFFF,&H00FFFFFF,&H00401A06,&H96000000,0,0,0,0,100,100,1,0,1,6,3,5,0,0,0,1`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const esc = (w: string) => w.toUpperCase().replace(/[{}\\]/g, "");
  // One event per LINE, each placed by hand: libass would set two lines a whole line box (1.73 em) apart,
  // which is too loose for capitals and too tall for the caption strip.
  const pitch = captionPitch(l);
  const rows = events.flatMap((e) => {
    let i = 0;
    return e.lines.map((line, k) => {
      const text = line.map((w) => (i++ === e.active ? `{\\1c${ASS_ORANGE}}${esc(w)}{\\1c${ASS_WHITE}}` : esc(w))).join(" ");
      const y = Math.round(cy + (k - (e.lines.length - 1) / 2) * pitch);
      return `Dialogue: 0,${assClock(e.startMs)},${assClock(e.endMs)},Cap,,0,0,0,,{\\an5\\pos(${cx},${y})}${text}`;
    });
  });
  return [...head, ...rows, ""].join("\n");
}

/* ── The camera: a crop of the master that follows the highlighted control ── */

/** A box in master pixels. */
export type Box = { x: number; y: number; w: number; h: number };
export type Shot = { cx: number; cy: number; cropW: number };
export type Keyframe = { atMs: number; durMs: number; shot: Shot };
export type FocusStep = {
  step: number;
  /** The control the step points at (the recorder's ring), or null when the step has none. */
  box: Box | null;
  /** When the ring left (a click drops it once it has done its job), on the cut's clock; null = it stayed. */
  ringOffMs?: number | null;
  outStartMs: number; outEndMs: number;
};

export const PAN_MS = 650;
/** Camera moves smaller than this are not worth making (they read as jitter). */
export const MIN_MOVE_PX = 90;

/** The widest shot a panel can show without bars: the master's full height. */
export const maxCropW = (panel: Rect, src: { width: number; height: number }): number => Math.min(src.width, Math.floor((src.height * panel.w) / panel.h));

/**
 * The shot for a step. With a target: centred on it (a little above centre, because what a control
 * opens appears below it), at the layout's normal zoom — wider only when the target itself is wider
 * than the shot. Without one (a page that has just opened): the page's content, wide.
 */
export function shotFor(box: Box | null, l: Layout, src: { width: number; height: number }): Shot {
  // The layout's numbers are for a 1920-wide master; an older 1280×720 one is framed the same way (and upscaled more).
  const widest = maxCropW(l.panel, src), k = src.width / 1920;
  let shot: Shot;
  if (!box) shot = { cx: src.width * 0.6, cy: src.height * 0.48, cropW: Math.min(widest, 1320 * k) };
  else {
    const cropW = Math.min(widest, Math.max(l.baseCropW * k, box.w / 0.84, (box.h / 0.7) * (l.panel.w / l.panel.h)));
    shot = { cx: box.x + box.w / 2, cy: box.y + box.h / 2 + ((cropW * l.panel.h) / l.panel.w) * 0.07, cropW };
  }
  return clampShot(shot, l, src);
}
/** Keep the whole crop inside the master. */
export function clampShot(s: Shot, l: Layout, src: { width: number; height: number }): Shot {
  const cropW = Math.min(s.cropW, maxCropW(l.panel, src)), cropH = (cropW * l.panel.h) / l.panel.w;
  return { cropW, cx: Math.min(src.width - cropW / 2, Math.max(cropW / 2, s.cx)), cy: Math.min(src.height - cropH / 2, Math.max(cropH / 2, s.cy)) };
}
export const cropOf = (s: Shot, l: Layout): Box => { const h = (s.cropW * l.panel.h) / l.panel.w; return { x: s.cx - s.cropW / 2, y: s.cy - h / 2, w: s.cropW, h }; };

/**
 * The camera's keyframes for a cut. It opens wide and pushes in during the hook (the first second
 * and a half is motion, not a still); at each step it eases to that step's shot; after a click has
 * landed (its ring gone) it moves on to where the next step will point, so what the click opened is
 * in frame. A move too small to matter is skipped.
 */
export function cameraKeyframes(steps: readonly FocusStep[], l: Layout, src: { width: number; height: number }): { start: Shot; keys: Keyframe[] } {
  const start = clampShot({ cx: src.width / 2, cy: src.height / 2, cropW: maxCropW(l.panel, src) }, l, src);
  const keys: Keyframe[] = [];
  let cur = start, busyUntil = 0;
  const go = (atMs: number, durMs: number, shot: Shot, force = false) => {
    const at = Math.max(atMs, busyUntil);
    const small = MIN_MOVE_PX * (src.width / 1920);
    if (!force && Math.hypot(shot.cx - cur.cx, shot.cy - cur.cy) < small && Math.abs(shot.cropW - cur.cropW) < small) return;
    keys.push({ atMs: at, durMs, shot }); cur = shot; busyUntil = at + durMs;
  };
  steps.forEach((s, i) => {
    const shot = shotFor(s.box, l, src);
    if (i === 0) go(60, 1350, shot, true); // the hook's push-in
    else go(s.outStartMs + 40, PAN_MS, shot);
    const next = steps[i + 1];
    if (s.box && s.ringOffMs != null && s.outEndMs - s.ringOffMs > 900) go(s.ringOffMs + 120, PAN_MS, shotFor(next?.box ?? null, l, src));
  });
  return { start, keys };
}

/** The shot at a moment of the cut (smoothstep between keyframes) — what the ffmpeg expressions below compute. */
export function shotAt(cam: { start: Shot; keys: readonly Keyframe[] }, ms: number): Shot {
  const s = { ...cam.start };
  let prev = cam.start;
  for (const k of cam.keys) {
    const u = Math.min(1, Math.max(0, (ms - k.atMs) / k.durMs)), e = u * u * (3 - 2 * u);
    s.cx += (k.shot.cx - prev.cx) * e; s.cy += (k.shot.cy - prev.cy) * e; s.cropW += (k.shot.cropW - prev.cropW) * e;
    prev = k.shot;
  }
  return s;
}

/**
 * ffmpeg expressions (of `t`, seconds) for the camera: the master is scaled by `zoom` every frame
 * and laid on the canvas with its top-left at (−x, panel.y − y), so the panel shows the crop.
 * Zoom, x and y are each a sum of eased steps — the same curve `shotAt` computes.
 */
export function cameraExpr(cam: { start: Shot; keys: readonly Keyframe[] }, l: Layout): { zoom: string; x: string; y: string } {
  const pose = (s: Shot) => { const z = l.panel.w / s.cropW; return { z, x: (s.cx - s.cropW / 2) * z, y: (s.cy - (s.cropW * l.panel.h) / l.panel.w / 2) * z }; };
  const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
  const build = (pick: (p: { z: number; x: number; y: number }) => number): string => {
    let prev = pose(cam.start), expr = f(pick(prev));
    for (const k of cam.keys) {
      const p = pose(k.shot), d = pick(p) - pick(prev);
      prev = p;
      if (Math.abs(d) < 1e-4) continue;
      const u = `clip((t-${f(k.atMs / 1000)})/${f(k.durMs / 1000)},0,1)`;
      expr += `${d < 0 ? "-" : "+"}${f(Math.abs(d))}*${u}*${u}*(3-2*${u})`;
    }
    return expr;
  };
  return { zoom: build((p) => p.z), x: build((p) => p.x), y: build((p) => p.y) };
}

/* ── Finding the recorder's ring in a frame (masters recorded before target boxes were saved) ── */

/** The ring is the brand orange, hsl(25 95% 53%) = rgb(249,115,22), 3 CSS px wide; H.264 softens it a little. */
export const isRingOrange = (r: number, g: number, b: number): boolean => r >= 212 && g >= 82 && g <= 152 && b <= 78 && r - g >= 78;

/** The first video (Database Directory, 1280×720) was recorded with the ring in the surface accent, #1a73e8. */
export const isRingBlue = (r: number, g: number, b: number): boolean => r <= 80 && g >= 85 && g <= 150 && b >= 195;

/**
 * The highlight ring in one RGB24 frame: a hollow orange rectangle — two thin horizontal bars of the
 * same extent joined by two thin vertical ones. The app's own orange buttons are solid, so their
 * "bars" are thick and are ignored. Returns the ring's box (what it surrounds), or null.
 */
export function findRing(rgb: Uint8Array | Buffer, width: number, height: number, isRing: (r: number, g: number, b: number) => boolean = isRingOrange): Box | null {
  const isRingOrange = isRing; // every test below is against the ring colour asked for
  type Bar = { x0: number; x1: number; y0: number; y1: number; open: boolean };
  const MIN_RUN = 36, MAX_THICK = 13, SLACK = 30;
  const bars: Bar[] = [], open: Bar[] = [];
  for (let y = 0; y < height; y++) {
    const runs: [number, number][] = [];
    let from = -1;
    const row = y * width * 3;
    for (let x = 0; x <= width; x++) {
      const on = x < width && isRingOrange(rgb[row + x * 3], rgb[row + x * 3 + 1], rgb[row + x * 3 + 2]);
      if (on && from < 0) from = x;
      if (!on && from >= 0) { if (x - from >= MIN_RUN) runs.push([from, x - 1]); from = -1; }
    }
    for (const b of open) b.open = false;
    for (const [x0, x1] of runs) {
      const b = open.find((o) => o.y1 === y - 1 && Math.abs(o.x0 - x0) <= SLACK && Math.abs(o.x1 - x1) <= SLACK);
      if (b) { b.y1 = y; b.x0 = Math.min(b.x0, x0); b.x1 = Math.max(b.x1, x1); b.open = true; }
      else { const nb = { x0, x1, y0: y, y1: y, open: true }; open.push(nb); }
    }
    for (let i = open.length - 1; i >= 0; i--) if (!open[i].open) { bars.push(open[i]); open.splice(i, 1); }
  }
  bars.push(...open);
  const thin = bars.filter((b) => b.y1 - b.y0 + 1 >= 2 && b.y1 - b.y0 + 1 <= MAX_THICK);
  // The ring's corners are round (12 CSS px): its straight top edge stops short of its sides, which
  // are therefore looked for from a little inside the bar's end to a corner's width outside it.
  const CORNER = 30;
  const side = (from: number, to: number, y0: number, y1: number): number => {
    let hit = 0, n = 0;
    for (let y = y0; y <= y1; y++, n++) {
      for (let xx = from; xx <= to; xx++) {
        if (xx < 0 || xx >= width) continue;
        const o = (y * width + xx) * 3;
        if (isRingOrange(rgb[o], rgb[o + 1], rgb[o + 2])) { hit++; break; }
      }
    }
    return n ? hit / n : 0;
  };
  let best: Box | null = null;
  for (const top of thin) for (const bottom of thin) {
    if (bottom.y0 - top.y1 < 18 || Math.abs(top.x0 - bottom.x0) > 10 || Math.abs(top.x1 - bottom.x1) > 10) continue;
    const inset = Math.min(26, Math.floor((bottom.y0 - top.y1) / 4)), y0 = top.y1 + inset, y1 = bottom.y0 - inset;
    const x0 = Math.min(top.x0, bottom.x0), x1 = Math.max(top.x1, bottom.x1);
    const left = x0 <= CORNER ? 1 : side(x0 - CORNER, x0 + 6, y0, y1), right = x1 >= width - CORNER ? 1 : side(x1 - 6, x1 + CORNER, y0, y1);
    if (left < 0.7 || right < 0.7) continue;
    // Hollow: a selected menu item or a button is orange all the way through.
    let inOrange = 0, inAll = 0;
    for (let y = top.y1 + 10; y <= bottom.y0 - 10; y += 2) for (let x = x0 + 12; x <= x1 - 12; x += 3, inAll++) {
      const o = (y * width + x) * 3;
      if (isRingOrange(rgb[o], rgb[o + 1], rgb[o + 2])) inOrange++;
    }
    if (inAll && inOrange / inAll > 0.3) continue;
    const box = { x: Math.max(0, x0 - 20), y: top.y0, w: Math.min(width, x1 + 20) - Math.max(0, x0 - 20) + 1, h: bottom.y1 - top.y0 + 1 };
    if (!best || box.w * box.h > best.w * best.h) best = box;
  }
  return best;
}

export type RingSample = { ms: number; box: Box | null };
const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * One step's target from the ring samples that fall inside it (times on the master's clock): the
 * ring's usual box while it was there, and when it left for good before the step ended.
 */
export function stepFocus(samples: readonly RingSample[], fromMs: number, toMs: number): { box: Box | null; ringOffMs: number | null } {
  const mine = samples.filter((s) => s.ms >= fromMs && s.ms < toMs), seen = mine.filter((s) => s.box);
  if (seen.length < 2) return { box: null, ringOffMs: null };
  // The ring glides in with its target (a list that scrolls into place): the later half is where it rests.
  const settled = seen.slice(Math.floor(seen.length / 3));
  const box = { x: median(settled.map((s) => s.box!.x)), y: median(settled.map((s) => s.box!.y)), w: median(settled.map((s) => s.box!.w)), h: median(settled.map((s) => s.box!.h)) };
  const lastSeen = seen[seen.length - 1].ms, after = mine.filter((s) => s.ms > lastSeen);
  return { box, ringOffMs: after.length >= 2 ? after[0].ms : null };
}
