/**
 * THE INSTANT REPLAY — the owner's edit (2026-10-08): the fall plays once, then the impact is run again
 * four times, each a different way, with music. Made in the edit from ONE generated shot: it costs nothing.
 *
 *   npx tsx scripts/gator/replay.ts <conceptId> [--impact SEC] [--centre 0.5,0.6] [--tags] [--setup TRACK] [--drop TRACK] [--no-end-tag]
 *
 * From analysis/gator-shorts/<conceptId>/pure.mp4 (a one-shot clip, already 1080×1920 and levelled) it writes
 *   replay-music.mp4     the edit with our CC0 music (docs/gator/MUSIC-LICENCES.md): a sneaky bed under the
 *                        set-up, the drop on the first impact, a hit re-triggered on every replay
 *   replay-nomusic.mp4   the same edit with its effects but no music — for a trending in-app sound
 *
 * The edit:  the take up to just after the impact → REWIND (reversed, 3×, tape scrub) → replay at 60% with a
 * punch-in → again, tighter → again mirrored with a shake and a freeze on the frame of impact → last time at
 * 30% with a slow push-in and a bass drop → the rest of the take (he gets up / the thumbs-up) → 0.8 s end tag.
 * `--from SEC`: start the take later (a long walk-up is trimmed). `--impact`: the moment of impact in the take (default: its biggest burst of motion). `--tags`: REPLAY /
 * AGAIN. / ONE MORE TIME / LAST ONE over the replays. Every ffmpeg under the encode lock, niced, 4 threads.
 */
import fs from "fs";
import path from "path";
import { ROOT, decodeWav, encodeWav, parseArgs, run } from "../tutorials/lib";
import { renderStill } from "../tutorials/brand";
import { LOUDNESS, measureLoudness } from "../tutorials/mux";
import { endTagHtml } from "./brand";
import { FPS, H, W, assFile, layoutBeat, type Beat } from "./layout";
import { OUT, motionPeaks } from "./make";
import { track } from "./music";
import { RATE, synth, type Cue } from "./sound";

const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
const CODEC = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "19", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2), "-c:a", "aac", "-b:a", "160k", "-ar", String(RATE), "-ac", "2"];
export const PRE = 0.9, POST = 0.55, TAG_SEC = 0.8;
export type Piece = { name: string; srcFrom: number; srcTo: number; speed: number; reverse?: boolean; zoom?: [number, number]; mirror?: boolean; shake?: boolean; freeze?: number; tag?: string; outSec: number; outStart: number; impactAt: number | null };

/** The edit as a list of pieces on the output clock — pure, so its timing is tested. */
export function plan(durationSec: number, impact: number, endTag = TAG_SEC, from = 0): { pieces: Piece[]; bodySec: number; totalSec: number } {
  const T = Math.max(PRE, Math.min(durationSec - POST, impact)), a = T - PRE, b = T + POST, raw: Omit<Piece, "outStart" | "outSec" | "impactAt">[] = [
    { name: "take", srcFrom: Math.max(0, Math.min(from, a)), srcTo: b, speed: 1 },
    { name: "rewind", srcFrom: a, srcTo: b, speed: 3, reverse: true },
    { name: "replay-1", srcFrom: a, srcTo: b, speed: 0.6, zoom: [1.25, 1.25], tag: "REPLAY" },
    { name: "replay-2", srcFrom: a, srcTo: b, speed: 0.6, zoom: [1.6, 1.6], tag: "AGAIN." },
    { name: "replay-3", srcFrom: a, srcTo: T + 0.04, speed: 0.8, zoom: [1.35, 1.35], mirror: true, shake: true, freeze: 0.5, tag: "ONE MORE TIME" },
    { name: "replay-4", srcFrom: a + 0.45, srcTo: T + 0.4, speed: 0.33, zoom: [1.2, 1.55], tag: "LAST ONE" },
    ...(durationSec - b > 0.15 ? [{ name: "after", srcFrom: b, srcTo: durationSec, speed: 1 }] : []),
  ];
  let t = 0;
  const pieces = raw.map((p) => {
    const outSec = Math.round((((p.srcTo - p.srcFrom) / p.speed) + (p.freeze ?? 0)) * FPS) / FPS, impactIn = T >= p.srcFrom && T <= p.srcTo + 1e-6 && !p.reverse ? (T - p.srcFrom) / p.speed : null;
    const piece: Piece = { ...p, outSec, outStart: t, impactAt: impactIn === null ? null : t + impactIn };
    t += outSec;
    return piece;
  });
  return { pieces, bodySec: t, totalSec: t + endTag };
}

async function pcmOf(file: string, from = 0, seconds?: number): Promise<Float32Array> {
  const tmp = `${file}.${process.pid}.${Math.round(from * 1000)}.wav`;
  await run("ffmpeg", [...FF, "-ss", String(from), ...(seconds ? ["-t", String(seconds)] : []), "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", tmp], { nice: true });
  const p = decodeWav(fs.readFileSync(tmp)); fs.rmSync(tmp, { force: true });
  return Float32Array.from(p.samples, (v) => v / 32768);
}
/** Where a track "drops": the start of its loudest half-second after the first two seconds. */
function dropOf(x: Float32Array): number {
  const win = RATE / 2; let best = 0, at = 0;
  for (let a = 2 * RATE; a + win < Math.min(x.length, 90 * RATE); a += RATE / 10) { let e = 0; for (let i = 0; i < win; i += 8) e += x[a + i] * x[a + i]; if (e > best * 1.15) { best = e; at = a; } }
  return at / RATE;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["tags", "no-end-tag"]);
  const id = args._[0];
  if (!id) throw new Error("Usage: npx tsx scripts/gator/replay.ts <conceptId> [--impact SEC] [--centre x,y] [--tags] [--setup TRACK] [--drop TRACK]");
  const dir = path.join(OUT, id), src = path.join(dir, "pure.mp4"), work = path.join(dir, "_replay");
  if (!fs.existsSync(src)) throw new Error(`${src} is missing — this edit is made from a one-shot clip (make.ts ${id} --assemble)`);
  fs.mkdirSync(work, { recursive: true });
  const w = (f: string) => path.join(work, f);
  const dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src])).stdout.trim());
  const peaks = await motionPeaks(src, 0, dur);
  const impact = typeof args.flags.impact === "string" ? Number(args.flags.impact) : (peaks.slice().sort((a, b) => b.strength - a.strength)[0]?.at ?? dur * 0.6);
  const [cx, cy] = (typeof args.flags.centre === "string" ? args.flags.centre : "0.5,0.6").split(",").map(Number);
  const endTag = args.flags["no-end-tag"] ? 0 : TAG_SEC, ed = plan(dur, impact, endTag, typeof args.flags.from === "string" ? Number(args.flags.from) : 0);
  console.log(`${id}: impact at ${impact.toFixed(2)} s of ${dur.toFixed(2)} s${typeof args.flags.impact === "string" ? "" : " (found: the biggest burst of motion)"} → ${ed.totalSec.toFixed(2)} s edit`);

  // ── Picture: every piece cut from the one take ────────────────────────────────────────────────
  const graph: string[] = [`[0:v]fps=${FPS},split=${ed.pieces.length}${ed.pieces.map((_p, i) => `[i${i}]`).join("")}`];
  ed.pieces.forEach((p, i) => {
    const f: string[] = [`trim=start=${p.srcFrom.toFixed(3)}:end=${p.srcTo.toFixed(3)}`, "setpts=PTS-STARTPTS"];
    if (p.reverse) f.push("reverse");
    if (p.speed !== 1) f.push(`setpts=PTS/${p.speed}`, `fps=${FPS}`);
    if (p.mirror) f.push("hflip");
    if (p.zoom) {
      const [z0, z1] = p.zoom, d = (p.srcTo - p.srcFrom) / p.speed, z = z0 === z1 ? String(z0) : `(${z0}+${(z1 - z0).toFixed(3)}*min(t/${d.toFixed(3)},1))`, mx = p.mirror ? 1 - cx : cx;
      const jx = p.shake ? `+14*sin(2*PI*17*t)` : "", jy = p.shake ? `+10*sin(2*PI*23*t)` : "";
      f.push(`scale=w='2*trunc(${W}*${z}/2)':h='2*trunc(${H}*${z}/2)':eval=frame:flags=bicubic`, `crop=${W}:${H}:x='max(0,min(iw-${W},iw*${mx}-${W / 2}${jx}))':y='max(0,min(ih-${H},ih*${cy}-${H / 2}${jy}))'`);
    }
    if (p.freeze) f.push(`tpad=stop_mode=clone:stop_duration=${p.freeze}`);
    f.push(`trim=end_frame=${Math.round(p.outSec * FPS)}`, "setpts=PTS-STARTPTS", "setsar=1", "format=yuv420p");
    graph.push(`[i${i}]${f.join(",")}[p${i}]`);
  });
  graph.push(`${ed.pieces.map((_p, i) => `[p${i}]`).join("")}concat=n=${ed.pieces.length}:v=1:a=0[body]`);
  const tags: Beat[] = args.flags.tags ? ed.pieces.filter((p) => p.tag).map((p) => ({ at: p.outStart, until: p.outStart + p.outSec, text: p.tag!, accent: p.tag!.split(" ").pop(), pos: "top" as const })) : [];
  fs.writeFileSync(w("tags.ass"), assFile(tags.map(layoutBeat)));
  fs.copyFileSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"), w("Anton-Regular.ttf"));
  graph.push(`[body]${tags.length ? "ass=tags.ass:fontsdir=." : "null"}[cap]`);
  if (endTag) {
    await renderStill(endTagHtml(), w("end.png"), W, { size: { width: W, height: H } });
    graph.push(`[1:v]fps=${FPS},scale=${W}:${H},setsar=1,format=yuv420p,trim=end_frame=${Math.round(endTag * FPS)},setpts=PTS-STARTPTS[end]`, `[cap][end]concat=n=2:v=1:a=0,format=yuv420p[v]`);
  } else graph.push(`[cap]format=yuv420p[v]`);

  // ── Sound: the take's own for the take and the aftermath; made here for the rewind and the replays ──
  const n = Math.ceil(ed.totalSec * RATE), own = new Float32Array(n), take = await pcmOf(src);
  for (const p of ed.pieces) if (p.speed === 1 && !p.reverse) { const a = Math.round(p.srcFrom * RATE), o = Math.round(p.outStart * RATE); for (let i = 0; i < Math.round(p.outSec * RATE) && a + i < take.length && o + i < n; i++) own[o + i] = take[a + i]; }
  const cues: Cue[] = [];
  for (const p of ed.pieces) {
    if (p.reverse) cues.push({ type: "rewind", at: p.outStart, dur: p.outSec, gain: 0.9 });
    if (p.name.startsWith("replay")) { cues.push({ type: "whoosh", at: Math.max(0, p.outStart - 0.05), dur: 0.25, gain: 0.5 }); if (p.impactAt !== null) cues.push({ type: "hit", at: p.impactAt, gain: p.name === "replay-4" ? 1.2 : 1 }); }
    if (p.name === "replay-4" && p.impactAt !== null) cues.push({ type: "bass", at: p.impactAt, dur: 1.2 });
    if (p.freeze && p.impactAt !== null) cues.push({ type: "ding", at: p.impactAt + 0.05, gain: 0.5 });
  }
  if (endTag) cues.push({ type: "ding", at: ed.bodySec + 0.08, gain: 0.5 });
  const fx = synth(cues, ed.totalSec), first = ed.pieces[0].impactAt ?? impact;
  const setup = await track(typeof args.flags.setup === "string" ? args.flags.setup : "sneaking-around"), drop = await track(typeof args.flags.drop === "string" ? args.flags.drop : "ring-master");
  const sx = await pcmOf(setup, 0, first + 1), dAll = await pcmOf(drop, 0, 100), d0 = dropOf(dAll);
  const peak = (a: Float32Array) => { let m = 1e-9; for (let i = 0; i < a.length; i += 4) m = Math.max(m, Math.abs(a[i])); return m; };
  const ps = peak(sx), pd = peak(dAll), po = peak(own), pf = peak(fx);
  const mixes: Record<string, Float32Array> = { music: new Float32Array(n), nomusic: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const t = i / RATE, base = (own[i] / po) * 0.62 + (fx[i] / pf) * 0.55;
    // The sneaky bed under the set-up, out as the impact lands; then the drop, from the impact to the end.
    const su = t < first ? (sx[i] ?? 0) / ps * 0.22 * Math.min(1, t / 0.4, (first - t) / 0.12) : 0;
    const k = Math.round((d0 + (t - first)) * RATE), dr = t >= first && k < dAll.length ? (dAll[k] / pd) * 0.34 * Math.min(1, (ed.totalSec - t) / 0.5) : 0;
    mixes.nomusic[i] = base; mixes.music[i] = base + su + dr;
  }
  const still = (f: string, sec: number) => ["-loop", "1", "-framerate", String(FPS), "-t", sec.toFixed(3), "-i", f];
  for (const [name, mix] of Object.entries(mixes)) {
    const pm = peak(mix), pcm = Int16Array.from(mix, (v) => Math.round(Math.max(-1, Math.min(1, (v / pm) * 0.89)) * 32767));
    fs.writeFileSync(w(`${name}.wav`), encodeWav({ sampleRate: RATE, samples: pcm }));
    // Peaks tamed first: an edit that is quiet between hits cannot reach −14 LUFS under the peak limit otherwise.
    const tame = "acompressor=threshold=-24dB:ratio=4:attack=3:release=140:makeup=6,alimiter=limit=0.84:level=false", target = `${tame},loudnorm=I=${LOUDNESS.I}:TP=-1.5:LRA=${LOUDNESS.LRA}`;
    const pass1 = (await run("ffmpeg", ["-hide_banner", "-nostats", "-threads", "4", "-i", w(`${name}.wav`), "-af", `${target}:print_format=json`, "-f", "null", "-"], { nice: true })).stderr;
    const lm = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1)) as Record<string, string>;
    const audio = `[${endTag ? 2 : 1}:a]${target}:measured_I=${lm.input_i}:measured_TP=${lm.input_tp}:measured_LRA=${lm.input_lra}:measured_thresh=${lm.input_thresh}:offset=${lm.target_offset}:linear=true,apad=whole_dur=${ed.totalSec.toFixed(3)},aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a]`;
    fs.writeFileSync(w(`${name}.graph`), `${graph.join(";\n")};\n${audio}`);
    const out = path.join(dir, `replay-${name}${args.flags.tags ? "-tags" : ""}.mp4`);
    await run("ffmpeg", [...FF, "-i", src, ...(endTag ? still("end.png", endTag + 1) : []), "-i", `${name}.wav`, "-filter_complex_threads", "4", "-filter_complex_script", `${name}.graph`, "-map", "[v]", "-map", "[a]", ...CODEC, "-t", ed.totalSec.toFixed(3), "-movflags", "+faststart", out], { nice: true, cwd: work });
    const loud = await measureLoudness(out), d = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out])).stdout.trim());
    if (Math.abs(d - ed.totalSec) > 0.2 || Math.abs(loud.lufs - LOUDNESS.I) > 2.5) throw new Error(`${out}: ${d.toFixed(2)} s, ${loud.lufs} LUFS`);
    console.log(`  ${path.relative(OUT, out)}  ${d.toFixed(2)} s  ${loud.lufs} LUFS, true peak ${loud.truePeakDb} dBTP`);
  }
  await run("ffmpeg", [...FF, "-i", path.join(dir, `replay-music${args.flags.tags ? "-tags" : ""}.mp4`), "-vf", `fps=${(18 / ed.totalSec).toFixed(4)},scale=240:426,tile=9x2`, "-frames:v", "1", "-q:v", "3", "-update", "1", path.join(dir, "replay-review.jpg")], { nice: true });
  fs.writeFileSync(path.join(dir, "replay.json"), JSON.stringify({ conceptId: id, impactSec: impact, pieces: ed.pieces, totalSec: ed.totalSec, music: { setup: path.basename(setup), drop: path.basename(drop), dropAtSec: d0, licence: "CC0 1.0 — docs/gator/MUSIC-LICENCES.md" } }, null, 2) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
