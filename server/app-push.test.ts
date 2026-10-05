import { beforeAll, afterAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHmac, createHash } from "node:crypto";
import { pool } from "./db";
import { pushTokensFor } from "./app-push";
let child: ChildProcess, base: string;
const ids: number[]=[], sids: string[]=[], cookies: string[]=[];
const secret="app-push-fixture", token=randomBytes(32).toString('hex');
const ip=`198.19.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`;
async function api(method:string,body:unknown,cookie="") {
  return fetch(base+"/api/app/push-token",{method,headers:{cookie,"content-type":"application/json","x-forwarded-for":ip},body:JSON.stringify(body)});
}
beforeAll(async()=>{
  if(new URL(process.env.DATABASE_URL!).pathname!=="/constructhub_dev_a6")throw Error("Requires assigned development database");
  child=spawn(process.execPath,["--import","tsx","server/test-fixtures/app-auth-server.ts"],{env:{...process.env,NODE_ENV:"test",SESSION_SECRET:secret,GOOGLE_CLIENT_ID:"fixture",GOOGLE_CLIENT_SECRET:"fixture",DEV_AUTH_BYPASS_USER1:"false",CRM_DEMO_AUTOLOGIN:"false",EMAIL_FORCE_SINK:"true"},stdio:["ignore","pipe","pipe","ipc"]});
  let logs="";child.stderr?.on('data',b=>{logs+=b;});
  base=await new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error(logs)),30000);child.once('message',(m:any)=>{clearTimeout(t);resolve(`http://127.0.0.1:${m.port}`);});child.once('exit',()=>{clearTimeout(t);reject(Error(logs));});});
  for(let i=0;i<2;i++) {
    const {rows:[u]}=await pool.query("INSERT INTO users(email,email_verified) VALUES($1,true) RETURNING id",[`${randomUUID()}@example.invalid`]);ids.push(u.id);
    const sid=randomUUID();sids.push(sid);
    await pool.query("INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '1 hour')",[sid,JSON.stringify({cookie:{maxAge:3600000},passport:{user:u.id}})]);
    cookies.push(`connect.sid=${encodeURIComponent(`s:${sid}.${createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'')}`)}`);
  }
},40000);
afterAll(async()=>{
  if(child&&child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGTERM');});
  await pool.query("DELETE FROM session WHERE sid=ANY($1::text[])",[sids]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])",[ids]);
  await pool.query("DELETE FROM growth_budgets WHERE key=$1 OR key=ANY($2::text[])",[`app-push:ip:${createHash('sha256').update(ip).digest('hex')}`,ids.map(id=>`app-push:user:${id}`)]);
  await pool.end();
});
it("requires a signed-in user and validates token, app and platform",async()=>{
  const body={token,app:"platform",platform:"ios"};
  expect((await api('POST',body)).status).toBe(401);
  expect((await api('DELETE',{token})).status).toBe(401);
  for(const bad of [{...body,token:""},{...body,token:"not-hex"},{...body,token:'a'.repeat(201)},{...body,app:'other'},{...body,platform:'android'},[],null]) expect((await api('POST',bad,cookies[0])).status).toBe(400);
});
it("upserts token ownership, isolates apps, and allows only the owner to delete",async()=>{
  const body={token:token.toUpperCase(),app:"platform",platform:"ios"};
  for(let i=0;i<2;i++)expect((await api('POST',body,cookies[0])).status).toBe(204);
  expect(await pushTokensFor(ids[0],'platform')).toEqual([token]);
  expect(await pushTokensFor(ids[0],'crm')).toEqual([]);
  expect((await api('DELETE',{token},cookies[1])).status).toBe(204);
  expect(await pushTokensFor(ids[0],'platform')).toEqual([token]);
  expect((await api('POST',{...body,app:'crm'},cookies[1])).status).toBe(204);
  expect(await pushTokensFor(ids[0],'platform')).toEqual([]);
  expect(await pushTokensFor(ids[1],'crm')).toEqual([token]);
  expect((await api('DELETE',{token},cookies[0])).status).toBe(204);
  expect(await pushTokensFor(ids[1],'crm')).toEqual([token]);
  expect((await api('DELETE',{token},cookies[1])).status).toBe(204);
  expect(await pushTokensFor(ids[1],'crm')).toEqual([]);
});
it("filters revoked/expired sessions and cascades account deletion",async()=>{
  expect((await api('POST',{token,app:'crm',platform:'ios'},cookies[1])).status).toBe(204);
  await pool.query("UPDATE session SET expire=now()-interval '1 second' WHERE sid=$1",[sids[1]]);
  expect(await pushTokensFor(ids[1],'crm')).toEqual([]);
  await pool.query("DELETE FROM users WHERE id=$1",[ids[1]]);
  expect((await pool.query("SELECT 1 FROM app_push_tokens WHERE token=$1",[token])).rowCount).toBe(0);
});
