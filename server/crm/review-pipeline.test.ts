/**
 * The review pipeline (server/crm/review-pipeline.ts): won-job clients not yet
 * asked, prefilled; cancelled jobs, archived clients, other orgs and clients
 * already asked stay out; "Not now" sets one aside and back.
 *
 * In-process routes on the lane Postgres (like photo-library.test.ts): fresh
 * users and orgs, all removed afterwards.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { PLAN_KEYS } from "@shared/plans";
import { describeJobs } from "./review-pipeline";

let base = "", server: ReturnType<express.Express["listen"]>;
async function call(user: number, p: string, method = "GET") {
  const r = await fetch(base + p, { method, headers: { "x-fixture-user": String(user) } });
  return { status: r.status, data: await r.json().catch(() => null) as any };
}

const users: number[] = [];
const orgs: string[] = [];
async function user(opts: { crm?: boolean; platform?: boolean } = {}) {
  const id = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`pipeline-${randomUUID()}@example.invalid`])).rows[0].id as number;
  users.push(id);
  if (opts.crm) await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_elite','active')", [id]);
  if (opts.platform) await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [id, PLAN_KEYS[0]]);
  return id;
}
let ownerMember = "";
async function org(owner: number) {
  const id = randomUUID();
  orgs.push(id);
  await pool.query("INSERT INTO crm_orgs(id,name,owner_user_id) VALUES($1,$2,$3)", [id, `pipeline ${id.slice(0, 6)}`, owner]);
  ownerMember = randomUUID();
  await pool.query("INSERT INTO crm_members(id,org_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'owner','active')",
    [ownerMember, id, owner, `m-${ownerMember.slice(0, 8)}@example.invalid`]);
  return id;
}
async function customer(orgId: string, name: string, email: string | null, archived = false) {
  const id = randomUUID();
  await pool.query(`INSERT INTO crm_customers(id,org_id,display_name,portal_token,address_line1,city,state,postal_code,email,archived_at)
    VALUES($1,$2,$3,gen_random_uuid(),'1 Main St','Tampa','FL','33601',$4,$5)`, [id, orgId, name, email, archived ? new Date() : null]);
  return id;
}
async function job(orgId: string, customerId: string, opts: { status: string; title: string; total: number; daysAgo: number; project?: string }) {
  let projectId: string | null = null;
  if (opts.project) {
    projectId = randomUUID();
    await pool.query("INSERT INTO crm_projects(id,org_id,customer_id,name,status) VALUES($1,$2,$3,'Job',$4)", [projectId, orgId, customerId, opts.project]);
  }
  await pool.query(`INSERT INTO crm_estimates(org_id,customer_id,project_id,number,title,status,total_cents,approved_at,public_token,created_by_member_id)
    VALUES($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' days')::interval, gen_random_uuid()::text, $9)`,
    [orgId, customerId, projectId, String(Math.floor(Math.random() * 1e6)), opts.title, opts.status, opts.total, String(opts.daysAgo), ownerMember]);
}

let owner: number, other: number, outsider: number, crew: number;
let orgA: string, orgB: string;
const C: Record<string, string> = {};

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await (await import("../growth-schema")).ensureGrowthSchema();
  await (await import("./schema-ensure")).ensureCrmSchema();

  const { registerReviewPipelineRoutes } = await import("./review-pipeline");
  const { platformAccessGate } = await import("../platform-access");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const id = Number(req.headers["x-fixture-user"]);
    if (id) req.user = { id };
    req.session = {};
    next();
  });
  app.use(platformAccessGate);
  const getUser = (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null);
  registerReviewPipelineRoutes(app, getUser);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  owner = await user({ crm: true, platform: true });
  other = await user({ crm: true, platform: true });
  outsider = await user({ platform: true });
  orgB = await org(other);
  C.otherOrg = await customer(orgB, "Other Org Won", "o@example.invalid");
  await job(orgB, C.otherOrg, { status: "approved", title: "Roof", total: 100, daysAgo: 1 });
  orgA = await org(owner);
  crew = await user({ platform: true });
  await pool.query("INSERT INTO crm_members(id,org_id,user_id,email,role,status) VALUES(gen_random_uuid(),$1,$2,$3,'field','active')",
    [orgA, crew, `crew-${randomUUID().slice(0, 8)}@example.invalid`]);

  C.finished = await customer(orgA, "Ash Finished", "ash@example.invalid");
  await job(orgA, C.finished, { status: "approved", title: "Hardie lap siding", total: 2_000_000, daysAgo: 40, project: "complete" });
  await job(orgA, C.finished, { status: "approved", title: "Window install", total: 500_000, daysAgo: 30 });
  await pool.query(`INSERT INTO crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path)
    VALUES(gen_random_uuid(),$1,'photo',$2,'finished--a.jpg','image/jpeg',1,'x'),(gen_random_uuid(),$1,'photo',$2,'progress--b.jpg','image/jpeg',1,'y')`, [orgA, C.finished]);
  C.recent = await customer(orgA, "Birch Recent", null);
  await job(orgA, C.recent, { status: "approved", title: "Estimate", total: 300_000, daysAgo: 2, project: "scheduled" });
  C.draft = await customer(orgA, "Cedar Draft", "cedar@example.invalid");
  await job(orgA, C.draft, { status: "sent", title: "Roof", total: 1, daysAgo: 1 });
  C.cancelled = await customer(orgA, "Dogwood Cancelled", "dog@example.invalid");
  await job(orgA, C.cancelled, { status: "approved", title: "Doors", total: 1, daysAgo: 1, project: "cancelled" });
  C.archived = await customer(orgA, "Elm Archived", "elm@example.invalid", true);
  await job(orgA, C.archived, { status: "approved", title: "Roof", total: 1, daysAgo: 1 });
  C.askedLinked = await customer(orgA, "Fir Linked", "fir@example.invalid");
  await job(orgA, C.askedLinked, { status: "approved", title: "Roof", total: 1, daysAgo: 1 });
  C.askedEmail = await customer(orgA, "Gum Email", "Gum@Example.invalid");
  await job(orgA, C.askedEmail, { status: "approved", title: "Roof", total: 1, daysAgo: 1 });
  const rr = `INSERT INTO review_requests(user_id,client_name,client_email,google_profile_url,token,crm_org_id,crm_customer_id)
    VALUES($1,'x',$2,'https://g.page/r/x',gen_random_uuid()::text,$3,$4)`;
  await pool.query(rr, [owner, "someone@example.invalid", orgA, C.askedLinked]);
  await pool.query(rr, [owner, "gum@example.invalid ", null, null]);
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await pool.query("DELETE FROM review_requests WHERE user_id=ANY($1::int[])", [users]);
  for (const t of ["crm_review_pipeline", "crm_activity_log", "crm_attachments", "crm_estimates", "crm_projects", "crm_customers", "crm_members"]) {
    await pool.query(`DELETE FROM ${t} WHERE org_id=ANY($1::varchar[])`, [orgs]);
  }
  await pool.query("DELETE FROM crm_orgs WHERE id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM crm_subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
}, 60_000);

describe("review pipeline", () => {
  it("lists won-job clients not yet asked, finished jobs first, prefilled", async () => {
    const r = await call(owner, "/api/reviews/pipeline");
    expect(r.status).toBe(200);
    expect(r.data.ready.map((i: any) => i.customer.name)).toEqual(["Ash Finished", "Birch Recent"]);
    const ash = r.data.ready[0];
    expect(ash.customer).toMatchObject({ email: "ash@example.invalid", address: "1 Main St, Tampa, FL 33601", photoCount: 2 });
    expect(ash.finishedPhotoCount).toBe(1);
    expect(ash.jobs).toHaveLength(2);
    expect(ash.description).toBe("Window install · Hardie lap siding");
    expect(ash.needsEmail).toBe(false);
    const birch = r.data.ready[1];
    expect(birch).toMatchObject({ needsEmail: true, jobFinished: false, projectStatus: "scheduled", description: "" });
    expect(r.data.askedCount).toBe(2);
  });

  it("not now sets a client aside and puts them back, logged by name", async () => {
    expect((await call(owner, `/api/reviews/pipeline/${C.recent}/dismiss`, "POST")).status).toBe(200);
    let r = await call(owner, "/api/reviews/pipeline");
    expect(r.data.ready.map((i: any) => i.customer.name)).toEqual(["Ash Finished"]);
    expect(r.data.dismissed.map((i: any) => i.customer.name)).toEqual(["Birch Recent"]);
    expect((await call(owner, `/api/reviews/pipeline/${C.recent}/dismiss`, "DELETE")).status).toBe(200);
    r = await call(owner, "/api/reviews/pipeline");
    expect(r.data.ready).toHaveLength(2);
    const log = await pool.query("SELECT action, actor_member_id FROM crm_activity_log WHERE org_id=$1 AND customer_id=$2 ORDER BY created_at", [orgA, C.recent]);
    expect(log.rows.map((x) => x.action)).toEqual(["review_pipeline.dismissed", "review_pipeline.restored"]);
  });

  it("hide takes a client out for good and the send gate refuses them by link or by email", async () => {
    const { hiddenFromReviews } = await import("./review-pipeline");
    expect(await hiddenFromReviews(owner, orgA, C.finished, "ash@example.invalid")).toBe(false);
    expect((await call(owner, `/api/reviews/pipeline/${C.finished}/hide`, "POST")).status).toBe(200);
    let r = await call(owner, "/api/reviews/pipeline");
    expect(r.data.ready.map((i: any) => i.customer.name)).toEqual(["Birch Recent"]);
    expect(r.data.hidden.map((i: any) => i.customer.name)).toEqual(["Ash Finished"]);
    expect(r.data.dismissed).toEqual([]);
    expect(await hiddenFromReviews(owner, orgA, C.finished, "x@example.invalid")).toBe(true);
    expect(await hiddenFromReviews(owner, null, null, " ASH@example.invalid")).toBe(true);
    expect(await hiddenFromReviews(other, null, null, "ash@example.invalid")).toBe(false);
    // Not now never overwrites a Hide.
    expect((await call(owner, `/api/reviews/pipeline/${C.finished}/dismiss`, "POST")).status).toBe(200);
    expect((await call(owner, "/api/reviews/pipeline")).data.hidden).toHaveLength(1);
    // Still listed (for Unhide) once no won job qualifies.
    await pool.query("UPDATE crm_estimates SET status='cancelled' WHERE org_id=$1 AND customer_id=$2", [orgA, C.finished]);
    expect((await call(owner, "/api/reviews/pipeline")).data.hidden.map((i: any) => i.customer.name)).toEqual(["Ash Finished"]);
    await pool.query("UPDATE crm_estimates SET status='approved' WHERE org_id=$1 AND customer_id=$2", [orgA, C.finished]);
    // Put back (dismiss DELETE) does not unhide; Unhide does.
    expect((await call(owner, `/api/reviews/pipeline/${C.finished}/dismiss`, "DELETE")).status).toBe(200);
    expect((await call(owner, "/api/reviews/pipeline")).data.hidden).toHaveLength(1);
    expect((await call(owner, `/api/reviews/pipeline/${C.finished}/hide`, "DELETE")).status).toBe(200);
    r = await call(owner, "/api/reviews/pipeline");
    expect(r.data.hidden).toEqual([]);
    expect(r.data.ready).toHaveLength(2);
    expect(await hiddenFromReviews(owner, null, null, "ash@example.invalid")).toBe(false);
  });

  it("refuses another org's client and accounts with no CRM team", async () => {
    expect((await call(owner, `/api/reviews/pipeline/${C.otherOrg}/dismiss`, "POST")).status).toBe(404);
    expect((await call(outsider, "/api/reviews/pipeline")).status).toBe(404);
  });

  it("a field seat (no client or job rights, price-blind) can neither read nor change the list", async () => {
    expect((await call(crew, "/api/reviews/pipeline")).status).toBe(403);
    expect((await call(crew, `/api/reviews/pipeline/${C.recent}/dismiss`, "POST")).status).toBe(403);
  });

  it("describes the jobs without generic titles or repeats", () => {
    expect(describeJobs([{ title: "Estimate" }, { title: "Roof" }, { title: "roof" }, { title: "Estimate #12" }])).toBe("Roof");
  });
});
