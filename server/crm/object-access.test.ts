import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import pg from "pg";

const base = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8129";
const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL });
const org = randomUUID(), member = randomUUID(), a = randomUUID(), b = randomUUID();
let cookie = "";
const kinds = ["customers", "projects", "jobs", "estimates", "invoices", "appointments", "change-orders", "attachments", "reports", "budget-lines", "phases", "punch-items", "selections", "client-comments"];
const fixtures = [a, b, null].map(division => ({ division, ids: Object.fromEntries(kinds.map(k => [k, randomUUID()])) }));
const tables = ["crm_client_comments", "crm_selections", "crm_punch_items", "crm_phases", "crm_budget_lines", "crm_measurements", "crm_attachments", "crm_appointments", "crm_change_orders", "crm_invoices", "crm_estimates", "crm_jobs", "crm_projects", "crm_customers", "crm_members", "crm_divisions"];
async function request(path: string, method = "GET", data?: any) {
  const r = await fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }) });
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Inventory is read from the route declarations, so newly added direct-ID
// routes in a protected family automatically enter the regression matrix.
const routes: { method: string; path: string; kind: string }[] = [];
for (const file of readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const match of text.matchAll(/app\.(get|post|put|patch|delete)\("(\/api\/crm\/([^/]+)\/:[^"/]+[^"\n]*)"/g)) {
    const kind = match[3] === "inbox" ? "customers" : match[3];
    if (kinds.includes(kind) && !routes.some(r => r.method === match[1] && r.path === match[2])) routes.push({ method: match[1].toUpperCase(), path: match[2], kind });
  }
}
for (const kind of ["punch-items", "selections"]) routes.push({ method: "PATCH", path: `/api/crm/${kind}/:childId`, kind });

beforeAll(async () => {
  mkdirSync(`tmp/crm-attachments/${org}`, { recursive: true });
  writeFileSync(`tmp/crm-attachments/${org}/policy.pdf`, "%PDF-1.4\nPolicy fixture");
  await pool.query(`insert into crm_orgs(id,name,owner_user_id) values ($1,'Object policy fixture',1)`, [org]);
  for (const [id, code] of [[a, "A"], [b, "B"]]) await pool.query(`insert into crm_divisions(id,org_id,name,code) values ($1,$2,$3,$3)`, [id, org, code]);
  await pool.query(`insert into crm_members(id,org_id,user_id,email,role,status,division_id) values ($1,$2,1,'policy@example.invalid','admin','active',$3)`, [member, org, a]);
  for (const { division, ids: i } of fixtures) {
    await pool.query(`insert into crm_customers(id,org_id,display_name,portal_token) values ($1,$2,'Policy client',gen_random_uuid())`, [i.customers, org]);
    await pool.query(`insert into crm_projects(id,org_id,customer_id,name,division_id,status,contract_value_cents,project_manager_member_id) values ($1,$2,$3,'Policy project',$4,'approved',1000,$5)`, [i.projects,org,i.customers,division,member]);
    await pool.query(`insert into crm_jobs(id,org_id,project_id,name,assigned_member_ids) values ($1,$2,$3,'Policy job',$4)`, [i.jobs,org,i.projects,[member]]);
    await pool.query(`insert into crm_estimates(id,org_id,customer_id,project_id,division_id,public_token,status,total_cents,created_by_member_id) values ($1,$2,$3,$4,$5,gen_random_uuid(),'sent',1000,$6)`, [i.estimates,org,i.customers,i.projects,division,member]);
    await pool.query(`insert into crm_invoices(id,org_id,customer_id,project_id,estimate_id,public_token,status,total_cents) values ($1,$2,$3,$4,$5,gen_random_uuid(),'sent',1000)`, [i.invoices,org,i.customers,i.projects,i.estimates]);
    await pool.query(`insert into crm_appointments(id,org_id,project_id,customer_id,title,starts_at,created_by_member_id) values ($1,$2,$3,$4,'Policy appointment',now(),$5)`, [i.appointments,org,i.projects,i.customers,member]);
    await pool.query(`insert into crm_change_orders(id,org_id,project_id,customer_id,title,public_token) values ($1,$2,$3,$4,'Policy CO',gen_random_uuid())`, [i['change-orders'],org,i.projects,i.customers]);
    await pool.query(`insert into crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path) values ($1,$2,'contract',$3,'policy.pdf','application/pdf',23,$4)`, [i.attachments,org,i.estimates,`${org}/policy.pdf`]);
    await pool.query(`insert into crm_measurements(id,org_id,customer_id,project_id,provider,raw_payload) values ($1,$2,$3,$4,'other','{"importSource":"test","sourceText":"policy report"}')`, [i.reports,org,i.customers,i.projects]);
    await pool.query(`insert into crm_budget_lines(id,org_id,project_id,cost_code_id) values ($1,$2,$3,'policy-cost-code')`, [i['budget-lines'],org,i.projects]);
    await pool.query(`insert into crm_phases(id,org_id,project_id,name) values ($1,$2,$3,'Policy phase')`, [i.phases,org,i.projects]);
    await pool.query(`insert into crm_punch_items(id,org_id,project_id,title) values ($1,$2,$3,'Policy punch')`, [i['punch-items'],org,i.projects]);
    await pool.query(`insert into crm_selections(id,org_id,project_id,name) values ($1,$2,$3,'Policy selection')`, [i.selections,org,i.projects]);
    await pool.query(`insert into crm_client_comments(id,org_id,customer_id,body) values ($1,$2,$3,'Policy comment')`, [i['client-comments'],org,i.customers]);
  }
  await request('/api/crm/me');
  expect((await request('/api/crm/org/switch', 'POST', { orgId: org })).status).toBe(200);
});
afterAll(async () => {
  for (const table of tables) await pool.query(`delete from ${table} where org_id = $1`, [org]);
  await pool.query('delete from crm_orgs where id=$1',[org]);
  rmSync(`tmp/crm-attachments/${org}`, { recursive: true, force: true });
  await pool.end();
});

describe('shared CRM object access — every registered direct-ID route', () => {
  for (const fixture of fixtures.slice(1)) {
    for (const route of routes) {
      it(`${fixture.division ? 'division B' : 'unassigned'} ${route.method} ${route.path} is hidden even when assigned`, async () => {
        let first = true;
        const path = route.path.replace(/:[^/]+/g, () => { const id = first ? fixture.ids[route.kind] : randomUUID(); first = false; return id; });
        const denied = await request(path, route.method);
        expect(denied.status).toBe(404);
        expect(denied.body.message).toBe("Record not found");
      });
    }
  }
  it('tests all requested object families and downloads/history', () => {
    for (const kind of kinds) expect(routes.some(r => r.kind === kind)).toBe(true);
    expect(routes.some(r => /receipt|file|download/.test(r.path))).toBe(true);
    expect(routes.some(r => /timeline|engagement|activity/.test(r.path))).toBe(true);
  });
  it('permits division A reads and only includes A aggregates', async () => {
    expect((await request(`/api/crm/estimates/${fixtures[0].ids.estimates}`)).status).toBe(200);
    expect((await request(`/api/crm/attachments/${fixtures[0].ids.attachments}/file`)).status).toBe(200);
    expect((await request(`/api/crm/reports/${fixtures[0].ids.reports}/download`)).status).toBe(200);
    const stats = await request('/api/crm/stats');
    expect(stats.body.openEstimates).toEqual({ count: 1, totalCents: 1000 });
    expect(stats.body.openInvoices).toEqual({ count: 1, totalCents: 1000 });
    expect(stats.body.unscheduledJobs).toEqual({ count: 1, totalCents: 1000 });
    expect((await request('/api/crm/customers')).body.map((c: any) => c.id)).toEqual([fixtures[0].ids.customers]);
  });
  it('guards query IDs, upload references and message targets', async () => {
    const hidden = fixtures[1].ids;
    expect((await request(`/api/crm/invoices?customerId=${hidden.customers}`)).status).toBe(404);
    expect((await request(`/api/crm/attachments?kind=contract&refId=${hidden.estimates}`)).status).toBe(404);
    expect((await request('/api/crm/attachments', 'POST', { kind: 'estimate', refId: hidden.estimates })).status).toBe(404);
    expect((await request('/api/crm/messages', 'POST', { customerId: hidden.customers, channel: 'email', body: 'Denied' })).status).toBe(404);
  });
  it('does not permit relinking a visible object into B', async () => {
    expect((await request(`/api/crm/projects/${fixtures[0].ids.projects}`, 'PATCH', { divisionId: b })).status).toBe(404);
    expect((await request(`/api/crm/estimates/${fixtures[0].ids.estimates}`, 'PATCH', { projectId: fixtures[1].ids.projects })).status).toBe(404);
  });
  it('keeps organization-wide admin and owner behavior', async () => {
    try {
      await pool.query('update crm_members set division_id=null where id=$1',[member]);
      expect((await request(`/api/crm/estimates/${fixtures[1].ids.estimates}`)).status).toBe(200);
      expect((await request('/api/crm/stats')).body.openEstimates.count).toBe(3);
      await pool.query("update crm_members set role='owner', division_id=$2 where id=$1",[member,a]);
      expect((await request(`/api/crm/estimates/${fixtures[2].ids.estimates}`)).status).toBe(200);
    } finally { await pool.query("update crm_members set role='admin', division_id=$2 where id=$1",[member,a]); }
  });
  it('applies assignment even when a member has an explicit write permission', async () => {
    try {
      await pool.query(`update crm_members set role='field', permissions='{"manageEstimates":true}' where id=$1`,[member]);
      const id = fixtures[0].ids.estimates;
      expect((await request(`/api/crm/estimates/${id}`)).status).toBe(200);
      expect((await request(`/api/crm/attachments/${fixtures[0].ids.attachments}/file`)).status).toBe(404);
      await pool.query('update crm_estimates set created_by_member_id=null, project_id=null where id=$1',[id]);
      await pool.query('update crm_projects set project_manager_member_id=null where id=$1',[fixtures[0].ids.projects]);
      await pool.query('update crm_jobs set assigned_member_ids=null where id=$1',[fixtures[0].ids.jobs]);
      expect((await request(`/api/crm/estimates/${id}`, 'PATCH', { title: 'Denied' })).status).toBe(404);
    } finally { await pool.query("update crm_members set role='admin', permissions=null where id=$1",[member]); }
  });
});
