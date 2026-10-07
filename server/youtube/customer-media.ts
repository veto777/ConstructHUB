/**
 * Where a customer's video waits between their browser and their YouTube
 * channel. It reuses JobCam's object-storage code (server/jobcam/storage.ts:
 * R2 multipart with presigned part URLs, a proxy path, and a local-disk mode
 * for dev boxes) under its own key tree — `ytvideo/<userId>/<videoId>/original.<ext>`
 * — so a customer's file is never inside a JobCam org's tree and JobCam's
 * storage meter never sees it.
 *
 * The rules (size cap, type allow-list, part plan) are pure and unit-tested.
 */
import { assertKey, keyPrefix, getObject, type MultipartHandle } from "../jobcam/storage";
import type { VideoSource } from "./client";
import type { VideoRow } from "./customer-store";

/** R2 multipart parts: 5 MiB minimum, all but the last equal. */
export const VIDEO_PART_BYTES = 5 * 1024 * 1024;

/** What YouTube accepts that browsers and phones actually produce. Extension = how the stored original is named. */
export const CUSTOMER_VIDEO_MIMES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "video/mpeg": "mpg",
  "video/x-msvideo": "avi",
};
export const cleanMime = (mime: unknown): string => String(mime ?? "").toLowerCase().split(";")[0].trim();

export type FileVerdict = { ok: true; ext: string; mime: string; partsTotal: number } | { ok: false; status: 400 | 413 | 415; message: string };

export function validateVideoFile(f: { mime: unknown; bytes: unknown }, maxBytes: number): FileVerdict {
  const mime = cleanMime(f.mime), ext = CUSTOMER_VIDEO_MIMES[mime];
  if (!ext) return { ok: false, status: 415, message: "Choose a video file: MP4, MOV, WebM, M4V, MKV, 3GP, MPEG or AVI." };
  const bytes = Number(f.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return { ok: false, status: 400, message: "The file is empty." };
  if (bytes > maxBytes) return { ok: false, status: 413, message: `Videos are capped at ${formatBytes(maxBytes)} each.` };
  return { ok: true, ext, mime, partsTotal: Math.ceil(bytes / VIDEO_PART_BYTES) };
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

/** The size part n must have (every part is VIDEO_PART_BYTES but the last). */
export const expectedPartBytes = (v: Pick<VideoRow, "bytes" | "part_size" | "parts_total">, n: number): number =>
  n < v.parts_total ? v.part_size : v.bytes - (v.parts_total - 1) * v.part_size;

/** `ytvideo/…`, or `ytvideo-<suffix>/…` on a box that sets JOBCAM_KEY_PREFIX=jobcam-<suffix> (dev sharing the production bucket). */
export function videoKey(userId: number, videoId: string, ext: string): string {
  return assertKey(`${keyPrefix().replace(/^jobcam/, "ytvideo")}/${userId}/${videoId}/original.${ext}`);
}

/** The key on a row must be inside ITS account's tree, whatever is in the column. */
export function keyIsOwn(v: Pick<VideoRow, "storage_key" | "user_id" | "id">): boolean {
  try { assertKey(v.storage_key); } catch { return false; }
  const [tree, user, video] = v.storage_key.split("/");
  return /^ytvideo(-[a-z0-9]{1,24})?$/.test(tree) && user === String(v.user_id) && video === v.id;
}

export const handleOf = (v: Pick<VideoRow, "storage_mode" | "storage_key" | "storage_upload_id">): MultipartHandle =>
  ({ mode: v.storage_mode, key: v.storage_key, storageUploadId: v.storage_upload_id });

/** Read the stored file one byte range at a time (what the YouTube uploader asks for). */
export function storedVideoSource(v: Pick<VideoRow, "storage_key" | "mime" | "bytes">, read = getObject): VideoSource {
  return {
    size: v.bytes,
    async read(offset, length) {
      const obj = await read(v.storage_key, v.mime, `bytes=${offset}-${offset + length - 1}`);
      if (!obj) throw new Error("The stored video is gone");
      const chunks: Buffer[] = [];
      let got = 0;
      for await (const c of obj.body) {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
        got += b.length;
        if (got > length) { obj.body.destroy(); throw new Error("Storage returned more than the range asked for"); }
        chunks.push(b);
      }
      return Buffer.concat(chunks);
    },
  };
}
