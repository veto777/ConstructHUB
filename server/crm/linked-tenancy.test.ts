import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "crypto";

const base = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL });
const own = randomUUID(), foreign = randomUUID();
let cookie = "";
const customers = [randomUUID(), randomUUID()];
const projects = [randomUUID(), randomUUID()];
const estimates = [randomUUID(), randomUUID()];
const job = randomUUID();
async function api(path: string, body: unknown, method = "POST") {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: r.status, body: await r.json() };
}
beforeAll(async () => {
  for (const [i, org] of [own, foreign].entries()) {
    await pool.query("insert into crm_orgs(id,name,owner_user_id) values($1,'Audit tenancy fixture',1)", [org]);
    await pool.query("insert into crm_customers(id,org_id,display_name,portal_token) values($1,$2,'Audit customer',gen_random_uuid())", [customers[i], org]);
    await pool.query("insert into crm_projects(id,org_id,customer_id,name) values($1,$2,$3,'Audit project')", [projects[i], org, customers[i]]);
    await pool.query("insert into crm_estimates(id,org_id,customer_id,project_id,public_token) values($1,$2,$3,$4,gen_random_uuid())", [estimates[i], org, customers[i], projects[i]]);
  }
  await pool.query("insert into crm_members(org_id,user_id,email,role,status) values($1,1,'audit@example.invalid','owner','active')", [own]);
  await pool.query("insert into crm_jobs(id,org_id,project_id,name) values($1,$2,$3,'Audit job')", [job, own, projects[0]]);
  const r = await fetch(base + "/api/crm/me");
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect((await api("/api/crm/org/switch", { orgId: own })).status).toBe(200);
});
afterAll(async () => {
  for (const table of ["crm_invoice_items", "crm_invoices", "crm_estimate_items", "crm_estimate_events", "crm_estimates", "crm_jobs", "crm_projects", "crm_customer_notes", "crm_team_activity", "crm_customers", "crm_members", "crm_orgs"]) {
    await pool.query(`delete from ${table} where ${table === "crm_orgs" ? "id" : "org_id"} = any($1::varchar[])`, [[own, foreign]]);
  }
  await pool.end();
});
describe("linked records must belong to the active organization", () => {
  for (const key of ["customerId", "projectId", "estimateId"] as const) {
    it(`rejects an invoice with a foreign ${key}`, async () => {
      const body = { customerId: customers[0], projectId: projects[0], estimateId: estimates[0], [key]: { customerId: customers[1], projectId: projects[1], estimateId: estimates[1] }[key] };
      expect((await api("/api/crm/invoices", body)).status).toBe(400);
    });
  }
  it("rejects an estimate linked to a foreign project", async () => {
    expect((await api("/api/crm/estimates", { customerId: customers[0], projectId: projects[1], taxRateBps: 0 })).status).toBe(400);
  });
  it("rejects moving a project to a foreign customer", async () => {
    expect((await api(`/api/crm/projects/${projects[0]}`, { customerId: customers[1] }, "PATCH")).status).toBe(400);
  });
  it("rejects moving a job to a foreign project", async () => {
    expect((await api(`/api/crm/jobs/${job}`, { projectId: projects[1] }, "PATCH")).status).toBe(400);
  });
  it("still creates a correctly linked invoice", async () => {
    expect((await api("/api/crm/invoices", { customerId: customers[0], projectId: projects[0], estimateId: estimates[0] })).status).toBe(201);
  });
});
