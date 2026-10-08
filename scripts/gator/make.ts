/**
 * Make one gator short (docs/gator/CONCEPTS.md) — stills, clips, the finished vertical video.
 *
 *   G="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/make.ts"
 *   $G <conceptId> --plan                 what it would ask for and what that costs (free: estimates only)
 *   $G <conceptId> --stills               the scene stills (paid) — then LOOK at each: is he on-model?
 *   $G <conceptId> --retake-still s2      a still was off-model: a new take of it (paid)
 *   $G <conceptId> --videos               animate the stills (paid) — then LOOK at the frames
 *   $G <conceptId> --retake-video s1      a new take of one clip (paid)
 *   $G <conceptId> --videos --takes 2     a TALKING shot twice: both takes are measured (voice against the approved
 *                                         reference, words against the script) and the nearer one is kept
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
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ENCODE_LOCK, ROOT, encodeWav, parseArgs, run, sha256, sleep } from "../tutorials/lib";
import { renderStill } from "../tutorials/brand";
import { LOUDNESS, measureLoudness } from "../tutorials/mux";
import { BUBBLE, bubbleHtml, endTagHtml, logoHtml } from "./brand";
import { LIVE_SHEET_PROMPT } from "./concepts-live";
import { AI_NOTE, CONCEPTS, NEGATIVE, conceptById, lintConcept, motionPrompt, postsOf, stillPrompt, type Concept, type Shot } from "./concepts";
import { BudgetError, PILOT, emptyLedger, phase2Cap, pilotCap, estimate, generate, redact, spent, uploadInput, type Creds, type Io, type Ledger } from "./higgsfield";
import { END_TAG_SEC, FPS, H, LOGO_RECT, MAX_SEC, W, assFile, layoutBeat, type Beat } from "./layout";
import { RATE, synth, type Cue } from "./sound";
import { speak, voiceKey } from "./voice";
import { REFERENCE, analyse, compare, decode16k, pitchCorrection, type VoicePrint } from "./voiceprint";

export const OUT = process.env.GATOR_OUT_DIR || path.join(ROOT, "analysis", "gator-shorts");
const LEDGER = path.join(OUT, "ledger.json");
const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
const CODEC = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "19", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
  "-c:a", "aac", "-b:a", "160k", "-ar", String(RATE), "-ac", "2"];

export function readLedger(): Ledger {
  if (!fs.existsSync(LEDGER)) return emptyLedger(new Date());
  const l = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
  if (l.version !== 1 || !Array.isArray(l.entries) || !(l.cap?.credits > 0)) throw new Error(`${LEDGER} is not a gator ledger`);
  // The pilot's cap becomes phase 2's, once (the pilot spent 41.12 of its 57.6).
  if (l.cap.credits === pilotCap(new Date(0)).credits || l.cap.credits !== phase2Cap(new Date(0)).credits && /^phase 2/.test(l.cap.derivation)) { l.cap = phase2Cap(new Date()); saveLedger(l); }
  return l;
}
/**
 * Save the ledger — safely when several clips are being made at once: under a lock, what OTHER runs have
 * written since is read back in first (an entry this run does not know is theirs and is kept; it then
 * counts towards the cap in this run too), and only then is the file replaced.
 */
function saveLedger(l: Ledger): void {
  fs.mkdirSync(OUT, { recursive: true });
  const lock = `${LEDGER}.lock`, pause = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; }
    catch { if (i > 400) { try { if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.rmdirSync(lock); } catch { /* gone */ } } if (i > 1200) throw new Error("the ledger is locked by another run"); Atomics.wait(pause, 0, 0, 25); }
  }
  try {
    if (fs.existsSync(LEDGER)) {
      const disk = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger, mine = new Set(l.entries.map((e) => e.key));
      for (const e of disk.entries) if (!mine.has(e.key)) l.entries.push(e);
    }
    const tmp = `${LEDGER}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(l, null, 2) + "\n"); fs.renameSync(tmp, LEDGER);
  } finally { fs.rmdirSync(lock); }
}

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
/**
 * The live-action gator's model sheet: one photoreal picture drawn from text (concepts-live.ts), looked at
 * and approved, then handed to the image model as the reference of every live still — so it is the same
 * animal in every clip. `make.ts --live-sheet` draws it; `--retake-live-sheet` draws another.
 */
const LIVE_DIR = path.join(OUT, "_live");
const liveTake = (): number => (fs.existsSync(path.join(LIVE_DIR, "take.json")) ? JSON.parse(fs.readFileSync(path.join(LIVE_DIR, "take.json"), "utf8")).take : 0);
async function liveSheet(ledger: Ledger, io: Io, creds: Creds, retake = false): Promise<{ urls: string[]; shas: string[] }> {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  let take = liveTake();
  if (!take || retake) { take++; fs.writeFileSync(path.join(LIVE_DIR, "take.json"), JSON.stringify({ take }) + "\n"); }
  const file = path.join(LIVE_DIR, `sheet-take${take}.png`), params = { prompt: LIVE_SHEET_PROMPT, resolution: "2k", aspect_ratio: "9:16", quality: "medium" };
  const r = await generate({ input: { key: `_live/sheet/still/take${take}`, kind: "image", model: PILOT.image.model, params, file }, ledger, save: saveLedger, creds, io });
  if (r.paid) io.log(`  live model sheet take ${take}: ${rel(file)}  (${r.entry.credits} credits) — LOOK at it before any live still is drawn from it`);
  return { urls: [r.entry.outputUrl!], shas: [r.entry.sha256!] };
}
/**
 * A per-clip budget (daily.ts): the most one concept may hold in charged ledger entries, takes and
 * retakes included. Checked before every paid call of that concept, on top of the ledger's own cap.
 */
let clipBudget: number | null = null;
export const setClipBudget = (credits: number | null) => { clipBudget = credits; };
export const clipSpent = (ledger: Ledger, conceptId: string): number => Math.round(ledger.entries.filter((e) => e.key.startsWith(`${conceptId}/`) && ["reserved", "submitted", "completed"].includes(e.status)).reduce((n, e) => n + e.credits, 0) * 1000) / 1000;
async function assertClipBudget(ledger: Ledger, c: Concept, model: string, params: Record<string, unknown>, io: Io, creds: Creds): Promise<void> {
  // Before any paid call: learn what other runs have spent (the cap is one cap, however many clips are being made).
  if (fs.existsSync(LEDGER)) { const mine = new Set(ledger.entries.map((e) => e.key)); for (const e of (JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger).entries) if (!mine.has(e.key)) ledger.entries.push(e); }
  if (clipBudget === null) return;
  const price = await estimate(io, creds, model, params), had = clipSpent(ledger, c.id);
  if (had + price.credits > clipBudget + 1e-9) throw new BudgetError(`REFUSING ${c.id}: ${price.credits} credits on top of the ${had} this clip already cost would pass its budget of ${clipBudget} credits`);
}
const stillKey = (c: Concept, shot: string, take: number) => `${c.id}/${shot}/still/take${take}`;
const videoKey = (c: Concept, shot: string, stillTake: number, take: number) => `${c.id}/${shot}/video/still${stillTake}-take${take}`;
const stillFile = (c: Concept, shot: string, take: number) => path.join(OUT, c.id, "stills", `${shot}-take${take}.png`);
const videoFile = (c: Concept, shot: string, stillTake: number, take: number) => path.join(OUT, c.id, "videos", `${shot}-still${stillTake}-take${take}.mp4`);
const stillParams = (c: Concept, shot: string, refs: string[]) => ({ prompt: stillPrompt(shotOf(c, shot)), image_urls: refs, resolution: "2k", aspect_ratio: "9:16", quality: "medium" });
export const VIDEO_MODELS = {
  "kling": "kling-video/v2.5-turbo/standard/image-to-video",
  "kling-pro": "kling-video/v2.5-turbo/pro/image-to-video",
  "wan-talk": "wan/v2.7/image-to-video",
  "kling-voice": "kling-video/v3.0/std/image-to-video",
  "talk": "kling-video/v3.0/std/image-to-video",
} as const;
const shotOf = (c: Concept, shot: string): Shot => c.shots.find((s) => s.id === shot)!;
const videoModel = (s: Shot) => VIDEO_MODELS[s.video ?? "kling"];
/** The request body of a shot's clip. `audioUrl`: the driving line, for the model that follows it. */
function videoParams(s: Shot, imageUrl: string, audioUrl?: string): Record<string, unknown> {
  const prompt = motionPrompt(s);
  switch (s.video ?? "kling") {
    case "wan-talk": return { prompt, image_url: imageUrl, audio_url: audioUrl, duration: 5, resolution: "720p", negative_prompt: NEGATIVE };
    case "kling-voice": return { prompt, image_url: imageUrl, duration: 5, cfg_scale: 0.5, sound: "on" };
    case "talk": return { prompt, image_url: imageUrl, duration: s.seconds ?? 5, cfg_scale: 0.5, sound: "on" };
    default: return { prompt, image_url: imageUrl, duration: 5, cfg_scale: 0.5, negative_prompt: NEGATIVE };
  }
}
/** Where a shot's still comes from: its own takes, or another shot's approved still. */
function stillRef(c: Concept, s: Shot): { concept: string; shot: string; take: number } {
  if (s.stillFrom) { const [cid, sid] = s.stillFrom.split("/"); return { concept: cid, shot: sid, take: readTakes(cid).stills[sid] ?? 0 }; }
  return { concept: c.id, shot: s.id, take: readTakes(c.id).stills[s.id] ?? 0 };
}
const VOICE_DIR = path.join(OUT, "_voice");
const ASR_DIR = path.join(OUT, "_asr");
export type Word = { w: string; start: number; end: number; p?: number };
/** What he says in a file, word by word — or null when the local recogniser is not installed (see asr.py). */
export async function transcribe(file: string): Promise<{ text: string; words: Word[] } | null> {
  const py = path.join(ASR_DIR, "venv", "bin", "python");
  if (!fs.existsSync(py)) return null;
  const out = await run("nice", ["-n", "15", py, "-I", path.join(ROOT, "scripts", "gator", "asr.py"), path.join(ASR_DIR, "models"), file]);
  const line = out.stdout.split("\n").find((l) => l.startsWith("{"));
  return line ? JSON.parse(line) : null;
}
/** Words as they are compared: lower case, no punctuation, "ok" for "okay". */
export const plainWords = (t: string): string[] => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
/** Does a transcript say the script — every word, in order, nothing extra? Number words and digits are one thing ("4" = "four"). */
export function saysTheLine(heard: string, script: string): { ok: boolean; missing: string[]; extra: string[]; match: number } {
  const num: Record<string, string> = { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "359": "three fifty-nine", "3:59": "three fifty-nine" };
  const norm = (t: string) => plainWords(t.replace(/\b\d+(:\d+)?\b/g, (d) => num[d] ?? d).replace(/-/g, " "));
  const a = norm(heard), b = norm(script), missing = b.filter((w, i) => a[i] !== w && !a.includes(w)), extra = a.filter((w) => !b.includes(w));
  // A short line must be said exactly. A long one (a vlog that is interrupted mid-word by a deck) must keep
  // at least four fifths of its words, in order.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) lcs[i][j] = a[i - 1] === b[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
  const match = b.length ? Math.round((lcs[a.length][b.length] / Math.max(a.length, b.length)) * 100) / 100 : 0;
  return { ok: b.length <= 10 ? a.join(" ") === b.join(" ") : match >= 0.8, missing, extra, match };
}
export type TalkCheck = { take: number; file: string; print: VoicePrint; voice: ReturnType<typeof compare>; pitchRatio: number; heard: string | null; words: Word[] | null; wordsOk: boolean | null; speech: { start: number; end: number } | null; problems: string[] };
/** Measure one talking take: the voice against the approved reference, the words against the script, when he speaks. */
export async function checkTalk(file: string, line: string, take: number): Promise<TalkCheck> {
  const pcm = await decode16k(file), asr = await transcribe(file), problems: string[] = [];
  // The voice is measured where he is SPEAKING (the recogniser's words), not over the crash behind him.
  let voiced = pcm;
  if (asr?.words.length) {
    const parts = asr.words.map((x) => pcm.subarray(Math.round(x.start * 16000), Math.round(x.end * 16000)));
    voiced = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { voiced.set(p, o); o += p.length; }
  }
  const whole = analyse(pcm), print = { ...analyse(voiced), bursts: whole.bursts }, voice = compare(print, REFERENCE);
  const said = asr ? saysTheLine(asr.text, line) : null;
  if (!(print.f0 > 0)) problems.push("no voice found in the track");
  else if (!voice.inBand) problems.push(`the voice is outside the band around the approved one (pitch ${print.f0} Hz, ${(voice.f0Off * 100).toFixed(0)}%; brightness ${print.centroid} Hz, ${(voice.centroidOff * 100).toFixed(0)}%)`);
  if (said && !said.ok) problems.push(`he says “${asr!.text}” (${Math.round(said.match * 100)}% of the script)${said.missing.length ? ` — missing: ${said.missing.join(" ")}` : ""}${said.extra.length ? ` — extra: ${said.extra.join(" ")}` : ""}`);
  // When he speaks: the recogniser's first and last word, else the longest stretch of speech-level sound.
  const longest = [...print.bursts].sort((a, b) => b.end - b.start - (a.end - a.start))[0] ?? null;
  const speech = asr?.words.length ? { start: asr.words[0].start, end: asr.words[asr.words.length - 1].end } : longest;
  return { take, file: rel(file), print, voice, pitchRatio: pitchCorrection(print, REFERENCE), heard: asr?.text ?? null, words: asr?.words ?? null, wordsOk: said ? said.ok : null, speech, problems };
}
const talkFile = (id: string) => path.join(OUT, id, "talk.json");
const readTalk = (id: string): Record<string, TalkCheck[]> => (fs.existsSync(talkFile(id)) ? JSON.parse(fs.readFileSync(talkFile(id), "utf8")) : {});
/** The line as the lip-sync model is given it: `lead` of silence, the line, silence to five seconds. */
async function drivingAudio(s: Shot, io: Io, creds: Creds): Promise<{ url: string; sha: string }> {
  const line = await speak(s.say!.text, VOICE_DIR), lead = s.say!.lead ?? 0.5;
  const pcm = new Int16Array(5 * RATE); pcm.set(line.samples.subarray(0, Math.max(0, pcm.length - Math.round(lead * RATE))), Math.round(lead * RATE));
  const wav = encodeWav({ sampleRate: RATE, samples: pcm }), sha = sha256(wav), cache = path.join(VOICE_DIR, `${voiceKey(s.say!.text)}.lead${lead}.json`);
  const cached = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8")) as { url: string; sha: string } : null;
  if (cached?.sha === sha && await fetch(cached.url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(20_000) }).then((r) => r.status === 200 || r.status === 206, () => false)) return cached;
  const url = await uploadInput(io, creds, wav, "audio/wav");
  fs.writeFileSync(cache, JSON.stringify({ url, sha }) + "\n");
  return { url, sha };
}

async function makeStills(c: Concept, only: string | null, ledger: Ledger, io: Io, creds: Creds) {
  const takes = readTakes(c.id), refs = c.look === "live" ? await liveSheet(ledger, io, creds) : await references(io, creds);
  for (const s of c.shots) {
    if ((only && only !== s.id) || s.stillFrom) continue;
    const take = (takes.stills[s.id] ??= 1); saveTakes(c.id, takes);
    const params: Record<string, unknown> = s.rawStill ? { prompt: stillPrompt(s), resolution: "2k", aspect_ratio: "9:16", quality: "medium" } : stillParams(c, s.id, refs.urls), file = stillFile(c, s.id, take);
    // A finished take is never asked for again — not even when the wording has changed since (that is what a retake is for).
    if (ledger.entries.find((e) => e.key === stillKey(c, s.id, take))?.status === "completed" && fs.existsSync(file)) { io.log(`  still ${s.id} take ${take}: ${rel(file)}  (already paid for — nothing asked)`); continue; }
    await assertClipBudget(ledger, c, PILOT.image.model, params, io, creds);
    const r = await generate({ input: { key: stillKey(c, s.id, take), kind: "image", model: PILOT.image.model, params, identity: s.rawStill ? params : { ...params, image_urls: refs.shas }, file }, ledger, save: saveLedger, creds, io });
    io.log(`  still ${s.id} take ${take}: ${rel(file)}${r.paid ? `  (${r.entry.credits} credits)` : "  (already paid for — nothing asked)"}`);
  }
}
async function makeVideos(c: Concept, only: string | null, ledger: Ledger, io: Io, creds: Creds, talkTakes = 1) {
  const takes = readTakes(c.id);
  for (const s of c.shots) {
    if (only && only !== s.id) continue;
    const ref = stillRef(c, s), st = ref.take, still = ledger.entries.find((e) => e.key === `${ref.concept}/${ref.shot}/still/take${st}`);
    if (!st || still?.status !== "completed" || !still.outputUrl) throw new Error(`${c.id} ${s.id}: no finished still — run --stills, and look at it, first`);
    const first = (takes.videos[s.id] ??= 1); saveTakes(c.id, takes);
    // A talking shot may be asked for more than once: the takes are measured and the one nearest the approved voice is kept.
    // (Takes 1…N — NOT "N more from the kept one": a repeated run must find them all there and ask for nothing.)
    const wanted = s.video === "talk" ? [...new Set([...Array.from({ length: Math.max(1, talkTakes) }, (_x, i) => i + 1), first])] : [first];
    for (const take of wanted) {
      const file = videoFile(c, s.id, st, take);
      if (ledger.entries.find((e) => e.key === videoKey(c, s.id, st, take))?.status === "completed" && fs.existsSync(file)) { io.log(`  video ${s.id} take ${take}: ${rel(file)}  (already paid for — nothing asked)`); continue; }
      const audio = s.video === "wan-talk" ? await drivingAudio(s, io, creds) : null;
      await assertClipBudget(ledger, c, videoModel(s), videoParams(s, still.outputUrl, audio?.url), io, creds);
      const r = await generate({ input: { key: videoKey(c, s.id, st, take), kind: "video", model: videoModel(s), params: videoParams(s, still.outputUrl, audio?.url), identity: { ...videoParams(s, "", audio?.sha), still: still.sha256 }, file }, ledger, save: saveLedger, creds, io });
      io.log(`  video ${s.id} take ${take} (${s.video ?? "kling"}, from still take ${st}): ${rel(file)}${r.paid ? `  (${r.entry.credits} credits)` : "  (already paid for — nothing asked)"}`);
    }
    if (s.video !== "talk") continue;
    // Measure every take of this shot that exists; keep the best one that says the line.
    const all: TalkCheck[] = [];
    for (let take = 1; fs.existsSync(videoFile(c, s.id, st, take)); take++) all.push(await checkTalk(videoFile(c, s.id, st, take), s.say!.text, take));
    const talk = readTalk(c.id); talk[s.id] = all; fs.writeFileSync(talkFile(c.id), JSON.stringify(talk, null, 2) + "\n");
    for (const t of all) io.log(`    take ${t.take}: pitch ${t.print.f0} Hz (${(t.voice.f0Off * 100).toFixed(0)}% from the approved ${REFERENCE.f0}), brightness ${t.print.centroid} Hz (${(t.voice.centroidOff * 100).toFixed(0)}%), speaks ${t.speech ? `${t.speech.start}–${t.speech.end} s` : "—"}; heard: ${t.heard === null ? "(no recogniser installed — words unverified)" : `“${t.heard}”`}${t.problems.length ? `  ✗ ${t.problems.join("; ")}` : "  ✓"}`);
    const good = all.filter((t) => !t.problems.length).sort((a, b) => a.voice.distance - b.voice.distance)[0] ?? all.filter((t) => t.wordsOk !== false && t.print.f0 > 0).sort((a, b) => a.voice.distance - b.voice.distance)[0];
    if (good) { takes.videos[s.id] = good.take; saveTakes(c.id, takes); io.log(`    → take ${good.take} is kept${good.problems.length ? " (the nearest; it is OUTSIDE the band — listen before using it)" : ""}`); }
    else io.log(`    → no take says the line: ask for another (--retake-video ${s.id})`);
  }
}

/**
 * Where a clip MOVES: bursts of frame-to-frame change (a nail gun's kick, a drill's jolt, a chalk line's
 * snap, a fall landing), in seconds from `from`. The picture is read small and grey; a burst is a local
 * maximum of the change that stands clear of the clip's own average, at least 0.28 s after the one before.
 */
export async function motionPeaks(file: string, from: number, seconds: number): Promise<{ at: number; strength: number }[]> {
  const w = 48, h = 86, fps = 24, size = w * h;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn("flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4", "-ss", String(from), "-t", String(seconds), "-i", file, "-vf", `fps=${fps},scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg (motion) exited ${code}`))));
  });
  return peaksOf(Array.from({ length: Math.max(0, Math.floor(raw.length / size) - 1) }, (_x, i) => { let d = 0; for (let k = 0; k < size; k++) d += Math.abs(raw[(i + 1) * size + k] - raw[i * size + k]); return d / size; }), fps);
}
/** The bursts in a series of per-frame change values (exported for the tests). */
export function peaksOf(diff: readonly number[], fps: number, minGapSec = 0.28): { at: number; strength: number }[] {
  if (diff.length < 3) return [];
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length, sd = Math.sqrt(diff.reduce((a, b) => a + (b - mean) ** 2, 0) / diff.length);
  const out: { at: number; strength: number }[] = [];
  if (sd < 1e-9) return out;
  for (let i = 1; i < diff.length - 1; i++) {
    if (diff[i] < mean + 0.6 * sd || diff[i] < diff[i - 1] || diff[i] < diff[i + 1]) continue;
    const at = (i + 1) / fps, last = out[out.length - 1];
    if (last && at - last.at < minGapSec) { if (diff[i] > last.strength) out[out.length - 1] = { at, strength: diff[i] }; continue; }
    out.push({ at, strength: diff[i] });
  }
  return out;
}

export const MAX_SHIFT = 320;
/** The y (of 1920) of the top of his yellow hard hat at its highest in a stretch of a clip — or null when no hat is found. */
export async function hatTop(file: string, from: number, seconds: number): Promise<number | null> {
  const w = 108, h = 192, size = w * h * 3;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn("flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "4", "-ss", String(from), "-t", String(seconds), "-i", file, "-vf", `fps=3,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=rgb24`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg (hat) exited ${code}`))));
  });
  let top: number | null = null;
  for (let f = 0; f + size <= raw.length; f += size) { const y = hatRow(raw.subarray(f, f + size), w, h); if (y !== null && (top === null || y < top)) top = y; }
  return top === null ? null : Math.round((top / h) * H);
}
/** The first row of an RGB frame that holds a run of hard-hat yellow (exported for the tests). */
export function hatRow(rgb: Uint8Array, w: number, h: number): number | null {
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 3, r = rgb[o], g = rgb[o + 1], b = rgb[o + 2]; if (r > 190 && g > 140 && g < 235 && b < 95 && r - b > 120) n++; }
    // A hat is a patch; a row that is yellow from edge to edge is a sunset.
    if (n >= Math.max(3, Math.round(w * 0.05)) && n <= w * 0.6) return y;
  }
  return null;
}

/** Subtitles from the recogniser's words: a few words at a time, on screen while they are said (times offset by `t0`). */
export function subtitleBeats(words: readonly Word[], t0: number, endSec: number): Beat[] {
  const subs: Beat[] = [];
  let cur: Word[] = [];
  const flush = (until: number) => { if (cur.length) subs.push({ at: Math.max(0, t0 + cur[0].start - 0.06), until: Math.min(endSec, t0 + until), text: cur.map((x) => x.w).join(" "), pos: "low", small: true }); cur = []; };
  for (const wd of words) {
    const text = [...cur, wd].map((x) => x.w).join(" ");
    if (cur.length && (text.length > 26 || wd.start - cur[cur.length - 1].end > 0.6 || /[.!?…—]$/.test(cur[cur.length - 1].w))) flush(Math.min(wd.start - 0.02, cur[cur.length - 1].end + 0.9));
    cur.push(wd);
  }
  flush((cur[cur.length - 1]?.end ?? 0) + 0.9);
  return subs.filter((b) => b.until > b.at + 0.05);
}

/** A spoken line as caption beats: sentence-sized pieces, each on screen for its share of the line's length. */
export function lineBeats(text: string, startSec: number, lineSec: number, endSec: number, words?: readonly Word[]): Beat[] {
  const pieces: string[] = [];
  for (const sentence of text.trim().split(/(?<=[.!?…][”"']?)\s+/)) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + 1 + sentence.length <= 30) pieces[pieces.length - 1] = `${last} ${sentence}`; else pieces.push(sentence);
  }
  // With the recogniser's word times, a piece appears when its first word is said; without, by its share of the line.
  const counts = pieces.map((p) => plainWords(p.replace(/-/g, " ")).length), heard = words && words.length >= counts.reduce((a, b) => a + b, 0) ? words : null;
  const total = pieces.reduce((n, p) => n + p.length, 0);
  let t = startSec, k = 0;
  const starts = pieces.map((p, i) => { const at = heard ? Math.max(startSec, heard[k].start - 0.08) : t; t += (lineSec * p.length) / total; k += counts[i]; return at; });
  return pieces.map((p, i) => ({ at: starts[i], until: Math.min(endSec, i === pieces.length - 1 ? startSec + lineSec + 0.7 : starts[i + 1]), text: p, pos: "low" as const }));
}

/**
 * The clip's clock. `spoken`: how long each talking shot's line takes (seconds, by shot id) — known only
 * once the line exists; with it, the line gets its captions and `pops` (shot id → times within the shot)
 * replace a synced shot's fixed-beat pops.
 */
export function timeline(c: Concept, spoken: Record<string, number> = {}, pops: Record<string, number[]> = {}, lineAt: Record<string, number> = {}, words: Record<string, Word[]> = {}): { shots: { id: string; start: number; frames: number }[]; bodySec: number; totalSec: number; beats: Beat[]; cues: Cue[] } {
  let t = 0;
  const shots: { id: string; start: number; frames: number }[] = [], beats: Beat[] = [], cues: Cue[] = [];
  for (const s of c.shots) {
    const frames = Math.round(s.use * FPS), dur = frames / FPS;
    s.beats.forEach((b, i) => {
      // A beat stays until the next one in the same place (a low line does not wipe the hook above it).
      const next = s.beats.slice(i + 1).find((x) => (x.pos ?? "top") === (b.pos ?? "top"))?.at ?? dur;
      beats.push({ at: t + b.at, until: t + Math.min(dur, b.dur ? b.at + b.dur : next), text: b.text, accent: b.accent, pos: b.pos ?? "top" });
    });
    if (s.say && spoken[s.id]) {
      // Where the line starts: where he was HEARD to start (a talking model picks its own moment), else the written lead.
      const lead = lineAt[s.id] ?? s.say.lead ?? 0.5;
      if (lead + spoken[s.id] + (lineAt[s.id] !== undefined ? 0 : 0.25) > dur + 0.05) throw new Error(`${c.id} ${s.id}: the line takes ${spoken[s.id].toFixed(2)} s from ${lead} s — longer than the shot (${dur.toFixed(2)} s). Shorten the line or lengthen \`use\`.`);
      if (c.subtitles && words[s.id]?.length) beats.push(...subtitleBeats(words[s.id], t, t + dur));
      else beats.push(...lineBeats(s.say.text, t + lead, spoken[s.id], t + dur, words[s.id]?.map((x) => ({ ...x, start: t + x.start, end: t + x.end }))));
    }
    if (pops[s.id]?.length) {
      const g = (s.cues.find((q) => q.type === "pop") as { gain?: number } | undefined)?.gain;
      for (const q of s.cues) if (q.type !== "pop") cues.push({ ...q, at: t + q.at, ...("until" in q && q.until !== undefined ? { until: t + q.until } : {}) } as Cue);
      for (const at of pops[s.id]) if (at < dur) cues.push({ type: "pop", at: t + at, ...(g ? { gain: g } : {}) });
      shots.push({ id: s.id, start: t, frames }); t += dur; continue;
    }
    for (const q of s.cues) cues.push({ ...q, at: t + q.at, ...("until" in q && q.until !== undefined ? { until: t + q.until } : {}) } as Cue);
    shots.push({ id: s.id, start: t, frames });
    t += dur;
  }
  // The tag has its own small sound, so the cut to it is felt.
  const tag = c.endTagSec ?? END_TAG_SEC;
  if (tag > 0) cues.push({ type: "whoosh", at: Math.max(0, t - 0.12), dur: 0.3, gain: 0.6 }, { type: "ding", at: t + 0.12, gain: 0.5 });
  return { shots, bodySec: t, totalSec: t + tag, beats, cues };
}

/**
 * A ONE-SHOT clip (the live formats): the take as it is — filled to 1080×1920, its own sound brought to
 * level — and NOTHING else: no caption, no logo, no end tag (`pure.mp4`). Beside it, for comparison and
 * for a muted feed, `captioned.mp4`: the same with small subtitles of what he is heard to say.
 */
async function assembleOneShot(c: Concept, io: Io) {
  const dir = path.join(OUT, c.id), work = path.join(dir, "_work"), takes = readTakes(c.id), s = c.shots[0];
  fs.mkdirSync(work, { recursive: true });
  const w = (f: string) => path.join(work, f);
  const src = videoFile(c, s.id, stillRef(c, s).take, takes.videos[s.id] ?? 0);
  if (!fs.existsSync(src)) throw new Error(`${c.id}: no clip — run --videos`);
  const t = s.say ? (readTalk(c.id)[s.id] ?? []).find((x) => x.take === takes.videos[s.id]) : undefined;
  if (s.say && !t) throw new Error(`${c.id}: this take was never measured — run --videos`);
  const sec = s.use, frames = Math.round(sec * FPS), k = t?.pitchRatio && Math.abs(t.pitchRatio - 1) > 0.02 && Math.abs(t.pitchRatio - 1) <= 0.12 ? t.pitchRatio : 1;
  // Its own sound: (pitch onto the approved voice when it is close enough to move without sounding processed,) then loud and level.
  const pre = `${k !== 1 ? `asetrate=${RATE}*${k},aresample=${RATE},atempo=${(1 / k).toFixed(4)},` : ""}highpass=f=60`;
  const target = `loudnorm=I=${LOUDNESS.I}:TP=-1.5:LRA=${LOUDNESS.LRA}`;
  const pass1 = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-t", String(sec), "-i", src, "-vn", "-af", `aresample=${RATE},${pre},${target}:print_format=json`, "-f", "null", "-"], { nice: true })).stderr;
  const lm = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1)) as Record<string, string>;
  const audio = `[0:a]aresample=${RATE},${pre},${target}:measured_I=${lm.input_i}:measured_TP=${lm.input_tp}:measured_LRA=${lm.input_lra}:measured_thresh=${lm.input_thresh}:offset=${lm.target_offset}:linear=true,apad=whole_dur=${sec.toFixed(3)},aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a]`;
  const picture = `[0:v]fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p`;
  // Subtitles: what he was HEARD to say, a few words at a time, when he says them.
  const subs: Beat[] = t?.words?.length ? subtitleBeats(t.words, 0, sec) : [];
  fs.writeFileSync(w("subs.ass"), assFile(subs.map(layoutBeat)));
  fs.copyFileSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"), w("Anton-Regular.ttf"));
  const outs: Record<string, any> = {};
  for (const [name, video] of [["pure", `${picture}[v]`], ["captioned", `${picture},ass=subs.ass:fontsdir=.[v]`]] as const) {
    const out = path.join(dir, `${name}.mp4`);
    fs.writeFileSync(w(`${name}.graph`), `${video};\n${audio}`);
    await run("ffmpeg", [...FF, "-i", src, "-filter_complex_threads", "4", "-filter_complex_script", `${name}.graph`, "-map", "[v]", "-map", "[a]", ...CODEC, "-t", sec.toFixed(3), "-movflags", "+faststart", out], { nice: true, cwd: work });
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", out])).stdout), v = probe.streams.find((x: any) => x.codec_type === "video");
    const data = fs.readFileSync(out), loud = await measureLoudness(out);
    if (v?.width !== W || v?.height !== H || v?.avg_frame_rate !== `${FPS}/1` || Math.abs(Number(probe.format.duration) - sec) > 0.15) throw new Error(`${c.id} ${name}.mp4: ${v?.width}x${v?.height} ${v?.avg_frame_rate} ${probe.format.duration} s`);
    if (Math.abs(loud.lufs - LOUDNESS.I) > 2) throw new Error(`${c.id} ${name}.mp4: ${loud.lufs} LUFS`);
    outs[name] = { file: `${name}.mp4`, width: W, height: H, fps: FPS, durationSec: Math.round(Number(probe.format.duration) * 100) / 100, bytes: data.length, sha256: sha256(data), lufs: loud.lufs, truePeakDb: loud.truePeakDb };
  }
  const pure = path.join(dir, "pure.mp4");
  fs.copyFileSync(pure, path.join(dir, "clip.mp4"));
  await run("ffmpeg", [...FF, "-ss", "0.800", "-i", pure, "-frames:v", "1", "-q:v", "2", "-update", "1", path.join(dir, "cover.jpg")], { nice: true });
  await run("ffmpeg", [...FF, "-i", path.join(dir, "captioned.mp4"), "-vf", `fps=${(18 / sec).toFixed(4)},scale=240:426,tile=9x2`, "-frames:v", "1", "-q:v", "3", "-update", "1", path.join(dir, "review.jpg")], { nice: true });
  const posts = postsOf(c), ledger = readLedger();
  fs.writeFileSync(path.join(dir, "social.json"), JSON.stringify({
    conceptId: c.id, title: c.title, stream: "viral", style: c.style ?? null, look: c.look ?? "cartoon", cut: "oneshot", format: c.format, evergreen: c.evergreen, hook: c.hook,
    clip: { ...outs.pure, file: "clip.mp4", cover: "cover.jpg", coverMs: 800 }, variants: outs,
    aiGenerated: true,
    disclosure: { tiktok: { isAiGenerated: true, isYourBrand: true, isBrandedContent: false }, youtube: { containsSyntheticMedia: true }, instagram: "the caption says so (#aicontent); switch on “AI info” in the app after posting", linkedin: "the text says so", note: AI_NOTE },
    platforms: posts,
    speech: t ? { script: s.say!.text, heard: t.heard, wordsOk: t.wordsOk, voice: { f0: t.print.f0, centroid: t.print.centroid, f0OffReference: t.voice.f0Off, centroidOffReference: t.voice.centroidOff, inBand: t.voice.inBand, pitchRatioApplied: k }, speaks: t.speech } : null,
    generation: { model: videoModel(s), seconds: s.seconds ?? 5, videoTake: takes.videos[s.id], credits: clipSpent(ledger, c.id) },
  }, null, 2) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
  io.log(`  ${rel(pure)} + captioned.mp4  ${W}x${H}  ${outs.pure.durationSec} s  ${outs.pure.lufs} LUFS, true peak ${outs.pure.truePeakDb} dBTP${t ? `  heard: “${t.heard ?? "(unverified)"}”` : ""}  — LOOK at ${rel(path.join(dir, "review.jpg"))}`);
}

async function assemble(c: Concept, io: Io) {
  if (c.cut === "oneshot") return assembleOneShot(c, io);
  const dir = path.join(OUT, c.id), work = path.join(dir, "_work"), takes = readTakes(c.id), ledger = readLedger();
  fs.mkdirSync(work, { recursive: true });
  const w = (f: string) => path.join(work, f);
  const lineSec: Record<string, number> = {}, pops: Record<string, number[]> = {};
  const talkOf: Record<string, TalkCheck | undefined> = {}, lineAt: Record<string, number> = {}, wordsOf: Record<string, Word[]> = {};
  for (const s of c.shots) {
    if (!s.say || s.video === "kling-voice") continue;
    if (s.video !== "talk") { lineSec[s.id] = (await speak(s.say.text, VOICE_DIR)).ms / 1000; continue; }
    const t = (readTalk(c.id)[s.id] ?? []).find((x) => x.take === takes.videos[s.id]);
    if (!t?.speech) throw new Error(`${c.id} ${s.id}: this talking take was never measured — run --videos`);
    if (t.wordsOk === false) throw new Error(`${c.id} ${s.id}: take ${t.take} does not say the line (${t.problems.join("; ")}) — retake it`);
    talkOf[s.id] = t; lineAt[s.id] = Math.max(0, t.speech.start - 0.08); lineSec[s.id] = t.speech.end - lineAt[s.id];
    if (t.words) wordsOf[s.id] = t.words;
  }
  for (const s of c.shots) if (s.sync) {
    const f = videoFile(c, s.id, stillRef(c, s).take, takes.videos[s.id] ?? 0);
    if (fs.existsSync(f)) { const found = await motionPeaks(f, s.from ?? 0, s.use * (s.speed ?? 1)); pops[s.id] = (s.sync === "max" ? found.slice().sort((a, b) => b.strength - a.strength).slice(0, 1) : found).map((p) => p.at / (s.speed ?? 1)).sort((a, b) => a - b); io.log(`  ${s.id}: foley on the picture's own motion at ${pops[s.id].map((x) => x.toFixed(2)).join(", ") || "— none found, the written beat is kept"} s`); }
  }
  const tl = timeline(c, lineSec, pops, lineAt, wordsOf);
  if (tl.totalSec > MAX_SEC) throw new Error(`${c.id} is ${tl.totalSec.toFixed(1)} s — ${MAX_SEC} s at most`);
  const clips = c.shots.map((s) => { const f = videoFile(c, s.id, stillRef(c, s).take, takes.videos[s.id] ?? 0); if (!fs.existsSync(f)) throw new Error(`${c.id} ${s.id}: no clip — run --videos`); return f; });

  // Captions, logo, end tag, bubbles.
  const boxes = tl.beats.map(layoutBeat);
  // Room for the hook: the image model does not reliably leave the top of the frame empty, so each shot is
  // measured — where the top of his hard hat is — and the picture is moved down just far enough for the top
  // caption to clear it (the gap above is the sky or ceiling mirrored and blurred; what leaves the bottom of
  // the frame is under the platform's own caption anyway).
  const shift: number[] = [];
  for (const [i, s] of c.shots.entries()) {
    if (s.shiftDown !== undefined) { shift.push(s.shiftDown); continue; }
    const a = tl.shots[i].start, b = a + tl.shots[i].frames / FPS;
    const bottom = Math.max(0, ...boxes.filter((x) => x.beat.pos === "top" && x.beat.at < b && x.beat.until > a).map((x) => x.rect.y + x.rect.h));
    if (!bottom) { shift.push(0); continue; }
    const hat = await hatTop(clips[i], s.from ?? 0, s.use * (s.speed ?? 1));
    const need = hat === null ? 0 : Math.min(MAX_SHIFT, Math.max(0, Math.ceil((bottom + 24 - hat) / 2) * 2));
    if (need) io.log(`  ${s.id}: his hard hat reaches y=${hat}; the caption ends at y=${bottom} — picture moved down ${need} px${need === MAX_SHIFT && bottom + 24 - hat! > MAX_SHIFT ? " (the most allowed: the caption still touches the hat — retake the still with more headroom)" : ""}`);
    shift.push(need);
  }
  fs.writeFileSync(w("captions.ass"), assFile(boxes));
  fs.copyFileSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"), w("Anton-Regular.ttf"));
  await renderStill(logoHtml(), w("logo.png"), LOGO_RECT.w, { size: { width: LOGO_RECT.w, height: LOGO_RECT.h }, transparent: true });
  await renderStill(endTagHtml(), w("end.png"), W, { size: { width: W, height: H } });
  const bubbles = c.shots.flatMap((s, i) => (s.bubble ? [{ ...s.bubble, start: tl.shots[i].start + s.bubble.at, file: `bubble-${s.id}.png` }] : []));
  for (const b of bubbles) await renderStill(bubbleHtml(b.text, b.tail), w(b.file), BUBBLE.w, { size: { width: BUBBLE.w, height: BUBBLE.h }, transparent: true });

  // Sound: the bed is synthesised here; a spoken line is his one voice (voice.ts) — or, for the comparison
  // model only, the clip's own generated speech. The bed sits well under the line.
  const bed = synth(tl.cues, tl.totalSec), speech = new Float32Array(bed.length);
  const peakOf = (a: Float32Array) => { let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); return p; };
  const spoken: { shot: string; text: string; startSec: number; endSec: number }[] = [];
  for (const [i, s] of c.shots.entries()) {
    const own = s.video === "kling-voice" || s.video === "talk";
    if (!s.say && !own) continue;
    let pcm: Int16Array, at = tl.shots[i].start;
    if (own) {
      const raw = w(`own-${s.id}.raw`), t = talkOf[s.id];
      // The take's own voice, pulled onto the approved pitch (rate change, then tempo back: its length and so its
      // lip-sync are unchanged) and through one fixed chain, so every clip is levelled and coloured the same way.
      const k = t?.pitchRatio ?? 1;
      const chain = s.video === "talk" ? `${Math.abs(k - 1) > 0.01 && Math.abs(k - 1) <= 0.12 ? `asetrate=${RATE}*${k},aresample=${RATE},atempo=${(1 / k).toFixed(4)},` : ""}highpass=f=75,bass=g=2:f=140:w=0.8,equalizer=f=3000:t=q:w=1.2:g=1.5,acompressor=threshold=-22dB:ratio=3:attack=5:release=100:makeup=4,alimiter=limit=0.89` : "anull";
      await run("ffmpeg", [...FF, "-ss", String(s.from ?? 0), "-t", String(s.use), "-i", clips[i], "-vn", "-ac", "1", "-ar", String(RATE), "-af", chain, "-f", "s16le", raw], { nice: true });
      const b = fs.readFileSync(raw); pcm = new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)).slice();
    } else { pcm = (await speak(s.say!.text, VOICE_DIR)).samples; at += s.say!.lead ?? 0.5; }
    const a0 = Math.round(at * RATE), gain = (s.ownGain ?? 0.7) / 0.7;
    for (let k = 0; k < pcm.length && a0 + k < speech.length; k++) speech[a0 + k] += (pcm[k] / 32768) * gain;
    if (!s.say) continue;
    const sp0 = s.video === "talk" && talkOf[s.id]?.speech ? talkOf[s.id]!.speech! : null;
    spoken.push({ shot: s.id, text: s.say.text, startSec: sp0 ? tl.shots[i].start + sp0.start : at, endSec: Math.min(tl.bodySec, sp0 ? tl.shots[i].start + sp0.end : at + pcm.length / RATE) });
  }
  const bp = peakOf(bed) || 1, sp = peakOf(speech), talking = sp > 0;
  const mix = new Float32Array(bed.length);
  for (let k = 0; k < mix.length; k++) mix[k] = (bed[k] / bp) * (talking ? 0.16 : 0.7) + (talking ? (speech[k] / sp) * 0.7 : 0);
  // How far the line stands above the bed while he is speaking (RMS, dB) — measured, since nobody here can listen.
  let lineOverBedDb: number | null = null;
  if (talking && spoken.length) {
    let es = 0, eb = 0;
    for (const q of spoken) for (let k = Math.round(q.startSec * RATE); k < Math.round(q.endSec * RATE) && k < mix.length; k++) { es += ((speech[k] / sp) * 0.7) ** 2; eb += ((bed[k] / bp) * 0.16) ** 2; }
    lineOverBedDb = Math.round(10 * Math.log10(es / Math.max(eb, 1e-12)) * 10) / 10;
    if (lineOverBedDb < 10) throw new Error(`${c.id}: the line is only ${lineOverBedDb} dB over the bed — it would not be heard`);
  }
  const pcm16 = new Int16Array(mix.length); let clipped = 0;
  for (let k = 0; k < mix.length; k++) { const v = Math.round(mix[k] * 32767); if (Math.abs(v) > 32767) clipped++; pcm16[k] = Math.max(-32768, Math.min(32767, v)); }
  if (clipped) throw new Error(`${c.id}: ${clipped} samples of the mix clip`);
  fs.writeFileSync(w("sound.wav"), encodeWav({ sampleRate: RATE, samples: pcm16 }));
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
      + (shift[i] ? `pad=${W}:${H + shift[i]}:0:${shift[i]},fillborders=top=${shift[i]}:mode=mirror,crop=${W}:${H}:0:0,split[m${i}][t${i}];[t${i}]crop=${W}:${shift[i] + 16}:0:0,gblur=sigma=22[u${i}];[m${i}][u${i}]overlay=0:0,` : "") + `setsar=1,format=yuv420p[s${i}]`);
  });
  graph.push(`${c.shots.map((_s, i) => `[s${i}]`).join("")}concat=n=${n}:v=1:a=0[body]`);
  graph.push(`[body]ass=captions.ass:fontsdir=.[cap]`);
  graph.push(c.logo === false ? `[cap]null[b0]` : `[cap][${n}:v]overlay=${LOGO_RECT.x}:${LOGO_RECT.y}:shortest=1[b0]`);
  bubbles.forEach((b, i) => graph.push(`[b${i}][${n + 3 + i}:v]overlay=${Math.round(b.x - BUBBLE.w / 2)}:${Math.round(b.y - BUBBLE.h / 2)}:shortest=1:enable='between(t,${b.start.toFixed(3)},${(b.start + b.dur).toFixed(3)})'[b${i + 1}]`));
  const tagSec = c.endTagSec ?? END_TAG_SEC;
  if (tagSec > 0) {
    graph.push(`[${n + 1}:v]fps=${FPS},scale=${W}:${H},setsar=1,format=yuv420p,trim=end_frame=${Math.round(tagSec * FPS)},setpts=PTS-STARTPTS[end]`);
    graph.push(`[b${bubbles.length}][end]concat=n=2:v=1:a=0,format=yuv420p[v]`);
  } else graph.push(`[b${bubbles.length}]format=yuv420p[v]`);
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
    sound: { idea: c.sound, source: "the bed is synthesised in scripts/gator/sound.ts — no recorded or licensed audio" },
    speech: spoken.length ? { lines: spoken, voice: c.shots.some((s) => s.video === "kling-voice") ? "the video model's own generated voice (comparison only)" : "the gator's voice — docs/gator/VOICE.md", lineOverBedDb } : null,
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

/** The real network, clock and disk. */
export function realIo(): { io: Io; creds: Creds; say: (l: string) => void } {
  const creds: Creds = { id: process.env.TUTORIAL_HIGGSFIELD_KEY_ID ?? "", secret: process.env.TUTORIAL_HIGGSFIELD_KEY_SECRET ?? "" };
  const say = (line: string) => console.log(redact(line, creds));
  const io: Io = {
    fetch: async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) } as RequestInit); return { status: r.status, text: () => r.text() }; },
    sleep, now: () => new Date(), log: say,
    download: async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(300_000) }); if (!r.ok) throw new Error(`the output answered ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    write: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }, exists: (file) => fs.existsSync(file),
  };
  return { io, creds, say };
}
/**
 * What a machine can see wrong with a still: the image model sometimes returns the picture as a panel on
 * white (bands above and below, or a vignette) instead of filling the frame. Null when the edges look drawn.
 */
export async function stillFault(file: string): Promise<string | null> {
  const w = 54, h = 96, raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-threads", "2", "-i", file, "-vf", `scale=${w}:${h},format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg (still) exited ${code}`))));
  });
  return bandFault(raw, w, h);
}
/** Exported for the tests: rows that are flat near-white at the top or bottom edge. */
export function bandFault(rgb: Uint8Array, w: number, h: number): string | null {
  const blank = (y: number) => { let min = 255, max = 0; for (let x = 0; x < w * 3; x++) { const v = rgb[y * w * 3 + x]; if (v < min) min = v; if (v > max) max = v; } return min > 225 && max - min < 22; };
  let top = 0, bottom = 0;
  while (top < h && blank(top)) top++;
  while (bottom < h && blank(h - 1 - bottom)) bottom++;
  return top >= h * 0.04 || bottom >= h * 0.04 ? `the picture does not fill the frame (blank band: ${Math.round((top / h) * 100)}% at the top, ${Math.round((bottom / h) * 100)}% at the bottom)` : null;
}

/** One take of everything for a concept, within `budgetCredits`: stills → clips → the finished video. (daily.ts) */
export async function produce(c: Concept, budgetCredits: number): Promise<void> {
  const { io, creds } = realIo(), ledger = readLedger();
  setClipBudget(budgetCredits);
  try {
    await makeStills(c, null, ledger, io, creds);
    // The one fault a machine can see in a still is fixed by the machine, once: a picture that does not fill the frame.
    for (const s of c.shots) {
      if (s.stillFrom) continue;
      const t = readTakes(c.id), fault = await stillFault(stillFile(c, s.id, t.stills[s.id]));
      if (!fault) continue;
      io.log(`  still ${s.id}: ${fault} — one automatic retake`);
      t.stills[s.id]++; delete t.videos[s.id]; saveTakes(c.id, t);
      await makeStills(c, s.id, ledger, io, creds);
    }
    await makeVideos(c, null, ledger, io, creds); await assemble(c, io);
  } finally { setClipBudget(null); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["plan", "stills", "videos", "assemble", "ledger", "live-sheet", "retake-live-sheet"]);
  const { io, creds, say } = realIo();
  try {
    const ledger = readLedger();
    if (args.flags.ledger) { printLedger(ledger, say); return; }
    if (args.flags["live-sheet"] || args.flags["retake-live-sheet"]) { await liveSheet(ledger, io, creds, !!args.flags["retake-live-sheet"]); return; }
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
      const vid = await estimate(io, creds, videoModel(c.shots[0]), videoParams(c.shots[0], "https://constructhub.us/mascot/gator-standing-1024.v1.webp", "https://constructhub.us/mascot/line.wav"));
      const tl = timeline(c);
      say(`${c.id} — “${c.title}”: ${c.shots.length} shot(s), ${tl.totalSec.toFixed(1)} s with the end tag`);
      say(`  one take of everything: ${c.shots.length} × ${img.credits} + ${c.shots.length} × ${vid.credits} = ${(c.shots.length * (img.credits + vid.credits)).toFixed(2)} credits ($${(c.shots.length * (img.usd + vid.usd)).toFixed(2)})`);
      for (const s of c.shots) { say(`  ${s.id} still:  ${stillPrompt(s)}`); say(`  ${s.id} motion: ${motionPrompt(s)}`); }
      printLedger(ledger, say);
      return;
    }
    const all = !args.flags.stills && !args.flags.videos && !args.flags.assemble && typeof args.flags["retake-still"] !== "string" && typeof args.flags["retake-video"] !== "string";
    if (args.flags.stills || all) await makeStills(c, only, ledger, io, creds);
    if (args.flags.videos || all) await makeVideos(c, only, ledger, io, creds, typeof args.flags.takes === "string" ? Number(args.flags.takes) : 1);
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
