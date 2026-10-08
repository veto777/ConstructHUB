/**
 * Package a finished file that is not a make.ts concept (a "Gator Reacts" episode, a replay edit, a trimmed cut) as a
 * clip the poster understands, and put it in the review queue as PENDING (ready-for-review). Nothing is posted.
 *
 *   npx tsx scripts/gator/package.ts <id> <file.mp4> --hook "…" [--line "…"] [--style N] [--clips "<channel>|<url>"]
 *
 * Writes analysis/gator-shorts/<id>/ {pure.mp4, cover.jpg, social.json} and docs/gator/queue.json state[<id>] =
 * ready-for-review, review: ["<id>.mp4"] (the name it has in the owner's review folder — upload it under that name).
 * It is NOT added to `order`: `daily.ts --approve <id>` does that once the owner has approved it.
 * `--clips`: the episode uses somebody else's footage (the owner's order, 2026-10-08) — the disclosure says so and the
 * caption's second line credits the channel. Never to YouTube: `platforms.youtube` is null.
 */
import fs from "fs";
import path from "path";
import { parseArgs, run, sha256 } from "../tutorials/lib";
import { OUT } from "./make";
import { readQueue, saveQueue } from "./queue";

async function main() {
  const args = parseArgs(process.argv.slice(2), []);
  const [id, src] = args._;
  const hook = typeof args.flags.hook === "string" ? args.flags.hook : "";
  if (!id || !src || !hook) throw new Error('usage: package.ts <id> <file.mp4> --hook "…" [--line "…"] [--style N] [--clips "<channel>|<url>"]');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`${id}: ids are lower-case words and dashes`);
  const dir = path.join(OUT, id), pure = path.join(dir, "pure.mp4");
  fs.mkdirSync(dir, { recursive: true });
  const data = fs.readFileSync(src);
  if (fs.existsSync(pure) && sha256(fs.readFileSync(pure)) !== sha256(data)) throw new Error(`${id}: ${pure} exists and is another file — never overwritten`);
  if (!fs.existsSync(pure)) fs.copyFileSync(src, pure);
  const pj = JSON.parse((await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", pure])).stdout);
  const v = pj.streams.find((s: any) => s.codec_type === "video"), sec = Math.round(Number(pj.format.duration) * 100) / 100;
  if (Number(v.width) !== 1080 || Number(v.height) !== 1920) throw new Error(`${id}: ${v.width}x${v.height} — clips are 1080x1920`);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-ss", "0.8", "-i", pure, "-frames:v", "1", "-q:v", "3", path.join(dir, "cover.jpg")], { nice: true });
  const clips = typeof args.flags.clips === "string" ? args.flags.clips.split("|").map((x) => x.trim()) : null;
  const line = typeof args.flags.line === "string" ? args.flags.line : clips ? `Clips: ${clips[0]} (YouTube).` : undefined;
  const note = clips ? `The gator's reactions are AI-generated (our mascot); the fail clips are not ours — from ${clips[0]}'s compilation ${clips[1] ?? ""}`.trim() : "AI-generated animation of our mascot.";
  const tags = ["contractorlife", "construction", "aicontent", "jobsite", "bluecollar"], head = [hook, line].filter(Boolean).join("\n");
  const sha = sha256(fs.readFileSync(pure)), bytes = fs.statSync(pure).size;
  const social = {
    conceptId: id, title: hook, stream: "viral", style: typeof args.flags.style === "string" ? Number(args.flags.style) : 17, look: "live", cut: "edit", evergreen: true, hook,
    clip: { file: "pure.mp4", width: 1080, height: 1920, fps: 30, durationSec: sec, bytes, sha256: sha, cover: "cover.jpg", coverMs: 800 },
    variants: { pure: { file: "pure.mp4", width: 1080, height: 1920, fps: 30, durationSec: sec, bytes, sha256: sha } },
    aiGenerated: true,
    disclosure: { tiktok: { isAiGenerated: true, isYourBrand: true, isBrandedContent: false }, instagram: "the caption says so (#aicontent); switch on “AI info” in the app after posting", linkedin: "the text says so", note, ...(clips ? { thirdParty: { channel: clips[0], source: clips[1] ?? null, ownerAcceptedRisk: "2026-10-08: “Do what I am asking you to do!”" } } : {}) },
    platforms: {
      instagram: { text: `${head}\n\nConstructHUB — run the whole job. Link in bio · constructhub.us\n\n${note}\n\n${tags.map((t) => `#${t}`).join(" ")}`, hashtags: tags },
      tiktok: { text: `${head} ${tags.map((t) => `#${t}`).join(" ")}`, hashtags: tags },
      linkedin: null, youtube: null,
    },
    speech: null, packagedFrom: path.basename(src), packagedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "social.json"), JSON.stringify(social, null, 2) + "\n");
  const q = readQueue();
  if (q.state[id] && q.state[id].status !== "ready-for-review") throw new Error(`${id} is already ${q.state[id].status} in the queue — left alone`);
  q.state[id] = { status: "ready-for-review", at: new Date().toISOString(), by: "made by the coordinator (account c) on 2026-10-08; waiting for the owner's review", caption: [hook, ...(line ? [line] : [])] as [string, string?], post: { tiktok: "pure.mp4", instagram: "pure.mp4" }, review: [`${id}.mp4`], why: "pending: in the owner's review folder since 2026-10-08, waiting for his review" };
  saveQueue(q);
  console.log(`  ${id}: ${sec} s packaged, pending in the queue (review name ${id}.mp4)`);
}
main().then(() => process.exit(0), (e) => { console.error(`✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
