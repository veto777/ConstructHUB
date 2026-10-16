import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { pool } from '../db';
import { ensureAgencySchema } from './schema';
import { registerAgencyAccess } from './middleware';
import { ensureGbpSchema } from '../gbp/schema';
import { registerGbpRoutes } from '../gbp/routes';
import { encryptToken } from '../gbp/token-crypto';
import { GBP_SCOPE } from '../gbp/client';
import { lastSyncText } from '@shared/gbp-connection';
import { planForModule } from '@shared/plans';
vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({accepted:['fixture@example.invalid']}))}));
/**
 * GET /api/gbp/connection for an agency member acting in an owner's workspace (server/agency/middleware.ts):
 * the member sees the owner's connection state and last sync for the locations it may see, scrubbed of the
 * owner's Google identity — `accounts: []`, every `accountEmail: null`, `delegated: true`, no Google `sub`,
 * no grant ids or tokens. /api/gbp/status and /api/gbp/linkage for a member carry no account email either.
 * Actors: the owner (with one Google grant and two linked locations, one per client), a manager on all
 * clients, a viewer scoped to one client, and an unrelated user who owns a location of their own.
 */
let owner:number,manager:number,viewer:number,stranger:number;
let clientA:number,clientB:number,locA:number,locB:number,strangerLoc:number;
const tag=crypto.randomUUID();
const grantEmail=`gbp-scrub-owner-${tag}@example.invalid`,sub=`10${Date.now()}${Math.floor(Math.random()*1e6)}`;
const accessToken=`ya29.scrub-access-${tag}`,refreshToken=`1//scrub-refresh-${tag}`;
const accessEnc=encryptToken(accessToken)!,refreshEnc=encryptToken(refreshToken)!;
const lastSuccess=new Date('2026-10-09T15:57:00Z');
const routes=new Map<string,Function>();let middleware:Function;
/** One request through the agency middleware, then (if it passes the request on) the real GBP route. */
const get=async(path:string,actor:number,workspace:number|null,query:any={})=>{
  let status=200,data:any,passed=false;
  const req:any={path,method:'GET',query,user:{id:actor},session:workspace?{agencyOwner:workspace}:{},headers:{},body:{}};
  const res:any={locals:{},setHeader(){return res;},status(n:number){status=n;return res;},json(v:any){data=v;return res;}};
  await middleware(req,res,()=>{passed=true;});
  if(passed)await routes.get('get '+path)!(req,res);
  return {status,data,passed};
};
const user=async(key:string)=>(await pool.query('INSERT INTO users(email) VALUES($1) RETURNING id',[`gbp-scrub-${key}-${crypto.randomUUID()}@example.invalid`])).rows[0].id as number;
const location=async(userId:number,clientId:number|null,name:string,linked:boolean)=>(await pool.query('INSERT INTO business_locations(user_id,agency_client_id,business_name,address,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
  [userId,clientId,name,'1 Scrub St',linked?`accounts/${tag}`:null,linked?`locations/${crypto.randomUUID()}`:null,linked?sub:null])).rows[0].id as number;
/** Keys that would carry a Google identity or credential, anywhere in a response. */
const forbiddenKeys=/^(sub|subject|google_?subject|grant_?id|grantSubject|grantEmail|access_?token|accessToken|refresh_?token|refreshToken|email|account_email)$/i; // accountEmail is allowed: its value is asserted null
const keysOf=(v:any,out:string[]=[]):string[]=>{if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){out.push(k);keysOf(x,out);}return out;};
const assertNoOwnerSecrets=(body:any,label:string)=>{
  const text=JSON.stringify(body);
  for(const secret of [grantEmail,sub,accessToken,refreshToken,accessEnc,refreshEnc])expect(text,`${label} leaks ${secret.slice(0,16)}`).not.toContain(secret);
};
beforeAll(async()=>{
  const target=new URL(process.env.DATABASE_URL!);if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)||!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Lane a1 DB required');
  await ensureAgencySchema();await ensureGbpSchema();
  [owner,manager,viewer,stranger]=await Promise.all([user('owner'),user('manager'),user('viewer'),user('stranger')]);
  // The owner is on the plan that includes the agency workspace and team seats; members need no plan of their own.
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')",[owner,planForModule('agencyWorkspace')]);
  await pool.query('INSERT INTO agency_workspaces(user_id,name) VALUES($1,$2)',[owner,'Scrub agency']);
  clientA=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Scrub A') RETURNING id",[owner])).rows[0].id;
  clientB=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Scrub B') RETURNING id",[owner])).rows[0].id;
  await pool.query("INSERT INTO agency_members(user_id,member_id,role,all_clients) VALUES($1,$2,'manager',true),($1,$3,'viewer',false)",[owner,manager,viewer]);
  await pool.query('INSERT INTO agency_member_clients VALUES($1,$2,$3)',[owner,viewer,clientA]);
  await pool.query('INSERT INTO gbp_grants(user_id,google_subject,email,scopes,access_token,refresh_token,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval \'1 hour\')',[owner,sub,grantEmail,['openid','email',GBP_SCOPE],accessEnc,refreshEnc]);
  locA=await location(owner,clientA,'Scrub linked A',true);locB=await location(owner,clientB,'Scrub linked B',true);
  strangerLoc=await location(stranger,null,'Stranger shop',false);
  await pool.query("INSERT INTO gbp_sync_status(location_id,kind,last_success,last_attempt) VALUES($1,'reviews',$2,$2),($3,'reviews',$2,$2)",[locA,lastSuccess,locB]);
  registerAgencyAccess({use:(fn:Function)=>{middleware=fn;}} as any);
  const app:any={use(){}};for(const m of ['get','post','patch','delete'])app[m]=(p:string,...h:Function[])=>routes.set(m+' '+p,h.at(-1)!);
  registerGbpRoutes(app,(req:any)=>req.user);
});
afterAll(async()=>{
  const ids=[owner,manager,viewer,stranger];
  await pool.query('DELETE FROM gbp_grants WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1::int[])',[ids]); // cascades gbp_sync_status
  await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[ids]); // cascades workspaces, clients, members
  await pool.end();
});
describe('GET /api/gbp/connection: the owner sees their own Google account',()=>{
  it('shows the owner the account email and subject on the account and each linked location',async()=>{
    const r=await get('/api/gbp/connection',owner,owner);
    expect(r.status).toBe(200);expect(r.passed).toBe(true);
    expect(r.data.state).toBe('connected');expect(r.data.delegated).toBeUndefined();
    expect(r.data.accounts).toEqual([{subject:sub,email:grantEmail,state:'connected',label:'Connected'}]);
    expect(r.data.locations.map((l:any)=>l.id)).toEqual([locA,locB]);
    for(const l of r.data.locations)expect(l).toMatchObject({state:'connected',accountEmail:grantEmail,lastSync:lastSuccess.toISOString()});
    // Even the owner's own answer never carries a token.
    for(const t of [accessToken,refreshToken,accessEnc,refreshEnc])expect(JSON.stringify(r.data)).not.toContain(t);
  });
});
describe('GET /api/gbp/connection: an agency member gets the owner\'s state, scrubbed',()=>{
  it('gives a manager on all clients the owner\'s state and last sync with no Google identity',async()=>{
    const own=(await get('/api/gbp/connection',owner,owner)).data;
    const r=await get('/api/gbp/connection',manager,owner);
    expect(r.status).toBe(200);expect(r.passed).toBe(false); // answered by the middleware, never the owner route
    expect(r.data.accounts).toEqual([]);expect(r.data.delegated).toBe(true);
    expect(r.data.locations.map((l:any)=>l.id)).toEqual([locA,locB]);
    for(const l of r.data.locations)expect(l.accountEmail).toBeNull();
    // The same words as the owner's page: state, label, detail, last sync, counts, and per-location state.
    expect({state:r.data.state,label:r.data.label,detail:r.data.detail,lastSync:r.data.lastSync,counts:r.data.counts})
      .toEqual({state:own.state,label:own.label,detail:own.detail,lastSync:own.lastSync,counts:own.counts});
    expect(lastSyncText(r.data.lastSync)).toBe(lastSyncText(own.lastSync));
    expect(r.data.locations.map(({accountEmail,...l}:any)=>l)).toEqual(own.locations.map(({accountEmail,...l}:any)=>l));
    assertNoOwnerSecrets(r.data,'manager connection');
    expect(keysOf(r.data).filter(k=>forbiddenKeys.test(k))).toEqual([]);
  });
  it('gives a scoped viewer only its client\'s location, with the owner\'s state and last sync for it',async()=>{
    const own=(await get('/api/gbp/connection',owner,owner,{locationId:String(locA)})).data;
    const r=await get('/api/gbp/connection',viewer,owner);
    expect(r.status).toBe(200);expect(r.passed).toBe(false);
    expect(r.data).toMatchObject({accounts:[],delegated:true,state:own.state,label:own.label,lastSync:own.lastSync});
    expect(r.data.locations.map((l:any)=>l.id)).toEqual([locA]);
    expect(r.data.locations[0]).toEqual({...own.locations[0],accountEmail:null});
    assertNoOwnerSecrets(r.data,'viewer connection');
    expect(keysOf(r.data).filter(k=>forbiddenKeys.test(k))).toEqual([]);
  });
  it('scrubs the one-location detail (?locationId=) the same way',async()=>{
    for(const actor of [manager,viewer]){
      const r=await get('/api/gbp/connection',actor,owner,{locationId:String(locA)});
      expect(r.status).toBe(200);expect(r.data).toMatchObject({accounts:[],delegated:true,state:'connected'});
      expect(r.data.locations).toHaveLength(1);expect(r.data.locations[0]).toMatchObject({id:locA,accountEmail:null,lastSync:lastSuccess.toISOString()});
      assertNoOwnerSecrets(r.data,`member ${actor} location detail`);
      expect(keysOf(r.data).filter(k=>forbiddenKeys.test(k))).toEqual([]);
    }
  });
  it('answers 404 for another owner\'s location and for a client the viewer is not assigned to',async()=>{
    for(const actor of [manager,viewer]){
      const r=await get('/api/gbp/connection',actor,owner,{locationId:String(strangerLoc)});
      expect(r.status).toBe(404);assertNoOwnerSecrets(r.data,'404 body');expect(JSON.stringify(r.data)).not.toContain('Stranger shop');
    }
    const hidden=await get('/api/gbp/connection',viewer,owner,{locationId:String(locB)});
    expect(hidden.status).toBe(404);assertNoOwnerSecrets(hidden.data,'viewer hidden 404');
  });
});
describe('/api/gbp/status and /api/gbp/linkage for a member carry no account email',()=>{
  it('answers status with the connected flag only',async()=>{
    for(const actor of [manager,viewer]){
      const r=await get('/api/gbp/status',actor,owner);
      expect(r.status).toBe(200);expect(r.passed).toBe(false);
      expect(r.data).toEqual({connected:true,accounts:[],locations:[],delegated:true});
      assertNoOwnerSecrets(r.data,'member status');
    }
  });
  it('answers linkage with empty lists',async()=>{
    for(const actor of [manager,viewer]){
      const r=await get('/api/gbp/linkage',actor,owner);
      expect(r.status).toBe(200);expect(r.passed).toBe(false);
      expect(r.data).toEqual({accounts:[],locations:[],errors:[]});
      assertNoOwnerSecrets(r.data,'member linkage');
    }
  });
});
describe('An unrelated user never sees the owner\'s Google connection',()=>{
  it('falls back to their own empty connection, even with a stale workspace choice',async()=>{
    for(const workspace of [null,owner]){
      const r=await get('/api/gbp/connection',stranger,workspace);
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({state:'not_connected',accounts:[]});
      expect(r.data.locations.map((l:any)=>l.id)).toEqual([strangerLoc]);
      assertNoOwnerSecrets(r.data,'stranger connection');
      for(const path of ['/api/gbp/status'])assertNoOwnerSecrets((await get(path,stranger,workspace)).data,'stranger status');
    }
  });
  it('answers 404 for the owner\'s location',async()=>{
    for(const workspace of [null,owner]){
      const r=await get('/api/gbp/connection',stranger,workspace,{locationId:String(locA)});
      expect(r.status).toBe(404);assertNoOwnerSecrets(r.data,'stranger 404');expect(JSON.stringify(r.data)).not.toContain('Scrub linked');
    }
  });
});
