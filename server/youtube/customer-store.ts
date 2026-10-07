/**
 * The Postgres side of customers' YouTube connections, videos and the daily
 * upload counter (tables in ./customer-schema.ts).
 *
 * ISOLATION: every function that reads or changes a customer's data takes that
 * customer's user id and puts it in the WHERE clause — there is no "by id
 * alone" read for a route to misuse. The few functions without a user id
 * (claimNextUpload, dueChecks, expiredFiles …) are the background worker's and
 * are never reachable from a request.
 *
 * Tokens are encrypted at rest (server/gbp/token-crypto.ts) and decrypted only
 * inside customerYoutubeStore(), for the library. Nothing here returns a token
 * to a caller that builds a response: publicVideo() and CustomerStatus are the
 * only shapes routes send.
 */
import { decryptToken, encryptToken } from "../gbp/token-crypto";
import { scrubText } from "../ops/scrub";
import type { CompletedConnect, YoutubeGrant, YoutubeStore } from "./client";

const pool = async () => (await import("../db")).pool;
const scopesOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

/* ── Limits (env) ─────────────────────────────────────────────────────────── */

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
/** Uploads one account may start per Pacific day. */
export const customerDailyCap = (): number => intEnv("YOUTUBE_CUSTOMER_DAILY_UPLOADS", 5, 0, 1000);
/** Uploads the whole Google project may start per Pacific day through customers (the company channel's count too, but are never refused). */
export const projectDailyCap = (): number => intEnv("YOUTUBE_PROJECT_DAILY_UPLOADS", 90, 0, 100000);
/** Largest video a customer may send. Default 1 GB, the same as a JobCam video. */
export const customerMaxBytes = (): number => intEnv("YOUTUBE_CUSTOMER_MAX_BYTES", 1024 * 1024 * 1024, 1024 * 1024, 8 * 1024 * 1024 * 1024);
/** A stored file is deleted this long after it was created, whatever state its row is in. */
export const FILE_TTL_HOURS = 24;
/** The row the project-wide count lives in. */
const PROJECT = 0;
const LOCK_KEY = 7193;
const PACIFIC_DAY = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

/* ── Connection ───────────────────────────────────────────────────────────── */

/** What the customer may see about their own connection: no token, in any form. */
export type CustomerStatus = {
  connected: boolean;
  needsReconnect: boolean;
  channelId: string | null;
  channelTitle: string | null;
  channelThumbnail: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastError: { code: string | null; message: string; at: string | null } | null;
};

export async function customerStatus(userId: number): Promise<CustomerStatus> {
  const { rows: [r] } = await (await pool()).query(
    `SELECT channel_id, channel_title, channel_thumbnail, scopes, connected_at, needs_reconnect,
            (refresh_token IS NOT NULL) AS connected, last_error_code, last_error, last_error_at
       FROM youtube_customer_connections WHERE user_id = $1`, [userId]);
  const connected = !!r?.connected;
  return {
    connected,
    needsReconnect: connected && !!r.needs_reconnect,
    channelId: connected ? r.channel_id : null,
    channelTitle: connected ? r.channel_title : null,
    channelThumbnail: connected ? r.channel_thumbnail ?? null : null,
    scopes: connected ? scopesOf(r.scopes) : [],
    connectedAt: connected ? iso(r.connected_at) : null,
    lastError: r?.last_error ? { code: r.last_error_code ?? null, message: r.last_error, at: iso(r.last_error_at) } : null,
  };
}

/** Save this account's one connection (replacing an earlier channel) and clear the last error. */
export async function saveCustomerConnection(userId: number, c: CompletedConnect): Promise<void> {
  await (await pool()).query(
    `INSERT INTO youtube_customer_connections (user_id, channel_id, channel_title, channel_thumbnail, refresh_token, access_token, expires_at, scopes,
                                               connected_at, needs_reconnect, last_error_code, last_error, last_error_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), false, NULL, NULL, NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET channel_id = $2, channel_title = $3, channel_thumbnail = $4, refresh_token = $5, access_token = $6,
       expires_at = $7, scopes = $8::jsonb, connected_at = now(), needs_reconnect = false,
       last_error_code = NULL, last_error = NULL, last_error_at = NULL, updated_at = now()`,
    [userId, c.channelId, c.channelTitle.slice(0, 200), c.channelThumbnail ?? null, encryptToken(c.refreshToken), encryptToken(c.accessToken), c.expiresAt, JSON.stringify(c.scopes)]);
}

/** Remember why this account's last attempt failed (scrubbed, capped) without touching a working connection. */
export async function recordCustomerError(userId: number, code: string, message: string): Promise<void> {
  await (await pool()).query(
    `INSERT INTO youtube_customer_connections (user_id, last_error_code, last_error, last_error_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET last_error_code = $2, last_error = $3, last_error_at = now(), updated_at = now()`,
    [userId, code.slice(0, 40), scrubText(message, 600)]);
}

/** This account's refresh token, to revoke at Google on disconnect (null when there is none or it cannot be read). */
export async function customerRefreshTokenForRevoke(userId: number): Promise<string | null> {
  const { rows: [r] } = await (await pool()).query(`SELECT refresh_token FROM youtube_customer_connections WHERE user_id = $1`, [userId]);
  try { return decryptToken(r?.refresh_token ?? null); } catch { return null; }
}

/** Delete this account's connection row (channel, tokens, scopes, last error). True when a connection was removed. */
export async function deleteCustomerConnection(userId: number): Promise<boolean> {
  const { rows } = await (await pool()).query(
    `DELETE FROM youtube_customer_connections WHERE user_id = $1 RETURNING (refresh_token IS NOT NULL) AS connected`, [userId]);
  return !!rows[0]?.connected;
}

/** The library's token store for ONE account. */
export function customerYoutubeStore(userId: number): YoutubeStore {
  return {
    async load(): Promise<YoutubeGrant | null> {
      const { rows: [r] } = await (await pool()).query(
        `SELECT channel_id, refresh_token, access_token, expires_at, scopes, needs_reconnect FROM youtube_customer_connections WHERE user_id = $1`, [userId]);
      if (!r?.refresh_token) return null;
      return {
        channelId: r.channel_id,
        refreshToken: decryptToken(r.refresh_token),
        accessToken: decryptToken(r.access_token),
        expiresAt: r.expires_at ? new Date(r.expires_at) : null,
        scopes: scopesOf(r.scopes),
        needsReconnect: !!r.needs_reconnect,
      };
    },
    async saveAccess(t) {
      await (await pool()).query(
        `UPDATE youtube_customer_connections SET access_token = $2, expires_at = $3, refresh_token = COALESCE($4, refresh_token), updated_at = now() WHERE user_id = $1`,
        [userId, encryptToken(t.accessToken), t.expiresAt, encryptToken(t.refreshToken)]);
    },
    async markNeedsReconnect(reason) {
      await (await pool()).query(
        `UPDATE youtube_customer_connections SET needs_reconnect = true, access_token = NULL, expires_at = NULL,
                last_error_code = 'needs_reconnect', last_error = $2, last_error_at = now(), updated_at = now() WHERE user_id = $1`,
        [userId, scrubText(reason, 600)]);
    },
  };
}

/* ── Videos ───────────────────────────────────────────────────────────────── */

export type VideoState = "receiving" | "ready" | "queued" | "uploading" | "processing" | "published" | "failed";
export type VideoPrivacy = "public" | "unlisted" | "private";

/** The full row, for the routes' own checks and the worker. Never sent to a browser as is. */
export type VideoRow = {
  id: string; user_id: number; file_name: string; mime: string; bytes: number;
  storage_mode: "r2" | "local"; storage_key: string; storage_upload_id: string | null;
  part_size: number; parts_total: number; parts_done: Record<string, string>; file_deleted_at: Date | null;
  state: VideoState; title: string | null; description: string | null; tags: string[]; privacy: VideoPrivacy | null;
  made_for_kids: boolean | null; certified_at: Date | null; channel_id: string | null; channel_title: string | null;
  youtube_video_id: string | null; actual_privacy: string | null; sent_bytes: number; quota_day: string | null; quota_spent: boolean;
  error_code: string | null; error: string | null; checks: number; queued_at: Date | null; published_at: Date | null; created_at: Date; updated_at: Date;
};
const row = (r: any): VideoRow => ({ ...r, bytes: Number(r.bytes), sent_bytes: Number(r.sent_bytes), tags: scopesOf(r.tags), parts_done: r.parts_done ?? {} });

/** What a customer sees of one of their videos: no storage key, no upload id. */
export function publicVideo(v: VideoRow) {
  return {
    id: v.id,
    fileName: v.file_name,
    bytes: v.bytes,
    state: v.state,
    fileAvailable: !v.file_deleted_at && v.state !== "receiving",
    title: v.title,
    privacy: v.privacy,
    actualPrivacy: v.actual_privacy,
    madeForKids: v.made_for_kids,
    channelTitle: v.channel_title,
    sentBytes: v.sent_bytes,
    videoId: v.youtube_video_id,
    watchUrl: v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null,
    errorCode: v.error_code,
    error: v.error,
    createdAt: iso(v.created_at),
    publishedAt: iso(v.published_at),
  };
}
export type PublicVideo = ReturnType<typeof publicVideo>;

export async function insertVideo(v: {
  id: string; userId: number; fileName: string; mime: string; bytes: number; storageMode: string; storageKey: string;
  storageUploadId: string | null; partSize: number; partsTotal: number;
}): Promise<VideoRow> {
  const { rows: [r] } = await (await pool()).query(
    `INSERT INTO youtube_customer_videos (id, user_id, file_name, mime, bytes, storage_mode, storage_key, storage_upload_id, part_size, parts_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [v.id, v.userId, v.fileName, v.mime, v.bytes, v.storageMode, v.storageKey, v.storageUploadId, v.partSize, v.partsTotal]);
  return row(r);
}

/** One of THIS account's videos, or null — another account's id is simply not found. */
export async function getVideo(userId: number, id: string): Promise<VideoRow | null> {
  const { rows: [r] } = await (await pool()).query(`SELECT * FROM youtube_customer_videos WHERE user_id = $1 AND id = $2`, [userId, id]);
  return r ? row(r) : null;
}

export async function listVideos(userId: number, limit = 25): Promise<VideoRow[]> {
  const { rows } = await (await pool()).query(
    `SELECT * FROM youtube_customer_videos WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2`, [userId, limit]);
  return rows.map(row);
}

/** How many files this account has in our storage right now (arriving or waiting) — a brake on filling the bucket. */
export async function openFileCount(userId: number): Promise<number> {
  const { rows: [r] } = await (await pool()).query(
    `SELECT count(*)::int AS n FROM youtube_customer_videos WHERE user_id = $1 AND file_deleted_at IS NULL`, [userId]);
  return r?.n ?? 0;
}

export async function recordVideoPart(userId: number, id: string, n: number, etag: string): Promise<number> {
  const { rows: [r] } = await (await pool()).query(
    `UPDATE youtube_customer_videos SET parts_done = parts_done || jsonb_build_object($3::text, $4::text), updated_at = now()
      WHERE user_id = $1 AND id = $2 AND state = 'receiving' RETURNING parts_done`,
    [userId, id, String(n), etag]);
  return r ? Object.keys(r.parts_done ?? {}).length : 0;
}

/** receiving → ready, once. False when another request already moved it. */
export async function markVideoReady(userId: number, id: string): Promise<boolean> {
  const r = await (await pool()).query(
    `UPDATE youtube_customer_videos SET state = 'ready', updated_at = now() WHERE user_id = $1 AND id = $2 AND state = 'receiving'`, [userId, id]);
  return (r.rowCount ?? 0) > 0;
}

export type DailyUsage = { usedByCustomer: number; usedByProject: number; customerCap: number; projectCap: number };
export async function dailyUsage(userId: number): Promise<DailyUsage> {
  const { rows } = await (await pool()).query(
    `SELECT user_id, used FROM youtube_upload_daily WHERE day = ${PACIFIC_DAY} AND user_id = ANY($1::int[])`, [[userId, PROJECT]]);
  const of = (id: number) => Number(rows.find((r: any) => r.user_id === id)?.used ?? 0);
  return { usedByCustomer: of(userId), usedByProject: of(PROJECT), customerCap: customerDailyCap(), projectCap: projectDailyCap() };
}

export type PublishMeta = { title: string; description: string; tags: string[]; privacy: VideoPrivacy; madeForKids: boolean; channelId: string; channelTitle: string };
export type QueueResult = { ok: true; video: VideoRow } | { ok: false; reason: "not_ready" | "customer_cap" | "project_cap" };

/**
 * Queue one of THIS account's stored videos for upload and count it against
 * today's allowance — one transaction under one lock, so two clicks (or two
 * customers at the last free slot) cannot both get through.
 */
export async function queueVideo(userId: number, id: string, m: PublishMeta): Promise<QueueResult> {
  const client = await (await pool()).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, 0)", [LOCK_KEY]);
    const { rows: [day] } = await client.query(`SELECT ${PACIFIC_DAY}::text AS day`);
    const { rows: used } = await client.query(`SELECT user_id, used FROM youtube_upload_daily WHERE day = $1::date AND user_id = ANY($2::int[])`, [day.day, [userId, PROJECT]]);
    const of = (who: number) => Number(used.find((r: any) => r.user_id === who)?.used ?? 0);
    const refuse = async (reason: "not_ready" | "customer_cap" | "project_cap"): Promise<QueueResult> => { await client.query("ROLLBACK"); return { ok: false, reason }; };
    if (of(userId) >= customerDailyCap()) return await refuse("customer_cap");
    if (of(PROJECT) >= projectDailyCap()) return await refuse("project_cap");
    const { rows: [r] } = await client.query(
      `UPDATE youtube_customer_videos SET state = 'queued', title = $3, description = $4, tags = $5::jsonb, privacy = $6, made_for_kids = $7,
              certified_at = now(), channel_id = $8, channel_title = $9, quota_day = $10::date, quota_spent = false, sent_bytes = 0,
              youtube_video_id = NULL, actual_privacy = NULL, error_code = NULL, error = NULL, checks = 0, next_check_at = NULL,
              lease_until = NULL, queued_at = now(), published_at = NULL, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND state IN ('ready','failed') AND file_deleted_at IS NULL AND youtube_video_id IS NULL
        RETURNING *`,
      [userId, id, m.title, m.description, JSON.stringify(m.tags), m.privacy, m.madeForKids, m.channelId, m.channelTitle, day.day]);
    if (!r) return await refuse("not_ready");
    await client.query(
      `INSERT INTO youtube_upload_daily (day, user_id, used) VALUES ($1::date, $2, 1), ($1::date, $3, 1)
       ON CONFLICT (day, user_id) DO UPDATE SET used = youtube_upload_daily.used + 1`, [day.day, userId, PROJECT]);
    await client.query("COMMIT");
    return { ok: true, video: row(r) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Remove one of THIS account's video records. Refused (null) while the upload
 * to YouTube is running. The caller deletes the stored file of the row it gets back.
 */
export async function deleteVideo(userId: number, id: string): Promise<VideoRow | null> {
  const { rows: [r] } = await (await pool()).query(
    `DELETE FROM youtube_customer_videos WHERE user_id = $1 AND id = $2 AND state <> 'uploading' RETURNING *, quota_day::text AS quota_day_text`, [userId, id]);
  if (r?.state === "queued") await refund(r.user_id, r.quota_day_text);
  return r ? row(r) : null;
}

/** Remove every video record of THIS account (disconnect, account deletion). The caller deletes the files. */
export async function deleteAllVideos(userId: number): Promise<VideoRow[]> {
  const { rows } = await (await pool()).query(`DELETE FROM youtube_customer_videos WHERE user_id = $1 RETURNING *`, [userId]);
  return rows.map(row);
}

async function refund(userId: number, day: unknown): Promise<void> {
  if (!day) return;
  await (await pool()).query(
    `UPDATE youtube_upload_daily SET used = GREATEST(used - 1, 0) WHERE day = $1::date AND user_id = ANY($2::int[])`, [day, [userId, PROJECT]]);
}

/* ── Background worker only (no request reaches these) ────────────────────── */

/** Lease the oldest queued video. A second worker skips a leased row. */
export async function claimNextUpload(): Promise<VideoRow | null> {
  const { rows: [r] } = await (await pool()).query(
    `UPDATE youtube_customer_videos SET state = 'uploading', lease_until = now() + interval '15 minutes', updated_at = now()
      WHERE id = (SELECT id FROM youtube_customer_videos WHERE state = 'queued' ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`);
  return r ? row(r) : null;
}

/** Still working: push the lease out and record how far the upload is. */
export async function heartbeat(id: string, sentBytes: number): Promise<void> {
  await (await pool()).query(
    `UPDATE youtube_customer_videos SET lease_until = now() + interval '15 minutes', sent_bytes = $2, updated_at = now() WHERE id = $1 AND state = 'uploading'`, [id, sentBytes]);
}

/** From here on YouTube may have counted the upload against the quota, so a failure is not refunded. */
export async function markQuotaSpent(id: string): Promise<void> {
  await (await pool()).query(`UPDATE youtube_customer_videos SET quota_spent = true WHERE id = $1`, [id]);
}

export async function finishUpload(id: string, r: { videoId: string; privacy: string | null; processed: boolean }): Promise<void> {
  await (await pool()).query(
    `UPDATE youtube_customer_videos SET state = $4, youtube_video_id = $2, actual_privacy = $3, sent_bytes = bytes, lease_until = NULL,
            next_check_at = CASE WHEN $4 = 'processing' THEN now() + interval '30 seconds' END,
            published_at = CASE WHEN $4 = 'published' THEN now() END, updated_at = now()
      WHERE id = $1 AND state = 'uploading'`, [id, r.videoId, r.privacy, r.processed ? "published" : "processing"]);
}

/** uploading | processing → failed, with a message written for the customer. An upload that never reached YouTube is not counted. */
export async function failVideo(id: string, code: string, message: string): Promise<void> {
  const { rows: [r] } = await (await pool()).query(
    `UPDATE youtube_customer_videos SET state = 'failed', error_code = $2, error = $3, lease_until = NULL, next_check_at = NULL, updated_at = now()
      WHERE id = $1 AND state IN ('uploading','processing') RETURNING user_id, quota_day::text AS quota_day, quota_spent`, [id, code.slice(0, 40), scrubText(message, 600)]);
  if (r && !r.quota_spent) await refund(r.user_id, r.quota_day);
}

/** Uploads whose worker died (restart, crash): the lease ran out with nobody extending it. */
export async function interruptedUploads(): Promise<VideoRow[]> {
  const { rows } = await (await pool()).query(`SELECT * FROM youtube_customer_videos WHERE state = 'uploading' AND lease_until < now() LIMIT 20`);
  return rows.map(row);
}

/** Videos YouTube is still processing whose next look is due. */
export async function dueChecks(limit = 10): Promise<VideoRow[]> {
  const { rows } = await (await pool()).query(
    `SELECT * FROM youtube_customer_videos WHERE state = 'processing' AND next_check_at <= now() ORDER BY next_check_at LIMIT $1`, [limit]);
  return rows.map(row);
}

/** The outcome of one look: published, or look again later (null delay = stop looking; the row stays "processing"). */
export async function recordCheck(id: string, r: { published: boolean; privacy: string | null; nextInSeconds: number | null }): Promise<void> {
  await (await pool()).query(
    `UPDATE youtube_customer_videos SET checks = checks + 1, actual_privacy = COALESCE($3, actual_privacy),
            state = CASE WHEN $2 THEN 'published' ELSE state END,
            published_at = CASE WHEN $2 THEN now() ELSE published_at END,
            next_check_at = CASE WHEN $2 OR $4::int IS NULL THEN NULL ELSE now() + make_interval(secs => $4::int) END, updated_at = now()
      WHERE id = $1 AND state = 'processing'`, [id, r.published, r.privacy, r.nextInSeconds]);
}

/**
 * Rows whose stored file should go now: YouTube has the video, or the file is
 * older than FILE_TTL_HOURS. A running upload is left alone.
 */
export async function filesToDelete(limit = 20): Promise<VideoRow[]> {
  const { rows } = await (await pool()).query(
    `SELECT * FROM youtube_customer_videos
      WHERE file_deleted_at IS NULL AND state NOT IN ('uploading','queued')
        AND (state IN ('processing','published') OR created_at < now() - make_interval(hours => $1))
      ORDER BY created_at LIMIT $2`, [FILE_TTL_HOURS, limit]);
  return rows.map(row);
}

/** The file is gone. A row that never became a YouTube video has nothing left to show, so it goes too. */
export async function markFileDeleted(id: string): Promise<void> {
  const db = await pool();
  await db.query(`DELETE FROM youtube_customer_videos WHERE id = $1 AND state IN ('receiving','ready')`, [id]);
  await db.query(`UPDATE youtube_customer_videos SET file_deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
}

/** The company channel uploaded a video: count it in the project's day (never refused, never per-customer). */
export async function noteCompanyUpload(): Promise<void> {
  await (await pool()).query(
    `INSERT INTO youtube_upload_daily (day, user_id, used) VALUES (${PACIFIC_DAY}, $1, 1)
     ON CONFLICT (day, user_id) DO UPDATE SET used = youtube_upload_daily.used + 1`, [PROJECT]);
}
