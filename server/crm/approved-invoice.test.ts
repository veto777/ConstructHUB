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
  for (const table of ["crm_payments", "crm_invoice_items", "crm_invoices", "crm_estimate_items", "crm_estimate_events", "crm_estimates", "crm_cost_entries", "crm_commitments", "crm_budget_lines", "crm_cost_codes", "crm_engagement_sessions", "crm_jobs", "crm_projects", "crm_customer_notes", "crm_team_activity", "crm_activity_log", "crm_customers", "crm_members", "crm_orgs"]) {
    await pool.query(`delete from ${table} where ${table === "crm_orgs" ? "id" : "org_id"} = any($1::varchar[])`, [[own, foreign]]);
  }
  await pool.end();
});
describe("invoices from signed estimates", () => {
  it.each([[10000, 9000], [5000, 4500], [3333, 3000]])("preserves the accepted discount at %i basis points", async (percentBps, totalCents) => {
    const est = await api("/api/crm/estimates", { customerId: customers[0], taxRateBps: 0, items: [{ name: "Work", unitPriceCents: 10000 }] });
    expect(est.status).toBe(201);
    await pool.query("update crm_estimates set approved_at=now(), status='approved', approved_total_cents=9000, selected_discounts=$2 where id=$1", [est.body.id, JSON.stringify([{ percentBps: 1000, label: "Signed discount" }])]);
    const inv = await api(`/api/crm/estimates/${est.body.id}/invoice`, { percentBps });
    expect(inv.status).toBe(201);
    expect(inv.body.totalCents).toBe(totalCents);
  });
  it("rejects malformed draw percentages before writing an invoice", async () => {
    await pool.query("update crm_estimates set approved_at=now(),status='approved' where id=$1", [estimates[0]]);
    for (const percentBps of ["junk", -1, 10001, 1.5]) {
      expect((await api(`/api/crm/estimates/${estimates[0]}/invoice`, { percentBps })).status).toBe(400);
    }
  });
  async function approvedEstimate(unitPriceCents = 200000) {
    const est = await api("/api/crm/estimates", { customerId: customers[0], taxRateBps: 0, items: [{ name: "Work", unitPriceCents }] });
    expect(est.status).toBe(201);
    await pool.query("update crm_estimates set approved_at=now(), status='approved' where id=$1", [est.body.id]);
    return est.body.id as string;
  }
  it("never bills an estimate past 100% and names the invoice that already bills it", async () => {
    const id = await approvedEstimate();
    const half = await api(`/api/crm/estimates/${id}/invoice`, { percentBps: 5000 });
    expect(half.status).toBe(201);
    const tooMuch = await api(`/api/crm/estimates/${id}/invoice`, {});
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.remainingBps).toBe(5000);
    expect(tooMuch.body.message).toContain(half.body.number);
    const rest = await api(`/api/crm/estimates/${id}/invoice`, { percentBps: 5000 });
    expect(rest.status).toBe(201);
    // The refused click did not burn a number.
    expect(Number(rest.body.number.slice(4))).toBe(Number(half.body.number.slice(4)) + 1);
    const again = await api(`/api/crm/estimates/${id}/invoice`, {});
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already invoiced in full/);
    expect(again.body.invoices.map((i: any) => i.id)).toEqual([half.body.id, rest.body.id]);
    // Voiding an invoice frees its share of the estimate again.
    expect((await api(`/api/crm/invoices/${rest.body.id}/void`, {})).status).toBe(200);
    expect((await api(`/api/crm/estimates/${id}/invoice`, { percentBps: 5000 })).status).toBe(201);
  });
  it("counts legacy invoices (no recorded draw) by amount", async () => {
    const id = await approvedEstimate();
    const legacy = await api(`/api/crm/estimates/${id}/invoice`, {});
    expect(legacy.status).toBe(201);
    await pool.query("update crm_invoices set custom_fields=null where id=$1", [legacy.body.id]);
    expect((await api(`/api/crm/estimates/${id}/invoice`, { percentBps: 100 })).status).toBe(409);
  });
  it("two concurrent clicks create exactly one full invoice", async () => {
    const id = await approvedEstimate();
    const results = await Promise.all([1, 2].map(() => api(`/api/crm/estimates/${id}/invoice`, {})));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it("never reuses an invoice number after a delete, even under concurrency", async () => {
    const a = await api("/api/crm/invoices", { customerId: customers[0] });
    const b = await api("/api/crm/invoices", { customerId: customers[0] });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await api(`/api/crm/invoices/${a.body.id}`, {}, "DELETE")).status).toBe(200);
    const burst = await Promise.all([1, 2, 3].map(() => api("/api/crm/invoices", { customerId: customers[0] })));
    expect(burst.every((r) => r.status === 201)).toBe(true);
    expect(burst.map((r) => r.body.number)).not.toContain(b.body.number);
    expect(new Set(burst.map((r) => r.body.number)).size).toBe(3);
    // Deleting the newest invoice does not hand its number out again.
    const last = burst.map((r) => r.body).sort((x, y) => x.number.localeCompare(y.number, "en", { numeric: true })).pop();
    expect((await api(`/api/crm/invoices/${last.id}`, {}, "DELETE")).status).toBe(200);
    const next = await api("/api/crm/invoices", { customerId: customers[0] });
    expect(next.body.number).not.toBe(last.number);
    const { rows } = await pool.query(
      "select number from crm_invoices where org_id=$1 group by number having count(*) > 1", [own]);
    expect(rows).toEqual([]);
  });
  it("estimateBilledBps: recorded draws win; legacy rows are measured by money", async () => {
    const { estimateBilledBps } = await import("./ops");
    expect(estimateBilledBps([], 10000)).toBe(0);
    expect(estimateBilledBps([{ totalCents: 1, customFields: { progressBps: 5000 } }], 10000)).toBe(5000);
    expect(estimateBilledBps([{ totalCents: 3333, customFields: null }], 10000)).toBe(3333);
    expect(estimateBilledBps([{ totalCents: 0, customFields: null }], 0)).toBe(10000);
  });
});

describe("project costing", () => {
  it("counts money with no cost code instead of dropping it from the totals", async () => {
    await pool.query("update crm_projects set contract_value_cents=2500000 where id=$1", [projects[0]]);
    const cc = await api("/api/crm/cost-codes", { code: "FIX-C14", name: "Framing" });
    expect(cc.status).toBe(201);
    const proj = `/api/crm/projects/${projects[0]}`;
    expect((await api(`${proj}/budget-lines`, { costCodeId: cc.body.id, budgetCents: 1000000 })).status).toBe(201);
    expect((await api(`${proj}/costs`, { costCodeId: cc.body.id, amountCents: 1200000 })).status).toBe(201);
    expect((await api(`${proj}/costs`, { amountCents: 500000 })).status).toBe(201);
    expect((await api(`${proj}/commitments`, { amountCents: 300000 })).status).toBe(201);
    const costing = await (await fetch(`${base}${proj}/costing`, { headers: { cookie } })).json();
    expect(costing.totals).toMatchObject({ actualCents: 1700000, committedCents: 300000, grossProfitCents: 800000, marginBps: 3200 });
    const unassigned = costing.lines.find((l: any) => l.costCodeId === null);
    expect(unassigned).toMatchObject({ name: "Unassigned", actualCents: 500000, committedCents: 300000, budgetCents: 0 });
  });
});
