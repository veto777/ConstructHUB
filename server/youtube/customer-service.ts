/**
 * Customers' YouTube uploads: the words a customer reads when something goes
 * wrong, the "forget everything about this account" routine, and the
 * background worker that sends a stored video to the customer's own channel.
 *
 * The worker follows the platform's in-process interval pattern
 * (server/social/service.ts, server/seo/jobs.ts): a tick every 15 seconds, one
 * tick at a time, rows leased with FOR UPDATE SKIP LOCKED. Uploads run one
 * after another, each read from storage one 8 MiB range at a time
 * (customer-media.ts storedVideoSource) — a video is never held in memory whole.
 */
import {
  YoutubeError, getVideoStatus, getYoutubeAccessToken, revokeToken, uploadVideo, type Deps,
} from "./client";
import {
  claimNextUpload, customerRefreshTokenForRevoke, customerYoutubeStore, deleteAllVideos, deleteCustomerConnection, dueChecks, failVideo,
  filesToDelete, finishUpload, heartbeat, interruptedUploads, markFileDeleted, markQuotaSpent, recordCheck, type VideoRow,
} from "./customer-store";
import { handleOf, keyIsOwn, storedVideoSource } from "./customer-media";

/* ── Plain words ──────────────────────────────────────────────────────────── */

const NO_CHANNEL = "The Google account you picked has no YouTube channel. Create a channel on YouTube (or pick another account), then connect again.";
const BY_REASON: Record<string, string> = {
  uploadLimitExceeded: "YouTube says this channel has reached its own upload limit for now. Wait 24 hours, or verify the channel with a phone number at youtube.com/verify, then send the video again.",
  youtubeSignupRequired: NO_CHANNEL,
  invalidTitle: "YouTube rejected the title. Use 1 to 100 characters, without < or >.",
  invalidDescription: "YouTube rejected the description. Keep it under 5,000 characters, without < or >.",
  invalidTags: "YouTube rejected the tags. Use fewer or shorter tags.",
  invalidVideoMetadata: "YouTube rejected the video's details. Check the title, description and tags.",
  invalidFilename: "YouTube rejected the file. Send an MP4 or MOV video.",
};
const BY_CODE: Record<string, string> = {
  not_configured: "YouTube publishing is not set up on ConstructHUB yet. Please contact support.",
  not_connected: "No YouTube channel is connected. Connect your channel, then send the video again.",
  needs_reconnect: "Your YouTube sign-in has expired or access was removed. Choose Reconnect, then send the video again.",
  quota: "YouTube's daily upload allowance for ConstructHUB is used up. Try again tomorrow (it resets at midnight Pacific time).",
  missing_scope: "The connection does not include permission to upload. Choose Reconnect and leave every permission ticked.",
  state: "This connection attempt expired or was not started in this browser. Choose Connect again.",
  denied: "The Google permission screen was cancelled. Nothing was connected.",
  redirect_uri: "ConstructHUB's YouTube connection is not fully set up yet (Google rejected the return address). Please contact support.",
  scope: "Google did not grant permission to upload videos. Connect again and leave every permission ticked.",
  exchange: "Google did not complete the sign-in. Try connecting again.",
  no_refresh_token: "Google did not return a lasting sign-in. Connect again.",
  no_channel: NO_CHANNEL,
};

/** A YoutubeError's code (and Google's reason, when it gave one) → a sentence for the customer. Google's own text is never passed through. */
export function customerMessage(code: string, reason?: unknown): string {
  const r = typeof reason === "string" ? reason : "";
  if (BY_REASON[r]) return BY_REASON[r];
  if (BY_CODE[code]) return BY_CODE[code];
  return `YouTube did not accept the upload${/^[A-Za-z]{1,40}$/.test(r) ? ` (${r})` : ""}. Try again; if it keeps failing, upload the file in YouTube Studio to see YouTube's own message.`;
}

const REJECTED: Record<string, string> = {
  length: "YouTube rejected the video because it is longer than this channel may upload. Channels that are not verified with a phone number are limited to 15 minutes — verify at youtube.com/verify, then send it again.",
  duplicate: "YouTube rejected the video as a duplicate of one already on the channel.",
  copyright: "YouTube rejected the video for a copyright reason.",
  claim: "YouTube rejected the video for a copyright claim.",
  inappropriate: "YouTube rejected the video as inappropriate under its Community Guidelines.",
  termsOfUse: "YouTube rejected the video under its Terms of Service.",
  legal: "YouTube rejected the video for a legal reason.",
  trademark: "YouTube rejected the video for a trademark reason.",
  uploaderAccountClosed: "YouTube rejected the video because the channel's account is closed.",
  uploaderAccountSuspended: "YouTube rejected the video because the channel's account is suspended.",
};
/** YouTube's verdict after processing (status.rejectionReason / failureReason) → a sentence. */
export function processingMessage(kind: "rejected" | "failed", reason: string | null): string {
  if (kind === "rejected") return REJECTED[reason ?? ""] ?? `YouTube rejected the video after upload${reason ? ` (${reason})` : ""}. Open YouTube Studio to see why.`;
  return `YouTube could not process the file${reason ? ` (${reason})` : ""}. Export it again as an MP4 and send it again.`;
}

/* ── Stored files ─────────────────────────────────────────────────────────── */

/** Delete a row's file from storage (and its unfinished multipart). Never throws; a key outside the account's own tree is not touched. */
export async function removeStoredFile(v: VideoRow): Promise<void> {
  if (v.file_deleted_at || !keyIsOwn(v)) return;
  try {
    const { abortMultipart, deleteObject } = await import("../jobcam/storage");
    if (v.state === "receiving") await abortMultipart(handleOf(v), v.id);
    await deleteObject(v.storage_key);
  } catch (e) {
    console.error("[youtube] could not delete a stored video:", (e as Error)?.message);
  }
}

/**
 * Forget everything stored for one account: revoke the grant at Google, then
 * delete the connection row (channel, tokens, scopes), every video record and
 * every stored file. Used by Disconnect and by account deletion. The rows are
 * deleted even when Google cannot be reached.
 */
export async function purgeCustomerYoutube(userId: number, http: typeof fetch = fetch): Promise<{ removed: boolean; revokedAtGoogle: boolean; videos: number }> {
  const token = await customerRefreshTokenForRevoke(userId);
  const revokedAtGoogle = token ? await revokeToken(token, http) : false;
  const removed = await deleteCustomerConnection(userId);
  const videos = await deleteAllVideos(userId);
  for (const v of videos) await removeStoredFile(v);
  return { removed, revokedAtGoogle, videos: videos.length };
}

/* ── Worker ───────────────────────────────────────────────────────────────── */

export type WorkerDeps = { http?: typeof fetch; retryDelayMs?: number; notify?: (v: VideoRow, outcome: "published" | "failed", message?: string) => Promise<void> };

/** How long to wait before looking at a processing video again: at most 7 looks over about 8 hours, then stop (each look costs API quota). */
export const CHECK_LADDER_S = [60, 120, 300, 900, 3600, 21600] as const;
const nextCheck = (checksDone: number): number | null => CHECK_LADDER_S[checksDone] ?? null;

async function defaultNotify(v: VideoRow, outcome: "published" | "failed", message?: string): Promise<void> {
  const { notifyUser } = await import("../account-events");
  await notifyUser(v.user_id, outcome === "published" ? "social.post_published" : "social.post_failed", {
    title: outcome === "published" ? "Your video is on YouTube" : "A YouTube upload needs attention",
    body: outcome === "published" ? v.title ?? undefined : message,
    link: "/social-media#youtube",
  });
}

const libDeps = (v: VideoRow, d: WorkerDeps): Deps => ({ store: customerYoutubeStore(v.user_id), http: d.http, retryDelayMs: d.retryDelayMs });

/** Send one leased video to its owner's channel. Every outcome ends in a state the customer can read. */
export async function runUpload(v: VideoRow, d: WorkerDeps = {}): Promise<void> {
  const notify = d.notify ?? defaultNotify;
  const fail = async (code: string, message: string) => {
    await failVideo(v.id, code, message);
    await notify(v, "failed", message).catch(() => undefined);
  };
  const deps = libDeps(v, d);
  try {
    if (!keyIsOwn(v) || v.file_deleted_at) return await fail("upload", "The stored video is no longer available. Send the file again.");
    const grant = await deps.store.load();
    if (!grant?.refreshToken) return await fail("not_connected", customerMessage("not_connected"));
    // The customer certified this video for the channel they saw. A different channel connected since then gets nothing.
    if (grant.channelId !== v.channel_id)
      return await fail("channel_changed", "The connected channel changed after this video was queued. Send it again to publish it on the new channel.");
    await getYoutubeAccessToken(deps);
    await markQuotaSpent(v.id);
    const source = storedVideoSource(v);
    const done = await uploadVideo({
      source: {
        size: source.size,
        read: async (offset, length) => { await heartbeat(v.id, offset); return source.read(offset, length); },
      },
      title: v.title ?? v.file_name,
      description: v.description ?? "",
      tags: v.tags,
      categoryId: "22", // People & Blogs — YouTube's own default for a new upload
      privacyStatus: v.privacy ?? "private",
      madeForKids: v.made_for_kids === true,
    }, deps);
    const processed = done.uploadStatus === "processed";
    await finishUpload(v.id, { videoId: done.videoId, privacy: done.privacyStatus, processed });
    console.log(`[youtube] customer upload ${v.id} of user ${v.user_id} accepted by YouTube`);
    if (processed) await notify(v, "published").catch(() => undefined);
  } catch (e) {
    if (e instanceof YoutubeError) {
      if (e.code === "needs_reconnect") await deps.store.markNeedsReconnect("YouTube rejected the saved sign-in during an upload.").catch(() => undefined);
      return await fail(e.code, customerMessage(e.code, e.extra?.reason));
    }
    console.error("[youtube] customer upload failed:", (e as Error)?.message);
    await fail("upload", "The upload stopped before YouTube confirmed it. Check your channel in YouTube Studio; if the video is not there, send it again.");
  }
}

/** Ask YouTube what became of an uploaded video and record the answer. */
export async function runCheck(v: VideoRow, d: WorkerDeps = {}): Promise<void> {
  const notify = d.notify ?? defaultNotify;
  const fail = async (code: string, message: string) => {
    await failVideo(v.id, code, message);
    await notify(v, "failed", message).catch(() => undefined);
  };
  try {
    const s = await getVideoStatus(v.youtube_video_id!, libDeps(v, d));
    if (!s || s.uploadStatus === "deleted") return await fail("removed", "YouTube no longer lists this video. It may have been deleted in YouTube Studio.");
    if (s.uploadStatus === "rejected") return await fail("rejected", processingMessage("rejected", s.rejectionReason));
    if (s.uploadStatus === "failed") return await fail("processing_failed", processingMessage("failed", s.failureReason));
    if (s.uploadStatus === "processed") {
      await recordCheck(v.id, { published: true, privacy: s.privacyStatus, nextInSeconds: null });
      return await notify(v, "published").catch(() => undefined);
    }
    await recordCheck(v.id, { published: false, privacy: s.privacyStatus, nextInSeconds: nextCheck(v.checks) });
  } catch (e) {
    // Could not ask (sign-in gone, quota, network): the video is on YouTube either way. Look again later, or stop.
    const gone = e instanceof YoutubeError && (e.code === "needs_reconnect" || e.code === "not_connected");
    await recordCheck(v.id, { published: false, privacy: null, nextInSeconds: gone ? null : nextCheck(v.checks) });
  }
}

let busy = false;
/** One pass: close interrupted uploads, send up to three queued videos, look at processing ones, delete files that are done. */
export async function runCustomerYoutubeWorker(d: WorkerDeps = {}): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (const v of await interruptedUploads()) {
      const message = "The upload was interrupted before YouTube confirmed it. Check your channel in YouTube Studio; if the video is not there, send it again.";
      await failVideo(v.id, "interrupted", message);
      await (d.notify ?? defaultNotify)(v, "failed", message).catch(() => undefined);
    }
    for (let i = 0; i < 3; i++) {
      const v = await claimNextUpload();
      if (!v) break;
      await runUpload(v, d);
    }
    for (const v of await dueChecks()) await runCheck(v, d);
    for (const v of await filesToDelete()) {
      await removeStoredFile(v);
      await markFileDeleted(v.id);
    }
  } finally {
    busy = false;
  }
}

/** Start a pass now (a customer just queued a video) without waiting for the next tick. */
export function kickCustomerYoutubeWorker(): void {
  if (process.env.YOUTUBE_CUSTOMER_WORKER_DISABLED === "true") return;
  void runCustomerYoutubeWorker().catch((e) => console.error("[youtube] customer worker pass failed:", (e as Error)?.message));
}

export function startCustomerYoutubeWorker() {
  if (process.env.YOUTUBE_CUSTOMER_WORKER_DISABLED === "true") return;
  const timer = setInterval(() => void runCustomerYoutubeWorker().catch(async (e) => {
    console.error("[youtube] customer worker tick failed:", (e as Error)?.message);
    const { recordFailure } = await import("../ops/issues");
    void recordFailure("job", "YouTube customer upload worker tick", e);
  }), 15_000);
  timer.unref();
  return timer;
}
