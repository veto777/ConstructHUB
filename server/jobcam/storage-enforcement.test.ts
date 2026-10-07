/**
 * JobCam storage enforcement and the plan gate, through the real routes.
 *
 * The routes run in-process on a throwaway Express app against the DEV
 * database (never port 5433 — that is production on this box) with local file
 * storage. Only the session is stubbed: requireOrg answers a synthetic org,
 * and the org owner's CRM entitlements are set per test. Everything else —
 * the SQL, the storage lock, the multipart files, the admin gate — is real.
 * Skipped when no database answers. Fixtures live under a synthetic org id and
 * are removed afterwards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.JOBCAM_STORAGE = "local";
// The dev account (dev@constructhub.local) is a platform admin only with the explicit dev opt-in (server/admin.ts).
process.env.DEV_AUTH_BYPASS_USER1 = "true";
if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";

const DB_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (/:5433\b/.test(DB_URL)) throw new Error("refusing to run storage fixtures against port 5433");
process.env.DATABASE_URL = DB_URL || "postgres://localhost:5432/unused_no_queries_run";

const state = vi.hoisted(() => ({ ctx: null as any, ent: null as any }));
vi.mock("../crm/tenancy", async (orig) => ({ ...(await orig<any>()), requireOrg: async () => state.ctx }));
vi.mock("../crm/entitlements", async (orig) => ({ ...(await orig<any>()), getCrmEntitlements: async () => state.ent }));
vi.mock("../crm/activity", async (orig) => ({ ...(await orig<any>()), logActivity: () => {} }));
// The media worker is not under test: a completed upload stays `processing` (in-flight bytes).
vi.mock("./processor", async (orig) => ({ ...(await orig<any>()), enqueueMedia: () => {} }));

const { pool } = await import("../db");
const dbUp = DB_URL ? await pool.query("select 1").then(() => true, () => false) : false;

const GB = 1024 ** 3;
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2044, 7)]); // 2,048 bytes

describe.skipIf(!dbUp)("jobcam storage — enforcement through the routes (dev database)", () => {
  const orgId = `vt-jcs-${randomUUID().slice(0, 18)}`;
  const memberId = `vt-m-${randomUUID().slice(0, 12)}`;
  let base = "", server: Server, projectId = "", customerId = "";
  let adminUserId = 0;
  let mod: typeof import("./usage");
  const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);

  const ENT = {
    max: { active: true, via: "plan", plan: "crm_max", limits: { jobcam: true }, jobcamAddon: false, jobcam: true },
    basic: { active: true, via: "plan", plan: "crm_basic", limits: { jobcam: false }, jobcamAddon: false, jobcam: false },
    basicAddon: { active: true, via: "plan", plan: "crm_basic", limits: { jobcam: false }, jobcamAddon: true, jobcam: true },
    essentials: { active: true, via: "plan", plan: "crm_essentials", limits: { jobcam: false }, jobcamAddon: false, jobcam: false },
    none: { active: false, via: null, plan: null, limits: null, jobcamAddon: false, jobcam: false },
  };
  /** Who the stubbed session is: user 0 = nobody the users table knows. */
  let sessionUserId = 0;

  const api = async (method: string, url: string, body?: unknown, raw?: Buffer) => {
    const r = await fetch(`${base}${url}`, {
      method,
      headers: raw ? { "content-type": "application/octet-stream" } : body !== undefined ? { "content-type": "application/json" } : {},
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await r.text();
    let data: any = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const open = (bytes = PHOTO.length) => api("POST", "/api/crm/jobcam/uploads", { projectId, fileName: "vitest.jpg", mime: "image/jpeg", bytes });
  const setUsed = (bytes: number) => q(`UPDATE jobcam_org_usage SET bytes = $2 WHERE org_id = $1`, [orgId, bytes]);
  const setTier = (gb: number) => q(`UPDATE jobcam_org_usage SET storage_tier_gb = $2 WHERE org_id = $1`, [orgId, gb]);
  const localFile = (key: string) => path.join(process.cwd(), "tmp", "jobcam", key);
  const clearUploads = async () => {
    await q(`DELETE FROM jobcam_uploads WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM jobcam_media WHERE org_id = $1`, [orgId]);
  };

  beforeAll(async () => {
    const { JOBCAM_DDL } = await import("./schema");
    for (const ddl of JOBCAM_DDL) await pool.query(ddl);
    mod = await import("./usage");
    customerId = (await q<{ id: string }>(`insert into crm_customers (org_id, display_name, portal_token) values ($1, 'Vitest JobCam storage', $2) returning id`, [orgId, randomBytes(24).toString("hex")]))[0].id;
    projectId = (await q<{ id: string }>(`insert into crm_projects (org_id, customer_id, name) values ($1, $2, 'Vitest JobCam storage') returning id`, [orgId, customerId]))[0].id;
    adminUserId = (await q<{ id: number }>(`select id from users where lower(email) = 'dev@constructhub.local' limit 1`))[0]?.id ?? 0;
    state.ctx = {
      org: { id: orgId, ownerUserId: 0, name: "Vitest JobCam storage" },
      member: { id: memberId, role: "owner", displayName: "Vitest", email: "vitest@example.invalid", divisionId: null, divisionIds: null, userId: 0 },
      permissions: new Proxy({}, { get: () => true }),
    };
    state.ent = ENT.max;
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    const getUser = () => ({ id: sessionUserId });
    (await import("./routes")).registerJobcamRoutes(app, getUser);
    (await import("./share")).registerJobcamShareRoutes(app, getUser);
    (await import("./admin")).registerJobcamAdminRoutes(app, getUser);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await clearUploads();
    await q(`DELETE FROM jobcam_storage_requests WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM jobcam_org_usage WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM jobcam_tags WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM crm_projects WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM crm_customers WHERE org_id = $1`, [orgId]);
    await q(`DELETE FROM admin_audit_log WHERE parameters::text LIKE $1`, [`%${orgId}%`]).catch(() => {});
    fs.rmSync(path.join(process.cwd(), "tmp", "jobcam", "jobcam", orgId), { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    state.ent = ENT.max;
    sessionUserId = 0;
    await clearUploads();
    await mod.ensureJobcamUsageRow(orgId);
    await setTier(5);
    await setUsed(0);
  });

  it("an org that has never uploaded reads as 0 of 5 GB, and the row exists", async () => {
    await q(`DELETE FROM jobcam_org_usage WHERE org_id = $1`, [orgId]);
    const r = await api("GET", "/api/crm/jobcam/usage");
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ bytes: 0, tierGb: 5, limitBytes: 5 * GB, nextTierGb: 10, full: false, warn: false, label: "0 of 5 GB", pendingBytes: 0, storageRequest: null });
    expect((await q(`SELECT storage_tier_gb FROM jobcam_org_usage WHERE org_id = $1`, [orgId]))[0].storage_tier_gb).toBe(5);
  });

  it("opens an upload while it fits, and refuses at the limit with the limit_reached body — leaving no rows", async () => {
    await setUsed(5 * GB - PHOTO.length);
    const ok = await open();
    expect(ok.status).toBe(201);
    await clearUploads();

    await setUsed(5 * GB - PHOTO.length + 1);
    const refused = await open();
    expect(refused.status).toBe(403);
    expect(refused.data).toMatchObject({
      code: "limit_reached", feature: "jobcamStorage", limit: 5 * GB, used: 5 * GB - PHOTO.length + 1,
      tierGb: 5, nextTierGb: 10, requestedBytes: PHOTO.length, upgradePlan: null, addon: null,
    });
    expect(refused.data.message).toMatch(/storage is full/i);
    expect(await q(`SELECT 1 FROM jobcam_uploads WHERE org_id = $1`, [orgId])).toEqual([]);
    expect(await q(`SELECT 1 FROM jobcam_media WHERE org_id = $1`, [orgId])).toEqual([]);
  });

  it("counts the declared bytes of uploads still open: the second one cannot squeeze past", async () => {
    // Room for exactly one of these.
    await setUsed(5 * GB - PHOTO.length);
    const first = await open();
    expect(first.status).toBe(201);
    const second = await open();
    expect(second.status).toBe(403);
    expect(second.data).toMatchObject({ code: "limit_reached", feature: "jobcamStorage", pendingBytes: PHOTO.length });
    // The usage meter says the same: nothing more fits while the first is on its way.
    expect((await api("GET", "/api/crm/jobcam/usage")).data).toMatchObject({ pendingBytes: PHOTO.length, full: true });
    // Cancelling the first frees its reservation.
    expect((await api("DELETE", `/api/crm/jobcam/uploads/${first.data.uploadId}`)).status).toBe(200);
    expect((await open()).status).toBe(201);
  });

  it("two uploads opened at the same moment: exactly one gets in", async () => {
    await setUsed(5 * GB - PHOTO.length - 10);
    const results = await Promise.all(Array.from({ length: 6 }, () => open()));
    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403, 403, 403, 403]);
    expect((await q(`SELECT count(*)::int AS n FROM jobcam_uploads WHERE org_id = $1 AND status = 'open'`, [orgId]))[0].n).toBe(1);
  });

  it("an upload that was completed but not yet processed still counts", async () => {
    await setUsed(5 * GB - PHOTO.length - 10);
    const up = await open();
    expect((await api("PUT", `/api/crm/jobcam/uploads/${up.data.uploadId}/parts/1`, undefined, PHOTO)).status).toBe(200);
    const done = await api("POST", `/api/crm/jobcam/uploads/${up.data.uploadId}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.data.status).toBe("processing");
    expect((await open()).status).toBe(403);
  });

  it("re-checks at complete on the stored size and cleans up: no multipart, no object, no media row", async () => {
    const up = await open();
    expect(up.status).toBe(201);
    expect((await api("PUT", `/api/crm/jobcam/uploads/${up.data.uploadId}/parts/1`, undefined, PHOTO)).status).toBe(200);
    const [row] = await q<{ key: string }>(`SELECT key FROM jobcam_uploads WHERE id = $1`, [up.data.uploadId]);
    const partsDir = path.join(process.cwd(), "tmp", "jobcam", "_parts", up.data.uploadId);
    expect(fs.existsSync(partsDir)).toBe(true);
    // The size is lowered / the meter fills up while the upload is on its way.
    await setUsed(5 * GB - 100);

    const refused = await api("POST", `/api/crm/jobcam/uploads/${up.data.uploadId}/complete`, {});
    expect(refused.status).toBe(403);
    expect(refused.data).toMatchObject({ code: "limit_reached", feature: "jobcamStorage", tierGb: 5, nextTierGb: 10, requestedBytes: PHOTO.length });
    expect((await q(`SELECT status FROM jobcam_uploads WHERE id = $1`, [up.data.uploadId]))[0].status).toBe("aborted");
    expect(await q(`SELECT 1 FROM jobcam_media WHERE id = $1`, [up.data.mediaId])).toEqual([]);
    expect(fs.existsSync(partsDir)).toBe(false);
    expect(fs.existsSync(localFile(row.key))).toBe(false);
    // And the reservation is gone with it.
    expect((await api("GET", "/api/crm/jobcam/usage")).data.pendingBytes).toBe(0);
    // Asking again is not a retry loop: the upload is over.
    expect((await api("POST", `/api/crm/jobcam/uploads/${up.data.uploadId}/complete`, {})).status).toBe(404);
  });

  it("a complete that fits goes through and keeps its file", async () => {
    const up = await open();
    await api("PUT", `/api/crm/jobcam/uploads/${up.data.uploadId}/parts/1`, undefined, PHOTO);
    const [row] = await q<{ key: string }>(`SELECT key FROM jobcam_uploads WHERE id = $1`, [up.data.uploadId]);
    const done = await api("POST", `/api/crm/jobcam/uploads/${up.data.uploadId}/complete`, {});
    expect(done.status).toBe(200);
    expect(fs.statSync(localFile(row.key)).size).toBe(PHOTO.length);
    // A double tap answers the same media and queues nothing new.
    expect((await api("POST", `/api/crm/jobcam/uploads/${up.data.uploadId}/complete`, {})).status).toBe(200);
  });

  it("a larger size lets the same upload in; a size below what is stored blocks new uploads but deletes nothing", async () => {
    await setUsed(7 * GB);
    expect((await open()).status).toBe(403);
    await mod.setJobcamStorageTier(orgId, 10);
    expect((await open()).status).toBe(201);
    await clearUploads();
    await mod.setJobcamStorageTier(orgId, 5);
    const usage = (await api("GET", "/api/crm/jobcam/usage")).data;
    expect(usage).toMatchObject({ bytes: 7 * GB, tierGb: 5, full: true });
    expect((await open()).status).toBe(403);
  });

  it("deleting media frees the space the way the meter counts it", async () => {
    await setUsed(5 * GB);
    expect((await open()).status).toBe(403);
    await mod.bumpJobcamUsage(orgId, { bytes: -PHOTO.length, kind: "photo", count: -1 });
    expect((await open()).status).toBe(201);
  });

  it("rejects a size that is not on the list", async () => {
    for (const bad of [7, 0, -5, 5.5, 4000, "10", null]) {
      await expect(mod.setJobcamStorageTier(orgId, bad as any), String(bad)).rejects.toThrow(/must be one of 5, 10, 100, 500, 1000, 2000 GB/);
    }
    expect((await q(`SELECT storage_tier_gb FROM jobcam_org_usage WHERE org_id = $1`, [orgId]))[0].storage_tier_gb).toBe(5);
    expect(await mod.setJobcamStorageTier(orgId, 100)).toEqual({ previousGb: 5, tierGb: 100 });
  });

  it('"Request more storage" records one open request per org and shows on the meter', async () => {
    const first = await api("POST", "/api/crm/jobcam/storage-request", {});
    expect(first.status).toBe(201);
    const again = await api("POST", "/api/crm/jobcam/storage-request", {});
    expect(again.status).toBe(200);
    expect(again.data.existed).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM jobcam_storage_requests WHERE org_id = $1`, [orgId]))[0].n).toBe(1);
    expect((await api("GET", "/api/crm/jobcam/usage")).data.storageRequest).not.toBeNull();
  });

  // ── The plan gate ──────────────────────────────────────────────────────────

  it("CRM Basic and Essentials without the add-on: every member route answers the plan-required 402, and nothing is opened", async () => {
    for (const ent of [ENT.basic, ENT.essentials]) {
      state.ent = ent;
      const refused = await open();
      expect(refused.status).toBe(402);
      expect(refused.data).toMatchObject({ code: "crm_plan_required", feature: "jobcam", requiredCrmPlan: "crm_max", crmAddon: "jobcam", currentCrmPlan: ent.plan });
      for (const [method, url] of [
        ["GET", "/api/crm/jobcam/media"], ["GET", "/api/crm/jobcam/usage"], ["GET", "/api/crm/jobcam/tags"], ["GET", "/api/crm/jobcam/projects"],
        ["POST", "/api/crm/jobcam/storage-request"], ["POST", `/api/crm/projects/${projectId}/jobcam/shares`], ["GET", `/api/crm/projects/${projectId}/jobcam/shares`],
      ] as const) {
        const r = await api(method, url, method === "POST" ? {} : undefined);
        expect(r.status, `${method} ${url}`).toBe(402);
        expect(r.data.code, `${method} ${url}`).toBe("crm_plan_required");
      }
    }
    expect(await q(`SELECT 1 FROM jobcam_uploads WHERE org_id = $1`, [orgId])).toEqual([]);
  });

  it("no CRM plan: refused, with no add-on to offer", async () => {
    state.ent = ENT.none;
    const refused = await open();
    expect(refused.status).toBe(402);
    expect(refused.data).toMatchObject({ code: "crm_plan_required", requiredCrmPlan: "crm_max", crmAddon: null, currentCrmPlan: null });
  });

  it("the JobCam add-on on Basic opens it", async () => {
    state.ent = ENT.basicAddon;
    expect((await open()).status).toBe(201);
    expect((await api("GET", "/api/crm/jobcam/usage")).status).toBe(200);
  });

  it("a workspace that lost JobCam can still switch off a share link it sent", async () => {
    const [share] = await q<{ id: string }>(
      `INSERT INTO jobcam_share_links (org_id, project_id, kind, token) VALUES ($1, $2, 'gallery', $3) RETURNING id`, [orgId, projectId, `vt-${randomUUID()}`]);
    state.ent = ENT.basic;
    const revoked = await api("POST", `/api/crm/jobcam/shares/${share.id}/revoke`, {});
    expect(revoked.status).toBe(200);
    expect(revoked.data.revokedAt).toBeTruthy();
    expect((await api("DELETE", `/api/crm/jobcam/shares/${share.id}`)).status).toBe(200);
  });

  // ── Platform admin: the only way to change a size ──────────────────────────

  it("only a platform admin can set an org's storage size", async () => {
    sessionUserId = 0; // not an account the admin list knows
    const refused = await api("POST", "/api/admin/jobcam/storage-tier", { orgId, tierGb: 100 });
    expect(refused.status).toBe(403);
    expect(refused.data.message).toBe("Platform admin access required");
    expect((await api("GET", "/api/admin/jobcam/storage")).status).toBe(403);
    expect((await q(`SELECT storage_tier_gb FROM jobcam_org_usage WHERE org_id = $1`, [orgId]))[0].storage_tier_gb).toBe(5);
    // An org member — even its owner — has no route to it at all.
    expect((await api("POST", "/api/crm/jobcam/storage-tier", { tierGb: 100 })).status).toBe(404);
  });

  it("a platform admin sets it, the change is audit-logged and closes the org's request; an invalid size is rejected", async (t) => {
    if (!adminUserId) return t.skip();
    sessionUserId = adminUserId;
    await api("POST", "/api/crm/jobcam/storage-request", {});
    await setUsed(7 * GB);

    const bad = await api("POST", "/api/admin/jobcam/storage-tier", { orgId, tierGb: 7 });
    expect(bad.status).toBe(400);
    expect(bad.data).toMatchObject({ code: "invalid_tier", tiersGb: [5, 10, 100, 500, 1000, 2000] });
    expect((await api("POST", "/api/admin/jobcam/storage-tier", { orgId, tierGb: "100" })).status).toBe(400);
    expect((await api("POST", "/api/admin/jobcam/storage-tier", { orgId: "no-such-org", tierGb: 100 })).status).toBe(404);
    expect((await q(`SELECT storage_tier_gb FROM jobcam_org_usage WHERE org_id = $1`, [orgId]))[0].storage_tier_gb).toBe(5);

    // crm_orgs has no row for the synthetic org: give the route one to find.
    const hadOrg = (await q(`SELECT 1 FROM crm_orgs WHERE id = $1`, [orgId])).length > 0;
    expect(hadOrg).toBe(false);
    await q(`INSERT INTO crm_orgs (id, name, owner_user_id) VALUES ($1, 'Vitest JobCam storage', $2)`, [orgId, adminUserId]);
    try {
      const ok = await api("POST", "/api/admin/jobcam/storage-tier", { orgId, tierGb: 100 });
      expect(ok.status).toBe(200);
      expect(ok.data).toMatchObject({ ok: true, previousGb: 5, tierGb: 100, overLimit: false });
      expect((await q(`SELECT status FROM jobcam_storage_requests WHERE org_id = $1`, [orgId]))[0].status).toBe("resolved");
      const [log] = await q(`SELECT action, result, parameters FROM admin_audit_log WHERE action = 'jobcam_storage_tier' AND parameters::text LIKE $1 AND result = 'success' ORDER BY 1 DESC LIMIT 1`, [`%${orgId}%`]);
      expect(log).toMatchObject({ action: "jobcam_storage_tier", result: "success" });

      // Lowering below what is stored is allowed and reported.
      const lower = await api("POST", "/api/admin/jobcam/storage-tier", { orgId, tierGb: 5 });
      expect(lower.data).toMatchObject({ previousGb: 100, tierGb: 5, overLimit: true });

      const list = await api("GET", "/api/admin/jobcam/storage");
      expect(list.status).toBe(200);
      expect(list.data.orgs.find((o: any) => o.id === orgId)).toMatchObject({ tierGb: 5, usedBytes: 7 * GB, overLimit: true, full: true, label: "7 of 5 GB", request: null });
    } finally {
      await q(`DELETE FROM crm_orgs WHERE id = $1`, [orgId]);
    }
  });
});
