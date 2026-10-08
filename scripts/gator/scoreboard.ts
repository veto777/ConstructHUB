/**
 * The styles experiment's scoreboard (docs/gator/STYLES.md): which STYLE of gator clip earns its keep.
 *
 *   B="npx tsx --env-file=/home/voiceban/ConstructHUB-live/.env scripts/gator/scoreboard.ts"
 *   $B                 ONE pass: for every posted clip whose +2 h / +24 h / +72 h reading is due and missing, take it
 *                      (YouTube from the API; the others from the manual sheet), then write docs/gator/SCOREBOARD.md
 *   $B --no-fetch      only rewrite the document from what is recorded
 *
 * Where the numbers come from:
 *   · YouTube — our own client and the channel grant (read-only): videos.list statistics (views, likes, comments)
 *     and the Analytics API's average view duration.
 *   · Instagram, TikTok, LinkedIn — Blotato's API has NO analytics endpoint (read 2026-10-08: accounts, posts,
 *     post status, media — nothing else), so their counts are typed by a person into
 *     docs/gator/metrics-manual.csv:  conceptId,platform,checkpoint,views,likes,comments,shares
 *     (checkpoint: 2h | 24h | 72h). The run lists exactly which rows it is waiting for.
 *
 * Reading the board: these accounts are days old, so "views per follower" means nothing. Clips are ranked
 * WITHIN a platform, by views and by engagement rate = (likes + comments + shares) / views, and a style's
 * score is the mean of its clips' percentile ranks. A recommendation is printed only when every style has
 * both of its clips at +72 h — before that it would be a guess. One pass per run; no loop, no timer.
 */
import fs from "fs";
import path from "path";
import { ROOT, parseArgs } from "../tutorials/lib";

export const METRICS = path.join(ROOT, "docs", "gator", "metrics.json");
export const MANUAL = path.join(ROOT, "docs", "gator", "metrics-manual.csv");
export const BOARD = path.join(ROOT, "docs", "gator", "SCOREBOARD.md");
const VIRAL_LEDGER = path.join(ROOT, "docs", "gator", "viral-schedule.json");
export const CHECKPOINTS = [{ id: "2h", hours: 2 }, { id: "24h", hours: 24 }, { id: "72h", hours: 72 }] as const;
export type CheckpointId = (typeof CHECKPOINTS)[number]["id"];
export type Reading = { views: number; likes: number; comments: number; shares: number; avgViewSec?: number | null; at: string; source: "youtube-api" | "manual" };
export type Posted = { conceptId: string; style: number | null; platform: string; url: string | null; publishedAt: string; videoId?: string | null };
export type Metrics = Record<string, Partial<Record<CheckpointId, Reading>>>;
export const keyOf = (p: Pick<Posted, "conceptId" | "platform">) => `${p.conceptId}@${p.platform}`;

/** Which readings of a post are due now and not yet taken. A reading is taken once, at or after its hour — never back-filled as an earlier one. */
export function due(p: Posted, have: Partial<Record<CheckpointId, Reading>> | undefined, now: Date): CheckpointId[] {
  const age = (now.getTime() - new Date(p.publishedAt).getTime()) / 3600000;
  const last = Math.max(-1, ...CHECKPOINTS.map((c, i) => (have?.[c.id] ? i : -1)));
  const open = CHECKPOINTS.filter((c, i) => i > last && age >= c.hours);
  // Late to the party: one reading now is the LATEST checkpoint that is due; the earlier ones stay empty.
  return open.length ? [open[open.length - 1].id] : [];
}
export const engagementRate = (r: Pick<Reading, "views" | "likes" | "comments" | "shares">): number | null => (r.views > 0 ? (r.likes + r.comments + r.shares) / r.views : null);
/** Percentile rank (0–1, 1 = best) of each value among the values; ties share the mean rank; null stays null. */
export function percentiles(values: readonly (number | null)[]): (number | null)[] {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return values.map((v) => (v === null ? null : 1));
  return values.map((v) => (v === null ? null : (known.filter((x) => x < v).length + (known.filter((x) => x === v).length - 1) / 2) / (known.length - 1)));
}
export type Row = Posted & { reading: Reading | null; er: number | null; viewsPct: number | null; erPct: number | null };
/** Every posted clip at one checkpoint, ranked within its platform. */
export function rank(posted: readonly Posted[], metrics: Metrics, checkpoint: CheckpointId): Row[] {
  const rows: Row[] = posted.map((p) => { const reading = metrics[keyOf(p)]?.[checkpoint] ?? null; return { ...p, reading, er: reading ? engagementRate(reading) : null, viewsPct: null, erPct: null }; });
  for (const platform of new Set(rows.map((r) => r.platform))) {
    const mine = rows.filter((r) => r.platform === platform), v = percentiles(mine.map((r) => r.reading?.views ?? null)), e = percentiles(mine.map((r) => r.er));
    mine.forEach((r, i) => { r.viewsPct = v[i]; r.erPct = e[i]; });
  }
  return rows;
}
export type StyleScore = { style: number; clips: number; readings: number; views: number; viewsPct: number | null; erPct: number | null; score: number | null };
/** A style's score: the mean of its clips' within-platform ranks (views and engagement weighted alike). */
export function byStyle(rows: readonly Row[]): StyleScore[] {
  const out: StyleScore[] = [];
  for (const style of [...new Set(rows.map((r) => r.style).filter((s): s is number => s !== null))].sort((a, b) => a - b)) {
    const mine = rows.filter((r) => r.style === style), read = mine.filter((r) => r.reading), mean = (xs: (number | null)[]) => { const k = xs.filter((x): x is number => x !== null); return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null; };
    const viewsPct = mean(read.map((r) => r.viewsPct)), erPct = mean(read.map((r) => r.erPct));
    out.push({ style, clips: new Set(mine.map((r) => r.conceptId)).size, readings: read.length, views: read.reduce((n, r) => n + r.reading!.views, 0), viewsPct, erPct, score: viewsPct === null ? null : erPct === null ? viewsPct : (viewsPct + erPct) / 2 });
  }
  return out;
}
/**
 * The recommendation — or the reason there is none yet. Only when every style in `styles` has two clips and
 * every one of those clips has a +72 h reading on at least one platform.
 */
export function recommend(styles: readonly number[], rows72: readonly Row[]): { ready: boolean; text: string } {
  const missing: string[] = [];
  for (const s of styles) {
    const clips = [...new Set(rows72.filter((r) => r.style === s).map((r) => r.conceptId))];
    const read = clips.filter((c) => rows72.some((r) => r.conceptId === c && r.reading));
    if (clips.length < 2) missing.push(`style ${s}: ${clips.length} of 2 clips posted`);
    else if (read.length < 2) missing.push(`style ${s}: ${read.length} of 2 clips have a +72 h reading`);
  }
  if (missing.length) return { ready: false, text: `No recommendation yet — a style is judged on two clips at +72 h. Waiting for: ${missing.join("; ")}.` };
  const scored = byStyle(rows72).filter((s) => s.score !== null).sort((a, b) => b.score! - a.score!);
  const top = scored.slice(0, 2), bottom = scored.slice(-2).filter((s) => !top.includes(s));
  return { ready: true, text: `Double down on styles ${top.map((s) => s.style).join(" and ")} (scores ${top.map((s) => s.score!.toFixed(2)).join(", ")}); drop ${bottom.map((s) => `style ${s.style}`).join(" and ")} (${bottom.map((s) => s.score!.toFixed(2)).join(", ")}). The middle keeps one clip a week until it moves.` };
}

/** The manual sheet: conceptId,platform,checkpoint,views,likes,comments,shares — a header line and comments (#) are skipped. */
export function parseManual(csv: string, now: Date): Metrics {
  const out: Metrics = {};
  for (const line of csv.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !/^conceptId/i.test(l))) {
    const [conceptId, platform, checkpoint, ...n] = line.split(",").map((x) => x.trim());
    const nums = n.slice(0, 4).map((x) => (x === "" ? 0 : Number(x)));
    if (!conceptId || !platform || !CHECKPOINTS.some((c) => c.id === checkpoint) || nums.length < 1 || nums.some((x) => !Number.isFinite(x) || x < 0)) throw new Error(`metrics-manual.csv: “${line}” is not conceptId,platform,checkpoint,views,likes,comments,shares`);
    (out[keyOf({ conceptId, platform })] ??= {})[checkpoint as CheckpointId] = { views: nums[0], likes: nums[1] ?? 0, comments: nums[2] ?? 0, shares: nums[3] ?? 0, at: now.toISOString(), source: "manual" };
  }
  return out;
}

/** What was posted, from the viral ledger: Blotato posts that are live, and Shorts that were uploaded. */
export function postedOf(ledger: any, styleOf: (conceptId: string) => number | null): Posted[] {
  const posts: Posted[] = (ledger.posts ?? []).filter((p: any) => p.status === "published").map((p: any) => ({ conceptId: p.conceptId, style: p.style ?? styleOf(p.conceptId), platform: p.platform, url: p.publicUrl ?? null, publishedAt: p.scheduledTime ?? p.createdAt }));
  const shorts: Posted[] = (ledger.youtube ?? []).filter((y: any) => y.status === "uploaded" && y.videoId).map((y: any) => ({ conceptId: y.conceptId, style: y.style ?? styleOf(y.conceptId), platform: "youtube", url: y.url, publishedAt: y.uploadedAt ?? y.startedAt, videoId: y.videoId }));
  return [...posts, ...shorts];
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}`);
export function boardMd(posted: readonly Posted[], metrics: Metrics, styles: readonly number[], waiting: readonly string[], now: Date): string {
  const lines = [`# Gator styles — scoreboard`, ``, `<!-- Written by scripts/gator/scoreboard.ts. Do not edit: edit docs/gator/metrics-manual.csv and run it again. -->`, ``,
    `As of ${now.toISOString()}. ${posted.length} posts of ${new Set(posted.map((p) => p.conceptId)).size} clips. Ranks are within a platform (0 = last, 100 = first); ER = (likes + comments + shares) / views.`, ``, `**${recommend(styles, rank(posted, metrics, "72h")).text}**`, ``];
  for (const c of CHECKPOINTS) {
    const rows = rank(posted, metrics, c.id);
    if (!rows.some((r) => r.reading)) { lines.push(`## +${c.id}`, ``, `No readings yet.`, ``); continue; }
    lines.push(`## +${c.id} — by style`, ``, `| Style | Clips | Readings | Views (sum) | Views rank | ER rank | Score |`, `| --- | --- | --- | --- | --- | --- | --- |`,
      ...byStyle(rows).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((s) => `| ${s.style} | ${s.clips} | ${s.readings} | ${s.views} | ${pct(s.viewsPct)} | ${pct(s.erPct)} | ${s.score === null ? "—" : s.score.toFixed(2)} |`), ``,
      `## +${c.id} — by clip`, ``, `| Clip | Style | Platform | Views | Likes | Comments | Shares | ER | Avg view (s) | Views rank | ER rank |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
      ...rows.filter((r) => r.reading).sort((a, b) => a.platform.localeCompare(b.platform) || b.reading!.views - a.reading!.views).map((r) => `| ${r.conceptId} | ${r.style ?? "—"} | ${r.platform} | ${r.reading!.views} | ${r.reading!.likes} | ${r.reading!.comments} | ${r.reading!.shares} | ${r.er === null ? "—" : `${(r.er * 100).toFixed(1)}%`} | ${r.reading!.avgViewSec ?? "—"} | ${pct(r.viewsPct)} | ${pct(r.erPct)} |`), ``);
  }
  if (waiting.length) lines.push(`## Waiting for numbers`, ``, `Blotato's API gives no analytics: type these rows into \`docs/gator/metrics-manual.csv\` (conceptId,platform,checkpoint,views,likes,comments,shares) from each app's insights, then run the scoreboard again.`, ``, ...waiting.map((w) => `- ${w}`), ``);
  return lines.join("\n");
}

async function youtubeReading(videoIds: string[]): Promise<Record<string, Omit<Reading, "at" | "source">>> {
  if (!videoIds.length) return {};
  if (!process.env.DATABASE_URL || !process.env.GOOGLE_CLIENT_ID || !process.env.GBP_TOKEN_KEY) throw new Error("YouTube readings use the channel grant: run with --env-file=/home/voiceban/ConstructHUB-live/.env");
  const { pgYoutubeStore } = await import("../../server/youtube/store");
  const { pool } = await import("../../server/db");
  const { getYoutubeAccessToken, getChannelAnalytics } = await import("../../server/youtube/client");
  const deps = { store: pgYoutubeStore(pool) }, out: Record<string, Omit<Reading, "at" | "source">> = {};
  try {
    const token = await getYoutubeAccessToken(deps);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.map(encodeURIComponent).join(",")}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`YouTube answered ${res.status} to videos.list`);
    for (const it of ((await res.json()) as any).items ?? []) out[it.id] = { views: Number(it.statistics?.viewCount ?? 0), likes: Number(it.statistics?.likeCount ?? 0), comments: Number(it.statistics?.commentCount ?? 0), shares: 0, avgViewSec: null };
    const day = (d: Date) => d.toISOString().slice(0, 10);
    for (const row of await getChannelAnalytics({ startDate: day(new Date(Date.now() - 27 * 86400000)), endDate: day(new Date()) }, deps).catch(() => [])) if (out[row.video]) out[row.video].avgViewSec = row.averageViewDuration;
  } finally { await pool.end(); }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["no-fetch"]);
  const now = new Date(), ledger = fs.existsSync(VIRAL_LEDGER) ? JSON.parse(fs.readFileSync(VIRAL_LEDGER, "utf8")) : { posts: [] };
  const { conceptById } = await import("./concepts");
  const styleOf = (id: string): number | null => { try { return conceptById(id).style ?? 6; } catch { return null; } };
  const posted = postedOf(ledger, styleOf), metrics: Metrics = fs.existsSync(METRICS) ? JSON.parse(fs.readFileSync(METRICS, "utf8")) : {};
  // The manual sheet is the record for its platforms: what it holds is copied in (a reading keeps its first timestamp).
  if (fs.existsSync(MANUAL)) for (const [k, v] of Object.entries(parseManual(fs.readFileSync(MANUAL, "utf8"), now))) for (const [c, r] of Object.entries(v)) (metrics[k] ??= {})[c as CheckpointId] = { ...r!, at: metrics[k]?.[c as CheckpointId]?.at ?? r!.at };
  const waiting: string[] = [], wantYt: { p: Posted; c: CheckpointId }[] = [];
  for (const p of posted) for (const c of due(p, metrics[keyOf(p)], now)) (p.platform === "youtube" ? wantYt.push({ p, c }) : waiting.push(`${p.conceptId},${p.platform},${c},  ← ${p.url ?? "(no address)"}`));
  if (wantYt.length && !args.flags["no-fetch"]) {
    const got = await youtubeReading([...new Set(wantYt.map((w) => w.p.videoId!))]);
    for (const w of wantYt) if (got[w.p.videoId!]) (metrics[keyOf(w.p)] ??= {})[w.c] = { ...got[w.p.videoId!], at: now.toISOString(), source: "youtube-api" };
  }
  fs.writeFileSync(METRICS, JSON.stringify(metrics, null, 2) + "\n");
  const { STYLES } = await import("./styles");
  fs.writeFileSync(BOARD, boardMd(posted, metrics, STYLES.map((s) => s.id), waiting, now));
  console.log(`${posted.length} posts; ${wantYt.length} YouTube reading(s) ${args.flags["no-fetch"] ? "skipped" : "taken"}; waiting for ${waiting.length} manual row(s)`);
  for (const w of waiting) console.log(`  needs: ${w}`);
  console.log(`→ ${path.relative(ROOT, BOARD)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
