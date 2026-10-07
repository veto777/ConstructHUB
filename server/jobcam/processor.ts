/**
 * JobCam media processor — an in-process queue, concurrency 1, that turns an
 * uploaded original into what the feeds need:
 *
 *   photo → display (≤ 2048 px JPEG) + thumb (400 px) via sharp; EXIF GPS +
 *           capture time read from the file; HEIC decoded by sharp (libheif)
 *           with an ffmpeg fallback, and an honest failure when neither can.
 *   video → ffprobe metadata, a poster frame, a 400 px thumb, and a 720p
 *           H.264/AAC transcode (-preset veryfast) ONLY when the original is
 *           not browser-playable (HEVC/MOV). The original is always kept.
 *
 * This box serves production: ffmpeg runs under `nice -n 15`, sharp does its
 * work on libuv's thread pool, hashing streams — the event loop is never
 * blocked. Every outcome lands on the row (status ready|failed + error) and
 * the org storage meter; boot re-queues anything left in `processing`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import sharp from "sharp";
import { eq, and, lt, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { jobcamMedia, jobcamUploads } from "@shared/schema";
import { downloadToFile, putObjectFromFile, mediaKey, abortMultipart, keyBelongsTo } from "./storage";
import { readImageMeta, readVideoMeta, sniffMedia, sniffMatchesKind, FFMPEG_SAFE_INPUT } from "./exif";
import { LIMITS, UPLOAD_TTL_MS, nextMediaStatus } from "./upload-state";
import { bumpJobcamUsage, recountJobcamUsage } from "./usage";

const DISPLAY_MAX = 2048;
const THUMB_MAX = 400;

const queue: string[] = [];
const queued = new Set<string>();
let running = false;

export function enqueueMedia(mediaId: string): void {
  if (queued.has(mediaId)) return;
  queued.add(mediaId);
  queue.push(mediaId);
  void drain();
}

export function processorStats() {
  return { queued: queue.length, running };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      queued.delete(id);
      try {
        await processOne(id);
      } catch (e: any) {
        console.error(`[jobcam] processing ${id} crashed:`, e?.message || e);
        await fail(id, String(e?.message || e));
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Uploads nobody finished: after UPLOAD_TTL the multipart upload is aborted
 * (R2 frees the parts, the local part files go) and the never-completed media
 * row is dropped. Runs at boot and hourly; touches only `open` uploads.
 */
export async function sweepExpiredUploads(now = Date.now()): Promise<number> {
  const stale = await db.select().from(jobcamUploads)
    .where(and(eq(jobcamUploads.status, "open"), lt(jobcamUploads.createdAt, new Date(now - UPLOAD_TTL_MS)))).limit(200);
  for (const u of stale) {
    await abortMultipart({ mode: u.storageMode as "r2" | "local", key: u.key, storageUploadId: u.storageUploadId }, u.id).catch(() => {});
    await db.update(jobcamUploads).set({ status: "aborted", updatedAt: new Date() }).where(and(eq(jobcamUploads.id, u.id), eq(jobcamUploads.status, "open")));
  }
  if (stale.length) {
    await db.delete(jobcamMedia).where(and(inArray(jobcamMedia.id, stale.map((u) => u.mediaId)), eq(jobcamMedia.status, "uploading")));
    console.log(`[jobcam] swept ${stale.length} abandoned upload(s)`);
  }
  return stale.length;
}

let sweeper: NodeJS.Timeout | null = null;
export function startJobcamSweeper(): void {
  if (sweeper) return;
  const tick = () => sweepExpiredUploads().catch((e: any) => console.error("[jobcam] sweep failed:", e?.message || e));
  void tick();
  sweeper = setInterval(tick, 60 * 60 * 1000);
  sweeper.unref();
}

/** Boot: anything still `processing` was interrupted by a restart — run it again. */
export async function resumeJobcamProcessing(): Promise<void> {
  const rows = await db.select({ id: jobcamMedia.id }).from(jobcamMedia)
    .where(and(eq(jobcamMedia.status, "processing")));
  for (const r of rows) enqueueMedia(r.id);
  if (rows.length) console.log(`[jobcam] re-queued ${rows.length} interrupted media job(s)`);
  // The storage meter is a running total; rebuild it from the rows at boot so
  // a crash between "ready" and the bump (or a manual row fix) can't leave it off.
  const orgs = await pool.query(`SELECT org_id FROM jobcam_org_usage UNION SELECT DISTINCT org_id FROM jobcam_media`);
  for (const o of orgs.rows) await recountJobcamUsage(o.org_id).catch(() => {});
}

function run(cmd: string, args: string[], opts: { nice?: boolean; timeoutMs?: number } = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const bin = opts.nice ? "nice" : cmd;
    const argv = opts.nice ? ["-n", "15", cmd, ...args] : args;
    const child = spawn(bin, argv, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(p).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

async function readHead(p: string, n = 32): Promise<Buffer> {
  const fh = await fs.promises.open(p, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

async function fail(id: string, message: string): Promise<void> {
  const [row] = await db.select({ status: jobcamMedia.status }).from(jobcamMedia).where(eq(jobcamMedia.id, id)).limit(1);
  if (!row || !nextMediaStatus(row.status as any, "fail")) return;
  await db.update(jobcamMedia).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(jobcamMedia.id, id));
}

/** Decode anything sharp can (JPEG/PNG/WebP/HEIF) to a working JPEG; ffmpeg as the HEIC fallback. */
async function toWorkingJpeg(src: string, work: string, mime: string): Promise<string> {
  const out = path.join(work, "work.jpg");
  try {
    await sharp(src, { failOn: "none" }).rotate().jpeg({ quality: 95 }).toFile(out);
    return out;
  } catch (e: any) {
    if (!/hei[cf]/i.test(mime)) throw e;
    const r = await run("ffmpeg", ["-y", "-v", "error", ...FFMPEG_SAFE_INPUT, "-i", src, "-frames:v", "1", "-q:v", "2", out], { nice: true, timeoutMs: 60_000 });
    if (r.code !== 0 || !fs.existsSync(out)) {
      throw new Error("This HEIC photo uses HEVC, which this server can't decode. Set the phone camera to 'Most Compatible' (JPEG) or let Safari convert it (the JobCam picker already asks for JPEG).");
    }
    return out;
  }
}

async function processPhoto(row: typeof jobcamMedia.$inferSelect, src: string, work: string) {
  const meta = await readImageMeta(src);           // EXIF from the untouched original
  const working = await toWorkingJpeg(src, work, row.mime);
  const displayPath = path.join(work, "display.jpg");
  const thumbPath = path.join(work, "thumb.jpg");
  const display = await sharp(working).resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true }).toFile(displayPath);
  await sharp(working).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true }).toFile(thumbPath);
  const displayKey = mediaKey(row.orgId, row.id, "display.jpg");
  const thumbKey = mediaKey(row.orgId, row.id, "thumb.jpg");
  const b1 = await putObjectFromFile(displayKey, displayPath, "image/jpeg");
  const b2 = await putObjectFromFile(thumbKey, thumbPath, "image/jpeg");
  // Dimensions: the decoded (rotation-applied) size when EXIF didn't say.
  const width = meta.width ?? display.width ?? null;
  const height = meta.height ?? display.height ?? null;
  return {
    r2KeyDisplay: displayKey, r2KeyThumb: thumbKey, renditionBytes: b1 + b2,
    width, height,
    exifLat: meta.lat, exifLng: meta.lng, exif: meta.exif,
    capturedAt: meta.capturedAt ?? row.capturedAt ?? row.uploadedAt ?? new Date(),
  };
}

async function processVideo(row: typeof jobcamMedia.$inferSelect, src: string, work: string) {
  const meta = await readVideoMeta(src);
  if (!meta.videoCodec) throw new Error("This file has no video track.");
  if (meta.durationS !== null && meta.durationS > LIMITS.videoSeconds + 1) {
    throw new Error(`This video is ${Math.round(meta.durationS / 60)} minutes long; JobCam clips are capped at 10 minutes.`);
  }
  const posterPath = path.join(work, "poster.jpg");
  const thumbPath = path.join(work, "thumb.jpg");
  const at = meta.durationS !== null && meta.durationS < 1.5 ? "0" : "1";
  const poster = await run("ffmpeg", ["-y", "-v", "error", ...FFMPEG_SAFE_INPUT, "-ss", at, "-i", src, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", posterPath],
    { nice: true, timeoutMs: 120_000 });
  if (poster.code !== 0 || !fs.existsSync(posterPath)) {
    throw new Error(`Could not read this video (${poster.stderr.trim().split("\n").pop() || "ffmpeg failed"}).`);
  }
  await sharp(posterPath).resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside" }).jpeg({ quality: 80, mozjpeg: true }).toFile(thumbPath);
  const posterKey = mediaKey(row.orgId, row.id, "poster.jpg");
  const thumbKey = mediaKey(row.orgId, row.id, "thumb.jpg");
  let renditionBytes = await putObjectFromFile(posterKey, posterPath, "image/jpeg");
  renditionBytes += await putObjectFromFile(thumbKey, thumbPath, "image/jpeg");

  let r2KeyVideo: string | null = null;
  if (meta.remuxable) {
    // H.264/AAC in a .mov: rewrap into MP4 (stream copy — seconds, no quality loss).
    const outPath = path.join(work, "video-remux.mp4");
    const t = await run("ffmpeg", ["-y", "-v", "error", ...FFMPEG_SAFE_INPUT, "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", outPath],
      { nice: true, timeoutMs: 10 * 60_000 });
    if (t.code === 0 && fs.existsSync(outPath)) {
      r2KeyVideo = mediaKey(row.orgId, row.id, "video-remux.mp4");
      renditionBytes += await putObjectFromFile(r2KeyVideo, outPath, "video/mp4");
    }
  }
  // In-browser recordings (MediaRecorder WebM) carry no duration and no seek
  // index: they are re-encoded too, which also measures them against the cap.
  let durationS = meta.durationS;
  if ((!meta.playable || durationS === null) && !r2KeyVideo) {
    const outPath = path.join(work, "video-720.mp4");
    // Scale to 720 lines max (never upscale), even dimensions for yuv420p.
    const t = await run("ffmpeg", [
      "-y", "-v", "error", ...FFMPEG_SAFE_INPUT, "-i", src,
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(720,ih)'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2",
      "-c:a", "aac", "-b:a", "128k", "-t", String(LIMITS.videoSeconds + 5), "-movflags", "+faststart", outPath,
    ], { nice: true, timeoutMs: 45 * 60_000 });
    if (t.code !== 0 || !fs.existsSync(outPath)) {
      throw new Error(`Transcode failed (${t.stderr.trim().split("\n").pop() || "ffmpeg failed"}).`);
    }
    if (durationS === null) {
      durationS = (await readVideoMeta(outPath)).durationS;
      if (durationS === null) throw new Error("Could not measure this video's length.");
      if (durationS > LIMITS.videoSeconds + 1) throw new Error("This video is longer than 10 minutes; JobCam clips are capped at 10 minutes.");
    }
    r2KeyVideo = mediaKey(row.orgId, row.id, "video-720.mp4");
    renditionBytes += await putObjectFromFile(r2KeyVideo, outPath, "video/mp4");
  }
  return {
    r2KeyPoster: posterKey, r2KeyThumb: thumbKey, r2KeyVideo, renditionBytes,
    width: meta.width, height: meta.height, durationS,
    exifLat: meta.lat, exifLng: meta.lng,
    exif: { videoCodec: meta.videoCodec, audioCodec: meta.audioCodec, container: meta.container, rotation: meta.rotation, bitRate: meta.bitRate, playable: meta.playable, remuxed: !!r2KeyVideo && meta.remuxable },
    capturedAt: meta.capturedAt ?? row.capturedAt ?? row.uploadedAt ?? new Date(),
  };
}

async function processOne(id: string): Promise<void> {
  const [row] = await db.select().from(jobcamMedia).where(eq(jobcamMedia.id, id)).limit(1);
  if (!row || row.status !== "processing" || row.deletedAt) return;
  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jobcam-"));
  try {
    const src = path.join(work, `original.${row.r2KeyOriginal.split(".").pop() || "bin"}`);
    if (!keyBelongsTo(row.r2KeyOriginal, row.orgId, row.id)) throw new Error("Stored file key does not belong to this media row.");
    await downloadToFile(row.r2KeyOriginal, src);
    // Caps are re-checked on what actually landed, and the bytes must be the
    // kind of file the row claims before any decoder touches them.
    const stat = await fs.promises.stat(src);
    const cap = row.kind === "video" ? LIMITS.videoBytes : LIMITS.photoBytes;
    if (stat.size > cap) throw new Error(row.kind === "video" ? "Videos are capped at 1 GB each." : "Photos are capped at 25 MB each.");
    if (!sniffMatchesKind(sniffMedia(await readHead(src)), row.kind)) {
      throw new Error(row.kind === "video" ? "This isn't an MP4, MOV or WebM video file." : "This isn't a JPEG, PNG, WebP or HEIC photo.");
    }
    const sha256 = await sha256File(src);
    const patch = row.kind === "video" ? await processVideo(row, src, work) : await processPhoto(row, src, work);
    const [fresh] = await db.select({ status: jobcamMedia.status, deletedAt: jobcamMedia.deletedAt }).from(jobcamMedia).where(eq(jobcamMedia.id, id)).limit(1);
    if (!fresh || fresh.deletedAt || !nextMediaStatus(fresh.status as any, "done")) return;
    await db.update(jobcamMedia).set({ ...patch, sha256, status: "ready", error: null, updatedAt: new Date() })
      .where(eq(jobcamMedia.id, id));
    await bumpJobcamUsage(row.orgId, { bytes: row.bytes + patch.renditionBytes, kind: row.kind as "photo" | "video", count: 1 });
    console.log(`[jobcam] ready ${row.kind} ${id} (${Math.round(row.bytes / 1024)} KB + ${Math.round(patch.renditionBytes / 1024)} KB renditions)`);
  } catch (e: any) {
    console.error(`[jobcam] ${row.kind} ${id} failed:`, e?.message || e);
    await fail(id, String(e?.message || e));
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
