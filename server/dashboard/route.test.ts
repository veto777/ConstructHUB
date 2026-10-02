/**
 * GET /api/dashboard over HTTP, against a child server started from THIS
 * checkout (so the route under test is this branch's, not whatever the lane's
 * shared dev server runs). Real sessions, real development database, no dev
 * auth bypass, no Stripe, no outbound providers.
 *
 * Port: DASH_TEST_PORT, else the first free port in 8240–8260.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import type { DashboardPayload } from "@shared/dashboard";
import { assertDevDatabase, cleanupDashboardAccounts, seedDashboardAccounts, type Seeded } from "./test-seed";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const secret = `dash-route-${randomUUID()}`;
const sids: string[] = [];
let child: ChildProcess | undefined;
let base = "";
let s: Seeded | undefined;

const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const srv = createServer().once("error", () => resolve(false)).once("listening", () => srv.close(() => resolve(true)));
  srv.listen(port, "127.0.0.1");
});
async function pickPort(): Promise<number> {
  if (process.env.DASH_TEST_PORT) return Number(process.env.DASH_TEST_PORT);
  for (let p = 8240; p <= 8260; p++) if (await portFree(p)) return p;
  throw new Error("No free port in 8240–8260");
}

async function session(userId: number, extra: Record<string, unknown> = {}): Promise<string> {
  const sid = randomUUID(); sids.push(sid);
  await pool.query("INSERT INTO session(sid, sess, expire) VALUES($1,$2, now() + interval '1 hour')",
    [sid, JSON.stringify({ cookie: { maxAge: 3_600_000 }, passport: { user: userId }, ...extra })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

async function get(path: string, cookie?: string) {
  const r = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, body: body as DashboardPayload & { message?: string } };
}
const metric = (p: DashboardPayload, tile: string, key: string) =>
  p.tiles.find((t) => t.key === tile)?.metrics.find((m) => m.key === key)?.value;

describe("GET /api/dashboard (child server from this checkout)", () => {
  beforeAll(async () => {
    assertDevDatabase();
    s = await seedDashboardAccounts(pool);
    const port = await pickPort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false",
        SESSION_SECRET: secret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", AI_MODEL: "truthcode-api",
        VITE_FORCE_PORTAL: "false", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/dashboard-route-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    for (let i = 0; i < 180; i++) {
      if (child.exitCode !== null) throw new Error(`Dashboard test server exited (see tmp/dashboard-route-${port}.log)`);
      try { if ((await fetch(base + "/api/auth/me")).status < 500) return; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Dashboard test server did not start");
  }, 120_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await pool.query("DELETE FROM session WHERE sid = ANY($1::text[])", [sids]);
    await cleanupDashboardAccounts(pool, s);
    await pool.end();
  });

  it("is a session route: 401 when signed out", async () => {
    const r = await get("/api/dashboard");
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ message: "Not authenticated" });
  });

  it("answers the signed-in account's real numbers, then from the 60 s cache", async () => {
    const cookie = await session(s!.agency);
    const first = await get("/api/dashboard", cookie);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.body).toMatchObject({ fixture: false, cached: false, account: { plan: "agency", firstName: "Dana" } });
    expect(metric(first.body, "gbp", "locations")).toBe(2);
    expect(metric(first.body, "crm", "openEstimates")).toBe(1);

    const second = await get("/api/dashboard", cookie);
    expect(second.body.cached).toBe(true);
    expect(second.body.generatedAt).toBe(first.body.generatedAt);

    // Refresh: one fresh build, then throttled back to the cache for 10 s.
    const fresh = await get("/api/dashboard?fresh=1", cookie);
    expect(fresh.body.cached).toBe(false);
    expect(fresh.body.generatedAt >= first.body.generatedAt).toBe(true);
    const again = await get("/api/dashboard?fresh=1", cookie);
    expect(again.body.cached).toBe(true);
    expect(again.body.generatedAt).toBe(fresh.body.generatedAt);
  });

  it("a session pinned to another org gets that org's CRM numbers (its own cache entry)", async () => {
    const cookie = await session(s!.agency, { activeOrgId: s!.otherOrg });
    const r = await get("/api/dashboard", cookie);
    expect(r.body.cached).toBe(false);
    expect(metric(r.body, "crm", "openEstimates")).toBe(4);
    expect(metric(r.body, "gbp", "locations")).toBe(2);
  });

  it("Starter: Cloudflare locked to Agency, and no CRM org is created", async () => {
    const orgs = async () => Number((await pool.query("SELECT count(*) n FROM crm_orgs")).rows[0].n);
    const before = await orgs();
    const r = await get("/api/dashboard", await session(s!.starter));
    expect(r.status).toBe(200);
    expect(await orgs()).toBe(before);
    expect(r.body.tiles.find((t) => t.key === "cloudflare")).toMatchObject({ status: "locked", entitled: false, requiredPlan: "agency", metrics: [] });
    expect(r.body.tiles.find((t) => t.key === "crm")).toMatchObject({ status: "empty", cta: { href: "/crm-app" } });
  });

  it("never another account's numbers — not even for an agency teammate acting in the owner's workspace", async () => {
    const other = await get("/api/dashboard", await session(s!.other));
    expect(metric(other.body, "gbp", "locations")).toBe(3);
    expect(metric(other.body, "clickGuard", "suspicious30d")).toBe(5);
    // The teammate's session carries the agency owner's workspace; the dashboard is still the teammate's own.
    const tm = await get("/api/dashboard", await session(s!.teammate, { agencyOwner: s!.agency }));
    expect(tm.status).toBe(200);
    expect(tm.body.account.plan).toBeNull();
    // Pages the workspace shares with them open (no "See plans" upsell), with none of the owner's numbers.
    expect(tm.body.tiles.find((t) => t.key === "gbp")).toMatchObject({ status: "empty", metrics: [], cta: { label: "Open", href: "/locations" } });
    expect(tm.body.tiles.find((t) => t.key === "cloudflare")?.status).toBe("locked");
    expect(tm.body.recent).toEqual([]);
    // Without the workspace in the session, the same teammate is just their own (planless) account.
    const own = await get("/api/dashboard", await session(s!.teammate));
    expect(own.body.tiles.find((t) => t.key === "gbp")?.status).toBe("locked");
  });

  it("keeps the sample payload for client-shape tests in development only", async () => {
    const r = await get("/api/dashboard?fixture=new", await session(s!.none));
    expect(r.body).toMatchObject({ fixture: true, account: { plan: "starter" } });
  });
});
