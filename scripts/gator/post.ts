/**
 * The gator shorts in the social calendar — DRY RUN BY DEFAULT. Reached as
 *
 *   S="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/social-post.ts --stream viral"
 *   $S [conceptId…] [--platform a,b]          the plan under the cadence (stream.ts): when, caption, request
 *   $S <conceptId…> --go                      upload the clips to R2 and create those posts
 *   $S <conceptId…> --asap [--gap 4] [--go]   the owner said "post these now": per account the first at once and
 *                                             each next one --gap minutes later, accounts a minute apart
 *                                             (this sets the one-a-day and back-to-back rules aside — on purpose;
 *                                             the platforms' rate rule, social-rate.ts, still holds unless
 *                                             --override-rate is given: LinkedIn 3, Instagram 4 per 24 hours)
 *   $S <conceptId> --asap --at ISO --platform linkedin --go     one repost at a set time
 *   $S --youtube <conceptId…> [--gap 3] [--go]                  public Shorts on our own channel
 *   $S --reconcile                            ask Blotato what became of each post; update the viral ledger
 *
 * It prints, for every finished clip (analysis/gator-shorts/<conceptId>/social.json) and every account,
 * when it would go out under the viral cadence (stream.ts), the whole caption, the Blotato request with
 * its AI-generated disclosure, and — for YouTube Shorts — the videos.insert request our own YouTube
 * client would open (`#Shorts` title, `status.containsSyntheticMedia: true`).
 *
 * `--go` (the owner approved posting on 2026-10-08) goes through the same gates as the tutorial poster:
 * the allowlist (TUTORIAL_BLOTATO_ACCOUNT_IDS), the built-in denylist, Blotato's own account list, the
 * name check; media from our own R2 (create-only, hashed names, each address asked for its first bytes);
 * the viral ledger (docs/gator/viral-schedule.json) written BEFORE each request, so nothing is sent twice.
 * Only clips whose social.json carries `aiGenerated: true` are posted, and TikTok gets isAiGenerated.
 * YouTube Shorts go through our own YouTube client (`--youtube`), never Blotato: public, `#Shorts` in the
 * title, `status.containsSyntheticMedia: true`, in the playlist "ConstructHUB Gator Shorts". The channel
 * grant is read from the production database the way youtube-schedule.ts reads it — the grant row and its
 * refreshed token, nothing else.
 */
import fs from "fs";
import path from "path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ROOT, parseArgs, readEnvFile, sha256, sleep } from "../tutorials/lib";
import { DENYLIST, buildPost, checkAccounts, emptyLedger, followYouTube, listAccounts, parseAllowlist, reconcilePosts, redact, sendPosts, type Io, type PlannedPost, type SocialLedger, type Target } from "../tutorials/social-post-lib";
import type { SocialPlatform } from "../tutorials/social-text";
import { uploadSessionRequest } from "../../server/youtube/client";
import { easternLabel } from "../../server/youtube/schedule";
import { OUT } from "./make";
import { accountTimes, nextAllowed, rateRefusal } from "../tutorials/social-rate";
import { emptyViralLedger, planViral, type ViralClip, type ViralLedger, type ViralPlanned, type ViralPlatform, type ViralTarget } from "./stream";

export const VIRAL_LEDGER = path.join(ROOT, "docs", "gator", "viral-schedule.json");
const TUTORIAL_LEDGER = path.join(ROOT, "docs", "tutorials", "social-schedule.json");
const YT_LEDGER = path.join(ROOT, "docs", "tutorials", "youtube-schedule.json");
/** Where a clip's file will be served from once it is uploaded (the tutorials' media route). Not uploaded by this tool. */
export const plannedMediaUrl = (conceptId: string, sha: string, what: "clip" | "cover") => `https://constructhub.us/api/tutorials/media/gator-${conceptId}.social-${what === "clip" ? "vertical" : "cover-vertical"}.${sha.slice(0, 8)}.${what === "clip" ? "mp4" : "jpg"}`;
const readJson = <T>(file: string, fallback: T): T => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as T : fallback);

/** The storage key of a clip's file: a name the tutorials' media route serves. */
export const mediaKey = (conceptId: string, sha: string, what: "clip" | "cover") => `tutorials/${plannedMediaUrl(conceptId, sha, what).slice("https://constructhub.us/api/tutorials/media/".length)}`;
/** A Short on our own channel (YouTube's API, never Blotato). `uploading` = the request left and no answer was recorded: never sent again by itself. */
export type YoutubeShort = { conceptId: string; title: string; sha256: string; status: "uploading" | "uploaded" | "failed"; videoId: string | null; url: string | null; privacyStatus: string | null; containsSyntheticMedia: true; playlist: string | null; startedAt: string; uploadedAt?: string | null; error?: string | null };
export const SHORTS_PLAYLIST = "ConstructHUB Gator Shorts";
/** The three pilots were posted before styles had numbers: they are style 6 (cartoon with a meme caption). */
const PILOT_STYLE: Record<string, number> = { "while-youre-here": 6, "two-day-job": 6, "shingle-rhythm": 6 };
export const ledgerKey = (conceptId: string) => `gator:${conceptId}`;
/** Every entry of this ledger is a gator clip: marked so, whatever wrote it. */
export const saveViralLedger = (file: string) => (l: SocialLedger) => {
  // …and carries the style of the experiment it belongs to (docs/gator/STYLES.md), for the scoreboard.
  const styleOf = (id: string): number | null => { try { const f = path.join(OUT, id, "social.json"); return (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).style : null) ?? PILOT_STYLE[id] ?? null; } catch { return null; } };
  const posts = l.posts.map((p) => { const conceptId = p.helpKey.replace(/^gator:/, ""); return { ...p, stream: "viral" as const, conceptId, style: (p as { style?: number | null }).style ?? styleOf(conceptId), aiGenerated: true as const }; });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const youtube = (l as unknown as ViralLedger & { youtube?: YoutubeShort[] }).youtube ?? [];
  const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify({ version: 1, stream: "viral", timezone: l.timezone, posts, youtube }, null, 2) + "\n"); fs.renameSync(tmp, file);
};
/** "Post these now": per account the first at once, each next `gapMin` later; accounts start a minute apart. */
export function planAsap(clips: readonly ViralClip[], targets: readonly ViralTarget[], viral: ViralLedger, now: Date, gapMin: number, o: { tutorial?: SocialLedger; overrideRate?: boolean } = {}): { planned: ViralPlanned[]; skipped: { conceptId: string; accountId: string; reason: string }[] } {
  const planned: ViralPlanned[] = [], skipped: { conceptId: string; accountId: string; reason: string }[] = [];
  targets.forEach((t, ti) => {
    let n = 0;
    const times = accountTimes(t.id, viral, ...(o.tutorial ? [o.tutorial] : []));
    for (const c of clips) {
      const mine = c.platforms[t.platform];
      if (!mine) { skipped.push({ conceptId: c.conceptId, accountId: t.id, reason: `no ${t.platform} post for this clip` }); continue; }
      const before = viral.posts.find((p) => p.conceptId === c.conceptId && p.accountId === t.id && p.status !== "failed");
      if (before) { skipped.push({ conceptId: c.conceptId, accountId: t.id, reason: `already ${before.status}` }); continue; }
      const at = new Date(now.getTime() + (ti + n * gapMin) * 60000);
      // The platform's allowance (both streams). "As soon as possible" does not mean "more than the account can take".
      const refusal = o.overrideRate ? null : rateRefusal(t.platform, at, times);
      if (refusal) { const free = nextAllowed(t.platform, at, times); skipped.push({ conceptId: c.conceptId, accountId: t.id, reason: `${refusal}${free ? ` — free again ${easternLabel(free)} (--at ${free.toISOString()})` : ""}` }); continue; }
      n++; times.push(at.getTime());
      planned.push({ conceptId: c.conceptId, target: t, at, eastern: easternLabel(at), slot: "asap", text: mine.text, ...(mine.title ? { title: mine.title } : {}) });
    }
  });
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.target.id.localeCompare(b.target.id));
  return { planned, skipped };
}

/** Put a clip and its cover in R2 (create-only) and ask each public address for its first bytes. */
async function host(conceptId: string, s: any, say: (l: string) => void): Promise<{ clip: string; cover: string }> {
  const keys = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"], envFile = process.env.TUTORIAL_R2_ENV || "/home/voiceban/ConstructHUB-live/.env";
  const env: Record<string, string | undefined> = { ...(fs.existsSync(envFile) ? readEnvFile(envFile, keys) : {}), ...Object.fromEntries(keys.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))) };
  if (keys.slice(0, 3).some((k) => !env[k])) throw new Error("R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not set");
  const Bucket = env.R2_BUCKET_NAME || "constructhub";
  const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! } });
  const out: Record<string, string> = {};
  for (const [what, file, type] of [["clip", s.clip.file, "video/mp4"], ["cover", s.clip.cover, "image/jpeg"]] as const) {
    const data = fs.readFileSync(path.join(OUT, conceptId, file));
    if (what === "clip" && sha256(data) !== s.clip.sha256) throw new Error(`${conceptId}: ${file} is not the file social.json describes — assemble it again`);
    // Named by the CLIP's hash, cover included: the pair belongs together.
    const Key = mediaKey(conceptId, s.clip.sha256, what), url = plannedMediaUrl(conceptId, s.clip.sha256, what);
    const head = async () => { try { const r = await s3.send(new HeadObjectCommand({ Bucket, Key })); return Number(r.ContentLength); } catch (e: any) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null; throw e; } };
    const there = await head();
    if (there !== null && there !== data.length) throw new Error(`${Key} exists in R2 with ${there} bytes, expected ${data.length} — refusing to touch it`);
    if (there === null) { await s3.send(new PutObjectCommand({ Bucket, Key, Body: data, ContentType: type, CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*" })); if ((await head()) !== data.length) throw new Error(`${Key}: uploaded, but R2 does not report it`); }
    const res = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(30_000) });
    await res.arrayBuffer();
    const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1]);
    if (res.status !== 206 || total !== data.length || !(res.headers.get("content-type") ?? "").startsWith(type)) throw new Error(`${url} answered ${res.status} (${total} of ${data.length} bytes, ${res.headers.get("content-type")})`);
    say(`  ${there === null ? "+" : "="} ${url}  206, ${data.length} bytes`);
    out[what] = url;
  }
  fs.writeFileSync(path.join(OUT, conceptId, "hosted.json"), JSON.stringify({ conceptId, sha256: s.clip.sha256, ...out, verifiedAt: new Date().toISOString() }, null, 2) + "\n");
  return out as { clip: string; cover: string };
}

/**
 * `--youtube <conceptId…> [--gap 3] [--go]`: the clips as public Shorts on our own channel — `#Shorts` title,
 * `status.containsSyntheticMedia: true`, in the playlist "ConstructHUB Gator Shorts", `gap` minutes apart.
 * The channel grant is read from the production database exactly as scripts/tutorials/youtube-schedule.ts
 * reads it (pgYoutubeStore: the grant row, and its refreshed access token — nothing else is read or written).
 * The ledger is written before each upload; a clip is never uploaded twice.
 */
async function sendShorts(ids: string[], viral: ViralLedger, save: (l: SocialLedger) => void, go: boolean, gapMin: number, say: (l: string) => void): Promise<number> {
  if (!ids.length) throw new Error("--youtube needs the clips named");
  const ledger = viral as ViralLedger & { youtube?: YoutubeShort[] };
  ledger.youtube ??= [];
  const todo: { id: string; s: any; title: string; text: string }[] = [];
  for (const id of ids) {
    const f = path.join(OUT, id, "social.json");
    if (!fs.existsSync(f)) throw new Error(`${id}: no finished clip`);
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    if (s.aiGenerated !== true || !s.platforms?.youtube?.title) throw new Error(`${id}: its social.json has no YouTube post or no AI-generated flag`);
    const before = ledger.youtube.find((y) => y.conceptId === id && y.status !== "failed");
    if (before) { say(`  – ${id}: already ${before.status}${before.url ? ` (${before.url})` : " — its outcome was never recorded: look in YouTube Studio (never sent twice)"}`); continue; }
    if (sha256(fs.readFileSync(path.join(OUT, id, s.clip.file))) !== s.clip.sha256) throw new Error(`${id}: ${s.clip.file} is not the file social.json describes`);
    const req = uploadSessionRequest({ title: s.platforms.youtube.title, description: s.platforms.youtube.text, tags: s.platforms.youtube.hashtags, categoryId: "24", privacyStatus: "public", containsSyntheticMedia: true }, s.clip.bytes);
    say(`── ${id} → YouTube Shorts ──  videos.insert: ${JSON.stringify(req.body)}`);
    todo.push({ id, s, title: s.platforms.youtube.title, text: s.platforms.youtube.text });
  }
  if (!go) { say("\nDry run. Add --go to upload."); return 0; }
  if (!process.env.DATABASE_URL || !process.env.GOOGLE_CLIENT_ID || !process.env.GBP_TOKEN_KEY) throw new Error("This uses the channel grant: run it with --env-file=/home/voiceban/ConstructHUB-live/.env");
  const { pgYoutubeStore } = await import("../../server/youtube/store");
  const { pool } = await import("../../server/db");
  const { uploadVideo, addToPlaylist, watchUrlOf } = await import("../../server/youtube/client").then((m) => ({ uploadVideo: m.uploadVideo, addToPlaylist: m.addToPlaylist, watchUrlOf: (v: string) => `https://www.youtube.com/shorts/${v}` }));
  const deps = { store: pgYoutubeStore(pool) };
  let failed = 0;
  try {
    for (const [i, t] of todo.entries()) {
      if (i) { say(`  … ${gapMin} minutes before the next one`); await sleep(gapMin * 60_000); }
      const entry: YoutubeShort = { conceptId: t.id, title: t.title, sha256: t.s.clip.sha256, status: "uploading", videoId: null, url: null, privacyStatus: null, containsSyntheticMedia: true, playlist: null, startedAt: new Date().toISOString() };
      ledger.youtube.push(entry); save(ledger as unknown as SocialLedger);
      try {
        const v = await uploadVideo({ filePath: path.join(OUT, t.id, t.s.clip.file), title: t.title, description: t.text, tags: t.s.platforms.youtube.hashtags, categoryId: "24", privacyStatus: "public", containsSyntheticMedia: true }, deps);
        Object.assign(entry, { status: "uploaded", videoId: v.videoId, url: watchUrlOf(v.videoId), privacyStatus: v.privacyStatus, uploadedAt: new Date().toISOString() });
        save(ledger as unknown as SocialLedger);
        say(`  ✓ ${t.id} → ${entry.url}  (${v.privacyStatus})`);
        try { const pl = await addToPlaylist(v.videoId, SHORTS_PLAYLIST, deps, { privacyStatus: "public" }); entry.playlist = `${SHORTS_PLAYLIST} (${pl.playlistId}${pl.created ? ", created" : ""})`; }
        catch (e) { entry.playlist = null; entry.error = `playlist: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300); say(`  ! ${t.id}: uploaded, but not added to the playlist — ${entry.error}`); }
        save(ledger as unknown as SocialLedger);
      } catch (e) {
        // An upload that failed with an answer is a failure; one that died without an answer stays "uploading".
        const why = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        if ((e as any)?.code || (e as any)?.status) { entry.status = "failed"; failed++; }
        entry.error = why; save(ledger as unknown as SocialLedger);
        say(`  ✗ ${t.id}: ${why}`);
        if (entry.status === "uploading") throw new Error(`stopped: the outcome of ${t.id} on YouTube is unknown — look in YouTube Studio`);
      }
    }
  } finally { await pool.end(); }
  return failed ? 2 : 0;
}

export async function viralMain(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["go", "brief", "asap", "reconcile", "youtube", "override-rate"]);
  const key = process.env.TUTORIAL_BLOTATO_KEY ?? "";
  const say = (s: string) => console.log(redact(s, key));
  const io: Io = { fetch: async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); return { status: r.status, text: () => r.text() }; }, sleep, now: () => new Date(), log: say };
  const ledgerFile = typeof args.flags.ledger === "string" ? path.resolve(args.flags.ledger) : VIRAL_LEDGER;
  const now = typeof args.flags.now === "string" ? new Date(args.flags.now) : new Date();
  const tutorial = readJson<SocialLedger>(TUTORIAL_LEDGER, emptyLedger());
  const viral = readJson<ViralLedger>(ledgerFile, emptyViralLedger());
  const save = saveViralLedger(ledgerFile);
  try {
  if (args.flags.reconcile) {
    if (!key) throw new Error("TUTORIAL_BLOTATO_KEY is not set (run with --env-file=/home/voiceban/ConstructHUB-live/.env)");
    const r = await reconcilePosts({ ledger: viral as unknown as SocialLedger, save, key, io });
    say(`${r.checked} asked, ${r.changed} changed`);
    for (const a of r.attention) say(`!!!! ${a}`);
    for (const p of viral.posts) say(`  ${p.status.padEnd(11)} ${p.conceptId ?? p.helpKey} → ${p.platform} ${p.account}  ${p.scheduledEastern}${p.publicUrl ? `  ${p.publicUrl}` : ""}`);
    return r.attention.length ? 2 : 0;
  }
  if (args.flags.youtube) return await sendShorts(args._, viral, save, !!args.flags.go, typeof args.flags.gap === "string" ? Number(args.flags.gap) : 3, say);
  if (args.flags.go && !args._.length) throw new Error("--go needs the clips named: posting is never “everything that happens to be in the folder”");
  const yt = readJson<{ videos: { helpKey: string; status: string; publishAt: string }[] }>(YT_LEDGER, { videos: [] }).videos.filter((v) => v.status === "published" || v.status === "scheduled");

  // The accounts. With --go: the allowlist, checked against Blotato's own list (as the tutorial poster does).
  // Dry: the ones the tutorial ledger already posts to — no network.
  const seen = new Map<string, ViralTarget>();
  if (args.flags.go) {
    if (!key) throw new Error("TUTORIAL_BLOTATO_KEY is not set (run with --env-file=/home/voiceban/ConstructHUB-live/.env)");
    for (const t of checkAccounts({ allow: parseAllowlist(process.env.TUTORIAL_BLOTATO_ACCOUNT_IDS), accounts: await listAccounts(io, key) })) if (t.platform === "instagram" || t.platform === "tiktok" || t.platform === "linkedin") seen.set(t.id, { id: t.id, platform: t.platform, name: t.name });
    say("Accounts (the allowlist, checked against Blotato's own list):");
    for (const t of seen.values()) say(`  ${t.id.padEnd(7)} ${t.platform.padEnd(10)} ${t.name}`);
  } else for (const p of tutorial.posts) if (!DENYLIST[p.accountId] && (p.platform === "instagram" || p.platform === "tiktok" || p.platform === "linkedin")) seen.set(p.accountId, { id: p.accountId, platform: p.platform, name: p.account });
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
  const at = (v: string) => { const d = new Date(v); if (!Number.isFinite(d.getTime()) || d.getTime() < now.getTime() - 60_000) throw new Error("--at is an ISO time that has not passed (2026-10-08T14:15:00Z)"); return d; };
  const gap = typeof args.flags.gap === "string" ? Number(args.flags.gap) : 4;
  if (!(gap >= 1 && gap <= 120)) throw new Error("--gap is 1–120 minutes");
  // --asap keeps the order the clips were named in.
  const ordered = args._.length ? args._.map((id) => clips.find((c) => c.conceptId === id)).filter((c): c is ViralClip => !!c) : clips;
  const { planned, skipped } = args.flags.asap
    ? planAsap(ordered, targets.filter((t) => t.platform !== "youtube"), viral, typeof args.flags.at === "string" ? at(args.flags.at) : now, gap, { tutorial, overrideRate: !!args.flags["override-rate"] })
    : planViral(ordered, targets, { now, viral, tutorial, youtubeTimes: yt.map((v) => v.publishAt), alsoTutorial });

  say(`${args.flags.go ? "POSTING" : "DRY RUN — nothing is uploaded, sent or written"}: the viral stream (gator shorts)${args.flags.asap ? ", as soon as possible" : ""}.   (now ${easternLabel(now)})`);
  say(`${planned.length} post(s): ${clips.length} clip(s) × ${targets.length} account(s)`);
  for (const s of skipped) say(`  – ${s.conceptId} → ${s.accountId}: ${s.reason}`);
  const toSend: PlannedPost[] = [];
  for (const p of planned) {
    const s = socials.get(p.conceptId), media = plannedMediaUrl(p.conceptId, s.clip.sha256, "clip");
    say(`\n── ${p.conceptId} → ${p.target.platform} ${p.target.name} (${p.target.id}) ──────────────`);
    say(`  when:   ${p.eastern}  [the ${p.slot} Eastern slot]`);
    say(`  file:   ${path.join(OUT, p.conceptId, s.clip.file)}  (${s.clip.durationSec} s; would be served as ${media})`);
    if (p.target.platform === "youtube") {
      const req = uploadSessionRequest({ title: p.title!, description: p.text, tags: s.platforms.youtube.hashtags, categoryId: "24", publishAt: p.at.toISOString(), containsSyntheticMedia: true }, s.clip.bytes, now.getTime());
      say(`  videos.insert: ${JSON.stringify(req.body)}`);
    } else {
      const immediate = p.at.getTime() - now.getTime() < 90_000;
      const m = { url: media, sha256: s.clip.sha256 as string, coverUrl: p.target.platform === "instagram" ? plannedMediaUrl(p.conceptId, s.clip.sha256, "cover") : null, coverMs: p.target.platform === "tiktok" ? s.clip.coverMs : null };
      const body = buildPost(p.target as Target, p.text, m, immediate ? null : new Date(Math.round(p.at.getTime() / 1000) * 1000).toISOString());
      toSend.push({ helpKey: ledgerKey(p.conceptId), target: p.target as Target, text: p.text, cut: s.clip.file, media: m, at: p.at, immediate, eastern: p.eastern, body });
      if (p.target.platform === "tiktok" && (body.post.target as any).isAiGenerated !== true) throw new Error("the TikTok post would not carry isAiGenerated");
      say(`  target: ${JSON.stringify(body.post.target)}`);
      say(`  AI label: ${p.target.platform === "tiktok" ? "isAiGenerated: true (TikTok's own label)" : s.disclosure[p.target.platform]}`);
    }
    say(`  ledger: stream “viral”, ${path.relative(ROOT, ledgerFile)}${args.flags.go ? "" : " (not written in a dry run)"}`);
    say(`  text (${p.text.length}):`);
    say(args.flags.brief ? `    | ${p.text.split("\n")[0]} …` : p.text.split("\n").map((l) => `    | ${l}`).join("\n"));
  }
  if (!args.flags.go) { say("\nDry run. To create these posts, name the clips and add --go."); return 0; }
  if (!toSend.length) { say("\nnothing to post"); return 0; }
  // Media first: every clip and cover in R2, each public address answering with its first bytes.
  say("\nMedia:");
  for (const id of [...new Set(toSend.map((p) => p.helpKey.replace(/^gator:/, "")))]) await host(id, socials.get(id), say);
  const allow = parseAllowlist(process.env.TUTORIAL_BLOTATO_ACCOUNT_IDS);
  const r = await sendPosts({ planned: toSend, ledger: viral as unknown as SocialLedger, save, key, io, allow });
  say(`\n${r.sent} created, ${r.failed} failed → ${path.relative(ROOT, ledgerFile)} (commit it). Run --reconcile in a few minutes.`);
  say("YouTube Shorts are a separate step: --youtube <conceptId…> --go");
  return r.failed ? 2 : 0;
  } catch (e) { console.error(redact(`\n✗ ${e instanceof Error ? e.message : String(e)}`, key)); return 1; }
}
