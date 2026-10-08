/**
 * The gator's voice (docs/gator/VOICE.md) — ONE recipe, so every clip is the same guy.
 *
 * The words are spoken by our own voice engine (the Call Assistant's Kokoro engine, the same one
 * scripts/tutorials/narrate.ts uses: POST /tts/preview {personaId, text} → 24 kHz mono WAV), with a
 * male American persona, and then made lower, a touch quicker and rougher in ffmpeg. The engine has
 * no regional accent: the New York / New Jersey colour comes from how the lines are WRITTEN (short,
 * dry, "he says", "fuhgeddaboudit" spelled the way it should be said) — see VOICE.md.
 *
 * THE ENGINE ANSWERS LIVE CUSTOMER CALLS: one request at a time across every producer (tts.lock), a
 * pause after each, and every line cached by the hash of the recipe and its text.
 */
import fs from "fs";
import path from "path";
import { TTS_LOCK, decodeWav, readEnvFile, run, sha256, sleep, withLock } from "../tutorials/lib";

export const VOICE = {
  /** Bump when anything below changes: cached lines of an older recipe are not reused. */
  version: 1,
  persona: "marcus", kokoroVoice: "am_adam",
  /** Played back at this fraction of its rate (lower and slower)… */
  pitch: 0.9,
  /** …then brought back up to a quick, dry delivery without changing the pitch again. */
  tempo: 1.14,
  /** Weight in the chest, a little grit, level evened out. */
  filter: "highpass=f=70,bass=g=5:f=150:w=0.8,equalizer=f=2800:t=q:w=1.2:g=2.5,treble=g=-3:f=7000,acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=5,asoftclip=type=tanh:threshold=0.6",
  rate: 48000,
} as const;
/** The whole processing chain, as ffmpeg takes it (engine audio is 24 kHz mono). */
export const voiceFilter = (v: typeof VOICE = VOICE): string => `asetrate=24000*${v.pitch},aresample=${v.rate},atempo=${v.tempo},${v.filter},aresample=${v.rate}`;
export const voiceKey = (text: string, v: typeof VOICE = VOICE): string => sha256(`gator-voice v${v.version}\n${v.persona}\n${voiceFilter(v)}\n${text}`).slice(0, 32);
const ENV_FILE = process.env.TUTORIAL_VOICE_ENV || "/home/voiceban/ConstructHUB-live/.env";
const MAX_CHARS = 400;

export type Line = { text: string; file: string; samples: Int16Array; ms: number };
/** A line in the gator's voice: 48 kHz mono PCM, silence trimmed — from the cache when it was said before. */
export async function speak(text: string, dir: string): Promise<Line> {
  if (!text.trim() || text.length > MAX_CHARS) throw new Error(`a spoken line is 1–${MAX_CHARS} characters`);
  fs.mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, `${voiceKey(text)}.raw.wav`), file = path.join(dir, `${voiceKey(text)}.wav`);
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(raw)) {
      const env = { VOICE_ENGINE_URL: process.env.VOICE_ENGINE_URL, VOICE_INTERNAL_SECRET: process.env.VOICE_INTERNAL_SECRET, ...(fs.existsSync(ENV_FILE) ? readEnvFile(ENV_FILE, ["VOICE_ENGINE_URL", "VOICE_INTERNAL_SECRET"]) : {}) };
      if (!env.VOICE_ENGINE_URL || !env.VOICE_INTERNAL_SECRET) throw new Error("VOICE_ENGINE_URL and VOICE_INTERNAL_SECRET are not set");
      await withLock(TTS_LOCK, async () => {
        const res = await fetch(`${env.VOICE_ENGINE_URL!.replace(/\/+$/, "")}/tts/preview`, { method: "POST", headers: { Authorization: `Bearer ${env.VOICE_INTERNAL_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ personaId: VOICE.persona, text }), signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`the voice engine answered ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        decodeWav(body);
        fs.writeFileSync(`${raw}.part`, body); fs.renameSync(`${raw}.part`, raw);
        await sleep(300);
      });
    }
    // Trim the engine's silence, then the recipe.
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4", "-i", raw, "-af", `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,${voiceFilter()}`, "-ac", "1", "-ar", String(VOICE.rate), "-c:a", "pcm_s16le", `${file}.part.wav`], { nice: true });
    fs.renameSync(`${file}.part.wav`, file);
  }
  const pcm = decodeWav(fs.readFileSync(file));
  if (pcm.sampleRate !== VOICE.rate) throw new Error(`${file} is ${pcm.sampleRate} Hz`);
  return { text, file, samples: pcm.samples, ms: Math.round((pcm.samples.length / pcm.sampleRate) * 1000) };
}
