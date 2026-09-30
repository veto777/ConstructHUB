import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {pool} from '../db';
const base=process.env.CRM_TEST_BASE_URL || 'http://127.0.0.1:8139';
let id:number,reviewId:number;
const call=async(path:string,method='GET',body?:unknown)=>{
  const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():null};
};
beforeAll(async()=>{
  const target=new URL(process.env.DATABASE_URL!);
  if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.startsWith('/constructhub_dev'))throw new Error('Local development DB required');
  const status=await call('/api/gbp/status');
  // Refuse to exercise a real account. This suite requires the disconnected dev-bypass user.
  if(status.status!==200||status.body.connected||status.body.email)throw new Error('GBP HTTP tests require a disconnected development user');
  const {rows:[l]}=await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name) VALUES(1,'GBP HTTP fixture','accounts/httpfixture','locations/httpfixture') RETURNING id");id=l.id;
});
afterAll(async()=>{if(reviewId)await pool.query('DELETE FROM google_profile_reviews WHERE id=$1',[reviewId]);if(id)await pool.query('DELETE FROM business_locations WHERE id=$1',[id]);await pool.end()});
describe('GBP real HTTP routes without a Google grant',()=>{
  it('rejects discovery/import and reports each failed sync independently',async()=>{
    expect((await call('/api/gbp/accounts')).status).toBe(401);expect((await call('/api/gbp/locations')).status).toBe(401);
    expect((await call('/api/gbp/import','POST',{locations:[{accountResource:'accounts/httpfixture',gbpName:'locations/httpfixture'}]})).status).toBe(401);
    const sync=await call(`/api/gbp/locations/${id}/sync`,'POST',{});expect(sync.status).toBe(200);expect(sync.body).toMatchObject({reviews:{kind:'auth'},performance:{kind:'auth'}});
    const status=await call('/api/gbp/status');expect(status.body.locations.filter((l:any)=>l.id===id).every((l:any)=>l.last_error&&!l.last_success)).toBe(true);expect(JSON.stringify(status.body)).not.toMatch(/access_token|refresh_token/);
  });
  it('preserves the actionable profile error when importing a disconnected linked location', async () => {
    const result = await call(`/api/locations/${id}/import-google`, 'POST', {});
    expect(result.status).toBe(409);
    expect(result.body.message).toMatch(/connect|Reconnect/i);
    expect(result.body.message).not.toBe('GBP operation failed. Try again.');
  });
  it('saves a draft without posting and preserves it when disconnected publish/delete fail',async()=>{
    const created=await call('/api/google-profile-reviews','POST',{reviewerName:'GBP HTTP fixture',rating:5,reviewDate:'2026-09-01',locationId:id});expect(created.status).toBe(200);reviewId=created.body.id;
    const draft=await call(`/api/google-profile-reviews/${reviewId}/reply`,'PATCH',{replyComment:'Local draft',action:'draft'});expect(draft.body.replyDraft).toBe('Local draft');
    expect((await call(`/api/google-profile-reviews/${reviewId}/reply`,'PATCH',{replyComment:'Publish',action:'publish'})).status).toBe(401);
    expect((await call(`/api/google-profile-reviews/${reviewId}/reply`,'DELETE')).status).toBe(401);
    const list=await call(`/api/google-profile-reviews?locationId=${id}`);expect(list.body.find((r:any)=>r.id===reviewId)).toMatchObject({replyDraft:'Local draft',replyComment:null,replyStatus:'draft'});
    expect((await call(`/api/google-profile-reviews/${reviewId}/note`,'PATCH',{internalNote:'Fixture note'})).status).toBe(200);
  });
  it('returns unavailable performance and retires legacy random analytics',async()=>{
    expect((await call(`/api/gbp/locations/${id}/performance`)).body).toMatchObject({available:false,rows:[]});
    expect((await call(`/api/locations/${id}/analytics`)).body).toMatchObject({available:false,source:null});
    expect((await call(`/api/locations/${id}/analytics/seed`,'POST',{})).status).toBe(410);
  });
  it('cannot forge canonical resource identity with a local location edit',async()=>{
    expect((await call(`/api/locations/${id}`,'PUT',{gbpAccountName:'accounts/forged',gbpLocationName:'locations/forged'})).status).toBe(200);
    expect((await call(`/api/locations/${id}`)).body).toMatchObject({gbpAccountName:'accounts/httpfixture',gbpLocationName:'locations/httpfixture'});
  });
});
