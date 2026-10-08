/**
 * REMASTER a finished walkthrough without recording it again (owner, 2026-10-08 — two defects in
 * every video made so far):
 *
 *   1. the static fallback page / a blank page flashing on every full page load  → deflash.ts' repair;
 *   2. the narrator saying "CON-struct hub"                                       → the lines the
 *      pronunciation lexicon changes are spoken again (lexicon.ts) and laid at the same steps.
 *
 *   tsx scripts/tutorials/remaster.ts <helpKey> --out-dir <the folder that holds its walkthrough.mp4>
 *        [--to DIR] [--upload] [--staging DIR] [--force]
 *   tsx scripts/tutorials/remaster.ts --all [--first key,key,…] [--only key,key,…] [--upload] [--staging DIR] [--force]
 *
 * What it does to one video:
 *   · finds the fallback / blank spans (every frame is read) and holds the last good frame over each;
 *   · if a line's spoken text changes under the lexicon: rebuilds the narration track from the very
 *     clips the master was made of (the shared clip cache — each is checked against the sha256
 *     narration.json recorded) with the new clip in place of the old one. A new clip longer than the
 *     old one extends its step — the step's last frame is held for the difference, and everything
 *     after it moves by that much; a shorter one leaves silence, as between any two lines. Captions
 *     (.vtt/.srt) and the YouTube chapters are timed again from the new step times;
 *   · ONE encode of the picture at the master's settings; the sound is copied untouched when no line
 *     changes, else encoded as mux.ts does it (two-pass loudness to −14 LUFS, AAC 48 kHz stereo);
 *   · the poster and the thumbnail are frames of unchanged moments: they are kept;
 *   · check.ts' checks, then a strip of frames around every repaired span (old above new) to LOOK at.
 *
 * The result is a whole out-folder BESIDE the old master, <folder>/remaster/ — the old files are not
 * touched. A video with neither defect is left alone (no new file). `--upload` puts the new files in
 * R2 with upload.ts (create-only, new hashed names) and writes the manifest to the STAGING folder —
 * never into a checkout — for videos whose current master is the one a manifest describes.
 * A line is added to <staging>/remaster-report.json either way.
 *
 * `--all` walks analysis/video-out of every producer checkout on this machine and skips a folder a
 * producer may still be writing: no video.json yet, or anything in it changed in the last 15 minutes.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ROOT, encodeWav, flagStr, parseArgs, pcmMs, run, sha256, type NarrationIndex, type Pcm, type StepTiming, type Timings } from "./lib";
import { LEXICON_VERSION, lexiconChanges, spokenText } from "./lexicon";
import { createNarrator } from "./narrate";
import { captionCues, chapterLines, chaptersOf, layNarration, loudnormFilter, writeCaptions } from "./mux";
import { describeSpan, fallbackReferences } from "./flash";
import { deflashPlan, extendPlan, finishFolder, probeVideo, readSource, renderPlan, scanSource, type SourceFolder } from "./deflash";
import { checkVideo } from "./check";

const FPS = 30;
export const SOURCES = ["ConstructHUB-seo", ...["a", "b", "c", "d", "e", "f", "g"].map((x) => `ConstructHUB-vid-${x}`)].map((d) => path.join("/home/voiceban", d, "analysis", "video-out"));
const DEFAULT_STAGING = "/tmp/claude-1000/-home-voiceban-ConstructHUB/53bb837f-0f0d-42af-88fe-1263c78eea9e/scratchpad/remaster-manifests";
/** Where the manifests of uploaded videos are looked for: the folder's own checkout, then the integration checkout. */
const MANIFEST_HOMES = (dir: string) => [path.resolve(dir, "../../.."), "/home/voiceban/ConstructHUB-seo"].map((w) => path.join(w, "shared/help/videos"));

/**
 * New step times when some clips change length. A clip that got longer by d ms extends its step by
 * whole frames (≥ d); every later step moves by the sum so far. A clip that got shorter moves nothing.
 */
export function retime(steps: StepTiming[], newClipMs: Map<number, number>): { steps: StepTiming[]; holds: { index: number; frames: number }[]; shiftMs: number } {
  let acc = 0;
  const holds: { index: number; frames: number }[] = [];
  const out = steps.map((s) => {
    const next = { ...s, startMs: s.startMs + acc, narrationStartMs: s.narrationStartMs + acc };
    const ms = newClipMs.get(s.index);
    if (ms !== undefined) {
      next.narrationMs = ms;
      if (ms > s.narrationMs) { const frames = Math.ceil(((ms - s.narrationMs) * FPS) / 1000); holds.push({ index: s.index, frames }); acc += (frames * 1000) / FPS; }
    }
    next.endMs = s.endMs + acc;
    return next;
  });
  return { steps: out, holds, shiftMs: acc };
}

export type RemasterEntry = {
  helpKey: string; source: string; out: string | null;
  status: "remastered" | "clean" | "failed" | "skipped";
  reason?: string;
  spans: number; spansMs: number; spanList: string[];
  sentences: { step: number; text: string; spoken: string; oldMs: number; newMs: number; heldFrames: number }[];
  old: { video: string | null; captions: string | null; poster: string | null; sha256: string; durationSec: number; seconds: number };
  new?: { video: string; captions: string; poster: string; sha256: string; durationSec: number; seconds: number; frames: number; lufs: number; truePeakDb: number; worstCaptionEdgeMs: number; bytes: number };
  checksPassed: boolean; problems: string[];
  uploaded: boolean; uploadNote?: string; manifest?: string;
  lexicon: string; at: string;
};

function manifestFor(src: SourceFolder, masterSha: string): { file: string; json: any } | null {
  for (const home of MANIFEST_HOMES(src.dir)) {
    const file = path.join(home, `${src.helpKey}.json`);
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (json?.video?.sha256 === masterSha) return { file, json };
  }
  return null;
}

/** A strip of frames around a span — the old master above the new one — for a person to look at. */
async function spanStrip(oldFile: string, newFile: string, startMs: number, ms: number, newStartMs: number, out: string): Promise<void> {
  const from = Math.max(0, startMs - 170) / 1000, nfrom = Math.max(0, newStartMs - 170) / 1000, len = (ms + 400) / 1000;
  const every = Math.max(1, Math.ceil((len * FPS) / 8));
  const strip = `select='not(mod(n\\,${every}))',scale=384:-2,tile=8x1`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4", "-ss", from.toFixed(3), "-t", len.toFixed(3), "-i", oldFile, "-ss", nfrom.toFixed(3), "-t", len.toFixed(3), "-i", newFile,
    "-filter_complex", `[0:v]${strip}[a];[1:v]${strip}[b];[a][b]vstack=inputs=2[o]`, "-map", "[o]", "-frames:v", "1", "-q:v", "4", "-update", "1", out], { nice: true });
}

const refCache = new Map<string, Buffer[]>();
async function refsFor(src: SourceFolder): Promise<Buffer[]> {
  const k = `${src.viewport.width}x${src.viewport.height}@${src.zoom}`;
  if (!refCache.has(k)) refCache.set(k, await fallbackReferences(src.viewport, src.zoom));
  return refCache.get(k)!;
}

export async function remasterOne(dir: string, o: { to?: string; force?: boolean; upload?: boolean; staging: string }): Promise<RemasterEntry> {
  const src = readSource(dir);
  const input = path.join(dir, "walkthrough.mp4");
  const out = path.resolve(o.to ?? path.join(dir, "remaster"));
  const masterSha = sha256(fs.readFileSync(input));
  const manifest = manifestFor(src, masterSha);
  const narration = JSON.parse(fs.readFileSync(path.join(dir, "narration.json"), "utf8")) as NarrationIndex;
  const was = await probeVideo(input);
  const entry: RemasterEntry = {
    helpKey: src.helpKey, source: dir, out: null, status: "clean", spans: 0, spansMs: 0, spanList: [], sentences: [],
    old: { video: manifest?.json.video.key ?? null, captions: manifest?.json.captions.key ?? null, poster: manifest?.json.poster.key ?? null, sha256: masterSha, durationSec: src.video.durationSec, seconds: was.seconds },
    checksPassed: false, problems: [], uploaded: false, lexicon: LEXICON_VERSION, at: new Date().toISOString(),
  };
  // Done before, from this very master, under this lexicon? Then only the upload may be left to do.
  const doneFile = path.join(out, "remaster.json");
  if (!o.force && fs.existsSync(doneFile)) {
    const done = JSON.parse(fs.readFileSync(doneFile, "utf8")) as RemasterEntry;
    if (done.old.sha256 === masterSha && done.lexicon === LEXICON_VERSION && done.status === "remastered" && done.checksPassed) {
      console.log(`${src.helpKey}: already remastered from this master → ${out}`);
      if (o.upload && !done.uploaded) await upload(done, src, manifest, out, o.staging);
      fs.writeFileSync(doneFile, JSON.stringify(done, null, 2) + "\n");
      return done;
    }
  }

  const refs = await refsFor(src);
  const flash = await scanSource(src, input, refs);
  const changed = narration.clips.filter((c) => lexiconChanges(c.text));
  entry.spans = flash.spans.length; entry.spansMs = flash.totalMs; entry.spanList = flash.spans.map(describeSpan);
  console.log(`${src.helpKey}: ${flash.spans.length} span(s), ${flash.totalMs} ms of fallback / blank page · ${changed.length} line(s) to speak again`);
  for (const s of flash.spans) console.log(`  · ${describeSpan(s)}`);
  if (!flash.spans.length && !changed.length) { console.log("  neither defect — the master stands"); entry.checksPassed = true; return entry; }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  entry.out = out;
  const at = (f: string) => path.join(out, f);
  const cardMs: number = src.video.cardMs, endCardMs: number = src.video.endCardMs ?? 0;
  let plan = deflashPlan(flash.frames, flash.spans, flash.body);
  let timings: Timings = src.timings;
  const toVideo = (t: Timings) => (ms: number) => cardMs + (ms - t.trimStartMs);

  if (changed.length) {
    // The narration track again, from the clips the master was made of — and the new ones.
    const voice = createNarrator(narration.persona);
    const pcms = new Map<number, Pcm>(), newMs = new Map<number, number>();
    const clips = narration.clips.map((c) => ({ ...c }));
    for (const clip of clips) {
      const pcm = await voice.line(clip.text);
      const wav = encodeWav(pcm);
      if (lexiconChanges(clip.text)) {
        const ms = pcmMs(pcm);
        entry.sentences.push({ step: clip.index, text: clip.text, spoken: spokenText(clip.text), oldMs: clip.durationMs, newMs: ms, heldFrames: 0 });
        newMs.set(clip.index, ms); clip.durationMs = ms; clip.sha256 = sha256(wav);
      } else if (sha256(wav) !== clip.sha256) {
        throw new Error(`step ${clip.index}: the cached clip is not the one this master was made of (its sha256 differs) — the line cannot be laid back unchanged`);
      }
      pcms.set(clip.index, pcm);
    }
    console.log(`  voice: ${voice.called} requested, ${voice.cached} from cache`);
    const re = retime(src.timings.steps, newMs);
    for (const h of re.holds) entry.sentences.find((s) => s.step === h.index)!.heldFrames = h.frames;
    timings = { ...src.timings, steps: re.steps, endMs: src.timings.endMs + re.shiftMs, syncEndMs: src.timings.syncEndMs + re.shiftMs };
    // Hold the last frame of each extended step (its end on the OLD clock is where the frames are).
    const old = toVideo(src.timings);
    plan = extendPlan(plan, re.holds.map((h) => ({ frame: Math.min(flash.body.last, Math.max(flash.body.first, Math.round((old(src.timings.steps[h.index].endMs) / 1000) * FPS) - 1)), extra: h.frames })));
    const totalMs = (plan.length * 1000) / FPS, video = toVideo(timings);
    const track = layNarration(clips.map((c) => ({ pcm: pcms.get(c.index)!, startMs: video(timings.steps[c.index].narrationStartMs), name: `step ${c.index}` })), totalMs, narration.sampleRate);
    fs.writeFileSync(at("narration.wav"), encodeWav({ sampleRate: narration.sampleRate, samples: track }));
    const filter = await loudnormFilter(at("narration.wav"));
    await renderPlan(input, at("walkthrough.mp4"), plan, { width: was.width, height: was.height }, { wav: at("narration.wav"), filter });
    fs.rmSync(at("narration.wav"));
    fs.writeFileSync(at("timings.json"), JSON.stringify(timings, null, 2) + "\n");
    fs.writeFileSync(at("narration.json"), JSON.stringify({ ...narration, clips, lexicon: LEXICON_VERSION }, null, 2) + "\n");
    writeCaptions(out, captionCues(clips, (i) => video(timings.steps[i].narrationStartMs), totalMs));
    // YouTube chapters move with the steps.
    if (re.shiftMs > 0 && fs.existsSync(path.join(dir, "youtube.json"))) {
      const y = JSON.parse(fs.readFileSync(path.join(dir, "youtube.json"), "utf8"));
      const scriptFile = path.resolve(dir, "../../..", "docs/tutorials/scripts", `${src.helpKey}.json`);
      if (y.chapters?.length && fs.existsSync(scriptFile)) {
        const script = JSON.parse(fs.readFileSync(scriptFile, "utf8")) as { title: string; steps: { chapter?: string }[] };
        const chapters = chaptersOf(script.steps, script.title, (i) => video(timings.steps[i].startMs), totalMs);
        const oldBlock = chapterLines(y.chapters.map((c: any) => ({ ...c, ms: 0 }))).join("\n"), newBlock = chapterLines(chapters).join("\n");
        if (!y.description.includes(oldBlock)) throw new Error("youtube.json: the chapter block of the description is not where mux.ts writes it");
        y.description = y.description.replace(oldBlock, newBlock);
        y.chapters = chapters.map(({ at: t, title }) => ({ at: t, title }));
      } else if (y.chapters?.length) console.warn(`  ! ${scriptFile} not found — the YouTube chapters keep their old times (they moved by up to ${Math.round(re.shiftMs)} ms)`);
      fs.writeFileSync(at("youtube.json"), JSON.stringify(y, null, 2) + "\n");
    }
  } else {
    await renderPlan(input, at("walkthrough.mp4"), plan, { width: was.width, height: was.height }, { copyFrom: input });
  }

  const now = await probeVideo(at("walkthrough.mp4"));
  if (now.frames !== plan.length) entry.problems.push(`the new file has ${now.frames} frames, the plan ${plan.length}`);
  if (!changed.length && (now.frames !== was.frames || Math.abs(now.seconds - was.seconds) > 0.002)) entry.problems.push(`picture-only repair changed the length: ${was.frames} frames / ${was.seconds} s → ${now.frames} / ${now.seconds}`);
  const video = await finishFolder({ ...src, timings }, out, { from: input, fromSha256: masterSha, lexicon: LEXICON_VERSION, spans: flash.spans.length, spansMs: flash.totalMs, sentences: entry.sentences.length, at: entry.at });
  const check = await checkVideo(out, { helpKey: src.helpKey, wantsYoutube: fs.existsSync(at("youtube.json")) }, { fallbackRefs: refs });
  for (const l of check.lines) console.log(`  ${l}`);
  entry.problems.push(...check.problems);
  entry.checksPassed = entry.problems.length === 0;
  entry.status = entry.checksPassed ? "remastered" : "failed";
  entry.new = { video: video.files.video.key, captions: video.files.captions.key, poster: video.files.poster.key, sha256: video.files.video.sha256, bytes: video.files.video.bytes,
    durationSec: video.durationSec, seconds: now.seconds, frames: now.frames, lufs: check.loudness.lufs, truePeakDb: check.loudness.truePeakDb, worstCaptionEdgeMs: check.worstCaptionEdgeMs };
  // Frames to LOOK at: around each repaired span and each re-narrated step's end, old above new.
  const shifts = entry.sentences.filter((s) => s.heldFrames).map((s) => ({ at: toVideo(src.timings)(src.timings.steps[s.step].endMs), ms: (s.heldFrames * 1000) / FPS }));
  const moved = (ms: number) => ms + shifts.filter((s) => s.at <= ms).reduce((n, s) => n + s.ms, 0);
  for (const [i, s] of flash.spans.entries()) await spanStrip(input, at("walkthrough.mp4"), s.startMs, s.ms, moved(s.startMs), at(`span-${String(i + 1).padStart(2, "0")}@${(s.startMs / 1000).toFixed(1)}s.jpg`));
  // check.ts' single frames are in the contact sheets too; the disk is nearly full.
  fs.rmSync(at("frames"), { recursive: true, force: true });
  for (const p of entry.problems) console.error(`  ✗ ${p}`);
  console.log(`  ${entry.status}: ${was.seconds.toFixed(3)} s → ${now.seconds.toFixed(3)} s, ${now.frames} frames, ${check.loudness.lufs} LUFS → ${out}`);
  if (o.upload && entry.checksPassed) await upload(entry, src, manifest, out, o.staging);
  fs.writeFileSync(doneFile, JSON.stringify(entry, null, 2) + "\n");
  return entry;
}

/** upload.ts, create-only, manifest into the staging folder — only for a master a manifest describes. */
async function upload(entry: RemasterEntry, src: SourceFolder, manifest: { file: string; json: any } | null, out: string, staging: string): Promise<void> {
  if (!manifest) { entry.uploadNote = "not uploaded: no manifest describes this master (its producer has not uploaded it, or it was recorded again since)"; console.log(`  ${entry.uploadNote}`); return; }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "scripts/tutorials/upload.ts"), src.helpKey, "--out", out, "--manifest-dir", staging], { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (c) => c === 0 ? resolve() : reject(new Error(`upload.ts failed (exit ${c})`)));
  });
  entry.uploaded = true; entry.manifest = path.join(staging, `${src.helpKey}.json`); entry.uploadNote = `replaces ${manifest.file}`;
}

function record(staging: string, entry: RemasterEntry): void {
  fs.mkdirSync(staging, { recursive: true });
  const file = path.join(staging, "remaster-report.json");
  const all: RemasterEntry[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).videos : [];
  const i = all.findIndex((e) => e.source === entry.source);
  if (i >= 0) all[i] = entry; else all.push(entry);
  const done = all.filter((e) => e.status === "remastered");
  fs.writeFileSync(file, JSON.stringify({
    lexicon: LEXICON_VERSION, updated: new Date().toISOString(),
    totals: { folders: all.length, remastered: done.length, clean: all.filter((e) => e.status === "clean").length, failed: all.filter((e) => e.status === "failed").length, skipped: all.filter((e) => e.status === "skipped").length,
      spans: done.reduce((n, e) => n + e.spans, 0), spansMs: done.reduce((n, e) => n + e.spansMs, 0), sentences: done.reduce((n, e) => n + e.sentences.length, 0), uploaded: all.filter((e) => e.uploaded).length },
    videos: all,
  }, null, 2) + "\n");
}

/** A folder a producer may still be writing: no video.json / master yet, or something in it changed in the last 15 minutes. */
export function stillBeingWritten(dir: string, now = Date.now()): string | null {
  for (const f of ["video.json", "walkthrough.mp4", "timings.json", "narration.json", "captions.vtt", "poster.jpg"]) if (!fs.existsSync(path.join(dir, f))) return `no ${f} yet`;
  let newest = 0;
  for (const f of fs.readdirSync(dir)) { if (f === "remaster" || f === "deflash") continue; newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs); }
  const minutes = (now - newest) / 60000;
  return minutes < 15 ? `changed ${minutes.toFixed(0)} min ago` : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["all", "upload", "force"]);
  const staging = path.resolve(flagStr(args, "staging") ?? DEFAULT_STAGING);
  const opts = { force: !!args.flags.force, upload: !!args.flags.upload, staging };
  let folders: string[];
  if (args.flags.all) {
    const first = (flagStr(args, "first") ?? "").split(",").filter(Boolean), only = (flagStr(args, "only") ?? "").split(",").filter(Boolean);
    folders = SOURCES.flatMap((root) => fs.existsSync(root) ? fs.readdirSync(root).map((k) => path.join(root, k)).filter((d) => fs.statSync(d).isDirectory()) : []);
    if (only.length) folders = folders.filter((d) => only.includes(path.basename(d)));
    const rank = (d: string) => { const i = first.indexOf(path.basename(d)); return i < 0 ? first.length : i; };
    folders = folders.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
  } else {
    const dir = flagStr(args, "out-dir");
    if (!args._[0] || !dir) throw new Error("Usage: tsx scripts/tutorials/remaster.ts <helpKey> --out-dir <folder of its walkthrough.mp4> [--to DIR] [--upload] [--staging DIR] [--force]\n       tsx scripts/tutorials/remaster.ts --all [--first k,k] [--only k,k] [--upload] [--force]");
    folders = [path.resolve(dir)];
    if (JSON.parse(fs.readFileSync(path.join(folders[0], "video.json"), "utf8")).helpKey !== args._[0]) throw new Error(`${folders[0]} does not hold ${args._[0]}`);
  }
  let failed = 0;
  for (const dir of folders) {
    const busy = args.flags.all ? stillBeingWritten(dir) : null;
    if (busy) {
      console.log(`${path.basename(dir)} (${dir}): skipped — ${busy}`);
      record(staging, { helpKey: path.basename(dir), source: dir, out: null, status: "skipped", reason: busy, spans: 0, spansMs: 0, spanList: [], sentences: [], old: { video: null, captions: null, poster: null, sha256: "", durationSec: 0, seconds: 0 }, checksPassed: false, problems: [], uploaded: false, lexicon: LEXICON_VERSION, at: new Date().toISOString() });
      continue;
    }
    try {
      const entry = await remasterOne(dir, { ...opts, to: args.flags.all ? undefined : flagStr(args, "to") });
      if (entry.status === "failed") failed++;
      record(staging, entry);
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`${path.basename(dir)}: ✗ ${reason}`);
      record(staging, { helpKey: path.basename(dir), source: dir, out: null, status: "failed", reason, spans: 0, spansMs: 0, spanList: [], sentences: [], old: { video: null, captions: null, poster: null, sha256: "", durationSec: 0, seconds: 0 }, checksPassed: false, problems: [reason], uploaded: false, lexicon: LEXICON_VERSION, at: new Date().toISOString() });
    }
  }
  const free = (await run("df", ["-h", "--output=avail", "/home"])).stdout.trim().split("\n").pop()!.trim();
  console.log(`\n${folders.length} folder(s), ${failed} failed · report ${path.join(staging, "remaster-report.json")} · disk free ${free}`);
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
