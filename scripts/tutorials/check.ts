/**
 * Check a finished walkthrough before it is uploaded — measurements, and frames for a person to LOOK at.
 *
 *   tsx scripts/tutorials/check.ts docs/tutorials/scripts/<helpKey>.json [--out analysis/video-out/<helpKey>]
 *
 * Fails (exit 1) unless walkthrough.mp4 is H.264 yuv420p + AAC with its index (moov) in front of the
 * media, has audible, unclipped sound, and captions.vtt has a cue over every narration clip, in
 * order, none overlapping. Then writes frames/NN-….png — the title card, the end of every step and
 * the last frame. The measurements cannot see a ring on the wrong element or a half-loaded page:
 * open the frames.
 */
import fs from "fs";
import path from "path";
import { loadScript, outDir, parseArgs, run, type NarrationIndex, type Timings } from "./lib";

async function main() {
  const args = parseArgs();
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/check.ts <script.json> [--out DIR]");
  const { script } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const at = (f: string) => path.join(dir, f);
  const timings = JSON.parse(fs.readFileSync(at("timings.json"), "utf8")) as Timings;
  const narration = JSON.parse(fs.readFileSync(at("narration.json"), "utf8")) as NarrationIndex;
  const built = JSON.parse(fs.readFileSync(at("video.json"), "utf8")) as { cardMs: number; durationSec: number };
  const problems: string[] = [];
  const need = (ok: boolean, what: string) => { if (!ok) problems.push(what); };
  const out = (ms: number) => built.cardMs + (ms - timings.trimStartMs);

  // Container and codecs.
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", at("walkthrough.mp4")])).stdout);
  const v = probe.streams.find((s: any) => s.codec_type === "video"), a = probe.streams.find((s: any) => s.codec_type === "audio");
  const seconds = Number(probe.format.duration);
  need(v?.codec_name === "h264" && v?.pix_fmt === "yuv420p", `video is ${v?.codec_name}/${v?.pix_fmt}, not h264/yuv420p`);
  need(v?.width === timings.viewport.width && v?.height === timings.viewport.height, "video size differs from the script's viewport");
  need(a?.codec_name === "aac", `audio is ${a?.codec_name}, not aac`);
  need(Math.abs(seconds - (built.cardMs + timings.endMs - timings.trimStartMs) / 1000) < 0.25, "the video's length differs from the recording's");
  need(Math.round(seconds) === built.durationSec, "video.json durationSec is not the measured length");
  // Fast start: the index must come before the media, or a player has to fetch the whole file first.
  const fd = fs.openSync(at("walkthrough.mp4"), "r");
  const boxes: string[] = [];
  for (let pos = 0, head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, pos) >= 8 && boxes.length < 8;) {
    const size = head.readUInt32BE(0) === 1 ? Number(head.readBigUInt64BE(8)) : head.readUInt32BE(0);
    boxes.push(head.toString("ascii", 4, 8));
    if (size < 8) break;
    pos += size;
  }
  fs.closeSync(fd);
  need(boxes.indexOf("moov") !== -1 && boxes.indexOf("moov") < boxes.indexOf("mdat"), `not fast-start: boxes are ${boxes.join(" ")}`);

  // Sound: present, not clipped, not near silence.
  const vol = (await run("ffmpeg", ["-hide_banner", "-i", at("walkthrough.mp4"), "-af", "volumedetect", "-vn", "-f", "null", "-"], { nice: true })).stderr;
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(vol)?.[1]), mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
  need(Number.isFinite(max) && max < -0.5, `audio peaks at ${max} dB (clipped?)`);
  need(Number.isFinite(mean) && mean > -35, `audio mean is ${mean} dB (too quiet)`);

  // Captions: every clip is covered by cues that start with it and end with it; cues never overlap.
  const ms = (t: string) => { const [h, m, s] = t.split(":"); return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000; };
  const cues = [...fs.readFileSync(at("captions.vtt"), "utf8").matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n([\s\S]*?)(?:\n\n|\n$)/g)]
    .map((m) => ({ start: ms(m[1]), end: ms(m[2]), text: m[3].replace(/\n/g, " ") }));
  need(fs.readFileSync(at("captions.vtt"), "utf8").startsWith("WEBVTT\n"), "captions.vtt has no WEBVTT header");
  cues.forEach((c, i) => need(c.end > c.start && (i === 0 || c.start >= cues[i - 1].end - 1), `caption cue ${i + 1} overlaps or is empty`));
  need(cues.map((c) => c.text).join(" ") === narration.clips.map((c) => c.text).join(" "), "the captions are not the narration, word for word");
  let worst = 0;
  for (const clip of narration.clips) {
    const from = out(timings.steps[clip.index].narrationStartMs), to = from + clip.durationMs;
    const mine = cues.filter((c) => c.start >= from - 2 && c.start < to);
    need(mine.length > 0, `no caption over step ${clip.index}`);
    if (!mine.length) continue;
    worst = Math.max(worst, Math.abs(mine[0].start - from), Math.max(0, to - mine[mine.length - 1].end));
    need(Math.abs(mine[0].start - from) <= 2 && mine[mine.length - 1].end >= to - 2, `captions of step ${clip.index} do not span its narration`);
  }
  need(cues.length > 0 && cues[cues.length - 1].end <= seconds * 1000 + 1, "a caption runs past the end of the video");

  // Frames to look at.
  const frames = at("frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames);
  const shots: [string, number][] = [["title-card", built.cardMs / 2], ["first-frame-after-card", built.cardMs + 400]];
  timings.steps.forEach((s) => shots.push([`step${String(s.index).padStart(2, "0")}-${s.action}`, out(s.endMs) - 450]));
  shots.push(["last-frame", seconds * 1000 - 60]);
  for (let i = 0; i < shots.length; i++) {
    const [name, t] = shots[i];
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (t / 1000).toFixed(3), "-i", at("walkthrough.mp4"), "-frames:v", "1", "-update", "1",
      path.join(frames, `${String(i).padStart(2, "0")}-${name}@${(t / 1000).toFixed(1)}s.png`)], { nice: true });
  }

  console.log(`${v.codec_name}/${v.pix_fmt} ${v.width}x${v.height} ${v.avg_frame_rate} fps + ${a.codec_name} ${a.sample_rate} Hz · ${seconds.toFixed(2)} s · boxes ${boxes.join(" ")}`);
  console.log(`audio max ${max} dB, mean ${mean} dB · ${cues.length} caption cues, worst edge ${Math.round(worst)} ms from its narration · ${shots.length} frames → ${frames}`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log("measurements pass — now open the frames and look at them");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
