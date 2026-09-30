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
  await Promise.all([runSchedules(), runSchedules()]);
  const { rows: jobs } = await pool.query(
    "SELECT id FROM sitescan_jobs WHERE url='https://sitescan-fixture.test/' AND status='queued'",
  );
  expect(jobs).toHaveLength(1);
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
