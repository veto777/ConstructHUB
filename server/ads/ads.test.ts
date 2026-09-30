import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { ensureAdsSchema } from './schema';
import { takeBudget } from '../growth-limits';
import { ensureGrowthSchema } from '../growth-schema';
import { ensureAccountEventsSchema } from '../account-events';
import { encryptToken, decryptToken } from '../gbp/token-crypto';
import { AdsClient, AdsError, ADS_SCOPE, customerId, searchAll, configured, takeAdsQuota, type AdsApi } from './client';
import { buildPlan, readState, emptyState, normalize, fingerprint, appliedDocument, protectionInput, STATE_QUERIES, type State } from './protections';
import { auditAccount } from './audit';
import { registerAdsRoutes } from './routes';
import { runAdsWorker, linkStatus, invitationMail } from './worker';
import { enqueue } from './store';
let user:number,other:number,domain:number,connection:string,app:express.Express;
const cid='1234567890', manager='9876543210';
let state:State;
const mail=vi.fn(async()=>({accepted:[],rejected:[],response:'mock'}));
const api:AdsApi={search:vi.fn(async(_cid,q)=>{
  for(const [key,query] of Object.entries(STATE_QUERIES)) if(q===query)return {results:state[key as keyof State].map(r=>({[key]:r}))};
  if(q.includes('FROM customer LIMIT'))return {results:[{customer:{id:manager,manager:true}}]};
  if(q.includes('FROM customer_client_link'))return {results:[]};
  if(q.includes('FROM customer_client'))return {results:[{customerClient:{id:cid,descriptiveName:'Fixture client',status:'ENABLED',manager:false}}]};
  return {results:[]};
}),mutate:vi.fn(async(_cid,operations,validateOnly)=>{
  if(validateOnly)return {};
  const result={mutateOperationResponses:operations.map((o:any,i:number)=>{
    const key=Object.keys(o)[0],type=key.replace(/Operation$/,''),op=o[key];
    return {[`${type}Result`]:{resourceName:op.update?.resourceName||op.remove||`customers/${cid}/${({campaignCriterion:'campaignCriteria',customerNegativeCriterion:'customerNegativeCriteria',sharedSet:'sharedSets',sharedCriterion:'sharedCriteria',campaignSharedSet:'campaignSharedSets'} as any)[type]}/${100+i}`}};
  })};
  state=appliedDocument({before:state,operations,inverseTemplates:[],summary:[],warnings:[]},result).after;
  return result;
}),link:vi.fn(async(_m,_op,validate)=>validate?{}:{result:{resourceName:`customers/${manager}/customerClientLinks/${cid}~42`}})};
const make=async()=>api;
const seedState=()=>{
  const s=emptyState();s.campaign=[normalize('campaign',{id:'10',resourceName:`customers/${cid}/campaigns/10`,name:'Fixture search',status:'ENABLED',advertisingChannelType:'SEARCH',geoTargetTypeSetting:{positiveGeoTargetType:'PRESENCE_OR_INTEREST'}})];return s;
};
const call=async(path:string,body?:any,method=body?'POST':'GET',owner=user,extra:any={})=>{
  const url=new URL(`http://test/api/ads${path}`),full=url.pathname;
  const layer=(app.router as any).stack.find((l:any)=>l.route?.methods[method.toLowerCase()]&&l.match(full));
  if(!layer)throw new Error(`Missing route ${path}`);
  const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},json(b:any){this.body=JSON.parse(JSON.stringify(b));return this;},redirect(url:string){this.statusCode=302;this.redirected=url;return this;}};
  const req:any={headers:{'x-fixture-user':String(owner)},params:layer.params,query:Object.fromEntries(url.searchParams),body,user:owner?{id:owner}:undefined,session:{recentAuth:{userId:owner,at:Date.now()},save(cb:any){cb();}},...extra};
  await layer.route.stack[0].handle(req,res);
  return res;
};
async function tick(){return runAdsWorker({make,mail,onlyUser:user});}
async function planPresence(){const r=await call('/bulk',{kind:'preview',selection:{ids:[cid]},action:{kind:'presence'},requestId:randomUUID()});expect(r.statusCode).toBe(202);await tick();return (await pool.query('SELECT * FROM ads_plans WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[user])).rows[0];}
beforeAll(async()=>{
  const u=new URL(process.env.DATABASE_URL!);if(u.pathname!=='/constructhub_dev_a3'||!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('Lane a3 DB required');
  process.env.EMAIL_FORCE_SINK='1';
  await ensureGrowthSchema();await ensureAccountEventsSchema();await ensureAdsSchema();await ensureAdsSchema();
  [user,other]=(await pool.query("INSERT INTO users(email) VALUES('ads-'||gen_random_uuid()||'@example.invalid'),('ads-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows.map(r=>r.id);
  domain=(await pool.query("INSERT INTO tracked_domains(user_id,domain,tracking_id) VALUES($1,'fixture.example.invalid',gen_random_uuid()) RETURNING id",[user])).rows[0].id;
  connection=(await pool.query('INSERT INTO ads_grants(user_id,manager_id,refresh_token,verified) VALUES($1,$2,$3,true) RETURNING connection_id',[user,manager,encryptToken('fixture-refresh')])).rows[0].connection_id;
  await pool.query("INSERT INTO business_locations(user_id,business_name) SELECT $1,'Ads scale fixture location '||i FROM generate_series(1,1000) i",[user]);
  await pool.query("INSERT INTO ads_accounts(user_id,customer_id,name,status,lsa) SELECT $1,(2000000000+i)::text,'Ads scale fixture '||i,'ENABLED',(i%2=0) FROM generate_series(1,1000) i",[user]);
  await pool.query("INSERT INTO ads_accounts(user_id,customer_id,name,status,domain_id) VALUES($1,$2,'Fixture search client','ENABLED',$3)",[user,cid,domain]);
  await pool.query("INSERT INTO ads_accounts(user_id,customer_id,name,status) VALUES($1,'5555555555','Other agency','ENABLED')",[other]);
  app=express();registerAdsRoutes(app,(req,res)=>{const id=Number(req.headers['x-fixture-user']);if(!id){res.status(401).json({message:'Unauthorized'});return;}return {id};},{http:vi.fn(async()=>new Response(JSON.stringify({access_token:'oauth-fixture',refresh_token:'offline-fixture',scope:ADS_SCOPE,expires_in:3600}))) as any});
});
beforeEach(async()=>{
  vi.clearAllMocks();state=seedState();
  await pool.query('DELETE FROM ads_jobs WHERE user_id=ANY($1)',[[user,other]]);await pool.query('DELETE FROM ads_plans WHERE user_id=ANY($1)',[[user,other]]);await pool.query('DELETE FROM ads_invitations WHERE user_id=ANY($1)',[[user,other]]);
  await pool.query('UPDATE ads_accounts SET snapshot=$3,status=\'ENABLED\',domain_id=$4 WHERE user_id=$1 AND customer_id=$2',[user,cid,JSON.stringify(state),domain]);
});
afterAll(async()=>{
  await pool.query('DELETE FROM blocked_ips WHERE domain_id=$1',[domain]);await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)',[[user,other]]);await pool.query('DELETE FROM users WHERE id=ANY($1)',[[user,other]]);await pool.query('DELETE FROM tracked_domains WHERE id=$1',[domain]);await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1)",[[`ads-queue:${user}`,`ads-queue:${other}`]]);await pool.end();
});
describe('Google Ads HTTP contract (all Google calls mocked)',()=>{
  it('uses singular invitation operation/result, manager header, validation-only and normalized IDs',async()=>{
    const http=vi.fn(async()=>new Response(JSON.stringify({result:{resourceName:'fixture'}}))),quota=vi.fn(async()=>{});
    const client=new AdsClient(manager,async()=>'secret-fixture',http as any,quota,'v25');
    await client.link(manager,{create:{clientCustomer:`customers/${cid}`,status:'PENDING'}});
    const [url,init]=http.mock.calls[0] as any;expect(url).toContain(`/customers/${manager}/customerClientLinks:mutate`);
    expect(init.headers['login-customer-id']).toBe(manager);expect(JSON.parse(init.body)).toEqual({operation:{create:{clientCustomer:`customers/${cid}`,status:'PENDING'}},validateOnly:false});expect(quota).toHaveBeenCalledTimes(1);
    expect(customerId.parse('123-456-7890')).toBe(cid);expect(()=>customerId.parse('x1234567890')).toThrow();
  });
  it('supports current Cloud project access without requiring the retired developer token',async()=>{
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID','fixture-client');vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET','fixture-secret');vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN','');vi.stubEnv('GOOGLE_ADS_PROJECT_ACCESS_ENABLED','true');
    try {
      expect(configured()).toBe(true);const http=vi.fn(async()=>new Response('{}'));
      await new AdsClient(manager,async()=>'fixture',http as any,async()=>{}).search(cid,'SELECT');
      expect((http.mock.calls[0] as any)[1].headers).not.toHaveProperty('developer-token');
    }finally{vi.unstubAllEnvs();}
  });
  it('spaces quota reservations across concurrent callers in Postgres',async()=>{
    await pool.query("UPDATE ads_request_budget SET next_at=now() WHERE id=1");
    const times:number[]=[];await Promise.all([takeAdsQuota().then(()=>times.push(Date.now())),takeAdsQuota().then(()=>times.push(Date.now()))]);
    expect(Math.abs(times[1]-times[0])).toBeGreaterThanOrEqual(230);
  });
  it('never retries ambiguous writes or reflects provider credentials',async()=>{
    const http=vi.fn(async()=>{throw new Error('secret-fixture');});const client=new AdsClient(manager,async()=>'token',http as any,async()=>{});
    await expect(client.mutate(cid,[])).rejects.toMatchObject({uncertain:true});expect(http).toHaveBeenCalledTimes(1);
    const denied=new AdsClient(manager,async()=>'token',async()=>new Response('token client_secret=secret',{status:403}),async()=>{});
    await expect(denied.search(cid,'SELECT')).rejects.toMatchObject({status:403,message:expect.not.stringContaining('client_secret')});
  });
  it('follows pages and rejects repeated tokens',async()=>{
    let i=0;const a={...api,search:vi.fn(async()=>({results:[{id:++i}],nextPageToken:i===1?'two':undefined}))};
    expect(await searchAll(a,cid,'query')).toHaveLength(2);a.search=vi.fn(async()=>({results:[],nextPageToken:'same'}));await expect(searchAll(a,cid,'query')).rejects.toThrow(/repeated/);
  });
});
describe('Protections and reversibility',()=>{
  it('rotates oldest observed IPs to 500 while preserving newest flags',()=>{
    state.campaignCriterion=Array.from({length:500},(_,i)=>normalize('campaignCriterion',{resourceName:`customers/${cid}/campaignCriteria/10~${i+1}`,campaign:state.campaign[0].resourceName,negative:true,ipBlock:{ipAddress:`10.0.${Math.floor(i/250)}.${i%250+1}`}}));
    const old=state.campaignCriterion[100].resourceName;
    const ages=Object.fromEntries(state.campaignCriterion.map(r=>[r.resourceName,r.resourceName===old?'2020-01-01':'2026-01-01']));
    const p=buildPlan(cid,state,{kind:'ip'},['203.0.113.7'],ages);
    expect(p.operations).toHaveLength(2);expect(p.operations[0].campaignCriterionOperation.remove).toBe(old);expect(p.summary.join()).toContain('500/500');expect(p.inverseTemplates[1].campaignCriterionOperation.create.ipBlock).toEqual(state.campaignCriterion[100].ipBlock);
  });
  it('uses account-level PMax placement exclusions and skips unsupported IP campaigns',()=>{
    state.campaign[0].advertisingChannelType='PERFORMANCE_MAX';expect(()=>buildPlan(cid,state,{kind:'ip'},['203.0.113.1'])).toThrow(/supported/);
    expect(buildPlan(cid,state,{kind:'placement',urls:['example.invalid']}).operations).toEqual([{customerNegativeCriterionOperation:{create:{placement:{url:'example.invalid'}}}}]);
  });
  it('creates a shared list, phrase negatives and bindings atomically with reverse dependency order',()=>{
    const p=buildPlan(cid,state,protectionInput.parse({kind:'negative',name:'Fixture',keywords:['jobs','careers','jobs']}));expect(p.operations).toHaveLength(4);
    expect(p.operations[0].sharedSetOperation.create.resourceName).toContain('/-1');expect(p.operations[1].sharedCriterionOperation.create.keyword.matchType).toBe('PHRASE');expect(p.inverseTemplates.at(-1)?.sharedSetOperation).toEqual({remove:'$result:0'});
  });
  it('rejects overlapping or invalid schedules, and preserves bid modifiers on reversal',()=>{
    const s={dayOfWeek:'MONDAY',startHour:9,startMinute:'ZERO',endHour:17,endMinute:'ZERO'};
    expect(protectionInput.safeParse({kind:'schedule',slots:[s,s]}).success).toBe(false);expect(protectionInput.safeParse({kind:'schedule',slots:[{...s,endHour:24,endMinute:'FIFTEEN'}]}).success).toBe(false);
    state.campaignCriterion=[normalize('campaignCriterion',{resourceName:`customers/${cid}/campaignCriteria/10~1`,campaign:state.campaign[0].resourceName,adSchedule:s,bidModifier:1.2})];
    const p=buildPlan(cid,state,protectionInput.parse({kind:'schedule',slots:[{...s,endHour:18}]}));expect(p.inverseTemplates[1].campaignCriterionOperation.create.bidModifier).toBe(1.2);
  });
  it('previews editable shared-list removals and saves their original match types for undo',()=>{
    const set=`customers/${cid}/sharedSets/7`;
    state.sharedSet=[{resourceName:set,name:'Fixture',type:'NEGATIVE_KEYWORDS'}];
    state.sharedCriterion=[{resourceName:`customers/${cid}/sharedCriteria/7~8`,sharedSet:set,keyword:{text:'free',matchType:'EXACT'}}];
    const p=buildPlan(cid,state,protectionInput.parse({kind:'negative',name:'Fixture',keywords:['careers'],mode:'replace'}));
    expect(p.operations[0].sharedCriterionOperation.remove).toContain('7~8');expect(p.inverseTemplates.at(-1)?.sharedCriterionOperation.create.keyword).toEqual({text:'free',matchType:'EXACT'});
  });
  it('does not count missing Google audit data as healthy',async()=>{
    const findings=await auditAccount({...api,search:async()=>{throw new AdsError('Unavailable',503);}},cid,state);expect(findings.filter(f=>f.severity==='unknown')).toHaveLength(4);expect(findings.some(f=>f.kind==='presence'&&f.fix?.action)).toBe(true);
  });
});
describe('Owner-scoped routes, durable queue and agency scale',()=>{
  it('paginates/searches/filters >1000 accounts and 1000 seeded locations without Google calls',async()=>{
    const a=await call('/accounts?limit=25&page=1'),b=await call('/accounts?limit=25&page=2');expect(a.body.total).toBe(1001);expect(a.body.items).toHaveLength(25);expect(b.body.items[0].customer_id).not.toBe(a.body.items[0].customer_id);
    expect((await call('/accounts?lsa=true')).body.total).toBe(500);expect((await call('/accounts?q=scale%20fixture%20999')).body.items).toHaveLength(1);
    expect((await call('/accounts',undefined,'GET',other)).body.items).toHaveLength(1);expect(api.search).not.toHaveBeenCalled();
  });
  it('authenticates every registered route and protects foreign resources',async()=>{
    expect((await call('/accounts',undefined,'GET',0)).statusCode).toBe(401);
    expect((await call(`/accounts/${cid}/campaigns`,undefined,'GET',other)).statusCode).toBe(404);
    expect((await call('/bulk',{kind:'audit',selection:{ids:['5555555555']},requestId:randomUUID()})).statusCode).toBe(404);
    expect((await call('/accounts?page=-1')).statusCode).toBe(400);
    expect((await call('/plans/confirm',{ids:[randomUUID()],confirm:true})).statusCode).toBe(409);
  });
  it('queues 1000 selected accounts with idempotency and no request-path Google calls',async()=>{
    const body={selection:{filter:{q:'scale fixture',lsa:''}},kind:'audit',requestId:randomUUID()};const a=await call('/bulk',body);expect(a.body.queued).toBe(1000);expect((await call('/bulk',body)).statusCode).toBe(202);
    expect(Number((await pool.query('SELECT count(*) FROM ads_jobs WHERE user_id=$1',[user])).rows[0].count)).toBe(1000);expect(api.search).not.toHaveBeenCalled();
  });
  it('enforces shared growth queue budgets and rejects untyped mutation input',async()=>{
    await pool.query('DELETE FROM growth_budgets WHERE key=$1',[`ads-queue:${user}`]);
    expect(await takeBudget(`ads-queue:${user}`,5000,5000,3600000)).toBe(true);
    expect((await call('/bulk',{kind:'audit',selection:{ids:[cid]},requestId:randomUUID()})).statusCode).toBe(429);
    expect((await call('/bulk',{kind:'preview',selection:{ids:[cid]},action:{kind:'presence',operations:[{remove:'foreign'}]},requestId:randomUUID()})).statusCode).toBe(400);
    await pool.query('DELETE FROM growth_budgets WHERE key=$1',[`ads-queue:${user}`]);
  });
  it('protects every registered route from unauthenticated callers',async()=>{
    for(const layer of (app.router as any).stack.filter((l:any)=>l.route)) {
      const method=Object.keys(layer.route.methods)[0].toUpperCase();
      const path=layer.route.path.replace('/api/ads','').replace(':cid',cid).replace(':id',randomUUID());
      expect((await call(path,method==='POST'?{}:undefined,method,0)).statusCode,path).toBe(401);
    }
  });
  it('encrypts grants, never returns credentials, and rejects invalid OAuth state without network',async()=>{
    const encrypted=(await pool.query('SELECT refresh_token FROM ads_grants WHERE user_id=$1',[user])).rows[0].refresh_token;expect(encrypted).toMatch(/^v1:/);expect(decryptToken(encrypted)).toBe('fixture-refresh');
    expect(JSON.stringify((await call('/status')).body)).not.toMatch(/refresh_token|access_token|fixture-refresh/);
    expect((await call('/callback?state=bad&code=bad')).redirected).toContain('failed');
  });
  it('previews without writes, requires confirmation, applies once, logs and reverses after another preview',async()=>{
    const plan=await planPresence();expect(plan.status).toBe('preview');expect(api.mutate).not.toHaveBeenCalled();
    expect((await call(`/plans/${plan.id}?q=PRESENCE&status=update`)).body.total).toBe(1);expect((await call(`/plans/${plan.id}?q=not-present`)).body.total).toBe(0);
    expect((await call(`/plans/${plan.id}`,undefined,'GET',other)).statusCode).toBe(404);
    expect((await call('/plans/confirm',{ids:[plan.id]})).statusCode).toBe(400);
    expect((await call('/plans/confirm',{ids:[plan.id],confirm:true})).statusCode).toBe(202);expect((await call('/plans/confirm',{ids:[plan.id],confirm:true})).statusCode).toBe(409);
    await tick();expect(state.campaign[0].geoTargetTypeSetting.positiveGeoTargetType).toBe('PRESENCE');expect(api.mutate).toHaveBeenCalledTimes(2);
    await tick(); // follow-up audit
    expect((await call('/plans/undo-preview',{ids:[plan.id]})).statusCode).toBe(202);await tick();
    const undo=(await pool.query("SELECT id FROM ads_plans WHERE user_id=$1 AND kind='undo'",[user])).rows[0];expect(undo).toBeTruthy();await call('/plans/confirm',{ids:[undo.id],confirm:true});await tick();
    expect(state.campaign[0].geoTargetTypeSetting.positiveGeoTargetType).toBe('PRESENCE_OR_INTEREST');expect((await pool.query('SELECT status FROM ads_plans WHERE id=$1',[plan.id])).rows[0].status).toBe('reversed');
    expect((await pool.query("SELECT 1 FROM account_activity WHERE user_id=$1 AND kind='ads.write_applied'",[user])).rowCount).toBe(2);
  });
  it('blocks stale, expired, and foreign-connection confirmations',async()=>{
    const plan=await planPresence();await call('/plans/confirm',{ids:[plan.id],confirm:true});state.campaign[0].name='Outside edit';await tick();expect(api.mutate).not.toHaveBeenCalled();expect((await pool.query('SELECT error FROM ads_plans WHERE id=$1',[plan.id])).rows[0].error).toMatch(/changed/);
    await pool.query("UPDATE ads_plans SET status='preview',expires_at=now()-interval '1 minute' WHERE id=$1",[plan.id]);expect((await call('/plans/confirm',{ids:[plan.id],confirm:true})).statusCode).toBe(409);
    await pool.query("UPDATE ads_plans SET expires_at=now()+interval '1 hour',connection_id=gen_random_uuid() WHERE id=$1",[plan.id]);expect((await call('/plans/confirm',{ids:[plan.id],confirm:true})).statusCode).toBe(409);
  });
  it('does not overwrite outside edits with a reversal',async()=>{
    const plan=await planPresence();await call('/plans/confirm',{ids:[plan.id],confirm:true});await tick();await tick();state.campaign[0].name='Outside edit';await call('/plans/undo-preview',{ids:[plan.id]});await tick();expect((await pool.query("SELECT 1 FROM ads_plans WHERE user_id=$1 AND kind='undo'",[user])).rowCount).toBe(0);
  });
  it('uses only the owned mapped Click Guard domain for flagged IPs',async()=>{
    await pool.query("INSERT INTO blocked_ips(domain_id,ip_address) VALUES($1,'203.0.113.12')",[domain]);
    await call('/bulk',{kind:'preview',selection:{ids:[cid]},action:{kind:'ip'},requestId:randomUUID()});await tick();
    const plan=(await pool.query('SELECT document FROM ads_plans WHERE user_id=$1',[user])).rows[0];expect(JSON.stringify(plan.document.operations)).toContain('203.0.113.12');
    expect((await call('/domain-mappings',{mappings:[{customerId:cid,domainId:domain}]},'POST',other)).statusCode).toBe(404);
  });
  it('creates PENDING invitation then sends the mocked instruction email; polling maps all statuses',async()=>{
    const body={confirm:true,clients:[{customerId:'1234567891',email:'client@example.invalid'}],requestId:randomUUID()};
    vi.mocked(api.link).mockImplementationOnce(async()=>({})).mockImplementationOnce(async()=>({result:{resourceName:`customers/${manager}/customerClientLinks/1234567891~42`}}));
    expect((await call('/invitations',body)).statusCode).toBe(202);await tick();expect(api.link).toHaveBeenCalledWith(manager,{create:{clientCustomer:'customers/1234567891',status:'PENDING'}},true);expect(mail).not.toHaveBeenCalled();await tick();expect(mail).toHaveBeenCalledTimes(1);expect(mail.mock.calls[0][0].text).toContain('Access and security');
    expect(['PENDING','ACTIVE','REFUSED','CANCELED'].map(linkStatus)).toEqual(['pending','accepted','rejected','cancelled']);
    const statuses=await call('/invitations');expect(statuses.body.items[0]).toMatchObject({status:'pending',email_status:'sent'});
  });
  it('polls real stored invitation status and does not bind an uncertain invitation to an obsolete link',async()=>{
    const resource=`customers/${manager}/customerClientLinks/${cid}~42`;
    await pool.query("INSERT INTO ads_invitations(user_id,customer_id,email,resource_name,status) VALUES($1,$2,'fixture@example.invalid',$3,'pending')",[user,cid,resource]);
    for(const [google,expected] of [['ACTIVE','accepted'],['REFUSED','rejected'],['CANCELED','cancelled']]) {
      await enqueue(user,connection,'poll',{});
      vi.mocked(api.search).mockImplementationOnce(async()=>({results:[{customerClientLink:{resourceName:resource,clientCustomer:`customers/${cid}`,status:google}}]}));await tick();
      expect((await pool.query('SELECT status FROM ads_invitations WHERE user_id=$1',[user])).rows[0].status).toBe(expected);
    }
    await pool.query("UPDATE ads_invitations SET resource_name=NULL,status='unknown' WHERE user_id=$1",[user]);
    await enqueue(user,connection,'poll',{});vi.mocked(api.search).mockImplementationOnce(async()=>({results:[{customerClientLink:{resourceName:resource,clientCustomer:`customers/${cid}`,status:'INACTIVE'}}]}));await tick();
    expect((await pool.query('SELECT status FROM ads_invitations WHERE user_id=$1',[user])).rows[0].status).toBe('unknown');
  });
  it('treats ambiguous writes as unknown and never auto-replays them',async()=>{
    const plan=await planPresence();await call('/plans/confirm',{ids:[plan.id],confirm:true});
    vi.mocked(api.mutate).mockImplementationOnce(async()=>({})).mockImplementationOnce(async()=>{throw new AdsError('Unknown write',503,true);});await tick();await tick();
    expect(api.mutate).toHaveBeenCalledTimes(2);expect((await pool.query('SELECT status FROM ads_plans WHERE id=$1',[plan.id])).rows[0].status).toBe('unknown');
  });
  it('records a definitive Google rejection as failed without claiming an uncertain write',async()=>{
    const plan=await planPresence();await call('/plans/confirm',{ids:[plan.id],confirm:true});
    vi.mocked(api.mutate).mockImplementationOnce(async()=>({})).mockImplementationOnce(async()=>{throw new AdsError('Google denied access',403);});await tick();await tick();
    expect(api.mutate).toHaveBeenCalledTimes(2);expect((await pool.query('SELECT status FROM ads_plans WHERE id=$1',[plan.id])).rows[0].status).toBe('failed');
  });
  it('recovers interrupted reads but never replays interrupted writes',async()=>{
    const j=await enqueue(user,connection,'invite',{invitationId:randomUUID()},cid);await pool.query("UPDATE ads_jobs SET status='running' WHERE id=$1",[j.id]);await tick();expect(api.link).not.toHaveBeenCalled();expect((await pool.query('SELECT status FROM ads_jobs WHERE id=$1',[j.id])).rows[0].status).toBe('unknown');
  });
  it('binds OAuth to the authenticated agency, saves encrypted offline tokens and consumes state once',async()=>{
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID','fixture-client');vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET','fixture-secret');vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN','fixture-dev');
    try {
      const session:any={recentAuth:{userId:other,at:Date.now()},save(cb:any){cb();}};
      const start=await call('/connect',{managerId:manager},'POST',other,{session});expect(start.statusCode).toBe(200);
      expect(new URL(start.body.url).searchParams.get('scope')).toBe(ADS_SCOPE);const nonce=session.adsOAuth.state;
      const callback=await call(`/callback?state=${nonce}&code=fixture`,undefined,'GET',other,{session});expect(callback.redirected).toBe('/ads-manager?connect=ok');expect(session.adsOAuth).toBeUndefined();
      const stored=(await pool.query('SELECT * FROM ads_grants WHERE user_id=$1',[other])).rows[0];expect(stored.manager_id).toBe(manager);expect(decryptToken(stored.refresh_token)).toBe('offline-fixture');expect(stored.refresh_token).not.toContain('offline-fixture');expect(stored.verified).toBe(false);
      expect((await call(`/callback?state=${nonce}&code=fixture`,undefined,'GET',other,{session})).redirected).toContain('failed');
      const wrongSession:any={adsOAuth:{state:'wrong-owner',userId:user,manager,expires:Date.now()+10000},save(cb:any){cb();}};
      expect((await call('/callback?state=wrong-owner&code=fixture',undefined,'GET',other,{session:wrongSession})).redirected).toContain('failed');
    }finally{vi.unstubAllEnvs();}
  });
  it('persists quota backoff for safe reads',async()=>{
    await enqueue(user,connection,'audit',{},cid);vi.mocked(api.search).mockImplementationOnce(async()=>{throw new AdsError('quota',429);});await tick();const job=(await pool.query('SELECT * FROM ads_jobs WHERE user_id=$1',[user])).rows[0];expect(job.status).toBe('queued');expect(new Date(job.due_at).getTime()).toBeGreaterThan(Date.now());expect(job.attempts).toBe(1);
  });
});

it('discovers 1000 Google clients in paged jobs before scheduling account audits',async()=>{
  const all=[cid,...Array.from({length:999},(_,i)=>String(2000000001+i))];
  const search=vi.fn(async(_id:string,q:string,token?:string)=>q.includes('FROM customer LIMIT')?{results:[{customer:{id:manager,manager:true}}]}:{results:all.slice(token?500:0,token?1000:500).map(id=>({customerClient:{id,descriptiveName:`Google fixture ${id}`,status:'ENABLED'}})),nextPageToken:token?undefined:'second'});
  await enqueue(user,connection,'discover',{});await runAdsWorker({onlyUser:user,make:async()=>({...api,search})});await runAdsWorker({onlyUser:user,make:async()=>({...api,search})});
  expect(search).toHaveBeenCalledTimes(4);expect((await pool.query("SELECT count(*)::int n FROM ads_jobs WHERE user_id=$1 AND kind='audit' AND status='queued'",[user])).rows[0].n).toBe(1000);
  expect((await pool.query("SELECT count(*)::int n FROM ads_accounts WHERE user_id=$1 AND status='ENABLED'",[user])).rows[0].n).toBe(1000);
});
