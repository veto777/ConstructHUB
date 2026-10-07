/**
 * JobCam storage — the platform admin side.
 *
 *   GET  /api/admin/jobcam/storage                 every org with JobCam activity: used / size, open requests
 *   POST /api/admin/jobcam/storage-tier            { orgId, tierGb } — set an org's storage size
 *   POST /api/admin/jobcam/storage-requests/:id/dismiss
 *
 * Sizes above the included one have no price yet (shared/jobcam-storage.ts),
 * so nobody can buy one: a ConstructHUB admin sets it here, usually in answer
 * to a "Request more storage" from the workspace. Same gate as every other
 * /api/admin route (requirePlatformAdmin: the admin list + the second factor);
 * every change is written to admin_audit_log.
 */
import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requirePlatformAdmin } from "../crm/admin";
import { isJobcamStorageTier, jobcamStorageState, jobcamTierOrIncluded, JOBCAM_STORAGE_TIERS_GB } from "@shared/jobcam-storage";
import { closeJobcamStorageRequests, JobcamTierError, setJobcamStorageTier } from "./usage";

type GetUser = (req: any, res: any) => any;

async function audit(actor: { id: number; email: string }, action: string, target: string | null, parameters: Record<string, unknown>, error?: string) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (actor_email, actor_id, action, target_account_name, parameters, result, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.email, actor.id, action, target, JSON.stringify(parameters), error ? "error" : "success", error ?? null]);
  } catch (err) {
    console.error("[jobcam-admin] could not write the admin audit log:", (err as Error)?.message || err);
  }
}

export function registerJobcamAdminRoutes(app: Express, getDevUser: GetUser): void {
  app.get("/api/admin/jobcam/storage", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    // Every org is listed (an org that has never uploaded sits on the included size).
    const { rows } = await pool.query(
      `SELECT o.id, o.name, ow.email AS owner_email,
              COALESCE(u.bytes, 0)::bigint AS bytes, COALESCE(u.media_count, 0) AS media_count, u.storage_tier_gb,
              r.id AS request_id, r.created_at AS requested_at, r.tier_gb AS request_tier_gb
         FROM crm_orgs o
         LEFT JOIN users ow ON ow.id = o.owner_user_id
         LEFT JOIN jobcam_org_usage u ON u.org_id = o.id
         LEFT JOIN jobcam_storage_requests r ON r.org_id = o.id AND r.status = 'open'
        ORDER BY (r.id IS NULL), COALESCE(u.bytes, 0) DESC, o.name
        LIMIT 2000`);
    res.json({
      tiersGb: JOBCAM_STORAGE_TIERS_GB,
      orgs: rows.map((r: any) => {
        const state = jobcamStorageState(Number(r.bytes), jobcamTierOrIncluded(r.storage_tier_gb));
        return {
          id: r.id, name: r.name, ownerEmail: r.owner_email ?? null, mediaCount: Number(r.media_count),
          usedBytes: state.usedBytes, tierGb: state.tierGb, limitBytes: state.limitBytes, label: state.label,
          warn: state.warn, full: state.full, overLimit: state.usedBytes > state.limitBytes,
          request: r.request_id ? { id: r.request_id, requestedAt: r.requested_at, tierGb: r.request_tier_gb } : null,
        };
      }),
    });
  });

  app.post("/api/admin/jobcam/storage-tier", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const parsed = z.object({ orgId: z.string().min(1).max(64), tierGb: z.number() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: `Send { orgId, tierGb } — tierGb one of ${JOBCAM_STORAGE_TIERS_GB.join(", ")}.`, code: "invalid_tier", tiersGb: JOBCAM_STORAGE_TIERS_GB });
    const { orgId, tierGb } = parsed.data;
    if (!isJobcamStorageTier(tierGb)) {
      await audit(admin, "jobcam_storage_tier", null, { orgId, tierGb }, "invalid size");
      return res.status(400).json({ message: `Storage size must be one of ${JOBCAM_STORAGE_TIERS_GB.join(", ")} GB.`, code: "invalid_tier", tiersGb: JOBCAM_STORAGE_TIERS_GB });
    }
    const { rows: [org] } = await pool.query(`SELECT id, name FROM crm_orgs WHERE id = $1`, [orgId]);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    try {
      const changed = await setJobcamStorageTier(orgId, tierGb);
      const closed = await closeJobcamStorageRequests(orgId, "resolved", admin.email);
      await audit(admin, "jobcam_storage_tier", org.name, { orgId, tierGb: changed.tierGb, previousGb: changed.previousGb, requestsClosed: closed });
      const { rows: [u] } = await pool.query(`SELECT bytes FROM jobcam_org_usage WHERE org_id = $1`, [orgId]);
      const state = jobcamStorageState(Number(u?.bytes ?? 0), changed.tierGb);
      res.json({ ok: true, orgId, ...changed, usedBytes: state.usedBytes, limitBytes: state.limitBytes, overLimit: state.usedBytes > state.limitBytes });
    } catch (e: any) {
      if (e instanceof JobcamTierError) {
        await audit(admin, "jobcam_storage_tier", org.name, { orgId, tierGb }, e.message);
        return res.status(400).json({ message: e.message, code: "invalid_tier", tiersGb: JOBCAM_STORAGE_TIERS_GB });
      }
      throw e;
    }
  });

  app.post("/api/admin/jobcam/storage-requests/:id/dismiss", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const { rows: [r] } = await pool.query(`SELECT org_id FROM jobcam_storage_requests WHERE id = $1 AND status = 'open'`, [String(req.params.id)]);
    if (!r) return res.status(404).json({ message: "Request not found" });
    await closeJobcamStorageRequests(r.org_id, "dismissed", admin.email);
    await audit(admin, "jobcam_storage_request_dismissed", null, { orgId: r.org_id, requestId: req.params.id });
    res.json({ ok: true });
  });
}
