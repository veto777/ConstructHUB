/**
 * Measuring a voice, since nobody on the production box can listen (docs/gator/VOICE.md).
 *
 * The gator's talking shots use the video model's own generated voice (the owner picked that sound), and a
 * generated voice is a new performance every time. What can be done about it without ears: describe the
 * voice identically in every prompt, then MEASURE each take — how low it is (median pitch), how bright it
 * is (spectral centroid), when he is speaking — keep only takes near the approved reference, and pull
 * the kept take's pitch onto the reference. Pure functions over 16 kHz mono PCM; tested.
 *
 *   npx tsx scripts/gator/voiceprint.ts <audio-or-video-file>…     print each file's numbers
 */
import path from "path";
import { run } from "../tutorials/lib";

export const PRINT_RATE = 16000;
export type Burst = { start: number; end: number };
export type VoicePrint = {
  /** Median pitch of the voiced frames, Hz — how low the voice sits. */
  f0: number;
  /** The middle half of the pitch values, Hz — how much it moves (a flat, dry delivery is narrow). */
  f0Low: number; f0High: number;
  /** Mean spectral centroid of the voiced frames, Hz — brightness / "gravel" (lower = darker). */
  centroid: number;
  voicedSec: number;
  /** When there is speech-level sound. */
  bursts: Burst[];
};
/** The voice the owner approved on 2026-10-08 (talking-sample-2: Kling 3.0 Standard, sound on) — measured by this file. */
export const REFERENCE: Pick<VoicePrint, "f0" | "centroid"> = { f0: 127, centroid: 1548 };
/** A take is "the same guy" by measurement when its pitch is within this of the reference, and its brightness within that. */
export const BAND = { f0: 0.15, centroid: 0.3 };

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const quantile = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

/** In-place radix-2 FFT (re, im of length 2^k). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export function analyse(pcm: Int16Array, rate: number = PRINT_RATE): VoicePrint {
  const x = Float64Array.from(pcm, (v) => v / 32768);
  const frame = Math.round(rate * 0.04), hop = Math.round(rate * 0.01), N = 1024;
  const minLag = Math.floor(rate / 320), maxLag = Math.ceil(rate / 65);
  const rms: number[] = [];
  for (let a = 0; a + frame <= x.length; a += hop) { let e = 0; for (let i = 0; i < frame; i++) e += x[a + i] * x[a + i]; rms.push(Math.sqrt(e / frame)); }
  const peak = Math.max(1e-9, ...rms), gate = Math.max(0.006, peak * 0.12);
  // Speech-level stretches: above the gate, gaps under 0.3 s joined, shorter than 0.12 s dropped.
  const bursts: Burst[] = [];
  let open: number | null = null;
  rms.forEach((v, i) => {
    const t = (i * hop) / rate;
    if (v >= gate) { if (open === null) open = t; }
    else if (open !== null) { const last = bursts[bursts.length - 1]; if (last && open - last.end < 0.3) last.end = t; else bursts.push({ start: open, end: t }); open = null; }
  });
  if (open !== null) { const t = x.length / rate, last = bursts[bursts.length - 1]; if (last && open - last.end < 0.3) last.end = t; else bursts.push({ start: open, end: t }); }
  const speech = bursts.filter((b) => b.end - b.start >= 0.12);
  const f0s: number[] = [], cents: number[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0, a = 0; a + frame <= x.length; a += hop, f++) {
    if (rms[f] < gate) continue;
    // Pitch: the lag at which the frame best matches itself (normalised autocorrelation).
    let best = 0, bestLag = 0, e0 = 0;
    for (let i = 0; i < frame; i++) e0 += x[a + i] * x[a + i];
    for (let lag = minLag; lag <= maxLag && lag < frame; lag++) {
      let s = 0, e1 = 0;
      for (let i = 0; i + lag < frame; i++) { s += x[a + i] * x[a + i + lag]; e1 += x[a + i + lag] * x[a + i + lag]; }
      const c = s / Math.sqrt(e0 * e1 + 1e-12);
      if (c > best + 0.015 || (c > best && lag < bestLag)) { best = c; bestLag = lag; }
    }
    if (best < 0.5 || !bestLag) continue;
    f0s.push(rate / bestLag);
    re.fill(0); im.fill(0);
    for (let i = 0; i < Math.min(N, frame); i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1)));
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * ((k * rate) / N); den += m; }
    if (den > 0) cents.push(num / den);
  }
  return { f0: Math.round(median(f0s) * 10) / 10, f0Low: Math.round(quantile(f0s, 0.25)), f0High: Math.round(quantile(f0s, 0.75)), centroid: Math.round(cents.reduce((s, v) => s + v, 0) / Math.max(1, cents.length)), voicedSec: Math.round(f0s.length) / 100, bursts: speech.map((b) => ({ start: Math.round(b.start * 100) / 100, end: Math.round(b.end * 100) / 100 })) };
}

/** How far a take is from the reference, as fractions; and whether it is inside the band. */
export function compare(p: Pick<VoicePrint, "f0" | "centroid">, ref: Pick<VoicePrint, "f0" | "centroid">, band = BAND): { f0Off: number; centroidOff: number; inBand: boolean; distance: number } {
  const f0Off = p.f0 / ref.f0 - 1, centroidOff = p.centroid / ref.centroid - 1;
  return { f0Off: Math.round(f0Off * 1000) / 1000, centroidOff: Math.round(centroidOff * 1000) / 1000, inBand: p.f0 > 0 && Math.abs(f0Off) <= band.f0 && Math.abs(centroidOff) <= band.centroid, distance: Math.round((Math.abs(f0Off) / band.f0 + Math.abs(centroidOff) / band.centroid) * 1000) / 1000 };
}
/** The playback-rate ratio that puts a take's pitch on the reference's (never more than a whole tone and a half: beyond that it sounds processed). */
export const pitchCorrection = (p: Pick<VoicePrint, "f0">, ref: Pick<VoicePrint, "f0">): number => (p.f0 > 0 ? Math.round(Math.max(0.84, Math.min(1.19, ref.f0 / p.f0)) * 1000) / 1000 : 1);

/** A file's audio as 16 kHz mono PCM (from `from` seconds, for `seconds`). */
export async function decode16k(file: string, from = 0, seconds?: number): Promise<Int16Array> {
  const tmp = `${file}.${process.pid}.s16`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-ss", String(from), ...(seconds ? ["-t", String(seconds)] : []), "-i", file, "-vn", "-ac", "1", "-ar", String(PRINT_RATE), "-f", "s16le", tmp], { nice: true });
  const fs = await import("fs"), b = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  return new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)).slice();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  (async () => { for (const f of process.argv.slice(2)) { const p = analyse(await decode16k(f)); console.log(`${path.basename(path.dirname(path.dirname(f)))}/${path.basename(f)}  f0 ${p.f0} Hz (middle half ${p.f0Low}–${p.f0High})  centroid ${p.centroid} Hz  voiced ${p.voicedSec} s  speech ${p.bursts.map((b) => `${b.start}–${b.end}`).join(", ")}`); } })().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
