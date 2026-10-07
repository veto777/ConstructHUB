/**
 * JobCam → homeowner portal: nothing is shown unless a team member switched it
 * on (jobcam_media.client_visible). Two layers:
 *
 *   1. Pure: the SQL both portal reads build carries the client_visible
 *      condition (and the member / share-link feed does not).
 *   2. Against the running dev server (CRM_TEST_BASE_URL, like the other
 *      money-path suites): a hidden shot is absent from /api/client/jobcam and
 *      its file URL is a 404 for a portal session that knows the id; a visible
 *      one is listed and streams. Skipped when no dev server answers.
 *
 * Fixtures live under a synthetic org id and are removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// routes.ts pulls in tenancy → ../stripe, which throws without a key at module
// scope; the app pool is never queried by the pure tests.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";
const { feedWhere, portalMediaWhere, presentMedia } = await import("./routes");
const { mediaKey } = await import("./storage");

const render = (w: any) => new PgDialect().sqlToQuery(w);

describe("jobcam portal visibility — the SQL (pure)", () => {
  it("the portal feed filters on client_visible = true, plus ready and not deleted", () => {
    const q = render(and(...feedWhere({ orgId: "o1", projectIds: ["p1"], clientVisibleOnly: true })!));
    expect(q.sql).toMatch(/"client_visible" = \$\d+/);
    expect(q.sql).toMatch(/"deleted_at" is null/);
    expect(q.sql).toMatch(/"status" = \$\d+/);
    expect(q.params).toContain(true);
    expect(q.params).toContain("ready");
  });

  it("the member feed and share links do not consult the flag", () => {
    const q = render(and(...feedWhere({ orgId: "o1", projectIds: ["p1"] })!));
    expect(q.sql).not.toContain("client_visible");
  });

  it("the portal file lookup requires client_visible, ready, not deleted and the session's customers", () => {
    const q = render(portalMediaWhere(["c1", "c2"], "m1"));
    expect(q.sql).toMatch(/"client_visible" = \$\d+/);
    expect(q.sql).toMatch(/"deleted_at" is null/);
    expect(q.sql).toMatch(/"customer_id" in \(\$\d+, \$\d+\)/);
    expect(q.params).toEqual(expect.arrayContaining(["m1", "c1", "c2", "ready", true]));
  });

  it("the flag is in the member payload and never in a guest's", () => {
    const row: any = { id: "m1", orgId: "o1", projectId: "p1", kind: "photo", status: "ready", clientVisible: true, tags: null };
    expect(presentMedia(row, "/api/crm/jobcam/media").clientVisible).toBe(true);
    expect("clientVisible" in presentMedia(row, "/api/client/jobcam", { guest: true })).toBe(false);
  });
});

// ── Against the dev server ───────────────────────────────────────────────────

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DB_URL = process.env.CRM_TEST_DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
const serverUp = await fetch(`${BASE}/api/client/jobcam`, { signal: AbortSignal.timeout(3000) }).then((r) => r.status === 401, () => false);
const localStorage = process.env.JOBCAM_STORAGE === "local";

describe.skipIf(!serverUp)("jobcam portal visibility — client portal session (dev server)", () => {
  // This box also serves production on 5433; fixtures only ever go to the dev database.
  if (/:5433\b/.test(DB_URL)) throw new Error("refusing to write fixtures to port 5433");
  const pool = new pg.Pool({ connectionString: DB_URL });
  const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

  const orgId = `vt-jc-${randomUUID().slice(0, 18)}`;
  const ids = { visible: randomUUID(), hidden: randomUUID(), deleted: randomUUID(), processing: randomUUID(), other: randomUUID() };
  const BYTES = Buffer.from("jobcam-portal-visibility-fixture");
  const files: string[] = [];
  let customerId = "", otherCustomerId = "", projectId = "", otherProjectId = "", cookie = "", sessionHash = "";

  const insertMedia = async (id: string, customer: string, project: string, over: { clientVisible: boolean; status?: string; deleted?: boolean }) => {
    const key = mediaKey(orgId, id, "original.jpg");
    await q(
      `insert into jobcam_media (id, org_id, project_id, customer_id, kind, status, file_name, mime, bytes, r2_key_original, r2_key_thumb, client_visible, deleted_at, captured_at, uploaded_at)
       values ($1, $2, $3, $4, 'photo', $5, 'fixture.jpg', 'image/jpeg', $6, $7, $7, $8, $9, now(), now())`,
      [id, orgId, project, customer, over.status ?? "ready", BYTES.length, key, over.clientVisible, over.deleted ? new Date() : null],
    );
    if (localStorage) {
      const p = path.join(process.cwd(), "tmp", "jobcam", key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, BYTES);
      files.push(path.dirname(p));
    }
  };

  beforeAll(async () => {
    const customer = async (name: string) => (await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, portal_token) values ($1, $2, $3) returning id`, [orgId, name, randomBytes(24).toString("hex")],
    ))[0].id;
    customerId = await customer("Vitest JobCam homeowner");
    otherCustomerId = await customer("Vitest JobCam other homeowner");
    const project = async (customer: string) => (await q<{ id: string }>(
      `insert into crm_projects (org_id, customer_id, name) values ($1, $2, 'Vitest JobCam portal') returning id`, [orgId, customer],
    ))[0].id;
    projectId = await project(customerId);
    otherProjectId = await project(otherCustomerId);
    await insertMedia(ids.visible, customerId, projectId, { clientVisible: true });
    await insertMedia(ids.hidden, customerId, projectId, { clientVisible: false });
    await insertMedia(ids.deleted, customerId, projectId, { clientVisible: true, deleted: true });
    await insertMedia(ids.processing, customerId, projectId, { clientVisible: true, status: "processing" });
    await insertMedia(ids.other, otherCustomerId, otherProjectId, { clientVisible: true });
    const raw = randomBytes(32).toString("hex");
    sessionHash = sha256(raw);
    await q(`insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) values ($1, $2::jsonb, now() + interval '1 hour', now())`,
      [sessionHash, JSON.stringify([customerId])]);
    cookie = `crm_client=${raw}`;
  });

  afterAll(async () => {
    await q(`delete from jobcam_media where org_id = $1`, [orgId]);
    await q(`delete from crm_projects where org_id = $1`, [orgId]);
    await q(`delete from crm_customers where org_id = $1`, [orgId]);
    await q(`delete from crm_client_sessions where token_hash = $1`, [sessionHash]);
    await pool.end();
    for (const d of files) fs.rmSync(d, { recursive: true, force: true });
    if (files.length) fs.rmSync(path.dirname(files[0]), { recursive: true, force: true }); // the synthetic org's folder
  });

  const feed = async () => {
    const r = await fetch(`${BASE}/api/client/jobcam?limit=100`, { headers: { cookie } });
    expect(r.status).toBe(200);
    return (await r.json()).media as { id: string; urls: { thumb: string | null; original: string } }[];
  };
  const file = (id: string, variant = "original") => fetch(`${BASE}/api/client/jobcam/${id}/file/${variant}`, { headers: { cookie } });

  it("lists the shot a team member switched on — and only that one", async () => {
    const media = await feed();
    expect(media.map((m) => m.id)).toEqual([ids.visible]);
    expect(media[0].urls.original).toBe(`/api/client/jobcam/${ids.visible}/file/original`);
    expect("clientVisible" in media[0]).toBe(false);
  });

  it("leaves a hidden shot out of the feed and refuses its file even when the id is known", async () => {
    expect((await feed()).some((m) => m.id === ids.hidden)).toBe(false);
    for (const variant of ["original", "thumb", "display", "video", "poster"]) {
      const r = await file(ids.hidden, variant);
      expect(r.status, variant).toBe(404);
      expect(await r.text()).not.toContain(BYTES.toString());
    }
  });

  it("streams the visible shot's file to the portal session", async () => {
    const r = await file(ids.visible);
    if (localStorage) {
      expect(r.status).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(BYTES)).toBe(true);
    } else {
      // No object behind the fixture row outside local storage: the row was authorised, the object is what's missing.
      expect(r.status).toBe(404);
      expect((await r.json()).message).toBe("File not found");
    }
  });

  it("a visible flag never overrides deleted, not-ready or another client's shot", async () => {
    for (const id of [ids.deleted, ids.processing, ids.other]) expect((await file(id)).status, id).toBe(404);
  });

  it("hiding a shot again takes it out of the feed and kills its file URL", async () => {
    await q(`update jobcam_media set client_visible = false where id = $1`, [ids.visible]);
    try {
      expect(await feed()).toEqual([]);
      expect((await file(ids.visible)).status).toBe(404);
    } finally {
      await q(`update jobcam_media set client_visible = true where id = $1`, [ids.visible]);
    }
  });

  it("needs a portal session at all", async () => {
    expect((await fetch(`${BASE}/api/client/jobcam/${ids.visible}/file/original`)).status).toBe(401);
  });
});
