/**
 * The photo library (server/crm/photo-library.ts): listing, filters, paging,
 * org isolation, division/assignment scoping, the platform hand-offs (Photo
 * Optimizer staging, Media library copy) and the review page's token-scoped
 * project photos.
 *
 * In-process routes on the lane Postgres (like plan-refusals.test.ts): fresh
 * users, orgs and real image files on disk, all removed afterwards. R2 is
 * mocked; no email, SMS or Stripe calls.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const r2Puts: { key: string; bytes: number }[] = [];
vi.mock("../r2", () => ({
  r2Configured: () => true,
  uploadToR2: vi.fn(async (buffer: Buffer, _type: string, folder: string, ext: string) => {
    const key = `${folder}/${Math.random().toString(36).slice(2)}.${ext}`;
    r2Puts.push({ key, bytes: buffer.length });
    return key;
  }),
  getR2Url: (key: string) => `/api/files/${key}`,
  deleteFromR2: vi.fn(async () => {}),
}));
vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: [] })) }));

import { pool } from "../db";
import { PLAN_KEYS } from "@shared/plans";

let base = "", server: ReturnType<express.Express["listen"]>;
const staged: { id: string; path: string; originalName: string }[] = [];
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function call(user: number | null, p: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (user) headers["x-fixture-user"] = String(user);
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data: data as any, type: ct };
}

const users: number[] = [];
const orgs: string[] = [];
const files: string[] = [];
const STORAGE = path.join(process.cwd(), "tmp", "crm-attachments");

async function user(opts: { crm?: boolean; platform?: boolean } = {}) {
  const id = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`photolib-${randomUUID()}@example.invalid`])).rows[0].id as number;
  users.push(id);
  if (opts.crm) await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_elite','active')", [id]);
  if (opts.platform) await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [id, PLAN_KEYS[0]]);
  return id;
}
async function org(owner: number) {
  const id = randomUUID();
  orgs.push(id);
  await pool.query("INSERT INTO crm_orgs(id,name,owner_user_id) VALUES($1,$2,$3)", [id, `photolib ${id.slice(0, 6)}`, owner]);
  await member(id, owner, "owner");
  return id;
}
async function member(orgId: string, userId: number, role: string, divisionId: string | null = null) {
  const id = randomUUID();
  await pool.query("INSERT INTO crm_members(id,org_id,user_id,email,role,status,division_id) VALUES($1,$2,$3,$4,$5,'active',$6)",
    [id, orgId, userId, `m-${id.slice(0, 8)}@example.invalid`, role, divisionId]);
  return id;
}
async function customer(orgId: string, name: string, extra: { email?: string; phone?: string } = {}) {
  const id = randomUUID();
  await pool.query("INSERT INTO crm_customers(id,org_id,display_name,portal_token,address_line1,email,phone) VALUES($1,$2,$3,gen_random_uuid(),$4,$5,$6)",
    [id, orgId, name, `${name} street`, extra.email ?? null, extra.phone ?? null]);
  return id;
}
async function project(orgId: string, customerId: string, status: string, divisionId: string | null) {
  const id = randomUUID();
  await pool.query("INSERT INTO crm_projects(id,org_id,customer_id,name,status,division_id) VALUES($1,$2,$3,$4,$5,$6)",
    [id, orgId, customerId, `Job ${id.slice(0, 4)}`, status, divisionId]);
  return id;
}
let jpeg: Buffer;
let n = 0;
async function photo(orgId: string, customerId: string, fileName: string) {
  const id = randomUUID();
  const storagePath = `${orgId}/${randomUUID()}.jpg`;
  fs.mkdirSync(path.join(STORAGE, orgId), { recursive: true });
  fs.writeFileSync(path.join(STORAGE, storagePath), jpeg);
  files.push(path.join(STORAGE, storagePath));
  // Distinct, increasing timestamps so "newest first" is deterministic.
  await pool.query(`INSERT INTO crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path,created_at)
    VALUES($1,$2,'photo',$3,$4,'image/jpeg',$5,$6, now() - interval '1 day' + ($7 || ' seconds')::interval)`,
    [id, orgId, customerId, fileName, jpeg.length, storagePath, String(++n)]);
  return id;
}

// ── Fixture ─────────────────────────────────────────────────────────────────
let ownerA: number, ownerB: number, pinned: number, field: number, noPlan: number;
let orgA: string, orgB: string, divWA: string, divFL: string;
let c1: string, c2: string, c3: string, cB: string, cNoPhotos: string;
let p1: string;
const P: Record<string, string> = {};

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  // Boot's additive DDL (the review_requests CRM-link columns).
  await (await import("../growth-schema")).ensureGrowthSchema();
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();

  const { registerCrmRoutes } = await import("./routes");
  const { registerCrmPhotoPlatformRoutes, registerReviewProjectPhotoRoutes, resolveReviewCrmLink } = await import("./photo-library");
  const { platformAccessGate } = await import("../platform-access");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const id = Number(req.headers["x-fixture-user"]);
    if (id) req.user = { id };
    req.session = {};
    next();
  });
  app.use(platformAccessGate);
  const getUser = (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null);
  registerCrmRoutes(app, getUser);
  registerCrmPhotoPlatformRoutes(app, getUser, (f) => { const id = randomUUID().slice(0, 12); staged.push({ id, ...f }); return id; });
  registerReviewProjectPhotoRoutes(app);
  // The review composer's link step, as POST /api/reviews/create runs it (server/routes.ts).
  app.post("/test/review-link", async (req: any, res) => {
    const link = await resolveReviewCrmLink(req, res, getUser, req.body);
    if (link) res.json(link);
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ownerA = await user({ crm: true });
  ownerB = await user({ crm: true });
  pinned = await user({ platform: true });
  field = await user({ platform: true });
  noPlan = await user();
  orgA = await org(ownerA);
  orgB = await org(ownerB);
  divWA = randomUUID(); divFL = randomUUID();
  await pool.query("INSERT INTO crm_divisions(id,org_id,name,code) VALUES($1,$3,'Washington','WA'),($2,$3,'Florida','FL')", [divWA, divFL, orgA]);
  await member(orgA, pinned, "pm", divFL);
  await member(orgA, field, "field");
  await member(orgA, noPlan, "admin");

  c1 = await customer(orgA, "Alder Finished", { email: "alder@example.invalid", phone: "5550001111" });
  p1 = await project(orgA, c1, "complete", divWA);
  P.c1progress = await photo(orgA, c1, "progress--tearoff.jpg");
  P.c1client = await photo(orgA, c1, "IMG_2001.jpg");
  P.c1hover = await photo(orgA, c1, "hover-777-1.jpg");
  P.c1finished = await photo(orgA, c1, "finished--done.jpg");
  c2 = await customer(orgA, "Birch Underway");
  await project(orgA, c2, "in_progress", divFL);
  P.c2a = await photo(orgA, c2, "progress--a.jpg");
  P.c2b = await photo(orgA, c2, "progress--b.jpg");
  c3 = await customer(orgA, "Cedar Many");
  await project(orgA, c3, "scheduled", divWA);
  for (let i = 0; i < 70; i++) await photo(orgA, c3, `finished--${i}.jpg`);
  cNoPhotos = await customer(orgA, "Dogwood Nophotos");
  cB = await customer(orgB, "Elm Other Org");
  P.b = await photo(orgB, cB, "finished--other.jpg");
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  for (const f of [...files, ...staged.map((s) => s.path)]) fs.rmSync(f, { force: true });
  for (const o of orgs) fs.rmSync(path.join(process.cwd(), "tmp", "crm-photo-thumbs", o), { recursive: true, force: true });
  await pool.query("DELETE FROM review_requests WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM media_photos WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM media_folders WHERE user_id=ANY($1::int[])", [users]);
  for (const t of ["crm_attachments", "crm_projects", "crm_customers", "crm_divisions", "crm_members"]) {
    await pool.query(`DELETE FROM ${t} WHERE org_id=ANY($1::varchar[])`, [orgs]);
  }
  await pool.query("DELETE FROM crm_orgs WHERE id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM crm_subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE $1", [`review-photo-%:ip:%`]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
}, 60_000);

const ids = (r: any) => (r.data.photos as any[]).map((p) => p.id);

describe("listing and filters", () => {
  it("lists the org's photos newest first with per-stage counts", async () => {
    const r = await call(ownerA, "/api/crm/photos");
    expect(r.status).toBe(200);
    expect(r.data.facets).toEqual({ all: 76, progress: 3, finished: 71, client: 1, hover: 1, unstaged: 2 });
    expect(r.data.total).toBe(76);
    expect(r.data.photos).toHaveLength(60);
    expect(r.data.photos[0].customer.name).toBe("Cedar Many");
  });

  it("each stage filter returns exactly its photos, classified", async () => {
    const pick = async (stage: string) => call(ownerA, `/api/crm/photos?stage=${stage}&customerId=${c1}`);
    expect(ids(await pick("progress"))).toEqual([P.c1progress]);
    expect(ids(await pick("finished"))).toEqual([P.c1finished]);
    expect(ids(await pick("client"))).toEqual([P.c1client]);
    expect(ids(await pick("hover"))).toEqual([P.c1hover]);
    expect(ids(await pick("unstaged")).sort()).toEqual([P.c1client, P.c1hover].sort());
    const all = await pick("all");
    const byId = Object.fromEntries((all.data.photos as any[]).map((p) => [p.id, p]));
    expect(byId[P.c1progress]).toMatchObject({ stage: "progress", source: "crew", fileName: "tearoff.jpg" });
    expect(byId[P.c1hover]).toMatchObject({ stage: null, source: "hover" });
    expect(byId[P.c1client]).toMatchObject({ stage: null, source: "client" });
    // The client's only project is derivable.
    expect(byId[P.c1finished].project).toMatchObject({ id: p1, status: "complete" });
    expect(byId[P.c1finished].customer).toMatchObject({ id: c1, name: "Alder Finished" });
    expect((await call(ownerA, "/api/crm/photos?stage=nope")).status).toBe(400);
  });

  it("filters by job status, search, project and date", async () => {
    const done = await call(ownerA, "/api/crm/photos?jobStatus=completed");
    expect(new Set((done.data.photos as any[]).map((p) => p.customer.id))).toEqual(new Set([c1]));
    const active = await call(ownerA, "/api/crm/photos?jobStatus=active&limit=120");
    expect(new Set((active.data.photos as any[]).map((p) => p.customer.id))).toEqual(new Set([c2, c3]));
    expect((await call(ownerA, "/api/crm/photos?q=birch")).data.total).toBe(2);
    expect((await call(ownerA, `/api/crm/photos?projectId=${p1}`)).data.total).toBe(4);
    expect((await call(ownerA, "/api/crm/photos?to=2001-01-01")).data.total).toBe(0);
  });

  it("pages without overlap and says when it is done", async () => {
    const one = await call(ownerA, `/api/crm/photos?customerId=${c3}`);
    expect(one.data.photos).toHaveLength(60);
    expect(one.data.nextOffset).toBe(60);
    const two = await call(ownerA, `/api/crm/photos?customerId=${c3}&offset=60`);
    expect(two.data.photos).toHaveLength(10);
    expect(two.data.nextOffset).toBeNull();
    expect(new Set([...ids(one), ...ids(two)]).size).toBe(70);
  });

  it("by job: counts per client and a finished cover", async () => {
    const r = await call(ownerA, "/api/crm/photos/jobs");
    expect(r.status).toBe(200);
    const job = (r.data.jobs as any[]).find((j) => j.customer.id === c1);
    expect(job.counts).toMatchObject({ all: 4, progress: 1, finished: 1, client: 1, hover: 1 });
    expect(job.cover.id).toBe(P.c1finished);
    expect(job.jobStatus).toEqual({ active: false, completed: true });
    expect((r.data.jobs as any[]).some((j) => j.customer.id === cNoPhotos)).toBe(false);
    const finishedOnly = await call(ownerA, "/api/crm/photos/jobs?stage=client");
    expect((finishedOnly.data.jobs as any[]).map((j) => j.customer.id)).toEqual([c1]);
  });

  it("thumbnails are real, size-capped JPEGs", async () => {
    const r = await call(ownerA, `/api/crm/photos/${P.c1finished}/thumb`);
    expect(r.status).toBe(200);
    expect(r.type).toContain("image/jpeg");
    const meta = await sharp(r.data as Buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(420);
  });

  it("downloads a selection as a zip", async () => {
    const r = await call(ownerA, `/api/crm/photos/download.zip?ids=${P.c1finished},${P.c1progress}`);
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/zip");
    expect((r.data as Buffer).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("org isolation", () => {
  it("another org's photo is never listed, previewed, zipped or copied", async () => {
    const all = await call(ownerA, "/api/crm/photos?limit=120");
    expect(ids(all)).not.toContain(P.b);
    const jobs = await call(ownerA, "/api/crm/photos/jobs");
    expect((jobs.data.jobs as any[]).some((j) => j.customer.id === cB)).toBe(false);
    expect((await call(ownerA, `/api/crm/photos?customerId=${cB}`)).data.total).toBe(0);
    expect((await call(ownerA, `/api/crm/photos/${P.b}/thumb`)).status).toBe(404);
    expect((await call(ownerA, `/api/crm/photos/download.zip?ids=${P.b}`)).status).toBe(404);
    expect((await call(ownerA, "/api/photos/from-crm", { ids: [P.b] })).status).toBe(404);
    const folder = (await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,'x') RETURNING id", [ownerA])).rows[0].id;
    expect((await call(ownerA, "/api/media/from-crm", { folderId: folder, ids: [P.b] })).status).toBe(404);
    // …and one foreign id spoils the whole request: nothing partial is copied.
    expect((await call(ownerA, "/api/photos/from-crm", { ids: [P.c1finished, P.b] })).status).toBe(404);
    // The other org's owner sees only their own.
    const b = await call(ownerB, "/api/crm/photos");
    expect(ids(b)).toEqual([P.b]);
    const clients = await call(ownerB, "/api/crm/photos/clients?q=a");
    expect((clients.data.clients as any[]).every((c) => c.id === cB)).toBe(true);
  });
});

describe("division and assignment scoping", () => {
  it("a member pinned to a division sees only that division's clients and photos", async () => {
    const r = await call(pinned, "/api/crm/photos");
    expect(r.status).toBe(200);
    expect(r.data.facets.all).toBe(2);
    expect(ids(r).sort()).toEqual([P.c2a, P.c2b].sort());
    expect((await call(pinned, `/api/crm/photos/${P.c1finished}/thumb`)).status).toBe(404);
    expect((await call(pinned, `/api/crm/photos?customerId=${c1}`)).status).toBe(404);
    expect((await call(pinned, `/api/crm/photos?projectId=${p1}`)).status).toBe(404);
    expect((await call(pinned, `/api/crm/photos/download.zip?ids=${P.c1finished}`)).status).toBe(404);
    const jobs = await call(pinned, "/api/crm/photos/jobs");
    expect((jobs.data.jobs as any[]).map((j) => j.customer.id)).toEqual([c2]);
    const clients = await call(pinned, "/api/crm/photos/clients");
    expect((clients.data.clients as any[]).map((c) => c.id)).toEqual([c2]);
    // Platform hand-offs follow the same rule.
    expect((await call(pinned, "/api/photos/from-crm", { ids: [P.c1finished] })).status).toBe(404);
    expect((await call(pinned, "/api/photos/from-crm", { ids: [P.c2a] })).status).toBe(200);
    expect((await call(pinned, "/test/review-link", { crmCustomerId: c1 })).status).toBe(404);
  });

  it("a field seat without See all jobs and no assignment sees nothing and cannot export", async () => {
    const r = await call(field, "/api/crm/photos");
    expect(r.status).toBe(200);
    expect(r.data.total).toBe(0);
    expect((await call(field, `/api/crm/photos/${P.c2a}/thumb`)).status).toBe(404);
    expect((await call(field, "/api/photos/from-crm", { ids: [P.c2a] })).status).toBe(403);
  });

  it("an account that is on no CRM team gets no_crm_company (and no org is created)", async () => {
    const outsider = await user({ platform: true });
    const r = await call(outsider, "/api/crm/photos");
    expect(r.status).toBe(404);
    expect(r.data.code).toBe("no_crm_company");
    const { rows } = await pool.query("SELECT 1 FROM crm_members WHERE user_id=$1", [outsider]);
    expect(rows).toHaveLength(0);
    expect((await call(outsider, "/api/photos/from-crm", { ids: [P.c1finished] })).status).toBe(404);
  });
});

describe("platform hand-offs", () => {
  it("the Photo Optimizer receives JPEG copies staged under its own file ids", async () => {
    const r = await call(ownerA, "/api/photos/from-crm", { ids: [P.c1finished, P.c1progress] });
    expect(r.status).toBe(200);
    expect(r.data.files).toHaveLength(2);
    expect(r.data.skipped).toEqual([]);
    for (const f of r.data.files) {
      const s = staged.find((x) => x.id === f.id)!;
      expect(fs.existsSync(s.path)).toBe(true);
      expect(s.originalName).toMatch(/^Alder Finished .+\.jpg$/);
    }
    expect((await call(ownerA, "/api/photos/from-crm", { ids: Array(11).fill(P.c1finished) })).status).toBe(400);
  });

  it("needs a signed-in account with platform access", async () => {
    expect((await call(null, "/api/photos/from-crm", { ids: [P.c1finished] })).status).toBe(401);
    expect((await call(null, "/api/media/from-crm", { folderId: 1, ids: [P.c1finished] })).status).toBe(401);
    // A CRM admin seat whose own account has no platform access: the platform paywall answers first.
    const r = await call(noPlan, "/api/media/from-crm", { folderId: 1, ids: [P.c1finished] });
    expect(r.status).toBe(402);
    expect((await call(noPlan, "/api/photos/from-crm", { ids: [P.c1finished] })).status).toBe(402);
  });

  it("Save to Media library copies into the caller's own folder only", async () => {
    const mine = (await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,'Alder job') RETURNING id", [ownerA])).rows[0].id;
    const theirs = (await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,'B folder') RETURNING id", [ownerB])).rows[0].id;
    const before = r2Puts.length;
    const ok = await call(ownerA, "/api/media/from-crm", { folderId: mine, ids: [P.c1finished, P.c1client] });
    expect(ok.status).toBe(200);
    expect(ok.data.count).toBe(2);
    expect(r2Puts.length - before).toBe(2);
    const { rows } = await pool.query("SELECT name, url FROM media_photos WHERE folder_id=$1 ORDER BY id", [mine]);
    expect(rows.map((x) => x.name)).toEqual(["Alder Finished — done.jpg", "Alder Finished — IMG_2001.jpg"]);
    expect(rows[0].url).toMatch(/^\/api\/files\/media\//);
    expect((await call(ownerA, "/api/media/from-crm", { folderId: theirs, ids: [P.c1finished] })).status).toBe(404);
    expect((await call(field, "/api/media/from-crm", { folderId: mine, ids: [P.c2a] })).status).toBe(404);
  });
});

describe("review requests", () => {
  it("Select client: the picker links a visible client and checks every ticked photo", async () => {
    const pick = await call(ownerA, "/api/crm/photos/clients?q=alder");
    expect(pick.data.clients).toEqual([expect.objectContaining({ id: c1, name: "Alder Finished", email: "alder@example.invalid", phone: "5550001111", photoCount: 4 })]);
    const link = await call(ownerA, "/test/review-link", { crmCustomerId: c1, crmPhotoIds: [P.c1finished] });
    expect(link.status).toBe(200);
    expect(link.data).toMatchObject({ crmOrgId: orgA, crmCustomerId: c1, photos: [{ attachmentId: P.c1finished, originalName: "done.jpg" }] });
    expect((await call(ownerA, "/test/review-link", { crmCustomerId: cB })).status).toBe(404);
    expect((await call(ownerA, "/test/review-link", { crmPhotoIds: [P.b] })).status).toBe(404);
    // A hand-typed request carries no link at all.
    expect((await call(ownerA, "/test/review-link", { clientName: "x" })).data).toEqual({});
  });

  async function request(fields: Record<string, unknown>) {
    const token = randomUUID();
    await pool.query(`INSERT INTO review_requests(user_id,client_name,client_email,google_profile_url,token,photos,crm_org_id,crm_customer_id,crm_photo_ids)
      VALUES($1,'Alder','alder@example.invalid','https://g.page/r/x/review',$2,$3,$4,$5,$6)`,
      [ownerA, token, JSON.stringify(fields.photos ?? []), fields.crmOrgId ?? null, fields.crmCustomerId ?? null, JSON.stringify(fields.crmPhotoIds ?? [])]);
    return token;
  }

  it("the homeowner chooses from their own project photos only", async () => {
    const token = await request({ crmOrgId: orgA, crmCustomerId: c1 });
    const list = await call(null, `/api/review/${token}/project-photos`);
    expect(list.status).toBe(200);
    expect(list.data.available).toBe(true);
    expect((list.data.photos as any[]).map((p) => p.id).sort()).toEqual([P.c1progress, P.c1client, P.c1hover, P.c1finished].sort());
    expect(list.data.photos[0].id).toBe(P.c1finished);
    expect((await call(null, `/api/review/${token}/photos/${P.c1finished}?size=sm`)).status).toBe(200);
    // Another client's photo, another org's photo, a wrong token: all absent.
    expect((await call(null, `/api/review/${token}/photos/${P.c2a}`)).status).toBe(404);
    expect((await call(null, `/api/review/${token}/photos/${P.b}`)).status).toBe(404);
    expect((await call(null, `/api/review/${randomUUID()}/photos/${P.c1finished}`)).status).toBe(404);
    expect((await call(null, `/api/review/${randomUUID()}/project-photos`)).status).toBe(404);
    expect((await call(null, `/api/review/${token}/project-photos`, { ids: [P.c1finished, P.c2a] })).status).toBe(404);
    const chose = await call(null, `/api/review/${token}/project-photos`, { ids: [P.c1finished, P.c1progress] });
    expect(chose.status).toBe(200);
    const { rows: [row] } = await pool.query("SELECT photos, client_photo_ids FROM review_requests WHERE token=$1", [token]);
    expect(row.client_photo_ids).toEqual([P.c1finished, P.c1progress]);
    expect(row.photos.map((p: any) => p.url)).toEqual([`/api/review/${token}/photos/${P.c1finished}`, `/api/review/${token}/photos/${P.c1progress}`]);
    const dl = await call(null, `/api/review/${token}/photos/${P.c1progress}/download?name=x.jpg`);
    expect(dl.status).toBe(200);
    expect((dl.data as Buffer).equals(jpeg)).toBe(true);
  });

  it("contractor-attached photos are served by allow-list and the homeowner is offered nothing else", async () => {
    const token = await request({ crmOrgId: orgA, crmCustomerId: c1, crmPhotoIds: [P.c2a], photos: [{ url: "x", originalName: "a.jpg" }] });
    expect((await call(null, `/api/review/${token}/project-photos`)).data).toEqual({ available: false, photos: [], selected: [] });
    expect((await call(null, `/api/review/${token}/photos/${P.c2a}`)).status).toBe(200);
    expect((await call(null, `/api/review/${token}/photos/${P.c1finished}`)).status).toBe(404);
    expect((await call(null, `/api/review/${token}/project-photos`, { ids: [P.c1finished] })).status).toBe(409);
  });

  it("a hand-typed request (no linked client) has no photos to offer", async () => {
    const token = await request({});
    expect((await call(null, `/api/review/${token}/project-photos`)).data).toEqual({ available: false, photos: [], selected: [] });
    expect((await call(null, `/api/review/${token}/photos/${P.c1finished}`)).status).toBe(404);
  });
});
