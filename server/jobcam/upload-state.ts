/**
 * JobCam upload rules + the upload/media state machine — pure, unit-tested
 * (upload-state.test.ts). The routes and the processor only ever move a media
 * row along these transitions, so a stray status can't come from a route.
 *
 *   media.status:  uploading ─complete→ processing ─done→ ready
 *                                       └─fail→ failed ─retry→ processing
 *   upload.status: open ─complete→ completed | ─abort→ aborted
 */
import type { JobcamMediaKind, JobcamMediaStatus } from "@shared/schema";

/** R2 multipart parts: 5 MiB minimum, all but the last equal — we use exactly 5 MiB. */
export const PART_SIZE = 5 * 1024 * 1024;
/** Presigned part URLs live this long; a resumed upload asks for fresh ones. */
export const PART_URL_TTL_S = 15 * 60;
/** An open multipart upload is abandoned after this (R2 auto-aborts at 7 days). */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  photoBytes: 25 * 1024 * 1024,          // 25 MB
  videoBytes: 1024 * 1024 * 1024,        // 1 GB
  videoSeconds: 10 * 60,                 // 10 minutes
} as const;

/** What the camera and the picker may hand us. Extension = what the stored original is named. */
export const PHOTO_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
export const VIDEO_MIMES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "video/x-matroska": "mkv",
};

export function kindFromMime(mime: string): JobcamMediaKind | null {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (m in PHOTO_MIMES) return "photo";
  if (m in VIDEO_MIMES) return "video";
  return null;
}

export function extensionFor(mime: string): string {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return PHOTO_MIMES[m] ?? VIDEO_MIMES[m] ?? "bin";
}

export type UploadRequest = {
  mime: string;
  bytes: number;
  /** The client's own measurement of a video (HTMLVideoElement.duration); the
   *  server re-measures with ffprobe and that number is the one that counts. */
  durationS?: number | null;
};

export type UploadVerdict =
  | { ok: true; kind: JobcamMediaKind; ext: string }
  | { ok: false; status: 400 | 413 | 415; message: string };

/** Size / type / duration caps, in the order a user would want to hear them. */
export function validateUploadRequest(r: UploadRequest): UploadVerdict {
  const kind = kindFromMime(r.mime);
  if (!kind) {
    return { ok: false, status: 415, message: "JPEG, PNG, WebP or HEIC photos and MP4, MOV or WebM videos only." };
  }
  if (!Number.isFinite(r.bytes) || r.bytes <= 0) {
    return { ok: false, status: 400, message: "The file is empty." };
  }
  if (kind === "photo" && r.bytes > LIMITS.photoBytes) {
    return { ok: false, status: 413, message: "Photos are capped at 25 MB each." };
  }
  if (kind === "video" && r.bytes > LIMITS.videoBytes) {
    return { ok: false, status: 413, message: "Videos are capped at 1 GB each." };
  }
  if (kind === "video" && typeof r.durationS === "number" && r.durationS > LIMITS.videoSeconds + 1) {
    return { ok: false, status: 413, message: "Videos are capped at 10 minutes. Trim it and try again." };
  }
  return { ok: true, kind, ext: extensionFor(r.mime) };
}

/** How many parts a file needs (never zero — an empty file is refused earlier). */
export function partPlan(bytes: number, partSize = PART_SIZE): { partSize: number; partsTotal: number } {
  const partsTotal = Math.max(1, Math.ceil(bytes / partSize));
  return { partSize, partsTotal };
}

/** Byte range of part n (1-based) inside a file. */
export function partRange(n: number, bytes: number, partSize = PART_SIZE): { start: number; end: number } {
  const start = (n - 1) * partSize;
  return { start, end: Math.min(bytes, start + partSize) };
}

/** `{ "<n>": "<etag>" }` — the shape jobcam_uploads.parts_done stores. */
export type PartsDone = Record<string, string>;

export function markPart(done: PartsDone | null | undefined, n: number, etag: string): PartsDone {
  return { ...(done ?? {}), [String(n)]: etag };
}

export function missingParts(done: PartsDone | null | undefined, partsTotal: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= partsTotal; n++) if (!done?.[String(n)]) out.push(n);
  return out;
}

export function canComplete(done: PartsDone | null | undefined, partsTotal: number): boolean {
  return partsTotal > 0 && missingParts(done, partsTotal).length === 0;
}

/** The ordered part list CompleteMultipartUpload wants. */
export function completedParts(done: PartsDone, partsTotal: number): { PartNumber: number; ETag: string }[] {
  const out: { PartNumber: number; ETag: string }[] = [];
  for (let n = 1; n <= partsTotal; n++) out.push({ PartNumber: n, ETag: done[String(n)] });
  return out;
}

export type MediaEvent = "complete" | "done" | "fail" | "retry";

/** The only legal moves; anything else returns null and the caller refuses. */
export function nextMediaStatus(current: JobcamMediaStatus, event: MediaEvent): JobcamMediaStatus | null {
  switch (current) {
    case "uploading": return event === "complete" ? "processing" : null;
    case "processing": return event === "done" ? "ready" : event === "fail" ? "failed" : event === "retry" ? "processing" : null;
    case "failed": return event === "retry" ? "processing" : null;
    case "ready": return null;
    default: return null;
  }
}

/** An open upload past its TTL is garbage — the sweeper aborts it and drops the media row. */
export function uploadExpired(createdAt: Date | string | null | undefined, now = Date.now(), ttlMs = UPLOAD_TTL_MS): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t > ttlMs;
}
