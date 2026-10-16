/**
 * JobCam share links honour "Hidden from client" (client_visible = false).
 *
 *   1. Pure: the share-link file lookup carries client_visible, the link's
 *      org/project and (for a gallery) its fixed set; the public /api/files
 *      route refuses JobCam / customer-video keys, including "%2F"-smuggled ones.
 *   2. In-process against a real database (DATABASE_URL — the scratch / lane DB):
 *      the public /api/jc/:token routes and the member routes are mounted on a
 *      bare Express app (auth + plan stubbed for the member side). A hidden shot
 *      is never listed by a timeline or gallery link and its file is a 404 by id
 *      on every variant; un-hiding makes it appear; hiding again takes it away;
 *      the team still sees and streams every shot; a gallery cannot be made
 *      from a hidden shot. Skipped when the database or the JobCam tables are
 *      unavailable. Fixtures sit under a synthetic org id and are removed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import type { AddressInfo } from "net";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";
process.env.JOBCAM_STORAGE = "local";
const LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "jobcam-share-vis-"));
process.env.JOBCAM_LOCAL_ROOT = LOCAL_ROOT;

const orgId = `vt-jcs-${randomUUID().slice(0, 18)}`;
const memberId = `vt-jcs-m-${randomUUID().slice(0, 12)}`;

// The member side: a manager seat in the synthetic org, JobCam on the plan.
vi.mock("../crm/tenancy", () => ({
  requireOrg: async () => ({
    org: { id: orgId, name: "Vitest JobCam org" },
    member: { id: memberId, email: "crew@example.test", displayName: "Crew" },
    permissions: { manageJobs: true, manageCustomers: true, viewAllJobs: true },
  }),
}));
vi.mock("./plan", () => ({ requireJobcamPlan: async () => true }));
vi.mock("../crm/activity", () => ({ logActivity: () => {} }));
vi.mock("./access", async () => {
  const { db } = await import("../db");
  const { crmProjects } = await import("@shared/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const visibleProject = async (ctx: any, id: string) => {
    const [p] = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, id))).limit(1);
    return p ?? null;
  };
  return {
    canManageJobcam: () => true,
    visibleProject,
    visibleProjectIds: async () => null,
    projectsById: async (oid: string, ids: string[]) => {
      if (!ids.length) return new Map();
      const rows = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, oid), inArray(crmProjects.id, ids)));
      return new Map(rows.map((p: any) => [p.id, p]));
    },
  };
});

const { shareMediaWhere, feedWhere } = await import("./routes");
const { isPrivateMediaKey, mediaKey } = await import("./storage");
const render = (w: any) => new PgDialect().sqlToQuery(w);

describe("jobcam share visibility — pure", () => {
  it("a timeline link's file lookup requires client_visible, ready, not deleted, its org and project", () => {
    const q = render(shareMediaWhere({ orgId: "o1", projectId: "p1", kind: "timeline", mediaIds: null }, "m1"));
    expect(q.sql).toMatch(/"client_visible" = \$\d+/);
    expect(q.sql).toMatch(/"deleted_at" is null/);
    expect(q.params).toEqual(expect.arrayContaining(["o1", "p1", "m1", "ready", true]));
  });

  it("a gallery link's file lookup also pins the fixed set; an empty or unknown kind fails closed", () => {
    const g = render(shareMediaWhere({ orgId: "o1", projectId: "p1", kind: "gallery", mediaIds: ["a", "b"] }, "a"));
    expect(g.sql).toMatch(/"client_visible" = \$\d+/);
    expect(g.params).toEqual(expect.arrayContaining(["a", "b"]));
    const empty = render(shareMediaWhere({ orgId: "o1", projectId: "p1", kind: "gallery", mediaIds: [] }, "a"));
    expect(empty.params).toContain("-");
    const odd = render(shareMediaWhere({ orgId: "o1", projectId: "p1", kind: "weird", mediaIds: null }, "a"));
    expect(odd.params).toContain("-");
  });

  it("the member feed never filters on the flag (the team sees everything)", () => {
    expect(render(and(...feedWhere({ orgId: "o1", projectIds: ["p1"] })!)).sql).not.toContain("client_visible");
  });

  it("JobCam and customer-video keys are private to their gated routes", () => {
    for (const k of ["jobcam/o/m/original.jpg", "jobcam-dev1/o/m/thumb.jpg", "ytvideo/1/v/original.mp4", "ytvideo-x/1/v/a.mp4", "/jobcam/o/m/x", "JobCam/o/m/x"]) {
      expect(isPrivateMediaKey(k), k).toBe(true);
    }
    for (const k of ["media/abc/photo.jpg", "logos/company/x.png", "photos/reviews/x.jpg", "jobcamera/x/y"]) {
      expect(isPrivateMediaKey(k), k).toBe(false);
    }
  });
});

// ── In-process, against the database ────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL!;
let dbReady = false;
if (!/:5433\b/.test(DB_URL)) {
  const probe = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 3000 });
  dbReady = await probe.query(`select count(*)::int as n from information_schema.tables where table_name in ('jobcam_media','jobcam_share_links','crm_projects','crm_customers','crm_orgs','crm_members')`)
    .then((r) => r.rows[0].n === 6, () => false);
  await probe.end().catch(() => {});
}

describe.skipIf(!dbReady)("jobcam share visibility — public share routes (in-process)", () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
  const ids = { visible: randomUUID(), hidden: randomUUID(), hidden2: randomUUID() };
  const bytes = (id: string) => Buffer.from(`jobcam-share-fixture-${id}`);
  const tokens = { timeline: randomBytes(24).toString("base64url"), gallery: randomBytes(24).toString("base64url") };
  let projectId = "", customerId = "", base = "", server: any;

  const insertMedia = async (id: string, clientVisible: boolean) => {
    const keys: Record<string, string> = {};
    for (const v of ["original", "display", "thumb", "poster", "video"]) keys[v] = mediaKey(orgId, id, `${v}.jpg`);
    await q(
      `insert into jobcam_media (id, org_id, project_id, customer_id, kind, status, file_name, mime, bytes, r2_key_original, r2_key_display, r2_key_thumb, client_visible, captured_at, uploaded_at)
       values ($1, $2, $3, $4, 'photo', 'ready', 'fixture.jpg', 'image/jpeg', $5, $6, $7, $8, $9, now(), now())`,
      [id, orgId, projectId, customerId, bytes(id).length, keys.original, keys.display, keys.thumb, clientVisible],
    );
    for (const k of [keys.original, keys.display, keys.thumb]) {
      const p = path.join(LOCAL_ROOT, k);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bytes(id));
    }
  };

  beforeAll(async () => {
    customerId = (await q<{ id: string }>(`insert into crm_customers (org_id, display_name, portal_token) values ($1, 'Vitest share homeowner', $2) returning id`,
      [orgId, randomBytes(24).toString("hex")]))[0].id;
    projectId = (await q<{ id: string }>(`insert into crm_projects (org_id, customer_id, name) values ($1, $2, 'Vitest JobCam share') returning id`, [orgId, customerId]))[0].id;
    await insertMedia(ids.visible, true);
    await insertMedia(ids.hidden, false);
    await insertMedia(ids.hidden2, false);
    await q(`insert into jobcam_share_links (org_id, project_id, kind, token, title, show_details) values ($1, $2, 'timeline', $3, 'Live', true)`, [orgId, projectId, tokens.timeline]);
    // A gallery made before the fix could hold a hidden shot: the reads must still skip it.
    await q(`insert into jobcam_share_links (org_id, project_id, kind, token, title, media_ids, show_details) values ($1, $2, 'gallery', $3, 'Picked', $4::text[], true)`,
      [orgId, projectId, tokens.gallery, [ids.visible, ids.hidden]]);

    const express = (await import("express")).default;
    const { registerJobcamShareRoutes } = await import("./share");
    const { registerJobcamRoutes } = await import("./routes");
    const app = express();
    app.use(express.json());
    const getUser = () => ({ id: 1 });
    registerJobcamRoutes(app, getUser);
    registerJobcamShareRoutes(app, getUser);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await q(`delete from jobcam_share_links where org_id = $1`, [orgId]).catch(() => {});
    await q(`delete from jobcam_media where org_id = $1`, [orgId]).catch(() => {});
    await q(`delete from crm_projects where org_id = $1`, [orgId]).catch(() => {});
    await q(`delete from crm_customers where org_id = $1`, [orgId]).catch(() => {});
    await pool.end();
    const { pools } = await import("../db");
    await Promise.all(pools.map((p) => p.end().catch(() => {})));
    fs.rmSync(LOCAL_ROOT, { recursive: true, force: true });
  });

  const listed = async (token: string) => {
    const r = await fetch(`${base}/api/jc/${token}/media?limit=100`);
    expect(r.status).toBe(200);
    return ((await r.json()).media as { id: string; urls: Record<string, string | null> }[]);
  };
  const shareFile = (token: string, id: string, variant: string) => fetch(`${base}/api/jc/${token}/media/${id}/file/${variant}`);
  const setVisible = (id: string, v: boolean) => q(`update jobcam_media set client_visible = $2 where id = $1`, [id, v]);

  it("a live timeline lists only the visible shot, and none of its payload leaks the hidden one", async () => {
    const media = await listed(tokens.timeline);
    expect(media.map((m) => m.id)).toEqual([ids.visible]);
    const raw = JSON.stringify(media);
    expect(raw).not.toContain(ids.hidden);
    expect(raw).not.toContain(ids.hidden2);
    expect("clientVisible" in (media[0] as any)).toBe(false);
  });

  it("a gallery holding a hidden shot lists only its visible one", async () => {
    expect((await listed(tokens.gallery)).map((m) => m.id)).toEqual([ids.visible]);
  });

  it("a hidden shot's file is a 404 on every variant and every link, even with its id", async () => {
    for (const token of [tokens.timeline, tokens.gallery]) {
      for (const variant of ["original", "display", "thumb", "poster", "video"]) {
        const r = await shareFile(token, ids.hidden, variant);
        expect(r.status, `${variant}`).toBe(404);
        expect(await r.text()).not.toContain(bytes(ids.hidden).toString());
        const dl = await fetch(`${base}/api/jc/${token}/media/${ids.hidden}/file/${variant}?download=1`);
        expect(dl.status).toBe(404);
      }
    }
  });

  it("the visible shot streams through the link", async () => {
    const r = await shareFile(tokens.timeline, ids.visible, "display");
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes(ids.visible))).toBe(true);
  });

  it("un-hiding a shot makes it appear on the link; hiding it again takes it away", async () => {
    await setVisible(ids.hidden, true);
    try {
      expect((await listed(tokens.timeline)).map((m) => m.id).sort()).toEqual([ids.visible, ids.hidden].sort());
      expect((await listed(tokens.gallery)).map((m) => m.id).sort()).toEqual([ids.visible, ids.hidden].sort());
      const r = await shareFile(tokens.timeline, ids.hidden, "original");
      expect(r.status).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(bytes(ids.hidden))).toBe(true);
      // Visible but not in the gallery's set: still a 404 there.
      await setVisible(ids.hidden2, true);
      expect((await shareFile(tokens.gallery, ids.hidden2, "display")).status).toBe(404);
    } finally {
      await setVisible(ids.hidden, false);
      await setVisible(ids.hidden2, false);
    }
    expect((await listed(tokens.timeline)).map((m) => m.id)).toEqual([ids.visible]);
    expect((await shareFile(tokens.timeline, ids.hidden, "original")).status).toBe(404);
  });

  it("team members still see and stream every shot, hidden ones included", async () => {
    const r = await fetch(`${base}/api/crm/jobcam/media?projectId=${projectId}&limit=100`);
    expect(r.status).toBe(200);
    const media = (await r.json()).media as { id: string; clientVisible: boolean }[];
    expect(media.map((m) => m.id).sort()).toEqual([ids.visible, ids.hidden, ids.hidden2].sort());
    expect(media.find((m) => m.id === ids.hidden)!.clientVisible).toBe(false);
    const f = await fetch(`${base}/api/crm/jobcam/media/${ids.hidden}/file/original`);
    expect(f.status).toBe(200);
    expect(Buffer.from(await f.arrayBuffer()).equals(bytes(ids.hidden))).toBe(true);
  });

  it("a gallery cannot be made from a hidden shot; a visible-only pick works", async () => {
    const make = (mediaIds: string[]) => fetch(`${base}/api/crm/projects/${projectId}/jobcam/shares`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "gallery", mediaIds, expires: "never" }),
    });
    const bad = await make([ids.visible, ids.hidden]);
    expect(bad.status).toBe(409);
    expect((await bad.json()).hiddenCount).toBe(1);
    const ok = await make([ids.visible]);
    expect(ok.status).toBe(201);
    expect((await ok.json()).mediaIds).toEqual([ids.visible]);
  });
});
