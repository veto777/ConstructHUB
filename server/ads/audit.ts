import { type AdsApi, searchAll } from './client';
import type { State } from './protections';
export interface Finding {kind:string;severity:'info'|'warning'|'unknown';title:string;detail:string;fix?:{action?:unknown;url?:string;label:string}}
export const AUDIT_QUERIES = {
  conversions:`SELECT conversion_action.id,conversion_action.name,conversion_action.type,conversion_action.status,conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status = 'ENABLED'`,
  budgets:`SELECT campaign.id,campaign.name,campaign.advertising_channel_type,campaign_budget.amount_micros,campaign_budget.period,metrics.search_budget_lost_impression_share FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`,
  terms:`SELECT search_term_view.search_term,metrics.cost_micros,metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.cost_micros > 0 AND metrics.conversions = 0 ORDER BY metrics.cost_micros DESC LIMIT 100`,
  disapproved:`SELECT ad_group_ad.ad.id,ad_group_ad.policy_summary.approval_status FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'`,
  leads:`SELECT local_services_lead.id,local_services_lead.lead_charged,local_services_lead.lead_feedback_submitted,local_services_lead.credit_details.credit_state FROM local_services_lead WHERE local_services_lead.creation_date_time DURING LAST_30_DAYS`,
};
export async function auditAccount(api:AdsApi,cid:string,state:State) {
  const findings:Finding[]=[];
  const google={url:'https://ads.google.com/',label:'Review in Google Ads'};
  const read=async(kind:keyof typeof AUDIT_QUERIES)=>{
    try{return await searchAll(api,cid,AUDIT_QUERIES[kind]);}
    catch{findings.push({kind,severity:'unknown',title:`${kind}: unavailable`,detail:'Google did not return this check. This is not a passing result.',fix:google});return null;}
  };
  const conversions=await read('conversions');
  if(conversions) {
    findings.push({kind:'conversions',severity:conversions.length?'info':'warning',title:conversions.length?'Conversion actions present':'No enabled conversion actions found',detail:`${conversions.length} enabled actions. Presence does not verify tag firing, attribution or goal configuration.`,fix:google});
    const calls=conversions.filter(r=>/CALL|PHONE/.test(r.conversionAction?.type||''));
    findings.push({kind:'calls',severity:calls.length?'info':'warning',title:calls.length?'Call conversion actions present':'Review call tracking',detail:`${calls.length} enabled call-related actions. Verify routing and real test-call measurement.`,fix:google});
  }
  const budgets=await read('budgets');
  if(budgets) {
    const measured=budgets.filter(r=>r.metrics?.searchBudgetLostImpressionShare!==undefined && Number.isFinite(Number(r.metrics.searchBudgetLostImpressionShare)));
    const limited=measured.filter(r=>Number(r.metrics.searchBudgetLostImpressionShare)>0.1);
    findings.push({kind:'budget',severity:limited.length?'warning':measured.length?'info':'unknown',title:measured.length?`${limited.length} campaigns lost >10% search impression share to budget`:'Budget limitation metrics unavailable',detail:`Last 30 days; ${measured.length} campaigns with available metrics. Missing metrics are not zero. Review lead quality before increasing spend.`,fix:google});
  }
  const terms=await read('terms');
  if(terms) findings.push({kind:'waste',severity:terms.length?'warning':'info',title:`${terms.length} search terms with spend and no reported conversions`,detail:'Top 100 terms in the last 30 days; conversion lag and Google privacy thresholds apply. Review relevance before excluding. '+terms.slice(0,10).map(r=>r.searchTermView?.searchTerm).filter(Boolean).join('; '),fix:{label:'Edit negative keyword preview',action:{kind:'negative'}}});
  const ads=await read('disapproved');
  if(ads) findings.push({kind:'disapproved',severity:ads.length?'warning':'info',title:`${ads.length} disapproved ads`,detail:'Review the policy issue in Google Ads; appeals require account-specific evidence.',fix:google});
  const presence=state.campaign.filter(c=>['SEARCH','DISPLAY','PERFORMANCE_MAX'].includes(c.advertisingChannelType) && c.geoTargetTypeSetting.positiveGeoTargetType!=='PRESENCE');
  if(presence.length) findings.push({kind:'presence',severity:'warning',title:`${presence.length} campaigns are not presence-only`,detail:'Interest targeting may reach people outside your service area.',fix:{label:'Preview presence-only',action:{kind:'presence'}}});
  const unscheduled=state.campaign.filter(c=>['SEARCH','DISPLAY','PERFORMANCE_MAX'].includes(c.advertisingChannelType)&&!state.campaignCriterion.some(r=>r.campaign===c.resourceName&&r.adSchedule));
  if(unscheduled.length) findings.push({kind:'schedule',severity:'warning',title:`${unscheduled.length} campaigns have no ad schedule`,detail:'Check whether someone can answer calls during all advertised hours.',fix:{label:'Edit schedule preview',action:{kind:'schedule'}}});
  const lsa=state.campaign.filter(c=>c.advertisingChannelType==='LOCAL_SERVICES');
  if(lsa.length) {
    for(const c of lsa) {
      const criteria=state.campaignCriterion.filter(r=>r.campaign===c.resourceName && !r.negative);
      for(const [kind,key] of [['service areas','location'],['job types','localServiceId']] as const) {
        const n=criteria.filter(r=>r[key]).length;
        findings.push({kind:`lsa-${key}`,severity:n?'info':'warning',title:`${c.name}: ${n} ${kind}`,detail:n?'Review these Google settings against the client’s actual services.':'No matching criteria returned; verify setup in Local Services Ads.',fix:{url:'https://ads.google.com/localservices/',label:'Review Local Services settings'}});
      }
      const b=budgets?.find(r=>String(r.campaign?.id)===c.id)?.campaignBudget;
      findings.push({kind:'lsa-budget',severity:b?'info':'unknown',title:`${c.name}: LSA budget`,detail:b?`${b.amountMicros ?? 'unknown'} micros; period ${b.period || 'unknown'}. Currency and timezone appear on the account.`:'Budget unavailable; review in Google.',fix:google});
    }
    const leads=await read('leads');
    if(leads) {
      const candidates=leads.filter(r=>r.localServicesLead?.leadCharged===true && r.localServicesLead?.leadFeedbackSubmitted!==true && !['CREDITED','PENDING'].includes(r.localServicesLead?.creditDetails?.creditState));
      findings.push({kind:'lsa-disputes',severity:candidates.length?'warning':'info',title:`${candidates.length} charged leads to review for feedback`,detail:'Unrated does not mean invalid or eligible for credit. Use the existing LSA Leads workflow with a truthful, manually selected reason; connect that account there if needed.',fix:{url:'/lsa-leads',label:'Review leads and dispute evidence'}});
    }
  }
  return findings;
}
