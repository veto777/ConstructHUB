/**
 * Shared pieces of the walkthrough-video tools (docs/tutorials/VIDEO-PIPELINE.md):
 *   narrate.ts → record.ts → mux.ts → upload.ts
 * Each takes a step script (docs/tutorials/scripts/<helpKey>.json) and works in
 * analysis/video-out/<helpKey>/ (git-ignored) unless --out says otherwise.
 */
import { createHash } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { parseTutorialScript, type TutorialScript } from "../../shared/help/step-script";
import { helpEntry } from "../../shared/help/registry";

export const ROOT = path.resolve(import.meta.dirname, "../..");
/** Where the dev server reads tutorial media when R2 is not configured (server/tutorials/media.ts). */
export const LOCAL_STORE = process.env.TUTORIALS_LOCAL_DIR || path.join(ROOT, "tmp", "tutorials");
/**
 * Shared by every producer on this box, whatever its working copy: the two global locks, the
 * narration cache and the per-slot app logs.
 */
export const WORK_DIR = process.env.TUTORIAL_WORK_DIR || "/tmp/claude-1000/constructhub-tutorials";
fs.mkdirSync(WORK_DIR, { recursive: true });
/** The voice engine answers LIVE customer calls: one TTS request at a time across ALL producers. */
export const TTS_LOCK = path.join(WORK_DIR, "tts.lock");
/** One ffmpeg at a time across all producers (this box also serves production). */
export const ENCODE_LOCK = path.join(WORK_DIR, "encode.lock");
/** Narration clips by hash of persona + text — a re-record, in any slot or working copy, asks the engine for nothing. */
export const TTS_CACHE = path.join(WORK_DIR, "tts-cache");

export type Args = { _: string[]; flags: Record<string, string | true> };
/** `--name value`, `--name=value` and bare `--flag`; everything else is positional. */
export function parseArgs(argv: string[] = process.argv.slice(2), booleans: string[] = []): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const name = a.slice(2);
    if (booleans.includes(name) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) out.flags[name] = true;
    else out.flags[name] = argv[++i];
  }
  return out;
}
export const flagStr = (a: Args, name: string, fallback?: string): string | undefined =>
  typeof a.flags[name] === "string" ? (a.flags[name] as string) : fallback;
export const flagNum = (a: Args, name: string, fallback: number): number => {
  const v = flagStr(a, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};

/** Load a step script; its file name must be its help key and the key must be in the registry. */
export function loadScript(file: string): { script: TutorialScript; title: string } {
  const abs = path.resolve(file);
  const { $schema: _schema, ...json } = JSON.parse(fs.readFileSync(abs, "utf8"));
  const script = parseTutorialScript(json);
  if (path.basename(abs) !== `${script.helpKey}.json`) throw new Error(`${file}: the file name must be <helpKey>.json (${script.helpKey}.json)`);
  const entry = helpEntry(script.helpKey);
  if (!entry) throw new Error(`${script.helpKey} is not a key of the help registry`);
  return { script, title: entry.title };
}
export const outDir = (a: Args, helpKey: string): string => {
  const dir = path.resolve(flagStr(a, "out") ?? path.join(ROOT, "analysis", "video-out", helpKey));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** KEY=value lines of an env file — only the keys asked for. Values are returned, never logged. */
export function readEnvFile(file: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !keys.includes(m[1])) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Split narration into pieces the voice engine accepts (≤ max characters), on sentence ends first and
 * on commas / words only when one sentence is longer than that.
 */
/** Sentences end at . ! or ? followed by a space and a capital — so "D.C." and "3.5" stay whole. */
export const sentencesOf = (text: string): string[] =>
  text.replace(/\s+/g, " ").trim().split(/(?<=[.!?]["”’)]*)\s+(?=["“‘(]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);

export function splitNarration(text: string, max = 400): string[] {
  const sentences = sentencesOf(text);
  const pieces: string[] = [];
  const push = (s: string) => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + 1 + s.length <= max) pieces[pieces.length - 1] = `${last} ${s}`;
    else pieces.push(s);
  };
  for (const s of sentences) {
    if (s.length <= max) { push(s); continue; }
    let rest = s;
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(", ", max - 1) + 1, 0) || rest.lastIndexOf(" ", max);
      if (cut <= 0) throw new Error(`Narration has a ${rest.length}-character run with no place to split`);
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }
  return pieces;
}

/** Caption cues for one narration line: sentence-sized pieces of at most ~`max` characters. */
export function splitCaption(text: string, max = 84): string[] {
  const out: string[] = [];
  for (const sentence of sentencesOf(text)) out.push(...splitNarration(sentence, max));
  return out;
}

// ── WAV (the voice engine returns 24 kHz mono; clips are kept as 16-bit PCM) ──────────────────────
export type Pcm = { sampleRate: number; samples: Int16Array };

export function decodeWav(buf: Buffer): Pcm {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(start);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(start + 24); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: buf.readUInt16LE(start + 2), sampleRate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt");
      // A streamed WAV may carry a placeholder size: the data runs to the end of the file.
      if (size === 0xffffffff || size === 0 || start + size > buf.length) size = buf.length - start;
      const bytes = fmt.bits / 8, frame = bytes * fmt.channels, frames = Math.floor(size / frame);
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = start + i * frame + c * bytes;
          if (fmt.format === 3 && fmt.bits === 32) sum += buf.readFloatLE(o);
          else if (fmt.format === 1 && fmt.bits === 16) sum += buf.readInt16LE(o) / 32768;
          else if (fmt.format === 1 && fmt.bits === 24) sum += buf.readIntLE(o, 3) / 8388608;
          else if (fmt.format === 1 && fmt.bits === 32) sum += buf.readInt32LE(o) / 2147483648;
          else throw new Error(`Unsupported WAV encoding (format ${fmt.format}, ${fmt.bits}-bit)`);
        }
        samples[i] = Math.max(-32768, Math.min(32767, Math.round((sum / fmt.channels) * 32767)));
      }
      return { sampleRate: fmt.sampleRate, samples };
    }
    pos = start + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export function encodeWav({ sampleRate, samples }: Pcm): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii"); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}
/**
 * Drop the silence the engine leaves around a line (about 0.3 s before and 0.5 s after), keeping a
 * breath on each side, so a step's length is the length of the speech and the recorder's pad is the
 * only pause between two lines.
 */
export function trimSilence(p: Pcm, keepHeadMs = 50, keepTailMs = 140, threshold = 350): Pcm {
  const s = p.samples;
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < threshold) a++;
  while (b > a && Math.abs(s[b]) < threshold) b--;
  if (a >= b) return p;
  const from = Math.max(0, a - Math.round((keepHeadMs / 1000) * p.sampleRate));
  const to = Math.min(s.length, b + 1 + Math.round((keepTailMs / 1000) * p.sampleRate));
  return { sampleRate: p.sampleRate, samples: s.slice(from, to) };
}
export const pcmMs = (p: Pcm): number => Math.round((p.samples.length / p.sampleRate) * 1000);

/** narration.json — what narrate.ts measured, and what record.ts and mux.ts read. */
export type NarrationClip = { index: number; text: string; file: string; durationMs: number; sha256: string };
export type NarrationIndex = { helpKey: string; persona: string; sampleRate: number; clips: NarrationClip[] };

/** timings.json — where each step sits in raw.mkv (all times in ms since the recorder's clock started). */
export type StepTiming = { index: number; action: string; caption: string; startMs: number; narrationStartMs: number; narrationMs: number; endMs: number };
export type Timings = {
  helpKey: string; viewport: { width: number; height: number }; base: string; recordedAt: string;
  /** Device scale factor, and the capture's size in pixels (viewport × zoom). */
  zoom: number; video: { width: number; height: number };
  /** When the two black sync frames were shown (mux.ts finds them in the video to tie the two clocks together). */
  syncStartMs: number;
  syncEndMs: number;
  /** The first moment worth keeping (the first page has loaded); everything before it is cut. */
  trimStartMs: number;
  endMs: number;
  steps: StepTiming[];
};

/**
 * Hold an exclusive `flock` on a file while `fn` runs. The lock belongs to a small child process
 * (`flock … cat`) and is released when its stdin closes — so it is released even if this process dies.
 */
export async function withLock<T>(file: string, fn: () => Promise<T>, opts: { wait?: boolean } = {}): Promise<T> {
  const child = spawn("flock", [...(opts.wait === false ? ["-n"] : []), "-x", file, "sh", "-c", "echo locked; cat >/dev/null"], { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", () => resolve());
    child.once("exit", (c) => reject(new Error(opts.wait === false ? `${path.basename(file)} is held by another process` : `flock on ${file} exited ${c}`)));
  });
  try { return await fn(); } finally { child.stdin.end(); await new Promise((r) => child.once("exit", r)); }
}

/**
 * Run a program to completion. `nice` is for ffmpeg: this box also serves production, so every
 * ffmpeg runs under the global encode lock (one at a time across all producers) at nice 10 — and
 * every caller passes `-threads 4`.
 */
export function run(cmd: string, args: string[], opts: { nice?: boolean; quiet?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  const [bin, argv] = opts.nice ? ["flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", cmd, ...args]] : [cmd, args];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"], env: opts.env, cwd: opts.cwd });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}\n${(stderr || stdout).slice(-2000)}`)));
  });
}
