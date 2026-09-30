import {afterAll, beforeAll, expect, it, vi} from 'vitest';
import {pool} from '../db';
import {GBP_SCOPE} from './client';
import {saveGrant, purgeGoogleData} from './grants';
import {previewSnapshot, configureGuard, checkGuard} from './guard';
import {reply, unlinkLocation, syncLocation} from './service';
import {defaults, saveReplySettings} from './review-automation';

vi.mock('../email',()=>({sendWithFallback:vi.fn(async()=>({success:true}))}));
let user:number;
const locations:number[]=[];
const reviews:number[]=[];
const calls:{path:string;token:string;method:string}[]=[];
beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL!);
  if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname)||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('a local development DB is required');
  user=(await pool.query("INSERT INTO users(email) VALUES('audit-a2-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows[0].id;
  vi.stubGlobal('fetch',vi.fn(async(input:any,options:any)=>{
    const url=new URL(input);
    const match=url.pathname.match(/locations\/(audit[ab])/);
    if(!match)throw Error('Unexpected fixture request');
    const key=match[1], token=options.headers.Authorization;
    calls.push({path:url.pathname,token,method:options.method});
    expect(token).toBe(`Bearer fixture-${key}`);
    if(url.pathname.endsWith('/reply'))return new Response(JSON.stringify(options.method==='DELETE'?{}:{comment:JSON.parse(options.body).comment}));
    if(url.pathname.endsWith('/reviews'))return new Response(JSON.stringify({reviews:[{name:`accounts/${key}/locations/${key}/reviews/fixture`,starRating:'FIVE',reviewer:{displayName:'Audit fixture'},comment:'Fixture review',createTime:'2020-01-01T00:00:00Z'}]}));
    if(url.pathname.endsWith(':getGoogleUpdated'))return new Response('{}');
    if(url.pathname.includes(':fetchMultiDailyMetricsTimeSeries'))return new Response('{}');
    return new Response(JSON.stringify({name:`locations/${key}`,title:`Fixture ${key}`}));
  }));
  for(const key of ['audita','auditb']) {
    await saveGrant(user,{sub:key,email:`${key}@example.invalid`,email_verified:true},{access_token:`fixture-${key}`,scope:GBP_SCOPE});
    const id=(await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,$2,$3,$4,$5) RETURNING id",[user,`Fixture ${key}`,`accounts/${key}`,`locations/${key}`,key])).rows[0].id;
    locations.push(id);
  }
});
afterAll(async()=>{
  vi.unstubAllGlobals();
  await pool.query('DELETE FROM business_locations WHERE user_id=$1',[user]);
  await pool.query('DELETE FROM users WHERE id=$1',[user]);
  await pool.end();
});
it('uses each location grant for Guard, review sync, reply publish/delete and never duplicates import notices',async()=>{
  for(const id of locations) {
    const preview=await previewSnapshot(user,id);
    await configureGuard(user,id,'notify',['title'],preview.token);
    await checkGuard(user,id);
    await syncLocation(user,id);await syncLocation(user,id);
    const review=(await pool.query('SELECT id FROM google_profile_reviews WHERE user_id=$1 AND location_id=$2',[user,id])).rows[0].id;
    reviews.push(review);
    await reply(user,review,'Fixture reply','publish');await reply(user,review,'','delete');
    await saveReplySettings(user,id,{...defaults,mode:'draft'});
  }
  expect((await pool.query("SELECT count(*)::int n FROM user_notifications WHERE user_id=$1 AND kind='gbp.new_review'",[user])).rows[0].n).toBe(2);
  expect(calls.filter(c=>c.method==='PUT')).toHaveLength(2);
  expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(2);
});
it('disconnecting one account purges only its Guard and AI data; unlink purges the remaining location',async()=>{
  await purgeGoogleData(user,'audita');
  expect((await pool.query('SELECT location_id FROM gbp_guard WHERE user_id=$1',[user])).rows).toEqual([{location_id:locations[1]}]);
  expect((await pool.query('SELECT location_id FROM gbp_reply_settings WHERE user_id=$1',[user])).rows).toEqual([{location_id:locations[1]}]);
  expect((await pool.query('SELECT review_id FROM gbp_review_automation WHERE user_id=$1',[user])).rows).toEqual([{review_id:reviews[1]}]);
  await unlinkLocation(user,locations[1]);
  for(const table of ['gbp_guard','gbp_guard_changes','gbp_reply_settings','gbp_review_automation'])expect((await pool.query(`SELECT * FROM ${table} WHERE user_id=$1`,[user])).rows).toHaveLength(0);
  const count=calls.length;
  await expect(previewSnapshot(user,locations[1])).rejects.toMatchObject({status:400});
  expect(calls).toHaveLength(count);
});
