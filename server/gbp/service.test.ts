import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {pool} from '../db';
import {ensureGbpSchema} from './schema';
import {DatabaseLimiter} from './quota';
import {registerGbpRoutes} from './routes';
import {saveGrant,grantStatus,accessToken} from './grants';
import {GBP_SCOPE,GoogleClient,Limiter} from './client';
import {discover,importLocations,syncLocation,reply,runGbpWorker} from './service';
let userId:number,otherId:number,locationId:number,reviewId:number;
let reviewRows:any[]=[];let failReviews=false, failReply=false;let reviewPaging=false,failSecondPage=false;
const today=new Date();today.setUTCDate(today.getUTCDate()-2);const metricDate={year:today.getUTCFullYear(),month:today.getUTCMonth()+1,day:today.getUTCDate()};
const fixtureReview=()=>({name:'accounts/fixture/locations/fixture/reviews/review1',reviewId:'review1',reviewer:{displayName:'Fixture Customer'},starRating:'FIVE',comment:'Fixture review',createTime:'2026-09-01T00:00:00Z',updateTime:'2026-09-02T00:00:00Z'});
const http=vi.fn(async(input:any,options:any)=>{
  const url=new URL(input);let body:any={};let status=200;
  if(url.pathname==='/v1/accounts') body={accounts:[{name:'accounts/fixture',accountName:'Fixture account'},{name:'accounts/denied'}]};
  else if(url.pathname==='/v1/accounts/denied/locations'){body={error:{code:403}};status=403;}
  else if(url.pathname.endsWith('/locations')) body={locations:[{name:'locations/fixture',title:'Fixture business'}]};
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
});
afterAll(async()=>{await pool.query('DELETE FROM google_profile_reviews WHERE user_id=ANY($1)',[[userId,otherId]]);await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1)',[[userId,otherId]]);await pool.query('DELETE FROM users WHERE id=ANY($1)',[[userId,otherId]]);await pool.end()});
describe('GBP persistence and state machines (mocked HTTP, real lane Postgres)',()=>{
  it('refuses basic login scopes and binds the grant to its Google subject',async()=>{
    await expect(saveGrant(userId,{sub:'google-a',email:'a@example.invalid',email_verified:true},{access_token:'a',scope:'openid email'})).rejects.toThrow('not granted');
    expect((await grantStatus(userId)).connected).toBe(false);
    await saveGrant(userId,{sub:'google-a',email:'a@example.invalid',email_verified:true},{access_token:'a',refresh_token:'ra',scope:GBP_SCOPE});
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'b',scope:GBP_SCOPE});
    expect((await pool.query('SELECT refresh_token FROM gbp_grants WHERE user_id=$1',[userId])).rows[0].refresh_token).toBeNull();
    expect(await grantStatus(userId)).toMatchObject({connected:true,email:'b@example.invalid'});
    expect(JSON.stringify(await grantStatus(userId))).not.toContain('access_token');
  });
  it('refreshes expired tokens once; invalid_grant requests reconnect without deleting history',async()=>{
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'expired',refresh_token:'rb',scope:GBP_SCOPE,expires_in:-1});
    const tokenHttp=vi.fn(async()=>new Response(JSON.stringify({access_token:'fresh',expires_in:3600})));
    expect(await Promise.all([accessToken(userId,tokenHttp),accessToken(userId,tokenHttp)])).toEqual(['fresh','fresh']);expect(tokenHttp).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE gbp_grants SET expires_at=now()-interval '1 hour' WHERE user_id=$1",[userId]);
    await expect(accessToken(userId,async()=>new Response(JSON.stringify({error:'invalid_grant'}),{status:400}))).rejects.toMatchObject({kind:'auth'});
    expect(await grantStatus(userId)).toMatchObject({connected:false,reconnectRequired:true});
    await saveGrant(userId,{sub:'google-b',email:'b@example.invalid',email_verified:true},{access_token:'fresh',scope:GBP_SCOPE});
  });
  it('surfaces per-account errors and imports only verified canonical resources idempotently',async()=>{
    const d=await discover(client);expect(d.errors[0]).toMatchObject({account:'accounts/denied',kind:'permission'});
    await expect(importLocations(userId,[{accountResource:'accounts/fake',gbpName:'locations/fake'}],client)).rejects.toMatchObject({kind:'permission'});
    await importLocations(userId,[{...d.locations[0],businessName:'Untrusted client name'}],client);await importLocations(userId,d.locations,client);
    const {rows}=await pool.query('SELECT * FROM business_locations WHERE user_id=$1',[userId]);expect(rows).toHaveLength(1);expect(rows[0].business_name).toBe('Fixture business');locationId=rows[0].id;
  });
  it('upserts edits and reconciles deletions only after complete successful review sync',async()=>{
    reviewRows=[fixtureReview()];await syncLocation(userId,locationId,client);reviewRows[0].comment='Updated by Google';await syncLocation(userId,locationId,client);
    let rows=(await pool.query('SELECT * FROM google_profile_reviews WHERE user_id=$1',[userId])).rows;expect(rows).toHaveLength(1);expect(rows[0].comment).toBe('Updated by Google');reviewId=rows[0].id;
    failReviews=true;expect(await syncLocation(userId,locationId,client)).toMatchObject({reviews:{kind:'permission'}});expect((await pool.query('SELECT google_deleted FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].google_deleted).toBe(false);
    failReviews=false;reviewRows=[];await syncLocation(userId,locationId,client);expect((await pool.query('SELECT google_deleted FROM google_profile_reviews WHERE id=$1',[reviewId])).rows[0].google_deleted).toBe(true);
    reviewRows=[fixtureReview()];await syncLocation(userId,locationId,client);
    const statuses=(await pool.query('SELECT * FROM gbp_sync_status WHERE location_id=$1',[locationId])).rows;expect(statuses.every(s=>s.last_success&&!s.last_error)).toBe(true);
    expect((await pool.query('SELECT value::text FROM gbp_daily_metrics WHERE location_id=$1',[locationId])).rows).toEqual([{value:'0'}]);
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
  });
  it('rejects cross-user sync and replies',async()=>{await expect(syncLocation(otherId,locationId,client)).rejects.toMatchObject({status:404});await expect(reply(otherId,reviewId,'x','publish',client)).rejects.toMatchObject({status:404})});
  it('binds callback identity without logging in as the Google account, and disconnects despite remote revoke failure',async()=>{
    const handlers=new Map<string,any>();const app:any={};
    for(const method of ['get','post','patch','delete']) app[method]=(path:string,fn:any)=>handlers.set(`${method} ${path}`,fn);
    registerGbpRoutes(app,()=>({id:userId}));
    const res:any={redirect:vi.fn(),json:vi.fn(),status:vi.fn().mockReturnThis()};
    const tokenHttp=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'oauth-fixture',refresh_token:'oauth-refresh',scope:GBP_SCOPE,expires_in:3600}))).mockResolvedValueOnce(new Response(JSON.stringify({sub:'different-google-account',email:'linked@example.invalid',email_verified:true})));
    vi.stubGlobal('fetch',tokenHttp);
    try {
      await handlers.get('get /api/gbp/callback')({session:{gbpOAuth:{state:'bound',userId,expires:Date.now()+60000,redirect:'http://127.0.0.1:8139/api/gbp/callback'}},query:{state:'bound',code:'fixture-code'}},res);
      expect(res.redirect).toHaveBeenCalledWith('/locations?gbp=connected');expect(await grantStatus(userId)).toMatchObject({connected:true,email:'linked@example.invalid'});
      const user=(await pool.query('SELECT email FROM users WHERE id=$1',[userId])).rows[0];expect(user.email).not.toBe('linked@example.invalid');
      tokenHttp.mockReset().mockResolvedValue(new Response('{}',{status:503}));
      await handlers.get('post /api/gbp/disconnect')({},res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({connected:false,revoked:false}));expect((await grantStatus(userId)).connected).toBe(false);
      expect(tokenHttp.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke');
    }finally {vi.unstubAllGlobals()}
  });

});
