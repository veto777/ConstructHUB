/**
 * Per-org JobCam storage meter (jobcam_org_usage): bytes of originals +
 * renditions and media counts. The processor adds on ready, the delete routes
 * subtract, and recountJobcamUsage() rebuilds the row from jobcam_media when
 * the two drift (boot runs it for orgs with media).
 */
import { sql, type SQL } from "drizzle-orm";
import { db, pool } from "../db";
import {
  isJobcamStorageTier, jobcamStorageFits, jobcamStorageLimitBody, jobcamStorageState, jobcamTierOrIncluded,
  JOBCAM_STORAGE_TIERS_GB, type JobcamStorageTierGb,
} from "@shared/jobcam-storage";
import { UPLOAD_TTL_MS } from "./upload-state";
import { getCrmEntitlements } from "../crm/entitlements";

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

// ── Storage size + enforcement (shared/jobcam-storage.ts) ────────────────────

/** `db` or a drizzle transaction — both run raw SQL the same way. */
type Exec = { execute: (q: SQL) => Promise<{ rows: any[] }> };
export type JobcamStorageTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type JobcamStorageSnapshot = {
  /** Stored bytes the meter counts: originals + renditions of ready media. */
  usedBytes: number;
  /** Declared bytes on their way in: open uploads plus uploads the processor has not finished. */
  pendingBytes: number;
  tierGb: JobcamStorageTierGb;
};

/**
 * The storage the org's CRM plan includes (CrmPlanLimits.jobcamStorageGb: 5 GB,
 * 1 TB on Elite). The org's own size (set by an admin) counts when it is larger.
 */
async function planJobcamStorageGb(orgId: string, exec: Exec): Promise<number> {
  const { rows: [o] } = await exec.execute(sql`SELECT owner_user_id FROM crm_orgs WHERE id = ${orgId}`);
  if (!o?.owner_user_id) return 0;
  const crm = await getCrmEntitlements(Number(o.owner_user_id));
  return crm.active ? crm.limits?.jobcamStorageGb ?? 0 : 0;
}

/** The row every read assumes: an org that has never uploaded still has a size (the included one). */
export async function ensureJobcamUsageRow(orgId: string, exec: Exec = db): Promise<void> {
  await exec.execute(sql`INSERT INTO jobcam_org_usage (org_id) VALUES (${orgId}) ON CONFLICT (org_id) DO NOTHING`);
}

/**
 * Where the org stands. `lock` (inside a transaction) holds the org's usage
 * row FOR UPDATE, so two uploads opened at the same moment are checked one
 * after the other and the second one sees the first one's reservation.
 * `excludeUploadId` leaves one open upload out of pendingBytes (the one being
 * completed is the thing being measured, not something else in flight).
 */
export async function jobcamStorageSnapshot(orgId: string, opts: { exec?: Exec; lock?: boolean; excludeUploadId?: string | null } = {}): Promise<JobcamStorageSnapshot> {
  const exec = opts.exec ?? db;
  await ensureJobcamUsageRow(orgId, exec);
  const { rows: [u] } = await exec.execute(
    sql`SELECT bytes, storage_tier_gb FROM jobcam_org_usage WHERE org_id = ${orgId} ${opts.lock ? sql`FOR UPDATE` : sql``}`);
  const ttl = `${Math.round(UPLOAD_TTL_MS / 1000)} seconds`;
  const { rows: [p] } = await exec.execute(sql`
    SELECT (
      (SELECT COALESCE(SUM(bytes), 0) FROM jobcam_uploads
        WHERE org_id = ${orgId} AND status = 'open' AND created_at > now() - ${ttl}::interval
          AND id <> ${opts.excludeUploadId ?? ""})
      +
      (SELECT COALESCE(SUM(bytes), 0) FROM jobcam_media
        WHERE org_id = ${orgId} AND status = 'processing' AND deleted_at IS NULL)
    )::bigint AS pending`);
  const orgGb = jobcamTierOrIncluded(u?.storage_tier_gb);
  const planGb = await planJobcamStorageGb(orgId, exec);
  return { usedBytes: Number(u?.bytes ?? 0), pendingBytes: Number(p?.pending ?? 0), tierGb: jobcamTierOrIncluded(Math.max(orgGb, planGb)) };
}

export type JobcamStorageRefusal = ReturnType<typeof jobcamStorageLimitBody>;

/** null when `addBytes` more fit, else the 403 limit_reached body. */
export function jobcamStorageRefusal(snap: JobcamStorageSnapshot, addBytes: number): JobcamStorageRefusal | null {
  const args = { usedBytes: snap.usedBytes, pendingBytes: snap.pendingBytes, addBytes, tierGb: snap.tierGb };
  return jobcamStorageFits(args) ? null : jobcamStorageLimitBody(args);
}

/**
 * Check-then-write under the org's storage lock. `fn` runs only when
 * `addBytes` fit and must record the reservation in the SAME transaction (the
 * open route inserts its jobcam_uploads row there) — that row is what the next
 * caller's pendingBytes counts.
 */
export async function withJobcamStorageRoom<T>(
  orgId: string, addBytes: number, fn: (tx: JobcamStorageTx, snap: JobcamStorageSnapshot) => Promise<T>,
  opts: { excludeUploadId?: string | null } = {},
): Promise<{ ok: true; value: T } | { ok: false; refusal: JobcamStorageRefusal }> {
  return db.transaction(async (tx) => {
    const snap = await jobcamStorageSnapshot(orgId, { exec: tx, lock: true, excludeUploadId: opts.excludeUploadId });
    const refusal = jobcamStorageRefusal(snap, addBytes);
    if (refusal) return { ok: false as const, refusal };
    return { ok: true as const, value: await fn(tx, snap) };
  });
}

/** The storage meter the API presents (GET /api/crm/jobcam/usage, the admin list). */
export async function getJobcamStorage(orgId: string) {
  const snap = await jobcamStorageSnapshot(orgId);
  const state = jobcamStorageState(snap.usedBytes, snap.tierGb, snap.pendingBytes);
  return {
    tierGb: state.tierGb, limitBytes: state.limitBytes, pendingBytes: state.pendingBytes,
    nextTierGb: state.nextTierGb, warn: state.warn, full: state.full, label: state.label,
  };
}

export class JobcamTierError extends Error {}

/**
 * Set an org's storage size. The size must be on the list. Lowering it below
 * what is stored is allowed: nothing is deleted, new uploads are refused until
 * the org is under the limit again.
 */
export async function setJobcamStorageTier(orgId: string, tierGb: unknown): Promise<{ previousGb: JobcamStorageTierGb; tierGb: JobcamStorageTierGb }> {
  if (!isJobcamStorageTier(tierGb)) {
    throw new JobcamTierError(`Storage size must be one of ${JOBCAM_STORAGE_TIERS_GB.join(", ")} GB.`);
  }
  await ensureJobcamUsageRow(orgId);
  const { rows: [row] } = await pool.query(
    `UPDATE jobcam_org_usage u SET storage_tier_gb = $2, updated_at = now()
       FROM (SELECT storage_tier_gb FROM jobcam_org_usage WHERE org_id = $1 FOR UPDATE) old
      WHERE u.org_id = $1 RETURNING old.storage_tier_gb AS previous`, [orgId, tierGb]);
  return { previousGb: jobcamTierOrIncluded(row?.previous), tierGb };
}

// ── "Request more storage" ───────────────────────────────────────────────────

/** One open request per org; asking again returns the same one. */
export async function requestJobcamStorage(orgId: string, memberId: string | null): Promise<{ id: string; createdAt: Date; existed: boolean }> {
  const snap = await jobcamStorageSnapshot(orgId);
  const { rows: [made] } = await pool.query(
    `INSERT INTO jobcam_storage_requests (org_id, member_id, tier_gb, used_bytes) VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id) WHERE status = 'open' DO NOTHING RETURNING id, created_at`,
    [orgId, memberId, snap.tierGb, snap.usedBytes]);
  if (made) return { id: made.id, createdAt: made.created_at, existed: false };
  const { rows: [open] } = await pool.query(
    `SELECT id, created_at FROM jobcam_storage_requests WHERE org_id = $1 AND status = 'open' LIMIT 1`, [orgId]);
  return { id: open.id, createdAt: open.created_at, existed: true };
}

export async function openJobcamStorageRequest(orgId: string): Promise<{ id: string; createdAt: Date } | null> {
  const { rows: [r] } = await pool.query(
    `SELECT id, created_at FROM jobcam_storage_requests WHERE org_id = $1 AND status = 'open' LIMIT 1`, [orgId]);
  return r ? { id: r.id, createdAt: r.created_at } : null;
}

/** Close an org's open request: `resolved` when its size was changed, `dismissed` when an admin waved it off. */
export async function closeJobcamStorageRequests(orgId: string, status: "resolved" | "dismissed", by: string): Promise<number> {
  const r = await pool.query(
    `UPDATE jobcam_storage_requests SET status = $2, resolved_by = $3, resolved_at = now() WHERE org_id = $1 AND status = 'open'`,
    [orgId, status, by]);
  return r.rowCount ?? 0;
}
