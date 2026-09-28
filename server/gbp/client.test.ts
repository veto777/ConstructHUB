import { describe,it,expect,vi } from 'vitest';
import {GoogleClient,Limiter,classify,mapPerformance,mapLocation,performancePath,resource} from './client';
const response=(body:any,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
const limiter=()=>new Limiter(()=>0,async()=>{});
describe('Google HTTP boundary',()=>{
  it('paces concurrent callers below 300 QPM',async()=>{let now=0;const times:number[]=[];const l=new Limiter(()=>now,async ms=>{now+=ms});await Promise.all(Array.from({length:301},async()=>{await l.take();times.push(now)}));expect(now).toBe(60300);expect(times[300]-times[0]).toBeGreaterThanOrEqual(60000)});
  it('paginates and encodes opaque tokens',async()=>{const http=vi.fn().mockResolvedValueOnce(response({accounts:[{name:'accounts/1'}],nextPageToken:'a+/='})).mockResolvedValueOnce(response({accounts:[{name:'accounts/2'}]}));const c=new GoogleClient(async()=> 'test',http,limiter());expect(await c.pages('accounts','/v1/accounts','accounts')).toHaveLength(2);expect(String(http.mock.calls[1][0])).toContain('pageToken=a%2B%2F%3D');expect(String(http.mock.calls[0][0])).toContain('pageSize=20')});
  it('rejects repeated tokens instead of looping',async()=>{const http=vi.fn(async()=>response({reviews:[],nextPageToken:'repeat'}));await expect(new GoogleClient(async()=>'',http,limiter()).pages('reviews','/v4/accounts/1/locations/2/reviews','reviews')).rejects.toThrow('repeated')});
  it.each([[401,{},'auth'],[403,{},'permission'],[429,{},'quota'],[503,{},'transient'],[400,{error:'invalid_grant'},'auth'],[403,{error:{details:[{reason:'SERVICE_DISABLED'}]}},'disabled'],[403,{error:{errors:[{reason:'accessNotConfigured'}]}},'disabled']] as const)('classifies %s %j',(status,body,kind)=>expect(classify(status,body,'information').kind).toBe(kind));
  it('names the disabled API exactly',()=>expect(classify(403,{error:'SERVICE_DISABLED'},'performance').message).toBe('Enable Business Profile Performance API in Google Cloud'));
  it('retries transient errors but never permission errors',async()=>{const wait=vi.fn(async()=>{});const http=vi.fn().mockResolvedValueOnce(response({},503)).mockResolvedValueOnce(response({accounts:[]}));await new GoogleClient(async()=>'',http,limiter(),wait).pages('accounts','/v1/accounts','accounts');expect(wait).toHaveBeenCalledTimes(1);http.mockReset().mockResolvedValue(response({},403));await expect(new GoogleClient(async()=>'',http,limiter(),wait).pages('accounts','/v1/accounts','accounts')).rejects.toMatchObject({kind:'permission'});expect(http).toHaveBeenCalledTimes(1)});
  it('preserves retry-after and bounds attempts',async()=>{const wait=vi.fn(async()=>{}),http=vi.fn(async()=>response({},429,{'Retry-After':'5'}));await expect(new GoogleClient(async()=>'',http,limiter(),wait).pages('accounts','/v1/accounts','accounts')).rejects.toMatchObject({kind:'quota'});expect(http).toHaveBeenCalledTimes(4);expect(wait.mock.calls.every((args:any)=>args[0]>=5000)).toBe(true)});
  it('maps missing fields to null and rejects resource path injection',()=>{expect(mapLocation({name:'accounts/1'},{name:'locations/2',title:'Fixture'})).toMatchObject({phone:null,country:null,placeId:null});expect(()=>resource('locations/../x','locations')).toThrow()});
  it('maps protobuf zero but leaves absent dates and series unavailable',()=>{const body={multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[{dailyMetric:'CALL_CLICKS',timeSeries:{datedValues:[{date:{year:2026,month:9,day:1}},{date:{year:2026,month:9,day:2},value:'12'}]}}]}]};expect(mapPerformance(body)).toEqual([{date:'2026-09-01',metric:'CALL_CLICKS',value:0},{date:'2026-09-02',metric:'CALL_CLICKS',value:12}]);expect(mapPerformance({})).toEqual([]);expect(performancePath('locations/2','2026-09-01','2026-09-02')).toContain('dailyRange.start_date.month=9')});
  it('never treats a malformed HTTP 200 as an empty snapshot',async()=>{
    for(const body of ['not-json','null','[]','{"error":{"code":403}}']){
      const http=vi.fn(async()=>new Response(body));await expect(new GoogleClient(async()=>'',http,limiter()).pages('reviews','/v4/accounts/1/locations/2/reviews','reviews')).rejects.toMatchObject({kind:'transient'});
    }
  });
  it('uses the documented review and location page limits',async()=>{
    const http=vi.fn(async()=>response({}));const c=new GoogleClient(async()=>'',http,limiter());
    await c.pages('reviews','/v4/accounts/1/locations/2/reviews','reviews');await c.pages('information','/v1/accounts/1/locations','locations');
    expect(String(http.mock.calls[0][0])).toContain('pageSize=50');expect(String(http.mock.calls[1][0])).toContain('pageSize=100');
  });

});
