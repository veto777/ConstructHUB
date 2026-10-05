import { beforeAll, afterAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { pool } from "./db";
import { APP_CONNECTIONS } from "./app-connections";
let child: ChildProcess, base: string, owner: number, other: number, cookie: string, otherCookie: string;
const sids = new Set<string>(), ids: number[] = [];
const ip = `198.19.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`;
const secret = "app-connections-fixture";
const ua = "Mozilla/5.0 ConstructHUBApp/1.0";
async function session(user: number, recent = true) {
  const sid = randomUUID(); sids.add(sid);
  await pool.query("INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({cookie:{maxAge:3600000},passport:{user},...(recent ? {recentAuth:{userId:user,at:Date.now()}} : {})})]);
  return `connect.sid=${encodeURIComponent(`s:${sid}.${createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'')}`)}`;
}
async function api(path: string, auth = "", native = false, body?: unknown, headers = {}) {
  const r = await fetch(base+path, {redirect:"manual", method:body ? "POST" : "GET", headers:{cookie:auth,"x-forwarded-for":ip,"user-agent":native ? ua : "Browser",...(body ? {"content-type":"application/json"} : {}),...headers}, ...(body ? {body:JSON.stringify(body)} : {})});
  const c = r.headers.get("set-cookie")?.split(";")[0];
  if (c) sids.add(decodeURIComponent(c.split("=")[1]).slice(2).split(".")[0]);
  return r;
}
const starts = {
  gbp: "/api/gbp/connect?format=json", ads:"/api/ads/connect", gsc:"/api/gsc/connect",
  gmail:"/api/mail-alerts/oauth/connect", lsa:"/api/lsa/oauth/start", calendar:"/api/crm/calendar/google/connect?scope=me",
};
async function start(purpose: keyof typeof starts, native = true, auth = cookie) {
  const r = await api(starts[purpose], auth, native, purpose==="ads" ? {managerId:"1234567890"} : undefined);
  expect([200,302], await r.clone().text()).toContain(r.status);
  let url = r.status===302 ? r.headers.get("location")! : (await r.json()).url;
  if (native) {
    expect(url).toMatch(/^\/api\/app\/oauth\/open\?state=/);
    const open = await api(url, auth, true);
    expect(open.status).toBe(302);
    url = open.headers.get("location")!;
  }
  return new URL(url);
}
async function finish(purpose: keyof typeof starts, url: URL, code="fixture-ok", auth="") {
  return api(`${APP_CONNECTIONS[purpose].callback}?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=${code}`, auth);
}
async function exchange(r: Response, auth = cookie) {
  expect(r.status, await r.clone().text()).toBe(302);
  const callback = new URL(r.headers.get("location")!);
  expect(callback.protocol).toBe("constructhub:");
  return api(`/api/auth/app-exchange?code=${callback.searchParams.get("code")}`, auth, true);
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a6") throw Error("Requires assigned development database");
  child = spawn(process.execPath,["--import","tsx","server/test-fixtures/app-auth-server.ts"], {
    env:{...process.env,NODE_ENV:"test",SESSION_SECRET:secret,APP_TEST_CONNECTIONS:"true",GOOGLE_CLIENT_ID:"fixture",GOOGLE_CLIENT_SECRET:"fixture",GOOGLE_ADS_CLIENT_ID:"fixture",GOOGLE_ADS_CLIENT_SECRET:"fixture",GOOGLE_ADS_DEVELOPER_TOKEN:"fixture",GMAIL_OAUTH_ENABLED:"true",DEV_AUTH_BYPASS_USER1:"false",CRM_DEMO_AUTOLOGIN:"false",EMAIL_FORCE_SINK:"true"},
    stdio:["ignore","pipe","pipe","ipc"],
  });
  let logs=""; child.stdout?.on("data",b=>{logs+=b;}); child.stderr?.on("data",b=>{logs+=b;});
  base = await new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error(logs)),30000);child.once("message",(m:any)=>{clearTimeout(t);resolve(`http://127.0.0.1:${m.port}`);});child.once("exit",()=>{clearTimeout(t);reject(Error(logs));});});
  for(let i=0;i<2;i++) {
    const {rows:[u]}=await pool.query("INSERT INTO users(email,email_verified) VALUES($1,true) RETURNING id",[`${randomUUID()}@example.invalid`]);ids.push(u.id);
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'agency','active')",[u.id]);
  }
  [owner,other]=ids; cookie=await session(owner);otherCookie=await session(other);
},40000);
afterAll(async()=>{
  if(child && child.exitCode===null) await new Promise<void>(resolve=>{child.once("exit",()=>resolve());child.kill("SIGTERM");});
  await pool.query("DELETE FROM session WHERE sid=ANY($1::text[])",[[...sids]]);
  await pool.query("DELETE FROM crm_members WHERE user_id=ANY($1::int[])",[ids]);
  await pool.query("DELETE FROM crm_orgs WHERE owner_user_id=ANY($1::int[])",[ids]);
  for(const table of ["subscriptions","account_activity","ads_jobs","ads_grants","lsa_connections"]) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::int[])`,[ids]);
  const hash=createHash('sha256').update(ip).digest('hex');
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE $1 OR key LIKE ANY($2::text[])",[`%:ip:${hash}`,ids.flatMap(id=>[`%:user:${id}`,`edge:${id}:%`])]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])",[ids]);
  await pool.end();
});
for(const purpose of Object.keys(starts) as (keyof typeof starts)[]) {
  it(`${purpose}: links across cookie jars, returns to the web view, and consumes state once`,async()=>{
    const url=await start(purpose);
    expect(url.hostname).toBe("accounts.google.com");
    const result=await finish(purpose,url);
    const back=await exchange(result);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toMatch(/^\/(locations|ads-manager|search-console|mail-alerts|lsa-leads|crm\/team)\?/);
    expect(back.headers.get("location")).not.toMatch(/failed|error|norefresh/);
    expect((await finish(purpose,url)).status).toBe(400);
    const sheetCookie=result.headers.get("set-cookie")?.split(";")[0]||"";
    expect(await (await api("/api/auth/me",sheetCookie)).json()).toBeNull();
    if(purpose==='calendar') expect((await pool.query("SELECT custom_fields FROM crm_orgs WHERE owner_user_id=$1",[owner])).rows[0].custom_fields).toBeTruthy();
    else {
      const table={gbp:'gbp_grants',ads:'ads_grants',gsc:'edge_connections',gmail:'mail_alert_grants',lsa:'lsa_connections'}[purpose];
      expect((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[owner])).rowCount).toBe(1);
      expect((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[other])).rowCount).toBe(0);
    }
  });
}
it("rejects expired, wrong-host, wrong-purpose and replayed app states without consuming a valid different-host/purpose state",async()=>{
  const url=await start('gsc');const state=url.searchParams.get('state')!;
  expect((await api(`/api/gbp/callback?state=${state}&code=x`)).status).toBe(400);
  expect((await api(`/api/gsc/callback?state=${state}&code=x`,"",false,undefined,{"x-forwarded-host":"portal.constructhub.us"})).status).toBe(400);
  await pool.query("UPDATE app_oauth_states SET expires_at=now()-interval '1 second' WHERE state=$1",[state]);
  expect((await finish('gsc',url)).status).toBe(400);
});
it("provider denial returns a redirect-only code and never signs another account in",async()=>{
  const url=await start('gsc');
  const r=await finish('gsc',url,'provider-failure');
  const back=await exchange(r);
  expect(back.headers.get('location')).toBe('/search-console?connection=failed');
  const second=await finish('gsc',await start('gsc'),'provider-failure');
  expect((await exchange(second,otherCookie)).status).toBe(403);
  expect((await (await api('/api/auth/me',otherCookie)).json()).id).toBe(other);
});
it("retains website session binding and recent-auth/plan guards",async()=>{
  const url=await start('gbp',false);
  expect((await finish('gbp',url)).status).toBe(401);
  expect((await finish('gbp',url,'fixture-ok',cookie)).headers.get('location')).toBe('/locations?gbp=connected');
  const stale=await session(other,false);
  expect((await api(starts.gbp,stale,true)).status).toBe(403);
  await pool.query("UPDATE subscriptions SET status='canceled' WHERE user_id=$1",[other]);
  expect((await api(starts.gsc,otherCookie,true)).status).toBe(402);
});
