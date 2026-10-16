import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { pool } from '../db';
import { ensureAgencySchema } from './schema';
import { registerAgencyRoutes } from './routes';
import { hash } from './onboarding';
import { encryptToken } from '../gbp/token-crypto';
import { PLANS,planForModule } from '@shared/plans';
vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({accepted:['fixture@example.invalid']}))}));
/**
 * The numbers the agency list routes carry for their cards (added 2026-10-14):
 *   GET /agency/clients    — location_count, open_onboarding per client; summary {clients, locationsAssigned, locationsUnassigned}
 *   GET /agency/team       — display_name, client_names per member; seats {used, limit}
 *   GET /agency/jobs       — client_name, attempts per job; counts {queued, running, done, failed}
 *   GET /agency/onboarding — client_name per request; counts {waiting, accepting, linked, expired, withError}
 * Three actors: the owner (every number), a scoped admin member assigned to one client (numbers for that client,
 * null where the route documents it) and a scoped viewer (no capability link). A second workspace with its own
 * rows proves nothing crosses between owners.
 */
let owner:number,admin:number,viewer:number,other:number;
let clientA:number,clientB:number,otherClient:number;
let locA1:number,locA2:number,locB:number,locFree:number,otherLoc:number;
const handlers=new Map<string,Function>();
const call=async(method:string,path:string,actor:number,workspace:number,query:any={},params:any={})=>{
  let status=200,data:any;
  const req:any={user:{id:actor},session:{agencyOwner:workspace},headers:{},body:{},query,params};
  const res:any={locals:{},setHeader(){return res;},status(n:number){status=n;return res;},json(v:any){data=v;return res;}};
  await handlers.get(method+' /api/agency'+path)!(req,res);return {status,data};
};
const user=async(key:string,displayName:string)=>(await pool.query('INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id',[`agency-counts-${key}-${crypto.randomUUID()}@example.invalid`,displayName])).rows[0].id as number;
const location=async(userId:number,clientId:number|null,name:string)=>(await pool.query('INSERT INTO business_locations(user_id,agency_client_id,business_name,address) VALUES($1,$2,$3,$4) RETURNING id',[userId,clientId,name,'1 Count St'])).rows[0].id as number;
const job=(userId:number,locationId:number,status:string,attempts=0,error:string|null=null)=>pool.query("INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,batch_id,status,attempts,error) VALUES(gen_random_uuid(),$1,$1,$2,'assign',gen_random_uuid(),$3,$4,$5)",[userId,locationId,status,attempts,error]);
const onboarding=(userId:number,clientId:number,name:string,status:string,error:string|null=null)=>{
  const token='counts-'+crypto.randomUUID().replace(/-/g,'');
  return pool.query("INSERT INTO agency_onboarding(id,user_id,client_id,subject,agency_email,contact_email,business_name,token_hash,token_enc,status,error) VALUES($1,$2,$3,'agency','agency@example.invalid','client@example.invalid',$4,$5,$6,$7,$8)",[crypto.randomUUID(),userId,clientId,name,hash(token),encryptToken(token),status,error]);
};
beforeAll(async()=>{
  const target=new URL(process.env.DATABASE_URL!);if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)||!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Lane a1 DB required');
  await ensureAgencySchema();
  [owner,admin,viewer,other]=await Promise.all([user('owner','Counts Owner'),user('admin','Scoped Admin'),user('viewer','Scoped Viewer'),user('other','Other Owner')]);
  // Both workspace owners are on the plan that includes the agency workspace; members need no plan of their own.
  for(const id of [owner,other])await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')",[id,planForModule('agencyWorkspace')]);
  await pool.query('INSERT INTO agency_workspaces(user_id,name) VALUES($1,$2),($3,$4)',[owner,'Counts agency',other,'Other agency']);
  clientA=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Client A') RETURNING id",[owner])).rows[0].id;
  clientB=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Client B') RETURNING id",[owner])).rows[0].id;
  otherClient=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Other client') RETURNING id",[other])).rows[0].id;
  // The admin is scoped to Client A; the viewer is scoped to both clients (so a scoped reader of /team has a row
  // naming a client it cannot see). The other workspace has its own member for /team isolation.
  await pool.query("INSERT INTO agency_members(user_id,member_id,role) VALUES($1,$2,'admin'),($1,$3,'viewer'),($4,$5,'manager')",[owner,admin,viewer,other,admin]);
  await pool.query('INSERT INTO agency_member_clients VALUES($1,$2,$3),($1,$4,$3),($1,$4,$5),($6,$2,$7)',[owner,admin,clientA,viewer,clientB,other,otherClient]);
  // Locations: two on A, one on B, one unassigned; one on the other workspace's client.
  locA1=await location(owner,clientA,'Counts A1');locA2=await location(owner,clientA,'Counts A2');
  locB=await location(owner,clientB,'Counts B1');locFree=await location(owner,null,'Counts unassigned');
  otherLoc=await location(other,otherClient,'Other counts');
  // Jobs: A has 2 queued (one retried twice), 1 done, 1 failed; B has 1 queued; the other workspace has 1 queued.
  await job(owner,locA1,'queued');await job(owner,locA2,'queued',2);await job(owner,locA1,'done',1);await job(owner,locA2,'failed',3,'Fixture failure');
  await job(owner,locB,'queued');await job(other,otherLoc,'queued');
  // Onboarding: A has one request waiting on the client and one linked; B has one expired request with an error;
  // the other workspace has one request of its own.
  await onboarding(owner,clientA,'Counts A sent','sent');await onboarding(owner,clientA,'Counts A linked','linked');
  await onboarding(owner,clientB,'Counts B expired','expired','Fixture expiry');await onboarding(other,otherClient,'Other sent','sent');
  const app:any={};for(const m of ['get','post','put','delete'])app[m]=(p:string,...h:Function[])=>handlers.set(m+' '+p,h.at(-1)!);
  registerAgencyRoutes(app);
});
afterAll(async()=>{
  const ids=[owner,admin,viewer,other];
  await pool.query('DELETE FROM agency_jobs WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM agency_onboarding WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[ids]); // cascades workspaces, clients, members, member clients
  await pool.end();
});
const byName=(rows:any[])=>Object.fromEntries(rows.map(r=>[r.name??r.business_name,r]));
describe('GET /agency/clients: per-client counts and the summary',()=>{
  it('gives the owner every client with its location and open-onboarding counts and the whole-workspace summary',async()=>{
    const r=await call('get','/clients',owner,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(2);
    const c=byName(r.data.items);
    expect(c['Client A']).toMatchObject({id:clientA,location_count:2,open_onboarding:1}); // the linked request is closed
    expect(c['Client B']).toMatchObject({id:clientB,location_count:1,open_onboarding:0}); // the expired request is closed
    expect(r.data.summary).toEqual({clients:2,locationsAssigned:3,locationsUnassigned:1});
  });
  it('gives a scoped member only its client, with the unassigned count null (it cannot see them)',async()=>{
    const r=await call('get','/clients',admin,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(1);
    expect(r.data.items.map((c:any)=>c.name)).toEqual(['Client A']);
    expect(r.data.items[0]).toMatchObject({location_count:2,open_onboarding:1});
    expect(r.data.summary).toEqual({clients:1,locationsAssigned:2,locationsUnassigned:null});
  });
  it('keeps the search from changing the summary',async()=>{
    const r=await call('get','/clients',owner,owner,{q:'Client B'});
    expect(r.data.items.map((c:any)=>c.name)).toEqual(['Client B']);expect(r.data.total).toBe(1);
    expect(r.data.summary).toEqual({clients:2,locationsAssigned:3,locationsUnassigned:1});
  });
  it('shows another workspace nothing of this one',async()=>{
    const r=await call('get','/clients',other,other);
    expect(r.data.items.map((c:any)=>c.name)).toEqual(['Other client']);
    expect(r.data.items[0]).toMatchObject({location_count:1,open_onboarding:1});
    expect(r.data.summary).toEqual({clients:1,locationsAssigned:1,locationsUnassigned:0});
    // A stale workspace choice from a non-member falls back to their own workspace, never into this one.
    const stale=await call('get','/clients',other,owner);
    expect(stale.status).toBe(200);expect(stale.data.items.map((c:any)=>c.name)).toEqual(['Other client']);
  });
});
describe('GET /agency/team: names, client names and seats',()=>{
  it('gives the owner each member with display name, client names and the plan seat count',async()=>{
    const r=await call('get','/team',owner,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(2);
    const m=Object.fromEntries(r.data.items.map((x:any)=>[x.member_id,x]));
    expect(m[admin]).toMatchObject({role:'admin',display_name:'Scoped Admin',client_ids:[clientA],client_names:['Client A']});
    expect(m[viewer]).toMatchObject({role:'viewer',display_name:'Scoped Viewer',client_ids:[clientA,clientB],client_names:['Client A','Client B']});
    // Seats: the owner, the two members, and the plan's allowance (no extra seats bought).
    expect(r.data.seats).toEqual({used:3,limit:PLANS[planForModule('agencyWorkspace')].limits.agencySeats});
  });
  it('lets a scoped admin see only the client names it is assigned to',async()=>{
    const r=await call('get','/team',admin,owner);
    expect(r.status).toBe(200);
    expect(r.data.items.map((x:any)=>x.member_id).sort()).toEqual([admin,viewer].sort());
    const m=Object.fromEntries(r.data.items.map((x:any)=>[x.member_id,x]));
    expect(m[viewer].display_name).toBe('Scoped Viewer');
    // The viewer is also on Client B, which this admin cannot see: that name stays out of the row.
    expect(m[viewer].client_names).toEqual(['Client A']);
    expect(m[admin].client_names).toEqual(['Client A']);
    for(const row of r.data.items)for(const name of row.client_names)expect(['Client A']).toContain(name);
    expect(r.data.seats).toEqual({used:3,limit:PLANS[planForModule('agencyWorkspace')].limits.agencySeats});
  });
  it('refuses a viewer and shows another workspace only its own members',async()=>{
    expect((await call('get','/team',viewer,owner)).status).toBe(403);
    const r=await call('get','/team',other,other);
    expect(r.data.items.map((x:any)=>x.member_id)).toEqual([admin]);
    expect(r.data.items[0]).toMatchObject({role:'manager',client_names:['Other client']});
    expect(r.data.seats.used).toBe(2);
  });
});
describe('GET /agency/jobs: client name, attempts and status counts',()=>{
  it('gives the owner every job with its client name and attempts, and counts across the whole workspace',async()=>{
    const r=await call('get','/jobs',owner,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(5);expect(r.data.items).toHaveLength(5);
    expect(r.data.counts).toEqual({queued:3,running:0,done:1,failed:1});
    const failed=r.data.items.find((j:any)=>j.status==='failed');
    expect(failed).toMatchObject({location_id:locA2,business_name:'Counts A2',client_name:'Client A',attempts:3,error:'Fixture failure'});
    expect(r.data.items.find((j:any)=>j.location_id===locB)).toMatchObject({client_name:'Client B',attempts:0,status:'queued'});
    expect(r.data.items.filter((j:any)=>j.client_name==='Client A')).toHaveLength(4);
    expect(r.data.items.some((j:any)=>j.location_id===otherLoc)).toBe(false);
  });
  it('scopes a member\'s rows and counts to its client',async()=>{
    const r=await call('get','/jobs',admin,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(4);
    expect(r.data.counts).toEqual({queued:2,running:0,done:1,failed:1});
    for(const j of r.data.items)expect(j.client_name).toBe('Client A');
    expect(r.data.items.map((j:any)=>j.attempts).sort()).toEqual([0,1,2,3]);
  });
  it('counts only the matching jobs when a filter is on',async()=>{
    const r=await call('get','/jobs',owner,owner,{clientId:String(clientB)});
    expect(r.data.total).toBe(1);expect(r.data.counts).toEqual({queued:1,running:0,done:0,failed:0});
  });
  it('shows another workspace only its own jobs',async()=>{
    const r=await call('get','/jobs',other,other);
    expect(r.data.total).toBe(1);expect(r.data.counts).toEqual({queued:1,running:0,done:0,failed:0});
    expect(r.data.items[0]).toMatchObject({location_id:otherLoc,client_name:'Other client'});
  });
});
describe('GET /agency/onboarding: client name and stage counts',()=>{
  it('gives the owner every request with its client name, a link, and counts by stage',async()=>{
    const r=await call('get','/onboarding',owner,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(3);
    expect(r.data.counts).toEqual({waiting:1,accepting:0,linked:1,expired:1,withError:1});
    const o=byName(r.data.items);
    expect(o['Counts A sent']).toMatchObject({client_id:clientA,client_name:'Client A',status:'sent'});
    expect(o['Counts A linked']).toMatchObject({client_name:'Client A',status:'linked'});
    expect(o['Counts B expired']).toMatchObject({client_name:'Client B',status:'expired',error:'Fixture expiry'});
    for(const item of r.data.items){expect(item.token_hash).toBeUndefined();expect(item.token_enc).toBeUndefined();expect(item.link).toContain('/api/agency-onboarding/');expect(item.agency_email).toBe('agency@example.invalid');}
  });
  it('scopes a member\'s rows and counts to its client',async()=>{
    const r=await call('get','/onboarding',admin,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(2);
    expect(r.data.counts).toEqual({waiting:1,accepting:0,linked:1,expired:0,withError:0});
    for(const item of r.data.items)expect(item.client_name).toBe('Client A');
  });
  it('gives a viewer the rows and counts but no capability link',async()=>{
    const r=await call('get','/onboarding',viewer,owner);
    expect(r.status).toBe(200);expect(r.data.total).toBe(3);
    expect(r.data.counts).toEqual({waiting:1,accepting:0,linked:1,expired:1,withError:1});
    for(const item of r.data.items){expect(item.client_name).toBeTruthy();expect(item.token_hash).toBeUndefined();expect(item.token_enc).toBeUndefined();expect(item.link??null).toBeNull();expect(item.agency_email??null).toBeNull();}
  });
  it('shows another workspace only its own requests',async()=>{
    const r=await call('get','/onboarding',other,other);
    expect(r.data.total).toBe(1);expect(r.data.counts).toEqual({waiting:1,accepting:0,linked:0,expired:0,withError:0});
    expect(r.data.items[0]).toMatchObject({business_name:'Other sent',client_name:'Other client'});
    const filtered=await call('get','/onboarding',owner,owner,{clientId:String(otherClient)});
    expect(filtered.data.total).toBe(0);expect(filtered.data.counts).toEqual({waiting:0,accepting:0,linked:0,expired:0,withError:0});
  });
});
