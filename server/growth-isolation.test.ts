import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(new URL(process.env.CRM_TEST_BASE_URL!).port) + 3;
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
const reviewTokens: string[] = [];
const users: number[] = [], scans: number[] = [], queries: number[] = [], sids: string[] = [];
let a: string, b: string;
const secret = "growth-isolation-session-secret";
async function account() {
  const { rows: [user] } = await pool.query("insert into users(email,display_name,email_verified) values($1,'Audit isolation',true) returning id", [`${randomUUID()}@example.invalid`]);
  users.push(user.id);
  const sid = randomUUID(); sids.push(sid);
  await pool.query('insert into session(sid,sess,expire) values($1,$2,now()+interval \'1 hour\')', [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}
async function api(path: string, cookie = "", method = "GET", body?: any) {
  return fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a3") throw new Error("Requires lane a3 DB");
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret, EMAIL_FORCE_SINK: "true", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const log = createWriteStream(`tmp/growth-test-${port}.log`);
  child.stdout!.pipe(log); child.stderr!.pipe(log);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("Growth test server exited");
    try { if ((await api("/api/auth/me")).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Growth test server did not start");
  a = await account(); b = await account();
  for (const userId of [users[0], users[1], null]) {
    const { rows: [scan] } = await pool.query("insert into ranking_grid_scans(user_id,business_name,place_id,lat,lon,keyword) values($1,'Isolation fixture','fixture','0','0','fixture') returning id", [userId]);
    scans.push(scan.id);
    const { rows: [query] } = await pool.query("insert into search_queries(user_id,search_type,search_value) values($1,'address','Isolation fixture') returning id", [userId]);
    queries.push(query.id);
  }
}, 90_000);
afterAll(async () => {
  if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await pool.query("delete from ranking_grid_scans where id=any($1::int[])", [scans]);
  await pool.query("delete from search_results where query_id=any($1::int[])", [queries]);
  await pool.query("delete from search_queries where id=any($1::int[])", [queries]);
  await pool.query("delete from review_requests where token=any($1::text[])", [reviewTokens]);
  await pool.query("delete from review_recipient_preferences where user_id=any($1::int[])", [users]);
  await pool.query("delete from users where id=any($1::int[])", [users]);
  await pool.query("delete from session where sid=any($1::text[])", [sids]);
  await pool.end();
});
describe("ranking and permit owner isolation", () => {
  it("denies logged-out access to every protected route family", async () => {
    for (const [path, method] of [
      ["/api/ranking-grid/scans", "GET"], ["/api/ranking-grid/map/1", "GET"],
      ["/api/search", "POST"], ["/api/search-queries", "GET"], ["/api/search-queries", "DELETE"],
      ["/api/search-results/recent", "GET"], ["/api/search/live/missing", "GET"],
      ["/api/scrape-schedules", "GET"], ["/api/scrape-schedules", "POST"],
      ["/api/scrape-schedules/1", "PATCH"], ["/api/scrape-schedules/1", "DELETE"],
      ["/api/scrape/jobs", "GET"], ["/api/permit-details/1", "POST"],
    ]) expect((await api(path, "", method)).status, path).toBe(401);
  });
  it("isolates lists, detail, map, deletion and legacy rows across two accounts", async () => {
    for (const [cookie, index] of [[a, 0], [b, 1]] as const) {
      expect((await (await api("/api/ranking-grid/scans", cookie)).json()).map((r: any) => r.id)).toEqual([scans[index]]);
      expect((await api(`/api/ranking-grid/scans/${scans[index]}`, cookie)).status).toBe(200);
      for (const other of [scans[1 - index], scans[2]]) {
        for (const [path, method] of [[`/api/ranking-grid/scans/${other}`, "GET"], [`/api/ranking-grid/scans/${other}`, "DELETE"], [`/api/ranking-grid/map/${other}`, "GET"]]) {
          expect((await api(path, cookie, method)).status).toBe(404);
        }
      }
      expect((await (await api("/api/search-queries", cookie)).json()).map((r: any) => r.id)).toEqual([queries[index]]);
      for (const other of [queries[1-index], queries[2]]) {
        expect((await api(`/api/search-results/${other}`, cookie)).status).toBe(404);
        expect((await api(`/api/search-queries/${other}`, cookie, "DELETE")).status).toBe(404);
      }
      expect((await api("/api/scrape-schedules", cookie)).status).toBe(403);
      expect((await api("/api/scrape-schedules", cookie, "POST", {})).status).toBe(403);
    }
    expect((await api("/api/search-queries", a, "DELETE")).status).toBe(200);
    expect((await (await api("/api/search-queries", b)).json()).map((r: any) => r.id)).toEqual([queries[1]]);
  });
});

describe("review funnel provenance", () => {
  it("separates Google link opens, private feedback and flow completion", async () => {
    const token = randomUUID(); reviewTokens.push(token);
    await pool.query("insert into review_requests(user_id,client_name,client_email,google_profile_url,token) values($1,'Fixture','fixture@example.invalid','https://www.google.com/',$2)", [users[0], token]);
    expect((await api(`/api/review/${token}/google-link-opened`, "", "POST", {})).status).toBe(200);
    expect((await api(`/api/review/${token}/feedback`, "", "POST", { rating: 2 })).status).toBe(200);
    expect((await api(`/api/review/${token}/mark-reviewed`, "", "POST", {})).status).toBe(200);
    const { rows: [row] } = await pool.query("select * from review_requests where token=$1", [token]);
    expect(row.google_link_opened).toBe(true);
    expect(row.review_submitted).toBe(false);
    expect(row.status).toBe("negative_feedback");
  });
});

describe("recipient-wide opt-out", () => {
  it("suppresses future requests for that contractor and requires explicit customer resubscribe", async () => {
    const tokens = [randomUUID(), randomUUID(), randomUUID()]; reviewTokens.push(...tokens);
    for (let i = 0; i < 3; i++) await pool.query("insert into review_requests(user_id,client_name,client_email,google_profile_url,token) values($1,'Fixture',$2,'https://www.google.com/',$3)", [users[i === 2 ? 1 : 0], i === 1 ? " SUPPRESS@example.invalid " : "suppress@example.invalid", tokens[i]]);
    expect((await api(`/api/review/${tokens[0]}/unsubscribe`, "", "POST", {})).status).toBe(200);
    const { rows } = await pool.query("select token,unsubscribed from review_requests where token=any($1::text[])", [tokens]);
    expect(rows.find(r => r.token === tokens[1]).unsubscribed).toBe(true);
    expect(rows.find(r => r.token === tokens[2]).unsubscribed).toBe(false);
    expect((await api("/api/reviews/create", a, "POST", { clientName: "Fixture", clientEmail: "suppress@example.invalid" })).status).toBe(409);
    expect((await api(`/api/review/${tokens[0]}/resubscribe`, "", "POST", {})).status).toBe(400);
    expect((await api(`/api/review/${tokens[0]}/resubscribe`, a, "POST", { confirm: true })).status).toBe(403);
    expect((await api(`/api/review/${tokens[0]}/resubscribe`, "", "POST", { confirm: true })).status).toBe(200);
    expect((await (await api(`/api/review/${tokens[0]}/unsubscribe-info`)).json()).unsubscribed).toBe(false);
    expect((await pool.query("select unsubscribed from review_requests where token=$1", [tokens[1]])).rows[0].unsubscribed).toBe(true);
  });
});

describe("password reset session revocation and auth budgets", () => {
  it("revokes an existing authenticated session and rejects token replay", async () => {
    const cookie = await account(), userId = users[users.length - 1], token = randomUUID();
    await pool.query("update users set reset_token=$1, reset_expiry=$3 where id=$2", [token, userId, new Date(Date.now()+3600000).toISOString()]);
    expect((await (await api("/api/auth/me", cookie)).json()).id).toBe(userId);
    expect((await api("/api/auth/reset-password", "", "POST", { token, password: "Fixture-password-123" })).status).toBe(200);
    expect(await (await api("/api/auth/me", cookie)).json()).toBeNull();
    expect((await api("/api/auth/reset-password", "", "POST", { token, password: "Fixture-password-456" })).status).toBe(400);
  });
  it("rate limits repeated account attempts across signup/login/forgot-password", async () => {
    const email = `${randomUUID()}@example.invalid`;
    for (let i=0;i<10;i++) expect((await api("/api/auth/login", "", "POST", { email, password: "incorrect" })).status).toBe(401);
    expect((await api("/api/auth/forgot-password", "", "POST", { email })).status).toBe(429);
    expect((await api("/api/auth/signup", "", "POST", { email, password: "Fixture-password-123" })).status).toBe(429);
  });
});
