import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { pool } from '../db';
import { ensureAgencySchema } from './schema';
import { accessFor,clientAccess,locationAccess,listLocations,filters,dashboard } from './access';
import { queueBulk,runAgencyJobs,performJob } from './jobs';
import { createOnboarding,pollInvitations,matchesRequest,sendOnboarding,hash } from './onboarding';
import { registerAgencyRoutes,csvCell } from './routes';
import { registerAgencyAccess } from './middleware';
import { GoogleClient,GBP_SCOPE,Limiter } from '../gbp/client';
import { saveGrant } from '../gbp/grants';
import { planForModule } from '@shared/plans';
vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({accepted:['fixture@example.invalid']}))}));
let owner:number,member:number,other:number,client:number,hidden:number,loc:number,hiddenLoc:number;
const handlers=new Map<string,Function>();let middleware:Function;
const call=async(method:string,path:string,actor:number,body:any={},query:any={},params:any={})=>{
  let status=200,data:any;
  const req:any={user:{id:actor},session:{agencyOwner:owner},headers:{},body,query,params};
  const res:any={locals:{},setHeader(){return res;},status(n:number){status=n;return res;},json(v:any){data=v;return res;}};
  await handlers.get(method+' '+path)!(req,res);return {status,data};
};
beforeAll(async()=>{
  const target=new URL(process.env.DATABASE_URL!);if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)||!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Lane a1 DB required');
  await ensureAgencySchema();await ensureAgencySchema();
  for(const key of ['owner','member','other']){
    const id=(await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id",[`agency-${key}-${crypto.randomUUID()}@example.invalid`])).rows[0].id;
    if(key==='owner')owner=id;else if(key==='member')member=id;else other=id;
  }
  // The workspace owner is on the plan that includes the agency workspace; members need no plan of their own.
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')",[owner,planForModule('agencyWorkspace')]);
  await pool.query('INSERT INTO agency_workspaces(user_id,name) VALUES($1,$2)',[owner,'Test agency']);
  client=(await pool.query("INSERT INTO agency_clients(user_id,name,contact_email,tags,folder) VALUES($1,'Fixture client','client@example.invalid',ARRAY['roofing'],'West') RETURNING id",[owner])).rows[0].id;
  hidden=(await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Hidden client') RETURNING id",[owner])).rows[0].id;
  await pool.query("INSERT INTO agency_members(user_id,member_id,role) VALUES($1,$2,'manager')",[owner,member]);
  await pool.query('INSERT INTO agency_member_clients VALUES($1,$2,$3)',[owner,member,client]);
  await pool.query("INSERT INTO business_locations(user_id,agency_client_id,business_name,address) SELECT $1,CASE WHEN n<=1000 THEN $2::int ELSE $3::int END,'Agency fixture '||lpad(n::text,5,'0'),'Test address '||n FROM generate_series(1,5000) n",[owner,client,hidden]);
  loc=(await pool.query('SELECT min(id) id FROM business_locations WHERE user_id=$1',[owner])).rows[0].id;
  hiddenLoc=(await pool.query('SELECT min(id) id FROM business_locations WHERE user_id=$1 AND agency_client_id=$2',[owner,hidden])).rows[0].id;
  const app:any={get:(p:string,...h:Function[])=>handlers.set('get '+p,h.at(-1)!),post:(p:string,...h:Function[])=>handlers.set('post '+p,h.at(-1)!),put:(p:string,...h:Function[])=>handlers.set('put '+p,h.at(-1)!),delete:(p:string,...h:Function[])=>handlers.set('delete '+p,h.at(-1)!)};
  registerAgencyRoutes(app);registerAgencyAccess({use:(fn:Function)=>{middleware=fn;}} as any);
});
afterAll(async()=>{await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])',[[owner,member,other]]);await pool.query('DELETE FROM google_profile_reviews WHERE user_id=$1',[owner]);await pool.query('DELETE FROM citation_campaigns WHERE user_id=$1',[owner]);await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1::int[])',[[owner,member,other]]);await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[[owner,member,other]]);await pool.end();});
describe('Agency access and 5,000-location scale',()=>{
  it('paginates and filters 5,000 rows in SQL and only exposes the 1,000 assigned locations',async()=>{
    const start=performance.now(),a=await accessFor(member,owner);
    const first=await listLocations(a,filters.parse({}));expect(first.total).toBe(1000);expect(first.items).toHaveLength(50);
    const second=await listLocations(a,filters.parse({offset:50}));expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await listLocations(await accessFor(owner),filters.parse({}))).total).toBe(5000);
    expect((await listLocations(a,filters.parse({q:'fixture 00001'}))).total).toBe(1);
    expect((await listLocations(a,filters.parse({clientId:hidden}))).total).toBe(0);
    expect((await dashboard(a,filters.parse({}))).unlinked).toBe(1000);
    expect(performance.now()-start).toBeLessThan(3000);
  });
  it('paginates and client-scopes 1,000 reviews, scans, citations and social posts',async()=>{
    await pool.query("INSERT INTO google_profile_reviews(user_id,location_id,reviewer_name,rating,review_date) SELECT $1,id,'Agency test reviewer',5,now() FROM business_locations WHERE user_id=$1 AND agency_client_id=$2",[owner,client]);
    await pool.query("INSERT INTO citation_campaigns(user_id,location_id,campaign_name,business_name) SELECT $1,id,'Agency test campaign',business_name FROM business_locations WHERE user_id=$1 AND agency_client_id=$2",[owner,client]);
    await pool.query("INSERT INTO sitescan_jobs(id,user_id,url,page_cap,profile,state) SELECT gen_random_uuid(),$1,'https://example.invalid',1,jsonb_build_object('id',id),'{\"pages\":[]}'::jsonb FROM business_locations WHERE user_id=$1 AND agency_client_id=$2",[owner,client]);
    await pool.query("INSERT INTO social_posts(id,user_id,request_id,destination_key,payload,state,due_at) SELECT gen_random_uuid(),$1,gen_random_uuid()::text,'test','{\"text\":\"Agency fixture\"}'::jsonb,'draft',now() FROM generate_series(1,1000)",[owner]);
    await pool.query('INSERT INTO agency_social_post_clients(user_id,post_id,client_id) SELECT user_id,id,$2 FROM social_posts WHERE user_id=$1',[owner,client]);
    for(const path of ['/api/google-profile-reviews','/api/sitescan','/api/citations/campaigns','/api/social']) {
      let data:any,status=200;const res:any={locals:{},status(n:number){status=n;return res;},json(v:any){data=v;return res;}};
      await middleware({path,method:'GET',query:{paged:'true',clientId:String(client),offset:'50'},user:{id:member},session:{agencyOwner:owner}},res,()=>{throw Error('List escaped middleware');});
      expect(status,path).toBe(200);expect(data.total,path).toBe(1000);expect(data.items||data.jobs||data.posts,path).toHaveLength(50);
      await middleware({path,method:'GET',query:{paged:'true',clientId:String(hidden)},user:{id:member},session:{agencyOwner:owner}},res,()=>{});expect(data.total,path).toBe(0);
    }
  });
  it('checks individual objects and hides another client and agency',async()=>{
    const a=await accessFor(member,owner);await expect(locationAccess(a,hiddenLoc)).rejects.toMatchObject({status:404});
    await expect(clientAccess(a,hidden)).rejects.toMatchObject({status:404});
    await expect(accessFor(other,owner)).rejects.toMatchObject({status:404});
    expect((await locationAccess(a,loc)).id).toBe(loc);
  });
  it('enforces HTTP auth, admin and viewer permissions and strict input',async()=>{
    expect((await call('post','/api/agency/clients',member,{name:'Forbidden'})).status).toBe(404);
    expect((await call('post','/api/agency/clients',owner,{name:'',userId:other})).status).toBe(400);
    expect((await call('put','/api/agency/team',member,{email:'other@example.invalid',role:'admin',allClients:true})).status).toBe(404);
    // A non-member's stale workspace choice falls back to their own account, which has no Agency plan.
    const foreign=await call('get','/api/agency/locations',other);expect(foreign.status).toBe(402);expect(foreign.data.items).toBeUndefined();
    await pool.query("UPDATE agency_members SET role='viewer' WHERE user_id=$1 AND member_id=$2",[owner,member]);
    expect((await call('post','/api/agency/bulk',member,{requestKey:crypto.randomUUID(),action:'sync',selection:{ids:[loc]}})).status).toBe(404);
    await pool.query("UPDATE agency_members SET role='manager' WHERE user_id=$1 AND member_id=$2",[owner,member]);
  });
  it('checks deep-linked legacy objects and denies unrecognized delegated routes',async()=>{
    for(const [path,want] of [[`/api/locations/${hiddenLoc}`,404],['/api/gbp/disconnect',404],[`/api/locations/${loc}`,200]] as const){
      let status=200,next=false;const res:any={locals:{},status(n:number){status=n;return res;},json(){return res;}};
      await middleware({path,method:'GET',user:{id:member},session:{agencyOwner:owner}},res,()=>{next=true;});expect(status).toBe(want);expect(next).toBe(want===200);if(next)expect(res.locals.agencyOwner).toBe(owner);
    }
  });
  it('leaves the owner\'s per-business Social workbench to the Social routes and never answers a business with mixed posts',async()=>{
    const social=async(actor:number,query:any)=>{
      let status=200,data:any,next=false;const res:any={locals:{},status(n:number){status=n;return res;},json(v:any){data=v;return res;}};
      await middleware({path:'/api/social',method:'GET',query,user:{id:actor},session:{agencyOwner:owner}},res,()=>{next=true;});return {status,data,next};
    };
    // Owner: the workbench (with or without a business) is served by server/social/routes.ts.
    for(const query of [{businessId:'99999'},{businessId:String(loc)},{}]) expect((await social(owner,query)).next,JSON.stringify(query)).toBe(true);
    // An explicit agency client filter still gets the agency list.
    const filtered=await social(owner,{clientId:String(client)});expect(filtered.next).toBe(false);expect(filtered.data.total).toBe(1000);
    // Delegated members keep the agency list; a business-scoped request is not answered with every client's posts.
    expect((await social(member,{})).data.total).toBe(1000);
    const scoped=await social(member,{businessId:String(loc)});expect(scoped.next).toBe(false);expect(scoped.status).toBe(404);
  });
  it('names the field a rejected agency form is missing instead of a generic "Invalid input"',async()=>{
    expect((await call('post','/api/agency/clients',owner,{name:'  '})).data).toEqual({message:'Enter a name (1 to 200 characters).'});
    expect((await call('put','/api/agency/team',owner,{email:'',role:'viewer'})).data.message).toBe('Enter the email address of a registered ConstructHUB user.');
    const noAccount=await call('post','/api/agency/onboarding',owner,{clientId:client,subject:'',businessName:'Fixture',address:'1 Main St'});
    expect(noAccount.status).toBe(400);expect(noAccount.data.message).toMatch(/connect the agency Google account first/);
    // Refinements written for people pass through unchanged.
    expect((await call('post','/api/agency/onboarding',owner,{clientId:client,subject:'agency',businessName:'Fixture'})).data.message).toBe('Provide an address or Place ID');
  });
  it('freezes select-all matching scope, deduplicates requests and rechecks permissions at execution',async()=>{
    const a=await accessFor(member,owner),requestKey=crypto.randomUUID();
    const b={requestKey,action:'assign',selection:{allMatching:true,filters:{q:'fixture 00'}},payload:{clientId:client}};
    expect((await queueBulk(a,b)).queued).toBe(999);expect((await queueBulk(a,b)).reused).toBe(true);
    await expect(queueBulk(a,{requestKey:crypto.randomUUID(),action:'sync',selection:{ids:[loc,hiddenLoc]}})).rejects.toMatchObject({status:404});
    await pool.query('DELETE FROM agency_member_clients WHERE user_id=$1 AND member_id=$2',[owner,member]);
    await runAgencyJobs(undefined,1);
    expect((await pool.query("SELECT count(*)::int n FROM agency_jobs WHERE user_id=$1 AND status='failed'",[owner])).rows[0].n).toBe(1);
    await pool.query('INSERT INTO agency_member_clients VALUES($1,$2,$3)',[owner,member,client]);
    await pool.query('DELETE FROM agency_jobs WHERE user_id=$1',[owner]);
  });
  it('rotates queued work fairly between owners and gives explicit work priority',async()=>{
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')",[other,planForModule('agencyWorkspace')]);
    const otherLoc=(await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'Fairness fixture') RETURNING id",[other])).rows[0].id;
    for(const [user,id,priority] of [[owner,loc,20],[owner,loc+1,10],[other,otherLoc,10],[other,otherLoc,20]])await pool.query("INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,batch_id,priority) VALUES(gen_random_uuid(),$1,$1,$2,'assign',gen_random_uuid(),$3)",[user,id,priority]);
    const calls:any[]=[];await runAgencyJobs(async(j:any)=>{calls.push(j);return {};},4);
    expect(new Set(calls.slice(0,2).map(j=>j.user_id)).size).toBe(2);
    expect(calls.filter(j=>j.user_id===owner).map(j=>j.priority)).toEqual([10,20]);
    await pool.query('DELETE FROM agency_jobs WHERE user_id=ANY($1::int[])',[[owner,other]]);
    await pool.query('DELETE FROM subscriptions WHERE user_id=$1',[other]);
  });
  it('executes Guard, AI settings, content, scans and unlink through the existing services without external calls',async()=>{
    const id=(await pool.query("INSERT INTO business_locations(user_id,agency_client_id,business_name,gbp_account_name,gbp_location_name) VALUES($1,$2,'Action fixture','accounts/fixture','locations/actions') RETURNING id",[owner,client])).rows[0].id;
    const job=(action:string,payload:any={})=>({id:crypto.randomUUID(),user_id:owner,actor_id:owner,location_id:id,action,payload});
    await performJob(job('guard',{mode:'off',watched:[]}));
    await expect(performJob(job('guard',{mode:'lockdown',watched:['title']}))).rejects.toMatchObject({status:409});
    await performJob(job('ai-replies',{mode:'draft',scope:'future'}));
    expect((await pool.query('SELECT settings FROM gbp_reply_settings WHERE location_id=$1',[id])).rows[0].settings.mode).toBe('draft');
    const content=job('content',{items:[{kind:'post',summary:'Approved fixture text'}],schedule:{start:new Date(Date.now()+60000).toISOString()}});
    await performJob(content);await performJob(content);
    expect((await pool.query('SELECT count(*)::int n FROM gbp_content_jobs WHERE location_id=$1',[id])).rows[0].n).toBe(1);
    await pool.query("INSERT INTO gbp_sync_status(location_id,kind,last_success,profile_snapshot) VALUES($1,'profile',now(),'{\"website\":\"https://example.invalid\"}')",[id]);
    const scan:any=await performJob(job('scan'));expect(scan.id).toMatch(/^[a-f0-9-]+$/);
    await performJob(job('unlink'));expect((await pool.query('SELECT gbp_location_name FROM business_locations WHERE id=$1',[id])).rows[0].gbp_location_name).toBeNull();
  });
  it('uses the shared Guard reauthentication requirement and CSV formula escaping',async()=>{
    expect((await call('post','/api/agency/bulk',owner,{requestKey:crypto.randomUUID(),action:'guard',selection:{ids:[loc]},payload:{mode:'off',watched:[]}})).data.reauth).toBe(true);
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
  });
});
describe('Google invitations and email onboarding with mocked external boundaries',()=>{
  it('requires corroborating address or exact place ID and rejects conflicts',()=>{
    expect(matchesRequest({business_name:'Chain',address:'1 Main St'},{locationName:'chain',address:'1 Main St'})).toBe(true);
    expect(matchesRequest({business_name:'Chain'},{locationName:'Chain'})).toBe(false);
    expect(matchesRequest({business_name:'Chain',address:'1 Main St',place_id:'a'},{locationName:'Chain',address:'1 Main St',placeId:'b'})).toBe(false);
  });
  it('sends exact manager instructions, accepts only the matching invitation, links and queues sync',async()=>{
    await saveGrant(owner,{sub:'agency',email:'agency@example.invalid',email_verified:true},{access_token:'fixture-token',scope:GBP_SCOPE});
    const created=await createOnboarding(await accessFor(owner),{clientId:client,subject:'agency',businessName:'Invitation fixture',placeId:'fixture-place'});
    const r=(await pool.query('SELECT * FROM agency_onboarding WHERE id=$1',[created.id])).rows[0];
    const send=vi.fn(async()=>({}));await sendOnboarding(r,send);
    expect(send.mock.calls[0][0]).toMatchObject({to:'client@example.invalid',text:expect.stringContaining('agency@example.invalid')});
    expect(send.mock.calls[0][0].text).toContain('Manager');expect(r.token_enc).toMatch(/^v1:/);
    const calls:string[]=[];const http=vi.fn(async(input:any,init:any)=>{
      const url=new URL(input);calls.push(init.method+' '+url.pathname);
      if(url.pathname==='/v1/accounts')return Response.json({accounts:[{name:'accounts/agency'}]});
      if(url.pathname==='/v1/accounts/agency/invitations'){
        expect(url.search).toBe('');return Response.json({invitations:[{name:'accounts/agency/invitations/match',targetLocation:{locationName:'Invitation fixture',placeId:'fixture-place'}},{name:'accounts/agency/invitations/no',targetLocation:{locationName:'Other',placeId:'other'}}]});
      }
      if(url.pathname.endsWith(':accept'))return new Response('',{status:200});
      if(url.pathname.endsWith('/locations'))return Response.json({locations:[{name:'locations/fixture',title:'Invitation fixture',metadata:{placeId:'fixture-place'},storefrontAddress:{addressLines:['1 Fixture St']}}]});
      throw Error('Unexpected Google call');
    });
    const make=()=>new GoogleClient(async()=>'fixture',http as any,new Limiter(Date.now,async()=>{}),async()=>{});
    await pollInvitations(owner,'agency',make);
    expect(calls.filter(c=>c.startsWith('POST'))).toEqual(['POST /v1/accounts/agency/invitations/match:accept']);
    const linked=(await pool.query('SELECT * FROM agency_onboarding WHERE id=$1',[created.id])).rows[0];expect(linked.status).toBe('linked');
    expect((await pool.query('SELECT agency_client_id FROM business_locations WHERE id=$1',[linked.location_id])).rows[0].agency_client_id).toBe(client);
    expect((await pool.query("SELECT action FROM agency_jobs WHERE location_id=$1",[linked.location_id])).rows).toEqual([{action:'sync'}]);
    await pollInvitations(owner,'agency',make);expect(calls.filter(c=>c.startsWith('POST'))).toHaveLength(1);
  });
});
