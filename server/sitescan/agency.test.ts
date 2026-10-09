import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureSiteScanSchema } from "./schema";
import { ensureGbpSchema } from "../gbp/schema";
import { registerSiteScanRoutes } from "./routes";
import { emptyState, parsePage, findingsFor } from "./audit";
import { fixesFor, enrichFindings } from "./guidance";
vi.mock("../account-events", () => ({
  logActivity: vi.fn(),
  notifyUser: vi.fn(),
}));
let user: number, other: number, ids: number[], job: string;
const routes = new Map<string, any[]>(),
  send = vi.fn(async () => ({ success: true }));
async function call(
  method: string,
  path: string,
  body: any = {},
  params: any = {},
  query: any = {},
  actor = user,
) {
  let status = 200,
    result: any;
  const req: any = { user: { id: actor }, body, params, query, headers: {} };
  const res: any = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (r: any) => {
      result = r;
      return res;
    },
  };
  for (const h of routes.get(method + path) || [])
    await h(req, res, (e: any) => {
      if (e) throw e;
    });
  return { status, body: result };
}
beforeAll(async () => {
  const dbUrl = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
    !/^\/constructhub_dev(?:_a\d+)?$/.test(dbUrl.pathname)
  )
    throw Error("Local lane development database required");
  await ensureGbpSchema();
  await ensureSiteScanSchema();
  await ensureSiteScanSchema();
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES($1),($2) RETURNING id",
    [
      "agency-" + randomUUID() + "@example.invalid",
      "agency-" + randomUUID() + "@example.invalid",
    ],
  );
  [user, other] = rows.map((r) => r.id);
  // Site Scans come from the plan's monthly allowance: Unlimited (`user`) is uncapped, so it
  // queues the whole 1,000-location agency; `other` is on Agency (50/month) for the limit checks.
  await pool.query(
    "INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'agency','active'),($2,'growth','active')",
    [user, other],
  );
  ids = (
    await pool.query(
      `INSERT INTO business_locations(user_id,business_name,website,gbp_location_name)
 SELECT $1,'Agency fixture '||lpad(i::text,4,'0'),'https://agency-fixture.test/'||i,'locations/agency-fixture-'||i FROM generate_series(1,1000) i RETURNING id`,
      [user],
    )
  ).rows.map((r) => r.id);
  await pool.query(
    `INSERT INTO gbp_sync_status(location_id,kind,last_success,profile_snapshot)
 SELECT id,'profile',now(),jsonb_build_object('business_name',business_name,'website',website) FROM business_locations WHERE user_id=$1`,
    [user],
  );
  const app: any = {};
  for (const m of ["get", "post", "delete"])
    app[m] = (p: string, ...h: any[]) => routes.set(m + p, h);
  registerSiteScanRoutes(
    app,
    (req, res) => {
      if (req.user.id) return req.user;
      res.status(401).json({});
      return null;
    },
    { send, provider: { generate: vi.fn() }, http: vi.fn() },
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[user, other]]);
  await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1)", [
    [`sitescan:bulk:${user}`, `sitescan:email:${user}`, `sitescan:bulk:${other}`],
  ]);
  await pool.query(
    "DELETE FROM growth_budgets WHERE key LIKE ANY($1)",
    [[`quota:user:${user}:%`, `quota:user:${other}:%`]],
  );
  await pool.query("DELETE FROM sitescan_jobs WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.end();
});
it("paginates/searches 1,000 owned locations and queues the whole agency in one request without provider calls", async () => {
  const first = await call("get", "/api/sitescan");
  expect(first.body.locations).toHaveLength(25);
  expect(first.body.locationTotal).toBe(1000);
  const end = await call(
    "get",
    "/api/sitescan",
    {},
    {},
    { locationOffset: 975 },
  );
  expect(end.body.locations).toHaveLength(25);
  expect(end.body.locations[0].business_name).toBe("Agency fixture 0976");
  const search = await call(
    "get",
    "/api/sitescan",
    {},
    {},
    { locationQ: "0999" },
  );
  expect(search.body.locationTotal).toBe(1);
  expect(
    (
      await call(
        "post",
        "/api/sitescan/bulk",
        { locationIds: [ids[0]] },
        {},
        {},
        other,
      )
    ).status,
  ).toBe(400);
  const r = await call("post", "/api/sitescan/bulk", {
    locationIds: ids,
    pageCap: 2,
    psiPages: 0,
  });
  expect(r.status).toBe(202);
  expect(r.body.jobs).toHaveLength(1000);
  job = r.body.jobs[0].id;
  const history = await call(
    "get",
    "/api/sitescan",
    {},
    {},
    { status: "queued" },
  );
  expect(history.body.jobs).toHaveLength(25);
  expect(history.body.total).toBe(1000);
  const scoped = await call(
    "get",
    "/api/sitescan",
    {},
    {},
    { locationId: ids[0] },
  );
  expect(scoped.body.total).toBe(1);
  // Unlimited includes unlimited Site Scans a month, so for `user` the daily agency queue
  // budget (1,000 sites/day) — already spent by the bulk above — is what refuses a second run.
  const again = await call("post", "/api/sitescan/bulk", {
    locationIds: [ids[0]],
  });
  expect(again.status).toBe(429);
  // A plan with a monthly Site Scan allowance is refused with 403 once it is spent: Agency
  // includes 50/month, so scanning 50 owned locations spends it and the next request names
  // the limit.
  const otherIds = (
    await pool.query(
      `INSERT INTO business_locations(user_id,business_name,website,gbp_location_name)
       SELECT $1,'Agency fixture other '||lpad(i::text,4,'0'),'https://agency-fixture.test/other-'||i,'locations/agency-fixture-other-'||i FROM generate_series(1,51) i RETURNING id`,
      [other],
    )
  ).rows.map((r) => r.id);
  await pool.query(
    `INSERT INTO gbp_sync_status(location_id,kind,last_success,profile_snapshot)
     SELECT id,'profile',now(),jsonb_build_object('business_name',business_name,'website',website) FROM business_locations WHERE user_id=$1`,
    [other],
  );
  expect(
    (
      await call(
        "post",
        "/api/sitescan/bulk",
        { locationIds: otherIds.slice(0, 50) },
        {},
        {},
        other,
      )
    ).status,
  ).toBe(202);
  const monthly = await call(
    "post",
    "/api/sitescan/bulk",
    { locationIds: [otherIds[50]] },
    {},
    {},
    other,
  );
  expect(monthly.status).toBe(403);
  expect(monthly.body).toMatchObject({
    code: "limit_reached",
    feature: "siteScans",
    limit: 50,
  });
  expect(monthly.body.message).toContain("50 Site Scans");
  // The daily agency queue budget still applies on top of the monthly allowance, and a bulk
  // it refuses gives its monthly scans back (clear the spent monthly count so the reservation
  // succeeds and the daily budget is the refusal).
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE $1", [
    `quota:user:${other}:siteScans:%`,
  ]);
  await pool.query(
    `INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,1000)
     ON CONFLICT(key,period) DO UPDATE SET used=1000`,
    [`sitescan:bulk:${other}`, String(Math.floor(Date.now() / 86400000))],
  );
  expect(
    (
      await call(
        "post",
        "/api/sitescan/bulk",
        { locationIds: [otherIds[0]] },
        {},
        {},
        other,
      )
    ).status,
  ).toBe(429);
  const { rows: quota } = await pool.query(
    "SELECT used FROM growth_budgets WHERE key LIKE $1",
    [`quota:user:${other}:siteScans:%`],
  );
  expect(quota.map((r) => Number(r.used))).toEqual([0]);
  await pool.query(
    "UPDATE sitescan_jobs SET status='failed' WHERE user_id=$1",
    [user],
  );
});
it("owner scopes status, retry, email, branding, reports and bulk inputs", async () => {
  for (const route of ["fixes", "retry", "email"])
    expect(
      (
        await call(
          "post",
          "/api/sitescan/jobs/:id/" + route,
          {},
          { id: job },
          {},
          other,
        )
      ).status,
    ).toBe(404);
  expect(
    (await call("get", "/api/sitescan/jobs/:id", {}, { id: job }, {}, other))
      .status,
  ).toBe(404);
  expect((await call("get", "/api/sitescan", {}, {}, {}, 0)).status).toBe(401);
  expect(
    (await call("get", "/api/sitescan", {}, {}, { limit: 1001 })).status,
  ).toBe(400);
  expect(
    (
      await call("post", "/api/sitescan/branding", {
        name: "Fixture",
        logo: "https://127.0.0.1/logo",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("post", "/api/sitescan/branding", {
        name: "Fixture Agency",
        logo: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call("get", "/api/sitescan/branding", {}, {}, {}, other)).body.name,
  ).toBe("");
});
it("persists individual and bulk done status without claiming verification; emails code using injected sink", async () => {
  const state = emptyState("https://agency-fixture.test/");
  state.pages = [
    parsePage({
      url: state.queue[0],
      status: 200,
      body: "<h1>Fixture title</h1>",
      bytes: 23,
      headers: {},
      redirects: [],
    }),
  ];
  const findings = findingsFor(state),
    fixes = fixesFor(findings, state, null),
    report = {
      url: state.queue[0],
      findings: enrichFindings(findings, state, null),
      fixes,
    };
  await pool.query(
    "UPDATE sitescan_jobs SET report=$2,status='completed' WHERE id=$1",
    [job, report],
  );
  expect(
    (
      await call(
        "post",
        "/api/sitescan/jobs/:id/fixes",
        { keys: [fixes[0].key], done: true },
        { id: job },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        "post",
        "/api/sitescan/jobs/:id/fixes",
        { keys: ["a".repeat(64)], done: true },
        { id: job },
      )
    ).status,
  ).toBe(400);
  const r = await call(
    "get",
    "/api/sitescan/jobs/:id",
    {},
    { id: job },
    { limit: 1 },
  );
  expect(r.body.report.fixes).toHaveLength(1);
  expect(r.body.report.fixes[0]).toMatchObject({
    done: true,
    verification: "new",
  });
  expect(
    (
      await call(
        "post",
        "/api/sitescan/jobs/:id/email",
        { email: "fixture@example.invalid" },
        { id: job },
      )
    ).status,
  ).toBe(200);
  expect(send.mock.calls.length).toBe(1);
  expect((send.mock.calls as any)[0][0].text).toContain(
    "<title>Fixture title</title>",
  );
  const shared = await call(
    "post",
    "/api/sitescan/jobs/:id/share",
    {},
    { id: job },
  );
  expect(shared.body.path).toMatch(/\/site-scan\/report\//);
});
