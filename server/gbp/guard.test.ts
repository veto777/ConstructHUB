import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import bcrypt from 'bcryptjs';
import {pool} from '../db';
import {ensureAccountEventsSchema} from '../account-events';
import {ensureGbpSchema} from './schema';
import {ensureProfileGuardSchema} from './guard-schema';
import {GoogleClient,Limiter} from './client';
import {GUARD_FIELDS,snapshotOf,differences,previewSnapshot,configureGuard,checkGuard,resolveChange,writeOwnerProfile,runGuardWorker} from './guard';
import {purgeGoogleData} from './grants';
import {ownerProfileInput} from './profile-input';
import {registerProfileGuardRoutes,requireGuardRecentAuth,verifyGuardIdentity,reportFor} from './guard-routes';
vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({success:true}))}));
let user:number,other:number,id:number;
let live:any={name:'locations/guardfixture',title:'Approved fixture',phoneNumbers:{primaryPhone:'555-0100'},metadata:{hasGoogleUpdated:false},categories:{primaryCategory:{name:'categories/gcid:contractor',displayName:'Contractor'}}};
let google:any={},failPatch=false;
const http=vi.fn(async(input:any,options:any)=>{
  const u=new URL(input);
  if(options.method==='PATCH') {
    if(failPatch)return new Response(JSON.stringify({error:{code:403}}),{status:403});
    const fields=u.searchParams.get('updateMask')!.split(',');const body=JSON.parse(options.body);
    for(const field of fields) {
      if(field.includes('.')){const [root,k]=field.split('.'); live[root]??={};if(body[root]?.[k]===undefined)delete live[root][k];else live[root][k]=body[root][k];}
      else if(body[field]===undefined)delete live[field];else live[field]=body[field];
    }
    google={};
  }
  return new Response(JSON.stringify(u.pathname.endsWith('getGoogleUpdated')?google:live));
});
const client=new GoogleClient(async()=>'fixture',http,new Limiter(()=>0,async()=>{}),async()=>{});
beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL!);if(url.pathname!=='/constructhub_dev_a2'||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('a2 only');
  await ensureGbpSchema();await ensureAccountEventsSchema();await ensureProfileGuardSchema();await ensureProfileGuardSchema();
  const {rows}=await pool.query("INSERT INTO users(email,password_hash) VALUES('guard-'||gen_random_uuid()||'@example.invalid',$1),('guard-'||gen_random_uuid()||'@example.invalid',null) RETURNING id",[await bcrypt.hash('test-password',4)]);[user,other]=rows.map(r=>r.id);
  id=(await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,place_id) VALUES($1,'Guard fixture','accounts/guardfixture','locations/guardfixture','fixture-place') RETURNING id",[user])).rows[0].id;
});
afterAll(async()=>{await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)',[[user,other]]);await pool.query('DELETE FROM users WHERE id=ANY($1)',[[user,other]]);await pool.end();});
const changes=async()=> (await pool.query('SELECT * FROM gbp_guard_changes WHERE location_id=$1 ORDER BY id',[id])).rows;
describe('Profile Guard with real lane Postgres and mocked Google',()=>{
  it('validates profile field types and blocks metadata/path injection',()=>{
    expect(()=>ownerProfileInput.parse({fields:{websiteUri:'javascript:alert(1)'}})).toThrow();
    expect(()=>ownerProfileInput.parse({fields:{title:{bad:'shape'}}})).toThrow();
    expect(()=>ownerProfileInput.parse({fields:{metadata:{hasGoogleUpdated:false}}})).toThrow();
    expect(()=>ownerProfileInput.parse({fields:{'openInfo.status':'not-a-status'}})).toThrow();
    expect(ownerProfileInput.parse({fields:{title:'Owner name','profile.description':null}}).fields.title).toBe('Owner name');
  });
  it('normalizes output-only category details and object ordering',()=>{
    const approved=snapshotOf({...live,title:'Accepted Google edit'});
    expect(differences(approved,['title'],live,{location:{...live,title:'Accepted Google edit'},diffMask:'title',pendingMask:'title'})).toEqual([]);
    const address={...live,storefrontAddress:{addressLines:['First','Second']}};
    expect(differences(snapshotOf(address),['storefrontAddress'],{...address,storefrontAddress:{addressLines:['Second','First']}},{})).toHaveLength(1);
    expect(snapshotOf(live).categories).toEqual({primaryCategory:{name:'categories/gcid:contractor'},additionalCategories:[]});
    const snapshot=snapshotOf(live);expect(differences(snapshot,[...GUARD_FIELDS],{...live,categories:{primaryCategory:{displayName:'Changed display label',name:'categories/gcid:contractor'}}},{})).toEqual([]);
  });
  it('requires explicit, unexpired snapshot approval and owner scope',async()=>{
    await expect(previewSnapshot(other,id,client)).rejects.toMatchObject({status:404});
    await expect(configureGuard(user,id,'notify',['title'])).rejects.toMatchObject({status:409});
    const preview=await previewSnapshot(user,id,client);expect(preview.snapshot.title).toBe('Approved fixture');
    await expect(configureGuard(user,id,'notify',['title'],'invalid')).rejects.toMatchObject({status:409});
    await configureGuard(user,id,'notify',[...GUARD_FIELDS],preview.token);
    await expect(configureGuard(user,id,'notify',['title'],preview.token)).rejects.toMatchObject({status:409});
  });
  it('detects owner edits once, preserves evidence, and approves without a Google write',async()=>{
    live.title='Outside edit';await checkGuard(user,id,client);await checkGuard(user,id,client);
    const rows=await changes();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({field:'title',old_value:'Approved fixture',new_value:'Outside edit',status:'pending'});
    expect(rows[0].source).toContain('inferred');const before=http.mock.calls.filter(c=>c[1].method==='PATCH').length;
    await expect(resolveChange(other,id,rows[0].id,'approve',client)).rejects.toMatchObject({status:404});
    await resolveChange(user,id,rows[0].id,'approve',client);
    expect(http.mock.calls.filter(c=>c[1].method==='PATCH')).toHaveLength(before);
    expect((await changes())[0].status).toBe('approved');await checkGuard(user,id,client);expect(await changes()).toHaveLength(1);
    const {rows:events}=await pool.query('SELECT kind FROM account_activity WHERE user_id=$1',[user]);expect(events.some(e=>e.kind==='gbp.profile_change')).toBe(true);
  });
  it('detects Google suggestions even when owner GET still has the approved value',async()=>{
    google={location:{...live,title:'Google title'},diffMask:'title',pendingMask:'title'};
    await checkGuard(user,id,client);const c=(await changes()).at(-1)!;
    expect(c).toMatchObject({source:'Google update',new_value:'Google title',evidence:{diffMask:'title',pendingMask:'title'}});
    await resolveChange(user,id,c.id,'reject',client);expect((await changes()).at(-1).status).toBe('reverted');
    expect(http.mock.calls.filter(c=>c[1].method==='PATCH').at(-1)?.[0]).toContain('updateMask=title');
    expect((await pool.query("SELECT count(*)::int n FROM user_notifications WHERE user_id=$1 AND kind='gbp.change_reverted'",[user])).rows[0].n).toBe(1);
  });
  it('lockdown reverts and retries failed writes without claiming success',async()=>{
    await configureGuard(user,id,'lockdown',[...GUARD_FIELDS]);live.title='Hostile edit';failPatch=true;await checkGuard(user,id,client);
    let c=(await changes()).at(-1)!;expect(c.status).toBe('pending');expect(c.error).toContain('permission');
    failPatch=false;await checkGuard(user,id,client);c=(await changes()).at(-1)!;expect(c.status).toBe('reverted');expect(live.title).toBe('Outside edit');
    const logs=(await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind='gbp.change_reverted'",[user])).rows;
    expect(logs.some(r=>r.detail.action==='auto-revert')).toBe(true);
    const n=(await changes()).length;live.title='Hostile edit';await checkGuard(user,id,client);
    expect(await changes()).toHaveLength(n+1);expect((await changes()).at(-1).status).toBe('reverted');expect(live.title).toBe('Outside edit');
  });
  it('owner writes update only written snapshot fields, with no alert on next check',async()=>{
    const n=(await changes()).length;
    await writeOwnerProfile(user,id,{'profile.description':'Owner supplied description'},client);await checkGuard(user,id,client);expect(await changes()).toHaveLength(n);
    expect((await pool.query('SELECT snapshot FROM gbp_guard WHERE location_id=$1',[id])).rows[0].snapshot['profile.description']).toBe('Owner supplied description');
  });
  it('watch toggles and Off avoid unwanted alerts/writes; worker respects 15 minutes',async()=>{
    await configureGuard(user,id,'notify',['title']);live.phoneNumbers={primaryPhone:'unwatched'};const n=(await changes()).length;await checkGuard(user,id,client);expect(await changes()).toHaveLength(n);
    const check=vi.fn();await runGuardWorker(check);expect(check).not.toHaveBeenCalled();
    await pool.query("UPDATE gbp_guard SET last_attempt=now()-interval '16 minutes' WHERE location_id=$1",[id]);await runGuardWorker(check);expect(check).toHaveBeenCalledWith(user,id);
    await configureGuard(user,id,'off',['title']);http.mockClear();await checkGuard(user,id,client);expect(http).not.toHaveBeenCalled();
  });
  it('generates factual reports with official links and enforces report ownership',async()=>{
    const c=(await changes())[0];const report=await reportFor(user,'changes',c.id);expect(report.text).toContain('Approved fixture');expect(report.text).toContain('Outside edit');expect(report.formUrl).toContain('business_redressal_form');expect(report.listingUrl).toContain('query_place_id=fixture-place');expect(report.reportedAt).toBeNull();
    await expect(reportFor(other,'changes',c.id)).rejects.toMatchObject({status:404});
  });
  it('reauth fails closed for missing, stale, future and foreign sessions, and verifies credentials',async()=>{
    for(const stamp of [undefined,{userId:user,at:Date.now()-301000},{userId:other,at:Date.now()},{userId:user,at:Date.now()+10000}])expect(()=>requireGuardRecentAuth({session:{profileGuardAuth:stamp}} as any,user)).toThrow();
    expect(()=>requireGuardRecentAuth({session:{profileGuardAuth:{userId:user,at:Date.now()}}} as any,user)).not.toThrow();
    await expect(verifyGuardIdentity(user,{password:'bad'})).rejects.toMatchObject({status:403});await verifyGuardIdentity(user,{password:'test-password'});
    await expect(verifyGuardIdentity(other,{})).rejects.toMatchObject({status:403});
  });
  it('route boundary authenticates, validates IDs and requires reauth before settings mutation',async()=>{
    const handlers=new Map<string,any>();const app:any={};for(const m of ['get','post','put','patch'])app[m]=(p:string,h:any)=>handlers.set(m+p,h);
    registerProfileGuardRoutes(app,(req,res)=>{if(!req.user){res.status(401).json({});return null;}return req.user;});
    const invoke=async(key:string,req:any)=>{const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},json(v:any){this.body=v;}};await handlers.get(key)({params:{id:String(id)},body:{},session:{},...req},res);return res;};
    expect((await invoke('get/api/gbp/locations/:id/guard',{})).statusCode).toBe(401);
    expect((await invoke('get/api/gbp/locations/:id/guard',{user:{id:user},params:{id:'NaN'}})).statusCode).toBe(400);
    expect((await invoke('get/api/gbp/locations/:id/guard',{user:{id:other}})).statusCode).toBe(404);
    expect((await invoke('put/api/gbp/locations/:id/guard',{user:{id:user},body:{mode:'lockdown',watched:['title']}})).statusCode).toBe(403);
    expect((await invoke('put/api/gbp/locations/:id/guard',{user:{id:user},body:{mode:'lockdown',watched:['metadata']}})).statusCode).toBe(400);
    const c=(await changes())[0];const res=await invoke('post/api/gbp/reports/changes/:id',{user:{id:user},params:{id:String(c.id)},body:{submitted:true}});expect(res.body.localOnly).toBe(true);expect((await reportFor(user,'changes',c.id)).reportedAt).not.toBeNull();
  });
  it('disconnect purges Google snapshot/evidence and disables automation for the correct owner',async()=>{
    await pool.query("INSERT INTO gbp_reply_settings(user_id,location_id,settings) VALUES($1,$2,'{}')",[user,id]);
    await purgeGoogleData(other);expect((await changes()).length).toBeGreaterThan(0);
    await purgeGoogleData(user);expect(await changes()).toHaveLength(0);
    expect((await pool.query('SELECT * FROM gbp_guard WHERE user_id=$1',[user])).rows).toHaveLength(0);
    expect((await pool.query('SELECT * FROM gbp_reply_settings WHERE user_id=$1',[user])).rows).toHaveLength(0);
  });

});
