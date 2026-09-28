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
  for (const table of ["crm_payments", "crm_invoice_items", "crm_invoices", "crm_estimate_items", "crm_estimate_events", "crm_estimates", "crm_jobs", "crm_projects", "crm_customer_notes", "crm_team_activity", "crm_customers", "crm_members", "crm_orgs"]) {
    await pool.query(`delete from ${table} where ${table === "crm_orgs" ? "id" : "org_id"} = any($1::varchar[])`, [[own, foreign]]);
  }
  await pool.end();
});
describe("audit money regressions", () => {
  it("does not accept concurrent payments beyond the outstanding balance", async () => {
    const inv = await api("/api/crm/invoices", { customerId: customers[0], items: [{ name: "Work", unitPriceCents: 1000 }] });
    expect(inv.status).toBe(201);
    const lock = await pool.connect();
    let pending: Promise<any[]>;
    try {
      await lock.query("begin");
      await lock.query("select id from crm_invoices where id=$1 for update", [inv.body.id]);
      pending = Promise.all([1, 2].map(() => api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 600, method: "cash" })));
      await new Promise(r => setTimeout(r, 250));
    } finally { await lock.query("commit"); lock.release(); }
    const results = await pending!;
    expect(results.map(r => r.status).sort()).toEqual([201, 400]);
    const { rows } = await pool.query("select paid_cents from crm_invoices where id=$1", [inv.body.id]);
    expect(rows[0].paid_cents).toBe(600);
  });
  it.each(["void", "delete"])("cannot %s an invoice after a concurrent payment", async (action) => {
    const inv = await api("/api/crm/invoices", { customerId: customers[0], items: [{ name: "Work", unitPriceCents: 1000 }] });
    expect(inv.status).toBe(201);
    const lock = await pool.connect();
    let pending: Promise<any[]>;
    try {
      await lock.query("begin");
      await lock.query("select id from crm_invoices where id=$1 for update", [inv.body.id]);
      const pay = api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 600, method: "cash" });
      await new Promise(r => setTimeout(r, 75));
      const mutate = action === "void"
        ? api(`/api/crm/invoices/${inv.body.id}/void`, {})
        : api(`/api/crm/invoices/${inv.body.id}`, {}, "DELETE");
      pending = Promise.all([pay, mutate]);
      await new Promise(r => setTimeout(r, 150));
    } finally { await lock.query("commit"); lock.release(); }
    const [pay, mutation] = await pending!;
    // Either operation can acquire the lock first; both must never succeed.
    expect(pay.status === 201 && mutation.status === 200).toBe(false);
    if (pay.status === 201) {
      expect(mutation.status).toBe(409);
      const { rows } = await pool.query("select paid_cents,voided_at from crm_invoices where id=$1", [inv.body.id]);
      expect(rows[0]).toMatchObject({ paid_cents: 600, voided_at: null });
    } else {
      expect([404, 409]).toContain(pay.status);
      expect(mutation.status).toBe(200);
    }
  });
});
