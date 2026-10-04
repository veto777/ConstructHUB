import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import pg from "pg";

// Click Guard dashboard honesty: the "Blocked IPs" tile sits in the stat grid
// under the Daily / 7d / 30d range buttons, so it must count blocks made inside
// the selected window — not all active blocks (owner 2026-10-04: numbers that
// never move with the range are exactly the bug class to catch). The
// Traffic-signals blocked list stays all-time. Same child-server pattern as
// plan-gates.test.ts (no dev bypass, no Places key, no Stripe).
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(new URL(process.env.CRM_TEST_BASE_URL!).port) + 6;
const base = `http://127.0.0.1:${port}`;
const secret = "click-guard-analytics-session-secret";
const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
const users: number[] = [], sids: string[] = [];
let child: ChildProcess;

type Account = { id: number; cookie: string };
async function account(plan: string): Promise<Account> {
  const { rows: [user] } = await pool.query("insert into users(email,display_name,email_verified) values($1,'P-ClickGuard analytics',true) returning id", [`p-cgan-${randomUUID()}@example.invalid`]);
  users.push(user.id);
  await pool.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id) values($1,$2,'active',$3)", [user.id, plan, `sub_p_${randomUUID()}`]);
  const sid = randomUUID(); sids.push(sid);
  await pool.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return { id: user.id, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
}
async function api(path: string, who: Account, method = "GET", body?: any) {
  const r = await fetch(base + path, { method, headers: { cookie: who.cookie, "content-type": "application/json", "x-forwarded-for": testIp }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json };
}
const iso = (d: Date) => d.toISOString();

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("click-guard analytics window (auxiliary child server)", () => {
  let me: Account, domainId: number;
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: { ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/click-guard-analytics-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Click-guard analytics test server exited");
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Click-guard analytics test server did not start");
    me = await account("pro");
    const dom = await api("/api/click-guard/domains", me, "POST", { domain: `p-cgan-${randomUUID()}.example.com` });
    expect(dom.status).toBe(200);
    domainId = dom.body.id;
    // One block made now (through the app), one recorded 40 days ago.
    expect((await api(`/api/click-guard/domains/${domainId}/block`, me, "POST", { ipAddress: testIp, reason: "window test (recent)" })).status).toBe(200);
    await pool.query("insert into blocked_ips(domain_id,ip_address,reason,is_active,source,blocked_at) values($1,$2,'window test (old)',true,'manual',now()-interval '40 days')", [domainId, `198.18.99.${randomInt(1, 255)}`]);
  }, 90000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    if (domainId) {
      await pool.query("delete from blocked_ips where domain_id=$1", [domainId]);
      await pool.query("delete from click_visits where domain_id=$1", [domainId]);
      await pool.query("delete from vpn_visits where domain_id=$1", [domainId]);
      await pool.query("delete from tracked_domains where id=$1", [domainId]);
    }
    await pool.query("delete from growth_budgets where key like any($1)", [users.map(u => `quota:user:${u}:%`)]);
    await pool.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await pool.query("delete from users where id=any($1::int[])", [users]);
    await pool.query("delete from session where sid=any($1::text[])", [sids]);
    await pool.end();
  });

  it("counts Blocked IPs inside the selected range, like its neighbor tiles", async () => {
    const now = Date.now();
    const win7 = await api(`/api/click-guard/domains/${domainId}/analytics?start=${iso(new Date(now - 7 * 864e5))}&end=${iso(new Date(now))}`, me);
    expect(win7.status).toBe(200);
    expect(win7.body.blockedIps).toBe(1);
    const win120 = await api(`/api/click-guard/domains/${domainId}/analytics?start=${iso(new Date(now - 120 * 864e5))}&end=${iso(new Date(now))}`, me);
    expect(win120.body.blockedIps).toBe(2);
    // Narrow the window so even the recent block falls outside.
    const win1h = await api(`/api/click-guard/domains/${domainId}/analytics?start=${iso(new Date(now - 36e5))}&end=${iso(new Date(now - 3e5))}`, me);
    expect(win1h.body.blockedIps).toBe(0);
  });

  it("keeps the Traffic-signals blocked list all-time", async () => {
    const list = await api(`/api/click-guard/domains/${domainId}/blocked`, me);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
  });
});
