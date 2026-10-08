/**
 * Schedule the finished walkthrough videos on the company YouTube channel — DRY RUN BY DEFAULT.
 *
 *   npx tsx scripts/tutorials/youtube-schedule.ts [--out-dir DIR]…            the plan: what would go out, and when
 *   npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/youtube-schedule.ts --go
 *                                                                              upload them (private + publishAt)
 *   … --retry-thumbnails [--go]      set the thumbnail of every posted video that still lacks one
 *   … --reconcile [--dry]            ask YouTube what each posted video's real state is; update the ledger
 *   … --calendar                     write docs/tutorials/youtube-calendar.md
 *   … --lint-all                     REPORT (not a test): build the description of every step script in this
 *                                    checkout AND in every sibling worktree and list what breaks a rule, what is
 *                                    under the length target, what has no help entry. Exit 2 when a rule is broken.
 *   … --print-description KEY        print the title, description and tags KEY would be uploaded with
 *   … --update-descriptions [KEY…] [--save DIR] [--go]
 *                                    rewrite title, description and tags of videos that are ALREADY posted or
 *                                    scheduled (all of them, or the keys named). Dry by default: prints each
 *                                    one's length and first 200 characters; --save DIR writes <DIR>/<KEY>.txt
 *                                    to read; --go sends them (videos.update, part=snippet) and updates the ledger.
 *
 * Every upload's title, description and tags come from the description builder
 * (server/youtube/description.ts): 4,300–4,900 characters built from the step script, the help entry
 * and the area's keyword bank — youtube.json's short description is only its opening summary.
 *
 * Three videos per calendar day (America/New_York) — one morning, one midday, one late — at times
 * that change from day to day, the three taken from different areas of the product where possible.
 * Each video is uploaded PRIVATE with `status.publishAt`; YouTube publishes it itself at that time,
 * so nothing of ours has to run when it goes out. The ledger, docs/tutorials/youtube-schedule.json
 * (committed), is the source of truth for what is posted: a key in it is never uploaded twice, a
 * scheduled day is never reshuffled, and this tool never deletes a video.
 *
 * Flags:
 *   --out-dir DIR     where the productions are (<DIR>/<helpKey>/walkthrough.mp4 …); repeat it. Default:
 *                     analysis/video-out of this checkout and of every sibling ConstructHUB* checkout.
 *   --start DATE      first day to fill (YYYY-MM-DD, Eastern). Default: the later of tomorrow (Eastern)
 *                     and the last day in the ledger that still has a free slot.
 *   --per-day N       3 (default: morning + midday + late), 2 (morning + late) or 1 (one time across the day).
 *   --order FILE      the learning order, as tracks (default docs/tutorials/youtube-order.json).
 *   --max N           stop after N uploads in one run (default 30) — the API quota is per day and
 *                     customers' own uploads share it.
 *   --replace KEY     upload KEY's new file in place of the one already posted (same slot when it is
 *                     still ahead); the old video id is reported for deletion BY HAND. Repeatable.
 *   --release KEY     the owner approved KEY: schedule it although its help entry says `youtube: { hold: true }`
 *                     (the overview films). Without it a held video is listed as "held for owner approval"
 *                     and never uploaded. Repeatable.
 *   --category N      force a YouTube category (default: youtube.json's categoryId, else 26 Howto & Style).
 *   --include-unmerged  dry run only: also show videos whose manifest is not in this checkout yet.
 *   --ledger FILE, --manifest-dir DIR   for tests and odd layouts.
 *
 * A video is eligible only when walkthrough.mp4 + captions.srt + youtube.json exist AND its manifest
 * is under shared/help/videos of THIS checkout (it has been merged, so the in-app page the
 * description links to can show it). Run it from an up-to-date checkout of main.
 *
 * The channel grant lives in the production database; anything that talks to YouTube needs
 * `--env-file=/home/voiceban/ConstructHUB-live/.env`. The only thing this writes there is the
 * refreshed access token of that grant (pgYoutubeStore) — nothing else. The plain dry run and
 * --calendar touch neither the database nor Google.
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_CATEGORY, DEFAULT_MAX_UPLOADS, DEFAULT_PER_DAY, calendarMarkdown, trackOf, type Track, easternLabel, findCandidates, planSchedule, readLedger, readOrder, reconcile, retryThumbnails,
  runUploads, textTable, updateDescriptions, zoneTime, manifestShaIn, masterChangedLines, type Candidate, type Describe, type Plan,
} from "../../server/youtube/schedule";
import { DESCRIPTION_TARGET_MIN, TITLE_MAX, YT_DESCRIPTION_LIMIT, YT_TAGS_LIMIT, lintDescription, similarity, tagsCost } from "../../server/youtube/description";
import { describeVideo, scriptKeys, siblingWorktrees, type DescribeContext, type Described } from "../../server/youtube/description-sources";
import { heldHelpKeys, helpEntry, holdReason } from "../../shared/help/registry";
import type { Deps } from "../../server/youtube/client";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BOOLEANS = ["go", "dry", "retry-thumbnails", "reconcile", "calendar", "include-unmerged", "help", "lint-all"];
const VALUES = ["out-dir", "start", "per-day", "order", "max", "replace", "release", "category", "ledger", "manifest-dir", "print-description", "save"];
/** Takes any number of help keys after it (none = every video in the ledger). */
const LISTS = ["update-descriptions"];

function parse(argv: string[]): { flags: Set<string>; values: Record<string, string[]> } {
  const flags = new Set<string>(), values: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (LISTS.includes(a.slice(2))) { flags.add(a.slice(2)); const list = (values[a.slice(2)] ??= []); while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) list.push(argv[++i]); continue; }
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}" (see the header of scripts/tutorials/youtube-schedule.ts)`);
    const eq = a.indexOf("="), name = a.slice(2, eq > 0 ? eq : undefined);
    if (BOOLEANS.includes(name) && eq < 0) { flags.add(name); continue; }
    if (!VALUES.includes(name)) throw new Error(`Unknown flag --${name}`);
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
    (values[name] ??= []).push(v);
  }
  return { flags, values };
}

function defaultOutDirs(): string[] {
  const parent = path.dirname(ROOT);
  const siblings = fs.readdirSync(parent).filter((n) => n.startsWith("ConstructHUB")).map((n) => path.join(parent, n, "analysis", "video-out"));
  return [...new Set([path.join(ROOT, "analysis", "video-out"), ...siblings])].filter((d) => fs.existsSync(d)).sort();
}

/** The real network and the production grant. Loaded only by the modes that talk to YouTube. */
async function youtube(): Promise<{ deps: Deps; close: () => Promise<void> }> {
  if (!process.env.DATABASE_URL || !process.env.GOOGLE_CLIENT_ID || !process.env.GBP_TOKEN_KEY)
    throw new Error("This talks to YouTube with the channel grant from the production database: run it with\n  npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/tutorials/youtube-schedule.ts …");
  const { pgYoutubeStore } = await import("../../server/youtube/store");
  const { pool } = await import("../../server/db");
  return { deps: { store: pgYoutubeStore(pool) }, close: () => pool.end() };
}

/** The description builder over this checkout, its sibling worktrees and the out-dirs: reads files only. */
function describer(ledgerFile: string, orderFile: string, outDirs: string[]) {
  const ctx = (): DescribeContext => ({
    root: ROOT, worktrees: siblingWorktrees(ROOT), outDirs, tracks: readOrder(orderFile),
    ledger: readLedger(ledgerFile).videos, entryOf: (k) => helpEntry(k),
  });
  const full = (helpKey: string, c?: Candidate) => describeVideo(helpKey, ctx(), c ? { dir: c.dir, meta: c.meta } : {});
  return { full, describe: (async (helpKey, c) => full(helpKey, c)) as Describe };
}

function printPlan(plan: Plan, max: number, ledgerCount: number, tracks: Track[]) {
  if (plan.planned.length) {
    console.log(textTable(
      ["#", "helpKey", "title", "Eastern date", "time", "weekday", "area", "UTC"],
      plan.planned.map((p, i) => [String(i + 1), p.helpKey + (p.replaces ? ` (replaces ${p.replaces})` : ""), p.title, p.date, `${p.time} ${p.abbr}`, p.weekday, trackOf(p.helpKey, tracks), p.publishAt]),
    ));
    if (plan.planned.length > max) console.log(`\nOne run uploads at most ${max} (--max): rows 1–${max} first, the rest on the next run.`);
  } else console.log("Nothing new to schedule.");
  console.log(`\nIn the ledger already: ${ledgerCount} video(s)${plan.alreadyPosted.length ? ` — of the videos found, left alone: ${plan.alreadyPosted.join(", ")}` : ""}`);
  for (const k of plan.held) console.log(`⏸ ${k}: held for owner approval — not scheduled${holdReason(k) ? ` (${holdReason(k)})` : ""}. To post it: --release ${k}`);
  for (const line of masterChangedLines(plan)) console.log(line);
  for (const h of plan.hashChanged)
    console.log(`! ${h.helpKey}: the mp4 in ${h.dir} is NOT the file that was uploaded as ${h.videoId} (${h.uploadedSha256.slice(0, 8)} → ${h.fileSha256.slice(0, 8)}). Not re-uploaded. To post the new cut: --replace ${h.helpKey}`);
  for (const p of plan.problems) console.log(`! ${p}`);
}

async function main() {
  const { flags, values } = parse(process.argv.slice(2));
  if (flags.has("help")) { console.log(fs.readFileSync(import.meta.filename, "utf8").split("*/")[0]); return; }
  const one = (name: string) => values[name]?.[values[name].length - 1];
  const ledgerFile = path.resolve(one("ledger") ?? path.join(ROOT, "docs", "tutorials", "youtube-schedule.json"));
  const manifestDir = path.resolve(one("manifest-dir") ?? path.join(ROOT, "shared", "help", "videos"));
  const orderFile = path.resolve(one("order") ?? path.join(ROOT, "docs", "tutorials", "youtube-order.json"));
  const outDirs = (values["out-dir"]?.flatMap((v) => v.split(",")).map((d) => path.resolve(d))) ?? defaultOutDirs();
  const num = (name: string, fallback: number) => { const v = one(name); if (v === undefined) return fallback; const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number, 1 or more`); return n; };
  const max = num("max", DEFAULT_MAX_UPLOADS), perDay = num("per-day", DEFAULT_PER_DAY);
  const category = one("category");
  if (category !== undefined && !/^\d{1,2}$/.test(category)) throw new Error("--category is a YouTube category id (26 = Howto & Style, 27 = Education, 28 = Science & Technology)");
  const go = flags.has("go");
  if (go && flags.has("dry")) throw new Error("--go and --dry together make no sense");
  if (go && flags.has("include-unmerged")) throw new Error("--include-unmerged is for looking only: a video is uploaded after its manifest is merged");

  if (flags.has("lint-all")) {
    // Every script on this machine — unfinished ones in other people's folders included. A report: it is
    // NOT part of `vitest` (server/youtube/description.test.ts lints this checkout only, deterministically).
    const worktrees = siblingWorktrees(ROOT), d = describer(ledgerFile, orderFile, outDirs);
    const all: Described[] = [], broken: string[] = [], none: string[] = [];
    for (const k of scriptKeys(worktrees)) {
      try { const x = await d.full(k); if (x) all.push(x); else none.push(k); } catch (e) { broken.push(`${k}: ${e instanceof Error ? e.message : e}`); }
    }
    for (const x of all) for (const bad of lintDescription(x)) broken.push(`${x.helpKey}: ${bad}`);
    let worst = { s: 0, pair: "" };
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const s = similarity(all[i].description, all[j].description); if (s > worst.s) worst = { s, pair: `${all[i].helpKey} ~ ${all[j].helpKey}` }; }
    if (worst.s >= 0.6) broken.push(`too alike (${worst.s.toFixed(2)}): ${worst.pair}`);
    const short = all.filter((x) => x.underTarget), noEntry = all.filter((x) => !x.input.entry);
    console.log(`description lint: ${all.length} scripts in ${worktrees.length} worktree(s) · ${Math.min(...all.map((x) => x.length))}–${Math.max(...all.map((x) => x.length))} characters · ${all.filter((x) => x.variant === "brand").length} brand film(s) · most alike ${worst.s.toFixed(2)} (${worst.pair})`);
    if (short.length) console.log(`\nUnder ${DESCRIPTION_TARGET_MIN} characters — sent as they are, never padded; add true material to the help entry or the script:\n${textTable(["helpKey", "characters", "script"], short.map((x) => [x.helpKey, String(x.length), x.scriptFile ? path.relative(path.dirname(ROOT), x.scriptFile) : "—"]))}`);
    if (noEntry.length) console.log(`\nNo help entry found: ${noEntry.map((x) => x.helpKey).join(", ")}`);
    if (none.length) console.log(`\nNo steps to build from: ${none.join(", ")}`);
    if (broken.length) { console.log(`\n!!!! ${broken.length} RULE(S) BROKEN:\n${broken.map((b) => `!!!!   ${b}`).join("\n")}`); process.exitCode = 2; }
    else console.log("\nNo rule broken.");
    return;
  }

  if (one("print-description")) {
    const d = await describer(ledgerFile, orderFile, outDirs).full(one("print-description")!);
    if (!d) throw new Error(`${one("print-description")}: no step script or narration in the checkouts to build a description from`);
    console.log(`TITLE (${d.title.length} of ${TITLE_MAX}): ${d.title}\n\nDESCRIPTION (${d.length} characters, ${d.bytes} bytes of YouTube's ${YT_DESCRIPTION_LIMIT}; area ${d.area}; chapters ${d.chapters ? "yes" : "no"})\n${"-".repeat(72)}\n${d.description}\n${"-".repeat(72)}\n\nTAGS (${d.tags.length}, ${tagsCost(d.tags)} of ${YT_TAGS_LIMIT} characters): ${d.tags.join(", ")}`);
    for (const n of d.notes) console.log(`! ${n}`);
    console.log(`\nBuilt from: ${d.scriptFile ?? "the narration in the production folder"}${d.input.entry ? "" : " — NO help entry found for this key"}${d.outDir ? ` · ${d.outDir}` : ""}`);
    return;
  }

  if (flags.has("update-descriptions")) {
    const keys = values["update-descriptions"] ?? [];
    const yt = go ? await youtube() : null;
    try {
      const rows = await updateDescriptions({ ledgerFile, keys, describe: describer(ledgerFile, orderFile, outDirs).describe, deps: yt?.deps, go });
      for (const r of rows) {
        console.log(`${r.helpKey}  ${r.videoId}  ${r.result}`);
        if (!r.description) continue;
        console.log(`  title       ${r.title}${r.title !== r.oldTitle ? `   (was: ${r.oldTitle})` : ""}`);
        console.log(`  description ${r.length} characters, ${r.bytes} bytes (limit ${YT_DESCRIPTION_LIMIT}) · ${r.tags} tags`);
        console.log(`  starts      ${r.first}\n`);
      }
      const dir = one("save");
      if (dir) {
        fs.mkdirSync(path.resolve(dir), { recursive: true });
        for (const r of rows) if (r.description) fs.writeFileSync(path.join(path.resolve(dir), `${r.helpKey}.txt`), r.description + "\n");
        console.log(`Wrote ${rows.filter((r) => r.description).length} description(s) to ${path.resolve(dir)}`);
      }
      const failed = rows.filter((r) => r.result.startsWith("failed") || r.result.startsWith("no source"));
      if (failed.length) { console.log(`!!!! ${failed.length} not done: ${failed.map((r) => `${r.helpKey} (${r.result})`).join("; ")}`); process.exitCode = 2; }
      console.log(go ? `\nLedger: ${ledgerFile} — commit it.` : "\nDRY RUN: nothing was sent to YouTube and the ledger was not touched. Add --go (and the --env-file) to apply.");
    } finally { await yt?.close(); }
    return;
  }

  if (flags.has("reconcile")) {
    const yt = await youtube();
    try {
      const write = !flags.has("dry");
      const rows = await reconcile({ ledgerFile, deps: yt.deps, write });
      console.log(textTable(
        ["helpKey", "video", "privacy", "upload", "processing", "publishAt (Eastern)", "thumbnails", "verdict"],
        rows.map((r) => [r.helpKey, r.videoId, r.youtube?.privacyStatus ?? "—", r.youtube?.uploadStatus ?? "—", r.youtube?.processingStatus ?? "—",
          r.youtube?.publishAt ? easternLabel(r.youtube.publishAt) : r.youtube?.publishedAt ? `went out ${easternLabel(r.youtube.publishedAt)}` : "—",
          r.youtube?.thumbnailSizes?.join(",") || "—", (r.loud ? "!! " : "") + r.verdict]),
      ));
      console.log("\n(The API lists thumbnail sizes but has no field saying whether a thumbnail is a custom one; the ledger's `thumbnail` column is what this tool managed to set.)");
      const loud = rows.filter((r) => r.loud);
      if (loud.length) console.log(`\n!!!! ${loud.length} VIDEO(S) NEED A PERSON:\n${loud.map((r) => `!!!!   ${r.helpKey} (${r.videoId}): ${r.verdict}`).join("\n")}`);
      console.log(write ? `\nLedger updated: ${ledgerFile} — commit it.` : "\n--dry: the ledger was not changed.");
      if (loud.length) process.exitCode = 2;
    } finally { await yt.close(); }
    return;
  }

  if (flags.has("retry-thumbnails")) {
    const yt = go ? await youtube() : null;
    try {
      const rows = await retryThumbnails({ ledgerFile, outDirs, deps: yt?.deps ?? { store: { load: async () => null, saveAccess: async () => undefined, markNeedsReconnect: async () => undefined } }, go });
      if (!rows.length) console.log("Every posted video has its thumbnail.");
      else console.log(textTable(["helpKey", "video", "thumbnail.jpg", "result"], rows.map((r) => [r.helpKey, r.videoId, r.file ?? "NOT FOUND in the out-dirs", r.result])));
      const refused = rows.filter((r) => r.result.startsWith("failed"));
      if (refused.length) { console.log(`\n!!!! ${refused.length} thumbnail(s) REFUSED by YouTube — the channel is phone-verified, so this should not happen; look at the reason above.`); process.exitCode = 2; }
      console.log(go ? `\nLedger: ${ledgerFile} — commit it.` : "\ndry run: nothing was sent. Add --go (and the --env-file) to set them.");
    } finally { await yt?.close(); }
    return;
  }

  const ledger = readLedger(ledgerFile);
  const tracks = readOrder(orderFile);
  const { eligible, skipped } = findCandidates(outDirs, manifestDir, { includeUnmerged: flags.has("include-unmerged") });
  const plan = planSchedule({ ledger, candidates: eligible, tracks, now: new Date(), start: one("start"), perDay, replace: values.replace ?? [], held: heldHelpKeys(), release: values.release ?? [], manifestSha: manifestShaIn(manifestDir) });

  if (flags.has("calendar")) {
    const file = path.join(path.dirname(ledgerFile), "youtube-calendar.md");
    fs.writeFileSync(file, calendarMarkdown(ledger, plan.planned));
    console.log(`Wrote ${file}: ${ledger.videos.filter((e) => e.videoId).length} posted or scheduled, ${plan.planned.length} planned.`);
    return;
  }

  console.log(`Now: ${easternLabel(new Date())} · ledger ${path.relative(ROOT, ledgerFile)} · order ${path.relative(ROOT, orderFile)} (${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.keys.length, 0)} keys) · ${perDay} a day`);
  console.log(`Out-dirs:\n${outDirs.map((d) => `  ${d}`).join("\n")}\n`);
  printPlan(plan, max, ledger.videos.filter((e) => e.videoId).length, tracks);
  const waiting = skipped.filter((s) => !/another copy is used/.test(s.reason) && !ledger.videos.some((e) => e.helpKey === s.helpKey && e.videoId));
  if (waiting.length) console.log(`\nFound but not eligible:\n${textTable(["helpKey", "why", "where"], waiting.map((s) => [s.helpKey, s.reason, s.dir]))}`);
  if (plan.planned.length) console.log(`\nCategory: ${category ?? `youtube.json's categoryId, else ${DEFAULT_CATEGORY}`} · made for kids: no · uploaded private, published by YouTube at the time shown.`);

  // A description that cannot reach the target from its own material is not an error and is not padded: it is flagged here.
  if (plan.planned.length) {
    const d = describer(ledgerFile, orderFile, outDirs);
    for (const p of plan.planned.slice(0, max)) {
      const x = await d.full(p.helpKey, p.candidate).catch(() => null);
      if (x?.underTarget) console.log(`! ${p.helpKey}: its description is ${x.length} characters (target ${DESCRIPTION_TARGET_MIN}) — sent as it is, not padded. More true text in its help entry or script lengthens it.`);
    }
  }

  if (!go) { console.log("\nDRY RUN: nothing was uploaded and the ledger was not touched. Add --go to upload."); return; }
  if (!plan.planned.length) return;
  const yt = await youtube();
  try {
    const res = await runUploads({ ledgerFile, planned: plan.planned, deps: yt.deps, max, category, log: (l) => console.log(l), describe: describer(ledgerFile, orderFile, outDirs).describe });
    console.log(`\nUploaded ${res.uploaded.length}: ${res.uploaded.map((u) => `${u.helpKey} ${u.videoId} (${zoneTime(u.publishAt).date})`).join(", ") || "none"}`);
    for (const d of res.deleteByHand)
      console.log(`!!!! DELETE BY HAND in YouTube Studio: ${d.url} (old ${d.helpKey})${d.stillScheduledFor ? ` — it is STILL SCHEDULED for ${easternLabel(d.stillScheduledFor)} and will go public beside the new one unless it is deleted first` : ""}`);
    for (const w of res.warnings) console.log(`!!!! ${w}`);
    if (res.warnings.length) process.exitCode = 2;
    if (res.stopped) { console.log(`\nStopped: ${res.stopped}`); process.exitCode = 1; }
    console.log(`\nLedger: ${ledgerFile} — commit it (and run --calendar).`);
  } finally { await yt.close(); }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
