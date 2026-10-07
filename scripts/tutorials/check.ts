/**
 * Check a finished walkthrough before it is uploaded — measurements, and frames for a person to LOOK at.
 *
 *   tsx scripts/tutorials/check.ts docs/tutorials/scripts/<helpKey>.json [--out analysis/video-out/<helpKey>]
 *
 * Fails (exit 1) unless walkthrough.mp4 is H.264 yuv420p + AAC with its index (moov) in front of the
 * media at the script's size (1920×1080 in the house style), 30 fps, AAC 48 kHz stereo at −14 LUFS
 * (±1) with a true peak of −1 dBTP or lower, and captions.vtt / .srt have a cue over every narration
 * clip, in order, none overlapping; youtube.json, when the script asks for it, is upload-ready. Then
 * writes frames/NN-….jpg — the intro card, the end of every step, the end card — and contact sheets. The measurements cannot see a ring on the wrong element or a half-loaded page:
 * open the frames.
 */
import fs from "fs";
import path from "path";
import { loadScript, outDir, parseArgs, run, type NarrationIndex, type Timings } from "./lib";
import { LOUDNESS, measureLoudness } from "./mux";

async function main() {
  const args = parseArgs();
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/check.ts <script.json> [--out DIR]");
  const { script } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const at = (f: string) => path.join(dir, f);
  const timings = JSON.parse(fs.readFileSync(at("timings.json"), "utf8")) as Timings;
  const narration = JSON.parse(fs.readFileSync(at("narration.json"), "utf8")) as NarrationIndex;
  const built = JSON.parse(fs.readFileSync(at("video.json"), "utf8")) as { cardMs: number; endCardMs: number; durationSec: number };
  const size = timings.video ?? timings.viewport;
  const problems: string[] = [];
  const need = (ok: boolean, what: string) => { if (!ok) problems.push(what); };
  const out = (ms: number) => built.cardMs + (ms - timings.trimStartMs);

  // Container and codecs.
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", at("walkthrough.mp4")])).stdout);
  const v = probe.streams.find((s: any) => s.codec_type === "video"), a = probe.streams.find((s: any) => s.codec_type === "audio");
  const seconds = Number(probe.format.duration);
  need(v?.codec_name === "h264" && v?.pix_fmt === "yuv420p", `video is ${v?.codec_name}/${v?.pix_fmt}, not h264/yuv420p`);
  need(v?.width === size.width && v?.height === size.height, `video is ${v?.width}x${v?.height}, the script records ${size.width}x${size.height}`);
  need(v?.profile === "High", `H.264 profile is ${v?.profile}, not High`);
  need(v?.avg_frame_rate === "30/1", `frame rate is ${v?.avg_frame_rate}, not 30`);
  need(a?.codec_name === "aac" && Number(a?.sample_rate) === 48000 && a?.channels === 2, `audio is ${a?.codec_name} ${a?.sample_rate} Hz ${a?.channels} ch, not AAC 48 kHz stereo`);
  need(Math.abs(seconds - (built.cardMs + timings.endMs - timings.trimStartMs + (built.endCardMs ?? 0)) / 1000) < 0.25, "the video's length differs from the recording's");
  need(Math.round(seconds) === built.durationSec, "video.json durationSec is not the measured length");
  // The picture runs the whole length (a capture that stopped early leaves the voice playing over nothing).
  need(Math.abs(Number(v?.duration) - seconds) < 0.25 && Math.abs(Number(a?.duration) - seconds) < 0.25, `the picture is ${Number(v?.duration).toFixed(1)} s and the sound ${Number(a?.duration).toFixed(1)} s of a ${seconds.toFixed(1)} s file`);
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
  const vol = (await run("ffmpeg", ["-hide_banner", "-threads", "4", "-i", at("walkthrough.mp4"), "-af", "volumedetect", "-vn", "-f", "null", "-"], { nice: true })).stderr;
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(vol)?.[1]), mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
  need(Number.isFinite(max) && max < -0.5, `audio peaks at ${max} dB (clipped?)`);
  need(Number.isFinite(mean) && mean > -35, `audio mean is ${mean} dB (too quiet)`);
  // Loudness as YouTube measures it: −14 LUFS integrated (±1), true peak no higher than −1 dBTP.
  const loud = await measureLoudness(at("walkthrough.mp4"));
  need(Math.abs(loud.lufs - LOUDNESS.I) <= 1, `loudness is ${loud.lufs} LUFS, the target is ${LOUDNESS.I} ±1`);
  need(loud.truePeakDb <= LOUDNESS.TP + 0.3, `true peak is ${loud.truePeakDb} dBTP, the ceiling is ${LOUDNESS.TP}`);

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
  // The SRT twin (YouTube) says the same thing at the same times.
  const srt = fs.existsSync(at("captions.srt")) ? fs.readFileSync(at("captions.srt"), "utf8") : "";
  const srtCues = [...srt.matchAll(/(\d\d:\d\d:\d\d),(\d{3}) --> (\d\d:\d\d:\d\d),(\d{3})\n([\s\S]*?)(?:\n\n|\n$)/g)];
  need(srtCues.length === cues.length && srtCues.every((m, i) => ms(`${m[1]}.${m[2]}`) === cues[i].start && m[5].replace(/\n/g, " ") === cues[i].text), "captions.srt is not the twin of captions.vtt");
  // A caption line is at most two lines on screen.
  need(cues.every((c) => c.text.length <= 90), "a caption cue is longer than two lines");

  // YouTube metadata, when the script asks for it.
  if (script.youtube) {
    const y = fs.existsSync(at("youtube.json")) ? JSON.parse(fs.readFileSync(at("youtube.json"), "utf8")) : null;
    need(!!y, "youtube.json is missing");
    if (y) {
      need(y.title.length <= 70, "the YouTube title is longer than 70 characters");
      need(y.tags.length <= 12, "more than 12 YouTube tags");
      need(y.madeForKids === false && y.privacyStatus === "private", "youtube.json must say madeForKids false and privacy private");
      need(y.chapters.length === 0 || (y.chapters[0].at === "0:00" && y.chapters.length >= 3 && y.description.includes("\n0:00 ")), "the chapters do not start at 0:00 or are fewer than three");
      need(y.chapters.length >= 3, "fewer than three YouTube chapters — mark more steps with \"chapter\"");
      need(y.video.sha256 === (JSON.parse(fs.readFileSync(at("video.json"), "utf8")).files.video.sha256), "youtube.json describes another encode");
      need(!/higgsfield|kokoro|playwright|ffmpeg/i.test(`${y.title} ${y.description} ${y.tags.join(" ")}`), "the YouTube text names a vendor");
    }
  }

  // Frames to look at.
  const frames = at("frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames);
  const shots: [string, number][] = [["intro-card", built.cardMs / 2], ["first-frame-after-card", built.cardMs + 400]];
  timings.steps.forEach((s) => shots.push([`step${String(s.index).padStart(2, "0")}-${s.action}`, out(s.endMs) - 450]));
  shots.push(["end-card", seconds * 1000 - (built.endCardMs ?? 0) / 2], ["last-frame", seconds * 1000 - 60]);
  for (let i = 0; i < shots.length; i++) {
    const [name, t] = shots[i];
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4", "-ss", (t / 1000).toFixed(3), "-i", at("walkthrough.mp4"), "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", "-update", "1",
      path.join(frames, `${String(i).padStart(2, "0")}-${name}@${(t / 1000).toFixed(1)}s.jpg`)], { nice: true });
  }
  need(fs.readdirSync(frames).length === shots.length, `only ${fs.readdirSync(frames).length} of ${shots.length} frames could be read from the video`);
  // …and contact sheets (six frames each) for a quick look at the whole video.
  for (const f of fs.readdirSync(dir)) if (/^contact-sheet-\d+\.(png|jpg)$/.test(f)) fs.rmSync(at(f));
  const all = fs.readdirSync(frames).sort();
  for (let i = 0, n = 1; i < all.length; i += 6, n++) {
    const group = all.slice(i, i + 6);
    const inputs = group.flatMap((f) => ["-i", path.join(frames, f)]);
    const layout = ["0_0", "w0_0", "0_h0", "w0_h0", "0_h0+h0", "w0_h0+h0"].slice(0, group.length).join("|");
    const graph = group.map((_f, k) => `[${k}:v]scale=960:540[s${k}]`).join(";") + ";" + group.map((_f, k) => `[s${k}]`).join("")
      + (group.length > 1 ? `xstack=inputs=${group.length}:layout=${layout}:fill=white[o]` : "copy[o]");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4", ...inputs, "-filter_complex", graph, "-map", "[o]", "-frames:v", "1", "-q:v", "4", "-update", "1", at(`contact-sheet-${n}.jpg`)], { nice: true });
  }

  console.log(`${v.codec_name}/${v.pix_fmt} ${v.width}x${v.height} ${v.avg_frame_rate} fps + ${a.codec_name} ${a.sample_rate} Hz · ${seconds.toFixed(2)} s · boxes ${boxes.join(" ")}`);
  console.log(`loudness ${loud.lufs} LUFS, true peak ${loud.truePeakDb} dBTP · audio max ${max} dB, mean ${mean} dB · ${cues.length} caption cues, worst edge ${Math.round(worst)} ms from its narration · ${shots.length} frames → ${frames}`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log("measurements pass — now open the frames and look at them");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
