/**
 * Mux — stage 4 of docs/tutorials/VIDEO-PIPELINE.md.
 *
 *   tsx scripts/tutorials/mux.ts docs/tutorials/scripts/<helpKey>.json [--out analysis/video-out/<helpKey>]
 *        [--card 2] [--crf 23] [--poster-step 1] [--publish]
 *
 * Reads raw.webm + timings.json (record.ts) and narration/*.wav + narration.json (narrate.ts); writes
 *   narration.wav    every clip laid at its step's time (one mono track, peak-normalised)
 *   walkthrough.mp4  a ~2 s title card, then the capture: H.264 yuv420p 30 fps + AAC, moov atom first
 *   captions.vtt     the narration, a sentence at a time, on the same clock
 *   poster.jpg       one frame of the walkthrough itself
 *   video.json       what was measured: duration, sizes, sha256
 *
 * --publish also copies the three files to the dev server's local store under their content-hashed
 * names (`<helpKey>.<hash8>.<ext>`) and records them in shared/help/videos.json — the manifest the
 * help registry reads and upload.ts uploads from. A re-recorded video gets new names, so a cached
 * copy of the old one can never be served as the new one.
 *
 * ffmpeg runs niced and with a few threads only: this box also serves production.
 * There is no generated intro (no Higgsfield key exists): the title card is plain ffmpeg drawtext.
 */
import fs from "fs";
import path from "path";
import {
  LOCAL_STORE, MANIFEST_PATH, decodeWav, encodeWav, flagNum, loadScript, outDir, parseArgs, run, sentencesOf, sha256, splitCaption,
  type NarrationIndex, type Timings,
} from "./lib";
import { manifestEntry, type VideoManifest } from "../../shared/help/videos";

const FPS = 30;
const FONT = process.env.TUTORIAL_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = process.env.TUTORIAL_FONT_BOLD || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];

const vttTime = (ms: number) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`;
};
/** Two balanced lines at most: a caption is read at a glance. */
function wrap(text: string): string {
  if (text.length <= 44) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["publish"]);
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/mux.ts <script.json> [--out DIR] [--publish]");
  const { script, title } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const at = (f: string) => path.join(dir, f);
  const timings = JSON.parse(fs.readFileSync(at("timings.json"), "utf8")) as Timings;
  const narration = JSON.parse(fs.readFileSync(at("narration.json"), "utf8")) as NarrationIndex;
  if (timings.steps.length !== script.steps.length) throw new Error("timings.json does not match the script — record again");
  script.steps.forEach((s, i) => {
    const clip = narration.clips.find((c) => c.index === i);
    if (!clip || clip.text !== s.narration) throw new Error(`Step ${i}: narration.json is stale — run narrate.ts and record.ts again`);
    if (clip.durationMs !== timings.steps[i].narrationMs) throw new Error(`Step ${i}: recorded against a different clip — record again`);
  });
  const cardMs = Math.round(flagNum(args, "card", 2) * 1000);
  const crf = flagNum(args, "crf", 23);

  // 1 ── Tie the recorder's clock to the video's: find the two black sync frames record.ts showed.
  // The one after the last step is always in the capture and sets the offset; the pre-roll one (when
  // the capture had already started by then) must agree with it, or the clocks drifted apart.
  const probe = await run("ffmpeg", ["-hide_banner", "-i", at("raw.webm"), "-vf", "blackdetect=d=0.2:pic_th=0.98:pix_th=0.08", "-an", "-f", "null", "-"], { nice: true });
  const blacks = [...probe.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
    .map((m) => ({ start: Number(m[1]) * 1000, length: (Number(m[2]) - Number(m[1])) * 1000 }))
    .filter((b) => b.length > 300 && b.length < 1200);
  const last = blacks[blacks.length - 1];
  if (!last || last.start < timings.endMs - 4000) throw new Error("No sync frame found at the end of raw.webm — record again");
  const offsetMs = Math.round(last.start - timings.syncEndMs);
  if (offsetMs > 200 || offsetMs < -8000) throw new Error(`The video clock is ${offsetMs} ms from the recorder's — record again`);
  const first = blacks.length > 1 ? blacks[0] : null;
  const driftMs = first ? Math.round(first.start - timings.syncStartMs) - offsetMs : null;
  if (driftMs !== null && Math.abs(driftMs) > 120) throw new Error(`The capture drifted ${driftMs} ms between its start and its end — record again`);
  const bodyMs = timings.endMs - timings.trimStartMs;
  const totalMs = cardMs + bodyMs;
  /** Recorder time → time in walkthrough.mp4. */
  const out = (ms: number) => cardMs + (ms - timings.trimStartMs);

  // 2 ── One narration track: every clip at its step's time.
  const rate = narration.sampleRate;
  const mix = new Float64Array(Math.ceil((totalMs / 1000) * rate));
  for (const clip of narration.clips) {
    const pcm = decodeWav(fs.readFileSync(at(clip.file)));
    if (pcm.sampleRate !== rate) throw new Error(`${clip.file}: unexpected sample rate`);
    const start = Math.round((out(timings.steps[clip.index].narrationStartMs) / 1000) * rate);
    if (start + pcm.samples.length > mix.length) throw new Error(`${clip.file} runs past the end of the video`);
    for (let i = 0; i < pcm.samples.length; i++) mix[start + i] += pcm.samples[i];
  }
  let peak = 0;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error("The narration track is silent");
  const gain = (32767 * Math.pow(10, -3 / 20)) / peak; // loudest sample at −3 dBFS: never clipped, never faint
  const samples = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) samples[i] = Math.round(mix[i] * gain);
  fs.writeFileSync(at("narration.wav"), encodeWav({ sampleRate: rate, samples }));

  // 3 ── Title card + capture → H.264/AAC.
  const { width, height } = timings.viewport;
  fs.writeFileSync(at("_title.txt"), title);
  fs.writeFileSync(at("_sub.txt"), "ConstructHUB walkthrough");
  const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const cardS = cardMs / 1000, fade = 0.3;
  const trimStart = (timings.trimStartMs + offsetMs) / 1000, trimEnd = (timings.endMs + offsetMs) / 1000;
  const graph = [
    `[0:v]drawtext=fontfile='${esc(FONT_BOLD)}':textfile='${esc(at("_title.txt"))}':fontsize=${Math.round(height / 12)}:fontcolor=0x202124:x=(w-text_w)/2:y=h/2-text_h-${Math.round(height / 60)},`
      + `drawtext=fontfile='${esc(FONT)}':textfile='${esc(at("_sub.txt"))}':fontsize=${Math.round(height / 26)}:fontcolor=0x5f6368:x=(w-text_w)/2:y=h/2+${Math.round(height / 30)},`
      + `fade=t=out:st=${(cardS - fade).toFixed(2)}:d=${fade}:color=white,format=yuv420p,setsar=1[card]`,
    // Playwright's capture has a variable frame rate: make it constant first, hold the last frame, then cut.
    `[1:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=5,trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=PTS-STARTPTS,`
      + `scale=${width}:${height}:flags=lanczos,fade=t=in:st=0:d=${fade}:color=white,format=yuv420p,setsar=1[body]`,
    `[card][body]concat=n=2:v=1:a=0[v]`,
  ].join(";");
  await run("ffmpeg", [
    ...FF,
    "-f", "lavfi", "-i", `color=c=white:s=${width}x${height}:r=${FPS}:d=${cardS}`,
    "-i", at("raw.webm"),
    "-i", at("narration.wav"),
    "-filter_complex", graph, "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
    "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "1",
    "-t", (totalMs / 1000).toFixed(3), "-movflags", "+faststart", at("walkthrough.mp4"),
  ], { nice: true });
  fs.rmSync(at("_title.txt")); fs.rmSync(at("_sub.txt"));

  // 4 ── Captions: the narration, sentence by sentence, each for its share of the clip.
  const cues: { start: number; end: number; text: string }[] = [];
  for (const clip of narration.clips) {
    const pieces = sentencesOf(clip.text).flatMap((s) => splitCaption(s));
    const chars = pieces.reduce((n, p) => n + p.length, 0);
    let t = out(timings.steps[clip.index].narrationStartMs);
    for (const p of pieces) {
      const len = (clip.durationMs * p.length) / chars;
      cues.push({ start: t, end: t + len, text: p });
      t += len;
    }
  }
  // A cue stays up a moment after the voice stops, but never into the next one.
  cues.forEach((c, i) => { c.end = Math.min(c.end + 250, cues[i + 1]?.start ?? totalMs); });
  fs.writeFileSync(at("captions.vtt"), `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${wrap(c.text)}`).join("\n\n")}\n`);

  // 5 ── Poster: the end of a step, when its ring and the cursor are where the narration put them.
  const posterStep = Math.min(Math.max(0, Math.round(flagNum(args, "poster-step", 1))), timings.steps.length - 1);
  const posterAt = (out(timings.steps[posterStep].endMs) - 400) / 1000;
  await run("ffmpeg", [...FF, "-ss", posterAt.toFixed(3), "-i", at("walkthrough.mp4"), "-frames:v", "1", "-q:v", "3", "-update", "1", at("poster.jpg")], { nice: true });

  // 6 ── Measure — the length is read from the file, never typed.
  const ff = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", at("walkthrough.mp4")]);
  const durationSec = Math.round(Number(ff.stdout.trim()));
  if (!(durationSec > 0)) throw new Error("ffprobe could not read the video's length");
  const measure = (file: string, ext: string) => {
    const data = fs.readFileSync(at(file)), hash = sha256(data);
    return { file, key: `tutorials/${script.helpKey}.${hash.slice(0, 8)}.${ext}`, bytes: data.length, sha256: hash };
  };
  const files = { video: measure("walkthrough.mp4", "mp4"), captions: measure("captions.vtt", "vtt"), poster: measure("poster.jpg", "jpg") };
  fs.writeFileSync(at("video.json"), JSON.stringify({ helpKey: script.helpKey, durationSec, clockOffsetMs: offsetMs, clockDriftMs: driftMs, cardMs, cues: cues.length, files }, null, 2) + "\n");
  console.log(`walkthrough.mp4  ${durationSec}s  ${(files.video.bytes / 1e6).toFixed(2)} MB  (clock offset ${offsetMs} ms, drift ${driftMs ?? "n/a"} ms, ${cues.length} caption cues)`);

  if (args.flags.publish) {
    fs.mkdirSync(LOCAL_STORE, { recursive: true });
    for (const f of Object.values(files)) fs.copyFileSync(at(f.file), path.join(LOCAL_STORE, f.key.slice("tutorials/".length)));
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as VideoManifest;
    const strip = ({ key, bytes, sha256: hash }: { key: string; bytes: number; sha256: string }) => ({ key, bytes, sha256: hash });
    manifest[script.helpKey] = manifestEntry({ durationSec, video: strip(files.video), captions: strip(files.captions), poster: strip(files.poster) });
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`published locally → ${LOCAL_STORE}\nmanifest updated  → ${path.relative(process.cwd(), MANIFEST_PATH)}  (upload.ts puts these keys in R2)`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
