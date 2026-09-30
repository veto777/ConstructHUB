import { it, expect, vi, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureSiteScanSchema } from "./schema";
import { registerSiteScanRoutes, hashToken } from "./routes";
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
    !new URL(process.env.DATABASE_URL!).pathname.endsWith("constructhub_dev_a5")
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
    http: vi.fn(async () => new Response('{"success":true}')) as any,
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
