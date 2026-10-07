/**
 * The walkthrough-video manifest — ONE FILE PER VIDEO (./videos/<helpKey>.json): the video's files as
 * mux.ts measured them (storage key, size in bytes, sha256), its length in whole seconds, and the
 * proof that upload.ts really put those objects in R2 (`uploaded`: when, and each object's ETag as R2
 * answered it).
 *
 * It is the ONE place a video is declared. The help registry builds each entry's `video` from it (an
 * entry with no manifest file has `video: null` and shows "coming soon"), and
 * server/help-registry.test.ts refuses a video without one — or with one that was never uploaded.
 *
 * Keys carry the first 8 hex digits of the file's sha256 (`tutorials/<helpKey>.<hash8>.<ext>`), so a
 * re-recorded video has a new address and the year-long cache on the old one cannot serve it stale.
 * Never write a manifest by hand: `tsx scripts/tutorials/upload.ts <helpKey>` writes it after the
 * upload succeeded, and regenerates ./videos/index.ts (scripts/tutorials/gen-index.ts).
 */
import * as files from "./videos/index";
import type { HelpVideo } from "./types";

export type VideoFile = { key: string; bytes: number; sha256: string };
export type VideoUploadProof = { at: string; video: string; captions: string; poster: string };
export type VideoManifestEntry = {
  helpKey: string; durationSec: number; video: VideoFile; captions: VideoFile; poster: VideoFile;
  /** Written by upload.ts once the three objects are in R2: the time, and each object's ETag. */
  uploaded: VideoUploadProof;
};
export type VideoManifest = Record<string, VideoManifestEntry>;

export const VIDEO_MANIFEST: VideoManifest = Object.fromEntries(
  (Object.values(files) as unknown as VideoManifestEntry[]).map((e) => [e.helpKey, e]));

/** `tutorials/<helpKey>.<hash8>.<ext>` — the only shape a tutorial media key may have. */
export const TUTORIAL_FILE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.[0-9a-f]{8}\.(mp4|vtt|jpg)$/;
export const TUTORIAL_PREFIX = "tutorials/";
/** The public address of a manifest key (served by GET /api/tutorials/media/:file). */
export const tutorialMediaUrl = (key: string): string => `/api/tutorials/media/${key.slice(TUTORIAL_PREFIX.length)}`;

/** The registry's `video` for a help key, or null when no walkthrough has been recorded. */
export function helpVideoFor(helpKey: string): HelpVideo | null {
  const e = Object.prototype.hasOwnProperty.call(VIDEO_MANIFEST, helpKey) ? VIDEO_MANIFEST[helpKey] : undefined;
  if (!e) return null;
  return { url: tutorialMediaUrl(e.video.key), durationSec: e.durationSec, poster: tutorialMediaUrl(e.poster.key), captions: tutorialMediaUrl(e.captions.key) };
}
