/**
 * MUSIC BED — a quiet track under the narration of every walkthrough (owner, 2026-10-14: "all the
 * tutorial videos would sound better with music, make it 10% — quiet enough so you can hear the
 * voiceover no issues … use the same music I shared for the ad videos … a variation of these, just
 * nothing too jumpy").
 *
 *   tsx scripts/tutorials/music.ts --all [--only k,k,…] [--upload] [--force]
 *   tsx scripts/tutorials/music.ts <helpKey> [--upload] [--force]
 *
 * The beds are four of the seven tracks the owner shared for the Meta ads (the calm ones; the drums,
 * the upbeat and the travel cuts stay out), kept in assets/music/ at 160 kbps AAC. A tool group always
 * gets the same bed (`bedFor`), so one tool's videos sound alike and the library still varies.
 *
 * Level: the bed is loudness-normalised and then dropped MUSIC_GAIN_DB (20 dB ≈ 10 %) under the
 * narration, which mux.ts puts at −14 LUFS — so the mix measures what the voice alone measured. It
 * fades in over the title card and out over the end card, and loops when a video outlasts it.
 *
 * Two ways in:
 *   · a fresh video: mux.ts adds the bed while it encodes (see `bedFilter` — `--no-music` leaves it out);
 *   · an existing master (this script): the current walkthrough.mp4 (+ captions + poster) is fetched
 *     from the live media route into analysis/music-out/<helpKey>/, checked against the manifest's
 *     sha256, and re-muxed with the bed — the picture is COPIED, only the sound is encoded; captions
 *     and poster are unchanged and keep their keys. `--upload` hands the folder to upload.ts (the same
 *     create-only upload, new hashed video name) which writes the manifest into this checkout.
 *
 * Idempotent: a master this script produced is listed in analysis/music-out/report.json; a manifest
 * whose video is one of those is skipped (`--force` does it again — on the ORIGINAL, never twice).
 */
import fs from "fs";
import path from "path";
import { ROOT, flagStr, parseArgs, run, sha256 } from "./lib";
import { TUTORIAL_PREFIX, type VideoManifestEntry } from "../../shared/help/videos";

export const MUSIC_DIR = path.join(import.meta.dirname, "assets", "music");
/** 20 dB under the voice is ~10 % of its level — the owner's "10%". */
export const MUSIC_GAIN_DB = -20;
/** Where each bed is cut in: the same bars the ads cue on (ads2.html), past each track's intro. */
export const BEDS = [
  { file: "business-technology.m4a", start: 17.6 },
  { file: "educational.m4a", start: 34.0 },
  { file: "hi-tech-ambient.m4a", start: 30.0 },
  { file: "hi-tech-presentation.m4a", start: 16.4 },
] as const;
export type Bed = (typeof BEDS)[number];

/** The tool a helpKey belongs to: "crm-*" → crm, "intro-*" → intro, else the part before the first dot. */
export function toolGroup(helpKey: string): string {
  const root = helpKey.split(".")[0];
  for (const p of ["crm", "intro", "brand"]) if (root === p || root.startsWith(`${p}-`)) return p;
  return root;
}
/**
 * Which bed a tool group gets. The CRM (most of the library) has the track the owner liked best; the
 * "Start here" intros the educational one; the Google Business tools one hi-tech cut, the ads, click,
 * brand and data tools the other. A group not listed here is hashed onto a bed, so it is still stable.
 */
const BED_OF_GROUP: Record<string, number> = {
  crm: 0,
  intro: 1,
  "posts-photos": 2, locations: 2, "google-profile": 2, reviews: 2,
  "ads-manager": 3, "click-guard": 3, brand: 3, "database-directory": 3, jobcam: 3,
};
/** One bed per tool group, stable across runs. */
export function bedFor(helpKey: string): Bed {
  const g = toolGroup(helpKey);
  if (g in BED_OF_GROUP) return BEDS[BED_OF_GROUP[g]];
  let h = 0;
  for (const ch of g) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BEDS[h % BEDS.length];
}
export const bedPath = (bed: Bed) => path.join(MUSIC_DIR, bed.file);

/** ffmpeg input args for the bed (looped, cut in at its bar) — add AFTER the other inputs. */
export function bedInputs(bed: Bed): string[] {
  return ["-ss", String(bed.start), "-stream_loop", "-1", "-i", bedPath(bed)];
}
/**
 * The bed's filter: normalised, dropped to MUSIC_GAIN_DB, trimmed to the video, faded in over the
 * title card and out over the end card. `index` is the bed's input index; the result is `[bed]`.
 */
export function bedFilter(index: number, totalS: number, fadeInS = 1.0, fadeOutS = 2.0): string {
  const out = Math.max(0, totalS - fadeOutS).toFixed(3);
  return `[${index}:a]loudnorm=I=-14:TP=-1.5:LRA=7,volume=${MUSIC_GAIN_DB}dB,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,`
    + `atrim=0:${totalS.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeInS},afade=t=out:st=${out}:d=${fadeOutS}[bed]`;
}
/** Voice + bed, the voice untouched (no re-normalisation: it is already at −14 LUFS). */
export const mixFilter = (voice: string, result = "a") => `[${voice}][bed]amix=inputs=2:duration=first:normalize=0[${result}]`;

const FF = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4"];
const MEDIA_BASE = process.env.TUTORIAL_MEDIA_BASE || "https://constructhub.us/api/tutorials/media/";
const OUT_ROOT = path.join(ROOT, "analysis", "music-out");
const REPORT = path.join(OUT_ROOT, "report.json");
const manifestPath = (helpKey: string) => path.join(ROOT, "shared/help/videos", `${helpKey}.json`);

type Report = Record<string, { from: string; to: string; bed: string; at: string; uploaded?: boolean }>;
const readReport = (): Report => (fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")) : {});
function record(helpKey: string, entry: Report[string]): void {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const r = readReport(); r[helpKey] = entry;
  fs.writeFileSync(REPORT, JSON.stringify(r, null, 2) + "\n");
}

async function fetchTo(key: string, file: string, want: { bytes: number; sha256: string }): Promise<void> {
  if (fs.existsSync(file)) { const d = fs.readFileSync(file); if (d.length === want.bytes && sha256(d) === want.sha256) return; }
  const res = await fetch(MEDIA_BASE + key.slice(TUTORIAL_PREFIX.length));
  if (!res.ok) throw new Error(`${key}: ${res.status} from the media route`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== want.bytes || sha256(data) !== want.sha256) throw new Error(`${key}: the media route served a file the manifest does not describe`);
  fs.writeFileSync(file, data);
}

const durationOf = async (file: string): Promise<number> =>
  Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).stdout.trim());

/** One existing master → analysis/music-out/<helpKey>/ with the bed under it; the folder upload.ts takes. */
export async function addMusic(helpKey: string, o: { upload?: boolean; force?: boolean }): Promise<string> {
  const m = JSON.parse(fs.readFileSync(manifestPath(helpKey), "utf8")) as VideoManifestEntry;
  const done = readReport()[helpKey];
  if (done && !o.force && (done.to === m.video.sha256 || done.from === m.video.sha256)) {
    if (done.to === m.video.sha256) return `${helpKey}: already has the bed (${done.bed})`;
    if (!o.upload || done.uploaded) return `${helpKey}: bed added earlier, not uploaded — run with --upload`;
  }
  if (done && done.to === m.video.sha256 && o.force) throw new Error(`${helpKey}: the current master already carries the bed; --force would stack a second one`);
  const dir = path.join(OUT_ROOT, helpKey), at = (f: string) => path.join(dir, f);
  fs.mkdirSync(dir, { recursive: true });
  await fetchTo(m.video.key, at("master.mp4"), m.video);
  await fetchTo(m.captions.key, at("captions.vtt"), m.captions);
  await fetchTo(m.poster.key, at("poster.jpg"), m.poster);
  const bed = bedFor(helpKey), totalS = await durationOf(at("master.mp4"));
  // `nice: true` runs it under the machine-wide encode lock (one ffmpeg at a time on this box).
  await run("ffmpeg", [
    ...FF, "-i", at("master.mp4"), ...bedInputs(bed),
    "-filter_complex", `${bedFilter(1, totalS)};${mixFilter("0:a")}`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", at("walkthrough.mp4"),
  ], { nice: true });
  const video = fs.readFileSync(at("walkthrough.mp4")), hash = sha256(video);
  // ebur128 prints running values ("I: -70.0 LUFS") before its summary: the LAST "I:" is the integrated loudness.
  const loud = [...(await run("ffmpeg", ["-hide_banner", "-i", at("walkthrough.mp4"), "-af", "ebur128", "-f", "null", "-"])).stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const lufs = loud ? Number(loud[1]) : NaN;
  if (!(lufs < -12 && lufs > -17)) throw new Error(`${helpKey}: the mix measures ${lufs} LUFS — the voice should still be about −14`);
  const part = (file: string, key: string) => { const d = fs.readFileSync(at(file)); return { file, key, bytes: d.length, sha256: sha256(d) }; };
  fs.writeFileSync(at("video.json"), JSON.stringify({
    helpKey, durationSec: m.durationSec, music: { bed: bed.file, start: bed.start, gainDb: MUSIC_GAIN_DB, from: m.video.sha256 }, loudness: { lufs },
    files: { video: { file: "walkthrough.mp4", key: `${TUTORIAL_PREFIX}${helpKey}.${hash.slice(0, 8)}.mp4`, bytes: video.length, sha256: hash },
      captions: part("captions.vtt", m.captions.key), poster: part("poster.jpg", m.poster.key) },
  }, null, 2) + "\n");
  record(helpKey, { from: m.video.sha256, to: hash, bed: bed.file, at: new Date().toISOString(), uploaded: false });
  let note = `${helpKey}: ${bed.file} under ${totalS.toFixed(0)} s · ${lufs} LUFS`;
  if (o.upload) {
    await run("npx", ["tsx", path.join(import.meta.dirname, "upload.ts"), helpKey, "--out", dir], { cwd: ROOT });
    record(helpKey, { from: m.video.sha256, to: hash, bed: bed.file, at: new Date().toISOString(), uploaded: true });
    note += " · uploaded, manifest written";
  }
  return note;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["all", "upload", "force"]);
  const upload = args.flags.upload === true, force = args.flags.force === true;
  const only = flagStr(args, "only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const keys = args.flags.all === true
    ? fs.readdirSync(path.join(ROOT, "shared/help/videos")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((k) => !only || only.includes(k)).sort()
    : args._[0] ? [String(args._[0])] : [];
  if (!keys.length) throw new Error("Usage: tsx scripts/tutorials/music.ts <helpKey> [--upload] [--force]\n       tsx scripts/tutorials/music.ts --all [--only k,k] [--upload] [--force]");
  for (const bed of BEDS) if (!fs.existsSync(bedPath(bed))) throw new Error(`missing bed ${bedPath(bed)}`);
  let failed = 0;
  for (const [i, k] of keys.entries()) {
    try { console.log(`[${i + 1}/${keys.length}] ${await addMusic(k, { upload, force })}`); }
    catch (e: any) { failed++; console.error(`[${i + 1}/${keys.length}] ✗ ${k}: ${e?.message ?? e}`); }
  }
  console.log(`\n${keys.length} video(s), ${failed} failed · report ${REPORT}`);
  if (failed) process.exit(1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
