/**
 * The YouTube thumbnail of a walkthrough — 1280×720 JPG, at most 2 MB, from the step script's
 * `thumbnail` block and the screenshot record.ts kept at that step (thumb-shot.png + thumb-shot.json).
 *
 *   tsx scripts/tutorials/thumbnail.ts docs/tutorials/scripts/<helpKey>.json [--out DIR] [--variant 0-3]
 *        [--shot file.png]      (a screenshot from somewhere else, e.g. for a video recorded before this tool)
 *
 * Writes thumbnail.jpg and thumbnail-320.png — the same picture at the size YouTube shows it in a
 * list. LOOK at the small one: the headline must still read. The look and the four layouts are in
 * brand.ts.
 */
import fs from "fs";
import path from "path";
import { flagNum, flagStr, loadScript, outDir, parseArgs, run } from "./lib";
import { renderStill, thumbVariant, thumbnailHtml } from "./brand";

export async function makeThumbnail(scriptFile: string, dir: string, opts: { variant?: number; shot?: string } = {}): Promise<{ file: string; bytes: number; variant: number }> {
  const { script } = loadScript(scriptFile);
  if (!script.thumbnail) throw new Error(`${script.helpKey}: the script has no "thumbnail" block (headline, step)`);
  const shot = path.resolve(opts.shot ?? path.join(dir, "thumb-shot.png"));
  if (!fs.existsSync(shot)) throw new Error(`${shot} is missing — record.ts writes it at thumbnail.step`);
  const meta = !opts.shot && fs.existsSync(path.join(dir, "thumb-shot.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "thumb-shot.json"), "utf8")) : null;
  const size = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", shot])).stdout.trim().split(",").map(Number);
  const zoom = meta?.zoom ?? 1;
  const ring = meta?.ring ? { x: meta.ring.x * zoom, y: meta.ring.y * zoom, width: meta.ring.width * zoom, height: meta.ring.height * zoom } : null;
  const variant = opts.variant ?? thumbVariant(script.helpKey);
  const out = path.join(dir, "thumbnail.jpg");
  await renderStill(thumbnailHtml({
    helpKey: script.helpKey, headline: script.thumbnail.headline, accent: script.thumbnail.accent, kicker: script.thumbnail.kicker,
    shot, shotSize: { width: size[0], height: size[1] }, ring, variant,
  }), out);
  const bytes = fs.statSync(out).size;
  if (bytes > 2_000_000) throw new Error(`thumbnail.jpg is ${bytes} bytes — YouTube takes 2 MB at most`);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "4", "-i", out, "-vf", "scale=320:180:flags=lanczos", "-update", "1", path.join(dir, "thumbnail-320.png")], { nice: true });
  return { file: out, bytes, variant };
}

async function main() {
  const args = parseArgs();
  if (!args._[0]) throw new Error("Usage: tsx scripts/tutorials/thumbnail.ts <script.json> [--out DIR] [--variant N] [--shot file.png]");
  const { script } = loadScript(args._[0]);
  const v = flagStr(args, "variant");
  const t = await makeThumbnail(args._[0], outDir(args, script.helpKey), { variant: v === undefined ? undefined : flagNum(args, "variant", 0), shot: flagStr(args, "shot") });
  console.log(`thumbnail.jpg  ${(t.bytes / 1000).toFixed(0)} kB  layout ${t.variant}  → ${t.file}  (look at thumbnail-320.png too)`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
