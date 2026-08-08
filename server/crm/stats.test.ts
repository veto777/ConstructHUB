/**
 * /api/crm/stats + /api/crm/team-activity — the home-page numbers and feed.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8129 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with CRM_TEST_DATABASE_URL.
 *
 * Fixtures live in TWO THROWAWAY orgs created here (user 1 made owner of
 * both) and are fully deleted in afterAll — the shared dev orgs are never
 * touched, so this file is safe against the other suites running in
 * parallel. Seeding is straight SQL: the corrupt paid>total invoice and the
 * payment pointing at another org's customer are exactly the rows no app
 * write path produces, which is the point of the hardening they probe.
 * Role flips hit only the scratch org's membership and are restored in a
 * finally anyway.
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

const post = (path: string, data: unknown, cookie?: string) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }, cookie);

describe("crm stats + team activity (dev server)", () => {
  let cookie: string | undefined;
  let orgA = "";   // the fixture org — every stat/feed row lives here
  let orgB = "";   // only ever holds the cross-org customer
  let memberA = "";
  let custA = "";
  let custCross = "";
  let estSentId = "";
  let evSentId = "";
  let evViewedId = "";
  let payOkId = "";
  let payCrossId = "";
  let teamRowId = "";

  const t0 = Date.now() - 3_600_000; // fixtures sit an hour back, seconds apart
  const at = (secs: number) => new Date(t0 + secs * 1000).toISOString();

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const mkOrg = async (name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`,
        [name]);
      return id;
    };
    orgA = await mkOrg(`Vitest Stats A ${stamp}`);
    orgB = await mkOrg(`Vitest Stats B ${stamp}`);
    const [{ id: mId }] = await q<{ id: string }>(
      `insert into crm_members (org_id, user_id, email, role, status, display_name)
       values ($1, 1, $2, 'owner', 'active', 'Stats Owner') returning id`,
      [orgA, `vitest.stats.${stamp}@example.com`]);
    memberA = mId;

    // Pin this suite's session to the scratch org (per-session pin — the
    // other suites keep their own sessions and their own orgs).
    const sw = await post("/api/crm/org/switch", { orgId: orgA }, me.cookie);
    expect(sw.status).toBe(200);
    cookie = sw.cookie;

    const mkCustomer = async (orgId: string, name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_customers (org_id, display_name, portal_token) values ($1, $2, $3) returning id`,
        [orgId, name, `ptok-${stamp}-${Math.random().toString(36).slice(2, 10)}`]);
      return id;
    };
    custA = await mkCustomer(orgA, `Vitest Stats CustA ${stamp}`);
    custCross = await mkCustomer(orgB, `Vitest Stats CROSSORG ${stamp}`);

    const mkEstimate = async (status: string, totalCents: number, approvedTotalCents: number | null, number: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_estimates (org_id, customer_id, number, status, total_cents, approved_total_cents, public_token)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [orgA, custA, number, status, totalCents, approvedTotalCents, `etok-${stamp}-${number}`]);
      return id;
    };
    // openEstimates = sent + viewed only.
    estSentId = await mkEstimate("sent", 10_000, null, "EST-S1");
    await mkEstimate("viewed", 20_000, null, "EST-S2");
    await mkEstimate("draft", 50_000, null, "EST-S3");      // excluded: draft
    // jobsWon = approved, approvedTotalCents with totalCents fallback.
    await mkEstimate("approved", 30_000, 25_000, "EST-S4"); // bills 25_000
    await mkEstimate("approved", 40_000, null, "EST-S5");   // falls back to 40_000

    // unscheduledJobs = approved-stage projects, not archived.
    const mkProject = async (name: string, status: string, value: number, archived: boolean) => {
      await q(
        `insert into crm_projects (org_id, customer_id, name, status, contract_value_cents, archived_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [orgA, custA, name, status, value, archived ? new Date().toISOString() : null]);
    };
    await mkProject("Vitest Stats P1", "approved", 12_000, false);
    await mkProject("Vitest Stats P2", "approved", 8_000, true);   // excluded: archived
    await mkProject("Vitest Stats P3", "scheduled", 7_000, false); // excluded: on the calendar

    // openInvoices = sent + partial, sum(total - paid) clamped per row at 0.
    const mkInvoice = async (status: string, totalCents: number, paidCents: number, number: string) => {
      await q(
        `insert into crm_invoices (org_id, customer_id, number, status, total_cents, paid_cents, public_token)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [orgA, custA, number, status, totalCents, paidCents, `itok-${stamp}-${number}`]);
    };
    await mkInvoice("sent", 10_000, 0, "INV-S1");       // 10_000 open
    await mkInvoice("partial", 20_000, 5_000, "INV-S2");// 15_000 open
    await mkInvoice("sent", 7_000, 9_000, "INV-S3");    // corrupt: paid > total → clamps to 0
    await mkInvoice("paid", 1_000, 1_000, "INV-S4");    // excluded: paid

    // Feed fixtures, ordered by created_at: team row < payment < viewed <
    // sent < access_denied×5 < cross-org payment (newest, must NOT render).
    const [{ id: taId }] = await q<{ id: string }>(
      `insert into crm_team_activity (org_id, member_id, type, title, created_at)
       values ($1, $2, 'note', 'Vitest stats feed row', $3) returning id`,
      [orgA, memberA, at(0)]);
    teamRowId = taId;

    const mkPayment = async (customerId: string, amountCents: number, method: string, createdAt: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_payments (org_id, customer_id, provider, amount_cents, method, status, paid_at, created_at)
         values ($1, $2, 'stripe', $3, $4, 'succeeded', $5, $5) returning id`,
        [orgA, customerId, amountCents, method, createdAt]);
      return id;
    };
    payOkId = await mkPayment(custA, 12_345, "card", at(1));
    // The cross-org row: OUR org's payment pointing at ORG B's customer.
    payCrossId = await mkPayment(custCross, 99_900, "ach", at(20));

    const mkEvent = async (type: string, actor: string | null, createdAt: string, meta?: unknown) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_estimate_events (org_id, estimate_id, type, actor, meta, created_at)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [orgA, estSentId, type, actor, meta ? JSON.stringify(meta) : null, createdAt]);
      return id;
    };
    evViewedId = await mkEvent("viewed", "client", at(5));
    evSentId = await mkEvent("sent", null, at(10));
    // Security noise newer than the renderable events — the starvation probe.
    for (let i = 0; i < 5; i++) {
      await mkEvent("access_denied", "system", at(11 + i));
    }
  });

  afterAll(async () => {
    try {
      for (const table of [
        "crm_payments", "crm_estimate_events", "crm_estimates", "crm_invoices",
        "crm_projects", "crm_team_activity", "crm_customers", "crm_members",
      ]) {
        await q(`delete from ${table} where org_id = any($1)`, [[orgA, orgB]]);
      }
      await q(`delete from crm_orgs where id = any($1)`, [[orgA, orgB]]);
    } finally {
      await pool.end();
    }
  });

  it("gates: field/subcontractor → 403, sales/owner → 200 on both routes", async () => {
    try {
      for (const role of ["field", "subcontractor"]) {
        await q(`update crm_members set role = $1 where id = $2`, [role, memberA]);
        const stats = await api("/api/crm/stats", {}, cookie);
        expect([role, stats.status]).toEqual([role, 403]);
        const feed = await api("/api/crm/team-activity", {}, cookie);
        expect([role, feed.status]).toEqual([role, 403]);
      }
      await q(`update crm_members set role = 'sales' where id = $1`, [memberA]);
      expect((await api("/api/crm/stats", {}, cookie)).status).toBe(200);
      expect((await api("/api/crm/team-activity", {}, cookie)).status).toBe(200);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
    }
    expect((await api("/api/crm/stats", {}, cookie)).status).toBe(200);
    expect((await api("/api/crm/team-activity", {}, cookie)).status).toBe(200);
  });

  it("stats: the four headline numbers match the hand-computed fixtures", async () => {
    const r = await api("/api/crm/stats", {}, cookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      openEstimates: { count: 2, totalCents: 30_000 },     // sent 10k + viewed 20k
      jobsWon: { count: 2, totalCents: 65_000 },           // approved 25k + fallback 40k
      unscheduledJobs: { count: 1, totalCents: 12_000 },   // approved, unarchived
      // 10k + 15k + clamped-to-0 corrupt row (uncamped sum would be 23_000).
      openInvoices: { count: 3, totalCents: 25_000 },
    });
  });

  it("team-activity: merges all sources newest-first; noise and cross-org rows stay out", async () => {
    const r = await api("/api/crm/team-activity", {}, cookie);
    expect(r.status).toBe(200);
    const items = r.body.activity as any[];

    // Exact merged order: sent > viewed > payment > team row (cross-org
    // payment is newest of all and must simply not appear).
    expect(items.map((i) => i.id)).toEqual([
      `e:${evSentId}`,
      `e:${evViewedId}`,
      `p:${payOkId}`,
      `a:${teamRowId}`,
    ]);
    expect(items[0].text).toMatch(/^sent estimate EST-S1 to Vitest Stats CustA /);
    expect(items[1].text).toBe("opened estimate EST-S1");
    expect(items[2].text).toBe("paid $123.45 by CARD");

    // The cross-org customer name leaks nowhere — not as actor, not in text.
    const blob = JSON.stringify(items);
    expect(blob).not.toContain("CROSSORG");
    expect(items.some((i) => i.id === `p:${payCrossId}`)).toBe(false);
    // access_denied is security noise for the client timeline, not the feed.
    expect(blob).not.toContain("access_denied");
  });

  it("team-activity: the limit*2 event budget is spent on renderable types only", async () => {
    // limit=2 → the events query fetches 4 rows. The 4 newest events are all
    // access_denied, so an unfiltered fetch starves the feed of the sent/
    // viewed events; the SQL type filter keeps them reachable.
    const r = await api("/api/crm/team-activity?limit=2", {}, cookie);
    expect(r.status).toBe(200);
    expect(r.body.activity.map((i: any) => i.id)).toEqual([
      `e:${evSentId}`,
      `e:${evViewedId}`,
    ]);
  });
});
