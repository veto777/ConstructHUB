/**
 * The walkthrough-video manifest (./videos.json) — every recorded video's files, as mux.ts measured
 * them: storage key, size in bytes, sha256, and the video's length in whole seconds.
 *
 * It is the ONE place a video is declared. The help registry builds each entry's `video` from it
 * (an entry that is not listed here has `video: null` and shows "coming soon"), upload.ts uploads
 * exactly these keys, and server/help-registry.test.ts refuses a video that is not listed.
 *
 * Keys carry the first 8 hex digits of the file's sha256 (`tutorials/<helpKey>.<hash8>.<ext>`), so a
 * re-recorded video has a new address and the year-long cache on the old one cannot serve it stale.
 * Never edit the JSON by hand: `tsx scripts/tutorials/mux.ts <script> --publish` writes it.
 */
import manifest from "./videos.json";
import type { HelpVideo } from "./types";

export type VideoFile = { key: string; bytes: number; sha256: string };
export type VideoManifestEntry = { durationSec: number; video: VideoFile; captions: VideoFile; poster: VideoFile };
export type VideoManifest = Record<string, VideoManifestEntry>;

export const VIDEO_MANIFEST = manifest as VideoManifest;

/** `tutorials/<helpKey>.<hash8>.<ext>` — the only shape a tutorial media key may have. */
export const TUTORIAL_FILE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.[0-9a-f]{8}\.(mp4|vtt|jpg)$/;
export const TUTORIAL_PREFIX = "tutorials/";
/** The public address of a manifest key (served by GET /api/tutorials/media/:file). */
export const tutorialMediaUrl = (key: string): string => `/api/tutorials/media/${key.slice(TUTORIAL_PREFIX.length)}`;

export const manifestEntry = (e: VideoManifestEntry): VideoManifestEntry => e;

/** The registry's `video` for a help key, or null when no walkthrough has been recorded. */
export function helpVideoFor(helpKey: string): HelpVideo | null {
  const e = Object.prototype.hasOwnProperty.call(VIDEO_MANIFEST, helpKey) ? VIDEO_MANIFEST[helpKey] : undefined;
  if (!e) return null;
  return { url: tutorialMediaUrl(e.video.key), durationSec: e.durationSec, poster: tutorialMediaUrl(e.poster.key), captions: tutorialMediaUrl(e.captions.key) };
}
