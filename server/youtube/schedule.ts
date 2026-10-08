/**
 * The YouTube publishing schedule for the walkthrough videos (the CLI is
 * scripts/tutorials/youtube-schedule.ts; the how-to is "Publishing to YouTube"
 * in docs/tutorials/PRODUCER-GUIDE.md).
 *
 * One video a day, at a time of day that changes from day to day, published
 * by YouTube itself: each video is uploaded now as PRIVATE with
 * `status.publishAt`, and YouTube makes it public at that time. Nothing on our
 * side has to be running when a video goes out.
 *
 * The ledger (docs/tutorials/youtube-schedule.json, committed) is the source of
 * truth for "already posted": a help key that has a video id in it is never
 * uploaded again, and a day that has its video is never given another. Nothing
 * here deletes a video, and nothing here invents a status — what the ledger
 * says about a video is either what this tool did or what YouTube answered.
 *
 * Everything takes its clock, its files and its network (`Deps.http`) from the
 * caller, so the tests run against temp dirs and a mocked fetch.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  PUBLISH_AT_MIN_LEAD_MS, YoutubeError, addToPlaylist, getVideoStatus, setThumbnail, updateVideoSnippet, uploadCaption, uploadVideo,
  type Deps, type VideoStatus,
} from "./client";

/* ── Time: one zone, DST-correct ──────────────────────────────────────────── */

export const SCHEDULE_TZ = "America/New_York";
/** One video a day (--per-day 1): the owner's first list of times (Eastern), plus four in between. */
export const ROTATION = ["06:00", "09:00", "12:00", "14:00", "16:00", "18:30", "08:00", "11:00", "15:00", "19:30"] as const;
/**
 * Three a day (the default): one time from each pool. Two a day: morning + late.
 * All Eastern wall-clock times; nothing here ever looks at the host's time zone.
 */
export const SLOT_POOLS = {
  morning: ["06:00", "06:30", "07:00", "08:00", "09:00"],
  midday: ["11:00", "12:00", "12:30", "13:00", "14:00"],
  late: ["15:30", "16:00", "17:00", "18:30", "19:30"],
} as const;
/** Two posts on one day are never closer than this. */
export const MIN_GAP_MINUTES = 180;
export const DEFAULT_PER_DAY = 3;
export const DEFAULT_MAX_UPLOADS = 30;
/** A slot closer than this is not handed out: the upload, captions and YouTube's processing come first. */
export const MIN_SLOT_LEAD_MS = 60 * 60 * 1000;
/** How long after its time a scheduled video may still be private before the reconcile calls it stuck. */
export const PUBLISH_GRACE_MS = 30 * 60 * 1000;
/** YouTube category when youtube.json names none: 26 = Howto & Style. */
export const DEFAULT_CATEGORY = "26";

const DAY_MS = 86_400_000;
const zoneFormat = new Map<string, Intl.DateTimeFormat>();
function partsOf(ms: number, tz: string): Record<string, string> {
  let f = zoneFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", timeZoneName: "short",
    });
    zoneFormat.set(tz, f);
  }
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

export type ZoneTime = { date: string; time: string; weekday: string; abbr: string };
/** An instant as the wall clock of `tz` shows it: date, HH:MM, weekday and the zone's abbreviation (EDT / EST). */
export function zoneTime(at: Date | string | number, tz: string = SCHEDULE_TZ): ZoneTime {
  const p = partsOf(new Date(at).getTime(), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday, abbr: p.timeZoneName };
}

const parseDate = (date: string): [number, number, number] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Error(`"${date}" is not a date (YYYY-MM-DD)`);
  return [+m[1], +m[2], +m[3]];
};
/** Calendar arithmetic on a YYYY-MM-DD date (no clock involved, so no DST involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The instant at which the wall clock of `tz` shows `date` `time`. The zone's
 * offset is asked of Intl for that very day, so 06:00 on the Sunday the clocks
 * go back is 06:00 Eastern Standard, an hour later in UTC than the day before.
 */
export function zonedToUtc(date: string, time: string, tz: string = SCHEDULE_TZ): Date {
  const [y, mo, d] = parseDate(date);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`"${time}" is not a time (HH:MM)`);
  const wall = Date.UTC(y, mo - 1, d, +m[1], +m[2]);
  const offset = (ms: number) => {
    const p = partsOf(ms, tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t);
}

/** "2026-10-09 09:00 EDT (Friday)" — how the ledger and the tables print a time. */
export function easternLabel(at: Date | string, tz: string = SCHEDULE_TZ): string {
  const z = zoneTime(at, tz);
  return `${z.date} ${z.time} ${z.abbr} (${z.weekday})`;
}

const minutesOf = (time: string) => +time.slice(0, 2) * 60 + +time.slice(3, 5);

/**
 * The times of day for one calendar date — from the date and `perDay` alone,
 * so the same date gets the same times whoever asks and whenever.
 *
 * Every list of times is split in two by position (even places / odd places).
 * A date uses the half of its own parity (days since 1970), which is why the
 * same slot can never have the same time two days running; a hash of the date
 * then picks among what is left, so the sequence has no period to spot.
 *
 *   3 (default): one morning, one midday and one late time, each from its own
 *      pool (SLOT_POOLS); of the combinations for that date only those with
 *      at least MIN_GAP_MINUTES between neighbours are candidates.
 *   2: morning + late.
 *   1: one time from ROTATION, the owner's original list across the whole day.
 */
export function timesForDate(date: string, perDay: number = DEFAULT_PER_DAY): string[] {
  const [y, m, d] = parseDate(date);
  const parity = (((Math.round(Date.UTC(y, m - 1, d) / DAY_MS)) % 2) + 2) % 2;
  const hash = createHash("sha256").update(`constructhub-youtube:${perDay}:${date}`).digest().readUInt32BE(0);
  const half = (pool: readonly string[]) => pool.filter((_, i) => i % 2 === parity);
  if (perDay === 1) { const h = half(ROTATION); return [h[hash % h.length]]; }
  if (perDay !== 2 && perDay !== 3) throw new Error("--per-day is 1, 2 or 3");
  const pools = perDay === 3 ? [SLOT_POOLS.morning, SLOT_POOLS.midday, SLOT_POOLS.late] : [SLOT_POOLS.morning, SLOT_POOLS.late];
  let combos: string[][] = [[]];
  for (const pool of pools) combos = combos.flatMap((c) => half(pool).map((t) => [...c, t]));
  combos = combos.filter((c) => c.every((t, i) => i === 0 || minutesOf(t) - minutesOf(c[i - 1]) >= MIN_GAP_MINUTES));
  return combos[hash % combos.length];
}

/* ── Ledger ───────────────────────────────────────────────────────────────── */

/** "ok" | "pending" | "skipped" | "failed: <why>" */
export type StepResult = string;
export type LedgerEntry = {
  helpKey: string;
  title: string;
  videoId: string | null;
  url: string | null;
  /** scheduled: uploaded private, YouTube publishes it at publishAt. published: public. failed: see `note`. */
  status: "scheduled" | "published" | "failed";
  /** When it goes (or went) public — UTC. */
  publishAt: string | null;
  /** The same instant in America/New_York, for people. */
  publishAtEastern: string | null;
  uploadedAt: string | null;
  /** sha256 of the mp4 that was uploaded (null when that was not recorded at the time). */
  sha256: string | null;
  captions: StepResult;
  thumbnail: StepResult;
  playlist: StepResult;
  /**
   * The description that was sent to YouTube (built by ./description.ts), its length in characters,
   * its sha256 and the tags that went with it. Absent on a video posted before the builder existed
   * and not yet rewritten with --update-descriptions.
   */
  description?: string;
  descriptionLength?: number;
  descriptionSha256?: string;
  tags?: string[];
  /** When --update-descriptions last rewrote the title, description and tags on YouTube. */
  descriptionUpdatedAt?: string;
  note?: string;
  /** Earlier uploads of this key that `--replace` superseded. They are still on YouTube until someone deletes them by hand. */
  replaced?: { videoId: string; url: string; sha256: string | null; replacedAt: string }[];
  /** Last time `--reconcile` asked YouTube about it. */
  checkedAt?: string;
};
export type Ledger = { version: 1; timezone: string; channelId: string | null; videos: LedgerEntry[] };

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export function readLedger(file: string): Ledger {
  if (!fs.existsSync(file)) return { version: 1, timezone: SCHEDULE_TZ, channelId: null, videos: [] };
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (j?.version !== 1 || !Array.isArray(j.videos)) throw new Error(`${file} is not a schedule ledger (version 1)`);
  const seen = new Set<string>();
  for (const v of j.videos) {
    if (typeof v?.helpKey !== "string" || seen.has(v.helpKey)) throw new Error(`${file}: every entry needs its own helpKey (${v?.helpKey})`);
    seen.add(v.helpKey);
  }
  return { version: 1, timezone: j.timezone ?? SCHEDULE_TZ, channelId: j.channelId ?? null, videos: j.videos };
}

/** Written whole, to a temp file first, so an interrupted run leaves either the old ledger or the new one. */
export function writeLedger(file: string, ledger: Ledger): void {
  const videos = [...ledger.videos].sort((a, b) => (a.publishAt ?? "9").localeCompare(b.publishAt ?? "9") || a.helpKey.localeCompare(b.helpKey));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...ledger, videos }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export type Track = { name: string; keys: string[] };
/**
 * The curated learning order, as ordered tracks (one per area of the product):
 * `{ "tracks": [{ "name": "estimates", "keys": ["crm-pricebook", …] }, …] }`.
 * A plain `{ "order": [...] }` is one track. A missing file is no tracks.
 */
export function readOrder(file: string): Track[] {
  if (!fs.existsSync(file)) return [];
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const raw: unknown = Array.isArray(j) ? [{ name: "all", keys: j }] : Array.isArray(j?.tracks) ? j.tracks : Array.isArray(j?.order) ? [{ name: "all", keys: j.order }] : null;
  if (!Array.isArray(raw) || raw.some((t) => typeof t?.name !== "string" || !Array.isArray(t.keys) || t.keys.some((k: unknown) => typeof k !== "string")))
    throw new Error(`${file} must be { "tracks": [{ "name": …, "keys": [helpKey, …] }, …] }`);
  const seen = new Set<string>();
  return (raw as Track[]).map((t) => ({ name: t.name, keys: t.keys.filter((k) => !seen.has(k) && !!seen.add(k)) }));
}

/** The track a key belongs to; a key in no track is in "other" (which comes last, alphabetically inside). */
export const trackOf = (helpKey: string, tracks: readonly Track[]): string => tracks.find((t) => t.keys.includes(helpKey))?.name ?? "other";

/**
 * The posting order: inside a track, the track's own (learning) order; across
 * tracks, one from each in turn, so the three videos of a day come from three
 * areas whenever three areas have something ready. `after` is the track of the
 * last video already scheduled: the turn carries on from the track after it,
 * so a new run does not start every time with the first track.
 */
export function interleave<T extends { helpKey: string }>(items: readonly T[], tracks: readonly Track[], after?: string | null): T[] {
  const names = [...tracks.map((t) => t.name), "other"];
  const lanes = names.map((name) => {
    const keys = tracks.find((t) => t.name === name)?.keys ?? [];
    return items.filter((i) => trackOf(i.helpKey, tracks) === name)
      .sort((a, b) => (name === "other" ? 0 : keys.indexOf(a.helpKey) - keys.indexOf(b.helpKey)) || a.helpKey.localeCompare(b.helpKey));
  });
  const out: T[] = [];
  for (let i = after ? names.indexOf(after) + 1 : 0; out.length < items.length; i++) {
    const next = lanes[i % lanes.length].shift();
    if (next) out.push(next);
  }
  return out;
}

/* ── What is ready to post ────────────────────────────────────────────────── */

export type Candidate = {
  helpKey: string;
  dir: string;
  mp4: string;
  srt: string;
  /** null when there is no thumbnail.jpg yet: the video still goes out, its thumbnail stays "pending". */
  thumbnail: string | null;
  sha256: string;
  title: string;
  /** youtube.json as mux.ts wrote it. */
  meta: Record<string, any>;
};
export type Skipped = { helpKey: string; dir: string; reason: string };

const sha256File = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Every `<outDir>/<helpKey>/` that can be posted. A video is eligible only when
 * walkthrough.mp4, captions.srt and youtube.json are all there, the mp4 is the
 * encode youtube.json describes, AND its manifest is in `manifestDir`
 * (shared/help/videos of the checkout the tool runs from) — that is, the video
 * has been merged and the in-app player can show the same thing the YouTube
 * description links to.
 *
 * The same key in two out-dirs: the copy whose hash is the one in the manifest
 * wins, otherwise the newest file.
 */
export function findCandidates(outDirs: readonly string[], manifestDir: string, opts: { includeUnmerged?: boolean } = {}): { eligible: Candidate[]; skipped: Skipped[] } {
  const found = new Map<string, (Candidate & { mtime: number; matchesManifest: boolean })[]>();
  const skipped: Skipped[] = [];
  for (const out of outDirs) {
    if (!fs.existsSync(out) || !fs.statSync(out).isDirectory()) continue;
    for (const helpKey of fs.readdirSync(out).sort()) {
      const dir = path.join(out, helpKey);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(helpKey) || !fs.statSync(dir).isDirectory()) continue;
      const skip = (reason: string) => { skipped.push({ helpKey, dir, reason }); };
      const metaFile = path.join(dir, "youtube.json");
      if (!fs.existsSync(metaFile)) { skip("no youtube.json (not produced for YouTube yet)"); continue; }
      let meta: Record<string, any>;
      try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch { skip("youtube.json is not valid JSON"); continue; }
      if (meta?.helpKey !== helpKey) { skip(`youtube.json is for "${meta?.helpKey}"`); continue; }
      if (typeof meta.title !== "string" || !meta.title.trim()) { skip("youtube.json has no title"); continue; }
      if (meta.madeForKids === true) { skip("youtube.json says madeForKids: true — these videos are never marked made for kids"); continue; }
      const mp4 = path.join(dir, path.basename(String(meta.files?.video ?? "walkthrough.mp4")));
      const srt = path.join(dir, path.basename(String(meta.files?.captions ?? "captions.srt")));
      const jpg = path.join(dir, path.basename(String(meta.files?.thumbnail ?? "thumbnail.jpg")));
      if (!fs.existsSync(mp4)) { skip(`${path.basename(mp4)} is missing`); continue; }
      if (!fs.existsSync(srt)) { skip(`${path.basename(srt)} is missing`); continue; }
      const sha256 = sha256File(mp4);
      if (typeof meta.video?.sha256 === "string" && meta.video.sha256 !== sha256) { skip("walkthrough.mp4 is not the encode youtube.json describes — run mux.ts again"); continue; }
      const manifestFile = path.join(manifestDir, `${helpKey}.json`);
      let matchesManifest = false;
      if (fs.existsSync(manifestFile)) {
        try { matchesManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"))?.video?.sha256 === sha256; } catch { /* an unreadable manifest matches nothing */ }
      } else if (!opts.includeUnmerged) { skip(`not merged yet: no ${path.join(path.basename(path.dirname(manifestDir)), path.basename(manifestDir), `${helpKey}.json`)} in this checkout`); continue; }
      const list = found.get(helpKey) ?? [];
      list.push({ helpKey, dir, mp4, srt, thumbnail: fs.existsSync(jpg) ? jpg : null, sha256, title: meta.title.trim(), meta, mtime: fs.statSync(mp4).mtimeMs, matchesManifest });
      found.set(helpKey, list);
    }
  }
  const eligible: Candidate[] = [];
  for (const [helpKey, list] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => Number(b.matchesManifest) - Number(a.matchesManifest) || b.mtime - a.mtime);
    const [best, ...others] = list;
    for (const o of others) skipped.push({ helpKey, dir: o.dir, reason: `another copy is used: ${best.dir}` });
    const { mtime: _mtime, matchesManifest: _match, ...candidate } = best;
    eligible.push(candidate);
  }
  return { eligible, skipped };
}

/* ── Slots ────────────────────────────────────────────────────────────────── */

export type Planned = {
  helpKey: string;
  title: string;
  candidate: Candidate;
  /** UTC ISO, whole seconds. */
  publishAt: string;
  date: string;
  time: string;
  weekday: string;
  abbr: string;
  /** Set by --replace: the video id this upload supersedes. */
  replaces?: string;
};
export type Plan = {
  planned: Planned[];
  /** Keys that already have a video and are left alone. */
  alreadyPosted: string[];
  /** Posted keys whose mp4 on disk is no longer the file that was uploaded. Reported, never re-uploaded without --replace. */
  hashChanged: { helpKey: string; videoId: string; uploadedSha256: string; fileSha256: string; dir: string }[];
  /**
   * Posted keys whose MERGED MASTER (the manifest in shared/help/videos) is no longer the file that
   * was uploaded: the in-app video was re-recorded. `pending` = YouTube has not published the old
   * cut yet, so it will go public at `publishAt` unless `--replace` is run (and the old one deleted
   * by hand). `fileReady` = the new master is in an out-dir, so `--replace` can run now.
   */
  masterChanged: { helpKey: string; videoId: string; status: LedgerEntry["status"]; pending: boolean; publishAt: string | null; uploadedSha256: string; manifestSha256: string; fileReady: boolean }[];
  /** Eligible videos that wait for the owner's approval (`youtube.hold` on the help entry): never planned unless released. */
  held: string[];
  problems: string[];
};

/** `shared/help/videos/<helpKey>.json` → the sha256 of the master it describes (null: no manifest, or unreadable). */
export const manifestShaIn = (manifestDir: string) => (helpKey: string): string | null => {
  try { const s = JSON.parse(fs.readFileSync(path.join(manifestDir, `${helpKey}.json`), "utf8"))?.video?.sha256; return typeof s === "string" ? s : null; } catch { return null; }
};
/** One line per changed master, for the dry run. The first words are what an operator greps for. */
export function masterChangedLines(plan: Pick<Plan, "masterChanged">, tz: string = SCHEDULE_TZ): string[] {
  return plan.masterChanged.map((m) => {
    const what = `${m.helpKey}: master changed since upload — run --replace ${m.helpKey}`;
    const when = m.pending
      ? ` (${m.videoId} is STILL SCHEDULED for ${m.publishAt ? easternLabel(m.publishAt, tz) : "a time YouTube holds"}: the OLD cut goes public then unless it is replaced; --replace keeps that slot and names the old video to delete by hand)`
      : ` (${m.videoId} is public with the old cut; --replace posts the new one in the next free slot and names the old video to delete by hand)`;
    return `${m.pending ? "!!!! " : "! "}${what}${when}${m.fileReady ? "" : ` — the new master (${m.manifestSha256.slice(0, 8)}) is not in the out-dirs yet: fetch or produce it first`}`;
  });
}

const entryDate = (e: LedgerEntry, tz: string): ZoneTime | null => (e.videoId && e.publishAt ? zoneTime(e.publishAt, tz) : null);

/**
 * Give every eligible, not-yet-posted video a day and a time.
 *
 * Slots already in the ledger are never touched. New videos go, track by track
 * in turn (see `interleave`), into the free slots from `start` on — by default
 * the later of tomorrow and the last date in the ledger (when that day still
 * has a free slot; otherwise the day after) — `perDay` to a day. "Tomorrow" and every date here are Eastern calendar
 * dates worked out from the UTC instant `now`; the host's zone plays no part.
 * A key that is in the order file but not produced yet simply is not here: it
 * keeps its place in its track and takes the next free slot when it arrives.
 */
export function planSchedule(input: {
  ledger: Ledger; candidates: readonly Candidate[]; tracks: readonly Track[]; now: Date;
  start?: string; perDay?: number; replace?: readonly string[]; tz?: string;
  /** Keys held for the owner's approval (the registry's `heldHelpKeys()`), and the ones a person released for this run. */
  held?: readonly string[]; release?: readonly string[];
  /** The merged master of a key (see `manifestShaIn`): lets the plan tell a re-recorded video from the one that was uploaded. */
  manifestSha?: (helpKey: string) => string | null;
}): Plan {
  const tz = input.tz ?? SCHEDULE_TZ, perDay = input.perDay ?? DEFAULT_PER_DAY, now = input.now.getTime();
  if (![1, 2, 3].includes(perDay)) throw new Error("--per-day is 1, 2 or 3");
  const replace = new Set(input.replace ?? []);
  const entries = new Map(input.ledger.videos.map((e) => [e.helpKey, e]));
  const plan: Plan = { planned: [], alreadyPosted: [], hashChanged: [], masterChanged: [], held: [], problems: [] };
  const release = new Set(input.release ?? []), held = new Set((input.held ?? []).filter((k) => !release.has(k)));
  for (const k of release) if (!(input.held ?? []).includes(k)) plan.problems.push(`--release ${k}: that key is not held (nothing to release)`);
  const used = new Map<string, string[]>();
  const use = (date: string, time: string) => { used.set(date, [...(used.get(date) ?? []), time]); };
  for (const e of input.ledger.videos) { const z = entryDate(e, tz); if (z) use(z.date, z.time); }

  const fresh: { c: Candidate; replaces?: string }[] = [];
  for (const c of input.candidates) {
    const e = entries.get(c.helpKey);
    // Held for the owner: nothing of it is uploaded — not a first upload, not a replacement — until it is released.
    if (held.has(c.helpKey) && (!e?.videoId || replace.has(c.helpKey))) {
      plan.held.push(c.helpKey);
      if (replace.has(c.helpKey)) plan.problems.push(`--replace ${c.helpKey}: held for owner approval — add --release ${c.helpKey}`);
      continue;
    }
    if (!e?.videoId) { fresh.push({ c }); continue; }
    if (replace.has(c.helpKey)) {
      const merged = input.manifestSha?.(c.helpKey) ?? null;
      if (merged && merged !== c.sha256) { plan.problems.push(`--replace ${c.helpKey}: the mp4 in ${c.dir} (${c.sha256.slice(0, 8)}) is not the merged master (${merged.slice(0, 8)}) — the video in the app and the one on YouTube must be the same file`); plan.alreadyPosted.push(c.helpKey); continue; }
      if (e.sha256 === c.sha256 && e.status !== "failed") { plan.problems.push(`--replace ${c.helpKey}: the file on disk is the one already uploaded (${e.videoId}); nothing to replace`); plan.alreadyPosted.push(c.helpKey); continue; }
      const keepsSlot = e.status === "scheduled" && e.publishAt && Date.parse(e.publishAt) >= now + MIN_SLOT_LEAD_MS;
      if (keepsSlot) {
        const z = zoneTime(e.publishAt!, tz);
        plan.planned.push({ helpKey: c.helpKey, title: c.title, candidate: c, publishAt: e.publishAt!, ...z, replaces: e.videoId });
      } else fresh.push({ c, replaces: e.videoId });
      continue;
    }
    plan.alreadyPosted.push(c.helpKey);
    if (e.sha256 && e.sha256 !== c.sha256) plan.hashChanged.push({ helpKey: c.helpKey, videoId: e.videoId, uploadedSha256: e.sha256, fileSha256: c.sha256, dir: c.dir });
  }
  for (const k of replace) if (!input.candidates.some((c) => c.helpKey === k)) plan.problems.push(`--replace ${k}: no eligible video with that key in the out-dirs`);
  // A re-recorded video: the merged master is not what YouTube holds. (A key that is not in the ledger —
  // held, or simply not scheduled yet — has nothing to compare: its next upload takes the new master.)
  if (input.manifestSha) for (const e of input.ledger.videos) {
    if (!e.videoId || !e.sha256 || replace.has(e.helpKey)) continue;
    const merged = input.manifestSha(e.helpKey);
    if (!merged || merged === e.sha256) continue;
    plan.masterChanged.push({
      helpKey: e.helpKey, videoId: e.videoId, status: e.status, pending: e.status === "scheduled" && (!e.publishAt || Date.parse(e.publishAt) > now), publishAt: e.publishAt,
      uploadedSha256: e.sha256, manifestSha256: merged, fileReady: input.candidates.some((c) => c.helpKey === e.helpKey && c.sha256 === merged),
    });
  }
  // …and then the plain "the file on disk differs" line would say the same thing twice.
  plan.hashChanged = plan.hashChanged.filter((h) => !plan.masterChanged.some((m) => m.helpKey === h.helpKey));

  const today = zoneTime(now, tz).date;
  let latest = "";
  for (const d of used.keys()) if (d > latest) latest = d;
  let date = input.start ? (parseDate(input.start), input.start) : [addDays(today, 1), latest].sort().pop()!; // the last day in the ledger is looked at again: it may not be full
  if (date < today) { plan.problems.push(`--start ${date} is in the past; starting today (${today})`); date = today; }

  const last = input.ledger.videos.filter((e) => e.videoId && e.publishAt).sort((a, b) => a.publishAt!.localeCompare(b.publishAt!)).pop();
  const queue = interleave(fresh.map((f) => ({ helpKey: f.c.helpKey, ...f })), input.tracks, last ? trackOf(last.helpKey, input.tracks) : null);
  for (let guard = 0; queue.length && guard < 3660; guard++, date = addDays(date, 1)) {
    const taken = used.get(date) ?? [];
    let free = perDay - taken.length;
    for (const time of timesForDate(date, perDay)) {
      if (free <= 0 || !queue.length) break;
      // a time already used that day, or one too close to a post made under another --per-day, is passed over
      if (taken.some((t) => Math.abs(minutesOf(t) - minutesOf(time)) < (perDay === 1 ? 1 : MIN_GAP_MINUTES))) continue;
      const at = zonedToUtc(date, time, tz);
      if (at.getTime() < now + MIN_SLOT_LEAD_MS) continue; // only ever today's, with --start
      const next = queue.shift()!;
      use(date, time);
      free--;
      plan.planned.push({
        helpKey: next.c.helpKey, title: next.c.title, candidate: next.c, publishAt: at.toISOString().replace(".000Z", "Z"),
        ...zoneTime(at, tz), ...(next.replaces ? { replaces: next.replaces } : {}),
      });
    }
  }
  plan.planned.sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  return plan;
}

/* ── Uploading ────────────────────────────────────────────────────────────── */

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);
const isQuota = (e: unknown) => e instanceof YoutubeError && e.code === "quota";
const stopsTheRun = (e: unknown) => e instanceof YoutubeError && ["quota", "needs_reconnect", "not_connected", "not_configured"].includes(e.code);
/**
 * "pending" means only that there was no thumbnail.jpg to send yet. A refusal by YouTube is a
 * failure and is reported as one: the channel has been phone-verified since 2026-10-08 (before
 * that thumbnails.set answered 403 for every video), so a 403 now is something to look into.
 * Either way `--retry-thumbnails` tries again every entry whose thumbnail is not "ok".
 */
async function trySetThumbnail(videoId: string, jpg: string | null, deps: Deps): Promise<{ result: StepResult; error?: unknown }> {
  if (!jpg) return { result: "pending" };
  try { await setThumbnail(videoId, jpg, deps); return { result: "ok" }; }
  catch (e) {
    const status = e instanceof YoutubeError ? e.extra?.httpStatus : undefined;
    return { result: `failed: ${why(e)}${status === 403 ? " — is the channel still allowed custom thumbnails?" : ""}`, error: e };
  }
}

/** What YouTube shows for a video besides the picture: built by ./description.ts (see ./description-sources.ts). */
export type VideoText = { title: string; description: string; tags: string[] };
/** `candidate` is the production being uploaded; it is absent when an already posted video is described again. */
export type Describe = (helpKey: string, candidate?: Candidate) => Promise<VideoText | null> | VideoText | null;
const textFields = (t: VideoText) => ({
  description: t.description, descriptionLength: t.description.length,
  descriptionSha256: createHash("sha256").update(t.description).digest("hex"), tags: [...t.tags],
});

export type RunResult = {
  uploaded: { helpKey: string; videoId: string; publishAt: string }[];
  /** Why the run ended before the plan did (quota, a failed upload, --max). Null when it did everything. */
  stopped: string | null;
  /** Captions, thumbnails or playlist entries YouTube refused: the videos are scheduled all the same. */
  warnings: string[];
  /** Old videos that --replace superseded: delete them by hand in YouTube Studio. */
  deleteByHand: { helpKey: string; videoId: string; url: string; stillScheduledFor: string | null }[];
};

/**
 * Upload the planned videos, at most `max` of them: the video (private, with
 * its publish time), then captions, thumbnail and playlist. The ledger is
 * written after the upload and again after each of the three, so stopping the
 * process at any point loses nothing that reached YouTube.
 *
 * A failed upload ends the run (the next video must not jump into its day).
 * A failed caption, thumbnail or playlist is recorded on the entry and the
 * run goes on — except when YouTube says the day's quota is used up.
 */
export async function runUploads(o: {
  ledgerFile: string; planned: readonly Planned[]; deps: Deps; max?: number; category?: string;
  log?: (line: string) => void; tz?: string;
  /**
   * The title, description and tags to send (the CLI passes the description builder, so every
   * upload gets the long description). Without it, youtube.json's own are sent as they are.
   */
  describe?: Describe;
}): Promise<RunResult> {
  const log = o.log ?? (() => undefined), tz = o.tz ?? SCHEDULE_TZ, max = o.max ?? DEFAULT_MAX_UPLOADS;
  const now = () => new Date((o.deps.now ?? Date.now)());
  const out: RunResult = { uploaded: [], stopped: null, warnings: [], deleteByHand: [] };
  const grant = await o.deps.store.load();
  if (!grant?.refreshToken) throw new YoutubeError("not_connected", "The YouTube channel is not connected. Connect it on /admin/youtube.", 409);
  const ledger = readLedger(o.ledgerFile);
  ledger.channelId ??= grant.channelId;
  if (ledger.channelId !== grant.channelId) throw new Error(`The ledger is for channel ${ledger.channelId}; the connection is for ${grant.channelId}. Nothing was uploaded.`);

  for (const p of o.planned) {
    if (out.uploaded.length >= max) { out.stopped = `--max ${max} reached; ${o.planned.length - out.uploaded.length} left for the next run`; break; }
    const c = p.candidate, m = c.meta;
    const prior = ledger.videos.find((e) => e.helpKey === p.helpKey);
    if (prior?.videoId && prior.videoId !== p.replaces) { log(`  = ${p.helpKey}: already posted as ${prior.videoId} — skipped`); continue; }
    if (m.channel?.id && m.channel.id !== grant.channelId) { out.stopped = `${p.helpKey}: youtube.json names channel ${m.channel.id}, the connection is ${grant.channelId}`; break; }
    if (sha256File(c.mp4) !== c.sha256) { out.stopped = `${p.helpKey}: ${c.mp4} changed while the run was going`; break; }
    if (Date.parse(p.publishAt) < now().getTime() + PUBLISH_AT_MIN_LEAD_MS) { out.stopped = `${p.helpKey}: its time (${easternLabel(p.publishAt, tz)}) is too close now — run again for a new plan`; break; }

    let text: VideoText | null = null;
    if (o.describe) {
      try { text = await o.describe(p.helpKey, c); } catch (e) { out.stopped = `${p.helpKey}: its description could not be built — ${why(e)}`; break; }
      if (!text) { out.stopped = `${p.helpKey}: no step script or narration to build its description from`; break; }
    }
    const title = text?.title ?? c.title;
    log(`  ↑ ${p.helpKey} → ${easternLabel(p.publishAt, tz)}${text ? ` · description ${text.description.length} characters` : ""}`);
    let up;
    try {
      up = await uploadVideo({
        filePath: c.mp4, title, description: text?.description ?? (typeof m.description === "string" ? m.description : ""),
        tags: text?.tags ?? (Array.isArray(m.tags) ? m.tags.map(String) : undefined),
        categoryId: String(o.category ?? m.categoryId ?? DEFAULT_CATEGORY),
        madeForKids: false, defaultLanguage: typeof m.defaultLanguage === "string" ? m.defaultLanguage : "en",
        privacyStatus: "private", publishAt: p.publishAt,
      }, o.deps);
    } catch (e) {
      if (!prior?.videoId && !stopsTheRun(e)) {
        // No video id came back, so the key stays postable: the next run plans it again.
        const failed: LedgerEntry = {
          helpKey: p.helpKey, title, videoId: null, url: null, status: "failed", publishAt: null, publishAtEastern: null,
          uploadedAt: null, sha256: c.sha256, captions: "pending", thumbnail: "pending", playlist: "pending",
          note: `upload failed ${now().toISOString()}: ${why(e)} — check YouTube Studio for a stray upload before running again`,
        };
        ledger.videos = [...ledger.videos.filter((e2) => e2.helpKey !== p.helpKey), failed];
        writeLedger(o.ledgerFile, ledger);
      }
      out.stopped = `${p.helpKey}: upload failed — ${why(e)}`;
      break;
    }

    const entry: LedgerEntry = {
      helpKey: p.helpKey, title, videoId: up.videoId, url: watchUrl(up.videoId), status: "scheduled",
      publishAt: p.publishAt, publishAtEastern: easternLabel(p.publishAt, tz), uploadedAt: now().toISOString(), sha256: c.sha256,
      captions: "pending", thumbnail: "pending", playlist: "pending",
      ...(text ? textFields(text) : {}),
    };
    const notes: string[] = [];
    if (up.privacyStatus !== "private") notes.push(`YouTube answered privacy "${up.privacyStatus}" for a scheduled upload`);
    if (!up.publishAt) notes.push("YouTube's answer carried no publishAt — run --reconcile to see whether the schedule took");
    else if (Date.parse(up.publishAt) !== Date.parse(p.publishAt)) notes.push(`YouTube answered publishAt ${up.publishAt}`);
    if (prior?.videoId) {
      entry.replaced = [...(prior.replaced ?? []), { videoId: prior.videoId, url: watchUrl(prior.videoId), sha256: prior.sha256, replacedAt: entry.uploadedAt! }];
      const still = prior.status === "scheduled" ? prior.publishAt : null;
      out.deleteByHand.push({ helpKey: p.helpKey, videoId: prior.videoId, url: watchUrl(prior.videoId), stillScheduledFor: still });
      notes.push(`replaces ${prior.videoId}, which is still on YouTube${still ? " AND STILL SCHEDULED" : ""} — delete it by hand in YouTube Studio`);
    } else if (prior?.replaced) entry.replaced = prior.replaced;
    if (notes.length) entry.note = notes.join("; ");
    const save = () => { ledger.videos = [...ledger.videos.filter((e) => e.helpKey !== p.helpKey), entry]; writeLedger(o.ledgerFile, ledger); };
    save();
    out.uploaded.push({ helpKey: p.helpKey, videoId: up.videoId, publishAt: p.publishAt });

    let fatal: unknown = null;
    try { await uploadCaption(up.videoId, c.srt, typeof m.defaultLanguage === "string" ? m.defaultLanguage : "en", o.deps); entry.captions = "ok"; }
    catch (e) { entry.captions = `failed: ${why(e)}`; if (stopsTheRun(e)) fatal = e; }
    save();
    if (!fatal) {
      const t = await trySetThumbnail(up.videoId, c.thumbnail, o.deps);
      entry.thumbnail = t.result;
      if (stopsTheRun(t.error)) fatal = t.error;
      save();
    }
    if (!fatal) {
      if (typeof m.playlist === "string" && m.playlist.trim()) {
        try { await addToPlaylist(up.videoId, m.playlist, o.deps, { privacyStatus: "public" }); entry.playlist = "ok"; }
        catch (e) { entry.playlist = `failed: ${why(e)}`; if (stopsTheRun(e)) fatal = e; }
      } else entry.playlist = "skipped";
      save();
    }
    log(`    ${up.videoId}  captions ${entry.captions} · thumbnail ${entry.thumbnail} · playlist ${entry.playlist}`);
    for (const [what, r] of [["captions", entry.captions], ["thumbnail", entry.thumbnail], ["playlist", entry.playlist]] as const)
      if (r.startsWith("failed")) out.warnings.push(`${p.helpKey} (${up.videoId}): ${what} ${r}`);
    if (fatal) { out.stopped = `${p.helpKey}: ${isQuota(fatal) ? "YouTube's daily quota is used up" : why(fatal)} — the video is uploaded and scheduled; finish it with --retry-thumbnails / in YouTube Studio`; break; }
  }
  return out;
}

/** Where a key's thumbnail.jpg is, looking through the out-dirs (the newest copy when there are several). */
export function findThumbnail(helpKey: string, outDirs: readonly string[]): string | null {
  const hits = outDirs.map((d) => path.join(d, helpKey, "thumbnail.jpg")).filter((f) => fs.existsSync(f));
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] ?? null;
}

export type ThumbnailRetry = { helpKey: string; videoId: string; file: string | null; result: StepResult | "would try" };
/**
 * Try thumbnails.set again for every entry whose thumbnail is not "ok" (no
 * file at upload time, or refused). With `go` false it only says what it
 * would send. The ledger is written after each.
 */
export async function retryThumbnails(o: { ledgerFile: string; outDirs: readonly string[]; deps: Deps; go: boolean; files?: Record<string, string> }): Promise<ThumbnailRetry[]> {
  const ledger = readLedger(o.ledgerFile);
  const out: ThumbnailRetry[] = [];
  for (const e of ledger.videos) {
    if (!e.videoId || e.thumbnail === "ok") continue;
    const file = o.files?.[e.helpKey] ?? findThumbnail(e.helpKey, o.outDirs);
    if (!file) { out.push({ helpKey: e.helpKey, videoId: e.videoId, file: null, result: e.thumbnail }); continue; }
    if (!o.go) { out.push({ helpKey: e.helpKey, videoId: e.videoId, file, result: "would try" }); continue; }
    const t = await trySetThumbnail(e.videoId, file, o.deps);
    e.thumbnail = t.result;
    writeLedger(o.ledgerFile, ledger);
    out.push({ helpKey: e.helpKey, videoId: e.videoId, file, result: t.result });
    if (stopsTheRun(t.error)) break;
  }
  return out;
}

/* ── Rewriting the text of videos that are already up ─────────────────────── */

export type DescriptionUpdate = {
  helpKey: string; videoId: string; title: string; oldTitle: string;
  /** Characters and UTF-8 bytes of the new description, and how it starts. */
  length: number; bytes: number; first: string; tags: number;
  description: string;
  /** "would update" (dry run) · "updated" · "unchanged" (the ledger already has this very text) · "no source: …" · "failed: …" */
  result: string;
};
/**
 * Build the title, description and tags again for videos that are already posted or scheduled and
 * — with `go` — send them (videos.update, part=snippet; the video itself, its schedule and its
 * status are not touched). `keys` narrows it; without keys it is every video in the ledger.
 * A video whose ledger entry already holds this exact text and title is left alone.
 * Dry by default: with `go` false nothing is sent and the ledger is not written.
 */
export async function updateDescriptions(o: { ledgerFile: string; keys?: readonly string[]; describe: Describe; deps?: Deps; go: boolean }): Promise<DescriptionUpdate[]> {
  const ledger = readLedger(o.ledgerFile);
  const unknown = (o.keys ?? []).filter((k) => !ledger.videos.some((e) => e.helpKey === k && e.videoId));
  if (unknown.length) throw new Error(`Not posted (no video id in the ledger): ${unknown.join(", ")}`);
  if (o.go && !o.deps) throw new Error("updateDescriptions: --go needs the YouTube connection");
  const out: DescriptionUpdate[] = [];
  for (const e of ledger.videos) {
    if (!e.videoId || (o.keys?.length && !o.keys.includes(e.helpKey))) continue;
    const row = (t: VideoText | null, result: string): DescriptionUpdate => ({
      helpKey: e.helpKey, videoId: e.videoId!, title: t?.title ?? e.title, oldTitle: e.title, length: t?.description.length ?? 0,
      bytes: t ? Buffer.byteLength(t.description, "utf8") : 0, first: (t?.description ?? "").slice(0, 200).replace(/\s+/g, " "), tags: t?.tags.length ?? 0,
      description: t?.description ?? "", result,
    });
    let text: VideoText | null;
    try { text = await o.describe(e.helpKey); } catch (err) { out.push(row(null, `no source: ${why(err)}`)); continue; }
    if (!text) { out.push(row(null, "no source: no step script or narration for this key in the checkouts")); continue; }
    const fields = textFields(text);
    if (e.descriptionSha256 === fields.descriptionSha256 && e.title === text.title && JSON.stringify(e.tags ?? []) === JSON.stringify(fields.tags)) { out.push(row(text, "unchanged")); continue; }
    if (!o.go) { out.push(row(text, "would update")); continue; }
    try {
      await updateVideoSnippet(e.videoId, text, o.deps!);
      Object.assign(e, { title: text.title, ...fields, descriptionUpdatedAt: new Date((o.deps!.now ?? Date.now)()).toISOString() });
      writeLedger(o.ledgerFile, ledger);
      out.push(row(text, "updated"));
    } catch (err) {
      out.push(row(text, `failed: ${why(err)}`));
      if (stopsTheRun(err)) break;
    }
  }
  return out;
}

/* ── Reconcile: what YouTube really says ──────────────────────────────────── */

export type Reconciled = {
  helpKey: string; videoId: string; ledgerStatus: LedgerEntry["status"]; status: LedgerEntry["status"];
  youtube: VideoStatus | null;
  verdict: string;
  /** Something a person has to look at. */
  loud: boolean;
};

/**
 * Ask YouTube about every entry that has a video (videos.list — read-only, one
 * quota unit each) and bring the ledger in line: published, still scheduled,
 * missing, or — the one to shout about — still private after its publish time.
 * `write: false` reports without touching the ledger.
 */
export async function reconcile(o: { ledgerFile: string; deps: Deps; write: boolean; tz?: string }): Promise<Reconciled[]> {
  const tz = o.tz ?? SCHEDULE_TZ, now = (o.deps.now ?? Date.now)();
  const ledger = readLedger(o.ledgerFile);
  const out: Reconciled[] = [];
  for (const e of ledger.videos) {
    if (!e.videoId) continue;
    const yt = await getVideoStatus(e.videoId, o.deps, { full: true });
    const was = e.status;
    if (!e.title && yt?.title) e.title = yt.title;
    let verdict: string, loud = false;
    const fail = (text: string) => { e.status = "failed"; e.note = text; verdict = text; loud = true; };
    if (!yt || yt.uploadStatus === "deleted") fail("MISSING: YouTube no longer lists this video");
    else if (yt.uploadStatus === "rejected" || yt.uploadStatus === "failed")
      fail(`${yt.uploadStatus.toUpperCase()} by YouTube${yt.rejectionReason || yt.failureReason ? ` (${yt.rejectionReason ?? yt.failureReason})` : ""}`);
    else if (yt.privacyStatus === "public") {
      verdict = was === "published" ? "published" : "published (was scheduled)";
      e.status = "published";
      if (!e.publishAt && yt.publishedAt) { e.publishAt = yt.publishedAt; e.publishAtEastern = easternLabel(yt.publishedAt, tz); }
      if (was !== "published") delete e.note;
    } else if (yt.privacyStatus === "private") {
      const at = yt.publishAt ?? null;
      if (was === "published") { verdict = "PRIVATE on YouTube although the ledger says published"; loud = true; }
      else if (at && Date.parse(at) > now) {
        verdict = "still scheduled";
        if (e.publishAt && Date.parse(at) !== Date.parse(e.publishAt)) {
          verdict = `still scheduled — but YouTube has ${easternLabel(at, tz)}, the ledger had ${e.publishAtEastern}; ledger now follows YouTube`;
          loud = true;
        }
        e.status = "scheduled"; e.publishAt = at.replace(".000Z", "Z"); e.publishAtEastern = easternLabel(at, tz);
      } else {
        const due = at ?? e.publishAt;
        if (due && Date.parse(due) + PUBLISH_GRACE_MS > now && Date.parse(due) <= now) verdict = "due: its time has just passed and YouTube has not flipped it yet — check again in a while";
        else if (due && Date.parse(due) <= now) fail(`LOCKED PRIVATE: its publish time (${easternLabel(due, tz)}) has passed and YouTube still has it private`);
        else { verdict = `PRIVATE WITH NO SCHEDULE on YouTube (the ledger expects ${e.publishAtEastern}) — set the time again in YouTube Studio`; loud = true; }
      }
    } else { verdict = `privacy is "${yt.privacyStatus}" on YouTube — changed by hand?`; loud = true; }
    e.checkedAt = new Date(now).toISOString();
    out.push({ helpKey: e.helpKey, videoId: e.videoId, ledgerStatus: was, status: e.status, youtube: yt, verdict: verdict!, loud });
  }
  if (o.write) writeLedger(o.ledgerFile, ledger);
  return out;
}

/* ── Printing ─────────────────────────────────────────────────────────────── */

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** The printable calendar: everything in the ledger, then (optionally) what the next run would add. */
export function calendarMarkdown(ledger: Ledger, planned: readonly Planned[] = [], tz: string = SCHEDULE_TZ, generatedAt: Date = new Date()): string {
  const rows = [
    ...ledger.videos.filter((e) => e.videoId && e.publishAt).map((e) => ({ at: e.publishAt!, title: e.title, link: `[${e.videoId}](${e.url})`, status: e.status + (e.thumbnail === "ok" ? "" : " · thumbnail not set") })),
    ...planned.map((p) => ({ at: p.publishAt, title: p.title, link: "—", status: "planned (not uploaded yet)" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const lines = [
    "# YouTube publishing calendar",
    "",
    `Generated ${easternLabel(generatedAt, tz)} by \`scripts/tutorials/youtube-schedule.ts --calendar\` from \`docs/tutorials/youtube-schedule.json\`.`,
    "Times are Eastern (America/New_York). Up to three videos a day — morning, midday, late — each published by YouTube itself at its time.",
    "",
    "| Date | Weekday | Eastern time | Title | Video | Status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r, i) => {
      const z = zoneTime(r.at, tz), first = i === 0 || zoneTime(rows[i - 1].at, tz).date !== z.date;
      return `| ${first ? `**${z.date}**` : ""} | ${first ? z.weekday : ""} | ${z.time} ${z.abbr} | ${cell(r.title)} | ${r.link} | ${r.status} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

/** A plain-text table for the terminal. */
export function textTable(head: string[], rows: string[][]): string {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? "").padEnd(width[i])).join("  ").trimEnd();
  return [line(head), line(width.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
