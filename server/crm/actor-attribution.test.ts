/**
 * Actor attribution, end to end — every attachment insert path records who
 * added the file, uploads/deletes land in crm_activity_log, and the client
 * timeline / activity / estimate history name the person (owner order
 * 2026-10-17: "Gabe Varnadore added a project photo …", "Veto Smith (Owner)").
 *
 * Requires a dev server (DEV_AUTH_BYPASS_USER1=true) started from THIS
 * checkout on a THROWAWAY clone of the dev DB, and the same DB here:
 *   sudo -n -u postgres psql -c "create database constructhub_dev_actorattr template constructhub_dev owner constructhub_dev"
 *   DATABASE_URL=…/constructhub_dev_actorattr DEV_AUTH_BYPASS_USER1=true PORT=8361 npx tsx server/index.ts
 *   CRM_TEST_BASE_URL=http://127.0.0.1:8361 CRM_TEST_DATABASE_URL=…/constructhub_dev_actorattr npx vitest run server/crm/actor-attribution.test.ts
 * The direct-call paths (storeGeneratedPdf, the HOVER photo import) run in
 * this process against CRM_TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, createHash, randomUUID } from "crypto";
import pg from "pg";

const DB_URL = process.env.CRM_TEST_DATABASE_URL
  ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
process.env.DATABASE_URL = DB_URL;
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({ connectionString: DB_URL });
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(p: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${p}`, {
    redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
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
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64), 0xff, 0xd9]);
const PDF = Buffer.from(`%PDF-1.4 vitest actor ${randomUUID()}`);
const uploaderOf = async (id: string) =>
  (await q(`select uploaded_by_member_id as m, uploaded_by_label as l, uploaded_by_kind as k from crm_attachments where id = $1`, [id]))[0];
/** The activity-log rows for one entity. logActivity is fire-and-forget (it may land just after
 *  the response), so wait briefly until `want` (an action) shows up. */
const logOf = async (entityId: string, want?: string) => {
  for (let i = 0; ; i++) {
    const rows = await q(`select action, actor_member_id, actor_label, customer_id from crm_activity_log where entity_id = $1 order by created_at`, [entityId]);
    if ((want ? rows.some((r) => r.action === want) : rows.length) || i >= 40) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("actor attribution (dev server)", () => {
  let cookie: string | undefined;
  let orgId: string;
  let memberId: string;
  let ownerLabel: string;
  let custId: string;
  const custName = `Vitest Carley ${Date.now().toString(36)}`;
  const estIds: string[] = [];
  const attIds: string[] = [];

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    cookie = me.cookie;
    orgId = me.body.org.id;
    memberId = me.body.member.id;
    const [m] = await q(`select m.role, m.display_name, u.display_name as udn from crm_members m left join users u on u.id = m.user_id where m.id = $1`, [memberId]);
    expect(m.role).toBe("owner");
    const name = (m.display_name || m.udn || "").trim();
    ownerLabel = name && !name.includes("@") ? `${name} (Owner)` : "Owner";
    const c = await post("/api/crm/customers", { displayName: custName, addressLine1: "100 Test St", email: `vitest.actor.${Date.now()}@example.com` }, cookie);
    expect(c.status).toBe(201);
    custId = c.body.id;
  });

  afterAll(async () => {
    const ids = [...attIds];
    const extra = await q<{ id: string }>(`select id from crm_attachments where org_id = $1 and (ref_id = $2 or ref_id = any($3) or (kind = 'estimate_default' and file_name like 'vitest-actor-%'))`, [orgId, custId, estIds]);
    ids.push(...extra.map((r) => r.id));
    await q(`delete from crm_activity_log where entity_id = any($1) or customer_id = $2`, [ids, custId]);
    await q(`delete from crm_attachments where id = any($1)`, [ids]);
    await q(`delete from crm_measurements where customer_id = $1`, [custId]);
    await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [custId]);
    await q(`delete from crm_estimate_events where estimate_id = any($1)`, [estIds]);
    await q(`delete from crm_estimate_items where estimate_id = any($1)`, [estIds]);
    await q(`delete from crm_estimates where id = any($1)`, [estIds]);
    await q(`delete from crm_customers where id = $1`, [custId]);
    await pool.end();
  });

  it("CRM upload records the member, logs attachment.added, and the timeline names them", async () => {
    const r = await upload("/api/crm/attachments", { name: "IMG_3305.jpeg", type: "image/jpeg", data: JPEG },
      { kind: "photo", refId: custId, stage: "progress" }, cookie);
    expect(r.status).toBe(201);
    attIds.push(r.body.id);
    expect(await uploaderOf(r.body.id)).toEqual({ m: memberId, l: null, k: "member" });
    expect(r.body.uploadedBy).toMatchObject({ kind: "member", isOwner: true });
    const log = await logOf(r.body.id, "attachment.added");
    expect(log).toEqual([expect.objectContaining({ action: "attachment.added", actor_member_id: memberId, customer_id: custId })]);

    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    const e = (tl.body as any[]).find((x) => x.id === `att-${r.body.id}`);
    expect(e.text).toBe(`${ownerLabel} added a project photo (in progress) — IMG_3305.jpeg`);
    expect(e.actor).toMatchObject({ kind: "member", isOwner: true });
    expect(e.actionText).toBe("added a project photo (in progress) — IMG_3305.jpeg");
  });

  it("client portal upload records the client's name and reads as theirs", async () => {
    const raw = randomBytes(32).toString("hex");
    await q(`insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) values ($1, $2::jsonb, now() + interval '1 day', now())`,
      [sha256(raw), JSON.stringify([custId])]);
    const r = await upload("/api/client/photos", { name: "porch.jpg", type: "image/jpeg", data: JPEG }, { customerId: custId }, `crm_client=${raw}`);
    expect(r.status).toBe(201);
    attIds.push(r.body.id);
    expect(await uploaderOf(r.body.id)).toEqual({ m: null, l: custName, k: "client" });
    expect((await logOf(r.body.id, "attachment.added"))[0]).toMatchObject({ action: "attachment.added", actor_member_id: null, actor_label: "client" });
    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    const e = (tl.body as any[]).find((x) => x.id === `att-${r.body.id}`);
    expect(e.text).toBe(`${custName} shared a photo — porch.jpg`);
    expect(e.actor).toMatchObject({ kind: "client", name: custName });
  });

  it("estimate file → library → from-library / auto-attach copies keep the ORIGINAL uploader and log who attached", async () => {
    const mk = async () => {
      const e = await post("/api/crm/estimates", { customerId: custId, title: "Vitest actor estimate", items: [] }, cookie);
      expect(e.status).toBe(201);
      estIds.push(e.body.id);
      return e.body.id as string;
    };
    const e1 = await mk();
    const f = await upload("/api/crm/attachments", { name: "vitest-actor-warranty.pdf", type: "application/pdf", data: PDF },
      { kind: "estimate", refId: e1 }, cookie);
    expect(f.status).toBe(201);
    attIds.push(f.body.id);
    expect((await logOf(f.body.id, "attachment.added"))[0]).toMatchObject({ action: "attachment.added", customer_id: custId });

    const on = await post(`/api/crm/attachments/${f.body.id}/estimate-default`, { on: true }, cookie);
    expect(on.status).toBe(200);
    attIds.push(on.body.defaultId);
    expect(await uploaderOf(on.body.defaultId)).toEqual({ m: memberId, l: null, k: "member" });
    expect((await logOf(on.body.defaultId, "attachment.default_on")).map((r) => r.action)).toContain("attachment.default_on");

    // A new estimate auto-attaches the library file: same uploader, logged as Auto-attach.
    const e2 = await mk();
    const [auto] = await q(`select id from crm_attachments where kind = 'estimate' and ref_id = $1`, [e2]);
    expect(auto).toBeTruthy();
    expect(await uploaderOf(auto.id)).toEqual({ m: memberId, l: null, k: "member" });
    expect((await logOf(auto.id))[0]).toMatchObject({ action: "attachment.auto_attached", actor_label: "Auto-attach", customer_id: custId });

    // Remove it, then put it back from the library by hand: attacher = the member.
    const del = await api(`/api/crm/attachments/${auto.id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    expect((await logOf(auto.id, "attachment.deleted")).map((r) => r.action)).toContain("attachment.deleted");
    const lib = await post(`/api/crm/estimates/${e2}/attachments/from-library`, { attachmentId: on.body.defaultId }, cookie);
    expect(lib.status).toBe(201);
    attIds.push(lib.body.id);
    expect(await uploaderOf(lib.body.id)).toEqual({ m: memberId, l: null, k: "member" });
    expect((await logOf(lib.body.id, "attachment.attached"))[0]).toMatchObject({ action: "attachment.attached", actor_member_id: memberId });

    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    const line = (tl.body as any[]).find((x) => x.id === `att-${lib.body.id}`);
    expect(line.text).toMatch(new RegExp(`^${ownerLabel.replace(/[()]/g, "\\$&")} attached vitest-actor-warranty\\.pdf to estimate `));

    // The client Activity audit feed shows the delete by name; adds stay in the feed too
    // (the durable record) and the page dedupes them against the timeline.
    const act = await api(`/api/crm/customers/${custId}/activity`, {}, cookie);
    const texts = (act.body as any[]).map((a) => a.text);
    const e2Number = (await q(`select number from crm_estimates where id = $1`, [e2]))[0].number;
    expect(texts).toContain(`${ownerLabel} removed vitest-actor-warranty.pdf from estimate ${e2Number}`);
    const addRow = (act.body as any[]).find((a) => a.action === "attachment.added" && a.entityId === f.body.id);
    expect(addRow).toMatchObject({ entityType: "attachment", actor: { kind: "member", isOwner: true } });

    // Estimate history names the actor of each event.
    const det = await api(`/api/crm/estimates/${e2}`, {}, cookie);
    const created = det.body.events.find((ev: any) => ev.type === "created");
    expect(created.actor).toMatchObject({ kind: "member", isOwner: true });
    expect(created.actorName).toBe(ownerLabel);

    // The library toggle is on the client's Activity too (customerId recorded).
    const defaultRow = (act.body as any[]).find((a) => a.action === "attachment.default_on");
    expect(defaultRow?.text).toBe(`${ownerLabel} set vitest-actor-warranty.pdf to attach to all future estimates`);

    // A restricted seat (no viewAllJobs) still sees the attachment rows it may see —
    // including the delete, whose attachment row is gone (gated by its estimate).
    const [orig] = await q(`select permissions from crm_members where id = $1`, [memberId]);
    try {
      await q(`update crm_members set permissions = coalesce(permissions, '{}'::jsonb) || '{"viewAllJobs": false}'::jsonb where id = $1`, [memberId]);
      const me = await api("/api/crm/me", {}, cookie);
      expect(me.body.permissions.viewAllJobs).toBe(false);
      const restricted = await api(`/api/crm/customers/${custId}/activity`, {}, cookie);
      expect(restricted.status).toBe(200);
      const actions = (restricted.body as any[]).map((a) => a.action);
      expect(actions).toContain("attachment.deleted");
      expect(actions).toContain("attachment.default_on");
    } finally {
      await q(`update crm_members set permissions = $2 where id = $1`, [memberId, orig.permissions === null ? null : JSON.stringify(orig.permissions)]);
    }
    await post(`/api/crm/attachments/${on.body.defaultId}/estimate-default`, { on: false }, cookie);
  });

  it("the stage tag is photo-only: a PDF named progress--… keeps its name in the log", async () => {
    const e = await post("/api/crm/estimates", { customerId: custId, title: "Vitest actor stage", items: [] }, cookie);
    estIds.push(e.body.id);
    const f = await upload("/api/crm/attachments", { name: "progress--schedule.pdf", type: "application/pdf", data: PDF },
      { kind: "estimate", refId: e.body.id }, cookie);
    expect(f.status).toBe(201);
    attIds.push(f.body.id);
    await logOf(f.body.id, "attachment.added");
    const [row] = await q(`select meta from crm_activity_log where entity_id = $1 and action = 'attachment.added'`, [f.body.id]);
    expect(row.meta).toMatchObject({ kind: "estimate", fileName: "progress--schedule.pdf", stage: null, refId: e.body.id });
  });

  it("a client named like a system source stays the client (uploaded_by_kind)", async () => {
    await q(`update crm_customers set display_name = 'Stripe' where id = $1`, [custId]);
    try {
      const raw = randomBytes(32).toString("hex");
      await q(`insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) values ($1, $2::jsonb, now() + interval '1 day', now())`,
        [sha256(raw), JSON.stringify([custId])]);
      const r = await upload("/api/client/photos", { name: "stripe-client.jpg", type: "image/jpeg", data: JPEG }, { customerId: custId }, `crm_client=${raw}`);
      expect(r.status).toBe(201);
      attIds.push(r.body.id);
      expect(await uploaderOf(r.body.id)).toEqual({ m: null, l: "Stripe", k: "client" });
      const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
      const e = (tl.body as any[]).find((x) => x.id === `att-${r.body.id}`);
      expect(e.actor).toMatchObject({ kind: "client", name: "Stripe" });
      expect(e.text).toBe("Stripe shared a photo — stripe-client.jpg");
    } finally {
      await q(`update crm_customers set display_name = $2 where id = $1`, [custId, custName]);
    }
  });

  it("generated PDFs default to 'System'; the HOVER photo import is 'HOVER import'", async () => {
    const { storeGeneratedPdf } = await import("./attachments");
    const pdf = await storeGeneratedPdf({ orgId, kind: "contract", refId: estIds[0] ?? null, fileName: "contract-vitest.pdf", buffer: PDF });
    attIds.push(pdf.id);
    expect(await uploaderOf(pdf.id)).toEqual({ m: null, l: "System", k: "system" });

    const { importHoverJobPhotos } = await import("./hover");
    const job = { models: [{ images: [{ id: "img1", image: { url: "https://hover.example.test/img1.jpg" } }] }] };
    const fakeFetch: any = async () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    const got = await importHoverJobPhotos(orgId, "vitestjob", custId, job, {}, fakeFetch);
    expect(got.stored).toBe(1);
    const [row] = await q(`select id, uploaded_by_member_id as m, uploaded_by_label as l, uploaded_by_kind as k from crm_attachments where ref_id = $1 and file_name = 'hover-vitestjob-img1.jpg'`, [custId]);
    attIds.push(row.id);
    expect({ m: row.m, l: row.l, k: row.k }).toEqual({ m: null, l: "HOVER import", k: "system" });
    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    expect((tl.body as any[]).find((x) => x.id === `att-${row.id}`).text).toBe("HOVER import added a photo — hover-vitestjob-img1.jpg");
  });

  it("upload then delete: the audit add survives and is not deduped away", async () => {
    const { dedupeCarriedAudit } = await import("@shared/crm-actor");
    const r = await upload("/api/crm/attachments", { name: "gone.jpg", type: "image/jpeg", data: JPEG },
      { kind: "photo", refId: custId, stage: "finished" }, cookie);
    expect(r.status).toBe(201);
    attIds.push(r.body.id);
    await logOf(r.body.id, "attachment.added");
    expect((await api(`/api/crm/attachments/${r.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    await logOf(r.body.id, "attachment.deleted");
    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    const act = await api(`/api/crm/customers/${custId}/activity`, {}, cookie);
    expect((tl.body as any[]).some((e) => e.id === `att-${r.body.id}`)).toBe(false);
    const kept = dedupeCarriedAudit(tl.body as any[], act.body as any[]).filter((a: any) => a.entityId === r.body.id);
    expect(kept.map((a: any) => a.text)).toEqual(expect.arrayContaining([
      `${ownerLabel} added a project photo (finished) — gone.jpg`,
      `${ownerLabel} deleted a project photo (finished) — gone.jpg`,
    ]));
    // A photo still on the timeline is NOT doubled by its audit add.
    const first = (tl.body as any[]).find((e) => e.kind === "attachment");
    if (first) expect(dedupeCarriedAudit(tl.body as any[], act.body as any[])
      .some((a: any) => a.action === "attachment.added" && `att-${a.entityId}` === first.id)).toBe(false);
  });

  it("historic rows with no uploader are never guessed", async () => {
    const ins = async (fileName: string) =>
      (await q(`insert into crm_attachments (org_id, kind, ref_id, file_name, mime, size_bytes, storage_path, created_at)
                values ($1, 'photo', $2, $3, 'image/jpeg', 1, $4, now() - interval '400 days') returning id`,
        [orgId, custId, fileName, `${orgId}/vitest-missing-${randomUUID()}.jpg`]))[0].id as string;
    const staged = await ins("progress--old.jpg");
    const bare = await ins("IMG_old.jpg");
    const hoverNoJob = await ins("hover-nojob-1.jpg");
    const logged = await ins("finished--logged.jpg");
    attIds.push(staged, bare, hoverNoJob, logged);
    await q(`insert into crm_activity_log (org_id, actor_member_id, actor_label, action, entity_type, entity_id, customer_id)
             values ($1, $2, 'x', 'attachment.added', 'attachment', $3, $4)`, [orgId, memberId, logged, custId]);

    const tl = await api(`/api/crm/customers/${custId}/timeline`, {}, cookie);
    const by = (id: string) => (tl.body as any[]).find((x) => x.id === `att-${id}`);
    // A stage-tagged or hover-named file is NOT proof of who uploaded it (the portal keeps client file names).
    expect(by(staged).text).toBe("Project photo (in progress) added (uploader not recorded) — old.jpg");
    expect(by(staged).actor.recorded).toBe(false);
    expect(by(bare).text).toBe("Photo added (uploader not recorded) — IMG_old.jpg");
    expect(by(hoverNoJob).text).toBe("Photo added (uploader not recorded) — hover-nojob-1.jpg");
    expect(by(logged).text).toBe(`${ownerLabel} added a project photo (finished) — logged.jpg`);
    for (const e of tl.body as any[]) {
      expect(e.actor?.name).toBeTruthy();
      expect(e.text).not.toMatch(/^Your team added|A team member/);
    }
  });
});
