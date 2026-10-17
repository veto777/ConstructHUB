/**
 * Estimate attachments — "Add to all future estimates" (estimate_default
 * library rows sharing the source file's storagePath), "Add from library",
 * and the shared-path-safe delete.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true), started from
 * THIS checkout so its tmp/crm-attachments is the one checked on disk below:
 *   DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const STORAGE_DIR = path.join(process.cwd(), "tmp", "crm-attachments");

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const PDF = Buffer.from(`%PDF-1.4 vitest hardie pamphlet ${randomUUID()}`);

async function api(p: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${p}`, {
    redirect: "manual",
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}
const post = (p: string, body: unknown, cookie?: string) =>
  api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, cookie);

async function upload(p: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string>, cookie?: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([file.data], { type: file.type }), file.name);
  const res = await fetch(`${BASE}${p}`, { method: "POST", headers: cookie ? { cookie } : {}, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const storagePathOf = async (id: string) =>
  (await q<{ storage_path: string }>(`select storage_path from crm_attachments where id = $1`, [id]))[0]?.storage_path;
const onDisk = (storagePath: string) => fs.existsSync(path.join(STORAGE_DIR, storagePath));

afterAll(async () => { await pool.end(); });

describe("estimate attachments — auto-attach library (dev server)", () => {
  let cookie: string | undefined;
  let customerId: string;
  const estimateIds: string[] = [];
  const attachmentIds: string[] = [];

  const newEstimate = async (title: string) => {
    const r = await post("/api/crm/estimates", {
      customerId, title,
      items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 500, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    }, cookie);
    expect(r.status).toBe(201);
    estimateIds.push(r.body.id);
    return r.body.id as string;
  };
  const filesOn = async (estimateId: string) => {
    const r = await api(`/api/crm/attachments?kind=estimate&refId=${estimateId}`, {}, cookie);
    expect(r.status).toBe(200);
    return r.body as any[];
  };

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    const c = await post("/api/crm/customers", {
      addressLine1: "100 Test St", displayName: "Vitest AutoAttach", email: `vitest.autoattach.${Date.now().toString(36)}@example.com`,
    }, cookie);
    expect(c.status).toBe(201);
    customerId = c.body.id;
  });

  afterAll(async () => {
    await q(`delete from crm_attachments where ref_id = any($1) or id = any($2)`, [estimateIds, attachmentIds]);
    await q(`delete from crm_estimate_items where estimate_id = any($1)`, [estimateIds]);
    await q(`delete from crm_estimate_events where estimate_id = any($1)`, [estimateIds]);
    await q(`delete from crm_estimates where id = any($1)`, [estimateIds]);
    await q(`delete from crm_customers where id = $1`, [customerId]);
  });

  it("tick → library row sharing the file; new estimates get it; delete never unlinks a shared file", async () => {
    const e1 = await newEstimate("Vitest auto-attach source");
    const up = await upload("/api/crm/attachments",
      { name: "hardie.pdf", type: "application/pdf", data: PDF }, { kind: "estimate", refId: e1 }, cookie);
    expect(up.status).toBe(201);
    attachmentIds.push(up.body.id);
    const sp = await storagePathOf(up.body.id);
    expect(onDisk(sp)).toBe(true);

    // on → one estimate_default row on the SAME storagePath (no copy)…
    const on = await post(`/api/crm/attachments/${up.body.id}/estimate-default`, { on: true }, cookie);
    expect(on.status).toBe(200);
    expect(on.body.on).toBe(true);
    attachmentIds.push(on.body.defaultId);
    // …and idempotent: on again is the same row.
    const again = await post(`/api/crm/attachments/${up.body.id}/estimate-default`, { on: true }, cookie);
    expect(again.body.defaultId).toBe(on.body.defaultId);
    const lib = await q(`select * from crm_attachments where kind = 'estimate_default' and storage_path = $1`, [sp]);
    expect(lib).toHaveLength(1);
    expect(lib[0].ref_id).toBeNull();
    const listed = await api("/api/crm/attachments?kind=estimate_default", {}, cookie);
    expect(listed.body.find((a: any) => a.id === on.body.defaultId)?.fileKey).toBe(up.body.fileKey);

    // Bad body → 400 (zod), never a silent toggle.
    expect((await post(`/api/crm/attachments/${up.body.id}/estimate-default`, { on: "yes" }, cookie)).status).toBe(400);

    // A brand-new estimate carries the file — same bytes, same path.
    const e2 = await newEstimate("Vitest auto-attach receiver");
    const onE2 = (await filesOn(e2)).filter((a) => a.fileKey === up.body.fileKey);
    expect(onE2).toHaveLength(1);
    expect(await storagePathOf(onE2[0].id)).toBe(sp);

    // Deleting the SOURCE row leaves the file for the library + e2.
    expect((await api(`/api/crm/attachments/${up.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(true);
    const dl = await fetch(`${BASE}/api/crm/attachments/${onE2[0].id}/file`, { headers: { cookie: cookie! } });
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF)).toBe(true);

    // off (via the library row itself) → library row gone, e2 keeps its copy,
    // and the next estimate no longer gets it.
    const off = await post(`/api/crm/attachments/${on.body.defaultId}/estimate-default`, { on: false }, cookie);
    expect(off.status).toBe(200);
    expect(off.body.on).toBe(false);
    expect(await q(`select id from crm_attachments where kind = 'estimate_default' and storage_path = $1`, [sp])).toHaveLength(0);
    expect((await filesOn(e2)).some((a) => a.id === onE2[0].id)).toBe(true);
    expect(onDisk(sp)).toBe(true);
    const e3 = await newEstimate("Vitest after untick");
    expect((await filesOn(e3)).some((a) => a.fileKey === up.body.fileKey)).toBe(false);

    // The LAST reference going is what unlinks the file.
    expect((await api(`/api/crm/attachments/${onE2[0].id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(false);
  });

  it("add from library: pamphlet onto one estimate, idempotent, shared path", async () => {
    const e = await newEstimate("Vitest from library");
    const pam = await upload("/api/crm/attachments",
      { name: "roofing.pdf", type: "application/pdf", data: PDF }, { kind: "pamphlet" }, cookie);
    expect(pam.status).toBe(201);
    attachmentIds.push(pam.body.id);

    const add = await post(`/api/crm/estimates/${e}/attachments/from-library`, { attachmentId: pam.body.id }, cookie);
    expect(add.status).toBe(201);
    expect(add.body.kind).toBe("estimate");
    expect(add.body.refId).toBe(e);
    expect(await storagePathOf(add.body.id)).toBe(await storagePathOf(pam.body.id));
    const dup = await post(`/api/crm/estimates/${e}/attachments/from-library`, { attachmentId: pam.body.id }, cookie);
    expect(dup.status).toBe(200);
    expect(dup.body.id).toBe(add.body.id);

    // An estimate file is not a library source.
    const notLib = await post(`/api/crm/estimates/${e}/attachments/from-library`, { attachmentId: add.body.id }, cookie);
    expect(notLib.status).toBe(404);

    // Removing the estimate's copy keeps the pamphlet's file.
    const sp = await storagePathOf(pam.body.id);
    expect((await api(`/api/crm/attachments/${add.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(true);
    expect((await api(`/api/crm/attachments/${pam.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(false);
  });

  it("direct upload into the library (kind estimate_default) reaches new estimates", async () => {
    const up = await upload("/api/crm/attachments",
      { name: "warranty.pdf", type: "application/pdf", data: PDF }, { kind: "estimate_default" }, cookie);
    expect(up.status).toBe(201);
    attachmentIds.push(up.body.id);
    expect(up.body.refId).toBeNull();
    const e = await newEstimate("Vitest library upload receiver");
    const got = (await filesOn(e)).find((a) => a.fileKey === up.body.fileKey);
    expect(got).toBeTruthy();
    // Toggle off a library-only upload: the estimate still references the file.
    const sp = await storagePathOf(up.body.id);
    expect((await post(`/api/crm/attachments/${up.body.id}/estimate-default`, { on: false }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(true);
    expect((await api(`/api/crm/attachments/${got.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    expect(onDisk(sp)).toBe(false);
  });
});

describe("estimate attachments — read-only seat gets 403", () => {
  const org = randomUUID(), customer = randomUUID(), estimate = randomUUID(), att = randomUUID();
  let cookie = "";

  beforeAll(async () => {
    await q("insert into crm_orgs(id,name,owner_user_id) values($1,'Vitest viewer fixture',1)", [org]);
    await q("insert into crm_customers(id,org_id,display_name,portal_token) values($1,$2,'Viewer customer',gen_random_uuid())", [customer, org]);
    await q("insert into crm_estimates(id,org_id,customer_id,public_token) values($1,$2,$3,gen_random_uuid())", [estimate, org, customer]);
    await q(`insert into crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path)
             values($1,$2,'estimate',$3,'x.pdf','application/pdf',10,$4)`, [att, org, estimate, `${org}/vitest-none.pdf`]);
    // A viewer: sees every job and price, manages nothing (field + read overrides).
    await q(`insert into crm_members(org_id,user_id,email,role,status,permissions)
             values($1,1,'viewer@example.invalid','field','active',$2::jsonb)`,
      [org, JSON.stringify({ viewAllJobs: true, seePrices: true })]);
    const r = await fetch(BASE + "/api/crm/me");
    cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sw = await post("/api/crm/org/switch", { orgId: org }, cookie);
    expect(sw.status).toBe(200);
    cookie = sw.cookie ?? cookie; // the switch may re-issue the session cookie
  });

  afterAll(async () => {
    for (const t of ["crm_attachments", "crm_estimates", "crm_customers", "crm_members"]) {
      await pool.query(`delete from ${t} where org_id = $1`, [org]).catch(() => {});
    }
    await pool.query(`delete from crm_orgs where id = $1`, [org]).catch(() => {});
  });

  it("can read but cannot toggle, add from library, or delete", async () => {
    const list = await api(`/api/crm/attachments?kind=estimate&refId=${estimate}`, {}, cookie);
    expect(list.status).toBe(200);
    expect(list.body.map((a: any) => a.id)).toContain(att);
    expect((await post(`/api/crm/attachments/${att}/estimate-default`, { on: true }, cookie)).status).toBe(403);
    expect((await post(`/api/crm/estimates/${estimate}/attachments/from-library`, { attachmentId: att }, cookie)).status).toBe(403);
    expect((await api(`/api/crm/attachments/${att}`, { method: "DELETE" }, cookie)).status).toBe(403);
    expect(await q(`select id from crm_attachments where org_id = $1 and kind = 'estimate_default'`, [org])).toHaveLength(0);
  });
});
