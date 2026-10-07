/**
 * Per-org JobCam storage meter (jobcam_org_usage): bytes of originals +
 * renditions and media counts. The processor adds on ready, the delete routes
 * subtract, and recountJobcamUsage() rebuilds the row from jobcam_media when
 * the two drift (boot runs it for orgs with media).
 */
import { pool } from "../db";

export type JobcamUsage = { bytes: number; mediaCount: number; photoCount: number; videoCount: number };

export async function bumpJobcamUsage(orgId: string, delta: { bytes: number; kind: "photo" | "video"; count: number }): Promise<void> {
  const photo = delta.kind === "photo" ? delta.count : 0;
  const video = delta.kind === "video" ? delta.count : 0;
  await pool.query(
    `INSERT INTO jobcam_org_usage (org_id, bytes, media_count, photo_count, video_count, updated_at)
     VALUES ($1, GREATEST(0,$2::bigint), GREATEST(0,$3), GREATEST(0,$4), GREATEST(0,$5), now())
     ON CONFLICT (org_id) DO UPDATE SET
       bytes = GREATEST(0, jobcam_org_usage.bytes + $2::bigint),
       media_count = GREATEST(0, jobcam_org_usage.media_count + $3),
       photo_count = GREATEST(0, jobcam_org_usage.photo_count + $4),
       video_count = GREATEST(0, jobcam_org_usage.video_count + $5),
       updated_at = now()`,
    [orgId, Math.round(delta.bytes), delta.count, photo, video],
  );
}

export async function recountJobcamUsage(orgId: string): Promise<JobcamUsage> {
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(SUM(bytes + rendition_bytes),0)::bigint AS bytes,
            COUNT(*)::int AS media_count,
            COUNT(*) FILTER (WHERE kind='photo')::int AS photo_count,
            COUNT(*) FILTER (WHERE kind='video')::int AS video_count
       FROM jobcam_media WHERE org_id=$1 AND deleted_at IS NULL AND status='ready'`, [orgId]);
  const u: JobcamUsage = { bytes: Number(r.bytes), mediaCount: r.media_count, photoCount: r.photo_count, videoCount: r.video_count };
  await pool.query(
    `INSERT INTO jobcam_org_usage (org_id, bytes, media_count, photo_count, video_count, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (org_id) DO UPDATE SET bytes=$2, media_count=$3, photo_count=$4, video_count=$5, updated_at=now()`,
    [orgId, u.bytes, u.mediaCount, u.photoCount, u.videoCount]);
  return u;
}

export async function getJobcamUsage(orgId: string): Promise<JobcamUsage> {
  const { rows: [r] } = await pool.query(
    `SELECT bytes, media_count, photo_count, video_count FROM jobcam_org_usage WHERE org_id=$1`, [orgId]);
  if (!r) return { bytes: 0, mediaCount: 0, photoCount: 0, videoCount: 0 };
  return { bytes: Number(r.bytes), mediaCount: r.media_count, photoCount: r.photo_count, videoCount: r.video_count };
}
