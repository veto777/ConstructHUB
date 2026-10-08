/**
 * The gator shorts in the social calendar — DRY RUN ONLY. Reached as
 *
 *   npx tsx scripts/tutorials/social-post.ts --stream viral [conceptId…] [--platform a,b] [--ledger FILE] [--now ISO]
 *
 * It prints, for every finished clip (analysis/gator-shorts/<conceptId>/social.json) and every account,
 * when it would go out under the viral cadence (stream.ts), the whole caption, the Blotato request with
 * its AI-generated disclosure, and — for YouTube Shorts — the videos.insert request our own YouTube
 * client would open (`#Shorts` title, `status.containsSyntheticMedia: true`). Nothing is uploaded,
 * created or written: `--go` is refused until the owner has looked at the clips and said so.
 * No network at all: the accounts are the ones the tutorial ledger already posts to.
 */
import fs from "fs";
import path from "path";
import { ROOT, parseArgs } from "../tutorials/lib";
import { DENYLIST, buildPost, emptyLedger, followYouTube, type SocialLedger, type Target } from "../tutorials/social-post-lib";
import type { SocialPlatform } from "../tutorials/social-text";
import { uploadSessionRequest } from "../../server/youtube/client";
import { easternLabel } from "../../server/youtube/schedule";
import { OUT } from "./make";
import { emptyViralLedger, planViral, type ViralClip, type ViralLedger, type ViralPlatform, type ViralTarget } from "./stream";

export const VIRAL_LEDGER = path.join(ROOT, "docs", "gator", "viral-schedule.json");
const TUTORIAL_LEDGER = path.join(ROOT, "docs", "tutorials", "social-schedule.json");
const YT_LEDGER = path.join(ROOT, "docs", "tutorials", "youtube-schedule.json");
/** Where a clip's file will be served from once it is uploaded (the tutorials' media route). Not uploaded by this tool. */
export const plannedMediaUrl = (conceptId: string, sha: string, what: "clip" | "cover") => `https://constructhub.us/api/tutorials/media/gator-${conceptId}.social-${what === "clip" ? "vertical" : "cover-vertical"}.${sha.slice(0, 8)}.${what === "clip" ? "mp4" : "jpg"}`;
const readJson = <T>(file: string, fallback: T): T => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as T : fallback);

export async function viralMain(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["go", "brief"]);
  const say = (s: string) => console.log(s);
  if (args.flags.go) { console.error("\n✗ --stream viral is a dry run only: the gator shorts are not posted until the owner has approved the clips (and the upload + send path is switched on on purpose)."); return 1; }
  const now = typeof args.flags.now === "string" ? new Date(args.flags.now) : new Date();
  const tutorial = readJson<SocialLedger>(TUTORIAL_LEDGER, emptyLedger());
  const viral = readJson<ViralLedger>(typeof args.flags.ledger === "string" ? path.resolve(args.flags.ledger) : VIRAL_LEDGER, emptyViralLedger());
  const yt = readJson<{ videos: { helpKey: string; status: string; publishAt: string }[] }>(YT_LEDGER, { videos: [] }).videos.filter((v) => v.status === "published" || v.status === "scheduled");

  // The accounts: the ones the tutorial stream already posts to (each was checked against the allowlist when it was first used) + our YouTube channel.
  const seen = new Map<string, ViralTarget>();
  for (const p of tutorial.posts) if (!DENYLIST[p.accountId] && (p.platform === "instagram" || p.platform === "tiktok" || p.platform === "linkedin")) seen.set(p.accountId, { id: p.accountId, platform: p.platform, name: p.account });
  const only = typeof args.flags.platform === "string" ? args.flags.platform.split(",") : null;
  const targets = [...seen.values(), { id: "youtube", platform: "youtube" as ViralPlatform, name: "our YouTube channel (YouTube's own API, never Blotato)" }].filter((t) => !only || only.includes(t.platform));

  const ids = args._.length ? args._ : (fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((d) => fs.existsSync(path.join(OUT, d, "social.json"))).sort() : []);
  const socials = new Map<string, any>(), clips: ViralClip[] = [];
  for (const id of ids) {
    const f = path.join(OUT, id, "social.json");
    if (!fs.existsSync(f)) { say(`  – ${id}: no finished clip (run scripts/gator/make.ts ${id})`); continue; }
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    if (s.aiGenerated !== true) { say(`  – ${id}: its social.json does not carry the AI-generated flag — refused`); continue; }
    socials.set(id, s);
    clips.push({ conceptId: id, platforms: Object.fromEntries((["instagram", "tiktok", "linkedin", "youtube"] as const).flatMap((p) => (s.platforms?.[p] ? [[p, { text: s.platforms[p].text, title: s.platforms[p].title }]] : []))) });
  }
  // Tutorial cuts that will exist by then: every scheduled video's post on each account, at the time the tutorial poster gives it.
  const alsoTutorial = yt.flatMap((v) => [...seen.values()].filter((t) => !tutorial.posts.some((p) => p.helpKey === v.helpKey && p.accountId === t.id)).map((t) => ({ accountId: t.id, at: followYouTube(v.publishAt, t.platform as SocialPlatform, v.helpKey, t.id) })));
  const { planned, skipped } = planViral(clips, targets, { now, viral, tutorial, youtubeTimes: yt.map((v) => v.publishAt), alsoTutorial });

  say(`DRY RUN — the viral stream (gator shorts). Nothing is uploaded, sent or written.   (now ${easternLabel(now)})`);
  say(`${planned.length} post(s): ${clips.length} clip(s) × ${targets.length} account(s)`);
  for (const s of skipped) say(`  – ${s.conceptId} → ${s.accountId}: ${s.reason}`);
  for (const p of planned) {
    const s = socials.get(p.conceptId), media = plannedMediaUrl(p.conceptId, s.clip.sha256, "clip");
    say(`\n── ${p.conceptId} → ${p.target.platform} ${p.target.name} (${p.target.id}) ──────────────`);
    say(`  when:   ${p.eastern}  [the ${p.slot} Eastern slot]`);
    say(`  file:   ${path.join(OUT, p.conceptId, s.clip.file)}  (${s.clip.durationSec} s; would be served as ${media})`);
    if (p.target.platform === "youtube") {
      const req = uploadSessionRequest({ title: p.title!, description: p.text, tags: s.platforms.youtube.hashtags, categoryId: "24", publishAt: p.at.toISOString(), containsSyntheticMedia: true }, s.clip.bytes, now.getTime());
      say(`  videos.insert: ${JSON.stringify(req.body)}`);
    } else {
      const body = buildPost(p.target as Target, p.text, { url: media, coverUrl: p.target.platform === "instagram" ? plannedMediaUrl(p.conceptId, s.clip.sha256, "cover") : null, coverMs: p.target.platform === "tiktok" ? s.clip.coverMs : null }, p.at.toISOString());
      if (p.target.platform === "tiktok" && (body.post.target as any).isAiGenerated !== true) throw new Error("the TikTok post would not carry isAiGenerated");
      say(`  target: ${JSON.stringify(body.post.target)}`);
      say(`  AI label: ${p.target.platform === "tiktok" ? "isAiGenerated: true (TikTok's own label)" : s.disclosure[p.target.platform]}`);
    }
    say(`  ledger: stream “viral”, ${path.relative(ROOT, VIRAL_LEDGER)} (not written in a dry run)`);
    say(`  text (${p.text.length}):`);
    say(args.flags.brief ? `    | ${p.text.split("\n")[0]} …` : p.text.split("\n").map((l) => `    | ${l}`).join("\n"));
  }
  say("\nDry run. Posting the viral stream is not switched on.");
  return 0;
}
