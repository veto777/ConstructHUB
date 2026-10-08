/**
 * Narration — stage 2 of docs/tutorials/VIDEO-PIPELINE.md. Run it BEFORE record.ts.
 *
 *   tsx scripts/tutorials/narrate.ts docs/tutorials/scripts/<helpKey>.json [--out analysis/video-out/<helpKey>]
 *
 * One clip per step in the script's narrator voice (the Call Assistant persona — "janice" by default),
 * from the voice engine's preview route:
 *
 *   POST ${VOICE_ENGINE_URL}/tts/preview   Authorization: Bearer ${VOICE_INTERNAL_SECRET}
 *   {"personaId":"janice","text":"…"}      → 24 kHz mono WAV, at most 400 characters a call
 *
 * Both values come from the environment, or are read (read-only, at run time) from the live env file;
 * they are never printed. THE SAME ENGINE ANSWERS LIVE CUSTOMER PHONE CALLS, so every request is made
 * under one machine-wide `flock` (tts.lock): exactly one at a time across ALL producers, with a pause
 * after each. Every piece is cached by the hash of its voice and text in a cache all producers share
 * (a re-record, in any slot, asks for nothing), and a failed request is retried a few times with a
 * long wait rather than hammered.
 *
 * Writes narration/<NN>.wav (16-bit PCM, the silence around each line trimmed) and narration.json (each clip's measured length), which
 * record.ts uses to hold every step for as long as its line takes to say.
 */
import fs from "fs";
import path from "path";
import { lexiconChanges, spokenText, ttsCacheName, unlexiconedBrandTerms } from "./lexicon";
import { TTS_CACHE, TTS_LOCK, decodeWav, encodeWav, loadScript, outDir, parseArgs, pcmMs, readEnvFile, sha256, sleep, splitNarration, trimSilence, withLock, type NarrationIndex, type Pcm } from "./lib";

const MAX_CHARS = 400;        // the engine's limit for /tts/preview
const BETWEEN_CALLS_MS = 250;  // breathing room for the engine after every request — held INSIDE the global lock
/** Where the engine's address and bearer are kept. Read at run time, read-only; never printed, never committed. */
const VOICE_ENV_FILE = process.env.TUTORIAL_VOICE_ENV || "/home/voiceban/ConstructHUB-live/.env";
const RETRY_WAITS_MS = [8000, 20000, 45000];
const SENTENCE_GAP_MS = 220;   // silence between two pieces of one long line

export async function synthesize(engine: string, secret: string, personaId: string, text: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${engine.replace(/\/+$/, "")}/tts/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, text }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`voice engine answered ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      decodeWav(body); // a body that is not audio is a failure, not a clip
      return body;
    } catch (e) {
      const wait = RETRY_WAITS_MS[attempt];
      const why = e instanceof Error ? e.message : String(e);
      if (wait === undefined) throw new Error(`Narration failed after ${attempt + 1} tries: ${why}`);
      console.warn(`  … ${why}; trying again in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

/** The engine's address and bearer: from the environment, else the live env file. Never printed. */
export function voiceEngine(): { engine?: string; secret?: string } {
  let engine = process.env.VOICE_ENGINE_URL, secret = process.env.VOICE_INTERNAL_SECRET;
  if ((!engine || !secret) && fs.existsSync(VOICE_ENV_FILE)) {
    const env = readEnvFile(VOICE_ENV_FILE, ["VOICE_ENGINE_URL", "VOICE_INTERNAL_SECRET"]);
    engine ||= env.VOICE_ENGINE_URL; secret ||= env.VOICE_INTERNAL_SECRET;
  }
  return { engine, secret };
}

export type Narrator = { line(text: string): Promise<Pcm>; called: number; cached: number };
/**
 * The voice for one persona: `line(text)` gives the clip of a narration line (pieces of ≤ 400
 * characters joined with a short gap), each piece from the shared cache or — strictly one request at
 * a time across the machine — from the engine. The engine reads `spokenText(piece)` (the
 * pronunciation lexicon); the cache is keyed accordingly (lexicon.ts).
 */
export function createNarrator(persona: string): Narrator {
  const cacheDir = TTS_CACHE;
  fs.mkdirSync(cacheDir, { recursive: true });
  const { engine, secret } = voiceEngine();
  const me: Narrator = { called: 0, cached: 0, line };
  const piece = async (text: string): Promise<Pcm> => {
    const left = unlexiconedBrandTerms(text);
    if (left.length) throw new Error(`“${left.join("”, “")}” is a brand name in a spelling the pronunciation lexicon does not know (scripts/tutorials/lexicon.ts) — write it “ConstructHUB”`);
    const file = path.join(cacheDir, ttsCacheName(persona, text));
    if (fs.existsSync(file)) { me.cached++; return trimSilence(decodeWav(fs.readFileSync(file))); }
    if (!engine || !secret) throw new Error(`VOICE_ENGINE_URL and VOICE_INTERNAL_SECRET are not set and not in ${VOICE_ENV_FILE}`);
    // ONE request at a time across every producer on this box: the same engine is answering customers' calls.
    return withLock(TTS_LOCK, async () => {
      // Another producer may have asked for this very line while we waited for the lock.
      if (fs.existsSync(file)) { me.cached++; return trimSilence(decodeWav(fs.readFileSync(file))); }
      const wav = await synthesize(engine!, secret!, persona, spokenText(text));
      me.called++;
      const tmp = `${file}.${process.pid}.part`;
      fs.writeFileSync(tmp, wav); fs.renameSync(tmp, file);
      await sleep(BETWEEN_CALLS_MS);
      return trimSilence(decodeWav(wav));
    });
  };
  async function line(text: string): Promise<Pcm> {
    const parts: Pcm[] = [];
    for (const t of splitNarration(text, MAX_CHARS)) parts.push(await piece(t)); // strictly one at a time
    const sampleRate = parts[0].sampleRate;
    if (parts.some((p) => p.sampleRate !== sampleRate)) throw new Error("The engine changed sample rate between clips");
    const gap = Math.round((SENTENCE_GAP_MS / 1000) * sampleRate);
    const samples = new Int16Array(parts.reduce((n, p) => n + p.samples.length, 0) + gap * (parts.length - 1));
    let at = 0;
    for (const p of parts) { samples.set(p.samples, at); at += p.samples.length + gap; }
    return { sampleRate, samples };
  }
  return me;
}

async function main() {
  const args = parseArgs();
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/narrate.ts <script.json> [--out DIR]");
  const { script } = loadScript(args._[0]);
  const dir = outDir(args, script.helpKey);
  const clipsDir = path.join(dir, "narration");
  fs.mkdirSync(clipsDir, { recursive: true });
  const voice = createNarrator(script.narrator);

  const index: NarrationIndex = { helpKey: script.helpKey, persona: script.narrator, sampleRate: 0, clips: [] };
  for (let i = 0; i < script.steps.length; i++) {
    const text = script.steps[i].narration;
    const clip = await voice.line(text);
    if (index.sampleRate && index.sampleRate !== clip.sampleRate) throw new Error("The engine changed sample rate between clips");
    index.sampleRate = clip.sampleRate;
    const name = `${String(i).padStart(2, "0")}.wav`, wav = encodeWav(clip);
    fs.writeFileSync(path.join(clipsDir, name), wav);
    index.clips.push({ index: i, text, file: `narration/${name}`, durationMs: pcmMs(clip), sha256: sha256(wav) });
    console.log(`  ${name}  ${(pcmMs(clip) / 1000).toFixed(2)}s  ${text.length} chars${lexiconChanges(text) ? "  (lexicon)" : ""}`);
  }
  // Clips of steps that no longer exist would be muxed by nobody, but they would confuse a reviewer.
  for (const f of fs.readdirSync(clipsDir)) if (/^\d+\.wav$/.test(f) && Number(f.slice(0, -4)) >= script.steps.length) fs.rmSync(path.join(clipsDir, f));
  fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify(index, null, 2) + "\n");
  const total = index.clips.reduce((n, c) => n + c.durationMs, 0);
  console.log(`${index.clips.length} clips, ${(total / 1000).toFixed(1)}s of speech (${voice.called} requested, ${voice.cached} from cache) → ${dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
