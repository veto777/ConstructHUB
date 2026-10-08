/**
 * Post the social cuts through Blotato — DRY RUN BY DEFAULT (docs/tutorials/PRODUCER-GUIDE.md, "Posting to social").
 *
 *   S="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/social-post.ts"
 *   $S [helpKey…]                     the plan: per video and per account — when, which file, the whole caption
 *   $S [helpKey…] --go                create the posts (and only create: nothing is ever edited or deleted)
 *   $S --reconcile                    ask Blotato what became of each post; update the ledger
 *
 *   --spread M          do not follow YouTube's times: per account, the first post now, each next one M
 *                       minutes (plus up to a third of M) later; accounts start a few minutes apart
 *   --per-day N         posts per account per Eastern day (default: 1 for the first 14 days of an
 *                       account — `--warmup-start YYYY-MM-DD`, `--warmup-days N` — then 3, YouTube's cadence)
 *   --platform a,b      only these platforms (instagram, tiktok, linkedin, facebook, twitter, threads)
 *   --account id,id     only these of the allowed accounts
 *   --i-checked ID      "I looked: this account is ConstructHUB's although its name does not say so" (repeatable)
 *   --retry-failed      plan again what Blotato reported as failed
 *   --release KEY       the owner approved KEY: post it although its help entry says `youtube: { hold: true }`
 *                       (the overview films). Without it a held video is listed as "held for owner approval". Repeatable.
 *   --out-dir DIR       where the productions are (repeatable); --ledger FILE
 *
 * Without --spread a post follows its video's YouTube publish time (docs/tutorials/youtube-schedule.json):
 * the same Eastern day, 30–90 minutes later; LinkedIn only on weekdays 08:30–17:00 Eastern, else the
 * next weekday morning. A video that is already public goes out in the next such window.
 *
 * Environment (the production .env, read at run time; the key is never printed, logged or stored):
 *   TUTORIAL_BLOTATO_KEY          the workspace's API key
 *   TUTORIAL_BLOTATO_ACCOUNT_IDS  the ONLY accounts that may be posted to, comma-separated. Empty → refusal.
 *   TUTORIAL_BLOTATO_PAGE_IDS     accountId:pageId pairs — a Facebook Page (required), a LinkedIn company page
 *
 * The Blotato workspace is shared with other brands: see the four checks at the top of
 * social-post-lib.ts. Media is what social-upload.ts put in R2 and verified at its public address
 * (social/hosted.json); a file that changed since is refused. The ledger,
 * docs/tutorials/social-schedule.json (committed), is the record of what was posted: a video is
 * never posted twice to an account.
 */
import fs from "fs";
import path from "path";
import { ROOT, parseArgs, sha256, sleep } from "./lib";
import { DEFAULT_OUT_DIRS } from "./social";
import { PUBLIC_MEDIA, type Hosted } from "./social-upload";
import {
  checkAccounts, emptyLedger, listAccounts, listSubaccounts, parseAllowlist, parsePageIds, planPosts, reconcilePosts, redact, sendPosts,
  type Io, type SocialLedger, type VideoForPost,
} from "./social-post-lib";
import { PLATFORM_RULES, SOCIAL_PLATFORMS, type SocialPlatform } from "./social-text";
import { easternLabel } from "../../server/youtube/schedule";
import { heldHelpKeys } from "../../shared/help/registry";

const LEDGER = path.join(ROOT, "docs", "tutorials", "social-schedule.json");
const YT_LEDGER = path.join(ROOT, "docs", "tutorials", "youtube-schedule.json");
const list = (v: string | true | undefined): string[] => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const repeated = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : a.startsWith(`--${name}=`) ? [a.slice(name.length + 3)] : []));

function readLedger(file: string): SocialLedger {
  if (!fs.existsSync(file)) return emptyLedger();
  const l = JSON.parse(fs.readFileSync(file, "utf8")) as SocialLedger;
  if (l.version !== 1 || !Array.isArray(l.posts)) throw new Error(`${file} is not a social ledger`);
  return l;
}
const saveLedger = (file: string) => (l: SocialLedger) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(l, null, 2) + "\n"); fs.renameSync(tmp, file); };

/** One video's posts, from its social folder — or why it cannot be posted. */
function loadVideo(helpKey: string, publishAt: string, outDirs: string[]): VideoForPost | string {
  const folder = outDirs.map((d) => path.join(d, helpKey, "social")).find((d) => fs.existsSync(path.join(d, "social.json")));
  if (!folder) return "no social cuts — run social.ts";
  if (!fs.existsSync(path.join(folder, "hosted.json"))) return "its cuts are not uploaded — run social-upload.ts";
  const social = JSON.parse(fs.readFileSync(path.join(folder, "social.json"), "utf8")), hosted = JSON.parse(fs.readFileSync(path.join(folder, "hosted.json"), "utf8")) as Hosted;
  const media = (file: string) => {
    const h = hosted.files[file];
    if (!h) throw new Error(`${file} is not in hosted.json — run social-upload.ts`);
    if (!h.url.startsWith(PUBLIC_MEDIA)) throw new Error(`${file}: hosted somewhere else (${h.url.slice(0, 50)})`);
    if (sha256(fs.readFileSync(path.join(folder, file))) !== h.sha256) throw new Error(`${file} changed since it was uploaded — run social-upload.ts again`);
    return h;
  };
  try {
    const posts: VideoForPost["posts"] = {};
    for (const p of SOCIAL_PLATFORMS) {
      const post = social.platforms?.[p];
      if (!post?.text) continue;
      const cut = PLATFORM_RULES[p].cut;
      // TikTok takes a moment of the video as its cover, so its file opens on the designed cover; Instagram takes the image.
      const tk = p === "tiktok" && social.cuts?.vertical?.tiktok;
      const file = tk ? tk.file : `${cut}.mp4`, m = media(file);
      posts[p] = { text: post.text, cut: file, media: { url: m.url, sha256: m.sha256, coverUrl: p === "instagram" ? media(`cover-${cut}.jpg`).url : null, coverMs: tk ? tk.coverMs : null } };
    }
    return { helpKey, publishAt, posts };
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv, ["go", "reconcile", "retry-failed", "brief"]);
  const key = process.env.TUTORIAL_BLOTATO_KEY ?? "";
  const say = (line: string) => console.log(redact(line, key));
  const io: Io = {
    fetch: async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); return { status: r.status, text: () => r.text() }; },
    sleep, now: () => new Date(), log: say,
  };
  const ledgerFile = typeof args.flags.ledger === "string" ? path.resolve(args.flags.ledger) : LEDGER;
  const ledger = readLedger(ledgerFile), save = saveLedger(ledgerFile);
  try {
    if (args.flags.reconcile) {
      if (!key) throw new Error("TUTORIAL_BLOTATO_KEY is not set (run with --env-file=/home/voiceban/ConstructHUB-live/.env)");
      const r = await reconcilePosts({ ledger, save, key, io });
      say(`${r.checked} asked, ${r.changed} changed`);
      for (const a of r.attention) say(`!!!! ${a}`);
      for (const p of ledger.posts) say(`  ${p.status.padEnd(11)} ${p.helpKey} → ${p.platform} ${p.account}  ${p.scheduledEastern}${p.publicUrl ? `  ${p.publicUrl}` : ""}`);
      if (r.attention.length) process.exit(2);
      return;
    }

    // ── Who may be posted to. An empty allowlist stops everything, before a single request. ──────
    const allowAll = parseAllowlist(process.env.TUTORIAL_BLOTATO_ACCOUNT_IDS);
    if (!key) throw new Error("TUTORIAL_BLOTATO_KEY is not set (run with --env-file=/home/voiceban/ConstructHUB-live/.env)");
    const accounts = await listAccounts(io, key);
    const pageIds = parsePageIds(process.env.TUTORIAL_BLOTATO_PAGE_IDS);
    // Every allowlisted id is checked — also the ones this run filters out: a bad allowlist is fixed, not worked around.
    const all = checkAccounts({ allow: allowAll, accounts, iChecked: repeated(argv, "i-checked"), pageIds });
    say("Accounts this tool may post to (the allowlist, checked against Blotato's own list):");
    for (const t of all) {
      let where = "";
      if (t.platform === "linkedin" || t.platform === "facebook") {
        await sleep(600);
        const subs = await listSubaccounts(io, key, t.id);
        if (t.pageId && !subs.some((s) => s.id === t.pageId)) throw new Error(`REFUSING TO POST: page ${t.pageId} is not a page of account ${t.id}`);
        where = t.pageId ? ` → page “${subs.find((s) => s.id === t.pageId)!.name}”` : t.platform === "linkedin" ? `  (the personal profile — ${subs.length ? `${subs.length} company page(s) connected, none chosen` : "no company page is connected"})` : "";
      }
      say(`  ${t.id.padEnd(7)} ${t.platform.padEnd(10)} ${t.name}${where}`);
    }
    const onlyPlatforms = list(args.flags.platform), onlyAccounts = list(args.flags.account);
    for (const p of onlyPlatforms) if (!(SOCIAL_PLATFORMS as readonly string[]).includes(p)) throw new Error(`--platform ${p}: not one of ${SOCIAL_PLATFORMS.join(", ")}`);
    for (const a of onlyAccounts) if (!all.some((t) => t.id === a)) throw new Error(`--account ${a} is not in the allowlist`);
    const targets = all.filter((t) => (!onlyPlatforms.length || onlyPlatforms.includes(t.platform)) && (!onlyAccounts.length || onlyAccounts.includes(t.id)));
    if (!targets.length) throw new Error("no account is left after --platform / --account");

    // ── Which videos: the ones named, else every video YouTube has (published or scheduled). ─────
    const yt = (JSON.parse(fs.readFileSync(YT_LEDGER, "utf8")).videos as { helpKey: string; status: string; publishAt: string }[]).filter((v) => v.status === "published" || v.status === "scheduled");
    const outDirs = (repeated(argv, "out-dir").map((d) => path.resolve(d)).length ? repeated(argv, "out-dir").map((d) => path.resolve(d)) : DEFAULT_OUT_DIRS).filter((d) => fs.existsSync(d));
    const keys = args._.length ? args._ : yt.map((v) => v.helpKey);
    const released = repeated(argv, "release"), held = heldHelpKeys().filter((k) => !released.includes(k));
    for (const k of released) if (!heldHelpKeys().includes(k)) throw new Error(`--release ${k}: that key is not held`);
    const videos: VideoForPost[] = [];
    for (const k of keys) {
      // Said first, and whatever state its files are in: a held video is the owner's to release.
      if (held.includes(k)) { say(`  ⏸ ${k}: held for owner approval — not posted. When the owner has approved it: --release ${k}`); continue; }
      const posted = yt.find((v) => v.helpKey === k);
      if (!posted) { say(`  – ${k}: not on YouTube yet (not in youtube-schedule.json) — a social post goes out with its video`); continue; }
      const v = loadVideo(k, posted.publishAt, outDirs);
      if (typeof v === "string") { say(`  – ${k}: ${v}`); continue; }
      videos.push(v);
    }
    const num = (name: string): number | null => { const v = args.flags[name]; if (v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`); return n; };
    const now = new Date();
    const { planned, skipped } = planPosts(videos, targets, ledger, {
      now, spreadMin: num("spread"), perDay: num("per-day"), warmupStart: typeof args.flags["warmup-start"] === "string" ? args.flags["warmup-start"] : (process.env.TUTORIAL_SOCIAL_START || null),
      warmupDays: num("warmup-days") ?? undefined, retryFailed: !!args.flags["retry-failed"], held,
    });

    say(`\n${args.flags.go ? "POSTING" : "DRY RUN — nothing is sent"}: ${planned.length} post(s), ${videos.length} video(s) × ${targets.length} account(s)   (now ${easternLabel(now)})`);
    for (const s of skipped) say(`  – ${s.helpKey} → ${s.accountId}: ${s.reason}`);
    for (const p of planned) {
      say(`\n── ${p.helpKey} → ${p.target.platform} ${p.target.name} (${p.target.id}) ──────────────`);
      say(`  when:   ${p.immediate ? "at once" : `${p.eastern}  [scheduledTime ${p.body.scheduledTime}]`}`);
      say(`  media:  ${p.cut}  ${p.media.url}`);
      if (p.media.coverUrl) say(`  cover:  ${p.media.coverUrl}`);
      if (p.media.coverMs != null) say(`  cover:  the video's frame at ${p.media.coverMs} ms (the designed cover is its first half second)`);
      say(`  target: ${JSON.stringify(p.body.post.target)}`);
      say(`  text (${p.text.length} of ${PLATFORM_RULES[p.target.platform].limit}):`);
      if (!args.flags.brief) say(p.text.split("\n").map((l) => `    | ${l}`).join("\n")); else say(`    | ${p.text.split("\n")[0]} …`);
    }
    if (!planned.length) { say("\nnothing to post"); return; }

    // ── Every address a post names must answer before anything is created. ──────────────────────
    const urls = [...new Set(planned.flatMap((p) => [p.media.url, ...(p.media.coverUrl ? [p.media.coverUrl] : [])]))];
    say(`\nMedia addresses (${urls.length}):`);
    let dead = 0;
    for (const u of urls) {
      const r = await fetch(u, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      await r?.arrayBuffer().catch(() => null);
      if (!r || (r.status !== 206 && r.status !== 200)) dead++;
      say(`  ${r ? r.status : "no answer"}  ${u}`);
    }
    if (dead) throw new Error(`${dead} media address(es) do not answer — nothing was posted`);
    if (!args.flags.go) { say("\nDry run. To create these posts, run the same command with --go."); return; }

    const r = await sendPosts({ planned, ledger, save, key, io, allow: allowAll });
    say(`\n${r.sent} created, ${r.failed} failed → ${path.relative(ROOT, ledgerFile)} (commit it). Run --reconcile in a few minutes.`);
    if (r.failed) process.exit(2);
  } catch (e) {
    console.error(`\n✗ ${redact(e instanceof Error ? e.message : String(e), key)}`);
    process.exit(1);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0));
