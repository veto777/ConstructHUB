/**
 * Public API — Site Scan WRITE resource (`sitescan`), mounted by lane 1 at
 * `${GROWTH_BASE}/sitescan`:
 *
 *   POST /scans   start a Site Scan of a public website (or of a synced GBP
 *                 location's website); counts against the plan's monthly Site
 *                 Scan allowance exactly like the Site Scan page
 *
 * A 5-unit write. The scan is queued for the existing worker; the report is
 * read back through the read resources. Only the crawl is started here — the
 * AI action plan (POST /api/sitescan/jobs/:id/plan) is a session-only feature
 * and is not reachable through the API. The queue insert mirrors
 * server/sitescan/worker.ts enqueue()/profileFor() on purpose: importing the
 * worker would pull sitescan/providers.ts (the AI provider) into this module.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { takeBudget } from "../../growth-limits";
import { reserveQuotaFor as reserveQuota, refundReservation } from "../../growth-quotas";
import { logActivity } from "../../account-events";
import { siteUrl } from "../../sitescan/http";
import { emptyState } from "../../sitescan/audit";
import { GROWTH_BASE, handle, jsonError, openapiCommon, requireWriteScope, type ApiKeyContext } from "./shared-write";

export type SitescanWriteDeps = { reserveQuotaFor: typeof reserveQuota; enqueue: typeof enqueueScan };
const DAY = 86400_000;
/** Same per-account daily cap as the Site Scan page (sitescan/routes.ts). */
export const DAILY_SCAN_CAP = 5;

export const siteScanInput = z.object({
  url: z.string().max(2048).optional(),
  locationId: z.number().int().positive().optional(),
  pageCap: z.number().int().min(1).max(500).default(150),
  psiPages: z.number().int().min(0).max(5).default(1),
}).strict().refine((v) => v.url || v.locationId, { message: "Provide url or locationId", path: ["url"] });

/** A synced GBP location's profile snapshot (what the Site Scan compares the site against); null when none is synced. */
async function profileFor(user: number, id?: number) {
  const { rows: [p] } = await pool.query(
    `SELECT l.id,s.profile_snapshot,s.last_success AS synced_at
       FROM business_locations l JOIN gbp_sync_status s ON s.location_id=l.id AND s.kind='profile' AND s.last_success IS NOT NULL AND s.profile_snapshot IS NOT NULL
      WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL AND ($2::integer IS NULL OR l.id=$2) ORDER BY l.id LIMIT 1`,
    [user, id ?? null],
  );
  return p ? { ...p.profile_snapshot, id: p.id, synced_at: p.synced_at } : null;
}

/** Queue a scan row for the worker (status 'queued', an empty crawl state). */
export async function enqueueScan(user: number, url: string, cap: number, psi: number, profile: any = null) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO sitescan_jobs(id,user_id,url,page_cap,psi_pages,profile,state) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, user, url, cap, psi, profile, emptyState(url)],
  );
  return id;
}
export const sitescanWriteDefaults: SitescanWriteDeps = { reserveQuotaFor: reserveQuota, enqueue: enqueueScan };

export type StartScanResult =
  | { ok: true; scan: { id: string; url: string; status: "queued"; pageCap: number; psiPages: number; locationId: number | null } }
  | { ok: false; status: 400 | 402 | 403 | 429; code: string; message: string; body?: Record<string, unknown> };

/** Reserve one Site Scan from the plan, then queue the crawl; the reservation is refunded when nothing was queued. */
export async function startSiteScan(userId: number, raw: unknown, meta: { keyId: string; req?: Request | null }, deps: SitescanWriteDeps = sitescanWriteDefaults): Promise<StartScanResult> {
  const body = siteScanInput.parse(raw);
  const profile = body.locationId || !body.url ? await profileFor(userId, body.locationId) : null;
  if (body.locationId && !profile) return { ok: false, status: 400, code: "location_not_synced", message: "Sync the selected GBP profile before scanning." };
  let url: string;
  try { url = siteUrl(body.url || profile?.website || ""); }
  catch { return { ok: false, status: 400, code: "invalid_url", message: "Enter a public HTTP or HTTPS website URL." }; }
  const quota = await deps.reserveQuotaFor(userId, "siteScans", 1);
  if (!quota.ok) return { ok: false, status: quota.status === 401 ? 402 : quota.status, code: String(quota.body.code ?? "quota"), message: String(quota.body.message ?? "Site Scan is not available on this plan."), body: quota.body };
  if (!(await takeBudget("sitescan:scan:" + userId, DAILY_SCAN_CAP, 1, DAY))) {
    await refundReservation(quota.reservation, 1);
    return { ok: false, status: 429, code: "daily_limit", message: `Daily scan budget reached (${DAILY_SCAN_CAP}).` };
  }
  let id: string;
  try { id = await deps.enqueue(userId, url, body.pageCap, body.psiPages, profile); }
  catch (e) { await refundReservation(quota.reservation, 1); throw e; } // the scan never started
  await logActivity(meta.req ?? null, userId, "api.sitescan.started", { id, url, keyId: meta.keyId, locationId: profile?.id ?? null }).catch(() => {});
  return { ok: true, scan: { id, url, status: "queued", pageCap: body.pageCap, psiPages: body.psiPages, locationId: profile?.id ?? null } };
}

export function sitescanWriteRouter(deps: SitescanWriteDeps = sitescanWriteDefaults) {
  const router = Router();
  router.post("/scans", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const result = await startSiteScan(key.userId, req.body ?? {}, { keyId: key.id, req }, deps);
    if (!result.ok) {
      if (result.status === 429) res.setHeader("Retry-After", String(DAY / 1000));
      // The quota body's own fields (requiredPlan, limit, used, resetsAt, upgradePlan, addon) ride along under the API's code/message.
      const { code: _code, message: _message, ...detail } = result.body ?? {};
      return jsonError(res, result.status, result.code, result.message, detail);
    }
    res.status(202).json({ scan: result.scan });
  }));
  return router;
}

const base = `${GROWTH_BASE}/sitescan`;
export const sitescanWriteOpenapi = {
  paths: {
    [`${base}/scans`]: {
      post: {
        ...openapiCommon.writeOperation("Start a Site Scan (uses one of the plan's monthly Site Scans)", "sitescan"),
        operationId: "startSiteScan",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SiteScanInput" } } } },
        responses: {
          "202": { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/SiteScanResult" } } } },
          "400": openapiCommon.errorResponse("Invalid or private URL, or the location has no synced profile"),
          "402": openapiCommon.errorResponse("plan_required — the plan has no Site Scans"),
          "403": openapiCommon.errorResponse("Key lacks the write scope, or limit_reached — this month's Site Scans are used"),
          "429": openapiCommon.errorResponse("daily_limit — 5 scans per day per account"),
        },
      },
    },
  },
  components: {
    schemas: {
      ...openapiCommon.schemas,
      SiteScanInput: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri", description: "Public http(s) website; omitted = the location's website" },
          locationId: { type: "integer", description: "A synced Google Business Profile location to compare the site against" },
          pageCap: { type: "integer", minimum: 1, maximum: 500, default: 150 },
          psiPages: { type: "integer", minimum: 0, maximum: 5, default: 1, description: "Pages to run PageSpeed on" },
        },
      },
      SiteScanResult: {
        type: "object",
        properties: { scan: { type: "object", properties: {
          id: { type: "string", format: "uuid" }, url: { type: "string" }, status: { type: "string", enum: ["queued"] },
          pageCap: { type: "integer" }, psiPages: { type: "integer" }, locationId: { type: "integer", nullable: true },
        } } },
      },
    },
  },
};
