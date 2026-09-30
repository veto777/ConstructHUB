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
  for (const table of ["crm_payments", "crm_invoice_items", "crm_invoices", "crm_estimate_items", "crm_estimate_events", "crm_estimates", "crm_jobs", "crm_projects", "crm_customer_notes", "crm_team_activity", "crm_activity_log", "crm_customers", "crm_members", "crm_orgs"]) {
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
  it("formats the over-balance refusal like the UI and says whether a receipt goes out", async () => {
    const inv = await api("/api/crm/invoices", { customerId: customers[0], items: [{ name: "Work", unitPriceCents: 175000 }] });
    expect(inv.status).toBe(201);
    const over = await api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 999999, method: "check" });
    expect(over.status).toBe(400);
    expect(over.body.message).toBe("Only $1,750.00 is outstanding on this invoice.");
    // The fixture client has no email address, so no receipt can be sent.
    const pay = await api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 10100, method: "check" });
    expect(pay.status).toBe(201);
    expect(pay.body).toMatchObject({ receiptQueued: false, receiptSkippedReason: "no_email" });
    // A partly paid invoice is refused deletion with its own wording.
    const del = await api(`/api/crm/invoices/${inv.body.id}`, {}, "DELETE");
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/^Payments have been recorded against this invoice \(\$101\.00 so far\)/);
  });
  it("owner reverses a mistyped manual payment: row kept, balance restored, once only", async () => {
    const inv = await api("/api/crm/invoices", { customerId: customers[0], items: [{ name: "Work", unitPriceCents: 175000 }] });
    const pay = await api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 100000, method: "check" });
    expect(pay.status).toBe(201);
    const payId = pay.body.payment.id;
    expect((await api(`/api/crm/payments/${payId}/reverse`, {})).status).toBe(400);
    const rev = await api(`/api/crm/payments/${payId}/reverse`, { reason: "Typed $1,000 instead of $100" });
    expect(rev.status).toBe(200);
    expect(rev.body.payment.status).toBe("reversed");
    expect(rev.body.invoice).toMatchObject({ paidCents: 0, status: "draft", paidAt: null });
    expect((await api(`/api/crm/payments/${payId}/reverse`, { reason: "Twice" })).status).toBe(409);
    const fixed = await api(`/api/crm/invoices/${inv.body.id}/payments`, { amountCents: 10000, method: "check" });
    expect(fixed.status).toBe(201);
    expect(fixed.body.invoice.paidCents).toBe(10000);
    const { rows } = await pool.query(
      "select status, amount_cents from crm_payments where invoice_id=$1 order by created_at", [inv.body.id]);
    expect(rows).toEqual([{ status: "reversed", amount_cents: 100000 }, { status: "succeeded", amount_cents: 10000 }]);
    const notes = await pool.query("select body from crm_customer_notes where org_id=$1 and body like '%reversed%'", [own]);
    expect(notes.rows.some((n) => n.body.includes("Typed $1,000 instead of $100"))).toBe(true);
    // Only the owner may reverse.
    await pool.query("update crm_members set role='admin' where org_id=$1 and user_id=1", [own]);
    try {
      expect((await api(`/api/crm/payments/${fixed.body.payment.id}/reverse`, { reason: "Not mine" })).status).toBe(403);
    } finally {
      await pool.query("update crm_members set role='owner' where org_id=$1 and user_id=1", [own]);
    }
  });
});
