/**
 * SOCIAL CUTS — the stage after the master (docs/tutorials/PRODUCER-GUIDE.md, "Social cuts").
 *
 *   npx tsx scripts/tutorials/social.ts <helpKey> [--out-dir DIR]… [--out FOLDER] [--only vertical|feed]
 *                                                   [--text-only] [--keep-work]
 *   npx tsx scripts/tutorials/social.ts --all [--out-dir DIR]… [--force]      backfill every finished master
 *
 * From a finished production folder (walkthrough.mp4, timings.json, narration.json — nothing is
 * re-recorded and the voice engine is never called) it writes, into <folder>/social/:
 *
 *   vertical.mp4        1080×1920, 30 fps, H.264 + AAC, at most 59 s — Reels, TikTok, Shorts, Threads, X
 *   feed.mp4            1080×1350 (4:5), at most 89 s — LinkedIn, Facebook, the Instagram feed
 *   cover-vertical.jpg, cover-feed.jpg
 *   social.json         what was measured of each cut + the post text per platform (social-text.ts)
 *   focus.json          where the camera looked, step by step (and how that was found)
 *
 * A cut is the master's own picture and sound, re-framed: a crop of the 1920×1080 recording that
 * follows the highlighted control, under a branded band with the hook headline, with large
 * word-by-word captions burned in inside the platforms' safe areas, a progress bar and a 2 s end
 * card. Pauses between lines are tightened; if the walkthrough still does not fit, speech is sped up
 * by at most 8%, and if that is not enough the cut keeps the opening steps and its end card says
 * where the full walkthrough is. Deterministic: the same master gives the same cut.
 *
 * Every ffmpeg runs under the machine-wide encode lock, niced, with 4 threads (this box serves
 * production). No music, no third-party audio, no generated footage.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ENCODE_LOCK, ROOT, encodeWav, parseArgs, run, sha256, type NarrationIndex, type Timings } from "./lib";
import { LOUDNESS, measureLoudness } from "./mux";
import { renderStill } from "./brand";
import { coverHtml, endHtml, frameHtml, hookHtml, type HookSpec } from "./social-brand";
import {
  CUT_NAMES, LAYOUTS, assFile, cameraExpr, cameraKeyframes, captionEvents, cropOf, findGaps, findRings, isRingBlue, pickRings, planCut, shotAt, stepFocus,
  type Box, type CutName, type CutPlan, type FocusStep, type Layout, type RingSample,
} from "./social-lib";
import { buildSocialText, type SocialEntry } from "./social-text";
import { parseTutorialScript, type TutorialScript } from "../../shared/help/step-script";
import { helpEntry } from "../../shared/help/registry";
import { readOrder, trackOf } from "../../server/youtube/schedule";

const FPS = 30, RATE = 48000;
const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
const CODEC = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "21", "-maxrate", "9M", "-bufsize", "18M", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
  "-c:a", "aac", "-b:a", "128k", "-ar", String(RATE), "-ac", "2"];
/** No cut may weigh more than this (every platform takes far more; a phone on mobile data should not). */
export const MAX_BYTES = 25_000_000;
/** How often the master is looked at for the ring, when the recording did not save its target boxes. */
const RING_FPS = 4;
/** Where finished masters live on this box: this checkout's, the first producers' and the batch worktrees'. */
export const DEFAULT_OUT_DIRS = [
  path.join(ROOT, "analysis", "video-out"), "/home/voiceban/ConstructHUB-seo/analysis/video-out",
  ...["a", "b", "c", "d", "e", "f"].map((s) => `/home/voiceban/ConstructHUB-vid-${s}/analysis/video-out`),
];
const NEEDS = ["walkthrough.mp4", "timings.json", "narration.json", "video.json"];
const isMaster = (dir: string) => NEEDS.every((f) => fs.existsSync(path.join(dir, f)));

/** The step script of a master: this checkout's, else the one in the worktree the master was produced in, else a sibling's. */
function findScript(helpKey: string, folder: string): string {
  const worktree = path.resolve(folder, "../../..");
  const places = [ROOT, worktree, ...DEFAULT_OUT_DIRS.map((d) => path.resolve(d, "../.."))];
  for (const w of places) { const f = path.join(w, "docs", "tutorials", "scripts", `${helpKey}.json`); if (fs.existsSync(f)) return f; }
  throw new Error(`${helpKey}: no step script (docs/tutorials/scripts/${helpKey}.json) in this checkout or beside the master`);
}

/** Decode a file's audio to 16-bit mono PCM at 48 kHz. */
async function decodeAudio(file: string): Promise<Int16Array> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg (audio decode) exited ${c}`))));
  });
  const buf = Buffer.concat(chunks);
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)).slice();
}

/** Look at the master RING_FPS times a second between two moments and report where the recorder's ring is. */
type Seen = { ms: number; boxes: Box[] };
async function scanRing(file: string, fromS: number, toS: number, size: { width: number; height: number }): Promise<{ orange: Seen[]; blue: Seen[] }> {
  const frameBytes = size.width * size.height * 3, samples: Seen[] = [], blue: Seen[] = [];
  let pending = Buffer.alloc(0), n = 0;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4",
      "-ss", fromS.toFixed(3), "-t", (toS - fromS).toFixed(3), "-i", file, "-vf", `fps=${RING_FPS}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= frameBytes) {
        const ms = Math.round((fromS + n / RING_FPS) * 1000), frame = pending.subarray(0, frameBytes);
        samples.push({ ms, boxes: findRings(frame, size.width, size.height) });
        blue.push({ ms, boxes: findRings(frame, size.width, size.height, isRingBlue) });
        pending = pending.subarray(frameBytes); n++;
      }
    });
    child.on("error", reject);
    child.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg (ring scan) exited ${c}`))));
  });
  return { orange: samples, blue };
}

type Focus = { source: "recorded" | "ring"; steps: { step: number; box: Box | null; ringOffMs: number | null; guess?: string }[] };

export type CutResult = {
  file: string; width: number; height: number; fps: number; durationSec: number; bytes: number; sha256: string;
  lufs: number; truePeakDb: number; speed: number; steps: number[]; truncated: boolean; cover: string;
  /**
   * TikTok takes no cover image, only a moment of the video (`videoCoverTimestamp`): its file is the
   * vertical cut with the designed cover as its first half second, and `coverMs` is inside that.
   */
  tiktok?: { file: string; durationSec: number; bytes: number; sha256: string; coverMs: number };
};
/** How long the cover is held at the start of TikTok's file, and the moment handed to TikTok as the cover. */
const TIKTOK_COVER_S = 0.5, TIKTOK_COVER_MS = 200;

export async function makeSocial(helpKey: string, folder: string, opts: { only?: CutName; textOnly?: boolean; keepWork?: boolean } = {}): Promise<{ dir: string; cuts: Partial<Record<CutName, CutResult>> }> {
  if (!isMaster(folder)) throw new Error(`${folder} is not a finished production (${NEEDS.join(", ")})`);
  const at = (f: string) => path.join(folder, f);
  const scriptFile = findScript(helpKey, folder);
  const { $schema: _s, ...json } = JSON.parse(fs.readFileSync(scriptFile, "utf8"));
  const script: TutorialScript = parseTutorialScript(json);
  if (script.helpKey !== helpKey) throw new Error(`${scriptFile} is the script of ${script.helpKey}`);
  const timings = JSON.parse(fs.readFileSync(at("timings.json"), "utf8")) as Timings;
  const narration = JSON.parse(fs.readFileSync(at("narration.json"), "utf8")) as NarrationIndex;
  const built = JSON.parse(fs.readFileSync(at("video.json"), "utf8")) as { cardMs: number; files: { video: { sha256: string } } };
  if (timings.steps.length !== script.steps.length) throw new Error(`${helpKey}: the master was recorded from another version of the script (${timings.steps.length} steps, the script has ${script.steps.length})`);
  script.steps.forEach((s, i) => { if (narration.clips.find((c) => c.index === i)?.text !== s.narration) throw new Error(`${helpKey}: step ${i}'s narration is not what the master says — the script changed since it was recorded`); });
  const src = timings.video ?? timings.viewport;
  const master = at("walkthrough.mp4");
  const masterSha = sha256(fs.readFileSync(master));
  if (masterSha !== built.files.video.sha256) throw new Error(`${helpKey}: walkthrough.mp4 is not the file video.json describes`);
  const entry = (helpEntry(helpKey) ?? null) as SocialEntry | null;
  const dir = at("social"), work = path.join(dir, "_work");
  fs.mkdirSync(work, { recursive: true });
  const out = (f: string) => path.join(dir, f);

  // ── The post text (true material only; throws when a post would break a rule) ──────────────────
  const tracks = readOrder(path.join(ROOT, "docs", "tutorials", "youtube-order.json"));
  const track = trackOf(helpKey, tracks);
  // The title the video carries on YouTube: the script's, else the ledger's (the first video was posted before scripts had one).
  const ledgerFile = path.join(ROOT, "docs", "tutorials", "youtube-schedule.json");
  const posted = fs.existsSync(ledgerFile) ? (JSON.parse(fs.readFileSync(ledgerFile, "utf8")).videos as { helpKey: string; title?: string }[]).find((v) => v.helpKey === helpKey) : undefined;
  const text = buildSocialText({ helpKey, title: script.youtube?.title ?? posted?.title ?? script.title, headline: script.thumbnail?.headline ?? null, entry, track: track === "other" ? null : track });
  const hook: HookSpec = {
    headline: script.thumbnail?.headline ?? script.title.split(/\s+/).slice(0, 5).join(" "),
    accent: script.thumbnail?.accent,
    kicker: script.thumbnail?.kicker ?? (entry?.group === "CRM" ? "CRM Tutorial" : "ConstructHUB Tutorial"),
  };
  const cuts: Partial<Record<CutName, CutResult>> = {};
  const previous = fs.existsSync(out("social.json")) ? JSON.parse(fs.readFileSync(out("social.json"), "utf8")) : null;

  if (!opts.textOnly) {
    /** Recorder clock → the master's clock (ms). */
    const m = (ms: number) => built.cardMs + (ms - timings.trimStartMs);
    const grid = 1000 / FPS, snap = (ms: number) => Math.round(ms / grid) * grid;

    // ── Where each step points: the recorder's saved target boxes, else the ring found in the frames ──
    let focus: Focus;
    const cached = fs.existsSync(out("focus.json")) ? JSON.parse(fs.readFileSync(out("focus.json"), "utf8")) : null;
    if (timings.steps.every((s) => "target" in s)) {
      const z = timings.zoom ?? 1;
      focus = { source: "recorded", steps: timings.steps.map((s) => ({ step: s.index, box: s.target ? { x: s.target.x * z, y: s.target.y * z, w: s.target.width * z, h: s.target.height * z } : null, ringOffMs: s.ringOffMs != null ? m(s.ringOffMs) : null })) };
    } else if (cached?.master === masterSha && cached.source === "ring") focus = cached;
    else {
      // The ring is the brand orange; the first video's was blue. Whichever colour marks more steps is this master's.
      const scan = await scanRing(master, m(timings.trimStartMs) / 1000, m(timings.endMs) / 1000, src);
      const stepOf = (ms: number) => timings.steps.findIndex((s) => ms >= m(s.startMs) && ms < m(s.endMs));
      const per = (seen: Seen[]) => { const samples: RingSample[] = pickRings(seen, stepOf); return timings.steps.map((s) => ({ step: s.index, ...stepFocus(samples, m(s.startMs), m(s.endMs)) })); };
      const orange = per(scan.orange), blue = per(scan.blue), count = (f: { box: Box | null }[]) => f.filter((x) => x.box).length;
      const main = count(blue) > count(orange) * 2 ? blue : orange;
      focus = {
        source: "ring",
        steps: main.map((f, i) => {
          if (f.box) return f;
          const action = timings.steps[i].action;
          // A field being typed in can lose its ring when its list reloads: its own blue focus outline says where it is.
          if ((action === "type" || action === "select") && main !== blue && blue[i].box) return { ...blue[i], guess: "the field's focus outline" };
          // "Look here" with no ring found is nearly always the selected item of the menu (orange on orange): show the whole menu.
          if (action === "highlight" && main !== blue) return { step: f.step, box: { x: 0, y: 0, w: Math.round(src.width * 0.24), h: src.height }, ringOffMs: null, guess: "the menu" };
          return f;
        }),
      };
    }
    fs.writeFileSync(out("focus.json"), JSON.stringify({ master: masterSha, ...focus }, null, 2) + "\n");
    const found = focus.steps.filter((s) => s.box).length;
    console.log(`  focus: ${focus.source === "recorded" ? "target boxes saved by the recorder" : "the ring, found in the frames"} — ${found} of ${focus.steps.length} steps have a target (the rest get the wide shot)`);

    const pcm = await decodeAudio(master);
    fs.copyFileSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"), path.join(work, "Anton-Regular.ttf"));

    for (const name of CUT_NAMES) {
      if (opts.only && opts.only !== name) { if (previous?.cuts?.[name]) cuts[name] = previous.cuts[name]; continue; }
      const l = LAYOUTS[name];
      // Steps on the master's clock, starts on its frame grid, so picture and sound are cut at the same instants.
      const plan = planCut(timings.steps.map((s, i) => ({
        index: s.index, startMs: snap(m(s.startMs)), endMs: snap(m(s.endMs)), narrationStartMs: m(s.narrationStartMs), narrationMs: s.narrationMs,
        holdMs: script.steps[i].holdMs, chapter: !!script.steps[i].chapter,
      })), { maxSec: l.maxSec, endCardSec: l.endCardSec, gridMs: grid });
      cuts[name] = await renderCut({ helpKey, l, plan, pcm, master, src, focus, hook, script, work, out, folder });
      const c = cuts[name]!;
      console.log(`  ${c.file}  ${c.width}x${c.height}  ${c.durationSec.toFixed(1)} s  ${(c.bytes / 1e6).toFixed(2)} MB  ${c.lufs} LUFS, true peak ${c.truePeakDb} dBTP  `
        + `speed ×${c.speed}${c.truncated ? `  steps 0–${c.steps[c.steps.length - 1]} of ${timings.steps.length - 1} (ends with “Full walkthrough on YouTube”)` : "  the whole walkthrough"}`);
    }
    if (!opts.keepWork) fs.rmSync(work, { recursive: true, force: true });
  } else { fs.rmSync(work, { recursive: true, force: true }); if (previous?.cuts) Object.assign(cuts, previous.cuts); }

  fs.writeFileSync(out("social.json"), JSON.stringify({
    helpKey, master: { file: "walkthrough.mp4", sha256: masterSha }, hook: { ...hook, line: text.hook }, area: text.area,
    cuts, platforms: text.platforms, notes: text.notes,
  }, null, 2) + "\n");
  for (const n of text.notes) console.log(`  note: ${n}`);
  return { dir, cuts };
}

async function renderCut(o: {
  helpKey: string; l: Layout; plan: CutPlan; pcm: Int16Array; master: string; src: { width: number; height: number }; focus: Focus; hook: HookSpec;
  script: TutorialScript; work: string; out: (f: string) => string; folder: string;
}): Promise<CutResult> {
  const { l, plan, work } = o, name = l.name, w = (f: string) => path.join(work, f);
  const K = plan.speed, bodyS = plan.bodyMs / 1000, totalS = plan.totalMs / 1000;

  // ── Sound: the kept stretches of the master's own track, joined in the silences between lines ──
  const parts = plan.segments.map((g) => o.pcm.subarray(Math.round((g.srcStartMs / 1000) * RATE), Math.round((g.srcEndMs / 1000) * RATE)));
  const samples = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  const fade = Math.round(RATE * 0.006);
  let pos = 0;
  for (const p of parts) {
    samples.set(p, pos);
    for (let i = 0; i < Math.min(fade, p.length); i++) { samples[pos + i] = Math.round(samples[pos + i] * (i / fade)); samples[pos + p.length - 1 - i] = Math.round(samples[pos + p.length - 1 - i] * (i / fade)); }
    pos += p.length;
  }
  fs.writeFileSync(w(`${name}.wav`), encodeWav({ sampleRate: RATE, samples }));
  const tempo = K > 1.0005 ? `atempo=${K},` : "";
  const target = `loudnorm=I=${LOUDNESS.I}:TP=-1.5:LRA=${LOUDNESS.LRA}`;
  const pass1 = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-i", w(`${name}.wav`), "-af", `${tempo}${target}:print_format=json`, "-f", "null", "-"], { nice: true })).stderr;
  const lm = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1)) as Record<string, string>;
  const loudnorm = `${target}:measured_I=${lm.input_i}:measured_TP=${lm.input_tp}:measured_LRA=${lm.input_lra}:measured_thresh=${lm.input_thresh}:offset=${lm.target_offset}:linear=true`;

  // ── Captions: every narration line on the cut's clock, a word at a time ────────────────────────
  const clips = plan.segments.map((g) => {
    const step = o.script.steps[g.step];
    const a = Math.round(((g.srcStartMs + (g.speechStartMs - g.outStartMs) * K) / 1000) * RATE), b = Math.round(((g.srcStartMs + (g.speechEndMs - g.outStartMs) * K) / 1000) * RATE);
    const gaps = findGaps(o.pcm.subarray(a, b), RATE).map((x) => ({ startMs: x.startMs / K, endMs: x.endMs / K }));
    return { text: step.narration, startMs: g.speechStartMs, endMs: g.speechEndMs, gaps };
  });
  const events = captionEvents(clips, l.captions.w - 24, l.captionPx, plan.bodyMs);
  fs.writeFileSync(w(`${name}.ass`), assFile(events, l));

  // ── The camera ────────────────────────────────────────────────────────────────────────────────
  const focusSteps: FocusStep[] = plan.segments.map((g) => {
    const f = o.focus.steps.find((s) => s.step === g.step);
    const off = f?.ringOffMs != null && f.ringOffMs < g.srcEndMs ? g.outStartMs + (f.ringOffMs - g.srcStartMs) / K : null;
    return { step: g.step, box: f?.box ?? null, ringOffMs: off, outStartMs: g.outStartMs, outEndMs: g.outEndMs };
  });
  const cam = cameraKeyframes(focusSteps, l, o.src), expr = cameraExpr(cam, l);
  fs.writeFileSync(w(`${name}.camera.json`), JSON.stringify({ plan, keys: cam.keys, crops: plan.segments.map((g) => ({ step: g.step, crop: cropOf(shotAt(cam, g.outEndMs - 150), l) })) }, null, 2));

  // ── Stills: the frame, the hook, the end card ─────────────────────────────────────────────────
  await renderStill(frameHtml(l, o.hook), w(`${name}-frame.png`), l.width, { size: { width: l.width, height: l.height }, transparent: true });
  await renderStill(hookHtml(l, o.hook), w(`${name}-hook.png`), l.panel.w, { size: { width: l.panel.w, height: l.panel.h }, transparent: true });
  await renderStill(endHtml(l, plan.truncated), w(`${name}-end.png`), l.width, { size: { width: l.width, height: l.height } });

  // ── One encode: cut → speed → camera → frame → captions → hook → end card ──────────────────────
  const f30 = (ms: number) => Math.round((ms / 1000) * FPS);
  const select = plan.segments.map((g) => `between(n,${f30(g.srcStartMs)},${f30(g.srcEndMs) - 1})`).join("+");
  const even = (e: string) => `2*trunc(${e}/2)`;
  const graph = [
    // No `format` after the per-frame scale: a converter inserted there is configured once, for the first
    // frame's size, and would shrink every later frame back to it. The scale itself hands overlay its format.
    `[0:v]select='${select}',setpts=N/(${FPS}*TB)${K > 1.0005 ? `,setpts=PTS/${K}` : ""},fps=${FPS},tpad=stop_mode=clone:stop_duration=${l.endCardSec + 1},`
      + `scale=w='${even(`${o.src.width}*(${expr.zoom})`)}':h='${even(`${o.src.height}*(${expr.zoom})`)}':eval=frame:flags=bicubic[cam]`,
    `color=c=0x082a70:s=${l.width}x${l.height}:r=${FPS}:d=${(totalS + 1).toFixed(3)},format=yuv420p[bg]`,
    `[bg][cam]overlay=x='-(${expr.x})':y='${l.panel.y}-(${expr.y})':eval=frame[b1]`,
    // Everything outside the panel is repainted by the frame; the bar's track is dark, the bar the brand orange.
    `[b1]drawbox=x=0:y=0:w=${l.width}:h=${l.panel.y}:color=0x082a70:t=fill,drawbox=x=0:y=${l.bar.y}:w=${l.width}:h=${l.height - l.bar.y}:color=0x082a70:t=fill[b2]`,
    `color=c=0xf97316:s=${l.bar.w}x${l.bar.h}:r=${FPS}:d=${(totalS + 1).toFixed(3)}[bar]`,
    `[b2][bar]overlay=x='-${l.bar.w}+${l.bar.w}*min(t/${bodyS.toFixed(3)},1)':y=${l.bar.y}:eval=frame[b3]`,
    `[b3][1:v]overlay=0:0[b4]`,
    `[b4]ass=${name}.ass:fontsdir=.[b5]`,
    `[2:v]format=rgba,fade=t=out:st=1.25:d=0.3:alpha=1[hook]`,
    `[b5][hook]overlay=x=0:y=${l.panel.y}:enable='lt(t,1.6)'[b6]`,
    `[3:v]format=rgba,fade=t=in:st=${bodyS.toFixed(3)}:d=0.25:alpha=1[end]`,
    `[b6][end]overlay=0:0:enable='gte(t,${bodyS.toFixed(3)})',format=yuv420p,setsar=1[v]`,
    `[4:a]${tempo}${loudnorm},apad=whole_dur=${totalS.toFixed(3)},aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a]`,
  ].join(";\n");
  fs.writeFileSync(w(`${name}.graph`), graph);
  const still = (file: string, seconds: number) => ["-loop", "1", "-framerate", String(FPS), "-t", seconds.toFixed(3), "-i", file];
  const file = `${name}.mp4`;
  await run("ffmpeg", [
    ...FF, "-i", o.master, ...still(`${name}-frame.png`, totalS + 1), ...still(`${name}-hook.png`, 2), ...still(`${name}-end.png`, totalS + 1), "-i", `${name}.wav`,
    "-filter_complex_threads", "4", "-filter_complex_script", `${name}.graph`, "-map", "[v]", "-map", "[a]",
    ...CODEC,
    "-t", totalS.toFixed(3), "-movflags", "+faststart", o.out(file),
  ], { nice: true, cwd: work });

  // ── The cover, from the thumbnail's parts ────────────────────────────────────────────────────
  const cover = `cover-${name}.jpg`;
  let shot = path.join(o.folder, "thumb-shot.png"), ring: { x: number; y: number; width: number; height: number } | null = null;
  if (fs.existsSync(shot) && fs.existsSync(path.join(o.folder, "thumb-shot.json"))) {
    const meta = JSON.parse(fs.readFileSync(path.join(o.folder, "thumb-shot.json"), "utf8")), z = meta.zoom ?? 1;
    ring = meta.ring ? { x: meta.ring.x * z, y: meta.ring.y * z, width: meta.ring.width * z, height: meta.ring.height * z } : null;
  } else {
    // No thumbnail screenshot (an old production): the master's frame at the end of the thumbnail step's line, and the ring found there.
    shot = w("cover-shot.png");
    const want = o.script.thumbnail?.step, g = plan.segments.find((x) => x.step === want) ?? plan.segments.find((x) => o.focus.steps.find((f) => f.step === x.step)?.box) ?? plan.segments[0];
    await run("ffmpeg", [...FF, "-ss", ((g.srcStartMs + (g.speechEndMs - g.outStartMs) * K - 100) / 1000).toFixed(3), "-i", o.master, "-frames:v", "1", "-update", "1", shot], { nice: true });
    const b = o.focus.steps.find((f) => f.step === g.step)?.box;
    ring = b ? { x: b.x, y: b.y, width: b.w, height: b.h } : null;
  }
  const shotSize = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", shot])).stdout.trim().split(",").map(Number);
  await renderStill(coverHtml(l, { ...o.hook, shot, shotSize: { width: shotSize[0], height: shotSize[1] }, ring }), o.out(cover), l.width, { size: { width: l.width, height: l.height } });

  // ── TikTok's file: the cover held for half a second, then the cut itself (joined, not re-encoded) ──
  let tiktok: CutResult["tiktok"];
  if (name === "vertical") {
    await run("ffmpeg", [...FF, "-loop", "1", "-framerate", String(FPS), "-t", String(TIKTOK_COVER_S), "-i", o.out(cover), "-f", "lavfi", "-t", String(TIKTOK_COVER_S), "-i", `anullsrc=r=${RATE}:cl=stereo`,
      "-vf", `scale=${l.width}:${l.height},format=yuv420p,setsar=1`, ...CODEC, "-shortest", "tiktok-cover.mp4"], { nice: true, cwd: work });
    fs.writeFileSync(w("tiktok.txt"), `file 'tiktok-cover.mp4'\nfile '${o.out(file).replace(/'/g, "'\\''")}'\n`);
    const tk = "vertical-tiktok.mp4";
    await run("ffmpeg", [...FF, "-f", "concat", "-safe", "0", "-i", "tiktok.txt", "-c", "copy", "-movflags", "+faststart", o.out(tk)], { nice: true, cwd: work });
    // A joined file must decode cleanly from end to end and show the cover at the moment TikTok is told to use.
    const decode = await run("ffmpeg", ["-hide_banner", "-v", "error", "-threads", "4", "-i", o.out(tk), "-f", "null", "-"], { nice: true });
    if (decode.stderr.trim()) throw new Error(`${tk} does not decode cleanly: ${decode.stderr.trim().slice(0, 300)}`);
    const d = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", o.out(tk)])).stdout.trim()), bytes = fs.readFileSync(o.out(tk));
    if (!(d > 3) || d > 60 || bytes.length > MAX_BYTES) throw new Error(`${tk}: ${d.toFixed(2)} s, ${(bytes.length / 1e6).toFixed(1)} MB`);
    tiktok = { file: tk, durationSec: Math.round(d * 100) / 100, bytes: bytes.length, sha256: sha256(bytes), coverMs: TIKTOK_COVER_MS };
  }

  // ── Measure: nothing about the file is assumed ────────────────────────────────────────────────
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", o.out(file)])).stdout);
  const v = probe.streams.find((s: any) => s.codec_type === "video"), a = probe.streams.find((s: any) => s.codec_type === "audio");
  const durationSec = Number(probe.format.duration), data = fs.readFileSync(o.out(file));
  const loud = await measureLoudness(o.out(file));
  const wrong: string[] = [];
  if (v?.codec_name !== "h264" || v?.pix_fmt !== "yuv420p") wrong.push(`video is ${v?.codec_name}/${v?.pix_fmt}`);
  if (v?.width !== l.width || v?.height !== l.height) wrong.push(`${v?.width}x${v?.height}, not ${l.width}x${l.height}`);
  if (v?.avg_frame_rate !== `${FPS}/1`) wrong.push(`frame rate ${v?.avg_frame_rate}`);
  if (a?.codec_name !== "aac" || Number(a?.sample_rate) !== RATE || a?.channels !== 2) wrong.push(`audio is ${a?.codec_name} ${a?.sample_rate} Hz ${a?.channels} ch`);
  if (!(durationSec > 3) || durationSec > l.maxSec) wrong.push(`${durationSec.toFixed(2)} s, the cap is ${l.maxSec} s`);
  if (Math.abs(Number(v?.duration) - Number(a?.duration)) > 0.2) wrong.push(`picture ${v?.duration} s, sound ${a?.duration} s`);
  if (data.length > MAX_BYTES) wrong.push(`${(data.length / 1e6).toFixed(1)} MB, over ${MAX_BYTES / 1e6} MB`);
  if (Math.abs(loud.lufs - LOUDNESS.I) > 1) wrong.push(`${loud.lufs} LUFS, not ${LOUDNESS.I} ±1`);
  if (loud.truePeakDb > -1) wrong.push(`true peak ${loud.truePeakDb} dBTP, above -1`);
  if (wrong.length) throw new Error(`${o.helpKey} ${file}: ${wrong.join("; ")}`);
  return { file, width: l.width, height: l.height, fps: FPS, durationSec: Math.round(durationSec * 100) / 100, bytes: data.length, sha256: sha256(data), lufs: loud.lufs, truePeakDb: loud.truePeakDb, speed: K, steps: plan.steps, truncated: plan.truncated, cover, ...(tiktok ? { tiktok } : {}) };
}

/** `--out-dir DIR`, as often as needed (parseArgs keeps only the last). */
const outDirsOf = (argv: string[]): string[] => {
  const dirs: string[] = [];
  argv.forEach((a, i) => { if (a === "--out-dir" && argv[i + 1]) dirs.push(path.resolve(argv[i + 1])); else if (a.startsWith("--out-dir=")) dirs.push(path.resolve(a.slice(10))); });
  return dirs.length ? dirs : DEFAULT_OUT_DIRS;
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv, ["all", "force", "text-only", "keep-work"]);
  const only = typeof args.flags.only === "string" ? (args.flags.only as CutName) : undefined;
  if (only && !CUT_NAMES.includes(only)) throw new Error("--only is vertical or feed");
  const o = { only, textOnly: !!args.flags["text-only"], keepWork: !!args.flags["keep-work"] };
  const dirs = outDirsOf(argv).filter((d) => fs.existsSync(d));
  const keys = args._;

  if (args.flags.all) {
    const failed: string[] = [];
    let made = 0, skipped = 0;
    for (const d of dirs) for (const key of fs.readdirSync(d).sort()) {
      const folder = path.join(d, key);
      if (!fs.statSync(folder).isDirectory() || !isMaster(folder)) continue;
      const done = path.join(folder, "social", "social.json");
      if (!args.flags.force && fs.existsSync(done)) {
        const j = JSON.parse(fs.readFileSync(done, "utf8")), now = JSON.parse(fs.readFileSync(path.join(folder, "video.json"), "utf8")).files.video.sha256;
        if (j.master?.sha256 === now && j.cuts?.vertical && j.cuts?.feed) { skipped++; continue; }
      }
      console.log(`\n${key}  (${folder})`);
      try { await makeSocial(key, folder, o); made++; } catch (e) { failed.push(key); console.error(`  ✗ ${e instanceof Error ? e.message : e}`); }
    }
    console.log(`\n${made} made, ${skipped} already up to date, ${failed.length} failed${failed.length ? `: ${failed.join(", ")}` : ""}`);
    if (failed.length) process.exit(1);
    return;
  }
  const helpKey = keys[0];
  if (!helpKey) throw new Error("Usage: npx tsx scripts/tutorials/social.ts <helpKey> [--out-dir DIR]… [--out FOLDER] [--only vertical|feed] [--text-only]   |   --all [--out-dir DIR]… [--force]");
  const folder = typeof args.flags.out === "string" ? path.resolve(args.flags.out) : dirs.map((d) => path.join(d, helpKey)).find(isMaster);
  if (!folder) throw new Error(`${helpKey}: no finished production in ${dirs.join(", ")}`);
  console.log(`${helpKey}  (${folder})`);
  const { dir } = await makeSocial(helpKey, folder, o);
  console.log(`→ ${dir}  — LOOK at the cuts before posting (frames: ffmpeg -ss N -i vertical.mp4 -frames:v 1 f.jpg)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
