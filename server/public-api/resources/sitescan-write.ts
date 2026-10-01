/**
 * Public API — Site Scan WRITE route, composed into the `site-scans` resource
 * (./register.ts):
 *
 *   POST /api/v1/site-scans   start a Site Scan of a public website (or of a
 *                             synced GBP location's website); counts against
 *                             the plan's monthly Site Scan allowance exactly
 *                             like the Site Scan page
 *
 * A 5-unit write. The scan is queued for the existing worker; the report is
 * read back through GET /site-scans/{id}/report. Only the crawl is started
 * here — the AI action plan (POST /api/sitescan/jobs/:id/plan) is a
 * session-only feature and is not reachable through the API. The queue insert
 * mirrors server/sitescan/worker.ts enqueue()/profileFor() on purpose:
 * importing the worker would pull sitescan/providers.ts (the AI provider)
 * into this module.
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
import type { ApiErrorCode } from "../errors";
import { handle, jsonError, openapiCommon, requireWriteScope, type ApiKeyContext } from "./shared-write";

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
  | { ok: false; status: 400 | 402 | 429; code: ApiErrorCode; message: string; detail?: Record<string, unknown>; retryAfterSeconds?: number };

/**
 * Reserve one Site Scan from the plan, then queue the crawl; the reservation is
 * refunded when nothing was queued. Refusals use the API's codes: the plan's
 * monthly Site Scans used up → 429 quota_exceeded (scope "feature"), the daily
 * cap → 429 rate_limited (scope "daily"), no Site Scans on the plan → 402.
 */
export async function startSiteScan(userId: number, raw: unknown, meta: { keyId: string; req?: Request | null }, deps: SitescanWriteDeps = sitescanWriteDefaults): Promise<StartScanResult> {
  const body = siteScanInput.parse(raw);
  const profile = body.locationId || !body.url ? await profileFor(userId, body.locationId) : null;
  if (body.locationId && !profile) {
    return { ok: false, status: 400, code: "validation_error", message: "Sync the selected GBP profile before scanning.", detail: { issues: [{ path: "locationId", message: "This location has no synced Google profile yet" }] } };
  }
  let url: string;
  try { url = siteUrl(body.url || profile?.website || ""); }
  catch { return { ok: false, status: 400, code: "validation_error", message: "Enter a public HTTP or HTTPS website URL.", detail: { issues: [{ path: "url", message: "Public http(s) URL required" }] } }; }
  const quota = await deps.reserveQuotaFor(userId, "siteScans", 1);
  if (!quota.ok) {
    const { code: _code, message, ...detail } = quota.body as Record<string, unknown> & { code?: string; message?: string };
    const text = String(message ?? "Site Scan is not available on this plan.");
    if (quota.status === 402 || quota.status === 401) return { ok: false, status: 402, code: "plan_required", message: text, detail };
    const resetsAt = typeof detail.resetsAt === "string" ? Date.parse(detail.resetsAt) : NaN;
    const retryAfterSeconds = Number.isFinite(resetsAt) ? Math.max(1, Math.ceil((resetsAt - Date.now()) / 1000)) : undefined;
    return { ok: false, status: 429, code: "quota_exceeded", message: text, detail: { scope: "feature", feature: "siteScans", ...detail }, retryAfterSeconds };
  }
  if (!(await takeBudget("sitescan:scan:" + userId, DAILY_SCAN_CAP, 1, DAY))) {
    await refundReservation(quota.reservation, 1);
    return { ok: false, status: 429, code: "rate_limited", message: `Daily scan budget reached (${DAILY_SCAN_CAP} per day).`, detail: { scope: "daily", limit: DAILY_SCAN_CAP }, retryAfterSeconds: DAY / 1000 };
  }
  let id: string;
  try { id = await deps.enqueue(userId, url, body.pageCap, body.psiPages, profile); }
  catch (e) { await refundReservation(quota.reservation, 1); throw e; } // the scan never started
  await logActivity(meta.req ?? null, userId, "api.sitescan.started", { id, url, keyId: meta.keyId, locationId: profile?.id ?? null }).catch(() => {});
  return { ok: true, scan: { id, url, status: "queued", pageCap: body.pageCap, psiPages: body.psiPages, locationId: profile?.id ?? null } };
}

/** `site-scans` resource: POST /. */
export function sitescanWriteRouter(deps: SitescanWriteDeps = sitescanWriteDefaults) {
  const router = Router();
  router.post("/", requireWriteScope, handle(async (req, res, key: ApiKeyContext) => {
    const result = await startSiteScan(key.userId, req.body ?? {}, { keyId: key.id, req }, deps);
    if (!result.ok) {
      if (result.retryAfterSeconds) res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return jsonError(res, result.status, result.code, result.message, result.detail ?? {});
    }
    res.status(202).json({ scan: result.scan });
  }));
  return router;
}

/** Fragment for the `site-scans` resource (paths relative to /api/v1/site-scans). */
export const sitescanWriteOpenapi = {
  paths: {
    "/": {
      post: {
        ...openapiCommon.writeOperation("Start a Site Scan (uses one of the plan's monthly Site Scans)", "site-scans"),
        operationId: "startSiteScan",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SiteScanInput" } } } },
        responses: {
          "202": { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/SiteScanResult" } } } },
          "400": openapiCommon.errorResponse("validation_error — invalid or private URL, or the location has no synced profile"),
          "402": openapiCommon.errorResponse("plan_required — the plan has no Site Scans"),
          "403": openapiCommon.errorResponse("insufficient_scope — the key lacks the write scope"),
          "429": openapiCommon.errorResponse("quota_exceeded (scope feature — this month's Site Scans are used) or rate_limited (scope daily — 5 scans per day per account)"),
        },
      },
    },
  },
  components: {
    schemas: {
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
