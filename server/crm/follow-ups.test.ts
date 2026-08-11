/**
 * /api/crm/follow-ups + /api/crm/attention + PATCH …/customers/:id/follow-up —
 * the Home "who do I call" cadence and the needs-attention rollup.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8129 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with CRM_TEST_DATABASE_URL.
 *
 * Fixtures live in TWO THROWAWAY orgs created here and are fully deleted in
 * afterAll — safe against the other suites running in parallel.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

const patch = (path: string, data: unknown, cookie?: string) =>
  api(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }, cookie);

describe("crm follow-ups + attention (dev server)", () => {
  let cookieA: string | undefined;
  let cookieB: string | undefined;
  let orgA = "";
  let orgB = "";
  let memberA = "";
  let custDue = "";      // cadence set, last follow-up long ago → due
  let custFresh = "";    // cadence set today → not due
  let custB = "";        // org B's cadenced customer (isolation probe)
  let leadNew = "";      // lead-stage project, no estimate → new + needs estimate
  let leadCovered = "";  // lead-stage project whose customer has an estimate

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const mkOrg = async (name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`, [name]);
      return id;
    };
    orgA = await mkOrg(`Vitest FU A ${stamp}`);
    orgB = await mkOrg(`Vitest FU B ${stamp}`);
    for (const [orgId, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_members (org_id, user_id, email, role, status, display_name)
         values ($1, 1, $2, 'owner', 'active', 'FU Owner') returning id`,
        [orgId, `vitest.fu.${tag}.${stamp}@example.com`]);
      if (orgId === orgA) memberA = id;
    }

    const swA = await api("/api/crm/org/switch", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: orgA }),
    }, me.cookie);
    cookieA = swA.cookie;
    const swB = await api("/api/crm/org/switch", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: orgB }),
    }, me.cookie);
    cookieB = swB.cookie;

    const mkCustomer = async (orgId: string, name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_customers (org_id, display_name, portal_token) values ($1, $2, $3) returning id`,
        [orgId, name, `ptok-${stamp}-${Math.random().toString(36).slice(2, 10)}`]);
      return id;
    };
    custDue = await mkCustomer(orgA, `Vitest FU Due ${stamp}`);
    custFresh = await mkCustomer(orgA, `Vitest FU Fresh ${stamp}`);
    custB = await mkCustomer(orgB, `Vitest FU CrossOrg ${stamp}`);

    // Due: weekly cadence, last follow-up 10 days ago. Fresh: set today.
    await q(
      `update crm_customers set follow_up_cadence_days = 7, last_follow_up_at = now() - interval '10 days' where id = $1`,
      [custDue]);
    await q(
      `update crm_customers set follow_up_cadence_days = 14, last_follow_up_at = now() where id = $1`,
      [custFresh]);
    await q(
      `update crm_customers set follow_up_cadence_days = 7, last_follow_up_at = now() - interval '30 days' where id = $1`,
      [custB]);

    const mkLead = async (name: string, customerId: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_projects (org_id, customer_id, name, status) values ($1, $2, $3, 'lead') returning id`,
        [orgA, customerId, name]);
      return id;
    };
    leadNew = await mkLead(`Vitest FU LeadNew ${stamp}`, custFresh);
    leadCovered = await mkLead(`Vitest FU LeadCovered ${stamp}`, custDue);
    // The covered lead's customer has an estimate (customer-level link only).
    await q(
      `insert into crm_estimates (org_id, customer_id, number, title, status, public_token)
       values ($1, $2, $3, 'Estimate', 'sent', $4)`,
      [orgA, custDue, `EST-FU-${stamp}`, `etok-${stamp}`]);
  });

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) {
      if (!orgId) continue;
      await q(`delete from crm_estimates where org_id = $1`, [orgId]);
      await q(`delete from crm_projects where org_id = $1`, [orgId]);
      await q(`delete from crm_customers where org_id = $1`, [orgId]);
      await q(`delete from crm_team_activity where org_id = $1`, [orgId]);
      await q(`delete from crm_members where org_id = $1`, [orgId]);
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
    await pool.end();
  });

  it("lists cadenced customers due-first with the due math", async () => {
    const r = await api("/api/crm/follow-ups", {}, cookieA);
    expect(r.status).toBe(200);
    const due = r.body.followUps.find((f: any) => f.customerId === custDue);
    const fresh = r.body.followUps.find((f: any) => f.customerId === custFresh);
    expect(due.due).toBe(true);
    expect(due.overdueDays).toBeGreaterThanOrEqual(3); // 10 days since a weekly touch
    expect(fresh.due).toBe(false);
    // due-first ordering
    expect(r.body.followUps[0].customerId).toBe(custDue);
  });

  it("org B never sees org A's follow-up list", async () => {
    const r = await api("/api/crm/follow-ups", {}, cookieB);
    expect(r.status).toBe(200);
    expect(r.body.followUps.some((f: any) => f.customerId === custDue)).toBe(false);
    expect(r.body.followUps.some((f: any) => f.customerId === custB)).toBe(true);
  });

  it("PATCH sets a cadence, markDone stamps the follow-up and logs it", async () => {
    const set = await patch(`/api/crm/customers/${custFresh}/follow-up`, { cadenceDays: 7 }, cookieA);
    expect(set.status).toBe(200);
    expect(set.body.followUpCadenceDays).toBe(7);

    const done = await patch(`/api/crm/customers/${custDue}/follow-up`, { markDone: true }, cookieA);
    expect(done.status).toBe(200);
    expect(done.body.lastFollowUpAt).toBeTruthy();

    // No longer due after the stamp.
    const r = await api("/api/crm/follow-ups", {}, cookieA);
    expect(r.body.followUps.find((f: any) => f.customerId === custDue).due).toBe(false);

    const logged = await q<{ title: string }>(
      `select title from crm_team_activity where org_id = $1 and type = 'followUp'`, [orgA]);
    expect(logged.some((l) => l.title.includes("Vitest FU Due"))).toBe(true);

    // Cadence off clears it from the list.
    const off = await patch(`/api/crm/customers/${custFresh}/follow-up`, { cadenceDays: null }, cookieA);
    expect(off.status).toBe(200);
    const r2 = await api("/api/crm/follow-ups", {}, cookieA);
    expect(r2.body.followUps.some((f: any) => f.customerId === custFresh)).toBe(false);
  });

  it("rejects junk cadences and cross-org customers", async () => {
    const bad = await patch(`/api/crm/customers/${custFresh}/follow-up`, { cadenceDays: 5 }, cookieA);
    expect(bad.status).toBe(400);
    const cross = await patch(`/api/crm/customers/${custB}/follow-up`, { cadenceDays: 7 }, cookieA);
    expect(cross.status).toBe(404);
  });

  it("a field (view-only) member cannot set cadences", async () => {
    await q(`update crm_members set role = 'field' where id = $1`, [memberA]);
    try {
      const r = await patch(`/api/crm/customers/${custDue}/follow-up`, { cadenceDays: 7 }, cookieA);
      expect(r.status).toBe(403);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
    }
  });

  it("attention: new leads + leads needing an estimate, org-scoped", async () => {
    const r = await api("/api/crm/attention", {}, cookieA);
    expect(r.status).toBe(200);
    expect(r.body.newLeads.some((p: any) => p.id === leadNew)).toBe(true);
    expect(r.body.leadsNeedingEstimate.some((p: any) => p.id === leadNew)).toBe(true);
    // The covered lead shows as new (it is) but NOT as needing an estimate.
    expect(r.body.newLeads.some((p: any) => p.id === leadCovered)).toBe(true);
    expect(r.body.leadsNeedingEstimate.some((p: any) => p.id === leadCovered)).toBe(false);
    // No money leaks through the attention payload.
    expect(JSON.stringify(r.body)).not.toContain("contractValueCents");

    // Org B has no leads at all.
    const rb = await api("/api/crm/attention", {}, cookieB);
    expect(rb.status).toBe(200);
    expect(rb.body.newLeads.some((p: any) => p.id === leadNew)).toBe(false);
    expect(rb.body.leadsNeedingEstimate.length).toBe(0);
  });
});
