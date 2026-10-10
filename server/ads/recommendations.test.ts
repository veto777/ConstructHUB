import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SUFFIX, negativeLists } from '../../shared/ads-playbook';
import { optimizationSteps, recommendationAction, recommendationInputs } from './playbook';
import { appliedDocument, buildPlan, emptyState, fingerprint, normalize, protectionInput, readState, STATE_QUERIES, type State } from './protections';
import type { AdsApi } from './client';
const mocks=vi.hoisted(()=>({query:vi.fn(),enqueue:vi.fn(),budget:vi.fn(),activity:vi.fn()}));
vi.mock('../db',()=>({pool:{query:mocks.query}}));
vi.mock('./store',()=>({grant:async()=>({connection_id:'connection'}),account:vi.fn(),enqueue:mocks.enqueue,withAgencyLock:async(_user:number,fn:any)=>fn({query:mocks.query})}));
vi.mock('../growth-limits',()=>({rateLimit:()=> (_req:any,_res:any,next:any)=>next(),takeBudget:mocks.budget}));
vi.mock('../account-events',()=>({logActivity:mocks.activity,notifyUser:vi.fn()}));
vi.mock('../entitlements',()=>({requireModule:()=> (_req:any,_res:any,next:any)=>next()}));
import { registerAdsRoutes } from './routes';
const cid='1234567890',unmapped='1234567891';
const seed=()=>{const s=emptyState();s.campaign=[normalize('campaign',{id:'10',resourceName:`customers/${cid}/campaigns/10`,name:'Search',advertisingChannelType:'SEARCH',geoTargetTypeSetting:{positiveGeoTargetType:'PRESENCE_OR_INTEREST'}})];return s;};
const step=(id:string)=>optimizationSteps.find(s=>s.id===id)!;
describe('Owner-approved recommendations',()=>{
  it('has seven ordered, versioned steps and valid action templates',()=>{
    expect(optimizationSteps.map(s=>s.id)).toEqual(['ip','negative','presence','suffix','schedule','placement','landing-door']);
    for(const s of optimizationSteps) {
      expect(s).toMatchObject({source:'owner-approved-alpine',version:1,requiresClientReview:true});
      if(s.action)expect(protectionInput.safeParse(s.action).success).toBe(true);
    }
    expect(step('landing-door').action).toBeUndefined();
    expect(DEFAULT_SUFFIX).not.toMatch(/(?:^|&)k=/);
  });
  it('defaults to contractor negatives and keeps homeowner intent out of that list',()=>{
    const defaults=recommendationAction(step('negative'),{});
    expect(defaults).toEqual({kind:'negative',mode:'add',name:'ConstructHUB contractor negatives',keywords:negativeLists.contractor});
    for(const word of ['near me','roof repair','roof replacement','hire a contractor']) {
      expect(negativeLists.contractor).not.toContain(word);expect(negativeLists.software).toContain(word);
    }
    expect(recommendationAction(step('negative'),{negative:{list:'software'}})).toHaveProperty('keywords',negativeLists.software);
    const plan=buildPlan(cid,seed(),defaults);
    expect(plan.operations.filter(o=>o.sharedCriterionOperation).every(o=>o.sharedCriterionOperation.create.keyword.matchType==='PHRASE')).toBe(true);
  });
  it('requires user input for schedule and placements and validates completed actions',()=>{
    for(const id of ['schedule','placement'])expect(()=>recommendationAction(step(id),{})).toThrow();
    const inputs=recommendationInputs.parse({schedule:{slots:[{dayOfWeek:'MONDAY',startHour:9,endHour:17}]},placement:{urls:['example.com']}});
    for(const id of ['schedule','placement'])expect(protectionInput.safeParse(recommendationAction(step(id),inputs)).success).toBe(true);
  });
});
describe('Campaign suffix protection',()=>{
  it.each(['?a=b','a=has space','a=b#fragment','a=%ZZ','a={unsupported}','a=x\nb=y','https://example.com','a=b&&c=d','a='+ 'x'.repeat(1000)])('rejects unsafe suffix %s',suffix=>{
    expect(protectionInput.safeParse({kind:'suffix',suffix,mode:'set'}).success).toBe(false);
  });
  it('accepts encoded values and all supported ValueTrack tokens',()=>{
    expect(protectionInput.safeParse({kind:'suffix',suffix:DEFAULT_SUFFIX+'&kw={keyword}&ag={adgroupid}&text=a%20b',mode:'append'}).success).toBe(true);
  });
  it.each(['set','append'] as const)('previews %s without writes then applies and reverses through a fake API',async mode=>{
    let state=seed();state.campaign[0].finalUrlSuffix='existing=1';
    const api:AdsApi={search:vi.fn(async(_cid,q)=>{
      const key=Object.entries(STATE_QUERIES).find(([,query])=>query===q)![0] as keyof State;
      return {results:state[key].map(r=>({[key]:r}))};
    }),mutate:vi.fn(async(_cid,operations,validateOnly)=>{
      if(validateOnly)return {};
      const response={mutateOperationResponses:operations.map(o=>({campaignResult:{resourceName:o.campaignOperation.update.resourceName}}))};
      state=appliedDocument({before:state,operations,inverseTemplates:[],summary:[],warnings:[]},response).after;
      return response;
    }),link:vi.fn(),acceptManagerLink:vi.fn()};
    const before=await readState(api,cid),plan=buildPlan(cid,before,{kind:'suffix',suffix:DEFAULT_SUFFIX,mode,campaignIds:['10']});
    expect(api.mutate).not.toHaveBeenCalled();
    const next=mode==='append'?'existing=1&'+DEFAULT_SUFFIX:DEFAULT_SUFFIX;
    expect(plan.summary).toEqual([`Search: existing=1 → ${next}`]);
    expect(plan.operations[0].campaignOperation).toEqual({update:{resourceName:state.campaign[0].resourceName,finalUrlSuffix:next},updateMask:'final_url_suffix'});
    const response=await api.mutate(cid,plan.operations);
    const applied=appliedDocument(plan,response);
    expect(fingerprint(await readState(api,cid))).toBe(fingerprint(applied.after));
    expect(fingerprint(applied.after)).not.toBe(fingerprint(before));
    await api.mutate(cid,applied.inverse);
    expect(fingerprint(await readState(api,cid))).toBe(fingerprint(before));
  });
  it('detects outside suffix edits and preserves clearing in inverse operations',()=>{
    const s=seed(),before=fingerprint(s),p=buildPlan(cid,s,{kind:'suffix',suffix:DEFAULT_SUFFIX,mode:'set'});
    expect(p.inverseTemplates[0].campaignOperation.update.finalUrlSuffix).toBe('');
    s.campaign[0].finalUrlSuffix='outside=edit';expect(fingerprint(s)).not.toBe(before);
    expect(()=>buildPlan(cid,s,{kind:'suffix',suffix:DEFAULT_SUFFIX,mode:'set',campaignIds:['999']})).toThrow(/missing/);
  });
  it('rejects appended overflow and avoids no-op writes',()=>{
    const s=seed();s.campaign[0].finalUrlSuffix='a='+'x'.repeat(995);
    expect(()=>buildPlan(cid,s,{kind:'suffix',suffix:'b=123',mode:'append'})).toThrow(/1,000/);
    s.campaign[0].finalUrlSuffix=DEFAULT_SUFFIX;
    expect(buildPlan(cid,s,{kind:'suffix',suffix:DEFAULT_SUFFIX,mode:'set'}).operations).toEqual([]);
  });
});
describe('Recommendations preview route',()=>{
  let app:express.Express;
  const call=async(body:any,path='/recommendations/preview')=>{
    const layer=(app.router as any).stack.find((l:any)=>l.route?.path==='/api/ads'+path);
    const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},json(body:any){this.body=body;return this;}};
    await layer.route.stack[0].handle({body},res);return res;
  };
  beforeEach(()=>{
    vi.clearAllMocks();mocks.budget.mockResolvedValue(true);
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT customer_id')?[{customer_id:cid,domain_id:42},{customer_id:unmapped,domain_id:null}]:sql.includes('count(*)')?[{mapped:1}]:[]}));
    app=express();registerAdsRoutes(app,()=>({id:7}));
  });
  it('queues exactly one preview per account and selected step in one transaction, skipping unmapped IPs',async()=>{
    const requestId=randomUUID(),result=await call({selection:{ids:[cid,unmapped]},stepIds:['ip','negative','presence','suffix'],inputs:{},requestId});
    expect(result.statusCode).toBe(202);expect(result.body).toEqual({batchId:requestId,queued:7,skipped:[{customerId:unmapped,stepId:'ip',reason:'Map a Click Guard site first'}]});
    expect(mocks.enqueue).toHaveBeenCalledTimes(7);
    const keys=new Set<string>();
    for(const args of mocks.enqueue.mock.calls){expect(args[2]).toBe('preview');expect(args[3]).not.toHaveProperty('confirm');expect(protectionInput.safeParse(args[3].action).success).toBe(true);expect(args[5]).toBe(requestId);keys.add(args[6]);}
    expect(keys.size).toBe(7);expect(mocks.query).toHaveBeenCalledWith('BEGIN');expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  });
  it('uses stable dedupe keys for repeated requests and removes duplicate step IDs',async()=>{
    const body={selection:{filter:{q:'',lsa:''}},stepIds:['presence','presence'],inputs:{},requestId:randomUUID()};
    await call(body);await call(body);
    expect(mocks.enqueue).toHaveBeenCalledTimes(4);expect(mocks.enqueue.mock.calls[0][6]).toBe(mocks.enqueue.mock.calls[2][6]);
  });
  it.each([[],['landing-door'],['unknown'],['schedule'],['placement']])('rejects invalid or incomplete selected steps %j before queueing',async stepIds=>{
    const result=await call({selection:{ids:[cid,unmapped]},stepIds,inputs:{},requestId:randomUUID()});
    expect(result.statusCode).toBe(400);expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rejects arbitrary operations and cross-agency account selections',async()=>{
    const body={selection:{ids:[cid,unmapped]},stepIds:['suffix'],inputs:{suffix:{suffix:DEFAULT_SUFFIX,mode:'set',operations:[]}},requestId:randomUUID()};
    expect((await call(body)).statusCode).toBe(400);
    expect((await call({...body,selection:{ids:['5555555555']},inputs:{}})).statusCode).toBe(404);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('counts mapped accounts for the selection and rolls back enqueue failures',async()=>{
    expect((await call({selection:{ids:[cid,unmapped]}},'/recommendations/scope')).body).toEqual({total:2,mapped:1});
    mocks.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    expect((await call({selection:{ids:[cid,unmapped]},stepIds:['presence'],requestId:randomUUID()})).statusCode).toBe(500);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
