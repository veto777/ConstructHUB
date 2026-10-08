/**
 * Where the words of a gator short go, and how big — pure, so the safe areas are tested
 * (server/tutorials/gator.test.ts). The picture is the AI clip full-frame, 1080×1920; the words are
 * meme captions: Anton capitals, white with a black edge, one word in the brand orange.
 *
 * Two places a caption may sit, both clear of what the platforms draw over a vertical video
 * (SAFE_AREA in scripts/tutorials/social-lib.ts: top 14% tabs, bottom 22% account + caption + audio,
 * right 16% the like / comment / share column in the lower part of the frame):
 *   top   under the tabs, full width — the hook and most beats
 *   low   above the platform's own caption, clear of the button column — a punchline, a reply
 */
import { ASS_SIZE_PER_EM, SAFE_AREA, textWidth, type Rect } from "../tutorials/social-lib";

export const W = 1080, H = 1920, FPS = 30;
export const END_TAG_SEC = 1.5;
/** A clip is a Short / Reel everywhere under a minute; ours are far shorter. */
export const MAX_SEC = 30;
const S = SAFE_AREA.vertical;
export const ZONES: Record<"top" | "low", Rect> = {
  top: { x: Math.round(W * S.left), y: Math.round(H * S.top) + 12, w: W - 2 * Math.round(W * S.left), h: 400 },
  low: { x: Math.round(W * S.left), y: 1070, w: Math.round(W * (1 - S.left - S.right)), h: H - Math.round(H * S.bottom) - 1070 - 96 },
};
/** The small CHUB logo: bottom-left of the safe area, under the low caption zone. */
export const LOGO_RECT: Rect = { x: Math.round(W * S.left), y: H - Math.round(H * S.bottom) - 76, w: 236, h: 64 };
export const ORANGE = "#f97316";

export type Beat = {
  /** Seconds from the start of the clip (not of the shot) — filled in by the planner. */
  at: number; until: number; text: string;
  /** The one word drawn in orange (as written in `text`, punctuation ignored). */
  accent?: string; pos: "top" | "low";
};
export type CaptionBox = { beat: Beat; px: number; lines: string[]; rect: Rect };

export const MAX_PX = 132, MIN_PX = 64, MAX_LINES = 3;
const pitch = (px: number) => Math.round(px * 1.14);
const EDGE = 14;
/** How far below the top of its line box Anton's capitals start, in ems (the font's ascent is taller than its capitals). */
const TOP_BEARING = 0.3;
/** Break words into at most `maxLines` lines no wider than `maxW` at `px` — or null when they do not fit. */
export function wrapCaption(text: string, maxW: number, px: number, maxLines = MAX_LINES): string[] | null {
  const words = text.trim().toUpperCase().split(/\s+/), lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (textWidth(w, px) > maxW) return null;
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, px) <= maxW) line = next; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) return null;
  // No orphan: a last line of one short word gets company from the line above when that still fits.
  const n = lines.length;
  if (n >= 2 && !lines[n - 1].includes(" ") && lines[n - 2].includes(" ")) {
    const prev = lines[n - 2].split(" "), moved = `${prev[prev.length - 1]} ${lines[n - 1]}`;
    if (textWidth(moved, px) <= maxW) { lines[n - 2] = prev.slice(0, -1).join(" "); lines[n - 1] = moved; }
  }
  return lines;
}

/** The biggest type at which a beat fits its zone: big enough to read on a phone, or an error. */
export function layoutBeat(beat: Beat): CaptionBox {
  const zone = ZONES[beat.pos], edge = EDGE;
  for (let px = MAX_PX; px >= MIN_PX; px -= 4) {
    const lines = wrapCaption(beat.text, zone.w - 2 * edge, px);
    if (!lines) continue;
    const h = (lines.length - 1) * pitch(px) + Math.round(px * 1.02) + 2 * edge;
    if (h > zone.h) continue;
    const w = Math.max(...lines.map((l) => textWidth(l, px))) + 2 * edge;
    // top: hangs from the top of its zone; low: stands on the bottom of its zone. Both centred in the zone.
    const rect = { x: Math.round(zone.x + (zone.w - w) / 2), y: beat.pos === "top" ? zone.y : zone.y + zone.h - h, w: Math.round(w), h };
    return { beat, px, lines, rect };
  }
  throw new Error(`“${beat.text}” does not fit the ${beat.pos} caption zone at a readable size — shorten it`);
}

const assTime = (s: number) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const bgr = (hex: string) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** The captions as an ASS file (libass draws Anton from the work folder). Each beat pops in over three frames. */
export function assFile(boxes: readonly CaptionBox[]): string {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Meme,Anton,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,9,5,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // One event per line, each placed by its own top-centre: the leading is ours (pitch), not libass's.
  const events = boxes.flatMap((b) => {
    const acc = b.beat.accent ? bare(b.beat.accent) : null, cx = Math.round(b.rect.x + b.rect.w / 2), size = Math.round(b.px * ASS_SIZE_PER_EM);
    return b.lines.map((l, i) => {
      const text = l.split(" ").map((w) => (acc && bare(w) === acc ? `{\\c${bgr(ORANGE)}}${w}{\\c&HFFFFFF&}` : w)).join(" ");
      return `Dialogue: 0,${assTime(b.beat.at)},${assTime(b.beat.until)},Meme,,0,0,0,,{\\an8\\pos(${cx},${b.rect.y + EDGE + i * pitch(b.px) - Math.round(b.px * TOP_BEARING)})\\fs${size}\\bord${Math.max(6, Math.round(b.px * 0.085))}\\shad${Math.round(b.px * 0.05)}\\fscx78\\fscy78\\t(0,100,\\fscx104\\fscy104)\\t(100,160,\\fscx100\\fscy100)}${text}`;
    });
  });
  return head + events.join("\n") + "\n";
}
