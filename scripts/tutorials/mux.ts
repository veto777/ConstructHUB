/**
 * Mux — stage 4 of docs/tutorials/VIDEO-PIPELINE.md.
 *
 *   tsx scripts/tutorials/mux.ts docs/tutorials/scripts/<helpKey>.json [--out analysis/video-out/<helpKey>]
 *        [--card 1.8] [--end 4] [--crf 23] [--poster-step 1]
 *
 * Reads raw.mkv + timings.json (record.ts) and narration/*.wav + narration.json (narrate.ts); writes
 *   walkthrough.mp4  THE MASTER, and the file the app plays: a branded intro card (≤ 2 s), the capture,
 *                    an end card (~4 s). H.264 High yuv420p 30 fps at the capture's size (1920×1080 in the
 *                    house style) + AAC 48 kHz stereo, loudness-normalised to −14 LUFS integrated with
 *                    a true peak of −1 dBTP or lower (YouTube's target), moov atom first.
 *   captions.vtt / captions.srt   the narration, a sentence at a time, on the video's clock
 *   poster.jpg       one frame of the walkthrough itself, 1280 wide (the in-app still)
 *   youtube.json     upload-ready metadata: title, description with chapters from the step timings,
 *                    tags, playlist, category, the files to upload (when the script has a `youtube` block)
 *   video.json       what was measured: duration, sizes, sha256, loudness
 *   narration.wav    every clip laid at its step's time (one mono track, before loudness)
 *
 * It publishes nothing. `upload.ts` puts the files in R2 and writes the manifest; `thumbnail.ts`
 * makes the YouTube thumbnail.
 *
 * Every ffmpeg runs under the machine-wide encode lock, niced, with 4 threads: this box also serves
 * production. The cards are our own artwork and type (brand.ts) — no generated footage, no music.
 */
import fs from "fs";
import path from "path";
import {
  decodeWav, encodeWav, flagNum, loadScript, outDir, parseArgs, run, sentencesOf, sha256, splitCaption,
  type NarrationIndex, type Pcm, type Timings,
} from "./lib";
import { endCardHtml, introCardHtml, renderStill } from "./brand";
import { helpEntry } from "../../shared/help/registry";

const FPS = 30;
const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
export const LOUDNESS = { I: -14, TP: -1, LRA: 11 };

const clock = (ms: number, sep: "." | ",") => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(t % 1000).padStart(3, "0")}`;
};
/** Two balanced lines at most: a caption is read at a glance. */
function wrap(text: string): string {
  if (text.length <= 44) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}
/** "1:07" — YouTube's chapter time. */
const chapterTime = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Integrated loudness and true peak of a file's audio, as ffmpeg's ebur128 measures them. */
export async function measureLoudness(file: string): Promise<{ lufs: number; truePeakDb: number }> {
  const out = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { nice: true })).stderr;
  const summary = out.slice(out.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), truePeakDb = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(truePeakDb)) throw new Error(`could not measure the loudness of ${file}`);
  return { lufs, truePeakDb };
}


/** One mono track: every clip at its time in the video (ms), at a sane level for the loudness pass to start from. */
export function layNarration(clips: { pcm: Pcm; startMs: number; name: string }[], totalMs: number, rate: number): Int16Array {
  const mix = new Float64Array(Math.ceil((totalMs / 1000) * rate));
  for (const clip of clips) {
    if (clip.pcm.sampleRate !== rate) throw new Error(`${clip.name}: unexpected sample rate`);
    const start = Math.round((clip.startMs / 1000) * rate);
    if (start + clip.pcm.samples.length > mix.length) throw new Error(`${clip.name} runs past the end of the video`);
    for (let i = 0; i < clip.pcm.samples.length; i++) mix[start + i] += clip.pcm.samples[i];
  }
  let peak = 0;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error("The narration track is silent");
  const gain = (32767 * Math.pow(10, -3 / 20)) / peak;
  const samples = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) samples[i] = Math.round(mix[i] * gain);
  return samples;
}

/** Loudness, pass 1: measure a track, and give the `loudnorm` filter that makes pass 2 hit −14 LUFS without pumping. */
export async function loudnormFilter(wav: string): Promise<string> {
  const pass1 = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-i", wav,
    "-af", `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`, "-f", "null", "-"], { nice: true })).stderr;
  const m = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1)) as Record<string, string>;
  return `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

export type Cue = { start: number; end: number; text: string };
/**
 * Captions: the narration as written (never the pronunciation lexicon's spelling), sentence by
 * sentence, each for its share of its clip. `startOf(i)` is where step i's narration starts in the video.
 */
export function captionCues(clips: { index: number; text: string; durationMs: number }[], startOf: (index: number) => number, totalMs: number): Cue[] {
  const cues: Cue[] = [];
  for (const clip of clips) {
    const pieces = sentencesOf(clip.text).flatMap((s) => splitCaption(s));
    const chars = pieces.reduce((n, p) => n + p.length, 0);
    let t = startOf(clip.index);
    for (const p of pieces) {
      const len = (clip.durationMs * p.length) / chars;
      cues.push({ start: t, end: t + len, text: p });
      t += len;
    }
  }
  // A cue stays up a moment after the voice stops, but never into the next one.
  cues.forEach((c, i) => { c.end = Math.min(c.end + 250, cues[i + 1]?.start ?? totalMs); });
  return cues;
}
/** captions.vtt for the app's player, captions.srt for YouTube ("with timing"). */
export function writeCaptions(dir: string, cues: Cue[]): void {
  fs.writeFileSync(path.join(dir, "captions.vtt"), `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${wrap(c.text)}`).join("\n\n")}\n`);
  fs.writeFileSync(path.join(dir, "captions.srt"), `${cues.map((c, i) => `${i + 1}\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\n${wrap(c.text)}`).join("\n\n")}\n`);
}

export type Chapter = { at: string; ms: number; title: string };
/** YouTube chapters from the step timings: first at 0:00, at least 10 s apart, three or more — or none. */
export function chaptersOf(steps: { chapter?: string }[], title: string, startOf: (index: number) => number, totalMs: number, warn: (m: string) => void = () => {}): Chapter[] {
  let chapters: Chapter[] = [];
  steps.forEach((s, i) => {
    if (i !== 0 && !s.chapter) return;
    const ms = i === 0 ? 0 : startOf(i);
    const prev = chapters[chapters.length - 1];
    if (prev && ms - prev.ms < 10_000) { warn(`  ! chapter “${s.chapter}” starts ${((ms - prev.ms) / 1000).toFixed(1)} s after “${prev.title}” — YouTube needs 10 s; left out`); return; }
    chapters.push({ at: chapterTime(ms), ms, title: s.chapter ?? title });
  });
  if (chapters.length && totalMs - chapters[chapters.length - 1].ms < 10_000) chapters.pop();
  if (chapters.length < 3) { warn(`  ! only ${chapters.length} usable chapter(s) — YouTube needs three; none are written`); chapters = []; }
  return chapters;
}
/** The description's chapter block, as YouTube reads it. */
export const chapterLines = (chapters: Chapter[]): string[] => chapters.length ? ["", "Chapters", ...chapters.map((c) => `${c.at} ${c.title}`)] : [];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/mux.ts <script.json> [--out DIR]");
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
  const cardMs = Math.round(flagNum(args, "card", 1.8) * 1000), endCardMs = Math.round(flagNum(args, "end", 4) * 1000);
  if (cardMs > 2000) throw new Error("the intro card is 2 s at most");
  const crf = flagNum(args, "crf", 23);
  const { width, height } = timings.video ?? timings.viewport;

  // 1 ── Tie the recorder's clock to the video's: find the two black sync frames record.ts showed.
  // The one after the last step is always in the capture and sets the offset; the pre-roll one (when
  // the capture had already started by then) must agree with it, or the clocks drifted apart.
  const probe = await run("ffmpeg", ["-hide_banner", "-threads", "4", "-i", at("raw.mkv"), "-vf", "blackdetect=d=0.2:pic_th=0.98:pix_th=0.08", "-an", "-f", "null", "-"], { nice: true });
  const blacks = [...probe.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
    .map((m) => ({ start: Number(m[1]) * 1000, length: (Number(m[2]) - Number(m[1])) * 1000 }))
    .filter((b) => b.length > 300 && b.length < 1200);
  const last = blacks[blacks.length - 1];
  if (!last || last.start < timings.endMs - 4000) throw new Error("No sync frame found at the end of raw.mkv — record again");
  const offsetMs = Math.round(last.start - timings.syncEndMs);
  if (offsetMs > 200 || offsetMs < -8000) throw new Error(`The video clock is ${offsetMs} ms from the recorder's — record again`);
  const first = blacks.length > 1 ? blacks[0] : null;
  const driftMs = first ? Math.round(first.start - timings.syncStartMs) - offsetMs : null;
  if (driftMs !== null && Math.abs(driftMs) > 120) throw new Error(`The capture drifted ${driftMs} ms between its start and its end — record again`);
  const bodyMs = timings.endMs - timings.trimStartMs;
  const totalMs = cardMs + bodyMs + endCardMs;
  /** Recorder time → time in walkthrough.mp4. */
  const out = (ms: number) => cardMs + (ms - timings.trimStartMs);

  // 2 ── One narration track: every clip at its step's time (silent under the two cards).
  const rate = narration.sampleRate;
  const samples = layNarration(narration.clips.map((clip) => ({ pcm: decodeWav(fs.readFileSync(at(clip.file))), startMs: out(timings.steps[clip.index].narrationStartMs), name: clip.file })), totalMs, rate);
  fs.writeFileSync(at("narration.wav"), encodeWav({ sampleRate: rate, samples }));

  // 3 ── Loudness, pass 1: measure, so pass 2 (in the encode) can hit −14 LUFS without pumping.
  const loudnorm = await loudnormFilter(at("narration.wav"));

  // 4 ── The two cards (our own artwork and type), then intro + capture + end → H.264/AAC.
  const group = helpEntry(script.helpKey)?.group;
  const kicker = group === "Start here" ? "Start here" : group === "CRM" ? "CRM Tutorial" : "ConstructHUB Tutorial";
  await renderStill(introCardHtml(title, kicker), at("_intro.png"), width);
  await renderStill(endCardHtml(), at("_end.png"), width);
  const cardS = cardMs / 1000, endS = endCardMs / 1000, fade = 0.25;
  const trimStart = (timings.trimStartMs + offsetMs) / 1000, trimEnd = (timings.endMs + offsetMs) / 1000;
  const still = (label: string, seconds: number, fades: string) => `fps=${FPS},scale=${width}:${height}:flags=lanczos,trim=duration=${seconds},setpts=PTS-STARTPTS,${fades}format=yuv420p,setsar=1[${label}]`;
  const graph = [
    `[0:v]${still("intro", cardS, `fade=t=out:st=${(cardS - fade).toFixed(2)}:d=${fade}:color=white,`)}`,
    // Playwright's capture has a variable frame rate: make it constant first, hold the last frame, then cut.
    `[1:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=5,trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=PTS-STARTPTS,`
      + `scale=${width}:${height}:flags=lanczos,fade=t=in:st=0:d=${fade}:color=white,fade=t=out:st=${(bodyMs / 1000 - fade).toFixed(2)}:d=${fade}:color=white,format=yuv420p,setsar=1[body]`,
    `[2:v]${still("end", endS, `fade=t=in:st=0:d=${fade}:color=white,`)}`,
    `[intro][body][end]concat=n=3:v=1:a=0[v]`,
    `[3:a]${loudnorm},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`,
  ].join(";");
  await run("ffmpeg", [
    ...FF,
    "-loop", "1", "-framerate", String(FPS), "-t", String(cardS), "-i", at("_intro.png"),
    "-i", at("raw.mkv"),
    "-loop", "1", "-framerate", String(FPS), "-t", String(endS), "-i", at("_end.png"),
    "-i", at("narration.wav"),
    "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-t", (totalMs / 1000).toFixed(3), "-movflags", "+faststart", at("walkthrough.mp4"),
  ], { nice: true });
  fs.rmSync(at("_intro.png")); fs.rmSync(at("_end.png"));

  // 5 ── Captions: the narration, sentence by sentence, each for its share of the clip. VTT for the
  // app's player, SRT for YouTube ("with timing").
  const cues = captionCues(narration.clips, (i) => out(timings.steps[i].narrationStartMs), totalMs);
  writeCaptions(dir, cues);

  // 6 ── Poster: the end of a step, when its ring and the cursor are where the narration put them.
  const posterStep = Math.min(Math.max(0, Math.round(flagNum(args, "poster-step", 1))), timings.steps.length - 1);
  const posterAt = (out(timings.steps[posterStep].endMs) - 400) / 1000;
  await run("ffmpeg", [...FF, "-ss", posterAt.toFixed(3), "-i", at("walkthrough.mp4"), "-frames:v", "1", "-vf", "scale=1280:-2:flags=lanczos", "-q:v", "3", "-update", "1", at("poster.jpg")], { nice: true });

  // 7 ── Measure — length and loudness are read from the file, never typed.
  const ff = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", at("walkthrough.mp4")]);
  const durationSec = Math.round(Number(ff.stdout.trim()));
  if (!(durationSec > 0)) throw new Error("ffprobe could not read the video's length");
  const loudness = await measureLoudness(at("walkthrough.mp4"));
  const measure = (file: string, ext: string) => {
    const data = fs.readFileSync(at(file)), hash = sha256(data);
    return { file, key: `tutorials/${script.helpKey}.${hash.slice(0, 8)}.${ext}`, bytes: data.length, sha256: hash };
  };
  const files = { video: measure("walkthrough.mp4", "mp4"), captions: measure("captions.vtt", "vtt"), poster: measure("poster.jpg", "jpg") };

  // 8 ── YouTube: chapters from the step timings (first at 0:00, at least 10 s apart, three or more).
  const chapters = chaptersOf(script.steps, script.title, (i) => out(timings.steps[i].startMs), totalMs, script.youtube ? (m) => console.warn(m) : undefined);
  if (script.youtube) {
    const y = script.youtube, help = `https://constructhub.us/tutorials#help-${script.helpKey}`;
    const description = [
      y.description.trim(),
      ...chapterLines(chapters),
      "", "Try it: https://constructhub.us", `In the app: press the “i” beside ${title}, or open ${help}`, "More tutorials: https://constructhub.us/tutorials",
    ].join("\n");
    fs.writeFileSync(at("youtube.json"), JSON.stringify({
      helpKey: script.helpKey,
      channel: { name: "Construct HUB", handle: "@ConstructHUB-t3v", id: "UCRsxhhzhirrQCnqETChhyFw" },
      title: y.title, description, tags: y.tags, playlist: y.playlist, categoryId: y.category,
      madeForKids: false, defaultLanguage: "en", defaultAudioLanguage: "en",
      /** Nothing here is uploaded by this tool; an upload starts private until the owner approves. */
      privacyStatus: "private",
      chapters: chapters.map(({ at: t, title: name }) => ({ at: t, title: name })),
      files: { video: "walkthrough.mp4", captions: "captions.srt", thumbnail: "thumbnail.jpg" },
      video: { width, height, fps: FPS, durationSec, bytes: files.video.bytes, sha256: files.video.sha256, lufs: loudness.lufs, truePeakDb: loudness.truePeakDb },
    }, null, 2) + "\n");
  }

  fs.writeFileSync(at("video.json"), JSON.stringify({
    helpKey: script.helpKey, durationSec, width, height, clockOffsetMs: offsetMs, clockDriftMs: driftMs, cardMs, endCardMs, cues: cues.length, loudness, files,
  }, null, 2) + "\n");
  console.log(`walkthrough.mp4  ${width}x${height}  ${durationSec}s  ${(files.video.bytes / 1e6).toFixed(2)} MB  ${loudness.lufs} LUFS, true peak ${loudness.truePeakDb} dBTP  `
    + `(clock offset ${offsetMs} ms, drift ${driftMs ?? "n/a"} ms, ${cues.length} caption cues, ${chapters.length} chapters)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
