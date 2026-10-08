/**
 * The frames no walkthrough may contain (owner, 2026-10-08: "this random page that shows the terms
 * and the policy stuff between shots"):
 *
 *   fallback  the static text of client/index.html's #root — "ConstructHUB … Privacy Policy · Terms
 *             of Use · support@…" on a bare white page — which a browser showed on every full page
 *             load until the app mounted;
 *   blank     a page that is one flat colour (the recorder's old white veil, a page that has not
 *             drawn) for longer than 200 ms.
 *
 * `findFlashes` reads EVERY frame of a finished video (30 a second — more than the four a second and
 * the frames around each page load that would be enough to catch one), at 192×108 grey, and compares
 * each with the fallback as this machine draws it at the recording's own size: the fallback the old
 * masters hold, and the one index.html ships today. Outside the intro and end cards.
 *
 * check.ts fails a video that has any; deflash.ts repairs one without recording it again.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { chromium } from "playwright";
import { ENCODE_LOCK, ROOT, withLock } from "./lib";

export const SCAN = { width: 192, height: 108 };
const PIXELS = SCAN.width * SCAN.height;

/** What index.html held in #root until 2026-10-08 — the text every master made before then may show. */
export const LEGACY_FALLBACK = `<main style="max-width:720px;margin:40px auto;padding:0 16px;font-family:system-ui,sans-serif">
        <h1>ConstructHUB</h1>
        <p>ConstructHUB is an all-in-one growth platform and CRM for contractors: permit and property-record directories, estimates, invoices and scheduling, and tools to manage your own Google Business Profile — sync your reviews, reply to customers, and view your profile's performance.</p>
        <p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="mailto:support@constructhub.us">support@constructhub.us</a></p>
      </main>`;
/** The fallback index.html ships now (shown only without JavaScript — a recording must not show it either). */
export function currentFallback(): string {
  const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
  const m = /<main id="ch-fallback"[\s\S]*?<\/main>/.exec(html);
  if (!m) throw new Error('client/index.html has no <main id="ch-fallback">');
  return m[0];
}

export type Frames = { count: number; fps: number; width: number; height: number; durationMs: number; grey: Buffer };

/** Every frame of a video as 192×108 grey. Under the machine-wide encode lock, niced, four threads. */
export async function readFrames(file: string): Promise<Frames> {
  const probe = await new Promise<string>((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", file], { stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; p.stdout.on("data", (d) => { out += d; }); p.on("error", reject); p.on("close", (c) => c === 0 ? resolve(out) : reject(new Error(`ffprobe exited ${c}`)));
  });
  const info = JSON.parse(probe), st = info.streams[0];
  const [num, den] = String(st.r_frame_rate).split("/").map(Number);
  const grey = await withLock(ENCODE_LOCK, () => new Promise<Buffer>((resolve, reject) => {
    const p = spawn("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4", "-i", file, "-an",
      "-vf", `scale=${SCAN.width}:${SCAN.height}:flags=area,format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (c) => c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${c} reading ${file}`)));
  }));
  const count = Math.floor(grey.length / PIXELS);
  if (!count) throw new Error(`${file}: no frames`);
  return { count, fps: num / (den || 1), width: st.width, height: st.height, durationMs: Number(info.format.duration) * 1000, grey };
}

/** The fallbacks as this machine draws them in a window of `viewport` at device scale `zoom`, at scan size. */
export async function fallbackReferences(viewport: { width: number; height: number }, zoom: number): Promise<Buffer[]> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tut-fallback-"));
  const browser = await chromium.launch();
  try {
    const out: Buffer[] = [];
    for (const [i, main] of [LEGACY_FALLBACK, currentFallback()].entries()) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: zoom, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.setContent(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body><div id="root">${main}</div></body></html>`);
      const png = path.join(tmp, `${i}.png`);
      await page.screenshot({ path: png });
      await context.close();
      out.push(await new Promise<Buffer>((resolve, reject) => {
        const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", png, "-vf", `scale=${SCAN.width}:${SCAN.height}:flags=area,format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
        const chunks: Buffer[] = []; p.stdout.on("data", (d: Buffer) => chunks.push(d)); p.on("error", reject);
        p.on("close", (c) => c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${c}`)));
      }));
    }
    return out;
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export type FrameLook = { flat: number; bright: number; likeness: number; mean: number };
/**
 * One frame, measured: `flat` — the share of its pixels within a hair of its commonest grey;
 * `bright` — the share that is near white; `likeness` — how much its ink lies where a fallback's
 * does (normalised correlation of darkness with the closest reference, 0…1).
 */
export function lookAt(grey: Buffer, offset: number, refs: Buffer[]): FrameLook {
  const hist = new Uint32Array(256);
  let sum = 0, bright = 0;
  for (let i = 0; i < PIXELS; i++) { const v = grey[offset + i]; hist[v]++; sum += v; if (v >= 225) bright++; }
  let mode = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[mode]) mode = v;
  let flat = 0;
  for (let v = Math.max(0, mode - 6); v <= Math.min(255, mode + 6); v++) flat += hist[v];
  let likeness = 0;
  for (const ref of refs) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < PIXELS; i++) { const a = 255 - grey[offset + i], b = 255 - ref[i]; ab += a * b; aa += a * a; bb += b * b; }
    if (aa > 0 && bb > 0) likeness = Math.max(likeness, ab / Math.sqrt(aa * bb));
  }
  return { flat: flat / PIXELS, bright: bright / PIXELS, likeness, mean: sum / PIXELS };
}

export const LIMITS = {
  /** A frame is "one flat colour" at this share of its pixels… */
  flat: 0.97,
  /** …and a run of them is a defect when it lasts longer than this. */
  flatMs: 200,
  /** A frame is the fallback when its ink correlates this well with the reference on a page this white. */
  likeness: 0.72, bright: 0.8,
};
export const isFallback = (l: FrameLook) => l.likeness >= LIMITS.likeness && l.bright >= LIMITS.bright && l.flat < 0.999;
export const isFlat = (l: FrameLook) => l.flat >= LIMITS.flat;

export type Span = {
  /** First and last frame (inclusive), and the same in ms of the video. */
  from: number; to: number; startMs: number; ms: number;
  kind: "fallback" | "blank" | "fallback+blank";
  /** Frames of each kind, and the frames after it during which the old white veil was still lifting. */
  fallbackFrames: number; blankFrames: number; washFrames: number;
};

/**
 * Runs of bad frames between the two cards. `looks[i]` describes frame i; `body` is the first and
 * last frame of the recording itself. A run counts when it holds a fallback frame, or is flat for
 * longer than 200 ms. Each span is extended over the frames right after it that are still fading in
 * from white (the old recorder's veil lifting), so a repair does not leave half a flash behind.
 */
export function spansOf(looks: FrameLook[], fps: number, body: { first: number; last: number }): Span[] {
  const bad = (i: number) => i >= body.first && i <= body.last && (isFallback(looks[i]) || isFlat(looks[i]));
  const spans: Span[] = [];
  for (let i = body.first; i <= body.last; i++) {
    if (!bad(i)) continue;
    let j = i, fallbackFrames = 0, blankFrames = 0;
    // Two bad runs a frame or two apart are one flash.
    while (j <= body.last && (bad(j) || (j + 1 <= body.last && bad(j + 1)) || (j + 2 <= body.last && bad(j + 2) && bad(j - 1)))) {
      if (bad(j)) { if (isFallback(looks[j])) fallbackFrames++; else blankFrames++; }
      j++;
    }
    let to = j - 1;
    while (to > i && !bad(to)) to--;
    const flatMs = (blankFrames * 1000) / fps;
    if (fallbackFrames > 0 || flatMs > LIMITS.flatMs) {
      // The veil lifting: each frame a little less white than the one before, for up to a third of a second.
      let wash = 0;
      const light = looks[to].mean >= 128;
      while (to + wash + 2 <= body.last && wash < 10 && (light ? looks[to + wash + 1].mean - looks[to + wash + 2].mean > 0.35 : looks[to + wash + 2].mean - looks[to + wash + 1].mean > 0.35)) wash++;
      const end = to + wash;
      spans.push({ from: i, to: end, startMs: Math.round((i * 1000) / fps), ms: Math.round(((end - i + 1) * 1000) / fps),
        kind: fallbackFrames && blankFrames ? "fallback+blank" : fallbackFrames ? "fallback" : "blank", fallbackFrames, blankFrames, washFrames: wash });
      i = end;
    } else i = to;
  }
  return spans;
}

export type FlashReport = { frames: number; fps: number; durationMs: number; body: { first: number; last: number }; spans: Span[]; totalMs: number; worstLikenessOutside: number };

/**
 * Find every fallback / blank span of a finished walkthrough. `cardMs` and `endCardMs` are the
 * intro and end cards (video.json); `viewport` and `zoom` are the recording's (timings.json).
 */
export async function findFlashes(file: string, o: { cardMs: number; endCardMs: number; viewport: { width: number; height: number }; zoom: number; refs?: Buffer[] }): Promise<FlashReport> {
  const frames = await readFrames(file);
  const refs = o.refs ?? await fallbackReferences(o.viewport, o.zoom);
  const looks: FrameLook[] = [];
  for (let i = 0; i < frames.count; i++) looks.push(lookAt(frames.grey, i * PIXELS, refs));
  const body = { first: Math.round((o.cardMs / 1000) * frames.fps), last: frames.count - 1 - Math.round((o.endCardMs / 1000) * frames.fps) };
  const spans = spansOf(looks, frames.fps, body);
  const inSpan = new Uint8Array(frames.count);
  for (const s of spans) for (let i = s.from; i <= s.to; i++) inSpan[i] = 1;
  let worst = 0;
  for (let i = body.first; i <= body.last; i++) if (!inSpan[i] && looks[i].bright >= LIMITS.bright) worst = Math.max(worst, looks[i].likeness);
  return { frames: frames.count, fps: frames.fps, durationMs: frames.durationMs, body, spans, totalMs: spans.reduce((n, s) => n + s.ms, 0), worstLikenessOutside: worst };
}

export const describeSpan = (s: Span): string =>
  `${s.kind === "blank" ? "a blank page" : s.kind === "fallback" ? "the static fallback page" : "the static fallback page, then a blank page"} at ${(s.startMs / 1000).toFixed(2)} s for ${s.ms} ms (frames ${s.from}–${s.to})`;
