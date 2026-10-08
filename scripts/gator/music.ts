/**
 * The music beds of the gator clips — every one CC0 (public-domain dedication), fetched from the page that
 * says so (docs/gator/MUSIC-LICENCES.md has each track's page, licence and checksum). Never chart music,
 * a meme song, or audio lifted from somebody's clip.
 *
 *   npx tsx scripts/gator/music.ts          download what is missing into analysis/gator-shorts/_music/, verify, list
 *
 * Files are kept out of git (analysis/ is ignored): this script and the licence document are the record.
 * A file whose checksum is not the one recorded here is refused — a changed file is a different work.
 */
import fs from "fs";
import path from "path";
import { ROOT, run, sha256 } from "../tutorials/lib";

export const MUSIC_DIR = process.env.GATOR_MUSIC_DIR || path.join(ROOT, "analysis", "gator-shorts", "_music");
export type Track = { id: string; title: string; author: string; page: string; url: string; licence: "CC0 1.0"; use: "setup" | "drop" | "goofy"; sha256: string | null };
const OGA = "https://opengameart.org";
export const TRACKS: Track[] = [
  { id: "sneaking-around", title: "Sneaking Around", author: "Umplix", page: `${OGA}/content/sneaking-around`, url: `${OGA}/sites/default/files/sneaking_around_.wav`, licence: "CC0 1.0", use: "setup", sha256: null },
  { id: "robot-factory", title: "Sneaky Music Pack — Sneaking into the Robot Factory", author: "Umplix", page: `${OGA}/content/sneaky-music-pack`, url: `${OGA}/sites/default/files/sneaking_into_the_robot_factory.wav`, licence: "CC0 1.0", use: "setup", sha256: null },
  { id: "dodging-lights", title: "Sneaky Music Pack — Dodging Lights", author: "Umplix", page: `${OGA}/content/sneaky-music-pack`, url: `${OGA}/sites/default/files/dodging_lights.wav`, licence: "CC0 1.0", use: "setup", sha256: null },
  { id: "the-drop", title: "The Drop Soundtrack", author: "Vivis", page: `${OGA}/content/the-drop-soundtrack`, url: `${OGA}/sites/default/files/TheDropSong.wav`, licence: "CC0 1.0", use: "drop", sha256: null },
  { id: "ring-master", title: "ring master (battle — ring master black)", author: "Bobjt", page: `${OGA}/content/ring-master`, url: `${OGA}/sites/default/files/battle%20-%20ring%20master%20black.mp3`, licence: "CC0 1.0", use: "drop", sha256: null },
  { id: "rolling-circus", title: "Rolling Circus", author: "cinameng", page: `${OGA}/content/rolling-circus`, url: `${OGA}/sites/default/files/rollingcircus.wav`, licence: "CC0 1.0", use: "goofy", sha256: null },
  { id: "childrens-march", title: "Children's March Theme", author: "CleytonKauffman", page: `${OGA}/content/childrens-march-theme`, url: `${OGA}/sites/default/files/Children%27s%20March%20Theme.mp3`, licence: "CC0 1.0", use: "goofy", sha256: null },
  { id: "not-clumsy", title: "8-bit — I am not clumsy!", author: "HydroGene", page: `${OGA}/content/8-bit-i-am-not-clumsy`, url: `${OGA}/sites/default/files/14._i_am_not_clumsy_0.mp3`, licence: "CC0 1.0", use: "goofy", sha256: null },
];
export const trackFile = (t: Track) => path.join(MUSIC_DIR, `${t.id}${path.extname(decodeURIComponent(t.url))}`);
const SUMS = path.join(ROOT, "docs", "gator", "music-checksums.json");
const sums = (): Record<string, string> => (fs.existsSync(SUMS) ? JSON.parse(fs.readFileSync(SUMS, "utf8")) : {});

/** A track ready to use: downloaded (once), and the very file whose checksum was recorded. */
export async function track(id: string): Promise<string> {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`${id} is not a licensed track (${TRACKS.map((x) => x.id).join(", ")})`);
  const file = trackFile(t), known = sums();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    const res = await fetch(t.url, { headers: { "User-Agent": "Mozilla/5.0 (ConstructHUB gator shorts; music fetch)" }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${t.url} answered ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const sum = sha256(fs.readFileSync(file));
  if (known[id] && known[id] !== sum) throw new Error(`${file} is not the file whose licence was checked (checksum differs) — delete it and look at ${t.page} again`);
  if (!known[id]) { known[id] = sum; fs.writeFileSync(SUMS, JSON.stringify(known, null, 2) + "\n"); }
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  (async () => {
    for (const t of TRACKS) {
      const f = await track(t.id);
      const d = (await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout.trim();
      console.log(`${t.id.padEnd(16)} ${t.use.padEnd(6)} ${Number(d).toFixed(1).padStart(6)} s  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB  ${sums()[t.id].slice(0, 12)}  ${t.title} — ${t.author} (${t.licence})`);
    }
  })().then(() => process.exit(0), (e) => { console.error(`✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
}
