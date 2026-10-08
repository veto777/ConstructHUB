/**
 * Make one gator short (docs/gator/CONCEPTS.md) — stills, clips, the finished vertical video.
 *
 *   G="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/make.ts"
 *   $G <conceptId> --plan                 what it would ask for and what that costs (free: estimates only)
 *   $G <conceptId> --stills               the scene stills (paid) — then LOOK at each: is he on-model?
 *   $G <conceptId> --retake-still s2      a still was off-model: a new take of it (paid)
 *   $G <conceptId> --videos               animate the stills (paid) — then LOOK at the frames
 *   $G <conceptId> --retake-video s1      a new take of one clip (paid)
 *   $G <conceptId> --assemble             cut, captions, logo, end tag, sound, cover, social.json (free)
 *   $G --ledger                           the budget: cap, spent, every paid call
 *
 * Paid calls go through higgsfield.ts: priced first, refused over the cap, in the ledger
 * (analysis/gator-shorts/ledger.json) before they leave, never made twice for the same shot.
 * Character consistency: every still is drawn by an image model that is handed the mascot's own
 * artwork as reference, a person looks at it, and only an on-model still is animated (image-to-video
 * keeps what is in its first frame). Output: analysis/gator-shorts/<conceptId>/.
 * Every ffmpeg runs under the machine-wide encode lock, niced, 4 threads. Nothing is posted.
 */
import fs from "fs";
import path from "path";
import { ROOT, encodeWav, parseArgs, run, sha256, sleep } from "../tutorials/lib";
import { renderStill } from "../tutorials/brand";
import { LOUDNESS, measureLoudness } from "../tutorials/mux";
import { BUBBLE, bubbleHtml, endTagHtml, logoHtml } from "./brand";
import { AI_NOTE, CONCEPTS, NEGATIVE, conceptById, lintConcept, motionPrompt, postsOf, stillPrompt, type Concept } from "./concepts";
import { PILOT, emptyLedger, estimate, generate, redact, spent, uploadInput, type Creds, type Io, type Ledger } from "./higgsfield";
import { END_TAG_SEC, FPS, H, LOGO_RECT, MAX_SEC, W, assFile, layoutBeat, type Beat } from "./layout";
import { RATE, synth, toPcm, type Cue } from "./sound";

export const OUT = process.env.GATOR_OUT_DIR || path.join(ROOT, "analysis", "gator-shorts");
const LEDGER = path.join(OUT, "ledger.json");
const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
const CODEC = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "19", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
  "-c:a", "aac", "-b:a", "160k", "-ar", String(RATE), "-ac", "2"];

export function readLedger(): Ledger {
  if (!fs.existsSync(LEDGER)) return emptyLedger(new Date());
  const l = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
  if (l.version !== 1 || !Array.isArray(l.entries) || !(l.cap?.credits > 0)) throw new Error(`${LEDGER} is not a gator ledger`);
  return l;
}
const saveLedger = (l: Ledger) => { fs.mkdirSync(OUT, { recursive: true }); const tmp = `${LEDGER}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(l, null, 2) + "\n"); fs.renameSync(tmp, LEDGER); };

type Takes = { stills: Record<string, number>; videos: Record<string, number> };
const takesFile = (id: string) => path.join(OUT, id, "takes.json");
const readTakes = (id: string): Takes => (fs.existsSync(takesFile(id)) ? JSON.parse(fs.readFileSync(takesFile(id), "utf8")) : { stills: {}, videos: {} });
const saveTakes = (id: string, t: Takes) => { fs.mkdirSync(path.dirname(takesFile(id)), { recursive: true }); fs.writeFileSync(takesFile(id), JSON.stringify(t, null, 2) + "\n"); };

/** The mascot as the image model is shown it: the full figure and a close-up of the head, on white (free uploads). */
async function references(io: Io, creds: Creds): Promise<{ urls: string[]; shas: string[] }> {
  const dir = path.join(OUT, "_refs"), art = path.join(ROOT, "client/public/mascot/gator-standing-1024.v1.webp");
  fs.mkdirSync(dir, { recursive: true });
  const body = path.join(dir, "body.png"), head = path.join(dir, "head.png"), cache = path.join(dir, "refs.json");
  const flat = (crop: string, out: string) => run("ffmpeg", [...FF, "-f", "lavfi", "-i", "color=c=white:s=2048x2048", "-i", art, "-filter_complex", `[1:v]${crop}[a];[0:v][a]scale2ref=w=iw:h=ih[bg][fg];[bg][fg]overlay=format=auto,format=rgb24`, "-frames:v", "1", "-update", "1", out], { nice: true });
  if (!fs.existsSync(body)) await flat("pad=iw+120:ih+120:60:60:color=0x00000000", body);
  if (!fs.existsSync(head)) await flat("crop=440:350:150:0,scale=iw*2:ih*2:flags=lanczos,pad=iw+80:ih+80:40:40:color=0x00000000", head);
  const shas = [body, head].map((f) => sha256(fs.readFileSync(f)));
  const cached = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8")) as { urls: string[]; shas: string[] } : null;
  if (cached && cached.shas.join() === shas.join()) {
    const alive = await Promise.all(cached.urls.map((u) => fetch(u, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(20_000) }).then((r) => r.status === 200 || r.status === 206, () => false)));
    if (alive.every(Boolean)) return cached;
  }
  const urls = [await uploadInput(io, creds, fs.readFileSync(body), "image/png"), await uploadInput(io, creds, fs.readFileSync(head), "image/png")];
  fs.writeFileSync(cache, JSON.stringify({ urls, shas }, null, 2) + "\n");
  return { urls, shas };
}

const rel = (f: string) => path.relative(OUT, f);
const stillKey = (c: Concept, shot: string, take: number) => `${c.id}/${shot}/still/take${take}`;
const videoKey = (c: Concept, shot: string, stillTake: number, take: number) => `${c.id}/${shot}/video/still${stillTake}-take${take}`;
const stillFile = (c: Concept, shot: string, take: number) => path.join(OUT, c.id, "stills", `${shot}-take${take}.png`);
const videoFile = (c: Concept, shot: string, stillTake: number, take: number) => path.join(OUT, c.id, "videos", `${shot}-still${stillTake}-take${take}.mp4`);
const stillParams = (c: Concept, shot: string, refs: string[]) => ({ prompt: stillPrompt(c.shots.find((s) => s.id === shot)!), image_urls: refs, resolution: "2k", aspect_ratio: "9:16", quality: "medium" });
const videoParams = (c: Concept, shot: string, imageUrl: string) => ({ prompt: motionPrompt(c.shots.find((s) => s.id === shot)!), image_url: imageUrl, duration: 5, cfg_scale: 0.5, negative_prompt: NEGATIVE });

async function makeStills(c: Concept, only: string | null, ledger: Ledger, io: Io, creds: Creds) {
  const takes = readTakes(c.id), refs = await references(io, creds);
  for (const s of c.shots) {
    if (only && only !== s.id) continue;
    const take = (takes.stills[s.id] ??= 1); saveTakes(c.id, takes);
    const params = stillParams(c, s.id, refs.urls), file = stillFile(c, s.id, take);
    // A finished take is never asked for again — not even when the wording has changed since (that is what a retake is for).
    if (ledger.entries.find((e) => e.key === stillKey(c, s.id, take))?.status === "completed" && fs.existsSync(file)) { io.log(`  still ${s.id} take ${take}: ${rel(file)}  (already paid for — nothing asked)`); continue; }
    const r = await generate({ input: { key: stillKey(c, s.id, take), kind: "image", model: PILOT.image.model, params, identity: { ...params, image_urls: refs.shas }, file }, ledger, save: saveLedger, creds, io });
    io.log(`  still ${s.id} take ${take}: ${rel(file)}${r.paid ? `  (${r.entry.credits} credits)` : "  (already paid for — nothing asked)"}`);
  }
}
async function makeVideos(c: Concept, only: string | null, ledger: Ledger, io: Io, creds: Creds) {
  const takes = readTakes(c.id);
  for (const s of c.shots) {
    if (only && only !== s.id) continue;
    const st = takes.stills[s.id], still = ledger.entries.find((e) => e.key === stillKey(c, s.id, st ?? 0));
    if (!st || still?.status !== "completed" || !still.outputUrl) throw new Error(`${c.id} ${s.id}: no finished still — run --stills, and look at it, first`);
    const take = (takes.videos[s.id] ??= 1); saveTakes(c.id, takes);
    const file = videoFile(c, s.id, st, take);
    if (ledger.entries.find((e) => e.key === videoKey(c, s.id, st, take))?.status === "completed" && fs.existsSync(file)) { io.log(`  video ${s.id} take ${take}: ${rel(file)}  (already paid for — nothing asked)`); continue; }
    const r = await generate({ input: { key: videoKey(c, s.id, st, take), kind: "video", model: PILOT.video.model, params: videoParams(c, s.id, still.outputUrl), identity: { ...videoParams(c, s.id, ""), still: still.sha256 }, file }, ledger, save: saveLedger, creds, io });
    io.log(`  video ${s.id} take ${take} (from still take ${st}): ${rel(file)}${r.paid ? `  (${r.entry.credits} credits)` : "  (already paid for — nothing asked)"}`);
  }
}

/** The clip's clock: where each shot starts, the caption beats and the sound cues on it. */
export function timeline(c: Concept): { shots: { id: string; start: number; frames: number }[]; bodySec: number; totalSec: number; beats: Beat[]; cues: Cue[] } {
  let t = 0;
  const shots: { id: string; start: number; frames: number }[] = [], beats: Beat[] = [], cues: Cue[] = [];
  for (const s of c.shots) {
    const frames = Math.round(s.use * FPS), dur = frames / FPS;
    s.beats.forEach((b, i) => {
      const next = s.beats[i + 1]?.at ?? dur;
      beats.push({ at: t + b.at, until: t + Math.min(dur, b.dur ? b.at + b.dur : next), text: b.text, accent: b.accent, pos: b.pos ?? "top" });
    });
    for (const q of s.cues) cues.push({ ...q, at: t + q.at, ...("until" in q && q.until !== undefined ? { until: t + q.until } : {}) } as Cue);
    shots.push({ id: s.id, start: t, frames });
    t += dur;
  }
  // The tag has its own small sound, so the cut to it is felt.
  cues.push({ type: "whoosh", at: Math.max(0, t - 0.12), dur: 0.3, gain: 0.6 }, { type: "ding", at: t + 0.12, gain: 0.5 });
  return { shots, bodySec: t, totalSec: t + END_TAG_SEC, beats, cues };
}

async function assemble(c: Concept, io: Io) {
  const dir = path.join(OUT, c.id), work = path.join(dir, "_work"), takes = readTakes(c.id), ledger = readLedger();
  fs.mkdirSync(work, { recursive: true });
  const w = (f: string) => path.join(work, f);
  const tl = timeline(c);
  if (tl.totalSec > MAX_SEC) throw new Error(`${c.id} is ${tl.totalSec.toFixed(1)} s — ${MAX_SEC} s at most`);
  const clips = c.shots.map((s) => { const f = videoFile(c, s.id, takes.stills[s.id] ?? 0, takes.videos[s.id] ?? 0); if (!fs.existsSync(f)) throw new Error(`${c.id} ${s.id}: no clip — run --videos`); return f; });

  // Captions, logo, end tag, bubbles.
  const boxes = tl.beats.map(layoutBeat);
  fs.writeFileSync(w("captions.ass"), assFile(boxes));
  fs.copyFileSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"), w("Anton-Regular.ttf"));
  await renderStill(logoHtml(), w("logo.png"), LOGO_RECT.w, { size: { width: LOGO_RECT.w, height: LOGO_RECT.h }, transparent: true });
  await renderStill(endTagHtml(), w("end.png"), W, { size: { width: W, height: H } });
  const bubbles = c.shots.flatMap((s, i) => (s.bubble ? [{ ...s.bubble, start: tl.shots[i].start + s.bubble.at, file: `bubble-${s.id}.png` }] : []));
  for (const b of bubbles) await renderStill(bubbleHtml(b.text, b.tail), w(b.file), BUBBLE.w, { size: { width: BUBBLE.w, height: BUBBLE.h }, transparent: true });

  // Sound: synthesised here, then brought to −14 LUFS in two passes.
  fs.writeFileSync(w("sound.wav"), encodeWav({ sampleRate: RATE, samples: toPcm(synth(tl.cues, tl.totalSec)) }));
  const target = `loudnorm=I=${LOUDNESS.I}:TP=-1.5:LRA=${LOUDNESS.LRA}`;
  const pass1 = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-i", w("sound.wav"), "-af", `${target}:print_format=json`, "-f", "null", "-"], { nice: true })).stderr;
  const lm = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1)) as Record<string, string>;
  const loudnorm = `${target}:measured_I=${lm.input_i}:measured_TP=${lm.input_tp}:measured_LRA=${lm.input_lra}:measured_thresh=${lm.input_thresh}:offset=${lm.target_offset}:linear=true`;

  // (The overlays end with the picture — `shortest` — or the last frame would be held over the end tag.)
  // One encode: each shot trimmed and filled to 1080×1920 → hard cuts → captions → logo → bubbles → end tag.
  const n = clips.length, graph: string[] = [];
  c.shots.forEach((s, i) => {
    const speed = s.speed ?? 1, from = s.from ?? 0;
    graph.push(`[${i}:v]trim=start=${from}:duration=${(s.use * speed + 0.2).toFixed(3)},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},trim=end_frame=${tl.shots[i].frames},setpts=PTS-STARTPTS,`
      + `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},`
      + (s.shiftDown ? `pad=${W}:${H + s.shiftDown}:0:${s.shiftDown},fillborders=top=${s.shiftDown}:mode=mirror,crop=${W}:${H}:0:0,` : "") + `setsar=1,format=yuv420p[s${i}]`);
  });
  graph.push(`${c.shots.map((_s, i) => `[s${i}]`).join("")}concat=n=${n}:v=1:a=0[body]`);
  graph.push(`[body]ass=captions.ass:fontsdir=.[cap]`);
  graph.push(`[cap][${n}:v]overlay=${LOGO_RECT.x}:${LOGO_RECT.y}:shortest=1[b0]`);
  bubbles.forEach((b, i) => graph.push(`[b${i}][${n + 3 + i}:v]overlay=${Math.round(b.x - BUBBLE.w / 2)}:${Math.round(b.y - BUBBLE.h / 2)}:shortest=1:enable='between(t,${b.start.toFixed(3)},${(b.start + b.dur).toFixed(3)})'[b${i + 1}]`));
  graph.push(`[${n + 1}:v]fps=${FPS},scale=${W}:${H},setsar=1,format=yuv420p,trim=end_frame=${Math.round(END_TAG_SEC * FPS)},setpts=PTS-STARTPTS[end]`);
  graph.push(`[b${bubbles.length}][end]concat=n=2:v=1:a=0,format=yuv420p[v]`);
  graph.push(`[${n + 2}:a]${loudnorm},apad=whole_dur=${tl.totalSec.toFixed(3)},aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a]`);
  fs.writeFileSync(w("graph.txt"), graph.join(";\n"));
  const still = (f: string, sec: number) => ["-loop", "1", "-framerate", String(FPS), "-t", sec.toFixed(3), "-i", f];
  const out = path.join(dir, "clip.mp4");
  await run("ffmpeg", [...FF, ...clips.flatMap((f) => ["-i", f]), ...still("logo.png", tl.totalSec + 1), ...still("end.png", END_TAG_SEC + 1), "-i", "sound.wav", ...bubbles.flatMap((b) => still(b.file, tl.totalSec + 1)),
    "-filter_complex_threads", "4", "-filter_complex_script", "graph.txt", "-map", "[v]", "-map", "[a]", ...CODEC, "-t", tl.totalSec.toFixed(3), "-movflags", "+faststart", out], { nice: true, cwd: work });

  // The cover: the hook frame. TikTok takes a moment of the video instead of an image — the same moment.
  const coverMs = 600;
  await run("ffmpeg", [...FF, "-ss", (coverMs / 1000).toFixed(3), "-i", out, "-frames:v", "1", "-q:v", "2", "-update", "1", path.join(dir, "cover.jpg")], { nice: true });
  // For the eye: twelve frames across the clip on one sheet.
  await run("ffmpeg", [...FF, "-i", out, "-vf", `fps=${(12 / tl.totalSec).toFixed(4)},scale=270:480,tile=6x2`, "-frames:v", "1", "-q:v", "3", "-update", "1", path.join(dir, "review.jpg")], { nice: true });

  // Measure: nothing about the file is assumed.
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", out])).stdout);
  const v = probe.streams.find((s: any) => s.codec_type === "video"), a = probe.streams.find((s: any) => s.codec_type === "audio");
  const durationSec = Number(probe.format.duration), data = fs.readFileSync(out), loud = await measureLoudness(out), wrong: string[] = [];
  if (v?.codec_name !== "h264" || v?.pix_fmt !== "yuv420p") wrong.push(`video is ${v?.codec_name}/${v?.pix_fmt}`);
  if (v?.width !== W || v?.height !== H) wrong.push(`${v?.width}x${v?.height}`);
  if (v?.avg_frame_rate !== `${FPS}/1`) wrong.push(`frame rate ${v?.avg_frame_rate}`);
  if (a?.codec_name !== "aac" || Number(a?.sample_rate) !== RATE || a?.channels !== 2) wrong.push(`audio is ${a?.codec_name} ${a?.sample_rate} Hz ${a?.channels} ch`);
  if (Math.abs(durationSec - tl.totalSec) > 0.15) wrong.push(`${durationSec.toFixed(2)} s, planned ${tl.totalSec.toFixed(2)} s`);
  if (Math.abs(loud.lufs - LOUDNESS.I) > 2) wrong.push(`${loud.lufs} LUFS, not about ${LOUDNESS.I}`);
  if (loud.truePeakDb > -0.5) wrong.push(`true peak ${loud.truePeakDb} dBTP`);
  if (wrong.length) throw new Error(`${c.id} clip.mp4: ${wrong.join("; ")}`);

  const posts = postsOf(c), mine = ledger.entries.filter((e) => e.key.startsWith(`${c.id}/`));
  fs.writeFileSync(path.join(dir, "social.json"), JSON.stringify({
    conceptId: c.id, title: c.title, stream: "viral", format: c.format, evergreen: c.evergreen, hook: c.hook,
    clip: { file: "clip.mp4", width: W, height: H, fps: FPS, durationSec: Math.round(durationSec * 100) / 100, bytes: data.length, sha256: sha256(data), lufs: loud.lufs, truePeakDb: loud.truePeakDb, cover: "cover.jpg", coverMs },
    /** These clips are synthetic. Every platform that has a label gets it. */
    aiGenerated: true,
    disclosure: {
      tiktok: { isAiGenerated: true, isYourBrand: true, isBrandedContent: false },
      youtube: { containsSyntheticMedia: true },
      instagram: "Blotato's Instagram target has no AI field: the caption says so, and “AI info” is switched on in the app after posting.",
      linkedin: "LinkedIn has no label a post can set: the text says so.",
      note: AI_NOTE,
    },
    platforms: posts,
    sound: { idea: c.sound, source: "synthesised in scripts/gator/sound.ts — no recorded, licensed or model-generated audio" },
    generation: { shots: c.shots.map((s) => ({ id: s.id, stillTake: takes.stills[s.id], videoTake: takes.videos[s.id] })), paidCalls: mine.length, credits: Math.round(mine.filter((e) => ["reserved", "submitted", "completed"].includes(e.status)).reduce((x, e) => x + e.credits, 0) * 1000) / 1000 },
  }, null, 2) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
  io.log(`  ${rel(out)}  ${W}x${H}  ${durationSec.toFixed(2)} s  ${(data.length / 1e6).toFixed(2)} MB  ${loud.lufs} LUFS, true peak ${loud.truePeakDb} dBTP  — LOOK at ${rel(path.join(dir, "review.jpg"))}`);
}

function printLedger(l: Ledger, log: (s: string) => void) {
  const s = spent(l);
  log(`cap ${l.cap.credits} credits ($${l.cap.usd.toFixed(2)}): ${l.cap.derivation}`);
  log(`spent ${s.credits} credits ($${s.usd.toFixed(3)}) in ${s.images} image(s) and ${s.videos} video(s); ${Math.round((l.cap.credits - s.credits) * 1000) / 1000} credits left under the cap`);
  for (const e of l.entries) log(`  ${e.status.padEnd(9)} ${String(e.credits).padStart(5)} cr  ${e.key}  ${e.model}  ${e.requestId ?? ""}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["plan", "stills", "videos", "assemble", "ledger"]);
  const creds: Creds = { id: process.env.TUTORIAL_HIGGSFIELD_KEY_ID ?? "", secret: process.env.TUTORIAL_HIGGSFIELD_KEY_SECRET ?? "" };
  const say = (line: string) => console.log(redact(line, creds));
  const io: Io = {
    fetch: async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) } as RequestInit); return { status: r.status, text: () => r.text() }; },
    sleep, now: () => new Date(), log: say,
    download: async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(300_000) }); if (!r.ok) throw new Error(`the output answered ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    write: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }, exists: (file) => fs.existsSync(file),
  };
  try {
    const ledger = readLedger();
    if (args.flags.ledger) { printLedger(ledger, say); return; }
    const c = conceptById(args._[0] ?? "");
    const lint = lintConcept(c);
    if (lint.length) throw new Error(`${c.id} breaks the house rules: ${lint.join("; ")}`);
    const only = typeof args.flags.only === "string" ? args.flags.only : null;
    for (const [flag, kind] of [["retake-still", "stills"], ["retake-video", "videos"]] as const) {
      const shot = args.flags[flag];
      if (typeof shot !== "string") continue;
      if (!c.shots.some((s) => s.id === shot)) throw new Error(`--${flag} ${shot}: not a shot of ${c.id}`);
      const t = readTakes(c.id); t[kind][shot] = (t[kind][shot] ?? 0) + 1;
      // A new still makes its clip a new clip: the old one is of another picture.
      if (kind === "stills") delete t.videos[shot];
      saveTakes(c.id, t);
      if (kind === "stills") await makeStills(c, shot, ledger, io, creds); else await makeVideos(c, shot, ledger, io, creds);
    }
    if (args.flags.plan) {
      const img = await estimate(io, creds, PILOT.image.model, stillParams(c, c.shots[0].id, ["https://constructhub.us/mascot/gator-standing-1024.v1.webp"]));
      const vid = await estimate(io, creds, PILOT.video.model, videoParams(c, c.shots[0].id, "https://constructhub.us/mascot/gator-standing-1024.v1.webp"));
      const tl = timeline(c);
      say(`${c.id} — “${c.title}”: ${c.shots.length} shot(s), ${tl.totalSec.toFixed(1)} s with the end tag`);
      say(`  one take of everything: ${c.shots.length} × ${img.credits} + ${c.shots.length} × ${vid.credits} = ${(c.shots.length * (img.credits + vid.credits)).toFixed(2)} credits ($${(c.shots.length * (img.usd + vid.usd)).toFixed(2)})`);
      for (const s of c.shots) { say(`  ${s.id} still:  ${stillPrompt(s)}`); say(`  ${s.id} motion: ${motionPrompt(s)}`); }
      printLedger(ledger, say);
      return;
    }
    const all = !args.flags.stills && !args.flags.videos && !args.flags.assemble && typeof args.flags["retake-still"] !== "string" && typeof args.flags["retake-video"] !== "string";
    if (args.flags.stills || all) await makeStills(c, only, ledger, io, creds);
    if (args.flags.videos || all) await makeVideos(c, only, ledger, io, creds);
    if (args.flags.assemble || all) await assemble(c, io);
    const s = spent(readLedger());
    say(`budget: ${s.credits} of ${ledger.cap.credits} credits ($${s.usd.toFixed(3)} of $${ledger.cap.usd.toFixed(2)})`);
  } catch (e) {
    console.error(`\n✗ ${redact(e instanceof Error ? e.message : String(e), creds)}`);
    process.exit(1);
  }
}
void CONCEPTS;
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0));
