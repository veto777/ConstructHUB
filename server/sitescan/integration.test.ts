import { it, expect, vi, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureSiteScanSchema } from "./schema";
import {
  registerSiteScanRoutes,
  hashToken,
  marketingBaseUrl,
  psiLines,
} from "./routes";
import { PRIMARY_DOMAIN, SITE_DOMAINS } from "../site-context";
import { enqueue, runSiteScanWorker, runSchedules } from "./worker";
import { quotaKey, resetsAt } from "../growth-quotas";
import { emptyState } from "./audit";
vi.mock("../account-events", () => ({
  notifyUser: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
}));
import { notifyUser } from "../account-events";
const routes = new Map<string, any[]>(),
  mail = vi.fn(async () => {}),
  provider = {
    generate: vi.fn(async () => "AI DRAFT: Use the observed page subject."),
  };
const captcha = vi.fn(async () => new Response('{"success":true}'));
let own: string, foreign: string;
const auth = (req: any, res: any) => {
  if (req.testUser) return { id: req.testUser };
  res.status(401).json({ message: "Not authenticated" });
  return null;
};
async function call(
  method: string,
  path: string,
  { body = {}, params = {}, user = 1 }: any = {},
) {
  const req: any = {
    body,
    params,
    testUser: user,
    ip: "sitescan-test-" + process.pid,
    socket: { remoteAddress: "127.0.0.1" },
    headers: {},
  };
  let status = 200,
    result: any;
  const res: any = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (v: any) => {
      result = v;
      return res;
    },
    setHeader: () => res,
  };
  const handlers = routes.get(method + path)!;
  for (const handler of handlers) {
    let next = false;
    await handler(req, res, (err: any) => {
      if (err) throw err;
      next = true;
    });
    if (!next) break;
  }
  return { status, body: result };
}
beforeAll(async () => {
  if (
    !/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)
  )
    throw new Error("a5 DB only");
  await ensureSiteScanSchema();
  await ensureSiteScanSchema();
  const app: any = {};
  for (const method of ["get", "post", "delete"])
    app[method] = (path: string, ...handlers: any[]) =>
      routes.set(method + path, handlers);
  registerSiteScanRoutes(app, auth, {
    provider,
    send: mail,
    http: captcha as any,
  });
  own = await enqueue(1, "https://sitescan-fixture.test/", 2, 0);
  foreign = await enqueue(null, "https://sitescan-other.test/", 1, 0);
  await pool.query("UPDATE sitescan_jobs SET status='failed' WHERE id=$1", [
    foreign,
  ]);
});
afterAll(async () => {
  await pool.query(
    "DELETE FROM sitescan_jobs WHERE url LIKE 'https://sitescan-%'",
  );
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'sitescan:%'");
  await pool.query(
    "DELETE FROM sitescan_schedules WHERE url LIKE 'https://sitescan-%'",
  );
  await pool.end();
});
it("authenticates, validates cap and URL, and hides foreign jobs", async () => {
  expect((await call("get", "/api/sitescan", { user: null })).status).toBe(401);
  expect(
    (await call("get", "/api/sitescan/jobs/:id", { params: { id: foreign } }))
      .status,
  ).toBe(404);
  expect(
    (await call("post", "/api/sitescan", { body: { url: "http://127.0.0.1" } }))
      .status,
  ).toBe(400);
  expect(
    (
      await call("post", "/api/sitescan", {
        body: { url: "https://sitescan-fixture.test", pageCap: 501 },
      })
    ).status,
  ).toBe(400);
});
it("resumes an expired worker lease and produces a persisted report and notification", async () => {
  await pool.query(
    "UPDATE sitescan_jobs SET status='running',lease_until=now()-interval '1 minute' WHERE id=$1",
    [own],
  );
  const http = vi.fn(async (url: string) => ({
    url,
    status: 200,
    headers: {},
    redirects: [],
    bytes: 100,
    body: url.endsWith("robots.txt")
      ? "User-agent: *\nAllow: /"
      : url.endsWith("sitemap.xml")
        ? "<urlset/>"
        : url.endsWith("llms.txt")
          ? "# Fixture"
          : "<html><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>",
  }));
  await runSiteScanWorker({
    http,
    crawl: (await import("./audit")).crawl,
    pageSpeed: vi.fn(),
  });
  const r = await call("get", "/api/sitescan/jobs/:id", {
    params: { id: own },
  });
  expect(r.body.status).toBe("completed");
  expect(r.body.report.pages).toBe(1);
  expect(r.body.report.scores.categories.performance).toBeNull();
  expect(notifyUser).toHaveBeenCalledWith(
    1,
    "sitescan.completed",
    expect.anything(),
  );
});
it("creates draft through injected provider, hashes shares and revokes access", async () => {
  expect(
    (await call("post", "/api/sitescan/jobs/:id/plan", { params: { id: own } }))
      .body.draft,
  ).toContain("AI DRAFT");
  expect(provider.generate).toHaveBeenCalled();
  const share = await call("post", "/api/sitescan/jobs/:id/share", {
    params: { id: own },
  });
  const value = share.body.path.split("/").pop();
  const {
    rows: [stored],
  } = await pool.query("SELECT share_hash FROM sitescan_jobs WHERE id=$1", [
    own,
  ]);
  expect(stored.share_hash).toBe(hashToken(value));
  expect(
    (
      await call("get", "/api/sitescan/shared/:token", {
        params: { token: value },
        user: null,
      })
    ).body.report.pages,
  ).toBe(1);
  expect(
    (
      await call("delete", "/api/sitescan/jobs/:id/share", {
        params: { id: own },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("get", "/api/sitescan/shared/:token", {
        params: { token: value },
        user: null,
      })
    ).status,
  ).toBe(404);
});
it("refunds AI budgets when the provider fails and only mentions a JSON-LD draft that exists", async () => {
  const keys = ["sitescan:ai:1", "sitescan:ai-calls:1", "sitescan:ai-global"];
  const period = String(Math.floor(Date.now() / 86400_000));
  const used = async () =>
    Object.fromEntries(
      (
        await pool.query(
          "SELECT key,used FROM growth_budgets WHERE key=ANY($1) AND period=$2",
          [keys, period],
        )
      ).rows.map((r) => [r.key, r.used]),
    );
  const before = await used();
  provider.generate.mockRejectedValueOnce(new Error("provider outage fixture"));
  const r = await call("post", "/api/sitescan/jobs/:id/plan", {
    params: { id: own },
  });
  expect(r.status).toBe(503);
  expect(r.body.message).toContain("allowance was not used");
  // This fixture job has no GBP profile, so there is no JSON-LD draft to point at.
  expect(r.body.message).not.toContain("JSON-LD");
  expect(await used()).toEqual(before);
});
it("PDF PageSpeed lines are plain language, never raw JSON", () => {
  const text = psiLines([
    {
      strategy: "mobile",
      url: "https://fixture.test/",
      unavailable: "PageSpeed quota exceeded; retry after quota resets.",
    },
    {
      strategy: "desktop",
      url: "https://fixture.test/",
      score: 72,
      lab: {
        "largest-contentful-paint": { value: 2500, display: "2.5 s" },
        "speed-index": { value: null, display: null },
      },
      field: null,
      originField: null,
    },
    { reason: "disabled", unavailable: "PageSpeed was not selected (0 pages)." },
  ]).join("\n");
  expect(text).toContain(
    "mobile · https://fixture.test/: PageSpeed data unavailable (PageSpeed quota exceeded",
  );
  expect(text).toContain("desktop · https://fixture.test/: performance score 72");
  expect(text).toContain("Largest Contentful Paint: 2.5 s");
  expect(text).not.toContain("Speed Index");
  expect(text).toContain("No real-user field data reported.");
  expect(text).toContain("PageSpeed: PageSpeed data unavailable (PageSpeed was not selected");
  expect(text).not.toMatch(/[{}"]/);
});
it("free-scan verification links use the caller's own origin, never a hardcoded localhost", () => {
  expect(marketingBaseUrl({ headers: { host: "127.0.0.1:8208" } })).toBe(
    "http://127.0.0.1:8208",
  );
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
  vi.stubEnv("APP_URL", "");
  try {
    const apex = SITE_DOMAINS[SITE_DOMAINS.length - 1];
    expect(marketingBaseUrl({ headers: { host: `www.${apex}` } })).toBe(
      `https://${apex}`,
    );
    // The portal is not where a marketing lead should land.
    expect(marketingBaseUrl({ headers: { host: `portal.${apex}` } })).toBe(
      `https://${apex}`,
    );
    expect(marketingBaseUrl({ headers: { host: "attacker.example" } })).toBe(
      `https://${PRIMARY_DOMAIN}`,
    );
    vi.stubEnv("APP_URL", "https://app.example.invalid/");
    expect(marketingBaseUrl({ headers: { host: "attacker.example" } })).toBe(
      "https://app.example.invalid",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
it("public access only returns summary, verification unlocks full report, email budgets persist", async () => {
  const start = await call("post", "/api/sitescan/public/start", {
    user: null,
    body: {
      url: "https://sitescan-lead.test/",
      email: "sitescan-test@example.invalid",
      captchaToken: "fixture",
    },
  });
  expect(start.status).toBe(202);
  expect(mail).toHaveBeenCalled();
  const {
    rows: [lead],
  } = await pool.query("SELECT * FROM sitescan_leads WHERE access_hash=$1", [
    hashToken(start.body.access),
  ]);
  expect(lead.verified_at).toBeNull();
  const {
    rows: [j],
  } = await pool.query("SELECT report FROM sitescan_jobs WHERE id=$1", [own]);
  await pool.query(
    "UPDATE sitescan_jobs SET status='completed',report=$2 WHERE id=$1",
    [lead.job_id, j.report],
  );
  const summary = await call("get", "/api/sitescan/public/status/:token", {
    params: { token: start.body.access },
    user: null,
  });
  expect(summary.body.report).toBeUndefined();
  expect(summary.body.summary.findings.length).toBeLessThanOrEqual(5);
  const mailObject = (mail.mock.calls as any)[0][0];
  expect(mailObject.text).not.toContain("localhost:8169");
  const value = mailObject.text.match(/verify=([a-f0-9]{64})/)[1];
  expect(
    (
      await call("post", "/api/sitescan/public/verify", {
        body: { token: value },
        user: null,
      })
    ).body.report.pages,
  ).toBe(1);
  expect(
    (
      await call("post", "/api/sitescan/public/verify", {
        body: { token: "a".repeat(64) },
        user: null,
      })
    ).status,
  ).toBe(404);
  await call("post", "/api/sitescan/public/start", {
    user: null,
    body: {
      url: "https://sitescan-lead.test/",
      email: "sitescan-test@example.invalid",
      captchaToken: "fixture",
    },
  });
  expect(
    (
      await call("post", "/api/sitescan/public/start", {
        user: null,
        body: {
          url: "https://sitescan-lead.test/",
          email: "sitescan-test@example.invalid",
          captchaToken: "fixture",
        },
      })
    ).status,
  ).toBe(429);
});

it("reserves monthly schedules once across competing ticks and notifies a score regression", async () => {
  await pool.query(
    "INSERT INTO sitescan_schedules(user_id,url,next_at,page_cap,psi_pages) VALUES(1,'https://sitescan-fixture.test/',now()-interval '1 day',1,0) ON CONFLICT(user_id,url) DO UPDATE SET next_at=now()-interval '1 day'",
  );
  // A scheduled scan spends one of the owner's monthly Site Scans; put the dev user's count back afterwards.
  const monthly = quotaKey(1, "siteScans");
  const usedBefore = async () => Number((await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [monthly])).rows[0]?.used ?? 0);
  const before = await usedBefore();
  await Promise.all([runSchedules(), runSchedules()]);
  const { rows: jobs } = await pool.query(
    "SELECT id FROM sitescan_jobs WHERE url='https://sitescan-fixture.test/' AND status='queued'",
  );
  expect(jobs).toHaveLength(1);
  expect(await usedBefore()).toBe(before + 1);
  await pool.query("UPDATE growth_budgets SET used=$2 WHERE key=$1 AND period='0'", [monthly, before]);
  // A new critical HTTP error must produce a regression notification.
  const http = async (url: string) => ({
    url,
    status: url.endsWith("/") ? 500 : 200,
    body: url.endsWith("robots.txt")
      ? "User-agent: *\nAllow: /"
      : url.endsWith("sitemap.xml")
        ? "<urlset/>"
        : "<html><body>Unavailable</body></html>",
    headers: {},
    bytes: 100,
    redirects: [],
  });
  // Public lead fixtures above are completed/queued; keep this worker assertion targeted.
  await pool.query(
    "UPDATE sitescan_jobs SET status='failed' WHERE user_id IS NULL AND status='queued' AND url LIKE 'https://sitescan-%'",
  );
  await runSiteScanWorker({
    http,
    crawl: (await import("./audit")).crawl,
    pageSpeed: vi.fn(),
  });
  expect(notifyUser).toHaveBeenCalledWith(
    1,
    "sitescan.regressed",
    expect.anything(),
  );
});

it("scheduled scans follow the monthly plan allowance: a used-up month waits for the 1st, no plan waits a day", async () => {
  const { takeBudget } = await import("../growth-limits");
  const { rows } = await pool.query(
    "INSERT INTO users(email) SELECT 'sitescan-sched-'||n||'-'||gen_random_uuid()||'@example.invalid' FROM generate_series(1,3) n RETURNING id",
  );
  const [usedUp, noPlan, dailyCapped] = rows.map((r) => r.id as number);
  const url = (u: number) => `https://sitescan-sched-${u}.test/`;
  try {
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'starter','active'),($2,'starter','active')", [usedUp, dailyCapped]);
    // Starter includes 2 Site Scans a month: both spent. The other Starter owner has used today's scan budget.
    await takeBudget(quotaKey(usedUp, "siteScans"), 2, 2, Number.MAX_SAFE_INTEGER);
    await takeBudget(`sitescan:scan:${dailyCapped}`, 5, 5, 86400_000);
    for (const u of [usedUp, noPlan, dailyCapped])
      await pool.query(
        "INSERT INTO sitescan_schedules(user_id,url,next_at,page_cap,psi_pages) VALUES($1,$2,now()-interval '1 minute',1,0)",
        [u, url(u)],
      );
    const next = async (u: number) => new Date((await pool.query("SELECT next_at FROM sitescan_schedules WHERE user_id=$1", [u])).rows[0].next_at).getTime();
    // Other due schedules on a shared database are handled first (10 per tick).
    for (let i = 0; i < 5 && (await Promise.all([usedUp, noPlan, dailyCapped].map(next))).some((t) => t <= Date.now()); i++) await runSchedules();
    expect(await next(usedUp)).toBe(new Date(resetsAt()).getTime());
    for (const u of [noPlan, dailyCapped]) {
      expect(await next(u)).toBeGreaterThan(Date.now() + 23 * 3600_000);
      expect(await next(u)).toBeLessThan(Date.now() + 25 * 3600_000);
    }
    expect((await pool.query("SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=ANY($1::int[])", [[usedUp, noPlan, dailyCapped]])).rows[0].n).toBe(0);
    // The daily refusal gave the monthly scan back.
    expect(Number((await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [quotaKey(dailyCapped, "siteScans")])).rows[0]?.used ?? 0)).toBe(0);
  } finally {
    const ids = [usedUp, noPlan, dailyCapped];
    await pool.query("DELETE FROM sitescan_schedules WHERE user_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1::text[])", [[...ids.map((u) => quotaKey(u, "siteScans")), ...ids.map((u) => `sitescan:scan:${u}`)]]);
    await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  }
});

it("serializes schedule caps while allowing updates at the limit", async () => {
  await pool.query("DELETE FROM sitescan_schedules WHERE user_id=1");
  const schedule = (i: number, pageCap = 1) => call("post", "/api/sitescan/schedule", {
    body: { url: `https://sitescan-cap-${i}.test/`, enabled: true, pageCap, psiPages: 0 },
  });
  for (let i = 0; i < 9; i++) expect((await schedule(i)).status).toBe(200);
  const results = await Promise.all([schedule(9), schedule(10)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await schedule(0, 20)).status).toBe(200);
  const { rows } = await pool.query("SELECT page_cap FROM sitescan_schedules WHERE user_id=1");
  expect(rows).toHaveLength(10);
  expect(rows.some(r => r.page_cap === 20)).toBe(true);
  await pool.query("DELETE FROM sitescan_schedules WHERE url LIKE 'https://sitescan-cap-%'");
});

it("failed CAPTCHA attempts do not exhaust scan budgets or capture leads", async () => {
  const previous = process.env.RECAPTCHA_SECRET_KEY;
  process.env.RECAPTCHA_SECRET_KEY = "fixture-secret";
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'sitescan:lead-%'");
  const start = (captchaToken?: string) => call("post", "/api/sitescan/public/start", {
    user: null,
    body: { url: "https://sitescan-captcha.test/", email: "captcha@example.invalid", captchaToken },
  });
  const sent = mail.mock.calls.length;
  try {
    for (let i = 0; i < 4; i++) expect((await start()).status).toBe(400);
    captcha.mockResolvedValueOnce(new Response('{"success":false}'));
    expect((await start("invalid")).status).toBe(400);
    captcha.mockRejectedValueOnce(new Error("offline"));
    expect((await start("unavailable")).status).toBe(503);
    expect(mail.mock.calls).toHaveLength(sent);
    const { rows } = await pool.query("SELECT * FROM growth_budgets WHERE key LIKE 'sitescan:lead-%'");
    expect(rows).toHaveLength(0);
    expect((await start("valid-fixture")).status).toBe(202);
    expect(mail.mock.calls).toHaveLength(sent + 1);
  } finally {
    if (previous === undefined) delete process.env.RECAPTCHA_SECRET_KEY;
    else process.env.RECAPTCHA_SECRET_KEY = previous;
  }
});

it("allows stopping a rescan after its linked profile becomes unavailable", async () => {
  const url = "https://sitescan-disconnected.test/";
  await pool.query("INSERT INTO sitescan_schedules(user_id,url,location_id) VALUES(1,$1,2147483647)", [url]);
  expect((await call("post", "/api/sitescan/schedule", {
    body: { url, locationId: 2147483647, enabled: false },
  })).status).toBe(200);
  expect((await pool.query("SELECT * FROM sitescan_schedules WHERE url=$1", [url])).rows).toHaveLength(0);
});

it("isolates all report mutations and exports from another owner's job", async () => {
  for (const [method, suffix] of [["post", "plan"], ["post", "share"], ["delete", "share"], ["get", "pdf"]]) {
    expect((await call(method, `/api/sitescan/jobs/:id/${suffix}`, { params: { id: foreign } })).status).toBe(404);
    expect((await call(method, `/api/sitescan/jobs/:id/${suffix}`, { params: { id: own }, user: null })).status).toBe(401);
  }
});
it("an owner deletes only their own scan; the report, share link and history entry go with it", async () => {
  const url = "https://sitescan-delete.test/";
  const id = await enqueue(1, url, 1, 0);
  const del = (params: any, user: any = 1) =>
    call("delete", "/api/sitescan/jobs/:id", { params, user });
  expect((await del({ id }, null)).status).toBe(401);
  expect((await del({ id }, 2)).status).toBe(404);
  expect((await del({ id: foreign })).status).toBe(404);
  expect((await del({ id: "not-a-scan" })).status).toBe(400);
  await pool.query("UPDATE sitescan_jobs SET status='completed',report=$2 WHERE id=$1", [
    id,
    { scores: { overall: 1, categories: {} }, findings: [], coverage: { notes: [] } },
  ]);
  const share = await call("post", "/api/sitescan/jobs/:id/share", { params: { id } });
  const value = share.body.path.split("/").pop();
  expect((await del({ id })).status).toBe(200);
  expect((await call("get", "/api/sitescan/jobs/:id", { params: { id } })).status).toBe(404);
  expect(
    (await call("get", "/api/sitescan/shared/:token", { params: { token: value }, user: null })).status,
  ).toBe(404);
  expect(
    (await call("get", "/api/sitescan", { body: {}, params: {} })).body.jobs.some((j: any) => j.id === id),
  ).toBe(false);
  expect((await pool.query("SELECT 1 FROM sitescan_jobs WHERE id=$1", [foreign])).rowCount).toBe(1);
  expect((await del({ id })).status).toBe(404);
});
it("deleting a running scan stops the worker without resurrecting the row or notifying", async () => {
  const url = "https://sitescan-delete-running.test/";
  // The worker claims the oldest queued job: retire earlier fixtures, and never run someone else's.
  await pool.query("UPDATE sitescan_jobs SET status='failed' WHERE status='queued' AND url LIKE 'https://sitescan-%'");
  const id = await enqueue(1, url, 1, 0);
  expect(
    (await pool.query("SELECT 1 FROM sitescan_jobs WHERE status='queued' AND id<>$1", [id])).rowCount,
  ).toBe(0);
  const before = (notifyUser as any).mock.calls.length;
  let crawled = false;
  await runSiteScanWorker({
    http: vi.fn(),
    pageSpeed: vi.fn(),
    crawl: async (target: string, _cap: number, state: any, checkpoint: any) => {
      crawled = target === url;
      expect((await call("delete", "/api/sitescan/jobs/:id", { params: { id } })).status).toBe(200);
      await checkpoint(state);
      return state;
    },
  } as any);
  expect(crawled).toBe(true);
  expect((await pool.query("SELECT 1 FROM sitescan_jobs WHERE id=$1", [id])).rowCount).toBe(0);
  expect((notifyUser as any).mock.calls.length).toBe(before);
});
it("owners can remove their PDF branding and it never touches another owner's", async () => {
  // White-label branding is Unlimited-only (shared/plans.ts): saving needs the Unlimited plan.
  const users: number[] = [];
  for (const n of [1, 2, 3])
    users.push(
      (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `sitescan-brand-${n}-${randomUUID()}@example.invalid`,
      ])).rows[0].id,
    );
  await pool.query(
    "INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'agency','active'),($2,'agency','active'),($3,'pro','active')",
    users,
  );
  try {
    expect(
      (await call("post", "/api/sitescan/branding", { body: { name: "Fixture denied" }, user: users[2] })).status,
    ).toBe(402);
    for (const user of users.slice(0, 2))
      expect(
        (await call("post", "/api/sitescan/branding", { body: { name: `Fixture ${user}` }, user })).status,
      ).toBe(200);
    expect((await call("delete", "/api/sitescan/branding", { user: null })).status).toBe(401);
    expect((await call("delete", "/api/sitescan/branding", { user: users[0] })).status).toBe(200);
    expect((await call("get", "/api/sitescan/branding", { user: users[0] })).body).toEqual({
      name: "",
      logo: null,
    });
    expect((await call("get", "/api/sitescan/branding", { user: users[1] })).body.name).toBe(
      `Fixture ${users[1]}`,
    );
  } finally {
    await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [users]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  }
});
it("renaming PDF branding without a logo field keeps the saved logo; null removes it", async () => {
  const {
    rows: [{ id: user }],
  } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
    `sitescan-brand-keep-${randomUUID()}@example.invalid`,
  ]);
  // White-label branding is Unlimited-only.
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'agency','active')", [user]);
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=";
  const read = async () => (await call("get", "/api/sitescan/branding", { user })).body;
  try {
    // A first save without a logo field still creates the row with no logo.
    expect((await call("post", "/api/sitescan/branding", { body: { name: "First" }, user })).status).toBe(200);
    expect(await read()).toEqual({ name: "First", logo: null });
    expect((await call("post", "/api/sitescan/branding", { body: { name: "Logo", logo: png }, user })).status).toBe(200);
    const saved = (await read()).logo;
    expect(saved).toMatch(/^data:image\/png;base64,/);
    expect((await call("post", "/api/sitescan/branding", { body: { name: "Renamed" }, user })).status).toBe(200);
    expect(await read()).toEqual({ name: "Renamed", logo: saved });
    expect((await call("post", "/api/sitescan/branding", { body: { name: "No logo", logo: null }, user })).status).toBe(200);
    expect(await read()).toEqual({ name: "No logo", logo: null });
  } finally {
    await pool.query("DELETE FROM subscriptions WHERE user_id=$1", [user]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
  }
});
it("rotates bearer shares and enforces share and email verification expiry", async () => {
  const share = async () => (await call("post", "/api/sitescan/jobs/:id/share", { params: { id: own } })).body.path.split("/").pop();
  const read = (value: string) => call("get", "/api/sitescan/shared/:token", { params: { token: value }, user: null });
  const first = await share(), second = await share();
  expect(first).not.toBe(second);
  expect((await read(first)).status).toBe(404);
  expect((await read(second)).status).toBe(200);
  await pool.query("UPDATE sitescan_jobs SET share_expires=now()-interval '1 second' WHERE id=$1", [own]);
  expect((await read(second)).status).toBe(404);
  await pool.query("UPDATE sitescan_leads SET expires_at=now()-interval '1 second' WHERE email='sitescan-test@example.invalid'");
  const mailObject = (mail.mock.calls as any)[0][0];
  const value = mailObject.text.match(/verify=([a-f0-9]{64})/)[1];
  expect((await call("post", "/api/sitescan/public/verify", { body: { token: value }, user: null })).status).toBe(404);
});
it("gives back the monthly Site Scan when a scan start fails", async () => {
  await pool.query("DELETE FROM growth_budgets WHERE key IN ('sitescan:scan:1','sitescan:bulk:1')");
  const monthly = quotaKey(1, "siteScans");
  const usedBefore = async () =>
    Number(
      (
        await pool.query(
          "SELECT used FROM growth_budgets WHERE key=$1 AND period='0'",
          [monthly],
        )
      ).rows[0]?.used ?? 0,
    );
  // Guarantee room in the allowance; the dev account's real count goes back afterwards.
  const setUsed = (n: number) =>
    pool.query(
      "INSERT INTO growth_budgets(key,period,used) VALUES($1,'0',$2) ON CONFLICT(key,period) DO UPDATE SET used=$2",
      [monthly, n],
    );
  const before = await usedBefore();
  try {
    await setUsed(0);
    // A queue-insert failure (provider/DB outage at start): the monthly unit just
    // reserved must come back, and no job row may exist.
    const worker = await import("./worker");
    const spy = vi
      .spyOn(worker, "enqueue")
      .mockRejectedValueOnce(new Error("enqueue outage fixture"));
    try {
      await expect(
        call("post", "/api/sitescan", {
          body: { url: "https://sitescan-refund-start.test/" },
        }),
      ).rejects.toThrow("enqueue outage fixture");
    } finally {
      spy.mockRestore();
    }
    expect(await usedBefore()).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM sitescan_jobs WHERE url='https://sitescan-refund-start.test/'",
        )
      ).rowCount,
    ).toBe(0);
    // The bulk route refunds the same way when the selected locations are not
    // all owned and synced (the reservation precedes that validation).
    const bulk = await call("post", "/api/sitescan/bulk", {
      body: { locationIds: [2147483647], pageCap: 10, psiPages: 0 },
    });
    expect(bulk.status).toBe(400);
    expect(await usedBefore()).toBe(0);
  } finally {
    await setUsed(before);
  }
});
it("enforces account scan and draft quotas before provider calls", async () => {
  await pool.query("DELETE FROM growth_budgets WHERE key IN ('sitescan:scan:1','sitescan:ai:1')");
  const { takeBudget } = await import("../growth-limits");
  await takeBudget("sitescan:scan:1", 5, 5, 86400_000);
  expect((await call("post", "/api/sitescan", { body: { url: "https://sitescan-quota.test/" } })).status).toBe(429);
  await takeBudget("sitescan:ai:1", 3, 3, 86400_000);
  const before = provider.generate.mock.calls.length;
  expect((await call("post", "/api/sitescan/jobs/:id/plan", { params: { id: own } })).status).toBe(429);
  expect(provider.generate.mock.calls).toHaveLength(before);
});
it("admin lead capture is restricted to platform admins and the configured gate", async () => {
  const { rows: [user] } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`sitescan-admin-${randomUUID()}@example.invalid`]);
  try {
    expect((await call("get", "/api/admin/sitescan-leads", { user: null })).status).toBe(401);
    expect((await call("get", "/api/admin/sitescan-leads", { user: user.id })).status).toBe(403);
    const admin = await call("get", "/api/admin/sitescan-leads");
    if (process.env.ADMIN_GATE_USER && process.env.ADMIN_GATE_PASS) expect(admin.status).toBe(403);
    else {
      expect(admin.status).toBe(200);
      expect(admin.body.leads.some((l: any) => l.email === "sitescan-test@example.invalid")).toBe(true);
      expect(JSON.stringify(admin.body)).not.toMatch(/verify_hash|access_hash/);
    }
  } finally { await pool.query("DELETE FROM users WHERE id=$1", [user.id]); }
});

it("an exhausted user cannot drain the global PageSpeed budget without provider calls", async () => {
  const { takeBudget } = await import("../growth-limits");
  const { parsePage } = await import("./audit");
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'sitescan:psi:%'");
  await takeBudget("sitescan:psi:1", 20, 20, 86400_000);
  await pool.query("UPDATE sitescan_jobs SET status='failed' WHERE status='queued' AND url LIKE 'https://sitescan-%'");
  const url = "https://sitescan-psi-quota.test/";
  const id = await enqueue(1, url, 1, 1);
  const state = emptyState(url);
  state.pages = [parsePage({ url, status: 200, body: "<title>Fixture</title>", headers: {}, redirects: [], bytes: 22 })];
  state.queue = [];
  const pageSpeed = vi.fn();
  await runSiteScanWorker({ crawl: async () => state, http: vi.fn(), pageSpeed });
  expect(pageSpeed).not.toHaveBeenCalled();
  expect((await pool.query("SELECT used FROM growth_budgets WHERE key='sitescan:psi:global'")).rows).toHaveLength(0);
  const { rows: [job] } = await pool.query("SELECT report FROM sitescan_jobs WHERE id=$1", [id]);
  expect(job.report.psi).toHaveLength(2);
  expect(job.report.scores.categories.performance).toBeNull();
});

// ---- Review S-1: a scan that stalled the web process is failed, not leased again (the rules, against Postgres) ----
const quiet = () => pool.query("UPDATE sitescan_jobs SET status='failed' WHERE status IN ('queued','running') AND url LIKE 'https://sitescan-%'");
const scanRow = async (id: string) => (await pool.query("SELECT status,fail_reason,error,abandoned,attempts,cpu_step FROM sitescan_jobs WHERE id=$1", [id])).rows[0];
it("a scan whose worker went away in the middle of a step is failed with the reason and never run again", async () => {
  await quiet();
  const id = await enqueue(null, "https://sitescan-poison.test/", 1, 0);
  await pool.query("UPDATE sitescan_jobs SET status='running',lease_token=$2,lease_until=now()-interval '1 minute',attempts=1,cpu_step='robots.txt' WHERE id=$1", [id, randomUUID()]);
  const crawl = vi.fn(async () => emptyState("https://sitescan-poison.test/"));
  for (let i = 0; i < 3; i++) await runSiteScanWorker({ crawl, http: vi.fn(), pageSpeed: vi.fn() });
  expect(crawl).not.toHaveBeenCalled();
  expect(await scanRow(id)).toMatchObject({ status: "failed", fail_reason: "cpu_stall", attempts: 1, cpu_step: "robots.txt" });
  expect((await scanRow(id)).error).toContain("will not be retried");
});
it("a live scan inside a step (its lease still running) is left alone", async () => {
  await quiet();
  const id = await enqueue(null, "https://sitescan-live.test/", 1, 0);
  await pool.query("UPDATE sitescan_jobs SET status='running',lease_token=$2,lease_until=now()+interval '2 minutes',attempts=1,cpu_step='page x' WHERE id=$1", [id, randomUUID()]);
  const crawl = vi.fn(async () => emptyState("https://sitescan-live.test/"));
  await runSiteScanWorker({ crawl, http: vi.fn(), pageSpeed: vi.fn() });
  expect(crawl).not.toHaveBeenCalled();
  expect(await scanRow(id)).toMatchObject({ status: "running", fail_reason: null });
  await pool.query("UPDATE sitescan_jobs SET status='failed' WHERE id=$1", [id]);
});
it("a scan abandoned between steps is taken again once; a second abandonment fails it", async () => {
  await quiet();
  const id = await enqueue(null, "https://sitescan-abandoned.test/", 1, 0);
  // The worker "goes away": the lease runs out with nobody holding it, and nothing marks the scan failed.
  const vanish = vi.fn(async () => {
    await pool.query("UPDATE sitescan_jobs SET lease_token=$2,lease_until=now()-interval '1 minute' WHERE id=$1", [id, randomUUID()]);
    throw new Error("process gone");
  });
  await runSiteScanWorker({ crawl: vanish as any, http: vi.fn(), pageSpeed: vi.fn() }); // first run, from 'queued'
  expect(await scanRow(id)).toMatchObject({ status: "running", abandoned: 0, attempts: 1 });
  await runSiteScanWorker({ crawl: vanish as any, http: vi.fn(), pageSpeed: vi.fn() }); // taken again: once
  expect(await scanRow(id)).toMatchObject({ status: "running", abandoned: 1, attempts: 2 });
  await runSiteScanWorker({ crawl: vanish as any, http: vi.fn(), pageSpeed: vi.fn() }); // not a third time
  await runSiteScanWorker({ crawl: vanish as any, http: vi.fn(), pageSpeed: vi.fn() });
  expect(vanish).toHaveBeenCalledTimes(2);
  expect(await scanRow(id)).toMatchObject({ status: "failed", fail_reason: "abandoned", attempts: 2 });
});
it("a step that overran fails the scan as a stall, in the row, and it is not leased again", async () => {
  await quiet();
  const id = await enqueue(null, "https://sitescan-slowstep.test/", 1, 0);
  const before = process.env.SITESCAN_STEP_BUDGET_MS;
  process.env.SITESCAN_STEP_BUDGET_MS = "15";
  const slow = vi.fn(async (...a: any[]) => {
    await a[7]("page https://sitescan-slowstep.test/", () => { const end = performance.now() + 50; while (performance.now() < end); });
    return emptyState("https://sitescan-slowstep.test/");
  });
  try {
    for (let i = 0; i < 3; i++) await runSiteScanWorker({ crawl: slow as any, http: vi.fn(), pageSpeed: vi.fn() });
  } finally {
    if (before === undefined) delete process.env.SITESCAN_STEP_BUDGET_MS; else process.env.SITESCAN_STEP_BUDGET_MS = before;
  }
  expect(slow).toHaveBeenCalledTimes(1);
  expect(await scanRow(id)).toMatchObject({ status: "failed", fail_reason: "cpu_stall", cpu_step: "page https://sitescan-slowstep.test/", attempts: 1 });
});
it("a customer's scan is leased before a free scan that was queued earlier", async () => {
  await quiet();
  const free = await enqueue(null, "https://sitescan-free-first.test/", 1, 0);
  await pool.query("UPDATE sitescan_jobs SET created_at=now()-interval '1 hour' WHERE id=$1", [free]);
  const paid = await enqueue(1, "https://sitescan-customer.test/", 1, 0);
  const order: string[] = [];
  const crawl = vi.fn(async (url: string) => { order.push(url); throw new Error("stop here"); });
  await runSiteScanWorker({ crawl: crawl as any, http: vi.fn(), pageSpeed: vi.fn() });
  await runSiteScanWorker({ crawl: crawl as any, http: vi.fn(), pageSpeed: vi.fn() });
  expect(order).toEqual(["https://sitescan-customer.test/", "https://sitescan-free-first.test/"]);
  expect((await scanRow(paid)).fail_reason).toBe("error");
});
it("the free public scan is refused while free scans are already waiting, and per website", async () => {
  const { FREE_SCAN_LIMITS, freeScanGate } = await import("./routes");
  await quiet();
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'sitescan:lead-%'");
  const who = (n: number) => ({ ip: "s1-ip-" + n, email: "s1-mail-" + n, host: "s1-host" });
  for (let i = 0; i < FREE_SCAN_LIMITS.perSiteDay; i++) expect(await freeScanGate(who(i))).toBe("ok");
  expect(await freeScanGate(who(99))).toBe("limit"); // the same website, whoever asks
  const ids: string[] = [];
  for (let i = 0; i < FREE_SCAN_LIMITS.waiting; i++) ids.push(await enqueue(null, `https://sitescan-waiting-${i}.test/`, 1, 0));
  const start = await call("post", "/api/sitescan/public/start", { user: null, body: { url: "https://sitescan-one-more.test/", email: "sitescan-s1@example.invalid", captchaToken: "fixture" } });
  expect(start.status).toBe(429);
  expect(start.body.message).toMatch(/busy/);
  expect((await pool.query("SELECT 1 FROM sitescan_jobs WHERE url='https://sitescan-one-more.test/'")).rowCount).toBe(0);
  await pool.query("UPDATE sitescan_jobs SET status='failed' WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE 'sitescan:lead-%'");
});
