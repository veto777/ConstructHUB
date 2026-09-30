import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { AdsError, type AdsApi, searchAll } from './client';
const days = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'] as const;
const slot = z.object({dayOfWeek:z.enum(days), startHour:z.number().int().min(0).max(23), startMinute:z.enum(['ZERO','FIFTEEN','THIRTY','FORTY_FIVE']).default('ZERO'), endHour:z.number().int().min(0).max(24), endMinute:z.enum(['ZERO','FIFTEEN','THIRTY','FORTY_FIVE']).default('ZERO')}).strict();
const minute = (m:string) => ['ZERO','FIFTEEN','THIRTY','FORTY_FIVE'].indexOf(m)*15;
const schedule = z.array(slot).min(1).max(42).superRefine((slots,c)=> {
  for(const day of days) {
    const s=slots.filter(s=>s.dayOfWeek===day).sort((a,b)=>a.startHour*60+minute(a.startMinute)-b.startHour*60-minute(b.startMinute));
    if(s.length>6 || s.some((s,i)=>s.endHour*60+minute(s.endMinute)<=s.startHour*60+minute(s.startMinute) || (s.endHour===24 && s.endMinute!=='ZERO') || (i>0 && s.startHour*60+minute(s.startMinute)<slotsEnd(s,i)))) c.addIssue({code:'custom',message:'Schedules need non-overlapping intervals, at most six per day; midnight ends at 24:00'});
    function slotsEnd(_s:unknown,i:number) {return s[i-1].endHour*60+minute(s[i-1].endMinute);}
  }
});
const common = {campaignIds:z.array(z.string().regex(/^\d+$/)).min(1).max(100).optional()};
export const protectionInput = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('presence'),...common}).strict(),
  z.object({kind:z.literal('schedule'),...common,slots:schedule}).strict(),
  z.object({kind:z.literal('ip'),...common}).strict(),
  z.object({kind:z.literal('negative'),...common,name:z.string().trim().min(1).max(100),keywords:z.array(z.string().trim().min(1).max(80)).min(1).max(500),mode:z.enum(['add','replace']).default('add')}).strict(),
  z.object({kind:z.literal('placement'),urls:z.array(z.string().trim().min(3).max(250).regex(/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[a-zA-Z0-9._~%/-]*)?$/)).min(1).max(500)}).strict(),
]);
export type ProtectionInput = z.infer<typeof protectionInput>;
export const STARTER_NEGATIVES = ['jobs','careers','salary','training','DIY','tutorial','free','cheap'];
export const STATE_QUERIES = {
  campaign: `SELECT campaign.resource_name,campaign.id,campaign.name,campaign.status,campaign.advertising_channel_type,campaign.geo_target_type_setting.positive_geo_target_type FROM campaign WHERE campaign.status != 'REMOVED'`,
  campaignCriterion: `SELECT campaign_criterion.resource_name,campaign_criterion.campaign,campaign_criterion.type,campaign_criterion.negative,campaign_criterion.ip_block.ip_address,campaign_criterion.ad_schedule,campaign_criterion.bid_modifier,campaign_criterion.location.geo_target_constant,campaign_criterion.local_service_id.service_id FROM campaign_criterion WHERE campaign_criterion.status != 'REMOVED' AND campaign_criterion.type IN ('IP_BLOCK','AD_SCHEDULE','LOCATION','LOCAL_SERVICE_ID')`,
  customerNegativeCriterion: `SELECT customer_negative_criterion.resource_name,customer_negative_criterion.placement.url FROM customer_negative_criterion WHERE customer_negative_criterion.type = 'PLACEMENT'`,
  sharedSet: `SELECT shared_set.resource_name,shared_set.name,shared_set.type FROM shared_set WHERE shared_set.status != 'REMOVED' AND shared_set.type = 'NEGATIVE_KEYWORDS'`,
  sharedCriterion: `SELECT shared_criterion.resource_name,shared_criterion.shared_set,shared_criterion.keyword.text,shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.type = 'NEGATIVE_KEYWORDS'`,
  campaignSharedSet: `SELECT campaign_shared_set.resource_name,campaign_shared_set.campaign,campaign_shared_set.shared_set FROM campaign_shared_set WHERE campaign_shared_set.status != 'REMOVED'`,
} as const;
export type ResourceType=keyof typeof STATE_QUERIES;
export type State=Record<ResourceType, any[]>;
export const emptyState=(): State => ({campaign:[],campaignCriterion:[],customerNegativeCriterion:[],sharedSet:[],sharedCriterion:[],campaignSharedSet:[]});
export function normalize(type: ResourceType, r:any) {
  const pick=(keys:string[])=>Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
  if(type==='campaign') return {...pick(['resourceName','id','name','status','advertisingChannelType']),geoTargetTypeSetting:{positiveGeoTargetType:r.geoTargetTypeSetting?.positiveGeoTargetType || 'UNSPECIFIED'}};
  if(type==='campaignCriterion') {
    const v:any={...pick(['resourceName','campaign','ipBlock','location','localServiceId']),negative:r.negative===true};
    if(r.adSchedule) v.adSchedule={dayOfWeek:r.adSchedule.dayOfWeek,startHour:r.adSchedule.startHour||0,startMinute:r.adSchedule.startMinute||'ZERO',endHour:r.adSchedule.endHour||0,endMinute:r.adSchedule.endMinute||'ZERO'};
    if(r.adSchedule) v.bidModifier=Number(r.bidModifier ?? 1);
    return v;
  }
  return pick(type==='customerNegativeCriterion'?['resourceName','placement']:type==='sharedSet'?['resourceName','name','type']:type==='sharedCriterion'?['resourceName','sharedSet','keyword']:['resourceName','campaign','sharedSet']);
}
export async function readState(api:AdsApi,cid:string):Promise<State> {
  const s=emptyState();
  for(const type of Object.keys(STATE_QUERIES) as ResourceType[]) s[type]=(await searchAll(api,cid,STATE_QUERIES[type])).map(r=>normalize(type,r[type]));
  return s;
}
function canonical(v:any):any {return Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export const fingerprint=(s:State)=>createHash('sha256').update(JSON.stringify(canonical(s))).digest('hex');
export type Mutation = Partial<Record<`${ResourceType}Operation`, any>>;
export interface PlanDocument { before:State; operations:Mutation[]; inverseTemplates:Mutation[]; summary:string[]; warnings:string[] }
/** Creates safe API operations only from server-observed resources, never caller-supplied resource names. */
export function buildPlan(cid:string,state:State,input:ProtectionInput,flagged:string[]=[],ages:Record<string,string>={}):PlanDocument {
  const p:PlanDocument={before:state,operations:[],inverseTemplates:[],summary:[],warnings:[]};
  const add=(type:ResourceType,operation:any,inverse:any)=> {p.operations.push({[`${type}Operation`]:operation});p.inverseTemplates.unshift({[`${type}Operation`]:inverse});};
  const create=(type:ResourceType,value:any)=>{const i=p.operations.length; add(type,{create:value},{remove:`$result:${i}`});};
  const remove=(type:ResourceType,r:any)=>{const {resourceName,...value}=r;add(type,{remove:resourceName},{create:value});};
  let campaigns=state.campaign.filter(c=>!inputHasCampaigns(input)||input.campaignIds!.includes(c.id));
  if(inputHasCampaigns(input) && input.campaignIds!.some(id=>!campaigns.some(c=>c.id===id))) throw new AdsError('A selected campaign is missing. Refresh the account.',409);
  if(input.kind!=='placement') {
    const supported=input.kind==='ip'?['SEARCH','DISPLAY']:input.kind==='negative'?['SEARCH','DISPLAY']:['SEARCH','DISPLAY','PERFORMANCE_MAX'];
    const skipped=campaigns.filter(c=>!supported.includes(c.advertisingChannelType));
    if(skipped.length) p.warnings.push(`${skipped.length} unsupported campaigns skipped (${[...new Set(skipped.map(c=>c.advertisingChannelType))].join(', ')}).`);
    campaigns=campaigns.filter(c=>supported.includes(c.advertisingChannelType));
    if(campaigns.length>100) throw new AdsError('Select at most 100 campaigns per account preview.',422);
    if(!campaigns.length) throw new AdsError('No supported campaigns for this protection.',422);
  }
  if(input.kind==='presence') for(const c of campaigns) {
    const old=c.geoTargetTypeSetting.positiveGeoTargetType;
    if(old==='PRESENCE') continue;
    if(!['PRESENCE_OR_INTEREST','SEARCH_INTEREST'].includes(old)) throw new AdsError('Google did not provide a reversible location setting.',422);
    const update=(value:string)=>({update:{resourceName:c.resourceName,geoTargetTypeSetting:{positiveGeoTargetType:value}},updateMask:'geo_target_type_setting.positive_geo_target_type'});
    add('campaign',update('PRESENCE'),update(old));p.summary.push(`${c.name}: ${old} → PRESENCE`);
  }
  if(input.kind==='schedule') for(const c of campaigns) {
    const existing=state.campaignCriterion.filter(r=>r.campaign===c.resourceName && r.adSchedule);
    for(const r of existing) remove('campaignCriterion',r);
    for(const s of input.slots) create('campaignCriterion',{campaign:c.resourceName,adSchedule:s,negative:false});
    p.summary.push(`${c.name}: replace ${existing.length || 'unrestricted'} schedule intervals with ${input.slots.length} intervals in the account timezone.`);
  }
  if(input.kind==='ip') {
    const ips=[...new Set(flagged.filter(ip=>!!isIP(ip)))].slice(0,500);
    if(!ips.length) throw new AdsError('No valid flagged IPs in this account’s mapped Click Guard domain.',422);
    for(const c of campaigns) {
      const existing=state.campaignCriterion.filter(r=>r.campaign===c.resourceName && r.ipBlock);
      const missing=ips.filter(ip=>!existing.some(r=>r.ipBlock.ipAddress===ip));
      const needed=Math.max(0,existing.length+missing.length-500);
      // Protect the newest flagged set; rotate the oldest observed non-flagged blocks first.
      const victims=existing.filter(r=>!ips.includes(r.ipBlock.ipAddress)).sort((a,b)=>(ages[a.resourceName]||'').localeCompare(ages[b.resourceName]||'') || a.resourceName.localeCompare(b.resourceName)).slice(0,needed);
      if(victims.length!==needed) throw new AdsError('Cannot safely fit the selected IP exclusions.',422);
      for(const r of victims) remove('campaignCriterion',r);
      for(const ip of missing) create('campaignCriterion',{campaign:c.resourceName,negative:true,ipBlock:{ipAddress:ip}});
      p.summary.push(`${c.name}: add ${missing.length} IP exclusions, rotate ${victims.length} oldest observed exclusions; ${existing.length-victims.length+missing.length}/500 total.`);
    }
    p.warnings.push('Google does not expose IP creation dates. Rotation uses ConstructHUB first-observed time (resource name breaks ties on initial import). Shared IPs can include legitimate customers.');
  }
  if(input.kind==='placement') {
    for(const url of [...new Set(input.urls.map(s=>s.toLowerCase()))]) {
      if(!state.customerNegativeCriterion.some(r=>r.placement?.url===url)) create('customerNegativeCriterion',{placement:{url}});
    }
    p.summary.push(`Add ${p.operations.length} account-level placement exclusions, including supported Display and Performance Max inventory.`);
    p.warnings.push('Account-wide exclusion: affects all supported campaigns in this client account. Google validation checks support before any write.');
  }
  if(input.kind==='negative') {
    const matches=state.sharedSet.filter(s=>s.name===input.name);
    if(matches.length>1) throw new AdsError('Multiple shared lists have this name. Choose a unique name.',409);
    const set=matches[0]?.resourceName || `customers/${cid}/sharedSets/-1`;
    if(!matches.length) create('sharedSet',{resourceName:set,name:input.name,type:'NEGATIVE_KEYWORDS'});
    const words=[...new Set(input.keywords.map(s=>s.toLowerCase()))];
    if(input.mode==='replace') for(const r of state.sharedCriterion.filter(r=>r.sharedSet===set)) {
      if(r.keyword?.matchType!=='PHRASE' || !words.includes(r.keyword?.text?.toLowerCase())) remove('sharedCriterion',r);
    }
    for(const text of words) if(!state.sharedCriterion.some(r=>r.sharedSet===set && r.keyword?.text?.toLowerCase()===text && r.keyword?.matchType==='PHRASE')) create('sharedCriterion',{sharedSet:set,keyword:{text,matchType:'PHRASE'}});
    for(const c of campaigns) if(!state.campaignSharedSet.some(r=>r.campaign===c.resourceName && r.sharedSet===set)) create('campaignSharedSet',{campaign:c.resourceName,sharedSet:set});
    p.summary.push(`${input.mode==='replace'?'Replace list contents with':'Add missing'} phrase-match negatives to “${input.name}” and attach it to ${campaigns.length} campaigns. Existing list entries remain.`);
    p.warnings.push('An existing shared list also affects campaigns already attached to it. “free” can suppress “free estimate”; review the editable starter list for each client.');
  }
  if(p.operations.length>9000) throw new AdsError('Too many operations; select fewer campaigns.',422);
  if(!p.operations.length) p.summary.push('Already configured; no Google writes needed.');
  return p;
}
function inputHasCampaigns(v:ProtectionInput):v is Exclude<ProtectionInput,{kind:'placement'}> & {campaignIds:string[]} {return 'campaignIds' in v && !!v.campaignIds?.length;}
/** Resolve returned resource names and compute the exact expected state for stale/undo checks. */
export function appliedDocument(doc:PlanDocument,response:any):{inverse:Mutation[];after:State} {
  const results=response.mutateOperationResponses;
  if(!Array.isArray(results) || results.length!==doc.operations.length) throw new AdsError('Google write acknowledgement is incomplete. Reconcile before retrying.',502,true);
  const names=results.map((r:any,i:number)=>{
    const type=Object.keys(doc.operations[i])[0].replace(/Operation$/,'');
    const name=r[`${type}Result`]?.resourceName;
    if(typeof name!=='string'||!/^customers\/\d+\/[A-Za-z]+\/[\d~]+$/.test(name)) throw new AdsError('Google write resource is unconfirmed. Reconcile before retrying.',502,true);
    return name;
  });
  const replacements:Record<string,string>={};
  doc.operations.forEach((o,i)=>{const op=Object.values(o)[0];if(op.create?.resourceName) replacements[op.create.resourceName]=names[i];});
  const resolve=(v:any):any=>typeof v==='string'?(v.startsWith('$result:')?names[Number(v.slice(8))]:replacements[v]||v):Array.isArray(v)?v.map(resolve):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)])):v;
  const after=structuredClone(doc.before);
  doc.operations.forEach((o,i)=>{
    const key=Object.keys(o)[0],type=key.replace(/Operation$/,'') as ResourceType, op=resolve(Object.values(o)[0]);
    if(op.remove) after[type]=after[type].filter(r=>r.resourceName!==op.remove);
    if(op.create) after[type].push(normalize(type,{...op.create,resourceName:names[i]}));
    if(op.update) after[type]=after[type].map(r=>r.resourceName===op.update.resourceName?normalize(type,{...r,...op.update}):r);
  });
  return {inverse:resolve(doc.inverseTemplates),after};
}
