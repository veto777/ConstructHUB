import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from '../db';
import { ensureSocialSchema } from './schema';
import { ensureGbpSchema } from '../gbp/schema';
import { ensureGrowthSchema } from '../growth-schema';
import { ensureAccountEventsSchema } from '../account-events';
import { BlotatoClient } from './client';
import { connect, connection, createPosts, changePost, disconnect, saveSettings, workerUser, runSocialWorker, generateDue, userLock } from './service';
import { enqueueBulk, expandVariables, listBusinesses, runAgencyWorker, saveMapping } from './agency';
import { syncGbpSources } from './gbp-sources';
import { registerSocialRoutes } from './routes';
import { autoSchema, destinationSchema } from '../../shared/social';
vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({}))}));
let owner:number,other:number,a:number,b:number,foreign:number;
const x=destinationSchema.parse({accountId:'agency-x',platform:'twitter'});
const y=destinationSchema.parse({accountId:'client-x',platform:'twitter'});
const http=vi.fn(async(url:any,opts:any)=>new Response(JSON.stringify(String(url).endsWith('/accounts')?{items:[{id:opts.headers['blotato-api-key']==='client-test-key'?'client-x':'agency-x',platform:'twitter',fullname:'Fixture X'}]}:{postSubmissionId:'fixture-submission'})));
const make=(key:string)=>new BlotatoClient(key,http,async()=>{});
const request=(extra:any={})=>({requestId:crypto.randomUUID(),text:'Fixture business post',destinations:[x],draft:true,...extra});
const routes=new Map<string,any>();
async function call(method:string,path:string,user=owner,body:any={},query:any={},params:any={}) {
  const res:any={setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn()};
  await routes.get(`${method} /api/social${path}`)({user:{id:user},body,query,params},res);
  return {status:res.status.mock.calls[0]?.[0]??200,body:res.json.mock.calls[0]?.[0]};
}
beforeAll(async()=>{
  if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('a4 DB required');
  process.env.SOCIAL_ENCRYPTION_KEY='ac'.repeat(32);
  await ensureGrowthSchema();await ensureGbpSchema();await ensureSocialSchema();await ensureSocialSchema();await ensureAccountEventsSchema();
  const users=await pool.query("INSERT INTO users(email) SELECT 'agency-fixture-'||gen_random_uuid()||'@example.invalid' FROM generate_series(1,2) RETURNING id");
  [owner,other]=users.rows.map(r=>r.id);
  const locations=await pool.query("INSERT INTO business_locations(user_id,business_name,city,phone) SELECT $1,'Agency fixture '||lpad(n::text,4,'0'),'Fixture city '||n,'fixture-phone-'||n FROM generate_series(1,1000) n RETURNING id",[owner]);
  [a,b]=locations.rows.map(r=>r.id);
  foreign=(await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'Foreign fixture') RETURNING id",[other])).rows[0].id;
  const app:any={};for(const method of ['get','post','put','delete'])app[method]=(path:string,...handlers:any[])=>routes.set(`${method} ${path}`,handlers.at(-1));
  registerSocialRoutes(app,()=>true,make);
});
afterAll(async()=>{
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)',[[owner,other]]);
  await pool.query('DELETE FROM users WHERE id=ANY($1)',[[owner,other]]);
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE $1 OR key=$2",[`social-ai-business:${owner}:%`,`social-ai:${owner}`]);
  await pool.end();
});
describe('agency business scope',()=>{
  it('paginates/searches 1,000 businesses in SQL and rejects cross-owner scope',async()=>{
    const first=await listBusinesses(owner,{}),second=await listBusinesses(owner,{offset:25});
    expect(first.total).toBe(1000);expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(25);expect(first.items.some(r=>second.items.some(s=>s.id===r.id))).toBe(false);
    expect((await listBusinesses(owner,{search:'1000'})).items).toHaveLength(1);
    expect((await listBusinesses(other,{})).total).toBe(1);
    expect((await call('get','',owner,{}, {businessId:foreign})).status).toBe(404);
    expect((await call('get','',owner,{}, {businessId:'bad'})).status).toBe(400);
  });
  it('falls back to the agency key, requires explicit mapping, and isolates request IDs',async()=>{
    await connect(owner,'agency-test-key',null,make);
    expect((await connection(owner,make,a)).businessId).toBeNull();
    await expect(createPosts(owner,request(),a)).rejects.toThrow('Map');
    await saveMapping(owner,a,{destinations:[x]});await saveMapping(owner,b,{destinations:[x]});
    const input=request();const [pa]=await createPosts(owner,input,a);const [pb]=await createPosts(owner,input,b);
    expect(pa.business_id).toBe(a);expect(pb.business_id).toBe(b);expect(pa.id).not.toBe(pb.id);
    expect((await createPosts(owner,input,a))[0].id).toBe(pa.id);
    await expect(changePost(owner,pa.id,'approve',undefined,b)).rejects.toMatchObject({status:404});
    expect((await call('get','',owner,{}, {businessId:a})).body.posts.every((p:any)=>p.business_id===a)).toBe(true);
    expect(JSON.stringify((await call('get','',owner,{}, {businessId:a})).body)).not.toMatch(/key_enc|agency-test-key/);
  });
  it('supports a separate client key and invalidates stale mappings without leaking credentials',async()=>{
    await connect(owner,'client-test-key',null,make,b);
    expect((await connection(owner,make,b)).businessId).toBe(b);
    await expect(createPosts(owner,request(),b)).rejects.toThrow('Map');
    await saveMapping(owner,b,{destinations:[y]});
    const [p]=await createPosts(owner,request({destinations:[y],draft:false}),b);
    http.mockClear();await workerUser(owner,make,async()=>{throw new Error('No AI expected');},b);
    expect(http.mock.calls.some(([,opts])=>opts.headers['blotato-api-key']==='client-test-key')).toBe(true);
    expect((await pool.query('SELECT state FROM social_posts WHERE id=$1',[p.id])).rows[0].state).toBe('submitted');
    await connect(owner,'replacement-test-key',null,make,b);
    await pool.query('UPDATE social_posts SET due_at=now() WHERE id=$1',[p.id]);
    http.mockClear();await workerUser(owner,make,async()=>'',b);expect(http).not.toHaveBeenCalled();
    await disconnect(owner,null,b);
    expect((await connection(owner,make,b)).businessId).toBeNull();
    await saveMapping(owner,b,{destinations:[x]});
  });
  it('keeps settings and source generation within the selected business',async()=>{
    await saveSettings(owner,{...autoSchema.parse({}),destinations:[x],mix:['offers'],aiDailyBudget:3},a);
    await saveSettings(owner,{...autoSchema.parse({}),destinations:[x],cadence:4},b);
    await call('post','/sources',owner,{kind:'offers',text:'Fixture offer for A'},{businessId:a});
    await call('post','/sources',owner,{kind:'offers',text:'Fixture offer for B'},{businessId:b});
    const generate=vi.fn(async(_context:any)=>'AI fixture A draft');
    const posts=await userLock(owner,c=>generateDue(c,owner,generate,true,a));
    expect(posts?.[0]).toMatchObject({business_id:a,ai_generated:true,state:'draft'});
    expect(generate.mock.calls[0][0]).toMatchObject({business:{business_name:'Agency fixture 0001'},source:'Fixture offer for A'});
    expect((await call('get','',owner,{}, {businessId:b})).body.settings.cadence).toBe(4);
    const sources=await call('get','/sources',owner,{}, {businessId:a});expect(sources.body.map((s:any)=>s.text)).toEqual(['Fixture offer for A']);
    expect((await call('delete','/sources/:id',owner,{}, {businessId:b},{id:sources.body[0].id})).status).toBe(404);
  });
  it('queues bulk work without external calls, expands facts, honors per-business cadence, and deduplicates retries',async()=>{
    http.mockClear();const input={requestId:crypto.randomUUID(),businessIds:[a,b],kind:'post',text:'{business}: {city}, {phone}'};
    expect(await enqueueBulk(owner,input)).toMatchObject({queued:2});expect(http).not.toHaveBeenCalled();
    await enqueueBulk(owner,input);await expect(enqueueBulk(owner,{...input,text:'changed'})).rejects.toMatchObject({status:409});
    await runAgencyWorker(async()=>{throw new Error('No AI expected');});expect(http).not.toHaveBeenCalled();
    const {rows}=await pool.query('SELECT * FROM social_posts WHERE user_id=$1 AND request_id=$2',[owner,input.requestId]);
    expect(rows).toHaveLength(2);expect(rows.every(p=>p.state==='draft')).toBe(true);
    expect(rows.find(p=>p.business_id===b).payload.post.content.text).toBe('Agency fixture 0002: Fixture city 2, fixture-phone-2');
    await enqueueBulk(owner,{requestId:crypto.randomUUID(),businessIds:[a,b],kind:'settings',cadences:[{businessId:a,cadence:2,period:'week'},{businessId:b,cadence:3,period:'day'}]});
    await runAgencyWorker();
    expect((await call('get','',owner,{}, {businessId:a})).body.settings).toMatchObject({enabled:true,mode:'approval',cadence:2,period:'week'});
    expect((await call('get','',owner,{}, {businessId:b})).body.settings).toMatchObject({cadence:3,period:'day'});
    expect(()=>expandVariables('{phone}',{business_name:'Fixture',phone:null,city:null})).toThrow('Missing phone');
    await expect(enqueueBulk(owner,{...input,requestId:crypto.randomUUID(),businessIds:[a,foreign]})).rejects.toMatchObject({status:404});
  });
  it('queues source refresh and draft generation, with injected external boundaries in workers',async()=>{
    http.mockClear();expect((await call('post','/sources/sync-gbp',owner,{}, {businessId:a})).status).toBe(202);
    const sync=vi.fn(async()=>({imported:0}));
    await runAgencyWorker(async()=>'',sync);expect(sync).toHaveBeenCalledWith(owner,undefined,a);expect(http).not.toHaveBeenCalled();
    const response=await call('post','/generate',owner,{requestId:crypto.randomUUID()},{businessId:a});expect(response.status).toBe(202);
    const ai=vi.fn(async()=>'Queued AI fixture');await runAgencyWorker(ai,sync);expect(ai).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT state,ai_generated,business_id FROM social_posts WHERE payload->'post'->'content'->>'text'='Queued AI fixture' AND user_id=$1",[owner])).rows[0]).toMatchObject({state:'draft',ai_generated:true,business_id:a});
  });
  it('paginates all-clients calendar and sources over 1,000 rows without provider calls',async()=>{
    await pool.query(`INSERT INTO social_posts(id,user_id,business_id,request_id,destination_key,payload,state,due_at)
      SELECT gen_random_uuid(),$1,id,gen_random_uuid()::text,'fixture',jsonb_build_object('post',jsonb_build_object('content',jsonb_build_object('text','Fixture calendar '||business_name,'platform','twitter'))),'draft',now() FROM business_locations WHERE user_id=$1`,[owner]);
    http.mockClear();const first=await call('get','/calendar'),second=await call('get','/calendar',owner,{}, {offset:25});
    expect(first.body.total).toBeGreaterThanOrEqual(1000);expect(first.body.posts).toHaveLength(25);expect(second.body.posts).toHaveLength(25);
    expect(first.body.posts.some((r:any)=>second.body.posts.some((s:any)=>s.id===r.id))).toBe(false);
    const search=await call('get','/calendar',owner,{}, {search:'1000',state:'draft',platform:'twitter'});expect(search.body.total).toBe(1);
    expect((await call('get','/calendar',other)).body.total).toBe(0);expect(http).not.toHaveBeenCalled();
    await pool.query("INSERT INTO social_sources(user_id,business_id,kind,text) SELECT $1,$2,'offers','Fixture source '||n FROM generate_series(1,1000) n",[owner,a]);
    expect((await call('get','/sources',owner,{}, {businessId:a,search:'Fixture source'})).body).toHaveLength(25);
    expect((await call('get','/sources',owner,{}, {businessId:a,search:'Fixture source 1000'})).body).toHaveLength(1);
  });
  it('paginates 1,000 cached accounts/pages and business photos without network discovery',async()=>{
    const accounts=Array.from({length:1000},(_,n)=>({id:`fixture-account-${n}`,name:`Fixture account ${String(n).padStart(4,'0')}`,platform:'facebook',pages:n===0?Array.from({length:1000},(_,p)=>({id:`page-${p}`,name:`Fixture page ${String(p).padStart(4,'0')}`})):[]}));
    const old=(await pool.query('SELECT accounts FROM social_connections WHERE user_id=$1 AND business_id IS NULL',[owner])).rows[0].accounts;
    await pool.query('UPDATE social_connections SET accounts=$2 WHERE user_id=$1 AND business_id IS NULL',[owner,JSON.stringify(accounts)]);
    try {
      http.mockClear();
      const first=await call('get','/accounts',owner,{}, {businessId:a}),second=await call('get','/accounts',owner,{}, {businessId:a,offset:25});
      expect(first.body.items).toHaveLength(25);expect(first.body.items[0].pages).toBeUndefined();expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect((await call('get','/accounts',owner,{}, {businessId:a,search:'0999'})).body.items).toHaveLength(1);
      const targets=await call('get','/accounts/:id/targets',owner,{}, {businessId:a,offset:25},{id:'fixture-account-0'});
      expect(targets.body.items).toHaveLength(25);expect(targets.body.items[0].id).toBe('page-25');
      expect((await call('get','/accounts/:id/targets',owner,{}, {businessId:a,search:'0999'},{id:'fixture-account-0'})).body.items).toHaveLength(1);
      await pool.query("INSERT INTO gbp_media(location_id,name,source,description,google_url) SELECT $1,'fixture-media-'||n,'business','Fixture photo '||n,'https://example.com/fixture-'||n||'.jpg' FROM generate_series(1,1000) n",[a]);
      expect((await call('get','/media',owner,{}, {businessId:a})).body).toHaveLength(25);
      expect((await call('get','/media',owner,{}, {businessId:b})).body).toHaveLength(0);
      expect((await call('get','/media',owner,{}, {businessId:a,search:'photo 1000'})).body).toHaveLength(1);
      expect(http).not.toHaveBeenCalled();
    } finally {await pool.query('UPDATE social_connections SET accounts=$2 WHERE user_id=$1 AND business_id IS NULL',[owner,JSON.stringify(old)]);}
  });
  it('refreshes only the selected Google profile with its matching grant',async()=>{
    await pool.query("INSERT INTO gbp_grants(user_id,google_subject,email,scopes) VALUES($1,'fixture-subject','fixture@example.invalid',ARRAY['https://www.googleapis.com/auth/business.manage'])",[owner]);
    await pool.query("UPDATE business_locations SET gbp_google_subject='fixture-subject',gbp_account_name='accounts/fixture',gbp_location_name='locations/'||id WHERE user_id=$1 AND id=ANY($2)",[owner,[a,b]]);
    const pages=vi.fn(async()=>[{name:`accounts/fixture/locations/${a}/localPosts/one`,state:'LIVE',topicType:'STANDARD',summary:'Fixture published A',createTime:new Date().toISOString()}]);
    const google:any=vi.fn(()=>({pages}));
    expect(await syncGbpSources(owner,google,a)).toEqual({imported:1});
    expect(google).toHaveBeenCalledExactlyOnceWith(owner,'fixture-subject');
    expect(pages).toHaveBeenCalledExactlyOnceWith('reviews',`/v4/accounts/fixture/locations/${a}/localPosts`,'localPosts');
    const sources=await call('get','/sources',owner,{}, {businessId:b,kind:'gbp'});expect(sources.body).toHaveLength(0);
  });
  it('supports bulk approval/cancellation with an owner check before any mutation',async()=>{
    const [pa]=await createPosts(owner,request(),a),[pb]=await createPosts(owner,request(),b);
    expect((await call('post','/posts/bulk-action',other,{ids:[pa.id,pb.id],action:'approve'})).status).toBe(404);
    expect((await call('post','/posts/bulk-action',owner,{ids:[pa.id,pb.id],action:'approve'},{businessId:a})).status).toBe(404);
    expect((await pool.query('SELECT state FROM social_posts WHERE id=$1',[pa.id])).rows[0].state).toBe('draft');
    expect((await call('post','/posts/bulk-action',owner,{ids:[pa.id,pb.id],action:'approve'})).body.results.every((r:any)=>r.ok)).toBe(true);
    expect((await call('post','/posts/bulk-action',owner,{ids:[pa.id,pb.id],action:'cancel'})).body.results.every((r:any)=>r.ok)).toBe(true);
  });
  it('does not redirect queued bulk posts after a mapping changes',async()=>{
    const requestId=crypto.randomUUID();
    await enqueueBulk(owner,{requestId,businessIds:[a],kind:'post',text:'Mapping snapshot fixture',draft:false});
    await saveMapping(owner,a,{destinations:[]});
    await runAgencyWorker(async()=>{throw new Error('No AI expected');},async()=>({imported:0}));
    const job=(await pool.query('SELECT state,error FROM social_bulk_jobs WHERE user_id=$1 AND request_id=$2',[owner,requestId])).rows[0];
    expect(job.state).toBe('failed');expect(job.error).toContain('Map');
    expect((await pool.query('SELECT id FROM social_posts WHERE user_id=$1 AND request_id=$2',[owner,requestId])).rows).toHaveLength(0);
  });


  it('newer manual settings cancel pending bulk automation rather than re-enabling it later',async()=>{
    await saveMapping(owner,a,{destinations:[x]});
    const requestId=crypto.randomUUID();
    await enqueueBulk(owner,{requestId,businessIds:[a],kind:'settings',mode:'automatic'});
    await saveSettings(owner,autoSchema.parse({destinations:[x],enabled:false}),a);
    expect((await pool.query('SELECT state FROM social_bulk_jobs WHERE user_id=$1 AND request_id=$2',[owner,requestId])).rows[0].state).toBe('cancelled');
    const mappingRequest=crypto.randomUUID();
    await enqueueBulk(owner,{requestId:mappingRequest,businessIds:[a],kind:'settings',mode:'automatic'});
    await saveMapping(owner,a,{destinations:[x]});
    expect((await pool.query('SELECT state FROM social_bulk_jobs WHERE user_id=$1 AND request_id=$2',[owner,mappingRequest])).rows[0].state).toBe('cancelled');
  });

  it('delivers terminal notifications after restart even without remaining queued posts',async()=>{
    const [post]=await createPosts(owner,request(),a);
    await pool.query("UPDATE social_posts SET state='published',notified_at=NULL WHERE id=$1",[post.id]);
    await runSocialWorker(make,async()=>{throw new Error('No paid calls in test');},async()=>({imported:0}));
    expect((await pool.query('SELECT notified_at FROM social_posts WHERE id=$1',[post.id])).rows[0].notified_at).not.toBeNull();
    expect((await pool.query("SELECT id FROM user_notifications WHERE user_id=$1 AND kind='social.post_published'",[owner])).rows.length).toBeGreaterThan(0);
  });
  it('queues 1,000 selected businesses atomically and paginates their results',async()=>{
    const ids=(await pool.query('SELECT id FROM business_locations WHERE user_id=$1 ORDER BY id',[owner])).rows.map(r=>r.id);
    http.mockClear();
    const result=await enqueueBulk(owner,{requestId:crypto.randomUUID(),businessIds:ids,kind:'sync'});
    expect(result.queued).toBe(1000);expect(http).not.toHaveBeenCalled();
    const first=await call('get','/bulk'),second=await call('get','/bulk',owner,{}, {offset:25});
    expect(first.body.items).toHaveLength(25);expect(second.body.items).toHaveLength(25);
    expect(first.body.items.some((r:any)=>second.body.items.some((s:any)=>r.id===s.id))).toBe(false);
    expect((await call('get','/bulk',owner,{}, {search:'1000'})).body.items).toHaveLength(1);
    expect((await call('get','/bulk',other)).body.items).toHaveLength(0);
  });
  it('pauses legacy global automation on schema upgrade without assigning a business',async()=>{
    await pool.query("INSERT INTO social_settings(user_id,settings) VALUES($1,$2) ON CONFLICT(user_id,business_id) DO UPDATE SET settings=$2",[owner,JSON.stringify(autoSchema.parse({enabled:true,destinations:[x],mode:'automatic'}))]);
    await ensureSocialSchema();
    expect((await pool.query('SELECT settings FROM social_settings WHERE user_id=$1 AND business_id IS NULL',[owner])).rows[0].settings.enabled).toBe(false);
    expect((await call('put','/settings',owner,{enabled:true,destinations:[x]})).status).toBe(400);
    expect((await call('post','/posts',owner,request())).status).toBe(400);
  });

});
