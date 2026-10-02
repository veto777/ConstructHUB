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
import { attentionSignature } from "@shared/dashboard-prefs";
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
/** A write from our own page: JSON + this server's Origin (unless told otherwise). */
async function send(method: "PUT" | "DELETE", path: string, cookie: string, body?: unknown, opts: { origin?: string | null; type?: string } = {}) {
  const headers: Record<string, string> = { cookie };
  const origin = opts.origin === undefined ? base : opts.origin;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = opts.type ?? "application/json";
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
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

  it("dashboard prefs writes: session, Origin and JSON required; bad input is a 400", async () => {
    const cookie = await session(s!.starter);
    expect((await send("PUT", "/api/dashboard/layout", "", { layout: {} })).status).toBe(401);
    expect((await send("PUT", "/api/dashboard/layout", cookie, { layout: {} }, { origin: null })).status).toBe(403);
    expect((await send("PUT", "/api/dashboard/layout", cookie, { layout: {} }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send("DELETE", "/api/dashboard/dismissals", cookie, undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send("PUT", "/api/dashboard/dismissals", cookie, "items=1", { type: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await send("PUT", "/api/dashboard/layout", cookie, { layout: { order: "gbp" } })).status).toBe(400);
    expect((await send("PUT", "/api/dashboard/dismissals", cookie, { items: [{ key: "x y", value: "1" }] })).status).toBe(400);
    expect((await send("DELETE", "/api/dashboard/dismissals/" + encodeURIComponent("no way!"), cookie)).status).toBe(400);
  });

  it("a saved layout is applied at once (the cached answer is forgotten) and only for that user", async () => {
    const cookie = await session(s!.agency);
    const before = await get("/api/dashboard", cookie);
    expect(before.body.layout.keepGroups).toBe(true);
    const again = await get("/api/dashboard", cookie);
    expect(again.body.cached).toBe(true);

    const order = ["permits", ...before.body.layout.order.filter((k) => k !== "permits")];
    const saved = await send("PUT", "/api/dashboard/layout", cookie, { layout: { order, hidden: ["reviews", "unknownTile"], keepGroups: false, sections: { gabe: false } } });
    expect(saved.status).toBe(200);
    expect(saved.body.layout).toMatchObject({ hidden: ["reviews"], keepGroups: false, sections: { gabe: false, needs: true } });

    const after = await get("/api/dashboard", cookie);
    expect(after.body.cached).toBe(false);                       // rebuilt, not the old cached answer
    expect(after.body.tiles[0].key).toBe("permits");
    expect(after.body.tiles.some((t) => t.key === "reviews")).toBe(false);
    expect(after.body.hiddenTiles).toEqual([{ key: "reviews", entitled: true }]);
    expect(after.body.layout.sections.gabe).toBe(false);

    // Another account (and the same person's other account) keeps its own.
    const other = await get("/api/dashboard", await session(s!.other));
    expect(other.body.tiles[0].key).toBe("gbp");
    expect(other.body.hiddenTiles).toEqual([]);

    // Reset: the default again, at once.
    const reset = await send("DELETE", "/api/dashboard/layout", cookie);
    expect(reset.status).toBe(200);
    const back = await get("/api/dashboard", cookie);
    expect(back.body.cached).toBe(false);
    expect(back.body.tiles[0].key).toBe("gbp");
    expect(back.body.layout.keepGroups).toBe(true);
    expect((await pool.query("SELECT count(*)::int n FROM dashboard_prefs WHERE user_id=$1", [s!.agency])).rows[0].n).toBe(0);
  });

  it("clearing an item hides it on the next answer, even from the cache; restoring brings it back", async () => {
    const cookie = await session(s!.agency);
    const first = await get("/api/dashboard", cookie);
    const target = first.body.attention.find((i) => i.key === "notifications")!;
    expect(target).toBeTruthy();
    const others = first.body.attention.length - 1;

    // A value that is not the current one hides nothing. The cached answer is older than the clear, so it
    // never judges it; a fresh answer forgets it.
    const count = async () => (await pool.query("SELECT count(*)::int n FROM dashboard_dismissals WHERE user_id=$1", [s!.agency])).rows[0].n;
    expect((await send("PUT", "/api/dashboard/dismissals", cookie, { items: [{ key: "notifications", value: "999" }] })).status).toBe(200);
    const wrong = await get("/api/dashboard", cookie);
    expect(wrong.body.cached).toBe(true);
    expect(wrong.body.attention.some((i) => i.key === "notifications")).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(await count()).toBe(1);
    await send("DELETE", "/api/dashboard/layout", cookie); // forgets the cached answer: the next load is rebuilt
    const rebuilt = await get("/api/dashboard", cookie);
    expect(rebuilt.body.cached).toBe(false);
    await new Promise((r) => setTimeout(r, 200)); // the stale row is dropped in the background
    expect(await count()).toBe(0);

    const done = await send("PUT", "/api/dashboard/dismissals", cookie, { items: [{ key: "notifications", value: attentionSignature(target) }] });
    expect(done.body).toEqual({ ok: true, cleared: 1 });
    const hidden = await get("/api/dashboard", cookie);
    expect(hidden.body.cached).toBe(true);                        // no rebuild needed
    expect(hidden.body.attention.some((i) => i.key === "notifications")).toBe(false);
    expect(hidden.body.attention).toHaveLength(others);
    expect(hidden.body.cleared).toMatchObject([{ key: "notifications", until: null, signature: String(target.value) }]);

    // Never another user's.
    const teammate = await get("/api/dashboard", await session(s!.other));
    expect(teammate.body.cleared).toEqual([]);

    // The number changes (one more unread alert): it comes back.
    await pool.query("INSERT INTO user_notifications(user_id, kind, title, severity) VALUES($1,'gbp.new_review','Another','info')", [s!.agency]);
    await send("DELETE", "/api/dashboard/layout", cookie); // forgets the cached answer: the next load is rebuilt
    const changed = await get("/api/dashboard", cookie);
    expect(changed.body.cached).toBe(false);
    expect(changed.body.attention.find((i) => i.key === "notifications")?.value).toBe(Number(target.value) + 1);
    expect(changed.body.cleared).toEqual([]);

    // Snooze, then restore one; Clear all, then restore all.
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const current = changed.body.attention.find((i) => i.key === "notifications")!;
    await send("PUT", "/api/dashboard/dismissals", cookie, { items: [{ key: "notifications", value: String(current.value), until }] });
    const snoozed = await get("/api/dashboard", cookie);
    expect(snoozed.body.cleared).toMatchObject([{ key: "notifications", until }]);
    expect((await send("DELETE", "/api/dashboard/dismissals/notifications", cookie)).body).toEqual({ ok: true, restored: 1 });
    expect((await get("/api/dashboard", cookie)).body.attention.some((i) => i.key === "notifications")).toBe(true);

    const { attention: all, scope } = (await get("/api/dashboard", cookie)).body;
    await send("PUT", "/api/dashboard/dismissals", cookie, { items: all.map((i) => ({ key: i.key, value: attentionSignature(i) })), scope });
    const cleared = await get("/api/dashboard", cookie);
    expect(cleared.body.attention).toEqual([]);
    expect(cleared.body.cleared).toHaveLength(all.length);
    expect((await send("DELETE", `/api/dashboard/dismissals?scope=${scope}`, cookie)).body).toEqual({ ok: true, restored: all.length });
    expect((await get("/api/dashboard", cookie)).body.attention).toHaveLength(all.length);
  });

  it("a CRM item cleared in one org stays cleared there after viewing another org", async () => {
    const own = await session(s!.agency);
    const pinned = await session(s!.agency, { activeOrgId: s!.otherOrg });
    await send("DELETE", "/api/dashboard/layout", own); // a rebuilt answer for each org
    const inOwn = (await get("/api/dashboard", own)).body;
    const inOther = (await get("/api/dashboard", pinned)).body;
    expect(inOwn.scope).toBe(s!.agencyOrg);
    expect(inOther.scope).toBe(s!.otherOrg);
    const crmItem = inOwn.attention.find((i) => /^(crm|crmLeads|crmSchedule|texting)\./.test(i.key));
    expect(crmItem, "the seeded agency org raises a CRM item").toBeTruthy();
    await send("PUT", "/api/dashboard/dismissals", own, { items: [{ key: crmItem!.key, value: attentionSignature(crmItem!) }], scope: inOwn.scope });
    // Viewing the other org (another number, or none) neither shows it as cleared nor forgets it.
    const other = (await get("/api/dashboard", pinned)).body;
    expect(other.cleared.some((i) => i.key === crmItem!.key)).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    const back = (await get("/api/dashboard", own)).body;
    expect(back.cleared.map((i) => i.key)).toContain(crmItem!.key);
    expect(back.attention.some((i) => i.key === crmItem!.key)).toBe(false);
    // Restore all in the other org leaves it; a bad scope is refused.
    expect((await send("DELETE", `/api/dashboard/dismissals?scope=${s!.otherOrg}`, pinned)).body).toEqual({ ok: true, restored: 0 });
    expect((await send("DELETE", "/api/dashboard/dismissals?scope=bad%20scope", own)).status).toBe(400);
    expect((await send("DELETE", `/api/dashboard/dismissals/${encodeURIComponent(crmItem!.key)}?scope=${s!.agencyOrg}`, own)).body).toEqual({ ok: true, restored: 1 });
  });

  it("'Payment past due' can only be snoozed", async () => {
    const cookie = await session(s!.agency);
    expect((await send("PUT", "/api/dashboard/dismissals", cookie, { items: [{ key: "billing", value: "Agency" }] })).status).toBe(400);
  });

  it("keeps the sample payload for client-shape tests in development only", async () => {
    const r = await get("/api/dashboard?fixture=new", await session(s!.none));
    expect(r.body).toMatchObject({ fixture: true, account: { plan: "starter" } });
  });
});
