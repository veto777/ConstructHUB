/**
 * Repair a finished walkthrough WITHOUT recording it again: every span of the static fallback page
 * or of a blank page (flash.ts finds them) is replaced by the last good frame before it, held.
 *
 *   tsx scripts/tutorials/deflash.ts <…/walkthrough.mp4> [--out DIR]
 *
 * Picture only: the sound is copied as it is, and the result has exactly the same number of frames
 * and the same length. One re-encode, at the master's settings (H.264 High yuv420p, 30 fps, CRF 23,
 * a keyframe every two seconds, fast-start). A span that begins the recording (right after the intro
 * card) has no good frame before it: it takes the first good frame after it, faded in from white the
 * way every walkthrough opens.
 *
 * The repaired master is written to <folder of the mp4>/deflash/ (or --out) as a whole out-folder —
 * walkthrough.mp4, the captions, poster, timings.json, narration.json, video.json with the new
 * measurements, youtube.json — the old file is not touched. Then check.ts' checks run on it.
 * Prints, per file: how many spans and how many milliseconds were repaired.
 *
 * remaster.ts does the same and also re-narrates lines the pronunciation lexicon changes.
 */
import { spawn, type ChildProcess } from "child_process";
import { once } from "events";
import fs from "fs";
import path from "path";
import { ENCODE_LOCK, flagStr, parseArgs, run, sha256, withLock, type Timings } from "./lib";
import { describeSpan, findFlashes, type FlashReport, type Span } from "./flash";
import { measureLoudness } from "./mux";
import { checkVideo } from "./check";

const FPS = 30;
/** One output frame: which frame of the source it shows, and how far it is faded towards white (0…1). */
export type PlanFrame = { src: number; white?: number };

/**
 * The frame plan that repairs `spans`: output frame i shows source frame plan[i].src. Same length as
 * the source. `body.first` is the first frame of the recording (after the intro card).
 */
export function deflashPlan(frames: number, spans: Span[], body: { first: number; last: number }): PlanFrame[] {
  const plan: PlanFrame[] = Array.from({ length: frames }, (_v, i) => ({ src: i }));
  for (const s of spans) {
    // The opening fade from white is 0.25 s: a good frame inside it is a washed-out one, not one to hold.
    const opens = s.from <= body.first + 8;
    if (!opens) { for (let i = s.from; i <= s.to; i++) plan[i] = { src: s.from - 1 }; continue; }
    const next = Math.min(s.to + 1, body.last);
    for (let i = body.first; i <= s.to; i++) {
      const t = (i - body.first) / FPS;
      plan[i] = t < 0.25 ? { src: next, white: 1 - t / 0.25 } : { src: next };
    }
  }
  return plan;
}

/** Hold the last frame of some steps for longer: `after[k] = { frame, extra }` inserts `extra` copies after source frame `frame`. */
export function extendPlan(plan: PlanFrame[], after: { frame: number; extra: number }[]): PlanFrame[] {
  const add = new Map<number, number>();
  for (const a of after) add.set(a.frame, (add.get(a.frame) ?? 0) + a.extra);
  const out: PlanFrame[] = [];
  plan.forEach((p, i) => { out.push(p); for (let k = add.get(i) ?? 0; k > 0; k--) out.push({ ...p }); });
  return out;
}

/**
 * Write `output`: the frames of `input` in the order of `plan`, encoded once at the master's
 * settings, with the sound `audio` describes (the source's own track, copied — or a new narration
 * track through `filter`, encoded as mux.ts does). Under the machine-wide encode lock, niced, four threads.
 */
export async function renderPlan(input: string, output: string, plan: PlanFrame[], size: { width: number; height: number },
  audio: { copyFrom: string } | { wav: string; filter: string }, crf = 23): Promise<void> {
  const frameBytes = size.width * size.height * 3 / 2, lumaBytes = size.width * size.height;
  const lastUse = new Map<number, number>();
  plan.forEach((p, i) => lastUse.set(p.src, i));
  const seconds = (plan.length / FPS).toFixed(3);
  await withLock(ENCODE_LOCK, async () => {
    const dec = spawn("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4", "-i", input, "-an", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    const enc = spawn("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "4",
      "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${size.width}x${size.height}`, "-framerate", String(FPS), "-i", "-",
      ...("copyFrom" in audio ? ["-i", audio.copyFrom, "-map", "0:v", "-map", "1:a", "-c:a", "copy"]
        : ["-i", audio.wav, "-map", "0:v", "-map", "1:a", "-af", `${audio.filter},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`, "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]),
      "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
      "-t", seconds, "-movflags", "+faststart", output], { stdio: ["pipe", "ignore", "inherit"] });
    const done = (p: ChildProcess, name: string) => new Promise<void>((resolve, reject) => { p.on("error", reject); p.on("close", (c) => c === 0 ? resolve() : reject(new Error(`${name} exited ${c}`))); });
    const decDone = done(dec, "ffmpeg (decode)"), encDone = done(enc, "ffmpeg (encode)");
    enc.stdin.on("error", () => { /* the encoder stopped; its exit code says why */ });
    const kept = new Map<number, Buffer>();
    let next = 0;       // the next output frame to write
    let decoded = 0;    // source frames read so far
    const write = async (buf: Buffer) => { if (!enc.stdin.write(buf)) await once(enc.stdin, "drain"); };
    const flush = async () => {
      while (next < plan.length && kept.has(plan[next].src)) {
        const p = plan[next], frame = kept.get(p.src)!;
        if (p.white && p.white > 0) {
          const faded = Buffer.from(frame), w = p.white;
          for (let i = 0; i < lumaBytes; i++) faded[i] = Math.round(frame[i] + (235 - frame[i]) * w);
          for (let i = lumaBytes; i < frameBytes; i++) faded[i] = Math.round(frame[i] + (128 - frame[i]) * w);
          await write(faded);
        } else await write(frame);
        if (lastUse.get(p.src) === next) kept.delete(p.src);
        next++;
      }
    };
    let cur = Buffer.allocUnsafe(frameBytes), fill = 0;
    for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
      let at = 0;
      while (at < chunk.length) {
        const n = Math.min(frameBytes - fill, chunk.length - at);
        chunk.copy(cur, fill, at, at + n); fill += n; at += n;
        if (fill < frameBytes) continue;
        if (lastUse.has(decoded)) kept.set(decoded, cur);
        decoded++;
        cur = Buffer.allocUnsafe(frameBytes); fill = 0;
        await flush();
      }
    }
    await decDone;
    await flush();
    enc.stdin.end();
    await encDone;
    if (next !== plan.length) throw new Error(`only ${next} of ${plan.length} frames could be written (the source has ${decoded})`);
  });
}

export async function probeVideo(file: string): Promise<{ frames: number; seconds: number; videoSeconds: number; audioSeconds: number; width: number; height: number }> {
  const j = JSON.parse((await run("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_type,nb_read_packets,duration,width,height:format=duration", "-of", "json", file])).stdout);
  const v = j.streams.find((s: any) => s.codec_type === "video"), a = j.streams.find((s: any) => s.codec_type === "audio");
  return { frames: Number(v.nb_read_packets), seconds: Number(j.format.duration), videoSeconds: Number(v.duration), audioSeconds: Number(a?.duration ?? 0), width: v.width, height: v.height };
}

/** Bytes + sha256 + R2 key of an out-folder's file, as mux.ts writes them into video.json. */
export function measureFile(dir: string, helpKey: string, file: string, ext: string) {
  const data = fs.readFileSync(path.join(dir, file)), hash = sha256(data);
  return { file, key: `tutorials/${helpKey}.${hash.slice(0, 8)}.${ext}`, bytes: data.length, sha256: hash };
}

export type SourceFolder = { dir: string; helpKey: string; timings: Timings; video: any; viewport: { width: number; height: number }; zoom: number };
export function readSource(dir: string): SourceFolder {
  const timings = JSON.parse(fs.readFileSync(path.join(dir, "timings.json"), "utf8")) as Timings;
  const video = JSON.parse(fs.readFileSync(path.join(dir, "video.json"), "utf8"));
  return { dir, helpKey: video.helpKey, timings, video, viewport: timings.viewport, zoom: timings.zoom ?? 1 };
}
export const scanSource = (s: SourceFolder, file = path.join(s.dir, "walkthrough.mp4"), refs?: Buffer[]): Promise<FlashReport> =>
  findFlashes(file, { cardMs: s.video.cardMs, endCardMs: s.video.endCardMs ?? 0, viewport: s.viewport, zoom: s.zoom, refs });

/**
 * Finish an out-folder around a new walkthrough.mp4 already in `out`: the files that did not change
 * are copied from the source folder, video.json and youtube.json get the new file's measurements.
 */
export async function finishFolder(src: SourceFolder, out: string, note: Record<string, unknown>): Promise<any> {
  for (const f of ["timings.json", "narration.json", "captions.vtt", "captions.srt", "poster.jpg", "thumbnail.jpg", "thumbnail-320.png", "youtube.json"])
    if (!fs.existsSync(path.join(out, f)) && fs.existsSync(path.join(src.dir, f))) fs.copyFileSync(path.join(src.dir, f), path.join(out, f));
  const seconds = (await probeVideo(path.join(out, "walkthrough.mp4"))).seconds;
  const loudness = await measureLoudness(path.join(out, "walkthrough.mp4"));
  const files = { video: measureFile(out, src.helpKey, "walkthrough.mp4", "mp4"), captions: measureFile(out, src.helpKey, "captions.vtt", "vtt"), poster: measureFile(out, src.helpKey, "poster.jpg", "jpg") };
  const video = { ...src.video, durationSec: Math.round(seconds), loudness, files, cues: (fs.readFileSync(path.join(out, "captions.vtt"), "utf8").match(/ --> /g) ?? []).length, remaster: note };
  fs.writeFileSync(path.join(out, "video.json"), JSON.stringify(video, null, 2) + "\n");
  if (fs.existsSync(path.join(out, "youtube.json"))) {
    const y = JSON.parse(fs.readFileSync(path.join(out, "youtube.json"), "utf8"));
    y.video = { ...y.video, durationSec: video.durationSec, bytes: files.video.bytes, sha256: files.video.sha256, lufs: loudness.lufs, truePeakDb: loudness.truePeakDb };
    fs.writeFileSync(path.join(out, "youtube.json"), JSON.stringify(y, null, 2) + "\n");
  }
  return video;
}

async function main() {
  const args = parseArgs();
  const input = args._[0] && path.resolve(args._[0]);
  if (!input || !fs.existsSync(input)) throw new Error("Usage: tsx scripts/tutorials/deflash.ts <…/walkthrough.mp4> [--out DIR]");
  const src = readSource(path.dirname(input));
  const out = path.resolve(flagStr(args, "out") ?? path.join(src.dir, "deflash"));
  const before = await scanSource(src, input);
  console.log(`${input}: ${before.spans.length} span(s), ${before.totalMs} ms of fallback / blank page`);
  for (const s of before.spans) console.log(`  · ${describeSpan(s)}`);
  if (!before.spans.length) { console.log("nothing to repair — no file written"); return; }
  fs.mkdirSync(out, { recursive: true });
  const was = await probeVideo(input);
  await renderPlan(input, path.join(out, "walkthrough.mp4"), deflashPlan(before.frames, before.spans, before.body), { width: was.width, height: was.height }, { copyFrom: input });
  const now = await probeVideo(path.join(out, "walkthrough.mp4"));
  if (now.frames !== was.frames || Math.abs(now.seconds - was.seconds) > 0.002) throw new Error(`the repaired file has ${now.frames} frames / ${now.seconds} s, the source ${was.frames} / ${was.seconds}`);
  await finishFolder(src, out, { from: input, deflash: { spans: before.spans.length, ms: before.totalMs }, at: new Date().toISOString() });
  const result = await checkVideo(out, { helpKey: src.helpKey, wantsYoutube: fs.existsSync(path.join(out, "youtube.json")) });
  console.log(`repaired ${before.spans.length} span(s), ${before.totalMs} ms → ${path.join(out, "walkthrough.mp4")} (${now.frames} frames, ${now.seconds.toFixed(3)} s — as the source)`);
  if (result.problems.length) { for (const p of result.problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log("check passes — open the frames around each repaired span");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
