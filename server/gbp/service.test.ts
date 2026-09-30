import { profileFor } from "../sitescan/worker";
import { decryptToken } from './token-crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {pool} from '../db';
import {ensureGbpSchema} from './schema';
import {DatabaseLimiter} from './quota';
import {registerGbpRoutes} from './routes';
import {saveGrant,grantStatus,accessToken} from './grants';
import {GBP_SCOPE,GoogleClient,Limiter} from './client';
import {discover,discoverAll,importLocations,syncLocation,reply,runGbpWorker,unlinkLocation,autoLinkAndSync} from './service';
let userId:number,otherId:number,locationId:number,reviewId:number;
let reviewRows:any[]=[];let failReviews=false, failReply=false;let reviewPaging=false,failSecondPage=false;
const today=new Date();today.setUTCDate(today.getUTCDate()-2);const metricDate={year:today.getUTCFullYear(),month:today.getUTCMonth()+1,day:today.getUTCDate()};
const fixtureReview=()=>({name:'accounts/fixture/locations/fixture/reviews/review1',reviewId:'review1',reviewer:{displayName:'Fixture Customer'},starRating:'FIVE',comment:'Fixture review',createTime:'2026-09-01T00:00:00Z',updateTime:'2026-09-02T00:00:00Z'});
const http=vi.fn(async(input:any,options:any)=>{
  const url=new URL(input);let body:any={};let status=200;
  if(url.pathname==='/v1/accounts') body={accounts:[{name:'accounts/fixture',accountName:'Fixture account'},{name:'accounts/denied'}]};
  else if(url.pathname==='/v1/accounts/denied/locations'){body={error:{code:403}};status=403;}
  else if(url.pathname==='/v1/locations/fixture') body={name:'locations/fixture',title:'Fixture business',phoneNumbers:{primaryPhone:'(555) 010-0000'},categories:{primaryCategory:{displayName:'Roofing contractor',serviceTypes:[{serviceTypeId:'job_type_id:roof_repair',displayName:'Roof repair'}]}},storefrontAddress:{addressLines:['1 Main St'],locality:'Town',administrativeArea:'WA',postalCode:'98000',regionCode:'US'},profile:{description:'Fixture description'},serviceArea:{places:{placeInfos:[{placeName:'Town, WA, USA'}]}},regularHours:{periods:[{openDay:'MONDAY',openTime:{hours:8},closeDay:'MONDAY',closeTime:{hours:17,minutes:30}}]},openInfo:{status:'OPEN',openingDate:{year:2003,month:2,day:1}},metadata:{placeId:'ChIJfixtureplace',mapsUri:'https://maps.google.com/?cid=1'},serviceItems:[{structuredServiceItem:{serviceTypeId:'job_type_id:roof_repair'}},{freeFormServiceItem:{label:{displayName:'Gutter guards'}}}]};
  else if(url.pathname==='/v1/locations/fixture/attributes') body={attributes:[{name:'locations/fixture/attributes/url_facebook',uriValues:[{uri:'https://www.facebook.com/fixture'}]},{name:'locations/fixture/attributes/url_text_messaging',uriValues:[{uri:'sms:+15550100000'}]}]};
  else if(url.pathname.endsWith('/media/customers')) body={mediaItems:[{name:'accounts/fixture/locations/fixture/media/c1',mediaFormat:'PHOTO',googleUrl:'https://lh3.example/c1',thumbnailUrl:'https://lh3.example/c1=s200',attribution:{profileName:'Happy Customer'},createTime:'2026-09-01T00:00:00Z'}]};
  else if(url.pathname.endsWith('/media')) body={mediaItems:['b1','b2','b3'].map(n=>({name:`accounts/fixture/locations/fixture/media/${n}`,mediaFormat:'PHOTO',locationAssociation:{category:'EXTERIOR'},googleUrl:`https://lh3.example/${n}`,thumbnailUrl:`https://lh3.example/${n}=s200`,createTime:'2026-09-02T00:00:00Z'})).concat([{name:'accounts/other/locations/x/media/evil',googleUrl:'javascript:alert(1)'} as any])};
  else if(url.pathname.endsWith('/locations')) body={locations:[{name:'locations/fixture',title:'Fixture business',metadata:{placeId:'ChIJfixtureplace'}}]};
  else if(url.pathname.endsWith('/reply')) {if(failReply){status=403;body={error:{code:403}}}else body=options.method==='DELETE'?{}:{comment:JSON.parse(options.body).comment,updateTime:'2026-09-02T00:00:00Z'};}
  else if(url.pathname.endsWith('/reviews')) {
    body=failReviews?{error:{code:403}}:{reviews:reviewRows};status=failReviews?403:200;
    if(reviewPaging){if(!url.searchParams.has('pageToken')) body={reviews:[{...fixtureReview(),comment:'Changed first page'}],nextPageToken:'second'};
      else {body=failSecondPage?{error:{code:403}}:{reviews:[{...fixtureReview(),name:'accounts/fixture/locations/fixture/reviews/review2',reviewId:'review2'}]};status=failSecondPage?403:200;}}
  }
  else if(url.pathname.includes('fetchMultiDailyMetricsTimeSeries')) body={multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[{dailyMetric:'CALL_CLICKS',timeSeries:{datedValues:[{date:metricDate,value:'0'}]}}]}]};
  else throw new Error('Unexpected Google fixture URL');
  return new Response(JSON.stringify(body),{status});
});
const client=new GoogleClient(async()=> 'fixture-access',http,new Limiter(()=>0,async()=>{}),async()=>{});
beforeAll(async()=>{
  const target=new URL(process.env.DATABASE_URL!);
  if(!['127.0.0.1','localhost'].includes(target.hostname) || !/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)) throw new Error('GBP integration tests require a local development DB');
  await ensureGbpSchema();
  const {rows}=await pool.query("INSERT INTO users(email) VALUES('gbp-fixture-'||gen_random_uuid()::text||'@example.invalid'),('gbp-fixture-'||gen_random_uuid()::text||'@example.invalid') RETURNING id");
  [userId,otherId]=rows.map(r=>r.id);
  // Scheduled syncs only run for accounts with a plan.
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'starter','active')",[userId]);
});
afterAll(async()=>{await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1)',[[userId,otherId]]);await pool.query('DELETE FROM google_profile_reviews WHERE user_id=ANY($1)',[[userId,otherId]]);await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)',[[userId,otherId]]);await pool.query('DELETE FROM users WHERE id=ANY($1)',[[userId,otherId]]);await pool.end()});
describe('GBP persistence and state machines (mocked HTTP, real lane Postgres)',()=>{
  it('refuses basic login scopes and binds the grant to its Google subject',async()=>{
    await expect(saveGrant(userId,{sub:'google-a',email:'a@example.invalid',email_verified:true},{access_token:'a',scope:'openid email'})).rejects.toThrow('not granted');
    expect((await grantStatus(userId)).connected).toBe(false);
    await saveGrant(userId,{sub:'google-a',email:'a@example.invalid',email_verified:true},{access_token:'a',refresh_token:'ra',scope:GBP_SCOPE});
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'b',scope:GBP_SCOPE});
    // Two Google accounts coexist; a refresh token is never borrowed across accounts.
    const tokens=(await pool.query('SELECT google_subject,refresh_token FROM gbp_grants WHERE user_id=$1 ORDER BY google_subject',[userId])).rows;
    expect(tokens.map(t=>({...t,refresh_token:decryptToken(t.refresh_token)}))).toEqual([{google_subject:'google-a',refresh_token:'ra'},{google_subject:'google-b',refresh_token:null}]);
    const status=await grantStatus(userId);
    expect(status).toMatchObject({connected:true,email:'b@example.invalid'});expect(status.accounts.map((a:any)=>a.email).sort()).toEqual(['a@example.invalid','b@example.invalid']);
    expect(JSON.stringify(status)).not.toContain('access_token');
    const tagged=await discoverAll(userId,(_u:number,subject:string|null)=>subject==='google-a'?client:new GoogleClient(async()=>'x',async()=>new Response(JSON.stringify({accounts:[]})),new Limiter(()=>0,async()=>{}),async()=>{}));
    expect(tagged.locations.every((l:any)=>l.grantSubject==='google-a'&&l.grantEmail==='a@example.invalid')).toBe(true);expect(tagged.locations.length).toBeGreaterThan(0);
    await pool.query("DELETE FROM gbp_grants WHERE user_id=$1 AND google_subject='google-a'",[userId]);
  });
  it('refreshes expired tokens once; invalid_grant requests reconnect without deleting history',async()=>{
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'expired',refresh_token:'rb',scope:GBP_SCOPE,expires_in:-1});
    const tokenHttp=vi.fn(async()=>new Response(JSON.stringify({access_token:'fresh',expires_in:3600})));
    expect(await Promise.all([accessToken(userId,'google-b',tokenHttp),accessToken(userId,null,tokenHttp)])).toEqual(['fresh','fresh']);expect(tokenHttp).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE gbp_grants SET expires_at=now()-interval '1 hour' WHERE user_id=$1",[userId]);
    await expect(accessToken(userId,'google-b',async()=>new Response(JSON.stringify({error:'invalid_grant'}),{status:400}))).rejects.toMatchObject({kind:'auth'});
    expect(await grantStatus(userId)).toMatchObject({connected:false,reconnectRequired:true});
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'fresh',scope:GBP_SCOPE});
  });
  it('surfaces per-account errors and imports only verified canonical resources idempotently',async()=>{
    const d=await discover(client);expect(d.errors[0]).toMatchObject({account:'accounts/denied',kind:'permission'});
    await expect(importLocations(userId,[{accountResource:'accounts/fake',gbpName:'locations/fake'}],client)).rejects.toMatchObject({kind:'permission'});
    const {rows:[manual]}=await pool.query(`INSERT INTO business_locations(user_id,business_name,place_id) VALUES($1,'Added by Places search','ChIJfixtureplace') RETURNING id`,[userId]);
    await importLocations(userId,[{...d.locations[0],businessName:'Untrusted client name'}],client);await importLocations(userId,d.locations,client);
    const {rows}=await pool.query('SELECT * FROM business_locations WHERE user_id=$1',[userId]);expect(rows).toHaveLength(1);expect(rows[0].id).toBe(manual.id);expect(rows[0].gbp_location_name).toBe('locations/fixture');expect(rows[0].business_name).toBe('Fixture business');locationId=rows[0].id;
  });
  it('upserts edits and reconciles deletions only after complete successful review sync',async()=>{
    reviewRows=[fixtureReview()];await syncLocation(userId,locationId,client);reviewRows[0].comment='Updated by Google';await syncLocation(userId,locationId,client);
    let rows=(await pool.query('SELECT * FROM google_profile_reviews WHERE user_id=$1',[userId])).rows;expect(rows).toHaveLength(1);expect(rows[0].comment).toBe('Updated by Google');reviewId=rows[0].id;
    failReviews=true;expect(await syncLocation(userId,locationId,client)).toMatchObject({reviews:{kind:'permission'}});expect((await pool.query('SELECT google_deleted FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].google_deleted).toBe(false);
    failReviews=false;reviewRows=[];await syncLocation(userId,locationId,client);expect((await pool.query('SELECT google_deleted FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].google_deleted).toBe(true);
    reviewRows=[fixtureReview()];await syncLocation(userId,locationId,client);
    const statuses=(await pool.query('SELECT * FROM gbp_sync_status WHERE location_id=$1',[locationId])).rows;expect(statuses.every(s=>s.last_success&&!s.last_error)).toBe(true);
    const {rows:[prof]}=await pool.query('SELECT * FROM business_locations WHERE id=$1',[locationId]);
    expect(prof).toMatchObject({description:'Fixture description',phone:'(555) 010-0000',address:'1 Main St',city:'Town',opening_date:'2003-02-01',business_photo_count:3,customer_photo_count:1});
    const observed = await profileFor(userId, locationId);
    expect(observed).toMatchObject({business_name: prof.business_name, phone: prof.phone, services: prof.services});
    await pool.query("UPDATE business_locations SET phone='local draft',services=ARRAY['Local draft service'] WHERE id=$1", [locationId]);
    expect(await profileFor(userId, locationId)).toEqual(observed);
    expect(await profileFor(userId + 100000, locationId)).toBeNull();
    expect(prof.services).toEqual(['Roof repair','Gutter guards']);expect(prof.service_areas).toEqual(['Town, WA, USA']);
    expect(prof.hours).toMatchObject({Monday:'8:00 AM – 5:30 PM',Tuesday:'Closed'});expect(prof.social_profiles).toMatchObject({facebook:'https://www.facebook.com/fixture'});expect(prof.social_profiles.text_messaging).toBeUndefined();
    const media=(await pool.query('SELECT name,source,category,google_url,attribution FROM gbp_media WHERE location_id=$1 ORDER BY source,name',[locationId])).rows;
    expect(media.map((m:any)=>m.name.split('/').pop())).toEqual(['b1','b2','b3','c1']);
    expect(media[0]).toMatchObject({source:'business',category:'EXTERIOR',google_url:'https://lh3.example/b1'});expect(media[3]).toMatchObject({source:'customer',attribution:'Happy Customer'});
    expect((await pool.query('SELECT value::text FROM gbp_daily_metrics WHERE location_id=$1',[locationId])).rows).toEqual([{value:'0'}]);
  });
  it('does not erase a saved profile when Google returns an incomplete or mismatched successful response', async () => {
    const before=(await pool.query('SELECT description,phone,services,hours FROM business_locations WHERE id=$1',[locationId])).rows[0];
    for (const invalid of [{}, {name:'locations/wrong',title:'Wrong location'}]) {
      const incomplete=new GoogleClient(async()=>'fixture',async(url,init)=>new URL(String(url)).pathname==='/v1/locations/fixture'
        ? new Response(JSON.stringify(invalid)) : http(url,init),new Limiter(()=>0,async()=>{}),async()=>{});
      expect(await syncLocation(userId,locationId,incomplete)).toMatchObject({profile:{kind:'invalid',message:expect.stringContaining('saved data was preserved')}});
      expect((await pool.query('SELECT description,phone,services,hours FROM business_locations WHERE id=$1',[locationId])).rows[0]).toEqual(before);
    }
  });
  it('reconciles removed social links, preserves local-only fields and reports optional sync failures', async () => {
    await pool.query(`UPDATE business_locations SET social_profiles=$2 WHERE id=$1`, [locationId,
      JSON.stringify({facebook:'https://facebook.com/old',instagram:'https://instagram.com/removed',custom:'https://example.invalid/local'})]);
    await syncLocation(userId,locationId,client);
    const read = async () => (await pool.query('SELECT social_profiles,business_photo_count FROM business_locations WHERE id=$1',[locationId])).rows[0];
    expect((await read()).social_profiles).toEqual({facebook:'https://www.facebook.com/fixture',custom:'https://example.invalid/local'});
    const failing = new GoogleClient(async () => 'fixture', async (url, init) => {
      if (String(url).includes('/attributes') || String(url).includes('/media')) return new Response('{}',{status:403});
      return http(url,init);
    }, new Limiter(()=>0,async()=>{}),async()=>{});
    const result:any = await syncLocation(userId,locationId,failing);
    expect(result.profile.warnings).toHaveLength(3);
    expect((await read()).social_profiles.facebook).toBe('https://www.facebook.com/fixture');
    expect((await read()).business_photo_count).toBe(3); // failed photo lists keep the previous synced gallery count
    expect((await pool.query("SELECT last_error FROM gbp_sync_status WHERE location_id=$1 AND kind='profile'",[locationId])).rows[0].last_error).toContain('Social profiles');
    const empty = new GoogleClient(async () => 'fixture', async (url, init) => String(url).includes('/attributes')
      ? new Response('{}') : http(url,init), new Limiter(()=>0,async()=>{}),async()=>{});
    await syncLocation(userId,locationId,empty);
    expect((await read()).social_profiles).toEqual({custom:'https://example.invalid/local'});
  });
  it('does not apply a partial multi-page snapshot and upserts every successful page',async()=>{
    const before=(await pool.query('SELECT comment FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].comment;
    reviewPaging=true;failSecondPage=true;await syncLocation(userId,locationId,client);
    expect((await pool.query('SELECT comment FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].comment).toBe(before);
    failSecondPage=false;await syncLocation(userId,locationId,client);
    expect((await pool.query('SELECT id FROM google_profile_reviews WHERE user_id=$1 AND google_deleted=false',[userId])).rows).toHaveLength(2);
    reviewPaging=false;reviewRows=[fixtureReview()];await syncLocation(userId,locationId,client);
  });
  it('keeps drafts local, preserves confirmed state on failure, then publishes and deletes on acknowledgement',async()=>{
    http.mockClear();await reply(userId,reviewId,'Draft only','draft',client);expect(http).not.toHaveBeenCalled();
    expect((await pool.query('SELECT reply_comment,reply_draft FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0]).toEqual({reply_comment:null,reply_draft:'Draft only'});
    failReply=true;await expect(reply(userId,reviewId,'Publish attempt','publish',client)).rejects.toMatchObject({kind:'permission'});
    expect((await pool.query('SELECT reply_status,reply_comment FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0]).toEqual({reply_status:'draft',reply_comment:null});
    failReply=false;expect(await reply(userId,reviewId,'Confirmed','publish',client)).toMatchObject({replyStatus:'posted',replyComment:'Confirmed'});
    failReply=true;await expect(reply(userId,reviewId,'','delete',client)).rejects.toThrow();expect((await pool.query('SELECT reply_comment FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].reply_comment).toBe('Confirmed');
    failReply=false;expect(await reply(userId,reviewId,'','delete',client)).toMatchObject({replyStatus:'draft',replyComment:null});
  });
  it('shares pacing across limiter instances and schedules only due locations',async()=>{
    const a=new DatabaseLimiter(),b=new DatabaseLimiter();const times:number[]=[];
    await Promise.all([a,b,a].map(async l=>{await l.take();times.push(Date.now())}));
    times.sort((a,b)=>a-b);expect(times[2]-times[0]).toBeGreaterThanOrEqual(390);
    const sync=vi.fn(async()=>({}));await runGbpWorker(sync);expect(sync).not.toHaveBeenCalled();
    await pool.query("UPDATE gbp_sync_status SET last_attempt=now()-interval '7 hours' WHERE location_id=$1",[locationId]);
    await runGbpWorker(sync);expect(sync).toHaveBeenCalledWith(userId,locationId);
    // An account whose plan lapsed is not synced on schedule (no Google quota spent).
    await pool.query("UPDATE subscriptions SET status='canceled' WHERE user_id=$1",[userId]);
    await pool.query("UPDATE gbp_sync_status SET last_attempt=now()-interval '7 hours' WHERE location_id=$1",[locationId]);
    sync.mockClear();await runGbpWorker(sync);expect(sync).not.toHaveBeenCalledWith(userId,locationId);
    await pool.query("UPDATE subscriptions SET status='active' WHERE user_id=$1",[userId]);
  });
  it('rejects cross-user sync and replies',async()=>{await expect(syncLocation(otherId,locationId,client)).rejects.toMatchObject({status:404});await expect(reply(otherId,reviewId,'x','publish',client)).rejects.toMatchObject({status:404})});
  it('binds callback identity without logging in as the Google account, and disconnects despite remote revoke failure',async()=>{
    const handlers=new Map<string,any>();const app:any={use:vi.fn()};
    for(const method of ['get','post','patch','delete']) app[method]=(path:string,fn:any)=>handlers.set(`${method} ${path}`,fn);
    registerGbpRoutes(app,()=>({id:userId}),{afterConnect:async()=>{}});
    const res:any={redirect:vi.fn(),json:vi.fn(),status:vi.fn().mockReturnThis()};
    const tokenHttp=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'oauth-fixture',refresh_token:'oauth-refresh',scope:GBP_SCOPE,expires_in:3600}))).mockResolvedValueOnce(new Response(JSON.stringify({sub:'different-google-account',email:'linked@example.invalid',email_verified:true})));
    vi.stubGlobal('fetch',tokenHttp);
    try {
      await handlers.get('get /api/gbp/callback')({headers:{},session:{gbpOAuth:{state:'bound',userId,expires:Date.now()+60000,redirect:'http://127.0.0.1:8139/api/gbp/callback'}},query:{state:'bound',code:'fixture-code'}},res);
      expect(res.redirect).toHaveBeenCalledWith('/locations?gbp=connected');expect(await grantStatus(userId)).toMatchObject({connected:true,email:'linked@example.invalid'});
      const user=(await pool.query('SELECT email FROM users WHERE id=$1',[userId])).rows[0];expect(user.email).not.toBe('linked@example.invalid');
      tokenHttp.mockReset().mockResolvedValue(new Response('{}',{status:503}));
      await handlers.get('post /api/gbp/disconnect')({user:{id:userId},headers:{},session:{recentAuth:{userId,at:Date.now()}}},res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({connected:false,revoked:false}));expect((await grantStatus(userId)).connected).toBe(false);
      expect(tokenHttp.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke');
      const left=await pool.query(`SELECT (SELECT count(*) FROM google_profile_reviews WHERE user_id=$1 AND google_review_id LIKE 'accounts/%') reviews,(SELECT count(*) FROM gbp_daily_metrics WHERE location_id=$2) metrics,(SELECT count(*) FROM gbp_sync_status WHERE location_id=$2) sync,(SELECT count(*) FROM business_locations WHERE id=$2) locations`,[userId,locationId]);
      expect(left.rows[0]).toMatchObject({reviews:'0',metrics:'0',locations:'1'});
      expect((await pool.query("SELECT profile_snapshot FROM gbp_sync_status WHERE location_id=$1 AND kind='profile'", [locationId])).rows[0].profile_snapshot).toBeNull();
    }finally {vi.unstubAllGlobals()}
  });

});
describe('per-location unlink',()=>{
  it('keeps the location, drops its Google link and synced data, and marks it so connecting does not re-link it',async()=>{
    await expect(unlinkLocation(otherId,locationId)).rejects.toMatchObject({status:404});
    await unlinkLocation(userId,locationId);
    const {rows:[l]}=await pool.query('SELECT * FROM business_locations WHERE id=$1',[locationId]);
    expect(l).toMatchObject({gbp_location_name:null,gbp_account_name:null,gbp_google_subject:null,gbp_unlinked_by_user:true});
    const left=await pool.query(`SELECT (SELECT count(*) FROM google_profile_reviews WHERE location_id=$1 AND google_review_id LIKE 'accounts/%') r,(SELECT count(*) FROM gbp_daily_metrics WHERE location_id=$1) m,(SELECT count(*) FROM gbp_sync_status WHERE location_id=$1) s`,[locationId]);
    expect(left.rows[0]).toEqual({r:'0',m:'0',s:'0'});
  });
});

describe('automatic linking after Google connect', () => {
  it('uses the connected account, links a matching Place ID, respects explicit unlink and syncs existing links', async () => {
    const ids:number[] = [];
    try {
      for (const [place, blocked] of [['auto-match',false],['auto-blocked',true]] as const) {
        ids.push((await pool.query(`INSERT INTO business_locations(user_id,business_name,place_id,gbp_unlinked_by_user) VALUES($1,'Auto-link fixture',$2,$3) RETURNING id`,[otherId,place,blocked])).rows[0].id);
      }
      const client = new GoogleClient(async () => 'fixture', async url => new Response(JSON.stringify(String(url).includes('/accounts?')
        ? {accounts:[{name:'accounts/auto'}]}
        : {locations:['match','blocked'].map(name=>({name:`locations/${name}`,title:'Auto-link fixture',metadata:{placeId:`auto-${name}`}}))})),new Limiter(()=>0,async()=>{}),async()=>{});
      const make = vi.fn(()=>client), sync = vi.fn(async()=>({}));
      await autoLinkAndSync(otherId,'connected-subject',make,sync);
      await autoLinkAndSync(otherId,'connected-subject',make,sync);
      expect(make).toHaveBeenCalledWith(otherId,'connected-subject');
      const rows=(await pool.query('SELECT id,gbp_location_name,gbp_google_subject FROM business_locations WHERE id=ANY($1) ORDER BY id',[ids])).rows;
      expect(rows[0]).toMatchObject({gbp_location_name:'locations/match',gbp_google_subject:'connected-subject'});
      expect(rows[1].gbp_location_name).toBeNull();
      expect(sync).toHaveBeenCalledTimes(2);
      expect(sync).toHaveBeenCalledWith(otherId,ids[0],client);
    } finally { await pool.query('DELETE FROM business_locations WHERE id=ANY($1)',[ids]); }
  });
});
